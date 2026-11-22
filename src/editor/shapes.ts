// Formes, zones de texte et groupes dans l'éditeur.
//
// Une forme est un nœud en ligne, au début de son paragraphe d'ancrage ; la
// vue la place librement : dans le texte (comme un grand caractère), devant ou
// derrière le texte (en position absolue dans le paragraphe), ou habillée par
// le texte (un flottant dont seule la forme écarte le texte). x se compte depuis
// la marge gauche, y depuis le haut du paragraphe : la forme suit son paragraphe.
//
// À la souris : cliquer sélectionne (Maj ou Ctrl : plusieurs), glisser déplace
// (la forme se raccroche au paragraphe sous elle), les poignées redimensionnent
// (Maj : mêmes proportions) ou font tourner (Maj : par 15°), les bouts d'un trait
// se déplacent. Au clavier : flèches (Maj : 10 pt), Tab pour la suivante, Entrée
// ou une lettre pour écrire dedans, Échap pour revenir au texte.

import type { Node as PMNode } from 'prosemirror-model'
import { closeHistory } from 'prosemirror-history'
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView, type NodeView } from 'prosemirror-view'
import { cssColor } from '../format/color'
import { pictureHtml, shapeSvg, textColorOf, wrapsText, type Paint } from '../format/shapedraw'
import { isLineKind, textBox } from '../format/shapes'
import type { ShapeInline, Theme } from '../format/types'
import { displayScale } from '../layout/scale'
import { renderBlocks } from '../layout/sheets'
import { schema } from './schema'

const n = schema.nodes
/** Points → pixels CSS. */
export const PX = 4 / 3
const round = (v: number) => Math.round(v * 10) / 10

export interface ShapeHooks {
  /** Écrire dans la forme (double-clic, Entrée, une lettre) : l'interface ouvre un petit éditeur dans `host`. */
  editText: (pos: number, host: HTMLElement, first?: string) => void
  /** Infobulle. */
  label: (d: ShapeInline) => string
}

// --- état : plusieurs formes sélectionnées, forme « en main » -------------------------

interface ShapesState {
  /** Formes sélectionnées en plus de la sélection de nœud (Maj+clic). */
  multi: string[]
  /** Forme prise à la souris ou par Tab : les flèches la déplacent (sinon elles déplacent le curseur). */
  grabbed: string | null
}

export const shapesKey = new PluginKey<ShapesState>('shapes')

export interface ShapeRef {
  pos: number
  node: PMNode
  data: ShapeInline
}

/** Toutes les formes du document, dans l'ordre. */
export function allShapes(doc: PMNode): ShapeRef[] {
  const out: ShapeRef[] = []
  doc.descendants((node, pos) => {
    if (node.type === n.shape) {
      out.push({ pos, node, data: node.attrs.data as ShapeInline })
      return false
    }
    return !node.isLeaf
  })
  return out
}

/** Les formes sélectionnées : celle de la sélection de nœud et celles prises avec Maj. */
export function selectedShapes(state: EditorState): ShapeRef[] {
  const sel = state.selection
  const ids = new Set(shapesKey.getState(state)?.multi ?? [])
  if (sel instanceof NodeSelection && sel.node.type === n.shape) ids.add((sel.node.attrs.data as ShapeInline).id)
  if (!ids.size) return []
  return allShapes(state.doc).filter((s) => ids.has(s.data.id))
}

/** La forme de la sélection de nœud, s'il y en a une. */
export function shapeAt(state: EditorState): ShapeRef | null {
  const sel = state.selection
  return sel instanceof NodeSelection && sel.node.type === n.shape ? { pos: sel.from, node: sel.node, data: sel.node.attrs.data as ShapeInline } : null
}

/** Rang de chaque forme dans la pile (z, puis ordre du document) : 0 tout en bas. */
export function stackRanks(doc: PMNode): Map<string, number> {
  const list = allShapes(doc)
  const order = list.map((s, i) => ({ id: s.data.id, z: s.data.z ?? 0, i })).sort((a, b) => a.z - b.z || a.i - b.i)
  return new Map(order.map((o, k) => [o.id, k]))
}

// --- dessin -------------------------------------------------------------------------------

/** Couleurs de l'éditeur : variables du thème pour le dessin, valeurs pour choisir la couleur du texte. */
export function editorPaint(theme: Theme): Paint {
  return {
    color: (c) => cssColor(c),
    hex: (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : ((theme.colors as Record<string, string>)[c] ?? null)),
  }
}

/** Le contenu d'une forme (dessin, texte ; un groupe : ses formes) dans `box`. */
function fill(box: HTMLElement, d: ShapeInline, paint: Paint, theme: Theme): HTMLElement | null {
  const tpl = document.createElement('template')
  if (d.shape === 'group') {
    box.replaceChildren()
    for (const c of d.children ?? []) {
      const kid = document.createElement('span')
      kid.className = 'fp-shape__kid'
      if (c.hidden) kid.hidden = true
      placeLocal(kid, c)
      fill(kid, c, paint, theme)
      box.append(kid)
    }
    return null
  }
  if (d.shape === 'picture') {
    // L'image, puis son contour éventuel par-dessus ; pas de texte.
    tpl.innerHTML = pictureHtml(d, d.src ?? '', (c) => paint.color(c)) + (d.line && d.line !== 'none' ? shapeSvg({ ...d, fill: 'none' }, paint, ' class="fp-shape__svg"') : '')
    box.replaceChildren(tpl.content)
    return null
  }
  tpl.innerHTML = shapeSvg(d, paint, ' class="fp-shape__svg"')
  box.replaceChildren(tpl.content)
  if (isLineKind(d.shape)) {
    // Un trait fin se prend mal à la souris : une bande invisible plus large autour.
    const svg = box.querySelector('svg')
    const path = svg?.querySelector('path')?.getAttribute('d')
    if (svg && path) svg.insertAdjacentHTML('beforeend', `<path class="fp-shape__hit" d="${path}" fill="none" stroke="transparent" stroke-width="14"${svg.querySelector('g')?.getAttribute('transform') ? ` transform="${svg.querySelector('g')!.getAttribute('transform')}"` : ''}/>`)
    return null
  }
  const [l, t, r, b] = textBox(d.shape, d.width * PX, d.height * PX)
  const text = document.createElement('span')
  text.className = 'fp-shape__text'
  text.dataset.valign = d.valign ?? 'middle'
  text.style.inset = `${t}px ${r}px ${b}px ${l}px`
  const color = textColorOf(d, paint)
  if (color) text.style.color = color
  if (d.blocks?.length) text.append(renderBlocks(d.blocks, {}))
  box.append(text)
  return text
}

/** Taille et rotation d'une forme dans son repère (groupe). */
function placeLocal(el: HTMLElement, d: ShapeInline): void {
  el.style.left = `${d.x * PX}px`
  el.style.top = `${d.y * PX}px`
  el.style.width = `${d.width * PX}px`
  el.style.height = `${d.height * PX}px`
  el.style.transform = d.rotate ? `rotate(${d.rotate}deg)` : ''
}

// --- géométrie de la page ---------------------------------------------------------------

/** Échelle d'affichage (zoom) de l'éditeur. */
const scaleOf = (view: EditorView) => displayScale(view.dom as HTMLElement) || 1

/** Bord gauche de la colonne de texte (px de l'écran). */
function columnLeft(view: EditorView): number {
  const dom = view.dom as HTMLElement
  const cs = getComputedStyle(dom)
  return dom.getBoundingClientRect().left + ((parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0)) * scaleOf(view)
}

/** Le paragraphe d'ancrage d'une forme (position du paragraphe, élément). */
function anchorOf(view: EditorView, pos: number): { pos: number; el: HTMLElement } | null {
  if (pos > view.state.doc.content.size) return null
  const $p = view.state.doc.resolve(pos)
  if (!$p.parent.isTextblock || $p.depth === 0) return null
  const at = $p.before()
  try {
    const el = view.nodeDOM(at) as HTMLElement | null
    return el ? { pos: at, el } : null
  } catch {
    return null
  }
}

/** Le paragraphe sous un point de l'écran (pour y raccrocher une forme), sinon null. */
export function textblockAt(view: EditorView, clientX: number, clientY: number): { pos: number; el: HTMLElement } | null {
  const box = (view.dom as HTMLElement).getBoundingClientRect()
  const y = Math.min(box.bottom - 2, Math.max(box.top + 2, clientY))
  const x = Math.min(box.right - 2, Math.max(box.left + 2, clientX))
  const hit = view.posAtCoords({ left: x, top: y })
  if (hit) {
    const $p = view.state.doc.resolve(hit.pos)
    for (let d = $p.depth; d > 0; d--) {
      const node = $p.node(d)
      if (!node.isTextblock) continue
      if (node.type !== n.paragraph && node.type !== n.heading) break
      if ($p.node(d - 1).type.spec.tableRole) break
      const at = $p.before(d)
      const el = view.nodeDOM(at) as HTMLElement | null
      if (el) return { pos: at, el }
      break
    }
  }
  // Sous un tableau, une figure, un index, après la fin du texte… : le paragraphe le plus proche.
  return nearestTextblock(view, clientY)
}

/** Le paragraphe ou titre (hors tableaux) le plus proche d'une hauteur de l'écran. */
function nearestTextblock(view: EditorView, clientY: number): { pos: number; el: HTMLElement } | null {
  let best: { pos: number; el: HTMLElement; d: number } | null = null
  view.state.doc.descendants((node, pos, parent) => {
    if (node.type.spec.tableRole) return false
    if (node.type !== n.paragraph && node.type !== n.heading) return !node.isTextblock && !node.isAtom
    if (parent?.type.spec.tableRole) return false
    let el: HTMLElement | null = null
    try {
      el = view.nodeDOM(pos) as HTMLElement | null
    } catch {
      return false
    }
    if (!el?.getBoundingClientRect) return false
    const r = el.getBoundingClientRect()
    if (!r.height && !r.width) return false
    const d = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0
    if (!best || d < best.d) best = { pos, el, d }
    return false
  })
  const b = best as { pos: number; el: HTMLElement; d: number } | null
  return b ? { pos: b.pos, el: b.el } : null
}

/** Position d'une forme dans un repère commun (pt) : x depuis la marge, y depuis le haut du texte. */
export function pagePoint(view: EditorView, ref: ShapeRef): { x: number; y: number } | null {
  const a = anchorOf(view, ref.pos)
  if (!a) return null
  const top = ((a.el.getBoundingClientRect().top - (view.dom as HTMLElement).getBoundingClientRect().top) / scaleOf(view)) / PX
  return { x: ref.data.x, y: top + ref.data.y }
}

/** La page (ou, en vue web, la colonne) d'un point de l'écran : la zone du texte, en px de l'écran. */
export function pageArea(view: EditorView, clientY: number): { left: number; right: number; top: number; bottom: number; pageTop: number; pageBottom: number; pageLeft: number; pageRight: number } {
  const dom = view.dom as HTMLElement
  const r = dom.getBoundingClientRect()
  const left = columnLeft(view)
  const right = left + dom.clientWidth * scaleOf(view)
  const sheets = Array.from(document.querySelectorAll<HTMLElement>('.fp-sheet'))
  const sheet = sheets.find((s) => {
    const b = s.getBoundingClientRect()
    return clientY >= b.top && clientY <= b.bottom
  }) ?? sheets.reduce<HTMLElement | null>((best, s) => {
    const b = s.getBoundingClientRect()
    const d = Math.min(Math.abs(b.top - clientY), Math.abs(b.bottom - clientY))
    return !best || d < Math.min(Math.abs(best.getBoundingClientRect().top - clientY), Math.abs(best.getBoundingClientRect().bottom - clientY)) ? s : best
  }, null)
  if (!sheet) return { left, right, top: r.top, bottom: r.bottom, pageTop: r.top, pageBottom: r.bottom, pageLeft: left, pageRight: right }
  const b = sheet.getBoundingClientRect()
  const s = scaleOf(view)
  // Les marges du haut et du bas : celles de la mise en page (le texte commence là).
  const page = view.state.doc.attrs.page as { margins: { top: number; bottom: number } }
  const mm = (96 / 25.4) * s
  return { left, right, top: b.top + page.margins.top * mm, bottom: b.bottom - page.margins.bottom * mm, pageTop: b.top, pageBottom: b.bottom, pageLeft: b.left, pageRight: b.right }
}

// --- la vue d'une forme -----------------------------------------------------------------

const views = new Map<string, ShapeView>()
/** La vue d'une forme (par son identifiant), pour l'interface. */
export const shapeView = (id: string): ShapeView | undefined => views.get(id)

type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' | 'rot' | 'a' | 'b'

export class ShapeView implements NodeView {
  dom: HTMLElement
  readonly box: HTMLElement
  private data: ShapeInline
  private rank = 0
  private multi = false
  private selected = false
  private text: HTMLElement | null = null
  private drawn: unknown = null
  private editing = false
  /** Pendant un glissement : la forme montrée (pas encore dans le document). */
  private preview: ShapeInline | null = null

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private hooks: ShapeHooks | undefined,
    decorations: readonly Decoration[],
  ) {
    this.data = node.attrs.data as ShapeInline
    this.dom = document.createElement('span')
    this.dom.className = 'fp-shape'
    this.dom.contentEditable = 'false'
    this.box = document.createElement('span')
    this.box.className = 'fp-shape__box'
    this.dom.append(this.box)
    this.readDecorations(decorations)
    views.set(this.data.id, this)
    this.box.addEventListener('pointerdown', (e) => this.down(e))
    this.box.addEventListener('dblclick', (e) => {
      if (this.editing) return
      e.preventDefault()
      this.startEditing()
    })
    this.render()
  }

  get id(): string {
    return this.data.id
  }

  private readDecorations(decos: readonly Decoration[]): void {
    for (const d of decos) {
      const spec = d.spec as { rank?: number; multi?: boolean }
      if (typeof spec.rank === 'number') this.rank = spec.rank
      if (spec.multi !== undefined) this.multi = spec.multi
    }
  }

  private get theme(): Theme {
    return this.view.state.doc.attrs.theme as Theme
  }

  render(): void {
    const d = this.preview ?? this.data
    const key = [d, this.theme]
    if (!this.preview && this.drawn && (this.drawn as unknown[])[0] === key[0] && (this.drawn as unknown[])[1] === key[1]) {
      this.place()
      return
    }
    this.drawn = this.preview ? null : key
    this.dom.dataset.shape = d.shape
    this.dom.dataset.wrap = d.wrap ?? 'front'
    this.dom.title = this.hooks?.label(d) ?? ''
    this.dom.hidden = !!d.hidden
    if (d.alt) this.dom.setAttribute('aria-label', d.alt)
    this.text = fill(this.box, d, editorPaint(this.theme), this.theme)
    this.drawHandles()
    this.place()
  }

  /** La place de la forme selon son habillage. */
  place(): void {
    // Pendant la construction de l'éditeur, le paragraphe n'est pas encore là : après.
    if (!(this.view as unknown as { docView?: unknown }).docView || !this.dom.isConnected) {
      requestAnimationFrame(() => {
        if (this.dom.isConnected) this.place()
      })
      if (!(this.view as unknown as { docView?: unknown }).docView) return
    }
    const d = this.preview ?? this.data
    const s = this.box.style
    const w = d.width * PX
    const h = d.height * PX
    for (const k of ['position', 'left', 'top', 'float', 'marginLeft', 'marginRight', 'marginTop', 'shapeOutside', 'zIndex'] as const) s[k] = ''
    s.width = `${w}px`
    s.height = `${h}px`
    s.transform = d.rotate ? `rotate(${d.rotate}deg)` : ''
    const wrap = d.wrap ?? 'front'
    this.dom.dataset.wrap = wrap
    if (wrap === 'inline') {
      s.zIndex = String(10 + this.rank)
      return
    }
    const a = this.getPos() !== undefined ? anchorOf(this.view, this.getPos()!) : null
    if (!a) return
    const scale = scaleOf(this.view)
    const cs = getComputedStyle(a.el)
    const padL = parseFloat(cs.paddingLeft) || 0
    const padR = parseFloat(cs.paddingRight) || 0
    const padT = parseFloat(cs.paddingTop) || 0
    // Bord du paragraphe depuis la marge gauche (px de mise en page).
    const offX = (a.el.getBoundingClientRect().left - columnLeft(this.view)) / scale
    const x = d.x * PX - offX
    const y = d.y * PX
    s.position = 'absolute'
    s.left = `${x}px`
    s.top = `${y}px`
    s.zIndex = String(wrap === 'behind' ? -1000 + this.rank : 10 + this.rank)
    if (wrapsText(d)) this.placeWrap(a.el, d, scale)
    void padL
    void padR
    void padT
  }

  /**
   * Habillage carré, haut et bas : une zone invisible de la taille de la forme
   * flotte juste avant le paragraphe (hors de ses lignes) ; tout le texte qui
   * suit passe autour d'elle, dès la ligne qui touche le haut de la forme.
   */
  private placeWrap(para: HTMLElement, d: ShapeInline, scale: number): void {
    const zone = Array.from(para.parentElement?.children ?? []).find((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('fp-shape-wrap') && el.dataset.for === d.id)
    if (!zone) return
    const box = zone.parentElement as HTMLElement
    const cs = getComputedStyle(box)
    const br = box.getBoundingClientRect()
    const innerLeft = (br.left - columnLeft(this.view)) / scale + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0)
    const inner = box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
    const w = d.width * PX
    const h = d.height * PX
    const xi = d.x * PX - innerLeft
    const z = zone.style
    const left = d.wrap === 'topBottom' || xi + w / 2 < inner / 2
    z.float = left ? 'left' : 'right'
    z.height = `${h}px`
    if (d.wrap === 'topBottom') {
      z.width = '100%'
      z.marginLeft = '0px'
      z.marginRight = '0px'
    } else {
      z.width = `${w}px`
      z.marginLeft = left ? `${xi}px` : '0px'
      z.marginRight = left ? '0px' : `${inner - xi - w}px`
    }
    // Le haut de la zone : celui de la forme (y depuis le haut du paragraphe).
    z.marginTop = '0px'
    const natural = zone.getBoundingClientRect().top
    z.marginTop = `${d.y * PX + (para.getBoundingClientRect().top - natural) / scale}px`
  }

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false
    const prev = this.data
    this.node = node
    this.data = node.attrs.data as ShapeInline
    if (prev.id !== this.data.id) {
      if (views.get(prev.id) === this) views.delete(prev.id)
      views.set(this.data.id, this)
    }
    const was = [this.rank, this.multi]
    this.readDecorations(decorations)
    if (was[1] !== this.multi) this.box.classList.toggle('is-multi', this.multi)
    if (this.editing) return true
    this.render()
    return true
  }

  selectNode(): void {
    this.selected = true
    this.box.classList.add('is-selected')
    this.drawHandles()
  }

  deselectNode(): void {
    this.selected = false
    this.box.classList.remove('is-selected')
    this.drawHandles()
  }

  /** Les poignées : huit pour la taille et une pour tourner ; un trait : ses deux bouts. */
  private drawHandles(): void {
    this.box.querySelector('.fp-shape__handles')?.remove()
    if (!this.selected || this.editing) return
    const layer = document.createElement('span')
    layer.className = 'fp-shape__handles'
    const d = this.preview ?? this.data
    const list: Handle[] = d.shape === 'line' ? ['a', 'b'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rot']
    for (const k of list) {
      const el = document.createElement('span')
      el.className = `fp-shape__h fp-shape__h--${k}`
      el.dataset.h = k
      if (k === 'a' || k === 'b') {
        const [fx, fy] = [d.flip?.includes('h') ? 1 : 0, d.flip?.includes('v') ? 1 : 0]
        const at = k === 'a' ? [fx, fy] : [1 - fx, 1 - fy]
        el.style.left = `${at[0] * 100}%`
        el.style.top = `${at[1] * 100}%`
      }
      layer.append(el)
    }
    this.box.append(layer)
  }

  /** Écrire dans la forme : l'interface ouvre un éditeur dans la zone du texte. */
  startEditing(first?: string): void {
    const pos = this.getPos()
    if (pos === undefined || !this.text || !this.view.editable || !this.hooks) return
    this.editing = true
    this.box.classList.add('is-editing')
    this.drawHandles()
    this.hooks.editText(pos, this.text, first)
  }

  /** Fin de l'écriture : la forme se redessine avec son texte. */
  stopEditing(): void {
    if (!this.editing) return
    this.editing = false
    this.box.classList.remove('is-editing')
    this.drawn = null
    this.render()
  }

  get isEditing(): boolean {
    return this.editing
  }

  private down(e: PointerEvent): void {
    if (this.editing && this.text?.contains(e.target as Node)) return
    if (e.button !== 0 || !this.view.editable) return
    const pos = this.getPos()
    if (pos === undefined) return
    e.preventDefault()
    e.stopPropagation()
    const handle = (e.target as HTMLElement).dataset?.h as Handle | undefined
    const state = this.view.state
    const add = e.shiftKey || e.ctrlKey || e.metaKey
    if (add && !handle) {
      toggleMulti(this.view, this.data.id, pos)
      return
    }
    const already = selectedShapes(state).some((s) => s.data.id === this.data.id)
    if (!already || !(state.selection instanceof NodeSelection)) {
      const tr = state.tr.setSelection(NodeSelection.create(state.doc, pos)).setMeta(shapesKey, { multi: already ? (shapesKey.getState(state)?.multi ?? []) : [], grabbed: this.data.id })
      this.view.dispatch(tr)
    } else this.view.dispatch(state.tr.setMeta(shapesKey, { ...shapesKey.getState(state)!, grabbed: this.data.id }))
    this.view.focus()
    if (handle === 'rot') this.dragRotate(e)
    else if (handle === 'a' || handle === 'b') this.dragEnd(e, handle)
    else if (handle) this.dragResize(e, handle)
    else this.dragMove(e)
  }

  /** Suit le pointeur ; `move` reçoit le déplacement en points (repère de la page), `end` à la fin. */
  private track(e: PointerEvent, move: (dx: number, dy: number, ev: PointerEvent) => void, end: (moved: boolean) => void): void {
    // Le cadre de la forme garde le pointeur : ses poignées sont redessinées pendant le glissé.
    const target = this.box
    target.setPointerCapture?.(e.pointerId)
    const scale = scaleOf(this.view)
    const [sx, sy] = [e.clientX, e.clientY]
    let moved = false
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / scale / PX
      const dy = (ev.clientY - sy) / scale / PX
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return
      moved = true
      document.body.classList.add('fp-shape-dragging')
      move(dx, dy, ev)
    }
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('fp-shape-dragging')
      end(moved)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  private showPreview(d: ShapeInline | null): void {
    this.preview = d
    this.drawn = null
    this.render()
  }

  private dragMove(e: PointerEvent): void {
    // Avec Maj+clic, toutes les formes choisies bougent ensemble.
    const moving = selectedShapes(this.view.state)
    const list = moving.some((m) => m.data.id === this.data.id) ? moving : [{ pos: this.getPos()!, node: this.node, data: this.data }]
    if (this.data.wrap === 'inline' && list.length === 1) return this.dragInline(e)
    let last = { dx: 0, dy: 0 }
    this.track(
      e,
      (dx, dy) => {
        last = { dx, dy }
        for (const m of list) {
          const v = views.get(m.data.id)
          if (v && m.data.wrap !== 'inline') v.box.style.translate = `${dx * PX}px ${dy * PX}px`
        }
      },
      (moved) => {
        for (const m of list) {
          const v = views.get(m.data.id)
          if (v) v.box.style.translate = ''
        }
        if (moved) moveShapes(this.view, list.filter((m) => m.data.wrap !== 'inline'), last.dx, last.dy)
      },
    )
  }

  /** Une forme dans le texte se déplace comme un caractère : là où on la lâche. */
  private dragInline(e: PointerEvent): void {
    let at: { x: number; y: number } | null = null
    this.track(
      e,
      (_dx, _dy, ev) => {
        at = { x: ev.clientX, y: ev.clientY }
        this.box.style.opacity = '0.6'
      },
      (moved) => {
        this.box.style.opacity = ''
        const pos = this.getPos()
        if (!moved || !at || pos === undefined) return
        const hit = this.view.posAtCoords({ left: at.x, top: at.y })
        if (!hit || (hit.pos >= pos && hit.pos <= pos + 1)) return
        const node = this.view.state.doc.nodeAt(pos)
        if (!node) return
        let tr = this.view.state.tr.delete(pos, pos + 1)
        const to = tr.mapping.map(hit.pos)
        if (!tr.doc.resolve(to).parent.inlineContent) return
        tr = tr.insert(to, node)
        this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, to)))
      },
    )
  }

  private dragResize(e: PointerEvent, h: Handle): void {
    const d0 = this.data
    const t = ((d0.rotate ?? 0) * Math.PI) / 180
    const [cos, sin] = [Math.cos(t), Math.sin(t)]
    // Une image garde ses proportions par les coins (Maj les libère) ; une forme, avec Maj.
    const pic = d0.shape === 'picture'
    const keepRatio = (ev: PointerEvent) => d0.shape === 'group' || (pic ? !(ev.shiftKey || e.shiftKey) : ev.shiftKey || e.shiftKey)
    let next = d0
    this.track(
      e,
      (dx, dy, ev) => {
        // Le déplacement dans le repère de la forme (tournée).
        const lx = dx * cos + dy * sin
        const ly = -dx * sin + dy * cos
        let [L, T, R, B] = [0, 0, d0.width, d0.height]
        if (h.includes('w')) L = Math.min(lx, R - 2)
        if (h.includes('e')) R = Math.max(R + lx, L + 2)
        if (h.includes('n')) T = Math.min(ly, B - 2)
        if (h.includes('s')) B = Math.max(B + ly, T + 2)
        if (keepRatio(ev) && h.length === 2 && d0.width > 0 && d0.height > 0) {
          const k = Math.max((R - L) / d0.width, (B - T) / d0.height)
          const [nw, nh] = [d0.width * k, d0.height * k]
          if (h.includes('w')) L = R - nw
          else R = L + nw
          if (h.includes('n')) T = B - nh
          else B = T + nh
        }
        const [nw, nh] = [R - L, B - T]
        // Le centre bouge dans le repère de la forme : on le ramène sur la page.
        const cx = (L + R) / 2 - d0.width / 2
        const cy = (T + B) / 2 - d0.height / 2
        const px = d0.x + d0.width / 2 + cx * cos - cy * sin - nw / 2
        const py = d0.y + d0.height / 2 + cx * sin + cy * cos - nh / 2
        next = { ...d0, x: round(px), y: round(py), width: round(nw), height: round(nh), ...(d0.children ? { children: scaleKids(d0.children, nw / (d0.width || 1), nh / (d0.height || 1)) } : {}) }
        this.showPreview(next)
      },
      (moved) => {
        this.preview = null
        if (moved) this.commit(next)
        else this.render()
      },
    )
  }

  private dragRotate(e: PointerEvent): void {
    const r = this.box.getBoundingClientRect()
    const [cx, cy] = [r.left + r.width / 2, r.top + r.height / 2]
    let next = this.data
    this.track(
      e,
      (_dx, _dy, ev) => {
        let a = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90
        if (ev.shiftKey) a = Math.round(a / 15) * 15
        a = ((Math.round(a) % 360) + 360) % 360
        next = { ...this.data, rotate: a }
        if (!a) delete next.rotate
        this.showPreview(next)
      },
      (moved) => {
        this.preview = null
        if (moved) this.commit(next)
        else this.render()
      },
    )
  }

  /** Un bout d'un trait : l'autre bout reste en place. */
  private dragEnd(e: PointerEvent, which: 'a' | 'b'): void {
    const d0 = this.data
    const fh = d0.flip?.includes('h')
    const fv = d0.flip?.includes('v')
    const A = { x: d0.x + (fh ? d0.width : 0), y: d0.y + (fv ? d0.height : 0) }
    const B = { x: d0.x + (fh ? 0 : d0.width), y: d0.y + (fv ? 0 : d0.height) }
    let next = d0
    this.track(
      e,
      (dx, dy, ev) => {
        const p = which === 'a' ? { x: A.x + dx, y: A.y + dy } : { x: B.x + dx, y: B.y + dy }
        const q = which === 'a' ? B : A
        // Maj : horizontal, vertical ou à 45°.
        if (ev.shiftKey) {
          const ang = Math.round(Math.atan2(p.y - q.y, p.x - q.x) / (Math.PI / 4)) * (Math.PI / 4)
          const len = Math.hypot(p.x - q.x, p.y - q.y)
          p.x = q.x + Math.cos(ang) * len
          p.y = q.y + Math.sin(ang) * len
        }
        const [s, f] = which === 'a' ? [p, q] : [q, p]
        const flip = `${s.x > f.x ? 'h' : ''}${s.y > f.y ? 'v' : ''}` as ShapeInline['flip'] | ''
        next = { ...d0, x: round(Math.min(s.x, f.x)), y: round(Math.min(s.y, f.y)), width: round(Math.abs(f.x - s.x)), height: round(Math.abs(f.y - s.y)) }
        delete next.rotate
        if (flip) next.flip = flip
        else delete next.flip
        this.showPreview(next)
      },
      (moved) => {
        this.preview = null
        if (moved) this.commit(next)
        else this.render()
      },
    )
  }

  private commit(next: ShapeInline): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const tr = this.view.state.tr.setNodeMarkup(pos, null, { data: next })
    this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)))
  }

  stopEvent(e: Event): boolean {
    // Pendant l'écriture, l'éditeur de la forme reçoit tout ; sinon la forme gère la souris.
    if (this.editing) return true
    return /^(pointer|mouse|dblclick|click|drag)/.test(e.type)
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    if (views.get(this.data.id) === this) views.delete(this.data.id)
  }
}

/** Les formes d'un groupe agrandi : positions et tailles à l'échelle. */
function scaleKids(kids: ShapeInline[], kx: number, ky: number): ShapeInline[] {
  return kids.map((c) => ({ ...c, x: round(c.x * kx), y: round(c.y * ky), width: round(c.width * kx), height: round(c.height * ky), ...(c.children ? { children: scaleKids(c.children, kx, ky) } : {}) }))
}

// --- commandes ----------------------------------------------------------------------------

/** Ajoute ou retire une forme de la sélection multiple (Maj+clic). */
export function toggleMulti(view: EditorView, id: string, pos: number): void {
  const state = view.state
  const cur = new Set(selectedShapes(state).map((s) => s.data.id))
  if (cur.has(id)) cur.delete(id)
  else cur.add(id)
  const list = [...cur]
  let tr = state.tr
  // La sélection de nœud : la dernière forme ajoutée (ou une qui reste).
  const keep = cur.has(id) ? { id, pos } : (() => {
    const other = allShapes(state.doc).find((s) => cur.has(s.data.id))
    return other ? { id: other.data.id, pos: other.pos } : null
  })()
  if (keep) tr = tr.setSelection(NodeSelection.create(state.doc, keep.pos))
  else tr = tr.setSelection(TextSelection.near(state.doc.resolve(pos)))
  view.dispatch(tr.setMeta(shapesKey, { multi: list, grabbed: keep?.id ?? null }))
}

/** Remplace des formes (fonction appliquée à chacune ; null : retirée), une seule étape. */
export function updateShapes(view: EditorView, refs: ShapeRef[], fn: (d: ShapeInline) => ShapeInline | null): void {
  if (!refs.length) return
  const tr = view.state.tr
  const sel = view.state.selection
  for (const r of [...refs].sort((a, b) => b.pos - a.pos)) {
    const next = fn(r.data)
    if (next) tr.setNodeMarkup(r.pos, null, { data: next })
    else tr.delete(r.pos, r.pos + 1)
  }
  if (sel instanceof NodeSelection && tr.doc.nodeAt(tr.mapping.map(sel.from))?.type === n.shape) tr.setSelection(NodeSelection.create(tr.doc, tr.mapping.map(sel.from)))
  view.dispatch(tr)
}

/** Où raccrocher une forme dont le haut est à `clientY` : le paragraphe, et y depuis son haut (pt). */
function reanchor(view: EditorView, clientX: number, clientY: number): { pos: number; y: number } | null {
  const t = textblockAt(view, clientX, clientY)
  if (!t) return null
  return { pos: t.pos, y: ((clientY - t.el.getBoundingClientRect().top) / scaleOf(view)) / PX }
}

/**
 * Déplace des formes de (dx, dy) points ; chacune se raccroche au paragraphe où
 * tombe son haut (comme d'habitude : la forme suit alors ce paragraphe).
 */
export function moveShapes(view: EditorView, refs: ShapeRef[], dx: number, dy: number): void {
  if (!refs.length) return
  const scale = scaleOf(view)
  const colLeft = columnLeft(view)
  const plans = refs.map((r) => {
    const a = anchorOf(view, r.pos)
    const next = { ...r.data, x: round(r.data.x + dx), y: round(r.data.y + dy) }
    if (!a) return { r, next, to: null as null | { pos: number; y: number } }
    const top = a.el.getBoundingClientRect().top + next.y * PX * scale
    const to = reanchor(view, colLeft + 4, top)
    return { r, next, to: to && to.pos !== a.pos ? to : null }
  })
  let tr = view.state.tr
  const keepId = shapeAt(view.state)?.data.id
  for (const p of [...plans].sort((a, b) => b.r.pos - a.r.pos)) {
    const at = tr.mapping.map(p.r.pos)
    if (!p.to) {
      tr = tr.setNodeMarkup(at, null, { data: p.next })
      continue
    }
    const data = { ...p.next, y: round(p.to.y) }
    tr = tr.delete(at, at + 1)
    const dest = tr.mapping.map(p.to.pos) + 1
    tr = tr.insert(dest, n.shape.create({ data }))
  }
  // La forme principale reste sélectionnée.
  const main = allShapes(tr.doc).find((s) => s.data.id === keepId)
  if (main) tr = tr.setSelection(NodeSelection.create(tr.doc, main.pos))
  view.dispatch(tr.setMeta(shapesKey, { multi: shapesKey.getState(view.state)?.multi ?? [], grabbed: keepId ?? null }))
}

/**
 * Insère une forme au début du paragraphe `paraPos` ; elle est sélectionnée. Pas de défilement :
 * la forme est là où on la voit (le début de son paragraphe peut être bien plus haut).
 */
export function insertShapeAt(view: EditorView, paraPos: number, data: ShapeInline): void {
  const tr = view.state.tr.insert(paraPos + 1, n.shape.create({ data }))
  view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, paraPos + 1)).setMeta(shapesKey, { multi: [], grabbed: data.id }))
}

// --- images libres ---------------------------------------------------------------------

/** L'habillage d'une image du texte, pour la même image placée librement. */
const FIGURE_WRAP: Record<string, ShapeInline['wrap']> = { none: 'topBottom', left: 'square', right: 'square', tight: 'square', through: 'square', behind: 'behind', front: 'front' }

/** Les paragraphes et titres (hors tableaux) juste avant et juste après `pos`. */
function textblocksAround(doc: PMNode, pos: number): { before: number | null; after: number | null } {
  let before: number | null = null
  let after: number | null = null
  doc.descendants((node, p, parent) => {
    if (after !== null) return false
    if (node.type.spec.tableRole) return false
    if (node.type === n.paragraph || node.type === n.heading) {
      if (!parent?.type.spec.tableRole) {
        if (p < pos) before = p
        else after = p
      }
      return false
    }
    return !node.isTextblock && !node.isAtom
  })
  return { before, after }
}

/**
 * L'image du texte à `pos` devient une image libre, à la même place sur la page ;
 * sa légende reste dans le texte. Elle est sélectionnée. false : impossible.
 */
export function figureToPicture(view: EditorView, pos: number, id: string, z: number, wrap?: ShapeInline['wrap']): boolean {
  const fig = view.state.doc.nodeAt(pos)
  if (!fig || fig.type !== n.figure || !fig.attrs.src) return false
  const a = fig.attrs
  const frame = (view.nodeDOM(pos) as HTMLElement | null)?.querySelector('.fp-figure__frame') as HTMLElement | null
  if (!frame) return false
  const scale = scaleOf(view)
  const r = frame.getBoundingClientRect()
  const rot = Number(a.rotate) || 0
  let [w, h] = [r.width / scale / PX, r.height / scale / PX]
  if (rot === 90 || rot === 270) [w, h] = [h, w]
  const cx = (r.left + r.width / 2 - columnLeft(view)) / scale / PX
  const around = textblocksAround(view.state.doc, pos)
  // Une étape à part dans l'historique (Ctrl+Z la défait seule).
  let tr = closeHistory(view.state.tr)
  // La légende reste dans le texte, à la place de l'image.
  if (fig.content.size) tr = tr.replaceWith(pos, pos + fig.nodeSize, n.paragraph.create(null, fig.content))
  else tr = tr.delete(pos, pos + fig.nodeSize)
  let para: number
  let cy: number
  if (around.before !== null) {
    // Le paragraphe d'avant ne bouge pas : la même hauteur sur la page.
    const el = view.nodeDOM(around.before) as HTMLElement | null
    if (!el) return false
    para = around.before
    cy = (r.top + r.height / 2 - el.getBoundingClientRect().top) / scale / PX
  } else {
    // Le texte d'après remonte à la place de l'image.
    para = fig.content.size ? pos : around.after !== null ? tr.mapping.map(around.after) : -1
    cy = r.height / scale / PX / 2
    if (para < 0) {
      tr = tr.insert(pos, n.paragraph.create())
      para = pos
    }
  }
  const data: ShapeInline = {
    type: 'shape',
    shape: 'picture',
    id,
    x: round(cx - w / 2),
    y: round(cy - h / 2),
    width: round(w),
    height: round(h),
    wrap: wrap ?? FIGURE_WRAP[a.wrap as string] ?? 'square',
    z,
    src: a.src as string,
    ...(a.assetId ? { assetId: a.assetId as string } : {}),
    fill: 'none',
    line: (a.border as string | null) ?? 'none',
    lineWidth: 1,
    ...(rot ? { rotate: rot } : {}),
    ...(a.flip ? { flip: a.flip as ShapeInline['flip'] } : {}),
    ...(a.crop ? { crop: { ...(a.crop as object) } as ShapeInline['crop'] } : {}),
    ...(a.adjust ? { adjust: { ...(a.adjust as object) } } : {}),
    ...(a.alt ? { alt: a.alt as string } : {}),
  }
  // `para` est déjà une position du document modifié (avant l'image, ou à sa place).
  tr = tr.insert(para + 1, n.shape.create({ data }))
  // Pas de défilement : l'image reste à sa place à l'écran.
  view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, para + 1)).setMeta(shapesKey, { multi: [], grabbed: id }))
  return true
}

/** Une image libre revient dans le texte (après son paragraphe), comme image ordinaire. */
export function pictureToFigure(view: EditorView, ref: ShapeRef): boolean {
  const d = ref.data
  if (d.shape !== 'picture' || !d.src) return false
  const rot = (((Math.round((d.rotate ?? 0) / 90) * 90) % 360) + 360) % 360
  // Étirée exprès ? (les proportions de l'image rognée, comparées à celles du cadre)
  const img = views.get(d.id)?.box.querySelector('img')
  const c = { top: 0, right: 0, bottom: 0, left: 0, ...(d.crop ?? {}) }
  const natural = img?.naturalWidth ? ((img.naturalHeight / img.naturalWidth) * (100 - c.top - c.bottom)) / (100 - c.left - c.right) : 0
  const stretched = !!natural && d.width > 0 && Math.abs(d.height / d.width - natural) / natural > 0.02
  const figure = n.figure.create({
    src: d.src,
    assetId: d.assetId ?? null,
    alt: d.alt ?? '',
    width: round(d.width),
    height: stretched ? round(d.height) : 0,
    align: 'center',
    wrap: 'none',
    crop: d.crop ? { ...c } : null,
    rotate: rot,
    flip: d.flip ?? null,
    border: d.line && d.line !== 'none' ? d.line : null,
    adjust: d.adjust ? { ...d.adjust } : null,
  })
  const $p = view.state.doc.resolve(ref.pos)
  let tr = closeHistory(view.state.tr).delete(ref.pos, ref.pos + 1)
  let at = tr.mapping.map($p.after())
  const $at = tr.doc.resolve(at)
  if (!$at.parent.canReplaceWith($at.index(), $at.index(), n.figure)) at = tr.mapping.map($p.after(1))
  tr = tr.insert(at, figure)
  view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)).setMeta(shapesKey, { multi: [], grabbed: null }).scrollIntoView())
  return true
}

/** Un identifiant de forme libre dans ce document. */
export function freshShapeId(doc: PMNode): string {
  const used = new Set<string>()
  const walk = (d: ShapeInline) => {
    used.add(d.id)
    d.children?.forEach(walk)
  }
  for (const s of allShapes(doc)) walk(s.data)
  let k = used.size + 1
  while (used.has(`shape${k}`)) k++
  return `shape${k}`
}

// --- ordre de superposition -------------------------------------------------------------

export type StackMove = 'forward' | 'backward' | 'front' | 'back'

/** Avancer, reculer, mettre au premier plan, à l'arrière-plan : les rangs deviennent les nouveaux z. */
export function restack(view: EditorView, refs: ShapeRef[], how: StackMove): void {
  const all = allShapes(view.state.doc)
  const ranks = stackRanks(view.state.doc)
  const order = [...all].sort((a, b) => ranks.get(a.data.id)! - ranks.get(b.data.id)!)
  const ids = new Set(refs.map((r) => r.data.id))
  let list = order.map((s) => s.data.id)
  if (how === 'front') list = [...list.filter((i) => !ids.has(i)), ...list.filter((i) => ids.has(i))]
  else if (how === 'back') list = [...list.filter((i) => ids.has(i)), ...list.filter((i) => !ids.has(i))]
  else if (how === 'forward') {
    for (let i = list.length - 2; i >= 0; i--) if (ids.has(list[i]) && !ids.has(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]]
  } else for (let i = 1; i < list.length; i++) if (ids.has(list[i]) && !ids.has(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]]
  const z = new Map(list.map((id, i) => [id, i]))
  const changed = all.filter((s) => (s.data.z ?? 0) !== z.get(s.data.id) || s.data.z === undefined)
  updateShapes(view, changed, (d) => ({ ...d, z: z.get(d.id)! }))
}

// --- habillage, rotation, position -------------------------------------------------------

/** Change l'habillage ; une forme sortie du texte reste où elle se voit, au début de son paragraphe. */
export function setWrap(view: EditorView, refs: ShapeRef[], wrap: NonNullable<ShapeInline['wrap']>): void {
  if (!refs.length) return
  let tr = view.state.tr
  const scale = scaleOf(view)
  const colLeft = columnLeft(view)
  for (const r of [...refs].sort((a, b) => b.pos - a.pos)) {
    const at = tr.mapping.map(r.pos)
    const next: ShapeInline = { ...r.data, wrap }
    const a = anchorOf(view, r.pos)
    if (r.data.wrap === 'inline' && wrap !== 'inline' && a) {
      // Là où elle est affichée dans la ligne.
      const box = views.get(r.data.id)?.box.getBoundingClientRect()
      if (box) {
        next.x = round(((box.left - colLeft) / scale) / PX)
        next.y = round(((box.top - a.el.getBoundingClientRect().top) / scale) / PX)
      }
      const start = tr.mapping.map(a.pos) + 1
      if (at !== start) {
        tr = tr.delete(at, at + 1).insert(tr.mapping.map(a.pos) + 1, n.shape.create({ data: next }))
        continue
      }
    }
    tr = tr.setNodeMarkup(at, null, { data: next })
  }
  const keep = shapeAt(view.state)?.data.id
  const main = allShapes(tr.doc).find((s) => s.data.id === keep)
  if (main) tr = tr.setSelection(NodeSelection.create(tr.doc, main.pos))
  view.dispatch(tr)
}

/** Faire pivoter de 90° (à droite, à gauche) ou retourner. */
export function rotateShapes(view: EditorView, refs: ShapeRef[], how: 'right' | 'left' | 'flipH' | 'flipV'): void {
  updateShapes(view, refs, (d) => {
    const next = { ...d }
    if (how === 'right' || how === 'left') {
      const a = (((d.rotate ?? 0) + (how === 'right' ? 90 : -90)) % 360 + 360) % 360
      if (a) next.rotate = a
      else delete next.rotate
    } else {
      const k = how === 'flipH' ? 'h' : 'v'
      const has = new Set((d.flip ?? '').split(''))
      if (has.has(k)) has.delete(k)
      else has.add(k)
      const f = ['h', 'v'].filter((x) => has.has(x)).join('') as ShapeInline['flip'] | ''
      if (f) next.flip = f
      else delete next.flip
    }
    return next
  })
}

export const POSITIONS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'] as const
export type PositionPreset = (typeof POSITIONS)[number]

/** Place une forme à l'un des neuf endroits de la page (dans les marges), le texte autour. */
export function positionShape(view: EditorView, ref: ShapeRef, where: PositionPreset): void {
  const a = anchorOf(view, ref.pos)
  if (!a) return
  const scale = scaleOf(view)
  const area = pageArea(view, a.el.getBoundingClientRect().top)
  const w = ref.data.width * PX * scale
  const h = ref.data.height * PX * scale
  const col = where[1] === 'l' ? area.left : where[1] === 'c' ? (area.left + area.right - w) / 2 : area.right - w
  const row = where[0] === 't' ? area.top : where[0] === 'm' ? (area.top + area.bottom - h) / 2 : area.bottom - h
  const x = round(((col - area.left) / scale) / PX)
  const to = reanchor(view, area.left + 4, row)
  const data: ShapeInline = { ...ref.data, x, wrap: 'square' }
  let tr = view.state.tr
  if (to && to.pos !== a.pos) {
    data.y = round(to.y)
    tr = tr.delete(ref.pos, ref.pos + 1)
    const dest = tr.mapping.map(to.pos) + 1
    tr = tr.insert(dest, n.shape.create({ data }))
    view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, dest)))
    return
  }
  data.y = round(((row - a.el.getBoundingClientRect().top) / scale) / PX)
  tr = tr.setNodeMarkup(ref.pos, null, { data })
  view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, ref.pos)))
}

export type AlignHow = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distributeH' | 'distributeV'

/**
 * Aligner ou répartir : par rapport aux formes choisies (plusieurs), sinon à la
 * marge (une seule forme). Les positions se calculent dans le repère commun.
 */
export function alignShapes(view: EditorView, refs: ShapeRef[], how: AlignHow, to: 'selection' | 'margin' | 'page' = refs.length > 1 ? 'selection' : 'margin'): void {
  const items = refs.map((r) => ({ r, p: pagePoint(view, r) })).filter((x): x is { r: ShapeRef; p: { x: number; y: number } } => !!x.p && x.r.data.wrap !== 'inline')
  if (!items.length) return
  const box = (i: (typeof items)[number]) => ({ l: i.p.x, t: i.p.y, r: i.p.x + i.r.data.width, b: i.p.y + i.r.data.height })
  let frame: { l: number; t: number; r: number; b: number }
  if (to === 'selection' && items.length > 1) {
    const bs = items.map(box)
    frame = { l: Math.min(...bs.map((b) => b.l)), t: Math.min(...bs.map((b) => b.t)), r: Math.max(...bs.map((b) => b.r)), b: Math.max(...bs.map((b) => b.b)) }
  } else {
    const scale = scaleOf(view)
    const first = anchorOf(view, items[0].r.pos)
    const area = pageArea(view, first ? first.el.getBoundingClientRect().top : 0)
    const top0 = (view.dom as HTMLElement).getBoundingClientRect().top
    const toPt = (v: number) => v / scale / PX
    const left = to === 'page' ? area.pageLeft : area.left
    frame = {
      l: toPt(left - area.left),
      r: toPt((to === 'page' ? area.pageRight : area.right) - area.left),
      t: toPt((to === 'page' ? area.pageTop : area.top) - top0),
      b: toPt((to === 'page' ? area.pageBottom : area.bottom) - top0),
    }
  }
  const target = new Map<string, { x: number; y: number }>()
  if (how === 'distributeH' || how === 'distributeV') {
    const horiz = how === 'distributeH'
    const sorted = [...items].sort((a, b) => (horiz ? a.p.x - b.p.x : a.p.y - b.p.y))
    const size = (i: (typeof items)[number]) => (horiz ? i.r.data.width : i.r.data.height)
    const span = items.length > 2 || to === 'selection' ? [horiz ? sorted[0].p.x : sorted[0].p.y, horiz ? box(sorted[sorted.length - 1]).r : box(sorted[sorted.length - 1]).b] : horiz ? [frame.l, frame.r] : [frame.t, frame.b]
    const free = span[1] - span[0] - sorted.reduce((s, i) => s + size(i), 0)
    const gap = sorted.length > 1 ? free / (sorted.length - 1) : 0
    let at = span[0]
    for (const i of sorted) {
      target.set(i.r.data.id, horiz ? { x: at, y: i.p.y } : { x: i.p.x, y: at })
      at += size(i) + gap
    }
  } else {
    for (const i of items) {
      const d = i.r.data
      let { x, y } = i.p
      if (how === 'left') x = frame.l
      if (how === 'center') x = (frame.l + frame.r - d.width) / 2
      if (how === 'right') x = frame.r - d.width
      if (how === 'top') y = frame.t
      if (how === 'middle') y = (frame.t + frame.b - d.height) / 2
      if (how === 'bottom') y = frame.b - d.height
      target.set(d.id, { x, y })
    }
  }
  // Retour au repère de chaque forme : y depuis son paragraphe ; elles peuvent changer de paragraphe.
  const scale = scaleOf(view)
  const top0 = (view.dom as HTMLElement).getBoundingClientRect().top
  const colLeft = columnLeft(view)
  let tr = view.state.tr
  for (const i of [...items].sort((a, b) => b.r.pos - a.r.pos)) {
    const tg = target.get(i.r.data.id)!
    const dy = tg.y - i.p.y
    const at = tr.mapping.map(i.r.pos)
    const data = { ...i.r.data, x: round(tg.x), y: round(i.r.data.y + dy) }
    const to2 = reanchor(view, colLeft + 4, top0 + tg.y * PX * scale)
    const anchor = anchorOf(view, i.r.pos)
    if (to2 && anchor && to2.pos !== anchor.pos) {
      data.y = round(to2.y)
      tr = tr.delete(at, at + 1)
      tr = tr.insert(tr.mapping.map(to2.pos) + 1, n.shape.create({ data }))
    } else tr = tr.setNodeMarkup(at, null, { data })
  }
  const keep = shapeAt(view.state)?.data.id
  const main = allShapes(tr.doc).find((s) => s.data.id === keep)
  if (main) tr = tr.setSelection(NodeSelection.create(tr.doc, main.pos))
  view.dispatch(tr.setMeta(shapesKey, { multi: shapesKey.getState(view.state)?.multi ?? [], grabbed: keep ?? null }))
}

// --- groupes -------------------------------------------------------------------------------

/** Grouper les formes choisies (au moins deux, hors du texte) : le groupe prend la place de la plus haute. */
export function groupShapes(view: EditorView, refs: ShapeRef[]): boolean {
  const items = refs.filter((r) => r.data.wrap !== 'inline').map((r) => ({ r, p: pagePoint(view, r) })).filter((x): x is { r: ShapeRef; p: { x: number; y: number } } => !!x.p)
  if (items.length < 2) return false
  const l = Math.min(...items.map((i) => i.p.x))
  const t = Math.min(...items.map((i) => i.p.y))
  const r = Math.max(...items.map((i) => i.p.x + i.r.data.width))
  const b = Math.max(...items.map((i) => i.p.y + i.r.data.height))
  const top = items.reduce((a, c) => (c.p.y < a.p.y ? c : a))
  const ranks = stackRanks(view.state.doc)
  const children = [...items]
    .sort((a, c) => ranks.get(a.r.data.id)! - ranks.get(c.r.data.id)!)
    .map((i) => {
      const c: ShapeInline = { ...i.r.data, x: round(i.p.x - l), y: round(i.p.y - t) }
      delete c.wrap
      delete c.z
      return c
    })
  const group: ShapeInline = {
    type: 'shape',
    shape: 'group',
    id: freshShapeId(view.state.doc),
    x: round(l),
    y: round(top.r.data.y - (top.p.y - t)),
    width: round(r - l),
    height: round(b - t),
    wrap: top.r.data.wrap ?? 'front',
    z: Math.max(...items.map((i) => i.r.data.z ?? 0)),
    children,
  }
  let tr = view.state.tr
  const anchorPos = top.r.pos
  for (const i of [...items].sort((a, c) => c.r.pos - a.r.pos)) if (i.r.pos !== anchorPos) tr = tr.delete(tr.mapping.map(i.r.pos), tr.mapping.map(i.r.pos) + 1)
  const at = tr.mapping.map(anchorPos)
  tr = tr.setNodeMarkup(at, null, { data: group })
  view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)).setMeta(shapesKey, { multi: [], grabbed: group.id }))
  return true
}

/** Dissocier un groupe : ses formes reviennent, à la même place (rotation du groupe comprise). */
export function ungroupShape(view: EditorView, ref: ShapeRef): boolean {
  const g = ref.data
  if (g.shape !== 'group' || !g.children?.length) return false
  const t = ((g.rotate ?? 0) * Math.PI) / 180
  const [cx, cy] = [g.width / 2, g.height / 2]
  const kids = g.children.map((c, i) => {
    // Centre de la forme, tourné avec le groupe autour du centre du groupe.
    let [kx, ky] = [c.x + c.width / 2 - cx, c.y + c.height / 2 - cy]
    if (g.flip?.includes('h')) kx = -kx
    if (g.flip?.includes('v')) ky = -ky
    const [rx, ry] = [kx * Math.cos(t) - ky * Math.sin(t), kx * Math.sin(t) + ky * Math.cos(t)]
    const out: ShapeInline = { ...c, x: round(g.x + cx + rx - c.width / 2), y: round(g.y + cy + ry - c.height / 2), wrap: g.wrap ?? 'front', z: (g.z ?? 0) + i }
    const rot = (((c.rotate ?? 0) + (g.rotate ?? 0)) % 360 + 360) % 360
    if (rot) out.rotate = rot
    else delete out.rotate
    return out
  })
  const tr = view.state.tr.replaceWith(ref.pos, ref.pos + 1, kids.map((k) => n.shape.create({ data: k })))
  view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, ref.pos)).setMeta(shapesKey, { multi: kids.map((k) => k.id), grabbed: kids[0].id }))
  return true
}

// --- le greffon ----------------------------------------------------------------------------

/** Garde un identifiant unique à chaque forme (collage, duplication). */
function uniqueIds(tr: Transaction): Transaction | null {
  const seen = new Set<string>()
  let fix: Transaction | null = null
  const all = allShapes(tr.doc)
  const ids = new Set<string>()
  const walk = (d: ShapeInline) => {
    ids.add(d.id)
    d.children?.forEach(walk)
  }
  all.forEach((s) => walk(s.data))
  let k = ids.size + 1
  const fresh = () => {
    while (ids.has(`shape${k}`)) k++
    ids.add(`shape${k}`)
    return `shape${k}`
  }
  const renew = (d: ShapeInline, top: boolean): ShapeInline => {
    const out = { ...d }
    if (seen.has(d.id)) out.id = fresh()
    seen.add(out.id)
    if (d.children) out.children = d.children.map((c) => renew(c, false))
    void top
    return out
  }
  for (const s of all) {
    const next = renew(s.data, true)
    if (JSON.stringify(next) !== JSON.stringify(s.data)) {
      fix ??= tr.setMeta('addToHistory', true)
      fix.setNodeMarkup(s.pos, null, { data: next })
    }
  }
  return fix
}

/** Un nouveau collage contient-il une forme ? */
const pastesShape = (tr: Transaction) =>
  tr.steps.some((st) => {
    const slice = (st as unknown as { slice?: { content: { descendants: (f: (n: PMNode) => boolean | void) => void } } }).slice
    let found = false
    slice?.content.descendants((node) => {
      if (node.type === n.shape) found = true
      return !found
    })
    return found
  })

export function shapesPlugin(_hooks: ShapeHooks | undefined): Plugin {
  let frame = 0
  const placeAll = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      for (const v of views.values()) v.place()
    })
  }
  return new Plugin<ShapesState>({
    key: shapesKey,
    state: {
      init: () => ({ multi: [], grabbed: null }),
      apply: (tr, prev) => {
        const meta = tr.getMeta(shapesKey) as ShapesState | undefined
        if (meta) return meta
        if (!tr.selectionSet) return prev
        // La sélection a changé autrement : seule la forme de la sélection de nœud reste prise.
        const sel = tr.selection
        const id = sel instanceof NodeSelection && sel.node.type === n.shape ? (sel.node.attrs.data as ShapeInline).id : null
        return { multi: [], grabbed: id && id === prev.grabbed ? id : null }
      },
    },
    appendTransaction: (trs, _old, state) => (trs.some((t) => t.docChanged && pastesShape(t)) ? uniqueIds(state.tr) : null),
    view: () => ({
      update: (view, prev) => {
        if (view.state.doc !== prev.doc || view.state.doc.attrs.theme !== prev.doc.attrs.theme) placeAll()
      },
      destroy: () => cancelAnimationFrame(frame),
    }),
    props: {
      decorations: (state) => {
        const all = allShapes(state.doc)
        if (!all.length) return DecorationSet.empty
        const ranks = stackRanks(state.doc)
        const multi = new Set(shapesKey.getState(state)?.multi ?? [])
        const decos: Decoration[] = []
        const anchors = new Set<number>()
        for (const s of all) {
          decos.push(Decoration.node(s.pos, s.pos + 1, {}, { rank: ranks.get(s.data.id) ?? 0, multi: multi.has(s.data.id) }))
          if (s.data.wrap !== 'inline') {
            const $p = state.doc.resolve(s.pos)
            if ($p.depth > 0) anchors.add($p.before())
          }
        }
        // Habillage carré ou haut et bas : une zone invisible juste avant le paragraphe.
        for (const sh of all) {
          if (!wrapsText(sh.data) || sh.data.hidden) continue
          const $p = state.doc.resolve(sh.pos)
          if ($p.depth === 0) continue
          const id = sh.data.id
          decos.push(
            Decoration.widget(
              $p.before(),
              () => {
                const el = document.createElement('div')
                el.className = 'fp-shape-wrap'
                el.dataset.for = id
                el.setAttribute('aria-hidden', 'true')
                el.contentEditable = 'false'
                return el
              },
              { key: `shape-wrap-${id}`, side: -1, ignoreSelection: true },
            ),
          )
        }
        // Les paragraphes d'ancrage : repère des formes placées (position relative).
        for (const at of anchors) {
          const node = state.doc.nodeAt(at)
          if (node) decos.push(Decoration.node(at, at + node.nodeSize, { class: 'fp-anchor' }))
        }
        return DecorationSet.create(state.doc, decos)
      },
      handleKeyDown: (view, e) => {
        const ref = shapeAt(view.state)
        if (!ref) return false
        const st = shapesKey.getState(view.state)
        const v = views.get(ref.data.id)
        if (e.key === 'Escape') {
          const after = TextSelection.near(view.state.doc.resolve(ref.pos + 1))
          view.dispatch(view.state.tr.setSelection(after))
          return true
        }
        if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
          const all = allShapes(view.state.doc).filter((s) => !s.data.hidden)
          const i = all.findIndex((s) => s.data.id === ref.data.id)
          const next = all[(i + (e.shiftKey ? all.length - 1 : 1)) % all.length]
          if (!next) return false
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, next.pos)).setMeta(shapesKey, { multi: [], grabbed: next.data.id }).scrollIntoView())
          return true
        }
        if ((e.key === 'Enter' || e.key === 'F2') && v && holdsText(ref.data)) {
          v.startEditing()
          return true
        }
        const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
        if (arrows[e.key] && ref.data.wrap !== 'inline' && st?.grabbed === ref.data.id && !e.altKey) {
          const k = e.shiftKey ? 10 : 1
          const list = selectedShapes(view.state).filter((s) => s.data.wrap !== 'inline')
          moveShapes(view, list.length ? list : [ref], arrows[e.key][0] * k, arrows[e.key][1] * k)
          return true
        }
        // Une lettre : on écrit dans la forme.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && v && holdsText(ref.data) && st?.grabbed === ref.data.id) {
          e.preventDefault()
          v.startEditing(e.key)
          return true
        }
        return false
      },
    },
  })
}

/** Toutes les formes sont-elles hors du texte (pour grouper, aligner) ? */
export const floating = (refs: ShapeRef[]): ShapeRef[] => refs.filter((r) => r.data.wrap !== 'inline')
/** Aucune forme sélectionnée ne tient du texte (trait, groupe). */
export const holdsText = (d: ShapeInline): boolean => !isLineKind(d.shape) && d.shape !== 'group' && d.shape !== 'picture'
/** Le paragraphe sous un point, pour une nouvelle forme ; y depuis son haut (pt). */
export function placeFor(view: EditorView, clientX: number, clientY: number): { para: number; x: number; y: number } | null {
  const t = textblockAt(view, clientX, clientY)
  if (!t) return null
  const scale = scaleOf(view)
  return { para: t.pos, x: round(((clientX - columnLeft(view)) / scale) / PX), y: round(((clientY - t.el.getBoundingClientRect().top) / scale) / PX) }
}
