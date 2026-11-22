// Import OpenDocument (.odt, LibreOffice, OpenOffice, Google Docs) : le texte
// et sa mise en forme, titres, listes (à cocher comprises), tableaux, images,
// notes, commentaires, liens, formules (LaTeX gardé par nos exports), encadrés
// de nos exports. Le résultat est un document brut, validé ensuite comme un
// JSON reçu. Ce qui n'a pas d'équivalent est compté.

import { unzipSync, strFromU8 } from 'fflate'
import { dirToStore } from '../format/bidi'
import { CHART_ALT, chartFromRows } from '../format/chart'
import { diagramFromAlt } from '../format/diagram'
import { picturesFromAlt } from '../format/pictures'
import { SHAPE_ALT } from '../format/shapes'

/** Les formes de LibreOffice (draw:type) les plus proches des nôtres. */
const ODF_SHAPES: Record<string, string> = {
  rectangle: 'rect', 'round-rectangle': 'roundRect', ellipse: 'ellipse', circle: 'ellipse', 'isosceles-triangle': 'triangle', 'right-triangle': 'rtTriangle', diamond: 'diamond', pentagon: 'pentagon', hexagon: 'hexagon', octagon: 'octagon',
  'right-arrow': 'rightArrow', 'left-arrow': 'leftArrow', 'up-arrow': 'upArrow', 'down-arrow': 'downArrow', 'left-right-arrow': 'leftRightArrow', 'up-down-arrow': 'upDownArrow', star4: 'star4', star5: 'star5', star8: 'star8', star24: 'star24',
  heart: 'heart', cloud: 'cloud', smiley: 'smileyFace', sun: 'sun', moon: 'moon', parallelogram: 'parallelogram', trapezoid: 'trapezoid', can: 'can', cube: 'cube', ring: 'donut', frame: 'frame',
  'flowchart-process': 'flowChartProcess', 'flowchart-decision': 'flowChartDecision', 'flowchart-terminator': 'flowChartTerminator', 'flowchart-data': 'flowChartInputOutput', 'flowchart-document': 'flowChartDocument', 'flowchart-connector': 'flowChartConnector',
  'rectangular-callout': 'wedgeRectCallout', 'round-rectangular-callout': 'wedgeRoundRectCallout', 'round-callout': 'wedgeEllipseCallout', 'cloud-callout': 'cloudCallout',
}

type Raw = Record<string, unknown>

export interface OdtImport {
  doc: Raw
  losses: { code: string; count: number }[]
}

export class OdtError extends Error {
  constructor(public code: 'not-zip' | 'not-odt' | 'damaged') {
    super(code)
  }
}

const MAX_UNZIPPED = 200 * 1024 * 1024

interface TextStyle {
  parent?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  sup?: boolean
  sub?: boolean
  smallcaps?: boolean
  caps?: boolean
  color?: string
  highlight?: string
  font?: string
  size?: number
}
interface ParaStyle {
  parent?: string
  align?: string
  left?: number
  first?: number
  before?: number
  after?: number
  line?: number
  pageBreak?: boolean
  text: TextStyle
  list?: string
  /** Style de titre (niveau du plan). */
  heading?: number
  /** De droite à gauche (style:writing-mode rl-tb). */
  rtl?: boolean
  /** Sans numéros de ligne (text:number-lines="false"). */
  noLines?: boolean
  /** La numérotation des lignes reprend à ce numéro (text:line-number). */
  lineStart?: number
}

/** « 12pt », « 1.5cm », « 0.4in », « 10mm » → points. */
export function toPt(v: string | null | undefined): number | undefined {
  const m = /^(-?[\d.]+)(pt|cm|mm|in|pc|px)?$/.exec((v ?? '').trim())
  if (!m) return undefined
  const n = Number(m[1])
  const k: Record<string, number> = { pt: 1, cm: 72 / 2.54, mm: 72 / 25.4, in: 72, pc: 12, px: 0.75 }
  return Math.round(n * (k[m[2] ?? 'pt'] ?? 1) * 100) / 100
}

const kids = (el: Element | null | undefined): Element[] => (el ? Array.from(el.children) : [])
const kid = (el: Element | null | undefined, name: string) => kids(el).find((c) => c.tagName === name)
const at = (el: Element | null | undefined, name: string) => el?.getAttribute(name) ?? null

export function importOdt(bytes: Uint8Array): OdtImport {
  let files: Record<string, Uint8Array>
  try {
    let total = 0
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize
        if (total > MAX_UNZIPPED) throw new OdtError('damaged')
        return f.name === 'content.xml' || f.name === 'styles.xml' || f.name === 'meta.xml' || f.name === 'mimetype' || f.name.startsWith('Pictures/') || /^Object \d+\/content\.xml$/.test(f.name)
      },
    })
  } catch (e) {
    if (e instanceof OdtError) throw e
    throw new OdtError('not-zip')
  }
  if (!files['content.xml']) throw new OdtError('not-odt')
  const mime = files.mimetype ? strFromU8(files.mimetype).trim() : ''
  if (mime && !/opendocument\.text/.test(mime)) throw new OdtError('not-odt')
  const parse = (name: string) => {
    if (!files[name]) return null
    const d = new DOMParser().parseFromString(strFromU8(files[name]), 'application/xml')
    if (d.getElementsByTagName('parsererror').length) throw new OdtError('damaged')
    return d
  }
  return new OdtReader(files, parse('content.xml')!, parse('styles.xml'), parse('meta.xml')).read()
}

class OdtReader {
  private para = new Map<string, ParaStyle>()
  /** Premier numéro de ligne lu sur un paragraphe. */
  private lineStart: number | undefined
  /** Texte vertical, par style de cellule. */
  private cellDir = new Map<string, 'tbrl' | 'btlr'>()
  private text = new Map<string, TextStyle>()
  /** Habillage des cadres d'image, d'après leur style graphique. */
  private graphic = new Map<string, { wrap: string; align?: string }>()
  private lists = new Map<string, ('bullet' | 'number' | 'check' | 'checked')[]>()
  private losses = new Map<string, number>()
  private assets: Record<string, string> = {}
  private comments: Raw[] = []
  private open = new Set<string>()
  private commentSeq = 0

  constructor(
    private files: Record<string, Uint8Array>,
    private content: Document,
    private styles: Document | null,
    private meta: Document | null,
  ) {}

  private lose(code: string) {
    this.losses.set(code, (this.losses.get(code) ?? 0) + 1)
  }

  read(): OdtImport {
    for (const d of [this.styles, this.content]) if (d) this.readStyles(d)
    const body = this.content.getElementsByTagName('office:text')[0]
    const blocks = this.blocks(kids(body))
    const doc: Raw = { format: 'folio/doc', version: 1, meta: this.readMeta(), blocks, assets: this.assets }
    const page = this.readPage()
    if (page) doc.page = page
    if (this.comments.length) doc.comments = this.comments
    const ln = this.styles?.getElementsByTagName('text:linenumbering-configuration')[0]
    if (ln && at(ln, 'text:number-lines') !== 'false') {
      const inc = Number(at(ln, 'text:increment') ?? 1)
      const offset = toPt(at(ln, 'text:offset'))
      doc.lineNumbers = {
        restart: at(ln, 'text:restart-on-page') === 'true' ? 'page' : 'continuous',
        start: this.lineStart ?? 1,
        countBy: Math.max(1, Math.min(100, Math.round(inc) || 1)),
        ...(offset !== undefined ? { distance: Math.max(0, Math.min(144, Math.round(offset * 2) / 2)) } : {}),
      }
    }
    return { doc, losses: [...this.losses].map(([code, count]) => ({ code, count })) }
  }

  private readMeta(): Raw {
    const g = (name: string) => this.meta?.getElementsByTagName(name)[0]?.textContent?.trim() ?? ''
    const out: Raw = { title: g('dc:title') }
    const author = g('meta:initial-creator') || g('dc:creator')
    if (author) out.author = author
    if (g('dc:subject')) out.subject = g('dc:subject')
    const kw = Array.from(this.meta?.getElementsByTagName('meta:keyword') ?? []).map((k) => k.textContent?.trim() ?? '').filter(Boolean)
    if (kw.length) out.keywords = kw
    const lang = g('dc:language')
    if (lang) out.lang = lang
    return out
  }

  private readPage(): Raw | null {
    const p = this.styles?.getElementsByTagName('style:page-layout-properties')[0]
    if (!p) return null
    const mm = (v: string | null) => {
      const n = toPt(v)
      return n === undefined ? undefined : Math.round((n / 72) * 25.4 * 10) / 10
    }
    const w = mm(at(p, 'fo:page-width'))
    const h = mm(at(p, 'fo:page-height'))
    if (!w || !h) return null
    const land = at(p, 'style:print-orientation') === 'landscape' || w > h
    const out: Raw = { size: 'custom', width: land ? h : w, height: land ? w : h, orientation: land ? 'landscape' : 'portrait' }
    const m = { top: mm(at(p, 'fo:margin-top')), right: mm(at(p, 'fo:margin-right')), bottom: mm(at(p, 'fo:margin-bottom')), left: mm(at(p, 'fo:margin-left')) }
    if (Object.values(m).every((v) => v !== undefined)) out.margins = m
    if (Math.abs((out.width as number) - 210) < 1 && Math.abs((out.height as number) - 297) < 1) out.size = 'A4'
    else if (Math.abs((out.width as number) - 215.9) < 1 && Math.abs((out.height as number) - 279.4) < 1) out.size = 'Letter'
    return out
  }

  private readStyles(d: Document): void {
    for (const s of Array.from(d.getElementsByTagName('style:style'))) {
      const name = at(s, 'style:name')
      if (!name) continue
      const tp = kid(s, 'style:text-properties')
      const text = this.textProps(tp)
      if (at(s, 'style:parent-style-name')) text.parent = at(s, 'style:parent-style-name')!
      const family = at(s, 'style:family')
      if (family === 'graphic') {
        const g = this.graphicWrap(kid(s, 'style:graphic-properties'))
        if (g) this.graphic.set(name, g)
      }
      if (family === 'text') this.text.set(name, text)
      else if (family === 'paragraph') {
        const pp = kid(s, 'style:paragraph-properties')
        const ps: ParaStyle = { text, ...(at(s, 'style:parent-style-name') ? { parent: at(s, 'style:parent-style-name')! } : {}) }
        // LibreOffice lit start et end comme la gauche et la droite de la page, même de droite à gauche.
        const align = at(pp, 'fo:text-align')
        if (align) ps.align = align === 'center' ? 'center' : align === 'end' || align === 'right' ? 'right' : align === 'justify' ? 'justify' : 'left'
        if (at(pp, 'text:number-lines') === 'false') ps.noLines = true
        const ls = Number(at(pp, 'text:line-number') ?? 0)
        if (ls > 0) ps.lineStart = Math.min(32_767, Math.round(ls))
        const wm = at(pp, 'style:writing-mode')
        if (wm === 'rl-tb' || wm === 'rl') ps.rtl = true
        else if (wm === 'lr-tb' || wm === 'lr') ps.rtl = false
        ps.left = toPt(at(pp, 'fo:margin-left'))
        ps.first = toPt(at(pp, 'fo:text-indent'))
        ps.before = toPt(at(pp, 'fo:margin-top'))
        ps.after = toPt(at(pp, 'fo:margin-bottom'))
        const lh = /^(\d+)%$/.exec(at(pp, 'fo:line-height') ?? '')
        if (lh) ps.line = Number(lh[1]) / 100
        if (at(pp, 'fo:break-before') === 'page') ps.pageBreak = true
        if (at(s, 'style:list-style-name')) ps.list = at(s, 'style:list-style-name')!
        const outline = Number(at(s, 'style:default-outline-level') ?? 0)
        if (outline >= 1 && outline <= 6) ps.heading = outline
        this.para.set(name, ps)
      } else if (family === 'table-cell') {
        // Texte vertical d'une cellule (bt-lr : attribut de LibreOffice).
        const cp = kid(s, 'style:table-cell-properties')
        const wm = at(cp, 'style:writing-mode') ?? at(cp, 'loext:writing-mode')
        if (wm === 'tb-rl' || wm === 'tb') this.cellDir.set(name, 'tbrl')
        else if (wm === 'bt-lr') this.cellDir.set(name, 'btlr')
      }
    }
    for (const l of Array.from(d.getElementsByTagName('text:list-style'))) {
      const name = at(l, 'style:name')
      if (!name) continue
      const levels: ('bullet' | 'number' | 'check' | 'checked')[] = []
      for (const lv of kids(l)) {
        const level = Number(at(lv, 'text:level') ?? 1) - 1
        const ch = at(lv, 'text:bullet-char') ?? ''
        levels[level] = lv.tagName === 'text:list-level-style-number' ? 'number' : ch === '☐' ? 'check' : ch === '☒' || ch === '☑' ? 'checked' : 'bullet'
      }
      this.lists.set(name, levels)
    }
  }

  private textProps(tp: Element | undefined): TextStyle {
    const o: TextStyle = {}
    if (!tp) return o
    if (at(tp, 'fo:font-weight') === 'bold' || Number(at(tp, 'fo:font-weight')) >= 600) o.bold = true
    if (at(tp, 'fo:font-style') === 'italic') o.italic = true
    const ul = at(tp, 'style:text-underline-style')
    if (ul && ul !== 'none') o.underline = true
    const lt = at(tp, 'style:text-line-through-style')
    if (lt && lt !== 'none') o.strike = true
    const pos = at(tp, 'style:text-position') ?? ''
    if (/^super|^\d/.test(pos) && !/^0/.test(pos)) o.sup = true
    else if (/^sub|^-/.test(pos)) o.sub = true
    if (at(tp, 'fo:font-variant') === 'small-caps') o.smallcaps = true
    if (at(tp, 'fo:text-transform') === 'uppercase') o.caps = true
    const color = at(tp, 'fo:color')
    if (color && /^#[0-9a-f]{6}$/i.test(color) && color.toLowerCase() !== '#000000') o.color = color.toLowerCase()
    const bg = at(tp, 'fo:background-color')
    if (bg && /^#[0-9a-f]{6}$/i.test(bg) && bg.toLowerCase() !== '#ffffff') o.highlight = bg.toLowerCase()
    const font = at(tp, 'style:font-name') ?? at(tp, 'fo:font-family')
    if (font) o.font = font.replace(/^'|'$/g, '')
    const size = toPt(at(tp, 'fo:font-size'))
    if (size && size > 0) o.size = size
    return o
  }

  /** Mise en forme effective d'un style de texte (avec ses parents). */
  private resolveText(name: string | null, depth = 0): TextStyle {
    const s = name ? (this.text.get(name) ?? this.para.get(name)?.text) : undefined
    if (!s || depth > 10) return {}
    const parent = s.parent ? this.resolveText(s.parent, depth + 1) : {}
    const { parent: _p, ...own } = s
    return { ...parent, ...own }
  }

  private resolvePara(name: string | null, depth = 0): ParaStyle & { builtin?: string } {
    const s = name ? this.para.get(name) : undefined
    const builtin = name ? builtinOf(name) : undefined
    if (!s || depth > 10) return { text: {}, ...(builtin ? { builtin } : {}) }
    const parent = s.parent ? this.resolvePara(s.parent, depth + 1) : { text: {} }
    const out: ParaStyle & { builtin?: string } = { ...parent, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)), text: { ...parent.text, ...s.text } }
    out.builtin = builtin ?? (parent as { builtin?: string }).builtin
    return out
  }

  private blocks(nodes: Element[]): Raw[] {
    const out: Raw[] = []
    for (const n of nodes) {
      switch (n.tagName) {
        case 'text:h': {
          const level = Math.min(6, Math.max(1, Number(at(n, 'text:outline-level') ?? 1)))
          {
            const content = this.inline(n, this.resolvePara(at(n, 'text:style-name')).text)
            out.push({ type: 'heading', level, content, ...this.paraProps(at(n, 'text:style-name'), content) })
          }
          break
        }
        case 'text:p':
          out.push(...this.paragraph(n))
          break
        case 'text:list':
          // Titres numérotés : LibreOffice les range dans une liste ; ce sont des titres.
          if (kids(n).some((it) => kids(it).some((c) => c.tagName === 'text:h'))) {
            for (const it of kids(n)) out.push(...this.blocks(kids(it)))
            this.lose('heading-number')
          } else out.push(this.list(n))
          break
        case 'table:table':
          out.push(this.table(n))
          break
        case 'text:section':
          out.push(...this.blocks(kids(n)))
          break
        case 'text:table-of-content':
          out.push({ type: 'toc', title: kid(kid(n, 'text:index-body'), 'text:index-title')?.textContent?.trim() ?? '' })
          break
        case 'text:soft-page-break':
        case 'text:sequence-decls':
        case 'text:variable-decls':
        case 'office:forms':
          break
        case 'text:tracked-changes':
          // Modifications suivies : le texte actuel est gardé (les suppressions en attente ne le sont pas).
          if (kids(n).length) this.lose('changes')
          break
        default:
          if (n.tagName.startsWith('text:') && n.textContent?.trim()) {
            this.lose('other')
            out.push({ text: n.textContent.trim() })
          }
      }
    }
    return out
  }

  private paraProps(styleName: string | null, content: Raw[]): Raw {
    const s = this.resolvePara(styleName)
    const out: Raw = {}
    // De droite à gauche, l'alignement visuel lu s'inverse : notre gauche est le début du paragraphe.
    const align = s.rtl ? (s.align === 'right' ? 'left' : s.align === 'center' || s.align === 'justify' ? s.align : 'right') : s.align
    if (align && align !== 'left') out.align = align
    const dir = dirToStore(!!s.rtl, content)
    if (dir) out.dir = dir
    if (s.noLines) out.noLineNumbers = true
    // Premier numéro de ligne : celui que porte le premier paragraphe qui en a un (LibreOffice le met là).
    if (s.lineStart && this.lineStart === undefined) this.lineStart = s.lineStart
    const indent: Raw = {}
    if (s.left) indent.left = s.left
    if (s.first) indent.first = s.first
    if (Object.keys(indent).length) out.indent = indent
    if (s.pageBreak) out.pageBreakBefore = true
    if (s.line && s.line !== 1) out.line = s.line
    return out
  }

  /** Un paragraphe : texte, ou une image seule, ou une formule centrée. */
  private paragraph(p: Element): Raw[] {
    const styleName = at(p, 'text:style-name')
    const style = this.resolvePara(styleName)
    // Un paragraphe au style de titre (sans text:h) : un titre.
    if (style.heading && (p.textContent ?? '').trim()) {
      const content = this.inline(p, style.text)
      return [{ type: 'heading', level: style.heading, content, ...this.paraProps(styleName, content) }]
    }
    // Une image seule dans son paragraphe : un bloc image.
    const frames = kids(p).filter((c) => c.tagName === 'draw:frame')
    if (frames.length === 1 && !(p.textContent ?? '').trim() && kids(p).length === 1 && !this.isFreePicture(frames[0])) {
      const img = this.frame(frames[0])
      if (img) return [img]
    }
    this.afterImages = []
    const content = this.inline(p, style.text)
    const images = this.afterImages
    this.afterImages = []
    // Formule seule, centrée : une équation.
    if (content.length === 1 && (content[0] as Raw).type === 'math' && style.align === 'center') return [{ type: 'equation', tex: (content[0] as Raw).tex }]
    const block: Raw = { content, ...this.paraProps(styleName, content) }
    if (style.builtin === 'code') return [{ type: 'code', text: content.map((x) => (x as Raw).text ?? '').join('') }, ...images]
    if (style.builtin === 'quote') return [{ type: 'quote', blocks: [{ type: 'paragraph', ...block }] }, ...images]
    if (style.builtin && style.builtin !== 'normal') block.style = style.builtin
    return [...(content.length || !images.length ? [{ type: 'paragraph', ...block }] : []), ...images]
  }

  private inline(el: Element, base: TextStyle, marks: TextStyle = base, link?: string): Raw[] {
    const out: Raw[] = []
    const push = (text: string) => {
      if (!text) return
      const m = clean(marks)
      out.push({ text, ...m, ...(link ? { link } : {}), ...(this.open.size ? { comments: [...this.open].sort() } : {}) })
    }
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) {
        push((node.textContent ?? '').replace(/\s+/g, ' '))
        continue
      }
      if (node.nodeType !== 1) continue
      const c = node as Element
      switch (c.tagName) {
        case 'text:span':
          out.push(...this.inline(c, base, { ...marks, ...this.resolveText(at(c, 'text:style-name')) }, link))
          break
        case 'text:a': {
          const href = at(c, 'xlink:href') ?? ''
          out.push(...this.inline(c, base, marks, /^(https?:|mailto:|tel:|#)/i.test(href) ? href : link))
          break
        }
        case 'text:s':
          push(' '.repeat(Math.min(100, Number(at(c, 'text:c') ?? 1))))
          break
        case 'text:tab':
          push('\t')
          break
        case 'text:line-break':
          push('\n')
          break
        case 'text:note': {
          const body = kid(c, 'text:note-body')
          out.push({ type: 'note', kind: at(c, 'text:note-class') === 'endnote' ? 'end' : 'foot', blocks: this.blocks(kids(body)) })
          break
        }
        case 'text:bookmark':
        case 'text:bookmark-start': {
          const name = (at(c, 'text:name') ?? '').replace(/[^\p{L}\p{N}_]/gu, '_').slice(0, 40)
          if (/^[\p{L}_]/u.test(name)) out.push({ type: 'bookmark', name })
          break
        }
        case 'office:annotation': {
          const id = `c${++this.commentSeq}`
          const paras = kids(c).filter((x) => x.tagName === 'text:p').map((x) => x.textContent ?? '')
          this.comments.push({ id, author: kid(c, 'dc:creator')?.textContent ?? '', date: kid(c, 'dc:date')?.textContent ?? '', text: paras.join('\n').slice(0, 10_000), resolved: at(c, 'loext:resolved') === 'true', replies: [] })
          const name = at(c, 'office:name')
          if (name) {
            this.open.add(id)
            this.names.set(name, id)
          } else this.pointComment = id
          break
        }
        case 'office:annotation-end': {
          const id = this.names.get(at(c, 'office:name') ?? '')
          if (id) this.open.delete(id)
          break
        }
        case 'draw:frame': {
          // Nos images libres : une forme « picture » dans la ligne.
          if (this.isFreePicture(c)) {
            const sh = this.shapeOf(c)
            if (sh) out.push(sh)
            break
          }
          // Formule : dans la ligne ; image : après le paragraphe (une image est un bloc).
          const x = this.frame(c)
          if (x?.type === 'math') out.push(x)
          else if (x) this.afterImages.push(x)
          break
        }
        case 'draw:custom-shape':
        case 'draw:g': {
          const sh = this.shapeOf(c)
          if (sh) out.push(sh)
          break
        }
        case 'text:soft-page-break':
        case 'text:bookmark-end':
        case 'text:reference-mark':
        case 'text:reference-mark-start':
        case 'text:reference-mark-end':
          break
        case 'text:page-number':
          out.push({ type: 'field', name: 'page', ...clean(marks) })
          break
        case 'text:page-count':
          out.push({ type: 'field', name: 'pages', ...clean(marks) })
          break
        case 'text:title':
          out.push({ type: 'field', name: 'title', ...clean(marks) })
          break
        default:
          // Champs et objets inconnus : leur texte affiché.
          push(c.textContent ?? '')
      }
    }
    // Un commentaire sans étendue : il porte sur le premier morceau de texte qui suit.
    if (this.pointComment) {
      const first = out.find((x) => typeof x.text === 'string' && (x.text as string).trim())
      if (first) {
        first.comments = [...new Set([...((first.comments as string[]) ?? []), this.pointComment])].sort()
        this.pointComment = null
      }
    }
    return out
  }
  private names = new Map<string, string>()
  private pointComment: string | null = null

  /** Cadre : image (gardée dans le document) ou formule (LaTeX de nos exports). */
  private afterImages: Raw[] = []

  /**
   * Habillage d'un style graphique : au travers (arrière-plan : derrière le texte ; sinon devant),
   * contour (rapproché, ou au travers s'il remplit l'intérieur), carré à gauche ou à droite.
   */
  private graphicWrap(gp: Element | null | undefined): { wrap: string; align?: string } | null {
    if (!gp) return null
    const wrap = at(gp, 'style:wrap')
    const pos = at(gp, 'style:horizontal-pos')
    const align = pos === 'center' ? 'center' : pos === 'right' || pos === 'outside' ? 'right' : pos === 'left' || pos === 'inside' ? 'left' : undefined
    if (wrap === 'run-through') return { wrap: at(gp, 'style:run-through') === 'background' ? 'behind' : 'front', ...(align ? { align } : {}) }
    if (wrap !== 'left' && wrap !== 'right' && wrap !== 'parallel' && wrap !== 'dynamic' && wrap !== 'biggest') return null
    // Le côté de l'image : sa position, sinon l'opposé du côté où passe le texte.
    const side = align === 'right' || (align !== 'left' && wrap === 'left') ? 'right' : 'left'
    if (at(gp, 'style:wrap-contour') === 'true') return { wrap: at(gp, 'style:wrap-contour-mode') === 'full' ? 'through' : 'tight', align: side }
    return { wrap: side, align: side }
  }

  /**
   * Une forme : la nôtre revient telle quelle (sa description « folio-shape: ») ;
   * une forme de LibreOffice devient la forme la plus proche, avec son texte.
   */
  /** Une image libre de nos exports : un cadre d'image dont la description garde ses réglages. */
  private isFreePicture(f: Element): boolean {
    return !!kid(f, 'draw:image') && (kid(f, 'svg:desc')?.textContent?.trim() ?? '').startsWith(SHAPE_ALT)
  }

  /** L'image d'un cadre, rangée dans les ressources : « asset:id », ou null. */
  private imageOf(img: Element): string | null {
    const href = (at(img, 'xlink:href') ?? '').replace(/^\.\//, '')
    const bytes = this.files[href]
    if (!bytes) return null
    const ext = href.split('.').pop()?.toLowerCase() ?? 'png'
    const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : 'image/png'
    const id = `odt${Object.keys(this.assets).length + 1}`
    this.assets[id] = `data:${type};base64,${toBase64(bytes)}`
    return `asset:${id}`
  }

  private shapeOf(el: Element): Raw | null {
    const desc = kid(el, 'svg:desc')?.textContent?.trim() ?? ''
    if (desc.startsWith(SHAPE_ALT)) {
      try {
        const v = JSON.parse(desc.slice(SHAPE_ALT.length)) as Raw
        if (v && typeof v === 'object') {
          // Les images libres (et celles d'un groupe, dans l'ordre) : les images des cadres.
          const frames = el.tagName === 'draw:frame' ? [el] : Array.from(el.getElementsByTagName('draw:frame'))
          let k = 0
          const fill = (d: Raw): Raw => {
            if (d.shape === 'picture') {
              const img = frames[k++] ? kid(frames[k - 1], 'draw:image') : null
              const src = img ? this.imageOf(img) : null
              if (src) d.src = src
              else this.lose('image')
            }
            if (Array.isArray(d.children)) d.children = (d.children as Raw[]).map(fill)
            return d
          }
          return fill({ ...v, type: 'shape' })
        }
      } catch {
        /* description abîmée : la forme telle qu'on la voit */
      }
    }
    if (el.tagName !== 'draw:custom-shape') return null
    const type = at(kid(el, 'draw:enhanced-geometry') ?? el, 'draw:type') ?? ''
    const text = kids(el)
      .filter((k) => k.tagName === 'text:p')
      .map((k) => k.textContent ?? '')
      .join('\n')
      .trim()
    return {
      type: 'shape',
      shape: ODF_SHAPES[type] ?? 'rect',
      x: toPt(at(el, 'svg:x')) ?? 0,
      y: toPt(at(el, 'svg:y')) ?? 0,
      width: toPt(at(el, 'svg:width')) ?? 72,
      height: toPt(at(el, 'svg:height')) ?? 72,
      wrap: at(el, 'text:anchor-type') === 'as-char' ? 'inline' : 'front',
      ...(text ? { text } : {}),
    }
  }

  private frame(f: Element): Raw | null {
    const desc = kid(f, 'svg:desc')?.textContent?.trim() ?? ''
    // Nos graphiques : une image dont la description porte les données.
    const dg = diagramFromAlt(desc)
    if (dg) return dg
    // Nos dispositions d'images : les données dans la description, les images dans le SVG.
    if (desc.startsWith('folio-pictures:')) {
      const href = (at(kid(f, 'draw:image') ?? f, 'xlink:href') ?? '').replace(/^\.\//, '')
      const bytes = this.files[href]
      const pl = picturesFromAlt(desc, bytes && /\.svg$/i.test(href) ? `data:image/svg+xml;base64,${toBase64(bytes)}` : null)
      if (pl) return pl
    }
    if (desc.startsWith(CHART_ALT)) {
      try {
        return { type: 'chart', ...(JSON.parse(desc.slice(CHART_ALT.length)) as Raw) }
      } catch {
        /* description abîmée : on garde l'image */
      }
    }
    const obj = kid(f, 'draw:object')
    if (obj) {
      const href = (at(obj, 'xlink:href') ?? '').replace(/^\.\//, '')
      const chart = this.chartObject(href)
      if (chart) return chart
      const tex = desc || this.mathTex(href)
      if (tex) return { type: 'math', tex }
      this.lose('equation')
      return null
    }
    const img = kid(f, 'draw:image')
    if (!img) {
      const box = kid(f, 'draw:text-box')
      if (box) this.lose('textbox')
      return null
    }
    const href = (at(img, 'xlink:href') ?? '').replace(/^\.\//, '')
    const bytes = this.files[href]
    if (!bytes) {
      this.lose('image')
      return null
    }
    const ext = href.split('.').pop()?.toLowerCase() ?? 'png'
    const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : 'image/png'
    const id = `odt${Object.keys(this.assets).length + 1}`
    this.assets[id] = `data:${type};base64,${toBase64(bytes)}`
    const width = toPt(at(f, 'svg:width'))
    const title = kid(f, 'svg:title')?.textContent ?? ''
    const look = this.graphic.get(at(f, 'draw:style-name') ?? '')
    return { type: 'image', src: `asset:${id}`, alt: (desc || title).slice(0, 500), ...(width ? { width } : {}), align: look?.align ?? 'center', ...(look ? { wrap: look.wrap } : {}) }
  }

  /**
   * Graphique de LibreOffice (objet chart:chart) : son type, son titre, et les données de sa table
   * locale (première ligne : les séries ; première colonne : les étiquettes).
   */
  private chartObject(href: string): Raw | null {
    const xml = this.files[`${href}/content.xml`]
    if (!xml) return null
    const d = new DOMParser().parseFromString(strFromU8(xml), 'application/xml')
    const chart = d.getElementsByTagName('chart:chart')[0]
    if (!chart) return null
    const cls = (at(chart, 'chart:class') ?? '').replace(/^chart:/, '')
    const kind = cls === 'circle' || cls === 'ring' ? 'pie' : cls === 'line' || cls === 'area' || cls === 'scatter' || cls === 'radar' || cls === 'filled-radar' ? 'line' : 'bar'
    if (!['bar', 'circle', 'line'].includes(cls)) this.lose('chart-type')
    const table = Array.from(d.getElementsByTagName('table:table'))[0]
    if (!table) return null
    const cellText = (c: Element) => Array.from(c.getElementsByTagName('text:p')).map((p) => p.textContent ?? '').join(' ').trim()
    const rows: string[][] = []
    for (const row of Array.from(table.getElementsByTagName('table:table-row'))) {
      const cells: string[] = []
      for (const c of kids(row)) {
        if (c.tagName !== 'table:table-cell') continue
        const v = at(c, 'office:value')
        const repeat = Math.min(50, Number(at(c, 'table:number-columns-repeated') ?? 1) || 1)
        for (let k = 0; k < repeat; k++) cells.push(v !== null && v !== undefined && at(c, 'office:value-type') === 'float' ? v : cellText(c))
      }
      rows.push(cells)
    }
    const data = chartFromRows(rows, 'en')
    if (!data) return null
    const title = d.getElementsByTagName('chart:title')[0]
    // Barres horizontales : chart:vertical dans le style de la zone du graphique.
    const plotStyle = at(d.getElementsByTagName('chart:plot-area')[0], 'chart:style-name')
    const style = Array.from(d.getElementsByTagName('style:style')).find((s) => at(s, 'style:name') === plotStyle)
    const vertical = at(kid(style ?? d.documentElement, 'style:chart-properties'), 'chart:vertical') === 'true'
    // Sans légende : à garder seulement si elle se serait vue (secteurs, plusieurs séries).
    const noLegend = !d.getElementsByTagName('chart:legend').length && (kind === 'pie' || data.series.length > 1)
    return {
      type: 'chart',
      kind,
      ...(title ? { title: cellText(title) } : {}),
      ...data,
      ...(noLegend ? { legend: false } : {}),
      ...(kind === 'bar' && vertical ? { horizontal: true } : {}),
    }
  }

  private mathTex(href: string): string {
    const xml = this.files[`${href}/content.xml`]
    if (!xml) return ''
    const m = /<annotation[^>]*encoding="(?:application\/x-tex|TeX|LaTeX)"[^>]*>([\s\S]*?)<\/annotation>/i.exec(strFromU8(xml))
    return m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim() : ''
  }

  private list(l: Element, level = 0, items: Raw[] = [], style?: string): Raw {
    const name = at(l, 'text:style-name') ?? style
    const kinds = name ? (this.lists.get(name) ?? []) : []
    for (const it of kids(l)) {
      if (it.tagName !== 'text:list-item' && it.tagName !== 'text:list-header') continue
      const override = at(it, 'text:style-override')
      const k = (override ? this.lists.get(override)?.[level] : undefined) ?? kinds[level] ?? 'bullet'
      let first = true
      for (const c of kids(it)) {
        if (c.tagName === 'text:list') this.list(c, level + 1, items, name ?? undefined)
        else if (c.tagName === 'text:p' || c.tagName === 'text:h') {
          const pStyle = at(c, 'text:style-name')
          const content = this.inline(c, this.resolvePara(pStyle).text)
          const style = k === 'checked' ? 'check' : k
          items.push({ content, level: first ? level : level, style, ...(k === 'checked' ? { checked: true } : {}) })
          first = false
        }
      }
    }
    if (level > 0) return {}
    const root = kinds[0] === 'checked' ? 'check' : (kinds[0] ?? 'bullet')
    return { type: 'list', style: root, items }
  }

  private table(t: Element): Raw {
    // Nos encadrés : un tableau d'une cellule nommé « Callout_type_n ».
    const callout = /^Callout_(note|tip|important|warning|caution)_/.exec(at(t, 'table:name') ?? '')
    const rows: Raw[][] = []
    const rowEls = [...kids(t).filter((r) => r.tagName === 'table:table-row'), ...kids(t).filter((x) => x.tagName === 'table:table-header-rows' || x.tagName === 'table:table-rows').flatMap((x) => kids(x).filter((r) => r.tagName === 'table:table-row'))]
    const header = kids(t).some((x) => x.tagName === 'table:table-header-rows')
    for (const r of rowEls) {
      const cells: Raw[] = []
      for (const c of kids(r)) {
        if (c.tagName !== 'table:table-cell') continue
        const cell: Raw = { blocks: this.blocks(kids(c)) }
        const cs = Number(at(c, 'table:number-columns-spanned') ?? 1)
        const rs = Number(at(c, 'table:number-rows-spanned') ?? 1)
        if (cs > 1) cell.colspan = cs
        if (rs > 1) cell.rowspan = rs
        const textDir = this.cellDir.get(at(c, 'table:style-name') ?? '')
        if (textDir) cell.textDir = textDir
        cells.push(cell)
      }
      if (cells.length) rows.push(cells)
    }
    if (callout && rows.length === 1 && rows[0].length === 1) {
      const blocks = rows[0][0].blocks as Raw[]
      const first = blocks[0]
      const title = first?.type === 'paragraph' ? ((first.content as Raw[]) ?? []).map((x) => x.text ?? '').join('').trim() : ''
      if (first?.type === 'paragraph') blocks.shift()
      return { type: 'callout', kind: callout[1], ...(title && !isDefaultTitle(title) ? { title } : {}), blocks }
    }
    return { type: 'table', header, rows }
  }
}

const DEFAULT_TITLES = new Set(['Remarque', 'Astuce', 'Important', 'Avertissement', 'Attention', 'Note', 'Tip', 'Warning', 'Caution'])
const isDefaultTitle = (s: string) => DEFAULT_TITLES.has(s)

/** Styles courants de LibreOffice → styles de Folio Pages. */
function builtinOf(name: string): string | undefined {
  const n = name.replace(/_20_/g, ' ').toLowerCase()
  if (n === 'title') return 'title'
  if (n === 'subtitle') return 'subtitle'
  if (n === 'quotations' || n === 'quote') return 'quote'
  if (n === 'preformatted text' || n === 'source text') return 'code'
  if (n === 'caption' || n === 'figure' || n === 'table' || n === 'illustration') return 'caption'
  if (n === 'standard' || n === 'text body' || n === 'default paragraph style') return 'normal'
  return undefined
}

function clean(m: TextStyle): Raw {
  const out: Raw = {}
  for (const k of ['bold', 'italic', 'underline', 'strike', 'sup', 'sub', 'smallcaps', 'caps'] as const) if (m[k]) out[k] = true
  if (m.color) out.color = m.color
  if (m.highlight) out.highlight = m.highlight
  if (m.font && !/^(Liberation Serif|Liberation Sans|Times New Roman|Arial|Calibri|Cambria)$/.test(m.font)) out.font = m.font
  if (m.size && m.size !== 12 && m.size !== 11) out.size = m.size
  return out
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
