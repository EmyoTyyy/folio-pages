import { describe, expect, it } from 'vitest'
// @ts-expect-error module JavaScript du build
import { decode, encode, FORBIDDEN, ILLEGAL, LOADER_DECODER } from '../../scripts/lib/b122.mjs'
// @ts-expect-error module JavaScript du build
import { inflateRaw } from '../../scripts/lib/inflate-raw.js'
import { deflateRawSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'

const loaderDecode = new Function(`${LOADER_DECODER}; return b122decode`)() as (t: string) => Uint8Array

/** Octets qui donnent des tranches interdites partout, dont la dernière. */
const nasty = (n: number) => {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = [0x00, 0x14, 0x1b, 0x3c, 0x78, 0x0a][i % 6]
  return out
}

describe('base122', () => {
  it('aller-retour exact pour toutes les longueurs', () => {
    for (let n = 0; n < 300; n++) {
      for (const bytes of [new Uint8Array(randomBytes(n)), nasty(n), new Uint8Array(n)]) {
        expect(Array.from(decode(encode(bytes)))).toEqual(Array.from(bytes))
      }
    }
  })
  it('ne produit aucun caractère interdit, ni hors de U+0001…U+07FF', () => {
    const text = encode(new Uint8Array(randomBytes(200_000)))
    for (const f of FORBIDDEN) expect(text.includes(f)).toBe(false)
    expect(/[^\u0001-\u07ff]/.test(text)).toBe(false)
    // Pas de caractères de contrôle C1 (U+0080…U+009F) ni de U+0080…U+017F.
    expect(/[\u0080-\u017f]/.test(text)).toBe(false)
  })
  it('8/7 de la taille en UTF-8, contre 5/4 pour la base86', () => {
    const bytes = new Uint8Array(randomBytes(100_000))
    const size = Buffer.byteLength(encode(bytes), 'utf8')
    expect(size).toBeGreaterThanOrEqual(Math.ceil((100_000 * 8) / 7))
    expect(size).toBeLessThan(100_000 * 1.15)
  })
  it('une dernière tranche interdite (indice 7) se relit', () => {
    for (const c of ILLEGAL) {
      // 7 octets = 8 tranches exactement : la dernière vaut c.
      const bytes = new Uint8Array([255, 255, 255, 255, 255, 255, c])
      const text = encode(bytes)
      expect(text.charCodeAt(text.length - 1) >> 8).toBe(7)
      expect(Array.from(decode(text))).toEqual(Array.from(bytes))
    }
  })
  it('les fins de ligne ajoutées par un outil sont sautées', () => {
    const bytes = new Uint8Array(randomBytes(5000))
    const text = encode(bytes)
    const wrapped = text.replace(/(.{76})/g, '$1\r\n')
    expect(Array.from(decode(wrapped))).toEqual(Array.from(bytes))
    expect(Array.from(loaderDecode(wrapped))).toEqual(Array.from(bytes))
  })
  it('refuse un caractère hors du code', () => {
    for (const bad of ['ab<c', 'a\u0000b', 'a\u001bb', 'a\u0080b', 'a\u0100b', 'a\u0800b', 'a\u0680b', 'a\u0785b']) {
      expect(() => decode(bad)).toThrow()
      expect(() => loaderDecode(bad)).toThrow()
    }
  })
  it('le décodeur du chargeur donne exactement le même résultat', () => {
    for (const n of [0, 1, 2, 6, 7, 8, 999, 4096, 100_000]) {
      for (const bytes of [new Uint8Array(randomBytes(n)), nasty(n)]) {
        expect(Array.from(loaderDecode(encode(bytes)))).toEqual(Array.from(bytes))
      }
    }
  })
  it('compressé puis encodé, relu par le chargeur', () => {
    const raw = Buffer.from(JSON.stringify({ x: Array(5000).fill('folio é ☃') }))
    expect(Buffer.from(inflateRaw(loaderDecode(encode(new Uint8Array(deflateRawSync(raw)))))).equals(raw)).toBe(true)
  })
})

describe('décompression DEFLATE (reprise de Bento)', () => {
  it('relit exactement ce que zlib a compressé', () => {
    const samples = [Buffer.alloc(0), Buffer.from('a'), Buffer.from('é'.repeat(10_000)), randomBytes(50_000), Buffer.from(JSON.stringify({ x: Array(5000).fill('folio') }))]
    for (const s of samples) {
      for (const level of [0, 1, 9]) expect(Buffer.from(inflateRaw(new Uint8Array(deflateRawSync(s, { level })))).equals(s)).toBe(true)
    }
  })
  it('échoue proprement sur des données tronquées', () => {
    const packed = deflateRawSync(randomBytes(10_000))
    expect(() => inflateRaw(new Uint8Array(packed.subarray(0, packed.length >> 1)))).toThrow()
  })
})
