// Export .docx : le fichier produit est une archive bien formée, cohérente
// (parties, relations, styles), et contient ce que le document contient.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportDocx, wordStyleId } from '../../src/docx/export'
import { bytesOfDataUri } from '../../src/docx/maps'
import { descendants, parseXml } from '../../src/docx/xml'
import { demoDocument } from '../../src/demo/demo'
import { loadDocument } from '../../src/format/load'
import type { FolioDoc } from '../../src/format/types'
import { NOW, open, parts } from './docx-helpers'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR42mNkYPhfz4AEGAEADAQBAc0kzM4AAAAASUVORK5CYII='
const SVG = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#1e6b55"/></svg>').toString('base64')}`

function load(v: Record<string, unknown>): FolioDoc {
  const r = loadDocument({ format: 'folio/doc', version: 1, ...v }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  expect(r.report.issues).toEqual([])
  return r.doc
}

const RICH = () =>
  load({
    meta: { title: 'Essai <complet> & "cité"', author: 'Ada Moreau', subject: 'Sujet', keywords: ['un', 'deux'], organization: 'Atelier', lang: 'fr' },
    trackChanges: true,
    page: { size: 'A5', orientation: 'landscape', margins: { top: 15, right: 12, bottom: 15, left: 12 }, firstPage: true, evenOdd: true, numberStart: 3, numberFormat: 'ROMAN', border: '#333333', background: '#fffbe6' },
    notes: { foot: { format: 'symbols', restart: 'page' }, end: { format: 'alpha', start: 2 } },
    headers: { default: [{ md: '{{title}} — {{page}}/{{pages}}', align: 'right' }], first: ['Première page'], even: ['Pages paires'] },
    footers: { default: [{ content: [{ type: 'field', name: 'date', format: 'DD/MM/YYYY' }] }] },
    styles: { heading1: { color: '#aa0000', bold: false }, encadre: { name: 'Encadré', basedOn: 'normal', shading: 'accent1', border: '#156082', italic: true } },
    comments: [
      { id: 'a', author: 'Bob Lee', date: '2026-01-02T03:04:05Z', text: 'Vraiment ?\nSûr ?', resolved: true, replies: [{ author: 'Ada', date: '2026-01-03T03:04:05Z', text: 'Oui.' }] },
      { id: 'perdu', author: 'Zoé', date: '2026-01-04T00:00:00Z', text: 'Sur du texte supprimé' },
    ],
    assets: { p: PNG, s: SVG },
    blocks: [
      { type: 'heading', level: 1, content: ['Titre un'] },
      { type: 'toc', levels: 2, title: 'Sommaire' },
      {
        content: [
          'Bonjour ',
          { text: 'gras', bold: true, italic: true, underline: true, strike: true, color: 'accent2', highlight: 'yellow', font: 'Georgia', size: 14, letterSpacing: 1, lang: 'en' },
          ' et ',
          { text: 'lien', link: 'https://exemple.org/a?b=1&c=2' },
          { text: 'interne', link: '#ancre' },
          { type: 'note', text: 'Une note <b> & co.' },
          { text: ' commenté', comments: ['a'] },
          { text: ' ajouté', inserted: { author: 'Ada', date: '2026-01-05T00:00:00Z' } },
          { text: ' supprimé', deleted: { author: 'Ada', date: '2026-01-06T00:00:00Z' } },
          { type: 'note', kind: 'end', blocks: ['Fin.', { type: 'list', items: ['dans la note'] }] },
          { text: 'x', sup: true },
          { text: 'y', sub: true },
          { text: 'code()', code: true },
          { text: 'cap', caps: true },
          { text: 'pcap', smallcaps: true },
          { text: 'ligne\nsuivante\taprès tab' },
        ],
        align: 'justify',
        indent: { left: 12, right: 6, first: -12 },
        spacing: { before: 3, after: 9 },
        line: 1.5,
        keepNext: true,
        keepLines: true,
        pageBreakBefore: true,
        shading: '#eeeeee',
        border: 'accent3',
      },
      { type: 'heading', level: 2, content: ['Sous-titre'] },
      { type: 'list', style: 'number', start: 4, numbering: 'ROMAN', items: [{ content: ['un'] }, { content: ['deux'], level: 1 }, { content: ['puce'], level: 2, style: 'bullet' }] },
      { type: 'list', style: 'number', continue: true, items: [{ content: ['suite'] }] },
      { type: 'list', style: 'bullet', bullet: '→', items: [{ content: ['flèche'] }, { content: ['num'], level: 1, style: 'number' }, { content: ['autre'] }, { content: ['puce'], level: 1, style: 'bullet' }] },
      { type: 'quote', blocks: ['Citation.', { type: 'heading', level: 3, content: ['Titre cité'] }] },
      { type: 'code', language: 'js', text: 'if (a < b && c) {\n\treturn "x"\n}' },
      { content: ['Encadré'], style: 'encadre' },
      { type: 'table', style: 'zebra', firstColumn: true, align: 'center', repeatHeader: true, widths: [120, 80, 80], rows: [[{ blocks: ['A'], colspan: 2 }, 'A3'], [{ blocks: ['B'], rowspan: 2, valign: 'middle', bg: '#ffeeaa' }, 'C', 'C3'], ['D', { blocks: ['E'], bg: 'accent2', valign: 'bottom' }]] },
      { type: 'table', style: 'boxed', header: false, border: '#00aa00', rows: [['x', 'y']] },
      { type: 'image', src: 'asset:p', alt: 'Trois pixels', width: 90, align: 'right', caption: ['Légende ', { text: 'une', italic: true }], crop: { top: 0, right: 10, bottom: 0, left: 10 }, rotate: 90, flip: 'h', border: '#112233' },
      { type: 'image', src: 'asset:p', alt: 'Flottante', width: 60, wrap: 'left' },
      { type: 'image', src: 'asset:s', alt: 'Vectorielle', width: 80 },
      { type: 'image', src: 'https://exemple.org/photo.jpg', alt: 'Photo du web' },
      { type: 'divider' },
      { type: 'pagebreak' },
      { type: 'columns', count: 3, gap: 20, rule: true, blocks: ['col a', { type: 'columnbreak' }, 'col b'] },
      { content: ['Entre deux sections.'] },
      { type: 'section', start: 'even', numberStart: 1, numberFormat: 'alpha', firstPage: false, footers: { default: ['Pied de section'] } },
      { content: [{ type: 'field', name: 'author' }, ' ', { type: 'field', name: 'organization' }, ' ', { type: 'field', name: 'filename' }, ' ', { type: 'field', name: 'time' }], style: 'title' },
    ],
  })

const rasterize = async () => bytesOfDataUri(PNG)!.bytes

describe('fichier .docx produit', async () => {
  const doc = RICH()
  const out = await exportDocx(doc, { now: new Date('2026-11-09T10:30:00Z'), filename: 'essai.docx', locale: 'fr', pages: 7, headingPages: [1, 2], rasterize, version: '9.9.9' })
  const files = parts(out.bytes)
  const body = files['word/document.xml']

  it('une archive ZIP dont toutes les parties XML sont bien formées', () => {
    expect([...out.bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 3, 4])
    for (const [name, xml] of Object.entries(files)) expect(() => parseXml(xml), name).not.toThrow()
    for (const need of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/footnotes.xml', 'word/endnotes.xml', 'word/comments.xml', 'word/commentsExtended.xml', 'word/settings.xml', 'word/theme/theme1.xml', 'docProps/core.xml', 'docProps/custom.xml']) {
      expect(Object.keys(files), need).toContain(need)
    }
  })

  it('chaque relation mène à une partie qui existe, chaque partie a son type', async () => {
    const { unzipSync } = await import('fflate')
    const all = Object.keys(unzipSync(out.bytes))
    const types = parseXml(files['[Content_Types].xml'])
    const defaults = types.children.filter((c) => c.name === 'Default').map((c) => c.attrs.Extension.toLowerCase())
    const overrides = types.children.filter((c) => c.name === 'Override').map((c) => c.attrs.PartName)
    for (const name of all) {
      if (name === '[Content_Types].xml') continue
      const ext = name.split('.').pop()!.toLowerCase()
      expect(defaults.includes(ext) || overrides.includes(`/${name}`), name).toBe(true)
    }
    for (const [name, xml] of Object.entries(files)) {
      if (!name.endsWith('.rels')) continue
      const base = name.startsWith('_rels/') ? '' : name.split('/_rels/')[0]
      for (const r of parseXml(xml).children) {
        if (r.attrs.TargetMode === 'External') continue
        const target = r.attrs.Target.startsWith('/') ? r.attrs.Target.slice(1) : [base, r.attrs.Target].filter(Boolean).join('/')
        expect(all, `${name} → ${r.attrs.Target}`).toContain(target)
      }
    }
    const ids = [...body.matchAll(/r:(?:id|embed)="([^"]+)"/g)].map((m) => m[1])
    const known = parseXml(files['word/_rels/document.xml.rels']).children.map((r) => r.attrs.Id)
    for (const id of ids) expect(known, id).toContain(id)
  })

  it('styles : identifiants uniques, styles intégrés reconnus, style personnel, héritage', () => {
    const styles = parseXml(files['word/styles.xml'])
    const ids = styles.children.filter((c) => c.name === 'w:style').map((s) => s.attrs['w:styleId'])
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ['Normal', 'Title', 'Subtitle', 'Heading1', 'Heading6', 'Quote', 'SourceCode', 'Caption', 'FootnoteText', 'EndnoteText', 'ListParagraph', 'TOCHeading', 'InlineCode', 'Hyperlink', 'encadre', 'FolioZebra']) expect(ids, id).toContain(id)
    const xml = files['word/styles.xml']
    expect(xml).toMatch(/w:styleId="Heading1"><w:name w:val="heading 1"\/><w:basedOn w:val="Normal"\/>/)
    expect(xml).toMatch(/w:styleId="encadre"><w:name w:val="Encadré"\/>/)
    const h1 = xml.slice(xml.indexOf('w:styleId="Heading1"'), xml.indexOf('w:styleId="Heading2"'))
    expect(h1).toContain('<w:b w:val="false"/>')
    expect(h1).toContain('w:val="AA0000"')
    expect(h1).toContain('<w:outlineLvl w:val="0"/>')
    expect(wordStyleId('heading3')).toBe('Heading3')
    expect(wordStyleId('Title')).toBe('Title_')
    expect(wordStyleId('monstyle')).toBe('monstyle')
    // Le thème du document : ses couleurs et ses polices.
    expect(files['word/theme/theme1.xml']).toContain('<a:accent1><a:srgbClr val="1E6B55"/></a:accent1>')
    expect(files['word/theme/theme1.xml']).toMatch(/<a:majorFont><a:latin typeface="Newsreader"/)
  })

  it('texte et mises en forme : échappés, complets, dans l’ordre', () => {
    expect(files['word/footnotes.xml']).toContain('Une note &lt;b&gt; &amp; co.')
    expect(files['docProps/core.xml']).toContain('<dc:title>Essai &lt;complet&gt; &amp; &quot;cité&quot;</dc:title>')
    const gras = body.slice(body.indexOf('>gras<') - 700, body.indexOf('>gras<'))
    for (const bit of ['<w:b/>', '<w:i/>', '<w:strike/>', '<w:u w:val="single"/>', 'w:themeColor="accent2"', 'w:fill="FFF176"', 'w:ascii="Georgia"', '<w:sz w:val="28"/>', '<w:spacing w:val="20"/>', '<w:lang w:val="en"/>']) expect(gras, bit).toContain(bit)
    expect(body).toContain('<w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">x</w:t>')
    expect(body).toContain('<w:rStyle w:val="InlineCode"/></w:rPr><w:t xml:space="preserve">code()</w:t>')
    expect(body).toMatch(/<w:caps\/><\/w:rPr><w:t[^>]*>cap</)
    expect(body).toMatch(/<w:smallCaps\/><\/w:rPr><w:t[^>]*>pcap</)
    expect(body).toMatch(/>ligne<\/w:t><\/w:r><w:r><w:br\/><w:t[^>]*>suivante<\/w:t><w:tab\/><w:t[^>]*>après tab</)
    const p = body.slice(body.indexOf('<w:pageBreakBefore/>') - 400, body.indexOf('<w:pageBreakBefore/>') + 900)
    for (const bit of ['<w:keepNext/>', '<w:keepLines/>', '<w:jc w:val="both"/>', 'w:left="240"', 'w:right="120"', 'w:hanging="240"', 'w:before="60"', 'w:after="180"', 'w:line="300"', 'w:fill="EEEEEE"', 'w:themeColor="accent3"']) expect(p, bit).toContain(bit)
  })

  it('liens, notes, commentaires, suivi des modifications', () => {
    const rels = files['word/_rels/document.xml.rels']
    expect(rels).toContain('Target="https://exemple.org/a?b=1&amp;c=2" TargetMode="External"')
    expect(rels).not.toContain('#ancre')
    expect(body).toMatch(/<w:hyperlink[^>]*><w:r><w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr><w:t[^>]*>lien</)
    expect(body).toContain('>interne</w:t>')
    expect(body).toContain('<w:footnoteReference w:id="1"/>')
    expect(body).toContain('<w:endnoteReference w:id="1"/>')
    expect(files['word/endnotes.xml']).toContain('dans la note')
    expect(body).toMatch(/<w:commentRangeStart w:id="0"\/><w:commentRangeStart w:id="1"\/><w:r><w:t[^>]*> commenté<\/w:t><\/w:r><w:commentRangeEnd w:id="0"\/><w:commentRangeEnd w:id="1"\/>/)
    const comments = files['word/comments.xml']
    expect(comments).toContain('w:author="Bob Lee"')
    expect(comments).toContain('w:initials="BL"')
    expect(comments).toMatch(/Vraiment \?<\/w:t><\/w:r><\/w:p><w:p[^>]*><w:r><w:t[^>]*>Sûr \?/)
    const ext = files['word/commentsExtended.xml']
    expect(ext).toMatch(/w15:done="1"/)
    expect(ext).toMatch(/w15:paraIdParent="/)
    expect(body).toMatch(/<w:ins w:id="\d+" w:author="Ada" w:date="2026-01-05T00:00:00.000Z"><w:r><w:t[^>]*> ajouté/)
    expect(body).toMatch(/<w:del w:id="\d+" w:author="Ada" w:date="2026-01-06T00:00:00.000Z"><w:r><w:delText[^>]*> supprimé/)
    expect(files['word/settings.xml']).toContain('<w:trackRevisions/>')
    // Le fil dont le texte a disparu est ancré au début, et c'est dit.
    expect(comments).toContain('Sur du texte supprimé')
    expect(body.indexOf('<w:commentReference w:id="2"/>')).toBeLessThan(body.indexOf('Titre un'))
  })

  it('listes : numérotation, reprise, niveaux, puce choisie, sous-listes de styles différents', () => {
    const num = files['word/numbering.xml']
    expect(num).toContain('<w:numFmt w:val="upperRoman"/>')
    expect(num).toContain('<w:lvlText w:val="→"/>')
    expect(num).toMatch(/<w:startOverride w:val="4"\/>/)
    const numIds = [...body.matchAll(/<w:ilvl w:val="(\d)"\/><w:numId w:val="(\d+)"\/><\/w:numPr><\/w:pPr>(?:<w:r><w:t[^>]*>([^<]*)<)?/g)].map((m) => [m[3], Number(m[1]), m[2]])
    const idOf = (t: string) => numIds.find((n) => n[0] === t)![2]
    expect(idOf('un')).toBe(idOf('deux'))
    expect(idOf('suite')).toBe(idOf('un'))
    expect(idOf('flèche')).not.toBe(idOf('un'))
    // « num » (numéroté) et la seconde « puce » sont au même niveau de la même liste : chacun sa numérotation.
    const puces = numIds.filter((n) => n[0] === 'puce')
    expect(puces.map((n) => n[1])).toEqual([2, 1])
    expect(idOf('num')).toBe(idOf('flèche'))
    expect(puces[1][2]).not.toBe(idOf('num'))
  })

  it('tableaux : fusions, largeurs, style rapide, en-tête répété', () => {
    const t = body.slice(body.indexOf('<w:tbl>'), body.indexOf('</w:tbl>'))
    expect(t).toContain('<w:tblStyle w:val="FolioZebra"/>')
    expect(t).toContain('<w:jc w:val="center"/>')
    expect(t).toContain('<w:tblLayout w:type="fixed"/>')
    expect(t).toContain('<w:gridCol w:w="2400"/><w:gridCol w:w="1600"/><w:gridCol w:w="1600"/>')
    expect(t).toContain('<w:tblHeader/>')
    expect(t).toContain('<w:gridSpan w:val="2"/>')
    expect(t).toContain('<w:vMerge w:val="restart"/>')
    expect(t).toContain('<w:vMerge w:val="continue"/>')
    expect(t).toContain('<w:vAlign w:val="center"/>')
    expect(t).toContain('w:fill="FFEEAA"')
    expect(t).toContain('w:themeFill="accent2"')
    expect(t.match(/<w:tr>|<w:tr /g)).toHaveLength(3)
    const second = body.slice(body.indexOf('<w:tbl>', body.indexOf('</w:tbl>')), body.lastIndexOf('</w:tbl>'))
    expect(second).toContain('<w:tblStyle w:val="FolioBoxed"/>')
    expect(second).toContain('w:color="00AA00"')
    expect(second).toContain('<w:tblLayout w:type="autofit"/>')
    expect(second).not.toContain('<w:tblHeader/>')
  })

  it('images : intégrées, taille, rognage, rotation, flottante, vectorielle avec repli, texte de remplacement', async () => {
    const { unzipSync } = await import('fflate')
    const media = Object.keys(unzipSync(out.bytes)).filter((k) => k.startsWith('word/media/'))
    expect(media.filter((m) => m.endsWith('.png')).length).toBeGreaterThanOrEqual(1)
    expect(media.some((m) => m.endsWith('.svg'))).toBe(true)
    expect(body).toContain('descr="Trois pixels"')
    expect(body).toContain('<wp:extent cx="1143000"')
    expect(body).toContain('<a:srcRect l="10000" t="0" r="10000" b="0"/>')
    expect(body).toContain('rot="5400000"')
    expect(body).toMatch(/flipH="(true|1)"/)
    expect(body).toContain('<a:srgbClr val="112233"/>')
    expect(body).toMatch(/<wp:anchor[\s\S]*?<wp:align>left<\/wp:align>[\s\S]*?<wp:wrapSquare/)
    expect(body).toContain('asvg:svgBlip')
    expect(body).toMatch(/<w:pStyle w:val="Caption"\/><\/w:pPr><w:r><w:t[^>]*>Légende <\/w:t><\/w:r><w:r><w:rPr><w:i\/>/)
    expect(body).toContain('>[Photo du web]</w:t>')
  })

  it('mise en page : sections, colonnes, en-têtes, numéros de page, notes, fond', () => {
    const sects = descendants(parseXml(body), 'w:sectPr')
    expect(sects.length).toBe(4)
    expect(body).toContain('<w:pgSz w:w="11906" w:h="8391" w:orient="landscape"/>')
    expect(body).toContain('w:top="850" w:right="680" w:bottom="850" w:left="680"')
    expect(body).toContain('<w:pgNumType w:start="3" w:fmt="upperRoman"/>')
    expect(body).toContain('<w:cols w:space="400" w:num="3" w:sep="true" w:equalWidth="true"/>')
    expect(body).toContain('<w:type w:val="continuous"/>')
    expect(body).toContain('<w:type w:val="evenPage"/>')
    expect(body).toContain('<w:pgNumType w:start="1" w:fmt="lowerLetter"/>')
    expect(body).toMatch(/<w:footnotePr><w:numFmt w:val="chicago"\/><w:numStart w:val="1"\/><w:numRestart w:val="eachPage"\/>/)
    expect(body).toMatch(/<w:endnotePr><w:numFmt w:val="lowerLetter"\/><w:numStart w:val="2"\/>/)
    expect(body).toMatch(/<w:headerReference w:type="default"[^>]*\/><w:headerReference w:type="first"[^>]*\/><w:headerReference w:type="even"/)
    expect(body).toContain('<w:pgBorders')
    expect(body).toContain('<w:background w:color="FFFBE6"/>')
    expect(files['word/settings.xml']).toMatch(/<w:evenAndOddHeaders(\/>| w:val="true")/)
    const headers = Object.keys(files).filter((k) => /^word\/header\d+\.xml$/.test(k)).map((k) => files[k]).join('\n')
    expect(headers).toContain('Première page')
    expect(headers).toContain('Pages paires')
    expect(headers).toMatch(/PAGE [\s\S]*NUMPAGES /)
    const footers = Object.keys(files).filter((k) => /^word\/footer\d+\.xml$/.test(k)).map((k) => files[k]).join('\n')
    expect(footers).toContain(' DATE \\@ &quot;dd/MM/yyyy&quot; </w:instrText>')
    expect(footers).toContain('>09/11/2026<')
    expect(footers).toContain('Pied de section')
  })

  it('table des matières à jour, champs avec leur valeur, propriétés', () => {
    expect(body).toMatch(/<w:pStyle w:val="TOCHeading"\/><\/w:pPr><w:r><w:t[^>]*>Sommaire/)
    expect(body).toContain('TOC \\h \\o &quot;1-2&quot;')
    expect(body).toMatch(/Titre un<\/w:t><w:tab\/><w:t[^>]*>1</)
    expect(body).toMatch(/Sous-titre<\/w:t><w:tab\/><w:t[^>]*>2</)
    expect(body).not.toContain('w:dirty="true"')
    expect(body).toMatch(/ AUTHOR <\/w:instrText><w:fldChar w:fldCharType="separate"\/><w:t[^>]*>Ada Moreau</)
    expect(body).toMatch(/ FILENAME <\/w:instrText>[\s\S]{0,80}>essai\.docx</)
    expect(body).toContain(' TIME \\@ &quot;HH:mm&quot; \\* MERGEFORMAT </w:instrText>')
    expect(body).toContain('>Atelier</w:t>')
    const core = files['docProps/core.xml']
    expect(core).toContain('<dc:creator>Ada Moreau</dc:creator>')
    expect(core).toContain('<dc:subject>Sujet</dc:subject>')
    expect(core).toContain('<cp:keywords>un, deux</cp:keywords>')
    expect(files['docProps/custom.xml']).toContain('Folio Pages 9.9.9')
    expect(files['docProps/custom.xml']).toContain('Atelier')
  })

  it('dit ce qui ne passe pas tel quel', () => {
    expect(Object.fromEntries(out.losses.map((l) => [l.code, l.count]))).toEqual({ 'link-internal': 1, 'quote-content': 1, 'code-colors': 1, 'image-remote': 1, 'comment-orphan': 1 })
  })

  it('se relit : même texte, mêmes structures', () => {
    const back = open(out.bytes)
    expect(back.issues).toEqual([])
    expect(back.res.losses).toEqual([])
    expect(back.doc.blocks.map((b) => b.type)).toEqual(['heading', 'toc', 'paragraph', 'heading', 'list', 'list', 'quote', 'heading', 'code', 'paragraph', 'table', 'table', 'image', 'image', 'image', 'paragraph', 'divider', 'pagebreak', 'columns', 'paragraph', 'section', 'paragraph'])
    expect(back.doc.page).toEqual(doc.page)
    expect(back.doc.notes).toEqual(doc.notes)
    expect(back.doc.styles).toEqual(doc.styles)
    expect(back.doc.theme).toEqual(doc.theme)
    expect(back.doc.meta).toMatchObject({ title: doc.meta.title, author: 'Ada Moreau', subject: 'Sujet', keywords: ['un', 'deux'], organization: 'Atelier', lang: 'fr' })
    expect(back.doc.headers).toEqual(doc.headers)
    expect(back.doc.comments.map((c) => [c.author, c.text, c.resolved, c.replies.length])).toEqual([['Bob Lee', 'Vraiment ?\nSûr ?', true, 1], ['Zoé', 'Sur du texte supprimé', false, 0]])
    // L'image vectorielle revient vectorielle.
    const svg = back.doc.blocks.filter((b) => b.type === 'image')[2] as { src: string }
    expect(back.doc.assets[svg.src.slice(6)]).toBe(SVG)
  })
})

describe('cas limites de l’export', () => {
  it('un document vide, ou réduit à un saut de section, donne un fichier valide', async () => {
    for (const blocks of [[], [{ type: 'section' }], [{ type: 'columns', blocks: [] }], [{ type: 'table', rows: [['']] }], [{ type: 'toc' }]]) {
      const out = await exportDocx(load({ blocks }))
      const files = parts(out.bytes)
      expect(() => parseXml(files['word/document.xml'])).not.toThrow()
      expect(files['word/document.xml']).toContain('<w:sectPr>')
      expect(() => open(out.bytes)).not.toThrow()
    }
  })

  it('sans moyen de convertir une image vectorielle : son texte de remplacement, et c’est dit', async () => {
    const missing = loadDocument({ format: 'folio/doc', version: 1, assets: { s: SVG }, blocks: [{ type: 'image', src: 'asset:s', alt: 'Logo' }, { type: 'image', src: 'asset:absente' }] }, { now: NOW })
    if (!missing.ok) throw new Error('refusé')
    const out = await exportDocx(missing.doc)
    expect(parts(out.bytes)['word/document.xml']).toContain('>[Logo]<')
    expect(out.losses).toEqual([{ code: 'image-format', count: 1 }, { code: 'image-missing', count: 1 }])
    const failing = await exportDocx(load({ assets: { s: SVG }, blocks: [{ type: 'image', src: 'asset:s', alt: 'Logo' }] }), { rasterize: async () => { throw new Error('canevas refusé') } })
    expect(failing.losses).toEqual([{ code: 'image-format', count: 1 }])
  })

  it('caractères difficiles : rien ne casse le XML', async () => {
    const hard = 'a\u0000b\u0001c\u000b ￾ ]]> <!-- --> &amp; 😀 ‮ droite-gauche   fine ligne'
    const out = await exportDocx(load({ meta: { title: hard }, comments: [{ id: 'c', author: hard, text: hard }], blocks: [{ content: [{ text: hard, comments: ['c'] }, { type: 'note', text: hard }] }, { type: 'code', text: hard }] }))
    for (const [name, xml] of Object.entries(parts(out.bytes))) expect(() => parseXml(xml), name).not.toThrow()
    expect(open(out.bytes).doc.blocks.length).toBe(2)
  })

  it('la table des matières demande une mise à jour quand les pages ne sont pas connues', async () => {
    const d = load({ blocks: [{ type: 'toc' }, { type: 'heading', level: 1, content: ['Un'] }] })
    expect(parts((await exportDocx(d)).bytes)['word/document.xml']).toContain('w:dirty="true"')
    expect(parts((await exportDocx(d, { headingPages: [1] })).bytes)['word/document.xml']).not.toContain('w:dirty="true"')
  })
})

// LibreOffice, s'il est installé, ouvre le fichier produit : un second avis, indépendant de notre import.
const soffice = ['soffice', 'libreoffice'].find((c) => spawnSync(c, ['--version'], { timeout: 20_000 }).status === 0)

describe.skipIf(!soffice)('ouverture par LibreOffice', () => {
  it('le document de démonstration et un document riche s’y ouvrent, texte entier', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'folio-docx-'))
    const cases: [string, FolioDoc, string[]][] = [
      ['demo', demoDocument('fr', NOW), ['Folio Pages', 'Mettre en forme']],
      ['riche', RICH(), ['Titre un', 'Bonjour', 'Sommaire', 'Citation.', 'if (a < b && c) {', 'Encadré', 'col b', 'Légende une', 'Pied de section', 'Première page', 'Vraiment ?', 'Une note <b> & co.', 'dans la note', 'suite', 'flèche']],
    ]
    for (const [name, doc, expected] of cases) {
      const out = await exportDocx(doc, { now: new Date(NOW), rasterize, headingPages: Array.from({ length: 40 }, () => 1) })
      writeFileSync(join(dir, `${name}.docx`), out.bytes)
      // Vers le format de LibreOffice en XML à plat : tout y est (notes, en-têtes, commentaires), et on y lit le texte.
      execFileSync(soffice!, ['--headless', `-env:UserInstallation=file://${dir}/profil`, '--convert-to', 'fodt', '--outdir', dir, join(dir, `${name}.docx`)], { timeout: 120_000, stdio: 'ignore' })
      const text = readFileSync(join(dir, `${name}.fodt`), 'utf8')
        .replace(/<office:binary-data>[^<]*<\/office:binary-data>/g, '')
        .replace(/<text:(tab|line-break)\/>/g, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
      for (const e of expected) expect(text, `${name} : ${e}`).toContain(e)
    }
  }, 240_000)
})
