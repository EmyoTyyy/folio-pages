// @vitest-environment jsdom
// Formes et zones de texte : la bibliothèque, le format (lecture tolérante,
// valeurs par défaut, identifiants), l'éditeur, le dessin, les exports et imports.

import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { exportDocx } from '../../src/docx/export'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { toHtml } from '../../src/export/html'
import { exportOdt } from '../../src/export/odt'
import { toMarkdown, toPlainText } from '../../src/export/text'
import { importOdt } from '../../src/file/odt-import'
import { toCompact } from '../../src/format/compact'
import { loadDocument, loadShape } from '../../src/format/load'
import { buildSchema } from '../../src/format/schema'
import { shapeSvg } from '../../src/format/shapedraw'
import { SHAPES, SHAPE_CATEGORIES, SHAPE_KINDS, isLineKind, shapeDefaults, shapeGeom } from '../../src/format/shapes'
import type { Block, FolioDoc, Inline, ShapeInline } from '../../src/format/types'
import { NOW, open } from './docx-helpers'

const load = (blocks: unknown[], extra: Record<string, unknown> = {}): FolioDoc => {
  const r = loadDocument({ format: 'folio/doc', version: 1, blocks, ...extra }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  return r.doc
}
const shapesOf = (b: Block | undefined): ShapeInline[] => (b && b.type === 'paragraph' ? (b.content.filter((x: Inline) => 'type' in x && x.type === 'shape') as ShapeInline[]) : [])
const SAMPLE = [
  {
    content: [
      { type: 'textbox', x: 300, y: 4, width: 160, height: 90, md: 'Une **zone** de texte\n\n- un\n- deux', valign: 'bottom' },
      { type: 'shape', shape: 'star5', x: 10, y: 0, fill: 'accent2', line: '#123456', lineWidth: 2.25, rotate: 30, flip: 'h', wrap: 'behind', shadow: true, transparency: 40, name: 'Étoile', alt: 'Une étoile' },
      { type: 'group', x: 20, y: 120, wrap: 'topBottom', children: [{ type: 'shape', shape: 'flowChartDecision', x: 0, y: 0, width: 100, height: 60, text: 'Oui ?' }, { type: 'shape', shape: 'line', x: 100, y: 30, width: 60, height: 0, tail: 'triangle', dash: 'dash' }] },
      'Le texte du paragraphe.',
      { type: 'shape', shape: 'rightArrow', wrap: 'inline', width: 40, height: 20 },
    ],
  },
]

describe('formes : la bibliothèque', () => {
  it('chaque forme se dessine (chemin fini, M L C Z seulement), à toutes les tailles', () => {
    expect(SHAPES.length).toBeGreaterThanOrEqual(140)
    expect(new Set(SHAPES.map((s) => s.id)).size).toBe(SHAPES.length)
    for (const s of SHAPES) {
      expect(SHAPE_CATEGORIES).toContain(s.cat)
      for (const [w, h] of [[100, 60], [60, 100], [20, 0.01], [1, 1], [500, 30]]) {
        const g = shapeGeom(s.id, w, h)
        for (const d of [g.d, g.x, g.dark, g.light].filter(Boolean) as string[]) {
          expect(d, `${s.id} ${w}×${h}`).not.toMatch(/NaN|Infinity|undefined/)
          expect(d.replace(/[MLCZ]|-?\d+(\.\d+)?(e-?\d+)?|\s/g, ''), s.id).toBe('')
        }
      }
    }
    // Une forme inconnue : un rectangle.
    expect(shapeGeom('inconnue', 10, 10).d).toBe(shapeGeom('rect', 10, 10).d)
    expect(isLineKind('line') && isLineKind('bentConnector3') && !isLineKind('rect')).toBe(true)
  })

  it('le dessin : flèches au bout des traits, tirets, contour plus sombre, transparence, retournement', () => {
    const paint = { color: (c: string) => (c.startsWith('#') ? c : `var(--${c})`), hex: (c: string) => (c.startsWith('#') ? c : '#3366cc') }
    const line = shapeSvg({ type: 'shape', shape: 'line', id: 'l', x: 0, y: 0, width: 100, height: 0, line: '#ff0000', lineWidth: 2, tail: 'triangle', head: 'oval', dash: 'dash' }, paint)
    expect(line).toContain('stroke-dasharray')
    expect(line).toContain('<ellipse')
    expect((line.match(/fill="#ff0000"/g) ?? []).length).toBe(2)
    const box = shapeSvg({ type: 'shape', shape: 'rect', id: 'r', x: 0, y: 0, width: 50, height: 50, fill: 'accent1', line: 'accent1', transparency: 25, flip: 'hv' }, paint)
    expect(box).toContain('fill-opacity="0.75"')
    expect(box).toContain('stroke="#254993"')
    expect(box).toContain('scale(-1 -1)')
  })
})

describe('formes : le format', () => {
  it('lecture tolérante : alias, valeurs par défaut selon la forme, bornes', () => {
    const r = loadDocument({ format: 'folio/doc', version: 1, blocks: [{ content: [{ type: 'textbox', text: 'A' }, { type: 'shape', shape: 'circle' }, { type: 'shape', shape: 'arrow', width: 99999, rotate: -90, fill: 'NONE', z: 3 }, { type: 'shape', shape: 'line' }, { type: 'drawing', shape: 'cylindre' }] }] }, { now: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [tb, el, ar, ln, unk] = shapesOf(r.doc.blocks[0])
    expect(tb).toMatchObject({ shape: 'textBox', wrap: 'square', fill: '#ffffff', line: 'text', lineWidth: 0.75, valign: 'top', width: 144, height: 72 })
    expect(tb.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'A' }] }])
    expect(el).toMatchObject({ shape: 'ellipse', wrap: 'front', fill: 'accent1', width: 72, height: 72 })
    expect(ar).toMatchObject({ shape: 'rightArrow', width: 3000, rotate: 270, fill: 'none', z: 3 })
    expect(ln).toMatchObject({ shape: 'line', height: 0, lineWidth: 1.5 })
    expect(ln.fill).toBeUndefined()
    expect(unk.shape).toBe('rect')
    expect(r.report.issues.some((i) => i.kind === 'ignored' && /shape/.test(i.path))).toBe(true)
  })

  it('identifiants uniques ; pas de forme dans un en-tête, une note ou une autre forme', () => {
    const r = loadDocument(
      {
        format: 'folio/doc',
        version: 1,
        headers: { default: [{ content: [{ type: 'shape', shape: 'rect' }, 'En-tête'] }] },
        blocks: [{ content: [{ type: 'shape', id: 'a' }, { type: 'shape', id: 'a' }, { type: 'note', blocks: [{ content: [{ type: 'shape' }, 'note'] }] }, { type: 'textbox', blocks: [{ content: [{ type: 'shape' }, 'dedans'] }] }] }],
      },
      { now: NOW },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const sh = shapesOf(r.doc.blocks[0])
    expect(sh.map((s) => s.id)).toEqual(['a', expect.stringMatching(/^shape\d+$/), expect.anything()])
    expect(new Set(sh.map((s) => s.id)).size).toBe(3)
    expect(JSON.stringify(r.doc.headers)).not.toContain('"shape"')
    expect(JSON.stringify(sh[2].blocks)).not.toContain('"shape"')
    expect(r.report.issues.filter((i) => i.code === 'note-flattened' && i.detail === 'shape').length).toBe(3)
  })

  it('JSON compact (valeurs par défaut omises), éditeur : aller-retour exact ; schéma JSON', () => {
    const d = load(SAMPLE)
    const c = JSON.stringify(toCompact(d))
    expect(c).toContain('"shape":"textBox"')
    expect(c).not.toContain('"lineWidth":0.75')
    expect(load((toCompact(d) as { blocks: unknown[] }).blocks).blocks).toEqual(d.blocks)
    expect(pmToDoc(docToPM(d), { id: d.id, created: NOW, modified: NOW }).blocks).toEqual(d.blocks)
    const schema = JSON.stringify(buildSchema())
    expect(schema).toContain('"textBox"')
    expect(schema).toContain('"flowChartDecision"')
    expect(SHAPE_KINDS).toContain('group')
    // Une forme collée d'ailleurs : vérifiée comme dans un fichier.
    expect(loadShape({ shape: 'ellipse', fill: 'javascript:alert(1)' })?.fill).toBe('accent1')
    expect(loadShape(null)).toBeNull()
    expect(shapeDefaults('textBox').wrap).toBe('square')
  })
})

describe('formes : exports et imports', () => {
  it('.docx : de vraies formes de Word, relues comme formes (texte, groupe, couleurs, habillage)', async () => {
    const d = load(SAMPLE)
    const out = await exportDocx(d, { now: new Date(NOW) })
    expect(out.losses).toEqual([])
    const xml = strFromU8(unzipSync(out.bytes)['word/document.xml'])
    expect(xml).not.toMatch(/FOLIOSHAPE|FOLIOTXBX/)
    expect(xml).toContain('<a:prstGeom prst="star5">')
    expect(xml).toContain('<wps:cNvSpPr txBox="1"/>')
    expect(xml).toContain('<wpg:wgp>')
    expect(xml).toContain('behindDoc="1"')
    expect(xml).toContain('<wp:wrapTopAndBottom/>')
    expect(xml).toContain('<wp:inline')
    expect(xml).toMatch(/xmlns:wps=/)
    const back = open(out.bytes)
    expect(back.issues).toEqual([])
    const [tb, star, grp, arrow] = shapesOf(back.doc.blocks[0])
    expect(tb).toMatchObject({ shape: 'textBox', x: 300, y: 4, width: 160, height: 90, wrap: 'square', valign: 'bottom', lineWidth: 0.75 })
    expect(tb.blocks?.map((b) => b.type)).toEqual(['paragraph', 'list'])
    expect(star).toMatchObject({ shape: 'star5', fill: 'accent2', line: '#123456', lineWidth: 2.25, rotate: 30, flip: 'h', wrap: 'behind', shadow: true, transparency: 40, name: 'Étoile', alt: 'Une étoile' })
    expect(grp.shape).toBe('group')
    expect(grp.children?.map((k) => [k.shape, k.x, k.y, k.width])).toEqual([
      ['flowChartDecision', 0, 0, 100],
      ['line', 100, 30, 60],
    ])
    expect(grp.children?.[1]).toMatchObject({ tail: 'triangle', dash: 'dash' })
    expect(arrow).toMatchObject({ shape: 'rightArrow', wrap: 'inline' })
    // L'ordre de superposition est gardé.
    expect((star.z ?? 0) < (grp.z ?? 0)).toBe(true)
    // Le texte du paragraphe reste à sa place.
    expect(JSON.stringify(back.doc.blocks[0])).toContain('Le texte du paragraphe.')
  })

  it('.odt : des formes de LibreOffice, relues telles quelles', async () => {
    const d = load(SAMPLE)
    const out = await exportOdt(d)
    const xml = strFromU8(unzipSync(out.bytes)['content.xml'])
    expect(xml).toContain('<draw:custom-shape')
    expect(xml).toContain('draw:enhanced-path="M')
    expect(xml).toContain('<draw:g')
    const back = loadDocument(importOdt(out.bytes).doc, { now: NOW })
    if (!back.ok) throw new Error('odt refusé')
    const sh = shapesOf(back.doc.blocks[0])
    expect(sh.map((s) => s.shape)).toEqual(['textBox', 'star5', 'group', 'rightArrow'])
    expect(sh[1]).toMatchObject({ rotate: 30, fill: 'accent2', wrap: 'behind' })
  })

  it('page web : le dessin, le texte, la zone d’habillage ; texte et Markdown : le texte des zones', () => {
    const d = load(SAMPLE)
    const html = toHtml(d)
    expect(html).toContain('class="shape"')
    expect(html).toContain('class="shape-zone"')
    expect(html).toContain('Une <strong>zone</strong>')
    expect(html).toMatch(/<p[^>]*position:relative/)
    const md = toMarkdown(d).markdown
    expect(md).toContain('> Une **zone** de texte')
    expect(md).toContain('Le texte du paragraphe.')
    const txt = toPlainText(d)
    expect(txt).toContain('Oui ?')
    expect(txt).toContain('Une zone de texte')
  })
})

// --- images libres ----------------------------------------------------------------------

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGM4oaEBRwzIHAB22gjB9Lr9UAAAAABJRU5ErkJggg=='
const PICS = [
  {
    content: [
      { type: 'shape', shape: 'picture', src: PNG, x: 200, y: 10, width: 120, height: 60, alt: 'Une photo', crop: { left: 10, right: 0, top: 0, bottom: 0 }, adjust: { recolor: 'grayscale' }, line: 'accent2', lineWidth: 2 },
      { type: 'group', x: 0, y: 100, wrap: 'front', children: [{ type: 'shape', shape: 'picture', src: PNG, x: 0, y: 0, width: 80, height: 40, alt: 'Dans le groupe' }, { type: 'shape', shape: 'ellipse', x: 90, y: 0, width: 40, height: 40 }] },
      'Le texte autour.',
    ],
  },
]

describe('images libres', () => {
  it('le format : l’image dans les ressources, valeurs par défaut, sans image : ignorée ; JSON compact ; éditeur', () => {
    const d = load(PICS)
    const [pic, grp] = shapesOf(d.blocks[0])
    expect(pic).toMatchObject({ shape: 'picture', wrap: 'square', fill: 'none', line: 'accent2', lineWidth: 2, crop: { left: 10, right: 0, top: 0, bottom: 0 }, adjust: { recolor: 'grayscale' }, alt: 'Une photo' })
    expect(pic.src).toMatch(/^asset:/)
    expect(d.assets[pic.src!.slice(6)]).toBe(PNG)
    expect(grp.children?.[0].src).toBe(pic.src)
    expect(pic.blocks).toBeUndefined()
    // Sans image : rien.
    expect(shapesOf(load([{ content: [{ type: 'shape', shape: 'picture', x: 0, y: 0 }, 'x'] }]).blocks[0])).toEqual([])
    // Alias : « freepicture », « image ».
    expect(shapesOf(load([{ content: [{ type: 'freepicture', src: PNG }, 'x'] }]).blocks[0])[0]?.shape).toBe('picture')
    expect(shapesOf(load([{ content: [{ type: 'shape', shape: 'image', src: PNG }, 'x'] }]).blocks[0])[0]?.shape).toBe('picture')
    const c = toCompact(d) as { blocks: unknown[]; assets: Record<string, string> }
    expect(JSON.stringify(c)).not.toContain('"wrap":"square"')
    expect(load(c.blocks, { assets: c.assets }).blocks).toEqual(d.blocks)
    // L'éditeur garde l'image (URI data:) et rend la même ressource.
    const pm = docToPM(d)
    let data: ShapeInline | null = null
    pm.descendants((n) => {
      if (n.type.name === 'shape' && !data) data = n.attrs.data as ShapeInline
    })
    expect(data!.src).toBe(PNG)
    const back = pmToDoc(pm, { id: d.id, created: NOW, modified: NOW })
    expect(back.blocks).toEqual(d.blocks)
    expect(back.assets).toEqual(d.assets)
    // Une image libre collée : l'image reste là.
    expect(loadShape({ shape: 'picture', src: PNG })?.src).toBe(PNG)
    expect(JSON.stringify(buildSchema())).toContain('"picture"')
  })

  it('.docx : une image ancrée (position depuis la colonne et le paragraphe), relue comme image libre ; dans un groupe aussi', async () => {
    const d = load(PICS)
    const out = await exportDocx(d, { now: new Date(NOW), bake: async () => Uint8Array.from(atob(PNG.split(',')[1]), (ch) => ch.charCodeAt(0)) })
    const files = unzipSync(out.bytes)
    const xml = strFromU8(files['word/document.xml'])
    expect(xml).toMatch(/<wp:anchor[^>]*>.*<wp:positionH relativeFrom="column"><wp:posOffset>2540000<\/wp:posOffset>/s)
    expect(xml).toContain('<pic:pic')
    expect(xml).toMatch(/<wpg:wgp>.*<pic:pic.*r:embed="rIdFolioPic1"/s)
    expect(Object.keys(files).some((k) => /^word\/media\/folio-shape-pic1\.png$/.test(k))).toBe(true)
    expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain('rIdFolioPic1')
    const back = open(out.bytes)
    const [pic, grp] = shapesOf(back.doc.blocks[0])
    // Le contour revient en couleur fixe (comme celui d'une image du texte).
    expect(pic).toMatchObject({ shape: 'picture', x: 200, y: 10, width: 120, height: 60, wrap: 'square', alt: 'Une photo', line: expect.stringMatching(/^#[0-9a-f]{6}$/), lineWidth: 2 })
    expect(pic.crop).toMatchObject({ left: 10 })
    expect(back.doc.assets[pic.src!.slice(6)]).toMatch(/^data:image\/png/)
    expect(grp.shape).toBe('group')
    expect(grp.children?.map((k) => k.shape)).toEqual(['picture', 'ellipse'])
    expect(grp.children?.[0]).toMatchObject({ x: 0, y: 0, width: 80, height: 40, alt: 'Dans le groupe' })
    expect(back.doc.assets[grp.children![0].src!.slice(6)]).toMatch(/^data:image\/png/)
    expect(JSON.stringify(back.doc.blocks[0])).toContain('Le texte autour.')
  })

  it('.odt : un cadre d’image placé, relu tel quel (groupe compris)', async () => {
    const d = load(PICS)
    const out = await exportOdt(d)
    const xml = strFromU8(unzipSync(out.bytes)['content.xml'])
    expect(xml).toMatch(/<draw:frame[^>]*svg:x="200pt"[^>]*><draw:image/)
    const back = loadDocument(importOdt(out.bytes).doc, { now: NOW })
    if (!back.ok) throw new Error('odt refusé')
    const [pic, grp] = shapesOf(back.doc.blocks[0])
    expect(pic).toMatchObject({ shape: 'picture', x: 200, y: 10, width: 120, height: 60, alt: 'Une photo' })
    expect(back.doc.assets[pic.src!.slice(6)]).toMatch(/^data:image\/png/)
    expect(back.doc.assets[grp.children![0].src!.slice(6)]).toMatch(/^data:image\/png/)
  })

  it('page web : l’image rognée et retouchée ; Markdown : l’image ; texte : son texte de remplacement', () => {
    const d = load(PICS)
    const html = toHtml(d)
    expect(html).toContain('class="shape-picture"')
    expect(html).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="Une photo"/)
    expect(html).toContain('grayscale(1)')
    const md = toMarkdown(d)
    expect(md.markdown).toMatch(/!\[Une photo\]\(images\/01-[^)]+\.png\)/)
    expect(Object.keys(md.files).length).toBe(1)
    expect(toPlainText(d)).toContain('[Une photo]')
  })
})
