// Pages côte à côte : quelles pages vont ensemble, et à quelle échelle.

import { describe, expect, it } from 'vitest'
import { spreadOf, spreadScale } from '../../src/ui/spread'

describe('spreadOf', () => {
  it('groupe les pages deux par deux, la dernière seule si le compte est impair', () => {
    expect(spreadOf(0, 2, 5)).toEqual([0, 1])
    expect(spreadOf(1, 2, 5)).toEqual([0, 1])
    expect(spreadOf(3, 2, 5)).toEqual([2, 3])
    expect(spreadOf(4, 2, 5)).toEqual([4])
  })
  it('une page par écran sur un écran étroit', () => {
    expect(spreadOf(3, 1, 5)).toEqual([3])
  })
  it('borne une page hors du document', () => {
    expect(spreadOf(9, 2, 5)).toEqual([4])
    expect(spreadOf(-3, 2, 5)).toEqual([0, 1])
    expect(spreadOf(0, 2, 1)).toEqual([0])
  })
})

describe('spreadScale', () => {
  const a4 = { width: 794, height: 1123 }
  it('la hauteur limite sur un écran large', () => {
    const s = spreadScale([a4, a4], 2000, 800)
    expect(s).toBeCloseTo(800 / 1123, 5)
  })
  it('la largeur limite sur un écran étroit (deux pages et l’écart)', () => {
    const s = spreadScale([a4, a4], 1000, 2000)
    expect(s * (794 * 2 + 24)).toBeLessThanOrEqual(1000.001)
    expect(s * (794 * 2 + 24)).toBeGreaterThan(990)
  })
  it('pages de formats différents : la plus haute tient', () => {
    const landscape = { width: 1123, height: 794 }
    const s = spreadScale([a4, landscape], 4000, 900)
    expect(s * 1123).toBeLessThanOrEqual(900.001)
  })
  it('jamais nulle ni immense', () => {
    expect(spreadScale([a4], 10, 10)).toBeGreaterThanOrEqual(0.1)
    expect(spreadScale([a4], 100000, 100000)).toBeLessThanOrEqual(2)
    expect(spreadScale([], 500, 500)).toBe(1)
  })
})
