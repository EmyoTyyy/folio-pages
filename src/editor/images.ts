// Images insérées : lecture d'un fichier, réduction des photos (2560 px au
// plus), compression des images du document.
//
// Une capture d'écran ou un logo (PNG, GIF, SVG) est gardé tel quel, sans
// perte. Une photo (JPEG, WebP…) trop grande est réduite à 2560 px et
// réenregistrée en JPEG.

import { netFetch } from '../net'

export const MAX_SIDE = 2560
const JPEG_QUALITY = 0.86
/** Une image plus lourde que ceci n'est pas acceptée (avant réduction). */
export const MAX_INPUT_BYTES = 40 * 1024 * 1024

export interface PreparedImage {
  src: string
  width: number
  height: number
  /** Taille du fichier d'origine et de l'image retenue, en octets. */
  before: number
  after: number
}

export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('read'))
    r.readAsDataURL(blob)
  })
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('decode'))
    img.src = src
  })
}

/** Taille en octets des données d'une URI data: en base64. */
export function dataUriBytes(src: string): number {
  const i = src.indexOf(',')
  const b64 = src.length - i - 1
  const pad = src.endsWith('==') ? 2 : src.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64 * 3) / 4) - pad)
}

const LOSSLESS = /^data:image\/(png|gif|svg\+xml|bmp)/i

/** Dimensions réduites pour qu'aucun côté ne dépasse `max`. */
export function fitWithin(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  if (w <= max && h <= max) return { w, h }
  const k = max / Math.max(w, h)
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

function encode(img: HTMLImageElement, w: number, h: number, lossless: boolean): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  if (!lossless) {
    // Fond blanc : le JPEG n'a pas de transparence.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL(lossless ? 'image/png' : 'image/jpeg', JPEG_QUALITY)
}

/** Prépare une image (URI data:) pour le document ; `reduce` : réduire les grandes photos. */
export async function prepareImage(src: string, reduce: boolean): Promise<PreparedImage> {
  const before = dataUriBytes(src)
  const img = await loadImage(src)
  const w = img.naturalWidth || 1
  const h = img.naturalHeight || 1
  // Captures d'écran, logos, dessins (PNG, GIF, SVG…) : jamais réduits ni recompressés.
  if (!reduce || LOSSLESS.test(src)) return { src, width: w, height: h, before, after: before }
  const target = fitWithin(w, h)
  if (target.w === w && target.h === h) {
    // Pas trop grande. Une photo très lourde est tout de même réencodée si c'est un gain net.
    if (before < 1_500_000) return { src, width: w, height: h, before, after: before }
  }
  try {
    const out = encode(img, target.w, target.h, false)
    const after = dataUriBytes(out)
    if (after >= before) return { src, width: w, height: h, before, after: before }
    return { src: out, width: target.w, height: target.h, before, after }
  } catch {
    return { src, width: w, height: h, before, after: before }
  }
}

export async function prepareFile(file: Blob, reduce: boolean): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('not-an-image')
  if (file.size > MAX_INPUT_BYTES) throw new Error('too-large')
  return prepareImage(await readAsDataUrl(file), reduce)
}

/** Télécharge une image externe (à la demande de l'utilisateur seulement). */
export async function fetchImageAsDataUrl(url: string): Promise<string> {
  const res = await netFetch(url, { mode: 'cors' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/') || blob.size > MAX_INPUT_BYTES) throw new Error('not-an-image')
  return (await prepareImage(await readAsDataUrl(blob), true)).src
}

/** Fichiers image d'un presse-papiers ou d'un glisser-déposer. */
export function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return []
  const out: File[] = []
  for (const f of Array.from(data.files ?? [])) if (f.type.startsWith('image/')) out.push(f)
  if (!out.length) {
    for (const it of Array.from(data.items ?? [])) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) out.push(f)
      }
    }
  }
  return out
}
