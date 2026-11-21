// Comparer deux versions d'un document : différences en modifications suivies.

import { describe, expect, it } from 'vitest'
import { compareDocuments, diffSeq } from '../../src/format/compare'
import { loadDocument } from '../../src/format/load'
import type { Block, FolioDoc, Inline, Run } from '../../src/format/types'

const NOW = '2026-11-20T10:00:00.000Z'
const CH = { author: 'Comparaison', date: NOW }
const load = (blocks: unknown[], extra: Record<string, unknown> = {}): FolioDoc => {
  const r = loadDocument({ format: 'folio/doc', version: 1, blocks, ...extra }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  return r.doc
}
/** Le résultat, relu comme un document reçu (il doit être valide). */
const cmp = (a: unknown[], b: unknown[]) => {
  const { doc, stats } = compareDocuments(load(a), load(b), CH)
  const r = loadDocument(doc, { now: NOW })
  if (!r.ok) throw new Error('résultat refusé')
  expect(r.report.issues.filter((i) => i.kind === 'ignored')).toEqual([])
  return { doc: r.doc, stats }
}
/** Texte avec [+ajouts+], [-suppressions-] et {mise en forme}. */
const shown = (items: Inline[]) => items.map((r) => (isText(r) ? (r.inserted ? `[+${r.text}+]` : r.deleted ? `[-${r.text}-]` : r.formatChange ? `{${r.text}}` : r.text) : '?')).join('')
const isText = (r: Inline): r is Run => 'text' in r
const texts = (d: FolioDoc) => d.blocks.map((b) => ('content' in b ? shown(b.content as Inline[]) : b.type))

describe('diff de suites (Myers)', () => {
  it('reconstruit les deux suites, pour des suites au hasard', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 5)
    for (let k = 0; k < 300; k++) {
      const a = Array.from({ length: rnd() * 3 }, rnd)
      const b = Array.from({ length: rnd() * 3 }, rnd)
      const ops = diffSeq(a, b, (x, y) => x === y)
      expect(ops.flatMap((o) => (o.op === 'ins' ? [] : [o.a]))).toEqual(a)
      expect(ops.flatMap((o) => (o.op === 'del' ? [] : [o.b]))).toEqual(b)
    }
  })
  it('garde le plus de choses communes', () => {
    const ops = diffSeq('ABCABBA'.split(''), 'CBABAC'.split(''), (x, y) => x === y)
    expect(ops.filter((o) => o.op === 'eq')).toHaveLength(4)
  })
})

describe('comparer deux documents', () => {
  it('identiques : aucune marque', () => {
    const { doc, stats } = cmp(['Un.', 'Deux.'], ['Un.', 'Deux.'])
    expect(stats).toEqual({ insertions: 0, deletions: 0, formatting: 0, objects: 0 })
    expect(doc.trackChanges).toBe(true)
    expect(texts(doc)).toEqual(['Un.', 'Deux.'])
  })

  it('un mot changé, un mot ajouté : suppression et ajout au mot près', () => {
    const { doc, stats } = cmp(['Le chat dort sur le tapis.'], ['Le chien dort sur le grand tapis.'])
    expect(texts(doc)).toEqual(['Le [-chat-][+chien+] dort sur le[+ grand+] tapis.'])
    expect(stats).toMatchObject({ insertions: 2, deletions: 1 })
    const ins = (doc.blocks[0] as { content: Run[] }).content.find((r) => r.inserted)!
    expect(ins.inserted).toEqual(CH)
  })

  it('mise en forme : gras ajouté, titre devenu paragraphe', () => {
    const { doc, stats } = cmp([{ type: 'heading', level: 2, text: 'Plan' }, 'Un mot important.'], ['Plan', { content: ['Un mot ', { text: 'important', bold: true }, '.'] }])
    expect(texts(doc)).toEqual(['Plan', 'Un mot {important}.'])
    expect(doc.blocks[0]).toMatchObject({ type: 'paragraph', formatChange: { author: 'Comparaison', before: { kind: 'heading', level: 2 } } })
    const run = (doc.blocks[1] as { content: Run[] }).content.find((r) => r.formatChange)!
    expect(run).toMatchObject({ bold: true, formatChange: { before: {} } })
    expect(stats.formatting).toBe(2)
  })

  it('paragraphes ajoutés et retirés : leur texte marqué, les autres appariés', () => {
    const { doc } = cmp(['Introduction.', 'Ancien paragraphe qui disparaît.', 'Conclusion du rapport.'], ['Introduction.', 'Conclusion du rapport, revue.', 'Annexe ajoutée.'])
    expect(texts(doc)).toEqual(['Introduction.', '[-Ancien paragraphe qui disparaît.-]', 'Conclusion du rapport[+, revue+].', '[+Annexe ajoutée.+]'])
  })

  it('listes : élément ajouté ; tableau de même forme : cellule comparée ; image changée : comptée', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const { doc, stats } = cmp(
      [{ type: 'list', items: ['Pain', 'Lait'] }, { type: 'table', rows: [['Mois', 'Ventes'], ['Mars', '12']] }, { type: 'image', src: PNG, alt: 'a', caption: 'Figure' }],
      [{ type: 'list', items: ['Pain', 'Lait', 'Œufs'] }, { type: 'table', rows: [['Mois', 'Ventes'], ['Mars', '15']] }, { type: 'image', src: PNG2, alt: 'a', caption: 'Figure' }],
    )
    const list = doc.blocks[0] as Extract<Block, { type: 'list' }>
    expect(list.items.map((it) => shown(it.content))).toEqual(['Pain', 'Lait', '[+Œufs+]'])
    const table = doc.blocks[1] as Extract<Block, { type: 'table' }>
    expect(shown((table.rows[1][1].blocks[0] as { content: Inline[] }).content)).toBe('[-12-][+15+]')
    expect((doc.blocks[2] as { src: string }).src).toMatch(/^asset:/)
    expect(stats.objects).toBe(1)
  })

  it('les modifications en attente des deux versions sont d’abord acceptées', () => {
    const a = [{ content: ['Texte ', { text: 'retiré ', deleted: CH }, { text: 'ajouté', inserted: CH }] }]
    const { doc } = cmp(a, ['Texte ajouté'])
    expect(texts(doc)).toEqual(['Texte ajouté'])
  })

  it('le document rendu est la nouvelle version : titre, commentaires, ressources', () => {
    const r = compareDocuments(load(['Avant.'], { meta: { title: 'v1' } }), load([{ content: [{ text: 'Après.', comments: ['c1'] }] }], { meta: { title: 'v2' }, comments: [{ id: 'c1', author: 'A', date: NOW, text: 'ok', resolved: false, replies: [] }] }), CH)
    expect(r.doc.meta.title).toBe('v2')
    expect(r.doc.comments?.[0].id).toBe('c1')
    const back = loadDocument(r.doc, { now: NOW })
    expect(back.ok).toBe(true)
  })
})
