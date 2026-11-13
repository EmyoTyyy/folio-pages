// Mises à jour, nouveautés et mode hors ligne, côté interface (phase 7).

import type { FolioApp } from '../app'
import { isOffline, setOffline } from '../net'
import { RELEASE_NOTES } from '../release-notes'
import { APP_VERSION, checkForUpdates, compareVersions, type ReleaseInfo } from '../update'
import { lang, t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h } from './dom'
import { carryPacks } from './packs'

const SEEN_KEY = 'folio-pages:seen-version'

function notesList(notes: string[]): HTMLElement {
  return h('ul', { class: 'fp-tips' }, ...notes.map((n) => h('li', {}, n)))
}

/** Aide → Nouveautés : les notes de cette version. */
export function whatsNewDialog(): void {
  const entries = Object.entries(RELEASE_NOTES).sort((a, b) => compareVersions(b[0], a[0]))
  openDialog({
    name: 'whats-new',
    title: t('update.whatsNewTitle', { version: APP_VERSION }),
    body: entries.slice(0, 3).flatMap(([v, n]) => [h('h3', { class: 'fp-form__title' }, t('update.versionLabel', { version: v })), notesList(lang() === 'fr' ? n.fr : n.en)]),
    actions: [{ label: t('action.close'), value: 'close', primary: true }],
  })
}

/** Au démarrage : si l'application a changé depuis la dernière fois dans ce navigateur, on le dit une fois. */
export function announceUpdate(): void {
  let seen: string | null = null
  try {
    seen = localStorage.getItem(SEEN_KEY)
    localStorage.setItem(SEEN_KEY, APP_VERSION)
  } catch {
    return
  }
  if (!seen || compareVersions(APP_VERSION, seen) <= 0) return
  toast(t('update.updated', { from: seen, to: APP_VERSION }), { kind: 'success', timeout: 12000, action: { label: t('update.whatsNew'), run: () => whatsNewDialog() } })
}

/** Aide → Mode hors ligne. */
export function toggleOffline(app: FolioApp): void {
  setOffline(!isOffline())
  toast(t(isOffline() ? 'offline.on' : 'offline.off'), { kind: 'info' })
  app.notifyUi()
}

/** Aide → Rechercher une mise à jour. */
export async function checkUpdatesUi(app: FolioApp): Promise<void> {
  if (isOffline()) {
    toast(t('update.offline'), { kind: 'info' })
    return
  }
  const pending = toast(t('update.checking'), { kind: 'info', timeout: 20000 })
  const res = await checkForUpdates()
  pending()
  if (res.status === 'offline') return void toast(t('update.offline'), { kind: 'info' })
  if (res.status === 'error') return void toast(t('update.failed', { message: res.message }), { kind: 'error', timeout: 9000 })
  if (res.status === 'current') return void toast(t('update.current', { version: res.version }), { kind: 'success' })
  offerUpdate(app, res.release)
}

function offerUpdate(app: FolioApp, release: ReleaseInfo): void {
  const notes = release.notes?.[lang()] ?? release.notes?.en ?? []
  openDialog({
    name: 'update',
    title: t('update.availableTitle', { version: release.version }),
    body: [
      h('p', {}, t('update.availableBody', { from: APP_VERSION, to: release.version })),
      notes.length ? notesList(notes) : null,
      h('p', { class: 'fp-form__hint' }, t(app.writesInPlace ? 'update.howInPlace' : 'update.howDownload')),
      h('p', { class: 'fp-form__hint' }, t('update.trust')),
    ].filter(Boolean) as HTMLElement[],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('update.apply'),
        value: 'apply',
        primary: true,
        run: async () => {
          const out = await app.updateFile(release, carryPacks)
          if (out.kind === 'error') toast(t('update.failed', { message: out.message }), { kind: 'error', timeout: 10000 })
          else if (out.kind === 'saved' || out.kind === 'downloaded') toast(t(out.kind === 'saved' ? 'update.doneInPlace' : 'update.doneDownload', { name: out.name, version: release.version }), { kind: 'success', timeout: 14000 })
        },
      },
    ],
  })
}
