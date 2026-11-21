// @vitest-environment jsdom
// Fichiers joints : format, validation, aller-retour dans l'éditeur, exports.

import { describe, expect, it } from 'vitest'
import { exportDocx } from '../../src/docx/export'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { toHtml } from '../../src/export/html'
import { exportOdt } from '../../src/export/odt'
import { toCompact } from '../../src/format/compact'
import { loadDocument } from '../../src/format/load'
import { inlineMarkdown } from '../../src/format/markdown-out'
import { runsText } from '../../src/format/runs'
import { cleanFileName, cleanMime, dataUriType } from '../../src/format/spec'
import type { FolioDoc, Inline } from '../../src/format/types'
import { NOW, open, parts } from './docx-helpers'

const FILE = 'data:application/octet-stream;base64,' + Buffer.from('a,b\n1,2\n').toString('base64')
const att = (o: Record<string, unknown> = {}) => ({ type: 'attachment', src: FILE, name: 'chiffres.csv', size: 8, mime: 'text/csv', ...o })

function load(content: unknown[], extra: Record<string, unknown> = {}) {
  return loadDocument({ format: 'folio/doc', version: 1, blocks: [{ type: 'paragraph', content }], ...extra }, { now: NOW })
}
const first = (d: FolioDoc) => (d.blocks[0] as { content: Inline[] }).content

describe('fichiers joints', () => {
  it('types de données : seulement des octets bruts ; noms et types nettoyés', () => {
    expect(dataUriType(FILE)).toBe('file')
    expect(dataUriType('data:text/html;base64,PGI+')).toBeNull()
    expect(cleanFileName('C:\\Users\\moi\\rapport<1>.pdf')).toBe('rapport1.pdf')
    expect(cleanFileName('../../etc/passwd')).toBe('passwd')
    expect(cleanMime('application/pdf')).toBe('application/pdf')
    expect(cleanMime('text/html; charset=x')).toBe('')
  })

  it('les octets vont dans les ressources ; synonymes ; JSON compact', () => {
    const r = load(['Voir ', att(), { type: 'file', src: FILE, name: 'b.bin' }, '.'])
    if (!r.ok) throw new Error('refusé')
    const items = first(r.doc).filter((x) => 'type' in x)
    expect(items).toHaveLength(2)
    const a = items[0] as Extract<Inline, { type: 'attachment' }>
    expect(a).toMatchObject({ type: 'attachment', name: 'chiffres.csv', size: 8, mime: 'text/csv' })
    expect(a.src).toMatch(/^asset:/)
    expect(r.doc.assets[a.src.slice(6)]).toBe(FILE)
    // même contenu : une seule ressource
    expect(Object.keys(r.doc.assets)).toHaveLength(1)
    expect(runsText(first(r.doc))).toBe('Voir [chiffres.csv][b.bin].')
    expect(JSON.stringify(toCompact(r.doc))).toContain('"type":"attachment"')
  })

  it('refusés : autre type de données, sans nom, dans une note ; ressource manquante signalée', () => {
    const r = load([att({ src: 'data:text/html;base64,PGI+' }), att({ name: '' }), { type: 'note', text: 'x' }, att({ src: 'asset:absent' })])
    if (!r.ok) throw new Error('refusé')
    expect(first(r.doc).filter((x) => 'type' in x && x.type === 'attachment')).toHaveLength(0)
    const codes = r.report.issues.map((i) => i.code)
    expect(codes).toEqual(expect.arrayContaining(['unsafe-attachment', 'missing-field', 'asset-missing']))
    const n = load([{ type: 'note', blocks: [{ type: 'paragraph', content: [att()] }] }])
    if (!n.ok) throw new Error('refusé')
    expect(JSON.stringify(n.doc.blocks)).not.toContain('attachment')
  })

  it('éditeur : aller-retour exact (octets, nom, taille, type)', () => {
    const r = load(['Avant ', att(), ' après'])
    if (!r.ok) throw new Error('refusé')
    const pm = docToPM(r.doc)
    let node: { attrs: Record<string, unknown> } | null = null
    pm.descendants((n) => {
      if (n.type.name === 'attachment') node = n
    })
    expect(node!.attrs).toMatchObject({ src: FILE, name: 'chiffres.csv', size: 8, mime: 'text/csv' })
    const back = pmToDoc(pm, { id: r.doc.id, created: NOW, modified: NOW })
    expect(first(back)).toEqual(first(r.doc))
    expect(back.assets).toEqual(r.doc.assets)
    expect(pm.textContent).toContain('[chiffres.csv]')
  })

  it('exports : page web (lien qui enregistre), EPUB/Markdown (nom), .docx et .odt (nom, perte signalée)', async () => {
    const r = load(['Voir ', att(), '.'])
    if (!r.ok) throw new Error('refusé')
    const html = toHtml(r.doc)
    expect(html).toContain(`<a class="attachment" href="${FILE}" download="chiffres.csv">chiffres.csv</a>`)
    expect(inlineMarkdown(first(r.doc))).toBe('Voir \\[chiffres.csv\\].')
    const docx = await exportDocx(r.doc, { now: new Date(NOW) })
    expect(docx.losses).toEqual([{ code: 'attachment', count: 1 }])
    expect(parts(docx.bytes)['word/document.xml']).toContain('[chiffres.csv]')
    expect(JSON.stringify(open(docx.bytes).doc.blocks)).toContain('[chiffres.csv]')
    const odt = await exportOdt(r.doc)
    expect(odt.losses).toEqual([{ code: 'attachment', count: 1 }])
  })
})
