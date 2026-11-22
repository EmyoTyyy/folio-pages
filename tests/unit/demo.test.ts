import { describe, expect, it } from 'vitest'
import { DEMO_SOURCES, demoDocument } from '../../src/demo/demo'
import { loadDocument } from '../../src/format/load'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { LANGUAGES } from '../../src/i18n/i18n'
import { checkMerge, mergeFields } from '../../src/merge/engine'

describe('document de démonstration', () => {
  for (const l of LANGUAGES) {
    it(`[${l}] se charge sans aucun signalement et passe par l’éditeur sans perte`, () => {
      const r = loadDocument(DEMO_SOURCES[l])
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.report.issues).toEqual([])
      const doc = r.doc
      const back = pmToDoc(docToPM(doc), { id: doc.id, created: doc.meta.created, modified: doc.meta.modified })
      expect(back.blocks).toEqual(doc.blocks)
      expect(doc.meta.lang).toBe(l)
    })
    it(`[${l}] montre les fonctions des phases 1 à 3`, () => {
      const d = demoDocument(l)
      const types = new Set(d.blocks.map((b) => b.type))
      for (const t of ['heading', 'paragraph', 'list', 'table', 'quote', 'code', 'divider', 'image', 'equation']) expect(types).toContain(t)
      const json = JSON.stringify(d.blocks)
      for (const needle of ['"style":"title"', '"style":"subtitle"', '"style":"caption"', '"style":"tip"', '"numbering":"outline"', '"style":"check"', '"type":"callout"', '"type":"chart"', '"style":"zebra"', '"type":"field"', '"highlight"', '"smallcaps"', '"wrap":"right"']) {
        expect(json, needle).toContain(needle)
      }
      // L'illustration de la page, et les trois paysages de la disposition d'images (de petits SVG).
      expect(Object.keys(d.assets).sort()).toEqual(['page', 'scene1', 'scene2', 'scene3'])
      expect(json).toContain('"type":"pictures"')
      for (const v of Object.values(d.assets)) expect(v.length).toBeLessThan(1500)
      // Phase 6 : des formules en ligne (dont un renvoi et de la chimie), une équation numérotée, un prix qui reste du texte.
      expect(json).toContain('"type":"math"')
      expect(json).toContain('\\\\eqref')
      expect(json).toContain('\\\\ce{')
      expect(json).toMatch(/"numbered":true/)
      expect(json).toMatch(/5 \$ reste du texte|\$5 stays text/)
      expect(types).toContain('columns')
      // Phase 7 : un publipostage d'exemple (champs et liste), dont l'aperçu donne un vrai texte.
      expect(json).toContain('"type":"mergefield"')
      expect(d.mailMerge?.source?.records).toHaveLength(3)
      const names = mergeFields(d.blocks).map((f) => f.name)
      expect(names).toHaveLength(3)
      for (const n of names) expect(d.mailMerge!.source!.fields).toContain(n)
      expect(checkMerge(d)).toEqual([])
      expect(d.footers.default).toHaveLength(1)
      expect(d.headers.default).toHaveLength(1)
    })
  }
  it('les deux langues ont la même structure', () => {
    const shape = (l: (typeof LANGUAGES)[number]) => demoDocument(l).blocks.map((b) => b.type)
    expect(shape('en')).toEqual(shape('fr'))
  })
  it('chaque démonstration reçoit une nouvelle identité', () => {
    expect(demoDocument('fr').id).not.toBe(demoDocument('fr').id)
  })
})
