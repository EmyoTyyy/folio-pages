// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { history, undo } from 'prosemirror-history'
import { DOMParser as PMDOMParser, DOMSerializer, type Node as PMNode } from 'prosemirror-model'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { canInsertNote, collectNotes, convertAllNotes, convertNote, gotoNote, insertNote, noteLabels, noteNumber, noteText, setNoteBlocks } from '../../src/editor/notes'
import { schema } from '../../src/editor/schema'
import { toCompact } from '../../src/format/compact'
import { loadDocument, loadNoteBlocks, type LoadResult } from '../../src/format/load'
import { parseMarkdown } from '../../src/format/markdown'
import { defaultNotes, type Block, type FolioDoc, type Inline, type NoteInline, type NoteSettings } from '../../src/format/types'
import { paginate, type Box } from '../../src/layout/paginate'

const NOW = '2026-11-09T12:00:00.000Z'

function ok(r: LoadResult): Extract<LoadResult, { ok: true }> {
  if (!r.ok) throw new Error('refusé : ' + JSON.stringify(r))
  return r
}
const load = (v: Record<string, unknown>) => ok(loadDocument({ format: 'folio/doc', version: 1, ...v }, { now: NOW }))
const codes = (r: { report: { issues: { code: string }[] } }) => r.report.issues.map((i) => i.code)
const identity = (d: FolioDoc) => ({ id: d.id, created: d.meta.created, modified: d.meta.modified })
const throughEditor = (d: FolioDoc) => pmToDoc(docToPM(d), identity(d))
const notesOf = (items: Inline[]) => items.filter((x): x is NoteInline => 'type' in x && x.type === 'note')
const para = (b: Block) => (b.type === 'paragraph' ? b.content : [])

describe('notes : format', () => {
  it('lit une note en texte, en Markdown ou en blocs, de bas de page par défaut', () => {
    const r = load({
      blocks: [
        {
          type: 'paragraph',
          content: [
            'Texte',
            { type: 'note', text: 'Simple.' },
            ' suite',
            { type: 'note', kind: 'end', md: 'En **gras**.' },
            { type: 'note', blocks: ['Un.', { type: 'list', items: ['a', 'b'] }] },
          ],
        },
      ],
    })
    const notes = notesOf(para(r.doc.blocks[0]))
    expect(notes.map((x) => x.kind)).toEqual(['foot', 'end', 'foot'])
    expect(notes[0].blocks).toEqual([{ type: 'paragraph', content: [{ text: 'Simple.' }] }])
    expect(notes[1].blocks).toEqual([{ type: 'paragraph', content: [{ text: 'En ' }, { text: 'gras', bold: true }, { text: '.' }] }])
    expect(notes[2].blocks.map((b) => b.type)).toEqual(['paragraph', 'list'])
    expect(r.report.issues).toEqual([])
  })

  it('accepte « footnote » et « endnote » comme types', () => {
    const r = load({ blocks: [{ type: 'paragraph', content: ['a', { type: 'footnote', text: 'x' }, { type: 'endnote', text: 'y' }, { type: 'Endnote', kind: 'foot', text: 'z' }] }] })
    expect(notesOf(para(r.doc.blocks[0])).map((x) => x.kind)).toEqual(['foot', 'end', 'foot'])
  })

  it('une note ne contient que des paragraphes, des listes et du code : le reste est aplati, rien n’est perdu', () => {
    const r = load({
      blocks: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'note',
              blocks: [
                { type: 'heading', level: 2, text: 'Titre', align: 'center' },
                { type: 'quote', blocks: ['cité'] },
                { type: 'table', rows: [['c1', 'c2']] },
                { type: 'divider' },
                { type: 'code', text: 'x = 1' },
              ],
            },
          ],
        },
      ],
    })
    const [note] = notesOf(para(r.doc.blocks[0]))
    expect(note.blocks).toEqual([
      { type: 'paragraph', content: [{ text: 'Titre' }], align: 'center' },
      { type: 'paragraph', content: [{ text: 'cité' }] },
      { type: 'paragraph', content: [{ text: 'c1' }] },
      { type: 'paragraph', content: [{ text: 'c2' }] },
      { type: 'code', language: '', text: 'x = 1' },
    ])
    expect(codes(r).filter((c) => c === 'note-flattened').length).toBe(4)
  })

  it('pas de note dans une note, ni dans un en-tête ou un pied de page', () => {
    const r = load({
      headers: { default: [{ type: 'paragraph', content: ['En-tête', { type: 'note', text: 'non' }] }] },
      footers: { first: [{ type: 'list', items: [{ content: ['pied', { type: 'note', text: 'non' }] }] }] },
      blocks: [{ type: 'paragraph', content: ['a', { type: 'note', blocks: [{ type: 'paragraph', content: ['dedans', { type: 'note', text: 'imbriquée' }] }] }] }],
    })
    expect(r.doc.headers.default).toEqual([{ type: 'paragraph', content: [{ text: 'En-tête' }] }])
    expect(JSON.stringify(r.doc.footers)).not.toContain('note')
    const [note] = notesOf(para(r.doc.blocks[0]))
    expect(note.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'dedans' }] }])
    expect(codes(r).filter((c) => c === 'note-misplaced').length).toBe(3)
  })

  it('une note vide reste une note (un paragraphe vide)', () => {
    const r = load({ blocks: [{ type: 'paragraph', content: ['a', { type: 'note' }, { type: 'note', text: '' }, { type: 'note', blocks: [] }] }] })
    const notes = notesOf(para(r.doc.blocks[0]))
    expect(notes).toHaveLength(3)
    for (const n of notes) expect(n.blocks).toEqual([{ type: 'paragraph', content: [] }])
  })

  it('signale plusieurs sources pour une même note', () => {
    const r = load({ blocks: [{ type: 'paragraph', content: [{ type: 'note', text: 'a', md: 'b' }] }] })
    expect(codes(r)).toContain('several-sources')
  })

  it('borne le texte d’une note comme celui d’un paragraphe', () => {
    const r = load({ blocks: [{ type: 'paragraph', content: [{ type: 'note', text: 'x'.repeat(1_200_000) }] }] })
    const [note] = notesOf(para(r.doc.blocks[0]))
    expect(noteText(note.blocks).length).toBe(1_000_000)
  })

  it('écrit une note simple en texte dans la forme compacte, et se relit à l’identique', () => {
    const r = load({
      notes: { foot: { format: 'symbols' }, end: { restart: 'section' } },
      blocks: [
        { type: 'paragraph', content: ['a', { type: 'note', text: 'Simple.' }, { type: 'note', kind: 'end', blocks: ['Un.', 'Deux.'] }, { type: 'note' }] },
      ],
    })
    const c = toCompact(r.doc)
    expect(c.notes).toEqual({ foot: { format: 'symbols' }, end: { restart: 'section' } })
    const content = (c.blocks as { content: unknown[] }[])[0].content
    expect(content[1]).toEqual({ type: 'note', text: 'Simple.' })
    expect(content[2]).toMatchObject({ type: 'note', kind: 'end' })
    expect((content[2] as { blocks: unknown[] }).blocks).toHaveLength(2)
    expect(content[3]).toEqual({ type: 'note', text: '' })
    const again = load(c as Record<string, unknown>)
    expect(again.doc.blocks).toEqual(r.doc.blocks)
    expect(again.doc.notes).toEqual(r.doc.notes)
  })

  it('numérotation des notes : valeurs par défaut, alias, bornes', () => {
    expect(load({}).doc.notes).toEqual(defaultNotes())
    expect(toCompact(load({}).doc).notes).toBeUndefined()
    const r = load({ notes: { foot: { format: 'upper-roman', start: 5, restart: 'each-page' }, end: { format: 'nope', restart: 'page', start: 0 } } })
    expect(r.doc.notes.foot).toEqual({ format: 'ROMAN', start: 5, restart: 'page' })
    // Les notes de fin ne recommencent pas à chaque page ; un format inconnu est ignoré.
    expect(r.doc.notes.end).toEqual({ format: 'roman', start: 1, restart: 'continuous' })
    expect(codes(r)).toContain('invalid-value')
  })

  it('passe par l’éditeur sans perte', () => {
    const r = load({
      notes: { foot: { start: 4 } },
      blocks: [
        { type: 'paragraph', content: ['a', { type: 'note', md: 'Voir [le site](https://exemple.org) et {{page}}.' }] },
        { type: 'table', rows: [[{ content: ['cellule', { type: 'note', kind: 'end', text: 'dans un tableau' }] }]] },
        { type: 'image', src: 'https://exemple.org/a.png', caption: ['Légende', { type: 'note', text: 'dans une légende' }] },
        { type: 'list', items: [{ content: ['item', { type: 'note', text: 'dans une liste' }] }] },
      ],
    })
    const back = throughEditor(r.doc)
    expect(back.blocks).toEqual(r.doc.blocks)
    expect(back.notes).toEqual(r.doc.notes)
  })
})

describe('notes : Markdown', () => {
  const inline = (md: string) => para(parseMarkdown(md)[0])

  it('^[texte] est une note de bas de page', () => {
    const items = inline('Une phrase^[La *source*.] et la suite.')
    expect(items[0]).toEqual({ text: 'Une phrase' })
    expect(items[1]).toEqual({ type: 'note', kind: 'foot', blocks: [{ type: 'paragraph', content: [{ text: 'La ' }, { text: 'source', italic: true }, { text: '.' }] }] })
    expect(items[2]).toEqual({ text: ' et la suite.' })
  })

  it('^[2]^ reste un exposant ; une formule n’est pas lue', () => {
    expect(inline('x^[2]^')).toEqual([{ text: 'x' }, { text: '[2]', sup: true }])
    expect(inline('$a^[b]$ texte')).toEqual([{ type: 'math', tex: 'a^[b]' }, { text: ' texte' }])
  })

  it('[^id] avec sa définition, même sur plusieurs lignes', () => {
    const blocks = parseMarkdown('Texte[^1] et autre[^Long].\n\n[^1]: Première note.\n[^long]: Deuxième,\n    sur deux lignes.\n\n    Second paragraphe.\n\nFin.')
    expect(blocks).toHaveLength(2)
    const notes = notesOf(para(blocks[0]))
    expect(notes.map((x) => noteText(x.blocks))).toEqual(['Première note.', 'Deuxième, sur deux lignes. Second paragraphe.'])
    expect(notes[1].blocks).toHaveLength(2)
    expect(para(blocks[1])).toEqual([{ text: 'Fin.' }])
  })

  it('une définition jamais appelée reste du texte ; un appel sans définition aussi', () => {
    const blocks = parseMarkdown('Rien[^x] ici.\n\n[^y]: Orpheline.')
    expect(blocks.map((b) => (b.type === 'paragraph' ? b.content.map((c) => ('text' in c ? c.text : '?')).join('') : b.type))).toEqual(['Rien[^x] ici.', '[^y]: Orpheline.'])
  })

  it('pas de note dans une note', () => {
    const [note] = notesOf(inline('a^[dehors ^[dedans] fin]'))
    expect(noteText(note.blocks)).toBe('dehors ^[dedans] fin')
  })

  it('les notes du champ « markdown » du document vont jusqu’au bout', () => {
    const r = load({ markdown: '# Titre\n\nTexte^[note a] et[^b].\n\n[^b]: note b' })
    expect(notesOf(para(r.doc.blocks[1])).map((x) => noteText(x.blocks))).toEqual(['note a', 'note b'])
  })
})

describe('notes : numéros', () => {
  it('chiffres, romains, lettres, symboles', () => {
    expect([1, 2, 3, 4].map((n) => noteNumber(n, 'decimal'))).toEqual(['1', '2', '3', '4'])
    expect([1, 4, 9].map((n) => noteNumber(n, 'roman'))).toEqual(['i', 'iv', 'ix'])
    expect([1, 4].map((n) => noteNumber(n, 'ROMAN'))).toEqual(['I', 'IV'])
    expect([1, 26, 27].map((n) => noteNumber(n, 'alpha'))).toEqual(['a', 'z', 'aa'])
    expect([1, 2, 6, 7, 13].map((n) => noteNumber(n, 'symbols'))).toEqual(['*', '†', '‖', '**', '***'])
  })

  const doc = (settings: Partial<NoteSettings>) => {
    const r = load({
      notes: settings,
      blocks: [
        { type: 'paragraph', content: ['a', { type: 'note', text: '1' }, { type: 'note', kind: 'end', text: 'e1' }, { type: 'note', text: '2' }] },
        { type: 'section' },
        { type: 'paragraph', content: ['b', { type: 'note', text: '3' }, { type: 'note', kind: 'end', text: 'e2' }] },
      ],
    })
    return docToPM(r.doc)
  }

  it('continue d’un type à l’autre séparément, à partir du numéro de départ', () => {
    const d = doc({ foot: { format: 'decimal', start: 3, restart: 'continuous' } })
    expect(noteLabels(collectNotes(d), d.attrs.notes)).toEqual(['3', 'i', '4', '5', 'ii'])
  })

  it('recommence à chaque section, ou à chaque page', () => {
    const d = doc({ foot: { format: 'decimal', start: 1, restart: 'section' }, end: { format: 'alpha', start: 1, restart: 'section' } })
    const refs = collectNotes(d)
    expect(refs.map((r) => r.section)).toEqual([0, 0, 0, 1, 1])
    expect(noteLabels(refs, d.attrs.notes)).toEqual(['1', 'a', '2', '1', 'a'])
    const p = doc({ foot: { format: 'decimal', start: 1, restart: 'page' } })
    const pr = collectNotes(p)
    // La deuxième note de bas de page est sur une autre page que la première.
    // La troisième note de bas de page est sur la page suivante : elle reprend à 1.
    const pageOf = (pos: number) => (pos >= pr[3].pos ? 1 : 0)
    expect(noteLabels(pr, p.attrs.notes, pageOf)).toEqual(['1', 'i', '2', '1', 'ii'])
    // Sans pages connues (vue web), la numérotation continue.
    expect(noteLabels(pr, p.attrs.notes)).toEqual(['1', 'i', '2', '3', 'ii'])
  })
})

describe('notes : commandes', () => {
  const docOf = (blocks: unknown[]): PMNode => docToPM(load({ blocks }).doc)
  const stateOf = (doc: PMNode, at: number) => EditorState.create({ doc, plugins: [history()], selection: TextSelection.create(doc, at) })
  const apply = (s: EditorState, cmd: (s: EditorState, d?: (tr: import('prosemirror-state').Transaction) => void) => boolean) => {
    let out = s
    expect(cmd(s, (tr) => (out = s.apply(tr)))).toBe(true)
    return out
  }

  it('insère un appel de note après la sélection, annulable', () => {
    const s = EditorState.create({ doc: docOf(['Bonjour monde']), plugins: [history()], selection: TextSelection.create(docOf(['Bonjour monde']), 1, 8) })
    let at = -1
    const s2 = apply(s, insertNote('foot', (p) => (at = p)))
    expect(at).toBe(8)
    expect(s2.doc.nodeAt(8)?.type.name).toBe('note')
    expect(s2.doc.textContent).toBe('Bonjour monde')
    const back = pmToDoc(s2.doc, { id: 'x', created: NOW, modified: NOW })
    expect(para(back.blocks[0])).toEqual([{ text: 'Bonjour' }, { type: 'note', kind: 'foot', blocks: [{ type: 'paragraph', content: [] }] }, { text: ' monde' }])
    const s3 = apply(s2, undo)
    expect(collectNotes(s3.doc)).toHaveLength(0)
  })

  it('refuse une note dans un bloc de code', () => {
    const d = docOf([{ type: 'code', text: 'x = 1' }])
    expect(canInsertNote(stateOf(d, 2))).toBe(false)
    expect(insertNote('foot')(stateOf(d, 2))).toBe(false)
  })

  it('accepte une note dans une cellule, une liste, une légende', () => {
    const d = docOf([{ type: 'table', rows: [['cellule']] }])
    expect(canInsertNote(stateOf(d, 4))).toBe(true)
  })

  it('convertit une note, toutes les notes d’un type, ou échange les types', () => {
    const d = docOf([{ type: 'paragraph', content: ['a', { type: 'note', text: '1' }, 'b', { type: 'note', kind: 'end', text: '2' }, { type: 'note', text: '3' }] }])
    const s = stateOf(d, 1)
    const kinds = (st: EditorState) => collectNotes(st.doc).map((r) => r.kind)
    expect(kinds(apply(s, convertNote(collectNotes(d)[0].pos)))).toEqual(['end', 'end', 'foot'])
    expect(kinds(apply(s, convertAllNotes('foot')))).toEqual(['end', 'end', 'end'])
    expect(kinds(apply(s, convertAllNotes('end')))).toEqual(['foot', 'foot', 'foot'])
    expect(kinds(apply(s, convertAllNotes(null)))).toEqual(['end', 'foot', 'end'])
    expect(convertNote(1)(s)).toBe(false)
  })

  it('va à la note suivante ou précédente, d’un type ou de tous', () => {
    const d = docOf([{ type: 'paragraph', content: ['a', { type: 'note', text: '1' }, 'b', { type: 'note', kind: 'end', text: '2' }, { type: 'note', text: '3' }] }])
    const refs = collectNotes(d)
    let s = stateOf(d, 1)
    s = apply(s, gotoNote(1))
    expect((s.selection as NodeSelection).node.type.name).toBe('note')
    expect(s.selection.from).toBe(refs[0].pos)
    s = apply(s, gotoNote(1, 'foot'))
    expect(s.selection.from).toBe(refs[2].pos)
    expect(gotoNote(1)(s)).toBe(false)
    s = apply(s, gotoNote(-1, 'end'))
    expect(s.selection.from).toBe(refs[1].pos)
  })

  it('remplace le contenu d’une note en une étape', () => {
    const d = docOf([{ type: 'paragraph', content: ['a', { type: 'note', text: 'avant' }] }])
    const pos = collectNotes(d)[0].pos
    const s = apply(stateOf(d, 1), setNoteBlocks(pos, [{ type: 'paragraph', content: [{ text: 'après' }] }]))
    expect(noteText(collectNotes(s.doc)[0].node.attrs.blocks)).toBe('après')
    expect(noteText(collectNotes(apply(s, undo).doc)[0].node.attrs.blocks)).toBe('avant')
  })
})

describe('notes : collage', () => {
  const parse = (html: string) => {
    const el = document.createElement('div')
    el.innerHTML = html
    return PMDOMParser.fromSchema(schema).parse(el)
  }

  it('relit une note copiée dans le document', () => {
    const d = docToPM(load({ blocks: [{ type: 'paragraph', content: ['a', { type: 'note', kind: 'end', md: 'texte *en italique*' }] }] }).doc)
    const wrap = document.createElement('div')
    wrap.append(DOMSerializer.fromSchema(schema).serializeFragment(d.content))
    const back = parse(wrap.innerHTML)
    const [ref] = collectNotes(back)
    expect(ref.kind).toBe('end')
    expect(noteText(ref.node.attrs.blocks)).toBe('texte en italique')
  })

  it('nettoie le contenu d’une note collée (liens dangereux, trop de texte, JSON illisible)', () => {
    const evil = JSON.stringify([{ type: 'paragraph', content: [{ text: 'clic', link: 'javascript:alert(1)' }, { type: 'note', text: 'imbriquée' }] }, { type: 'image', src: 'https://x/a.png', caption: 'légende' }])
    const back = parse(`<p>a<sup data-note="foot" data-blocks='${evil.replace(/'/g, '&#39;')}'></sup></p>`)
    const [ref] = collectNotes(back)
    expect(JSON.stringify(ref.node.attrs.blocks)).not.toContain('javascript')
    expect(JSON.stringify(ref.node.attrs.blocks)).not.toContain('imbriquée')
    expect(noteText(ref.node.attrs.blocks)).toBe('clic légende')
    const broken = parse('<p>a<sup data-note="end" data-blocks="{pas du json">3</sup></p>')
    const [r2] = collectNotes(broken)
    expect(r2.kind).toBe('end')
    expect(noteText(r2.node.attrs.blocks)).toBe('3')
  })

  it('loadNoteBlocks donne toujours au moins un paragraphe', () => {
    expect(loadNoteBlocks(null)).toEqual([{ type: 'paragraph', content: [] }])
    expect(loadNoteBlocks('texte')).toEqual([{ type: 'paragraph', content: [] }])
    expect(loadNoteBlocks([], 'repli')).toEqual([{ type: 'paragraph', content: [{ text: 'repli' }] }])
  })
})

describe('notes : coupure en pages', () => {
  /** Paragraphes d'une ligne de 20 px, empilés ; `notes[i]` : hauteur de la note de la ligne i. */
  function lines(n: number, notes: Record<number, number> = {}): Box[] {
    return Array.from({ length: n }, (_, i) => ({
      top: i * 20,
      bottom: (i + 1) * 20,
      kind: 'text' as const,
      lines: () => [{ top: i * 20, bottom: (i + 1) * 20 }],
      ...(notes[i] ? { notes: [{ y: i * 20 + 10, height: notes[i] }] } : {}),
    }))
  }

  it('sans note, rien ne change', () => {
    expect(paginate(lines(10), 100, 12).map((b) => b.box)).toEqual([5])
  })

  it('la place des notes (et du filet, une fois) est retirée de la page', () => {
    // 5 lignes tiennent sans note ; avec une note de 25 px + filet de 12 px, seulement 3.
    expect(paginate(lines(10, { 0: 25 }), 100, 12).map((b) => b.box)).toEqual([3, 8])
    // Deux notes sur la même page : un seul filet.
    expect(paginate(lines(10, { 0: 10, 1: 10 }), 100, 12).map((b) => b.box)).toEqual([3, 8])
  })

  it('une ligne dont la note ne tient pas passe à la page suivante avec elle', () => {
    // Ligne 3 : 80 px, sa note 30 px + 12 px : déborde ; elle commence la page 2.
    const b = paginate(lines(10, { 3: 30 }), 100, 12)
    expect(b[0].box).toBe(3)
    expect(b[1].box).toBe(5) // page 2 : lignes 3 et 4 (40 + 42 = 82 ≤ 100), la 5 n'y tient plus
  })

  it('dans un paragraphe coupé, chaque note suit sa ligne', () => {
    const ls = Array.from({ length: 10 }, (_, i) => ({ top: i * 20, bottom: (i + 1) * 20 }))
    const box: Box = { top: 0, bottom: 200, kind: 'text', lines: () => ls, notes: [{ y: 30, height: 18 }, { y: 150, height: 18 }] }
    const b = paginate([box], 100, 12)
    // Page 1 : 100 - (18 + 12) = 70 → 3 lignes. Page 2 (60 à 160) : la ligne 7 et sa note
    // (160 + 30) ne tiennent plus ; elles passent ensemble à la page 3.
    expect(b[0]).toMatchObject({ box: 0, line: 3 })
    expect(b[1]).toMatchObject({ box: 0, line: 7 })
  })

  it('une note plus haute que la page ne bloque pas la coupure', () => {
    const b = paginate(lines(20, { 2: 500 }), 100, 12)
    expect(b.length).toBeGreaterThan(2)
    for (let i = 1; i < b.length; i++) expect(b[i].box).toBeGreaterThan(b[i - 1].box)
  })

  it('une ligne de tableau (atomique) emporte toutes ses notes', () => {
    const boxes: Box[] = [
      { top: 0, bottom: 60, kind: 'atomic' },
      { top: 60, bottom: 90, kind: 'atomic', notes: [{ y: 60, height: 10 }, { y: 60, height: 10 }] },
    ]
    expect(paginate(boxes, 100, 12).map((b) => b.box)).toEqual([1])
    expect(paginate(boxes, 130, 12)).toEqual([])
  })
})
