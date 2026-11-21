// Import RTF (WordPad, TextEdit, anciens traitements de texte) : texte et mise
// en forme des caractères, paragraphes (alignement, retraits, espacements),
// titres (feuille de styles), listes, tableaux simples, images PNG et JPEG,
// notes de bas de page, liens. Les groupes inconnus marqués \* sont ignorés.

import { dirToStore } from '../format/bidi'

type Raw = Record<string, unknown>

export interface RtfImport {
  doc: Raw
  losses: { code: string; count: number }[]
}

interface CharState {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  sup: boolean
  sub: boolean
  caps: boolean
  smallcaps: boolean
  color: number
  highlight: number
  font: number
  size: number
  uc: number
  hidden: boolean
}

interface ParaState {
  align: string
  left: number
  right: number
  first: number
  before: number
  after: number
  style: number
  inTable: boolean
  list: boolean
  /** De droite à gauche (\rtlpar). */
  rtl: boolean
  /** Sans numéros de ligne (\noline). */
  noLine: boolean
}

/** Windows-1252 pour \'hh (le reste de Latin-1 est identique). */
const CP1252: Record<number, string> = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' }
const cp = (n: number) => CP1252[n] ?? String.fromCharCode(n)

const twip = (n: number) => Math.round((n / 20) * 10) / 10

/** Destinations dont le texte n'est pas du contenu. */
const TABLES = new Set(['fonttbl', 'stylesheet', 'info', 'colortbl'])

/** Destination dont rien ne doit passer dans le texte (en-têtes, pieds de page, objets…), sous-groupes compris. */
const ignored = (d: string) => d === 'skip' || (SKIP.has(d) && !TABLES.has(d) && d !== 'pict' && d !== 'fldinst')

const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'fldinst', 'object', 'filetbl', 'revtbl', 'pgdsctbl', 'pntext', 'listtext', 'nonshppict', 'bkmkstart', 'bkmkend', 'shp', 'shpinst', 'annotation', 'atnid', 'atnauthor'])

export function importRtf(text: string): RtfImport {
  if (!/^\s*\{\\rtf/.test(text)) throw new Error('not-rtf')
  return new RtfReader(text).read()
}

class RtfReader {
  private i = 0
  private fonts = new Map<number, string>()
  private colors: (string | null)[] = []
  private styles = new Map<number, string>()
  private info: Raw = {}
  private blocks: Raw[] = []
  private runs: Raw[] = []
  private assets: Record<string, string> = {}
  private losses = new Map<string, number>()
  private row: Raw[] = []
  private rows: Raw[][] = []
  private cell: Raw[] = []
  private link: string | null = null
  private note: { blocks: Raw[]; runs: Raw[] } | null = null
  /** Numéros de ligne lus (\linemod, \linestarts, \linex…). */
  private lines: { countBy: number; start: number; distance?: number; restart: 'continuous' | 'page' | 'section' } = { countBy: 0, start: 1, restart: 'page' }

  constructor(private s: string) {}

  private lose(code: string) {
    this.losses.set(code, (this.losses.get(code) ?? 0) + 1)
  }

  read(): RtfImport {
    const c: CharState = { bold: false, italic: false, underline: false, strike: false, sup: false, sub: false, caps: false, smallcaps: false, color: 0, highlight: 0, font: -1, size: 24, uc: 1, hidden: false }
    const p: ParaState = { align: 'left', left: 0, right: 0, first: 0, before: 0, after: 0, style: 0, inTable: false, list: false, rtl: false, noLine: false }
    this.group(c, p, '')
    this.flushPara(p)
    this.flushTable()
    const meta: Raw = { title: String(this.info.title ?? '') }
    if (this.info.author) meta.author = this.info.author
    if (this.info.subject) meta.subject = this.info.subject
    const l = this.lines
    // Sans \linemod, pas de numéros (en RTF, ils recommencent à chaque page par défaut).
    const lineNumbers = l.countBy >= 1 ? { restart: l.restart, start: Math.max(1, Math.min(32_767, l.start)), countBy: Math.min(100, l.countBy), ...(l.distance ? { distance: Math.min(144, Math.round((l.distance / 20) * 2) / 2) } : {}) } : undefined
    return { doc: { format: 'folio/doc', version: 1, meta, blocks: this.mergeLists(this.blocks), assets: this.assets, ...(lineNumbers ? { lineNumbers } : {}) }, losses: [...this.losses].map(([code, count]) => ({ code, count })) }
  }

  /** Un groupe { … } : les états de caractère sont propres au groupe. */
  private group(c: CharState, p: ParaState, dest: string): void {
    let skipUc = 0
    let firstWord = true
    let destination = dest
    let text = ''
    const flushText = () => {
      if (text) this.addText(text, c, destination)
      text = ''
    }
    while (this.i < this.s.length) {
      const ch = this.s[this.i]
      if (ch === '{') {
        flushText()
        this.i++
        // \* : destination facultative, ignorée si on ne la connaît pas.
        if (this.s.startsWith('\\*', this.i)) {
          const m = /^\\\*\\([a-z]+)/.exec(this.s.slice(this.i, this.i + 40))
          if (!m || !['fldinst', 'shppict', 'pict', 'footnote'].includes(m[1])) {
            this.skipGroup()
            continue
          }
        }
        // Les tables (polices, styles, propriétés) gardent leur destination dans leurs sous-groupes.
        this.group({ ...c }, p, ignored(destination) ? 'skip' : TABLES.has(destination) ? destination : '')
        continue
      }
      if (ch === '}') {
        flushText()
        this.i++
        this.endDestination(destination, c, p)
        return
      }
      if (ch === '\\') {
        const m = /^\\(?:([a-zA-Z]{1,32})(-?\d{1,10})? ?|'([0-9a-fA-F]{2})|([^a-zA-Z]))/.exec(this.s.slice(this.i, this.i + 50))
        if (!m) {
          this.i++
          continue
        }
        this.i += m[0].length
        if (m[3]) {
          if (skipUc > 0) skipUc--
          else text += cp(parseInt(m[3], 16))
          continue
        }
        if (m[4]) {
          if (m[4] === '~') text += ' '
          else if (m[4] === '-') text += '­'
          else if (m[4] === '_') text += '‑'
          else if (m[4] === '\\' || m[4] === '{' || m[4] === '}') text += m[4]
          else if (m[4] === '\n' || m[4] === '\r') {
            flushText()
            this.endParagraph(p, c)
          }
          continue
        }
        const word = m[1]
        const arg = m[2] === undefined ? null : Number(m[2])
        // (Dans une destination ignorée, tout le reste l'est aussi : un champ d'un pied de page…)
        if (firstWord && destination !== 'skip' && (SKIP.has(word) || word === 'footnote' || word === 'field' || word === 'fldrslt' || word === 'shppict')) destination = word
        firstWord = false
        if (word === 'u' && arg !== null) {
          text += String.fromCharCode(arg < 0 ? arg + 65536 : arg)
          skipUc = c.uc
          continue
        }
        flushText()
        this.control(word, arg, c, p, destination)
        continue
      }
      if (ch === '\r' || ch === '\n') {
        this.i++
        continue
      }
      if (skipUc > 0) {
        skipUc--
        this.i++
        continue
      }
      text += ch
      this.i++
    }
    flushText()
  }

  private skipGroup(): void {
    let depth = 1
    while (this.i < this.s.length && depth > 0) {
      const ch = this.s[this.i++]
      if (ch === '\\') this.i++
      else if (ch === '{') depth++
      else if (ch === '}') depth--
    }
  }

  private pending = ''

  private addText(text: string, c: CharState, dest: string): void {
    if (dest === 'colortbl') {
      // « \red0\green0\blue0; » : chaque point-virgule ferme une couleur (la première, vide, est « auto »).
      for (const ch of text) {
        if (ch !== ';') continue
        this.colors.push(this.colorSet ? `#${this.color.map((v) => v.toString(16).padStart(2, '0')).join('')}` : null)
        this.colorSet = false
        this.color = [0, 0, 0]
      }
      return
    }
    if (dest === 'fonttbl' || dest === 'stylesheet' || dest === 'fldinst' || dest === 'pict' || dest === 'info') {
      this.pending += text
      return
    }
    if (SKIP.has(dest) || dest === 'skip' || c.hidden) return
    const run: Raw = { text }
    if (c.bold) run.bold = true
    if (c.italic) run.italic = true
    if (c.underline) run.underline = true
    if (c.strike) run.strike = true
    if (c.sup) run.sup = true
    if (c.sub) run.sub = true
    if (c.caps) run.caps = true
    if (c.smallcaps) run.smallcaps = true
    const color = this.colors[c.color]
    if (c.color && color && color !== '#000000') run.color = color
    const hl = this.colors[c.highlight]
    if (c.highlight && hl && hl !== '#ffffff') run.highlight = hl
    const font = this.fonts.get(c.font)
    if (font && !/^(Times New Roman|Arial|Calibri|Helvetica|Cambria)$/i.test(font)) run.font = font
    if (c.size !== 24 && c.size !== 22) run.size = c.size / 2
    if (this.link) run.link = this.link
    ;(this.note ? this.note.runs : this.runs).push(run)
  }

  private control(word: string, arg: number | null, c: CharState, p: ParaState, dest: string): void {
    const on = arg !== 0
    // Dans un en-tête, un pied de page, un objet… : ni paragraphe ni tableau.
    if (ignored(dest) && ['par', 'cell', 'row', 'page', 'line', 'tab'].includes(word)) return
    switch (word) {
      case 'b': c.bold = on; break
      case 'i': c.italic = on; break
      case 'ul': c.underline = on; break
      case 'uld': case 'uldb': case 'ulw': case 'ulwave': case 'uldash': case 'ulth': c.underline = on; break
      case 'ulnone': c.underline = false; break
      case 'strike': case 'striked': c.strike = on; break
      case 'super': c.sup = true; c.sub = false; break
      case 'sub': c.sub = true; c.sup = false; break
      case 'nosupersub': c.sup = c.sub = false; break
      case 'caps': c.caps = on; break
      case 'scaps': c.smallcaps = on; break
      case 'v': c.hidden = on; break
      case 'cf': c.color = arg ?? 0; break
      case 'highlight': case 'cb': case 'chcbpat': c.highlight = arg ?? 0; break
      case 'f': if (dest === 'fonttbl') this.fontId = arg ?? 0; else c.font = arg ?? 0; break
      case 'fs': c.size = arg ?? 24; break
      case 'uc': c.uc = arg ?? 1; break
      case 'plain': Object.assign(c, { bold: false, italic: false, underline: false, strike: false, sup: false, sub: false, caps: false, smallcaps: false, color: 0, highlight: 0, size: 24, hidden: false }); break
      case 'pard': Object.assign(p, { align: 'left', left: 0, right: 0, first: 0, before: 0, after: 0, style: 0, inTable: false, list: false, rtl: false, noLine: false }); break
      case 'noline': p.noLine = true; break
      // Numéros de ligne de la section : pas (les active), premier numéro, distance, recommencement.
      case 'linemod': this.lines.countBy = arg ?? 0; break
      case 'linestarts': this.lines.start = arg ?? 1; break
      case 'linex': this.lines.distance = arg ?? 0; break
      case 'lineppage': this.lines.restart = 'page'; break
      case 'linerestart': this.lines.restart = 'section'; break
      case 'linecont': this.lines.restart = 'continuous'; break
      case 'rtlpar': p.rtl = true; break
      case 'ltrpar': p.rtl = false; break
      // Texte vertical des cellules : avant chaque \cellx de la définition de ligne.
      case 'trowd': this.cellDirs = []; this.cellDir = undefined; break
      case 'cltxtbrl': case 'cltxtbrlv': this.cellDir = 'tbrl'; break
      case 'cltxbtlr': this.cellDir = 'btlr'; break
      case 'cltxlrtb': this.cellDir = undefined; break
      case 'cellx': this.cellDirs.push(this.cellDir); this.cellDir = undefined; break
      case 'ql': p.align = 'left'; break
      case 'qc': p.align = 'center'; break
      case 'qr': p.align = 'right'; break
      case 'qj': p.align = 'justify'; break
      case 'li': p.left = arg ?? 0; break
      case 'ri': p.right = arg ?? 0; break
      case 'fi': p.first = arg ?? 0; break
      case 'sb': p.before = arg ?? 0; break
      case 'sa': p.after = arg ?? 0; break
      case 's': if (dest === 'stylesheet') this.styleId = arg ?? 0; else p.style = arg ?? 0; break
      case 'intbl': p.inTable = true; break
      case 'ls': case 'ilvl': case 'pnlvlblt': p.list = true; break
      case 'par': this.endParagraph(p, c); break
      case 'line': this.addText('\n', c, dest); break
      case 'tab': this.addText('\t', c, dest); break
      case 'page': this.endParagraph(p, c); this.blocks.push({ type: 'pagebreak' }); break
      case 'cell': this.endCell(p); break
      case 'row': this.endRow(); break
      case 'red': this.color[0] = Math.min(255, arg ?? 0); this.colorSet = true; break
      case 'green': this.color[1] = Math.min(255, arg ?? 0); this.colorSet = true; break
      case 'blue': this.color[2] = Math.min(255, arg ?? 0); this.colorSet = true; break
      case 'pngblip': this.picType = 'image/png'; break
      case 'jpegblip': this.picType = 'image/jpeg'; break
      case 'emfblip': case 'wmetafile': case 'macpict': this.picType = ''; break
      case 'footnote': this.note = { blocks: [], runs: [] }; break
      case 'title': case 'author': case 'subject': this.infoKey = word; break
      case 'emdash': this.addText('—', c, dest); break
      case 'endash': this.addText('–', c, dest); break
      case 'bullet': this.addText('•', c, dest); break
      case 'lquote': this.addText('‘', c, dest); break
      case 'rquote': this.addText('’', c, dest); break
      case 'ldblquote': this.addText('“', c, dest); break
      case 'rdblquote': this.addText('”', c, dest); break
    }
  }
  private fontId = 0
  private styleId = 0
  private color: number[] = [0, 0, 0]
  private colorSet = false
  private picType = ''
  private infoKey = ''

  /** Fin d'un groupe : une police, un style, une propriété, une image, une note, un champ… */
  private endDestination(dest: string, c: CharState, p: ParaState): void {
    void c
    const text = this.pending
    if (dest === 'fonttbl' && text.trim()) this.fonts.set(this.fontId, text.replace(/;\s*$/, '').trim())
    if (dest === 'stylesheet' && text.trim()) this.styles.set(this.styleId, text.replace(/;\s*$/, '').trim().toLowerCase())
    if (dest === 'info' && this.infoKey) {
      if (text.trim()) this.info[this.infoKey] = text.trim().slice(0, 300)
      this.infoKey = ''
    }
    if (dest === 'pict') {
      if (this.picType) {
        const hex = text.replace(/[^0-9a-fA-F]/g, '')
        if (hex.length > 8 && hex.length < 40_000_000) {
          const id = `rtf${Object.keys(this.assets).length + 1}`
          let bin = ''
          for (let k = 0; k + 1 < hex.length; k += 2) bin += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16))
          this.assets[id] = `data:${this.picType};base64,${btoa(bin)}`
          this.flushPara(p)
          this.blocks.push({ type: 'image', src: `asset:${id}`, alt: '' })
        }
      } else this.lose('image')
      this.picType = ''
    }
    if (dest === 'fldinst') {
      const m = /HYPERLINK\s+"([^"]+)"/i.exec(text)
      this.link = m && /^(https?:|mailto:|#)/i.test(m[1]) ? m[1] : null
    }
    if (dest === 'field') this.link = null
    if (dest === 'footnote' && this.note) {
      if (this.note.runs.length) this.note.blocks.push({ type: 'paragraph', content: this.note.runs })
      const blocks = this.note.blocks
      this.note = null
      this.runs.push({ type: 'note', kind: 'foot', blocks: blocks.length ? blocks : [{ type: 'paragraph', content: [] }] })
    }
    if (dest === 'fonttbl' || dest === 'stylesheet' || dest === 'info' || dest === 'pict' || dest === 'fldinst') this.pending = ''
  }

  private endParagraph(p: ParaState, c: CharState): void {
    void c
    if (this.note) {
      this.note.blocks.push({ type: 'paragraph', content: this.note.runs })
      this.note.runs = []
      return
    }
    if (p.inTable) {
      this.cell.push(this.paraBlock(p))
      this.runs = []
      return
    }
    this.flushTable()
    this.blocks.push(this.paraBlock(p))
    this.runs = []
  }

  private flushPara(p: ParaState): void {
    if (this.runs.length) this.endParagraph(p, {} as CharState)
  }

  private paraBlock(p: ParaState): Raw {
    const content = this.runs
    const name = this.styles.get(p.style) ?? ''
    const h = /^(?:heading|titre|überschrift)\s*(\d)/.exec(name)
    const props: Raw = {}
    // L'alignement du RTF est visuel : de droite à gauche, notre gauche (le début) est \qr.
    const align = p.rtl ? (p.align === 'right' ? 'left' : p.align === 'left' ? 'right' : p.align) : p.align
    if (align !== 'left') props.align = align
    const dir = dirToStore(p.rtl, content)
    if (dir) props.dir = dir
    if (p.noLine) props.noLineNumbers = true
    const indent: Raw = {}
    if (p.left) indent.left = twip(p.left)
    if (p.right) indent.right = twip(p.right)
    if (p.first) indent.first = twip(p.first)
    if (Object.keys(indent).length) props.indent = indent
    if (h) return { type: 'heading', level: Math.min(6, Number(h[1])), content, ...props }
    // Puce ou numéro écrit en tête (« • », « 1. », souvent suivi d'une tabulation) : un élément de liste.
    const lead = content.map((r) => (typeof r.text === 'string' ? r.text : '\ufffc')).join('')
    const marker = /^([•·▪◦-]|\d+[.)])[ \t]+/.exec(lead)
    if (p.list || marker) {
      let cut = marker?.[0].length ?? 0
      while (cut > 0 && content.length && typeof content[0].text === 'string') {
        const t = content[0].text as string
        if (t.length <= cut) {
          cut -= t.length
          content.shift()
        } else {
          content[0] = { ...content[0], text: t.slice(cut) }
          cut = 0
        }
      }
      const numbered = !!marker && /\d/.test(marker[1])
      return { type: 'list', style: numbered ? 'number' : 'bullet', items: [{ content, level: Math.max(0, Math.min(8, Math.round(p.left / 360) - 1)), ...(props.align ? { align: props.align } : {}) }] }
    }
    if (name === 'title') return { type: 'paragraph', style: 'title', content, ...props }
    if (p.before || p.after) props.spacing = { ...(p.before ? { before: twip(p.before) } : {}), ...(p.after ? { after: twip(p.after) } : {}) }
    return { type: 'paragraph', content, ...props }
  }

  /** Texte vertical de chaque cellule de la ligne en cours. */
  private cellDirs: ('tbrl' | 'btlr' | undefined)[] = []
  private cellDir: 'tbrl' | 'btlr' | undefined

  private endCell(p: ParaState): void {
    if (this.runs.length) this.cell.push(this.paraBlock(p))
    this.runs = []
    const textDir = this.cellDirs[this.row.length]
    this.row.push({ blocks: this.cell.length ? this.cell : [''], ...(textDir ? { textDir } : {}) })
    this.cell = []
  }

  private endRow(): void {
    if (this.row.length) this.rows.push(this.row)
    this.row = []
  }

  private flushTable(): void {
    if (!this.rows.length) return
    this.blocks.push({ type: 'table', header: false, rows: this.rows })
    this.rows = []
  }

  /** Éléments de liste voisins : une seule liste. */
  private mergeLists(blocks: Raw[]): Raw[] {
    const out: Raw[] = []
    for (const b of blocks) {
      const last = out[out.length - 1]
      if (b.type === 'list' && last?.type === 'list' && last.style === b.style) (last.items as Raw[]).push(...(b.items as Raw[]))
      else out.push(b)
    }
    return out
  }
}
