// Sens d'écriture : paragraphes de droite à gauche, texte vertical des cellules.

import { setCellAttr } from 'prosemirror-tables'
import { paraDir, setDirection } from '../editor/commands'
import { tableAt } from '../editor/tables'
import { t } from '../i18n/i18n'
import { h, icon } from './dom'
import { RIBBON_ICONS as I } from './icons'
import { popItem } from './popover'
import type { FolioApp as App } from '../app'

/** Texte vertical de la cellule du curseur (null : horizontal). */
export function cellTextDir(app: App): 'tbrl' | 'btlr' | null {
  const $from = app.state.selection.$from
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell') return (node.attrs.textDir as 'tbrl' | 'btlr' | null) ?? null
  }
  return null
}

const item = (svg: string, label: string, run: () => void, checked: boolean, data: Record<string, string>) =>
  popItem(h('span', { class: 'fp-pop__icon-row' }, icon(svg), label), run, { role: 'menuitemradio', 'aria-checked': String(checked), ...data })

/** Menu « Orientation du texte » : sens du paragraphe, puis texte des cellules. */
export function textDirectionMenu(app: App): HTMLElement {
  const dir = paraDir(app.state)
  const inTable = !!tableAt(app.state)
  const cell = cellTextDir(app)
  const list = h(
    'div',
    { class: 'fp-pop__list', role: 'menu' },
    h('div', { class: 'fp-pop__heading' }, t('dir.paragraph')),
    item(I.dirLtr, t('dir.ltr'), () => app.run(setDirection('ltr')), dir === 'ltr', { 'data-dir': 'ltr' }),
    item(I.dirRtl, t('dir.rtl'), () => app.run(setDirection('rtl')), dir === 'rtl', { 'data-dir': 'rtl' }),
    h('div', { class: 'fp-pop__heading' }, t('dir.cells')),
  )
  const cells: [string, string, 'tbrl' | 'btlr' | null][] = [
    [I.textHorizontal, t('textdir.horizontal'), null],
    [I.textDown, t('textdir.down'), 'tbrl'],
    [I.textUp, t('textdir.up'), 'btlr'],
  ]
  for (const [icon, label, v] of cells) {
    const b = item(icon, label, () => app.run(setCellAttr('textDir', v)), inTable && cell === v, { 'data-text-dir': v ?? 'none' })
    if (!inTable) b.disabled = true
    list.append(b)
  }
  if (!inTable) list.append(h('p', { class: 'fp-pop__hint' }, t('dir.cellsHint')))
  return list
}
