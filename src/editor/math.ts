// Équations dans l'éditeur (phase 6) : formules en ligne ($…$) et centrées.
//
// Les deux sont des atomes : la source LaTeX est un attribut, la vue dessine le
// MathML (src/math). Un greffon calcule pour tout le document :
//   - les numéros des équations numérotées, dans l'ordre du texte ;
//   - les étiquettes (\label) pour \eqref et \ref ;
//   - les macros communes (attribut « math » du document).
// Il les passe aux vues par des décorations, comme pour les champs.
// Double-clic ou Entrée sur une formule sélectionnée : on la modifie.

import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, Plugin, PluginKey, TextSelection, type Command, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView, type NodeView } from 'prosemirror-view'
import { InputRule } from 'prosemirror-inputrules'
import { findTex, labelOf, renderTex, type MathContext, type MathProblem } from '../math'
import { schema } from './schema'

const n = schema.nodes

export interface MathHooks {
  /** Ouvre l'éditeur de formule sur le nœud en `pos`. */
  edit: (view: EditorView, pos: number) => void
  /** Message lisible pour une formule qui ne se rend pas. */
  problem: (p: MathProblem) => string
  /** Éditeur secondaire (en-tête, note) : macros et étiquettes du document principal. */
  context?: () => MathContext
}

interface MathInfo {
  ctx: MathContext
  /** Clé du contexte : une vue ne se redessine que si elle change. */
  key: string
  /** Numéro d'une équation numérotée, par position. */
  numbers: Map<number, number>
}

export const mathKey = new PluginKey<{ info: MathInfo; decos: DecorationSet }>('folio-math')

/** Numéros et étiquettes des équations du document. */
export function mathInfo(doc: PMNode, outer?: MathContext): MathInfo {
  const numbers = new Map<number, number>()
  const labels = new Map<string, number>()
  let k = 0
  doc.descendants((node, pos) => {
    if (node.type === n.equation) {
      if (node.attrs.numbered) {
        k++
        numbers.set(pos, k)
        const l = labelOf(node.attrs.tex as string)
        if (l && !labels.has(l)) labels.set(l, k)
      }
      return false
    }
    return !node.isTextblock || node.childCount > 0
  })
  const macros = outer ? (outer.macros ?? '') : (((doc.attrs.math as { macros?: string } | undefined)?.macros ?? '') as string)
  if (outer?.labels) for (const [l, v] of outer.labels) if (!labels.has(l)) labels.set(l, v)
  const key = `${macros.length}:${hash(macros)}|${[...labels].map(([l, v]) => `${l}=${v}`).join(',')}`
  return { ctx: { macros, labels }, key, numbers }
}

/** Contexte des formules du document (pour les dessins hors éditeur : notes, en-têtes). */
export function mathContextOf(state: EditorState): MathContext {
  return mathKey.getState(state)?.info.ctx ?? mathInfo(state.doc).ctx
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

function build(doc: PMNode, outer?: MathContext): { info: MathInfo; decos: DecorationSet } {
  const info = mathInfo(doc, outer)
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type === n.equation) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, {}, { math: info, num: info.numbers.get(pos) ?? 0 }))
      return false
    }
    if (node.type === n.math) decos.push(Decoration.node(pos, pos + node.nodeSize, {}, { math: info, num: 0 }))
    return true
  })
  return { info, decos: DecorationSet.create(doc, decos) }
}

type Spec = { math: MathInfo; num: number }
const specOf = (decorations: readonly Decoration[]): Spec | null => {
  const d = decorations.find((x) => (x.spec as Partial<Spec>).math)
  return d ? (d.spec as Spec) : null
}

/** Dessine une formule dans `host` ; renvoie le problème éventuel. */
export function drawTex(host: HTMLElement, tex: string, display: boolean, ctx: MathContext, problem: (p: MathProblem) => string): MathProblem | null {
  const r = renderTex(tex, display, ctx)
  host.classList.toggle('is-error', !r.html)
  host.classList.toggle('has-warning', !!r.html && !!r.error)
  if (r.html) {
    // MathML construit par l'émetteur seul (aucun attribut venu du document hors couleurs vérifiées).
    host.innerHTML = r.html
  } else {
    const code = document.createElement('code')
    code.className = 'fp-math__source'
    code.textContent = display ? tex : `$${tex}$`
    host.replaceChildren(code)
  }
  host.title = r.error ? problem(r.error) : ''
  return r.error
}

/** Formules hors éditeur (en-têtes, pieds de page, notes) : remplace la source par le dessin. */
export function renderMathIn(root: ParentNode, ctx: MathContext, problem: (p: MathProblem) => string = () => ''): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.fp-math[data-math]'))) {
    const host = document.createElement('span')
    drawTex(host, el.dataset.math ?? '', false, ctx, problem)
    el.replaceChildren(...Array.from(host.childNodes))
    el.className = host.className ? `fp-math ${host.className}` : 'fp-math'
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.fp-equation[data-equation]'))) {
    const host = document.createElement('div')
    host.className = 'fp-equation__body'
    drawTex(host, el.dataset.equation ?? '', true, ctx, problem)
    el.replaceChildren(host)
  }
}

class MathView implements NodeView {
  dom: HTMLElement
  private drawn = ''
  constructor(
    private node: PMNode,
    decorations: readonly Decoration[],
    private hooks: MathHooks,
  ) {
    this.dom = document.createElement('span')
    this.dom.className = 'fp-math'
    this.dom.contentEditable = 'false'
    this.render(decorations)
  }
  private render(decorations: readonly Decoration[]): void {
    const spec = specOf(decorations)
    const tex = this.node.attrs.tex as string
    const key = `${tex}\u0000${spec?.math.key ?? ''}`
    if (key === this.drawn) return
    this.drawn = key
    this.dom.dataset.math = tex
    drawTex(this.dom, tex, false, spec?.math.ctx ?? {}, this.hooks.problem)
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
  stopEvent(): boolean {
    return false
  }
  ignoreMutation(): boolean {
    return true
  }
}

class EquationView implements NodeView {
  dom: HTMLElement
  private body: HTMLElement
  private num: HTMLElement
  private drawn = ''
  constructor(
    private node: PMNode,
    decorations: readonly Decoration[],
    private hooks: MathHooks,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'fp-equation'
    this.dom.contentEditable = 'false'
    this.body = document.createElement('div')
    this.body.className = 'fp-equation__body'
    this.num = document.createElement('span')
    this.num.className = 'fp-equation__num'
    this.dom.append(this.body, this.num)
    this.render(decorations)
  }
  private render(decorations: readonly Decoration[]): void {
    const spec = specOf(decorations)
    const tex = this.node.attrs.tex as string
    const num = spec?.num ?? 0
    const key = `${tex}\u0000${spec?.math.key ?? ''}\u0000${num}`
    if (key === this.drawn) return
    this.drawn = key
    this.dom.dataset.equation = tex
    this.dom.classList.toggle('is-numbered', !!num)
    this.num.textContent = num ? `(${num})` : ''
    drawTex(this.body, tex, true, spec?.math.ctx ?? {}, this.hooks.problem)
    this.dom.classList.toggle('is-error', this.body.classList.contains('is-error'))
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

/** Formule sélectionnée (atome en ligne ou équation centrée), avec sa position. */
export function selectedMath(state: EditorState): { node: PMNode; pos: number } | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && (sel.node.type === n.math || sel.node.type === n.equation)) return { node: sel.node, pos: sel.from }
  return null
}

export function mathPlugin(hooks: MathHooks): Plugin {
  return new Plugin({
    key: mathKey,
    state: {
      init: (_c, state) => build(state.doc, hooks.context?.()),
      apply: (tr, value, _old, state) => (tr.docChanged || tr.getMeta(mathKey) ? build(state.doc, hooks.context?.()) : value),
    },
    props: {
      decorations: (state) => mathKey.getState(state)?.decos,
      nodeViews: {
        math: (node, _view, _getPos, decorations) => new MathView(node, decorations, hooks),
        equation: (node, _view, _getPos, decorations) => new EquationView(node, decorations, hooks),
      },
      handleDoubleClickOn: (view, _pos, node, nodePos, _e, direct) => {
        if (!direct || (node.type !== n.math && node.type !== n.equation)) return false
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)))
        hooks.edit(view, nodePos)
        return true
      },
      handleKeyDown: (view, e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false
        const m = selectedMath(view.state)
        if (!m) return false
        e.preventDefault()
        hooks.edit(view, m.pos)
        return true
      },
    },
  })
}

// --- commandes -----------------------------------------------------------

/** Insère une formule en ligne (sélection : son texte devient la source) ; renvoie sa position via `onPos`. */
export function insertMath(tex: string, onPos?: (pos: number) => void): Command {
  return (state, dispatch) => {
    const $from = state.selection.$from
    if (!$from.parent.inlineContent || $from.parent.type.spec.code) return false
    if (dispatch) {
      const node = n.math.create({ tex })
      const tr = state.tr.replaceSelectionWith(node, true)
      const pos = tr.mapping.map(state.selection.from, -1)
      const at = tr.doc.nodeAt(pos)?.type === n.math ? pos : pos - 1
      tr.setSelection(NodeSelection.create(tr.doc, Math.max(0, at)))
      dispatch(tr.scrollIntoView())
      onPos?.(tr.selection.from)
    }
    return true
  }
}

/** Insère une équation centrée après le paragraphe courant (ou à sa place s'il est vide). */
export function insertEquation(tex: string, numbered = false, onPos?: (pos: number) => void): Command {
  return (state, dispatch) => {
    const $from = state.selection.$from
    let depth = $from.depth
    while (depth > 0 && !$from.node(depth).isTextblock) depth--
    if (depth === 0) return false
    const container = $from.node(depth - 1)
    const node = n.equation.create({ tex, numbered })
    const index = $from.index(depth - 1)
    if (!container.canReplaceWith(index, index + 1, n.equation)) return false
    if (dispatch) {
      const para = $from.node(depth)
      const start = $from.before(depth)
      const tr = state.tr
      let pos: number
      if (para.content.size === 0 && para.type === n.paragraph) {
        tr.replaceWith(start, start + para.nodeSize, node)
        pos = start
        // Toujours un paragraphe après, pour continuer à écrire.
        if (!tr.doc.nodeAt(pos + node.nodeSize)) tr.insert(pos + node.nodeSize, n.paragraph.create())
      } else {
        pos = start + para.nodeSize
        tr.insert(pos, node)
        const after = tr.doc.nodeAt(pos + node.nodeSize)
        if (!after || !after.isTextblock) tr.insert(pos + node.nodeSize, n.paragraph.create())
      }
      tr.setSelection(NodeSelection.create(tr.doc, pos))
      dispatch(tr.scrollIntoView())
      onPos?.(pos)
    }
    return true
  }
}

/** Modifie (ou supprime si vide) la formule en `pos`. */
export function setMath(pos: number, attrs: { tex: string; numbered?: boolean; display?: boolean }): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos)
    if (!node || (node.type !== n.math && node.type !== n.equation)) return false
    if (dispatch) {
      const tr = state.tr
      const tex = attrs.tex.trim()
      if (!tex) {
        tr.delete(pos, pos + node.nodeSize)
        dispatch(tr.scrollIntoView())
        return true
      }
      const wantBlock = attrs.display ?? node.type === n.equation
      if (wantBlock === (node.type === n.equation)) {
        tr.setNodeMarkup(pos, null, node.type === n.equation ? { tex, numbered: attrs.numbered ?? node.attrs.numbered } : { tex }, node.marks)
        tr.setSelection(NodeSelection.create(tr.doc, pos))
      } else if (wantBlock) {
        // En ligne → centrée : la formule sort de son paragraphe, qui est coupé en deux.
        const eq = n.equation.create({ tex, numbered: !!attrs.numbered })
        tr.delete(pos, pos + node.nodeSize)
        const $p = tr.doc.resolve(pos)
        if ($p.parent.content.size === 0) tr.replaceWith($p.before(), $p.after(), eq)
        else {
          tr.split(pos)
          const at = tr.mapping.map(pos)
          // `at` est le début du second paragraphe : l'équation va entre les deux.
          tr.insert(at - 1, eq)
        }
        const found = findNear(tr.doc, pos, n.equation)
        if (found >= 0) tr.setSelection(NodeSelection.create(tr.doc, found))
      } else {
        // Centrée → en ligne : un paragraphe qui ne contient qu'elle.
        tr.replaceWith(pos, pos + node.nodeSize, n.paragraph.create(null, n.math.create({ tex })))
        tr.setSelection(NodeSelection.create(tr.doc, pos + 1))
      }
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

function findNear(doc: PMNode, around: number, type: typeof n.equation): number {
  let best = -1
  doc.nodesBetween(Math.max(0, around - 4), Math.min(doc.content.size, around + 4), (node, pos) => {
    if (node.type === type && best < 0) best = pos
    return true
  })
  return best
}

/**
 * Convertit les $…$, $$…$$, \(…\) et \[…\] du texte sélectionné (ou de tout le
 * document) en formules. Un paragraphe qui n'est qu'une formule centrée
 * devient une équation centrée. Renvoie le nombre de formules créées via `onCount`.
 */
export function convertTexText(all: boolean, onCount?: (n: number) => void): Command {
  return (state, dispatch) => {
    const from = all ? 0 : state.selection.from
    const to = all ? state.doc.content.size : state.selection.to
    if (!all && from === to) return false
    type Hit = { start: number; end: number; tex: string; display: boolean; whole: boolean; para: number; paraSize: number }
    const hits: Hit[] = []
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true
      if (node.type.spec.code) return false
      // Le texte de chaque morceau, avec sa position (les atomes coupent la recherche).
      let buf = ''
      let bufStart = -1
      const flush = () => {
        if (!buf) return
        for (const s of findTex(buf)) {
          const start = bufStart + s.from
          const end = bufStart + s.to
          if (end <= from || start >= to) continue
          const whole = s.display && buf.trim() === buf.slice(s.from, s.to).trim() && node.childCount === 1
          hits.push({ start, end, tex: s.tex, display: s.display, whole, para: pos, paraSize: node.nodeSize })
        }
        buf = ''
        bufStart = -1
      }
      node.forEach((child, offset) => {
        if (child.isText && !child.marks.some((m) => m.type.name === 'code')) {
          if (bufStart < 0) bufStart = pos + 1 + offset
          buf += child.text
        } else flush()
      })
      flush()
      return false
    })
    if (!hits.length) return false
    if (dispatch) {
      const tr = state.tr
      for (const h of hits.reverse()) {
        if (h.whole && h.display) tr.replaceWith(h.para, h.para + h.paraSize, n.equation.create({ tex: h.tex, numbered: /\\label\s*\{/.test(h.tex) }))
        else tr.replaceWith(h.start, h.end, n.math.create({ tex: h.tex }, null, n.math.allowedMarks(state.doc.resolve(h.start).marks())))
      }
      dispatch(tr.scrollIntoView())
      onCount?.(hits.length)
    }
    return true
  }
}

/** Le texte de la sélection contient-il des formules à convertir ? */
export function hasTexText(state: EditorState): boolean {
  if (state.selection.empty) return false
  return findTex(state.doc.textBetween(state.selection.from, state.selection.to, '\n', '￼')).length > 0
}

// --- frappe -----------------------------------------------------------------

/**
 * $x^2$ tapé : devient une formule au $ fermant (pas d'espace juste à
 * l'intérieur, pas de \ avant le $ ouvrant). $$…$$ seul dans un paragraphe :
 * une équation centrée.
 */
export function mathInputRules(): InputRule[] {
  const inline = new InputRule(/(?:^|[^\\$])\$([^$\s\\]|[^$\s][^$\n]*?[^$\s\\])\$$/, (state, match, start, end) => {
    const $s = state.doc.resolve(start)
    if ($s.parent.type.spec.code || state.doc.rangeHasMark(start, end, schema.marks.code)) return null
    const lead = match[0].startsWith('$') ? 0 : 1
    const tex = match[1]
    const node = n.math.create({ tex }, null, n.math.allowedMarks($s.marks()))
    const tr = state.tr.replaceWith(start + lead, end, node)
    return tr.setSelection(TextSelection.create(tr.doc, start + lead + node.nodeSize))
  })
  const display = new InputRule(/^\$\$(.+)\$\$$/, (state, match, start, end) => {
    const $s = state.doc.resolve(start)
    // Seulement un paragraphe qui ne contient que la formule (le dernier $ n'est pas encore écrit).
    if ($s.parent.type !== n.paragraph || start !== $s.start() || end !== $s.end()) return null
    const host = $s.node($s.depth - 1)
    if (!host.canReplaceWith($s.index($s.depth - 1), $s.index($s.depth - 1) + 1, n.equation)) return null
    const tex = match[1].trim()
    if (!tex) return null
    const para = $s.before()
    const eq = n.equation.create({ tex })
    const tr = state.tr.replaceWith(para, $s.after(), [eq, n.paragraph.create()])
    return tr.setSelection(TextSelection.create(tr.doc, para + eq.nodeSize + 1))
  })
  return [display, inline]
}
