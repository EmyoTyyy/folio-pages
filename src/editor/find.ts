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
//
// Les notes de bas de page et de fin sont cherchées aussi : leurs résultats
// viennent à la place de l'appel de note, dans l'ordre du texte. Leurs
// positions sont celles du contenu de la note (le petit éditeur qui l'ouvre a
// le même document) ; remplacer réécrit la note.

import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import { Transform } from 'prosemirror-transform'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { Block } from '../format/types'
import { blocksToPM, pmToBlocks } from './convert'

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
  /** Résultat dans une note : position de l'appel de note ; from et to sont alors dans le contenu de la note. */
  note?: number
}

/** Ordre des résultats : ceux d'une note juste après le texte qui précède son appel. */
const orderOf = (m: Match) => (m.note === undefined ? m.from : m.note + 0.5)
const sameMatch = (a: Match | undefined, b: Match) => !!a && a.from === b.from && a.to === b.to && a.note === b.note

/** Contenu d'une note en document ProseMirror (mémorisé : les blocs d'une note ne changent pas sur place). */
const noteDocs = new WeakMap<object, PMNode>()
export function noteDoc(note: PMNode, assets: Record<string, string>): PMNode {
  const blocks = note.attrs.blocks as Block[]
  let d = noteDocs.get(blocks)
  if (!d) {
    d = note.type.schema.nodes.doc.create(null, blocksToPM(blocks, assets))
    noteDocs.set(blocks, d)
  }
  return d
}
const assetsOf = (doc: PMNode) => (doc.attrs.hfAssets as Record<string, string> | undefined) ?? {}

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

export function findMatches(doc: PMNode, q: FindQuery, inNotes = true): { matches: Match[]; error: string | null; truncated: boolean } {
  const { re, error } = matcher(q)
  const matches: Match[] = []
  const onlyHighlights = !!q.highlighted && !q.text
  if (!re && !onlyHighlights) return { matches, error, truncated: false }
  let truncated = false
  const notes: { node: PMNode; pos: number }[] = []
  doc.descendants((node, pos) => {
    if (truncated) return false
    if (!node.isTextblock) return true
    if (inNotes) node.forEach((child, off) => {
      if (child.type.name === 'note') notes.push({ node: child, pos: pos + 1 + off })
    })
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
  // Les notes, chacune dans son propre contenu ; puis tout dans l'ordre du texte.
  if (notes.length && !truncated) {
    const assets = assetsOf(doc)
    for (const n of notes) {
      const inner = findMatches(noteDoc(n.node, assets), q, false)
      for (const m of inner.matches) {
        if (matches.length >= MAX_MATCHES) {
          truncated = true
          break
        }
        matches.push({ ...m, note: n.pos })
      }
      if (truncated) break
    }
    matches.sort((a, b) => orderOf(a) - orderOf(b))
  }
  return { matches, error, truncated }
}

function decorate(doc: PMNode, matches: Match[], current: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty
  const decos: Decoration[] = []
  matches.forEach((m, i) => {
    if (m.note === undefined) decos.push(Decoration.inline(m.from, m.to, { class: i === current ? 'fp-find-hit fp-find-hit--current' : 'fp-find-hit' }))
  })
  return DecorationSet.create(doc, decos)
}

/** Résultat courant : celui qui commence à la sélection, ou le suivant (une note compte à la place de son appel). */
function currentFor(matches: Match[], state: EditorState): number {
  const { from } = state.selection
  const i = matches.findIndex((m) => orderOf(m) >= from)
  return matches.length ? (i < 0 ? 0 : i) : -1
}

/**
 * Résultats et résultat courant. Le courant est, dans l'ordre : celui qu'on demande (aller au suivant),
 * celui que la sélection couvre exactement, le même résultat de note qu'avant (la sélection ne peut pas
 * y être), ou le premier après la sélection.
 */
function compute(state: EditorState, query: FindQuery | null, wanted?: Match): FindState {
  if (!query || !(query.text || query.highlighted)) return { query, matches: [], current: -1, error: null, truncated: false, decorations: DecorationSet.empty }
  const { matches, error, truncated } = findMatches(state.doc, query)
  const { from, to } = state.selection
  let current = wanted ? matches.findIndex((m) => sameMatch(wanted, m)) : -1
  if (current < 0) current = matches.findIndex((m) => m.note === undefined && m.from === from && m.to === to)
  if (current < 0) current = currentFor(matches, state)
  return { query, matches, current, error, truncated, decorations: decorate(state.doc, matches, current) }
}

interface FindMeta {
  query?: FindQuery | null
  /** Résultat à rendre courant. */
  current?: Match
}

export function findPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: (_c, state) => compute(state, null),
      apply: (tr, prev, _old, state) => {
        const meta = tr.getMeta(findKey) as FindMeta | undefined
        if (meta && 'query' in meta) return compute(state, meta.query ?? null, meta.current)
        if (!prev.query) return prev
        if (meta?.current) return compute(state, prev.query, meta.current)
        if (tr.docChanged || tr.selectionSet) {
          // Un résultat de note reste courant tant que la sélection n'a pas bougé (la note a pu être réécrite).
          const was = prev.matches[prev.current]
          const keep = was?.note !== undefined && !tr.selectionSet ? { ...was, note: tr.mapping.map(was.note) } : undefined
          return compute(state, prev.query, keep)
        }
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

/**
 * Rend un résultat courant. Dans le texte, il est sélectionné ; dans une note, le curseur
 * se pose sur l'appel de note (l'interface ouvre la note et y sélectionne le résultat).
 */
function select(tr: Transaction, m: Match): Transaction {
  tr.setMeta(findKey, { current: m })
  if (m.note !== undefined) return tr.setSelection(TextSelection.create(tr.doc, m.note))
  return tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView()
}

/** Va au résultat suivant (ou précédent), en revenant au début après le dernier. */
export function findNext(dir: 1 | -1 = 1): Command {
  return (state, dispatch) => {
    const fs = findState(state)
    if (!fs?.matches.length) return false
    const { from, to } = state.selection
    const cur = fs.matches[fs.current]
    let i: number
    if (cur?.note !== undefined || (cur && cur.from === from && cur.to === to)) {
      // Depuis le résultat courant (il peut être dans une note, où la sélection ne va pas).
      i = (fs.current + dir + fs.matches.length) % fs.matches.length
    } else if (dir > 0) {
      i = fs.matches.findIndex((m) => orderOf(m) > from || (m.note === undefined && m.from === from && m.to > to))
      if (i < 0) i = 0
    } else {
      i = -1
      for (let k = fs.matches.length - 1; k >= 0; k--)
        if (orderOf(fs.matches[k]) < from) {
          i = k
          break
        }
      if (i < 0) i = fs.matches.length - 1
    }
    dispatch?.(select(state.tr, fs.matches[i]))
    return true
  }
}

/** Le résultat courant, s'il y en a un. */
export function currentMatch(state: EditorState): Match | null {
  const fs = findState(state)
  return fs?.matches[fs.current] ?? null
}

/** Texte de remplacement d'un résultat ($1, $& … avec une expression régulière). */
export function replacementFor(state: EditorState, m: Match, q: FindQuery, replacement: string): string {
  const doc = m.note !== undefined ? noteDocAt(state.doc, m.note) : state.doc
  return doc ? replacementIn(doc, m, q, replacement) : replacement
}

function noteDocAt(doc: PMNode, pos: number): PMNode | null {
  const node = doc.nodeAt(pos)
  return node?.type.name === 'note' ? noteDoc(node, assetsOf(doc)) : null
}

function replacementIn(doc: PMNode, m: Match, q: FindQuery, replacement: string): string {
  if (!q.regex) return replacement
  const { re } = matcher(q)
  if (!re) return replacement
  const $from = doc.resolve(m.from)
  const text = blockText($from.parent)
  const offset = m.from - $from.start()
  const local = new RegExp(re.source, re.flags.replace('g', '') + 'y')
  local.lastIndex = offset
  const found = local.exec(text)
  if (!found) return replacement
  return found[0].replace(new RegExp(re.source, re.flags.replace('g', '')), replacement)
}

/**
 * Remplace des résultats d'une même note (du dernier au premier) et réécrit la note dans `tr`.
 * Renvoie le contenu modifié de la note, pour trouver la suite.
 */
function replaceInNote(tr: Transaction, notePos: number, ms: Match[], q: FindQuery, replacement: string): PMNode | null {
  const node = tr.doc.nodeAt(notePos)
  if (node?.type.name !== 'note') return null
  const assets = assetsOf(tr.doc)
  const inner = noteDoc(node, assets)
  const t = new Transform(inner)
  for (const m of [...ms].sort((a, b) => b.from - a.from)) {
    const text = replacementIn(inner, m, q, replacement)
    // Le texte remplaçant prend la mise en forme de celui qu'il remplace (comme insertText).
    if (text) t.replaceWith(m.from, m.to, inner.type.schema.text(text, inner.resolve(m.from).marksAcross(inner.resolve(m.to)) ?? []))
    else t.delete(m.from, m.to)
  }
  const { blocks } = pmToBlocks(t.doc, assets)
  tr.setNodeMarkup(notePos, null, { ...node.attrs, blocks })
  return t.doc
}

/** Remplace le résultat courant (sélectionné, ou dans une note), puis va au suivant. */
export function replaceCurrent(replacement: string): Command {
  return (state, dispatch) => {
    const fs = findState(state)
    if (!fs?.query || !fs.matches.length) return false
    const { from, to } = state.selection
    const cur = fs.matches[fs.current]
    const m = cur?.note !== undefined ? cur : fs.matches.find((x) => x.note === undefined && x.from === from && x.to === to)
    if (!m) return findNext(1)(state, dispatch)
    if (dispatch) {
      const tr = state.tr
      let next: Match | undefined
      if (m.note !== undefined) {
        replaceInNote(tr, m.note, [m], fs.query, replacement)
        // Le suivant : dans la même note, après le texte remplacé, ou plus loin dans le texte.
        const shift = replacementFor(state, m, fs.query, replacement).length - (m.to - m.from)
        const all = findMatches(tr.doc, fs.query).matches
        next = all.find((x) => x.note === m.note && x.from >= m.to + shift) ?? all.find((x) => orderOf(x) > m.note! + 0.5)
      } else {
        const text = replacementFor(state, m, fs.query, replacement)
        if (text) tr.insertText(text, m.from, m.to)
        else tr.delete(m.from, m.to)
        const after = tr.mapping.map(m.to)
        // Le suivant se calcule sur le document modifié.
        next = findMatches(tr.doc, fs.query).matches.find((x) => orderOf(x) >= after)
        if (!next) tr.setSelection(TextSelection.create(tr.doc, after))
      }
      if (next) select(tr, next)
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Remplace tous les résultats (texte et notes) en une seule étape ; renvoie le nombre de remplacements. */
export function replaceAll(replacement: string, onCount?: (n: number) => void): Command {
  return (state, dispatch) => {
    const fs = findState(state)
    if (!fs?.query || !fs.matches.length) {
      onCount?.(0)
      return false
    }
    if (dispatch) {
      const tr = state.tr
      // Les notes d'abord : réécrire un appel de note ne déplace rien.
      const byNote = new Map<number, Match[]>()
      for (const m of fs.matches) if (m.note !== undefined) byNote.set(m.note, [...(byNote.get(m.note) ?? []), m])
      for (const [pos, ms] of byNote) replaceInNote(tr, pos, ms, fs.query, replacement)
      // Puis le texte, du dernier au premier : les positions des précédents ne bougent pas.
      for (let i = fs.matches.length - 1; i >= 0; i--) {
        const m = fs.matches[i]
        if (m.note !== undefined) continue
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

/**
 * Surligne les résultats dans le rendu d'une note (hors éditeur) : chaque paragraphe est cherché
 * en entier, les marques coupent les morceaux de texte. `current` : indice du résultat courant dans la note.
 */
export function markNoteHits(body: HTMLElement, q: FindQuery | null, current: number): void {
  for (const mark of Array.from(body.querySelectorAll('mark.fp-find-hit'))) mark.replaceWith(...Array.from(mark.childNodes))
  body.normalize()
  if (!q?.text || q.highlighted) return
  const { re } = matcher(q)
  if (!re) return
  let index = 0
  const blocks = Array.from(body.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, pre, dt, dd'))
  for (const block of blocks) {
    const nodes: Text[] = []
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => ((n.parentElement?.closest('math, .fp-math, sup.fp-note-ref') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
    })
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
    const text = nodes.map((n) => n.data).join('')
    // Longueurs d'origine : un morceau coupé garde son début, les décalages restent valables.
    const lens = nodes.map((n) => n.data.length)
    const found: [number, number][] = []
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (!m[0].length) {
        re.lastIndex++
        continue
      }
      found.push([m.index, m.index + m[0].length])
    }
    // Du dernier au premier : les morceaux déjà coupés restent valables.
    const ranges = found.map(([a, b]) => ({ a, b, i: index++ }))
    for (const { a, b, i } of ranges.reverse()) {
      let off = 0
      const pieces: { node: Text; s: number; e: number }[] = []
      nodes.forEach((node, k) => {
        const end = off + lens[k]
        if (end > a && off < b) pieces.push({ node, s: Math.max(0, a - off), e: Math.min(lens[k], b - off) })
        off = end
      })
      for (const { node, s, e } of pieces.reverse()) {
        const range = document.createRange()
        range.setStart(node, s)
        range.setEnd(node, e)
        const mark = document.createElement('mark')
        mark.className = i === current ? 'fp-find-hit fp-find-hit--current' : 'fp-find-hit'
        range.surroundContents(mark)
      }
    }
  }
}
