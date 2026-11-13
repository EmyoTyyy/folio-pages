// Tout accès au réseau passe par ici (phase 7, CLAUDE.md 4.9).
//
// Folio Pages fonctionne sans réseau. Ce qui en a besoin est facultatif et
// ne part que d'un geste de l'utilisateur : charger une image du web, suivre
// un lien, chercher une mise à jour, télécharger une langue. Le mode hors
// ligne (mémorisé dans ce navigateur) bloque tout cela, en un seul endroit :
// un appel qui oublierait de le consulter ne peut pas exister.
//
// Seul https est accepté pour télécharger. Aucune requête n'emporte
// d'identifiant, de cookie ni de référent.

import { settings, updateSettings } from './settings'

export class OfflineError extends Error {
  constructor() {
    super('offline')
  }
}

export const isOffline = (): boolean => settings().offline

const listeners = new Set<(offline: boolean) => void>()

export function setOffline(on: boolean): void {
  if (on === isOffline()) return
  updateSettings({ offline: on })
  for (const fn of listeners) fn(on)
}

export function onOfflineChange(fn: (offline: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Une adresse du web (et pas un lien de courriel, de téléphone ou interne). */
export const isWebUrl = (href: string): boolean => /^https?:\/\//i.test(href.trim())

/**
 * Télécharger : https seulement, sans cookie ni référent ; refusé en mode hors
 * ligne (OfflineError).
 */
export async function netFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (isOffline()) throw new OfflineError()
  if (!/^https:\/\//i.test(url)) throw new Error('only https')
  return fetch(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow' })
}

/**
 * Ouvrir une adresse dans un nouvel onglet, isolé de cette page. En mode hors
 * ligne, une adresse du web n'est pas ouverte (renvoie false) ; un courriel ou
 * un numéro de téléphone l'est (ce n'est pas l'application qui va sur le réseau).
 */
export function openUrl(href: string): boolean {
  if (isOffline() && isWebUrl(href)) return false
  window.open(href, '_blank', 'noopener,noreferrer')
  return true
}
