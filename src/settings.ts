// Préférences de l'utilisateur, gardées dans ce navigateur seulement (jamais
// dans le fichier) : elles valent pour tous les documents.

export interface Settings {
  /** Réduire les photos à l'insertion (2560 px). */
  reduceImages: boolean
  /** Markdown à la frappe (# titre, **gras**…). */
  markdownTyping: boolean
  spellcheck: boolean
  /** Afficher les marques de paragraphe et les caractères invisibles. */
  showMarks: boolean
  /** Zoom de la page, 0,25 à 4. */
  zoom: number
  ribbonCollapsed: boolean
  /** Le ruban se replie quand on fait défiler le document vers le bas. */
  ribbonAutoHide: boolean
  /** Mode hors ligne : aucune fonction réseau (images du web, liens, mises à jour, langues). */
  offline: boolean
  /** Vue page (feuilles séparées) ou vue web (texte continu). */
  view: 'page' | 'web' | 'draft'
  /** Afficher la règle. */
  ruler: boolean
  /** Apparence de l'interface. */
  appearance: 'system' | 'light' | 'dark'
  /** Volet de navigation affiché. */
  navPane: boolean
  /** Volet des commentaires affiché. */
  commentsPane: boolean
  /** Nom affiché avec vos commentaires (demandé une fois, gardé dans ce navigateur seulement). */
  authorName: string
  /** Affichage des modifications suivies : toutes les marques, version finale, original. */
  trackView: 'all' | 'final' | 'original'
  /** Publipostage : messagerie qui ouvre les messages (celle de l'ordinateur, Gmail, Outlook.com). */
  mailVia: 'app' | 'gmail' | 'outlook'
  /** Correction automatique pendant la frappe. */
  autoCorrect: boolean
  /** Guillemets et apostrophes typographiques. */
  acQuotes: boolean
  /** Espaces insécables avant ; : ! ? et dans « » (documents en français). */
  acFrenchSpacing: boolean
  /** Remplacer pendant la frappe (fautes courantes, symboles). */
  acReplace: boolean
  /** Majuscule en début de phrase. */
  acCapitalize: boolean
  /** Remplacements ajoutés ou modifiés : [tapé, remplacement]. */
  acCustom: [string, string][]
  /** Remplacements d'origine retirés (ce qu'on tape). */
  acRemoved: string[]
  /** « Définir par défaut » : thème, styles et mise en page des nouveaux documents (ou null). */
  defaultDesign: { theme: unknown; styles: unknown; page: unknown } | null
}

const KEY = 'folio-pages:settings'
const DEFAULTS: Settings = { reduceImages: true, markdownTyping: true, spellcheck: true, showMarks: false, zoom: 1, ribbonCollapsed: false, ribbonAutoHide: true, offline: false, view: 'page', ruler: true, appearance: 'system', navPane: false, commentsPane: true, authorName: '', trackView: 'all', mailVia: 'app', autoCorrect: true, acQuotes: true, acFrenchSpacing: true, acReplace: true, acCapitalize: false, acCustom: [], acRemoved: [], defaultDesign: null }

let current: Settings = load()
const listeners = new Set<(s: Settings) => void>()

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>
    const out = { ...DEFAULTS }
    for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
      if (typeof raw[k] === typeof DEFAULTS[k]) (out as Record<string, unknown>)[k] = raw[k]
    }
    out.zoom = Math.min(4, Math.max(0.25, Number(out.zoom) || 1))
    if (out.view !== 'page' && out.view !== 'web' && out.view !== 'draft') out.view = 'page'
    if (!['system', 'light', 'dark'].includes(out.appearance)) out.appearance = 'system'
    out.authorName = out.authorName.trim().slice(0, 100)
    if (!['all', 'final', 'original'].includes(out.trackView)) out.trackView = 'all'
    if (!['app', 'gmail', 'outlook'].includes(out.mailVia)) out.mailVia = 'app'
    // Listes de correction automatique : bornées, chaque entrée vérifiée.
    out.acCustom = Array.isArray(out.acCustom)
      ? out.acCustom.filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string' && e[0].length <= 40 && e[1].length <= 200).slice(0, 500)
      : []
    // Les réglages par défaut passent par le chargement tolérant du format quand on s'en sert.
    if (out.defaultDesign !== null && (typeof out.defaultDesign !== 'object' || Array.isArray(out.defaultDesign))) out.defaultDesign = null
    out.acRemoved = Array.isArray(out.acRemoved) ? out.acRemoved.filter((e): e is string => typeof e === 'string' && e.length <= 40).slice(0, 500) : []
    return out
  } catch {
    return { ...DEFAULTS }
  }
}

export const settings = (): Settings => current

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* stockage indisponible : la préférence vaut pour cette session */
  }
  for (const fn of listeners) fn(current)
}

/** Applique l'apparence choisie à la page. */
export function applyAppearance(): void {
  document.documentElement.dataset.appearance = current.appearance
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
