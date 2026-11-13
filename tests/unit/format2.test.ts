import { describe, expect, it } from 'vitest'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { schema } from '../../src/editor/schema'
import { isColor, parseColor, parseHighlight } from '../../src/format/color'
import { toCompact } from '../../src/format/compact'
import { check, DROP, map, num, Report, str, toJsonSchema, type Ctx } from '../../src/format/dsl'
import { fieldValue, formatWithPattern, parseFieldToken, resolveFieldName, type FieldContext } from '../../src/format/fields'
import { loadDocument, type LoadResult } from '../../src/format/load'
import { parseInline, parseMarkdown } from '../../src/format/markdown'
import { dataUriType, isImageSrc } from '../../src/format/spec'
import { resolveStyle } from '../../src/format/theme'
import type { Block, BlockOf, FolioDoc } from '../../src/format/types'

const NOW = '2026-11-08T12:00:00.000Z'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

function ok(r: LoadResult): Extract<LoadResult, { ok: true }> {
  if (!r.ok) throw new Error('refusé : ' + JSON.stringify(r))
  return r
}
const load = (v: Record<string, unknown>) => ok(loadDocument({ format: 'folio/doc', version: 1, ...v }, { now: NOW }))
const codes = (r: { report: Report }) => r.report.issues.map((i) => i.code)
const identity = (d: FolioDoc) => ({ id: d.id, created: d.meta.created, modified: d.meta.modified })
const throughEditor = (d: FolioDoc) => pmToDoc(docToPM(d), identity(d))

function ctx(): Ctx {
  return { report: new Report(), defs: {}, limits: { maxDepth: 16, maxNodes: 1000 }, depth: 0, nodes: 0, tooLarge: false }
}

describe('couleurs', () => {
  it('ramène les couleurs à leur forme canonique', () => {
    expect(parseColor('#ABC')).toBe('#aabbcc')
    expect(parseColor(' #1E6B55 ')).toBe('#1e6b55')
    expect(parseColor('red')).toBe('#e03131')
    expect(parseColor('Accent2')).toBe('accent2')
    expect(parseColor('accent2', false)).toBeNull()
    for (const bad of ['', '#12', '#gggggg', 'rgb(1,2,3)', 'url(x)', 'red;background:url(x)', 'accent9']) expect(isColor(bad)).toBe(false)
  })
  it('accepte les surligneurs nommés et les couleurs', () => {
    expect(parseHighlight('Yellow')).toBe('yellow')
    expect(parseHighlight('grey')).toBe('gray')
    expect(parseHighlight('#FFEEAA')).toBe('#ffeeaa')
    expect(parseHighlight('accent1')).toBeNull()
  })
})

describe('champs', () => {
  it('reconnaît les noms français et anglais', () => {
    expect(resolveFieldName('titre')).toBe('title')
    expect(resolveFieldName('Auteur')).toBe('author')
    expect(resolveFieldName('heure')).toBe('time')
    expect(resolveFieldName('pages')).toBe('pages')
    expect(resolveFieldName('constructor')).toBeNull()
    expect(resolveFieldName('nimporte')).toBeNull()
  })
  it('traduit les jetons de date français', () => {
    expect(parseFieldToken('date:JJ/MM/AAAA')).toEqual({ name: 'date', format: 'DD/MM/YYYY' })
    expect(parseFieldToken('date:jjjj J MMMM AAAA')).toEqual({ name: 'date', format: 'dddd D MMMM YYYY' })
    expect(parseFieldToken('heure:HH:mm')).toEqual({ name: 'time', format: 'HH:mm' })
    expect(parseFieldToken('date:h:mm A')).toEqual({ name: 'date', format: 'h:mm A' })
  })
  it('met en forme les dates selon un motif', () => {
    const d = new Date(2026, 2, 5, 14, 7, 9)
    expect(formatWithPattern(d, 'DD/MM/YYYY HH:mm:ss', 'fr')).toBe('05/03/2026 14:07:09')
    expect(formatWithPattern(d, 'D/M/YY h A', 'en')).toBe('5/3/26 2 PM')
    expect(formatWithPattern(d, 'dddd D MMMM', 'fr')).toBe('jeudi 5 mars')
    expect(formatWithPattern(d, '[le] D', 'fr')).toBe('le 5')
  })
  it('calcule la valeur d’un champ', () => {
    const c: FieldContext = {
      title: 'Rapport',
      author: 'Camille',
      subject: '',
      organization: 'Atelier',
      keywords: ['a', 'b'],
      created: '2026-01-02T10:00:00Z',
      modified: '',
      filename: 'rapport.html',
      page: 3,
      pages: 12,
      now: new Date(2026, 10, 8, 9, 5),
      locale: 'fr',
    }
    expect(fieldValue('title', '', c)).toBe('Rapport')
    expect(fieldValue('keywords', '', c)).toBe('a, b')
    expect(fieldValue('page', '', c)).toBe('3')
    expect(fieldValue('pages', '', c)).toBe('12')
    expect(fieldValue('date', 'DD/MM/YYYY', c)).toBe('08/11/2026')
    expect(fieldValue('time', 'HH:mm', c)).toBe('09:05')
    expect(fieldValue('modified', '', c)).toBe('')
    expect(fieldValue('date', '', c)).toMatch(/2026/)
  })
})

describe('nombres et dictionnaires (dsl)', () => {
  it('arrondit au pas sans bruit et borne', () => {
    const d = num({ min: 1, max: 400, step: 0.5 })
    const c = ctx()
    expect(check(d, 11.3, '', c)).toBe(11.5)
    expect(check(d, 0.1 + 0.2, '', c)).toBe(1)
    expect(check(d, '12', '', c)).toBe(12)
    expect(check(d, 1e9, '', c)).toBe(400)
    expect(check(d, Number.NaN, '', c)).toBe(DROP)
    expect(check(d, 'douze', '', c)).toBe(DROP)
    expect(c.report.issues.map((i) => i.code)).toEqual(['clamped', 'coerced', 'clamped', 'invalid-value', 'wrong-type'])
  })
  it('refuse les clés réservées et les clés invalides', () => {
    const d = map(/^[A-Za-z][\w-]*$/, str({ max: 10 }), { max: 2 })
    const c = ctx()
    const v = JSON.parse('{"__proto__":"x","constructor":"y","ok":"a","1bad":"b","b":"c","c":"d"}')
    const out = check(d, v, 'styles', c) as Record<string, string>
    expect(out).toEqual({ ok: 'a', b: 'c' })
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(codes(c)).toEqual(['invalid-value', 'invalid-value', 'invalid-value', 'too-many-items'])
  })
  it('se traduit en JSON Schema', () => {
    expect(toJsonSchema(num({ min: 0, max: 5, def: 1 }), {}, {})).toEqual({ type: 'number', minimum: 0, maximum: 5, default: 1 })
    expect(toJsonSchema(map(/^a$/, str({ max: 3 }), { max: 9 }), {}, {})).toEqual({
      type: 'object',
      propertyNames: { pattern: '^a$' },
      additionalProperties: { type: 'string', maxLength: 3 },
      maxProperties: 9,
    })
  })
})

describe('sources d’images', () => {
  it('accepte les ressources, les images en base64 et les adresses web', () => {
    expect(isImageSrc('asset:logo')).toBe(true)
    expect(isImageSrc(PNG)).toBe(true)
    expect(isImageSrc('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(true)
    expect(isImageSrc('https://example.org/a.png')).toBe(true)
  })
  it('refuse le reste', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/png,notbase64',
      'data:image/png;base64,abc def',
      'data:image/png;base64,<script>',
      'file:///etc/passwd',
      'asset:',
      'asset:__proto__!',
      '//example.org/a.png',
      'http://exa mple.org',
    ]) {
      expect(isImageSrc(bad), bad).toBe(false)
    }
    expect(dataUriType('data:font/woff2;base64,AAAA')).toBe('font')
    expect(dataUriType('data:application/x-font-ttf;base64,AAAA')).toBe('font')
    expect(dataUriType('data:application/javascript;base64,AAAA')).toBeNull()
  })
})

describe('Markdown : champs, images, alignements', () => {
  it('lit les champs connus et laisse le reste en texte', () => {
    expect(parseInline('Page {{page}} sur {{pages}}')).toEqual([
      { text: 'Page ' },
      { type: 'field', name: 'page', format: '' },
      { text: ' sur ' },
      { type: 'field', name: 'pages', format: '' },
    ])
    expect(parseInline('**{{titre}}**')).toEqual([{ type: 'field', name: 'title', format: '', bold: true }])
    expect(parseInline('\\{{page}}')).toEqual([{ text: '{{page}}' }])
    expect(parseInline('{{inconnu}} {{ }} {{page')).toEqual([{ text: '{{inconnu}} {{ }} {{page' }])
    expect(parseInline('{{date:JJ/MM/AAAA}}')).toEqual([{ type: 'field', name: 'date', format: 'DD/MM/YYYY' }])
  })
  it('fait un bloc image d’une image seule dans son paragraphe', () => {
    expect(parseMarkdown('![Un chat](https://example.org/chat.jpg "Le *chat*")')).toEqual([
      { type: 'image', src: 'https://example.org/chat.jpg', alt: 'Un chat', width: 0, align: 'center', wrap: 'none', caption: [{ text: 'Le ' }, { text: 'chat', italic: true }] },
    ])
    // au milieu du texte, ou avec une source refusée, l'image reste du texte
    expect(parseMarkdown('Voir ![x](https://e.org/a.png) ici')[0].type).toBe('paragraph')
    expect(parseMarkdown('![x](javascript:alert(1))')[0].type).toBe('paragraph')
  })
  it('reprend l’alignement des colonnes d’un tableau', () => {
    const [t] = parseMarkdown('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |') as [BlockOf<'table'>]
    const aligns = t.rows[1].map((c) => (c.blocks[0] as BlockOf<'paragraph'>).align)
    expect(aligns).toEqual([undefined, 'center', 'right'])
  })
})

describe('styles et thème', () => {
  it('fait du bon bloc un paragraphe au style de titre, de citation ou de code', () => {
    const r = load({
      blocks: [
        { text: 'T', style: 'heading2', align: 'center' },
        { text: 'Q', style: 'quote' },
        { md: '**C**', style: 'code' },
        { text: 'N', style: 'normal' },
        { text: 'X', style: 'inexistant' },
        { text: 'S', style: 'subtitle' },
      ],
    })
    expect(r.doc.blocks).toEqual([
      { type: 'heading', level: 2, content: [{ text: 'T' }], align: 'center' },
      { type: 'quote', blocks: [{ type: 'paragraph', content: [{ text: 'Q' }] }] },
      { type: 'code', language: '', text: 'C' },
      { type: 'paragraph', content: [{ text: 'N' }] },
      { type: 'paragraph', content: [{ text: 'X' }] },
      { type: 'paragraph', content: [{ text: 'S' }], style: 'subtitle' },
    ])
    expect(codes(r)).toContain('style-unknown')
  })
  it('garde les styles personnels et les modifications utiles seulement', () => {
    const r = load({
      styles: {
        note: { name: 'Note', basedOn: 'normal', italic: true, color: 'Accent2' },
        sansnom: { bold: true },
        heading1: { color: '#AA0000', size: 21, bold: true },
        heading2: { size: 16 },
        boucle: { name: 'Boucle', basedOn: 'boucle' },
        orphelin: { name: 'Orphelin', basedOn: 'absent', next: 'note' },
      },
      blocks: [{ text: 'x', style: 'note' }],
    })
    expect(r.doc.styles).toEqual({
      note: { name: 'Note', basedOn: 'normal', italic: true, color: 'accent2' },
      sansnom: { name: 'sansnom', bold: true },
      heading1: { color: '#aa0000' },
      boucle: { name: 'Boucle' },
      orphelin: { name: 'Orphelin', next: 'note' },
    })
    expect(codes(r).filter((c) => c === 'style-unknown')).toHaveLength(2)
  })
  it('résout l’héritage des styles sans boucle', () => {
    const styles = { a: { name: 'A', basedOn: 'b', size: 9 }, b: { name: 'B', basedOn: 'a', bold: true } }
    const s = resolveStyle(styles, 'a')
    expect(s.size).toBe(9)
    expect(s.bold).toBe(true)
    expect(resolveStyle({}, 'heading1')).toMatchObject({ font: 'heading', bold: true, size: 21, line: 1.2, color: 'accent1' })
    expect(resolveStyle({ heading1: { spacing: { after: 20 } } }, 'heading1').spacing).toEqual({ before: 18, after: 20 })
  })
  it('part d’un thème prédéfini et applique les changements', () => {
    expect(load({}).doc.theme.name).toBe('folio')
    const t = load({ theme: { name: 'Modern', colors: { accent1: '#123', text: 'accent1' }, fonts: { body: 'Georgia' } } }).doc.theme
    expect(t.name).toBe('modern')
    expect(t.colors.accent1).toBe('#112233')
    expect(t.colors.text).toBe('#16181d') // une couleur du thème ne peut pas renvoyer au thème
    expect(t.fonts.body).toBe('Georgia')
    expect(t.fonts.heading).toBe('Hanken Grotesk')
  })
  it('écrit le thème en compact par différence, et rien pour le thème par défaut', () => {
    expect(toCompact(load({}).doc).theme).toBeUndefined()
    expect(toCompact(load({ theme: { name: 'classic', colors: { accent1: '#000000' } } }).doc).theme).toEqual({ name: 'classic', colors: { accent1: '#000000' } })
    const custom = load({ theme: { name: 'maison', fonts: { body: 'Arial' } } }).doc
    const back = load(toCompact(custom)).doc
    expect(back.theme).toEqual(custom.theme)
  })
})

describe('images et ressources', () => {
  it('range les images en base64 dans les ressources, sans doublon', () => {
    const r = load({ blocks: [{ type: 'image', src: PNG }, { type: 'figure', src: PNG, caption: 'Deux' }, { type: 'image', src: GIF }] })
    const srcs = r.doc.blocks.map((b) => (b as BlockOf<'image'>).src)
    expect(srcs[0]).toBe(srcs[1])
    expect(srcs[2]).not.toBe(srcs[0])
    expect(Object.keys(r.doc.assets)).toEqual([srcs[0].slice(6), srcs[2].slice(6)])
    expect(r.doc.assets[srcs[0].slice(6)]).toBe(PNG)
  })
  it('garde les ressources nommées utilisées et oublie les autres', () => {
    const r = load({ assets: { logo: PNG, inutile: GIF, double: PNG }, blocks: [{ type: 'image', src: 'asset:logo' }, { type: 'image', src: 'asset:double' }] })
    expect(r.doc.assets).toEqual({ logo: PNG })
    expect(r.doc.blocks.map((b) => (b as BlockOf<'image'>).src)).toEqual(['asset:logo', 'asset:logo'])
  })
  it('signale une ressource absente sans perdre l’image', () => {
    const r = load({ blocks: [{ type: 'image', src: 'asset:absente', alt: 'Plan' }] })
    expect(codes(r)).toContain('asset-missing')
    expect((r.doc.blocks[0] as BlockOf<'image'>).src).toBe('asset:absente')
  })
  it('reprend les ressources connues quand une IA renvoie le document sans elles', () => {
    const doc = load({ assets: { logo: PNG }, blocks: [{ type: 'image', src: 'asset:logo' }] }).doc
    const compact = toCompact(doc, { assets: false })
    expect(compact.assets).toBeUndefined()
    const back = ok(loadDocument(compact, { now: NOW, assets: doc.assets }))
    expect(back.report.issues).toEqual([])
    expect(back.doc.assets).toEqual({ logo: PNG })
  })
  it('refuse une ressource qui n’est pas une image ou une police', () => {
    const r = load({ assets: { x: 'data:text/html;base64,PHA+' }, blocks: [{ type: 'image', src: 'asset:x' }] })
    expect(r.doc.assets).toEqual({})
    expect(codes(r)).toEqual(expect.arrayContaining(['unsafe-image', 'asset-missing']))
  })
  it('normalise rognage, rotation et légende', () => {
    const r = load({ blocks: [{ type: 'image', src: PNG, crop: { left: 80, right: 40, top: 0 }, rotate: -90, caption: 'Vue *aérienne*', flip: 'both' }] })
    const img = r.doc.blocks[0] as BlockOf<'image'>
    expect(img.crop).toEqual({ top: 0, right: 30, bottom: 0, left: 60 })
    expect(img.rotate).toBe(270)
    expect(img.flip).toBe('hv')
    expect(img.caption).toEqual([{ text: 'Vue ' }, { text: 'aérienne', italic: true }])
    expect(load({ blocks: [{ type: 'image', src: PNG, rotate: 360 }] }).doc.blocks[0]).not.toHaveProperty('rotate')
  })
  it('écrit une légende simple en texte dans la forme compacte, sinon en morceaux', () => {
    const d = load({ blocks: [{ type: 'image', src: PNG, caption: 'Figure 1. Le port' }, { type: 'image', src: PNG, caption: 'Coût *net*' }] }).doc
    const [a, b] = toCompact(d).blocks as Record<string, unknown>[]
    expect(a.caption).toBe('Figure 1. Le port')
    expect(b.caption).toEqual(['Coût ', { text: 'net', italic: true }])
    expect(load(toCompact(d)).doc.blocks).toEqual(d.blocks)
  })
  it('garde l’identifiant d’une ressource à travers l’éditeur', () => {
    const d = load({ assets: { logo: PNG }, blocks: [{ type: 'image', src: 'asset:logo', width: 120 }] }).doc
    const pm = docToPM(d)
    expect(pm.firstChild!.attrs.src).toBe(PNG)
    expect(throughEditor(d)).toEqual(d)
  })
})

describe('tableaux, listes, paragraphes', () => {
  it('refuse des largeurs de colonnes qui ne correspondent pas', () => {
    const r = load({ blocks: [{ type: 'table', widths: [100, 100], rows: [['a', 'b', 'c']] }] })
    expect(r.doc.blocks[0]).not.toHaveProperty('widths')
    expect(codes(r)).toContain('invalid-value')
  })
  it('convertit les largeurs en largeurs de colonnes de l’éditeur, et retour', () => {
    const d = load({ blocks: [{ type: 'table', widths: [100, 50.5], rows: [[{ text: 'a', colspan: 2 }], ['b', 'c']] }] }).doc
    const pm = docToPM(d)
    const cell = pm.firstChild!.firstChild!.firstChild!
    expect(cell.attrs.colwidth.map((x: number) => Math.round(x))).toEqual([133, 67])
    expect(throughEditor(d)).toEqual(d)
  })
  it('ne garde la numérotation que pour une liste numérotée', () => {
    const r = load({ blocks: [{ type: 'list', numbering: 'roman', bullet: '✓', continue: true, items: ['a'] }, { type: 'list', style: 'number', numbering: 'lower-roman', bullet: '✓', continue: true, items: ['b'] }] })
    expect(r.doc.blocks).toEqual([
      { type: 'list', style: 'bullet', start: 1, items: [{ content: [{ text: 'a' }], level: 0, style: 'bullet' }], bullet: '✓' },
      { type: 'list', style: 'number', start: 1, items: [{ content: [{ text: 'b' }], level: 0, style: 'number' }], numbering: 'roman', continue: true },
    ])
  })
  it('borne et nettoie la mise en forme de paragraphe', () => {
    const r = load({ blocks: [{ text: 'x', align: 'centre', indent: { left: '36', first: -9999 }, spacing: { before: 6.26 }, line: 99, keepNext: false, shading: 'yellow', border: 'bad' }] })
    expect(r.doc.blocks[0]).toEqual({ type: 'paragraph', content: [{ text: 'x' }], align: 'center', indent: { left: 36, first: -500 }, spacing: { before: 6.5 }, line: 10, shading: '#f5c518' })
  })
  it('n’accepte pas de mise en forme dangereuse dans les marques', () => {
    const r = load({ blocks: [{ content: [{ text: 'x', font: 'Arial; background:url(http://x)', color: 'red;x', size: 'énorme', lang: 'fr"><script>' }] }] })
    expect(r.doc.blocks[0]).toEqual({ type: 'paragraph', content: [{ text: 'x' }] })
    expect(r.report.ignored).toBe(4)
  })
  it('un saut de page et des champs passent par l’éditeur', () => {
    const d = load({ blocks: [{ md: 'Page {{page}}/{{pages}}' }, { type: 'pagebreak' }, { content: [{ type: 'field', name: 'date', format: 'DD/MM', bold: true }] }] }).doc
    expect(throughEditor(d)).toEqual(d)
    const pm = docToPM(d)
    expect(pm.child(1).type.name).toBe('page_break')
    expect(pm.child(2).firstChild!.marks.map((m) => m.type.name)).toEqual(['bold'])
  })
  it('un style collé qui n’existe pas dans le document est oublié', () => {
    const p = schema.nodes.paragraph.create({ style: 'venuDailleurs' }, schema.text('x'))
    const pm = schema.nodes.doc.create(null, p)
    const d = pmToDoc(pm, { id: 'abcdef', created: '', modified: '' })
    expect(d.blocks[0]).toEqual({ type: 'paragraph', content: [{ text: 'x' }] })
  })
  it('les blocs non admis dans une cellule sont aplatis', () => {
    const r = load({ blocks: [{ type: 'table', rows: [[{ blocks: [{ type: 'pagebreak' }, 'texte', { type: 'divider' }] }]] }] })
    const t = r.doc.blocks[0] as BlockOf<'table'>
    expect(t.rows[0][0].blocks).toEqual([{ type: 'paragraph', content: [{ text: 'texte' }] }] as Block[])
    expect(codes(r).filter((c) => c === 'cell-flattened')).toHaveLength(2)
  })
})

describe('table des matières', () => {
  it('bloc, Markdown [TOC], forme compacte', () => {
    const r = load({ blocks: [{ type: 'contents', levels: 9, title: ' Sommaire ' }], markdown: '' })
    expect(r.doc.blocks).toEqual([{ type: 'toc', levels: 6, title: 'Sommaire' }])
    expect(parseMarkdown('# A\n\n[TOC]\n\n## B')[1]).toEqual({ type: 'toc', levels: 3, title: '' })
    expect(toCompact(load({ blocks: [{ type: 'toc' }] }).doc).blocks).toEqual([{ type: 'toc' }])
    expect(throughEditor(r.doc)).toEqual(r.doc)
  })
})

describe('sections', () => {
  it('au premier niveau seulement ; réglages, en-têtes propres, forme compacte', () => {
    const r = load({
      assets: { logo: PNG },
      blocks: [
        'avant',
        { type: 'section', start: 'odd', numberStart: 1, numberFormat: 'decimal', headers: { default: [{ md: 'Chapitre 1' }], first: [{ type: 'image', src: 'asset:logo' }] } },
        'après',
        { type: 'quote', blocks: ['x', { type: 'section' }, 'y'] },
      ],
    })
    const [, sec, , quote] = r.doc.blocks as [Block, BlockOf<'section'>, Block, BlockOf<'quote'>]
    expect(sec).toEqual({
      type: 'section',
      start: 'odd',
      numberStart: 1,
      numberFormat: 'decimal',
      headers: { default: [{ type: 'paragraph', content: [{ text: 'Chapitre 1' }] }], first: [{ type: 'image', src: 'asset:logo', alt: '', width: 0, align: 'center', wrap: 'none', caption: [] }], even: [] },
    })
    expect(quote.blocks.map((b) => b.type)).toEqual(['paragraph', 'pagebreak', 'paragraph'])
    expect(codes(r)).toContain('block-converted')
    expect(throughEditor(r.doc)).toEqual(r.doc)
    expect(load(toCompact(r.doc)).doc.blocks).toEqual(r.doc.blocks)
    expect((toCompact(r.doc).blocks as Record<string, unknown>[])[1]).toMatchObject({ type: 'section', start: 'odd', numberStart: 1 })
  })
})

describe('colonnes', () => {
  it('normalise et passe par l’éditeur ; aplatit ce qui n’a rien à y faire', () => {
    const r = load({
      blocks: [
        { type: 'columns', count: 9, blocks: ['a', { type: 'columnbreak' }, { type: 'columns', blocks: ['b'] }, { type: 'pagebreak' }, 'c'] },
        { type: 'columnbreak' },
        { type: 'table', rows: [[{ blocks: [{ type: 'columns', blocks: ['dans la cellule'] }] }]] },
      ],
    })
    const [cols, table] = r.doc.blocks as [BlockOf<'columns'>, BlockOf<'table'>]
    expect(cols.count).toBe(6)
    expect(cols.blocks.map((b) => b.type)).toEqual(['paragraph', 'columnbreak', 'paragraph', 'columnbreak', 'paragraph'])
    expect(r.doc.blocks).toHaveLength(2)
    expect(table.rows[0][0].blocks).toEqual([{ type: 'paragraph', content: [{ text: 'dans la cellule' }] }])
    expect(throughEditor(r.doc)).toEqual(r.doc)
    expect(toCompact(r.doc).blocks).toEqual([
      { type: 'columns', count: 6, blocks: ['a', { type: 'columnbreak' }, 'b', { type: 'columnbreak' }, 'c'].map((x) => (typeof x === 'string' ? { text: x } : x)) },
      { type: 'table', rows: [['dans la cellule']] },
    ])
  })
})

describe('mise en page, en-têtes et pieds de page', () => {
  it('donne les dimensions d’un format connu et garde un format personnel en portrait', () => {
    expect(load({ page: { size: 'letter' } }).doc.page).toMatchObject({ size: 'Letter', width: 215.9, height: 279.4 })
    expect(load({ page: { size: 'A4', width: 10, height: 10 } }).doc.page).toMatchObject({ width: 210, height: 297 })
    expect(load({ page: { size: 'custom', width: 300, height: 200 } }).doc.page).toMatchObject({ size: 'custom', width: 200, height: 300 })
    expect(load({ page: { width: 100 } }).doc.page).toMatchObject({ size: 'A4', width: 210 })
  })
  it('ramène des marges qui ne laissent pas 20 mm de texte', () => {
    const r = load({ page: { size: 'A5', margins: { left: 100, right: 100 } } })
    const m = r.doc.page.margins
    expect(m.left + m.right).toBeLessThanOrEqual(148 - 20)
    expect(m.left).toBe(m.right)
    expect(codes(r)).toContain('clamped')
  })
  it('écrit la mise en page en compact par différence', () => {
    expect(toCompact(load({}).doc).page).toBeUndefined()
    expect(toCompact(load({ page: { size: 'Letter', orientation: 'landscape' } }).doc).page).toEqual({ size: 'Letter', orientation: 'landscape' })
    const custom = load({ page: { size: 'custom', width: 100, height: 150, numberFormat: 'ROMAN' } }).doc
    expect(load(toCompact(custom)).doc.page).toEqual(custom.page)
  })
  it('les en-têtes gardent leurs champs et leurs images, et passent par l’éditeur', () => {
    const d = load({
      assets: { logo: PNG },
      headers: { default: [{ md: 'Rapport — {{page}}/{{pages}}', align: 'right' }], first: [{ type: 'image', src: 'asset:logo', alt: 'logo', width: 40 }] },
      footers: { even: [{ type: 'divider' }, 'pair'] },
      blocks: ['corps'],
    }).doc
    expect(d.headers.default[0]).toEqual({ type: 'paragraph', content: [{ text: 'Rapport — ' }, { type: 'field', name: 'page', format: '' }, { text: '/' }, { type: 'field', name: 'pages', format: '' }], align: 'right' })
    expect(d.footers.even).toEqual([{ type: 'paragraph', content: [{ text: 'pair' }] }])
    expect(d.assets).toEqual({ logo: PNG })
    expect(throughEditor(d)).toEqual(d)
    expect(docToPM(d).attrs.hfAssets).toEqual({ logo: PNG })
  })
})
