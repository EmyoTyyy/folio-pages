// Rechercher et remplacer, avec expressions régulières.
//
// La recherche se fait paragraphe par paragraphe (un résultat ne traverse pas
// deux paragraphes, comme dans tout traitement de texte). Un champ ou un saut
// de ligne compte pour un caractère. Les résultats sont surlignés par des
// décorations ; remplacer tout est une seule étape d'annulation.
//
// Option « texte surligné seulement » : sans texte cherché, chaque passage
// surligné (couleurs mêlées comprises) est un résultat ; avec un texte, seuls
// les résultats entièrement surlignés comptent.

import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

export interface FindQuery {
  text: string
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
  /** Ne garder que le texte surligné (au surligneur, pas la trame de caractère). */
  highlighted?: boolean
}

export interface Match {
  from: number
  to: number
}

export const MAX_MATCHES = 10_000

export interface FindState {
  query: FindQuery | null
  matches: Match[]
  /** Indice du résultat courant (-1 : aucun). */
  current: number
  error: string | null
  /** Au-delà de MAX_MATCHES, les résultats suivants ne sont pas comptés. */
  truncated: boolean
  decorations: DecorationSet
}

export const findKey = new PluginKey<FindState>('folio-find')

/** Expression de recherche ; null et un message si l'expression est invalide. */
export function matcher(q: FindQuery): { re: RegExp | null; error: string | null } {
  if (!q.text) return { re: null, error: null }
  let source = q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  if (q.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`
  try {
    return { re: new RegExp(source, `gu${q.caseSensitive ? '' : 'i'}`), error: null }
  } catch (e) {
    return { re: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Texte d'un paragraphe : chaque position du document correspond à un caractère. */
export function blockText(block: PMNode): string {
  let s = ''
  block.forEach((child) => {
    if (child.isText) s += child.text
    else s += child.type.name === 'hard_break' ? '\n' : '￼'
  })
  return s
}

/** Passages surlignés d'un paragraphe, en décalages dans blockText ; les voisins sont fusionnés. */
export function highlightedSpans(block: PMNode): Match[] {
  const hl = block.type.schema.marks.highlight
  const spans: Match[] = []
  if (!hl) return spans
  let off = 0
  block.forEach((child) => {
    if (hl.isInSet(child.marks)) {
      const last = spans[spans.length - 1]
      if (last && last.to === off) last.to = off + child.nodeSize
      else spans.push({ from: off, to: off + child.nodeSize })
    }
    off += child.nodeSize
  })
  return spans
}

export function findMatches(doc: PMNode, q: FindQuery): { matches: Match[]; error: string | null; truncated: boolean } {
  const { re, error } = matcher(q)
  const matches: Match[] = []
  const onlyHighlights = !!q.highlighted && !q.text
  if (!re && !onlyHighlights) return { matches, error, truncated: false }
  let truncated = false
  doc.descendants((node, pos) => {
    if (truncated) return false
    if (!node.isTextblock) return true
    const spans = q.highlighted ? highlightedSpans(node) : null
    if (spans) {
      if (!spans.length) return false
      if (onlyHighlights) {
        for (const s of spans) {
          if (matches.length >= MAX_MATCHES) {
            truncated = true
            break
          }
          matches.push({ from: pos + 1 + s.from, to: pos + 1 + s.to })
        }
        return false
      }
    }
    if (!re) return false
    const text = blockText(node)
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      if (m[0].length === 0) {
        re.lastIndex++ // une correspondance vide ne mène nulle part
        continue
      }
      const start = m.index
      const end = start + m[0].length
      if (spans && !spans.some((s) => s.from <= start && end <= s.to)) continue
      if (matches.length >= MAX_MATCHES) {
        truncated = true
        break
      }
      matches.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length })
    }
    return false
  })
  return { matches, error, truncated }
}

function decorate(doc: PMNode, matches: Match[], current: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'fp-find-hit fp-find-hit--current' : 'fp-find-hit' })),
  )
}

/** Résultat courant : celui qui commence à la sélection, ou le suivant. */
function currentFor(matches: Match[], state: EditorState): number {
  const { from } = state.selection
  const i = matches.findIndex((m) => m.from >= from)
  return matches.length ? (i < 0 ? 0 : i) : -1
}

function compute(state: EditorState, query: FindQuery | null): FindState {
  if (!query || !(query.text || query.highlighted)) return { query, matches: [], current: -1, error: null, truncated: false, decorations: DecorationSet.empty }
  const { matches, error, truncated } = findMatches(state.doc, query)
  // Le résultat courant suit la sélection quand elle couvre exactement un résultat.
  const { from, to } = state.selection
  let current = matches.findIndex((m) => m.from === from && m.to === to)
  if (current < 0) current = currentFor(matches, state)
  return { query, matches, current, error, truncated, decorations: decorate(state.doc, matches, current) }
}

export function findPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: (_c, state) => compute(state, null),
      apply: (tr, prev, _old, state) => {
        const meta = tr.getMeta(findKey) as { query: FindQuery | null } | undefined
        if (meta) return compute(state, meta.query)
        if (!prev.query) return prev
        if (tr.docChanged || tr.selectionSet) return compute(state, prev.query)
        return prev
      },
    },
    props: {
      decorations: (state) => findKey.getState(state)?.decorations,
    },
  })
}

export const findState = (state: EditorState): FindState | undefined => findKey.getState(state)

export function setQuery(query: FindQuery | null): Command {
  return (state, dispatch) => {
    dispatch?.(state.tr.setMeta(findKey, { query }))
    return true
  }
}

function select(tr: Transaction, m: Match): Transaction {
  return tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView()
}

/** Va au résultat suivant (ou précédent), en revenant au début après le dernier. */
export function findNext(dir: 1 | -1 = 1): Command {
  return (state, dispatch) => {
    const fs = findState(state)
    if (!fs?.matches.length) return false
    const { from, to } = state.selection
    let i: number
    if (dir > 0) {
      i = fs.matches.findIndex((m) => m.from > from || (m.from === from && m.to > to))
      if (i < 0) i = 0
    } else {
      i = -1
      for (let k = fs.matches.length - 1; k >= 0; k--) if (fs.matches[k].from < from) {
        i = k
        break
      }
      if (i < 0) i = fs.matches.length - 1
    }
    dispatch?.(select(state.tr, fs.matches[i]))
    return true
  }
}

/** Texte de remplacement d'un résultat ($1, $& … avec une expression régulière). */
export function replacementFor(state: EditorState, m: Match, q: FindQuery, replacement: string): string {
  if (!q.regex) return replacement
  const { re } = matcher(q)
  if (!re) return replacement
  const $from = state.doc.resolve(m.from)
  const text = blockText($from.parent)
  const offset = m.from - $from.start()
  const local = new RegExp(re.source, re.flags.replace('g', '') + 'y')
  local.lastIndex = offset
  const found = local.exec(text)
  if (!found) return replacement
  return found[0].replace(new RegExp(re.source, re.flags.replace('g', '')), replacement)
}

/** Remplace le résultat sélectionné, puis va au suivant. */
export function replaceCurrent(replacement: string): Command {
  return (state, dispatch) => {
    const fs = findState(state)
    if (!fs?.query || !fs.matches.length) return false
    const { from, to } = state.selection
    const m = fs.matches.find((x) => x.from === from && x.to === to)
    if (!m) return findNext(1)(state, dispatch)
    if (dispatch) {
      const text = replacementFor(state, m, fs.query, replacement)
      const tr = text ? state.tr.insertText(text, m.from, m.to) : state.tr.delete(m.from, m.to)
      const after = tr.mapping.map(m.to)
      // Le suivant se calcule sur le document modifié.
      const next = findMatches(tr.doc, fs.query).matches.find((x) => x.from >= after)
      if (next) select(tr, next)
      else tr.setSelection(TextSelection.create(tr.doc, after))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Remplace tous les résultats en une seule étape ; renvoie le nombre de remplacements. */
export function replaceAll(replacement: string, onCount?: (n: number) => void): Command {
  return (state, dispatch) => {
    const fs = findState(state)
    if (!fs?.query || !fs.matches.length) {
      onCount?.(0)
      return false
    }
    if (dispatch) {
      const tr = state.tr
      // Du dernier au premier : les positions des précédents ne bougent pas.
      for (let i = fs.matches.length - 1; i >= 0; i--) {
        const m = fs.matches[i]
        const text = replacementFor(state, m, fs.query, replacement)
        if (text) tr.insertText(text, m.from, m.to)
        else tr.delete(m.from, m.to)
      }
      dispatch(tr.scrollIntoView())
    }
    onCount?.(fs.matches.length)
    return true
  }
}
