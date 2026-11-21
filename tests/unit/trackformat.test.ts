// @vitest-environment jsdom
// Suivi des modifications de mise en forme : caractères et paragraphes, accepter,
// refuser, format Folio, .docx (w:rPrChange, w:pPrChange).

import { describe, expect, it } from 'vitest'
import { history, undo } from 'prosemirror-history'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state'
import { applyStyle, clearFormatting, setAlign, toggleFlag } from '../../src/editor/commands'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { changesOf, resolveChanges, trackPlugin } from '../../src/editor/track'
import { exportDocx } from '../../src/docx/export'
import { loadDocument } from '../../src/format/load'
import type { Block, FolioDoc, Inline, Run } from '../../src/format/types'
import { NOW, open, parts } from './docx-helpers'

const docOf = (blocks: unknown[], track = true): PMNode => {
  const r = loadDocument({ format: 'folio/doc', version: 1, trackChanges: track, blocks }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  return docToPM(r.doc)
}
const stateOf = (doc: PMNode, from: number, to = from) => EditorState.create({ doc, plugins: [history(), trackPlugin({ author: () => 'Moi' })], selection: TextSelection.create(doc, from, to) })
const apply = (s: EditorState, cmd: Command) => {
  let out = s
  expect(cmd(s, (tr: Transaction) => (out = s.applyTransaction(tr).state))).toBe(true)
  return out
}
const folio = (s: EditorState): FolioDoc => pmToDoc(s.doc, { id: 'xxxxxx', created: NOW, modified: NOW })
const blocks = (s: EditorState): Block[] => folio(s).blocks
const runs = (s: EditorState, i = 0): Run[] => ((blocks(s)[i] as { content: Inline[] }).content as Run[])

describe('suivi de la mise en forme', () => {
  it('gras sur un mot : la mise en forme d’avant est gardée ; refuser la remet, accepter garde le gras', () => {
    let s = stateOf(docOf(['Bonjour le monde']), 1, 8)
    s = apply(s, toggleFlag('bold'))
    const r = runs(s)
    expect(r[0]).toMatchObject({ text: 'Bonjour', bold: true, formatChange: { author: 'Moi', before: {} } })
    expect(r[1]).toEqual({ text: ' le monde' })
    const c = changesOf(s.doc)
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ kind: 'format', from: 1, to: 8, author: 'Moi' })
    const rejected = apply(s, resolveChanges(false, 'all'))
    expect(runs(rejected)).toEqual([{ text: 'Bonjour le monde' }])
    const accepted = apply(s, resolveChanges(true, 'all'))
    expect(runs(accepted)[0]).toEqual({ text: 'Bonjour', bold: true })
    expect(changesOf(accepted.doc)).toHaveLength(0)
  })

  it('plusieurs changements gardent la toute première mise en forme ; revenir à l’origine efface la marque', () => {
    let s = stateOf(docOf([{ content: [{ text: 'Titre', italic: true }, ' suite'] }]), 1, 6)
    s = apply(s, toggleFlag('bold'))
    s = apply(s, toggleFlag('underline'))
    expect(runs(s)[0].formatChange?.before).toEqual({ italic: true })
    // Refuser : italique seulement.
    expect(runs(apply(s, resolveChanges(false, 'all')))[0]).toEqual({ text: 'Titre', italic: true })
    // Revenir à la main : plus de modification.
    s = apply(s, toggleFlag('bold'))
    s = apply(s, toggleFlag('underline'))
    expect(runs(s)[0]).toEqual({ text: 'Titre', italic: true })
    expect(changesOf(s.doc)).toHaveLength(0)
  })

  it('le texte ajouté n’a pas de modification de mise en forme en plus ; sans suivi, rien n’est noté', () => {
    let s = stateOf(docOf(['Un mot']), 7)
    s = s.applyTransaction(s.tr.insertText(' neuf')).state
    s = apply(s.apply(s.tr.setSelection(TextSelection.create(s.doc, 7, 12))), toggleFlag('bold'))
    // (le gras ne prend pas l'espace de bord : comportement de l'éditeur)
    expect(runs(s).find((r) => r.text === 'neuf')).toMatchObject({ bold: true, inserted: { author: 'Moi' } })
    expect(runs(s).some((r) => r.formatChange)).toBe(false)
    const off = apply(stateOf(docOf(['Un mot'], false), 1, 3), toggleFlag('bold'))
    expect(runs(off)[0]).toEqual({ text: 'Un', bold: true })
  })

  it('paragraphe : alignement et style de titre suivis ; refuser rend le paragraphe d’origine', () => {
    let s = stateOf(docOf([{ type: 'paragraph', align: 'left', content: ['Chapitre'] }, 'Texte']), 2)
    s = apply(s, setAlign('center'))
    expect(blocks(s)[0]).toMatchObject({ type: 'paragraph', align: 'center', formatChange: { author: 'Moi', before: { kind: 'paragraph', align: 'left' } } })
    s = apply(s, applyStyle('heading2'))
    const b = blocks(s)[0]
    expect(b).toMatchObject({ type: 'heading', level: 2, formatChange: { before: { kind: 'paragraph', align: 'left' } } })
    const c = changesOf(s.doc).filter((x) => x.block)
    expect(c).toHaveLength(1)
    const back = apply(s, resolveChanges(false, c))
    expect(blocks(back)[0]).toEqual({ type: 'paragraph', align: 'left', content: [{ text: 'Chapitre' }] })
    const kept = apply(s, resolveChanges(true, c))
    expect(blocks(kept)[0]).toMatchObject({ type: 'heading', level: 2 })
    expect((blocks(kept)[0] as { formatChange?: unknown }).formatChange).toBeUndefined()
    // Annuler retire les étapes et leurs marques ensemble.
    const undone = apply(s, undo)
    expect(blocks(undone)[0]).toEqual({ type: 'paragraph', align: 'left', content: [{ text: 'Chapitre' }] })
  })

  it('effacer la mise en forme garde commentaires, ajouts et modifications suivies', () => {
    const r0 = loadDocument({ format: 'folio/doc', version: 1, trackChanges: true, comments: [{ id: 'c1', author: 'A', date: NOW, text: 'Note', resolved: false, replies: [] }], blocks: [{ content: [{ text: 'Avec', bold: true, comments: ['c1'] }, { text: ' ajout', inserted: { author: 'A', date: NOW } }] }] }, { now: NOW })
    if (!r0.ok) throw new Error('refusé')
    let s = stateOf(docToPM(r0.doc), 1, 10)
    s = apply(s, clearFormatting)
    const r = runs(s)
    expect(r[0]).toMatchObject({ text: 'Avec', comments: ['c1'], formatChange: { before: { bold: true } } })
    expect(r[0].bold).toBeUndefined()
    expect(r[1]).toMatchObject({ text: ' ajout', inserted: { author: 'A' } })
  })

  it('format Folio : validé, gardé ; .docx : w:rPrChange et w:pPrChange, relus à l’import', async () => {
    const r = loadDocument(
      {
        format: 'folio/doc',
        version: 1,
        blocks: [
          { type: 'heading', level: 1, formatChange: { author: 'Ana', date: NOW, before: { kind: 'paragraph', align: 'center', ink: [], bogus: 1 } }, content: ['Titre'] },
          { content: [{ text: 'gras', bold: true, formatChange: { author: 'Ana', date: NOW, before: { italic: true, link: 'https://x.org', comments: ['z'] } } }, ' fin'] },
        ],
      },
      { now: NOW },
    )
    if (!r.ok) throw new Error('refusé')
    expect(r.doc.blocks[0]).toMatchObject({ formatChange: { author: 'Ana', before: { kind: 'paragraph', align: 'center' } } })
    expect(JSON.stringify(r.doc.blocks[0])).not.toContain('bogus')
    expect((r.doc.blocks[1] as { content: Run[] }).content[0].formatChange?.before).toEqual({ italic: true })
    const out = await exportDocx(r.doc, { now: new Date(NOW) })
    const xml = parts(out.bytes)['word/document.xml']
    expect(xml).toMatch(/<w:rPrChange w:id="\d+" w:author="Ana" w:date="[^"]+"><w:rPr><w:i\/>/)
    expect(xml).toMatch(/<w:pPrChange w:id="\d+" w:author="Ana" w:date="[^"]+"><w:pPr><w:jc w:val="center"\/><\/w:pPr><\/w:pPrChange>/)
    const back = open(out.bytes).doc.blocks
    expect(back[0]).toMatchObject({ type: 'heading', formatChange: { author: 'Ana', before: { kind: 'paragraph', align: 'center' } } })
    expect((back[1] as { content: Run[] }).content[0]).toMatchObject({ text: 'gras', bold: true, formatChange: { author: 'Ana', before: { italic: true } } })
  })
})
