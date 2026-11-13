import { describe, expect, it } from 'vitest'
// @ts-expect-error module JavaScript du build
import { ALPHABET, decode, encode, FORBIDDEN, LOADER_DECODER } from '../../scripts/lib/b86.mjs'
// @ts-expect-error module JavaScript du build
import { inflateRaw } from '../../scripts/lib/inflate-raw.js'
import { deflateRawSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'

describe('base86 (repris de Bento)', () => {
  it('alphabet de 86 caractères sûrs pour du HTML', () => {
    expect(ALPHABET).toHaveLength(86)
    for (const c of '<>&"\'\\-{') expect(ALPHABET).not.toContain(c)
  })
  it('aller-retour exact pour toutes les longueurs', () => {
    for (let n = 0; n < 300; n++) {
      const bytes = new Uint8Array(randomBytes(n))
      expect(Array.from(decode(encode(bytes)))).toEqual(Array.from(bytes))
    }
  })
  it('ne produit jamais de séquence interdite', () => {
    const text = encode(new Uint8Array(randomBytes(200_000)))
    for (const f of FORBIDDEN) expect(text.includes(f)).toBe(false)
  })
  it('refuse un caractère hors alphabet', () => {
    expect(() => decode('abc<e')).toThrow()
  })
  it('le décodeur du chargeur donne exactement le même résultat', () => {
    const b86decode = new Function(`${LOADER_DECODER}; return b86decode`)() as (t: string) => Uint8Array
    for (const n of [0, 1, 2, 3, 4, 5, 999, 4096]) {
      const bytes = new Uint8Array(randomBytes(n))
      expect(Array.from(b86decode(encode(bytes)))).toEqual(Array.from(bytes))
    }
    expect(() => b86decode('ab<cd')).toThrow()
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
