// Préparation commune des exports (web, Markdown, texte, ODT, EPUB) : ce que
// l'éditeur calcule à l'affichage est calculé ici sur le format, sans éditeur.
//
// - valeurs des champs ({{title}}, {{date}}…), des légendes, renvois et citations ;
// - numéros des notes et des équations, ancres des titres ;
// - listes générées (sommaire, illustrations, index, références, bibliographie) ;
// - modifications suivies : le document est exporté tel qu'il serait accepté.

import { CHECKED_BOX, EMPTY_BOX } from '../format/lists'
import { fieldValue, type FieldContext } from '../format/fields'
import type { Block, CiteInline, FieldInline, FolioDoc, Inline, ListItem, NoteInline, Numbering, Run } from '../format/types'
import { AUTHORITY_CATEGORIES, defaultNotes, isRun } from '../format/types'
import { noteNumber } from '../editor/notes'
import { labelOf, type MathContext } from '../math'
import { bibliographyEntry, bibliographyOrder, citePlain, entryLabel, type Piece } from '../refs/cite'
import { formatRefs, type FormatRefs } from '../refs/values'
import { termsToList } from '../format/terms'
import { formText } from '../format/runs'
import { pageLabel } from '../layout/paginate'

export interface ExportCommonOptions {
  /** Langue des textes ajoutés (« Notes », « Voir »…) ; celle du document par défaut. */
  locale?: string
  /** Nom du fichier (champ {{filename}}). */
  filename?: string
  now?: Date
  /** Pages connues de la vue page : de chaque titre, signet, entrée d'index et légende. */
  headingPages?: number[]
  refPages?: { bookmarks: Record<string, string>; entries: string[]; captions: string[] }
  pages?: number
}

export interface NoteEntry {
  note: NoteInline
  /** Numéro affiché (1, i, *…). */
  label: string
  /** Ancre de la note et de son appel. */
  id: string
  refId: string
}

/** Une ligne d'une liste générée. */
export interface GenLine {
  pieces: Piece[]
  level: number
  /** Étiquette avant le texte ([1] en IEEE). */
  label?: string
  /** Page (si connue). */
  page?: string
  /** Lien interne (#ancre). */
  href?: string
}

export interface GenGroup {
  heading?: string
  lines: GenLine[]
}

export interface Generated {
  title: string
  groups: GenGroup[]
  /** Texte quand la liste est vide. */
  empty: string
}

export interface ExportContext {
  doc: FolioDoc
  locale: string
  fr: boolean
  refs: FormatRefs
  fieldCtx: FieldContext
  notes: NoteEntry[]
  noteOf: Map<NoteInline, NoteEntry>
  /** Ancre de chaque titre (dans l'ordre du document). */
  headingId: Map<Block, string>
  eqNumber: Map<Block, number>
  math: MathContext
  /** Ancre de chaque entrée d'index (dans l'ordre de refs.entries). */
  entryId: Map<Inline, string>
  words: Record<'notes' | 'see' | 'contents' | 'empty', string>
}

/** Texte d'une suite d'éléments en ligne, sans mise en forme (en-têtes, sommaire). */
export function inlineText(items: Inline[], ctx: ExportContext): string {
  let s = ''
  for (const x of items) s += inlinePiece(x, ctx)
  return s
}

/** Le texte d'un élément en ligne (vide pour un signet, une entrée d'index, une note). */
export function inlinePiece(x: Inline, ctx: ExportContext): string {
  if (isRun(x)) return x.deleted ? '' : x.text
  switch (x.type) {
    case 'field':
      return fieldText(x, ctx)
    case 'math':
      return x.tex
    case 'seq':
      return String(ctx.refs.seq.get(x) ?? '')
    case 'xref':
      return ctx.refs.text.get(x) ?? ''
    case 'cite':
      return citePlain(ctx.refs.text.get(x) ?? '')
    case 'mergefield':
      return `«${x.name}»`
    case 'formfield':
      return formText(x)
    case 'attachment':
      return `[${x.name}]`
    default:
      return ''
  }
}

/** Valeur d'un champ ; les numéros de page n'ont de sens qu'en pages (vide sinon). */
export function fieldText(f: FieldInline, ctx: ExportContext, page?: number): string {
  if ((f.name === 'page' || f.name === 'pages') && page === undefined) return f.name === 'pages' ? String(ctx.fieldCtx.pages) : ''
  return fieldValue(f.name, f.format, page === undefined ? ctx.fieldCtx : { ...ctx.fieldCtx, page })
}

/** Le texte tel qu'il serait une fois les modifications acceptées. */
export const visibleRuns = (items: Inline[]): Inline[] => items.filter((x) => !(isRun(x) && x.deleted))

/** Ancre lisible tirée d'un texte (« Résultats et méthode » → « resultats-et-methode »). */
export function slug(text: string, used: Set<string>): string {
  const base =
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'section'
  let id = /^[a-z]/.test(base) ? base : `s-${base}`
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`
  used.add(id)
  return id
}

/** Parcourt les éléments en ligne du corps dans l'ordre (légendes comprises, notes non). */
function eachInline(blocks: Block[], fn: (x: Inline) => void): void {
  for (const b of blocks) {
    if (b.type === 'paragraph' || b.type === 'heading') b.content.forEach(fn)
    else if (b.type === 'list') for (const it of b.items) it.content.forEach(fn)
    else if (b.type === 'quote' || b.type === 'callout' || b.type === 'columns') eachInline(b.blocks, fn)
    else if (b.type === 'table') for (const row of b.rows) for (const c of row) eachInline(c.blocks, fn)
    else if (b.type === 'image') b.caption.forEach(fn)
  }
}

function eachBlock(blocks: Block[], fn: (b: Block) => void): void {
  for (const b of blocks) {
    fn(b)
    if (b.type === 'quote' || b.type === 'callout' || b.type === 'columns') eachBlock(b.blocks, fn)
    else if (b.type === 'table') for (const row of b.rows) for (const c of row) eachBlock(c.blocks, fn)
  }
}

export function prepareExport(doc: FolioDoc, o: ExportCommonOptions = {}): ExportContext {
  const m = doc.meta
  const locale = o.locale || m.lang || 'fr'
  const fr = locale.startsWith('fr')
  const fieldCtx: FieldContext = {
    title: m.title,
    author: m.author,
    subject: m.subject,
    organization: m.organization,
    keywords: m.keywords,
    created: m.created,
    modified: m.modified,
    filename: o.filename ?? '',
    page: 1,
    pages: o.pages ?? 1,
    now: o.now ?? new Date(),
    locale,
  }
  const refs = formatRefs(doc, {
    lang: locale,
    bookmarkPage: (name) => o.refPages?.bookmarks[name] ?? null,
    labels: fr ? { missing: 'Erreur ! Signet non défini.', above: 'ci-dessus', below: 'ci-dessous' } : { missing: 'Error! Bookmark not defined.', above: 'above', below: 'below' },
  })
  // Notes : numérotées par sorte, dans l'ordre du texte (une note dans une note n'existe pas).
  const settings = doc.notes ?? defaultNotes()
  const counters = { foot: 0, end: 0 }
  const notes: NoteEntry[] = []
  const noteOf = new Map<NoteInline, NoteEntry>()
  eachInline(doc.blocks, (x) => {
    if (isRun(x) || x.type !== 'note') return
    const s = settings[x.kind] ?? defaultNotes()[x.kind]
    const n = ++counters[x.kind]
    const k = notes.length + 1
    const e: NoteEntry = { note: x, label: noteNumber(s.start + n - 1, s.format), id: `note-${k}`, refId: `note-ref-${k}` }
    notes.push(e)
    noteOf.set(x, e)
  })
  // Ancres des titres ; numéros des équations (et leurs étiquettes pour \eqref).
  const used = new Set<string>()
  const headingId = new Map<Block, string>()
  const eqNumber = new Map<Block, number>()
  const labels = new Map<string, number>()
  eachBlock(doc.blocks, (b) => {
    if (b.type === 'heading') headingId.set(b, slug(b.content.map((x) => (isRun(x) ? x.text : '')).join(''), used))
    else if (b.type === 'equation' && b.numbered) {
      const n = eqNumber.size + 1
      eqNumber.set(b, n)
      const l = labelOf(b.tex)
      if (l && !labels.has(l)) labels.set(l, n)
    }
  })
  const entryId = new Map<Inline, string>()
  refs.entries.forEach((e, i) => entryId.set(e, `idx-${i + 1}`))
  return {
    doc,
    locale,
    fr,
    refs,
    fieldCtx,
    notes,
    noteOf,
    headingId,
    eqNumber,
    math: { macros: doc.math?.macros ?? '', labels },
    entryId,
    words: fr ? { notes: 'Notes', see: 'Voir', contents: 'Sommaire', empty: 'Aucune entrée.' } : { notes: 'Notes', see: 'See', contents: 'Contents', empty: 'No entries.' },
  }
}

// --- listes générées ----------------------------------------------------------------

const AUTHORITY_NAMES: Record<string, [string, string]> = {
  cases: ['Jurisprudence', 'Cases'],
  statutes: ['Lois', 'Statutes'],
  other: ['Autres références', 'Other Authorities'],
  rules: ['Règlements', 'Rules'],
  treatises: ['Traités', 'Treatises'],
  regulations: ['Décrets', 'Regulations'],
  constitution: ['Dispositions constitutionnelles', 'Constitutional Provisions'],
}

/** Le contenu d'une liste générée, prêt à écrire dans n'importe quel format. */
export function generated(b: Extract<Block, { type: 'toc' | 'figures' | 'index' | 'authorities' | 'bibliography' | 'glossary' | 'abbreviations' }>, ctx: ExportContext, o: ExportCommonOptions = {}): Generated {
  const fr = ctx.fr
  const pages = o.refPages
  const text = (s: string): Piece[] => [{ text: s }]
  const join = (list: string[]) => [...new Set(list.filter(Boolean))].join(', ')
  if (b.type === 'toc') {
    const lines: GenLine[] = []
    let i = 0
    eachBlock(ctx.doc.blocks, (h) => {
      if (h.type !== 'heading') return
      const page = o.headingPages?.[i++]
      if (h.level > b.levels) return
      lines.push({ pieces: text(inlineText(h.content, ctx).trim()), level: h.level - 1, href: `#${ctx.headingId.get(h)}`, ...(page ? { page: String(page) } : {}) })
    })
    return { title: b.title, groups: [{ lines }], empty: fr ? 'Aucun titre dans le document.' : 'No headings in the document.' }
  }
  if (b.type === 'figures') {
    const lines = ctx.refs.captions
      .map((c, i) => ({ ...c, page: pages?.captions[i] ?? '' }))
      .filter((c) => c.label === b.label)
      .map((c): GenLine => ({ pieces: text(c.text), level: 0, ...(c.page ? { page: c.page } : {}) }))
    return { title: b.title, groups: [{ lines }], empty: fr ? 'Aucune entrée de table d’illustration n’a été trouvée.' : 'No table of figures entries found.' }
  }
  if (b.type === 'index') {
    const coll = new Intl.Collator(ctx.doc.meta.lang || ctx.locale, { sensitivity: 'base', numeric: true })
    type Sub = { sub: string; refs: { page: string; href: string }[]; see: string }
    const byTerm = new Map<string, { term: string; refs: { page: string; href: string }[]; see: string; subs: Map<string, Sub> }>()
    ctx.refs.entries.forEach((e, i) => {
      if (e.authority) return
      const k = e.term.toLocaleLowerCase()
      const cur = byTerm.get(k) ?? { term: e.term, refs: [], see: '', subs: new Map<string, Sub>() }
      const ref = { page: pages?.entries[i] ?? '', href: `#${ctx.entryId.get(e)}` }
      if (e.sub) {
        const sk = e.sub.toLocaleLowerCase()
        const sub = cur.subs.get(sk) ?? { sub: e.sub, refs: [], see: '' }
        if (e.see) sub.see = e.see
        else sub.refs.push(ref)
        cur.subs.set(sk, sub)
      } else if (e.see) cur.see = e.see
      else cur.refs.push(ref)
      byTerm.set(k, cur)
    })
    const line = (term: string, refs: { page: string; href: string }[], see: string, level: number): GenLine => {
      const known = join(refs.map((r) => r.page))
      const tail = see ? `. ${ctx.words.see} ${see}` : known ? `, ${known}` : ''
      return { pieces: text(term + tail), level, ...(refs[0] ? { href: refs[0].href } : {}) }
    }
    const lines = [...byTerm.values()]
      .sort((a, c) => coll.compare(a.term, c.term))
      .flatMap((e) => [line(e.term, e.refs, e.see, 0), ...[...e.subs.values()].sort((a, c) => coll.compare(a.sub, c.sub)).map((s) => line(s.sub, s.refs, s.see, 1))])
    return { title: b.title, groups: [{ lines }], empty: fr ? 'Aucune entrée d’index n’a été trouvée.' : 'No index entries found.' }
  }
  if (b.type === 'authorities') {
    const cats = b.category === 'all' ? AUTHORITY_CATEGORIES.filter((c) => ctx.refs.entries.some((e) => e.authority === c)) : [b.category]
    const groups: GenGroup[] = cats.map((c) => {
      const seen = new Map<string, string[]>()
      ctx.refs.entries.forEach((e, i) => {
        if (e.authority === c) seen.set(e.term, [...(seen.get(e.term) ?? []), pages?.entries[i] ?? ''])
      })
      return {
        ...(b.category === 'all' ? { heading: AUTHORITY_NAMES[c][fr ? 0 : 1] } : {}),
        lines: [...seen].map(([term, list]): GenLine => {
          const p = join(list)
          return { pieces: text(term), level: 0, ...(p ? { page: p.split(', ').length >= 5 ? 'passim' : p } : {}) }
        }),
      }
    })
    return { title: b.title, groups, empty: fr ? 'Aucune entrée de table des références n’a été trouvée.' : 'No table of authorities entries found.' }
  }
  if (b.type === 'glossary' || b.type === 'abbreviations') {
    const list = termsToList(ctx.doc, b.type === 'glossary' ? 'glossary' : 'abbreviation', !!b.all, ctx.locale)
    const lines = list.map((x): GenLine =>
      b.type === 'glossary' ? { pieces: [{ text: x.term, bold: true }, { text: `${fr ? ' : ' : ': '}${x.definition}` }], level: 0 } : { pieces: [{ text: x.definition }], level: 0, label: x.term },
    )
    return { title: b.title, groups: [{ lines }], empty: b.type === 'glossary' ? (fr ? 'Aucun terme du glossaire dans le texte.' : 'No glossary term in the text.') : fr ? 'Aucune abréviation dans le texte.' : 'No abbreviation in the text.' }
  }
  const cite = ctx.refs.cite
  const ids = b.all ? (ctx.doc.sources ?? []).map((s) => s.id) : ctx.refs.cited
  const lines = bibliographyOrder(cite, ids).map((src): GenLine => {
    const label = entryLabel(cite, src)
    return { pieces: bibliographyEntry(cite, src), level: 0, ...(label ? { label } : {}) }
  })
  return { title: b.title, groups: [{ lines }], empty: fr ? 'Aucune source dans le document actuel.' : 'There are no sources in the current document.' }
}

// --- listes -----------------------------------------------------------------------

const BULLETS = ['•', '◦', '▪']

/** Numéro d'un élément selon la numérotation (« default » : 1. a. i. selon le niveau ; « outline » : 1.1.1.). */
export { CHECKED_BOX, EMPTY_BOX }

export function listLabels(b: Extract<Block, { type: 'list' }>): string[] {
  const counters: number[] = []
  return b.items.map((it: ListItem, i) => {
    counters.length = it.level + 1
    for (let l = 0; l < it.level; l++) counters[l] ??= 1
    counters[it.level] = (counters[it.level] ?? (it.level === 0 ? b.start - 1 : 0)) + 1
    if (it.style === 'bullet') return b.bullet && it.level === 0 ? b.bullet : BULLETS[it.level % BULLETS.length]
    if (it.style === 'check') return it.checked ? CHECKED_BOX : EMPTY_BOX
    void i
    return numberText(counters, it.level, b.numbering ?? 'default')
  })
}

function numberText(counters: number[], level: number, numbering: Numbering): string {
  const n = counters[level]
  switch (numbering) {
    case 'decimal':
      return `${n}.`
    case 'alpha':
    case 'ALPHA':
    case 'roman':
    case 'ROMAN':
      return `${pageLabel(n, numbering)}.`
    case 'outline':
      return `${counters.slice(0, level + 1).join('.')}.`
    default:
      return `${pageLabel(n, (['decimal', 'alpha', 'roman'] as const)[level % 3])}.`
  }
}

/** Couleur d'un thème ou #rrggbb → #rrggbb (noir si inconnue). */
export function resolveColor(c: string | undefined, doc: FolioDoc, fallback = '#000000'): string {
  if (!c) return fallback
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase()
  const v = doc.theme.colors[c as keyof FolioDoc['theme']['colors']]
  return v && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback
}

/** Données d'une image du document (« asset:id ») : type et octets en base64. */
export function imageData(src: string, doc: FolioDoc): { mime: string; base64: string; ext: string } | null {
  if (!src.startsWith('asset:')) return null
  const data = doc.assets[src.slice(6)]
  const m = data && /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(data)
  if (!m) return null
  const mime = m[1].toLowerCase()
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/svg+xml' ? 'svg' : mime.split('/')[1]
  return { mime, base64: m[2].replace(/\s/g, ''), ext }
}

/** Taille naturelle d'une image PNG, JPEG, GIF ou WebP (en pixels), lue dans son en-tête. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const u32 = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0
  const u16 = (i: number) => (bytes[i] << 8) | bytes[i + 1]
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) return { width: u32(16), height: u32(20) }
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49) return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null
      const marker = bytes[i + 1]
      const len = u16(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16(i + 7), height: u16(i + 5) }
      i += 2 + len
    }
    return null
  }
  if (bytes.length > 30 && bytes[0] === 0x52 && bytes[8] === 0x57) {
    const tag = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
    if (tag === 'VP8 ') return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff }
    if (tag === 'VP8L') {
      const b = bytes.subarray(21)
      return { width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0xf) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) }
    }
    if (tag === 'VP8X') return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) }
  }
  return null
}

export function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Les runs visibles d'un paragraphe sont-ils vides ? */
export const isEmptyContent = (items: Inline[]): boolean => items.every((x) => (isRun(x) ? x.deleted || !x.text : x.type === 'bookmark' || x.type === 'xe'))

export type { Piece, Run, CiteInline }
