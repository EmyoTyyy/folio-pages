// Références (onglet Références, Insertion → Liens) : légendes et table des
// illustrations, signets et renvois, index et table des références, sources,
// citations et bibliographie. Les fenêtres reprennent celles des traitements
// de texte habituels ; tout s'annule avec Ctrl+Z.

import { NodeSelection, TextSelection, type Command } from 'prosemirror-state'
import type { FolioApp } from '../app'
import { insertBlock } from '../editor/commands'
import {
  bookmarkList,
  captionTarget,
  ensureBookmark,
  insertCaption,
  insertInline,
  referenceables,
  refBlockNode,
  refsOf,
  removeBookmark,
  insertCiteNote,
  setCitationStyleCmd,
} from '../editor/refs'
import { schema } from '../editor/schema'
import { IMPORT_LIMITS, parseSources, toBibtex, toCslJson, toRis, type SourceFormat } from '../refs/formats'
import { downloadFile, fileNameFor } from '../file/save'
import { pickFile } from './panels'
import {
  AUTHORITY_CATEGORIES,
  BOOKMARK_NAME,
  CAPTION_LABELS,
  CITATION_STYLES,
  SOURCE_ID,
  SOURCE_TYPES,
  type AuthorityCategory,
  type CitationStyle,
  type Source,
  type SourceType,
  type XrefShow,
} from '../format/types'
import type { Key } from '../i18n/dict'
import { lang, t } from '../i18n/i18n'
import { OfflineError } from '../net'
import { bibliographyEntry, citeContext, citationText, isNumbered, piecesText } from '../refs/cite'
import { lookupIdentifier, parseIdentifier, suggestId } from '../refs/lookup'
import { openDialog, toast } from './dialog'
import { h } from './dom'
import { popItem } from './popover'

const n = schema.nodes

// --- petits outils de formulaire ------------------------------------------------------

let seq = 0
function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || `fp-ref-${++seq}`
  control.id = id
  return h('div', { class: 'fp-form__row' }, h('label', { class: 'fp-label', for: id }, label), control, hint ? h('p', { class: 'fp-form__hint' }, hint) : null)
}

function select(options: [string, string][], value: string, attrs: Record<string, string> = {}): HTMLSelectElement {
  const el = h('select', { class: 'fp-input', ...attrs }) as HTMLSelectElement
  for (const [v, l] of options) el.append(h('option', { value: v }, l))
  el.value = value
  return el
}

function input(value: string, attrs: Record<string, string> = {}): HTMLInputElement {
  const el = h('input', { type: 'text', class: 'fp-input', ...attrs }) as HTMLInputElement
  el.value = value
  return el
}

function checkbox(label: string, checked: boolean, attrs: Record<string, string> = {}): { el: HTMLElement; box: HTMLInputElement } {
  const box = h('input', { type: 'checkbox', ...attrs }) as HTMLInputElement
  box.checked = checked
  return { el: h('label', { class: 'fp-check' }, box, h('span', {}, label)), box }
}

const selectedText = (app: FolioApp): string => {
  const { from, to } = app.state.selection
  return app.state.doc.textBetween(from, to, ' ', ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
}

// --- légendes -------------------------------------------------------------------------

/** Mot affiché devant le numéro : « Figure », « Tableau »… ou l'étiquette personnelle elle-même. */
export const labelWord = (label: string): string => ((CAPTION_LABELS as readonly string[]).includes(label) ? t(`cap.${label}` as Key) : label)

/** Étiquettes connues : intégrées, puis celles du document. */
function captionLabels(app: FolioApp): string[] {
  const out: string[] = [...CAPTION_LABELS]
  app.state.doc.descendants((node) => {
    if (node.type === n.seq && !out.includes(node.attrs.label)) out.push(node.attrs.label)
    return !node.isAtom
  })
  return out
}

/** Références → Insérer une légende. */
export function captionDialog(app: FolioApp): void {
  const target = captionTarget(app.state)
  const labels = captionLabels(app)
  const initial = target.kind === 'table' ? 'table' : target.kind === 'equation' ? 'equation' : 'figure'
  const label = select([...labels.map((l): [string, string] => [l, labelWord(l)]), ['__new', t('cap.newLabel')]], initial, { 'data-field': 'caption-label' })
  const text = input('', { 'data-field': 'caption-text', maxlength: '500' })
  const position = select(
    [
      ['below', t('cap.below')],
      ['above', t('cap.above')],
    ],
    target.kind === 'table' ? 'above' : 'below',
    { 'data-field': 'caption-position' },
  )
  if (target.kind === 'figure' || target.kind === 'none') position.disabled = true
  const exclude = checkbox(t('cap.excludeLabel'), false, { 'data-field': 'caption-exclude' })
  const preview = h('p', { class: 'fp-ref__preview', 'data-field': 'caption-preview' })
  let custom: string | null = null
  const nextNumber = (l: string) => (refsOf(app.state)?.captions.filter((c) => c.label === l && c.pos < target.pos).length ?? 0) + 1
  const current = () => (label.value === '__new' ? (custom ?? 'figure') : label.value)
  const update = () => {
    const l = current()
    const word = exclude.box.checked ? '' : labelWord(l)
    preview.textContent = `${word ? `${word} ` : ''}${nextNumber(l)}${text.value ? `${t('cap.sep')}${text.value}` : ''}`
  }
  label.addEventListener('change', () => {
    if (label.value !== '__new') return update()
    const name = window.prompt(t('cap.newLabelPrompt'), '')?.trim().slice(0, 40)
    if (name) {
      custom = name
      const opt = h('option', { value: name }, name)
      label.insertBefore(opt, label.lastElementChild)
      label.value = name
    } else label.value = initial
    update()
  })
  text.addEventListener('input', update)
  exclude.box.addEventListener('change', update)
  update()
  openDialog({
    name: 'caption',
    title: t('cap.title'),
    focus: text,
    body: [
      row(t('cap.text'), text),
      h('div', { class: 'fp-form--grid' }, row(t('cap.label'), label), row(t('cap.position'), position)),
      exclude.el,
      row(t('cap.preview'), preview),
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.insert'),
        value: 'ok',
        primary: true,
        run: () => {
          const l = current()
          app.run(insertCaption({ label: l, word: exclude.box.checked ? '' : labelWord(l), text: text.value.trim(), sep: t('cap.sep'), position: position.value as 'above' | 'below' }))
        },
      },
    ],
  })
}

/** Références → Insérer une table des illustrations. */
export function figuresDialog(app: FolioApp): void {
  const labels = captionLabels(app)
  const label = select(labels.map((l): [string, string] => [l, labelWord(l)]), 'figure', { 'data-field': 'figures-label' })
  const title = input(t('fig.defaultTitle'), { 'data-field': 'figures-title', maxlength: '200' })
  label.addEventListener('change', () => {
    if (title.value === t('fig.defaultTitle') || title.value === t('fig.tablesTitle')) title.value = label.value === 'table' ? t('fig.tablesTitle') : t('fig.defaultTitle')
  })
  openDialog({
    name: 'figures',
    title: t('fig.title'),
    body: [row(t('fig.which'), label), row(t('fig.heading'), title)],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      { label: t('action.insert'), value: 'ok', primary: true, run: () => void app.run(insertBlock(refBlockNode({ kind: 'figures', label: label.value, title: title.value.trim() }), 'node')) },
    ],
  })
}

// --- signets ----------------------------------------------------------------------------

/** Insertion → Signet : ajouter (ou déplacer), supprimer, atteindre. */
export function bookmarkDialog(app: FolioApp): void {
  const name = input('', { 'data-field': 'bookmark-name', maxlength: '40', spellcheck: 'false' })
  const sortBy = select(
    [
      ['name', t('bm.byName')],
      ['location', t('bm.byLocation')],
    ],
    'name',
    { 'data-field': 'bookmark-sort' },
  )
  const hidden = checkbox(t('bm.hidden'), false, { 'data-field': 'bookmark-hidden' })
  const list = h('select', { class: 'fp-input', size: '8', 'data-field': 'bookmark-list' }) as HTMLSelectElement
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  const fill = () => {
    const items = bookmarkList(app.state, hidden.box.checked)
    if (sortBy.value === 'name') items.sort((a, b) => a.name.localeCompare(b.name))
    list.replaceChildren(...items.map((b) => h('option', { value: b.name }, b.name)))
    if (!items.length) list.append(h('option', { disabled: '' }, t('bm.none')))
  }
  list.addEventListener('change', () => (name.value = list.value))
  sortBy.addEventListener('change', fill)
  hidden.box.addEventListener('change', fill)
  fill()
  // Le nom proposé : le texte sélectionné, s'il fait un nom valable.
  const guess = selectedText(app).replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 40)
  if (BOOKMARK_NAME.test(guess)) name.value = guess
  const add = () => {
    const v = name.value.trim()
    if (!BOOKMARK_NAME.test(v)) {
      error.textContent = t('bm.invalid')
      return false
    }
    const exists = bookmarkList(app.state, true).some((b) => b.name === v)
    // Un signet existant est déplacé ici, comme d'habitude.
    app.run((state, dispatch) => {
      let tr = state.tr
      if (exists) {
        state.doc.descendants((node, pos) => {
          if (node.type === n.bookmark && node.attrs.name === v) tr = tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + 1))
          return !node.isAtom
        })
      }
      const at = tr.mapping.map(state.selection.from)
      if (!tr.doc.resolve(at).parent.inlineContent) return false
      tr = tr.insert(at, n.bookmark.create({ name: v }))
      dispatch?.(tr)
      return true
    })
    toast(t(exists ? 'bm.moved' : 'bm.added', { name: v }), { kind: 'success' })
    return true
  }
  openDialog({
    name: 'bookmark',
    title: t('bm.title'),
    focus: name,
    body: [row(t('bm.name'), name), list, h('div', { class: 'fp-form--grid' }, row(t('bm.sortBy'), sortBy), hidden.el), error],
    actions: [
      {
        label: t('bm.delete'),
        value: 'delete',
        run: () => {
          const v = list.value || name.value
          if (v) app.run(removeBookmark(v))
          fill()
          return false
        },
      },
      {
        label: t('bm.goto'),
        value: 'goto',
        run: () => {
          const v = list.value || name.value
          const b = bookmarkList(app.state, true).find((x) => x.name === v)
          if (b) app.jumpTo(b.pos)
          return !!b
        },
      },
      { label: t('action.close'), value: 'close' },
      { label: t('bm.add'), value: 'add', primary: true, run: add },
    ],
  })
}

// --- renvois ----------------------------------------------------------------------------

/** Insertion → Renvoi / Références → Renvoi. Avec plusieurs documents : vers celui qu'on choisit. */
export function crossRefDialog(app: FolioApp): void {
  const docs = app.documents
  const here = app.activeKey
  const docSel = select(
    docs.map((d): [string, string] => [d.key, d.key === here ? `${d.title} (${t('docs.this').toLowerCase()})` : d.title]),
    here,
    { 'data-field': 'xref-doc' },
  )
  const stateNow = () => app.stateOf(docSel.value) ?? app.state
  const type = select([], 'heading', { 'data-field': 'xref-type' })
  const show = select([], 'text', { 'data-field': 'xref-show' })
  const list = h('select', { class: 'fp-input', size: '10', 'data-field': 'xref-list' }) as HTMLSelectElement
  const other = () => docSel.value !== here
  const shows = (): XrefShow[] => {
    const all: XrefShow[] = type.value.startsWith('cap:') ? ['label', 'number', 'text', 'page', 'above'] : ['text', 'page', 'above']
    // Vers un autre document, « ci-dessus / ci-dessous » n'a pas de sens.
    return other() ? all.filter((x) => x !== 'above') : all
  }
  const fillTypes = () => {
    const { headings, captions } = referenceables(stateNow())
    const labels = [...new Set(captions.map((c) => c.label))]
    const keep = type.value
    type.replaceChildren(...[['heading', t('xr.heading')], ['bookmark', t('xr.bookmark')], ...labels.map((l): [string, string] => [`cap:${l}`, labelWord(l)])].map(([v, l]) => h('option', { value: v }, l)))
    const values = ['heading', 'bookmark', ...labels.map((l) => `cap:${l}`)]
    type.value = values.includes(keep) ? keep : labels.includes('figure') ? 'cap:figure' : headings.length ? 'heading' : 'bookmark'
  }
  const fill = () => {
    const { headings, captions } = referenceables(stateNow())
    const keep = show.value
    show.replaceChildren(...shows().map((s) => h('option', { value: s }, t(`xr.show.${s}` as Key))))
    show.value = shows().includes(keep as XrefShow) ? keep : shows()[0]
    list.replaceChildren()
    let items: { label: string; value: string }[] = []
    if (type.value === 'heading') items = headings.map((x) => ({ label: `${'  '.repeat(x.level - 1)}${x.text || '…'}`, value: `pos:${x.pos}` }))
    else if (type.value === 'bookmark') items = bookmarkList(stateNow()).map((b) => ({ label: b.name, value: `bm:${b.name}` }))
    else items = captions.filter((c) => `cap:${c.label}` === type.value).map((c) => ({ label: c.text, value: `pos:${c.pos}` }))
    for (const it of items) list.append(h('option', { value: it.value }, it.label))
    if (!items.length) list.append(h('option', { disabled: '' }, t('xr.none')))
    else list.selectedIndex = 0
  }
  type.addEventListener('change', fill)
  docSel.addEventListener('change', () => {
    fillTypes()
    fill()
  })
  fillTypes()
  fill()
  const top = docs.length > 1 ? [row(t('docs.inFile'), docSel)] : []
  openDialog({
    name: 'xref',
    title: t('xr.title'),
    wide: true,
    focus: list,
    body: [...top, h('div', { class: 'fp-form--grid' }, row(t('xr.type'), type), row(t('xr.to'), show)), row(t('xr.which'), list), h('p', { class: 'fp-form__hint' }, t('xr.hint'))],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.insert'),
        value: 'ok',
        primary: true,
        run: () => {
          const v = list.value
          if (!v) return false
          if (!other()) return app.run(insertXref(v, show.value as XrefShow))
          // Dans un autre document : son signet (ajouté au titre ou à la légende s'il n'en a pas).
          const key = docSel.value
          let name = v.startsWith('bm:') ? v.slice(3) : ''
          if (!name)
            app.updateOther(key, (st) => {
              const got = ensureBookmark(st, Number(v.slice(4)))
              name = got.name
              return got.tr ? got.tr.setMeta('addToHistory', false) : null
            })
          if (!name) return false
          const last = app.crossValue(key, name, show.value as XrefShow)
          return app.run(insertXref(`bm:${name}`, show.value as XrefShow, { doc: key, last }))
        },
      },
    ],
  })
}

/** Insère un renvoi vers un signet (« bm:nom ») ou un paragraphe (« pos:… », signet caché ajouté) ; `other` : dans un autre document. */
export function insertXref(target: string, show: XrefShow, other?: { doc: string; last: string }): Command {
  return (state, dispatch) => {
    if (!state.selection.$from.parent.inlineContent) return false
    let name = ''
    let tr = state.tr
    if (target.startsWith('bm:')) name = target.slice(3)
    else {
      const got = ensureBookmark(state, Number(target.slice(4)))
      name = got.name
      if (got.tr) tr = got.tr
    }
    if (!name) return false
    if (dispatch) {
      const from = tr.mapping.map(state.selection.from)
      const to = tr.mapping.map(state.selection.to)
      tr.replaceWith(from, to, n.xref.create({ target: name, show, doc: other?.doc ?? '', last: other?.last ?? '' }).mark(state.selection.$from.marks()))
      tr.setSelection(TextSelection.create(tr.doc, from + 1))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

// --- index ------------------------------------------------------------------------------

/** Références → Marquer l'entrée (Alt+Maj+X). */
export function markEntryDialog(app: FolioApp): void {
  const sel = selectedText(app)
  const main = input(sel, { 'data-field': 'xe-term', maxlength: '300' })
  const sub = input('', { 'data-field': 'xe-sub', maxlength: '300' })
  const mode = select(
    [
      ['page', t('xe.page')],
      ['see', t('xe.see')],
    ],
    'page',
    { 'data-field': 'xe-mode' },
  )
  const see = input('', { 'data-field': 'xe-see', maxlength: '300' })
  const bold = checkbox(t('xe.bold'), false, { 'data-field': 'xe-bold' })
  const italic = checkbox(t('xe.italic'), false, { 'data-field': 'xe-italic' })
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  const node = () =>
    n.xe.create({ term: main.value.trim(), sub: sub.value.trim(), see: mode.value === 'see' ? see.value.trim() : '', bold: bold.box.checked, italic: italic.box.checked })
  const valid = () => {
    if (main.value.trim()) return true
    error.textContent = t('xe.empty')
    return false
  }
  openDialog({
    name: 'mark-entry',
    title: t('xe.title'),
    focus: main,
    body: [
      row(t('xe.main'), main),
      row(t('xe.sub'), sub),
      h('div', { class: 'fp-form--grid' }, row(t('xe.options'), mode), row(t('xe.see'), see)),
      h('div', { class: 'fp-checks' }, h('span', { class: 'fp-label' }, t('xe.format')), bold.el, italic.el),
      h('p', { class: 'fp-form__hint' }, t('xe.hint')),
      error,
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('xe.markAll'),
        value: 'all',
        run: () => {
          if (!valid()) return false
          const count = markAll(app, sel, () => node())
          toast(t('xe.marked', { n: count }), { kind: 'success' })
        },
      },
      {
        label: t('xe.mark'),
        value: 'ok',
        primary: true,
        run: () => {
          if (!valid()) return false
          app.run(insertAfterSelection(node()))
          toast(t('xe.marked', { n: 1 }), { kind: 'success' })
        },
      },
    ],
  })
}

/** L'entrée va juste après le texte sélectionné (le texte reste en place). */
function insertAfterSelection(node: import('prosemirror-model').Node): Command {
  return (state, dispatch) => {
    const at = state.selection.to
    if (!state.doc.resolve(at).parent.inlineContent) return false
    dispatch?.(state.tr.insert(at, node))
    return true
  }
}

/** Marque chaque occurrence (mot entier, même casse) du texte sélectionné ; renvoie le nombre d'entrées. */
function markAll(app: FolioApp, text: string, make: () => import('prosemirror-model').Node): number {
  if (!text) {
    app.run(insertAfterSelection(make()))
    return 1
  }
  const ends: number[] = []
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'gu')
  app.state.doc.descendants((node, pos) => {
    if (!node.isText) return true
    for (const m of node.text!.matchAll(re)) ends.push(pos + (m.index ?? 0) + m[0].length)
    return false
  })
  app.run((state, dispatch) => {
    const tr = state.tr
    for (const e of ends.reverse()) tr.insert(e, make())
    dispatch?.(tr)
    return true
  })
  return ends.length
}

/** Références → Insérer l'index. */
export function indexDialog(app: FolioApp): void {
  const cols = select(['1', '2', '3'].map((c): [string, string] => [c, c]), '2', { 'data-field': 'index-columns' })
  const title = input(t('ix.defaultTitle'), { 'data-field': 'index-title', maxlength: '200' })
  openDialog({
    name: 'index',
    title: t('ix.title'),
    body: [h('div', { class: 'fp-form--grid' }, row(t('ix.heading'), title), row(t('ix.columns'), cols))],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      { label: t('action.insert'), value: 'ok', primary: true, run: () => void app.run(insertBlock(refBlockNode({ kind: 'index', columns: Number(cols.value), title: title.value.trim() }), 'node')) },
    ],
  })
}

// --- table des références ------------------------------------------------------------------

const categoryOptions = (): [string, string][] => AUTHORITY_CATEGORIES.map((c) => [c, t(`ref.cat.${c}` as Key)])

/** Références → Marquer la citation (Alt+Maj+I). */
export function markCitationDialog(app: FolioApp): void {
  const sel = selectedText(app)
  const long = h('textarea', { class: 'fp-input', rows: '3', 'data-field': 'ta-long', maxlength: '300' }) as HTMLTextAreaElement
  long.value = sel
  const short = input(sel, { 'data-field': 'ta-short', maxlength: '300' })
  const category = select(categoryOptions(), 'cases', { 'data-field': 'ta-category' })
  const node = () => n.xe.create({ term: long.value.replace(/\s+/g, ' ').trim(), short: short.value.trim(), authority: category.value as AuthorityCategory })
  openDialog({
    name: 'mark-citation',
    title: t('ta.title'),
    focus: long,
    body: [row(t('ta.long'), long), row(t('ta.short'), short), row(t('ta.category'), category)],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('xe.markAll'),
        value: 'all',
        run: () => {
          if (!long.value.trim()) return false
          toast(t('xe.marked', { n: markAll(app, sel, node) }), { kind: 'success' })
        },
      },
      {
        label: t('xe.mark'),
        value: 'ok',
        primary: true,
        run: () => {
          if (!long.value.trim()) return false
          app.run(insertAfterSelection(node()))
        },
      },
    ],
  })
}

/** Références → Insérer une table des références. */
export function authoritiesDialog(app: FolioApp): void {
  const category = select([['all', t('ref.cat.all')], ...categoryOptions()], 'all', { 'data-field': 'ta-insert-category' })
  const title = input(t('ta.defaultTitle'), { 'data-field': 'ta-title', maxlength: '200' })
  openDialog({
    name: 'authorities',
    title: t('ta.insertTitle'),
    body: [h('div', { class: 'fp-form--grid' }, row(t('ta.category'), category), row(t('fig.heading'), title))],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      { label: t('action.insert'), value: 'ok', primary: true, run: () => void app.run(insertBlock(refBlockNode({ kind: 'authorities', category: category.value, title: title.value.trim() }), 'node')) },
    ],
  })
}

// --- sources et citations ----------------------------------------------------------------

export const sourcesOf = (app: FolioApp): Source[] => (app.state.doc.attrs.sources as Source[] | undefined) ?? []
export const citationStyleOf = (app: FolioApp): CitationStyle => (app.state.doc.attrs.citationStyle as CitationStyle) ?? 'apa'

const setDocAttr =
  (key: string, value: unknown): Command =>
  (state, dispatch) => {
    dispatch?.(state.tr.setDocAttribute(key, value))
    return true
  }

export function setCitationStyle(app: FolioApp, style: CitationStyle): void {
  const before = citationStyleOf(app)
  app.run(setCitationStyleCmd(style), false)
  if (style === 'chicago-notes' && before !== style) toast(t('cite.notesOn'), { kind: 'info', timeout: 7000 })
}

/** Sources citées dans le document. */
function citedIds(app: FolioApp): Set<string> {
  const out = new Set<string>()
  app.state.doc.descendants((node) => {
    if (node.type === n.cite) for (const id of node.attrs.ids as string[]) out.add(id)
    return !node.isAtom
  })
  return out
}

/** Entrée de bibliographie d'une source, dans le style du document (aperçu). */
function previewOf(app: FolioApp, s: Source): string {
  const ctx = citeContext(sourcesOf(app), [], citationStyleOf(app), (app.state.doc.attrs.lang as string) || lang())
  return piecesText(bibliographyEntry(ctx, s))
}

const shortOf = (app: FolioApp, s: Source): string => {
  const ctx = citeContext(sourcesOf(app), [s.id], isNumbered(citationStyleOf(app)) || citationStyleOf(app) === 'chicago-notes' ? 'apa' : citationStyleOf(app), (app.state.doc.attrs.lang as string) || lang())
  return `${citationText(ctx, [s.id])} ${s.title}`.slice(0, 120)
}

/** Insère une citation (une ou plusieurs sources) au curseur. */
export function insertCitation(app: FolioApp, ids: string[], locator = ''): boolean {
  // Notes Chicago : la citation va dans une note de bas de page (sauf dans une note, un en-tête…).
  if (citationStyleOf(app) === 'chicago-notes' && app.run(insertCiteNote(ids, locator))) return true
  return app.run(insertInline(n.cite.create({ ids, locator })))
}

const FORMAT_NAMES: Record<SourceFormat, string> = { bibtex: 'BibTeX', ris: 'RIS', csl: 'CSL-JSON' }

/** Le menu « Insérer une citation » : les sources, puis ajouter / retrouver une source. */
export function citationMenu(app: FolioApp): HTMLElement {
  const list = h('div', { class: 'fp-pop__list', role: 'menu' })
  const sources = sourcesOf(app)
  const sel = app.state.selection
  if (sel instanceof NodeSelection && sel.node.type === n.cite) {
    list.append(popItem(t('cite.edit'), () => editCitationDialog(app), { 'data-cite-menu': 'edit' }), h('hr', { class: 'fp-pop__sep' }))
  }
  if (!sources.length) list.append(h('p', { class: 'fp-pop__empty' }, t('cite.none')))
  for (const s of sources.slice(0, 40)) list.append(popItem(shortOf(app, s), () => insertCitation(app, [s.id]), { 'data-cite-source': s.id, title: previewOf(app, s) }))
  list.append(
    h('hr', { class: 'fp-pop__sep' }),
    popItem(t('src.add'), () => sourceEditor(app, null, (src) => insertCitation(app, [src.id])), { 'data-cite-menu': 'add' }),
    popItem(t('src.lookup'), () => sourceEditor(app, null, (src) => insertCitation(app, [src.id]), true), { 'data-cite-menu': 'lookup' }),
  )
  return list
}

/** Modifier la citation sélectionnée : sources citées, page. */
export function editCitationDialog(app: FolioApp): void {
  const sel = app.state.selection
  if (!(sel instanceof NodeSelection) || sel.node.type !== n.cite) return
  const pos = sel.from
  const cur = sel.node.attrs
  const boxes = sourcesOf(app).map((s) => checkbox(shortOf(app, s), (cur.ids as string[]).includes(s.id), { 'data-cite-pick': s.id }))
  const locator = input(cur.locator as string, { 'data-field': 'cite-locator', maxlength: '60' })
  openDialog({
    name: 'cite-edit',
    title: t('cite.edit'),
    body: [h('div', { class: 'fp-ref__checks' }, h('span', { class: 'fp-label' }, t('cite.sources')), ...boxes.map((b) => b.el)), row(t('cite.locator'), locator)],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const ids = sourcesOf(app)
            .filter((_s, i) => boxes[i].box.checked)
            .map((s) => s.id)
          if (!ids.length) return false
          app.run((state, dispatch) => {
            dispatch?.(state.tr.setNodeMarkup(pos, undefined, { ids, locator: locator.value.trim() }))
            return true
          })
        },
      },
    ],
  })
}

/** Références → Gérer les sources. */
export function sourceManager(app: FolioApp): void {
  const list = h('ul', { class: 'fp-list', 'data-field': 'sources' })
  const render = () => {
    const cited = citedIds(app)
    list.replaceChildren()
    const sources = sourcesOf(app)
    if (!sources.length) list.append(h('li', { class: 'fp-list__empty' }, t('src.none')))
    for (const s of sources) {
      const edit = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-source-edit': s.id }, t('src.edit'))
      edit.addEventListener('click', () => sourceEditor(app, s, () => render()))
      const del = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-source-delete': s.id }, t('src.delete'))
      del.addEventListener('click', () => {
        if (citedIds(app).has(s.id)) return void toast(t('src.inUse'), { kind: 'info' })
        app.run(setDocAttr('sources', sourcesOf(app).filter((x) => x.id !== s.id)), false)
        render()
      })
      list.append(
        h(
          'li',
          { class: 'fp-list__row', 'data-source': s.id },
          h('div', { class: 'fp-list__main fp-ref__source' }, h('strong', {}, s.id), cited.has(s.id) ? h('span', { class: 'fp-chip fp-chip--muted' }, t('src.cited')) : null, h('span', { class: 'fp-muted' }, ` ${previewOf(app, s)}`)),
          edit,
          del,
        ),
      )
    }
  }
  render()
  const add = h('button', { type: 'button', class: 'fp-btn', 'data-source-new': '' }, t('src.new'))
  add.addEventListener('click', () => sourceEditor(app, null, () => render()))
  const style = select(CITATION_STYLES.map((c): [string, string] => [c, t(`cite.style.${c}` as Key)]), citationStyleOf(app), { 'data-field': 'citation-style' })
  style.addEventListener('change', () => {
    setCitationStyle(app, style.value as CitationStyle)
    render()
  })
  // Importer et exporter : BibTeX, RIS, CSL-JSON (Zotero, Mendeley, Google Scholar…).
  const importBtn = h('button', { type: 'button', class: 'fp-btn', 'data-source-import': '' }, t('src.import'))
  importBtn.addEventListener('click', async () => {
    const file = await pickFile('.bib,.bibtex,.ris,.json,.txt,application/json')
    if (!file) return
    if (file.size > IMPORT_LIMITS.file) return void toast(t('src.importTooLarge'), { kind: 'error' })
    const current = sourcesOf(app)
    const { format, sources } = parseSources(await file.text(), current.map((x) => x.id))
    if (!format || !sources.length) return void toast(t('src.importNone'), { kind: 'error' })
    // Même DOI ou même titre et même année : déjà là, pas en double.
    const key = (x: Source) => (x.doi ? `doi:${x.doi.toLowerCase()}` : `${x.title.toLowerCase()}|${x.year ?? ''}`)
    const known = new Set(current.map(key))
    const fresh = sources.filter((x) => !known.has(key(x))).slice(0, Math.max(0, 2000 - current.length))
    app.run(setDocAttr('sources', [...current, ...fresh]), false)
    toast(t('src.imported', { n: fresh.length, skipped: sources.length - fresh.length, format: FORMAT_NAMES[format] }), { kind: 'success', timeout: 7000 })
    render()
  })
  const exportMenu = h('select', { class: 'fp-input fp-src__export', 'data-field': 'source-export', 'aria-label': t('src.export') }, h('option', { value: '' }, t('src.export')), h('option', { value: 'bibtex' }, 'BibTeX (.bib)'), h('option', { value: 'ris' }, 'RIS (.ris)'), h('option', { value: 'csl' }, 'CSL-JSON (.json)')) as HTMLSelectElement
  exportMenu.addEventListener('change', () => {
    const f = exportMenu.value as SourceFormat | ''
    exportMenu.value = ''
    const sources = sourcesOf(app)
    if (!f || !sources.length) return
    const name = fileNameFor(app.title() || t('src.title'), 'sources').replace(/\.html$/, '')
    if (f === 'bibtex') downloadFile(toBibtex(sources), `${name}.bib`, 'application/x-bibtex')
    else if (f === 'ris') downloadFile(toRis(sources), `${name}.ris`, 'application/x-research-info-systems')
    else downloadFile(toCslJson(sources), `${name}.json`, 'application/json')
  })
  openDialog({
    name: 'sources',
    title: t('src.title'),
    wide: true,
    body: [h('div', { class: 'fp-ref__bar' }, row(t('cite.style'), style), add, importBtn, exportMenu), list],
    actions: [{ label: t('action.close'), value: 'close', primary: true }],
  })
}

const FIELDS = ['container', 'editors', 'publisher', 'place', 'year', 'volume', 'issue', 'pages', 'edition', 'url', 'doi', 'isbn', 'accessed'] as const
/** Champs utiles selon le type de source (les autres restent accessibles s'ils sont remplis). */
const FIELDS_BY_TYPE: Record<SourceType, readonly (typeof FIELDS)[number][]> = {
  book: ['publisher', 'place', 'year', 'edition', 'isbn', 'doi', 'url'],
  article: ['container', 'year', 'volume', 'issue', 'pages', 'doi', 'url'],
  chapter: ['container', 'editors', 'publisher', 'place', 'year', 'pages', 'isbn', 'doi'],
  website: ['container', 'publisher', 'year', 'url', 'accessed'],
  report: ['publisher', 'place', 'year', 'url', 'doi'],
  thesis: ['publisher', 'place', 'year', 'url'],
  conference: ['container', 'publisher', 'place', 'year', 'pages', 'doi', 'url'],
  film: ['publisher', 'year', 'url'],
  interview: ['container', 'year', 'url'],
  other: ['container', 'publisher', 'place', 'year', 'url', 'doi'],
}

/** Créer ou modifier une source ; `lookup` : ouvrir sur « Retrouver par DOI ou ISBN ». */
export function sourceEditor(app: FolioApp, editing: Source | null, done?: (s: Source) => void, lookup = false): void {
  const s: Source = editing ? JSON.parse(JSON.stringify(editing)) : { id: '', type: 'book', authors: [], title: '' }
  const type = select(SOURCE_TYPES.map((x): [string, string] => [x, t(`src.type.${x}` as Key)]), s.type, { 'data-field': 'source-type' })
  const authors = h('textarea', { class: 'fp-input', rows: '3', 'data-field': 'source-authors' }) as HTMLTextAreaElement
  authors.value = s.authors.join('\n')
  const title = input(s.title, { 'data-field': 'source-title', maxlength: '1000' })
  const inputs = Object.fromEntries(
    FIELDS.map((k) => {
      const v = k === 'editors' ? (s.editors ?? []).join('; ') : ((s[k] as string | undefined) ?? '')
      return [k, input(v, { 'data-field': `source-${k}`, maxlength: k === 'url' ? '2048' : '500', ...(k === 'accessed' ? { type: 'date' } : {}) })]
    }),
  ) as Record<(typeof FIELDS)[number], HTMLInputElement>
  const rows = Object.fromEntries(FIELDS.map((k) => [k, row(t(`src.${k}` as Key), inputs[k])])) as Record<(typeof FIELDS)[number], HTMLElement>
  const id = input(s.id, { 'data-field': 'source-id', maxlength: '64', spellcheck: 'false' })
  const preview = h('p', { class: 'fp-ref__preview', 'data-field': 'source-preview' })
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  const taken = new Set(sourcesOf(app).map((x) => x.id).filter((x) => x !== editing?.id))
  let idTouched = !!editing
  id.addEventListener('input', () => (idTouched = true))

  const collect = (): Source => {
    const out: Source = { id: id.value.trim(), type: type.value as SourceType, authors: authors.value.split('\n').map((a) => a.trim()).filter(Boolean).slice(0, 30), title: title.value.trim() }
    for (const k of FIELDS) {
      const v = inputs[k].value.trim()
      if (!v) continue
      if (k === 'editors') out.editors = v.split(/\s*;\s*/).filter(Boolean).slice(0, 20)
      else out[k] = v
    }
    if (out.doi) out.doi = out.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    return out
  }
  const refresh = () => {
    const cur = collect()
    if (!idTouched) id.value = suggestId(cur, taken)
    const show = new Set(FIELDS_BY_TYPE[cur.type])
    for (const k of FIELDS) rows[k].hidden = !show.has(k) && !inputs[k].value.trim()
    preview.textContent = previewOf(app, { ...cur, id: id.value || 'x' })
  }
  for (const el of [type, authors, title, ...Object.values(inputs)]) el.addEventListener('input', refresh)
  type.addEventListener('change', refresh)

  // Retrouver par DOI ou ISBN.
  const ident = input('', { 'data-field': 'source-lookup', placeholder: t('src.lookupPlaceholder'), spellcheck: 'false' })
  const go = h('button', { type: 'button', class: 'fp-btn', 'data-source-lookup': '' }, t('src.lookupGo'))
  const status = h('p', { class: 'fp-form__hint', 'aria-live': 'polite' }, t('src.lookupHint'))
  const runLookup = async () => {
    const parsed = parseIdentifier(ident.value)
    if (!parsed) {
      status.textContent = t('src.lookupBad')
      return
    }
    go.disabled = true
    status.textContent = '…'
    try {
      const found = await lookupIdentifier(parsed)
      if (!found) status.textContent = t('src.lookupNone')
      else {
        type.value = found.type
        authors.value = found.authors.join('\n')
        title.value = found.title
        for (const k of FIELDS) {
          const v = k === 'editors' ? (found.editors ?? []).join('; ') : ((found[k] as string | undefined) ?? '')
          if (v) inputs[k].value = v
        }
        status.textContent = t('src.lookupDone')
        refresh()
      }
    } catch (e) {
      status.textContent = e instanceof OfflineError ? t('offline.blocked') : t('src.lookupFail')
    } finally {
      go.disabled = false
    }
  }
  go.addEventListener('click', () => void runLookup())
  ident.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void runLookup()
    }
  })
  refresh()
  openDialog({
    name: 'source',
    title: editing ? t('src.editTitle2') : t('src.editTitle'),
    wide: true,
    focus: lookup ? ident : title,
    body: [
      h('div', { class: 'fp-ref__lookup' }, row(t('src.lookup'), ident), go),
      status,
      h('div', { class: 'fp-form--grid' }, row(t('src.type'), type), row(t('src.id'), id, t('src.idHint'))),
      row(t('src.authors'), authors, t('src.authorsHint')),
      row(t('src.titleField'), title),
      h('div', { class: 'fp-form--grid' }, ...FIELDS.map((k) => rows[k])),
      row(t('src.preview'), preview),
      error,
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const src = collect()
          if (!src.title && !src.authors.length) {
            error.textContent = t('src.needTitle')
            return false
          }
          if (!SOURCE_ID.test(src.id)) {
            error.textContent = t('src.idBad')
            return false
          }
          if (taken.has(src.id)) {
            error.textContent = t('src.idTaken')
            return false
          }
          const list = sourcesOf(app)
          const next = editing ? list.map((x) => (x.id === editing.id ? src : x)) : [...list, src]
          app.run((state, dispatch) => {
            let tr = state.tr.setDocAttribute('sources', next)
            // Nom de balise changé : les citations suivent.
            if (editing && editing.id !== src.id) {
              state.doc.descendants((node, pos) => {
                if (node.type === n.cite && (node.attrs.ids as string[]).includes(editing.id)) tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, ids: (node.attrs.ids as string[]).map((x) => (x === editing.id ? src.id : x)) })
                return !node.isAtom
              })
            }
            dispatch?.(tr)
            return true
          }, false)
          done?.(src)
        },
      },
    ],
  })
}

/** Menu « Style » des citations. */
export function citationStyleMenu(app: FolioApp): HTMLElement {
  return h(
    'div',
    { class: 'fp-pop__list', role: 'menu' },
    ...CITATION_STYLES.map((c) => popItem(t(`cite.style.${c}` as Key), () => setCitationStyle(app, c), { 'data-citation-style': c, role: 'menuitemradio', 'aria-checked': String(citationStyleOf(app) === c) })),
  )
}

/** Menu « Bibliographie » : modèles intégrés (titre), insérer sans titre, toutes les sources. */
export function bibliographyMenu(app: FolioApp): HTMLElement {
  const ins = (title: string, all = false) => app.run(insertBlock(refBlockNode({ kind: 'bibliography', title, all }), 'node'))
  return h(
    'div',
    { class: 'fp-pop__list', role: 'menu' },
    popItem(t('bib.bibliography'), () => ins(t('bib.bibliography')), { 'data-bib': 'bibliography' }),
    popItem(t('bib.references'), () => ins(t('bib.references')), { 'data-bib': 'references' }),
    popItem(t('bib.worksCited'), () => ins(t('bib.worksCited')), { 'data-bib': 'works-cited' }),
    h('hr', { class: 'fp-pop__sep' }),
    popItem(t('bib.insert'), () => ins(''), { 'data-bib': 'plain' }),
    popItem(t('bib.all'), () => ins(t('bib.bibliography'), true), { 'data-bib': 'all' }),
  )
}
