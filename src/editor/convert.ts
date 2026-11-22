// Conversion document Folio ⇄ document ProseMirror.
//
// Sans perte dans les deux sens pour tout document canonique : c'est vérifié
// par les tests (aller-retour Folio → éditeur → Folio identique).
//
// Les images et polices sont rangées dans `assets` dans le fichier ; dans
// l'éditeur, chaque nœud porte directement son URI data: (plus l'identifiant
// d'origine), si bien que copier, coller, annuler ou supprimer une image ne
// demande aucune comptabilité : les ressources inutilisées disparaissent à
// l'enregistrement.

import { chartAttrs, chartOf } from './chart'
import { diagramAttrs, diagramOf } from './diagram'
import type { PicturesBlock, ShapeInline } from '../format/types'
import { Mark, Node as PMNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { TableMap, fixTables } from 'prosemirror-tables'
import { buildTree, flattenTree, type TreeItem, type TreeList } from '../format/lists'
import { AssetTable } from '../format/normalize'
import { cleanMarks, mergeRuns } from '../format/runs'
import { cloneTheme, isBuiltinStyle, pruneStyles } from '../format/theme'
import {
  FORMAT,
  FORMAT_VERSION,
  RUN_FLAGS,
  defaultNotes,
  hasOwn,
  isRun,
  type Block,
  type BlockOf,
  type FieldName,
  type FolioDoc,
  type FontFace,
  type HeaderSet,
  type PageSetup,
  type Inline,
  type ListItem,
  type ListStyle,
  type Marks,
  type Meta,
  mathMarks,
  type MathSettings,
  type Watermark,
  type WritingGoal,
  type LineNumbers,
  type InkStroke,
  type ParaChange,
  type Term,
  type MailMerge,
  type NoteSettings,
  type CommentThread,
  type ParaProps,
  type StyleDef,
  type TableCell,
  type Theme,
  type AuthorityCategory,
  type CitationStyle,
  type SectionPage,
  type Source,
  type XrefShow,
} from '../format/types'
import { FLAG_MARKS, VALUE_MARKS, schema } from './schema'
import { formFrom } from '../format/normalize'

const n = schema.nodes

/** Caractères de contrôle sans usage dans un texte (on garde la tabulation et le retour à la ligne). */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const clean = (s: string) => s.replace(CONTROL, '')

const PX_PER_PT = 4 / 3
const ptToPx = (pt: number) => pt * PX_PER_PT
const pxToPt = (px: number) => Math.round(px * 0.75 * 2) / 2

// --- marques ---------------------------------------------------------------

function marksOf(r: Marks): readonly Mark[] {
  const list: Mark[] = []
  for (const f of RUN_FLAGS) if (r[f]) list.push(schema.marks[f].create())
  for (const [key, [mark, attr]] of Object.entries(VALUE_MARKS)) {
    const v = r[key as keyof typeof VALUE_MARKS]
    if (v !== undefined && v !== null && v !== '') list.push(schema.marks[mark].create({ [attr]: v }))
  }
  for (const id of r.comments ?? []) list.push(schema.marks.comment.create({ id }))
  if (r.inserted) list.push(schema.marks.insertion.create({ author: r.inserted.author, date: r.inserted.date }))
  if (r.deleted) list.push(schema.marks.deletion.create({ author: r.deleted.author, date: r.deleted.date }))
  if (r.formatChange) list.push(schema.marks.formatchange.create({ author: r.formatChange.author, date: r.formatChange.date, before: { ...r.formatChange.before } }))
  // addToSet trie selon le schéma et applique les exclusions (sup/sub).
  return list.reduce<readonly Mark[]>((set, m) => m.addToSet(set), Mark.none)
}

function marksFrom(node: PMNode): Marks {
  const r: Record<string, unknown> = {}
  const comments: string[] = []
  r.comments = comments
  for (const m of node.marks) {
    if (m.type.name === 'comment') comments.push(m.attrs.id as string)
    else if (m.type.name === 'insertion') r.inserted = { author: m.attrs.author, date: m.attrs.date }
    else if (m.type.name === 'deletion') r.deleted = { author: m.attrs.author, date: m.attrs.date }
    else if (m.type.name === 'formatchange') r.formatChange = { author: m.attrs.author, date: m.attrs.date, before: m.attrs.before }
    else if ((FLAG_MARKS as readonly string[]).includes(m.type.name)) r[m.type.name] = true
    else {
      for (const [key, [mark, attr]] of Object.entries(VALUE_MARKS)) if (mark === m.type.name) r[key] = m.attrs[attr]
    }
  }
  return cleanMarks(r)
}

/** Ressources du document en cours de conversion : les fichiers joints y prennent leurs octets. */
let convAssets: Record<string, string> = {}

/** Images libres (et celles d'un groupe) : « asset:id » → l'URI data:, pour l'éditeur. */
function pictureData(d: ShapeInline): ShapeInline {
  if (d.children) d.children = d.children.map(pictureData)
  if (d.shape === 'picture' && d.src?.startsWith('asset:')) {
    const id = d.src.slice(6)
    if (hasOwn(convAssets, id)) {
      d.src = convAssets[id]
      d.assetId = id
    }
  }
  return d
}

export function runsToInline(items: Inline[]): PMNode[] {
  const out: PMNode[] = []
  for (const r of items) {
    if (!isRun(r) && r.type === 'attachment') {
      const id = r.src.startsWith('asset:') ? r.src.slice(6) : null
      const src = id !== null && hasOwn(convAssets, id) ? convAssets[id] : r.src
      out.push(n.attachment.create({ src, assetId: id, name: r.name, size: r.size ?? null, mime: r.mime ?? '' }))
      continue
    }
    if (!isRun(r) && r.type === 'note') {
      out.push(n.note.create({ kind: r.kind, blocks: r.blocks }))
      continue
    }
    if (!isRun(r) && r.type === 'shape') {
      out.push(n.shape.create({ data: pictureData(copy(r)) }))
      continue
    }
    if (!isRun(r) && r.type === 'bookmark') {
      out.push(n.bookmark.create({ name: r.name }))
      continue
    }
    if (!isRun(r) && r.type === 'xe') {
      out.push(n.xe.create({ term: r.term, sub: r.sub ?? '', see: r.see ?? '', bold: !!r.bold, italic: !!r.italic, authority: r.authority ?? null, short: r.short ?? '' }))
      continue
    }
    const marks = marksOf(r as Marks)
    if (!isRun(r) && r.type === 'seq') {
      out.push(n.seq.create({ label: r.label }, null, marks))
      continue
    }
    if (!isRun(r) && r.type === 'xref') {
      out.push(n.xref.create({ target: r.target, show: r.show, doc: r.doc ?? '', last: r.last ?? '' }, null, marks))
      continue
    }
    if (!isRun(r) && r.type === 'cite') {
      out.push(n.cite.create({ ids: [...r.ids], locator: r.locator ?? '' }, null, marks))
      continue
    }
    if (!isRun(r) && r.type === 'mergefield') {
      out.push(n.mergefield.create({ name: r.name, opts: r.opts ? { ...r.opts } : null }, null, marks))
      continue
    }
    if (!isRun(r) && r.type === 'math') {
      out.push(n.math.create({ tex: r.tex }, null, marks))
      continue
    }
    if (!isRun(r) && r.type === 'field') {
      out.push(n.field.create({ name: r.name, format: r.format }, null, marks))
      continue
    }
    if (!isRun(r) && r.type === 'formfield') {
      out.push(n.formfield.create({ kind: r.kind, name: r.name ?? '', value: r.value ?? '', options: r.options ? [...r.options] : [], checked: !!r.checked, placeholder: r.placeholder ?? '' }, null, marks))
      continue
    }
    if (!isRun(r)) continue
    clean(r.text)
      .split(/\r\n|\r|\n/)
      .forEach((part, i) => {
        if (i > 0) out.push(n.hard_break.create(null, null, marks))
        if (part) out.push(schema.text(part, marks))
      })
  }
  return out
}

// --- mise en forme de paragraphe -----------------------------------------

export function paraToAttrs(p: ParaProps): Record<string, unknown> {
  return {
    align: p.align ?? null,
    indentLeft: p.indent?.left ?? null,
    indentRight: p.indent?.right ?? null,
    indentFirst: p.indent?.first ?? null,
    spaceBefore: p.spacing?.before ?? null,
    spaceAfter: p.spacing?.after ?? null,
    line: p.line ?? null,
    keepNext: !!p.keepNext,
    keepLines: !!p.keepLines,
    pageBreakBefore: !!p.pageBreakBefore,
    shading: p.shading ?? null,
    border: p.border ?? null,
    dropCap: p.dropCap ?? null,
    ink: p.ink?.length ? p.ink.map((s) => ({ ...s, points: [...s.points] })) : null,
    dir: p.dir ?? null,
    noLineNumbers: !!p.noLineNumbers,
    fmtChange: p.formatChange ? { author: p.formatChange.author, date: p.formatChange.date, before: { ...p.formatChange.before } } : null,
  }
}

export function paraFromAttrs(a: Record<string, unknown>): ParaProps {
  const p: ParaProps = {}
  if (typeof a.align === 'string') p.align = a.align as ParaProps['align']
  const indent: Record<string, number> = {}
  if (typeof a.indentLeft === 'number') indent.left = a.indentLeft
  if (typeof a.indentRight === 'number') indent.right = a.indentRight
  if (typeof a.indentFirst === 'number') indent.first = a.indentFirst
  if (Object.keys(indent).length) p.indent = indent
  const spacing: Record<string, number> = {}
  if (typeof a.spaceBefore === 'number') spacing.before = a.spaceBefore
  if (typeof a.spaceAfter === 'number') spacing.after = a.spaceAfter
  if (Object.keys(spacing).length) p.spacing = spacing
  if (typeof a.line === 'number') p.line = a.line
  if (a.keepNext) p.keepNext = true
  if (a.keepLines) p.keepLines = true
  if (a.noLineNumbers) p.noLineNumbers = true
  if (a.pageBreakBefore) p.pageBreakBefore = true
  if (typeof a.shading === 'string') p.shading = a.shading
  if (typeof a.border === 'string') p.border = a.border
  if (typeof a.dropCap === 'number') p.dropCap = a.dropCap
  if (a.dir === 'rtl' || a.dir === 'ltr') p.dir = a.dir
  if (Array.isArray(a.ink) && a.ink.length) p.ink = (a.ink as InkStroke[]).map((s) => ({ ...s, points: [...s.points] }))
  const fc = a.fmtChange as ParaChange | null
  if (fc && typeof fc === 'object') p.formatChange = { author: fc.author, date: fc.date, before: { ...fc.before } }
  return p
}

// --- Folio → éditeur -------------------------------------------------------

interface ToCtx {
  assets: Record<string, string>
}

const paragraph = (runs: Inline[], props: ParaProps = {}, style?: string) =>
  n.paragraph.create({ ...paraToAttrs(props), style: style ?? null }, runsToInline(runs))

function listNode(tree: TreeList, list: BlockOf<'list'> | null): PMNode {
  const items = tree.items.map((it: TreeItem) =>
    n.list_item.create(tree.style === 'check' && it.checked ? { checked: true } : null, [paragraph(it.content, it.props), ...it.sublists.map((s) => listNode(s, null))]),
  )
  if (tree.style === 'check') return n.check_list.create(null, items)
  if (tree.style === 'number') {
    return n.ordered_list.create(
      { order: list ? list.start : 1, numbering: list?.numbering ?? null, continue: !!list?.continue },
      items,
    )
  }
  return n.bullet_list.create({ bullet: list?.bullet ?? null }, items)
}

/** Une cellule n'accepte que paragraphes, titres, listes, code et images ; le reste est aplati. */
function cellNodes(blocks: Block[], ctx: ToCtx): PMNode[] {
  const out: PMNode[] = []
  for (const b of blocks) {
    if (b.type === 'quote' || b.type === 'callout') out.push(...cellNodes(b.blocks, ctx))
    else if (b.type === 'table') for (const row of b.rows) for (const c of row) out.push(...cellNodes(c.blocks, ctx))
    else if (b.type === 'columns') out.push(...cellNodes(b.blocks, ctx))
    else if (!['divider', 'pagebreak', 'columnbreak', 'section', 'toc', 'figures', 'index', 'authorities', 'bibliography', 'glossary', 'abbreviations'].includes(b.type)) out.push(...blockNodes(b, ctx))
  }
  return out.length ? out : [n.paragraph.create()]
}

function resolveSrc(src: string, ctx: ToCtx): { src: string; assetId: string | null } {
  if (src.startsWith('asset:')) {
    const id = src.slice(6)
    return hasOwn(ctx.assets, id) ? { src: ctx.assets[id], assetId: id } : { src, assetId: id }
  }
  return { src, assetId: null }
}

function tableNode(b: BlockOf<'table'>, ctx: ToCtx): PMNode | null {
  const rows = b.rows
    .filter((row) => row.length)
    .map((row, r) =>
      n.table_row.create(
        null,
        row.map((c: TableCell) =>
          (b.header && r === 0 ? n.table_header : n.table_cell).create(
            { colspan: c.colspan, rowspan: c.rowspan, colwidth: null, bg: c.bg ?? null, valign: c.valign ?? null, textDir: c.textDir ?? null },
            cellNodes(c.blocks, ctx),
          ),
        ),
      ),
    )
  if (!rows.length) return null
  let table = n.table.create(
    { style: b.style, align: b.align ?? null, firstColumn: !!b.firstColumn, border: b.border ?? null, rowHeight: b.rowHeight ?? null, repeatHeader: !!b.repeatHeader },
    rows,
  )
  if (b.widths) table = withWidths(table, b.widths)
  return table
}

/** Applique des largeurs de colonnes (en points) aux cellules d'un tableau. */
export function withWidths(table: PMNode, widths: number[]): PMNode {
  let map: TableMap
  try {
    map = TableMap.get(table)
  } catch {
    return table
  }
  if (map.width !== widths.length) return table
  const rows: PMNode[] = []
  let pos = 0
  table.forEach((row) => {
    const cells: PMNode[] = []
    let cellPos = pos + 1
    row.forEach((cell) => {
      const left = map.colCount(cellPos)
      const span = cell.attrs.colspan as number
      const colwidth = widths.slice(left, left + span).map(ptToPx)
      cells.push(cell.type.create({ ...cell.attrs, colwidth: colwidth.length === span ? colwidth : null }, cell.content, cell.marks))
      cellPos += cell.nodeSize
    })
    rows.push(row.type.create(row.attrs, cells))
    pos += row.nodeSize
  })
  return table.type.create(table.attrs, rows)
}

function blockNodes(b: Block, ctx: ToCtx): PMNode[] {
  switch (b.type) {
    case 'paragraph':
      return [paragraph(b.content, b, b.style)]
    case 'heading':
      return [n.heading.create({ level: Math.min(6, Math.max(1, b.level)), ...paraToAttrs(b) }, runsToInline(b.content))]
    case 'list':
      if (!b.items.length) return []
      return [listNode(buildTree(b.style, b.items.map((it) => ({ content: it.content, level: it.level, style: it.style, props: itemProps(it), checked: !!it.checked }))), b)]
    case 'quote': {
      const inner = b.blocks.flatMap((x) => blockNodes(x, ctx))
      return [n.blockquote.create(null, inner.length ? inner : [n.paragraph.create()])]
    }
    case 'callout': {
      // Ni encadré, ni colonnes, ni saut de section à l'intérieur : leur contenu est gardé.
      const inner = b.blocks.flatMap((x) => (x.type === 'callout' || x.type === 'columns' ? x.blocks : [x])).filter((x) => x.type !== 'section' && x.type !== 'columnbreak').flatMap((x) => blockNodes(x, ctx))
      return [n.callout.create({ kind: b.kind, title: b.title ?? '' }, inner.length ? inner : [n.paragraph.create()])]
    }
    case 'code': {
      const text = clean(b.text).replace(/\r\n?/g, '\n')
      return [n.code_block.create({ language: b.language }, text ? schema.text(text) : null)]
    }
    case 'table': {
      const t = tableNode(b, ctx)
      return t ? [t] : []
    }
    case 'divider':
      return [n.horizontal_rule.create()]
    case 'equation':
      return [n.equation.create({ tex: b.tex, numbered: !!b.numbered })]
    case 'chart':
      return [n.chart.create(chartAttrs(b))]
    case 'diagram':
      return [n.diagram.create(diagramAttrs(b))]
    case 'pictures':
      return [
        n.pictures.create({
          layout: b.layout,
          title: b.title ?? '',
          color: b.color ?? null,
          items: b.items.map((it) => {
            const r = it.src ? resolveSrc(it.src, ctx) : { src: '', assetId: null }
            return { src: r.src, assetId: r.assetId, caption: it.caption ?? '', text: it.text ?? '' }
          }),
        }),
      ]
    case 'pagebreak':
      return [n.page_break.create()]
    case 'columnbreak':
      return [n.column_break.create()]
    case 'toc':
      return [n.toc.create({ levels: b.levels, title: b.title })]
    case 'figures':
      return [n.refblock.create({ kind: 'figures', label: b.label, title: b.title })]
    case 'index':
      return [n.refblock.create({ kind: 'index', columns: b.columns, title: b.title })]
    case 'authorities':
      return [n.refblock.create({ kind: 'authorities', category: b.category, title: b.title })]
    case 'bibliography':
    case 'glossary':
    case 'abbreviations':
      return [n.refblock.create({ kind: b.type, title: b.title, all: !!b.all })]
    case 'section':
      return [
        n.section_break.create({
          start: b.start,
          numberStart: b.numberStart ?? null,
          numberFormat: b.numberFormat ?? null,
          firstPage: b.firstPage ?? null,
          headers: b.headers ? copy(b.headers) : null,
          footers: b.footers ? copy(b.footers) : null,
          page: b.page ? copy(b.page) : null,
        }),
      ]
    case 'columns': {
      const inner = b.blocks.flatMap((x) => (x.type === 'columns' ? x.blocks.flatMap((y) => blockNodes(y, ctx)) : x.type === 'pagebreak' ? [n.column_break.create()] : blockNodes(x, ctx)))
      return [n.columns.create({ count: b.count, gap: b.gap, rule: b.rule }, inner.length ? inner : [n.paragraph.create()])]
    }
    case 'image': {
      const { src, assetId } = resolveSrc(b.src, ctx)
      return [
        n.figure.create(
          {
            src,
            assetId,
            alt: b.alt,
            width: b.width,
            height: b.height ?? 0,
            align: b.align,
            wrap: b.wrap,
            crop: b.crop ? { ...b.crop } : null,
            rotate: b.rotate ?? 0,
            flip: b.flip ?? null,
            border: b.border ?? null,
            adjust: b.adjust ? { ...b.adjust } : null,
          },
          runsToInline(b.caption),
        ),
      ]
    }
  }
}

/** Mise en forme d'un élément de liste (sans contenu, niveau ni style). */
function itemProps(it: ListItem): ParaProps {
  const { content: _c, level: _l, style: _s, ...props } = it
  return props
}

export function metaAttrs(meta: Meta): Record<string, unknown> {
  return {
    title: meta.title,
    author: meta.author,
    subject: meta.subject,
    organization: meta.organization,
    keywords: [...meta.keywords],
    lang: meta.lang,
  }
}

/** Images et fichiers joints (« asset:id ») d'une liste de blocs, en profondeur. */
export function imageRefs(blocks: Block[], out = new Set<string>()): Set<string> {
  const inl = (items: Inline[]) => {
    for (const x of items) if (!isRun(x) && x.type === 'attachment' && x.src.startsWith('asset:')) out.add(x.src.slice(6))
  }
  for (const b of blocks) {
    if (b.type === 'paragraph' || b.type === 'heading') inl(b.content)
    else if (b.type === 'list') for (const it of b.items) inl(it.content)
    if (b.type === 'image') inl(b.caption)
    if (b.type === 'image' && b.src.startsWith('asset:')) out.add(b.src.slice(6))
    else if (b.type === 'quote' || b.type === 'callout' || b.type === 'columns') imageRefs(b.blocks, out)
    else if (b.type === 'table') for (const r of b.rows) for (const c of r) imageRefs(c.blocks, out)
  }
  return out
}

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Attributs du document qui ne sont pas des propriétés : mise en page, thème, styles, polices. */
export function designAttrs(
  doc: Pick<FolioDoc, 'theme' | 'styles' | 'fonts' | 'assets' | 'page' | 'headers' | 'footers' | 'notes'> & {
    math?: FolioDoc['math']
    mailMerge?: FolioDoc['mailMerge']
    comments?: FolioDoc['comments']
    trackChanges?: boolean
    hyphenate?: boolean
    lineNumbers?: FolioDoc['lineNumbers']
    watermark?: FolioDoc['watermark']
    goal?: FolioDoc['goal']
    terms?: FolioDoc['terms']
    sources?: FolioDoc['sources']
    citationStyle?: FolioDoc['citationStyle']
  },
): Record<string, unknown> {
  const hfAssets: Record<string, string> = {}
  const sets = [doc.headers, doc.footers]
  for (const b of 'blocks' in doc ? (doc as FolioDoc).blocks : []) {
    if (b.type === 'section') for (const s of [b.headers, b.footers]) if (s) sets.push(s)
  }
  for (const set of sets) {
    for (const k of ['default', 'first', 'even'] as const) {
      for (const id of imageRefs(set[k])) if (hasOwn(doc.assets, id)) hfAssets[id] = doc.assets[id]
    }
  }
  return {
    page: copy(doc.page),
    headers: copy(doc.headers),
    footers: copy(doc.footers),
    notes: copy(doc.notes ?? defaultNotes()),
    math: { macros: doc.math?.macros ?? '' },
    mailMerge: doc.mailMerge ? copy(doc.mailMerge) : null,
    sources: copy(doc.sources ?? []),
    terms: copy(doc.terms ?? []),
    citationStyle: doc.citationStyle ?? 'apa',
    comments: copy(doc.comments ?? []),
    trackChanges: !!doc.trackChanges,
    hyphenate: !!doc.hyphenate,
    lineNumbers: doc.lineNumbers ? { ...doc.lineNumbers } : null,
    // L'image du filigrane voyage avec ses données (comme celles des en-têtes).
    watermark: doc.watermark ? { ...copy(doc.watermark), ...(doc.watermark.image && 'assets' in doc ? { image: (doc as FolioDoc).assets[doc.watermark.image.slice(6)] ?? '' } : {}) } : null,
    goal: doc.goal ? { ...doc.goal } : null,
    formsOnly: !!(doc as FolioDoc).formsOnly,
    hfAssets,
    theme: cloneTheme(doc.theme),
    styles: JSON.parse(JSON.stringify(doc.styles)) as Record<string, StyleDef>,
    fonts: doc.fonts.map((f) => {
      const { src, assetId } = resolveSrc(f.src, { assets: doc.assets })
      return { family: f.family, src, weight: f.weight, italic: f.italic, assetId, ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}) }
    }),
  }
}

/** Document Folio → document de l'éditeur (tableaux irréguliers réparés). */
export function docToPM(doc: FolioDoc): PMNode {
  const ctx: ToCtx = { assets: doc.assets }
  const content = withAssets(doc.assets, () => doc.blocks.flatMap((b) => blockNodes(b, ctx)))
  let node = n.doc.create({ ...metaAttrs(doc.meta), ...designAttrs(doc) }, content.length ? content : [n.paragraph.create()])
  node.check()
  const tr = fixTables(EditorState.create({ schema, doc: node }))
  if (tr) node = tr.doc
  return node
}

/** Blocs seuls (pour remplacer le contenu sans toucher aux propriétés). */
function withAssets<T>(assets: Record<string, string>, fn: () => T): T {
  const before = convAssets
  convAssets = assets
  try {
    return fn()
  } finally {
    convAssets = before
  }
}

export function blocksToPM(blocks: Block[], assets: Record<string, string> = {}): PMNode[] {
  const content = withAssets(assets, () => blocks.flatMap((b) => blockNodes(b, { assets })))
  return content.length ? content : [n.paragraph.create()]
}

// --- éditeur → Folio -------------------------------------------------------

interface FromCtx {
  assets: AssetTable
  styles: Record<string, StyleDef>
  /** Données des images d'en-têtes et pieds de page (sauts de section). */
  hfAssets?: Record<string, string>
}

export function inlineToRuns(node: PMNode): Inline[] {
  const items: Inline[] = []
  node.forEach((child) => {
    const marks = marksFrom(child)
    if (child.type === n.field) items.push({ type: 'field', name: child.attrs.name as FieldName, format: child.attrs.format, ...marks })
    else if (child.type === n.formfield) items.push(formFrom({ type: 'formfield', ...child.attrs, ...marks }))
    else if (child.type === n.attachment) {
      const a = child.attrs
      // Les octets restent ici (URI data:) : storeAttachments les range dans les ressources.
      items.push({ type: 'attachment', src: a.src as string, name: a.name as string, ...(typeof a.size === 'number' ? { size: a.size } : {}), ...(a.mime ? { mime: a.mime as string } : {}) })
    }
    else if (child.type === n.mergefield) items.push({ type: 'mergefield', name: child.attrs.name as string, ...(child.attrs.opts ? { opts: { ...(child.attrs.opts as Record<string, string>) } } : {}), ...marks })
    else if (child.type === n.math) items.push({ type: 'math', tex: child.attrs.tex as string, ...mathMarks(marks) })
    else if (child.type === n.note) items.push({ type: 'note', kind: child.attrs.kind === 'end' ? 'end' : 'foot', blocks: copy(child.attrs.blocks as Block[]) })
    else if (child.type === n.shape) items.push(copy(child.attrs.data as ShapeInline))
    else if (child.type === n.seq) items.push({ type: 'seq', label: child.attrs.label as string, ...marks })
    else if (child.type === n.bookmark) items.push({ type: 'bookmark', name: child.attrs.name as string })
    else if (child.type === n.xref) items.push({ type: 'xref', target: child.attrs.target as string, show: child.attrs.show as XrefShow, ...(child.attrs.doc ? { doc: child.attrs.doc as string } : {}), ...(child.attrs.last ? { last: child.attrs.last as string } : {}), ...marks })
    else if (child.type === n.cite) items.push({ type: 'cite', ids: [...(child.attrs.ids as string[])], ...(child.attrs.locator ? { locator: child.attrs.locator as string } : {}), ...marks })
    else if (child.type === n.xe) {
      const a = child.attrs
      items.push({
        type: 'xe',
        term: a.term as string,
        ...(a.sub ? { sub: a.sub as string } : {}),
        ...(a.see ? { see: a.see as string } : {}),
        ...(a.bold ? { bold: true as const } : {}),
        ...(a.italic ? { italic: true as const } : {}),
        ...(a.authority ? { authority: a.authority as AuthorityCategory } : {}),
        ...(a.short ? { short: a.short as string } : {}),
      })
    }
    else items.push({ text: child.isText ? child.text! : child.type === n.hard_break ? '\n' : '', ...marks })
  })
  return mergeRuns(items)
}

function treeOf(list: PMNode): TreeList {
  const style: ListStyle = list.type === n.ordered_list ? 'number' : list.type === n.check_list ? 'check' : 'bullet'
  const items: TreeItem[] = []
  list.forEach((li) => {
    let content: Inline[] = []
    let props: ParaProps = {}
    const sublists: TreeList[] = []
    li.forEach((child, _o, i) => {
      if (i === 0 && child.type === n.paragraph) {
        content = inlineToRuns(child)
        props = paraFromAttrs(child.attrs)
      } else if (child.type === n.bullet_list || child.type === n.ordered_list || child.type === n.check_list) sublists.push(treeOf(child))
    })
    items.push({ content, props, sublists, ...(style === 'check' && li.attrs.checked ? { checked: true } : {}) })
  })
  return { style, items }
}

function pmBlocks(parent: PMNode, ctx: FromCtx): Block[] {
  const out: Block[] = []
  parent.forEach((child) => {
    const b = pmBlock(child, ctx)
    if (b) out.push(b)
  })
  return out
}

/** Source d'image ou de police → « asset:id » (les URI data: vont dans les ressources). */
function storeSrc(src: string, assetId: string | null, ctx: FromCtx): string {
  if (src.startsWith('data:')) return `asset:${ctx.assets.add(src, assetId ?? undefined)}`
  return src
}

function tableWidths(table: PMNode): number[] | undefined {
  let map: TableMap
  try {
    map = TableMap.get(table)
  } catch {
    return undefined
  }
  const widths: (number | null)[] = Array(map.width).fill(null)
  for (let i = 0; i < map.map.length; i++) {
    const col = i % map.width
    if (widths[col] !== null) continue
    const pos = map.map[i]
    const cell = table.nodeAt(pos)
    const cw = cell?.attrs.colwidth as number[] | null
    const left = map.colCount(pos)
    if (cw && cw[col - left] !== undefined && cw[col - left] > 0) widths[col] = pxToPt(cw[col - left])
  }
  return widths.every((w) => w !== null) ? (widths as number[]).map((w) => Math.max(5, Math.min(2000, w))) : undefined
}

function pmBlock(node: PMNode, ctx: FromCtx): Block | null {
  switch (node.type) {
    case n.paragraph: {
      const p: BlockOf<'paragraph'> = { type: 'paragraph', content: inlineToRuns(node), ...paraFromAttrs(node.attrs) }
      const style = node.attrs.style as string | null
      if (style && style !== 'normal' && (isBuiltinStyle(style) || hasOwn(ctx.styles, style)) && !/^heading\d$|^quote$|^code$/.test(style)) {
        return { type: 'paragraph', content: p.content, style, ...paraFromAttrs(node.attrs) }
      }
      return p
    }
    case n.heading:
      return { type: 'heading', level: node.attrs.level, content: inlineToRuns(node), ...paraFromAttrs(node.attrs) }
    case n.blockquote:
      return { type: 'quote', blocks: pmBlocks(node, ctx) }
    case n.callout:
      return { type: 'callout', kind: node.attrs.kind, ...(node.attrs.title ? { title: node.attrs.title } : {}), blocks: pmBlocks(node, ctx) }
    case n.code_block:
      return { type: 'code', language: node.attrs.language, text: node.textContent }
    case n.horizontal_rule:
      return { type: 'divider' }
    case n.equation:
      return { type: 'equation', tex: node.attrs.tex as string, ...(node.attrs.numbered ? { numbered: true as const } : {}) }
    case n.chart:
      return chartOf(node)
    case n.diagram:
      return diagramOf(node)
    case n.pictures: {
      const a = node.attrs
      const b: PicturesBlock = {
        type: 'pictures',
        layout: a.layout,
        items: (a.items as { src: string; assetId: string | null; caption: string; text: string }[]).map((it) => ({
          ...(it.src ? { src: storeSrc(it.src, it.assetId, ctx) } : {}),
          ...(it.caption ? { caption: it.caption } : {}),
          ...(it.text ? { text: it.text } : {}),
        })),
      }
      if (a.title) b.title = a.title
      if (a.color) b.color = a.color
      return b
    }
    case n.page_break:
      return { type: 'pagebreak' }
    case n.column_break:
      return { type: 'columnbreak' }
    case n.toc:
      return { type: 'toc', levels: node.attrs.levels, title: node.attrs.title }
    case n.refblock: {
      const a = node.attrs
      if (a.kind === 'figures') return { type: 'figures', label: a.label, title: a.title }
      if (a.kind === 'authorities') return { type: 'authorities', category: a.category, title: a.title }
      if (a.kind === 'bibliography' || a.kind === 'glossary' || a.kind === 'abbreviations') return { type: a.kind, title: a.title, ...(a.all ? { all: true as const } : {}) }
      return { type: 'index', columns: a.columns, title: a.title }
    }
    case n.section_break: {
      const a = node.attrs
      const sec: BlockOf<'section'> = { type: 'section', start: a.start }
      if (a.numberStart !== null) sec.numberStart = a.numberStart
      if (a.numberFormat) sec.numberFormat = a.numberFormat
      if (a.firstPage !== null) sec.firstPage = a.firstPage
      if (a.headers) sec.headers = storeHeaderSet(a.headers as HeaderSet, ctx.hfAssets ?? {}, ctx.assets)
      if (a.footers) sec.footers = storeHeaderSet(a.footers as HeaderSet, ctx.hfAssets ?? {}, ctx.assets)
      if (a.page) sec.page = copy(a.page as SectionPage)
      return sec
    }
    case n.columns:
      return { type: 'columns', count: node.attrs.count, gap: node.attrs.gap, rule: node.attrs.rule, blocks: pmBlocks(node, ctx) }
    case n.figure: {
      const a = node.attrs
      const img: BlockOf<'image'> = {
        type: 'image',
        src: storeSrc(a.src, a.assetId, ctx),
        alt: a.alt,
        width: a.width,
        ...(a.height && a.width ? { height: a.height } : {}),
        align: a.align,
        wrap: a.wrap,
        caption: inlineToRuns(node),
      }
      if (a.crop) img.crop = { ...a.crop }
      if (a.rotate) img.rotate = a.rotate
      if (a.flip) img.flip = a.flip
      if (a.border) img.border = a.border
      if (a.adjust) img.adjust = { ...a.adjust }
      return img
    }
    case n.bullet_list:
    case n.ordered_list:
    case n.check_list: {
      const tree = treeOf(node)
      const list: BlockOf<'list'> = {
        type: 'list',
        style: tree.style,
        start: tree.style === 'number' ? node.attrs.order : 1,
        items: flattenTree(tree),
      }
      if (node.type === n.ordered_list) {
        if (node.attrs.numbering) list.numbering = node.attrs.numbering
        if (node.attrs.continue) list.continue = true
      } else if (node.attrs.bullet) list.bullet = node.attrs.bullet
      return list
    }
    case n.table: {
      const rows: TableCell[][] = []
      let header = node.childCount > 0
      node.forEach((row, _o, r) => {
        const cells: TableCell[] = []
        row.forEach((cell) => {
          if (r === 0 && cell.type !== n.table_header) header = false
          const c: TableCell = { blocks: pmBlocks(cell, ctx), colspan: cell.attrs.colspan, rowspan: cell.attrs.rowspan }
          if (cell.attrs.bg) c.bg = cell.attrs.bg
          if (cell.attrs.valign) c.valign = cell.attrs.valign
          if (cell.attrs.textDir) c.textDir = cell.attrs.textDir
          cells.push(c)
        })
        rows.push(cells)
      })
      const a = node.attrs
      const table: BlockOf<'table'> = { type: 'table', header, rows, style: a.style }
      const widths = tableWidths(node)
      if (widths) table.widths = widths
      if (a.align) table.align = a.align
      if (a.firstColumn) table.firstColumn = true
      if (a.border) table.border = a.border
      if (a.rowHeight) table.rowHeight = a.rowHeight
      if (a.repeatHeader) table.repeatHeader = true
      return table
    }
    default:
      return null
  }
}

/** Contenu d'un éditeur secondaire (en-tête, pied de page) → blocs du format et données de ses images. */
export function pmToBlocks(node: PMNode, given: Record<string, string>): { blocks: Block[]; assets: Record<string, string> } {
  const assets = new AssetTable(given)
  const blocks = storeAttachments(pmBlocks(node, { assets, styles: {} }), assets)
  return { blocks, assets: assets.result() }
}

export interface Identity {
  id: string
  created: string
  modified: string
}

interface EditorFont {
  family: string
  src: string
  weight: number
  italic: boolean
  assetId: string | null
  unicodeRange?: string
}

/** Fichiers joints : leurs octets (URI data:) dans les ressources, remplacés par « asset:id ». Renvoie des copies. */
export function storeAttachments(blocks: Block[], assets: AssetTable, extra: Record<string, string> = {}): Block[] {
  // Images libres : l'URI data: va dans les ressources (sous son identifiant d'origine).
  const picture = (d: ShapeInline): ShapeInline => {
    const out = { ...d }
    if (out.children) out.children = out.children.map(picture)
    if (out.src?.startsWith('data:')) out.src = `asset:${assets.add(out.src, out.assetId)}`
    else if (out.src?.startsWith('asset:')) {
      const want = out.src.slice(6)
      const id = assets.use(want) ?? (hasOwn(extra, want) ? assets.add(extra[want], want) : null)
      if (id) out.src = `asset:${id}`
    }
    delete out.assetId
    return out
  }
  const fix = (items: Inline[]): Inline[] =>
    items.some((x) => !isRun(x) && (x.type === 'attachment' || x.type === 'shape'))
      ? items.map((x) => {
          if (!isRun(x) && x.type === 'shape') return picture(x)
          if (isRun(x) || x.type !== 'attachment') return x
          if (x.src.startsWith('data:')) return { ...x, src: `asset:${assets.add(x.src)}` }
          const want = x.src.slice(6)
          const id = assets.use(want) ?? (hasOwn(extra, want) ? assets.add(extra[want], want) : null)
          return id ? { ...x, src: `asset:${id}` } : x
        })
      : items
  const walk = (list: Block[]): Block[] =>
    list.map((b): Block => {
      if (b.type === 'paragraph' || b.type === 'heading') return { ...b, content: fix(b.content) }
      if (b.type === 'list') return { ...b, items: b.items.map((it) => ({ ...it, content: fix(it.content) })) }
      if (b.type === 'image') return { ...b, caption: fix(b.caption) }
      if (b.type === 'quote' || b.type === 'callout' || b.type === 'columns') return { ...b, blocks: walk(b.blocks) } as Block
      if (b.type === 'table') return { ...b, rows: b.rows.map((row) => row.map((c) => ({ ...c, blocks: walk(c.blocks) }))) }
      return b
    })
  return walk(blocks)
}

/** Range les images d'en-têtes et de pieds de page dans les ressources du document. */
function storeHeaderSet(set: HeaderSet, hfAssets: Record<string, string>, assets: AssetTable): HeaderSet {
  const fix = (blocks: Block[]): Block[] =>
    blocks.map((b) => {
      if (b.type === 'image') {
        if (b.src.startsWith('data:')) return { ...b, src: `asset:${assets.add(b.src)}` }
        if (b.src.startsWith('asset:')) {
          const id = b.src.slice(6)
          const data = hasOwn(hfAssets, id) ? hfAssets[id] : null
          return data ? { ...b, src: `asset:${assets.add(data, id)}` } : b
        }
        return b
      }
      if (b.type === 'table') return { ...b, rows: b.rows.map((r) => r.map((c) => ({ ...c, blocks: fix(c.blocks) }))) }
      if (b.type === 'quote' || b.type === 'callout') return { ...b, blocks: fix(b.blocks) }
      return b
    })
  return { default: fix(set.default), first: fix(set.first), even: fix(set.even) }
}

/** Le filigrane de l'éditeur (image en données) → format (image en « asset:… »). */
function storeWatermark(w: Watermark, assets: AssetTable): Watermark {
  const out = copy(w)
  if (out.image?.startsWith('data:')) out.image = `asset:${assets.add(out.image)}`
  else if (out.image && !out.image.startsWith('asset:')) delete out.image
  return out
}

export function pmToDoc(node: PMNode, identity: Identity): FolioDoc {
  const a = node.attrs
  const assets = new AssetTable()
  const styles = pruneStyles(a.styles as Record<string, StyleDef>)
  const ctx: FromCtx = { assets, styles, hfAssets: a.hfAssets as Record<string, string> }
  const fonts: FontFace[] = (a.fonts as EditorFont[]).map((f) => ({
    family: f.family,
    src: storeSrc(f.src, f.assetId, ctx),
    weight: f.weight,
    italic: f.italic,
    ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}),
  }))
  const hfAssets = a.hfAssets as Record<string, string>
  const stored = (set: HeaderSet): HeaderSet => {
    const out = storeHeaderSet(set, hfAssets, assets)
    return { default: storeAttachments(out.default, assets, hfAssets), first: storeAttachments(out.first, assets, hfAssets), even: storeAttachments(out.even, assets, hfAssets) }
  }
  const headers = stored(a.headers as HeaderSet)
  const footers = stored(a.footers as HeaderSet)
  const blocks = storeAttachments(pmBlocks(node, ctx), assets)
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    id: identity.id,
    meta: {
      title: a.title,
      author: a.author,
      subject: a.subject,
      organization: a.organization,
      keywords: [...a.keywords],
      lang: a.lang,
      created: identity.created,
      modified: identity.modified,
    },
    page: copy(a.page as PageSetup),
    headers,
    footers,
    notes: copy(a.notes as NoteSettings),
    math: { macros: ((a.math as MathSettings | undefined)?.macros ?? '') as string },
    ...(a.mailMerge ? { mailMerge: copy(a.mailMerge as MailMerge) } : {}),
    ...((a.sources as Source[]).length ? { sources: copy(a.sources as Source[]) } : {}),
    ...((a.terms as Term[] | undefined)?.length ? { terms: copy(a.terms as Term[]) } : {}),
    ...(a.citationStyle && a.citationStyle !== 'apa' ? { citationStyle: a.citationStyle as CitationStyle } : {}),
    theme: cloneTheme(a.theme as Theme),
    styles,
    fonts,
    blocks,
    comments: copy(a.comments as CommentThread[]),
    trackChanges: a.trackChanges === true,
    ...(a.hyphenate ? { hyphenate: true as const } : {}),
    ...(a.lineNumbers ? { lineNumbers: { ...(a.lineNumbers as LineNumbers) } } : {}),
    ...(a.watermark ? { watermark: storeWatermark(a.watermark as Watermark, assets) } : {}),
    ...(a.goal ? { goal: { ...(a.goal as WritingGoal) } } : {}),
    ...(a.formsOnly ? { formsOnly: true as const } : {}),
    // Réglages du fichier, posés par l'application à l'enregistrement (modèle, lecture seule).
    template: false,
    readOnly: false,
    assets: assets.result(),
  }
}
