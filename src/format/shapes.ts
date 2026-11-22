// Formes (Insertion → Formes) : la bibliothèque. Chaque forme porte le nom
// des formes prédéfinies des fichiers .docx (rect, ellipse, rightArrow…), ce
// qui en fait de vraies formes modifiables une fois exportées, et les fait
// revenir telles quelles à l'import. Le dessin n'utilise que des segments
// droits et des courbes de Bézier (M, L, C, Z) : le même chemin sert au SVG
// de l'éditeur et de la page web, au PDF et aux formes de .odt.

export const SHAPE_CATEGORIES = ['lines', 'rectangles', 'basic', 'arrows', 'equation', 'flowchart', 'stars', 'callouts'] as const
export type ShapeCategory = (typeof SHAPE_CATEGORIES)[number]

/** Le dessin d'une forme pour une taille donnée. */
export interface ShapeGeom {
  /** Le contour, rempli et tracé. */
  d: string
  /** Des traits seulement (détails, lignes de rappel). */
  x?: string
  /** Faces plus sombres, plus claires (cube, cylindre, biseau…). */
  dark?: string
  light?: string
  /** Le contour n'est pas tracé (seulement rempli). */
  noStroke?: boolean
  /** Remplissage pair-impair (formes trouées : cadre, anneau…). */
  evenOdd?: boolean
  /** Une ligne ouverte : jamais remplie. */
  open?: boolean
}

export interface ShapeDef {
  id: string
  cat: ShapeCategory
  draw: (w: number, h: number) => ShapeGeom
  /** La place du texte : marges en fractions de la largeur et de la hauteur (gauche, haut, droite, bas). */
  text?: [number, number, number, number]
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** Constructeur de chemin : M, L, C, Z seulement ; les arcs deviennent des courbes. */
class P {
  private out: string[] = []
  private cx = 0
  private cy = 0
  constructor(private tf: (x: number, y: number) => [number, number] = (x, y) => [x, y]) {}
  private pt(x: number, y: number): string {
    const [a, b] = this.tf(x, y)
    return `${r2(a)} ${r2(b)}`
  }
  M(x: number, y: number): this {
    this.out.push(`M${this.pt(x, y)}`)
    this.cx = x
    this.cy = y
    return this
  }
  L(x: number, y: number): this {
    this.out.push(`L${this.pt(x, y)}`)
    this.cx = x
    this.cy = y
    return this
  }
  C(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.out.push(`C${this.pt(x1, y1)} ${this.pt(x2, y2)} ${this.pt(x, y)}`)
    this.cx = x
    this.cy = y
    return this
  }
  Z(): this {
    this.out.push('Z')
    return this
  }
  /** Arc d'ellipse (centre, rayons) de l'angle a0 à a1, en degrés (sens des aiguilles d'une montre si a1 > a0). Part du point courant. */
  A(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): this {
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90))
    const step = (a1 - a0) / n
    const k = (4 / 3) * Math.tan((step * Math.PI) / 720)
    for (let i = 0; i < n; i++) {
      const t0 = ((a0 + i * step) * Math.PI) / 180
      const t1 = ((a0 + (i + 1) * step) * Math.PI) / 180
      const [c0, s0, c1, s1] = [Math.cos(t0), Math.sin(t0), Math.cos(t1), Math.sin(t1)]
      this.C(cx + rx * (c0 - k * s0), cy + ry * (s0 + k * c0), cx + rx * (c1 + k * s1), cy + ry * (s1 - k * c1), cx + rx * c1, cy + ry * s1)
    }
    return this
  }
  /** Va au point de l'ellipse à l'angle a (M si `move`, sinon L). */
  at(cx: number, cy: number, rx: number, ry: number, a: number, move = false): this {
    const t = (a * Math.PI) / 180
    return move ? this.M(cx + rx * Math.cos(t), cy + ry * Math.sin(t)) : this.L(cx + rx * Math.cos(t), cy + ry * Math.sin(t))
  }
  /** Ellipse fermée (sens des aiguilles d'une montre, ou l'inverse : un trou). */
  ellipse(cx: number, cy: number, rx: number, ry: number, reverse = false): this {
    this.at(cx, cy, rx, ry, 0, true)
    return this.A(cx, cy, rx, ry, 0, reverse ? -360 : 360).Z()
  }
  poly(pts: [number, number][]): this {
    pts.forEach(([x, y], i) => (i ? this.L(x, y) : this.M(x, y)))
    return this.Z()
  }
  rect(x: number, y: number, w: number, h: number, reverse = false): this {
    return reverse ? this.poly([[x, y], [x, y + h], [x + w, y + h], [x + w, y]]) : this.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
  }
  /** Rectangle aux coins arrondis (rayons par coin : haut-gauche, haut-droit, bas-droit, bas-gauche ; négatif : coin coupé). */
  corners(x: number, y: number, w: number, h: number, r: [number, number, number, number]): this {
    const [a, b, c, d] = r
    this.M(x + Math.abs(a), y).L(x + w - Math.abs(b), y)
    if (b > 0) this.A(x + w - b, y + b, b, b, -90, 0)
    else this.L(x + w, y - b)
    this.L(x + w, y + h - Math.abs(c))
    if (c > 0) this.A(x + w - c, y + h - c, c, c, 0, 90)
    else this.L(x + w + c, y + h)
    this.L(x + Math.abs(d), y + h)
    if (d > 0) this.A(x + d, y + h - d, d, d, 90, 180)
    else this.L(x, y + h + d)
    this.L(x, y + Math.abs(a))
    if (a > 0) this.A(x + a, y + a, a, a, 180, 270)
    else this.L(x - a, y)
    return this.Z()
  }
  get d(): string {
    return this.out.join('')
  }
  get x(): number {
    return this.cx
  }
  get y(): number {
    return this.cy
  }
}

const g = (d: string, more: Omit<ShapeGeom, 'd'> = {}): ShapeGeom => ({ d, ...more })
/** Polygone en fractions de la taille. */
const fpoly = (pts: [number, number][]) => (w: number, h: number) => g(new P().poly(pts.map(([x, y]) => [x * w, y * h])).d)
/** Polygone régulier (n côtés, pointe en haut) étiré à la taille. */
function regular(n: number, w: number, h: number, start = -90): [number, number][] {
  const raw = Array.from({ length: n }, (_, i) => {
    const t = ((start + (360 * i) / n) * Math.PI) / 180
    return [Math.cos(t), Math.sin(t)] as [number, number]
  })
  const xs = raw.map((p) => p[0])
  const ys = raw.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  return raw.map(([x, y]) => [((x - x0) / (x1 - x0)) * w, ((y - y0) / (y1 - y0)) * h])
}
function star(n: number, inner: number, w: number, h: number): string {
  const pts: [number, number][] = []
  for (let i = 0; i < n * 2; i++) {
    const t = ((-90 + (180 * i) / n) * Math.PI) / 180
    const r = i % 2 ? inner : 1
    pts.push([w / 2 + (w / 2) * r * Math.cos(t), h / 2 + (h / 2) * r * Math.sin(t)])
  }
  return new P().poly(pts).d
}
/** Une flèche simple vers la droite, tournée ou retournée par `tf` (taille du repère : W × H). */
function arrowRight(W: number, H: number, tf?: (x: number, y: number) => [number, number]): string {
  const hl = Math.min(W, H) * 0.5
  return new P(tf).poly([[0, H * 0.25], [W - hl, H * 0.25], [W - hl, 0], [W, H / 2], [W - hl, H], [W - hl, H * 0.75], [0, H * 0.75]]).d
}
const T = {
  /** Retournement horizontal. */
  mirror: (w: number) => (x: number, y: number): [number, number] => [w - x, y],
  /** Transposition (le repère W × H devient H × W : la droite devient le bas). */
  down: () => (x: number, y: number): [number, number] => [y, x],
  /** La droite devient le haut. */
  up: (h: number) => (x: number, y: number): [number, number] => [y, h - x],
}
/** Une bande courbe qui longe le bord gauche et finit par une pointe vers la droite (en bas). */
function curvedArrow(W: number, H: number, tf?: (x: number, y: number) => [number, number]): string {
  const t = Math.min(W, H) * 0.18
  const hw = t * 1.25
  const hl = Math.min(W * 0.4, hw * 1.6)
  const cx = W - hl
  const cy = H / 2
  const rx = cx - t / 2
  const ry = H / 2 - hw
  const p = new P(tf)
  p.M(cx, cy - ry - t / 2).A(cx, cy, rx + t / 2, ry + t / 2, 270, 90).L(cx, cy + ry + hw).L(W, cy + ry).L(cx, cy + ry - hw).L(cx, cy + ry - t / 2).A(cx, cy, rx - t / 2, ry - t / 2, 90, 270).Z()
  return p.d
}
/** Une boîte et une flèche vers la droite (légende flèche). */
function arrowCallout(W: number, H: number, tf?: (x: number, y: number) => [number, number]): string {
  const hl = Math.min(W, H) * 0.25
  const bw = W - hl * 1.6
  return new P(tf).poly([[0, 0], [bw, 0], [bw, H * 0.375], [W - hl, H * 0.375], [W - hl, H * 0.25], [W, H / 2], [W - hl, H * 0.75], [W - hl, H * 0.625], [bw, H * 0.625], [bw, H], [0, H]]).d
}
/** Un nuage : des bosses le long d'une ellipse. */
function cloud(p: P, cx: number, cy: number, rx: number, ry: number, n = 10): P {
  const pt = (i: number) => {
    const t = ((-90 + (360 * i) / n) * Math.PI) / 180
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)]
  }
  const [x0, y0] = pt(0)
  p.M(x0, y0)
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pt(i)
    const [bx, by] = pt(i + 1)
    const tm = ((-90 + (360 * (i + 0.5)) / n) * Math.PI) / 180
    const push = 0.42
    const ox = rx * push * Math.cos(tm)
    const oy = ry * push * Math.sin(tm)
    p.C(ax + ox, ay + oy, bx + ox, by + oy, bx, by)
  }
  return p.Z()
}
/** Ligne d'un rappel (légende à ligne), hors du cadre comme dans les fichiers .docx. */
const leader = (w: number, h: number) => new P().M(-0.083 * w, 0.1875 * h).L(-0.383 * w, 1.125 * h).d
/** Pointe d'une bulle (hors du cadre, en bas à gauche). */
const TIP = [0.29, 1.125] as const

const S: ShapeDef[] = []
const add = (cat: ShapeCategory, id: string, draw: ShapeDef['draw'], text?: ShapeDef['text']) => S.push({ id, cat, draw, ...(text ? { text } : {}) })
const ELL: ShapeDef['text'] = [0.146, 0.146, 0.146, 0.146]

// --- lignes ---------------------------------------------------------------------------
add('lines', 'line', (w, h) => g(new P().M(0, 0).L(w, h).d, { open: true }))
add('lines', 'bentConnector3', (w, h) => g(new P().M(0, 0).L(w / 2, 0).L(w / 2, h).L(w, h).d, { open: true }))
add('lines', 'curvedConnector3', (w, h) => g(new P().M(0, 0).C(w / 2, 0, w / 2, h, w, h).d, { open: true }))

// --- rectangles -----------------------------------------------------------------------
add('rectangles', 'rect', (w, h) => g(new P().rect(0, 0, w, h).d))
const rr = (k: (r: number) => [number, number, number, number]) => (w: number, h: number) => g(new P().corners(0, 0, w, h, k(Math.min(w, h) * 0.1667)).d)
add('rectangles', 'roundRect', rr((r) => [r, r, r, r]), [0.05, 0.05, 0.05, 0.05])
add('rectangles', 'snip1Rect', rr((r) => [0, -r, 0, 0]))
add('rectangles', 'snip2SameRect', rr((r) => [-r, -r, 0, 0]))
add('rectangles', 'snip2DiagRect', rr((r) => [0, -r, 0, -r]))
add('rectangles', 'snipRoundRect', rr((r) => [r, -r, 0, 0]))
add('rectangles', 'round1Rect', rr((r) => [0, r, 0, 0]))
add('rectangles', 'round2SameRect', rr((r) => [r, r, 0, 0]))
add('rectangles', 'round2DiagRect', rr((r) => [r, 0, r, 0]))

// --- formes de base -------------------------------------------------------------------
add('basic', 'ellipse', (w, h) => g(new P().ellipse(w / 2, h / 2, w / 2, h / 2).d), ELL)
add('basic', 'triangle', fpoly([[0.5, 0], [1, 1], [0, 1]]), [0.25, 0.5, 0.25, 0])
add('basic', 'rtTriangle', fpoly([[0, 0], [1, 1], [0, 1]]), [0.08, 0.5, 0.5, 0.08])
add('basic', 'parallelogram', (w, h) => {
  const s = Math.min(w, h) * 0.25
  return g(new P().poly([[s, 0], [w, 0], [w - s, h], [0, h]]).d)
}, [0.2, 0.1, 0.2, 0.1])
add('basic', 'trapezoid', (w, h) => {
  const s = Math.min(w, h) * 0.25
  return g(new P().poly([[s, 0], [w - s, 0], [w, h], [0, h]]).d)
}, [0.2, 0.15, 0.2, 0])
add('basic', 'diamond', fpoly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]), [0.25, 0.25, 0.25, 0.25])
for (const [id, n] of [['pentagon', 5], ['heptagon', 7], ['decagon', 10], ['dodecagon', 12]] as const) add('basic', id, (w, h) => g(new P().poly(regular(n, w, h)).d), [0.18, 0.2, 0.18, 0.12])
add('basic', 'hexagon', (w, h) => {
  const s = Math.min(w, h) * 0.25
  return g(new P().poly([[s, 0], [w - s, 0], [w, h / 2], [w - s, h], [s, h], [0, h / 2]]).d)
}, [0.15, 0.08, 0.15, 0.08])
add('basic', 'octagon', (w, h) => {
  const s = Math.min(w, h) * 0.2929
  return g(new P().poly([[s, 0], [w - s, 0], [w, s], [w, h - s], [w - s, h], [s, h], [0, h - s], [0, s]]).d)
}, [0.1, 0.1, 0.1, 0.1])
add('basic', 'pie', (w, h) => g(new P().M(w / 2, h / 2).at(w / 2, h / 2, w / 2, h / 2, 0).A(w / 2, h / 2, w / 2, h / 2, 0, 270).Z().d), ELL)
add('basic', 'chord', (w, h) => g(new P().at(w / 2, h / 2, w / 2, h / 2, 45, true).A(w / 2, h / 2, w / 2, h / 2, 45, 270).Z().d), ELL)
add('basic', 'teardrop', (w, h) => g(new P().M(0, h / 2).A(w / 2, h / 2, w / 2, h / 2, 180, 270).L(w, 0).L(w, h / 2).A(w / 2, h / 2, w / 2, h / 2, 0, 180).Z().d), ELL)
add('basic', 'frame', (w, h) => {
  const s = Math.min(w, h) * 0.125
  return g(new P().rect(0, 0, w, h).rect(s, s, w - 2 * s, h - 2 * s, true).d, { evenOdd: true })
}, [0.15, 0.15, 0.15, 0.15])
add('basic', 'halfFrame', (w, h) => {
  const s = Math.min(w, h) * 0.333
  return g(new P().poly([[0, 0], [w, 0], [w - s, s], [s, s], [s, h - s], [0, h]]).d)
})
add('basic', 'corner', (w, h) => {
  const s = Math.min(w, h) * 0.5
  return g(new P().poly([[0, 0], [s, 0], [s, h - s], [w, h - s], [w, h], [0, h]]).d)
})
add('basic', 'diagStripe', fpoly([[0, 0.5], [0.5, 0], [1, 0], [0, 1]]))
add('basic', 'plus', (w, h) => {
  const s = Math.min(w, h) * 0.25
  return g(new P().poly([[s, 0], [w - s, 0], [w - s, s], [w, s], [w, h - s], [w - s, h - s], [w - s, h], [s, h], [s, h - s], [0, h - s], [0, s], [s, s]]).d)
}, [0.25, 0.25, 0.25, 0.25])
add('basic', 'plaque', (w, h) => {
  const s = Math.min(w, h) * 0.1667
  return g(new P().M(s, 0).L(w - s, 0).A(w, 0, s, s, 180, 90).L(w, h - s).A(w, h, s, s, 270, 180).L(s, h).A(0, h, s, s, 360, 270).L(0, s).A(0, 0, s, s, 90, 0).Z().d)
}, [0.1, 0.1, 0.1, 0.1])
const can = (w: number, h: number, tf?: (x: number, y: number) => [number, number]) => {
  const ry = Math.min(w, h) * 0.125
  const body = new P(tf).M(0, ry).A(w / 2, ry, w / 2, ry, 180, 360).L(w, h - ry).A(w / 2, h - ry, w / 2, ry, 0, 180).Z()
  const top = new P(tf).ellipse(w / 2, ry, w / 2, ry)
  return g(body.d, { light: top.d, x: new P(tf).M(0, ry).A(w / 2, ry, w / 2, ry, 180, 0).d })
}
add('basic', 'can', (w, h) => can(w, h), [0, 0.3, 0, 0.1])
add('basic', 'cube', (w, h) => {
  const s = Math.min(w, h) * 0.25
  return g(new P().poly([[0, s], [s, 0], [w, 0], [w, h - s], [w - s, h], [0, h]]).d, {
    light: new P().poly([[0, s], [s, 0], [w, 0], [w - s, s]]).d,
    dark: new P().poly([[w - s, s], [w, 0], [w, h - s], [w - s, h]]).d,
    x: new P().M(0, s).L(w - s, s).L(w, 0).M(w - s, s).L(w - s, h).d,
  })
}, [0, 0.25, 0.25, 0])
add('basic', 'bevel', (w, h) => {
  const s = Math.min(w, h) * 0.125
  return g(new P().rect(0, 0, w, h).d, {
    light: new P().poly([[0, 0], [w, 0], [w - s, s], [s, s], [s, h - s], [0, h]]).d,
    dark: new P().poly([[w, 0], [w, h], [0, h], [s, h - s], [w - s, h - s], [w - s, s]]).d,
    x: new P().rect(s, s, w - 2 * s, h - 2 * s).M(0, 0).L(s, s).M(w, 0).L(w - s, s).M(w, h).L(w - s, h - s).M(0, h).L(s, h - s).d,
  })
}, [0.15, 0.15, 0.15, 0.15])
add('basic', 'donut', (w, h) => {
  const t = Math.min(w, h) * 0.25
  return g(new P().ellipse(w / 2, h / 2, w / 2, h / 2).ellipse(w / 2, h / 2, w / 2 - t, h / 2 - t, true).d, { evenOdd: true })
}, ELL)
add('basic', 'noSmoking', (w, h) => {
  const t = Math.min(w, h) * 0.18
  const [cx, cy, rx, ry] = [w / 2, h / 2, w / 2 - t, h / 2 - t]
  const on = (a: number): [number, number] => [cx + rx * Math.cos((a * Math.PI) / 180), cy + ry * Math.sin((a * Math.PI) / 180)]
  return g(new P().ellipse(cx, cy, w / 2, h / 2).ellipse(cx, cy, rx, ry, true).poly([on(245), on(25), on(65), on(205)]).d, { evenOdd: true })
}, ELL)
add('basic', 'blockArc', (w, h) => {
  const t = Math.min(w, h) * 0.25
  return g(new P().M(0, h / 2).A(w / 2, h / 2, w / 2, h / 2, 180, 360).L(w - t, h / 2).A(w / 2, h / 2, w / 2 - t, h / 2 - t, 360, 180).Z().d)
}, [0, 0, 0, 0.5])
add('basic', 'foldedCorner', (w, h) => {
  const s = Math.min(w, h) * 0.1667
  return g(new P().poly([[0, 0], [w, 0], [w, h - s], [w - s, h], [0, h]]).d, { dark: new P().poly([[w, h - s], [w - s, h], [w - s * 0.8, h - s * 0.8]]).d })
}, [0, 0, 0, 0.12])
add('basic', 'smileyFace', (w, h) => {
  const eye = (x: number) => new P().ellipse(x * w, 0.37 * h, 0.05 * w, 0.07 * h).d
  return g(new P().ellipse(w / 2, h / 2, w / 2, h / 2).d, { dark: eye(0.34) + eye(0.66), x: new P().M(0.27 * w, 0.66 * h).C(0.4 * w, 0.82 * h, 0.6 * w, 0.82 * h, 0.73 * w, 0.66 * h).d })
}, ELL)
add('basic', 'heart', (w, h) =>
  g(new P().M(w / 2, h * 0.25).C(w * 0.55, -h * 0.05, w, 0, w, h * 0.3).C(w, h * 0.5, w * 0.8, h * 0.68, w / 2, h).C(w * 0.2, h * 0.68, 0, h * 0.5, 0, h * 0.3).C(0, 0, w * 0.45, -h * 0.05, w / 2, h * 0.25).Z().d),
  [0.2, 0.25, 0.2, 0.25],
)
add('basic', 'lightningBolt', fpoly([[0.39, 0], [0.6, 0.29], [0.52, 0.33], [0.79, 0.56], [0.7, 0.6], [1, 1], [0.47, 0.7], [0.57, 0.65], [0.24, 0.45], [0.35, 0.4], [0, 0.18]]))
add('basic', 'sun', (w, h) => {
  const p = new P().ellipse(w / 2, h / 2, w * 0.25, h * 0.25)
  for (let i = 0; i < 8; i++) {
    const a = (i * 45 * Math.PI) / 180
    const b = 0.09
    const pt = (r: number, da: number): [number, number] => [w / 2 + (w / 2) * r * Math.cos(a + da), h / 2 + (h / 2) * r * Math.sin(a + da)]
    p.poly([pt(1, 0), pt(0.62, b * 2.2), pt(0.62, -b * 2.2)])
  }
  return g(p.d)
}, [0.28, 0.28, 0.28, 0.28])
add('basic', 'moon', (w, h) => g(new P().M(w, 0).A(w, h / 2, w, h / 2, 270, 90).A(w, h / 2, w * 0.5, h / 2, 90, 270).Z().d), [0.1, 0.25, 0.55, 0.25])
add('basic', 'cloud', (w, h) => g(cloud(new P(), w / 2, h / 2, w * 0.36, h * 0.33).d), [0.18, 0.2, 0.18, 0.2])
add('basic', 'arc', (w, h) => g(new P().at(w / 2, h / 2, w / 2, h / 2, 270, true).A(w / 2, h / 2, w / 2, h / 2, 270, 360).d, { open: true }))
const bracket = (w: number, h: number, left: boolean) => {
  // Un trait droit, les bouts recourbés.
  const r = Math.min(h * 0.083, h / 2)
  const tf = left ? undefined : T.mirror(w)
  return new P(tf).M(w, 0).A(w, r, w, r, 270, 180).L(0, h - r).A(w, h - r, w, r, 180, 90).d
}
const brace = (w: number, h: number, left: boolean) => {
  const r = Math.min(h * 0.083, h / 4)
  const tf = left ? undefined : T.mirror(w)
  return new P(tf).M(w, 0).A(w, r, w / 2, r, 270, 180).L(w / 2, h / 2 - r).A(0, h / 2 - r, w / 2, r, 0, 90).A(0, h / 2 + r, w / 2, r, 270, 360).L(w / 2, h - r).A(w, h - r, w / 2, r, 180, 90).d
}
add('basic', 'bracketPair', (w, h) => {
  const s = Math.min(w, h) * 0.18
  const one = (tf?: (x: number, y: number) => [number, number]) => new P(tf).M(s, 0).A(s, s, s, s, 270, 180).L(0, h - s).A(s, h - s, s, s, 180, 90).d
  return g(one() + one(T.mirror(w)), { open: true })
}, [0.1, 0.1, 0.1, 0.1])
add('basic', 'bracePair', (w, h) => {
  const s = Math.min(w, h) * 0.1
  const one = (tf?: (x: number, y: number) => [number, number]) =>
    new P(tf).M(s * 2, 0).A(s * 2, s, s, s, 270, 180).L(s, h / 2 - s).A(0, h / 2 - s, s, s, 0, 90).A(0, h / 2 + s, s, s, 270, 360).L(s, h - s).A(s * 2, h - s, s, s, 180, 90).d
  return g(one() + one(T.mirror(w)), { open: true })
}, [0.12, 0.1, 0.12, 0.1])
add('basic', 'leftBracket', (w, h) => g(bracket(w, h, true), { open: true }))
add('basic', 'rightBracket', (w, h) => g(bracket(w, h, false), { open: true }))
add('basic', 'leftBrace', (w, h) => g(brace(w, h, true), { open: true }))
add('basic', 'rightBrace', (w, h) => g(brace(w, h, false), { open: true }))

// --- flèches pleines ------------------------------------------------------------------
add('arrows', 'rightArrow', (w, h) => g(arrowRight(w, h)), [0, 0.25, 0.25, 0.25])
add('arrows', 'leftArrow', (w, h) => g(arrowRight(w, h, T.mirror(w))), [0.25, 0.25, 0, 0.25])
add('arrows', 'downArrow', (w, h) => g(arrowRight(h, w, T.down())), [0.25, 0, 0.25, 0.25])
add('arrows', 'upArrow', (w, h) => g(arrowRight(h, w, T.up(h))), [0.25, 0.25, 0.25, 0])
const lr = (W: number, H: number, tf?: (x: number, y: number) => [number, number]) => {
  const hl = Math.min(W / 2, H) * 0.5
  return new P(tf).poly([[0, H / 2], [hl, 0], [hl, H * 0.25], [W - hl, H * 0.25], [W - hl, 0], [W, H / 2], [W - hl, H], [W - hl, H * 0.75], [hl, H * 0.75], [hl, H]]).d
}
add('arrows', 'leftRightArrow', (w, h) => g(lr(w, h)), [0.2, 0.25, 0.2, 0.25])
add('arrows', 'upDownArrow', (w, h) => g(lr(h, w, T.down())), [0.25, 0.2, 0.25, 0.2])
const cross = (w: number, h: number, down: boolean) => {
  const ss = Math.min(w, h)
  const [s1, s2, hl] = [ss * 0.1, ss * 0.2, ss * 0.2]
  const cx = w / 2
  const cy = down ? h / 2 : h - s2
  const pts: [number, number][] = [[cx, 0], [cx + s2, hl], [cx + s1, hl], [cx + s1, cy - s1], [w - hl, cy - s1], [w - hl, cy - s2], [w, cy], [w - hl, cy + s2], [w - hl, cy + s1]]
  if (down) pts.push([cx + s1, cy + s1], [cx + s1, h - hl], [cx + s2, h - hl], [cx, h], [cx - s2, h - hl], [cx - s1, h - hl], [cx - s1, cy + s1])
  pts.push([hl, cy + s1], [hl, cy + s2], [0, cy], [hl, cy - s2], [hl, cy - s1], [cx - s1, cy - s1], [cx - s1, hl], [cx - s2, hl])
  return new P().poly(pts).d
}
add('arrows', 'quadArrow', (w, h) => g(cross(w, h, true)), [0.4, 0.4, 0.4, 0.4])
add('arrows', 'leftRightUpArrow', (w, h) => g(cross(w, h, false)), [0.4, 0.5, 0.4, 0.1])
add('arrows', 'bentArrow', (w, h) => {
  const t = Math.min(w, h) * 0.25
  const hl = t
  const R = t
  return g(new P().M(0, h).L(0, t / 2 + R).C(0, t / 2 + R * 0.45, R * 0.45, t / 2, R, t / 2).L(w - hl, t / 2).L(w - hl, 0).L(w, t).L(w - hl, 2 * t).L(w - hl, 1.5 * t).L(t, 1.5 * t).L(t, h).Z().d)
})
add('arrows', 'uturnArrow', (w, h) => {
  const t = Math.min(w, h) * 0.2
  const hh = t * 1.25
  const xc = w - hh
  const hl = hh * 1.2
  const R = Math.min(w, h) * 0.3
  const r = Math.max(0, R - t)
  const xo = xc + t / 2
  const xi = xc - t / 2
  const p = new P().M(0, h).L(0, R).A(R, R, R, R, 180, 270).L(xo - R, 0).A(xo - R, R, R, R, 270, 360).L(xo, h - hl).L(xc + hh, h - hl).L(xc, h).L(xc - hh, h - hl).L(xi, h - hl).L(xi, t + r)
  if (r > 0) p.A(xi - r, t + r, r, r, 0, -90)
  p.L(t + r, t)
  if (r > 0) p.A(t + r, t + r, r, r, 270, 180)
  return g(p.L(t, h).Z().d)
})
add('arrows', 'leftUpArrow', (w, h) => {
  const s2 = Math.min(w, h) * 0.25
  const [s1, hl] = [s2 * 0.5, s2]
  const [xc, yc] = [w - s2, h - s2]
  return g(new P().poly([[xc, 0], [xc + s2, hl], [xc + s1, hl], [xc + s1, yc + s1], [hl, yc + s1], [hl, yc + s2], [0, yc], [hl, yc - s2], [hl, yc - s1], [xc - s1, yc - s1], [xc - s1, hl], [xc - s2, hl]]).d)
})
add('arrows', 'bentUpArrow', (w, h) => {
  const ss = Math.min(w, h)
  const [t, hh, hl] = [ss * 0.25, ss * 0.25, ss * 0.25]
  const xc = w - hh
  return g(new P().poly([[0, h - t], [xc - t / 2, h - t], [xc - t / 2, hl], [xc - hh, hl], [xc, 0], [w, hl], [xc + t / 2, hl], [xc + t / 2, h], [0, h]]).d)
})
add('arrows', 'curvedRightArrow', (w, h) => g(curvedArrow(w, h)))
add('arrows', 'curvedLeftArrow', (w, h) => g(curvedArrow(w, h, T.mirror(w))))
add('arrows', 'curvedDownArrow', (w, h) => g(curvedArrow(h, w, T.down())))
add('arrows', 'curvedUpArrow', (w, h) => g(curvedArrow(h, w, T.up(h))))
add('arrows', 'stripedRightArrow', (w, h) => {
  const hl = Math.min(w, h) * 0.5
  const s = w * 0.04
  return g(new P().rect(0, h * 0.25, s, h * 0.5).rect(s * 2, h * 0.25, s, h * 0.5).poly([[s * 4, h * 0.25], [w - hl, h * 0.25], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, h * 0.75], [s * 4, h * 0.75]]).d)
}, [0.15, 0.25, 0.25, 0.25])
add('arrows', 'notchedRightArrow', (w, h) => {
  const hl = Math.min(w, h) * 0.5
  return g(new P().poly([[0, h * 0.25], [w - hl, h * 0.25], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, h * 0.75], [0, h * 0.75], [h * 0.25, h / 2]]).d)
}, [0.15, 0.25, 0.25, 0.25])
add('arrows', 'homePlate', (w, h) => {
  const s = Math.min(w, h) * 0.5
  return g(new P().poly([[0, 0], [w - s, 0], [w, h / 2], [w - s, h], [0, h]]).d)
}, [0, 0, 0.2, 0])
add('arrows', 'chevron', (w, h) => {
  const s = Math.min(w, h) * 0.5
  return g(new P().poly([[0, 0], [w - s, 0], [w, h / 2], [w - s, h], [0, h], [s, h / 2]]).d)
}, [0.25, 0, 0.25, 0])
add('arrows', 'rightArrowCallout', (w, h) => g(arrowCallout(w, h)), [0, 0, 0.4, 0])
add('arrows', 'leftArrowCallout', (w, h) => g(arrowCallout(w, h, T.mirror(w))), [0.4, 0, 0, 0])
add('arrows', 'downArrowCallout', (w, h) => g(arrowCallout(h, w, T.down())), [0, 0, 0, 0.4])
add('arrows', 'upArrowCallout', (w, h) => g(arrowCallout(h, w, T.up(h))), [0, 0.4, 0, 0])
add('arrows', 'leftRightArrowCallout', (w, h) => {
  const hl = Math.min(w, h) * 0.25
  const b = hl * 1.6
  return g(new P().poly([[0, h / 2], [hl, h * 0.25], [hl, h * 0.375], [b, h * 0.375], [b, 0], [w - b, 0], [w - b, h * 0.375], [w - hl, h * 0.375], [w - hl, h * 0.25], [w, h / 2], [w - hl, h * 0.75], [w - hl, h * 0.625], [w - b, h * 0.625], [w - b, h], [b, h], [b, h * 0.625], [hl, h * 0.625], [hl, h * 0.75]]).d)
}, [0.3, 0, 0.3, 0])
add('arrows', 'quadArrowCallout', (w, h) => {
  const ss = Math.min(w, h)
  const [s1, s2, hl, b] = [ss * 0.06, ss * 0.13, ss * 0.13, ss * 0.28]
  const [cx, cy] = [w / 2, h / 2]
  return g(
    new P().poly([
      [cx, 0], [cx + s2, hl], [cx + s1, hl], [cx + s1, b], [w - b, b], [w - b, cy - s1], [w - hl, cy - s1], [w - hl, cy - s2], [w, cy], [w - hl, cy + s2], [w - hl, cy + s1], [w - b, cy + s1], [w - b, h - b], [cx + s1, h - b], [cx + s1, h - hl], [cx + s2, h - hl],
      [cx, h], [cx - s2, h - hl], [cx - s1, h - hl], [cx - s1, h - b], [b, h - b], [b, cy + s1], [hl, cy + s1], [hl, cy + s2], [0, cy], [hl, cy - s2], [hl, cy - s1], [b, cy - s1], [b, b], [cx - s1, b], [cx - s1, hl], [cx - s2, hl],
    ]).d,
  )
}, [0.3, 0.3, 0.3, 0.3])
add('arrows', 'circularArrow', (w, h) => {
  const t = Math.min(w, h) * 0.125
  const hw = t * 1.2
  const [cx, cy, rx, ry] = [w / 2, h / 2, w / 2 - hw, h / 2 - hw]
  const end = 340
  const at = (a: number, d: number): [number, number] => [cx + (rx + d) * Math.cos((a * Math.PI) / 180), cy + (ry + d) * Math.sin((a * Math.PI) / 180)]
  const p = new P().at(cx, cy, rx + t / 2, ry + t / 2, 180, true).A(cx, cy, rx + t / 2, ry + t / 2, 180, end)
  const [ox, oy] = at(end, hw)
  const [tx, ty] = at(end + 24, 0)
  const [ix, iy] = at(end, -hw)
  p.L(ox, oy).L(tx, ty).L(ix, iy).at(cx, cy, rx - t / 2, ry - t / 2, end).A(cx, cy, rx - t / 2, ry - t / 2, end, 180).Z()
  return g(p.d)
}, [0.3, 0.3, 0.3, 0.3])

// --- équations ------------------------------------------------------------------------
const bar = (p: P, w: number, _h: number, y: number, t: number, m: number) => p.rect(m, y - t / 2, w - 2 * m, t)
add('equation', 'mathPlus', (w, h) => {
  const t = Math.min(w, h) * 0.24
  const m = Math.min(w, h) * 0.06
  const [cx, cy] = [w / 2, h / 2]
  return g(new P().poly([[cx - t / 2, m], [cx + t / 2, m], [cx + t / 2, cy - t / 2], [w - m, cy - t / 2], [w - m, cy + t / 2], [cx + t / 2, cy + t / 2], [cx + t / 2, h - m], [cx - t / 2, h - m], [cx - t / 2, cy + t / 2], [m, cy + t / 2], [m, cy - t / 2], [cx - t / 2, cy - t / 2]]).d)
})
add('equation', 'mathMinus', (w, h) => g(bar(new P(), w, h, h / 2, Math.min(w, h) * 0.24, w * 0.06).d))
add('equation', 'mathMultiply', (w, h) => {
  const t = 0.17
  const m = 0.12
  const pts: [number, number][] = [[-t, -0.5 + m], [t, -0.5 + m], [t, -t], [0.5 - m, -t], [0.5 - m, t], [t, t], [t, 0.5 - m], [-t, 0.5 - m], [-t, t], [-0.5 + m, t], [-0.5 + m, -t], [-t, -t]]
  const c = Math.SQRT1_2
  return g(new P().poly(pts.map(([x, y]) => [(0.5 + (x - y) * c) * w, (0.5 + (x + y) * c) * h])).d)
})
add('equation', 'mathDivide', (w, h) => {
  const t = Math.min(w, h) * 0.12
  const r = Math.min(w, h) * 0.09
  return g(bar(new P(), w, h, h / 2, t, w * 0.06).ellipse(w / 2, h * 0.2, r, r).ellipse(w / 2, h * 0.8, r, r).d)
})
add('equation', 'mathEqual', (w, h) => {
  const t = Math.min(w, h) * 0.2
  return g(bar(bar(new P(), w, h, h * 0.32, t, w * 0.06), w, h, h * 0.68, t, w * 0.06).d)
})
add('equation', 'mathNotEqual', (w, h) => {
  const t = Math.min(w, h) * 0.18
  const p = bar(bar(new P(), w, h, h * 0.32, t, w * 0.06), w, h, h * 0.68, t, w * 0.06)
  return g(p.poly([[w * 0.58, h * 0.04], [w * 0.72, h * 0.04], [w * 0.42, h * 0.96], [w * 0.28, h * 0.96]]).d)
})

// --- organigramme (flowchart) ---------------------------------------------------------
add('flowchart', 'flowChartProcess', (w, h) => g(new P().rect(0, 0, w, h).d))
add('flowchart', 'flowChartAlternateProcess', (w, h) => {
  const r = Math.min(w, h) * 0.1667
  return g(new P().corners(0, 0, w, h, [r, r, r, r]).d)
})
add('flowchart', 'flowChartDecision', fpoly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]), [0.25, 0.25, 0.25, 0.25])
add('flowchart', 'flowChartInputOutput', fpoly([[0.2, 0], [1, 0], [0.8, 1], [0, 1]]), [0.2, 0, 0.2, 0])
add('flowchart', 'flowChartPredefinedProcess', (w, h) => g(new P().rect(0, 0, w, h).d, { x: new P().M(w * 0.125, 0).L(w * 0.125, h).M(w * 0.875, 0).L(w * 0.875, h).d }), [0.125, 0, 0.125, 0])
add('flowchart', 'flowChartInternalStorage', (w, h) => g(new P().rect(0, 0, w, h).d, { x: new P().M(w * 0.125, 0).L(w * 0.125, h).M(0, h * 0.125).L(w, h * 0.125).d }), [0.125, 0.125, 0, 0])
const docPath = (p: P, x: number, y: number, w: number, h: number) =>
  p.M(x, y).L(x + w, y).L(x + w, y + h * 0.83).C(x + w * 0.75, y + h * 0.7, x + w * 0.6, y + h * 0.95, x + w / 2, y + h * 0.95).C(x + w * 0.3, y + h * 0.95, x + w * 0.2, y + h * 1.06, x, y + h * 0.9).Z()
add('flowchart', 'flowChartDocument', (w, h) => g(docPath(new P(), 0, 0, w, h).d), [0, 0, 0, 0.17])
add('flowchart', 'flowChartMultidocument', (w, h) => {
  const o = Math.min(w, h) * 0.08
  return g(docPath(new P(), 0, o * 2, w - o * 2, h - o * 2).d, { light: docPath(new P(), o * 2, 0, w - o * 2, h - o * 2).d + docPath(new P(), o, o, w - o * 2, h - o * 2).d })
}, [0, 0.2, 0.15, 0.2])
add('flowchart', 'flowChartTerminator', (w, h) => {
  const rx = Math.min(w * 0.16, h / 2)
  return g(new P().M(rx, 0).L(w - rx, 0).A(w - rx, h / 2, rx, h / 2, 270, 450).L(rx, h).A(rx, h / 2, rx, h / 2, 90, 270).Z().d)
}, [0.1, 0.1, 0.1, 0.1])
add('flowchart', 'flowChartPreparation', fpoly([[0.2, 0], [0.8, 0], [1, 0.5], [0.8, 1], [0.2, 1], [0, 0.5]]), [0.2, 0, 0.2, 0])
add('flowchart', 'flowChartManualInput', fpoly([[0, 0.2], [1, 0], [1, 1], [0, 1]]), [0, 0.2, 0, 0])
add('flowchart', 'flowChartManualOperation', fpoly([[0, 0], [1, 0], [0.8, 1], [0.2, 1]]), [0.2, 0, 0.2, 0])
add('flowchart', 'flowChartConnector', (w, h) => g(new P().ellipse(w / 2, h / 2, w / 2, h / 2).d), ELL)
add('flowchart', 'flowChartOffpageConnector', fpoly([[0, 0], [1, 0], [1, 0.8], [0.5, 1], [0, 0.8]]), [0, 0, 0, 0.2])
add('flowchart', 'flowChartPunchedCard', fpoly([[0.2, 0], [1, 0], [1, 1], [0, 1], [0, 0.2]]), [0, 0.2, 0, 0])
add('flowchart', 'flowChartPunchedTape', (w, h) =>
  g(new P().M(0, h * 0.1).C(w * 0.25, h * 0.3, w * 0.25, -h * 0.1, w / 2, h * 0.1).C(w * 0.75, h * 0.3, w * 0.75, -h * 0.1, w, h * 0.1).L(w, h * 0.9).C(w * 0.75, h * 0.7, w * 0.75, h * 1.1, w / 2, h * 0.9).C(w * 0.25, h * 0.7, w * 0.25, h * 1.1, 0, h * 0.9).Z().d),
  [0, 0.2, 0, 0.2],
)
const onEll = (w: number, h: number, a: number): [number, number] => [w / 2 + (w / 2) * Math.cos((a * Math.PI) / 180), h / 2 + (h / 2) * Math.sin((a * Math.PI) / 180)]
add('flowchart', 'flowChartSummingJunction', (w, h) => {
  const [a, b, c, d] = [onEll(w, h, 225), onEll(w, h, 45), onEll(w, h, 315), onEll(w, h, 135)]
  return g(new P().ellipse(w / 2, h / 2, w / 2, h / 2).d, { x: new P().M(...a).L(...b).M(...c).L(...d).d })
}, ELL)
add('flowchart', 'flowChartOr', (w, h) => g(new P().ellipse(w / 2, h / 2, w / 2, h / 2).d, { x: new P().M(w / 2, 0).L(w / 2, h).M(0, h / 2).L(w, h / 2).d }), ELL)
add('flowchart', 'flowChartCollate', (w, h) => g(new P().M(0, 0).L(w, 0).L(0, h).L(w, h).Z().d), [0.25, 0.25, 0.25, 0.25])
add('flowchart', 'flowChartSort', (w, h) => g(new P().poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]).d, { x: new P().M(0, h / 2).L(w, h / 2).d }), [0.25, 0.25, 0.25, 0.25])
add('flowchart', 'flowChartExtract', fpoly([[0.5, 0], [1, 1], [0, 1]]), [0.25, 0.5, 0.25, 0])
add('flowchart', 'flowChartMerge', fpoly([[0, 0], [1, 0], [0.5, 1]]), [0.25, 0, 0.25, 0.5])
add('flowchart', 'flowChartOnlineStorage', (w, h) => g(new P().M(w / 6, 0).L(w, 0).A(w, h / 2, w / 6, h / 2, 270, 90).L(w / 6, h).A(w / 6, h / 2, w / 6, h / 2, 90, 270).Z().d), [0.17, 0, 0.17, 0])
add('flowchart', 'flowChartDelay', (w, h) => g(new P().M(0, 0).L(w / 2, 0).A(w / 2, h / 2, w / 2, h / 2, 270, 450).L(0, h).Z().d), [0, 0.15, 0.15, 0.15])
add('flowchart', 'flowChartMagneticTape', (w, h) => g(new P().M(w / 2, h).A(w / 2, h / 2, w / 2, h / 2, 90, 405).L(w, onEll(w, h, 45)[1]).L(w, h).Z().d), ELL)
add('flowchart', 'flowChartMagneticDisk', (w, h) => can(w, h), [0, 0.3, 0, 0.1])
// Le cylindre couché : le dessus (l'ellipse) à droite.
add('flowchart', 'flowChartMagneticDrum', (w, h) => can(h, w, (x, y) => [w - y, x]), [0.1, 0, 0.3, 0])
add('flowchart', 'flowChartDisplay', (w, h) => g(new P().M(0, h / 2).L(w / 6, 0).L((w * 5) / 6, 0).A((w * 5) / 6, h / 2, w / 6, h / 2, 270, 450).L(w / 6, h).Z().d), [0.17, 0, 0.17, 0])

// --- étoiles et bannières -------------------------------------------------------------
const SEAL1 = [[10800, 5800], [14522, 0], [14155, 5325], [18380, 4457], [16702, 7315], [21097, 8137], [17607, 10475], [21600, 13290], [16837, 12942], [18145, 18095], [14020, 14457], [13247, 19737], [10532, 14935], [8485, 21600], [7715, 15627], [4762, 17617], [5667, 13937], [135, 14587], [3722, 11775], [0, 8615], [4627, 7617], [370, 2295], [7312, 6320], [8352, 2295]]
const SEAL2 = [[11462, 4342], [14790, 0], [14525, 5777], [18007, 3172], [16380, 6532], [21600, 6645], [16985, 9402], [18270, 11290], [16380, 12310], [18877, 15632], [14640, 14350], [14942, 17370], [12180, 15935], [11612, 18842], [9872, 17370], [8700, 19712], [7527, 18125], [4917, 21600], [4805, 18240], [1285, 17825], [3330, 15370], [0, 12877], [3935, 11592], [1172, 8270], [5372, 7817], [4502, 3625], [8550, 6382], [9722, 1887]]
add('stars', 'irregularSeal1', fpoly(SEAL1.map(([x, y]) => [x / 21600, y / 21600])), [0.3, 0.3, 0.3, 0.3])
add('stars', 'irregularSeal2', fpoly(SEAL2.map(([x, y]) => [x / 21600, y / 21600])), [0.3, 0.3, 0.3, 0.3])
for (const [n, inner] of [[4, 0.38], [5, 0.42], [6, 0.55], [7, 0.55], [8, 0.62], [10, 0.65], [12, 0.7], [16, 0.75], [24, 0.8], [32, 0.85]] as const) add('stars', `star${n}`, (w, h) => g(star(n, inner, w, h)), [0.3, 0.3, 0.3, 0.3])
const ribbon = (w: number, h: number, curved: boolean, tf?: (x: number, y: number) => [number, number]) => {
  const c = curved ? h * 0.12 : 0
  const p = new P(tf).M(w * 0.15, c).C(w * 0.35, -c / 3, w * 0.65, -c / 3, w * 0.85, c).L(w * 0.85, h * 0.25).L(w, h * 0.25).L(w * 0.92, h * 0.625).L(w, h).L(w * 0.75, h).L(w * 0.75, h * 0.75 + c)
  p.C(w * 0.6, h * 0.75 - c / 3, w * 0.4, h * 0.75 - c / 3, w * 0.25, h * 0.75 + c).L(w * 0.25, h).L(0, h).L(w * 0.08, h * 0.625).L(0, h * 0.25).L(w * 0.15, h * 0.25).Z()
  const fold = new P(tf).poly([[w * 0.15, h * 0.75 + c * 0.4], [w * 0.25, h * 0.75 + c], [w * 0.25, h * 0.9]]).poly([[w * 0.85, h * 0.75 + c * 0.4], [w * 0.75, h * 0.75 + c], [w * 0.75, h * 0.9]])
  return g(p.d, { dark: fold.d, x: new P(tf).M(w * 0.15, h * 0.25).L(w * 0.15, h * 0.75 + c * 0.4).M(w * 0.85, h * 0.25).L(w * 0.85, h * 0.75 + c * 0.4).d })
}
add('stars', 'ribbon2', (w, h) => ribbon(w, h, false), [0.2, 0.05, 0.2, 0.3])
add('stars', 'ribbon', (w, h) => ribbon(w, h, false, (x, y) => [x, h - y]), [0.2, 0.3, 0.2, 0.05])
add('stars', 'ellipseRibbon2', (w, h) => ribbon(w, h, true), [0.2, 0.1, 0.2, 0.3])
add('stars', 'ellipseRibbon', (w, h) => ribbon(w, h, true, (x, y) => [x, h - y]), [0.2, 0.3, 0.2, 0.1])
const scroll = (w: number, h: number, tf?: (x: number, y: number) => [number, number]) => {
  const s = Math.min(w, h) * 0.125
  const p = new P(tf).rect(s, s, w - 2 * s, h - 2 * s).corners(s, 0, w - s, 2 * s, [s, s, s, s]).corners(0, h - 2 * s, w - s, 2 * s, [s, s, s, s])
  return g(p.d, { x: new P(tf).ellipse(w - s * 1.5, s, s / 2, s / 2).ellipse(s * 1.5, h - s, s / 2, s / 2).d })
}
add('stars', 'verticalScroll', (w, h) => scroll(w, h), [0.15, 0.25, 0.15, 0.25])
add('stars', 'horizontalScroll', (w, h) => scroll(h, w, T.down()), [0.25, 0.15, 0.25, 0.15])
const wave = (w: number, h: number, n: number) => {
  const t = h * 0.12
  const a = h * 0.2
  const p = new P().M(0, t)
  const seg = w / n
  for (let i = 0; i < n; i++) p.C(seg * i + seg / 3, t - a, seg * i + (seg * 2) / 3, t + a, seg * (i + 1), t)
  p.L(w, h - t)
  for (let i = n - 1; i >= 0; i--) p.C(seg * i + (seg * 2) / 3, h - t + a, seg * i + seg / 3, h - t - a, seg * i, h - t)
  return g(p.Z().d)
}
add('stars', 'wave', (w, h) => wave(w, h, 1), [0, 0.2, 0, 0.2])
add('stars', 'doubleWave', (w, h) => wave(w, h, 2), [0, 0.2, 0, 0.2])

// --- bulles et légendes ---------------------------------------------------------------
const tail = (p: P, w: number, h: number) => p.L(0.42 * w, h).L(TIP[0] * w, TIP[1] * h).L(0.17 * w, h)
add('callouts', 'wedgeRectCallout', (w, h) => g(tail(new P().M(0, 0).L(w, 0).L(w, h), w, h).L(0, h).Z().d))
add('callouts', 'wedgeRoundRectCallout', (w, h) => {
  const r = Math.min(w, h) * 0.1667
  const p = new P().M(r, 0).L(w - r, 0).A(w - r, r, r, r, 270, 360).L(w, h - r).A(w - r, h - r, r, r, 0, 90)
  return g(tail(p, w, h).L(r, h).A(r, h - r, r, r, 90, 180).L(0, r).A(r, r, r, r, 180, 270).Z().d)
}, [0.05, 0.05, 0.05, 0.05])
add('callouts', 'wedgeEllipseCallout', (w, h) => g(new P().at(w / 2, h / 2, w / 2, h / 2, 125, true).A(w / 2, h / 2, w / 2, h / 2, 125, 460).L(TIP[0] * w, TIP[1] * h).Z().d), ELL)
add('callouts', 'cloudCallout', (w, h) => {
  const p = cloud(new P(), w / 2, h / 2, w * 0.36, h * 0.33)
  return g(p.ellipse(0.34 * w, 0.95 * h, 0.05 * w, 0.045 * h).ellipse(0.31 * w, 1.06 * h, 0.03 * w, 0.03 * h).d)
}, [0.18, 0.2, 0.18, 0.2])
add('callouts', 'borderCallout1', (w, h) => g(new P().rect(0, 0, w, h).d, { x: leader(w, h) }))
add('callouts', 'accentCallout1', (w, h) => g(new P().rect(0, 0, w, h).d, { noStroke: true, x: new P().M(-0.083 * w, 0).L(-0.083 * w, h).d + leader(w, h) }))
add('callouts', 'callout1', (w, h) => g(new P().rect(0, 0, w, h).d, { noStroke: true, x: leader(w, h) }))
add('callouts', 'accentBorderCallout1', (w, h) => g(new P().rect(0, 0, w, h).d, { x: new P().M(-0.083 * w, 0).L(-0.083 * w, h).d + leader(w, h) }))

export const SHAPES: readonly ShapeDef[] = S
const BY_ID = new Map(S.map((s) => [s.id, s]))
/** Le nom d'une forme connue ; sinon null. */
export const shapeDef = (id: string): ShapeDef | null => BY_ID.get(id) ?? null
export const isShapeKind = (id: string): boolean => BY_ID.has(id)

/** Les formes « traits » : jamais remplies, sans texte. */
export const isLineKind = (id: string): boolean => !!BY_ID.get(id)?.draw(10, 10).open

/** Le dessin d'une forme (taille en points) ; une forme inconnue est un rectangle. */
export function shapeGeom(id: string, w: number, h: number): ShapeGeom {
  const def = BY_ID.get(id) ?? BY_ID.get('rect')!
  return def.draw(Math.max(0.01, w), Math.max(0.01, h))
}

/** La zone du texte d'une forme : marges en points (gauche, haut, droite, bas). */
export function textBox(id: string, w: number, h: number): [number, number, number, number] {
  const m = BY_ID.get(id)?.text ?? [0, 0, 0, 0]
  return [m[0] * w, m[1] * h, m[2] * w, m[3] * h]
}

/** Ce qu'un document peut nommer : les formes, la zone de texte, le groupe. */
export const SHAPE_KINDS: readonly string[] = [...S.map((s) => s.id), 'textBox', 'picture', 'group']
export const SHAPE_ID = /^[A-Za-z0-9_-]{1,64}$/
export const SHAPE_LIMITS = { children: 100, depth: 3 }
/** Des noms courants pour les formes (une IA écrit volontiers « circle » ou « arrow »). */
export const SHAPE_ALIASES: Record<string, string> = {
  rectangle: 'rect',
  square: 'rect',
  box: 'rect',
  rectangleroundedcorners: 'roundRect',
  roundedrectangle: 'roundRect',
  roundedrect: 'roundRect',
  circle: 'ellipse',
  oval: 'ellipse',
  arrow: 'rightArrow',
  arrowright: 'rightArrow',
  arrowleft: 'leftArrow',
  arrowup: 'upArrow',
  arrowdown: 'downArrow',
  star: 'star5',
  speechbubble: 'wedgeRoundRectCallout',
  bubble: 'wedgeRoundRectCallout',
  callout: 'wedgeRectCallout',
  thoughtbubble: 'cloudCallout',
  connector: 'line',
  straightconnector1: 'line',
  arrowline: 'line',
  cylinder: 'can',
  ring: 'donut',
  cross: 'plus',
  decision: 'flowChartDecision',
  process: 'flowChartProcess',
  terminator: 'flowChartTerminator',
  explosion: 'irregularSeal1',
  burst: 'irregularSeal1',
  banner: 'ribbon2',
  scroll: 'horizontalScroll',
  text: 'textBox',
  textbox: 'textBox',
  image: 'picture',
  photo: 'picture',
  pic: 'picture',
}

/** Réglages par défaut d'une nouvelle forme (taille en points, couleurs, habillage). */
export function shapeDefaults(kind: string): { width: number; height: number; fill: string; line: string; lineWidth: number; wrap: 'front' | 'square'; valign: 'top' | 'middle' } {
  if (kind === 'textBox') return { width: 144, height: 72, fill: '#ffffff', line: 'text', lineWidth: 0.75, wrap: 'square', valign: 'top' }
  // Image libre : pas de remplissage ni de contour, le texte l'entoure.
  if (kind === 'picture') return { width: 144, height: 108, fill: 'none', line: 'none', lineWidth: 1, wrap: 'square', valign: 'middle' }
  if (isLineKind(kind)) return { width: 144, height: 0, fill: 'none', line: 'accent1', lineWidth: 1.5, wrap: 'front', valign: 'middle' }
  return { width: 72, height: 72, fill: 'accent1', line: 'accent1', lineWidth: 1, wrap: 'front', valign: 'middle' }
}

/** La description d'une forme exportée en .odt : la forme entière, relue à l'import. */
export const SHAPE_ALT = 'folio-shape:'
