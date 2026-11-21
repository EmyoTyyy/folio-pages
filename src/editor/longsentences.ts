// Phrases longues surlignées (Révision → Statistiques → « Surligner les phrases
// longues ») : des décorations posées par l'interface, recalculées au repos.

import { Plugin, PluginKey, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

export const longKey = new PluginKey<DecorationSet>('folio-long-sentences')

export function longSentencesPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: longKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set) => {
        const meta = tr.getMeta(longKey) as { from: number; to: number }[] | undefined
        if (meta) return DecorationSet.create(tr.doc, meta.map((r) => Decoration.inline(r.from, r.to, { class: 'fp-long-sentence' })))
        return tr.docChanged ? set.map(tr.mapping, tr.doc) : set
      },
    },
    props: { decorations: (state) => longKey.getState(state) },
  })
}

/** Transaction qui pose (ou retire, avec une liste vide) les phrases longues. */
export const setLongSentences = (tr: Transaction, ranges: { from: number; to: number }[]): Transaction => tr.setMeta(longKey, ranges).setMeta('addToHistory', false)
