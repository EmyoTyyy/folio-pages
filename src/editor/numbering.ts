// Listes numérotées qui « continuent » la précédente : leur numéro de départ
// suit le nombre d'éléments de la liste numérotée précédente du même
// conteneur (page, citation, cellule). Recalculé après chaque modification.

import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, type EditorState, type Transaction } from 'prosemirror-state'
import { schema } from './schema'

const n = schema.nodes

/** Transaction qui remet à jour les numéros de départ, ou null si tout est juste. */
export function fixNumbering(state: EditorState): Transaction | null {
  let tr: Transaction | null = null
  const visit = (parent: PMNode, base: number) => {
    let prev: { order: number; count: number } | null = null
    parent.forEach((child, offset) => {
      const pos = base + offset
      if (child.type === n.ordered_list) {
        let order = child.attrs.order as number
        if (child.attrs.continue && prev) {
          const want = prev.order + prev.count
          if (want !== order) {
            tr ??= state.tr
            tr.setNodeMarkup(pos, null, { ...child.attrs, order: want })
            order = want
          }
        }
        prev = { order, count: child.childCount }
      }
      // Les listes imbriquées et les conteneurs ont leur propre suite.
      if (!child.isTextblock && !child.isAtom && child.childCount) visit(child, pos + 1)
    })
  }
  visit(state.doc, 0)
  return tr
}

export function numberingPlugin(): Plugin {
  return new Plugin({
    appendTransaction: (trs, _old, state) => {
      // Les étapes venues d'une autre vue y ont déjà été renumérotées.
      if (!trs.some((t) => t.docChanged && !t.getMeta('collab$'))) return null
      const tr = fixNumbering(state)
      return tr ? tr.setMeta('addToHistory', trs.every((t) => t.getMeta('addToHistory') !== false)) : null
    },
  })
}
