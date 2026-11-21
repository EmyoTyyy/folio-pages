// Plusieurs documents dans un fichier : lecture tolérante, clés, découpage,
// liens et renvois entre documents, réunion de tous les documents (export).

import { describe, expect, it } from 'vitest'
import { anchorSlug, combineDocuments, ensureKeys, freeKey, joinFile, parseDocLink, splitFile } from '../../src/format/documents'
import { toCompact } from '../../src/format/compact'
import { loadDocument } from '../../src/format/load'
import { buildSchema } from '../../src/format/schema'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { crossRefValue } from '../../src/editor/refs'
import type { Block, FolioDoc } from '../../src/format/types'

const NOW = '2026-11-21T10:00:00.000Z'
const load = (v: unknown): FolioDoc => {
  const r = loadDocument(v, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  return r.doc
}
const FILE = {
  format: 'folio/doc',
  version: 1,
  key: 'report',
  meta: { title: 'Rapport' },
  styles: { note: { name: 'Note', basedOn: 'normal', italic: true } },
  blocks: [
    { content: [{ type: 'bookmark', name: 'intro' }, 'Voir ', { type: 'xref', doc: 'annex', target: 'ventes', show: 'label' }, ' ', { text: 'ici', link: '#intro' }, ' ', { text: 'l’annexe', link: '#annex:ventes' }, ' ', { text: 'son titre', link: '#annex:annexe-a' }] },
  ],
  documents: [
    {
      key: 'annex',
      meta: { title: 'Annexe A' },
      page: { orientation: 'landscape' },
      styles: { note: { name: 'Note', basedOn: 'normal', bold: true } },
      blocks: [
        { type: 'heading', level: 1, text: 'Annexe A' },
        { content: [{ type: 'bookmark', name: 'ventes' }, 'Tableau ', { type: 'seq', label: 'table' }, ' : Ventes'] },
        { content: [{ text: 'commenté', comments: ['c1'] }, ' ', { text: 'retour', link: '#report:intro' }] },
      ],
      comments: [{ id: 'c1', author: 'A', text: 'Vérifier' }],
    },
  ],
}

describe('lecture d’un fichier à plusieurs documents', () => {
  it('garde chaque document, avec sa clé, sans avertissement de format', () => {
    const r = loadDocument(FILE, { now: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.report.issues).toEqual([])
    expect(r.doc.key).toBe('report')
    expect(r.doc.documents?.map((d) => [d.key, d.meta.title, d.page.orientation])).toEqual([['annex', 'Annexe A', 'landscape']])
    // Le renvoi garde le document visé.
    const p = r.doc.blocks[0] as Extract<Block, { type: 'paragraph' }>
    expect(p.content.find((x) => 'type' in x && x.type === 'xref')).toMatchObject({ type: 'xref', doc: 'annex', target: 'ventes', show: 'label' })
    // Le même identifiant pour tous (celui du fichier).
    expect(r.doc.documents![0].id).toBe(r.doc.id)
  })

  it('donne une clé aux documents qui n’en ont pas, remplace les doublons, ignore les documents imbriqués', () => {
    const r = loadDocument({ blocks: ['Un'], documents: [{ blocks: ['Deux'], documents: [{ blocks: ['Trois'] }] }, { key: 'doc1', blocks: ['Quatre'] }, { key: 'doc1', blocks: ['Cinq'] }] }, { now: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const keys = [r.doc.key, ...r.doc.documents!.map((d) => d.key)]
    expect(new Set(keys).size).toBe(4)
    expect(keys.every((k) => /^[A-Za-z][A-Za-z0-9_]*$/.test(k!))).toBe(true)
    expect(r.doc.documents![0].documents).toBeUndefined()
    expect(r.report.issues.some((i) => i.path === 'documents[0].documents')).toBe(true)
  })

  it('refuse une clé mal formée (remplacée) et borne le nombre de documents', () => {
    const r = loadDocument({ blocks: [], documents: Array.from({ length: 60 }, (_, i) => ({ key: i === 0 ? '1bad' : `d${i}`, blocks: [`${i}`] })) }, { now: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc.documents!.length).toBe(50)
    expect(r.doc.documents![0].key).toMatch(/^doc\d+$/)
  })

  it('aller-retour : forme compacte, puis relecture identique', () => {
    const doc = load(FILE)
    const compact = toCompact(doc) as { documents?: unknown[]; key?: string }
    expect(compact.key).toBe('report')
    expect(compact.documents).toHaveLength(1)
    const again = load(compact)
    expect(again.documents![0].blocks).toEqual(doc.documents![0].blocks)
    expect(again.blocks).toEqual(doc.blocks)
  })

  it('le schéma JSON décrit « documents » et « key »', () => {
    const s = JSON.stringify(buildSchema())
    expect(s).toContain('"documents"')
    expect(s).toContain('More documents in the same file')
  })

  it('le renvoi garde « doc » et « last » à travers l’éditeur', () => {
    const doc = load({ blocks: [{ content: [{ type: 'xref', doc: 'annex', target: 'ventes', show: 'page', last: '4' }] }] })
    const back = pmToDoc(docToPM(doc), { id: doc.id, created: NOW, modified: '' })
    expect((back.blocks[0] as Extract<Block, { type: 'paragraph' }>).content[0]).toMatchObject({ type: 'xref', doc: 'annex', last: '4' })
  })
})

describe('clés, découpage, liens', () => {
  it('splitFile et joinFile se répondent ; un seul document n’a ni clé ni « documents »', () => {
    const doc = load(FILE)
    const parts = splitFile(doc)
    expect(parts.map((d) => d.key)).toEqual(['report', 'annex'])
    expect(parts[0].documents).toBeUndefined()
    const joined = joinFile(parts)
    expect(joined.documents?.map((d) => d.key)).toEqual(['annex'])
    const alone = joinFile([parts[0]])
    expect(alone.key).toBeUndefined()
    expect(alone.documents).toBeUndefined()
  })

  it('ensureKeys et freeKey', () => {
    expect(freeKey(['doc1', 'doc2'])).toBe('doc3')
    const docs = [{ key: 'a' }, { key: 'a' }, {}] as FolioDoc[]
    ensureKeys(docs)
    expect(new Set(docs.map((d) => d.key)).size).toBe(3)
    expect(docs[0].key).toBe('a')
  })

  it('parseDocLink : « #clé:ancre », ancre vide, liens ordinaires', () => {
    expect(parseDocLink('#annex:ventes')).toEqual({ doc: 'annex', anchor: 'ventes' })
    expect(parseDocLink('#annex:')).toEqual({ doc: 'annex', anchor: '' })
    expect(parseDocLink('#annex:caf%C3%A9')).toEqual({ doc: 'annex', anchor: 'café' })
    expect(parseDocLink('#ventes')).toBeNull()
    expect(parseDocLink('https://exemple.org/#a:b')).toBeNull()
    expect(anchorSlug('Annexe A : Ventes')).toBe('annexe-a-ventes')
  })
})

describe('renvoi vers un autre document', () => {
  const annex = docToPM(load(FILE.documents[0]))
  const labels = { missingBookmark: '!', above: 'ci-dessus', below: 'ci-dessous', inDoc: (t: string) => `dans « ${t} »`, emptyFigures: '', emptyIndex: '', emptyAuthorities: '', emptyBibliography: '', emptyGlossary: '', emptyAbbreviations: '', see: '', passim: '', category: () => '' }
  const other = { doc: annex, title: 'Annexe A', page: (b: string) => (b === 'ventes' ? '3' : null) }
  it('texte, étiquette, numéro, page, « ci-dessus » devenu le nom du document', () => {
    expect(crossRefValue(other, 'ventes', 'text', labels)).toBe('Tableau 1 : Ventes')
    expect(crossRefValue(other, 'ventes', 'label', labels)).toBe('Tableau 1')
    expect(crossRefValue(other, 'ventes', 'number', labels)).toBe('1')
    expect(crossRefValue(other, 'ventes', 'page', labels)).toBe('3')
    expect(crossRefValue(other, 'ventes', 'above', labels)).toBe('dans « Annexe A »')
    expect(crossRefValue(other, 'absent', 'text', labels)).toBeNull()
  })
})

describe('tous les documents en un seul (export)', () => {
  const { doc, note } = combineDocuments(splitFile(load(FILE)))
  const json = JSON.stringify(doc.blocks)
  it('chaque document suivant commence par un saut de section, avec sa mise en page', () => {
    const section = doc.blocks.find((b) => b.type === 'section') as Extract<Block, { type: 'section' }>
    expect(section).toMatchObject({ type: 'section', start: 'page', numberStart: 1 })
    expect(section.page?.orientation).toBe('landscape')
    expect(doc.documents).toBeUndefined()
    expect(doc.key).toBeUndefined()
  })
  it('signets préfixés par document, renvois et liens devenus internes', () => {
    expect(json).toContain('"name":"report_intro"')
    expect(json).toContain('"name":"annex_ventes"')
    expect(json).toContain('"target":"annex_ventes"')
    expect(json).not.toContain('"doc":')
    expect(json).toContain('"link":"#report_intro"')
    expect(json).toContain('"link":"#annex_ventes"')
    // Un titre visé par son ancre : le lien garde l'ancre (sans le document).
    expect(json).toContain('"link":"#annexe-a"')
  })
  it('commentaires renommés par document ; le premier style l’emporte, signalé', () => {
    expect(doc.comments.map((c) => c.id)).toEqual(['annex_c1'])
    expect(json).toContain('"comments":["annex_c1"]')
    expect(note.styles).toEqual(['note'])
  })
  it('le résultat est un document valable, sans rien d’ignoré', () => {
    const r = loadDocument(doc, { now: NOW })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.report.issues.filter((i) => i.kind === 'ignored')).toEqual([])
  })
  it('les ressources des documents suivants sont renommées (pas de collision)', () => {
    const a = load({ blocks: [{ type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=' }] })
    const b = load({ blocks: [{ type: 'image', src: 'data:image/png;base64,iVBORw0KGgoA' }] })
    const c = combineDocuments([a, b]).doc
    const srcs = c.blocks.filter((x) => x.type === 'image').map((x) => (x as { src: string }).src)
    expect(new Set(srcs).size).toBe(2)
    for (const s of srcs) expect(c.assets[s.slice(6)]).toBeTruthy()
  })
})
