// Références : numéros de légende, signets, renvois, entrées d'index,
// citations, et les listes générées (table des illustrations, index, table
// des références, bibliographie).
//
// Comme la table des matières, rien de tout cela n'est écrit dans le texte :
// un seul calcul sur le document (à chaque modification, et quand les pages
// changent) donne la valeur de chaque élément, portée par des décorations.

import { Fragment, type Node as PMNode } from 'prosemirror-model'
import { NodeSelection, Plugin, PluginKey, TextSelection, type Command, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView, type NodeView } from 'prosemirror-view'
import { AUTHORITY_CATEGORIES, type AuthorityCategory, type CitationStyle, type Source, type XrefShow } from '../format/types'
import { bibliographyEntry, bibliographyOrder, citationText, citeContext, entryLabel, type CiteContext, type Piece } from '../refs/cite'
import { schema } from './schema'
import { applyInnerBreaks } from '../layout/pages'

const n = schema.nodes

export interface PageRef {
  /** Indice de la page (tri). */
  index: number
  /** Numéro affiché (1, iv, B…). */
  label: string
}

export interface RefsHooks {
  /** Page d'une position ; null hors de la vue page. */
  pageOf: (pos: number) => PageRef | null
  jump: (pos: number) => void
  /** Langue des mots des citations (« et », « s. d. »…). */
  lang: () => string
  labels: () => RefsLabels
}

export interface RefsLabels {
  missingBookmark: string
  above: string
  below: string
  emptyFigures: string
  emptyIndex: string
  emptyAuthorities: string
  emptyBibliography: string
  see: string
  passim: string
  category: (c: AuthorityCategory) => string
}

export interface Caption {
  label: string
  number: number
  /** Position du paragraphe (ou de l'image) de la légende. */
  pos: number
  /** Texte complet : « Figure 2 : Le port de Gênes ». */
  text: string
}

export interface IndexEntry {
  term: string
  subs: { sub: string; pages: PageItem[]; see: string }[]
  pages: PageItem[]
  see: string
}

export interface PageItem {
  pos: number
  page: PageRef | null
  bold: boolean
  italic: boolean
}

export interface AuthorityEntry {
  category: AuthorityCategory
  term: string
  pages: PageItem[]
}

/** Tout ce que le calcul sait du document. */
export interface RefsData {
  seq: Map<number, number>
  /** Texte de chaque renvoi et de chaque citation, par position. */
  texts: Map<number, string>
  captions: Caption[]
  bookmarks: Map<string, number>
  index: IndexEntry[]
  authorities: AuthorityEntry[]
  /** Sources citées, dans l'ordre de première citation. */
  cited: string[]
  cite: CiteContext
}

/** Blocs dont on parcourt l'intérieur (les légendes peuvent être dans un tableau, une citation…). */
const isContainer = (node: PMNode) => !node.isTextblock && !node.isAtom

/** Texte d'un paragraphe, numéros de légende compris. */
function blockText(node: PMNode, base: number, seq: Map<number, number>, until = Infinity): string {
  let s = ''
  node.forEach((child, off) => {
    const pos = base + 1 + off
    if (pos > until) return
    if (child.isText) s += child.text
    else if (child.type === n.seq) s += String(seq.get(pos) ?? '?')
    else if (child.type === n.hard_break) s += ' '
  })
  return s.replace(/\s+/g, ' ').trim()
}

/** Calcule les références d'un document. */
export function scanRefs(doc: PMNode, hooks: Pick<RefsHooks, 'pageOf' | 'lang' | 'labels'>): RefsData {
  const seqCount = new Map<string, number>()
  const seq = new Map<number, number>()
  const bookmarks = new Map<string, number>()
  /** Paragraphe qui contient chaque signet. */
  const bookmarkBlock = new Map<string, { node: PMNode; pos: number }>()
  const xrefs: { pos: number; target: string; show: XrefShow }[] = []
  const cites: { pos: number; ids: string[]; locator: string }[] = []
  const captions: Caption[] = []
  const xes: { pos: number; attrs: Record<string, unknown> }[] = []
  const blocks: { node: PMNode; pos: number; firstSeq: number | null; label: string | null }[] = []

  doc.descendants((node, pos) => {
    if (!node.isTextblock && !(node.type === n.figure)) return isContainer(node)
    let firstSeq: number | null = null
    let label: string | null = null
    node.forEach((child, off) => {
      const p = pos + 1 + off
      if (child.type === n.seq) {
        const l = child.attrs.label as string
        const k = (seqCount.get(l) ?? 0) + 1
        seqCount.set(l, k)
        seq.set(p, k)
        if (firstSeq === null) {
          firstSeq = p
          label = l
        }
      } else if (child.type === n.bookmark) {
        const name = child.attrs.name as string
        if (!bookmarks.has(name)) {
          bookmarks.set(name, p)
          bookmarkBlock.set(name, { node, pos })
        }
      } else if (child.type === n.xref) xrefs.push({ pos: p, target: child.attrs.target, show: child.attrs.show })
      else if (child.type === n.cite) cites.push({ pos: p, ids: child.attrs.ids as string[], locator: child.attrs.locator as string })
      else if (child.type === n.xe) xes.push({ pos: p, attrs: child.attrs })
    })
    blocks.push({ node, pos, firstSeq, label })
    return false
  })

  for (const b of blocks) {
    if (b.firstSeq === null || b.label === null) continue
    captions.push({ label: b.label, number: seq.get(b.firstSeq) ?? 0, pos: b.pos, text: blockText(b.node, b.pos, seq) })
  }

  const labels = hooks.labels()
  const texts = new Map<number, string>()
  for (const x of xrefs) {
    const target = bookmarks.get(x.target)
    const blk = bookmarkBlock.get(x.target)
    if (target === undefined || !blk) {
      texts.set(x.pos, labels.missingBookmark)
      continue
    }
    let firstSeq: number | null = null
    blk.node.forEach((child, off) => {
      if (firstSeq === null && child.type === n.seq) firstSeq = blk.pos + 1 + off
    })
    let v = ''
    switch (x.show) {
      case 'page':
        v = hooks.pageOf(target)?.label ?? '1'
        break
      case 'above':
        v = x.pos < target ? labels.below : labels.above
        break
      case 'number':
        v = firstSeq !== null ? String(seq.get(firstSeq) ?? '') : blockText(blk.node, blk.pos, seq)
        break
      case 'label':
        v = firstSeq !== null ? blockText(blk.node, blk.pos, seq, firstSeq) : blockText(blk.node, blk.pos, seq)
        break
      default:
        v = blockText(blk.node, blk.pos, seq)
    }
    texts.set(x.pos, v)
  }

  // Citations : contexte du style (numéros dans l'ordre de première citation).
  const cited: string[] = []
  for (const c of cites) for (const id of c.ids) cited.push(id)
  const sources = (doc.attrs.sources as Source[] | undefined) ?? []
  const cite = citeContext(sources, cited, (doc.attrs.citationStyle as CitationStyle) ?? 'apa', (doc.attrs.lang as string) || hooks.lang())
  for (const c of cites) texts.set(c.pos, citationText(cite, c.ids, c.locator))

  // Index et table des références.
  const coll = new Intl.Collator((doc.attrs.lang as string) || hooks.lang(), { sensitivity: 'base', numeric: true })
  const byTerm = new Map<string, IndexEntry>()
  const auth = new Map<string, AuthorityEntry>()
  for (const x of xes) {
    const a = x.attrs
    const item: PageItem = { pos: x.pos, page: hooks.pageOf(x.pos), bold: !!a.bold, italic: !!a.italic }
    const term = String(a.term)
    if (a.authority) {
      const key = `${a.authority}\u0000${term}`
      const e = auth.get(key) ?? { category: a.authority as AuthorityCategory, term, pages: [] }
      e.pages.push(item)
      auth.set(key, e)
      continue
    }
    const key = term.toLocaleLowerCase()
    const e = byTerm.get(key) ?? { term, subs: [], pages: [], see: '' }
    if (a.sub) {
      let sub = e.subs.find((s) => s.sub.toLocaleLowerCase() === String(a.sub).toLocaleLowerCase())
      if (!sub) {
        sub = { sub: String(a.sub), pages: [], see: '' }
        e.subs.push(sub)
      }
      if (a.see) sub.see = String(a.see)
      else sub.pages.push(item)
    } else if (a.see) e.see = String(a.see)
    else e.pages.push(item)
    byTerm.set(key, e)
  }
  const index = [...byTerm.values()].sort((a, b) => coll.compare(a.term, b.term))
  for (const e of index) e.subs.sort((a, b) => coll.compare(a.sub, b.sub))
  const authorities = [...auth.values()].sort((a, b) => AUTHORITY_CATEGORIES.indexOf(a.category) - AUTHORITY_CATEGORIES.indexOf(b.category) || coll.compare(a.term, b.term))

  return { seq, texts, captions, bookmarks, index, authorities, cited, cite }
}

/** Numéros de page d'une entrée, sans doublon, dans l'ordre : « 3, 7, 12 ». */
export function pageList(items: PageItem[]): { label: string; bold: boolean; italic: boolean; pos: number }[] {
  const seen = new Map<string, { label: string; bold: boolean; italic: boolean; pos: number; index: number }>()
  for (const it of items) {
    const label = it.page?.label ?? ''
    if (!label) continue
    const cur = seen.get(label)
    if (cur) {
      cur.bold ||= it.bold
      cur.italic ||= it.italic
    } else seen.set(label, { label, bold: it.bold, italic: it.italic, pos: it.pos, index: it.page?.index ?? 0 })
  }
  return [...seen.values()].sort((a, b) => a.index - b.index)
}

/** Première lettre d'un terme, pour les intertitres de l'index (sans accent). */
export const letterOf = (term: string): string => {
  const c = term.normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toLocaleUpperCase()
  return /\p{L}/u.test(c) ? c : '#'
}

// --- plugin -------------------------------------------------------------------------

export const refsKey = new PluginKey<{ data: RefsData; decos: DecorationSet }>('folio-refs')

/** Le calcul n'est utile que si le document contient une référence : sinon, rien. */
function hasRefs(doc: PMNode): boolean {
  let found = false
  doc.descendants((node) => {
    if (found) return false
    if (node.type === n.seq || node.type === n.xref || node.type === n.cite || node.type === n.xe || node.type === n.refblock || node.type === n.bookmark) found = true
    return !found && !node.isAtom
  })
  return found
}

const EMPTY = (): RefsData => ({ seq: new Map(), texts: new Map(), captions: [], bookmarks: new Map(), index: [], authorities: [], cited: [], cite: citeContext([], [], 'apa', 'en') })

export function refsPlugin(hooks: RefsHooks, refreshKeys: PluginKey[] = []): Plugin {
  const build = (state: EditorState) => {
    if (!hasRefs(state.doc)) return { data: EMPTY(), decos: DecorationSet.empty }
    const data = scanRefs(state.doc, hooks)
    const decos: Decoration[] = []
    state.doc.descendants((node, pos) => {
      if (node.type === n.seq) decos.push(Decoration.node(pos, pos + node.nodeSize, {}, { refValue: String(data.seq.get(pos) ?? '?') }))
      else if (node.type === n.xref || node.type === n.cite) decos.push(Decoration.node(pos, pos + node.nodeSize, {}, { refValue: data.texts.get(pos) ?? '' }))
      else if (node.type === n.refblock) decos.push(Decoration.node(pos, pos + node.nodeSize, {}, { refData: data }))
      return !node.isAtom
    })
    return { data, decos: DecorationSet.create(state.doc, decos) }
  }
  return new Plugin({
    key: refsKey,
    state: {
      init: (_c, state) => build(state),
      apply: (tr, value, _old, state) => (tr.docChanged || tr.getMeta(refsKey) || refreshKeys.some((k) => tr.getMeta(k)) ? build(state) : value),
    },
    props: {
      decorations: (state) => refsKey.getState(state)?.decos,
      nodeViews: {
        seq: (node, _v, _g, decos) => new ValueView(node, decos, 'fp-seq'),
        xref: (node, view, _g, decos) => new ValueView(node, decos, 'fp-xref', (e) => jumpToTarget(view, node.attrs.target, hooks, e)),
        cite: (node, _v, _g, decos) => new ValueView(node, decos, 'fp-cite'),
        bookmark: (node) => new MarkerView(node, 'fp-bookmark', `[${node.attrs.name}]`),
        xe: (node) => new MarkerView(node, 'fp-xe', `{XE « ${node.attrs.term}${node.attrs.sub ? ':' + node.attrs.sub : ''} »}`),
        refblock: (node, _v, _g, decos) => new RefBlockView(node, decos, hooks),
      },
    },
  })
}

function jumpToTarget(view: EditorView, target: string, hooks: RefsHooks, e: MouseEvent): boolean {
  if (!(e.ctrlKey || e.metaKey)) return false
  const pos = refsKey.getState(view.state)?.data.bookmarks.get(target)
  if (pos === undefined) return false
  hooks.jump(pos)
  return true
}

/** Numéro, renvoi, citation : un atome qui montre la valeur calculée. */
class ValueView implements NodeView {
  dom: HTMLElement
  constructor(
    private node: PMNode,
    decorations: readonly Decoration[],
    cls: string,
    private onClick?: (e: MouseEvent) => boolean,
  ) {
    this.dom = document.createElement('span')
    this.dom.className = cls
    this.dom.contentEditable = 'false'
    if (onClick)
      this.dom.addEventListener('mousedown', (e) => {
        if (this.onClick?.(e)) e.preventDefault()
      })
    this.render(decorations)
  }
  private render(decorations: readonly Decoration[]): void {
    const d = decorations.find((x) => (x.spec as { refValue?: string }).refValue !== undefined)
    const v = d ? (d.spec as { refValue: string }).refValue : ''
    this.dom.textContent = v || '?'
    const a = this.node.attrs
    if (this.node.type === n.seq) this.dom.dataset.seq = a.label
    if (this.node.type === n.xref) {
      this.dom.dataset.xref = a.target
      this.dom.dataset.show = a.show
    }
    if (this.node.type === n.cite) this.dom.dataset.cite = (a.ids as string[]).join(' ')
  }
  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render(decorations)
    return true
  }
  selectNode(): void {
    this.dom.classList.add('is-selected')
  }
  deselectNode(): void {
    this.dom.classList.remove('is-selected')
  }
  ignoreMutation(): boolean {
    return true
  }
}

/** Signet, entrée d'index : invisibles, montrés seulement avec les marques de mise en forme. */
class MarkerView implements NodeView {
  dom: HTMLElement
  constructor(node: PMNode, cls: string, shown: string) {
    this.dom = document.createElement('span')
    this.dom.className = cls
    this.dom.contentEditable = 'false'
    this.dom.dataset.marker = shown
    if (node.type === n.bookmark) {
      this.dom.dataset.bookmark = node.attrs.name
      this.dom.id = `bm-${node.attrs.name}`
    } else this.dom.dataset.xe = node.attrs.term
  }
  ignoreMutation(): boolean {
    return true
  }
}

/** Liste générée : table des illustrations, index, table des références, bibliographie. */
class RefBlockView implements NodeView {
  dom: HTMLElement
  constructor(
    private node: PMNode,
    decorations: readonly Decoration[],
    private hooks: RefsHooks,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'fp-refblock'
    this.dom.contentEditable = 'false'
    this.render(decorations)
  }
  private link(text: string | Piece[], pos: number, page: string | null, cls: string): HTMLElement {
    const a = document.createElement('a')
    a.href = '#'
    a.className = cls
    const t = document.createElement('span')
    t.className = 'fp-toc__text'
    if (typeof text === 'string') t.textContent = text
    else for (const p of text) t.append(piece(p))
    a.append(t)
    if (page !== null) {
      const dots = document.createElement('span')
      dots.className = 'fp-toc__dots'
      const pg = document.createElement('span')
      pg.className = 'fp-toc__page'
      pg.textContent = page
      a.append(dots, pg)
    }
    a.addEventListener('mousedown', (e) => e.preventDefault())
    a.addEventListener('click', (e) => {
      e.preventDefault()
      this.hooks.jump(pos)
    })
    return a
  }
  private pages(items: PageItem[]): HTMLElement {
    const span = document.createElement('span')
    span.className = 'fp-index__pages'
    pageList(items).forEach((p, i) => {
      if (i) span.append(', ')
      const a = document.createElement('a')
      a.href = '#'
      a.textContent = p.label
      if (p.bold) a.style.fontWeight = '700'
      if (p.italic) a.style.fontStyle = 'italic'
      a.addEventListener('mousedown', (e) => e.preventDefault())
      a.addEventListener('click', (e) => {
        e.preventDefault()
        this.hooks.jump(p.pos)
      })
      span.append(a)
    })
    return span
  }
  private empty(text: string): HTMLElement {
    const p = document.createElement('p')
    p.className = 'fp-toc__empty'
    p.textContent = text
    return p
  }
  private render(decorations: readonly Decoration[]): void {
    const d = decorations.find((x) => (x.spec as { refData?: RefsData }).refData)
    const data = d ? (d.spec as { refData: RefsData }).refData : EMPTY()
    const a = this.node.attrs
    const L = this.hooks.labels()
    this.dom.dataset.kind = a.kind
    this.dom.replaceChildren()
    if (a.title) {
      const title = document.createElement('p')
      title.className = 'fp-toc__title fp-refblock__title'
      title.dataset.row = ''
      title.textContent = a.title
      this.dom.append(title)
    }
    if (a.kind === 'figures') {
      const list = data.captions.filter((c) => c.label === a.label)
      if (!list.length) return void this.dom.append(this.empty(L.emptyFigures))
      const ol = document.createElement('ol')
      ol.className = 'fp-toc__list'
      for (const c of list) {
        const li = document.createElement('li')
        li.className = 'fp-toc__entry'
        li.dataset.level = '1'
        li.dataset.row = ''
        li.append(this.link(c.text, c.pos, this.hooks.pageOf(c.pos)?.label ?? null, 'fp-refblock__link'))
        ol.append(li)
      }
      this.dom.append(ol)
      applyInnerBreaks(this.dom, decorations)
      return
    }
    if (a.kind === 'index') {
      if (!data.index.length) return void this.dom.append(this.empty(L.emptyIndex))
      const body = document.createElement('div')
      body.className = 'fp-index'
      body.style.columnCount = String(a.columns)
      let letter = ''
      for (const e of data.index) {
        const l = letterOf(e.term)
        if (l !== letter) {
          letter = l
          const h = document.createElement('p')
          h.className = 'fp-index__letter'
          h.textContent = l
          body.append(h)
        }
        body.append(this.entry(e.term, e.pages, e.see, 0, L))
        for (const s of e.subs) body.append(this.entry(s.sub, s.pages, s.see, 1, L))
      }
      this.dom.append(body)
      // Sur une colonne, l'index se coupe entre ses lignes ; en colonnes, il reste d'un seul tenant.
      if (a.columns === 1) {
        body.querySelectorAll('.fp-index__letter, .fp-index__entry').forEach((el) => ((el as HTMLElement).dataset.row = ''))
        applyInnerBreaks(this.dom, decorations)
      }
      return
    }
    if (a.kind === 'authorities') {
      const list = data.authorities.filter((x) => a.category === 'all' || x.category === a.category)
      if (!list.length) return void this.dom.append(this.empty(L.emptyAuthorities))
      let cat = ''
      for (const x of list) {
        if (x.category !== cat && a.category === 'all') {
          cat = x.category
          const h = document.createElement('p')
          h.className = 'fp-index__letter'
          h.dataset.row = ''
          h.textContent = L.category(x.category)
          this.dom.append(h)
        }
        const row = document.createElement('p')
        row.className = 'fp-authority'
        row.dataset.row = ''
        const pages = pageList(x.pages)
        const term = document.createElement('span')
        term.className = 'fp-toc__text'
        term.textContent = x.term
        const dots = document.createElement('span')
        dots.className = 'fp-toc__dots'
        row.append(term, dots)
        if (pages.length >= 5) row.append(L.passim)
        else row.append(this.pages(x.pages))
        this.dom.append(row)
      }
      applyInnerBreaks(this.dom, decorations)
      return
    }
    // Bibliographie.
    const all = a.all ? [...data.cite.sources.keys()] : data.cited
    const list = bibliographyOrder(data.cite, all)
    if (!list.length) return void this.dom.append(this.empty(L.emptyBibliography))
    const ol = document.createElement('ol')
    ol.className = 'fp-bib'
    ol.dataset.style = data.cite.style
    for (const s of list) {
      const li = document.createElement('li')
      li.className = 'fp-bib__entry'
      li.dataset.row = ''
      li.dataset.source = s.id
      const label = entryLabel(data.cite, s)
      if (label) {
        const l = document.createElement('span')
        l.className = 'fp-bib__label'
        l.textContent = label
        li.append(l)
      }
      const body = document.createElement('span')
      for (const p of bibliographyEntry(data.cite, s)) body.append(piece(p))
      li.append(body)
      ol.append(li)
    }
    this.dom.append(ol)
    applyInnerBreaks(this.dom, decorations)
  }
  private entry(term: string, pages: PageItem[], see: string, level: number, L: RefsLabels): HTMLElement {
    const p = document.createElement('p')
    p.className = 'fp-index__entry'
    p.dataset.level = String(level)
    p.append(term)
    if (see) {
      const em = document.createElement('em')
      em.textContent = `${L.see} ${see}`
      p.append('. ', em)
    } else if (pages.length) {
      p.append(', ', this.pages(pages))
    }
    return p
  }
  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render(decorations)
    return true
  }
  selectNode(): void {
    this.dom.classList.add('is-selected')
  }
  deselectNode(): void {
    this.dom.classList.remove('is-selected')
  }
  stopEvent(e: Event): boolean {
    return (e.type === 'click' || e.type === 'mousedown') && !!(e.target as HTMLElement).closest?.('a')
  }
  ignoreMutation(): boolean {
    return true
  }
}

function piece(p: Piece): Node {
  if (!p.italic) return document.createTextNode(p.text)
  const em = document.createElement('em')
  em.textContent = p.text
  return em
}

// --- commandes ----------------------------------------------------------------------

export const refsOf = (state: EditorState): RefsData | null => refsKey.getState(state)?.data ?? null

/** Insère un élément en ligne à la place de la sélection, curseur après lui. */
export function insertInline(node: PMNode): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    if (!$from.parent.inlineContent) return false
    if (dispatch) {
      const marks = node.type === n.bookmark || node.type === n.xe ? [] : $from.marks()
      const tr = state.tr.replaceSelectionWith(node.mark(marks), false)
      const at = tr.mapping.map(state.selection.from, -1)
      const after = tr.doc.nodeAt(at)?.type === node.type ? at + 1 : tr.selection.from
      tr.setSelection(TextSelection.create(tr.doc, after))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Un nom de signet libre, pour un renvoi : « _Ref » et des chiffres (caché, comme d'habitude). */
export function freeRefName(state: EditorState): string {
  const used = new Set(refsOf(state)?.bookmarks.keys() ?? [])
  state.doc.descendants((node) => {
    if (node.type === n.bookmark) used.add(node.attrs.name)
    return !node.isAtom
  })
  for (;;) {
    const name = `_Ref${Math.floor(1e8 + Math.random() * 9e8)}`
    if (!used.has(name)) return name
  }
}

/** Signet du paragraphe (ou de l'image) à `pos` : celui qui y est déjà, sinon un nouveau signet caché au début. */
export function ensureBookmark(state: EditorState, pos: number): { name: string; tr: import('prosemirror-state').Transaction | null } {
  const node = state.doc.nodeAt(pos)
  if (!node) return { name: '', tr: null }
  let found = ''
  node.forEach((child) => {
    if (!found && child.type === n.bookmark) found = child.attrs.name
  })
  if (found) return { name: found, tr: null }
  const name = freeRefName(state)
  return { name, tr: state.tr.insert(pos + 1, n.bookmark.create({ name })) }
}

/** Légende : « Figure 3 : … » au début d'une image ou dans un paragraphe « Légende » au-dessus / au-dessous d'un objet. */
export function captionContent(word: string, label: string, text: string, sep: string): Fragment {
  const nodes: PMNode[] = []
  if (word) nodes.push(schema.text(`${word} `))
  nodes.push(n.seq.create({ label }))
  if (text) nodes.push(schema.text(`${sep}${text}`))
  return Fragment.from(nodes)
}

/** Ce qu'on peut légender autour de la sélection : image, tableau, équation, ou rien (paragraphe au curseur). */
export function captionTarget(state: EditorState): { kind: 'figure' | 'table' | 'equation' | 'none'; pos: number; node: PMNode | null } {
  const sel = state.selection
  if (sel instanceof NodeSelection && (sel.node.type === n.figure || sel.node.type === n.equation || sel.node.type === n.table)) {
    return { kind: sel.node.type === n.figure ? 'figure' : sel.node.type === n.table ? 'table' : 'equation', pos: sel.from, node: sel.node }
  }
  const $f = sel.$from
  for (let d = $f.depth; d > 0; d--) {
    const node = $f.node(d)
    if (node.type === n.figure) return { kind: 'figure', pos: $f.before(d), node }
    if (node.type === n.table) return { kind: 'table', pos: $f.before(d), node }
  }
  return { kind: 'none', pos: sel.from, node: null }
}

/**
 * Insère une légende. Image : dans sa légende (au début). Tableau, équation :
 * un paragraphe « Légende » au-dessus ou au-dessous. Ailleurs : un paragraphe
 * « Légende » à la place du curseur.
 */
export function insertCaption(o: { label: string; word: string; text: string; sep: string; position: 'above' | 'below' }): Command {
  return (state, dispatch) => {
    const target = captionTarget(state)
    const content = captionContent(o.word, o.label, o.text, o.sep)
    if (!dispatch) return true
    let tr = state.tr
    if (target.kind === 'figure' && target.node) {
      // Légende existante : le numéro va devant ; sinon elle devient la légende.
      const old = target.node.content
      const glue = old.size && o.text === '' ? Fragment.from(schema.text(o.sep)) : Fragment.empty
      tr = tr.replaceWith(target.pos + 1, target.pos + 1 + old.size, content.append(glue).append(old))
      tr.setSelection(TextSelection.create(tr.doc, target.pos + 1 + content.size + glue.size + old.size))
    } else if (target.node) {
      const p = n.paragraph.create({ style: 'caption' }, content)
      const at = o.position === 'above' ? target.pos : target.pos + target.node.nodeSize
      tr = tr.insert(at, p)
      tr.setSelection(TextSelection.create(tr.doc, at + 1 + content.size))
    } else {
      const { $from } = state.selection
      const p = n.paragraph.create({ style: 'caption' }, content)
      if ($from.parent.isTextblock && $from.parent.content.size === 0 && $from.depth > 0) {
        const start = $from.before()
        tr = tr.replaceWith(start, start + $from.parent.nodeSize, p)
        tr.setSelection(TextSelection.create(tr.doc, start + 1 + content.size))
      } else {
        const at = $from.depth > 0 ? $from.after(1) : $from.pos
        tr = tr.insert(at, p)
        tr.setSelection(TextSelection.create(tr.doc, at + 1 + content.size))
      }
    }
    dispatch(tr.scrollIntoView())
    return true
  }
}

/** Liste générée à la place du curseur (comme la table des matières). */
export function refBlockNode(attrs: Record<string, unknown>): PMNode {
  return n.refblock.create(attrs)
}

/** Positions et noms des signets visibles (sans ceux qui commencent par _, sauf demande). */
export function bookmarkList(state: EditorState, hidden = false): { name: string; pos: number }[] {
  const out: { name: string; pos: number }[] = []
  state.doc.descendants((node, pos) => {
    if (node.type === n.bookmark && (hidden || !String(node.attrs.name).startsWith('_'))) out.push({ name: node.attrs.name, pos })
    return !node.isAtom
  })
  return out
}

/** Retire un signet. */
export function removeBookmark(name: string): Command {
  return (state, dispatch) => {
    let at = -1
    state.doc.descendants((node, pos) => {
      if (at < 0 && node.type === n.bookmark && node.attrs.name === name) at = pos
      return at < 0 && !node.isAtom
    })
    if (at < 0) return false
    if (dispatch) dispatch(state.tr.delete(at, at + 1))
    return true
  }
}

/** Paragraphes qu'un renvoi peut viser, par type : titres, légendes (par étiquette). */
export function referenceables(state: EditorState): { headings: { text: string; pos: number; level: number }[]; captions: Caption[] } {
  const headings: { text: string; pos: number; level: number }[] = []
  state.doc.descendants((node, pos) => {
    if (node.type === n.heading) {
      headings.push({ text: node.textContent.trim(), pos, level: node.attrs.level })
      return false
    }
    return isContainer(node)
  })
  return { headings, captions: refsOf(state)?.captions ?? [] }
}
