// Habillage « rapproché » et « au travers » : le texte suit le contour de l'image.
//
// shape-outside: url(…) ne convient pas : Chrome pose l'image à sa taille d'origine,
// Firefox à la taille de la boîte. On calcule donc nous-mêmes un polygone : l'image
// telle qu'elle est affichée (rognée, tournée, retournée) est dessinée en petit, et
// chaque bande de lignes donne la limite de ses pixels opaques du côté du texte.

import type { Crop } from '../format/types'

export interface ContourInput {
  img: HTMLImageElement
  /** Taille du cadre affiché (px CSS, sans zoom). */
  frameW: number
  frameH: number
  /** Position du cadre dans la boîte de marge de la figure. */
  offX: number
  offY: number
  /** Taille de la boîte de marge de la figure. */
  boxW: number
  boxH: number
  /** Côté où flotte l'image : le texte est de l'autre côté. */
  side: 'left' | 'right'
  crop: Crop | null
  rotate: number
  flip: string | null
}

/** Nombre de bandes au plus : assez pour suivre un contour, peu pour un polygone léger. */
const BANDS = 48
const ALPHA = 128

/** Limites (0 à 1 de la largeur du cadre) des pixels opaques de chaque bande ; null : bande vide. */
export function opaqueExtents(data: Uint8ClampedArray, w: number, h: number, bands: number, side: 'left' | 'right'): (number | null)[] {
  const out: (number | null)[] = []
  for (let b = 0; b < bands; b++) {
    const y0 = Math.floor((b * h) / bands)
    const y1 = Math.max(y0 + 1, Math.floor(((b + 1) * h) / bands))
    let edge: number | null = null
    for (let y = y0; y < y1 && y < h; y++) {
      if (side === 'left') {
        // Image à gauche : le pixel opaque le plus à droite.
        for (let x = w - 1; x >= (edge ?? -1) + 1; x--) {
          if (data[(y * w + x) * 4 + 3] >= ALPHA) {
            edge = x
            break
          }
        }
      } else {
        for (let x = 0; x < (edge ?? w); x++) {
          if (data[(y * w + x) * 4 + 3] >= ALPHA) {
            edge = x
            break
          }
        }
      }
    }
    out.push(edge === null ? null : side === 'left' ? (edge + 1) / w : edge / w)
  }
  return out
}

/** Polygone (px de la boîte de marge) à partir des limites de chaque bande. */
export function contourPoints(ext: (number | null)[], o: Omit<ContourInput, 'img' | 'crop' | 'rotate' | 'flip'>): [number, number][] {
  const { frameW, frameH, offX, offY, boxW, boxH, side } = o
  const n = ext.length
  const pts: [number, number][] = []
  // Bord du texte pour une bande : la limite opaque, ou le bord de l'image si la bande est vide.
  const at = (e: number | null) => (side === 'left' ? offX + (e ?? 0) * frameW : offX + (e ?? 1) * frameW)
  const outer = side === 'left' ? 0 : boxW
  const first = ext.find((e) => e !== null)
  pts.push([outer, 0], [at(first ?? null), 0])
  ext.forEach((e, i) => {
    const x = at(e)
    pts.push([x, offY + (i * frameH) / n], [x, offY + ((i + 1) * frameH) / n])
  })
  // Sous l'image (légende) : toute la largeur de la figure.
  const bottom = offY + frameH
  if (boxH - bottom > 1) pts.push([side === 'left' ? boxW : 0, bottom], [side === 'left' ? boxW : 0, boxH])
  else pts.push([at(ext[n - 1] ?? null), boxH])
  pts.push([outer, boxH])
  return pts
}

/** La valeur de shape-outside, ou null si l'image n'est pas lisible (pas encore chargée). */
export function contourShape(o: ContourInput): string | null {
  const { img, frameW, frameH } = o
  if (!img.complete || !img.naturalWidth || frameW < 4 || frameH < 4) return null
  const k = Math.min(1, 200 / Math.max(frameW, frameH))
  const cw = Math.max(4, Math.round(frameW * k))
  const ch = Math.max(4, Math.round(frameH * k))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) return null
  // Même géométrie que le cadre : boîte intérieure centrée, tournée, retournée ; image rognée dedans.
  const crop = o.crop ?? { top: 0, right: 0, bottom: 0, left: 0 }
  const fw = 1 - (crop.left + crop.right) / 100
  const fh = 1 - (crop.top + crop.bottom) / 100
  const quarter = o.rotate === 90 || o.rotate === 270
  const iw = quarter ? ch : cw
  const ih = quarter ? cw : ch
  g.translate(cw / 2, ch / 2)
  g.rotate(((o.rotate || 0) * Math.PI) / 180)
  g.scale(o.flip?.includes('h') ? -1 : 1, o.flip?.includes('v') ? -1 : 1)
  g.translate(-iw / 2, -ih / 2)
  try {
    g.drawImage(img, (-crop.left / fw / 100) * iw, (-crop.top / fh / 100) * ih, iw / fw, ih / fh)
    const data = g.getImageData(0, 0, cw, ch).data
    const ext = opaqueExtents(data, cw, ch, Math.min(BANDS, ch), o.side)
    return `polygon(${contourPoints(ext, o)
      .map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`)
      .join(', ')})`
  } catch {
    // Image d'une autre origine (lecture interdite) : l'habillage reste carré.
    return null
  }
}
