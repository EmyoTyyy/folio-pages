// @vitest-environment jsdom
// Fonctions ajoutées en 0.10 : effets du texte, lettrine, césure, filigrane,
// retouches d'image, Atteindre, mise en forme semblable, nombres, page de
// garde, ligne de signature.

import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { EditorState, TextSelection } from 'prosemirror-state'
import { exportDocx } from '../../src/docx/export'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { MultiRangeSelection } from '../../src/editor/multiselect'
import { schema } from '../../src/editor/schema'
import { setMark } from '../../src/editor/commands'
import { toHtml } from '../../src/export/html'
import { exportOdt } from '../../src/export/odt'
import { toCompact } from '../../src/format/compact'
import { loadDocument } from '../../src/format/load'
import { adjustCss, cleanAdjust, colorFilter, hasColorAdjust } from '../../src/format/picture'
import type { FolioDoc } from '../../src/format/types'
import { coverBlocks, COVERS, signatureBlocks } from '../../src/ui/inserttools'
import { englishWords, formatNumber, frenchWords, similarRanges, targetsOf } from '../../src/ui/navtools'
import { NOW, open, parts } from './docx-helpers'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR42mP8z8Dwn4EIwDiqEAD6/QX9zp5mQwAAAABJRU5ErkJggg=='

function load(input: Record<string, unknown>): FolioDoc {
  const r = loadDocument({ format: 'folio/doc', version: 1, meta: { title: 'Essai', lang: 'fr' }, ...input }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  expect(r.report.issues).toEqual([])
  return r.doc
}
/** Aller-retour par l'éditeur : ce qui entre ressort pareil. */
const viaEditor = (d: FolioDoc) => pmToDoc(docToPM(d), { id: d.id, created: d.meta.created, modified: d.meta.modified })

const RICH = {
  hyphenate: true,
  watermark: { text: 'BROUILLON', color: 'accent2', diagonal: true, opacity: 30 },
  assets: { pic: `data:image/png;base64,${PNG}` },
  blocks: [
    {
      content: [
        { text: 'Souligné double', underline: true, underlineStyle: 'double', underlineColor: '#cc0000' },
        ' et ',
        { text: 'ondulé', underline: true, underlineStyle: 'wavy' },
        ' ',
        { text: 'contour', outline: true },
        ' ',
        { text: 'ombre', shadow: true },
        ' ',
        { text: 'halo', glow: 'accent1' },
        ' ',
        { text: 'encadré', textBorder: 'text' },
        ' ',
        { text: 'tramé', textShading: '#d9d9d9' },
      ],
    },
    { text: 'Il était une fois un texte avec une lettrine.', dropCap: 3 },
    { type: 'image', src: 'asset:pic', alt: 'Point', adjust: { brightness: 20, contrast: -20, recolor: 'sepia', transparency: 30, shadow: true, glow: 'accent3', softEdges: 5 } },
  ],
}

describe('format : effets du texte, lettrine, césure, filigrane, retouches', () => {
  it('se charge sans perte, passe par l’éditeur et revient identique', () => {
    const d = load(RICH)
    const runs = (d.blocks[0] as unknown as { content: Record<string, unknown>[] }).content
    expect(runs[0]).toMatchObject({ underline: true, underlineStyle: 'double', underlineColor: '#cc0000' })
    expect(runs[4]).toMatchObject({ outline: true })
    expect(runs[8]).toMatchObject({ glow: 'accent1' })
    expect(d.blocks[1]).toMatchObject({ dropCap: 3 })
    expect(d.hyphenate).toBe(true)
    expect(d.watermark).toEqual({ text: 'BROUILLON', color: 'accent2', diagonal: true, opacity: 30, size: 0, scale: 70 })
    expect((d.blocks[2] as { adjust: unknown }).adjust).toEqual({ brightness: 20, contrast: -20, recolor: 'sepia', transparency: 30, shadow: true, glow: 'accent3', softEdges: 5 })
    const back = viaEditor(d)
    expect(back.blocks).toEqual(d.blocks)
    expect(back.watermark).toEqual(d.watermark)
    expect(back.hyphenate).toBe(true)
    // La forme compacte garde tout, sans les valeurs par défaut.
    const c = toCompact(d) as Record<string, unknown>
    expect(c.watermark).toEqual({ text: 'BROUILLON', color: 'accent2', opacity: 30 })
    expect(c.hyphenate).toBe(true)
  })

  it('valeurs bornées ou refusées', () => {
    const r = loadDocument({ format: 'folio/doc', version: 1, blocks: [{ text: 'x', dropCap: 40 }, { content: [{ text: 'y', underlineStyle: 'zigzag', glow: 'pas une couleur' }] }], watermark: { text: '' } }, { now: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect((r.doc.blocks[0] as { dropCap?: number }).dropCap ?? 0).toBeLessThanOrEqual(10)
    expect((r.doc.blocks[1] as { content: object[] }).content[0]).toEqual({ text: 'y' })
    expect(r.doc.watermark).toBeUndefined()
    expect(r.report.ignored + r.report.warnings).toBeGreaterThanOrEqual(2)
  })

  it('filigrane image : l’image suit le document', () => {
    const d = load({ assets: { wm: `data:image/png;base64,${PNG}` }, watermark: { image: 'asset:wm', scale: 50 }, blocks: ['x'] })
    expect(d.watermark?.image).toBe('asset:wm')
    expect(Object.keys(d.assets)).toEqual(['wm'])
    const back = viaEditor(d)
    expect(back.watermark?.image).toMatch(/^asset:/)
    expect(back.assets[back.watermark!.image!.slice(6)]).toBe(`data:image/png;base64,${PNG}`)
  })

  it('retouches : bornes, filtre CSS, transparence, bords adoucis', () => {
    expect(cleanAdjust({ brightness: 300, saturation: 100, transparency: -5, recolor: 'rainbow', artistic: 'pencil' }, (c) => c)).toEqual({ brightness: 100, artistic: 'pencil' })
    expect(cleanAdjust({}, (c) => c)).toBeNull()
    expect(colorFilter({ brightness: 20, contrast: -40, saturation: 0, recolor: 'grayscale' })).toBe('brightness(1.20) contrast(0.60) saturate(0.00) grayscale(1)')
    const css = adjustCss({ transparency: 25, shadow: true, glow: '#ff0000', softEdges: 10 }, (c) => c)
    expect(css.opacity).toBe('0.75')
    expect(css.filter).toContain('drop-shadow(0 0 5px #ff0000)')
    expect(css['mask-image']).toContain('10pt')
    expect(hasColorAdjust({ shadow: true })).toBe(false)
    expect(hasColorAdjust({ brightness: 5 })).toBe(true)
  })
})

describe('.docx', () => {
  it('écrit les effets du texte à leur place, la lettrine, la césure et le filigrane', async () => {
    const d = load(RICH)
    const out = await exportDocx(d, { now: new Date(NOW) })
    const p = parts(out.bytes)
    const xml = p['word/document.xml']
    expect(xml).toContain('<w:u w:val="double" w:color="CC0000"/>')
    expect(xml).toContain('<w:u w:val="wave"/>')
    // Contour et ombre avant la couleur et la taille (ordre du schéma), halo à la fin de w:rPr.
    expect(xml).toMatch(/<w:rPr><w:outline\/>(<w:[a-zA-Z]+[^>]*>)*<\/w:rPr><w:t[^>]*>contour/)
    expect(xml).toMatch(/<w:rPr>(?:(?!<\/w:rPr>).)*<w14:glow w14:rad="63500"><w14:srgbClr w14:val="[0-9A-F]{6}">/)
    expect(xml).not.toContain('FolioFx')
    expect(xml).toMatch(/<w:bdr w:val="single"[^>]*\/>/)
    expect(xml).toMatch(/<w:shd [^>]*w:color="D9D9D9"[^>]*w:val="solid"|<w:shd [^>]*w:val="solid"[^>]*w:color="D9D9D9"/)
    expect(xml).toMatch(/<w:framePr [^>]*w:dropCap="drop"[^>]*w:lines="3"/)
    expect(p['word/settings.xml']).toContain('<w:autoHyphenation/>')
    const header = Object.entries(p).find(([k]) => /^word\/header\d+\.xml$/.test(k))![1]
    expect(header).toContain('string="BROUILLON"')
    expect(header).toContain('rotation:315')
    expect(header).toMatch(/xmlns:v="urn:schemas-microsoft-com:vml"/)
    // Chaque partie reste un XML bien formé (un en-tête vide s'écrit <w:hdr …/>).
    for (const [k, v] of Object.entries(p)) if (k.endsWith('.xml')) expect(new DOMParser().parseFromString(v, 'application/xml').getElementsByTagName('parsererror'), k).toHaveLength(0)
    // Sans moyen de recalculer l'image ici, les retouches sont signalées.
    expect(out.losses.map((l) => l.code)).toContain('picture-effects')
  })

  it('aller-retour : effets, lettrine, césure et filigrane reviennent', async () => {
    const d = load({ ...RICH, blocks: RICH.blocks.slice(0, 2) })
    const back = open((await exportDocx(d, { now: new Date(NOW) })).bytes).doc
    const runs = (back.blocks[0] as unknown as { content: Record<string, unknown>[] }).content
    const by = (text: string) => runs.find((r) => r.text === text)!
    expect(by('Souligné double')).toMatchObject({ underline: true, underlineStyle: 'double', underlineColor: '#cc0000' })
    expect(by('ondulé')).toMatchObject({ underlineStyle: 'wavy' })
    expect(by('contour')).toMatchObject({ outline: true })
    expect(by('ombre')).toMatchObject({ shadow: true })
    expect(by('halo').glow).toMatch(/^#[0-9a-f]{6}$/)
    expect(by('encadré').textBorder).toBeTruthy()
    expect(by('tramé')).toMatchObject({ textShading: '#d9d9d9' })
    expect(back.blocks[1]).toMatchObject({ dropCap: 3 })
    expect((back.blocks[1] as { content: { text: string }[] }).content.map((r) => r.text).join('')).toBe('Il était une fois un texte avec une lettrine.')
    expect(back.hyphenate).toBe(true)
    expect(back.watermark).toMatchObject({ text: 'BROUILLON', diagonal: true, opacity: 30 })
    // L'en-tête ne garde pas de paragraphe vide pour le filigrane.
    expect(back.headers.default).toEqual([])
  })

  it('l’image retouchée est redessinée quand l’application le peut', async () => {
    const d = load({ assets: { pic: `data:image/png;base64,${PNG}` }, blocks: [{ type: 'image', src: 'asset:pic', alt: 'p', adjust: { recolor: 'grayscale' } }] })
    const baked = new Uint8Array(Buffer.from(PNG, 'base64'))
    const out = await exportDocx(d, { now: new Date(NOW), bake: async () => baked })
    expect(out.losses).toEqual([])
    const media = Object.keys(unzipSync(out.bytes)).filter((n) => n.startsWith('word/media/'))
    expect(media).toHaveLength(1)
  })
})

describe('autres exports', () => {
  it('ODT : lettrine native, césure, contour, double soulignement, ombre de l’image ; filigrane signalé', async () => {
    const r = await exportOdt(load(RICH))
    const files = unzipSync(r.bytes)
    const content = strFromU8(files['content.xml'])
    expect(content).toContain('<style:drop-cap style:lines="3" style:length="1"')
    expect(content).toContain('style:text-outline="true"')
    expect(content).toContain('style:text-underline-type="double"')
    expect(content).toContain('draw:shadow="visible"')
    expect(strFromU8(files['styles.xml'])).toContain('fo:hyphenate="true"')
    expect(r.losses.map((l) => l.code).sort()).toEqual(['picture-adjust', 'watermark'])
  })

  it('page web : effets, lettrine, retouches en CSS, césure', () => {
    const html = toHtml(load(RICH))
    expect(html).toContain('-webkit-text-stroke:0.045em currentColor')
    expect(html).toContain('text-decoration-style:double')
    expect(html).toContain('data-dropcap="3"')
    expect(html).toContain('filter:brightness(1.20) contrast(0.80) sepia(1)')
    expect(html).toContain('opacity:0.7')
    expect(html).toContain('hyphens:auto')
  })
})

describe('Atteindre, mise en forme semblable', () => {
  const pm = () =>
    docToPM(
      load({
        blocks: [
          { type: 'heading', level: 1, text: 'Un' },
          { content: [{ text: 'gras', bold: true }, ' normal ', { text: 'encore', bold: true }, { type: 'bookmark', name: 'Ici' }] },
          { type: 'heading', level: 2, text: 'Deux' },
          { content: ['texte', { type: 'note', text: 'note' }, ' et ', { text: 'gras', bold: true }] },
          { type: 'table', rows: [['a']] },
          { type: 'equation', tex: 'x' },
        ],
      }),
    )

  it('cibles de chaque sorte, dans l’ordre', () => {
    const doc = pm()
    expect(targetsOf(doc, 'heading').map((x) => x.name)).toEqual(['Un', 'Deux'])
    expect(targetsOf(doc, 'bookmark').map((x) => x.name)).toEqual(['Ici'])
    expect(targetsOf(doc, 'footnote')).toHaveLength(1)
    expect(targetsOf(doc, 'endnote')).toHaveLength(0)
    expect(targetsOf(doc, 'table')).toHaveLength(1)
    expect(targetsOf(doc, 'equation')).toHaveLength(1)
  })

  it('texte de même mise en forme : tous les passages en gras, et la mise en forme s’applique à chacun', () => {
    const doc = pm()
    let pos = 0
    doc.descendants((n, p) => {
      if (!pos && n.isText && n.text === 'gras') pos = p
    })
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, pos + 1) })
    const ranges = similarRanges(state)
    expect(ranges.map((r) => doc.textBetween(r.from, r.to))).toEqual(['gras', 'encore', 'gras'])
    const { SelectionRange } = require('prosemirror-state') as typeof import('prosemirror-state')
    const multi = new MultiRangeSelection(ranges.map((r) => new SelectionRange(doc.resolve(r.from), doc.resolve(r.to))))
    let next = state.apply(state.tr.setSelection(multi))
    setMark(schema.marks.color, { value: '#ff0000' })(next, (tr) => (next = next.apply(tr)))
    const colored: string[] = []
    next.doc.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type === schema.marks.color)) colored.push(n.text!)
    })
    expect(colored).toEqual(['gras', 'encore', 'gras'])
  })
})

describe('nombres', () => {
  it('en lettres, en français (rectifications de 1990) et en anglais', () => {
    const fr: [number, string][] = [
      [0, 'zéro'],
      [16, 'seize'],
      [21, 'vingt-et-un'],
      [71, 'soixante-et-onze'],
      [80, 'quatre-vingts'],
      [81, 'quatre-vingt-un'],
      [99, 'quatre-vingt-dix-neuf'],
      [100, 'cent'],
      [200, 'deux-cents'],
      [201, 'deux-cent-un'],
      [1000, 'mille'],
      [2000, 'deux-mille'],
      [80000, 'quatre-vingt-mille'],
      [1234, 'mille-deux-cent-trente-quatre'],
      [1000000, 'un-million'],
      [2500000, 'deux-millions-cinq-cent-mille'],
    ]
    for (const [n, w] of fr) expect(frenchWords(n), String(n)).toBe(w)
    expect(englishWords(1234)).toBe('one thousand two hundred and thirty-four')
    expect(englishWords(1000005)).toBe('one million and five')
  })

  it('formats : chiffres, lettres, ordinaux, romains, lettres de l’alphabet', () => {
    expect(formatNumber(1234.5, 'digits', 'fr')).toBe('1 234,5')
    expect(formatNumber(1234.5, 'digits', 'en')).toBe('1,234.5')
    expect(formatNumber(12.5, 'words', 'fr')).toBe('douze virgule cinquante')
    expect(formatNumber(1, 'ordinal', 'fr')).toBe('1er')
    expect(formatNumber(2, 'ordinal', 'fr')).toBe('2e')
    expect(formatNumber(22, 'ordinal', 'en')).toBe('22nd')
    expect(formatNumber(13, 'ordinal', 'en')).toBe('13th')
    expect(formatNumber(1, 'ordinalWords', 'fr')).toBe('premier')
    expect(formatNumber(5, 'ordinalWords', 'fr')).toBe('cinquième')
    expect(formatNumber(9, 'ordinalWords', 'fr')).toBe('neuvième')
    expect(formatNumber(21, 'ordinalWords', 'fr')).toBe('vingt-et-unième')
    expect(formatNumber(80, 'ordinalWords', 'fr')).toBe('quatre-vingtième')
    expect(formatNumber(12, 'ordinalWords', 'en')).toBe('twelfth')
    expect(formatNumber(40, 'ordinalWords', 'en')).toBe('fortieth')
    expect(formatNumber(1994, 'ROMAN', 'fr')).toBe('MCMXCIV')
    expect(formatNumber(4000, 'roman', 'fr')).toBeNull()
    expect(formatNumber(28, 'alpha', 'fr')).toBe('ab')
    expect(formatNumber(2.5, 'roman', 'fr')).toBeNull()
  })
})

describe('page de garde, ligne de signature', () => {
  it('chaque page de garde se charge sans perte et finit par un saut de page', () => {
    for (const id of COVERS) {
      for (const fr of [true, false]) {
        const d = load({ meta: { title: 'Rapport', author: 'Ana', lang: fr ? 'fr' : 'en' }, blocks: coverBlocks(id, fr) })
        expect(d.blocks[d.blocks.length - 1].type, id).toBe('pagebreak')
        expect(JSON.stringify(d.blocks), id).toContain('"name":"title"')
      }
    }
  })

  it('ligne de signature : trait, nom, fonction ; la signature tracée devient une image', () => {
    const d = load({ blocks: signatureBlocks({ name: 'Ana Duval', title: 'Directrice', email: '', date: true, image: `data:image/png;base64,${PNG}` }, true) })
    expect(d.blocks[0]).toMatchObject({ type: 'image', width: 160, alt: 'Signature de Ana Duval' })
    expect(JSON.stringify(d.blocks[1])).toContain('X ___')
    expect(JSON.stringify(d.blocks)).toContain('Ana Duval')
    expect(JSON.stringify(d.blocks)).toContain('"name":"date"')
  })
})
