import { describe, expect, it } from 'vitest'
import { Node as PMNode } from 'prosemirror-model'
import { toCompact } from '../../src/format/compact'
import { loadDocument } from '../../src/format/load'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { schema } from '../../src/editor/schema'
import type { Block, FolioDoc } from '../../src/format/types'
import { randomDoc } from './gen'

const identity = (d: FolioDoc) => ({ id: d.id, created: d.meta.created, modified: d.meta.modified })
const throughEditor = (d: FolioDoc) => pmToDoc(docToPM(d), identity(d))

function reload(v: Record<string, unknown>): FolioDoc {
  const r = loadDocument({ format: 'folio/doc', version: 1, ...v }, { now: '2026-01-01T00:00:00.000Z' })
  if (!r.ok) throw new Error('refusé')
  expect(r.report.issues).toEqual([])
  return r.doc
}

describe('forme compacte', () => {
  it('donne exactement le même document une fois rechargée (2000 documents aléatoires)', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const doc = throughEditor(randomDoc(seed)) // forme stable
      const back = reload(JSON.parse(JSON.stringify(toCompact(doc))))
      expect(back.blocks, `graine ${seed}`).toEqual(doc.blocks)
      expect({ ...back.meta, created: '', modified: '' }).toEqual({ ...doc.meta, created: '', modified: '' })
    }
  })

  it('est nettement plus courte que la forme complète', () => {
    let full = 0
    let compact = 0
    for (let seed = 1; seed <= 200; seed++) {
      const doc = randomDoc(seed)
      full += JSON.stringify(doc).length
      compact += JSON.stringify(toCompact(doc)).length
    }
    expect(compact / full).toBeLessThan(0.75)
  })

  it('utilise les raccourcis attendus', () => {
    const doc = reload({
      format: 'folio/doc',
      version: 1,
      blocks: [
        { type: 'heading', level: 1, text: 'T' },
        { text: 'p' },
        { type: 'list', items: ['a', { text: 'b', level: 1 }, { text: 'c', level: 1, style: 'number' }] },
        { type: 'table', rows: [['x', { text: 'y', colspan: 2 }]] },
        { type: 'quote', text: 'q' },
        { type: 'code', text: 'c' },
      ],
    })
    expect(toCompact(doc)).toEqual({
      format: 'folio/doc',
      version: 1,
      blocks: [
        { type: 'heading', text: 'T' },
        { text: 'p' },
        { type: 'list', items: ['a', { text: 'b', level: 1 }, { text: 'c', level: 1, style: 'number' }] },
        { type: 'table', rows: [['x', { text: 'y', colspan: 2 }]] },
        { type: 'quote', text: 'q' },
        { type: 'code', text: 'c' },
      ],
    })
  })

  it('n’omet un style de liste que s’il serait bien déduit', () => {
    // b (niveau 1, puces) puis c (niveau 1, numéros) : c doit garder son style,
    // sinon il rejoindrait la sous-liste à puces.
    const doc = reload({ blocks: [{ type: 'list', items: ['a', { text: 'b', level: 1 }, { text: 'c', level: 1, style: 'number' }, { text: 'd', level: 1, style: 'bullet' }] }] })
    const items = (toCompact(doc).blocks as Record<string, unknown>[])[0].items
    expect(items).toEqual(['a', { text: 'b', level: 1 }, { text: 'c', level: 1, style: 'number' }, { text: 'd', level: 1, style: 'bullet' }])
  })
})

describe('aller-retour avec l’éditeur', () => {
  it('Folio → éditeur → Folio est sans perte (2000 documents aléatoires)', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const doc = randomDoc(seed)
      const once = throughEditor(doc)
      expect(throughEditor(once), `graine ${seed}`).toEqual(once)
      // et le document canonique ne change pas (hors cas réparés par l'éditeur)
      expect(once.meta).toEqual(doc.meta)
    }
  })

  it('le document canonique est déjà stable pour l’éditeur', () => {
    let same = 0
    for (let seed = 1; seed <= 500; seed++) {
      const doc = randomDoc(seed)
      if (JSON.stringify(throughEditor(doc).blocks) === JSON.stringify(doc.blocks)) same++
    }
    expect(same).toBe(500)
  })

  it('chaque document produit est valide pour le schéma de l’éditeur', () => {
    for (let seed = 1; seed <= 300; seed++) expect(() => docToPM(randomDoc(seed)).check()).not.toThrow()
  })

  it('un document vide devient une page avec un paragraphe vide', () => {
    const doc = reload({ blocks: [] })
    const pm = docToPM(doc)
    expect(pm.childCount).toBe(1)
    expect(pm.firstChild!.type.name).toBe('paragraph')
  })

  it('les retours à la ligne gardent leur mise en forme', () => {
    const doc = reload({ blocks: [{ content: [{ text: 'a\nb', bold: true }, { text: '\n' }] }] })
    const pm = docToPM(doc)
    expect(pm.firstChild!.childCount).toBe(4)
    expect(throughEditor(doc).blocks).toEqual(doc.blocks)
  })

  it('retire les caractères de contrôle, garde tabulations et retours', () => {
    const doc = reload({ blocks: [{ text: 'a\u0000b\u0007c\td' }, { type: 'code', text: 'x\u0001\ny\r\nz' }] })
    expect(throughEditor(doc).blocks).toEqual([
      { type: 'paragraph', content: [{ text: 'abc\td' }] },
      { type: 'code', language: '', text: 'x\ny\nz' },
    ])
  })

  it('répare les tableaux irréguliers sans perdre de cellule', () => {
    const doc = reload({ blocks: [{ type: 'table', rows: [['a', 'b', 'c'], ['d'], ['e', 'f']] }] })
    const t = throughEditor(doc).blocks[0] as Extract<Block, { type: 'table' }>
    expect(t.rows.map((r) => r.length)).toEqual([3, 3, 3])
    const all = t.rows.flat().map((c) => (c.blocks[0] as Extract<Block, { type: 'paragraph' }>).content.map((x) => ('text' in x ? x.text : '')).join(''))
    expect(all.filter(Boolean)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('garde les cellules fusionnées', () => {
    const doc = reload({ blocks: [{ type: 'table', rows: [[{ text: 'large', colspan: 2 }, 'c'], ['a', 'b', 'c2']] }] })
    expect(throughEditor(doc).blocks).toEqual(doc.blocks)
  })

  it('ligne d’en-tête : seulement si toute la première ligne est en en-tête', () => {
    const n = schema.nodes
    const cell = (type: typeof n.table_cell, t: string) => type.create(null, n.paragraph.create(null, schema.text(t)))
    const table = n.table.create(null, [
      n.table_row.create(null, [cell(n.table_header, 'h'), cell(n.table_cell, 'c')]),
      n.table_row.create(null, [cell(n.table_cell, 'x'), cell(n.table_cell, 'y')]),
    ])
    const pm: PMNode = n.doc.create(null, table)
    const doc = pmToDoc(pm, { id: 'abcdef', created: '', modified: '' })
    expect((doc.blocks[0] as Extract<Block, { type: 'table' }>).header).toBe(false)
  })

  it('numérotation de départ et listes imbriquées', () => {
    const doc = reload({ blocks: [{ type: 'list', style: 'number', start: 5, items: ['cinq', { text: 'sous', level: 1, style: 'bullet' }, 'six'] }] })
    const pm = docToPM(doc)
    expect(pm.firstChild!.type.name).toBe('ordered_list')
    expect(pm.firstChild!.attrs.order).toBe(5)
    expect(pm.firstChild!.firstChild!.lastChild!.type.name).toBe('bullet_list')
    expect(throughEditor(doc).blocks).toEqual(doc.blocks)
  })

  it('les propriétés du document passent par l’éditeur', () => {
    const doc = reload({ meta: { title: 'T', author: 'A', subject: 'S', organization: 'O', keywords: ['k'], lang: 'fr' }, blocks: ['x'] })
    const back = throughEditor(doc)
    expect(back.meta).toEqual(doc.meta)
    expect(back.id).toBe(doc.id)
  })
})
