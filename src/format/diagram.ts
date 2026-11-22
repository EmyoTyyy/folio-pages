// Diagrammes (Insertion → Diagramme) : une liste à puces mise en forme —
// liste, processus, cycle, hiérarchie, pyramide, radial. Le diagramme garde
// son texte (éléments et niveaux) ; le dessin est un SVG fait ici, le même pour
// l'éditeur, la page web, l'EPUB, le PDF ; .docx et .odt reçoivent une image
// SVG dont le texte de remplacement porte les données (relu à l'import).

import type { ChartLook } from './chart'
import type { Block, BlockOf, DiagramBlock, DiagramItem, FolioDoc } from './types'

export const DIAGRAM_KINDS = ['list', 'process', 'cycle', 'hierarchy', 'pyramid', 'radial'] as const
export type DiagramKind = (typeof DIAGRAM_KINDS)[number]
export const DIAGRAM_COLORS = ['colorful', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const
export const DIAGRAM_ALT = 'folio-diagram:'
export const DIAGRAM_LIMITS = { items: 40, text: 200, level: 3 }

const W = 640
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const f = (n: number) => (Math.round(n * 10) / 10).toString()

// --- couleurs ---------------------------------------------------------------------

const rgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const v = m ? parseInt(m[1], 16) : 0x1e6b55
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
const hexOf = (c: [number, number, number]) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')
/** Mélange avec le blanc (0 : la couleur, 1 : blanc). */
export const tint = (hex: string, amount: number) => hexOf(rgb(hex).map((x) => x + (255 - x) * amount) as [number, number, number])
/** Texte lisible sur ce fond : blanc ou presque noir. */
export function onColor(hex: string): string {
  const [r, g, b] = rgb(hex).map((x) => {
    const s = x / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return l > 0.4 ? '#1f2937' : '#ffffff'
}

// --- texte --------------------------------------------------------------------------

/** Coupe un texte en lignes d'environ `width` pixels (largeur moyenne d'un caractère estimée). */
export function wrap(text: string, width: number, size: number, bold = false): string[] {
  const per = Math.max(4, Math.floor(width / (size * (bold ? 0.6 : 0.55))))
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word.length > per) {
      if (cur) lines.push(cur)
      for (let i = 0; i < word.length; i += per) lines.push(word.slice(i, i + per))
      cur = lines.pop() ?? ''
      continue
    }
    if (!cur) cur = word
    else if (cur.length + 1 + word.length <= per) cur += ' ' + word
    else {
      lines.push(cur)
      cur = word
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

/** Des lignes centrées autour de (cx, cy). */
export function lines(ls: string[], cx: number, cy: number, size: number, color: string, look: ChartLook, weight = 400, anchor: 'middle' | 'start' = 'middle'): string {
  const lh = size * 1.25
  const top = cy - ((ls.length - 1) * lh) / 2
  const spans = ls.map((l, i) => `<tspan x="${f(cx)}" y="${f(top + i * lh)}">${esc(l)}</tspan>`).join('')
  return `<text font-family="${esc(look.font)}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}" dominant-baseline="central">${spans}</text>`
}

export const rect = (x: number, y: number, w: number, h: number, fill: string, rx = 8, extra = '') => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${rx}" fill="${fill}"${extra}/>`

// --- structure ----------------------------------------------------------------------

interface Top {
  text: string
  children: string[]
}

/** Les éléments de premier niveau, chacun avec le texte de ses sous-éléments. */
function tops(items: DiagramItem[]): Top[] {
  const out: Top[] = []
  for (const it of items) {
    if (it.level === 0 || !out.length) out.push({ text: it.text, children: [] })
    else out[out.length - 1].children.push(it.text)
  }
  return out
}

interface Layout {
  body: string
  width: number
  height: number
}

type Painter = (t: Top[], items: DiagramItem[], look: ChartLook, color: (i: number) => string) => Layout

const listLayout: Painter = (t, _items, look, color) => {
  const parts: string[] = []
  let y = 4
  t.forEach((top, i) => {
    const c = color(i)
    const label = wrap(top.text, W - 40, 16, true)
    const h = Math.max(40, label.length * 20 + 16)
    parts.push(rect(4, y, W - 8, h, c), lines(label, 24, y + h / 2, 16, onColor(c), look, 650, 'start'))
    y += h
    if (top.children.length) {
      const sub = top.children.flatMap((s) => wrap(s, W - 70, 13).map((l, k) => (k === 0 ? `• ${l}` : `  ${l}`)))
      const hh = sub.length * 17 + 16
      parts.push(rect(20, y, W - 40, hh, tint(c, 0.85), 0, ''), lines(sub, 36, y + hh / 2, 13, look.text, look, 400, 'start'))
      y += hh
    }
    y += 10
  })
  return { body: parts.join(''), width: W, height: Math.max(60, y - 6) }
}

const processLayout: Painter = (t, _items, look, color) => {
  const n = t.length
  const perRow = Math.min(n, 4)
  const arrow = 28
  const boxW = (W - (perRow - 1) * arrow) / perRow
  const parts: string[] = []
  let y = 4
  for (let r = 0; r * perRow < n; r++) {
    const row = t.slice(r * perRow, r * perRow + perRow)
    const labels = row.map((top) => wrap(top.text, boxW - 18, 14, true))
    const subs = row.map((top) => top.children.flatMap((s) => wrap(s, boxW - 10, 12).map((l, k) => (k === 0 ? `• ${l}` : `  ${l}`))))
    const boxH = Math.max(56, Math.max(...labels.map((l) => l.length)) * 18 + 22)
    const subH = Math.max(0, ...subs.map((s) => (s.length ? s.length * 15 + 10 : 0)))
    row.forEach((_, k) => {
      const i = r * perRow + k
      const x = k * (boxW + arrow)
      const c = color(i)
      parts.push(rect(x, y, boxW, boxH, c), lines(labels[k], x + boxW / 2, y + boxH / 2, 14, onColor(c), look, 650))
      if (subs[k].length) parts.push(lines(subs[k], x + 6, y + boxH + 6 + (subs[k].length * 15) / 2, 12, look.text, look, 400, 'start'))
      if (k < row.length - 1) {
        const ax = x + boxW + 6
        const ay = y + boxH / 2
        parts.push(`<path d="M${f(ax)} ${f(ay - 10)}L${f(ax + arrow - 12)} ${f(ay)}L${f(ax)} ${f(ay + 10)}Z" fill="${tint(look.text, 0.55)}"/>`)
      }
    })
    y += boxH + subH + 18
  }
  return { body: parts.join(''), width: W, height: y - 14 }
}

const cycleLayout: Painter = (t, _items, look, color) => {
  const n = t.length
  const R = n <= 2 ? 110 : 150
  const cx = W / 2
  const boxW = n > 6 ? 118 : 140
  const labels = t.map((top) => wrap([top.text, ...top.children].join(' — '), boxW - 16, 13, true))
  const boxH = Math.max(46, Math.max(...labels.map((l) => l.length)) * 17 + 18)
  const cy = R + boxH / 2 + 8
  const parts: string[] = [`<defs><marker id="fp-dg-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="${tint(look.text, 0.45)}"/></marker></defs>`]
  const ang = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n
  if (n > 1) {
    // Arcs entre deux éléments voisins, de bord à bord.
    const gap = Math.min(0.42, Math.PI / n - 0.08)
    for (let i = 0; i < n; i++) {
      const a = ang(i) + gap
      const b = ang(i + 1) - gap
      parts.push(`<path d="M${f(cx + R * Math.cos(a))} ${f(cy + R * Math.sin(a))}A${R} ${R} 0 0 1 ${f(cx + R * Math.cos(b))} ${f(cy + R * Math.sin(b))}" fill="none" stroke="${tint(look.text, 0.45)}" stroke-width="2.5" marker-end="url(#fp-dg-arrow)"/>`)
    }
  }
  t.forEach((_, i) => {
    const x = cx + R * Math.cos(ang(i)) - boxW / 2
    const y = cy + R * Math.sin(ang(i)) - boxH / 2
    const c = color(i)
    parts.push(rect(x, y, boxW, boxH, c, 12), lines(labels[i], x + boxW / 2, y + boxH / 2, 13, onColor(c), look, 650))
  })
  return { body: parts.join(''), width: W, height: 2 * R + boxH + 16 }
}

interface Node {
  text: string
  depth: number
  kids: Node[]
  x: number
}

const hierarchyLayout: Painter = (_t, items, look, color) => {
  // L'arbre : le parent d'un élément est le dernier élément de niveau inférieur.
  const roots: Node[] = []
  const stack: Node[] = []
  for (const it of items) {
    while (stack.length && stack[stack.length - 1].depth >= it.level) stack.pop()
    const node: Node = { text: it.text, depth: stack.length, kids: [], x: 0 }
    if (stack.length) stack[stack.length - 1].kids.push(node)
    else roots.push(node)
    stack.push(node)
  }
  const leaves = (n: Node): number => (n.kids.length ? n.kids.reduce((s, k) => s + leaves(k), 0) : 1)
  const total = roots.reduce((s, r) => s + leaves(r), 0)
  const gap = 14
  const boxW = Math.max(80, Math.min(150, (W - (total - 1) * gap) / Math.max(1, total)))
  const width = Math.max(W, total * boxW + (total - 1) * gap)
  let next = 0
  const place = (n: Node) => {
    if (!n.kids.length) n.x = next++ * (boxW + gap) + boxW / 2
    else {
      n.kids.forEach(place)
      n.x = (n.kids[0].x + n.kids[n.kids.length - 1].x) / 2
    }
  }
  roots.forEach(place)
  const all: Node[] = []
  const walk = (n: Node) => {
    all.push(n)
    n.kids.forEach(walk)
  }
  roots.forEach(walk)
  const size = boxW < 110 ? 12 : 13
  const label = (n: Node) => wrap(n.text, boxW - 14, size, n.depth === 0)
  const boxH = Math.max(44, Math.max(...all.map((n) => label(n).length)) * (size * 1.25) + 16)
  const rowH = boxH + 34
  const off = (width - (total * boxW + (total - 1) * gap)) / 2
  const parts: string[] = []
  const line = tint(look.text, 0.5)
  for (const n of all) {
    const top = 4 + n.depth * rowH
    for (const k of n.kids) {
      const mid = top + boxH + 17
      parts.push(`<path d="M${f(off + n.x)} ${f(top + boxH)}V${f(mid)}H${f(off + k.x)}V${f(top + rowH)}" fill="none" stroke="${line}" stroke-width="1.6"/>`)
    }
  }
  roots.forEach((r, i) => {
    const paint = (n: Node) => {
      const top = 4 + n.depth * rowH
      const c = n.depth === 0 ? color(i) : tint(color(i), Math.min(0.8, 0.45 + n.depth * 0.15))
      parts.push(rect(off + n.x - boxW / 2, top, boxW, boxH, c), lines(label(n), off + n.x, top + boxH / 2, size, onColor(c), look, n.depth === 0 ? 650 : 500))
      n.kids.forEach(paint)
    }
    paint(r)
  })
  const depth = Math.max(0, ...all.map((n) => n.depth))
  return { body: parts.join(''), width, height: (depth + 1) * rowH - 26 }
}

const pyramidLayout: Painter = (t, _items, look, color) => {
  const n = t.length
  const maxW = W - 40
  const labels = t.map((top) => [top.text, ...top.children].join(' — '))
  const room = (i: number) => Math.max(90, maxW * (0.2 + (0.8 * (i + 0.5)) / n) * 0.78)
  const layerH = Math.max(52, ...labels.map((l, i) => wrap(l, room(i), 14, true).length * 18 + 18))
  const parts: string[] = []
  // Un sommet coupé : la première couche a la place d'écrire son texte.
  const widthAt = (k: number) => maxW * (0.2 + (0.8 * k) / n)
  t.forEach((_, i) => {
    const y = 4 + i * (layerH + 4)
    const a = widthAt(i)
    const b = widthAt(i + 1)
    const c = color(i)
    const cx = W / 2
    parts.push(`<path d="M${f(cx - a / 2)} ${f(y)}H${f(cx + a / 2)}L${f(cx + b / 2)} ${f(y + layerH)}H${f(cx - b / 2)}Z" fill="${c}"/>`)
    parts.push(lines(wrap(labels[i], room(i), 14, true), cx, y + layerH / 2, 14, onColor(c), look, 650))
  })
  return { body: parts.join(''), width: W, height: n * (layerH + 4) + 4 }
}

const radialLayout: Painter = (t, _items, look, color) => {
  const [center, ...around] = t
  const R = 176
  const rc = 72
  const r = around.length > 8 ? 44 : 54
  const cx = W / 2
  const cy = R + r + 8
  const parts: string[] = []
  const ang = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, around.length)
  around.forEach((_, i) => parts.push(`<line x1="${f(cx)}" y1="${f(cy)}" x2="${f(cx + R * Math.cos(ang(i)))}" y2="${f(cy + R * Math.sin(ang(i)))}" stroke="${tint(look.text, 0.55)}" stroke-width="2"/>`))
  const c0 = color(0)
  parts.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${rc}" fill="${c0}"/>`, lines(wrap(center?.text ?? '', rc * 1.6, 15, true), cx, cy, 15, onColor(c0), look, 700))
  around.forEach((top, i) => {
    const x = cx + R * Math.cos(ang(i))
    const y = cy + R * Math.sin(ang(i))
    const c = color(i + 1)
    parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="${c}"/>`, lines(wrap(top.text, r * 1.55, 12, true), x, y, 12, onColor(c), look, 650))
  })
  return { body: parts.join(''), width: W, height: around.length ? 2 * (R + r) + 16 : 2 * rc + 16 }
}

const PAINTERS: Record<DiagramKind, Painter> = { list: listLayout, process: processLayout, cycle: cycleLayout, hierarchy: hierarchyLayout, pyramid: pyramidLayout, radial: radialLayout }

/** Le dessin d'un diagramme, en SVG (texte échappé), et sa taille. */
export function diagramDrawing(d: DiagramBlock, look: ChartLook): { svg: string; width: number; height: number } {
  const items = d.items.length ? d.items : [{ text: '', level: 0 }]
  const palette = look.colors.length ? look.colors : ['#1e6b55']
  const color = (i: number) => (d.color && d.color !== 'colorful' ? palette[Math.max(0, Number(d.color.slice(6)) - 1)] ?? palette[0] : palette[i % palette.length])
  const lay = PAINTERS[d.kind](tops(items), items, look, color)
  const titleH = d.title ? 34 : 0
  const height = Math.ceil(lay.height + titleH + 8)
  const title = d.title ? lines([d.title], lay.width / 2, 16, 17, look.text, look, 700) : ''
  const label = esc([d.title, ...items.map((it) => `${'  '.repeat(it.level)}${it.text}`)].filter(Boolean).join('\n'))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(lay.width)} ${height}" width="${Math.ceil(lay.width)}" height="${height}" role="img"><title>${label}</title>${title}<g transform="translate(0 ${titleH + 4})">${lay.body}</g></svg>`
  return { svg, width: Math.ceil(lay.width), height }
}

export const diagramSvg = (d: DiagramBlock, look: ChartLook): string => diagramDrawing(d, look).svg

/** Le diagramme en liste à puces (Markdown, texte). */
export const diagramBullets = (d: DiagramBlock): string[] => d.items.map((it) => `${'  '.repeat(it.level)}- ${it.text}`)

/** Éléments d'un diagramme depuis du texte : une ligne par élément, deux espaces ou une tabulation par niveau. */
export function itemsFromText(text: string): DiagramItem[] {
  const out: DiagramItem[] = []
  for (const raw of text.split(/\r?\n/)) {
    const m = /^([ \t]*)(?:[-*•]\s+)?(.*)$/.exec(raw)!
    const body = m[2].trim()
    if (!body) continue
    const indent = m[1].replace(/\t/g, '  ').length
    const level = Math.min(DIAGRAM_LIMITS.level, Math.floor(indent / 2), out.length ? out[out.length - 1].level + 1 : 0)
    out.push({ text: body.slice(0, DIAGRAM_LIMITS.text), level })
    if (out.length >= DIAGRAM_LIMITS.items) break
  }
  return out
}

/** Le texte qu'on modifie (inverse de itemsFromText). */
export const itemsToText = (items: DiagramItem[]): string => items.map((it) => `${'  '.repeat(it.level)}${it.text}`).join('\n')

/** Base64 d'un texte UTF-8 (navigateur et Node). */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Un diagramme en image SVG ; son texte de remplacement porte ses données (relues à l'import). */
export function diagramImage(d: DiagramBlock, look: ChartLook, src?: string, maxWidth = 468): { block: BlockOf<'image'>; data: string } {
  const { svg, width, height } = diagramDrawing(d, look)
  const data = { kind: d.kind, items: d.items, ...(d.title ? { title: d.title } : {}), ...(d.color ? { color: d.color } : {}) }
  const uri = `data:image/svg+xml;base64,${base64Utf8(svg)}`
  // Taille donnée en entier : un SVG n'a pas de taille que les exports sachent lire.
  const w = Math.min(maxWidth, width * 0.75)
  const block = { type: 'image', src: src ?? uri, alt: DIAGRAM_ALT + JSON.stringify(data), caption: [], width: w, height: Math.round((w * height) / width * 10) / 10, align: 'center', wrap: 'none' } as BlockOf<'image'>
  return { block, data: uri }
}

/** Le document, ses diagrammes changés en images (pour .docx et .odt). */
export function diagramsAsImages(doc: FolioDoc, look: ChartLook): FolioDoc {
  const assets = { ...doc.assets }
  let n = 0
  const conv = (blocks: Block[]): Block[] =>
    blocks.map((b): Block => {
      if (b.type === 'diagram') {
        let id = `diagram-${++n}`
        while (id in assets) id = `diagram-${++n}`
        const { block, data } = diagramImage(b, look, `asset:${id}`)
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

/** Les données d'un diagramme lues dans un texte de remplacement « folio-diagram:… », ou null. */
export function diagramFromAlt(alt: string): Record<string, unknown> | null {
  if (!alt.startsWith(DIAGRAM_ALT)) return null
  try {
    const v = JSON.parse(alt.slice(DIAGRAM_ALT.length)) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? { type: 'diagram', ...(v as Record<string, unknown>) } : null
  } catch {
    return null
  }
}
