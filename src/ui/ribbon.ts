// Ruban à onglets (phase 2) : Accueil, Insertion, Création, Affichage, et les
// onglets contextuels Tableau et Image. Chaque contrôle sait se mettre à jour
// d'après l'état de l'éditeur (gras actif, police courante, style…).

import * as WIN from './windows'
import * as CH from './chart'
import { textDirectionMenu } from './direction'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
  mergeCells,
  setCellAttr,
  splitCell,
} from 'prosemirror-tables'
import type { FolioApp } from '../app'
import {
  FONT_SIZES,
  applyStyle,
  blockFontSize,
  changeCase,
  clearFormatting,
  columnsAt,
  indent,
  insertBlock,
  insertColumnBreak,
  insertSectionBreak,
  setColumns,
  insertField,
  insertPageBreak,
  insertRule,
  insertTable,
  listAt,
  markActive,
  markValue,
  paraAttr,
  setAlign,
  paraDir,
  setDirection,
  visualAlign,
  setCodeBlock,
  setLineSpacing,
  setListAttrs,
  setMark,
  setParaAttrs,
  setLink,
  sortParagraphs,
  stepFontSize,
  styleIdAt,
  toggleFlag,
  toggleList,
  toggleQuote,
  type CaseMode,
} from '../editor/commands'
import { canInsertNote, gotoNote } from '../editor/notes'
import { commentRanges, commentsAt, deleteAllComments, deleteComment, gotoComment, threadsOf } from '../editor/comments'
import { changesOf, gotoChange, isTracking } from '../editor/track'
import { schema } from '../editor/schema'
import { figureAt, setFigureAttrs, setTableAttrs, sortTable, tableAt, toggleFirstRowHeader } from '../editor/tables'
import { EMBEDDED_FONTS, THEME_PRESETS, cloneTheme, pruneStyles, resolveStyle } from '../format/theme'
import { FIELD_NAMES, NUMBERINGS, PAPER_SIZES, TABLE_STYLES, type FieldName, type ThemeFont } from '../format/types'
import { t } from '../i18n/i18n'
import type { Key } from '../i18n/dict'
import { applyAppearance, settings, updateSettings } from '../settings'
import { h, icon, shortcut } from './dom'
import { RIBBON_ICONS as I } from './icons'
import { colorPalette, highlightPalette } from './palette'
import * as P from './panels'
import * as PL from './piclayout'
import * as SH from './shapes'
import { selectedShapes } from '../editor/shapes'
import * as WT from './writetools'
import * as SN from './snippets'
import * as GL from './glossary'
import * as PR from './privacy'
import * as FM from './forms'
import * as DR from './draw'
import { applyFocusClasses } from './typewriter'
import { WRAP_MENU, alignAttrs, wrapAttrs, type Wrap } from '../format/picture'
import * as R from './refs'
import * as O from './online'
import { convertTex, macrosDialog, newEquation } from './equation'
import { protectDialog } from './protect'
import { mailingsGroups } from './mailings'
import { autoCorrectDialog } from './autocorrect'
import * as TX from './textfx'
import * as PT from './pagetools'
import * as PFX from './picturefx'
import * as NT from './navtools'
import * as IT from './inserttools'
import { aboutDialog, aiHelpDialog, copyJson, replaceFromJsonDialog, reportDialog } from './actions'
import { availableLanguages, lang, setLang } from '../i18n/i18n'
import { addLanguageUi, languagesDialog } from './packs'
import * as OB from './objects'
import * as MK from './markup'
import * as CMP from './compare'
import * as ICN from './insert-icons'
import * as DG from './diagram'
import * as OL from '../editor/outlineview'
import { openImmersive } from './immersive'
import { checkUpdatesUi, toggleAutoUpdate, toggleOffline, whatsNewDialog } from './updates'
import { isOffline } from '../net'
import { Popover, closePopovers, popItem, popoverOpen } from './popover'
import { getDocsPane } from './docpane'
import { toast } from './dialog'
import { accessibilityDialog } from './a11y'
import { isFocusMode, setFocusMode } from './focus'
import { isSpeaking, readAloud, stopReading } from './speech'
import { openInNewTab } from './mailings'
import { isSideToSide, setSideToSide } from './spread'
import { demoDocument } from '../demo/demo'
import { baseLang } from '../i18n/i18n'

const m = schema.marks

export interface Ctl {
  el: HTMLElement
  update?: () => void
  /** Contrôles contenus (colonnes, rangées) : la barre du menu contextuel les reprend un à un. */
  parts?: Ctl[]
}

export interface Group {
  id: string
  label: string
  controls: Ctl[]
  /** Bouton de lancement de la boîte de dialogue du groupe (coin en bas à droite). */
  launcher?: () => void
  /** Icône du groupe replié (sinon celle de son premier contrôle). */
  icon?: string
}

export interface TabDef {
  id: string
  label: () => string
  groups: (app: FolioApp) => Group[]
  /** Onglet contextuel : visible seulement quand la fonction le dit. */
  when?: (app: FolioApp) => boolean
}

// --- contrôles -----------------------------------------------------------------

interface ButtonOptions {
  id: string
  label: string
  icon?: string
  run: () => void
  active?: () => boolean
  enabled?: () => boolean
  large?: boolean
  /** Afficher le libellé à côté de l'icône. */
  text?: boolean
  keys?: string
}

/**
 * Libellés courts du ruban, par commande : le bouton montre le libellé court,
 * l'infobulle et les lecteurs d'écran gardent le libellé complet.
 */
const SHORT: Partial<Record<string, Key>> = {
  'insert-footnote': 'rbs.footnote',
  'insert-endnote': 'rbs.endnote',
  'insert-citation': 'rbs.citation',
  'insert-caption': 'rbs.caption',
  'table-of-figures': 'rbs.figures',
  'insert-authorities': 'rbs.authorities',
  'update-toc': 'rbs.update',
  'update-figures': 'rbs.update',
  'update-index': 'rbs.update',
  'update-authorities': 'rbs.update',
  'mm-update-labels': 'rbs.update',
  'review-spell': 'rbs.spelling',
  thesaurus: 'rbs.thesaurus',
  'comment-name': 'rbs.myName',
  'redact-mark': 'rbs.redact',
  'redact-apply': 'rbs.apply',
  inspect: 'rbs.inspect',
  'mm-highlight': 'rbs.highlightFields',
  'mm-insert-field': 'rbs.mergeField',
  'mm-match': 'rbs.match',
  'mm-recipients': 'rbs.recipients',
  'mm-edit-list': 'rbs.editList',
  'mm-find': 'rbs.find',
  'reset-window': 'rbs.resetPosition',
  'view-spell': 'rbs.spellcheck',
  'view-autohide': 'rbs.autoFold',
  'view-nav': 'rbs.navigation',
  'view-marks': 'rbs.marks',
  'copy-compact': 'rbs.compactJson',
  'comments-pane': 'rbs.commentsPane',
  'view-markdown': 'rbs.markdown',
  'zoom-fit': 'rbs.pageWidth',
}

/** Le libellé montré sur le bouton (court s'il en a un). */
const shown = (id: string, label: string): string => (SHORT[id] ? t(SHORT[id]!) : label)

export function button(o: ButtonOptions): Ctl {
  const b = h('button', {
    type: 'button',
    class: 'fp-rb-btn' + (o.large ? ' fp-rb-btn--large' : '') + (o.text || o.large ? ' has-text' : ''),
    'data-cmd': o.id,
    title: o.keys ? `${o.label} (${o.keys})` : o.label,
    'aria-label': o.label,
  }) as HTMLButtonElement
  if (o.icon) b.append(icon(o.icon))
  if (o.text || o.large) b.append(h('span', { class: 'fp-rb-btn__label' }, shown(o.id, o.label)))
  b.addEventListener('mousedown', (e) => e.preventDefault()) // garder la sélection de l'éditeur
  b.addEventListener('click', () => o.run())
  return {
    el: b,
    update: () => {
      if (o.active) {
        const on = o.active()
        b.classList.toggle('is-active', on)
        b.setAttribute('aria-pressed', String(on))
      }
      if (o.enabled) b.disabled = !o.enabled()
    },
  }
}

interface MenuOptions {
  id: string
  label: string
  icon?: string
  /** Texte affiché sur le bouton (au lieu de l'icône seule). */
  text?: () => string
  large?: boolean
  menu: () => HTMLElement
  enabled?: () => boolean
  active?: () => boolean
}

function openMenu(anchor: HTMLElement, name: string, content: HTMLElement, keepFocus = false): Popover {
  return new Popover({ anchor, content, name, keepFocus })
}

/** Bouton qui ouvre une liste ou une palette. */
export function dropdown(o: MenuOptions): Ctl {
  const b = h('button', {
    type: 'button',
    class: 'fp-rb-btn fp-rb-drop' + (o.large ? ' fp-rb-btn--large has-text' : o.text ? ' has-text' : ''),
    'data-cmd': o.id,
    title: o.label,
    'aria-label': o.label,
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
  }) as HTMLButtonElement
  if (o.icon) b.append(icon(o.icon))
  const label = h('span', { class: 'fp-rb-btn__label' }, o.large ? shown(o.id, o.label) : '')
  if (o.large || o.text) b.append(label)
  b.append(icon(I.caret))
  b.addEventListener('mousedown', (e) => e.preventDefault())
  b.addEventListener('click', () => openMenu(b, o.id, o.menu()))
  return {
    el: b,
    update: () => {
      if (o.text) label.textContent = SHORT[o.id] ? t(SHORT[o.id]!) : o.text()
      if (o.enabled) b.disabled = !o.enabled()
      if (o.active) b.classList.toggle('is-active', o.active())
    },
  }
}

/** Bouton partagé : l'action principale, et une flèche qui ouvre les choix. */
export function split(o: ButtonOptions & { menu: () => HTMLElement; indicator?: () => string | null }): Ctl {
  const main = button({ ...o, id: o.id })
  const bar = h('span', { class: 'fp-rb-indicator' })
  if (o.indicator) main.el.append(bar)
  const arrow = h('button', {
    type: 'button',
    class: 'fp-rb-btn fp-rb-arrow',
    'data-cmd': `${o.id}-menu`,
    title: o.label,
    'aria-label': `${o.label} — ${t('ribbon.more')}`,
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
  }) as HTMLButtonElement
  arrow.append(icon(I.caret))
  arrow.addEventListener('mousedown', (e) => e.preventDefault())
  arrow.addEventListener('click', () => openMenu(arrow, `${o.id}-menu`, o.menu()))
  const el = h('div', { class: 'fp-rb-split' }, main.el, arrow)
  return {
    el,
    update: () => {
      main.update?.()
      if (o.indicator) {
        const c = o.indicator()
        bar.style.background = c ?? 'transparent'
      }
      if (o.enabled) arrow.disabled = !o.enabled()
    },
  }
}

interface ComboOption {
  value: string
  label: string
  /** Style d'aperçu de l'option (police…). */
  style?: string
  section?: string
}

/** Liste modifiable (police, taille) : on choisit ou on tape une valeur. */
export function combo(o: { id: string; label: string; width: string; value: () => string; options: () => ComboOption[]; onPick: (v: string) => void; numeric?: boolean }): Ctl {
  const input = h('input', {
    type: 'text',
    class: 'fp-rb-combo__input',
    'data-cmd': o.id,
    'aria-label': o.label,
    title: o.label,
    autocomplete: 'off',
    spellcheck: 'false',
    style: `width:${o.width}`,
    inputmode: o.numeric ? 'decimal' : null,
  }) as HTMLInputElement
  const arrow = h('button', { type: 'button', class: 'fp-rb-combo__arrow', tabindex: '-1', 'aria-label': o.label, 'aria-haspopup': 'true', 'aria-expanded': 'false' }) as HTMLButtonElement
  arrow.append(icon(I.caret))
  const wrap = h('div', { class: 'fp-rb-combo', 'data-combo': o.id }, input, arrow)
  let pop: Popover | null = null
  const list = (filter: string) => {
    const content = h('div', { class: 'fp-pop__list fp-combo-list' })
    let section = ''
    const f = filter.trim().toLowerCase()
    for (const opt of o.options()) {
      if (f && !opt.label.toLowerCase().includes(f) && !opt.value.toLowerCase().includes(f)) continue
      if (opt.section && opt.section !== section) {
        section = opt.section
        content.append(h('div', { class: 'fp-pop__heading' }, section))
      }
      const it = popItem(opt.label, () => {
        o.onPick(opt.value)
      }, { 'data-value': opt.value })
      if (opt.style) it.setAttribute('style', opt.style)
      content.append(it)
    }
    return content
  }
  const open = (filter = '') => {
    pop?.close(false)
    pop = new Popover({ anchor: wrap, content: list(filter), name: `${o.id}-list`, keepFocus: true, onClose: () => (pop = null) })
  }
  arrow.addEventListener('mousedown', (e) => e.preventDefault())
  arrow.addEventListener('click', () => (pop ? pop.close(false) : open()))
  input.addEventListener('focus', () => input.select())
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      pop?.close(false)
      if (input.value.trim()) o.onPick(input.value.trim())
    } else if (e.key === 'Escape') {
      pop?.close(false)
      input.value = o.value()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!pop) open()
      ;(pop?.el.querySelector('[data-pop-item]') as HTMLElement | null)?.focus()
    }
  })
  input.addEventListener('input', () => open(input.value))
  input.addEventListener('blur', () => setTimeout(() => {
    if (!pop && document.activeElement !== input) input.value = o.value()
  }, 150))
  return {
    el: wrap,
    update: () => {
      if (document.activeElement !== input) input.value = o.value()
    },
  }
}

// --- format painter -----------------------------------------------------------

interface Painted {
  marks: readonly import('prosemirror-model').Mark[]
  para: Record<string, unknown> | null
  style: string | null
}

let painter: { data: Painted; sticky: boolean } | null = null

export function painterActive(): boolean {
  return !!painter
}

/** Copie la mise en forme du curseur. */
export function painterCopy(app: FolioApp, sticky = false): void {
  const s = app.state
  const $from = s.selection.$from
  const marks = s.selection.empty ? (s.storedMarks ?? $from.marks()) : $from.marksAcross(s.selection.$to) ?? $from.marks()
  const block = $from.parent
  painter = {
    data: {
      marks,
      para: block.type === schema.nodes.paragraph || block.type === schema.nodes.heading ? { ...block.attrs } : null,
      style: block.type === schema.nodes.paragraph ? (block.attrs.style as string | null) : null,
    },
    sticky,
  }
  app.view.dom.classList.add('is-painting')
  app.notifyUi()
}

/** Applique la mise en forme copiée à la sélection. */
export function painterApply(app: FolioApp): boolean {
  if (!painter) return false
  const { data } = painter
  const s = app.state
  const { from, to, empty } = s.selection
  const tr = s.tr
  if (!empty) {
    for (const type of Object.values(schema.marks)) if (type !== m.link) tr.removeMark(from, to, type)
    for (const mk of data.marks) if (mk.type !== m.link) tr.addMark(from, to, mk)
  }
  if (data.para) {
    s.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === schema.nodes.paragraph || node.type === schema.nodes.heading) {
        const { level: _l, style: _s, ...para } = data.para as Record<string, unknown>
        tr.setNodeMarkup(pos, null, { ...node.attrs, ...para, ...(node.type === schema.nodes.paragraph ? { style: data.style } : {}) })
        return false
      }
      return true
    })
  }
  app.view.dispatch(tr)
  if (!painter.sticky) painterStop(app)
  return true
}

export function painterStop(app: FolioApp): void {
  painter = null
  app.view.dom.classList.remove('is-painting')
  app.notifyUi()
}

// --- groupes -------------------------------------------------------------------

const SYSTEM_FONTS = ['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Tahoma', 'Garamond', 'Palatino', 'Courier New', 'system-ui']

function fontOptions(app: FolioApp): ComboOption[] {
  const th = app.theme
  const out: ComboOption[] = (['heading', 'body', 'mono'] as ThemeFont[]).map((f) => ({
    value: f,
    label: `${th.fonts[f]} (${t(`font.theme.${f}` as Key)})`,
    style: `font-family:var(--doc-font-${f})`,
    section: t('font.section.theme'),
  }))
  const docFonts = [...new Set((app.state.doc.attrs.fonts as { family: string }[]).map((f) => f.family))]
  for (const f of docFonts) out.push({ value: f, label: f, style: `font-family:"${f.replace(/"/g, '')}"`, section: t('font.section.document') })
  for (const f of EMBEDDED_FONTS) out.push({ value: f, label: f, style: `font-family:"${f}"`, section: t('font.section.embedded') })
  for (const f of SYSTEM_FONTS) out.push({ value: f, label: f, style: `font-family:${f === 'system-ui' ? 'system-ui' : `"${f}"`}`, section: t('font.section.system') })
  return out
}

/** Police affichée : celle de la sélection, sinon celle du style du paragraphe. */
function currentFont(app: FolioApp): string {
  const v = markValue(app.state, m.font, 'family')
  if (v === 'mixed') return ''
  const name = (v as string | null) ?? (resolveStyle(app.styles, styleIdAt(app.state)).font as string | undefined) ?? 'body'
  return ['heading', 'body', 'mono'].includes(name) ? app.theme.fonts[name as ThemeFont] : name
}

function currentSize(app: FolioApp): string {
  const v = markValue(app.state, m.size, 'pt')
  if (v === 'mixed') return ''
  const pt = (v as number | null) ?? blockFontSize(app.state, app.styles)
  return String(pt).replace('.', t('number.decimal'))
}

function parseSize(v: string): number | null {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) && n >= 1 && n <= 400 ? Math.round(n * 2) / 2 : null
}

const caseMenu = (app: FolioApp) =>
  h(
    'div',
    { class: 'fp-pop__list' },
    ...(['sentence', 'lower', 'upper', 'title', 'toggle'] as CaseMode[]).map((c) =>
      popItem(t(`case.${c}` as Key), () => app.run(changeCase(c, app.state.doc.attrs.lang || undefined)), { 'data-case': c }),
    ),
  )

// --- disposition des groupes ------------------------------------------------------
//
// Les groupes reprennent la disposition des traitements de texte habituels :
// grands boutons, colonnes de trois petits boutons, rangées (Police,
// Paragraphe). Une fonction pas encore là a son bouton, grisé, avec une bulle
// qui le dit.

type Item = Ctl | null | false | undefined
const live = (items: Item[]): Ctl[] => items.filter((c): c is Ctl => !!c)

/** Une colonne de petits contrôles (trois au plus). */
export function col(...items: Item[]): Ctl {
  const ctls = live(items)
  return { el: h('div', { class: 'fp-rb-stack fp-rb-col' }, ...ctls.map((c) => c.el)), update: () => ctls.forEach((c) => c.update?.()), parts: ctls }
}

/** Une colonne de champs sous un intitulé (Mise en page → Paragraphe : Retrait, Espacement). */
function titledCol(title: string, ...items: Item[]): Ctl {
  const ctls = live(items)
  return { el: h('div', { class: 'fp-rb-stack fp-rb-col fp-rb-titled' }, h('span', { class: 'fp-rb-coltitle' }, title), ...ctls.map((c) => c.el)), update: () => ctls.forEach((c) => c.update?.()) }
}

/** Des rangées de petits boutons (groupes Police et Paragraphe). */
function rows(...lines: Item[][]): Ctl {
  const all = lines.map(live)
  return {
    el: h('div', { class: 'fp-rb-rows' }, ...all.map((l) => h('div', { class: 'fp-rb-row' }, ...l.map((c) => c.el)))),
    update: () => all.flat().forEach((c) => c.update?.()),
    parts: all.flat(),
  }
}

/** Le bouton d'une fonction à venir : grisé, inactif, et sa bulle le dit. */
function soon(o: { id: string; label: string; icon?: string; large?: boolean; text?: boolean; drop?: boolean }): Ctl {
  const b = h('button', {
    type: 'button',
    class: 'fp-rb-btn is-soon' + (o.large ? ' fp-rb-btn--large has-text' : o.text ? ' has-text' : '') + (o.drop ? ' fp-rb-drop' : ''),
    'data-cmd': o.id,
    'data-soon': '',
    'aria-disabled': 'true',
    title: t('soon', { label: o.label }),
    'aria-label': o.label,
  }) as HTMLButtonElement
  if (o.icon) b.append(icon(o.icon))
  if (o.large || o.text) b.append(h('span', { class: 'fp-rb-btn__label' }, shown(o.id, o.label)))
  if (o.drop) b.append(icon(I.caret))
  b.addEventListener('mousedown', (e) => e.preventDefault())
  return { el: b }
}

/** Une entrée de menu à venir, grisée. */
function soonItem(label: string): HTMLElement {
  const it = popItem(label, () => undefined, { 'data-soon': '', 'aria-disabled': 'true' })
  it.classList.add('is-soon')
  it.title = t('soon', { label })
  return it
}

/** Une case à cocher (Affichage → Afficher). */
function check(o: { id: string; label: string; get: () => boolean; set: (v: boolean) => void; soon?: boolean }): Ctl {
  const box = h('input', { type: 'checkbox', 'data-cmd': o.id }) as HTMLInputElement
  const el = h('label', { class: 'fp-rb-check' + (o.soon ? ' is-soon' : ''), title: o.soon ? t('soon', { label: o.label }) : o.label }, box, h('span', {}, shown(o.id, o.label)))
  if (SHORT[o.id]) box.setAttribute('aria-label', o.label)
  box.disabled = !!o.soon
  box.addEventListener('change', () => o.set(box.checked))
  return {
    el,
    update: () => {
      box.checked = o.get()
      el.classList.toggle('is-active', box.checked)
    },
  }
}

const sep = () => h('hr', { class: 'fp-pop__sep' })
const heading = (text: string) => h('div', { class: 'fp-pop__heading' }, text)

/** La sélection contient-elle déjà une liste numérotée ? */
function hasListIn(app: FolioApp): boolean {
  let found = false
  const { from, to } = app.state.selection
  app.state.doc.nodesBetween(from, to, (node) => {
    if (node.type === schema.nodes.ordered_list) found = true
    return !found
  })
  return found
}

function homeGroups(app: FolioApp): Group[] {
  const clipboard: Group = {
    id: 'clipboard',
    label: t('ribbon.clipboard'),
    controls: [
      split({
        id: 'paste',
        label: t('menu.paste'),
        icon: I.paste,
        large: true,
        keys: shortcut('V'),
        run: () => void P.pasteFromClipboard(app, false),
        menu: () =>
          h(
            'div',
            { class: 'fp-pop__list' },
            heading(t('ctx.pasteOptions')),
            popItem(h('span', { class: 'fp-pop__icon-row' }, icon(I.pasteKeep), t('rb.pasteKeep')), () => void P.pasteFromClipboard(app, false), { 'data-paste': 'keep' }),
            popItem(h('span', { class: 'fp-pop__icon-row' }, icon(I.pasteText), t('rb.pasteText')), () => void P.pasteFromClipboard(app, true), { 'data-paste': 'text' }),
          ),
      }),
      col(
        button({ id: 'cut', label: t('menu.cut'), icon: I.cut, keys: shortcut('X'), run: () => P.clipboardAction(app, 'cut') }),
        button({ id: 'copy', label: t('menu.copy'), icon: I.copy, keys: shortcut('C'), run: () => P.clipboardAction(app, 'copy') }),
        button({
          id: 'painter',
          label: t('ribbon.painter'),
          icon: I.painter,
          active: () => painterActive(),
          run: () => (painterActive() ? painterStop(app) : painterCopy(app)),
        }),
      ),
    ],
  }
  const flag = (f: 'bold' | 'italic' | 'strike' | 'sub' | 'sup') =>
    button({
      id: f,
      label: t(`ribbon.${f}` as Key),
      icon: I[f],
      keys: { bold: shortcut('B'), italic: shortcut('I'), strike: shortcut('Maj+X').replace('Maj', t('key.shift')), sub: shortcut(','), sup: shortcut('.') }[f],
      active: () => markActive(app.state, m[f]),
      run: () => app.run(toggleFlag(f)),
    })
  const font: Group = {
    id: 'font',
    label: t('ribbon.font'),
    launcher: () => P.fontDialog(app),
    controls: [
      rows(
        [
          combo({
            id: 'font-family',
            label: t('ribbon.fontFamily'),
            width: '9.5em',
            value: () => currentFont(app),
            options: () => [...fontOptions(app), { value: '__online', label: t('gf.more'), section: t('online.group') }],
            onPick: (v) => {
              if (v === '__online') return void O.onlineFontsDialog(app)
              const opt = fontOptions(app).find((o) => o.value === v || o.label.toLowerCase() === v.toLowerCase())
              const family = opt ? opt.value : v
              if (/^[\p{L}\p{N} ._'-]{1,100}$/u.test(family)) app.run(setMark(m.font, { family }))
            },
          }),
          combo({
            id: 'font-size',
            label: t('ribbon.fontSize'),
            width: '3.2em',
            numeric: true,
            value: () => currentSize(app),
            options: () => FONT_SIZES.map((s) => ({ value: String(s), label: String(s).replace('.', t('number.decimal')) })),
            onPick: (v) => {
              const pt = parseSize(v)
              if (pt) app.run(setMark(m.size, { pt }))
            },
          }),
          button({ id: 'grow', label: t('ribbon.grow'), icon: I.grow, keys: `${shortcut('Maj+>')}`.replace('Maj', t('key.shift')), run: () => app.run(stepFontSize(1, app.styles)) }),
          button({ id: 'shrink', label: t('ribbon.shrink'), icon: I.shrink, run: () => app.run(stepFontSize(-1, app.styles)) }),
          dropdown({ id: 'case', label: t('ribbon.case'), icon: I.case, menu: () => caseMenu(app) }),
          button({ id: 'clear', label: t('ribbon.clear'), icon: I.clear, keys: shortcut('\\'), run: () => app.run(clearFormatting) }),
          TX.charBorder(app),
        ],
        [
          flag('bold'),
          flag('italic'),
          split({
            id: 'underline',
            label: t('ribbon.underline'),
            icon: I.underline,
            keys: shortcut('U'),
            active: () => markActive(app.state, m.underline),
            run: () => app.run(toggleFlag('underline')),
            menu: () => TX.underlineMenu(app),
          }),
          flag('strike'),
          flag('sub'),
          flag('sup'),
          TX.textEffects(app),
          split({
            id: 'highlight',
            label: t('ribbon.highlight'),
            icon: I.highlight,
            run: () => app.run(setMark(m.highlight, { value: P.lastColor.highlight })),
            indicator: () => P.highlightCss(P.lastColor.highlight),
            menu: () =>
              h(
                'div',
                {},
                highlightPalette((markValue(app.state, m.highlight, 'value') as string | null) ?? null, (c) => {
                  if (c) P.lastColor.highlight = c
                  app.run(setMark(m.highlight, c ? { value: c } : null))
                }),
                h('div', { class: 'fp-pop__sep', role: 'separator' }),
                popItem(t('find.findHighlighted'), () => P.openFind(app, false, true), { 'data-find-highlighted': '' }),
              ),
          }),
          split({
            id: 'color',
            label: t('ribbon.color'),
            icon: I.color,
            run: () => app.run(setMark(m.color, { value: P.lastColor.text })),
            indicator: () => P.cssOf(app, P.lastColor.text),
            menu: () =>
              colorPalette({
                theme: app.theme,
                current: (markValue(app.state, m.color, 'value') as string | null) ?? null,
                noneLabel: t('color.automatic'),
                onPick: (c) => {
                  if (c) P.lastColor.text = c
                  app.run(setMark(m.color, c ? { value: c } : null))
                },
              }),
          }),
          TX.charShading(app),
        ],
      ),
    ],
  }
  const listMenu = (kind: 'bullet' | 'number') => {
    const content = h('div', { class: 'fp-pop__list' })
    if (kind === 'bullet') {
      for (const b of ['•', '◦', '▪', '–', '✓', '➤', '★']) {
        content.append(
          popItem(`${b}  ${t('list.bulletChar')}`, () => {
            if (!listAt(app.state) || listAt(app.state)!.node.type !== schema.nodes.bullet_list) app.run(toggleList('bullet'), false)
            app.run(setListAttrs({ bullet: b === '•' ? null : b }))
          }, { 'data-bullet': b }),
        )
      }
    } else {
      for (const nb of NUMBERINGS) {
        content.append(
          popItem(t(`numbering.${nb}` as Key), () => {
            if (!listAt(app.state) || listAt(app.state)!.node.type !== schema.nodes.ordered_list) app.run(toggleList('number'), false)
            app.run(setListAttrs({ numbering: nb === 'default' ? null : nb }))
          }, { 'data-numbering': nb }),
        )
      }
      content.append(sep())
      content.append(popItem(t('list.restart'), () => app.run(setListAttrs({ order: 1, continue: false }))))
      content.append(popItem(t('list.continue'), () => app.run(setListAttrs({ continue: true }))))
      content.append(popItem(t('list.startAt'), () => P.listStartDialog(app)))
    }
    return content
  }
  const numbered = (nb: string | null) => {
    const here = listAt(app.state)
    if (here ? here.node.type !== schema.nodes.ordered_list : !hasListIn(app)) app.run(toggleList('number'), false)
    app.run(setListAttrs({ numbering: nb }))
  }
  const lineMenu = () =>
    h(
      'div',
      { class: 'fp-pop__list' },
      ...[1, 1.15, 1.5, 2, 2.5, 3].map((l) =>
        popItem(String(l).replace('.', t('number.decimal')), () => app.run(setLineSpacing(l)), { 'data-line': String(l), 'aria-checked': String(paraAttr(app.state, 'line') === l) }),
      ),
      sep(),
      popItem(t('ribbon.lineDefault'), () => app.run(setLineSpacing(null))),
      popItem(t('ribbon.paragraphOptions'), () => P.paragraphDialog(app)),
    )
  const sortBy = (desc: boolean) => {
    if (!app.run(sortParagraphs(desc, (app.state.doc.attrs.lang as string) || undefined))) toast(t('rb.sortNothing'), { kind: 'info' })
  }
  const paragraph: Group = {
    id: 'paragraph',
    label: t('ribbon.paragraph'),
    launcher: () => P.paragraphDialog(app),
    controls: [
      rows(
        [
          split({
            id: 'bullets',
            label: t('ribbon.bullets'),
            icon: I.bullets,
            keys: shortcut('Maj+8').replace('Maj', t('key.shift')),
            active: () => listAt(app.state)?.node.type === schema.nodes.bullet_list,
            run: () => app.run(toggleList('bullet')),
            menu: () => listMenu('bullet'),
          }),
          split({
            id: 'numbers',
            label: t('ribbon.numbers'),
            icon: I.numbers,
            keys: shortcut('Maj+7').replace('Maj', t('key.shift')),
            active: () => listAt(app.state)?.node.type === schema.nodes.ordered_list,
            run: () => app.run(toggleList('number')),
            menu: () => listMenu('number'),
          }),
          dropdown({
            id: 'multilevel',
            label: t('rb.multilevel'),
            icon: I.multilevel,
            active: () => listAt(app.state)?.node.attrs.numbering === 'outline',
            menu: () =>
              h(
                'div',
                { class: 'fp-pop__list' },
                popItem(t('rb.multilevelOutline'), () => numbered('outline'), { 'data-multilevel': 'outline' }),
                popItem(t('rb.multilevelPlain'), () => numbered(null), { 'data-multilevel': 'default' }),
              ),
          }),
          button({
            id: 'checklist',
            label: t('rb.checklist'),
            icon: I.checklist,
            active: () => listAt(app.state)?.node.type === schema.nodes.check_list,
            run: () => app.run(toggleList('check')),
          }),
          button({ id: 'indent-less', label: t('ribbon.indentLess'), icon: I.indentLess, run: () => app.run(indent(-1)) }),
          button({ id: 'indent-more', label: t('ribbon.indentMore'), icon: I.indentMore, run: () => app.run(indent(1)) }),
          dropdown({
            id: 'sort',
            label: t('rb.sort'),
            icon: I.sortAZ,
            menu: () => h('div', { class: 'fp-pop__list' }, popItem(t('rb.sortAsc'), () => sortBy(false), { 'data-sort': 'asc' }), popItem(t('rb.sortDesc'), () => sortBy(true), { 'data-sort': 'desc' })),
          }),
          button({
            id: 'marks',
            label: t('ribbon.marks'),
            icon: I.marks,
            keys: shortcut('Maj+8').replace('Maj', t('key.shift')).replace('8', '*'),
            active: () => settings().showMarks,
            run: () => {
              updateSettings({ showMarks: !settings().showMarks })
              app.view.setProps({})
              app.notifyUi()
            },
          }),
        ],
        [
          ...(['left', 'center', 'right', 'justify'] as const).map((a) =>
            button({
              id: `align-${a}`,
              label: t(`ribbon.align.${a}` as Key),
              icon: I[`align${a[0].toUpperCase()}${a.slice(1)}` as 'alignLeft'],
              keys: shortcut(`Maj+${{ left: 'L', center: 'E', right: 'R', justify: 'J' }[a]}`).replace('Maj', t('key.shift')),
              active: () => visualAlign(app.state) === a,
              run: () => app.run(setAlign(a)),
            }),
          ),
          // De droite à gauche : un interrupteur (le menu Orientation du texte donne les deux sens).
          button({
            id: 'dir-rtl',
            label: t('dir.rtl'),
            icon: I.dirRtl,
            active: () => paraDir(app.state) === 'rtl',
            run: () => app.run(setDirection(paraDir(app.state) === 'rtl' ? 'ltr' : 'rtl')),
          }),
          dropdown({ id: 'line-spacing', label: t('ribbon.lineSpacing'), icon: I.lineSpacing, menu: lineMenu }),
          split({
            id: 'shading',
            label: t('ribbon.shading'),
            icon: I.fill,
            run: () => app.run(setParaAttrs({ shading: P.lastColor.shading })),
            indicator: () => P.cssOf(app, P.lastColor.shading),
            menu: () =>
              colorPalette({
                theme: app.theme,
                current: (paraAttr(app.state, 'shading') as string | null) ?? null,
                noneLabel: t('color.none'),
                onPick: (c) => {
                  if (c) P.lastColor.shading = c
                  app.run(setParaAttrs({ shading: c }))
                },
              }),
          }),
          split({
            id: 'para-border',
            label: t('rb.borders'),
            icon: I.border,
            active: () => !!paraAttr(app.state, 'border') && paraAttr(app.state, 'border') !== 'mixed',
            run: () => app.run(setParaAttrs({ border: paraAttr(app.state, 'border') ? null : 'accent6' })),
            menu: () =>
              h(
                'div',
                { class: 'fp-pop__list' },
                popItem(t('rb.borderBox'), () => app.run(setParaAttrs({ border: 'accent6' })), { 'data-border': 'box' }),
                popItem(t('rb.borderNone'), () => app.run(setParaAttrs({ border: null })), { 'data-border': 'none' }),
                sep(),
                popItem(t('rb.bordersShading'), () => P.paragraphDialog(app), { 'data-border': 'dialog' }),
              ),
          }),
        ],
      ),
    ],
  }
  const voice: Group = {
    id: 'voice',
    label: t('dict.group'),
    controls: [
      split({
        id: 'dictate',
        label: t('dict.dictate'),
        icon: I.dictate,
        large: true,
        active: () => O.isDictating(),
        enabled: () => !isOffline() && !app.reading,
        run: () => O.toggleDictation(app),
        menu: () =>
          h(
            'div',
            { class: 'fp-pop__list' },
            heading(t('dict.language')),
            ...O.DICTATION_LANGS.map((l) => popItem(new Intl.DisplayNames([lang()], { type: 'language' }).of(l) ?? l, () => O.toggleDictation(app, l), { 'data-dictate-lang': l })),
            h('p', { class: 'fp-pop__note' }, O.canDictate() ? t('dict.hint') : t('dict.unsupported')),
          ),
      }),
    ],
  }
  return [clipboard, font, paragraph, stylesGroup(app), editingGroup(app), voice]
}

/** Galerie des styles : le nom de chaque style écrit dans ce style, le style courant en évidence. */
function stylesGroup(app: FolioApp): Group {
  const ids = () => ['normal', 'heading1', 'heading2', 'heading3', 'title', 'subtitle', 'quote', 'code', 'caption', ...Object.keys(app.styles).filter((id) => !/^(normal|title|subtitle|heading\d|quote|code|caption)$/.test(id))]
  const gallery = h('div', { class: 'fp-rb-gallery fp-rb-gallery--styles', role: 'listbox', 'aria-label': t('ribbon.styles') })
  const render = () => {
    gallery.replaceChildren()
    const cur = styleIdAt(app.state)
    for (const id of ids()) {
      const s = resolveStyle(app.styles, id)
      const b = h('button', {
        type: 'button',
        class: 'fp-style-chip' + (cur === id ? ' is-current' : ''),
        role: 'option',
        'aria-selected': String(cur === id),
        'data-style-id': id,
        title: P.styleName(app, id),
      }) as HTMLButtonElement
      b.append(h('span', { class: 'fp-style-chip__sample', style: P.stylePreviewCss(s) }, P.styleName(app, id)))
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', () => app.run(applyStyle(id)))
      gallery.append(b)
    }
  }
  const more = dropdown({
    id: 'styles-more',
    label: t('rb.stylesMore'),
    menu: () =>
      h(
        'div',
        { class: 'fp-pop__list' },
        ...['heading4', 'heading5', 'heading6'].map((id) => popItem(P.styleName(app, id), () => app.run(applyStyle(id)), { 'data-style-id': id })),
        sep(),
        popItem(t('style.new'), () => P.styleDialog(app, null)),
        popItem(t('style.modify'), () => P.styleDialog(app, styleIdAt(app.state))),
        popItem(t('style.update'), () => P.updateStyleFromSelection(app)),
        popItem(t('style.manage'), () => P.stylesManager(app)),
      ),
  })
  more.el.classList.add('fp-rb-gallery__more')
  let last = ''
  const box = h('div', { class: 'fp-rb-gallery-box' }, gallery, more.el)
  return {
    id: 'styles',
    icon: I.styles,
    label: t('ribbon.styles'),
    launcher: () => P.stylesManager(app),
    controls: [
      {
        el: box,
        update: () => {
          more.update?.()
          const key = JSON.stringify([styleIdAt(app.state), app.styles, app.theme.fonts, app.theme.colors])
          if (key !== last) {
            last = key
            render()
          }
        },
      },
    ],
  }
}

function editingGroup(app: FolioApp): Group {
  return {
    id: 'editing',
    label: t('ribbon.editing'),
    controls: [
      col(
        split({
          id: 'find',
          label: t('menu.find'),
          icon: I.find,
          text: true,
          keys: shortcut('F'),
          run: () => P.openFind(app, false),
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              popItem(t('menu.find'), () => P.openFind(app, false), { 'data-find': 'find' }),
              popItem(t('rb.advancedFind'), () => P.openFind(app, true), { 'data-find': 'advanced' }),
              popItem(h('span', {}, h('span', { class: 'fp-pop__main' }, t('rb.goTo')), h('span', { class: 'fp-pop__hint' }, shortcut('G'))), () => NT.goToDialog(app), { 'data-find': 'goto' }),
            ),
        }),
        button({ id: 'replace', label: t('menu.replace'), icon: I.replace, text: true, keys: shortcut('H'), run: () => P.openFind(app, true) }),
        dropdown({
          id: 'select',
          label: t('rb.select'),
          icon: I.select,
          text: () => t('rb.select'),
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              popItem(t('menu.selectAll'), () => app.selectAll(), { 'data-select': 'all' }),
              soonItem(t('rb.selectObjects')),
              popItem(t('rb.selectSimilar'), () => NT.selectSimilar(app), { 'data-select': 'similar' }),
            ),
        }),
      ),
    ],
  }
}

function insertGroups(app: FolioApp): Group[] {
  const pv = () => P.getPageView()
  const tableMenu = () => P.tableGridPicker((r, c) => app.run(insertTable(r, c)), () => P.insertTableDialog(app))
  const fieldMenu = () =>
    h(
      'div',
      { class: 'fp-pop__list' },
      heading(t('snip.heading')),
      ...SN.snippetMenuItems(app),
      sep(),
      heading(t('rb.fieldHeading')),
      ...FIELD_NAMES.map((f) =>
        popItem(h('span', {}, h('span', { class: 'fp-pop__main' }, t(`field.${f}` as Key)), h('span', { class: 'fp-pop__hint' }, `{{${f}}}`)), () => app.run(insertField(f as FieldName)), { 'data-field': f }),
      ),
    )
  const hfMenu = (part: 'headers' | 'footers') => () =>
    h(
      'div',
      { class: 'fp-pop__list' },
      popItem(t(part === 'headers' ? 'rb.editHeader' : 'rb.editFooter'), () => pv()?.edit(part), { 'data-hf': part }),
      popItem(t('hf.pageNumbers'), () => P.insertPageNumber(app, part, 'center'), { 'data-hf': `${part}-number` }),
    )
  return [
    {
      id: 'pages',
      label: t('ribbon.pages'),
      controls: [
        col(
          IT.coverPage(app),
          button({ id: 'blank-page', label: t('ribbon.blankPage'), icon: I.blankPage, text: true, run: () => P.insertBlankPage(app) }),
          button({ id: 'page-break', label: t('ribbon.pageBreak'), icon: I.pageBreak, text: true, keys: shortcut('Entrée').replace('Entrée', t('key.enter')), run: () => app.run(insertPageBreak) }),
        ),
      ],
    },
    {
      id: 'tables',
      label: t('ribbon.tables'),
      controls: [dropdown({ id: 'insert-table', label: t('ribbon.table'), icon: I.table, large: true, menu: tableMenu })],
    },
    {
      id: 'illustrations',
      label: t('ribbon.illustrations'),
      controls: [
        split({
          id: 'insert-image',
          label: t('rb.pictures'),
          icon: I.image,
          large: true,
          run: () => P.pickImage(app),
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              popItem(t('rb.picturesDevice'), () => P.pickImage(app), { 'data-image': 'device' }),
              popItem(t('pic.online'), () => O.onlinePicturesDialog(app), { 'data-image': 'online', ...(isOffline() ? { 'aria-disabled': 'true', title: t('offline.blocked') } : {}) }),
              popItem(t('pl.menu'), () => PL.picturesDialog(app), { 'data-image': 'layout' }),
              popItem(t('pic.free'), () => void SH.insertFreePicture(app), { 'data-image': 'free' }),
            ),
        }),
        col(
          dropdown({ id: 'insert-shapes', label: t('rb.shapes'), icon: I.shapes, text: () => t('rb.shapes'), menu: () => SH.shapesGallery(app) }),
          button({ id: 'insert-icons', label: t('rb.icons'), icon: I.iconsIcon, text: true, run: () => ICN.iconsDialog(app) }),
          soon({ id: 'insert-3d', label: t('rb.models3d'), icon: I.cube3d, text: true, drop: true }),
        ),
        col(
          button({ id: 'insert-diagram', label: t('rb.diagram'), icon: I.diagram, text: true, run: () => DG.diagramDialog(app) }),
          button({ id: 'insert-chart', label: t('rb.chart'), icon: I.chart, text: true, run: () => CH.insertChartUi(app) }),
          IT.screenshot(app),
        ),
      ],
    },
    {
      id: 'links',
      label: t('ribbon.links'),
      controls: [
        col(
          split({
            id: 'insert-link',
            label: t('ribbon.link'),
            icon: I.link,
            text: true,
            keys: shortcut('K'),
            run: () => P.linkDialog(app),
            menu: () =>
              h(
                'div',
                { class: 'fp-pop__list' },
                popItem(t('ctx.insertLink'), () => P.linkDialog(app), { 'data-link': 'insert' }),
                popItem(t('rb.linkRemove'), () => app.run(setLink(null)), { 'data-link': 'remove' }),
              ),
          }),
          button({ id: 'insert-bookmark', label: t('rb.bookmark'), icon: I.bookmark, text: true, keys: shortcut('Shift+F5'), run: () => R.bookmarkDialog(app) }),
          button({ id: 'insert-crossref', label: t('rb.crossRef'), icon: I.crossRef, text: true, run: () => R.crossRefDialog(app) }),
        ),
      ],
    },
    {
      id: 'insert-comments',
      label: t('ribbon.comments'),
      controls: [button({ id: 'insert-comment', label: t('rb.commentShort'), icon: I.comment, large: true, keys: shortcut('Alt+M'), enabled: () => !app.alt, run: () => P.getCommentsPane()?.startNew() })],
    },
    {
      id: 'headers-footers',
      label: t('ribbon.headersFooters'),
      controls: [
        col(
          split({ id: 'edit-header', label: t('hf.header'), icon: I.header, text: true, run: () => pv()?.edit('headers'), menu: hfMenu('headers') }),
          split({ id: 'edit-footer', label: t('hf.footer'), icon: I.footer, text: true, run: () => pv()?.edit('footers'), menu: hfMenu('footers') }),
          dropdown({
            id: 'page-numbers',
            label: t('hf.pageNumbers'),
            icon: I.pageNumber,
            text: () => t('hf.pageNumbers'),
            menu: () =>
              h(
                'div',
                { class: 'fp-pop__list' },
                heading(t('hf.top')),
                ...(['left', 'center', 'right'] as const).map((a) => popItem(t(`ribbon.align.${a}` as Key), () => P.insertPageNumber(app, 'headers', a), { 'data-pn': `headers-${a}` })),
                heading(t('hf.bottom')),
                ...(['left', 'center', 'right'] as const).map((a) => popItem(t(`ribbon.align.${a}` as Key), () => P.insertPageNumber(app, 'footers', a), { 'data-pn': `footers-${a}` })),
                popItem(t('hf.pageOfPages'), () => P.insertPageNumber(app, 'footers', 'center', true), { 'data-pn': 'footers-of' }),
                sep(),
                popItem(t('hf.numberFormat'), () => P.pageSetupDialog(app)),
                popItem(t('hf.removeNumbers'), () => P.removePageNumbers(app), { 'data-pn': 'remove' }),
              ),
          }),
        ),
      ],
    },
    {
      id: 'text',
      label: t('ribbon.text'),
      controls: [
        dropdown({ id: 'insert-textbox', label: t('rb.textBox'), icon: I.textBox, large: true, menu: () => SH.textBoxMenu(app) }),
        col(
          dropdown({ id: 'insert-field', label: t('rb.quickParts'), icon: I.quickParts, text: () => t('rb.quickParts'), menu: fieldMenu }),
          TX.decorativeText(app),
          TX.dropCap(app),
        ),
        col(
          IT.signatureLine(app),
          button({ id: 'insert-date', label: t('ribbon.dateTime'), icon: I.date, text: true, run: () => P.dateTimeDialog(app) }),
          OB.objectMenu(app),
        ),
      ],
    },
    {
      id: 'symbols',
      label: t('ribbon.symbols'),
      controls: [
        col(
          split({
            id: 'insert-equation',
            label: t('ribbon.equation'),
            icon: I.equation,
            text: true,
            keys: 'Alt+=',
            run: () => newEquation(app, false),
            menu: () =>
              h(
                'div',
                { class: 'fp-pop__list', role: 'menu' },
                popItem(t('ribbon.equationInline'), () => newEquation(app, false), { 'data-eq': 'inline' }),
                popItem(t('ribbon.equationDisplay'), () => newEquation(app, true), { 'data-eq': 'display' }),
                popItem(t('ribbon.equationNumbered'), () => newEquation(app, true, true), { 'data-eq': 'numbered' }),
                sep(),
                popItem(t('math.convert'), () => convertTex(app), { 'data-eq': 'convert' }),
                popItem(t('ribbon.equationMacros'), () => macrosDialog(app), { 'data-eq': 'macros' }),
              ),
          }),
          dropdown({ id: 'insert-symbol', label: t('ribbon.symbol'), icon: I.symbol, text: () => t('ribbon.symbol'), menu: () => P.symbolPicker(app) }),
          button({ id: 'insert-number', label: t('rb.number'), icon: I.number, text: true, run: () => NT.insertNumberDialog(app) }),
        ),
      ],
    },
    {
      // Propre à Folio Pages : les blocs du format.
      id: 'blocks',
      label: t('rb.blocks'),
      controls: [
        col(
          button({ id: 'insert-rule', label: t('ribbon.rule'), icon: I.rule, text: true, run: () => app.run(insertRule) }),
          button({ id: 'insert-quote', label: t('ribbon.quote'), icon: I.quote, text: true, active: () => styleIdAt(app.state) === 'quote', run: () => app.run(toggleQuote) }),
          button({ id: 'insert-code', label: t('ribbon.codeBlock'), icon: I.codeBlock, text: true, active: () => styleIdAt(app.state) === 'code', run: () => app.run(setCodeBlock()) }),
        ),
        col(button({ id: 'inline-code', label: t('ribbon.inlineCode'), icon: I.code, text: true, active: () => markActive(app.state, m.code), run: () => app.run(toggleFlag('code')) }), WT.calloutButton(app)),
      ],
    },
  ]
}

/** Espacement des paragraphes (Création) : l'espacement du style Normal, donc de tout le document. */
const PARA_SPACING: Record<string, { after: number; line: number } | null> = {
  default: null,
  compact: { after: 4, line: 1.15 },
  normal: { after: 8, line: 1.3 },
  open: { after: 12, line: 1.5 },
  double: { after: 8, line: 2 },
}

function setParagraphSpacing(app: FolioApp, key: string): void {
  const preset = PARA_SPACING[key]
  const cur = { ...(app.styles.normal ?? {}) }
  delete cur.spacing
  delete cur.line
  const normal = preset ? { ...cur, spacing: { before: 0, after: preset.after }, line: preset.line } : cur
  app.setDocAttrs({ styles: pruneStyles({ ...app.styles, normal }) })
  app.focus()
}

function designGroups(app: FolioApp): Group[] {
  const pg = () => P.pageSetup(app)
  const themes = h('div', { class: 'fp-rb-gallery fp-rb-gallery--themes', role: 'listbox', 'aria-label': t('ribbon.themes') })
  let last = ''
  const thumb = (name: string) => {
    const p = THEME_PRESETS[name]
    const cur = app.theme.name === name
    const b = h('button', { type: 'button', class: 'fp-theme-chip' + (cur ? ' is-current' : ''), role: 'option', 'aria-selected': String(cur), 'data-theme-name': name, title: t(`theme.${name}` as Key) }) as HTMLButtonElement
    b.append(
      h('span', { class: 'fp-theme-chip__title', style: `font-family:${P.fontCss(p.fonts.heading)};color:${p.colors.accent1}` }, t('rb.thumbTitle')),
      h('span', { class: 'fp-theme-chip__h1', style: `font-family:${P.fontCss(p.fonts.heading)};color:${p.colors.accent2}` }, t('rb.thumbHeading')),
      h('span', { class: 'fp-theme-chip__lines' }, h('i'), h('i'), h('i')),
      h('span', { class: 'fp-theme-chip__dots' }, ...(['accent1', 'accent2', 'accent3', 'accent4'] as const).map((c) => h('i', { style: `background:${p.colors[c]}` }))),
    )
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', () => P.applyThemePreset(app, name))
    return b
  }
  const renderThemes = () => {
    themes.replaceChildren()
    for (const name of Object.keys(THEME_PRESETS)) themes.append(thumb(name))
  }
  const part = (key: 'colors' | 'fonts', name: string) => {
    app.setDocAttrs({ theme: { ...cloneTheme(app.theme), [key]: JSON.parse(JSON.stringify(THEME_PRESETS[name][key])) } })
    app.focus()
  }
  return [
    {
      id: 'themes',
      label: t('rb.docFormatting'),
      controls: [
        dropdown({
          id: 'themes-menu',
          label: t('rb.themes'),
          icon: I.theme,
          large: true,
          menu: () => h('div', { class: 'fp-pop__list' }, ...Object.keys(THEME_PRESETS).map((name) => popItem(t(`theme.${name}` as Key), () => P.applyThemePreset(app, name), { 'data-theme-name': name, 'aria-checked': String(app.theme.name === name) }))),
        }),
        {
          el: themes,
          update: () => {
            const key = app.theme.name
            if (key !== last) {
              last = key
              renderThemes()
            }
          },
        },
        dropdown({
          id: 'theme-colors',
          label: t('ribbon.themeColors'),
          icon: I.fill,
          large: true,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              ...Object.keys(THEME_PRESETS).map((name) =>
                popItem(
                  h('span', { class: 'fp-pop__swatches' }, ...(['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const).map((c) => h('i', { style: `background:${THEME_PRESETS[name].colors[c]}` })), h('span', {}, t(`theme.${name}` as Key))),
                  () => part('colors', name),
                  { 'data-colors': name },
                ),
              ),
              sep(),
              popItem(t('rb.customColors'), () => P.themeDialog(app, 'colors'), { 'data-colors': 'custom' }),
            ),
        }),
        dropdown({
          id: 'theme-fonts',
          label: t('ribbon.themeFonts'),
          icon: I.fonts,
          large: true,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              ...Object.keys(THEME_PRESETS).map((name) => {
                const f = THEME_PRESETS[name].fonts
                return popItem(
                  h('span', { class: 'fp-pop__fontpair' }, h('span', { style: `font-family:${P.fontCss(f.heading)}` }, f.heading), h('span', { class: 'fp-pop__hint', style: `font-family:${P.fontCss(f.body)}` }, f.body)),
                  () => part('fonts', name),
                  { 'data-fonts': name },
                )
              }),
              sep(),
              popItem(t('rb.customFonts'), () => P.themeDialog(app, 'fonts'), { 'data-fonts': 'custom' }),
            ),
        }),
        col(
          dropdown({
            id: 'para-spacing',
            label: t('rb.paraSpacing'),
            icon: I.paraSpacing,
            text: () => t('rb.paraSpacing'),
            menu: () =>
              h(
                'div',
                { class: 'fp-pop__list' },
                ...Object.keys(PARA_SPACING).map((k) => popItem(k === 'default' ? t('ribbon.lineDefault') : t(`rb.spacing.${k}` as Key), () => setParagraphSpacing(app, k), { 'data-spacing': k })),
              ),
          }),
          soon({ id: 'theme-effects', label: t('rb.effects'), icon: I.effects, text: true, drop: true }),
          PT.setAsDefault(app),
        ),
        // Propre à Folio Pages.
        col(
          button({ id: 'code-colors', label: t('ribbon.codeColors'), icon: I.codeBlock, text: true, run: () => P.themeDialog(app, 'code') }),
          button({ id: 'manage-styles', label: t('style.manage'), icon: I.styles, text: true, run: () => P.stylesManager(app) }),
          button({ id: 'embedded-fonts', label: t('ribbon.embeddedFonts'), icon: I.font, text: true, run: () => P.fontsManager(app) }),
        ),
      ],
    },
    {
      id: 'page-background',
      label: t('page.background'),
      controls: [
        PT.watermark(app),
        dropdown({
          id: 'page-color',
          label: t('page.color'),
          icon: I.fill,
          large: true,
          menu: () => colorPalette({ theme: app.theme, current: pg().background ?? null, noneLabel: t('color.none'), onPick: (c) => P.setPage(app, { background: c ?? undefined }) }),
        }),
        dropdown({
          id: 'page-border',
          label: t('rb.pageBorders'),
          icon: I.border,
          large: true,
          menu: () => colorPalette({ theme: app.theme, current: pg().border ?? null, noneLabel: t('color.none'), onPick: (c) => P.setPage(app, { border: c ?? undefined }) }),
        }),
      ],
    },
  ]
}

const MARGIN_KEYS = ['normal', 'narrow', 'moderate', 'wide'] as const

/** Habillage, alignement, rotation d'une image (Mise en page → Organiser, Format de l'image). */
function wrapMenu(app: FolioApp): HTMLElement {
  const f = figureAt(app.state)
  const set = (attrs: Record<string, unknown>) => app.run(setFigureAttrs(attrs))
  const align = (f?.node.attrs.align as string) ?? 'center'
  return h(
    'div',
    { class: 'fp-pop__list' },
    ...WRAP_MENU.map((w) =>
      popItem(h('span', { class: 'fp-pop__icon-row' }, icon(I[`wrap${w[0].toUpperCase()}${w.slice(1)}` as 'wrapNone']), t(`image.wrap.${w}` as Key)), () => set(wrapAttrs(w, align)), {
        'data-wrap': w,
        'aria-checked': String(f?.node.attrs.wrap === w),
      }),
    ),
    h('hr', { class: 'fp-pop__sep' }),
    // Hors du texte : l'image devient libre (comme une forme), à la même place.
    popItem(h('span', { class: 'fp-pop__icon-row' }, icon(I.wrapFront), t('pic.placeFreely')), () => SH.placeFreely(app), { 'data-wrap-option': 'free', ...(f ? {} : { 'aria-disabled': 'true' }) }),
    soonItem(t('image.wrap.editPoints')),
    // L'image suit toujours son paragraphe ; une position fixe sur la page viendra avec les objets libres.
    popItem(t('image.wrap.moveWithText'), () => undefined, { 'data-wrap-option': 'move', 'aria-checked': 'true' }),
    soonItem(t('image.wrap.fixPosition')),
    h('hr', { class: 'fp-pop__sep' }),
    popItem(
      t('image.wrap.setDefault'),
      () => {
        if (!f) return
        const w = wrapAttrs(f.node.attrs.wrap as Wrap, f.node.attrs.align as string)
        updateSettings({ imageWrap: w.wrap, imageAlign: w.align ?? (f.node.attrs.align as string) })
        toast(t('image.wrap.defaultSet'), { kind: 'success' })
      },
      { 'data-wrap-option': 'default', ...(f ? {} : { 'aria-disabled': 'true' }) },
    ),
  )
}

function alignMenu(app: FolioApp): HTMLElement {
  const f = figureAt(app.state)
  return h(
    'div',
    { class: 'fp-pop__list' },
    ...(['left', 'center', 'right'] as const).map((a) =>
      popItem(h('span', { class: 'fp-pop__icon-row' }, icon(I[`align${a[0].toUpperCase()}${a.slice(1)}` as 'alignLeft']), t(`ribbon.align.${a}` as Key)), () => app.run(setFigureAttrs(alignAttrs(a, (f?.node.attrs.wrap as string) ?? 'none'))), {
        'data-image-align': a,
        'aria-checked': String(f?.node.attrs.align === a),
      }),
    ),
  )
}

function rotateMenu(app: FolioApp): HTMLElement {
  const attr = (k: string) => figureAt(app.state)?.node.attrs[k]
  const set = (attrs: Record<string, unknown>) => app.run(setFigureAttrs(attrs))
  return h(
    'div',
    { class: 'fp-pop__list' },
    popItem(h('span', { class: 'fp-pop__icon-row' }, icon(I.rotateRight), t('image.rotateRight')), () => set({ rotate: (((attr('rotate') as number) || 0) + 90) % 360 }), { 'data-rotate': 'right' }),
    popItem(h('span', { class: 'fp-pop__icon-row' }, icon(I.rotateLeft), t('image.rotateLeft')), () => set({ rotate: (((attr('rotate') as number) || 0) + 270) % 360 }), { 'data-rotate': 'left' }),
    popItem(h('span', { class: 'fp-pop__icon-row' }, icon(I.flipV), t('image.flipV')), () => set({ flip: P.toggleFlip(attr('flip') as string | null, 'v') }), { 'data-rotate': 'flip-v' }),
    popItem(h('span', { class: 'fp-pop__icon-row' }, icon(I.flipH), t('image.flipH')), () => set({ flip: P.toggleFlip(attr('flip') as string | null, 'h') }), { 'data-rotate': 'flip-h' }),
  )
}

function layoutGroups(app: FolioApp): Group[] {
  const pg = () => P.effectivePage(app)
  const hasFig = () => !!figureAt(app.state)
  const num = (id: string, label: string, ic: string, get: () => number | null, set: (v: number | null) => void, unit: string) => {
    const el = h('input', { type: 'text', inputmode: 'decimal', class: 'fp-rb-num', 'data-cmd': id, 'aria-label': label, title: label }) as HTMLInputElement
    el.addEventListener('change', () => {
      const v = el.value.trim() === '' ? null : parseFloat(el.value.replace(',', '.'))
      if (v === null || (Number.isFinite(v) && v >= -100 && v <= 1000)) set(v)
    })
    return {
      el: h('label', { class: 'fp-rb-field' }, icon(ic), h('span', {}, label), el, h('span', { class: 'fp-rb-unit' }, unit)),
      update: () => {
        if (document.activeElement === el) return
        const v = get()
        el.value = v === null ? '' : String(Math.round(v * 10) / 10).replace('.', t('number.decimal'))
      },
    } as Ctl
  }
  const cmOf = (pt: unknown) => (typeof pt === 'number' ? pt / (72 / 2.54) : null)
  const ptFromCm = (cm: number | null) => (cm === null ? null : Math.round(cm * (72 / 2.54) * 2) / 2)
  const ptOf = (k: string) => (typeof paraAttr(app.state, k) === 'number' ? (paraAttr(app.state, k) as number) : null)
  return [
    {
      id: 'page-setup',
      label: t('ribbon.pageSetup'),
      launcher: () => P.pageSetupDialog(app),
      controls: [
        dropdown({ id: 'text-direction', label: t('rb.textDirection'), icon: I.textDirection, large: true, menu: () => textDirectionMenu(app) }),
        dropdown({
          id: 'margins',
          label: t('page.margins'),
          icon: I.margins,
          large: true,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              ...MARGIN_KEYS.map((k) => {
                const mg = P.MARGIN_PRESETS[k]
                return popItem(h('span', {}, h('span', { class: 'fp-pop__main' }, t(`page.margins.${k}` as Key)), h('span', { class: 'fp-pop__hint' }, `${mg.top / 10} / ${mg.left / 10} cm`)), () => P.setPage(app, { margins: { ...mg } }), { 'data-margins': k })
              }),
              sep(),
              popItem(t('page.customMargins'), () => P.pageSetupDialog(app)),
            ),
        }),
        dropdown({
          id: 'orientation',
          label: t('page.orientation'),
          icon: I.orientation,
          large: true,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              ...(['portrait', 'landscape'] as const).map((o) => popItem(t(`page.${o}`), () => P.setPage(app, { orientation: o }), { 'data-orientation': o, 'aria-checked': String(pg().orientation === o) })),
            ),
        }),
        dropdown({
          id: 'page-size',
          label: t('page.size'),
          icon: I.pageSize,
          large: true,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              ...Object.keys(PAPER_SIZES).map((sz) =>
                popItem(h('span', {}, h('span', { class: 'fp-pop__main' }, sz), h('span', { class: 'fp-pop__hint' }, `${PAPER_SIZES[sz][0]} × ${PAPER_SIZES[sz][1]} mm`)), () => P.setPage(app, { size: sz }), { 'data-size': sz, 'aria-checked': String(pg().size === sz) }),
              ),
              sep(),
              popItem(t('page.customSize'), () => P.pageSetupDialog(app)),
            ),
        }),
        dropdown({
          id: 'columns',
          label: t('columns.label'),
          icon: I.columns,
          large: true,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              ...[1, 2, 3, 4].map((c) => popItem(t(`columns.n${c}` as Key), () => app.run(setColumns(c)), { 'data-columns': String(c), 'aria-checked': String((columnsAt(app.state)?.node.attrs.count ?? 1) === c) })),
              sep(),
              popItem(t('columns.rule'), () => {
                const cur = columnsAt(app.state)
                if (cur) app.run(setColumns(cur.node.attrs.count, !cur.node.attrs.rule))
              }, { 'data-columns': 'rule', 'aria-checked': String(!!columnsAt(app.state)?.node.attrs.rule) }),
              popItem(t('columns.break'), () => {
                if (!app.run(insertColumnBreak)) P.notInColumns()
              }, { 'data-columns': 'break' }),
            ),
        }),
        col(
          dropdown({
            id: 'breaks',
            label: t('ribbon.breaks'),
            icon: I.pageBreak,
            text: () => t('ribbon.breaks'),
            menu: () =>
              h(
                'div',
                { class: 'fp-pop__list' },
                heading(t('rb.pageBreaks')),
                popItem(t('ribbon.pageBreak'), () => app.run(insertPageBreak), { 'data-break': 'page' }),
                popItem(t('columns.break'), () => {
                  if (!app.run(insertColumnBreak)) P.notInColumns()
                }, { 'data-break': 'column' }),
                heading(t('section.breaks')),
                ...(['page', 'odd', 'even'] as const).map((st) => popItem(t(`section.start.${st}` as Key), () => app.run(insertSectionBreak(st)), { 'data-break': `section-${st}` })),
              ),
          }),
          PT.lineNumbers(app),
          PT.hyphenation(app),
        ),
      ],
    },
    {
      id: 'layout-paragraph',
      label: t('ribbon.paragraph'),
      launcher: () => P.paragraphDialog(app),
      controls: [
        titledCol(
          t('rb.indent'),
          num('indent-left', t('rb.left'), I.indentMore, () => cmOf(paraAttr(app.state, 'indentLeft')), (v) => app.run(setParaAttrs({ indentLeft: ptFromCm(v) })), 'cm'),
          num('indent-right', t('rb.right'), I.indentLess, () => cmOf(paraAttr(app.state, 'indentRight')), (v) => app.run(setParaAttrs({ indentRight: ptFromCm(v) })), 'cm'),
        ),
        titledCol(
          t('rb.spacing'),
          num('space-before', t('rb.before'), I.paraSpacing, () => ptOf('spaceBefore'), (v) => app.run(setParaAttrs({ spaceBefore: v === null ? null : Math.max(0, v) })), 'pt'),
          num('space-after', t('rb.after'), I.paraSpacing, () => ptOf('spaceAfter'), (v) => app.run(setParaAttrs({ spaceAfter: v === null ? null : Math.max(0, v) })), 'pt'),
        ),
      ],
    },
    {
      id: 'arrange',
      label: t('rb.arrange'),
      controls: [
        dropdown({ id: 'position', label: t('rb.position'), icon: I.position, large: true, enabled: () => SH.hasShapes(app), menu: () => SH.positionMenu(app) }),
        dropdown({ id: 'arrange-wrap', label: t('rb.wrapText'), icon: I.wrapRight, large: true, enabled: () => hasFig() || SH.hasShapes(app), menu: () => (SH.hasShapes(app) ? SH.wrapMenu(app) : wrapMenu(app)) }),
        SH.arrangeSplit(app, 'bring-forward', 'shape.forward', I.bringForward, 'forward', 'front', 'shape.toFront'),
        SH.arrangeSplit(app, 'send-backward', 'shape.backward', I.sendBackward, 'backward', 'back', 'shape.toBack'),
        button({ id: 'selection-pane', label: t('rb.selectionPane'), icon: I.selectionPane, large: true, run: () => SH.toggleSelectionPane(app) }),
        col(
          dropdown({ id: 'arrange-align', label: t('rb.align'), icon: I.alignObj, text: () => t('rb.align'), enabled: () => hasFig() || SH.hasShapes(app), menu: () => (SH.hasShapes(app) ? SH.alignMenu(app) : alignMenu(app)) }),
          dropdown({ id: 'group-objects', label: t('rb.group'), icon: I.groupObj, text: () => t('rb.group'), enabled: () => SH.hasShapes(app), menu: () => SH.groupMenu(app) }),
          dropdown({ id: 'arrange-rotate', label: t('rb.rotate'), icon: I.rotate, text: () => t('rb.rotate'), enabled: () => hasFig() || SH.hasShapes(app), menu: () => (SH.hasShapes(app) ? SH.rotateMenu(app) : rotateMenu(app)) }),
        ),
      ],
    },
    {
      // Propre à Folio Pages : les options de section et des en-têtes.
      id: 'sections',
      label: t('rb.sections'),
      controls: [
        col(
          button({ id: 'section-options', label: t('section.options'), icon: I.props, text: true, run: () => P.sectionDialog(app) }),
          button({ id: 'first-page', label: t('page.firstPage'), icon: I.firstPage, text: true, active: () => pg().firstPage, run: () => P.setPage(app, { firstPage: !pg().firstPage }) }),
          button({ id: 'even-odd', label: t('page.evenOdd'), icon: I.evenOdd, text: true, active: () => pg().evenOdd, run: () => P.setPage(app, { evenOdd: !pg().evenOdd }) }),
        ),
      ],
    },
  ]
}

function referenceGroups(app: FolioApp): Group[] {
  const hasNotes = () => {
    let found = false
    app.state.doc.descendants((n) => {
      if (found) return false
      if (n.type === schema.nodes.note) found = true
      return !found
    })
    return found
  }
  return [
    {
      id: 'toc',
      label: t('toc.label'),
      controls: [
        dropdown({
          id: 'insert-toc',
          label: t('toc.label'),
          icon: I.toc,
          large: true,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              ...[2, 3, 4].map((lv) => popItem(t('toc.levels', { n: lv }), () => app.run(insertBlock(schema.nodes.toc.create({ levels: lv, title: t('toc.defaultTitle') }), 'node')), { 'data-toc': String(lv) })),
              popItem(t('toc.noTitle'), () => app.run(insertBlock(schema.nodes.toc.create({ levels: 3, title: '' }), 'node')), { 'data-toc': 'plain' }),
            ),
        }),
        col(
          dropdown({
            id: 'add-text',
            label: t('rb.addText'),
            icon: I.addText,
            text: () => t('rb.addText'),
            menu: () =>
              h(
                'div',
                { class: 'fp-pop__list' },
                popItem(t('rb.tocNone'), () => app.run(applyStyle('normal')), { 'data-level': '0', 'aria-checked': String(!/^heading/.test(styleIdAt(app.state) ?? '')) }),
                ...[1, 2, 3].map((n) => popItem(t('rb.tocLevel', { n }), () => app.run(applyStyle(`heading${n}`)), { 'data-level': String(n), 'aria-checked': String(styleIdAt(app.state) === `heading${n}`) })),
              ),
          }),
          button({ id: 'update-toc', label: t('rb.updateTable'), icon: I.updateTable, text: true, run: () => toast(t('rb.tocUpToDate'), { kind: 'info' }) }),
        ),
      ],
    },
    {
      id: 'notes',
      label: t('rb.footnotes'),
      launcher: () => P.notesDialog(app),
      controls: [
        button({
          id: 'insert-footnote',
          label: t('note.insertFoot'),
          icon: I.footnote,
          large: true,
          keys: shortcut('Alt+F'),
          enabled: () => !app.alt && canInsertNote(app.state),
          run: () => P.insertNoteUi(app, 'foot'),
        }),
        col(
          button({
            id: 'insert-endnote',
            label: t('note.insertEnd'),
            icon: I.endnote,
            text: true,
            keys: shortcut('Alt+D'),
            enabled: () => !app.alt && canInsertNote(app.state),
            run: () => P.insertNoteUi(app, 'end'),
          }),
          dropdown({
            id: 'note-next',
            label: t('note.next'),
            icon: I.noteNext,
            text: () => t('note.next'),
            menu: () =>
              h(
                'div',
                { class: 'fp-pop__list' },
                popItem(t('note.nextFoot'), () => app.run(gotoNote(1, 'foot')), { 'data-go': 'next-foot' }),
                popItem(t('note.prevFoot'), () => app.run(gotoNote(-1, 'foot')), { 'data-go': 'prev-foot' }),
                popItem(t('note.nextEnd'), () => app.run(gotoNote(1, 'end')), { 'data-go': 'next-end' }),
                popItem(t('note.prevEnd'), () => app.run(gotoNote(-1, 'end')), { 'data-go': 'prev-end' }),
                popItem(t('note.options'), () => P.notesDialog(app), { 'data-go': 'options' }),
              ),
          }),
          button({
            id: 'show-notes',
            label: t('rb.showNotes'),
            icon: I.showNotes,
            text: true,
            enabled: hasNotes,
            run: () => {
              if (!app.run(gotoNote(1, 'foot')) && !app.run(gotoNote(1, 'end'))) toast(t('rb.noNotes'), { kind: 'info' })
            },
          }),
        ),
      ],
    },
    {
      id: 'research',
      label: t('look.research'),
      controls: [button({ id: 'search', label: t('look.search'), icon: I.researchSearch, large: true, enabled: () => !isOffline(), run: () => O.lookUp(app, 'search') })],
    },
    {
      id: 'citations',
      label: t('rb.citations'),
      controls: [
        dropdown({ id: 'insert-citation', label: t('rb.insertCitation'), icon: I.citation, large: true, menu: () => R.citationMenu(app) }),
        col(
          button({ id: 'manage-sources', label: t('rb.manageSources'), icon: I.sources, text: true, run: () => R.sourceManager(app) }),
          dropdown({
            id: 'citation-style',
            label: t('rb.citationStyle'),
            icon: I.styles,
            text: () => `${t('rb.citationStyle')} : ${t(`cite.style.${R.citationStyleOf(app)}` as Key)}`,
            menu: () => R.citationStyleMenu(app),
          }),
          dropdown({ id: 'bibliography', label: t('rb.bibliography'), icon: I.bibliography, text: () => t('rb.bibliography'), menu: () => R.bibliographyMenu(app) }),
        ),
      ],
    },
    {
      id: 'captions',
      label: t('rb.captions'),
      controls: [
        button({ id: 'insert-caption', label: t('rb.insertCaption'), icon: I.caption, large: true, run: () => R.captionDialog(app) }),
        col(
          button({ id: 'table-of-figures', label: t('rb.tableOfFigures'), icon: I.tableOfFigures, text: true, run: () => R.figuresDialog(app) }),
          button({ id: 'update-figures', label: t('rb.updateTable'), icon: I.updateTable, text: true, run: () => toast(t('fig.upToDate'), { kind: 'info' }) }),
          button({ id: 'cross-reference', label: t('rb.crossRef'), icon: I.crossRef, text: true, run: () => R.crossRefDialog(app) }),
        ),
      ],
    },
    {
      id: 'index',
      label: t('rb.index'),
      controls: [
        button({ id: 'mark-entry', label: t('rb.markEntry'), icon: I.markEntry, large: true, keys: 'Alt+Shift+X', run: () => R.markEntryDialog(app) }),
        col(
          button({ id: 'insert-index', label: t('rb.insertIndex'), icon: I.index, text: true, run: () => R.indexDialog(app) }),
          button({ id: 'update-index', label: t('rb.updateIndex'), icon: I.updateTable, text: true, run: () => toast(t('fig.upToDate'), { kind: 'info' }) }),
        ),
      ],
    },
    GL.glossaryGroup(app),
    {
      id: 'authorities',
      label: t('rb.authorities'),
      controls: [
        button({ id: 'mark-citation', label: t('rb.markCitation'), icon: I.authorities, large: true, keys: 'Alt+Shift+I', run: () => R.markCitationDialog(app) }),
        col(
          button({ id: 'insert-authorities', label: t('rb.insertAuthorities'), icon: I.authorities, text: true, run: () => R.authoritiesDialog(app) }),
          button({ id: 'update-authorities', label: t('rb.updateTable'), icon: I.updateTable, text: true, run: () => toast(t('fig.upToDate'), { kind: 'info' }) }),
        ),
      ],
    },
  ]
}

function hfGroups(app: FolioApp): Group[] {
  const pv = () => P.getPageView()
  const pg = () => P.pageSetup(app)
  return [
    {
      id: 'hf-insert',
      label: t('ribbon.insertFields'),
      controls: [
        button({ id: 'hf-page', label: t('field.page'), icon: I.pageNumber, text: true, run: () => app.run(insertField('page')) }),
        button({ id: 'hf-pages', label: t('field.pages'), icon: I.field, text: true, run: () => app.run(insertField('pages')) }),
        button({ id: 'hf-date', label: t('field.date'), icon: I.date, text: true, run: () => app.run(insertField('date')) }),
        button({ id: 'hf-title', label: t('field.title'), icon: I.props, text: true, run: () => app.run(insertField('title')) }),
      ],
    },
    {
      id: 'hf-options',
      label: t('ribbon.tableOptions'),
      controls: [
        button({ id: 'hf-first', label: t('page.firstPage'), icon: I.firstPage, text: true, active: () => pg().firstPage, run: () => {
          pv()?.closeEditor()
          P.setPage(app, { firstPage: !pg().firstPage })
        } }),
        button({ id: 'hf-even', label: t('page.evenOdd'), icon: I.evenOdd, text: true, active: () => pg().evenOdd, run: () => {
          pv()?.closeEditor()
          P.setPage(app, { evenOdd: !pg().evenOdd })
        } }),
      ],
    },
    {
      id: 'hf-close',
      label: t('ribbon.hfClose'),
      controls: [button({ id: 'hf-close', label: t('hf.close'), icon: I.close, large: true, run: () => pv()?.leaveEditor() })],
    },
  ]
}

function viewGroups(app: FolioApp): Group[] {
  const toggle = (id: string, label: string, ic: string, key: 'spellcheck' | 'markdownTyping' | 'reduceImages' | 'showMarks' | 'ribbonAutoHide') =>
    button({
      id,
      label,
      icon: ic,
      text: true,
      active: () => settings()[key],
      run: () => {
        updateSettings({ [key]: !settings()[key] })
        app.view.setProps({})
        app.notifyUi()
      },
    })
  const pv = () => P.getPageView()
  return [
    {
      id: 'views',
      label: t('ribbon.views'),
      controls: [
        button({ id: 'view-read', label: t('read.mode'), icon: I.reading, large: true, active: () => app.reading, run: () => app.setReading(!app.reading) }),
        button({ id: 'view-page', label: t('ribbon.viewPage'), icon: I.pageSize, large: true, active: () => pv()?.mode === 'page' && !app.reading, run: () => pv()?.setMode('page') }),
        button({ id: 'view-web', label: t('ribbon.viewWeb'), icon: I.web, large: true, active: () => pv()?.mode === 'web' && !app.reading, run: () => pv()?.setMode('web') }),
        col(button({ id: 'view-outline', label: t('rb.outline'), icon: I.outline, text: true, active: () => pv()?.mode === 'outline' && !app.reading, run: () => pv()?.setMode('outline') }), button({ id: 'view-draft', label: t('rb.draft'), icon: I.draft, text: true, active: () => pv()?.mode === 'draft' && !app.reading, run: () => pv()?.setMode('draft') })),
      ],
    },
    {
      id: 'immersive',
      label: t('rb.immersive'),
      controls: [
        split({
          id: 'focus-mode',
          label: t('rb.focus'),
          icon: I.focus,
          large: true,
          active: () => isFocusMode(),
          run: () => setFocusMode(app, !isFocusMode()),
          menu: () => {
            const toggle = (key: 'typewriter' | 'dimOthers', label: string) =>
              popItem(label, () => {
                updateSettings({ [key]: !settings()[key] })
                applyFocusClasses()
                app.notifyUi()
                app.focus()
              }, { 'data-focus-opt': key, role: 'menuitemcheckbox', 'aria-checked': String(settings()[key]) })
            return h('div', { class: 'fp-pop__list' }, popItem(isFocusMode() ? t('rb.focusExit') : t('rb.focus'), () => setFocusMode(app, !isFocusMode()), { 'data-focus-opt': 'mode' }), sep(), toggle('typewriter', t('focus.typewriter')), toggle('dimOthers', t('focus.dimOthers')))
          },
        }),
        button({ id: 'immersive-reader', label: t('rb.immersiveReader'), icon: I.immersive, large: true, run: () => openImmersive(app) }),
      ],
    },
    {
      id: 'dark-mode',
      label: t('rb.darkMode'),
      controls: [
        dropdown({
          id: 'appearance',
          label: t('rb.switchModes'),
          icon: I.appearance,
          large: true,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              ...(['system', 'light', 'dark'] as const).map((a) =>
                popItem(t(`appearance.${a}` as Key), () => {
                  updateSettings({ appearance: a })
                  applyAppearance()
                  app.notifyUi()
                }, { 'data-appearance': a, 'aria-checked': String(settings().appearance === a) }),
              ),
            ),
        }),
      ],
    },
    {
      id: 'page-movement',
      label: t('rbs.movement'),
      controls: [
        button({ id: 'movement-vertical', label: t('rb.vertical'), icon: I.vertical, large: true, active: () => !isSideToSide(app), run: () => (isSideToSide(app) ? setSideToSide(app, false) : app.focus()) }),
        button({ id: 'movement-side', label: t('rb.sideToSide'), icon: I.sideToSide, large: true, active: () => isSideToSide(app), run: () => setSideToSide(app, true) }),
      ],
    },
    {
      id: 'show',
      icon: I.eye,
      label: t('ribbon.show'),
      controls: [
        col(
          check({
            id: 'view-ruler',
            label: t('ruler.label'),
            get: () => settings().ruler,
            set: (v) => {
              updateSettings({ ruler: v })
              window.dispatchEvent(new Event('resize'))
              app.notifyUi()
            },
          }),
          check({ id: 'view-gridlines', label: t('rb.gridlines'), get: () => false, set: () => undefined, soon: true }),
          check({ id: 'view-nav', label: t('nav.title'), get: () => !!P.getNavPane()?.visible, set: () => P.getNavPane()?.toggle() }),
        ),
        col(
          check({
            id: 'view-marks',
            label: t('ribbon.marks'),
            get: () => settings().showMarks,
            set: (v) => {
              updateSettings({ showMarks: v })
              app.view.setProps({})
              app.notifyUi()
            },
          }),
          check({ id: 'view-docs', label: t('tree.title'), get: () => !!getDocsPane()?.visible, set: (v) => getDocsPane()?.toggle(v) }),
        ),
      ],
    },
    {
      id: 'zoom',
      label: t('ribbon.zoom'),
      controls: [
        dropdown({
          id: 'zoom-level',
          label: t('ribbon.zoom'),
          icon: I.zoom,
          large: true,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              ...[0.5, 0.75, 0.9, 1, 1.25, 1.5, 2].map((z) => popItem(`${Math.round(z * 100)} %`, () => P.setZoom(z), { 'data-zoom': String(z), 'aria-checked': String(Math.abs(settings().zoom - z) < 0.001) })),
              sep(),
              popItem(t('ribbon.fitWidth'), () => P.fitWidth(), { 'data-zoom': 'width' }),
              popItem(t('rb.onePage'), () => P.fitPage(), { 'data-zoom': 'page' }),
            ),
        }),
        button({ id: 'zoom-100', label: '100 %', icon: I.zoom100, large: true, active: () => settings().zoom === 1, run: () => P.setZoom(1) }),
        col(
          button({ id: 'zoom-page', label: t('rb.onePage'), icon: I.onePage, text: true, run: () => P.fitPage() }),
          button({ id: 'zoom-multi', label: t('rb.multiPage'), icon: I.multiPage, text: true, active: () => isSideToSide(app), run: () => setSideToSide(app, true) }),
          button({ id: 'zoom-fit', label: t('ribbon.fitWidth'), icon: I.fitWidth, text: true, run: () => P.fitWidth() }),
        ),
      ],
    },
    {
      id: 'window',
      label: t('rb.window'),
      controls: [
        button({ id: 'new-window', label: t('rb.newWindow'), icon: I.newWindow, large: true, enabled: () => !!WIN.windowsUi()?.canOpenWindows(), run: () => WIN.windowsUi()?.newWindow() }),
        soon({ id: 'arrange-all', label: t('rb.arrangeAll'), icon: I.arrangeAll, text: true }),
        button({ id: 'split-window', label: t('rb.split'), icon: I.splitWindow, text: true, enabled: () => !!WIN.windowsUi()?.canOpenWindows(), active: () => WIN.windowsUi()?.mode() === 'rows', run: () => WIN.windowsUi()?.split('rows') }),
        col(
          button({ id: 'side-by-side', label: t('rb.viewSideBySide'), icon: I.sideToSide, text: true, enabled: () => !!WIN.windowsUi()?.canOpenWindows(), active: () => WIN.windowsUi()?.mode() === 'columns', run: () => WIN.windowsUi()?.split('columns') }),
          button({ id: 'sync-scroll', label: t('rb.syncScroll'), icon: I.syncScroll, text: true, enabled: () => !!WIN.windowsUi()?.mode(), active: () => !!WIN.windowsUi()?.syncScroll(), run: () => WIN.windowsUi()?.toggleSyncScroll() }),
          button({ id: 'reset-window', label: t('rb.resetWindow'), icon: I.arrangeAll, text: true, enabled: () => !!WIN.windowsUi()?.mode(), run: () => WIN.windowsUi()?.resetPosition() }),
        ),
      ],
    },
    {
      id: 'document',
      label: t('ribbon.document'),
      controls: [button({ id: 'properties', label: t('ribbon.properties'), icon: I.props, large: true, run: () => P.propertiesDialog(app) })],
    },
    {
      // Propre à Folio Pages.
      id: 'options',
      label: t('ribbon.optionsGroup'),
      controls: [
        col(toggle('view-spell', t('ribbon.spellcheck'), I.spell, 'spellcheck'), toggle('view-markdown', t('ribbon.markdownTyping'), I.markdown, 'markdownTyping')),
        col(toggle('view-reduce', t('ribbon.reduceImages'), I.compress, 'reduceImages'), toggle('view-autohide', t('ribbon.autoHide'), I.arrowUp, 'ribbonAutoHide')),
      ],
    },
  ]
}

/** Onglet IA (propre à Folio Pages) : le document en JSON, pour une IA, et retour. */
function aiGroups(app: FolioApp): Group[] {
  return [
    {
      id: 'ai-assistant',
      label: t('aiw.group'),
      controls: [
        button({ id: 'ask-claude', label: t('aiw.askClaude'), icon: I.aiChat, large: true, enabled: () => !isOffline(), run: () => O.askAiDialog(app, 'claude') }),
        button({ id: 'ask-chatgpt', label: t('aiw.askChatGPT'), icon: I.aiChat, large: true, enabled: () => !isOffline(), run: () => O.askAiDialog(app, 'chatgpt') }),
        button({ id: 'ai-paste', label: t('aiw.paste'), icon: I.aiPaste, large: true, run: () => O.pasteAiAnswerDialog(app) }),
      ],
    },
    {
      id: 'ai-guide',
      label: t('ribbon.aiGuide'),
      controls: [button({ id: 'ai-help', label: t('menu.aiHelp'), icon: I.spark, large: true, run: () => aiHelpDialog(app) })],
    },
    {
      id: 'ai-json',
      label: t('ribbon.aiJson'),
      controls: [
        button({ id: 'copy-compact', label: t('menu.copyCompact'), icon: I.copy, large: true, run: () => void copyJson(app, true) }),
        button({ id: 'replace-json', label: t('menu.replaceJson'), icon: I.paste, large: true, run: () => replaceFromJsonDialog(app) }),
        button({ id: 'copy-json', label: t('menu.copyJson'), icon: I.codeBlock, text: true, run: () => void copyJson(app, false) }),
        button({ id: 'ai-convert-tex', label: t('math.convert'), icon: I.equation, text: true, run: () => convertTex(app) }),
      ],
    },
  ]
}

/** Onglet Aide : aide, visite guidée, nouveautés ; mises à jour, mode hors ligne. */
function helpGroups(app: FolioApp): Group[] {
  return [
    {
      id: 'help',
      label: t('ribbon.helpGroup'),
      controls: [
        button({ id: 'shortcuts', label: t('rb.help'), icon: I.help, large: true, keys: 'F1', run: () => P.shortcutsDialog() }),
        button({
          id: 'training',
          label: t('rb.training'),
          icon: I.training,
          large: true,
          run: () => {
            const doc = demoDocument(baseLang())
            openInNewTab(doc, `${doc.meta.title}.html`)
          },
        }),
        col(
          button({ id: 'whats-new', label: t('ribbon.whatsNew'), icon: I.spark, text: true, run: () => whatsNewDialog() }),
          button({ id: 'load-report', label: t('menu.loadReport'), icon: I.props, text: true, run: () => reportDialog(app) }),
          button({ id: 'about', label: t('menu.about'), icon: I.info, text: true, run: () => aboutDialog() }),
        ),
      ],
    },
    {
      id: 'updates',
      label: t('update.group'),
      controls: [
        button({ id: 'check-update', label: t('update.check'), icon: I.share, large: true, enabled: () => !isOffline(), run: () => void checkUpdatesUi(app) }),
        col(
          button({ id: 'offline', label: t('offline.label'), icon: I.offline, text: true, active: () => isOffline(), run: () => toggleOffline(app) }),
          check({ id: 'auto-update', label: t('update.auto'), get: () => settings().autoUpdate, set: (v) => {
              if (v !== settings().autoUpdate) toggleAutoUpdate(app)
            },
          }),
        ),
      ],
    },
  ]
}

function reviewGroups(app: FolioApp): Group[] {
  const pane = () => P.getCommentsPane()
  const has = () => threadsOf(app.state).length > 0 || commentRanges(app.state.doc).size > 0
  const spell = () => {
    updateSettings({ spellcheck: !settings().spellcheck })
    app.view.setProps({})
    app.notifyUi()
  }
  return [
    {
      id: 'proofing',
      label: t('ribbon.proofing'),
      controls: [
        col(
          split({
            id: 'review-spell',
            label: t('rb.spelling'),
            icon: I.spell,
            text: true,
            active: () => settings().spellcheck,
            run: spell,
            menu: () =>
              h(
                'div',
                { class: 'fp-pop__list' },
                popItem(t('rb.spellAsYouType'), spell, { 'data-spell': 'toggle', 'aria-checked': String(settings().spellcheck) }),
                popItem(t('ac.menu'), () => autoCorrectDialog(app), { 'data-spell': 'autocorrect' }),
                h('p', { class: 'fp-pop__note' }, t('rb.spellHint')),
              ),
          }),
          button({ id: 'thesaurus', label: t('rb.thesaurus'), icon: I.thesaurus, text: true, keys: `${t('key.shift')}+F7`, enabled: () => !isOffline(), run: () => O.lookUp(app, 'thesaurus') }),
          button({ id: 'review-words', label: t('ribbon.wordCount'), icon: I.word, text: true, run: () => P.wordCountDialog(app) }),
        ),
      ],
    },
    {
      id: 'speech',
      label: t('rb.speech'),
      controls: [
        button({
          id: 'read-aloud',
          label: t('rb.readAloud'),
          icon: I.readAloud,
          large: true,
          active: () => isSpeaking(),
          run: () => {
            if (isSpeaking()) {
              stopReading()
              app.notifyUi()
            } else if (!readAloud(app)) toast(t('rb.noVoice'), { kind: 'info' })
          },
        }),
      ],
    },
    {
      id: 'accessibility',
      label: t('ribbon.imageAccess'),
      controls: [button({ id: 'check-access', label: t('rb.checkAccess'), icon: I.accessibility, large: true, run: () => accessibilityDialog(app) })],
    },
    {
      id: 'review-language',
      label: t('rb.language'),
      controls: [
        dropdown({
          id: 'language',
          label: t('rb.language'),
          icon: I.language,
          large: true,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              popItem(t('rb.proofLang'), () => {
                P.fontDialog(app)
                setTimeout(() => (document.querySelector('[data-dialog] [data-field="lang"]') as HTMLInputElement | null)?.focus(), 0)
              }, { 'data-item': 'proofing' }),
              heading(t('menu.language')),
              ...availableLanguages().map((l) => popItem(l.name, () => setLang(l.code), { 'data-item': `lang-${l.code}`, 'aria-checked': String(l.code === lang()) })),
              sep(),
              popItem(t('pack.add'), () => void addLanguageUi(), { 'data-item': 'add-language' }),
              popItem(t('pack.manage'), () => languagesDialog(), { 'data-item': 'manage-languages' }),
            ),
        }),
      ],
    },
    {
      id: 'comments',
      label: t('ribbon.comments'),
      controls: [
        col(
          button({ id: 'comment-new', label: t('comment.new'), icon: I.comment, text: true, keys: shortcut('Alt+M'), enabled: () => !app.alt, run: () => pane()?.startNew() }),
          dropdown({
            id: 'comment-delete',
            label: t('comment.deleteMenu'),
            icon: I.delete,
            text: () => t('comment.deleteMenu'),
            enabled: has,
            menu: () => {
              const here = commentsAt(app.state)
              const current = pane()?.current ?? here[0] ?? null
              return h(
                'div',
                { class: 'fp-pop__list' },
                current ? popItem(t('comment.deleteThis'), () => app.run(deleteComment(current)), { 'data-del': 'this' }) : null,
                popItem(t('comment.deleteResolved'), () => app.run(deleteAllComments(true)), { 'data-del': 'resolved' }),
                popItem(t('comment.deleteAll'), () => app.run(deleteAllComments(false)), { 'data-del': 'all' }),
              )
            },
          }),
          button({ id: 'comment-prev', label: t('rb.previous'), icon: I.commentPrev, text: true, enabled: has, run: () => app.run(gotoComment(-1)) }),
        ),
        col(
          button({ id: 'comment-next', label: t('rb.next'), icon: I.commentNext, text: true, enabled: has, run: () => app.run(gotoComment(1)) }),
          button({ id: 'comments-pane', label: t('comment.show'), icon: I.comments, text: true, active: () => !!pane()?.visible, run: () => pane()?.toggle() }),
          button({ id: 'comment-name', label: t('comment.changeName'), icon: I.props, text: true, run: () => P.authorNameDialog() }),
        ),
      ],
    },
    {
      id: 'markup',
      label: t('rb.markup'),
      controls: [
        dropdown({ id: 'filter-markup', label: t('rb.filterMarkup'), icon: I.filterMarkup, large: true, active: () => MK.isFiltered(), menu: () => MK.markupMenu(app) }),
        col(
          dropdown({
            id: 'track-view',
            label: t('track.view'),
            icon: I.trackView,
            text: () => t(`track.view.${settings().trackView}` as Key),
            menu: () =>
              h(
                'div',
                { class: 'fp-pop__list' },
                ...(['simple', 'all', 'final', 'original'] as const).map((v) =>
                  popItem(
                    t(`track.view.${v}` as Key),
                    () => {
                      updateSettings({ trackView: v })
                      app.view.setProps({})
                      app.notifyUi()
                    },
                    { 'data-view': v, 'aria-checked': String(settings().trackView === v), role: 'menuitemradio' },
                  ),
                ),
              ),
          }),
          dropdown({ id: 'show-markup', label: t('rb.showMarkup'), icon: I.showMarkup, text: () => t('rb.showMarkup'), active: () => MK.isFiltered(), menu: () => MK.markupMenu(app) }),
          dropdown({
            id: 'review-pane',
            label: t('rb.reviewPane'),
            icon: I.reviewPane,
            text: () => t('rb.reviewPane'),
            active: () => (P.getReviewPane()?.side ?? 'off') !== 'off',
            menu: () =>
              h(
                'div',
                { class: 'fp-pop__list', role: 'menu' },
                ...(['vertical', 'horizontal'] as const).map((side) =>
                  popItem(t(`review.${side}`), () => {
                    const pane = P.getReviewPane()
                    pane?.show(pane.side === side ? 'off' : side)
                  }, { 'data-review-side': side, role: 'menuitemcheckbox', 'aria-checked': String(P.getReviewPane()?.side === side) }),
                ),
              ),
          }),
        ),
      ],
    },
    {
      id: 'tracking',
      label: t('ribbon.tracking'),
      controls: [
        button({
          id: 'track-toggle',
          label: t('track.toggle'),
          icon: I.track,
          large: true,
          active: () => isTracking(app.state),
          enabled: () => !app.alt,
          run: () => P.toggleTracking(app),
        }),
        dropdown({
          id: 'track-accept',
          label: t('track.accept'),
          icon: I.accept,
          large: true,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              popItem(t('track.acceptHere'), () => P.resolveTracked(app, true, 'here'), { 'data-track': 'accept-here' }),
              popItem(t('track.acceptAll'), () => P.resolveTracked(app, true, 'all'), { 'data-track': 'accept-all' }),
            ),
        }),
        dropdown({
          id: 'track-reject',
          label: t('track.reject'),
          icon: I.reject,
          large: true,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              popItem(t('track.rejectHere'), () => P.resolveTracked(app, false, 'here'), { 'data-track': 'reject-here' }),
              popItem(t('track.rejectAll'), () => P.resolveTracked(app, false, 'all'), { 'data-track': 'reject-all' }),
            ),
        }),
        col(
          button({ id: 'track-prev', label: t('rb.previous'), icon: I.commentPrev, text: true, enabled: () => changesOf(app.state.doc).length > 0, run: () => app.run(gotoChange(-1)) }),
          button({ id: 'track-next', label: t('rb.next'), icon: I.commentNext, text: true, enabled: () => changesOf(app.state.doc).length > 0, run: () => app.run(gotoChange(1)) }),
        ),
      ],
    },
    {
      id: 'compare',
      label: t('rb.compare'),
      controls: [CMP.compareMenu(app)],
    },
    {
      id: 'protect',
      label: t('protect.group'),
      controls: [button({ id: 'protect', label: t('protect.button'), icon: I.lock, large: true, active: () => app.isProtected, enabled: () => !app.lockedReadOnly, run: () => protectDialog(app) })],
    },
    PR.redactGroup(app),
  ]
}

function tableGroups(app: FolioApp): Group[] {
  const inTable = () => isInTable(app.state)
  const tb = (id: string, label: string, ic: string, cmd: Parameters<FolioApp['run']>[0], text = false) =>
    button({ id, label, icon: ic, text, enabled: () => inTable() && app.can(cmd), run: () => app.run(cmd) })
  const styleMenu = () =>
    h(
      'div',
      { class: 'fp-pop__list fp-table-styles' },
      ...TABLE_STYLES.map((s) => popItem(h('span', { class: 'fp-table-style-item' }, h('span', { class: `fp-table-thumb fp-table-thumb--${s}` }), t(`tableStyle.${s}` as Key)), () => app.run(setTableAttrs({ style: s })), { 'data-table-style': s })),
    )
  return [
    {
      id: 'rows-cols',
      label: t('ribbon.rowsCols'),
      controls: [
        tb('row-above', t('table.rowAbove'), I.rowAbove, addRowBefore),
        tb('row-below', t('table.rowBelow'), I.rowBelow, addRowAfter),
        tb('col-left', t('table.colLeft'), I.colLeft, addColumnBefore),
        tb('col-right', t('table.colRight'), I.colRight, addColumnAfter),
        dropdown({
          id: 'table-delete',
          label: t('table.delete'),
          icon: I.delete,
          enabled: inTable,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              popItem(t('table.deleteRow'), () => app.run(deleteRow)),
              popItem(t('table.deleteCol'), () => app.run(deleteColumn)),
              popItem(t('table.deleteTable'), () => app.run(deleteTable)),
            ),
        }),
      ],
    },
    {
      id: 'merge',
      label: t('ribbon.merge'),
      controls: [tb('merge-cells', t('table.merge'), I.merge, mergeCells, true), tb('split-cell', t('table.split'), I.split, splitCell, true)],
    },
    {
      id: 'table-options',
      label: t('ribbon.tableOptions'),
      controls: [
        button({ id: 'header-row', label: t('table.headerRow'), icon: I.header, text: true, enabled: inTable, active: () => P.tableHasHeader(app), run: () => app.run(toggleFirstRowHeader) }),
        button({ id: 'first-column', label: t('table.firstColumn'), icon: I.firstCol, text: true, enabled: inTable, active: () => !!tableAt(app.state)?.node.attrs.firstColumn, run: () => app.run(setTableAttrs({ firstColumn: !tableAt(app.state)?.node.attrs.firstColumn })) }),
        button({
          id: 'repeat-header',
          label: t('table.repeatHeader'),
          icon: I.header,
          text: true,
          enabled: () => inTable() && P.tableHasHeader(app),
          active: () => !!tableAt(app.state)?.node.attrs.repeatHeader,
          run: () => app.run(setTableAttrs({ repeatHeader: !tableAt(app.state)?.node.attrs.repeatHeader })),
        }),
      ],
    },
    {
      id: 'table-style',
      label: t('ribbon.tableStyle'),
      controls: [
        dropdown({ id: 'table-style', label: t('ribbon.tableStyle'), icon: I.table, large: true, enabled: inTable, menu: styleMenu }),
        split({
          id: 'cell-bg',
          label: t('table.cellBg'),
          icon: I.fill,
          enabled: inTable,
          run: () => app.run(setCellAttr('bg', P.lastColor.cell)),
          indicator: () => P.cssOf(app, P.lastColor.cell),
          menu: () =>
            colorPalette({
              theme: app.theme,
              current: null,
              noneLabel: t('color.none'),
              onPick: (c) => {
                if (c) P.lastColor.cell = c
                app.run(setCellAttr('bg', c))
              },
            }),
        }),
        dropdown({
          id: 'table-border',
          label: t('table.borderColor'),
          icon: I.border,
          enabled: inTable,
          menu: () => colorPalette({ theme: app.theme, current: tableAt(app.state)?.node.attrs.border ?? null, noneLabel: t('color.automatic'), onPick: (c) => app.run(setTableAttrs({ border: c })) }),
        }),
      ],
    },
    {
      id: 'table-align',
      label: t('ribbon.tableAlign'),
      controls: [
        tb('valign-top', t('table.vtop'), I.vtop, setCellAttr('valign', null)),
        tb('valign-middle', t('table.vmiddle'), I.vmiddle, setCellAttr('valign', 'middle')),
        tb('valign-bottom', t('table.vbottom'), I.vbottom, setCellAttr('valign', 'bottom')),
        dropdown({ id: 'cell-text-direction', label: t('rb.textDirection'), icon: I.textDirection, enabled: inTable, menu: () => textDirectionMenu(app) }),
        dropdown({
          id: 'table-position',
          label: t('table.position'),
          icon: I.alignCenter,
          enabled: inTable,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              ...(['left', 'center', 'right'] as const).map((a) => popItem(t(`ribbon.align.${a}` as Key), () => app.run(setTableAttrs({ align: a === 'left' ? null : a })), { 'data-align': a })),
            ),
        }),
        button({ id: 'distribute', label: t('table.distribute'), icon: I.distribute, enabled: inTable, run: () => P.distributeColumns(app) }),
      ],
    },
    {
      id: 'table-data',
      label: t('ribbon.tableData'),
      controls: [
        button({ id: 'table-chart', label: t('chart.fromTable'), icon: I.chart, large: true, enabled: inTable, run: () => CH.insertChartUi(app) }),
        dropdown({
          id: 'table-sort',
          label: t('table.sort'),
          icon: I.sort,
          large: true,
          enabled: inTable,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              popItem(t('table.sortAsc'), () => {
                if (!app.run(sortTable(1))) P.tableSortFailed()
              }),
              popItem(t('table.sortDesc'), () => {
                if (!app.run(sortTable(-1))) P.tableSortFailed()
              }),
            ),
        }),
      ],
    },
  ]
}

/** Styles d'image : des cadres (la bordure de l'image), aperçus sur une petite image. */
const PICTURE_FRAMES: (string | null)[] = [null, 'text', 'accent1', 'accent2', 'accent3', 'accent6']

function imageGroups(app: FolioApp): Group[] {
  const fig = () => figureAt(app.state)
  const set = (attrs: Record<string, unknown>) => app.run(setFigureAttrs(attrs))
  const attr = (k: string) => fig()?.node.attrs[k]
  const natRatio = () => {
    const f = fig()
    if (!f) return 0
    const dom = app.view.nodeDOM(f.pos) as HTMLElement | null
    const frame = dom?.querySelector('.fp-figure__frame') as HTMLElement | null
    return frame && frame.offsetWidth ? frame.offsetHeight / frame.offsetWidth : 0
  }
  const sizeField = (id: string, label: string, ic: string, get: () => number, put: (v: number) => void) => {
    const input = h('input', { type: 'number', class: 'fp-rb-num', min: '10', max: '2000', step: '1', 'data-cmd': id, 'aria-label': label, title: label }) as HTMLInputElement
    input.addEventListener('change', () => {
      const v = Number(input.value)
      if (Number.isFinite(v) && v >= 10) put(Math.min(2000, Math.round(v * 2) / 2))
    })
    return {
      el: h('label', { class: 'fp-rb-field' }, icon(ic), input, h('span', { class: 'fp-rb-unit' }, 'pt')),
      update: () => {
        if (document.activeElement === input) return
        const v = fig() ? get() : 0
        input.value = v ? String(Math.round(v)) : ''
      },
    } as Ctl
  }
  const shownWidth = () => {
    const f = fig()
    return f ? (f.node.attrs.width as number) || P.renderedWidthPt(app, f.pos) : 0
  }
  const frames = h('div', { class: 'fp-rb-gallery fp-rb-gallery--frames', role: 'listbox', 'aria-label': t('rb.pictureStyles') })
  const renderFrames = () => {
    frames.replaceChildren()
    for (const c of PICTURE_FRAMES) {
      const cur = (attr('border') ?? null) === c
      const name = c === null ? t('rb.ps.none') : c === 'text' ? t('rb.ps.text') : t('rb.ps.accent', { n: c.replace('accent', '') })
      const b = h('button', { type: 'button', class: 'fp-frame-chip' + (cur ? ' is-current' : ''), role: 'option', 'aria-selected': String(cur), 'data-frame': c ?? 'none', title: name, 'aria-label': name }) as HTMLButtonElement
      b.append(h('span', { class: 'fp-frame-chip__pic', style: c ? `border-color:${P.cssOf(app, c)}` : 'border-color:transparent' }, icon(I.image)))
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', () => set({ border: c }))
      frames.append(b)
    }
  }
  let lastFrame: unknown = undefined
  return [
    {
      id: 'image-adjust',
      label: t('ribbon.imageAdjust'),
      controls: [
        soon({ id: 'remove-bg', label: t('rb.removeBg'), icon: I.removeBg, large: true }),
        PFX.corrections(app),
        col(PFX.pictureColor(app), PFX.artistic(app), PFX.transparency(app)),
        col(
          button({ id: 'compress-images', label: t('image.compress'), icon: I.compress, run: () => void P.compressImages(app) }),
          split({
            id: 'image-replace',
            label: t('image.replace'),
            icon: I.image,
            run: () => P.pickImage(app, true),
            menu: () => h('div', { class: 'fp-pop__list' }, popItem(t('ctx.fromFile'), () => P.pickImage(app, true), { 'data-image': 'replace' })),
          }),
          split({
            id: 'image-reset',
            label: t('rb.resetPicture'),
            icon: I.resetPicture,
            run: () => set({ crop: null, rotate: 0, flip: null, border: null }),
            menu: () =>
              h(
                'div',
                { class: 'fp-pop__list' },
                popItem(t('rb.resetPicture'), () => set({ crop: null, rotate: 0, flip: null, border: null }), { 'data-reset': 'picture' }),
                popItem(t('rb.resetAll'), () => set({ crop: null, rotate: 0, flip: null, border: null, width: 0, height: 0 }), { 'data-reset': 'all' }),
                popItem(t('image.resetSize'), () => set({ width: 0, height: 0 }), { 'data-reset': 'size' }),
                popItem(t('image.fullWidth'), () => set({ width: P.textWidthPt(app), height: 0 }), { 'data-reset': 'full' }),
              ),
          }),
        ),
      ],
    },
    {
      id: 'picture-styles',
      label: t('rb.pictureStyles'),
      launcher: () => P.cropDialog(app),
      controls: [
        {
          el: frames,
          update: () => {
            const key = `${attr('border') ?? null}|${JSON.stringify(app.theme.colors)}`
            if (key !== lastFrame) {
              lastFrame = key
              renderFrames()
            }
          },
        },
        col(
          dropdown({
            id: 'image-border',
            label: t('rb.pictureBorder'),
            icon: I.border,
            text: () => t('rb.pictureBorder'),
            menu: () => colorPalette({ theme: app.theme, current: (attr('border') as string | null) ?? null, noneLabel: t('color.none'), onPick: (c) => set({ border: c }) }),
          }),
          PFX.pictureEffects(app),
          dropdown({ id: 'picture-layout', label: t('rb.pictureLayout'), icon: I.pictureLayout, text: () => t('rb.pictureLayout'), menu: () => PL.layoutMenu(app) }),
        ),
      ],
    },
    {
      id: 'image-access',
      label: t('ribbon.imageAccess'),
      controls: [
        button({ id: 'image-alt', label: t('image.alt'), icon: I.alt, large: true, run: () => P.altTextDialog(app) }),
        button({ id: 'image-caption', label: t('image.caption'), icon: I.caption, large: true, run: () => P.focusCaption(app) }),
      ],
    },
    {
      id: 'image-arrange',
      label: t('rb.arrange'),
      controls: [
        dropdown({ id: 'image-position', label: t('rb.position'), icon: I.position, large: true, menu: () => SH.positionMenu(app) }),
        dropdown({ id: 'image-wrap', label: t('rb.wrapText'), icon: I.wrapRight, large: true, menu: () => wrapMenu(app) }),
        col(
          soon({ id: 'image-forward', label: t('rb.bringForward'), icon: I.bringForward, text: true, drop: true }),
          soon({ id: 'image-backward', label: t('rb.sendBackward'), icon: I.sendBackward, text: true, drop: true }),
          button({ id: 'image-selection-pane', label: t('rb.selectionPane'), icon: I.selectionPane, text: true, run: () => SH.toggleSelectionPane(app) }),
        ),
        col(
          dropdown({ id: 'image-align', label: t('rb.align'), icon: I.alignObj, menu: () => alignMenu(app) }),
          soon({ id: 'image-group', label: t('rb.group'), icon: I.groupObj, drop: true }),
          dropdown({ id: 'image-rotate', label: t('rb.rotate'), icon: I.rotate, menu: () => rotateMenu(app) }),
        ),
      ],
    },
    {
      id: 'image-size',
      label: t('rb.size'),
      launcher: () => P.cropDialog(app),
      controls: [
        split({
          id: 'image-crop',
          label: t('image.crop'),
          icon: I.crop,
          large: true,
          run: () => P.startCrop(app),
          menu: () => h('div', { class: 'fp-pop__list' }, popItem(t('image.crop'), () => P.startCrop(app), { 'data-crop-menu': 'mouse' }), popItem(t('ctx.size'), () => P.cropDialog(app), { 'data-crop-menu': 'dialog' })),
        }),
        col(
          sizeField('image-height', t('rb.height'), I.height, () => {
            const r = natRatio()
            return r ? shownWidth() * r : 0
          }, (v) => {
            const r = natRatio()
            if (r) set({ width: Math.min(2000, Math.round((v / r) * 2) / 2), height: 0 })
          }),
          sizeField('image-width', t('rb.width'), I.width, shownWidth, (v) => set({ width: v, height: 0 })),
        ),
      ],
    },
  ]
}

export const TABS: TabDef[] = [
  { id: 'home', label: () => t('ribbon.tab.home'), groups: homeGroups },
  { id: 'insert', label: () => t('ribbon.tab.insert'), groups: insertGroups },
  { id: 'design', label: () => t('ribbon.tab.design'), groups: designGroups },
  { id: 'layout', label: () => t('ribbon.tab.layout'), groups: layoutGroups },
  { id: 'references', label: () => t('ribbon.tab.references'), groups: referenceGroups },
  { id: 'mailings', label: () => t('ribbon.tab.mailings'), groups: mailingsGroups },
  { id: 'review', label: () => t('ribbon.tab.review'), groups: reviewGroups },
  { id: 'draw', label: () => t('draw.tab'), groups: (app: FolioApp) => DR.drawGroups(app) },
  { id: 'view', label: () => t('ribbon.tab.view'), groups: viewGroups },
  { id: 'developer', label: () => t('form.tab'), groups: (app: FolioApp) => FM.developerGroups(app) },
  { id: 'ai', label: () => t('ribbon.tab.ai'), groups: aiGroups },
  { id: 'help', label: () => t('ribbon.tab.help'), groups: helpGroups },
  { id: 'table', label: () => t('ribbon.tab.table'), groups: tableGroups, when: (app) => isInTable(app.state) },
  { id: 'image', label: () => t('ribbon.tab.image'), groups: imageGroups, when: (app) => !!figureAt(app.state) },
  { id: 'shape', label: () => t('ribbon.shapeFormat'), groups: (app: FolioApp) => SH.shapeGroups(app), when: (app) => selectedShapes(app.view.state).length > 0 && !app.reading },
  { id: 'hf', label: () => t('ribbon.tab.hf'), groups: hfGroups, when: () => !!P.getPageView()?.editing },
  { id: 'outline', label: () => t('ol.tab'), groups: outlineGroups, when: () => P.getPageView()?.mode === 'outline' },
]

/** Onglet Mode Plan (affiché en vue Plan) : niveaux, déplacements, repli, niveaux montrés. */
function outlineGroups(app: FolioApp): Group[] {
  const st = () => OL.outlineState(app.state)
  return [
    {
      id: 'outline-tools',
      label: t('ol.tools'),
      controls: [
        col(
          button({ id: 'ol-promote', label: t('ol.promote'), icon: I.indentLess, text: true, keys: 'Alt+Maj+←'.replace('Maj', t('key.shift')), run: () => app.run(OL.promote) }),
          button({ id: 'ol-demote', label: t('ol.demote'), icon: I.indentMore, text: true, keys: 'Alt+Maj+→'.replace('Maj', t('key.shift')), run: () => app.run(OL.demote) }),
          button({ id: 'ol-body', label: t('ol.toBody'), icon: I.outline, text: true, run: () => app.run(OL.toBody) }),
        ),
        col(
          button({ id: 'ol-up', label: t('ol.moveUp'), icon: I.arrowUp, text: true, keys: 'Alt+Maj+↑'.replace('Maj', t('key.shift')), run: () => app.run(OL.moveSection(-1)) }),
          button({ id: 'ol-down', label: t('ol.moveDown'), icon: I.arrowDown, text: true, keys: 'Alt+Maj+↓'.replace('Maj', t('key.shift')), run: () => app.run(OL.moveSection(1)) }),
        ),
        col(
          button({ id: 'ol-expand', label: t('ol.expand'), icon: I.plus, text: true, run: () => app.run(OL.collapse(false)) }),
          button({ id: 'ol-collapse', label: t('ol.collapse'), icon: I.minus, text: true, run: () => app.run(OL.collapse(true)) }),
          button({ id: 'ol-expand-all', label: t('ol.expandAll'), icon: I.chevronRight, text: true, run: () => app.run(OL.collapse(false, true)) }),
        ),
        col(
          dropdown({
            id: 'ol-level',
            label: t('ol.showLevel'),
            text: () => (st()?.level ? t('ol.levelN', { n: st()!.level }) : t('ol.allLevels')),
            menu: () =>
              h(
                'div',
                { class: 'fp-pop__list', role: 'menu' },
                ...[1, 2, 3, 4, 5, 6, 0].map((n) => popItem(n ? t('ol.levelN', { n }) : t('ol.allLevels'), () => app.run(OL.showLevel(n)), { 'data-ol-level': String(n), role: 'menuitemradio', 'aria-checked': String((st()?.level ?? 0) === n) })),
              ),
          }),
          check({ id: 'ol-first-line', label: t('ol.firstLine'), get: () => !!st()?.firstLine, set: (v) => app.run(OL.setFirstLine(v)) }),
        ),
      ],
    },
    {
      id: 'outline-close',
      label: t('ol.closeGroup'),
      controls: [button({ id: 'ol-close', label: t('ol.close'), icon: I.close, large: true, run: () => P.getPageView()?.setMode('page') })],
    },
  ]
}

// --- barre de mise en forme rapide (menu contextuel) -------------------------

/**
 * La petite barre du menu contextuel : police, taille, agrandir, réduire,
 * pinceau ; gras, italique, souligné, surlignage, couleur, puces, numéros ;
 * styles et nouveau commentaire. Ce sont les contrôles mêmes de l'onglet
 * Accueil (mêmes commandes, même mise à jour).
 */
export function miniToolbar(app: FolioApp, kind: 'text' | 'image' = 'text'): { el: HTMLElement; update: () => void } {
  if (kind === 'image') return imageMiniToolbar(app)
  const all: Ctl[] = []
  const walk = (c: Ctl) => (c.parts ? c.parts.forEach(walk) : all.push(c))
  for (const g of homeGroups(app)) for (const c of g.controls) if (!(c instanceof HTMLElement) && c.el) walk(c)
  const cmdOf = (c: Ctl) => c.el.dataset.cmd ?? (c.el.querySelector('[data-cmd]') as HTMLElement | null)?.dataset.cmd ?? ''
  const pick = (ids: string[]) => ids.map((id) => all.find((c) => cmdOf(c) === id)).filter((c): c is Ctl => !!c)
  const top = pick(['font-family', 'font-size', 'grow', 'shrink', 'clear', 'painter'])
  const bottom = pick(['bold', 'italic', 'underline', 'highlight', 'color', 'bullets', 'numbers'])
  // Styles : un grand bouton à libellé, la liste des styles dessous.
  const styles = [
    dropdown({
      id: 'styles-more',
      label: t('ribbon.styles'),
      icon: I.styles,
      large: true,
      menu: () =>
        h(
          'div',
          { class: 'fp-pop__list' },
          ...['normal', 'heading1', 'heading2', 'heading3', 'title', 'subtitle', 'quote', 'code', 'caption', ...Object.keys(app.styles).filter((id) => !/^(normal|title|subtitle|heading\d|quote|code|caption)$/.test(id))].map((id) =>
            popItem(h('span', { style: P.stylePreviewCss(resolveStyle(app.styles, id)) }, P.styleName(app, id)), () => app.run(applyStyle(id)), { 'data-style-id': id, 'aria-checked': String(styleIdAt(app.state) === id) }),
          ),
          sep(),
          popItem(t('style.new'), () => P.styleDialog(app, null)),
          popItem(t('style.manage'), () => P.stylesManager(app)),
        ),
    }),
  ]
  const comment = button({ id: 'mini-comment', label: t('comment.new'), icon: I.comment, large: true, enabled: () => !app.alt && !app.reading, run: () => P.getCommentsPane()?.startNew() })
  const ctls = [...top, ...bottom, ...styles, comment]
  const el = h(
    'div',
    { class: 'fp-ctx-mini', role: 'toolbar', 'aria-label': t('ctx.miniToolbar') },
    h('div', { class: 'fp-ctx-mini__rows' }, h('div', { class: 'fp-ctx-mini__row' }, ...top.map((c) => c.el)), h('div', { class: 'fp-ctx-mini__row' }, ...bottom.map((c) => c.el))),
    ...styles.map((c) => c.el),
    comment.el,
  )
  return { el, update: () => ctls.forEach((c) => c.update?.()) }
}

/**
 * La barre du menu contextuel d'une image (sélectionnée) : Style (bordure de
 * l'image) et Rogner, comme dans les traitements de texte habituels.
 */
function imageMiniToolbar(app: FolioApp): { el: HTMLElement; update: () => void } {
  const attr = (k: string) => figureAt(app.state)?.node.attrs[k]
  const editable = () => !app.reading && !!figureAt(app.state)
  const style = dropdown({
    id: 'mini-image-style',
    label: t('image.style'),
    icon: I.border,
    large: true,
    enabled: editable,
    menu: () => colorPalette({ theme: app.theme, current: (attr('border') as string | null) ?? null, noneLabel: t('color.none'), onPick: (c) => app.run(setFigureAttrs({ border: c })) }),
  })
  const crop = button({ id: 'mini-image-crop', label: t('image.crop'), icon: I.crop, large: true, enabled: editable, run: () => P.startCrop(app) })
  const ctls = [style, crop]
  const el = h('div', { class: 'fp-ctx-mini fp-ctx-mini--image', role: 'toolbar', 'aria-label': t('ctx.miniToolbar') }, style.el, crop.el)
  return { el, update: () => ctls.forEach((c) => c.update?.()) }
}

// --- ruban -----------------------------------------------------------------------

/** Un contrôle qui s'empile : petit bouton à libellé, liste à libellé, champ numérique. */
function stackable(el: HTMLElement): boolean {
  if (el.matches('.fp-rb-field')) return true
  if (el.matches('.fp-rb-btn.has-text:not(.fp-rb-btn--large)')) return true
  return el.matches('.fp-rb-split') && !!el.querySelector(':scope > .fp-rb-btn.has-text:not(.fp-rb-btn--large)')
}

export class Ribbon {
  readonly el: HTMLElement
  private readonly tabBar: HTMLElement
  private readonly panel: HTMLElement
  private current = 'home'
  private ctls: Ctl[] = []
  private tabButtons = new Map<string, HTMLButtonElement>()
  /** Onglet choisi avant qu'un onglet contextuel ne s'impose. */
  private chosen = 'home'
  private contextualShown = new Set<string>()
  private autoHidden = false
  /** Moment du dernier repli ou dépli (le défilement qui en résulte est ignoré). */
  foldedAt = 0

  constructor(private app: FolioApp) {
    this.tabBar = h('div', { class: 'fp-ribbon__tabs', role: 'tablist', 'aria-label': t('ribbon.label') })
    this.panel = h('div', { class: 'fp-ribbon__panel', role: 'tabpanel', id: 'fp-ribbon-panel' })
    const collapse = h('button', { type: 'button', class: 'fp-ribbon__collapse fp-iconbtn', id: 'fp-ribbon-collapse', 'aria-label': t('ribbon.collapse'), title: t('ribbon.collapse') })
    collapse.append(icon(I.arrowUp))
    collapse.addEventListener('click', () => this.setCollapsed(!settings().ribbonCollapsed))
    // Le panneau est dans un pli : il se replie en douceur (au défilement).
    this.el = h('section', { class: 'fp-ribbon', id: 'fp-ribbon', 'aria-label': t('ribbon.label') }, h('div', { class: 'fp-ribbon__bar' }, this.tabBar, collapse), h('div', { class: 'fp-ribbon__fold' }, this.panel))
    // Le clavier entre dans le ruban : il revient.
    this.el.addEventListener('focusin', () => this.setAutoHidden(false))
    this.el.classList.toggle('is-collapsed', settings().ribbonCollapsed)
    this.render()
    // La fenêtre change de largeur : les groupes se resserrent ou s'élargissent.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.refit()).observe(this.panel)
  }

  /** Ruban replié par le défilement (le choix « ruban masqué » de l'utilisateur est à part). */
  setAutoHidden(on: boolean): void {
    if (this.autoHidden === on) return
    this.autoHidden = on
    this.foldedAt = performance.now()
    this.el.classList.toggle('is-autohidden', on)
  }

  get isAutoHidden(): boolean {
    return this.autoHidden
  }

  /** Ce qui encadre les onglets : à gauche (menu Fichier), à droite (commentaires, mode, partager). */
  setEnds(left: HTMLElement, right: HTMLElement): void {
    const bar = this.el.querySelector('.fp-ribbon__bar')!
    bar.prepend(left)
    bar.insertBefore(right, bar.querySelector('#fp-ribbon-collapse'))
  }

  setCollapsed(on: boolean): void {
    updateSettings({ ribbonCollapsed: on })
    this.el.classList.toggle('is-collapsed', on)
    const b = this.el.querySelector('#fp-ribbon-collapse') as HTMLElement
    if (!on) requestAnimationFrame(() => this.refit())
    b.replaceChildren(icon(on ? I.arrowDown : I.arrowUp))
    b.setAttribute('aria-label', on ? t('ribbon.expand') : t('ribbon.collapse'))
    b.title = b.getAttribute('aria-label')!
  }

  /** Reconstruit tout (changement de langue). */
  render(): void {
    this.tabBar.replaceChildren()
    this.tabButtons.clear()
    for (const tab of TABS) {
      const b = h('button', { type: 'button', class: 'fp-ribbon__tab' + (tab.when ? ' is-contextual' : ''), role: 'tab', 'data-tab': tab.id, id: `fp-tab-${tab.id}`, 'aria-controls': 'fp-ribbon-panel' }, tab.label()) as HTMLButtonElement
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', () => {
        if (settings().ribbonCollapsed) this.setCollapsed(false)
        this.setAutoHidden(false)
        this.chosen = tab.id
        this.select(tab.id)
      })
      b.addEventListener('keydown', (e) => this.tabKeys(e))
      this.tabButtons.set(tab.id, b)
      this.tabBar.append(b)
    }
    this.select(this.current, true)
  }

  private tabKeys(e: KeyboardEvent): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const visible = [...this.tabButtons.values()].filter((b) => !b.hidden)
    const i = visible.indexOf(e.target as HTMLButtonElement)
    const next = visible[(i + (e.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length]
    next.focus()
    next.click()
  }

  select(id: string, force = false): void {
    if (id === this.current && !force) return
    closePopovers()
    this.closeFlyout()
    this.current = id
    for (const [tid, b] of this.tabButtons) {
      b.setAttribute('aria-selected', String(tid === id))
      b.tabIndex = tid === id ? 0 : -1
      b.classList.toggle('is-current', tid === id)
    }
    const tab = TABS.find((x) => x.id === id) ?? TABS[0]
    this.panel.replaceChildren()
    this.panel.setAttribute('aria-labelledby', `fp-tab-${tab.id}`)
    this.ctls = []
    for (const g of tab.groups(this.app)) {
      const body = h('div', { class: 'fp-rb-group__body' })
      // Les petits boutons à libellé s'empilent par trois, en colonnes, sous les grands.
      let stack: HTMLElement | null = null
      const place = (el: HTMLElement) => {
        if (!stackable(el)) {
          stack = null
          body.append(el)
          return
        }
        if (!stack || stack.childElementCount >= 3) {
          stack = h('div', { class: 'fp-rb-stack' })
          body.append(stack)
        }
        stack.append(el)
      }
      for (const c of g.controls) {
        if (c instanceof HTMLElement) place(c)
        else {
          place(c.el)
          this.ctls.push(c)
        }
      }
      body.classList.toggle('has-stacks', !!body.querySelector('.fp-rb-stack, .fp-rb-rows, .fp-rb-gallery-box'))
      const foot = h('div', { class: 'fp-rb-group__foot' }, h('span', {}, g.label))
      if (g.launcher) {
        const l = h('button', { type: 'button', class: 'fp-rb-launch', 'data-launch': g.id, title: `${g.label} — ${t('ribbon.options')}`, 'aria-label': `${g.label} — ${t('ribbon.options')}` })
        l.append(icon(I.more))
        l.addEventListener('mousedown', (e) => e.preventDefault())
        l.addEventListener('click', g.launcher)
        foot.append(l)
      }
      const group = h('div', { class: 'fp-rb-group', 'data-group': g.id, role: 'group', 'aria-label': g.label }, body, foot)
      group.prepend(this.foldButton(group, body, g.label, g.icon))
      this.panel.append(group)
    }
    this.update()
    this.fit()
  }

  // --- ruban trop large : les groupes se resserrent, puis se replient ---------------------

  private flyout: { el: HTMLElement; body: HTMLElement; group: HTMLElement; close: () => void } | null = null
  private fitWidth = 0

  /** Le bouton d'un groupe replié : son icône, son nom ; il ouvre le groupe dessous. */
  private foldButton(group: HTMLElement, body: HTMLElement, label: string, ic?: string): HTMLElement {
    const b = h('button', { type: 'button', class: 'fp-rb-btn fp-rb-btn--large has-text fp-rb-fold', 'data-fold': group.dataset.group ?? '', title: label, 'aria-label': label, 'aria-haspopup': 'true', 'aria-expanded': 'false' }) as HTMLButtonElement
    const first = body.querySelector('svg')
    b.append(ic ? icon(ic) : first ? (first.cloneNode(true) as SVGElement) : icon(I.more), h('span', { class: 'fp-rb-btn__label' }, label), icon(I.caret))
    b.addEventListener('mousedown', (e) => e.preventDefault())
    // Au clavier (detail 0), le focus entre dans le groupe ouvert.
    b.addEventListener('click', (e) => (this.flyout?.group === group ? this.closeFlyout() : this.openFlyout(group, body, b, e.detail === 0)))
    return b
  }

  /** Ouvre un groupe replié sous son bouton (ses contrôles y sont déplacés, puis rendus). */
  private openFlyout(group: HTMLElement, body: HTMLElement, anchor: HTMLElement, keyboard = false): void {
    this.closeFlyout()
    closePopovers()
    const el = h('div', { class: 'fp-rb-flyout', 'data-flyout': group.dataset.group ?? '', role: 'group', 'aria-label': group.getAttribute('aria-label') ?? '' })
    el.dataset.group = group.dataset.group ?? ''
    el.append(body)
    document.body.append(el)
    const r = anchor.getBoundingClientRect()
    el.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 8 - el.offsetWidth)))}px`
    el.style.top = `${Math.round(r.bottom + 4)}px`
    anchor.setAttribute('aria-expanded', 'true')
    const inside = (n: EventTarget | null) => n instanceof Node && (el.contains(n) || anchor.contains(n) || !!(n as Element).closest?.('.fp-popover'))
    const down = (e: PointerEvent) => {
      if (!inside(e.target)) this.closeFlyout()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || popoverOpen()) return
      e.preventDefault()
      this.closeFlyout()
      anchor.focus({ preventScroll: true })
    }
    // Une commande choisie (bouton simple ou élément d'une liste ouverte d'ici) referme le groupe.
    const picked = (e: MouseEvent) => {
      const t = e.target as Element
      const b = t.closest?.('button')
      if (!b) return
      if (el.contains(b) && !b.matches('[aria-haspopup], .fp-rb-combo__arrow, .fp-rb-gallery__more')) setTimeout(() => this.closeFlyout())
      // Un choix dans une liste ouverte d'ici : la liste se ferme, le groupe aussi.
      else if (b.closest('.fp-popover'))
        setTimeout(() => {
          if (!popoverOpen()) this.closeFlyout()
        })
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    document.addEventListener('click', picked, true)
    const close = () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('click', picked, true)
      anchor.setAttribute('aria-expanded', 'false')
      group.querySelector('.fp-rb-fold')!.after(body)
      el.remove()
    }
    this.flyout = { el, body, group, close }
    if (keyboard) (body.querySelector('button:not(:disabled), input, select') as HTMLElement | null)?.focus({ preventScroll: true })
  }

  closeFlyout(): void {
    const f = this.flyout
    this.flyout = null
    f?.close()
  }

  /**
   * Le ruban tient dans sa largeur : s'il déborde, les groupes se resserrent un à
   * un en partant de la droite (petits boutons sans libellé, galeries plus
   * étroites), puis se replient en un bouton qui les ouvre dessous.
   */
  fit(): void {
    this.closeFlyout()
    const panel = this.panel
    const groups = [...panel.querySelectorAll<HTMLElement>(':scope > .fp-rb-group')]
    for (const g of groups) g.classList.remove('is-compact', 'is-folded')
    this.fitWidth = panel.clientWidth
    if (!panel.isConnected || !panel.clientWidth) return
    this.tightenLabels()
    const over = () => panel.scrollWidth > panel.clientWidth + 1
    if (!over()) return
    for (const cls of ['is-compact', 'is-folded']) {
      for (let i = groups.length - 1; i >= 0; i--) {
        const g = groups[i]
        if (cls === 'is-compact' && !g.querySelector('.fp-rb-stack, .fp-rb-gallery')) continue
        const before = g.offsetWidth
        g.classList.add(cls)
        // Sans gain (un seul grand bouton…), le groupe reste comme il était.
        if (g.offsetWidth >= before - 4) {
          g.classList.remove(cls)
          continue
        }
        if (!over()) return
      }
    }
  }

  /**
   * Un grand bouton dont le libellé passe à la ligne garde sinon toute sa
   * largeur maximale : on le ramène à sa plus longue ligne.
   */
  private tightenLabels(): void {
    const range = document.createRange()
    for (const l of this.panel.querySelectorAll<HTMLElement>('.fp-rb-btn--large > .fp-rb-btn__label')) {
      l.style.width = ''
      if (!l.textContent) continue
      range.selectNodeContents(l)
      const lines = [...range.getClientRects()]
      if (lines.length < 2) continue
      l.style.width = `${Math.ceil(Math.max(...lines.map((r) => r.width))) + 1}px`
    }
  }

  /** La largeur a changé (fenêtre, volet) : on refait la place. */
  refit(): void {
    if (this.panel.clientWidth && this.panel.clientWidth !== this.fitWidth) this.fit()
  }

  /** Met à jour l'état des contrôles et les onglets contextuels. */
  update(): void {
    for (const tab of TABS) {
      if (!tab.when) continue
      const show = tab.when(this.app)
      const b = this.tabButtons.get(tab.id)!
      b.hidden = !show
      if (show && !this.contextualShown.has(tab.id)) {
        // Un onglet contextuel apparaît : on l'ouvre (comme pour une image ou un tableau sélectionné).
        this.contextualShown.add(tab.id)
        if ((tab.id === 'image' || tab.id === 'hf') && !settings().ribbonCollapsed) this.select(tab.id)
      } else if (!show && this.contextualShown.has(tab.id)) {
        this.contextualShown.delete(tab.id)
        if (this.current === tab.id) this.select(this.chosen in { table: 1, image: 1, hf: 1 } ? 'home' : this.chosen)
      }
    }
    for (const c of this.ctls) c.update?.()
  }

  get currentTab(): string {
    return this.current
  }
}
