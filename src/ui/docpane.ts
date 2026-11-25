// Volet Documents, à gauche (comme l'explorateur d'un éditeur de code) : les
// documents du fichier rangés dans des dossiers. Un clic ouvre un document
// (en onglet, en bas) ; on glisse un document ou un dossier pour le ranger ; on
// y dépose des fichiers pour les ajouter. Clic droit (ou Maj+F10) : nouveau
// document ou dossier, renommer, dupliquer, enregistrer à part, PDF, imprimer,
// supprimer. Au clavier : flèches, Entrée, F2, Suppr, comme dans un arbre.

import type { FolioApp, TreePlace, TreeView } from '../app'
import { readOpened } from '../file/open'
import { t } from '../i18n/i18n'
import { settings, updateSettings } from '../settings'
import { openDialog, toast } from './dialog'
import { h, icon } from './dom'
import { ICONS, RIBBON_ICONS as I } from './icons'
import { reportDialog, reportSummary } from './actions'
import { askPassword, openFailure } from './panels'
import { exportPdfUi } from './pdf'
import { Popover, closePopovers, popItem } from './popover'
import { printDialog } from './print'

/** Ce qu'on peut ajouter comme document (comme Fichier → Ouvrir). */
export const ADD_ACCEPT = '.html,.htm,.docx,.odt,.ott,.rtf,.md,.markdown,.txt,.json'
const NODE_TYPE = 'application/x-folio-node'

type Row = { node: TreeView; depth: number; parent: string | null; index: number; size: number; path: string }
type Drop = { place: TreePlace; row: HTMLElement | null; how: 'before' | 'after' | 'inside' | 'end' }

let pane: DocsPane | null = null
export const getDocsPane = () => pane

export class DocsPane {
  readonly el: HTMLElement
  private readonly tree: HTMLElement
  private sig = ''
  /** L'élément choisi dans le volet (clé de document ou identifiant de dossier). */
  private selected: string | null = null
  private renaming: string | null = null
  private renameByKey = false
  /** Dossiers fermés, par leur chemin (gardé dans ce navigateur pour ce fichier). */
  private collapsed = new Set<string>()
  private collapsedFor = ''
  private dragRef: string | null = null
  private drop: Drop | null = null

  constructor(private app: FolioApp) {
    pane = this
    const btn = (id: string, label: string, ic: string, run: () => void) =>
      h('button', { type: 'button', class: 'fp-iconbtn', id, title: label, 'aria-label': label, onclick: run }, icon(ic))
    const actions = h(
      'div',
      { class: 'fp-docs__actions' },
      btn('fp-doc-add', t('docs.add'), I.docAdd, () => this.newDocument()),
      btn('fp-folder-add', t('tree.addFolder'), I.folderAdd, () => this.newFolder()),
      btn('fp-doc-import', t('tree.addFiles'), I.fileImport, () => void this.pickFiles()),
      btn('fp-tree-collapse', t('tree.collapseAll'), I.collapseAll, () => this.collapseAll()),
      btn('fp-docs-close', t('action.close'), ICONS.close, () => this.toggle(false)),
    )
    this.tree = h('div', { class: 'fp-docs__tree', role: 'tree', 'aria-label': t('docs.tabs') })
    this.el = h('aside', { class: 'fp-nav fp-docs', id: 'fp-docs', 'aria-label': t('tree.title') }, h('div', { class: 'fp-nav__head' }, h('h2', { class: 'fp-nav__title' }, t('tree.title')), actions), this.tree)
    this.el.hidden = !this.wanted()
    this.el.append(this.resizer())
    this.tree.addEventListener('keydown', (e) => this.key(e))
    // La ligne qui a le focus est l'élément choisi (là où « Nouveau… » ajoute).
    this.tree.addEventListener('focusin', (e) => {
      const r = (e.target as HTMLElement).closest<HTMLElement>('.fp-tree__row')
      if (r?.dataset.node) this.selected = r.dataset.node
    })
    this.tree.addEventListener('contextmenu', (e) => {
      if ((e.target as HTMLElement).closest('.fp-tree__row, input')) return
      e.preventDefault()
      this.menu(null, pointAnchor(e))
    })
    this.tree.addEventListener('dragover', (e) => this.dragOver(e))
    this.tree.addEventListener('dragleave', (e) => {
      if (!this.tree.contains(e.relatedTarget as Node)) this.showDrop(null)
    })
    this.tree.addEventListener('drop', (e) => this.dropped(e))
    // Pendant la frappe, l'arbre se redessine au plus toutes les 100 ms (titres, points « modifié »).
    let timer: ReturnType<typeof setTimeout> | null = null
    app.onChange(() => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        this.render()
      }, 100)
    })
    this.render()
  }

  /** Le bord droit du volet : on le tire pour l'élargir (largeur gardée dans ce navigateur). */
  private resizer(): HTMLElement {
    const KEY = 'folio-pages:docs-width'
    const set = (w: number) => this.el.style.setProperty('--docs-w', `${Math.round(Math.max(170, Math.min(520, w)))}px`)
    try {
      const w = Number(localStorage.getItem(KEY))
      if (w) set(w)
    } catch {
      /* largeur par défaut */
    }
    const grip = h('div', { class: 'fp-docs__resize', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': t('tree.resize'), tabindex: '0' })
    const save = () => {
      try {
        localStorage.setItem(KEY, String(Math.round(this.el.getBoundingClientRect().width)))
      } catch {
        /* rien */
      }
      window.dispatchEvent(new Event('resize'))
    }
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      grip.setPointerCapture(e.pointerId)
      const left = this.el.getBoundingClientRect().left
      const move = (ev: PointerEvent) => set(ev.clientX - left)
      const up = () => {
        grip.removeEventListener('pointermove', move)
        grip.removeEventListener('pointerup', up)
        grip.removeEventListener('pointercancel', up)
        save()
      }
      grip.addEventListener('pointermove', move)
      grip.addEventListener('pointerup', up)
      grip.addEventListener('pointercancel', up)
    })
    grip.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      set(this.el.getBoundingClientRect().width + (e.key === 'ArrowRight' ? 16 : -16))
      save()
    })
    return grip
  }

  /** Montré : le choix de l'utilisateur, sinon quand le fichier a des dossiers (pas sur un petit écran, où il couvrirait la page). */
  private wanted(): boolean {
    return settings().docsPane ?? (this.app.hasFolders && window.innerWidth > 860)
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  toggle(on = this.el.hidden): void {
    updateSettings({ docsPane: on })
    this.el.hidden = !on
    this.sig = ''
    this.render()
    window.dispatchEvent(new Event('resize'))
    this.app.notifyUi()
  }

  /** Montre le volet et y met en évidence un élément (le document affiché par défaut). */
  reveal(ref = this.app.activeKey): void {
    if (this.el.hidden) this.toggle(true)
    // Ses dossiers s'ouvrent.
    for (const p of this.ancestors(ref)) this.collapsed.delete(p)
    this.saveCollapsed()
    this.selected = ref
    this.sig = ''
    this.render()
    this.rowOf(ref)?.focus()
  }

  // --- dessin ----------------------------------------------------------------------

  private rows(): Row[] {
    const out: Row[] = []
    const walk = (list: TreeView[], depth: number, parent: string | null, path: string) =>
      list.forEach((n, index) => {
        const p = n.kind === 'folder' ? `${path}/${n.title}` : path
        out.push({ node: n, depth, parent, index, size: list.length, path: p })
        if (n.kind === 'folder' && !this.collapsed.has(p)) walk(n.children, depth + 1, n.id, p)
      })
    walk(this.app.docTree, 0, null, '')
    return out
  }

  /** Le chemin d'un dossier (pour se souvenir qu'il est fermé). */
  private pathOf(id: string): string | null {
    const walk = (list: TreeView[], path: string): string | null => {
      for (const n of list) {
        if (n.kind !== 'folder') continue
        const p = `${path}/${n.title}`
        if (n.id === id) return p
        const deeper = walk(n.children, p)
        if (deeper) return deeper
      }
      return null
    }
    return walk(this.app.docTree, '')
  }

  /** Les chemins des dossiers qui contiennent un élément. */
  private ancestors(ref: string): string[] {
    const out: string[] = []
    const walk = (list: TreeView[], path: string): boolean => {
      for (const n of list) {
        if ((n.kind === 'doc' ? n.key : n.id) === ref) return true
        if (n.kind === 'folder') {
          const p = `${path}/${n.title}`
          out.push(p)
          if (walk(n.children, p)) return true
          out.pop()
        }
      }
      return false
    }
    return walk(this.app.docTree, '') ? out : []
  }

  private loadCollapsed(): void {
    const id = this.app.docId
    if (id === this.collapsedFor) return
    this.collapsedFor = id
    this.collapsed = new Set()
    try {
      const raw = JSON.parse(localStorage.getItem(`folio-pages:folders:${id}`) ?? '[]') as unknown
      if (Array.isArray(raw)) for (const p of raw) if (typeof p === 'string') this.collapsed.add(p)
    } catch {
      /* rien de gardé */
    }
  }

  private saveCollapsed(): void {
    try {
      localStorage.setItem(`folio-pages:folders:${this.app.docId}`, JSON.stringify([...this.collapsed].slice(0, 300)))
    } catch {
      /* stockage indisponible */
    }
  }

  render(): void {
    this.loadCollapsed()
    const want = this.wanted()
    if (this.el.hidden === want) {
      this.el.hidden = !want
      window.dispatchEvent(new Event('resize'))
    }
    if (this.el.hidden || this.dragRef) return
    const rows = this.rows()
    const reading = this.app.reading
    const sig = JSON.stringify([rows.map((r) => [r.node, r.depth]), this.selected, this.renaming, reading, [...this.collapsed]])
    if (sig === this.sig) return
    this.sig = sig
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('#fp-doc-add, #fp-folder-add, #fp-doc-import')) b.disabled = reading
    const focused = this.tree.contains(document.activeElement) && document.activeElement?.tagName !== 'INPUT'
    const current = this.selected ?? this.app.activeKey
    const refs = rows.map((r) => refOf(r.node))
    const focusRef = refs.includes(current) ? current : (refs.find((r) => r === this.app.activeKey) ?? refs[0])
    this.tree.replaceChildren(...rows.map((r) => this.row(r, refOf(r.node) === focusRef)))
    if (focused && !this.renaming) this.rowOf(focusRef)?.focus()
  }

  private row(r: Row, tabbable: boolean): HTMLElement {
    const n = r.node
    const ref = refOf(n)
    const folder = n.kind === 'folder'
    const open = folder && !this.collapsed.has(r.path)
    const active = n.kind === 'doc' && n.active
    const label =
      this.renaming === ref
        ? this.renameField(n)
        : h('span', { class: 'fp-tree__label' }, n.title)
    const el = h(
      'div',
      {
        class: 'fp-tree__row' + (active ? ' is-active' : '') + (this.selected === ref ? ' is-selected' : '') + (folder ? ' is-folder' : ''),
        role: 'treeitem',
        'aria-level': String(r.depth + 1),
        'aria-setsize': String(r.size),
        'aria-posinset': String(r.index + 1),
        'aria-expanded': folder ? String(open) : null,
        'aria-selected': String(active),
        'aria-label': folder ? `${n.title} (${t('tree.count', { n: n.count })})` : n.title,
        tabindex: tabbable ? '0' : '-1',
        draggable: !this.app.reading && !this.renaming ? 'true' : 'false',
        'data-node': ref,
        'data-kind': n.kind,
        style: `--depth:${r.depth}`,
        title: folder ? t('tree.count', { n: n.count }) : n.dirty ? `${n.title} (${t('docs.unsaved')})` : n.title,
      },
      h('span', { class: 'fp-tree__twisty', 'aria-hidden': 'true' }, folder ? icon(ICONS.chevron) : null),
      h('span', { class: 'fp-tree__icon', 'aria-hidden': 'true' }, icon(folder ? (open ? I.folderOpen : I.folder) : I.docPage)),
      label,
      n.kind === 'doc' && n.dirty ? h('span', { class: 'fp-doctab__dot', 'aria-hidden': 'true' }) : null,
    )
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('input')) return
      this.selected = ref
      if (folder) this.setOpen(n.id, !open)
      else {
        this.app.switchToKey(n.key)
        this.sig = ''
        this.render()
      }
      this.rowOf(ref)?.focus()
    })
    el.addEventListener('dblclick', (e) => {
      if (!folder && !(e.target as HTMLElement).closest('input')) this.startRename(ref)
    })
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.selected = ref
      this.sig = ''
      this.render()
      this.menu(n, e.detail === 0 ? (this.rowOf(ref) ?? el) : pointAnchor(e))
    })
    el.addEventListener('dragstart', (e) => {
      if (this.app.reading || this.renaming) return e.preventDefault()
      this.dragRef = ref
      e.dataTransfer!.effectAllowed = 'move'
      e.dataTransfer!.setData(NODE_TYPE, ref)
      e.dataTransfer!.setData('text/plain', n.title)
      el.classList.add('is-dragging')
    })
    el.addEventListener('dragend', () => {
      this.dragRef = null
      this.showDrop(null)
      this.sig = ''
      this.render()
    })
    return el
  }

  private rowOf(ref: string): HTMLElement | null {
    return [...this.tree.querySelectorAll<HTMLElement>('.fp-tree__row')].find((r) => r.dataset.node === ref) ?? null
  }

  private setOpen(id: string, open: boolean): void {
    const p = this.pathOf(id)
    if (!p) return
    if (open) this.collapsed.delete(p)
    else this.collapsed.add(p)
    this.saveCollapsed()
    this.render()
  }

  collapseAll(): void {
    const walk = (list: TreeView[], path: string) => {
      for (const n of list) {
        if (n.kind !== 'folder') continue
        const p = `${path}/${n.title}`
        this.collapsed.add(p)
        walk(n.children, p)
      }
    }
    walk(this.app.docTree, '')
    this.saveCollapsed()
    this.render()
  }

  // --- ajouter ---------------------------------------------------------------------

  /** Où ajouter : dans le dossier choisi, ou juste après le document choisi (le document affiché par défaut). */
  private placeFor(ref: string | null = this.selected): TreePlace {
    const target = ref ?? this.app.activeKey
    if (target && this.isFolder(target)) return { parent: target, index: Infinity }
    return this.app.placeAfter(target && this.app.indexOf(target) >= 0 ? target : this.app.activeKey)
  }

  private isFolder(ref: string): boolean {
    return this.app.isFolder(ref)
  }

  newDocument(place = this.placeFor()): void {
    if (this.app.reading) return
    if (place.parent) this.openFolder(place.parent)
    const key = this.app.addDocument(undefined, place)
    if (!key) return
    if (this.el.hidden) this.toggle(true)
    this.selected = key
    this.startRename(key)
  }

  newFolder(place = this.placeFor()): void {
    if (this.app.reading) return
    if (place.parent) this.openFolder(place.parent)
    const id = this.app.addFolder(t('tree.newFolder'), place)
    if (!id) return
    if (this.el.hidden) this.toggle(true)
    this.selected = id
    this.startRename(id)
  }

  private openFolder(id: string): void {
    const p = this.pathOf(id)
    if (p && this.collapsed.delete(p)) this.saveCollapsed()
  }

  /** Ajouter des fichiers comme documents (sélecteur du navigateur). */
  async pickFiles(place = this.placeFor()): Promise<void> {
    if (this.app.reading) return
    const files = await new Promise<File[]>((resolve) => {
      const el = h('input', { type: 'file', accept: ADD_ACCEPT, multiple: '', class: 'fp-offscreen', 'data-folio-transient': '', 'data-field': 'tree-files' }) as HTMLInputElement
      el.addEventListener('change', () => {
        resolve([...(el.files ?? [])])
        el.remove()
      })
      el.addEventListener('cancel', () => {
        resolve([])
        el.remove()
      })
      document.body.append(el)
      el.click()
    })
    await addFiles(this.app, files, place)
  }

  // --- renommer --------------------------------------------------------------------

  startRename(ref: string, byKey = false): void {
    if (this.app.reading) return
    this.renaming = ref
    this.renameByKey = byKey
    this.sig = ''
    this.render()
  }

  private renameField(n: TreeView): HTMLElement {
    const ref = refOf(n)
    const input = h('input', { type: 'text', class: 'fp-tree__input', value: n.title, maxlength: n.kind === 'doc' ? '500' : '200', 'aria-label': t(n.kind === 'doc' ? 'docs.renameLabel' : 'tree.folderName'), 'data-tree-rename': '' }) as HTMLInputElement
    let done = false
    const finish = (keep: boolean, byKey = false) => {
      if (done) return
      done = true
      this.renaming = null
      const v = input.value.trim()
      if (keep && v && v !== n.title) {
        if (n.kind === 'doc') this.app.renameDocument(this.app.indexOf(n.key), v)
        else {
          // Le dossier garde son état ouvert ou fermé sous son nouveau nom.
          const old = this.pathOf(n.id)
          this.app.renameFolder(n.id, v)
          const now = this.pathOf(n.id)
          if (old && now && old !== now) {
            for (const p of [...this.collapsed]) if (p === old || p.startsWith(`${old}/`)) {
              this.collapsed.delete(p)
              this.collapsed.add(now + p.slice(old.length))
            }
            this.saveCollapsed()
          }
        }
      }
      this.sig = ''
      this.render()
      if (!byKey) return
      // Au clavier (F2) : retour dans l'arbre ; un nouveau document : on y écrit.
      if (this.renameByKey || n.kind === 'folder') this.rowOf(ref)?.focus()
      else this.app.focus()
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(true, true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(false, true)
      }
    })
    input.addEventListener('blur', () => finish(true))
    input.addEventListener('click', (e) => e.stopPropagation())
    requestAnimationFrame(() => {
      input.focus()
      input.select()
    })
    return input
  }

  // --- clavier ---------------------------------------------------------------------

  private key(e: KeyboardEvent): void {
    const rows = [...this.tree.querySelectorAll<HTMLElement>('.fp-tree__row')]
    const i = rows.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    const row = rows[i]
    const ref = row.dataset.node!
    const folder = row.dataset.kind === 'folder'
    const open = row.getAttribute('aria-expanded') === 'true'
    const go = (j: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, j))]
      this.selected = r.dataset.node!
      for (const x of rows) x.tabIndex = x === r ? 0 : -1
      r.focus()
    }
    const level = (r: HTMLElement) => Number(r.getAttribute('aria-level'))
    /** Le dossier s'est ouvert ou fermé : la ligne garde le focus (elle a été redessinée). */
    let toggled = false
    const flip = (on: boolean) => {
      this.setOpen(ref, on)
      toggled = true
    }
    switch (e.key) {
      case 'ArrowDown':
        go(i + 1)
        break
      case 'ArrowUp':
        go(i - 1)
        break
      case 'Home':
        go(0)
        break
      case 'End':
        go(rows.length - 1)
        break
      case 'ArrowRight':
        if (folder && !open) flip(true)
        else if (folder) go(i + 1)
        else return
        break
      case 'ArrowLeft':
        if (folder && open) flip(false)
        else {
          // Vers le dossier qui le contient.
          for (let j = i - 1; j >= 0; j--) if (level(rows[j]) < level(row)) return void (e.preventDefault(), go(j))
          return
        }
        break
      case 'Enter':
      case ' ':
        if (folder) flip(!open)
        else {
          this.app.switchToKey(ref)
          if (e.key === 'Enter') this.app.focus()
        }
        break
      case 'F2':
        this.startRename(ref, true)
        break
      case 'Delete':
        void this.remove(ref)
        break
      case 'ContextMenu':
        this.menu(this.find(ref), row)
        break
      case 'F10':
        if (!e.shiftKey) return
        this.menu(this.find(ref), row)
        break
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
    if (toggled) this.rowOf(ref)?.focus()
  }

  private find(ref: string): TreeView | null {
    const walk = (list: TreeView[]): TreeView | null => {
      for (const n of list) {
        if (refOf(n) === ref) return n
        if (n.kind === 'folder') {
          const x = walk(n.children)
          if (x) return x
        }
      }
      return null
    }
    return walk(this.app.docTree)
  }

  // --- glisser-déposer -------------------------------------------------------------

  private dropAt(e: DragEvent): Drop | null {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.fp-tree__row')
    if (!row) return { place: { parent: null, index: Infinity }, row: null, how: 'end' }
    const ref = row.dataset.node!
    const box = row.getBoundingClientRect()
    const y = (e.clientY - box.top) / box.height
    const parent = this.app.parentOf(ref)?.id ?? null
    const index = this.indexIn(ref)
    if (row.dataset.kind === 'folder') {
      if (y < 0.25) return { place: { parent, index }, row, how: 'before' }
      if (y > 0.75 && row.getAttribute('aria-expanded') !== 'true') return { place: { parent, index: index + 1 }, row, how: 'after' }
      return { place: { parent: ref, index: Infinity }, row, how: 'inside' }
    }
    return y < 0.5 ? { place: { parent, index }, row, how: 'before' } : { place: { parent, index: index + 1 }, row, how: 'after' }
  }

  /** Le rang d'un élément parmi ceux de son dossier. */
  private indexIn(ref: string): number {
    const parent = this.app.parentOf(ref)?.id ?? null
    const list = parent ? ((this.find(parent) as Extract<TreeView, { kind: 'folder' }>).children ?? []) : this.app.docTree
    return list.findIndex((n) => refOf(n) === ref)
  }

  private dragOver(e: DragEvent): void {
    const types = [...(e.dataTransfer?.types ?? [])]
    const files = types.includes('Files')
    if (this.app.reading || (!files && !(types.includes(NODE_TYPE) && this.dragRef))) return
    const d = this.dropAt(e)
    if (!d) return
    if (!files && this.dragRef && !this.app.canMoveNode(this.dragRef, d.place.parent)) {
      this.showDrop(null)
      return
    }
    e.preventDefault()
    e.dataTransfer!.dropEffect = files ? 'copy' : 'move'
    this.showDrop(d)
  }

  private showDrop(d: Drop | null): void {
    for (const r of this.tree.querySelectorAll('.is-drop-before, .is-drop-after, .is-drop-inside')) r.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-inside')
    this.tree.classList.toggle('is-drop-end', d?.how === 'end')
    this.drop = d
    if (d?.row) d.row.classList.add(`is-drop-${d.how}`)
  }

  private dropped(e: DragEvent): void {
    const d = this.drop ?? this.dropAt(e)
    this.showDrop(null)
    if (!d || this.app.reading) return
    e.preventDefault()
    const files = [...(e.dataTransfer?.files ?? [])]
    if (files.length) {
      if (d.place.parent) this.openFolder(d.place.parent)
      void addFiles(this.app, files, d.place)
      return
    }
    const ref = this.dragRef ?? e.dataTransfer?.getData(NODE_TYPE)
    this.dragRef = null
    if (!ref) return
    if (d.how === 'inside') this.openFolder(d.place.parent!)
    this.app.moveNode(ref, d.place.parent, d.place.index)
    this.selected = ref
    this.sig = ''
    this.render()
  }

  // --- menu ------------------------------------------------------------------------

  private menu(n: TreeView | null, anchor: HTMLElement): void {
    closePopovers()
    const ro = this.app.reading
    const sep = () => h('div', { class: 'fp-pop__sep', role: 'separator' })
    const item = (action: string, label: string, run: () => void, disabled = false) => popItem(label, run, { 'data-tree-action': action, disabled })
    let items: HTMLElement[]
    if (!n) {
      const root: TreePlace = { parent: null, index: Infinity }
      items = [
        item('new-doc', t('tree.newDocument'), () => this.newDocument(root), ro),
        item('new-folder', t('tree.addFolder'), () => this.newFolder(root), ro),
        item('add-files', t('tree.addFiles'), () => void this.pickFiles(root), ro),
        sep(),
        item('collapse', t('tree.collapseAll'), () => this.collapseAll()),
      ]
    } else if (n.kind === 'folder') {
      const inside: TreePlace = { parent: n.id, index: Infinity }
      const keys = this.app.folderDocs(n.id)
      items = [
        item('new-doc', t('tree.newDocument'), () => this.newDocument(inside), ro),
        item('new-folder', t('tree.addFolder'), () => this.newFolder(inside), ro),
        item('add-files', t('tree.addFiles'), () => void this.pickFiles(inside), ro),
        item('rename', t('docs.rename'), () => this.startRename(n.id), ro),
        sep(),
        item('save-file', t('tree.saveFolder'), () => void saveAsFile(this.app, keys, n.id), !keys.length),
        item('pdf', t('tree.pdfFolder'), () => void exportScope(this.app, 'pdf', keys), !keys.length),
        item('print', t('tree.printFolder'), () => void exportScope(this.app, 'print', keys), !keys.length),
        sep(),
        item('delete', t('tree.deleteFolder'), () => void this.remove(n.id), ro),
      ]
    } else {
      const i = this.app.indexOf(n.key)
      items = [
        item('rename', t('docs.rename'), () => this.startRename(n.key), ro),
        item('duplicate', t('docs.duplicate'), () => void this.app.duplicateDocument(i), ro),
        item('close-tab', t('tree.closeTab'), () => void this.app.closeTab(n.key), !n.open || this.app.tabs.length < 2),
        sep(),
        item('save-file', t('tree.saveDoc'), () => void saveAsFile(this.app, [n.key])),
        item('pdf', t('tree.pdfDoc'), () => void exportScope(this.app, 'pdf', [n.key])),
        item('print', t('tree.printDoc'), () => void exportScope(this.app, 'print', [n.key])),
        sep(),
        item('delete', t('docs.delete'), () => void this.remove(n.key), ro || this.app.documents.length < 2),
      ]
    }
    const point = anchor.classList.contains('fp-point-anchor')
    new Popover({ anchor, name: 'doc-tree', content: h('div', { class: 'fp-pop__list', role: 'menu' }, ...items), onClose: () => point && anchor.remove() })
  }

  // --- supprimer -------------------------------------------------------------------

  /** Supprimer un document ou un dossier (après confirmation), annulable juste après. */
  async remove(ref: string): Promise<void> {
    if (this.app.reading) return
    const n = this.find(ref)
    if (!n) return
    const keys = n.kind === 'doc' ? [n.key] : this.app.folderDocs(n.id)
    if (keys.length >= this.app.documents.length) {
      toast(t('tree.keepOne'), { kind: 'info' })
      return
    }
    const folder = n.kind === 'folder'
    const choice = await openDialog({
      name: folder ? 'folder-delete' : 'doc-delete',
      title: folder ? t('tree.deleteFolderTitle', { title: n.title }) : t('docs.deleteTitle', { title: n.title }),
      body: [h('p', {}, folder ? (keys.length ? t('tree.deleteFolderBody', { n: keys.length }) : t('tree.deleteEmptyFolder')) : t('docs.deleteBody'))],
      actions: [
        { label: t('action.cancel'), value: 'cancel' },
        { label: t('docs.delete').replace(/…$/, ''), value: 'delete', primary: true, danger: true },
      ],
    }).result
    if (choice !== 'delete') return
    const undo = this.app.removeNode(ref)
    if (this.selected === ref) this.selected = null
    this.render()
    if (undo) toast(t(folder ? 'tree.folderDeleted' : 'docs.deleted', { title: n.title }), { kind: 'info', timeout: 10000, action: { label: t('menu.undo'), run: undo } })
    this.rowOf(this.app.activeKey)?.focus()
  }
}

const refOf = (n: TreeView): string => (n.kind === 'doc' ? n.key : n.id)

/** Un point d'ancrage là où l'on a cliqué (le menu s'ouvre sous le pointeur), retiré à la fermeture. */
function pointAnchor(e: MouseEvent): HTMLElement {
  const a = h('span', { class: 'fp-point-anchor', 'data-folio-transient': '', style: `left:${e.clientX}px;top:${e.clientY}px` })
  document.body.append(a)
  return a
}

/** Ajoute des fichiers comme documents, à une place de l'arbre (un fichier Folio Pages garde ses dossiers). */
export async function addFiles(app: FolioApp, files: File[], place: TreePlace = app.placeAfter()): Promise<void> {
  if (app.reading) return
  let at = place.index
  let added = 0
  for (const f of files) {
    const o = await readOpened(f, null)
    let doc = o.kind === 'document' ? o.doc : null
    let report = o.kind === 'document' ? o.report : null
    if (o.kind === 'encrypted' && o.envelope) {
      const got = await askPassword(o.name, o.envelope)
      if (!got) continue
      doc = got.doc
      report = got.report
    }
    if (!doc) {
      if (o.kind !== 'document') toast(openFailure(o), { kind: o.kind === 'blank-app' ? 'info' : 'error', timeout: 9000 })
      continue
    }
    const before = app.documents.length
    const name = f.name.replace(/\.[^.]+$/, '')
    if (!app.importDocuments(doc, doc.meta.title.trim() || name, { parent: place.parent, index: at })) break
    added++
    // Le suivant se range après celui-ci (un fichier de plusieurs documents ne compte que pour un, son dossier).
    at = at === Infinity ? at : at + (app.documents.length - before > 1 ? 1 : app.documents.length - before)
    const summary = report ? reportSummary(report) : ''
    if (summary) toast(summary, { kind: 'warning', action: { label: t('action.details'), run: () => reportDialog(app) } })
  }
  if (added) toast(t('tree.added', { n: added }), { kind: 'success' })
}

/** Enregistrer un document ou un dossier comme fichier Folio Pages à part. */
export async function saveAsFile(app: FolioApp, keys: string[], folder?: string): Promise<void> {
  const out = await app.savePartial(keys, folder)
  if (!out || out.kind === 'cancelled') return
  if (out.kind === 'saved' || out.kind === 'downloaded') toast(t(out.kind === 'saved' ? 'tree.savedFile' : 'tree.downloadedFile', { name: out.name }), { kind: 'success', timeout: 8000 })
  else toast(t('tree.saveFailed'), { kind: 'error', timeout: 9000 })
}

/** PDF ou impression de certains documents (le volet a déjà choisi lesquels). */
async function exportScope(app: FolioApp, what: 'pdf' | 'print', keys: string[]): Promise<void> {
  if (what === 'pdf') return exportPdfUi(app, keys)
  printDialog(app, keys)
}
