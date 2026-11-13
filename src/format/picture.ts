// Retouches d'une image (onglet Format de l'image) : luminosité, contraste,
// saturation, recoloration, effets artistiques, transparence, ombre, halo,
// bords adoucis. Une seule traduction en CSS, partagée par l'éditeur, la page
// web exportée et l'image recalculée pour .docx et .odt.

import { hasOwn, type PictureAdjust } from './types'

export const RECOLORS = ['grayscale', 'sepia', 'washout', 'blackwhite'] as const
export const ARTISTIC = ['blur', 'pencil', 'negative'] as const

/** Retouches valides, bornées ; null si aucune. */
export function cleanAdjust(raw: unknown, color: (c: string) => string | null): PictureAdjust | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const out: PictureAdjust = {}
  const num = (k: 'brightness' | 'contrast' | 'saturation' | 'transparency' | 'softEdges', min: number, max: number, neutral: number) => {
    const v = o[k]
    if (typeof v !== 'number' || !Number.isFinite(v)) return
    const r = Math.round(Math.min(max, Math.max(min, v)))
    if (r !== neutral) out[k] = r
  }
  num('brightness', -100, 100, 0)
  num('contrast', -100, 100, 0)
  num('saturation', 0, 400, 100)
  num('transparency', 0, 95, 0)
  num('softEdges', 0, 50, 0)
  if (typeof o.recolor === 'string' && (RECOLORS as readonly string[]).includes(o.recolor)) out.recolor = o.recolor as PictureAdjust['recolor']
  if (typeof o.artistic === 'string' && (ARTISTIC as readonly string[]).includes(o.artistic)) out.artistic = o.artistic as PictureAdjust['artistic']
  if (o.shadow === true) out.shadow = true
  if (typeof o.glow === 'string') {
    const c = color(o.glow)
    if (c) out.glow = c
  }
  return Object.keys(out).length ? out : null
}

/** Les retouches qui changent les couleurs (à recalculer dans l'image pour .docx et .odt). */
export const hasColorAdjust = (a: PictureAdjust | null | undefined): boolean =>
  !!a && (a.brightness !== undefined || a.contrast !== undefined || a.saturation !== undefined || !!a.recolor || !!a.artistic || a.transparency !== undefined || a.softEdges !== undefined)

/** Le filtre CSS des couleurs (sans ombre ni halo). */
export function colorFilter(a: PictureAdjust): string {
  const f: string[] = []
  if (a.brightness) f.push(`brightness(${(1 + a.brightness / 100).toFixed(2)})`)
  if (a.contrast) f.push(`contrast(${(1 + a.contrast / 100).toFixed(2)})`)
  if (a.saturation !== undefined && a.saturation !== 100) f.push(`saturate(${(a.saturation / 100).toFixed(2)})`)
  if (a.recolor === 'grayscale') f.push('grayscale(1)')
  if (a.recolor === 'sepia') f.push('sepia(1)')
  if (a.recolor === 'washout') f.push('brightness(1.55) contrast(0.38)')
  if (a.recolor === 'blackwhite') f.push('grayscale(1) contrast(6)')
  if (a.artistic === 'blur') f.push('blur(3px)')
  if (a.artistic === 'pencil') f.push('grayscale(1) contrast(2.4) brightness(1.18)')
  if (a.artistic === 'negative') f.push('invert(1)')
  return f.join(' ')
}

/** Ombre et halo, en ombres portées CSS (elles suivent la forme de l'image). */
export function shadowFilter(a: PictureAdjust, css: (c: string) => string): string {
  const f: string[] = []
  if (a.shadow) f.push('drop-shadow(4px 5px 6px rgba(0, 0, 0, 0.38))')
  if (a.glow) f.push(`drop-shadow(0 0 5px ${css(a.glow)}) drop-shadow(0 0 9px ${css(a.glow)})`)
  return f.join(' ')
}

/** Masque des bords adoucis : un dégradé sur chaque bord, en points. */
export function softEdgeMask(pt: number): string {
  const d = `${pt}pt`
  return `linear-gradient(to right, transparent, #000 ${d}, #000 calc(100% - ${d}), transparent), linear-gradient(to bottom, transparent, #000 ${d}, #000 calc(100% - ${d}), transparent)`
}

/** Toutes les déclarations CSS d'une image retouchée. */
export function adjustCss(a: PictureAdjust | null | undefined, css: (c: string) => string): Record<string, string> {
  if (!a) return {}
  const out: Record<string, string> = {}
  const filter = [colorFilter(a), shadowFilter(a, css)].filter(Boolean).join(' ')
  if (filter) out.filter = filter
  if (a.transparency) out.opacity = String(1 - a.transparency / 100)
  if (a.softEdges) {
    out['mask-image'] = softEdgeMask(a.softEdges)
    out['-webkit-mask-image'] = softEdgeMask(a.softEdges)
    out['mask-composite'] = 'intersect'
    out['-webkit-mask-composite'] = 'source-in'
  }
  return out
}

export const cssText = (decls: Record<string, string>): string =>
  Object.entries(decls)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')

export { hasOwn }
