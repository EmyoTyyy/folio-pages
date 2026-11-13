// Fenêtres modales (élément <dialog> natif : focus piégé, Échap, accessibilité)
// et notifications éphémères.

import { t } from '../i18n/i18n'
import { h, icon } from './dom'
import { ICONS } from './icons'

export interface DialogAction {
  label: string
  value: string
  primary?: boolean
  danger?: boolean
  /** Renvoyer false garde la fenêtre ouverte (validation d'un formulaire). */
  run?: () => boolean | void | Promise<boolean | void>
}

export interface DialogOptions {
  title: string
  body: (Node | string)[]
  actions: DialogAction[]
  /** Élément qui reçoit le focus à l'ouverture. */
  focus?: HTMLElement
  wide?: boolean
  /** Nom stable pour les tests et le style. */
  name?: string
}

export interface DialogHandle {
  el: HTMLDialogElement
  result: Promise<string | null>
  close: (value?: string | null) => void
}

export function openDialog(o: DialogOptions): DialogHandle {
  const previous = document.activeElement as HTMLElement | null
  let resolve!: (v: string | null) => void
  const result = new Promise<string | null>((r) => (resolve = r))
  let done = false

  const titleId = 'fp-dlg-' + Math.random().toString(36).slice(2)
  const el = h('dialog', {
    class: 'fp-dialog' + (o.wide ? ' fp-dialog--wide' : ''),
    'aria-labelledby': titleId,
    'data-dialog': o.name ?? null,
  })
  const close = (value: string | null = null) => {
    if (done) return
    done = true
    if (el.open) el.close()
    el.remove()
    resolve(value)
    if (previous && previous.isConnected) previous.focus({ preventScroll: true })
  }

  const buttons = o.actions.map((a) =>
    h(
      'button',
      {
        type: 'button',
        class: 'fp-btn' + (a.primary ? ' fp-btn--primary' : '') + (a.danger ? ' fp-btn--danger' : ''),
        'data-action': a.value,
        onclick: (async () => {
          if (a.run) {
            const keep = await a.run()
            if (keep === false) return
          }
          close(a.value)
        }) as EventListener,
      },
      a.label,
    ),
  )

  el.append(
    h(
      'div',
      { class: 'fp-dialog__head' },
      h('h2', { id: titleId, class: 'fp-dialog__title' }, o.title),
      h(
        'button',
        { type: 'button', class: 'fp-iconbtn', 'aria-label': t('action.close'), onclick: () => close(null) },
        icon(ICONS.close),
      ),
    ),
    h('div', { class: 'fp-dialog__body' }, ...o.body),
    h('div', { class: 'fp-dialog__actions' }, ...buttons),
  )
  el.addEventListener('cancel', (e) => {
    e.preventDefault()
    close(null)
  })
  el.addEventListener('close', () => close(el.returnValue || null))
  document.body.appendChild(el)
  el.showModal()
  const target = o.focus ?? buttons.find((_, i) => o.actions[i].primary) ?? buttons[0]
  target?.focus()
  return { el, result, close }
}

export const isDialogOpen = () => !!document.querySelector('dialog.fp-dialog[open]')

// --- notifications ----------------------------------------------------------

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface ToastOptions {
  kind?: ToastKind
  action?: { label: string; run: () => void }
  /** Durée d'affichage (ms) ; 0 = jusqu'à fermeture. */
  timeout?: number
}

let region: HTMLElement | null = null

function toastRegion(): HTMLElement {
  if (region && region.isConnected) return region
  region = h('div', { class: 'fp-toasts', role: 'status', 'aria-live': 'polite' })
  document.body.appendChild(region)
  return region
}

export function toast(message: string, o: ToastOptions = {}): () => void {
  const kind = o.kind ?? 'info'
  const el = h(
    'div',
    { class: `fp-toast fp-toast--${kind}`, 'data-kind': kind },
    icon(kind === 'success' ? ICONS.check : kind === 'info' ? ICONS.info : ICONS.alert),
    h('span', { class: 'fp-toast__text' }, message),
  )
  const dismiss = () => {
    el.classList.add('fp-toast--out')
    setTimeout(() => el.remove(), 180)
  }
  if (o.action) {
    const a = o.action
    el.append(
      h(
        'button',
        {
          type: 'button',
          class: 'fp-toast__action',
          onclick: () => {
            dismiss()
            a.run()
          },
        },
        a.label,
      ),
    )
  }
  el.append(h('button', { type: 'button', class: 'fp-iconbtn fp-toast__close', 'aria-label': t('action.close'), onclick: dismiss }, icon(ICONS.close)))
  toastRegion().appendChild(el)
  const timeout = o.timeout ?? (kind === 'error' || o.action ? 0 : 5000)
  if (timeout > 0) setTimeout(dismiss, timeout)
  return dismiss
}
