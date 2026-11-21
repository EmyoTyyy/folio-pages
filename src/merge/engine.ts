// Publipostage : la fusion elle-même, sans DOM (testable à part).
//
// Le document principal contient des champs de fusion ({type:'mergefield'}).
// Pour chaque destinataire retenu (cochés, filtres, tri), on recopie le
// document en remplaçant chaque champ par sa valeur. Lettres et messages : un
// exemplaire par destinataire, séparés par un saut de section (nouvelle page).
// Répertoire : les exemplaires à la suite. Étiquettes : le document est le
// modèle d'une étiquette, répété sur une planche (tableau à lignes de hauteur
// fixe). Enveloppes : une page au format de l'enveloppe par destinataire.
//
// Champs spéciaux : @address (bloc d'adresse), @greeting (ligne de
// salutation), @record (numéro du destinataire dans la liste), @sequence
// (numéro dans la fusion), @next / @nextif (passer au destinataire suivant
// dans le même exemplaire), @skipif (ne pas produire cet exemplaire), @if
// (texte selon une condition), @fillin (réponse demandée une fois).

import { makeRun } from '../format/runs'
import type { AddressField, Block, FolioDoc, Inline, LabelSheet, MailMerge, MergeFilter, MergeInline, TableCell } from '../format/types'

export interface Recipient {
  /** Position dans la liste d'origine (0…). */
  index: number
  values: Record<string, string>
}

const EMPTY: Recipient = { index: -1, values: {} }

/** Destinataires retenus : cochés, filtrés, triés. */
export function recipients(mm: MailMerge | undefined): Recipient[] {
  const src = mm?.source
  if (!src) return []
  const excluded = new Set(src.excluded ?? [])
  let list = src.records
    .map((r, index) => ({ index, values: Object.fromEntries(src.fields.map((f, i) => [f, r[i] ?? ''])) }))
    .filter((r) => !excluded.has(r.index))
  for (const f of mm?.filters ?? []) list = list.filter((r) => test(r.values[f.field] ?? '', f.op, f.value ?? ''))
  if (mm?.sort) {
    const { field, desc } = mm.sort
    const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    list = [...list].sort((a, b) => (desc ? -1 : 1) * coll.compare(a.values[field] ?? '', b.values[field] ?? ''))
  }
  return list
}

const num = (s: string) => {
  const n = Number(s.replace(/\s/g, '').replace(',', '.'))
  return s.trim() !== '' && Number.isFinite(n) ? n : null
}

/** Une condition (règles, filtres). Comparaisons sans tenir compte de la casse ; nombres comparés en nombres. */
export function test(actual: string, op: MergeFilter['op'] | string, expected: string): boolean {
  const a = actual.trim()
  const b = expected.trim()
  const coll = new Intl.Collator(undefined, { sensitivity: 'base' })
  const cmp = () => {
    const na = num(a)
    const nb = num(b)
    return na !== null && nb !== null ? na - nb : coll.compare(a, b)
  }
  switch (op) {
    case 'eq':
      return cmp() === 0
    case 'ne':
      return cmp() !== 0
    case 'lt':
      return cmp() < 0
    case 'gt':
      return cmp() > 0
    case 'le':
      return cmp() <= 0
    case 'ge':
      return cmp() >= 0
    case 'empty':
      return a === ''
    case 'notEmpty':
      return a !== ''
    case 'contains':
      return a.toLocaleLowerCase().includes(b.toLocaleLowerCase())
  }
  return false
}

/** Valeur d'un champ d'adresse standard (via la correspondance des champs). */
export function std(mm: MailMerge | undefined, r: Recipient, f: AddressField): string {
  const col = mm?.map?.[f]
  return col ? (r.values[col] ?? '').trim() : ''
}

const US = /^(us|usa|u\.s\.a?\.?|united states( of america)?|[ée]tats-unis|canada)$/i

/** Bloc d'adresse : nom, société, rue, ville, pays (selon les réglages). */
export function addressLines(mm: MailMerge | undefined, r: Recipient, opts: Record<string, string> = {}): string[] {
  const g = (f: AddressField) => std(mm, r, f)
  const join = (...parts: string[]) => parts.filter((p) => p).join(' ')
  const lines: string[] = []
  lines.push(join(g('title'), g('first'), g('last')))
  if (opts.company !== 'no') lines.push(g('company'))
  lines.push(g('address1'), g('address2'))
  const country = g('country')
  if (US.test(country) || US.test(opts.home ?? '')) lines.push([g('city'), [g('state'), g('postal')].filter(Boolean).join(' ')].filter(Boolean).join(', '))
  else lines.push(join(g('postal'), g('city')), g('state'))
  const mode = opts.country ?? 'foreign'
  const home = (opts.home ?? '').trim().toLowerCase()
  if (country && (mode === 'always' || (mode === 'foreign' && country.toLowerCase() !== home))) lines.push(country.toUpperCase())
  return lines.map((l) => l.trim()).filter((l) => l)
}

/** Ligne de salutation : « Bonjour Camille, », avec une formule de repli si le nom manque. */
export function greetingText(mm: MailMerge | undefined, r: Recipient, opts: Record<string, string> = {}, lang = 'fr'): string {
  const g = (f: AddressField) => std(mm, r, f)
  const fmt = opts.nameFormat ?? 'first'
  const name = (fmt === 'first' ? [g('first')] : fmt === 'last' ? [g('last')] : fmt === 'title-last' ? [g('title'), g('last')] : [g('title'), g('first'), g('last')]).filter(Boolean).join(' ')
  const salutation = opts.salutation ?? (lang === 'fr' ? 'Bonjour' : 'Dear')
  const punct = opts.punct ?? ','
  if (!name) return opts.fallback ?? (lang === 'fr' ? 'Madame, Monsieur,' : 'Dear Sir or Madam,')
  return `${salutation} ${name}${punct}`
}

/** Remplace les «Colonne» d'un texte (règle Si…Alors…Sinon) par les valeurs du destinataire. */
export function fillTokens(text: string, r: Recipient): string {
  return text.replace(/«([^«»\n]{1,80})»/g, (m, name: string) => (name in r.values ? r.values[name] : m))
}

export interface MergeContext {
  mm: MailMerge | undefined
  lang: string
  /** Destinataire courant (un @next fait passer au suivant). */
  r: Recipient
  /** Numéro de l'exemplaire dans la fusion (1…). */
  sequence: number
  /** Réponses aux champs « Remplir » (par question). */
  fillins: Record<string, string>
  /** Passe au destinataire suivant (champ @next) ; null s'il n'y en a plus. */
  next: () => Recipient | null
}

/** Texte d'un champ de fusion pour ce destinataire. */
export function fieldText(f: MergeInline, ctx: MergeContext): string {
  const o = f.opts ?? {}
  switch (f.name) {
    case '@address':
      return addressLines(ctx.mm, ctx.r, o).join('\n')
    case '@greeting':
      return greetingText(ctx.mm, ctx.r, o, ctx.lang)
    case '@record':
      return ctx.r.index >= 0 ? String(ctx.r.index + 1) : ''
    case '@sequence':
      return String(ctx.sequence)
    case '@if':
      return fillTokens(test(ctx.r.values[o.field ?? ''] ?? '', o.op ?? 'eq', o.value ?? '') ? (o.then ?? '') : (o.else ?? ''), ctx.r)
    case '@fillin':
      return ctx.fillins[o.prompt ?? ''] ?? o.default ?? ''
    case '@next':
    case '@nextif':
    case '@skipif':
      return ''
    default:
      return ctx.r.values[f.name] ?? ''
  }
}

/** Le texte affiché à la place d'un champ hors aperçu : «Nom». */
export const placeholder = (f: MergeInline): string => `«${f.name}»`

// --- parcours des blocs -------------------------------------------------------

function mapInlines(items: Inline[], ctx: MergeContext): Inline[] {
  const out: Inline[] = []
  for (const x of items) {
    if (!('type' in x)) {
      out.push(x)
      continue
    }
    if (x.type === 'note') {
      out.push({ ...x, blocks: mapBlocks(x.blocks, ctx) })
      continue
    }
    if (x.type !== 'mergefield') {
      out.push(x)
      continue
    }
    if (x.name === '@next' || (x.name === '@nextif' && test(ctx.r.values[x.opts?.field ?? ''] ?? '', x.opts?.op ?? 'eq', x.opts?.value ?? ''))) {
      ctx.r = ctx.next() ?? EMPTY
      continue
    }
    const { type: _t, name: _n, opts: _o, ...marks } = x
    const text = fieldText(x, ctx)
    if (text) out.push(makeRun(text, marks))
  }
  return out
}

function mapCell(c: TableCell, ctx: MergeContext): TableCell {
  return { ...c, blocks: mapBlocks(c.blocks, ctx) }
}

/** Recopie des blocs, champs remplacés (à toute profondeur, notes comprises). */
export function mapBlocks(blocks: Block[], ctx: MergeContext): Block[] {
  return blocks.map((b): Block => {
    switch (b.type) {
      case 'paragraph':
      case 'heading':
        return { ...b, content: mapInlines(b.content, ctx) }
      case 'list':
        return { ...b, items: b.items.map((it) => ({ ...it, content: mapInlines(it.content, ctx) })) }
      case 'quote':
      case 'callout':
      case 'columns':
        return { ...b, blocks: mapBlocks(b.blocks, ctx) }
      case 'table':
        return { ...b, rows: b.rows.map((row) => row.map((c) => mapCell(c, ctx))) }
      case 'image':
        return { ...b, caption: mapInlines(b.caption, ctx) }
      default:
        return b
    }
  })
}

/** Tous les champs de fusion des blocs (pour les vérifications). */
export function mergeFields(blocks: Block[]): MergeInline[] {
  const out: MergeInline[] = []
  const inl = (items: Inline[]) => {
    for (const x of items) {
      if ('type' in x && x.type === 'mergefield') out.push(x)
      else if ('type' in x && x.type === 'note') walk(x.blocks)
    }
  }
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.type === 'paragraph' || b.type === 'heading') inl(b.content)
      else if (b.type === 'list') for (const it of b.items) inl(it.content)
      else if (b.type === 'quote' || b.type === 'callout' || b.type === 'columns') walk(b.blocks)
      else if (b.type === 'table') for (const row of b.rows) for (const c of row) walk(c.blocks)
      else if (b.type === 'image') inl(b.caption)
    }
  }
  walk(blocks)
  return out
}

/** Cet exemplaire est-il à ignorer (un @skipif vrai pour ce destinataire) ? */
export function skips(blocks: Block[], r: Recipient): boolean {
  return mergeFields(blocks).some((f) => f.name === '@skipif' && test(r.values[f.opts?.field ?? ''] ?? '', f.opts?.op ?? 'eq', f.opts?.value ?? ''))
}

/** Questions « Remplir » du document (une réponse par question, demandée avant la fusion). */
export function fillinPrompts(blocks: Block[]): { prompt: string; default: string }[] {
  const seen = new Map<string, string>()
  for (const f of mergeFields(blocks)) if (f.name === '@fillin' && !seen.has(f.opts?.prompt ?? '')) seen.set(f.opts?.prompt ?? '', f.opts?.default ?? '')
  return [...seen].map(([prompt, d]) => ({ prompt, default: d }))
}

// --- planches et enveloppes --------------------------------------------------

/** Planches d'étiquettes courantes (formats génériques, dimensions en mm). */
export const LABEL_PRESETS: LabelSheet[] = [
  { name: 'A4 — 3 × 7 (63,5 × 38,1 mm)', pageWidth: 210, pageHeight: 297, cols: 3, rows: 7, width: 63.5, height: 38.1, top: 15.1, left: 7.2, hgap: 2.5, vgap: 0 },
  { name: 'A4 — 3 × 8 (70 × 37 mm)', pageWidth: 210, pageHeight: 297, cols: 3, rows: 8, width: 70, height: 37, top: 0.5, left: 0, hgap: 0, vgap: 0 },
  { name: 'A4 — 2 × 7 (99,1 × 38,1 mm)', pageWidth: 210, pageHeight: 297, cols: 2, rows: 7, width: 99.1, height: 38.1, top: 15.1, left: 4.6, hgap: 2.5, vgap: 0 },
  { name: 'A4 — 2 × 4 (99,1 × 67,7 mm)', pageWidth: 210, pageHeight: 297, cols: 2, rows: 4, width: 99.1, height: 67.7, top: 13, left: 4.6, hgap: 2.5, vgap: 0 },
  { name: 'A4 — 4 × 10 (48,5 × 25,4 mm)', pageWidth: 210, pageHeight: 297, cols: 4, rows: 10, width: 48.5, height: 25.4, top: 21.5, left: 8, hgap: 0, vgap: 0 },
  { name: 'Letter — 3 × 10 (66,7 × 25,4 mm)', pageWidth: 215.9, pageHeight: 279.4, cols: 3, rows: 10, width: 66.7, height: 25.4, top: 12.7, left: 4.8, hgap: 3.2, vgap: 0 },
  { name: 'Letter — 2 × 5 (101,6 × 50,8 mm)', pageWidth: 215.9, pageHeight: 279.4, cols: 2, rows: 5, width: 101.6, height: 50.8, top: 12.7, left: 4, hgap: 4.8, vgap: 0 },
]

/** Formats d'enveloppe courants (mm, posée à l'horizontale). */
export const ENVELOPE_PRESETS: { name: string; width: number; height: number }[] = [
  { name: 'DL (220 × 110 mm)', width: 220, height: 110 },
  { name: 'C5 (229 × 162 mm)', width: 229, height: 162 },
  { name: 'C6 (162 × 114 mm)', width: 162, height: 114 },
  { name: 'C4 (324 × 229 mm)', width: 324, height: 229 },
  { name: 'US #10 (241,3 × 104,8 mm)', width: 241.3, height: 104.8 },
]

const PT_PER_MM = 72 / 25.4

/** Étiquettes : une planche (tableau à lignes fixes) par page, chaque case un exemplaire du modèle. */
function labelPages(sheet: LabelSheet, instances: Block[][]): Block[] {
  const perPage = sheet.cols * sheet.rows
  const blocks: Block[] = []
  const widths: number[] = []
  for (let c = 0; c < sheet.cols; c++) {
    if (c > 0 && sheet.hgap > 0) widths.push(Math.round(sheet.hgap * PT_PER_MM * 10) / 10)
    widths.push(Math.round(sheet.width * PT_PER_MM * 10) / 10)
  }
  const empty = (): TableCell => ({ blocks: [{ type: 'paragraph', content: [] }], colspan: 1, rowspan: 1 })
  for (let start = 0; start < instances.length; start += perPage) {
    const rows: TableCell[][] = []
    for (let r = 0; r < sheet.rows; r++) {
      const row: TableCell[] = []
      for (let c = 0; c < sheet.cols; c++) {
        if (c > 0 && sheet.hgap > 0) row.push(empty())
        const inst = instances[start + r * sheet.cols + c]
        row.push(inst ? { blocks: inst.length ? inst : [{ type: 'paragraph', content: [] }], colspan: 1, rowspan: 1 } : empty())
      }
      rows.push(row)
    }
    if (blocks.length) blocks.push({ type: 'pagebreak' })
    blocks.push({ type: 'table', header: false, style: 'minimal', rows, widths, rowHeight: Math.round((sheet.height + sheet.vgap) * PT_PER_MM * 10) / 10 })
  }
  return blocks
}

export interface MergeResult {
  doc: FolioDoc
  /** Exemplaires produits, destinataires ignorés (@skipif). */
  count: number
  skipped: number
}

/** Le document fusionné : un nouveau document, avec une nouvelle identité. */
export function mergeDocument(doc: FolioDoc, o: { fillins?: Record<string, string>; lang?: string; id: string; now?: string; only?: number } = { id: '' }): MergeResult {
  const mm = doc.mailMerge
  let list = recipients(mm)
  if (o.only !== undefined) list = list.slice(o.only, o.only + 1)
  const lang = o.lang ?? (doc.meta.lang || 'fr').slice(0, 2)
  let i = 0
  let skipped = 0
  const instances: Block[][] = []
  while (i < list.length) {
    const first = list[i]
    if (skips(doc.blocks, first)) {
      skipped++
      i++
      continue
    }
    const ctx: MergeContext = {
      mm,
      lang,
      r: first,
      sequence: instances.length + 1,
      fillins: o.fillins ?? {},
      next: () => {
        i++
        return list[i] ?? null
      },
    }
    instances.push(mapBlocks(doc.blocks, ctx))
    i++
  }
  const type = mm?.type ?? 'letters'
  let blocks: Block[]
  let page = { ...doc.page }
  if (type === 'labels' && mm?.label) {
    const s = mm.label
    blocks = labelPages(s, instances)
    // Largeur et hauteur rangées en portrait ; l'orientation dit le sens (planche à l'italienne).
    page = { ...page, size: 'custom', width: Math.min(s.pageWidth, s.pageHeight), height: Math.max(s.pageWidth, s.pageHeight), orientation: s.pageWidth > s.pageHeight ? 'landscape' : 'portrait', margins: { top: s.top, left: s.left, right: Math.max(0, Math.floor((s.pageWidth - s.left - s.cols * s.width - (s.cols - 1) * s.hgap) * 10) / 10), bottom: 0 }, header: 0, footer: 0 }
  } else if (type === 'directory') {
    blocks = instances.flat()
  } else {
    blocks = []
    instances.forEach((inst, k) => {
      if (k > 0) blocks.push({ type: 'section', start: 'page' })
      blocks.push(...inst)
    })
  }
  if (!blocks.length) blocks = [{ type: 'paragraph', content: [] }]
  const now = o.now ?? new Date().toISOString()
  const { mailMerge: _m, ...rest } = doc
  const out: FolioDoc = { ...rest, id: o.id, page, blocks, template: false, readOnly: false, meta: { ...doc.meta, created: now, modified: '' } }
  return { doc: out, count: instances.length, skipped }
}

/** Texte brut des blocs (corps d'un message électronique). */
export function plainText(blocks: Block[]): string {
  const inl = (items: Inline[]) => items.map((x) => ('type' in x ? (x.type === 'math' ? x.tex : '') : x.text)).join('')
  const lines: string[] = []
  for (const b of blocks) {
    if (b.type === 'paragraph' || b.type === 'heading') lines.push(inl(b.content))
    else if (b.type === 'list') for (const it of b.items) lines.push(`${'  '.repeat(it.level)}${it.style === 'number' ? '–' : '•'} ${inl(it.content)}`)
    else if (b.type === 'quote' || b.type === 'callout' || b.type === 'columns') lines.push(plainText(b.blocks))
    else if (b.type === 'table') for (const row of b.rows) lines.push(row.map((c) => plainText(c.blocks)).join('\t'))
    else if (b.type === 'code') lines.push(b.text)
  }
  return lines.join('\n\n')
}

export interface EmailMessage {
  to: string
  subject: string
  /** Texte brut du message. */
  body: string
  /** Le message mis en forme (pour un corps HTML). */
  blocks: Block[]
  index: number
}

/** Messages électroniques : un par destinataire (avec une adresse). */
export function emailMessages(doc: FolioDoc, fillins: Record<string, string> = {}): EmailMessage[] {
  const mm = doc.mailMerge
  if (!mm?.email) return []
  const out: EmailMessage[] = []
  const lang = (doc.meta.lang || 'fr').slice(0, 2)
  for (const r of recipients(mm)) {
    if (skips(doc.blocks, r)) continue
    const ctx: MergeContext = { mm, lang, r, sequence: out.length + 1, fillins, next: () => null }
    const blocks = mapBlocks(doc.blocks, ctx)
    out.push({ to: (r.values[mm.email.to] ?? '').trim(), subject: fillTokens(mm.email.subject, r), body: plainText(blocks), blocks, index: r.index })
  }
  return out
}

export interface MergeProblem {
  kind: 'no-source' | 'no-recipient' | 'unknown-field' | 'empty-value' | 'no-email' | 'bad-email' | 'unmapped'
  field?: string
  /** Numéro du destinataire (1…). */
  record?: number
}

/** Vérifier les erreurs : champs inconnus, valeurs vides, adresses électroniques manquantes. */
export function checkMerge(doc: FolioDoc): MergeProblem[] {
  const mm = doc.mailMerge
  if (!mm?.source) return [{ kind: 'no-source' }]
  const list = recipients(mm)
  if (!list.length) return [{ kind: 'no-recipient' }]
  const problems: MergeProblem[] = []
  const fields = mergeFields(doc.blocks)
  const columns = new Set(mm.source.fields)
  for (const name of new Set(fields.filter((f) => !f.name.startsWith('@')).map((f) => f.name))) if (!columns.has(name)) problems.push({ kind: 'unknown-field', field: name })
  if (fields.some((f) => f.name === '@address' || f.name === '@greeting') && !mm.map?.last && !mm.map?.first) problems.push({ kind: 'unmapped' })
  for (const r of list) {
    for (const name of new Set(fields.filter((f) => !f.name.startsWith('@') && columns.has(f.name)).map((f) => f.name))) {
      if (!(r.values[name] ?? '').trim()) problems.push({ kind: 'empty-value', field: name, record: r.index + 1 })
    }
    if (mm.type === 'emails' && mm.email) {
      const to = (r.values[mm.email.to] ?? '').trim()
      if (!to) problems.push({ kind: 'no-email', record: r.index + 1 })
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) problems.push({ kind: 'bad-email', record: r.index + 1, field: to })
    }
  }
  return problems.slice(0, 500)
}
