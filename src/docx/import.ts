// Import d'un fichier .docx (WordprocessingML) vers le format Folio Pages.
//
// Le fichier est une archive de parties XML écrites par un autre programme :
// rien n'y est tenu pour sûr. On lit le texte, les styles, les listes, les
// tableaux, les images, les notes, les commentaires, le suivi des
// modifications, les en-têtes et la mise en page ; on produit un document en
// forme « libre », que l'application fait ensuite passer par sa validation
// bornée habituelle (liens, images, tailles). Ce qui n'a pas d'équivalent est
// compté dans `losses` ; le texte lui-même est toujours gardé.

import { BUILTIN_STYLES, resolveStyle } from '../format/theme'
import { AUTHORITY_CATEGORIES, PAPER_SIZES, type StyleDef, type TableStyle, type Theme } from '../format/types'
import {
  HIGHLIGHT_FROM_WORD,
  INLINE_CODE_STYLE,
  THEME_COLOR_FROM_WORD,
  base64,
  builtinOfStyleName,
  colorOf,
  dateFormatFromWord,
  highlightOfFill,
  imageSize,
  isMonoFont,
  lineFromWord,
  mmOfTwips,
  noteFormatFromWord,
  numberFormatFromWord,
  ptOfEmu,
  ptOfTwips,
  sniffImage,
  styleKey,
  tableLook,
  tableStyleOfId,
} from './maps'
import { attr, child, descendants, kids, num, onOff, parseXml, path, textOf, XmlError, type XmlNode } from './xml'
import { MATH_PART_NS, ommlPrint, ommlToTex } from './omml'
import { DocxError, openArchive, resolveTarget, type Archive } from './zip'
import type { Loss } from './export'

export type ImportLossCode =
  | 'equation'
  | 'drawing'
  | 'textbox'
  | 'chart'
  | 'object'
  | 'image-format'
  | 'image-large'
  | 'image-missing'
  | 'field'
  | 'section-layout'
  | 'symbol'
  | 'hidden-text'
  | 'heading-number'
  | 'embedded-document'
  | 'nested-table'
  | 'merge-source'

export interface ImportResult {
  /** Document en forme libre, à passer par la validation de l'application. */
  doc: Record<string, unknown>
  losses: Loss<ImportLossCode>[]
}

type Raw = Record<string, unknown>

interface RProps {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  caps?: boolean
  smallcaps?: boolean
  vert?: 'sup' | 'sub' | 'base'
  color?: string
  highlight?: string
  font?: string
  size?: number
  letterSpacing?: number
  lang?: string
  vanish?: boolean
  rStyle?: string
  /** Décalage vertical en demi-points (positif : vers le haut). */
  raised?: number
  underlineStyle?: string
  underlineColor?: string
  outline?: boolean
  shadow?: boolean
  glow?: string
  textBorder?: string
  textShading?: string
}

interface PProps {
  align?: 'left' | 'center' | 'right' | 'justify'
  left?: number
  right?: number
  first?: number
  before?: number
  after?: number
  line?: number
  /** Interligne fixe en points (règles « exact » et « atLeast »). */
  lineExact?: number
  keepNext?: boolean
  keepLines?: boolean
  pageBreakBefore?: boolean
  shading?: string
  border?: string
  /** Seulement un filet sous le paragraphe : un séparateur s'il est vide. */
  ruleBelow?: boolean
  numId?: number
  ilvl?: number
  outline?: number
  pStyle?: string
}

interface WStyle {
  id: string
  type: string
  name: string
  basedOn?: string
  r: RProps
  p: PProps
  node: XmlNode
}

interface ParaStyle {
  /** Style Folio Pages du paragraphe (« normal », « title », identifiant d'un style personnel). */
  folio: string
  heading: number
  role: 'quote' | 'code' | 'caption' | 'tocHeading' | 'rule' | null
  r: RProps
  p: PProps
  /** Style du fichier à reprendre comme style personnel, si un paragraphe s'en sert vraiment. */
  custom?: string
}

interface Rel {
  type: string
  target: string
  external: boolean
}

type Entry =
  | { k: 'block'; block: Raw }
  | { k: 'p'; block: Raw; role?: 'quote' | 'caption' | 'tocHeading' }
  | { k: 'code'; text: string }
  | { k: 'li'; numId: number; level: number; content: Raw[]; props: Raw; indent: number }

interface Ctx {
  note?: boolean
  hf?: boolean
  /** Dans une cellule de tableau. */
  cell?: boolean
  /** Cellule mise en forme par le style du tableau (nos propres fichiers) : ce gras, cette couleur ne sont pas du texte. */
  plain?: { bold: boolean; color: string | null }
}

interface Field {
  instr: string
  phase: 'instr' | 'result'
  /** Le résultat écrit dans le fichier est remplacé (champ reconnu, table des matières). */
  suppress: boolean
  link?: string
  r: RProps
  done: boolean
}

interface Inline {
  content: Raw[]
  /** Blocs rencontrés dans le paragraphe (images, sauts) : le texte déjà lu passe avant. */
  split: (block: Raw) => void
  /** Paragraphes sortis d'une zone de texte : placés après le paragraphe. */
  after: Entry[]
  style: ParaStyle
  ctx: Ctx
  link?: string
  inserted?: Raw
  deleted?: Raw
  /** Première ligne d'une note : l'espace qui suit son numéro est retirée. */
  trimStart?: boolean
  /** Un objet du paragraphe n'a pas été repris : s'il n'y avait que lui, le paragraphe disparaît. */
  dropped?: boolean
  /** Alignement du paragraphe : celui d'une image qui s'y trouve. */
  align?: string
}

interface Sect {
  type: string
  page: Raw
  key: string
  cols: { count: number; gap: number; rule: boolean } | null
  numberStart?: number
  numberFormat?: string
  titlePg: boolean
  headers: Record<string, string>
  footers: Record<string, string>
  notes: Raw
}

const REL_DOC = 'officeDocument'
const SAFE_LINK = /^(https?:|mailto:|tel:)/i
const STD_BULLETS = new Set(['•', '·', 'o', '○', '◦', '▪', '■', '●', '', '', '', '', '-'])
const first = (n: XmlNode | undefined, ...names: string[]): string | undefined => {
  for (const name of names) {
    const v = n?.attrs[name]
    if (v !== undefined) return v
  }
  return undefined
}
const numOf = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined
  const x = Number(v)
  return Number.isFinite(x) ? x : undefined
}
/** Cellules d'un tableau, sans descendre dans les tableaux qu'elles contiennent. */
function descendantsShallow(tbl: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = []
  for (const tr of tbl.children) {
    if (tr.name !== 'w:tr') continue
    for (const c of tr.children) {
      if (c.name === name) out.push(c)
      else if (c.name === 'w:sdt') out.push(...kids(child(c, 'w:sdtContent'), name))
    }
  }
  return out
}
const clampPt = (pt: number, max = 1000): number => Math.max(-max, Math.min(max, Math.round(pt * 100) / 100))

class Importer {
  private losses = new Map<ImportLossCode, number>()
  private zip: Archive
  private mainPath = 'word/document.xml'
  private part = 'word/document.xml'
  private relsCache = new Map<string, Map<string, Rel>>()
  private styles = new Map<string, WStyle>()
  private defaults: { r: RProps; p: PProps } = { r: {}, p: {} }
  private defaultPStyle = ''
  private paraStyles = new Map<string, ParaStyle>()
  private builtinSource = new Map<string, string>()
  private customUsed = new Map<string, string>()
  private nums = new Map<number, { abstract: XmlNode | undefined; overrides: Map<number, { start?: number; lvl?: XmlNode }> }>()
  private listCounts = new Map<number, number>()
  private themeColors: Record<string, string> = {}
  private themeFonts: { major?: string; minor?: string } = {}
  private themeName = ''
  private theme: Theme | null = null
  private own = false
  private docLang = ''
  private notes = { foot: new Map<string, XmlNode>(), end: new Map<string, XmlNode>() }
  private notePart = { foot: '', end: '' }
  private threadOf = new Map<string, string>()
  private threads: Raw[] = []
  private anchored = new Set<string>()
  private activeComments = new Set<string>()
  private fields: Field[] = []
  private assets: Record<string, string> = {}
  private assetOf = new Map<string, string | null>()
  /** Filigrane trouvé dans un en-tête. */
  private watermark: Raw | null = null
  /** Lettrine en attente (son cadre précède le paragraphe qu'elle commence). */
  private dropCap: { letter: string; lines: number } | null = null
  private lastRun: Raw | null = null
  private naturalSize = new Map<string, { width: number; height: number }>()
  /** Sources LaTeX de nos propres équations, par empreinte (partie customXml de l'export). */
  private mathSources = new Map<string, string[]>()
  /** Publipostage d'un de nos fichiers (liste de destinataires comprise). */
  private ownMailMerge: unknown = null
  /** Nos propres fichiers : sources exactes, style de citation, ce qu'affiche chaque renvoi. */
  private ownRefs: { sources?: unknown[]; citationStyle?: string; xrefShows?: string[] } | null = null
  /** Sources du gestionnaire de sources de Word (customXml « b:Sources »). */
  private wordSources: Raw[] = []
  private xrefCount = 0
  /** Noms des signets du corps (un renvoi vers un signet absent garde son texte). */
  private bookmarkNames: Set<string> | null = null

  constructor(data: Uint8Array) {
    this.zip = openArchive(data)
  }

  private lose(code: ImportLossCode, n = 1): void {
    this.losses.set(code, (this.losses.get(code) ?? 0) + n)
  }

  // --- parties et relations -------------------------------------------------------

  private xml(p: string): XmlNode | undefined {
    const text = this.zip.text(p)
    if (text === undefined) return undefined
    try {
      return parseXml(text)
    } catch (e) {
      if (e instanceof XmlError && p === this.mainPath) throw new DocxError('damaged')
      return undefined
    }
  }

  private rels(partPath: string): Map<string, Rel> {
    let map = this.relsCache.get(partPath)
    if (map) return map
    map = new Map()
    const i = partPath.lastIndexOf('/')
    const relPath = `${partPath.slice(0, i + 1)}_rels/${partPath.slice(i + 1)}.rels`
    const root = this.xml(relPath)
    for (const r of kids(root, 'Relationship')) {
      const id = r.attrs.Id
      if (!id) continue
      const external = r.attrs.TargetMode === 'External'
      map.set(id, { type: (r.attrs.Type ?? '').split('/').pop() ?? '', target: external ? (r.attrs.Target ?? '') : resolveTarget(partPath, r.attrs.Target ?? ''), external })
    }
    this.relsCache.set(partPath, map)
    return map
  }

  /** Sources des équations écrites par Folio Pages (customXml), s'il y en a. */
  private readMathSources(): void {
    for (const r of this.rels(this.mainPath).values()) {
      if (r.type !== 'customXml' || r.external) continue
      const root = this.xml(r.target)
      if (root && root.name.replace(/^.*:/, '') === 'Sources') {
        this.wordSources = wordSourcesOf(root)
        continue
      }
      if (!root || root.name.replace(/^.*:/, '') !== 'equations' || !Object.values(root.attrs).includes(MATH_PART_NS)) continue
      let n = 0
      for (const eq of root.children) {
        if (eq.name.replace(/^.*:/, '') === 'refs') {
          try {
            this.ownRefs = JSON.parse(textOf(eq).slice(0, 20_000_000))
          } catch {
            this.ownRefs = null
          }
          continue
        }
        if (eq.name.replace(/^.*:/, '') === 'mailMerge') {
          try {
            this.ownMailMerge = JSON.parse(textOf(eq).slice(0, 60_000_000))
          } catch {
            this.ownMailMerge = null
          }
          continue
        }
        if (eq.name.replace(/^.*:/, '') !== 'eq' || ++n > 50_000) continue
        const print = eq.attrs.print ?? ''
        const tex = textOf(eq).slice(0, 20_000)
        if (!tex.trim()) continue
        const list = this.mathSources.get(print) ?? []
        list.push(tex)
        this.mathSources.set(print, list)
      }
    }
  }

  /** LaTeX d'une équation OMML : sa source exacte si c'est une des nôtres, inchangée ; sinon une conversion. */
  private texOfMath(m: XmlNode): string {
    const kept = this.mathSources.get(ommlPrint(m))
    if (kept && kept.length) return kept.shift()!
    return ommlToTex(m)
  }

  private relOfType(partPath: string, type: string): string | undefined {
    for (const r of this.rels(partPath).values()) if (r.type === type && !r.external) return r.target
    return undefined
  }

  /** Exécute `fn` avec une autre partie courante (ses relations lui sont propres). */
  private inPart<T>(p: string, fn: () => T): T {
    const prev = this.part
    this.part = p
    try {
      return fn()
    } finally {
      this.part = prev
    }
  }

  // --- propriétés de caractères et de paragraphes ---------------------------------

  private rProps(rPr: XmlNode | undefined): RProps {
    const o: RProps = {}
    if (!rPr) return o
    for (const c of rPr.children) {
      switch (c.name) {
        case 'w:b':
          o.bold = onOff(c)
          break
        case 'w:i':
          o.italic = onOff(c)
          break
        case 'w:strike':
        case 'w:dstrike':
          o.strike = onOff(c)
          break
        case 'w:caps':
          o.caps = onOff(c)
          break
        case 'w:smallCaps':
          o.smallcaps = onOff(c)
          break
        case 'w:vanish':
          o.vanish = onOff(c)
          break
        case 'w:u': {
          const v = attr(c) ?? 'single'
          o.underline = v !== 'none'
          const style = v === 'double' ? 'double' : /^(thick|wavyHeavy)$/.test(v) ? 'thick' : /^dotted|^dottedHeavy/.test(v) ? 'dotted' : /^dash/.test(v) ? 'dashed' : /^wav/.test(v) ? 'wavy' : ''
          if (style) o.underlineStyle = style
          const col = colorOf(c.attrs['w:color'])
          if (col) o.underlineColor = col
          break
        }
        case 'w:outline':
          o.outline = onOff(c)
          break
        case 'w:shadow':
          o.shadow = onOff(c)
          break
        case 'w14:glow': {
          const clr = c.children.find((k) => k.name === 'w14:srgbClr')
          const col = colorOf(clr?.attrs['w14:val'])
          if (col) o.glow = col
          break
        }
        case 'w:bdr': {
          const v = attr(c)
          if (v && v !== 'none' && v !== 'nil') o.textBorder = colorOf(c.attrs['w:color']) ?? 'text'
          break
        }
        case 'w:vertAlign': {
          const v = attr(c)
          o.vert = v === 'superscript' ? 'sup' : v === 'subscript' ? 'sub' : 'base'
          break
        }
        case 'w:position': {
          // Texte relevé ou abaissé « à la main » (LibreOffice) : un exposant ou un indice.
          const v = num(c)
          if (v) o.raised = v
          break
        }
        case 'w:color': {
          const themed = c.attrs['w:themeColor']
          const plain = !c.attrs['w:themeTint'] && !c.attrs['w:themeShade']
          if (themed && plain && Object.prototype.hasOwnProperty.call(THEME_COLOR_FROM_WORD, themed)) o.color = THEME_COLOR_FROM_WORD[themed]
          else {
            const hex = colorOf(attr(c)) ?? (themed ? this.themeColors[themed] : undefined)
            if (hex) o.color = hex
            else if (attr(c) === 'auto') o.color = 'text'
          }
          break
        }
        case 'w:highlight': {
          const v = attr(c) ?? ''
          if (v === 'none') o.highlight = ''
          else if (Object.prototype.hasOwnProperty.call(HIGHLIGHT_FROM_WORD, v)) o.highlight = HIGHLIGHT_FROM_WORD[v]
          break
        }
        case 'w:shd': {
          // Motif plein : une trame de texte ; sinon (remplissage) : un surlignage.
          const solid = attr(c) === 'solid' ? colorOf(c.attrs['w:color']) : null
          if (solid) {
            o.textShading = solid
            break
          }
          const fill = colorOf(c.attrs['w:fill'])
          if (fill && o.highlight === undefined) o.highlight = highlightOfFill(fill)
          break
        }
        case 'w:rFonts': {
          const themed = first(c, 'w:asciiTheme', 'w:hAnsiTheme')
          if (themed) o.font = themed.startsWith('major') ? 'heading' : 'body'
          else {
            const f = first(c, 'w:ascii', 'w:hAnsi', 'w:cs')
            if (f) o.font = f
          }
          break
        }
        case 'w:sz': {
          const v = num(c)
          if (v && v > 0) o.size = Math.min(400, v / 2)
          break
        }
        case 'w:spacing': {
          const v = num(c)
          if (v !== undefined) o.letterSpacing = clampPt(ptOfTwips(v), 100)
          break
        }
        case 'w:lang': {
          const v = attr(c)
          if (v && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(v)) o.lang = v
          break
        }
        case 'w:rStyle':
          o.rStyle = attr(c)
          break
      }
    }
    return o
  }

  private pProps(pPr: XmlNode | undefined): PProps {
    const o: PProps = {}
    if (!pPr) return o
    for (const c of pPr.children) {
      switch (c.name) {
        case 'w:pStyle':
          o.pStyle = attr(c)
          break
        case 'w:jc': {
          const v = attr(c)
          o.align = v === 'center' ? 'center' : v === 'right' || v === 'end' ? 'right' : v === 'both' || v === 'distribute' ? 'justify' : 'left'
          break
        }
        case 'w:ind': {
          const left = numOf(first(c, 'w:left', 'w:start'))
          const right = numOf(first(c, 'w:right', 'w:end'))
          const firstLine = num(c, 'w:firstLine')
          const hanging = num(c, 'w:hanging')
          if (left !== undefined) o.left = clampPt(ptOfTwips(left))
          if (right !== undefined) o.right = clampPt(ptOfTwips(right))
          if (hanging !== undefined) o.first = clampPt(-ptOfTwips(hanging))
          else if (firstLine !== undefined) o.first = clampPt(ptOfTwips(firstLine))
          break
        }
        case 'w:spacing': {
          const before = num(c, 'w:before')
          const after = num(c, 'w:after')
          const line = num(c, 'w:line')
          if (before !== undefined && c.attrs['w:beforeAutospacing'] !== '1') o.before = clampPt(Math.max(0, ptOfTwips(before)))
          if (after !== undefined && c.attrs['w:afterAutospacing'] !== '1') o.after = clampPt(Math.max(0, ptOfTwips(after)))
          if (line !== undefined && line > 0) {
            const rule = c.attrs['w:lineRule'] ?? 'auto'
            if (rule === 'auto') o.line = Math.max(0.5, Math.min(10, lineFromWord(line)))
            else o.lineExact = ptOfTwips(line)
          }
          break
        }
        case 'w:keepNext':
          o.keepNext = onOff(c)
          break
        case 'w:keepLines':
          o.keepLines = onOff(c)
          break
        case 'w:pageBreakBefore':
          o.pageBreakBefore = onOff(c)
          break
        case 'w:shd': {
          const fill = this.themed(c, 'w:fill', 'w:themeFill')
          if (fill) o.shading = fill
          break
        }
        case 'w:pBdr': {
          const on = (side: string) => {
            const b = child(c, side)
            const v = attr(b)
            return b && v && v !== 'none' && v !== 'nil' ? b : undefined
          }
          const sides = ['w:top', 'w:bottom', 'w:left', 'w:right'].map(on)
          if (sides.every(Boolean)) o.border = this.themed(sides[0], 'w:color', 'w:themeColor') ?? 'text'
          else if (sides[1] && !sides[0] && !sides[2] && !sides[3]) o.ruleBelow = true
          break
        }
        case 'w:numPr': {
          const id = num(child(c, 'w:numId'))
          const lvl = num(child(c, 'w:ilvl'))
          if (id !== undefined) o.numId = id
          if (lvl !== undefined) o.ilvl = Math.max(0, Math.min(8, lvl))
          break
        }
        case 'w:outlineLvl': {
          const v = num(c)
          if (v !== undefined) o.outline = v
          break
        }
      }
    }
    return o
  }

  /** Couleur d'un attribut : renvoi au thème quand c'en est un (sans teinte), sinon « #rrggbb » ; null si absente. */
  private themed(n: XmlNode | undefined, val: string, theme: string): string | null {
    if (!n) return null
    const t = n.attrs[theme]
    const altered = Object.keys(n.attrs).some((k) => /Tint$|Shade$/.test(k))
    if (t && !altered && Object.prototype.hasOwnProperty.call(THEME_COLOR_FROM_WORD, t)) return THEME_COLOR_FROM_WORD[t]
    return colorOf(n.attrs[val]) ?? (t ? (this.themeColors[t] ?? null) : null)
  }

  /** Propriétés d'un style, héritage compris (sans boucle). */
  private chain(id: string | undefined, type: string): { r: RProps; p: PProps } {
    const list: WStyle[] = []
    const seen = new Set<string>()
    let cur = id
    while (cur && !seen.has(cur) && list.length < 20) {
      seen.add(cur)
      const s = this.styles.get(cur)
      if (!s || s.type !== type) break
      list.unshift(s)
      cur = s.basedOn
    }
    let r: RProps = type === 'paragraph' ? { ...this.defaults.r } : {}
    let p: PProps = type === 'paragraph' ? { ...this.defaults.p } : {}
    for (const s of list) {
      r = { ...r, ...s.r }
      p = { ...p, ...s.p }
    }
    return { r, p }
  }

  private readStyles(): void {
    const root = this.xml(this.relOfType(this.mainPath, 'styles') ?? 'word/styles.xml')
    if (!root) return
    const dd = child(root, 'w:docDefaults')
    this.defaults = { r: this.rProps(path(dd, 'w:rPrDefault', 'w:rPr')), p: this.pProps(path(dd, 'w:pPrDefault', 'w:pPr')) }
    this.docLang = this.defaults.r.lang ?? ''
    for (const s of kids(root, 'w:style')) {
      const id = s.attrs['w:styleId']
      if (!id || this.styles.size >= 2000) continue
      const type = s.attrs['w:type'] ?? 'paragraph'
      this.styles.set(id, { id, type, name: attr(child(s, 'w:name')) ?? id, basedOn: attr(child(s, 'w:basedOn')), r: this.rProps(child(s, 'w:rPr')), p: this.pProps(child(s, 'w:pPr')), node: s })
      if (type === 'paragraph' && s.attrs['w:default'] && s.attrs['w:default'] !== '0') this.defaultPStyle = id
    }
    if (!this.defaultPStyle && this.styles.has('Normal')) this.defaultPStyle = 'Normal'
    this.docLang = this.docLang || (this.styles.get(this.defaultPStyle)?.r.lang ?? '')
    // Les styles intégrés présents dans le fichier sont repris même si aucun paragraphe ne s'en sert encore.
    for (const s of this.styles.values()) {
      const b = s.type === 'paragraph' ? builtinOfStyleName(s.name, s.id) : null
      if (b && !this.builtinSource.has(b)) this.builtinSource.set(b, s.id)
    }
    if (this.own) {
      // Nos propres fichiers : tout style de paragraphe qui n'est pas des nôtres est un style du document, même inutilisé.
      for (const s of this.styles.values()) {
        if (s.type !== 'paragraph' || builtinOfStyleName(s.name, s.id) || /^(ListParagraph|TOCHeading|TOC\d|EndnoteText|Equation)$/.test(s.id)) continue
        const folio = styleKey(s.id.replace(/_$/, ''))
        if (!Object.prototype.hasOwnProperty.call(BUILTIN_STYLES, folio)) this.customUsed.set(s.id, folio)
      }
    }
  }

  private paraStyle(id: string | undefined): ParaStyle {
    const key = id && this.styles.get(id)?.type === 'paragraph' ? id : this.defaultPStyle
    const cached = this.paraStyles.get(key)
    if (cached) return cached
    const s = this.styles.get(key)
    const { r, p } = this.chain(key, 'paragraph')
    let folio = 'normal'
    let heading = 0
    let role: ParaStyle['role'] = null
    let custom: string | undefined
    if (s) {
      // Le style lui-même, sinon celui dont il hérite, donne le style intégré équivalent.
      let builtin: string | null = null
      let cur: WStyle | undefined = s
      const seen = new Set<string>()
      while (cur && !seen.has(cur.id) && seen.size < 20) {
        seen.add(cur.id)
        builtin = builtinOfStyleName(cur.name, cur.id)
        if (builtin && (cur === s || /^heading/.test(builtin))) break
        builtin = null
        cur = cur.basedOn ? this.styles.get(cur.basedOn) : undefined
      }
      const name = s.name.trim().toLowerCase()
      if (name === 'toc heading' || s.id === 'TOCHeading') {
        role = 'tocHeading'
        builtin = null
      } else if (builtin && /^heading/.test(builtin)) heading = Number(builtin.slice(7))
      else if (builtin === 'quote') role = 'quote'
      else if (builtin === 'code' || (!builtin && r.font && isMonoFont(r.font) && /code|listing|verbatim|pre/i.test(s.name))) role = 'code'
      else if (builtin === 'caption') role = 'caption'
      else if (/^(horizontal line|ligne horizontale)$/.test(name)) role = 'rule'
      if (builtin && cur === s) {
        folio = builtin
        if (!this.builtinSource.has(builtin)) this.builtinSource.set(builtin, s.id)
      } else if (!heading && !role && key !== this.defaultPStyle && !/^(list paragraph|toc \d|table of figures|index \d|header|footer|en-tête|pied de page)$/.test(name)) {
        folio = styleKey(s.id)
        if (Object.prototype.hasOwnProperty.call(BUILTIN_STYLES, folio)) folio = `${folio}_`
        custom = s.id
      }
      if (role === 'caption') folio = 'caption'
      if (p.outline !== undefined && p.outline >= 0 && p.outline <= 5 && !heading && !builtin && !role) heading = p.outline + 1
    }
    const out: ParaStyle = { folio, heading, role, r, p, custom }
    this.paraStyles.set(key, out)
    return out
  }

  /** Propriétés d'un passage : style de caractères puis mise en forme directe. */
  private runProps(rPr: XmlNode | undefined): RProps & { code?: boolean } {
    const direct = this.rProps(rPr)
    if (!direct.rStyle) return direct
    const s = this.styles.get(direct.rStyle)
    if (!s || s.type !== 'character') return direct
    const name = s.name.trim().toLowerCase()
    // Le style des liens (couleur, soulignement) est celui de l'application.
    if (/hyperlink|internet link|lien/.test(name)) return direct
    if (s.id === INLINE_CODE_STYLE || /\b(code|verbatim|keyboard|typewriter)\b/.test(name)) return { ...direct, code: true }
    if (/footnote reference|endnote reference|annotation reference|comment reference/.test(name)) return direct
    return { ...this.chain(s.id, 'character').r, ...direct }
  }

  /** Dans nos propres fichiers, la police du code est celle du thème. */
  private ownFont(f: string | undefined): string | undefined {
    return this.own && f && this.theme && f === this.theme.fonts.mono ? 'mono' : f
  }

  /** Marques Folio Pages d'un passage, sans répéter ce que le style du paragraphe donne déjà. */
  private marks(r: RProps & { code?: boolean }, base: RProps): Raw {
    // Nos propres fichiers : la mise en forme directe est exactement celle du document d'origine.
    if (this.own) base = {}
    const m: Raw = {}
    for (const k of ['bold', 'italic', 'underline', 'strike', 'caps', 'smallcaps'] as const) if (r[k] === true && base[k] !== true) m[k] = true
    // Relevé ou abaissé et plus petit que le texte du paragraphe : exposant ou indice (la taille suit).
    const shifted = !r.vert && r.raised && r.size && r.size < (base.size ?? 11) ? (r.raised > 0 ? 'sup' : 'sub') : null
    if (shifted) r = { ...r, size: undefined }
    if (r.vert === 'sup' || shifted === 'sup') m.sup = true
    if (r.vert === 'sub' || shifted === 'sub') m.sub = true
    if (r.code) m.code = true
    if (r.color && r.color !== base.color && (this.own || !(r.color === 'text' && !base.color))) m.color = r.color
    if (r.highlight) m.highlight = r.highlight
    if (!r.code || this.own) {
      const font = this.ownFont(r.font)
      if (font && font !== this.ownFont(base.font)) m.font = font
    }
    if (r.size && r.size !== base.size) m.size = r.size
    if (r.letterSpacing && r.letterSpacing !== (base.letterSpacing ?? 0)) m.letterSpacing = r.letterSpacing
    if (r.lang && (this.own || (r.lang !== this.docLang && r.lang !== base.lang))) m.lang = r.lang
    if (m.underline || (r.underline && base.underline)) {
      if (r.underlineStyle && r.underlineStyle !== base.underlineStyle) m.underlineStyle = r.underlineStyle
      if (r.underlineColor && r.underlineColor !== base.underlineColor) m.underlineColor = r.underlineColor
    }
    if (r.outline && !base.outline) m.outline = true
    if (r.shadow && !base.shadow) m.shadow = true
    if (r.glow && r.glow !== base.glow) m.glow = r.glow
    if (r.textBorder && r.textBorder !== base.textBorder) m.textBorder = r.textBorder
    if (r.textShading && r.textShading !== base.textShading) m.textShading = r.textShading
    return m
  }

  /** Mise en forme directe d'un paragraphe, sans répéter ce que son style donne déjà. */
  private paraOut(d: PProps, base: PProps, list = false): Raw {
    const o: Raw = {}
    const own = this.own
    if (own) base = {}
    const differs = (v: number | undefined, b: number | undefined) => v !== undefined && (own || Math.abs(v - (b ?? 0)) > 0.05)
    if (d.align && (own || d.align !== (base.align ?? 'left'))) o.align = d.align
    if (!list) {
      const ind: Raw = {}
      if (differs(d.left, base.left)) ind.left = d.left
      if (differs(d.right, base.right)) ind.right = d.right
      if (differs(d.first, base.first)) ind.first = d.first
      if (Object.keys(ind).length) o.indent = ind
    }
    const sp: Raw = {}
    if (differs(d.before, base.before)) sp.before = d.before
    if (differs(d.after, base.after)) sp.after = d.after
    if (Object.keys(sp).length) o.spacing = sp
    if (d.line !== undefined && (own || Math.abs(d.line - (base.line ?? lineFromWord(240))) > 0.01)) o.line = d.line
    if (d.keepNext && !base.keepNext) o.keepNext = true
    if (d.keepLines && !base.keepLines) o.keepLines = true
    if (d.pageBreakBefore && !base.pageBreakBefore) o.pageBreakBefore = true
    if (d.shading && d.shading !== base.shading) o.shading = d.shading
    if (d.border && d.border !== base.border) o.border = d.border
    return o
  }

  // --- thème, numérotation, notes, commentaires -----------------------------------

  private readTheme(): void {
    const root = this.xml(this.relOfType(this.mainPath, 'theme') ?? 'word/theme/theme1.xml')
    if (!root) return
    this.themeName = root.attrs.name ?? ''
    const scheme = path(root, 'a:themeElements', 'a:clrScheme')
    for (const c of scheme?.children ?? []) {
      const key = c.name.replace('a:', '')
      const v = colorOf(attr(child(c, 'a:srgbClr'), 'val')) ?? colorOf(attr(child(c, 'a:sysClr'), 'lastClr'))
      if (!v) continue
      const names: Record<string, string[]> = { dk1: ['dark1', 'text1'], lt1: ['light1', 'background1'], dk2: ['dark2', 'text2'], lt2: ['light2', 'background2'], hlink: ['hyperlink'], folHlink: ['followedHyperlink'] }
      for (const n of names[key] ?? [key]) this.themeColors[n] = v
    }
    const fonts = path(root, 'a:themeElements', 'a:fontScheme')
    const face = (n: string) => attr(path(fonts, n, 'a:latin'), 'typeface') || undefined
    this.themeFonts = { major: face('a:majorFont'), minor: face('a:minorFont') }
  }

  private readNumbering(): void {
    const root = this.xml(this.relOfType(this.mainPath, 'numbering') ?? 'word/numbering.xml')
    if (!root) return
    const abstracts = new Map<string, XmlNode>()
    for (const a of kids(root, 'w:abstractNum')) if (a.attrs['w:abstractNumId'] !== undefined) abstracts.set(a.attrs['w:abstractNumId'], a)
    // Une définition peut renvoyer à un style de liste, lui-même défini par une autre.
    const styled = new Map<string, XmlNode>()
    for (const a of abstracts.values()) {
      const link = attr(child(a, 'w:styleLink'))
      if (link) styled.set(link, a)
    }
    for (const n of kids(root, 'w:num')) {
      const id = num(n, 'w:numId')
      if (id === undefined) continue
      let abs = abstracts.get(attr(child(n, 'w:abstractNumId')) ?? '')
      const ref = attr(child(abs, 'w:numStyleLink'))
      if (abs && ref && !kids(abs, 'w:lvl').length && styled.has(ref)) abs = styled.get(ref)
      const overrides = new Map<number, { start?: number; lvl?: XmlNode }>()
      for (const o of kids(n, 'w:lvlOverride')) {
        const l = num(o, 'w:ilvl')
        if (l !== undefined) overrides.set(l, { start: num(child(o, 'w:startOverride')), lvl: child(o, 'w:lvl') })
      }
      this.nums.set(id, { abstract: abs, overrides })
    }
  }

  private level(numId: number, ilvl: number): { fmt: string; text: string; start: number; left?: number } | null {
    const n = this.nums.get(numId)
    if (!n) return null
    const o = n.overrides.get(ilvl)
    const lvl = o?.lvl ?? kids(n.abstract, 'w:lvl').find((l) => num(l, 'w:ilvl') === ilvl)
    if (!lvl) return { fmt: 'decimal', text: '', start: o?.start ?? 1 }
    const ind = path(lvl, 'w:pPr', 'w:ind')
    const left = numOf(first(ind, 'w:left', 'w:start'))
    return { fmt: attr(child(lvl, 'w:numFmt')) ?? 'decimal', text: attr(child(lvl, 'w:lvlText')) ?? '', start: o?.start ?? num(child(lvl, 'w:start')) ?? 1, left: left === undefined ? undefined : ptOfTwips(left) }
  }

  private readNotes(): void {
    for (const kind of ['foot', 'end'] as const) {
      const p = this.relOfType(this.mainPath, kind === 'foot' ? 'footnotes' : 'endnotes')
      const root = p ? this.xml(p) : undefined
      if (!root || !p) continue
      this.notePart[kind] = p
      for (const n of kids(root, kind === 'foot' ? 'w:footnote' : 'w:endnote')) {
        const type = n.attrs['w:type']
        if (type && type !== 'normal') continue
        if (n.attrs['w:id'] !== undefined) this.notes[kind].set(n.attrs['w:id'], n)
      }
    }
  }

  private readComments(): void {
    const p = this.relOfType(this.mainPath, 'comments')
    const root = p ? this.xml(p) : undefined
    if (!root) return
    // Réponses et résolution : partie « commentsExtended », reliée par l'identifiant du dernier paragraphe.
    const ext = new Map<string, { parent?: string; done: boolean }>()
    const extRoot = this.xml(this.relOfType(this.mainPath, 'commentsExtended') ?? 'word/commentsExtended.xml')
    for (const e of kids(extRoot, 'w15:commentEx')) {
      const id = e.attrs['w15:paraId']
      if (id) ext.set(id.toUpperCase(), { parent: e.attrs['w15:paraIdParent']?.toUpperCase(), done: e.attrs['w15:done'] === '1' })
    }
    const items: { id: string; author: string; date: string; text: string; para: string }[] = []
    for (const c of kids(root, 'w:comment')) {
      const id = c.attrs['w:id']
      if (id === undefined || items.length >= 5000) continue
      const paras = descendants(c, 'w:p')
      const joined = paras.map((p2) => this.plainText(p2)).join('\n')
      const text = this.own ? joined : joined.trim()
      const date = c.attrs['w:date'] && !Number.isNaN(Date.parse(c.attrs['w:date'])) ? new Date(c.attrs['w:date']).toISOString() : ''
      items.push({ id, author: (c.attrs['w:author'] ?? '').slice(0, 100), date, text, para: (paras[paras.length - 1]?.attrs['w14:paraId'] ?? '').toUpperCase() })
    }
    const byPara = new Map(items.filter((i) => i.para).map((i) => [i.para, i]))
    const roots = new Map<string, Raw>()
    for (const it of items) {
      const e = ext.get(it.para)
      const parent = e?.parent ? byPara.get(e.parent) : undefined
      if (parent && parent !== it) continue
      const key = `c${it.id}`.replace(/[^A-Za-z0-9_-]/g, '')
      const thread: Raw = { id: key, author: it.author, date: it.date, text: it.text, resolved: !!e?.done, replies: [] }
      roots.set(it.id, thread)
      this.threadOf.set(it.id, key)
      this.threads.push(thread)
    }
    for (const it of items) {
      const e = ext.get(it.para)
      let parent = e?.parent ? byPara.get(e.parent) : undefined
      // Une réponse à une réponse appartient au même fil.
      for (let guard = 0; parent && !roots.has(parent.id) && guard < 20; guard++) {
        const up = ext.get(parent.para)?.parent
        parent = up ? byPara.get(up) : undefined
      }
      if (!parent || parent === it || !roots.has(parent.id)) continue
      ;(roots.get(parent.id)!.replies as Raw[]).push({ author: it.author, date: it.date, text: it.text })
      this.threadOf.set(it.id, this.threadOf.get(parent.id)!)
    }
  }

  /** Texte d'un paragraphe, sans mise en forme (commentaires, code). */
  private plainText(p: XmlNode): string {
    let s = ''
    const visit = (n: XmlNode) => {
      for (const c of n.children) {
        if (c.name === 'w:t' || c.name === 'w:delText') s += c.text
        else if (c.name === 'w:tab') s += '\t'
        else if (c.name === 'w:br' || c.name === 'w:cr') s += '\n'
        else if (c.name !== 'w:pPr' && c.name !== 'w:rPr' && c.name !== 'w:instrText') visit(c)
      }
    }
    visit(p)
    return s
  }

  // --- images ---------------------------------------------------------------------

  /** Image d'une relation → « asset:id », ou null (et la perte est comptée). */
  private picture(rid: string | undefined): string | null {
    const rel = rid ? this.rels(this.part).get(rid) : undefined
    if (!rel || rel.external) {
      this.lose('image-missing')
      return null
    }
    const known = this.assetOf.get(rel.target)
    if (known !== undefined) {
      if (known === null) this.lose('image-format')
      return known
    }
    const bytes = this.zip.bytes(rel.target)
    if (!bytes) {
      this.lose(this.zip.skipped.has(rel.target) ? 'image-large' : 'image-missing')
      return null
    }
    const kind = sniffImage(bytes)
    if (!kind) {
      // EMF, WMF, TIFF… : les navigateurs ne les affichent pas.
      this.assetOf.set(rel.target, null)
      this.lose('image-format')
      return null
    }
    const id = `img${this.assetOf.size + 1}`
    const size = imageSize(bytes)
    if (size) this.naturalSize.set(`asset:${id}`, size)
    this.assets[id] = `data:image/${kind};base64,${base64(bytes)}`
    this.assetOf.set(rel.target, `asset:${id}`)
    return `asset:${id}`
  }

  /** Dessin (image, zone de texte, graphique…) rencontré dans un passage. */
  /** Filigrane d'un en-tête (forme VML) → réglage du document (le premier trouvé). */
  private readWatermark(mark: XmlNode): void {
    if (!this.watermark) {
      const style = mark.attrs.style ?? ''
      const textpath = descendants(mark, 'v:textpath')[0]
      const fill = descendants(mark, 'v:fill')[0]
      const opacity = fill?.attrs.opacity ? Math.round(parseFloat(fill.attrs.opacity) * (fill.attrs.opacity.endsWith('f') ? 100 / 65536 : 100)) : 50
      const diagonal = /rotation:\s*(315|-45|45|225)/.test(style)
      const imageRel = descendants(mark, 'v:imagedata')[0]?.attrs['r:id']
      const img = imageRel ? this.picture(imageRel) : null
      const color = colorOf((mark.attrs.fillcolor ?? '').replace(/^#/, '')) ?? (/silver/i.test(mark.attrs.fillcolor ?? '') ? '#c0c0c0' : undefined)
      if (textpath?.attrs.string) this.watermark = { text: textpath.attrs.string.slice(0, 60), ...(color ? { color } : {}), diagonal, opacity: Math.max(5, Math.min(100, opacity || 50)) }
      else if (img) this.watermark = { image: img, diagonal: false, opacity: 100 }
    }
  }

  private drawing(node: XmlNode, s: Inline): void {
    if (node.name === 'mc:AlternateContent') {
      const choice = child(node, 'mc:Choice')
      const usable = (n: XmlNode | undefined) => !!n && (descendants(n, 'a:blip').length > 0 || descendants(n, 'v:imagedata').length > 0 || descendants(n, 'w:txbxContent').length > 0)
      const pick = usable(choice) ? choice : (child(node, 'mc:Fallback') ?? choice)
      for (const c of pick?.children ?? []) this.drawing(c, s)
      return
    }
    // Filigrane (forme VML d'un en-tête, « PowerPlusWaterMarkObject ») : un réglage du document, pas une image.
    const mark = descendants(node, 'v:shape').find((v) => /watermark/i.test(v.attrs.id ?? ''))
    if (mark) {
      this.readWatermark(mark)
      return
    }
    const blip = descendants(node, 'a:blip')[0]
    const vml = descendants(node, 'v:imagedata')[0]
    if (blip || vml) {
      // Un dessin vectoriel est rangé à côté de son image de repli : c'est lui qu'on reprend.
      const svg = blip ? descendants(blip, 'asvg:svgBlip')[0]?.attrs['r:embed'] : undefined
      const src = this.picture(blip ? (svg ?? blip.attrs['r:embed'] ?? blip.attrs['r:link']) : (vml.attrs['r:id'] ?? vml.attrs['o:relid']))
      if (node.name === 'w:object') this.lose('object')
      if (!src) {
        s.dropped = true
        return
      }
      const img: Raw = { type: 'image', src }
      const pr = descendants(node, 'wp:docPr')[0]
      const alt = (pr?.attrs.descr || pr?.attrs.title || vml?.attrs['o:title'] || '').slice(0, 1000)
      if (alt) img.alt = alt
      const extent = descendants(node, 'wp:extent')[0]
      const cx = numOf(extent?.attrs.cx)
      const cy = numOf(extent?.attrs.cy)
      if (cx && cx > 0) img.width = Math.min(2000, ptOfEmu(cx))
      // Nos propres fichiers : une image à sa taille naturelle le reste (largeur 0).
      const natural = this.naturalSize.get(src)
      const cropNode = descendants(node, 'a:srcRect')[0]
      const kept = 1 - ((numOf(cropNode?.attrs.l) ?? 0) + (numOf(cropNode?.attrs.r) ?? 0)) / 100000
      if (this.own && natural && typeof img.width === 'number' && Math.abs(img.width - natural.width * kept * 0.75) < 0.8) img.width = 0
      if (!(cx && cx > 0) && vml) {
        const style = descendants(node, 'v:shape')[0]?.attrs.style ?? ''
        const w = /(?:^|;)\s*width:\s*([0-9.]+)(pt|in|px|cm|mm)?/i.exec(style)
        if (w) img.width = Math.min(2000, Number(w[1]) * ({ in: 72, px: 0.75, cm: 28.35, mm: 2.835 }[w[2]?.toLowerCase() as 'in'] ?? 1))
      }
      const rect = descendants(node, 'a:srcRect')[0]
      if (rect) {
        const pc = (k: string) => Math.max(0, Math.min(95, (numOf(rect.attrs[k]) ?? 0) / 1000))
        const crop = { top: pc('t'), right: pc('r'), bottom: pc('b'), left: pc('l') }
        if (crop.top || crop.right || crop.bottom || crop.left) img.crop = crop
      }
      const xfrm = descendants(node, 'a:xfrm')[0]
      const rot = Math.round((((numOf(xfrm?.attrs.rot) ?? 0) / 60000) % 360) / 90) * 90
      if (rot === 90 || rot === 180 || rot === 270) img.rotate = rot
      const on = (v: string | undefined) => v === '1' || v === 'true'
      const flip = `${on(xfrm?.attrs.flipH) ? 'h' : ''}${on(xfrm?.attrs.flipV) ? 'v' : ''}`
      if (flip) img.flip = flip
      const outline = colorOf(attr(path(descendants(node, 'pic:spPr')[0], 'a:ln', 'a:solidFill', 'a:srgbClr'), 'val'))
      if (outline) img.border = outline
      // Hauteur donnée seulement si l'image est déformée par rapport à ses proportions (rognage compris).
      const nat = this.naturalSize.get(src)
      if (nat && cx && cy && cx > 0 && cy > 0) {
        const crop = (img.crop as { top: number; right: number; bottom: number; left: number } | undefined) ?? { top: 0, right: 0, bottom: 0, left: 0 }
        const ratio = (nat.width * (1 - (crop.left + crop.right) / 100)) / Math.max(0.01, nat.height * (1 - (crop.top + crop.bottom) / 100))
        const expected = ptOfEmu(cx) / ratio
        if (Math.abs(cx / cy / ratio - 1) > 0.03 && Math.abs(expected - ptOfEmu(cy)) > 1) img.height = Math.min(2000, ptOfEmu(cy))
      }
      const anchor = descendants(node, 'wp:anchor')[0]
      img.align = s.align === 'center' || s.align === 'right' ? s.align : 'left'
      if (anchor) {
        const side = textOf(path(anchor, 'wp:positionH', 'wp:align')).trim()
        const wraps = !!(child(anchor, 'wp:wrapSquare') || child(anchor, 'wp:wrapTight') || child(anchor, 'wp:wrapThrough'))
        if (wraps && (side === 'left' || side === 'right')) img.wrap = side
        else if (side === 'center' || side === 'right') img.align = side
      }
      s.split(img)
      return
    }
    const boxes = descendants(node, 'w:txbxContent')
    if (boxes.length) {
      // Zone de texte : son texte est gardé, à la suite du paragraphe.
      this.lose('textbox')
      for (const b of boxes) s.after.push(...this.walk(b.children, s.ctx))
      return
    }
    s.dropped = true
    if (descendants(node, 'c:chart').length) this.lose('chart')
    else if (node.name === 'w:object') this.lose('object')
    else this.lose('drawing')
  }

  // --- champs ---------------------------------------------------------------------

  private get suppressed(): boolean {
    return this.fields.some((f) => f.suppress)
  }

  /** Champ reconnu → élément Folio Pages ; sinon null (son résultat reste du texte). */
  private fieldOf(instr: string): { field?: Raw; link?: string; toc?: Raw; benign?: boolean } {
    const m = /^\s*([A-Za-z]+)\b(.*)$/s.exec(instr)
    if (!m) return { benign: true }
    const name = m[1].toUpperCase()
    const rest = m[2]
    const pic = /\\@\s*"([^"]*)"/.exec(rest)?.[1] ?? /\\@\s*(\S+)/.exec(rest)?.[1]
    // Dans nos propres fichiers, « MERGEFORMAT » marque un champ de date sans format choisi.
    const usual = this.own && /\\\*\s*MERGEFORMAT/i.test(rest)
    const dated = (n: string) => ({ field: { type: 'field', name: n, ...(pic && !usual ? { format: dateFormatFromWord(pic) } : {}) } })
    switch (name) {
      case 'PAGE':
        return { field: { type: 'field', name: 'page' } }
      case 'NUMPAGES':
      case 'SECTIONPAGES':
        return { field: { type: 'field', name: 'pages' } }
      case 'DATE':
        return dated('date')
      case 'TIME':
        return dated('time')
      case 'CREATEDATE':
        return dated('created')
      case 'SAVEDATE':
        return dated('modified')
      case 'TITLE':
        return { field: { type: 'field', name: 'title' } }
      case 'AUTHOR':
        return { field: { type: 'field', name: 'author' } }
      case 'SUBJECT':
        return { field: { type: 'field', name: 'subject' } }
      case 'KEYWORDS':
        return { field: { type: 'field', name: 'keywords' } }
      case 'FILENAME':
        return { field: { type: 'field', name: 'filename' } }
      case 'MERGEFIELD': {
        const field = /^\s*"([^"]{1,80})"/.exec(rest)?.[1] ?? /^\s*([^\s\\"]{1,80})/.exec(rest)?.[1]
        return field ? { field: { type: 'mergefield', name: field.trim() } } : { benign: true }
      }
      case 'ADDRESSBLOCK': {
        const opts: Record<string, string> = { company: /\\c\s*0/.test(rest) ? 'no' : 'yes' }
        const home = /\\e\s*"([^"]*)"/.exec(rest)
        opts.country = home ? 'foreign' : /\\d/.test(rest) ? 'always' : 'never'
        if (home && home[1]) opts.home = home[1].slice(0, 80)
        return { field: { type: 'mergefield', name: '@address', opts } }
      }
      case 'GREETINGLINE': {
        const fmt = /\\f\s*"([^"]*)"/.exec(rest)?.[1] ?? ''
        const before = /<<_BEFORE_ ([^>]*)>>/.exec(fmt)?.[1]?.trim()
        const after = /<<_AFTER_ ([^>]*)>>/.exec(fmt)?.[1] ?? ','
        const nameFormat = /_FIRST0_/.test(fmt) && /_LAST0_/.test(fmt) ? 'full' : /_TITLE0_/.test(fmt) && /_LAST0_/.test(fmt) ? 'title-last' : /_LAST0_/.test(fmt) ? 'last' : 'first'
        const fallback = /\\e\s*"([^"]*)"/.exec(rest)?.[1]
        return { field: { type: 'mergefield', name: '@greeting', opts: { ...(before ? { salutation: before.slice(0, 80) } : {}), nameFormat, punct: after.trim().slice(0, 4), ...(fallback ? { fallback: fallback.slice(0, 200) } : {}) } } }
      }
      case 'MERGEREC':
        return { field: { type: 'mergefield', name: '@record' } }
      case 'MERGESEQ':
        return { field: { type: 'mergefield', name: '@sequence' } }
      case 'NEXT':
        return { field: { type: 'mergefield', name: '@next' } }
      case 'FILLIN': {
        const promptText = /^\s*"([^"]*)"/.exec(rest)?.[1] ?? ''
        const def = /\\d\s*"([^"]*)"/.exec(rest)?.[1]
        return { field: { type: 'mergefield', name: '@fillin', opts: { prompt: promptText.slice(0, 300), ...(def ? { default: def.slice(0, 500) } : {}) } } }
      }
      case 'IF':
      case 'SKIPIF':
      case 'NEXTIF': {
        // Condition : { MERGEFIELD x } op "valeur" (puis, pour IF, "alors" "sinon").
        const m2 = /\{MERGEFIELD\s+"?([^"}]+?)"?(?:\s+\\[^}]*)?\}\s*(<>|<=|>=|=|<|>)\s*"([^"]*)"\s*(?:"([^"]*)"\s*(?:"([^"]*)")?)?/.exec(rest)
        if (!m2) return {}
        const ops: Record<string, string> = { '=': 'eq', '<>': 'ne', '<': 'lt', '>': 'gt', '<=': 'le', '>=': 'ge' }
        let op = ops[m2[2]] ?? 'eq'
        let value = m2[3]
        if (value === '' && (op === 'eq' || op === 'ne')) op = op === 'eq' ? 'empty' : 'notEmpty'
        else if (op === 'eq' && /^\*.*\*$/.test(value)) {
          op = 'contains'
          value = value.slice(1, -1)
        }
        const opts: Record<string, string> = { field: m2[1].trim().slice(0, 80), op, ...(value ? { value: value.slice(0, 500) } : {}) }
        if (name === 'IF') {
          if (m2[4]) opts.then = m2[4].slice(0, 2000)
          if (m2[5]) opts.else = m2[5].slice(0, 2000)
        }
        return { field: { type: 'mergefield', name: name === 'IF' ? '@if' : name === 'SKIPIF' ? '@skipif' : '@nextif', opts } }
      }
      case 'HYPERLINK': {
        const url = /^\s*"([^"]+)"/.exec(rest.replace(/\\[a-z]\s+"[^"]*"/gi, ''))?.[1] ?? ''
        return SAFE_LINK.test(url) ? { link: url } : { benign: true }
      }
      case 'SEQ': {
        const id = /^\s*"?([^\s"\\]{1,40})/.exec(rest)?.[1]
        if (!id || /\\[hc]\b/.test(rest)) return { benign: true }
        return { field: { type: 'seq', label: seqLabel(id) } }
      }
      case 'REF':
      case 'PAGEREF': {
        const target = /^\s*"?([^\s"\\]{1,40})/.exec(rest)?.[1] ?? ''
        if (!keepBookmark(target) || !this.knownBookmarks().has(target) || /\\f\b/.test(rest)) return { benign: true }
        const own = this.ownRefs?.xrefShows?.[this.xrefCount++]
        const show = name === 'PAGEREF' ? 'page' : own && ['text', 'label', 'number', 'above'].includes(own) ? own : /\\p\b/.test(rest) ? 'above' : /\\[nrw]\b/.test(rest) ? 'number' : 'text'
        return { field: { type: 'xref', target, show } }
      }
      case 'XE': {
        const raw = /^\s*"((?:[^"\\]|\\.)*)"/.exec(rest)?.[1] ?? ''
        const parts = raw.split(/(?<!\\):/).map((x) => x.replace(/\\:/g, ':').trim())
        if (!parts[0]) return { benign: true }
        const see = /\\t\s*"([^"]*)"/.exec(rest)?.[1]?.replace(/^\s*(voir|see)\s+/i, '')
        return { field: { type: 'xe', term: parts[0].slice(0, 300), ...(parts[1] ? { sub: parts[1].slice(0, 300) } : {}), ...(see ? { see: see.slice(0, 300) } : {}), ...(/\\b\b/.test(rest) ? { bold: true } : {}), ...(/\\i\b/.test(rest) ? { italic: true } : {}) } }
      }
      case 'TA': {
        const long = /\\l\s*"([^"]*)"/.exec(rest)?.[1]?.trim()
        if (!long) return { benign: true }
        const short = /\\s\s*"([^"]*)"/.exec(rest)?.[1]?.trim()
        const cat = Number(/\\c\s*"?(\d+)/.exec(rest)?.[1] ?? 1)
        return { field: { type: 'xe', term: long.slice(0, 300), authority: AUTHORITY_CATEGORIES[cat - 1] ?? 'other', ...(short ? { short: short.slice(0, 300) } : {}) } }
      }
      case 'CITATION': {
        const ids = [/^\s*"?([^\s"\\]{1,64})/.exec(rest)?.[1] ?? '', ...[...rest.matchAll(/\\m\s+"?([^\s"\\]{1,64})/g)].map((m) => m[1])].filter(Boolean)
        const known = new Set(this.sourceList().map((x) => String(x.id)))
        if (!ids.length || !ids.every((id) => known.has(id))) return { benign: true }
        const locator = /\\p\s*"([^"]*)"/.exec(rest)?.[1] ?? /\\p\s+(\S+)/.exec(rest)?.[1]
        return { field: { type: 'cite', ids: [...new Set(ids)].slice(0, 20), ...(locator ? { locator: locator.slice(0, 60) } : {}) } }
      }
      case 'INDEX':
        return { toc: { type: 'index', columns: Math.max(1, Math.min(3, Number(/\\c\s*"?(\d)/.exec(rest)?.[1] ?? 2))) } }
      case 'TOA': {
        const cat = Number(/\\c\s*"?(\d+)/.exec(rest)?.[1] ?? 0)
        return { toc: { type: 'authorities', category: AUTHORITY_CATEGORIES[cat - 1] ?? 'all' } }
      }
      case 'BIBLIOGRAPHY':
        return { toc: { type: 'bibliography' } }
      case 'TOC': {
        const caption = /\\[ac]\s*"?([^\s"\\]{1,40})/.exec(rest)?.[1]
        if (caption) return { toc: { type: 'figures', label: seqLabel(caption) } }
        const range = /\\o\s*"(\d)-(\d)"/.exec(rest)
        return { toc: { type: 'toc', levels: range ? Math.max(1, Math.min(6, Number(range[2]))) : 3 } }
      }
      // Renvois et mises en forme : leur résultat tel qu'il est écrit convient.
      case 'NOTEREF':
      case 'STYLEREF':
      case 'FORMTEXT':
      case 'FORMCHECKBOX':
      case 'FORMDROPDOWN':
      case 'QUOTE':
      case 'SYMBOL':
      case 'EQ':
        return { benign: true }
      default:
        return {}
    }
  }

  /** Signets du corps du document (lu une fois). */
  private knownBookmarks(): Set<string> {
    if (!this.bookmarkNames) {
      const root = this.xml(this.mainPath)
      this.bookmarkNames = new Set(root ? descendants(root, 'w:bookmarkStart').map((b) => b.attrs['w:name'] ?? '').slice(0, 20_000) : [])
    }
    return this.bookmarkNames
  }

  /** Sources : les nôtres (exactes), sinon celles du gestionnaire de sources de Word. */
  private sourceList(): Raw[] {
    const own = this.ownRefs?.sources
    return Array.isArray(own) ? (own as Raw[]) : this.wordSources
  }

  private fieldBegin(r: RProps): void {
    if (this.fields.length < 50) this.fields.push({ instr: '', phase: 'instr', suppress: false, r, done: false })
  }

  /** Fin des instructions d'un champ : il est reconnu (ou non), son résultat suit. */
  private fieldResolve(f: Field, s: Inline): void {
    if (f.done) return
    f.done = true
    f.phase = 'result'
    // Un champ dans les instructions d'un autre (IF { MERGEFIELD x } = …) : il en fait partie.
    const at = this.fields.indexOf(f)
    const parent = at > 0 ? this.fields[at - 1] : null
    if (parent && parent.phase === 'instr') {
      if (parent.instr.length < 4000) parent.instr += ` {${f.instr.trim()}} `
      f.suppress = true
      return
    }
    const got = this.fieldOf(f.instr)
    if (got.field) {
      if (!this.suppressed) this.push({ ...got.field, ...this.marks(f.r, s.style.r) }, s)
      f.suppress = true
    } else if (got.toc) {
      if (!this.suppressed && !s.ctx.note && !s.ctx.hf) s.split(got.toc)
      f.suppress = true
    } else if (got.link) f.link = got.link
    else if (!got.benign && !this.suppressed) this.lose('field')
  }

  // --- éléments en ligne ----------------------------------------------------------

  private push(item: Raw, s: Inline): void {
    const extra: Raw = {}
    const link = s.link ?? [...this.fields].reverse().find((f) => f.link)?.link
    if (link && (item.type === undefined || item.type === 'field')) extra.link = link
    if (s.deleted) extra.deleted = s.deleted
    else if (s.inserted) extra.inserted = s.inserted
    if (this.activeComments.size && !s.ctx.note && !s.ctx.hf) {
      extra.comments = [...this.activeComments]
      for (const id of this.activeComments) this.anchored.add(id)
    }
    const out: Raw = { ...item, ...extra }
    if (s.ctx.plain) {
      if (s.ctx.plain.bold) delete out.bold
      if (s.ctx.plain.color && out.color === s.ctx.plain.color) delete out.color
    }
    s.content.push(out)
    this.lastRun = out
  }

  private text(text: string, r: RProps & { code?: boolean }, s: Inline): void {
    if (!text || this.suppressed) return
    if (this.fields.length && this.fields[this.fields.length - 1].phase === 'instr') return
    if (r.vanish) {
      this.lose('hidden-text')
      return
    }
    if (s.trimStart) {
      // Un traitement de texte met une espace entre le numéro de la note et son texte.
      s.trimStart = false
      text = text.replace(/^[ \t]/, '')
      if (!text) return
    }
    this.push({ text, ...this.marks(r, s.style.r) }, s)
  }

  private change(n: XmlNode): Raw {
    const d = n.attrs['w:date']
    return { author: (n.attrs['w:author'] ?? '').slice(0, 100), date: d && !Number.isNaN(Date.parse(d)) ? new Date(d).toISOString() : '' }
  }

  private runNode(r: XmlNode, s: Inline): void {
    const rp = this.runProps(child(r, 'w:rPr'))
    let buf = ''
    const flush = () => {
      if (buf) this.text(buf, rp, s)
      buf = ''
    }
    for (const c of r.children) {
      switch (c.name) {
        case 'w:t':
        case 'w:delText':
          buf += c.text
          break
        case 'w:tab':
        case 'w:ptab':
          buf += '\t'
          break
        case 'w:cr':
          buf += '\n'
          break
        case 'w:noBreakHyphen':
          buf += '‑'
          break
        case 'w:softHyphen':
          buf += '­'
          break
        case 'w:br': {
          const type = c.attrs['w:type']
          if (type === 'page' || type === 'column') {
            flush()
            if (!this.suppressed && !s.ctx.note && !s.ctx.hf) s.split({ type: type === 'page' ? 'pagebreak' : 'columnbreak' })
          } else buf += '\n'
          break
        }
        case 'w:sym': {
          // Caractère d'une police de symboles : sans la police, on ne sait pas lequel c'est.
          const code = parseInt(c.attrs['w:char'] ?? '', 16)
          if (Number.isFinite(code) && code >= 0x20 && !(code >= 0xe000 && code <= 0xf8ff)) buf += String.fromCodePoint(code)
          else if (!this.suppressed) this.lose('symbol')
          break
        }
        case 'w:fldChar': {
          flush()
          const type = c.attrs['w:fldCharType']
          const top = this.fields[this.fields.length - 1]
          if (type === 'begin') this.fieldBegin(rp)
          else if (type === 'separate' && top) this.fieldResolve(top, s)
          else if (type === 'end' && top) {
            this.fieldResolve(top, s)
            this.fields.pop()
          }
          break
        }
        case 'w:instrText':
        case 'w:delInstrText': {
          const top = this.fields[this.fields.length - 1]
          if (top && top.phase === 'instr' && top.instr.length < 4000) top.instr += c.text
          break
        }
        case 'w:footnoteReference':
        case 'w:endnoteReference': {
          flush()
          if (c.attrs['w:customMarkFollows'] === '1') break
          const kind = c.name === 'w:footnoteReference' ? 'foot' : 'end'
          const node = this.notes[kind].get(c.attrs['w:id'] ?? '')
          if (!node || s.ctx.note || s.ctx.hf || this.suppressed) break
          const saved = { fields: this.fields, active: this.activeComments, last: this.lastRun }
          this.fields = []
          this.activeComments = new Set()
          const blocks = this.inPart(this.notePart[kind], () => this.assemble(this.walk(node.children, { note: true })))
          this.fields = saved.fields
          this.activeComments = saved.active
          this.lastRun = saved.last
          s.content.push({ type: 'note', kind, blocks })
          break
        }
        case 'w:commentReference': {
          // Commentaire sans étendue : il porte sur le texte qui précède sa marque.
          const id = this.threadOf.get(c.attrs['w:id'] ?? '')
          if (id && !this.anchored.has(id) && this.own && !s.content.length) s.dropped = true
          if (id && !this.anchored.has(id) && this.lastRun && !s.ctx.note && !s.ctx.hf) {
            flush()
            const cur = (this.lastRun.comments as string[] | undefined) ?? []
            if (s.content.includes(this.lastRun)) {
              this.lastRun.comments = [...new Set([...cur, id])]
              this.anchored.add(id)
            }
          }
          break
        }
        case 'w:drawing':
        case 'w:pict':
        case 'w:object':
        case 'mc:AlternateContent':
          flush()
          if (!this.suppressed) this.drawing(c, s)
          break
      }
    }
    flush()
  }

  private inline(nodes: XmlNode[], s: Inline): void {
    for (const n of nodes) {
      switch (n.name) {
        case 'w:r':
          this.runNode(n, s)
          break
        case 'w:hyperlink': {
          const rel = n.attrs['r:id'] ? this.rels(this.part).get(n.attrs['r:id']) : undefined
          const href = rel?.external && SAFE_LINK.test(rel.target) ? rel.target.slice(0, 2048) : undefined
          const prev = s.link
          if (href) s.link = href
          this.inline(n.children, s)
          s.link = prev
          break
        }
        case 'w:ins':
        case 'w:moveTo': {
          const prev = s.inserted
          s.inserted = this.change(n)
          this.inline(n.children, s)
          s.inserted = prev
          break
        }
        case 'w:del':
        case 'w:moveFrom': {
          const prev = s.deleted
          s.deleted = this.change(n)
          this.inline(n.children, s)
          s.deleted = prev
          break
        }
        case 'w:fldSimple': {
          const f: Field = { instr: n.attrs['w:instr'] ?? '', phase: 'instr', suppress: false, r: this.runProps(path(n, 'w:r', 'w:rPr')), done: false }
          this.fields.push(f)
          this.fieldResolve(f, s)
          this.inline(n.children, s)
          this.fields.pop()
          break
        }
        case 'w:commentRangeStart': {
          const id = this.threadOf.get(n.attrs['w:id'] ?? '')
          if (id) this.activeComments.add(id)
          break
        }
        case 'w:bookmarkStart': {
          // Signets : sauf ceux que le traitement de texte pose pour lui-même (_GoBack, _Toc…).
          const name = n.attrs['w:name'] ?? ''
          if (!this.suppressed && !s.ctx.note && !s.ctx.hf && keepBookmark(name)) s.content.push({ type: 'bookmark', name })
          break
        }
        case 'w:commentRangeEnd': {
          const id = this.threadOf.get(n.attrs['w:id'] ?? '')
          if (id) this.activeComments.delete(id)
          break
        }
        case 'm:oMath':
        case 'm:oMathPara': {
          // Équation : convertie en LaTeX ; centrée (m:oMathPara) seule dans son paragraphe → équation centrée.
          // Une formule supprimée (suivi des modifications) : elle n'est plus là.
          if (this.suppressed || s.deleted) break
          const display = n.name === 'm:oMathPara'
          for (const m of display ? kids(n, 'm:oMath') : [n]) {
            const tex = this.texOfMath(m)
            if (tex) this.push({ type: 'math', tex, ...(display ? { display: true } : {}) }, s)
            else if (descendants(m, 'm:t').some((x) => x.text.trim())) {
              this.lose('equation')
              this.push({ text: descendants(m, 'm:t').map((x) => x.text).join(''), italic: true }, s)
            }
          }
          break
        }
        case 'w:smartTag':
        case 'w:customXml':
        case 'w:dir':
        case 'w:bdo':
          this.inline(n.children, s)
          break
        case 'w:sdt':
          this.inline(child(n, 'w:sdtContent')?.children ?? [], s)
          break
        case 'mc:AlternateContent':
          if (!this.suppressed) this.drawing(n, s)
          break
      }
    }
  }

  // --- paragraphes, tableaux, blocs -----------------------------------------------

  private paragraph(p: XmlNode, ctx: Ctx, trimStart = false): Entry[] {
    const pPr = child(p, 'w:pPr')
    const direct = this.pProps(pPr)
    const style = this.paraStyle(direct.pStyle)
    const out: Entry[] = []
    const startedSuppressed = this.suppressed
    const numId = direct.numId ?? style.p.numId
    const ilvl = direct.ilvl ?? style.p.ilvl ?? 0
    const lvl = numId ? this.level(numId, ilvl) : null
    const isItem = !!numId && !!lvl && lvl.fmt !== 'none' && !style.heading
    if (style.heading && numId && lvl && lvl.fmt !== 'none') this.lose('heading-number')
    let pieces = 0
    const s: Inline = { content: [], after: [], style, ctx, trimStart, split: () => undefined, align: direct.align ?? style.p.align ?? 'left' }
    const emit = (final: boolean) => {
      const content = s.content
      s.content = []
      // Un paragraphe coupé par une image ou un saut ne laisse pas de morceau vide.
      if (!content.length && (pieces > 0 || !final)) return
      if (!content.length && (startedSuppressed || this.suppressed || out.length || s.dropped || s.after.length)) return
      pieces++
      const props = this.paraOut(direct, style.p, isItem)
      if (direct.lineExact !== undefined && direct.line === undefined) {
        const size = style.r.size ?? 11
        props.line = Math.max(0.5, Math.min(10, Math.round((direct.lineExact / size) * 100) / 100))
      }
      const eq = !isItem && !style.heading && style.role !== 'code' ? equationOf(content) : null
      if (eq) {
        out.push({ k: 'block', block: eq })
        return
      }
      for (const x of content) if (x.type === 'math') delete x.display
      if (isItem) out.push({ k: 'li', numId: numId!, level: ilvl, content, props, indent: direct.left ?? style.p.left ?? lvl!.left ?? 18 * (ilvl + 1) })
      else if (style.heading) out.push({ k: 'p', block: { type: 'heading', level: style.heading, content, ...props } })
      else if (style.role === 'code') out.push({ k: 'code', text: content.map((x) => (typeof x.text === 'string' ? x.text : '')).join('') })
      else if ((direct.ruleBelow || style.role === 'rule') && !content.length) out.push({ k: 'block', block: { type: 'divider' } })
      else {
        const block: Raw = { type: 'paragraph', content, ...props }
        const implied = style.folio === 'normal' || style.role === 'quote' || style.role === 'tocHeading' || style.role === 'rule' || (ctx.note && style.folio === 'footnote') || (ctx.hf && !!style.custom)
        if (!implied) {
          block.style = style.folio
          if (style.custom) this.customUsed.set(style.custom, style.folio)
        }
        out.push({ k: 'p', block, ...(style.role && style.role !== 'rule' ? { role: style.role } : {}) })
      }
    }
    s.split = (block) => {
      emit(false)
      out.push({ k: 'block', block })
      pieces++
    }
    this.inline(p.children, s)
    emit(true)
    out.push(...s.after)
    return out
  }

  private table(tbl: XmlNode, ctx: Ctx): Raw {
    const tblPr = child(tbl, 'w:tblPr')
    const styleId = attr(child(tblPr, 'w:tblStyle'))
    const ownStyle = this.own ? tableStyleOfId(styleId) : null
    // Grille : la colonne de départ de chaque cellule, et les fusions verticales.
    interface Cell {
      node: XmlNode
      col: number
      span: number
      rowspan: number
      merge: 'restart' | 'continue' | null
      fill: string | null
    }
    const grid: Cell[][] = []
    let header = false
    /** Ligne d'en-tête répétée sur chaque page (« tblHeader »). */
    let repeat = false
    kids(tbl, 'w:tr')
      .slice(0, 5000)
      .forEach((tr, r) => {
        const trPr = child(tr, 'w:trPr')
        if (r === 0 && child(trPr, 'w:tblHeader') && onOff(child(trPr, 'w:tblHeader'))) header = repeat = true
        let col = num(child(trPr, 'w:gridBefore')) ?? 0
        const row: Cell[] = []
        const cells: XmlNode[] = []
        for (const c of tr.children) {
          if (c.name === 'w:tc') cells.push(c)
          else if (c.name === 'w:sdt') cells.push(...kids(child(c, 'w:sdtContent'), 'w:tc'))
        }
        for (const tc of cells) {
          const pr = child(tc, 'w:tcPr')
          const span = Math.max(1, Math.min(100, num(child(pr, 'w:gridSpan')) ?? 1))
          const vm = child(pr, 'w:vMerge')
          row.push({ node: tc, col, span, rowspan: 1, merge: vm ? (attr(vm) === 'restart' ? 'restart' : 'continue') : null, fill: this.themed(child(pr, 'w:shd'), 'w:fill', 'w:themeFill') })
          col += span
        }
        if (row.length) grid.push(row)
      })
    // Les cellules « suite » d'une fusion verticale allongent la cellule d'origine.
    const origin = new Map<number, Cell>()
    for (const row of grid) {
      const seen = new Set<number>()
      for (const c of row) {
        seen.add(c.col)
        const up = origin.get(c.col)
        if (c.merge === 'continue' && up && up.span === c.span) up.rowspan++
        else {
          if (c.merge === 'continue') c.merge = null
          origin.set(c.col, c)
        }
      }
      for (const k of [...origin.keys()]) if (!seen.has(k)) origin.delete(k)
    }
    const real = grid.map((row) => row.filter((c) => c.merge !== 'continue')).filter((row) => row.length)
    // Ligne d'en-tête et bandes données par le style du tableau (« tblLook » dit lesquelles sont actives).
    const lookNode = child(tblPr, 'w:tblLook')
    const bits = parseInt(lookNode?.attrs['w:val'] ?? '', 16) || 0
    const lookOn = (name: string, bit: number) => {
      const v = lookNode?.attrs[name]
      return v !== undefined ? v === '1' || v === 'true' : (bits & bit) !== 0
    }
    const cond = (type: string): XmlNode | undefined => {
      const seen = new Set<string>()
      let cur = styleId
      while (cur && !seen.has(cur) && seen.size < 10) {
        seen.add(cur)
        const st = this.styles.get(cur)
        const hit = kids(st?.node, 'w:tblStylePr').find((x) => x.attrs['w:type'] === type)
        if (hit) return hit
        cur = st?.basedOn
      }
      return undefined
    }
    if (!header && !ownStyle && lookNode && lookOn('w:firstRow', 0x20) && cond('firstRow')) header = true
    // Nos fichiers : la ligne d'en-tête est dite par « tblLook » (sa répétition, par « tblHeader »).
    if (!header && this.own && ['true', '1', 'on'].includes(lookNode?.attrs['w:firstRow'] ?? '')) header = true
    const styleBand = !ownStyle && lookNode && !lookOn('w:noHBand', 0x200) ? colorOf(path(cond('band1Horz'), 'w:tcPr', 'w:shd')?.attrs['w:fill']) : null
    const borders = this.tableBorders(tbl, styleId)
    // Une ligne sur deux tramée : un tableau zébré.
    const fillOf = (row: Cell[]) => (row.length && row.every((c) => c.fill && c.fill === row[0].fill) ? row[0].fill : null)
    const band = grid.length >= 3 ? fillOf(grid[1]) : null
    const zebra = !ownStyle && !!band && grid.every((row, r) => (r % 2 === 1 ? fillOf(row) === band : r === 0 || row.every((c) => !c.fill)))
    let style: TableStyle = ownStyle ?? 'grid'
    if (!ownStyle) {
      const h = borders.top || borders.bottom || borders.insideH
      const v = borders.left || borders.right || borders.insideV
      if (zebra || (styleBand && !v)) style = 'zebra'
      else if (!h && !v) style = 'minimal'
      else if (h && !v) style = 'lines'
      else if (borders.top >= 12 && borders.top >= 2 * Math.max(borders.insideH, borders.insideV, 1)) style = 'boxed'
    }
    const look = this.theme ? tableLook(style, this.theme) : null
    const firstColumn = this.own && child(tblPr, 'w:tblLook')?.attrs['w:firstColumn'] === 'true'
    const rows = real.map((row) => {
      const r = grid.indexOf(grid.find((g) => g.includes(row[0]))!)
      return row.map((c) => {
        const head = header && r === 0
        const strong = this.own && (head || (firstColumn && c.col === 0))
        const inner: Ctx = { ...ctx, cell: true, ...(strong ? { plain: { bold: true, color: head ? (look?.headerColor ?? null) : null } } : {}) }
        const cell: Raw = { blocks: this.assemble(this.walk(c.node.children, inner)) }
        if (this.own) {
          // Notre export resserre le dernier paragraphe d'une cellule : ce n'est pas un réglage du document.
          const blocks = cell.blocks as Raw[]
          const last = blocks[blocks.length - 1]
          const sp = last && (last.type === 'paragraph' || last.type === 'heading') ? (last.spacing as Raw | undefined) : undefined
          if (sp && sp.after === 0) {
            delete sp.after
            if (!Object.keys(sp).length) delete last.spacing
          }
        }
        if (c.span > 1) cell.colspan = c.span
        if (c.rowspan > 1) cell.rowspan = Math.min(c.rowspan, grid.length - r)
        const implied = (zebra && (r % 2 === 1 || r === 0)) || (this.own && look && (c.fill === (r === 0 && header ? look.headerFill : null) || (r % 2 === 1 && c.fill === look.bandFill)))
        if (c.fill && c.fill !== '#ffffff' && !implied) cell.bg = c.fill
        const va = attr(path(c.node, 'w:tcPr', 'w:vAlign'))
        if (va === 'center') cell.valign = 'middle'
        else if (va === 'bottom') cell.valign = 'bottom'
        return cell
      })
    })
    const table: Raw = { type: 'table', header, style, rows, ...(repeat ? { repeatHeader: true } : {}) }
    // Lignes de hauteur exacte, toutes égales (planche d'étiquettes) : une hauteur fixe.
    const heights = kids(tbl, 'w:tr').map((tr) => child(child(tr, 'w:trPr'), 'w:trHeight'))
    if (heights.length && heights.every((hh) => hh && attr(hh, 'w:hRule') === 'exact' && attr(hh, 'w:val') === attr(heights[0], 'w:val'))) {
      const v = ptOfTwips(num(heights[0], 'w:val') ?? 0)
      if (v >= 5 && v <= 1000) table.rowHeight = Math.round(v * 10) / 10
    }
    const cols = Math.max(0, ...grid.map((row) => row.reduce((n, c) => Math.max(n, c.col + c.span), 0)))
    const widths = kids(child(tbl, 'w:tblGrid'), 'w:gridCol').map((g) => ptOfTwips(num(g, 'w:w') ?? 0))
    // Nos propres fichiers disent si les largeurs ont été choisies (colonnes fixes) ; ailleurs, des colonnes égales sont l'usage.
    const chosen = this.own ? attr(child(tblPr, 'w:tblLayout'), 'w:type') === 'fixed' : !widths.every((w) => Math.abs(w - widths[0]) < 0.6)
    if (cols > 0 && widths.length === cols && widths.every((w) => w >= 5) && chosen) table.widths = widths.map((w) => Math.min(2000, w))
    const jc = attr(child(tblPr, 'w:jc'))
    if (jc === 'center' || jc === 'right' || jc === 'end') table.align = jc === 'center' ? 'center' : 'right'
    if (firstColumn) table.firstColumn = true
    // Couleur des traits : dans nos propres fichiers, seulement si ce n'est pas celle du style.
    if (borders.color && (this.own ? !!look && borders.color !== look.color && borders.color !== look.outerColor : borders.color !== '#000000')) table.border = borders.color
    return table
  }

  /** Bordures effectives d'un tableau (huitièmes de point, 0 = aucune) : style, puis tableau, sinon ses cellules. */
  private tableBorders(tbl: XmlNode, styleId: string | undefined) {
    const out = { top: 0, bottom: 0, left: 0, right: 0, insideH: 0, insideV: 0, color: '' }
    let found = false
    const apply = (b: XmlNode | undefined) => {
      for (const c of b?.children ?? []) {
        const key = ({ 'w:top': 'top', 'w:bottom': 'bottom', 'w:left': 'left', 'w:start': 'left', 'w:right': 'right', 'w:end': 'right', 'w:insideH': 'insideH', 'w:insideV': 'insideV' } as const)[c.name as 'w:top']
        if (!key) continue
        found = true
        const v = attr(c)
        out[key] = v && v !== 'none' && v !== 'nil' ? Math.max(1, num(c, 'w:sz') ?? 4) : 0
        if (out[key] && !out.color) out.color = colorOf(c.attrs['w:color']) ?? ''
      }
    }
    const chain: XmlNode[] = []
    const seen = new Set<string>()
    let cur = styleId
    while (cur && !seen.has(cur) && chain.length < 10) {
      seen.add(cur)
      const s = this.styles.get(cur)
      if (!s) break
      chain.unshift(s.node)
      cur = s.basedOn
    }
    for (const s of chain) apply(path(s, 'w:tblPr', 'w:tblBorders'))
    apply(path(tbl, 'w:tblPr', 'w:tblBorders'))
    if (!found || !(out.top || out.bottom || out.left || out.right || out.insideH || out.insideV)) {
      // Bordures portées par les cellules (LibreOffice, Google Docs) : la majorité décide.
      const cells = descendants(tbl, 'w:tcBorders').slice(0, 400)
      const count = (names: string[]) =>
        cells.filter((b) =>
          names.some((nm) => {
            const v = attr(child(b, nm))
            return v && v !== 'none' && v !== 'nil'
          }),
        ).length
      if (cells.length) {
        const h = count(['w:top', 'w:bottom']) > cells.length / 2 ? 4 : 0
        const v = count(['w:left', 'w:right', 'w:start', 'w:end']) > cells.length / 2 ? 4 : 0
        out.top = out.bottom = out.insideH = h
        out.left = out.right = out.insideV = v
        const any = cells[0].children.find((c) => colorOf(c.attrs['w:color']))
        if (any) out.color = colorOf(any.attrs['w:color']) ?? ''
      }
    }
    return out
  }

  /** Table des matières dans un bloc de contenu : le titre, puis le champ. */
  private tocOfSdt(content: XmlNode | undefined): Raw {
    let title = ''
    let levels = 3
    for (const p of kids(content, 'w:p')) {
      const st = this.paraStyle(attr(path(p, 'w:pPr', 'w:pStyle')))
      if (st.role === 'tocHeading' && !title) title = this.plainText(p).trim().slice(0, 200)
    }
    for (const i of descendants(content, 'w:instrText')) {
      const m = /TOC\b.*?\\o\s*"(\d)-(\d)"/.exec(i.text)
      if (m) {
        levels = Math.max(1, Math.min(6, Number(m[2])))
        break
      }
    }
    return { type: 'toc', levels, ...(title ? { title } : {}) }
  }

  /** Éléments de premier niveau (corps, cellule, note, en-tête) → entrées à regrouper. */
  private walk(nodes: XmlNode[], ctx: Ctx): Entry[] {
    const out: Entry[] = []
    let firstPara = !!ctx.note
    for (const n of nodes) {
      switch (n.name) {
        case 'w:p': {
          // Un paragraphe qui ne tient que le filigrane : il n'en reste rien dans l'en-tête.
          const mark = descendants(n, 'v:shape').find((v) => /watermark/i.test(v.attrs.id ?? ''))
          if (mark && !textOf(n).trim()) {
            this.readWatermark(mark)
            break
          }
          // Lettrine : un paragraphe encadré (w:framePr dropCap) qui ne tient que la première lettre.
          const frame = path(n, 'w:pPr', 'w:framePr')
          const drop = frame?.attrs['w:dropCap']
          if (drop === 'drop' || drop === 'margin') {
            const letter = textOf(n).trim()
            if (letter && letter.length <= 3) {
              this.dropCap = { letter, lines: Math.max(2, Math.min(10, Number(frame!.attrs['w:lines']) || 3)) }
              break
            }
          }
          const entries = this.paragraph(n, ctx, firstPara && !this.own)
          if (this.dropCap) {
            const first = entries[0]
            if (first && (first.k === 'p' || first.k === 'block') && first.block.type === 'paragraph' && Array.isArray(first.block.content)) {
              first.block.content = [{ text: this.dropCap.letter }, ...(first.block.content as unknown[])]
              first.block.dropCap = this.dropCap.lines
            }
            this.dropCap = null
          }
          out.push(...entries)
          firstPara = false
          break
        }
        case 'w:tbl':
          if (this.suppressed) break
          if (ctx.cell) {
            // Un tableau dans une cellule n'a pas d'équivalent : son contenu est gardé, à la suite.
            this.lose('nested-table')
            for (const tc of descendantsShallow(n, 'w:tc')) out.push(...this.walk(tc.children, ctx))
          } else out.push({ k: 'block', block: this.table(n, ctx) })
          break
        case 'w:sdt': {
          const gallery = attr(path(n, 'w:sdtPr', 'w:docPartObj', 'w:docPartGallery')) ?? ''
          if (/table of contents/i.test(gallery) && !ctx.note && !ctx.hf) out.push({ k: 'block', block: this.tocOfSdt(child(n, 'w:sdtContent')) })
          else out.push(...this.walk(child(n, 'w:sdtContent')?.children ?? [], ctx))
          break
        }
        case 'w:customXml':
        case 'w:ins':
        case 'w:del':
        case 'w:moveFrom':
        case 'w:moveTo':
        case 'w:smartTag':
          out.push(...this.walk(n.children, ctx))
          break
        case 'mc:AlternateContent':
          out.push(...this.walk((child(n, 'mc:Choice') ?? child(n, 'mc:Fallback'))?.children ?? [], ctx))
          break
        case 'w:altChunk':
          this.lose('embedded-document')
          break
      }
    }
    return out
  }

  /** Regroupe les entrées : éléments de liste, citations, code, légendes, titre de table des matières. */
  private assemble(entries: Entry[]): Raw[] {
    const out: Raw[] = []
    let lastNumbered: number | null = null
    let i = 0
    while (i < entries.length) {
      const e = entries[i]
      if (e.k === 'li') {
        const root = e.numId
        const lvl0 = this.level(root, 0)
        const rootStyle = (this.level(root, e.level)?.fmt ?? 'decimal') === 'bullet' && e.level === 0 ? 'bullet' : lvl0?.fmt === 'bullet' ? 'bullet' : 'number'
        const items: Raw[] = []
        let count0 = 0
        let baseIndent = 0
        const numbered: { fmt: string; text: string }[] = []
        while (i < entries.length) {
          const it = entries[i]
          if (it.k !== 'li') break
          const fmt = this.level(it.numId, it.level)?.fmt ?? 'decimal'
          const style = fmt === 'bullet' ? 'bullet' : 'number'
          let level = it.level
          if (items.length && it.level === 0 && it.numId !== root) {
            // Une autre liste, plus en retrait (styles « Liste à puces 2 », « 3 »…) : un niveau de la même liste.
            const deeper = Math.round((it.indent - baseIndent) / 16)
            if (deeper < 1) break
            level = Math.min(8, deeper)
          } else if (!items.length) baseIndent = it.indent - 18 * it.level
          if (items.length && level === 0 && style !== rootStyle) break
          if (style === 'number' && level > 0) numbered.push(this.level(it.numId, it.level)!)
          items.push({ content: it.content, level, style, ...it.props })
          if (level === 0) count0++
          i++
        }
        const list: Raw = { type: 'list', style: rootStyle, items }
        if (rootStyle === 'number') {
          const done = this.listCounts.get(root) ?? 0
          const start = (lvl0?.start ?? 1) + done
          if (done > 0 && lastNumbered === root) list.continue = true
          else if (start !== 1) list.start = Math.max(0, Math.min(99999, start))
          this.listCounts.set(root, done + count0)
          lastNumbered = root
          const kind = this.numberingKind(root, numbered)
          if (kind !== 'default') list.numbering = kind
        } else {
          const glyph = lvl0?.text ?? ''
          if (glyph && [...glyph].length === 1 && !STD_BULLETS.has(glyph) && !/[-]/.test(glyph)) list.bullet = glyph
        }
        out.push(list)
        continue
      }
      if (e.k === 'code') {
        const lines: string[] = []
        // Ailleurs, chaque ligne de code est un paragraphe ; dans nos propres fichiers, un paragraphe est un extrait entier.
        do lines.push((entries[i++] as { text: string }).text)
        while (!this.own && i < entries.length && entries[i].k === 'code')
        out.push({ type: 'code', text: lines.join('\n') })
        continue
      }
      if (e.k === 'p' && e.role === 'quote') {
        const blocks: Raw[] = []
        while (i < entries.length) {
          const q = entries[i]
          if (q.k !== 'p' || q.role !== 'quote') break
          blocks.push(q.block)
          i++
        }
        out.push({ type: 'quote', blocks })
        continue
      }
      if (e.k === 'p' && e.role === 'caption') {
        const prev = out[out.length - 1]
        if (prev && prev.type === 'image' && !prev.caption) prev.caption = e.block.content
        else out.push(e.block)
        i++
        continue
      }
      if (e.k === 'p' && e.role === 'tocHeading') {
        const next = entries[i + 1]
        if (next && next.k === 'block' && ['toc', 'figures', 'index', 'authorities', 'bibliography'].includes(String(next.block.type)) && !next.block.title) {
          next.block.title = (e.block.content as Raw[]).map((x) => (typeof x.text === 'string' ? x.text : '')).join('').trim().slice(0, 200)
        } else out.push(e.block)
        i++
        continue
      }
      out.push(e.block)
      i++
    }
    return out
  }

  /** Numérotation d'une liste, d'après son premier niveau et ses sous-niveaux numérotés (ceux utilisés, sinon ceux prévus). */
  private numberingKind(numId: number, used: { fmt: string; text: string }[]): string {
    const planned = [1, 2].map((l) => this.level(numId, l)).filter((l): l is NonNullable<typeof l> => !!l && l.fmt !== 'bullet' && l.fmt !== 'none')
    const subs = used.length ? used : planned
    const f0 = this.level(numId, 0)?.fmt ?? 'decimal'
    if (subs.some((l) => /%1.*%2/.test(l.text))) return 'outline'
    if (f0 === 'lowerLetter') return 'alpha'
    if (f0 === 'upperLetter') return 'ALPHA'
    if (f0 === 'lowerRoman') return 'roman'
    if (f0 === 'upperRoman') return 'ROMAN'
    if (subs.length && subs.every((l) => l.fmt === 'decimal')) return 'decimal'
    return 'default'
  }

  // --- sections et mise en page ---------------------------------------------------

  private sect(sp: XmlNode | undefined): Sect {
    const sz = child(sp, 'w:pgSz')
    const mar = child(sp, 'w:pgMar')
    let w = mmOfTwips(num(sz, 'w:w') ?? 11906)
    let h = mmOfTwips(num(sz, 'w:h') ?? 16838)
    const landscape = attr(sz, 'w:orient') === 'landscape' || w > h
    if (w > h) [w, h] = [h, w]
    let size = 'custom'
    for (const name of Object.keys(PAPER_SIZES)) {
      const [pw, ph] = PAPER_SIZES[name]
      if (Math.abs(pw - w) <= 1.5 && Math.abs(ph - h) <= 1.5) {
        size = name
        ;[w, h] = [pw, ph]
        break
      }
    }
    const mm = (name: string, def: number) => Math.max(0, Math.min(200, mmOfTwips(Math.abs(num(mar, name) ?? def))))
    const page: Raw = {
      size,
      width: Math.max(50, Math.min(2000, w)),
      height: Math.max(50, Math.min(2000, h)),
      orientation: landscape ? 'landscape' : 'portrait',
      margins: { top: mm('w:top', 1440), right: mm('w:right', 1440), bottom: mm('w:bottom', 1440), left: Math.min(200, mm('w:left', 1440) + mm('w:gutter', 0)) },
      header: mm('w:header', 720),
      footer: mm('w:footer', 720),
    }
    const borders = child(sp, 'w:pgBorders')
    const bc = borders?.children.find((b) => attr(b) && attr(b) !== 'none' && attr(b) !== 'nil')
    if (bc) page.border = this.themed(bc, 'w:color', 'w:themeColor') ?? '#000000'
    const cols = child(sp, 'w:cols')
    const count = Math.max(1, Math.min(6, num(cols, 'w:num') ?? 1))
    const pg = child(sp, 'w:pgNumType')
    const refs = (name: string) => {
      const o: Record<string, string> = {}
      for (const r of kids(sp, name)) {
        const rel = this.rels(this.mainPath).get(r.attrs['r:id'] ?? '')
        if (rel && !rel.external) o[r.attrs['w:type'] ?? 'default'] = rel.target
      }
      return o
    }
    const noteSet = (n: XmlNode | undefined, end: boolean): Raw | undefined => {
      if (!n) return undefined
      const o: Raw = {}
      const f = noteFormatFromWord(attr(child(n, 'w:numFmt')))
      if (f) o.format = f
      const st = num(child(n, 'w:numStart'))
      if (st !== undefined) o.start = Math.max(1, Math.min(9999, st))
      const rs = attr(child(n, 'w:numRestart'))
      if (rs) o.restart = rs === 'eachSect' ? 'section' : rs === 'eachPage' && !end ? 'page' : 'continuous'
      return Object.keys(o).length ? o : undefined
    }
    const notes: Raw = {}
    const foot = noteSet(child(sp, 'w:footnotePr'), false)
    const end = noteSet(child(sp, 'w:endnotePr'), true)
    if (foot) notes.foot = foot
    if (end) notes.end = end
    const tp = child(sp, 'w:titlePg')
    return {
      type: attr(child(sp, 'w:type')) ?? 'nextPage',
      page,
      key: JSON.stringify([page.width, page.height, page.orientation, page.margins]),
      cols: count > 1 ? { count, gap: Math.max(0, Math.min(200, ptOfTwips(num(cols, 'w:space') ?? 720))), rule: cols?.attrs['w:sep'] === '1' || cols?.attrs['w:sep'] === 'true' } : null,
      numberStart: num(pg, 'w:start'),
      numberFormat: numberFormatFromWord(attr(pg, 'w:fmt')) ?? undefined,
      titlePg: !!tp && onOff(tp) !== false,
      headers: refs('w:headerReference'),
      footers: refs('w:footerReference'),
      notes,
    }
  }

  private hfBlocks(p: string | undefined): Raw[] {
    if (!p) return []
    const root = this.xml(p)
    if (!root) return []
    const saved = { fields: this.fields, active: this.activeComments }
    this.fields = []
    this.activeComments = new Set()
    const blocks = this.inPart(p, () => this.assemble(this.walk(root.children, { hf: true })))
    this.fields = saved.fields
    this.activeComments = saved.active
    // Un en-tête fait d'un seul paragraphe vide est un en-tête vide.
    const empty = blocks.every((b) => b.type === 'paragraph' && !(b.content as Raw[]).length)
    return empty ? [] : blocks
  }

  private hfSet(refs: Record<string, string>): Raw {
    return { default: this.hfBlocks(refs.default), first: this.hfBlocks(refs.first), even: this.hfBlocks(refs.even) }
  }

  // --- styles et thème du document produit -----------------------------------------

  private buildTheme(): void {
    const c = this.themeColors
    const ownName = /^Folio (\w+)$/.exec(this.themeName)?.[1]
    const colors: Record<string, string> = {}
    if (c.dark1) colors.text = c.dark1
    for (let i = 1; i <= 6; i++) if (c[`accent${i}`]) colors[`accent${i}`] = c[`accent${i}`]
    const fonts: Record<string, string> = {}
    if (this.themeFonts.major) fonts.heading = this.themeFonts.major
    if (this.themeFonts.minor) fonts.body = this.themeFonts.minor
    const code = this.styles.get('SourceCode')
    if (this.own && code?.r.font) fonts.mono = code.r.font
    const base = ownName && Object.prototype.hasOwnProperty.call(THEME_PRESET_NAMES, ownName) ? ownName : ''
    this.themeRaw = Object.keys(colors).length || Object.keys(fonts).length ? { ...(base ? { name: base } : this.own ? {} : { name: 'docx' }), colors, fonts } : null
    // Le thème tel que l'application le complétera : sert à reconnaître nos propres tableaux.
    this.theme = {
      name: base || 'docx',
      colors: { text: colors.text ?? '#1d1c19', accent1: colors.accent1 ?? '#1e6b55', accent2: colors.accent2 ?? '#d95f45', accent3: colors.accent3 ?? '#2f5d9e', accent4: colors.accent4 ?? '#b7791f', accent5: colors.accent5 ?? '#7b4fa0', accent6: colors.accent6 ?? '#5f6b73' },
      fonts: { heading: fonts.heading ?? 'Newsreader', body: fonts.body ?? 'Hanken Grotesk', mono: fonts.mono ?? 'JetBrains Mono' },
      code: { background: '', text: '', keyword: '', string: '', number: '', comment: '', function: '', type: '' },
    }
  }
  private themeRaw: Raw | null = null

  /** Définition complète (tout champ explicite) d'un style de paragraphe du fichier. */
  private fullDef(r: RProps, p: PProps): StyleDef {
    r = { ...r, font: this.ownFont(r.font) }
    const size = r.size ?? 10
    const line = p.line ?? (p.lineExact !== undefined ? Math.max(0.5, Math.min(10, Math.round((p.lineExact / size) * 100) / 100)) : lineFromWord(240))
    const d: StyleDef = {
      font: r.font ?? 'body',
      size,
      color: r.color ?? 'text',
      bold: !!r.bold,
      italic: !!r.italic,
      underline: !!r.underline,
      strike: !!r.strike,
      caps: !!r.caps,
      smallcaps: !!r.smallcaps,
      letterSpacing: r.letterSpacing ?? 0,
      align: p.align ?? 'left',
      indent: { left: p.left ?? 0, right: p.right ?? 0, first: p.first ?? 0 },
      spacing: { before: p.before ?? 0, after: p.after ?? 0 },
      line,
      keepNext: !!p.keepNext,
      keepLines: !!p.keepLines,
      pageBreakBefore: !!p.pageBreakBefore,
    }
    if (r.highlight) d.highlight = r.highlight
    if (p.shading) d.shading = p.shading
    if (p.border) d.border = p.border
    return d
  }

  /** Ce qu'il faut écrire pour qu'un style vaille `target`, sachant ce qu'il vaudrait sans rien écrire (`base`). */
  private diffDef(target: StyleDef, base: StyleDef): StyleDef {
    const full = (b: StyleDef): StyleDef => ({
      font: b.font ?? 'body',
      size: b.size ?? 11,
      color: b.color ?? 'text',
      bold: !!b.bold,
      italic: !!b.italic,
      underline: !!b.underline,
      strike: !!b.strike,
      caps: !!b.caps,
      smallcaps: !!b.smallcaps,
      letterSpacing: b.letterSpacing ?? 0,
      align: b.align ?? 'left',
      indent: { left: b.indent?.left ?? 0, right: b.indent?.right ?? 0, first: b.indent?.first ?? 0 },
      spacing: { before: b.spacing?.before ?? 0, after: b.spacing?.after ?? 0 },
      line: b.line ?? 1.45,
      keepNext: !!b.keepNext,
      keepLines: !!b.keepLines,
      pageBreakBefore: !!b.pageBreakBefore,
      highlight: b.highlight,
      shading: b.shading,
      border: b.border,
    })
    const b = full(base)
    const out: Record<string, unknown> = {}
    const near = (x: unknown, y: unknown) => (typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) < 0.06 : x === y)
    for (const k of Object.keys(target) as (keyof StyleDef)[]) {
      const tv = target[k]
      const bv = b[k]
      if (k === 'indent' || k === 'spacing') {
        const t2 = tv as Record<string, number>
        const b2 = bv as Record<string, number>
        if (Object.keys(t2).some((s) => !near(t2[s], b2[s]))) out[k] = t2
      } else if (!near(tv, bv)) out[k] = tv
    }
    return out as StyleDef
  }

  private buildStyles(): Record<string, StyleDef> {
    const out: Record<string, StyleDef> = {}
    const normalWord = this.chain(this.defaultPStyle, 'paragraph')
    const normalTarget = this.fullDef(normalWord.r, normalWord.p)
    const normalDiff = this.diffDef(normalTarget, BUILTIN_STYLES.normal)
    if (Object.keys(normalDiff).length) out.normal = normalDiff
    const adjust = (id: string, d: StyleDef, word: WStyle): StyleDef => {
      if (!this.own) return d
      // Ce que notre export ajoute pour rendre l'aspect de l'application : à retirer au retour.
      if (id === 'quote') d.indent = { ...d.indent, left: Math.max(0, (d.indent?.left ?? 0) - 12) }
      if (id === 'code') {
        delete d.shading
        const inherited = this.chain(word.basedOn, 'paragraph').r.color
        d.color = inherited ?? 'text'
      }
      return d
    }
    for (const [builtin, wordId] of this.builtinSource) {
      if (builtin === 'normal') continue
      const word = this.styles.get(wordId)!
      const { r, p } = this.chain(wordId, 'paragraph')
      const target = adjust(builtin, this.fullDef(r, p), word)
      const base = resolveStyle(out.normal ? { normal: out.normal } : {}, builtin)
      const diff = this.diffDef(target, base)
      if (Object.keys(diff).length) out[builtin] = diff
    }
    let n = 0
    for (const [wordId, folio] of this.customUsed) {
      if (++n > 150) break
      const word = this.styles.get(wordId)!
      const { r, p } = this.chain(wordId, 'paragraph')
      const base = resolveStyle(out.normal ? { normal: out.normal } : {}, 'normal')
      out[folio] = { name: word.name.slice(0, 100), basedOn: 'normal', ...this.diffDef(this.fullDef(r, p), base) }
    }
    return out
  }

  // --- document -------------------------------------------------------------------

  run(): ImportResult {
    const rootRels = this.xml('_rels/.rels')
    for (const r of kids(rootRels, 'Relationship')) {
      if ((r.attrs.Type ?? '').endsWith(`/${REL_DOC}`) && r.attrs.Target) this.mainPath = r.attrs.Target.replace(/^\//, '')
    }
    this.part = this.mainPath
    const root = this.xml(this.mainPath)
    const body = child(root, 'w:body')
    if (!root || root.name !== 'w:document' || !body) throw new DocxError('not-docx')

    const custom = this.xml('docProps/custom.xml')
    const props = new Map<string, string>()
    for (const p of kids(custom, 'property')) if (p.attrs.name) props.set(p.attrs.name, textOf(p).trim())
    this.own = /^Folio Pages\b/.test(props.get('Generator') ?? '')
    this.readMathSources()

    this.readTheme()
    this.readStyles()
    this.buildTheme()
    this.readNumbering()
    this.readNotes()
    this.readComments()

    // Corps : une suite de sections, chacune close par ses propriétés.
    const sections: { entries: Entry[]; sect: Sect }[] = []
    let entries: Entry[] = []
    let prev: XmlNode | undefined
    for (const n of body.children) {
      if (n.name === 'w:sectPr') continue
      const sp = n.name === 'w:p' ? path(n, 'w:pPr', 'w:sectPr') : undefined
      const made = this.walk([n], {})
      // Le paragraphe vide qui ne sert qu'à porter un saut de section n'est pas du texte. Dans nos
      // propres fichiers, il n'existe qu'après un tableau ou une table des matières (sinon le saut
      // est porté par le dernier paragraphe du texte, qui peut être vide lui aussi).
      const bare = sp && made.length === 1 && made[0].k === 'p' && !((made[0].block.content as Raw[]) ?? []).length
      const carrier = bare && (!this.own || (child(n, 'w:pPr')!.children.length === 1 && !!prev && prev.name !== 'w:p'))
      prev = n
      if (!carrier) entries.push(...made)
      if (sp) {
        sections.push({ entries, sect: this.sect(sp) })
        entries = []
      }
    }
    // Nos propres fichiers : le paragraphe vide qui suit un saut de section final n'est là que pour le porter.
    if (this.own && sections.length && entries.length === 1 && entries[0].k === 'p' && !((entries[0].block.content as Raw[]) ?? []).length && Object.keys(entries[0].block).length === 2) entries = []
    sections.push({ entries, sect: this.sect(child(body, 'w:sectPr')) })

    const settings = this.xml(this.relOfType(this.mainPath, 'settings') ?? 'word/settings.xml')
    const firstSect = sections[0].sect
    const evenOdd = !!child(settings, 'w:evenAndOddHeaders') && onOff(child(settings, 'w:evenAndOddHeaders')) !== false
    const blocks: Raw[] = []
    let layoutLost = false
    sections.forEach(({ entries: es, sect }, i) => {
      const inner = this.assemble(es)
      if (i > 0) {
        // Format, orientation ou marges qui changent : la section garde sa propre mise en page.
        const changed = sect.key !== sections[i - 1].sect.key
        if (changed && sect.type === 'continuous') layoutLost = true
        if (sect.type !== 'continuous') {
          const b: Raw = { type: 'section', start: sect.type === 'oddPage' ? 'odd' : sect.type === 'evenPage' ? 'even' : 'page' }
          if (sect.numberStart !== undefined) b.numberStart = Math.max(0, Math.min(99999, sect.numberStart))
          if (sect.numberFormat) b.numberFormat = sect.numberFormat
          if (sect.titlePg !== sections[i - 1].sect.titlePg) b.firstPage = sect.titlePg
          if (Object.keys(sect.headers).length) b.headers = this.hfSet(sect.headers)
          if (Object.keys(sect.footers).length) b.footers = this.hfSet(sect.footers)
          if (changed) {
            const pg = sect.page
            b.page = { size: pg.size, width: pg.width, height: pg.height, orientation: pg.orientation, margins: pg.margins }
          }
          blocks.push(b)
        }
      }
      if (sect.cols && inner.length) blocks.push({ type: 'columns', count: sect.cols.count, gap: sect.cols.gap, rule: sect.cols.rule, blocks: inner })
      else blocks.push(...inner)
    })
    if (layoutLost) this.lose('section-layout')

    const page: Raw = { ...firstSect.page, firstPage: firstSect.titlePg, evenOdd }
    if (firstSect.numberStart !== undefined) page.numberStart = Math.max(0, Math.min(99999, firstSect.numberStart))
    if (firstSect.numberFormat) page.numberFormat = firstSect.numberFormat
    const bg = colorOf(child(root, 'w:background')?.attrs['w:color'])
    if (bg && bg !== '#ffffff') page.background = bg

    // Notes : réglages du document, puis ceux de la première section.
    const noteSettings: Raw = {}
    for (const [key, name] of [['foot', 'w:footnotePr'], ['end', 'w:endnotePr']] as const) {
      const n = child(settings, name)
      const o: Raw = {}
      const f = noteFormatFromWord(attr(child(n, 'w:numFmt')))
      if (f) o.format = f
      const st = num(child(n, 'w:numStart'))
      if (st !== undefined) o.start = Math.max(1, Math.min(9999, st))
      const rs = attr(child(n, 'w:numRestart'))
      if (rs) o.restart = rs === 'eachSect' ? 'section' : rs === 'eachPage' && key === 'foot' ? 'page' : 'continuous'
      const merged = { ...o, ...((firstSect.notes[key] as Raw | undefined) ?? {}) }
      if (Object.keys(merged).length) noteSettings[key] = merged
    }

    const core = this.xml('docProps/core.xml')
    const app = this.xml('docProps/app.xml')
    const coreText = (name: string) => textOf(child(core, name)).trim()
    const dateOf = (v: string) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined)
    const meta: Raw = {}
    const put = (k: string, v: string | undefined, max: number) => {
      if (v) meta[k] = v.slice(0, max)
    }
    put('title', coreText('dc:title'), 300)
    put('author', this.own && coreText('dc:creator') === 'Un-named' ? '' : coreText('dc:creator'), 200)
    put('subject', coreText('dc:subject'), 300)
    put('organization', props.get('Organization') || textOf(child(app, 'Company')).trim(), 200)
    const kw = coreText('cp:keywords')
    if (kw) meta.keywords = kw.split(/[,;]/).map((k) => k.trim()).filter(Boolean).slice(0, 50)
    const lang = this.docLang || attr(child(settings, 'w:themeFontLang')) || ''
    if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(lang)) meta.lang = lang
    const created = dateOf(coreText('dcterms:created'))
    const modified = dateOf(coreText('dcterms:modified'))
    if (created) meta.created = created
    if (modified) meta.modified = modified

    const doc: Raw = {
      format: 'folio/doc',
      version: 1,
      meta,
      page,
      headers: this.hfSet(firstSect.headers),
      footers: this.hfSet(firstSect.footers),
      styles: this.buildStyles(),
      blocks,
      comments: this.threads,
      assets: this.assets,
    }
    if (Object.keys(noteSettings).length) doc.notes = noteSettings
    if (this.themeRaw) doc.theme = this.themeRaw
    if (child(settings, 'w:trackRevisions') && onOff(child(settings, 'w:trackRevisions')) !== false) doc.trackChanges = true
    if (child(settings, 'w:autoHyphenation') && onOff(child(settings, 'w:autoHyphenation')) !== false) doc.hyphenate = true
    if (this.watermark) doc.watermark = this.watermark
    const sources = this.sourceList()
    if (sources.length) doc.sources = sources
    if (this.ownRefs?.citationStyle) doc.citationStyle = this.ownRefs.citationStyle
    if (this.ownMailMerge) doc.mailMerge = this.ownMailMerge
    else {
      // Un document de fusion d'un autre traitement de texte : sa liste est un fichier à part, qu'on n'a pas.
      const mmNode = child(settings, 'w:mailMerge')
      if (mmNode) {
        const kind = attr(child(mmNode, 'w:mainDocumentType'))
        const type = kind === 'email' ? 'emails' : kind === 'envelopes' ? 'envelopes' : kind === 'mailingLabels' ? 'labels' : kind === 'catalog' ? 'directory' : 'letters'
        doc.mailMerge = { type }
        this.lose('merge-source')
      }
    }
    return { doc, losses: [...this.losses].map(([code, count]) => ({ code, count })) }
  }
}

const THEME_PRESET_NAMES: Record<string, true> = { folio: true, classic: true, modern: true, slate: true, ink: true, system: true }

/** Fichier .docx → document Folio Pages en forme libre. Lève DocxError si le fichier n'est pas lisible. */
export function importDocx(data: Uint8Array): ImportResult {
  return new Importer(data).run()
}

export { DocxError }

/**
 * Un paragraphe qui n'est qu'une équation : centrée (m:oMathPara), ou suivie
 * de son numéro « (n) » après une tabulation (équation numérotée) → bloc
 * équation. Sinon null.
 */
function equationOf(content: Raw[]): Raw | null {
  const items = content.filter((x) => !(x.type === undefined && typeof x.text === 'string' && !x.text.trim()))
  const math = items.filter((x) => x.type === 'math')
  if (math.length !== 1) return null
  const m = math[0]
  if (items.length === 1 && m.display) return { type: 'equation', tex: m.tex }
  if (items.length === 2 && items[0] === m) {
    const t = items[1]
    if (t.type === undefined && typeof t.text === 'string' && /^\s*\(\s*\d{1,4}\s*\)\s*$/.test(t.text)) return { type: 'equation', tex: m.tex, numbered: true }
  }
  return null
}

/** Signets gardés : un nom valable, hors ceux que le traitement de texte pose pour lui-même. */
function keepBookmark(name: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_]{0,39}$/u.test(name) && !/^_(GoBack|Toc|Hlk)/i.test(name)
}

/** Étiquette d'un champ SEQ : « Figure », « Tableau »… → étiquette intégrée ; sinon le nom tel quel. */
function seqLabel(id: string): string {
  const k = id.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (['figure', 'fig', 'abbildung', 'figura'].includes(k)) return 'figure'
  if (['table', 'tableau', 'tabelle', 'tabla', 'tabella'].includes(k)) return 'table'
  if (['equation', 'gleichung', 'ecuacion', 'equazione'].includes(k)) return 'equation'
  return id.replace(/_/g, ' ').slice(0, 40)
}

const WORD_TYPES: Record<string, string> = {
  Book: 'book',
  BookSection: 'chapter',
  JournalArticle: 'article',
  ArticleInAPeriodical: 'article',
  ConferenceProceedings: 'conference',
  Report: 'report',
  InternetSite: 'website',
  DocumentFromInternetSite: 'website',
  ElectronicSource: 'website',
  Film: 'film',
  Interview: 'interview',
}

/** Sources du gestionnaire de sources de Word → sources Folio (champs bornés). */
export function wordSourcesOf(root: XmlNode): Raw[] {
  const out: Raw[] = []
  const local = (n: XmlNode) => n.name.replace(/^.*:/, '')
  const sub = (n: XmlNode | undefined, name: string) => n?.children.find((c) => local(c) === name)
  const txt = (n: XmlNode | undefined, name: string, max = 500) => {
    const c = sub(n, name)
    return c ? textOf(c).replace(/\s+/g, ' ').trim().slice(0, max) : ''
  }
  const names = (n: XmlNode | undefined): string[] => {
    if (!n) return []
    const corp = txt(n, 'Corporate', 200)
    if (corp) return [corp]
    const list = sub(n, 'NameList')
    return (list?.children ?? [])
      .filter((p) => local(p) === 'Person')
      .slice(0, 30)
      .map((p) => {
        const last = txt(p, 'Last', 100)
        const first = [txt(p, 'First', 100), txt(p, 'Middle', 100)].filter(Boolean).join(' ')
        return last ? (first ? `${last}, ${first}` : `${last}, `) : first
      })
      .map((x) => x.replace(/,\s*$/, ''))
      .filter(Boolean)
  }
  for (const src of root.children.filter((c) => local(c) === 'Source').slice(0, 2000)) {
    const id = txt(src, 'Tag', 64)
    if (!/^[\p{L}\p{N}_:.-]{1,64}$/u.test(id)) continue
    const authorRoot = sub(src, 'Author')
    const type = WORD_TYPES[txt(src, 'SourceType', 40)] ?? 'other'
    const s: Raw = { id, type, authors: names(sub(authorRoot, 'Author')), title: txt(src, 'Title', 1000) }
    const eds = names(sub(authorRoot, 'Editor'))
    if (eds.length) s.editors = eds
    const container = txt(src, 'JournalName') || txt(src, 'BookTitle') || txt(src, 'InternetSiteTitle') || txt(src, 'ConferenceName') || txt(src, 'PeriodicalTitle')
    if (container) s.container = container
    const put = (k: string, name: string, max = 200) => {
      const v = txt(src, name, max)
      if (v) s[k] = v
    }
    put('year', 'Year', 40)
    put('publisher', 'Publisher', 300)
    put('place', 'City')
    put('volume', 'Volume', 40)
    put('issue', 'Issue', 40)
    put('pages', 'Pages', 40)
    put('edition', 'Edition', 40)
    const url = txt(src, 'URL', 2048)
    if (/^https?:\/\//i.test(url)) s.url = url
    const doi = txt(src, 'DOI', 200)
    if (/^10\.\d{4,9}\/\S+$/.test(doi)) s.doi = doi
    const isbn = txt(src, 'StandardNumber', 30).replace(/[^0-9Xx-]/g, '')
    if (/^[0-9Xx-]{10,17}$/.test(isbn)) s.isbn = isbn
    const y = txt(src, 'YearAccessed', 4)
    if (/^\d{4}$/.test(y)) s.accessed = `${y}-${(txt(src, 'MonthAccessed', 2) || '1').padStart(2, '0')}-${(txt(src, 'DayAccessed', 2) || '1').padStart(2, '0')}`
    out.push(s)
  }
  return out
}
