// Dessin à main levée : géométrie commune à l'éditeur et aux exports (chemins
// SVG, boîte englobante, simplification des traits).

import type { InkStroke } from './types'

/** Texte de remplacement des images de dessin dans un .docx : suivi des traits en JSON. */
export const INK_ALT = 'folio-ink:'

/** Px CSS par point typographique. */
export const PX_PER_PT = 96 / 72

/** Opacité d'un trait : le surligneur laisse voir le texte. */
export const inkOpacity = (s: InkStroke): number => (s.tool === 'highlighter' ? 0.35 : 1)

/** Chemin SVG d'un trait (coordonnées en points, décalées de dx, dy). */
export function inkPath(s: InkStroke, dx = 0, dy = 0, scale = 1): string {
  const p = s.points
  if (p.length < 2) return ''
  const f = (v: number) => String(Math.round(v * scale * 100) / 100)
  let d = `M${f(p[0] - dx)} ${f(p[1] - dy)}`
  // Un simple point : un trait très court, pour qu'il se voie.
  if (p.length === 2) return `${d}L${f(p[0] - dx + 0.01)} ${f(p[1] - dy)}`
  for (let i = 2; i < p.length; i += 2) d += `L${f(p[i] - dx)} ${f(p[i + 1] - dy)}`
  return d
}

/** Boîte englobante de traits, épaisseur comprise (points). */
export function inkBounds(strokes: InkStroke[]): { x: number; y: number; width: number; height: number } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of strokes) {
    const r = s.width / 2
    for (let i = 0; i + 1 < s.points.length; i += 2) {
      x0 = Math.min(x0, s.points[i] - r)
      x1 = Math.max(x1, s.points[i] + r)
      y0 = Math.min(y0, s.points[i + 1] - r)
      y1 = Math.max(y1, s.points[i + 1] + r)
    }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }
}

/** Simplifie un tracé (Ramer–Douglas–Peucker) : moins de points, même forme à la tolérance près. */
export function simplify(points: number[], tolerance = 0.6): number[] {
  const n = points.length / 2
  if (n <= 2) return points.slice()
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = points[2 * a]
    const ay = points[2 * a + 1]
    const bx = points[2 * b]
    const by = points[2 * b + 1]
    const len = Math.hypot(bx - ax, by - ay) || 1
    let far = -1
    let dist = tolerance
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((by - ay) * points[2 * i] - (bx - ax) * points[2 * i + 1] + bx * ay - by * ax) / len
      if (d > dist) {
        dist = d
        far = i
      }
    }
    if (far >= 0) {
      keep[far] = 1
      stack.push([a, far], [far, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[2 * i], points[2 * i + 1])
  return out
}

/** Distance d'un point à un trait (points), pour la gomme. */
export function distanceToStroke(s: InkStroke, x: number, y: number): number {
  const p = s.points
  let best = Infinity
  if (p.length === 2) return Math.hypot(p[0] - x, p[1] - y)
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i]
    const ay = p[i + 1]
    const bx = p[i + 2]
    const by = p[i + 3]
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2)) : 0
    best = Math.min(best, Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y))
  }
  return best
}

/** Les traits en SVG autonome (exports) ; `color` résout les couleurs du thème. */
export function inkSvg(strokes: InkStroke[], color: (c: string) => string, o: { x?: number; y?: number; className?: string } = {}): string {
  const b = inkBounds(strokes)
  const paths = strokes
    .map((s) => `<path d="${inkPath(s, b.x, b.y)}" fill="none" stroke="${color(s.color)}" stroke-width="${s.width}" stroke-linecap="${s.tool === 'highlighter' ? 'square' : 'round'}" stroke-linejoin="round"${inkOpacity(s) < 1 ? ` stroke-opacity="${inkOpacity(s)}"` : ''}/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg"${o.className ? ` class="${o.className}"` : ''} width="${round(b.width)}pt" height="${round(b.height)}pt" viewBox="0 0 ${round(b.width)} ${round(b.height)}" style="position:absolute;left:${round(b.x + (o.x ?? 0))}pt;top:${round(b.y + (o.y ?? 0))}pt;overflow:visible;pointer-events:none">${paths}</svg>`
}

const round = (v: number) => Math.round(v * 100) / 100
