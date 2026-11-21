// Encadrés dans l'éditeur : vue (titre modifiable sur place, icône qui ouvre
// le menu du type), insertion, et règle de saisie « [!note] ».

import { InputRule } from 'prosemirror-inputrules'
import type { Node as PMNode } from 'prosemirror-model'
import { TextSelection, type Command, type EditorState } from 'prosemirror-state'
import { findWrapping } from 'prosemirror-transform'
import type { EditorView, NodeView } from 'prosemirror-view'
import { calloutLabel } from '../format/callout'
import { CALLOUT_KINDS, type CalloutKind } from '../format/types'
import { schema } from './schema'

const n = schema.nodes

export interface CalloutHooks {
  /** Menu du type (changer de type, retirer l'encadré), ouvert depuis l'icône. */
  menu: (pos: number, anchor: HTMLElement) => void
  /** Libellé de l'icône et du titre (infobulles). */
  labels: () => { icon: string; title: string }
}

/** Titre affiché : le sien, ou celui du type dans la langue du document (de l'interface à défaut). */
export const shownTitle = (node: PMNode, docLang: string): string =>
  (node.attrs.title as string) || calloutLabel(node.attrs.kind, docLang || document.documentElement.lang || 'fr')

export class CalloutView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private head: HTMLElement
  private icon: HTMLButtonElement
  private title: HTMLElement
  private editing: HTMLInputElement | null = null

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private hooks: CalloutHooks | undefined,
  ) {
    this.dom = document.createElement('aside')
    this.dom.className = 'fp-callout'
    this.dom.setAttribute('role', 'note')
    this.head = document.createElement('div')
    this.head.className = 'fp-callout__head'
    this.head.contentEditable = 'false'
    this.icon = document.createElement('button')
    this.icon.type = 'button'
    this.icon.className = 'fp-callout__icon'
    this.icon.tabIndex = -1
    this.title = document.createElement('span')
    this.title.className = 'fp-callout__title'
    this.head.append(this.icon, this.title)
    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'fp-callout__body'
    this.dom.append(this.head, this.contentDOM)
    this.icon.addEventListener('mousedown', (e) => e.preventDefault())
    this.icon.addEventListener('click', () => {
      const pos = this.getPos()
      if (pos !== undefined && this.view.editable) this.hooks?.menu(pos, this.icon)
    })
    this.title.addEventListener('mousedown', (e) => {
      if (!this.view.editable) return
      e.preventDefault()
      this.startRename()
    })
    this.render()
  }

  private render(): void {
    const labels = this.hooks?.labels()
    this.dom.dataset.kind = this.node.attrs.kind
    this.icon.title = labels?.icon ?? ''
    this.icon.setAttribute('aria-label', labels?.icon ?? '')
    if (!this.editing) {
      this.title.textContent = shownTitle(this.node, this.view.state.doc.attrs.lang as string)
      this.title.title = labels?.title ?? ''
    }
  }

  /** Renommer sur place : Entrée ou clic ailleurs valide, Échap annule ; vide : le titre par défaut. */
  startRename(): void {
    if (this.editing) return
    const input = document.createElement('input')
    input.className = 'fp-callout__rename'
    input.maxLength = 200
    input.value = shownTitle(this.node, this.view.state.doc.attrs.lang as string)
    input.setAttribute('aria-label', this.hooks?.labels().title ?? '')
    this.editing = input
    this.title.replaceChildren(input)
    input.focus()
    input.select()
    let done = false
    const finish = (save: boolean) => {
      if (done) return
      done = true
      this.editing = null
      const pos = this.getPos()
      const value = input.value.replace(/\s+/g, ' ').trim().slice(0, 200)
      const title = value === calloutLabel(this.node.attrs.kind, 'fr') || value === calloutLabel(this.node.attrs.kind, 'en') ? '' : value
      if (save && pos !== undefined && title !== this.node.attrs.title) {
        this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, title }))
      } else this.render()
      this.view.focus()
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(false)
      }
      e.stopPropagation()
    })
    input.addEventListener('blur', () => finish(true))
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  stopEvent(e: Event): boolean {
    return this.head.contains(e.target as Node)
  }

  ignoreMutation(m: MutationRecord | { type: 'selection'; target: Node }): boolean {
    return this.head.contains(m.target)
  }
}

/** Encadré le plus proche du curseur, et sa position. */
export function calloutAt(state: EditorState): { node: PMNode; pos: number } | null {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === n.callout) return { node: $from.node(d), pos: $from.before(d) }
  return null
}

/**
 * Insère un encadré : la sélection (ou le paragraphe vide du curseur) y entre ;
 * sinon un encadré vide, après le bloc du curseur, reçoit le curseur. Dans un
 * encadré, change son type.
 */
export function insertCallout(kind: CalloutKind): Command {
  return (state, dispatch) => {
    const here = calloutAt(state)
    if (here) {
      if (dispatch) dispatch(state.tr.setNodeMarkup(here.pos, null, { ...here.node.attrs, kind }))
      return true
    }
    const { $from, $to, empty } = state.selection
    const hosts = [n.doc, n.blockquote, n.columns]
    const range = $from.blockRange($to, (node) => hosts.includes(node.type))
    if (!range) return false
    if (!empty || ($from.parent.isTextblock && $from.parent.content.size === 0)) {
      const wrapping = findWrapping(range, n.callout, { kind })
      if (!wrapping) return false
      if (dispatch) dispatch(state.tr.wrap(range, wrapping).scrollIntoView())
      return true
    }
    const at = range.end
    if (!range.parent.canReplaceWith(range.endIndex, range.endIndex, n.callout)) return false
    if (dispatch) {
      const tr = state.tr.insert(at, n.callout.create({ kind }, n.paragraph.create()))
      tr.setSelection(TextSelection.create(tr.doc, at + 2))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Retire l'encadré du curseur (son contenu reste). */
export const removeCallout: Command = (state, dispatch) => {
  const here = calloutAt(state)
  if (!here) return false
  if (dispatch) {
    const { node, pos } = here
    dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, node.content).scrollIntoView())
  }
  return true
}

/** « [!note] » (tip, important, warning, caution) en début de paragraphe ou de citation : un encadré. */
export function calloutInputRule(): InputRule {
  return new InputRule(/^\[!(note|tip|important|warning|caution)\]\s$/i, (state, match, start, end) => {
    const kind = match[1].toLowerCase() as CalloutKind
    if (!(CALLOUT_KINDS as readonly string[]).includes(kind)) return null
    const $s = state.doc.resolve(start)
    if ($s.parent.type !== n.paragraph) return null
    const tr = state.tr.delete(start, end)
    const host = $s.node($s.depth - 1)
    // « > [!NOTE] » : la citation qui vient de commencer devient un encadré.
    if (host.type === n.blockquote && $s.index($s.depth - 1) === 0) {
      tr.setNodeMarkup($s.before($s.depth - 1), n.callout, { kind })
      return tr
    }
    const $a = tr.doc.resolve(tr.mapping.map($s.before() + 1))
    const range = $a.blockRange()
    const wrapping = range && findWrapping(range, n.callout, { kind })
    return range && wrapping ? tr.wrap(range, wrapping) : null
  })
}
