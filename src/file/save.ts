// Enregistrement du fichier (mécanique reprise de Bento, MIT).
//
//   - Chrome, Edge : API File System Access. Au premier enregistrement on
//     demande où enregistrer, puis on réécrit ce fichier. Le fichier choisi est
//     mémorisé (IndexedDB) pour être réécrit en place après réouverture.
//   - Firefox, Safari : téléchargement d'une copie à jour.
//
// Avant de réécrire, on vérifie que personne d'autre n'a modifié le fichier
// depuis notre dernier enregistrement : on ne détruit pas le travail d'autrui.

import { idbDelete, idbGet, idbPut, STORES } from './idb'

interface Writable {
  write(data: Blob): Promise<void>
  close(): Promise<void>
  abort?(): Promise<void>
}

/** Ce que l'application utilise d'un FileSystemFileHandle. */
export interface FsHandle {
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<Writable>
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>
}

type Picker = (o: {
  suggestedName?: string
  id?: string
  startIn?: string
  types?: { description: string; accept: Record<string, string[]> }[]
}) => Promise<FsHandle>

export type SaveOutcome =
  | { kind: 'saved'; name: string }
  | { kind: 'downloaded'; name: string }
  | { kind: 'cancelled' }
  | { kind: 'conflict'; name: string }
  | { kind: 'denied' }
  | { kind: 'error'; message: string }

const picker = (): Picker | null => {
  const p = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker
  return typeof p === 'function' ? p.bind(window) : null
}

/** Le navigateur sait-il réécrire un fichier ? */
export const canWriteInPlace = () => picker() !== null

/** Nom de fichier sûr à partir d'un titre. */
export function fileNameFor(title: string, fallback = 'Document'): string {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 100)
    .trim()
  return (base || fallback) + '.html'
}

/** Nom du fichier ouvert, d'après son adresse, s'il s'agit d'un .html. */
export function openedFileName(): string | null {
  try {
    const last = decodeURIComponent(new URL(location.href).pathname.split('/').pop() ?? '')
    return /\.html?$/i.test(last) ? last : null
  } catch {
    return null
  }
}

export function downloadFile(html: string, name: string, type = 'text/html'): void {
  const url = URL.createObjectURL(new Blob([html], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

interface Stamp {
  lastModified: number
  size: number
}

interface StoredHandle {
  docId: string
  handle: FsHandle
  name: string
}

const errName = (e: unknown) => (e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '')
const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

export interface SaverOptions {
  docId: () => string
  /** Nom proposé au premier enregistrement. */
  suggestedName: () => string
  /** Ce texte de fichier contient-il bien ce document ? (avant de réutiliser un fichier mémorisé) */
  belongs: (fileText: string) => boolean
}

export class Saver {
  private handle: FsHandle | null = null
  private stamp: Stamp | null = null
  private reconnectTried = false

  constructor(private opts: SaverOptions) {}

  get fileName(): string | null {
    return this.handle?.name ?? null
  }

  get hasHandle(): boolean {
    return this.handle !== null
  }

  /** Le fichier où l'on écrit (pour la liste des fichiers récents). */
  get currentHandle(): FsHandle | null {
    return this.handle
  }

  /** Reprend un fichier ouvert (sélecteur, fichiers récents) : on le réécrira en place. */
  async adopt(handle: FsHandle): Promise<void> {
    this.handle = handle
    this.reconnectTried = true
    this.stamp = await readStamp(handle)
    void this.persist(handle)
  }

  /** Oublie le fichier courant (nouvelle identité de document, par exemple). */
  forget(): void {
    this.handle = null
    this.stamp = null
  }

  /** `name` : le nom proposé à la place de celui du document (mise à jour : le fichier ouvert). */
  async save(html: string, force = false, name?: string): Promise<SaveOutcome> {
    const suggested = name ?? this.opts.suggestedName()
    const pick = picker()
    if (!pick) {
      const name = suggested
      downloadFile(html, name)
      return { kind: 'downloaded', name }
    }
    try {
      if (!this.handle && !this.reconnectTried) {
        this.reconnectTried = true
        await this.reconnect()
      }
      if (!this.handle) {
        let handle: FsHandle
        try {
          handle = await pick({
            suggestedName: suggested,
            id: 'folio-pages',
            types: [{ description: 'Folio Pages', accept: { 'text/html': ['.html'] } }],
          })
        } catch (e) {
          if (errName(e) === 'AbortError') return { kind: 'cancelled' }
          throw e
        }
        await this.write(handle, html)
        this.handle = handle
        void this.persist(handle)
        return { kind: 'saved', name: handle.name }
      }
      const handle = this.handle
      if (!(await this.permitted(handle))) return { kind: 'denied' }
      if (!force && this.stamp && (await this.changedOnDisk(handle))) return { kind: 'conflict', name: handle.name }
      await this.write(handle, html)
      void this.persist(handle)
      return { kind: 'saved', name: handle.name }
    } catch (e) {
      if (errName(e) === 'NotAllowedError' || errName(e) === 'SecurityError') return { kind: 'denied' }
      return { kind: 'error', message: errMessage(e) }
    }
  }

  private async write(handle: FsHandle, html: string): Promise<void> {
    // Laisser l'interface se rafraîchir avant l'écriture sur le disque.
    await new Promise((r) => setTimeout(r, 0))
    const w = await handle.createWritable()
    try {
      await w.write(new Blob([html], { type: 'text/html' }))
      await w.close()
    } catch (e) {
      try {
        await w.abort?.()
      } catch {
        /* rien */
      }
      throw e
    }
    this.stamp = await readStamp(handle)
  }

  private async changedOnDisk(handle: FsHandle): Promise<boolean> {
    const now = await readStamp(handle)
    if (!now || !this.stamp) return false
    return now.lastModified !== this.stamp.lastModified || now.size !== this.stamp.size
  }

  private async permitted(handle: FsHandle): Promise<boolean> {
    if (!handle.queryPermission) return true
    if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true
    if (!handle.requestPermission) return false
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'
  }

  /** Retrouve le fichier où ce document a déjà été enregistré, s'il contient bien ce document. */
  private async reconnect(): Promise<void> {
    const stored = await idbGet<StoredHandle>(STORES.handles, this.opts.docId())
    if (!stored || !stored.handle || typeof stored.handle.getFile !== 'function') return
    try {
      if (!(await this.permitted(stored.handle))) return
      const file = await stored.handle.getFile()
      if (!this.opts.belongs(await file.text())) {
        await idbDelete(STORES.handles, this.opts.docId())
        return
      }
      this.handle = stored.handle
      this.stamp = { lastModified: file.lastModified, size: file.size }
    } catch {
      /* fichier déplacé ou supprimé : on redemandera où enregistrer */
    }
  }

  private async persist(handle: FsHandle): Promise<void> {
    // Seul un vrai FileSystemFileHandle se range dans IndexedDB ; sinon l'écriture échoue sans conséquence.
    await idbPut(STORES.handles, { docId: this.opts.docId(), handle, name: handle.name })
  }
}

async function readStamp(handle: FsHandle): Promise<Stamp | null> {
  try {
    const f = await handle.getFile()
    return { lastModified: f.lastModified, size: f.size }
  } catch {
    return null
  }
}
