// Vue page : le texte coule d'un seul tenant dans l'éditeur ; les pages sont
// CALCULÉES sur ce flux et dessinées autour de lui.
//
//   - Les feuilles (papier, en-têtes, pieds de page) sont dans un calque
//     derrière le texte, hors de la zone modifiable.
//   - Là où une page se termine, un intercalaire non modifiable (décoration,
//     jamais du contenu : il n'entre pas dans l'historique) pousse la ligne
//     suivante en haut de la feuille suivante.
//   - Pour mesurer, une classe masque les intercalaires : le texte reprend la
//     mise en forme qu'il aurait sans pages, on mesure, on les remet, dans la
//     même tâche (aucun affichage intermédiaire), en gardant le défilement.
//   - La hauteur des intercalaires s'écrit avec la variable --fp-gap (l'écart
//     gris entre les feuilles) : à l'impression elle vaut 0, et chaque page
//     tombe exactement sur une feuille de papier.

import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import { collectNotes, noteLabels, type NoteRef } from '../editor/notes'
import { resolveStyle } from '../format/theme'
import type { NoteSettings, PageSetup, StyleDef } from '../format/types'
import { paginate, type Box, type Line } from './paginate'

export const PX_PER_MM = 96 / 25.4
export const GAP = 28
/** Filet au-dessus des notes (px) ; la feuille de style lui donne la même hauteur. */
export const NOTE_SEP = 12
/** Espace entre la fin du texte et les notes de fin (px). */
export const END_GAP = 10

export interface Geometry {
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
  header: number
  footer: number
  contentWidth: number
  contentHeight: number
}

export function geometry(p: PageSetup): Geometry {
  const [w, h] = p.orientation === 'landscape' ? [p.height, p.width] : [p.width, p.height]
  const g = {
    width: w * PX_PER_MM,
    height: h * PX_PER_MM,
    top: p.margins.top * PX_PER_MM,
    right: p.margins.right * PX_PER_MM,
    bottom: p.margins.bottom * PX_PER_MM,
    left: p.margins.left * PX_PER_MM,
    header: p.header * PX_PER_MM,
    footer: p.footer * PX_PER_MM,
    contentWidth: 0,
    contentHeight: 0,
  }
  g.contentWidth = g.width - g.left - g.right
  g.contentHeight = g.height - g.top - g.bottom
  return g
}

/** Une page : où elle commence dans le document, sa section, son numéro. */
export interface PageInfo {
  /** Position du document où commence la page (0 pour la première). */
  pos: number
  /** Section (0 : avant le premier saut de section). */
  section: number
  /** Numéro de la page (avant mise en forme : 1, 2, 3…). */
  number: number
  /** Page laissée blanche pour qu'une section commence sur une page impaire (ou paire). */
  blank?: boolean
  /** Page ajoutée après le texte, pour la suite des notes de fin. */
  notesOnly?: boolean
}

/** Où vont les notes : bas de chaque page, et notes de fin après le texte. */
export interface NotesLayout {
  refs: NoteRef[]
  labels: string[]
  /** Hauteur de chaque note (px), dans l'ordre de `refs`. */
  heights: number[]
  /** Pour chaque page : indices (dans `refs`) de ses notes de bas de page. */
  foot: number[][]
  /** Zones de notes de fin : page, haut de la zone (px depuis le haut de la feuille), notes. */
  end: { page: number; top: number; items: number[] }[]
}

export const emptyNotesLayout = (): NotesLayout => ({ refs: [], labels: [], heights: [], foot: [], end: [] })

/** Ce que le contrôleur doit savoir de chaque section pour numéroter les pages. */
export interface SectionInfo {
  start: 'page' | 'odd' | 'even'
  /** Numéro de la première page ; null : la numérotation continue. */
  numberStart: number | null
}

/** Un intercalaire à poser : position, forme, hauteur (sans l'écart entre feuilles). */
interface Spacer {
  pos: number
  /** inner : à l'intérieur d'une liste générée (table des matières, bibliographie…), avant sa ligne `line`. */
  kind: 'block' | 'inline' | 'row' | 'inner'
  line?: number
  /** Hauteur en px, à laquelle s'ajoute var(--fp-gap). */
  height: number
  /** Place laissée en haut de la page suivante (en-tête de tableau répété). */
  lead?: number
}

/** Un en-tête de tableau redessiné en haut d'une page. */
export interface RepeatedHeader {
  page: number
  /** Position du tableau dans le document. */
  table: number
}

export interface PaginationState {
  spacers: Spacer[]
  pages: PageInfo[]
  decorations: DecorationSet
  /** Décalage des sections dont la mise en page diffère (signature, pour ne redessiner qu'au besoin). */
  shiftKey?: string
}

/** Où va le texte d'une section dont la mise en page diffère : décalage et largeur, en px. */
export interface SectionShift {
  sx: number
  cw: number
}

export const paginationKey = new PluginKey<PaginationState>('folio-pagination')

function spacerDOM(s: Spacer): HTMLElement {
  const el = document.createElement(s.kind === 'inline' ? 'span' : 'div')
  el.className = `fp-spacer fp-spacer--${s.kind}`
  el.contentEditable = 'false'
  el.setAttribute('aria-hidden', 'true')
  el.style.height = `calc(${Math.max(0, s.height).toFixed(2)}px + var(--fp-gap, ${GAP}px))`
  return el
}

const PT = 96 / 72

/** Coupures à l'intérieur d'une liste générée : la vue de la liste pose elle-même ses intercalaires. */
export interface InnerBreak {
  line: number
  height: number
}

/** Un intercalaire dans une liste générée (élément de même nature que ses lignes). */
export function innerSpacerDOM(before: Element, height: number): HTMLElement {
  const el = document.createElement(before.tagName === 'LI' ? 'li' : 'div')
  el.className = 'fp-spacer fp-spacer--inner'
  el.setAttribute('aria-hidden', 'true')
  el.style.height = `calc(${Math.max(0, height).toFixed(2)}px + var(--fp-gap, ${GAP}px))`
  return el
}

/** Pose les intercalaires d'une liste générée, d'après les décorations de son nœud. */
export function applyInnerBreaks(root: HTMLElement, decorations: readonly Decoration[]): void {
  const d = decorations.find((x) => (x.spec as { innerBreaks?: InnerBreak[] }).innerBreaks)
  if (!d) return
  const rows = Array.from(root.querySelectorAll('[data-row]'))
  for (const b of (d.spec as { innerBreaks: InnerBreak[] }).innerBreaks) {
    const row = rows[b.line]
    if (row) row.before(innerSpacerDOM(row, b.height))
  }
}

function decorationsFor(doc: PMNode, spacers: Spacer[], shifts: (SectionShift | null)[] = []): DecorationSet {
  const decos: Decoration[] = []
  const inner = new Map<number, InnerBreak[]>()
  spacers.forEach((s, i) => {
    if (s.kind === 'inner') {
      inner.set(s.pos, [...(inner.get(s.pos) ?? []), { line: s.line ?? 0, height: s.height }])
      return
    }
    decos.push(
      Decoration.widget(s.pos, () => spacerDOM(s), {
        side: -1,
        key: `pg${i}:${s.kind}:${s.height.toFixed(1)}`,
        ignoreSelection: true,
        marks: [],
      }),
    )
  })
  for (const [pos, breaks] of inner) {
    const node = doc.nodeAt(pos)
    if (node) decos.push(Decoration.node(pos, pos + node.nodeSize, {}, { innerBreaks: breaks }))
  }
  // Sections d'un autre format : leurs blocs sont décalés et leur largeur est celle de leur page.
  if (shifts.some(Boolean)) {
    let sec = 0
    doc.forEach((node, pos) => {
      if (node.type.name === 'section_break') {
        sec++
        return
      }
      const sh = shifts[sec]
      if (!sh) return
      const ml = typeof node.attrs.indentLeft === 'number' ? node.attrs.indentLeft * PT : 0
      const mr = typeof node.attrs.indentRight === 'number' ? node.attrs.indentRight * PT : 0
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'fp-in-sec', style: `--sx:${sh.sx.toFixed(2)}px;--scw:${sh.cw.toFixed(2)}px;--own-ml:${ml.toFixed(2)}px;--own-mr:${mr.toFixed(2)}px` }))
    })
  }
  return DecorationSet.create(doc, decos)
}

/** Greffon qui porte les intercalaires ; le contrôleur les calcule et les lui transmet. */
export function paginationPlugin(): Plugin<PaginationState> {
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init: () => ({ spacers: [], pages: [{ pos: 0, section: 0, number: 1 }], decorations: DecorationSet.empty }),
      apply: (tr, prev) => {
        const next = tr.getMeta(paginationKey) as PaginationState | undefined
        if (next) return next
        if (!tr.docChanged) return prev
        // En attendant le prochain calcul, les intercalaires suivent le texte.
        return {
          spacers: prev.spacers.map((s) => ({ ...s, pos: tr.mapping.map(s.pos, -1) })),
          pages: prev.pages.map((p) => ({ ...p, pos: tr.mapping.map(p.pos, -1) })),
          decorations: prev.decorations.map(tr.mapping, tr.doc),
        }
      },
    },
    props: {
      decorations: (state) => paginationKey.getState(state)?.decorations,
      // Flèches haut et bas de part et d'autre d'un intercalaire : le déplacement
      // natif du curseur s'y perd (Chrome) ; on va nous-mêmes à la ligne voisine.
      handleKeyDown: (view, e) => {
        if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false
        const target = verticalAcrossSpacer(view, e.key === 'ArrowDown' ? 1 : -1)
        if (target === null) return false
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)).scrollIntoView())
        return true
      },
    },
  })
}

type Coords = (pos: number, side: -1 | 1) => { top: number; left: number } | null

/** Position d'arrivée d'une flèche haut/bas qui traverse un intercalaire, ou null si aucun n'est en jeu. */
export function verticalAcrossSpacer(view: EditorView, dir: 1 | -1): number | null {
  const ps = paginationKey.getState(view.state)
  const sel = view.state.selection
  if (!ps || !sel.empty || !ps.spacers.length) return null
  const head = sel.head
  const $head = view.state.doc.resolve(head)
  if (!$head.parent.isTextblock) return null
  const start = $head.start()
  const end = $head.end()
  const coords: Coords = (pos, side) => {
    try {
      return view.coordsAtPos(pos, side)
    } catch {
      return null
    }
  }
  const here = coords(head, -1) ?? coords(head, 1)
  if (!here) return null
  for (const s of ps.spacers) {
    if (s.kind !== 'inline' || s.pos <= start + 1 || s.pos >= end) continue
    // À la position de l'intercalaire, le navigateur mesure l'intercalaire lui-même :
    // on repère les lignes par des caractères qui y sont sûrement.
    if (dir > 0 && s.pos > head) {
      const lastBefore = coords(s.pos - 1, -1)
      if (!lastBefore || Math.abs(lastBefore.top - here.top) > 2) continue
      return closestOnLine(s.pos, end, 1, here.left, coords)
    }
    if (dir < 0 && s.pos <= head) {
      const firstAfter = coords(Math.min(s.pos + 1, end), -1)
      if (!firstAfter || Math.abs(firstAfter.top - here.top) > 2) continue
      return closestOnLine(s.pos, start, -1, here.left, coords)
    }
  }
  return null
}

/**
 * La position la plus proche de `x` sur la ligne qui commence en `from`
 * (dir 1 : ligne après l'intercalaire) ou qui finit en `from` (dir -1).
 */
function closestOnLine(from: number, limit: number, dir: 1 | -1, x: number, coords: Coords): number {
  const ref = coords(dir > 0 ? Math.min(from + 1, limit) : Math.max(from - 1, limit), -1)
  if (!ref) return from
  let best = from
  let bestDist = Infinity
  let seen = false
  for (let p = from; dir > 0 ? p <= limit : p >= limit; p += dir) {
    // Curseur juste après le caractère p - 1.
    const c = coords(p, -1)
    if (!c || Math.abs(c.top - ref.top) > 2) {
      if (seen) break
      continue
    }
    seen = true
    const d = Math.abs(c.left - x)
    if (d < bestDist) {
      bestDist = d
      best = p
    }
  }
  return best
}

// --- mesure -------------------------------------------------------------------

interface MBox extends Box {
  /** Position d'insertion d'un intercalaire avant la boîte entière. */
  before: number
  /** Étendue de la boîte dans le document (pour y retrouver les appels de note). */
  from: number
  to: number
  /** Le paragraphe (pour couper entre ses lignes). */
  textPos?: number
  textNode?: PMNode
  row?: boolean
  /** Ligne de tableau : position du tableau. */
  table?: number
  /** Liste générée coupable entre ses lignes (table des matières, bibliographie…). */
  list?: boolean
  /** Saut de section : la page suivante commence une nouvelle section. */
  section?: boolean
}

interface Frame {
  originTop: number
  scale: number
}

const TEXT_NODES = new Set(['paragraph', 'heading', 'code_block'])

function styleIdOf(node: PMNode, inQuote: boolean): string {
  if (node.type.name === 'heading') return `heading${node.attrs.level}`
  if (node.type.name === 'code_block') return 'code'
  if (inQuote) return 'quote'
  return (node.attrs.style as string | null) ?? 'normal'
}

/** Lignes d'un élément : un rectangle par ligne, à partir des nœuds de texte seulement. */
function linesOf(el: HTMLElement, frame: Frame): Line[] {
  const rects: Line[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let n: Node | null
  while ((n = walker.nextNode())) {
    if (!n.nodeValue) continue
    range.selectNodeContents(n)
    for (const r of Array.from(range.getClientRects())) {
      if (r.height <= 0) continue
      rects.push({ top: (r.top - frame.originTop) / frame.scale, bottom: (r.bottom - frame.originTop) / frame.scale })
    }
  }
  rects.sort((a, b) => a.top - b.top)
  // Les rectangles d'une même ligne (plusieurs morceaux de texte) se recouvrent.
  const lines: Line[] = []
  for (const r of rects) {
    const last = lines[lines.length - 1]
    if (last && r.top < last.bottom - Math.min(r.bottom - r.top, last.bottom - last.top) / 2) {
      last.top = Math.min(last.top, r.top)
      last.bottom = Math.max(last.bottom, r.bottom)
    } else lines.push({ ...r })
  }
  return lines
}

function rectOf(el: Element, frame: Frame): { top: number; bottom: number } {
  const r = el.getBoundingClientRect()
  return { top: (r.top - frame.originTop) / frame.scale, bottom: (r.bottom - frame.originTop) / frame.scale }
}

function collectBoxes(view: EditorView, styles: Record<string, StyleDef>, frame: Frame): MBox[] {
  const out: MBox[] = []
  const visit = (node: PMNode, pos: number, ctx: { inQuote: boolean; itemStart: number | null }) => {
    const name = node.type.name
    if (TEXT_NODES.has(name)) {
      const el = view.nodeDOM(pos) as HTMLElement | null
      if (!el || !(el instanceof HTMLElement)) return
      const st = resolveStyle(styles, styleIdOf(node, ctx.inQuote))
      const r = rectOf(el, frame)
      const box: MBox = {
        ...r,
        kind: node.content.size ? 'text' : 'atomic',
        keepNext: node.attrs.keepNext || !!st.keepNext,
        keepLines: node.attrs.keepLines || !!st.keepLines,
        breakBefore: node.attrs.pageBreakBefore || !!st.pageBreakBefore,
        before: ctx.itemStart ?? pos,
        from: pos,
        to: pos + node.nodeSize,
        textPos: pos,
        textNode: node,
      }
      let cache: Line[] | null = null
      box.lines = () => (cache ??= linesOf(el, frame))
      out.push(box)
      return
    }
    if (name === 'blockquote') {
      node.forEach((child, off) => visit(child, pos + 1 + off, { inQuote: true, itemStart: null }))
      return
    }
    if (name === 'bullet_list' || name === 'ordered_list') {
      node.forEach((item, off) => {
        const itemPos = pos + 1 + off
        item.forEach((child, coff, i) => visit(child, itemPos + 1 + coff, { inQuote: ctx.inQuote, itemStart: i === 0 ? itemPos : null }))
      })
      return
    }
    if (name === 'table') {
      // En-tête répété : la première ligne, faite de cellules d'en-tête.
      const first = node.firstChild
      const repeats = !!node.attrs.repeatHeader && !!first && first.childCount > 0 && first.firstChild!.type.name === 'table_header'
      let headHeight = 0
      node.forEach((row, off, i) => {
        const rowPos = pos + 1 + off
        const el = view.nodeDOM(rowPos) as HTMLElement | null
        if (!el) return
        const r = rectOf(el, frame)
        if (i === 0 && repeats) headHeight = r.bottom - r.top
        out.push({ ...r, kind: 'atomic', before: rowPos, from: rowPos, to: rowPos + row.nodeSize, row: true, table: pos, ...(repeats && i > 0 ? { repeatHeight: headHeight } : {}) })
      })
      return
    }
    const el = view.nodeDOM(pos) as HTMLElement | null
    if (!el || !(el instanceof HTMLElement)) return
    const span = { before: pos, from: pos, to: pos + node.nodeSize }
    // Liste générée dont les lignes sont marquées : elle se coupe entre ses lignes, comme un paragraphe.
    if ((name === 'toc' || name === 'refblock') && el.querySelector('[data-row]')) {
      let cache: Line[] | null = null
      const box: MBox = { ...rectOf(el, frame), kind: 'text', ...span, list: true }
      box.lines = () => (cache ??= Array.from(el.querySelectorAll('[data-row]')).map((r) => rectOf(r, frame)))
      out.push(box)
      return
    }
    if (name === 'page_break') out.push({ ...rectOf(el, frame), kind: 'break', ...span })
    else if (name === 'section_break') out.push({ ...rectOf(el, frame), kind: 'break', ...span, section: true })
    else out.push({ ...rectOf(el, frame), kind: 'atomic', ...span })
  }
  view.state.doc.forEach((node, off) => visit(node, off, { inQuote: false, itemStart: null }))
  return out
}

/**
 * Rattache chaque note de bas de page à la boîte qui l'appelle : à la hauteur de
 * son appel dans un paragraphe (coupable entre ses lignes), au haut de la boîte
 * sinon (ligne de tableau, image, colonnes : elles ne se coupent pas).
 */
function attachNotes(view: EditorView, boxes: MBox[], refs: NoteRef[], heights: number[], frame: Frame): void {
  let k = 0
  refs.forEach((r, i) => {
    if (r.kind !== 'foot') return
    while (k + 1 < boxes.length && boxes[k + 1].from <= r.pos) k++
    const b = boxes[k]
    if (!b || r.pos < b.from || r.pos >= b.to) return
    let y = b.top
    if (b.kind === 'text') {
      const el = view.nodeDOM(r.pos)
      if (el instanceof HTMLElement) {
        const rect = rectOf(el, frame)
        y = (rect.top + rect.bottom) / 2
      }
    }
    ;(b.notes ??= []).push({ y, height: heights[i] })
  })
}

/** Première position du paragraphe dont le caractère est sur la ligne commençant à `top`. */
function positionOfLine(view: EditorView, textPos: number, node: PMNode, top: number, frame: Frame): number {
  let lo = textPos + 1
  let hi = textPos + 1 + node.content.size
  // Plus petite position dont le caractère suivant est sur la ligne (ou plus bas).
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    let y: number
    try {
      y = (view.coordsAtPos(mid, 1).top - frame.originTop) / frame.scale
    } catch {
      return lo
    }
    if (y >= top - 2) hi = mid
    else lo = mid + 1
  }
  return lo
}

// --- contrôleur ---------------------------------------------------------------

export interface PagesHost {
  view: EditorView
  /** Le conteneur de la page (feuilles + texte), avant mise à l'échelle par le zoom. */
  paper: HTMLElement
  scroller: HTMLElement
  page: () => PageSetup
  /** Sections : la première décrit le document, les suivantes ses sauts de section. */
  sections: () => SectionInfo[]
  styles: () => Record<string, StyleDef>
  /** Hauteur (px, sans zoom) de chaque note telle qu'elle sera dessinée. */
  measureNotes: (refs: NoteRef[], labels: string[]) => number[]
  /** Prévenu quand les pages ont changé (dessin des feuilles, champs {{page}}). */
  onPages: (pages: PageInfo[], geometry: Geometry, notes: NotesLayout) => void
  /** Géométrie de chaque section (une section peut changer de format, d'orientation, de marges). */
  geometries?: () => Geometry[]
  /** Décalage du texte de chaque section (null : celui de la page la plus large, sans décalage). */
  shifts?: () => (SectionShift | null)[]
}

export class Paginator {
  private timer: ReturnType<typeof setTimeout> | null = null
  private enabled = true
  private running = false
  pages: PageInfo[] = [{ pos: 0, section: 0, number: 1 }]
  notes: NotesLayout = emptyNotesLayout()
  /** Dernière durée de calcul, en ms (pour les tests de performance). */
  lastMs = 0
  /** Géométrie de chaque section, au dernier calcul. */
  private geoms: Geometry[] = []
  /** En-têtes de tableau redessinés en haut des pages, au dernier calcul. */
  repeats: RepeatedHeader[] = []
  private shifts: (SectionShift | null)[] = []

  constructor(private host: PagesHost) {}

  /** Géométrie d'une section. */
  geometryOf(section: number): Geometry {
    return this.geoms[section] ?? this.geoms[0] ?? geometry(this.host.page())
  }

  /** Géométrie de la page k. */
  pageGeometry(k: number): Geometry {
    return this.geometryOf(this.pages[k]?.section ?? 0)
  }

  /** Haut de la feuille k, en px, sans les écarts entre feuilles (à ajouter : k × écart). */
  sheetOffset(k: number, pages: PageInfo[] = this.pages): number {
    let y = 0
    for (let j = 0; j < k && j < pages.length; j++) y += this.geometryOf(pages[j].section).height
    return y
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    if (!on) {
      this.notes = emptyNotesLayout()
      this.pages = [{ pos: 0, section: 0, number: this.host.page().numberStart }]
      this.shifts = []
      this.apply([], this.pages)
      this.host.onPages(this.pages, geometry(this.host.page()), this.notes)
    } else this.schedule(0)
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  schedule(delay = 120): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.run()
    }, delay)
  }

  /** Calcule tout de suite (tests, impression). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.run()
  }

  private frame(): Frame {
    const r = this.host.paper.getBoundingClientRect()
    const scale = this.host.paper.offsetWidth ? r.width / this.host.paper.offsetWidth : 1
    return { originTop: r.top, scale: scale || 1 }
  }

  run(): void {
    if (!this.enabled || this.running) return
    this.running = true
    const t0 = performance.now()
    try {
      const { view, paper, scroller } = this.host
      const g = geometry(this.host.page())
      this.geoms = this.host.geometries?.() ?? [g]
      this.shifts = this.host.shifts?.() ?? []
      const gOf = (sec: number) => this.geometryOf(sec)
      // 1. Mesurer sans les intercalaires, sans perdre le défilement.
      const scrollTop = scroller.scrollTop
      paper.style.minHeight = `${paper.offsetHeight}px`
      paper.classList.add('fp-measuring')
      const frame = this.frame()
      const boxes = collectBoxes(view, this.host.styles(), frame)
      // Notes : numéros (la page de chaque appel vient du calcul précédent), hauteurs.
      const refs = collectNotes(view.state.doc)
      const labels = noteLabels(refs, view.state.doc.attrs.notes as NoteSettings, (pos) => this.pageIndexAt(pos))
      const heights = refs.length ? this.host.measureNotes(refs, labels) : []
      attachNotes(view, boxes, refs, heights, frame)
      // Section de chaque boîte : le saut de section appartient à la section qu'il termine.
      const boxSection: number[] = []
      let sc = 0
      boxes.forEach((b, i) => {
        boxSection[i] = sc
        if ((b as MBox).section) sc++
      })
      const breaks = paginate(boxes, (first) => gOf(boxSection[first] ?? 0).contentHeight, NOTE_SEP)
      const spacers: Spacer[] = []
      const sections = this.host.sections()
      const first = sections[0]?.numberStart ?? this.host.page().numberStart
      const pages: PageInfo[] = [{ pos: 0, section: 0, number: first }]
      const repeats: RepeatedHeader[] = []
      let section = 0
      for (const b of breaks) {
        const box = boxes[b.box] as MBox
        let s: Spacer
        if (b.line > 0 && box.textPos !== undefined && box.textNode) {
          const lines = box.lines!()
          s = { pos: positionOfLine(view, box.textPos, box.textNode, lines[b.line].top, frame), kind: 'inline', height: 0 }
        } else if (b.line > 0 && box.list) {
          s = { pos: box.from, kind: 'inner', line: b.line, height: 0 }
        } else {
          s = { pos: box.before, kind: box.row ? 'row' : 'block', height: 0 }
        }
        const prev = pages[pages.length - 1]
        const gPrev = gOf(prev.section)
        const opens = b.box > 0 && (boxes[b.box - 1] as MBox).section === true
        let number = prev.number + 1
        if (opens) section++
        const gNext = gOf(section)
        // La page suivante commence là où l'écart l'amène : le reste de la feuille, puis la marge du haut de la suivante.
        s.height = gPrev.height - b.used + (gNext.top - gPrev.top)
        // Ligne de tableau sous un en-tête répété : sa place est laissée en haut de la page.
        if (b.line === 0 && box.repeatHeight) {
          s.lead = box.repeatHeight
          s.height += box.repeatHeight
          repeats.push({ page: -1, table: box.table! })
        }
        if (opens) {
          const sec = sections[section]
          if (sec && sec.numberStart !== null) number = sec.numberStart
          // Une section qui doit commencer sur une page impaire (ou paire) : une page blanche s'intercale.
          if (sec && sec.start !== 'page' && (number % 2 === 1) !== (sec.start === 'odd')) {
            pages.push({ pos: s.pos, section, number, blank: true })
            s.height += gNext.height + GAP
            number++
          }
        }
        spacers.push(s)
        pages.push({ pos: s.pos, section, number })
        if (s.lead && repeats.length && repeats[repeats.length - 1].page === -1) repeats[repeats.length - 1].page = pages.length - 1
      }
      paper.classList.remove('fp-measuring')
      paper.style.minHeight = ''
      // 2. Poser les intercalaires, puis corriger les écarts dus aux marges des paragraphes.
      this.apply(spacers, pages)
      this.correct(spacers, pages)
      // 3. Les notes : en bas de leur page ; les notes de fin après le texte, sur des pages ajoutées s'il le faut.
      // Les pages ne sont publiées qu'une fois complètes (l'interface lit leur nombre à tout moment).
      this.pages = pages
      this.repeats = repeats
      this.notes = this.placeNotes(refs, labels, heights, frame)
      this.host.onPages(this.pages, g, this.notes)
      scroller.scrollTop = scrollTop
    } finally {
      this.running = false
      this.lastMs = performance.now() - t0
    }
  }

  /** Après pose : la première ligne de chaque page doit être exactement sous la marge du haut. */
  private correct(spacers: Spacer[], pages: PageInfo[]): void {
    if (!spacers.length) return
    const frame = this.frame()
    const els = Array.from(this.host.paper.querySelectorAll<HTMLElement>('.fp-prose .fp-spacer'))
    if (els.length !== spacers.length) return
    let changed = false
    let shift = 0
    // Indice de la page qui commence après chaque intercalaire.
    const pageOfSpacer: number[] = []
    for (let i = 1; i < pages.length; i++) if (!pages[i].blank) pageOfSpacer.push(i)
    els.forEach((el, k) => {
      const r = el.getBoundingClientRect()
      const after = this.firstAfter(el)
      const actual = after ? (after.getBoundingClientRect().top - frame.originTop) / frame.scale : (r.bottom - frame.originTop) / frame.scale
      // La feuille qui suit l'intercalaire k (les pages blanches comptent).
      const p = pageOfSpacer[k]
      const target = this.sheetOffset(p, pages) + p * GAP + this.geometryOf(pages[p].section).top + (spacers[k].lead ?? 0)
      const diff = target - (actual + shift)
      if (Math.abs(diff) > 0.5) {
        spacers[k].height += diff
        shift += diff
        changed = true
      }
    })
    if (changed) this.apply(spacers, pages)
  }

  /** Premier élément de contenu après un intercalaire (ligne de texte ou bloc). */
  private firstAfter(el: HTMLElement): Element | Range | null {
    if (el.classList.contains('fp-spacer--inline')) {
      // Le premier caractère après l'intercalaire, dans le même paragraphe.
      let n: Node | null = el.nextSibling
      while (n) {
        const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT)
        const t = n.nodeType === Node.TEXT_NODE ? n : walker.nextNode()
        if (t && t.nodeValue) {
          const r = document.createRange()
          r.setStart(t, 0)
          r.setEnd(t, Math.min(1, t.nodeValue.length))
          return r
        }
        n = n.nextSibling
      }
      return null
    }
    let n = el.nextElementSibling
    while (n && n.classList.contains('fp-spacer')) n = n.nextElementSibling
    return n
  }

  /** Notes de bas de page de chaque page ; notes de fin à la suite du texte. */
  private placeNotes(refs: NoteRef[], labels: string[], heights: number[], frame: Frame): NotesLayout {
    const layout: NotesLayout = { refs, labels, heights, foot: this.pages.map(() => []), end: [] }
    if (!refs.length) return layout
    const ends: number[] = []
    refs.forEach((r, i) => {
      if (r.kind === 'foot') layout.foot[this.pageIndexAt(r.pos)].push(i)
      else ends.push(i)
    })
    if (!ends.length) return layout
    const gk = (k: number) => this.geometryOf(this.pages[Math.min(k, this.pages.length - 1)]?.section ?? 0)
    const footZone = (k: number) => {
      const list = layout.foot[k] ?? []
      return list.length ? list.reduce((s, i) => s + heights[i], NOTE_SEP) : 0
    }
    // Bas du texte sur la dernière page.
    const last = this.pages.length - 1
    const sheetTop = this.sheetOffset(last) + last * GAP
    const dom = this.host.view.dom
    const lastEl = dom.lastElementChild
    const bottom = lastEl ? (lastEl.getBoundingClientRect().bottom - frame.originTop) / frame.scale - sheetTop : gk(last).top
    let zone = { page: last, top: Math.max(gk(last).top, bottom) + END_GAP, items: [] as number[], height: NOTE_SEP }
    const limit = (k: number) => gk(k).top + gk(k).contentHeight - footZone(k)
    for (const i of ends) {
      if (zone.top + zone.height + heights[i] > limit(zone.page) + 0.5 && (zone.items.length || zone.page === last)) {
        if (zone.items.length) layout.end.push({ page: zone.page, top: zone.top, items: zone.items })
        zone = { page: zone.page + 1, top: gk(last).top, items: [], height: NOTE_SEP }
      }
      zone.items.push(i)
      zone.height += heights[i]
    }
    layout.end.push({ page: zone.page, top: zone.top, items: zone.items })
    // Pages ajoutées pour la suite des notes de fin.
    const extra = zone.page - last
    const after = this.host.view.state.doc.content.size + 1
    for (let k = 0; k < extra; k++) {
      const prev = this.pages[this.pages.length - 1]
      this.pages = [...this.pages, { pos: after, section: prev.section, number: prev.number + 1, notesOnly: true }]
      layout.foot.push([])
    }
    return layout
  }

  private apply(spacers: Spacer[], pages: PageInfo[]): void {
    const { view } = this.host
    const prev = paginationKey.getState(view.state)
    // Sections décalées : leurs blocs changent avec le texte, la signature aussi.
    let shiftKey = ''
    if (this.shifts.some(Boolean)) {
      const parts: string[] = [JSON.stringify(this.shifts)]
      let sec = 0
      view.state.doc.forEach((node, pos) => {
        if (node.type.name === 'section_break') sec++
        else if (this.shifts[sec]) parts.push(`${pos}:${node.nodeSize}:${node.attrs.indentLeft ?? ''}:${node.attrs.indentRight ?? ''}`)
      })
      shiftKey = parts.join(',')
    }
    const same =
      prev &&
      (prev.shiftKey ?? '') === shiftKey &&
      prev.spacers.length === spacers.length &&
      prev.spacers.every((s, i) => s.pos === spacers[i].pos && s.kind === spacers[i].kind && s.line === spacers[i].line && Math.abs(s.height - spacers[i].height) < 0.05)
    if (!same) {
      const state: PaginationState = { spacers: spacers.map((s) => ({ ...s })), pages, decorations: decorationsFor(view.state.doc, spacers, this.shifts), shiftKey }
      view.dispatch(view.state.tr.setMeta(paginationKey, state).setMeta('addToHistory', false))
    }
  }

  /** Numéro (à partir de 0) de la page qui contient une position (une page blanche ne contient rien). */
  pageIndexAt(pos: number): number {
    let lo = 0
    let hi = this.pages.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.pages[mid].pos <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }
}

export const paginationOf = (state: EditorState): PaginationState | undefined => paginationKey.getState(state)
