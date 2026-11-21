// Le bloc de texte du curseur porte la classe « fp-current » : l'affichage peut
// estomper les autres paragraphes (Affichage → Focus → Estomper les autres).

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const currentKey = new PluginKey<DecorationSet>('folio-current-block')

/** Le bloc de texte du curseur porte la classe « fp-current » (paragraphes estompés autour). */
export function currentBlockPlugin(): Plugin<DecorationSet> {
  const build = (state: EditorState): DecorationSet => {
    const { $head } = state.selection
    for (let d = $head.depth; d > 0; d--) {
      const node = $head.node(d)
      if (node.isTextblock) return DecorationSet.create(state.doc, [Decoration.node($head.before(d), $head.after(d), { class: 'fp-current' })])
    }
    return DecorationSet.empty
  }
  return new Plugin<DecorationSet>({
    key: currentKey,
    state: {
      init: (_c, state) => build(state),
      apply: (tr, set, old, state) => (tr.docChanged || !old.selection.eq(state.selection) ? build(state) : set),
    },
    props: { decorations: (state) => currentKey.getState(state) },
  })
}
