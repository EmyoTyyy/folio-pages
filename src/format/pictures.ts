// Disposition d'images (Format de l'image → Disposition de l'image ; Insertion →
// Images → Disposition d'images) : des images et leurs légendes arrangées en
// grille, en bandeau, autour d'une image mise en avant, en étapes, en liste ou
// en mosaïque. Le dessin est un SVG fait ici (chaque image est rognée pour
// remplir son cadre), le même pour l'éditeur, la page web, l'EPUB et le PDF ;
// .docx et .odt reçoivent une image SVG dont le texte de remplacement porte la
// disposition, et dont les images sont reprises à l'import.

import type { ChartLook } from './chart'
import { DIAGRAM_COLORS, base64Utf8, diagramImage, esc, f, lines, onColor, tint, wrap } from './diagram'
import type { Block, BlockOf, FolioDoc, PictureItem, PicturesBlock } from './types'

export const PICTURE_LAYOUTS = ['grid', 'strip', 'featured', 'process', 'list', 'mosaic'] as const
export type PictureLayout = (typeof PICTURE_LAYOUTS)[number]
export const PICTURES_ALT = 'folio-pictures:'
export const PICTURES_LIMITS = { items: 12, caption: 120, text: 400 }

/** Une image qu'on accepte dans une disposition : une ressource du document ou une image en data:. */
export const isPictureSrc = (s: string): boolean => /^asset:[A-Za-z0-9_.-]{1,64}$/.test(s) || /^data:image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(s)

const W = 640
let seq = 0

interface Paint {
  look: ChartLook
  color: (i: number) => string
  /** L'image à dessiner (data:), ou null : un cadre vide. */
  uri: (i: number) => string | null
  /** Préfixe des identifiants (plusieurs dessins dans une même page). */
  id: string
  defs: string[]
  items: PictureItem[]
}

interface Layout {
  body: string
  width: number
  height: number
}

type Painter = (p: Paint) => Layout

// --- petits outils -------------------------------------------------------------------

const LH = 1.25
const blockH = (ls: string[], size: number) => ls.length * size * LH
/** Des lignes posées à partir du haut (`top`). */
const at = (ls: string[], x: number, top: number, size: number, color: string, look: ChartLook, weight = 400, anchor: 'middle' | 'start' = 'start') =>
  ls.length ? lines(ls, x, top + blockH(ls, size) / 2, size, color, look, weight, anchor) : ''
/** Au plus `max` lignes ; la dernière finit par « … » s'il en manque. */
function clamp(ls: string[], max: number): string[] {
  if (ls.length <= max) return ls
  const out = ls.slice(0, max)
  out[max - 1] = out[max - 1].replace(/\s*\S{0,3}$/, '') + '…'
  return out
}
const capOf = (it: PictureItem, width: number, size: number, max = 3) => (it.caption ? clamp(wrap(it.caption, width, size, true), max) : [])
const textOf = (it: PictureItem, width: number, size: number, max = 5) => (it.text ? clamp(wrap(it.text, width, size), max) : [])
const dim = (look: ChartLook) => tint(look.text, 0.28)

/** Le cadre d'une image : l'image rognée pour le remplir, ou un cadre teinté avec un petit paysage. */
function frame(p: Paint, i: number, x: number, y: number, w: number, h: number, shape: 'rect' | 'circle' = 'rect', r = 10): string {
  const clip = `${p.id}c${i}`
  p.defs.push(
    shape === 'circle'
      ? `<clipPath id="${clip}"><circle cx="${f(x + w / 2)}" cy="${f(y + h / 2)}" r="${f(Math.min(w, h) / 2)}"/></clipPath>`
      : `<clipPath id="${clip}"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${r}"/></clipPath>`,
  )
  const uri = p.uri(i)
  if (uri) return `<image data-fp-pic="${i}" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})" xlink:href="${esc(uri)}"/>`
  const c = p.color(i)
  const s = Math.min(w, h) * 0.36
  const cx = x + w / 2
  const cy = y + h / 2
  const ink = tint(c, 0.3)
  return (
    `<g clip-path="url(#${clip})"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${tint(c, 0.82)}"/>` +
    `<circle cx="${f(cx + s * 0.3)}" cy="${f(cy - s * 0.24)}" r="${f(s * 0.13)}" fill="${ink}"/>` +
    `<path d="M${f(cx - s / 2)} ${f(cy + s * 0.34)}L${f(cx - s * 0.12)} ${f(cy - s * 0.1)}L${f(cx + s * 0.08)} ${f(cy + s * 0.14)}L${f(cx + s * 0.22)} ${f(cy)}L${f(cx + s / 2)} ${f(cy + s * 0.34)}Z" fill="${ink}"/></g>`
  )
}

/** Une bande de couleur en bas d'une image (dans son cadre), avec la légende. */
function band(p: Paint, i: number, x: number, y: number, w: number, h: number, size: number, max = 3): string {
  const ls = capOf(p.items[i], w - 22, size, max)
  if (!ls.length) return ''
  const c = p.color(i)
  const bh = blockH(ls, size) + 16
  return `<rect x="${f(x)}" y="${f(y + h - bh)}" width="${f(w)}" height="${f(bh)}" fill="${c}" fill-opacity="0.9" clip-path="url(#${p.id}c${i})"/>` + at(ls, x + 11, y + h - bh + 8, size, onColor(c), p.look, 650)
}

// --- dispositions --------------------------------------------------------------------

/** Grille : les images, la légende et le texte en dessous de chacune. */
const gridLayout: Painter = (p) => {
  const n = p.items.length
  const cols = n === 1 ? 1 : n === 2 || n === 4 ? 2 : n <= 6 || n === 9 ? 3 : 4
  const gap = 18
  const cw = (W - (cols - 1) * gap) / cols
  const ph = cols === 1 ? Math.min(cw * 0.6, 380) : cw * 0.75
  const size = cols >= 4 ? 13 : 14
  const parts: string[] = []
  let y = 4
  for (let r = 0; r * cols < n; r++) {
    const row = p.items.slice(r * cols, r * cols + cols)
    const off = (W - (row.length * cw + (row.length - 1) * gap)) / 2
    const caps = row.map((it) => capOf(it, cw - 4, size))
    const txts = row.map((it) => textOf(it, cw - 4, 12))
    const below = Math.max(0, ...row.map((_, k) => blockH(caps[k], size) + (txts[k].length ? 5 + blockH(txts[k], 12) : 0)))
    row.forEach((_, k) => {
      const i = r * cols + k
      const x = off + k * (cw + gap)
      parts.push(frame(p, i, x, y, cw, ph))
      let ty = y + ph + 12
      if (caps[k].length) {
        parts.push(`<rect x="${f(x)}" y="${f(y + ph + 7)}" width="26" height="3" rx="1.5" fill="${p.color(i)}"/>`, at(caps[k], x, ty + 3, size, p.look.text, p.look, 650))
        ty += blockH(caps[k], size) + 8
      }
      parts.push(at(txts[k], x, ty, 12, dim(p.look), p.look))
    })
    y += ph + (below ? 18 + below : 0) + gap
  }
  return { body: parts.join(''), width: W, height: y - gap + 4 }
}

/** Bandeau : les images côte à côte, hautes, la légende dans une bande de couleur. */
const stripLayout: Painter = (p) => {
  const n = p.items.length
  const perRow = n <= 5 ? n : Math.ceil(n / 2)
  const gap = 10
  const cw = (W - (perRow - 1) * gap) / perRow
  const ph = Math.min(360, perRow === 1 ? cw * 0.6 : perRow === 2 ? cw * 0.8 : cw * 1.3)
  const size = perRow >= 5 ? 12 : 13
  const parts: string[] = []
  let y = 4
  for (let r = 0; r * perRow < n; r++) {
    const row = p.items.slice(r * perRow, r * perRow + perRow)
    const txts = row.map((it) => textOf(it, cw - 4, 11.5, 4))
    const below = Math.max(0, ...txts.map((t) => blockH(t, 11.5)))
    row.forEach((_, k) => {
      const i = r * perRow + k
      const x = k * (cw + gap)
      parts.push(frame(p, i, x, y, cw, ph, 'rect', 8), band(p, i, x, y, cw, ph, size), at(txts[k], x + 2, y + ph + 8, 11.5, dim(p.look), p.look))
    })
    y += ph + (below ? 14 + below : 0) + gap + 4
  }
  return { body: parts.join(''), width: W, height: y - gap }
}

/** Mise en avant : la première image en grand, les autres plus petites à côté. */
const featuredLayout: Painter = (p) => {
  const n = p.items.length
  if (n === 1) return gridLayout(p)
  const parts: string[] = []
  const lw = W * 0.6
  const bh = lw * 0.75
  parts.push(frame(p, 0, 0, 4, lw, bh, 'rect', 12), band(p, 0, 0, 4, lw, bh, 16, 2))
  const bigText = textOf(p.items[0], lw - 4, 13, 4)
  parts.push(at(bigText, 2, 4 + bh + 10, 13, dim(p.look), p.look))
  const leftH = bh + (bigText.length ? 14 + blockH(bigText, 13) : 0)
  const x0 = lw + 18
  const rw = W - x0
  let y = 4
  if (n - 1 <= 4) {
    // Une colonne : une vignette, sa légende et son texte à droite.
    const tw = rw * 0.44
    const th = tw * 0.75
    const cw = rw - tw - 12
    for (let i = 1; i < n; i++) {
      const cap = capOf(p.items[i], cw, 13, 2)
      const txt = textOf(p.items[i], cw, 11.5, 3)
      const textH = blockH(cap, 13) + (txt.length ? 4 + blockH(txt, 11.5) : 0)
      const rowH = Math.max(th, textH)
      parts.push(frame(p, i, x0, y, tw, th, 'rect', 8))
      parts.push(`<rect x="${f(x0 + tw + 12)}" y="${f(y + 2)}" width="3" height="${f(Math.max(16, textH - 4))}" rx="1.5" fill="${p.color(i)}"/>`)
      parts.push(at(cap, x0 + tw + 22, y, 13, p.look.text, p.look, 650), at(txt, x0 + tw + 22, y + blockH(cap, 13) + 4, 11.5, dim(p.look), p.look))
      y += rowH + 12
    }
  } else {
    // Deux colonnes de vignettes, la légende en dessous.
    const tw = (rw - 12) / 2
    const th = tw * 0.75
    for (let k = 0; k * 2 < n - 1; k++) {
      const row = [1 + k * 2, 2 + k * 2].filter((i) => i < n)
      const caps = row.map((i) => capOf(p.items[i], tw - 2, 11.5, 2))
      const below = Math.max(0, ...caps.map((c) => blockH(c, 11.5)))
      row.forEach((i, j) => {
        const x = x0 + j * (tw + 12)
        parts.push(frame(p, i, x, y, tw, th, 'rect', 6), at(caps[j], x + 1, y + th + 6, 11.5, p.look.text, p.look, 650))
      })
      y += th + (below ? 10 + below : 0) + 10
    }
  }
  return { body: parts.join(''), width: W, height: Math.max(leftH + 4, y - 8) + 4 }
}

/** Étapes : les images de gauche à droite, reliées par des flèches, la légende dans une case de couleur. */
const processLayout: Painter = (p) => {
  const n = p.items.length
  const perRow = Math.min(n, 4)
  const arrow = 30
  const bw = (W - (perRow - 1) * arrow) / perRow
  const ph = bw * 0.75
  const parts: string[] = []
  let y = 4
  for (let r = 0; r * perRow < n; r++) {
    const row = p.items.slice(r * perRow, r * perRow + perRow)
    const caps = row.map((it) => capOf(it, bw - 16, 13))
    const txts = row.map((it) => textOf(it, bw - 4, 11.5, 4))
    const boxH = caps.some((c) => c.length) ? Math.max(34, Math.max(...caps.map((c) => blockH(c, 13))) + 14) : 0
    const below = Math.max(0, ...txts.map((t) => blockH(t, 11.5)))
    row.forEach((_, k) => {
      const i = r * perRow + k
      const x = k * (bw + arrow)
      const c = p.color(i)
      parts.push(frame(p, i, x, y, bw, ph, 'rect', 8))
      if (boxH) {
        parts.push(`<rect x="${f(x)}" y="${f(y + ph + 6)}" width="${f(bw)}" height="${f(boxH)}" rx="8" fill="${c}"/>`)
        if (caps[k].length) parts.push(lines(caps[k], x + bw / 2, y + ph + 6 + boxH / 2, 13, onColor(c), p.look, 650))
      }
      parts.push(at(txts[k], x + 2, y + ph + 6 + boxH + 8, 11.5, dim(p.look), p.look))
      if (k < row.length - 1) {
        const ax = x + bw + 7
        const ay = y + ph / 2
        parts.push(`<path d="M${f(ax)} ${f(ay - 10)}L${f(ax + arrow - 14)} ${f(ay)}L${f(ax)} ${f(ay + 10)}Z" fill="${tint(p.look.text, 0.55)}"/>`)
      }
    })
    y += ph + 6 + boxH + (below ? 12 + below : 0) + 20
  }
  return { body: parts.join(''), width: W, height: y - 16 }
}

/** Liste : une image ronde, la légende et le texte à côté, l'une sous l'autre. */
const listLayout: Painter = (p) => {
  const n = p.items.length
  const d = n > 6 ? 72 : 92
  const x = d + 24
  const tw = W - x
  const parts: string[] = []
  let y = 4
  p.items.forEach((it, i) => {
    const cap = capOf(it, tw, 16, 2)
    const txt = textOf(it, tw, 13, 4)
    const textH = blockH(cap, 16) + (txt.length ? 6 + blockH(txt, 13) : 0)
    const rowH = Math.max(d, textH)
    const cy = y + rowH / 2
    parts.push(frame(p, i, 4, cy - d / 2, d, d, 'circle'), `<circle cx="${f(4 + d / 2)}" cy="${f(cy)}" r="${f(d / 2 + 1)}" fill="none" stroke="${p.color(i)}" stroke-width="4"/>`)
    const top = cy - textH / 2
    parts.push(at(cap, x, top, 16, p.look.text, p.look, 650), at(txt, x, top + blockH(cap, 16) + (cap.length ? 6 : 0), 13, dim(p.look), p.look))
    y += rowH + 16
  })
  return { body: parts.join(''), width: W, height: y - 12 }
}

/** Mosaïque : la première image prend deux cases sur deux, les autres remplissent la grille. */
const mosaicLayout: Painter = (p) => {
  const n = p.items.length
  const gap = 8
  if (n === 1) {
    const h = W * 0.6
    return { body: frame(p, 0, 0, 4, W, h, 'rect', 8) + band(p, 0, 0, 4, W, h, 14, 2), width: W, height: h + 8 }
  }
  // Trois colonnes jusqu'à six images (six remplissent un carré de trois sur trois), puis quatre.
  const cols = n === 2 ? 2 : n <= 6 ? 3 : 4
  const cs = (W - (cols - 1) * gap) / cols
  const rh = n === 2 ? cs * 0.75 : cs * 0.8
  const used: boolean[][] = []
  const free = (r: number, c: number) => !used[r]?.[c]
  const take = (r: number, c: number) => {
    used[r] ??= []
    used[r][c] = true
  }
  const tiles: { r: number; c: number; w: number; h: number }[] = []
  for (let i = 0; i < n; i++) {
    const span = i === 0 && n >= 3 ? 2 : 1
    let placed = false
    for (let r = 0; !placed; r++) {
      for (let c = 0; c + span <= cols && !placed; c++) {
        let ok = true
        for (let a = 0; a < span; a++) for (let b = 0; b < span; b++) if (!free(r + a, c + b)) ok = false
        if (!ok) continue
        for (let a = 0; a < span; a++) for (let b = 0; b < span; b++) take(r + a, c + b)
        tiles.push({ r, c, w: span, h: span })
        placed = true
      }
    }
  }
  // La dernière image s'étend jusqu'au bout de sa rangée (pas de trou à droite).
  const last = tiles[tiles.length - 1]
  while (last.c + last.w < cols && free(last.r, last.c + last.w)) take(last.r, last.c + last.w++)
  const rows = used.length
  const parts: string[] = []
  tiles.forEach((t, i) => {
    const x = t.c * (cs + gap)
    const y = 4 + t.r * (rh + gap)
    const w = t.w * cs + (t.w - 1) * gap
    const h = t.h * rh + (t.h - 1) * gap
    parts.push(frame(p, i, x, y, w, h, 'rect', 6), band(p, i, x, y, w, h, t.w > 1 ? 14 : 12.5, 2))
  })
  return { body: parts.join(''), width: W, height: rows * (rh + gap) - gap + 8 }
}

const PAINTERS: Record<PictureLayout, Painter> = { grid: gridLayout, strip: stripLayout, featured: featuredLayout, process: processLayout, list: listLayout, mosaic: mosaicLayout }

/** Une image en data: d'une disposition, d'après les ressources du document (null : absente ou refusée). */
export function pictureUri(src: string | undefined, assets: Record<string, string>): string | null {
  if (!src) return null
  const uri = src.startsWith('asset:') ? (Object.prototype.hasOwnProperty.call(assets, src.slice(6)) ? assets[src.slice(6)] : null) : src
  return uri && /^data:image\//i.test(uri) ? uri : null
}

/** Le dessin d'une disposition d'images, en SVG (texte échappé), et sa taille. `uri` : l'image d'un « src ». */
export function picturesDrawing(b: PicturesBlock, look: ChartLook, uri: (src: string | undefined) => string | null): { svg: string; width: number; height: number } {
  const items = b.items.length ? b.items : [{}]
  const palette = look.colors.length ? look.colors : ['#1e6b55']
  const color = (i: number) => (b.color && b.color !== 'colorful' ? (palette[Math.max(0, Number(b.color.slice(6)) - 1)] ?? palette[0]) : palette[i % palette.length])
  const p: Paint = { look, color, uri: (i) => uri(items[i]?.src), id: `fp-pl${++seq}-`, defs: [], items }
  const lay = (PAINTERS[b.layout] ?? gridLayout)(p)
  const titleH = b.title ? 34 : 0
  const height = Math.ceil(lay.height + titleH + 8)
  const title = b.title ? lines([b.title], lay.width / 2, 16, 17, look.text, look, 700) : ''
  const label = esc([b.title, ...items.map((it) => [it.caption, it.text].filter(Boolean).join(' : '))].filter(Boolean).join('\n'))
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${Math.ceil(lay.width)} ${height}" width="${Math.ceil(lay.width)}" height="${height}" role="img">` +
    `<title>${label}</title><defs>${p.defs.join('')}</defs>${title}<g transform="translate(0 ${titleH + 4})">${lay.body}</g></svg>`
  return { svg, width: Math.ceil(lay.width), height }
}

/** Les légendes et textes en liste à puces (Markdown, texte). */
export const picturesBullets = (b: PicturesBlock): string[] => b.items.filter((it) => it.caption || it.text).map((it) => `- ${[it.caption, it.text].filter(Boolean).join(' : ')}`)

/** Les données d'une disposition (sans les images) : ce que porte le texte de remplacement de l'image exportée. */
const altData = (b: PicturesBlock) => ({
  layout: b.layout,
  ...(b.title ? { title: b.title } : {}),
  ...(b.color ? { color: b.color } : {}),
  items: b.items.map((it) => ({ ...(it.caption ? { caption: it.caption } : {}), ...(it.text ? { text: it.text } : {}), ...(it.src ? {} : { empty: true }) })),
})

/** Une disposition en image SVG (les images dedans) ; son texte de remplacement porte la disposition. */
export function picturesImage(b: PicturesBlock, look: ChartLook, assets: Record<string, string>, src?: string, maxWidth = 468): { block: BlockOf<'image'>; data: string } {
  const { svg, width, height } = picturesDrawing(b, look, (s) => pictureUri(s, assets))
  const uri = `data:image/svg+xml;base64,${base64Utf8(svg)}`
  const w = Math.min(maxWidth, width * 0.75)
  const block = { type: 'image', src: src ?? uri, alt: PICTURES_ALT + JSON.stringify(altData(b)), caption: [], width: w, height: Math.round(((w * height) / width) * 10) / 10, align: 'center', wrap: 'none' } as BlockOf<'image'>
  return { block, data: uri }
}

/** Le document, ses diagrammes et dispositions d'images changés en images (pour .docx et .odt). */
export function graphicsAsImages(doc: FolioDoc, look: ChartLook): FolioDoc {
  const assets = { ...doc.assets }
  let n = 0
  const fresh = (base: string) => {
    let id = `${base}-${++n}`
    while (id in assets) id = `${base}-${++n}`
    return id
  }
  const conv = (blocks: Block[]): Block[] =>
    blocks.map((b): Block => {
      if (b.type === 'diagram') {
        const id = fresh('diagram')
        const { block, data } = diagramImage(b, look, `asset:${id}`)
        assets[id] = data
        return block
      }
      if (b.type === 'pictures') {
        const id = fresh('pictures')
        const { block, data } = picturesImage(b, look, doc.assets, `asset:${id}`)
        assets[id] = data
        return block
      }
      if (b.type === 'quote' || b.type === 'callout' || b.type === 'columns') return { ...b, blocks: conv(b.blocks) } as Block
      if (b.type === 'table') return { ...b, rows: b.rows.map((r) => r.map((c) => ({ ...c, blocks: conv(c.blocks) }))) }
      return b
    })
  const blocks = conv(doc.blocks)
  return n ? { ...doc, blocks, assets } : doc
}

/** Texte d'un SVG en data: (base64 ou échappé). */
function svgText(uri: string): string | null {
  const m = /^data:image\/svg\+xml(;base64)?,(.*)$/is.exec(uri)
  if (!m) return null
  try {
    if (!m[1]) return decodeURIComponent(m[2])
    const bin = atob(m[2].replace(/\s+/g, ''))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * Une disposition relue (.docx, .odt) : ses données dans le texte de remplacement
 * « folio-pictures:… », ses images dans le SVG (`svg`, en data:). null : pas une des nôtres.
 */
export function picturesFromAlt(alt: string, svg: string | null): Record<string, unknown> | null {
  if (!alt.startsWith(PICTURES_ALT)) return null
  let v: unknown
  try {
    v = JSON.parse(alt.slice(PICTURES_ALT.length))
  } catch {
    return null
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const data = v as Record<string, unknown>
  const items = Array.isArray(data.items) ? (data.items as unknown[]).map((x) => (x && typeof x === 'object' ? { ...(x as Record<string, unknown>) } : {})) : []
  const text = svg ? svgText(svg) : null
  if (text) {
    const re = /<image data-fp-pic="(\d+)"[^>]*?xlink:href="(data:image\/[^"]+)"/g
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const i = Number(m[1])
      if (items[i]) items[i].src = m[2].replace(/&amp;/g, '&')
    }
  }
  for (const it of items) delete it.empty
  return { type: 'pictures', ...data, items }
}

/** Disposition validée → forme canonique ; `src(s)` range l'image (ressource) ou la refuse (null). Null si vide. */
export function picturesFrom(b: Record<string, unknown>, src: (s: string) => string | null): PicturesBlock | null {
  const clip = (v: unknown, max: number) =>
    String(v ?? '')
      .replace(/[\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  const items: PictureItem[] = []
  for (const x of Array.isArray(b.items) ? (b.items as unknown[]) : []) {
    const raw = typeof x === 'string' ? { caption: x } : x && typeof x === 'object' ? (x as Record<string, unknown>) : null
    if (!raw) continue
    const it: PictureItem = {}
    const s = typeof raw.src === 'string' && raw.src ? src(raw.src) : null
    if (s) it.src = s
    const caption = clip(raw.caption, PICTURES_LIMITS.caption)
    if (caption) it.caption = caption
    const text = clip(raw.text, PICTURES_LIMITS.text)
    if (text) it.text = text
    if (!it.src && !it.caption && !it.text) continue
    items.push(it)
    if (items.length >= PICTURES_LIMITS.items) break
  }
  if (!items.length) return null
  const layout = (PICTURE_LAYOUTS as readonly string[]).includes(b.layout as string) ? (b.layout as PictureLayout) : 'grid'
  const out: PicturesBlock = { type: 'pictures', layout, items }
  const title = clip(b.title, PICTURES_LIMITS.caption)
  if (title) out.title = title
  if (typeof b.color === 'string' && b.color !== 'colorful' && (DIAGRAM_COLORS as readonly string[]).includes(b.color)) out.color = b.color as PicturesBlock['color']
  return out
}
