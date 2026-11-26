// Cadre de l'application : barre de titre (titre, menus, recherche de
// commande, état, Enregistrer), ruban, bandeau de démonstration, page, barre
// d'état (statistiques, zoom).

import { installWindows } from './windows'
import * as CHART from './chart'
import type { FolioApp } from '../app'
import {
  applyStyle,
  changeCase,
  clearFormatting,
  insertField,
  insertPageBreak,
  insertRule,
  setCodeBlock,
  toggleFlag,
  toggleQuote,
  type CaseMode,
} from '../editor/commands'
import { stats } from '../editor/stats'
import { insertTable, markValue, setMark } from '../editor/commands'
import { schema } from '../editor/schema'
import type { Key } from '../i18n/dict'
import { availableLanguages, baseLang, lang, onLangChange, setLang, t } from '../i18n/i18n'
import { demoDocument } from '../demo/demo'
import { addLanguageUi, languagesDialog } from './packs'
import { availableUpdate, checkUpdatesUi, openAvailableUpdate, toggleAutoUpdate, toggleOffline, whatsNewDialog } from './updates'
import { isOffline } from '../net'
import { onSettings, settings, updateSettings } from '../settings'
import { aboutDialog, aiHelpDialog, copyJson, replaceFromJsonDialog, reportDialog, reportSummary } from './actions'
import { isDialogOpen } from './dialog'
import { h, icon, shortcut } from './dom'
import { ICONS, MARK, RIBBON_ICONS as I } from './icons'
import { MenuBar, type MenuDef, type MenuEntry } from './menu'
import * as P from './panels'
import * as WT from './writetools'
import * as SN from './snippets'
import * as GL from './glossary'
import * as PR from './privacy'
import { installTypewriter } from './typewriter'
import { autoSaveOn, installAutoSave, toggleAutoSave } from './autosave'
import { installLongSentences, statusWords } from './stats'
import { printDialog } from './print'
import { exportPdfUi } from './pdf'
import * as R from './refs'
import * as O from './online'
import { Popover, closePopovers, popItem, popoverOpen } from './popover'
import { Ribbon, painterActive, painterApply, painterCopy, painterStop } from './ribbon'
import { PageView } from '../layout/pageview'
import { Ruler } from './ruler'
import { NavPane } from './navpane'
import { ReviewPane } from './reviewpane'
import * as DIAG from './diagram'
import * as PLAY from './piclayout'
import * as SHP from './shapes'
import { isTracking } from '../editor/track'
import { readOpened } from '../file/open'
import { CommentsPane } from './comments'
import { editMathAt, newEquation } from './equation'
import { installContextMenu } from './contextmenu'
import { installTooltips } from './tooltip'
import { protectDialog } from './protect'
import { sendDocumentDialog } from './mailings'
import { autoCorrectDialog } from './autocorrect'
import { templateGallery } from './templates'
import { exportDialog } from './exports'
import * as NT from './navtools'
import { SpreadView, isSideToSide, setSideToSide } from './spread'
import { DocsPane } from './docpane'
import { DocTabs } from './doctabs'

export interface Chrome {
  root: HTMLElement
  editorMount: HTMLElement
  attach(app: FolioApp): void
}

export function buildChrome(): Chrome {
  const editorMount = h('div', { class: 'fp-editor', id: 'fp-editor' })
  const page = h('div', { class: 'fp-page', id: 'fp-page' }, editorMount)
  const zoomBox = h('div', { class: 'fp-zoom', id: 'fp-zoom' }, page)
  const canvas = h('main', { class: 'fp-canvas', id: 'fp-canvas' }, zoomBox)
  const root = h('div', { class: 'fp-app', id: 'fp-app' })
  root.append(canvas)
  return {
    root,
    editorMount,
    attach: (app) => attachChrome(app, root, canvas, zoomBox, page),
  }
}

const keys = (k: string) => shortcut(k).replace('Maj', t('key.shift'))

function attachChrome(app: FolioApp, root: HTMLElement, canvas: HTMLElement, zoomBox: HTMLElement, page: HTMLElement): void {
  const title = h('input', {
    class: 'fp-title',
    id: 'fp-title',
    type: 'text',
    maxlength: '500',
    spellcheck: 'true',
    autocomplete: 'off',
  }) as HTMLInputElement
  title.value = app.title()
  title.addEventListener('input', () => app.setTitle(title.value))
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      app.focus()
    }
  })

  const statusText = h('span', { class: 'fp-status__text' })
  const status = h('div', { class: 'fp-status', id: 'fp-status', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'fp-status__dot' }), statusText)
  const saveLabel = h('span', {})
  const autoSave = installAutoSave(app)
  const saveBtn = h('button', { type: 'button', class: 'fp-btn fp-btn--primary fp-save', id: 'fp-save', onclick: () => void app.save() }, icon(ICONS.save), saveLabel)
  // Une version plus récente a été trouvée (recherche à l'ouverture ou sur demande).
  const updateLabel = h('span', { class: 'fp-updatebtn__label' })
  const updateBtn = h('button', { type: 'button', class: 'fp-btn fp-updatebtn', id: 'fp-update', hidden: true, onclick: () => openAvailableUpdate(app) }, icon(ICONS.update), updateLabel)

  const toggleRuler = () => {
    updateSettings({ ruler: !settings().ruler })
    ruler.schedule()
    app.notifyUi()
  }
  const toggleSetting = (key: 'showMarks' | 'spellcheck' | 'markdownTyping' | 'reduceImages') => {
    updateSettings({ [key]: !settings()[key] })
    app.view.setProps({})
    app.notifyUi()
  }

  const menus = (): MenuDef[] => [
    {
      id: 'file',
      label: t('menu.file'),
      entries: () => [
        { id: 'new-blank', label: t('menu.newBlank'), run: () => app.newBlank() },
        { id: 'new-template', label: t('tpl.menu'), run: () => templateGallery(app) },
        { id: 'open', label: t('open.menu'), shortcut: shortcut('O'), run: () => void P.openFileUi(app) },
        { id: 'open-recent', label: t('open.recent'), run: () => void P.recentFilesDialog(app) },
        { separator: true },
        { id: 'save', label: t('menu.save'), shortcut: shortcut('S'), run: () => void app.save() },
        { id: 'autosave', label: t('autosave.menu'), checked: autoSaveOn(app), run: () => void toggleAutoSave(app) },
        { id: 'save-copy', label: t('saveAs.copy'), run: () => void app.saveVariant('copy') },
        { id: 'save-new', label: t('saveAs.new'), run: () => void app.saveVariant('new') },
        { id: 'save-template', label: t('saveAs.template'), run: () => void app.saveVariant('template') },
        { id: 'save-readonly', label: t('saveAs.readonly'), run: () => void app.saveVariant('readonly') },
        { id: 'versions', label: t('versions.menu'), run: () => void P.versionsDialog(app) },
        { id: 'protect', label: t('protect.menu'), run: () => protectDialog(app) },
        { id: 'inspect', label: t('inspect.button'), run: () => void PR.inspectDialog(app) },
        { separator: true },
        { id: 'export-docx', label: t('docx.export.menu'), run: () => void P.exportDocxUi(app) },
        { id: 'export', label: t('exp.menu'), run: () => exportDialog(app) },
        { id: 'print', label: t('menu.print'), shortcut: shortcut('P'), run: () => printDialog(app) },
        { separator: true },
        { id: 'properties', label: t('menu.properties'), run: () => P.propertiesDialog(app) },
      ],
    },
    {
      id: 'edit',
      label: t('menu.edit'),
      entries: () => [
        { id: 'undo', label: t('menu.undo'), shortcut: shortcut('Z'), run: () => app.undo() },
        { id: 'redo', label: t('menu.redo'), shortcut: shortcut('Y'), run: () => app.redo() },
        { separator: true },
        { id: 'cut', label: t('menu.cut'), shortcut: shortcut('X'), run: () => P.clipboardAction(app, 'cut') },
        { id: 'copy', label: t('menu.copy'), shortcut: shortcut('C'), run: () => P.clipboardAction(app, 'copy') },
        { id: 'paste', label: t('menu.paste'), shortcut: shortcut('V'), run: () => void P.pasteFromClipboard(app, false) },
        { id: 'paste-plain', label: t('menu.pastePlain'), shortcut: keys('Maj+V'), run: () => void P.pasteFromClipboard(app, true) },
        { separator: true },
        { id: 'select-all', label: t('menu.selectAll'), shortcut: shortcut('A'), run: () => app.selectAll() },
        { id: 'find', label: t('menu.find'), shortcut: shortcut('F'), run: () => P.openFind(app, false) },
        { id: 'replace', label: t('menu.replace'), shortcut: shortcut('H'), run: () => P.openFind(app, true) },
      ],
    },
    {
      id: 'insert',
      label: t('menu.insert'),
      entries: () => [
        { id: 'm-image', label: `${t('ribbon.image')}…`, run: () => void P.pickImage(app) },
        { id: 'm-table', label: t('table.insertDialog'), run: () => P.insertTableDialog(app) },
        { id: 'm-link', label: `${t('ribbon.link')}…`, shortcut: shortcut('K'), run: () => P.linkDialog(app) },
        { separator: true },
        { id: 'm-page-break', label: t('ribbon.pageBreak'), shortcut: keys(t('key.enter')), run: () => app.run(insertPageBreak) },
        { id: 'm-blank-page', label: t('ribbon.blankPage'), run: () => P.insertBlankPage(app) },
        { id: 'm-equation', label: `${t('ribbon.equation')}…`, shortcut: 'Alt+=', run: () => newEquation(app, false) },
        { id: 'm-equation-display', label: `${t('ribbon.equationDisplay')}…`, run: () => newEquation(app, true) },
        { id: 'm-rule', label: t('ribbon.rule'), run: () => app.run(insertRule) },
        { id: 'm-code', label: t('ribbon.codeBlock'), run: () => app.run(setCodeBlock()) },
        { id: 'm-quote', label: t('ribbon.quote'), run: () => app.run(toggleQuote) },
        { separator: true },
        { id: 'm-footnote', label: t('note.insertFoot'), shortcut: shortcut('Alt+F'), run: () => P.insertNoteUi(app, 'foot') },
        { id: 'm-endnote', label: t('note.insertEnd'), shortcut: shortcut('Alt+D'), run: () => P.insertNoteUi(app, 'end') },
        { id: 'm-comment', label: t('comment.new'), shortcut: shortcut('Alt+M'), run: () => P.getCommentsPane()?.startNew() },
        { separator: true },
        { heading: t('ribbon.field') },
        ...(['page', 'pages', 'title', 'author', 'date'] as const).map((f) => ({ id: `m-field-${f}`, label: t(`field.${f}` as Key), run: () => app.run(insertField(f)) })),
        { id: 'm-date', label: `${t('ribbon.dateTime')}…`, run: () => P.dateTimeDialog(app) },
        { id: 'm-symbol', label: t('symbol.more'), run: () => P.symbolsDialog(app) },
      ],
    },
    {
      id: 'format',
      label: t('menu.format'),
      entries: () => [
        { id: 'm-font', label: `${t('dialog.font')}…`, run: () => P.fontDialog(app) },
        { id: 'm-paragraph', label: `${t('dialog.paragraph')}…`, run: () => P.paragraphDialog(app) },
        { separator: true },
        ...(['bold', 'italic', 'underline', 'strike', 'sup', 'sub'] as const).map((f) => ({
          id: `m-${f}`,
          label: t(`ribbon.${f}` as Key),
          shortcut: { bold: shortcut('B'), italic: shortcut('I'), underline: shortcut('U'), strike: keys('Maj+X'), sup: shortcut('.'), sub: shortcut(',') }[f],
          run: () => app.run(toggleFlag(f)),
        })),
        { id: 'm-clear', label: t('ribbon.clear'), shortcut: shortcut('\\'), run: () => app.run(clearFormatting) },
        { separator: true },
        { heading: t('ribbon.case') },
        ...(['sentence', 'lower', 'upper', 'title'] as CaseMode[]).map((c) => ({ id: `m-case-${c}`, label: t(`case.${c}` as Key), run: () => app.run(changeCase(c)) })),
        { separator: true },
        { heading: t('ribbon.styles') },
        ...['normal', 'title', 'heading1', 'heading2', 'heading3'].map((id) => ({ id: `m-style-${id}`, label: P.styleName(app, id), run: () => app.run(applyStyle(id)) })),
        { id: 'm-styles', label: `${t('style.manage')}…`, run: () => P.stylesManager(app) },
        { id: 'm-theme-colors', label: `${t('ribbon.themeColors')}…`, run: () => P.themeDialog(app, 'colors') },
        { id: 'm-theme-fonts', label: `${t('ribbon.themeFonts')}…`, run: () => P.themeDialog(app, 'fonts') },
        { id: 'm-fonts', label: `${t('ribbon.embeddedFonts')}…`, run: () => P.fontsManager(app) },
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      entries: () => [
        { id: 'm-zoom-in', label: t('ribbon.zoomIn'), run: () => P.zoomBy(0.1) },
        { id: 'm-zoom-out', label: t('ribbon.zoomOut'), run: () => P.zoomBy(-0.1) },
        { id: 'm-zoom-100', label: '100 %', run: () => P.setZoom(1) },
        { id: 'm-zoom-fit', label: t('ribbon.fitWidth'), shortcut: shortcut('0'), run: () => P.fitWidth() },
        { separator: true },
        { id: 'm-ribbon', label: t('menu.ribbon'), checked: !settings().ribbonCollapsed, run: () => ribbon.setCollapsed(!settings().ribbonCollapsed) },
        { id: 'm-ruler', label: t('ruler.label'), checked: settings().ruler, run: () => toggleRuler() },
        { id: 'm-nav', label: t('nav.title'), checked: settings().navPane, run: () => P.getNavPane()?.toggle() },
        { id: 'm-reading', label: t('read.mode'), checked: app.reading, run: () => app.setReading(!app.reading) },
        { id: 'm-side', label: t('rb.sideToSide'), checked: isSideToSide(app), run: () => setSideToSide(app, !isSideToSide(app)) },
        { id: 'm-marks', label: t('ribbon.marks'), checked: settings().showMarks, run: () => toggleSetting('showMarks') },
        { id: 'm-spell', label: t('ribbon.spellcheck'), checked: settings().spellcheck, run: () => toggleSetting('spellcheck') },
        { id: 'm-markdown', label: t('ribbon.markdownTyping'), checked: settings().markdownTyping, run: () => toggleSetting('markdownTyping') },
        { id: 'm-autocorrect', label: t('ac.menu'), run: () => autoCorrectDialog(app) },
        { id: 'm-reduce', label: t('ribbon.reduceImages'), checked: settings().reduceImages, run: () => toggleSetting('reduceImages') },
      ],
    },
    {
      id: 'ai',
      label: t('menu.ai'),
      entries: () => [
        { id: 'ai-help', label: t('menu.aiHelp'), run: () => aiHelpDialog(app) },
        { separator: true },
        { id: 'copy-json', label: t('menu.copyJson'), run: () => void copyJson(app, false) },
        { id: 'copy-compact', label: t('menu.copyCompact'), run: () => void copyJson(app, true) },
        { id: 'replace-json', label: t('menu.replaceJson'), run: () => replaceFromJsonDialog(app) },
      ],
    },
    {
      id: 'help',
      label: t('menu.help'),
      entries: () => [
        { id: 'shortcuts', label: t('menu.shortcuts'), shortcut: 'F1', run: () => P.shortcutsDialog() },
        { id: 'm-word-count', label: t('ribbon.wordCount'), run: () => P.wordCountDialog(app) },
        { separator: true },
        { heading: t('menu.language') },
        ...availableLanguages().map((l) => ({ id: `lang-${l.code}`, label: l.name, checked: l.code === lang(), run: () => setLang(l.code) })),
        { id: 'add-language', label: t('pack.add'), run: () => void addLanguageUi() },
        { id: 'manage-languages', label: t('pack.manage'), run: () => languagesDialog() },
        { separator: true },
        { id: 'check-update', label: t('update.check'), run: () => void checkUpdatesUi(app) },
        { id: 'auto-update', label: t('update.auto'), checked: settings().autoUpdate, run: () => toggleAutoUpdate(app) },
        { id: 'offline', label: t('offline.label'), checked: isOffline(), run: () => toggleOffline(app) },
        { id: 'whats-new', label: t('update.whatsNew'), run: () => whatsNewDialog() },
        { separator: true },
        { id: 'report', label: t('menu.loadReport'), run: () => reportDialog(app) },
        { id: 'about', label: t('menu.about'), run: () => aboutDialog() },
      ],
    },
  ]
  // Seul le menu Fichier est affiché (premier « onglet », comme dans les traitements de texte
  // habituels) ; les autres menus servent de registre à la recherche de commandes et au menu contextuel.
  const menubar = new MenuBar(() => menus().filter((m) => m.id === 'file'))
  P.setCommandRegistry(menus)

  // Recherche d'une commande dans tous les menus (Alt+Q).
  const search = h('input', { type: 'search', class: 'fp-cmdsearch', id: 'fp-cmdsearch', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement
  let searchPop: Popover | null = null
  const runSearch = () => {
    const q = search.value.trim().toLowerCase()
    searchPop?.close(false)
    if (!q) return
    const found: { label: string; hint: string; run: () => void }[] = []
    for (const menu of menus()) {
      for (const e of menu.entries() as MenuEntry[]) {
        if (!('run' in e)) continue
        const label = e.label.replace(/…$/, '')
        if (label.toLowerCase().includes(q) || menu.label.toLowerCase().includes(q)) found.push({ label: e.label, hint: menu.label, run: e.run })
      }
    }
    const list = h('div', { class: 'fp-pop__list fp-cmdsearch__list' })
    if (!found.length) list.append(h('p', { class: 'fp-pop__empty' }, t('menu.noCommand')))
    for (const f of found.slice(0, 12)) {
      list.append(
        popItem(h('span', {}, h('span', { class: 'fp-pop__main' }, f.label), h('span', { class: 'fp-pop__hint' }, f.hint)), () => {
          search.value = ''
          f.run()
        }),
      )
    }
    searchPop = new Popover({ anchor: search, content: list, name: 'command-search', keepFocus: true, onClose: () => (searchPop = null) })
  }
  search.addEventListener('input', runSearch)
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      ;(searchPop?.el.querySelector('[data-pop-item]') as HTMLElement | null)?.focus()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      ;(searchPop?.el.querySelector('[data-pop-item]') as HTMLElement | null)?.click()
    } else if (e.key === 'Escape') {
      search.value = ''
      searchPop?.close(false)
      app.focus()
    }
  })

  // Barre d'outils Accès rapide : annuler, rétablir.
  const qat = h('div', { class: 'fp-qat', role: 'toolbar', 'aria-label': t('menu.edit') })
  const qatButton = (id: string, ic: string, label: () => string, run: () => void) => {
    const b = h('button', { type: 'button', class: 'fp-iconbtn fp-qat__btn', 'data-cmd': id }) as HTMLButtonElement
    b.append(icon(ic))
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', run)
    qat.append(b)
    return { b, label }
  }
  const qatButtons = [qatButton('qat-undo', I.undo, () => `${t('menu.undo')} (${shortcut('Z')})`, () => app.undo()), qatButton('qat-redo', I.redo, () => `${t('menu.redo')} (${shortcut('Y')})`, () => app.redo())]

  const titlebar = h(
    'header',
    { class: 'fp-titlebar' },
    h('div', { class: 'fp-brand', title: 'Folio Pages' }, icon(MARK)),
    h('div', { class: 'fp-titlebar__main' }, h('div', { class: 'fp-titlebar__row' }, title, qat), h('div', { class: 'fp-titlebar__search' }, search)),
    h('div', { class: 'fp-titlebar__side' }, updateBtn, autoSave, status, saveBtn),
  )

  const ribbon = new Ribbon(app)

  // À droite de la barre d'onglets : commentaires, mode (édition, révision, lecture), partager.
  const barButton = (id: string, ic: string, onclick: (b: HTMLButtonElement) => void, extra = '') => {
    const label = h('span', { class: 'fp-barbtn__label' })
    const b = h('button', { type: 'button', class: `fp-barbtn ${extra}`.trim(), id }, icon(ic), label) as HTMLButtonElement
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', () => onclick(b))
    return { b, label }
  }
  const commentsBtn = barButton('fp-comments-btn', I.comments, () => P.getCommentsPane()?.toggle())
  type Mode = 'editing' | 'reviewing' | 'viewing'
  const modeOf = (): Mode => (app.reading ? 'viewing' : isTracking(app.state) ? 'reviewing' : 'editing')
  const setMode = (m: Mode) => {
    if (m === 'viewing') {
      if (!app.reading) app.setReading(true)
      return
    }
    if (app.reading) {
      if (app.lockedReadOnly) return app.editCopy()
      app.setReading(false)
    }
    if ((m === 'reviewing') !== isTracking(app.state)) P.toggleTracking(app)
  }
  const modeBtn = barButton('fp-mode', I.pencil, (b) => {
    const list = h('div', { class: 'fp-pop__list fp-modelist', role: 'menu' })
    for (const m of ['editing', 'reviewing', 'viewing'] as const) {
      list.append(
        popItem(h('span', {}, h('span', { class: 'fp-pop__main' }, t(`mode.${m}` as Key)), h('span', { class: 'fp-pop__hint' }, t(`mode.${m}Hint` as Key))), () => setMode(m), {
          'data-mode': m,
          'aria-checked': String(modeOf() === m),
          role: 'menuitemradio',
        }),
      )
    }
    new Popover({ anchor: b, content: list, name: 'mode' })
  }, 'has-caret')
  modeBtn.b.append(icon(I.caret))
  const shareBtn = barButton('fp-share', I.share, (b) => {
    const list = h(
      'div',
      { class: 'fp-pop__list', role: 'menu' },
      popItem(t('share.ai'), () => void copyJson(app, true), { 'data-share': 'ai' }),
      popItem(t('share.copy'), () => void app.saveVariant('copy'), { 'data-share': 'copy' }),
      popItem(t('share.readonly'), () => void app.saveVariant('readonly'), { 'data-share': 'readonly' }),
      h('hr', { class: 'fp-pop__sep' }),
      popItem(t('share.docx'), () => void P.exportDocxUi(app), { 'data-share': 'docx' }),
      popItem(t('share.pdf'), () => void exportPdfUi(app), { 'data-share': 'pdf' }),
      popItem(t('exp.share'), () => exportDialog(app), { 'data-share': 'export' }),
      popItem(t('mail.sendDoc'), () => sendDocumentDialog(app), { 'data-share': 'email' }),
      h('hr', { class: 'fp-pop__sep' }),
      popItem(t('inspect.title'), () => void PR.inspectDialog(app), { 'data-share': 'inspect' }),
    )
    new Popover({ anchor: b, content: list, name: 'share' })
  }, 'fp-barbtn--accent has-caret')
  shareBtn.b.append(icon(I.caret))
  ribbon.setEnds(menubar.el, h('div', { class: 'fp-ribbon__side' }, commentsBtn.b, modeBtn.b, shareBtn.b))

  const bannerText = h('span', {})
  const bannerBtn = h('button', { type: 'button', class: 'fp-btn fp-btn--primary fp-banner__btn', id: 'fp-new-blank', onclick: () => app.newBlank() })
  const bannerTpl = h('button', { type: 'button', class: 'fp-btn fp-banner__btn', id: 'fp-new-template', onclick: () => templateGallery(app) })
  const banner = h('div', { class: 'fp-banner', id: 'fp-banner', role: 'note' }, icon(ICONS.page), bannerText, bannerTpl, bannerBtn)
  // Mode lecture : une barre le dit, et permet d'en sortir (ou, pour une copie en lecture seule, d'en faire une copie modifiable).
  const readText = h('span', {})
  const readBtn = h('button', {
    type: 'button',
    class: 'fp-btn fp-btn--primary fp-banner__btn',
    id: 'fp-read-exit',
    onclick: () => (app.lockedReadOnly ? app.editCopy() : app.setReading(false)),
  })
  // Disposition des pages en lecture : verticale ou côte à côte.
  const readLayout = h(
    'div',
    { class: 'fp-readbar__layout', role: 'group', 'aria-label': t('rb.pageMovement') },
    h('button', { type: 'button', class: 'fp-readbar__seg', 'data-read-layout': 'vertical', title: t('rb.vertical'), onclick: () => setSideToSide(app, false) }, icon(I.vertical), h('span', {}, t('rb.vertical'))),
    h('button', { type: 'button', class: 'fp-readbar__seg', 'data-read-layout': 'side', title: t('rb.sideToSide'), onclick: () => setSideToSide(app, true) }, icon(I.sideToSide), h('span', {}, t('rb.sideToSide'))),
  )
  const readBar = h('div', { class: 'fp-banner fp-readbar', id: 'fp-readbar', role: 'status' }, icon(ICONS.page), readText, readLayout, readBtn)

  const saveMode = h('span', { class: 'fp-statusbar__mode', id: 'fp-save-mode' })
  const reportChip = h('button', { type: 'button', class: 'fp-chip', id: 'fp-report', onclick: () => reportDialog(app) })
  const words = h('button', { type: 'button', class: 'fp-statusbar__btn', id: 'fp-words', onclick: () => P.wordCountDialog(app) })
  // Suivi des modifications activé : bien visible (un clic le désactive).
  const trackChip = h('button', { type: 'button', class: 'fp-statusbar__btn fp-statusbar__track', id: 'fp-track', onclick: () => P.toggleTracking(app) })
  const zoomLabel = h('button', { type: 'button', class: 'fp-statusbar__btn', id: 'fp-zoom-label', onclick: () => P.setZoom(1) })
  const zoomOut = h('button', { type: 'button', class: 'fp-iconbtn', id: 'fp-zoom-out', onclick: () => P.zoomBy(-0.1) }, icon(I.minus))
  const zoomIn = h('button', { type: 'button', class: 'fp-iconbtn', id: 'fp-zoom-in', onclick: () => P.zoomBy(0.1) }, icon(I.plus))
  // Document protégé : un cadenas dans la barre d'état (un clic ouvre la protection).
  // Mode hors ligne : visible en permanence (un clic le désactive).
  const offlineChip = h('button', { type: 'button', class: 'fp-statusbar__btn fp-statusbar__offline', id: 'fp-offline', onclick: () => toggleOffline(app) }, icon(I.offline), h('span', {}))
  const lockChip = h('button', { type: 'button', class: 'fp-statusbar__btn fp-statusbar__lock', id: 'fp-lock', onclick: () => protectDialog(app) }, icon(I.lock), h('span', {}))
  const statusbar = h('footer', { class: 'fp-statusbar' }, saveMode, lockChip, offlineChip, reportChip, h('span', { class: 'fp-statusbar__spacer' }), words, h('span', { class: 'fp-statusbar__zoom' }, zoomOut, zoomLabel, zoomIn))

  // Vue page : feuilles, coupure en pages, en-têtes et pieds de page.
  const pageView = new PageView(app, page, canvas, zoomBox)
  P.setPageView(pageView)
  const pageCount = h('button', { type: 'button', class: 'fp-statusbar__btn', id: 'fp-pages', onclick: () => P.pageSetupDialog(app) })
  statusbar.insertBefore(pageCount, words)
  statusbar.insertBefore(trackChip, pageCount)

  // Volet de navigation, à gauche de la page.
  const nav = new NavPane(app, (pos) => (pageView.mode === 'page' ? app.pagesInfo?.format(app.pagesInfo.pageAt(pos)) ?? null : null))
  P.setNavPane(nav)
  const workspace = h('div', { class: 'fp-workspace' })
  canvas.replaceWith(workspace)
  // Volet des commentaires, à droite.
  const comments = new CommentsPane(app)
  P.setCommentsPane(comments)
  // Volet « Rechercher » (synonymes, Wikipédia), à droite, ouvert à la demande.
  const lookup = new O.LookupPane(app)
  O.setLookupPane(lookup)
  // Le texte et, fractionné, son second volet.
  const splitBox = h('div', { class: 'fp-splitbox' })
  // Volet Sélection (formes), à droite, ouvert depuis Format de la forme.
  const selPane = new SHP.SelectionPane(app)
  SHP.setSelectionPane(selPane)
  // Volet Documents (les dossiers et documents du fichier), tout à gauche.
  const docsPane = new DocsPane(app)
  workspace.append(docsPane.el, nav.el, splitBox, comments.el, lookup.el, selPane.el)
  splitBox.append(canvas)
  // Volet Vérifications : à gauche du texte, ou dessous.
  const review = new ReviewPane(app, (side, el) => (side === 'vertical' ? nav.el.after(el) : splitBox.append(el)))
  P.setReviewPane(review)
  installWindows(app, splitBox, canvas)
  // Mode lecture, pages côte à côte : par-dessus la page.
  new SpreadView(app, pageView, canvas, zoomBox, page)

  const findHost = h('div', { class: 'fp-findhost', id: 'fp-findhost' })
  canvas.prepend(findHost)
  P.setFindHost(findHost)

  const ruler = new Ruler(app, page, canvas)
  installTypewriter(app, canvas)
  installLongSentences(app)
  root.prepend(titlebar, ribbon.el, banner, readBar, ruler.el)
  // Plusieurs documents dans le fichier : leurs onglets, au-dessus de la barre d'état.
  const docTabs = new DocTabs(app)
  root.append(docTabs.el, statusbar)
  app.scrollHooks = { get: () => canvas.scrollTop, set: (y) => requestAnimationFrame(() => (canvas.scrollTop = y)) }
  app.onBeforeSwitch = () => {
    closePopovers()
    pageView.closeEditor()
  }

  // --- le ruban se replie quand on descend dans le document, et revient quand on remonte
  // (ou en haut du document). Le défilement causé par le repli lui-même est ignoré.
  let lastY = 0
  let run = 0
  // Seul un défilement voulu (molette, doigt, barre de défilement, Page suivante…) replie le ruban :
  // jamais celui que fait l'application pour garder le curseur en vue.
  let userScrollAt = 0
  const userScroll = () => (userScrollAt = performance.now())
  canvas.addEventListener('wheel', userScroll, { passive: true })
  canvas.addEventListener('touchmove', userScroll, { passive: true })
  canvas.addEventListener('pointerdown', (e) => {
    if (e.target === canvas) userScroll()
  })
  canvas.addEventListener('keydown', (e) => {
    if (['PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key) && (e.key !== ' ' || e.target === canvas)) userScroll()
  })
  canvas.addEventListener(
    'scroll',
    () => {
      const y = canvas.scrollTop
      const d = y - lastY
      lastY = y
      if (!settings().ribbonAutoHide || settings().ribbonCollapsed || app.reading) {
        ribbon.setAutoHidden(false)
        return
      }
      // En haut du document : toujours déplié.
      if (y < 16) {
        run = 0
        ribbon.setAutoHidden(false)
        return
      }
      if (performance.now() - ribbon.foldedAt < 380) return
      if (performance.now() - userScrollAt > 400) {
        run = 0
        return
      }
      run = Math.sign(d) === Math.sign(run) ? run + d : d
      if (run > 36) ribbon.setAutoHidden(true)
      else if (run < -90) ribbon.setAutoHidden(false)
    },
    { passive: true },
  )

  // --- zoom : la page est mise à l'échelle, sa boîte garde la place réelle.
  const applyZoom = (z: number) => {
    page.style.transform = z === 1 ? '' : `scale(${z})`
    zoomBox.style.width = z === 1 ? '' : `${page.offsetWidth * z}px`
    zoomBox.style.height = z === 1 ? '' : `${page.offsetHeight * z}px`
    zoomBox.classList.toggle('is-zoomed', z !== 1)
    zoomLabel.textContent = `${Math.round(z * 100)} %`
    app.notifyUi()
  }
  const fit = () => {
    const avail = canvas.clientWidth - 32
    return Math.max(0.25, Math.min(4, Math.floor((avail / page.offsetWidth) * 100) / 100))
  }
  // Une page : la hauteur du papier (mm → px) dans la hauteur visible.
  const fitOne = () => {
    const pg = P.pageSetup(app)
    const mm = pg.orientation === 'landscape' ? pg.width : pg.height
    const px = (mm * 96) / 25.4
    return Math.max(0.25, Math.min(4, Math.floor(((canvas.clientHeight - 40) / px) * 100) / 100))
  }
  P.setZoomHandlers(applyZoom, fit, fitOne)
  new ResizeObserver(() => {
    if (settings().zoom !== 1) {
      zoomBox.style.height = `${page.offsetHeight * settings().zoom}px`
      zoomBox.style.width = `${page.offsetWidth * settings().zoom}px`
    }
  }).observe(page)
  applyZoom(settings().zoom)
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      P.zoomBy(e.deltaY < 0 ? 0.1 : -0.1)
    },
    { passive: false },
  )

  // --- statistiques : recalculées au plus toutes les 300 ms.
  let countTimer: ReturnType<typeof setTimeout> | null = null
  const renderCount = () => {
    countTimer = null
    const all = stats(app.state.doc).words
    const { from, to, empty } = app.state.selection
    const shown = statusWords(app, all, empty ? null : stats(app.state.doc, from, to).words)
    words.textContent = shown.text
    // Objectif d'écriture : une jauge sous le nombre de mots.
    words.classList.toggle('has-goal', shown.pct !== null)
    words.classList.toggle('is-done', shown.pct === 100)
    words.style.setProperty('--goal', String((shown.pct ?? 0) / 100))
    if (shown.pct !== null) words.title = `${shown.pct} %`
    else words.removeAttribute('title')
  }
  const scheduleCount = () => {
    if (!countTimer) countTimer = setTimeout(renderCount, 300)
  }

  const renderTexts = () => {
    title.placeholder = t('title.placeholder')
    title.setAttribute('aria-label', t('title.label'))
    saveLabel.textContent = t('save.button')
    saveBtn.title = `${t('save.button')} (${shortcut('S')})`
    bannerText.textContent = t('demo.banner')
    bannerBtn.textContent = t('demo.newBlank')
    bannerTpl.textContent = t('tpl.banner')
    saveMode.textContent = app.writesInPlace ? t('save.modeInPlace') : t('save.modeDownload')
    saveMode.title = app.writesInPlace ? '' : t('save.modeDownloadHelp')
    search.placeholder = t('menu.commandPlaceholder')
    search.setAttribute('aria-label', t('menu.commandSearch'))
    commentsBtn.label.textContent = t('bar.comments')
    commentsBtn.b.title = t('comment.show')
    shareBtn.label.textContent = t('bar.share')
    modeBtn.b.setAttribute('aria-label', t('bar.mode'))
    for (const { b, label } of qatButtons) {
      b.title = label()
      b.setAttribute('aria-label', label())
    }
    zoomOut.setAttribute('aria-label', t('ribbon.zoomOut'))
    zoomIn.setAttribute('aria-label', t('ribbon.zoomIn'))
    zoomLabel.title = '100 %'
    words.title = t('ribbon.wordCount')
    root.style.setProperty('--fp-label-pagebreak', JSON.stringify(t('ribbon.pageBreak')))
    root.style.setProperty('--fp-label-section', JSON.stringify(t('section.marker')))
    menubar.render()
    ribbon.render()
    renderCount()
    app.view.setProps({}) // met à jour la langue et l'étiquette de l'éditeur
  }

  const update = () => {
    const s = app.status()
    status.dataset.state = s
    const name = app.savedName
    statusText.textContent = s === 'saved' && name ? t('status.savedIn', { name }) : t(`status.${s}` as Key)
    if (document.activeElement !== title && title.value !== app.title()) title.value = app.title()
    document.title = app.windowTitle()
    banner.hidden = !app.isDemo || app.reading
    readBar.hidden = !app.reading
    readText.textContent = app.lockedReadOnly ? `${t('read.lockedBar')} ${t('read.bar')}` : t('read.bar')
    readBtn.textContent = app.lockedReadOnly ? t('read.editCopy') : t('read.exit')
    for (const b of Array.from(readLayout.children)) b.setAttribute('aria-pressed', String(((b as HTMLElement).dataset.readLayout === 'side') === settings().readSpread))
    root.classList.toggle('is-reading', app.reading)
    title.readOnly = app.reading
    saveBtn.disabled = s === 'saving' || app.lockedReadOnly
    const summary = reportSummary(app.report)
    reportChip.hidden = !summary
    reportChip.textContent = summary ?? ''
    root.classList.toggle('is-dirty', app.dirty)
    ribbon.update()
    scheduleCount()
    const n = pageView.pageCount
    const cur = pageView.mode === 'page' ? pageView.currentPageIndex() + 1 : 1
    pageCount.textContent = pageView.mode === 'page' ? t('pages.status', { page: Math.min(cur, n), n }) : pageView.mode === 'outline' ? t('ol.tab') : t('pages.web')
    lockChip.hidden = !app.isProtected
    offlineChip.hidden = !isOffline()
    const release = availableUpdate()
    updateBtn.hidden = !release
    if (release) {
      updateLabel.textContent = t('update.button')
      updateBtn.setAttribute('aria-label', t('update.button'))
      updateBtn.title = t('update.buttonHint', { version: release.version, current: __FOLIO_VERSION__ })
    }
    ;(offlineChip.lastChild as HTMLElement).textContent = t('offline.chip')
    ;(lockChip.lastChild as HTMLElement).textContent = t('protect.chip')
    trackChip.hidden = !isTracking(app.state)
    trackChip.textContent = t('track.on')
    const mode = modeOf()
    modeBtn.label.textContent = t(`mode.${mode}` as Key)
    modeBtn.b.dataset.mode = mode
    modeBtn.b.title = `${t('bar.mode')} : ${t(`mode.${mode}Hint` as Key)}`
    commentsBtn.b.classList.toggle('is-active', !!P.getCommentsPane()?.visible)
    commentsBtn.b.setAttribute('aria-pressed', String(!!P.getCommentsPane()?.visible))
  }

  onLangChange(() => {
    renderTexts()
    update()
    // La démonstration encore intacte suit la langue de l'interface.
    app.relocalizeDemo(demoDocument(baseLang()))
  })
  app.onChange(update)
  // Un réglage affiché dans le ruban (la messagerie choisie, par exemple) : on le met à jour.
  onSettings(() => ribbon.update())
  renderTexts()
  update()

  // --- fichiers déposés, ouverture par le système
  app.onFileDrop = (file) => void P.openDroppedFile(app, file)
  // Hors de l'éditeur aussi : un fichier lâché n'est jamais ouvert par le navigateur à la place de l'application.
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
  })
  window.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (!files.length) return
    e.preventDefault()
    const doc = files.find((f) => !f.type.startsWith('image/'))
    if (doc) void P.openDroppedFile(app, doc)
  })
  // Application installée qui reçoit un fichier du système (Chrome, Edge) : on l'ouvre.
  const launch = (window as unknown as { launchQueue?: { setConsumer(fn: (p: { files: readonly FileSystemFileHandle[] }) => void): void } }).launchQueue
  launch?.setConsumer(async (params) => {
    const h0 = params.files[0] as unknown as import('../file/save').FsHandle | undefined
    if (h0) await P.openRecognized(app, await readOpened(await h0.getFile(), h0))
  })

  // --- raccourcis traités par l'interface
  app.onShortcut = (name) => {
    switch (name) {
      case 'mark-entry':
        R.markEntryDialog(app)
        return true
      case 'thesaurus':
        O.lookUp(app, 'thesaurus')
        return true
      case 'goto':
        NT.goToDialog(app)
        return true
      case 'mark-citation':
        R.markCitationDialog(app)
        return true
      case 'bookmark':
        R.bookmarkDialog(app)
        return true
      case 'link':
        P.linkDialog(app)
        return true
      case 'find':
        P.openFind(app, false)
        return true
      case 'replace':
        P.openFind(app, true)
        return true
      case 'painter-copy':
        painterCopy(app)
        return true
      case 'painter-paste':
        return painterApply(app)
      case 'footnote':
        return P.insertNoteUi(app, 'foot')
      case 'endnote':
        return P.insertNoteUi(app, 'end')
      case 'comment':
        P.getCommentsPane()?.startNew()
        return true
      case 'equation':
        newEquation(app, false)
        return true
      case 'snippet':
        return SN.expandAtCursor(app)
      case 'define-term':
        GL.defineTermDialog(app)
        return true
      case 'highlight': {
        // Comme le bouton du surligneur ; sur du texte déjà surligné, l'enlève.
        const on = markValue(app.state, schema.marks.highlight, 'value')
        app.run(setMark(schema.marks.highlight, on ? null : { value: P.lastColor.highlight }))
        return true
      }
      case 'table':
        // Un tableau de 3 × 3 avec sa ligne d'en-tête (le ruban propose d'autres tailles).
        return app.run(insertTable(3, 3))
      case 'picture':
        P.pickImage(app)
        return true
    }
    return false
  }
  app.editMath = (view, pos) => editMathAt(app, view, pos)
  app.editLink = () => P.linkDialog(app)
  app.calloutMenu = (pos, anchor) => WT.calloutMenu(app, pos, anchor)
  app.editChart = (pos) => CHART.editChartAt(app, pos)
  app.editDiagram = (pos) => DIAG.editDiagramAt(app, pos)
  app.editPictures = (pos) => PLAY.editPicturesAt(app, pos)
  app.editShapeText = (pos, host, first) => SHP.editShapeText(app, pos, host, first)
  void SN.loadSnippets()
  installContextMenu(app)
  installTooltips()
  // Le pinceau s'applique à la sélection faite à la souris ; double-clic : il reste actif.
  app.view.dom.addEventListener('mouseup', () => {
    if (painterActive()) setTimeout(() => painterApply(app), 0)
  })
  ribbon.el.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('[data-cmd="painter"]')) painterCopy(app, true)
  })

  const editingText = (el: Element | null) => !!el && (el.matches('input, textarea, select, [contenteditable="true"]') || !!el.closest('[contenteditable="true"]'))

  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && !e.altKey && k === 's') {
      e.preventDefault()
      if (!isDialogOpen()) void app.save()
      return
    }
    // Ctrl+O : notre « Ouvrir » (celui du navigateur quitterait l'application).
    if (mod && !e.altKey && !e.shiftKey && k === 'o') {
      e.preventDefault()
      if (!isDialogOpen()) void P.openFileUi(app)
      return
    }
    if (isDialogOpen()) return
    // Alt+Page suivante / précédente : l'onglet de document suivant ou précédent.
    if (e.altKey && !mod && !e.shiftKey && (e.key === 'PageDown' || e.key === 'PageUp')) {
      const tabs = app.tabs
      if (tabs.length < 2) return
      e.preventDefault()
      const i = tabs.findIndex((d) => d.active)
      const next = tabs[(i + (e.key === 'PageDown' ? 1 : tabs.length - 1)) % tabs.length]
      app.switchToKey(next.key)
      app.focus()
      return
    }
    if (mod && !e.altKey && !e.shiftKey && k === 'p') {
      e.preventDefault()
      printDialog(app)
    } else if (e.key === 'F1' || (e.key === '?' && !mod && !editingText(document.activeElement))) {
      e.preventDefault()
      P.shortcutsDialog()
    } else if (mod && !e.shiftKey && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) {
      e.preventDefault()
      P.fitWidth()
    } else if (e.altKey && !mod && k === 'q') {
      e.preventDefault()
      search.focus()
    } else if (mod && e.key === 'F1') {
      e.preventDefault()
      ribbon.setCollapsed(!settings().ribbonCollapsed)
    } else if (e.key === 'Escape' && !e.defaultPrevented && app.reading && !app.lockedReadOnly && !isDialogOpen()) {
      app.setReading(false)
    } else if (e.key === 'Escape' && painterActive()) {
      painterStop(app)
    } else if (mod && !e.altKey && !e.shiftKey && (k === 'f' || k === 'h') && !e.defaultPrevented) {
      // Partout dans l'application (dans l'éditeur, son propre raccourci l'a déjà traité).
      e.preventDefault()
      P.openFind(app, k === 'h')
    } else if ((mod || e.altKey) && !e.defaultPrevented && !editingText(document.activeElement) && !popoverOpen()) {
      // Le focus est sur un bouton du ruban, un volet, le fond de la page : les raccourcis
      // d'édition (Ctrl+Z, Ctrl+Y, Ctrl+B…) vont quand même au document, comme d'habitude.
      const view = app.alt ?? app.view
      let handled = false
      view.someProp('handleKeyDown', (f) => (handled = !!f(view, e)))
      if (handled) {
        e.preventDefault()
        view.focus()
      }
    }
  })
  // Un fichier lâché hors de la page ne doit pas remplacer l'application.
  for (const type of ['dragover', 'drop'] as const) {
    window.addEventListener(type, (e) => {
      if (e.dataTransfer?.types?.includes('Files') && !(e.target as Element | null)?.closest?.('.fp-prose')) e.preventDefault()
    })
  }
  // Clic dans la marge grise : on reprend l'écriture.
  canvas.addEventListener('mousedown', (e) => {
    if (e.target === canvas || e.target === zoomBox) {
      e.preventDefault()
      if (popoverOpen()) closePopovers()
      // Un en-tête ouvert se ferme : on revient au texte.
      pageView.leaveEditor()
    }
  })
}
