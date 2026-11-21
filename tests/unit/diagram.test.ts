// @vitest-environment jsdom
// Diagrammes : format, dessin de chaque disposition, éditeur, exports et imports.

import { describe, expect, it } from 'vitest'
import { exportDocx } from '../../src/docx/export'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { toHtml } from '../../src/export/html'
import { exportOdt } from '../../src/export/odt'
import { importOdt } from '../../src/file/odt-import'
import { chartLook } from '../../src/format/chart'
import { toCompact } from '../../src/format/compact'
import { DIAGRAM_KINDS, diagramDrawing, itemsFromText, itemsToText } from '../../src/format/diagram'
import { loadDocument } from '../../src/format/load'
import { inlineMarkdown } from '../../src/format/markdown-out'
import { defaultTheme } from '../../src/format/theme'
import type { DiagramBlock, FolioDoc } from '../../src/format/types'
import { NOW, open } from './docx-helpers'

void inlineMarkdown
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
const load = (blocks: unknown[]): FolioDoc => {
  const r = loadDocument({ format: 'folio/doc', version: 1, blocks }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  return r.doc
}
const ORG = { type: 'diagram', kind: 'hierarchy', title: 'Équipe <R&D>', items: ['Direction', { text: 'Ventes', level: 1 }, { text: 'Paris', level: 2 }, { text: 'Lyon', level: 2 }, { text: 'Technique', level: 1 }] }

describe('diagrammes', () => {
  it('lecture tolérante : chaînes, objets, texte indenté, niveaux sans saut, alias', () => {
    const d = load([{ type: 'orgchart', text: 'A\n      trop loin\n  B\n\n\tC' }, { type: 'smartart', items: ['  x  ', '', { text: 'y', level: 9 }] }, { type: 'process', items: [] }]).blocks
    expect(d).toHaveLength(2)
    expect(d[0]).toEqual({ type: 'diagram', kind: 'hierarchy', items: [{ text: 'A', level: 0 }, { text: 'trop loin', level: 1 }, { text: 'B', level: 1 }, { text: 'C', level: 1 }] })
    expect(d[1]).toEqual({ type: 'diagram', kind: 'list', items: [{ text: 'x', level: 0 }, { text: 'y', level: 1 }] })
    expect(itemsFromText(itemsToText((d[0] as DiagramBlock).items))).toEqual((d[0] as DiagramBlock).items)
  })

  it('chaque disposition dessine un SVG valide, texte échappé, aux couleurs du thème', () => {
    const look = chartLook(defaultTheme(), 'fr')
    for (const kind of DIAGRAM_KINDS) {
      for (const n of [1, 3, 9]) {
        const items = Array.from({ length: n }, (_, i) => ({ text: `Élément ${i} <b> & un texte assez long pour être coupé sur plusieurs lignes`, level: kind === 'hierarchy' && i ? 1 : 0 }))
        const { svg, width, height } = diagramDrawing({ type: 'diagram', kind, items, title: 'T' }, look)
        expect(svg).not.toMatch(/NaN|undefined|Infinity/)
        expect(svg).not.toContain('<b>')
        expect(svg).toContain('&lt;b&gt; &amp;')
        expect(width).toBeGreaterThan(100)
        expect(height).toBeGreaterThan(40)
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
        expect(doc.querySelector('parsererror')).toBeNull()
      }
    }
    expect(diagramDrawing({ type: 'diagram', kind: 'list', items: [{ text: 'a', level: 0 }], color: 'accent2' }, look).svg).toContain(look.colors[1])
  })

  it('JSON compact, éditeur : aller-retour exact', () => {
    const d = load([ORG])
    expect(JSON.stringify(toCompact(d))).toContain('"items":["Direction",{"text":"Ventes","level":1}')
    const back = pmToDoc(docToPM(d), { id: d.id, created: NOW, modified: NOW })
    expect(back.blocks).toEqual(d.blocks)
  })

  it('page web et Markdown ; .docx et .odt : une image SVG qui redevient un diagramme', async () => {
    const d = load(['Avant', ORG, 'Après'])
    const html = toHtml(d)
    expect(html).toContain('<figure class="diagram"><svg')
    expect(html).toContain('Équipe &lt;R&amp;D&gt;')
    const docx = await exportDocx(d, { now: new Date(NOW), rasterize: async () => PNG })
    expect(docx.losses).toEqual([])
    const fromDocx = open(docx.bytes).doc.blocks
    expect(fromDocx.find((b) => b.type === 'diagram')).toEqual(d.blocks[1])
    const odt = await exportOdt(d)
    const fromOdt = loadDocument(importOdt(odt.bytes).doc, { now: NOW })
    if (!fromOdt.ok) throw new Error('odt refusé')
    expect(fromOdt.doc.blocks.find((b) => b.type === 'diagram')).toEqual(d.blocks[1])
  })
})
