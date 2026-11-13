// @vitest-environment jsdom
// Règles de lecture du HTML collé (schéma de l'éditeur) : seuls les éléments
// connus passent, les liens dangereux sont refusés, le texte est toujours gardé.

import { describe, expect, it } from 'vitest'
import { DOMParser as PMDOMParser } from 'prosemirror-model'
import { schema } from '../../src/editor/schema'
import { pmToDoc } from '../../src/editor/convert'

function paste(html: string) {
  const dom = new window.DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
  const node = PMDOMParser.fromSchema(schema).parse(dom)
  return pmToDoc(node, { id: 'paste-test', created: '', modified: '' }).blocks
}

describe('collage de HTML', () => {
  it('garde la structure connue', () => {
    expect(paste('<h2>T</h2><p>a <strong>b</strong> <em>c</em> <u>d</u> <s>e</s> <code>f</code> x<sup>2</sup> H<sub>2</sub></p>')).toEqual([
      { type: 'heading', level: 2, content: [{ text: 'T' }] },
      {
        type: 'paragraph',
        content: [
          { text: 'a ' },
          { text: 'b', bold: true },
          { text: ' ' },
          { text: 'c', italic: true },
          { text: ' ' },
          { text: 'd', underline: true },
          { text: ' ' },
          { text: 'e', strike: true },
          { text: ' ' },
          { text: 'f', code: true },
          { text: ' x' },
          { text: '2', sup: true },
          { text: ' H' },
          { text: '2', sub: true },
        ],
      },
    ])
  })

  it('refuse les liens dangereux mais garde leur texte', () => {
    const blocks = paste('<p><a href="javascript:alert(1)">a</a> <a href=" data:text/html,x">b</a> <a href="https://ok.fr">c</a></p>')
    expect(blocks).toEqual([{ type: 'paragraph', content: [{ text: 'a b ' }, { text: 'c', link: 'https://ok.fr' }] }])
  })

  it('ignore scripts, styles, images et attributs d’événement', () => {
    const blocks = paste('<script>alert(1)</script><style>p{}</style><p onclick="x()">texte<img src=x onerror="y()"></p>')
    expect(blocks).toEqual([{ type: 'paragraph', content: [{ text: 'texte' }] }])
  })

  it('reconnaît le gras « à la Google Docs » et le désactive quand il le faut', () => {
    expect(paste('<b style="font-weight:normal"><p>pas gras <span style="font-weight:700">gras</span></p></b>')).toEqual([
      { type: 'paragraph', content: [{ text: 'pas gras ' }, { text: 'gras', bold: true }] },
    ])
  })

  it('lit les listes, les tableaux, le code et les citations', () => {
    const blocks = paste(
      '<ol start="3"><li>a<ul><li>b</li></ul></li></ol><table><tr><th>h</th></tr><tr><td>c</td></tr></table>' +
        '<pre class="language-js"><code>let x\n= 1</code></pre><blockquote><p>q</p></blockquote><hr>',
    )
    expect(blocks.map((b) => b.type)).toEqual(['list', 'table', 'code', 'quote', 'divider'])
    expect(blocks[0]).toMatchObject({ style: 'number', start: 3 })
    expect(blocks[2]).toEqual({ type: 'code', language: 'js', text: 'let x\n= 1' })
  })
})
