// Extraits réutilisables (« blocs QuickPart ») : un passage enregistré une fois,
// inséré ensuite dans n'importe quel document, depuis le menu ou en tapant son
// raccourci puis F3. Gardés dans le navigateur seulement (IndexedDB), jamais
// dans le fichier ; exportables en .json pour changer de navigateur.

import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model'
import type { Command, EditorState } from 'prosemirror-state'
import { Transform } from 'prosemirror-transform'
import { loadDocument } from '../format/load'
import type { Block } from '../format/types'
import { blocksToPM, pmToDoc } from './convert'
import { schema } from './schema'

export interface Snippet {
  id: string
  name: string
  /** Raccourci à taper avant F3 (vide : le nom sert de raccourci). */
  shortcut: string
  blocks: Block[]
  /** Images de l'extrait (identifiant → URI data:). */
  assets: Record<string, string>
  /** Un morceau de paragraphe : inséré dans la ligne, sans créer de paragraphe. */
  inline: boolean
  created: string
}

export const SNIPPET_LIMITS = { count: 500, name: 80, shortcut: 32, json: 20_000_000 }
export const SHORTCUT = /^[\p{L}\p{N}_-]{1,32}$/u

/**
 * La sélection → contenu d'un extrait. Les commentaires, signets et marques
 * de suivi ne suivent pas (ils n'ont de sens que dans leur document) ; le
 * texte supprimé en attente est retiré.
 */
export function selectionContent(state: EditorState, from = state.selection.from, to = state.selection.to): { blocks: Block[]; assets: Record<string, string>; inline: boolean } | null {
  if (from >= to) return null
  // Avec les nœuds parents : un morceau de paragraphe reste dans son paragraphe (ouvert). Dans un
  // seul paragraphe (d'une cellule, d'une liste…) : ce paragraphe seulement.
  const $from = state.doc.resolve(from)
  const $to = state.doc.resolve(to)
  const para = $from.parent
  const slice =
    $from.parent === $to.parent && para.isTextblock
      ? new Slice(Fragment.from(schema.nodes.paragraph.create(para.type === schema.nodes.paragraph ? para.attrs : null, para.content.cut($from.parentOffset, $to.parentOffset))), 1, 1)
      : state.doc.slice(from, to, true)
  let doc: PMNode
  try {
    doc = schema.nodes.doc.create(state.doc.attrs, slice.content)
    doc.check()
  } catch {
    // Sélection de cellules : on garde les paragraphes.
    const paras: PMNode[] = []
    slice.content.descendants((node) => {
      if (node.isTextblock) {
        paras.push(node.type === schema.nodes.paragraph ? node : schema.nodes.paragraph.create(null, node.content))
        return false
      }
      return true
    })
    if (!paras.length) return null
    doc = schema.nodes.doc.create(state.doc.attrs, paras)
  }
  const tr = new Transform(doc)
  const deleted: [number, number][] = []
  tr.doc.descendants((node, pos) => {
    if (node.isInline && schema.marks.deletion.isInSet(node.marks)) deleted.push([pos, pos + node.nodeSize])
    if (node.type === schema.nodes.bookmark) deleted.push([pos, pos + node.nodeSize])
  })
  for (const [a, b] of deleted.reverse()) tr.delete(a, b)
  tr.removeMark(0, tr.doc.content.size, schema.marks.comment)
  tr.removeMark(0, tr.doc.content.size, schema.marks.insertion)
  const folio = pmToDoc(tr.doc, { id: 'snippet', created: '', modified: '' })
  const blocks = folio.blocks.filter((b) => b.type !== 'section')
  if (!blocks.length) return null
  const inline = blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].style && slice.openStart > 0 && slice.openEnd > 0
  return { blocks, assets: folio.assets, inline }
}

/** Les nœuds d'un extrait, prêts à insérer. */
export function snippetSlice(s: Pick<Snippet, 'blocks' | 'assets' | 'inline'>): Slice {
  const nodes = blocksToPM(s.blocks, s.assets)
  if (s.inline && nodes.length === 1 && nodes[0].type === schema.nodes.paragraph) return new Slice(nodes[0].content, 0, 0)
  return new Slice(Fragment.fromArray(nodes), 0, 0)
}

export function insertSnippet(s: Pick<Snippet, 'blocks' | 'assets' | 'inline'>): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.replaceSelection(snippetSlice(s)).scrollIntoView())
    return true
  }
}

/** Le mot juste avant le curseur (lettres, chiffres, _ et -). */
export function wordBefore(state: EditorState): string {
  const { $from, empty } = state.selection
  if (!empty || !$from.parent.isTextblock) return ''
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - SNIPPET_LIMITS.shortcut), $from.parentOffset, undefined, '￼')
  return /[\p{L}\p{N}_-]+$/u.exec(before)?.[0] ?? ''
}

/** L'extrait que désigne un mot : son raccourci, son nom, ou le début d'un seul nom (4 lettres au moins). */
export function findSnippet(list: Snippet[], word: string): Snippet | null {
  const w = word.toLocaleLowerCase()
  if (!w) return null
  const exact = list.find((s) => s.shortcut.toLocaleLowerCase() === w) ?? list.find((s) => s.name.toLocaleLowerCase() === w)
  if (exact) return exact
  if (w.length < 4) return null
  const prefix = list.filter((s) => s.name.toLocaleLowerCase().startsWith(w))
  return prefix.length === 1 ? prefix[0] : null
}

/** F3 : remplace le mot avant le curseur par l'extrait qu'il désigne. */
export function expandSnippet(list: () => Snippet[], onMissing?: (word: string) => void): Command {
  return (state, dispatch) => {
    const word = wordBefore(state)
    const s = findSnippet(list(), word)
    if (!s) {
      if (dispatch) onMissing?.(word)
      return !!onMissing
    }
    if (dispatch) {
      const to = state.selection.from
      const tr = state.tr.delete(to - word.length, to)
      dispatch(tr.replaceSelection(snippetSlice(s)).scrollIntoView())
    }
    return true
  }
}

/** Valide un extrait venu d'un fichier (export d'un autre navigateur) ; null s'il est inutilisable. */
export function cleanSnippet(raw: unknown, now: string): Snippet | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LIMITS.name) : ''
  if (!name || !Array.isArray(o.blocks)) return null
  // Le contenu passe par la validation du format, comme un document.
  const loaded = loadDocument({ format: 'folio/doc', version: 1, blocks: o.blocks, assets: o.assets && typeof o.assets === 'object' ? o.assets : {} }, { now })
  if (!loaded.ok || !loaded.doc.blocks.length) return null
  const r = loaded.doc
  const shortcut = typeof o.shortcut === 'string' && SHORTCUT.test(o.shortcut) ? o.shortcut : ''
  return { id: typeof o.id === 'string' && /^[\w-]{1,64}$/.test(o.id) ? o.id : newId(), name, shortcut, blocks: r.blocks, assets: r.assets, inline: o.inline === true && r.blocks.length === 1 && r.blocks[0].type === 'paragraph', created: typeof o.created === 'string' ? o.created.slice(0, 40) : now }
}

export const newId = (): string => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
