// Export en livre numérique (EPUB 3) : le document découpé en chapitres (un
// par titre de niveau 1), sa table des matières, ses images, ses formules
// (MathML) et ses notes, lisible sur liseuse, téléphone ou ordinateur.

import { strToU8, zipSync, type Zippable } from 'fflate'
import type { Block, FolioDoc } from '../format/types'
import { isRun } from '../format/types'
import { base64Bytes, imageData, inlineText, prepareExport, type ExportCommonOptions } from './common'
import { documentCss, esc, HtmlWriter } from './html'

export interface EpubResult {
  bytes: Uint8Array
  chapters: number
}

/** Types d'images que toutes les liseuses EPUB 3 affichent. */
const CORE_IMAGES = /^image\/(png|jpeg|gif|svg\+xml|webp)$/

export function exportEpub(doc: FolioDoc, o: ExportCommonOptions = {}): EpubResult {
  const ctx = prepareExport(doc, o)
  const lang = doc.meta.lang || ctx.locale
  const title = doc.meta.title || inlineText((doc.blocks.find((b) => b.type === 'heading' || (b.type === 'paragraph' && b.style === 'title')) as { content?: [] } | undefined)?.content ?? [], ctx).trim() || (ctx.fr ? 'Document' : 'Document')
  const images = new Map<string, { path: string; mime: string; bytes: Uint8Array }>()
  const w = new HtmlWriter(ctx, {
    ...o,
    xhtml: true,
    imageHref: (id, mime) => {
      const known = images.get(id)
      if (known) return known.path
      const d = imageData(`asset:${id}`, doc)
      if (!d || !CORE_IMAGES.test(mime)) return ''
      const path = `images/${String(images.size + 1).padStart(3, '0')}.${d.ext}`
      images.set(id, { path, mime, bytes: base64Bytes(d.base64) })
      return path
    },
  })

  // Chapitres : on coupe avant chaque titre de niveau 1 (au premier niveau du document).
  const chapters: Block[][] = [[]]
  for (const b of doc.blocks) {
    if (b.type === 'heading' && b.level === 1 && chapters[chapters.length - 1].some((x) => !(x.type === 'paragraph' && x.content.every((c) => isRun(c) && !c.text.trim())))) chapters.push([])
    chapters[chapters.length - 1].push(b)
  }
  const files = chapters.map((_, i) => `chapter-${String(i + 1).padStart(3, '0')}.xhtml`)
  const bodies = chapters.map((c) => w.blocks(c))
  const notes = w.notes()
  if (notes) {
    files.push('notes.xhtml')
    bodies.push(notes)
  }
  // Chaque ancre vit dans un fichier : les liens internes y pointent.
  const home = new Map<string, string>()
  bodies.forEach((html, i) => {
    for (const m of html.matchAll(/\sid="([^"]+)"/g)) if (!home.has(m[1])) home.set(m[1], files[i])
  })
  const relink = (html: string, file: string) => html.replace(/href="#([^"]+)"/g, (all, id: string) => (home.has(id) && home.get(id) !== file ? `href="${home.get(id)}#${id}"` : all))
  const page = (body: string, file: string, heading = '') =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}"><head><meta charset="utf-8"/><title>${esc(heading || title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><div class="folio-page">${relink(body, file)}</div></body></html>`
  const xhtml = bodies.map((b, i) => page(b, files[i]))

  // Table des matières : les titres (jusqu'au niveau 3), à leur place dans les chapitres.
  type Entry = { text: string; href: string; level: number }
  const entries: Entry[] = []
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.type === 'heading' && b.level <= 3) {
        const id = ctx.headingId.get(b)!
        entries.push({ text: inlineText(b.content, ctx).trim() || '—', href: `${home.get(id) ?? files[0]}#${id}`, level: b.level })
      } else if (b.type === 'columns' || b.type === 'quote') walk(b.blocks)
    }
  }
  walk(doc.blocks)
  if (!entries.length) entries.push({ text: title, href: files[0], level: 1 })
  if (notes) entries.push({ text: ctx.words.notes, href: 'notes.xhtml', level: 1 })
  const navList = (list: Entry[]): string => {
    let out = '<ol>'
    let i = 0
    while (i < list.length) {
      const e = list[i]
      const kids: Entry[] = []
      let j = i + 1
      while (j < list.length && list[j].level > e.level) kids.push(list[j++])
      out += `<li><a href="${esc(e.href)}">${esc(e.text)}</a>${kids.length ? navList(kids.map((k) => ({ ...k, level: k.level }))) : ''}</li>`
      i = j
    }
    return out + '</ol>'
  }
  const nav = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}"><head><meta charset="utf-8"/><title>${esc(ctx.words.contents)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><nav epub:type="toc" id="toc"><h1>${esc(ctx.words.contents)}</h1>${navList(entries)}</nav></body></html>`
  // Ancien sommaire (EPUB 2), pour les liseuses qui ne lisent pas encore nav.xhtml.
  let play = 0
  const ncxPoints = (list: Entry[]): string => {
    let out = ''
    let i = 0
    while (i < list.length) {
      const e = list[i]
      const kids: Entry[] = []
      let j = i + 1
      while (j < list.length && list[j].level > e.level) kids.push(list[j++])
      play++
      out += `<navPoint id="np${play}" playOrder="${play}"><navLabel><text>${esc(e.text)}</text></navLabel><content src="${esc(e.href)}"/>${ncxPoints(kids)}</navPoint>`
      i = j
    }
    return out
  }
  const id = `urn:folio:${doc.id}`
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${esc(id)}"/></head><docTitle><text>${esc(title)}</text></docTitle><navMap>${ncxPoints(entries)}</navMap></ncx>`

  const modified = (doc.meta.modified && !Number.isNaN(Date.parse(doc.meta.modified)) ? new Date(doc.meta.modified) : ctx.fieldCtx.now).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const props = (html: string) => [html.includes('<math') && 'mathml', html.includes('<svg') && 'svg'].filter(Boolean).join(' ')
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...files.map((f, i) => `<item id="c${i + 1}" href="${f}" media-type="application/xhtml+xml"${props(xhtml[i]) ? ` properties="${props(xhtml[i])}"` : ''}/>`),
    ...[...images.values()].map((im, i) => `<item id="img${i + 1}" href="${im.path}" media-type="${im.mime}"/>`),
  ]
  const m = doc.meta
  const opf = `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${esc(lang)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="pub-id">${esc(id)}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>${esc(lang)}</dc:language>${m.author ? `<dc:creator>${esc(m.author)}</dc:creator>` : ''}${m.subject ? `<dc:description>${esc(m.subject)}</dc:description>` : ''}${m.organization ? `<dc:publisher>${esc(m.organization)}</dc:publisher>` : ''}${m.keywords.map((k) => `<dc:subject>${esc(k)}</dc:subject>`).join('')}<meta property="dcterms:modified">${modified}</meta><meta name="generator" content="Folio Pages"/></metadata><manifest>${manifest.join('')}</manifest><spine toc="ncx">${files.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine></package>`
  const container = `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  const css = documentCss(doc, { screen: false, fonts: false }) + '\n.folio-page{max-width:none}\nnav ol{list-style:none;padding-left:1.2em}\nnav>ol{padding-left:0}'

  // « mimetype » d'abord et sans compression : c'est ainsi qu'une liseuse reconnaît un EPUB.
  const zip: Zippable = { mimetype: [strToU8('application/epub+zip'), { level: 0 }] }
  zip['META-INF/container.xml'] = strToU8(container)
  zip['OEBPS/content.opf'] = strToU8(opf)
  zip['OEBPS/nav.xhtml'] = strToU8(nav)
  zip['OEBPS/toc.ncx'] = strToU8(ncx)
  zip['OEBPS/style.css'] = strToU8(css)
  files.forEach((f, i) => (zip[`OEBPS/${f}`] = strToU8(xhtml[i])))
  for (const im of images.values()) zip[`OEBPS/${im.path}`] = [im.bytes, { level: 0 }]
  return { bytes: zipSync(zip, { level: 6 }), chapters: files.length }
}
