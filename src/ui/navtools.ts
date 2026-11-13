// Accueil → Rechercher → Atteindre (page, titre, note, signet, commentaire,
// tableau, image, équation), Sélectionner → texte de mise en forme semblable,
// Insertion → Nombre (en chiffres, en lettres, romain…).

import type { FolioApp } from '../app'
import type { Mark, Node as PMNode } from 'prosemirror-model'
import { Selection, SelectionRange, TextSelection, type EditorState } from 'prosemirror-state'
import { MultiRangeSelection } from '../editor/multiselect'
import { schema } from '../editor/schema'
import type { Key } from '../i18n/dict'
import { lang, t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h } from './dom'

// --- Atteindre --------------------------------------------------------------------

export const GOTO_KINDS = ['page', 'heading', 'footnote', 'endnote', 'bookmark', 'comment', 'table', 'image', 'equation'] as const
export type GotoKind = (typeof GOTO_KINDS)[number]

/** Positions des éléments d'une sorte, dans l'ordre du document (avec un nom pour les signets). */
export function targetsOf(doc: PMNode, kind: Exclude<GotoKind, 'page'>): { pos: number; name?: string }[] {
  const n = schema.nodes
  const out: { pos: number; name?: string }[] = []
  const seen = new Set<string>()
  doc.descendants((node, pos) => {
    switch (kind) {
      case 'heading':
        if (node.type === n.heading) out.push({ pos, name: node.textContent })
        break
      case 'footnote':
      case 'endnote':
        if (node.type === n.note && node.attrs.kind === (kind === 'footnote' ? 'foot' : 'end')) out.push({ pos })
        break
      case 'bookmark':
        if (node.type === n.bookmark && !String(node.attrs.name).startsWith('_')) out.push({ pos, name: node.attrs.name })
        break
      case 'comment': {
        const mk = node.isText ? node.marks.find((m) => m.type === schema.marks.comment) : null
        if (mk && !seen.has(mk.attrs.id)) {
          seen.add(mk.attrs.id)
          out.push({ pos })
        }
        break
      }
      case 'table':
        if (node.type.name === 'table') out.push({ pos })
        break
      case 'image':
        if (node.type === n.figure) out.push({ pos })
        break
      case 'equation':
        if (node.type === n.equation || node.type === n.math) out.push({ pos })
        break
    }
    return true
  })
  return out
}

/** Début de la page n (1 = la première) : la première position qui y est. */
function pageStart(app: FolioApp, page: number): number | null {
  const info = app.pagesInfo
  if (!info) return page === 1 ? 0 : null
  let found: number | null = null
  app.state.doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.isTextblock || node.isAtom) {
      if (info.index(pos) >= page - 1) found = pos
      return false
    }
    return true
  })
  return found
}

/** Aller à une position : le curseur au début de l'élément, la page qui défile jusqu'à lui. */
export function goPos(app: FolioApp, pos: number): void {
  const doc = app.state.doc
  // Un élément dans la ligne (signet, note, formule) : le curseur juste avant lui ; un bloc : à son début.
  const inline = doc.nodeAt(pos)?.isInline
  const $pos = doc.resolve(Math.min(inline ? pos : pos + 1, doc.content.size))
  app.view.dispatch(app.state.tr.setSelection(Selection.near($pos)).scrollIntoView())
  const dom = app.view.nodeDOM(pos) as HTMLElement | null
  ;(dom?.nodeType === 1 ? dom : dom?.parentElement)?.scrollIntoView({ block: 'center' })
  app.view.focus()
}

export function goToDialog(app: FolioApp): void {
  const kinds = h('select', { class: 'fp-input fp-goto__kinds', size: '9', 'data-field': 'goto-kind', 'aria-label': t('goto.what') }) as HTMLSelectElement
  for (const k of GOTO_KINDS) kinds.append(h('option', { value: k }, t(`goto.kind.${k}` as Key)))
  kinds.value = 'page'
  const input = h('input', { type: 'text', class: 'fp-input', 'data-field': 'goto-target', autocomplete: 'off' }) as HTMLInputElement
  const names = h('select', { class: 'fp-input', 'data-field': 'goto-name', hidden: '' }) as HTMLSelectElement
  const label = h('span', { class: 'fp-label' })
  const hint = h('p', { class: 'fp-form__hint', 'data-field': 'goto-hint' })
  const status = h('p', { class: 'fp-field-error', role: 'status', 'data-field': 'goto-status' })
  const kind = () => kinds.value as GotoKind
  const refresh = () => {
    const k = kind()
    const isNamed = k === 'bookmark'
    names.hidden = !isNamed
    input.hidden = isNamed
    label.textContent = t(k === 'page' ? 'goto.enterPage' : isNamed ? 'goto.enterName' : 'goto.enterNumber', { what: t(`goto.kind.${k}` as Key).toLowerCase() })
    hint.textContent = t(k === 'page' ? 'goto.hintPage' : 'goto.hintOther')
    if (isNamed) {
      names.replaceChildren(...targetsOf(app.state.doc, 'bookmark').map((b) => h('option', { value: String(b.pos) }, b.name ?? '')))
    }
    status.textContent = ''
    go.textContent = input.value.trim() || isNamed ? t('goto.go') : t('goto.next')
  }
  /** Position voulue : numéro (absolu, ou +n / −n depuis le curseur), ou sans numéro le suivant ou le précédent. */
  const resolve = (dir: 1 | -1 | 0): number | null => {
    const k = kind()
    const cur = app.state.selection.from
    if (k === 'bookmark') return names.value ? Number(names.value) : null
    const raw = input.value.trim().replace(/^−/, '-')
    if (k === 'page') {
      const info = app.pagesInfo
      const here = info ? info.index(cur) + 1 : 1
      const total = info?.pages() ?? 1
      let page = dir ? here + dir : here
      if (raw) page = /^[+-]\d+$/.test(raw) ? here + Number(raw) : Number(raw)
      if (!Number.isInteger(page) || page < 1 || page > total) return null
      return pageStart(app, page)
    }
    const list = targetsOf(app.state.doc, k)
    if (!list.length) return null
    if (raw) {
      const i = /^[+-]\d+$/.test(raw) ? list.findIndex((x) => x.pos > cur) - 1 + Number(raw) + (Number(raw) > 0 ? 0 : 1) : Number(raw) - 1
      return list[i]?.pos ?? null
    }
    if (dir < 0) return [...list].reverse().find((x) => x.pos < cur - 1)?.pos ?? null
    return list.find((x) => x.pos > cur)?.pos ?? list[0].pos
  }
  const move = (dir: 1 | -1 | 0) => {
    const pos = resolve(dir)
    if (pos === null) {
      status.textContent = t('goto.notFound', { what: t(`goto.kind.${kind()}` as Key).toLowerCase() })
      return false
    }
    status.textContent = ''
    goPos(app, pos)
    return false
  }
  const go = h('button', { type: 'button', class: 'fp-btn fp-btn--primary', 'data-goto': 'go' }, t('goto.next'))
  const prev = h('button', { type: 'button', class: 'fp-btn', 'data-goto': 'previous' }, t('goto.previous'))
  go.addEventListener('click', () => move(input.value.trim() && kind() !== 'bookmark' ? 0 : 1))
  prev.addEventListener('click', () => move(-1))
  input.addEventListener('input', refresh)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      go.click()
    }
  })
  kinds.addEventListener('change', refresh)
  refresh()
  // En refermant la fenêtre, on écrit là où Atteindre a mené.
  void openDialog({
    name: 'goto',
    title: t('goto.title'),
    focus: input,
    body: [h('div', { class: 'fp-goto' }, h('label', { class: 'fp-goto__col' }, h('span', { class: 'fp-label' }, t('goto.what')), kinds), h('div', { class: 'fp-goto__col' }, label, input, names, hint, status, h('div', { class: 'fp-goto__buttons' }, prev, go)))],
    actions: [{ label: t('action.close'), value: 'close' }],
  }).result.then(() => setTimeout(() => app.view.focus(), 0))
}

// --- texte de mise en forme semblable -----------------------------------------------

/** Marques de référence : celles du texte sélectionné (ou au curseur). */
function referenceMarks(state: EditorState): readonly Mark[] {
  const { $from, empty, from, to } = state.selection
  if (empty) return state.storedMarks ?? $from.marks()
  let found: readonly Mark[] | null = null
  state.doc.nodesBetween(from, to, (node) => {
    if (found || !node.isText) return !found
    found = node.marks
    return false
  })
  return found ?? $from.marks()
}

/** Tous les passages de même mise en forme que la sélection (voisins fusionnés), sans les commentaires et suivis. */
export function similarRanges(state: EditorState): { from: number; to: number }[] {
  const ignore = new Set(['comment', 'insertion', 'deletion'])
  const key = (marks: readonly Mark[]) =>
    marks
      .filter((m) => !ignore.has(m.type.name))
      .map((m) => `${m.type.name}${JSON.stringify(m.attrs)}`)
      .sort()
      .join('|')
  const want = key(referenceMarks(state))
  const out: { from: number; to: number }[] = []
  state.doc.descendants((node, pos) => {
    if (!node.isText) return true
    if (key(node.marks) !== want || !node.text?.trim()) return false
    const last = out[out.length - 1]
    if (last && last.to === pos) last.to = pos + node.nodeSize
    else out.push({ from: pos, to: pos + node.nodeSize })
    return false
  })
  return out
}

export function selectSimilar(app: FolioApp): void {
  const ranges = similarRanges(app.state).slice(0, 5000)
  if (!ranges.length) return void toast(t('similar.none'), { kind: 'info' })
  const doc = app.state.doc
  const sel = ranges.length === 1 ? TextSelection.create(doc, ranges[0].from, ranges[0].to) : new MultiRangeSelection(ranges.map((r) => new SelectionRange(doc.resolve(r.from), doc.resolve(r.to))))
  app.view.dispatch(app.state.tr.setSelection(sel))
  app.view.focus()
  toast(t('similar.done', { n: ranges.length }), { kind: 'info' })
}

// --- Insertion → Nombre ----------------------------------------------------------------

export const NUMBER_FORMATS = ['digits', 'words', 'ordinal', 'ordinalWords', 'roman', 'ROMAN', 'alpha', 'ALPHA'] as const
export type NumberFormat = (typeof NUMBER_FORMATS)[number]

const FR_UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf']
const FR_TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt']

/** Un nombre entier en lettres, en français (orthographe de 1990 : traits d'union partout). */
export function frenchWords(n: number): string {
  if (n < 0) return `moins-${frenchWords(-n)}`
  if (n < 20) return FR_UNITS[n]
  if (n < 100) {
    const t10 = Math.floor(n / 10)
    let u = n % 10
    if (t10 === 7 || t10 === 9) u += 10
    if (u === 0) return t10 === 8 ? 'quatre-vingts' : FR_TENS[t10]
    if ((u === 1 || u === 11) && t10 !== 8 && t10 !== 9) return `${FR_TENS[t10]}-et-${FR_UNITS[u]}`
    return `${FR_TENS[t10]}-${FR_UNITS[u]}`
  }
  if (n < 1000) {
    const c = Math.floor(n / 100)
    const r = n % 100
    const head = c === 1 ? 'cent' : `${FR_UNITS[c]}-cent${r === 0 ? 's' : ''}`
    return r ? `${head}-${frenchWords(r)}` : head
  }
  const scales: [number, string, string][] = [
    [1e9, 'milliard', 'milliards'],
    [1e6, 'million', 'millions'],
  ]
  for (const [v, one, many] of scales) {
    if (n >= v) {
      const q = Math.floor(n / v)
      const r = n % v
      return `${q === 1 ? 'un' : frenchWords(q)}-${q === 1 ? one : many}${r ? `-${frenchWords(r)}` : ''}`
    }
  }
  const q = Math.floor(n / 1000)
  const r = n % 1000
  // « mille » ne prend pas de s ; « quatre-vingt-mille », « deux-cent-mille ».
  const head = q === 1 ? 'mille' : `${frenchWords(q).replace(/-vingts$/, '-vingt').replace(/-cents$/, '-cent')}-mille`
  return r ? `${head}-${frenchWords(r)}` : head
}

const EN_UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

export function englishWords(n: number): string {
  if (n < 0) return `minus ${englishWords(-n)}`
  if (n < 20) return EN_UNITS[n]
  if (n < 100) return `${EN_TENS[Math.floor(n / 10)]}${n % 10 ? `-${EN_UNITS[n % 10]}` : ''}`
  if (n < 1000) return `${EN_UNITS[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${englishWords(n % 100)}` : ''}`
  for (const [v, name] of [
    [1e9, 'billion'],
    [1e6, 'million'],
    [1e3, 'thousand'],
  ] as [number, string][]) {
    if (n >= v) {
      const r = n % v
      return `${englishWords(Math.floor(n / v))} ${name}${r ? (r < 100 ? ` and ${englishWords(r)}` : ` ${englishWords(r)}`) : ''}`
    }
  }
  return String(n)
}

function roman(n: number): string {
  const table: [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ]
  let out = ''
  for (const [v, s] of table) while (n >= v) (out += s), (n -= v)
  return out
}

function alpha(n: number): string {
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(97 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** Un nombre dans un format ; null s'il ne s'y écrit pas (romain au-delà de 3 999…). */
export function formatNumber(value: number, format: NumberFormat, locale: string): string | null {
  const fr = locale.startsWith('fr')
  const int = Number.isInteger(value)
  switch (format) {
    case 'digits':
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 10 }).format(value)
    case 'words': {
      if (!Number.isFinite(value) || Math.abs(value) >= 1e12) return null
      const whole = Math.trunc(value)
      const cents = Math.round(Math.abs(value - whole) * 100)
      const w = fr ? frenchWords(whole) : englishWords(whole)
      if (int || !cents) return w
      return fr ? `${w} virgule ${frenchWords(cents)}` : `${w} point ${englishWords(cents)}`
    }
    case 'ordinal': {
      if (!int || value < 1) return null
      if (fr) return value === 1 ? '1er' : `${value}e`
      const s = value % 100 >= 11 && value % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'
      return `${value}${s}`
    }
    case 'ordinalWords': {
      if (!int || value < 1 || value >= 1e12) return null
      if (fr) {
        if (value === 1) return 'premier'
        const w = frenchWords(value).replace(/-(cents|vingts)$/, (m) => m.slice(0, -1))
        return w.replace(/q$/, 'qu').replace(/f$/, 'v').replace(/e$/, '') + 'ième'
      }
      const w = englishWords(value)
      const irregular: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' }
      return w.replace(/([a-z]+)$/, (last) => irregular[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`))
    }
    case 'roman':
    case 'ROMAN': {
      if (!int || value < 1 || value > 3999) return null
      const r = roman(value)
      return format === 'ROMAN' ? r.toUpperCase() : r
    }
    case 'alpha':
    case 'ALPHA': {
      if (!int || value < 1 || value > 18278) return null
      const a = alpha(value)
      return format === 'ALPHA' ? a.toUpperCase() : a
    }
  }
}

export function insertNumberDialog(app: FolioApp): void {
  const input = h('input', { type: 'text', class: 'fp-input', inputmode: 'decimal', 'data-field': 'number-value', placeholder: '1234' }) as HTMLInputElement
  const list = h('select', { class: 'fp-input', size: '8', 'data-field': 'number-format', 'aria-label': t('num.format') }) as HTMLSelectElement
  const locale = (app.state.doc.attrs.lang as string) || lang()
  const parse = () => {
    const raw = input.value.trim().replace(/\s/g, '').replace(/ | /g, '').replace(',', '.')
    return raw && /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : null
  }
  const refresh = () => {
    const v = parse()
    const keep = list.value || 'digits'
    list.replaceChildren(
      ...NUMBER_FORMATS.map((f) => {
        const sample = v === null ? t(`num.f.${f}` as Key) : (formatNumber(v, f, locale) ?? '—')
        return h('option', { value: f, ...(v !== null && formatNumber(v, f, locale) === null ? { disabled: '' } : {}) }, sample)
      }),
    )
    list.value = keep
  }
  input.addEventListener('input', refresh)
  refresh()
  openDialog({
    name: 'insert-number',
    title: t('num.title'),
    focus: input,
    body: [h('label', { class: 'fp-form__row' }, h('span', { class: 'fp-label' }, t('num.value')), input), h('label', { class: 'fp-form__row' }, h('span', { class: 'fp-label' }, t('num.format')), list)],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.insert'),
        value: 'ok',
        primary: true,
        run: () => {
          const v = parse()
          const text = v === null ? null : formatNumber(v, (list.value || 'digits') as NumberFormat, locale)
          if (!text) {
            input.focus()
            return false
          }
          app.view.dispatch(app.state.tr.insertText(text).scrollIntoView())
          app.view.focus()
        },
      },
    ],
  })
}
