// Encadrés : titres par défaut, couleurs et symboles, communs à l'éditeur et
// aux exports. Le titre par défaut suit la langue du document.

import type { CalloutKind } from './types'

const LABELS: Record<'fr' | 'en', Record<CalloutKind, string>> = {
  fr: { note: 'Remarque', tip: 'Astuce', important: 'Important', warning: 'Avertissement', caution: 'Attention' },
  en: { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' },
}

/** Titre par défaut d'un encadré, dans la langue du document (anglais hors français). */
export function calloutLabel(kind: CalloutKind | string, lang: string): string {
  const table = /^fr\b/i.test(lang) ? LABELS.fr : LABELS.en
  return table[(kind in table ? kind : 'note') as CalloutKind]
}

/** Couleur de chaque type (barre, icône) et teinte de fond, lisibles à l'impression. */
export const CALLOUT_COLORS: Record<CalloutKind, { bar: string; fill: string }> = {
  note: { bar: '#2f6fb3', fill: '#eaf2fb' },
  tip: { bar: '#2e8540', fill: '#e9f5ec' },
  important: { bar: '#7a4bb5', fill: '#f2ecfa' },
  warning: { bar: '#b7791f', fill: '#fdf3e1' },
  caution: { bar: '#c0392b', fill: '#fbeaea' },
}

/** Symbole du type, là où une icône n'est pas possible (texte, .docx, .odt). */
export const CALLOUT_SYMBOLS: Record<CalloutKind, string> = { note: 'ℹ', tip: '✦', important: '❗', warning: '⚠', caution: '⛔' }

/** Style de tableau .docx d'un encadré (« FolioCalloutNote »…), et l'inverse. */
export const calloutStyleId = (kind: CalloutKind): string => `FolioCallout${kind[0].toUpperCase()}${kind.slice(1)}`
export function calloutKindOfStyle(id: string | null | undefined): CalloutKind | null {
  const m = /^FolioCallout(Note|Tip|Important|Warning|Caution)$/.exec(id ?? '')
  return m ? (m[1].toLowerCase() as CalloutKind) : null
}

/** Le titre est-il celui par défaut (en français ou en anglais) ? Il n'est alors pas gardé. */
export const isDefaultCalloutTitle = (kind: CalloutKind, title: string): boolean => title === calloutLabel(kind, 'fr') || title === calloutLabel(kind, 'en')
