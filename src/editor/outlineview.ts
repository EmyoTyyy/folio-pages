// Affichage → Plan : le document vu comme un plan. Chaque titre a un bouton
// pour replier ou déplier ce qui le suit ; le texte courant est décalé sous son
// titre ; on peut ne montrer que les premiers niveaux, ou la première ligne des
// paragraphes. Les commandes (onglet Mode Plan, Alt+Maj+flèches) montent ou
// descendent un titre d'un niveau, et déplacent un titre avec toute sa partie.
//
// Seuls les blocs du premier niveau du document comptent (un titre dans un
// tableau ou une citation reste à sa place).

import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { schema } from './schema'

export interface OutlineState {
  on: boolean
  /** Titres repliés (positions dans le document). */
  collapsed: number[]
  /** Niveaux montrés : 1 à 6, ou 0 pour tout (texte compris). */
  level: number
  /** Première ligne seulement des paragraphes de texte. */
  firstLine: boolean
}

type Meta = Partial<{ on: boolean; toggle: number; level: number; firstLine: boolean; collapsed: number[] }>

export const outlineKey = new PluginKey<OutlineState>('folio-outline')

const isHeading = (n: PMNode) => n.type === schema.nodes.heading
const levelOf = (n: PMNode) => (isHeading(n) ? (n.attrs.level as number) : 99)

/** Les blocs du premier niveau : position, nœud. */
function topBlocks(doc: PMNode): { pos: number; node: PMNode }[] {
  const out: { pos: number; node: PMNode }[] = []
  doc.forEach((node, pos) => out.push({ pos, node }))
  return out
}

/** Fin (indice exclu) de la partie d'un titre : jusqu'au prochain titre de même niveau ou plus haut. */
function sectionEnd(blocks: { node: PMNode }[], i: number): number {
  const lvl = levelOf(blocks[i].node)
  let j = i + 1
  while (j < blocks.length && levelOf(blocks[j].node) > lvl) j++
  return j
}

export function outlinePlugin(): Plugin<OutlineState> {
  return new Plugin<OutlineState>({
    key: outlineKey,
    state: {
      init: () => ({ on: false, collapsed: [], level: 0, firstLine: false }),
      apply: (tr, prev) => {
        const meta = tr.getMeta(outlineKey) as Meta | undefined
        let next = prev
        if (tr.docChanged && prev.collapsed.length) {
          // Les titres repliés suivent le texte ; ceux qui ont disparu sont oubliés.
          const kept = prev.collapsed.map((p) => tr.mapping.mapResult(p, 1)).filter((r) => !r.deleted && tr.doc.nodeAt(r.pos) && isHeading(tr.doc.nodeAt(r.pos)!)).map((r) => r.pos)
          next = { ...prev, collapsed: kept }
        }
        if (!meta) return next
        if (meta.toggle !== undefined) {
          const has = next.collapsed.includes(meta.toggle)
          next = { ...next, collapsed: has ? next.collapsed.filter((p) => p !== meta.toggle) : [...next.collapsed, meta.toggle] }
        }
        if (meta.collapsed) next = { ...next, collapsed: meta.collapsed }
        if (meta.on !== undefined) next = { ...next, on: meta.on, ...(meta.on ? {} : { collapsed: [], level: 0, firstLine: false }) }
        if (meta.level !== undefined) next = { ...next, level: meta.level }
        if (meta.firstLine !== undefined) next = { ...next, firstLine: meta.firstLine }
        return next
      },
    },
    props: {
      decorations: (state) => {
        const s = outlineKey.getState(state)
        if (!s?.on) return null
        const blocks = topBlocks(state.doc)
        const decos: Decoration[] = []
        let hideBelow = Infinity // un titre replié cache ce qui est plus bas que son niveau
        let current = 0 // niveau du dernier titre (pour décaler le texte)
        blocks.forEach((b, i) => {
          const lvl = levelOf(b.node)
          if (lvl <= hideBelow) hideBelow = Infinity
          const heading = lvl < 99
          if (heading) current = lvl
          const hidden = lvl > hideBelow || (s.level > 0 && lvl > s.level)
          const collapsed = heading && s.collapsed.includes(b.pos)
          const hasContent = heading && sectionEnd(blocks, i) > i + 1
          const cls = ['fp-ol', heading ? 'fp-ol--h' : 'fp-ol--body', hidden ? 'fp-ol-hidden' : '', collapsed ? 'fp-ol-collapsed' : '', hasContent ? 'fp-ol-has' : ''].filter(Boolean).join(' ')
          decos.push(Decoration.node(b.pos, b.pos + b.node.nodeSize, { class: cls, style: `--ol-level:${heading ? lvl - 1 : current}` }))
          if (heading && !hidden) {
            decos.push(
              Decoration.widget(b.pos + 1, () => toggleDOM(b.pos, collapsed, hasContent), {
                side: -1,
                ignoreSelection: true,
                key: `ol-${b.pos}-${collapsed}-${hasContent}`,
              }),
            )
          }
          if (collapsed && hasContent && lvl < hideBelow) hideBelow = lvl
        })
        return DecorationSet.create(state.doc, decos)
      },
      attributes: (state): Record<string, string> => {
        const s = outlineKey.getState(state)
        return s?.on ? { class: `fp-plan${s.firstLine ? ' fp-plan--first' : ''}` } : {}
      },
      handleDOMEvents: {
        mousedown: (view, e) => {
          const btn = (e.target as Element).closest?.('[data-ol-toggle]')
          if (!btn) return false
          e.preventDefault()
          view.dispatch(view.state.tr.setMeta(outlineKey, { toggle: Number((btn as HTMLElement).dataset.olToggle) }))
          return true
        },
      },
      handleKeyDown: (view, e) => {
        if (!outlineKey.getState(view.state)?.on || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return false
        const cmd = { ArrowUp: moveSection(-1), ArrowDown: moveSection(1), ArrowLeft: promote, ArrowRight: demote }[e.key]
        if (!cmd) return false
        e.preventDefault()
        return cmd(view.state, view.dispatch)
      },
    },
  })
}

function toggleDOM(pos: number, collapsed: boolean, hasContent: boolean): HTMLElement {
  const b = document.createElement('span')
  b.className = 'fp-ol-toggle' + (hasContent ? '' : ' is-leaf')
  b.contentEditable = 'false'
  b.dataset.olToggle = String(pos)
  b.setAttribute('aria-hidden', 'true')
  b.textContent = hasContent ? (collapsed ? '+' : '−') : '•'
  return b
}

// --- commandes ------------------------------------------------------------------

const setMeta = (meta: Meta): Command => (state, dispatch) => {
  dispatch?.(state.tr.setMeta(outlineKey, meta).setMeta('addToHistory', false))
  return true
}

export const outlineOn = (on: boolean): Command => setMeta({ on })
export const showLevel = (level: number): Command => setMeta({ level })
export const setFirstLine = (firstLine: boolean): Command => setMeta({ firstLine })

/** Les blocs du premier niveau touchés par la sélection (indices). */
function selectedTop(state: EditorState): [number, number] {
  const blocks = topBlocks(state.doc)
  const { from, to } = state.selection
  let a = blocks.findIndex((b) => b.pos + b.node.nodeSize > from)
  let z = blocks.findIndex((b) => b.pos + b.node.nodeSize >= to)
  if (a < 0) a = blocks.length - 1
  if (z < 0) z = blocks.length - 1
  return [a, Math.max(a, z)]
}

/** Replie (true) ou déplie le titre de la sélection, ou tous les titres. */
export function collapse(on: boolean, all = false): Command {
  return (state, dispatch) => {
    const s = outlineKey.getState(state)
    if (!s) return false
    const blocks = topBlocks(state.doc)
    let targets: number[]
    if (all) targets = blocks.filter((b) => isHeading(b.node)).map((b) => b.pos)
    else {
      // Le titre de la sélection, ou celui de la partie où elle se trouve.
      const [i] = selectedTop(state)
      let k = i
      while (k >= 0 && !isHeading(blocks[k].node)) k--
      if (k < 0) return false
      targets = [blocks[k].pos]
    }
    const set = new Set(s.collapsed)
    for (const p of targets) {
      if (on) set.add(p)
      else set.delete(p)
    }
    if (dispatch) {
      const tr = state.tr.setMeta(outlineKey, { collapsed: [...set] }).setMeta('addToHistory', false)
      // Le curseur ne reste pas dans un passage replié : il va au titre.
      if (on && !all) tr.setSelection(TextSelection.near(state.doc.resolve(targets[0] + 1)))
      dispatch(tr)
    }
    return true
  }
}

/** Les titres (et paragraphes) sélectionnés montent d'un niveau : Titre 2 → Titre 1 ; un paragraphe devient titre. */
export const promote: Command = (state, dispatch) => changeLevels(state, dispatch, -1)
/** Descendent d'un niveau : Titre 1 → Titre 2. */
export const demote: Command = (state, dispatch) => changeLevels(state, dispatch, 1)

function changeLevels(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, delta: number): boolean {
  const blocks = topBlocks(state.doc)
  const [a, z] = selectedTop(state)
  const tr = state.tr
  let changed = false
  for (let i = a; i <= z; i++) {
    const { node, pos } = blocks[i]
    if (isHeading(node)) {
      const lvl = Math.min(6, Math.max(1, (node.attrs.level as number) + delta))
      if (lvl !== node.attrs.level) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: lvl })
        changed = true
      }
    } else if (node.type === schema.nodes.paragraph && delta < 0) {
      // Un paragraphe promu prend le niveau du titre qui le précède (Titre 1 au début).
      let k = i - 1
      while (k >= 0 && !isHeading(blocks[k].node)) k--
      const lvl = k >= 0 ? (blocks[k].node.attrs.level as number) : 1
      const { style, ...attrs } = node.attrs
      void style
      tr.setNodeMarkup(pos, schema.nodes.heading, { ...attrs, level: lvl })
      changed = true
    }
  }
  if (!changed) return false
  dispatch?.(tr.scrollIntoView())
  return true
}

/** Les titres sélectionnés redeviennent du texte (paragraphes). */
export const toBody: Command = (state, dispatch) => {
  const blocks = topBlocks(state.doc)
  const [a, z] = selectedTop(state)
  const tr = state.tr
  let changed = false
  for (let i = a; i <= z; i++) {
    const { node, pos } = blocks[i]
    if (!isHeading(node)) continue
    const { level, ...attrs } = node.attrs
    void level
    tr.setNodeMarkup(pos, schema.nodes.paragraph, { ...attrs, style: null })
    changed = true
  }
  if (!changed) return false
  dispatch?.(tr.scrollIntoView())
  return true
}

/**
 * Monte (-1) ou descend (1) ce qui est sélectionné : un titre part avec toute
 * sa partie ; il passe au-dessus ou au-dessous de la partie voisine de même
 * niveau, ou d'un bloc sinon. Une étape annulable ; la sélection suit.
 */
export function moveSection(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const blocks = topBlocks(state.doc)
    const [a, z] = selectedTop(state)
    const first = blocks[a].node
    const start = a
    const end = isHeading(first) && a === z ? sectionEnd(blocks, a) : z + 1
    const lvl = levelOf(first)
    let other: [number, number]
    if (dir < 0) {
      if (start === 0) return false
      let p = start - 1
      while (p > 0 && levelOf(blocks[p].node) > lvl) p--
      other = isHeading(first) && levelOf(blocks[p].node) === lvl ? [p, start] : [start - 1, start]
    } else {
      if (end >= blocks.length) return false
      const next = blocks[end].node
      other = isHeading(first) && levelOf(next) === lvl ? [end, sectionEnd(blocks, end)] : [end, end + 1]
    }
    if (dispatch) {
      const posOf = (i: number) => (i < blocks.length ? blocks[i].pos : state.doc.content.size)
      const moving = state.doc.slice(posOf(start), posOf(end))
      const offset = state.selection.from - posOf(start)
      const span = state.selection.to - state.selection.from
      const tr = state.tr
      let at: number
      if (dir < 0) {
        tr.delete(posOf(start), posOf(end))
        at = posOf(other[0])
        tr.insert(at, moving.content)
      } else {
        const after = posOf(other[1])
        tr.insert(after, moving.content)
        tr.delete(posOf(start), posOf(end))
        at = after - (posOf(end) - posOf(start))
      }
      const from = Math.min(at + offset, tr.doc.content.size)
      tr.setSelection(TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(Math.min(from + span, tr.doc.content.size))))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

export const outlineState = (state: EditorState): OutlineState | undefined => outlineKey.getState(state)
