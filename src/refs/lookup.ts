// Retrouver une source par son DOI (Crossref) ou son ISBN (Open Library).
//
// Fonction réseau facultative : elle passe par netFetch (refusée en mode hors
// ligne, https seulement, sans cookie ni référent). Seul l'identifiant est
// envoyé. Les réponses sont lues comme des données : chaque champ est vérifié
// et borné, rien n'est interprété.

import type { Source, SourceType } from '../format/types'
import { netFetch } from '../net'

export type Identifier = { kind: 'doi'; value: string } | { kind: 'isbn'; value: string }

/** DOI (avec ou sans https://doi.org/, « doi: ») ou ISBN-10/13 (tirets et espaces admis). */
export function parseIdentifier(input: string): Identifier | null {
  const s = input.trim()
  const doi = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/\S+)$/i.exec(s)
  if (doi) return { kind: 'doi', value: doi[1].replace(/[.,;]+$/, '') }
  const digits = s.replace(/^isbn(?:-1[03])?:?\s*/i, '').replace(/[\s-]/g, '')
  if (/^\d{9}[\dXx]$/.test(digits) && isbn10ok(digits)) return { kind: 'isbn', value: digits.toUpperCase() }
  if (/^97[89]\d{10}$/.test(digits) && isbn13ok(digits)) return { kind: 'isbn', value: digits }
  return null
}

function isbn10ok(s: string): boolean {
  let sum = 0
  for (let i = 0; i < 10; i++) sum += (s[i].toUpperCase() === 'X' ? 10 : Number(s[i])) * (10 - i)
  return sum % 11 === 0
}

function isbn13ok(s: string): boolean {
  let sum = 0
  for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1)
  return sum % 10 === 0
}

const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '')
const first = (v: unknown, max = 500): string => (Array.isArray(v) ? str(v[0], max) : str(v, max))

/** « Prénom Nom » → « Nom, Prénom » (le dernier mot est le nom). */
export function invertName(full: string): string {
  const parts = full.trim().split(/\s+/)
  if (parts.length < 2) return full.trim()
  const particles = new Set(['de', 'du', 'des', 'van', 'von', 'der', 'den', 'da', 'di', 'la', 'le'])
  let k = parts.length - 1
  while (k > 1 && particles.has(parts[k - 1].toLowerCase())) k--
  return `${parts.slice(k).join(' ')}, ${parts.slice(0, k).join(' ')}`
}

const CROSSREF_TYPES: Record<string, SourceType> = {
  'journal-article': 'article',
  'book-chapter': 'chapter',
  'book-section': 'chapter',
  'book-part': 'chapter',
  book: 'book',
  monograph: 'book',
  'edited-book': 'book',
  'reference-book': 'book',
  'proceedings-article': 'conference',
  proceedings: 'conference',
  report: 'report',
  dissertation: 'thesis',
  'posted-content': 'article',
}

/** Réponse de Crossref (GET /works/{doi}) → source (sans identifiant). */
export function fromCrossref(json: unknown): Omit<Source, 'id'> | null {
  const msg = (json as { message?: Record<string, unknown> } | null)?.message
  if (!msg || typeof msg !== 'object') return null
  const title = first(msg.title, 1000)
  if (!title) return null
  const authors = (Array.isArray(msg.author) ? msg.author : [])
    .slice(0, 30)
    .map((a: Record<string, unknown>) => (a.family ? `${str(a.family, 100)}${a.given ? `, ${str(a.given, 100)}` : ''}` : str(a.name, 200)))
    .filter(Boolean)
  const editors = (Array.isArray(msg.editor) ? msg.editor : []).slice(0, 20).map((a: Record<string, unknown>) => (a.family ? `${str(a.family, 100)}${a.given ? `, ${str(a.given, 100)}` : ''}` : str(a.name, 200))).filter(Boolean)
  const dateParts = ((msg.issued ?? msg.published ?? msg['published-print'] ?? msg['published-online']) as { 'date-parts'?: unknown[][] } | undefined)?.['date-parts']?.[0]
  const year = Array.isArray(dateParts) && typeof dateParts[0] === 'number' ? String(dateParts[0]) : ''
  const out: Omit<Source, 'id'> = { type: CROSSREF_TYPES[str(msg.type, 40)] ?? 'other', authors, title }
  const container = first(msg['container-title'], 500)
  if (container) out.container = container
  if (editors.length) out.editors = editors
  const put = (k: 'publisher' | 'volume' | 'issue' | 'pages' | 'place', v: string) => v && (out[k] = v)
  put('publisher', str(msg.publisher, 300))
  put('volume', str(msg.volume, 40))
  put('issue', str(msg.issue, 40))
  put('pages', str(msg.page, 40))
  put('place', first(msg['publisher-location'], 200))
  if (year) out.year = year
  const doi = str(msg.DOI, 200)
  if (/^10\.\d{4,9}\/\S+$/.test(doi)) out.doi = doi
  const isbn = first(msg.ISBN, 20).replace(/[^0-9Xx]/g, '')
  if (isbn.length === 10 || isbn.length === 13) out.isbn = isbn
  return out
}

/** Réponse d'Open Library (api/books?jscmd=data) → source (sans identifiant). */
export function fromOpenLibrary(json: unknown, isbn: string): Omit<Source, 'id'> | null {
  if (!json || typeof json !== 'object') return null
  const rec = (json as Record<string, Record<string, unknown>>)[`ISBN:${isbn}`]
  if (!rec || typeof rec !== 'object') return null
  const title = [str(rec.title, 800), str(rec.subtitle, 400)].filter(Boolean).join(' : ')
  if (!title) return null
  const names = (v: unknown, max: number) => (Array.isArray(v) ? v : []).slice(0, max).map((a: Record<string, unknown>) => str(a?.name, 200)).filter(Boolean)
  const out: Omit<Source, 'id'> = { type: 'book', authors: names(rec.authors, 30).map(invertName), title, isbn }
  const publisher = names(rec.publishers, 1)[0]
  if (publisher) out.publisher = publisher
  const place = names(rec.publish_places, 1)[0]
  if (place) out.place = place
  const year = /\d{4}/.exec(str(rec.publish_date, 40))?.[0]
  if (year) out.year = year
  return out
}

/** Va chercher la notice. Lève OfflineError hors ligne, une erreur si le réseau échoue ; null si rien n'est trouvé. */
export async function lookupIdentifier(id: Identifier): Promise<Omit<Source, 'id'> | null> {
  if (id.kind === 'doi') {
    const res = await netFetch(`https://api.crossref.org/works/${encodeURIComponent(id.value)}`, { headers: { Accept: 'application/json' } })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return fromCrossref(await readJson(res))
  }
  const res = await netFetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${id.value}&format=json&jscmd=data`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return fromOpenLibrary(await readJson(res), id.value)
}

/** Lecture bornée : une notice ne pèse jamais 2 Mo. */
async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (text.length > 2_000_000) throw new Error('too large')
  return JSON.parse(text)
}

/** Un nom de balise libre, à la manière habituelle : « Darwin1859 », « Darwin1859a »… */
export function suggestId(src: Pick<Source, 'authors' | 'title' | 'year'>, taken: Set<string>): string {
  const who = (src.authors[0] ?? src.title ?? 'Source').split(',')[0]
  const base =
    (who
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .slice(0, 30) || 'Source') + (/\d{4}/.exec(src.year ?? '')?.[0] ?? '')
  if (!taken.has(base)) return base
  for (let i = 0; i < 26; i++) {
    const c = base + String.fromCharCode(97 + i)
    if (!taken.has(c)) return c
  }
  let k = 2
  while (taken.has(`${base}_${k}`)) k++
  return `${base}_${k}`
}
