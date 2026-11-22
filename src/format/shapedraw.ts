// Dessin d'une forme en SVG : remplissage, contour (tirets, bouts de trait),
// transparence, ombre, faces claires et sombres, retournement. Le même pour
// l'éditeur et la page web exportée ; `paint` donne la valeur d'une couleur
// (variable CSS du thème dans l'éditeur, #rrggbb à l'export).

import { onColor } from './diagram'
import { adjustCss, cssText } from './picture'
import { isLineKind, shapeGeom } from './shapes'
import type { ShapeInline } from './types'

const r2 = (v: number) => Math.round(v * 100) / 100
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const PX = 4 / 3

/** Une couleur #rrggbb assombrie (k : 0 à 1). */
function darken(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const v = parseInt(m[1], 16)
  return '#' + [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.round(x * (1 - k)).toString(16).padStart(2, '0')).join('')
}

export interface Paint {
  /** Valeur d'une couleur du format (accent1, #rrggbb…) pour le SVG. */
  color: (c: string) => string
  /** Valeur #rrggbb d'une couleur du format (pour choisir la couleur du texte), si connue. */
  hex?: (c: string) => string | null
}

const DASHES: Record<string, (w: number) => string> = {
  dash: (w) => `${4 * w} ${3 * w}`,
  dot: (w) => `${w} ${2 * w}`,
  dashDot: (w) => `${4 * w} ${2 * w} ${w} ${2 * w}`,
  longDash: (w) => `${8 * w} ${3 * w}`,
}

/** Le bout d'un trait : pointe, flèche, rond, losange, au point (x, y), tourné vers (dx, dy). */
function lineEnd(kind: string, x: number, y: number, dx: number, dy: number, w: number, stroke: string): string {
  if (kind === 'none') return ''
  const len = Math.hypot(dx, dy) || 1
  const [ux, uy] = [dx / len, dy / len]
  const s = Math.max(4, w * 3.2)
  const back = (k: number, side: number): [number, number] => [x - ux * s * k - uy * s * side, y - uy * s * k + ux * s * side]
  const pt = ([a, b]: [number, number]) => `${r2(a)} ${r2(b)}`
  if (kind === 'arrow') return `<path d="M${pt(back(1, 0.55))}L${r2(x)} ${r2(y)}L${pt(back(1, -0.55))}" fill="none" stroke="${stroke}" stroke-width="${r2(w)}" stroke-linecap="round" stroke-linejoin="round"/>`
  if (kind === 'triangle') return `<path d="M${r2(x)} ${r2(y)}L${pt(back(1, 0.5))}L${pt(back(1, -0.5))}Z" fill="${stroke}"/>`
  if (kind === 'diamond') return `<path d="M${r2(x)} ${r2(y)}L${pt(back(0.5, 0.4))}L${pt(back(1, 0))}L${pt(back(0.5, -0.4))}Z" fill="${stroke}"/>`
  return `<ellipse cx="${r2(x - (ux * s) / 2)}" cy="${r2(y - (uy * s) / 2)}" rx="${r2(s / 2.4)}" ry="${r2(s / 2.4)}" fill="${stroke}"/>`
}

/** Les deux bouts d'un trait (point et direction vers l'extérieur), selon la forme. */
function lineEnds(kind: string, w: number, h: number): { a: [number, number, number, number]; b: [number, number, number, number] } {
  if (kind === 'bentConnector3' || kind === 'curvedConnector3') return { a: [0, 0, -1, 0], b: [w, h, 1, 0] }
  if (kind === 'arc') return { a: [w / 2, 0, -1, 0], b: [w, h / 2, 0, 1] }
  return { a: [0, 0, -w, -h], b: [w, h, w, h] }
}

/** Couleur du contour : la couleur choisie ; la même que le remplissage, un peu plus sombre (comme d'habitude). */
function strokeOf(sh: ShapeInline, paint: Paint): string | null {
  const line = sh.line ?? 'none'
  if (line === 'none') return null
  const c = paint.color(line)
  if (sh.fill && sh.fill === line && !isLineKind(sh.shape)) {
    const hex = paint.hex?.(line)
    return hex ? darken(hex, 0.28) : `color-mix(in srgb, ${c} 72%, #000)`
  }
  return c
}

/** Les éléments SVG d'une forme (repère : 0 à largeur, 0 à hauteur, en px), sans le <svg>. */
export function shapeBody(sh: ShapeInline, paint: Paint): string {
  const w = sh.width * PX
  const h = sh.height * PX
  const geom = shapeGeom(sh.shape === 'textBox' || sh.shape === 'picture' ? 'rect' : sh.shape, w, h)
  const stroke = strokeOf(sh, paint)
  const lw = (sh.lineWidth ?? 1) * PX
  const fill = !geom.open && sh.fill && sh.fill !== 'none' ? paint.color(sh.fill) : 'none'
  const strokeAttrs = stroke && !geom.noStroke ? ` stroke="${stroke}" stroke-width="${r2(lw)}"${sh.dash && DASHES[sh.dash] ? ` stroke-dasharray="${DASHES[sh.dash](lw)}"` : ''} stroke-linejoin="round"` : ''
  const fillOpacity = fill !== 'none' && sh.transparency ? ` fill-opacity="${r2(1 - sh.transparency / 100)}"` : ''
  const parts: string[] = [`<path d="${geom.d}" fill="${fill}"${fillOpacity}${geom.evenOdd ? ' fill-rule="evenodd"' : ''}${strokeAttrs}/>`]
  if (fill !== 'none' && geom.light) parts.push(`<path d="${geom.light}" fill="#fff" fill-opacity="0.35"/>`)
  if (fill !== 'none' && geom.dark) parts.push(`<path d="${geom.dark}" fill="#000" fill-opacity="0.22"/>`)
  if (geom.x && stroke) parts.push(`<path d="${geom.x}" fill="none" stroke="${stroke}" stroke-width="${r2(lw)}" stroke-linejoin="round" stroke-linecap="round"/>`)
  if (geom.open && stroke) {
    const { a, b } = lineEnds(sh.shape, w, h)
    parts.push(lineEnd(sh.head ?? 'none', a[0], a[1], a[2], a[3], lw, stroke), lineEnd(sh.tail ?? 'none', b[0], b[1], b[2], b[3], lw, stroke))
  }
  const flip = sh.flip ? ` transform="translate(${sh.flip.includes('h') ? r2(w) : 0} ${sh.flip.includes('v') ? r2(h) : 0}) scale(${sh.flip.includes('h') ? -1 : 1} ${sh.flip.includes('v') ? -1 : 1})"` : ''
  return `<g${flip}>${parts.join('')}</g>`
}

/** Une forme seule en SVG (débordement visible : bulles, bouts de trait). */
export function shapeSvg(sh: ShapeInline, paint: Paint, attrs = ''): string {
  const w = Math.max(1, sh.width * PX)
  const h = Math.max(1, sh.height * PX)
  // Une image libre : son texte de remplacement est sur l'image elle-même (pictureHtml).
  const alt = sh.shape === 'picture' ? '' : sh.alt
  const label = alt ? `<title>${esc(alt)}</title>` : ''
  // L'ombre (une image libre a la sienne, sur l'image).
  const shadow = sh.shadow && sh.shape !== 'picture' ? ` style="filter:${SHADOW}"` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(w)}" height="${r2(h)}" viewBox="0 0 ${r2(w)} ${r2(h)}" overflow="visible"${attrs}${shadow}${alt ? ' role="img"' : ' aria-hidden="true"'}>${label}${shapeBody(sh, paint)}</svg>`
}

/** L'ombre portée d'une forme. */
const SHADOW = 'drop-shadow(2px 3px 3px rgba(0, 0, 0, 0.35))'

/**
 * Une image libre en HTML : l'image rognée (le cadre coupe ce qui dépasse), retournée,
 * avec ses retouches. Le contour éventuel est dessiné par-dessus (shapeSvg).
 * `uri` : l'adresse de l'image ; `css` : la valeur d'une couleur (halo).
 */
export function pictureHtml(sh: ShapeInline, uri: string, css: (c: string) => string, cls = 'fp-shape__pic'): string {
  const c = { top: 0, right: 0, bottom: 0, left: 0, ...(sh.crop ?? {}) }
  const fw = Math.max(5, 100 - c.left - c.right)
  const fh = Math.max(5, 100 - c.top - c.bottom)
  const a = adjustCss(sh.adjust ? { ...sh.adjust, reflection: undefined } : null, css)
  // Les filtres de couleur vont sur l'image ; l'ombre, le halo et les bords adoucis sur le cadre.
  const filter = a.filter ?? ''
  const colors = filter.replace(/drop-shadow\([^()]*(\([^()]*\)[^()]*)*\)/g, '').trim()
  const shadows = [...(filter.match(/drop-shadow\([^()]*(\([^()]*\)[^()]*)*\)/g) ?? []), ...(sh.shadow ? [SHADOW] : [])].join(' ')
  const frame: Record<string, string> = { position: 'absolute', inset: '0', overflow: 'hidden' }
  if (shadows) frame.filter = shadows
  for (const k of ['mask-image', '-webkit-mask-image', 'mask-composite', '-webkit-mask-composite']) if (a[k]) frame[k] = a[k]
  if (sh.flip) frame.transform = `scale(${sh.flip.includes('h') ? -1 : 1}, ${sh.flip.includes('v') ? -1 : 1})`
  const img: Record<string, string> = {
    position: 'absolute',
    'max-width': 'none',
    left: `${r2((-c.left / fw) * 100)}%`,
    top: `${r2((-c.top / fh) * 100)}%`,
    width: `${r2((100 / fw) * 100)}%`,
    height: `${r2((100 / fh) * 100)}%`,
  }
  if (colors) img.filter = colors
  if (a.opacity) img.opacity = a.opacity
  return `<span class="${cls}" style="${esc(cssText(frame))}"><img src="${esc(uri)}" alt="${esc(sh.alt ?? '')}" draggable="false" style="${esc(cssText(img))}"/></span>`
}

/** Couleur lisible du texte dans la forme : blanc ou presque noir sur un remplissage, sinon celle du document. */
export function textColorOf(sh: ShapeInline, paint: Paint): string | null {
  if (!sh.fill || sh.fill === 'none' || sh.shape === 'textBox') return null
  const hex = paint.hex?.(sh.fill)
  if (!hex) return null
  if (sh.transparency && sh.transparency > 50) return null
  return onColor(hex)
}

/** La forme fait-elle de la place au texte du document (habillage carré, haut et bas) ? */
export const wrapsText = (sh: ShapeInline): boolean => sh.wrap === 'square' || sh.wrap === 'topBottom'
