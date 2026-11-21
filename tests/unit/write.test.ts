// @vitest-environment jsdom
// Fonctions ajoutées en 0.11 : listes à cocher, encadrés, glossaire,
// formulaires, dessin, caviardage, objectif d'écriture…

import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { EditorState, TextSelection } from 'prosemirror-state'
import { exportDocx } from '../../src/docx/export'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { schema } from '../../src/editor/schema'
import { toggleChecked, toggleList } from '../../src/editor/commands'
import { toHtml } from '../../src/export/html'
import { exportOdt } from '../../src/export/odt'
import { toMarkdown, toPlainText } from '../../src/export/text'
import { toCompact } from '../../src/format/compact'
import { loadDocument } from '../../src/format/load'
import { parseMarkdown } from '../../src/format/markdown'
import { blocksToMarkdown } from '../../src/format/markdown-out'
import type { FolioDoc } from '../../src/format/types'
import { NOW, open, parts } from './docx-helpers'

function load(input: Record<string, unknown>): FolioDoc {
  const r = loadDocument({ format: 'folio/doc', version: 1, meta: { title: 'Essai', lang: 'fr' }, ...input }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  expect(r.report.issues).toEqual([])
  return r.doc
}
const viaEditor = (d: FolioDoc) => pmToDoc(docToPM(d), { id: d.id, created: d.meta.created, modified: d.meta.modified })

describe('listes à cocher', () => {
  const TASKS = {
    blocks: [
      {
        type: 'list',
        style: 'check',
        items: [{ text: 'Réserver la salle', checked: true }, 'Envoyer l’ordre du jour', { text: 'Imprimer', level: 1, style: 'bullet' }, { text: 'Café', level: 1, checked: true, style: 'check' }],
      },
    ],
  }

  it('forme complète, compacte et aller-retour par l’éditeur', () => {
    const d = load(TASKS)
    const list = d.blocks[0] as Extract<FolioDoc['blocks'][0], { type: 'list' }>
    expect(list.style).toBe('check')
    expect(list.items.map((i) => [i.style, !!i.checked])).toEqual([['check', true], ['check', false], ['bullet', false], ['check', true]])
    expect(viaEditor(d).blocks).toEqual(d.blocks)
    const compact = toCompact(d) as { blocks: unknown[] }
    expect(compact.blocks[0]).toEqual({
      type: 'list',
      style: 'check',
      items: [{ text: 'Réserver la salle', checked: true }, 'Envoyer l’ordre du jour', { text: 'Imprimer', level: 1, style: 'bullet' }, { text: 'Café', level: 1, style: 'check', checked: true }],
    })
    // alias et écriture Markdown dans une chaîne
    const r = loadDocument({ format: 'folio/doc', version: 1, meta: { title: 'E' }, blocks: [{ type: 'todo', items: ['[x] fait', '[ ] à faire', 'sans case'] }] }, { now: NOW })
    if (!r.ok) throw new Error('refusé')
    expect(r.report.issues).toEqual([{ kind: 'warning', code: 'coerced', path: 'blocks[0].type', detail: 'todo → list' }])
    const alt = r.doc
    expect((alt.blocks[0] as { items: unknown[] }).items).toEqual([
      { content: [{ text: 'fait' }], level: 0, style: 'check', checked: true },
      { content: [{ text: 'à faire' }], level: 0, style: 'check' },
      { content: [{ text: 'sans case' }], level: 0, style: 'check' },
    ])
    // un élément non coché dont le texte commence par « [x] » ne devient pas une case
    const tricky = load({ blocks: [{ type: 'list', style: 'check', items: [{ text: '[x] littéral' }] }] })
    expect((toCompact(tricky) as { blocks: { items: unknown[] }[] }).blocks[0].items[0]).toEqual({ text: '[x] littéral' })
  })

  it('Markdown dans les deux sens (- [ ] / - [x])', () => {
    const blocks = parseMarkdown('- [x] fait\n- [ ] à faire\n  - sous-point\n\n- simple')
    expect(blocks[0]).toMatchObject({ type: 'list', style: 'check', items: [{ checked: true, style: 'check' }, { style: 'check' }, { style: 'bullet', level: 1 }] })
    expect(blocks[1]).toMatchObject({ type: 'list', style: 'bullet' })
    expect(blocksToMarkdown(load(TASKS).blocks)).toContain('- [x] Réserver la salle\n- [ ] Envoyer l’ordre du jour')
    expect(toMarkdown(load(TASKS)).markdown).toContain('    - [x] Café')
    expect(toPlainText(load(TASKS))).toContain('☒ Réserver la salle')
  })

  it('commandes : liste à cocher, cocher au clavier, retour aux puces', () => {
    let state = EditorState.create({ doc: docToPM(load({ blocks: ['un', 'deux'] })) })
    const run = (c: (s: EditorState, d?: (tr: import('prosemirror-state').Transaction) => void) => boolean) => c(state, (tr) => (state = state.apply(tr)))
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)))
    expect(run(toggleList('check'))).toBe(true)
    expect(state.doc.firstChild!.type).toBe(schema.nodes.check_list)
    expect(run(toggleChecked)).toBe(true)
    expect(pmToDoc(state.doc, { id: 'x', created: '', modified: '' }).blocks[0]).toMatchObject({ items: [{ checked: true }, { checked: true }] })
    run(toggleChecked)
    expect(pmToDoc(state.doc, { id: 'x', created: '', modified: '' }).blocks[0]).toMatchObject({ items: [{ content: [{ text: 'un' }] }, { content: [{ text: 'deux' }] }] })
    run(toggleList('bullet'))
    expect(state.doc.firstChild!.type).toBe(schema.nodes.bullet_list)
  })

  it('.docx : cases ☐ / ☒ en guise de puces, relues comme liste à cocher', async () => {
    const d = load(TASKS)
    const out = await exportDocx(d, { now: new Date(NOW) })
    const p = parts(out.bytes)
    expect(p['word/numbering.xml']).toContain('w:val="☐"')
    expect(p['word/numbering.xml']).toContain('w:val="☒"')
    const back = open(out.bytes).doc
    expect(back.blocks[0]).toMatchObject({ type: 'list', style: 'check' })
    expect((back.blocks[0] as { items: unknown[] }).items.map((i) => [(i as { style: string }).style, !!(i as { checked?: true }).checked])).toEqual([['check', true], ['check', false], ['bullet', false], ['check', true]])
  })

  it('.odt, page web', async () => {
    const r = await exportOdt(load(TASKS))
    const content = strFromU8(unzipSync(r.bytes)['content.xml'])
    expect(content).toContain('text:bullet-char="☐"')
    expect(content).toMatch(/<text:list-item text:style-override="L\d+">/)
    const html = toHtml(load(TASKS))
    expect(html).toContain('<ul class="checklist"><li><input type="checkbox" disabled="disabled" checked="checked">Réserver la salle')
    expect(html).toContain('<ul><li>Imprimer</li></ul><ul class="checklist"><li><input type="checkbox" disabled="disabled" checked="checked">Café')
  })
})

describe('encadrés', () => {
  const BOXES = {
    blocks: [
      { type: 'callout', kind: 'warning', title: 'Avant de commencer', blocks: ['Coupez le courant.', { type: 'list', items: ['un', 'deux'] }] },
      { type: 'callout', md: 'Une **astuce** simple.', kind: 'tip' },
      { type: 'callout', text: 'Remarque courte.' },
    ],
  }

  it('format : complet, compact, aliases, aplatissement, aller-retour par l’éditeur', () => {
    const r = loadDocument({ format: 'folio/doc', version: 1, meta: { title: 'E', lang: 'fr' }, blocks: [{ type: 'warning', text: 'alias' }] }, { now: NOW })
    if (!r.ok) throw new Error('refusé')
    expect(r.report.issues.map((i) => i.code)).toEqual(['coerced'])
    expect(r.doc.blocks[0]).toEqual({ type: 'callout', kind: 'warning', blocks: [{ type: 'paragraph', content: [{ text: 'alias' }] }] })
    const d = load(BOXES)
    expect(d.blocks.map((b) => [b.type, (b as { kind?: string }).kind])).toEqual([['callout', 'warning'], ['callout', 'tip'], ['callout', 'note']])
    expect(d.blocks[0]).toMatchObject({ title: 'Avant de commencer', blocks: [{ type: 'paragraph' }, { type: 'list' }] })
    expect(viaEditor(d).blocks).toEqual(d.blocks)
    expect((toCompact(d) as { blocks: unknown[] }).blocks.slice(1)).toEqual([
      { type: 'callout', kind: 'tip', content: ['Une ', { text: 'astuce', bold: true }, ' simple.'] },
      { type: 'callout', text: 'Remarque courte.' },
    ])
    // un encadré dans un encadré : son contenu est gardé, à plat ; dans une cellule : aplati
    const nested = loadDocument({ format: 'folio/doc', version: 1, meta: { title: 'E' }, blocks: [{ type: 'callout', blocks: [{ type: 'callout', text: 'dedans' }] }, { type: 'table', rows: [[{ blocks: [{ type: 'callout', text: 'cellule' }] }]] }] }, { now: NOW })
    if (!nested.ok) throw new Error('refusé')
    expect(nested.doc.blocks[0]).toEqual({ type: 'callout', kind: 'note', blocks: [{ type: 'paragraph', content: [{ text: 'dedans' }] }] })
    expect((nested.doc.blocks[1] as { rows: { blocks: unknown[] }[][] }).rows[0][0].blocks).toEqual([{ type: 'paragraph', content: [{ text: 'cellule' }] }])
    expect(nested.report.issues.map((i) => i.code).sort()).toEqual(['callout-flattened', 'cell-flattened'])
  })

  it('Markdown : alertes GitHub et encadrés Obsidian, dans les deux sens', () => {
    const blocks = parseMarkdown('> [!WARNING]\n> Attention au **verglas**.\n\n> [!tip] Bon à savoir\n> Texte\n\n> citation simple')
    expect(blocks[0]).toEqual({ type: 'callout', kind: 'warning', blocks: [{ type: 'paragraph', content: [{ text: 'Attention au ' }, { text: 'verglas', bold: true }, { text: '.' }] }] })
    expect(blocks[1]).toMatchObject({ type: 'callout', kind: 'tip', title: 'Bon à savoir' })
    expect(blocks[2]).toMatchObject({ type: 'quote' })
    const d = load(BOXES)
    expect(blocksToMarkdown(d.blocks)).toContain('> [!WARNING] Avant de commencer\n> Coupez le courant.')
    expect(toMarkdown(d).markdown).toContain('> [!TIP]\n> Une **astuce** simple.')
    expect(toPlainText(d)).toContain('AVANT DE COMMENCER :\n\n    Coupez le courant.')
    expect(toPlainText(d)).toContain('REMARQUE :')
  })

  it('commandes : insérer (sélection ou encadré vide), changer de type, retirer', async () => {
    const { insertCallout, removeCallout, calloutAt } = await import('../../src/editor/callout')
    let state = EditorState.create({ doc: docToPM(load({ blocks: ['un', 'deux'] })) })
    const run = (c: (s: EditorState, d?: (tr: import('prosemirror-state').Transaction) => void) => boolean) => c(state, (tr) => (state = state.apply(tr)))
    // curseur dans « un » (non vide) : un encadré vide après, avec le curseur
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)))
    expect(run(insertCallout('tip'))).toBe(true)
    expect(state.doc.child(1).type).toBe(schema.nodes.callout)
    expect(calloutAt(state)?.node.attrs.kind).toBe('tip')
    // dans un encadré : change son type
    run(insertCallout('caution'))
    expect(state.doc.child(1).attrs.kind).toBe('caution')
    run(removeCallout)
    expect(state.doc.childCount).toBe(3)
    // une sélection sur deux paragraphes : ils entrent dans l'encadré
    state = EditorState.create({ doc: docToPM(load({ blocks: ['un', 'deux'] })) })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)))
    run(insertCallout('important'))
    expect(pmToDoc(state.doc, { id: 'x', created: '', modified: '' }).blocks).toEqual([
      { type: 'callout', kind: 'important', blocks: [{ type: 'paragraph', content: [{ text: 'un' }] }, { type: 'paragraph', content: [{ text: 'deux' }] }] },
    ])
  })

  it('.docx : tableau d’une cellule au style « Folio callout », relu comme encadré', async () => {
    const d = load(BOXES)
    const out = await exportDocx(d, { now: new Date(NOW) })
    const p = parts(out.bytes)
    expect(p['word/document.xml']).toContain('<w:tblStyle w:val="FolioCalloutWarning"/>')
    expect(p['word/styles.xml']).toContain('w:styleId="FolioCalloutTip"')
    expect(p['word/document.xml']).toContain('w:fill="FDF3E1"')
    const back = open(out.bytes).doc
    expect(back.blocks.map((b) => [b.type, (b as { kind?: string }).kind, (b as { title?: string }).title])).toEqual([
      ['callout', 'warning', 'Avant de commencer'],
      ['callout', 'tip', undefined],
      ['callout', 'note', undefined],
    ])
    expect((back.blocks[0] as { blocks: { type: string }[] }).blocks.map((b) => b.type)).toEqual(['paragraph', 'list'])
  })

  it('.odt et page web', async () => {
    const r = await exportOdt(load(BOXES))
    const content = strFromU8(unzipSync(r.bytes)['content.xml'])
    expect(content).toContain('table:name="Callout_warning_')
    expect(content).toContain('fo:border-left="3pt solid #b7791f"')
    expect(content).toContain('>Avant de commencer</text:span>')
    expect(content).toContain('>Astuce</text:span>')
    const html = toHtml(load(BOXES))
    expect(html).toContain('<aside class="callout warning" role="note"><p class="callout-title">Avant de commencer</p>')
    expect(html).toContain('<p class="callout-title">Remarque</p>')
    expect(html).toContain('.folio-page aside.callout.tip{--cb:#2e8540;--cf:#e9f5ec}')
  })
})

describe('extraits', () => {
  it('sélection → extrait (sans commentaires ni texte supprimé), puis insertion en ligne ou en blocs', async () => {
    const { selectionContent, insertSnippet, findSnippet, expandSnippet, wordBefore, cleanSnippet } = await import('../../src/editor/snippets')
    const d = load({
      comments: [{ id: 'c1', author: 'A', date: '', text: 'x', resolved: false, replies: [] }],
      blocks: [{ content: [{ text: 'Bien ' }, { text: 'cordialement', bold: true, comments: ['c1'] }, { text: ' vieux', deleted: { author: 'A', date: '' } }, { text: ',' }] }, 'Ana Duval', 'fin'],
    })
    let state = EditorState.create({ doc: docToPM(d) })
    const run = (c: (s: EditorState, d?: (tr: import('prosemirror-state').Transaction) => void) => boolean) => c(state, (tr) => (state = state.apply(tr)))
    // morceau de paragraphe : un extrait « en ligne »
    const inline = selectionContent(state, 1, 1 + 'Bien cordialement vieux,'.length)!
    expect(inline.inline).toBe(true)
    expect(inline.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'Bien ' }, { text: 'cordialement', bold: true }, { text: ',' }] }])
    // deux paragraphes entiers : des blocs
    const p2 = state.doc.child(0).nodeSize
    const blocks = selectionContent(state, 0, p2 + state.doc.child(1).nodeSize)!
    expect(blocks.inline).toBe(false)
    expect(blocks.blocks).toHaveLength(2)
    // insertion en ligne au milieu de « fin »
    const end = state.doc.content.size - 1
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, end - 1)))
    run(insertSnippet(inline))
    expect(state.doc.lastChild!.textContent).toBe('fiBien cordialement,n')
    // F3 : mot avant le curseur → extrait (raccourci, nom, début de nom unique)
    const list = [
      { id: 'a', name: 'Formule de politesse', shortcut: 'bc', created: '', ...inline },
      { id: 'b', name: 'Signature', shortcut: '', created: '', ...blocks },
    ]
    expect(findSnippet(list, 'BC')?.id).toBe('a')
    expect(findSnippet(list, 'signature')?.id).toBe('b')
    expect(findSnippet(list, 'form')?.id).toBe('a')
    expect(findSnippet(list, 'for')).toBeNull()
    state = EditorState.create({ doc: docToPM(load({ blocks: ['Merci, bc'] })) })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)))
    expect(wordBefore(state)).toBe('bc')
    let missing = ''
    expect(run(expandSnippet(() => list, (w) => (missing = w)))).toBe(true)
    expect(state.doc.textContent).toBe('Merci, Bien cordialement,')
    run(expandSnippet(() => list, (w) => (missing = w)))
    expect(missing).toBe('')
    // fichier d'export : validé comme un document
    expect(cleanSnippet({ name: '  Adresse  ', shortcut: 'mauvais raccourci', blocks: ['12 rue des Lilas'] }, NOW)).toMatchObject({ name: 'Adresse', shortcut: '', blocks: [{ type: 'paragraph', content: [{ text: '12 rue des Lilas' }] }] })
    expect(cleanSnippet({ name: '', blocks: [] }, NOW)).toBeNull()
    expect(cleanSnippet({ name: 'x', blocks: 'pas une liste' }, NOW)).toBeNull()
  })
})

describe('statistiques, lisibilité, objectif', () => {
  it('phrases, syllabes, indices de Flesch et de Kandel–Moles, phrases longues', async () => {
    const { sentences, syllables, readability, longSentenceRanges, LONG_SENTENCE } = await import('../../src/editor/stats')
    expect(sentences('Bonjour. Comment allez-vous ? Très bien !', 'fr').map((s) => s.words)).toEqual([1, 3, 2])
    expect(syllables('table', 'fr')).toBe(1)
    expect(syllables('ordinateur', 'fr')).toBe(4)
    expect(syllables('reading', 'en')).toBe(2)
    expect(syllables('cake', 'en')).toBe(1)
    const long = Array.from({ length: LONG_SENTENCE + 5 }, (_, i) => `mot${i}`).join(' ') + '.'
    const easy = 'Le chat dort. Il fait beau. Nous lisons un livre. La porte est ouverte. Le pain est bon. On part demain matin.'
    const d = load({ meta: { title: 'E', lang: 'fr' }, blocks: [easy, long, { type: 'code', text: Array(40).fill('x').join(' ') }] })
    const pm = docToPM(d)
    const r = readability(pm, 'fr')
    expect(r.sentences).toBe(7)
    expect(r.longSentences).toBe(1)
    expect(r.score).not.toBeNull()
    expect(r.readMinutes).toBeCloseTo((r.avgSentence * r.sentences) / 230, 1)
    // un texte court et simple est « facile » ; trop court : pas d'indice
    const simple = readability(docToPM(load({ blocks: [easy + ' ' + easy] })), 'fr')
    expect(simple.score!).toBeGreaterThan(70)
    expect(readability(docToPM(load({ blocks: ['Trop court.'] })), 'fr').score).toBeNull()
    // la phrase longue : sa position dans le document (le code n'est pas compté)
    const ranges = longSentenceRanges(pm, 'fr')
    expect(ranges).toHaveLength(1)
    expect(pm.textBetween(ranges[0].from, ranges[0].to)).toBe(long)
  })

  it('objectif : format, progression, jours restants', async () => {
    const { goalProgress, daysLeft, duration, scoreLabel } = await import('../../src/ui/stats')
    const d = load({ goal: { words: 2000, deadline: '2026-12-01' }, blocks: ['x'] })
    expect(d.goal).toEqual({ words: 2000, deadline: '2026-12-01' })
    expect(viaEditor(d).goal).toEqual(d.goal)
    expect((toCompact(d) as { goal: unknown }).goal).toEqual({ words: 2000, deadline: '2026-12-01' })
    const bad = loadDocument({ format: 'folio/doc', version: 1, meta: { title: 'E' }, goal: { words: 0, deadline: 'demain' }, blocks: ['x'] }, { now: NOW })
    expect(bad.ok && bad.doc.goal).toEqual({ words: 1 })
    const now = new Date(2026, 10, 21)
    expect(daysLeft('2026-12-01', now)).toBe(10)
    expect(goalProgress(500, { words: 2000, deadline: '2026-12-01' }, now)).toEqual({ pct: 25, remaining: 1500, perDay: 137, days: 10 })
    expect(goalProgress(2500, { words: 2000 }, now)).toEqual({ pct: 100, remaining: 0, perDay: null, days: null })
    expect(duration(0.4)).toMatch(/minute/)
    expect(duration(75)).toMatch(/1 h 15/)
    expect(scoreLabel(95)).toBe('stats.score.veryEasy')
    expect(scoreLabel(10)).toBe('stats.score.veryHard')
  })
})

describe('glossaire et abréviations', () => {
  const GLOSS = {
    meta: { title: 'Rapport', lang: 'fr' },
    terms: [
      { term: 'OMS', definition: 'Organisation mondiale de la santé', kind: 'abbreviation' },
      { term: 'photosynthèse', definition: 'Production de matière organique à partir de lumière.' },
      { term: 'critère', definition: 'Ce qui sert à juger.', plural: 'critères' },
      { term: 'ADN', definition: 'Acide désoxyribonucléique', kind: 'abbreviation' },
      { term: 'jamais employé', definition: 'x' },
    ],
    blocks: [
      'Selon l’OMS, la Photosynthèse compte. Les critères sont clairs ; les oms en minuscules ne comptent pas.',
      { type: 'glossary', title: 'Glossaire' },
      { type: 'abbreviations', title: 'Abréviations' },
    ],
  }

  it('format, recherche dans le texte (casse, pluriel, mot entier), listes', async () => {
    const { termMatcher, termsToList, detectAbbreviations, unexpandedFirstUses } = await import('../../src/format/terms')
    const d = load(GLOSS)
    expect(d.terms!.map((x) => [x.id, x.kind])).toEqual([['t1', 'abbreviation'], ['t2', 'glossary'], ['t3', 'glossary'], ['t4', 'abbreviation'], ['t5', 'glossary']])
    expect(viaEditor(d).terms).toEqual(d.terms)
    expect(viaEditor(d).blocks).toEqual(d.blocks)
    expect((toCompact(d) as { terms: unknown[] }).terms[0]).toEqual({ term: 'OMS', definition: 'Organisation mondiale de la santé', kind: 'abbreviation', id: 't1' })
    const hits = termMatcher(d.terms!).scan('OMS, oms, photosynthèses, Photosynthèse, critères, critèreS, OMSE')
    expect(hits.map((x) => x.id)).toEqual(['t1', 't2', 't3', 't3'])
    expect(termsToList(d, 'glossary', false).map((x) => x.term)).toEqual(['critère', 'photosynthèse'])
    expect(termsToList(d, 'glossary', true).map((x) => x.term)).toEqual(['critère', 'jamais employé', 'photosynthèse'])
    expect(termsToList(d, 'abbreviation', false).map((x) => x.term)).toEqual(['OMS'])
    // doublon écarté
    const dup = loadDocument({ format: 'folio/doc', version: 1, meta: { title: 'E' }, terms: [{ term: 'Chat', definition: 'a' }, { term: 'chat', definition: 'b' }], blocks: ['x'] }, { now: NOW })
    expect(dup.ok && dup.doc.terms!.length).toBe(1)
    expect(dup.ok && dup.report.issues.map((i) => i.code)).toEqual(['term-duplicate'])
    // abréviations probables ; forme longue entre parenthèses (avant ou après)
    expect(detectAbbreviations(['L’Organisation mondiale de la santé (OMS) et l’ADN (acide désoxyribonucléique) ; le CO2 ; Le Mot.'])).toEqual([
      { short: 'OMS', long: 'Organisation mondiale de la santé' },
      { short: 'ADN', long: 'acide désoxyribonucléique' },
      { short: 'CO2', long: '' },
    ])
    // première occurrence non développée
    const late = unexpandedFirstUses(
      [
        { text: 'L’OMS publie.', base: 0 },
        { text: 'Plus loin, Organisation mondiale de la santé.', base: 1000 },
        { text: 'Acide désoxyribonucléique (ADN).', base: 2000 },
      ],
      d.terms!,
    )
    expect(late).toEqual([{ id: 't1', pos: 2 }])
  })

  it('CSV, fusion des termes', async () => {
    const { termsFromCsv, termsToCsv, mergeTerms } = await import('../../src/ui/glossary')
    const csv = 'terme;définition\nONU;Organisation des Nations unies\nsédiment;"Dépôt; laissé par l’eau"\n'
    const rows = termsFromCsv(csv)
    expect(rows).toEqual([
      { term: 'ONU', definition: 'Organisation des Nations unies', kind: 'abbreviation' },
      { term: 'sédiment', definition: 'Dépôt; laissé par l’eau', kind: 'glossary' },
    ])
    expect(termsFromCsv('ONU,Nations unies\nRNA,Ribonucleic acid')).toHaveLength(2)
    const merged = mergeTerms([{ id: 't1', term: 'ONU', definition: 'ancienne', kind: 'abbreviation' }], rows)
    expect(merged).toMatchObject({ added: 1, updated: 1 })
    expect(merged.terms[0]).toEqual({ id: 't1', term: 'ONU', definition: 'Organisation des Nations unies', kind: 'abbreviation' })
    expect(termsFromCsv(termsToCsv(merged.terms))).toEqual(merged.terms.map(({ id: _i, ...x }) => x))
    // (le module de l'interface tire tout le ruban : son premier chargement est lent)
  }, 30_000)

  it('exports : .docx relu (termes et listes), .odt, page web, Markdown', async () => {
    const d = load(GLOSS)
    const out = await exportDocx(d, { now: new Date(NOW) })
    const p = parts(out.bytes)
    expect(p['word/document.xml']).toContain('<w:pStyle w:val="FolioGlossary"/>')
    expect(p['word/styles.xml']).toContain('w:styleId="FolioAbbreviations"')
    const back = open(out.bytes).doc
    expect(back.blocks.slice(1)).toEqual([
      { type: 'glossary', title: 'Glossaire' },
      { type: 'abbreviations', title: 'Abréviations' },
    ])
    expect(back.terms!.map((x) => [x.term, x.kind])).toEqual([['critère', 'glossary'], ['photosynthèse', 'glossary'], ['OMS', 'abbreviation']])
    const odt = strFromU8(unzipSync((await exportOdt(d)).bytes)['content.xml'])
    expect(odt).toContain('>critère</text:span><text:s/>: Ce qui sert à juger.')
    expect(odt).toContain('OMS<text:tab/>Organisation mondiale de la santé')
    const html = toHtml(d)
    expect(html).toContain('<section class="generated glossary" role="doc-glossary"><p class="gen-title">Glossaire</p><dl><dt><dfn>critère</dfn></dt><dd>Ce qui sert à juger.</dd>')
    expect(html).toContain('<dt><abbr title="Organisation mondiale de la santé">OMS</abbr></dt>')
    expect(toMarkdown(d).markdown).toContain('- **critère** : Ce qui sert à juger.')
  })
})

describe('impression', () => {
  it('ordre d’un livret, plages de pages', async () => {
    const { bookletOrder } = await import('../../src/layout/pageview')
    const { parsePageRange } = await import('../../src/ui/print')
    // 8 pages : feuille 1 = [8,1] / [2,7], feuille 2 = [6,3] / [4,5] (indices à partir de 0)
    expect(bookletOrder(8)).toEqual([[7, 0], [1, 6], [5, 2], [3, 4]])
    // 5 pages : complétées à 8 par des blanches (-1)
    expect(bookletOrder(5)).toEqual([[-1, 0], [1, -1], [-1, 2], [3, 4]])
    expect(bookletOrder(1)).toEqual([[-1, 0], [-1, -1]])
    expect(parsePageRange('1-3, 5', 10)).toEqual([0, 1, 2, 4])
    expect(parsePageRange('8-', 10)).toEqual([7, 8, 9])
    expect(parsePageRange('3;3,2', 10)).toEqual([1, 2])
    expect(parsePageRange('0', 10)).toBeNull()
    expect(parsePageRange('4-2', 10)).toBeNull()
    expect(parsePageRange('12', 10)).toBeNull()
    expect(parsePageRange('a', 10)).toBeNull()
    expect(parsePageRange('', 10)).toBeNull()
  })
})

describe('caviardage', () => {
  it('marquer, appliquer (même longueur, sans suivi), modèles de recherche', async () => {
    const { redactPlugin, markRedaction, pendingRedactions, applyRedactions, findForRedaction, REDACT_PRESETS, unmarkRedaction } = await import('../../src/editor/redact')
    const { trackPlugin } = await import('../../src/editor/track')
    const d = load({ trackChanges: true, blocks: [{ content: [{ text: 'Écrire à ' }, { text: 'lea.martin@exemple.fr', link: 'mailto:lea.martin@exemple.fr' }, { text: ' ou au 06 12 34 56 78, le 12/05/2026.' }] }, 'IBAN FR76 3000 6000 0112 3456 7890 189 ; Léa Martin.'] })
    let state = EditorState.create({ doc: docToPM(d), plugins: [redactPlugin(), trackPlugin({ author: () => 'X' })] })
    const run = (c: (s: EditorState, d?: (tr: import('prosemirror-state').Transaction) => void) => boolean) => c(state, (tr) => (state = state.apply(tr)))
    const q = (text: string) => ({ text, regex: true, caseSensitive: false, wholeWord: false })
    const texts = (rs: { from: number; to: number }[]) => rs.map((r) => state.doc.textBetween(r.from, r.to))
    expect(texts(findForRedaction(state, q(REDACT_PRESETS.email)))).toEqual(['lea.martin@exemple.fr'])
    expect(texts(findForRedaction(state, q(REDACT_PRESETS.phone)))).toEqual(['06 12 34 56 78'])
    expect(texts(findForRedaction(state, q(REDACT_PRESETS.number)))).toEqual(['FR76 3000 6000 0112 3456 7890 189'])
    const name = findForRedaction(state, { text: 'Léa Martin', regex: false, caseSensitive: true, wholeWord: true })
    run(markRedaction([...findForRedaction(state, q(REDACT_PRESETS.email)), ...name]))
    expect(pendingRedactions(state)).toHaveLength(2)
    // les marques suivent la frappe
    state = state.apply(state.tr.insertText('X', 1))
    expect(texts(pendingRedactions(state))).toEqual(['lea.martin@exemple.fr', 'Léa Martin'])
    run(unmarkRedaction(true))
    expect(pendingRedactions(state)).toHaveLength(0)
    run(markRedaction([...findForRedaction(state, q(REDACT_PRESETS.email)), ...findForRedaction(state, { text: 'Léa Martin', regex: false, caseSensitive: true, wholeWord: true })]))
    let n = 0
    run(applyRedactions((k) => (n = k)))
    expect(n).toBe(2)
    const back = pmToDoc(state.doc, { id: 'x', created: '', modified: '' })
    // même longueur, plus de lien, aucune trace suivie de l'ancien texte
    // (le « X » tapé est suivi comme une insertion ; le caviardage, lui, ne laisse aucune suppression suivie)
    expect((back.blocks[0] as { content: unknown[] }).content[1]).toEqual({ text: 'Écrire à █████████████████████ ou au 06 12 34 56 78, le 12/05/2026.' })
    expect(JSON.stringify(back)).not.toContain('"deleted"')
    expect((back.blocks[1] as { content: { text: string }[] }).content[0].text).toBe('IBAN FR76 3000 6000 0112 3456 7890 189 ; ██████████.')
    expect(JSON.stringify(back)).not.toContain('lea.martin')
    expect(pendingRedactions(state)).toHaveLength(0)
  })
})

describe('références : Vancouver, notes Chicago, BibTeX / RIS / CSL-JSON', () => {
  const SOURCES = [
    { id: 'Darwin1859', type: 'book', authors: ['Darwin, Charles'], title: 'On the Origin of Species', publisher: 'John Murray', place: 'London', year: '1859' },
    { id: 'Watson1953', type: 'article', authors: ['Watson, James D.', 'Crick, Francis H. C.'], title: 'Molecular Structure of Nucleic Acids', container: 'Nature', volume: '171', issue: '4356', pages: '737-738', year: '1953', doi: '10.1038/171737a0' },
  ]

  it('Vancouver : numéros, bibliographie', async () => {
    const { citeContext, citationText, bibliographyEntry, piecesText, entryLabel } = await import('../../src/refs/cite')
    const ctx = citeContext(SOURCES as never, ['Watson1953', 'Darwin1859'], 'vancouver', 'en')
    expect(citationText(ctx, ['Watson1953'])).toBe('(1)')
    expect(citationText(ctx, ['Darwin1859', 'Watson1953'], '12')).toBe('(1, 2)')
    expect(citationText(ctx, ['Darwin1859'], '12')).toBe('(2, p. 12)')
    expect(piecesText(bibliographyEntry(ctx, SOURCES[1] as never))).toBe('Watson JD, Crick FHC. Molecular Structure of Nucleic Acids. Nature. 1953;171(4356):737–738. doi:10.1038/171737a0')
    expect(piecesText(bibliographyEntry(ctx, SOURCES[0] as never))).toBe('Darwin C. On the Origin of Species. London: John Murray; 1859.')
    expect(entryLabel(ctx, SOURCES[0] as never)).toBe('2.')
  })

  it('notes Chicago : complète puis abrégée, titres en italique ; bibliographie', async () => {
    const { citeContext, citationText, citePieces, citePlain, bibliographyEntry, piecesText } = await import('../../src/refs/cite')
    const ctx = citeContext(SOURCES as never, [], 'chicago-notes', 'en')
    const first = citationText(ctx, ['Darwin1859'], 'p. 12')
    expect(citePlain(first)).toBe('Charles Darwin, On the Origin of Species (London: John Murray, 1859), 12.')
    expect(citePieces(first).filter((p) => p.italic).map((p) => p.text)).toEqual(['On the Origin of Species'])
    expect(citePlain(citationText(ctx, ['Darwin1859'], '15'))).toBe('Darwin, Origin of Species, 15.')
    expect(citePlain(citationText(ctx, ['Watson1953']))).toBe('James D. Watson and Francis H. C. Crick, “Molecular Structure of Nucleic Acids,” Nature 171, no. 4356 (1953).')
    expect(citePlain(citationText(ctx, ['Watson1953'], '737'))).toBe('Watson and Crick, “Molecular Structure,” 737.')
    expect(piecesText(bibliographyEntry(ctx, SOURCES[0] as never))).toBe('Darwin, Charles. On the Origin of Species. London: John Murray, 1859.')
  })

  it('notes Chicago dans le document : changer de style met les citations en notes (et les en sort), export .docx', async () => {
    const { setCitationStyleCmd, scanRefs } = await import('../../src/editor/refs')
    const d = load({ sources: SOURCES, blocks: [{ content: [{ text: 'Évolution' }, { type: 'cite', ids: ['Darwin1859'], locator: '12' }, { text: ' et ADN' }, { type: 'cite', ids: ['Watson1953'] }, { text: '. Encore' }, { type: 'cite', ids: ['Darwin1859'] }, { text: '.' }] }, { type: 'bibliography', title: 'Bibliography' }] })
    let state = EditorState.create({ doc: docToPM(d) })
    const run = (c: (s: EditorState, d?: (tr: import('prosemirror-state').Transaction) => void) => boolean) => c(state, (tr) => (state = state.apply(tr)))
    run(setCitationStyleCmd('chicago-notes'))
    const folio = pmToDoc(state.doc, { id: 'x', created: '', modified: '' })
    expect(folio.citationStyle).toBe('chicago-notes')
    const inl = (folio.blocks[0] as { content: { type?: string; blocks?: unknown }[] }).content
    expect(inl.filter((x) => x.type === 'note')).toHaveLength(3)
    expect(inl.some((x) => x.type === 'cite')).toBe(false)
    // le calcul des références voit les citations des notes, dans l'ordre
    const data = scanRefs(state.doc, { pageOf: () => null, lang: () => 'en', labels: () => ({}) as never })
    expect(data.cited).toEqual(['Darwin1859', 'Watson1953', 'Darwin1859'])
    const texts = [...data.noteCites.values()].flat().map((x) => x.replace(/[\u0001\u0002]/g, ''))
    // (document en français : « et », « n° », espace avant les deux-points)
    expect(texts).toEqual(['Charles Darwin, On the Origin of Species (London : John Murray, 1859), 12.', 'James D. Watson et Francis H. C. Crick, “Molecular Structure of Nucleic Acids,” Nature 171, n° 4356 (1953).', 'Darwin, Origin of Species.'])
    // export .docx : de vraies notes de bas de page, avec un champ CITATION et le titre en italique
    const out = await exportDocx(folio, { now: new Date(NOW) })
    const p = parts(out.bytes)
    expect(p['word/footnotes.xml']).toContain('CITATION Darwin1859')
    expect(p['word/footnotes.xml']).toMatch(/<w:i\/>[\s\S]*?On the Origin of Species/)
    const back = open(out.bytes).doc
    expect(back.citationStyle).toBe('chicago-notes')
    // revenir à un style auteur-date : les notes qui ne sont qu'une citation redeviennent des citations
    run(setCitationStyleCmd('apa'))
    const again = pmToDoc(state.doc, { id: 'x', created: '', modified: '' })
    expect((again.blocks[0] as { content: { type?: string }[] }).content.filter((x) => x.type === 'cite')).toHaveLength(3)
    expect((again.blocks[0] as { content: { type?: string }[] }).content.filter((x) => x.type === 'note')).toHaveLength(0)
  })

  it('BibTeX, RIS, CSL-JSON : lecture tolérante et aller-retour', async () => {
    const { parseBibtex, toBibtex, parseRis, toRis, parseCslJson, toCslJson, parseSources, normalizeName } = await import('../../src/refs/formats')
    expect(normalizeName('Ludwig van Beethoven')).toBe('van Beethoven, Ludwig')
    expect(normalizeName('{World Health Organization}')).toBe('World Health Organization')
    const bib = String.raw`@string{nat = "Nature"}
@comment{ignoré}
@article{watson53,
  author = {Watson, J. D. and Francis H. C. Crick},
  title = {Molecular structure of nucleic acids: a structure for {D}eoxyribose nucleic acid},
  journal = nat,
  year = 1953, volume = {171}, number = {4356}, pages = {737--738},
  doi = {https://doi.org/10.1038/171737a0}
}
@book{camus, author = {Albert Camus}, title = {L'{\'E}tranger}, publisher = {Gallimard}, address = {Paris}, year = {1942}}
@book{broken, title = }`
    const parsed = parseBibtex(bib)
    expect(parsed.map((s) => s.id)).toEqual(['watson53', 'camus'])
    expect(parsed[0]).toMatchObject({ type: 'article', authors: ['Watson, J. D.', 'Crick, Francis H. C.'], container: 'Nature', year: '1953', pages: '737-738', doi: '10.1038/171737a0' })
    expect(parsed[1]).toMatchObject({ title: 'L’Étranger'.replace('’', "'"), authors: ['Camus, Albert'], place: 'Paris' })
    expect(parseBibtex(toBibtex(parsed))).toEqual(parsed)
    const ris = 'TY  - JOUR\nAU  - Watson, J. D.\nTI  - Molecular structure\nJO  - Nature\nPY  - 1953/04/25/\nSP  - 737\nEP  - 738\nER  - \nTY  - BOOK\nAU  - Camus, Albert\nTI  - La Peste\nPB  - Gallimard\nPY  - 1947\nER  - \n'
    const r = parseRis(ris)
    expect(r.map((s) => [s.type, s.title, s.year, s.pages ?? ''])).toEqual([['article', 'Molecular structure', '1953', '737-738'], ['book', 'La Peste', '1947', '']])
    expect(parseRis(toRis(r)).map(({ id: _i, ...x }) => x)).toEqual(r.map(({ id: _i, ...x }) => x))
    const csl = JSON.stringify([{ id: 'doe', type: 'webpage', title: 'Page', author: [{ family: 'Doe', given: 'Jane' }, { literal: 'ACME' }], issued: { 'date-parts': [[2020, 5]] }, URL: 'https://example.org', accessed: { 'date-parts': [[2024, 1, 2]] } }])
    const c = parseCslJson(csl)
    expect(c[0]).toEqual({ id: 'doe', type: 'website', authors: ['Doe, Jane', 'ACME'], title: 'Page', year: '2020-05', url: 'https://example.org', accessed: '2024-01-02' })
    expect(parseCslJson(toCslJson(c))).toEqual(c)
    // détection, identifiants déjà pris
    expect(parseSources(bib, ['watson53']).sources.map((s) => s.id)).toEqual(['watson53a', 'camus'])
    expect(parseSources(ris).format).toBe('ris')
    expect(parseSources('du texte').sources).toEqual([])
  })
})

describe('formulaires', () => {
  const FORM = {
    formsOnly: true,
    blocks: [
      { content: ['Nom : ', { type: 'formfield', kind: 'text', name: 'Nom', placeholder: 'Votre nom' }] },
      { content: ['Pays : ', { type: 'dropdown', name: 'Pays', options: ['France', 'Belgique', 'France'], value: 'Belgique' }] },
      { content: ['Né le ', { type: 'date', name: 'Naissance', value: '1990-04-02' }, ' — accord ', { type: 'checkbox', name: 'Accord', checked: true }] },
      { content: [{ type: 'formfield', kind: 'dropdown', options: ['a'], value: 'pas dans la liste' }, { type: 'formfield', kind: 'date', value: 'hier' }] },
    ],
  }

  const PLAIN = {
    formsOnly: true,
    blocks: [
      { content: ['Nom : ', { type: 'formfield', kind: 'text', name: 'Nom', placeholder: 'Votre nom' }] },
      { content: ['Pays : ', { type: 'formfield', kind: 'dropdown', name: 'Pays', options: ['France', 'Belgique'], value: 'Belgique' }] },
      { content: ['Né le ', { type: 'formfield', kind: 'date', name: 'Naissance', value: '1990-04-02' }, ' — accord ', { type: 'formfield', kind: 'checkbox', name: 'Accord', checked: true }] },
    ],
  }

  it('format : alias, valeurs bornées, aller-retour par l’éditeur', () => {
    const r = loadDocument({ format: 'folio/doc', version: 1, meta: { title: 'E', lang: 'fr' }, ...FORM }, { now: NOW })
    if (!r.ok) throw new Error('refusé')
    const d = r.doc
    expect(d.formsOnly).toBe(true)
    const inl = (i: number) => (d.blocks[i] as { content: unknown[] }).content
    expect(inl(0)[1]).toEqual({ type: 'formfield', kind: 'text', name: 'Nom', placeholder: 'Votre nom' })
    expect(inl(1)[1]).toEqual({ type: 'formfield', kind: 'dropdown', name: 'Pays', options: ['France', 'Belgique'], value: 'Belgique' })
    expect(inl(2)[1]).toEqual({ type: 'formfield', kind: 'date', name: 'Naissance', value: '1990-04-02' })
    expect(inl(2)[3]).toEqual({ type: 'formfield', kind: 'checkbox', name: 'Accord', checked: true })
    expect(inl(3)).toEqual([{ type: 'formfield', kind: 'dropdown', options: ['a'] }, { type: 'formfield', kind: 'date' }])
    expect(viaEditor(d)).toMatchObject({ formsOnly: true, blocks: d.blocks })
    expect(toPlainText(d)).toContain('Né le 1990-04-02 — accord ☒')
  })

  it('verrou : seul le remplissage des champs passe ; vider le formulaire', async () => {
    const { formsOnlyPlugin, FORM_FILL, clearForm, setFormsOnly } = await import('../../src/editor/forms')
    let state = EditorState.create({ doc: docToPM(load(PLAIN)), plugins: [formsOnlyPlugin()] })
    const apply = (tr: import('prosemirror-state').Transaction) => (state = state.apply(tr))
    const before = state.doc
    apply(state.tr.insertText('X', 1))
    expect(state.doc.eq(before)).toBe(true)
    let pos = -1
    state.doc.descendants((n, p) => {
      if (n.type === schema.nodes.formfield && pos < 0) pos = p
    })
    apply(state.tr.setNodeMarkup(pos, null, { ...state.doc.nodeAt(pos)!.attrs, value: 'Léa' }).setMeta(FORM_FILL, true))
    expect(state.doc.nodeAt(pos)!.attrs.value).toBe('Léa')
    clearForm(state, apply)
    expect(state.doc.nodeAt(pos)!.attrs.value).toBe('')
    setFormsOnly(false)(state, apply)
    apply(state.tr.insertText('X', 1))
    expect(state.doc.textContent.startsWith('X')).toBe(true)
  })

  it('.docx : contrôles de contenu Word (texte, liste, date, case) et protection « formulaires », relus', async () => {
    const d = load(PLAIN)
    const out = await exportDocx(d, { now: new Date(NOW) })
    const p = parts(out.bytes)
    const doc = p['word/document.xml']
    expect(doc).toContain('<w:alias w:val="Nom"/><w:tag w:val="folio-form:text"/><w:showingPlcHdr/><w:text/>')
    expect(doc).toContain('<w:listItem w:displayText="Belgique" w:value="Belgique"/>')
    expect(doc).toContain('w:fullDate="1990-04-02T00:00:00Z"')
    expect(doc).toContain('<w14:checked w14:val="1"/>')
    expect(p['word/settings.xml']).toContain('<w:documentProtection w:edit="forms" w:enforcement="1"/>')
    const back = open(out.bytes).doc
    expect(back.formsOnly).toBe(true)
    expect(back.blocks.map((b) => (b as { content: unknown[] }).content.filter((x) => (x as { type?: string }).type === 'formfield'))).toEqual(d.blocks.map((b) => (b as { content: unknown[] }).content.filter((x) => (x as { type?: string }).type === 'formfield')))
  })
})

describe('dessin à main levée', () => {
  const PNG1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR42mP8z8Dwn4EIwDiqEAD6/QX9zp5mQwAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
  const INKED = {
    blocks: [
      { text: 'Paragraphe annoté.', ink: [{ tool: 'pen', color: '#dc2626', width: 2, points: [0, 0, 10.04, 5, 20, 0, 3] }, { tool: 'highlighter', color: '#facc15', width: 10, points: [0, 8, 80, 8] }] },
      { type: 'list', items: [{ text: 'élément', ink: [{ points: [1, 1, 5, 5] }] }] },
    ],
  }

  it('format : traits nettoyés (points pairs, arrondis), aller-retour, simplification, gomme', async () => {
    const { simplify, distanceToStroke, inkBounds } = await import('../../src/format/ink')
    const d = load(INKED)
    const p = d.blocks[0] as { ink: { points: number[]; tool: string }[] }
    expect(p.ink[0].points).toEqual([0, 0, 10, 5, 20, 0])
    expect(p.ink[1].tool).toBe('highlighter')
    expect((d.blocks[1] as { items: { ink?: unknown[] }[] }).items[0].ink).toEqual([{ tool: 'pen', color: '#1f2937', width: 2, points: [1, 1, 5, 5] }])
    expect(viaEditor(d).blocks).toEqual(d.blocks)
    // une droite pleine de points : deux points suffisent
    expect(simplify([0, 0, 1, 1, 2, 2, 3, 3, 4, 4])).toEqual([0, 0, 4, 4])
    expect(simplify([0, 0, 5, 5, 10, 0], 0.5)).toEqual([0, 0, 5, 5, 10, 0])
    expect(distanceToStroke(p.ink[0] as never, 10, 7)).toBeCloseTo(2, 0)
    expect(inkBounds(p.ink as never)).toMatchObject({ x: -5, y: -1 })
  })

  it('exports : page web (SVG), .odt (chemins vectoriels), .docx (image flottante relue en traits)', async () => {
    const d = load(INKED)
    const html = toHtml(d)
    expect(html).toContain('<p style="position:relative"><svg xmlns="http://www.w3.org/2000/svg" class="ink"')
    expect(html).toContain('stroke="#dc2626"')
    const odt = strFromU8(unzipSync((await exportOdt(d)).bytes)['content.xml'])
    expect(odt).toContain('<draw:path draw:style-name="gr')
    expect(odt).toContain('svg:stroke-color="#facc15" svg:stroke-width="10pt" svg:stroke-opacity="35%"')
    // sans conversion en image : signalé
    const lost = await exportDocx(d, { now: new Date(NOW) })
    expect(lost.losses.find((l) => l.code === 'ink')?.count).toBe(2)
    const out = await exportDocx(d, { now: new Date(NOW), rasterize: async () => PNG1 })
    const doc = parts(out.bytes)['word/document.xml']
    expect(doc).toContain('<wp:anchor')
    expect(doc).toContain('descr="folio-ink:')
    const back = open(out.bytes).doc
    expect((back.blocks[0] as { ink?: unknown }).ink).toEqual((d.blocks[0] as { ink?: unknown }).ink)
    expect((back.blocks[1] as { items: { ink?: unknown }[] }).items[0].ink).toEqual((d.blocks[1] as { items: { ink?: unknown }[] }).items[0].ink)
  })
})

describe('ouvrir .odt et .rtf', () => {
  it('.odt : notre propre export se relit (titres, listes à cocher, tableau, encadré, note, commentaire, lien, formule)', async () => {
    const { importOdt } = await import('../../src/file/odt-import')
    const d = load({
      meta: { title: 'Aller-retour', author: 'Ana' },
      comments: [{ id: 'k1', author: 'Léa', date: '2026-01-02T00:00:00.000Z', text: 'À revoir', resolved: false, replies: [] }],
      blocks: [
        { type: 'heading', level: 2, text: 'Partie' },
        { content: [{ text: 'Du ' }, { text: 'gras', bold: true }, { text: ', un ' }, { text: 'lien', link: 'https://example.org' }, { text: ' et ' }, { text: 'commenté', comments: ['k1'] }, { type: 'note', text: 'Une note.' }, { text: ' ; ' }, { type: 'math', tex: 'E=mc^2' }] },
        { type: 'list', style: 'check', items: [{ text: 'fait', checked: true }, 'à faire'] },
        { type: 'table', rows: [['a', 'b'], ['c', 'd']] },
        { type: 'callout', kind: 'tip', title: 'À savoir', text: 'Dedans.' },
      ],
    })
    const odt = await exportOdt(d)
    const r = importOdt(odt.bytes)
    const back = loadDocument(r.doc, { now: NOW })
    if (!back.ok) throw new Error('refusé')
    const b = back.doc.blocks
    expect(back.doc.meta).toMatchObject({ title: 'Aller-retour', author: 'Ana' })
    expect(b.map((x) => x.type)).toEqual(['heading', 'paragraph', 'list', 'table', 'callout'])
    expect(b[0]).toMatchObject({ level: 2, content: [{ text: 'Partie' }] })
    const p = (b[1] as unknown as { content: Record<string, unknown>[] }).content
    expect(p.find((x) => x.text === 'gras')).toMatchObject({ bold: true })
    expect(p.find((x) => x.text === 'lien')).toMatchObject({ link: 'https://example.org' })
    expect(p.find((x) => x.text === 'commenté')?.comments).toHaveLength(1)
    expect(p.find((x) => x.type === 'note')).toMatchObject({ kind: 'foot' })
    expect(p.find((x) => x.type === 'math')).toEqual({ type: 'math', tex: 'E=mc^2' })
    expect(back.doc.comments[0]).toMatchObject({ author: 'Léa', text: 'À revoir' })
    expect(b[2]).toMatchObject({ style: 'check', items: [{ checked: true, content: [{ text: 'fait' }] }, { content: [{ text: 'à faire' }] }] })
    expect((b[3] as { rows: unknown[][] }).rows).toHaveLength(2)
    expect(b[4]).toMatchObject({ type: 'callout', kind: 'tip', title: 'À savoir' })
  })

  it('fichiers de LibreOffice (.odt et .rtf) : le même texte que le .docx d’origine', async () => {
    const { readFileSync } = await import('node:fs')
    const { importOdt } = await import('../../src/file/odt-import')
    const { importRtf } = await import('../../src/file/rtf-import')
    const { allText } = await import('./docx-helpers')
    for (const f of ['rapport', 'lettre']) {
      const docx = open(new Uint8Array(readFileSync(`tests/fixtures/docx/${f}.docx`))).doc
      const odt = loadDocument(importOdt(new Uint8Array(readFileSync(`tests/fixtures/odt/${f}.odt`))).doc, { now: NOW })
      const rtf = loadDocument(importRtf(readFileSync(`tests/fixtures/rtf/${f}.rtf`, 'latin1')).doc, { now: NOW })
      if (!odt.ok || !rtf.ok) throw new Error('refusé')
      expect(odt.doc.meta.title).toBe(docx.meta.title)
      expect(rtf.doc.meta.title).toBe(docx.meta.title)
      // (le .docx a des champs de date : on compare à partir du premier mot qui les suit)
      const tail = (s: string) => s.replace(/\s+/g, '').slice(40, 400)
      if (f === 'rapport') {
        expect(tail(allText(odt.doc))).toBe(tail(allText(docx)))
        expect(tail(allText(rtf.doc))).toBe(tail(allText(docx)))
      }
      for (const d of [odt.doc, rtf.doc]) {
        expect(d.blocks.filter((b) => b.type === 'table').length).toBe(docx.blocks.filter((b) => b.type === 'table').length)
        expect(d.blocks.filter((b) => b.type === 'image').length).toBe(docx.blocks.filter((b) => b.type === 'image').length)
      }
      expect(odt.doc.blocks.filter((b) => b.type === 'heading').length).toBeGreaterThan(0)
    }
  })

  it('.rtf : mise en forme, couleurs, styles de titre, listes, tableau, note, lien, Unicode', async () => {
    const { importRtf } = await import('../../src/file/rtf-import')
    const rtf = String.raw`{\rtf1\ansi\ansicpg1252\uc1\deff0{\fonttbl{\f0\froman Times New Roman;}{\f1\fswiss Inter;}}{\colortbl;\red220\green38\blue38;\red255\green255\blue0;}
{\stylesheet{\s0 Normal;}{\s1 heading 1;}}{\info{\title Essai RTF}{\author L\'e9a}}
{\pard\s1 Titre principal\par}
{\pard\qc Du {\b gras}, de l'{\i italique}, {\cf1 rouge}, {\highlight2 surlign\'e9}, {\f1\fs32 Inter 16}, H{\sub 2}O, x{\super 2}, ${'\\u8364?'} et caf\'e9.\par}
{\pard \'95\tab premier\par \'95\tab second\par}
{\pard\intbl a\cell b\cell\row\pard\intbl c\cell d\cell\row}
{\pard Voir {\field{\*\fldinst HYPERLINK "https://example.org"}{\fldrslt le site}}{\footnote\pard Une note.}.\par}
}`
    const r = loadDocument(importRtf(rtf).doc, { now: NOW })
    if (!r.ok) throw new Error('refusé')
    const b = r.doc.blocks
    expect(r.doc.meta).toMatchObject({ title: 'Essai RTF', author: 'Léa' })
    expect(b.map((x) => x.type)).toEqual(['heading', 'paragraph', 'list', 'table', 'paragraph'])
    const p = b[1] as unknown as { content: Record<string, unknown>[]; align?: string }
    expect(p.align).toBe('center')
    expect(p.content.find((x) => x.text === 'gras')).toMatchObject({ bold: true })
    expect(p.content.find((x) => x.text === 'rouge')).toMatchObject({ color: '#dc2626' })
    expect(p.content.find((x) => x.text === 'surligné')).toMatchObject({ highlight: '#ffff00' })
    expect(p.content.find((x) => x.text === 'Inter 16')).toMatchObject({ font: 'Inter', size: 16 })
    expect(p.content.find((x) => x.text === '2' && x.sub)).toBeTruthy()
    expect(p.content.map((x) => x.text).join('')).toContain('€ et café.')
    expect((b[2] as { items: unknown[] }).items).toHaveLength(2)
    expect((b[3] as { rows: unknown[][] }).rows).toHaveLength(2)
    const last = (b[4] as unknown as { content: Record<string, unknown>[] }).content
    expect(last.find((x) => x.text === 'le site')).toMatchObject({ link: 'https://example.org' })
    expect(last.find((x) => x.type === 'note')).toMatchObject({ kind: 'foot' })
    expect(() => importRtf('pas du RTF')).toThrow()
  })
})

describe('écriture PDF', () => {
  it('codage WinAnsi / Symbol, structure valide (xref), texte lisible par pdftotext', async () => {
    const { PdfWriter, encodeRuns, runWidth } = await import('../../src/export/pdf')
    const { execFileSync } = await import('node:child_process')
    const { writeFileSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    expect(encodeRuns('Été €', 'Helvetica')).toEqual([{ font: 'Helvetica', codes: [0xc9, 0x74, 0xe9, 0x20, 0x80] }])
    expect(encodeRuns('a≤π', 'Times-Roman').map((r) => r.font)).toEqual(['Times-Roman', 'Symbol'])
    expect(encodeRuns('中', 'Helvetica')[0].codes).toEqual([63])
    // Helvetica « a » : 556 millièmes
    expect(runWidth('Helvetica', [0x61], 10)).toBeCloseTo(5.56, 2)
    const pdf = new PdfWriter()
    const p1 = pdf.addPage(595.28, 841.89)
    p1.text('Bonjour, café (et parenthèses) \\ 100 €', 72, 100, 12, 'Helvetica', [0, 0, 0])
    p1.text('α ≤ β', 72, 130, 12, 'Times-Roman', [200, 0, 0])
    p1.fillRect(72, 150, 100, 20, [255, 240, 200])
    p1.link(72, 90, 100, 14, 'https://example.org/é')
    const id = pdf.addImage({ rgb: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]), alpha: new Uint8Array([255, 128, 255, 0]), width: 2, height: 2 })
    p1.image(id, 72, 200, 20, 20)
    const p2 = pdf.addPage(612, 792)
    p2.text('Page deux', 72, 72, 12, 'Times-Bold', [0, 0, 0])
    pdf.bookmark('Début', 0, 80, 1)
    pdf.bookmark('Suite', 1, 60, 2)
    const bytes = pdf.output({ title: 'Essai é', author: 'Léa' })
    const raw = new TextDecoder('latin1').decode(bytes)
    // chaque entrée de la table xref pointe sur « n 0 obj »
    const xref = /xref\n0 (\d+)\n0000000000 65535 f \n((?:\d{10} 00000 n \n)+)/.exec(raw)!
    xref[2].trim().split('\n').forEach((line, i) => expect(raw.slice(Number(line.slice(0, 10)), Number(line.slice(0, 10)) + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)))
    expect(raw).toMatch(/startxref\n(\d+)\n%%EOF\n$/)
    expect(Number(/startxref\n(\d+)/.exec(raw)![1])).toBe(raw.indexOf('xref\n0 '))
    expect(raw).toContain('/URI (https://example.org/%C3%A9)')
    const dir = mkdtempSync(`${tmpdir()}/folio-pdf-`)
    writeFileSync(`${dir}/t.pdf`, bytes)
    const text = execFileSync('pdftotext', [`${dir}/t.pdf`, '-'], { encoding: 'utf8' })
    expect(text).toContain('Bonjour, café (et parenthèses) \\ 100 €')
    for (const ch of ['α', '≤', 'β']) expect(text).toContain(ch)
    expect(text).toContain('Page deux')
    const info = execFileSync('pdfinfo', [`${dir}/t.pdf`], { encoding: 'utf8' })
    expect(info).toMatch(/Title:\s+Essai é/)
    expect(info).toMatch(/Pages:\s+2/)
  })
})
