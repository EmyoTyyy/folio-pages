// Onglets des documents du fichier, en bas de la fenêtre (comme les feuilles
// d'un classeur) : un clic affiche le document, + en ajoute un, double-clic
// (ou F2) le renomme, clic droit (ou Maj+F10) : renommer, dupliquer, déplacer,
// supprimer. Les onglets se déplacent aussi en les faisant glisser : l'onglet
// saisi suit le pointeur sur la ligne, et les autres s'écartent pour lui faire place.

import type { FolioApp } from '../app'
import { t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h, icon } from './dom'
import { RIBBON_ICONS as I } from './icons'
import { Popover, closePopovers, popItem } from './popover'

export class DocTabs {
  readonly el: HTMLElement
  private readonly list: HTMLElement
  private readonly addBtn: HTMLButtonElement
  private sig = ''
  private renaming = -1
  /** Renommage commencé au clavier (F2) : on revient ensuite sur l'onglet. */
  private renameByKey = false
  /** Glissement en cours : les onglets ne sont pas redessinés avant la fin. */
  private drag: { stop: (keep: boolean) => void } | null = null
  /** Le clic qui suit la fin d'un glissement ne compte pas. */
  private swallowClick = false
  /** Fin d'un glissement resté ouvert (relâchement jamais reçu). */
  private endGesture: (() => void) | null = null

  constructor(private app: FolioApp) {
    this.list = h('div', { class: 'fp-doctabs__list', role: 'tablist', 'aria-label': t('docs.tabs') })
    this.addBtn = h('button', { type: 'button', class: 'fp-doctabs__add', id: 'fp-doc-add', title: t('docs.add'), 'aria-label': t('docs.add'), onclick: () => this.add() }, icon(I.plus)) as HTMLButtonElement
    this.el = h('div', { class: 'fp-doctabs', id: 'fp-doctabs' }, this.list, this.addBtn)
    app.onChange(() => this.render())
    this.list.addEventListener('keydown', (e) => this.key(e))
    this.render()
  }

  render(): void {
    if (this.drag) return
    const docs = this.app.documents
    const reading = this.app.reading
    const sig = JSON.stringify([docs, reading, this.renaming])
    if (sig === this.sig) return
    this.sig = sig
    const focused = this.list.contains(document.activeElement)
    this.addBtn.hidden = reading
    this.el.classList.toggle('is-single', docs.length === 1)
    this.list.replaceChildren(
      ...docs.map((d, i) => {
        if (i === this.renaming) return this.renameField(i, d.title)
        const tab = h(
          'button',
          {
            type: 'button',
            class: 'fp-doctab' + (d.active ? ' is-active' : ''),
            role: 'tab',
            'aria-selected': String(d.active),
            tabindex: d.active ? '0' : '-1',
            'data-doc': d.key,
            title: d.dirty ? `${d.title} (${t('docs.unsaved')})` : d.title,
          },
          h('span', { class: 'fp-doctab__label' }, d.title),
          d.dirty ? h('span', { class: 'fp-doctab__dot', 'aria-hidden': 'true' }) : null,
        ) as HTMLButtonElement
        tab.addEventListener('mousedown', (e) => {
          if (e.button === 0 && e.detail > 1) e.preventDefault()
        })
        tab.addEventListener('click', () => {
          if (this.swallowClick) {
            this.swallowClick = false
            return
          }
          this.app.switchTo(i)
        })
        tab.addEventListener('pointerdown', (e) => this.pointerDown(e, i, tab))
        tab.addEventListener('dblclick', () => this.startRename(i))
        tab.addEventListener('contextmenu', (e) => {
          e.preventDefault()
          e.stopPropagation()
          this.menu(i, tab)
        })
        return tab
      }),
    )
    if (focused && this.renaming < 0) this.list.querySelector<HTMLElement>('.fp-doctab.is-active')?.focus()
  }

  /** Nouveau document vide, juste après celui qui est affiché. */
  add(): void {
    if (this.app.reading) return
    if (this.app.addDocument() >= 0) {
      this.app.focus()
      // Le nom se choisit tout de suite.
      this.startRename(this.app.activeIndex)
    }
  }

  /**
   * Glisser un onglet pour le changer de place. Il ne bouge que de gauche à
   * droite, sans sortir de la rangée ; les onglets qu'il dépasse glissent de
   * l'autre côté. Échap (ou un pointeur perdu) annule.
   */
  private pointerDown(e: PointerEvent, from: number, tab: HTMLElement): void {
    // Un geste précédent dont le relâchement s'est perdu se termine ici.
    this.endGesture?.()
    if (e.button !== 0 || this.app.reading || this.renaming >= 0 || this.drag) return
    const tabs = [...this.list.querySelectorAll<HTMLElement>('.fp-doctab')]
    if (tabs.length < 2) return
    const startX = e.clientX
    const id = e.pointerId
    let started = false
    /** Le pointeur a fait glisser l'onglet (même si Échap a annulé). */
    let dragged = false
    let target = from
    let dx = 0
    let rects: DOMRect[] = []
    let shift = 0
    const listBox = () => this.list.getBoundingClientRect()

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id || (dragged && !started)) return
      dx = ev.clientX - startX
      if (!started) {
        if (Math.abs(dx) < 5) return
        started = true
        dragged = true
        rects = tabs.map((t) => t.getBoundingClientRect())
        // Place prise par l'onglet saisi (sa largeur et l'écart qui le suit).
        const gap = tabs.length > 1 ? Math.abs((from < tabs.length - 1 ? rects[from + 1].left - rects[from].right : rects[from].left - rects[from - 1].right)) : 0
        shift = rects[from].width + gap
        tab.setPointerCapture(id)
        tab.classList.add('is-dragging')
        this.list.classList.add('is-reordering')
        this.drag = { stop }
        closePopovers()
      }
      ev.preventDefault()
      // Sans sortir de la rangée visible.
      const box = listBox()
      dx = Math.max(box.left - rects[from].left, Math.min(box.right - rects[from].right, dx))
      tab.style.transform = `translateX(${dx}px)`
      const center = rects[from].left + rects[from].width / 2 + dx
      target = from
      tabs.forEach((t, j) => {
        if (j === from) return
        const c = rects[j].left + rects[j].width / 2
        let off = 0
        if (j > from && center > c) {
          off = -shift
          target++
        } else if (j < from && center < c) {
          off = shift
          target--
        }
        t.style.transform = off ? `translateX(${off}px)` : ''
      })
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      if (dragged) {
        // Le clic qui suit (s'il arrive) ne change pas de document ; sinon, oublié.
        this.swallowClick = true
        setTimeout(() => (this.swallowClick = false), 0)
      }
      stop(true)
      unlisten()
    }
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      stop(false)
      unlisten()
    }
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !started) return
      ev.preventDefault()
      ev.stopPropagation()
      // Le relâchement qui suit est encore écouté (pour ignorer son clic).
      stop(false)
    }
    const lost = () => {
      stop(false)
      unlisten()
    }
    const unlisten = () => {
      if (this.endGesture === lost) this.endGesture = null
      window.removeEventListener('blur', lost)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, true)
    }
    const stop = (keep: boolean) => {
      if (!started) return
      started = false
      if (tab.hasPointerCapture(id)) tab.releasePointerCapture(id)
      const left = rects[from].left + dx
      this.drag = null
      this.list.classList.remove('is-reordering')
      tab.classList.remove('is-dragging')
      for (const t of tabs) t.style.transform = ''
      if (keep && target !== from) this.app.moveDocument(from, target)
      else this.render()
      // L'onglet lâché glisse de là où il est jusqu'à sa place.
      const landed = this.list.querySelectorAll<HTMLElement>('.fp-doctab')[keep ? target : from]
      if (!landed) return
      const off = left - landed.getBoundingClientRect().left
      if (Math.abs(off) < 1) return
      landed.style.transition = 'none'
      landed.style.transform = `translateX(${off}px)`
      void landed.offsetWidth
      landed.style.transition = ''
      landed.style.transform = ''
    }
    this.endGesture = lost
    window.addEventListener('blur', lost)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
  }

  private key(e: KeyboardEvent): void {
    const tabs = [...this.list.querySelectorAll<HTMLElement>('.fp-doctab')]
    const i = tabs.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
      next.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      tabs[e.key === 'Home' ? 0 : tabs.length - 1].focus()
    } else if (e.key === 'F2') {
      e.preventDefault()
      this.startRename(i, true)
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault()
      this.menu(i, tabs[i])
    } else if (e.key === 'Delete' && !this.app.reading) {
      e.preventDefault()
      this.remove(i)
    }
  }

  private startRename(i: number, byKey = false): void {
    if (this.app.reading) return
    this.renaming = i
    this.renameByKey = byKey
    this.render()
  }

  private renameField(i: number, title: string): HTMLElement {
    const input = h('input', { type: 'text', class: 'fp-doctab__input', value: title, maxlength: '500', 'aria-label': t('docs.renameLabel'), 'data-doc-rename': '' }) as HTMLInputElement
    let done = false
    const finish = (keep: boolean, byKey = false) => {
      if (done) return
      done = true
      this.renaming = -1
      if (keep && input.value.trim() && input.value.trim() !== title) this.app.renameDocument(i, input.value)
      this.sig = ''
      this.render()
      // Au clavier (F2), retour sur l'onglet ; sinon, on écrit dans le document
      // (et l'onglet ne garde pas le contour du focus clavier).
      // (Quand on clique ailleurs, le focus va là où l'on a cliqué.)
      if (!byKey) return
      if (this.renameByKey) this.list.querySelector<HTMLElement>('.fp-doctab.is-active')?.focus()
      else this.app.focus()
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(true, true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(false, true)
      }
    })
    input.addEventListener('blur', () => finish(true))
    requestAnimationFrame(() => {
      input.focus()
      input.select()
    })
    return input
  }

  private menu(i: number, anchor: HTMLElement): void {
    closePopovers()
    const n = this.app.documents.length
    const ro = this.app.reading
    const items = [
      popItem(t('docs.rename'), () => this.startRename(i), { 'data-doc-action': 'rename', disabled: ro }),
      popItem(t('docs.duplicate'), () => void this.app.duplicateDocument(i), { 'data-doc-action': 'duplicate', disabled: ro }),
      popItem(t('docs.moveLeft'), () => this.app.moveDocument(i, i - 1), { 'data-doc-action': 'left', disabled: ro || i === 0 }),
      popItem(t('docs.moveRight'), () => this.app.moveDocument(i, i + 1), { 'data-doc-action': 'right', disabled: ro || i === n - 1 }),
      popItem(t('docs.delete'), () => this.remove(i), { 'data-doc-action': 'delete', disabled: ro || n < 2 }),
    ]
    new Popover({ anchor, name: 'doc-tab', content: h('div', { class: 'fp-pop__list', role: 'menu' }, ...items) })
  }

  /** Supprimer un document (après confirmation), annulable juste après. */
  async remove(i: number): Promise<void> {
    const d = this.app.documents[i]
    if (!d || this.app.documents.length < 2) return
    const choice = await openDialog({
      name: 'doc-delete',
      title: t('docs.deleteTitle', { title: d.title }),
      body: [h('p', {}, t('docs.deleteBody'))],
      actions: [
        { label: t('action.cancel'), value: 'cancel' },
        { label: t('docs.delete').replace(/…$/, ''), value: 'delete', primary: true, danger: true },
      ],
    }).result
    if (choice !== 'delete') return
    const undo = this.app.removeDocument(i)
    if (undo) toast(t('docs.deleted', { title: d.title }), { kind: 'info', timeout: 10000, action: { label: t('menu.undo'), run: undo } })
  }
}
