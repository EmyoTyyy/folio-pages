// Vue page dans l'interface : calques des feuilles, découpage en pages,
// numéros de page des champs, modification des en-têtes et pieds de page,
// notes (en bas des pages, à la fin ; en vue web, à la suite du texte),
// réglages d'impression, passage vue page ⇄ vue web.

import { mathContextOf } from '../editor/math'
import type { FolioApp } from '../app'
import { collectNotes, noteLabels, refreshNotes, type NoteRef } from '../editor/notes'
import { refreshFields } from '../editor/views'
import { closeHistory } from 'prosemirror-history'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import type { FieldContext } from '../format/fields'
import { loadNoteBlocks } from '../format/load'
import type { Block, HeaderSet, NoteSettings, PageNumberFormat, PageSetup, StyleDef, Watermark } from '../format/types'
import { t } from '../i18n/i18n'
import { settings, updateSettings } from '../settings'
import { h } from '../ui/dom'
import { HeaderFooterEditor } from './hfeditor'
import { GAP, Paginator, geometry, paginationKey, type Geometry, type NotesLayout, type PageInfo, type SectionInfo, type SectionShift } from './pages'
import { pageLabel } from './paginate'
import { drawSheets, fillFields, renderBlocks, type HeaderKind, type HeaderWhich, type SheetSpec } from './sheets'

/** Une section, réglages hérités résolus. */
interface Section {
  /** Position du saut de section (-1 pour la première). */
  pos: number
  node: PMNode | null
  start: 'page' | 'odd' | 'even'
  numberStart: number | null
  numberFormat: PageNumberFormat
  firstPage: boolean
  headers: HeaderSet
  footers: HeaderSet
  /** Mise en page de la section (celle du document, modifiée par les sauts de section). */
  page: PageSetup
}

/** Disposition des feuilles : la page la plus large donne la largeur ; chaque feuille est centrée. */
export interface SheetLayout {
  /** Largeur du papier affiché (la plus large des pages), en px. */
  width: number
  /** Bord gauche et droit du texte le plus étendu (px depuis le bord du papier). */
  textLeft: number
  textRight: number
  geoms: Geometry[]
  /** Bord gauche de la feuille de chaque section. */
  sheetLeft: number[]
  shifts: (SectionShift | null)[]
  /** Toutes les sections n'ont pas la même mise en page. */
  mixed: boolean
}

export function sheetLayout(pages: PageSetup[]): SheetLayout {
  const geoms = pages.map(geometry)
  const width = Math.max(...geoms.map((g) => g.width))
  const sheetLeft = geoms.map((g) => (width - g.width) / 2)
  const xs = geoms.map((g, i) => sheetLeft[i] + g.left)
  const textLeft = Math.min(...xs)
  const textRight = Math.max(...geoms.map((g, i) => xs[i] + g.contentWidth))
  const full = textRight - textLeft
  const shifts = geoms.map((g, i) => (Math.abs(xs[i] - textLeft) < 0.5 && Math.abs(g.contentWidth - full) < 0.5 ? null : { sx: xs[i] - textLeft, cw: g.contentWidth }))
  const key = (g: Geometry) => [g.width, g.height, g.top, g.bottom, g.left, g.right].map((v) => v.toFixed(1)).join('/')
  return { width, textLeft, textRight, geoms, sheetLeft, shifts, mixed: geoms.some((g) => key(g) !== key(geoms[0])) }
}

export class PageView {
  readonly paginator: Paginator
  private readonly sheets: HTMLElement
  private readonly overlay: HTMLElement
  private readonly printStyle: HTMLStyleElement
  /** Mesure des notes (invisible) et notes à la suite du texte (vue web). */
  private readonly measureBox: HTMLElement
  private readonly endList: HTMLElement
  private editor: HeaderFooterEditor | null = null
  private lastSignature = ''
  private fieldsSignature = ''
  private notesSignature = ''
  private drawnCount = 0
  private noteHeights = new Map<string, number>()
  private noteHeightsKey = ''
  private endListTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private app: FolioApp,
    private page: HTMLElement,
    scroller: HTMLElement,
    private zoomBox: HTMLElement,
  ) {
    this.sheets = h('div', { class: 'fp-sheets', 'aria-hidden': 'true' })
    this.overlay = h('div', { class: 'fp-hf-layer' })
    this.measureBox = h('div', { class: 'fp-hf fp-notes-measure', 'aria-hidden': 'true' })
    this.endList = h('div', { class: 'fp-hf fp-notes-end', role: 'region', 'aria-label': t('note.list') })
    page.prepend(this.sheets)
    page.append(this.endList, this.overlay, this.measureBox)
    this.printStyle = h('style', { id: 'fp-print-style', 'data-folio-transient': '' })
    document.head.append(this.printStyle)

    this.paginator = new Paginator({
      view: app.view,
      paper: page,
      scroller,
      page: () => this.setup(),
      sections: () => this.sections().map((s): SectionInfo => ({ start: s.start, numberStart: s.numberStart })),
      styles: () => app.state.doc.attrs.styles as Record<string, StyleDef>,
      measureNotes: (refs, labels) => this.measureNotes(refs, labels),
      onPages: (pages, g, notes) => this.drawn(pages, g, notes),
      geometries: () => this.layout().geoms,
      shifts: () => this.layout().shifts,
    })
    app.openNote = (pos) => this.openNote(pos)
    app.pagesInfo = {
      pageAt: (pos) => this.paginator.pages[this.paginator.pageIndexAt(pos)]?.number ?? 1,
      index: (pos) => this.paginator.pageIndexAt(pos),
      pages: () => this.paginator.pages.length,
      format: (n) => pageLabel(n, this.sections()[this.paginator.pages.find((p) => p.number === n)?.section ?? 0]?.numberFormat ?? this.setup().numberFormat),
    }

    app.sectionFrame = (pos) => {
      if (this.mode !== 'page') return null
      const secs = this.sections()
      let k = 0
      for (let i = 1; i < secs.length; i++) if (secs[i].pos < pos) k = i
      const lay = this.layout()
      const g = lay.geoms[k] ?? lay.geoms[0]
      return { left: lay.sheetLeft[k] ?? 0, width: g.width, marginLeft: g.left, marginRight: g.right, own: k > 0 && !!secs.slice(1, k + 1).some((sec) => sec.node?.attrs.page) }
    }
    app.onDocChange((tr) => {
      if (tr.getMeta(paginationKey)) return
      this.applyGeometry()
      this.paginator.schedule()
      this.scheduleEndList()
    })
    window.addEventListener('resize', () => this.paginator.schedule(200))
    document.fonts?.addEventListener?.('loadingdone', () => {
      this.noteHeights.clear()
      this.paginator.schedule(50)
    })
    // Une image chargée change la hauteur du texte.
    page.addEventListener('load', () => this.paginator.schedule(50), true)

    // Double-clic dans la zone d'un en-tête ou d'un pied de page : on le modifie.
    this.overlay.addEventListener('dblclick', (e) => {
      const zone = (e.target as HTMLElement).closest<HTMLElement>('.fp-hf-zone')
      if (!zone || zone.classList.contains('is-editing')) return
      e.preventDefault()
      this.edit(zone.dataset.kind as HeaderKind, Number(zone.dataset.page))
    })
    // Un clic dans le texte ferme l'en-tête (ou la note) en cours de modification.
    // (à la capture : avant l'éditeur, dont le double-clic sur un appel ouvre une note).
    app.view.dom.addEventListener('mousedown', () => this.closeEditor(), true)
    // Notes : un clic sur le texte d'une note l'ouvre ; sur son numéro, on retourne à l'appel.
    const noteClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const note = target.closest<HTMLElement>('.fp-note')
      if (!note || note.classList.contains('is-editing')) return
      e.preventDefault()
      const pos = Number(note.dataset.pos)
      if (target.closest('.fp-note__num')) this.showReference(pos)
      else this.openNote(pos)
    }
    this.overlay.addEventListener('click', noteClick)
    this.endList.addEventListener('click', noteClick)

    // Impression de formats mélangés : chaque page est imprimée à part, à son format.
    window.addEventListener('beforeprint', () => this.preparePrint())
    window.addEventListener('afterprint', () => this.cleanupPrint())

    this.setMode(settings().view)
  }

  private printBox: HTMLElement | null = null

  /**
   * Avant l'impression, si les sections n'ont pas toutes le même format : une
   * page imprimée par feuille, chacune à la taille de sa section (règles @page
   * nommées). Chaque page montre la portion du papier qui est la sienne.
   */
  preparePrint(): void {
    this.cleanupPrint()
    // (Pas de nouveau calcul ici : les styles d'impression sont déjà actifs, les mesures seraient fausses.)
    if (this.mode !== 'page') return
    const lay = this.layout()
    if (!lay.mixed) return
    const pages = this.paginator.pages
    const box = h('div', { class: 'fp-print-pages', 'aria-hidden': 'true' })
    pages.forEach((pg, k) => {
      const g = this.paginator.geometryOf(pg.section)
      const slice = h('div', { class: 'fp-print-page', 'data-sec': String(pg.section) })
      slice.style.width = `${g.width}px`
      slice.style.height = `${g.height}px`
      slice.style.setProperty('page', `fp-sec-${pg.section}`)
      const copy = this.page.cloneNode(true) as HTMLElement
      copy.removeAttribute('id')
      copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
      copy.querySelectorAll('[contenteditable]').forEach((el) => el.setAttribute('contenteditable', 'false'))
      copy.style.position = 'absolute'
      copy.style.top = `${-this.paginator.sheetOffset(k, pages)}px`
      copy.style.left = `${-(lay.sheetLeft[pg.section] ?? 0)}px`
      copy.style.transform = 'none'
      copy.style.margin = '0'
      slice.append(copy)
      box.append(slice)
    })
    document.body.append(box)
    document.documentElement.classList.add('fp-print-slices')
    this.printBox = box
  }

  cleanupPrint(): void {
    this.printBox?.remove()
    this.printBox = null
    document.documentElement.classList.remove('fp-print-slices')
  }

  setup(): PageSetup {
    return this.app.state.doc.attrs.page as PageSetup
  }

  /** Sections du document : la première vient de la mise en page, les suivantes des sauts de section. */
  sections(): Section[] {
    const a = this.app.state.doc.attrs
    const p = this.setup()
    const out: Section[] = [
      { pos: -1, node: null, start: 'page', numberStart: p.numberStart, numberFormat: p.numberFormat, firstPage: p.firstPage, headers: a.headers as HeaderSet, footers: a.footers as HeaderSet, page: p },
    ]
    this.app.state.doc.forEach((node, pos) => {
      if (node.type.name !== 'section_break') return
      const prev = out[out.length - 1]
      const at = node.attrs
      out.push({
        pos,
        node,
        start: at.start,
        numberStart: at.numberStart,
        numberFormat: at.numberFormat ?? prev.numberFormat,
        firstPage: at.firstPage ?? prev.firstPage,
        headers: (at.headers as HeaderSet | null) ?? prev.headers,
        footers: (at.footers as HeaderSet | null) ?? prev.footers,
        page: at.page ? { ...prev.page, ...(at.page as Partial<PageSetup>), margins: { ...(at.page as PageSetup).margins } } : prev.page,
      })
    })
    return out
  }

  /** Disposition des feuilles d'après la mise en page de chaque section. */
  layout(): SheetLayout {
    return sheetLayout(this.sections().map((sec) => sec.page))
  }

  /** Ce que montre chaque feuille : en-tête, pied de page, numéro. */
  private specs(pages: PageInfo[]): SheetSpec[] {
    const sections = this.sections()
    const evenOdd = this.setup().evenOdd
    return pages.map((pg, k) => {
      const sec = sections[pg.section] ?? sections[0]
      const firstOfSection = k === 0 || pages[k - 1].section !== pg.section
      const which: HeaderWhich = sec.firstPage && firstOfSection ? 'first' : evenOdd && pg.number % 2 === 0 ? 'even' : 'default'
      return {
        headers: sec.headers[which],
        footers: sec.footers[which],
        which,
        section: pg.section,
        number: pg.number,
        label: pageLabel(pg.number, sec.numberFormat),
      }
    })
  }

  get mode(): 'page' | 'web' | 'draft' {
    return this.page.classList.contains('is-paged') ? 'page' : this.page.classList.contains('is-draft') ? 'draft' : 'web'
  }

  /** Vue page, vue web, ou brouillon (texte continu, sans habillage, sauts visibles, images en vignette). */
  setMode(mode: 'page' | 'web' | 'draft'): void {
    this.closeEditor()
    if (settings().view !== mode) updateSettings({ view: mode })
    this.page.classList.toggle('is-paged', mode === 'page')
    this.page.classList.toggle('is-draft', mode === 'draft')
    // Les feuilles sont à redessiner (la vue web les a retirées).
    this.lastSignature = ''
    this.fieldsSignature = ''
    this.applyGeometry()
    if (mode === 'page') this.paginator.setEnabled(true)
    else {
      this.paginator.setEnabled(false)
      this.sheets.replaceChildren()
      this.overlay.replaceChildren()
    }
    this.renderEndList()
    this.app.notifyUi()
  }

  /** Dimensions de la page en variables CSS, et règle @page de l'impression. */
  private applyGeometry(): void {
    const p = this.setup()
    const g = geometry(p)
    const paged = this.mode === 'page' || this.page.classList.contains('is-paged')
    const lay = paged ? this.layout() : null
    const root = document.documentElement.style
    root.setProperty('--pg-w', `${lay ? lay.width : g.width}px`)
    root.setProperty('--pg-h', `${g.height}px`)
    root.setProperty('--pg-top', `${g.top}px`)
    root.setProperty('--pg-right', `${lay ? lay.width - lay.textRight : g.right}px`)
    root.setProperty('--pg-bottom', `${g.bottom}px`)
    root.setProperty('--pg-left', `${lay ? lay.textLeft : g.left}px`)
    root.setProperty('--fp-gap', `${GAP}px`)
    const [w, hgt] = p.orientation === 'landscape' ? [p.height, p.width] : [p.width, p.height]
    const m = p.margins
    if (!paged) this.printStyle.textContent = `@page{size:${w}mm ${hgt}mm;margin:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm}`
    else if (!lay?.mixed) this.printStyle.textContent = `@page{size:${w}mm ${hgt}mm;margin:0}`
    else {
      // Formats mélangés : une règle par section ; l'impression découpe les feuilles une à une (printPages).
      const sizes = this.sections().map((sec, i) => {
        const [sw, sh] = sec.page.orientation === 'landscape' ? [sec.page.height, sec.page.width] : [sec.page.width, sec.page.height]
        return `@page fp-sec-${i}{size:${sw}mm ${sh}mm;margin:0}`
      })
      this.printStyle.textContent = `@page{size:${w}mm ${hgt}mm;margin:0}${sizes.join('')}`
    }
  }

  private drawn(pages: PageInfo[], g: Geometry, notes: NotesLayout): void {
    if (this.mode !== 'page') return
    const a = this.app.state.doc.attrs
    // Nombre de pages changé sans transaction (pages de notes de fin) : la barre d'état suit.
    if (pages.length !== this.drawnCount) {
      this.drawnCount = pages.length
      queueMicrotask(() => this.app.notifyUi())
    }
    this.page.style.setProperty('--pg-count', String(pages.length))
    const total = this.paginator.sheetOffset(pages.length, pages)
    this.page.style.minHeight = `calc(${total.toFixed(2)}px + ${pages.length - 1} * var(--fp-gap, ${GAP}px))`
    const lay = this.layout()
    const specs = this.specs(pages)
    // Numéros des notes avec la coupure qui vient d'être calculée (« recommencer à chaque page »).
    const labels = notes.refs.length ? noteLabels(notes.refs, a.notes as NoteSettings, (pos) => this.paginator.pageIndexAt(pos)) : []
    const noteSig = [notes.refs.map((r, i) => [r.pos, labels[i], r.node.attrs.blocks]), notes.foot, notes.end]
    const math = mathContextOf(this.app.state)
    const repeats = this.paginator.repeats.map((r) => [r.page, r.table, this.app.state.doc.nodeAt(r.table)?.firstChild?.toJSON()])
    const signature = JSON.stringify([a.watermark, pages, specs, a.page, this.layout().geoms, repeats, Object.keys(a.hfAssets), a.title, a.author, a.subject, a.organization, a.styles, a.theme, noteSig, a.math, [...(math.labels ?? [])]])
    if (signature !== this.lastSignature && !this.editor) {
      this.lastSignature = signature
      drawSheets(this.sheets, this.overlay, {
        pages,
        specs,
        geometry: g,
        sheet: (k) => ({ g: this.paginator.geometryOf(pages[k].section), left: lay.sheetLeft[pages[k].section] ?? 0, top: this.paginator.sheetOffset(k, pages) }),
        setup: this.setup(),
        hfAssets: a.hfAssets as Record<string, string>,
        watermark: a.watermark as Watermark | null,
        fields: this.app.fieldContext(),
        math,
        notes: { layout: notes, render: (i, ctx) => this.noteElement(notes.refs[i], labels[i], ctx) },
      })
      this.drawRepeatedHeaders(pages)
    }
    // Les numéros d'appel suivent les pages quand la numérotation recommence à chaque page.
    if ((a.notes as NoteSettings).foot.restart === 'page') {
      const sig = labels.join(',')
      if (sig !== this.notesSignature) {
        this.notesSignature = sig
        this.app.view.dispatch(refreshNotes(this.app.state))
      }
    }
    // Les champs {{page}} et {{pages}} du texte suivent la coupure.
    const fieldsSignature = `${pages.length}:${pages.map((p) => `${p.pos}/${p.number}`).join(',')}`
    if (fieldsSignature !== this.fieldsSignature) {
      this.fieldsSignature = fieldsSignature
      if (this.hasPageFields()) {
        refreshFields(this.app.view)
        // Leur nouvelle valeur peut changer la longueur d'une ligne : un dernier passage.
        this.paginator.schedule(60)
      }
    }
    this.zoomBox.style.height = settings().zoom !== 1 ? `${this.page.offsetHeight * settings().zoom}px` : ''
  }

  /** En-têtes de tableau répétés : une copie de la ligne d'en-tête en haut de chaque page où le tableau continue. */
  private drawRepeatedHeaders(pages: PageInfo[]): void {
    if (!this.paginator.repeats.length) return
    const paper = this.page.getBoundingClientRect()
    const scale = this.page.offsetWidth ? paper.width / this.page.offsetWidth : 1
    for (const r of this.paginator.repeats) {
      const wrap = this.app.view.nodeDOM(r.table) as HTMLElement | null
      const table = wrap?.querySelector('table')
      const head = table?.querySelector('tr')
      if (!table || !head || !pages[r.page]) continue
      const rect = table.getBoundingClientRect()
      const copy = table.cloneNode(false) as HTMLTableElement
      copy.removeAttribute('id')
      copy.style.width = `${rect.width / scale}px`
      copy.style.tableLayout = 'fixed'
      copy.style.margin = '0'
      const cols = document.createElement('colgroup')
      for (const cell of Array.from(head.children)) {
        const col = document.createElement('col')
        col.style.width = `${cell.getBoundingClientRect().width / scale}px`
        col.span = Number((cell as HTMLTableCellElement).colSpan) || 1
        if (col.span > 1) col.style.width = `${cell.getBoundingClientRect().width / scale / col.span}px`
        cols.append(col)
      }
      const body = document.createElement('tbody')
      const row = head.cloneNode(true) as HTMLElement
      row.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'))
      body.append(row)
      copy.append(cols, body)
      const g = this.paginator.geometryOf(pages[r.page].section)
      const box = h('div', { class: 'fp-hf fp-repeat-head', 'aria-hidden': 'true', 'data-page': String(r.page) })
      box.style.top = `calc(${(this.paginator.sheetOffset(r.page, pages) + g.top).toFixed(2)}px + ${r.page} * var(--fp-gap, ${GAP}px))`
      box.style.left = `${((rect.left - paper.left) / scale).toFixed(2)}px`
      box.append(copy)
      this.sheets.append(box)
      // La copie se pose juste au-dessus de la première ligne de la page (le cadre du tableau la rend un peu plus haute).
      const contentTop = paper.top + (this.paginator.sheetOffset(r.page, pages) + r.page * GAP + g.top) * scale
      const first = Array.from(table.querySelectorAll(':scope > tbody > tr')).find((tr) => tr.getBoundingClientRect().top >= contentTop - 2 * scale)
      if (first) {
        const want = (first.getBoundingClientRect().top - paper.top) / scale - box.getBoundingClientRect().height / scale
        const now = (box.getBoundingClientRect().top - paper.top) / scale
        box.style.marginTop = `${(want - now).toFixed(2)}px`
      }
    }
  }

  private hasPageFields(): boolean {
    let found = false
    this.app.state.doc.descendants((n) => {
      if (found) return false
      if ((n.type.name === 'field' && (n.attrs.name === 'page' || n.attrs.name === 'pages')) || n.type.name === 'toc') found = true
      return !found
    })
    return found
  }

  // --- notes ---------------------------------------------------------------

  /** Une note telle qu'elle est dessinée : numéro (retour à l'appel) et texte. */
  private noteElement(ref: NoteRef, label: string, ctx?: FieldContext): HTMLElement {
    const num = h('button', { type: 'button', class: 'fp-note__num', 'aria-label': t('note.back', { n: label }), title: t('note.back', { n: label }) }, label)
    const body = h('div', { class: 'fp-note__body' })
    body.append(renderBlocks(ref.node.attrs.blocks as Block[], {}, mathContextOf(this.app.state)))
    fillFields(body, ctx ?? { ...this.app.fieldContext(), page: 1, pages: 1 })
    return h('div', { class: `fp-note fp-note--${ref.kind}`, 'data-pos': String(ref.pos) }, num, body)
  }

  /** Hauteur de chaque note, dessinée à la largeur du texte (mémorisée tant que rien ne change). */
  private measureNotes(refs: NoteRef[], labels: string[]): number[] {
    const g = geometry(this.setup())
    const a = this.app.state.doc.attrs
    const key = JSON.stringify([g.contentWidth, a.styles, a.theme, (a.fonts as unknown[]).length])
    if (key !== this.noteHeightsKey || this.noteHeights.size > 4000) {
      this.noteHeightsKey = key
      this.noteHeights.clear()
    }
    const keys = refs.map((r, i) => `${labels[i]}|${JSON.stringify(r.node.attrs.blocks)}`)
    const missing = keys.flatMap((k, i) => (this.noteHeights.has(k) ? [] : [i]))
    if (missing.length) {
      const box = this.measureBox
      box.style.width = `${g.contentWidth}px`
      box.replaceChildren(...missing.map((i) => this.noteElement(refs[i], labels[i])))
      const scale = this.page.offsetWidth ? this.page.getBoundingClientRect().width / this.page.offsetWidth : 1
      Array.from(box.children).forEach((el, k) => this.noteHeights.set(keys[missing[k]], el.getBoundingClientRect().height / (scale || 1)))
      box.replaceChildren()
    }
    return keys.map((k) => this.noteHeights.get(k) ?? 0)
  }

  private scheduleEndList(): void {
    if (this.mode === 'page' && !this.endList.childNodes.length) return
    if (this.endListTimer) clearTimeout(this.endListTimer)
    this.endListTimer = setTimeout(() => {
      this.endListTimer = null
      this.renderEndList()
    }, 120)
  }

  /** Vue web : les notes de bas de page puis les notes de fin, à la suite du texte. */
  private renderEndList(): void {
    if (this.editor?.kind === 'note' && this.endList.contains(this.editor.view.dom)) return
    const refs = this.mode === 'page' ? [] : collectNotes(this.app.state.doc)
    if (!refs.length) {
      this.endList.replaceChildren()
      return
    }
    const labels = noteLabels(refs, this.app.state.doc.attrs.notes as NoteSettings)
    const group = (kind: 'foot' | 'end') => {
      const items = refs.flatMap((r, i) => (r.kind === kind ? [this.noteElement(r, labels[i])] : []))
      return items.length ? [h('div', { class: 'fp-notes-end__group', 'data-kind': kind }, h('div', { class: 'fp-notes-end__title' }, t(kind === 'foot' ? 'note.footTitle' : 'note.endTitle')), ...items)] : []
    }
    this.endList.replaceChildren(...group('foot'), ...group('end'))
  }

  /** Retour à l'appel d'une note dans le texte. */
  showReference(pos: number): void {
    this.closeEditor()
    const node = this.app.state.doc.nodeAt(pos)
    if (!node || node.type.name !== 'note') return
    this.app.view.dispatch(this.app.state.tr.setSelection(NodeSelection.create(this.app.state.doc, pos)).scrollIntoView())
    this.app.view.focus()
  }

  /** Ouvre une note à la modification, là où elle est dessinée. */
  openNote(pos: number): void {
    if (this.app.reading) return
    const node = this.app.state.doc.nodeAt(pos)
    if (!node || node.type.name !== 'note') return
    this.closeEditor()
    let el: HTMLElement | null
    if (this.mode === 'page') {
      this.paginator.flush()
      el = this.overlay.querySelector<HTMLElement>(`.fp-note[data-pos="${pos}"]`)
    } else {
      this.renderEndList()
      el = this.endList.querySelector<HTMLElement>(`.fp-note[data-pos="${pos}"]`)
    }
    const body = el?.querySelector<HTMLElement>('.fp-note__body')
    if (!el || !body) return
    const app = this.app
    const label = el.querySelector('.fp-note__num')?.textContent ?? ''
    const zone = el.closest<HTMLElement>('.fp-notes-zone')
    el.classList.add('is-editing')
    zone?.classList.add('is-editing')
    this.page.classList.add('is-note-editing')
    const pageIndex = this.paginator.pageIndexAt(pos)
    const io = {
      label: this.mode === 'page' ? (this.specs(this.paginator.pages)[pageIndex]?.label ?? '1') : '1',
      ariaLabel: t(node.attrs.kind === 'end' ? 'note.editEnd' : 'note.editFoot', { n: label }),
      keepEmpty: true,
      // Échap : retour au texte, juste après l'appel de note.
      onEscape: () => {
        const doc = app.state.doc
        const at = doc.nodeAt(pos) === node ? pos : (collectNotes(doc).find((r) => r.node === node)?.pos ?? -1)
        if (at >= 0) app.view.dispatch(app.state.tr.setSelection(TextSelection.create(doc, at + 1)).scrollIntoView())
        app.view.focus()
      },
      read: (): Block[] => node.attrs.blocks as Block[],
      write: (blocks: Block[]) => {
        // La note a pu bouger (rien ne la modifie pendant ce temps, mais par prudence on la retrouve).
        const doc = app.state.doc
        const at = doc.nodeAt(pos) === node ? pos : (collectNotes(doc).find((r) => r.node === node)?.pos ?? -1)
        if (at < 0) return
        // Le texte de la note : une étape d'annulation, séparée de ce qui précède et de ce qui suit.
        app.view.dispatch(closeHistory(app.state.tr.setNodeMarkup(at, null, { ...node.attrs, blocks: loadNoteBlocks(blocks) })))
        app.view.dispatch(closeHistory(app.state.tr))
      },
    }
    this.editor = new HeaderFooterEditor(app, 'note', 'default', io, body, () => {
      this.editor = null
      this.page.classList.remove('is-note-editing')
      el.classList.remove('is-editing')
      zone?.classList.remove('is-editing')
      this.lastSignature = ''
      if (this.mode === 'page') this.paginator.schedule(0)
      else this.renderEndList()
    })
    el.scrollIntoView({ block: 'nearest' })
    this.app.notifyUi()
  }

  /** Ouvre l'en-tête (ou le pied de page) de la page `index` à la modification. */
  edit(kind: HeaderKind, index = this.currentPageIndex()): void {
    if (this.app.reading) return
    if (this.mode !== 'page') this.setMode('page')
    this.paginator.flush()
    this.closeEditor()
    const zone = this.overlay.querySelector<HTMLElement>(`.fp-hf-zone[data-kind="${kind}"][data-page="${index}"]`)
    if (!zone) return
    const which = (zone.dataset.which as HeaderWhich) ?? 'default'
    const sectionIndex = Number(zone.dataset.section ?? 0)
    const label = this.specs(this.paginator.pages)[index]?.label ?? '1'
    const app = this.app
    // Section 0 : l'en-tête du document ; section suivante : le sien (créé à partir de celui dont il hérite).
    const io = {
      label,
      onEscape: () => app.view.focus(),
      read: (): Block[] => this.sections()[sectionIndex]?.[kind][which] ?? [],
      write: (blocks: Block[], assets: Record<string, string>) => {
        const sec = this.sections()[sectionIndex]
        if (!sec || sectionIndex === 0 || !sec.node) {
          const set = app.state.doc.attrs[kind] as HeaderSet
          app.setDocAttrs({ [kind]: { ...set, [which]: blocks }, hfAssets: assets })
          return
        }
        const own = (sec.node.attrs[kind] as HeaderSet | null) ?? sec[kind]
        const tr = app.state.tr.setNodeMarkup(sec.pos, null, { ...sec.node.attrs, [kind]: { ...own, [which]: blocks } })
        tr.setDocAttribute('hfAssets', assets)
        app.view.dispatch(tr)
      },
    }
    this.page.classList.add('is-hf-editing')
    this.editor = new HeaderFooterEditor(this.app, kind, which, io, zone, () => {
      this.editor = null
      this.page.classList.remove('is-hf-editing')
      this.lastSignature = ''
      this.paginator.schedule(0)
    })
    this.app.notifyUi()
  }

  closeEditor(): void {
    this.editor?.close()
  }

  /** En-tête ou pied de page en cours de modification. */
  get editing(): HeaderFooterEditor | null {
    return this.editor && this.editor.kind !== 'note' ? this.editor : null
  }

  /** Note en cours de modification. */
  get editingNote(): HeaderFooterEditor | null {
    return this.editor?.kind === 'note' ? this.editor : null
  }

  /** Page affichée au milieu de la fenêtre (pour « Modifier l'en-tête »). */
  currentPageIndex(): number {
    const sel = this.app.state.selection.from
    return this.paginator.pageIndexAt(sel)
  }

  get pageCount(): number {
    return this.mode === 'page' ? this.paginator.pages.length : 1
  }
}
