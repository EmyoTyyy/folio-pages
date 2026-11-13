import { describe, expect, it } from 'vitest'
import { history, undo } from 'prosemirror-history'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, NodeSelection, TextSelection, type Command } from 'prosemirror-state'
import {
  applyStyle,
  changeCase,
  clearFormatting,
  indent,
  insertBlock,
  insertField,
  insertPageBreak,
  insertTable,
  markActive,
  markRange,
  markValue,
  paraAttr,
  setAlign,
  setLink,
  setListAttrs,
  setMark,
  sortParagraphs,
  stepFontSize,
  styleIdAt,
  toggleFlag,
  toggleList,
  transformCase,
} from '../../src/editor/commands'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { schema } from '../../src/editor/schema'
import { loadDocument } from '../../src/format/load'
import type { Block } from '../../src/format/types'
import { checkAccessibility } from '../../src/ui/a11y'

const n = schema.nodes
const m = schema.marks

function docOf(blocks: unknown[]): PMNode {
  const r = loadDocument({ format: 'folio/doc', version: 1, blocks }, { now: '2026-01-01T00:00:00Z' })
  if (!r.ok) throw new Error('refusé')
  return docToPM(r.doc)
}

/** État dont la sélection va de `from` à `to` (positions ProseMirror). */
function stateOf(doc: PMNode, from: number, to = from): EditorState {
  return EditorState.create({ doc, plugins: [history()], selection: TextSelection.create(doc, from, to) })
}

/** Position du texte `needle` (premier caractère) dans le document. */
function posOf(doc: PMNode, needle: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle)
    return true
  })
  if (found < 0) throw new Error(`introuvable : ${needle}`)
  return found
}

function run(state: EditorState, cmd: Command): EditorState {
  let next = state
  const ok = cmd(state, (tr) => (next = state.apply(tr)))
  expect(ok).toBe(true)
  return next
}

const blocks = (s: EditorState): Block[] => pmToDoc(s.doc, { id: 'abcdef', created: '', modified: '' }).blocks

describe('marques', () => {
  it('pose et retire une couleur sur la sélection', () => {
    const doc = docOf(['Bonjour le monde'])
    const a = posOf(doc, 'le')
    let s = stateOf(doc, a, a + 2)
    s = run(s, setMark(m.color, { value: 'accent2' }))
    expect(blocks(s)).toEqual([{ type: 'paragraph', content: [{ text: 'Bonjour ' }, { text: 'le', color: 'accent2' }, { text: ' monde' }] }])
    expect(markValue(s, m.color, 'value')).toBe('accent2')
    s = run(s, setMark(m.color, null))
    expect(blocks(s)).toEqual([{ type: 'paragraph', content: [{ text: 'Bonjour le monde' }] }])
  })
  it('signale une valeur mélangée', () => {
    const doc = docOf([{ content: [{ text: 'ab', size: 12 }, { text: 'cd', size: 14 }] }])
    const s = stateOf(doc, 1, 5)
    expect(markValue(s, m.size, 'pt')).toBe('mixed')
    expect(markValue(stateOf(doc, 2), m.size, 'pt')).toBe(12)
  })
  it('au curseur, la marque s’applique à la saisie à venir', () => {
    const doc = docOf(['ab'])
    let s = stateOf(doc, 2)
    s = run(s, setMark(m.highlight, { value: 'yellow' }))
    s = s.apply(s.tr.insertText('X'))
    expect(blocks(s)).toEqual([{ type: 'paragraph', content: [{ text: 'a' }, { text: 'X', highlight: 'yellow' }, { text: 'b' }] }])
  })
  it('agrandit et réduit la police par crans', () => {
    const doc = docOf(['abc'])
    let s = stateOf(doc, 1, 4)
    s = run(s, stepFontSize(1, {}))
    expect(markValue(s, m.size, 'pt')).toBe(12) // Normal fait 11 pt
    s = run(s, stepFontSize(1, {}))
    expect(markValue(s, m.size, 'pt')).toBe(14)
    s = run(s, stepFontSize(-1, {}))
    s = run(s, stepFontSize(-1, {}))
    s = run(s, stepFontSize(-1, {}))
    expect(markValue(s, m.size, 'pt')).toBe(10.5)
  })
  it('exposant et indice s’excluent', () => {
    const doc = docOf(['x2'])
    let s = stateOf(doc, 2, 3)
    s = run(s, toggleFlag('sup'))
    s = run(s, toggleFlag('sub'))
    expect(markActive(s, m.sup)).toBe(false)
    expect(markActive(s, m.sub)).toBe(true)
  })
  it('efface la mise en forme sauf les liens, et remet le style Normal', () => {
    const doc = docOf([{ type: 'heading', level: 2, align: 'center', content: [{ text: 'T', bold: true, link: 'https://e.org', color: '#ff0000' }] }])
    const s = run(stateOf(doc, 1, 2), clearFormatting)
    expect(blocks(s)).toEqual([{ type: 'paragraph', content: [{ text: 'T', link: 'https://e.org' }] }])
  })
})

describe('casse', () => {
  it('transforme le texte', () => {
    expect(transformCase('le CHAT dort. il rêve', 'sentence')).toBe('Le chat dort. Il rêve')
    expect(transformCase('le grand-duc d’été', 'title')).toBe('Le Grand-Duc D’été')
    expect(transformCase('AbC', 'toggle')).toBe('aBc')
    expect(transformCase('straße', 'upper')).toBe('STRASSE')
    expect(transformCase('İSTANBUL', 'lower', 'tr')).toBe('istanbul')
  })
  it('garde la mise en forme, même quand la longueur change', () => {
    const doc = docOf([{ content: [{ text: 'gro' }, { text: 'ße', bold: true }, { text: ' rue' }] }])
    const s = run(stateOf(doc, 1, 1 + 'große rue'.length), changeCase('upper'))
    expect(blocks(s)).toEqual([{ type: 'paragraph', content: [{ text: 'GRO' }, { text: 'SSE', bold: true }, { text: ' RUE' }] }])
    expect(s.selection.to - s.selection.from).toBe('GROSSE RUE'.length)
  })
})

describe('paragraphes', () => {
  it('aligne tous les paragraphes de la sélection', () => {
    const doc = docOf(['un', 'deux', { type: 'heading', text: 'trois' }])
    let s = stateOf(doc, 1, doc.content.size - 1)
    s = run(s, setAlign('center'))
    expect(paraAttr(s, 'align')).toBe('center')
    s = run(s, setAlign('left'))
    expect(blocks(s).every((b) => !('align' in b))).toBe(true)
  })
  it('retrait par crans de 36 pt, jamais négatif', () => {
    const doc = docOf([{ text: 'x', indent: { left: 10 } }])
    let s = stateOf(doc, 1)
    s = run(s, indent(1))
    expect(paraAttr(s, 'indentLeft')).toBe(36)
    s = run(s, indent(-1))
    s = run(s, indent(-1))
    expect(paraAttr(s, 'indentLeft')).toBe(null)
  })
  it('dans une liste, le retrait change de niveau', () => {
    const doc = docOf([{ type: 'list', items: ['a', 'b'] }])
    let s = stateOf(doc, posOf(doc, 'b'))
    s = run(s, indent(1))
    expect((blocks(s)[0] as Extract<Block, { type: 'list' }>).items.map((i) => i.level)).toEqual([0, 1])
    s = run(s, indent(-1))
    expect((blocks(s)[0] as Extract<Block, { type: 'list' }>).items.map((i) => i.level)).toEqual([0, 0])
  })
})

describe('styles', () => {
  it('applique titres, styles de paragraphe et code', () => {
    const doc = docOf([{ text: 'x', align: 'right' }])
    let s = run(stateOf(doc, 1), applyStyle('heading2'))
    expect(blocks(s)).toEqual([{ type: 'heading', level: 2, content: [{ text: 'x' }], align: 'right' }])
    expect(styleIdAt(s)).toBe('heading2')
    s = run(s, applyStyle('subtitle'))
    expect(blocks(s)).toEqual([{ type: 'paragraph', content: [{ text: 'x' }], style: 'subtitle', align: 'right' }])
    s = run(s, applyStyle('normal'))
    expect(blocks(s)).toEqual([{ type: 'paragraph', content: [{ text: 'x' }], align: 'right' }])
    s = run(s, applyStyle('code'))
    expect(blocks(s)).toEqual([{ type: 'code', language: '', text: 'x' }])
    s = run(s, applyStyle('title'))
    expect(blocks(s)).toEqual([{ type: 'paragraph', content: [{ text: 'x' }], style: 'title' }])
  })
  it('la citation enveloppe le paragraphe, une seule fois', () => {
    const doc = docOf(['x'])
    let s = run(stateOf(doc, 1), applyStyle('quote'))
    s = run(s, applyStyle('quote'))
    expect(blocks(s)).toEqual([{ type: 'quote', blocks: [{ type: 'paragraph', content: [{ text: 'x' }] }] }])
    expect(styleIdAt(s)).toBe('quote')
  })
})

describe('listes', () => {
  it('crée, change de type et retire une liste', () => {
    const doc = docOf(['a', 'b'])
    let s = stateOf(doc, 1, doc.content.size - 1)
    s = run(s, toggleList('bullet'))
    expect(blocks(s)[0]).toMatchObject({ type: 'list', style: 'bullet' })
    s = run(s, toggleList('number'))
    expect(blocks(s)[0]).toMatchObject({ type: 'list', style: 'number', start: 1 })
    s = run(s, toggleList('number'))
    expect(blocks(s).map((b) => b.type)).toEqual(['paragraph', 'paragraph'])
  })
  it('un titre devient un élément de liste en une seule étape d’annulation', () => {
    const doc = docOf([{ type: 'heading', text: 'T' }])
    let s = run(stateOf(doc, 1), toggleList('bullet'))
    expect(blocks(s)).toEqual([{ type: 'list', style: 'bullet', start: 1, items: [{ content: [{ text: 'T' }], level: 0, style: 'bullet' }] }])
    s = run(s, undo)
    expect(blocks(s)).toEqual([{ type: 'heading', level: 1, content: [{ text: 'T' }] }])
  })
  it('règle numérotation et départ', () => {
    const doc = docOf([{ type: 'list', style: 'number', items: ['a'] }])
    const s = run(stateOf(doc, posOf(doc, 'a')), setListAttrs({ numbering: 'roman', order: 4 }))
    expect(blocks(s)[0]).toMatchObject({ type: 'list', style: 'number', start: 4, numbering: 'roman' })
  })
})

describe('insertions', () => {
  it('remplace un paragraphe vide par le bloc inséré, sinon insère après', () => {
    let s = stateOf(docOf(['']), 1)
    s = run(s, insertPageBreak)
    expect(blocks(s).map((b) => b.type)).toEqual(['pagebreak', 'paragraph'])
    const doc = docOf(['texte'])
    s = run(stateOf(doc, 3), insertPageBreak)
    expect(blocks(s).map((b) => b.type)).toEqual(['paragraph', 'pagebreak', 'paragraph'])
    expect(s.selection.$from.parent.type).toBe(n.paragraph)
  })
  it('insère un tableau avec ligne d’en-tête et place le curseur dedans', () => {
    const s = run(stateOf(docOf(['x']), 1), insertTable(3, 2))
    const t = blocks(s)[1] as Extract<Block, { type: 'table' }>
    expect(t.type).toBe('table')
    expect(t.header).toBe(true)
    expect(t.rows.map((r) => r.length)).toEqual([2, 2, 2])
    expect(s.selection.$from.node(3)?.type.name).toMatch(/table_(header|cell)/)
  })
  it('insère un bloc dans une cellule de tableau quand il y est admis', () => {
    const doc = docOf([{ type: 'table', rows: [['a']] }])
    const img = n.figure.create({ src: 'https://e.org/a.png' })
    const s = run(stateOf(doc, posOf(doc, 'a')), insertBlock(img))
    const t = blocks(s)[0] as Extract<Block, { type: 'table' }>
    expect(t.rows[0][0].blocks.map((b) => b.type)).toEqual(['paragraph', 'image', 'paragraph'])
  })
  it('insère un champ avec la mise en forme courante, jamais dans du code', () => {
    const doc = docOf([{ content: [{ text: 'p ', bold: true }] }, { type: 'code', text: 'x' }])
    const s = run(stateOf(doc, 3), insertField('page'))
    expect(blocks(s)[0]).toEqual({ type: 'paragraph', content: [{ text: 'p ', bold: true }, { type: 'field', name: 'page', format: '', bold: true }] })
    const inCode = stateOf(doc, posOf(doc, 'x'))
    expect(insertField('page')(inCode)).toBe(false)
  })
})

describe('liens', () => {
  it('pose un lien sur la sélection, le modifie et le retire au curseur', () => {
    const doc = docOf(['voir le site ici'])
    const a = posOf(doc, 'le site')
    let s = run(stateOf(doc, a, a + 7), setLink('https://a.org'))
    expect(markRange(stateOf(s.doc, a + 3), m.link)).toMatchObject({ from: a, to: a + 7 })
    s = run(stateOf(s.doc, a + 3), setLink('https://b.org'))
    expect(blocks(s)[0]).toEqual({ type: 'paragraph', content: [{ text: 'voir ' }, { text: 'le site', link: 'https://b.org' }, { text: ' ici' }] })
    s = run(stateOf(s.doc, a + 7), setLink(null))
    expect(blocks(s)[0]).toEqual({ type: 'paragraph', content: [{ text: 'voir le site ici' }] })
  })
  it('sans sélection, insère le texte du lien', () => {
    const s = run(stateOf(docOf(['a ']), 3), setLink('https://e.org', 'Exemple'))
    expect(blocks(s)[0]).toEqual({ type: 'paragraph', content: [{ text: 'a ' }, { text: 'Exemple', link: 'https://e.org' }] })
  })
  it('l’étendue d’un lien couvre ses morceaux de mises en forme différentes', () => {
    const doc = docOf([{ content: [{ text: 'x ' }, { text: 'ab', link: '#a' }, { text: 'cd', link: '#a', bold: true }, { text: 'ef', link: '#b' }] }])
    expect(markRange(stateOf(doc, 4), m.link)).toMatchObject({ from: 3, to: 7 })
    expect(markRange(stateOf(doc, 1), m.link)).toBeNull()
  })
})

describe('sélection de nœud', () => {
  it('un saut de page se sélectionne comme un objet', () => {
    const doc = docOf([{ type: 'pagebreak' }, 'x'])
    const s = EditorState.create({ doc, selection: NodeSelection.create(doc, 0) })
    expect((s.selection as NodeSelection).node.type).toBe(n.page_break)
  })
})

describe('tableaux', () => {
  it('la ligne d’en-tête concerne toujours la première ligne, où que soit le curseur', async () => {
    const { toggleFirstRowHeader } = await import('../../src/editor/tables')
    const doc = docOf([{ type: 'table', rows: [['h1', 'h2'], ['a', 'b']] }])
    let s = run(stateOf(doc, posOf(doc, 'b')), toggleFirstRowHeader)
    expect((blocks(s)[0] as Extract<Block, { type: 'table' }>).header).toBe(false)
    s = run(stateOf(s.doc, posOf(s.doc, 'a')), toggleFirstRowHeader)
    expect((blocks(s)[0] as Extract<Block, { type: 'table' }>).header).toBe(true)
  })
  it('trie le corps du tableau selon la colonne du curseur, nombres compris', async () => {
    const { sortTable } = await import('../../src/editor/tables')
    const doc = docOf([{ type: 'table', rows: [['n', 'v'], ['b', '10'], ['a', '9'], ['c', ''], ['d', '9,5']] }])
    let s = run(stateOf(doc, posOf(doc, '10')), sortTable(1))
    const col = (st: EditorState, i: number) => (blocks(st)[0] as Extract<Block, { type: 'table' }>).rows.map((r) => (r[i].blocks[0] as Extract<Block, { type: 'paragraph' }>).content.map((x) => ('text' in x ? x.text : '')).join(''))
    expect(col(s, 1)).toEqual(['v', '9', '9,5', '10', ''])
    s = run(stateOf(s.doc, posOf(s.doc, 'b')), sortTable(-1))
    expect(col(s, 0)).toEqual(['n', 'd', 'c', 'b', 'a'])
    const merged = docOf([{ type: 'table', rows: [[{ text: 'x', colspan: 2 }], ['a', 'b']] }])
    expect(sortTable(1)(stateOf(merged, posOf(merged, 'a')))).toBe(false)
  })
})

describe('colonnes', () => {
  it('met la sélection en colonnes, change le nombre, revient à une colonne', async () => {
    const { setColumns, insertColumnBreak } = await import('../../src/editor/commands')
    const doc = docOf(['un', 'deux', 'trois'])
    let s = run(stateOf(doc, posOf(doc, 'un'), posOf(doc, 'deux') + 2), setColumns(2))
    expect(blocks(s).map((b) => b.type)).toEqual(['columns', 'paragraph'])
    expect((blocks(s)[0] as Extract<Block, { type: 'columns' }>).blocks).toHaveLength(2)
    s = run(stateOf(s.doc, posOf(s.doc, 'un')), setColumns(3, true))
    expect(blocks(s)[0]).toMatchObject({ type: 'columns', count: 3, rule: true })
    s = run(stateOf(s.doc, posOf(s.doc, 'un') + 2), insertColumnBreak)
    expect((blocks(s)[0] as Extract<Block, { type: 'columns' }>).blocks.map((b) => b.type)).toEqual(['paragraph', 'columnbreak', 'paragraph'])
    s = run(stateOf(s.doc, posOf(s.doc, 'deux')), setColumns(1))
    expect(blocks(s).map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    // pas de saut de colonne hors des colonnes
    expect(insertColumnBreak(stateOf(s.doc, 1))).toBe(false)
  })
})

describe('trier, listes de la sélection, accessibilité', () => {
  const texts = (s: EditorState) => blocks(s).map((b) => JSON.stringify(b).match(/"text":"([^"]*)"/g)?.map((x) => x.slice(8, -1)).join('|'))
  it('trie les paragraphes sélectionnés (nombres en nombres, sans casse ni accents), en une étape annulable', () => {
    const doc = docOf(['Titre gardé', 'Poire', 'abricot', 'Écrou 10', 'écrou 9', 'Fin gardée'])
    const s0 = stateOf(doc, posOf(doc, 'Poire'), posOf(doc, 'écrou 9') + 3)
    const s1 = run(s0, sortParagraphs(false, 'fr'))
    expect(texts(s1)).toEqual(['Titre gardé', 'abricot', 'écrou 9', 'Écrou 10', 'Poire', 'Fin gardée'])
    const s2 = run(s0, sortParagraphs(true, 'fr'))
    expect(texts(s2)).toEqual(['Titre gardé', 'Poire', 'Écrou 10', 'écrou 9', 'abricot', 'Fin gardée'])
    let back = s1
    undo(s1, (tr) => (back = s1.apply(tr)))
    expect(texts(back)).toEqual(texts(s0))
  })
  it('dans une liste, trie ses éléments ; un seul paragraphe ou un tableau ne se trient pas', () => {
    const doc = docOf([{ type: 'list', items: ['Zèbre', 'âne', 'Chat'] }])
    const s1 = run(stateOf(doc, posOf(doc, 'Chat')), sortParagraphs(false, 'fr'))
    expect((blocks(s1)[0] as any).items.map((i: any) => i.content[0].text)).toEqual(['âne', 'Chat', 'Zèbre'])
    const one = docOf(['Seul'])
    expect(sortParagraphs(false)(stateOf(one, 2))).toBe(false)
    const mixed = docOf(['a', { type: 'table', rows: [['x']] }, 'b'])
    expect(sortParagraphs(false)(stateOf(mixed, 1, mixed.content.size - 1))).toBe(false)
  })
  it('la numérotation s’applique à toutes les listes de la sélection', () => {
    const doc = docOf([{ type: 'list', style: 'number', items: ['un'] }, 'entre', { type: 'list', style: 'number', items: ['deux'] }])
    const s1 = run(stateOf(doc, 1, doc.content.size - 1), setListAttrs({ numbering: 'outline' }))
    expect(blocks(s1).filter((b) => b.type === 'list').map((b: any) => b.numbering)).toEqual(['outline', 'outline'])
  })
  it('vérifier l’accessibilité : ce qui manque, dans l’ordre du texte', () => {
    const r = loadDocument(
      {
        format: 'folio/doc',
        version: 1,
        meta: { title: '' },
        blocks: [
          { type: 'heading', level: 1, text: 'A' },
          { type: 'heading', level: 3, text: 'B' },
          { type: 'heading', level: 2, text: '' },
          { type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=' },
          { type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'Un schéma' },
          { type: 'table', header: false, rows: [['a']] },
          { type: 'table', header: true, rows: [['h'], ['a']] },
          { content: [{ text: 'cliquez ici', link: 'https://exemple.org' }, ' et ', { text: 'le rapport annuel', link: 'https://exemple.org/r' }] },
        ],
      },
      { now: '2026-01-01T00:00:00Z' },
    )
    if (!r.ok) throw new Error('refusé')
    const kinds = checkAccessibility(docToPM(r.doc)).map((i) => i.kind)
    expect(kinds).toEqual(['noTitle', 'noLang', 'headingSkip', 'emptyHeading', 'alt', 'tableHeader', 'vagueLink'])
  })
})
