// Règle horizontale : marges de la page (grisées), graduations en
// centimètres, retraits du paragraphe courant (première ligne, gauche,
// droite) et bords des marges, à faire glisser à la souris ou au clavier.

import type { FolioApp } from '../app'
import { setParaAttrs, styleIdAt } from '../editor/commands'
import { resolveStyle } from '../format/theme'
import type { PageSetup } from '../format/types'
import { t } from '../i18n/i18n'
import { settings } from '../settings'
import { h } from './dom'
import { getPageView, setPage, styleName } from './panels'

const PX_PER_MM = 96 / 25.4
const PT_PER_PX = 0.75
/** Pas de déplacement : 0,25 cm (Alt : 1 mm). */
const STEP_MM = 2.5

type Marker = 'first' | 'left' | 'right' | 'marginLeft' | 'marginRight'

export class Ruler {
  readonly el: HTMLElement
  private readonly track: HTMLElement
  private readonly ticks: HTMLElement
  private readonly markers: Record<Marker, HTMLElement>
  private frame = 0
  private ticksKey = ''

  constructor(
    private app: FolioApp,
    private page: HTMLElement,
    canvas: HTMLElement,
  ) {
    this.ticks = h('div', { class: 'fp-ruler__ticks' })
    const marker = (m: Marker, cls: string) => {
      const b = h('button', { type: 'button', class: `fp-ruler__marker fp-ruler__marker--${cls}`, 'data-marker': m }) as HTMLButtonElement
      b.addEventListener('pointerdown', (e) => this.drag(e, m))
      b.addEventListener('keydown', (e) => this.key(e, m))
      return b
    }
    this.markers = {
      first: marker('first', 'first'),
      left: marker('left', 'left'),
      right: marker('right', 'right'),
      marginLeft: marker('marginLeft', 'margin'),
      marginRight: marker('marginRight', 'margin'),
    }
    this.track = h('div', { class: 'fp-ruler__track' }, this.ticks, ...Object.values(this.markers))
    this.el = h('div', { class: 'fp-ruler', id: 'fp-ruler', role: 'toolbar', 'aria-label': t('ruler.label') }, this.track)
    const schedule = () => this.schedule()
    canvas.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    new ResizeObserver(schedule).observe(page)
    app.onChange(schedule)
  }

  schedule(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.update()
    })
  }

  private setup(): PageSetup {
    return this.app.state.doc.attrs.page as PageSetup
  }

  /** Échelle et position de la page (zoom), marges en px non mis à l'échelle. */
  private geometry() {
    const r = this.page.getBoundingClientRect()
    const scale = this.page.offsetWidth ? r.width / this.page.offsetWidth : 1
    const cs = getComputedStyle(this.page)
    const left = parseFloat(cs.paddingLeft) || 0
    const right = parseFloat(cs.paddingRight) || 0
    const paged = this.page.classList.contains('is-paged')
    // Vue page : la règle suit la feuille de la section du curseur (une section peut être en paysage).
    const f = paged ? this.app.sectionFrame?.(this.app.state.selection.from) : null
    if (f && Math.abs(f.width - this.page.offsetWidth) > 0.5) {
      const rect = new DOMRect(r.left + f.left * scale, r.top, f.width * scale, r.height)
      return { rect, scale, width: f.width, left: f.marginLeft, right: f.marginRight, paged, own: f.own }
    }
    return { rect: r, scale, width: this.page.offsetWidth, left, right, paged, own: !!f?.own }
  }

  /** Retraits effectifs (pt) du paragraphe courant : attribut, sinon style. */
  private indents(): { first: number; left: number; right: number; can: boolean } {
    const s = this.app.state
    const block = s.selection.$from.parent
    const can = block.type.name === 'paragraph' || block.type.name === 'heading'
    const st = resolveStyle(this.app.styles, styleIdAt(s))
    const a = block.attrs
    return {
      first: (can && typeof a.indentFirst === 'number' ? a.indentFirst : st.indent?.first) ?? 0,
      left: (can && typeof a.indentLeft === 'number' ? a.indentLeft : st.indent?.left) ?? 0,
      right: (can && typeof a.indentRight === 'number' ? a.indentRight : st.indent?.right) ?? 0,
      can,
    }
  }

  update(): void {
    const show = settings().ruler
    this.el.hidden = !show
    if (!show) return
    const g = this.geometry()
    const host = this.el.getBoundingClientRect()
    this.track.style.left = `${g.rect.left - host.left}px`
    this.track.style.width = `${g.rect.width}px`
    const s = g.scale
    const textLeft = g.left * s
    const textRight = (g.width - g.right) * s
    this.track.style.setProperty('--ml', `${textLeft}px`)
    this.track.style.setProperty('--mr', `${g.rect.width - textRight}px`)
    // Graduations : 0 au bord gauche du texte, un trait par 0,25 cm, un chiffre par centimètre.
    const key = `${g.rect.width}:${textLeft}:${s}`
    if (key !== this.ticksKey) {
      this.ticksKey = key
      this.ticks.replaceChildren()
      const cm = PX_PER_MM * 10 * s
      const from = Math.floor(-textLeft / (cm / 4))
      const to = Math.ceil((g.rect.width - textLeft) / (cm / 4))
      for (let i = from; i <= to; i++) {
        const x = textLeft + (i * cm) / 4
        if (x < 0 || x > g.rect.width) continue
        const major = i % 4 === 0
        const tick = h('span', { class: 'fp-ruler__tick' + (major ? ' is-major' : i % 2 === 0 ? ' is-half' : ''), style: `left:${x}px` })
        if (major && i !== 0) tick.textContent = String(Math.abs(i / 4))
        this.ticks.append(tick)
      }
    }
    const ind = this.indents()
    const px = (pt: number) => (pt / PT_PER_PX) * s
    this.place('first', textLeft + px(ind.left + ind.first), ind.can)
    this.place('left', textLeft + px(ind.left), ind.can)
    this.place('right', textRight - px(ind.right), ind.can)
    // Les marges d'une section qui a sa propre mise en page se règlent dans sa boîte de dialogue.
    this.place('marginLeft', textLeft, g.paged && !g.own)
    this.place('marginRight', textRight, g.paged && !g.own)
    const cmLabel = (pt: number) => `${(pt / (72 / 2.54)).toFixed(2).replace('.', t('number.decimal'))} cm`
    this.label('first', `${t('ruler.first')} : ${cmLabel(ind.first)}`)
    this.label('left', `${t('ruler.left')} : ${cmLabel(ind.left)} — ${styleName(this.app, styleIdAt(this.app.state))}`)
    this.label('right', `${t('ruler.right')} : ${cmLabel(ind.right)}`)
    const p = this.setup()
    this.label('marginLeft', `${t('page.left')} : ${(p.margins.left / 10).toFixed(2).replace('.', t('number.decimal'))} cm`)
    this.label('marginRight', `${t('page.right')} : ${(p.margins.right / 10).toFixed(2).replace('.', t('number.decimal'))} cm`)
  }

  private place(m: Marker, x: number, visible: boolean): void {
    const el = this.markers[m]
    el.hidden = !visible
    el.style.left = `${x}px`
  }

  private label(m: Marker, text: string): void {
    this.markers[m].setAttribute('aria-label', text)
    this.markers[m].title = text
  }

  /** Nouvelle valeur d'un repère, en points (retraits) ou millimètres (marges). */
  private commit(m: Marker, deltaMm: number, base: { first: number; left: number; right: number }, margins: PageSetup['margins']): void {
    const dPt = deltaMm * (72 / 25.4)
    const round = (pt: number) => Math.round(pt * 2) / 2
    if (m === 'first') this.app.run(setParaAttrs({ indentFirst: round(base.first + dPt) }), false)
    // Le retrait de première ligne est relatif au retrait gauche : la première ligne suit.
    else if (m === 'left') this.app.run(setParaAttrs({ indentLeft: round(base.left + dPt) }), false)
    else if (m === 'right') this.app.run(setParaAttrs({ indentRight: round(base.right - dPt) }), false)
    else if (m === 'marginLeft') setPage(this.app, { margins: { ...margins, left: Math.max(0, Math.round((margins.left + deltaMm) * 10) / 10) } })
    else setPage(this.app, { margins: { ...margins, right: Math.max(0, Math.round((margins.right - deltaMm) * 10) / 10) } })
  }

  private drag(e: PointerEvent, m: Marker): void {
    e.preventDefault()
    const el = this.markers[m]
    el.setPointerCapture?.(e.pointerId)
    const g = this.geometry()
    const startX = e.clientX
    const base = this.indents()
    const margins = { ...this.setup().margins }
    const startLeft = parseFloat(el.style.left)
    const guide = h('div', { class: 'fp-ruler__guide' })
    this.page.append(guide)
    let deltaMm = 0
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / g.scale
      const step = ev.altKey ? 1 : STEP_MM
      deltaMm = Math.round(dx / PX_PER_MM / step) * step
      const x = startLeft + deltaMm * PX_PER_MM * g.scale
      el.style.left = `${x}px`
      guide.style.left = `${x / g.scale}px`
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      guide.remove()
      if (deltaMm !== 0) this.commit(m, deltaMm, base, margins)
      else this.schedule()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  private key(e: KeyboardEvent, m: Marker): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.altKey ? 1 : STEP_MM
    this.commit(m, e.key === 'ArrowRight' ? step : -step, this.indents(), { ...this.setup().margins })
    this.markers[m].focus()
  }
}

export const rulerVisible = () => settings().ruler && !!getPageView()
