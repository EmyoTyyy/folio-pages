// @vitest-environment jsdom
// Exports : page web, Markdown, texte brut, OpenDocument (.odt), livre numérique (.epub).

import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { demoDocument } from '../../src/demo/demo'
import { imageSize, listLabels, prepareExport, slug } from '../../src/export/common'
import { exportEpub } from '../../src/export/epub'
import { safeHref, toHtml } from '../../src/export/html'
import { exportOdt, odfText } from '../../src/export/odt'
import { toMarkdown, toPlainText } from '../../src/export/text'
import { loadDocument } from '../../src/format/load'
import type { Block, FolioDoc } from '../../src/format/types'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR42mP8z8Dwn4EIwDiqEAD6/QX9zp5mQwAAAABJRU5ErkJggg=='
const NOW = '2026-11-13T10:00:00.000Z'

function docOf(input: Record<string, unknown>): FolioDoc {
  const r = loadDocument({ format: 'folio/doc', version: 1, meta: { title: 'Essai <b>', lang: 'fr', author: 'Ana' }, ...input }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  return r.doc
}

const SAMPLE = docOf({
  sources: [{ id: 'Doe2020', authors: ['Doe, Jane'], title: 'Un livre', year: '2020', publisher: 'Presses' }],
  assets: { pic: `data:image/png;base64,${PNG}` },
  blocks: [
    { type: 'toc', title: 'Sommaire', levels: 2 },
    { type: 'heading', level: 1, text: 'Résultats & méthode' },
    { md: 'Du **gras**, de l’*italique*, un [lien](https://exemple.fr) et un piège [x](javascript:alert(1)).^[Une note.]' },
    { content: ['Texte <script>alert(1)</script> gardé', { text: ' supprimé', deleted: { author: 'A', date: '' } }, ' fin ', { type: 'cite', id: 'Doe2020' }, '. Titre : ', { type: 'field', name: 'title' }] },
    { type: 'list', style: 'number', items: ['Un', { text: 'Un.un', level: 1 }, 'Deux'] },
    { type: 'table', rows: [['A', 'B'], ['1', { text: '2', colspan: 1 }]] },
    { type: 'heading', level: 1, text: 'Résultats & méthode' },
    { md: 'Une formule $x^2$ et :' },
    { type: 'equation', tex: 'E = mc^2', numbered: true },
    { type: 'image', src: 'asset:pic', alt: 'Une image', caption: 'Légende' },
    { type: 'code', language: 'js', text: 'const a = 1\n  return a' },
    { type: 'bibliography', title: 'Références' },
  ],
})

describe('préparation commune', () => {
  it('notes, ancres des titres, équations, champs, citations', () => {
    const ctx = prepareExport(SAMPLE, { now: new Date(NOW) })
    expect(ctx.notes.map((n) => n.label)).toEqual(['1'])
    expect([...ctx.headingId.values()]).toEqual(['resultats-methode', 'resultats-methode-2'])
    expect([...ctx.eqNumber.values()]).toEqual([1])
    expect([...ctx.refs.text.values()][0]).toMatch(/Doe.*2020/)
    expect(slug('123', new Set())).toBe('s-123')
  })

  it('numéros de liste : 1. a. i., plan 1.1., puces', () => {
    const list = (numbering: string) => ({ type: 'list', style: 'number', start: 1, numbering, items: [0, 1, 2, 1, 0].map((level) => ({ content: [], level, style: 'number' })) }) as Block & { type: 'list' }
    expect(listLabels(list('default'))).toEqual(['1.', 'a.', 'i.', 'b.', '2.'])
    expect(listLabels(list('outline'))).toEqual(['1.', '1.1.', '1.1.1.', '1.2.', '2.'])
    expect(listLabels({ type: 'list', style: 'bullet', start: 1, bullet: '✓', items: [{ content: [], level: 0, style: 'bullet' }, { content: [], level: 1, style: 'bullet' }] })).toEqual(['✓', '◦'])
  })

  it('taille des images (PNG, GIF, JPEG)', () => {
    expect(imageSize(Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0)))).toEqual({ width: 2, height: 3 })
    expect(imageSize(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 5, 0, 7, 0, 0]))).toEqual({ width: 5, height: 7 })
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 9, 0, 12, 3, 0, 0, 0])
    expect(imageSize(jpeg)).toEqual({ width: 12, height: 9 })
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})

describe('texte brut et Markdown', () => {
  it('texte brut : titres soulignés, listes numérotées, tableau, notes à la fin, suppressions retirées', () => {
    const txt = toPlainText(SAMPLE, { now: new Date(NOW) })
    expect(txt).toContain('Résultats & méthode\n===================')
    expect(txt).toContain('1. Un\n   a. Un.un\n2. Deux')
    expect(txt).toContain('A\tB\n1\t2')
    expect(txt).toContain('Texte <script>alert(1)</script> gardé fin (Doe, 2020). Titre\u00a0: Essai <b>'.replace('Titre\u00a0:', 'Titre :'))
    expect(txt).not.toContain('supprimé')
    expect(txt).toMatch(/Notes\n-----\n\n\[1\] Une note\./)
    expect(txt).toContain('E = mc^2    (1)')
  })

  it('Markdown : mise en forme, note [^1], image à part, tableau, sommaire en liens, liens sûrs seulement', () => {
    const r = toMarkdown(SAMPLE, { now: new Date(NOW) })
    const md = r.markdown
    expect(md).toContain('# Résultats & méthode')
    expect(md).toContain('Du **gras**, de l’*italique*, un [lien](https://exemple.fr) et un piège x.[^1]')
    expect(md).toContain('[^1]: Une note.')
    expect(md).toContain('- [Résultats & méthode](#resultats-methode)')
    expect(md).toContain('| A | B |\n| --- | --- |\n| 1 | 2 |')
    expect(md).toContain('$x^2$')
    expect(md).toContain('$$\nE = mc^2 \\tag{1}\n$$')
    expect(md).toMatch(/!\[Une image\]\(images\/01-pic\.png\)/)
    expect(Object.keys(r.files)).toEqual(['images/01-pic.png'])
    expect(md).toContain('Texte \\<script\\>alert(1)\\</script\\> gardé')
  })
})

describe('page web', () => {
  it('autonome et sans script : styles, MathML, image intégrée, notes, ancres', () => {
    const html = toHtml(SAMPLE, { now: new Date(NOW) })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>Essai &lt;b&gt;</title>')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toContain('javascript:')
    expect(html).toContain('<h1 id="resultats-methode"')
    expect(html).toContain('<a href="#resultats-methode">')
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML"')
    expect(html).toContain(`src="data:image/png;base64,${PNG}"`)
    expect(html).toContain('<figcaption class="s-caption">Légende</figcaption>')
    expect(html).toMatch(/<sup class="fn"><a id="note-ref-1" href="#note-1" role="doc-noteref">1<\/a><\/sup>/)
    expect(html).toContain('<section class="notes" role="doc-endnotes">')
    expect(html).toContain('<span class="tok-keyword">const</span>')
    expect(html).toContain('class="eq-num">(1)<')
    expect(html).toContain('<ol><li')
    // Le texte « <script> » tapé reste du texte.
    expect(html).toContain('Texte &lt;script&gt;alert(1)&lt;/script&gt; gardé')
    // Lisible par un navigateur : la structure attendue est là.
    const dom = new DOMParser().parseFromString(html, 'text/html')
    expect(dom.querySelectorAll('h1')).toHaveLength(2)
    expect(dom.querySelector('table th')?.textContent).toBe('A')
    expect(dom.querySelector('.bib .gen-line')?.textContent).toMatch(/Doe, J\./)
  })

  it('liens : web, courriel, signet ; le reste est retiré', () => {
    expect(safeHref('https://a.fr')).toBe('https://a.fr')
    expect(safeHref('mailto:a@b.fr')).toBe('mailto:a@b.fr')
    expect(safeHref('#Signet1')).toBe('#bm-Signet1')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,x')).toBeNull()
  })
})

const xml = (s: string) => {
  const d = new DOMParser().parseFromString(s, 'application/xml')
  expect(d.getElementsByTagName('parsererror')).toHaveLength(0)
  return d
}

describe('OpenDocument (.odt)', () => {
  it('archive valide : mimetype d’abord et non compressé, XML bien formé, manifeste complet', async () => {
    const r = await exportOdt(SAMPLE, { now: new Date(NOW) })
    const files = unzipSync(r.bytes)
    const names = Object.keys(files)
    expect(names[0]).toBe('mimetype')
    expect(strFromU8(files.mimetype)).toBe('application/vnd.oasis.opendocument.text')
    // En-tête local du premier fichier : méthode 0 (stocké), nom « mimetype » à l'octet 30.
    expect(r.bytes[8] | (r.bytes[9] << 8)).toBe(0)
    expect(strFromU8(r.bytes.subarray(30, 38))).toBe('mimetype')
    for (const n of names.filter((n) => n.endsWith('.xml'))) xml(strFromU8(files[n]))
    const manifest = strFromU8(files['META-INF/manifest.xml'])
    for (const n of names.filter((n) => n !== 'mimetype' && n !== 'META-INF/manifest.xml')) expect(manifest).toContain(`manifest:full-path="${n}"`)
    expect(names.some((n) => /^Pictures\/001\.png$/.test(n))).toBe(true)
    expect(names.filter((n) => /^Object \d+\/content\.xml$/.test(n))).toHaveLength(2)
    expect(r.losses).toEqual([])
  })

  it('structure : titres, notes, listes imbriquées, tableau, sommaire, champs, suppressions acceptées', async () => {
    const files = unzipSync((await exportOdt(SAMPLE, { now: new Date(NOW), headingPages: [1, 2] })).bytes)
    const content = strFromU8(files['content.xml'])
    const d = xml(content)
    const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
    const hs = d.getElementsByTagNameNS(T, 'h')
    expect(hs).toHaveLength(2)
    expect(hs[0].getAttributeNS(T, 'outline-level')).toBe('1')
    expect(hs[0].getAttributeNS(T, 'style-name')).toMatch(/^(Heading_20_1|P\d+)$/)
    const note = d.getElementsByTagNameNS(T, 'note')[0]
    expect(note.getAttributeNS(T, 'note-class')).toBe('footnote')
    expect(note.textContent).toContain('Une note.')
    // Liste : « Un.un » dans une sous-liste de « Un ».
    const lists = d.getElementsByTagNameNS(T, 'list')
    expect(lists[1].parentElement!.localName).toBe('list-item')
    expect(lists[1].parentElement!.textContent).toMatch(/^UnUn\.un/)
    expect(d.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:table:1.0', 'table-cell')).toHaveLength(4)
    const toc = d.getElementsByTagNameNS(T, 'table-of-content')[0]
    expect(toc.textContent).toContain('Résultats & méthode1')
    expect(content).not.toContain('supprimé')
    expect(content).not.toContain('javascript:')
    expect(content).toContain('<text:a xlink:type="simple" xlink:href="https://exemple.fr">')
    expect(content).toContain('Texte &lt;script&gt;alert(1)&lt;/script&gt; gardé')
    expect(content).toContain('<text:title>Essai &lt;b&gt;</text:title>')
    const styles = strFromU8(files['styles.xml'])
    expect(styles).toContain('style:name="Heading_20_1"')
    expect(styles).toContain('text:note-class="footnote"')
    expect(strFromU8(files['meta.xml'])).toContain('<dc:title>Essai &lt;b&gt;</dc:title>')
  })

  it('pages : en-têtes, pieds de page avec numéro, première page différente, section paysage', async () => {
    const d = docOf({
      page: { firstPage: true },
      headers: { default: [{ md: '{{title}}' }] },
      footers: { default: [{ md: 'Page {{page}} sur {{pages}}' }] },
      blocks: ['Avant', { type: 'section', start: 'page', page: { size: 'A4', width: 210, height: 297, orientation: 'landscape', margins: { top: 20, right: 20, bottom: 20, left: 20 } } }, 'Après'],
    })
    const files = unzipSync((await exportOdt(d)).bytes)
    const styles = strFromU8(files['styles.xml'])
    expect(styles).toContain('<text:page-number text:select-page="current">')
    expect(styles).toContain('<style:footer-first>')
    expect(styles.match(/<style:master-page /g)).toHaveLength(2)
    expect(styles).toContain('style:print-orientation="landscape"')
    expect(styles).toMatch(/<style:master-page style:name="Standard" style:page-layout-name="pm1">/)
    const content = strFromU8(files['content.xml'])
    expect(content).toMatch(/style:master-page-name="Folio_2"/)
  })

  it('espaces et retours à la ligne gardés', () => {
    expect(odfText('a  b\tc\nd')).toBe('a <text:s text:c="1"/>b<text:tab/>c<text:line-break/>d')
    expect(odfText(' x')).toBe('<text:s/>x')
    expect(odfText('<&>')).toBe('&lt;&amp;&gt;')
  })

  it('le document de démonstration s’exporte sans perte', async () => {
    const r = await exportOdt(demoDocument('fr', NOW))
    expect(r.losses).toEqual([])
    const files = unzipSync(r.bytes)
    for (const n of Object.keys(files).filter((n) => n.endsWith('.xml'))) xml(strFromU8(files[n]))
  })
})

describe('livre numérique (.epub)', () => {
  it('structure EPUB 3 : mimetype, conteneur, paquet, sommaire, chapitres, liens internes', () => {
    const r = exportEpub(SAMPLE, { now: new Date(NOW) })
    const files = unzipSync(r.bytes)
    const names = Object.keys(files)
    expect(names[0]).toBe('mimetype')
    expect(strFromU8(files.mimetype)).toBe('application/epub+zip')
    expect(strFromU8(files['META-INF/container.xml'])).toContain('full-path="OEBPS/content.opf"')
    const opf = xml(strFromU8(files['OEBPS/content.opf']))
    const items = [...opf.getElementsByTagName('item')]
    for (const it of items) expect(names).toContain(`OEBPS/${it.getAttribute('href')}`)
    expect(items.find((i) => i.getAttribute('properties') === 'nav')).toBeTruthy()
    expect(items.some((i) => (i.getAttribute('properties') ?? '').includes('mathml'))).toBe(true)
    expect(opf.getElementsByTagName('itemref').length).toBe(r.chapters)
    expect(r.chapters).toBe(4) // avant le premier titre, deux chapitres, les notes
    expect(strFromU8(files['OEBPS/content.opf'])).toMatch(/<meta property="dcterms:modified">\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/meta>/)
    const ids = new Map<string, Set<string>>()
    for (const n of names.filter((n) => n.endsWith('.xhtml'))) {
      const d = xml(strFromU8(files[n]))
      ids.set(n.slice(6), new Set([...d.querySelectorAll('[id]')].map((e) => e.id)))
    }
    for (const n of names.filter((n) => n.endsWith('.xhtml'))) {
      const d = xml(strFromU8(files[n]))
      for (const a of d.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href')!
        if (/^(https?|mailto):/.test(href)) continue
        const [file, frag] = href.split('#')
        const target = file || n.slice(6)
        expect(ids.has(target), href).toBe(true)
        if (frag) expect(ids.get(target)!.has(frag), href).toBe(true)
      }
    }
    expect(names).toContain('OEBPS/images/001.png')
  })
})
