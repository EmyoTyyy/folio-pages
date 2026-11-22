// Menu contextuel (clic droit), à la manière des traitements de texte
// habituels : une zone « Rechercher dans les menus », les commandes utiles
// là où l'on a cliqué (texte, lien, formule, tableau, image), et une petite
// barre de mise en forme dessous. Maj+clic droit garde le menu du navigateur
// (ses suggestions d'orthographe ne sont accessibles que par lui).
// Clavier : touche Menu ou Maj+F10 ; flèches, Entrée, Échap.

import { chartAt } from '../editor/chart'
import { saveAttachment, selectedAttachment } from '../editor/attachment'
import { diagramAt, listItemsAt } from '../editor/diagram'
import { diagramDialog, editDiagramAt } from './diagram'
import { figuresInSelection, picturesAt } from '../editor/pictures'
import { holdsText, restack, selectedShapes, setWrap, shapeView } from '../editor/shapes'
import { SHAPE_WRAPS } from '../format/types'
import { altDialog, backInText, groupNow, placeFreely, toggleSelectionPane, ungroupNow } from './shapes'
import { editPicturesAt, picturesDialog } from './piclayout'
import { editChartAt } from './chart'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, deleteTable, isInTable, mergeCells, splitCell } from 'prosemirror-tables'
import type { FolioApp } from '../app'
import { listAt, setLink, toggleChecked } from '../editor/commands'
import * as SN from './snippets'
import * as GL from './glossary'
import * as PR from './privacy'
import { linkAt, followLink } from '../editor/links'
import { hasTexText, selectedMath } from '../editor/math'
import { schema } from '../editor/schema'
import { figureAt, setFigureAttrs } from '../editor/tables'
import type { Key } from '../i18n/dict'
import { t } from '../i18n/i18n'
import { writeClipboard } from './actions'
import { toast } from './dialog'
import { h, icon, shortcut } from './dom'
import { ICONS, RIBBON_ICONS as I } from './icons'
import type { MenuEntry } from './menu'
import * as P from './panels'
import * as O from './online'
import { isOffline } from '../net'
import { closePopovers } from './popover'
import { miniToolbar } from './ribbon'
import { convertTex, editMathAt } from './equation'
import { localVoice, readAloud } from './speech'
import { settings, updateSettings } from '../settings'
import { WRAP_MENU, wrapAttrs } from '../format/picture'
import { toggleTip } from './tooltip'

interface Item {
  id: string
  label: string
  icon?: string
  keys?: string
  run?: () => void
  disabled?: boolean
  /** Fonction à venir : grisée, sa bulle le dit. */
  soon?: boolean
  sub?: Entry[]
  /** Une rangée de boutons à icône sous le libellé (Options de collage). */
  row?: { id: string; label: string; icon: string; run: () => void; disabled?: boolean }[]
}
type Entry = Item | 'sep'

let open: ContextMenu | null = null

/** Le menu ouvert, s'il y en a un (tests, fermeture). */
export const contextMenuOpen = (): boolean => !!open

class ContextMenu {
  readonly el: HTMLElement
  private list: HTMLElement
  private search: HTMLInputElement
  private sub: HTMLElement | null = null
  private mini: { el: HTMLElement; update: () => void }
  private readonly onDown = (e: PointerEvent) => {
    const target = e.target as Node
    if (this.el.contains(target) || this.mini.el.contains(target) || this.sub?.contains(target)) return
    // Un clic dans une liste ouverte par la barre (police, couleur…) n'est pas « à l'extérieur ».
    if ((target as Element).closest?.('.fp-popover')) return
    this.close()
  }
  private readonly onKey = (e: KeyboardEvent) => this.key(e)
  private readonly onScroll = (e: Event) => {
    if (!this.el.contains(e.target as Node) && !(e.target as Element).closest?.('.fp-popover')) this.close()
  }
  private readonly onBlur = () => this.close()

  constructor(
    private app: FolioApp,
    private entries: Entry[],
    x: number,
    y: number,
    withMini = true,
  ) {
    open?.close()
    open = this
    this.search = h('input', { type: 'search', class: 'fp-ctx__search', placeholder: t('ctx.search'), 'aria-label': t('ctx.search'), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement
    this.list = h('div', { class: 'fp-ctx__list', role: 'none' })
    // « ? » : comment avoir le menu du navigateur (Maj+clic droit), dans une info-bulle
    // (au survol, au clavier, ou d'un clic).
    const help = h('button', { type: 'button', class: 'fp-ctx__help', 'data-ctx-help': '', 'data-tip-click': '', title: t('ctx.nativeHelp'), 'aria-label': t('ctx.help') }, icon(I.help)) as HTMLButtonElement
    help.addEventListener('click', () => toggleTip(help))
    const head = h('div', { class: 'fp-ctx__head' }, this.search, help)
    this.el = h('div', { class: 'fp-ctx', role: 'menu', 'aria-label': t('ctx.label'), 'data-context-menu': '' }, head, this.list)
    // Une image sélectionnée : sa propre barre (Style, Rogner).
    const pic = app.state.selection instanceof NodeSelection && app.state.selection.node.type === schema.nodes.figure
    this.mini = withMini ? miniToolbar(app, pic ? 'image' : 'text') : { el: h('div', { hidden: true }), update: () => undefined }
    this.mini.el.classList.add('fp-ctx-mini--floating')
    // Rogner : le menu se ferme pour laisser la place aux poignées.
    this.mini.el.addEventListener('click', (e) => {
      if ((e.target as Element).closest?.('[data-cmd="mini-image-crop"]')) this.close()
    })
    this.renderEntries(entries)
    this.search.addEventListener('input', () => this.filter())
    document.body.append(this.el, this.mini.el)
    this.mini.update()
    this.place(x, y)
    document.addEventListener('pointerdown', this.onDown, true)
    document.addEventListener('keydown', this.onKey, true)
    window.addEventListener('scroll', this.onScroll, true)
    window.addEventListener('blur', this.onBlur)
    window.addEventListener('resize', this.onBlur)
    // Le premier élément a le focus : les flèches et les lettres marchent tout de suite.
    this.items()[0]?.focus({ preventScroll: true })
  }

  private renderEntries(entries: Entry[]): void {
    this.list.replaceChildren()
    for (const e of entries) this.list.append(e === 'sep' ? h('hr', { class: 'fp-ctx__sep', role: 'separator' }) : this.itemEl(e))
  }

  private itemEl(e: Item, inSub = false): HTMLElement {
    if (e.row) return this.rowEl(e)
    const b = h('button', { type: 'button', class: 'fp-ctx__item' + (e.soon ? ' is-soon' : ''), role: 'menuitem', 'data-ctx': e.id, ...(e.sub ? { 'aria-haspopup': 'menu' } : {}) }) as HTMLButtonElement
    if (e.soon) b.title = t('soon', { label: e.label.replace(/…$/, '') })
    b.append(h('span', { class: 'fp-ctx__icon' }, e.icon ? icon(e.icon) : ''), h('span', { class: 'fp-ctx__label' }, e.label), h('span', { class: 'fp-ctx__keys' }, e.keys ?? ''))
    if (e.sub) b.append(icon(I.chevronRight))
    b.disabled = !!e.disabled || !!e.soon
    b.addEventListener('mousedown', (ev) => ev.preventDefault())
    // Survoler un élément du menu principal ouvre son sous-menu, ou ferme celui qui était ouvert.
    if (!inSub) {
      b.addEventListener('pointerenter', () => {
        if (e.sub) this.openSub(b, e.sub)
        else this.closeSub()
      })
    }
    b.addEventListener('click', () => {
      if (e.sub) return this.openSub(b, e.sub, true)
      this.close()
      e.run?.()
    })
    return b
  }

  /** « Options de collage : » et sa rangée de boutons à icône. */
  private rowEl(e: Item): HTMLElement {
    const buttons = e.row!.map((r) => {
      const b = h('button', { type: 'button', class: 'fp-ctx__item fp-ctx__rowbtn', role: 'menuitem', 'data-ctx': r.id, title: r.label, 'aria-label': r.label }, icon(r.icon)) as HTMLButtonElement
      b.disabled = !!r.disabled
      b.addEventListener('mousedown', (ev) => ev.preventDefault())
      b.addEventListener('pointerenter', () => this.closeSub())
      b.addEventListener('click', () => {
        this.close()
        r.run()
      })
      return b
    })
    return h(
      'div',
      { class: 'fp-ctx__group', role: 'group', 'aria-label': e.label, 'data-ctx': e.id },
      h('div', { class: 'fp-ctx__grouphead' }, h('span', { class: 'fp-ctx__icon' }, e.icon ? icon(e.icon) : ''), h('span', { class: 'fp-ctx__label' }, e.label)),
      h('div', { class: 'fp-ctx__row' }, ...buttons),
    )
  }

  private openSub(anchor: HTMLElement, entries: Entry[], focus = false): void {
    this.closeSub()
    const sub = h('div', { class: 'fp-ctx fp-ctx--sub', role: 'menu' })
    for (const e of entries) sub.append(e === 'sep' ? h('hr', { class: 'fp-ctx__sep' }) : this.itemEl(e, true))
    document.body.append(sub)
    const r = anchor.getBoundingClientRect()
    const w = sub.offsetWidth
    const hgt = sub.offsetHeight
    const left = r.right + w + 4 < window.innerWidth ? r.right + 2 : r.left - w - 2
    sub.style.left = `${Math.max(4, left)}px`
    sub.style.top = `${Math.max(4, Math.min(window.innerHeight - hgt - 4, r.top - 5))}px`
    this.sub = sub
    if (focus) (sub.querySelector('.fp-ctx__item') as HTMLElement | null)?.focus()
  }

  private closeSub(): void {
    this.sub?.remove()
    this.sub = null
  }

  /** Recherche : toutes les commandes des menus et celles de ce menu. */
  private filter(): void {
    const q = this.search.value.trim().toLowerCase()
    this.closeSub()
    if (!q) return this.renderEntries(this.entries)
    const found: Item[] = []
    const flat = (es: Entry[]) => {
      for (const e of es) {
        if (e === 'sep') continue
        if (e.sub) flat(e.sub)
        else if (e.row) for (const r of e.row) (r.label.toLowerCase().includes(q) && !r.disabled ? found.push({ id: r.id, label: r.label, icon: r.icon, run: r.run }) : 0)
        else if (e.label.toLowerCase().includes(q) && !e.disabled && !e.soon) found.push(e)
      }
    }
    flat(this.entries)
    for (const menu of P.commands()) {
      for (const e of menu.entries() as MenuEntry[]) {
        if (!('run' in e) || e.disabled) continue
        if (e.label.toLowerCase().includes(q) && !found.some((f) => f.label === e.label)) found.push({ id: `cmd-${e.id}`, label: e.label, keys: e.shortcut, run: e.run })
      }
    }
    this.list.replaceChildren()
    if (!found.length) this.list.append(h('p', { class: 'fp-ctx__empty' }, t('ctx.noMatch')))
    for (const f of found.slice(0, 14)) this.list.append(this.itemEl(f))
  }

  private items(root: HTMLElement = this.el): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('.fp-ctx__item:not(:disabled)'))
  }

  private key(e: KeyboardEvent): void {
    const inSub = !!this.sub && this.sub.contains(document.activeElement)
    const items = inSub ? this.items(this.sub!) : this.items()
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (inSub) {
        const owner = this.list.querySelector('[aria-haspopup]:focus-within, [aria-haspopup]') as HTMLElement | null
        this.closeSub()
        owner?.focus()
      } else this.close(true)
      return
    }
    if (document.activeElement === this.search) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        items[0]?.focus()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        items[0]?.click()
      }
      return
    }
    if (!this.el.contains(document.activeElement) && !inSub) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!items.length) return
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : i <= 0 ? (inSub ? items.length - 1 : -1) : i - 1
      if (next < 0) this.search.focus()
      else items[next].focus()
    } else if (e.key === 'ArrowRight' && !inSub && document.activeElement?.hasAttribute('aria-haspopup')) {
      e.preventDefault()
      ;(document.activeElement as HTMLElement).click()
    } else if (e.key === 'ArrowLeft' && inSub) {
      e.preventDefault()
      this.closeSub()
      ;(this.list.querySelector('[aria-haspopup]') as HTMLElement | null)?.focus()
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Une lettre : elle part dans la recherche.
      this.search.focus()
    }
  }

  private place(x: number, y: number): void {
    const w = this.el.offsetWidth
    const hgt = this.el.offsetHeight
    const mh = this.mini.el.offsetHeight
    const mw = this.mini.el.offsetWidth
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.max(6, Math.min(x, vw - Math.max(w, mw) - 6))
    // Le menu, puis la barre juste dessous ; s'il manque de place, l'ensemble remonte.
    let top = y
    if (top + hgt + 8 + mh > vh - 6) top = Math.max(6, vh - 6 - hgt - 8 - mh)
    this.el.style.left = `${left}px`
    this.el.style.top = `${top}px`
    this.mini.el.style.left = `${left}px`
    this.mini.el.style.top = `${top + hgt + 8}px`
  }

  close(refocus = false): void {
    if (open !== this) return
    open = null
    this.closeSub()
    this.el.remove()
    this.mini.el.remove()
    closePopovers()
    document.removeEventListener('pointerdown', this.onDown, true)
    document.removeEventListener('keydown', this.onKey, true)
    window.removeEventListener('scroll', this.onScroll, true)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('resize', this.onBlur)
    if (refocus) this.app.focus()
  }
}

// --- ce que le menu propose, selon l'endroit -----------------------------------

function savePicture(src: string, name: string): void {
  if (!src.startsWith('data:')) return
  const ext = /^data:image\/(png|jpeg|gif|webp|svg\+xml)/.exec(src)?.[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') ?? 'png'
  const a = document.createElement('a')
  a.href = src
  a.download = `${(name || 'image').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)}.${ext}`
  document.body.append(a)
  a.click()
  a.remove()
}

function entriesFor(app: FolioApp, view: EditorView): Entry[] {
  const s = view.state
  const main = view === app.view
  const editable = view.editable && !app.reading
  const out: Entry[] = []
  const hasSel = !s.selection.empty
  const fig = main ? figureAt(s) : null
  const pic = fig && s.selection instanceof NodeSelection
  // Couper, Copier, Options de collage (comme d'habitude, en tête).
  out.push(
    { id: 'cut', label: t('ctx.cut'), icon: I.cut, keys: shortcut('X'), disabled: !hasSel || !editable, run: () => P.clipboardAction(app, 'cut') },
    { id: 'copy', label: t('ctx.copy'), icon: I.copy, keys: shortcut('C'), disabled: !hasSel, run: () => P.clipboardAction(app, 'copy') },
    {
      id: 'paste-options',
      label: t('ctx.pasteOptions'),
      icon: I.paste,
      row: [
        { id: 'paste', label: `${t('rb.pasteKeep')} (${shortcut('V')})`, icon: I.pasteKeep, disabled: !editable, run: () => void P.pasteFromClipboard(app, false) },
        { id: 'paste-plain', label: `${t('rb.pasteText')} (${shortcut('Maj+V').replace('Maj', t('key.shift'))})`, icon: I.pasteText, disabled: !editable, run: () => void P.pasteFromClipboard(app, true) },
      ],
    },
  )

  // Fichier joint sélectionné : l'enregistrer sur l'ordinateur.
  const attached = selectedAttachment(s)
  if (attached) out.push('sep', { id: 'save-attachment', label: t('obj.save'), icon: ICONS.save, keys: '↵', run: () => void saveAttachment(attached.attrs as { src: string; name: string }) })

  // Diagramme sélectionné ; liste du curseur : la changer en diagramme.
  const diagram = diagramAt(s)
  if (diagram) out.push('sep', { id: 'edit-diagram', label: t('dg.edit'), icon: I.diagram, keys: '↵', disabled: !editable, run: () => editDiagramAt(app, diagram.pos) })
  else if (main && editable && listItemsAt(s)) out.push('sep', { id: 'list-to-diagram', label: t('dg.convert'), icon: I.diagram, run: () => diagramDialog(app) })

  // Disposition d'images sélectionnée.
  const layout = main ? picturesAt(s) : null
  if (layout) out.push('sep', { id: 'edit-pictures', label: t('pl.edit'), icon: I.pictureLayout, keys: '↵', disabled: !editable, run: () => editPicturesAt(app, layout.pos) })
  // Plusieurs images dans la sélection : en faire une disposition.
  else if (main && editable && !pic && figuresInSelection(s).length > 1) out.push('sep', { id: 'picture-layout', label: t('pl.menu'), icon: I.pictureLayout, run: () => picturesDialog(app) })

  // Formes sélectionnées : écrire dedans, habillage, premier plan, grouper, texte de remplacement.
  const shapes = main ? selectedShapes(s) : []
  if (shapes.length) {
    const one = shapes.length === 1 ? shapes[0].data : null
    out.push(
      'sep',
      ...(one && holdsText(one) ? [{ id: 'shape-edit-text', label: t('shape.editText'), icon: I.textBox, keys: '↵', disabled: !editable, run: () => shapeView(one.id)?.startEditing() }] : []),
      {
        id: 'shape-wrap',
        label: t('rb.wrapText'),
        icon: I.wrapRight,
        disabled: !editable,
        sub: [
          ...SHAPE_WRAPS.map((w) => ({ id: `shape-wrap-${w}`, label: t(`shape.wrap.${w}` as Key), run: () => setWrap(app.view, selectedShapes(app.view.state), w) })),
          // Une image libre peut revenir dans le texte.
          ...(one?.shape === 'picture' ? [{ id: 'picture-back-in-text', label: t('pic.backInText'), run: () => backInText(app) }] : []),
        ],
      },
      {
        id: 'shape-order',
        label: t('shape.toFront'),
        icon: I.bringForward,
        disabled: !editable,
        sub: (
          [
            ['front', 'shape.toFront'],
            ['forward', 'shape.forward'],
            ['backward', 'shape.backward'],
            ['back', 'shape.toBack'],
          ] as const
        ).map(([k, key]) => ({ id: `shape-${k}`, label: t(key), run: () => restack(app.view, selectedShapes(app.view.state), k) })),
      },
      ...(shapes.length > 1 ? [{ id: 'shape-group', label: t('shape.group'), icon: I.groupObj, disabled: !editable, run: () => groupNow(app) }] : []),
      ...(one?.shape === 'group' ? [{ id: 'shape-ungroup', label: t('shape.ungroup'), icon: I.groupObj, disabled: !editable, run: () => ungroupNow(app) }] : []),
      { id: 'shape-pane', label: t('rb.selectionPane'), icon: I.selectionPane, run: () => toggleSelectionPane(app, true) },
      ...(one ? [{ id: 'shape-alt', label: t('ctx.viewAlt'), icon: I.alt, disabled: !editable, run: () => altDialog(app) }] : []),
    )
  }

  // Graphique sélectionné.
  const chart = chartAt(s)
  if (chart) out.push('sep', { id: 'edit-chart', label: t('ctx.editChart'), icon: I.chart, keys: '↵', disabled: !editable, run: () => editChartAt(app, chart.pos) })

  // Formule sous le curseur.
  const m = selectedMath(s)
  if (m) {
    out.push('sep', { id: 'edit-equation', label: t('ctx.editEquation'), icon: I.equation, keys: '↵', disabled: !editable, run: () => editMathAt(app, view, m.pos) })
    out.push({
      id: 'copy-latex',
      label: t('ctx.copyLatex'),
      run: () => void writeClipboard(m.node.attrs.tex as string).then((ok) => ok && toast(t('json.copied'), { kind: 'success' })),
    })
  } else if (editable && hasTexText(s)) {
    out.push('sep', { id: 'convert-tex', label: t('ctx.convertTex'), icon: I.equation, run: () => convertTex(app) })
  }

  const link = linkAt(s)
  const linkMenu = (): Item => {
    if (!link) return { id: 'link', label: t('ctx.linkMenu'), icon: I.link, disabled: !editable || (!hasSel && !main && !pic), sub: [{ id: 'insert-link', label: t('ctx.insertLink'), icon: I.link, keys: shortcut('K'), run: () => P.linkDialog(app) }] }
    const href = link.mark.attrs.href as string
    return {
      id: 'link',
      label: t('ctx.linkMenu'),
      icon: I.link,
      sub: [
        { id: 'open-link', label: t('ctx.openLink'), icon: I.link, run: () => void followLink(href, { jump: (a) => app.jumpToAnchor(a), blocked: () => toast(t('offline.blocked'), { kind: 'info' }) }) },
        { id: 'copy-link', label: t('ctx.copyLink'), icon: I.copy, run: () => void writeClipboard(href.replace(/^mailto:/, '')) },
        { id: 'edit-link', label: t('ctx.editLink'), disabled: !editable, run: () => P.linkDialog(app) },
        { id: 'remove-link', label: t('ctx.removeLink'), icon: I.unlink, disabled: !editable, run: () => void app.run(setLink(null)) },
      ],
    }
  }

  // Image (sélectionnée) : les commandes de l'image, dans l'ordre habituel.
  if (pic && fig) {
    const set = (attrs: Record<string, unknown>) => app.run(setFigureAttrs(attrs))
    const src = (fig.node.attrs.src as string) ?? ''
    out.push(
      'sep',
      { id: 'edit-picture', label: t('ctx.editPicture'), soon: true },
      { id: 'change-picture', label: t('ctx.changePicture'), icon: I.image, disabled: !editable, sub: [{ id: 'replace-picture', label: t('ctx.fromFile'), icon: I.image, run: () => P.pickImage(app, true) }] },
      'sep',
      { id: 'group', label: t('ctx.group'), icon: I.groupObj, soon: true },
      { id: 'bring-front', label: t('ctx.bringFront'), icon: I.bringForward, soon: true },
      { id: 'send-back', label: t('ctx.sendBack'), icon: I.sendBackward, soon: true },
      'sep',
      linkMenu(),
      { id: 'save-picture', label: t('ctx.savePicture'), disabled: !src.startsWith('data:'), run: () => savePicture(src, (fig.node.attrs.alt as string) || app.title()) },
      'sep',
      { id: 'caption', label: t('ctx.insertCaption'), icon: I.caption, disabled: !editable, run: () => P.focusCaption(app) },
      { id: 'picture-layout', label: t('pl.menu'), icon: I.pictureLayout, disabled: !editable, run: () => picturesDialog(app) },
      {
        id: 'wrap',
        label: t('ctx.wrap'),
        icon: I.wrapRight,
        disabled: !editable,
        sub: [
          ...WRAP_MENU.map((w) => ({ id: `wrap-${w}`, label: t(`image.wrap.${w}` as Key), icon: I[`wrap${w[0].toUpperCase()}${w.slice(1)}` as 'wrapNone'], run: () => set(wrapAttrs(w, fig.node.attrs.align as string)) })),
          { id: 'wrap-free', label: t('pic.placeFreely'), icon: I.wrapFront, run: () => placeFreely(app) },
        ],
      },
      'sep',
      { id: 'alt-text', label: t('ctx.viewAlt'), icon: I.alt, disabled: !editable, run: () => P.altTextDialog(app) },
      { id: 'size', label: t('ctx.sizePosition'), icon: I.crop, disabled: !editable, run: () => P.cropDialog(app) },
      { id: 'format-picture', label: t('ctx.formatPicture'), icon: I.corrections, disabled: !editable, run: () => (document.querySelector('.fp-ribbon__tab[data-tab="image"]') as HTMLElement | null)?.click() },
    )
    return tidy(out)
  }

  // Tableau.
  if (main && isInTable(s) && editable) {
    const cmd = (c: Parameters<FolioApp['run']>[0]) => () => void app.run(c)
    out.push(
      'sep',
      {
        id: 'table-insert',
        label: t('ctx.insert'),
        icon: I.rowBelow,
        sub: [
          { id: 'row-above', label: t('table.rowAbove'), icon: I.rowAbove, run: cmd(addRowBefore) },
          { id: 'row-below', label: t('table.rowBelow'), icon: I.rowBelow, run: cmd(addRowAfter) },
          { id: 'col-left', label: t('table.colLeft'), icon: I.colLeft, run: cmd(addColumnBefore) },
          { id: 'col-right', label: t('table.colRight'), icon: I.colRight, run: cmd(addColumnAfter) },
        ],
      },
      {
        id: 'table-delete',
        label: t('ctx.delete'),
        icon: I.delete,
        sub: [
          { id: 'delete-row', label: t('table.deleteRow'), run: cmd(deleteRow) },
          { id: 'delete-col', label: t('table.deleteCol'), run: cmd(deleteColumn) },
          { id: 'delete-table', label: t('table.deleteTable'), run: cmd(deleteTable) },
        ],
      },
      { id: 'merge-cells', label: t('table.merge'), icon: I.merge, disabled: !app.can(mergeCells), run: cmd(mergeCells) },
      { id: 'split-cell', label: t('table.split'), icon: I.split, disabled: !app.can(splitCell), run: cmd(splitCell) },
    )
  }

  // Garder la sélection comme extrait réutilisable.
  if (main && !s.selection.empty) {
    out.push('sep', { id: 'save-snippet', label: t('snip.saveSelection'), icon: I.quickParts, run: () => void SN.saveSelectionDialog(app) })
    if (editable) out.push({ id: 'redact-mark', label: t('redact.mark'), icon: I.redact, run: () => PR.markSelectionForRedaction(app) })
    if (editable && s.doc.textBetween(s.selection.from, s.selection.to).length <= 200) out.push({ id: 'define-term', label: `${t('gl.define')}…`, icon: I.markEntry, keys: 'Alt+Shift+G', run: () => GL.defineTermDialog(app) })
  }

  // Liste à cocher : cocher ou décocher l'élément (ou ceux de la sélection) au clavier.
  if (main && editable && listAt(s)?.node.type === schema.nodes.check_list) {
    out.push('sep', { id: 'toggle-check', label: t('check.toggle'), icon: I.checklist, run: () => void app.run(toggleChecked) })
  }

  // Texte : lien vers l'emplacement, police, paragraphe, synonymes, lecture, lien, commentaire.
  out.push('sep', { id: 'copy-link-location', label: t('ctx.copyLinkLoc'), icon: I.copyLinkLoc, soon: true })
  if (!m) {
    out.push('sep', { id: 'font', label: t('ctx.font'), icon: I.font, disabled: !editable, run: () => P.fontDialog(app) }, { id: 'paragraph', label: t('ctx.paragraph'), icon: I.paragraph, disabled: !editable, run: () => P.paragraphDialog(app) })
  }
  // Synonymes et recherche en ligne (bloqués hors ligne) : le volet « Rechercher ».
  const word = O.wordAtCursor(app)
  const usable = !!word && word.length <= 60 && !isOffline()
  out.push('sep', { id: 'synonyms', label: t('ctx.synonyms'), icon: I.thesaurus, disabled: !usable, run: () => O.lookUp(app, 'thesaurus') })
  if (word && word.length <= 60) out.push({ id: 'lookup', label: t('look.ctx', { word: word.length > 24 ? `${word.slice(0, 23)}…` : word }), icon: I.researchSearch, disabled: isOffline(), run: () => O.lookUp(app, 'search') })
  // Lecture à voix haute (voix de l'appareil seulement).
  if (localVoice((s.doc.attrs.lang as string) || document.documentElement.lang || 'fr')) {
    const speaking = typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking
    out.push(speaking ? { id: 'stop-reading', label: t('ctx.stopReading'), icon: I.readAloud, run: () => speechSynthesis.cancel() } : { id: 'read-aloud', label: t('rb.readAloud'), icon: I.readAloud, run: () => void readAloud(app) })
  } else out.push({ id: 'read-aloud', label: t('rb.readAloud'), icon: I.readAloud, disabled: true })
  out.push('sep', linkMenu())
  if (main) out.push({ id: 'new-comment', label: t('ctx.comment'), icon: I.comment, keys: shortcut('Alt+M'), disabled: !editable, run: () => P.getCommentsPane()?.startNew() })
  return tidy(out)
}

/** Pas de séparateur en double, ni au début ou à la fin. */
function tidy(out: Entry[]): Entry[] {
  return out.filter((e, i, a) => e !== 'sep' || (i > 0 && i < a.length - 1 && a[i - 1] !== 'sep'))
}

/** Le menu du ruban, de la barre de titre, des volets : commandes de l'interface. */
function chromeEntries(app: FolioApp): Entry[] {
  const collapsed = settings().ribbonCollapsed
  return [
    { id: 'search-commands', label: t('ctx.searchCommands'), icon: I.find, keys: 'Alt+Q', run: () => (document.querySelector('#fp-cmdsearch') as HTMLElement | null)?.focus() },
    'sep',
    { id: 'toggle-ribbon', label: collapsed ? t('ctx.expandRibbon') : t('ctx.collapseRibbon'), icon: collapsed ? I.arrowDown : I.arrowUp, run: () => (document.querySelector('#fp-ribbon-collapse') as HTMLElement | null)?.click() },
    {
      id: 'toggle-autohide',
      label: t('ribbon.autoHide'),
      icon: I.arrowUp,
      run: () => {
        updateSettings({ ribbonAutoHide: !settings().ribbonAutoHide })
        app.notifyUi()
      },
    },
    'sep',
    { id: 'zoom-100', label: t('ctx.zoom100'), icon: I.zoom100, run: () => P.setZoom(1) },
    { id: 'zoom-width', label: t('ribbon.fitWidth'), icon: I.fitWidth, run: () => P.fitWidth() },
    { id: 'zoom-page', label: t('rb.onePage'), icon: I.onePage, run: () => P.fitPage() },
    'sep',
    { id: 'word-count', label: t('ribbon.wordCount'), icon: I.word, run: () => P.wordCountDialog(app) },
  ]
}

/** Place le curseur là où l'on a cliqué (sauf dans la sélection), ou sélectionne l'objet cliqué. */
function selectAt(view: EditorView, e: MouseEvent): void {
  const target = e.target as Element
  const atom = target.closest('.fp-math, .fp-equation, .fp-figure, .fp-chart, .fp-diagram, .fp-pictures, .fp-shape, .fp-attach')
  if (atom && view.dom.contains(atom)) {
    const pos = view.posAtDOM(atom, 0)
    // posAtDOM donne une position dans ou juste avant l'atome : on cherche le nœud autour.
    for (const p of [pos - 1, pos, pos - 2]) {
      const node = p >= 0 ? view.state.doc.nodeAt(p) : null
      if (node && (node.type === schema.nodes.math || node.type === schema.nodes.equation || node.type === schema.nodes.figure || node.type === schema.nodes.chart || node.type === schema.nodes.diagram || node.type === schema.nodes.pictures || node.type === schema.nodes.shape || node.type === schema.nodes.attachment)) {
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, p)))
        return
      }
    }
  }
  const hit = view.posAtCoords({ left: e.clientX, top: e.clientY })
  if (!hit) return
  const { from, to } = view.state.selection
  if (hit.pos >= from && hit.pos <= to && from !== to) return
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, hit.pos)))
  } catch {
    /* position hors texte : on garde la sélection */
  }
}

/** Clic droit hors du texte (marges, fond) : le curseur va au point du texte le plus proche. */
function selectNearest(view: EditorView, e: MouseEvent): void {
  const r = view.dom.getBoundingClientRect()
  const left = Math.max(r.left + 2, Math.min(r.right - 2, e.clientX))
  const top = Math.max(r.top + 2, Math.min(r.bottom - 2, e.clientY))
  const hit = view.posAtCoords({ left, top })
  if (!hit) return
  const { from, to } = view.state.selection
  if (from !== to && hit.pos >= from && hit.pos <= to) return
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))))
  } catch {
    /* on garde la sélection */
  }
}

export function installContextMenu(app: FolioApp): void {
  const viewOf = (el: Element | null): EditorView | null => {
    if (!el) return null
    if (app.alt && app.alt.dom.contains(el)) return app.alt
    if (app.view.dom.contains(el)) return app.view
    return null
  }
  document.addEventListener('contextmenu', (e) => {
    // Maj+clic droit : le menu du navigateur (orthographe, inspecter…).
    if (e.shiftKey) return
    const target = e.target as Element
    const view = viewOf(target)
    if (view) {
      e.preventDefault()
      if (view.editable) view.focus()
      selectAt(view, e)
      new ContextMenu(app, entriesFor(app, view), e.clientX, e.clientY)
      return
    }
    // Un champ de saisie, une fenêtre : le menu du navigateur (copier, coller, orthographe).
    if (target.closest('input, textarea, select, [contenteditable="true"], dialog, .fp-dialog')) return
    e.preventDefault()
    // Le menu lui-même, une liste ouverte : rien.
    if (target.closest('[data-context-menu], .fp-ctx, .fp-popover, .fp-ctx-mini')) return
    // Autour de la page (marges, fond) : le menu du texte, au plus près du clic.
    if (target.closest('.fp-canvas, .fp-page, .fp-pages, .fp-workspace')) {
      app.view.focus()
      selectNearest(app.view, e)
      new ContextMenu(app, entriesFor(app, app.view), e.clientX, e.clientY)
      return
    }
    // Ruban, barre de titre, barre d'état, volets : les commandes de l'interface.
    new ContextMenu(app, chromeEntries(app), e.clientX, e.clientY, false)
  })
  // Touche Menu, Maj+F10 : le menu au curseur.
  document.addEventListener('keydown', (e) => {
    if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return
    const view = viewOf(document.activeElement)
    if (!view) return
    e.preventDefault()
    const c = view.coordsAtPos(view.state.selection.head)
    new ContextMenu(app, entriesFor(app, view), c.left, c.bottom + 4)
  })
}
