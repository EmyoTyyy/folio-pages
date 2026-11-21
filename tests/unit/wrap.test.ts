// @vitest-environment jsdom
// Habillage des images : rapproché, au travers, derrière et devant le texte.

import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { exportDocx } from '../../src/docx/export'
import { contourPoints, opaqueExtents } from '../../src/editor/contour'
import { toHtml } from '../../src/export/html'
import { exportOdt } from '../../src/export/odt'
import { toCompact } from '../../src/format/compact'
import { loadDocument } from '../../src/format/load'
import { alignAttrs, floatSide, overText, wrapAttrs } from '../../src/format/picture'
import type { Block, FolioDoc } from '../../src/format/types'
import { NOW, open } from './docx-helpers'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR42mNkYPhfz4AEGAEADAQBAc0kzM4AAAAASUVORK5CYII='
type Img = Extract<Block, { type: 'image' }>

function load(blocks: unknown[]): FolioDoc {
  const r = loadDocument({ format: 'folio/doc', version: 1, assets: { p: PNG }, blocks }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  return r.doc
}

const KINDS: [string, string][] = [
  ['left', 'left'],
  ['right', 'right'],
  ['tight', 'left'],
  ['through', 'right'],
  ['behind', 'center'],
  ['front', 'right'],
  ['none', 'center'],
]
const DOC = () => load(KINDS.flatMap(([wrap, align]) => [{ type: 'image', src: 'asset:p', alt: wrap, width: 60, wrap, align }, `Texte après ${wrap}.`]))
const images = (d: FolioDoc) => d.blocks.filter((b): b is Img => b.type === 'image').map((b) => [b.wrap, b.align])

describe('habillage des images', () => {
  it('côté, au-dessus du texte ; choix depuis un menu, alignement', () => {
    expect(floatSide('left', 'center')).toBe('left')
    expect(floatSide('tight', 'right')).toBe('right')
    expect(floatSide('through', 'center')).toBe('left')
    expect(floatSide('behind', 'right')).toBeNull()
    expect(floatSide('none', 'left')).toBeNull()
    expect(overText('front')).toBe(true)
    expect(overText('tight')).toBe(false)
    expect(wrapAttrs('right', 'left')).toEqual({ wrap: 'right', align: 'right' })
    expect(wrapAttrs('tight', 'center')).toEqual({ wrap: 'tight', align: 'left' })
    expect(wrapAttrs('behind', 'center')).toEqual({ wrap: 'behind' })
    // Aligner une image carrée change son côté (au centre : plus d'habillage) ; les autres habillages restent.
    expect(alignAttrs('right', 'left')).toEqual({ align: 'right', wrap: 'right' })
    expect(alignAttrs('center', 'left')).toEqual({ align: 'center', wrap: 'none' })
    expect(alignAttrs('right', 'tight')).toEqual({ align: 'right' })
  })

  it('lecture tolérante : synonymes, valeur inconnue ignorée ; JSON compact', () => {
    const d = load([
      { type: 'image', src: 'asset:p', wrap: 'behind-text' },
      { type: 'image', src: 'asset:p', wrap: 'inFront' },
      { type: 'image', src: 'asset:p', wrap: 'Contour' },
      { type: 'image', src: 'asset:p', wrap: 'topAndBottom' },
      { type: 'image', src: 'asset:p', wrap: 'diagonale' },
    ])
    expect(images(d).map((x) => x[0])).toEqual(['behind', 'front', 'tight', 'none', 'none'])
    const c = toCompact(d) as { blocks: Record<string, unknown>[] }
    expect(c.blocks.map((b) => b.wrap)).toEqual(['behind', 'front', 'tight', undefined, undefined])
  })

  it('contour : limites opaques par bande, polygone du côté du texte, légende sur toute la largeur', () => {
    // 4 × 2 px : ligne 0 opaque jusqu'à x = 1, ligne 1 vide.
    const data = new Uint8ClampedArray(4 * 2 * 4)
    data[3] = 255
    data[7] = 255
    expect(opaqueExtents(data, 4, 2, 2, 'left')).toEqual([0.5, null])
    expect(opaqueExtents(data, 4, 2, 2, 'right')).toEqual([0, null])
    const pts = contourPoints([0.5, null], { frameW: 100, frameH: 100, offX: 0, offY: 0, boxW: 100, boxH: 130, side: 'left' })
    expect(pts[0]).toEqual([0, 0])
    expect(pts).toContainEqual([50, 0])
    expect(pts).toContainEqual([50, 50])
    expect(pts).toContainEqual([0, 100])
    // La légende (sous l'image) bloque toute la largeur.
    expect(pts).toContainEqual([100, 130])
    const right = contourPoints([0.25], { frameW: 80, frameH: 40, offX: 20, offY: 0, boxW: 100, boxH: 40, side: 'right' })
    expect(right[0]).toEqual([100, 0])
    expect(right).toContainEqual([40, 40])
  })

  it('.docx : wrapSquare, wrapTight, wrapThrough, wrapNone derrière / devant ; relu', async () => {
    const out = await exportDocx(DOC(), { now: new Date(NOW) })
    const xml = strFromU8(unzipSync(out.bytes)['word/document.xml'])
    expect(xml).toMatch(/<wp:wrapTight[^>]*>\s*<wp:wrapPolygon/)
    expect(xml).toMatch(/<wp:wrapThrough[^>]*>\s*<wp:wrapPolygon/)
    expect(xml).toMatch(/behindDoc="1"[\s\S]*?<wp:wrapNone\/>/)
    expect(xml).toMatch(/behindDoc="0"[\s\S]*?<wp:wrapNone\/>/)
    expect(images(open(out.bytes).doc)).toEqual(KINDS)
  })

  it('.odt : contour (extérieur ou complet), au travers à l’arrière-plan ou au premier plan ; relu', async () => {
    const { importOdt } = await import('../../src/file/odt-import')
    const odt = await exportOdt(DOC())
    const content = strFromU8(unzipSync(odt.bytes)['content.xml'])
    expect(content).toContain('style:wrap-contour="true" style:wrap-contour-mode="outside"')
    expect(content).toContain('style:wrap-contour="true" style:wrap-contour-mode="full"')
    expect(content).toContain('style:wrap="run-through" style:run-through="background"')
    expect(content).toContain('style:wrap="run-through" style:run-through="foreground"')
    const back = loadDocument(importOdt(odt.bytes).doc, { now: NOW })
    if (!back.ok) throw new Error('refusé')
    expect(images(back.doc)).toEqual(KINDS)
  })

  it('page web : rapproché devient carré du même côté ; derrière et devant gardent leur place', () => {
    const html = toHtml(DOC())
    expect(html).toContain('<figure class="left wrap-left">')
    expect(html).toContain('<figure class="right wrap-right">')
    expect(html).toMatch(/<figure class="wrap-behind">/)
    expect(html).toMatch(/<figure class="right wrap-front">/)
    expect(html).toContain('figure.wrap-behind{z-index:-1}')
  })
})
