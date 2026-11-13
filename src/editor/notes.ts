// Notes de bas de page et de fin dans l'éditeur : liste des appels de note,
// numérotation (décorations : le numéro n'est jamais du contenu), insertion,
// conversion d'un type à l'autre, passage d'une note à la suivante.

import { closeHistory } from 'prosemirror-history'
import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, Plugin, PluginKey, TextSelection, type Command, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { runsText } from '../format/runs'
import { defaultNotes, type Block, type NoteFormat, type NoteSettings } from '../format/types'
import { pageLabel } from '../layout/paginate'
import { schema } from './schema'

export type NoteKind = 'foot' | 'end'

/** Un appel de note dans le document. */
export interface NoteRef {
  pos: number
  node: PMNode
  kind: NoteKind
  /** Section qui contient l'appel (0 : avant le premier saut de section). */
  section: number
}

/** Les appels de note, dans l'ordre du document. */
export function collectNotes(doc: PMNode): NoteRef[] {
  const out: NoteRef[] = []
  let section = 0
  doc.descendants((node, pos) => {
    if (node.type.name === 'section_break') {
      section++
      return false
    }
    if (node.type.name === 'note') {
      out.push({ pos, node, kind: node.attrs.kind === 'end' ? 'end' : 'foot', section })
      return false
    }
    // Les nœuds sans contenu en ligne ne peuvent pas contenir d'appel.
    return !node.isLeaf
  })
  return out
}

const SYMBOLS = ['*', '†', '‡', '§', '¶', '‖']

/** Numéro de note mis en forme : 1, i, I, a, A ou *, †, ‡… (puis **, ††…). */
export function noteNumber(n: number, format: NoteFormat): string {
  if (format === 'symbols') {
    const k = Math.max(1, n) - 1
    return SYMBOLS[k % SYMBOLS.length].repeat(Math.floor(k / SYMBOLS.length) + 1)
  }
  return pageLabel(n, format)
}

/**
 * Numéro de chaque note (même ordre que `refs`). `pageOf` donne la page d'une
 * position, pour les notes qui recommencent à chaque page.
 */
export function noteLabels(refs: NoteRef[], settings: NoteSettings, pageOf?: (pos: number) => number): string[] {
  const counters: Record<NoteKind, { n: number; key: string }> = { foot: { n: 0, key: '' }, end: { n: 0, key: '' } }
  return refs.map((r) => {
    const s = settings[r.kind] ?? defaultNotes()[r.kind]
    const key = s.restart === 'section' ? `s${r.section}` : s.restart === 'page' && pageOf ? `p${pageOf(r.pos)}` : ''
    const c = counters[r.kind]
    if (c.key !== key) {
      c.key = key
      c.n = 0
    }
    c.n++
    return noteNumber(s.start + c.n - 1, s.format)
  })
}

/** Texte brut d'une note (infobulle, accessibilité, recherche). */
export function noteText(blocks: Block[]): string {
  const parts: string[] = []
  for (const b of blocks) {
    if (b.type === 'paragraph' || b.type === 'heading') parts.push(runsText(b.content))
    else if (b.type === 'list') for (const it of b.items) parts.push(runsText(it.content))
    else if (b.type === 'code') parts.push(b.text)
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

// --- numérotation -------------------------------------------------------------

export interface NotesContext {
  /** Page d'une position (vue page), pour « recommencer à chaque page ». */
  pageOf?: (pos: number) => number
  /** Mots de l'interface : « Note de bas de page », « Note de fin ». */
  label: (kind: NoteKind) => string
  /** Ouvre une note à la modification (double-clic, Entrée sur l'appel). */
  open?: (pos: number) => void
}

export const notesKey = new PluginKey<DecorationSet>('folio-notes')

function decorate(doc: PMNode, ctx: NotesContext): DecorationSet {
  const refs = collectNotes(doc)
  if (!refs.length) return DecorationSet.empty
  const labels = noteLabels(refs, doc.attrs.notes as NoteSettings, ctx.pageOf)
  return DecorationSet.create(
    doc,
    refs.map((r, i) => {
      const text = noteText(r.node.attrs.blocks as Block[])
      return Decoration.node(r.pos, r.pos + 1, {
        'data-label': labels[i],
        'aria-label': `${ctx.label(r.kind)} ${labels[i]}${text ? ` : ${text.slice(0, 200)}` : ''}`,
        title: text.slice(0, 300),
      })
    }),
  )
}

/** Greffon : numéros des appels de note ; double-clic ou Entrée pour modifier la note. */
export function notesPlugin(ctx: NotesContext): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: notesKey,
    state: {
      init: (_c, state) => decorate(state.doc, ctx),
      apply: (tr, prev, _old, state) => (tr.docChanged || tr.getMeta(notesKey) ? decorate(state.doc, ctx) : prev),
    },
    props: {
      decorations: (state) => notesKey.getState(state),
      handleDoubleClickOn: (_view, _pos, node, nodePos) => {
        if (node.type.name !== 'note' || !ctx.open) return false
        ctx.open(nodePos)
        return true
      },
      handleKeyDown: (view, e) => {
        if (e.key !== 'Enter' || !ctx.open) return false
        const sel = view.state.selection
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'note') return false
        ctx.open(sel.from)
        return true
      },
    },
  })
}

/** Recalcule les numéros (après une nouvelle coupure en pages). */
export const refreshNotes = (state: EditorState) => state.tr.setMeta(notesKey, true).setMeta('addToHistory', false)

// --- commandes ----------------------------------------------------------------

const emptyNote = (): Block[] => [{ type: 'paragraph', content: [] }]

/** Une note peut-elle aller à cet endroit ? */
export function canInsertNote(state: EditorState): boolean {
  const $pos = state.doc.resolve(state.selection.to)
  const parent = $pos.parent
  if (!parent.isTextblock || parent.type.spec.code) return false
  return parent.canReplaceWith($pos.index(), $pos.index(), schema.nodes.note)
}

/**
 * Insère un appel de note après la sélection ; `done` reçoit sa position
 * (pour ouvrir la note à la modification).
 */
export function insertNote(kind: NoteKind, done?: (pos: number) => void): Command {
  return (state, dispatch) => {
    if (!canInsertNote(state)) return false
    if (dispatch) {
      const at = state.selection.to
      // Une étape d'annulation à elle seule (pas fondue dans la frappe qui précède).
      const tr = closeHistory(state.tr.insert(at, schema.nodes.note.create({ kind, blocks: emptyNote() })))
      tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView()
      dispatch(tr)
      done?.(at)
    }
    return true
  }
}

/** Change le type d'une note (bas de page ⇄ fin). */
export function convertNote(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos)
    if (!node || node.type.name !== 'note') return false
    if (dispatch) dispatch(state.tr.setNodeMarkup(pos, null, { ...node.attrs, kind: node.attrs.kind === 'end' ? 'foot' : 'end' }))
    return true
  }
}

/** Convertit toutes les notes d'un type dans l'autre (ou les échange : `from` null). */
export function convertAllNotes(from: NoteKind | null): Command {
  return (state, dispatch) => {
    const refs = collectNotes(state.doc).filter((r) => from === null || r.kind === from)
    if (!refs.length) return false
    if (dispatch) {
      const tr = state.tr
      for (const r of refs) tr.setNodeMarkup(r.pos, null, { ...r.node.attrs, kind: r.kind === 'end' ? 'foot' : 'end' })
      dispatch(tr)
    }
    return true
  }
}

/** Sélectionne l'appel de note suivant (dir 1) ou précédent (dir -1), d'un type ou de tous. */
export function gotoNote(dir: 1 | -1, kind: NoteKind | null = null): Command {
  return (state, dispatch) => {
    const refs = collectNotes(state.doc).filter((r) => kind === null || r.kind === kind)
    if (!refs.length) return false
    const sel = state.selection
    const target = dir > 0 ? refs.find((r) => r.pos >= sel.to) : [...refs].reverse().find((r) => r.pos < sel.from)
    if (!target) return false
    if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, target.pos)).scrollIntoView())
    return true
  }
}

/** Remplace le contenu d'une note (une étape annulable). */
export function setNoteBlocks(pos: number, blocks: Block[]): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos)
    if (!node || node.type.name !== 'note') return false
    if (dispatch) dispatch(state.tr.setNodeMarkup(pos, null, { ...node.attrs, blocks }))
    return true
  }
}
