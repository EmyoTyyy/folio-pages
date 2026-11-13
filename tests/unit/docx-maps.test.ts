import { describe, expect, it } from 'vitest'
import {
  base64,
  builtinOfStyleName,
  bytesOfDataUri,
  colorOf,
  dateFormatFromWord,
  dateFormatToWord,
  highlightFill,
  highlightOfFill,
  imageSize,
  lineFromWord,
  lineToWord,
  mmOfTwips,
  ptOfEmu,
  ptOfTwips,
  sniffImage,
  styleKey,
  tableLook,
  tableStyleId,
  tableStyleOfId,
  tint,
  twips,
  twipsOfMm,
} from '../../src/docx/maps'
import { defaultTheme } from '../../src/format/theme'
import { KEY_PATTERN, TABLE_STYLES } from '../../src/format/types'

const b64 = (s: string) => bytesOfDataUri(`data:image/x;base64,${s}`)!.bytes
const PNG = b64('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR42mNkYPhfz4AEGAEADAQBAc0kzM4AAAAASUVORK5CYII=')
const GIF = b64('R0lGODlhBQAHAIAAAAAAAP///ywAAAAABQAHAAACBoSPqcvtBQA7')

describe('unités', () => {
  it('points, twips, millimètres, EMU', () => {
    expect(twips(12)).toBe(240)
    expect(ptOfTwips(240)).toBe(12)
    expect(twipsOfMm(25.4)).toBe(1440)
    expect(mmOfTwips(1440)).toBe(25.4)
    expect(mmOfTwips(twipsOfMm(210))).toBe(210)
    expect(ptOfEmu(12700)).toBe(1)
    for (const pt of [0.5, 7, 13.5, 240.5]) expect(ptOfTwips(twips(pt))).toBe(pt)
  })

  it('interligne : « simple » ailleurs (240) vaut 1,2 ici, aller et retour', () => {
    expect(lineFromWord(240)).toBe(1.2)
    expect(lineToWord(1.2)).toBe(240)
    for (const l of [1, 1.15, 1.45, 1.5, 2, 3]) expect(lineFromWord(lineToWord(l))).toBeCloseTo(l, 2)
  })
})

describe('styles et couleurs', () => {
  it('reconnaît les styles intégrés à leur nom, dans plusieurs langues', () => {
    expect(builtinOfStyleName('heading 1', 'Titre1')).toBe('heading1')
    expect(builtinOfStyleName('Heading 6', 'Heading6')).toBe('heading6')
    expect(builtinOfStyleName('heading 7', 'Heading7')).toBeNull()
    expect(builtinOfStyleName('Title', 'Titre')).toBe('title')
    expect(builtinOfStyleName('Normal', 'Normal')).toBe('normal')
    expect(builtinOfStyleName('Standard', 'Standard')).toBe('normal')
    expect(builtinOfStyleName('Bloc de citation', 'Blocdecitation')).toBe('quote')
    expect(builtinOfStyleName('Intense Quote', 'IntenseQuote')).toBe('quote')
    expect(builtinOfStyleName('Texte préformaté', 'Texteprformat')).toBe('code')
    expect(builtinOfStyleName('footnote text', 'Notedebasdepage')).toBe('footnote')
    expect(builtinOfStyleName('caption', 'Lgende')).toBe('caption')
    expect(builtinOfStyleName('Mon style', 'Monstyle')).toBeNull()
  })

  it('fabrique des identifiants de style acceptables', () => {
    for (const id of ['Encadré', '1erTitre', 'a b/c', '', 'x'.repeat(200), '日本語']) expect(styleKey(id)).toMatch(KEY_PATTERN)
    expect(styleKey('Encadr')).toBe('Encadr')
  })

  it('couleurs, teintes et surligneurs', () => {
    expect(colorOf('1E6B55')).toBe('#1e6b55')
    expect(colorOf('auto')).toBeNull()
    expect(colorOf('red; background:url(x)')).toBeNull()
    expect(colorOf(undefined)).toBeNull()
    expect(tint('#000000', 0.5)).toBe('#808080')
    expect(tint('#1e6b55', 1)).toBe('#1e6b55')
    expect(tint('#1e6b55', 0)).toBe('#ffffff')
    expect(highlightOfFill(highlightFill('yellow'))).toBe('yellow')
    expect(highlightOfFill('#123456')).toBe('#123456')
    expect(highlightFill('#abcdef')).toBe('#abcdef')
  })

  it('styles rapides de tableau : un identifiant reconnaissable et une apparence', () => {
    const theme = defaultTheme()
    for (const s of TABLE_STYLES) {
      expect(tableStyleOfId(tableStyleId(s))).toBe(s)
      const look = tableLook(s, theme)
      expect(look.color).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(tableStyleOfId('TableGrid')).toBeNull()
    expect(tableStyleOfId(undefined)).toBeNull()
    expect(tableLook('zebra', theme).bandFill).toBe(tint(theme.colors.accent1, 0.08))
    expect(tableLook('grid', theme, '#ff0000').color).toBe('#ff0000')
    expect(tableLook('lines', theme)).toMatchObject({ outerH: 4, outerV: 0, insideV: 0 })
  })
})

describe('formats de date', () => {
  it('se convertissent dans les deux sens', () => {
    expect(dateFormatToWord('DD/MM/YYYY')).toBe('dd/MM/yyyy')
    expect(dateFormatToWord('dddd D MMMM YYYY [à] HH:mm')).toBe("dddd d MMMM yyyy 'à' HH:mm")
    expect(dateFormatToWord('h:mm A')).toBe('h:mm AM/PM')
    expect(dateFormatFromWord('dd/MM/yyyy')).toBe('DD/MM/YYYY')
    expect(dateFormatFromWord("d MMMM yyyy 'à' H:m:s am/pm")).toBe('D MMMM YYYY [à] H:mm:ss A')
    for (const f of ['DD/MM/YYYY', 'D MMMM YYYY', 'YY-MM-DD', 'dddd D MMM', 'HH:mm:ss', 'hh:mm A', '[le] D']) expect(dateFormatFromWord(dateFormatToWord(f))).toBe(f)
    expect(dateFormatFromWord('x'.repeat(500)).length).toBeLessThanOrEqual(60)
  })
})

describe('données binaires', () => {
  it('base64 : aller-retour pour toutes les longueurs', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100, 8191, 8192, 8193, 20000]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255)
      const text = base64(bytes)
      expect(text).toBe(Buffer.from(bytes).toString('base64'))
      expect([...bytesOfDataUri(`data:image/png;base64,${text}`)!.bytes]).toEqual([...bytes])
    }
    expect(bytesOfDataUri('https://exemple.org/a.png')).toBeNull()
    expect(bytesOfDataUri('data:text/html,<script>')).toBeNull()
  })

  it('reconnaît le type et la taille des images, sans les décoder', () => {
    expect(sniffImage(PNG)).toBe('png')
    expect(imageSize(PNG)).toEqual({ width: 3, height: 2 })
    expect(sniffImage(GIF)).toBe('gif')
    expect(imageSize(GIF)).toEqual({ width: 5, height: 7 })
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 9, 0, 16, 3, 1, 0x11, 0, 0xff, 0xd9])
    expect(sniffImage(jpeg)).toBe('jpeg')
    expect(imageSize(jpeg)).toEqual({ width: 16, height: 9 })
    const bmp = new Uint8Array(30)
    bmp.set([0x42, 0x4d])
    bmp.set([4, 0, 0, 0], 18)
    bmp.set([6, 0, 0, 0], 22)
    expect(imageSize(bmp)).toEqual({ width: 4, height: 6 })
    const webp = new Uint8Array(30)
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58])
    webp.set([9, 0, 0], 24)
    webp.set([19, 0, 0], 27)
    expect(sniffImage(webp)).toBe('webp')
    expect(imageSize(webp)).toEqual({ width: 10, height: 20 })
    const svg = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="120" height="48pt" viewBox="0 0 10 10"/>')
    expect(sniffImage(svg)).toBe('svg+xml')
    expect(imageSize(svg)).toEqual({ width: 120, height: 64 })
    expect(imageSize(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><path/></svg>'))).toEqual({ width: 300, height: 200 })
    // Métafichier, données quelconques, image tronquée : pas reconnus, jamais d'exception.
    expect(sniffImage(new Uint8Array([1, 0, 0, 0, 108, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull()
    expect(imageSize(new Uint8Array(5))).toBeNull()
    expect(imageSize(PNG.slice(0, 20))).toBeNull()
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0]))).toBeNull()
  })
})
