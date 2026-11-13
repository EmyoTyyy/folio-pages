// Export d'un document Folio Pages vers .docx (WordprocessingML), avec la
// bibliothèque docx (MIT). Tout se fait dans le navigateur, sans connexion.
//
// Le périmètre suit celui du format : texte et mises en forme, styles et thème,
// listes, tableaux, images, notes, commentaires (avec réponses et résolution),
// suivi des modifications, en-têtes et pieds de page, sections, colonnes,
// champs, table des matières. Ce qui n'a pas d'équivalent est compté dans
// `losses` pour être signalé ; le texte lui-même n'est jamais perdu.

import {
  ColumnBreak,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document,
  EndnoteReferenceRun,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  ImageRun,
  ImportedXmlComponent,
  InsertedTextRun,
  Packer,
  PageBreak,
  Paragraph,
  Tab,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  type ICommentOptions,
  type IImageOptions,
  type ILevelsOptions,
  type IParagraphOptions,
  type IParagraphStyleOptions,
  type IRunOptions,
  type ISectionOptions,
  type ParagraphChild,
} from 'docx'
import { fieldValue, type FieldContext } from '../format/fields'
import { runsText } from '../format/runs'
import { BUILTIN_STYLE_IDS, isBuiltinStyle, resolveStyle, styleDef } from '../format/theme'
import { hasColorAdjust } from '../format/picture'
import {
  PAPER_SIZES,
  THEME_COLORS,
  isRun,
  type Block,
  type BlockOf,
  type FolioDoc,
  type HeaderSet,
  type Inline,
  type Marks,
  type Run,
  type NoteKindSettings,
  type PageSetup,
  type ParaProps,
  type StyleDef,
  AUTHORITY_CATEGORIES,
  CAPTION_LABELS,
} from '../format/types'
import {
  INLINE_CODE_STYLE,
  NUMBER_FORMAT_TO_WORD,
  STYLE_IDS,
  bytesOfDataUri,
  dateFormatToWord,
  hexOf,
  highlightFill,
  imageSize,
  lineToWord,
  pxOfPt,
  sniffImage,
  tableLook,
  tableStyleId,
  tint,
  twips,
  twipsOfMm,
} from './maps'
import { escapeXml } from './xml'
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import type { MathContext } from '../math'
import { MATH_PART_NS, mathKitInUse, ommlPrint, treeToOmml, type X } from './omml'
import { formatRefs, type FormatRefs } from '../refs/values'
import { bibliographyEntry, bibliographyOrder, entryLabel } from '../refs/cite'

/** Ce que l'export n'a pas pu rendre tel quel. */
export type ExportLossCode =
  | 'image-remote'
  | 'image-format'
  | 'image-missing'
  | 'code-colors'
  | 'link-internal'
  | 'font-embedded'
  | 'comment-orphan'
  | 'quote-content'
  | 'columns-nested'
  | 'equation-error'
  | 'picture-effects'

export interface Loss<C extends string = string> {
  code: C
  count: number
}

export interface ExportOptions {
  /** Nom du fichier (valeur du champ {{filename}}). */
  filename?: string
  locale?: string
  now?: Date
  /** Page de chaque titre du corps, dans l'ordre (pour la table des matières). */
  headingPages?: number[]
  /** Nombre de pages (valeur affichée du champ {{pages}} avant mise à jour). */
  pages?: number
  /** Redessine une image avec ses retouches (couleurs, transparence, bords adoucis), en PNG. */
  bake?: (dataUri: string, adjust: import('../format/types').PictureAdjust) => Promise<Uint8Array | null>
  /** Convertit en PNG une image que .docx n'accepte pas (SVG, WebP, AVIF). */
  rasterize?: (dataUri: string, width: number, height: number) => Promise<Uint8Array | null>
  /** Version de l'application, écrite dans les propriétés du fichier. */
  version?: string
  /** Pages connues (vue page) : de chaque signet, de chaque entrée d'index (dans l'ordre), de chaque légende. */
  refPages?: { bookmarks: Record<string, string>; entries: string[]; captions: string[] }
}

export interface ExportResult {
  bytes: Uint8Array
  losses: Loss<ExportLossCode>[]
}

type Kids = (Paragraph | Table | TableOfContents)[]

interface Ctx {
  /** Dans une citation : les paragraphes sans style prennent le style Citation. */
  quote?: boolean
  /** Dans une note : style du texte de note, pas de note ni de commentaire. */
  note?: 'foot' | 'end'
  /** En-tête ou pied de page. */
  hf?: boolean
  /** Corps du document (les commentaires n'existent que là). */
  body?: boolean
  /** Texte en gras par défaut (ligne d'en-tête d'un tableau). */
  bold?: boolean
  /** Couleur du texte par défaut (en-tête d'un tableau zébré). */
  color?: string
  /** Largeur disponible en points. */
  width: number
  /** Dans des colonnes mises à plat : pas de saut de colonne. */
  flat?: boolean
  /** Dans une section en colonnes. */
  columns?: boolean
}

interface Picture {
  type: 'png' | 'jpg' | 'gif' | 'bmp' | 'svg'
  data: Uint8Array
  fallback?: Uint8Array
  /** Taille naturelle en pixels. */
  width: number
  height: number
}

const ALIGN = { left: 'left', center: 'center', right: 'right', justify: 'both' } as const
const GENERIC_FONTS: Record<string, string> = {
  'system-ui': 'Calibri',
  'sans-serif': 'Arial',
  serif: 'Times New Roman',
  monospace: 'Courier New',
  cursive: 'Comic Sans MS',
}
const RESERVED_STYLE_IDS = new Set([...Object.values(STYLE_IDS).map((s) => s.id), 'EndnoteText', 'ListParagraph', 'Hyperlink', 'TOCHeading', 'TOC1', 'TOC2', 'TOC3', INLINE_CODE_STYLE])
const BULLETS = ['•', '◦', '▪']
const SAFE_LINK = /^(https?:|mailto:|tel:)/i
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

/** Identifiant de style dans le fichier .docx. */
export function wordStyleId(id: string): string {
  if (Object.prototype.hasOwnProperty.call(STYLE_IDS, id)) return STYLE_IDS[id].id
  return RESERVED_STYLE_IDS.has(id) ? `${id}_` : id
}

class Exporter {
  private losses = new Map<ExportLossCode, number>()
  private numbering: { reference: string; levels: ILevelsOptions[] }[] = []
  private numberingKeys = new Map<string, string>()
  private instance = 0
  private lastNumberInstance: { reference: string; instance: number } | null = null
  private footnotes: Record<string, { children: Paragraph[] }> = {}
  private endnotes: Record<string, { children: Paragraph[] }> = {}
  private noteId = { foot: 0, end: 0 }
  private changeId = 0
  private comments: ICommentOptions[] = []
  /** Identifiants numériques d'un fil (le commentaire puis ses réponses). */
  private threadIds = new Map<string, number[]>()
  private remaining = new Map<string, number>()
  private opened = new Set<string>()
  private pictures = new Map<string, Picture | null>()
  private headingIndex = 0
  private fieldCtx: FieldContext
  private textWidth: number
  /** Équations : macros et numéros (\label → n). */
  private mathCtx: MathContext
  /** Numéro de chaque équation numérotée, dans l'ordre du texte. */
  private eqNumbers = new Map<Block, number>()
  /** Source LaTeX de chaque équation écrite, avec son empreinte (pour nos propres fichiers). */
  private mathSources: { print: string; tex: string }[] = []
  /** Références : numéros de légende, textes des renvois et des citations. */
  private refs: FormatRefs
  private bookmarkId = 0
  /** Ce que chaque renvoi affiche, dans l'ordre (pour nos propres fichiers : Word ne le dit pas). */
  private xrefShows: string[] = []

  constructor(
    private doc: FolioDoc,
    private opts: ExportOptions,
  ) {
    const m = doc.meta
    this.fieldCtx = {
      title: m.title,
      author: m.author,
      subject: m.subject,
      organization: m.organization,
      keywords: m.keywords,
      created: m.created,
      modified: m.modified,
      filename: opts.filename ?? '',
      page: 1,
      pages: opts.pages ?? 1,
      now: opts.now ?? new Date(),
      locale: opts.locale ?? (m.lang || 'fr'),
    }
    this.textWidth = pageTextWidth(doc.page)
    const fr = (this.fieldCtx.locale || 'fr').startsWith('fr')
    this.refs = formatRefs(doc, {
      lang: this.fieldCtx.locale,
      bookmarkPage: (name) => opts.refPages?.bookmarks[name] ?? null,
      labels: fr ? { missing: 'Erreur ! Signet non défini.', above: 'ci-dessus', below: 'ci-dessous' } : { missing: 'Error! Bookmark not defined.', above: 'above', below: 'below' },
    })
    const labels = new Map<string, number>()
    let k = 0
    const walk = (blocks: Block[]) => {
      for (const b of blocks) {
        if (b.type === 'equation' && b.numbered) {
          this.eqNumbers.set(b, ++k)
          const l = mathKitInUse()?.labelOf(b.tex) ?? null
          if (l && !labels.has(l)) labels.set(l, k)
        } else if (b.type === 'quote' || b.type === 'columns') walk(b.blocks)
        else if (b.type === 'table') for (const row of b.rows) for (const c of row) walk(c.blocks)
      }
    }
    walk(doc.blocks)
    this.mathCtx = { macros: doc.math?.macros ?? '', labels }
  }

  /** Formule → OMML (m:oMath, ou m:oMathPara pour une équation centrée). */
  private omml(tex: string, display: boolean): ImportedXmlComponent {
    let x: X
    try {
      const kit = mathKitInUse()
      if (!kit) throw new Error('no math engine')
      x = treeToOmml(kit.parse(tex, display, this.mathCtx), display)
    } catch {
      // Illisible : la source, en texte, dans l'équation.
      this.lose('equation-error')
      x = { n: 'm:oMath', c: [{ n: 'm:r', c: [{ n: 'm:rPr', c: [{ n: 'm:nor' }] }, { n: 'm:t', a: { 'xml:space': 'preserve' }, c: [tex] }] }] }
      if (display) x = { n: 'm:oMathPara', c: [x] }
    }
    this.mathSources.push({ print: ommlPrint(x), tex })
    const make = (e: X): ImportedXmlComponent => {
      const c = new ImportedXmlComponent(e.n, e.a)
      for (const k of e.c ?? []) c.push(typeof k === 'string' ? k : make(k))
      return c
    }
    return make(x)
  }

  private lose(code: ExportLossCode): void {
    this.losses.set(code, (this.losses.get(code) ?? 0) + 1)
  }

  // --- couleurs et polices ------------------------------------------------------

  /** Couleur pour le fichier : renvoi au thème quand c'en est une, sinon RRGGBB. */
  private color(c: string): string | { theme: 'dark1' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6' } {
    if ((THEME_COLORS as readonly string[]).includes(c)) return { theme: c === 'text' ? 'dark1' : (c as 'accent1') }
    return hexOf(c)
  }

  /** Couleur résolue en « #rrggbb ». */
  private hex(c: string): string {
    return (THEME_COLORS as readonly string[]).includes(c) ? this.doc.theme.colors[c as 'text'] : c
  }

  private family(f: string): string {
    const name = f === 'heading' || f === 'body' || f === 'mono' ? this.doc.theme.fonts[f] : f
    return GENERIC_FONTS[name.toLowerCase()] ?? name
  }

  private font(f: string): IRunOptions['font'] {
    if (f === 'heading') return { theme: 'headings' }
    if (f === 'body') return { theme: 'body' }
    return this.family(f)
  }

  // --- mises en forme -------------------------------------------------------------

  private runProps(m: Marks | StyleDef, ctx?: Ctx): Record<string, unknown> {
    const o: Record<string, unknown> = {}
    const flag = (k: 'bold' | 'italic' | 'strike' | 'caps' | 'smallcaps', to: string) => {
      const v = (m as Record<string, unknown>)[k]
      if (v === true) o[to] = true
      else if (v === false) o[to] = false
    }
    flag('bold', 'bold')
    flag('italic', 'italics')
    flag('strike', 'strike')
    flag('caps', 'allCaps')
    // Capitales et petites capitales ensemble : on voit des capitales (les deux ne s'écrivent pas à la fois).
    if (!(m.caps === true && m.smallcaps === true)) flag('smallcaps', 'smallCaps')
    const mk = m as Marks
    const UL: Record<string, string> = { double: 'double', thick: 'thick', dotted: 'dotted', dashed: 'dash', wavy: 'wave' }
    if (m.underline === true) o.underline = { type: (mk.underlineStyle && UL[mk.underlineStyle]) || 'single', ...(mk.underlineColor ? { color: this.color(mk.underlineColor) } : {}) }
    else if (m.underline === false) o.underline = { type: 'none' }
    if (mk.textBorder) o.border = { style: 'single', size: 4, space: 1, color: this.color(mk.textBorder) }
    // Trame du texte : un motif plein (w:val="solid"), pour la distinguer du surlignage à la relecture.
    if (mk.textShading && !m.highlight) o.shading = { type: 'solid', color: this.color(mk.textShading), fill: 'auto' }
    // Contour, ombre, halo : écrits après coup (fxStyle), le module docx ne les connaît pas.
    if ((mk.outline || mk.shadow || mk.glow) && !mk.code) o.style = `FolioFx${mk.outline ? 'O' : ''}${mk.shadow ? 'S' : ''}${mk.glow ? `G${hexOf(this.hex(mk.glow))}` : ''}`
    if (m.color) o.color = this.color(m.color)
    if (m.highlight) o.shading = { type: 'clear', color: 'auto', fill: hexOf(highlightFill(m.highlight)) }
    if (m.font) o.font = this.font(m.font)
    if (typeof m.size === 'number') o.size = Math.round(m.size * 2)
    if (typeof m.letterSpacing === 'number') o.characterSpacing = twips(m.letterSpacing)
    const marks = m as Marks
    if (marks.sup) o.superScript = true
    if (marks.sub) o.subScript = true
    if (marks.lang) o.language = { value: marks.lang }
    if (marks.code) o.style = INLINE_CODE_STYLE
    if (ctx?.bold && o.bold === undefined) o.bold = true
    if (ctx?.color && o.color === undefined) o.color = this.color(ctx.color)
    return o
  }

  private paraProps(p: ParaProps | StyleDef): Record<string, unknown> {
    const o: Record<string, unknown> = {}
    if (p.align) o.alignment = ALIGN[p.align]
    if (p.indent) {
      const ind: Record<string, number> = {}
      if (typeof p.indent.left === 'number') ind.left = twips(p.indent.left)
      if (typeof p.indent.right === 'number') ind.right = twips(p.indent.right)
      if (typeof p.indent.first === 'number') {
        if (p.indent.first >= 0) ind.firstLine = twips(p.indent.first)
        else ind.hanging = twips(-p.indent.first)
      }
      if (Object.keys(ind).length) o.indent = ind
    }
    const sp: Record<string, unknown> = {}
    if (typeof p.spacing?.before === 'number') sp.before = twips(p.spacing.before)
    if (typeof p.spacing?.after === 'number') sp.after = twips(p.spacing.after)
    if (typeof p.line === 'number') {
      sp.line = lineToWord(p.line)
      sp.lineRule = 'auto'
    }
    if (Object.keys(sp).length) o.spacing = sp
    if (p.keepNext !== undefined) o.keepNext = !!p.keepNext
    if (p.keepLines !== undefined) o.keepLines = !!p.keepLines
    if (p.pageBreakBefore) o.pageBreakBefore = true
    if (p.shading) o.shading = { type: 'clear', color: 'auto', fill: this.color(p.shading) }
    if (p.border) {
      const side = { style: 'single', size: 6, space: 4, color: this.color(p.border) }
      o.border = { top: side, bottom: side, left: side, right: side }
    }
    return o
  }

  // --- éléments en ligne ----------------------------------------------------------

  /** Texte → morceaux d'un même run : tabulations en éléments, lignes séparées. */
  private textRuns(text: string, props: Record<string, unknown>, make: (o: IRunOptions) => ParagraphChild): ParagraphChild[] {
    const out: ParagraphChild[] = []
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      const parts = line.split('\t')
      const children: (string | Tab)[] = []
      parts.forEach((part, k) => {
        if (k > 0) children.push(new Tab())
        if (part) children.push(part)
      })
      if (!children.length && lines.length === 1) return
      out.push(make({ ...props, children, ...(i > 0 ? { break: 1 } : {}) } as IRunOptions))
    })
    return out
  }

  /**
   * Champ de fusion → champ du traitement de texte : MERGEFIELD, ADDRESSBLOCK,
   * GREETINGLINE, MERGEREC, MERGESEQ, NEXT, FILLIN ; les règles à condition
   * (IF, SKIPIF, NEXTIF) contiennent un MERGEFIELD imbriqué, comme il se doit.
   */
  private mergeRun(f: Extract<Inline, { type: 'mergefield' }>, ctx: Ctx, make: (o: IRunOptions) => ParagraphChild): ParagraphChild[] {
    const props = this.runProps(f, ctx)
    const char = (type: string) => new ImportedXmlComponent('w:fldChar', { 'w:fldCharType': type })
    const instr = (code: string) => {
      const el = new ImportedXmlComponent('w:instrText', { 'xml:space': 'preserve' })
      el.push(code)
      return el
    }
    const q = (s: string) => `"${s.replace(/"/g, "'")}"`
    const o = f.opts ?? {}
    const nested = (col: string) => [char('begin'), instr(` MERGEFIELD ${q(col)} `), char('separate'), `«${col}»`, char('end')]
    const OPS: Record<string, string> = { eq: '=', ne: '<>', lt: '<', gt: '>', le: '<=', ge: '>=', empty: '=', notEmpty: '<>', contains: '=' }
    const cond = () => {
      const op = o.op ?? 'eq'
      const value = op === 'empty' || op === 'notEmpty' ? '' : op === 'contains' ? `*${o.value ?? ''}*` : (o.value ?? '')
      return [...nested(o.field ?? ''), instr(` ${OPS[op] ?? '='} ${q(value)} `)]
    }
    const field = (parts: (ImportedXmlComponent | string)[], shown: string) => [make({ ...props, children: [char('begin'), ...parts, char('separate'), shown || ' ', char('end')] } as IRunOptions)]
    switch (f.name) {
      case '@address': {
        const sw = [` ADDRESSBLOCK \\c ${o.company === 'no' ? 0 : 1}`]
        if (o.country === 'always') sw.push(' \\d')
        else if (o.country !== 'never') sw.push(` \\d \\e ${q(o.home ?? '')}`)
        return field([instr(`${sw.join('')} `)], '«AddressBlock»')
      }
      case '@greeting': {
        const name = { first: '<<_FIRST0_>>', full: '<<_TITLE0_ >><<_FIRST0_ >><<_LAST0_>>', 'title-last': '<<_TITLE0_ >><<_LAST0_>>', last: '<<_LAST0_>>' }[o.nameFormat ?? 'first'] ?? '<<_FIRST0_>>'
        const fmt = `<<_BEFORE_ ${o.salutation ?? 'Bonjour'} >>${name}<<_AFTER_ ${o.punct ?? ','}>>`
        return field([instr(` GREETINGLINE \\f ${q(fmt)}${o.fallback ? ` \\e ${q(o.fallback)}` : ''} `)], '«GreetingLine»')
      }
      case '@record':
        return field([instr(' MERGEREC ')], '«Record»')
      case '@sequence':
        return field([instr(' MERGESEQ ')], '«Sequence»')
      case '@next':
        return field([instr(' NEXT ')], '«Next Record»')
      case '@fillin':
        return field([instr(` FILLIN ${q(o.prompt ?? '')}${o.default ? ` \\d ${q(o.default)}` : ''} `)], o.default ?? '')
      case '@if':
        return field([instr(' IF '), ...cond(), instr(`${q(o.then ?? '')} ${q(o.else ?? '')} `)], o.then ?? '')
      case '@skipif':
        return field([instr(' SKIPIF '), ...cond()], '')
      case '@nextif':
        return field([instr(' NEXTIF '), ...cond()], '')
      default:
        return field([instr(` MERGEFIELD ${q(f.name)} `)], `«${f.name}»`)
    }
  }

  private changeAttrs(c: { author: string; date: string }) {
    const date = c.date && !Number.isNaN(Date.parse(c.date)) ? new Date(c.date).toISOString() : this.fieldCtx.now.toISOString()
    return { id: ++this.changeId, author: c.author || '—', date }
  }

  /** Les morceaux d'un champ : début, instruction, (séparateur, valeur), fin. */
  private fieldChildren(code: string, value: string | null): (ImportedXmlComponent | string)[] {
    const char = (type: string) => new ImportedXmlComponent('w:fldChar', { 'w:fldCharType': type })
    const instr = new ImportedXmlComponent('w:instrText', { 'xml:space': 'preserve' })
    instr.push(` ${code} `)
    return value === null ? [char('begin'), instr, char('end')] : [char('begin'), instr, char('separate'), value || ' ', char('end')]
  }

  /** Nom d'étiquette pour SEQ (sans espace) : « Figure », « Tableau »… */
  private seqName(label: string): string {
    const fr = (this.fieldCtx.locale || 'fr').startsWith('fr')
    const builtin: Record<string, [string, string]> = { figure: ['Figure', 'Figure'], table: ['Tableau', 'Table'], equation: ['Équation', 'Equation'] }
    const name = (CAPTION_LABELS as readonly string[]).includes(label) ? builtin[label][fr ? 0 : 1] : label
    return name.replace(/[^\p{L}\p{N}_]/gu, '_').slice(0, 40) || 'Figure'
  }

  private get lcid(): number {
    const l = (this.doc.meta.lang || this.fieldCtx.locale || 'fr').toLowerCase()
    return l.startsWith('fr') ? 1036 : l.startsWith('de') ? 1031 : l.startsWith('es') ? 3082 : l.startsWith('it') ? 1040 : 1033
  }

  /** Numéro de légende, renvoi, entrée d'index, citation : des champs, avec leur valeur à jour. */
  private refRun(x: Exclude<Inline, { text: string }>, ctx: Ctx, make: (o: IRunOptions) => ParagraphChild): ParagraphChild[] {
    const q = (v: string) => `"${v.replace(/"/g, "'")}"`
    const props = x.type === 'xe' || x.type === 'bookmark' ? {} : this.runProps(x as Marks, ctx)
    const run = (code: string, value: string | null) => [make({ ...props, children: this.fieldChildren(code, value) } as IRunOptions)]
    switch (x.type) {
      case 'seq':
        return run(`SEQ ${this.seqName(x.label)} \\* ARABIC`, String(this.refs.seq.get(x) ?? 1))
      case 'xref': {
        if (!ctx.note && !ctx.hf) this.xrefShows.push(x.show)
        const value = this.refs.text.get(x) ?? ''
        if (x.show === 'page') return run(`PAGEREF ${x.target} \\h`, value)
        if (x.show === 'above') return run(`REF ${x.target} \\p \\h`, value)
        return run(`REF ${x.target} \\h`, value)
      }
      case 'cite': {
        const more = x.ids.slice(1).map((id) => ` \\m ${id}`).join('')
        return run(`CITATION ${x.ids[0]}${x.locator ? ` \\p ${q(x.locator)}` : ''} \\l ${this.lcid}${more}`, this.refs.text.get(x) ?? '')
      }
      case 'xe': {
        const esc = (v: string) => v.replace(/:/g, '\\:').replace(/"/g, "'")
        if (x.authority) {
          const cat = AUTHORITY_CATEGORIES.indexOf(x.authority) + 1
          return run(`TA \\l ${q(x.term)}${x.short ? ` \\s ${q(x.short)}` : ''} \\c ${cat}`, null)
        }
        const term = esc(x.term) + (x.sub ? `:${esc(x.sub)}` : '')
        return run(`XE "${term}"${x.bold ? ' \\b' : ''}${x.italic ? ' \\i' : ''}${x.see ? ` \\t ${q(`${(this.fieldCtx.locale || 'fr').startsWith('fr') ? 'Voir' : 'See'} ${x.see}`)}` : ''}`, null)
      }
      default:
        return []
    }
  }

  private fieldRun(f: Extract<Inline, { type: 'field' }>, ctx: Ctx, linked: boolean, make: (o: IRunOptions) => ParagraphChild): ParagraphChild[] {
    const props = this.runProps(f, ctx)
    if (linked) props.style = props.style ?? 'Hyperlink'
    // Champ complet dans un seul passage (début, instruction, séparateur, valeur connue, fin) : il garde sa mise en forme.
    const char = (type: string) => new ImportedXmlComponent('w:fldChar', { 'w:fldCharType': type })
    const instrText = (code: string) => {
      const el = new ImportedXmlComponent('w:instrText', { 'xml:space': 'preserve' })
      el.push(` ${code} `)
      return el
    }
    const complex = (code: string, value: string) => make({ ...props, children: [char('begin'), instrText(code), char('separate'), value || ' ', char('end')] } as IRunOptions)
    if (f.name === 'page') return [complex('PAGE', '1')]
    if (f.name === 'pages') return [complex('NUMPAGES', String(this.fieldCtx.pages))]
    const value = fieldValue(f.name, f.format, this.fieldCtx)
    // Sans format choisi, celui d'usage est écrit, avec « MERGEFORMAT » pour le reconnaître au retour.
    const pic = (def: string) => ` \\@ "${dateFormatToWord(f.format || def).replace(/"/g, '')}"${f.format ? '' : ' \\* MERGEFORMAT'}`
    const instr: Partial<Record<typeof f.name, string>> = {
      title: 'TITLE',
      author: 'AUTHOR',
      subject: 'SUBJECT',
      keywords: 'KEYWORDS',
      filename: 'FILENAME',
      date: `DATE${pic('D MMMM YYYY')}`,
      time: `TIME${pic('HH:mm')}`,
      created: `CREATEDATE${pic('D MMMM YYYY')}`,
      modified: `SAVEDATE${pic('D MMMM YYYY')}`,
    }
    const code = instr[f.name]
    // « Organisation » n'a pas de champ fiable : sa valeur est écrite en texte.
    if (!code) return value ? [make({ ...props, text: value } as IRunOptions)] : []
    return [complex(code, value)]
  }

  private inlines(content: Inline[], ctx: Ctx): ParagraphChild[] {
    const out: ParagraphChild[] = []
    const bookmarkEnds: number[] = []
    let link: { href: string; children: ParagraphChild[] } | null = null
    const flush = () => {
      if (link && link.children.length) out.push(new ExternalHyperlink({ link: link.href, children: link.children }))
      link = null
    }
    for (const x of content) {
      if (!isRun(x) && x.type === 'note') {
        flush()
        if (ctx.note || ctx.hf) continue
        const id = ++this.noteId[x.kind]
        const kids = this.blocks(x.blocks, { note: x.kind, width: this.textWidth }).filter((k): k is Paragraph => k instanceof Paragraph)
        const children = kids.length ? kids : [new Paragraph({ style: x.kind === 'foot' ? 'FootnoteText' : 'EndnoteText' })]
        if (x.kind === 'foot') {
          this.footnotes[String(id)] = { children }
          out.push(new FootnoteReferenceRun(id))
        } else {
          this.endnotes[String(id)] = { children }
          out.push(new EndnoteReferenceRun(id))
        }
        continue
      }
      const marks = x as Marks
      const ids = ctx.body ? (marks.comments ?? []).filter((id) => this.threadIds.has(id)) : []
      const closing: number[] = []
      for (const id of ids) {
        const nums = this.threadIds.get(id)!
        if (!this.opened.has(id)) {
          this.opened.add(id)
          flush()
          for (const n of nums) out.push(new CommentRangeStart(n))
        }
        const left = (this.remaining.get(id) ?? 1) - 1
        this.remaining.set(id, left)
        if (left === 0) closing.push(...nums)
      }
      let made: ParagraphChild[]
      let href = marks.link ?? ''
      if (href && !SAFE_LINK.test(href)) {
        this.lose('link-internal')
        href = ''
      }
      // Suivi des modifications : le passage (texte ou champ) est écrit comme ajouté ou supprimé.
      const make = marks.deleted
        ? (o: IRunOptions) => new DeletedTextRun({ ...o, ...this.changeAttrs(marks.deleted!) })
        : marks.inserted
          ? (o: IRunOptions) => new InsertedTextRun({ ...o, ...this.changeAttrs(marks.inserted!) })
          : (o: IRunOptions) => new TextRun(o)
      if (!isRun(x) && x.type === 'math') made = [this.omml(x.tex, false) as unknown as ParagraphChild]
      else if (!isRun(x) && x.type === 'mergefield') made = this.mergeRun(x, ctx, make)
      else if (!isRun(x) && x.type === 'bookmark') {
        // Le signet couvre la suite du paragraphe : un renvoi (REF) mis à jour dans Word retrouve ce texte.
        flush()
        const id = ++this.bookmarkId
        out.push(new ImportedXmlComponent('w:bookmarkStart', { 'w:id': String(id), 'w:name': x.name }) as unknown as ParagraphChild)
        bookmarkEnds.push(id)
        made = []
      } else if (!isRun(x) && (x.type === 'seq' || x.type === 'xref' || x.type === 'cite' || x.type === 'xe')) made = this.refRun(x, ctx, make)
      else if (!isRun(x)) made = this.fieldRun(x as Extract<Inline, { type: 'field' }>, ctx, !!href, make)
      else {
        const props = this.runProps(x, ctx)
        if (href) props.style = props.style ?? 'Hyperlink'
        made = this.textRuns(x.text, props, make)
      }
      if (href) {
        if (!link || link.href !== href) {
          flush()
          link = { href, children: [] }
        }
        link.children.push(...made)
        made = []
      } else flush()
      if (made.length) {
        flush()
        out.push(...made)
      }
      if (closing.length) {
        flush()
        for (const n of closing) out.push(new CommentRangeEnd(n))
        for (const n of closing) out.push(new TextRun({ children: [new CommentReference(n)] }))
      }
    }
    flush()
    for (const id of bookmarkEnds) out.push(new ImportedXmlComponent('w:bookmarkEnd', { 'w:id': String(id) }) as unknown as ParagraphChild)
    return out
  }

  // --- listes ---------------------------------------------------------------------

  /** Définition de numérotation pour ces styles par niveau (créée une fois, puis réutilisée). */
  private numberingRef(list: BlockOf<'list'>, styles: string[]): string {
    const kind = list.numbering ?? 'default'
    const key = JSON.stringify([styles, kind, list.bullet ?? '', list.style === 'number' ? list.start : 1])
    let reference = this.numberingKeys.get(key)
    if (reference) return reference
    reference = `folio-list-${this.numberingKeys.size + 1}`
    this.numberingKeys.set(key, reference)
    const levels: ILevelsOptions[] = []
    for (let l = 0; l <= 8; l++) {
      const paragraph = { indent: { left: twips(18 * (l + 1)), hanging: twips(18) } }
      if (styles[l] === 'bullet') {
        levels.push({ level: l, format: 'bullet', text: l === 0 && list.bullet ? list.bullet : BULLETS[l % 3], alignment: 'left', style: { paragraph } })
        continue
      }
      const cycle = ['decimal', 'lowerLetter', 'lowerRoman'] as const
      const format =
        kind === 'alpha' ? 'lowerLetter' : kind === 'ALPHA' ? 'upperLetter' : kind === 'roman' ? 'lowerRoman' : kind === 'ROMAN' ? 'upperRoman' : kind === 'default' ? (l < 3 ? cycle[l] : 'decimal') : 'decimal'
      let text = `%${l + 1}.`
      if (kind === 'outline') {
        text = ''
        for (let k = 0; k <= l; k++) text += `%${k + 1}.`
      }
      const wide = kind === 'outline' ? { indent: { left: twips(18 * (l + 1) + 8 * l), hanging: twips(18 + 8 * l) } } : paragraph
      levels.push({ level: l, format, text, alignment: 'left', start: l === 0 ? list.start : 1, style: { paragraph: wide } })
    }
    this.numbering.push({ reference, levels })
    return reference
  }

  private list(list: BlockOf<'list'>, ctx: Ctx): Paragraph[] {
    // Style de chaque niveau : celui du premier élément qui s'y trouve.
    const styles: string[] = []
    for (let l = 0; l <= 8; l++) styles[l] = list.items.find((it) => it.level === l)?.style ?? (l === 0 ? list.style : styles[l - 1])
    styles[0] = list.style
    // Une liste qui continue la précédente en reprend la numérotation telle quelle.
    const main =
      list.style === 'number' && list.continue && this.lastNumberInstance ? this.lastNumberInstance : { reference: this.numberingRef(list, styles), instance: ++this.instance }
    if (list.style === 'number') this.lastNumberInstance = main
    // Une sous-liste d'un autre style que les précédentes du même niveau (des puces sous « 1. », des
    // numéros sous « 2. ») a sa propre numérotation, qui recommence à chaque sous-liste.
    const alt: ({ reference: string; instance: number; style: string } | null)[] = []
    return list.items.map((it) => {
      const level = Math.min(8, it.level)
      for (let l = level + 1; l <= 8; l++) alt[l] = null
      let num = main
      if (level > 0 && it.style !== styles[level]) {
        if (!alt[level] || alt[level]!.style !== it.style) {
          const own = [...styles]
          own[level] = it.style
          alt[level] = { reference: this.numberingRef(list, own), instance: ++this.instance, style: it.style }
        }
        num = alt[level]!
      } else alt[level] = null
      return new Paragraph({
        style: 'ListParagraph',
        ...this.paraProps(it),
        numbering: { reference: num.reference, level, instance: num.instance },
        children: this.inlines(it.content, ctx),
      } as IParagraphOptions)
    })
  }

  // --- tableaux -------------------------------------------------------------------

  private table(t: BlockOf<'table'>, ctx: Ctx): Table {
    const look = tableLook(t.style, this.doc.theme, t.border ? this.hex(t.border) : undefined)
    const cols = Math.max(1, ...t.rows.map((r) => r.reduce((n, c) => n + c.colspan, 0)))
    const fixed = !!t.widths && t.widths.length === cols
    const widths = fixed ? t.widths! : Array.from({ length: cols }, () => ctx.width / cols)
    const side = (size: number, color: string) => (size ? { style: 'single', size, color: hexOf(color) } : { style: 'none', size: 0, color: 'auto' })
    // Colonne de départ de chaque cellule, en tenant compte des fusions verticales.
    const busy: number[] = []
    const rows = t.rows.map((row, r) => {
      const head = t.header && r === 0
      let col = 0
      const cells = row.map((cell) => {
        while ((busy[col] ?? 0) > 0) col++
        const start = col
        for (let k = 0; k < cell.colspan; k++) busy[col + k] = cell.rowspan
        col += cell.colspan
        const strong = head || (!!t.firstColumn && start === 0)
        const fill = cell.bg ? this.hex(cell.bg) : head ? look.headerFill : look.bandFill && r % 2 === 1 ? look.bandFill : null
        const inner: Ctx = { width: widths.slice(start, start + cell.colspan).reduce((a, b) => a + b, 0) - 8, bold: strong || undefined, color: head && !cell.bg ? (look.headerColor ?? undefined) : undefined, body: ctx.body, hf: ctx.hf }
        // Comme à l'écran : le dernier paragraphe d'une cellule n'ajoute pas d'espace sous lui.
        const last = cell.blocks[cell.blocks.length - 1]
        const tight = last && (last.type === 'paragraph' || last.type === 'heading') && last.spacing?.after === undefined
        const content = tight ? [...cell.blocks.slice(0, -1), { ...last, spacing: { ...last.spacing, after: 0 } }] : cell.blocks
        const kids = this.blocks(content, inner).filter((k): k is Paragraph | Table => !(k instanceof TableOfContents))
        return new TableCell({
          children: kids.length ? kids : [new Paragraph({})],
          columnSpan: cell.colspan > 1 ? cell.colspan : undefined,
          rowSpan: cell.rowspan > 1 ? cell.rowspan : undefined,
          verticalAlign: cell.valign === 'middle' ? 'center' : cell.valign === 'bottom' ? 'bottom' : undefined,
          shading: cell.bg ? { type: 'clear', color: 'auto', fill: this.color(cell.bg) } : fill ? { type: 'clear', color: 'auto', fill: hexOf(fill) } : undefined,
          borders: head && look.headerRule ? { bottom: side(look.headerRule, look.color) } : undefined,
          margins: { top: twips(3), bottom: twips(3), left: twips(6), right: twips(6) },
        } as ConstructorParameters<typeof TableCell>[0])
      })
      for (let k = 0; k < busy.length; k++) if (busy[k] > 0) busy[k]--
      return new TableRow({ children: cells, tableHeader: (head && !!t.repeatHeader) || undefined, cantSplit: true, ...(t.rowHeight ? { height: { value: twips(t.rowHeight), rule: 'exact' } } : {}) } as ConstructorParameters<typeof TableRow>[0])
    })
    return new Table({
      rows,
      style: tableStyleId(t.style),
      width: { size: twips(widths.reduce((a, b) => a + b, 0)), type: 'dxa' },
      columnWidths: widths.map(twips),
      // Largeurs choisies : colonnes fixes ; sinon le tableau occupe la largeur du texte.
      layout: fixed ? 'fixed' : 'autofit',
      alignment: t.align === 'center' ? 'center' : t.align === 'right' ? 'right' : undefined,
      tableLook: { firstRow: t.header, firstColumn: !!t.firstColumn, noHBand: t.style !== 'zebra', noVBand: true },
      borders: {
        top: side(look.outerH, look.outerColor),
        bottom: side(look.outerH, look.outerColor),
        left: side(look.outerV, look.outerColor),
        right: side(look.outerV, look.outerColor),
        insideHorizontal: side(look.insideH, look.color),
        insideVertical: side(look.insideV, look.color),
      },
    } as ConstructorParameters<typeof Table>[0])
  }

  // --- images ---------------------------------------------------------------------

  /** Charge et, au besoin, convertit chaque image du document avant l'export (asynchrone). */
  async preparePictures(): Promise<void> {
    const srcs = new Set<string>()
    walkBlocks(allBlocks(this.doc), (b) => {
      if (b.type === 'image') srcs.add(b.src)
    })
    for (const src of srcs) this.pictures.set(src, await this.loadPicture(src))
    // Images retouchées : redessinées avec leurs retouches (une par réglage différent).
    const adjusted = new Map<string, BlockOf<'image'>>()
    walkBlocks(allBlocks(this.doc), (b) => {
      if (b.type !== 'image' || !b.adjust) return
      if (b.adjust.shadow || b.adjust.glow) this.lose('picture-effects')
      if (hasColorAdjust(b.adjust)) adjusted.set(pictureKey(b), b)
    })
    for (const [key, b] of adjusted) {
      const uri = b.src.startsWith('asset:') ? this.doc.assets[b.src.slice(6)] : b.src
      const png = uri && this.opts.bake ? await this.opts.bake(uri, b.adjust!).catch(() => null) : null
      const size = png ? imageSize(png) : null
      if (png && size) this.pictures.set(key, { type: 'png', data: png, width: size.width, height: size.height })
      else this.lose('picture-effects')
    }
  }

  private async loadPicture(src: string): Promise<Picture | null> {
    const uri = src.startsWith('asset:') ? this.doc.assets[src.slice(6)] : src
    if (!uri) {
      this.lose('image-missing')
      return null
    }
    if (!uri.startsWith('data:')) {
      this.lose('image-remote')
      return null
    }
    const got = bytesOfDataUri(uri)
    const kind = got ? sniffImage(got.bytes) : null
    const size = got ? imageSize(got.bytes) : null
    if (got && kind && size && (kind === 'png' || kind === 'jpeg' || kind === 'gif' || kind === 'bmp')) {
      return { type: kind === 'jpeg' ? 'jpg' : kind, data: got.bytes, width: size.width, height: size.height }
    }
    // SVG, WebP, AVIF… : il faut un PNG (seul pour WebP et AVIF, en image de repli pour un SVG).
    const w = size?.width ?? 0
    const h = size?.height ?? 0
    const png = this.opts.rasterize ? await this.opts.rasterize(uri, w, h).catch(() => null) : null
    const pngSize = png ? imageSize(png) : null
    if (!png || !pngSize) {
      this.lose('image-format')
      return null
    }
    if (got && kind === 'svg+xml') return { type: 'svg', data: got.bytes, fallback: png, width: w || pngSize.width, height: h || pngSize.height }
    return { type: 'png', data: png, width: pngSize.width, height: pngSize.height }
  }

  private image(b: BlockOf<'image'>, ctx: Ctx): Paragraph[] {
    const pic = (hasColorAdjust(b.adjust) ? this.pictures.get(pictureKey(b)) : undefined) ?? this.pictures.get(b.src)
    const caption = b.caption.length ? [new Paragraph({ style: 'Caption', children: this.inlines(b.caption, ctx) })] : []
    if (!pic) {
      // L'image n'a pas pu être écrite : son texte de remplacement tient sa place.
      const label = b.alt || (b.src.startsWith('http') ? b.src : '')
      return [new Paragraph({ alignment: b.align === 'left' ? undefined : ALIGN[b.align], children: [new TextRun({ text: `[${label || 'image'}]`, italics: true })] }), ...caption]
    }
    const crop = b.crop ?? { top: 0, right: 0, bottom: 0, left: 0 }
    const natW = pic.width * Math.max(0.01, 1 - (crop.left + crop.right) / 100)
    const natH = pic.height * Math.max(0.01, 1 - (crop.top + crop.bottom) / 100)
    // Largeur en points : celle demandée, sinon la taille naturelle (96 px par pouce), dans la largeur du texte.
    let width = b.width > 0 ? b.width : natW * 0.75
    let height = b.height && b.height > 0 ? b.height : (width * natH) / natW
    if (width > ctx.width && !(b.width > 0 && b.height)) {
      height = (height * ctx.width) / width
      width = ctx.width
    }
    const base = {
      transformation: {
        // En pixels pour la bibliothèque, au 1/9525 près : la taille en points est gardée exacte.
        width: Math.max(1, Math.round(pxOfPt(width) * 9525) / 9525),
        height: Math.max(1, Math.round(pxOfPt(height) * 9525) / 9525),
        ...(b.rotate ? { rotation: b.rotate } : {}),
        ...(b.flip ? { flip: { horizontal: b.flip.includes('h'), vertical: b.flip.includes('v') } } : {}),
      },
      altText: { name: b.alt.slice(0, 80) || 'image', description: b.alt, title: '' },
      ...(b.crop ? { crop: { left: crop.left, top: crop.top, right: crop.right, bottom: crop.bottom } } : {}),
      ...(b.border ? { outline: { type: 'solidFill', solidFillType: 'rgb', value: hexOf(this.hex(b.border)), width: 9525 } } : {}),
      ...(b.wrap !== 'none'
        ? {
            floating: {
              horizontalPosition: { relative: 'column', align: b.wrap },
              verticalPosition: { relative: 'paragraph', offset: 0 },
              wrap: { type: 1, side: 'bothSides' },
              margins: { top: 0, bottom: 91440, left: b.wrap === 'right' ? 152400 : 0, right: b.wrap === 'left' ? 152400 : 0 },
            },
          }
        : {}),
    }
    const options = (pic.type === 'svg' ? { ...base, type: 'svg', data: pic.data, fallback: { type: 'png', data: pic.fallback! } } : { ...base, type: pic.type, data: pic.data }) as unknown as IImageOptions
    return [new Paragraph({ alignment: ALIGN[b.align], keepNext: caption.length ? true : undefined, children: [new ImageRun(options)] }), ...caption]
  }

  // --- blocs ----------------------------------------------------------------------

  private paragraphStyle(style: string | undefined, ctx: Ctx): string | undefined {
    if (style && style !== 'normal') return wordStyleId(style)
    if (ctx.note) return ctx.note === 'foot' ? 'FootnoteText' : 'EndnoteText'
    if (ctx.quote) return STYLE_IDS.quote.id
    return undefined
  }

  blocks(blocks: Block[], ctx: Ctx, nested = true): Kids {
    const out: Kids = []
    // Une liste ne continue que la liste numérotée précédente de son propre conteneur.
    const outer = this.lastNumberInstance
    if (nested) this.lastNumberInstance = null
    try {
      this.blocksInto(blocks, ctx, out)
    } finally {
      if (nested) this.lastNumberInstance = outer
    }
    return out
  }

  /** La lettrine d'un paragraphe : la première lettre dans un cadre (w:framePr dropCap), et le reste du texte. */
  private dropCap(b: Extract<Block, { type: 'paragraph' }>, ctx: Ctx): { letter: Paragraph; rest: Inline[] } | null {
    const i = b.content.findIndex((x) => isRun(x) && !x.deleted && x.text.trim())
    if (i < 0) return null
    const run = b.content[i] as Run
    const lead = run.text.length - run.text.trimStart().length
    const ch = [...run.text.slice(lead)][0]
    const rest = [...b.content.slice(0, i), { ...run, text: run.text.slice(lead + ch.length) }, ...b.content.slice(i + 1)]
    const style = resolveStyle(this.doc.styles, b.style || 'normal')
    const size = run.size ?? style.size ?? 11
    const lines = b.dropCap!
    const lineHeight = size * (b.line ?? style.line ?? 1.15)
    const letter = new Paragraph({
      style: this.paragraphStyle(b.style, ctx),
      keepNext: true,
      frame: { type: 'absolute', position: { x: 0, y: 0 }, anchor: { horizontal: 'text', vertical: 'text' }, wrap: 'around', dropCap: 'drop', lines },
      spacing: { before: 0, after: 0, line: twips(lineHeight * lines), lineRule: 'exact' },
      children: [new TextRun({ ...this.runProps({ ...run, size: undefined }), text: ch, size: Math.round(lineHeight * lines * 0.95 * 2), position: '0pt' } as IRunOptions)],
    } as IParagraphOptions)
    return { letter, rest }
  }

  private blocksInto(blocks: Block[], ctx: Ctx, out: Kids): void {
    for (const b of blocks) {
      switch (b.type) {
        case 'paragraph': {
          // Lettrine : Word la range dans un paragraphe encadré à part, avant le texte.
          const drop = b.dropCap ? this.dropCap(b, ctx) : null
          if (drop) out.push(drop.letter)
          out.push(new Paragraph({ style: this.paragraphStyle(b.style, ctx), ...this.paraProps(b), children: this.inlines(drop ? drop.rest : b.content, ctx) } as IParagraphOptions))
          break
        }
        case 'heading':
          if (ctx.body) this.headingIndex++
          out.push(new Paragraph({ style: `Heading${Math.min(6, Math.max(1, b.level))}`, ...this.paraProps(b), children: this.inlines(b.content, ctx) } as IParagraphOptions))
          break
        case 'list':
          out.push(...this.list(b, ctx))
          break
        case 'quote':
          // Une citation est un style de paragraphe : un titre, une liste ou un tableau n'y restent pas.
          if (b.blocks.some((q) => q.type !== 'paragraph' || (q.style && q.style !== 'normal'))) this.lose('quote-content')
          out.push(...this.blocks(b.blocks, { ...ctx, quote: true, width: ctx.width - 14 }))
          break
        case 'code': {
          if (b.language) this.lose('code-colors')
          out.push(new Paragraph({ style: STYLE_IDS.code.id, children: this.textRuns(b.text, {}, (o) => new TextRun(o)) }))
          break
        }
        case 'table':
          out.push(this.table(b, ctx))
          break
        case 'equation': {
          const n = this.eqNumbers.get(b)
          if (n) {
            // Numérotée : l'équation au centre, son numéro au bord droit (taquets).
            const w = twips(ctx.width)
            out.push(
              new Paragraph({
                style: 'Equation',
                tabStops: [
                  { type: 'center', position: Math.round(w / 2) },
                  { type: 'right', position: w },
                ],
                children: [new TextRun({ children: [new Tab()] }), this.omml(b.tex, false) as unknown as ParagraphChild, new TextRun({ children: [new Tab(), `(${n})`] })],
              }),
            )
          } else out.push(new Paragraph({ style: 'Equation', children: [this.omml(b.tex, true) as unknown as ParagraphChild] }))
          break
        }
        case 'divider':
          out.push(
            new Paragraph({
              spacing: { before: twips(6), after: twips(6) },
              border: { bottom: { style: 'single', size: 6, space: 1, color: hexOf(tint(this.doc.theme.colors.text, 0.32)) } },
            }),
          )
          break
        case 'pagebreak':
          // Dans des colonnes, un saut de page passe à la colonne suivante (comme dans l'application).
          out.push(new Paragraph({ children: [ctx.columns ? new ColumnBreak() : new PageBreak()] }))
          break
        case 'columnbreak':
          if (!ctx.flat) out.push(new Paragraph({ children: [new ColumnBreak()] }))
          break
        case 'columns':
          // Hors du premier niveau (dans une citation), des colonnes n'ont pas d'équivalent : le texte reste, à la suite.
          this.lose('columns-nested')
          out.push(...this.blocks(b.blocks, { ...ctx, flat: true }))
          break
        case 'toc':
          out.push(...this.toc(b))
          break
        case 'figures':
        case 'index':
        case 'authorities':
        case 'bibliography':
          out.push(...this.generated(b, ctx))
          break
        case 'image':
          out.push(...this.image(b, ctx))
          break
        case 'section':
          break
      }
    }
  }

  private toc(b: BlockOf<'toc'>): Kids {
    const entries: { title: string; level: number; page?: number }[] = []
    let i = 0
    walkBlocks(this.doc.blocks, (h) => {
      if (h.type !== 'heading') return
      const page = this.opts.headingPages?.[i++]
      if (h.level <= b.levels) entries.push({ title: runsText(h.content), level: h.level, ...(page ? { page } : {}) })
    })
    const out: Kids = []
    if (b.title) out.push(new Paragraph({ style: 'TOCHeading', children: [new TextRun(b.title)] }))
    // Avec les numéros de page connus, la table est écrite à jour ; sinon elle demande à être mise à jour à l'ouverture.
    const known = entries.length > 0 && entries.every((e) => e.page)
    out.push(new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: `1-${Math.min(9, Math.max(1, b.levels))}`, cachedEntries: entries, beginDirty: !known }))
    return out
  }

  /**
   * Listes générées : table des illustrations (TOC \\c), index (INDEX), table
   * des références (TOA), bibliographie (BIBLIOGRAPHY). Un champ qui couvre ses
   * paragraphes, écrits à jour (Word les recalcule avec F9).
   */
  private generated(b: BlockOf<'figures' | 'index' | 'authorities' | 'bibliography'>, ctx: Ctx): Paragraph[] {
    const out: Paragraph[] = []
    const fr = (this.fieldCtx.locale || 'fr').startsWith('fr')
    const pages = this.opts.refPages
    const width = twips(ctx.width)
    const dots = [{ type: 'right' as const, position: width, leader: 'dot' as const }]
    if (b.title) out.push(new Paragraph({ style: 'TOCHeading', children: [new TextRun(b.title)] }))
    /** Paragraphes du résultat ; le champ s'ouvre dans le premier et se ferme dans le dernier. */
    const field = (code: string, paras: { children: ParagraphChild[]; opts?: Partial<IParagraphOptions> }[], empty: string) => {
      const list = paras.length ? paras : [{ children: [new TextRun(empty)] }]
      const [begin, instr, sep, , end] = this.fieldChildren(code, '')
      list.forEach((p, i) => {
        const children: ParagraphChild[] = []
        if (i === 0) children.push(new TextRun({ children: [begin, instr, sep] } as IRunOptions))
        children.push(...p.children)
        if (i === list.length - 1) children.push(new TextRun({ children: [end] } as IRunOptions))
        out.push(new Paragraph({ ...(p.opts ?? {}), children } as IParagraphOptions))
      })
    }
    const pageText = (list: string[]) => [...new Set(list.filter(Boolean))].join(', ')
    if (b.type === 'figures') {
      const items = this.refs.captions.map((c, i) => ({ ...c, page: pages?.captions[i] ?? '' })).filter((c) => c.label === b.label)
      field(
        `TOC \\h \\z \\c "${this.seqName(b.label)}"`,
        items.map((c) => ({ children: [new TextRun({ children: [c.text, new Tab(), c.page || ' '] } as IRunOptions)], opts: { tabStops: dots } })),
        fr ? 'Aucune entrée de table d’illustration n’a été trouvée.' : 'No table of figures entries found.',
      )
    } else if (b.type === 'index') {
      const coll = new Intl.Collator(this.doc.meta.lang || this.fieldCtx.locale, { sensitivity: 'base', numeric: true })
      const byTerm = new Map<string, { term: string; pages: string[]; see: string; subs: Map<string, { sub: string; pages: string[]; see: string }> }>()
      this.refs.entries.forEach((e, i) => {
        if (e.authority) return
        const k = e.term.toLocaleLowerCase()
        const cur = byTerm.get(k) ?? { term: e.term, pages: [] as string[], see: '', subs: new Map<string, { sub: string; pages: string[]; see: string }>() }
        const page = pages?.entries[i] ?? ''
        if (e.sub) {
          const sk = e.sub.toLocaleLowerCase()
          const sub = cur.subs.get(sk) ?? { sub: e.sub, pages: [] as string[], see: '' }
          if (e.see) sub.see = e.see
          else sub.pages.push(page)
          cur.subs.set(sk, sub)
        } else if (e.see) cur.see = e.see
        else cur.pages.push(page)
        byTerm.set(k, cur)
      })
      const see = fr ? 'Voir' : 'See'
      const line = (text: string, list: string[], seeText: string, level: number) => ({
        children: [new TextRun(`${text}${seeText ? `. ${see} ${seeText}` : pageText(list) ? `, ${pageText(list)}` : ''}`)],
        opts: { indent: { left: twips(14 * (level + 1)), hanging: twips(14) } },
      })
      const paras = [...byTerm.values()]
        .sort((a, c) => coll.compare(a.term, c.term))
        .flatMap((e) => [line(e.term, e.pages, e.see, 0), ...[...e.subs.values()].sort((a, c) => coll.compare(a.sub, c.sub)).map((sb) => line(sb.sub, sb.pages, sb.see, 1))])
      field(`INDEX \\c "${b.columns}" \\z "${this.lcid}"`, paras, fr ? 'Aucune entrée d’index n’a été trouvée.' : 'No index entries found.')
    } else if (b.type === 'authorities') {
      const cats = b.category === 'all' ? AUTHORITY_CATEGORIES.filter((c) => this.refs.entries.some((e) => e.authority === c)) : [b.category]
      const names: Record<string, [string, string]> = {
        cases: ['Jurisprudence', 'Cases'],
        statutes: ['Lois', 'Statutes'],
        other: ['Autres références', 'Other Authorities'],
        rules: ['Règlements', 'Rules'],
        treatises: ['Traités', 'Treatises'],
        regulations: ['Décrets', 'Regulations'],
        constitution: ['Dispositions constitutionnelles', 'Constitutional Provisions'],
      }
      if (!cats.length) field('TOA \\h \\c "1" \\p', [], fr ? 'Aucune entrée de table des références n’a été trouvée.' : 'No table of authorities entries found.')
      for (const c of cats) {
        if (b.category === 'all') out.push(new Paragraph({ style: 'TOCHeading', children: [new TextRun(names[c][fr ? 0 : 1])] }))
        const seen = new Map<string, string[]>()
        this.refs.entries.forEach((e, i) => {
          if (e.authority !== c) return
          seen.set(e.term, [...(seen.get(e.term) ?? []), pages?.entries[i] ?? ''])
        })
        const paras = [...seen].map(([term, list]) => ({ children: [new TextRun({ children: [term, new Tab(), pageText(list).split(', ').length >= 5 ? 'passim' : pageText(list) || ' '] } as IRunOptions)], opts: { tabStops: dots } }))
        field(`TOA \\h \\c "${AUTHORITY_CATEGORIES.indexOf(c) + 1}" \\p`, paras, fr ? 'Aucune entrée de table des références n’a été trouvée.' : 'No table of authorities entries found.')
      }
    } else {
      const ctxc = this.refs.cite
      const ids = b.all ? (this.doc.sources ?? []).map((s) => s.id) : this.refs.cited
      const paras = bibliographyOrder(ctxc, ids).map((src) => {
        const label = entryLabel(ctxc, src)
        const runs: ParagraphChild[] = []
        if (label) runs.push(new TextRun({ children: [label, new Tab()] } as IRunOptions))
        for (const p of bibliographyEntry(ctxc, src)) runs.push(new TextRun({ text: p.text, ...(p.italic ? { italics: true } : {}) }))
        return { children: runs, opts: { indent: { left: twips(label ? 30 : 24), hanging: twips(label ? 30 : 24) }, spacing: { after: twips(6) } } }
      })
      field(`BIBLIOGRAPHY \\l ${this.lcid}`, paras, fr ? 'Aucune source dans le document actuel.' : 'There are no sources in the current document.')
    }
    return out
  }

  // --- commentaires ---------------------------------------------------------------

  private prepareComments(): void {
    let n = 0
    const para = (text: string) => text.split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] }))
    // Sans date connue, celle de l'export (un commentaire a toujours une date dans un fichier .docx).
    const date = (d: string) => (d && !Number.isNaN(Date.parse(d)) ? new Date(d) : this.fieldCtx.now)
    const initials = (a: string) =>
      a
        .split(/\s+/)
        .map((w) => w[0] ?? '')
        .join('')
        .slice(0, 3)
        .toUpperCase()
    for (const t of this.doc.comments) {
      const root = n++
      const ids = [root]
      this.comments.push({ id: root, author: t.author, initials: initials(t.author), date: date(t.date), children: para(t.text), resolved: t.resolved })
      for (const r of t.replies) {
        const id = n++
        ids.push(id)
        this.comments.push({ id, author: r.author, initials: initials(r.author), date: date(r.date), children: para(r.text), parentId: root })
      }
      this.threadIds.set(t.id, ids)
    }
    walkInlines(this.doc.blocks, (x) => {
      for (const id of (x as Marks).comments ?? []) if (this.threadIds.has(id)) this.remaining.set(id, (this.remaining.get(id) ?? 0) + 1)
    })
  }

  /** Les fils dont le texte a disparu : ancrés au début du document, pour ne pas les perdre. */
  private orphanAnchors(): ParagraphChild[] {
    const out: ParagraphChild[] = []
    for (const [id, nums] of this.threadIds) {
      if (this.remaining.has(id)) continue
      this.lose('comment-orphan')
      for (const n of nums) out.push(new CommentRangeStart(n))
      for (const n of nums) out.push(new CommentRangeEnd(n))
      for (const n of nums) out.push(new TextRun({ children: [new CommentReference(n)] }))
    }
    return out
  }

  // --- styles ---------------------------------------------------------------------

  private styleOptions(id: string): IParagraphStyleOptions | null {
    const def = styleDef(this.doc.styles, id)
    if (!def) return null
    const known = (s: string | undefined) => (s && styleDef(this.doc.styles, s) ? wordStyleId(s) : undefined)
    const run = this.runProps(def)
    const paragraph = this.paraProps(def)
    if (id === 'quote') {
      // La mise en forme d'une citation dans l'application : retrait et filet à gauche.
      paragraph.indent = { ...((paragraph.indent as object) ?? {}), left: twips(((def.indent?.left ?? 0) as number) + 12) }
      if (!def.border) paragraph.border = { left: { style: 'single', size: 18, space: 8, color: hexOf(this.doc.theme.colors.accent2) } }
    }
    if (id === 'code') {
      if (!def.shading) paragraph.shading = { type: 'clear', color: 'auto', fill: hexOf(this.doc.theme.code.background) }
      if (!def.color) run.color = hexOf(this.doc.theme.code.text)
      run.noProof = true
    }
    const level = /^heading([1-6])$/.exec(id)
    if (level) paragraph.outlineLevel = Number(level[1]) - 1
    if (id === 'normal' && this.doc.meta.lang) run.language = { value: this.doc.meta.lang }
    return {
      id: wordStyleId(id),
      name: isBuiltinStyle(id) ? STYLE_IDS[id].name : def.name || id,
      basedOn: id === 'normal' ? undefined : (known(def.basedOn) ?? 'Normal'),
      next: known(def.next) ?? (id === 'normal' ? undefined : 'Normal'),
      quickFormat: true,
      uiPriority: id === 'normal' ? 0 : level ? 9 : undefined,
      run,
      paragraph,
    } as IParagraphStyleOptions
  }

  private styles() {
    const ids = [...BUILTIN_STYLE_IDS, ...Object.keys(this.doc.styles).filter((id) => !isBuiltinStyle(id))]
    const paragraphStyles = ids.map((id) => this.styleOptions(id)).filter((s): s is IParagraphStyleOptions => !!s)
    const note = paragraphStyles.find((s) => s.id === 'FootnoteText')
    if (note) paragraphStyles.push({ ...note, id: 'EndnoteText', name: 'endnote text' })
    const h2 = styleDef(this.doc.styles, 'heading2') ?? {}
    paragraphStyles.push(
      { id: 'Equation', name: 'Equation', basedOn: 'Normal', next: 'Normal', paragraph: { spacing: { before: twips(6), after: twips(6) }, keepLines: true } },
      { id: 'ListParagraph', name: 'List Paragraph', basedOn: 'Normal', quickFormat: true, paragraph: { spacing: { after: twips(2.2) }, contextualSpacing: true } },
      { id: 'TOCHeading', name: 'TOC Heading', basedOn: 'Normal', next: 'Normal', run: this.runProps({ font: h2.font, size: h2.size, bold: h2.bold, color: h2.color }), paragraph: { keepNext: true, spacing: { before: twips(12), after: twips(6) } } } as IParagraphStyleOptions,
    )
    for (let l = 1; l <= 6; l++) {
      paragraphStyles.push({ id: `TOC${l}`, name: `toc ${l}`, basedOn: 'Normal', next: 'Normal', paragraph: { indent: { left: twips(14 * (l - 1)) }, spacing: { after: twips(3) } } })
    }
    const mono = this.family('mono')
    const tableStyles = (['grid', 'lines', 'zebra', 'boxed', 'minimal'] as const).map((s) =>
      ImportedXmlComponent.fromXmlString(
        `<w:style xmlns:w="${W_NS}" w:type="table" w:customStyle="1" w:styleId="${tableStyleId(s)}"><w:name w:val="${escapeXml(`Folio ${s}`)}"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="59"/><w:tblPr><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>`,
      ),
    )
    return {
      paragraphStyles,
      characterStyles: [
        { id: INLINE_CODE_STYLE, name: 'Inline Code', basedOn: 'DefaultParagraphFont', quickFormat: true, run: { font: mono, noProof: true, shading: { type: 'clear', color: 'auto', fill: hexOf(this.doc.theme.code.background) } } },
        { id: 'Hyperlink', name: 'Hyperlink', basedOn: 'DefaultParagraphFont', run: { color: { theme: 'hyperlink' }, underline: { type: 'single' } } },
      ],
      importedStyles: tableStyles,
    }
  }

  // --- sections -------------------------------------------------------------------

  private hf(set: HeaderSet | undefined, make: (children: (Paragraph | Table)[]) => Header | Footer, withFirst: boolean, withEven: boolean) {
    if (!set) return undefined
    const part = (blocks: Block[]) =>
      make(this.blocks(blocks, { hf: true, width: this.textWidth }).filter((k): k is Paragraph | Table => !(k instanceof TableOfContents)))
    // Un en-tête de première page ou de pages paires déjà rédigé est gardé, même s'il ne sert pas pour l'instant.
    const out: Record<string, Header | Footer> = { default: part(set.default) }
    if (withFirst || set.first.length) out.first = part(set.first)
    if (withEven || set.even.length) out.even = part(set.even)
    return out
  }

  private noteProps(k: NoteKindSettings) {
    return {
      numberFormat: { type: k.format === 'symbols' ? 'chicago' : NUMBER_FORMAT_TO_WORD[k.format] },
      start: k.start,
      restart: k.restart === 'section' ? 'eachSect' : k.restart === 'page' ? 'eachPage' : 'continuous',
    }
  }

  private pageProps(p: PageSetup, numbers?: { start?: number; format?: string }) {
    const land = p.orientation === 'landscape'
    const border = p.border ? { style: 'single', size: 6, space: 24, color: this.color(p.border) } : null
    return {
      size: { width: twipsOfMm(p.width), height: twipsOfMm(p.height), orientation: land ? 'landscape' : 'portrait' },
      margin: {
        top: twipsOfMm(p.margins.top),
        right: twipsOfMm(p.margins.right),
        bottom: twipsOfMm(p.margins.bottom),
        left: twipsOfMm(p.margins.left),
        header: twipsOfMm(p.header),
        footer: twipsOfMm(p.footer),
        gutter: 0,
      },
      ...(numbers && (numbers.start !== undefined || numbers.format) ? { pageNumbers: { ...(numbers.start !== undefined ? { start: numbers.start } : {}), ...(numbers.format ? { formatType: numbers.format } : {}) } } : {}),
      ...(border ? { borders: { pageBorders: { offsetFrom: 'page' }, pageBorderTop: border, pageBorderRight: border, pageBorderBottom: border, pageBorderLeft: border } } : {}),
    }
  }

  private sections(): ISectionOptions[] {
    const d = this.doc
    /** Mise en page de la section courante (une section peut changer de format, d'orientation, de marges). */
    let page: PageSetup = d.page
    const body: Ctx = { body: true, width: this.textWidth }
    const out: ISectionOptions[] = []
    const notes = { footnoteProperties: this.noteProps(d.notes.foot), endnoteProperties: this.noteProps(d.notes.end) }
    let titlePage = d.page.firstPage
    let props: Record<string, unknown> = {
      page: this.pageProps(d.page, { start: d.page.numberStart !== 1 ? d.page.numberStart : undefined, format: d.page.numberFormat !== 'decimal' ? NUMBER_FORMAT_TO_WORD[d.page.numberFormat] : undefined }),
      titlePage,
      ...notes,
    }
    let headers = this.hf(d.headers, (c) => new Header({ children: c }), d.page.firstPage, d.page.evenOdd)
    let footers = this.hf(d.footers, (c) => new Footer({ children: c }), d.page.firstPage, d.page.evenOdd)
    let children: Kids = []
    /** Un saut de section vient d'être posé : sa section existe même si rien ne le suit. */
    let pending = false
    const push = () => {
      pending = false
      if (!children.length && out.length) return
      out.push({ properties: props, headers, footers, children } as ISectionOptions)
      children = []
      headers = undefined
      footers = undefined
    }
    /** La suite reprend la mise en page courante, sans saut de page. */
    const continuous = () => {
      props = { ...props, type: 'continuous', column: undefined, page: this.pageProps(page) }
    }
    d.blocks.forEach((b, index) => {
      if (b.type === 'section' && b.page) {
        page = { ...page, ...b.page, margins: { ...b.page.margins } }
        body.width = pageTextWidth(page)
      }
      if (b.type === 'section' && index === 0) {
        // Un saut de section tout au début n'ouvre pas de page : ses réglages sont ceux de la première section.
        if (b.firstPage !== undefined) titlePage = b.firstPage
        const start = b.numberStart ?? (d.page.numberStart !== 1 ? d.page.numberStart : undefined)
        const format = b.numberFormat ?? d.page.numberFormat
        props = { page: this.pageProps(page, { start, format: format !== 'decimal' ? NUMBER_FORMAT_TO_WORD[format] : undefined }), titlePage, ...notes }
        if (b.headers) headers = this.hf(b.headers, (c) => new Header({ children: c }), titlePage, d.page.evenOdd)
        if (b.footers) footers = this.hf(b.footers, (c) => new Footer({ children: c }), titlePage, d.page.evenOdd)
      } else if (b.type === 'section') {
        if (children.length || !out.length) push()
        if (b.firstPage !== undefined) titlePage = b.firstPage
        props = {
          type: b.start === 'odd' ? 'oddPage' : b.start === 'even' ? 'evenPage' : 'nextPage',
          page: this.pageProps(page, { start: b.numberStart, format: b.numberFormat ? NUMBER_FORMAT_TO_WORD[b.numberFormat] : undefined }),
          titlePage,
          ...notes,
        }
        headers = this.hf(b.headers, (c) => new Header({ children: c }), titlePage, d.page.evenOdd)
        footers = this.hf(b.footers, (c) => new Footer({ children: c }), titlePage, d.page.evenOdd)
        pending = true
      } else if (b.type === 'columns') {
        const before = { props, headers, footers }
        if (children.length) {
          push()
          continuous()
        }
        // Juste après un saut de section (ou en tête de document), les colonnes sont celles de cette section.
        const opening = !out.length || pending
        props = { ...props, ...(opening ? {} : { type: 'continuous' }), column: { count: b.count, space: twips(b.gap), separate: b.rule, equalWidth: true } }
        if (opening) {
          headers = before.headers
          footers = before.footers
        }
        children = this.blocks(b.blocks, { ...body, columns: true })
        if (!children.length) children = [new Paragraph({})]
        push()
        continuous()
      } else children.push(...this.blocks([b], body, false))
    })
    if (children.length || !out.length || pending) {
      if (!children.length) children = [new Paragraph({})]
      push()
    }
    return out
  }

  // --- assemblage -----------------------------------------------------------------

  async run(): Promise<ExportResult> {
    const d = this.doc
    await this.preparePictures()
    this.prepareComments()
    if (d.fonts.length) this.lose('font-embedded')
    const sections = this.sections()
    const orphans = this.orphanAnchors()
    if (orphans.length) {
      const first = sections[0]
      sections[0] = { ...first, children: [new Paragraph({ children: orphans }), ...first.children] }
    }
    const t = d.theme
    const custom = [{ name: 'Generator', value: `Folio Pages ${this.opts.version ?? ''}`.trim() }]
    if (d.meta.organization) custom.push({ name: 'Organization', value: d.meta.organization })
    const file = new Document({
      title: d.meta.title || undefined,
      subject: d.meta.subject || undefined,
      creator: d.meta.author,
      lastModifiedBy: d.meta.author,
      keywords: d.meta.keywords.length ? d.meta.keywords.join(', ') : undefined,
      customProperties: custom,
      styles: this.styles(),
      numbering: { config: this.numbering },
      footnotes: this.footnotes,
      endnotes: this.endnotes,
      comments: this.comments.length ? { children: this.comments } : undefined,
      features: { trackRevisions: d.trackChanges || undefined },
      ...(d.hyphenate ? { hyphenation: { autoHyphenation: true } } : {}),
      evenAndOddHeaderAndFooters: d.page.evenOdd || undefined,
      background: d.page.background ? { color: hexOf(this.hex(d.page.background)) } : undefined,
      theme: {
        name: `Folio ${t.name}`,
        colors: {
          dark1: hexOf(t.colors.text),
          light1: 'FFFFFF',
          accent1: hexOf(t.colors.accent1),
          accent2: hexOf(t.colors.accent2),
          accent3: hexOf(t.colors.accent3),
          accent4: hexOf(t.colors.accent4),
          accent5: hexOf(t.colors.accent5),
          accent6: hexOf(t.colors.accent6),
          hyperlink: hexOf(t.colors.accent1),
          followedHyperlink: hexOf(t.colors.accent5),
        },
        fonts: { headings: this.family('heading'), body: this.family('body') },
      },
      sections,
    } as ConstructorParameters<typeof Document>[0])
    let bytes = new Uint8Array(await Packer.toArrayBuffer(file))
    // Nos sources (équations exactes, liste de destinataires) dans une partie personnalisée.
    const refs = d.sources?.length || this.xrefShows.length ? { sources: d.sources ?? [], citationStyle: d.citationStyle ?? 'apa', xrefShows: this.xrefShows } : undefined
    if (this.mathSources.length || d.mailMerge || refs) bytes = withMathSources(bytes, this.mathSources, d.mailMerge, refs)
    if (d.sources?.length) bytes = withWordSources(bytes, d.sources, d.citationStyle ?? 'apa')
    bytes = withTextEffects(bytes)
    if (d.watermark) bytes = withWatermark(bytes, d.watermark, hexOf(this.hex(d.watermark.color)), d.watermark.image ? d.assets[d.watermark.image.slice(6)] : undefined, this.family('heading'))
    return { bytes, losses: [...this.losses].map(([code, count]) => ({ code, count })) }
  }
}

/**
 * Filigrane : une forme VML dans chaque en-tête (c'est ainsi que Word range les
 * siens : texte « WordArt » en diagonale, ou image délavée), centrée sur la page.
 */
export function withWatermark(bytes: Uint8Array, w: import('../format/types').Watermark, color: string, image: string | undefined, font: string): Uint8Array {
  const files = unzipSync(bytes)
  const headers = Object.keys(files).filter((n) => /^word\/header\d+\.xml$/.test(n))
  if (!headers.length) return bytes
  const opacity = (w.opacity / 100).toFixed(2)
  let media = ''
  let mime = ''
  if (image) {
    const m = /^data:(image\/(png|jpeg|gif));base64,(.*)$/s.exec(image)
    if (!m) return bytes
    mime = m[2] === 'jpeg' ? 'jpeg' : m[2]
    media = `word/media/folio-watermark.${mime === 'jpeg' ? 'jpg' : mime}`
    files[media] = Uint8Array.from(atob(m[3].replace(/\s/g, '')), (c) => c.charCodeAt(0))
    let types = strFromU8(files['[Content_Types].xml'])
    const ext = mime === 'jpeg' ? 'jpg' : mime
    if (!new RegExp(`Extension="${ext}"`, 'i').test(types)) types = types.replace('</Types>', () => `<Default Extension="${ext}" ContentType="image/${mime}"/></Types>`)
    files['[Content_Types].xml'] = strToU8(types)
  }
  const width = 450
  headers.forEach((name, i) => {
    let shape: string
    if (image) {
      const rels = name.replace('word/', 'word/_rels/') + '.rels'
      const existing = files[rels] ? strFromU8(files[rels]) : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
      files[rels] = strToU8(existing.replace('</Relationships>', () => `<Relationship Id="rIdFolioWatermark" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${media.replace('word/', '')}"/></Relationships>`))
      const wpt = Math.round((width * w.scale) / 100)
      shape = `<v:shape id="FolioWatermark${i + 1}" o:spid="_x0000_s${2049 + i}" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:0;width:${wpt}pt;height:${wpt}pt;z-index:-251657216;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f"><v:imagedata r:id="rIdFolioWatermark" o:title=""${w.opacity < 100 ? ` gain="${Math.round(65536 * (0.3 + w.opacity / 143))}f" blacklevel="${Math.round(65536 * (0.5 - w.opacity / 200))}f"` : ''}/><w10:wrap anchorx="margin" anchory="margin"/></v:shape>`
    } else {
      const text = (w.text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
      const chars = Math.max(1, [...(w.text ?? '')].length)
      const wpt = w.size ? Math.min(width * 1.4, chars * w.size * 0.62) : width
      const hpt = Math.round(w.size ? w.size : Math.min(150, (wpt / chars) * 1.6))
      shape =
        '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>' +
        `<v:shape id="FolioWatermark${i + 1}" o:spid="_x0000_s${2049 + i}" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:${Math.round(wpt)}pt;height:${hpt}pt;${w.diagonal ? 'rotation:315;' : ''}z-index:-251657216;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="#${color}" stroked="f"><v:fill opacity="${opacity}"/><v:textpath style="font-family:&quot;${font.replace(/["&<]/g, '')}&quot;;font-size:1pt" string="${text}"/><w10:wrap anchorx="margin" anchory="margin"/></v:shape>`
    }
    const para = `<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:pict>${shape}</w:pict></w:r></w:p>`
    let xml = strFromU8(files[name])
    const ns: [string, string][] = [
      ['v', 'urn:schemas-microsoft-com:vml'],
      ['o', 'urn:schemas-microsoft-com:office:office'],
      ['w10', 'urn:schemas-microsoft-com:office:word'],
      ['r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'],
    ]
    // L'en-tête vide s'écrit <w:hdr …/> : on l'ouvre pour y mettre le filigrane.
    xml = xml.replace(/<w:hdr((?:\s[^>]*?)?)(\/?)>/, (_m, attrs: string, selfClosing: string) => {
      let a = attrs
      for (const [p, uri] of ns) if (!new RegExp(`xmlns:${p}=`).test(a)) a += ` xmlns:${p}="${uri}"`
      return selfClosing ? `<w:hdr${a}>${para}</w:hdr>` : `<w:hdr${a}>${para}`
    })
    files[name] = strToU8(xml)
  })
  return zipSync(files, { level: 6 })
}

/** Clé d'une image retouchée : sa source et ses retouches de couleur. */
const pictureKey = (b: BlockOf<'image'>) => `${b.src}|${JSON.stringify(b.adjust ?? {})}`

/** Éléments de w:rPr qui viennent après w:outline et w:shadow (ordre du schéma OOXML). */
const AFTER_SHADOW = new Set(['w:emboss', 'w:imprint', 'w:noProof', 'w:snapToGrid', 'w:vanish', 'w:webHidden', 'w:color', 'w:spacing', 'w:w', 'w:kern', 'w:position', 'w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:effect', 'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout', 'w:specVanish', 'w:oMath'])

/**
 * Contour (w:outline), ombre (w:shadow) et halo (w14:glow) : le module docx ne
 * sait pas les écrire. Chaque passage concerné porte un style repère
 * « FolioFx… », remplacé ici par les vrais éléments, à leur place dans w:rPr.
 */
export function withTextEffects(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes)
  let changed = false
  for (const name of Object.keys(files)) {
    if (!/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)) continue
    let xml = strFromU8(files[name])
    if (!xml.includes('FolioFx')) continue
    xml = xml.replace(/<w:rPr>((?:(?!<\/w:rPr>)[\s\S])*?)<w:rStyle w:val="FolioFx(O?)(S?)(?:G([0-9A-Fa-f]{6}))?"\/>((?:(?!<\/w:rPr>)[\s\S])*?)<\/w:rPr>/g, (_all, before: string, o: string, sh: string, glow: string | undefined, after: string) => {
      const rest = before + after
      const fx = `${o ? '<w:outline/>' : ''}${sh ? '<w:shadow/>' : ''}`
      // Avant le premier élément qui doit suivre w:shadow.
      let at = rest.length
      for (const m of rest.matchAll(/<(w:[A-Za-z]+)[\s/>]/g)) {
        if (AFTER_SHADOW.has(m[1])) {
          at = m.index!
          break
        }
      }
      const glowXml = glow ? `<w14:glow w14:rad="63500"><w14:srgbClr w14:val="${glow.toUpperCase()}"><w14:alpha w14:val="40000"/></w14:srgbClr></w14:glow>` : ''
      return `<w:rPr>${rest.slice(0, at)}${fx}${rest.slice(at)}${glowXml}</w:rPr>`
    })
    // L'espace de noms de Word 2010, s'il manque, pour le halo.
    if (xml.includes('<w14:glow') && !/xmlns:w14=/.test(xml.slice(0, 2000))) xml = xml.replace(/<w:(document|hdr|ftr|footnotes|endnotes) /, (m) => `${m}xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" `)
    files[name] = strToU8(xml)
    changed = true
  }
  return changed ? zipSync(files, { level: 6 }) : bytes
}

/**
 * Sources LaTeX des équations, dans une partie XML personnalisée (customXml) :
 * Word et LibreOffice la gardent sans l'afficher. À l'import d'un fichier
 * Folio Pages, chaque équation dont l'OMML n'a pas changé (même empreinte)
 * retrouve sa source exacte (macros, \label, mise en forme du texte).
 */
function withMathSources(bytes: Uint8Array, sources: { print: string; tex: string }[], mailMerge?: unknown, refs?: unknown): Uint8Array {
  const files = unzipSync(bytes)
  let n = 1
  while (files[`customXml/item${n}.xml`]) n++
  const item = `customXml/item${n}.xml`
  const props = `customXml/itemProps${n}.xml`
  const body = sources.map((s) => `<eq print="${escapeXml(s.print)}">${escapeXml(s.tex)}</eq>`).join('') + (mailMerge ? `<mailMerge>${escapeXml(JSON.stringify(mailMerge))}</mailMerge>` : '') + (refs ? `<refs>${escapeXml(JSON.stringify(refs))}</refs>` : '')
  files[item] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<equations xmlns="${MATH_PART_NS}">${body}</equations>`)
  const guid = '{F0110A6E-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0').toUpperCase() + '}'
  files[props] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<ds:datastoreItem ds:itemID="${guid}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="${MATH_PART_NS}"/></ds:schemaRefs></ds:datastoreItem>`)
  files[`customXml/_rels/item${n}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps${n}.xml"/></Relationships>`)
  const relsPath = 'word/_rels/document.xml.rels'
  const rels = strFromU8(files[relsPath])
  files[relsPath] = strToU8(rels.replace('</Relationships>', () => `<Relationship Id="rIdFolioEquations" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item${n}.xml"/></Relationships>`))
  let types = strFromU8(files['[Content_Types].xml'])
  if (!/Extension="xml"/i.test(types)) types = types.replace('</Types>', () => '<Default Extension="xml" ContentType="application/xml"/></Types>')
  types = types.replace('</Types>', () => `<Override PartName="/${props}" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>`)
  files['[Content_Types].xml'] = strToU8(types)
  return zipSync(files, { level: 6 })
}

const BIB_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography'
const WORD_SOURCE_TYPES: Record<string, string> = {
  book: 'Book',
  article: 'JournalArticle',
  chapter: 'BookSection',
  website: 'InternetSite',
  report: 'Report',
  thesis: 'Report',
  conference: 'ConferenceProceedings',
  film: 'Film',
  interview: 'Interview',
  other: 'Misc',
}
const WORD_BIB_STYLES: Record<string, [string, string]> = {
  apa: ['\\APASixthEditionOfficeOnline.xsl', 'APA'],
  mla: ['\\MLASeventhEditionOfficeOnline.xsl', 'MLA'],
  chicago: ['\\Chicago.xsl', 'Chicago'],
  harvard: ['\\HarvardAnglia2008OfficeOnline.xsl', 'Harvard - Anglia'],
  ieee: ['\\IEEE2006OfficeOnline.xsl', 'IEEE'],
  iso690: ['\\ISO690.xsl', 'ISO 690 - First Element and Date'],
}

/** Sources au format du gestionnaire de sources de Word (customXml « b:Sources »). */
export function wordSourcesXml(sources: import('../format/types').Source[], style: string): string {
  const el = (name: string, v: string | undefined) => (v ? `<b:${name}>${escapeXml(v)}</b:${name}>` : '')
  const people = (list: string[] | undefined) =>
    (list ?? [])
      .map((a) => {
        const i = a.indexOf(',')
        return i < 0 ? '' : `<b:Person><b:Last>${escapeXml(a.slice(0, i).trim())}</b:Last><b:First>${escapeXml(a.slice(i + 1).trim())}</b:First></b:Person>`
      })
      .join('')
  const authorBlock = (s: import('../format/types').Source) => {
    const corporate = s.authors.find((a) => !a.includes(','))
    const persons = people(s.authors)
    const parts: string[] = []
    if (persons) parts.push(`<b:Author><b:NameList>${persons}</b:NameList></b:Author>`)
    else if (corporate) parts.push(`<b:Author><b:Corporate>${escapeXml(corporate)}</b:Corporate></b:Author>`)
    const eds = people(s.editors)
    if (eds) parts.push(`<b:Editor><b:NameList>${eds}</b:NameList></b:Editor>`)
    return parts.length ? `<b:Author>${parts.join('')}</b:Author>` : ''
  }
  const body = sources
    .map((s, i) => {
      const container = s.type === 'article' ? el('JournalName', s.container) : s.type === 'chapter' ? el('BookTitle', s.container) : s.type === 'website' ? el('InternetSiteTitle', s.container) : s.type === 'conference' ? el('ConferenceName', s.container) : el('PeriodicalTitle', s.container)
      const acc = s.accessed ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s.accessed) : null
      return (
        `<b:Source><b:Tag>${escapeXml(s.id)}</b:Tag><b:SourceType>${WORD_SOURCE_TYPES[s.type] ?? 'Misc'}</b:SourceType>` +
        `<b:Guid>{F0110A6E-0000-4000-8000-${String(i + 1).padStart(12, '0')}}</b:Guid>${authorBlock(s)}${el('Title', s.title)}${container}` +
        `${el('Year', /\d{4}/.exec(s.year ?? '')?.[0] ?? s.year)}${el('Publisher', s.publisher)}${el('City', s.place)}${el('Volume', s.volume)}${el('Issue', s.issue)}${el('Pages', s.pages)}` +
        `${el('Edition', s.edition)}${el('URL', s.url)}${el('DOI', s.doi)}${el('StandardNumber', s.isbn)}${s.type === 'thesis' ? el('ThesisType', 'Thesis') : ''}` +
        `${acc ? `${el('YearAccessed', acc[1])}${el('MonthAccessed', acc[2])}${el('DayAccessed', acc[3])}` : ''}</b:Source>`
      )
    })
    .join('')
  const [xsl, name] = WORD_BIB_STYLES[style] ?? WORD_BIB_STYLES.apa
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<b:Sources SelectedStyle="${escapeXml(xsl)}" StyleName="${escapeXml(name)}" Version="6" xmlns:b="${BIB_NS}" xmlns="${BIB_NS}">${body}</b:Sources>`
}

function withWordSources(bytes: Uint8Array, sources: import('../format/types').Source[], style: string): Uint8Array {
  const files = unzipSync(bytes)
  let n = 1
  while (files[`customXml/item${n}.xml`]) n++
  const item = `customXml/item${n}.xml`
  const props = `customXml/itemProps${n}.xml`
  files[item] = strToU8(wordSourcesXml(sources, style))
  files[props] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<ds:datastoreItem ds:itemID="{F0110A6E-0000-4000-8000-B1B100000001}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="${BIB_NS}"/></ds:schemaRefs></ds:datastoreItem>`)
  files[`customXml/_rels/item${n}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps${n}.xml"/></Relationships>`)
  const relsPath = 'word/_rels/document.xml.rels'
  files[relsPath] = strToU8(strFromU8(files[relsPath]).replace('</Relationships>', () => `<Relationship Id="rIdFolioSources" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item${n}.xml"/></Relationships>`))
  let types = strFromU8(files['[Content_Types].xml'])
  if (!/Extension="xml"/i.test(types)) types = types.replace('</Types>', () => '<Default Extension="xml" ContentType="application/xml"/></Types>')
  types = types.replace('</Types>', () => `<Override PartName="/${props}" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>`)
  files['[Content_Types].xml'] = strToU8(types)
  return zipSync(files, { level: 6 })
}

/** Largeur du texte d'une page, en points. */
export function pageTextWidth(p: PageSetup): number {
  const [w] = p.orientation === 'landscape' ? [p.height, p.width] : [p.width, p.height]
  return Math.max(72, ((w - p.margins.left - p.margins.right) * 72) / 25.4)
}

/** Tous les blocs du document, en-têtes et pieds de page compris. */
function allBlocks(d: FolioDoc): Block[] {
  const sets = [d.headers, d.footers]
  for (const b of d.blocks) if (b.type === 'section') sets.push(...[b.headers, b.footers].filter((s): s is HeaderSet => !!s))
  return [...d.blocks, ...sets.flatMap((s) => [...s.default, ...s.first, ...s.even])]
}

/** Parcourt les blocs à toute profondeur (citations, colonnes, cellules, notes). */
export function walkBlocks(blocks: Block[], fn: (b: Block) => void): void {
  for (const b of blocks) {
    fn(b)
    if (b.type === 'quote' || b.type === 'columns') walkBlocks(b.blocks, fn)
    else if (b.type === 'table') for (const row of b.rows) for (const c of row) walkBlocks(c.blocks, fn)
    else if (b.type === 'paragraph' || b.type === 'heading') {
      for (const x of b.content) if (!isRun(x) && x.type === 'note') walkBlocks(x.blocks, fn)
    } else if (b.type === 'list') {
      for (const it of b.items) for (const x of it.content) if (!isRun(x) && x.type === 'note') walkBlocks(x.blocks, fn)
    }
  }
}

/** Parcourt les éléments en ligne du corps, dans l'ordre où l'export les écrit (hors notes). */
export function walkInlines(blocks: Block[], fn: (x: Inline) => void): void {
  for (const b of blocks) {
    if (b.type === 'paragraph' || b.type === 'heading') b.content.forEach(fn)
    else if (b.type === 'list') for (const it of b.items) it.content.forEach(fn)
    else if (b.type === 'quote' || b.type === 'columns') walkInlines(b.blocks, fn)
    else if (b.type === 'table') for (const row of b.rows) for (const c of row) walkInlines(c.blocks, fn)
    else if (b.type === 'image') b.caption.forEach(fn)
  }
}

/** Document Folio Pages (forme complète) → fichier .docx. */
export async function exportDocx(doc: FolioDoc, opts: ExportOptions = {}): Promise<ExportResult> {
  return new Exporter(doc, opts).run()
}

export { PAPER_SIZES }
