// Historique des versions : des états du document, gardés dans le navigateur
// seulement (IndexedDB, sinon localStorage avec moins de place), jamais dans le
// fichier ni en ligne. Une version à chaque enregistrement, et une version
// automatique toutes les dix minutes d'édition.

import { idbDelete, idbGetAll, idbPut, openDb, STORES } from './idb'

export type VersionReason = 'save' | 'auto' | 'restore'

export interface Version {
  /** `${docId}:${at}` */
  key: string
  docId: string
  /** Moment de la version (ms). */
  at: number
  title: string
  /** JSON complet du document. */
  json: string
  words: number
  reason: VersionReason
}

/** Versions gardées par document, et ancienneté maximale. */
export const MAX_VERSIONS = 40
const MAX_AGE_MS = 90 * 24 * 3600 * 1000
const LS_PREFIX = 'folio-pages:version:'
/** En localStorage (stockage plus petit) : moins de versions, et pas les très gros documents. */
const LS_MAX_VERSIONS = 8
const LS_MAX_SIZE = 1_500_000

let backend: 'idb' | 'local' | 'none' | null = null

async function pickBackend(): Promise<'idb' | 'local' | 'none'> {
  if (backend) return backend
  if (await openDb()) return (backend = 'idb')
  try {
    localStorage.setItem(LS_PREFIX + 'probe', '1')
    localStorage.removeItem(LS_PREFIX + 'probe')
    return (backend = 'local')
  } catch {
    return (backend = 'none')
  }
}

function localAll(): Version[] {
  const out: Version[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(LS_PREFIX) || k.endsWith('probe')) continue
      try {
        const v = JSON.parse(localStorage.getItem(k) ?? 'null') as Version | null
        if (v && typeof v.json === 'string' && typeof v.docId === 'string') out.push(v)
      } catch {
        /* entrée illisible : ignorée */
      }
    }
  } catch {
    /* stockage indisponible */
  }
  return out
}

async function all(): Promise<Version[]> {
  const b = await pickBackend()
  if (b === 'idb') return idbGetAll<Version>(STORES.versions)
  if (b === 'local') return localAll()
  return []
}

async function remove(key: string): Promise<void> {
  const b = await pickBackend()
  if (b === 'idb') await idbDelete(STORES.versions, key)
  else if (b === 'local') {
    try {
      localStorage.removeItem(LS_PREFIX + key)
    } catch {
      /* rien */
    }
  }
}

/** Versions d'un document, la plus récente d'abord. */
export async function listVersions(docId: string): Promise<Version[]> {
  return (await all()).filter((v) => v.docId === docId).sort((a, b) => b.at - a.at)
}

/**
 * Ajoute une version (sauf si le document n'a pas changé depuis la dernière)
 * et oublie les plus anciennes. Renvoie true si une version a été écrite.
 */
export async function addVersion(v: Omit<Version, 'key'>, now = Date.now()): Promise<boolean> {
  const b = await pickBackend()
  if (b === 'none') return false
  const existing = await listVersions(v.docId)
  if (existing[0] && existing[0].json === v.json) return false
  const version: Version = { ...v, key: `${v.docId}:${v.at}` }
  let ok: boolean
  if (b === 'idb') ok = await idbPut(STORES.versions, version)
  else {
    const text = JSON.stringify(version)
    if (text.length > LS_MAX_SIZE) return false
    try {
      localStorage.setItem(LS_PREFIX + version.key, text)
      ok = true
    } catch {
      ok = false
    }
  }
  if (!ok) return false
  // Les plus anciennes au-delà de la limite, et celles trop vieilles, s'en vont.
  const keep = b === 'idb' ? MAX_VERSIONS : LS_MAX_VERSIONS
  const list = [version, ...existing]
  for (const [i, old] of list.entries()) if (i >= keep || now - old.at > MAX_AGE_MS) await remove(old.key)
  return true
}

/** Efface l'historique d'un document. */
export async function deleteVersions(docId: string): Promise<void> {
  for (const v of await listVersions(docId)) await remove(v.key)
}

export const versionsBackend = () => pickBackend()
