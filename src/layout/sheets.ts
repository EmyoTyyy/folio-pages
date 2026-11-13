// Les feuilles de la vue page : papier, couleur et bordure de page, en-têtes et
// pieds de page (rendus en lecture seule, champs calculés pour chaque page),
// notes de bas de page et de fin, masques sur les écarts entre feuilles.

import { renderMathIn } from '../editor/math'
import type { MathContext } from '../math'
import { DOMSerializer, type Node as PMNode } from 'prosemirror-model'
import { blocksToPM } from '../editor/convert'
import { schema } from '../editor/schema'
import { cssColor } from '../format/color'
import { fieldValue, type FieldContext } from '../format/fields'
import type { Block, FieldName, PageSetup, Watermark } from '../format/types'
import { GAP, NOTE_SEP, type Geometry, type NotesLayout, type PageInfo } from './pages'

export type HeaderKind = 'headers' | 'footers'
export type HeaderWhich = 'default' | 'first' | 'even'


/** Ce qu'une feuille affiche : ses en-tête et pied de page, son numéro. */
export interface SheetSpec {
  headers: Block[]
  footers: Block[]
  which: HeaderWhich
  section: number
  /** Numéro de page affiché (déjà mis en forme : iv, 12…). */
  label: string
  number: number
}

export interface SheetsInput {
  pages: PageInfo[]
  specs: SheetSpec[]
  geometry: Geometry
  setup: PageSetup
  hfAssets: Record<string, string>
  fields: Omit<FieldContext, 'page' | 'pages'>
  /** Macros et numéros des équations du document. */
  math?: MathContext
  /** Notes : où elles vont, et leur dessin (champs calculés pour la page). */
  notes?: { layout: NotesLayout; render: (index: number, ctx: FieldContext) => HTMLElement }
  /** Filigrane (image en données), derrière le texte de chaque page. */
  watermark?: Watermark | null
  /** Feuille k : sa géométrie (sa section), son bord gauche et son haut (px, écarts non compris). Absent : toutes pareilles. */
  sheet?: (k: number) => { g: Geometry; left: number; top: number }
}

const serializer = () => DOMSerializer.fromSchema(schema)

export function renderBlocks(blocks: Block[], assets: Record<string, string>, math?: MathContext): DocumentFragment {
  const nodes = blocksToPM(blocks, assets)
  const doc: PMNode = schema.nodes.doc.create(null, nodes)
  const frag = serializer().serializeFragment(doc.content) as DocumentFragment
  // Les formules : dessinées (la sérialisation n'en donne que la source).
  renderMathIn(frag, math ?? {})
  return frag
}

/** Remplace le texte des champs par leur valeur pour cette page. */
export function fillFields(root: ParentNode, ctx: FieldContext): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.fp-field[data-field]'))) {
    el.textContent = fieldValue(el.dataset.field as FieldName, el.dataset.format ?? '', ctx)
  }
}

export function drawSheets(layer: HTMLElement, overlay: HTMLElement, input: SheetsInput): void {
  const { pages, geometry: g0, setup, specs } = input
  const n = pages.length
  layer.replaceChildren()
  overlay.replaceChildren()
  const cache = new Map<Block[], DocumentFragment>()
  const fragment = (blocks: Block[]) => {
    if (!cache.has(blocks)) cache.set(blocks, renderBlocks(blocks, input.hfAssets, input.math))
    return cache.get(blocks)!.cloneNode(true) as DocumentFragment
  }
  for (let k = 0; k < n; k++) {
    const spec = specs[k]
    const sh = input.sheet?.(k) ?? { g: g0, left: 0, top: k * g0.height }
    const g = sh.g
    const top = `calc(${sh.top.toFixed(2)}px + ${k} * var(--fp-gap, ${GAP}px))`
    const sheet = document.createElement('div')
    sheet.className = 'fp-sheet'
    sheet.dataset.page = String(k + 1)
    sheet.style.top = top
    sheet.style.height = `${g.height}px`
    if (input.sheet) {
      sheet.style.left = `${sh.left.toFixed(2)}px`
      sheet.style.width = `${g.width.toFixed(2)}px`
    }
    if (setup.background) sheet.style.background = cssColor(setup.background)
    if (setup.border) {
      const frame = document.createElement('div')
      frame.className = 'fp-sheet__border'
      frame.style.borderColor = cssColor(setup.border)
      sheet.append(frame)
    }
    if (input.watermark) sheet.append(watermarkElement(input.watermark, g))
    layer.append(sheet)
    const ctx: FieldContext = { ...input.fields, page: spec.number, pages: n, formatPage: () => spec.label }
    for (const kind of ['headers', 'footers'] as const) {
      const zone = document.createElement('div')
      zone.className = `fp-hf-zone fp-hf-zone--${kind === 'headers' ? 'header' : 'footer'}`
      zone.dataset.kind = kind
      zone.dataset.which = spec.which
      zone.dataset.page = String(k)
      zone.dataset.section = String(spec.section)
      zone.style.top = top
      zone.style.left = `${(sh.left + g.left).toFixed(2)}px`
      zone.style.width = `${g.contentWidth}px`
      zone.style.setProperty('--hf-offset', `${kind === 'headers' ? g.header : g.footer}px`)
      zone.style.setProperty('--hf-sheet', `${g.height}px`)
      zone.style.setProperty('--pg-top', `${g.top}px`)
      zone.style.setProperty('--pg-bottom', `${g.bottom}px`)
      const body = document.createElement('div')
      body.className = 'fp-hf'
      body.append(fragment(spec[kind]))
      fillFields(body, ctx)
      if (!body.childNodes.length) zone.classList.add('is-empty')
      zone.append(body)
      overlay.append(zone)
    }
    if (input.notes) drawNotes(overlay, input.notes, k, top, g, ctx, sh.left)
    if (k < n - 1) {
      const mask = document.createElement('div')
      mask.className = 'fp-gap-mask'
      mask.style.top = `calc(${(sh.top + g.height).toFixed(2)}px + ${k} * var(--fp-gap, ${GAP}px))`
      overlay.append(mask)
    }
  }
}

/** Le filigrane d'une page : un texte en diagonale (ou à plat), ou une image, centré dans la zone de texte. */
export function watermarkElement(w: Watermark, g: Geometry): HTMLElement {
  const box = document.createElement('div')
  box.className = 'fp-watermark'
  box.style.left = `${g.left}px`
  box.style.top = `${g.top}px`
  box.style.width = `${g.contentWidth}px`
  box.style.height = `${g.height - g.top - g.bottom}px`
  box.style.opacity = String(w.opacity / 100)
  if (w.image) {
    const img = document.createElement('img')
    img.src = w.image
    img.alt = ''
    img.style.width = `${(g.contentWidth * w.scale) / 100}px`
    box.append(img)
    return box
  }
  const text = document.createElement('span')
  text.className = 'fp-watermark__text'
  text.textContent = w.text ?? ''
  const chars = Math.max(1, [...(w.text ?? '')].length)
  // Taille automatique : le texte occupe la diagonale (ou la largeur) de la zone.
  const span = w.diagonal ? Math.hypot(g.contentWidth, g.height - g.top - g.bottom) * 0.82 : g.contentWidth * 0.95
  const px = w.size ? (w.size * 96) / 72 : Math.min(span / (chars * 0.62), g.contentWidth * 0.5)
  text.style.fontSize = `${px.toFixed(1)}px`
  text.style.color = cssColor(w.color)
  if (w.diagonal) text.style.transform = `rotate(${-Math.round((Math.atan2(g.height - g.top - g.bottom, g.contentWidth) * 180) / Math.PI)}deg)`
  box.append(text)
  return box
}

/** Zones de notes d'une page : notes de bas de page (au bas du texte), notes de fin. */
function drawNotes(overlay: HTMLElement, notes: NonNullable<SheetsInput['notes']>, k: number, top: string, g: Geometry, ctx: FieldContext, sheetLeft = 0): void {
  const zone = (kind: 'foot' | 'end', items: number[], at: string) => {
    const el = document.createElement('div')
    el.className = `fp-hf fp-notes-zone fp-notes-zone--${kind}`
    el.dataset.page = String(k)
    el.style.top = at
    el.style.left = `${(sheetLeft + g.left).toFixed(2)}px`
    el.style.width = `${g.contentWidth}px`
    el.style.paddingTop = `${NOTE_SEP}px`
    for (const i of items) el.append(notes.render(i, ctx))
    overlay.append(el)
  }
  const foot = notes.layout.foot[k] ?? []
  // Le bas de la zone est le bas du texte : elle grandit vers le haut (pendant la modification).
  if (foot.length) zone('foot', foot, `calc(${top} + ${(g.top + g.contentHeight).toFixed(2)}px)`)
  for (const e of notes.layout.end) if (e.page === k) zone('end', e.items, `calc(${top} + ${e.top.toFixed(2)}px)`)
}
