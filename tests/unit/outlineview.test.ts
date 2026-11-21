// Vue Plan : niveaux, déplacement d'un titre avec sa partie, repli.

import { describe, expect, it } from 'vitest'
import { history, undo } from 'prosemirror-history'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state'
import { docToPM } from '../../src/editor/convert'
import { collapse, demote, moveSection, outlineKey, outlineOn, outlinePlugin, promote, showLevel, toBody } from '../../src/editor/outlineview'
import { loadDocument } from '../../src/format/load'

const NOW = '2026-11-20T10:00:00.000Z'
const docOf = (blocks: unknown[]): PMNode => {
  const r = loadDocument({ format: 'folio/doc', version: 1, blocks }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  return docToPM(r.doc)
}
const H = (level: number, text: string) => ({ type: 'heading', level, text })
const DOC = [H(1, 'A'), 'a1', H(2, 'A.1'), 'a11', H(1, 'B'), 'b1', H(2, 'B.1'), 'b11']
/** Position du bloc qui porte ce texte. */
const posOf = (doc: PMNode, text: string) => {
  let at = -1
  doc.forEach((n, pos) => {
    if (at < 0 && n.textContent === text) at = pos
  })
  return at
}
const stateAt = (blocks: unknown[], text: string) => {
  const doc = docOf(blocks)
  let s = EditorState.create({ doc, plugins: [history(), outlinePlugin()], selection: TextSelection.create(doc, posOf(doc, text) + 1) })
  s = s.apply(s.tr.setMeta(outlineKey, { on: true }))
  return s
}
const apply = (s: EditorState, cmd: Command) => {
  let out = s
  expect(cmd(s, (tr: Transaction) => (out = s.applyTransaction(tr).state))).toBe(true)
  return out
}
const plan = (s: EditorState) => {
  const out: string[] = []
  s.doc.forEach((n) => out.push(n.type.name === 'heading' ? `H${n.attrs.level}:${n.textContent}` : n.textContent))
  return out
}
/** Ce que la vue montre (blocs non cachés). */
const visible = (s: EditorState) => {
  const set = outlinePlugin().props.decorations!.call(outlinePlugin(), s) as unknown as { find: () => { from: number; spec: unknown; type: { attrs?: { class?: string } } }[] }
  const hidden = new Set<number>()
  for (const d of set.find()) if ((d as any).type?.attrs?.class?.includes('fp-ol-hidden')) hidden.add(d.from)
  const out: string[] = []
  s.doc.forEach((n, pos) => {
    if (!hidden.has(pos)) out.push(n.textContent)
  })
  return out
}

describe('vue Plan', () => {
  it('monter et descendre d’un niveau ; un paragraphe promu prend le niveau du titre précédent ; corps de texte', () => {
    let s = stateAt(DOC, 'A.1')
    s = apply(s, promote)
    expect(plan(s)[2]).toBe('H1:A.1')
    s = apply(s, demote)
    s = apply(s, demote)
    expect(plan(s)[2]).toBe('H3:A.1')
    s = stateAt(DOC, 'a11')
    s = apply(s, promote)
    expect(plan(s)[3]).toBe('H2:a11')
    s = apply(s, toBody)
    expect(plan(s)[3]).toBe('a11')
  })

  it('un titre se déplace avec toute sa partie, au-dessus ou au-dessous de la partie voisine du même niveau', () => {
    let s = stateAt(DOC, 'B')
    s = apply(s, moveSection(-1))
    expect(plan(s)).toEqual(['H1:B', 'b1', 'H2:B.1', 'b11', 'H1:A', 'a1', 'H2:A.1', 'a11'])
    // le curseur reste dans le titre déplacé
    expect(s.selection.$from.parent.textContent).toBe('B')
    s = apply(s, moveSection(1))
    expect(plan(s)).toEqual(['H1:A', 'a1', 'H2:A.1', 'a11', 'H1:B', 'b1', 'H2:B.1', 'b11'])
    // un paragraphe seul descend d'un bloc
    s = stateAt(DOC, 'a1')
    s = apply(s, moveSection(1))
    expect(plan(s).slice(0, 3)).toEqual(['H1:A', 'H2:A.1', 'a1'])
    // annulable d'un coup
    expect(plan(apply(s, undo))).toEqual(plan(stateAt(DOC, 'A')))
    // rien au-dessus du premier bloc
    expect(moveSection(-1)(stateAt(DOC, 'A'))).toBe(false)
  })

  it('replier cache la partie ; afficher le niveau 1 ne garde que les titres de niveau 1', () => {
    let s = stateAt(DOC, 'A')
    s = apply(s, collapse(true))
    expect(visible(s)).toEqual(['A', 'B', 'b1', 'B.1', 'b11'])
    // le repli suit le texte quand on tape ailleurs
    s = s.apply(s.tr.insertText('!', posOf(s.doc, 'b1') + 1))
    expect(visible(s)).toEqual(['A', 'B', '!b1', 'B.1', 'b11'])
    s = apply(s, collapse(false, true))
    expect(visible(s)).toHaveLength(8)
    s = apply(s, showLevel(1))
    expect(visible(s)).toEqual(['A', 'B'])
    s = apply(s, outlineOn(false))
    expect(outlineKey.getState(s)).toMatchObject({ on: false, level: 0, collapsed: [] })
  })
})
