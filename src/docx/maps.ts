// Correspondances entre le format Folio Pages et WordprocessingML (.docx),
// communes à l'import et à l'export : unités, styles, couleurs, formats.

import { HIGHLIGHT_VALUES } from '../format/color'
import type { NoteFormat, PageNumberFormat, TableStyle, Theme } from '../format/types'

// --- unités ---------------------------------------------------------------------

/** Points → twips (vingtièmes de point). */
export const twips = (pt: number): number => Math.round(pt * 20)
/** Twips → points, arrondi au centième. */
export const ptOfTwips = (tw: number): number => Math.round(tw * 5) / 100
/** Millimètres → twips. */
export const twipsOfMm = (mm: number): number => Math.round((mm * 1440) / 25.4)
/** Twips → millimètres, arrondi au dixième. */
export const mmOfTwips = (tw: number): number => Math.round((tw * 25.4) / 144) / 10
/** EMU (unité des dessins) → points. */
export const ptOfEmu = (emu: number): number => Math.round((emu / 12700) * 100) / 100
/** Points → pixels (96 par pouce), l'unité des images pour la bibliothèque d'export. */
export const pxOfPt = (pt: number): number => (pt * 96) / 72

/**
 * Interligne. Folio Pages compte en multiple de la taille du texte (comme le
 * CSS) ; un traitement de texte compte en multiple de la hauteur de ligne de la
 * police, qui vaut environ 1,2 fois sa taille. « Simple » là-bas (1) vaut donc
 * 1,2 ici.
 */
export const LINE_FACTOR = 1.2
/** Interligne Folio → w:line (240 = simple). */
export const lineToWord = (line: number): number => Math.max(120, Math.round((line / LINE_FACTOR) * 240))
/** w:line (règle « auto ») → interligne Folio, arrondi au centième. */
export const lineFromWord = (line: number): number => Math.round((line / 240) * LINE_FACTOR * 100) / 100

// --- styles ---------------------------------------------------------------------

/** Styles intégrés de Folio Pages → identifiant et nom du style équivalent. */
export const STYLE_IDS: Record<string, { id: string; name: string }> = {
  normal: { id: 'Normal', name: 'Normal' },
  title: { id: 'Title', name: 'Title' },
  subtitle: { id: 'Subtitle', name: 'Subtitle' },
  heading1: { id: 'Heading1', name: 'heading 1' },
  heading2: { id: 'Heading2', name: 'heading 2' },
  heading3: { id: 'Heading3', name: 'heading 3' },
  heading4: { id: 'Heading4', name: 'heading 4' },
  heading5: { id: 'Heading5', name: 'heading 5' },
  heading6: { id: 'Heading6', name: 'heading 6' },
  quote: { id: 'Quote', name: 'Quote' },
  code: { id: 'SourceCode', name: 'Source Code' },
  caption: { id: 'Caption', name: 'caption' },
  footnote: { id: 'FootnoteText', name: 'footnote text' },
}

/** Identifiant du style de caractères « code en ligne ». */
export const INLINE_CODE_STYLE = 'InlineCode'

/**
 * Style intégré de Folio Pages qui correspond à un style de paragraphe, d'après
 * son nom (les identifiants sont traduits d'une langue à l'autre, les noms
 * internes ne le sont pas) ; null pour un style sans équivalent.
 */
export function builtinOfStyleName(name: string, id: string): string | null {
  const s = name.trim().toLowerCase()
  const i = id.trim().toLowerCase()
  const h = /^(?:heading|titre|überschrift|título|titolo)\s*([1-9])$/.exec(s) ?? /^(?:heading|titre)([1-9])$/.exec(i)
  if (h) return Number(h[1]) <= 6 ? `heading${h[1]}` : null
  if (s === 'normal' || s === 'standard' || s === 'default paragraph style' || i === 'normal') return 'normal'
  if (s === 'title' || i === 'title') return 'title'
  if (s === 'subtitle' || i === 'subtitle') return 'subtitle'
  if (/^(quote|intense quote|block text|quotations|bloc de citation|citation|citation intense|citations|zitat)$/.test(s) || i === 'quote') return 'quote'
  if (s === 'caption' || i === 'caption') return 'caption'
  if (s === 'footnote text' || s === 'endnote text' || s === 'footnote' || s === 'endnote') return 'footnote'
  if (/^(source code|code|html preformatted|preformatted text|texte préformaté|macro text|plain text|code block)$/.test(s) || i === 'sourcecode') return 'code'
  return null
}

/** Familles à chasse fixe courantes : un style qui en utilise une est du code. */
export const isMonoFont = (f: string): boolean => /mono|courier|consolas|menlo|fira code|source code|lucida console|cascadia/i.test(f)

/** Identifiant de style acceptable pour Folio Pages à partir d'un identifiant quelconque. */
export function styleKey(id: string): string {
  let s = id.normalize('NFKD').replace(/[^A-Za-z0-9_-]/g, '')
  if (!/^[A-Za-z]/.test(s)) s = `s${s}`
  return s.slice(0, 64)
}

// --- couleurs -------------------------------------------------------------------

/** « #rrggbb » → « RRGGBB ». */
export const hexOf = (c: string): string => c.replace('#', '').toUpperCase()

/** Valeur d'attribut de couleur → « #rrggbb », ou null (« auto », valeur invalide). */
export function colorOf(v: string | undefined): string | null {
  if (!v) return null
  const s = v.trim()
  return /^[0-9a-fA-F]{6}$/.test(s) ? `#${s.toLowerCase()}` : null
}

/** Mélange d'une couleur avec du blanc (part de la couleur de 0 à 1) : les fonds légers des tableaux. */
export function tint(hex: string, part: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const mix = (c: number) => Math.round(c * part + 255 * (1 - part))
  const r = mix((n >> 16) & 255)
  const g = mix((n >> 8) & 255)
  const b = mix(n & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

/** Surligneurs nommés d'un traitement de texte → surlignage Folio Pages. */
export const HIGHLIGHT_FROM_WORD: Record<string, string> = {
  yellow: 'yellow',
  green: 'green',
  cyan: 'cyan',
  magenta: 'pink',
  blue: 'blue',
  red: 'red',
  darkYellow: 'orange',
  darkMagenta: 'purple',
  lightGray: 'gray',
  darkGray: 'gray',
  darkBlue: 'blue',
  darkCyan: 'cyan',
  darkGreen: 'green',
  darkRed: 'red',
  black: '#000000',
  white: '#ffffff',
}

/** Fond d'un surlignage Folio Pages (les surligneurs nommés ont leur valeur d'affichage). */
export const highlightFill = (h: string): string => (Object.prototype.hasOwnProperty.call(HIGHLIGHT_VALUES, h) ? HIGHLIGHT_VALUES[h] : h)

/** Fond lu dans un fichier → surligneur nommé s'il en a la valeur, sinon la couleur. */
export function highlightOfFill(hex: string): string {
  for (const k of Object.keys(HIGHLIGHT_VALUES)) if (HIGHLIGHT_VALUES[k] === hex) return k
  return hex
}

/** Couleurs du thème : nom Folio Pages ⇄ nom dans un thème de traitement de texte. */
export const THEME_COLOR_TO_WORD: Record<string, string> = {
  text: 'text1',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
}
export const THEME_COLOR_FROM_WORD: Record<string, string> = {
  text1: 'text',
  dark1: 'text',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
}

// --- tableaux -------------------------------------------------------------------

/** Identifiant de style de tableau écrit à l'export, pour reconnaître nos propres fichiers. */
export const tableStyleId = (s: TableStyle): string => `Folio${s[0].toUpperCase()}${s.slice(1)}`
export const tableStyleOfId = (id: string | undefined): TableStyle | null => {
  const m = /^Folio(Grid|Lines|Zebra|Boxed|Minimal)$/.exec(id ?? '')
  return m ? (m[1].toLowerCase() as TableStyle) : null
}

export interface TableLook {
  /** Traits : épaisseur en huitièmes de point, 0 = aucun. Bords du haut et du bas, puis de gauche et de droite. */
  outerH: number
  outerV: number
  insideH: number
  insideV: number
  color: string
  outerColor: string
  /** Fond de la ligne d'en-tête, ou null. */
  headerFill: string | null
  headerColor: string | null
  /** Trait sous l'en-tête (huitièmes de point), 0 = celui du style. */
  headerRule: number
  /** Fond d'une ligne sur deux, ou null. */
  bandFill: string | null
}

/** L'apparence d'un style rapide de tableau, avec les couleurs du thème (comme la feuille de style de l'application). */
export function tableLook(style: TableStyle, theme: Theme, border?: string): TableLook {
  const accent = theme.colors.accent1
  const line = border ?? tint(theme.colors.text, 0.32)
  switch (style) {
    case 'lines':
      return { outerH: 4, outerV: 0, insideH: 4, insideV: 0, color: line, outerColor: line, headerFill: null, headerColor: null, headerRule: 12, bandFill: null }
    case 'zebra':
      return { outerH: 0, outerV: 0, insideH: 0, insideV: 0, color: line, outerColor: line, headerFill: accent, headerColor: '#ffffff', headerRule: 0, bandFill: tint(accent, 0.08) }
    case 'boxed':
      return { outerH: 12, outerV: 12, insideH: 4, insideV: 4, color: border ?? tint(accent, 0.3), outerColor: border ?? accent, headerFill: tint(accent, 0.16), headerColor: null, headerRule: 0, bandFill: null }
    case 'minimal':
      return { outerH: 0, outerV: 0, insideH: 0, insideV: 0, color: line, outerColor: line, headerFill: null, headerColor: null, headerRule: 4, bandFill: null }
    default:
      return { outerH: 4, outerV: 4, insideH: 4, insideV: 4, color: line, outerColor: line, headerFill: tint(accent, 0.09), headerColor: null, headerRule: 0, bandFill: null }
  }
}

// --- numéros --------------------------------------------------------------------

export const NUMBER_FORMAT_TO_WORD: Record<PageNumberFormat, string> = {
  decimal: 'decimal',
  roman: 'lowerRoman',
  ROMAN: 'upperRoman',
  alpha: 'lowerLetter',
  ALPHA: 'upperLetter',
}

export function numberFormatFromWord(fmt: string | undefined): PageNumberFormat | null {
  switch (fmt) {
    case 'decimal':
    case 'decimalZero':
      return 'decimal'
    case 'lowerRoman':
      return 'roman'
    case 'upperRoman':
      return 'ROMAN'
    case 'lowerLetter':
      return 'alpha'
    case 'upperLetter':
      return 'ALPHA'
    default:
      return null
  }
}

export const noteFormatFromWord = (fmt: string | undefined): NoteFormat | null => (fmt === 'chicago' ? 'symbols' : numberFormatFromWord(fmt))

// --- champs de date -------------------------------------------------------------

/** Format de date Folio Pages (DD/MM/YYYY, [texte]) → format d'un champ DATE (dd/MM/yyyy, 'texte'). */
export function dateFormatToWord(f: string): string {
  return f.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|H|hh|h|mm|ss|A/g, (m, lit: string | undefined) => {
    if (lit !== undefined) return `'${lit.replace(/'/g, '’')}'`
    switch (m) {
      case 'YYYY':
        return 'yyyy'
      case 'YY':
        return 'yy'
      case 'DD':
        return 'dd'
      case 'D':
        return 'd'
      case 'A':
        return 'AM/PM'
      default:
        return m
    }
  })
}

/** Format d'un champ DATE → format de date Folio Pages. */
export function dateFormatFromWord(f: string): string {
  return f
    .replace(/'([^']*)'|am\/pm|AM\/PM|yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s/g, (m, lit: string | undefined) => {
      if (lit !== undefined) return `[${lit.replace(/[[\]]/g, '')}]`
      switch (m) {
        case 'yyyy':
          return 'YYYY'
        case 'yy':
          return 'YY'
        case 'dd':
          return 'DD'
        case 'd':
          return 'D'
        case 'm':
          return 'mm'
        case 's':
          return 'ss'
        case 'am/pm':
        case 'AM/PM':
          return 'A'
        default:
          return m
      }
    })
    .slice(0, 60)
}

// --- données binaires -----------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Octets → base64, sans passer par une chaîne intermédiaire géante. */
export function base64(bytes: Uint8Array): string {
  const out: string[] = []
  let chunk = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    chunk += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)]
    chunk += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '='
    chunk += i + 2 < bytes.length ? B64[c & 63] : '='
    if (chunk.length >= 8192) {
      out.push(chunk)
      chunk = ''
    }
  }
  out.push(chunk)
  return out.join('')
}

/** URI data: en base64 → octets et type ; null si ce n'en est pas une. */
export function bytesOfDataUri(uri: string): { type: string; bytes: Uint8Array } | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i.exec(uri.slice(0, 80))
  if (!m) return null
  const b64 = uri.slice(m[0].length)
  const clean = b64.replace(/=+$/, '')
  const len = Math.floor((clean.length * 3) / 4)
  const bytes = new Uint8Array(len)
  const val = (ch: number) =>
    ch >= 65 && ch <= 90 ? ch - 65 : ch >= 97 && ch <= 122 ? ch - 71 : ch >= 48 && ch <= 57 ? ch + 4 : ch === 43 ? 62 : ch === 47 ? 63 : 0
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const a = val(clean.charCodeAt(i))
    const b = val(clean.charCodeAt(i + 1))
    const c = i + 2 < clean.length ? val(clean.charCodeAt(i + 2)) : 0
    const d = i + 3 < clean.length ? val(clean.charCodeAt(i + 3)) : 0
    if (o < len) bytes[o++] = (a << 2) | (b >> 4)
    if (o < len) bytes[o++] = ((b & 15) << 4) | (c >> 2)
    if (o < len) bytes[o++] = ((c & 3) << 6) | d
  }
  return { type: m[1].toLowerCase(), bytes }
}

/** Type d'une image d'après ses premiers octets ; null si elle n'est pas reconnue. */
export function sniffImage(b: Uint8Array): 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | 'svg+xml' | null {
  if (b.length < 12) return null
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif'
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
  const head = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 600)))
  if (/<svg[\s>]/i.test(head)) return 'svg+xml'
  return null
}

/** Dimensions en pixels d'une image (PNG, JPEG, GIF, BMP, WebP, SVG) ; null si on ne sait pas les lire. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const kind = sniffImage(b)
  const u16be = (o: number) => (b[o] << 8) | b[o + 1]
  const u16le = (o: number) => b[o] | (b[o + 1] << 8)
  const u32be = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
  const u32le = (o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
  const ok = (width: number, height: number) => (width > 0 && height > 0 && width < 100_000 && height < 100_000 ? { width, height } : null)
  if (kind === 'png' && b.length >= 24) return ok(u32be(16), u32be(20))
  if (kind === 'gif') return ok(u16le(6), u16le(8))
  if (kind === 'bmp' && b.length >= 26) return ok(u32le(18), Math.abs(u32le(22) | 0))
  if (kind === 'jpeg') {
    let o = 2
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) {
        o++
        continue
      }
      const m = b[o + 1]
      if (m === 0xff) {
        o++
        continue
      }
      // SOF0…SOF15, sauf DHT (C4), JPG (C8) et DAC (CC).
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(u16be(o + 7), u16be(o + 5))
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) {
        o += 2
        continue
      }
      o += 2 + u16be(o + 2)
    }
    return null
  }
  if (kind === 'webp' && b.length >= 30) {
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (fourcc === 'VP8X') return ok(1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)))
    if (fourcc === 'VP8 ') return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff)
    if (fourcc === 'VP8L') {
      const v = u32le(21)
      return ok((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1)
    }
    return null
  }
  if (kind === 'svg+xml') {
    const head = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 4000)))
    const tag = /<svg\b[^>]*>/i.exec(head)?.[0] ?? ''
    const len = (name: string) => {
      const m = new RegExp(`\\b${name}\\s*=\\s*["']\\s*([0-9.]+)(px|pt)?\\s*["']`, 'i').exec(tag)
      return m ? Number(m[1]) * (m[2] === 'pt' ? 96 / 72 : 1) : 0
    }
    const w = len('width')
    const h = len('height')
    if (w && h) return ok(w, h)
    const vb = /\bviewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i.exec(tag)
    if (vb) return ok(Number(vb[1]), Number(vb[2]))
    return ok(300, 150)
  }
  return null
}
