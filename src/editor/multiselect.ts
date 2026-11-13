// Sélection de plusieurs passages à la fois (« Sélectionner le texte de mise
// en forme semblable ») : les commandes de mise en forme s'appliquent à chacun.

import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, Selection, SelectionRange, TextSelection } from 'prosemirror-state'
import type { Mappable } from 'prosemirror-transform'
import { Decoration, DecorationSet } from 'prosemirror-view'

/**
 * Sélection de plusieurs passages à la fois (« Sélectionner le texte de mise
 * en forme semblable ») : les commandes de mise en forme s'appliquent à
 * chacun. Elle se dessine avec des décorations (le navigateur n'en montre qu'une).
 */
export class MultiRangeSelection extends Selection {
  constructor(ranges: SelectionRange[]) {
    super(ranges[0].$from, ranges[ranges.length - 1].$to, ranges)
  }
  // Le navigateur ne montre qu'un passage : les autres sont des décorations, et aucun n'est tracé par lui.
  override visible = false
  map(doc: PMNode, mapping: Mappable): Selection {
    const ranges = this.ranges
      .map((r) => new SelectionRange(doc.resolve(mapping.map(r.$from.pos, 1)), doc.resolve(mapping.map(r.$to.pos, -1))))
      .filter((r) => r.$from.pos < r.$to.pos)
    return ranges.length > 1 ? new MultiRangeSelection(ranges) : ranges.length ? TextSelection.between(ranges[0].$from, ranges[0].$to) : TextSelection.near(doc.resolve(mapping.map(this.from)))
  }
  eq(other: Selection): boolean {
    return other instanceof MultiRangeSelection && other.ranges.length === this.ranges.length && other.ranges.every((r, i) => r.$from.pos === this.ranges[i].$from.pos && r.$to.pos === this.ranges[i].$to.pos)
  }
  override toJSON(): unknown {
    return { type: 'multi', ranges: this.ranges.map((r) => [r.$from.pos, r.$to.pos]) }
  }
  static override fromJSON(doc: PMNode, json: { ranges: [number, number][] }): Selection {
    return new MultiRangeSelection(json.ranges.map(([a, b]) => new SelectionRange(doc.resolve(a), doc.resolve(b))))
  }
}
Selection.jsonID('multi', MultiRangeSelection)

/** Dessine chaque passage d'une sélection multiple. */
export function multiSelectionPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations: (state) => {
        const sel = state.selection
        if (!(sel instanceof MultiRangeSelection)) return null
        return DecorationSet.create(
          state.doc,
          sel.ranges.map((r) => Decoration.inline(r.$from.pos, r.$to.pos, { class: 'fp-multisel' })),
        )
      },
    },
  })
}

