// Dessin : encre en forme (reconnaissance), gomme partielle, lasso, crayon.

import { describe, expect, it } from 'vitest'
import { erasePoints, insidePolygon, lassoed, recognizeShape } from '../../src/format/ink'
import { loadDocument } from '../../src/format/load'

/** Bruit déterministe (main qui tremble), de ±a. */
function jitter(a: number) {
  let s = 7
  return () => {
    s = (s * 16807) % 2147483647
    return ((s / 2147483647) * 2 - 1) * a
  }
}

/** Un tracé à main levée qui suit des sommets (fermé si `close`). */
function hand(vertices: [number, number][], close = false, noise = 1.2, step = 3): number[] {
  const j = jitter(noise)
  const vs = close ? [...vertices, vertices[0]] : vertices
  const out: number[] = []
  for (let i = 1; i < vs.length; i++) {
    const [ax, ay] = vs[i - 1]
    const [bx, by] = vs[i]
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push(ax + ((bx - ax) * k) / n + j(), ay + ((by - ay) * k) / n + j())
  }
  return out
}

function ellipse(cx: number, cy: number, rx: number, ry: number, noise = 1.2): number[] {
  const j = jitter(noise)
  const out: number[] = []
  for (let a = 0; a <= 64; a++) out.push(cx + Math.cos((a / 64) * Math.PI * 2) * rx + j(), cy + Math.sin((a / 64) * Math.PI * 2) * ry + j())
  return out
}

describe('encre en forme', () => {
  it('un trait droit devient un trait (horizontal, en biais, à l’envers)', () => {
    const h = recognizeShape(hand([[10, 50], [200, 53]]))!
    expect(h).toMatchObject({ shape: 'line', height: 0 })
    expect(h.width).toBeGreaterThan(185)
    const d = recognizeShape(hand([[200, 20], [40, 160]]))!
    expect(d).toMatchObject({ shape: 'line', flip: 'h' })
    expect(d.height).toBeGreaterThan(130)
    expect(recognizeShape(hand([[50, 10], [52, 150]]))).toMatchObject({ shape: 'line', width: 0 })
  })

  it('une flèche d’un seul geste : le trait et sa pointe', () => {
    const a = recognizeShape(hand([[10, 100], [200, 100], [185, 88], [200, 100], [185, 112]], false, 0.8))!
    expect(a).toMatchObject({ shape: 'line', tail: true, height: 0 })
    expect(a.width).toBeGreaterThan(180)
  })

  it('rectangle, carré, ellipse, cercle', () => {
    expect(recognizeShape(hand([[10, 10], [210, 10], [210, 110], [10, 110]], true))).toMatchObject({ shape: 'rect' })
    const sq = recognizeShape(hand([[10, 10], [110, 10], [110, 104], [10, 104]], true))!
    expect(sq.shape).toBe('rect')
    expect(sq.width).toBe(sq.height)
    const el = recognizeShape(ellipse(120, 80, 100, 50))!
    expect(el.shape).toBe('ellipse')
    expect(el.width).toBeGreaterThan(190)
    expect(el.height).toBeLessThan(110)
    const c = recognizeShape(ellipse(100, 100, 60, 56))!
    expect(c.shape).toBe('ellipse')
    expect(c.width).toBe(c.height)
  })

  it('triangles (pointe en haut, en bas, rectangle) et losange', () => {
    expect(recognizeShape(hand([[110, 10], [210, 150], [10, 150]], true))).toMatchObject({ shape: 'triangle' })
    expect(recognizeShape(hand([[10, 10], [210, 10], [110, 150]], true))).toMatchObject({ shape: 'triangle', flip: 'v' })
    const rt = recognizeShape(hand([[10, 10], [10, 150], [200, 150]], true))!
    expect(rt.shape).toBe('rtTriangle')
    expect(rt.flip).toBeUndefined()
    expect(recognizeShape(hand([[200, 10], [200, 150], [10, 150]], true))).toMatchObject({ shape: 'rtTriangle', flip: 'h' })
    expect(recognizeShape(hand([[110, 10], [210, 90], [110, 170], [10, 90]], true))).toMatchObject({ shape: 'diamond' })
  })

  it('un gribouillis, une écriture ou un trop petit trait restent des traits', () => {
    const j = jitter(40)
    const scribble: number[] = []
    for (let i = 0; i < 60; i++) scribble.push(100 + j(), 100 + j())
    expect(recognizeShape(scribble)).toBeNull()
    expect(recognizeShape(hand([[10, 10], [40, 60], [70, 10], [100, 60], [130, 10]], false, 0.5))).toBeNull()
    expect(recognizeShape([0, 0, 3, 2, 5, 4])).toBeNull()
    expect(recognizeShape([5, 5])).toBeNull()
  })
})

describe('gomme partielle', () => {
  const stroke = { tool: 'pen' as const, color: '#1f2937', width: 2, points: [0, 0, 100, 0] }
  it('coupe un trait en deux là où elle passe', () => {
    const out = erasePoints(stroke, 50, 0, 5)!
    expect(out).toHaveLength(2)
    expect(Math.max(...out[0].points.filter((_, i) => i % 2 === 0))).toBeLessThan(46)
    expect(Math.min(...out[1].points.filter((_, i) => i % 2 === 0))).toBeGreaterThan(54)
    expect(out.every((s) => s.color === '#1f2937' && s.tool === 'pen')).toBe(true)
  })
  it('n’est pas touché : null ; entièrement couvert : plus rien ; un bout : le reste', () => {
    expect(erasePoints(stroke, 50, 20, 5)).toBeNull()
    expect(erasePoints({ ...stroke, points: [0, 0, 4, 0] }, 2, 0, 6)).toEqual([])
    const end = erasePoints(stroke, 100, 0, 10)!
    expect(end).toHaveLength(1)
    expect(Math.max(...end[0].points.filter((_, i) => i % 2 === 0))).toBeLessThan(91)
  })
})

describe('lasso', () => {
  const square = [0, 0, 100, 0, 100, 100, 0, 100]
  it('point dans la boucle ; un trait pris quand la plupart de ses points y sont', () => {
    expect(insidePolygon(square, 50, 50)).toBe(true)
    expect(insidePolygon(square, 150, 50)).toBe(false)
    expect(lassoed(square, [10, 10, 50, 50, 90, 90])).toBe(true)
    expect(lassoed(square, [10, 10, 150, 50, 190, 90])).toBe(false)
    // décalage du paragraphe du trait
    expect(lassoed(square, [10, 10, 20, 20], 200, 0)).toBe(false)
  })
})

describe('crayon', () => {
  it('le format garde le crayon ; un outil inconnu devient le stylo', () => {
    const r = loadDocument({ format: 'folio/doc', version: 1, blocks: [{ type: 'paragraph', text: 'x', ink: [{ tool: 'pencil', color: '#555555', width: 1.5, points: [0, 0, 10, 10] }, { tool: 'brush', points: [0, 0, 5, 5] }] }] })
    if (!r.ok) throw new Error('chargement')
    const ink = (r.doc.blocks[0] as unknown as { ink: { tool: string }[] }).ink
    expect(ink.map((s) => s.tool)).toEqual(['pencil', 'pen'])
  })
})
