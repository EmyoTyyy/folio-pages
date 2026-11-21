// Suivi des modifications. Quand il est activé (attribut `trackChanges` du
// document), chaque transaction de l'utilisateur est complétée :
//   - le texte ajouté reçoit la marque « insertion » (auteur, date) ;
//   - le texte supprimé est remis à sa place avec la marque « deletion » : il
//     reste visible, barré, jusqu'à ce qu'on accepte ou refuse la modification ;
//   - supprimer du texte encore « inséré » le retire vraiment.
// Le complément est ajouté à la même étape d'annulation (appendTransaction).
//
//   - une mise en forme changée (caractères ou paragraphe) garde celle d'avant :
//     marque « formatchange » sur le texte, attribut `fmtChange` sur le paragraphe ;
//     accepter garde la nouvelle, refuser remet l'ancienne.
//
// Ce qui n'est pas suivi (et se fait donc directement) : les changements de
// structure (listes, sauts de paragraphe), et la suppression d'objets (images,
// tableaux entiers, sauts, notes, code).

import { isHistoryTransaction } from 'prosemirror-history'
import { undoInputRule } from 'prosemirror-inputrules'
import { Fragment, Slice, type Mark, type Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import { AddMarkStep, AttrStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep, type Step, type StepMap } from 'prosemirror-transform'
import { FLAG_MARKS, VALUE_MARKS, schema } from './schema'
import { paraFromAttrs, paraToAttrs } from './convert'
import type { ParaBefore } from '../format/types'

export interface Change {
  author: string
  date: string
}

/** Méta d'une transaction qui ne doit pas être suivie (acceptation, chargement…). */
export const TRACK_SKIP = 'folio-track-skip'

const ins = () => schema.marks.insertion
const del = () => schema.marks.deletion
const fmt = () => schema.marks.formatchange

// --- mise en forme ----------------------------------------------------------------

/** Marques qui ne sont pas de la mise en forme (le suivi ne les compte pas). */
const NOT_FORMAT = new Set(['link', 'comment', 'insertion', 'deletion', 'formatchange'])

/** Mise en forme de caractères d'un nœud, au format Folio (clés triées). */
export function formatOf(marks: readonly Mark[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const m of marks) {
    if (NOT_FORMAT.has(m.type.name)) continue
    if ((FLAG_MARKS as readonly string[]).includes(m.type.name)) out[m.type.name] = true
    else for (const [key, [mark, attr]] of Object.entries(VALUE_MARKS)) if (mark === m.type.name && key !== 'link') out[key] = m.attrs[attr]
  }
  return sorted(out)
}

/** Les marques de l'éditeur d'une mise en forme au format Folio. */
export function formatMarks(f: Record<string, unknown>): Mark[] {
  const out: Mark[] = []
  for (const [k, v] of Object.entries(f)) {
    if ((FLAG_MARKS as readonly string[]).includes(k) && v === true) out.push(schema.marks[k].create())
    else if (k in VALUE_MARKS && k !== 'link' && v !== undefined && v !== null && v !== '') {
      const [mark, attr] = VALUE_MARKS[k as keyof typeof VALUE_MARKS]
      out.push(schema.marks[mark].create({ [attr]: v }))
    }
  }
  return out
}

const sorted = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)))
const same = (a: unknown, b: unknown) => JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b))
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sortDeep(x)]))
  return v
}

const TRACKED_BLOCKS = new Set(['paragraph', 'heading'])

/** Mise en forme d'un paragraphe ou d'un titre, au format Folio (type, niveau, style compris). */
export function paraState(n: PMNode): ParaBefore {
  const { ink, formatChange, ...props } = paraFromAttrs(n.attrs)
  void ink, formatChange
  const out: ParaBefore = { kind: n.type.name === 'heading' ? 'heading' : 'paragraph', ...props }
  if (n.type.name === 'heading') out.level = n.attrs.level as number
  if (n.attrs.style) out.style = n.attrs.style as string
  return out
}

/** Une étape qui ne change que la mise en forme (marques, attributs, type de bloc) ? */
const formattingStep = (s: Step) => s instanceof AddMarkStep || s instanceof RemoveMarkStep || s instanceof AttrStep || (s instanceof ReplaceAroundStep && (s as unknown as { structure: boolean }).structure)

/** Complète une transaction de mise en forme : ce qui change garde sa mise en forme d'avant. */
function trackFormatting(trs: readonly Transaction[], oldDoc: PMNode, out: Transaction, author: string, date: string): void {
  const newDoc = out.doc
  if (oldDoc.content.size !== newDoc.content.size) return
  const steps = trs.flatMap((tr) => tr.steps)
  if (!steps.length || !steps.every(formattingStep)) return
  // 1. Caractères : les plages touchées par une marque de mise en forme.
  for (const s of steps) {
    if (!(s instanceof AddMarkStep || s instanceof RemoveMarkStep) || NOT_FORMAT.has(s.mark.type.name)) continue
    newDoc.nodesBetween(s.from, s.to, (node, pos) => {
      if (!node.isInline) return true
      if (ins().isInSet(node.marks) || del().isInSet(node.marks)) return false
      const a = Math.max(pos, s.from)
      const b = Math.min(pos + node.nodeSize, s.to)
      const after = formatOf(node.marks)
      oldDoc.nodesBetween(a, b, (old, opos) => {
        if (!old.isInline) return true
        const x = Math.max(opos, a)
        const y = Math.min(opos + old.nodeSize, b)
        if (x >= y) return false
        const prior = fmt().isInSet(old.marks)
        const before = prior ? (prior.attrs.before as Record<string, unknown>) : formatOf(old.marks)
        if (same(before, after)) out.removeMark(x, y, fmt())
        else if (!prior || !same(prior.attrs.before, before) || prior.attrs.author !== author) out.addMark(x, y, fmt().create({ author, date, before }))
        else out.addMark(x, y, prior)
        return false
      })
      return false
    })
  }
  // 2. Paragraphes et titres : type, niveau, style, alignement, retraits, espacements…
  if (!steps.some((s) => s instanceof AttrStep || s instanceof ReplaceAroundStep)) return
  newDoc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (!TRACKED_BLOCKS.has(node.type.name)) return false
    const old = oldDoc.nodeAt(pos)
    if (!old || !TRACKED_BLOCKS.has(old.type.name)) return false
    const now = paraState(node)
    const was = paraState(old)
    const prior = old.attrs.fmtChange as { author: string; date: string; before: ParaBefore } | null
    if (same(now, was) && same(node.attrs.fmtChange, prior)) return false
    const before = prior?.before ?? was
    const fmtChange = same(before, now) ? null : prior && prior.author === author && same(prior.before, before) ? prior : { author, date, before }
    if (!same(fmtChange, node.attrs.fmtChange)) out.setNodeMarkup(pos, undefined, { ...node.attrs, fmtChange })
    return false
  })
}

/** Remet un paragraphe dans sa mise en forme d'avant (refuser). */
function restorePara(tr: Transaction, pos: number, node: PMNode, before: ParaBefore): void {
  const heading = before.kind === 'heading'
  const type = heading ? schema.nodes.heading : schema.nodes.paragraph
  const { kind, level, style, ...props } = before
  void kind
  const attrs: Record<string, unknown> = { ...paraToAttrs(props), ink: node.attrs.ink, fmtChange: null }
  if (heading) attrs.level = level ?? 1
  else attrs.style = style ?? null
  tr.setNodeMarkup(pos, type, attrs)
}

/** Ce qu'une suppression suivie ne garde pas : objets entiers, structure de tableau, code, notes. */
const UNTRACKED = new Set(['figure', 'page_break', 'horizontal_rule', 'toc', 'columns', 'column_break', 'section_break', 'code_block', 'note', 'table', 'table_row', 'table_cell', 'table_header'])

export interface TrackContext {
  /** Auteur des modifications (nom gardé dans le navigateur). */
  author: () => string
}

export const trackKey = new PluginKey<{ lastKey: string; at: number }>('folio-track')

export const isTracking = (state: EditorState) => state.doc.attrs.trackChanges === true

/** La suppression peut-elle être suivie (seulement du texte, hors code) ? */
function trackable(doc: PMNode, from: number, to: number): boolean {
  if (doc.resolve(from).parent.type.spec.code) return false
  // Ce qui est retiré (les nœuds qui contiennent la suppression n'en font pas partie).
  let ok = true
  let inline = false
  doc.slice(from, to).content.descendants((n) => {
    if (!ok) return false
    if (UNTRACKED.has(n.type.name)) ok = false
    else if (n.isInline) inline = true
    return ok
  })
  return ok && inline
}

/**
 * Le contenu supprimé, tel qu'on le remet : le texte encore « inséré » disparaît
 * vraiment, le reste reçoit la marque de suppression (gardée si elle y était).
 */
function asDeleted(fragment: Fragment, mark: Mark): Fragment {
  const out: PMNode[] = []
  fragment.forEach((n) => {
    if (n.isInline) {
      if (ins().isInSet(n.marks)) return
      out.push(del().isInSet(n.marks) ? n : n.mark(mark.addToSet(n.marks)))
    } else out.push(n.copy(asDeleted(n.content, mark)))
  })
  return Fragment.from(out)
}

function hasInline(fragment: Fragment): boolean {
  let found = false
  fragment.descendants((n) => {
    if (n.isInline) found = true
    return !found
  })
  return found
}

/** Une marque de même auteur juste à côté : on la reprend (une seule modification au lieu de mille). */
function neighbourMark(doc: PMNode, pos: number, type: typeof schema.marks.insertion, author: string): Mark | null {
  const $p = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
  for (const n of [$p.nodeBefore, $p.nodeAfter]) {
    const m = n ? type.isInSet(n.marks) : null
    if (m && m.attrs.author === author) return m
  }
  return null
}

export function trackPlugin(ctx: TrackContext): Plugin<{ lastKey: string; at: number }> {
  return new Plugin({
    key: trackKey,
    state: {
      init: () => ({ lastKey: '', at: 0 }),
      apply: (tr, prev) => (tr.getMeta(trackKey) as { lastKey: string; at: number } | undefined) ?? prev,
    },
    props: {
      // Retour arrière et Suppr : on supprime nous-mêmes (le navigateur réécrirait le texte
      // à sa façon) ; Retour arrière laisse le curseur avant le texte barré, Suppr après.
      handleKeyDown: (view, e) => {
        if (!isTracking(view.state) || (e.key !== 'Backspace' && e.key !== 'Delete') || view.composing) return false
        if (e.key === 'Backspace' && undoInputRule(view.state, view.dispatch)) return true
        const meta = { lastKey: e.key, at: Date.now() }
        const range = keyRange(view.state, e.key === 'Backspace', e.ctrlKey || e.altKey || e.metaKey)
        if (!range) {
          // Début ou fin de paragraphe : le paragraphe se joint au voisin (non suivi).
          view.dispatch(view.state.tr.setMeta(trackKey, meta).setMeta('addToHistory', false))
          return false
        }
        view.dispatch(view.state.tr.delete(range.from, range.to).setMeta(trackKey, meta).scrollIntoView())
        return true
      },
    },
    appendTransaction: (trs, oldState, newState) => {
      if (!isTracking(oldState) || !isTracking(newState)) return null
      // Les modifications venues d'une autre vue du document y ont déjà été suivies.
      const relevant = trs.filter((tr) => tr.docChanged && !tr.getMeta(TRACK_SKIP) && !isHistoryTransaction(tr) && !tr.getMeta('collab$'))
      if (!relevant.length) return null
      const author = ctx.author()
      const date = new Date().toISOString()
      // Toutes les étapes, dans l'ordre, avec le document où elles s'appliquent.
      const steps: { step: ReplaceStep; doc: PMNode; index: number; tracked: boolean }[] = []
      const maps: StepMap[] = []
      for (const tr of trs) {
        const tracked = relevant.includes(tr)
        tr.steps.forEach((s, i) => {
          if (s instanceof ReplaceStep) steps.push({ step: s, doc: tr.docs[i], index: maps.length, tracked })
          maps.push(s.getMap())
        })
      }
      const rest = (index: number, pos: number, assoc: number) => {
        let p = pos
        for (let k = index + 1; k < maps.length; k++) p = maps[k].map(p, assoc)
        return p
      }
      const out = newState.tr
      let backspaceAt: number | null = null
      const meta = (trs.map((tr) => tr.getMeta(trackKey) as { lastKey: string; at: number } | undefined).find(Boolean) ?? trackKey.getState(oldState)) || null
      const backspace = !!meta && meta.lastKey === 'Backspace' && Date.now() - meta.at < 1000 && oldState.selection.empty
      for (const { step, doc, index, tracked } of steps) {
        if (!tracked) continue
        const { from, to } = step
        const size = step.slice.size
        // 1. Le texte ajouté par cette étape.
        if (size && hasInline(step.slice.content)) {
          const a = out.mapping.map(rest(index, from, 1), 1)
          const b = out.mapping.map(rest(index, from + size, -1), -1)
          if (a < b) {
            const mark = neighbourMark(out.doc, a, ins(), author) ?? ins().create({ author, date })
            out.removeMark(a, b, del())
            out.removeMark(a, b, ins())
            out.addMark(a, b, mark)
          }
        }
        // 2. Le texte supprimé par cette étape : remis, barré.
        if (to > from && trackable(doc, from, to)) {
          const deleted = doc.slice(from, to)
          const mark = neighbourMark(newState.doc, rest(index, from, -1), del(), author) ?? del().create({ author, date })
          const content = asDeleted(deleted.content, mark)
          if (hasInline(content)) {
            const at = out.mapping.map(rest(index, from, -1), -1)
            out.replace(at, at, new Slice(content, deleted.openStart, deleted.openEnd))
            if (backspace && size === 0) backspaceAt = at
          }
        }
      }
      trackFormatting(relevant, oldState.doc, out, author, date)
      if (!out.docChanged) return null
      if (backspaceAt !== null) out.setSelection(TextSelection.create(out.doc, Math.min(backspaceAt, out.doc.content.size)))
      return out.setMeta(TRACK_SKIP, true)
    },
  })
}

/** Les caractères d'un paragraphe et leur position (un objet en ligne compte pour un). */
function charsOf(parent: PMNode, start: number): { c: string; pos: number; size: number }[] {
  const out: { c: string; pos: number; size: number }[] = []
  parent.forEach((n, off) => {
    if (n.isText) {
      const text = n.text!
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i)
        const pair = code >= 0xd800 && code <= 0xdbff && i + 1 < text.length
        out.push({ c: pair ? text.slice(i, i + 2) : text[i], pos: start + off + i, size: pair ? 2 : 1 })
        if (pair) i++
      }
    } else out.push({ c: '\ufffc', pos: start + off, size: n.nodeSize })
  })
  return out
}

/** Ce qu'efface la touche : un caractère, ou un mot (Ctrl) ; null en bord de paragraphe ou hors texte. */
export function keyRange(state: EditorState, back: boolean, word: boolean): { from: number; to: number } | null {
  const sel = state.selection
  if (!sel.empty) return { from: sel.from, to: sel.to }
  const $p = sel.$from
  if (!$p.parent.isTextblock || $p.parent.type.spec.code) return null
  const chars = charsOf($p.parent, $p.start())
  // Indice du premier caractère après le curseur.
  let i = chars.findIndex((ch) => ch.pos >= $p.pos)
  if (i < 0) i = chars.length
  const isWord = (c: string) => /[\p{L}\p{N}_'’]/u.test(c)
  if (back) {
    if (i === 0) return null
    let j = i - 1
    if (word) {
      while (j > 0 && /\s/.test(chars[j].c)) j--
      while (j > 0 && isWord(chars[j - 1].c) && isWord(chars[j].c)) j--
    }
    return { from: chars[j].pos, to: $p.pos }
  }
  if (i >= chars.length) return null
  let j = i
  if (word) {
    while (j < chars.length - 1 && isWord(chars[j].c) && isWord(chars[j + 1].c)) j++
    while (j < chars.length - 1 && /\s/.test(chars[j + 1].c)) j++
  }
  return { from: $p.pos, to: chars[j].pos + chars[j].size }
}

// --- les modifications du document ------------------------------------------------

export interface TrackedChange {
  kind: 'insert' | 'delete' | 'format'
  from: number
  to: number
  author: string
  date: string
  /** Mise en forme d'un paragraphe entier (from : sa position). */
  block?: true
}

/** Les modifications suivies, dans l'ordre (morceaux voisins de même marque réunis). */
export function changesOf(doc: PMNode): TrackedChange[] {
  const out: TrackedChange[] = []
  doc.descendants((n, pos) => {
    if (n.isTextblock && n.attrs.fmtChange) {
      const fc = n.attrs.fmtChange as { author: string; date: string }
      out.push({ kind: 'format', from: pos, to: pos + n.nodeSize, author: fc.author, date: fc.date, block: true })
    }
    if (!n.isInline) return true
    for (const [kind, type] of [
      ['insert', ins()],
      ['delete', del()],
      ['format', fmt()],
    ] as const) {
      const m = type.isInSet(n.marks)
      if (!m) continue
      let last: TrackedChange | undefined
      for (let i = out.length - 1; i >= 0 && !last; i--) if (!out[i].block) last = out[i]
      if (last && last.kind === kind && last.to === pos && last.author === m.attrs.author && last.date === m.attrs.date) last.to = pos + n.nodeSize
      else out.push({ kind, from: pos, to: pos + n.nodeSize, author: m.attrs.author, date: m.attrs.date })
    }
    return false
  })
  return out.sort((a, b) => a.from - b.from || a.to - b.to)
}

/** Modifications touchées par la sélection (ou sous le curseur). */
export function changesAt(state: EditorState): TrackedChange[] {
  const { from, to, empty } = state.selection
  return changesOf(state.doc).filter((c) => (empty ? c.from <= from && from <= c.to && (c.from < from || c.to > from) : c.from < to && c.to > from))
}

/**
 * Accepte (ou refuse) des modifications : accepter garde l'ajout et retire la
 * suppression ; refuser fait l'inverse. Une étape d'annulation, jamais suivie.
 */
export function resolveChanges(accept: boolean, changes: TrackedChange[] | 'all' | 'here'): Command {
  return (state, dispatch) => {
    const list = changes === 'all' ? changesOf(state.doc) : changes === 'here' ? changesAt(state) : changes
    if (!list.length) return false
    if (dispatch) {
      const tr = state.tr.setMeta(TRACK_SKIP, true)
      // De la fin vers le début : les positions restent justes.
      for (const c of [...list].sort((a, b) => b.from - a.from)) {
        if (c.kind === 'format') {
          resolveFormat(tr, c, accept)
          continue
        }
        const keep = (c.kind === 'insert') === accept
        const type = c.kind === 'insert' ? ins() : del()
        if (keep) {
          tr.doc.nodesBetween(c.from, c.to, (n, pos) => {
            if (!n.isInline) return true
            const m = type.isInSet(n.marks)
            if (m && m.attrs.author === c.author && m.attrs.date === c.date) tr.removeMark(Math.max(pos, c.from), Math.min(pos + n.nodeSize, c.to), m)
            return false
          })
        } else {
          // Tout le texte d'un paragraphe : le paragraphe part avec lui (pas de paragraphe vide qui reste).
          const $a = tr.doc.resolve(c.from)
          const whole = $a.parent.isTextblock && c.from === $a.start() && c.to === $a.end() && $a.depth > 0 && $a.node($a.depth - 1).childCount > 1
          if (whole) tr.delete($a.before(), $a.after())
          else tr.delete(c.from, c.to)
        }
      }
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Accepte (garde la nouvelle mise en forme) ou refuse (remet l'ancienne) une modification de mise en forme. */
function resolveFormat(tr: Transaction, c: TrackedChange, accept: boolean): void {
  if (c.block) {
    const node = tr.doc.nodeAt(c.from)
    const fc = node?.attrs.fmtChange as { before: ParaBefore } | null | undefined
    if (!node || !fc) return
    if (accept) tr.setNodeMarkup(c.from, undefined, { ...node.attrs, fmtChange: null })
    else restorePara(tr, c.from, node, fc.before)
    return
  }
  const parts: { from: number; to: number; mark: Mark }[] = []
  tr.doc.nodesBetween(c.from, c.to, (n, pos) => {
    if (!n.isInline) return true
    const m = fmt().isInSet(n.marks)
    if (m && m.attrs.author === c.author && m.attrs.date === c.date) parts.push({ from: Math.max(pos, c.from), to: Math.min(pos + n.nodeSize, c.to), mark: m })
    return false
  })
  for (const p of parts) {
    tr.removeMark(p.from, p.to, fmt())
    if (accept) continue
    for (const type of Object.values(schema.marks)) if (!NOT_FORMAT.has(type.name)) tr.removeMark(p.from, p.to, type)
    for (const m of formatMarks(p.mark.attrs.before as Record<string, unknown>)) tr.addMark(p.from, p.to, m)
  }
}

/** Modification suivante (dir 1) ou précédente (dir -1) : elle est sélectionnée. */
export function gotoChange(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const list = changesOf(state.doc)
    const { from, to } = state.selection
    const target = dir > 0 ? list.find((c) => c.from > from || (c.from === from && c.to > to)) : [...list].reverse().find((c) => c.from < from)
    if (!target) return false
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, target.from, target.to)).scrollIntoView())
    return true
  }
}

/** Active ou désactive le suivi (une étape annulable). */
export function setTracking(on: boolean): Command {
  return (state, dispatch) => {
    if (isTracking(state) === on) return false
    if (dispatch) dispatch(state.tr.setDocAttribute('trackChanges', on).setMeta(TRACK_SKIP, true))
    return true
  }
}

/** Transaction à ne pas suivre (outil interne : remplacement du document…). */
export const untracked = (tr: Transaction) => tr.setMeta(TRACK_SKIP, true)
