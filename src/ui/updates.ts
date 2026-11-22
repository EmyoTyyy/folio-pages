// Mises à jour, nouveautés et mode hors ligne, côté interface (phase 7).

import type { FolioApp } from '../app'
import { isOffline, setOffline } from '../net'
import { RELEASE_NOTES } from '../release-notes'
import { settings, updateSettings } from '../settings'
import { APP_VERSION, checkForUpdates, compareVersions, type ReleaseInfo } from '../update'
import { lang, t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h } from './dom'
import { carryPacks } from './packs'
import { openedFileName } from '../file/save'

const SEEN_KEY = 'folio-pages:seen-version'
/** Dernière version annoncée par une bulle : une seule fois par version, pas à chaque ouverture. */
const NOTIFIED_KEY = 'folio-pages:update-notified'

/**
 * Version plus récente trouvée pendant cette session (manifeste signé, vérifié).
 * Gardée en mémoire seulement : rien de ce qui sert à installer ne vient du stockage du navigateur.
 */
let available: ReleaseInfo | null = null
/** Ce fichier vient d'être mis à jour : le bouton n'a plus lieu d'être (il faut le rouvrir). */
let applied = false

/** La mise à jour proposée par le bouton de la barre de titre, ou null. */
export function availableUpdate(): ReleaseInfo | null {
  return applied || isOffline() ? null : available
}

function setAvailable(app: FolioApp, release: ReleaseInfo | null): void {
  available = release
  app.notifyUi()
}

/**
 * À chaque ouverture du fichier : une recherche discrète, sauf si le réglage est coupé
 * ou en mode hors ligne. Un navigateur piloté par un programme (tests, robots) ne
 * contacte pas le site du projet. Une erreur réseau ne dérange personne : on réessaiera
 * à la prochaine ouverture.
 */
export function autoCheckUpdates(app: FolioApp): void {
  if (navigator.webdriver) return
  // Après le démarrage, pour ne pas le ralentir.
  setTimeout(() => void quietCheck(app), 1200)
}

async function quietCheck(app: FolioApp): Promise<void> {
  if (!settings().autoUpdate || isOffline() || applied) return
  const res = await checkForUpdates()
  if (res.status === 'current') return setAvailable(app, null)
  if (res.status !== 'update') return
  setAvailable(app, res.release)
  let told: string | null = null
  try {
    told = localStorage.getItem(NOTIFIED_KEY)
    localStorage.setItem(NOTIFIED_KEY, res.release.version)
  } catch {
    /* stockage refusé : la bulle s'affiche, simplement */
  }
  if (told === res.release.version) return
  toast(t('update.found', { version: res.release.version, current: APP_VERSION }), {
    kind: 'info',
    timeout: 14000,
    action: { label: t('update.button'), run: () => openAvailableUpdate(app) },
  })
}

/** Aide → Mises à jour → Rechercher à chaque ouverture. L'activer cherche tout de suite. */
export function toggleAutoUpdate(app: FolioApp): void {
  const on = !settings().autoUpdate
  updateSettings({ autoUpdate: on })
  app.notifyUi()
  if (on) void quietCheck(app)
}

/** Le bouton « Mettre à jour » de la barre de titre. */
export function openAvailableUpdate(app: FolioApp): void {
  const release = availableUpdate()
  if (release) offerUpdate(app, release)
  else void checkUpdatesUi(app)
}

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
  if (res.status === 'current') {
    setAvailable(app, null)
    return void toast(t('update.current', { version: res.version }), { kind: 'success' })
  }
  setAvailable(app, res.release)
  offerUpdate(app, res.release)
}

/** Comment la mise à jour s'écrit : en place, après avoir désigné le fichier une fois, ou en téléchargement. */
function howText(app: FolioApp): string {
  if (!app.writesInPlace) return t('update.howDownload')
  const name = openedFileName()
  if (app.hasFileHandle || !name) return t('update.howInPlace')
  return t('update.howPick', { name })
}

function offerUpdate(app: FolioApp, release: ReleaseInfo): void {
  const notes = release.notes?.[lang()] ?? release.notes?.en ?? []
  openDialog({
    name: 'update',
    title: t('update.availableTitle', { version: release.version }),
    body: [
      h('p', {}, t('update.availableBody', { from: APP_VERSION, to: release.version })),
      notes.length ? notesList(notes) : null,
      h('p', { class: 'fp-form__hint' }, howText(app)),
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
          if (out.kind === 'saved' || out.kind === 'downloaded') {
            applied = true
            app.notifyUi()
          }
          if (out.kind === 'downloaded') toast(t('update.doneDownload', { name: out.name, version: release.version }), { kind: 'success', timeout: 14000 })
          if (out.kind === 'saved') {
            // Le fichier affiché a été réécrit : le recharger ouvre la nouvelle version (le document est enregistré).
            const same = out.name === openedFileName()
            toast(t(same ? 'update.doneReload' : 'update.doneInPlace', { name: out.name, version: release.version }), { kind: 'success', timeout: same ? 30000 : 14000, action: same ? { label: t('update.reload'), run: () => location.reload() } : undefined })
          }
        },
      },
    ],
  })
}
