// Polices en ligne (Google Fonts) : une liste choisie de polices sous licence
// libre (SIL OFL ou Apache 2.0), téléchargées puis intégrées au document. Elles
// voyagent ensuite avec le fichier et marchent hors ligne.
//
// Fonction réseau facultative (netFetch : refusée hors ligne). On demande la
// feuille de style « css2 » (sans clé), on garde les sous-ensembles latin et
// latin étendu, on télécharge leurs fichiers .woff2.

import type { FontFace } from '../format/types'
import { UNICODE_RANGE } from '../format/types'
import { netFetch } from '../net'

export type FontCategory = 'serif' | 'sans' | 'display' | 'hand' | 'mono'

/** Polices proposées : licence vérifiée (OFL ou Apache 2.0), latin étendu, plusieurs graisses. */
export const GOOGLE_FONTS: { family: string; category: FontCategory; license: 'OFL' | 'Apache' }[] = [
  { family: 'Lora', category: 'serif', license: 'OFL' },
  { family: 'Merriweather', category: 'serif', license: 'OFL' },
  { family: 'Playfair Display', category: 'serif', license: 'OFL' },
  { family: 'EB Garamond', category: 'serif', license: 'OFL' },
  { family: 'Libre Baskerville', category: 'serif', license: 'OFL' },
  { family: 'Crimson Pro', category: 'serif', license: 'OFL' },
  { family: 'Source Serif 4', category: 'serif', license: 'OFL' },
  { family: 'PT Serif', category: 'serif', license: 'OFL' },
  { family: 'Noto Serif', category: 'serif', license: 'OFL' },
  { family: 'Cormorant Garamond', category: 'serif', license: 'OFL' },
  { family: 'Spectral', category: 'serif', license: 'OFL' },
  { family: 'Alegreya', category: 'serif', license: 'OFL' },
  { family: 'Bitter', category: 'serif', license: 'OFL' },
  { family: 'Inter', category: 'sans', license: 'OFL' },
  { family: 'Roboto', category: 'sans', license: 'OFL' },
  { family: 'Open Sans', category: 'sans', license: 'OFL' },
  { family: 'Lato', category: 'sans', license: 'OFL' },
  { family: 'Montserrat', category: 'sans', license: 'OFL' },
  { family: 'Source Sans 3', category: 'sans', license: 'OFL' },
  { family: 'Noto Sans', category: 'sans', license: 'OFL' },
  { family: 'Work Sans', category: 'sans', license: 'OFL' },
  { family: 'Nunito', category: 'sans', license: 'OFL' },
  { family: 'IBM Plex Sans', category: 'sans', license: 'OFL' },
  { family: 'Fira Sans', category: 'sans', license: 'OFL' },
  { family: 'Raleway', category: 'sans', license: 'OFL' },
  { family: 'Lexend', category: 'sans', license: 'OFL' },
  { family: 'Oswald', category: 'display', license: 'OFL' },
  { family: 'Bebas Neue', category: 'display', license: 'OFL' },
  { family: 'Abril Fatface', category: 'display', license: 'OFL' },
  { family: 'Righteous', category: 'display', license: 'OFL' },
  { family: 'Caveat', category: 'hand', license: 'OFL' },
  { family: 'Dancing Script', category: 'hand', license: 'OFL' },
  { family: 'Kalam', category: 'hand', license: 'OFL' },
  { family: 'Patrick Hand', category: 'hand', license: 'OFL' },
  { family: 'Fira Code', category: 'mono', license: 'OFL' },
  { family: 'Source Code Pro', category: 'mono', license: 'OFL' },
  { family: 'IBM Plex Mono', category: 'mono', license: 'OFL' },
  { family: 'Roboto Mono', category: 'mono', license: 'Apache' },
  { family: 'Space Mono', category: 'mono', license: 'OFL' },
]

/** Sous-ensembles gardés : le latin et le latin étendu (français, langues européennes). */
const KEEP = new Set(['latin', 'latin-ext'])

export interface FaceSource {
  subset: string
  weight: number
  italic: boolean
  url: string
  unicodeRange: string
}

/** Feuille de style « css2 » → les fichiers à télécharger (sous-ensembles latins seulement). */
export function parseFontCss(css: string): FaceSource[] {
  const out: FaceSource[] = []
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g
  for (const m of css.slice(0, 2_000_000).matchAll(re)) {
    const subset = m[1]
    if (!KEEP.has(subset)) continue
    const body = m[2]
    const url = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+\.woff2)\)/.exec(body)?.[1]
    const weight = Number(/font-weight:\s*(\d{3})/.exec(body)?.[1] ?? 400)
    const italic = /font-style:\s*italic/.test(body)
    const unicodeRange = (/unicode-range:\s*([^;]+);/.exec(body)?.[1] ?? '').trim()
    if (!url || !UNICODE_RANGE.test(unicodeRange) || weight < 100 || weight > 900) continue
    out.push({ subset, weight, italic, url, unicodeRange })
  }
  return out
}

/** Adresse de la feuille de style pour une famille : normal et italique, 400 et 700 si possible. */
export function cssUrl(family: string, variant: 'full' | 'weights' | 'regular'): string {
  const name = family.trim().replace(/ /g, '+')
  const axis = variant === 'full' ? ':ital,wght@0,400;0,700;1,400;1,700' : variant === 'weights' ? ':wght@400;700' : ''
  return `https://fonts.googleapis.com/css2?family=${name}${axis}&display=swap`
}

/** Un nom de famille acceptable (lettres, chiffres, espaces). */
export const isFamilyName = (s: string): boolean => /^[A-Za-z0-9][A-Za-z0-9 ]{0,60}$/.test(s.trim())

function base64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/**
 * Télécharge une famille : feuille de style (en retirant les styles que la
 * famille n'a pas), puis chaque fichier. Renvoie les polices à intégrer.
 */
export async function downloadFamily(family: string, onProgress?: (done: number, total: number) => void): Promise<FontFace[]> {
  if (!isFamilyName(family)) throw new Error('bad family')
  let css = ''
  for (const variant of ['full', 'weights', 'regular'] as const) {
    const res = await netFetch(cssUrl(family, variant))
    if (res.ok) {
      css = await res.text()
      break
    }
    if (res.status !== 400) throw new Error(`HTTP ${res.status}`)
  }
  const faces = parseFontCss(css)
  if (!faces.length) throw new Error('not found')
  const out: FontFace[] = []
  let done = 0
  for (const f of faces.slice(0, 16)) {
    const res = await netFetch(f.url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length > 4_000_000) throw new Error('too large')
    out.push({ family: family.trim(), src: `data:font/woff2;base64,${base64(bytes)}`, weight: f.weight, italic: f.italic, unicodeRange: f.unicodeRange })
    onProgress?.(++done, faces.length)
  }
  return out
}
