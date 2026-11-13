// Publipostage dans l'éditeur : les champs de fusion montrent «Nom», ou la
// valeur du destinataire courant en « aperçu des résultats » ; la surbrillance
// les fait ressortir. Aperçu, destinataire courant et surbrillance sont un
// état de l'affichage (pas du document) : ils ne s'enregistrent pas.

import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, Plugin, PluginKey, TextSelection, type Command, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type NodeView } from 'prosemirror-view'
import type { MailMerge, MergeInline } from '../format/types'
import { fieldText, placeholder, recipients, type MergeContext } from '../merge/engine'
import { schema } from './schema'

const n = schema.nodes

export interface MergeView {
  preview: boolean
  /** Destinataire montré (position parmi les destinataires retenus). */
  index: number
  highlight: boolean
}

interface PluginState extends MergeView {
  decos: DecorationSet
}

export const mergeKey = new PluginKey<PluginState>('folio-merge')

export const mailMergeOf = (state: EditorState): MailMerge | undefined => (state.doc.attrs.mailMerge as MailMerge | null) ?? undefined
export const mergeViewOf = (state: EditorState): MergeView => mergeKey.getState(state) ?? { preview: false, index: 0, highlight: false }

function build(doc: PMNode, v: MergeView): DecorationSet {
  const mm = (doc.attrs.mailMerge as MailMerge | null) ?? undefined
  const list = v.preview ? recipients(mm) : []
  const r = list[Math.min(v.index, list.length - 1)]
  const lang = ((doc.attrs.lang as string) || 'fr').slice(0, 2)
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type !== n.mergefield) return true
    const f: MergeInline = { type: 'mergefield', name: node.attrs.name, ...(node.attrs.opts ? { opts: node.attrs.opts } : {}) }
    let text = placeholder(f)
    let missing = false
    if (r) {
      const ctx: MergeContext = { mm, lang, r, sequence: v.index + 1, fillins: {}, next: () => null }
      text = fieldText(f, ctx)
      missing = !f.name.startsWith('@') && !(f.name in r.values)
    }
    decos.push(Decoration.node(pos, pos + node.nodeSize, {}, { mergeText: text, preview: !!r, missing }))
    return false
  })
  return DecorationSet.create(doc, decos)
}

class MergeFieldView implements NodeView {
  dom: HTMLElement
  constructor(
    private node: PMNode,
    decorations: readonly Decoration[],
  ) {
    this.dom = document.createElement('span')
    this.dom.className = 'fp-merge'
    this.dom.contentEditable = 'false'
    this.render(decorations)
  }
  private render(decorations: readonly Decoration[]): void {
    const d = decorations.find((x) => (x.spec as { mergeText?: string }).mergeText !== undefined)
    const spec = (d?.spec ?? {}) as { mergeText?: string; preview?: boolean; missing?: boolean }
    this.dom.dataset.merge = this.node.attrs.name
    this.dom.textContent = spec.mergeText ?? `«${this.node.attrs.name}»`
    // Les retours à la ligne d'un bloc d'adresse restent visibles.
    this.dom.style.whiteSpace = spec.preview ? 'pre-line' : ''
    this.dom.classList.toggle('is-placeholder', !spec.preview)
    this.dom.classList.toggle('is-missing', !!spec.missing)
    this.dom.title = `«${this.node.attrs.name}»`
  }
  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render(decorations)
    return true
  }
  selectNode(): void {
    this.dom.classList.add('is-selected')
  }
  deselectNode(): void {
    this.dom.classList.remove('is-selected')
  }
  ignoreMutation(): boolean {
    return true
  }
}

export function mergePlugin(): Plugin<PluginState> {
  return new Plugin<PluginState>({
    key: mergeKey,
    state: {
      init: (_c, state) => ({ preview: false, index: 0, highlight: false, decos: build(state.doc, { preview: false, index: 0, highlight: false }) }),
      apply: (tr, prev, _old, state) => {
        const meta = tr.getMeta(mergeKey) as Partial<MergeView> | undefined
        if (!meta && !tr.docChanged) return prev
        const next: MergeView = { preview: meta?.preview ?? prev.preview, index: Math.max(0, meta?.index ?? prev.index), highlight: meta?.highlight ?? prev.highlight }
        return { ...next, decos: build(state.doc, next) }
      },
    },
    props: {
      decorations: (state) => mergeKey.getState(state)?.decos,
      attributes: (state): Record<string, string> => (mergeKey.getState(state)?.highlight ? { class: 'is-merge-highlight' } : {}),
      nodeViews: { mergefield: (node, _view, _getPos, decorations) => new MergeFieldView(node, decorations) },
    },
  })
}

/** Change l'aperçu, le destinataire montré ou la surbrillance (n'entre pas dans l'historique). */
export function setMergeView(v: Partial<MergeView>): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.setMeta(mergeKey, v).setMeta('addToHistory', false))
    return true
  }
}

/** Remplace les réglages de publipostage du document (annulable). */
export function setMailMerge(mm: MailMerge | null): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.setDocAttribute('mailMerge', mm ? JSON.parse(JSON.stringify(mm)) : null))
    return true
  }
}

/** Insère un champ de fusion au curseur (sélectionné ensuite). */
export function insertMergeField(name: string, opts?: Record<string, string>): Command {
  return (state, dispatch) => {
    const $from = state.selection.$from
    if (!$from.parent.inlineContent || $from.parent.type.spec.code) return false
    if (dispatch) {
      const node = n.mergefield.create({ name, opts: opts && Object.keys(opts).length ? opts : null }, null, $from.marks())
      const tr = state.tr.replaceSelectionWith(node, true)
      // Le curseur se place après le champ : on continue d'écrire.
      const at = tr.mapping.map(state.selection.from, -1)
      if (tr.doc.nodeAt(at)?.type === n.mergefield) tr.setSelection(TextSelection.create(tr.doc, at + 1))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Le champ de fusion sélectionné, s'il y en a un. */
export function selectedMergeField(state: EditorState): { node: PMNode; pos: number } | null {
  const sel = state.selection
  return sel instanceof NodeSelection && sel.node.type === n.mergefield ? { node: sel.node, pos: sel.from } : null
}
