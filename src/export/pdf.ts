// Écriture d'un fichier PDF (1.7), sans dépendance : pages, texte dans les
// polices standard (Times, Helvetica, Courier, Symbol), tracés, images (JPEG
// tel quel, ou pixels compressés avec transparence), liens, signets (plan),
// métadonnées. Les coordonnées reçues sont en points, origine en haut à gauche.

import { strToU8, zlibSync } from 'fflate'
import { stdWidth } from './pdf-metrics'

export type StdFont = 'Helvetica' | 'Helvetica-Bold' | 'Helvetica-Oblique' | 'Helvetica-BoldOblique' | 'Times-Roman' | 'Times-Bold' | 'Times-Italic' | 'Times-BoldItalic' | 'Courier' | 'Courier-Bold' | 'Courier-Oblique' | 'Courier-BoldOblique' | 'Symbol'

export interface PdfImage {
  /** JPEG : les octets du fichier ; sinon des pixels RGB et une transparence facultative. */
  jpeg?: Uint8Array
  rgb?: Uint8Array
  alpha?: Uint8Array
  width: number
  height: number
}

type Rgb = [number, number, number]

/** WinAnsi : caractères des codes 128 à 159 (le reste est Latin-1). */
const WIN_128 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'
const WIN = new Map<string, number>()
for (let c = 32; c < 256; c++) WIN.set(c >= 128 && c < 160 ? WIN_128[c - 128] : String.fromCharCode(c), c)
WIN.set(' ', 32)
WIN.set('‑', 45)
WIN.set('−', 45)

/** Police Symbol : lettres grecques et signes mathématiques (code dans la police). */
const SYMBOL: Record<string, number> = {}
'αβχδεφγηιϕκλμνοπθρστυϖωξψζ'.split('').forEach((c, i) => (SYMBOL[c] = 'abcdefghijklmnopqrstuvwxyz'.charCodeAt(i)))
'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ'.split('').forEach((c, i) => (SYMBOL[c] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.charCodeAt(i)))
Object.assign(SYMBOL, { '∀': 0x22, '∃': 0x24, '∋': 0x27, '∗': 0x2a, '≅': 0x40, '⊥': 0x5e, '∼': 0x7e, '′': 0xa2, '≤': 0xa3, '∞': 0xa5, '↔': 0xab, '←': 0xac, '↑': 0xad, '→': 0xae, '↓': 0xaf, '″': 0xb2, '≥': 0xb3, '∝': 0xb5, '∂': 0xb6, '≠': 0xb9, '≡': 0xba, '≈': 0xbb, 'ℵ': 0xc0, '⊗': 0xc4, '⊕': 0xc5, '∅': 0xc6, '∩': 0xc7, '∪': 0xc8, '⊃': 0xc9, '⊇': 0xca, '⊄': 0xcb, '⊂': 0xcc, '⊆': 0xcd, '∈': 0xce, '∉': 0xcf, '∠': 0xd0, '∇': 0xd1, '∏': 0xd5, '√': 0xd6, '⋅': 0xd7, '∧': 0xd9, '∨': 0xda, '⇔': 0xdb, '⇐': 0xdc, '⇑': 0xdd, '⇒': 0xde, '⇓': 0xdf, '◊': 0xe0, '〈': 0xe1, '⟨': 0xe1, '∑': 0xe5, '〉': 0xf1, '⟩': 0xf1, '∫': 0xf2, 'ϵ': 0x65, '∣': 0x7c, '∘': 0xb0, '·': 0xd7 })

/** Un texte → morceaux par police (WinAnsi, sinon Symbol, sinon « ? ») ; `missing` compte les « ? ». */
export function encodeRuns(text: string, font: StdFont): { font: StdFont; codes: number[] }[] {
  const out: { font: StdFont; codes: number[] }[] = []
  for (const ch of text) {
    let f: StdFont = font
    let code = WIN.get(ch)
    if (code === undefined) {
      const s = SYMBOL[ch]
      if (s !== undefined) {
        f = 'Symbol'
        code = s
      } else code = 63
    }
    const last = out[out.length - 1]
    if (last && last.font === f) last.codes.push(code)
    else out.push({ font: f, codes: [code] })
  }
  return out
}

/** Largeur d'un morceau (points) dans une police standard. */
export function runWidth(font: StdFont, codes: number[], size: number): number {
  let w = 0
  for (const c of codes) w += stdWidth(font, c) || 500
  return (w / 1000) * size
}

const num = (n: number) => (Math.abs(n) < 1e-4 ? '0' : String(Math.round(n * 1000) / 1000))
const pdfString = (codes: number[]) => {
  let s = '('
  for (const c of codes) s += c === 40 || c === 41 || c === 92 ? `\\${String.fromCharCode(c)}` : c < 32 || c > 126 ? `\\${c.toString(8).padStart(3, '0')}` : String.fromCharCode(c)
  return `${s})`
}
/** Texte de métadonnées ou de signet : UTF-16BE, toujours lisible. */
const pdfText = (s: string) => {
  let hex = 'FEFF'
  for (const ch of s.slice(0, 500)) {
    const c = ch.codePointAt(0)!
    if (c > 0xffff) {
      const v = c - 0x10000
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0')
    } else hex += c.toString(16).padStart(4, '0')
  }
  return `<${hex.toUpperCase()}>`
}

export class PdfPage {
  ops: string[] = []
  links: { x: number; y: number; w: number; h: number; uri: string }[] = []
  fonts = new Set<StdFont>()
  images = new Set<number>()
  states = new Set<string>()
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  private y(v: number) {
    return this.height - v
  }

  /** Opacité de remplissage ou de trait (0 à 1), par un état graphique. */
  opacity(fill: number, stroke = fill): void {
    if (fill >= 0.999 && stroke >= 0.999) return
    const key = `${num(fill)}_${num(stroke)}`
    this.states.add(key)
    this.ops.push(`/GS${key.replace(/\./g, 'd')} gs`)
  }

  save(): void {
    this.ops.push('q')
  }
  restore(): void {
    this.ops.push('Q')
  }

  clip(x: number, y: number, w: number, h: number): void {
    this.ops.push(`${num(x)} ${num(this.y(y + h))} ${num(w)} ${num(h)} re W n`)
  }

  fillRect(x: number, y: number, w: number, h: number, c: Rgb): void {
    this.ops.push(`${c.map((v) => num(v / 255)).join(' ')} rg ${num(x)} ${num(this.y(y + h))} ${num(w)} ${num(h)} re f`)
  }

  line(x1: number, y1: number, x2: number, y2: number, width: number, c: Rgb, dash?: number[]): void {
    this.ops.push(`${c.map((v) => num(v / 255)).join(' ')} RG ${num(width)} w ${dash ? `[${dash.map(num).join(' ')}] 0 d` : '[] 0 d'} ${num(x1)} ${num(this.y(y1))} m ${num(x2)} ${num(this.y(y2))} l S`)
  }

  /** Tracé (points en haut-gauche) : relié, trait arrondi. */
  polyline(points: number[], width: number, c: Rgb, cap: 0 | 1 | 2 = 1): void {
    if (points.length < 4) return
    let d = `${num(points[0])} ${num(this.y(points[1]))} m`
    for (let i = 2; i + 1 < points.length; i += 2) d += ` ${num(points[i])} ${num(this.y(points[i + 1]))} l`
    this.ops.push(`${c.map((v) => num(v / 255)).join(' ')} RG ${num(width)} w ${cap} J 1 j [] 0 d ${d} S`)
  }

  /**
   * Texte posé sur sa ligne de base (x, baseline) ; `width` (points), s'il est
   * donné, est la largeur mesurée à l'écran : le texte y est ajusté.
   */
  text(text: string, x: number, baseline: number, size: number, font: StdFont, color: Rgb, width?: number, angle = 0): void {
    const runs = encodeRuns(text, font)
    const natural = runs.reduce((s, r) => s + runWidth(r.font, r.codes, size), 0)
    const scale = width && natural > 0 ? Math.max(40, Math.min(250, (width / natural) * 100)) : 100
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    let ops = `BT ${color.map((v) => num(v / 255)).join(' ')} rg ${num(scale)} Tz ${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(x)} ${num(this.y(baseline))} Tm`
    for (const r of runs) {
      this.fonts.add(r.font)
      ops += ` /${fontKey(r.font)} ${num(size)} Tf ${pdfString(r.codes)} Tj`
    }
    this.ops.push(`${ops} ET`)
  }

  image(id: number, x: number, y: number, w: number, h: number): void {
    this.images.add(id)
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.y(y + h))} cm /Im${id} Do Q`)
  }

  link(x: number, y: number, w: number, h: number, uri: string): void {
    this.links.push({ x, y: this.y(y + h), w, h, uri })
  }
}

const fontKey = (f: StdFont) => `F${f.replace(/-/g, '')}`

export interface PdfInfo {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  lang?: string
}

export class PdfWriter {
  pages: PdfPage[] = []
  private images: PdfImage[] = []
  private outline: { title: string; page: number; y: number; level: number }[] = []

  addPage(width: number, height: number): PdfPage {
    const p = new PdfPage(width, height)
    this.pages.push(p)
    return p
  }

  addImage(img: PdfImage): number {
    this.images.push(img)
    return this.images.length - 1
  }

  bookmark(title: string, page: number, y: number, level: number): void {
    this.outline.push({ title, page, y, level })
  }

  /** Le fichier : objets numérotés, table de références croisées, en-tête et fin. */
  output(info: PdfInfo = {}): Uint8Array {
    const objects: (Uint8Array | string)[] = []
    const add = (o: Uint8Array | string) => objects.push(o) // numéro = longueur
    const ref = (n: number) => `${n} 0 R`
    const stream = (dict: string, data: Uint8Array, compress = true) => {
      const body = compress ? zlibSync(data) : data
      const head = strToU8(`<< ${dict}${compress ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>\nstream\n`)
      const tail = strToU8('\nendstream')
      const out = new Uint8Array(head.length + body.length + tail.length)
      out.set(head)
      out.set(body, head.length)
      out.set(tail, head.length + body.length)
      return out
    }
    add('') // 1 : catalogue (rempli à la fin)
    add('') // 2 : arbre des pages
    // Polices.
    const fonts = new Map<StdFont, number>()
    for (const p of this.pages) for (const f of p.fonts) fonts.set(f, 0)
    for (const f of fonts.keys()) {
      // Largeurs explicites : tous les lecteurs avancent pareil (espaces compris).
      const widths = Array.from({ length: 224 }, (_, i) => stdWidth(f, i + 32) || (f === 'Symbol' ? 500 : 0))
      add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f}${f === 'Symbol' ? '' : ' /Encoding /WinAnsiEncoding'} /FirstChar 32 /LastChar 255 /Widths [${widths.join(' ')}] >>`)
      fonts.set(f, objects.length)
    }
    // Images (et leur masque de transparence).
    const imageIds: number[] = []
    for (const img of this.images) {
      let smask = ''
      if (img.alpha) {
        add(stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8`, img.alpha))
        smask = ` /SMask ${ref(objects.length)}`
      }
      if (img.jpeg) add(stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode${smask}`, img.jpeg, false).slice())
      else add(stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${smask}`, img.rgb ?? new Uint8Array(img.width * img.height * 3)))
      imageIds.push(objects.length)
    }
    // Pages.
    const pageIds: number[] = []
    for (const p of this.pages) {
      add(stream('', strToU8(p.ops.join('\n'))))
      const content = objects.length
      const annots: number[] = []
      for (const l of p.links) {
        add(`<< /Type /Annot /Subtype /Link /Rect [${[l.x, l.y, l.x + l.w, l.y + l.h].map(num).join(' ')}] /Border [0 0 0] /A << /S /URI /URI (${uriText(l.uri)}) >> >>`)
        annots.push(objects.length)
      }
      const fontsDict = [...p.fonts].map((f) => `/${fontKey(f)} ${ref(fonts.get(f)!)}`).join(' ')
      const xobj = [...p.images].map((i) => `/Im${i} ${ref(imageIds[i])}`).join(' ')
      const gs = [...p.states].map((k) => {
        const [fill, stroke] = k.split('_')
        return `/GS${k.replace(/\./g, 'd')} << /Type /ExtGState /ca ${fill} /CA ${stroke} >>`
      })
      add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.width)} ${num(p.height)}] /Contents ${ref(content)} /Resources << /Font << ${fontsDict} >> /XObject << ${xobj} >> /ExtGState << ${gs.join(' ')} >> >>${annots.length ? ` /Annots [${annots.map(ref).join(' ')}]` : ''} >>`)
      pageIds.push(objects.length)
    }
    objects[1] = `<< /Type /Pages /Kids [${pageIds.map(ref).join(' ')}] /Count ${pageIds.length} >>`
    // Plan (signets) : les titres, imbriqués par niveau.
    let outlineRef = ''
    if (this.outline.length) {
      add('')
      const root = objects.length
      const ids = this.outline.map(() => {
        add('')
        return objects.length
      })
      const parentOf: number[] = []
      const stack: { level: number; idx: number }[] = []
      this.outline.forEach((o, i) => {
        while (stack.length && stack[stack.length - 1].level >= o.level) stack.pop()
        parentOf[i] = stack.length ? stack[stack.length - 1].idx : -1
        stack.push({ level: o.level, idx: i })
      })
      const children = (p: number) => this.outline.map((_, i) => i).filter((i) => parentOf[i] === p)
      const fill = (i: number) => {
        const o = this.outline[i]
        const sib = children(parentOf[i])
        const k = sib.indexOf(i)
        const kids = children(i)
        const page = this.pages[o.page]
        objects[ids[i] - 1] = `<< /Title ${pdfText(o.title)} /Parent ${ref(parentOf[i] < 0 ? root : ids[parentOf[i]])}${k > 0 ? ` /Prev ${ref(ids[sib[k - 1]])}` : ''}${k < sib.length - 1 ? ` /Next ${ref(ids[sib[k + 1]])}` : ''}${kids.length ? ` /First ${ref(ids[kids[0]])} /Last ${ref(ids[kids[kids.length - 1]])} /Count ${-kids.length}` : ''} /Dest [${ref(pageIds[o.page])} /XYZ 0 ${num(page.height - o.y)} 0] >>`
      }
      this.outline.forEach((_, i) => fill(i))
      const top = children(-1)
      objects[root - 1] = `<< /Type /Outlines /First ${ref(ids[top[0]])} /Last ${ref(ids[top[top.length - 1]])} /Count ${top.length} >>`
      outlineRef = ` /Outlines ${ref(root)} /PageMode /UseOutlines`
    }
    objects[0] = `<< /Type /Catalog /Pages 2 0 R${outlineRef}${info.lang ? ` /Lang ${pdfText(info.lang)}` : ''} >>`
    const d = new Date()
    const date = `D:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}Z`
    add(`<< /Producer (Folio Pages) /Creator (Folio Pages) /CreationDate (${date})${info.title ? ` /Title ${pdfText(info.title)}` : ''}${info.author ? ` /Author ${pdfText(info.author)}` : ''}${info.subject ? ` /Subject ${pdfText(info.subject)}` : ''}${info.keywords ? ` /Keywords ${pdfText(info.keywords)}` : ''} >>`)
    const infoId = objects.length
    // Assemblage, positions des objets, table xref.
    const chunks: Uint8Array[] = [strToU8('%PDF-1.7\n%âãÏÓ\n')]
    let offset = chunks[0].length
    const offsets: number[] = []
    objects.forEach((o, i) => {
      offsets.push(offset)
      const head = strToU8(`${i + 1} 0 obj\n`)
      const body = typeof o === 'string' ? strToU8(o) : o
      const tail = strToU8('\nendobj\n')
      chunks.push(head, body, tail)
      offset += head.length + body.length + tail.length
    })
    const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`
    chunks.push(strToU8(xref))
    const total = chunks.reduce((s, c) => s + c.length, 0)
    const out = new Uint8Array(total)
    let at = 0
    for (const c of chunks) {
      out.set(c, at)
      at += c.length
    }
    return out
  }
}

/** Adresse d'un lien : ASCII (caractères non ASCII encodés), parenthèses échappées. */
function uriText(uri: string): string {
  let s: string
  try {
    s = encodeURI(decodeURI(uri))
  } catch {
    s = encodeURI(uri)
  }
  return s.replace(/[()\\]/g, (c) => `\\${c}`)
}
