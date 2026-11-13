import { describe, expect, it } from 'vitest'
import { arr, bool, check, DROP, either, enumOf, int, obj, ref, Report, str, tagged, type Ctx, type Desc } from '../../src/format/dsl'

function ctxFor(defs: Record<string, Desc> = {}, limits = { maxDepth: 16, maxNodes: 1000 }): Ctx {
  return { report: new Report(), defs, limits, depth: 0, nodes: 0, tooLarge: false }
}

describe('chaînes', () => {
  const d = str({ max: 5, def: 'x' })
  it('accepte une chaîne', () => {
    const ctx = ctxFor()
    expect(check(d, 'abc', 'p', ctx)).toBe('abc')
    expect(ctx.report.issues).toEqual([])
  })
  it('tronque au-delà de la limite, avec un avertissement', () => {
    const ctx = ctxFor()
    expect(check(d, 'abcdefgh', 'p', ctx)).toBe('abcde')
    expect(ctx.report.warnings).toBe(1)
    expect(ctx.report.issues[0]).toMatchObject({ code: 'truncated', path: 'p' })
  })
  it('convertit un nombre ou un booléen', () => {
    const ctx = ctxFor()
    expect(check(d, 42, 'p', ctx)).toBe('42')
    expect(check(d, true, 'p', ctx)).toBe('true')
    expect(ctx.report.warnings).toBe(2)
  })
  it('ignore un objet, un tableau, null, NaN', () => {
    const ctx = ctxFor()
    for (const v of [{}, [], null, NaN, undefined]) expect(check(d, v, 'p', ctx)).toBe(DROP)
    expect(ctx.report.ignored).toBe(5)
  })
  it('applique le motif et le test', () => {
    const ctx = ctxFor()
    const p = str({ max: 10, pattern: /^a+$/, test: (s) => s.length > 1, refusal: 'unsafe-link' })
    expect(check(p, 'aa', 'p', ctx)).toBe('aa')
    expect(check(p, 'b', 'p', ctx)).toBe(DROP)
    expect(check(p, 'a', 'p', ctx)).toBe(DROP)
    expect(ctx.report.issues.map((i) => i.code)).toEqual(['unsafe-link', 'unsafe-link'])
  })
})

describe('entiers', () => {
  const d = int({ min: 1, max: 6, def: 1 })
  it('borne les valeurs hors limites', () => {
    const ctx = ctxFor()
    expect(check(d, 9, 'l', ctx)).toBe(6)
    expect(check(d, -3, 'l', ctx)).toBe(1)
    expect(ctx.report.issues.map((i) => i.code)).toEqual(['clamped', 'clamped'])
  })
  it('arrondit et convertit les chaînes numériques', () => {
    const ctx = ctxFor()
    expect(check(d, 2.6, 'l', ctx)).toBe(3)
    expect(check(d, ' 4 ', 'l', ctx)).toBe(4)
    expect(check(d, '2.4', 'l', ctx)).toBe(2)
  })
  it('ignore ce qui n’est pas un nombre', () => {
    const ctx = ctxFor()
    for (const v of ['deux', '', {}, null, true, Infinity, NaN]) expect(check(d, v, 'l', ctx)).toBe(DROP)
    expect(ctx.report.ignored).toBe(7)
  })
})

describe('booléens et énumérations', () => {
  it('accepte "true"/"false" et 1/0 avec un avertissement', () => {
    const ctx = ctxFor()
    expect(check(bool(), 'true', 'b', ctx)).toBe(true)
    expect(check(bool(), 0, 'b', ctx)).toBe(false)
    expect(check(bool(), 'oui', 'b', ctx)).toBe(DROP)
    expect(ctx.report.warnings).toBe(2)
    expect(ctx.report.ignored).toBe(1)
  })
  it('ramène la casse et les alias', () => {
    const ctx = ctxFor()
    const e = enumOf(['bullet', 'number'], { aliases: { ordered: 'number' } })
    expect(check(e, 'number', 's', ctx)).toBe('number')
    expect(check(e, ' Bullet ', 's', ctx)).toBe('bullet')
    expect(check(e, 'ORDERED', 's', ctx)).toBe('number')
    expect(check(e, 'roman', 's', ctx)).toBe(DROP)
    expect(check(e, 'constructor', 's', ctx)).toBe(DROP)
  })
})

describe('objets', () => {
  const d = obj({ a: str({ max: 10, def: '' }), b: int({ min: 0, max: 9 }) }, { required: ['b'] })
  it('ignore et compte les champs inconnus', () => {
    const ctx = ctxFor()
    expect(check(d, { a: 'x', b: 1, c: 2, d: 3 }, 'o', ctx)).toEqual({ a: 'x', b: 1 })
    expect(ctx.report.ignored).toBe(2)
    expect(ctx.report.issues.map((i) => i.path)).toEqual(['o.c', 'o.d'])
  })
  it('complète les valeurs par défaut', () => {
    expect(check(d, { b: 1 }, 'o', ctxFor())).toEqual({ a: '', b: 1 })
  })
  it('ignore l’objet entier si un champ obligatoire manque', () => {
    const ctx = ctxFor()
    expect(check(d, { a: 'x' }, 'o', ctx)).toBe(DROP)
    expect(ctx.report.issues[0]).toMatchObject({ code: 'missing-field', detail: 'b' })
  })
  it('ne se laisse pas piéger par les clés héritées de Object.prototype', () => {
    const ctx = ctxFor()
    const hostile = JSON.parse('{"b":1,"constructor":"x","__proto__":{"polluted":true},"toString":3,"hasOwnProperty":4}')
    const out = check(d, hostile, 'o', ctx) as Record<string, unknown>
    expect(out).toEqual({ a: '', b: 1 })
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(ctx.report.ignored).toBe(4)
  })
  it('compte les objets et s’arrête au-delà de la limite', () => {
    const ctx = ctxFor({}, { maxDepth: 16, maxNodes: 3 })
    const list = arr(obj({}), { max: 100 })
    const out = check(list, [{}, {}, {}, {}, {}], 'l', ctx) as unknown[]
    expect(out).toHaveLength(3)
    expect(ctx.report.issues.filter((i) => i.code === 'too-large')).toHaveLength(1)
  })
})

describe('tableaux', () => {
  it('ignore les éléments en trop, en un seul signalement', () => {
    const ctx = ctxFor()
    const out = check(arr(str({ max: 5 }), { max: 2 }), ['a', 'b', 'c', 'd'], 'k', ctx)
    expect(out).toEqual(['a', 'b'])
    expect(ctx.report.issues).toEqual([{ kind: 'ignored', code: 'too-many-items', path: 'k', detail: '2' }])
  })
  it('retire les éléments invalides sans bloquer les autres', () => {
    const ctx = ctxFor()
    expect(check(arr(int({ min: 0, max: 9 }), { max: 9 }), [1, 'x', 3], 'k', ctx)).toEqual([1, 3])
  })
  it('découpe une chaîne quand c’est prévu', () => {
    const d = arr(str({ max: 9 }), { max: 9, fromString: (s) => s.split(',') })
    expect(check(d, 'a,b', 'k', ctxFor())).toEqual(['a', 'b'])
  })
})

describe('alternatives et références', () => {
  const defs: Record<string, Desc> = {}
  defs.Node = obj({ name: str({ max: 9 }), children: arr(ref('Node'), { max: 9 }) })
  it('choisit selon le type de la valeur', () => {
    const d = either([str({ max: 9 }), obj({ x: int({ min: 0, max: 9 }) })])
    expect(check(d, 'a', 'e', ctxFor())).toBe('a')
    expect(check(d, { x: 2 }, 'e', ctxFor())).toEqual({ x: 2 })
    expect(check(d, 5, 'e', ctxFor())).toBe('5')
    expect(check(d, [1], 'e', ctxFor())).toBe(DROP)
  })
  it('limite la profondeur d’imbrication', () => {
    const ctx = ctxFor(defs, { maxDepth: 3, maxNodes: 1000 })
    let deep: Record<string, unknown> = { name: 'leaf' }
    for (let i = 0; i < 10; i++) deep = { name: String(i), children: [deep] }
    check(ref('Node'), deep, '', ctx)
    expect(ctx.report.issues.some((i) => i.code === 'too-deep')).toBe(true)
  })
  it('supporte une imbrication très profonde sans débordement de pile', () => {
    const ctx = ctxFor(defs, { maxDepth: 16, maxNodes: 1_000_000 })
    let deep: Record<string, unknown> = { name: 'leaf' }
    for (let i = 0; i < 50_000; i++) deep = { children: [deep] }
    expect(() => check(ref('Node'), deep, '', ctx)).not.toThrow()
  })
})

describe('unions étiquetées', () => {
  const d = tagged({
    tag: 'type',
    fallback: 'p',
    resolve: (t) => (t === 'para' ? { variant: 'p' } : t === 'h2' ? { variant: 'h', patch: { level: 2 } } : null),
    salvage: (v) => ('text' in v ? 'p' : null),
    variants: {
      p: obj({ text: str({ max: 99 }) }),
      h: obj({ level: int({ min: 1, max: 6, def: 1 }), text: str({ max: 99 }) }),
    },
  })
  it('utilise la variante par défaut sans type', () => {
    expect(check(d, { text: 'a' }, 'b', ctxFor())).toEqual({ type: 'p', text: 'a' })
  })
  it('résout les alias, avec leurs champs implicites', () => {
    const ctx = ctxFor()
    expect(check(d, { type: 'h2', text: 'a' }, 'b', ctx)).toEqual({ type: 'h', level: 2, text: 'a' })
    expect(check(d, { type: 'para', text: 'a' }, 'b', ctx)).toEqual({ type: 'p', text: 'a' })
    expect(ctx.report.warnings).toBe(2)
  })
  it('un champ explicite l’emporte sur celui de l’alias', () => {
    expect(check(d, { type: 'h2', level: 4, text: 'a' }, 'b', ctxFor())).toEqual({ type: 'h', level: 4, text: 'a' })
  })
  it('récupère un type inconnu qui porte du texte', () => {
    const ctx = ctxFor()
    expect(check(d, { type: 'callout', text: 'garde-moi' }, 'b', ctx)).toEqual({ type: 'p', text: 'garde-moi' })
    expect(ctx.report.issues[0].code).toBe('block-converted')
  })
  it('ignore un type inconnu sans texte', () => {
    const ctx = ctxFor()
    expect(check(d, { type: 'callout' }, 'b', ctx)).toBe(DROP)
    expect(check(d, { type: 'constructor' }, 'b', ctx)).toBe(DROP)
    expect(check(d, { type: 7 }, 'b', ctx)).toBe(DROP)
    expect(ctx.report.issues.map((i) => i.code)).toEqual(['unknown-block-type', 'unknown-block-type', 'unknown-block-type'])
  })
})
