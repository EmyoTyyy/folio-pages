// Graphiques dans l'éditeur : vue (le dessin SVG, aux couleurs du thème),
// création depuis le tableau du curseur, modification.

import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, Plugin, type Command, type EditorState } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { chartFromRows, chartLook, chartSvg, type ChartLook } from '../format/chart'
import type { ChartBlock, Theme } from '../format/types'
import { schema } from './schema'
import { tableAt } from './tables'

const n = schema.nodes

export interface ChartHooks {
  /** Modifier le graphique (double-clic, Entrée). */
  edit: (pos: number) => void
  /** Infobulle. */
  label: () => string
}

export { chartLook, chartLookOf } from '../format/chart'

/** Le bloc Folio d'un nœud graphique. */
export function chartOf(node: PMNode): ChartBlock {
  const a = node.attrs
  return {
    type: 'chart',
    kind: a.kind,
    ...(a.title ? { title: a.title as string } : {}),
    labels: a.labels as string[],
    series: a.series as ChartBlock['series'],
    ...(a.legend === false ? { legend: false as const } : {}),
    ...(a.horizontal ? { horizontal: true as const } : {}),
  }
}

/** Attributs du nœud d'après un bloc graphique. */
export const chartAttrs = (c: ChartBlock) => ({ kind: c.kind, title: c.title ?? '', labels: [...c.labels], series: c.series.map((s) => ({ name: s.name, values: [...s.values] })), legend: c.legend !== false, horizontal: !!c.horizontal })

/** SVG d'un graphique en élément (le texte est échappé par chartSvg). */
export function chartElement(c: ChartBlock, look: ChartLook): SVGElement {
  const tpl = document.createElement('template')
  tpl.innerHTML = chartSvg(c, look)
  return tpl.content.firstElementChild as SVGElement
}

const views = new Set<ChartView>()

export class ChartView implements NodeView {
  dom: HTMLElement
  private key = ''

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private hooks: ChartHooks | undefined,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'fp-chart'
    this.dom.contentEditable = 'false'
    this.dom.addEventListener('dblclick', (e) => {
      const pos = this.getPos()
      if (pos === undefined || !this.view.editable) return
      e.preventDefault()
      this.hooks?.edit(pos)
    })
    views.add(this)
    this.render()
  }

  /** Redessine si les données, le thème ou la langue ont changé. */
  render(): void {
    const a = this.view.state.doc.attrs
    const key = JSON.stringify([this.node.attrs, a.theme, a.lang])
    if (key === this.key) return
    this.key = key
    this.dom.title = this.hooks?.label() ?? ''
    this.dom.dataset.kind = this.node.attrs.kind
    this.dom.replaceChildren(chartElement(chartOf(this.node), chartLook(a.theme as Theme, a.lang as string)))
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  stopEvent(e: Event): boolean {
    return e.type === 'dblclick'
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    views.delete(this)
  }
}

/** Le thème change : les graphiques suivent ses couleurs et sa police. */
export function chartThemePlugin(): Plugin {
  return new Plugin({
    view: () => ({
      update: (view, prev) => {
        const a = view.state.doc.attrs
        const b = prev.doc.attrs
        if (a.theme === b.theme && a.lang === b.lang) return
        for (const v of views) v.render()
      },
    }),
  })
}

/** Entrée sur un graphique sélectionné : le modifier. */
export function chartKeyPlugin(hooks: ChartHooks | undefined): Plugin {
  return new Plugin({
    props: {
      handleKeyDown: (view, e) => {
        const sel = view.state.selection
        if (e.key !== 'Enter' || !(sel instanceof NodeSelection) || sel.node.type !== n.chart || !hooks) return false
        hooks.edit(sel.from)
        return true
      },
    },
  })
}

/** Le graphique sélectionné (position et bloc), s'il y en a un. */
export function chartAt(state: EditorState): { pos: number; chart: ChartBlock } | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.node.type === n.chart) return { pos: sel.from, chart: chartOf(sel.node) }
  return null
}

/** Les lignes du tableau du curseur, en texte (une cellule fusionnée compte une fois). */
export function tableRowsAt(state: EditorState): { rows: string[][]; end: number } | null {
  const t = tableAt(state)
  if (!t) return null
  const rows: string[][] = []
  t.node.forEach((row) => {
    const cells: string[] = []
    row.forEach((cell) => {
      cells.push(cell.textContent)
      for (let k = 1; k < (cell.attrs.colspan as number); k++) cells.push('')
    })
    rows.push(cells)
  })
  return { rows, end: t.pos + t.node.nodeSize }
}

/** Données d'un graphique depuis le tableau du curseur (null : pas de tableau, ou pas de nombres). */
export function chartFromTable(state: EditorState): { chart: ChartBlock; end: number } | null {
  const t = tableRowsAt(state)
  if (!t) return null
  const d = chartFromRows(t.rows, (state.doc.attrs.lang as string) || 'fr')
  return d ? { chart: { type: 'chart', kind: 'bar', ...d }, end: t.end } : null
}

/**
 * Insère un graphique : après le tableau `after` s'il est donné, sinon à la place de la sélection
 * (après le bloc du curseur). Le graphique est sélectionné.
 */
export function insertChart(c: ChartBlock, after?: number): Command {
  return (state, dispatch) => {
    const node = n.chart.create(chartAttrs(c))
    let pos = after
    if (pos === undefined) {
      const { $to } = state.selection
      pos = $to.depth ? $to.after(1) : $to.pos
    }
    if (dispatch) {
      const tr = state.tr.insert(pos, node)
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView())
    }
    return true
  }
}

/** Remplace les réglages et les données d'un graphique. */
export function updateChart(pos: number, c: ChartBlock): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos)
    if (node?.type !== n.chart) return false
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(pos, null, chartAttrs(c))
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)))
    }
    return true
  }
}
