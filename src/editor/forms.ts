// Champs de formulaire dans l'éditeur : de vrais contrôles (zone de texte,
// liste, date, case) dans le texte, et le verrou « formulaire seulement » qui
// ne laisse modifier que les valeurs des champs.

import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, Plugin, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import type { FormKind } from '../format/types'
import { schema } from './schema'

/** Méta d'une transaction qui ne fait que remplir un champ (permise dans un formulaire protégé). */
export const FORM_FILL = 'folio-form-fill'
/** Méta du changement du verrou lui-même. */
export const FORM_LOCK = 'folio-form-lock'

export interface FormHooks {
  label: (key: 'choose' | 'type') => string
  /** Une frappe refusée dans un formulaire protégé. */
  blocked?: () => void
}

export class FormView implements NodeView {
  dom: HTMLElement
  private control: HTMLInputElement | HTMLSelectElement

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private hooks?: FormHooks,
  ) {
    this.dom = document.createElement('span')
    this.dom.className = 'fp-form'
    this.dom.contentEditable = 'false'
    this.control = this.build()
    this.dom.append(this.control)
    this.sync()
  }

  private build(): HTMLInputElement | HTMLSelectElement {
    const a = this.node.attrs
    const kind = a.kind as FormKind
    this.dom.dataset.form = kind
    let el: HTMLInputElement | HTMLSelectElement
    if (kind === 'dropdown') {
      el = document.createElement('select')
      const empty = document.createElement('option')
      empty.value = ''
      empty.textContent = a.placeholder || this.hooks?.label('choose') || '—'
      el.append(empty, ...(a.options as string[]).map((o) => Object.assign(document.createElement('option'), { value: o, textContent: o })))
      el.addEventListener('change', () => this.commit({ value: el.value }))
    } else {
      el = document.createElement('input')
      if (kind === 'checkbox') {
        el.type = 'checkbox'
        el.addEventListener('change', () => this.commit({ checked: (el as HTMLInputElement).checked }))
      } else if (kind === 'date') {
        el.type = 'date'
        el.addEventListener('change', () => this.commit({ value: el.value }))
      } else {
        el.type = 'text'
        el.placeholder = a.placeholder || this.hooks?.label('type') || ''
        el.maxLength = 1000
        el.addEventListener('input', () => {
          this.size()
          this.commit({ value: el.value })
        })
        // Entrée : on sort du champ et l'on revient au texte.
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault()
            this.view.focus()
          }
        })
      }
    }
    el.className = 'fp-form__control'
    if (a.name) el.setAttribute('aria-label', a.name)
    el.dataset.formName = a.name || ''
    return el
  }

  private size(): void {
    if (this.control instanceof HTMLInputElement && this.control.type === 'text') this.control.size = Math.max(8, Math.min(60, (this.control.value || this.control.placeholder).length + 1))
  }

  private sync(): void {
    const a = this.node.attrs
    const el = this.control
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!a.checked
    else if (document.activeElement !== el) el.value = a.value as string
    el.disabled = !this.view.editable
    this.dom.classList.toggle('is-empty', a.kind !== 'checkbox' && !a.value)
    this.size()
  }

  private commit(patch: Record<string, unknown>): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const tr = this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, ...patch }).setMeta(FORM_FILL, true)
    this.view.dispatch(tr)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type || node.attrs.kind !== this.node.attrs.kind || JSON.stringify(node.attrs.options) !== JSON.stringify(this.node.attrs.options) || node.attrs.placeholder !== this.node.attrs.placeholder) return false
    this.node = node
    this.sync()
    return true
  }

  selectNode(): void {
    this.dom.classList.add('is-selected')
  }

  deselectNode(): void {
    this.dom.classList.remove('is-selected')
  }

  stopEvent(e: Event): boolean {
    return e.target === this.control
  }

  ignoreMutation(): boolean {
    return true
  }
}

/** Formulaire protégé : toute modification est refusée, sauf remplir un champ (et lever le verrou). */
export function formsOnlyPlugin(hooks?: FormHooks): Plugin {
  const locked = (view: EditorView) => !!view.state.doc.attrs.formsOnly
  const refuse = (view: EditorView) => {
    if (!locked(view)) return false
    hooks?.blocked?.()
    return true
  }
  return new Plugin({
    filterTransaction: (tr: Transaction, state: EditorState) => {
      if (!tr.docChanged || !state.doc.attrs.formsOnly) return true
      return !!tr.getMeta(FORM_FILL) || !!tr.getMeta(FORM_LOCK) || tr.getMeta('addToHistory') === false
    },
    props: {
      handleTextInput: (view) => refuse(view),
      handlePaste: (view) => refuse(view),
      handleDrop: (view) => refuse(view),
      handleKeyDown: (view, e) => (['Backspace', 'Delete', 'Enter'].includes(e.key) ? refuse(view) : false),
    },
  })
}

const DEFAULTS: Record<FormKind, Record<string, unknown>> = {
  text: {},
  dropdown: { options: [] },
  date: {},
  checkbox: {},
}

/** Insère un champ au curseur et le sélectionne. */
export function insertFormField(kind: FormKind, attrs: Record<string, unknown> = {}): Command {
  return (state, dispatch) => {
    const node = schema.nodes.formfield.create({ ...DEFAULTS[kind], ...attrs, kind })
    const { $from } = state.selection
    if (!$from.parent.inlineContent || $from.parent.type.spec.code) return false
    if (dispatch) {
      const tr = state.tr.replaceSelectionWith(node, true)
      const at = tr.selection.from - node.nodeSize
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, Math.max(0, at))).scrollIntoView())
    }
    return true
  }
}

/** Le champ sélectionné (ou celui juste avant le curseur), et sa position. */
export function formAt(state: EditorState): { node: PMNode; pos: number } | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.node.type === schema.nodes.formfield) return { node: sel.node, pos: sel.from }
  const before = sel.$from.nodeBefore
  if (before?.type === schema.nodes.formfield) return { node: before, pos: sel.from - before.nodeSize }
  return null
}

/** Tous les champs du document, vidés (une étape d'annulation). */
export const clearForm: Command = (state, dispatch) => {
  const found: { node: PMNode; pos: number }[] = []
  state.doc.descendants((node, pos) => {
    if (node.type === schema.nodes.formfield) found.push({ node, pos })
    return true
  })
  if (!found.length) return false
  if (dispatch) {
    const tr = state.tr.setMeta(FORM_FILL, true)
    for (const f of found) tr.setNodeMarkup(f.pos, null, { ...f.node.attrs, value: '', checked: false })
    dispatch(tr)
  }
  return true
}

/** Lever ou poser le verrou « formulaire seulement ». */
export const setFormsOnly =
  (on: boolean): Command =>
  (state, dispatch) => {
    dispatch?.(state.tr.setDocAttribute('formsOnly', on).setMeta(FORM_LOCK, true))
    return true
  }
