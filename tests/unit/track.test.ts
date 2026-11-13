import { describe, expect, it } from 'vitest'
import { history, undo } from 'prosemirror-history'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, NodeSelection, TextSelection, type Command, type Transaction } from 'prosemirror-state'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { changesAt, changesOf, gotoChange, keyRange, resolveChanges, setTracking, trackKey, trackPlugin } from '../../src/editor/track'
import { finalSlice } from '../../src/editor/paste'
import { Slice } from 'prosemirror-model'
import { loadDocument } from '../../src/format/load'
import type { Block, Inline } from '../../src/format/types'

const NOW = '2026-11-09T12:00:00.000Z'
const docOf = (blocks: unknown[], track = true): PMNode => {
  const r = loadDocument({ format: 'folio/doc', version: 1, trackChanges: track, blocks }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  return docToPM(r.doc)
}
const stateOf = (doc: PMNode, from: number, to = from) =>
  EditorState.create({ doc, plugins: [history(), trackPlugin({ author: () => 'Moi' })], selection: TextSelection.create(doc, from, to) })
const run = (s: EditorState, f: (tr: Transaction) => Transaction | void): EditorState => {
  const tr = s.tr
  f(tr)
  return s.applyTransaction(tr).state
}
const apply = (s: EditorState, cmd: Command) => {
  let out = s
  expect(cmd(s, (tr: Transaction) => (out = s.applyTransaction(tr).state))).toBe(true)
  return out
}
const blocks = (s: EditorState): Block[] => pmToDoc(s.doc, { id: 'xxxxxx', created: NOW, modified: NOW }).blocks
const runs = (s: EditorState, i = 0): Inline[] => {
  const b = blocks(s)[i]
  return b.type === 'paragraph' ? b.content : []
}
/** Texte avec [+ajouts+] et [-suppressions-]. */
const shown = (s: EditorState, i = 0) =>
  runs(s, i)
    .map((r) => ('text' in r ? (r.inserted ? `[+${r.text}+]` : r.deleted ? `[-${r.text}-]` : r.text) : '?'))
    .join('')
const key = (s: EditorState, k: 'Backspace' | 'Delete') => run(s, (tr) => tr.setMeta(trackKey, { lastKey: k, at: Date.now() }))

describe('suivi des modifications', () => {
  it('le texte tapé est marqué « ajouté », d’un seul tenant', () => {
    let s = stateOf(docOf(['Bonjour monde']), 9)
    for (const c of 'cher ') s = run(s, (tr) => tr.insertText(c))
    expect(shown(s)).toBe('Bonjour [+cher +]monde')
    expect(changesOf(s.doc)).toHaveLength(1)
    expect(runs(s)[1]).toMatchObject({ inserted: { author: 'Moi' } })
  })

  it('le texte supprimé reste, barré ; Retour arrière laisse le curseur avant, Suppr après', () => {
    let s = stateOf(docOf(['abcdef']), 4)
    s = key(s, 'Backspace')
    s = run(s, (tr) => tr.delete(3, 4))
    expect(shown(s)).toBe('ab[-c-]def')
    expect(s.selection.from).toBe(3)
    // Un deuxième Retour arrière continue vers la gauche, dans la même suppression.
    s = key(s, 'Backspace')
    s = run(s, (tr) => tr.delete(2, 3))
    expect(shown(s)).toBe('a[-bc-]def')
    expect(changesOf(s.doc)).toHaveLength(1)
    // Suppr : le curseur passe après le texte barré.
    let t = stateOf(docOf(['abcdef']), 3)
    t = key(t, 'Delete')
    t = run(t, (tr) => tr.delete(3, 4))
    expect(shown(t)).toBe('ab[-c-]def')
    expect(t.selection.from).toBe(4)
  })

  it('supprimer du texte encore « ajouté » le retire vraiment', () => {
    let s = stateOf(docOf(['ab']), 2)
    s = run(s, (tr) => tr.insertText('XY'))
    expect(shown(s)).toBe('a[+XY+]b')
    s = key(s, 'Backspace')
    s = run(s, (tr) => tr.delete(3, 4))
    expect(shown(s)).toBe('a[+X+]b')
    // Une sélection qui mêle ajouté et original : seul l'original reste, barré.
    s = run(s, (tr) => tr.delete(1, 4))
    expect(shown(s)).toBe('[-a-][-b-]'.replace('[-a-][-b-]', '[-ab-]'))
  })

  it('remplacer une sélection : l’ancien texte barré, puis le nouveau', () => {
    let s = stateOf(docOf(['le chat dort']), 4, 8)
    s = run(s, (tr) => tr.insertText('chien'))
    expect(shown(s)).toBe('le [-chat-][+chien+] dort')
    expect(s.selection.from).toBe(4 + 4 + 5)
  })

  it('une suppression sur deux paragraphes les garde tous les deux', () => {
    let s = stateOf(docOf(['Premier paragraphe', 'Second paragraphe']), 9, 27)
    s = run(s, (tr) => tr.deleteSelection())
    expect(blocks(s)).toHaveLength(2)
    expect(shown(s, 0)).toBe('Premier [-paragraphe-]')
    expect(shown(s, 1)).toBe('[-Second-] paragraphe')
  })

  it('pas suivi : sans le suivi, dans du code, objets et lignes de tableau', () => {
    let off = stateOf(docOf(['abc'], false), 2)
    off = run(off, (tr) => tr.insertText('X').delete(3, 4))
    expect(shown(off)).toBe('aXc')
    const code = stateOf(docOf([{ type: 'code', text: 'x = 1' }]), 2)
    const c2 = run(code, (tr) => tr.delete(1, 3))
    expect(c2.doc.textContent).toBe('= 1')
    const img = docOf(['a', { type: 'image', src: 'https://exemple.org/a.png' }, 'b'])
    let pos = -1
    img.forEach((n, p) => (n.type.name === 'figure' ? (pos = p) : null))
    const s3 = run(stateOf(img, 1), (tr) => tr.delete(pos, pos + img.nodeAt(pos)!.nodeSize))
    expect(blocks(s3).map((b) => b.type)).toEqual(['paragraph', 'paragraph'])
  })

  it('accepter et refuser : une modification, toutes, celle sous le curseur', () => {
    const base = docOf([{ content: ['le ', { text: 'chat', deleted: { author: 'A', date: NOW } }, { text: 'chien', inserted: { author: 'A', date: NOW } }, ' dort'] }])
    const s = stateOf(base, 1)
    expect(changesOf(s.doc).map((c) => c.kind)).toEqual(['delete', 'insert'])
    expect(shown(apply(s, resolveChanges(true, 'all')))).toBe('le chien dort')
    expect(shown(apply(s, resolveChanges(false, 'all')))).toBe('le chat dort')
    const inside = stateOf(base, 10)
    expect(changesAt(inside).map((c) => c.kind)).toEqual(['insert'])
    expect(shown(apply(inside, resolveChanges(false, 'here')))).toBe('le [-chat-] dort')
    expect(resolveChanges(true, 'here')(stateOf(base, 1))).toBe(false)
    // Accepter n'est pas suivi, et s'annule.
    const acc = apply(s, resolveChanges(true, 'all'))
    expect(changesOf(acc.doc)).toEqual([])
    expect(shown(apply(acc, undo))).toBe('le [-chat-][+chien+] dort')
  })

  it('annuler retire la modification et son suivi ensemble', () => {
    let s = stateOf(docOf(['abc']), 2)
    s = run(s, (tr) => tr.delete(2, 3))
    expect(shown(s)).toBe('a[-b-]c')
    s = apply(s, undo)
    expect(shown(s)).toBe('abc')
    expect(changesOf(s.doc)).toEqual([])
  })

  it('aller à la modification suivante ou précédente', () => {
    const d = docOf([{ content: ['a ', { text: 'b', inserted: { author: 'A', date: NOW } }, ' c ', { text: 'd', deleted: { author: 'B', date: NOW } }] }])
    let s = stateOf(d, 1)
    s = apply(s, gotoChange(1))
    expect(s.doc.textBetween(s.selection.from, s.selection.to)).toBe('b')
    s = apply(s, gotoChange(1))
    expect(s.doc.textBetween(s.selection.from, s.selection.to)).toBe('d')
    expect(gotoChange(1)(s)).toBe(false)
    s = apply(s, gotoChange(-1))
    expect(s.doc.textBetween(s.selection.from, s.selection.to)).toBe('b')
  })

  it('activer, désactiver le suivi : annulable, jamais suivi lui-même', () => {
    let s = stateOf(docOf(['abc'], false), 1)
    s = apply(s, setTracking(true))
    expect(s.doc.attrs.trackChanges).toBe(true)
    expect(setTracking(true)(s)).toBe(false)
    s = run(s, (tr) => tr.insertText('X'))
    expect(shown(s)).toBe('[+X+]abc')
    s = apply(s, setTracking(false))
    s = run(s, (tr) => tr.insertText('Y'))
    expect(shown(s)).toBe('[+X+]Yabc')
  })

  it('une note insérée n’est pas « ajoutée » ; une note supprimée l’est vraiment', () => {
    const d = docOf([{ content: ['a', { type: 'note', text: 'n' }, 'b'] }])
    const s = run(stateOf(d, 1), (tr) => tr.delete(2, 3))
    expect(runs(s)).toEqual([{ text: 'ab' }])
    const sel = EditorState.create({ doc: d, plugins: [trackPlugin({ author: () => 'x' })], selection: NodeSelection.create(d, 2) })
    expect(sel.selection.from).toBe(2)
  })

  it('ce qu’efface une touche : un caractère (émoji compris), un mot, rien en bord de paragraphe', () => {
    const d = docOf(['Le 😀 chat noir'])
    const at = (pos: number) => stateOf(d, pos)
    expect(keyRange(at(3), true, false)).toEqual({ from: 2, to: 3 })
    expect(keyRange(at(6), true, false)).toEqual({ from: 4, to: 6 })
    expect(keyRange(at(4), false, false)).toEqual({ from: 4, to: 6 })
    expect(keyRange(at(12), true, true)).toEqual({ from: 7, to: 12 })
    expect(keyRange(at(7), false, true)).toEqual({ from: 7, to: 12 })
    expect(keyRange(at(1), true, false)).toBeNull()
    expect(keyRange(at(17), false, false)).toBeNull()
    expect(keyRange(stateOf(docOf([{ type: 'code', text: 'x' }]), 1), true, false)).toBeNull()
  })

  it('coller donne la version finale : sans texte supprimé ni marque d’ajout', () => {
    const d = docOf([{ content: ['a', { text: 'b', deleted: { author: 'A' } }, { text: 'c', inserted: { author: 'A' } }] }])
    const slice = finalSlice(new Slice(d.content, 0, 0), false)
    let text = ''
    let marked = false
    slice.content.descendants((n) => {
      if (n.isText) {
        text += n.text
        marked = marked || n.marks.length > 0
      }
    })
    expect(text).toBe('ac')
    expect(marked).toBe(false)
  })
})

