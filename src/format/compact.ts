// Forme compacte : le même document, sans les champs à leur valeur par défaut
// et avec les raccourcis (texte simple au lieu de morceaux, chaînes pour les
// éléments de liste et les cellules). Recharger la forme compacte redonne
// exactement le même document : c'est vérifié par les tests.

import { ListBuilder } from './lists'
import { isPlainRun } from './runs'
import { THEME_PRESETS, presetOf } from './theme'
import {
  defaultNotes,
  defaultPage,
  type CommentReply,
  type CommentThread,
  type HeaderSet,
  type NoteSettings,
  type PageSetup,
  type SectionPage,
  PARA_KEYS,
  hasOwn,
  type Block,
  type FolioDoc,
  type Inline,
  type ListItem,
  type Meta,
  type ParaProps,
  type TableCell,
  type Theme,
} from './types'

type Json = Record<string, unknown>

/** Un élément en ligne : chaîne pour le texte simple, note en texte quand elle est simple. */
function item(r: Inline): unknown {
  if (isPlainRun(r)) return r.text
  if (!('type' in r) || r.type !== 'note') return { ...r }
  const out: Json = { type: 'note' }
  if (r.kind !== 'foot') out.kind = r.kind
  const runs = singleParagraph(r.blocks)
  if (runs && !runs.length) out.text = ''
  else if (runs && runs.length === 1 && isPlainRun(runs[0])) out.text = runs[0].text
  else out.blocks = r.blocks.map(block)
  return out
}

/** Éléments en ligne → { text } si le texte est simple, sinon { content } avec des chaînes pour le texte simple. */
function inline(items: Inline[]): Json {
  if (!items.length) return { text: '' }
  if (items.length === 1 && isPlainRun(items[0])) return { text: (items[0] as { text: string }).text }
  return { content: items.map(item) }
}

/** Un fil de commentaires sans ses champs vides. */
function thread(c: CommentThread): Json {
  const reply = (r: CommentReply): Json => ({ ...(r.author ? { author: r.author } : {}), ...(r.date ? { date: r.date } : {}), text: r.text })
  return { id: c.id, ...reply(c), ...(c.resolved ? { resolved: true } : {}), ...(c.replies.length ? { replies: c.replies.map(reply) } : {}) }
}

/** Numérotation des notes : seulement ce qui diffère des réglages par défaut. */
function notes(n: NoteSettings): Json | null {
  const d = defaultNotes()
  const out: Json = {}
  for (const k of ['foot', 'end'] as const) {
    const o: Json = {}
    for (const f of ['format', 'start', 'restart'] as const) if (n[k][f] !== d[k][f]) o[f] = n[k][f]
    if (Object.keys(o).length) out[k] = o
  }
  return Object.keys(out).length ? out : null
}

/** Un texte qui se relit à l'identique comme Markdown en ligne. */
const mdSafe = (t: string) => !/[\\*_~^+[\]`$<>{}!\n]/.test(t) && t === t.trim()

function caption(items: Inline[]): unknown {
  if (items.length === 1 && isPlainRun(items[0]) && mdSafe(items[0].text)) return items[0].text
  return items.map(item)
}

function para(p: ParaProps): Json {
  const out: Json = {}
  for (const k of PARA_KEYS) if (p[k] !== undefined) out[k] = p[k]
  return out
}

const singleParagraph = (blocks: Block[]): Inline[] | null =>
  blocks.length === 1 && blocks[0].type === 'paragraph' && !Object.keys(para(blocks[0])).length && !blocks[0].style
    ? blocks[0].content
    : null

function cell(c: TableCell): unknown {
  const runs = singleParagraph(c.blocks)
  const extra: Json = {}
  if (c.colspan !== 1) extra.colspan = c.colspan
  if (c.rowspan !== 1) extra.rowspan = c.rowspan
  if (c.bg) extra.bg = c.bg
  if (c.valign) extra.valign = c.valign
  if (runs) {
    const body = inline(runs)
    if (!Object.keys(extra).length && 'text' in body) return body.text
    return { ...body, ...extra }
  }
  return { blocks: c.blocks.map(block), ...extra }
}

function listItems(list: Block & { type: 'list' }): unknown[] {
  const b = new ListBuilder(list.style)
  return list.items.map((it: ListItem) => {
    const inferred = b.inferredStyle(it.level)
    b.add(it)
    const body = inline(it.content)
    const extra: Json = {}
    if (it.level) extra.level = it.level
    if (it.level && it.style !== inferred) extra.style = it.style
    Object.assign(extra, para(it))
    if (!Object.keys(extra).length && 'text' in body) return body.text
    return { ...body, ...extra }
  })
}

function block(b: Block): Json {
  switch (b.type) {
    case 'paragraph':
      return { ...inline(b.content), ...(b.style ? { style: b.style } : {}), ...para(b) }
    case 'heading':
      return { type: 'heading', ...(b.level !== 1 ? { level: b.level } : {}), ...inline(b.content), ...para(b) }
    case 'list': {
      const out: Json = { type: 'list' }
      if (b.style !== 'bullet') out.style = b.style
      if (b.start !== 1) out.start = b.start
      if (b.numbering) out.numbering = b.numbering
      if (b.bullet) out.bullet = b.bullet
      if (b.continue) out.continue = true
      out.items = listItems(b)
      return out
    }
    case 'quote': {
      const runs = singleParagraph(b.blocks)
      return runs ? { type: 'quote', ...inline(runs) } : { type: 'quote', blocks: b.blocks.map(block) }
    }
    case 'code':
      return { type: 'code', ...(b.language ? { language: b.language } : {}), text: b.text }
    case 'table': {
      const out: Json = { type: 'table' }
      if (!b.header) out.header = false
      if (b.style !== 'grid') out.style = b.style
      if (b.widths) out.widths = [...b.widths]
      if (b.align) out.align = b.align
      if (b.firstColumn) out.firstColumn = true
      if (b.rowHeight) out.rowHeight = b.rowHeight
      if (b.border) out.border = b.border
      if (b.repeatHeader) out.repeatHeader = true
      out.rows = b.rows.map((r) => r.map(cell))
      return out
    }
    case 'divider':
      return { type: 'divider' }
    case 'equation':
      return { type: 'equation', tex: b.tex, ...(b.numbered ? { numbered: true } : {}) }
    case 'pagebreak':
      return { type: 'pagebreak' }
    case 'columnbreak':
      return { type: 'columnbreak' }
    case 'toc':
      return { type: 'toc', ...(b.levels !== 3 ? { levels: b.levels } : {}), ...(b.title ? { title: b.title } : {}) }
    case 'figures':
      return { type: 'figures', ...(b.label !== 'figure' ? { label: b.label } : {}), ...(b.title ? { title: b.title } : {}) }
    case 'index':
      return { type: 'index', ...(b.columns !== 2 ? { columns: b.columns } : {}), ...(b.title ? { title: b.title } : {}) }
    case 'authorities':
      return { type: 'authorities', ...(b.category !== 'all' ? { category: b.category } : {}), ...(b.title ? { title: b.title } : {}) }
    case 'bibliography':
      return { type: 'bibliography', ...(b.title ? { title: b.title } : {}), ...(b.all ? { all: true } : {}) }
    case 'section': {
      const out: Json = { type: 'section' }
      if (b.start !== 'page') out.start = b.start
      if (b.numberStart !== undefined) out.numberStart = b.numberStart
      if (b.numberFormat) out.numberFormat = b.numberFormat
      if (b.firstPage !== undefined) out.firstPage = b.firstPage
      const hd = b.headers ? headerSet(b.headers) : undefined
      if (b.headers) out.headers = hd ?? {}
      const ft = b.footers ? headerSet(b.footers) : undefined
      if (b.footers) out.footers = ft ?? {}
      if (b.page) out.page = sectionPage(b.page)
      return out
    }
    case 'columns':
      return { type: 'columns', ...(b.count !== 2 ? { count: b.count } : {}), ...(b.gap !== 18 ? { gap: b.gap } : {}), ...(b.rule ? { rule: true } : {}), blocks: b.blocks.map(block) }
    case 'image': {
      const out: Json = { type: 'image', src: b.src }
      if (b.alt) out.alt = b.alt
      if (b.width) out.width = b.width
      if (b.height) out.height = b.height
      if (b.align !== 'center') out.align = b.align
      if (b.wrap !== 'none') out.wrap = b.wrap
      if (b.caption.length) out.caption = caption(b.caption)
      if (b.crop) out.crop = { ...b.crop }
      if (b.rotate) out.rotate = b.rotate
      if (b.flip) out.flip = b.flip
      if (b.border) out.border = b.border
      if (b.adjust) out.adjust = { ...b.adjust }
      return out
    }
  }
}

function meta(m: Meta): Json | undefined {
  const out: Json = {}
  for (const k of ['title', 'author', 'subject', 'organization', 'lang'] as const) if (m[k]) out[k] = m[k]
  if (m.keywords.length) out.keywords = [...m.keywords]
  return Object.keys(out).length ? out : undefined
}

/** La mise en page, réduite à ce qui diffère du défaut (les dimensions d'un format connu sont implicites). */
function page(p: PageSetup): Json | undefined {
  const d = defaultPage()
  const out: Json = {}
  if (p.size !== d.size) out.size = p.size
  if (p.size === 'custom') {
    out.width = p.width
    out.height = p.height
  }
  if (p.orientation !== d.orientation) out.orientation = p.orientation
  if (JSON.stringify(p.margins) !== JSON.stringify(d.margins)) out.margins = { ...p.margins }
  for (const k of ['header', 'footer', 'firstPage', 'evenOdd', 'numberStart', 'numberFormat'] as const) if (p[k] !== d[k]) out[k] = p[k]
  if (p.background) out.background = p.background
  if (p.border) out.border = p.border
  return Object.keys(out).length ? out : undefined
}

/** Mise en page d'une section : les dimensions d'un format connu sont implicites. */
function sectionPage(p: SectionPage): Json {
  const out: Json = { size: p.size }
  if (p.size === 'custom') {
    out.width = p.width
    out.height = p.height
  }
  if (p.orientation !== 'portrait') out.orientation = p.orientation
  out.margins = { ...p.margins }
  return out
}

function headerSet(h: HeaderSet): Json | undefined {
  const out: Json = {}
  for (const k of ['default', 'first', 'even'] as const) if (h[k].length) out[k] = h[k].map(block)
  return Object.keys(out).length ? out : undefined
}

/** Le thème, réduit à ce qui diffère de son modèle (rien s'il est le thème par défaut). */
function theme(t: Theme): Json | undefined {
  const base = presetOf(t.name)
  const out: Json = {}
  if (t.name !== 'folio') out.name = t.name
  for (const part of ['colors', 'fonts', 'code'] as const) {
    const diff: Json = {}
    const a = t[part] as Record<string, string>
    const b = base[part] as Record<string, string>
    for (const k of Object.keys(a)) if (a[k] !== b[k]) diff[k] = a[k]
    if (Object.keys(diff).length) out[part] = diff
  }
  // Un nom inconnu se relit comme le thème par défaut : il faut alors tout écrire.
  if (!hasOwn(THEME_PRESETS, t.name)) return { name: t.name, colors: { ...t.colors }, fonts: { ...t.fonts }, code: { ...t.code } }
  return Object.keys(out).length ? out : undefined
}

export interface CompactOptions {
  /** Inclure les images et polices (false : l'IA garde les « asset:… » sans les données). */
  assets?: boolean
}

/** Forme compacte destinée aux IA : ni identité ni dates, rien de superflu. */
export function toCompact(doc: FolioDoc, opts: CompactOptions = {}): Json {
  const out: Json = { format: doc.format, version: doc.version }
  const m = meta(doc.meta)
  if (m) out.meta = m
  const pg = page(doc.page)
  if (pg) out.page = pg
  const hd = headerSet(doc.headers)
  if (hd) out.headers = hd
  const ft = headerSet(doc.footers)
  if (ft) out.footers = ft
  const nt = doc.notes ? notes(doc.notes) : null
  if (nt) out.notes = nt
  if (doc.math?.macros) out.math = { macros: doc.math.macros }
  if (doc.mailMerge) out.mailMerge = JSON.parse(JSON.stringify(doc.mailMerge))
  if (doc.sources?.length) out.sources = doc.sources.map((src) => JSON.parse(JSON.stringify(src)))
  if (doc.citationStyle && doc.citationStyle !== 'apa') out.citationStyle = doc.citationStyle
  const th = theme(doc.theme)
  if (th) out.theme = th
  if (Object.keys(doc.styles).length) out.styles = JSON.parse(JSON.stringify(doc.styles))
  if (doc.fonts.length) out.fonts = doc.fonts.map((f) => ({ family: f.family, src: f.src, ...(f.weight !== 400 ? { weight: f.weight } : {}), ...(f.italic ? { italic: true } : {}), ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}) }))
  out.blocks = doc.blocks.map(block)
  if (doc.comments?.length) out.comments = doc.comments.map(thread)
  if (doc.trackChanges) out.trackChanges = true
  if (doc.hyphenate) out.hyphenate = true
  if (doc.watermark) {
    const w = doc.watermark
    out.watermark = { ...(w.image ? { image: w.image } : { text: w.text }), ...(w.color !== '#9aa0a6' ? { color: w.color } : {}), ...(!w.diagonal ? { diagonal: false } : {}), ...(w.opacity !== 35 ? { opacity: w.opacity } : {}), ...(w.size ? { size: w.size } : {}), ...(w.scale !== 70 ? { scale: w.scale } : {}) }
  }
  if (doc.template) out.template = true
  if (doc.readOnly) out.readOnly = true
  if (opts.assets !== false && Object.keys(doc.assets).length) out.assets = { ...doc.assets }
  return out
}

