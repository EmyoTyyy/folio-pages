// Modèles intégrés : chacun s'ouvre sans champ ignoré ni avertissement, dans les deux langues.

import { describe, expect, it } from 'vitest'
import { loadDocument } from '../../src/format/load'
import { TEMPLATE_IDS, TEMPLATES, templateById } from '../../src/templates/templates'

describe('modèles', () => {
  it('liste complète, identifiants uniques', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual([...TEMPLATE_IDS])
    expect(templateById('cv')?.id).toBe('cv')
    expect(templateById('nope')).toBeUndefined()
  })

  for (const tpl of TEMPLATES) {
    for (const fr of [true, false]) {
      it(`${tpl.id} (${fr ? 'fr' : 'en'}) : chargé sans perte`, () => {
        const input = tpl.build(fr)
        const res = loadDocument(JSON.parse(JSON.stringify(input)), { now: '2026-11-13T10:00:00.000Z' })
        expect(res.ok).toBe(true)
        if (!res.ok) return
        expect(res.report.issues).toEqual([])
        expect(res.doc.meta.lang).toBe(fr ? 'fr' : 'en')
        if (tpl.id !== 'blank') expect(res.doc.blocks.length).toBeGreaterThan(3)
        // Pas de « $ » resté en texte : les formules sont des formules.
        expect(JSON.stringify(res.doc.blocks)).not.toMatch(/"text":"[^"]*\$[^"]*\$/)
        // Ni champ resté en texte : {{date}} et {{author}} sont des champs.
        expect(JSON.stringify(res.doc.blocks)).not.toContain('{{')
      })
    }
  }
})
