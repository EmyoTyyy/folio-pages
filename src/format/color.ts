// Couleurs du format : #rrggbb, couleur du thème (accent1…), quelques noms CSS
// courants (ramenés à leur valeur hexadécimale), surlignages nommés.

import { HIGHLIGHTS, THEME_COLORS } from './types'

const CSS_NAMES: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#e03131',
  green: '#2f9e44',
  blue: '#1971c2',
  yellow: '#f5c518',
  orange: '#f08c00',
  purple: '#7048e8',
  violet: '#7048e8',
  pink: '#e64980',
  brown: '#8b5a2b',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  navy: '#1c2d5a',
  teal: '#0c8599',
  maroon: '#800000',
  olive: '#808000',
  lime: '#74b816',
  aqua: '#15aabf',
  cyan: '#15aabf',
  magenta: '#c2255c',
  fuchsia: '#c2255c',
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

const isThemeColor = (s: string) => (THEME_COLORS as readonly string[]).includes(s)

/** Couleur canonique (#rrggbb en minuscules, ou nom de couleur du thème), sinon null. */
export function parseColor(input: string, allowTheme = true): string | null {
  const s = input.trim().toLowerCase()
  if (!s || s.length > 30) return null
  if (allowTheme && isThemeColor(s)) return s
  const m = HEX.exec(s)
  if (m) return m[1].length === 3 ? `#${[...m[1]].map((c) => c + c).join('')}` : `#${m[1]}`
  return Object.prototype.hasOwnProperty.call(CSS_NAMES, s) ? CSS_NAMES[s] : null
}

export const isColor = (s: string): boolean => parseColor(s) !== null
export const isHexColor = (s: string): boolean => parseColor(s, false) !== null

/** Surlignage : nom de surligneur ou couleur. */
export function parseHighlight(input: string): string | null {
  const s = input.trim().toLowerCase()
  if ((HIGHLIGHTS as readonly string[]).includes(s)) return s
  if (s === 'grey') return 'gray'
  if (s === 'magenta') return 'pink'
  return parseColor(s, false)
}

export const isHighlight = (s: string): boolean => parseHighlight(s) !== null

/** Valeurs d'affichage des surligneurs (lisibles sous du texte noir). */
export const HIGHLIGHT_VALUES: Record<string, string> = {
  yellow: '#fff176',
  green: '#b9f6ca',
  cyan: '#b2ebf2',
  pink: '#f8bbd0',
  blue: '#bbdefb',
  red: '#ffcdd2',
  orange: '#ffe0b2',
  purple: '#e1bee7',
  gray: '#e0e0e0',
}

/** Valeur CSS d'une couleur canonique (les couleurs du thème sont des variables). */
export function cssColor(c: string): string {
  if (isThemeColor(c)) return `var(--doc-${c})`
  return c
}

export function cssHighlight(c: string): string {
  return Object.prototype.hasOwnProperty.call(HIGHLIGHT_VALUES, c) ? HIGHLIGHT_VALUES[c] : c
}

/** Nom de police acceptable : lettres, chiffres, espaces et quelques signes, jamais de CSS. */
export function isFontName(s: string): boolean {
  return s.trim().length > 0 && s.length <= 100 && /^[\p{L}\p{N} ._'-]+$/u.test(s)
}
