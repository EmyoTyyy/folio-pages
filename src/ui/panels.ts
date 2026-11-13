// Fenêtres et actions de l'interface d'édition (phase 2) : police,
// paragraphe, styles, thème, polices intégrées, propriétés, lien, caractères
// spéciaux, date et heure, tableau, image (rognage, texte de remplacement,
// compression), statistiques, raccourcis, zoom, presse-papiers.

import { openUrl } from '../net'
import { decryptEnvelope, type Envelope } from '../file/crypto'
import { loadDocument } from '../format/load'
import { insertBlankPage as insertBlankPageCmd } from '../editor/commands'
import type { Mark, Node as PMNode } from 'prosemirror-model'
import { TextSelection, type Transaction } from 'prosemirror-state'
import { TableMap } from 'prosemirror-tables'
import type { FolioApp } from '../app'
import { applyStyle, insertField, insertText, listAt, markRange, markValue, sectionBreakAt, setLink, setListAttrs, setSectionAttrs, styleIdAt } from '../editor/commands'
import { cssFont } from '../editor/css'
import { prepareFile, prepareImage, dataUriBytes } from '../editor/images'
import { insertImageFiles, plainSlice } from '../editor/paste'
import { schema } from '../editor/schema'
import { refsOf } from '../editor/refs'
import { countWords, stats } from '../editor/stats'
import { figureAt, setFigureAttrs, tableAt } from '../editor/tables'
import { collectNotes, insertNote, noteText, type NoteKind } from '../editor/notes'
import { changesAt, changesOf, isTracking, resolveChanges, setTracking } from '../editor/track'
import { withAuthor } from './comments'
import { deleteVersions, versionsBackend } from '../file/versions'
import { canReopen, forgetRecent, openRecent, pickFile as pickDocument, readOpened, recentFiles, type Opened } from '../file/open'
import { reportDialog, reportSummary } from './actions'
import { bakePicture, DOCX_MIME, loadDocx, rasterize, saveExport } from '../file/docx'
import { outline } from '../editor/outline'
import { cssColor, cssHighlight, isFontName, parseColor } from '../format/color'
import { formatWithPattern } from '../format/fields'
import { isSafeLink } from '../format/spec'
import { BUILTIN_STYLES, BUILTIN_STYLE_IDS, EMBEDDED_FONTS, THEME_PRESETS, cloneTheme, isBuiltinStyle, presetOf, resolveStyle, pruneStyles, styleDef } from '../format/theme'
import { CODE_COLORS, NOTE_FORMATS, NOTE_RESTARTS, PAGE_NUMBER_FORMATS, PAPER_SIZES, THEME_COLORS, THEME_FONTS, hasOwn, type Block, type FolioDoc, type HeaderSet, type Inline, type NoteSettings, type PageSetup, type StyleDef } from '../format/types'
import { Report } from '../format/dsl'
import type { FsHandle } from '../file/save'
import { normalizePage } from '../format/normalize'
import { pageLabel } from '../layout/paginate'
import { formatDate, lang, t } from '../i18n/i18n'
import type { Key } from '../i18n/dict'
import { settings, updateSettings } from '../settings'
import { openDialog, toast } from './dialog'
import { h, isMac, shortcut } from './dom'
import { openFindBar } from './findbar'
import { closePopovers, popItem } from './popover'

const m = schema.marks
const n = schema.nodes

// --- couleurs ---------------------------------------------------------------------

/** Dernières couleurs choisies (le bouton principal les réapplique). */
export const lastColor = { text: '#c00000', highlight: 'yellow', shading: '#eef1f4', cell: '#e9eef2' }

/** Couleur CSS réelle (les couleurs du thème sont résolues) pour un aperçu. */
export function cssOf(app: FolioApp, c: string | null): string | null {
  if (!c) return null
  if ((THEME_COLORS as readonly string[]).includes(c)) return app.theme.colors[c as (typeof THEME_COLORS)[number]]
  return cssColor(c)
}

export const highlightCss = (c: string | null) => (c ? cssHighlight(c) : null)
export const fontCss = (name: string) => cssFont(name)

// --- formulaires --------------------------------------------------------------------

let fieldSeq = 0

/** Champ de formulaire étiqueté. */
function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || `fp-f-${++fieldSeq}`
  control.id = id
  return h('div', { class: 'fp-form__row' }, h('label', { class: 'fp-label', for: id }, label), control, hint ? h('p', { class: 'fp-form__hint' }, hint) : null)
}

function input(type: string, value: string | number, attrs: Record<string, string> = {}): HTMLInputElement {
  const el = h('input', { type, class: 'fp-input', ...attrs }) as HTMLInputElement
  el.value = String(value)
  return el
}

function check(label: string, checked: boolean, attrs: Record<string, string> = {}): { el: HTMLElement; box: HTMLInputElement } {
  const box = h('input', { type: 'checkbox', ...attrs }) as HTMLInputElement
  box.checked = checked
  return { el: h('label', { class: 'fp-check' }, box, h('span', {}, label)), box }
}

function select(options: [string, string][], value: string, attrs: Record<string, string> = {}): HTMLSelectElement {
  const el = h('select', { class: 'fp-input', ...attrs }) as HTMLSelectElement
  for (const [v, l] of options) {
    const o = h('option', { value: v }, l) as HTMLOptionElement
    if (v === value) o.selected = true
    el.append(o)
  }
  return el
}

const num = (v: string): number | null => {
  const x = parseFloat(v.replace(',', '.'))
  return Number.isFinite(x) ? x : null
}

const fmt = (x: number, digits = 2) => String(Number(x.toFixed(digits))).replace('.', t('number.decimal'))

/** Retraits en cm à l'écran, en points dans le format. */
const PT_PER_CM = 72 / 2.54
const cm = (pt: number | null) => (pt === null ? '' : fmt(pt / PT_PER_CM))
const fromCm = (v: string): number | null => {
  const x = num(v)
  return x === null ? null : Math.round(x * PT_PER_CM * 2) / 2
}

// --- presse-papiers -----------------------------------------------------------------

export function clipboardAction(app: FolioApp, kind: 'cut' | 'copy'): void {
  app.focus()
  let ok = false
  try {
    ok = document.execCommand(kind)
  } catch {
    ok = false
  }
  if (!ok) toast(t('clipboard.useKeyboard', { key: shortcut(kind === 'cut' ? 'X' : 'C') }), { kind: 'info' })
}

export async function pasteFromClipboard(app: FolioApp, plain: boolean): Promise<void> {
  app.focus()
  try {
    if (!plain && navigator.clipboard && 'read' in navigator.clipboard) {
      const items = await navigator.clipboard.read()
      for (const it of items) {
        const img = it.types.find((x) => x.startsWith('image/'))
        if (it.types.includes('text/html')) {
          const html = await (await it.getType('text/html')).text()
          app.view.pasteHTML(html)
          return
        }
        if (img) {
          const blob = await it.getType(img)
          await insertImageFiles(app.view, [new File([blob], 'image', { type: img })], { reduceImages: () => settings().reduceImages, onImageError: () => toast(t('image.unreadable'), { kind: 'error' }) })
          return
        }
        if (it.types.includes('text/plain')) {
          app.view.pasteText(await (await it.getType('text/plain')).text())
          return
        }
      }
      return
    }
    const text = await navigator.clipboard.readText()
    app.view.dispatch(app.state.tr.replaceSelection(plainSlice(text)).scrollIntoView())
  } catch {
    toast(t('clipboard.pasteKeyboard', { key: shortcut(plain ? 'Maj+V' : 'V').replace('Maj', t('key.shift')) }), { kind: 'info', timeout: 7000 })
  }
}

// --- police -----------------------------------------------------------------------

/** Applique des marques sur la sélection en une seule étape. */
function applyMarks(app: FolioApp, set: { type: import('prosemirror-model').MarkType; attrs: Record<string, unknown> | null }[], flags: Record<string, boolean>): void {
  const s = app.state
  const { from, to, empty } = s.selection
  const tr = s.tr
  if (empty) {
    let marks: readonly Mark[] = s.storedMarks ?? s.selection.$from.marks()
    for (const { type, attrs } of set) {
      marks = type.removeFromSet(marks)
      if (attrs) marks = type.create(attrs).addToSet(marks)
    }
    for (const [name, on] of Object.entries(flags)) {
      const type = m[name]
      marks = on ? type.create().addToSet(marks) : type.removeFromSet(marks)
    }
    tr.setStoredMarks(marks)
  } else {
    for (const { type, attrs } of set) {
      tr.removeMark(from, to, type)
      if (attrs) tr.addMark(from, to, type.create(attrs))
    }
    for (const [name, on] of Object.entries(flags)) {
      if (on) tr.addMark(from, to, m[name].create())
      else tr.removeMark(from, to, m[name])
    }
  }
  app.view.dispatch(tr.scrollIntoView())
  app.focus()
}

export function fontDialog(app: FolioApp): void {
  const s = app.state
  const v = <T,>(type: import('prosemirror-model').MarkType, attr: string) => {
    const x = markValue(s, type, attr)
    return x === 'mixed' ? null : (x as T | null)
  }
  const family = input('text', v<string>(m.font, 'family') ?? '', { list: 'fp-font-list', 'data-field': 'font-family' })
  const datalist = h('datalist', { id: 'fp-font-list' }, ...['heading', 'body', 'mono', ...EMBEDDED_FONTS, 'Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Courier New'].map((f) => h('option', { value: f })))
  const size = input('text', v<number>(m.size, 'pt') ? fmt(v<number>(m.size, 'pt')!) : '', { 'data-field': 'font-size', inputmode: 'decimal' })
  const color = colorInput(app, v<string>(m.color, 'value'), 'font-color')
  const spacing = input('text', v<number>(m.letter_spacing, 'pt') ? fmt(v<number>(m.letter_spacing, 'pt')!) : '', { 'data-field': 'letter-spacing', inputmode: 'decimal' })
  const language = input('text', v<string>(m.lang, 'tag') ?? '', { 'data-field': 'lang', placeholder: 'fr, en-GB, de…' })
  const flagNames = ['bold', 'italic', 'underline', 'strike', 'caps', 'smallcaps', 'sup', 'sub'] as const
  const flags = Object.fromEntries(flagNames.map((f) => [f, check(t(`ribbon.${f}` as Key), markValue(s, m[f], '') !== null && isActive(app, f), { 'data-flag': f })]))
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  openDialog({
    name: 'font',
    title: t('dialog.font'),
    body: [
      h('div', { class: 'fp-form fp-form--grid' }, field(t('ribbon.fontFamily'), family), datalist, field(t('ribbon.fontSize'), size, t('dialog.inPoints')), field(t('ribbon.color'), color.el), field(t('dialog.letterSpacing'), spacing, t('dialog.inPoints')), field(t('dialog.language'), language)),
      h('div', { class: 'fp-checks' }, ...flagNames.map((f) => flags[f].el)),
      error,
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const set: { type: import('prosemirror-model').MarkType; attrs: Record<string, unknown> | null }[] = []
          const fam = family.value.trim()
          if (fam && !isFontName(fam)) {
            error.textContent = t('dialog.badFont')
            return false
          }
          set.push({ type: m.font, attrs: fam ? { family: fam } : null })
          const pt = size.value.trim() ? num(size.value) : null
          if (size.value.trim() && (pt === null || pt < 1 || pt > 400)) {
            error.textContent = t('dialog.badSize')
            return false
          }
          set.push({ type: m.size, attrs: pt ? { pt: Math.round(pt * 2) / 2 } : null })
          set.push({ type: m.color, attrs: color.value() ? { value: color.value() } : null })
          const ls = spacing.value.trim() ? num(spacing.value) : null
          set.push({ type: m.letter_spacing, attrs: ls ? { pt: Math.max(-20, Math.min(100, Math.round(ls * 10) / 10)) } : null })
          const tag = language.value.trim()
          if (tag && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(tag)) {
            error.textContent = t('dialog.badLang')
            return false
          }
          set.push({ type: m.lang, attrs: tag ? { tag } : null })
          const fl: Record<string, boolean> = {}
          for (const f of flagNames) fl[f] = flags[f].box.checked
          if (fl.sup && fl.sub) fl.sub = false
          applyMarks(app, set, fl)
          return true
        },
      },
    ],
  })
}

function isActive(app: FolioApp, flag: string): boolean {
  const s = app.state
  const { from, to, empty, $from } = s.selection
  if (empty) return !!m[flag].isInSet(s.storedMarks ?? $from.marks())
  let all = true
  let any = false
  s.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return
    any = true
    if (!m[flag].isInSet(node.marks)) all = false
  })
  return any && all
}

/** Choix d'une couleur : couleurs du thème, ou couleur libre. */
function colorInput(app: FolioApp, current: string | null, name: string, allowTheme = true): { el: HTMLElement; value: () => string | null } {
  const opts: [string, string][] = [['', t('color.automatic')]]
  if (allowTheme) for (const c of THEME_COLORS) opts.push([c, t(`color.${c}` as Key)])
  opts.push(['custom', t('color.custom')])
  const isTheme = current !== null && (THEME_COLORS as readonly string[]).includes(current)
  const sel = select(opts, current === null ? '' : isTheme ? current : 'custom', { 'data-field': name })
  const pick = input('color', current && !isTheme ? current : app.theme.colors.accent1, { 'aria-label': t('color.custom') })
  pick.hidden = sel.value !== 'custom'
  sel.addEventListener('change', () => (pick.hidden = sel.value !== 'custom'))
  return {
    el: h('div', { class: 'fp-color-input' }, sel, pick),
    value: () => (sel.value === '' ? null : sel.value === 'custom' ? parseColor(pick.value, false) : sel.value),
  }
}

// --- paragraphe ---------------------------------------------------------------------

export function paragraphDialog(app: FolioApp): void {
  const s = app.state
  const { $from } = s.selection
  const block = $from.parent.type === n.paragraph || $from.parent.type === n.heading ? $from.parent : null
  if (!block) {
    toast(t('dialog.noParagraph'), { kind: 'info' })
    return
  }
  const a = block.attrs
  const resolved = resolveStyle(app.styles, styleIdAt(s))
  const align = select(
    [['', t('dialog.alignStyle')], ...(['left', 'center', 'right', 'justify'] as const).map((x) => [x, t(`ribbon.align.${x}` as Key)] as [string, string])],
    a.align ?? '',
    { 'data-field': 'align' },
  )
  const left = input('text', cm(a.indentLeft), { 'data-field': 'indent-left', inputmode: 'decimal', placeholder: cm(resolved.indent?.left ?? 0) })
  const right = input('text', cm(a.indentRight), { 'data-field': 'indent-right', inputmode: 'decimal', placeholder: cm(resolved.indent?.right ?? 0) })
  const firstVal = a.indentFirst as number | null
  const special = select(
    [
      ['', t('dialog.firstNone')],
      ['first', t('dialog.firstLine')],
      ['hanging', t('dialog.hanging')],
    ],
    firstVal === null ? '' : firstVal < 0 ? 'hanging' : 'first',
    { 'data-field': 'special' },
  )
  const first = input('text', firstVal === null ? '' : cm(Math.abs(firstVal)), { 'data-field': 'indent-first', inputmode: 'decimal' })
  const before = input('text', a.spaceBefore ?? '', { 'data-field': 'space-before', inputmode: 'decimal', placeholder: String(resolved.spacing?.before ?? 0) })
  const after = input('text', a.spaceAfter ?? '', { 'data-field': 'space-after', inputmode: 'decimal', placeholder: String(resolved.spacing?.after ?? 0) })
  const line = input('text', a.line === null ? '' : fmt(a.line), { 'data-field': 'line', inputmode: 'decimal', placeholder: fmt(resolved.line ?? 1.45) })
  const keepNext = check(t('dialog.keepNext'), a.keepNext, { 'data-field': 'keep-next' })
  const keepLines = check(t('dialog.keepLines'), a.keepLines, { 'data-field': 'keep-lines' })
  const breakBefore = check(t('dialog.pageBreakBefore'), a.pageBreakBefore, { 'data-field': 'break-before' })
  const shading = colorInput(app, a.shading, 'shading')
  const border = colorInput(app, a.border, 'border')
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  openDialog({
    name: 'paragraph',
    title: t('dialog.paragraph'),
    wide: true,
    body: [
      h('h3', { class: 'fp-form__title' }, t('dialog.general')),
      h('div', { class: 'fp-form fp-form--grid' }, field(t('dialog.alignment'), align)),
      h('h3', { class: 'fp-form__title' }, t('dialog.indents')),
      h('div', { class: 'fp-form fp-form--grid' }, field(t('dialog.indentLeft'), left, t('dialog.inCm')), field(t('dialog.indentRight'), right, t('dialog.inCm')), field(t('dialog.special'), special), field(t('dialog.by'), first, t('dialog.inCm'))),
      h('h3', { class: 'fp-form__title' }, t('dialog.spacing')),
      h('div', { class: 'fp-form fp-form--grid' }, field(t('dialog.before'), before, t('dialog.inPoints')), field(t('dialog.after'), after, t('dialog.inPoints')), field(t('dialog.lineSpacing'), line, t('dialog.lineHint'))),
      h('h3', { class: 'fp-form__title' }, t('dialog.pagination')),
      h('div', { class: 'fp-checks' }, keepNext.el, keepLines.el, breakBefore.el),
      h('h3', { class: 'fp-form__title' }, t('dialog.borders')),
      h('div', { class: 'fp-form fp-form--grid' }, field(t('ribbon.shading'), shading.el), field(t('ribbon.paraBorder'), border.el)),
      error,
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const bad = (el: HTMLInputElement, min: number, max: number, parse: (v: string) => number | null) => {
            if (!el.value.trim()) return null
            const x = parse(el.value)
            if (x === null || x < min || x > max) {
              error.textContent = t('dialog.badNumber')
              el.focus()
              throw new Error('bad')
            }
            return x
          }
          try {
            const firstAbs = bad(first, 0, 1000, fromCm)
            const attrs = {
              align: align.value || null,
              indentLeft: bad(left, -300, 1000, fromCm),
              indentRight: bad(right, -300, 1000, fromCm),
              indentFirst: special.value === '' ? null : special.value === 'hanging' ? -(firstAbs ?? 18) : (firstAbs ?? 18),
              spaceBefore: bad(before, 0, 1000, (v) => (num(v) === null ? null : Math.round(num(v)! * 2) / 2)),
              spaceAfter: bad(after, 0, 1000, (v) => (num(v) === null ? null : Math.round(num(v)! * 2) / 2)),
              line: bad(line, 0.5, 10, (v) => (num(v) === null ? null : Math.round(num(v)! * 20) / 20)),
              keepNext: keepNext.box.checked,
              keepLines: keepLines.box.checked,
              pageBreakBefore: breakBefore.box.checked,
              shading: shading.value(),
              border: border.value(),
            }
            const tr = app.state.tr
            const { from, to } = app.state.selection
            app.state.doc.nodesBetween(from, to, (node, pos) => {
              if (node.type === n.paragraph || node.type === n.heading) {
                tr.setNodeMarkup(pos, null, { ...node.attrs, ...attrs })
                return false
              }
              return true
            })
            app.view.dispatch(tr)
            app.focus()
            return true
          } catch {
            return false
          }
        },
      },
    ],
  })
}

export function listStartDialog(app: FolioApp): void {
  const list = listAt(app.state)
  if (!list || list.node.type !== n.ordered_list) {
    toast(t('list.notNumbered'), { kind: 'info' })
    return
  }
  const start = input('number', list.node.attrs.order, { min: '1', max: '1000000', 'data-field': 'start' })
  openDialog({
    name: 'list-start',
    title: t('list.startAt'),
    body: [field(t('list.startValue'), start)],
    focus: start,
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const v = Math.floor(Number(start.value))
          if (!Number.isFinite(v) || v < 1 || v > 1_000_000) return false
          app.run(setListAttrs({ order: v, continue: false }))
          return true
        },
      },
    ],
  })
}

// --- styles ---------------------------------------------------------------------

export function styleName(app: FolioApp, id: string): string {
  const own = hasOwn(app.styles, id) ? app.styles[id].name : undefined
  if (own) return own
  return isBuiltinStyle(id) ? t(`style.${id}` as Key) : id
}

/** Aperçu d'un style dans la galerie (taille ramenée à une hauteur raisonnable). */
export function stylePreviewCss(s: StyleDef): string {
  const out: string[] = []
  if (s.font) out.push(`font-family:${cssFont(s.font)}`)
  if (s.size) out.push(`font-size:${Math.max(9, Math.min(13, s.size))}pt`)
  if (s.bold !== undefined) out.push(`font-weight:${s.bold ? 700 : 400}`)
  if (s.italic) out.push('font-style:italic')
  if (s.color) out.push(`color:${cssColor(s.color)}`)
  if (s.caps) out.push('text-transform:uppercase')
  if (s.smallcaps) out.push('font-variant-caps:small-caps')
  if (s.underline) out.push('text-decoration:underline')
  return out.join(';')
}

/** Identifiant d'un nouveau style à partir de son nom. */
export function styleIdFor(name: string, taken: (id: string) => boolean): string {
  let base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'style'
  if (!/^[a-z]/.test(base)) base = `s-${base}`
  let id = base
  let k = 2
  while (taken(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) id = `${base}-${k++}`
  return id
}

export function styleDialog(app: FolioApp, id: string | null): void {
  const editing = id !== null
  const styles = app.styles
  const base: StyleDef = id ? (styleDef(styles, id) ?? {}) : { basedOn: styleIdAt(app.state) === 'normal' ? 'normal' : 'normal', next: undefined }
  const resolved = id ? resolveStyle(styles, id) : resolveStyle(styles, 'normal')
  const name = input('text', id ? styleName(app, id) : '', { 'data-field': 'style-name', maxlength: '100' })
  name.disabled = !!id && isBuiltinStyle(id)
  const allIds = [...BUILTIN_STYLE_IDS, ...Object.keys(styles).filter((x) => !isBuiltinStyle(x))].filter((x) => x !== id)
  const basedOn = select([['', t('style.none')], ...allIds.map((x) => [x, styleName(app, x)] as [string, string])], base.basedOn ?? '', { 'data-field': 'based-on' })
  const next = select([['', t('style.sameStyle')], ...allIds.map((x) => [x, styleName(app, x)] as [string, string])], base.next ?? '', { 'data-field': 'next' })
  const font = input('text', base.font ?? '', { list: 'fp-style-font-list', 'data-field': 'style-font', placeholder: resolved.font ?? '' })
  const fonts = h('datalist', { id: 'fp-style-font-list' }, ...['heading', 'body', 'mono', ...EMBEDDED_FONTS].map((f) => h('option', { value: f })))
  const size = input('text', base.size ? fmt(base.size) : '', { 'data-field': 'style-size', inputmode: 'decimal', placeholder: resolved.size ? fmt(resolved.size) : '' })
  const color = colorInput(app, base.color ?? null, 'style-color')
  const tri = (label: string, v: boolean | undefined, key: string) =>
    field(label, select([['', t('style.inherit')], ['yes', t('style.yes')], ['no', t('style.no')]], v === undefined ? '' : v ? 'yes' : 'no', { 'data-field': key }))
  const bold = tri(t('ribbon.bold'), base.bold, 'style-bold')
  const italic = tri(t('ribbon.italic'), base.italic, 'style-italic')
  const align = select([['', t('style.inherit')], ...(['left', 'center', 'right', 'justify'] as const).map((x) => [x, t(`ribbon.align.${x}` as Key)] as [string, string])], base.align ?? '', { 'data-field': 'style-align' })
  const before = input('text', base.spacing?.before ?? '', { 'data-field': 'style-before', inputmode: 'decimal', placeholder: String(resolved.spacing?.before ?? '') })
  const after = input('text', base.spacing?.after ?? '', { 'data-field': 'style-after', inputmode: 'decimal', placeholder: String(resolved.spacing?.after ?? '') })
  const line = input('text', base.line ? fmt(base.line) : '', { 'data-field': 'style-line', inputmode: 'decimal', placeholder: resolved.line ? fmt(resolved.line) : '' })
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  const triValue = (row: HTMLElement) => {
    const v = (row.querySelector('select') as HTMLSelectElement).value
    return v === '' ? undefined : v === 'yes'
  }
  openDialog({
    name: 'style',
    title: editing ? t('style.modifyTitle', { name: styleName(app, id!) }) : t('style.new'),
    wide: true,
    focus: name.disabled ? font : name,
    body: [
      h('div', { class: 'fp-form fp-form--grid' }, field(t('style.name'), name), field(t('style.basedOn'), basedOn), field(t('style.next'), next)),
      h('h3', { class: 'fp-form__title' }, t('ribbon.font')),
      h('div', { class: 'fp-form fp-form--grid' }, field(t('ribbon.fontFamily'), font), fonts, field(t('ribbon.fontSize'), size, t('dialog.inPoints')), field(t('ribbon.color'), color.el), bold, italic),
      h('h3', { class: 'fp-form__title' }, t('ribbon.paragraph')),
      h('div', { class: 'fp-form fp-form--grid' }, field(t('dialog.alignment'), align), field(t('dialog.before'), before, t('dialog.inPoints')), field(t('dialog.after'), after, t('dialog.inPoints')), field(t('dialog.lineSpacing'), line)),
      error,
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const nm = name.value.trim()
          if (!name.disabled && !nm) {
            error.textContent = t('style.nameRequired')
            name.focus()
            return false
          }
          const fam = font.value.trim()
          if (fam && !isFontName(fam)) {
            error.textContent = t('dialog.badFont')
            return false
          }
          const sz = size.value.trim() ? num(size.value) : null
          const def: StyleDef = {}
          if (!name.disabled && nm) def.name = nm
          if (basedOn.value) def.basedOn = basedOn.value
          if (next.value) def.next = next.value
          if (fam) def.font = fam
          if (sz && sz >= 1 && sz <= 400) def.size = Math.round(sz * 2) / 2
          const c = color.value()
          if (c) def.color = c
          const b = triValue(bold)
          if (b !== undefined) def.bold = b
          const i = triValue(italic)
          if (i !== undefined) def.italic = i
          if (align.value) def.align = align.value as StyleDef['align']
          const sp: { before?: number; after?: number } = {}
          if (num(before.value) !== null) sp.before = Math.max(0, Math.min(1000, num(before.value)!))
          if (num(after.value) !== null) sp.after = Math.max(0, Math.min(1000, num(after.value)!))
          if (Object.keys(sp).length) def.spacing = sp
          const ln = num(line.value)
          if (ln !== null && ln >= 0.5 && ln <= 10) def.line = Math.round(ln * 20) / 20
          // Un style intégré garde ce qui n'est pas dans le formulaire (retraits…).
          const keep = id && isBuiltinStyle(id) ? { ...BUILTIN_STYLES[id], ...(styles[id] ?? {}) } : id ? styles[id] : {}
          const merged: StyleDef = { ...keep, ...def }
          for (const k of ['font', 'size', 'color', 'bold', 'italic', 'align', 'spacing', 'line', 'basedOn', 'next'] as const) if (def[k] === undefined) delete merged[k]
          const newId = id ?? styleIdFor(nm, (x) => isBuiltinStyle(x) || hasOwn(styles, x))
          if (newId === merged.basedOn) delete merged.basedOn
          const all = pruneStyles({ ...styles, [newId]: merged })
          app.setDocAttrs({ styles: all })
          if (!id) app.run(applyStyle(newId))
          else app.focus()
          return true
        },
      },
    ],
  })
}

/** Met à jour le style du paragraphe d'après la mise en forme de la sélection. */
export function updateStyleFromSelection(app: FolioApp): void {
  const s = app.state
  const id = styleIdAt(s)
  const block = s.selection.$from.parent
  const marks = s.selection.empty ? (s.storedMarks ?? s.selection.$from.marks()) : (block.firstChild?.marks ?? [])
  const patch: StyleDef = {}
  for (const mk of marks) {
    if (mk.type === m.font) patch.font = mk.attrs.family
    if (mk.type === m.size) patch.size = mk.attrs.pt
    if (mk.type === m.color) patch.color = mk.attrs.value
    if (mk.type === m.bold) patch.bold = true
    if (mk.type === m.italic) patch.italic = true
    if (mk.type === m.underline) patch.underline = true
  }
  const a = block.attrs
  if (block.type === n.paragraph || block.type === n.heading) {
    if (a.align) patch.align = a.align
    if (a.spaceBefore !== null || a.spaceAfter !== null) patch.spacing = { ...(a.spaceBefore !== null ? { before: a.spaceBefore } : {}), ...(a.spaceAfter !== null ? { after: a.spaceAfter } : {}) }
    if (a.line !== null) patch.line = a.line
  }
  if (!Object.keys(patch).length) {
    toast(t('style.nothingToUpdate'), { kind: 'info' })
    return
  }
  const cur = hasOwn(app.styles, id) ? app.styles[id] : {}
  const styles = pruneStyles({ ...app.styles, [id]: { ...cur, ...patch, ...(patch.spacing ? { spacing: { ...cur.spacing, ...patch.spacing } } : {}) } })
  // Le paragraphe perd sa mise en forme directe : il suit désormais son style.
  const tr = s.tr
  for (const [k, v] of Object.entries({ styles })) tr.setDocAttribute(k, v)
  const pos = s.selection.$from.before()
  if (block.type === n.paragraph || block.type === n.heading) tr.setNodeMarkup(pos, null, { ...a, align: null, spaceBefore: null, spaceAfter: null, line: null })
  const start = s.selection.$from.start()
  const end = s.selection.$from.end()
  for (const type of [m.font, m.size, m.color]) tr.removeMark(start, end, type)
  app.view.dispatch(tr)
  toast(t('style.updated', { name: styleName(app, id) }), { kind: 'success' })
}

export function stylesManager(app: FolioApp): void {
  const list = h('ul', { class: 'fp-list fp-styles-list' })
  const render = () => {
    list.replaceChildren()
    const ids = [...BUILTIN_STYLE_IDS, ...Object.keys(app.styles).filter((x) => !isBuiltinStyle(x))]
    for (const id of ids) {
      const changed = hasOwn(app.styles, id)
      const row = h(
        'li',
        { class: 'fp-list__row', 'data-style-id': id },
        h('span', { class: 'fp-list__main', style: stylePreviewCss(resolveStyle(app.styles, id)) }, styleName(app, id)),
        changed && isBuiltinStyle(id) ? h('span', { class: 'fp-chip fp-chip--muted' }, t('style.changed')) : null,
      )
      const act = (label: string, run: () => void, cls = 'fp-btn fp-btn--small') => {
        const b = h('button', { type: 'button', class: cls, 'data-style-action': label }, label)
        b.addEventListener('click', run)
        row.append(b)
      }
      act(t('style.modify'), () => {
        dlg.close()
        styleDialog(app, id)
      })
      if (isBuiltinStyle(id) && changed) {
        act(t('style.reset'), () => {
          const next = { ...app.styles }
          delete next[id]
          app.setDocAttrs({ styles: next })
          render()
        })
      }
      if (!isBuiltinStyle(id)) {
        act(
          t('style.delete'),
          () => {
            const next = { ...app.styles }
            delete next[id]
            for (const k of Object.keys(next)) {
              if (next[k].basedOn === id) next[k] = { ...next[k], basedOn: 'normal' }
              if (next[k].next === id) next[k] = { ...next[k], next: undefined }
            }
            // Les paragraphes de ce style reviennent à Normal, dans la même étape.
            const tr = app.state.tr.setDocAttribute('styles', pruneStyles(next))
            app.state.doc.descendants((node, pos) => {
              if (node.type === n.paragraph && node.attrs.style === id) tr.setNodeMarkup(pos, null, { ...node.attrs, style: null })
            })
            app.view.dispatch(tr)
            render()
          },
          'fp-btn fp-btn--small fp-btn--danger',
        )
      }
      list.append(row)
    }
  }
  render()
  const dlg = openDialog({
    name: 'styles',
    title: t('style.manage'),
    wide: true,
    body: [h('p', { class: 'fp-muted' }, t('style.manageHelp')), list],
    actions: [
      {
        label: t('style.new'),
        value: 'new',
        run: () => {
          dlg.close()
          styleDialog(app, null)
          return true
        },
      },
      { label: t('action.close'), value: 'close', primary: true },
    ],
  })
}

// --- thème ------------------------------------------------------------------------

export function applyThemePreset(app: FolioApp, name: string): void {
  app.setDocAttrs({ theme: presetOf(name) })
  app.focus()
}

export function themeDialog(app: FolioApp, part: 'colors' | 'fonts' | 'code'): void {
  const theme = cloneTheme(app.theme)
  const rows: HTMLElement[] = []
  const getters: (() => void)[] = []
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  if (part === 'colors' || part === 'code') {
    const keys = part === 'colors' ? THEME_COLORS : CODE_COLORS
    for (const k of keys) {
      const cur = part === 'colors' ? theme.colors[k as (typeof THEME_COLORS)[number]] : theme.code[k as (typeof CODE_COLORS)[number]]
      const el = input('color', cur, { 'data-theme-key': k })
      rows.push(field(t(`${part === 'colors' ? 'color' : 'codeColor'}.${k}` as Key), el))
      getters.push(() => {
        const v = parseColor(el.value, false)
        if (!v) return
        if (part === 'colors') theme.colors[k as (typeof THEME_COLORS)[number]] = v
        else theme.code[k as (typeof CODE_COLORS)[number]] = v
      })
    }
  } else {
    const suggestions = h('datalist', { id: 'fp-theme-font-list' }, ...[...EMBEDDED_FONTS, ...(app.state.doc.attrs.fonts as { family: string }[]).map((f) => f.family), 'Georgia', 'Arial', 'Times New Roman', 'system-ui'].map((f) => h('option', { value: f })))
    rows.push(suggestions)
    for (const k of THEME_FONTS) {
      const el = input('text', theme.fonts[k], { list: 'fp-theme-font-list', 'data-theme-key': k })
      rows.push(field(t(`font.theme.${k}` as Key), el))
      getters.push(() => {
        const v = el.value.trim()
        if (!isFontName(v) || THEME_FONTS.includes(v as (typeof THEME_FONTS)[number])) throw new Error(t('dialog.badFont'))
        theme.fonts[k] = v
      })
    }
  }
  const presets = select(Object.keys(THEME_PRESETS).map((p) => [p, t(`theme.${p}` as Key)] as [string, string]), hasOwn(THEME_PRESETS, theme.name) ? theme.name : 'folio', { 'data-field': 'theme-base' })
  openDialog({
    name: `theme-${part}`,
    title: t(`ribbon.${part === 'colors' ? 'themeColors' : part === 'fonts' ? 'themeFonts' : 'codeColors'}` as Key),
    wide: true,
    body: [h('p', { class: 'fp-muted' }, t('theme.help')), h('div', { class: 'fp-form fp-form--grid' }, ...rows), error],
    actions: [
      {
        label: t('theme.reset'),
        value: 'reset',
        run: () => {
          const base = presetOf(presets.value)
          app.setDocAttrs({ theme: { ...theme, name: app.theme.name, [part]: base[part] } })
          return true
        },
      },
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          try {
            for (const g of getters) g()
          } catch (e) {
            error.textContent = e instanceof Error ? e.message : String(e)
            return false
          }
          // Un thème modifié garde le nom de son modèle (la forme compacte l'écrit par différence).
          app.setDocAttrs({ theme })
          app.focus()
          return true
        },
      },
    ],
  })
}

// --- polices intégrées ------------------------------------------------------------

const FONT_FILE = /\.(woff2|woff|ttf|otf)$/i
const MAX_FONT_BYTES = 10 * 1024 * 1024

interface EditorFont {
  family: string
  src: string
  weight: number
  italic: boolean
  assetId: string | null
}

export function fontsManager(app: FolioApp): void {
  const list = h('ul', { class: 'fp-list', 'data-list': 'fonts' })
  const render = () => {
    list.replaceChildren()
    const fonts = app.state.doc.attrs.fonts as EditorFont[]
    if (!fonts.length) list.append(h('li', { class: 'fp-list__empty' }, t('fonts.none')))
    fonts.forEach((f, i) => {
      const del = h('button', { type: 'button', class: 'fp-btn fp-btn--small fp-btn--danger', 'data-font-delete': f.family }, t('style.delete'))
      del.addEventListener('click', () => {
        const next = fonts.filter((_, k) => k !== i)
        app.setDocAttrs({ fonts: next })
        render()
      })
      list.append(
        h(
          'li',
          { class: 'fp-list__row' },
          h('span', { class: 'fp-list__main', style: `font-family:"${f.family.replace(/"/g, '')}";font-weight:${f.weight};font-style:${f.italic ? 'italic' : 'normal'}` }, `${f.family} — ${f.weight}${f.italic ? ' italic' : ''}`),
          h('span', { class: 'fp-muted' }, `${Math.round(dataUriBytes(f.src) / 1024)} Ko`),
          del,
        ),
      )
    })
  }
  const file = h('input', { type: 'file', accept: '.woff2,.woff,.ttf,.otf', class: 'fp-input', 'data-field': 'font-file' }) as HTMLInputElement
  const family = input('text', '', { 'data-field': 'font-name', maxlength: '100' })
  const weight = select(['100', '200', '300', '400', '500', '600', '700', '800', '900'].map((w) => [w, w] as [string, string]), '400', { 'data-field': 'font-weight' })
  const italic = check(t('ribbon.italic'), false, { 'data-field': 'font-italic' })
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  file.addEventListener('change', () => {
    const f = file.files?.[0]
    if (f && !family.value) family.value = f.name.replace(FONT_FILE, '').replace(/[-_]+/g, ' ').replace(/\s+(regular|bold|italic|medium|light)$/i, '').trim().slice(0, 100)
  })
  render()
  openDialog({
    name: 'fonts',
    title: t('ribbon.embeddedFonts'),
    wide: true,
    body: [
      h('p', { class: 'fp-muted' }, t('fonts.help')),
      list,
      h('h3', { class: 'fp-form__title' }, t('fonts.add')),
      h('div', { class: 'fp-form fp-form--grid' }, field(t('fonts.file'), file), field(t('fonts.family'), family), field(t('fonts.weight'), weight)),
      italic.el,
      error,
    ],
    actions: [
      { label: t('action.close'), value: 'close' },
      {
        label: t('fonts.addButton'),
        value: 'add',
        primary: true,
        run: async () => {
          const f = file.files?.[0]
          const fam = family.value.trim()
          if (!f || !FONT_FILE.test(f.name)) {
            error.textContent = t('fonts.badFile')
            return false
          }
          if (f.size > MAX_FONT_BYTES) {
            error.textContent = t('fonts.tooLarge')
            return false
          }
          if (!isFontName(fam)) {
            error.textContent = t('dialog.badFont')
            return false
          }
          const ext = FONT_FILE.exec(f.name)![1].toLowerCase()
          const raw = await new Promise<string>((resolve, reject) => {
            const r = new FileReader()
            r.onload = () => resolve(String(r.result))
            r.onerror = () => reject(r.error)
            r.readAsDataURL(f)
          })
          const src = `data:font/${ext};base64,${raw.slice(raw.indexOf(',') + 1)}`
          const fonts = (app.state.doc.attrs.fonts as EditorFont[]).filter((x) => !(x.family === fam && x.weight === Number(weight.value) && x.italic === italic.box.checked))
          app.setDocAttrs({ fonts: [...fonts, { family: fam, src, weight: Number(weight.value), italic: italic.box.checked, assetId: null }] })
          file.value = ''
          family.value = ''
          error.textContent = ''
          render()
          toast(t('fonts.added', { name: fam }), { kind: 'success' })
          return false
        },
      },
    ],
  })
}

// --- propriétés ---------------------------------------------------------------------

export function propertiesDialog(app: FolioApp): void {
  const a = app.state.doc.attrs
  const title = input('text', a.title, { 'data-field': 'prop-title', maxlength: '500' })
  const author = input('text', a.author, { 'data-field': 'prop-author', maxlength: '300' })
  const subject = input('text', a.subject, { 'data-field': 'prop-subject', maxlength: '500' })
  const org = input('text', a.organization, { 'data-field': 'prop-organization', maxlength: '300' })
  const keywords = input('text', (a.keywords as string[]).join(', '), { 'data-field': 'prop-keywords' })
  const language = input('text', a.lang, { 'data-field': 'prop-lang', placeholder: 'fr, en-GB…', maxlength: '35' })
  const st = stats(app.state.doc)
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  openDialog({
    name: 'properties',
    title: t('ribbon.properties'),
    wide: true,
    focus: title,
    body: [
      h('div', { class: 'fp-form fp-form--grid' }, field(t('props.title'), title, t('props.titleHint')), field(t('props.author'), author), field(t('props.subject'), subject), field(t('props.organization'), org), field(t('props.keywords'), keywords, t('props.keywordsHint')), field(t('dialog.language'), language)),
      h(
        'p',
        { class: 'fp-muted' },
        t('props.stats', { words: st.words, chars: st.chars }),
        ' · ',
        t('props.created', { date: app.createdLabel() }),
      ),
      error,
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const l = language.value.trim()
          if (l && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(l)) {
            error.textContent = t('dialog.badLang')
            return false
          }
          app.setDocAttrs({
            title: title.value.trim().slice(0, 500),
            author: author.value.trim().slice(0, 300),
            subject: subject.value.trim().slice(0, 500),
            organization: org.value.trim().slice(0, 300),
            keywords: keywords.value
              .split(/[,;]/)
              .map((k) => k.trim().slice(0, 100))
              .filter(Boolean)
              .slice(0, 100),
            lang: l,
          })
          app.focus()
          return true
        },
      },
    ],
  })
}

// --- lien ---------------------------------------------------------------------------

export function linkDialog(app: FolioApp): void {
  const s = app.state
  const range = markRange(s, m.link)
  const current = (range?.mark.attrs.href as string | undefined) ?? (markValue(s, m.link, 'href') as string | null) ?? ''
  const href = input('text', current === 'mixed' ? '' : current, { 'data-field': 'href', placeholder: 'https://…', spellcheck: 'false' })
  const text = input('text', '', { 'data-field': 'link-text' })
  const needText = s.selection.empty && !range
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  const actions = [
    { label: t('action.cancel'), value: 'cancel' },
    {
      label: t('action.ok'),
      value: 'ok',
      primary: true,
      run: () => {
        let v = href.value.trim()
        if (!v) {
          error.textContent = t('link.empty')
          return false
        }
        // « exemple.org » : on ajoute https://
        if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) && !v.includes('@')) v = `https://${v}`
        else if (/^[^@\s]+@[^@\s]+\.\w+$/.test(v)) v = `mailto:${v}`
        if (!isSafeLink(v) || v.length > 2048) {
          error.textContent = t('link.unsafe')
          return false
        }
        app.run(setLink(v, needText ? text.value.trim() || undefined : undefined))
        return true
      },
    },
  ]
  if (current) actions.unshift({ label: t('link.remove'), value: 'remove', run: () => void app.run(setLink(null)) } as never)
  openDialog({
    name: 'link',
    title: current ? t('link.edit') : t('link.insert'),
    focus: href,
    body: [needText ? field(t('link.text'), text) : null, field(t('link.address'), href, t('link.hint')), error].filter(Boolean) as HTMLElement[],
    actions,
  })
}

// --- caractères spéciaux ------------------------------------------------------------

const COMMON_SYMBOLS = '« » “ ” ‘ ’ — – … • · ° ± × ÷ ≠ ≤ ≥ ≈ ∞ √ π Σ µ € £ $ ¥ © ® ™ § ¶ † ‡ → ← ↑ ↓ ⇒ ✓ ✗ ★ ½ ¼ ¾ ²'.split(' ')

const SYMBOL_GROUPS: Record<string, string> = {
  punctuation: '« » “ ” ‘ ’ „ ‹ › — – ‐ … • · ‣ ¡ ¿ § ¶ † ‡ ‰ ′ ″ ‖',
  spaces: '          ​ ‑ ­',
  currency: '€ £ $ ¥ ¢ ₣ ₤ ₩ ₪ ₫ ₭ ₱ ₹ ₺ ₽ ₿ ¤',
  math: '± × ÷ ≠ ≈ ≡ ≤ ≥ ≪ ≫ ∞ √ ∛ ∑ ∏ ∫ ∮ ∂ ∇ ∆ ∈ ∉ ⊂ ⊃ ⊆ ⊇ ∪ ∩ ∅ ∀ ∃ ¬ ∧ ∨ ⊕ ⊗ ∝ ° ′ ″ ‰ ½ ⅓ ⅔ ¼ ¾ ⅛ ¹ ² ³ ⁿ',
  greek: 'α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ τ υ φ χ ψ ω Α Β Γ Δ Ε Ζ Η Θ Ι Κ Λ Μ Ν Ξ Ο Π Ρ Σ Τ Υ Φ Χ Ψ Ω',
  arrows: '← → ↑ ↓ ↔ ↕ ⇐ ⇒ ⇑ ⇓ ⇔ ↖ ↗ ↘ ↙ ↩ ↪ ⟶ ⟵ ⟹ ➔ ➜ ➤',
  symbols: '© ® ™ ℗ ℠ ✓ ✔ ✗ ✘ ★ ☆ ♠ ♣ ♥ ♦ ☐ ☑ ☒ ☎ ✉ ✂ ✎ ⌘ ⌥ ⇧ ⌫ ⏎ ♪ ♫ ☀ ☁ ☂ ☃ ☕ ⚠ ⚡',
  accents: 'À Â Ä Æ Ç É È Ê Ë Î Ï Ô Œ Ù Û Ü Ÿ à â ä æ ç é è ê ë î ï ô œ ù û ü ÿ Ñ ñ ß Ø ø Å å',
}

const SPACE_NAMES: Record<string, Key> = {
  ' ': 'symbol.nbsp',
  ' ': 'symbol.nnbsp',
  ' ': 'symbol.thin',
  ' ': 'symbol.en',
  ' ': 'symbol.em',
  '​': 'symbol.zwsp',
  '‑': 'symbol.nbhyphen',
  '­': 'symbol.shy',
}

function symbolButton(ch: string, onPick: (c: string) => void): HTMLButtonElement {
  const label = SPACE_NAMES[ch] ? t(SPACE_NAMES[ch]) : `${ch} U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
  const b = h('button', { type: 'button', class: 'fp-symbol' + (SPACE_NAMES[ch] ? ' is-space' : ''), 'data-pop-item': '', 'data-symbol': ch, title: label, 'aria-label': label }, SPACE_NAMES[ch] ? `⎵${t(SPACE_NAMES[ch]).slice(0, 1)}` : ch)
  b.addEventListener('click', () => onPick(ch))
  return b
}

export function symbolPicker(app: FolioApp): HTMLElement {
  const insert = (c: string) => {
    closePopovers()
    app.run(insertText(c))
  }
  return h(
    'div',
    { class: 'fp-symbols' },
    h('div', { class: 'fp-symbols__grid' }, ...COMMON_SYMBOLS.map((c) => symbolButton(c, insert))),
    popItem(t('symbol.more'), () => symbolsDialog(app)),
  )
}

export function symbolsDialog(app: FolioApp): void {
  const tabs = h('div', { class: 'fp-symbols__tabs', role: 'tablist' })
  const grid = h('div', { class: 'fp-symbols__grid fp-symbols__grid--large' })
  const insert = (c: string) => app.run(insertText(c), false)
  const show = (group: string) => {
    grid.replaceChildren(...SYMBOL_GROUPS[group].split(' ').filter(Boolean).map((c) => symbolButton(c, insert)))
    for (const b of tabs.children) b.setAttribute('aria-selected', String((b as HTMLElement).dataset.group === group))
  }
  for (const g of Object.keys(SYMBOL_GROUPS)) {
    const b = h('button', { type: 'button', class: 'fp-tab', role: 'tab', 'data-group': g }, t(`symbol.group.${g}` as Key))
    b.addEventListener('click', () => show(g))
    tabs.append(b)
  }
  const code = input('text', '', { 'data-field': 'codepoint', placeholder: 'U+00E9, 233…', spellcheck: 'false' })
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  show('punctuation')
  openDialog({
    name: 'symbols',
    title: t('symbol.title'),
    wide: true,
    body: [tabs, grid, field(t('symbol.code'), code), error],
    actions: [
      {
        label: t('symbol.insertCode'),
        value: 'code',
        run: () => {
          const v = code.value.trim().replace(/^(U\+|0x|&#x?)/i, '')
          const cp = /^[0-9a-f]+$/i.test(v) ? parseInt(v, /^(U\+|0x)/i.test(code.value.trim()) || /[a-f]/i.test(v) ? 16 : 10) : NaN
          if (!Number.isFinite(cp) || cp < 0x20 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || (cp >= 0x7f && cp < 0xa0)) {
            error.textContent = t('symbol.badCode')
            return false
          }
          insert(String.fromCodePoint(cp))
          error.textContent = ''
          return false
        },
      },
      { label: t('action.close'), value: 'close', primary: true },
    ],
  })
}

// --- date et heure --------------------------------------------------------------------

const DATE_FORMATS = ['', 'DD/MM/YYYY', 'D MMMM YYYY', 'dddd D MMMM YYYY', 'YYYY-MM-DD', 'MMMM YYYY', 'DD/MM/YYYY HH:mm', 'HH:mm', 'HH:mm:ss']

export function dateTimeDialog(app: FolioApp): void {
  const now = new Date()
  const loc = app.state.doc.attrs.lang || lang()
  const options = DATE_FORMATS.map((f) => {
    let label: string
    if (!f) label = new Intl.DateTimeFormat(loc, { dateStyle: 'long' }).format(now)
    else label = formatWithPattern(now, f, loc)
    return [f, label] as [string, string]
  })
  const list = select(options, '', { 'data-field': 'date-format', size: String(options.length) })
  const live = check(t('date.live'), true, { 'data-field': 'date-live' })
  openDialog({
    name: 'date-time',
    title: t('ribbon.dateTime'),
    focus: list,
    body: [field(t('date.format'), list), live.el, h('p', { class: 'fp-muted' }, t('date.help'))],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.insert'),
        value: 'insert',
        primary: true,
        run: () => {
          const f = list.value
          const isTime = f === 'HH:mm' || f === 'HH:mm:ss'
          if (live.box.checked) app.run(insertField(isTime ? 'time' : 'date', f))
          else app.run(insertText(options.find((o) => o[0] === f)![1]))
          return true
        },
      },
    ],
  })
}

// --- tableaux ---------------------------------------------------------------------

export function tableGridPicker(onPick: (rows: number, cols: number) => void, onMore: () => void): HTMLElement {
  const R = 8
  const C = 10
  const label = h('div', { class: 'fp-grid-picker__label' }, t('table.pick'))
  const grid = h('div', { class: 'fp-grid-picker__grid', style: `grid-template-columns:repeat(${C}, 1fr)` })
  const cells: HTMLElement[] = []
  const mark = (r: number, c: number) => {
    cells.forEach((el, i) => el.classList.toggle('is-on', Math.floor(i / C) < r && i % C < c))
    label.textContent = t('table.size', { rows: r, cols: c })
  }
  for (let r = 1; r <= R; r++) {
    for (let c = 1; c <= C; c++) {
      const b = h('button', { type: 'button', class: 'fp-grid-picker__cell', 'data-rows': String(r), 'data-cols': String(c), 'aria-label': t('table.size', { rows: r, cols: c }) })
      b.addEventListener('pointerenter', () => mark(r, c))
      b.addEventListener('focus', () => mark(r, c))
      b.addEventListener('click', () => {
        closePopovers()
        onPick(r, c)
      })
      cells.push(b)
      grid.append(b)
    }
  }
  return h('div', { class: 'fp-grid-picker' }, label, grid, popItem(t('table.insertDialog'), onMore))
}

export function insertTableDialog(app: FolioApp): void {
  const rows = input('number', 3, { min: '1', max: '100', 'data-field': 'rows' })
  const cols = input('number', 3, { min: '1', max: '30', 'data-field': 'cols' })
  const header = check(t('table.headerRow'), true, { 'data-field': 'header' })
  openDialog({
    name: 'insert-table',
    title: t('table.insertDialog'),
    focus: rows,
    body: [h('div', { class: 'fp-form fp-form--grid' }, field(t('table.rows'), rows), field(t('table.cols'), cols)), header.el],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.insert'),
        value: 'insert',
        primary: true,
        run: async () => {
          const r = Math.floor(Number(rows.value))
          const c = Math.floor(Number(cols.value))
          if (!(r >= 1 && r <= 100 && c >= 1 && c <= 30)) return false
          const { insertTable } = await import('../editor/commands')
          app.run(insertTable(r, c, header.box.checked))
          return true
        },
      },
    ],
  })
}

export function tableHasHeader(app: FolioApp): boolean {
  const tb = tableAt(app.state)
  return !!tb && tb.node.firstChild?.firstChild?.type === n.table_header
}

export function notInColumns(): void {
  toast(t('columns.notIn'), { kind: 'info' })
}

export function tableSortFailed(): void {
  toast(t('table.sortMerged'), { kind: 'warning' })
}

/** Colonnes de même largeur, sur la largeur actuelle du tableau. */
export function distributeColumns(app: FolioApp): void {
  const tb = tableAt(app.state)
  if (!tb) return
  const map = TableMap.get(tb.node)
  const dom = app.view.nodeDOM(tb.pos) as HTMLElement | null
  const table = dom?.querySelector('table') ?? (dom as HTMLTableElement | null)
  const total = table ? table.getBoundingClientRect().width / (settings().zoom || 1) : map.width * 120
  const each = Math.max(36, Math.floor(total / map.width))
  const tr = app.state.tr
  tb.node.descendants((cell, pos) => {
    if (cell.type !== n.table_cell && cell.type !== n.table_header) return true
    tr.setNodeMarkup(tb.pos + 1 + pos, null, { ...cell.attrs, colwidth: Array(cell.attrs.colspan).fill(each) })
    return false
  })
  app.view.dispatch(tr)
  app.focus()
}

// --- images ---------------------------------------------------------------------------

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const el = h('input', { type: 'file', accept, class: 'fp-offscreen', 'data-folio-transient': '' }) as HTMLInputElement
    el.addEventListener('change', () => {
      resolve(el.files?.[0] ?? null)
      el.remove()
    })
    el.addEventListener('cancel', () => {
      resolve(null)
      el.remove()
    })
    document.body.append(el)
    el.click()
  })
}

export const imageHooks = () => ({ reduceImages: () => settings().reduceImages, onImageError: (r: string) => toast(t(r === 'too-large' ? 'image.tooLarge' : 'image.unreadable'), { kind: 'error' }) })

export async function pickImage(app: FolioApp, replace = false): Promise<void> {
  const fig = replace ? figureAt(app.state) : null
  const file = await pickFile('image/*')
  if (!file) return
  if (!fig) {
    await insertImageFiles(app.view, [file], imageHooks())
    return
  }
  try {
    const img = await prepareFile(file, settings().reduceImages)
    const cur = app.state.doc.nodeAt(fig.pos)
    if (!cur || cur.type !== n.figure) return
    app.view.dispatch(app.state.tr.setNodeMarkup(fig.pos, null, { ...cur.attrs, src: img.src, assetId: null, crop: null }))
  } catch (e) {
    imageHooks().onImageError(e instanceof Error ? e.message : String(e))
  }
}

export function toggleFlip(cur: string | null, axis: 'h' | 'v'): string | null {
  const h = cur === 'h' || cur === 'hv'
  const v = cur === 'v' || cur === 'hv'
  const nh = axis === 'h' ? !h : h
  const nv = axis === 'v' ? !v : v
  return nh && nv ? 'hv' : nh ? 'h' : nv ? 'v' : null
}

export function renderedWidthPt(app: FolioApp, pos: number): number {
  const dom = app.view.nodeDOM(pos) as HTMLElement | null
  const frame = dom?.querySelector('.fp-figure__frame') as HTMLElement | null
  return frame ? Math.round((frame.getBoundingClientRect().width / (settings().zoom || 1)) * 0.75) : 0
}

export function textWidthPt(app: FolioApp): number {
  const style = getComputedStyle(app.view.dom)
  const w = app.view.dom.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  return Math.round(w * 0.75 * 2) / 2
}

export function altTextDialog(app: FolioApp): void {
  const fig = figureAt(app.state)
  if (!fig) return
  const alt = h('textarea', { class: 'fp-input', rows: '3', maxlength: '2000', 'data-field': 'alt' }) as HTMLTextAreaElement
  alt.value = fig.node.attrs.alt
  openDialog({
    name: 'alt-text',
    title: t('image.alt'),
    focus: alt,
    body: [h('p', { class: 'fp-muted' }, t('image.altHelp')), alt],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      { label: t('action.ok'), value: 'ok', primary: true, run: () => void app.run(setFigureAttrs({ alt: alt.value.trim().slice(0, 2000) })) },
    ],
  })
}

/**
 * Rogner (Format de l'image → Rogner, menu contextuel) : à la souris, sur
 * l'image elle-même. Une image tournée ou retournée passe par la fenêtre
 * « Taille et rognage » (les poignées y seraient trompeuses).
 */
export function startCrop(app: FolioApp): void {
  const fig = figureAt(app.state)
  if (!fig) return
  if (!String(fig.node.attrs.src).startsWith('data:')) {
    toast(t('image.cropUnavailable'), { kind: 'info' })
    return
  }
  if (fig.node.attrs.rotate || fig.node.attrs.flip) return cropDialog(app)
  const dom = app.view.nodeDOM(fig.pos) as HTMLElement | null
  dom?.dispatchEvent(new CustomEvent('fp-crop'))
}

export function cropDialog(app: FolioApp): void {
  const fig = figureAt(app.state)
  if (!fig) return
  if (!String(fig.node.attrs.src).startsWith('data:')) {
    toast(t('image.cropUnavailable'), { kind: 'info' })
    return
  }
  const crop = { top: 0, right: 0, bottom: 0, left: 0, ...(fig.node.attrs.crop ?? {}) }
  const img = h('img', { src: fig.node.attrs.src, alt: '', class: 'fp-crop__img' }) as HTMLImageElement
  const shade = h('div', { class: 'fp-crop__keep' })
  const preview = h('div', { class: 'fp-crop' }, img, shade)
  const sync = () => {
    shade.style.inset = `${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%`
  }
  const sliders = (['top', 'right', 'bottom', 'left'] as const).map((side) => {
    const el = input('range', crop[side], { min: '0', max: '90', step: '0.5', 'data-crop': side })
    el.addEventListener('input', () => {
      const other = side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : side === 'left' ? 'right' : 'left'
      crop[side] = Math.min(Number(el.value), 90 - crop[other])
      el.value = String(crop[side])
      sync()
    })
    return field(t(`image.cropSide.${side}` as Key), el)
  })
  sync()
  openDialog({
    name: 'crop',
    title: t('image.crop'),
    wide: true,
    body: [preview, h('div', { class: 'fp-form fp-form--grid' }, ...sliders)],
    actions: [
      { label: t('image.cropReset'), value: 'reset', run: () => void app.run(setFigureAttrs({ crop: null })) },
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const any = crop.top || crop.right || crop.bottom || crop.left
          app.run(setFigureAttrs({ crop: any ? { ...crop } : null }))
          return true
        },
      },
    ],
  })
}

export function focusCaption(app: FolioApp): void {
  const fig = figureAt(app.state)
  if (!fig) return
  const end = fig.pos + 1 + fig.node.content.size
  app.view.dispatch(app.state.tr.setSelection(TextSelection.create(app.state.doc, end)).scrollIntoView())
  app.focus()
}

/** Réduit les images du document qui peuvent l'être ; affiche le gain. */
export async function compressImages(app: FolioApp): Promise<void> {
  const figures: { pos: number; node: PMNode }[] = []
  app.state.doc.descendants((node, pos) => {
    if (node.type === n.figure && String(node.attrs.src).startsWith('data:')) figures.push({ pos, node })
  })
  if (!figures.length) {
    toast(t('image.compressNone'), { kind: 'info' })
    return
  }
  const doc = app.state.doc
  let before = 0
  let after = 0
  const results = new Map<string, string>()
  for (const f of figures) {
    const src = f.node.attrs.src as string
    if (results.has(src)) continue
    const out = await prepareImage(src, true).catch(() => null)
    results.set(src, out && out.after < out.before ? out.src : src)
    before += dataUriBytes(src)
    after += dataUriBytes(results.get(src)!)
  }
  if (app.state.doc !== doc) {
    toast(t('image.compressChanged'), { kind: 'warning' })
    return
  }
  const tr: Transaction = app.state.tr
  for (const f of figures) {
    const src = results.get(f.node.attrs.src)!
    if (src !== f.node.attrs.src) tr.setNodeMarkup(f.pos, null, { ...f.node.attrs, src, assetId: null })
  }
  if (tr.docChanged) app.view.dispatch(tr)
  const kb = (b: number) => (b > 1024 * 1024 ? `${fmt(b / 1024 / 1024, 1)} Mo` : `${Math.round(b / 1024)} Ko`)
  toast(after < before ? t('image.compressed', { before: kb(before), after: kb(after), gain: Math.round((1 - after / before) * 100) }) : t('image.compressNoGain'), { kind: after < before ? 'success' : 'info', timeout: 8000 })
}

// --- statistiques, raccourcis -----------------------------------------------------------

export function wordCountDialog(app: FolioApp): void {
  const all = stats(app.state.doc)
  const { from, to, empty } = app.state.selection
  const sel = empty ? null : stats(app.state.doc, from, to)
  const row = (label: string, v: number, s?: number) => h('tr', {}, h('th', { scope: 'row' }, label), h('td', { 'data-stat': label }, String(v)), sel ? h('td', {}, String(s ?? 0)) : null)
  const table = h(
    'table',
    { class: 'fp-stats' },
    h('thead', {}, h('tr', {}, h('td'), h('th', { scope: 'col' }, t('stats.document')), sel ? h('th', { scope: 'col' }, t('stats.selection')) : null)),
    h('tbody', {}, row(t('stats.words'), all.words, sel?.words), row(t('stats.chars'), all.chars, sel?.chars), row(t('stats.charsNoSpaces'), all.charsNoSpaces, sel?.charsNoSpaces), row(t('stats.paragraphs'), all.paragraphs, sel?.paragraphs)),
  )
  // Les notes ne comptent pas dans le texte ; leurs mots à part.
  const notes = collectNotes(app.state.doc)
  if (notes.length) {
    const inNotes = notes.reduce((s, r) => s + countWords(noteText(r.node.attrs.blocks as Block[])), 0)
    table.querySelector('tbody')!.append(h('tr', {}, h('th', { scope: 'row' }, t('stats.noteWords')), h('td', { 'data-stat': 'notes' }, String(inNotes)), sel ? h('td') : null))
  }
  openDialog({ name: 'word-count', title: t('ribbon.wordCount'), body: [table], actions: [{ label: t('action.close'), value: 'close', primary: true }] })
}

export function shortcutsDialog(): void {
  const mod = isMac() ? '⌘' : 'Ctrl'
  const shift = t('key.shift')
  const groups: [Key, [string, Key][]][] = [
    ['shortcuts.text', [[`${mod}+B`, 'ribbon.bold'], [`${mod}+I`, 'ribbon.italic'], [`${mod}+U`, 'ribbon.underline'], [`${mod}+${shift}+X`, 'ribbon.strike'], [`${mod}+.`, 'ribbon.sup'], [`${mod}+,`, 'ribbon.sub'], [`${mod}+${shift}+>`, 'ribbon.grow'], [`${mod}+${shift}+<`, 'ribbon.shrink'], [`${shift}+F3`, 'ribbon.case'], [`${mod}+\\`, 'ribbon.clear'], [`${mod}+K`, 'ribbon.link']]],
    ['shortcuts.paragraph', [[`${mod}+Alt+1…6`, 'shortcuts.headings'], [`${mod}+Alt+0`, 'style.normal'], [`${mod}+${shift}+L / E / R / J`, 'shortcuts.align'], [`${mod}+${shift}+8`, 'ribbon.bullets'], [`${mod}+${shift}+7`, 'ribbon.numbers'], ['Tab / ' + `${shift}+Tab`, 'shortcuts.listLevel'], [`${shift}+${t('key.enter')}`, 'shortcuts.lineBreak'], [`${mod}+${t('key.enter')}`, 'ribbon.pageBreak'], [`${mod}+Alt+F`, 'note.insertFoot'], [`${mod}+Alt+D`, 'note.insertEnd'], ['Alt+=', 'ribbon.equation'], ['$…$ · $$…$$', 'shortcuts.mathTyping']]],
    ['shortcuts.editing', [[`${mod}+Z`, 'menu.undo'], [`${mod}+Y`, 'menu.redo'], [`${mod}+F`, 'menu.find'], [`${mod}+H`, 'menu.replace'], [`${mod}+${shift}+V`, 'menu.pastePlain'], [`${mod}+Alt+C / V`, 'ribbon.painter'], [`${mod}+S`, 'menu.save'], [`${mod}+O`, 'open.menu'], [`${mod}+Alt+M`, 'comment.new'], [`${mod}+0`, 'shortcuts.zoomReset'], [`${mod}+${t('key.wheel')}`, 'ribbon.zoom'], [`${mod}+${t('shortcuts.click')}`, 'ctx.openLink'], [`${shift}+F10`, 'ctx.label'], ['F1 · ?', 'menu.shortcuts']]],
  ]
  const tips: Key[] = ['tips.markdown', 'tips.fields', 'tips.escape', 'tips.styles', 'tips.images', 'tips.ai', 'tips.math', 'tips.contextMenu']
  openDialog({
    name: 'shortcuts',
    title: t('menu.shortcuts'),
    wide: true,
    body: [
      h(
        'div',
        { class: 'fp-shortcuts' },
        ...groups.map(([title, rows]) =>
          h('section', {}, h('h3', { class: 'fp-form__title' }, t(title)), h('dl', { class: 'fp-keys' }, ...rows.flatMap(([k, label]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, t(label))]))),
        ),
      ),
      h('h3', { class: 'fp-form__title' }, t('shortcuts.tips')),
      h('ul', { class: 'fp-tips' }, ...tips.map((k) => h('li', {}, t(k)))),
    ],
    actions: [{ label: t('action.close'), value: 'close', primary: true }],
  })
}

// --- recherche -----------------------------------------------------------------------

let findHost: HTMLElement | null = null
export function setFindHost(el: HTMLElement): void {
  findHost = el
}

export function openFind(app: FolioApp, replace: boolean, highlighted = false): void {
  if (findHost) openFindBar(app, findHost, replace, highlighted)
}

// --- zoom ----------------------------------------------------------------------------

let applyZoom: (z: number) => void = () => undefined
let fitter: () => number = () => 1
let pageFitter: () => number = () => 1

export function setZoomHandlers(apply: (z: number) => void, fit: () => number, fitOne: () => number = fit): void {
  applyZoom = apply
  fitter = fit
  pageFitter = fitOne
}

export function setZoom(z: number): void {
  const v = Math.min(4, Math.max(0.25, Math.round(z * 100) / 100))
  updateSettings({ zoom: v })
  applyZoom(v)
}

export const zoomBy = (d: number) => setZoom(settings().zoom + d)
export const fitWidth = () => setZoom(fitter())
/** Une page entière dans la fenêtre (Affichage → Zoom → Une page). */
export const fitPage = () => setZoom(Math.min(fitter(), pageFitter()))

// --- mise en page ---------------------------------------------------------------

let navPane: import('./navpane').NavPane | null = null
export function setNavPane(v: import('./navpane').NavPane): void {
  navPane = v
}
export const getNavPane = () => navPane

let commentsPane: import('./comments').CommentsPane | null = null
export function setCommentsPane(v: import('./comments').CommentsPane): void {
  commentsPane = v
}
export const getCommentsPane = () => commentsPane

/** Changer le nom affiché avec ses commentaires. */
export function authorNameDialog(): void {
  const nameInput = input('text', settings().authorName, { 'data-field': 'author-name', maxlength: '100' })
  openDialog({
    name: 'author-name',
    title: t('comment.whoTitle'),
    body: [field(t('comment.who'), nameInput), h('p', { class: 'fp-muted' }, t('comment.whoHelp'))],
    focus: nameInput,
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const name = nameInput.value.trim().slice(0, 100)
          if (!name) return false
          updateSettings({ authorName: name })
          return true
        },
      },
    ],
  })
}

let pageView: import('../layout/pageview').PageView | null = null
export function setPageView(v: import('../layout/pageview').PageView): void {
  pageView = v
}
export const getPageView = () => pageView

export const pageSetup = (app: FolioApp): PageSetup => app.state.doc.attrs.page as PageSetup

/** Le dernier saut de section avant le curseur qui fixe sa propre mise en page (format, orientation, marges). */
export function ownSectionAt(app: FolioApp, at = app.state.selection.from): { node: import('prosemirror-model').Node; pos: number } | null {
  let found: { node: import('prosemirror-model').Node; pos: number } | null = null
  app.state.doc.forEach((node, pos) => {
    if (node.type.name === 'section_break' && pos < at && node.attrs.page) found = { node, pos }
  })
  return found
}

/** Mise en page de la section du curseur : celle du document, modifiée par les sauts de section qui le précèdent. */
export function effectivePage(app: FolioApp): PageSetup {
  const own = ownSectionAt(app)
  const base = pageSetup(app)
  return own ? { ...base, ...(own.node.attrs.page as Partial<PageSetup>) } : base
}

const PAPER_KEYS = ['size', 'width', 'height', 'orientation', 'margins'] as const

/**
 * Change la mise en page (bornée comme à l'ouverture d'un document), en une
 * étape annulable. Le format, l'orientation et les marges vont à la section du
 * curseur quand elle a sa propre mise en page ; le reste, au document.
 */
export function setPage(app: FolioApp, patch: Partial<PageSetup>, scope: 'auto' | 'doc' | 'section' | 'forward' = 'auto'): void {
  const own = ownSectionAt(app)
  const paperPatch = PAPER_KEYS.some((k) => k in patch)
  const where = scope === 'auto' ? (own && paperPatch ? 'section' : 'doc') : scope
  if (where === 'doc') {
    const merged = { ...pageSetup(app), ...patch } as PageSetup
    const page = normalizePage(merged as unknown as Record<string, unknown>, new Report())
    app.run((state, dispatch) => {
      let tr = state.tr.setDocAttribute('page', page)
      // « Tout le document » : les sections reprennent le format du document.
      if (scope === 'doc' && paperPatch) {
        state.doc.forEach((node, pos) => {
          if (node.type.name === 'section_break' && node.attrs.page) tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, page: null })
        })
      }
      dispatch?.(tr)
      return true
    })
    app.focus()
    return
  }
  const merged = normalizePage({ ...effectivePage(app), ...patch } as unknown as Record<string, unknown>, new Report())
  const sectionPage = { size: merged.size, width: merged.width, height: merged.height, orientation: merged.orientation, margins: { ...merged.margins } }
  const rest = Object.fromEntries(Object.entries(patch).filter(([k]) => !(PAPER_KEYS as readonly string[]).includes(k))) as Partial<PageSetup>
  app.run((state, dispatch) => {
    let tr = state.tr
    if (Object.keys(rest).length) tr = tr.setDocAttribute('page', normalizePage({ ...pageSetup(app), ...rest } as unknown as Record<string, unknown>, new Report()))
    if (where === 'section' && own) tr = tr.setNodeMarkup(own.pos, undefined, { ...own.node.attrs, page: sectionPage })
    else {
      // « À partir d'ici » : un saut de section avant le paragraphe du curseur, avec ce format.
      const $from = state.selection.$from
      const at = $from.depth > 0 ? $from.before(1) : $from.pos
      tr = tr.insert(at, state.schema.nodes.section_break.create({ start: 'page', page: sectionPage }))
    }
    dispatch?.(tr.scrollIntoView())
    return true
  })
  app.focus()
}

export const MARGIN_PRESETS: Record<string, PageSetup['margins']> = {
  normal: { top: 25, right: 22, bottom: 25, left: 22 },
  narrow: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
  moderate: { top: 25.4, right: 19.05, bottom: 25.4, left: 19.05 },
  wide: { top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 },
}

/** Numéro de page dans l'en-tête ou le pied de page (remplace celui de toutes les pages). */
export function insertPageNumber(app: FolioApp, where: 'headers' | 'footers', align: 'left' | 'center' | 'right', ofPages = false): void {
  const set = app.state.doc.attrs[where] as HeaderSet
  const content: Inline[] = ofPages
    ? [{ text: `${t('pages.word')} ` }, { type: 'field', name: 'page', format: '' }, { text: ` ${t('pages.of')} ` }, { type: 'field', name: 'pages', format: '' }]
    : [{ type: 'field', name: 'page', format: '' }]
  const para = { type: 'paragraph', content, ...(align !== 'left' ? { align } : {}) } as Block
  app.setDocAttrs({ [where]: { ...set, default: [para] } })
  app.focus()
}

export function removePageNumbers(app: FolioApp): void {
  const strip = (blocks: Block[]) => blocks.filter((b) => !(b.type === 'paragraph' && b.content.some((x) => 'type' in x && x.type === 'field' && (x.name === 'page' || x.name === 'pages'))))
  const fix = (set: HeaderSet): HeaderSet => ({ default: strip(set.default), first: strip(set.first), even: strip(set.even) })
  const a = app.state.doc.attrs
  app.setDocAttrs({ headers: fix(a.headers as HeaderSet), footers: fix(a.footers as HeaderSet) })
}

const mmToCm = (mm: number) => fmt(mm / 10)
const cmToMm = (v: string): number | null => {
  const x = num(v)
  return x === null ? null : Math.round(x * 100) / 10
}

export function pageSetupDialog(app: FolioApp): void {
  const p = effectivePage(app)
  const own = ownSectionAt(app)
  const applyTo = select(
    [
      ...(own ? [['section', t('page.applySection')] as [string, string]] : []),
      ['doc', t('page.applyDoc')],
      ['forward', t('page.applyForward')],
    ],
    own ? 'section' : 'doc',
    { 'data-field': 'apply-to' },
  )
  const sizes = [...Object.keys(PAPER_SIZES), 'custom']
  const size = select(sizes.map((s) => [s, s === 'custom' ? t('page.custom') : `${s} (${PAPER_SIZES[s][0]} × ${PAPER_SIZES[s][1]} mm)`] as [string, string]), p.size, { 'data-field': 'size' })
  const width = input('text', mmToCm(p.width), { 'data-field': 'width', inputmode: 'decimal' })
  const height = input('text', mmToCm(p.height), { 'data-field': 'height', inputmode: 'decimal' })
  const syncCustom = () => {
    const custom = size.value === 'custom'
    width.disabled = height.disabled = !custom
    if (!custom) {
      width.value = mmToCm(PAPER_SIZES[size.value][0])
      height.value = mmToCm(PAPER_SIZES[size.value][1])
    }
  }
  size.addEventListener('change', syncCustom)
  syncCustom()
  const orientation = select([['portrait', t('page.portrait')], ['landscape', t('page.landscape')]], p.orientation, { 'data-field': 'orientation' })
  const margin = (k: keyof PageSetup['margins']) => input('text', mmToCm(p.margins[k]), { 'data-field': `margin-${k}`, inputmode: 'decimal' })
  const mt = margin('top')
  const mr = margin('right')
  const mb = margin('bottom')
  const ml = margin('left')
  const hd = input('text', mmToCm(p.header), { 'data-field': 'header-distance', inputmode: 'decimal' })
  const fd = input('text', mmToCm(p.footer), { 'data-field': 'footer-distance', inputmode: 'decimal' })
  const first = check(t('page.firstPage'), p.firstPage, { 'data-field': 'first-page' })
  const evenOdd = check(t('page.evenOdd'), p.evenOdd, { 'data-field': 'even-odd' })
  const start = input('number', p.numberStart, { 'data-field': 'number-start', min: '0', max: '100000' })
  const format = select(PAGE_NUMBER_FORMATS.map((f) => [f, `${pageLabelPreview(f)}`] as [string, string]), p.numberFormat, { 'data-field': 'number-format' })
  const bg = colorInput(app, p.background ?? null, 'page-color')
  const border = colorInput(app, p.border ?? null, 'page-border')
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  openDialog({
    name: 'page-setup',
    title: t('page.setup'),
    wide: true,
    body: [
      h('h3', { class: 'fp-form__title' }, t('page.paper')),
      h('div', { class: 'fp-form fp-form--grid' }, field(t('page.size'), size), field(t('page.width'), width, t('dialog.inCm')), field(t('page.height'), height, t('dialog.inCm')), field(t('page.orientation'), orientation)),
      h('h3', { class: 'fp-form__title' }, t('page.margins')),
      h('div', { class: 'fp-form fp-form--grid' }, field(t('page.top'), mt, t('dialog.inCm')), field(t('page.bottom'), mb, t('dialog.inCm')), field(t('page.left'), ml, t('dialog.inCm')), field(t('page.right'), mr, t('dialog.inCm'))),
      h('h3', { class: 'fp-form__title' }, t('page.headersFooters')),
      h('div', { class: 'fp-form fp-form--grid' }, field(t('page.headerDistance'), hd, t('dialog.inCm')), field(t('page.footerDistance'), fd, t('dialog.inCm')), field(t('page.numberStart'), start), field(t('page.numberFormat'), format)),
      h('div', { class: 'fp-checks' }, first.el, evenOdd.el),
      h('h3', { class: 'fp-form__title' }, t('page.background')),
      h('div', { class: 'fp-form fp-form--grid' }, field(t('page.color'), bg.el), field(t('page.border'), border.el)),
      h('div', { class: 'fp-form fp-form--grid' }, field(t('page.applyTo'), applyTo, t('page.applyHint'))),
      error,
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const vals = [width, height, mt, mr, mb, ml, hd, fd].map((el) => cmToMm(el.value))
          if (vals.some((v) => v === null || v < 0)) {
            error.textContent = t('dialog.badNumber')
            return false
          }
          const [w, hh, top, right, bottom, left, header, footer] = vals as number[]
          const n = Math.floor(Number(start.value))
          if (!Number.isFinite(n) || n < 0 || n > 100000) {
            error.textContent = t('dialog.badNumber')
            return false
          }
          setPage(app, {
            size: size.value,
            width: Math.min(1200, Math.max(50, w)),
            height: Math.min(1200, Math.max(50, hh)),
            orientation: orientation.value as PageSetup['orientation'],
            margins: { top: Math.min(300, top), right: Math.min(300, right), bottom: Math.min(300, bottom), left: Math.min(300, left) },
            header: Math.min(200, header),
            footer: Math.min(200, footer),
            firstPage: first.box.checked,
            evenOdd: evenOdd.box.checked,
            numberStart: n,
            numberFormat: format.value as PageSetup['numberFormat'],
            background: bg.value() ?? undefined,
            border: border.value() ?? undefined,
          }, applyTo.value as 'doc' | 'section' | 'forward')
          return true
        },
      },
    ],
  })
}

function pageLabelPreview(f: string): string {
  return [1, 2, 3].map((n) => pageLabel(n, f)).join(', ') + '…'
}

/** Réglages de la section du curseur (la première section se règle dans la mise en page). */
export function sectionDialog(app: FolioApp): void {
  const sec = sectionBreakAt(app.state)
  if (!sec) {
    toast(t('section.first'), { kind: 'info', timeout: 7000 })
    pageSetupDialog(app)
    return
  }
  const a = sec.node.attrs
  const start = select((['page', 'odd', 'even'] as const).map((s) => [s, t(`section.start.${s}` as Key)] as [string, string]), a.start, { 'data-field': 'section-start' })
  const restart = check(t('section.restart'), a.numberStart !== null, { 'data-field': 'section-restart' })
  const at = input('number', a.numberStart ?? 1, { 'data-field': 'section-number', min: '0', max: '100000' })
  const format = select([['', t('section.sameFormat')], ...PAGE_NUMBER_FORMATS.map((f) => [f, pageLabelPreview(f)] as [string, string])], a.numberFormat ?? '', { 'data-field': 'section-format' })
  const first = select([['', t('section.sameFirst')], ['yes', t('style.yes')], ['no', t('style.no')]], a.firstPage === null ? '' : a.firstPage ? 'yes' : 'no', { 'data-field': 'section-first' })
  const linked = check(t('section.linked'), a.headers === null && a.footers === null, { 'data-field': 'section-linked' })
  openDialog({
    name: 'section',
    title: t('section.options'),
    body: [h('div', { class: 'fp-form fp-form--grid' }, field(t('section.startLabel'), start), field(t('page.numberFormat'), format), field(t('page.firstPage'), first)), restart.el, field(t('page.numberStart'), at), linked.el, h('p', { class: 'fp-muted' }, t('section.help'))],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const nStart = Math.floor(Number(at.value))
          if (restart.box.checked && (!Number.isFinite(nStart) || nStart < 0 || nStart > 100000)) return false
          const pv = getPageView()
          const inherited = pv?.sections().find((s) => s.pos === sec.pos)
          app.run(
            setSectionAttrs({
              start: start.value,
              numberStart: restart.box.checked ? nStart : null,
              numberFormat: format.value || null,
              firstPage: first.value === '' ? null : first.value === 'yes',
              // Délier : la section garde une copie de ce dont elle héritait.
              headers: linked.box.checked ? null : (a.headers ?? (inherited ? JSON.parse(JSON.stringify(inherited.headers)) : null)),
              footers: linked.box.checked ? null : (a.footers ?? (inherited ? JSON.parse(JSON.stringify(inherited.footers)) : null)),
            }),
          )
          return true
        },
      },
    ],
  })
}

// --- notes ------------------------------------------------------------------

/** Insère une note là où est le curseur et l'ouvre pour écrire son texte. */
/** Registre des commandes (menus), pour la recherche et le menu contextuel. */
let commandRegistry: () => import('./menu').MenuDef[] = () => []
export function setCommandRegistry(r: () => import('./menu').MenuDef[]): void {
  commandRegistry = r
}
export const commands = (): import('./menu').MenuDef[] => commandRegistry()

/** Page vierge (Insertion → Pages). */
export function insertBlankPage(app: FolioApp): void {
  app.run(insertBlankPageCmd)
}

/** Ouvre une adresse externe dans un nouvel onglet, isolé de cette page. */
export function openExternal(href: string): void {
  if (!openUrl(href)) toast(t('offline.blocked'), { kind: 'info' })
}

export function insertNoteUi(app: FolioApp, kind: NoteKind): boolean {
  if (app.alt) {
    toast(t('note.cannot'), { kind: 'info' })
    return true
  }
  let at = -1
  const ok = app.run(insertNote(kind, (pos) => (at = pos)), false)
  if (!ok) {
    toast(t('note.cannot'), { kind: 'info' })
    return true
  }
  app.openNote?.(at)
  return true
}

/** Numérotation des notes, et conversion d'un type à l'autre. */
export function notesDialog(app: FolioApp): void {
  const current = app.state.doc.attrs.notes as NoteSettings
  const refs = collectNotes(app.state.doc)
  const counts = { foot: refs.filter((r) => r.kind === 'foot').length, end: refs.filter((r) => r.kind === 'end').length }
  const column = (kind: NoteKind) => {
    const s = current[kind]
    const format = select(NOTE_FORMATS.map((f) => [f, t(`note.fmt.${f}` as Key)] as [string, string]), s.format, { 'data-field': `${kind}-format` })
    const start = input('number', s.start, { 'data-field': `${kind}-start`, min: '1', max: '9999' })
    const restarts = NOTE_RESTARTS.filter((r) => kind === 'foot' || r !== 'page')
    const restart = select(restarts.map((r) => [r, t(`note.restart.${r}` as Key)] as [string, string]), s.restart, { 'data-field': `${kind}-restart` })
    const el = h(
      'fieldset',
      { class: 'fp-fieldset' },
      h('legend', {}, t(kind === 'foot' ? 'note.footTitle' : 'note.endTitle')),
      h('div', { class: 'fp-form' }, field(t('note.format'), format), field(t('note.start'), start), field(t('note.restart'), restart)),
    )
    return { el, format, start, restart }
  }
  const foot = column('foot')
  const end = column('end')
  const convert = select(
    [
      ['', '—'],
      ['foot', t('note.convertFootToEnd')],
      ['end', t('note.convertEndToFoot')],
      ['swap', t('note.swap')],
    ],
    '',
    { 'data-field': 'convert' },
  )
  openDialog({
    name: 'notes',
    title: t('note.optionsTitle'),
    body: [
      h('div', { class: 'fp-form fp-form--cols' }, foot.el, end.el),
      field(t('note.convert'), convert),
      h('p', { class: 'fp-muted' }, refs.length ? t('note.count', { foot: String(counts.foot), end: String(counts.end) }) : t('note.none')),
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const read = (c: typeof foot) => {
            const n = Math.floor(Number(c.start.value))
            return Number.isFinite(n) && n >= 1 && n <= 9999 ? n : null
          }
          const fs = read(foot)
          const es = read(end)
          if (fs === null || es === null) return false
          const next: NoteSettings = {
            foot: { format: foot.format.value as NoteSettings['foot']['format'], start: fs, restart: foot.restart.value as NoteSettings['foot']['restart'] },
            end: { format: end.format.value as NoteSettings['end']['format'], start: es, restart: end.restart.value as NoteSettings['end']['restart'] },
          }
          const tr = app.state.tr
          if (JSON.stringify(next) !== JSON.stringify(current)) tr.setDocAttribute('notes', next)
          const how = convert.value
          let converted = 0
          if (how) {
            for (const r of collectNotes(app.state.doc)) {
              if (how !== 'swap' && r.kind !== how) continue
              tr.setNodeMarkup(r.pos, null, { ...r.node.attrs, kind: r.kind === 'end' ? 'foot' : 'end' })
              converted++
            }
          }
          if (tr.docChanged || tr.steps.length) app.view.dispatch(tr)
          if (converted) toast(t('note.converted', { n: String(converted) }), { kind: 'info' })
          app.focus()
          return true
        },
      },
    ],
  })
}

// --- suivi des modifications --------------------------------------------------

/** Active ou désactive le suivi ; pour l'activer, il faut un nom d'auteur. */
export function toggleTracking(app: FolioApp): void {
  if (app.alt) return
  if (isTracking(app.state)) {
    app.run(setTracking(false))
    return
  }
  withAuthor(app, () => {
    app.run(setTracking(true))
    toast(t('track.on'), { kind: 'info' })
  })
}

/** Accepte ou refuse la modification sous le curseur, ou toutes. */
export function resolveTracked(app: FolioApp, accept: boolean, which: 'here' | 'all'): void {
  const n = which === 'all' ? changesOf(app.state.doc).length : changesAt(app.state).length
  if (!n || !app.run(resolveChanges(accept, which))) {
    toast(t('track.none'), { kind: 'info' })
    return
  }
  if (which === 'all') toast(t('track.done', { n: String(n) }), { kind: 'success' })
}

// --- historique des versions ---------------------------------------------------

/** Les versions gardées dans ce navigateur : aperçu, restauration (annulable), effacement. */
export async function versionsDialog(app: FolioApp): Promise<void> {
  const backend = await versionsBackend()
  const list = h('div', { class: 'fp-versions', 'data-field': 'versions' })
  let handle: { close: (v?: string | null) => void } | null = null
  const render = async () => {
    const versions = await app.versions()
    list.replaceChildren()
    if (backend === 'none') list.append(h('p', { class: 'fp-muted' }, t('versions.unavailable')))
    else if (!versions.length) list.append(h('p', { class: 'fp-muted' }, t('versions.none')))
    for (const v of versions) {
      const restore = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-action': 'restore-version' }, t('versions.restore'))
      restore.addEventListener('click', async () => {
        if (!(await app.restoreVersion(v))) return
        handle?.close('restored')
        toast(t('versions.restored', { date: formatDate(v.at) }), { kind: 'success', action: { label: t('menu.undo'), run: () => app.undo() } })
      })
      list.append(
        h(
          'div',
          { class: 'fp-versions__row', 'data-reason': v.reason },
          h(
            'div',
            { class: 'fp-versions__info' },
            h('strong', {}, formatDate(v.at)),
            h('span', { class: 'fp-muted' }, `${t(`versions.reason.${v.reason}` as Key)} · ${v.title} · ${t('versions.words', { n: String(v.words) })}`),
          ),
          restore,
        ),
      )
    }
  }
  await render()
  const keep = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-action': 'keep-version' }, t('versions.now'))
  keep.addEventListener('click', async () => {
    toast((await app.recordVersion('save')) ? t('versions.kept') : t('versions.same'), { kind: 'info' })
    await render()
  })
  handle = openDialog({
    name: 'versions',
    title: t('versions.title'),
    wide: true,
    body: [h('p', { class: 'fp-muted' }, t('versions.help')), keep, list],
    actions: [
      {
        label: t('versions.clear'),
        value: 'clear',
        danger: true,
        run: async () => {
          await deleteVersions(app.docId)
          toast(t('versions.cleared'), { kind: 'info' })
          return true
        },
      },
      { label: t('action.close'), value: 'close', primary: true },
    ],
  })
}

// --- ouvrir un fichier ------------------------------------------------------------

/** Ouvre ce qu'on a reconnu, ou explique pourquoi on ne l'ouvre pas. */
export async function openRecognized(app: FolioApp, o: Opened): Promise<void> {
  if (o.kind === 'encrypted' && o.envelope) return openProtected(app, o.name, o.envelope, o.handle)
  if (o.kind !== 'document') {
    const msg =
      o.kind === 'broken'
        ? t('open.broken', { name: o.name, line: String(o.error.line) })
        : o.kind === 'docx-failed'
          ? t(`open.docx.${o.code}` as Key, { name: o.name })
          : t(`open.${o.kind === 'blank-app' ? 'blankApp' : o.kind === 'too-large' ? 'tooLarge' : o.kind}` as Key, { name: o.name })
    toast(msg, { kind: o.kind === 'blank-app' ? 'info' : 'error', timeout: 9000 })
    return
  }
  pageView?.closeEditor()
  if (!(await app.openDocument(o.doc, { handle: o.handle, name: o.name, report: o.report, imported: o.imported }))) return
  const summary = reportSummary(o.report)
  if (summary) toast(summary, { kind: 'warning', action: { label: t('action.details'), run: () => reportDialog(app) } })
  else toast(t(o.imported ? 'open.imported' : 'open.opened', { name: o.name }), { kind: 'success' })
}

/** Un document protégé ouvert par Ctrl+O (ou déposé) : son mot de passe, puis le document. */
async function openProtected(app: FolioApp, name: string, env: Envelope, handle: FsHandle | null): Promise<void> {
  const input = h('input', { type: 'password', class: 'fp-input', 'data-field': 'password', autocomplete: 'current-password', 'aria-label': t('protect.password') }) as HTMLInputElement
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  let opened: { doc: FolioDoc; report: Report; password: string } | null = null
  const choice = await openDialog({
    name: 'open-password',
    title: t('open.passwordTitle', { name }),
    focus: input,
    body: [h('p', {}, t('unlock.body')), field(t('protect.password'), input), error, h('p', { class: 'fp-form__hint' }, t('unlock.lost'))],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('unlock.open'),
        value: 'ok',
        primary: true,
        run: async () => {
          if (!input.value) return false
          error.textContent = t('unlock.working')
          const json = await decryptEnvelope(env, input.value)
          if (json === null) {
            error.textContent = t('unlock.wrong')
            input.select()
            return false
          }
          const r = loadDocument(json)
          if (!r.ok) {
            error.textContent = t('unlock.damaged')
            return false
          }
          opened = { doc: r.doc, report: r.report, password: input.value }
          return true
        },
      },
    ],
  }).result
  const got = opened as { doc: FolioDoc; report: Report; password: string } | null
  if (choice !== 'ok' || !got) return
  pageView?.closeEditor()
  if (!(await app.openDocument(got.doc, { handle, name, report: got.report, password: got.password }))) return
  toast(t('open.opened', { name }), { kind: 'success' })
}

/** Fichier → Ouvrir… (Ctrl+O) */
export async function openFileUi(app: FolioApp): Promise<void> {
  let picked: Awaited<ReturnType<typeof pickDocument>>
  try {
    picked = await pickDocument()
  } catch (e) {
    toast(t('open.unreadable', { name: e instanceof Error ? e.message : '' }), { kind: 'error' })
    return
  }
  if (!picked) return
  await openRecognized(app, await readOpened(picked.file, picked.handle))
}

/** Un fichier déposé sur la page (qui n'est pas une image). */
export async function openDroppedFile(app: FolioApp, file: File): Promise<void> {
  await openRecognized(app, await readOpened(file, null))
}

/** Fichiers récents : les rouvrir (et les réécrire en place). */
export async function recentFilesDialog(app: FolioApp): Promise<void> {
  const list = h('div', { class: 'fp-versions', 'data-field': 'recent' })
  let handle: { close: (v?: string | null) => void } | null = null
  const render = async () => {
    list.replaceChildren()
    if (!canReopen()) {
      list.append(h('p', { class: 'fp-muted' }, t('open.recentUnsupported')))
      return
    }
    const items = await recentFiles()
    if (!items.length) list.append(h('p', { class: 'fp-muted' }, t('open.noRecent')))
    for (const r of items) {
      const open = h('button', { type: 'button', class: 'fp-btn fp-btn--small fp-btn--primary', 'data-action': 'open-recent' }, t('open.menu').replace('…', ''))
      open.addEventListener('click', async () => {
        const got = await openRecent(r)
        if (!got) {
          toast(t('open.missing'), { kind: 'error' })
          return
        }
        handle?.close('opened')
        await openRecognized(app, await readOpened(got.file, got.handle))
      })
      const forget = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-action': 'forget-recent' }, t('open.forget'))
      forget.addEventListener('click', async () => {
        await forgetRecent(r.key)
        await render()
      })
      list.append(
        h(
          'div',
          { class: 'fp-versions__row', 'data-recent': r.key },
          h('div', { class: 'fp-versions__info' }, h('strong', {}, r.title || r.name), h('span', { class: 'fp-muted' }, `${r.name} · ${formatDate(r.at)}`)),
          forget,
          open,
        ),
      )
    }
  }
  await render()
  const browse = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-action': 'browse' }, t('open.browse'))
  browse.addEventListener('click', () => {
    handle?.close('browse')
    void openFileUi(app)
  })
  handle = openDialog({
    name: 'recent',
    title: t('open.recentTitle'),
    wide: true,
    body: [h('p', { class: 'fp-muted' }, t('open.recentHelp')), browse, list],
    actions: [{ label: t('action.close'), value: 'close', primary: true }],
  })
}

// --- export .docx -----------------------------------------------------------------

let exporting = false

/** Le document en .docx (octets et nom proposé), sans l'enregistrer ; null si le module manque. */
export async function docxFile(app: FolioApp): Promise<{ name: string; res: { bytes: Uint8Array; losses: { code: string; count: number }[] } } | null> {
  let mod: Awaited<ReturnType<typeof loadDocx>>
  try {
    mod = await loadDocx()
  } catch {
    toast(t('docx.export.module'), { kind: 'error', timeout: 9000 })
    return null
  }
  const name = app.suggestedFileName().replace(/\.html?$/i, '') + '.docx'
  const info = app.pagesInfo
  const res = await mod.exportDocx(app.getDoc(), {
    filename: name,
    locale: lang(),
    pages: info?.pages() ?? 1,
    headingPages: info ? outline(app.state.doc, 6).map((o) => info.pageAt(o.pos)) : undefined,
    refPages: info ? refPagesOf(app) : undefined,
    rasterize,
    bake: bakePicture,
    version: __FOLIO_VERSION__,
  })
  return { name, res }
}

/** Fichier → Exporter en .docx… : le fichier est fabriqué ici même, sans connexion. */
export async function exportDocxUi(app: FolioApp): Promise<void> {
  if (exporting) return
  exporting = true
  const wait = window.setTimeout(() => toast(t('docx.export.preparing'), { kind: 'info', timeout: 2500 }), 400)
  try {
    const made = await docxFile(app)
    if (!made) return
    const { name, res } = made
    window.clearTimeout(wait)
    const out = await saveExport(res.bytes, name, DOCX_MIME, '.docx', t('docx.export.type'))
    if (out.kind === 'cancelled') return
    if (out.kind === 'error') {
      toast(t('docx.export.failed', { message: out.message }), { kind: 'error', timeout: 9000 })
      return
    }
    if (res.losses.length) {
      toast(t('docx.export.withLosses', { name: out.name, n: res.losses.length }), {
        kind: 'warning',
        timeout: 12000,
        action: { label: t('action.details'), run: () => exportLossesDialog(res.losses) },
      })
    } else toast(t(out.kind === 'saved' ? 'docx.export.done' : 'docx.export.downloaded', { name: out.name }), { kind: 'success', timeout: 7000 })
  } catch (e) {
    toast(t('docx.export.failed', { message: e instanceof Error ? e.message : String(e) }), { kind: 'error', timeout: 9000 })
  } finally {
    window.clearTimeout(wait)
    exporting = false
  }
}

function exportLossesDialog(losses: { code: string; count: number }[]): void {
  const list = h('ul', { class: 'fp-report' })
  for (const l of losses) list.append(h('li', { class: 'fp-report__item fp-report__item--warning', 'data-loss': l.code }, h('span', { class: 'fp-report__msg' }, t(`docx.out.${l.code}` as Key, { n: l.count }))))
  openDialog({ name: 'docx-losses', title: t('docx.losses.title'), body: [h('p', {}, t('docx.losses.intro')), list], actions: [{ label: t('action.close'), value: 'close', primary: true }], wide: true })
}

/** Pages des signets, des entrées d'index et des légendes (pour l'export .docx, écrit à jour). */
export function refPagesOf(app: FolioApp): { bookmarks: Record<string, string>; entries: string[]; captions: string[] } {
  const info = app.pagesInfo!
  const label = (pos: number) => info.format(info.pageAt(pos))
  const data = refsOf(app.state)
  const bookmarks: Record<string, string> = {}
  for (const [name, pos] of data?.bookmarks ?? []) bookmarks[name] = label(pos)
  const entries: string[] = []
  app.state.doc.descendants((node, pos) => {
    if (node.type === schema.nodes.xe) entries.push(label(pos))
    return !node.isAtom
  })
  return { bookmarks, entries, captions: (data?.captions ?? []).map((c) => label(c.pos)) }
}
