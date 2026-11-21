// Côté application : charger le module .docx (compilé à part, décompressé à la
// première utilisation), importer un fichier .docx, exporter le document.

import { colorFilter } from '../format/picture'
import type { PictureAdjust } from '../format/types'
import type * as DocxModule from '../docx/index'
import type { ImportLossCode, Loss } from '../docx/index'
import { loadDocument, type LoadResult } from '../format/load'
import { mathKit } from '../math/kit'
import type { FsHandle } from './save'

type Mod = typeof DocxModule

/** Identifiant du bloc compressé qui contient le module, dans le fichier. */
export const DOCX_PAYLOAD = 'folio-rt-docx'

let loading: Promise<Mod> | null = null

/** Le module .docx ; lève une erreur s'il manque (fichier abîmé). */
export function loadDocx(): Promise<Mod> {
  loading ??= (async () => {
    const w = window as unknown as { FolioDocx?: Mod; __folioPayload?: (id: string) => string }
    if (w.FolioDocx) {
      w.FolioDocx.useMath(mathKit)
      return w.FolioDocx
    }
    if (import.meta.env.DEV) {
      const m = await import('../docx/index')
      m.useMath(mathKit)
      return m
    }
    if (typeof w.__folioPayload !== 'function') throw new Error('docx module missing')
    const src = `${w.__folioPayload(DOCX_PAYLOAD)}\n//# sourceURL=folio-pages-docx.js`
    // Comme le chargeur : un script inséré, sinon new Function (politique de sécurité stricte).
    try {
      const sc = document.createElement('script')
      sc.setAttribute('data-folio-transient', '')
      sc.textContent = src
      document.body.appendChild(sc)
      sc.remove()
    } catch {
      /* essai suivant */
    }
    // (Relu : le script inséré l'a publié entre-temps.)
    const started = () => (window as unknown as { FolioDocx?: Mod }).FolioDocx
    if (!started()) new Function(src)()
    const mod = started()
    if (!mod) throw new Error('docx module did not start')
    // Le moteur d'équations de l'application, prêté au module.
    mod.useMath(mathKit)
    return mod
  })().catch((e) => {
    loading = null
    throw e
  })
  return loading
}

export type DocxImport =
  | { ok: true; load: Extract<LoadResult, { ok: true }>; losses: Loss<ImportLossCode>[] }
  | { ok: false; code: 'not-zip' | 'old-format' | 'not-docx' | 'too-large' | 'damaged' | 'module' }

/** Fichier .docx → document validé par l'application, et ce qui n'a pas pu être repris. */
export async function importDocxFile(file: File, title: string, now?: string): Promise<DocxImport> {
  let mod: Mod
  try {
    mod = await loadDocx()
  } catch {
    return { ok: false, code: 'module' }
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const res = mod.importDocx(bytes)
    const meta = (res.doc.meta ?? {}) as Record<string, unknown>
    if (!meta.title) res.doc.meta = { ...meta, title }
    const load = loadDocument(res.doc, { now })
    if (!load.ok) return { ok: false, code: 'damaged' }
    for (const l of res.losses) load.report.warn('', 'import-loss', `${l.code}:${l.count}`)
    return { ok: true, load, losses: res.losses }
  } catch (e) {
    if (e instanceof mod.DocxError) return { ok: false, code: e.code }
    return { ok: false, code: 'damaged' }
  }
}

/** Image → PNG par un canevas (SVG, WebP, AVIF : formats que .docx n'accepte pas). */
export async function rasterize(uri: string, width: number, height: number): Promise<Uint8Array | null> {
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = uri
    await img.decode()
    let w = width || img.naturalWidth || 300
    let h = height || img.naturalHeight || 150
    // Un dessin vectoriel est rendu deux fois plus fin que sa taille nominale, sans dépasser 4000 px.
    const scale = /^data:image\/svg/i.test(uri) ? Math.min(2, 4000 / Math.max(w, h)) : Math.min(1, 4000 / Math.max(w, h))
    w = Math.max(1, Math.round(w * scale))
    h = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const g = canvas.getContext('2d')
    if (!g) return null
    g.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  } catch {
    return null
  }
}

/**
 * Image retouchée → PNG : couleurs (filtre), transparence et bords adoucis
 * dessinés dans l'image, pour les formats qui ne savent pas les décrire
 * (.docx, .odt). Sans filtre de canevas (anciens Safari) : null.
 */
export async function bakePicture(uri: string, adjust: PictureAdjust): Promise<Uint8Array | null> {
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = uri
    await img.decode()
    const scale = Math.min(1, 4000 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
    const w = Math.max(1, Math.round((img.naturalWidth || 300) * scale))
    const hgt = Math.max(1, Math.round((img.naturalHeight || 150) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = hgt
    const g = canvas.getContext('2d')
    if (!g || !('filter' in g)) return null
    g.filter = colorFilter(adjust) || 'none'
    g.globalAlpha = adjust.transparency ? 1 - adjust.transparency / 100 : 1
    g.drawImage(img, 0, 0, w, hgt)
    g.filter = 'none'
    g.globalAlpha = 1
    if (adjust.softEdges) {
      // Bords adoucis : la transparence s'efface vers chaque bord (en points, à 96 px par pouce).
      const d = Math.min(w / 2, hgt / 2, (adjust.softEdges * 4) / 3 / Math.max(scale, 0.01) * scale)
      g.globalCompositeOperation = 'destination-in'
      const horiz = g.createLinearGradient(0, 0, w, 0)
      horiz.addColorStop(0, 'rgba(0,0,0,0)')
      horiz.addColorStop(d / w, 'rgba(0,0,0,1)')
      horiz.addColorStop(1 - d / w, 'rgba(0,0,0,1)')
      horiz.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = horiz
      g.fillRect(0, 0, w, hgt)
      const vert = g.createLinearGradient(0, 0, 0, hgt)
      vert.addColorStop(0, 'rgba(0,0,0,0)')
      vert.addColorStop(d / hgt, 'rgba(0,0,0,1)')
      vert.addColorStop(1 - d / hgt, 'rgba(0,0,0,1)')
      vert.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = vert
      g.fillRect(0, 0, w, hgt)
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  } catch {
    return null
  }
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type Picker = (o: { suggestedName?: string; id?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FsHandle>

/** Écrit un fichier exporté : là où l'on choisit (Chrome, Edge), sinon en téléchargement. */
export async function saveExport(bytes: Uint8Array, name: string, mime: string, ext: string, description: string): Promise<{ kind: 'saved' | 'downloaded'; name: string } | { kind: 'cancelled' } | { kind: 'error'; message: string }> {
  const blob = new Blob([bytes], { type: mime })
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker
  if (typeof picker === 'function') {
    try {
      const handle = await picker.call(window, { suggestedName: name, id: 'folio-pages-export', types: [{ description, accept: { [mime]: [ext] } }] })
      const w = await handle.createWritable()
      await w.write(blob)
      await w.close()
      return { kind: 'saved', name: handle.name }
    } catch (e) {
      const n = e && typeof e === 'object' && 'name' in e ? (e as { name: string }).name : ''
      if (n === 'AbortError') return { kind: 'cancelled' }
      // Plus de geste de l'utilisateur (un long export) : on télécharge, comme sans le sélecteur.
      if (n !== 'SecurityError' && n !== 'NotAllowedError') return { kind: 'error', message: e instanceof Error ? e.message : String(e) }
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return { kind: 'downloaded', name }
}
