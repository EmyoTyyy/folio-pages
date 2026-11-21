// Mode lecture → Côte à côte : les pages deux par deux, comme un livre ouvert,
// à la taille de l'écran ; on tourne les pages avec les flèches, le clavier,
// la molette ou un glissement du doigt (une seule page sur un écran étroit).
//
// L'éditeur reste en place (vue Page), recouvert : rien ne change dans la
// mise en page, la recherche, l'impression ou le PDF. Chaque page affichée est
// une copie de la feuille, découpée à sa place, comme pour l'impression ;
// seules les pages visibles sont copiées. Les liens et la table des matières
// des copies mènent à leur cible ; une sélection qui bouge (Rechercher, un lien
// interne) amène sa page à l'écran.

import type { FolioApp } from '../app'
import { followLink } from '../editor/links'
import { t } from '../i18n/i18n'
import { GAP } from '../layout/pages'
import type { PageView } from '../layout/pageview'
import { settings, updateSettings } from '../settings'
import { isDialogOpen, toast } from './dialog'
import { h, icon } from './dom'
import { RIBBON_ICONS as I } from './icons'

/** Écart entre les deux pages, marges autour (px). */
const SPREAD_GAP = 24
const PAD_X = 64
const PAD_Y = 20
const FOOT = 34
/** En dessous de cette largeur de zone, une seule page par écran. */
const NARROW = 720

/** Les pages de l'écran qui contient la page k (indices à partir de 0). */
export function spreadOf(k: number, per: number, count: number): number[] {
  const first = Math.max(0, Math.min(count - 1, k - (k % per)))
  return Array.from({ length: per }, (_, i) => first + i).filter((i) => i < count)
}

/** Échelle des pages pour que l'écran entier tienne dans la zone. */
export function spreadScale(sizes: { width: number; height: number }[], availW: number, availH: number): number {
  if (!sizes.length) return 1
  const w = sizes.reduce((s, g) => s + g.width, 0) + SPREAD_GAP * (sizes.length - 1)
  const hgt = Math.max(...sizes.map((g) => g.height))
  return Math.max(0.1, Math.min(2, availW / w, availH / hgt))
}

let current: SpreadView | null = null
export const getSpread = () => current

/** Les pages côte à côte (et le mode lecture s'il le faut), ou la page verticale. */
export function setSideToSide(app: FolioApp, on: boolean): void {
  if (settings().readSpread !== on) updateSettings({ readSpread: on })
  if (on && !app.reading) app.setReading(true)
  else {
    current?.sync()
    app.notifyUi()
  }
}

export const isSideToSide = (app: FolioApp) => app.reading && settings().readSpread

export class SpreadView {
  readonly el: HTMLElement
  private readonly stage: HTMLElement
  private readonly label: HTMLElement
  private readonly prevBtn: HTMLButtonElement
  private readonly nextBtn: HTMLButtonElement
  private active = false
  /** Première page de l'écran affiché. */
  private first = 0
  private key = ''
  private head = -1
  private frame = 0
  private modeBefore: PageView['mode'] | null = null
  private wheelAt = 0
  private wheelRun = 0

  constructor(
    private app: FolioApp,
    private pv: PageView,
    private canvas: HTMLElement,
    private zoomBox: HTMLElement,
    private page: HTMLElement,
  ) {
    current = this
    this.prevBtn = h('button', { type: 'button', class: 'fp-spread__nav fp-spread__nav--prev', 'data-spread': 'prev', 'aria-label': t('spread.prev'), title: t('spread.prev'), onclick: () => this.turn(-1) }, icon(I.chevronLeft)) as HTMLButtonElement
    this.nextBtn = h('button', { type: 'button', class: 'fp-spread__nav fp-spread__nav--next', 'data-spread': 'next', 'aria-label': t('spread.next'), title: t('spread.next'), onclick: () => this.turn(1) }, icon(I.chevronRight)) as HTMLButtonElement
    this.stage = h('div', { class: 'fp-spread__stage', 'data-spread-stage': '' })
    this.label = h('div', { class: 'fp-spread__label', 'aria-live': 'polite' })
    this.el = h('div', { class: 'fp-spread', id: 'fp-spread', role: 'region', 'aria-label': t('rb.sideToSide'), hidden: true }, this.prevBtn, this.stage, this.nextBtn, this.label)
    canvas.after(this.el)

    app.onChange(() => this.sync())
    pv.onLayout(() => this.schedule())
    new ResizeObserver(() => this.schedule()).observe(canvas)
    this.stage.addEventListener('click', (e) => this.click(e))
    this.el.addEventListener('wheel', (e) => this.wheel(e), { passive: false })
    let startX = 0
    let startY = 0
    this.el.addEventListener('pointerdown', (e) => {
      startX = e.clientX
      startY = e.clientY
    })
    this.el.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') return
      const dx = e.clientX - startX
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - startY) * 1.5) this.turn(dx < 0 ? 1 : -1)
    })
    // À la capture : avant les raccourcis de l'éditeur (le curseur peut y être resté).
    document.addEventListener('keydown', (e) => this.key_(e), true)
    this.sync()
  }

  get isActive(): boolean {
    return this.active
  }

  /** Pages par écran : deux, une seule sur un écran étroit. */
  get perScreen(): number {
    return this.canvas.clientWidth < NARROW ? 1 : 2
  }

  /** Les pages affichées (indices à partir de 0). */
  get shown(): number[] {
    return spreadOf(this.first, this.perScreen, this.pv.paginator.pages.length)
  }

  /** Allumer ou éteindre selon le mode lecture et le réglage. */
  sync(): void {
    const want = this.app.reading && settings().readSpread
    if (want !== this.active) {
      if (want) this.start()
      else this.stop()
      return
    }
    if (!want) return
    // Une sélection qui bouge (Rechercher, lien interne) amène sa page.
    const head = this.app.state.selection.head
    if (head !== this.head) {
      this.head = head
      this.goToPage(this.pv.paginator.pageIndexAt(head))
    } else this.schedule()
  }

  private start(): void {
    this.active = true
    if (this.pv.mode !== 'page') {
      this.modeBefore = this.pv.mode
      this.pv.setMode('page')
    }
    this.first = this.pageAtScroll()
    this.head = this.app.state.selection.head
    this.el.hidden = false
    this.canvas.classList.add('is-spread')
    this.canvas.setAttribute('aria-hidden', 'true')
    this.key = ''
    this.render()
  }

  private stop(): void {
    this.active = false
    this.el.hidden = true
    this.stage.replaceChildren()
    this.canvas.classList.remove('is-spread')
    this.canvas.removeAttribute('aria-hidden')
    const back = this.modeBefore
    this.modeBefore = null
    if (back) this.pv.setMode(back)
    else this.scrollToPage(this.first)
  }

  /** Page en haut de la zone visible, en vue verticale. */
  private pageAtScroll(): number {
    const pages = this.pv.paginator.pages
    const z = settings().zoom
    const y = (this.canvas.scrollTop - this.zoomBox.offsetTop + this.canvas.clientHeight * 0.3) / z
    let k = 0
    for (let i = 0; i < pages.length; i++) if (this.pv.paginator.sheetOffset(i, pages) + i * GAP <= y) k = i
    return k
  }

  private scrollToPage(k: number): void {
    const pages = this.pv.paginator.pages
    if (!pages[k]) return
    const z = settings().zoom
    this.canvas.scrollTop = this.zoomBox.offsetTop + (this.pv.paginator.sheetOffset(k, pages) + k * GAP) * z - 16
  }

  goToPage(k: number): void {
    const n = this.pv.paginator.pages.length
    const per = this.perScreen
    const first = spreadOf(Math.max(0, Math.min(n - 1, k)), per, n)[0] ?? 0
    if (first === this.first && this.key) return this.schedule()
    this.first = first
    this.render()
  }

  /** Écran suivant (1) ou précédent (-1). */
  turn(dir: 1 | -1): void {
    if (!this.active) return
    const n = this.pv.paginator.pages.length
    const per = this.perScreen
    const next = this.first + dir * per
    if (next < 0 || next >= n) return
    this.first = next
    this.render(dir)
  }

  private schedule(): void {
    if (!this.active || this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.render()
    })
  }

  /** Dessine l'écran (sans rien refaire si rien n'a changé). */
  /** Exactement sur la zone de la page (le volet fractionné, s'il y en a un, reste visible). */
  private place(): void {
    const s = this.el.style
    s.left = `${this.canvas.offsetLeft}px`
    s.top = `${this.canvas.offsetTop}px`
    s.width = `${this.canvas.offsetWidth}px`
    s.height = `${this.canvas.offsetHeight}px`
  }

  private render(dir: 1 | -1 | 0 = 0): void {
    if (!this.active) return
    this.place()
    const pager = this.pv.paginator
    const pages = pager.pages
    const n = pages.length
    const per = this.perScreen
    this.first = spreadOf(this.first, per, n)[0] ?? 0
    const shown = spreadOf(this.first, per, n)
    const geoms = shown.map((k) => pager.geometryOf(pages[k].section))
    const availW = this.el.clientWidth - 2 * PAD_X
    const availH = this.el.clientHeight - 2 * PAD_Y - FOOT
    const scale = spreadScale(geoms, availW, availH)
    const key = JSON.stringify([shown, scale.toFixed(4), pages, geoms.map((g) => [g.width, g.height])]) + '|' + this.pv.drawVersion
    const state = this.app.state
    if (key === this.key && state === this.renderedState) return
    this.key = key
    this.renderedState = state

    const lay = this.pv.layout()
    const pageWidth = this.page.offsetWidth
    // Haut et bas de chaque bloc du texte, sur le papier (sans le zoom).
    const prose = this.app.view.dom
    const paper = this.page.getBoundingClientRect()
    const z = settings().zoom || 1
    const spans = Array.from(prose.children, (el) => {
      const r = el.getBoundingClientRect()
      return [(r.top - paper.top) / z, (r.bottom - paper.top) / z] as const
    })
    const slots = shown.map((k, i) => {
      const g = geoms[i]
      const slot = h('div', { class: 'fp-spread__page', 'data-page': String(k + 1) })
      slot.style.width = `${g.width * scale}px`
      slot.style.height = `${g.height * scale}px`
      const slice = h('div', { class: 'fp-spread__slice' })
      slice.style.width = `${g.width}px`
      slice.style.height = `${g.height}px`
      slice.style.transform = `scale(${scale})`
      const copy = this.page.cloneNode(true) as HTMLElement
      copy.removeAttribute('id')
      copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
      copy.querySelectorAll('[contenteditable]').forEach((el) => el.setAttribute('contenteditable', 'false'))
      copy.classList.add('fp-spread__copy')
      const offset = pager.sheetOffset(k, pages) + k * GAP
      copy.style.top = `${-offset}px`
      // Coupée au bas de sa page : la suite du document n'a pas à être dessinée.
      copy.style.height = `${offset + g.height}px`
      copy.style.minHeight = '0'
      copy.style.width = `${pageWidth}px`
      copy.style.left = `${-(lay.sheetLeft[pages[k].section] ?? 0)}px`
      copy.style.transform = 'none'
      // Les blocs des autres pages restent à leur place (la mise en page ne bouge pas) mais ne se lisent pas.
      const blocks = copy.querySelector('.fp-prose')?.children
      if (blocks)
        spans.forEach(([top, bottom], i) => {
          const el = blocks[i] as HTMLElement | undefined
          if (!el || (bottom > offset && top < offset + g.height)) return
          el.style.visibility = 'hidden'
          el.setAttribute('aria-hidden', 'true')
        })
      slice.append(copy)
      slot.append(slice)
      return slot
    })
    this.stage.replaceChildren(...slots)
    this.stage.style.gap = `${SPREAD_GAP}px`
    if (dir) {
      this.stage.classList.remove('is-turn-next', 'is-turn-prev')
      void this.stage.offsetWidth
      this.stage.classList.add(dir > 0 ? 'is-turn-next' : 'is-turn-prev')
    }
    const a = shown[0] + 1
    const b = shown[shown.length - 1] + 1
    this.label.textContent = a === b ? t('spread.page', { a, n }) : t('spread.pages', { a, b, n })
    this.prevBtn.disabled = this.first <= 0
    this.nextBtn.disabled = shown[shown.length - 1] >= n - 1
  }

  private renderedState: unknown = null

  private click(e: MouseEvent): void {
    const target = e.target as HTMLElement
    const a = target.closest<HTMLAnchorElement>('a[href]')
    if (!a) return
    e.preventDefault()
    // Entrée de table des matières : sa position dans le document.
    if (a.closest('.fp-toc') && a.dataset.pos) {
      this.app.jumpTo(Number(a.dataset.pos))
      return
    }
    followLink(a.getAttribute('href') ?? '', {
      jump: (anchor) => this.app.jumpToAnchor(anchor),
      blocked: () => toast(t('offline.blocked'), { kind: 'info' }),
    })
  }

  private wheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey) return
    e.preventDefault()
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
    const now = performance.now()
    // Un mouvement de molette (ou de pavé tactile) tourne une seule fois.
    if (now - this.wheelAt < 380) {
      this.wheelAt = now
      return
    }
    this.wheelRun = Math.sign(d) === Math.sign(this.wheelRun) ? this.wheelRun + d : d
    if (Math.abs(this.wheelRun) < 30) return
    this.wheelAt = now
    this.turn(this.wheelRun > 0 ? 1 : -1)
    this.wheelRun = 0
  }

  private key_(e: KeyboardEvent): void {
    if (!this.active || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isDialogOpen()) return
    const el = document.activeElement as HTMLElement | null
    if (el && (el.matches('input, textarea, select, [contenteditable="true"]') || el.closest('.fp-menu, .fp-pop, .fp-findbar'))) return
    const n = this.pv.paginator.pages.length
    const k = e.key
    // Espace sur un bouton : le bouton, pas la page.
    if (k === ' ' && el?.matches('button, [role="button"], a[href]')) return
    if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) this.turn(1)
    else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) this.turn(-1)
    else if (k === 'Home') this.goToPage(0)
    else if (k === 'End') this.goToPage(n - 1)
    else return
    e.preventDefault()
    e.stopPropagation()
  }
}
