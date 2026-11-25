// Dessin à main levée : géométrie commune à l'éditeur et aux exports (chemins
// SVG, boîte englobante, simplification des traits).

import type { InkStroke } from './types'

/** Texte de remplacement des images de dessin dans un .docx : suivi des traits en JSON. */
export const INK_ALT = 'folio-ink:'

/** Px CSS par point typographique. */
export const PX_PER_PT = 96 / 72

/** Opacité d'un trait : le surligneur laisse voir le texte, le crayon est un peu plus léger. */
export const inkOpacity = (s: InkStroke): number => (s.tool === 'highlighter' ? 0.35 : s.tool === 'pencil' ? 0.8 : 1)

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

// --- gomme partielle -----------------------------------------------------------------

/**
 * La gomme partielle : retire d'un trait ce qui passe à moins de `r` du point
 * (x, y) ; le trait peut se couper en plusieurs morceaux. Renvoie null s'il
 * n'est pas touché, une liste vide s'il disparaît.
 */
export function erasePoints(s: InkStroke, x: number, y: number, r: number): InkStroke[] | null {
  if (distanceToStroke(s, x, y) > r) return null
  const p = s.points
  // Les segments touchés sont redécoupés finement, pour couper au bon endroit.
  const fine: number[] = [p[0], p[1]]
  for (let i = 2; i < p.length; i += 2) {
    const [ax, ay, bx, by] = [p[i - 2], p[i - 1], p[i], p[i + 1]]
    const seg = { ...s, points: [ax, ay, bx, by] }
    const len = Math.hypot(bx - ax, by - ay)
    const steps = distanceToStroke(seg, x, y) <= r * 1.5 ? Math.min(200, Math.ceil(len / Math.max(0.5, r / 3))) : 1
    for (let k = 1; k <= steps; k++) fine.push(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps)
  }
  const out: InkStroke[] = []
  let cur: number[] = []
  const flush = () => {
    if (cur.length >= 4) out.push({ ...s, points: simplify(cur, 0.3).map((v) => Math.round(v * 10) / 10) })
    cur = []
  }
  for (let i = 0; i < fine.length; i += 2) {
    if (Math.hypot(fine[i] - x, fine[i + 1] - y) <= r) flush()
    else cur.push(fine[i], fine[i + 1])
  }
  flush()
  return out
}

// --- lasso ---------------------------------------------------------------------------

/** Le point est-il dans le polygone (x, y, x, y…) ? */
export function insidePolygon(poly: number[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [poly[i], poly[i + 1], poly[j], poly[j + 1]]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside
  }
  return inside
}

/** Un trait est pris au lasso quand la plupart de ses points sont dans la boucle. */
export function lassoed(poly: number[], points: number[], dx = 0, dy = 0): boolean {
  let n = 0
  for (let i = 0; i + 1 < points.length; i += 2) if (insidePolygon(poly, points[i] + dx, points[i + 1] + dy)) n++
  return n >= Math.max(1, Math.ceil((points.length / 2) * 0.6))
}

// --- encre en forme ------------------------------------------------------------------

/** Une forme reconnue dans un trait : nom de forme prédéfinie, boîte, retournement, flèche. */
export interface InkShape {
  shape: 'line' | 'rect' | 'ellipse' | 'triangle' | 'rtTriangle' | 'diamond'
  x: number
  y: number
  width: number
  height: number
  flip?: 'h' | 'v' | 'hv'
  /** Une flèche au bout du trait. */
  tail?: true
}

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay)

/** Distance d'un point à la droite (a, b). */
function lineDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const l = dist(ax, ay, bx, by) || 1
  return Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / l
}

/**
 * Reconnaît une forme simple dans un trait dessiné à main levée : trait droit,
 * flèche (un trait et sa pointe d'un seul geste), rectangle, ellipse, triangle
 * (isocèle ou rectangle), losange. Rien de sûr : null, le trait reste un trait.
 * Coordonnées des points ; une forme presque carrée ou ronde le devient.
 */
export function recognizeShape(pts: number[]): InkShape | null {
  const n = pts.length / 2
  if (n < 2) return null
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  let len = 0
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i])
    x1 = Math.max(x1, pts[i])
    y0 = Math.min(y0, pts[i + 1])
    y1 = Math.max(y1, pts[i + 1])
    if (i) len += dist(pts[i - 2], pts[i - 1], pts[i], pts[i + 1])
  }
  const [w, h] = [x1 - x0, y1 - y0]
  const diag = Math.hypot(w, h)
  if (diag < 8) return null
  const [sx, sy, ex, ey] = [pts[0], pts[1], pts[pts.length - 2], pts[pts.length - 1]]
  const gap = dist(sx, sy, ex, ey)
  const r1 = (v: number) => Math.round(v * 10) / 10
  const box = (shape: InkShape['shape'], bx: number, by: number, bw: number, bh: number, extra: Partial<InkShape> = {}): InkShape => ({ shape, x: r1(bx), y: r1(by), width: r1(Math.max(0, bw)), height: r1(Math.max(0, bh)), ...extra })
  const flipOf = (h: boolean, v: boolean) => (h && v ? 'hv' : h ? 'h' : v ? 'v' : undefined)

  // Un trait droit : tous les points près de la corde, sans détour.
  const straight = (ax: number, ay: number, bx: number, by: number, from: number, to: number) => {
    const chord = dist(ax, ay, bx, by)
    let far = 0
    for (let i = from; i <= to; i += 2) far = Math.max(far, lineDist(pts[i], pts[i + 1], ax, ay, bx, by))
    return chord > 0 && far <= Math.max(2, chord * 0.07)
  }
  const line = (ax: number, ay: number, bx: number, by: number, tail?: true): InkShape => {
    let [lw, lh] = [Math.abs(bx - ax), Math.abs(by - ay)]
    let [lx, ly] = [Math.min(ax, bx), Math.min(ay, by)]
    // Presque horizontal ou vertical : il l'est.
    if (lh < lw * 0.09) [ly, lh] = [(ay + by) / 2, 0]
    else if (lw < lh * 0.09) [lx, lw] = [(ax + bx) / 2, 0]
    const flip = flipOf(lw > 0 && bx < ax, lh > 0 && by < ay)
    return box('line', lx, ly, lw, lh, { ...(flip ? { flip } : {}), ...(tail ? { tail } : {}) })
  }
  if (gap >= len * 0.85 && straight(sx, sy, ex, ey, 0, pts.length - 2)) return line(sx, sy, ex, ey)

  const closed = gap <= Math.max(6, diag * 0.22) && len >= diag * 1.6
  if (!closed) {
    // Une flèche d'un seul geste : une longue hampe, puis la pointe dessinée autour de son bout.
    const v = simplify(pts, Math.max(1.5, diag * 0.06))
    if (v.length < 8) return null
    const [ax, ay, bx, by] = [v[0], v[1], v[2], v[3]]
    const shaft = dist(ax, ay, bx, by)
    if (shaft < diag * 0.6) return null
    for (let i = 4; i < v.length; i += 2) if (dist(v[i], v[i + 1], bx, by) > shaft * 0.4) return null
    const end = pts.findIndex((_, i) => i % 2 === 0 && dist(pts[i], pts[i + 1], bx, by) < 0.5)
    if (end > 0 && !straight(ax, ay, bx, by, 0, end)) return null
    return line(ax, ay, bx, by, true)
  }

  // Formes fermées : les coins de la boîte touchés disent laquelle.
  const near = Math.max(Math.min(w, h), Math.max(w, h) * 0.3) * 0.2
  const touches = (cx: number, cy: number) => {
    for (let i = 0; i < pts.length; i += 2) if (dist(pts[i], pts[i + 1], cx, cy) <= near) return true
    return false
  }
  const [tl, tr, bl, br] = [touches(x0, y0), touches(x1, y0), touches(x0, y1), touches(x1, y1)]
  const corners = [tl, tr, bl, br].filter(Boolean).length
  // Les sommets du tracé (refermé) : combien de coins vrais ?
  const v = simplify([...pts, sx, sy], Math.max(1.5, Math.min(w, h) * 0.12))
  const k = v.length / 2 - 1
  const square = (shape: InkShape['shape'], extra: Partial<InkShape> = {}) => {
    // Presque carré (ou rond) : il l'est.
    if (Math.abs(w - h) <= Math.max(w, h) * 0.12) {
      const s = (w + h) / 2
      return box(shape, x0 + (w - s) / 2, y0 + (h - s) / 2, s, s, extra)
    }
    return box(shape, x0, y0, w, h, extra)
  }
  if (Math.min(w, h) < 4) return null
  // Le tracé suit-il le contour attendu (sommets en fractions de la boîte) ? Un gribouillis, non.
  const fits = (outline: [number, number][]) => {
    const ring = [...outline, outline[0]].flatMap(([fx, fy]) => [x0 + fx * w, y0 + fy * h])
    const edge = { tool: 'pen' as const, color: '', width: 0, points: ring }
    let sum = 0
    for (let i = 0; i < pts.length; i += 2) sum += distanceToStroke(edge, pts[i], pts[i + 1])
    return sum / n <= Math.max(2, Math.min(w, h) * 0.07)
  }
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2]
  if (corners === 4 && fits([[0, 0], [1, 0], [1, 1], [0, 1]])) return square('rect')
  if (corners === 3 && k <= 4) {
    const flip = !tr ? undefined : !tl ? 'h' : !br ? 'v' : 'hv'
    const outline: [number, number][] = flip === 'h' ? [[1, 0], [1, 1], [0, 1]] : flip === 'v' ? [[0, 0], [1, 0], [0, 1]] : flip === 'hv' ? [[0, 0], [1, 0], [1, 1]] : [[0, 0], [1, 1], [0, 1]]
    return fits(outline) ? box('rtTriangle', x0, y0, w, h, flip ? { flip } : {}) : null
  }
  if (corners === 2 && k <= 4) {
    if (bl && br && fits([[0.5, 0], [1, 1], [0, 1]])) return box('triangle', x0, y0, w, h)
    if (tl && tr && fits([[0, 0], [1, 0], [0.5, 1]])) return box('triangle', x0, y0, w, h, { flip: 'v' })
    return null
  }
  if (corners === 0) {
    const mids = [touches(cx, y0), touches(x1, cy), touches(cx, y1), touches(x0, cy)].every(Boolean)
    if (mids && k <= 5 && fits([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]])) return square('diamond')
    // Une ellipse : chaque point près du bord de l'ellipse inscrite dans la boîte.
    let dev = 0
    for (let i = 0; i < pts.length; i += 2) dev += Math.abs(Math.hypot((pts[i] - cx) / (w / 2), (pts[i + 1] - cy) / (h / 2)) - 1)
    if (dev / n <= 0.13) return square('ellipse')
  }
  return null
}
