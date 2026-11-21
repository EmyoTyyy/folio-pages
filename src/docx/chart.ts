// Graphiques dans les .docx : de vrais graphiques du traitement de texte
// (DrawingML, c:chartSpace), avec leurs valeurs en cache (affichées sans
// calcul) et un petit classeur incorporé pour « Modifier les données ».
// À l'import, un graphique en barres, courbes ou secteurs redevient un
// graphique Folio ; les autres types prennent le plus proche.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { CHART_H, CHART_W } from '../format/chart'
import type { ChartBlock } from '../format/types'
import { attr, child, descendants, escapeXml as esc, kids, textOf, type XmlNode } from './xml'

const C_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'

export interface DocxChart {
  chart: ChartBlock
  /** Couleurs des séries (#rrggbb), police, langue. */
  colors: string[]
  font: string
  lang: string
}

const hex = (c: string) => c.replace('#', '').toUpperCase()
/** Lettre de colonne du classeur (A, B… ; 13 colonnes au plus). */
const col = (i: number) => String.fromCharCode(65 + i)

/** Le dessin à placer dans le paragraphe (EMU : 1 pt = 12 700). */
export function chartRunXml(n: number, widthPt: number, title: string): string {
  const cx = Math.round(widthPt * 12700)
  const cy = Math.round((cx * CHART_H) / CHART_W)
  return `<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:drawing><wp:inline xmlns:wp="${WP_NS}" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${9000 + n}" name="Graphique ${n}"${title ? ` descr="${esc(title)}"` : ''}/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="${A_NS}"><a:graphicData uri="${C_NS}"><c:chart xmlns:c="${C_NS}" xmlns:r="${R_NS}" r:id="rIdFolioChart${n}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
}

/** Valeurs d'une série en cache (une valeur absente n'a pas de point : un trou). */
function numCache(values: (number | null)[], ref: string): string {
  const pts = values.map((v, i) => (v === null || v === undefined ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')
  return `<c:numRef><c:f>${ref}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache></c:numRef>`
}

function strCache(values: string[], ref: string): string {
  return `<c:strRef><c:f>${ref}</c:f><c:strCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef>`
}

const fill = (c: string) => `<a:solidFill><a:srgbClr val="${hex(c)}"/></a:solidFill>`

/** La partie c:chartSpace d'un graphique. */
export function chartSpaceXml(d: DocxChart): string {
  const c = d.chart
  const n = c.labels.length
  const lang = esc(d.lang || 'fr-FR')
  const color = (i: number) => d.colors[i % d.colors.length]
  const ser = (k: number, extra: (k: number) => { before?: string; after?: string } = () => ({})) => {
    const s = c.series[k]
    const e = extra(k)
    return `<c:ser><c:idx val="${k}"/><c:order val="${k}"/><c:tx>${strCache([s.name], `Sheet1!$${col(k + 1)}$1`)}</c:tx>${e.before ?? ''}<c:cat>${strCache(c.labels, `Sheet1!$A$2:$A$${n + 1}`)}</c:cat><c:val>${numCache(s.values, `Sheet1!$${col(k + 1)}$2:$${col(k + 1)}$${n + 1}`)}</c:val>${e.after ?? ''}</c:ser>`
  }
  const axes = (horizontal: boolean) =>
    `<c:catAx><c:axId val="5101"/><c:scaling><c:orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></c:spPr><c:crossAx val="5102"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="5102"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 'b' : 'l'}"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E3E3E3"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:crossAx val="5101"/><c:crosses val="${horizontal ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`
  let plot: string
  if (c.kind === 'pie') {
    const pts = c.labels.map((_, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr>${fill(color(i))}<a:ln w="19050">${fill('#ffffff')}</a:ln></c:spPr></c:dPt>`).join('')
    const labels = `<c:dLbls><c:numFmt formatCode="0%" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100" b="1">${fill('#ffffff')}</a:defRPr></a:pPr><a:endParaRPr lang="${lang}"/></a:p></c:txPr><c:dLblPos val="ctr"/><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="0"/></c:dLbls>`
    plot = `<c:pieChart><c:varyColors val="1"/>${c.series.length ? ser(0, () => ({ before: pts, after: '' })).replace('<c:cat>', `${labels}<c:cat>`) : ''}<c:firstSliceAng val="0"/></c:pieChart>`
  } else if (c.kind === 'line') {
    const series = c.series
      .map((_, k) =>
        ser(k, () => ({
          before: `<c:spPr><a:ln w="28575" cap="rnd">${fill(color(k))}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr>${fill(color(k))}<a:ln><a:noFill/></a:ln></c:spPr></c:marker>`,
          after: '<c:smooth val="0"/>',
        })),
      )
      .join('')
    plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:axId val="5101"/><c:axId val="5102"/></c:lineChart>${axes(false)}`
  } else {
    const series = c.series.map((_, k) => ser(k, () => ({ before: `<c:spPr>${fill(color(k))}</c:spPr><c:invertIfNegative val="0"/>` }))).join('')
    plot = `<c:barChart><c:barDir val="${c.horizontal ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="60"/><c:axId val="5101"/><c:axId val="5102"/></c:barChart>${axes(!!c.horizontal)}`
  }
  const title = c.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="1"/></a:pPr><a:r><a:rPr lang="${lang}" sz="1400" b="1"/><a:t>${esc(c.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>'
  const legend = c.legend !== false && (c.kind === 'pie' || c.series.length > 1) ? `<c:legend><c:legendPos val="${c.kind === 'pie' ? 'r' : 'b'}"/><c:overlay val="0"/></c:legend>` : ''
  const font = esc(d.font)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${C_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}"><c:date1904 val="0"/><c:lang val="${lang}"/><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/>${plot}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"><a:solidFill><a:srgbClr val="404040"/></a:solidFill><a:latin typeface="${font}"/><a:cs typeface="${font}"/></a:defRPr></a:pPr><a:endParaRPr lang="${lang}"/></a:p></c:txPr><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`
}

/** Classeur incorporé : la feuille « Sheet1 » des données (pour les modifier dans un tableur). */
export function chartWorkbook(c: ChartBlock): Uint8Array {
  const cell = (ref: string, v: string | number | null) =>
    v === null || v === '' ? '' : typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
  const rows = [
    `<row r="1">${cell('A1', '')}${c.series.map((s, k) => cell(`${col(k + 1)}1`, s.name)).join('')}</row>`,
    ...c.labels.map((l, i) => `<row r="${i + 2}">${cell(`A${i + 2}`, l)}${c.series.map((s, k) => cell(`${col(k + 1)}${i + 2}`, s.values[i] ?? null)).join('')}</row>`),
  ]
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R_NS}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`),
  }
  return zipSync(files, { level: 6 })
}

/** Ajoute au paquet les parties des graphiques (et leurs classeurs), leurs liens et leurs types. */
export function withCharts(bytes: Uint8Array, charts: DocxChart[]): Uint8Array {
  if (!charts.length) return bytes
  const files = unzipSync(bytes)
  const relsPath = 'word/_rels/document.xml.rels'
  let rels = strFromU8(files[relsPath])
  let types = strFromU8(files['[Content_Types].xml'])
  charts.forEach((d, i) => {
    const n = i + 1
    files[`word/charts/chart${n}.xml`] = strToU8(chartSpaceXml(d))
    files[`word/charts/_rels/chart${n}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/chart_data${n}.xlsx"/></Relationships>`)
    files[`word/embeddings/chart_data${n}.xlsx`] = chartWorkbook(d.chart)
    rels = rels.replace('</Relationships>', () => `<Relationship Id="rIdFolioChart${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart${n}.xml"/></Relationships>`)
    types = types.replace('</Types>', () => `<Override PartName="/word/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`)
  })
  if (!/Extension="xlsx"/i.test(types)) types = types.replace('</Types>', () => '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/></Types>')
  files[relsPath] = strToU8(rels)
  files['[Content_Types].xml'] = strToU8(types)
  return zipSync(files, { level: 6 })
}

// --- import ------------------------------------------------------------------------------

/** Points d'un cache (str, num, ou littéraux) : une valeur par indice, null pour un trou. */
function points(n: XmlNode | undefined): (string | null)[] {
  const cache = n ? (descendants(n, 'c:strCache')[0] ?? descendants(n, 'c:numCache')[0] ?? descendants(n, 'c:strLit')[0] ?? descendants(n, 'c:numLit')[0]) : undefined
  if (!cache) return []
  const count = Math.min(100, Number(attr(child(cache, 'c:ptCount'), 'val') ?? 0) || 0)
  const out: (string | null)[] = Array.from({ length: count }, () => null)
  for (const pt of kids(cache, 'c:pt')) {
    const i = Number(pt.attrs.idx)
    if (Number.isInteger(i) && i >= 0 && i < 100) out[i] = textOf(child(pt, 'c:v'))
  }
  return out
}

/** Un graphique c:chartSpace → bloc graphique (brut, validé ensuite) ; `lose` signale un type approché. */
export function chartFromSpace(root: XmlNode, lose: (code: 'chart-type') => void): Record<string, unknown> | null {
  const chart = child(root, 'c:chart')
  const plot = child(chart, 'c:plotArea')
  if (!plot) return null
  const KINDS: Record<string, 'bar' | 'line' | 'pie'> = { 'c:barChart': 'bar', 'c:bar3DChart': 'bar', 'c:lineChart': 'line', 'c:line3DChart': 'line', 'c:pieChart': 'pie', 'c:pie3DChart': 'pie', 'c:doughnutChart': 'pie', 'c:ofPieChart': 'pie', 'c:areaChart': 'line', 'c:area3DChart': 'line', 'c:scatterChart': 'line', 'c:radarChart': 'line', 'c:stockChart': 'line', 'c:bubbleChart': 'line', 'c:surfaceChart': 'line', 'c:surface3DChart': 'line' }
  const group = plot.children.find((x) => x.name in KINDS)
  if (!group) return null
  const kind = KINDS[group.name]
  if (!/^c:(bar|line|pie)(3D)?Chart$/.test(group.name)) lose('chart-type')
  const sers = kids(group, 'c:ser')
  if (!sers.length) return null
  // Étiquettes : celles de la première série (c:cat, ou c:xVal d'un nuage de points).
  const labels = points(child(sers[0], 'c:cat') ?? child(sers[0], 'c:xVal')).map((l, i) => l ?? String(i + 1))
  const series = sers.slice(0, 12).map((s, k) => {
    const tx = child(s, 'c:tx')
    const name = (points(tx)[0] ?? textOf(child(tx, 'c:v')).trim()) || String(k + 1)
    const values = points(child(s, 'c:val') ?? child(s, 'c:yVal')).map((v) => (v === null || v === '' ? null : Number(v)))
    return { name, values: values.map((v) => (v !== null && Number.isFinite(v) ? v : null)) }
  })
  const n = Math.max(labels.length, ...series.map((s) => s.values.length))
  const title = descendants(child(chart, 'c:title'), 'a:t').map((t) => textOf(t)).join('').trim()
  return {
    type: 'chart',
    kind,
    ...(title ? { title } : {}),
    labels: Array.from({ length: n }, (_, i) => labels[i] ?? String(i + 1)),
    series,
    // Sans légende : à garder seulement si elle se serait vue (secteurs, plusieurs séries).
    ...(child(chart, 'c:legend') || (kind !== 'pie' && series.length < 2) ? {} : { legend: false }),
    ...(kind === 'bar' && attr(child(group, 'c:barDir'), 'val') === 'bar' ? { horizontal: true } : {}),
  }
}
