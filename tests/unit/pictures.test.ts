// @vitest-environment jsdom
// Dispositions d'images : format, dessin de chaque disposition, éditeur, exports et imports.

import { describe, expect, it } from 'vitest'
import { exportDocx } from '../../src/docx/export'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { toHtml } from '../../src/export/html'
import { exportOdt } from '../../src/export/odt'
import { toMarkdown, toPlainText } from '../../src/export/text'
import { importOdt } from '../../src/file/odt-import'
import { chartLook } from '../../src/format/chart'
import { toCompact } from '../../src/format/compact'
import { combineDocuments, splitFile } from '../../src/format/documents'
import { loadDocument } from '../../src/format/load'
import { PICTURE_LAYOUTS, PICTURES_ALT, PICTURES_LIMITS, graphicsAsImages, picturesDrawing, picturesFromAlt, picturesImage, pictureUri } from '../../src/format/pictures'
import { buildSchema } from '../../src/format/schema'
import { defaultTheme } from '../../src/format/theme'
import type { Block, FolioDoc, PicturesBlock } from '../../src/format/types'
import { NOW, open } from './docx-helpers'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PNG_BYTES = new Uint8Array(Buffer.from(PNG.split(',')[1], 'base64'))
const load = (blocks: unknown[], extra: Record<string, unknown> = {}): FolioDoc => {
  const r = loadDocument({ format: 'folio/doc', version: 1, blocks, ...extra }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  return r.doc
}
const TRIP = { type: 'pictures', layout: 'featured', title: 'Voyage <été> & mer', color: 'accent2', items: [{ src: PNG, caption: 'Le port', text: 'Au matin.' }, { src: PNG2, caption: 'La plage' }, { caption: 'À venir' }] }
const pics = (d: FolioDoc) => d.blocks.find((b) => b.type === 'pictures') as PicturesBlock

describe('dispositions d’images : lecture', () => {
  it('les images deviennent des ressources ; légendes, textes, titre et couleur gardés', () => {
    const d = load([TRIP])
    const b = pics(d)
    expect(b.layout).toBe('featured')
    expect(b.title).toBe('Voyage <été> & mer')
    expect(b.color).toBe('accent2')
    expect(b.items).toHaveLength(3)
    expect(b.items[0].src).toMatch(/^asset:/)
    expect(d.assets[b.items[0].src!.slice(6)]).toBe(PNG)
    expect(b.items[1].src).not.toBe(b.items[0].src)
    expect(b.items[2]).toEqual({ caption: 'À venir' })
  })

  it('tolérante : alias, chaînes, cases vides retirées, images refusées, borné', () => {
    const r = loadDocument(
      {
        format: 'folio/doc',
        version: 1,
        blocks: [
          { type: 'gallery', layout: 'banner', items: ['Seulement une légende', {}, { src: 'https://exemple.org/x.png', caption: 'Lointaine' }, { src: 'javascript:alert(1)' }, { src: PNG, caption: 'x'.repeat(500) }] },
          { type: 'collage', items: Array.from({ length: 30 }, (_, i) => `n${i}`) },
          { type: 'pictures', items: [] },
          { type: 'pictures', layout: 'nope', items: [{ caption: 'a' }] },
        ],
      },
      { now: NOW },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [a, b, c] = r.doc.blocks as PicturesBlock[]
    expect(r.doc.blocks).toHaveLength(3)
    expect(a.layout).toBe('strip')
    expect(a.items.map((it) => it.caption?.length ?? 0)).toEqual([21, 9, PICTURES_LIMITS.caption])
    // Une image distante ou un script : refusés (la légende reste).
    expect(a.items[1]).toEqual({ caption: 'Lointaine' })
    expect(a.items[2].src).toMatch(/^asset:/)
    expect(r.report.issues.some((i) => i.kind === 'ignored' && /items/.test(i.path))).toBe(true)
    expect(b.layout).toBe('mosaic')
    expect(b.items).toHaveLength(PICTURES_LIMITS.items)
    expect(c.layout).toBe('grid')
  })

  it('JSON compact, éditeur : aller-retour exact (les images restent des ressources)', () => {
    const d = load([TRIP])
    const compact = toCompact(d) as { blocks: Record<string, unknown>[] }
    expect(compact.blocks[0]).toMatchObject({ type: 'pictures', layout: 'featured', color: 'accent2' })
    expect(load(compact.blocks, { assets: d.assets }).blocks).toEqual(d.blocks)
    const back = pmToDoc(docToPM(d), { id: d.id, created: NOW, modified: NOW })
    expect(back.blocks).toEqual(d.blocks)
    expect(Object.values(back.assets).sort()).toEqual(Object.values(d.assets).sort())
  })

  it('le schéma JSON décrit le bloc « pictures »', () => {
    const s = JSON.stringify(buildSchema())
    expect(s).toContain('"const":"pictures"')
    expect(s).toContain('a picture layout')
  })
})

describe('dispositions d’images : dessin', () => {
  const look = chartLook(defaultTheme(), 'fr')
  const uri = (s: string | undefined) => pictureUri(s, { a: PNG })
  it('chaque disposition, de 1 à 12 images : un SVG valide, une image par cadre, texte échappé', () => {
    for (const layout of PICTURE_LAYOUTS) {
      for (const n of [1, 2, 3, 4, 5, 6, 7, 9, 12]) {
        const items = Array.from({ length: n }, (_, i) => ({ ...(i % 3 === 2 ? {} : { src: 'asset:a' }), caption: `Image ${i} <b> & une légende assez longue pour être coupée`, text: i % 2 ? 'Un texte <i>court</i>.' : undefined }))
        const { svg, width, height } = picturesDrawing({ type: 'pictures', layout, items, title: 'T' }, look, uri)
        expect(svg, `${layout} ${n}`).not.toMatch(/NaN|undefined|Infinity/)
        expect(svg).not.toContain('<b>')
        expect(svg).toContain('&lt;b&gt; &amp;')
        expect(width).toBe(640)
        expect(height).toBeGreaterThan(40)
        // Une image par cadre rempli ; les autres sont des cadres vides.
        expect((svg.match(/data-fp-pic=/g) ?? []).length).toBe(items.filter((it) => it.src).length)
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
        expect(doc.querySelector('parsererror')).toBeNull()
      }
    }
  })
  it('deux dessins dans la même page n’ont pas les mêmes identifiants ; une couleur pour toutes', () => {
    const b: PicturesBlock = { type: 'pictures', layout: 'grid', items: [{ src: 'asset:a' }] }
    const id = (svg: string) => /clipPath id="([^"]+)"/.exec(svg)![1]
    expect(id(picturesDrawing(b, look, uri).svg)).not.toBe(id(picturesDrawing(b, look, uri).svg))
    expect(picturesDrawing({ ...b, items: [{ caption: 'x' }], color: 'accent3' }, look, uri).svg).toContain(look.colors[2])
  })
  it('une image absente, distante ou qui n’est pas une image : un cadre vide', () => {
    expect(pictureUri('asset:absente', {})).toBeNull()
    expect(pictureUri('https://exemple.org/a.png', {})).toBeNull()
    expect(pictureUri('asset:x', { x: 'data:text/html;base64,PHNjcmlwdD4=' })).toBeNull()
    expect(pictureUri(PNG, {})).toBe(PNG)
  })
})

describe('dispositions d’images : exports et imports', () => {
  it('page web : le dessin avec ses images ; texte et Markdown : légendes et textes', () => {
    const d = load(['Avant', TRIP, 'Après'])
    const html = toHtml(d)
    expect(html).toContain('<figure class="pictures"><svg')
    expect(html).toContain('Voyage &lt;été&gt; &amp; mer')
    expect(html).toContain(PNG)
    const md = toMarkdown(d)
    expect(md.markdown).toContain('*Le port* — Au matin.')
    expect(md.markdown).toMatch(/!\[Le port\]\(images\/01-[^)]+\.png\)/)
    expect(Object.keys(md.files).length).toBe(2)
    const txt = toPlainText(d)
    expect(txt).toContain('- Le port : Au matin.')
    expect(txt).toContain('- À venir')
  })

  it('.docx et .odt : une image SVG qui redevient une disposition, avec ses images', async () => {
    const d = load(['Avant', TRIP, 'Après'])
    const docx = await exportDocx(d, { now: new Date(NOW), rasterize: async () => PNG_BYTES })
    expect(docx.losses).toEqual([])
    const fromDocx = open(docx.bytes).doc
    const a = pics(fromDocx)
    expect(a).toMatchObject({ layout: 'featured', title: 'Voyage <été> & mer', color: 'accent2' })
    expect(a.items.map((it) => [it.caption, it.text])).toEqual([
      ['Le port', 'Au matin.'],
      ['La plage', undefined],
      ['À venir', undefined],
    ])
    expect(fromDocx.assets[a.items[0].src!.slice(6)]).toBe(PNG)
    expect(fromDocx.assets[a.items[1].src!.slice(6)]).toBe(PNG2)
    expect(a.items[2].src).toBeUndefined()
    const odt = await exportOdt(d)
    const fromOdt = loadDocument(importOdt(odt.bytes).doc, { now: NOW })
    if (!fromOdt.ok) throw new Error('odt refusé')
    const o = pics(fromOdt.doc)
    expect(o.items.map((it) => it.caption)).toEqual(['Le port', 'La plage', 'À venir'])
    expect(fromOdt.doc.assets[o.items[1].src!.slice(6)]).toBe(PNG2)
  })

  it('dans une citation ou un encadré aussi ; texte de remplacement abîmé : une image ordinaire', () => {
    const d = load([{ type: 'quote', blocks: [TRIP] }, { type: 'callout', blocks: [TRIP] }])
    const g = graphicsAsImages(d, chartLook(d.theme, 'fr'))
    const imgs: Block[] = []
    const walk = (bs: Block[]) => bs.forEach((b) => (b.type === 'image' ? imgs.push(b) : b.type === 'table' ? b.rows.flat().forEach((c) => walk(c.blocks)) : 'blocks' in b ? walk((b as { blocks: Block[] }).blocks) : null))
    walk(g.blocks)
    expect(imgs).toHaveLength(2)
    expect((imgs[0] as { alt: string }).alt.startsWith(PICTURES_ALT)).toBe(true)
    expect(picturesFromAlt(PICTURES_ALT + '{abîmé', null)).toBeNull()
    expect(picturesFromAlt('une photo', null)).toBeNull()
    const { block, data } = picturesImage(pics(d.blocks[1].type === 'callout' ? { ...d, blocks: d.blocks[1].blocks } : d), chartLook(d.theme, 'fr'), d.assets)
    expect(block.width).toBeLessThanOrEqual(468)
    expect(picturesFromAlt(block.alt, data)).toMatchObject({ type: 'pictures', layout: 'featured' })
  })

  it('tous les documents réunis : les images des documents suivants sont renommées', () => {
    const a = load([TRIP])
    const b = load([TRIP])
    const c = combineDocuments(splitFile({ ...a, key: 'a', documents: [{ ...b, key: 'b' }] })).doc
    const srcs = c.blocks.filter((x) => x.type === 'pictures').flatMap((x) => (x as PicturesBlock).items.map((it) => it.src).filter(Boolean)) as string[]
    expect(srcs).toHaveLength(4)
    for (const s of srcs) expect(c.assets[s.slice(6)]).toMatch(/^data:image\/png/)
    expect(new Set(srcs).size).toBe(4)
  })
})
