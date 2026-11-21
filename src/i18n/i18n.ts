// Traductions : un dictionnaire unique (dict.ts), une entrée par phrase et une
// colonne par langue. Le français est la langue de référence : toute entrée a
// sa colonne française, et une langue incomplète retombe sur le français.

import { DICT, type Key } from './dict'

export const LANGUAGES = ['fr', 'en'] as const
export type Lang = (typeof LANGUAGES)[number]
export const LANGUAGE_NAMES: Record<Lang, string> = { fr: 'Français', en: 'English' }

export type Entry = string | { one: string; other: string }
export type Params = Record<string, string | number>

/**
 * Paquet de langue (phase 7) : les phrases d'une langue de plus. Une phrase
 * absente retombe sur l'anglais. Validé avant d'arriver ici (ui/packs.ts).
 */
export interface LangPack {
  lang: string
  name: string
  version: string
  strings: Record<string, Entry>
}

const packs = new Map<string, LangPack>()

const STORAGE_KEY = 'folio-pages:lang'
let current: string = 'fr'
/** Dernière langue intégrée choisie : on y revient quand le paquet en cours est retiré. */
let lastBuiltin: Lang = 'fr'
const listeners = new Set<(lang: string) => void>()

const isLang = (l: unknown): l is Lang => typeof l === 'string' && (LANGUAGES as readonly string[]).includes(l)
const isKnown = (l: unknown): l is string => isLang(l) || (typeof l === 'string' && packs.has(l))

export function registerPack(p: LangPack): void {
  if (isLang(p.lang)) return
  packs.set(p.lang, p)
}

export function unregisterPack(code: string): void {
  packs.delete(code)
  if (current === code) setLang(lastBuiltin)
}

export const packList = (): LangPack[] => [...packs.values()]
export const packOf = (code: string): LangPack | undefined => packs.get(code)

/** Langues proposées : les deux intégrées, puis celles des paquets. */
export function availableLanguages(): { code: string; name: string; pack: boolean }[] {
  return [...LANGUAGES.map((l) => ({ code: l as string, name: LANGUAGE_NAMES[l], pack: false })), ...packList().map((p) => ({ code: p.lang, name: p.name, pack: true }))]
}

/** Langue de référence pour ce qui n'existe qu'en français et en anglais (document de démonstration). */
export const baseLang = (): Lang => (current === 'fr' ? 'fr' : 'en')

/** Langue choisie par l'utilisateur, sinon celle du navigateur, sinon le français. */
export function detectLang(): string {
  // La langue intégrée du navigateur : le repli si un paquet choisi est retiré.
  const prefs = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language] : []
  const builtin = prefs.map((p) => String(p ?? '').toLowerCase().split('-')[0]).find(isLang)
  if (builtin) lastBuiltin = builtin
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLang(saved)) lastBuiltin = saved
    if (isKnown(saved)) return saved
  } catch {
    /* stockage indisponible (fichier local sous Firefox, navigation privée…) */
  }
  for (const p of prefs) {
    const base = String(p ?? '').toLowerCase().split('-')[0]
    if (isKnown(base)) return base
  }
  return 'fr'
}

export const lang = (): string => current

export function setLang(l: string, remember = true): void {
  if (!isKnown(l)) return
  current = l
  if (isLang(l)) lastBuiltin = l
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* rien à faire */
    }
  }
  for (const fn of listeners) fn(l)
}

export function onLangChange(fn: (lang: string) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const rules = new Map<string, Intl.PluralRules>()
const pluralOf = (l: string, n: number) => {
  if (!rules.has(l)) {
    let r: Intl.PluralRules
    try {
      r = new Intl.PluralRules(l)
    } catch {
      r = new Intl.PluralRules('en')
    }
    rules.set(l, r)
  }
  return rules.get(l)!.select(n) === 'one' ? 'one' : 'other'
}

/** Texte traduit ; `{nom}` est remplacé par params.nom, et `n` choisit le pluriel. */
export function t(key: Key, params: Params = {}, l: string = current): string {
  const row = DICT[key] as Partial<Record<Lang, Entry>>
  const entry = isLang(l) ? (row[l] ?? row.fr!) : (packs.get(l)?.strings[key] ?? row.en ?? row.fr!)
  const text = typeof entry === 'string' ? entry : entry[pluralOf(l, Number(params.n ?? 0))]
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m))
}

/** Taille de fichier lisible (« 12 ko », « 3,4 Mo ») dans la langue de l'interface. */
export function fileSize(bytes: number, l: string = current): string {
  const [unit, v] = bytes >= 1_000_000 ? ['megabyte', bytes / 1_000_000] : bytes >= 1000 ? ['kilobyte', bytes / 1000] : ['byte', bytes]
  try {
    return new Intl.NumberFormat(l, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: v < 10 && unit !== 'byte' ? 1 : 0 }).format(v)
  } catch {
    return `${Math.round(bytes / 1000)} kB`
  }
}

/** Date et heure lisibles dans la langue de l'interface. */
export function formatDate(at: number | string, l: string = current): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return String(at)
  // La variante régionale du navigateur (en-GB, fr-CA…) quand elle correspond à la langue choisie.
  const prefs = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language] : []
  const regional = prefs.find((p) => typeof p === 'string' && p.toLowerCase().split('-')[0] === l)
  try {
    return new Intl.DateTimeFormat(regional ?? l, { dateStyle: 'long', timeStyle: 'short' }).format(d)
  } catch {
    return new Intl.DateTimeFormat(l, { dateStyle: 'long', timeStyle: 'short' }).format(d)
  }
}
