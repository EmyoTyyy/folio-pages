// Barre de menus accessible (motif « menubar » de l'ARIA) : flèches, Entrée,
// Échap, Début/Fin ; clic à l'extérieur pour fermer.

import { h } from './dom'

export type MenuEntry =
  | {
      id: string
      label: string
      shortcut?: string
      run: () => void
      disabled?: boolean
      /** Case cochée (choix de langue). */
      checked?: boolean
    }
  | { separator: true }
  | { heading: string }

export interface MenuDef {
  id: string
  label: string
  entries: () => MenuEntry[]
}

export class MenuBar {
  readonly el: HTMLElement
  private openIndex = -1
  private popup: HTMLElement | null = null
  private tops: HTMLButtonElement[] = []

  constructor(private menus: () => MenuDef[]) {
    this.el = h('nav', { class: 'fp-menubar', role: 'menubar', 'aria-label': 'Menu' })
    this.render()
    document.addEventListener('pointerdown', (e) => {
      const target = e.target as Node
      // Le menu ouvert est attaché à <body> : un clic dedans n'est pas « à l'extérieur ».
      if (this.openIndex >= 0 && !this.el.contains(target) && !this.popup?.contains(target)) this.close(false)
    })
  }

  render(): void {
    this.close(false)
    this.el.replaceChildren()
    this.tops = this.menus().map((m, i) => {
      const b = h(
        'button',
        {
          type: 'button',
          class: 'fp-menubar__top',
          role: 'menuitem',
          'aria-haspopup': 'menu',
          'aria-expanded': 'false',
          'data-menu': m.id,
          tabindex: i === 0 ? '0' : '-1',
        },
        m.label,
      )
      b.addEventListener('click', () => (this.openIndex === i ? this.close(true) : this.open(i, false)))
      b.addEventListener('pointerenter', () => {
        if (this.openIndex >= 0 && this.openIndex !== i) this.open(i, false)
      })
      b.addEventListener('keydown', (e) => this.onTopKey(e, i))
      return b
    })
    this.el.append(...this.tops)
  }

  private onTopKey(e: KeyboardEvent, i: number): void {
    const n = this.tops.length
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const j = (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n
      if (this.openIndex >= 0) this.open(j, true)
      else this.focusTop(j)
    } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      this.open(i, true)
    } else if (e.key === 'Escape') {
      this.close(true)
    }
  }

  private focusTop(i: number): void {
    this.tops.forEach((b, k) => b.setAttribute('tabindex', k === i ? '0' : '-1'))
    this.tops[i].focus()
  }

  open(i: number, focusFirst: boolean): void {
    this.close(false)
    const def = this.menus()[i]
    const top = this.tops[i]
    this.openIndex = i
    top.setAttribute('aria-expanded', 'true')
    top.classList.add('is-open')
    const popup = h('div', { class: 'fp-menu', role: 'menu', 'aria-label': def.label, 'data-menu-popup': def.id })
    for (const entry of def.entries()) {
      if ('separator' in entry) {
        popup.append(h('div', { class: 'fp-menu__sep', role: 'separator' }))
        continue
      }
      if ('heading' in entry) {
        popup.append(h('div', { class: 'fp-menu__heading', role: 'presentation' }, entry.heading))
        continue
      }
      const item = h(
        'button',
        {
          type: 'button',
          class: 'fp-menu__item',
          role: entry.checked === undefined ? 'menuitem' : 'menuitemradio',
          'aria-checked': entry.checked === undefined ? null : String(entry.checked),
          'aria-disabled': entry.disabled ? 'true' : null,
          'data-item': entry.id,
          tabindex: '-1',
        },
        h('span', { class: 'fp-menu__check', 'aria-hidden': 'true' }, entry.checked ? '✓' : ''),
        h('span', { class: 'fp-menu__label' }, entry.label),
        entry.shortcut ? h('span', { class: 'fp-menu__kbd' }, entry.shortcut) : null,
      )
      item.addEventListener('click', () => {
        if (entry.disabled) return
        this.close(false)
        entry.run()
      })
      item.addEventListener('pointerenter', () => item.focus({ preventScroll: true }))
      popup.append(item)
    }
    popup.addEventListener('keydown', (e) => this.onMenuKey(e))
    const r = top.getBoundingClientRect()
    popup.style.left = `${Math.max(8, r.left)}px`
    popup.style.top = `${r.bottom + 4}px`
    document.body.appendChild(popup)
    // garder le menu dans la fenêtre
    const pr = popup.getBoundingClientRect()
    if (pr.right > window.innerWidth - 8) popup.style.left = `${Math.max(8, window.innerWidth - 8 - pr.width)}px`
    this.popup = popup
    if (focusFirst) this.items()[0]?.focus()
  }

  private items(): HTMLButtonElement[] {
    return Array.from(this.popup?.querySelectorAll<HTMLButtonElement>('.fp-menu__item') ?? [])
  }

  private onMenuKey(e: KeyboardEvent): void {
    const items = this.items()
    const k = items.indexOf(document.activeElement as HTMLButtonElement)
    const n = this.tops.length
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        items[(k + 1) % items.length]?.focus()
        break
      case 'ArrowUp':
        e.preventDefault()
        items[(k - 1 + items.length) % items.length]?.focus()
        break
      case 'Home':
        e.preventDefault()
        items[0]?.focus()
        break
      case 'End':
        e.preventDefault()
        items[items.length - 1]?.focus()
        break
      case 'ArrowRight':
      case 'ArrowLeft': {
        e.preventDefault()
        const j = (this.openIndex + (e.key === 'ArrowRight' ? 1 : n - 1)) % n
        this.open(j, true)
        break
      }
      case 'Escape':
        e.preventDefault()
        this.close(true)
        break
      case 'Tab':
        this.close(false)
        break
    }
  }

  close(refocus: boolean): void {
    if (this.openIndex < 0) return
    const top = this.tops[this.openIndex]
    top?.setAttribute('aria-expanded', 'false')
    top?.classList.remove('is-open')
    this.popup?.remove()
    this.popup = null
    const i = this.openIndex
    this.openIndex = -1
    if (refocus && top) this.focusTop(i)
  }

  get isOpen(): boolean {
    return this.openIndex >= 0
  }
}
