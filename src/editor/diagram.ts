// Diagrammes dans l'éditeur : vue (le dessin SVG aux couleurs du thème),
// conversion de la liste du curseur en diagramme, insertion, modification.

import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, Plugin, type Command, type EditorState } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { chartLook } from '../format/chart'
import { DIAGRAM_LIMITS, diagramDrawing } from '../format/diagram'
import type { DiagramBlock, DiagramItem, Theme } from '../format/types'
import { isListNode } from './commands'
import { schema } from './schema'

const n = schema.nodes

export interface DiagramHooks {
  /** Modifier le diagramme (double-clic, Entrée). */
  edit: (pos: number) => void
  /** Infobulle. */
  label: () => string
}

/** Le bloc Folio d'un nœud diagramme. */
export function diagramOf(node: PMNode): DiagramBlock {
  const a = node.attrs
  return {
    type: 'diagram',
    kind: a.kind,
    items: (a.items as DiagramItem[]).map((it) => ({ text: it.text, level: it.level })),
    ...(a.title ? { title: a.title as string } : {}),
    ...(a.color ? { color: a.color } : {}),
  }
}

export const diagramAttrs = (d: DiagramBlock) => ({ kind: d.kind, title: d.title ?? '', items: d.items.map((it) => ({ ...it })), color: d.color ?? null })

const views = new Set<DiagramView>()

export class DiagramView implements NodeView {
  dom: HTMLElement
  private key = ''

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private hooks: DiagramHooks | undefined,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'fp-diagram'
    this.dom.contentEditable = 'false'
    this.dom.addEventListener('dblclick', (e) => {
      const pos = this.getPos()
      if (pos === undefined || !this.view.editable) return
      e.preventDefault()
      this.hooks?.edit(pos)
    })
    views.add(this)
    this.render()
  }

  render(): void {
    const a = this.view.state.doc.attrs
    const key = JSON.stringify([this.node.attrs, a.theme, a.lang])
    if (key === this.key) return
    this.key = key
    this.dom.title = this.hooks?.label() ?? ''
    this.dom.dataset.kind = this.node.attrs.kind
    const tpl = document.createElement('template')
    tpl.innerHTML = diagramDrawing(diagramOf(this.node), chartLook(a.theme as Theme, a.lang as string)).svg
    this.dom.replaceChildren(tpl.content)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  stopEvent(e: Event): boolean {
    return e.type === 'dblclick'
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    views.delete(this)
  }
}

/** Le thème change : les diagrammes suivent ; Entrée sur un diagramme sélectionné le modifie. */
export function diagramPlugin(hooks: DiagramHooks | undefined): Plugin {
  return new Plugin({
    view: () => ({
      update: (view, prev) => {
        const a = view.state.doc.attrs
        const b = prev.doc.attrs
        if (a.theme === b.theme && a.lang === b.lang) return
        for (const v of views) v.render()
      },
    }),
    props: {
      handleKeyDown: (view, e) => {
        const sel = view.state.selection
        if (e.key !== 'Enter' || !(sel instanceof NodeSelection) || sel.node.type !== n.diagram || !hooks) return false
        hooks.edit(sel.from)
        return true
      },
    },
  })
}

/** Le diagramme sélectionné, s'il y en a un. */
export function diagramAt(state: EditorState): { pos: number; diagram: DiagramBlock } | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.node.type === n.diagram) return { pos: sel.from, diagram: diagramOf(sel.node) }
  return null
}

/** La liste du premier niveau qui contient le curseur : ses éléments, avec leur niveau. */
export function listItemsAt(state: EditorState): { items: DiagramItem[]; pos: number; size: number } | null {
  const { $from } = state.selection
  for (let d = 1; d <= $from.depth; d++) {
    const node = $from.node(d)
    if (!isListNode(node)) continue
    const items: DiagramItem[] = []
    const walk = (list: PMNode, level: number) => {
      list.forEach((item) => {
        item.forEach((child) => {
          if (isListNode(child)) walk(child, level + 1)
          else if (child.isTextblock && child.textContent.trim() && items.length < DIAGRAM_LIMITS.items) items.push({ text: child.textContent.trim().slice(0, DIAGRAM_LIMITS.text), level: Math.min(level, DIAGRAM_LIMITS.level) })
        })
      })
    }
    walk(node, 0)
    return items.length ? { items, pos: $from.before(d), size: node.nodeSize } : null
  }
  return null
}

/** La liste du curseur devient un diagramme (sélectionné) ; une étape annulable. */
export function listToDiagram(kind: DiagramBlock['kind'] = 'list'): Command {
  return (state, dispatch) => {
    const l = listItemsAt(state)
    if (!l) return false
    if (dispatch) {
      const tr = state.tr.replaceWith(l.pos, l.pos + l.size, n.diagram.create(diagramAttrs({ type: 'diagram', kind, items: l.items })))
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, l.pos)).scrollIntoView())
    }
    return true
  }
}

/** Insère un diagramme après le bloc du curseur ; il est sélectionné. */
export function insertDiagram(d: DiagramBlock): Command {
  return (state, dispatch) => {
    const { $to } = state.selection
    const pos = $to.depth ? $to.after(1) : $to.pos
    if (dispatch) {
      const tr = state.tr.insert(pos, n.diagram.create(diagramAttrs(d)))
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView())
    }
    return true
  }
}

/** Remplace un diagramme. */
export function updateDiagram(pos: number, d: DiagramBlock): Command {
  return (state, dispatch) => {
    if (state.doc.nodeAt(pos)?.type !== n.diagram) return false
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(pos, null, diagramAttrs(d))
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)))
    }
    return true
  }
}
