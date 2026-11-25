// Fenêtres surgissantes ancrées à un bouton (listes, palettes, grille de
// tableau) : Échap ou un clic à l'extérieur ferme, le focus revient au bouton,
// les flèches parcourent les éléments.

import { h } from './dom'

let openPop: Popover | null = null

export interface PopoverOptions {
  anchor: HTMLElement
  content: HTMLElement
  /** Nom stable pour les tests et le style. */
  name: string
  onClose?: () => void
  /** Ne pas donner le focus au premier élément (liste de polices filtrée par la saisie…). */
  keepFocus?: boolean
}

export class Popover {
  readonly el: HTMLElement
  private closed = false
  private readonly onDown = (e: PointerEvent) => {
    const t = e.target as Node
    if (!this.el.contains(t) && !this.o.anchor.contains(t)) this.close(false)
  }
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.close(true)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = this.items()
      if (!items.length) return
      const i = items.indexOf(document.activeElement as HTMLElement)
      if (i < 0 && document.activeElement !== this.o.anchor && !this.el.contains(document.activeElement)) return
      e.preventDefault()
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
      items[next].focus()
    }
  }
  private readonly onResize = () => this.place()

  constructor(private o: PopoverOptions) {
    openPop?.close(false)
    openPop = this
    this.el = h('div', { class: 'fp-popover', role: 'dialog', 'data-popover': o.name })
    // Ouverte depuis la barre du menu contextuel : au-dessus du menu.
    if (o.anchor.closest('.fp-ctx-mini--floating')) this.el.classList.add('fp-popover--over-menu')
    // Un contenu qui défile lui-même (galerie des formes) : la fenêtre, elle, ne défile pas
    // (sinon deux barres de défilement l'une dans l'autre).
    if (o.content.hasAttribute('data-scrolls')) this.el.classList.add('fp-popover--inner-scroll')
    this.el.append(o.content)
    document.body.append(this.el)
    this.place()
    o.anchor.setAttribute('aria-expanded', 'true')
    document.addEventListener('pointerdown', this.onDown, true)
    document.addEventListener('keydown', this.onKey, true)
    window.addEventListener('resize', this.onResize)
    if (!o.keepFocus) this.items()[0]?.focus()
  }

  private items(): HTMLElement[] {
    return [...this.el.querySelectorAll<HTMLElement>('[data-pop-item]:not([disabled])')]
  }

  /** Sous le bouton, sans sortir de la fenêtre. */
  place(): void {
    const r = this.o.anchor.getBoundingClientRect()
    const w = this.el.offsetWidth
    const hgt = this.el.offsetHeight
    let left = r.left
    let top = r.bottom + 4
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w)
    if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - 4 - hgt)
    this.el.style.left = `${Math.round(left)}px`
    this.el.style.top = `${Math.round(top)}px`
  }

  close(refocus = true): void {
    if (this.closed) return
    this.closed = true
    if (openPop === this) openPop = null
    document.removeEventListener('pointerdown', this.onDown, true)
    document.removeEventListener('keydown', this.onKey, true)
    window.removeEventListener('resize', this.onResize)
    this.el.remove()
    this.o.anchor.setAttribute('aria-expanded', 'false')
    if (refocus) this.o.anchor.focus({ preventScroll: true })
    this.o.onClose?.()
  }

  get isOpen(): boolean {
    return !this.closed
  }
}

export const closePopovers = () => openPop?.close(false)
export const popoverOpen = () => !!openPop

/** Élément de liste d'une fenêtre surgissante. */
export function popItem(label: string | Node, run: () => void, extra: Record<string, string | boolean | null> = {}): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'fp-pop__item', 'data-pop-item': '', ...extra }) as HTMLButtonElement
  if (typeof label === 'string') b.textContent = label
  else b.append(label)
  b.addEventListener('click', () => {
    closePopovers()
    run()
  })
  return b
}
