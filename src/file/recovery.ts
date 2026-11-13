// Copie de secours pendant l'édition, pour la récupération après plantage.
//
// Une seule copie par document (la plus récente), gardée dans le navigateur
// uniquement : IndexedDB, ou localStorage quand IndexedDB est refusé (fichier
// local ouvert dans Firefox, par exemple). Jamais dans le fichier, jamais en ligne.

import { idbDelete, idbGet, idbGetAll, idbPut, openDb, STORES } from './idb'

export interface Snapshot {
  /** Clé de la copie : l'identifiant du document. */
  key: string
  /** Moment de la copie (ms). */
  at: number
  title: string
  /** JSON complet du document. */
  json: string
  /** Adresse du fichier ouvert, pour retrouver une session partie d'une application vide. */
  href: string
  /** La session a commencé sur une application vide (document de démonstration). */
  blank: boolean
  /** Une copie a été téléchargée depuis : le fichier d'origine n'est pas à jour. */
  downloaded?: boolean
}

const LS_PREFIX = 'folio-pages:recovery:'
/** Au-delà, une copie ne tient pas raisonnablement dans localStorage. */
const LS_MAX = 2_000_000
/** Les copies plus vieilles sont oubliées. */
const MAX_AGE_MS = 30 * 24 * 3600 * 1000

let backend: 'idb' | 'local' | 'none' | null = null

async function pickBackend(): Promise<'idb' | 'local' | 'none'> {
  if (backend) return backend
  if (await openDb()) return (backend = 'idb')
  try {
    const probe = LS_PREFIX + 'probe'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return (backend = 'local')
  } catch {
    return (backend = 'none')
  }
}

/** Où la copie de secours est gardée, pour l'afficher et pour les tests. */
export const recoveryBackend = () => pickBackend()

export async function putSnapshot(s: Snapshot): Promise<boolean> {
  const b = await pickBackend()
  if (b === 'idb') return idbPut(STORES.recovery, s)
  if (b === 'local') {
    const text = JSON.stringify(s)
    if (text.length > LS_MAX) return false
    try {
      localStorage.setItem(LS_PREFIX + s.key, text)
      return true
    } catch {
      return false
    }
  }
  return false
}

function localAll(): Snapshot[] {
  const out: Snapshot[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(LS_PREFIX) || k === LS_PREFIX + 'probe') continue
      try {
        const v = JSON.parse(localStorage.getItem(k) ?? '') as Snapshot
        if (v && typeof v.key === 'string' && typeof v.json === 'string') out.push(v)
      } catch {
        /* copie abîmée : ignorée */
      }
    }
  } catch {
    /* indisponible */
  }
  return out
}

const valid = (s: unknown): s is Snapshot =>
  !!s && typeof (s as Snapshot).key === 'string' && typeof (s as Snapshot).json === 'string' && typeof (s as Snapshot).at === 'number'

export async function getSnapshot(key: string): Promise<Snapshot | null> {
  const b = await pickBackend()
  if (b === 'idb') {
    const s = await idbGet<Snapshot>(STORES.recovery, key)
    return valid(s) ? s : null
  }
  if (b === 'local') return localAll().find((s) => s.key === key) ?? null
  return null
}

async function all(): Promise<Snapshot[]> {
  const b = await pickBackend()
  if (b === 'idb') return (await idbGetAll<Snapshot>(STORES.recovery)).filter(valid)
  if (b === 'local') return localAll()
  return []
}

/** La copie la plus récente d'une session partie de l'application vide ouverte à cette adresse. */
export async function findBlankSnapshot(href: string): Promise<Snapshot | null> {
  const list = (await all()).filter((s) => s.blank && s.href === href)
  list.sort((a, b) => b.at - a.at)
  return list[0] ?? null
}

export async function deleteSnapshot(key: string): Promise<void> {
  const b = await pickBackend()
  if (b === 'idb') await idbDelete(STORES.recovery, key)
  else if (b === 'local') {
    try {
      localStorage.removeItem(LS_PREFIX + key)
    } catch {
      /* rien */
    }
  }
}

/** Oublie les copies de plus de 30 jours. */
export async function pruneSnapshots(now = Date.now()): Promise<void> {
  for (const s of await all()) if (now - s.at > MAX_AGE_MS) await deleteSnapshot(s.key)
}
