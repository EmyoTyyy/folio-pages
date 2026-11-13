// Rechercher et dictionnaire des synonymes en ligne : résumé Wikipédia,
// définitions et synonymes du Wiktionnaire (anglais : définitions du
// Wiktionary, synonymes de Datamuse).
//
// Fonction réseau facultative (netFetch : refusée hors ligne). Seul le mot
// cherché est envoyé. Les réponses sont des données : texte brut, bornées.

import { netFetch } from '../net'

export interface Summary {
  title: string
  extract: string
  url: string
}

export interface Definitions {
  /** Sens, par nature (nom, verbe…). */
  senses: { pos: string; items: string[] }[]
  synonyms: string[]
  antonyms: string[]
  url: string
}

const LANGS = /^[a-z]{2,3}$/

export const baseOf = (lang: string): string => {
  const l = lang.slice(0, 2).toLowerCase()
  return LANGS.test(l) ? l : 'en'
}

const plain = (s: string, max = 600) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

/** Un terme cherchable : quelques mots, sans retour à la ligne. */
export const cleanTerm = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 120)

// --- Wikipédia --------------------------------------------------------------------

export function parseSummary(json: unknown): Summary | null {
  const o = json as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || o.type === 'disambiguation' && !o.extract) return null
  const extract = plain(String(o.extract ?? ''), 1500)
  if (!extract) return null
  const url = String((o.content_urls as { desktop?: { page?: string } } | undefined)?.desktop?.page ?? '')
  return { title: plain(String(o.title ?? ''), 200), extract, url: /^https:\/\/[a-z-]+\.wikipedia\.org\//.test(url) ? url : '' }
}

export async function wikipediaSummary(term: string, lang: string): Promise<Summary | null> {
  const t = cleanTerm(term)
  if (!t) return null
  const res = await netFetch(`https://${baseOf(lang)}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}?redirect=true`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return parseSummary(JSON.parse((await res.text()).slice(0, 2_000_000)))
}

// --- Wiktionnaire (wikitexte de la page, toutes langues) ----------------------------

/** En-têtes de section du Wiktionnaire français : nature du mot. */
const FR_POS: Record<string, string> = {
  nom: 'nom',
  'nom commun': 'nom',
  verbe: 'verbe',
  adjectif: 'adjectif',
  adverbe: 'adverbe',
  interjection: 'interjection',
  pronom: 'pronom',
  préposition: 'préposition',
  conjonction: 'conjonction',
  'nom propre': 'nom propre',
}

/** Retire les modèles et liens du wikitexte : « [[chat|chats]] » → « chats ». */
export function wikiPlain(s: string): string {
  let out = s
  // Modèles imbriqués : du plus profond au plus large.
  for (let i = 0; i < 5 && /\{\{[^{}]*\}\}/.test(out); i++) {
    out = out.replace(/\{\{([^{}]*)\}\}/g, (_m, inner: string) => {
      const parts = inner.split('|')
      const name = parts[0].trim().toLowerCase()
      // Modèles de lien : on garde le mot ; les autres (étiquettes, registres) entre parenthèses ou rien.
      if (['lien', 'l', 'w', 'm', 'term'].includes(name)) return parts[1] ?? ''
      if (['term', 'figuré', 'familier', 'vieilli', 'soutenu', 'populaire', 'péjoratif', 'littéraire', 'désuet', 'rare'].includes(name)) return `(${name})`
      return ''
    })
  }
  return out
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<ref[^>]*>.*?<\/ref>|<ref[^/]*\/>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Wikitexte d'une page du Wiktionnaire français → définitions et synonymes de
 * la section de la langue voulue (code « fr », « en »…).
 */
export function parseFrWiktionary(wikitext: string, lang = 'fr'): Omit<Definitions, 'url'> {
  const out: Omit<Definitions, 'url'> = { senses: [], synonyms: [], antonyms: [] }
  const text = wikitext.slice(0, 1_000_000)
  // Section de la langue : « == {{langue|fr}} == » jusqu'à la suivante.
  const start = text.search(new RegExp(`==\\s*\\{\\{langue\\|${lang}\\}\\}\\s*==`))
  if (start < 0) return out
  const rest = text.slice(start + 5)
  const next = rest.search(/\n==\s*\{\{langue\|/)
  const section = next < 0 ? rest : rest.slice(0, next)
  let pos = ''
  let mode: 'def' | 'syn' | 'ant' | '' = ''
  for (const raw of section.split('\n')) {
    const line = raw.trim()
    const head = /^=+\s*\{\{S\|([^|}]+)/.exec(line)
    if (head) {
      const name = head[1].trim().toLowerCase()
      if (FR_POS[name]) {
        pos = FR_POS[name]
        mode = 'def'
        out.senses.push({ pos, items: [] })
      } else if (name === 'synonymes') mode = 'syn'
      else if (name === 'antonymes') mode = 'ant'
      else mode = ''
      continue
    }
    if (mode === 'def' && /^#[^*:#]/.test(line)) {
      const def = wikiPlain(line.replace(/^#\s*/, ''))
      const cur = out.senses[out.senses.length - 1]
      if (def && cur && cur.items.length < 8) cur.items.push(def.slice(0, 400))
    } else if ((mode === 'syn' || mode === 'ant') && /^\*/.test(line)) {
      const words = [...line.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim())
      const list = mode === 'syn' ? out.synonyms : out.antonyms
      for (const w of words) if (w && !list.includes(w) && list.length < 40) list.push(w)
    }
  }
  out.senses = out.senses.filter((s) => s.items.length)
  return out
}

/** Définitions du Wiktionary anglais (API REST « definition »), pour la langue voulue. */
export function parseEnDefinitions(json: unknown, lang = 'en'): { pos: string; items: string[] }[] {
  const list = (json as Record<string, unknown[]> | null)?.[lang]
  if (!Array.isArray(list)) return []
  return list.slice(0, 10).map((entry) => {
    const e = entry as { partOfSpeech?: string; definitions?: { definition?: string }[] }
    return {
      pos: plain(String(e.partOfSpeech ?? ''), 40).toLowerCase(),
      items: (e.definitions ?? [])
        .map((d) => plain(String(d.definition ?? ''), 400))
        .filter(Boolean)
        .slice(0, 8),
    }
  }).filter((s) => s.items.length)
}

/** Datamuse : synonymes (anglais). */
export function parseDatamuse(json: unknown): string[] {
  return Array.isArray(json) ? json.slice(0, 40).map((x) => plain(String((x as { word?: string }).word ?? ''), 60)).filter(Boolean) : []
}

export async function definitions(term: string, lang: string): Promise<Definitions | null> {
  const t = cleanTerm(term)
  if (!t) return null
  const l = baseOf(lang)
  const slug = encodeURIComponent(t.replace(/ /g, '_'))
  if (l === 'fr') {
    // Le Wiktionnaire français : définitions et synonymes.
    const res = await netFetch(`https://fr.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(t)}&prop=wikitext&format=json&formatversion=2&redirects=1&origin=*`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = JSON.parse((await res.text()).slice(0, 5_000_000)) as { parse?: { wikitext?: string; title?: string } }
    const wikitext = json.parse?.wikitext
    if (!wikitext) return null
    const parsed = parseFrWiktionary(wikitext, 'fr')
    if (!parsed.senses.length && !parsed.synonyms.length) return null
    return { ...parsed, url: `https://fr.wiktionary.org/wiki/${encodeURIComponent(json.parse?.title ?? t)}` }
  }
  // Les autres langues : le Wiktionary anglais (définitions classées par langue) ; synonymes anglais par Datamuse.
  const [defs, syns] = await Promise.all([
    netFetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${slug}`).then(async (r) => (r.ok ? parseEnDefinitions(JSON.parse((await r.text()).slice(0, 2_000_000)), l) : [])),
    l === 'en' ? netFetch(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(t)}&max=30`).then(async (r) => (r.ok ? parseDatamuse(JSON.parse((await r.text()).slice(0, 500_000))) : [])) : Promise.resolve([] as string[]),
  ])
  if (!defs.length && !syns.length) return null
  return { senses: defs, synonyms: syns, antonyms: [], url: `https://en.wiktionary.org/wiki/${slug}` }
}
