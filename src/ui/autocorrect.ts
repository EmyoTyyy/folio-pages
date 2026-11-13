// Fenêtre « Correction automatique » : les options et la liste des
// remplacements (celle de la langue du document). Gardées dans ce navigateur.

import type { FolioApp } from '../app'
import { acLang, AC_LIMITS, builtinList, diffList, effectiveList, validEntry } from '../editor/autocorrect'
import type { Key } from '../i18n/dict'
import { lang, t } from '../i18n/i18n'
import { settings, updateSettings } from '../settings'
import { openDialog, toast } from './dialog'
import { h, icon } from './dom'
import { ICONS } from './icons'

function checkbox(label: string, checked: boolean, field: string): { el: HTMLElement; box: HTMLInputElement } {
  const box = h('input', { type: 'checkbox', 'data-field': field }) as HTMLInputElement
  box.checked = checked
  return { el: h('label', { class: 'fp-check' }, box, h('span', {}, label)), box }
}

export function autoCorrectDialog(app: FolioApp): void {
  const s = settings()
  const docLang = (app.state.doc.attrs.lang as string) || lang()
  const enabled = checkbox(t('ac.enabled'), s.autoCorrect, 'ac-enabled')
  const opts = {
    acQuotes: checkbox(t('ac.quotes'), s.acQuotes, 'ac-quotes'),
    acFrenchSpacing: checkbox(t('ac.frenchSpacing'), s.acFrenchSpacing, 'ac-french'),
    acReplace: checkbox(t('ac.replace'), s.acReplace, 'ac-replace'),
    acCapitalize: checkbox(t('ac.capitalize'), s.acCapitalize, 'ac-capitalize'),
  }
  const group = h('div', { class: 'fp-ac__opts' }, ...Object.values(opts).map((o) => o.el))
  const sync = () => {
    for (const o of Object.values(opts)) o.box.disabled = !enabled.box.checked
    group.classList.toggle('is-off', !enabled.box.checked)
  }
  enabled.box.addEventListener('change', sync)
  sync()

  // La liste de travail : ce qu'on verra une fois enregistré.
  let entries: [string, string][] = [...effectiveList(docLang, s.acCustom, s.acRemoved).entries()]
  const from = h('input', { type: 'text', class: 'fp-input', 'data-field': 'ac-from', maxlength: String(AC_LIMITS.from), 'aria-label': t('ac.from'), placeholder: t('ac.from') }) as HTMLInputElement
  const to = h('input', { type: 'text', class: 'fp-input', 'data-field': 'ac-to', maxlength: String(AC_LIMITS.to), 'aria-label': t('ac.to'), placeholder: t('ac.to') }) as HTMLInputElement
  const add = h('button', { type: 'button', class: 'fp-btn', 'data-ac-add': '' }, t('ac.add'))
  const error = h('p', { class: 'fp-field-error', role: 'alert', 'data-field': 'ac-error' })
  const filter = h('input', { type: 'search', class: 'fp-input', 'data-field': 'ac-filter', placeholder: t('ac.filter'), 'aria-label': t('ac.filter') }) as HTMLInputElement
  const count = h('span', { class: 'fp-muted', 'data-field': 'ac-count' })
  const list = h('div', { class: 'fp-ac__list', role: 'list', 'data-field': 'ac-list' })
  const render = () => {
    const q = filter.value.trim().toLocaleLowerCase()
    list.replaceChildren()
    for (const [k, v] of entries) {
      if (q && !k.toLocaleLowerCase().includes(q) && !v.toLocaleLowerCase().includes(q)) continue
      const del = h('button', { type: 'button', class: 'fp-iconbtn', 'data-ac-remove': k, 'aria-label': t('ac.remove', { from: k }), title: t('ac.remove', { from: k }) }, icon(ICONS.close))
      del.addEventListener('click', () => {
        entries = entries.filter(([x]) => x !== k)
        render()
      })
      // Un clic sur une ligne la reprend dans les champs, pour la modifier.
      const pick = h('button', { type: 'button', class: 'fp-ac__pick', 'data-ac-entry': k }, h('span', { class: 'fp-ac__from' }, k), h('span', { class: 'fp-ac__arrow', 'aria-hidden': 'true' }, '→'), h('span', { class: 'fp-ac__to' }, v))
      pick.addEventListener('click', () => {
        from.value = k
        to.value = v
        to.focus()
      })
      list.append(h('div', { class: 'fp-ac__row', role: 'listitem' }, pick, del))
    }
    count.textContent = t('ac.count', { n: entries.length })
  }
  const addEntry = () => {
    const k = from.value.trim()
    const v = to.value
    if (!validEntry(k, v)) {
      error.textContent = t('ac.invalid')
      return
    }
    error.textContent = ''
    entries = [[k, v] as [string, string], ...entries.filter(([x]) => x !== k)].slice(0, AC_LIMITS.entries)
    from.value = ''
    to.value = ''
    filter.value = ''
    render()
    from.focus()
  }
  add.addEventListener('click', addEntry)
  for (const inp of [from, to]) inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      addEntry()
    }
  })
  filter.addEventListener('input', render)
  const reset = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-ac-reset': '' }, t('ac.reset'))
  reset.addEventListener('click', () => {
    entries = [...effectiveList(docLang, [], []).entries()]
    render()
  })
  render()

  openDialog({
    name: 'autocorrect',
    title: t('ac.title'),
    wide: true,
    body: [
      enabled.el,
      group,
      h('p', { class: 'fp-form__hint' }, t('ac.hint')),
      h('h3', { class: 'fp-form__title' }, t('ac.listTitle', { lang: t(`ac.lang.${acLang(docLang)}` as Key) })),
      h('div', { class: 'fp-ac__add' }, from, h('span', { class: 'fp-ac__arrow', 'aria-hidden': 'true' }, '→'), to, add),
      error,
      h('div', { class: 'fp-ac__tools' }, filter, count, reset),
      list,
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          // Un remplacement tapé mais pas encore ajouté compte aussi.
          if (from.value.trim() && to.value) addEntry()
          const { custom, removed } = diffList(docLang, entries)
          // Les entrées des autres langues restent telles quelles.
          const own = new Map(builtinList(docLang))
          const others = settings().acRemoved.filter((k) => !own.has(k))
          updateSettings({
            autoCorrect: enabled.box.checked,
            acQuotes: opts.acQuotes.box.checked,
            acFrenchSpacing: opts.acFrenchSpacing.box.checked,
            acReplace: opts.acReplace.box.checked,
            acCapitalize: opts.acCapitalize.box.checked,
            acCustom: custom,
            acRemoved: [...new Set([...others, ...removed])],
          })
          toast(t('ac.saved'), { kind: 'success' })
        },
      },
    ],
  })
}
