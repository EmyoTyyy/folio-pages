// Enregistrement automatique (Chrome, Edge) : un interrupteur dans la barre de
// titre. Allumé, le fichier ouvert est réécrit deux secondes après la dernière
// modification, et aussi quand on quitte l'onglet. Le premier enregistrement
// (choisir où) se fait à l'allumage. Sans écriture en place (Firefox, Safari),
// l'interrupteur est grisé : chaque enregistrement y est un téléchargement.

import type { FolioApp } from '../app'
import { t } from '../i18n/i18n'
import { settings, updateSettings } from '../settings'
import { toast } from './dialog'
import { h } from './dom'

/** Délai entre la dernière modification et l'enregistrement. */
export const AUTOSAVE_DELAY = 2000

export const autoSaveOn = (app: FolioApp): boolean => settings().autoSave && app.writesInPlace && app.hasFileHandle && !app.lockedReadOnly

export async function toggleAutoSave(app: FolioApp): Promise<void> {
  if (!app.writesInPlace) {
    toast(t('autosave.unsupported'), { kind: 'info' })
    return
  }
  if (autoSaveOn(app)) {
    updateSettings({ autoSave: false })
    app.notifyUi()
    return
  }
  // Pas encore de fichier : on choisit où l'écrire, puis l'enregistrement automatique prend le relais.
  if (!app.hasFileHandle || app.dirty) {
    const r = await app.save()
    if (!r || r.kind !== 'saved') {
      app.notifyUi()
      return
    }
  }
  updateSettings({ autoSave: true })
  app.notifyUi()
  toast(t('autosave.on'), { kind: 'success' })
}

export function installAutoSave(app: FolioApp): HTMLElement {
  const sw = h('button', { type: 'button', class: 'fp-autosave', id: 'fp-autosave', role: 'switch', 'aria-checked': 'false' }, h('span', { class: 'fp-autosave__track' }, h('span', { class: 'fp-autosave__thumb' })), h('span', { class: 'fp-autosave__label' }))
  sw.addEventListener('click', () => void toggleAutoSave(app))
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastDoc = app.state.doc
  const run = async () => {
    timer = null
    if (!autoSaveOn(app) || !app.dirty) return
    if (app.isSaving) {
      timer = setTimeout(() => void run(), AUTOSAVE_DELAY)
      return
    }
    const r = await app.save()
    // Accès retiré, fichier déplacé… : on s'arrête et on le dit.
    if (r && (r.kind === 'denied' || r.kind === 'error')) {
      updateSettings({ autoSave: false })
      toast(t('autosave.stopped'), { kind: 'error' })
      app.notifyUi()
    }
  }
  const render = () => {
    const on = autoSaveOn(app)
    sw.setAttribute('aria-checked', String(on))
    sw.classList.toggle('is-on', on)
    sw.disabled = !app.writesInPlace || app.lockedReadOnly
    ;(sw.lastChild as HTMLElement).textContent = t('autosave.label')
    sw.title = app.writesInPlace ? (on ? t('autosave.onHint', { name: app.savedName ?? '' }) : t('autosave.offHint')) : t('autosave.unsupported')
  }
  app.onChange(() => {
    render()
    if (app.state.doc === lastDoc) return
    lastDoc = app.state.doc
    if (!autoSaveOn(app)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void run(), AUTOSAVE_DELAY)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && autoSaveOn(app) && app.dirty) {
      if (timer) clearTimeout(timer)
      void run()
    }
  })
  render()
  return sw
}
