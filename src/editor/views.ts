// Vues de nœuds : images (redimensionnement, rognage, rotation, légende),
// champs (valeur calculée), tableaux (attributs de style sur <table>).

import { adjustCss } from '../format/picture'
import { closeHistory } from 'prosemirror-history'
import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, Plugin, PluginKey, type EditorState } from 'prosemirror-state'
import { TableView } from 'prosemirror-tables'
import { Decoration, DecorationSet, type EditorView, type NodeView, type ViewMutationRecord } from 'prosemirror-view'
import { cssColor } from '../format/color'
import { fieldValue, type FieldContext } from '../format/fields'
import type { Crop, FieldName, PictureAdjust } from '../format/types'
import { tableDOMAttrs } from './schema'
import { applyInnerBreaks } from '../layout/pages'

// --- images ---------------------------------------------------------------

export interface FigureHooks {
  /** Texte de l'interface (traduit). */
  label: (key: 'imageMissing' | 'imageExternal' | 'imageLoad' | 'imageLoadFailed' | 'captionPlaceholder' | 'imageBroken', params?: Record<string, string>) => string
  /** Charge une image externe et renvoie son URI data:, à la demande de l'utilisateur. */
  fetchImage: (url: string) => Promise<string>
  /** Facteur de zoom de la page (pour convertir les déplacements de la souris). */
  zoom: () => number
}

const PT_PER_PX = 0.75

export class FigureView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private frame: HTMLElement
  private inner: HTMLElement
  private img: HTMLImageElement
  private placeholder: HTMLElement
  private natural: { w: number; h: number } | null = null
  private resizing = false
  /** Rognage à la souris (comme dans les traitements de texte habituels). */
  private cropping = false
  private cropUi: HTMLElement | null = null
  private cropOff: (() => void) | null = null

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private hooks: FigureHooks,
  ) {
    this.dom = document.createElement('figure')
    this.dom.className = 'fp-figure'
    this.frame = document.createElement('div')
    this.frame.className = 'fp-figure__frame'
    this.frame.contentEditable = 'false'
    this.inner = document.createElement('div')
    this.inner.className = 'fp-figure__inner'
    this.img = document.createElement('img')
    this.img.draggable = false
    this.img.addEventListener('load', () => {
      this.natural = { w: this.img.naturalWidth || 1, h: this.img.naturalHeight || 1 }
      this.dom.classList.remove('is-broken')
      this.layout()
    })
    this.img.addEventListener('error', () => {
      if (this.img.getAttribute('src')) this.dom.classList.add('is-broken')
    })
    this.placeholder = document.createElement('div')
    this.placeholder.className = 'fp-figure__placeholder'
    this.inner.append(this.img)
    this.frame.append(this.inner, this.placeholder)
    for (const corner of ['nw', 'ne', 'sw', 'se', 'e', 'w']) {
      const h = document.createElement('span')
      h.className = `fp-figure__handle fp-figure__handle--${corner}`
      h.dataset.handle = corner
      h.addEventListener('pointerdown', (e) => this.startResize(e, corner))
      this.frame.append(h)
    }
    this.frame.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).dataset.handle) return
      if ((e.target as HTMLElement).closest('button')) return
      e.preventDefault()
      const pos = this.getPos()
      if (pos === undefined) return
      this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
      this.view.focus()
    })
    this.contentDOM = document.createElement('figcaption')
    this.dom.append(this.frame, this.contentDOM)
    // Rogner : demandé par le ruban ou le menu contextuel (événement sur la figure).
    this.dom.addEventListener('fp-crop', () => (this.cropping ? this.endCrop() : this.startCrop()))
    this.render()
  }

  // --- rogner à la souris -----------------------------------------------------
  //
  // L'image entière apparaît, atténuée, et la partie gardée est encadrée de
  // poignées noires : tirer une poignée rogne ce côté, tirer l'intérieur
  // déplace l'image sous le cadre. L'image garde son échelle : la partie
  // gardée rétrécit ou grandit à l'écran. Entrée, Échap ou un clic ailleurs
  // terminent ; chaque geste est une étape annulable.

  private cropOf(): Crop {
    return { top: 0, right: 0, bottom: 0, left: 0, ...(this.node.attrs.crop ?? {}) }
  }

  startCrop(): void {
    if (this.cropping || !this.natural || this.dom.dataset.kind !== 'data') return
    this.cropping = true
    this.dom.classList.add('is-cropping')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.endCrop()
      }
    }
    const onDown = (e: PointerEvent) => {
      if (!this.frame.contains(e.target as Node)) this.endCrop()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    this.cropOff = () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
    this.drawCrop()
  }

  endCrop(): void {
    if (!this.cropping) return
    this.cropping = false
    this.dom.classList.remove('is-cropping')
    this.cropOff?.()
    this.cropOff = null
    this.cropUi?.remove()
    this.cropUi = null
    this.view.focus()
  }

  /** Le calque de rognage : l'image entière (atténuée), la partie gardée et ses poignées. */
  private drawCrop(): void {
    this.cropUi?.remove()
    if (!this.cropping) return
    const c = this.cropOf()
    const fw = 1 - (c.left + c.right) / 100
    const fh = 1 - (c.top + c.bottom) / 100
    // Taille de la partie gardée, en pixels de mise en page (sans le zoom).
    const W = this.frame.offsetWidth
    const H = this.frame.offsetHeight
    const FW = W / fw
    const FH = H / fh
    const ui = document.createElement('div')
    ui.className = 'fp-cropper'
    ui.style.width = `${FW}px`
    ui.style.height = `${FH}px`
    ui.style.left = `${(-c.left / 100) * FW}px`
    ui.style.top = `${(-c.top / 100) * FH}px`
    const ghost = document.createElement('img')
    ghost.className = 'fp-cropper__ghost'
    ghost.src = this.img.src
    ghost.draggable = false
    ghost.alt = ''
    const win = document.createElement('div')
    win.className = 'fp-cropper__window'
    // La partie gardée montre l'image en pleine lumière, et suit les poignées.
    win.style.backgroundImage = `url(${JSON.stringify(this.img.src)})`
    win.style.backgroundSize = `${FW}px ${FH}px`
    const place = (k: Crop) => {
      win.style.left = `${k.left}%`
      win.style.top = `${k.top}%`
      win.style.width = `${100 - k.left - k.right}%`
      win.style.height = `${100 - k.top - k.bottom}%`
      win.style.backgroundPosition = `${(-k.left / 100) * FW}px ${(-k.top / 100) * FH}px`
    }
    place(c)
    for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      const el = document.createElement('span')
      el.className = `fp-cropper__handle fp-cropper__handle--${h}`
      el.dataset.crop = h
      el.addEventListener('pointerdown', (e) => this.dragCrop(e, h, FW, FH, place))
      win.append(el)
    }
    win.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).dataset.crop) return
      this.dragCrop(e, 'move', FW, FH, place)
    })
    ui.append(ghost, win)
    this.frame.append(ui)
    this.cropUi = ui
  }

  private dragCrop(e: PointerEvent, h: string, FW: number, FH: number, place: (k: Crop) => void): void {
    e.preventDefault()
    e.stopPropagation()
    const zoom = this.hooks.zoom() || 1
    const start = this.cropOf()
    const x0 = e.clientX
    const y0 = e.clientY
    const target = e.target as HTMLElement
    target.setPointerCapture?.(e.pointerId)
    let next = { ...start }
    const MAX = 95
    const clamp = (v: number, other: number) => Math.max(0, Math.min(MAX - other, v))
    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - x0) / zoom / FW) * 100
      const dy = ((ev.clientY - y0) / zoom / FH) * 100
      const k = { ...start }
      if (h === 'move') {
        // Déplacer l'image sous le cadre : la taille gardée ne change pas.
        const sx = Math.max(-start.left, Math.min(start.right, dx))
        const sy = Math.max(-start.top, Math.min(start.bottom, dy))
        k.left = start.left + sx
        k.right = start.right - sx
        k.top = start.top + sy
        k.bottom = start.bottom - sy
      } else {
        if (h.includes('w')) k.left = clamp(start.left + dx, start.right)
        if (h.includes('e')) k.right = clamp(start.right - dx, start.left)
        if (h.includes('n')) k.top = clamp(start.top + dy, start.bottom)
        if (h.includes('s')) k.bottom = clamp(start.bottom - dy, start.top)
      }
      next = k
      place(k)
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      this.commitCrop(start, next)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  /** Enregistre le rognage : l'image garde son échelle, le cadre suit la partie gardée. */
  private commitCrop(before: Crop, after: Crop): void {
    const r = (v: number) => Math.round(v * 100) / 100
    const k = { top: r(after.top), right: r(after.right), bottom: r(after.bottom), left: r(after.left) }
    if (k.top === before.top && k.right === before.right && k.bottom === before.bottom && k.left === before.left) return
    const pos = this.getPos()
    if (pos === undefined) return
    const node = this.view.state.doc.nodeAt(pos)
    if (!node) return
    const a = node.attrs
    const fw0 = 1 - (before.left + before.right) / 100
    const fh0 = 1 - (before.top + before.bottom) / 100
    const fw1 = 1 - (k.left + k.right) / 100
    const fh1 = 1 - (k.top + k.bottom) / 100
    const shownW = (a.width as number) || this.frame.offsetWidth * PT_PER_PX
    const width = Math.max(4, Math.round(((shownW * fw1) / fw0) * 2) / 2)
    const height = a.height ? Math.max(4, Math.round((((a.height as number) * fh1) / fh0) * 2) / 2) : 0
    const none = !k.top && !k.right && !k.bottom && !k.left
    const tr = this.view.state.tr.setNodeMarkup(pos, null, { ...a, crop: none ? null : k, width, height })
    // Chaque geste est une étape d'annulation à part.
    closeHistory(tr)
    this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)))
  }

  private render(): void {
    const a = this.node.attrs
    this.dom.dataset.align = a.align
    this.dom.dataset.wrap = a.wrap
    this.dom.classList.toggle('is-empty-caption', this.node.content.size === 0)
    this.contentDOM.dataset.placeholder = this.hooks.label('captionPlaceholder')
    const src = a.src as string
    const kind = src.startsWith('data:') ? 'data' : /^https?:/i.test(src) ? 'external' : 'missing'
    this.dom.dataset.kind = kind
    this.placeholder.replaceChildren()
    if (kind === 'data') {
      if (this.img.getAttribute('src') !== src) {
        this.natural = null
        this.img.src = src
      }
    } else {
      this.img.removeAttribute('src')
      this.natural = null
      if (kind === 'external') {
        let host = src
        try {
          host = new URL(src).host
        } catch {
          /* adresse gardée telle quelle */
        }
        const text = document.createElement('p')
        text.textContent = this.hooks.label('imageExternal', { host })
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'fp-btn fp-btn--small'
        btn.textContent = this.hooks.label('imageLoad')
        btn.addEventListener('click', () => void this.loadExternal(src, btn))
        this.placeholder.append(text, btn)
      } else {
        const text = document.createElement('p')
        text.textContent = this.hooks.label('imageMissing', { id: src.replace(/^asset:/, '') })
        this.placeholder.append(text)
      }
    }
    this.img.alt = a.alt
    this.frame.style.borderColor = a.border ? cssColor(a.border) : ''
    this.frame.classList.toggle('has-border', !!a.border)
    this.layout()
  }

  private async loadExternal(url: string, btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true
    try {
      const data = await this.hooks.fetchImage(url)
      const pos = this.getPos()
      if (pos === undefined) return
      const node = this.view.state.doc.nodeAt(pos)
      if (!node || node.attrs.src !== url) return
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, src: data, assetId: null }))
    } catch {
      btn.disabled = false
      btn.textContent = this.hooks.label('imageLoadFailed')
    }
  }

  /** Taille et rognage : le cadre a les proportions de l'image rognée (et tournée). */
  private layout(): void {
    const a = this.node.attrs
    const crop: Crop = a.crop ?? { top: 0, right: 0, bottom: 0, left: 0 }
    const fw = 1 - (crop.left + crop.right) / 100
    const fh = 1 - (crop.top + crop.bottom) / 100
    const quarter = a.rotate === 90 || a.rotate === 270
    const nat = this.natural
    this.frame.style.width = a.width ? `${a.width}pt` : nat ? `${Math.min(nat.w * fw * PT_PER_PX, 2000)}pt` : ''
    if (nat) {
      const ratio = (nat.w * fw) / (nat.h * fh) // largeur / hauteur de l'image rognée
      const shown = a.height && a.width ? a.width / a.height : quarter ? 1 / ratio : ratio
      this.frame.style.aspectRatio = String(shown)
      this.inner.style.width = quarter ? `${100 / shown}%` : '100%'
      this.inner.style.height = quarter ? `${100 * shown}%` : '100%'
    } else {
      this.frame.style.aspectRatio = ''
      this.inner.style.width = this.inner.style.height = ''
    }
    const sx = a.flip === 'h' || a.flip === 'hv' ? -1 : 1
    const sy = a.flip === 'v' || a.flip === 'hv' ? -1 : 1
    this.inner.style.transform = `translate(-50%, -50%) rotate(${a.rotate || 0}deg) scale(${sx}, ${sy})`
    this.img.style.width = `${100 / fw}%`
    this.img.style.height = `${100 / fh}%`
    this.img.style.left = `${(-crop.left / fw)}%`
    this.img.style.top = `${(-crop.top / fh)}%`
    // Retouches (couleurs, transparence, ombre, halo, bords adoucis) : sur le cadre, qui découpe l'image rognée.
    const fx = adjustCss(a.adjust as PictureAdjust | null, cssColor)
    for (const k of ['filter', 'opacity', 'mask-image', '-webkit-mask-image', 'mask-composite', '-webkit-mask-composite']) this.frame.style.setProperty(k, fx[k] ?? '')
  }

  private startResize(e: PointerEvent, corner: string): void {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const rect = this.frame.getBoundingClientRect()
    const zoom = this.hooks.zoom() || 1
    const startW = rect.width / zoom
    const startH = rect.height / zoom
    const dir = corner.includes('w') ? -1 : 1
    const free = e.shiftKey
    const maxW = (this.view.dom.clientWidth || startW) * 1.0
    this.resizing = true
    this.dom.classList.add('is-resizing')
    const target = e.target as HTMLElement
    target.setPointerCapture?.(e.pointerId)
    let w = startW
    let hgt = startH
    const move = (ev: PointerEvent) => {
      w = Math.max(16, Math.min(maxW, startW + (dir * (ev.clientX - startX)) / zoom))
      if (free && corner.length === 2) hgt = Math.max(16, startH + ((corner.includes('n') ? -1 : 1) * (ev.clientY - startY)) / zoom)
      else hgt = (w * startH) / startW
      this.frame.style.width = `${w}px`
      if (free) this.frame.style.aspectRatio = String(w / hgt)
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      this.resizing = false
      this.dom.classList.remove('is-resizing')
      const pos = this.getPos()
      if (pos === undefined) return
      const node = this.view.state.doc.nodeAt(pos)
      if (!node) return
      const width = Math.round(w * PT_PER_PX * 2) / 2
      const height = free ? Math.round(hgt * PT_PER_PX * 2) / 2 : 0
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, width, height }))
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    if (!this.resizing) this.render()
    // En cours de rognage : le calque suit le nouveau cadre.
    if (this.cropping) requestAnimationFrame(() => this.drawCrop())
    return true
  }

  destroy(): void {
    this.endCrop()
  }

  selectNode(): void {
    this.dom.classList.add('is-selected')
  }

  deselectNode(): void {
    this.dom.classList.remove('is-selected')
    this.endCrop()
  }

  stopEvent(e: Event): boolean {
    const t = e.target as HTMLElement
    return !!t.closest?.('.fp-figure__handle, .fp-figure__placeholder button, .fp-cropper')
  }

  ignoreMutation(m: ViewMutationRecord): boolean {
    // Seules les modifications de la légende intéressent l'éditeur.
    if (m.type === 'selection') return false
    return !this.contentDOM.contains(m.target as Node) || m.target === this.contentDOM && m.type === 'attributes'
  }
}

// --- champs -----------------------------------------------------------------

export type FieldContextProvider = (doc: PMNode) => Omit<FieldContext, 'page' | 'pages'> & { pageAt?: (pos: number) => number; pages?: number }

/** Rafraîchit les champs ({{page}} après une nouvelle coupure en pages…). */
export const refreshFields = (view: { state: EditorState; dispatch: (tr: import('prosemirror-state').Transaction) => void }) =>
  view.dispatch(view.state.tr.setMeta(fieldsKey, true).setMeta('addToHistory', false))

export const fieldsKey = new PluginKey<DecorationSet>('folio-fields')

/** Valeurs des champs, portées par des décorations : la vue du champ les affiche. */
export function fieldsPlugin(context: FieldContextProvider): Plugin<DecorationSet> {
  const build = (state: EditorState): DecorationSet => {
    const ctx = context(state.doc)
    const decos: Decoration[] = []
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'field') return true
      const value = fieldValue(node.attrs.name as FieldName, node.attrs.format, {
        ...ctx,
        page: ctx.pageAt ? ctx.pageAt(pos) : 1,
        pages: ctx.pages ?? 1,
      })
      decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-value': value }, { value }))
      return false
    })
    return DecorationSet.create(state.doc, decos)
  }
  return new Plugin<DecorationSet>({
    key: fieldsKey,
    state: {
      init: (_c, state) => build(state),
      apply: (tr, set, _old, state) => (tr.docChanged || tr.getMeta(fieldsKey) ? build(state) : set),
    },
    props: {
      decorations: (state) => fieldsKey.getState(state),
      nodeViews: {
        field: (node, _view, _getPos, decorations) => new FieldView(node, decorations),
      },
    },
  })
}

class FieldView implements NodeView {
  dom: HTMLElement
  constructor(
    private node: PMNode,
    decorations: readonly Decoration[],
  ) {
    this.dom = document.createElement('span')
    this.dom.className = 'fp-field'
    this.dom.contentEditable = 'false'
    this.render(decorations)
  }
  private render(decorations: readonly Decoration[]): void {
    const d = decorations.find((x) => (x.spec as { value?: string }).value !== undefined)
    const value = d ? (d.spec as { value: string }).value : ''
    this.dom.dataset.field = this.node.attrs.name
    this.dom.textContent = value || `{{${this.node.attrs.name}}}`
    this.dom.classList.toggle('is-empty', !value)
    this.dom.title = `{{${this.node.attrs.name}${this.node.attrs.format ? ':' + this.node.attrs.format : ''}}}`
  }
  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render(decorations)
    return true
  }
  selectNode(): void {
    this.dom.classList.add('is-selected')
  }
  deselectNode(): void {
    this.dom.classList.remove('is-selected')
  }
  ignoreMutation(): boolean {
    return true
  }
}

// --- tableaux -----------------------------------------------------------------

/** Vue de tableau de prosemirror-tables, avec les attributs de style du tableau. */
export class FolioTableView extends TableView {
  constructor(node: PMNode, cellMinWidth: number) {
    super(node, cellMinWidth)
    this.apply(node)
  }
  override update(node: PMNode): boolean {
    if (!super.update(node)) return false
    this.apply(node)
    return true
  }
  private apply(node: PMNode): void {
    const attrs = tableDOMAttrs(node.attrs)
    // L'attribut style appartient au redimensionnement des colonnes : on n'y touche que par variable.
    for (const name of ['data-table-style', 'data-align', 'data-first-column', 'data-row-height']) this.table.removeAttribute(name)
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') this.table.classList.add(...v.split(' '))
      else if (k !== 'style') this.table.setAttribute(k, v)
    }
    if (node.attrs.border) this.table.style.setProperty('--fp-table-border', cssColor(node.attrs.border))
    else this.table.style.removeProperty('--fp-table-border')
    if (node.attrs.rowHeight) this.table.style.setProperty('--fp-row-height', `${node.attrs.rowHeight}pt`)
    else this.table.style.removeProperty('--fp-row-height')
    this.dom.dataset.align = node.attrs.align ?? ''
  }
}

/** La légende vide reste visible quand le curseur y est (sinon on n'y verrait pas ce qu'on tape). */
export function captionFocusPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations: (state) => {
        const { $from } = state.selection
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'figure') {
            const pos = $from.before(d)
            return DecorationSet.create(state.doc, [Decoration.node(pos, pos + $from.node(d).nodeSize, { class: 'is-editing-caption' })])
          }
        }
        return null
      },
    },
  })
}

// --- table des matières -------------------------------------------------------

export interface TocEntry {
  level: number
  text: string
  pos: number
  page: string | null
}

export const tocKey = new PluginKey<DecorationSet>('folio-toc')

/** Entrées de chaque table des matières, portées par des décorations (comme les champs). */
export function tocPlugin(pageOf: (pos: number) => string | null, onJump: (pos: number) => void, labels: () => { empty: string; untitled: string }): Plugin<DecorationSet> {
  const build = (state: EditorState): DecorationSet => {
    const decos: Decoration[] = []
    let headings: { level: number; text: string; pos: number }[] | null = null
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'toc') return node.type.name === 'doc' || node.type.name === 'blockquote' || node.type.name === 'columns'
      headings ??= collectHeadings(state)
      const levels = node.attrs.levels as number
      const entries: TocEntry[] = headings.filter((h) => h.level <= levels).map((h) => ({ ...h, page: pageOf(h.pos) }))
      decos.push(Decoration.node(pos, pos + node.nodeSize, {}, { entries }))
      return false
    })
    return DecorationSet.create(state.doc, decos)
  }
  return new Plugin<DecorationSet>({
    key: tocKey,
    state: {
      init: (_c, state) => build(state),
      apply: (tr, set, _old, state) => (tr.docChanged || tr.getMeta(fieldsKey) || tr.getMeta(tocKey) ? build(state) : set),
    },
    props: {
      decorations: (state) => tocKey.getState(state),
      nodeViews: { toc: (node, _view, _getPos, decorations) => new TocView(node, decorations, onJump, labels) },
    },
  })
}

function collectHeadings(state: EditorState) {
  const out: { level: number; text: string; pos: number }[] = []
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      out.push({ level: node.attrs.level, text: node.textContent.trim(), pos })
      return false
    }
    return ['doc', 'blockquote', 'columns'].includes(node.type.name)
  })
  return out
}

class TocView implements NodeView {
  dom: HTMLElement
  constructor(
    private node: PMNode,
    decorations: readonly Decoration[],
    private onJump: (pos: number) => void,
    private labels: () => { empty: string; untitled: string },
  ) {
    this.dom = document.createElement('nav')
    this.dom.className = 'fp-toc'
    this.dom.contentEditable = 'false'
    this.render(decorations)
  }
  private render(decorations: readonly Decoration[]): void {
    const d = decorations.find((x) => (x.spec as { entries?: TocEntry[] }).entries)
    const entries = d ? (d.spec as { entries: TocEntry[] }).entries : []
    this.dom.dataset.levels = String(this.node.attrs.levels)
    this.dom.replaceChildren()
    if (this.node.attrs.title) {
      const title = document.createElement('p')
      title.className = 'fp-toc__title'
      title.dataset.row = ''
      title.textContent = this.node.attrs.title
      this.dom.append(title)
    }
    if (!entries.length) {
      const p = document.createElement('p')
      p.className = 'fp-toc__empty'
      p.textContent = this.labels().empty
      this.dom.append(p)
      return
    }
    const list = document.createElement('ol')
    list.className = 'fp-toc__list'
    for (const e of entries) {
      const li = document.createElement('li')
      li.className = 'fp-toc__entry'
      li.dataset.level = String(e.level)
      const a = document.createElement('a')
      a.href = '#'
      a.dataset.pos = String(e.pos)
      const text = document.createElement('span')
      text.className = 'fp-toc__text'
      text.textContent = e.text || this.labels().untitled
      const dots = document.createElement('span')
      dots.className = 'fp-toc__dots'
      const page = document.createElement('span')
      page.className = 'fp-toc__page'
      page.textContent = e.page ?? ''
      a.append(text, dots, page)
      a.addEventListener('mousedown', (ev) => ev.preventDefault())
      a.addEventListener('click', (ev) => {
        ev.preventDefault()
        this.onJump(e.pos)
      })
      li.dataset.row = ''
      li.append(a)
      list.append(li)
    }
    this.dom.append(list)
    applyInnerBreaks(this.dom, decorations)
  }
  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render(decorations)
    return true
  }
  selectNode(): void {
    this.dom.classList.add('is-selected')
  }
  deselectNode(): void {
    this.dom.classList.remove('is-selected')
  }
  stopEvent(e: Event): boolean {
    // Les liens de la table sont à elle ; un clic ailleurs sélectionne la table.
    return (e.type === 'click' || e.type === 'mousedown') && !!(e.target as HTMLElement).closest?.('a')
  }
  ignoreMutation(): boolean {
    return true
  }
}
