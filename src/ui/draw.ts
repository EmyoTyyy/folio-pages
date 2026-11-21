// Onglet Dessin : stylo, surligneur et gomme sur la page (souris, stylet ou
// doigt). Un trait est rattaché au paragraphe où il commence, en points depuis
// son coin haut gauche : il suit le texte quand celui-ci bouge.

import type { FolioApp } from '../app'
import { displayScale } from '../layout/scale'
import { addStroke, clearInk, inkedBlocks, inkElement, removeStrokes } from '../editor/ink'
import { distanceToStroke, PX_PER_PT, simplify } from '../format/ink'
import type { InkStroke } from '../format/types'
import type { Key } from '../i18n/dict'
import { t } from '../i18n/i18n'
import { toast } from './dialog'
import { h } from './dom'
import { RIBBON_ICONS as I } from './icons'
import { button, col, split, type Group } from './ribbon'

export type InkTool = 'pen' | 'highlighter' | 'eraser'

const PEN_COLORS = ['#1f2937', '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c']
const HL_COLORS = ['#facc15', '#4ade80', '#38bdf8', '#f472b6', '#fb923c']
const WIDTHS: Record<'thin' | 'medium' | 'thick', number> = { thin: 1, medium: 2, thick: 4 }

const state = { tool: null as InkTool | null, pen: PEN_COLORS[0], hl: HL_COLORS[0], width: 'medium' as keyof typeof WIDTHS }
let layer: HTMLElement | null = null
let stopKey: ((e: KeyboardEvent) => void) | null = null

export const drawTool = (): InkTool | null => state.tool

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

function eraseAt(app: FolioApp, x: number, y: number): void {
  const hits = new Map<number, Set<number>>()
  for (const b of inkedBlocks(app.state)) {
    const el = app.view.nodeDOM(b.pos) as HTMLElement | null
    if (!el || el.nodeType !== 1) continue
    const r = el.getBoundingClientRect()
    const k = scaleOf(el) * PX_PER_PT
    const px = (x - r.left) / k
    const py = (y - r.top) / k
    b.ink.forEach((s, i) => {
      if (distanceToStroke(s, px, py) <= Math.max(6, s.width)) (hits.get(b.pos) ?? hits.set(b.pos, new Set()).get(b.pos)!).add(i)
    })
  }
  if (hits.size) app.run(removeStrokes(hits), false)
}

function startLayer(app: FolioApp): void {
  if (layer) return
  const page = document.querySelector<HTMLElement>('#fp-page') ?? app.view.dom
  layer = h('div', { class: 'fp-ink-layer', 'data-ink-layer': '', 'aria-hidden': 'true' })
  page.append(layer)
  let live: { points: number[]; start: { x: number; y: number }; svg: SVGSVGElement | null; pointer: number } | null = null
  const toLocal = (e: PointerEvent) => {
    const r = layer!.getBoundingClientRect()
    const k = scaleOf(layer!) * PX_PER_PT
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]
  }
  const stroke = (points: number[]): InkStroke => ({ tool: state.tool === 'highlighter' ? 'highlighter' : 'pen', color: state.tool === 'highlighter' ? state.hl : state.pen, width: state.tool === 'highlighter' ? WIDTHS[state.width] * 5 : WIDTHS[state.width], points })
  layer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !state.tool) return
    e.preventDefault()
    layer!.setPointerCapture(e.pointerId)
    if (state.tool === 'eraser') {
      eraseAt(app, e.clientX, e.clientY)
      live = { points: [], start: { x: e.clientX, y: e.clientY }, svg: null, pointer: e.pointerId }
      return
    }
    live = { points: toLocal(e), start: { x: e.clientX, y: e.clientY }, svg: null, pointer: e.pointerId }
  })
  layer.addEventListener('pointermove', (e) => {
    if (!live || e.pointerId !== live.pointer) return
    if (state.tool === 'eraser') return eraseAt(app, e.clientX, e.clientY)
    const [x, y] = toLocal(e)
    const p = live.points
    if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < 0.6) return
    p.push(x, y)
    // Aperçu du trait en cours, sur le calque.
    live.svg?.remove()
    live.svg = inkElement([stroke(p)])
    layer!.append(live.svg)
  })
  const finish = (e: PointerEvent) => {
    if (!live || e.pointerId !== live.pointer) return
    const done = live
    live = null
    done.svg?.remove()
    if (state.tool === 'eraser' || !done.points.length) return
    const target = blockAt(app, done.start.x, done.start.y)
    if (!target) return
    // Du repère du calque à celui du paragraphe (en points).
    const lr = layer!.getBoundingClientRect()
    const br = target.el.getBoundingClientRect()
    const k = scaleOf(layer!) * PX_PER_PT
    const dx = (br.left - lr.left) / k
    const dy = (br.top - lr.top) / k
    const pts = simplify(done.points.map((v, i) => (i % 2 ? v - dy : v - dx)))
    app.run(addStroke(target.pos, stroke(pts.map((v) => Math.round(v * 10) / 10))), false)
  }
  layer.addEventListener('pointerup', finish)
  layer.addEventListener('pointercancel', finish)
  stopKey = (e) => {
    if (e.key === 'Escape') setTool(app, null)
  }
  document.addEventListener('keydown', stopKey)
}

export function setTool(app: FolioApp, tool: InkTool | null): void {
  if (tool && app.reading) return void toast(t('draw.readOnly'), { kind: 'info' })
  state.tool = tool
  document.documentElement.classList.toggle('fp-drawing', !!tool)
  document.documentElement.dataset.inkTool = tool ?? ''
  if (tool) startLayer(app)
  else {
    layer?.remove()
    layer = null
    if (stopKey) document.removeEventListener('keydown', stopKey)
    stopKey = null
    app.focus()
  }
  app.notifyUi()
}

function swatches(colors: string[], current: () => string, pick: (c: string) => void, label: string): HTMLElement {
  return h(
    'div',
    { class: 'fp-palette' },
    h(
      'div',
      { class: 'fp-palette__row' },
      ...colors.map((c) => {
        const b = h('button', { type: 'button', class: 'fp-palette__swatch', style: `background:${c}`, title: `${label} ${c}`, 'aria-label': `${label} ${c}`, 'data-ink-color': c, 'data-pop-item': '', 'aria-pressed': String(current() === c) })
        b.addEventListener('click', () => pick(c))
        return b
      }),
    ),
  )
}

export function drawGroups(app: FolioApp): Group[] {
  const tool = (id: InkTool, label: Key, icon: string, colors: string[] | null) => {
    const opts = { id: `ink-${id}`, label: t(label), icon, large: true, active: () => state.tool === id, run: () => setTool(app, state.tool === id ? null : id) }
    if (!colors) return button(opts)
    return split({
      ...opts,
      indicator: () => (id === 'pen' ? state.pen : state.hl),
      menu: () =>
        swatches(colors, () => (id === 'pen' ? state.pen : state.hl), (c) => {
          if (id === 'pen') state.pen = c
          else state.hl = c
          setTool(app, id)
        }, t(label)),
    })
  }
  return [
    {
      id: 'ink-tools',
      label: t('draw.tools'),
      controls: [
        button({ id: 'ink-select', label: t('draw.select'), icon: I.select, large: true, active: () => !state.tool, run: () => setTool(app, null) }),
        tool('pen', 'draw.pen', I.pen, PEN_COLORS),
        tool('highlighter', 'draw.highlighter', I.highlight, HL_COLORS),
        tool('eraser', 'draw.eraser', I.erase, null),
      ],
    },
    {
      id: 'ink-options',
      label: t('draw.options'),
      controls: [
        col(
          ...(['thin', 'medium', 'thick'] as const).map((w) =>
            button({ id: `ink-width-${w}`, label: t(`draw.width.${w}`), icon: I[`inkWidth${w[0].toUpperCase()}${w.slice(1)}` as 'inkWidthThin'], text: true, active: () => state.width === w, run: () => {
              state.width = w
              app.notifyUi()
            } }),
          ),
        ),
        col(
          button({ id: 'ink-clear', label: t('draw.clear'), icon: I.delete, text: true, run: () => {
            if (!app.run(clearInk)) toast(t('draw.none'), { kind: 'info' })
          } }),
        ),
      ],
    },
  ]
}

