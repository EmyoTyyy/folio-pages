// Graphiques : insertion (depuis le tableau du curseur, ou des données
// d'exemple), fenêtre de modification (type, titre, légende, données), menu.

import type { FolioApp } from '../app'
import { chartElement, chartFromTable, chartLook, insertChart, tableRowsAt, updateChart } from '../editor/chart'
import { CHART_LIMITS, parseNumber } from '../format/chart'
import { CHART_KINDS, type ChartBlock, type ChartKind, type Theme } from '../format/types'
import type { Key } from '../i18n/dict'
import { lang, t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h, icon } from './dom'
import { RIBBON_ICONS as I } from './icons'

const KIND_ICONS: Record<ChartKind, string> = { bar: I.chartBar, line: I.chartLine, pie: I.chartPie }

/** Données d'exemple d'un graphique neuf. */
function sample(): ChartBlock {
  const fr = lang().startsWith('fr')
  return {
    type: 'chart',
    kind: 'bar',
    labels: fr ? ['T1', 'T2', 'T3', 'T4'] : ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: '2025', values: [12, 18, 15, 22] },
      { name: '2026', values: [14, 21, 19, 25] },
    ],
  }
}

/**
 * Insérer un graphique : depuis le tableau du curseur (placé juste après lui),
 * sinon avec des données d'exemple à remplacer.
 */
export function insertChartUi(app: FolioApp): void {
  if (tableRowsAt(app.state)) {
    const made = chartFromTable(app.state)
    if (!made) return void toast(t('chart.noNumbers'), { kind: 'error', timeout: 8000 })
    chartDialog(app, { chart: made.chart, after: made.end })
    return
  }
  chartDialog(app, { chart: sample() })
}

/** Modifier le graphique d'une position. */
export function editChartAt(app: FolioApp, pos: number): void {
  const node = app.state.doc.nodeAt(pos)
  if (node?.type.name !== 'chart') return
  const a = node.attrs
  chartDialog(app, { pos, chart: { type: 'chart', kind: a.kind, ...(a.title ? { title: a.title } : {}), labels: [...a.labels], series: (a.series as ChartBlock['series']).map((s) => ({ name: s.name, values: [...s.values] })), ...(a.legend === false ? { legend: false } : {}), ...(a.horizontal ? { horizontal: true } : {}) } })
}

/** Fenêtre du graphique : type, titre, légende, tableau des données, aperçu. */
export function chartDialog(app: FolioApp, o: { chart: ChartBlock; pos?: number; after?: number }): void {
  const c: ChartBlock = { ...o.chart, labels: [...o.chart.labels], series: o.chart.series.map((s) => ({ name: s.name, values: [...s.values] })) }
  const docLang = (app.state.doc.attrs.lang as string) || lang()
  const fmt = new Intl.NumberFormat(docLang, { maximumFractionDigits: 6, useGrouping: false })
  const preview = h('div', { class: 'fp-chart-preview', 'data-chart-preview': '' })
  let frame = 0
  const draw = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => preview.replaceChildren(chartElement(c, chartLook(app.state.doc.attrs.theme as Theme, docLang))))
  }

  // Type
  const kinds = h('div', { class: 'fp-chart-kinds', role: 'radiogroup', 'aria-label': t('chart.kind') })
  const horizontal = h('input', { type: 'checkbox', 'data-field': 'chart-horizontal' }) as HTMLInputElement
  const horizontalRow = h('label', { class: 'fp-check' }, horizontal, h('span', {}, t('chart.horizontal')))
  const setKind = (k: ChartKind) => {
    c.kind = k
    for (const b of Array.from(kinds.children)) b.setAttribute('aria-checked', String((b as HTMLElement).dataset.kind === k))
    horizontalRow.hidden = k !== 'bar'
    pieHint.hidden = k !== 'pie' || c.series.length < 2
    draw()
  }
  for (const k of CHART_KINDS) {
    const b = h('button', { type: 'button', class: 'fp-chart-kind', role: 'radio', 'data-kind': k, 'aria-checked': 'false' }, icon(KIND_ICONS[k]), h('span', {}, t(`chart.kind.${k}` as Key)))
    b.addEventListener('click', () => setKind(k))
    kinds.append(b)
  }
  horizontal.checked = !!c.horizontal
  horizontal.addEventListener('change', () => {
    if (horizontal.checked) c.horizontal = true
    else delete c.horizontal
    draw()
  })
  const pieHint = h('p', { class: 'fp-hint', 'data-chart-pie-hint': '' }, t('chart.pieFirst'))

  // Titre et légende
  const title = h('input', { type: 'text', class: 'fp-input', maxlength: String(CHART_LIMITS.text), value: c.title ?? '', 'data-field': 'chart-title' }) as HTMLInputElement
  title.addEventListener('input', () => {
    const v = title.value.replace(/\s+/g, ' ').trim()
    if (v) c.title = v
    else delete c.title
    draw()
  })
  const legend = h('input', { type: 'checkbox', 'data-field': 'chart-legend' }) as HTMLInputElement
  legend.checked = c.legend !== false
  legend.addEventListener('change', () => {
    if (legend.checked) delete c.legend
    else c.legend = false
    draw()
  })

  // Données : une ligne par étiquette, une colonne par série.
  const grid = h('table', { class: 'fp-chart-grid', 'data-chart-grid': '' })
  const cellInput = (value: string, label: string, set: (v: string, el: HTMLInputElement) => void, attrs: Record<string, string> = {}) => {
    const input = h('input', { type: 'text', class: 'fp-input', value, 'aria-label': label, ...attrs }) as HTMLInputElement
    input.addEventListener('input', () => {
      set(input.value, input)
      draw()
    })
    return input
  }
  const smallBtn = (label: string, run: () => void, attrs: Record<string, string> = {}) => {
    const b = h('button', { type: 'button', class: 'fp-btn fp-btn--small', title: label, 'aria-label': label, ...attrs }, label.startsWith('+') ? '+' : '−')
    b.addEventListener('click', () => {
      run()
      renderGrid()
      draw()
    })
    return b
  }
  const renderGrid = () => {
    const head = h('tr', {}, h('th', { scope: 'col' }, t('chart.labels')))
    c.series.forEach((s, k) =>
      head.append(
        h(
          'th',
          { scope: 'col' },
          cellInput(s.name, t('chart.seriesName', { n: k + 1 }), (v) => (s.name = v.slice(0, CHART_LIMITS.text)), { 'data-series': String(k) }),
          c.series.length > 1 ? smallBtn(`− ${t('chart.removeSeries')}`, () => c.series.splice(k, 1), { 'data-remove-series': String(k) }) : '',
        ),
      ),
    )
    head.append(h('th', {}, c.series.length < CHART_LIMITS.series ? smallBtn(`+ ${t('chart.addSeries')}`, () => c.series.push({ name: `${t('chart.series')} ${c.series.length + 1}`, values: c.labels.map(() => null) }), { 'data-add-series': '' }) : ''))
    const rows = c.labels.map((label, i) => {
      const tr = h('tr', {}, h('th', { scope: 'row' }, cellInput(label, t('chart.label', { n: i + 1 }), (v) => (c.labels[i] = v.slice(0, CHART_LIMITS.text)), { 'data-label': String(i) })))
      c.series.forEach((s, k) => {
        const v = s.values[i]
        tr.append(
          h(
            'td',
            {},
            cellInput(v === null || v === undefined ? '' : fmt.format(v), `${s.name} — ${label}`, (text, el) => {
              const parsed = text.trim() ? parseNumber(text, docLang) : null
              el.toggleAttribute('aria-invalid', !!text.trim() && parsed === null)
              s.values[i] = parsed
            }, { 'data-value': `${i}:${k}`, inputmode: 'decimal' }),
          ),
        )
      })
      tr.append(h('td', {}, c.labels.length > 1 ? smallBtn(`− ${t('chart.removeRow')}`, () => {
        c.labels.splice(i, 1)
        for (const s of c.series) s.values.splice(i, 1)
      }, { 'data-remove-row': String(i) }) : ''))
      return tr
    })
    const add = c.labels.length < CHART_LIMITS.labels
      ? h('tr', {}, h('td', { colspan: String(c.series.length + 2) }, smallBtn(`+ ${t('chart.addRow')}`, () => {
          c.labels.push('')
          for (const s of c.series) s.values.push(null)
        }, { 'data-add-row': '' })))
      : ''
    grid.replaceChildren(h('thead', {}, head), h('tbody', {}, ...rows, add))
    pieHint.hidden = c.kind !== 'pie' || c.series.length < 2
  }
  renderGrid()
  setKind(c.kind)

  openDialog({
    name: 'chart',
    title: t(o.pos === undefined ? 'chart.insertTitle' : 'chart.editTitle'),
    wide: true,
    body: [
      h('div', { class: 'fp-chart-dialog' },
        h('div', { class: 'fp-chart-dialog__side' },
          kinds,
          horizontalRow,
          h('label', { class: 'fp-form__row' }, h('span', { class: 'fp-label' }, t('chart.title')), title),
          h('label', { class: 'fp-check' }, legend, h('span', {}, t('chart.legend'))),
          pieHint,
        ),
        preview,
        h('div', { class: 'fp-chart-dialog__data' }, h('div', { class: 'fp-chart-grid-wrap' }, grid)),
      ),
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t(o.pos === undefined ? 'action.insert' : 'action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          if (!c.series.some((s) => s.values.some((v) => v !== null))) {
            toast(t('chart.empty'), { kind: 'error' })
            return false
          }
          // Étiquettes et noms vides : 1, 2, 3… et « Série n ».
          const out: ChartBlock = { ...c, labels: c.labels.map((l, i) => l.trim() || String(i + 1)), series: c.series.map((s, k) => ({ name: s.name.trim() || `${t('chart.series')} ${k + 1}`, values: [...s.values] })) }
          app.run(o.pos === undefined ? insertChart(out, o.after) : updateChart(o.pos, out))
        },
      },
    ],
  })
}
