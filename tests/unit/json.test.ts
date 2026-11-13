import { describe, expect, it } from 'vitest'
import { escapeForScript, locateJsonError, prettyJson, repairJson } from '../../src/format/json'

describe('localisation des erreurs JSON', () => {
  it('ne signale rien sur un JSON valide', () => {
    for (const ok of ['{}', '[]', '"a"', '1', '-0.5e3', 'true', 'null', '{"a":[1,{"b":"\\u00e9\\n"}]}', ' \n {"a" : 1 } \n'])
      expect(locateJsonError(ok)).toBeNull()
  })

  const at = (text: string) => {
    const e = locateJsonError(text)!
    return [e.code, e.line, e.column]
  }

  it('donne la ligne et la colonne de la faute', () => {
    expect(at('{\n  "a": 1\n  "b": 2\n}')).toEqual(['expected-comma', 3, 3])
    expect(at('{"a" 1}')).toEqual(['expected-colon', 1, 6])
    expect(at('{a: 1}')).toEqual(['expected-key', 1, 2])
    expect(at("{'a': 1}")).toEqual(['expected-key', 1, 2])
  })

  it('reconnaît les virgules en trop', () => {
    expect(at('[1, 2,]')).toEqual(['trailing-comma', 1, 7])
    expect(at('{"a": 1,\n}')).toEqual(['trailing-comma', 2, 1])
  })

  it('reconnaît les chaînes mal formées', () => {
    expect(at('{"a": "pas fermé}')[0]).toBe('unterminated-string')
    expect(at('{"a": "ligne\ncoupée"}')[0]).toBe('unterminated-string')
    expect(at('"\\x"')[0]).toBe('bad-escape')
    expect(at('"\\u12"')[0]).toBe('bad-escape')
    expect(at('"a\tb"')[0]).toBe('control-char')
  })

  it('reconnaît une fin prématurée, un contenu en trop, un texte vide', () => {
    expect(at('{"a": [1, 2')[0]).toBe('unexpected-end')
    expect(at('{} {}')).toEqual(['trailing-content', 1, 4])
    expect(at('')[0]).toBe('empty')
    expect(at('   ')[0]).toBe('empty')
    expect(at('{"a": tru}')[0]).toBe('unexpected-char')
    expect(at('{"a": 01}')[0]).toBe('expected-comma')
    expect(at('{"a": -}')[0]).toBe('unexpected-char')
  })

  it('résiste à une imbrication extrême', () => {
    const deep = '['.repeat(100_000) + ']'.repeat(100_000)
    expect(() => locateJsonError(deep)).not.toThrow()
    expect(locateJsonError(deep)!.code).toBe('too-deep')
  })

  it('est d’accord avec JSON.parse sur des entrées variées', () => {
    const samples = ['{"a":1}', '{"a":1,}', '[1,,2]', '{"a":" "}', '[1e5, 2E-3, -0]', '{"a":.5}', '[NaN]', '{"a":"\\/"}']
    for (const s of samples) {
      let parsed = true
      try {
        JSON.parse(s)
      } catch {
        parsed = false
      }
      expect(locateJsonError(s) === null).toBe(parsed)
    }
  })
})

describe('réparation', () => {
  it('retire les virgules en trop et les commentaires, hors des chaînes', () => {
    const fixed = repairJson('{\n  // titre\n  "a": "http://x // pas un commentaire", /* bloc */\n  "b": [1, 2,],\n}')!
    expect(JSON.parse(fixed)).toEqual({ a: 'http://x // pas un commentaire', b: [1, 2] })
  })
  it('garde les chaînes contenant des guillemets échappés', () => {
    expect(JSON.parse(repairJson('{"a": "dit \\"oui\\", ",}')!)).toEqual({ a: 'dit "oui", ' })
  })
  it('renvoie null quand il n’y a rien à réparer', () => {
    expect(repairJson('{"a": 1}')).toBeNull()
    expect(repairJson('{"a": 1 "b": 2}')).toBeNull()
  })
})

describe('JSON lisible', () => {
  it('relit exactement la valeur écrite', () => {
    const v = { a: [1, 2, { b: 'x'.repeat(200), c: [] }], d: {}, e: 'é\n"', f: null, g: [[[]]] }
    expect(JSON.parse(prettyJson(v))).toEqual(v)
  })
  it('tient sur une ligne quand c’est court, se déplie sinon', () => {
    expect(prettyJson({ a: 1 })).toBe('{"a":1}')
    const long = prettyJson({ blocks: Array.from({ length: 20 }, (_, i) => ({ text: `paragraphe ${i}` })) })
    expect(long.split('\n').length).toBe(24) // { , "blocks": [ , 20 blocs, ] , }
    for (const line of long.split('\n')) expect(line.length).toBeLessThanOrEqual(100)
  })
  it('omet les champs undefined comme JSON.stringify', () => {
    expect(JSON.parse(prettyJson({ a: undefined, b: 1, c: 'x'.repeat(120) }))).toEqual({ b: 1, c: 'x'.repeat(120) })
  })
})

describe('échappement pour <script>', () => {
  it('ne laisse aucun < et reste du JSON équivalent', () => {
    const json = JSON.stringify({ t: '</script><!-- <b>' })
    const safe = escapeForScript(json)
    expect(safe).not.toContain('<')
    expect(JSON.parse(safe)).toEqual({ t: '</script><!-- <b>' })
  })
})
