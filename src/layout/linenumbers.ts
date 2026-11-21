// Numéros de ligne : dessinés dans la marge de la vue page, à la hauteur de
// chaque ligne du texte. Les lignes sont celles que le navigateur a composées
// (rectangles du texte), donc exactes à l'écran, à l'impression et en PDF.
// Comptent : paragraphes, titres, éléments de liste, code, équations. Ne
// comptent pas : tableaux, encadrés, blocs générés, notes, en-têtes et pieds
// de page, et les paragraphes marqués « sans numéros de ligne ».

import type { LineNumbers } from '../format/types'
import { displayScale } from './scale'

const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, pre, .fp-equation'
/** Ce qui n'est pas numéroté, même avec des paragraphes dedans. */
const EXCLUDED = 'td, th, .fp-callout, figure, [contenteditable="false"], [data-no-line-numbers]'
/** Distance automatique au texte, en points (comme les traitements de texte courants). */
export const AUTO_DISTANCE = 18

export interface NumberedLine {
  /** Ligne de base, en pixels de la page (sans zoom). */
  baseline: number
  /** Bord droit du numéro (début de la colonne de texte moins la distance). */
  right: number
  /** Taille du numéro, en pixels. */
  size: number
  page: number
  section: number
}

interface Band {
  top: number
  bottom: number
  /** Le plus grand rectangle de la ligne : sa ligne de base est celle de la ligne. */
  mainTop: number
  mainH: number
  col: number
}

export interface LineHost {
  /** Feuille (repère des positions) et texte. */
  page: HTMLElement
  prose: HTMLElement
  /** Page (et sa section) d'une hauteur, en pixels de la page sans zoom. Une section commence toujours une page. */
  pageOf: (y: number) => { page: number; section: number }
}

/** Les lignes numérotables du texte, dans l'ordre, avec leur page et leur section. */
export function measureLines(host: LineHost, distancePt: number): NumberedLine[] {
  const { page, prose } = host
  const pr = page.getBoundingClientRect()
  const scale = displayScale(page)
  const toPage = (x: number, y: number) => [(x - pr.left) / scale - page.clientLeft, (y - pr.top) / scale - page.clientTop]
  const proseBox = prose.getBoundingClientRect()
  const proseLeft = proseBox.left + parseFloat(getComputedStyle(prose).paddingLeft || '0') * scale
  const size = parseFloat(getComputedStyle(prose).fontSize) || 15
  const distance = (distancePt * 96) / 72
  const range = document.createRange()
  const out: NumberedLine[] = []
  for (const el of Array.from(prose.querySelectorAll<HTMLElement>(BLOCKS))) {
    // Un bloc dans un autre bloc numéroté (paragraphe d'une équation…) ou dans ce qui est exclu : pas compté.
    if (el.parentElement?.closest(EXCLUDED) || el.matches('[data-no-line-numbers]') || el.parentElement?.closest(BLOCKS)) continue
    if (!el.offsetParent) continue
    // Colonnes : chaque ligne a la sienne.
    const cols = el.closest<HTMLElement>('.fp-columns')
    let colOf = (_x: number) => 0
    let colLeft = (_c: number) => proseLeft
    if (cols) {
      const cs = getComputedStyle(cols)
      const n = Math.max(1, parseInt(cs.columnCount) || 1)
      const gap = (parseFloat(cs.columnGap) || size) * scale
      const box = cols.getBoundingClientRect()
      const w = (box.width - (n - 1) * gap) / n
      colOf = (x) => Math.max(0, Math.min(n - 1, Math.floor((x - box.left + gap / 2) / (w + gap))))
      colLeft = (c) => box.left + c * (w + gap)
    }
    const bands: Band[] = []
    if (el.matches('.fp-equation')) {
      const r = el.getBoundingClientRect()
      bands.push({ top: r.top, bottom: r.bottom, mainTop: r.top, mainH: r.height, col: colOf(r.left) })
    } else {
      range.selectNodeContents(el)
      for (const r of Array.from(range.getClientRects())) {
        if (!(r.height > 0)) continue
        const col = colOf(r.left)
        const mid = r.top + r.height / 2
        const band = bands.find((b) => b.col === col && mid >= b.top && mid <= b.bottom)
        if (band) {
          band.top = Math.min(band.top, r.top)
          band.bottom = Math.max(band.bottom, r.bottom)
          if (r.height > band.mainH) {
            band.mainTop = r.top
            band.mainH = r.height
          }
        } else bands.push({ top: r.top, bottom: r.bottom, mainTop: r.top, mainH: r.height, col })
      }
      // Paragraphe vide : une ligne, à la hauteur de sa première ligne.
      if (!bands.length) {
        const r = el.getBoundingClientRect()
        const lh = parseFloat(getComputedStyle(el).lineHeight) * scale || r.height
        const pad = parseFloat(getComputedStyle(el).paddingTop || '0') * scale
        const h = Math.min(r.height, lh)
        bands.push({ top: r.top + pad, bottom: r.top + pad + h, mainTop: r.top + pad + (h - size * 1.2 * scale) / 2, mainH: size * 1.2 * scale, col: colOf(r.left) })
      }
    }
    bands.sort((a, b) => a.col - b.col || a.top - b.top)
    for (const b of bands) {
      // Ligne de base : vers les quatre cinquièmes du plus grand morceau de texte de la ligne.
      const [x, y] = toPage(colLeft(b.col), b.mainTop + b.mainH * 0.79)
      out.push({ baseline: y, right: x - distance, size, ...host.pageOf(y) })
    }
  }
  // Dans l'ordre de lecture : page, puis colonne (de gauche à droite), puis hauteur.
  return out
}

/** Numéros à afficher : [ligne, numéro] (les lignes sans numéro visible comptent quand même). */
export function lineLabels(lines: NumberedLine[], s: LineNumbers): [NumberedLine, number][] {
  const out: [NumberedLine, number][] = []
  let n = s.start
  let prev: NumberedLine | null = null
  for (const line of lines) {
    if (prev && ((s.restart === 'page' && line.page !== prev.page) || (s.restart === 'section' && line.section !== prev.section))) n = s.start
    if (n % s.countBy === 0) out.push([line, n])
    n++
    prev = line
  }
  return out
}

/** Dessine les numéros dans leur calque (rien n'est refait si rien n'a bougé). */
export function drawLineNumbers(layer: HTMLElement, labels: [NumberedLine, number][]): void {
  const sig = labels.map(([l, n]) => `${n}@${Math.round(l.right)},${Math.round(l.baseline)},${l.size}`).join(';')
  if (layer.dataset.sig === sig) return
  layer.dataset.sig = sig
  const frag = document.createDocumentFragment()
  for (const [l, n] of labels) {
    const span = document.createElement('span')
    span.className = 'fp-line-number'
    span.textContent = String(n)
    // Boîte d'une ligne à la taille du texte, posée sur la ligne de base.
    span.style.cssText = `top:${(l.baseline - l.size * 0.8).toFixed(1)}px;right:calc(100% - ${l.right.toFixed(1)}px);font-size:${l.size}px;line-height:${l.size}px`
    frag.append(span)
  }
  layer.replaceChildren(frag)
}
