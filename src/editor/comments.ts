// Commentaires dans l'éditeur. Un fil vit dans les attributs du document
// (`comments`, format Folio) ; le texte dont il parle porte la marque
// « comment » avec son identifiant. Tout changement passe par une transaction :
// ajouter, répondre, résoudre, supprimer s'annulent comme le reste.

import { closeHistory } from 'prosemirror-history'
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { CommentReply, CommentThread } from '../format/types'
import { schema } from './schema'

const markType = () => schema.marks.comment

export const threadsOf = (state: EditorState): CommentThread[] => (state.doc.attrs.comments as CommentThread[]) ?? []

/** Où porte chaque commentaire : ses morceaux de texte, dans l'ordre. */
export function commentRanges(doc: PMNode): Map<string, { from: number; to: number }[]> {
  const out = new Map<string, { from: number; to: number }[]>()
  doc.descendants((node, pos) => {
    if (!node.isInline) return true
    for (const m of node.marks) {
      if (m.type.name !== 'comment') continue
      const list = out.get(m.attrs.id) ?? []
      const last = list[list.length - 1]
      if (last && last.to === pos) last.to = pos + node.nodeSize
      else list.push({ from: pos, to: pos + node.nodeSize })
      out.set(m.attrs.id, list)
    }
    return false
  })
  return out
}

export interface PlacedThread {
  thread: CommentThread
  /** Début du texte commenté ; null : le texte a été supprimé. */
  from: number | null
  to: number | null
  /** Le texte commenté (extrait). */
  quote: string
}

/** Les fils dans l'ordre du texte ; ceux dont le texte a disparu, à la fin. */
export function placedThreads(state: EditorState): PlacedThread[] {
  const ranges = commentRanges(state.doc)
  const out = threadsOf(state).map((thread): PlacedThread => {
    const r = ranges.get(thread.id)
    if (!r?.length) return { thread, from: null, to: null, quote: '' }
    const quote = r.map((x) => state.doc.textBetween(x.from, x.to, ' ', ' ')).join(' … ')
    return { thread, from: r[0].from, to: r[r.length - 1].to, quote: quote.replace(/\s+/g, ' ').trim() }
  })
  return out.sort((a, b) => (a.from ?? Infinity) - (b.from ?? Infinity))
}

/** Commentaires sous le curseur (ou la sélection), du plus intérieur au plus extérieur. */
export function commentsAt(state: EditorState): string[] {
  const { $from, from, to, empty } = state.selection
  const marks = empty ? [...($from.nodeBefore?.marks ?? []), ...($from.nodeAfter?.marks ?? [])] : []
  if (!empty) state.doc.nodesBetween(from, to, (n) => void marks.push(...n.marks))
  return [...new Set(marks.filter((m) => m.type.name === 'comment').map((m) => m.attrs.id as string))]
}

/** Un identifiant libre : c1, c2… */
export function newCommentId(threads: CommentThread[], doc?: PMNode): string {
  const used = new Set(threads.map((t) => t.id))
  if (doc) for (const id of commentRanges(doc).keys()) used.add(id)
  let n = threads.length + 1
  while (used.has(`c${n}`)) n++
  return `c${n}`
}

/** Le mot sous le curseur (pour commenter sans sélection), ou null. */
export function wordAt(state: EditorState): { from: number; to: number } | null {
  const { $from, empty } = state.selection
  if (!empty || !$from.parent.isTextblock) return null
  const text = $from.parent.textBetween(0, $from.parent.content.size, undefined, '￼')
  const at = $from.parentOffset
  const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}_'’-]/u.test(c)
  let a = at
  let b = at
  while (a > 0 && isWord(text[a - 1])) a--
  while (b < text.length && isWord(text[b])) b++
  if (a === b) return null
  const start = $from.start()
  return { from: start + a, to: start + b }
}

const setThreads = (tr: Transaction, threads: CommentThread[]) => tr.setDocAttribute('comments', threads)

/**
 * Nouveau commentaire sur `range` (sinon la sélection, sinon le mot sous le
 * curseur). `made` reçoit l'identifiant choisi.
 */
export function addComment(first: CommentReply, range?: { from: number; to: number } | null, made?: (id: string) => void): Command {
  return (state, dispatch) => {
    const r = range ?? (state.selection.empty ? wordAt(state) : { from: state.selection.from, to: state.selection.to })
    if (!r || r.from >= r.to) return false
    // Du texte commentable (pas seulement des nœuds sans marques).
    let ok = false
    state.doc.nodesBetween(r.from, r.to, (n, _pos, parent) => {
      if (!ok && n.isInline && n.type.name !== 'note' && parent?.type.allowsMarkType(markType())) ok = true
      return !ok
    })
    if (!ok) return false
    if (dispatch) {
      const threads = threadsOf(state)
      const id = newCommentId(threads, state.doc)
      const tr = state.tr.addMark(r.from, r.to, markType().create({ id }))
      setThreads(tr, [...threads, { id, author: first.author, date: first.date, text: first.text, resolved: false, replies: [] }])
      dispatch(closeHistory(tr))
      made?.(id)
    }
    return true
  }
}

function updateThread(id: string, change: (t: CommentThread) => CommentThread | null): Command {
  return (state, dispatch) => {
    const threads = threadsOf(state)
    const i = threads.findIndex((t) => t.id === id)
    if (i < 0) return false
    if (dispatch) {
      const next = change(structuredClone(threads[i]))
      const list = next ? threads.map((t, k) => (k === i ? next : t)) : threads.filter((_, k) => k !== i)
      dispatch(closeHistory(setThreads(state.tr, list)))
    }
    return true
  }
}

export const replyToComment = (id: string, reply: CommentReply): Command =>
  updateThread(id, (t) => ({ ...t, replies: [...t.replies, reply] }))

/** Modifie le texte du commentaire (index -1) ou d'une réponse. */
export const editComment = (id: string, index: number, text: string): Command =>
  updateThread(id, (t) => {
    if (index < 0) return { ...t, text }
    if (!t.replies[index]) return t
    t.replies[index] = { ...t.replies[index], text }
    return t
  })

export const deleteReply = (id: string, index: number): Command =>
  updateThread(id, (t) => ({ ...t, replies: t.replies.filter((_, k) => k !== index) }))

export const setResolved = (id: string, resolved: boolean): Command => updateThread(id, (t) => ({ ...t, resolved }))

/** Supprime des fils et leurs marques (une étape d'annulation). */
export function deleteComments(ids: string[]): Command {
  return (state, dispatch) => {
    const set = new Set(ids)
    const threads = threadsOf(state)
    const ranges = commentRanges(state.doc)
    if (!threads.some((t) => set.has(t.id)) && ![...set].some((id) => ranges.has(id))) return false
    if (dispatch) {
      const tr = state.tr
      for (const id of set) for (const r of ranges.get(id) ?? []) tr.removeMark(r.from, r.to, markType().create({ id }))
      setThreads(tr, threads.filter((t) => !set.has(t.id)))
      dispatch(closeHistory(tr))
    }
    return true
  }
}

export const deleteComment = (id: string): Command => deleteComments([id])

/** Supprime tous les commentaires (ou seulement les résolus). */
export function deleteAllComments(onlyResolved = false): Command {
  return (state, dispatch) => {
    const threads = threadsOf(state).filter((t) => !onlyResolved || t.resolved)
    const ids = threads.map((t) => t.id)
    // Sans fil, des marques orphelines peuvent rester : on les retire aussi.
    if (!onlyResolved) for (const id of commentRanges(state.doc).keys()) if (!ids.includes(id)) ids.push(id)
    return ids.length ? deleteComments(ids)(state, dispatch) : false
  }
}

/** Sélectionne le texte d'un commentaire. */
export function selectComment(id: string): Command {
  return (state, dispatch) => {
    const r = commentRanges(state.doc).get(id)
    if (!r?.length) return false
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, r[0].from, r[r.length - 1].to)).scrollIntoView())
    return true
  }
}

/** Commentaire suivant (dir 1) ou précédent (dir -1), selon la position dans le texte. */
export function gotoComment(dir: 1 | -1, done?: (id: string) => void): Command {
  return (state, dispatch) => {
    const placed = placedThreads(state).filter((p) => p.from !== null)
    if (!placed.length) return false
    const { from, to } = state.selection
    const target = dir > 0 ? placed.find((p) => p.from! > from || (p.from! === from && p.to! > to)) : [...placed].reverse().find((p) => p.from! < from)
    if (!target) return false
    if (dispatch) {
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, target.from!, target.to!)).scrollIntoView())
      done?.(target.thread.id)
    }
    return true
  }
}

// --- affichage ------------------------------------------------------------------

export interface CommentsUiState {
  /** Texte en attente d'un nouveau commentaire (surligné pendant qu'on l'écrit). */
  draft: { from: number; to: number } | null
}

export const commentsKey = new PluginKey<CommentsUiState>('folio-comments')

/** Greffon : le texte d'un commentaire en cours d'écriture reste visible, même sans le focus. */
export function commentsPlugin(): Plugin<CommentsUiState> {
  return new Plugin<CommentsUiState>({
    key: commentsKey,
    state: {
      init: () => ({ draft: null }),
      apply: (tr, prev) => {
        const meta = tr.getMeta(commentsKey) as Partial<CommentsUiState> | undefined
        let next = meta ? { ...prev, ...meta } : prev
        if (tr.docChanged && next.draft) {
          const from = tr.mapping.map(next.draft.from, 1)
          const to = tr.mapping.map(next.draft.to, -1)
          next = { ...next, draft: from < to ? { from, to } : null }
        }
        return next
      },
    },
    props: {
      decorations: (state) => {
        const d = commentsKey.getState(state)?.draft
        return d ? DecorationSet.create(state.doc, [Decoration.inline(d.from, d.to, { class: 'fp-comment-draft' })]) : null
      },
    },
  })
}

export const setCommentDraft = (state: EditorState, draft: CommentsUiState['draft']) => state.tr.setMeta(commentsKey, { draft }).setMeta('addToHistory', false)
