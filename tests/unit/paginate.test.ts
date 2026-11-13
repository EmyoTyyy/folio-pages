import { describe, expect, it } from 'vitest'
import { pageLabel, paginate, type Box } from '../../src/layout/paginate'

/** Paragraphe de n lignes de hauteur h, à partir de y. */
function para(y: number, n: number, h = 20, extra: Partial<Box> = {}): Box {
  const lines = Array.from({ length: n }, (_, i) => ({ top: y + i * h, bottom: y + (i + 1) * h }))
  return { top: y, bottom: y + n * h, kind: 'text', lines: () => lines, ...extra }
}

/** Suite de paragraphes empilés (avec un écart). */
function stack(spec: (number | Partial<Box> & { n?: number; h?: number; kind?: Box['kind'] })[], gap = 10): Box[] {
  const out: Box[] = []
  let y = 0
  for (const s of spec) {
    if (typeof s === 'number') {
      out.push(para(y, s))
      y += s * 20 + gap
    } else {
      const n = s.n ?? 1
      const h = s.h ?? 20
      const b: Box = s.kind === 'text' || !s.kind ? para(y, n, h, s) : { top: y, bottom: y + n * h, kind: s.kind, ...s }
      out.push(b)
      y += n * h + gap
    }
  }
  return out
}

describe('coupure en pages', () => {
  it('rien à couper quand tout tient', () => {
    expect(paginate(stack([3, 3, 3]), 1000)).toEqual([])
    expect(paginate([], 100)).toEqual([])
  })

  it('coupe un paragraphe entre deux lignes', () => {
    // page de 100 px : 5 lignes de 20 px
    const breaks = paginate([para(0, 8)], 100)
    expect(breaks).toEqual([{ box: 0, line: 5, top: 100, used: 100 }])
  })

  it('un long paragraphe s’étend sur plusieurs pages', () => {
    const breaks = paginate([para(0, 23)], 100)
    expect(breaks.map((b) => b.line)).toEqual([5, 10, 15, 20])
  })

  it('pas d’orpheline : une seule ligne en bas de page passe à la suivante', () => {
    // 90 px pris, puis un paragraphe de 4 lignes : 1 seule ligne tiendrait
    const boxes = [{ top: 0, bottom: 70, kind: 'atomic' as const }, para(75, 4)]
    const breaks = paginate(boxes, 100)
    expect(breaks).toEqual([{ box: 1, line: 0, top: 75, used: 75 }])
  })

  it('pas de veuve : au moins deux lignes passent en haut de page', () => {
    // 6 lignes, 5 tiennent : on en reporte deux
    const breaks = paginate([para(0, 6)], 100)
    expect(breaks).toEqual([{ box: 0, line: 4, top: 80, used: 80 }])
  })

  it('un paragraphe de deux lignes peut se couper (pas assez de lignes pour la règle)', () => {
    const boxes = [{ top: 0, bottom: 85, kind: 'atomic' as const }, para(85, 2)]
    const breaks = paginate(boxes, 110)
    expect(breaks).toEqual([{ box: 1, line: 1, top: 105, used: 105 }])
  })

  it('lignes solidaires, image, ligne de tableau : passent entières', () => {
    const boxes = stack([3, { n: 4, keepLines: true }])
    expect(paginate(boxes, 100)).toEqual([{ box: 1, line: 0, top: 70, used: 70 }])
    const img = stack([3, { n: 4, kind: 'atomic' }])
    expect(paginate(img, 100)).toEqual([{ box: 1, line: 0, top: 70, used: 70 }])
  })

  it('un titre solidaire suit le paragraphe qui change de page', () => {
    // titre (1 ligne) en bas de page, paragraphe suivant entièrement sur la page d'après
    const boxes = stack([2, { n: 1, keepNext: true }, { n: 3, keepLines: true }])
    const breaks = paginate(boxes, 100)
    expect(breaks[0].box).toBe(1)
  })

  it('les titres solidaires ne vident jamais une page', () => {
    const boxes = stack([{ n: 1, keepNext: true }, { n: 1, keepNext: true }, { n: 6, kind: 'atomic' }])
    const breaks = paginate(boxes, 100)
    expect(breaks[0].box).toBeGreaterThan(0)
  })

  it('saut de page et « saut de page avant »', () => {
    const boxes = stack([1, { n: 0, kind: 'break' }, 1, { n: 1, breakBefore: true }, 1])
    const breaks = paginate(boxes, 1000)
    expect(breaks.map((b) => b.box)).toEqual([2, 3])
  })

  it('« saut de page avant » sur la première boîte d’une page ne crée pas de page vide', () => {
    const boxes = stack([{ n: 1, breakBefore: true }, 1])
    expect(paginate(boxes, 1000)).toEqual([])
  })

  it('une boîte plus haute qu’une page déborde seule sur sa page, sans boucle', () => {
    const boxes = stack([1, { n: 30, kind: 'atomic' }, 1])
    const breaks = paginate(boxes, 100)
    expect(breaks.map((b) => b.box)).toEqual([1, 2])
  })

  it('une ligne plus haute qu’une page ne bloque pas', () => {
    const lines = [
      { top: 0, bottom: 20 },
      { top: 20, bottom: 260 },
      { top: 260, bottom: 280 },
    ]
    const breaks = paginate([{ top: 0, bottom: 280, kind: 'text', lines: () => lines }], 100)
    expect(breaks.length).toBeGreaterThan(0)
    expect(breaks.length).toBeLessThan(5)
  })

  it('reste rapide et cohérent sur 5 000 paragraphes', () => {
    const boxes: Box[] = []
    let y = 0
    for (let i = 0; i < 5000; i++) {
      const n = 1 + (i % 7)
      boxes.push(para(y, n, 18, { keepNext: i % 11 === 0 }))
      y += n * 18 + 8
    }
    const t0 = performance.now()
    const breaks = paginate(boxes, 900)
    expect(performance.now() - t0).toBeLessThan(200)
    // chaque page tient dans la hauteur, et les pages se suivent
    let prev = 0
    for (const b of breaks) {
      expect(b.top).toBeGreaterThan(prev)
      // la hauteur utilisée compte l'écart (la marge) après la dernière ligne de la page
      expect(b.used).toBeLessThanOrEqual(900 + 8 + 0.5)
      prev = b.top
    }
  })
})

describe('numéros de page', () => {
  it('décimal, romain, alphabétique', () => {
    expect([1, 4, 9, 14, 2026].map((n) => pageLabel(n, 'roman'))).toEqual(['i', 'iv', 'ix', 'xiv', 'mmxxvi'])
    expect(pageLabel(12, 'ROMAN')).toBe('XII')
    expect([1, 26, 27, 52, 53].map((n) => pageLabel(n, 'alpha'))).toEqual(['a', 'z', 'aa', 'az', 'ba'])
    expect(pageLabel(3, 'ALPHA')).toBe('C')
    expect(pageLabel(7, 'decimal')).toBe('7')
  })
})
