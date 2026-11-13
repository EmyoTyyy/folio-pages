// Tableaux et images : trouver l'objet courant, changer ses attributs, trier.

import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, type Command, type EditorState } from 'prosemirror-state'
import { TableMap } from 'prosemirror-tables'
import { schema } from './schema'

const n = schema.nodes

/** Tableau qui contient la sélection, et sa position. */
export function tableAt(state: EditorState): { node: PMNode; pos: number } | null {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === n.table) return { node: $from.node(d), pos: $from.before(d) }
  if (state.selection instanceof NodeSelection && state.selection.node.type === n.table) return { node: state.selection.node, pos: state.selection.from }
  return null
}

export function setTableAttrs(attrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const t = tableAt(state)
    if (!t) return false
    dispatch?.(state.tr.setNodeMarkup(t.pos, null, { ...t.node.attrs, ...attrs }))
    return true
  }
}

/** Image sélectionnée (ou dont la légende contient le curseur). */
export function figureAt(state: EditorState): { node: PMNode; pos: number } | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.node.type === n.figure) return { node: sel.node, pos: sel.from }
  const { $from } = sel
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === n.figure) return { node: $from.node(d), pos: $from.before(d) }
  return null
}

export function setFigureAttrs(attrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const f = figureAt(state)
    if (!f) return false
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(f.pos, null, { ...f.node.attrs, ...attrs })
      // Garder l'image sélectionnée après la modification.
      if (state.selection instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, f.pos))
      dispatch(tr)
    }
    return true
  }
}

const collator = () => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Trie les lignes du tableau (sauf la ligne d'en-tête) selon la colonne du
 * curseur. Impossible s'il y a des cellules fusionnées : renvoie false.
 */
export function sortTable(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const t = tableAt(state)
    if (!t) return false
    const map = TableMap.get(t.node)
    // Colonne du curseur.
    const { $from } = state.selection
    let cellPos = -1
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d)
      if (node.type === n.table_cell || node.type === n.table_header) {
        cellPos = $from.before(d) - t.pos - 1
        break
      }
    }
    if (cellPos < 0) return false
    const col = map.colCount(cellPos)
    let merged = false
    t.node.descendants((node) => {
      if (node.type === n.table_cell || node.type === n.table_header) {
        if (node.attrs.colspan > 1 || node.attrs.rowspan > 1) merged = true
        return false
      }
      return true
    })
    if (merged) return false
    const rows: PMNode[] = []
    t.node.forEach((r) => rows.push(r))
    const head = rows[0] && rows[0].firstChild?.type === n.table_header ? [rows[0]] : []
    const body = rows.slice(head.length)
    if (body.length < 2) return true
    const key = (r: PMNode) => (r.childCount > col ? r.child(col).textContent.trim() : '')
    const c = collator()
    const sorted = [...body].sort((a, b) => {
      const ka = key(a)
      const kb = key(b)
      // Les cellules vides vont à la fin, quel que soit le sens.
      if (!ka && kb) return 1
      if (ka && !kb) return -1
      const na = Number(ka.replace(/\s/g, '').replace(',', '.'))
      const nb = Number(kb.replace(/\s/g, '').replace(',', '.'))
      if (Number.isFinite(na) && Number.isFinite(nb) && ka && kb) return (na - nb) * dir
      return c.compare(ka, kb) * dir
    })
    if (dispatch) {
      const table = t.node.type.create(t.node.attrs, [...head, ...sorted], t.node.marks)
      dispatch(state.tr.replaceWith(t.pos, t.pos + t.node.nodeSize, table).scrollIntoView())
    }
    return true
  }
}

/** Ligne d'en-tête : la première ligne du tableau devient (ou cesse d'être) une ligne d'en-tête. */
export const toggleFirstRowHeader: Command = (state, dispatch) => {
  const t = tableAt(state)
  if (!t || !t.node.firstChild) return false
  if (dispatch) {
    const first = t.node.firstChild
    const isHeader = first.childCount > 0 && Array.from({ length: first.childCount }, (_, i) => first.child(i)).every((c) => c.type === n.table_header)
    const type = isHeader ? n.table_cell : n.table_header
    const tr = state.tr
    let pos = t.pos + 2 // dans la première ligne
    first.forEach((cell) => {
      tr.setNodeMarkup(pos, type, cell.attrs)
      pos += cell.nodeSize
    })
    dispatch(tr)
  }
  return true
}
