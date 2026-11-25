// Onglet Dessin : stylo, surligneur et gomme sur la page (souris, stylet ou
// doigt). Un trait est rattaché au paragraphe où il commence, en points depuis
// son coin haut gauche : il suit le texte quand celui-ci bouge.

import { closeHistory } from 'prosemirror-history'
import type { FolioApp } from '../app'
import { displayScale } from '../layout/scale'
import { addStroke, clearInk, editInk, inkedBlocks, inkElement, removeStrokes } from '../editor/ink'
import { schema } from '../editor/schema'
import { freshShapeId, placeFor } from '../editor/shapes'
import { distanceToStroke, erasePoints, inkOpacity, inkPath, lassoed, PX_PER_PT, recognizeShape, simplify, type InkShape } from '../format/ink'
import { loadShape } from '../format/load'
import { cssColor } from '../format/color'
import type { InkStroke } from '../format/types'
import type { Key } from '../i18n/dict'
import { t } from '../i18n/i18n'
import { toast } from './dialog'
import { h } from './dom'
import { RIBBON_ICONS as I } from './icons'
import { closePopovers, popItem, popoverOpen } from './popover'
import { button, col, dropdown, split, type Group } from './ribbon'
import * as SH from './shapes'

export type InkTool = 'pen' | 'pencil' | 'highlighter' | 'eraser' | 'lasso'
type PenTool = 'pen' | 'pencil' | 'highlighter'
type Width = 'thin' | 'medium' | 'thick'

const PEN_TOOLS: PenTool[] = ['pen', 'pencil', 'highlighter']
const COLORS: Record<PenTool, string[]> = {
  pen: ['#1f2937', '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777'],
  pencil: ['#4b5563', '#1f2937', '#78350f', '#1e3a8a', '#7f1d1d', '#14532d'],
  highlighter: ['#facc15', '#4ade80', '#38bdf8', '#f472b6', '#fb923c', '#a78bfa'],
}
/** Épaisseurs (points) : préréglages Fin, Moyen, Épais, et bornes du curseur. */
const PRESETS: Record<PenTool, Record<Width, number>> = { pen: { thin: 1, medium: 2, thick: 4 }, pencil: { thin: 0.75, medium: 1.5, thick: 3 }, highlighter: { thin: 5, medium: 10, thick: 20 } }
const RANGE: Record<PenTool, [number, number, number]> = { pen: [0.5, 12, 0.25], pencil: [0.5, 8, 0.25], highlighter: [3, 30, 1] }
/** Rayon de la gomme partielle (points). */
const ERASE_R = 6

const state = {
  tool: null as InkTool | null,
  /** Le dernier stylo pris : les boutons d'épaisseur le règlent. */
  last: 'pen' as PenTool,
  color: { pen: COLORS.pen[0], pencil: COLORS.pencil[0], highlighter: COLORS.highlighter[0] } as Record<PenTool, string>,
  width: { pen: 2, pencil: 1.5, highlighter: 10 } as Record<PenTool, number>,
  eraser: 'stroke' as 'stroke' | 'point',
  /** Encre en forme : un trait reconnu devient une vraie forme. */
  toShape: false,
}
let layer: HTMLElement | null = null
let stopKey: ((e: KeyboardEvent) => void) | null = null
/** Les traits pris au lasso (paragraphe, rang du trait). */
let picked: { pos: number; i: number }[] = []

const PREFS = 'folio-pages:ink'
/** Réglages du dessin gardés dans ce navigateur (couleurs, épaisseurs, gomme, encre en forme). */
function loadPrefs(): void {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<typeof state>
    for (const k of PEN_TOOLS) {
      if (typeof p.color?.[k] === 'string' && /^#[0-9a-f]{6}$/i.test(p.color[k])) state.color[k] = p.color[k]
      const w = p.width?.[k]
      if (typeof w === 'number' && w >= RANGE[k][0] && w <= RANGE[k][1]) state.width[k] = w
    }
    if (p.eraser === 'point' || p.eraser === 'stroke') state.eraser = p.eraser
    if (typeof p.toShape === 'boolean') state.toShape = p.toShape
  } catch {
    /* stockage fermé : réglages par défaut */
  }
}
function savePrefs(): void {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ color: state.color, width: state.width, eraser: state.eraser, toShape: state.toShape }))
  } catch {
    /* stockage fermé : sans mémoire */
  }
}
loadPrefs()

export const drawTool = (): InkTool | null => state.tool
const isPen = (x: InkTool | null): x is PenTool => x === 'pen' || x === 'pencil' || x === 'highlighter'

/** Paragraphe (bloc de texte) sous un point de l'écran, ou le plus proche au-dessus. */
function blockAt(app: FolioApp, x: number, y: number): { pos: number; el: HTMLElement } | null {
  const view = app.view
  const hit = view.posAtCoords({ left: x, top: y })
  const tryPos = (p: number) => {
    const $p = view.state.doc.resolve(Math.min(p, view.state.doc.content.size))
    for (let d = $p.depth; d > 0; d--) {
      if ($p.node(d).isTextblock) {
        const pos = $p.before(d)
        const el = view.nodeDOM(pos) as HTMLElement | null
        if (el && el.nodeType === 1) return { pos, el }
      }
    }
    return null
  }
  if (hit) {
    const b = tryPos(hit.pos)
    if (b) return b
  }
  // Dans une marge : le dernier paragraphe qui commence au-dessus du point.
  let best: { pos: number; el: HTMLElement } | null = null
  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return !node.isAtom
    const el = view.nodeDOM(pos) as HTMLElement | null
    if (el?.nodeType === 1 && el.getBoundingClientRect().top <= y) best = { pos, el }
    return false
  })
  return best
}

/** Échelle d'affichage (zoom) d'un élément : px à l'écran par px CSS. */
const scaleOf = displayScale

/** Un paragraphe dessiné : son coin à l'écran et l'échelle écran par point. */
function blockFrame(app: FolioApp, pos: number): { left: number; top: number; k: number } | null {
  const el = app.view.nodeDOM(pos) as HTMLElement | null
  if (!el || el.nodeType !== 1) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, k: scaleOf(el) * PX_PER_PT }
}

/** La gomme : par trait entier, ou partielle (seulement là où elle passe). */
function eraseAt(app: FolioApp, x: number, y: number, first: boolean): void {
  if (state.eraser === 'point') {
    const changes = new Map<number, (ink: InkStroke[]) => InkStroke[]>()
    for (const b of inkedBlocks(app.state)) {
      const f = blockFrame(app, b.pos)
      if (!f) continue
      const [px, py] = [(x - f.left) / f.k, (y - f.top) / f.k]
      if (!b.ink.some((s) => distanceToStroke(s, px, py) <= ERASE_R + s.width / 2)) continue
      changes.set(b.pos, (ink) => ink.flatMap((s) => erasePoints(s, px, py, ERASE_R + s.width / 2) ?? [s]))
    }
    // Un passage de gomme : une seule étape d'annulation.
    if (changes.size) app.run(editInk(changes, !first), false)
    return
  }
  const hits = new Map<number, Set<number>>()
  for (const b of inkedBlocks(app.state)) {
    const f = blockFrame(app, b.pos)
    if (!f) continue
    const [px, py] = [(x - f.left) / f.k, (y - f.top) / f.k]
    b.ink.forEach((s, i) => {
      if (distanceToStroke(s, px, py) <= Math.max(6, s.width)) (hits.get(b.pos) ?? hits.set(b.pos, new Set()).get(b.pos)!).add(i)
    })
  }
  if (hits.size) app.run(removeStrokes(hits), false)
}

// --- encre en forme ----------------------------------------------------------------

/** Une forme reconnue (coordonnées : points depuis le coin `origin` à l'écran, `k` px par point) devient une vraie forme. */
function shapeData(app: FolioApp, found: InkShape, origin: { left: number; top: number; k: number }, stroke: InkStroke, z: number): { para: number; data: ReturnType<typeof loadShape> } | null {
  const at = placeFor(app.view, origin.left + found.x * origin.k, origin.top + found.y * origin.k)
  if (!at) return null
  const data = loadShape({
    shape: found.shape,
    id: freshShapeId(app.view.state.doc),
    x: at.x,
    y: at.y,
    width: found.width,
    height: found.height,
    ...(found.flip ? { flip: found.flip } : {}),
    ...(found.tail ? { tail: 'triangle' } : {}),
    fill: 'none',
    line: stroke.color,
    lineWidth: Math.max(0.25, Math.min(20, stroke.width)),
    wrap: 'front',
    z,
  })
  return data ? { para: at.para, data } : null
}

/** Insère des formes (paragraphe, données) d'un coup, avec d'éventuels traits retirés : une étape. */
function insertShapes(app: FolioApp, list: { para: number; data: NonNullable<ReturnType<typeof loadShape>> }[], drop?: Map<number, Set<number>>): void {
  const tr = app.view.state.tr
  if (drop)
    for (const [pos, idx] of drop) {
      const node = tr.doc.nodeAt(pos)
      if (!node) continue
      const ink = ((node.attrs.ink as InkStroke[] | null) ?? []).filter((_, i) => !idx.has(i))
      tr.setNodeMarkup(pos, null, { ...node.attrs, ink: ink.length ? ink : null })
    }
  // De la fin vers le début : les positions des paragraphes restent justes.
  for (const it of [...list].sort((a, b) => b.para - a.para)) tr.insert(it.para + 1, schema.nodes.shape.create({ data: it.data }))
  app.view.dispatch(closeHistory(tr))
}

// --- lasso ---------------------------------------------------------------------------

/** Les traits pris au lasso qui existent encore. */
function livePicked(app: FolioApp): { pos: number; i: number; s: InkStroke }[] {
  const out: { pos: number; i: number; s: InkStroke }[] = []
  for (const p of picked) {
    const s = (app.state.doc.nodeAt(p.pos)?.attrs.ink as InkStroke[] | null | undefined)?.[p.i]
    if (s) out.push({ ...p, s })
  }
  return out
}

/** Montre la sélection du lasso : les traits soulignés et leur cadre (calque, px CSS). */
function showPicked(app: FolioApp): DOMRect | null {
  layer?.querySelector('[data-ink-selection]')?.remove()
  const list = livePicked(app)
  if (list.length !== picked.length) picked = list.map(({ pos, i }) => ({ pos, i }))
  if (!layer || !list.length) return null
  const lr = layer.getBoundingClientRect()
  const sc = scaleOf(layer) || 1
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'fp-ink-sel__strokes')
  for (const { pos, s } of list) {
    const f = blockFrame(app, pos)
    if (!f) continue
    const ox = (f.left - lr.left) / sc
    const oy = (f.top - lr.top) / sc
    const pts = s.points.map((v, i) => (i % 2 ? oy : ox) + v * PX_PER_PT)
    for (let i = 0; i < pts.length; i += 2) {
      const r = (s.width * PX_PER_PT) / 2
      box.x0 = Math.min(box.x0, pts[i] - r)
      box.x1 = Math.max(box.x1, pts[i] + r)
      box.y0 = Math.min(box.y0, pts[i + 1] - r)
      box.y1 = Math.max(box.y1, pts[i + 1] + r)
    }
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', inkPath({ ...s, points: pts }))
    path.setAttribute('stroke-width', String(s.width * PX_PER_PT + 5))
    svg.append(path)
  }
  const frame = h('div', { class: 'fp-ink-sel__box', style: `left:${box.x0 - 4}px;top:${box.y0 - 4}px;width:${box.x1 - box.x0 + 8}px;height:${box.y1 - box.y0 + 8}px` })
  layer.append(h('div', { class: 'fp-ink-sel', 'data-ink-selection': String(list.length) }, svg, frame))
  return frame.getBoundingClientRect()
}

function clearPicked(app: FolioApp): void {
  picked = []
  layer?.querySelector('[data-ink-selection]')?.remove()
  app.notifyUi()
}

/** Supprime les traits pris au lasso. */
function deletePicked(app: FolioApp): void {
  const list = livePicked(app)
  if (!list.length) return
  const hits = new Map<number, Set<number>>()
  for (const p of list) (hits.get(p.pos) ?? hits.set(p.pos, new Set()).get(p.pos)!).add(p.i)
  app.run(removeStrokes(hits), false)
  clearPicked(app)
}

/** Les traits pris au lasso qui ressemblent à une forme deviennent de vraies formes. */
function convertPicked(app: FolioApp): void {
  const list = livePicked(app)
  const shapes: { para: number; data: NonNullable<ReturnType<typeof loadShape>> }[] = []
  const drop = new Map<number, Set<number>>()
  let z = SH.nextZ(app)
  for (const p of list) {
    const found = recognizeShape(p.s.points)
    const f = found && blockFrame(app, p.pos)
    const got = found && f && shapeData(app, found, f, p.s, z++)
    if (!got?.data) continue
    shapes.push(got as { para: number; data: NonNullable<ReturnType<typeof loadShape>> })
    ;(drop.get(p.pos) ?? drop.set(p.pos, new Set()).get(p.pos)!).add(p.i)
  }
  if (!shapes.length) return void toast(t('draw.noShape'), { kind: 'info' })
  insertShapes(app, shapes, drop)
  clearPicked(app)
  toast(t('draw.converted', { n: shapes.length }), { kind: 'success' })
}

/** Déplace les traits pris au lasso (points). */
function movePicked(app: FolioApp, dx: number, dy: number): void {
  const by = new Map<number, Set<number>>()
  for (const p of livePicked(app)) (by.get(p.pos) ?? by.set(p.pos, new Set()).get(p.pos)!).add(p.i)
  const r1 = (v: number) => Math.round(v * 10) / 10
  const changes = new Map<number, (ink: InkStroke[]) => InkStroke[]>()
  for (const [pos, idx] of by) changes.set(pos, (ink) => ink.map((s, i) => (idx.has(i) ? { ...s, points: s.points.map((v, j) => r1(v + (j % 2 ? dy : dx))) } : s)))
  app.run(editInk(changes), false)
}

// --- le calque de dessin -------------------------------------------------------------

function startLayer(app: FolioApp): void {
  if (layer) return
  const page = document.querySelector<HTMLElement>('#fp-page') ?? app.view.dom
  layer = h('div', { class: 'fp-ink-layer', 'data-ink-layer': '', 'aria-hidden': 'true' })
  page.append(layer)
  type Live = { points: number[]; start: { x: number; y: number }; svg: SVGSVGElement | null; pointer: number; mode: 'draw' | 'erase' | 'lasso' | 'move'; last?: { x: number; y: number } }
  let live: Live | null = null
  const toLocal = (e: PointerEvent) => {
    const r = layer!.getBoundingClientRect()
    const k = scaleOf(layer!) * PX_PER_PT
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]
  }
  const pen = (): PenTool => (isPen(state.tool) ? state.tool : 'pen')
  const stroke = (points: number[]): InkStroke => ({ tool: pen(), color: state.color[pen()], width: state.width[pen()], points })
  layer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !state.tool) return
    e.preventDefault()
    layer!.setPointerCapture(e.pointerId)
    const start = { x: e.clientX, y: e.clientY }
    if (state.tool === 'eraser') {
      eraseAt(app, e.clientX, e.clientY, true)
      live = { points: [], start, svg: null, pointer: e.pointerId, mode: 'erase' }
      return
    }
    if (state.tool === 'lasso') {
      // Dans le cadre de la sélection : on la déplace ; ailleurs, une nouvelle boucle.
      const sel = layer!.querySelector('.fp-ink-sel__box')?.getBoundingClientRect()
      if (sel && e.clientX >= sel.left && e.clientX <= sel.right && e.clientY >= sel.top && e.clientY <= sel.bottom) {
        live = { points: [], start, svg: null, pointer: e.pointerId, mode: 'move' }
        return
      }
      clearPicked(app)
      live = { points: [e.clientX, e.clientY], start, svg: null, pointer: e.pointerId, mode: 'lasso' }
      return
    }
    live = { points: toLocal(e), start, svg: null, pointer: e.pointerId, mode: 'draw' }
  })
  layer.addEventListener('pointermove', (e) => {
    if (!state.tool || !layer) return
    if (state.tool === 'lasso' && !live) {
      const sel = layer.querySelector('.fp-ink-sel__box')?.getBoundingClientRect()
      layer.classList.toggle('is-over-selection', !!sel && e.clientX >= sel.left && e.clientX <= sel.right && e.clientY >= sel.top && e.clientY <= sel.bottom)
    }
    if (!live || e.pointerId !== live.pointer) return
    if (live.mode === 'erase') return eraseAt(app, e.clientX, e.clientY, false)
    const sc = scaleOf(layer) || 1
    if (live.mode === 'move') {
      const sel = layer.querySelector<HTMLElement>('[data-ink-selection]')
      if (sel) sel.style.transform = `translate(${(e.clientX - live.start.x) / sc}px,${(e.clientY - live.start.y) / sc}px)`
      live.last = { x: e.clientX, y: e.clientY }
      return
    }
    if (live.mode === 'lasso') {
      live.points.push(e.clientX, e.clientY)
      const lr = layer.getBoundingClientRect()
      live.svg?.remove()
      live.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      live.svg.setAttribute('class', 'fp-ink-lasso')
      const pts = live.points.map((v, i) => (v - (i % 2 ? lr.top : lr.left)) / sc)
      live.svg.innerHTML = `<path d="${inkPath({ tool: 'pen', color: '', width: 1, points: pts })}Z"/>`
      layer.append(live.svg)
      return
    }
    const [x, y] = toLocal(e)
    const p = live.points
    // Maj : un trait droit depuis le point de départ.
    if (e.shiftKey) live.points = [p[0], p[1], x, y]
    else {
      if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < 0.6) return
      p.push(x, y)
    }
    // Aperçu du trait en cours, sur le calque.
    live.svg?.remove()
    live.svg = inkElement([stroke(live.points)])
    layer.append(live.svg)
  })
  const finish = (e: PointerEvent) => {
    if (!live || e.pointerId !== live.pointer || !layer) return
    const done = live
    live = null
    done.svg?.remove()
    if (done.mode === 'erase') return
    if (done.mode === 'move') {
      const k = (scaleOf(layer) || 1) * PX_PER_PT
      const end = done.last ?? done.start
      if (Math.hypot(end.x - done.start.x, end.y - done.start.y) > 1) movePicked(app, (end.x - done.start.x) / k, (end.y - done.start.y) / k)
      showPicked(app)
      return
    }
    if (done.mode === 'lasso') {
      const poly = done.points
      if (poly.length < 6) return
      picked = []
      for (const b of inkedBlocks(app.state)) {
        const f = blockFrame(app, b.pos)
        if (!f) continue
        b.ink.forEach((s, i) => {
          if (lassoed(poly, s.points.map((v, j) => v * f.k + (j % 2 ? f.top : f.left)))) picked.push({ pos: b.pos, i })
        })
      }
      showPicked(app)
      app.notifyUi()
      return
    }
    if (!done.points.length) return
    const target = blockAt(app, done.start.x, done.start.y)
    if (!target) return
    // Encre en forme : un trait reconnu devient une vraie forme (pas au surligneur).
    if (state.toShape && pen() !== 'highlighter') {
      const found = recognizeShape(done.points)
      if (found) {
        const lr = layer.getBoundingClientRect()
        const got = shapeData(app, found, { left: lr.left, top: lr.top, k: scaleOf(layer) * PX_PER_PT }, stroke(done.points), SH.nextZ(app))
        if (got?.data) return insertShapes(app, [got as { para: number; data: NonNullable<ReturnType<typeof loadShape>> }])
      }
    }
    // Du repère du calque à celui du paragraphe (en points).
    const lr = layer.getBoundingClientRect()
    const br = target.el.getBoundingClientRect()
    const k = scaleOf(layer) * PX_PER_PT
    const dx = (br.left - lr.left) / k
    const dy = (br.top - lr.top) / k
    const pts = simplify(done.points.map((v, i) => (i % 2 ? v - dy : v - dx)))
    app.run(addStroke(target.pos, stroke(pts.map((v) => Math.round(v * 10) / 10))), false)
  }
  layer.addEventListener('pointerup', finish)
  layer.addEventListener('pointercancel', finish)
  stopKey = (e) => {
    // Une liste ouverte (couleurs, épaisseur) : Échap la ferme, et c'est tout.
    if (popoverOpen()) return
    if (e.key === 'Escape') {
      if (picked.length) return clearPicked(app)
      return setTool(app, null)
    }
    if (state.tool === 'lasso' && picked.length && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault()
      e.stopPropagation()
      return deletePicked(app)
    }
    // Annuler, rétablir : la sélection du lasso ne vaut plus.
    if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key) && picked.length) clearPicked(app)
  }
  document.addEventListener('keydown', stopKey, true)
}

export function setTool(app: FolioApp, tool: InkTool | null): void {
  if (tool && app.reading) return void toast(t('draw.readOnly'), { kind: 'info' })
  if (tool !== 'lasso') {
    picked = []
    layer?.querySelector('[data-ink-selection]')?.remove()
  }
  state.tool = tool
  if (isPen(tool)) state.last = tool
  document.documentElement.classList.toggle('fp-drawing', !!tool)
  document.documentElement.dataset.inkTool = tool ?? ''
  if (tool) startLayer(app)
  else {
    layer?.remove()
    layer = null
    if (stopKey) document.removeEventListener('keydown', stopKey, true)
    stopKey = null
    app.focus()
  }
  app.notifyUi()
}

// --- rejouer -------------------------------------------------------------------------

let replaying: (() => void) | null = null

/** Rejoue le dessin trait après trait, dans l'ordre du document (un clic ou Échap arrête). */
export function replayInk(app: FolioApp): void {
  replaying?.()
  const blocks = inkedBlocks(app.state)
  if (!blocks.length) return void toast(t('draw.none'), { kind: 'info' })
  const page = document.querySelector<HTMLElement>('#fp-page') ?? (app.view.dom as HTMLElement)
  const over = h('div', { class: 'fp-ink-replay', 'data-ink-replay': '' })
  page.append(over)
  const lr = over.getBoundingClientRect()
  const sc = scaleOf(over) || 1
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  over.append(svg)
  const paths: { el: SVGPathElement; len: number }[] = []
  for (const b of blocks) {
    const f = blockFrame(app, b.pos)
    if (!f) continue
    const ox = (f.left - lr.left) / sc
    const oy = (f.top - lr.top) / sc
    for (const s of b.ink) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      el.setAttribute('d', inkPath({ ...s, points: s.points.map((v, i) => (i % 2 ? oy : ox) + v * PX_PER_PT) }))
      el.setAttribute('fill', 'none')
      el.setAttribute('stroke', cssColor(s.color))
      el.setAttribute('stroke-width', String(s.width * PX_PER_PT))
      el.setAttribute('stroke-linecap', s.tool === 'highlighter' ? 'square' : 'round')
      el.setAttribute('stroke-linejoin', 'round')
      if (inkOpacity(s) < 1) el.setAttribute('stroke-opacity', String(inkOpacity(s)))
      svg.append(el)
      const len = Math.max(1, el.getTotalLength?.() ?? 1)
      el.style.strokeDasharray = `${len}`
      el.style.strokeDashoffset = `${len}`
      paths.push({ el, len })
    }
  }
  document.documentElement.classList.add('fp-ink-replaying')
  // Vitesse d'une main qui dessine, le tout en huit secondes au plus.
  const total = paths.reduce((a, p) => a + p.len, 0)
  const speed = Math.max(0.6, total / 8000)
  let at = 0
  const anims = paths.map((p) => {
    const duration = Math.max(60, p.len / speed)
    const a = p.el.animate([{ strokeDashoffset: p.len }, { strokeDashoffset: 0 }], { duration, delay: at, fill: 'forwards', easing: 'linear' })
    at += duration + 80
    return a
  })
  const stop = () => {
    if (replaying !== stop) return
    replaying = null
    clearTimeout(timer)
    anims.forEach((a) => a.cancel())
    over.remove()
    document.documentElement.classList.remove('fp-ink-replaying')
    document.removeEventListener('keydown', key, true)
  }
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    stop()
  }
  over.addEventListener('pointerdown', stop)
  document.addEventListener('keydown', key, true)
  const timer = setTimeout(stop, at + 700)
  replaying = stop
}

// --- le ruban ------------------------------------------------------------------------

/** Couleurs et épaisseur d'un stylo (le menu de sa flèche). */
function penMenu(app: FolioApp, tool: PenTool, label: string): HTMLElement {
  const pick = (c: string) => {
    state.color[tool] = c
    savePrefs()
    setTool(app, tool)
  }
  const swatch = (c: string) => {
    const b = h('button', { type: 'button', class: 'fp-palette__swatch', style: `background:${c}`, title: `${label} ${c}`, 'aria-label': `${label} ${c}`, 'data-ink-color': c, 'data-pop-item': '', 'aria-pressed': String(state.color[tool] === c) })
    b.addEventListener('click', () => {
      closePopovers()
      pick(c)
    })
    return b
  }
  const custom = h('input', { type: 'color', class: 'fp-ink-menu__custom', value: state.color[tool], 'data-ink-custom': tool, 'aria-label': t('draw.moreColors') }) as HTMLInputElement
  custom.addEventListener('change', () => pick(custom.value))
  const [min, max, step] = RANGE[tool]
  const range = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(state.width[tool]), 'data-ink-width': tool, 'aria-label': t('draw.widthLabel') }) as HTMLInputElement
  const value = h('span', { class: 'fp-ink-menu__value' }, `${state.width[tool]} pt`)
  range.addEventListener('input', () => {
    state.width[tool] = Number(range.value)
    value.textContent = `${range.value} pt`
    savePrefs()
    if (state.tool !== tool) setTool(app, tool)
    else app.notifyUi()
  })
  return h(
    'div',
    { class: 'fp-ink-menu' },
    h('div', { class: 'fp-palette' }, h('div', { class: 'fp-palette__row' }, ...COLORS[tool].map(swatch))),
    h('label', { class: 'fp-ink-menu__row' }, custom, h('span', {}, t('draw.moreColors'))),
    h('div', { class: 'fp-ink-menu__row' }, h('span', {}, t('draw.widthLabel')), range, value),
  )
}

export function drawGroups(app: FolioApp): Group[] {
  const penBtn = (id: PenTool, label: Key, icon: string) =>
    split({
      id: `ink-${id}`,
      label: t(label),
      icon,
      large: true,
      active: () => state.tool === id,
      run: () => setTool(app, state.tool === id ? null : id),
      indicator: () => state.color[id],
      menu: () => penMenu(app, id, t(label)),
    })
  const eraser = split({
    id: 'ink-eraser',
    label: t('draw.eraser'),
    icon: I.erase,
    large: true,
    active: () => state.tool === 'eraser',
    run: () => setTool(app, state.tool === 'eraser' ? null : 'eraser'),
    menu: () =>
      h(
        'div',
        { class: 'fp-pop__list', role: 'menu' },
        ...(['stroke', 'point'] as const).map((m) =>
          popItem(t(m === 'stroke' ? 'draw.eraseStroke' : 'draw.erasePoint'), () => {
            state.eraser = m
            savePrefs()
            setTool(app, 'eraser')
          }, { 'data-eraser': m, role: 'menuitemradio', 'aria-checked': String(state.eraser === m) }),
        ),
      ),
  })
  const hasPicked = () => state.tool === 'lasso' && picked.length > 0
  return [
    {
      id: 'ink-tools',
      label: t('draw.tools'),
      controls: [
        button({ id: 'ink-select', label: t('draw.select'), icon: I.select, large: true, active: () => !state.tool, run: () => setTool(app, null) }),
        button({ id: 'ink-lasso', label: t('draw.lasso'), icon: I.lasso, large: true, active: () => state.tool === 'lasso', run: () => setTool(app, state.tool === 'lasso' ? null : 'lasso') }),
        penBtn('pen', 'draw.pen', I.pen),
        penBtn('pencil', 'draw.pencil', I.inkPencil),
        penBtn('highlighter', 'draw.highlighter', I.highlight),
        eraser,
      ],
    },
    {
      id: 'ink-options',
      label: t('draw.options'),
      controls: [
        col(
          ...(['thin', 'medium', 'thick'] as const).map((w) =>
            button({
              id: `ink-width-${w}`,
              label: t(`draw.width.${w}`),
              icon: I[`inkWidth${w[0].toUpperCase()}${w.slice(1)}` as 'inkWidthThin'],
              text: true,
              active: () => state.width[state.last] === PRESETS[state.last][w],
              run: () => {
                state.width[state.last] = PRESETS[state.last][w]
                savePrefs()
                app.notifyUi()
              },
            }),
          ),
        ),
        col(
          button({ id: 'ink-delete-selection', label: t('draw.deleteSelection'), icon: I.close, text: true, enabled: hasPicked, run: () => deletePicked(app) }),
          button({ id: 'ink-clear', label: t('draw.clear'), icon: I.delete, text: true, run: () => {
            if (!app.run(clearInk)) toast(t('draw.none'), { kind: 'info' })
          } }),
        ),
      ],
    },
    {
      id: 'ink-convert',
      label: t('draw.convertGroup'),
      controls: [
        button({ id: 'ink-to-shape', label: t('draw.toShape'), icon: I.inkToShape, large: true, active: () => state.toShape, run: () => {
          state.toShape = !state.toShape
          savePrefs()
          if (state.toShape) {
            toast(t('draw.toShapeOn'), { kind: 'info', timeout: 6000 })
            if (!isPen(state.tool) || state.tool === 'highlighter') setTool(app, state.last === 'highlighter' ? 'pen' : state.last)
          }
          app.notifyUi()
        } }),
        col(button({ id: 'ink-convert-selection', label: t('draw.convertSelection'), icon: I.shapes, text: true, enabled: hasPicked, run: () => convertPicked(app) })),
      ],
    },
    {
      id: 'ink-insert',
      label: t('draw.insertGroup'),
      controls: [
        dropdown({ id: 'ink-shapes', label: t('rb.shapes'), icon: I.shapes, large: true, menu: () => SH.shapesGallery(app, (e) => {
          setTool(app, null)
          SH.startDrawing(app, e)
        }) }),
        col(
          dropdown({ id: 'ink-textbox', label: t('rb.textBox'), icon: I.textBox, text: () => t('rb.textBox'), menu: () => {
            if (state.tool) setTool(app, null)
            return SH.textBoxMenu(app)
          } }),
          button({ id: 'ink-picture', label: t('pic.free'), icon: I.image, text: true, run: () => {
            setTool(app, null)
            void SH.insertFreePicture(app)
          } }),
        ),
      ],
    },
    {
      id: 'ink-replay',
      label: t('draw.replayGroup'),
      controls: [button({ id: 'ink-replay', label: t('draw.replay'), icon: I.replay, large: true, run: () => replayInk(app) })],
    },
  ]
}
