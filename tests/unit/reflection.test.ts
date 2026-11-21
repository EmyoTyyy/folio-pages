// @vitest-environment jsdom
// Effets des images : reflet (nouveau), et ombre, halo, reflet écrits comme Word les écrit.

import { describe, expect, it } from 'vitest'
import { exportDocx } from '../../src/docx/export'
import { toHtml } from '../../src/export/html'
import { exportOdt } from '../../src/export/odt'
import { toCompact } from '../../src/format/compact'
import { loadDocument } from '../../src/format/load'
import { cleanAdjust } from '../../src/format/picture'
import type { Block, FolioDoc } from '../../src/format/types'
import { NOW, open, parts } from './docx-helpers'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR42mNkYPhfz4AEGAEADAQBAc0kzM4AAAAASUVORK5CYII='
type Img = Extract<Block, { type: 'image' }>

function load(blocks: unknown[]): FolioDoc {
  const r = loadDocument({ format: 'folio/doc', version: 1, assets: { p: PNG }, blocks }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  return r.doc
}
const imgs = (d: FolioDoc) => d.blocks.filter((b): b is Img => b.type === 'image')

describe('reflet des images', () => {
  it('borné : 10 à 100 %, 0 l’enlève', () => {
    const c = (v: unknown) => cleanAdjust({ reflection: v }, () => null)?.reflection
    expect(c(50)).toBe(50)
    expect(c(4)).toBe(10)
    expect(c(250)).toBe(100)
    expect(c(0)).toBeUndefined()
    expect(c('beaucoup')).toBeUndefined()
  })

  it('JSON compact : gardé', () => {
    const d = load([{ type: 'image', src: 'asset:p', adjust: { reflection: 33 } }])
    expect(imgs(d)[0].adjust).toEqual({ reflection: 33 })
    expect(JSON.stringify(toCompact(d))).toContain('"reflection":33')
  })

  it('.docx : ombre, halo et reflet deviennent des effets de Word, et reviennent à l’import', async () => {
    const d = load([
      { type: 'image', src: 'asset:p', alt: 'a', width: 60, adjust: { shadow: true, glow: '#3366CC', reflection: 50 } },
      { type: 'image', src: 'asset:p', alt: 'b', width: 60, wrap: 'right', adjust: { reflection: 100 } },
      { type: 'image', src: 'asset:p', alt: 'c', width: 60 },
    ])
    const out = await exportDocx(d, { now: new Date(NOW) })
    expect(out.losses).toEqual([])
    const xml = parts(out.bytes)['word/document.xml']
    expect(xml).not.toContain('FolioFx')
    expect(xml).toContain('<a:effectLst><a:glow rad="63500"><a:srgbClr val="3366CC">')
    expect(xml).toMatch(/<a:outerShdw [^>]*><a:prstClr val="black">[\s\S]*?<\/a:outerShdw><a:reflection [^>]*endPos="50000"[^>]*\/><\/a:effectLst><\/pic:spPr>/)
    expect(xml).toContain('endPos="100000"')
    expect((xml.match(/<a:effectLst>/g) ?? []).length).toBe(2)
    const back = imgs(open(out.bytes).doc)
    expect(back[0].adjust).toEqual({ shadow: true, glow: '#3366cc', reflection: 50 })
    expect(back[1].adjust?.reflection).toBe(100)
    expect(back[2].adjust).toBeFalsy()
  })

  it('page web : une copie retournée, décorative ; .odt : signalé', async () => {
    const d = load([{ type: 'image', src: 'asset:p', alt: 'Montagne', width: 60, adjust: { reflection: 50 } }])
    const html = toHtml(d)
    expect(html.match(/<img /g)).toHaveLength(2)
    expect(html).toContain('alt="Montagne"')
    expect(html).toMatch(/aria-hidden="true" style="display:block;width:60pt;height:20pt;[^"]*mask-image:linear-gradient/)
    expect(html).toContain('transform:scaleY(-1)')
    const odt = await exportOdt(d)
    expect(odt.losses).toEqual([{ code: 'picture-reflection', count: 1 }])
  })
})
