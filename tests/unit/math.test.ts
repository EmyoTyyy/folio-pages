// Phase 6 : le moteur d'équations (repris de Bento) et ce que Folio Pages y ajoute.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findTex, labelOf, parseTex, renderTex, resolveRefs } from '../../src/math'
import { parseLatex } from '../../src/math/latex'
import { toMathML } from '../../src/math/mathml'
import { loadDocument } from '../../src/format/load'
import { toCompact } from '../../src/format/compact'

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/math/${name}`, import.meta.url), 'utf8'))

describe('moteur LaTeX → MathML', () => {
  it('rend toutes les formules couramment écrites (liste de Bento), sans exception', () => {
    const common = fixture('maths-common.json').mustRender as { src: string; display?: boolean }[]
    expect(common.length).toBeGreaterThan(300)
    const failed = common.filter((f) => {
      const r = renderTex(f.src, !!f.display)
      return !r.html || r.error
    })
    expect(failed.map((f) => f.src)).toEqual([])
  })

  it('rend les formules réelles de référence (présentations, page de Temml)', () => {
    const ref = fixture('maths-reference.json').formulas as { src: string; display: boolean; tree: string | null }[]
    const ok = ref.filter((f) => f.tree !== null && !f.src.includes('…'))
    for (const f of ok) expect(renderTex(f.src, f.display).html, f.src).toBeTruthy()
  })

  it('ne lève jamais d’exception, même sur une entrée hostile ou aléatoire', () => {
    const pieces = ['\\frac', '{', '}', '^', '_', '\\left(', '\\right)', '\\begin{matrix}', '\\end{matrix}', '&', '\\\\', 'x', '\\sqrt[', ']', '\\ce{', '->', '\\newcommand{\\a}[1]{#1#1}', '\\a', '$', '%', '#1', '\\def\\b{\\b}', '\\b']
    let seed = 7
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    for (let i = 0; i < 1500; i++) {
      let s = ''
      for (let k = 0; k < 1 + Math.floor(rand() * 14); k++) s += pieces[Math.floor(rand() * pieces.length)]
      expect(() => renderTex(s, rand() < 0.5)).not.toThrow()
    }
    // Récursion infinie de macros, imbrication profonde, formule énorme : bornées.
    expect(renderTex('\\def\\x{\\x}\\x', false).html).toBeNull()
    expect(() => renderTex('{'.repeat(5000) + 'x' + '}'.repeat(5000), false)).not.toThrow()
    expect(renderTex('x'.repeat(30_000), false).error).not.toBeNull()
  })

  it('le MathML produit n’a ni lien, ni script, ni style venu de la formule', () => {
    const hostile = [
      '\\href{javascript:alert(1)}{x}',
      '\\url{javascript:alert(1)}',
      '\\color{red;background:url(https://evil.example/x)}{x}',
      '\\textcolor{red" onmouseover="alert(1)}{x}',
      '\\text{<script>alert(1)</script>}',
      '\\colorbox{url(x)}{y}',
      '\\style{color:red}{x}',
      '\\class{evil}{x}',
      '\\htmlId{a}{x}',
    ]
    for (const src of hostile) {
      const html = renderTex(src, false).html ?? ''
      expect(html, src).not.toMatch(/<script|javascript:|on\w+=|href=|url\(|class="evil"|id="a"/i)
    }
    // Couleurs acceptées : nom, #hexa ; le reste est ignoré.
    expect(renderTex('\\textcolor{teal}{x}', false).html).toContain('color:teal')
    expect(renderTex('\\textcolor{#1e6b55}{x}', false).html).toContain('color:#1e6b55')
  })

  it('une commande inconnue est dessinée sous son nom, et signalée', () => {
    const r = renderTex('\\foo{x} + 1', false)
    expect(r.html).toContain('\\foo')
    expect(r.error).toEqual({ kind: 'unknown', command: '\\foo' })
    const bad = renderTex('\\frac{a}', false)
    expect(bad.html).toBeNull()
    expect(bad.error?.kind).toBe('syntax')
    expect(renderTex('  ', true).error).toEqual({ kind: 'empty' })
  })

  it('les macros du document sont lues avant chaque formule', () => {
    const macros = '\\newcommand{\\vv}[1]{\\mathbf{#1}}\\DeclareMathOperator{\\grad}{grad}'
    const r = renderTex('\\vv{u} = \\grad f', false, { macros })
    expect(r.error).toBeNull()
    expect(r.html).toContain('𝐮')
    expect(r.html).toContain('grad')
    // Sans elles : inconnues.
    expect(renderTex('\\vv{u}', false).error).toEqual({ kind: 'unknown', command: '\\vv' })
  })

  it('\\label, \\eqref et \\ref : le numéro de l’équation', () => {
    expect(labelOf('a = b \\label{ eq:un }')).toBe('eq:un')
    expect(labelOf('a = b')).toBeNull()
    const labels = new Map([['eq:un', 3]])
    expect(resolveRefs('\\eqref{eq:un} et \\ref{eq:un} et \\eqref{x}', labels)).toBe('\\text{(3)} et \\text{3} et \\text{(??)}')
    expect(renderTex('\\eqref{eq:un}', false, { labels }).html).toContain('(3)')
  })

  it('met les formules en cache, sans grossir indéfiniment', () => {
    const a = renderTex('a^2 + b^2', false)
    expect(renderTex('a^2 + b^2', false)).toBe(a)
    expect(renderTex('a^2 + b^2', true)).not.toBe(a)
    for (let i = 0; i < 1000; i++) renderTex(`x_{${i}}`, false)
    // Toujours juste après éviction.
    expect(renderTex('a^2 + b^2', false).html).toBe(a.html)
  })

  it('l’arbre (pour l’export .docx) est le même que celui du rendu', () => {
    expect(toMathML(parseTex('\\frac{1}{2}', true), true)).toBe(toMathML(parseLatex('\\frac{1}{2}', true), true))
    expect(() => parseTex('\\frac{a}', false, {}, false)).toThrow()
  })
})

describe('repérer les formules dans un texte', () => {
  const spans = (s: string) => findTex(s).map((x) => [x.tex, x.display])
  it('$…$, $$…$$, \\(…\\), \\[…\\]', () => {
    expect(spans('soit $x^2$ et $$\\int f$$, \\(a\\) puis \\[b\\]')).toEqual([
      ['x^2', false],
      ['\\int f', true],
      ['a', false],
      ['b', true],
    ])
  })
  it('les prix restent du texte (règle de Bento)', () => {
    expect(spans('Coûte 5 $ et 10 $.')).toEqual([])
    expect(spans('Entre $5 et $10.')).toEqual([])
    expect(spans('de $5$10')).toEqual([])
    expect(spans('$ x $ espacé')).toEqual([])
    expect(spans('\\$x\\$ échappé')).toEqual([])
    expect(spans('$x$, puis $y$.')).toEqual([
      ['x', false],
      ['y', false],
    ])
  })
})

describe('format : formules et équations', () => {
  const load = (raw: Record<string, unknown>) => {
    const r = loadDocument({ format: 'folio/doc', version: 1, ...raw })
    if (!r.ok) throw new Error('refusé')
    return r
  }
  it('lit une formule en ligne, une équation, et leurs alias', () => {
    const r = load({
      blocks: [
        { content: ['a ', { type: 'math', tex: ' x^2 ' }, { type: 'formula', tex: 'y' }, { tex: 'z' }] },
        { type: 'equation', tex: 'E = mc^2', numbered: true },
        { type: 'latex', tex: '\\int f' },
        { type: 'displaymath', tex: 'a' },
        { type: 'math', tex: 'b' },
      ],
      math: { macros: '\\newcommand{\\R}{\\mathbb{R}}' },
    })
    expect(r.doc.blocks).toEqual([
      { type: 'paragraph', content: [{ text: 'a ' }, { type: 'math', tex: 'x^2' }, { type: 'math', tex: 'y' }, { type: 'math', tex: 'z' }] },
      { type: 'equation', tex: 'E = mc^2', numbered: true },
      { type: 'equation', tex: '\\int f' },
      { type: 'equation', tex: 'a' },
      { type: 'equation', tex: 'b' },
    ])
    expect(r.doc.math).toEqual({ macros: '\\newcommand{\\R}{\\mathbb{R}}' })
  })
  it('une formule vide est ignorée, et dite ; une formule trop longue est bornée', () => {
    const r = load({ blocks: [{ type: 'equation', tex: '  ' }, { content: [{ type: 'math', tex: '' }] }, { type: 'equation', tex: 'x'.repeat(30_000) }] })
    expect(r.report.issues.filter((i) => i.code === 'math-empty')).toHaveLength(2)
    const eq = r.doc.blocks.find((b) => b.type === 'equation')
    expect(eq && eq.type === 'equation' ? eq.tex.length : 0).toBeLessThanOrEqual(20_000)
  })
  it('une formule ne garde que ses commentaires (sa mise en forme est dans le LaTeX)', () => {
    const r = load({ comments: [{ id: 'c1', text: 'ok' }], blocks: [{ content: [{ type: 'math', tex: 'x', bold: true, color: 'red', comments: ['c1'] }] }] })
    expect(r.doc.blocks[0]).toEqual({ type: 'paragraph', content: [{ type: 'math', tex: 'x', comments: ['c1'] }] })
  })
  it('dans md : $…$ en ligne, $$…$$ seul en équation centrée', () => {
    const r = load({ blocks: [{ md: 'Soit $f(x)$.' }, { md: '$$f(x) = x^2 \\label{f}$$' }], markdown: undefined })
    expect(r.doc.blocks).toEqual([
      { type: 'paragraph', content: [{ text: 'Soit ' }, { type: 'math', tex: 'f(x)' }, { text: '.' }] },
      { type: 'equation', tex: 'f(x) = x^2 \\label{f}', numbered: true },
    ])
  })
  it('la forme compacte garde les équations et les macros, et rien de plus', () => {
    const r = load({ blocks: [{ type: 'equation', tex: 'a' }, { type: 'equation', tex: 'b', numbered: true }], math: { macros: '\\def\\x{y}' } })
    const c = toCompact(r.doc) as { blocks: unknown[]; math?: unknown }
    expect(c.blocks).toEqual([
      { type: 'equation', tex: 'a' },
      { type: 'equation', tex: 'b', numbered: true },
    ])
    expect(c.math).toEqual({ macros: '\\def\\x{y}' })
    const none = toCompact(load({ blocks: ['x'] }).doc) as Record<string, unknown>
    expect(none.math).toBeUndefined()
  })
})
