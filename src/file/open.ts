// Ouvrir un fichier : sélecteur du navigateur (File System Access sur Chrome et
// Edge, sinon le sélecteur classique), fichier déposé, ouverture par le système
// (launchQueue). On reconnaît d'abord ce que contient le fichier : un document
// Folio Pages, une application vide, un document chiffré, du Markdown ou du
// texte, un document .docx, une présentation Bento, autre chose. Les fichiers
// ouverts ou enregistrés en place sont mémorisés (IndexedDB) pour les rouvrir.

import { loadDocument, type LoadResult } from '../format/load'
import type { JsonError } from '../format/json'
import type { Report } from '../format/dsl'
import type { FolioDoc } from '../format/types'
import { idbDelete, idbGetAll, idbPut, STORES } from './idb'
import type { FsHandle } from './save'
import { importDocxFile } from './docx'
import { importOdt } from './odt-import'
import { importRtf } from './rtf-import'
import { extractDocBlock, recognizeHtml } from './shell'
import { parseEnvelope, type Envelope } from './crypto'

/** Au-delà, on ne lit pas le fichier (un document Folio Pages fait rarement plus de quelques Mo). */
export const MAX_OPEN_BYTES = 120_000_000

export type Opened =
  | { kind: 'document'; doc: FolioDoc; report: Report; name: string; handle: FsHandle | null; imported: boolean }
  | { kind: 'blank-app' | 'bento' | 'foreign' | 'too-large' | 'unreadable'; name: string }
  /** Document protégé : il faut son mot de passe. */
  | { kind: 'encrypted'; name: string; envelope: Envelope | null; handle: FsHandle | null }
  /** Fichier .docx qu'on n'a pas pu importer (ancien format, protégé, abîmé…). */
  | { kind: 'docx-failed'; name: string; code: 'not-zip' | 'old-format' | 'not-docx' | 'too-large' | 'damaged' | 'module' }
  | { kind: 'broken'; name: string; error: JsonError }

const base = (name: string) => name.replace(/\.[^.]+$/, '')

function fromLoad(r: LoadResult, name: string, handle: FsHandle | null, imported: boolean): Opened {
  if (r.ok) return { kind: 'document', doc: r.doc, report: r.report, name, handle, imported }
  if (r.reason === 'json') return { kind: 'broken', name, error: r.error }
  if (r.reason === 'encrypted') return { kind: 'encrypted', name, envelope: null, handle }
  if (r.reason === 'too-large') return { kind: 'too-large', name }
  return { kind: 'foreign', name }
}

/** Texte brut : un paragraphe par bloc séparé d'une ligne vide, les retours gardés. */
function plainBlocks(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim())
}

/** Ce que contient le fichier, et le document qu'on peut en tirer. */
export function recognize(name: string, text: string, handle: FsHandle | null = null, now?: string): Opened {
  const lower = name.toLowerCase()
  if (/\.(md|markdown|mdown)$/.test(lower)) {
    const r = loadDocument({ format: 'folio/doc', version: 1, meta: { title: base(name) }, markdown: text }, { now })
    return fromLoad(r, `${base(name)}.html`, null, true)
  }
  if (/\.txt$/.test(lower)) {
    const r = loadDocument({ format: 'folio/doc', version: 1, meta: { title: base(name) }, blocks: plainBlocks(text) }, { now })
    return fromLoad(r, `${base(name)}.html`, null, true)
  }
  if (/\.json$/.test(lower)) return fromLoad(loadDocument(text, { now }), `${base(name)}.html`, null, true)
  if (/\.html?$/.test(lower) || /<html|<!doctype/i.test(text.slice(0, 2000))) {
    const kind = recognizeHtml(text)
    if (kind === 'document') return fromLoad(loadDocument(extractDocBlock(text) ?? '', { now }), name, handle, false)
    if (kind === 'blank-app') return { kind: 'blank-app', name }
    if (kind === 'encrypted') return { kind: 'encrypted', name, envelope: parseEnvelope(extractDocBlock(text) ?? ''), handle }
    if (/application\/bento\+json|id="bento-doc"/i.test(text)) return { kind: 'bento', name }
    return { kind: 'foreign', name }
  }
  return { kind: 'foreign', name }
}

/** Lit un fichier choisi ou déposé. */
export async function readOpened(file: File, handle: FsHandle | null = null): Promise<Opened> {
  const name = file.name || 'document.html'
  if (file.size > MAX_OPEN_BYTES) return { kind: 'too-large', name }
  if (/\.(docx|docm|dotx|doc)$/i.test(name)) {
    const got = await importDocxFile(file, base(name))
    if (!got.ok) return { kind: 'docx-failed', name, code: /\.doc$/i.test(name) && got.code === 'not-zip' ? 'old-format' : got.code }
    return { kind: 'document', doc: got.load.doc, report: got.load.report, name: `${base(name)}.html`, handle: null, imported: true }
  }
  // OpenDocument et RTF : lus ici même, puis validés comme un document reçu.
  if (/\.(odt|ott|rtf)$/i.test(name)) {
    try {
      const odt = /\.(odt|ott)$/i.test(name)
      const res = odt ? importOdt(new Uint8Array(await file.arrayBuffer())) : importRtf(await file.text())
      const meta = (res.doc.meta ?? {}) as Record<string, unknown>
      if (!meta.title) res.doc.meta = { ...meta, title: base(name) }
      const load = loadDocument(res.doc)
      if (!load.ok) return { kind: 'unreadable', name }
      for (const l of res.losses) load.report.warn('', 'import-loss', `${l.code}:${l.count}`)
      return { kind: 'document', doc: load.doc, report: load.report, name: `${base(name)}.html`, handle: null, imported: true }
    } catch {
      return { kind: 'unreadable', name }
    }
  }
  let text: string
  try {
    text = await file.text()
  } catch {
    return { kind: 'unreadable', name }
  }
  return recognize(name, text, handle)
}

type OpenPicker = (o: { id?: string; multiple?: boolean; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FsHandle[]>

const ACCEPT = {
  'text/html': ['.html', '.htm'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.oasis.opendocument.text': ['.odt'],
  'application/rtf': ['.rtf'],
  'text/markdown': ['.md', '.markdown'],
  'text/plain': ['.txt'],
  'application/json': ['.json'],
}

/** Le navigateur sait-il rouvrir un fichier pour le réécrire ? (Chrome, Edge) */
export const canReopen = () => typeof (window as unknown as { showOpenFilePicker?: OpenPicker }).showOpenFilePicker === 'function'

/** Demande un fichier ; null si on annule. */
export async function pickFile(): Promise<{ file: File; handle: FsHandle | null } | null> {
  const picker = (window as unknown as { showOpenFilePicker?: OpenPicker }).showOpenFilePicker
  if (typeof picker === 'function') {
    try {
      const [handle] = await picker.call(window, { id: 'folio-pages-open', types: [{ description: 'Documents', accept: ACCEPT }] })
      if (!handle) return null
      return { file: await handle.getFile(), handle }
    } catch (e) {
      if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'AbortError') return null
      throw e
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.html,.htm,.md,.markdown,.txt,.json,.docx,.odt,.rtf'
    input.style.display = 'none'
    let done = false
    const finish = (v: { file: File; handle: null } | null) => {
      if (done) return
      done = true
      input.remove()
      resolve(v)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ? { file: input.files[0], handle: null } : null))
    input.addEventListener('cancel', () => finish(null))
    document.body.append(input)
    input.click()
  })
}

// --- fichiers récents -------------------------------------------------------------

export interface RecentFile {
  /** Identité du document. */
  key: string
  name: string
  title: string
  at: number
  handle: FsHandle
}

export const MAX_RECENT = 12

/** Les fichiers de cette session, même si IndexedDB refuse de les garder. */
const memory = new Map<string, RecentFile>()

export async function rememberRecent(r: RecentFile): Promise<void> {
  if (!r.handle || typeof (r.handle as { getFile?: unknown }).getFile !== 'function') return
  memory.set(r.key, r)
  await idbPut(STORES.recent, r)
  const all = await recentFiles()
  for (const old of all.slice(MAX_RECENT)) await forgetRecent(old.key)
}

export async function recentFiles(): Promise<RecentFile[]> {
  const byKey = new Map<string, RecentFile>()
  for (const r of [...(await idbGetAll<RecentFile>(STORES.recent)), ...memory.values()]) {
    if (!r || !r.handle) continue
    const prev = byKey.get(r.key)
    if (!prev || prev.at < r.at) byKey.set(r.key, r)
  }
  return [...byKey.values()].sort((a, b) => b.at - a.at)
}

export async function forgetRecent(key: string): Promise<void> {
  memory.delete(key)
  await idbDelete(STORES.recent, key)
}

/** Le fichier d'une entrée récente, avec la permission de le lire et de le réécrire (geste de l'utilisateur requis). */
export async function openRecent(r: RecentFile): Promise<{ file: File; handle: FsHandle } | null> {
  try {
    const h = r.handle
    if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      if (!h.requestPermission || (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return null
    }
    return { file: await h.getFile(), handle: h }
  } catch {
    return null
  }
}
