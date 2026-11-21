// Onglet Développeur : champs de formulaire (texte, liste déroulante, date,
// case à cocher), leurs propriétés, vider le formulaire, et le verrou
// « formulaire seulement » (seuls les champs se remplissent).

import type { FolioApp } from '../app'
import { clearForm, FORM_FILL, formAt, insertFormField, setFormsOnly } from '../editor/forms'
import type { FormKind } from '../format/types'
import { t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h } from './dom'
import { RIBBON_ICONS as I } from './icons'
import { button, col, type Group } from './ribbon'

export const formsLocked = (app: FolioApp): boolean => !!app.state.doc.attrs.formsOnly

function insert(app: FolioApp, kind: FormKind): void {
  if (formsLocked(app)) return void toast(t('form.lockedHint'), { kind: 'info' })
  const attrs = kind === 'dropdown' ? { options: [t('form.option', { n: 1 }), t('form.option', { n: 2 })] } : {}
  if (!app.run(insertFormField(kind, attrs))) return void toast(t('form.notHere'), { kind: 'info' })
  if (kind === 'dropdown') formPropertiesDialog(app)
}

/** Propriétés du champ sélectionné : nom, texte d'aide, choix de la liste. */
export function formPropertiesDialog(app: FolioApp): void {
  const at = formAt(app.state)
  if (!at) return void toast(t('form.selectFirst'), { kind: 'info' })
  const a = at.node.attrs
  const name = h('input', { type: 'text', class: 'fp-input', maxlength: '64', 'data-field': 'form-name', value: a.name }) as HTMLInputElement
  const placeholder = h('input', { type: 'text', class: 'fp-input', maxlength: '200', 'data-field': 'form-placeholder', value: a.placeholder }) as HTMLInputElement
  const options = h('textarea', { class: 'fp-input', rows: '5', 'data-field': 'form-options' }) as HTMLTextAreaElement
  options.value = (a.options as string[]).join('\n')
  const row = (label: string, control: HTMLElement, hint?: string) => h('div', { class: 'fp-form__row' }, h('label', { class: 'fp-label' }, label, control), hint ? h('p', { class: 'fp-form__hint' }, hint) : null)
  openDialog({
    name: 'form-props',
    title: t('form.propsTitle', { kind: t(`form.kind.${a.kind as FormKind}`) }),
    body: [
      h(
        'div',
        { class: 'fp-form' },
        row(t('form.name'), name, t('form.nameHint')),
        a.kind === 'checkbox' ? null : row(t('form.placeholder'), placeholder),
        a.kind === 'dropdown' ? row(t('form.options'), options, t('form.optionsHint')) : null,
      ),
    ],
    focus: a.kind === 'dropdown' ? options : name,
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const now = formAt(app.state)
          if (!now) return
          const list = [...new Set(options.value.split('\n').map((x) => x.trim()).filter(Boolean))].slice(0, 50).map((x) => x.slice(0, 200))
          const value = a.kind === 'dropdown' && !list.includes(now.node.attrs.value) ? '' : now.node.attrs.value
          app.view.dispatch(app.state.tr.setNodeMarkup(now.pos, null, { ...now.node.attrs, name: name.value.trim().slice(0, 64), placeholder: placeholder.value.trim().slice(0, 200), options: a.kind === 'dropdown' ? list : [], value }).setMeta(FORM_FILL, true))
          app.focus()
        },
      },
    ],
  })
}

export function developerGroups(app: FolioApp): Group[] {
  return [
    {
      id: 'form-controls',
      label: t('form.controls'),
      controls: [
        button({ id: 'form-text', label: t('form.kind.text'), icon: I.formText, large: true, run: () => insert(app, 'text') }),
        col(
          button({ id: 'form-dropdown', label: t('form.kind.dropdown'), icon: I.formDropdown, text: true, run: () => insert(app, 'dropdown') }),
          button({ id: 'form-date', label: t('form.kind.date'), icon: I.date, text: true, run: () => insert(app, 'date') }),
          button({ id: 'form-checkbox', label: t('form.kind.checkbox'), icon: I.checklist, text: true, run: () => insert(app, 'checkbox') }),
        ),
        col(
          button({ id: 'form-props', label: t('form.props'), icon: I.styles, text: true, enabled: () => !!formAt(app.state) && !formsLocked(app), run: () => formPropertiesDialog(app) }),
          button({ id: 'form-clear', label: t('form.clear'), icon: I.erase, text: true, run: () => void app.run(clearForm) }),
        ),
      ],
    },
    {
      id: 'form-protect',
      label: t('form.protectGroup'),
      controls: [
        button({
          id: 'forms-only',
          label: t('form.lock'),
          icon: I.lock,
          large: true,
          active: () => formsLocked(app),
          run: () => {
            const on = !formsLocked(app)
            app.run(setFormsOnly(on))
            toast(t(on ? 'form.lockedOn' : 'form.lockedOff'), { kind: 'info' })
          },
        }),
      ],
    },
  ]
}
