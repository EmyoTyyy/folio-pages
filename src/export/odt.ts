// Export OpenDocument (.odt), le format de LibreOffice et d'OpenOffice,
// fabriqué ici même, sans connexion.
//
// Le document garde sa structure : styles nommés (Titre 1…), listes, tableaux,
// notes de bas de page et de fin, table des matières (que LibreOffice sait
// mettre à jour), en-têtes et pieds de page avec numéros de page, sections
// (format, orientation, marges), colonnes, images, formules (objets MathML),
// commentaires. Les modifications suivies sont exportées acceptées.

import { strToU8, zipSync, type Zippable } from 'fflate'
import { resolveStyle } from '../format/theme'
import type { Block, FolioDoc, HeaderSet, Inline, Marks, PageSetup, Run, StyleDef, TableCell } from '../format/types'
import { BUILTIN_STYLE_IDS } from '../format/theme'
import { cssHighlight, HIGHLIGHT_VALUES } from '../format/color'
import { hasOwn, isRun } from '../format/types'
import { tokenize } from '../editor/highlight'
import { renderTex } from '../math'
import { base64Bytes, fieldText, generated, imageData, imageSize, inlineText, prepareExport, resolveColor, type ExportCommonOptions, type ExportContext } from './common'
import { textWidthPt } from './html'
import { hasColorAdjust } from '../format/picture'

export interface OdtOptions extends ExportCommonOptions {
  /** Redessine une image avec ses retouches de couleur (PNG). */
  bake?: (dataUri: string, adjust: import('../format/types').PictureAdjust) => Promise<Uint8Array | null>
  /** Convertit en PNG une image que le format n'accepte pas (AVIF…). */
  rasterize?: (dataUri: string, width: number, height: number) => Promise<Uint8Array | null>
  /** Version de l'application (propriétés du fichier). */
  version?: string
}

export interface OdtResult {
  bytes: Uint8Array
  /** Ce qui n'a pas pu être exporté tel quel. */
  losses: { code: OdtLoss; count: number }[]
}

export type OdtLoss = 'image-rotate' | 'image-format' | 'math' | 'watermark' | 'picture-adjust'

const MIME = 'application/vnd.oasis.opendocument.text'

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
  'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:math="http://www.w3.org/1998/Math/MathML"',
  'xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0"',
].join(' ')

/** Échappement XML (texte et attributs), sans les caractères de contrôle interdits. */
export const x = (s: string): string =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const pt = (n: number) => `${Math.round(n * 100) / 100}pt`
const mm = (n: number) => `${Math.round(n * 100) / 100}mm`

/** Nom de style ODF (« Heading 1 » → « Heading_20_1 »). */
const odfName = (display: string) => display.replace(/[^A-Za-z0-9]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`)

/** Styles de Folio Pages → styles usuels de LibreOffice. */
const STYLE_NAMES: Record<string, string> = {
  normal: 'Standard',
  title: 'Title',
  subtitle: 'Subtitle',
  caption: 'Caption',
  quote: 'Quotations',
  code: 'Preformatted_20_Text',
  footnote: 'Footnote',
  heading1: 'Heading_20_1',
  heading2: 'Heading_20_2',
  heading3: 'Heading_20_3',
  heading4: 'Heading_20_4',
  heading5: 'Heading_20_5',
  heading6: 'Heading_20_6',
}
const DISPLAY_NAMES: Record<string, string> = {
  normal: 'Default Paragraph Style',
  title: 'Title',
  subtitle: 'Subtitle',
  caption: 'Caption',
  quote: 'Quotations',
  code: 'Preformatted Text',
  footnote: 'Footnote',
}

const styleName = (id: string) => STYLE_NAMES[id] ?? `Folio_${odfName(id)}`

/** Texte avec ses espaces : ODF fusionne les espaces consécutives, il faut les écrire. */
export function odfText(s: string): string {
  let out = ''
  const parts = s.split(/(\n|\t| {2,}|^ )/)
  for (const p of parts) {
    if (!p) continue
    if (p === '\n') out += '<text:line-break/>'
    else if (p === '\t') out += '<text:tab/>'
    else if (/^ +$/.test(p)) out += p.length === 1 ? '<text:s/>' : ` <text:s text:c="${p.length - 1}"/>`
    else out += x(p)
  }
  return out
}

/** Propriétés de texte (style ou mise en forme directe). */
function textProps(src: Partial<StyleDef> | Partial<Run>, doc: FolioDoc, fonts: Set<string>): string {
  const s = src as Partial<StyleDef> & Partial<Run>
  const a: string[] = []
  if (s.font) {
    const fam = s.font === 'heading' || s.font === 'body' || s.font === 'mono' ? doc.theme.fonts[s.font] : s.font
    if (fam) {
      fonts.add(fam)
      a.push(`style:font-name="${x(fam)}"`)
    }
  }
  if (s.size) a.push(`fo:font-size="${pt(s.size)}"`)
  if (s.color) a.push(`fo:color="${resolveColor(s.color, doc)}"`)
  if (s.highlight) a.push(`fo:background-color="${hasOwn(HIGHLIGHT_VALUES, s.highlight) ? hexOf(cssHighlight(s.highlight)) : resolveColor(s.highlight, doc, 'transparent')}"`)
  if (s.bold === true) a.push('fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"')
  else if (s.bold === false) a.push('fo:font-weight="normal"')
  if (s.italic === true) a.push('fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"')
  else if (s.italic === false) a.push('fo:font-style="normal"')
  if (s.underline) {
    const u = s.underlineStyle
    const kind = u === 'dotted' ? 'dotted' : u === 'dashed' ? 'dash' : u === 'wavy' ? 'wave' : 'solid'
    a.push(`style:text-underline-style="${kind}" style:text-underline-width="${u === 'thick' ? 'bold' : 'auto'}" style:text-underline-color="${s.underlineColor ? resolveColor(s.underlineColor, doc) : 'font-color'}"${u === 'double' ? ' style:text-underline-type="double"' : ''}`)
  }
  if (s.outline) a.push('style:text-outline="true"')
  if (s.shadow) a.push('fo:text-shadow="1pt 1pt"')
  if (s.textBorder) a.push(`fo:border="0.5pt solid ${resolveColor(s.textBorder, doc)}" fo:padding="0.03cm"`)
  if (s.textShading && !s.highlight) a.push(`fo:background-color="${resolveColor(s.textShading, doc)}"`)
  if (s.strike) a.push('style:text-line-through-style="solid" style:text-line-through-type="single"')
  if (s.caps) a.push('fo:text-transform="uppercase"')
  if (s.smallcaps) a.push('fo:font-variant="small-caps"')
  if (s.letterSpacing) a.push(`fo:letter-spacing="${pt(s.letterSpacing)}"`)
  const r = s as Run
  if (r.sup) a.push('style:text-position="super 58%"')
  if (r.sub) a.push('style:text-position="sub 58%"')
  if (r.lang) {
    const [l, c] = r.lang.split('-')
    if (/^[a-z]{2,3}$/i.test(l)) a.push(`fo:language="${x(l.toLowerCase())}"${c && /^[a-z]{2}$/i.test(c) ? ` fo:country="${x(c.toUpperCase())}"` : ''}`)
  }
  return a.join(' ')
}

/** Une couleur CSS de surlignage (#rrggbb ou rgb()) → #rrggbb. */
function hexOf(css: string): string {
  if (/^#[0-9a-f]{6}$/i.test(css)) return css
  const m = /rgba?\((\d+)\D+(\d+)\D+(\d+)/.exec(css)
  return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : '#ffff00'
}

/** Propriétés de paragraphe. */
function paraProps(s: Partial<StyleDef>, doc: FolioDoc, extra: string[] = []): string {
  const a: string[] = [...extra]
  if (s.align) a.push(`fo:text-align="${s.align === 'left' ? 'start' : s.align === 'right' ? 'end' : s.align}"`)
  if (s.indent?.left !== undefined) a.push(`fo:margin-left="${pt(s.indent.left)}"`)
  if (s.indent?.right !== undefined) a.push(`fo:margin-right="${pt(s.indent.right)}"`)
  if (s.indent?.first !== undefined) a.push(`fo:text-indent="${pt(s.indent.first)}"`)
  if (s.spacing?.before !== undefined) a.push(`fo:margin-top="${pt(s.spacing.before)}"`)
  if (s.spacing?.after !== undefined) a.push(`fo:margin-bottom="${pt(s.spacing.after)}"`)
  if (s.line) a.push(`fo:line-height="${Math.round(s.line * 100)}%"`)
  if (s.keepNext) a.push('fo:keep-with-next="always"')
  if (s.keepLines) a.push('fo:keep-together="always"')
  if (s.pageBreakBefore) a.push('fo:break-before="page"')
  if (s.shading) a.push(`fo:background-color="${resolveColor(s.shading, doc, 'transparent')}"`)
  if (s.border) a.push(`fo:border="0.5pt solid ${resolveColor(s.border, doc)}" fo:padding="0.1cm"`)
  return a.join(' ')
}

/** Mélange une couleur avec du blanc (fonds des tableaux zébrés). */
function tint(hex: string, amount: number): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return `#${c.map((v) => Math.round(v * amount + 255 * (1 - amount)).toString(16).padStart(2, '0')).join('')}`
}

type Pending = { break?: 'page' | 'column'; master?: string; pageNumber?: number }

interface Ctx {
  /** Style de paragraphe par défaut (citation, cellule d'en-tête…). */
  parent?: string
  /** Gras imposé (en-tête de tableau, première colonne). */
  bold?: boolean
  /** Dans un en-tête ou un pied de page : pas de note ni de commentaire. */
  margin?: boolean
}

class OdtWriter {
  private auto = new Map<string, string>()
  private autoXml: string[] = []
  private styleAuto = new Map<string, string>()
  private styleAutoXml: string[] = []
  fonts = new Set<string>()
  pictures: Zippable = {}
  private pictureNames = new Map<string, string>()
  objects: { path: string; xml: string }[] = []
  losses = new Map<OdtLoss, number>()
  private pending: Pending = {}
  private tableN = 0
  private frameN = 0
  private sectionN = 0
  private remaining = new Map<string, number>()
  private open = new Set<string>()
  private commentN = 0
  private commentNames = new Map<string, string>()
  masters: string[] = []
  pageLayouts: string[] = []
  private masterN = 0
  private textWidth: number

  constructor(
    private ctx: ExportContext,
    private o: OdtOptions,
  ) {
    this.textWidth = textWidthPt(ctx.doc.page)
    // Commentaires : combien de morceaux de texte chacun couvre, pour fermer au bon endroit.
    const count = (items: Inline[]) => {
      for (const it of items) for (const id of (it as Marks).comments ?? []) this.remaining.set(id, (this.remaining.get(id) ?? 0) + 1)
    }
    const walk = (blocks: Block[]) => {
      for (const b of blocks) {
        if (b.type === 'paragraph' || b.type === 'heading') count(b.content)
        else if (b.type === 'list') b.items.forEach((it) => count(it.content))
        else if (b.type === 'quote' || b.type === 'columns') walk(b.blocks)
        else if (b.type === 'table') b.rows.forEach((r) => r.forEach((c) => walk(c.blocks)))
        else if (b.type === 'image') count(b.caption)
      }
    }
    walk(ctx.doc.blocks)
  }

  private loss(code: OdtLoss) {
    this.losses.set(code, (this.losses.get(code) ?? 0) + 1)
  }

  /** Style automatique (dédoublonné) : renvoie son nom. */
  private autoStyle(prefix: string, family: string, body: string, parent?: string, extraAttrs = ''): string {
    const key = `${family}|${parent ?? ''}|${extraAttrs}|${body}`
    const hit = this.auto.get(key)
    if (hit) return hit
    const name = `${prefix}${this.auto.size + 1}`
    this.auto.set(key, name)
    this.autoXml.push(`<style:style style:name="${name}" style:family="${family}"${parent ? ` style:parent-style-name="${parent}"` : ''}${extraAttrs ? ' ' + extraAttrs : ''}>${body}</style:style>`)
    return name
  }

  /** Style automatique d'en-tête ou de pied de page (dans styles.xml). */
  private marginAuto(prefix: string, family: string, body: string, parent?: string): string {
    const key = `${family}|${parent ?? ''}|${body}`
    const hit = this.styleAuto.get(key)
    if (hit) return hit
    const name = `M${prefix}${this.styleAuto.size + 1}`
    this.styleAuto.set(key, name)
    this.styleAutoXml.push(`<style:style style:name="${name}" style:family="${family}"${parent ? ` style:parent-style-name="${parent}"` : ''}>${body}</style:style>`)
    return name
  }

  get automaticStyles(): string {
    return this.autoXml.join('')
  }

  get marginStyles(): string {
    return this.styleAutoXml.join('')
  }

  // --- en ligne -----------------------------------------------------------------

  private span(r: Partial<Run>, inner: string, c: Ctx): string {
    const props = textProps({ ...r, ...(c.bold ? { bold: true } : {}) }, this.ctx.doc, this.fonts)
    if (!props) return inner
    const name = c.margin ? this.marginAuto('T', 'text', `<style:text-properties ${props}/>`) : this.autoStyle('T', 'text', `<style:text-properties ${props}/>`)
    return `<text:span text:style-name="${name}">${inner}</text:span>`
  }

  private link(href: string | undefined, inner: string): string {
    if (!href) return inner
    const l = href.trim()
    const ok = /^(https?:|mailto:|tel:)/i.test(l) ? l : /^#[\p{L}\p{N}_-]+$/u.test(l) ? l : null
    return ok ? `<text:a xlink:type="simple" xlink:href="${x(ok)}">${inner}</text:a>` : inner
  }

  private comments(items: Marks, before: boolean): string {
    if (this.marginMode) return ''
    let out = ''
    for (const id of items.comments ?? []) {
      const thread = this.ctx.doc.comments.find((t) => t.id === id)
      if (!thread) continue
      let name = this.commentNames.get(id)
      if (before && !this.open.has(id)) {
        name = `__Annotation__${++this.commentN}`
        this.commentNames.set(id, name)
        this.open.add(id)
        const paras = [thread.text, ...thread.replies.map((r) => `— ${r.author}${r.author ? ' : ' : ''}${r.text}`)]
          .flatMap((t) => t.split('\n'))
          .map((t) => `<text:p>${odfText(t)}</text:p>`)
          .join('')
        const date = thread.date && !Number.isNaN(Date.parse(thread.date)) ? `<dc:date>${x(new Date(thread.date).toISOString().slice(0, 19))}</dc:date>` : ''
        out += `<office:annotation office:name="${name}"${thread.resolved ? ' loext:resolved="true"' : ''}><dc:creator>${x(thread.author)}</dc:creator>${date}${paras}</office:annotation>`
      }
      if (!before) {
        const left = (this.remaining.get(id) ?? 1) - 1
        this.remaining.set(id, left)
        if (left <= 0 && name) out += `<office:annotation-end office:name="${name}"/>`
      }
    }
    return out
  }

  private marginMode = false

  inline(items: Inline[], c: Ctx = {}): string {
    let out = ''
    for (const it of items) {
      if (isRun(it)) {
        if (it.deleted) {
          out += this.comments(it, true) + this.comments(it, false)
          continue
        }
        out += this.comments(it, true)
        if (it.text) out += this.link(it.link, this.span(it, odfText(it.text), c))
        out += this.comments(it, false)
        continue
      }
      switch (it.type) {
        case 'field': {
          const v = x(fieldText(it, this.ctx, 1))
          const inner = it.name === 'page' ? `<text:page-number text:select-page="current">1</text:page-number>` : it.name === 'pages' ? `<text:page-count>${x(String(this.ctx.fieldCtx.pages))}</text:page-count>` : it.name === 'title' ? `<text:title>${v}</text:title>` : v
          out += this.span(it as unknown as Run, inner, c)
          break
        }
        case 'seq':
        case 'mergefield':
        case 'cite':
          out += this.span(it as unknown as Run, odfText(inlineText([it], this.ctx)), c)
          break
        case 'xref':
          out += `<text:a xlink:type="simple" xlink:href="#${x(it.target)}">${this.span(it as unknown as Run, odfText(this.ctx.refs.text.get(it) ?? ''), c)}</text:a>`
          break
        case 'bookmark':
          out += `<text:bookmark text:name="${x(it.name)}"/>`
          break
        case 'xe':
          if (!it.authority) out += `<text:alphabetical-index-mark text:string-value="${x(it.term)}"${it.sub ? ` text:key1="${x(it.term)}"` : ''}/>`
          break
        case 'math':
          out += this.formula(it.tex, false)
          break
        case 'note': {
          const e = this.ctx.noteOf.get(it)
          if (!e || c.margin) break
          const body = this.blocks(it.blocks, { parent: 'Footnote' })
          out += `<text:note text:id="${e.id}" text:note-class="${it.kind === 'end' ? 'endnote' : 'footnote'}"><text:note-citation>${x(e.label)}</text:note-citation><text:note-body>${body || '<text:p text:style-name="Footnote"/>'}</text:note-body></text:note>`
          break
        }
      }
    }
    return out
  }

  // --- formules ---------------------------------------------------------------

  private formula(tex: string, display: boolean): string {
    // Un simple renvoi à une équation (« \eqref{x} ») s'écrit en texte.
    const ref = /^\s*\\(eqref|ref)\s*\{([^{}]{1,100})\}\s*$/.exec(tex)
    if (ref) {
      const n = this.ctx.math.labels?.get(ref[2].trim())
      const v = n === undefined ? '??' : String(n)
      return odfText(ref[1] === 'eqref' ? `(${v})` : v)
    }
    const r = renderTex(tex, display, this.ctx.math)
    if (!r.html || r.html.includes('<svg')) {
      // Le dessin SVG (flèches étirées) n'existe pas en MathML pur : la formule reste en LaTeX.
      this.loss('math')
      return `<text:span text:style-name="${this.autoStyle('T', 'text', `<style:text-properties style:font-name="${x(this.monoFont())}"/>`)}">${odfText(tex)}</text:span>`
    }
    const n = this.objects.length + 1
    const path = `Object ${n}`
    // MathML pur : sans styles CSS ni classes (LibreOffice les ignore ou les refuse).
    const mathml = r.html.replace(/\s(style|class|role|aria-[a-z]+)="[^"]*"/g, '')
    this.objects.push({ path, xml: `<?xml version="1.0" encoding="UTF-8"?>\n${mathml.replace('<math ', '<math ')}` })
    // Taille de départ estimée ; LibreOffice la recalcule en ouvrant la formule.
    const chars = Math.max(1, tex.replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}^_\s]/g, '').length)
    const tall = /\\(frac|dfrac|sum|int|prod|sqrt|begin|binom|over)/.test(tex)
    const h = display ? (tall ? 30 : 18) : tall ? 22 : 13
    const w = Math.min(this.textWidth, chars * (display ? 7 : 6) + 4)
    const style = this.autoStyle('fr', 'graphic', '<style:graphic-properties style:vertical-pos="middle" style:vertical-rel="text" draw:ole-draw-aspect="1"/>', 'Formula')
    return `<draw:frame draw:style-name="${style}" draw:name="Formula${n}" text:anchor-type="as-char" svg:width="${pt(w)}" svg:height="${pt(h)}" draw:z-index="${n}"><draw:object xlink:href="./${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/><svg:desc>${x(tex)}</svg:desc></draw:frame>`
  }

  private monoFont(): string {
    const f = this.ctx.doc.theme.fonts.mono
    this.fonts.add(f)
    return f
  }

  // --- paragraphes ----------------------------------------------------------------

  /** Style d'un paragraphe : son style nommé, sa mise en forme directe, un saut en attente. */
  private paraStyle(base: string, props: Partial<StyleDef> & { dropCap?: number }, c: Ctx, extra: string[] = []): string {
    const p = this.pending
    const breaks: string[] = [...extra]
    if (p.break === 'page' && !p.master) breaks.push('fo:break-before="page"')
    if (p.break === 'column') breaks.push('fo:break-before="column"')
    if (p.pageNumber !== undefined) breaks.push(`style:page-number="${p.pageNumber}"`)
    const body = paraProps(props, this.ctx.doc, breaks)
    const text = c.bold ? `<style:text-properties ${textProps({ bold: true }, this.ctx.doc, this.fonts)}/>` : ''
    const master = p.master ? `style:master-page-name="${p.master}"` : ''
    this.pending = {}
    if (!body && !text && !master && !props.dropCap) return base
    // Lettrine : un élément de style:paragraph-properties.
    const drop = props.dropCap ? `<style:drop-cap style:lines="${props.dropCap}" style:length="1" style:distance="0.1cm"/>` : ''
    const inner = `${body || drop ? `<style:paragraph-properties ${body}${drop ? `>${drop}</style:paragraph-properties>` : '/>'}` : ''}${text}`
    return c.margin ? this.marginAuto('P', 'paragraph', inner, base) : this.autoStyle('P', 'paragraph', inner, base, master)
  }

  private para(style: string, props: Partial<StyleDef> & { dropCap?: number }, inner: string, c: Ctx, extra: string[] = []): string {
    return `<text:p text:style-name="${this.paraStyle(style, props, c, extra)}">${inner}</text:p>`
  }

  private propsOf(b: Record<string, unknown>): Partial<StyleDef> & { dropCap?: number } {
    const { align, indent, spacing, line, keepNext, keepLines, pageBreakBefore, shading, border } = b as Partial<StyleDef>
    return { align, indent, spacing, line, keepNext, keepLines, pageBreakBefore, shading, border, ...(typeof b.dropCap === 'number' ? { dropCap: b.dropCap } : {}) }
  }

  // --- listes ---------------------------------------------------------------------

  private listStyle(b: Extract<Block, { type: 'list' }>): string {
    // Puce ou numéro par niveau : celui du premier élément de ce niveau.
    const kind: ('bullet' | 'number')[] = []
    for (const it of b.items) kind[it.level] ??= it.style
    const fmt = (level: number): [string, string] => {
      const n = b.numbering ?? 'default'
      const k = n === 'default' ? (['decimal', 'alpha', 'roman'] as const)[level % 3] : n === 'outline' ? 'decimal' : n
      return [k === 'decimal' ? '1' : k === 'alpha' ? 'a' : k === 'ALPHA' ? 'A' : k === 'roman' ? 'i' : 'I', '.']
    }
    const bullets = ['•', '◦', '▪']
    let levels = ''
    for (let l = 0; l < 9; l++) {
      const k = kind[l] ?? kind.slice(0, l).filter(Boolean).pop() ?? b.style
      const indent = 18 * (l + 1)
      const props = `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${pt(indent)}" fo:text-indent="${pt(-14)}" fo:margin-left="${pt(indent)}"/></style:list-level-properties>`
      if (k === 'bullet') {
        const ch = l === 0 && b.bullet ? b.bullet : bullets[l % 3]
        levels += `<text:list-level-style-bullet text:level="${l + 1}" text:bullet-char="${x(ch)}">${props}</text:list-level-style-bullet>`
      } else {
        const [f, suffix] = fmt(l)
        const display = b.numbering === 'outline' ? ` text:display-levels="${l + 1}"` : ''
        levels += `<text:list-level-style-number text:level="${l + 1}" style:num-suffix="${suffix}" style:num-format="${f}"${display}>${props}</text:list-level-style-number>`
      }
    }
    const key = `list|${levels}`
    const hit = this.auto.get(key)
    if (hit) return hit
    const name = `L${this.auto.size + 1}`
    this.auto.set(key, name)
    this.autoXml.push(`<text:list-style style:name="${name}">${levels}</text:list-style>`)
    return name
  }

  private list(b: Extract<Block, { type: 'list' }>, c: Ctx): string {
    const style = this.listStyle(b)
    let out = `<text:list text:style-name="${style}"${b.continue ? ' text:continue-numbering="true"' : ''}>`
    // open[d] : un élément est ouvert à la profondeur d (une sous-liste peut y entrer).
    const open: boolean[] = [false]
    let depth = 0
    b.items.forEach((it, i) => {
      const level = Math.max(0, Math.min(8, it.level))
      while (depth < level) {
        if (!open[depth]) out += '<text:list-item>'
        open[depth] = true
        out += '<text:list>'
        depth++
        open[depth] = false
      }
      while (depth > level) {
        if (open[depth]) out += '</text:list-item>'
        out += '</text:list>'
        depth--
      }
      if (open[depth]) out += '</text:list-item>'
      const start = i === 0 && b.start > 1 && !b.continue ? ` text:start-value="${b.start}"` : ''
      const props = this.propsOf(it as unknown as Record<string, unknown>)
      out += `<text:list-item${start}>${this.para(c.parent ?? 'List_20_Paragraph', props, this.inline(it.content, c), c)}`
      open[depth] = true
    })
    while (depth > 0) {
      if (open[depth]) out += '</text:list-item>'
      out += '</text:list>'
      depth--
    }
    if (open[0]) out += '</text:list-item>'
    return out + '</text:list>'
  }

  // --- tableaux ---------------------------------------------------------------------

  private table(b: Extract<Block, { type: 'table' }>, c: Ctx): string {
    const n = ++this.tableN
    const name = `Table${n}`
    const doc = this.ctx.doc
    const cols = Math.max(1, ...b.rows.map((r) => r.reduce((s, cell) => s + cell.colspan, 0)))
    const total = b.widths?.length ? b.widths.reduce((s, w) => s + w, 0) : this.textWidth
    const widths = b.widths?.length === cols ? b.widths : Array.from({ length: cols }, () => total / cols)
    const align = b.align ?? 'left'
    const tStyle = this.autoStyle('Tab', 'table', `<style:table-properties style:width="${pt(total)}" table:align="${align === 'left' && !b.widths?.length ? 'margins' : align}"${this.pending.break === 'page' ? ' fo:break-before="page"' : ''} fo:margin-top="2pt" fo:margin-bottom="8pt"/>`)
    if (this.pending.break === 'page') this.pending = {}
    let out = `<table:table table:name="${name}" table:style-name="${tStyle}">`
    for (const w of widths) out += `<table:table-column table:style-name="${this.autoStyle('Col', 'table-column', `<style:table-column-properties style:column-width="${pt(w)}"/>`)}"/>`
    const border = `0.5pt solid ${b.border ? resolveColor(b.border, doc) : '#b9beb9'}`
    const accent = resolveColor('accent1', doc)
    // Grille : où commence chaque cellule, en tenant compte des fusions.
    const taken: boolean[][] = b.rows.map(() => [])
    const rowXml: string[] = []
    b.rows.forEach((row, ri) => {
      let col = 0
      let xml = ''
      const head = b.header && ri === 0
      const rowStyle = b.rowHeight ? ` table:style-name="${this.autoStyle('Row', 'table-row', `<style:table-row-properties style:row-height="${pt(b.rowHeight)}"/>`)}"` : ''
      const emitCovered = () => {
        while (taken[ri][col]) {
          xml += '<table:covered-table-cell/>'
          col++
        }
      }
      for (const cell of row) {
        emitCovered()
        for (let dr = 0; dr < cell.rowspan; dr++) for (let dc = 0; dc < cell.colspan; dc++) if (taken[ri + dr]) taken[ri + dr][col + dc] = true
        xml += this.cell(b, cell, ri, col, cols, head, border, accent, c)
        for (let k = 1; k < cell.colspan; k++) xml += '<table:covered-table-cell/>'
        col += cell.colspan
      }
      while (col < cols) {
        if (taken[ri][col]) xml += '<table:covered-table-cell/>'
        else xml += `<table:table-cell office:value-type="string"><text:p text:style-name="Table_20_Contents"/></table:table-cell>`
        col++
      }
      rowXml.push(`<table:table-row${rowStyle}>${xml}</table:table-row>`)
    })
    // La ligne d'en-tête se répète en haut de chaque page seulement si on l'a demandé.
    if (b.header && b.repeatHeader && rowXml.length) out += `<table:table-header-rows>${rowXml.shift()}</table:table-header-rows>`
    out += rowXml.join('')
    return out + '</table:table>'
  }

  private cell(b: Extract<Block, { type: 'table' }>, cell: TableCell, ri: number, col: number, cols: number, head: boolean, border: string, accent: string, c: Ctx): string {
    const props: string[] = ['fo:padding-top="2pt" fo:padding-bottom="2pt" fo:padding-left="4pt" fo:padding-right="4pt"']
    const last = ri + cell.rowspan >= b.rows.length
    switch (b.style) {
      case 'grid':
        props.push(`fo:border="${border}"`)
        break
      case 'lines':
        props.push(`fo:border-bottom="${border}"`)
        if (ri === 0) props.push(`fo:border-top="${border}"`)
        break
      case 'boxed':
        if (ri === 0) props.push(`fo:border-top="${border}"`)
        if (last) props.push(`fo:border-bottom="${border}"`)
        if (col === 0) props.push(`fo:border-left="${border}"`)
        if (col + cell.colspan >= cols) props.push(`fo:border-right="${border}"`)
        if (head) props.push(`fo:border-bottom="${border}"`)
        break
      case 'zebra':
      case 'minimal':
        if (head) props.push(`fo:border-bottom="${border}"`)
        break
    }
    const bg = cell.bg ? resolveColor(cell.bg, this.ctx.doc, '') : head && (b.style === 'zebra' || b.style === 'boxed') ? tint(accent, 0.14) : b.style === 'zebra' && !head && (ri - (b.header ? 1 : 0)) % 2 === 1 ? tint(accent, 0.07) : ''
    if (bg) props.push(`fo:background-color="${bg}"`)
    if (cell.valign && cell.valign !== 'top') props.push(`style:vertical-align="${cell.valign}"`)
    const style = this.autoStyle('Cell', 'table-cell', `<style:table-cell-properties ${props.join(' ')}/>`)
    const span = `${cell.colspan > 1 ? ` table:number-columns-spanned="${cell.colspan}"` : ''}${cell.rowspan > 1 ? ` table:number-rows-spanned="${cell.rowspan}"` : ''}`
    const inner = this.blocks(cell.blocks, { ...c, parent: head ? 'Table_20_Heading' : 'Table_20_Contents', bold: c.bold || (b.firstColumn && col === 0 && !head) })
    return `<table:table-cell table:style-name="${style}" office:value-type="string"${span}>${inner || '<text:p text:style-name="Table_20_Contents"/>'}</table:table-cell>`
  }

  // --- images ---------------------------------------------------------------------

  private async picture(id: string, data: { mime: string; base64: string; ext: string }, w: number, h: number, adjust?: import('../format/types').PictureAdjust): Promise<{ path: string; mime: string; bytes: Uint8Array } | null> {
    const key = hasColorAdjust(adjust) ? `${id}|${JSON.stringify(adjust)}` : id
    const known = this.pictureNames.get(key)
    if (known) return { path: known, mime: known.endsWith('.png') ? 'image/png' : data.mime, bytes: new Uint8Array() }
    let bytes = base64Bytes(data.base64)
    let mime = data.mime
    let ext = data.ext
    // Retouches de couleur : l'image redessinée (sinon l'image telle quelle, signalée).
    if (hasColorAdjust(adjust)) {
      const png = this.o.bake ? await this.o.bake(`data:${mime};base64,${data.base64}`, adjust!).catch(() => null) : null
      if (png) {
        bytes = png
        mime = 'image/png'
        ext = 'png'
      } else this.loss('picture-adjust')
    }
    if (!/^image\/(png|jpeg|gif|svg\+xml|webp|bmp)$/.test(mime)) {
      const png = this.o.rasterize ? await this.o.rasterize(`data:${mime};base64,${data.base64}`, Math.round(w / 0.75), Math.round(h / 0.75)) : null
      if (!png) return null
      bytes = png
      mime = 'image/png'
      ext = 'png'
    }
    const path = `Pictures/${String(this.pictureNames.size + 1).padStart(3, '0')}.${ext}`
    this.pictureNames.set(key, path)
    this.pictures[path] = [bytes, { level: 0 }]
    return { path, mime, bytes }
  }

  private images: Promise<void>[] = []
  private placeholders = new Map<string, string>()

  private image(b: Extract<Block, { type: 'image' }>, c: Ctx): string {
    const d = imageData(b.src, this.ctx.doc)
    if (!d) return ''
    const size = d.mime !== 'image/svg+xml' ? imageSize(base64Bytes(d.base64.slice(0, 64_000))) : null
    const natW = size ? size.width * 0.75 : this.textWidth
    const natH = size ? size.height * 0.75 : this.textWidth * 0.66
    let w = b.width || Math.min(natW, this.textWidth)
    w = Math.min(w, this.textWidth)
    const crop = b.crop && size ? b.crop : null
    const fx = crop ? Math.max(0.05, 1 - (crop.left + crop.right) / 100) : 1
    const fy = crop ? Math.max(0.05, 1 - (crop.top + crop.bottom) / 100) : 1
    const h = b.height || (w * natH * fy) / (natW * fx)
    if (b.rotate) this.loss('image-rotate')
    const n = ++this.frameN
    const key = `@@IMG${n}@@`
    const graphic: string[] = ['style:vertical-pos="top" style:vertical-rel="baseline"']
    if (b.flip) graphic.push(`style:mirror="${b.flip === 'h' ? 'horizontal' : b.flip === 'v' ? 'vertical' : 'horizontal vertical'}"`)
    if (b.border) graphic.push(`fo:border="0.5pt solid ${resolveColor(b.border, this.ctx.doc)}"`)
    const effects = b.adjust
    if (effects?.shadow) graphic.push('draw:shadow="visible" draw:shadow-offset-x="0.12cm" draw:shadow-offset-y="0.14cm" draw:shadow-color="#000000" draw:shadow-opacity="38%"')
    if (effects?.glow) graphic.push(`loext:glow-radius="0.2cm" loext:glow-color="${resolveColor(effects.glow, this.ctx.doc)}" loext:glow-transparency="40%"`)
    if (crop) {
      // fo:clip : ce qu'on retire de chaque côté, dans la taille d'origine de l'image.
      graphic.push(`fo:clip="rect(${pt((natH * crop.top) / 100)}, ${pt((natW * crop.right) / 100)}, ${pt((natH * crop.bottom) / 100)}, ${pt((natW * crop.left) / 100)})"`)
    }
    let anchor = 'as-char'
    if (b.wrap !== 'none') {
      anchor = 'paragraph'
      graphic.push(`style:wrap="${b.wrap === 'left' ? 'right' : 'left'}" style:horizontal-pos="${b.wrap}" style:horizontal-rel="paragraph" style:wrap-contour="false" fo:margin-${b.wrap === 'left' ? 'right' : 'left'}="9pt"`)
    }
    const style = this.autoStyle('fr', 'graphic', `<style:graphic-properties ${graphic.join(' ')}/>`, 'Graphics')
    const id = b.src.slice(6)
    this.images.push(
      this.picture(id, d, w, h, b.adjust).then((pic) => {
        if (!pic) {
          this.loss('image-format')
          this.placeholders.set(key, '')
          return
        }
        this.placeholders.set(
          key,
          `<draw:frame draw:style-name="${style}" draw:name="Image${n}" text:anchor-type="${anchor}" svg:width="${pt(w)}" svg:height="${pt(h)}" draw:z-index="${n}"><draw:image xlink:href="${x(pic.path)}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="${pic.mime}"/>${b.alt ? `<svg:title>${x(b.alt)}</svg:title><svg:desc>${x(b.alt)}</svg:desc>` : ''}</draw:frame>`,
        )
      }),
    )
    let out = this.para(c.parent ?? 'Standard', { align: b.align === 'left' ? 'left' : b.align, spacing: { before: 4, after: b.caption.length ? 2 : 8 } }, key, c)
    if (b.caption.length) out += this.para('Caption', {}, this.inline(b.caption, c), c)
    return out
  }

  /** Remplace les images, une fois leurs fichiers prêts. */
  async resolveImages(xml: string): Promise<string> {
    await Promise.all(this.images)
    return xml.replace(/@@IMG\d+@@/g, (k) => this.placeholders.get(k) ?? '')
  }

  // --- code --------------------------------------------------------------------------

  private code(b: Extract<Block, { type: 'code' }>, c: Ctx): string {
    const doc = this.ctx.doc
    const tokens = tokenize(b.text, b.language)
    const colors = doc.theme.code
    let out = ''
    let offset = 0
    const lines = b.text.split('\n')
    lines.forEach((line, i) => {
      const end = offset + line.length
      let inner = ''
      let at = offset
      for (const tk of tokens) {
        if (tk.to <= offset || tk.from >= end) continue
        const from = Math.max(tk.from, at)
        const to = Math.min(tk.to, end)
        if (from < at) continue
        inner += odfText(b.text.slice(at, from))
        const style = this.autoStyle('T', 'text', `<style:text-properties fo:color="${resolveColor(colors[tk.kind], doc)}"${tk.kind === 'comment' ? ' fo:font-style="italic"' : ''}/>`)
        inner += `<text:span text:style-name="${style}">${odfText(b.text.slice(from, to))}</text:span>`
        at = to
      }
      inner += odfText(b.text.slice(at, end))
      const props: Partial<StyleDef> = { shading: resolveColor(colors.background, doc, '#f6f6f4'), spacing: { before: 0, after: i === lines.length - 1 ? 8 : 0 } }
      out += this.para('Preformatted_20_Text', props, inner, c)
      offset = end + 1
    })
    return out
  }

  // --- listes générées ------------------------------------------------------------------

  private generatedList(b: Extract<Block, { type: 'toc' | 'figures' | 'index' | 'authorities' | 'bibliography' }>, c: Ctx): string {
    const g = generated(b, this.ctx, this.o)
    const lines: string[] = []
    const levelStyle = (l: number) => (b.type === 'toc' ? `Contents_20_${Math.min(10, l + 1)}` : b.type === 'index' ? `Index_20_${Math.min(3, l + 1)}` : 'Contents_20_1')
    const lineXml = (l: (typeof g.groups)[number]['lines'][number]) => {
      const text = l.pieces.map((p) => (p.italic ? this.span({ italic: true }, odfText(p.text), c) : odfText(p.text))).join('')
      const label = l.label ? `${odfText(l.label)}<text:tab/>` : ''
      const page = b.type !== 'index' && l.page ? `<text:tab/>${x(l.page)}` : ''
      return `<text:p text:style-name="${levelStyle(l.level)}">${label}${text}${page}</text:p>`
    }
    if (g.title) lines.push(`<text:p text:style-name="Contents_20_Heading">${odfText(g.title)}</text:p>`)
    for (const gr of g.groups) {
      if (gr.heading) lines.push(`<text:p text:style-name="Contents_20_Heading">${odfText(gr.heading)}</text:p>`)
      for (const l of gr.lines) lines.push(lineXml(l))
    }
    if (!g.groups.some((gr) => gr.lines.length)) lines.push(`<text:p text:style-name="Contents_20_1">${odfText(g.empty)}</text:p>`)
    const breakBefore = this.pending.break === 'page' ? `<text:p text:style-name="${this.paraStyle('Standard', {}, c)}"/>` : ''
    if (b.type === 'toc') {
      // Une vraie table des matières : LibreOffice la met à jour (Outils → Mettre à jour).
      let tpl = ''
      for (let l = 1; l <= 10; l++) {
        tpl += `<text:table-of-content-entry-template text:outline-level="${l}" text:style-name="Contents_20_${l}"><text:index-entry-link-start text:style-name="Index_20_Link"/><text:index-entry-chapter/><text:index-entry-text/><text:index-entry-tab-stop style:type="right" style:leader-char="."/><text:index-entry-page-number/><text:index-entry-link-end/></text:table-of-content-entry-template>`
      }
      const sect = this.autoStyle('Sect', 'section', '<style:section-properties style:editable="false"><style:columns fo:column-count="1" fo:column-gap="0cm"/></style:section-properties>')
      const title = g.title ? `<text:index-title text:style-name="${sect}" text:name="${x(g.title)}_Head">${lines.shift()}</text:index-title>` : ''
      return `${breakBefore}<text:table-of-content text:style-name="${sect}" text:protected="true" text:name="Table of Contents${++this.sectionN}"><text:table-of-content-source text:outline-level="${b.levels}"><text:index-title-template text:style-name="Contents_20_Heading">${x(g.title)}</text:index-title-template>${tpl}</text:table-of-content-source><text:index-body>${title}${lines.join('')}</text:index-body></text:table-of-content>`
    }
    return breakBefore + lines.join('')
  }

  // --- blocs -----------------------------------------------------------------------------

  blocks(blocks: Block[], c: Ctx = {}): string {
    let out = ''
    for (const b of blocks) {
      switch (b.type) {
        case 'paragraph': {
          const base = b.style && b.style !== 'normal' ? styleName(b.style) : (c.parent ?? 'Standard')
          out += this.para(base, this.propsOf(b as unknown as Record<string, unknown>), this.inline(b.content, c), c)
          break
        }
        case 'heading': {
          const level = Math.min(6, Math.max(1, b.level))
          const style = this.paraStyle(`Heading_20_${level}`, this.propsOf(b as unknown as Record<string, unknown>), c)
          out += `<text:h text:style-name="${style}" text:outline-level="${level}">${this.inline(b.content, c)}</text:h>`
          break
        }
        case 'list':
          out += this.list(b, c)
          break
        case 'quote':
          out += this.blocks(b.blocks, { ...c, parent: 'Quotations' })
          break
        case 'code':
          out += this.code(b, c)
          break
        case 'table':
          out += this.table(b, c)
          break
        case 'divider':
          out += this.para('Horizontal_20_Line', {}, '', c)
          break
        case 'equation': {
          const n = this.ctx.eqNumber.get(b)
          out += this.para('Standard', { align: 'center', spacing: { before: 6, after: 8 } }, this.formula(b.tex, true) + (n ? `<text:tab/>(${n})` : ''), c, n ? [] : [])
          break
        }
        case 'pagebreak':
          this.pending = { ...this.pending, break: 'page' }
          break
        case 'columnbreak':
          this.pending = { ...this.pending, break: 'column' }
          break
        case 'section':
          this.section(b)
          break
        case 'columns': {
          const sep = b.rule ? '<style:column-sep style:width="0.5pt" style:color="#b9beb9" style:height="100%" style:vertical-align="top"/>' : ''
          const sect = this.autoStyle('Sect', 'section', `<style:section-properties><style:columns fo:column-count="${b.count}" fo:column-gap="${pt(b.gap)}">${sep}</style:columns></style:section-properties>`)
          // Un saut de page en attente va sur un paragraphe vide avant la section.
          const lead = this.pending.break === 'page' || this.pending.master ? this.para('Standard', {}, '', c) : ''
          out += `${lead}<text:section text:style-name="${sect}" text:name="Columns${++this.sectionN}">${this.blocks(b.blocks, c)}</text:section>`
          break
        }
        case 'image':
          out += this.image(b, c)
          break
        case 'toc':
        case 'figures':
        case 'index':
        case 'authorities':
        case 'bibliography':
          out += this.generatedList(b, c)
          break
      }
    }
    return out
  }

  // --- pages, en-têtes, pieds de page ---------------------------------------------------

  private current: { page: PageSetup; headers: HeaderSet; footers: HeaderSet; firstPage: boolean; numberFormat: string } | null = null

  /** Page maîtresse : format, marges, en-têtes et pieds de page. */
  master(page: PageSetup, headers: HeaderSet, footers: HeaderSet, firstPage: boolean, numberFormat: string): string {
    const n = ++this.masterN
    const name = n === 1 ? 'Standard' : `Folio_${n}`
    const layout = `pm${n}`
    const [w, h] = page.orientation === 'landscape' ? [page.height, page.width] : [page.width, page.height]
    const m = page.margins
    const fmt = numberFormat === 'roman' ? 'i' : numberFormat === 'ROMAN' ? 'I' : numberFormat === 'alpha' ? 'a' : numberFormat === 'ALPHA' ? 'A' : '1'
    const has = (s: HeaderSet) => s.default.length > 0 || s.first.length > 0 || s.even.length > 0
    const headerSpace = Math.max(2, m.top - page.header - 6)
    const footerSpace = Math.max(2, m.bottom - page.footer - 6)
    const hdr = has(headers) ? `<style:header-style><style:header-footer-properties fo:min-height="0mm" fo:margin-bottom="${mm(headerSpace)}" style:dynamic-spacing="false"/></style:header-style>` : '<style:header-style/>'
    const ftr = has(footers) ? `<style:footer-style><style:header-footer-properties fo:min-height="0mm" fo:margin-top="${mm(footerSpace)}" style:dynamic-spacing="false"/></style:footer-style>` : '<style:footer-style/>'
    this.pageLayouts.push(
      `<style:page-layout style:name="${layout}"${page.evenOdd ? ' style:page-usage="all"' : ''}><style:page-layout-properties fo:page-width="${mm(w)}" fo:page-height="${mm(h)}" style:num-format="${fmt}" style:print-orientation="${page.orientation}" fo:margin-top="${mm(has(headers) ? page.header : m.top)}" fo:margin-bottom="${mm(has(footers) ? page.footer : m.bottom)}" fo:margin-left="${mm(m.left)}" fo:margin-right="${mm(m.right)}" style:writing-mode="lr-tb"/>${hdr}${ftr}</style:page-layout>`,
    )
    this.marginMode = true
    const part = (tag: 'header' | 'footer', set: HeaderSet) => {
      if (!has(set)) return ''
      const style = tag === 'header' ? 'Header' : 'Footer'
      const body = (blocks: Block[]) => this.blocks(blocks, { parent: style, margin: true }) || `<text:p text:style-name="${style}"/>`
      let s = `<style:${tag}>${body(set.default)}</style:${tag}>`
      if (page.evenOdd) s += `<style:${tag}-left>${body(set.even.length ? set.even : set.default)}</style:${tag}-left>`
      if (firstPage) s += `<style:${tag}-first>${body(set.first)}</style:${tag}-first>`
      return s
    }
    const xml = `<style:master-page style:name="${name}" style:page-layout-name="${layout}">${part('header', headers)}${part('footer', footers)}</style:master-page>`
    this.marginMode = false
    this.masters.push(xml)
    return name
  }

  start(): void {
    const d = this.ctx.doc
    this.current = { page: d.page, headers: d.headers, footers: d.footers, firstPage: d.page.firstPage, numberFormat: d.page.numberFormat }
    this.master(d.page, d.headers, d.footers, d.page.firstPage, d.page.numberFormat)
  }

  /** Saut de section : nouvelle page maîtresse si quelque chose change, sinon un simple saut de page. */
  private section(b: Extract<Block, { type: 'section' }>): void {
    const cur = this.current!
    const page = b.page ? { ...cur.page, ...b.page, margins: b.page.margins } : cur.page
    const next = {
      page,
      headers: b.headers ?? cur.headers,
      footers: b.footers ?? cur.footers,
      firstPage: b.firstPage ?? cur.firstPage,
      numberFormat: b.numberFormat ?? cur.numberFormat,
    }
    this.current = next
    const changed = !!b.page || !!b.headers || !!b.footers || b.firstPage !== undefined || !!b.numberFormat
    const master = changed ? this.master(next.page, next.headers, next.footers, next.firstPage, next.numberFormat) : undefined
    // Avec une page maîtresse, le changement de page suffit (il commence une page).
    this.pending = { break: 'page', ...(master ? { master } : {}), ...(b.numberStart ? { pageNumber: b.numberStart } : {}) }
  }

  get firstNumber(): number | undefined {
    return this.ctx.doc.page.numberStart > 1 ? this.ctx.doc.page.numberStart : undefined
  }

  /** Le premier paragraphe porte le numéro de la première page s'il n'est pas 1. */
  primeFirst(): void {
    if (this.firstNumber) this.pending = { ...this.pending, pageNumber: this.firstNumber }
  }
}

// --- styles.xml -------------------------------------------------------------------------

function namedStyles(doc: FolioDoc, fonts: Set<string>, width: number): string {
  const out: string[] = []
  const def = (id: string, display: string, family: string, parent: string | null, d: Partial<StyleDef>, extra = '', more = '') => {
    const t = textProps(d, doc, fonts)
    const p = paraProps(d, doc)
    out.push(
      `<style:style style:name="${styleName(id)}" style:display-name="${x(display)}" style:family="${family}"${parent ? ` style:parent-style-name="${parent}"` : ''}${d.next && d.next !== id ? ` style:next-style-name="${styleName(d.next)}"` : ''}${extra}>${p || more ? `<style:paragraph-properties ${p}${more ? '' : '/'}>${more ? more + '</style:paragraph-properties>' : ''}` : ''}${t ? `<style:text-properties ${t}/>` : ''}</style:style>`,
    )
  }
  const full = (id: string) => resolveStyle(doc.styles, id)
  def('normal', DISPLAY_NAMES.normal, 'paragraph', null, full('normal'), ' style:class="text"')
  for (let l = 1; l <= 6; l++) {
    const d = full(`heading${l}`)
    out.push(
      `<style:style style:name="Heading_20_${l}" style:display-name="Heading ${l}" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:default-outline-level="${l}" style:class="text"><style:paragraph-properties ${paraProps(d, doc)}/><style:text-properties ${textProps(d, doc, fonts)}/></style:style>`,
    )
  }
  const ids = new Set([...BUILTIN_STYLE_IDS, ...Object.keys(doc.styles)])
  for (const id of ids) {
    if (id === 'normal' || /^heading[1-6]$/.test(id)) continue
    const d = full(id)
    const own = doc.styles[id]
    const shaped = id === 'quote' ? { ...d, indent: { left: 20, right: 20, ...d.indent } } : id === 'footnote' ? { ...d, indent: { left: 12, first: -12, ...d.indent } } : d
    def(id, DISPLAY_NAMES[id] ?? own?.name ?? id, 'paragraph', 'Standard', shaped)
  }
  const accent = resolveColor('accent1', doc)
  const tabs = `<style:tab-stops><style:tab-stop style:position="${pt(width)}" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops>`
  out.push(
    `<style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-top="0pt" fo:margin-bottom="0pt"/></style:style>`,
    `<style:style style:name="Table_20_Heading" style:display-name="Table Heading" style:family="paragraph" style:parent-style-name="Table_20_Contents" style:class="extra"><style:text-properties fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"/></style:style>`,
    `<style:style style:name="List_20_Paragraph" style:display-name="List Paragraph" style:family="paragraph" style:parent-style-name="Standard" style:class="list"><style:paragraph-properties fo:margin-top="0pt" fo:margin-bottom="2pt"/></style:style>`,
    `<style:style style:name="Header" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-top="0pt" fo:margin-bottom="0pt"/><style:text-properties fo:font-size="9pt"/></style:style>`,
    `<style:style style:name="Footer" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-top="0pt" fo:margin-bottom="0pt"/><style:text-properties fo:font-size="9pt"/></style:style>`,
    `<style:style style:name="Horizontal_20_Line" style:display-name="Horizontal Line" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-top="4pt" fo:margin-bottom="10pt" fo:border-bottom="0.5pt solid #b9beb9" fo:padding="0cm"/><style:text-properties fo:font-size="4pt"/></style:style>`,
    `<style:style style:name="Contents_20_Heading" style:display-name="Contents Heading" style:family="paragraph" style:parent-style-name="Standard" style:class="index"><style:paragraph-properties fo:margin-top="12pt" fo:margin-bottom="6pt" fo:keep-with-next="always"/><style:text-properties fo:font-size="14pt" fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"/></style:style>`,
    ...Array.from({ length: 10 }, (_, i) => `<style:style style:name="Contents_20_${i + 1}" style:display-name="Contents ${i + 1}" style:family="paragraph" style:parent-style-name="Standard" style:class="index"><style:paragraph-properties fo:margin-left="${pt(14 * i)}" fo:margin-top="0pt" fo:margin-bottom="3pt">${tabs}</style:paragraph-properties></style:style>`),
    ...Array.from({ length: 3 }, (_, i) => `<style:style style:name="Index_20_${i + 1}" style:display-name="Index ${i + 1}" style:family="paragraph" style:parent-style-name="Standard" style:class="index"><style:paragraph-properties fo:margin-left="${pt(14 * i)}" fo:margin-top="0pt" fo:margin-bottom="1pt"/></style:style>`),
    `<style:style style:name="Index_20_Link" style:display-name="Index Link" style:family="text"/>`,
    `<style:style style:name="Graphics" style:family="graphic"><style:graphic-properties text:anchor-type="as-char" svg:y="0cm" style:wrap="none" style:vertical-pos="top" style:vertical-rel="baseline"/></style:style>`,
    `<style:style style:name="Formula" style:family="graphic"><style:graphic-properties text:anchor-type="as-char" svg:y="0cm" style:vertical-pos="middle" style:vertical-rel="text"/></style:style>`,
    `<style:style style:name="Footnote_20_Symbol" style:display-name="Footnote Symbol" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>`,
    `<style:style style:name="Footnote_20_anchor" style:display-name="Footnote anchor" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>`,
    `<style:style style:name="Endnote_20_Symbol" style:display-name="Endnote Symbol" style:family="text"/>`,
    `<style:style style:name="Endnote_20_anchor" style:display-name="Endnote anchor" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>`,
    `<style:style style:name="Internet_20_link" style:display-name="Internet Link" style:family="text"><style:text-properties fo:color="${accent}" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>`,
  )
  // Numérotation des notes (format, premier numéro, recommencement).
  const notes = doc.notes
  const fmt = (f: string) => (f === 'roman' ? 'i' : f === 'ROMAN' ? 'I' : f === 'alpha' ? 'a' : f === 'ALPHA' ? 'A' : '1')
  const restart = (r: string) => (r === 'page' ? 'page' : r === 'section' ? 'chapter' : 'document')
  out.push(
    `<text:notes-configuration text:note-class="footnote" text:citation-style-name="Footnote_20_Symbol" text:citation-body-style-name="Footnote_20_anchor" style:num-format="${fmt(notes.foot.format)}" text:start-value="${Math.max(0, notes.foot.start - 1)}" text:footnotes-position="page" text:start-numbering-at="${restart(notes.foot.restart)}"/>`,
    `<text:notes-configuration text:note-class="endnote" text:citation-style-name="Endnote_20_Symbol" text:citation-body-style-name="Endnote_20_anchor" style:num-format="${fmt(notes.end.format)}" text:start-value="${Math.max(0, notes.end.start - 1)}"/>`,
  )
  return out.join('')
}

function fontDecls(fonts: Set<string>): string {
  return `<office:font-face-decls>${[...fonts].map((f) => `<style:font-face style:name="${x(f)}" svg:font-family="'${x(f.replace(/'/g, ''))}'"${MONO_RE.test(f) ? ' style:font-pitch="fixed"' : ''}/>`).join('')}</office:font-face-decls>`
}
const MONO_RE = /mono|code|courier|consolas|menlo/i

function metaXml(doc: FolioDoc, version: string, now: Date): string {
  const m = doc.meta
  const date = (s: string) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString().slice(0, 19) : '')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-meta ${NS} office:version="1.3"><office:meta><meta:generator>Folio Pages${version ? `/${x(version)}` : ''}</meta:generator>${m.title ? `<dc:title>${x(m.title)}</dc:title>` : ''}${m.subject ? `<dc:subject>${x(m.subject)}</dc:subject>` : ''}${m.author ? `<meta:initial-creator>${x(m.author)}</meta:initial-creator><dc:creator>${x(m.author)}</dc:creator>` : ''}${m.keywords.map((k) => `<meta:keyword>${x(k)}</meta:keyword>`).join('')}${m.lang ? `<dc:language>${x(m.lang)}</dc:language>` : ''}${date(m.created) ? `<meta:creation-date>${date(m.created)}</meta:creation-date>` : ''}<dc:date>${date(m.modified) || now.toISOString().slice(0, 19)}</dc:date>${m.organization ? `<meta:user-defined meta:name="Organization">${x(m.organization)}</meta:user-defined>` : ''}</office:meta></office:document-meta>`
}

/** Le document au format OpenDocument Text. */
export async function exportOdt(doc: FolioDoc, o: OdtOptions = {}): Promise<OdtResult> {
  const ctx = prepareExport(doc, o)
  const w = new OdtWriter(ctx, o)
  // Le filigrane n'a pas d'équivalent simple en OpenDocument : il est signalé.
  if (doc.watermark) w.losses.set('watermark', 1)
  w.start()
  w.primeFirst()
  let body = w.blocks(doc.blocks)
  body = await w.resolveImages(body)
  const width = textWidthPt(doc.page)
  for (const f of Object.values(doc.theme.fonts)) w.fonts.add(f)
  const named = namedStyles(doc, w.fonts, width)
  const [lang, country] = (doc.meta.lang || ctx.locale).split('-')
  const defaults = `<style:default-style style:family="paragraph"><style:paragraph-properties style:tab-stop-distance="1.25cm" style:writing-mode="page"/><style:text-properties fo:language="${x((lang || 'fr').toLowerCase())}"${country ? ` fo:country="${x(country.toUpperCase())}"` : ''} style:font-name="${x(doc.theme.fonts.body)}" fo:hyphenate="${doc.hyphenate ? 'true' : 'false'}"${doc.hyphenate ? ' fo:hyphenation-remain-char-count="2" fo:hyphenation-push-char-count="2"' : ''}/></style:default-style><style:default-style style:family="graphic"><style:graphic-properties draw:shadow="hidden"/></style:default-style><style:default-style style:family="table"><style:table-properties table:border-model="collapsing"/></style:default-style>`
  const content = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ${NS} office:version="1.3">${fontDecls(w.fonts)}<office:automatic-styles>${w.automaticStyles}</office:automatic-styles><office:body><office:text><text:sequence-decls><text:sequence-decl text:display-outline-level="0" text:name="Illustration"/><text:sequence-decl text:display-outline-level="0" text:name="Table"/><text:sequence-decl text:display-outline-level="0" text:name="Text"/><text:sequence-decl text:display-outline-level="0" text:name="Drawing"/><text:sequence-decl text:display-outline-level="0" text:name="Figure"/></text:sequence-decls>${body || '<text:p text:style-name="Standard"/>'}</office:text></office:body></office:document-content>`
  const styles = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ${NS} office:version="1.3">${fontDecls(w.fonts)}<office:styles>${defaults}${named}<text:outline-style style:name="Outline">${Array.from({ length: 10 }, (_, i) => `<text:outline-level-style text:level="${i + 1}" style:num-format=""/>`).join('')}</text:outline-style></office:styles><office:automatic-styles>${w.pageLayouts.join('')}${w.marginStyles}</office:automatic-styles><office:master-styles>${w.masters.join('')}</office:master-styles></office:document-styles>`
  const pics = Object.keys(w.pictures)
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${pics.map((p) => `<manifest:file-entry manifest:full-path="${x(p)}" manifest:media-type="${mimeOfPath(p)}"/>`).join('')}${w.objects.map((ob) => `<manifest:file-entry manifest:full-path="${x(ob.path)}/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.formula"/><manifest:file-entry manifest:full-path="${x(ob.path)}/content.xml" manifest:media-type="text/xml"/>`).join('')}</manifest:manifest>`
  // « mimetype » d'abord et sans compression : c'est ainsi qu'on reconnaît un fichier OpenDocument.
  const files: Zippable = { mimetype: [strToU8(MIME), { level: 0 }] }
  files['META-INF/manifest.xml'] = strToU8(manifest)
  files['content.xml'] = strToU8(content)
  files['styles.xml'] = strToU8(styles)
  files['meta.xml'] = strToU8(metaXml(doc, o.version ?? '', ctx.fieldCtx.now))
  for (const p of pics) files[p] = w.pictures[p]
  for (const ob of w.objects) files[`${ob.path}/content.xml`] = strToU8(ob.xml)
  const bytes = zipSync(files, { level: 6 })
  return { bytes, losses: [...w.losses].map(([code, count]) => ({ code, count })) }
}

function mimeOfPath(p: string): string {
  const ext = p.split('.').pop()!.toLowerCase()
  return ext === 'jpg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : `image/${ext}`
}

export const ODT_MIME = MIME
export type { Block }
