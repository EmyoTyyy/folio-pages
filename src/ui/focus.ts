// Mode Focus (Affichage → Immersif → Focus) : rien que la page. Le ruban, la
// barre de titre, la règle, la barre d'état et les volets s'effacent ; Échap
// ou le bouton en haut à droite les ramènent.

import type { FolioApp } from '../app'
import { t } from '../i18n/i18n'
import { h, icon } from './dom'
import { RIBBON_ICONS as I } from './icons'

let exitBtn: HTMLElement | null = null
let onKey: ((e: KeyboardEvent) => void) | null = null

export const isFocusMode = (): boolean => document.documentElement.classList.contains('fp-focus-mode')

export function setFocusMode(app: FolioApp, on: boolean): void {
  if (on === isFocusMode()) return
  document.documentElement.classList.toggle('fp-focus-mode', on)
  if (on) {
    exitBtn = h('button', { type: 'button', class: 'fp-focus-exit fp-btn fp-btn--small', id: 'fp-focus-exit', title: t('rb.focusExit'), 'aria-label': t('rb.focusExit') }, icon(I.focus), h('span', {}, t('rb.focusExit')))
    exitBtn.addEventListener('click', () => setFocusMode(app, false))
    document.body.append(exitBtn)
    onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open], .fp-popover, [data-context-menu]')) {
        e.preventDefault()
        setFocusMode(app, false)
      }
    }
    document.addEventListener('keydown', onKey)
  } else {
    exitBtn?.remove()
    exitBtn = null
    if (onKey) document.removeEventListener('keydown', onKey)
    onKey = null
  }
  window.dispatchEvent(new Event('resize'))
  app.notifyUi()
  app.focus()
}
