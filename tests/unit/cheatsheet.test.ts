// Aide-mémoire : un contenu pour la fenêtre et le document à imprimer, dans les deux langues.

import { describe, expect, it } from 'vitest'
import { cheatSheet, cheatSheetDocument, keyLabel } from '../../src/help/cheatsheet'
import { loadDocument } from '../../src/format/load'

describe('aide-mémoire', () => {
  it('les touches s’écrivent selon la langue et le système', () => {
    expect(keyLabel('Mod+Shift+X', 'fr', false)).toBe('Ctrl+Maj+X')
    expect(keyLabel('Mod+Shift+X', 'en', false)).toBe('Ctrl+Shift+X')
    expect(keyLabel('Mod+Shift+X', 'en', true)).toBe('⌘⇧X')
    expect(keyLabel('Shift+Enter', 'fr', false)).toBe('Maj+Entrée')
    expect(keyLabel('Mod+Click', 'fr', false)).toBe('Ctrl+clic')
    expect(keyLabel('Alt+PageDown', 'en', false)).toBe('Alt+Page\u00a0Down')
  })

  it('mêmes rubriques et mêmes lignes en français et en anglais', () => {
    const fr = cheatSheet('fr')
    const en = cheatSheet('en')
    expect(fr.sections.map((s) => [s.id, s.rows.length, s.page])).toEqual(en.sections.map((s) => [s.id, s.rows.length, s.page]))
    expect(fr.sections.flatMap((s) => s.rows.map((r) => r.keys))).toEqual(en.sections.flatMap((s) => s.rows.map((r) => r.keys)))
    expect(fr.tips).toHaveLength(en.tips.length)
    // Les champs en français (alias acceptés à la frappe).
    expect(JSON.stringify(fr.sections.find((s) => s.id === 'fields'))).toContain('{{date:JJ/MM/AAAA}}')
  })

  it('le document à imprimer est valide, sans champ ignoré, et revient tel quel', () => {
    for (const lang of ['fr', 'en'] as const) {
      const doc = cheatSheetDocument(lang, false, '1.2.3')
      const r = loadDocument(JSON.parse(JSON.stringify(doc)))
      if (!r.ok) throw new Error('chargement')
      expect(r.report.issues).toEqual([])
      expect(doc.page.orientation).toBe('landscape')
      expect(doc.blocks.filter((b) => b.type === 'columns')).toHaveLength(2)
      expect(JSON.stringify(doc.blocks)).toContain(lang === 'fr' ? 'Ctrl+Alt+F' : 'Ctrl+Alt+F')
    }
  })
})
