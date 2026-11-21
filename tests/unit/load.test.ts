import { describe, expect, it } from 'vitest'
import { loadDocument, type LoadResult } from '../../src/format/load'
import { LIMITS } from '../../src/format/spec'
import type { Block, FolioDoc } from '../../src/format/types'

const NOW = '2026-11-08T12:00:00.000Z'
const load = (v: unknown) => loadDocument(v, { now: NOW })

function ok(r: LoadResult): Extract<LoadResult, { ok: true }> {
  if (!r.ok) throw new Error('chargement refusé : ' + JSON.stringify(r))
  return r
}
const codes = (r: LoadResult) => ok(r).report.issues.map((i) => i.code)

describe('documents valides', () => {
  it('charge l’exemple minimal du guide sans aucun signalement', () => {
    const r = ok(
      load({
        format: 'folio/doc',
        version: 1,
        meta: { title: 'Bonjour' },
        blocks: [{ type: 'heading', text: 'Bonjour' }, { text: 'Un paragraphe.' }],
      }),
    )
    expect(r.report.issues).toEqual([])
    expect(r.doc.meta.title).toBe('Bonjour')
    expect(r.doc.meta.created).toBe(NOW)
    expect(r.doc.id).toMatch(/^[A-Za-z0-9_-]{12}$/)
    expect(r.doc.blocks).toEqual([
      { type: 'heading', level: 1, content: [{ text: 'Bonjour' }] },
      { type: 'paragraph', content: [{ text: 'Un paragraphe.' }] },
    ])
  })

  it('garde l’identité et les dates d’un document existant', () => {
    const r = ok(load({ format: 'folio/doc', version: 1, id: 'doc-123456', meta: { created: '2025-01-02T03:04:05Z', modified: '2025-02-01T00:00:00Z' }, blocks: [] }))
    expect(r.doc.id).toBe('doc-123456')
    expect(r.doc.meta.created).toBe('2025-01-02T03:04:05Z')
    expect(r.doc.meta.modified).toBe('2025-02-01T00:00:00Z')
  })

  it('accepte un texte JSON comme un objet', () => {
    const r = ok(load('﻿  {"format":"folio/doc","version":1,"blocks":["Salut"]}  '))
    expect(r.doc.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'Salut' }] }])
  })

  it('accepte « \\u003c » dans les chaînes (forme écrite dans le fichier)', () => {
    const r = ok(load('{"format":"folio/doc","version":1,"blocks":[{"text":"a \\u003c b"}]}'))
    expect(r.doc.blocks[0]).toEqual({ type: 'paragraph', content: [{ text: 'a < b' }] })
  })
})

describe('validation tolérante', () => {
  it('compte les champs ignorés et les avertissements', () => {
    const r = ok(
      load({
        format: 'folio/doc',
        version: 1,
        couleur: 'rouge',
        blocks: [{ type: 'heading', level: 9, text: 'T', taille: 3 }, 42, null],
      }),
    )
    expect(r.report.ignored).toBe(3) // couleur, taille, null
    expect(r.report.warnings).toBe(2) // niveau ramené à 6, 42 converti en texte
    expect(r.doc.blocks).toEqual([
      { type: 'heading', level: 6, content: [{ text: 'T' }] },
      { type: 'paragraph', content: [{ text: '42' }] },
    ])
  })

  it('donne le chemin d’origine même après un élément ignoré', () => {
    const r = ok(load({ format: 'folio/doc', version: 1, blocks: [null, null, { type: 'list', items: ['a', { text: 'b', level: 4 }] }] }))
    const issue = r.report.issues.find((i) => i.code === 'level-adjusted')!
    expect(issue.path).toBe('blocks[2].items[1].level')
  })

  it('ne perd jamais le texte d’un bloc de type inconnu', () => {
    const r = ok(load({ format: 'folio/doc', version: 1, blocks: [{ type: 'marquee', text: 'Attention !' }, { type: 'checklist', items: ['un', 'deux'] }] }))
    expect(r.doc.blocks.map((b) => b.type)).toEqual(['paragraph', 'list'])
    expect(codes(load({ blocks: [{ type: 'marquee', text: 'x' }] }))).toContain('block-converted')
  })

  it('reconnaît les alias de type courants', () => {
    const r = ok(load({ format: 'folio/doc', version: 1, blocks: [{ type: 'h3', text: 'a' }, { type: 'ol', items: ['x'] }, { type: 'hr' }, { type: 'blockquote', text: 'q' }, { type: 'p', text: 'p' }] }))
    expect(r.doc.blocks.map((b) => b.type)).toEqual(['heading', 'list', 'divider', 'quote', 'paragraph'])
    expect((r.doc.blocks[0] as Extract<Block, { type: 'heading' }>).level).toBe(3)
    expect((r.doc.blocks[1] as Extract<Block, { type: 'list' }>).style).toBe('number')
  })

  it('signale un format absent ou inconnu, sans refuser', () => {
    expect(codes(load({ blocks: [] }))).toEqual(['format-missing'])
    expect(codes(load({ format: 'bento/slides', blocks: [] }))).toEqual(['format-unknown'])
    expect(codes(load({ format: 'folio/doc', version: 7, blocks: [] }))).toEqual(['version-newer'])
  })

  it('refuse les liens dangereux en gardant le texte', () => {
    const r = ok(load({ format: 'folio/doc', version: 1, blocks: [{ content: [{ text: 'clic', link: 'javascript:alert(1)' }, { text: ' ici', link: 'https://ok.fr' }] }] }))
    expect(r.doc.blocks[0]).toEqual({ type: 'paragraph', content: [{ text: 'clic' }, { text: ' ici', link: 'https://ok.fr' }] })
    expect(codes(load({ blocks: [{ content: [{ text: 'x', link: ' JavaScript:alert(1)' }] }] }))).toContain('unsafe-link')
    for (const bad of ['data:text/html,x', 'file:///etc/passwd', 'vbscript:x', '//evil.example', 'java\tscript:x'])
      expect(ok(load({ blocks: [{ content: [{ text: 'x', link: bad }] }] })).doc.blocks[0]).toEqual({ type: 'paragraph', content: [{ text: 'x' }] })
  })

  it('signale plusieurs sources de texte et garde la plus précise', () => {
    const r = ok(load({ format: 'folio/doc', version: 1, blocks: [{ type: 'heading', text: 'brut', md: '**md**' }] }))
    expect(r.doc.blocks[0]).toEqual({ type: 'heading', level: 1, content: [{ text: 'md', bold: true }] })
    expect(codes(load({ format: 'folio/doc', version: 1, blocks: [{ type: 'heading', text: 'brut', md: '**md**' }] }))).toEqual(['several-sources'])
  })

  it('un paragraphe dont le md contient plusieurs blocs donne plusieurs blocs', () => {
    const r = ok(load({ format: 'folio/doc', version: 1, blocks: [{ md: '# Titre\n\nTexte\n\n- a\n- b' }] }))
    expect(r.doc.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list'])
  })

  it('normalise les morceaux : fusion, vides retirés, exposant prioritaire', () => {
    const r = ok(load({ blocks: [{ content: ['a', { text: 'b' }, { text: '' }, { text: 'c', bold: true }, { text: 'd', bold: true, italic: false }, { text: 'x', sup: true, sub: true }] }] }))
    expect(r.doc.blocks[0]).toEqual({
      type: 'paragraph',
      content: [{ text: 'ab' }, { text: 'cd', bold: true }, { text: 'x', sup: true }],
    })
  })

  it('accepte des mots-clés en une chaîne', () => {
    expect(ok(load({ meta: { keywords: 'budget, 2026 ; équipe' } })).doc.meta.keywords).toEqual(['budget', '2026', 'équipe'])
  })

  it('ignore une date ou une langue invalide', () => {
    const r = ok(load({ meta: { created: 'hier', lang: 'français' } }))
    expect(r.doc.meta.created).toBe(NOW)
    expect(r.doc.meta.lang).toBe('')
    expect(r.report.ignored).toBe(2)
  })

  it('remplace un identifiant invalide sans le signaler comme une erreur grave', () => {
    const r = ok(load({ id: 'x', blocks: [] }))
    expect(r.doc.id).not.toBe('x')
  })

  it('aplatit dans une cellule ce qui ne peut pas y aller, sans perdre de texte', () => {
    const r = ok(load({ blocks: [{ type: 'table', rows: [[{ blocks: [{ type: 'quote', text: 'cité' }, { type: 'divider' }, { type: 'table', rows: [['interne']] }] }]] }] }))
    const t = r.doc.blocks[0] as Extract<Block, { type: 'table' }>
    expect(t.rows[0][0].blocks).toEqual([
      { type: 'paragraph', content: [{ text: 'cité' }] },
      { type: 'paragraph', content: [{ text: 'interne' }] },
    ])
  })

  it('ignore une liste sans éléments et un tableau sans lignes', () => {
    const r = ok(load({ blocks: [{ type: 'list', items: [] }, { type: 'table', rows: [[]] }, { type: 'list' }] }))
    expect(r.doc.blocks).toEqual([])
    expect(r.report.ignored).toBe(3)
  })
})

describe('Markdown', () => {
  it('un document peut être donné entièrement en Markdown', () => {
    const r = ok(load({ format: 'folio/doc', version: 1, meta: { title: 'Notes' }, markdown: '# Notes\n\n- un\n- deux' }))
    expect(r.doc.blocks.map((b) => b.type)).toEqual(['heading', 'list'])
    expect(r.report.issues).toEqual([])
  })
  it('les blocs l’emportent sur le Markdown, avec un avertissement', () => {
    const r = ok(load({ blocks: ['a'], markdown: '# b' }))
    expect(r.doc.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'a' }] }])
    expect(r.report.issues.map((i) => i.code)).toContain('markdown-ignored')
  })
  it('accepte un tableau de blocs seul, ou une chaîne Markdown seule', () => {
    expect(ok(load('[{"type":"heading","text":"T"}]')).doc.blocks[0].type).toBe('heading')
    expect(ok(load('"# Titre"')).doc.blocks[0].type).toBe('heading')
  })
})

describe('refus', () => {
  it('JSON illisible : erreur localisée', () => {
    const r = load('{\n  "blocks": [\n    {"text": "a"}\n    {"text": "b"}\n  ]\n}')
    expect(r).toMatchObject({ ok: false, reason: 'json', error: { code: 'expected-comma', line: 4, column: 5 } })
  })
  it('répare les virgules en trop et les commentaires, avec un avertissement', () => {
    const r = ok(load('{\n // un document\n "blocks": ["a", "b",],\n}'))
    expect(r.repaired).toBe(true)
    expect(r.doc.blocks).toHaveLength(2)
    expect(r.report.warnings).toBe(2) // réparé + format absent
  })
  it('reconnaît un document chiffré', () => {
    expect(load({ format: 'folio/enc', v: 1, salt: 'a', iv: 'b', data: 'c' })).toEqual({ ok: false, reason: 'encrypted' })
  })
  it('refuse ce qui n’est pas un document', () => {
    for (const v of ['42', 'null', 'true']) expect(load(v)).toEqual({ ok: false, reason: 'not-a-document' })
  })
  it('refuse un JSON démesuré avant même de le lire', () => {
    const big = ' '.repeat(LIMITS.jsonChars + 1)
    expect(load(big)).toMatchObject({ ok: false, reason: 'too-large' })
  })
})

describe('robustesse', () => {
  it('ne jette jamais d’exception sur des entrées aléatoires', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const atoms: unknown[] = ['', 'x', 0, -1, 1e308, true, null, [], {}, 'heading', 'list', 'table', 'quote', '\u0000', '<\/script>']
    const keys = ['type', 'text', 'md', 'content', 'items', 'rows', 'blocks', 'level', 'style', 'start', 'header', 'colspan', 'rowspan', 'link', 'bold', 'meta', 'title', 'markdown', 'format', 'version', 'id', '__proto__', 'constructor']
    const gen = (d: number): unknown => {
      const k = rnd()
      if (d > 5 || k < 0.35) return atoms[Math.floor(rnd() * atoms.length)]
      if (k < 0.6) return Array.from({ length: Math.floor(rnd() * 5) }, () => gen(d + 1))
      const o: Record<string, unknown> = {}
      for (let i = 0; i < 4; i++) o[keys[Math.floor(rnd() * keys.length)]] = gen(d + 1)
      return o
    }
    for (let i = 0; i < 3000; i++) {
      const v = gen(0)
      expect(() => load(v)).not.toThrow()
      expect(() => load(JSON.stringify(v) ?? 'x')).not.toThrow()
    }
  })

  it('un document chargé est toujours canonique (le recharger ne change rien)', () => {
    const r = ok(load({ blocks: [{ type: 'list', style: 'ordered', items: ['a', { md: '*b*', level: 2 }, { text: 'c', level: 1, style: 'bullet' }] }, { md: 'x  \ny' }] }))
    const again = ok(load(JSON.parse(JSON.stringify(r.doc)) as FolioDoc))
    expect(again.doc).toEqual(r.doc)
    expect(again.report.issues).toEqual([])
  })
})
