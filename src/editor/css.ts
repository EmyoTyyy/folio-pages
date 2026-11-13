// Traductions format → CSS (et CSS collé → format), partagées par le schéma,
// la feuille de styles du document et l'impression.

import { cssColor, parseColor } from '../format/color'
import { THEME_FONTS } from '../format/types'

/** Polices génériques CSS : écrites sans guillemets. */
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy', 'ui-serif', 'ui-sans-serif', 'ui-monospace'])

/** Repli de chaque famille embarquée ou courante, pour un rendu proche quand elle manque. */
function fallbackFor(family: string): string {
  const f = family.toLowerCase()
  if (/mono|courier|consol|code/.test(f)) return 'ui-monospace, Menlo, Consolas, monospace'
  if (/newsreader|serif|times|georgia|garamond|cambria|charter|book|minion|palatino|libre baskerville|merriweather|lora/.test(f) && !/sans/.test(f)) {
    return 'Georgia, Cambria, "Times New Roman", serif'
  }
  return 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'
}

/** Valeur CSS font-family d'un nom de police du format (police du thème ou famille). */
export function cssFont(name: string): string {
  if ((THEME_FONTS as readonly string[]).includes(name)) return `var(--doc-font-${name})`
  if (GENERIC.has(name.toLowerCase())) return name.toLowerCase()
  return `"${name.replace(/["\\]/g, '')}", ${fallbackFor(name)}`
}

/** Couleur CSS collée (rgb(), #hex, nom) → couleur du format, sinon null. */
export function colorFromCss(v: string | null | undefined): string | null {
  if (!v) return null
  const s = v.trim().toLowerCase()
  const m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s)
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null // transparent
    const hex = [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('')
    return `#${hex}`
  }
  if (s === 'transparent' || s === 'inherit' || s === 'initial' || s === 'currentcolor') return null
  return parseColor(s, false)
}

/** Taille CSS (pt, px, em…) → points, sinon null. */
export function ptFromCss(v: string | null | undefined, base = 11): number | null {
  if (!v) return null
  const m = /^(-?[\d.]+)(pt|px|em|rem|%)?$/.exec(v.trim())
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const unit = m[2] ?? 'px'
  const pt = unit === 'pt' ? n : unit === 'px' ? n * 0.75 : unit === '%' ? (n / 100) * base : n * base
  return Math.round(pt * 2) / 2
}

/** Première famille d'une liste CSS font-family, sans guillemets. */
export function familyFromCss(v: string | null | undefined): string | null {
  if (!v) return null
  const first = v.split(',')[0].trim().replace(/^["']|["']$/g, '').trim()
  if (!first || GENERIC.has(first.toLowerCase()) || first.startsWith('var(')) return null
  return /^[\p{L}\p{N} ._'-]{1,100}$/u.test(first) ? first : null
}

export interface ParaAttrs {
  align: string | null
  indentLeft: number | null
  indentRight: number | null
  indentFirst: number | null
  spaceBefore: number | null
  spaceAfter: number | null
  line: number | null
  keepNext: boolean
  keepLines: boolean
  pageBreakBefore: boolean
  shading: string | null
  border: string | null
  dropCap: number | null
}

/** Attributs de paragraphe → déclarations CSS en ligne. */
export function paraCss(a: ParaAttrs): string {
  const out: string[] = []
  if (a.align) out.push(`text-align:${a.align}`)
  if (a.indentLeft !== null) out.push(`margin-left:${a.indentLeft}pt`)
  if (a.indentRight !== null) out.push(`margin-right:${a.indentRight}pt`)
  if (a.indentFirst !== null) out.push(`text-indent:${a.indentFirst}pt`)
  if (a.spaceBefore !== null) out.push(`margin-top:${a.spaceBefore}pt`)
  if (a.spaceAfter !== null) out.push(`margin-bottom:${a.spaceAfter}pt`)
  if (a.line !== null) out.push(`line-height:${a.line}`)
  if (a.shading) out.push(`background-color:${cssColor(a.shading)}`)
  if (a.border) out.push(`border:1px solid ${cssColor(a.border)}`, 'padding:4pt 6pt')
  if (a.shading && !a.border) out.push('padding:2pt 6pt')
  return out.join(';')
}
