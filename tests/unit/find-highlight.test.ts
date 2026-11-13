// @vitest-environment jsdom
// Rechercher le texte surligné : passages surlignés seuls, ou texte cherché
// entièrement surligné ; la trame de caractère n'est pas du surlignage.

import { describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { docToPM } from '../../src/editor/convert'
import { findMatches, findPlugin, findState, highlightedSpans, replaceAll, setQuery, type FindQuery } from '../../src/editor/find'
import { loadDocument } from '../../src/format/load'
import { NOW } from './docx-helpers'

function pm(blocks: unknown[]) {
  const r = loadDocument({ format: 'folio/doc', version: 1, meta: { title: 'Essai', lang: 'fr' }, blocks }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  return docToPM(r.doc)
}

const q = (text: string, extra: Partial<FindQuery> = {}): FindQuery => ({ text, regex: false, caseSensitive: false, wholeWord: false, highlighted: true, ...extra })
const texts = (doc: ReturnType<typeof pm>, query: FindQuery) => findMatches(doc, query).matches.map((m) => doc.textBetween(m.from, m.to))

const DOC = [
  {
    content: [
      { text: 'Avant ' },
      { text: 'jaune', highlight: 'yellow' },
      { text: ' puis vert', highlight: 'green' },
      { text: ' rien ' },
      { text: 'gris', textShading: '#d9d9d9' },
      { text: ' fin ' },
      { text: 'Chat', highlight: 'pink', bold: true },
    ],
  },
  'Un chat sans couleur.',
  { content: [{ text: 'dernier chat', highlight: 'cyan' }] },
]

describe('rechercher le texte surligné', () => {
  it('sans texte : chaque passage surligné, couleurs voisines fusionnées, trame exclue', () => {
    const doc = pm(DOC)
    expect(texts(doc, q(''))).toEqual(['jaune puis vert', 'Chat', 'dernier chat'])
    expect(highlightedSpans(doc.child(1))).toEqual([])
  })

  it('avec un texte : seulement les résultats entièrement surlignés', () => {
    const doc = pm(DOC)
    expect(texts(doc, q('chat'))).toEqual(['Chat', 'chat'])
    expect(texts(doc, q('chat', { highlighted: false }))).toHaveLength(3)
    // à cheval sur un passage surligné et du texte normal : exclu
    expect(texts(doc, q('vert rien'))).toEqual([])
    expect(texts(doc, q('jaune puis'))).toEqual(['jaune puis'])
    // les autres options s'appliquent toujours
    expect(texts(doc, q('chat', { caseSensitive: true }))).toEqual(['chat'])
    expect(texts(doc, q('\\w+ chat', { regex: true }))).toEqual(['dernier chat'])
  })

  it('l’état de recherche compte les passages et remplace tout en une étape', () => {
    let state = EditorState.create({ doc: pm(DOC), plugins: [findPlugin()] })
    const run = (cmd: (s: EditorState, d: (tr: import('prosemirror-state').Transaction) => void) => boolean) =>
      cmd(state, (tr) => {
        state = state.apply(tr)
      })
    run(setQuery(q('')))
    expect(findState(state)?.matches).toHaveLength(3)
    expect(findState(state)?.decorations.find()).toHaveLength(3)
    run(setQuery({ ...q(''), highlighted: false }))
    expect(findState(state)?.matches).toHaveLength(0)
    run(setQuery(q('chat')))
    let n = 0
    run(replaceAll('chien', (c) => (n = c)))
    expect(n).toBe(2)
    expect(state.doc.textContent).toContain('dernier chien')
    expect(state.doc.textContent).toContain('Un chat sans couleur.')
    // le texte remplacé garde son surlignage
    expect(texts(state.doc, q(''))).toEqual(['jaune puis vert', 'chien', 'dernier chien'])
  })

  it('le nombre de résultats reste borné', () => {
    const many = Array.from({ length: 120 }, () => ({ content: Array.from({ length: 200 }, (_, i) => ({ text: 'x ', highlight: i % 2 ? 'yellow' : undefined })) }))
    const r = findMatches(pm(many), q(''))
    expect(r.matches.length).toBe(10_000)
    expect(r.truncated).toBe(true)
  })
})
