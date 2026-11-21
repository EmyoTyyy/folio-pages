// Révision → Comparer : ce document et une version précédente (un autre
// fichier, ou une version gardée dans ce navigateur). Le résultat s'ouvre dans
// un nouvel onglet : la version la plus récente, avec les différences en
// modifications suivies, à accepter ou refuser. Ce document n'est pas touché.

import type { FolioApp } from '../app'
import { readOpened } from '../file/open'
import type { Version } from '../file/versions'
import { compareDocuments } from '../format/compare'
import { mintId, type FolioDoc } from '../format/types'
import type { Key } from '../i18n/dict'
import { formatDate, t } from '../i18n/i18n'
import { settings } from '../settings'
import { openDialog, toast } from './dialog'
import { h } from './dom'
import { RIBBON_ICONS as I } from './icons'
import { openInNewTab } from './mailings'
import { pickFile } from './panels'
import { popItem } from './popover'
import { dropdown, type Ctl } from './ribbon'

const TYPES = '.html,.htm,.docx,.docm,.dotx,.odt,.ott,.rtf,.md,.markdown,.txt,.json'

/** Compare `earlier` (la version d'origine) à ce document, et ouvre le résultat. */
export function showComparison(app: FolioApp, earlier: FolioDoc, label: string): void {
  const now = new Date().toISOString()
  const author = settings().authorName.trim() || t('compare.author')
  const current = app.getDoc()
  const { doc, stats } = compareDocuments(earlier, current, { author, date: now })
  const title = t('compare.title', { title: current.meta.title || app.displayTitle(), label })
  const result: FolioDoc = { ...doc, id: mintId(), template: false, readOnly: false, meta: { ...doc.meta, title, created: now, modified: '' } }
  const total = stats.insertions + stats.deletions + stats.formatting
  if (!total && !stats.objects) {
    toast(t('compare.same', { label }), { kind: 'info', timeout: 8000 })
    return
  }
  const how = openInNewTab(result, `${app.suggestedFileName().replace(/\.html?$/i, '')} (${t('compare.suffix')}).html`)
  const parts = [t('review.inserts', { n: stats.insertions }), t('review.deletes', { n: stats.deletions }), t('review.formats', { n: stats.formatting })]
  const objects = stats.objects ? ` ${t('compare.objects', { n: stats.objects })}` : ''
  toast(`${t(how === 'tab' ? 'compare.openedTab' : 'compare.downloaded')} ${parts.join(', ')}.${objects}`, { kind: 'success', timeout: 12000 })
}

/** Révision → Comparer → avec un fichier : le fichier choisi est la version précédente. */
export async function compareWithFile(app: FolioApp, file?: File | null): Promise<void> {
  const picked = file ?? (await pickFile(TYPES))
  if (!picked) return
  const o = await readOpened(picked, null)
  if (o.kind !== 'document') {
    const key: Key = o.kind === 'encrypted' ? 'obj.protected' : o.kind === 'too-large' ? 'open.tooLarge' : o.kind === 'blank-app' ? 'obj.blankApp' : 'open.unreadable'
    toast(t(key, { name: picked.name }), { kind: 'error', timeout: 9000 })
    return
  }
  showComparison(app, o.doc, picked.name)
}

/** Révision → Comparer → avec une version enregistrée : la liste des versions de ce navigateur. */
export async function compareWithVersion(app: FolioApp): Promise<void> {
  const versions = await app.versions()
  const list = h('div', { class: 'fp-versions', 'data-field': 'compare-versions' })
  let dlg: { close: (v?: string | null) => void } | null = null
  if (!versions.length) list.append(h('p', { class: 'fp-muted' }, t('compare.noVersions')))
  for (const v of versions) {
    const go = h('button', { type: 'button', class: 'fp-btn fp-btn--small fp-btn--primary', 'data-action': 'compare-version' }, t('compare.go'))
    go.addEventListener('click', async () => {
      const doc = await app.versionDoc(v as Version)
      if (!doc) {
        toast(t('compare.unreadable'), { kind: 'error' })
        return
      }
      dlg?.close('done')
      showComparison(app, doc, formatDate(v.at))
    })
    list.append(h('div', { class: 'fp-versions__row' }, h('div', { class: 'fp-versions__info' }, h('strong', {}, formatDate(v.at)), h('span', { class: 'fp-muted' }, `${v.title} · ${t('versions.words', { n: String(v.words) })}`)), go))
  }
  dlg = openDialog({
    name: 'compare-versions',
    title: t('compare.versionsTitle'),
    wide: true,
    body: [h('p', { class: 'fp-muted' }, t('compare.versionsHelp')), list],
    actions: [{ label: t('action.close'), value: 'close', primary: true }],
  })
}

/** Le bouton Comparer du ruban (onglet Révision). */
export function compareMenu(app: FolioApp): Ctl {
  return dropdown({
    id: 'compare',
    label: t('rb.compare'),
    icon: I.compare,
    large: true,
    menu: () =>
      h(
        'div',
        { class: 'fp-pop__list', role: 'menu' },
        popItem(t('compare.withFile'), () => void compareWithFile(app), { 'data-item': 'compare-file' }),
        popItem(t('compare.withVersion'), () => void compareWithVersion(app), { 'data-item': 'compare-version' }),
      ),
  })
}
