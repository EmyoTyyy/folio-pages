// Références : format (validation, aller-retour éditeur et forme compacte),
// calculs (numéros de légende, renvois, index, citations), styles de citation,
// recherche de notices (DOI, ISBN).

import { describe, expect, it } from 'vitest'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { toCompact } from '../../src/format/compact'
import { loadDocument } from '../../src/format/load'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { insertCaption, scanRefs, pageList, letterOf, ensureBookmark } from '../../src/editor/refs'
import { schema } from '../../src/editor/schema'
import type { FolioDoc, Source } from '../../src/format/types'
import { bibliographyEntry, bibliographyOrder, citationText, citeContext, initials, parseName, piecesText } from '../../src/refs/cite'
import { fromCrossref, fromOpenLibrary, invertName, parseIdentifier, suggestId } from '../../src/refs/lookup'

const NOW = '2026-01-01T00:00:00.000Z'
function load(v: Record<string, unknown>) {
  const r = loadDocument({ format: 'folio/doc', version: 1, ...v }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  return r
}
const identity = (d: FolioDoc) => ({ id: d.id, created: d.meta.created, modified: d.meta.modified })
const throughEditor = (d: FolioDoc) => pmToDoc(docToPM(d), identity(d))

const SOURCES: Source[] = [
  { id: 'Darwin1859', type: 'book', authors: ['Darwin, Charles'], title: 'On the Origin of Species', publisher: 'John Murray', place: 'London', year: '1859' },
  { id: 'Watson1953', type: 'article', authors: ['Watson, James D.', 'Crick, Francis H. C.'], title: 'Molecular structure of nucleic acids', container: 'Nature', volume: '171', issue: '4356', pages: '737-738', year: '1953', doi: '10.1038/171737a0' },
  { id: 'OMS2020', type: 'report', authors: ['Organisation mondiale de la santé'], title: 'Rapport sur la santé dans le monde', year: '2020', publisher: 'OMS', place: 'Genève' },
  { id: 'Ada', type: 'website', authors: ['Lovelace, Ada', 'Babbage, Charles', 'Menabrea, Luigi'], title: 'Notes', container: 'Archive', year: '1843', url: 'https://exemple.org/notes', accessed: '2026-02-03' },
]

const RICH = {
  meta: { lang: 'fr' },
  sources: SOURCES,
  citationStyle: 'apa',
  blocks: [
    { type: 'heading', level: 1, content: [{ type: 'bookmark', name: 'intro' }, 'Introduction'] },
    { content: ['Voir ', { type: 'xref', target: 'fig_port', show: 'label' }, ' page ', { type: 'xref', target: 'fig_port', show: 'page' }, ' et ', { type: 'xref', target: 'intro', show: 'text' }, ', ', { type: 'xref', target: 'fig_port', show: 'above' }, '.'] },
    { content: ['Selon Darwin ', { type: 'cite', ids: ['Darwin1859'], locator: '12' }, ' et ', { type: 'cite', id: 'Watson1953' }, '.', { type: 'xe', term: 'évolution' }, { type: 'xe', term: 'ADN', sub: 'structure', bold: true }] },
    { type: 'image', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', width: 100, caption: ['Figure ', { type: 'seq', label: 'figure' }, ' : Le port'] },
    { type: 'paragraph', style: 'caption', content: [{ type: 'bookmark', name: 'fig_port' }, 'Figure ', { type: 'seq', label: 'figure' }, ' : Les quais'] },
    { type: 'paragraph', style: 'caption', content: ['Tableau ', { type: 'seq', label: 'table' }, ' : Mesures'] },
    { content: ['Arrêt ', { type: 'xe', term: 'Cass. civ. 1re, 3 mai 2000', authority: 'cases', short: 'Cass. 2000' }, { type: 'xe', term: 'Zèbre' }, { type: 'xe', term: 'arbre', see: 'forêt' }] },
    { type: 'figures', title: 'Illustrations' },
    { type: 'figures', label: 'table' },
    { type: 'index', columns: 1, title: 'Index' },
    { type: 'authorities', category: 'cases' },
    { type: 'bibliography', title: 'Références' },
    { type: 'section', page: { size: 'A4', orientation: 'landscape', margins: { top: 20, right: 20, bottom: 20, left: 20 } } },
    { type: 'table', repeatHeader: true, rows: [['A', 'B'], ['1', '2']] },
  ],
}

describe('format des références', () => {
  it('se charge sans perte, passe par l’éditeur et la forme compacte à l’identique', () => {
    const r = load(RICH)
    expect(r.report.issues).toEqual([])
    const doc = r.doc
    expect(doc.sources).toHaveLength(4)
    expect(doc.citationStyle).toBeUndefined() // « apa » est la valeur par défaut
    const p = doc.blocks[2]
    expect(p.type === 'paragraph' && p.content[1]).toEqual({ type: 'cite', ids: ['Darwin1859'], locator: '12' })
    expect(p.type === 'paragraph' && p.content[3]).toEqual({ type: 'cite', ids: ['Watson1953'] })
    const back = throughEditor(doc)
    expect(back.blocks).toEqual(doc.blocks)
    expect(back.sources).toEqual(doc.sources)
    const again = load(JSON.parse(JSON.stringify(toCompact(back))))
    expect(again.report.issues).toEqual([])
    expect(again.doc.blocks).toEqual(doc.blocks)
    expect(again.doc.sources).toEqual(doc.sources)
    const sec = again.doc.blocks.find((b) => b.type === 'section')
    expect(sec).toMatchObject({ page: { size: 'A4', width: 210, height: 297, orientation: 'landscape', margins: { top: 20, right: 20, bottom: 20, left: 20 } } })
    expect(again.doc.blocks.find((b) => b.type === 'table')).toMatchObject({ repeatHeader: true })
  })

  it('validation tolérante : source inconnue, signet en double, noms invalides, sources en double', () => {
    const r = load({
      sources: [SOURCES[0], { ...SOURCES[0], title: 'double' }, { id: 'pas bon', title: 'x' }],
      blocks: [
        { content: [{ type: 'cite', ids: ['Darwin1859', 'Inconnu'] }, { type: 'cite', id: 'Absent' }, { type: 'bookmark', name: 'a' }, { type: 'bookmark', name: 'a' }, { type: 'bookmark', name: '1abc' }, { type: 'xe', term: '  ' }] },
        { type: 'index', columns: 9 },
      ],
    })
    const codes = r.report.issues.map((i) => i.code)
    expect(codes).toContain('source-unknown')
    expect(codes).toContain('source-duplicate')
    expect(codes).toContain('bookmark-duplicate')
    expect(r.doc.sources?.map((s) => s.id)).toEqual(['Darwin1859'])
    const p = r.doc.blocks[0]
    expect(p.type === 'paragraph' && p.content).toEqual([{ type: 'cite', ids: ['Darwin1859'] }, { type: 'bookmark', name: 'a' }])
    expect(r.doc.blocks[1]).toEqual({ type: 'index', columns: 3, title: '' })
  })

  it('alias tolérés pour une IA : citation, crossref, tableofauthorities, references', () => {
    const r = load({ sources: [SOURCES[0]], blocks: [{ content: [{ type: 'citation', id: 'Darwin1859' }, { type: 'crossref', target: 'x', show: 'pagenumber' }, { type: 'bookmark', name: 'x' }] }, { type: 'references' }, { type: 'list-of-figures' }] })
    const p = r.doc.blocks[0]
    expect(p.type === 'paragraph' && p.content.map((x) => ('type' in x ? x.type : 'text'))).toEqual(['cite', 'xref', 'bookmark'])
    expect(r.doc.blocks.slice(1).map((b) => b.type)).toEqual(['bibliography', 'figures'])
  })
})

describe('calcul des références', () => {
  const pm = docToPM(load(RICH).doc)
  const labels = {
    missingBookmark: 'Erreur ! Signet non défini.',
    above: 'ci-dessus',
    below: 'ci-dessous',
    emptyFigures: '',
    emptyIndex: '',
    emptyAuthorities: '',
    emptyBibliography: '',
    emptyGlossary: 'g',
    emptyAbbreviations: 'a',
    see: 'Voir',
    passim: 'passim',
    category: (c: string) => c,
  }
  // Une « page » toutes les 40 positions.
  const pageOf = (pos: number) => ({ index: Math.floor(pos / 40), label: String(Math.floor(pos / 40) + 1) })
  const data = scanRefs(pm, { pageOf, lang: () => 'fr', labels: () => labels })

  it('numéros de légende par étiquette, dans l’ordre du document (images comprises)', () => {
    expect(data.captions.map((c) => [c.label, c.number, c.text])).toEqual([
      ['figure', 1, 'Figure 1 : Le port'],
      ['figure', 2, 'Figure 2 : Les quais'],
      ['table', 1, 'Tableau 1 : Mesures'],
    ])
  })

  it('renvois : étiquette et numéro, page, texte, ci-dessous ; signet manquant', () => {
    const values = [...data.texts.values()]
    expect(values.slice(0, 4)).toEqual(['Figure 2', String(pageOf(data.bookmarks.get('fig_port')!).label), 'Introduction', 'ci-dessous'])
    const broken = docToPM(load({ blocks: [{ content: [{ type: 'xref', target: 'nulle_part' }] }] }).doc)
    expect([...scanRefs(broken, { pageOf, lang: () => 'fr', labels: () => labels }).texts.values()]).toEqual(['Erreur ! Signet non défini.'])
  })

  it('citations au style du document', () => {
    expect([...data.texts.values()].slice(4)).toEqual(['(Darwin, 1859, p. 12)', '(Watson & Crick, 1953)'])
    expect(data.cited).toEqual(['Darwin1859', 'Watson1953'])
  })

  it('index : tri sans tenir compte des accents ni de la casse, sous-entrées, renvois « Voir », lettres', () => {
    expect(data.index.map((e) => e.term)).toEqual(['ADN', 'arbre', 'évolution', 'Zèbre'])
    expect(data.index[0].subs[0]).toMatchObject({ sub: 'structure' })
    expect(data.index[0].subs[0].pages[0].bold).toBe(true)
    expect(data.index[1].see).toBe('forêt')
    expect(data.index.map((e) => letterOf(e.term))).toEqual(['A', 'A', 'E', 'Z'])
    expect(data.authorities).toEqual([expect.objectContaining({ category: 'cases', term: 'Cass. civ. 1re, 3 mai 2000' })])
    expect(pageList([{ pos: 90, page: { index: 2, label: '3' }, bold: false, italic: false }, { pos: 10, page: { index: 0, label: '1' }, bold: true, italic: false }, { pos: 95, page: { index: 2, label: '3' }, bold: false, italic: true }])).toEqual([
      { label: '1', bold: true, italic: false, pos: 10, index: 0 },
      { label: '3', bold: false, italic: true, pos: 90, index: 2 },
    ])
  })

  it('insérer une légende : sous une image (numéro devant la légende existante), sous un tableau, au curseur', () => {
    const doc = docToPM(load({ blocks: [{ type: 'image', src: 'https://exemple.org/a.png', caption: 'Un chat' }, { type: 'table', rows: [['a']] }, 'x'] }).doc)
    let state = EditorState.create({ schema, doc })
    // L'image est sélectionnée.
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)))
    insertCaption({ label: 'figure', word: 'Figure', text: '', sep: ' : ', position: 'below' })(state, (tr) => (state = state.apply(tr)))
    const back = pmToDoc(state.doc, { id: 'x'.repeat(8), created: '', modified: '' })
    expect(back.blocks[0]).toMatchObject({ type: 'image', caption: [{ text: 'Figure ' }, { type: 'seq', label: 'figure' }, { text: ' : Un chat' }] })
    // Tableau : le curseur dans une cellule, légende au-dessus.
    let cell = -1
    state.doc.descendants((nd, pos) => {
      if (cell < 0 && nd.type.name === 'paragraph' && state.doc.resolve(pos).depth > 0 && state.doc.resolve(pos).node(1).type.name === 'table') cell = pos + 1
      return true
    })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, cell)))
    insertCaption({ label: 'table', word: 'Tableau', text: 'Mesures', sep: ' : ', position: 'above' })(state, (tr) => (state = state.apply(tr)))
    const b2 = pmToDoc(state.doc, { id: 'x'.repeat(8), created: '', modified: '' }).blocks
    expect(b2[1]).toEqual({ type: 'paragraph', style: 'caption', content: [{ text: 'Tableau ' }, { type: 'seq', label: 'table' }, { text: ' : Mesures' }] })
    expect(b2[2].type).toBe('table')
  })

  it('un signet caché est ajouté une seule fois au paragraphe visé', () => {
    const doc = docToPM(load({ blocks: [{ type: 'heading', content: ['Titre'] }] }).doc)
    const state = EditorState.create({ schema, doc })
    const a = ensureBookmark(state, 0)
    expect(a.name).toMatch(/^_Ref\d{9}$/)
    const s2 = state.apply(a.tr!)
    expect(ensureBookmark(s2, 0)).toEqual({ name: a.name, tr: null })
  })
})

describe('styles de citation', () => {
  const ctx = (style: Parameters<typeof citeContext>[2], lang = 'en') => citeContext(SOURCES, ['Watson1953', 'Darwin1859'], style, lang)
  const bib = (style: Parameters<typeof citeContext>[2], id: string, lang = 'en') => piecesText(bibliographyEntry(ctx(style, lang), SOURCES.find((s) => s.id === id)!))

  it('noms et initiales', () => {
    expect(parseName('Crick, Francis H. C.')).toEqual({ last: 'Crick', first: 'Francis H. C.', literal: false })
    expect(parseName('OMS')).toEqual({ last: 'OMS', first: '', literal: true })
    expect(initials('Jean-Paul Marie')).toBe('J.-P. M.')
  })

  it('citations dans le texte', () => {
    expect(citationText(ctx('apa'), ['Darwin1859'], '12')).toBe('(Darwin, 1859, p. 12)')
    expect(citationText(ctx('apa'), ['Ada'])).toBe('(Lovelace et al., 1843)')
    expect(citationText(ctx('mla'), ['Watson1953'], 'p. 737')).toBe('(Watson and Crick 737)')
    expect(citationText(ctx('chicago'), ['Darwin1859', 'Watson1953'])).toBe('(Darwin 1859; Watson and Crick 1953)')
    expect(citationText(ctx('harvard'), ['OMS2020'])).toBe('(Organisation mondiale de la santé, 2020)')
    expect(citationText(ctx('ieee'), ['Darwin1859'], '5')).toBe('[2, p. 5]')
    expect(citationText(ctx('ieee'), ['Watson1953', 'Darwin1859'])).toBe('[1, 2]')
    expect(citationText(ctx('iso690', 'fr'), ['Darwin1859'])).toBe('(DARWIN, 1859)')
    expect(citationText(ctx('apa'), ['Nope'])).toBe('[Source not found]')
  })

  it('entrées de bibliographie', () => {
    expect(bib('apa', 'Watson1953')).toBe('Watson, J. D., & Crick, F. H. C. (1953). Molecular structure of nucleic acids. Nature, 171(4356), 737–738. https://doi.org/10.1038/171737a0')
    expect(bib('apa', 'Darwin1859')).toBe('Darwin, C. (1859). On the Origin of Species. John Murray.')
    expect(bib('mla', 'Darwin1859')).toBe('Darwin, Charles. On the Origin of Species. John Murray, 1859.')
    expect(bib('chicago', 'Watson1953')).toBe('Watson, James D., and Francis H. C. Crick. 1953. “Molecular structure of nucleic acids.” Nature 171 (4356): 737–738. https://doi.org/10.1038/171737a0.')
    expect(bib('ieee', 'Watson1953')).toBe('J. D. Watson and F. H. C. Crick, “Molecular structure of nucleic acids,” Nature, vol. 171, no. 4356, pp. 737–738, 1953, doi: 10.1038/171737a0.')
    expect(bib('iso690', 'Darwin1859', 'fr')).toBe('DARWIN, Charles. 1859. On the Origin of Species. London : John Murray.')
    expect(bib('harvard', 'Ada')).toContain('Available at: https://exemple.org/notes (Accessed 2026-02-03).')
    // Le titre du livre est en italique.
    expect(bibliographyEntry(ctx('apa'), SOURCES[0]).find((p) => p.italic)?.text).toBe('On the Origin of Species')
  })

  it('ordre : alphabétique, ou numéros IEEE ; lettres pour un même auteur la même année', () => {
    expect(bibliographyOrder(ctx('apa'), ['Watson1953', 'Darwin1859', 'Ada']).map((s) => s.id)).toEqual(['Darwin1859', 'Ada', 'Watson1953'])
    expect(bibliographyOrder(ctx('ieee'), ['Darwin1859', 'Watson1953']).map((s) => s.id)).toEqual(['Watson1953', 'Darwin1859'])
    const twins: Source[] = [
      { id: 'a', type: 'book', authors: ['Doe, Jane'], title: 'Beta', year: '2020' },
      { id: 'b', type: 'book', authors: ['Doe, Jane'], title: 'Alpha', year: '2020' },
    ]
    const c = citeContext(twins, ['a', 'b'], 'apa', 'en')
    expect(citationText(c, ['a'])).toBe('(Doe, 2020b)')
    expect(citationText(c, ['b'])).toBe('(Doe, 2020a)')
  })
})

describe('retrouver une source', () => {
  it('reconnaît un DOI ou un ISBN (avec clé de contrôle)', () => {
    expect(parseIdentifier('https://doi.org/10.1038/171737a0')).toEqual({ kind: 'doi', value: '10.1038/171737a0' })
    expect(parseIdentifier('doi: 10.1000/xyz123.')).toEqual({ kind: 'doi', value: '10.1000/xyz123' })
    expect(parseIdentifier('ISBN 978-0-14-143951-8')).toEqual({ kind: 'isbn', value: '9780141439518' })
    expect(parseIdentifier('0-306-40615-2')).toEqual({ kind: 'isbn', value: '0306406152' })
    expect(parseIdentifier('978-0-14-143951-7')).toBeNull()
    expect(parseIdentifier('bonjour')).toBeNull()
  })

  it('lit une notice Crossref en champs bornés (balises retirées)', () => {
    const s = fromCrossref({
      message: {
        type: 'journal-article',
        title: ['Molecular <i>structure</i> of nucleic acids'],
        author: [{ given: 'J. D.', family: 'Watson' }, { given: 'F. H. C.', family: 'Crick' }, { name: 'Consortium X' }],
        'container-title': ['Nature'],
        volume: '171',
        issue: '4356',
        page: '737-738',
        publisher: 'Springer',
        issued: { 'date-parts': [[1953, 4, 25]] },
        DOI: '10.1038/171737a0',
      },
    })
    expect(s).toEqual({ type: 'article', authors: ['Watson, J. D.', 'Crick, F. H. C.', 'Consortium X'], title: 'Molecular structure of nucleic acids', container: 'Nature', publisher: 'Springer', volume: '171', issue: '4356', pages: '737-738', year: '1953', doi: '10.1038/171737a0' })
    expect(fromCrossref({ message: { title: [] } })).toBeNull()
    expect(fromCrossref('nope')).toBeNull()
  })

  it('lit une notice Open Library ; inverse les noms', () => {
    const s = fromOpenLibrary({ 'ISBN:9782070360245': { title: 'L’Étranger', authors: [{ name: 'Albert Camus' }], publishers: [{ name: 'Gallimard' }], publish_places: [{ name: 'Paris' }], publish_date: 'March 1972' } }, '9782070360245')
    expect(s).toEqual({ type: 'book', authors: ['Camus, Albert'], title: 'L’Étranger', isbn: '9782070360245', publisher: 'Gallimard', place: 'Paris', year: '1972' })
    expect(invertName('Ludwig van Beethoven')).toBe('van Beethoven, Ludwig')
    expect(fromOpenLibrary({}, '1')).toBeNull()
  })

  it('propose un nom de balise libre', () => {
    expect(suggestId({ authors: ['Lévi-Strauss, Claude'], title: 'x', year: '1955' }, new Set())).toBe('LeviStrauss1955')
    expect(suggestId({ authors: ['Doe, J'], title: 'x', year: '2020' }, new Set(['Doe2020']))).toBe('Doe2020a')
  })
})

describe('références dans un fichier .docx', () => {
  it('aller-retour : légendes, signets, renvois, index, table des références, citations, listes, sections, en-tête répété', async () => {
    const { exportDocx } = await import('../../src/docx/export')
    const { open } = await import('./docx-helpers')
    const { strFromU8, unzipSync } = await import('fflate')
    const doc = load(RICH).doc
    const out = await exportDocx(doc, { now: new Date(NOW), locale: 'fr', refPages: { bookmarks: { fig_port: '4', intro: '1' }, entries: ['2', '2', '3', '3', '3', '3'], captions: ['3', '4', '4'] } })
    const files = unzipSync(out.bytes)
    const xml = strFromU8(files['word/document.xml']).replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    // Champs du traitement de texte, avec leur valeur à jour.
    expect(xml).toMatch(/SEQ Figure \\\* ARABIC/)
    expect(xml).toMatch(/<w:bookmarkStart w:id="\d+" w:name="fig_port"\/>/)
    expect(xml).toMatch(/REF fig_port \\h/)
    expect(xml).toMatch(/PAGEREF fig_port \\h/)
    expect(xml).toContain('>4<')
    expect(xml).toMatch(/CITATION Darwin1859 \\p "12" \\l 1036/)
    expect(xml).toContain('(Darwin, 1859, p. 12)')
    expect(xml).toMatch(/XE "ADN:structure" \\b/)
    expect(xml).toMatch(/TA \\l "Cass\. civ\. 1re, 3 mai 2000" \\s "Cass\. 2000" \\c 1/)
    expect(xml).toMatch(/TOC \\h \\z \\c "Figure"/)
    expect(xml).toMatch(/INDEX \\c "1"/)
    expect(xml).toMatch(/BIBLIOGRAPHY \\l 1036/)
    expect(xml).toContain('<w:tblHeader/>')
    expect(xml).toMatch(/<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"\/>/)
    // Sources pour le gestionnaire de sources de Word.
    const parts = Object.keys(files).filter((f) => /^customXml\/item\d+\.xml$/.test(f)).map((f) => strFromU8(files[f]))
    const bib = parts.find((p) => p.includes('<b:Sources'))!
    expect(bib).toContain('<b:Tag>Watson1953</b:Tag><b:SourceType>JournalArticle</b:SourceType>')
    expect(bib).toContain('<b:Person><b:Last>Crick</b:Last><b:First>Francis H. C.</b:First></b:Person>')
    expect(bib).toContain('<b:Corporate>Organisation mondiale de la santé</b:Corporate>')
    // Et retour : le même document.
    const back = open(out.bytes)
    expect(back.res.losses).toEqual([])
    expect(back.doc.sources).toEqual(doc.sources)
    const noAsset = (blocks: unknown) => JSON.parse(JSON.stringify(blocks).replace(/"asset:[^"]+"/g, '"asset"'))
    expect(noAsset(back.doc.blocks)).toEqual(noAsset(doc.blocks))
  })

  it('un fichier d’un autre traitement de texte : sources de Word, citations, renvois vers des signets existants seulement', async () => {
    const { wordSourcesOf } = await import('../../src/docx/import')
    const { parseXml } = await import('../../src/docx/xml')
    const root = parseXml(
      '<b:Sources xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"><b:Source><b:Tag>Cam42</b:Tag><b:SourceType>Book</b:SourceType><b:Author><b:Author><b:NameList><b:Person><b:Last>Camus</b:Last><b:First>Albert</b:First></b:Person></b:NameList></b:Author></b:Author><b:Title>L’Étranger</b:Title><b:Year>1942</b:Year><b:City>Paris</b:City><b:Publisher>Gallimard</b:Publisher><b:YearAccessed>2026</b:YearAccessed><b:MonthAccessed>3</b:MonthAccessed></b:Source><b:Source><b:Tag>bad tag</b:Tag></b:Source></b:Sources>',
    )
    expect(wordSourcesOf(root!)).toEqual([{ id: 'Cam42', type: 'book', authors: ['Camus, Albert'], title: 'L’Étranger', year: '1942', publisher: 'Gallimard', place: 'Paris', accessed: '2026-03-01' }])
  })
})
