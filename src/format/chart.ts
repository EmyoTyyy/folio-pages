// Graphiques : barres (verticales ou horizontales), courbes, secteurs.
// Un graphique garde ses propres données (étiquettes et séries), tirées d'un
// tableau à sa création. Le dessin est un SVG fait ici, sans bibliothèque :
// le même pour l'éditeur, la page web, l'EPUB, le PDF et l'.odt.

import { cssFont } from '../editor/css'
import type { ChartBlock, ChartSeries, FolioDoc, Theme } from './types'

export const CHART_LIMITS = { labels: 100, series: 12, text: 100 }
/** Texte de remplacement d'une image qui porte les données d'un graphique (.odt, .docx de repli). */
export const CHART_ALT = 'folio-chart:'

/** Taille du dessin (unités du viewBox) : 16 sur 10. */
export const CHART_W = 640
export const CHART_H = 400

/**
 * Un nombre écrit dans une cellule : « 1 200 », « 1 200,50 € », « 12 % », « -3.5 », « 1,234.5 », « (40) ».
 * Les deux séparateurs : le dernier est décimal. Une virgule seule est décimale, sauf en anglais devant
 * des groupes de trois chiffres ; un point seul est décimal, sauf dans les langues où il groupe les milliers.
 */
export function parseNumber(s: string, lang = 'fr'): number | null {
  let t = s.replace(/[\s\u00a0\u202f']/g, '').replace(/[€$£¥%‰]|EUR|USD|CHF/gi, '')
  const neg = /^\(.*\)$/.test(t)
  if (neg) t = t.slice(1, -1)
  t = t.replace(/^\+/, '').replace(/^[−–]/, '-')
  if (!/^-?[\d.,]+$/.test(t) || !/\d/.test(t)) return null
  const commas = (t.match(/,/g) ?? []).length
  const dots = (t.match(/\./g) ?? []).length
  const groups = (sep: string) => new RegExp(`^-?\\d{1,3}(\\${sep}\\d{3})+$`).test(t)
  if (commas && dots) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  else if (commas) t = commas > 1 || (/^en\b/i.test(lang) && groups(',')) ? t.replace(/,/g, '') : t.replace(',', '.')
  else if (dots > 1 || (/^(de|es|it|nl|pt|da|id|tr)\b/i.test(lang) && groups('.'))) t = t.replace(/\./g, '')
  const n = Number(t)
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

/**
 * Données d'un graphique depuis les lignes d'un tableau : la première ligne nomme les séries,
 * la première colonne donne les étiquettes. Une colonne sans aucun nombre n'est pas une série.
 */
export function chartFromRows(rows: string[][], lang = 'fr'): { labels: string[]; series: ChartSeries[] } | null {
  const body = rows.slice(1, CHART_LIMITS.labels + 1)
  const head = rows[0] ?? []
  const width = Math.max(0, ...rows.map((r) => r.length))
  if (!body.length || width < 2) return null
  const clip = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, CHART_LIMITS.text)
  const series: ChartSeries[] = []
  for (let c = 1; c < width && series.length < CHART_LIMITS.series; c++) {
    const values = body.map((r) => parseNumber(r[c] ?? '', lang))
    if (values.every((v) => v === null)) continue
    series.push({ name: clip(head[c] ?? '') || `${c}`, values })
  }
  if (!series.length) return null
  return { labels: body.map((r) => clip(r[0] ?? '')), series }
}

/** Graduations « rondes » (1, 2, 5 × 10ⁿ) couvrant [min, max]. */
export function niceScale(min: number, max: number, count = 5): { min: number; max: number; step: number; ticks: number[] } {
  if (!(max > min)) {
    const d = Math.abs(max) || 1
    min -= d / 2
    max += d / 2
  }
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((k) => k * mag >= raw) ?? 10) * mag
  const lo = Math.floor(min / step + 1e-9) * step
  const hi = Math.ceil(max / step - 1e-9) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : Number(v.toPrecision(12)))
  return { min: lo, max: hi, step, ticks }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const f = (n: number) => (Math.round(n * 10) / 10).toString()

export interface ChartLook {
  /** Couleurs des séries (ou des secteurs). */
  colors: string[]
  /** Couleur du texte et des axes. */
  text: string
  /** Police (pile CSS). */
  font: string
  /** Langue des nombres. */
  lang: string
}

/** Largeur approchée d'un texte (le dessin se fait sans mesurer). */
const textWidth = (s: string, size: number) => [...s].length * size * 0.56

/** Coupe un texte trop long pour sa place, avec « … ». */
function fit(s: string, size: number, width: number): string {
  if (textWidth(s, size) <= width) return s
  const n = Math.max(1, Math.floor(width / (size * 0.56)) - 1)
  return [...s].slice(0, n).join('') + '…'
}

/** Le graphique en SVG (texte échappé : les étiquettes viennent du document). */
export function chartSvg(c: ChartBlock, look: ChartLook): string {
  const W = CHART_W
  const H = CHART_H
  const fmt = new Intl.NumberFormat(look.lang || 'fr', { maximumFractionDigits: 2 })
  const color = (i: number) => look.colors[i % look.colors.length]
  const out: string[] = []
  const text = (x: number, y: number, s: string, o: { size?: number; anchor?: string; weight?: number; fill?: string; rotate?: number; baseline?: string } = {}) =>
    `<text x="${f(x)}" y="${f(y)}" font-size="${o.size ?? 12}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}${o.baseline ? ` dominant-baseline="${o.baseline}"` : ''} fill="${o.fill ?? look.text}"${o.rotate ? ` transform="rotate(${o.rotate} ${f(x)} ${f(y)})"` : ''}>${esc(s)}</text>`
  let top = 14
  if (c.title) {
    out.push(text(W / 2, 30, fit(c.title, 17, W - 40), { size: 17, anchor: 'middle', weight: 600 }))
    top = 48
  }
  const pie = c.kind === 'pie'
  const legendItems = pie ? c.labels : c.series.map((s) => s.name)
  const showLegend = c.legend !== false && (pie || c.series.length > 1)
  let bottom = H - 12
  let right = W - 16
  if (showLegend && !pie) {
    // Légende sous le graphique, sur une ou plusieurs lignes.
    const rows: { name: string; i: number; x: number }[][] = [[]]
    let x = 0
    legendItems.forEach((name, i) => {
      const label = fit(name, 12, 180)
      const w = 18 + textWidth(label, 12) + 18
      if (x + w > W - 40 && rows[rows.length - 1].length) {
        rows.push([])
        x = 0
      }
      rows[rows.length - 1].push({ name: label, i, x })
      x += w
    })
    rows.slice(0, 3).forEach((row, r) => {
      const width = row.reduce((a, it) => a + 18 + textWidth(it.name, 12) + 18, 0) - 18
      const x0 = (W - width) / 2
      const y = H - 14 - (Math.min(rows.length, 3) - 1 - r) * 20
      for (const it of row) {
        out.push(`<rect x="${f(x0 + it.x)}" y="${f(y - 10)}" width="12" height="12" rx="2" fill="${color(it.i)}"/>`)
        out.push(text(x0 + it.x + 18, y, it.name))
      }
    })
    bottom = H - 14 - Math.min(rows.length, 3) * 20 - 6
  }
  if (pie) {
    const values = c.labels.map((_, i) => Math.max(0, c.series[0]?.values[i] ?? 0))
    const total = values.reduce((a, b) => a + b, 0)
    if (showLegend) {
      const lw = Math.min(220, Math.max(...legendItems.map((n) => textWidth(fit(n, 12, 180), 12))) + 30)
      right = W - 16 - lw
      const n = Math.min(legendItems.length, Math.floor((H - top - 20) / 20))
      const y0 = top + (H - top - 12 - n * 20) / 2 + 12
      legendItems.slice(0, n).forEach((name, i) => {
        out.push(`<rect x="${f(right + 14)}" y="${f(y0 + i * 20 - 10)}" width="12" height="12" rx="2" fill="${color(i)}"/>`)
        out.push(text(right + 32, y0 + i * 20, fit(name, 12, 180)))
      })
    }
    const cx = (16 + right) / 2
    const cy = (top + bottom) / 2
    const r = Math.max(20, Math.min(right - 16, bottom - top) / 2 - 4)
    if (!(total > 0)) out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${look.text}" stroke-opacity="0.25" stroke-width="2"/>`)
    else {
      let a = -Math.PI / 2
      values.forEach((v, i) => {
        if (!(v > 0)) return
        const share = v / total
        const b = a + share * Math.PI * 2
        if (share >= 0.9999) out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${color(i)}"/>`)
        else {
          const large = b - a > Math.PI ? 1 : 0
          out.push(`<path d="M${f(cx)} ${f(cy)}L${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}A${f(r)} ${f(r)} 0 ${large} 1 ${f(cx + r * Math.cos(b))} ${f(cy + r * Math.sin(b))}Z" fill="${color(i)}" stroke="#ffffff" stroke-width="1.5"/>`)
        }
        // Pourcentage dans le secteur, s'il y a la place.
        if (share >= 0.05) {
          const m = (a + b) / 2
          const pct = share * 100
          out.push(text(cx + r * 0.62 * Math.cos(m), cy + r * 0.62 * Math.sin(m), `${new Intl.NumberFormat(look.lang || 'fr', { maximumFractionDigits: pct < 10 ? 1 : 0 }).format(pct)} %`, { anchor: 'middle', baseline: 'middle', fill: '#ffffff', weight: 600 }))
        }
        a = b
      })
    }
    return wrap(c, look, out)
  }

  // Barres et courbes : axe des valeurs et axe des étiquettes.
  const all = c.series.flatMap((s) => s.values).filter((v): v is number => typeof v === 'number')
  let lo = Math.min(...all, c.kind === 'bar' ? 0 : Infinity)
  let hi = Math.max(...all, c.kind === 'bar' ? 0 : -Infinity)
  if (!all.length) [lo, hi] = [0, 1]
  const scale = niceScale(lo, hi)
  const tickLabels = scale.ticks.map((v) => fmt.format(v))
  const horizontal = c.kind === 'bar' && !!c.horizontal
  const n = Math.max(1, c.labels.length)
  if (!horizontal) {
    const left = 16 + Math.max(...tickLabels.map((s) => textWidth(s, 11))) + 8
    const slot = (right - left) / n
    // Étiquettes penchées quand elles ne tiennent pas droites.
    const longest = Math.max(0, ...c.labels.map((l) => textWidth(l, 11)))
    const tilt = longest > slot - 6
    const labelH = tilt ? Math.min(90, longest * 0.6 + 14) : 20
    const plotBottom = bottom - labelH
    const y = (v: number) => plotBottom - ((v - scale.min) / (scale.max - scale.min)) * (plotBottom - top)
    scale.ticks.forEach((v, i) => {
      out.push(`<line x1="${f(left)}" x2="${f(right)}" y1="${f(y(v))}" y2="${f(y(v))}" stroke="${look.text}" stroke-opacity="${v === 0 ? 0.55 : 0.14}" stroke-width="1"/>`)
      out.push(text(left - 8, y(v), tickLabels[i], { size: 11, anchor: 'end', baseline: 'middle' }))
    })
    c.labels.forEach((l, i) => {
      const x = left + slot * (i + 0.5)
      if (tilt) out.push(text(x, plotBottom + 14, fit(l, 11, 120), { size: 11, anchor: 'end', rotate: -35 }))
      else out.push(text(x, plotBottom + 16, fit(l, 11, slot - 4), { size: 11, anchor: 'middle' }))
    })
    if (c.kind === 'bar') {
      const group = slot * 0.78
      const bw = group / Math.max(1, c.series.length)
      const zero = y(Math.max(scale.min, Math.min(scale.max, 0)))
      c.series.forEach((s, k) =>
        s.values.forEach((v, i) => {
          if (v === null || i >= n) return
          const x = left + slot * i + (slot - group) / 2 + k * bw
          const yv = y(v)
          out.push(`<rect x="${f(x + 0.5)}" y="${f(Math.min(yv, zero))}" width="${f(Math.max(1, bw - 1))}" height="${f(Math.abs(zero - yv))}" fill="${color(k)}"/>`)
        }),
      )
    } else {
      c.series.forEach((s, k) => {
        // Une valeur manquante coupe la courbe.
        let d = ''
        let pen = false
        s.values.forEach((v, i) => {
          if (v === null || i >= n) {
            pen = false
            return
          }
          d += `${pen ? 'L' : 'M'}${f(left + slot * (i + 0.5))} ${f(y(v))}`
          pen = true
        })
        if (d) out.push(`<path d="${d}" fill="none" stroke="${color(k)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`)
        s.values.forEach((v, i) => {
          if (v !== null && i < n) out.push(`<circle cx="${f(left + slot * (i + 0.5))}" cy="${f(y(v))}" r="3.5" fill="${color(k)}"/>`)
        })
      })
    }
  } else {
    // Barres horizontales : étiquettes à gauche, valeurs en bas.
    const left = 16 + Math.min(160, Math.max(0, ...c.labels.map((l) => textWidth(l, 11)))) + 10
    const plotBottom = bottom - 20
    const slot = (plotBottom - top) / n
    const x = (v: number) => left + ((v - scale.min) / (scale.max - scale.min)) * (right - left)
    scale.ticks.forEach((v, i) => {
      out.push(`<line x1="${f(x(v))}" x2="${f(x(v))}" y1="${f(top)}" y2="${f(plotBottom)}" stroke="${look.text}" stroke-opacity="${v === 0 ? 0.55 : 0.14}" stroke-width="1"/>`)
      out.push(text(x(v), plotBottom + 16, tickLabels[i], { size: 11, anchor: 'middle' }))
    })
    c.labels.forEach((l, i) => out.push(text(left - 8, top + slot * (i + 0.5), fit(l, 11, left - 26), { size: 11, anchor: 'end', baseline: 'middle' })))
    const group = slot * 0.78
    const bh = group / Math.max(1, c.series.length)
    const zero = x(Math.max(scale.min, Math.min(scale.max, 0)))
    c.series.forEach((s, k) =>
      s.values.forEach((v, i) => {
        if (v === null || i >= n) return
        const yy = top + slot * i + (slot - group) / 2 + k * bh
        const xv = x(v)
        out.push(`<rect x="${f(Math.min(xv, zero))}" y="${f(yy + 0.5)}" width="${f(Math.abs(xv - zero))}" height="${f(Math.max(1, bh - 1))}" fill="${color(k)}"/>`)
      }),
    )
  }
  return wrap(c, look, out)
}

function wrap(c: ChartBlock, look: ChartLook, body: string[]): string {
  const label = c.title || (c.kind === 'pie' ? c.series[0]?.name : c.series.map((s) => s.name).join(', ')) || 'chart'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CHART_W} ${CHART_H}" role="img" aria-label="${esc(label)}" font-family="${esc(look.font)}"><title>${esc(label)}</title>${body.join('')}</svg>`
}

/** Les données en lignes de tableau (export Markdown et texte, données perdues ailleurs). */
export function chartRows(c: ChartBlock, lang = 'fr'): string[][] {
  const fmt = new Intl.NumberFormat(lang || 'fr', { maximumFractionDigits: 6, useGrouping: false })
  return [['', ...c.series.map((s) => s.name)], ...c.labels.map((l, i) => [l, ...c.series.map((s) => (s.values[i] === null || s.values[i] === undefined ? '' : fmt.format(s.values[i] as number)))])]
}


/** Couleurs (accents du thème) et police (celle du texte) d'un thème. */
export function chartLook(theme: Theme, lang: string): ChartLook {
  const c = theme.colors
  return { colors: [c.accent1, c.accent2, c.accent3, c.accent4, c.accent5, c.accent6], text: c.text, font: cssFont(theme.fonts.body), lang: lang || 'fr' }
}

/** Couleurs et police d'un document, pour les exports. */
export const chartLookOf = (doc: FolioDoc): ChartLook => chartLook(doc.theme, doc.meta.lang)
