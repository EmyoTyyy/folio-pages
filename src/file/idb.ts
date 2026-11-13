// Petite enveloppe autour d'IndexedDB. Aucune opération ne lève d'exception
// ni ne bloque : en cas d'échec (stockage refusé, fichier local sous Firefox,
// navigation privée…), elle répond « indisponible » et l'application continue.

const DB_NAME = 'folio-pages'
const DB_VERSION = 3
export const STORES = { recovery: 'recovery', handles: 'handles', versions: 'versions', recent: 'recent' } as const
type StoreName = (typeof STORES)[keyof typeof STORES]

const TIMEOUT_MS = 4000

let opening: Promise<IDBDatabase | null> | null = null

function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), TIMEOUT_MS)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      },
    )
  })
}

export function openDb(): Promise<IDBDatabase | null> {
  if (opening) return opening
  opening = withTimeout(
    new Promise<IDBDatabase | null>((resolve) => {
      let req: IDBOpenDBRequest
      try {
        if (typeof indexedDB === 'undefined') return resolve(null)
        req = indexedDB.open(DB_NAME, DB_VERSION)
      } catch {
        return resolve(null)
      }
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORES.recovery)) db.createObjectStore(STORES.recovery, { keyPath: 'key' })
        if (!db.objectStoreNames.contains(STORES.handles)) db.createObjectStore(STORES.handles, { keyPath: 'docId' })
        // Version 2 : historique des versions.
        if (!db.objectStoreNames.contains(STORES.versions)) db.createObjectStore(STORES.versions, { keyPath: 'key' })
        // Version 3 : fichiers récents (Chrome, Edge : pour les rouvrir et les réécrire en place).
        if (!db.objectStoreNames.contains(STORES.recent)) db.createObjectStore(STORES.recent, { keyPath: 'key' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    }),
    null,
  )
  return opening
}

/** Lit dans un magasin ; `fallback` si quoi que ce soit échoue. */
function read<T>(store: StoreName, fn: (s: IDBObjectStore) => IDBRequest<T>, fallback: T): Promise<T> {
  return withTimeout(
    (async () => {
      const db = await openDb()
      if (!db) return fallback
      return new Promise<T>((resolve) => {
        try {
          const req = fn(db.transaction(store, 'readonly').objectStore(store))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(fallback)
        } catch {
          resolve(fallback)
        }
      })
    })(),
    fallback,
  )
}

/** Écrit dans un magasin ; true seulement quand la transaction est validée. */
function write(store: StoreName, fn: (s: IDBObjectStore) => void): Promise<boolean> {
  return withTimeout(
    (async () => {
      const db = await openDb()
      if (!db) return false
      return new Promise<boolean>((resolve) => {
        try {
          const tx = db.transaction(store, 'readwrite')
          fn(tx.objectStore(store))
          tx.oncomplete = () => resolve(true)
          tx.onerror = () => resolve(false)
          tx.onabort = () => resolve(false)
        } catch {
          resolve(false)
        }
      })
    })(),
    false,
  )
}

export const idbGet = <T>(store: StoreName, key: string) =>
  read<T | undefined>(store, (s) => s.get(key) as IDBRequest<T | undefined>, undefined)

export const idbGetAll = <T>(store: StoreName) => read<T[]>(store, (s) => s.getAll() as IDBRequest<T[]>, [])

export const idbPut = (store: StoreName, value: unknown) => write(store, (s) => void s.put(value))

export const idbDelete = (store: StoreName, key: string) => write(store, (s) => void s.delete(key))
