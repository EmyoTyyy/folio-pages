// @vitest-environment jsdom
// Phase 6 : les équations dans l'éditeur (commandes, frappe, numérotation, collage).

import { describe, expect, it } from 'vitest'
import { DOMParser as PMDOMParser, type Node as PMNode } from 'prosemirror-model'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history, undo } from 'prosemirror-history'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { convertTexText, hasTexText, insertEquation, insertMath, mathInfo, mathPlugin, renderMathIn, selectedMath, setMath } from '../../src/editor/math'
import { inOpenMath, markdownInputRules } from '../../src/editor/inputrules'
import { schema } from '../../src/editor/schema'
import { loadDocument } from '../../src/format/load'
import type { Block } from '../../src/format/types'

const NOW = '2026-11-12T10:00:00.000Z'
const docOf = (blocks: unknown[], extra: Record<string, unknown> = {}): PMNode => {
  const r = loadDocument({ format: 'folio/doc', version: 1, blocks, ...extra }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  return docToPM(r.doc)
}
const blocks = (doc: PMNode): Block[] => pmToDoc(doc, { id: 'xxxxxx', created: NOW, modified: NOW }).blocks
const stateOf = (doc: PMNode, from = 1, to = from) => EditorState.create({ doc, plugins: [history()], selection: TextSelection.create(doc, from, to) })
const run = (s: EditorState, cmd: (s: EditorState, d?: (tr: import('prosemirror-state').Transaction) => void) => boolean): EditorState => {
  let out = s
  expect(cmd(s, (tr) => (out = s.apply(tr)))).toBe(true)
  return out
}

describe('commandes', () => {
  it('insère une formule en ligne, sélectionnée ; annulable', () => {
    let s = stateOf(docOf(['ab']), 2)
    s = run(s, insertMath('x^2'))
    expect(blocks(s.doc)).toEqual([{ type: 'paragraph', content: [{ text: 'a' }, { type: 'math', tex: 'x^2' }, { text: 'b' }] }])
    expect(selectedMath(s)?.node.attrs.tex).toBe('x^2')
    s = run(s, undo)
    expect(blocks(s.doc)).toEqual([{ type: 'paragraph', content: [{ text: 'ab' }] }])
    // Pas dans du code.
    expect(insertMath('x')(stateOf(docOf([{ type: 'code', text: 'x' }]), 1))).toBe(false)
  })

  it('insère une équation centrée après le paragraphe, ou à la place d’un paragraphe vide', () => {
    let s = stateOf(docOf(['Texte']), 3)
    s = run(s, insertEquation('E = mc^2', true))
    expect(blocks(s.doc)).toEqual([
      { type: 'paragraph', content: [{ text: 'Texte' }] },
      { type: 'equation', tex: 'E = mc^2', numbered: true },
      { type: 'paragraph', content: [] },
    ])
    let e = stateOf(docOf(['', 'suite']), 1)
    e = run(e, insertEquation('a'))
    expect(blocks(e.doc)).toEqual([
      { type: 'equation', tex: 'a' },
      { type: 'paragraph', content: [{ text: 'suite' }] },
    ])
    // Dans une cellule de tableau aussi.
    let t = stateOf(docOf([{ type: 'table', rows: [['x']] }]), 4)
    t = run(t, insertEquation('y'))
    const tb = blocks(t.doc)[0]
    expect(tb.type === 'table' && tb.rows[0][0].blocks.map((b) => b.type)).toEqual(['paragraph', 'equation', 'paragraph'])
  })

  it('modifie, change de disposition (en ligne ↔ centrée) et supprime une formule', () => {
    const d = docOf([{ content: ['avant ', { type: 'math', tex: 'x' }, ' après'] }])
    let s = stateOf(d, 1)
    s = run(s, setMath(7, { tex: 'y' }))
    expect(blocks(s.doc)[0]).toEqual({ type: 'paragraph', content: [{ text: 'avant ' }, { type: 'math', tex: 'y' }, { text: ' après' }] })
    // En ligne → centrée : le paragraphe est coupé autour.
    const c = run(s, setMath(7, { tex: 'y', display: true, numbered: true }))
    expect(blocks(c.doc)).toEqual([
      { type: 'paragraph', content: [{ text: 'avant ' }] },
      { type: 'equation', tex: 'y', numbered: true },
      { type: 'paragraph', content: [{ text: ' après' }] },
    ])
    // Centrée → en ligne : un paragraphe qui la contient.
    const back = run(c, setMath(8, { tex: 'z', display: false }))
    expect(blocks(back.doc)[1]).toEqual({ type: 'paragraph', content: [{ type: 'math', tex: 'z' }] })
    // Vide : supprimée.
    const gone = run(s, setMath(7, { tex: '  ' }))
    expect(blocks(gone.doc)[0]).toEqual({ type: 'paragraph', content: [{ text: 'avant  après' }] })
    expect(setMath(1, { tex: 'x' })(s)).toBe(false)
  })

  it('convertit les $…$ et $$…$$ du texte en formules (sélection, ou tout le document)', () => {
    const d = docOf(['Soit $a^2$ et \\(b\\), mais 5 $ et 10 $.', '$$\\int f \\label{i}$$', { type: 'code', text: '$x$' }, { content: [{ text: '$c$', code: true }] }])
    const s = stateOf(d, 1)
    expect(hasTexText(stateOf(d, 1, 20))).toBe(true)
    let count = 0
    const all = run(s, convertTexText(true, (n) => (count = n)))
    expect(count).toBe(3)
    expect(blocks(all.doc)).toEqual([
      { type: 'paragraph', content: [{ text: 'Soit ' }, { type: 'math', tex: 'a^2' }, { text: ' et ' }, { type: 'math', tex: 'b' }, { text: ', mais 5 $ et 10 $.' }] },
      { type: 'equation', tex: '\\int f \\label{i}', numbered: true },
      { type: 'code', language: '', text: '$x$' },
      { type: 'paragraph', content: [{ text: '$c$', code: true }] },
    ])
    expect(convertTexText(true)(stateOf(docOf(['rien']), 1))).toBe(false)
  })
})

describe('numérotation et contexte', () => {
  it('numérote les équations numérotées dans l’ordre du texte, à toute profondeur', () => {
    const d = docOf(
      [
        { type: 'equation', tex: 'a \\label{a}', numbered: true },
        { type: 'equation', tex: 'b' },
        { type: 'quote', blocks: [{ type: 'equation', tex: 'c \\label{c}', numbered: true }] },
        { type: 'table', rows: [[{ blocks: [{ type: 'equation', tex: 'd', numbered: true }] }]] },
      ],
      { math: { macros: '\\def\\x{y}' } },
    )
    const info = mathInfo(d)
    expect([...info.numbers.values()]).toEqual([1, 2, 3])
    expect([...(info.ctx.labels ?? new Map())]).toEqual([
      ['a', 1],
      ['c', 2],
    ])
    expect(info.ctx.macros).toBe('\\def\\x{y}')
  })

  it('les vues dessinent le MathML, le numéro, et la source d’une formule illisible', () => {
    const d = docOf([{ type: 'equation', tex: '\\frac{1}{2} \\label{h}', numbered: true }, { content: ['voir ', { type: 'math', tex: '\\eqref{h}' }, ' et ', { type: 'math', tex: '\\frac{a}' }] }])
    const host = document.createElement('div')
    const view = new EditorView(host, { state: EditorState.create({ doc: d, plugins: [mathPlugin({ edit: () => {}, problem: (p) => `problème ${p.kind}` })] }) })
    const eq = host.querySelector('.fp-equation')!
    expect(eq.querySelector('math')).not.toBeNull()
    expect(eq.querySelector('.fp-equation__num')!.textContent).toBe('(1)')
    const inl = host.querySelectorAll('.fp-math')
    expect(inl[0].textContent).toContain('(1)')
    expect(inl[1].classList.contains('is-error')).toBe(true)
    expect(inl[1].textContent).toBe('$\\frac{a}$')
    expect((inl[1] as HTMLElement).title).toBe('problème syntax')
    view.destroy()
  })

  it('Entrée ou double-clic sur une formule l’ouvre à la modification', () => {
    const d = docOf([{ content: ['a', { type: 'math', tex: 'x' }] }])
    const opened: number[] = []
    const host = document.createElement('div')
    const view = new EditorView(host, { state: EditorState.create({ doc: d, plugins: [mathPlugin({ edit: (_v, pos) => opened.push(pos), problem: () => '' })] }) })
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 2)))
    const ev = new KeyboardEvent('keydown', { key: 'Enter' })
    view.someProp('handleKeyDown', (f) => f(view, ev))
    expect(opened).toEqual([2])
    view.destroy()
  })

  it('en-têtes, pieds de page et notes : les formules sont dessinées aussi', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p><span class="fp-math" data-math="x^2">$x^2$</span></p><div class="fp-equation" data-equation="\\int f">$$\\int f$$</div>'
    renderMathIn(root, {})
    expect(root.querySelectorAll('math')).toHaveLength(2)
    expect(root.textContent).not.toContain('$')
  })
})

describe('frappe', () => {
  const type = (text: string, before = '') => {
    const host = document.createElement('div')
    const d = docOf([before])
    const view = new EditorView(host, { state: EditorState.create({ doc: d, plugins: [markdownInputRules()], selection: TextSelection.atEnd(d) }) })
    for (const ch of text) {
      const { from, to } = view.state.selection
      const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
      if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
    }
    const out = blocks(view.state.doc)
    view.destroy()
    return out
  }
  it('$x^2$ tapé devient une formule ; un prix reste du texte', () => {
    expect(type('soit $x_1 + y_2$ ici')).toEqual([{ type: 'paragraph', content: [{ text: 'soit ' }, { type: 'math', tex: 'x_1 + y_2' }, { text: ' ici' }] }])
    expect(type('5 $ et 10 $ ')).toEqual([{ type: 'paragraph', content: [{ text: '5 $ et 10 $ ' }] }])
    expect(type('$ x $')).toEqual([{ type: 'paragraph', content: [{ text: '$ x $' }] }])
    expect(type('\\$x$')).toEqual([{ type: 'paragraph', content: [{ text: '\\$x$' }] }])
  })
  it('dans une formule en cours de frappe, _ et * ne mettent pas en forme', () => {
    expect(inOpenMath('soit $a_')).toBe(true)
    expect(inOpenMath('soit $a$ et b_')).toBe(false)
    expect(inOpenMath('$$\\sum_')).toBe(true)
    expect(inOpenMath('prix \\$5 et _')).toBe(false)
    expect(type('$a_i + b_j$')).toEqual([{ type: 'paragraph', content: [{ type: 'math', tex: 'a_i + b_j' }] }])
    expect(type('$a*b*c$')).toEqual([{ type: 'paragraph', content: [{ type: 'math', tex: 'a*b*c' }] }])
  })
  it('$$…$$ seul dans un paragraphe devient une équation centrée', () => {
    expect(type('$$E=mc^2$$')).toEqual([
      { type: 'equation', tex: 'E=mc^2' },
      { type: 'paragraph', content: [] },
    ])
    // Pas seul : une formule dans la ligne (la règle $…$ s'applique sur le dernier $).
    expect(type('$$a$$', 'x ')[0].type).toBe('paragraph')
  })
})

describe('collage', () => {
  const paste = (html: string) => {
    const dom = new window.DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
    return pmToDoc(PMDOMParser.fromSchema(schema).parse(dom), { id: 'paste-test', created: '', modified: '' }).blocks
  }
  it('reprend la source LaTeX d’une formule copiée (KaTeX, Wikipédia), sans la copie visuelle', () => {
    const katex = '<p>Soit <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span>x2</span></span></span> ici</p>'
    expect(paste(katex)).toEqual([{ type: 'paragraph', content: [{ text: 'Soit ' }, { type: 'math', tex: 'x^2' }, { text: ' ici' }] }])
    const wiki = '<p>a <span class="mwe-math-element"><span class="mwe-math-mathml-inline"><math alttext="{\\displaystyle \\pi r^{2}}"><mi>π</mi></math></span><img class="mwe-math-fallback-image-inline" alt="{\\displaystyle \\pi r^{2}}" src="https://exemple.org/x.svg"></span> b</p>'
    expect(paste(wiki)).toEqual([{ type: 'paragraph', content: [{ text: 'a ' }, { type: 'math', tex: '\\pi r^{2}' }, { text: ' b' }] }])
    const block = '<math display="block"><annotation encoding="application/x-tex">\\int_0^1 f</annotation></math>'
    expect(paste(block)).toEqual([{ type: 'equation', tex: '\\int_0^1 f' }])
    // Nos propres formules (copier-coller dans le document).
    expect(paste('<p>a <span class="fp-math" data-math="y">…</span></p><div class="fp-equation" data-equation="z" data-numbered="">…</div>')).toEqual([
      { type: 'paragraph', content: [{ text: 'a ' }, { type: 'math', tex: 'y' }] },
      { type: 'equation', tex: 'z', numbered: true },
    ])
    // Un MathML sans source : son texte, rien de plus.
    expect(paste('<p><math><mi>q</mi></math></p>')).toEqual([{ type: 'paragraph', content: [{ text: 'q' }] }])
  })
})
