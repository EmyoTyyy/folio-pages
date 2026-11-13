// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { history, undo } from 'prosemirror-history'
import { DOMParser as PMDOMParser, type Node as PMNode } from 'prosemirror-model'
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state'
import {
  addComment,
  commentRanges,
  commentsAt,
  deleteAllComments,
  deleteComment,
  deleteReply,
  editComment,
  gotoComment,
  newCommentId,
  placedThreads,
  replyToComment,
  selectComment,
  setResolved,
  threadsOf,
  wordAt,
} from '../../src/editor/comments'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { finalSlice } from '../../src/editor/paste'
import { schema } from '../../src/editor/schema'
import { toCompact } from '../../src/format/compact'
import { loadDocument, type LoadResult } from '../../src/format/load'
import type { Block, FolioDoc, Inline } from '../../src/format/types'

const NOW = '2026-11-09T12:00:00.000Z'
function ok(r: LoadResult): Extract<LoadResult, { ok: true }> {
  if (!r.ok) throw new Error('refusé : ' + JSON.stringify(r))
  return r
}
const load = (v: Record<string, unknown>) => ok(loadDocument({ format: 'folio/doc', version: 1, ...v }, { now: NOW }))
const codes = (r: { report: { issues: { code: string }[] } }) => r.report.issues.map((i) => i.code)
const identity = (d: FolioDoc) => ({ id: d.id, created: d.meta.created, modified: d.meta.modified })
const para = (b: Block): Inline[] => (b.type === 'paragraph' ? b.content : [])

const THREADS = [
  { id: 'c1', author: 'Camille', date: '2026-11-08T09:30:00Z', text: 'Source ?', replies: [{ author: 'Sam', date: '2026-11-08', text: 'Rapport, p. 12.' }] },
  { id: 'c2', text: 'À revoir.', resolved: true },
]

describe('commentaires : format', () => {
  it('lit les fils : dates ISO, auteur vide, résolu, réponses', () => {
    const r = load({ comments: THREADS, blocks: [{ content: ['a ', { text: 'b', comments: ['c1'] }, ' ', { text: 'c', comment: 'c2' }] }] })
    expect(r.doc.comments).toEqual([
      { id: 'c1', author: 'Camille', date: '2026-11-08T09:30:00.000Z', text: 'Source ?', resolved: false, replies: [{ author: 'Sam', date: '2026-11-08T00:00:00.000Z', text: 'Rapport, p. 12.' }] },
      { id: 'c2', author: '', date: '', text: 'À revoir.', resolved: true, replies: [] },
    ])
    expect(para(r.doc.blocks[0])).toEqual([{ text: 'a ' }, { text: 'b', comments: ['c1'] }, { text: ' ' }, { text: 'c', comments: ['c2'] }])
    expect(r.report.issues).toEqual([])
  })

  it('plusieurs commentaires sur le même texte : identifiants triés, sans doublon', () => {
    const r = load({ comments: THREADS, blocks: [{ content: [{ text: 'x', comments: ['c2', 'c1', 'c2'] }] }] })
    expect(para(r.doc.blocks[0])).toEqual([{ text: 'x', comments: ['c1', 'c2'] }])
  })

  it('un commentaire inconnu est retiré, le texte reste', () => {
    const r = load({ comments: THREADS, blocks: [{ content: [{ text: 'x', comments: ['c1', 'zz'] }, { text: 'y', comments: ['zz'] }] }] })
    expect(para(r.doc.blocks[0])).toEqual([{ text: 'x', comments: ['c1'] }, { text: 'y' }])
    expect(codes(r)).toContain('comment-unknown')
  })

  it('identifiant en double : le second fil est ignoré', () => {
    const r = load({ comments: [...THREADS, { id: 'c1', text: 'doublon' }] })
    expect(r.doc.comments.map((c) => c.text)).toEqual(['Source ?', 'À revoir.'])
    expect(codes(r)).toContain('comment-duplicate')
  })

  it('pas de commentaire dans un en-tête ni dans une note', () => {
    const r = load({
      comments: THREADS,
      headers: { default: [{ content: [{ text: 'h', comments: ['c1'] }] }] },
      blocks: [{ content: ['a', { type: 'note', blocks: [{ type: 'paragraph', content: [{ text: 'n', comments: ['c1'] }] }] }] }],
    })
    expect(r.doc.headers.default).toEqual([{ type: 'paragraph', content: [{ text: 'h' }] }])
    expect(JSON.stringify(r.doc.blocks)).not.toContain('comments')
    expect(codes(r).filter((c) => c === 'comment-misplaced')).toHaveLength(2)
  })

  it('un fil sans texte commenté est gardé', () => {
    const r = load({ comments: THREADS, blocks: ['rien'] })
    expect(r.doc.comments).toHaveLength(2)
  })

  it('forme compacte : sans les champs vides, et se relit à l’identique', () => {
    const r = load({ comments: THREADS, blocks: [{ content: [{ text: 'b', comments: ['c1', 'c2'] }] }] })
    const c = toCompact(r.doc)
    expect(c.comments).toEqual([
      { id: 'c1', author: 'Camille', date: '2026-11-08T09:30:00.000Z', text: 'Source ?', replies: [{ author: 'Sam', date: '2026-11-08T00:00:00.000Z', text: 'Rapport, p. 12.' }] },
      { id: 'c2', text: 'À revoir.', resolved: true },
    ])
    const again = load(c as Record<string, unknown>)
    expect(again.doc.comments).toEqual(r.doc.comments)
    expect(again.doc.blocks).toEqual(r.doc.blocks)
  })

  it('passe par l’éditeur sans perte, commentaires imbriqués compris', () => {
    const r = load({
      comments: THREADS,
      blocks: [
        { content: ['un ', { text: 'deux', comments: ['c1'] }, { text: ' trois', comments: ['c1', 'c2'] }, { text: ' quatre', comments: ['c2'] }] },
        { type: 'table', rows: [[{ content: [{ text: 'cellule', comments: ['c2'] }] }]] },
      ],
    })
    const back = pmToDoc(docToPM(r.doc), identity(r.doc))
    expect(back.blocks).toEqual(r.doc.blocks)
    expect(back.comments).toEqual(r.doc.comments)
  })
})

describe('commentaires : commandes', () => {
  const me = { author: 'Moi', date: NOW, text: 'Mon commentaire' }
  const docOf = (blocks: unknown[], comments: unknown[] = []): PMNode => docToPM(load({ blocks, comments }).doc)
  const stateOf = (doc: PMNode, from: number, to = from) => EditorState.create({ doc, plugins: [history()], selection: TextSelection.create(doc, from, to) })
  const apply = (s: EditorState, cmd: Command) => {
    let out = s
    expect(cmd(s, (tr: Transaction) => (out = s.apply(tr)))).toBe(true)
    return out
  }
  const save = (s: EditorState) => pmToDoc(s.doc, { id: 'xxxxxx', created: NOW, modified: NOW })

  it('commente la sélection : marque et fil en une étape annulable', () => {
    let made = ''
    const s = apply(stateOf(docOf(['Bonjour le monde']), 9, 11), addComment(me, null, (id) => (made = id)))
    expect(made).toBe('c1')
    const d = save(s)
    expect(para(d.blocks[0])).toEqual([{ text: 'Bonjour ' }, { text: 'le', comments: ['c1'] }, { text: ' monde' }])
    expect(d.comments).toEqual([{ id: 'c1', author: 'Moi', date: NOW, text: 'Mon commentaire', resolved: false, replies: [] }])
    const u = apply(s, undo)
    expect(threadsOf(u)).toEqual([])
    expect(commentRanges(u.doc).size).toBe(0)
  })

  it('sans sélection : le mot sous le curseur ; sans mot : refusé', () => {
    const s = stateOf(docOf(['Bonjour le monde']), 4)
    expect(wordAt(s)).toEqual({ from: 1, to: 8 })
    const d = save(apply(s, addComment(me)))
    expect(para(d.blocks[0])[0]).toEqual({ text: 'Bonjour', comments: ['c1'] })
    expect(addComment(me)(stateOf(docOf(['a  b']), 3))).toBe(false)
    expect(addComment(me)(stateOf(docOf(['']), 1))).toBe(false)
  })

  it('refusé dans un bloc de code', () => {
    const d = docOf([{ type: 'code', text: 'x = 1' }])
    expect(addComment(me, { from: 1, to: 4 })(stateOf(d, 1))).toBe(false)
  })

  it('choisit un identifiant libre, même avec des marques orphelines', () => {
    expect(newCommentId([{ id: 'c1', author: '', date: '', text: '', resolved: false, replies: [] }])).toBe('c2')
    const s = stateOf(docOf([{ content: [{ text: 'x', comments: ['c2'] }] }], [{ id: 'c2', text: 'a' }]), 1)
    expect(newCommentId(threadsOf(s), s.doc)).toBe('c3')
    expect(newCommentId([{ id: 'c1', author: '', date: '', text: '', resolved: false, replies: [] }], s.doc)).toBe('c3')
  })

  it('répondre, modifier, supprimer une réponse, résoudre, rouvrir', () => {
    let s = stateOf(docOf([{ content: [{ text: 'x', comments: ['c1'] }] }], THREADS), 1)
    s = apply(s, replyToComment('c1', { author: 'Léa', date: NOW, text: 'Merci' }))
    expect(threadsOf(s)[0].replies.map((r) => r.text)).toEqual(['Rapport, p. 12.', 'Merci'])
    s = apply(s, editComment('c1', -1, 'Quelle source ?'))
    s = apply(s, editComment('c1', 1, 'Merci beaucoup'))
    expect(threadsOf(s)[0].text).toBe('Quelle source ?')
    expect(threadsOf(s)[0].replies[1].text).toBe('Merci beaucoup')
    s = apply(s, deleteReply('c1', 0))
    expect(threadsOf(s)[0].replies.map((r) => r.text)).toEqual(['Merci beaucoup'])
    s = apply(s, setResolved('c1', true))
    expect(threadsOf(s)[0].resolved).toBe(true)
    s = apply(s, setResolved('c1', false))
    expect(threadsOf(s)[0].resolved).toBe(false)
    expect(replyToComment('zz', me)(s)).toBe(false)
    // Chaque changement s'annule séparément.
    s = apply(s, undo)
    expect(threadsOf(s)[0].resolved).toBe(true)
  })

  it('supprimer un commentaire retire ses marques et son fil, pas les autres', () => {
    const s0 = stateOf(docOf([{ content: [{ text: 'a', comments: ['c1'] }, { text: 'b', comments: ['c1', 'c2'] }] }], THREADS), 1)
    const s = apply(s0, deleteComment('c1'))
    const d = save(s)
    expect(para(d.blocks[0])).toEqual([{ text: 'a' }, { text: 'b', comments: ['c2'] }])
    expect(d.comments.map((c) => c.id)).toEqual(['c2'])
    expect(save(apply(s0, deleteAllComments(true))).comments.map((c) => c.id)).toEqual(['c1'])
    const none = save(apply(s0, deleteAllComments()))
    expect(none.comments).toEqual([])
    expect(JSON.stringify(none.blocks)).not.toContain('comments')
    expect(deleteAllComments()(stateOf(docOf(['x']), 1))).toBe(false)
  })

  it('fils dans l’ordre du texte, ceux sur du texte supprimé à la fin', () => {
    const s = stateOf(docOf([{ content: ['un ', { text: 'deux', comments: ['c2'] }, ' trois ', { text: 'quatre', comments: ['c1'] }] }], [...THREADS, { id: 'c9', text: 'orphelin' }]), 1)
    const placed = placedThreads(s)
    expect(placed.map((p) => p.thread.id)).toEqual(['c2', 'c1', 'c9'])
    expect(placed.map((p) => p.quote)).toEqual(['deux', 'quatre', ''])
    expect(placed[2].from).toBeNull()
  })

  it('commentaire sous le curseur, sélection, suivant et précédent', () => {
    const d = docOf([{ content: ['un ', { text: 'deux', comments: ['c2'] }, ' trois ', { text: 'quatre', comments: ['c1'] }] }], THREADS)
    expect(commentsAt(stateOf(d, 6))).toEqual(['c2'])
    expect(commentsAt(stateOf(d, 1))).toEqual([])
    const sel = apply(stateOf(d, 1), selectComment('c1'))
    expect(sel.doc.textBetween(sel.selection.from, sel.selection.to)).toBe('quatre')
    let s = apply(stateOf(d, 1), gotoComment(1))
    expect(s.doc.textBetween(s.selection.from, s.selection.to)).toBe('deux')
    s = apply(s, gotoComment(1))
    expect(s.doc.textBetween(s.selection.from, s.selection.to)).toBe('quatre')
    expect(gotoComment(1)(s)).toBe(false)
    s = apply(s, gotoComment(-1))
    expect(s.doc.textBetween(s.selection.from, s.selection.to)).toBe('deux')
  })

  it('taper au bout d’un passage commenté ne l’agrandit pas', () => {
    const d = docOf([{ content: [{ text: 'mot', comments: ['c1'] }] }], THREADS)
    const s = stateOf(d, 4)
    const s2 = s.apply(s.tr.insertText('s'))
    expect(para(save(s2).blocks[0])).toEqual([{ text: 'mot', comments: ['c1'] }, { text: 's' }])
  })

  it('le HTML de l’éditeur se relit avec ses commentaires ; un collage n’en apporte jamais', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>a <span class="fp-comment" data-comment="c1">b</span><span class="fp-comment" data-comment="x y">c</span></p>'
    const parsed = PMDOMParser.fromSchema(schema).parse(el)
    // Relu tel quel (le navigateur réécrit parfois le texte : rien ne doit se perdre) ; un identifiant invalide est ignoré.
    expect([...commentRanges(parsed).keys()]).toEqual(['c1'])
    const slice = finalSlice(PMDOMParser.fromSchema(schema).parseSlice(el), false)
    let found = false
    slice.content.descendants((n) => void (found = found || n.marks.some((m) => m.type.name === 'comment')))
    expect(found).toBe(false)
    // Un déplacement dans le document garde ses commentaires.
    let kept = false
    finalSlice(PMDOMParser.fromSchema(schema).parseSlice(el), true).content.descendants((n) => void (kept = kept || n.marks.some((m) => m.type.name === 'comment')))
    expect(kept).toBe(true)
  })
})
