// Écrans affichés à la place de l'éditeur quand le document ne peut pas être
// ouvert tel quel. Jamais de page blanche : on explique, et on propose une suite.

import type { JsonError } from '../format/json'
import { t } from '../i18n/i18n'
import { describeJsonError, writeClipboard } from './actions'
import { openDialog, toast } from './dialog'
import { h, icon } from './dom'
import { MARK } from './icons'

interface ScreenAction {
  label: string
  id: string
  primary?: boolean
  help?: string
  run: () => void
}

function screen(name: string, title: string, paragraphs: string[], actions: ScreenAction[]): HTMLElement {
  const el = h(
    'div',
    { class: 'fp-screen', 'data-screen': name, role: 'alertdialog', 'aria-labelledby': 'fp-screen-title' },
    h(
      'div',
      { class: 'fp-screen__card' },
      h('div', { class: 'fp-screen__mark' }, icon(MARK)),
      h('h1', { class: 'fp-screen__title', id: 'fp-screen-title' }, title),
      ...paragraphs.map((p) => h('p', {}, p)),
      h(
        'div',
        { class: 'fp-screen__actions' },
        ...actions.map((a) =>
          h(
            'div',
            { class: 'fp-screen__action' },
            h('button', { type: 'button', class: 'fp-btn' + (a.primary ? ' fp-btn--primary' : ''), 'data-action': a.id, onclick: a.run }, a.label),
            a.help ? h('span', { class: 'fp-muted' }, a.help) : null,
          ),
        ),
      ),
    ),
  )
  document.body.appendChild(el)
  el.querySelector<HTMLButtonElement>('.fp-btn--primary, .fp-btn')?.focus()
  return el
}

export function showRaw(raw: string): void {
  const area = h('textarea', { class: 'fp-code fp-code--tall', readonly: true, spellcheck: 'false', 'aria-label': t('broken.rawTitle') }) as HTMLTextAreaElement
  area.value = raw
  openDialog({
    name: 'raw',
    title: t('broken.rawTitle'),
    wide: true,
    body: [area],
    focus: area,
    actions: [
      {
        label: t('action.copy'),
        value: 'copy',
        run: async () => {
          if (await writeClipboard(raw)) toast(t('copied'), { kind: 'success' })
          else area.select()
          return false
        },
      },
      { label: t('action.close'), value: 'close', primary: true },
    ],
  })
}

export interface BrokenChoices {
  recover: () => void
  blank: () => void
}

/** JSON illisible : l'erreur, sa ligne, et trois issues. */
export function brokenScreen(error: JsonError, raw: string, choices: BrokenChoices): HTMLElement {
  const el = screen(
    'broken',
    t('broken.title'),
    [t('broken.body', { line: error.line, column: error.column, message: describeJsonError(error) })],
    [
      { id: 'recover', label: t('broken.recover'), primary: true, help: t('broken.recoverHelp'), run: () => (el.remove(), choices.recover()) },
      { id: 'raw', label: t('broken.showRaw'), run: () => showRaw(raw) },
      { id: 'blank', label: t('broken.startBlank'), run: () => (el.remove(), choices.blank()) },
    ],
  )
  return el
}

export function refusedScreen(kind: 'encrypted' | 'not-a-document' | 'too-large', raw: string, size = 0): HTMLElement {
  const [title, body] =
    kind === 'encrypted'
      ? [t('refused.encryptedTitle'), t('refused.encryptedBody')]
      : kind === 'too-large'
        ? [t('refused.tooLargeTitle'), t('refused.tooLargeBody', { size: size.toLocaleString() })]
        : [t('refused.notDocumentTitle'), t('refused.notDocumentBody')]
  return screen(kind, title, [body], kind === 'too-large' ? [] : [{ id: 'raw', label: t('broken.showRaw'), run: () => showRaw(raw) }])
}

export function fatalScreen(message: string, raw: string | null): HTMLElement {
  document.getElementById('folio-splash')?.remove()
  return screen('fatal', t('fatal.title'), [t('fatal.body', { message })], raw ? [{ id: 'copy', label: t('fatal.copy'), primary: true, run: () => void writeClipboard(raw).then((ok) => ok ? toast(t('copied'), { kind: 'success' }) : showRaw(raw)) }] : [])
}


/**
 * Document protégé : l'écran de mot de passe. `tryOpen` déchiffre et renvoie
 * false si le mot de passe est faux ; l'écran reste alors, avec un message.
 */
export function unlockScreen(tryOpen: (password: string) => Promise<boolean>): HTMLElement {
  const input = h('input', { type: 'password', class: 'fp-input fp-unlock__input', id: 'fp-unlock-password', autocomplete: 'current-password', spellcheck: 'false', 'aria-label': t('protect.password') }) as HTMLInputElement
  const error = h('p', { class: 'fp-field-error', role: 'alert', id: 'fp-unlock-error' })
  const button = h('button', { type: 'submit', class: 'fp-btn fp-btn--primary', 'data-action': 'unlock' }, t('unlock.open')) as HTMLButtonElement
  const form = h('form', { class: 'fp-unlock' }, h('label', { class: 'fp-label', for: 'fp-unlock-password' }, t('protect.password')), h('div', { class: 'fp-unlock__row' }, input, button), error)
  const el = h(
    'div',
    { class: 'fp-screen', 'data-screen': 'locked', role: 'dialog', 'aria-labelledby': 'fp-screen-title' },
    h('div', { class: 'fp-screen__card' }, h('div', { class: 'fp-screen__mark' }, icon(MARK)), h('h1', { class: 'fp-screen__title', id: 'fp-screen-title' }, t('unlock.title')), h('p', {}, t('unlock.body')), form, h('p', { class: 'fp-muted' }, t('unlock.lost'))),
  )
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!input.value || button.disabled) return
    button.disabled = true
    error.textContent = t('unlock.working')
    const ok = await tryOpen(input.value)
    if (ok) {
      el.remove()
      return
    }
    button.disabled = false
    error.textContent = t('unlock.wrong')
    input.select()
  })
  document.body.appendChild(el)
  input.focus()
  return el
}
