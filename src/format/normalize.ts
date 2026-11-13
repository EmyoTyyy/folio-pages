// Données validées (dsl + spec) → document canonique (forme complète).
//
// La validation a déjà borné et nettoyé chaque champ. Ici on résout ce qui
// demande de comprendre le document : quelle source de texte utiliser (text,
// md ou content), les niveaux de liste, les cellules de tableau, les styles
// nommés, les images et leurs ressources, le champ `markdown`, l'identité et
// les dates.

import { parseColor, parseHighlight } from './color'
import { cleanAdjust } from './picture'
import { pathOf, Report } from './dsl'
import { assetIdFor } from './hash'
import { buildTree, flattenTree } from './lists'
import { parseInlineField, parseMarkdown, type MdWarn } from './markdown'
import { cleanMarks, mergeRuns, plainRuns, refInline, runsText } from './runs'
import { dataUriType, isAssetRef } from './spec'
import { cleanStyle, defaultTheme, isBuiltinStyle, presetOf, pruneStyles, THEME_PRESETS } from './theme'
import { mathMarks,
  type AuthorityCategory,
  type CitationStyle,
  type SectionPage,
  type Source,
  type SourceType,
  type XrefShow,
  CODE_COLORS,
  FORMAT,
  FORMAT_VERSION,
  ID_PATTERN,
  KEY_PATTERN,
  PAPER_SIZES,
  NOTE_FORMATS,
  NOTE_RESTARTS,
  defaultNotes,
  defaultPage,
  defaultWatermark,
  type Watermark,
  emptyHeaders,
  THEME_COLORS,
  THEME_FONTS,
  emptyMeta,
  hasOwn,
  mintId,
  type Block,
  type BlockOf,
  type Crop,
  type FieldName,
  type FolioDoc,
  type HeaderSet,
  type PageSetup,
  type FontFace,
  type Inline,
  type ListItem,
  type ListStyle,
  type Marks,
  type Meta,
  type CommentReply,
  type CommentThread,
  type NoteFormat,
  type NoteRestart,
  type NoteSettings,
  type Numbering,
  type ParaProps,
  type StyleDef,
  type TableCell,
  type TableStyle,
  type Theme, MERGE_OPTS, MERGE_OPS, MERGE_TYPES, ADDRESS_FIELDS, type MailMerge, type MergeType, type MergeFilter, type AddressField } from './types'

type Raw = Record<string, unknown>

/**
 * Ressources du document : celles du champ `assets`, plus les URI data:
 * rencontrées. Des données identiques n'ont qu'un identifiant (le premier
 * utilisé), et seules les ressources utilisées sont gardées.
 */
export class AssetTable {
  private readonly given: Record<string, string>
  private readonly out = new Map<string, string>()
  private readonly byData = new Map<string, string>()

  constructor(given: Record<string, string> = {}) {
    this.given = given
  }

  private known(id: string): string | null {
    return this.out.get(id) ?? (hasOwn(this.given, id) ? this.given[id] : null)
  }

  /** Utilise une ressource existante ; renvoie son identifiant canonique, ou null si elle n'existe pas. */
  use(id: string): string | null {
    const d = this.known(id)
    if (d === null) return null
    const same = this.byData.get(d)
    if (same) return same
    this.out.set(id, d)
    this.byData.set(d, id)
    return id
  }

  /** Range des données (URI data:) ; renvoie leur identifiant. `prefer` : identifiant souhaité. */
  add(data: string, prefer?: string): string {
    const same = this.byData.get(data)
    if (same) return same
    let id = prefer && KEY_PATTERN.test(prefer) ? prefer : assetIdFor(data)
    if (this.known(id) !== null && this.known(id) !== data) {
      let k = 2
      while (this.known(`${id}-${k}`) !== null && this.known(`${id}-${k}`) !== data) k++
      id = `${id}-${k}`
    }
    this.out.set(id, data)
    this.byData.set(data, id)
    return id
  }

  /** Ressources utilisées, dans l'ordre de première utilisation. */
  result(): Record<string, string> {
    return Object.fromEntries(this.out)
  }
}

interface Ctx {
  report: Report
  assets: AssetTable
  styles: Record<string, StyleDef>
  /** Images déjà normalisées (les autres viennent du Markdown). */
  done: WeakSet<object>
  /** Dans un bloc de colonnes (les sauts de colonne y sont admis). */
  inColumns?: boolean
  /** Hors du premier niveau (citation, cellule, colonnes, en-tête) : pas de saut de section. */
  nested?: boolean
  /** Dans une note. */
  inNote?: boolean
  /** Identifiants des fils de commentaires du document. */
  comments?: Set<string>
  /** Pas de commentaire ici (en-têtes, pieds de page, notes). */
  noComments?: boolean
  /** Identifiants des sources du document (citations). */
  sources?: Set<string>
  /** Signets déjà vus (un nom n'existe qu'une fois). */
  bookmarks?: Set<string>
}

const mdWarn =
  (ctx: Ctx, path: string): MdWarn =>
  (code, detail) =>
    ctx.report.ignore(path, code, detail)

/** Éléments validés (chaînes, morceaux, champs) → éléments canoniques. */
export function runsFrom(content: unknown[], ctx: Ctx, path = ''): Inline[] {
  const items: Inline[] = []
  for (const r of content) {
    if (typeof r === 'string') items.push({ text: r })
    else {
      const o = r as Raw
      if (o.type === 'field') items.push({ type: 'field', name: o.name as FieldName, format: String(o.format ?? ''), ...cleanMarks(o) })
      else if (o.type === 'note') items.push(noteFrom(o, ctx, path))
      else if (o.type === 'mergefield') {
        const name = String(o.name ?? '').trim()
        if (name) items.push({ type: 'mergefield', name, ...mergeOptsOf(o.opts), ...cleanMarks(o) })
        else ctx.report.ignore(path, 'missing-field', 'name')
      } else if (o.type === 'seq') {
        items.push({ type: 'seq', label: String(o.label ?? 'figure').trim() || 'figure', ...cleanMarks(o) })
      } else if (o.type === 'bookmark') {
        const name = String(o.name ?? '')
        if (ctx.bookmarks?.has(name)) ctx.report.ignore(path, 'bookmark-duplicate', name)
        else {
          ctx.bookmarks?.add(name)
          items.push({ type: 'bookmark', name })
        }
      } else if (o.type === 'xref') {
        items.push({ type: 'xref', target: String(o.target ?? ''), show: (o.show as XrefShow) ?? 'text', ...cleanMarks(o) })
      } else if (o.type === 'xe') {
        const term = String(o.term ?? '').trim()
        if (!term) ctx.report.ignore(path, 'missing-field', 'term')
        else
          items.push(
            refInline({
              type: 'xe',
              term,
              ...(typeof o.sub === 'string' && o.sub.trim() ? { sub: o.sub.trim() } : {}),
              ...(typeof o.see === 'string' && o.see.trim() ? { see: o.see.trim() } : {}),
              ...(o.bold === true ? { bold: true as const } : {}),
              ...(o.italic === true ? { italic: true as const } : {}),
              ...(typeof o.authority === 'string' ? { authority: o.authority as AuthorityCategory } : {}),
              ...(typeof o.short === 'string' && o.short.trim() ? { short: o.short.trim() } : {}),
            }),
          )
      } else if (o.type === 'cite') {
        const raw = [...(Array.isArray(o.ids) ? (o.ids as string[]) : []), ...(typeof o.id === 'string' ? [o.id] : [])]
        const ids = [...new Set(raw)].filter((id) => {
          if (ctx.sources?.has(id)) return true
          ctx.report.ignore(path, 'source-unknown', id)
          return false
        })
        if (ids.length) items.push({ type: 'cite', ids, ...(typeof o.locator === 'string' && o.locator.trim() ? { locator: o.locator.trim() } : {}), ...cleanMarks(o) })
      } else if (o.type === 'math') {
        const tex = String(o.tex ?? '').trim()
        if (tex) items.push({ type: 'math', tex, ...mathMarks(cleanMarks(o)) })
        else ctx.report.ignore(path, 'math-empty', 'tex')
      } else items.push({ text: String(o.text ?? ''), ...cleanMarks(o) })
    }
  }
  for (const it of items) if ('comments' in it && it.comments) checkCommentIds(it, ctx, path)
  return mergeRuns(items)
}

/** Les commentaires d'un morceau : seulement des fils qui existent, et pas là où il n'en faut pas. */
function checkCommentIds(it: Marks, ctx: Ctx, path: string): void {
  const ids = it.comments ?? []
  let keep = ids
  if (ctx.noComments) {
    ctx.report.warn(path, 'comment-misplaced', ids.join(', ').slice(0, 80))
    keep = []
  } else {
    keep = ids.filter((id) => ctx.comments?.has(id))
    for (const id of ids) if (!keep.includes(id)) ctx.report.ignore(path, 'comment-unknown', id)
  }
  if (keep.length) it.comments = keep
  else delete it.comments
}

/** Une date ISO 8601 (ou vide si elle est illisible). */
function isoDate(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) return ''
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : ''
}

/** Fils de commentaires : identifiants uniques, dates lisibles, réponses dans l'ordre. */
function normalizeComments(raw: unknown[] | undefined, report: Report): CommentThread[] {
  const out: CommentThread[] = []
  const seen = new Set<string>()
  ;(raw ?? []).forEach((c, i) => {
    const o = c as Raw
    const id = String(o.id)
    if (seen.has(id)) {
      report.ignore(`comments[${i}]`, 'comment-duplicate', id)
      return
    }
    seen.add(id)
    const reply = (r: Raw): CommentReply => ({ author: String(r.author ?? '').trim(), date: isoDate(r.date), text: String(r.text ?? '') })
    out.push({ id, ...reply(o), resolved: o.resolved === true, replies: ((o.replies as Raw[] | undefined) ?? []).map(reply) })
  })
  return out
}

/** Contenu d'une note : blocs, Markdown ou texte. Seulement des paragraphes, des listes, du code et des équations. */
function noteFrom(o: Raw, ctx: Ctx, path: string): Inline {
  const inner: Ctx = { ...ctx, nested: true, inNote: true, noComments: true }
  const sources = (['blocks', 'md', 'text'] as const).filter((k) => o[k] !== undefined)
  if (sources.length > 1) ctx.report.warn(path, 'several-sources', `${sources[0]} (${sources.slice(1).join(', ')})`)
  let blocks: Block[]
  if (Array.isArray(o.blocks)) blocks = normalizeBlocks(o.blocks as unknown[], `${path}.blocks`, inner)
  else if (o.md !== undefined) blocks = parseMarkdown(String(o.md), mdWarn(ctx, `${path}.md`))
  else blocks = o.text ? [{ type: 'paragraph', content: plainRuns(String(o.text)) }] : []
  blocks = stripNotesDeep(flattenForNote(blocks, path, ctx), path, ctx)
  if (!blocks.length) blocks = [{ type: 'paragraph', content: [] }]
  return { type: 'note', kind: o.kind === 'end' ? 'end' : 'foot', blocks }
}

/** Une note ne contient que des paragraphes, des listes et du code ; le reste est aplati. */
function flattenForNote(blocks: Block[], path: string, ctx: Ctx): Block[] {
  const out: Block[] = []
  for (const blk of blocks) {
    if (blk.type === 'paragraph' || blk.type === 'list' || blk.type === 'code' || blk.type === 'equation') out.push(blk)
    else if (blk.type === 'heading') {
      ctx.report.warn(path, 'note-flattened', 'heading')
      out.push({ type: 'paragraph', content: blk.content, ...paraFrom(blk as unknown as Raw) })
    } else if (blk.type === 'quote' || blk.type === 'columns') {
      ctx.report.warn(path, 'note-flattened', blk.type)
      out.push(...flattenForNote(blk.blocks, path, ctx))
    } else if (blk.type === 'table') {
      ctx.report.warn(path, 'note-flattened', 'table')
      for (const row of blk.rows) for (const c of row) out.push(...flattenForNote(c.blocks, path, ctx))
    } else if (blk.type === 'image') {
      ctx.report.warn(path, 'note-flattened', 'image')
      if (blk.caption.length) out.push({ type: 'paragraph', content: blk.caption })
    } else ctx.report.warn(path, 'note-flattened', blk.type)
  }
  return out
}

/**
 * Retire les notes là où elles ne vont pas (dans une note, un en-tête, un pied
 * de page), à toute profondeur, en le signalant.
 */
function stripNotesDeep(blocks: Block[], path: string, ctx: Ctx): Block[] {
  const fix = (items: Inline[]): Inline[] =>
    items.flatMap((x) => {
      if (!('type' in x) || x.type !== 'note') return [x]
      ctx.report.warn(path, 'note-misplaced', runsText(x.blocks.flatMap((b) => (b.type === 'paragraph' ? b.content : []))).slice(0, 60))
      return []
    })
  const has = (items: Inline[]) => items.some((x) => 'type' in x && x.type === 'note')
  return blocks.map((b): Block => {
    switch (b.type) {
      case 'paragraph':
      case 'heading':
        return has(b.content) ? { ...b, content: mergeRuns(fix(b.content)) } : b
      case 'list':
        return b.items.some((it) => has(it.content)) ? { ...b, items: b.items.map((it) => ({ ...it, content: mergeRuns(fix(it.content)) })) } : b
      case 'quote':
      case 'columns':
        return { ...b, blocks: stripNotesDeep(b.blocks, path, ctx) }
      case 'table':
        return { ...b, rows: b.rows.map((r) => r.map((c) => ({ ...c, blocks: stripNotesDeep(c.blocks, path, ctx) }))) }
      case 'image':
        return has(b.caption) ? { ...b, caption: mergeRuns(fix(b.caption)) } : b
      default:
        return b
    }
  })
}

/** Numérotation des notes. */
function normalizeNotes(raw: Raw | undefined): NoteSettings {
  const out = defaultNotes()
  if (!raw) return out
  for (const kind of ['foot', 'end'] as const) {
    const o = raw[kind] as Raw | undefined
    if (!o) continue
    if (typeof o.format === 'string' && (NOTE_FORMATS as readonly string[]).includes(o.format)) out[kind].format = o.format as NoteFormat
    if (typeof o.start === 'number') out[kind].start = o.start
    if (typeof o.restart === 'string' && (NOTE_RESTARTS as readonly string[]).includes(o.restart)) out[kind].restart = o.restart as NoteRestart
    // Les notes de fin sont toutes à la fin : recommencer à chaque page n'a pas de sens.
    if (kind === 'end' && out.end.restart === 'page') out.end.restart = 'continuous'
  }
  return out
}

/**
 * Le texte d'un bloc vient de `content`, sinon de `md`, sinon de `text`.
 * En donner plusieurs est une erreur d'auteur : on le signale.
 */
function inlineFrom(o: Raw, path: string, ctx: Ctx): Inline[] {
  const sources = (['content', 'md', 'text'] as const).filter((k) => o[k] !== undefined)
  if (sources.length > 1) ctx.report.warn(path, 'several-sources', `${sources[0]} (${sources.slice(1).join(', ')})`)
  if (o.content !== undefined) return runsFrom(o.content as unknown[], ctx, `${path}.content`)
  if (o.md !== undefined) return parseInlineField(String(o.md), mdWarn(ctx, `${path}.md`))
  if (o.text !== undefined) return plainRuns(String(o.text))
  return []
}

const hasInline = (o: Raw) => o.content !== undefined || o.md !== undefined || o.text !== undefined

function numbers(o: unknown, keys: string[]): Record<string, number> | undefined {
  if (!o || typeof o !== 'object') return undefined
  const out: Record<string, number> = {}
  for (const k of keys) {
    const v = (o as Raw)[k]
    if (typeof v === 'number') out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** Mise en forme de paragraphe validée → forme canonique (champs absents omis). */
export function paraFrom(o: Raw): ParaProps {
  const p: ParaProps = {}
  if (typeof o.align === 'string') p.align = o.align as ParaProps['align']
  const indent = numbers(o.indent, ['left', 'right', 'first'])
  if (indent) p.indent = indent
  const spacing = numbers(o.spacing, ['before', 'after'])
  if (spacing) p.spacing = spacing
  if (typeof o.line === 'number') p.line = o.line
  if (o.keepNext === true) p.keepNext = true
  if (o.keepLines === true) p.keepLines = true
  if (o.pageBreakBefore === true) p.pageBreakBefore = true
  const shading = typeof o.shading === 'string' ? parseColor(o.shading) : null
  if (shading) p.shading = shading
  const border = typeof o.border === 'string' ? parseColor(o.border) : null
  if (border) p.border = border
  if (typeof o.dropCap === 'number' && Number.isInteger(o.dropCap) && o.dropCap >= 2 && o.dropCap <= 10) p.dropCap = o.dropCap
  return p
}

function normalizeBlocks(list: unknown[], path: string, ctx: Ctx): Block[] {
  const out: Block[] = []
  list.forEach((b, i) => {
    if (typeof b === 'string') out.push({ type: 'paragraph', content: plainRuns(b) })
    else out.push(...normalizeBlock(b as Raw, pathOf(b, `${path}[${i}]`), ctx))
  })
  return out
}

/** Applique une mise en forme de paragraphe aux paragraphes et titres produits par du Markdown. */
function withProps(blocks: Block[], props: ParaProps): Block[] {
  if (!Object.keys(props).length) return blocks
  return blocks.map((b) => (b.type === 'paragraph' || b.type === 'heading' ? { ...b, ...props } : b))
}

/** Un style de paragraphe peut désigner un titre, une citation ou du code : on en fait le bon bloc. */
function applyParagraphStyle(b: BlockOf<'paragraph'>, raw: unknown, path: string, ctx: Ctx): Block {
  if (typeof raw !== 'string' || raw === 'normal') return b
  const h = /^heading([1-6])$/.exec(raw)
  if (h) {
    const { style: _s, type: _t, ...rest } = b
    ctx.report.warn(`${path}.style`, 'coerced', `${raw} → heading`)
    return { ...rest, type: 'heading', level: Number(h[1]) }
  }
  if (raw === 'quote') {
    ctx.report.warn(`${path}.style`, 'coerced', 'quote → quote')
    return { type: 'quote', blocks: [b] } as unknown as Block
  }
  if (raw === 'code') {
    ctx.report.warn(`${path}.style`, 'coerced', 'code → code')
    return { type: 'code', language: '', text: runsText(b.content) }
  }
  if (isBuiltinStyle(raw) || hasOwn(ctx.styles, raw)) {
    const { type: _t, content, style: _s, ...props } = b
    return { type: 'paragraph', content, style: raw, ...props }
  }
  ctx.report.ignore(`${path}.style`, 'style-unknown', raw.slice(0, 64))
  return b
}

/** Un bloc validé peut en donner plusieurs (paragraphe dont le `md` contient plusieurs paragraphes). */
function normalizeBlock(b: Raw, path: string, ctx: Ctx): Block[] {
  switch (b.type) {
    case 'paragraph': {
      const props = paraFrom(b)
      if (b.content === undefined && b.md !== undefined) {
        if (b.text !== undefined) ctx.report.warn(path, 'several-sources', 'md (text)')
        const parsed = parseMarkdown(String(b.md), mdWarn(ctx, `${path}.md`))
        const blocks = parsed.length ? parsed : [{ type: 'paragraph', content: [] } as Block]
        if (b.style !== undefined && blocks.length === 1 && blocks[0].type === 'paragraph') {
          return [applyParagraphStyle({ ...blocks[0], ...props }, b.style, path, ctx)]
        }
        return withProps(blocks, props)
      }
      const p: BlockOf<'paragraph'> = { type: 'paragraph', content: inlineFrom(b, path, ctx), ...props }
      return [applyParagraphStyle(p, b.style, path, ctx)]
    }
    case 'heading':
      return [{ type: 'heading', level: Number(b.level ?? 1), content: inlineFrom(b, path, ctx), ...paraFrom(b) }]
    case 'list':
      return normalizeList(b, path, ctx)
    case 'quote': {
      let blocks: Block[] = []
      if (b.blocks !== undefined) {
        if (hasInline(b)) ctx.report.warn(path, 'several-sources', 'blocks (text, md, content)')
        blocks = normalizeBlocks(b.blocks as unknown[], `${path}.blocks`, { ...ctx, nested: true })
      } else if (b.content === undefined && b.md !== undefined) {
        blocks = parseMarkdown(String(b.md), mdWarn(ctx, `${path}.md`))
      } else {
        blocks = [{ type: 'paragraph', content: inlineFrom(b, path, ctx) }]
      }
      return [{ type: 'quote', blocks: blocks.length ? blocks : [{ type: 'paragraph', content: [] }] }]
    }
    case 'code':
      return [{ type: 'code', language: String(b.language ?? ''), text: String(b.text ?? '') }]
    case 'table':
      return normalizeTable(b, path, ctx)
    case 'divider':
      return [{ type: 'divider' }]
    case 'equation': {
      const tex = String(b.tex ?? '').trim()
      if (!tex) {
        ctx.report.ignore(path, 'math-empty', 'tex')
        return []
      }
      return [{ type: 'equation', tex, ...(b.numbered === true ? { numbered: true as const } : {}) }]
    }
    case 'pagebreak':
      return [{ type: 'pagebreak' }]
    case 'columns': {
      const inner = flattenForColumns(normalizeBlocks((b.blocks as unknown[]) ?? [], `${path}.blocks`, { ...ctx, inColumns: true, nested: true }), path, ctx)
      return [
        {
          type: 'columns',
          count: Number(b.count ?? 2),
          gap: typeof b.gap === 'number' ? b.gap : 18,
          rule: b.rule === true,
          blocks: inner.length ? inner : [{ type: 'paragraph', content: [] }],
        },
      ]
    }
    case 'section': {
      if (ctx.nested) {
        ctx.report.warn(path, 'block-converted', 'section → pagebreak')
        return [{ type: 'pagebreak' }]
      }
      const sec: BlockOf<'section'> = { type: 'section', start: (b.start as BlockOf<'section'>['start']) ?? 'page' }
      if (typeof b.numberStart === 'number') sec.numberStart = b.numberStart
      if (typeof b.numberFormat === 'string') sec.numberFormat = b.numberFormat as BlockOf<'section'>['numberFormat']
      if (typeof b.firstPage === 'boolean') sec.firstPage = b.firstPage
      if (b.headers) sec.headers = normalizeHeaders(b.headers as Raw, `${path}.headers`, ctx)
      if (b.footers) sec.footers = normalizeHeaders(b.footers as Raw, `${path}.footers`, ctx)
      if (b.page) sec.page = normalizeSectionPage(b.page as Raw)
      return [sec]
    }
    case 'toc':
      return [{ type: 'toc', levels: Number(b.levels ?? 3), title: String(b.title ?? '').trim() }]
    case 'figures':
    case 'index':
    case 'authorities':
    case 'bibliography': {
      if (ctx.nested && !ctx.inColumns) {
        ctx.report.ignore(path, 'block-converted', b.type)
        return []
      }
      const title = String(b.title ?? '').trim()
      if (b.type === 'figures') return [{ type: 'figures', label: String(b.label ?? 'figure').trim() || 'figure', title }]
      if (b.type === 'index') return [{ type: 'index', columns: Number(b.columns ?? 2), title }]
      if (b.type === 'authorities') return [{ type: 'authorities', category: (b.category as AuthorityCategory | 'all') ?? 'all', title }]
      return [{ type: 'bibliography', title, ...(b.all === true ? { all: true as const } : {}) }]
    }
    case 'columnbreak':
      // Un saut de colonne n'a de sens que dans des colonnes : ailleurs, il est ignoré.
      if (!ctx.inColumns) {
        ctx.report.ignore(path, 'block-converted', 'columnbreak')
        return []
      }
      return [{ type: 'columnbreak' }]
    case 'image':
      return normalizeImage(b, path, ctx)
    default:
      return []
  }
}

function imageSrc(src: string, path: string, ctx: Ctx): string {
  if (src.startsWith('data:')) return `asset:${ctx.assets.add(src)}`
  if (isAssetRef(src)) {
    const id = ctx.assets.use(src.slice(6))
    if (id === null) ctx.report.warn(`${path}.src`, 'asset-missing', src.slice(6))
    return id === null ? src : `asset:${id}`
  }
  return src
}

function imageFromParts(src: string, b: Partial<BlockOf<'image'>> & Raw, path: string, ctx: Ctx): BlockOf<'image'> {
  const img: BlockOf<'image'> = {
    type: 'image',
    src: imageSrc(src, path, ctx),
    alt: String(b.alt ?? '').trim(),
    width: typeof b.width === 'number' ? b.width : 0,
    ...(typeof b.height === 'number' && b.height > 0 && typeof b.width === 'number' && b.width > 0 ? { height: b.height } : {}),
    align: (b.align as BlockOf<'image'>['align']) ?? 'center',
    wrap: (b.wrap as BlockOf<'image'>['wrap']) ?? 'none',
    caption: Array.isArray(b.caption) ? (b.caption as Inline[]) : [],
  }
  const crop = normalizeCrop(b.crop)
  if (crop) img.crop = crop
  if (typeof b.rotate === 'number') {
    const r = ((Math.round(b.rotate / 90) * 90) % 360 + 360) % 360
    if (r) img.rotate = r as 90 | 180 | 270
  }
  if (typeof b.flip === 'string') img.flip = b.flip as BlockOf<'image'>['flip']
  const border = typeof b.border === 'string' ? parseColor(b.border) : null
  if (border) img.border = border
  const adjust = cleanAdjust(b.adjust, parseColor)
  if (adjust) img.adjust = adjust
  ctx.done.add(img)
  return img
}

function normalizeCrop(raw: unknown): Crop | undefined {
  const c = numbers(raw, ['top', 'right', 'bottom', 'left'])
  if (!c) return undefined
  const crop: Crop = { top: c.top ?? 0, right: c.right ?? 0, bottom: c.bottom ?? 0, left: c.left ?? 0 }
  // On garde toujours au moins 10 % de l'image dans chaque direction.
  for (const [a, b] of [
    ['left', 'right'],
    ['top', 'bottom'],
  ] as const) {
    const sum = crop[a] + crop[b]
    if (sum > 90) {
      crop[a] = Number(((crop[a] * 90) / sum).toFixed(1))
      crop[b] = Number(((crop[b] * 90) / sum).toFixed(1))
    }
  }
  return crop.top || crop.right || crop.bottom || crop.left ? crop : undefined
}

function normalizeImage(b: Raw, path: string, ctx: Ctx): Block[] {
  const caption =
    typeof b.caption === 'string'
      ? parseInlineField(b.caption, mdWarn(ctx, `${path}.caption`))
      : Array.isArray(b.caption)
        ? runsFrom(b.caption, ctx, `${path}.caption`)
        : []
  return [imageFromParts(String(b.src), { ...b, caption }, path, ctx)]
}

function normalizeList(b: Raw, path: string, ctx: Ctx): Block[] {
  const style = (b.style as ListStyle) ?? 'bullet'
  const start = Number(b.start ?? 1)
  const raw = (b.items as unknown[]) ?? []
  const flat = raw.map((it, i) => {
    if (typeof it === 'string') return { content: plainRuns(it), level: 0 }
    const o = it as Raw
    return {
      content: inlineFrom(o, pathOf(o, `${path}.items[${i}]`), ctx),
      level: Number(o.level ?? 0),
      style: o.style as ListStyle | undefined,
      props: paraFrom(o),
    }
  })
  if (!flat.length) {
    ctx.report.ignore(path, 'missing-field', 'items')
    return []
  }
  const tree = buildTree(style, flat, (i, kind, from, to) =>
    ctx.report.warn(`${path}.items[${i}].${kind}`, kind === 'level' ? 'level-adjusted' : 'coerced', `${from} → ${to}`),
  )
  const items: ListItem[] = flattenTree(tree)
  const list: BlockOf<'list'> = { type: 'list', style, start: style === 'number' ? start : 1, items }
  // La numérotation ne vaut que pour une liste numérotée, la puce pour une liste à puces.
  if (typeof b.numbering === 'string' && b.numbering !== 'default' && style === 'number') list.numbering = b.numbering as Numbering
  if (typeof b.bullet === 'string' && b.bullet && style === 'bullet') list.bullet = b.bullet
  if (b.continue === true && style === 'number') list.continue = true
  return [list]
}

/** Dans des colonnes : pas de colonnes imbriquées ni de saut de page (leur contenu est gardé). */
function flattenForColumns(blocks: Block[], path: string, ctx: Ctx): Block[] {
  const out: Block[] = []
  for (const b of blocks) {
    if (b.type === 'columns') {
      ctx.report.warn(path, 'cell-flattened', 'columns')
      out.push(...b.blocks)
    } else if (b.type === 'pagebreak') {
      ctx.report.warn(path, 'cell-flattened', 'pagebreak')
      out.push({ type: 'columnbreak' })
    } else out.push(b)
  }
  return out
}

/** Types de blocs admis dans une cellule ; le reste est aplati sans perdre de texte. */
const CELL_TYPES = new Set(['paragraph', 'heading', 'list', 'code', 'image', 'equation'])

function flattenForCell(blocks: Block[], path: string, ctx: Ctx): Block[] {
  const out: Block[] = []
  for (const blk of blocks) {
    if (CELL_TYPES.has(blk.type)) out.push(blk)
    else if (blk.type === 'quote') {
      ctx.report.warn(path, 'cell-flattened', 'quote')
      out.push(...flattenForCell(blk.blocks, path, ctx))
    } else if (blk.type === 'table') {
      ctx.report.warn(path, 'cell-flattened', 'table')
      for (const row of blk.rows) for (const c of row) out.push(...flattenForCell(c.blocks, path, ctx))
    } else if (blk.type === 'columns') {
      ctx.report.warn(path, 'cell-flattened', 'columns')
      out.push(...flattenForCell(blk.blocks, path, ctx))
    } else {
      ctx.report.warn(path, 'cell-flattened', blk.type)
    }
  }
  return out
}

function normalizeCell(c: unknown, path: string, ctx: Ctx): TableCell {
  if (typeof c === 'string') return { blocks: [{ type: 'paragraph', content: plainRuns(c) }], colspan: 1, rowspan: 1 }
  const o = c as Raw
  let blocks: Block[]
  if (o.blocks !== undefined) {
    if (hasInline(o)) ctx.report.warn(path, 'several-sources', 'blocks (text, md, content)')
    blocks = flattenForCell(normalizeBlocks(o.blocks as unknown[], `${path}.blocks`, { ...ctx, nested: true }), path, ctx)
  } else {
    blocks = [{ type: 'paragraph', content: inlineFrom(o, path, ctx) }]
  }
  if (!blocks.length) blocks = [{ type: 'paragraph', content: [] }]
  const cell: TableCell = { blocks, colspan: Number(o.colspan ?? 1), rowspan: Number(o.rowspan ?? 1) }
  const bg = typeof o.bg === 'string' ? parseColor(o.bg) : null
  if (bg) cell.bg = bg
  if (o.valign === 'middle' || o.valign === 'bottom') cell.valign = o.valign
  return cell
}

function normalizeTable(b: Raw, path: string, ctx: Ctx): Block[] {
  const rows: TableCell[][] = []
  ;((b.rows as unknown[][]) ?? []).forEach((row, r) => {
    const cells = row.map((c, k) => normalizeCell(c, pathOf(c, `${path}.rows[${r}][${k}]`), ctx))
    if (cells.length) rows.push(cells)
  })
  if (!rows.length) {
    ctx.report.ignore(path, 'missing-field', 'rows')
    return []
  }
  const table: BlockOf<'table'> = { type: 'table', header: b.header !== false, rows, style: (b.style as TableStyle) ?? 'grid' }
  if (Array.isArray(b.widths)) {
    const cols = rows[0].reduce((n, c) => n + c.colspan, 0)
    if (b.widths.length === cols) table.widths = b.widths as number[]
    else ctx.report.ignore(`${path}.widths`, 'invalid-value', `${b.widths.length} ≠ ${cols}`)
  }
  if (b.align === 'center' || b.align === 'right') table.align = b.align
  if (b.firstColumn === true) table.firstColumn = true
  if (typeof b.rowHeight === 'number') table.rowHeight = b.rowHeight
  if (b.repeatHeader === true) table.repeatHeader = true
  const border = typeof b.border === 'string' ? parseColor(b.border) : null
  if (border) table.border = border
  return [table]
}

function normalizeMeta(m: Raw | undefined, now: string): Meta {
  const meta = emptyMeta()
  if (m) {
    for (const k of ['title', 'author', 'subject', 'organization', 'lang', 'created', 'modified'] as const) {
      if (typeof m[k] === 'string') meta[k] = (m[k] as string).trim()
    }
    if (Array.isArray(m.keywords)) meta.keywords = (m.keywords as string[]).map((k) => k.trim()).filter(Boolean)
  }
  if (!meta.created) meta.created = now
  return meta
}

/** Mise en page : format connu → ses dimensions ; marges ramenées si elles ne laissent plus de place. */
export function normalizePage(raw: Raw | undefined, report: Report): PageSetup {
  const p = defaultPage()
  if (!raw) return p
  if (typeof raw.size === 'string') p.size = raw.size
  if (p.size !== 'custom' && Object.prototype.hasOwnProperty.call(PAPER_SIZES, p.size)) [p.width, p.height] = PAPER_SIZES[p.size]
  else {
    p.size = 'custom'
    if (typeof raw.width === 'number') p.width = raw.width
    if (typeof raw.height === 'number') p.height = raw.height
    // Un format personnel est décrit en portrait.
    if (p.width > p.height) [p.width, p.height] = [p.height, p.width]
  }
  if (raw.orientation === 'landscape') p.orientation = 'landscape'
  const m = numbers(raw.margins, ['top', 'right', 'bottom', 'left'])
  if (m) p.margins = { ...p.margins, ...m }
  const [w, h] = p.orientation === 'landscape' ? [p.height, p.width] : [p.width, p.height]
  // Il faut au moins 20 mm de texte dans chaque direction.
  for (const [a, b, size, axis] of [
    ['left', 'right', w, 'margins.left/right'],
    ['top', 'bottom', h, 'margins.top/bottom'],
  ] as const) {
    const sum = p.margins[a] + p.margins[b]
    if (sum > size - 20) {
      const k = (size - 20) / sum
      p.margins[a] = Math.floor(p.margins[a] * k * 10) / 10
      p.margins[b] = Math.floor(p.margins[b] * k * 10) / 10
      report.warn(`page.${axis}`, 'clamped', `${sum} → ${p.margins[a] + p.margins[b]}`)
    }
  }
  if (typeof raw.header === 'number') p.header = raw.header
  if (typeof raw.footer === 'number') p.footer = raw.footer
  if (raw.firstPage === true) p.firstPage = true
  if (raw.evenOdd === true) p.evenOdd = true
  if (typeof raw.numberStart === 'number') p.numberStart = raw.numberStart
  if (typeof raw.numberFormat === 'string') p.numberFormat = raw.numberFormat as PageSetup['numberFormat']
  const bg = typeof raw.background === 'string' ? parseColor(raw.background) : null
  if (bg) p.background = bg
  const border = typeof raw.border === 'string' ? parseColor(raw.border) : null
  if (border) p.border = border
  return p
}

function normalizeHeaders(raw: Raw | undefined, path: string, ctx: Ctx): HeaderSet {
  const out = emptyHeaders()
  if (!raw) return out
  for (const k of ['default', 'first', 'even'] as const) {
    if (Array.isArray(raw[k]))
      out[k] = stripNotesDeep(
        fixImagesDeep(flattenForCell(normalizeBlocks(raw[k] as unknown[], `${path}.${k}`, { ...ctx, nested: true, noComments: true }), `${path}.${k}`, ctx), `${path}.${k}`, ctx),
        `${path}.${k}`,
        ctx,
      )
  }
  return out
}

export function normalizeTheme(raw: Raw | undefined): Theme {
  if (!raw) return defaultTheme()
  const name = typeof raw.name === 'string' ? raw.name.trim().toLowerCase() : ''
  const theme = name && hasOwn(THEME_PRESETS, name) ? presetOf(name) : defaultTheme()
  if (name) theme.name = name
  const colors = raw.colors as Raw | undefined
  if (colors) for (const c of THEME_COLORS) if (typeof colors[c] === 'string') theme.colors[c] = parseColor(colors[c] as string, false) ?? theme.colors[c]
  const fonts = raw.fonts as Raw | undefined
  if (fonts) for (const f of THEME_FONTS) if (typeof fonts[f] === 'string') theme.fonts[f] = (fonts[f] as string).trim()
  const code = raw.code as Raw | undefined
  if (code) for (const c of CODE_COLORS) if (typeof code[c] === 'string') theme.code[c] = parseColor(code[c] as string, false) ?? theme.code[c]
  return theme
}

function normalizeStyles(raw: Raw | undefined, report: Report): Record<string, StyleDef> {
  if (!raw) return {}
  const out: Record<string, StyleDef> = {}
  for (const id of Object.keys(raw)) {
    const o = raw[id] as Raw
    const d: StyleDef = cleanStyle({ ...(o as StyleDef), ...paraFrom(o) })
    // Les booléens d'un style peuvent valoir false (un titre non gras).
    for (const k of ['keepNext', 'keepLines', 'pageBreakBefore'] as const) if (typeof o[k] === 'boolean') d[k] = o[k] as boolean
    for (const k of ['color'] as const) if (typeof d[k] === 'string') d[k] = parseColor(d[k]!) ?? undefined
    if (typeof d.highlight === 'string') d.highlight = parseHighlight(d.highlight) ?? undefined
    if (!isBuiltinStyle(id) && !d.name) {
      d.name = id
      report.warn(`styles.${id}`, 'missing-field', 'name')
    }
    out[id] = cleanStyle(d)
  }
  const known = (s: string | undefined) => !!s && (isBuiltinStyle(s) || hasOwn(out, s))
  for (const id of Object.keys(out)) {
    const d = out[id]
    for (const k of ['basedOn', 'next'] as const) {
      if (d[k] !== undefined && (!known(d[k]) || (k === 'basedOn' && d[k] === id))) {
        report.ignore(`styles.${id}.${k}`, 'style-unknown', String(d[k]))
        delete d[k]
      }
    }
  }
  return pruneStyles(out)
}

function normalizeFonts(raw: unknown[] | undefined, ctx: Ctx): FontFace[] {
  const out: FontFace[] = []
  ;(raw ?? []).forEach((f, i) => {
    const o = f as Raw
    let src = String(o.src)
    if (src.startsWith('data:')) src = `asset:${ctx.assets.add(src)}`
    else {
      const id = ctx.assets.use(src.slice(6))
      if (id === null) {
        ctx.report.ignore(`fonts[${i}].src`, 'asset-missing', src.slice(6))
        return
      }
      src = `asset:${id}`
    }
    out.push({ family: String(o.family).trim(), src, weight: Number(o.weight ?? 400), italic: o.italic === true, ...(typeof o.unicodeRange === 'string' ? { unicodeRange: o.unicodeRange } : {}) })
  })
  return out
}

/** Les ressources données doivent être du bon type pour leur usage. */
function checkAssets(raw: Raw | undefined, report: Report): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw) return out
  for (const id of Object.keys(raw)) {
    const v = raw[id]
    if (typeof v === 'string' && dataUriType(v)) out[id] = v
    else report.ignore(`assets.${id}`, 'unsafe-image', id)
  }
  return out
}

/** Mise en page d'une section : format connu (dimensions implicites) ou personnalisé. */
function normalizeSectionPage(raw: Raw): SectionPage {
  const base = normalizePage({ size: raw.size, width: raw.width, height: raw.height, orientation: raw.orientation, margins: raw.margins } as Raw, new Report())
  return { size: base.size, width: base.width, height: base.height, orientation: base.orientation, margins: { ...base.margins } }
}

/** Sources : identifiants uniques, champs vides retirés. */
export function normalizeSources(raw: unknown[] | undefined, report: Report): Source[] {
  const out: Source[] = []
  const seen = new Set<string>()
  for (const [i, v] of (raw ?? []).entries()) {
    const o = v as Raw
    const id = String(o.id ?? '')
    if (!id) continue
    if (seen.has(id)) {
      report.ignore(`sources[${i}]`, 'source-duplicate', id)
      continue
    }
    seen.add(id)
    const src: Source = { id, type: (o.type as SourceType) ?? 'book', authors: Array.isArray(o.authors) ? (o.authors as string[]).map((a) => a.trim()).filter(Boolean) : [], title: String(o.title ?? '').trim() }
    for (const k of ['container', 'publisher', 'place', 'year', 'volume', 'issue', 'pages', 'edition', 'url', 'doi', 'isbn', 'accessed', 'note'] as const) {
      const val = o[k]
      if (typeof val === 'string' && val.trim()) src[k] = val.trim()
    }
    if (Array.isArray(o.editors)) {
      const eds = (o.editors as string[]).map((a) => a.trim()).filter(Boolean)
      if (eds.length) src.editors = eds
    }
    out.push(src)
  }
  return out
}

/** Filigrane : un texte ou une image (sinon, rien). */
function normalizeWatermark(raw: Raw | undefined, ctx: Ctx): Watermark | null {
  if (!raw || typeof raw !== 'object') return null
  const w = defaultWatermark()
  const text = typeof raw.text === 'string' ? raw.text.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
  let image = ''
  if (typeof raw.image === 'string') {
    if (raw.image.startsWith('data:image/')) image = `asset:${ctx.assets.add(raw.image)}`
    else if (raw.image.startsWith('asset:')) {
      const id = ctx.assets.use(raw.image.slice(6))
      if (id === null) ctx.report.ignore('watermark.image', 'asset-missing', raw.image.slice(6))
      else image = `asset:${id}`
    }
  }
  if (!text && !image) return null
  const color = typeof raw.color === 'string' ? parseColor(raw.color) : null
  const int = (v: unknown, min: number, max: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : def)
  return {
    ...(image ? { image } : { text }),
    color: color ?? w.color,
    diagonal: raw.diagonal !== false,
    opacity: int(raw.opacity, 5, 100, w.opacity),
    size: int(raw.size, 0, 400, w.size),
    scale: int(raw.scale, 10, 100, w.scale),
  }
}

export function normalizeDoc(raw: Raw, report: Report, now: string, known: Record<string, string> = {}): FolioDoc {
  const assets = new AssetTable({ ...known, ...checkAssets(raw.assets as Raw | undefined, report) })
  const styles = normalizeStyles(raw.styles as Raw | undefined, report)
  const comments = normalizeComments(raw.comments as unknown[] | undefined, report)
  const sources = normalizeSources(raw.sources as unknown[] | undefined, report)
  const ctx: Ctx = { report, assets, styles, done: new WeakSet(), comments: new Set(comments.map((c) => c.id)), sources: new Set(sources.map((x) => x.id)), bookmarks: new Set() }
  if (raw.format === undefined) report.warn('format', 'format-missing', FORMAT)
  else if (raw.format !== FORMAT) report.warn('format', 'format-unknown', String(raw.format).slice(0, 40))
  const version = typeof raw.version === 'number' ? raw.version : FORMAT_VERSION
  if (version > FORMAT_VERSION) report.warn('version', 'version-newer', String(version))

  const theme = normalizeTheme(raw.theme as Raw | undefined)
  const fonts = normalizeFonts(raw.fonts as unknown[] | undefined, ctx)
  const page = normalizePage(raw.page as Raw | undefined, report)
  const headers = normalizeHeaders(raw.headers as Raw | undefined, 'headers', ctx)
  const footers = normalizeHeaders(raw.footers as Raw | undefined, 'footers', ctx)
  const notes = normalizeNotes(raw.notes as Raw | undefined)
  const mailMerge = normalizeMailMerge(raw.mailMerge as Raw | undefined, report)
  const mathRaw = raw.math as Raw | undefined
  const math = { macros: typeof mathRaw?.macros === 'string' ? mathRaw.macros : '' }

  let blocks: Block[]
  const rawBlocks = raw.blocks as unknown[] | undefined
  const md = typeof raw.markdown === 'string' ? raw.markdown : undefined
  if (rawBlocks && rawBlocks.length) {
    if (md !== undefined && md.trim()) report.warn('markdown', 'markdown-ignored')
    blocks = normalizeBlocks(rawBlocks, 'blocks', ctx)
  } else if (md !== undefined) {
    blocks = parseMarkdown(md, mdWarn(ctx, 'markdown'))
  } else {
    blocks = []
  }
  blocks = fixImagesDeep(blocks, 'blocks', ctx)
  const watermark = normalizeWatermark(raw.watermark as Raw | undefined, ctx)

  const id = typeof raw.id === 'string' && ID_PATTERN.test(raw.id) ? raw.id : mintId()
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    id,
    meta: normalizeMeta(raw.meta as Raw | undefined, now),
    page,
    headers,
    footers,
    notes,
    math,
    ...(mailMerge ? { mailMerge } : {}),
    ...(sources.length ? { sources } : {}),
    ...(typeof raw.citationStyle === 'string' && raw.citationStyle !== 'apa' ? { citationStyle: raw.citationStyle as CitationStyle } : {}),
    theme,
    styles,
    fonts,
    blocks,
    comments,
    trackChanges: raw.trackChanges === true,
    ...(raw.hyphenate === true ? { hyphenate: true as const } : {}),
    ...(watermark ? { watermark } : {}),
    template: raw.template === true,
    readOnly: raw.readOnly === true,
    assets: assets.result(),
  }
}

/** Images venues du Markdown (n'importe où dans le document) : ressources rangées. */
function fixImagesDeep(blocks: Block[], path: string, ctx: Ctx): Block[] {
  return blocks.map((b) => {
    if (b.type === 'image' && !ctx.done.has(b)) return imageFromParts(b.src, b, path, ctx)
    if (b.type === 'quote') return { ...b, blocks: fixImagesDeep(b.blocks, path, ctx) }
    if (b.type === 'table') return { ...b, rows: b.rows.map((r) => r.map((c) => ({ ...c, blocks: fixImagesDeep(c.blocks, path, ctx) }))) }
    return b
  })
}

/** Réglages d'un champ de fusion : seulement les clés connues, en texte. */
function mergeOptsOf(raw: unknown): { opts?: Record<string, string> } {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const k of MERGE_OPTS) {
    const v = (raw as Raw)[k]
    if (typeof v === 'string' && v !== '') out[k] = v
  }
  return Object.keys(out).length ? { opts: out } : {}
}

/** Publipostage : la liste rectangulaire (une valeur par colonne), des réglages cohérents avec ses colonnes. */
function normalizeMailMerge(raw: Raw | undefined, report: Report): MailMerge | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const mm: MailMerge = { type: (MERGE_TYPES as readonly string[]).includes(String(raw.type)) ? (raw.type as MergeType) : 'letters' }
  const src = raw.source as Raw | undefined
  let fields: string[] = []
  if (src && Array.isArray(src.fields) && Array.isArray(src.records)) {
    // Noms de colonnes uniques et non vides.
    const seen = new Set<string>()
    fields = (src.fields as unknown[]).map((f, i) => {
      let name = String(f ?? '').trim() || `Col${i + 1}`
      while (seen.has(name)) name = `${name}_${i + 1}`
      seen.add(name)
      return name
    })
    const width = fields.length
    const records = (src.records as unknown[]).map((r) => {
      const row = Array.isArray(r) ? (r as unknown[]).map((v) => (v === null || v === undefined ? '' : String(v))) : []
      if (row.length > width) report.warn('mailMerge.source.records', 'truncated', `${row.length} > ${width}`)
      return Array.from({ length: width }, (_, i) => row[i] ?? '')
    })
    const excluded = Array.isArray(src.excluded) ? [...new Set((src.excluded as unknown[]).filter((n): n is number => typeof n === 'number' && n >= 0 && n < records.length))].sort((a, b) => a - b) : []
    mm.source = { name: String(src.name ?? ''), fields, records, ...(excluded.length ? { excluded } : {}) }
  }
  const known = (f: unknown) => typeof f === 'string' && fields.includes(f)
  if (raw.map && typeof raw.map === 'object') {
    const map: Partial<Record<AddressField, string>> = {}
    for (const k of ADDRESS_FIELDS) {
      const v = (raw.map as Raw)[k]
      if (known(v)) map[k] = v as string
      else if (v !== undefined) report.ignore(`mailMerge.map.${k}`, 'invalid-value', String(v).slice(0, 80))
    }
    if (Object.keys(map).length) mm.map = map
  }
  if (Array.isArray(raw.filters)) {
    const filters = (raw.filters as Raw[]).filter((f) => known(f.field)).map((f) => ({ field: f.field as string, op: (MERGE_OPS as readonly string[]).includes(String(f.op)) ? (f.op as MergeFilter['op']) : 'eq', ...(typeof f.value === 'string' ? { value: f.value } : {}) }))
    if (filters.length) mm.filters = filters
  }
  if (raw.sort && typeof raw.sort === 'object' && known((raw.sort as Raw).field)) mm.sort = { field: (raw.sort as Raw).field as string, ...((raw.sort as Raw).desc === true ? { desc: true } : {}) }
  if (raw.email && typeof raw.email === 'object') {
    const e = raw.email as Raw
    if (typeof e.to === 'string') mm.email = { to: e.to, subject: String(e.subject ?? '') }
  }
  if (raw.label && typeof raw.label === 'object') {
    const l = raw.label as Raw
    const n = (k: string, d = 0) => (typeof l[k] === 'number' ? (l[k] as number) : d)
    mm.label = { name: String(l.name ?? ''), pageWidth: n('pageWidth'), pageHeight: n('pageHeight'), cols: n('cols', 1), rows: n('rows', 1), width: n('width'), height: n('height'), top: n('top'), left: n('left'), hgap: n('hgap'), vgap: n('vgap') }
  }
  if (raw.envelope && typeof raw.envelope === 'object') {
    const e = raw.envelope as Raw
    mm.envelope = { name: String(e.name ?? ''), width: Number(e.width), height: Number(e.height), returnAddress: String(e.returnAddress ?? '') }
  }
  return mm
}
