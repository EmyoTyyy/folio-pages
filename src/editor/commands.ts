// Commandes d'édition (phase 2) : mise en forme des caractères et des
// paragraphes, styles, listes, insertions, casse.
//
// Ce sont des commandes ProseMirror pures (état → transaction) : l'interface
// (ruban, menus, raccourcis) les appelle, et les tests les vérifient sans
// navigateur.

import { firstStrong } from '../format/bidi'
import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands'
import { Fragment, NodeRange, type Mark, type MarkType, type Node as PMNode, type NodeType } from 'prosemirror-model'
import { liftListItem, sinkListItem } from 'prosemirror-schema-list'
import { closeHistory } from 'prosemirror-history'
import { NodeSelection, Plugin, Selection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import { resolveStyle } from '../format/theme'
import type { StyleDef } from '../format/types'
import { PARA_ATTR_NAMES, schema } from './schema'

const n = schema.nodes
const m = schema.marks

/** Tailles proposées (comme sur tout traitement de texte) ; agrandir et réduire passent de l'une à l'autre. */
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96]

/** Pas de retrait (0,5 pouce, 1,27 cm). */
export const INDENT_STEP = 36

// --- marques ---------------------------------------------------------------

export const toggleFlag = (name: string): Command => toggleMark(m[name])

/** Pose (ou retire, avec null) une marque à valeur sur la sélection ou sur la saisie à venir. */
export function setMark(type: MarkType, attrs: Record<string, unknown> | null): Command {
  return (state, dispatch) => {
    const { empty, $cursor, ranges } = state.selection as TextSelection
    if (empty && !$cursor) return false
    if (!dispatch) return true
    const tr = state.tr
    if ($cursor) {
      tr.removeStoredMark(type)
      if (attrs) tr.addStoredMark(type.create(attrs))
    } else {
      for (const r of ranges) {
        tr.removeMark(r.$from.pos, r.$to.pos, type)
        if (attrs) tr.addMark(r.$from.pos, r.$to.pos, type.create(attrs))
      }
    }
    dispatch(tr.scrollIntoView())
    return true
  }
}

/** Valeur d'une marque sur la sélection : sa valeur, null si absente, 'mixed' si plusieurs. */
export function markValue(state: EditorState, type: MarkType, attr: string): unknown {
  const { $from, empty, from, to } = state.selection
  if (empty) {
    const mk = type.isInSet(state.storedMarks ?? $from.marks())
    return mk ? mk.attrs[attr] : null
  }
  let value: unknown = undefined
  let mixed = false
  state.doc.nodesBetween(from, to, (node) => {
    if (mixed || !node.isInline) return
    const mk = type.isInSet(node.marks)
    const v = mk ? mk.attrs[attr] : null
    if (value === undefined) value = v
    else if (v !== value) mixed = true
  })
  if (mixed) return 'mixed'
  return value === undefined ? null : value
}

export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks())
  return state.doc.rangeHasMark(from, to, type)
}

/** Efface la mise en forme directe : marques (sauf liens), mise en forme de paragraphe, style Normal. */
export const clearFormatting: Command = (state, dispatch) => {
  if (!dispatch) return true
  const tr = state.tr
  const { from, to, empty } = state.selection
  if (empty) {
    tr.setStoredMarks([])
  } else {
    // La mise en forme seulement : liens, commentaires et marques de suivi restent.
    const keep = new Set([m.link, m.comment, m.insertion, m.deletion, m.formatchange])
    for (const type of Object.values(schema.marks)) if (!keep.has(type)) tr.removeMark(from, to, type)
  }
  eachTextblock(state, (node, pos) => {
    const reset: Record<string, unknown> = {}
    for (const k of PARA_ATTR_NAMES) reset[k] = n.paragraph.spec.attrs![k].default
    // La modification suivie reste (accepter ou refuser la règle).
    reset.fmtChange = node.attrs.fmtChange
    if (node.type === n.heading) tr.setNodeMarkup(pos, n.paragraph, { ...reset, style: null })
    else if (node.type === n.paragraph) tr.setNodeMarkup(pos, null, { ...reset, style: null })
  })
  dispatch(tr.scrollIntoView())
  return true
}

/** Agrandit ou réduit la police d'un cran, sur toute la sélection. */
export function stepFontSize(dir: 1 | -1, styles: Record<string, StyleDef>): Command {
  return (state, dispatch) => {
    const current = (markValue(state, m.size, 'pt') as number | null | 'mixed') ?? null
    const base = typeof current === 'number' ? current : blockFontSize(state, styles)
    const next =
      dir > 0 ? (FONT_SIZES.find((s) => s > base) ?? Math.min(400, base + 12)) : ([...FONT_SIZES].reverse().find((s) => s < base) ?? Math.max(1, base - 1))
    return setMark(m.size, { pt: next })(state, dispatch)
  }
}

/** Taille du texte au curseur selon son style (sans marque de taille). */
export function blockFontSize(state: EditorState, styles: Record<string, StyleDef>): number {
  return (resolveStyle(styles, styleIdAt(state)).size as number | undefined) ?? 11
}

/** Style du paragraphe au curseur (heading2, normal, title…). */
export function styleIdAt(state: EditorState): string {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type === n.heading) return `heading${node.attrs.level}`
    if (node.type === n.code_block) return 'code'
    if (node.type === n.paragraph) {
      for (let e = d - 1; e > 0; e--) if ($from.node(e).type === n.blockquote) return 'quote'
      return node.attrs.style ?? 'normal'
    }
  }
  return 'normal'
}

// --- casse -----------------------------------------------------------------

export type CaseMode = 'upper' | 'lower' | 'title' | 'sentence' | 'toggle'

export function transformCase(text: string, mode: CaseMode, locale?: string, atStart = true): string {
  switch (mode) {
    case 'upper':
      return text.toLocaleUpperCase(locale)
    case 'lower':
      return text.toLocaleLowerCase(locale)
    case 'toggle':
      return [...text].map((c) => (c === c.toLocaleUpperCase(locale) ? c.toLocaleLowerCase(locale) : c.toLocaleUpperCase(locale))).join('')
    case 'title':
      return text.toLocaleLowerCase(locale).replace(/(^|[\s\-–—(«"“])(\p{L})/gu, (_s, sep: string, c: string) => sep + c.toLocaleUpperCase(locale))
    case 'sentence': {
      let start = atStart
      let out = ''
      for (const c of text.toLocaleLowerCase(locale)) {
        if (start && /\p{L}/u.test(c)) {
          out += c.toLocaleUpperCase(locale)
          start = false
        } else out += c
        if (/[.!?…]/.test(c)) start = true
      }
      return out
    }
  }
}

/** Change la casse du texte sélectionné, en gardant sa mise en forme. */
export function changeCase(mode: CaseMode, locale?: string): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection
    if (empty) return false
    if (!dispatch) return true
    const tr = state.tr
    const parts: { from: number; to: number; text: string; marks: readonly Mark[] }[] = []
    let first = true
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return
      const a = Math.max(from, pos)
      const b = Math.min(to, pos + node.nodeSize)
      const text = node.text!.slice(a - pos, b - pos)
      parts.push({ from: a, to: b, text: transformCase(text, mode, locale, first), marks: node.marks })
      first = false
    })
    // De la fin vers le début : les positions restent valables (même longueur… ou pas : ß → SS).
    for (const p of parts.reverse()) if (p.text) tr.replaceWith(p.from, p.to, schema.text(p.text, p.marks))
    const end = tr.mapping.map(to)
    tr.setSelection(TextSelection.create(tr.doc, from, end))
    dispatch(tr)
    return true
  }
}

// --- paragraphes -----------------------------------------------------------

/** Appelle `fn` pour chaque paragraphe ou titre touché par la sélection. */
export function eachTextblock(state: EditorState, fn: (node: PMNode, pos: number) => void): void {
  const { from, to } = state.selection
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === n.paragraph || node.type === n.heading) {
      fn(node, pos)
      return false
    }
    return true
  })
}

/** Modifie des attributs de paragraphe (alignement, retraits…) sur la sélection. */
export function setParaAttrs(attrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    let found = false
    eachTextblock(state, () => (found = true))
    if (!found) return false
    if (!dispatch) return true
    const tr = state.tr
    eachTextblock(state, (node, pos) => {
      tr.setNodeMarkup(pos, null, { ...node.attrs, ...attrs })
    })
    dispatch(tr.scrollIntoView())
    return true
  }
}

/** Valeur commune d'un attribut de paragraphe sur la sélection ('mixed' sinon). */
export function paraAttr(state: EditorState, name: string): unknown {
  let value: unknown = undefined
  let mixed = false
  eachTextblock(state, (node) => {
    const v = node.attrs[name]
    if (value === undefined) value = v
    else if (v !== value) mixed = true
  })
  return mixed ? 'mixed' : (value ?? null)
}

/** Sens effectif d'un paragraphe : celui qui est imposé, sinon celui de son texte. */
export function nodeDir(node: PMNode): 'rtl' | 'ltr' {
  const d = node.attrs.dir
  return d === 'rtl' || d === 'ltr' ? d : (firstStrong(node.textContent) ?? 'ltr')
}

/** Sens du premier paragraphe de la sélection. */
export function paraDir(state: EditorState): 'rtl' | 'ltr' {
  let dir: 'rtl' | 'ltr' | null = null
  eachTextblock(state, (node) => (dir ??= nodeDir(node)))
  return dir ?? 'ltr'
}

/**
 * Alignement, du côté de la page qu'il nomme : dans un paragraphe de droite à gauche, aligner à droite
 * l'aligne sur son début, que le format écrit « left » (gauche et droite y sont logiques, comme dans un .docx).
 */
export const setAlign =
  (align: 'left' | 'center' | 'right' | 'justify' | null): Command =>
  (state, dispatch) => {
    let found = false
    eachTextblock(state, () => (found = true))
    if (!found) return false
    if (!dispatch) return true
    const tr = state.tr
    eachTextblock(state, (node, pos) => {
      const a = nodeDir(node) === 'rtl' && (align === 'left' || align === 'right') ? (align === 'left' ? 'right' : 'left') : align
      tr.setNodeMarkup(pos, null, { ...node.attrs, align: a === 'left' ? null : a })
    })
    dispatch(tr.scrollIntoView())
    return true
  }

/** Alignement visuel commun de la sélection (gauche et droite vus sur la page), 'mixed' sinon. */
export function visualAlign(state: EditorState): string | null {
  let value: string | undefined
  let mixed = false
  eachTextblock(state, (node) => {
    const a = (node.attrs.align as string | null) ?? 'left'
    const v = nodeDir(node) === 'rtl' && (a === 'left' || a === 'right') ? (a === 'left' ? 'right' : 'left') : a
    if (value === undefined) value = v
    else if (v !== value) mixed = true
  })
  return mixed ? 'mixed' : (value ?? 'left')
}

/** Sens d'écriture des paragraphes sélectionnés ; omis quand le texte le donne déjà. */
export const setDirection =
  (dir: 'rtl' | 'ltr'): Command =>
  (state, dispatch) => {
    let found = false
    eachTextblock(state, () => (found = true))
    if (!found) return false
    if (!dispatch) return true
    const tr = state.tr
    eachTextblock(state, (node, pos) => {
      const auto = firstStrong(node.textContent) ?? 'ltr'
      tr.setNodeMarkup(pos, null, { ...node.attrs, dir: dir === auto ? null : dir })
    })
    dispatch(tr.scrollIntoView())
    return true
  }

export const setLineSpacing = (line: number | null): Command => setParaAttrs({ line })

/** Retrait : dans une liste, change de niveau ; ailleurs, déplace le retrait gauche d'un cran. */
export function indent(dir: 1 | -1): Command {
  return (state, dispatch) => {
    if (dir > 0 && sinkListItem(n.list_item)(state, dispatch)) return true
    if (dir < 0 && inList(state) && liftOutOfFlatList(state, dispatch)) return true
    let found = false
    eachTextblock(state, () => (found = true))
    if (!found) return false
    if (!dispatch) return true
    const tr = state.tr
    eachTextblock(state, (node, pos) => {
      const cur = (node.attrs.indentLeft as number | null) ?? 0
      const next = dir > 0 ? Math.min(1000, (Math.floor(cur / INDENT_STEP) + 1) * INDENT_STEP) : Math.max(0, (Math.ceil(cur / INDENT_STEP) - 1) * INDENT_STEP)
      tr.setNodeMarkup(pos, null, { ...node.attrs, indentLeft: next === 0 ? null : next })
    })
    dispatch(tr.scrollIntoView())
    return true
  }
}

// --- styles ----------------------------------------------------------------

/** Applique un style nommé au paragraphe : titre, citation, code, ou style de paragraphe. */
export function applyStyle(id: string): Command {
  return (state, dispatch) => {
    const h = /^heading([1-6])$/.exec(id)
    if (h) return setBlockTypeKeep(n.heading, { level: Number(h[1]) })(state, dispatch)
    if (id === 'code') return setBlockType(n.code_block)(state, dispatch)
    if (id === 'quote') return inNode(state, n.blockquote) ? true : wrapIn(n.blockquote)(state, dispatch)
    // Style de paragraphe : un titre ou du code redevient un paragraphe.
    const style = id === 'normal' ? null : id
    if (!dispatch) return true
    const tr = state.tr
    const { from, to } = state.selection
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === n.heading) {
        tr.setNodeMarkup(pos, n.paragraph, { ...pickPara(node.attrs), style })
        return false
      }
      if (node.type === n.paragraph) {
        tr.setNodeMarkup(pos, null, { ...node.attrs, style })
        return false
      }
      if (node.type === n.code_block) {
        tr.setNodeMarkup(pos, n.paragraph, { style })
        return false
      }
      return true
    })
    // Sortir d'une citation quand on choisit un style de paragraphe.
    dispatch(tr.scrollIntoView())
    return true
  }
}

/**
 * Enchaîne deux commandes en une seule transaction (une seule étape
 * d'annulation) : la seconde s'applique au résultat de la première.
 */
export function sequence(first: Command, second: Command): Command {
  return (state, dispatch) => {
    let tr1: Transaction | null = null
    first(state, (tr) => (tr1 = tr))
    const mid = tr1 ? state.apply(tr1) : state
    let tr2: Transaction | null = null
    if (!second(mid, (tr) => (tr2 = tr)) || !tr2) return false
    if (dispatch) {
      const all = state.tr
      for (const step of (tr1 as Transaction | null)?.steps ?? []) all.step(step)
      for (const step of (tr2 as Transaction).steps) all.step(step)
      all.setSelection(Selection.fromJSON(all.doc, (tr2 as Transaction).selection.toJSON()))
      dispatch(all.scrollIntoView())
    }
    return true
  }
}

const pickPara = (attrs: Record<string, unknown>) => {
  const out: Record<string, unknown> = {}
  for (const k of PARA_ATTR_NAMES) out[k] = attrs[k]
  return out
}

/** Change le type de bloc en gardant la mise en forme de paragraphe. */
function setBlockTypeKeep(type: NodeType, attrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    let applicable = false
    const { from, to } = state.selection
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (applicable) return false
      if (!node.isTextblock || node.hasMarkup(type, { ...node.attrs, ...attrs })) return true
      const $pos = state.doc.resolve(pos)
      if ($pos.parent.canReplaceWith($pos.index(), $pos.index() + 1, type)) applicable = true
      return false
    })
    if (!applicable) return false
    if (!dispatch) return true
    const tr = state.tr
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true
      if (node.type === n.code_block && type !== n.code_block) {
        tr.setNodeMarkup(pos, type, { ...attrs })
        return false
      }
      const keep = node.type === n.paragraph || node.type === n.heading ? pickPara(node.attrs) : {}
      const $pos = tr.doc.resolve(tr.mapping.map(pos))
      if ($pos.parent.canReplaceWith($pos.index(), $pos.index() + 1, type)) tr.setNodeMarkup(tr.mapping.map(pos), type, { ...keep, ...attrs })
      return false
    })
    dispatch(tr.scrollIntoView())
    return true
  }
}

// --- listes ----------------------------------------------------------------

export function inNode(state: EditorState, type: NodeType): PMNode | null {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === type) return $from.node(d)
  return null
}

/** Liste la plus proche du curseur et sa position. */
export function listAt(state: EditorState): { node: PMNode; pos: number } | null {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (isListNode(node)) return { node, pos: $from.before(d) }
  }
  return null
}

/** Liste à puces, numérotée ou à cocher. */
export const isListNode = (node: PMNode): boolean => node.type === n.bullet_list || node.type === n.ordered_list || node.type === n.check_list

/** Coche ou décoche les éléments de liste à cocher de la sélection (ou celui du curseur). */
export const toggleChecked: Command = (state, dispatch) => {
  const { from, to } = state.selection
  const items: { node: PMNode; pos: number }[] = []
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    // Seulement les éléments dont le paragraphe est touché : un élément parent ne suit pas sa sous-liste.
    const para = node.firstChild
    if (node.type === n.list_item && parent?.type === n.check_list && para && pos + 1 <= to && pos + 1 + para.nodeSize >= from) items.push({ node, pos })
    return true
  })
  if (!items.length) return false
  if (dispatch) {
    const on = !items.every((it) => it.node.attrs.checked)
    const tr = state.tr
    for (const it of items) tr.setNodeMarkup(it.pos, null, { ...it.node.attrs, checked: on })
    dispatch(tr)
  }
  return true
}

export const inList = (state: EditorState) => !!listAt(state)

/** Liste à puces ou numérotée : l'applique, la retire, ou change le type de la liste au curseur. */
export function toggleList(kind: 'bullet' | 'number' | 'check'): Command {
  const type = kind === 'bullet' ? n.bullet_list : kind === 'check' ? n.check_list : n.ordered_list
  return (state, dispatch) => {
    const list = listAt(state)
    if (list && list.node.type === type) return liftOutOfFlatList(state, dispatch)
    if (list) {
      if (dispatch) dispatch(state.tr.setNodeMarkup(list.pos, type, type === n.ordered_list ? { order: 1 } : null))
      return true
    }
    return wrapInFlatList(type)(state, dispatch)
  }
}

/** Maj+Tab dans une liste : remonte d'un niveau, sans jamais sortir de la liste. */
export const outdentListItem: Command = (state, dispatch) => {
  const { $from, $to } = state.selection
  const range = $from.blockRange($to, (node) => node.childCount > 0 && node.firstChild!.type === n.list_item)
  if (!range || range.depth < 2 || $from.node(range.depth - 1).type !== n.list_item) return false
  return liftListItem(n.list_item)(state, dispatch)
}

/**
 * Sort les éléments sélectionnés de leur liste. Dans une sous-liste, ils
 * remontent d'un niveau ; au premier niveau, ils redeviennent des paragraphes
 * (leurs sous-listes deviennent des listes à part) et la liste est coupée en
 * deux, la seconde partie continuant la numérotation.
 */
export const liftOutOfFlatList: Command = (state, dispatch) => {
  const { $from, $to } = state.selection
  const range = $from.blockRange($to, (node) => node.childCount > 0 && node.firstChild!.type === n.list_item)
  if (!range) return false
  if (range.depth >= 2 && $from.node(range.depth - 1).type === n.list_item) return liftListItem(n.list_item)(state, dispatch)
  if (!dispatch) return true
  const list = range.parent
  const listPos = $from.before(range.depth)
  const before: PMNode[] = []
  const selected: { item: PMNode; pos: number }[] = []
  const after: PMNode[] = []
  let itemPos = listPos + 1
  list.forEach((item, _o, i) => {
    if (i < range.startIndex) before.push(item)
    else if (i >= range.endIndex) after.push(item)
    else selected.push({ item, pos: itemPos })
    itemPos += item.nodeSize
  })
  const out: PMNode[] = []
  let cursor = listPos
  if (before.length) {
    const head = list.type.create(list.attrs, before)
    out.push(head)
    cursor += head.nodeSize
  }
  const shifts: { from: number; to: number; delta: number }[] = []
  for (const { item, pos } of selected) {
    shifts.push({ from: pos + 1, to: pos + 1 + item.content.size, delta: cursor - (pos + 1) })
    item.forEach((child) => out.push(child))
    cursor += item.content.size
  }
  if (after.length) {
    const attrs = list.type === n.ordered_list ? { ...list.attrs, continue: before.length > 0 || list.attrs.continue } : list.attrs
    out.push(list.type.create(attrs, after))
  }
  const tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, out)
  const map = (p: number) => {
    const sh = shifts.find((x) => p >= x.from && p <= x.to)
    return sh ? p + sh.delta : listPos
  }
  const sel = state.selection
  tr.setSelection(TextSelection.between(tr.doc.resolve(map(sel.anchor)), tr.doc.resolve(map(sel.head))))
  dispatch(tr.scrollIntoView())
  return true
}

/**
 * Met les paragraphes et titres sélectionnés dans une liste, un élément par
 * paragraphe (un élément de liste ne contient qu'un paragraphe et ses
 * sous-listes, comme dans le format). Les listes de la sélection prennent le
 * type demandé, et les listes voisines de même type sont réunies.
 */
export function wrapInFlatList(listType: NodeType): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection
    const range = $from.blockRange($to)
    if (!range) return false
    const parent = range.parent
    const kids: { node: PMNode; pos: number }[] = []
    let pos = range.start
    for (let i = range.startIndex; i < range.endIndex; i++) {
      const c = parent.child(i)
      kids.push({ node: c, pos })
      pos += c.nodeSize
    }
    const allowed = [n.paragraph, n.heading, n.bullet_list, n.ordered_list, n.check_list]
    if (!kids.length || !kids.every((k) => allowed.includes(k.node.type))) return false
    if (!parent.canReplaceWith(range.startIndex, range.endIndex, listType)) return false
    if (!dispatch) return true
    const tr = state.tr
    const attrs = listType === n.ordered_list ? { order: 1 } : null
    for (let k = kids.length - 1; k >= 0; k--) {
      const { node, pos: at } = kids[k]
      if (isListNode(node)) {
        if (node.type !== listType) tr.setNodeMarkup(at, listType, attrs)
        continue
      }
      if (node.type === n.heading || node.attrs.style) tr.setNodeMarkup(at, n.paragraph, { ...pickPara(node.attrs), style: null })
      const $a = tr.doc.resolve(at)
      const $b = tr.doc.resolve(at + node.nodeSize)
      tr.wrap(new NodeRange($a, $b, $a.depth), [{ type: listType, attrs }, { type: n.list_item }])
    }
    // Réunir les listes voisines de même type, de la fin vers le début.
    const base = range.$from.start(range.depth)
    const host = () => (range.depth === 0 ? tr.doc : tr.doc.resolve(base).node(range.depth))
    const lo = Math.max(0, range.startIndex - 1)
    for (let idx = Math.min(host().childCount - 1, range.endIndex); idx > lo; idx--) {
      const h = host()
      if (h.child(idx - 1).type !== listType || h.child(idx).type !== listType) continue
      let at = base
      for (let j = 0; j < idx; j++) at += h.child(j).nodeSize
      tr.join(at)
    }
    dispatch(tr.scrollIntoView())
    return true
  }
}

/** Modifie les attributs de la liste au curseur (numérotation, puce, départ, continuation). */
export function setListAttrs(attrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    // La liste du curseur, ou toutes celles que la sélection touche (Ctrl+A, plusieurs listes).
    const lists: { node: PMNode; pos: number }[] = []
    const here = listAt(state)
    const { from, to, empty } = state.selection
    if (here && empty) lists.push(here)
    else {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (isListNode(node)) {
          lists.push({ node, pos })
          return false
        }
        return true
      })
    }
    if (!lists.length && here) lists.push(here)
    if (!lists.length) return false
    if (dispatch) {
      const tr = state.tr
      for (const l of lists) tr.setNodeMarkup(l.pos, null, { ...l.node.attrs, ...attrs })
      dispatch(tr)
    }
    return true
  }
}

// --- insertions ------------------------------------------------------------

/**
 * Insère un bloc après le bloc courant (ou à sa place s'il est vide), et place
 * le curseur juste après, dans un paragraphe s'il le faut.
 */
export function insertBlock(node: PMNode, select: 'after' | 'node' | 'inside' = 'after'): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    let depth = $from.depth
    // Remonter jusqu'au bloc qui peut accueillir le nouveau nœud.
    while (depth > 0) {
      const parent = $from.node(depth - 1)
      if (parent.type.contentMatch && parent.canReplaceWith($from.index(depth - 1), $from.index(depth - 1), node.type)) break
      depth--
    }
    if (depth === 0) return false
    if (!dispatch) return true
    const tr = state.tr
    const block = $from.node(depth)
    const blockPos = $from.before(depth)
    let at: number
    if (block.isTextblock && block.content.size === 0 && block.type === n.paragraph) {
      tr.replaceWith(blockPos, blockPos + block.nodeSize, node)
      at = blockPos
    } else {
      at = blockPos + block.nodeSize
      tr.insert(at, node)
    }
    const after = at + node.nodeSize
    if (select === 'node' && node.type.spec.selectable !== false) {
      tr.setSelection(NodeSelection.create(tr.doc, at))
    } else if (select === 'inside') {
      tr.setSelection(Selection.near(tr.doc.resolve(at + 1)))
    } else {
      // Un paragraphe vide après le bloc inséré s'il n'y a rien derrière.
      const $after = tr.doc.resolve(after)
      if (!$after.nodeAfter || !$after.nodeAfter.isTextblock) tr.insert(after, n.paragraph.create())
      tr.setSelection(Selection.near(tr.doc.resolve(after + 1)))
    }
    dispatch(tr.scrollIntoView())
    return true
  }
}

export const insertPageBreak: Command = (state, dispatch) => insertBlock(n.page_break.create())(state, dispatch)

/** Page vierge : un saut, une page vide où va le curseur, un saut, après le bloc courant. */
export const insertBlankPage: Command = (state, dispatch) => {
  const { $from } = state.selection
  let depth = $from.depth
  while (depth > 0 && !$from.node(depth - 1).canReplaceWith($from.index(depth - 1), $from.index(depth - 1), n.page_break)) depth--
  if (depth === 0) return false
  if (!dispatch) return true
  const at = $from.before(depth) + $from.node(depth).nodeSize
  const br = n.page_break.create()
  const tr = state.tr.insert(at, [br, n.paragraph.create(), n.page_break.create()])
  const after = at + br.nodeSize * 2 + 2
  const $after = tr.doc.resolve(after)
  if (!$after.nodeAfter || !$after.nodeAfter.isTextblock) tr.insert(after, n.paragraph.create())
  tr.setSelection(TextSelection.create(tr.doc, at + br.nodeSize + 1))
  dispatch(tr.scrollIntoView())
  return true
}
export const insertRule: Command = (state, dispatch) => insertBlock(n.horizontal_rule.create())(state, dispatch)

/** Tableau vide, la première ligne en en-tête. */
export function makeTable(rows: number, cols: number, header = true): PMNode {
  const r = Math.max(1, Math.min(100, rows))
  const c = Math.max(1, Math.min(30, cols))
  const cell = (h: boolean) => (h ? n.table_header : n.table_cell).createAndFill()!
  const lines: PMNode[] = []
  for (let i = 0; i < r; i++) lines.push(n.table_row.create(null, Array.from({ length: c }, () => cell(header && i === 0))))
  return n.table.create(null, lines)
}

export function insertTable(rows: number, cols: number, header = true): Command {
  return (state, dispatch) => insertBlock(makeTable(rows, cols, header), 'inside')(state, dispatch)
}

/** Champ ({{page}}…) à la place de la sélection, avec la mise en forme courante. */
export function insertField(name: string, format = ''): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    if (!$from.parent.inlineContent || $from.parent.type === n.code_block) return false
    if (dispatch) {
      const marks = state.storedMarks ?? $from.marks()
      dispatch(state.tr.replaceSelectionWith(n.field.create({ name, format }, null, marks), false).scrollIntoView())
    }
    return true
  }
}

/** Texte (caractère spécial…) à la place de la sélection. */
export function insertText(text: string): Command {
  return (state, dispatch) => {
    if (!state.selection.$from.parent.inlineContent) return false
    if (dispatch) dispatch(state.tr.insertText(text).scrollIntoView())
    return true
  }
}

/** Lien sur la sélection (ou texte du lien inséré s'il n'y a pas de sélection). */
export function setLink(href: string | null, text?: string): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection
    if (!dispatch) return true
    const tr = state.tr
    if (href === null) {
      const range = empty ? markRange(state, m.link) : { from, to }
      if (!range) return false
      tr.removeMark(range.from, range.to, m.link)
    } else if (empty) {
      const range = markRange(state, m.link)
      if (range) {
        tr.removeMark(range.from, range.to, m.link).addMark(range.from, range.to, m.link.create({ href }))
      } else {
        const label = text || href
        tr.insertText(label, from)
        tr.addMark(from, from + label.length, m.link.create({ href }))
        tr.removeStoredMark(m.link)
      }
    } else {
      tr.removeMark(from, to, m.link).addMark(from, to, m.link.create({ href }))
    }
    dispatch(tr.scrollIntoView())
    return true
  }
}

/** Étendue d'une marque autour du curseur (lien…), sur les morceaux voisins qui la portent. */
export function markRange(state: EditorState, type: MarkType): { from: number; to: number; mark: Mark } | null {
  const { $from } = state.selection
  const { parent, parentOffset } = $from
  let hit = parent.childAfter(parentOffset)
  let mk = hit.node ? type.isInSet(hit.node.marks) : undefined
  if (!mk && parentOffset > 0) {
    hit = parent.childBefore(parentOffset)
    mk = hit.node ? type.isInSet(hit.node.marks) : undefined
  }
  if (!mk || !hit.node) return null
  let startIdx = hit.index
  let startOff = hit.offset
  while (startIdx > 0 && mk.isInSet(parent.child(startIdx - 1).marks)) {
    startIdx--
    startOff -= parent.child(startIdx).nodeSize
  }
  let endIdx = hit.index + 1
  let endOff = hit.offset + hit.node.nodeSize
  while (endIdx < parent.childCount && mk.isInSet(parent.child(endIdx).marks)) {
    endOff += parent.child(endIdx).nodeSize
    endIdx++
  }
  const base = $from.start()
  return { from: base + startOff, to: base + endOff, mark: mk }
}

export const toggleQuote: Command = (state, dispatch) =>
  inNode(state, n.blockquote) ? lift(state, dispatch) : applyStyle('quote')(state, dispatch)

export function setCodeBlock(language = ''): Command {
  return (state, dispatch) => {
    const code = inNode(state, n.code_block)
    if (code) return setBlockType(n.paragraph)(state, dispatch)
    return setBlockType(n.code_block, { language })(state, dispatch)
  }
}

export type { Transaction }

// --- colonnes -------------------------------------------------------------------

/** Bloc de colonnes qui contient la sélection, et sa position. */
export function columnsAt(state: EditorState): { node: PMNode; pos: number } | null {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === n.columns) return { node: $from.node(d), pos: $from.before(d) }
  return null
}

/**
 * Met le texte sélectionné en `count` colonnes (ou change le nombre de colonnes
 * du bloc courant) ; 1 colonne : le texte revient en pleine largeur.
 */
export function setColumns(count: number, rule?: boolean): Command {
  return (state, dispatch) => {
    const cur = columnsAt(state)
    if (cur) {
      if (!dispatch) return true
      if (count <= 1) {
        const inner: PMNode[] = []
        cur.node.forEach((child) => {
          if (child.type !== n.column_break) inner.push(child)
        })
        dispatch(state.tr.replaceWith(cur.pos, cur.pos + cur.node.nodeSize, inner.length ? inner : [n.paragraph.create()]).scrollIntoView())
      } else {
        dispatch(state.tr.setNodeMarkup(cur.pos, null, { ...cur.node.attrs, count, ...(rule !== undefined ? { rule } : {}) }))
      }
      return true
    }
    if (count <= 1) return false
    // Les blocs de premier niveau touchés par la sélection.
    const { $from, $to } = state.selection
    const range = $from.blockRange($to, (node) => node.type === n.doc)
    if (!range) return false
    const kids: PMNode[] = []
    for (let i = range.startIndex; i < range.endIndex; i++) kids.push(range.parent.child(i))
    if (!n.columns.validContent(Fragment.fromArray(kids))) return false
    if (dispatch) {
      const node = n.columns.create({ count, gap: 18, rule: !!rule }, kids)
      const tr = state.tr.replaceWith(range.start, range.end, node)
      tr.setSelection(Selection.near(tr.doc.resolve(range.start + 2)))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Saut de colonne (seulement dans des colonnes). */
export const insertColumnBreak: Command = (state, dispatch) => {
  if (!columnsAt(state)) return false
  return insertBlock(n.column_break.create())(state, dispatch)
}

// --- sections -------------------------------------------------------------------

/** Saut de section au premier niveau, après le bloc courant. */
export function insertSectionBreak(start: 'page' | 'odd' | 'even'): Command {
  return (state, dispatch) => insertBlock(n.section_break.create({ start }))(state, dispatch)
}

/** Saut de section qui ouvre la section du curseur (null : première section, réglée par la mise en page). */
export function sectionBreakAt(state: EditorState): { node: PMNode; pos: number } | null {
  const at = state.selection.from
  let found: { node: PMNode; pos: number } | null = null
  state.doc.forEach((node, pos) => {
    if (node.type === n.section_break && pos < at) found = { node, pos }
  })
  return found
}

export function setSectionAttrs(attrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const s = sectionBreakAt(state)
    if (!s) return false
    dispatch?.(state.tr.setNodeMarkup(s.pos, null, { ...s.node.attrs, ...attrs }))
    return true
  }
}

/**
 * Trier (Accueil → Paragraphe → Trier) : les paragraphes sélectionnés, ou les
 * éléments de la liste où se trouve la sélection, par ordre alphabétique (les
 * nombres en nombres, sans tenir compte de la casse ni des accents).
 */
export function sortParagraphs(desc: boolean, lang?: string): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection
    const isList = isListNode
    let range = $from.blockRange($to)
    // Dans une liste : on trie ses éléments (tous, si la sélection n'en couvre qu'un).
    if (range && (range.parent.type === schema.nodes.list_item || range.endIndex - range.startIndex < 2)) {
      const inList = $from.blockRange($to, isList)
      if (inList && inList.endIndex - inList.startIndex < 2) {
        const list = inList.parent
        const pos = inList.$from.before(inList.depth)
        range = state.doc.resolve(pos + 1).blockRange(state.doc.resolve(pos + list.nodeSize - 1)) ?? inList
      } else if (inList) range = inList
    }
    if (!range || range.endIndex - range.startIndex < 2) return false
    const nodes: PMNode[] = []
    for (let i = range.startIndex; i < range.endIndex; i++) nodes.push(range.parent.child(i))
    // Seulement des blocs de texte (ou des éléments de liste) : un tableau ou une image ne se trient pas.
    if (!nodes.every((n) => n.isTextblock || n.type === schema.nodes.list_item)) return false
    const coll = new Intl.Collator(lang || undefined, { numeric: true, sensitivity: 'base' })
    const sorted = [...nodes].sort((a, b) => (desc ? -1 : 1) * coll.compare(a.textContent.trim(), b.textContent.trim()))
    if (sorted.every((n, i) => n === nodes[i])) return true
    if (dispatch) {
      const tr = state.tr.replaceWith(range.start, range.end, Fragment.from(sorted))
      tr.setSelection(TextSelection.between(tr.doc.resolve(range.start + 1), tr.doc.resolve(Math.min(tr.doc.content.size, range.start + Fragment.from(sorted).size - 1))))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/**
 * Listes à cocher : un clic sur la case (à gauche du texte de l'élément) la
 * coche ou la décoche, sans déplacer le curseur. Une modification annulable.
 */
export function checklistPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown: (view, event) => {
          const li = event.target as HTMLElement
          if (event.button !== 0 || li.tagName !== 'LI' || !li.parentElement?.classList.contains('fp-checklist') || !view.editable) return false
          const para = li.firstElementChild as HTMLElement | null
          if (!para || event.clientX >= para.getBoundingClientRect().left) return false
          const pos = view.posAtDOM(li, 0) - 1
          const node = view.state.doc.nodeAt(pos)
          if (!node || node.type !== n.list_item) return false
          event.preventDefault()
          // Chaque case cochée est une étape d'annulation à part (pas fondue avec la saisie voisine).
          view.dispatch(closeHistory(view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, checked: !node.attrs.checked })))
          return true
        },
      },
    },
  })
}
