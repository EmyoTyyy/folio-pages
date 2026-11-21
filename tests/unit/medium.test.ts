// @vitest-environment jsdom
// Fonctions ajoutées en 0.11 (suite) : sens d'écriture, numéros de ligne,
// graphiques, recherche dans les notes, fenêtres.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { DOMSerializer } from 'prosemirror-model'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import { exportDocx } from '../../src/docx/export'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { paraDir, setAlign, setDirection, visualAlign } from '../../src/editor/commands'
import { toHtml } from '../../src/export/html'
import { exportOdt } from '../../src/export/odt'
import { blockDir, cssAlign, dirToStore, firstStrong } from '../../src/format/bidi'
import { toCompact } from '../../src/format/compact'
import { loadDocument } from '../../src/format/load'
import type { FolioDoc } from '../../src/format/types'
import { NOW, open, parts } from './docx-helpers'

function load(input: Record<string, unknown>): FolioDoc {
  const r = loadDocument({ format: 'folio/doc', version: 1, meta: { title: 'Essai', lang: 'fr' }, ...input }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  expect(r.report.issues).toEqual([])
  return r.doc
}
const viaEditor = (d: FolioDoc) => pmToDoc(docToPM(d), { id: d.id, created: d.meta.created, modified: d.meta.modified })
type Para = { content: { text?: string }[]; align?: string; dir?: string }
type Cell = { textDir?: string; blocks: unknown[] }

describe('sens d’écriture', () => {
  const DOC = {
    blocks: [
      { text: 'שלום עולם' },
      { text: 'مرحبا بالعالم', align: 'right' },
      { text: 'Bonjour', dir: 'rtl' },
      { text: 'سلام', dir: 'ltr' },
      { type: 'table', rows: [[{ text: 'Bas', textDir: 'tbrl' }, { text: 'Haut', textDir: 'btlr' }, 'Normal']] },
    ],
  }

  it('détection du sens, valeur à garder, alignement logique', () => {
    expect(firstStrong('  12, שלום')).toBe('rtl')
    expect(firstStrong('« Bonjour » مرحبا')).toBe('ltr')
    expect(firstStrong('2026 !')).toBeNull()
    expect(blockDir({ content: [{ text: 'مرحبا' }] })).toBe('rtl')
    expect(blockDir({ dir: 'ltr', content: [{ text: 'مرحبا' }] })).toBe('ltr')
    expect(blockDir({ content: [] })).toBe('ltr')
    // ce qui se déduit du texte n'est pas écrit
    expect(dirToStore(true, [{ text: 'שלום' }])).toBeUndefined()
    expect(dirToStore(true, [{ text: 'Bonjour' }])).toBe('rtl')
    expect(dirToStore(false, [{ text: 'שלום' }])).toBe('ltr')
    expect(dirToStore(false, [{ text: 'Bonjour' }])).toBeUndefined()
    expect([cssAlign('left'), cssAlign('right'), cssAlign('center')]).toEqual(['start', 'end', 'center'])
  })

  it('format : alias, compact, aller-retour par l’éditeur', () => {
    const d = load(DOC)
    expect((d.blocks[2] as Para).dir).toBe('rtl')
    expect((d.blocks[3] as Para).dir).toBe('ltr')
    const cells = (d.blocks[4] as { rows: Cell[][] }).rows[0]
    expect(cells.map((c) => c.textDir)).toEqual(['tbrl', 'btlr', undefined])
    expect(viaEditor(d).blocks).toEqual(d.blocks)
    const compact = toCompact(d) as { blocks: Record<string, unknown>[] }
    expect(compact.blocks[2]).toEqual({ text: 'Bonjour', dir: 'rtl' })
    expect((compact.blocks[4].rows as unknown[][])[0][0]).toEqual({ text: 'Bas', textDir: 'tbrl' })
    const r = loadDocument({ format: 'folio/doc', version: 1, meta: { title: 'E' }, blocks: [{ text: 'x', dir: 'right-to-left' }, { type: 'table', rows: [[{ text: 'y', textDir: 'up' }]] }] }, { now: NOW })
    if (!r.ok) throw new Error('refusé')
    expect((r.doc.blocks[0] as Para).dir).toBe('rtl')
    expect((r.doc.blocks[1] as { rows: Cell[][] }).rows[0][0].textDir).toBe('btlr')
    expect(r.report.issues.map((i) => i.code)).toEqual(['coerced', 'coerced'])
  })

  it('éditeur : sens dir="auto" ou imposé, alignement vu sur la page, texte vertical des cellules', () => {
    const pm = docToPM(load(DOC))
    const ser = DOMSerializer.fromSchema(pm.type.schema)
    const dom = (n: number) => ser.serializeNode(pm.child(n)) as HTMLElement
    expect(dom(0).getAttribute('dir')).toBe('auto')
    expect(dom(1).style.textAlign).toBe('end')
    expect(dom(2).getAttribute('dir')).toBe('rtl')
    expect(dom(3).getAttribute('dir')).toBe('ltr')
    const tds = dom(4).querySelectorAll('td, th')
    expect([...tds].map((td) => td.getAttribute('data-text-dir'))).toEqual(['tbrl', 'btlr', null])

    // Paragraphe en hébreu : « aligner à droite » est son début (left dans le format), « à gauche » sa fin.
    let state = EditorState.create({ doc: pm })
    const at = (n: number) => {
      let pos = 0
      for (let i = 0; i < n; i++) pos += state.doc.child(i).nodeSize
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos + 2)))
    }
    const run = (cmd: (s: EditorState, d?: (tr: Transaction) => void) => boolean) => cmd(state, (tr) => (state = state.apply(tr)))
    at(0)
    expect(paraDir(state)).toBe('rtl')
    expect(visualAlign(state)).toBe('right')
    run(setAlign('left'))
    expect(state.doc.child(0).attrs.align).toBe('right')
    expect(visualAlign(state)).toBe('left')
    run(setAlign('right'))
    expect(state.doc.child(0).attrs.align).toBeNull()
    // Imposer le sens contraire du texte l'écrit ; revenir au sens du texte l'efface.
    run(setDirection('ltr'))
    expect(state.doc.child(0).attrs.dir).toBe('ltr')
    expect(paraDir(state)).toBe('ltr')
    run(setDirection('rtl'))
    expect(state.doc.child(0).attrs.dir).toBeNull()
    at(2)
    run(setDirection('ltr'))
    expect(state.doc.child(2).attrs.dir).toBeNull()
  })

  it('.docx : w:bidi, alignement logique, w:textDirection ; relu à l’identique', async () => {
    const d = load(DOC)
    const out = await exportDocx(d, { now: new Date(NOW) })
    const xml = parts(out.bytes)['word/document.xml']
    const paras = xml.split('<w:p>').slice(1)
    expect(paras[0]).toContain('<w:bidi/>')
    expect(paras[0]).not.toContain('<w:jc')
    // align « right » (la fin du paragraphe) : w:jc right, que Word place à gauche dans un paragraphe w:bidi
    expect(paras[1]).toMatch(/<w:bidi\/>.*<w:jc w:val="right"\/>/)
    expect(paras[2]).toContain('<w:bidi/>')
    expect(paras[3]).not.toContain('<w:bidi')
    expect(xml).toContain('<w:textDirection w:val="tbRl"/>')
    expect(xml).toContain('<w:textDirection w:val="btLr"/>')
    const back = open(out.bytes).doc
    expect(back.blocks.slice(0, 4).map((b) => [(b as Para).dir, (b as Para).align])).toEqual([
      [undefined, undefined],
      [undefined, 'right'],
      ['rtl', undefined],
      ['ltr', undefined],
    ])
    expect((back.blocks[4] as { rows: Cell[][] }).rows[0].map((c) => c.textDir)).toEqual(['tbrl', 'btlr', undefined])
  })

  it('.odt : style:writing-mode, alignement visuel (comme LibreOffice), cellules tb-rl et bt-lr ; relu', async () => {
    const { importOdt } = await import('../../src/file/odt-import')
    const d = load(DOC)
    const odt = await exportOdt(d)
    const content = strFromU8(unzipSync(odt.bytes)['content.xml'])
    expect(content).toMatch(/style:writing-mode="rl-tb" fo:text-align="end"/)
    expect(content).toMatch(/style:writing-mode="rl-tb" fo:text-align="start"/)
    expect(content).toContain('style:writing-mode="tb-rl"')
    expect(content).toContain('loext:writing-mode="bt-lr"')
    const back = loadDocument(importOdt(odt.bytes).doc, { now: NOW })
    if (!back.ok) throw new Error('refusé')
    expect(back.doc.blocks.slice(0, 4).map((b) => [(b as Para).dir, (b as Para).align])).toEqual([
      [undefined, undefined],
      [undefined, 'right'],
      ['rtl', undefined],
      ['ltr', undefined],
    ])
    expect((back.doc.blocks[4] as { rows: Cell[][] }).rows[0].map((c) => c.textDir)).toEqual(['tbrl', 'btlr', undefined])
  })

  it('fichiers externes : le même sens et le même alignement depuis .docx, .odt et .rtf (LibreOffice)', async () => {
    const { importOdt } = await import('../../src/file/odt-import')
    const { importRtf } = await import('../../src/file/rtf-import')
    const docx = open(new Uint8Array(readFileSync('tests/fixtures/docx/sens.docx'))).doc
    const odt = loadDocument(importOdt(new Uint8Array(readFileSync('tests/fixtures/odt/sens.odt'))).doc, { now: NOW })
    const rtf = loadDocument(importRtf(readFileSync('tests/fixtures/rtf/sens.rtf', 'latin1')).doc, { now: NOW })
    if (!odt.ok || !rtf.ok) throw new Error('refusé')
    for (const doc of [docx, odt.doc, rtf.doc]) {
      const paras = doc.blocks.filter((b) => b.type === 'paragraph') as Para[]
      expect(paras.slice(0, 4).map((p) => [p.content.map((x) => x.text).join(''), p.dir, p.align])).toEqual([
        ['שלום עולם', undefined, undefined],
        ['مرحبا بالعالم', undefined, 'right'],
        ['Bonjour', 'rtl', undefined],
        ['سلام', 'ltr', undefined],
      ])
      const table = doc.blocks.find((b) => b.type === 'table') as { rows: Cell[][] }
      expect(table.rows[0].map((c) => c.textDir)).toEqual(['tbrl', 'btlr'])
    }
  })

  it('page web : dir="rtl", alignement logique, writing-mode des cellules', () => {
    const html = toHtml(load(DOC))
    expect(html).toContain('<p dir="rtl">שלום עולם</p>')
    expect(html).toContain('<p style="text-align:end" dir="rtl">مرحبا بالعالم</p>')
    expect(html).toContain('<p dir="rtl">Bonjour</p>')
    expect(html).toContain('<p>سلام</p>')
    expect(html).toContain('writing-mode:vertical-rl;text-orientation:sideways')
    expect(html).toContain('writing-mode:vertical-lr;writing-mode:sideways-lr')
  })
})

describe('rechercher dans les notes', () => {
  const NOTES = {
    blocks: [
      { content: [{ text: 'Le chat dort.' }, { type: 'note', text: 'Un chat noir, un chat blanc.' }] },
      { content: [{ text: 'Autre chat ici.' }, { type: 'note', kind: 'end', text: 'Le Chat, encore.' }] },
    ],
  }
  const setup = async () => {
    const { findPlugin } = await import('../../src/editor/find')
    const { history } = await import('prosemirror-history')
    let state = EditorState.create({ doc: docToPM(load(NOTES)), plugins: [findPlugin(), history()] })
    const run = (cmd: (s: EditorState, d?: (tr: Transaction) => void) => boolean) => cmd(state, (tr) => (state = state.apply(tr)))
    return { run, get: () => state }
  }
  const noteText = (s: EditorState, n: number) => {
    const notes: string[] = []
    s.doc.descendants((node) => {
      if (node.type.name === 'note') notes.push((node.attrs.blocks as { content: { text: string }[] }[]).map((b) => b.content.map((x) => x.text).join('')).join(' '))
    })
    return notes[n]
  }

  it('résultats du texte et des notes, dans l’ordre du texte ; aller au suivant', async () => {
    const F = await import('../../src/editor/find')
    const { run, get } = await setup()
    run(F.setQuery({ text: 'chat', regex: false, caseSensitive: false, wholeWord: false }))
    const fs = F.findState(get())!
    expect(fs.matches.map((m) => (m.note === undefined ? 'texte' : 'note'))).toEqual(['texte', 'note', 'note', 'texte', 'note'])
    // les positions d'une note sont celles de son contenu : « Un chat » commence à 1, « chat » à 4
    expect(fs.matches[1]).toMatchObject({ from: 4, to: 8 })
    expect(fs.current).toBe(0)
    // le premier « suivant » sélectionne le premier résultat après le curseur
    run(F.findNext(1))
    expect(get().doc.textBetween(get().selection.from, get().selection.to)).toBe('chat')
    expect(F.findState(get())!.current).toBe(0)
    run(F.findNext(1))
    expect(F.currentMatch(get())).toMatchObject({ note: fs.matches[1].note, from: 4 })
    // la sélection se pose sur l'appel de note
    expect(get().selection.from).toBe(fs.matches[1].note)
    run(F.findNext(1))
    expect(F.findState(get())!.current).toBe(2)
    run(F.findNext(1))
    expect(F.currentMatch(get())!.note).toBeUndefined()
    expect(get().doc.textBetween(get().selection.from, get().selection.to)).toBe('chat')
    run(F.findNext(1))
    run(F.findNext(1))
    expect(F.findState(get())!.current).toBe(0)
    run(F.findNext(-1))
    expect(F.findState(get())!.current).toBe(4)
    // casse respectée : « Chat » de la note de fin n'en est plus
    run(F.setQuery({ text: 'chat', regex: false, caseSensitive: true, wholeWord: false }))
    expect(F.findState(get())!.matches).toHaveLength(4)
  })

  it('remplacer dans une note (groupes d’expression régulière), puis passer au suivant ; tout remplacer en une étape', async () => {
    const F = await import('../../src/editor/find')
    const { undo } = await import('prosemirror-history')
    const { run, get } = await setup()
    run(F.setQuery({ text: 'ch(at)', regex: true, caseSensitive: false, wholeWord: false }))
    run(F.findNext(1))
    run(F.findNext(1))
    expect(F.currentMatch(get())!.note).toBeDefined()
    run(F.replaceCurrent('r$1'))
    expect(noteText(get(), 0)).toBe('Un rat noir, un chat blanc.')
    // le suivant : le second « chat » de la même note
    expect(F.currentMatch(get())).toMatchObject({ note: F.findState(get())!.matches[1].note, from: 17 })
    run(F.replaceCurrent('r$1'))
    expect(noteText(get(), 0)).toBe('Un rat noir, un rat blanc.')
    expect(F.currentMatch(get())!.note).toBeUndefined()
    // tout remplacer : texte et notes, une seule étape d'annulation
    let n = 0
    run(F.replaceAll('chien', (k) => (n = k)))
    expect(n).toBe(3)
    expect(get().doc.textContent).toContain('Le chien dort.')
    expect(get().doc.textContent).toContain('Autre chien ici.')
    expect(noteText(get(), 1)).toBe('Le chien, encore.')
    run(undo)
    expect(noteText(get(), 1)).toBe('Le Chat, encore.')
    expect(get().doc.textContent).toContain('Autre chat ici.')
    // la mise en forme du texte remplacé est gardée
    const d = load({ blocks: [{ content: [{ text: 'x' }, { type: 'note', blocks: [{ content: [{ text: 'mot ' }, { text: 'gras', bold: true }] }] }] }] })
    let s = EditorState.create({ doc: docToPM(d), plugins: [F.findPlugin()] })
    const r = (cmd: (s: EditorState, d?: (tr: Transaction) => void) => boolean) => cmd(s, (tr) => (s = s.apply(tr)))
    r(F.setQuery({ text: 'gras', regex: false, caseSensitive: false, wholeWord: false }))
    r(F.replaceAll('fort'))
    let blocks: unknown
    s.doc.descendants((node) => {
      if (node.type.name === 'note') blocks = node.attrs.blocks
    })
    expect(blocks).toEqual([{ type: 'paragraph', content: [{ text: 'mot ' }, { text: 'fort', bold: true }] }])
  })

  it('résultats surlignés dans le rendu d’une note, même à cheval sur une mise en forme', async () => {
    const { markNoteHits } = await import('../../src/editor/find')
    const body = document.createElement('div')
    body.innerHTML = '<p>Un <b>ch</b>at noir</p><p>Un chat blanc</p>'
    markNoteHits(body, { text: 'chat', regex: false, caseSensitive: false, wholeWord: false }, 1)
    const marks = [...body.querySelectorAll('mark')]
    expect(marks.map((m) => m.textContent)).toEqual(['ch', 'at', 'chat'])
    expect(marks.map((m) => m.classList.contains('fp-find-hit--current'))).toEqual([false, false, true])
    expect(body.textContent).toBe('Un chat noirUn chat blanc')
    // sans recherche, les marques s'en vont
    markNoteHits(body, null, -1)
    expect(body.querySelectorAll('mark')).toHaveLength(0)
    expect(body.innerHTML).toBe('<p>Un <b>ch</b>at noir</p><p>Un chat blanc</p>')
  })
})

describe('numéros de ligne', () => {
  it('format : true ou réglages, alias, compact, aller-retour par l’éditeur ; paragraphe sans numéros', () => {
    const d = load({ lineNumbers: { restart: 'page', countBy: 5, distance: 14 }, blocks: [{ text: 'Un' }, { text: 'Deux', noLineNumbers: true }] })
    expect(d.lineNumbers).toEqual({ restart: 'page', start: 1, countBy: 5, distance: 14 })
    expect((d.blocks[1] as { noLineNumbers?: boolean }).noLineNumbers).toBe(true)
    expect(viaEditor(d)).toMatchObject({ lineNumbers: d.lineNumbers, blocks: d.blocks })
    expect(toCompact(d)).toMatchObject({ lineNumbers: { restart: 'page', countBy: 5, distance: 14 }, blocks: [{ text: 'Un' }, { text: 'Deux', noLineNumbers: true }] })
    const on = load({ lineNumbers: true, blocks: ['x'] })
    expect(on.lineNumbers).toEqual({ restart: 'continuous', start: 1, countBy: 1 })
    expect((toCompact(on) as { lineNumbers: unknown }).lineNumbers).toBe(true)
    expect(load({ lineNumbers: false, blocks: ['x'] }).lineNumbers).toBeUndefined()
    const r = loadDocument({ format: 'folio/doc', version: 1, meta: { title: 'E' }, lineNumbers: { restart: 'each-page', countBy: 500, start: 0 }, blocks: [] }, { now: NOW })
    if (!r.ok) throw new Error('refusé')
    expect(r.doc.lineNumbers).toMatchObject({ restart: 'page', start: 1 })
    expect(r.report.issues.map((i) => i.path)).toEqual(expect.arrayContaining(['lineNumbers.restart']))
  })

  it('numérotation : recommencer par page ou par section, un numéro toutes les n lignes', async () => {
    const { lineLabels } = await import('../../src/layout/linenumbers')
    const line = (page: number, section = 0) => ({ baseline: 0, right: 0, size: 12, page, section })
    const lines = [line(0), line(0), line(0), line(1), line(1), line(2, 1), line(2, 1)]
    const nums = (s: Parameters<typeof lineLabels>[1]) => lineLabels(lines, s).map(([, n]) => n)
    expect(nums({ restart: 'continuous', start: 1, countBy: 1 })).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(nums({ restart: 'page', start: 1, countBy: 1 })).toEqual([1, 2, 3, 1, 2, 1, 2])
    expect(nums({ restart: 'section', start: 10, countBy: 1 })).toEqual([10, 11, 12, 13, 14, 10, 11])
    // toutes les lignes comptent, seuls les multiples s'affichent
    expect(nums({ restart: 'continuous', start: 1, countBy: 2 })).toEqual([2, 4, 6])
    expect(lineLabels(lines, { restart: 'continuous', start: 1, countBy: 2 })[0][0]).toBe(lines[1])
  })

  it('.docx : w:lnNumType (w:start à partir de 0) dans chaque section, w:suppressLineNumbers ; relu', async () => {
    const d = load({ lineNumbers: { restart: 'section', start: 5, countBy: 2, distance: 20 }, blocks: ['Un', { text: 'Deux', noLineNumbers: true }, { type: 'section' }, 'Trois'] })
    const out = await exportDocx(d, { now: new Date(NOW) })
    const xml = parts(out.bytes)['word/document.xml']
    expect(xml.match(/<w:lnNumType [^>]*\/>/g)).toEqual(['<w:lnNumType w:countBy="2" w:start="4" w:restart="newSection" w:distance="400"/>', '<w:lnNumType w:countBy="2" w:start="4" w:restart="newSection" w:distance="400"/>'])
    expect(xml).toMatch(/<w:suppressLineNumbers\/>.*Deux/)
    const back = open(out.bytes).doc
    expect(back.lineNumbers).toEqual({ restart: 'section', start: 5, countBy: 2, distance: 20 })
    expect(back.blocks.map((b) => (b as { noLineNumbers?: boolean }).noLineNumbers ?? false)).toEqual([false, true, false, false])
  })

  it('.odt : configuration, premier numéro sur le premier paragraphe et à chaque section, paragraphe exclu ; relu', async () => {
    const { importOdt } = await import('../../src/file/odt-import')
    const d = load({ lineNumbers: { restart: 'page', start: 3, countBy: 5 }, blocks: ['Un', { text: 'Deux', noLineNumbers: true }] })
    const r = await exportOdt(d)
    const files = unzipSync(r.bytes)
    expect(strFromU8(files['styles.xml'])).toContain('<text:linenumbering-configuration text:number-lines="true" text:offset="18pt" style:num-format="1" text:number-position="left" text:increment="5" text:restart-on-page="true"')
    const content = strFromU8(files['content.xml'])
    expect(content).toContain('text:line-number="3"')
    expect(content).toContain('text:number-lines="false"')
    const back = loadDocument(importOdt(r.bytes).doc, { now: NOW })
    if (!back.ok) throw new Error('refusé')
    expect(back.doc.lineNumbers).toEqual({ restart: 'page', start: 3, countBy: 5, distance: 18 })
    expect(back.doc.blocks.map((b) => (b as { noLineNumbers?: boolean }).noLineNumbers ?? false)).toEqual([false, true])
  })

  it('fichiers externes : les mêmes réglages depuis .docx, .odt et .rtf (LibreOffice)', async () => {
    const { importOdt } = await import('../../src/file/odt-import')
    const { importRtf } = await import('../../src/file/rtf-import')
    const docx = open(new Uint8Array(readFileSync('tests/fixtures/docx/lignes.docx'))).doc
    const odt = loadDocument(importOdt(new Uint8Array(readFileSync('tests/fixtures/odt/lignes.odt'))).doc, { now: NOW })
    const rtf = loadDocument(importRtf(readFileSync('tests/fixtures/rtf/lignes.rtf', 'latin1')).doc, { now: NOW })
    if (!odt.ok || !rtf.ok) throw new Error('refusé')
    for (const doc of [docx, odt.doc, rtf.doc]) {
      expect(doc.lineNumbers).toEqual({ restart: 'page', start: 5, countBy: 2, distance: 28.5 })
      const p = doc.blocks.filter((b) => b.type === 'paragraph') as (Para & { noLineNumbers?: boolean })[]
      expect(p.filter((b) => b.noLineNumbers).map((b) => b.content.map((x) => x.text).join(''))).toEqual(['Sans numero'])
    }
  })
})

describe('graphiques', () => {
  const CHARTS = {
    blocks: [
      { type: 'chart', kind: 'bar', title: 'Ventes', labels: ['T1', 'T2', 'T3'], series: [{ name: '2025', values: [12, 18, 15] }, { name: '2026', values: [14, null, 19] }] },
      { type: 'chart', kind: 'line', title: 'Température', labels: ['Lun', 'Mar', 'Mer', 'Jeu'], series: [{ name: 'Paris', values: [8.5, 10, null, 12] }] },
      { type: 'chart', kind: 'pie', title: 'Budget', labels: ['Loyer', 'Courses', 'Loisirs'], series: [{ name: 'Mois', values: [820, 350, 120] }] },
      { type: 'chart', kind: 'bar', horizontal: true, labels: ['A', 'B'], series: [{ name: 'X', values: [3, -2] }] },
    ],
  }
  type C = { kind: string; title?: string; labels: string[]; series: { name: string; values: (number | null)[] }[]; legend?: boolean; horizontal?: boolean }

  it('nombres écrits dans les cellules, données d’un tableau, graduations', async () => {
    const { parseNumber, chartFromRows, niceScale } = await import('../../src/format/chart')
    expect(['1 200', '1 200,50 €', '12 %', '-3.5', '1,234.5', '(40)', '+7', '−2', '1.234.567', '0,5'].map((s) => parseNumber(s))).toEqual([1200, 1200.5, 12, -3.5, 1234.5, -40, 7, -2, 1234567, 0.5])
    expect(parseNumber('1,234', 'en')).toBe(1234)
    expect(parseNumber('1,234', 'fr')).toBe(1.234)
    expect(parseNumber('1.234', 'de')).toBe(1234)
    expect(['', 'abc', '12 kg', '-', '1-2'].map((s) => parseNumber(s))).toEqual([null, null, null, null, null])
    expect(chartFromRows([['', 'Ventes', 'Notes'], ['Janvier', '1 200 €', 'bien'], ['Février', '', 'moyen'], ['Mars', '1 450', '']])).toEqual({ labels: ['Janvier', 'Février', 'Mars'], series: [{ name: 'Ventes', values: [1200, null, 1450] }] })
    expect(chartFromRows([['a', 'b'], ['x', 'y']])).toBeNull()
    expect(chartFromRows([['seul']])).toBeNull()
    expect(niceScale(0, 19)).toMatchObject({ min: 0, max: 20, step: 5 })
    expect(niceScale(-2, 3).ticks).toEqual([-2, -1, 0, 1, 2, 3])
    expect(niceScale(5, 5).ticks.length).toBeGreaterThan(1)
  })

  it('format : labels et series, ou rows ; alias ; valeurs manquantes gardées ; compact ; éditeur', () => {
    const d = load(CHARTS)
    expect(d.blocks.map((b) => b.type)).toEqual(['chart', 'chart', 'chart', 'chart'])
    expect((d.blocks[0] as unknown as C).series[1].values).toEqual([14, null, 19])
    expect(viaEditor(d).blocks).toEqual(d.blocks)
    expect((toCompact(d) as { blocks: unknown[] }).blocks[0]).toEqual({ type: 'chart', title: 'Ventes', labels: ['T1', 'T2', 'T3'], series: [{ name: '2025', values: [12, 18, 15] }, { name: '2026', values: [14, null, 19] }] })
    const r = loadDocument(
      {
        format: 'folio/doc',
        version: 1,
        meta: { title: 'E' },
        blocks: [
          { type: 'piechart', rows: [['', 'Part'], ['Oui', 62], ['Non', '38 %']] },
          { type: 'graphique', kind: 'histogram', series: [{ values: [1, 2, 3, 4] }] },
          { type: 'chart', labels: ['a', 'b', 'c'], series: [{ name: 's', values: [1, 2, 3, 4, 5] }, { name: 't', values: [9] }] },
          { type: 'chart', labels: ['a'], series: [] },
          { series: [{ name: 'deviné', values: [1] }] },
        ],
      },
      { now: NOW },
    )
    if (!r.ok) throw new Error('refusé')
    const [pie, bars, cut, guessed] = r.doc.blocks as unknown as C[]
    expect(pie).toEqual({ type: 'chart', kind: 'pie', labels: ['Oui', 'Non'], series: [{ name: 'Part', values: [62, 38] }] })
    expect(bars).toMatchObject({ kind: 'bar', labels: ['1', '2', '3', '4'], series: [{ name: '1', values: [1, 2, 3, 4] }] })
    expect(cut.series.map((s) => s.values)).toEqual([[1, 2, 3], [9, null, null]])
    expect(guessed).toMatchObject({ type: 'chart', labels: ['1'] })
    expect(r.doc.blocks).toHaveLength(4)
    expect(r.report.issues.some((i) => i.code === 'chart-empty')).toBe(true)
  })

  it('dessin SVG : barres, courbes, secteurs, barres horizontales ; texte échappé', async () => {
    const { chartSvg } = await import('../../src/format/chart')
    const look = { colors: ['#111111', '#222222'], text: '#333333', font: 'Inter, sans-serif', lang: 'fr' }
    const d = load(CHARTS)
    const svg = (i: number) => chartSvg(d.blocks[i] as never, look)
    const doc = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml')
    const bars = doc(svg(0))
    expect(bars.querySelector('parsererror')).toBeNull()
    expect(bars.querySelector('title')?.textContent).toBe('Ventes')
    // 5 barres (une valeur manquante), plus 2 carrés de légende
    expect(bars.querySelectorAll('rect[fill="#111111"], rect[fill="#222222"]').length).toBe(5 + 2)
    expect([...bars.querySelectorAll('text')].map((t) => t.textContent)).toEqual(expect.arrayContaining(['Ventes', 'T1', 'T2', 'T3', '2025', '2026', '0', '20']))
    const line = doc(svg(1))
    expect(line.querySelectorAll('path[stroke="#111111"]').length).toBe(1)
    // la valeur manquante coupe la courbe : deux morceaux
    expect(line.querySelector('path[stroke="#111111"]')!.getAttribute('d')!.match(/M/g)).toHaveLength(2)
    expect(line.querySelectorAll('circle').length).toBe(3)
    const pie = doc(svg(2))
    expect(pie.querySelectorAll('path').length).toBe(3)
    expect([...pie.querySelectorAll('text')].map((t) => t.textContent)).toEqual(expect.arrayContaining(['64 %', '27 %', '9,3 %', 'Loyer', 'Loisirs']))
    expect(doc(svg(3)).querySelectorAll('rect').length).toBe(2)
    const evil = chartSvg({ type: 'chart', kind: 'bar', title: '<script>alert(1)</script>', labels: ['a & b'], series: [{ name: '"x"', values: [1] }] }, look)
    expect(evil).not.toContain('<script>')
    expect(doc(evil).querySelector('parsererror')).toBeNull()
    expect(doc(evil).querySelector('title')?.textContent).toBe('<script>alert(1)</script>')
  })

  it('.docx : vrais graphiques (valeurs en cache, classeur incorporé), relus à l’identique', async () => {
    const d = load(CHARTS)
    const out = await exportDocx(d, { now: new Date(NOW) })
    const p = parts(out.bytes)
    expect(Object.keys(p).filter((k) => /^word\/charts\/chart\d\.xml$/.test(k)).sort()).toEqual(['word/charts/chart1.xml', 'word/charts/chart2.xml', 'word/charts/chart3.xml', 'word/charts/chart4.xml'])
    expect(p['word/charts/chart1.xml']).toContain('<c:barDir val="col"/>')
    expect(p['word/charts/chart4.xml']).toContain('<c:barDir val="bar"/>')
    expect(p['word/charts/chart2.xml']).toContain('<c:lineChart>')
    expect(p['word/charts/chart3.xml']).toContain('<c:showPercent val="1"/>')
    expect(p['[Content_Types].xml']).toContain('application/vnd.openxmlformats-officedocument.drawingml.chart+xml')
    expect(p['word/_rels/document.xml.rels']).toContain('Target="charts/chart1.xml"')
    expect(p['word/document.xml']).toContain('<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdFolioChart1"/>')
    // le classeur des données : une vraie feuille
    const xlsx = unzipSync(unzipSync(out.bytes)['word/embeddings/chart_data1.xlsx'])
    expect(strFromU8(xlsx['xl/worksheets/sheet1.xml'])).toContain('<c r="B2"><v>12</v></c>')
    const back = open(out.bytes)
    expect(back.doc.blocks).toEqual(d.blocks)
    expect(back.issues).toEqual([])
    expect(out.losses).toEqual([])
  })

  it('.odt : image SVG et données dans sa description, relue ; page web : SVG ; Markdown : tableau', async () => {
    const { importOdt } = await import('../../src/file/odt-import')
    const { toMarkdown } = await import('../../src/export/text')
    const d = load(CHARTS)
    const r = await exportOdt(d)
    const files = unzipSync(r.bytes)
    expect(Object.keys(files).filter((k) => k.endsWith('.svg'))).toHaveLength(4)
    expect(strFromU8(files['content.xml'])).toContain('<svg:desc>folio-chart:{&quot;kind&quot;:&quot;bar&quot;')
    expect(strFromU8(files['META-INF/manifest.xml'])).toContain('manifest:media-type="image/svg+xml"')
    const back = loadDocument(importOdt(r.bytes).doc, { now: NOW })
    if (!back.ok) throw new Error('refusé')
    expect(back.doc.blocks).toEqual(d.blocks)
    const html = toHtml(d)
    expect(html.match(/<figure class="chart"><svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 640 400" role="img" aria-label="Ventes"/g)).toHaveLength(1)
    expect(toMarkdown(d).markdown).toContain('**Ventes**\n\n|   | 2025 | 2026 |\n| --- | --- | --- |\n| T1 | 12 | 14 |\n| T2 | 18 |   |')
  })

  it('fichiers de LibreOffice : ses graphiques (.odt natif, .docx réécrit) donnent les mêmes données', async () => {
    const { importOdt } = await import('../../src/file/odt-import')
    const d = load(CHARTS)
    const odt = loadDocument(importOdt(new Uint8Array(readFileSync('tests/fixtures/odt/graphiques.odt'))).doc, { now: NOW })
    if (!odt.ok) throw new Error('refusé')
    const docx = open(new Uint8Array(readFileSync('tests/fixtures/docx/graphiques-lo.docx'))).doc
    for (const doc of [odt.doc, docx]) {
      const charts = doc.blocks.filter((b) => b.type === 'chart') as unknown as C[]
      expect(charts.map((c) => [c.kind, c.title ?? '', c.labels, c.series, !!c.horizontal])).toEqual((d.blocks as unknown as C[]).map((c) => [c.kind, c.title ?? '', c.labels, c.series, !!c.horizontal]))
    }
  })
})
