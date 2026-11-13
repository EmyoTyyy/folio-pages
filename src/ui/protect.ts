// Protéger le document par un mot de passe (phase 7) : le choisir, le changer,
// le retirer. Rien n'est chiffré ici : l'application chiffre au prochain
// enregistrement (app.setPassword).

import type { FolioApp } from '../app'
import { passwordStrength } from '../file/crypto'
import type { Key } from '../i18n/dict'
import { t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h } from './dom'

const MIN_LENGTH = 6

function passwordField(id: string, label: string): { row: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { type: 'password', class: 'fp-input', id, 'data-field': id, autocomplete: 'new-password', spellcheck: 'false' }) as HTMLInputElement
  const show = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'aria-pressed': 'false' }, t('protect.show'))
  show.addEventListener('click', () => {
    const visible = input.type === 'text'
    input.type = visible ? 'password' : 'text'
    show.setAttribute('aria-pressed', String(!visible))
  })
  return { row: h('div', { class: 'fp-form__row' }, h('label', { class: 'fp-label', for: id }, label), h('div', { class: 'fp-protect__row' }, input, show)), input }
}

/** Choisir (ou changer) le mot de passe. */
function chooseDialog(app: FolioApp, changing: boolean): void {
  const pw = passwordField('protect-password', t('protect.password'))
  const confirm = passwordField('protect-confirm', t('protect.confirm'))
  const meter = h('div', { class: 'fp-protect__meter', 'data-strength': '0' }, h('span', {}), h('em', {}))
  const accept = h('input', { type: 'checkbox', 'data-field': 'protect-accept' }) as HTMLInputElement
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  pw.input.addEventListener('input', () => {
    const s = passwordStrength(pw.input.value)
    meter.dataset.strength = pw.input.value ? String(s) : '0'
    ;(meter.querySelector('em') as HTMLElement).textContent = pw.input.value ? t(`protect.strength.${s}` as Key) : ''
  })
  openDialog({
    name: 'protect',
    title: changing ? t('protect.change') : t('protect.title'),
    focus: pw.input,
    body: [
      h('p', {}, t('protect.intro')),
      pw.row,
      meter,
      confirm.row,
      h('p', { class: 'fp-warn fp-protect__warning' }, t('protect.warning')),
      h('label', { class: 'fp-check' }, accept, h('span', {}, t('protect.understand'))),
      error,
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('protect.apply'),
        value: 'ok',
        primary: true,
        run: () => {
          const p = pw.input.value
          if ([...p].length < MIN_LENGTH) error.textContent = t('protect.tooShort')
          else if (p !== confirm.input.value) error.textContent = t('protect.mismatch')
          else if (!accept.checked) error.textContent = t('protect.mustAccept')
          else {
            app.setPassword(p)
            toast(t('protect.done'), { kind: 'success', timeout: 7000 })
            return true
          }
          return false
        },
      },
    ],
  })
}

/** Fichier → Protéger par mot de passe…, Révision → Protéger. */
export function protectDialog(app: FolioApp): void {
  if (app.reading && app.lockedReadOnly) return
  if (!app.isProtected) return chooseDialog(app, false)
  openDialog({
    name: 'protect-manage',
    title: t('protect.changeTitle'),
    body: [h('p', {}, t('protect.isOn')), h('p', { class: 'fp-warn' }, t('protect.warning'))],
    actions: [
      {
        label: t('protect.remove'),
        value: 'remove',
        danger: true,
        run: () => {
          app.setPassword(null)
          toast(t('protect.removed'), { kind: 'info', timeout: 7000 })
        },
      },
      { label: t('action.cancel'), value: 'cancel' },
      { label: t('protect.change'), value: 'change', primary: true, run: () => void setTimeout(() => chooseDialog(app, true), 0) },
    ],
  })
}
