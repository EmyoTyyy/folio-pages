// Glossaire et abréviations : les termes définis une fois dans le document
// (FolioDoc.terms), retrouvés dans le texte sans marque invisible.
//
// Règles : mot entier ; une abréviation se cherche telle quelle (OMS, pas
// « oms ») ; un terme du glossaire sans tenir compte de la casse ; la forme du
// pluriel aussi, si elle est donnée.

import type { Block, Inline, Term } from './types'

export const TERM_LIMITS = { count: 2_000, term: 200, definition: 2_000 }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const BOUND_L = '(?<![\\p{L}\\p{N}_])'
const BOUND_R = '(?![\\p{L}\\p{N}_])'

/** Formes cherchées d'un terme : le terme, et son pluriel. */
const formsOf = (t: Term): string[] => [t.term, ...(t.plural ? [t.plural] : [])].map((f) => f.trim()).filter(Boolean)

export interface TermMatcher {
  /** Chaque occurrence d'un terme dans un texte : l'identifiant du terme et sa position. */
  scan(text: string): { id: string; index: number; length: number }[]
}

/** Prépare la recherche de tous les termes (deux expressions : avec et sans la casse). */
export function termMatcher(terms: Term[]): TermMatcher {
  const exact = new Map<string, string>()
  const loose = new Map<string, string>()
  for (const t of terms) {
    for (const f of formsOf(t)) {
      if (t.kind === 'abbreviation') exact.has(f) || exact.set(f, t.id)
      else loose.has(f.toLocaleLowerCase()) || loose.set(f.toLocaleLowerCase(), t.id)
    }
  }
  const build = (keys: string[], flags: string) => (keys.length ? new RegExp(`${BOUND_L}(?:${keys.sort((a, b) => b.length - a.length).map(esc).join('|')})${BOUND_R}`, flags) : null)
  const reExact = build([...exact.keys()], 'gu')
  const reLoose = build([...loose.keys()], 'giu')
  return {
    scan(text) {
      const out: { id: string; index: number; length: number }[] = []
      if (reExact) for (const m of text.matchAll(reExact)) out.push({ id: exact.get(m[0])!, index: m.index!, length: m[0].length })
      if (reLoose) for (const m of text.matchAll(reLoose)) out.push({ id: loose.get(m[0].toLocaleLowerCase())!, index: m.index!, length: m[0].length })
      return out.sort((a, b) => a.index - b.index)
    },
  }
}

/** Première occurrence de chaque terme, dans des textes donnés avec leur position de départ. */
export function firstUses(segments: Iterable<{ text: string; base: number }>, terms: Term[]): Map<string, number> {
  const m = termMatcher(terms)
  const seen = new Map<string, number>()
  for (const s of segments) for (const hit of m.scan(s.text)) if (!seen.has(hit.id)) seen.set(hit.id, s.base + hit.index)
  return seen
}

/** Termes d'un type, triés dans l'ordre alphabétique de la langue (accents compris). */
export function sortedTerms(terms: Term[], kind: Term['kind'], lang: string): Term[] {
  const coll = new Intl.Collator(lang || undefined, { sensitivity: 'base', numeric: true })
  return terms.filter((t) => t.kind === kind).sort((a, b) => coll.compare(a.term, b.term))
}

/**
 * Abréviations probables d'un texte : des mots en capitales (2 à 6 lettres,
 * chiffres admis : ADN, CO2), avec leur forme longue quand le texte dit
 * « forme longue (SIGLE) » ou « SIGLE (forme longue) ».
 */
export function detectAbbreviations(texts: Iterable<string>): { short: string; long: string }[] {
  const found = new Map<string, string>()
  const word = /(?<![\p{L}\p{N}])(\p{Lu}[\p{Lu}\p{N}]{1,5})(?![\p{L}\p{N}])/gu
  for (const text of texts) {
    for (const m of text.matchAll(word)) {
      const short = m[1]
      if (!/\p{Lu}.*\p{Lu}/u.test(short) && !/\p{N}/u.test(short)) continue
      if (!found.has(short)) found.set(short, '')
      if (found.get(short)) continue
      const before = text.slice(0, m.index)
      const after = text.slice(m.index! + short.length)
      // « Organisation mondiale de la santé (OMS) » : autant de mots avant que de lettres, à peu près.
      if (/\(\s*$/.test(before)) {
        // Les articles élidés (l’, d’, qu’) ne comptent pas dans les initiales.
        const words = before.replace(/\s*\(\s*$/, '').split(/\s+/).map((w) => w.replace(/^\p{L}{1,2}['’]/u, ''))
        const n = [...short].filter((c) => /\p{L}/u.test(c)).length
        for (let k = Math.max(1, n - 1); k <= Math.min(words.length, n + 4); k++) {
          const cand = words.slice(-k)
          const initials = cand.filter((w) => /^\p{Lu}/u.test(w) || w.length > 3).map((w) => w[0].toLocaleUpperCase()).join('')
          if (initials.replace(/\P{L}/gu, '') === short.replace(/\P{L}/gu, '') || (k >= n && cand[0][0]?.toLocaleUpperCase() === short[0])) {
            found.set(short, cand.join(' ').replace(/^[^\p{L}]+/u, ''))
            break
          }
        }
      } else {
        const paren = /^\s*\(([^()]{4,120})\)/u.exec(after)
        if (paren && paren[1].split(/\s+/).length >= 2) found.set(short, paren[1].trim())
      }
    }
  }
  return [...found].map(([short, long]) => ({ short, long }))
}

/** Abréviations utilisées avant que leur forme longue n'apparaisse (ou jamais développées). */
export function unexpandedFirstUses(segments: { text: string; base: number }[], terms: Term[]): { id: string; pos: number }[] {
  const out: { id: string; pos: number }[] = []
  for (const t of terms) {
    if (t.kind !== 'abbreviation' || !t.definition) continue
    const first = firstUses(segments, [t]).get(t.id)
    if (first === undefined) continue
    const long = t.definition.toLocaleLowerCase()
    const at = segments.find((s) => s.text.toLocaleLowerCase().includes(long))
    const longPos = at ? at.base + at.text.toLocaleLowerCase().indexOf(long) : Infinity
    // Bon : la forme longue avant (« … santé (OMS) »), ou juste après dans le même paragraphe (« OMS (Organisation…) »).
    const seg = segments.find((s) => first >= s.base && first <= s.base + s.text.length)
    const right = longPos <= first || (!!seg && longPos <= first + 12 && longPos <= seg.base + seg.text.length)
    if (!right) out.push({ id: t.id, pos: first })
  }
  return out.sort((a, b) => a.pos - b.pos)
}

/** Texte de chaque paragraphe d'une suite de blocs (notes, légendes et cellules compris). */
export function paragraphTexts(blocks: Block[], out: string[] = []): string[] {
  const inl = (items: Inline[]) => {
    let s = ''
    for (const x of items) {
      if (!('type' in x)) s += x.deleted ? '' : x.text
      else if (x.type === 'note') paragraphTexts(x.blocks, out)
      else s += ' '
    }
    out.push(s)
  }
  for (const b of blocks) {
    if (b.type === 'paragraph' || b.type === 'heading') inl(b.content)
    else if (b.type === 'list') for (const it of b.items) inl(it.content)
    else if (b.type === 'table') for (const r of b.rows) for (const c of r) paragraphTexts(c.blocks, out)
    else if (b.type === 'image') inl(b.caption)
    else if (b.type === 'quote' || b.type === 'callout' || b.type === 'columns') paragraphTexts(b.blocks, out)
  }
  return out
}

/** Termes d'un document à lister : triés, et seulement ceux du texte (sauf « all »). */
export function termsToList(doc: { blocks: Block[]; terms?: Term[]; meta: { lang: string } }, kind: Term['kind'], all: boolean, locale = ''): Term[] {
  const terms = doc.terms ?? []
  if (!terms.length) return []
  const sorted = sortedTerms(terms, kind, doc.meta.lang || locale)
  if (all) return sorted
  const m = termMatcher(sorted)
  const used = new Set<string>()
  for (const text of paragraphTexts(doc.blocks)) for (const hit of m.scan(text)) used.add(hit.id)
  return sorted.filter((x) => used.has(x.id))
}
