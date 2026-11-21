// Outils d'écriture de la 0.11 : encadrés (menu du type, insertion).

import type { FolioApp } from '../app'
import { calloutAt, insertCallout, removeCallout } from '../editor/callout'
import { schema } from '../editor/schema'
import { CALLOUT_KINDS, type CalloutKind } from '../format/types'
import type { Key } from '../i18n/dict'
import { t } from '../i18n/i18n'
import { h } from './dom'
import { toast } from './dialog'
import { Popover, popItem } from './popover'
import { RIBBON_ICONS as I } from './icons'
import { split, type Ctl } from './ribbon'

/** Une ligne de menu par type d'encadré, avec sa pastille de couleur. */
function kindItems(current: CalloutKind | null, pick: (k: CalloutKind) => void): HTMLElement[] {
  return CALLOUT_KINDS.map((k) => {
    const label = h('span', { class: 'fp-callout-item', 'data-kind': k }, h('span', { class: 'fp-callout-item__dot' }), t(`callout.${k}` as Key))
    return popItem(label, () => pick(k), { 'data-callout': k, 'aria-checked': current ? String(current === k) : null })
  })
}

/** Menu de l'icône d'un encadré : changer de type, renommer, retirer. */
export function calloutMenu(app: FolioApp, pos: number, anchor: HTMLElement): void {
  const node = app.state.doc.nodeAt(pos)
  if (!node || node.type !== schema.nodes.callout) return
  const list = h(
    'div',
    { class: 'fp-pop__list' },
    ...kindItems(node.attrs.kind as CalloutKind, (k) => app.view.dispatch(app.state.tr.setNodeMarkup(pos, null, { ...node.attrs, kind: k }))),
    h('div', { class: 'fp-pop__sep', role: 'separator' }),
    popItem(t('callout.renameAction'), () => (anchor.parentElement?.querySelector('.fp-callout__title') as HTMLElement | null)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })), { 'data-callout-action': 'rename' }),
    popItem(t('callout.remove'), () => {
      const n = app.state.doc.nodeAt(pos)
      if (n?.type === schema.nodes.callout) app.view.dispatch(app.state.tr.replaceWith(pos, pos + n.nodeSize, n.content).scrollIntoView())
      app.focus()
    }, { 'data-callout-action': 'remove' }),
  )
  new Popover({ anchor, content: list, name: 'callout-kind' })
}

/** Insertion → Encadré : un clic pour une remarque ; le menu pour les autres types. */
export function calloutButton(app: FolioApp): Ctl {
  const insert = (k: CalloutKind) => {
    if (!app.run(insertCallout(k))) toast(t('callout.notHere'), { kind: 'info' })
  }
  return split({
    id: 'callout',
    label: t('rb.callout'),
    icon: I.callout,
    text: true,
    active: () => !!calloutAt(app.state),
    run: () => insert('note'),
    menu: () => {
      const here = calloutAt(app.state)
      return h(
        'div',
        { class: 'fp-pop__list' },
        ...kindItems((here?.node.attrs.kind as CalloutKind) ?? null, insert),
        ...(here ? [h('div', { class: 'fp-pop__sep', role: 'separator' }), popItem(t('callout.remove'), () => void app.run(removeCallout), { 'data-callout-action': 'remove' })] : []),
      )
    },
  })
}
