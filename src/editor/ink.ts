// Dessin à main levée dans l'éditeur : les traits de chaque paragraphe sont
// dessinés en SVG par-dessus son texte (le paragraphe sert de repère), et des
// commandes pour ajouter, retirer, effacer des traits.

import { closeHistory } from 'prosemirror-history'
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, type Command, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { cssColor } from '../format/color'
import { inkOpacity, inkPath, PX_PER_PT } from '../format/ink'
import type { InkStroke } from '../format/types'

const SVG = 'http://www.w3.org/2000/svg'

/** Les traits d'un paragraphe, en SVG positionné dans son coin haut gauche. */
export function inkElement(strokes: InkStroke[]): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'fp-ink')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('width', '1')
  svg.setAttribute('height', '1')
  const g = document.createElementNS(SVG, 'g')
  g.setAttribute('transform', `scale(${PX_PER_PT})`)
  for (const s of strokes) {
    const p = document.createElementNS(SVG, 'path')
    p.setAttribute('d', inkPath(s))
    p.setAttribute('fill', 'none')
    p.setAttribute('stroke', cssColor(s.color))
    p.setAttribute('stroke-width', String(s.width))
    p.setAttribute('stroke-linecap', s.tool === 'highlighter' ? 'square' : 'round')
    p.setAttribute('stroke-linejoin', 'round')
    if (inkOpacity(s) < 1) {
      p.setAttribute('stroke-opacity', String(inkOpacity(s)))
      p.setAttribute('class', 'fp-ink__hl')
    }
    g.append(p)
  }
  svg.append(g)
  return svg
}

const inkKey = new PluginKey<DecorationSet>('folio-ink')

/** Empreinte d'un dessin (FNV-1a) : le widget n'est redessiné que s'il change. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

export function inkPlugin(): Plugin<DecorationSet> {
  const build = (doc: PMNode): DecorationSet => {
    const decos: Decoration[] = []
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return !node.isAtom
      const ink = node.attrs.ink as InkStroke[] | null
      if (ink?.length) {
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'fp-has-ink' }))
        decos.push(Decoration.widget(pos + 1, () => inkElement(ink), { side: -1, ignoreSelection: true, key: `ink-${hash(JSON.stringify(ink))}` }))
      }
      return false
    })
    return DecorationSet.create(doc, decos)
  }
  return new Plugin<DecorationSet>({
    key: inkKey,
    state: {
      init: (_c, state) => build(state.doc),
      apply: (tr, set, _old, state) => (tr.docChanged ? build(state.doc) : set),
    },
    props: { decorations: (state) => inkKey.getState(state) },
  })
}

/** Ajoute un trait au paragraphe en `pos` (une étape d'annulation à lui seul). */
export function addStroke(pos: number, stroke: InkStroke): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos)
    if (!node?.isTextblock || !('ink' in node.attrs)) return false
    const ink = [...((node.attrs.ink as InkStroke[] | null) ?? []), stroke].slice(-200)
    dispatch?.(closeHistory(state.tr.setNodeMarkup(pos, null, { ...node.attrs, ink })))
    return true
  }
}

/** Retire des traits (paragraphe → indices). */
export function removeStrokes(hits: Map<number, Set<number>>): Command {
  return (state, dispatch) => {
    if (!hits.size) return false
    if (dispatch) {
      const tr = state.tr
      for (const [pos, idx] of hits) {
        const node = tr.doc.nodeAt(pos)
        if (!node) continue
        const ink = ((node.attrs.ink as InkStroke[] | null) ?? []).filter((_, i) => !idx.has(i))
        tr.setNodeMarkup(pos, null, { ...node.attrs, ink: ink.length ? ink : null })
      }
      dispatch(closeHistory(tr))
    }
    return true
  }
}

/** Paragraphes qui portent un dessin. */
export function inkedBlocks(state: EditorState): { pos: number; node: PMNode; ink: InkStroke[] }[] {
  const out: { pos: number; node: PMNode; ink: InkStroke[] }[] = []
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return !node.isAtom
    if ((node.attrs.ink as InkStroke[] | null)?.length) out.push({ pos, node, ink: node.attrs.ink })
    return false
  })
  return out
}

/** Efface tout le dessin du document. */
export const clearInk: Command = (state, dispatch) => {
  const list = inkedBlocks(state)
  if (!list.length) return false
  if (dispatch) {
    const tr = state.tr
    for (const b of list) tr.setNodeMarkup(b.pos, null, { ...b.node.attrs, ink: null })
    dispatch(tr)
  }
  return true
}
