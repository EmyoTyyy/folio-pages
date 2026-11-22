// Formes et zones de texte dans l'interface : Insertion → Formes (galerie, puis
// dessin à la souris sur la page), Insertion → Zone de texte, l'onglet Format
// de la forme, l'écriture dans une forme, le volet Sélection.

import { NodeSelection } from 'prosemirror-state'
import type { FolioApp } from '../app'
import {
  allShapes,
  alignShapes,
  figureToPicture,
  freshShapeId,
  groupShapes,
  holdsText,
  insertShapeAt,
  moveShapes,
  pictureToFigure,
  placeFor,
  positionShape,
  POSITIONS,
  PX,
  restack,
  rotateShapes,
  selectedShapes,
  setWrap,
  shapesKey,
  shapeView,
  stackRanks,
  ungroupShape,
  updateShapes,
  type AlignHow,
  type PositionPreset,
  type ShapeRef,
  type StackMove,
} from '../editor/shapes'
import { loadShape } from '../format/load'
import { shapeSvg } from '../format/shapedraw'
import { SHAPE_CATEGORIES, SHAPES, isLineKind, shapeDefaults, shapeGeom } from '../format/shapes'
import { LINE_DASHES, LINE_ENDS, SHAPE_WRAPS, type ShapeInline, type Theme } from '../format/types'
import type { Key } from '../i18n/dict'
import { t } from '../i18n/i18n'
import { HeaderFooterEditor } from '../layout/hfeditor'
import { openDialog, toast } from './dialog'
import { h, icon } from './dom'
import { ICONS, RIBBON_ICONS as I } from './icons'
import { colorPalette } from './palette'
import { closePopovers, popItem } from './popover'
import { button, col, dropdown, split, type Ctl, type Group } from './ribbon'
import { editorPaint } from '../editor/shapes'
import { prepareFile } from '../editor/images'
import { figureAt } from '../editor/tables'
import { settings } from '../settings'
import { pickFile } from './panels'
import * as PFX from './picturefx'

const name = (id: string) => t(`shape.k.${id}` as Key)

// --- écrire dans une forme ----------------------------------------------------------------

/** Un petit éditeur dans la zone du texte de la forme ; à la fermeture, une seule étape annulable. */
export function editShapeText(app: FolioApp, pos: number, host: HTMLElement, first?: string): void {
  const node = app.view.state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'shape') return
  const id = (node.attrs.data as ShapeInline).id
  const find = () => allShapes(app.view.state.doc).find((s) => s.data.id === id)
  let onDown: (e: PointerEvent) => void = () => undefined
  const ed = new HeaderFooterEditor(
    app,
    'note',
    'default',
    {
      read: () => find()?.data.blocks ?? [],
      write: (blocks) => {
        const r = find()
        if (!r) return
        const next: ShapeInline = { ...r.data }
        const empty = !blocks.length || (blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].content.length)
        if (empty) delete next.blocks
        else next.blocks = blocks
        app.view.dispatch(app.view.state.tr.setNodeMarkup(r.pos, null, { data: next }))
      },
      label: '',
      ariaLabel: t('shape.textLabel'),
      onEscape: () => {
        const r = find()
        if (!r) return
        app.view.dispatch(app.view.state.tr.setSelection(NodeSelection.create(app.view.state.doc, r.pos)).setMeta(shapesKey, { multi: [], grabbed: id }))
        app.view.focus()
      },
    },
    host,
    () => {
      document.removeEventListener('pointerdown', onDown, true)
      shapeView(id)?.stopEditing()
    },
  )
  // Un clic hors de la forme referme l'éditeur (comme un en-tête).
  onDown = (e: PointerEvent) => {
    const target = e.target as Element
    if (host.contains(target) || target.closest('.fp-ribbon, .fp-popover, .fp-dialog, [data-context-menu], .fp-ctx')) return
    ed.close()
  }
  document.addEventListener('pointerdown', onDown, true)
  if (first) ed.view.dispatch(ed.view.state.tr.insertText(first))
}

// --- dessiner une nouvelle forme ------------------------------------------------------------

/** Les entrées de la galerie : une forme et ses réglages (un trait fléché, par exemple). */
interface Entry {
  key: string
  kind: string
  preset?: Partial<ShapeInline>
}
const ENTRIES: Entry[] = [
  { key: 'line', kind: 'line' },
  { key: 'lineArrow', kind: 'line', preset: { tail: 'triangle' } },
  { key: 'lineArrow2', kind: 'line', preset: { head: 'triangle', tail: 'triangle' } },
  { key: 'bentConnector3', kind: 'bentConnector3' },
  { key: 'bentConnector3Arrow', kind: 'bentConnector3', preset: { tail: 'triangle' } },
  { key: 'curvedConnector3', kind: 'curvedConnector3' },
  { key: 'curvedConnector3Arrow', kind: 'curvedConnector3', preset: { tail: 'triangle' } },
  { key: 'textBox', kind: 'textBox' },
  ...SHAPES.filter((s) => s.cat !== 'lines').map((s) => ({ key: s.id, kind: s.id })),
]
const catOf = (e: Entry) => (e.kind === 'textBox' ? 'basic' : (SHAPES.find((s) => s.id === e.kind)?.cat ?? 'basic'))

const RECENT_KEY = 'folio-pages:recent-shapes'
function recent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && ENTRIES.some((e) => e.key === x)).slice(0, 12) : []
  } catch {
    return []
  }
}
function remember(key: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...recent().filter((k) => k !== key)].slice(0, 12)))
  } catch {
    /* stockage fermé : sans mémoire */
  }
}

let drawing: { cancel: () => void } | null = null

/** Dessiner une forme : un clic (taille par défaut) ou un glissé sur la page ; Échap annule. */
export function startDrawing(app: FolioApp, entry: Entry): void {
  drawing?.cancel()
  if (app.reading) return
  remember(entry.key)
  document.body.classList.add('fp-drawing-shape')
  const done = toast(t('shape.draw', { name: name(entry.key) }), { kind: 'info', timeout: 8000 })
  let start: { x: number; y: number } | null = null
  let ghost: HTMLElement | null = null
  const line = isLineKind(entry.kind)
  const rectOf = (e: PointerEvent) => {
    let [x1, y1] = [e.clientX, e.clientY]
    if (e.shiftKey && start) {
      const dx = x1 - start.x
      const dy = y1 - start.y
      if (line) {
        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
        const len = Math.hypot(dx, dy)
        x1 = start.x + Math.cos(a) * len
        y1 = start.y + Math.sin(a) * len
      } else {
        const s = Math.max(Math.abs(dx), Math.abs(dy))
        x1 = start.x + Math.sign(dx || 1) * s
        y1 = start.y + Math.sign(dy || 1) * s
      }
    }
    return { x0: start!.x, y0: start!.y, x1, y1 }
  }
  const finish = () => {
    window.removeEventListener('pointerdown', down, true)
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('keydown', key, true)
    document.body.classList.remove('fp-drawing-shape')
    ghost?.remove()
    done()
    drawing = null
  }
  const down = (e: PointerEvent) => {
    const target = e.target as Element
    if (!target.closest('.fp-canvas, .fp-page')) {
      if (!target.closest('.fp-ribbon, .fp-popover')) finish()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    start = { x: e.clientX, y: e.clientY }
    ghost = h('div', { class: 'fp-draw-ghost' })
    document.body.append(ghost)
  }
  // L'aperçu : la vraie forme, à sa taille finale, avec les couleurs du thème (hors de la page,
  // les variables de couleur du document n'existent pas).
  const theme = editorPaint(app.theme as Theme)
  const paint = { color: (x: string) => theme.hex?.(x) ?? x, hex: theme.hex }
  const move = (e: PointerEvent) => {
    if (!start || !ghost) return
    const r = rectOf(e)
    const dom = app.view.dom as HTMLElement
    const scale = dom.getBoundingClientRect().width / (dom.offsetWidth || 1) || 1
    const [w, hh] = [Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0)]
    Object.assign(ghost.style, { left: `${Math.min(r.x0, r.x1)}px`, top: `${Math.min(r.y0, r.y1)}px`, width: `${w}px`, height: `${hh}px` })
    const flip = line ? `${r.x1 < r.x0 ? 'h' : ''}${r.y1 < r.y0 ? 'v' : ''}` : ''
    const sample = { ...shapeDefaults(entry.kind), ...entry.preset, type: 'shape', shape: entry.kind, id: 'ghost', x: 0, y: 0, width: w / scale / PX, height: hh / scale / PX, ...(flip ? { flip } : {}) } as ShapeInline
    ghost.innerHTML = shapeSvg(sample, paint, ` class="fp-draw-ghost__svg" style="transform:scale(${scale})"`)
  }
  const up = (e: PointerEvent) => {
    if (!start) return
    e.preventDefault()
    const r = rectOf(e)
    finish()
    const view = app.view
    const scale = (view.dom as HTMLElement).getBoundingClientRect().width / ((view.dom as HTMLElement).offsetWidth || 1) || 1
    const d = shapeDefaults(entry.kind)
    const tiny = Math.hypot(r.x1 - r.x0, r.y1 - r.y0) < 5
    const left = tiny ? r.x0 : Math.min(r.x0, r.x1)
    const top = tiny ? r.y0 : Math.min(r.y0, r.y1)
    const at = placeFor(view, left, top)
    if (!at) return
    const w = tiny ? d.width : Math.abs(r.x1 - r.x0) / scale / PX
    const hh = tiny ? d.height : Math.abs(r.y1 - r.y0) / scale / PX
    const flip = line && !tiny ? `${r.x1 < r.x0 ? 'h' : ''}${r.y1 < r.y0 ? 'v' : ''}` : ''
    const raw: Record<string, unknown> = { ...entry.preset, shape: entry.kind, id: freshShapeId(view.state.doc), x: at.x, y: at.y, width: Math.round(w * 10) / 10, height: Math.round(hh * 10) / 10, ...(flip ? { flip } : {}), z: nextZ(app) }
    const data = loadShape(raw)
    if (!data) return
    insertShapeAt(view, at.para, data)
    view.focus()
    // Une zone de texte : on écrit dedans tout de suite.
    if (entry.kind === 'textBox') requestAnimationFrame(() => shapeView(data.id)?.startEditing())
  }
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    finish()
  }
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('keydown', key, true)
  drawing = { cancel: finish }
}

/** Une nouvelle forme se pose au-dessus des autres. */
function nextZ(app: FolioApp): number {
  const all = allShapes(app.view.state.doc)
  return all.length ? Math.max(...all.map((s) => s.data.z ?? 0)) + 1 : 0
}

/** Petite image d'une forme pour la galerie. */
function thumb(entry: Entry): SVGElement {
  const line = isLineKind(entry.kind)
  const [w, hh] = line ? [18, 14] : [18, 15]
  const g = shapeGeom(entry.kind === 'textBox' ? 'rect' : entry.kind, w, hh)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '-3 -3 24 21')
  svg.setAttribute('width', '24')
  svg.setAttribute('height', '21')
  svg.setAttribute('aria-hidden', 'true')
  const tail = entry.preset?.tail ? `<path d="M${w} ${hh}l-4.5-1.2 1.6-1.9z" fill="currentColor"/>` : ''
  const head = entry.preset?.head ? `<path d="M0 0l4.5 1.2-1.6 1.9z" fill="currentColor"/>` : ''
  const text = entry.kind === 'textBox' ? '<path d="M5 5h8M9 5v6" stroke="currentColor" stroke-width="1.2"/>' : ''
  svg.innerHTML = `<path d="${g.d}" fill="${g.open ? 'none' : 'currentColor'}" fill-opacity="0.18"${g.evenOdd ? ' fill-rule="evenodd"' : ''} stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>${g.x ? `<path d="${g.x}" fill="none" stroke="currentColor" stroke-width="1"/>` : ''}${tail}${head}${text}`
  return svg
}

/** La galerie des formes : récentes, puis par catégorie. `pick` : ce que fait un clic (dessiner, ou changer de forme). */
export function shapesGallery(app: FolioApp, pick?: (e: Entry) => void): HTMLElement {
  const act = pick ?? ((e: Entry) => startDrawing(app, e))
  const tile = (e: Entry) => {
    const b = h('button', { type: 'button', class: 'fp-shapes__item', 'data-shape-entry': e.key, title: name(e.key), 'aria-label': name(e.key) }, thumb(e)) as HTMLButtonElement
    b.addEventListener('click', () => {
      closePopovers()
      act(e)
    })
    return b
  }
  const section = (title: string, list: Entry[], cat: string) => (list.length ? h('div', { class: 'fp-shapes__cat', 'data-cat': cat }, h('div', { class: 'fp-shapes__title' }, title), h('div', { class: 'fp-shapes__grid', role: 'group', 'aria-label': title }, ...list.map(tile))) : null)
  const rec = recent().map((k) => ENTRIES.find((e) => e.key === k)!).filter(Boolean)
  const cats = SHAPE_CATEGORIES.map((c) => section(t(`shape.cat.${c}` as Key), ENTRIES.filter((e) => (c === 'lines' ? isLineKind(e.kind) : !isLineKind(e.kind) && catOf(e) === c)), c))
  return h('div', { class: 'fp-shapes', role: 'menu', 'aria-label': t('rb.shapes') }, ...([section(t('shape.cat.recent'), rec, 'recent'), ...cats].filter(Boolean) as HTMLElement[]))
}

// --- zones de texte prêtes ------------------------------------------------------------------

/** Le paragraphe du curseur (où poser une zone de texte toute prête). */
function cursorPara(app: FolioApp): number | null {
  const $f = app.view.state.selection.$from
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).isTextblock) return $f.before(d)
  return null
}

const colWidthPt = (app: FolioApp) => Math.round(((app.view.dom as HTMLElement).clientWidth / PX) * 10) / 10

export function textBoxMenu(app: FolioApp): HTMLElement {
  const insert = (raw: Record<string, unknown>, edit = true) => {
    const para = cursorPara(app)
    if (para === null) return
    const data = loadShape({ id: freshShapeId(app.view.state.doc), z: nextZ(app), ...raw, shape: 'textBox' })
    if (!data) return
    insertShapeAt(app.view, para, data)
    app.view.focus()
    if (edit) requestAnimationFrame(() => shapeView(data.id)?.startEditing())
  }
  const W = colWidthPt(app)
  const sample = t('shape.tb.sample')
  const presets: [string, Record<string, unknown>][] = [
    ['simple', { x: Math.round(W / 2 - 100), y: 0, width: 200, height: 80, text: sample }],
    ['sidebar', { x: Math.round(W - 160), y: 0, width: 160, height: 260, fill: 'accent1', transparency: 85, line: 'none', valign: 'top', blocks: [{ type: 'heading', level: 3, text: sample }, sample] }],
    ['quote', { x: Math.round(W / 2 - 170), y: 0, width: 340, height: 64, fill: 'none', line: 'none', wrap: 'topBottom', valign: 'middle', blocks: [{ content: [{ text: t('shape.tb.quoteSample'), italic: true, size: 16, color: 'accent1' }], align: 'center' }] }],
    ['banner', { x: 0, y: 0, width: W, height: 48, fill: 'accent1', line: 'none', wrap: 'topBottom', valign: 'middle', blocks: [{ content: [{ text: sample, bold: true, color: '#ffffff' }], align: 'center' }] }],
  ]
  return h(
    'div',
    { class: 'fp-pop__list' },
    ...presets.map(([k, raw]) => popItem(h('span', { class: 'fp-pop__icon-row' }, icon(I.textBox), t(`shape.tb.${k}` as Key)), () => insert(raw), { 'data-textbox': k })),
    h('div', { class: 'fp-pop__sep', role: 'separator' }),
    popItem(h('span', { class: 'fp-pop__icon-row' }, icon(I.textBox), t('shape.drawTextBox')), () => startDrawing(app, ENTRIES.find((e) => e.key === 'textBox')!), { 'data-textbox': 'draw' }),
  )
}

// --- images libres ---------------------------------------------------------------------------

/** L'image du texte sélectionnée devient une image libre (même place, même taille). */
export function placeFreely(app: FolioApp, wrap?: ShapeInline['wrap']): boolean {
  const f = figureAt(app.view.state)
  if (!f || app.reading) return false
  const ok = figureToPicture(app.view, f.pos, freshShapeId(app.view.state.doc), nextZ(app), wrap)
  if (ok) app.view.focus()
  return ok
}

/** Les images libres sélectionnées. */
const pictures = (app: FolioApp): ShapeRef[] => sel(app).filter((r) => r.data.shape === 'picture')

/** L'image libre sélectionnée revient dans le texte, comme image ordinaire (avec légende possible). */
export function backInText(app: FolioApp): void {
  const r = pictures(app)[0]
  if (r && pictureToFigure(app.view, r)) app.view.focus()
}

/** Insertion → Images → Image libre : une image choisie sur l'appareil, posée sur la page au curseur. */
export async function insertFreePicture(app: FolioApp): Promise<void> {
  const file = await pickFile('image/*')
  if (!file) return
  let img: Awaited<ReturnType<typeof prepareFile>>
  try {
    img = await prepareFile(file, settings().reduceImages)
  } catch (e) {
    toast(t(e instanceof Error && e.message === 'too-large' ? 'image.tooLarge' : 'image.unreadable'), { kind: 'error' })
    return
  }
  const para = cursorPara(app)
  if (para === null) return
  // Taille naturelle (96 px = 72 pt), au plus la moitié de la colonne.
  const W = colWidthPt(app)
  const w = Math.min((img.width || 400) * 0.75, Math.round(W / 2))
  const hh = img.height && img.width ? (w * img.height) / img.width : w * 0.75
  const data = loadShape({ shape: 'picture', id: freshShapeId(app.view.state.doc), z: nextZ(app), x: Math.round((W - w) / 2), y: 0, width: Math.round(w * 10) / 10, height: Math.round(hh * 10) / 10, src: img.src })
  if (!data) return
  insertShapeAt(app.view, para, data)
  app.view.focus()
}

// --- onglet Format de la forme ----------------------------------------------------------------

const sel = (app: FolioApp): ShapeRef[] => selectedShapes(app.view.state)
/** Des formes sont-elles sélectionnées (onglet Mise en page → Organiser) ? */
export const hasShapes = (app: FolioApp): boolean => !app.reading && sel(app).length > 0
const first = (app: FolioApp) => sel(app)[0]?.data
const editable = (app: FolioApp) => !app.reading && sel(app).length > 0
const apply = (app: FolioApp, fn: (d: ShapeInline) => ShapeInline) => updateShapes(app.view, sel(app), (d) => (d.shape === 'group' ? { ...d, children: d.children?.map((c) => (c.shape === 'group' ? c : fn(c))) } : fn(d)))
const without = <K extends keyof ShapeInline>(d: ShapeInline, k: K): ShapeInline => {
  const out = { ...d }
  delete out[k]
  return out
}

/** Les styles prêts : remplissage plein, contour seul, teinté ; chaque couleur du thème. */
const STYLE_COLORS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'text'] as const
type StyleKind = 'solid' | 'outline' | 'light'
const styled = (d: ShapeInline, c: string, k: StyleKind): ShapeInline => {
  if (isLineKind(d.shape)) return { ...d, line: c }
  const base = without(without(d, 'transparency'), 'shadow')
  if (k === 'solid') return { ...base, fill: c, line: c, lineWidth: 1 }
  if (k === 'outline') return { ...base, fill: '#ffffff', line: c, lineWidth: 1.5 }
  return { ...base, fill: c, transparency: 75, line: c, lineWidth: 1 }
}
function styleSwatch(app: FolioApp, c: string, k: StyleKind): HTMLElement {
  const sample: ShapeInline = styled({ type: 'shape', shape: 'roundRect', id: 's', x: 0, y: 0, width: 26, height: 18 }, c, k)
  const tpl = document.createElement('template')
  // Hors de la page, les variables de couleur du document n'existent pas : les valeurs du thème.
  const paint = editorPaint(app.theme as Theme)
  tpl.innerHTML = shapeSvg(sample, { color: (x) => paint.hex?.(x) ?? x, hex: paint.hex })
  const b = h('button', { type: 'button', class: 'fp-shape-style', 'data-shape-style': `${k}-${c}`, title: t('shape.style', { n: `${c} · ${k}` }) }, tpl.content)
  b.addEventListener('mousedown', (e) => e.preventDefault())
  b.addEventListener('click', () => {
    closePopovers()
    apply(app, (d) => styled(d, c, k))
  })
  return b
}

function outlineMenu(app: FolioApp): HTMLElement {
  const d = first(app)
  const line = d ? isLineKind(d.shape) : false
  const weights = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6]
  const items: HTMLElement[] = [
    colorPalette({ theme: app.theme, current: d?.line && d.line !== 'none' ? d.line : null, noneLabel: t('shape.noOutline'), onPick: (c) => apply(app, (x) => ({ ...x, line: c ?? 'none' })) }),
    h('div', { class: 'fp-pop__title' }, t('shape.weight')),
    h('div', { class: 'fp-shape-weights' }, ...weights.map((w) => popItem(`${w} pt`, () => apply(app, (x) => ({ ...x, lineWidth: w, line: x.line === 'none' ? 'text' : x.line })), { 'data-weight': String(w), 'aria-checked': String(d?.lineWidth === w) }))),
    h('div', { class: 'fp-pop__title' }, t('shape.dashes')),
    h('div', { class: 'fp-shape-weights' }, ...LINE_DASHES.map((k) => popItem(t(`shape.dash.${k}` as Key), () => apply(app, (x) => (k === 'solid' ? without(x, 'dash') : { ...x, dash: k })), { 'data-dash': k, 'aria-checked': String((d?.dash ?? 'solid') === k) }))),
  ]
  if (line) {
    for (const which of ['head', 'tail'] as const) {
      items.push(h('div', { class: 'fp-pop__title' }, `${t('shape.arrows')} · ${t(which === 'head' ? 'shape.start' : 'shape.end')}`))
      items.push(h('div', { class: 'fp-shape-weights' }, ...LINE_ENDS.map((k) => popItem(t(`shape.end.${k}` as Key), () => apply(app, (x) => (k === 'none' ? without(x, which) : { ...x, [which]: k })), { [`data-${which}`]: k, 'aria-checked': String((d?.[which] ?? 'none') === k) }))))
    }
  }
  return h('div', { class: 'fp-pop__list fp-shape-outline' }, ...items)
}

function effectsMenu(app: FolioApp): HTMLElement {
  const d = first(app)
  return h(
    'div',
    { class: 'fp-pop__list' },
    popItem(t('shape.noShadow'), () => apply(app, (x) => without(x, 'shadow')), { 'data-effect': 'no-shadow', 'aria-checked': String(!d?.shadow) }),
    popItem(t('shape.shadow'), () => apply(app, (x) => ({ ...x, shadow: true })), { 'data-effect': 'shadow', 'aria-checked': String(!!d?.shadow) }),
    h('div', { class: 'fp-pop__title' }, t('shape.transparency')),
    ...[0, 25, 50, 75].map((v) => popItem(`${v} %`, () => apply(app, (x) => (v ? { ...x, transparency: v } : without(x, 'transparency'))), { 'data-transparency': String(v), 'aria-checked': String((d?.transparency ?? 0) === v) })),
  )
}

export function wrapMenu(app: FolioApp): HTMLElement {
  const d = first(app)
  const ic: Record<string, string> = { inline: I.wrapNone, square: I.wrapLeft, topBottom: I.wrapNone, behind: I.wrapBehind, front: I.wrapFront }
  return h(
    'div',
    { class: 'fp-pop__list' },
    ...SHAPE_WRAPS.map((w) => popItem(h('span', { class: 'fp-pop__icon-row' }, icon(ic[w] ?? I.wrapNone), t(`shape.wrap.${w}` as Key)), () => setWrap(app.view, sel(app), w), { 'data-shape-wrap': w, 'aria-checked': String(d?.wrap === w) })),
    ...(pictures(app).length === 1 && sel(app).length === 1 ? [h('hr', { class: 'fp-pop__sep' }), popItem(t('pic.backInText'), () => backInText(app), { 'data-shape-wrap': 'text' })] : []),
  )
}

export function positionMenu(app: FolioApp): HTMLElement {
  const d = first(app)
  const grid = h(
    'div',
    { class: 'fp-shape-positions', role: 'group', 'aria-label': t('shape.pos.with') },
    ...POSITIONS.map((p) => {
      const b = h('button', { type: 'button', class: 'fp-shape-pos', 'data-position': p, title: t(`shape.pos.${p}` as Key), 'aria-label': t(`shape.pos.${p}` as Key) }, h('span', { class: `fp-shape-pos__dot fp-shape-pos__dot--${p}` }))
      b.addEventListener('click', () => {
        closePopovers()
        // Une image du texte : elle devient libre, puis se place.
        const r = sel(app)[0] ?? (placeFreely(app) ? sel(app)[0] : undefined)
        if (r) positionShape(app.view, r, p as PositionPreset)
      })
      return b
    }),
  )
  return h(
    'div',
    { class: 'fp-pop__list' },
    ...(d ? [popItem(t('shape.pos.inline'), () => setWrap(app.view, sel(app), 'inline'), { 'data-position': 'inline', 'aria-checked': String(d.wrap === 'inline') })] : []),
    h('div', { class: 'fp-pop__title' }, t('shape.pos.with')),
    grid,
  )
}

let alignTo: 'page' | 'margin' | 'selection' | null = null

export function alignMenu(app: FolioApp): HTMLElement {
  const refs = sel(app)
  const to = alignTo ?? (refs.length > 1 ? 'selection' : 'margin')
  const run = (how: AlignHow) => alignShapes(app.view, sel(app), how, to === 'selection' && refs.length < 2 ? 'margin' : to)
  const ics: Record<string, string> = { left: I.alignLeft, center: I.alignCenter, right: I.alignRight, top: I.alignObj, middle: I.alignObj, bottom: I.alignObj, distributeH: I.alignObj, distributeV: I.alignObj }
  const item = (how: AlignHow) => popItem(h('span', { class: 'fp-pop__icon-row' }, icon(ics[how]), t(`shape.align.${how}` as Key)), () => run(how), { 'data-align-shapes': how })
  const rel = (k: 'page' | 'margin' | 'selection', key: Key) =>
    popItem(t(key), () => {
      alignTo = k
    }, { 'data-align-to': k, 'aria-checked': String(to === k), ...(k === 'selection' && refs.length < 2 ? { disabled: true } : {}) })
  return h(
    'div',
    { class: 'fp-pop__list' },
    ...(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map(item),
    h('div', { class: 'fp-pop__sep', role: 'separator' }),
    item('distributeH'),
    item('distributeV'),
    h('div', { class: 'fp-pop__sep', role: 'separator' }),
    rel('page', 'shape.align.toPage'),
    rel('margin', 'shape.align.toMargin'),
    rel('selection', 'shape.align.toSelection'),
  )
}

export function groupMenu(app: FolioApp): HTMLElement {
  const refs = sel(app)
  const canGroup = refs.filter((r) => r.data.wrap !== 'inline').length > 1
  const canUngroup = refs.length === 1 && refs[0].data.shape === 'group'
  return h(
    'div',
    { class: 'fp-pop__list' },
    popItem(h('span', { class: 'fp-pop__icon-row' }, icon(I.groupObj), t('shape.group')), () => groupNow(app), { 'data-group': 'group', disabled: !canGroup }),
    popItem(h('span', { class: 'fp-pop__icon-row' }, icon(I.groupObj), t('shape.ungroup')), () => ungroupNow(app), { 'data-group': 'ungroup', disabled: !canUngroup }),
  )
}

export function groupNow(app: FolioApp): void {
  if (!groupShapes(app.view, sel(app))) toast(t('shape.groupNeed'), { kind: 'info' })
}
export function ungroupNow(app: FolioApp): void {
  const r = sel(app)[0]
  if (r) ungroupShape(app.view, r)
}

export function rotateMenu(app: FolioApp): HTMLElement {
  const it = (k: 'right' | 'left' | 'flipV' | 'flipH', ic: string, label: Key) => popItem(h('span', { class: 'fp-pop__icon-row' }, icon(ic), t(label)), () => rotateShapes(app.view, sel(app), k), { 'data-shape-rotate': k })
  return h('div', { class: 'fp-pop__list' }, it('right', I.rotateRight, 'shape.rotateRight'), it('left', I.rotateLeft, 'shape.rotateLeft'), it('flipV', I.flipV, 'shape.flipV'), it('flipH', I.flipH, 'shape.flipH'))
}

function valignMenu(app: FolioApp): HTMLElement {
  const d = first(app)
  return h('div', { class: 'fp-pop__list' }, ...(['top', 'middle', 'bottom'] as const).map((v) => popItem(t(`shape.valign.${v}` as Key), () => apply(app, (x) => (holdsText(x) ? { ...x, valign: v } : x)), { 'data-valign': v, 'aria-checked': String(d?.valign === v) })))
}

export function altDialog(app: FolioApp): void {
  const r = sel(app)[0]
  if (!r) return
  const alt = h('textarea', { class: 'fp-input', rows: '3', maxlength: '2000', 'data-field': 'shape-alt' }) as HTMLTextAreaElement
  alt.value = r.data.alt ?? ''
  openDialog({
    name: 'shape-alt',
    title: t('image.alt'),
    focus: alt,
    body: [h('p', { class: 'fp-muted' }, t('shape.altHelp')), alt],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      { label: t('action.ok'), value: 'ok', primary: true, run: () => void updateShapes(app.view, sel(app).slice(0, 1), (d) => (alt.value.trim() ? { ...d, alt: alt.value.trim().slice(0, 2000) } : without(d, 'alt'))) },
    ],
  })
}

/** Change la forme choisie (la taille, les couleurs et le texte restent). */
function changeKind(app: FolioApp, e: Entry): void {
  apply(app, (d) => {
    if (isLineKind(d.shape) !== isLineKind(e.kind)) return d
    return { ...d, shape: e.kind, ...(e.preset ?? {}) }
  })
}

function sizeField(app: FolioApp, id: string, label: string, ic: string, key: 'width' | 'height'): Ctl {
  const input = h('input', { type: 'number', class: 'fp-rb-num', min: '0', max: '3000', step: '1', 'data-cmd': id, 'aria-label': label, title: label }) as HTMLInputElement
  input.addEventListener('change', () => {
    const v = Number(input.value)
    if (!Number.isFinite(v) || v < 0) return
    updateShapes(app.view, sel(app), (d) => ({ ...d, [key]: Math.min(3000, Math.round(v * 10) / 10) }))
  })
  return {
    el: h('label', { class: 'fp-rb-field' }, icon(ic), input, h('span', { class: 'fp-rb-unit' }, 'pt')),
    update: () => {
      if (document.activeElement === input) return
      const d = first(app)
      input.value = d ? String(Math.round(d[key])) : ''
      input.disabled = !editable(app)
    },
  }
}

/** L'onglet Format de la forme (une forme ou plusieurs sélectionnées). */
export function shapeGroups(app: FolioApp): Group[] {
  const on = () => editable(app)
  const gallery = h('div', { class: 'fp-rb-gallery fp-rb-gallery--frames fp-shape-styles', role: 'listbox', 'aria-label': t('ribbon.shapeStyles') })
  let key = ''
  const styles: Ctl = {
    el: gallery,
    update: () => {
      const k = JSON.stringify(app.theme.colors)
      if (k === key) return
      key = k
      gallery.replaceChildren(...STYLE_COLORS.slice(0, 6).map((c) => styleSwatch(app, c, 'solid')))
    },
  }
  return [
    {
      id: 'shape-insert',
      label: t('ribbon.insertShapes'),
      controls: [
        dropdown({ id: 'shape-gallery', label: t('rb.shapes'), icon: I.shapes, large: true, menu: () => shapesGallery(app) }),
        col(
          dropdown({ id: 'shape-change', label: t('shape.change'), icon: I.shapes, text: () => t('shape.change'), enabled: () => on() && !sel(app).some((r) => r.data.shape === 'picture'), menu: () => shapesGallery(app, (e) => changeKind(app, e)) }),
          button({ id: 'shape-textbox', label: t('shape.drawTextBox'), icon: I.textBox, text: true, run: () => startDrawing(app, ENTRIES.find((e) => e.key === 'textBox')!) }),
        ),
      ],
    },
    {
      id: 'shape-styles',
      label: t('ribbon.shapeStyles'),
      controls: [
        styles,
        dropdown({
          id: 'shape-styles-more',
          label: t('ribbon.shapeStyles'),
          icon: I.caret,
          enabled: on,
          menu: () => h('div', { class: 'fp-shape-stylegrid' }, ...(['solid', 'light', 'outline'] as const).flatMap((k) => STYLE_COLORS.map((c) => styleSwatch(app, c, k)))),
        }),
        col(
          dropdown({ id: 'shape-fill', label: t('shape.fill'), icon: I.highlight, text: () => t('shape.fill'), enabled: on, menu: () => colorPalette({ theme: app.theme, current: first(app)?.fill && first(app)?.fill !== 'none' ? first(app)!.fill! : null, noneLabel: t('shape.noFill'), onPick: (c) => apply(app, (x) => (isLineKind(x.shape) ? x : { ...x, fill: c ?? 'none' })) }) }),
          dropdown({ id: 'shape-outline', label: t('shape.outline'), icon: I.border, text: () => t('shape.outline'), enabled: on, menu: () => outlineMenu(app) }),
          dropdown({ id: 'shape-effects', label: t('shape.effects'), icon: I.effects, text: () => t('shape.effects'), enabled: on, menu: () => effectsMenu(app) }),
        ),
      ],
    },
    {
      // Image libre : ses retouches, et le retour dans le texte. Caché pour les autres formes.
      id: 'shape-picture',
      label: t('pic.group'),
      controls: [
        (() => {
          const marker = h('span', { hidden: true })
          return { el: marker, update: () => {
            const g = marker.closest('.fp-rb-group') as HTMLElement | null
            if (g) g.hidden = !pictures(app).length
          } } as Ctl
        })(),
        PFX.corrections(app),
        col(PFX.pictureColor(app), PFX.artistic(app), PFX.transparency(app)),
        button({ id: 'picture-back-in-text', label: t('pic.backInText'), icon: I.wrapNone, large: true, enabled: () => on() && pictures(app).length === 1 && sel(app).length === 1, run: () => backInText(app) }),
      ],
    },
    {
      id: 'shape-text',
      label: t('ribbon.shapeText'),
      controls: [
        col(
          dropdown({ id: 'shape-valign', label: t('shape.valign'), icon: I.alignObj, text: () => t('shape.valign'), enabled: () => on() && sel(app).some((r) => holdsText(r.data)), menu: () => valignMenu(app) }),
          button({ id: 'shape-edit-text', label: t('shape.editText'), icon: I.textBox, text: true, enabled: () => on() && sel(app).length === 1 && holdsText(sel(app)[0].data), run: () => shapeView(sel(app)[0]?.data.id ?? '')?.startEditing() }),
        ),
      ],
    },
    {
      id: 'shape-access',
      label: t('ribbon.imageAccess'),
      controls: [button({ id: 'shape-alt', label: t('image.alt'), icon: I.alt, large: true, enabled: on, run: () => altDialog(app) })],
    },
    {
      id: 'shape-arrange',
      label: t('rb.arrange'),
      controls: [
        dropdown({ id: 'shape-position', label: t('rb.position'), icon: I.position, large: true, enabled: () => on() && sel(app).length === 1, menu: () => positionMenu(app) }),
        dropdown({ id: 'shape-wrap', label: t('rb.wrapText'), icon: I.wrapRight, large: true, enabled: on, menu: () => wrapMenu(app) }),
        col(
          arrangeSplit(app, 'shape-forward', 'shape.forward', I.bringForward, 'forward', 'front', 'shape.toFront'),
          arrangeSplit(app, 'shape-backward', 'shape.backward', I.sendBackward, 'backward', 'back', 'shape.toBack'),
          button({ id: 'shape-selection-pane', label: t('rb.selectionPane'), icon: I.selectionPane, text: true, active: () => !!pane && !pane.el.hidden, run: () => toggleSelectionPane(app) }),
        ),
        col(
          dropdown({ id: 'shape-align', label: t('rb.align'), icon: I.alignObj, enabled: on, menu: () => alignMenu(app) }),
          dropdown({ id: 'shape-group', label: t('rb.group'), icon: I.groupObj, enabled: on, menu: () => groupMenu(app) }),
          dropdown({ id: 'shape-rotate', label: t('rb.rotate'), icon: I.rotate, enabled: on, menu: () => rotateMenu(app) }),
        ),
      ],
    },
    {
      id: 'shape-size',
      label: t('rb.size'),
      controls: [col(sizeField(app, 'shape-height', t('shape.height'), I.height, 'height'), sizeField(app, 'shape-width', t('shape.width'), I.width, 'width'))],
    },
  ]
}

export function arrangeSplit(app: FolioApp, id: string, label: Key, ic: string, one: StackMove, all: StackMove, allLabel: Key): Ctl {
  return split({
    id,
    label: t(label),
    icon: ic,
    text: true,
    enabled: () => editable(app),
    run: () => restack(app.view, sel(app), one),
    menu: () => h('div', { class: 'fp-pop__list' }, popItem(t(label), () => restack(app.view, sel(app), one), { 'data-stack': one }), popItem(t(allLabel), () => restack(app.view, sel(app), all), { 'data-stack': all })),
  })
}

// --- volet Sélection -------------------------------------------------------------------------

/** Le volet Sélection : les formes, du premier plan à l'arrière-plan ; afficher, masquer, renommer, réordonner. */
export class SelectionPane {
  readonly el: HTMLElement
  private list: HTMLElement
  private key = ''
  private renaming: string | null = null

  constructor(private app: FolioApp) {
    this.list = h('ol', { class: 'fp-selpane__list', role: 'listbox', 'aria-label': t('pane.title') })
    const close = h('button', { type: 'button', class: 'fp-iconbtn', 'aria-label': t('pane.close'), title: t('pane.close'), onclick: () => this.toggle(false) }, icon(ICONS.close))
    const showAll = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-pane': 'show-all', onclick: () => this.setAll(false) }, t('pane.showAll'))
    const hideAll = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-pane': 'hide-all', onclick: () => this.setAll(true) }, t('pane.hideAll'))
    const forward = h('button', { type: 'button', class: 'fp-iconbtn', 'data-pane': 'forward', 'aria-label': t('shape.forward'), title: t('shape.forward'), onclick: () => restack(app.view, sel(app), 'forward') }, icon(I.arrowUp))
    const backward = h('button', { type: 'button', class: 'fp-iconbtn', 'data-pane': 'backward', 'aria-label': t('shape.backward'), title: t('shape.backward'), onclick: () => restack(app.view, sel(app), 'backward') }, icon(I.arrowDown))
    this.el = h(
      'aside',
      { class: 'fp-selpane', id: 'fp-selpane', 'aria-label': t('pane.title'), hidden: true },
      h('div', { class: 'fp-selpane__head' }, h('h2', { class: 'fp-selpane__title' }, t('pane.title')), close),
      h('div', { class: 'fp-selpane__tools' }, showAll, hideAll, h('span', { class: 'fp-selpane__spacer' }), forward, backward),
      h('p', { class: 'fp-selpane__hint fp-muted' }, t('pane.order')),
      this.list,
    )
    app.onChange(() => this.render())
  }

  toggle(show = this.el.hidden): void {
    this.el.hidden = !show
    this.key = ''
    this.render()
    this.app.notifyUi()
    window.dispatchEvent(new Event('resize'))
  }

  private setAll(hidden: boolean): void {
    updateShapes(this.app.view, allShapes(this.app.view.state.doc), (d) => (hidden ? { ...d, hidden: true } : without(d, 'hidden')))
  }

  render(): void {
    if (this.el.hidden) return
    const doc = this.app.view.state.doc
    const chosen = new Set(selectedShapes(this.app.view.state).map((s) => s.data.id))
    const ranks = stackRanks(doc)
    const all = allShapes(doc).sort((a, b) => ranks.get(b.data.id)! - ranks.get(a.data.id)!)
    const key = JSON.stringify([all.map((s) => [s.data.id, s.data.name, s.data.hidden, s.data.shape]), [...chosen], this.renaming])
    if (key === this.key) return
    this.key = key
    if (!all.length) {
      this.list.replaceChildren(h('li', { class: 'fp-selpane__empty fp-muted' }, t('pane.empty')))
      return
    }
    let dragFrom: string | null = null
    this.list.replaceChildren(
      ...all.map((s) => {
        const label = s.data.name || `${name(s.data.shape)} ${s.data.id.replace(/^shape/, '')}`
        const eye = h('button', { type: 'button', class: 'fp-iconbtn fp-selpane__eye', 'data-pane': 'eye', 'aria-label': t(s.data.hidden ? 'pane.show' : 'pane.hide'), title: t(s.data.hidden ? 'pane.show' : 'pane.hide'), 'aria-pressed': String(!s.data.hidden) }, icon(s.data.hidden ? I.eyeOff : I.eye))
        eye.addEventListener('click', (e) => {
          e.stopPropagation()
          updateShapes(this.app.view, [s], (d) => (d.hidden ? without(d, 'hidden') : { ...d, hidden: true }))
        })
        const text =
          this.renaming === s.data.id
            ? (() => {
                const input = h('input', { type: 'text', class: 'fp-input fp-selpane__rename', value: label, maxlength: '200', 'data-pane': 'rename', 'aria-label': t('pane.rename') }) as HTMLInputElement
                const end = (keep: boolean) => {
                  if (this.renaming !== s.data.id) return
                  this.renaming = null
                  const v = input.value.trim()
                  if (keep && v && v !== label) updateShapes(this.app.view, allShapes(this.app.view.state.doc).filter((x) => x.data.id === s.data.id), (d) => ({ ...d, name: v.slice(0, 200) }))
                  else this.render()
                }
                input.addEventListener('keydown', (e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') end(true)
                  if (e.key === 'Escape') end(false)
                })
                input.addEventListener('blur', () => end(true))
                requestAnimationFrame(() => {
                  input.focus()
                  input.select()
                })
                return input
              })()
            : h('span', { class: 'fp-selpane__name' }, label)
        const li = h('li', { class: 'fp-selpane__item' + (chosen.has(s.data.id) ? ' is-selected' : '') + (s.data.hidden ? ' is-hidden' : ''), role: 'option', 'aria-selected': String(chosen.has(s.data.id)), 'data-shape-id': s.data.id, draggable: 'true', title: t('pane.rename') }, text, eye)
        li.addEventListener('click', (e) => {
          if ((e.target as Element).closest('input')) return
          const r = allShapes(this.app.view.state.doc).find((x) => x.data.id === s.data.id)
          if (!r) return
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            const multi = new Set(selectedShapes(this.app.view.state).map((x) => x.data.id))
            multi.add(r.data.id)
            this.app.view.dispatch(this.app.view.state.tr.setSelection(NodeSelection.create(this.app.view.state.doc, r.pos)).setMeta(shapesKey, { multi: [...multi], grabbed: r.data.id }))
          } else this.app.view.dispatch(this.app.view.state.tr.setSelection(NodeSelection.create(this.app.view.state.doc, r.pos)).setMeta(shapesKey, { multi: [], grabbed: r.data.id }).scrollIntoView())
          this.app.view.focus()
        })
        li.addEventListener('dblclick', () => {
          this.renaming = s.data.id
          this.key = ''
          this.render()
        })
        li.addEventListener('dragstart', (e) => {
          dragFrom = s.data.id
          e.dataTransfer?.setData('text/x-folio-shape', s.data.id)
        })
        li.addEventListener('dragover', (e) => {
          if (dragFrom) e.preventDefault()
        })
        li.addEventListener('drop', (e) => {
          e.preventDefault()
          if (!dragFrom || dragFrom === s.data.id) return
          this.reorder(dragFrom, s.data.id)
          dragFrom = null
        })
        return li
      }),
    )
  }

  /** Glisser dans la liste : la forme prend la place (dans la pile) de celle où on la lâche. */
  private reorder(id: string, onto: string): void {
    const doc = this.app.view.state.doc
    const ranks = stackRanks(doc)
    const top = allShapes(doc).sort((a, b) => ranks.get(b.data.id)! - ranks.get(a.data.id)!).map((s) => s.data.id)
    const from = top.indexOf(id)
    const to = top.indexOf(onto)
    top.splice(from, 1)
    top.splice(to, 0, id)
    const z = new Map(top.map((x, i) => [x, top.length - 1 - i]))
    updateShapes(this.app.view, allShapes(doc), (d) => ({ ...d, z: z.get(d.id)! }))
  }
}

let pane: SelectionPane | null = null
export function setSelectionPane(p: SelectionPane): void {
  pane = p
}
export function toggleSelectionPane(app: FolioApp, show?: boolean): void {
  pane?.toggle(show)
  app.notifyUi()
}

/** Pour les tests et le menu contextuel : déplacer les formes choisies. */
export const nudge = (app: FolioApp, dx: number, dy: number) => moveShapes(app.view, sel(app), dx, dy)
