// Markdown → blocs Folio Pages.
//
// Sert aux champs `md` (texte d'un paragraphe, d'un titre, d'une cellule…) et
// au champ `markdown` du document, pour les IA qui écrivent plus facilement du
// texte que du JSON. Volontairement limité et prévisible :
//   - le HTML n'est JAMAIS interprété : il reste du texte ;
//   - une formule LaTeX entre $…$ ou \(…\) devient une formule en ligne
//     (aucun * ni _ n'y est lu comme de la mise en forme) ; un paragraphe
//     $$…$$ ou \[…\] seul devient une équation centrée, numérotée si elle
//     porte un \label ;
//   - une image ![…](…) seule dans son paragraphe devient un bloc image ; au
//     milieu d'un texte, elle reste du texte, pour ne rien perdre ;
//   - {{page}}, {{date:DD/MM/YYYY}}… sont des champs (\{{ pour l'écrire tel quel) ;
//   - ^[texte] est une note de bas de page ; [^id] aussi, avec sa définition
//     « [^id]: texte » sur une ligne à part (lignes suivantes en retrait de 4).

import { parseFieldToken } from './fields'
import { isImageSrc, isSafeLink } from './spec'
import { makeRun, mergeRuns, type Marks } from './runs'
import { mathMarks, type Align, type Block, type CalloutKind, type Inline, type ListItem, type ListStyle, type TableCell } from './types'

/** Signalement facultatif des liens refusés. */
export type MdWarn = (code: 'unsafe-link', detail: string) => void

// --- en ligne ---------------------------------------------------------------

/** Définitions « [^id]: … » du Markdown en cours d'analyse (clé en minuscules). */
let noteDefs: Map<string, string> | null = null
/** Dans le texte d'une note : pas de note dans une note. */
let inNote = 0

/** Une note : son texte Markdown → paragraphes, listes et code seulement. */
function noteInline(md: string, warn?: MdWarn): Inline {
  inNote++
  let blocks: Block[]
  try {
    blocks = noteBlocks(parseMarkdown(md, warn, 1))
  } finally {
    inNote--
  }
  return { type: 'note', kind: 'foot', blocks: blocks.length ? blocks : [{ type: 'paragraph', content: [] }] }
}

function noteBlocks(blocks: Block[]): Block[] {
  const out: Block[] = []
  for (const b of blocks) {
    if (b.type === 'paragraph' || b.type === 'list' || b.type === 'code' || b.type === 'equation') out.push(b)
    else if (b.type === 'heading') out.push({ type: 'paragraph', content: b.content })
    else if (b.type === 'quote' || b.type === 'callout') out.push(...noteBlocks(b.blocks))
    else if (b.type === 'table') for (const row of b.rows) for (const c of row) out.push(...noteBlocks(c.blocks))
    else if (b.type === 'image' && b.caption.length) out.push({ type: 'paragraph', content: b.caption })
  }
  return out
}

const NOTE_DEF = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/

/**
 * Retire les définitions de notes « [^id]: texte » (et leurs lignes en retrait)
 * qui sont appelées quelque part ; une définition jamais appelée reste du texte.
 */
function extractNoteDefs(lines: string[]): { lines: string[]; defs: Map<string, string> } {
  const found: { id: string; from: number; to: number; text: string[] }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = NOTE_DEF.exec(lines[i])
    if (!m) continue
    const text = [m[2]]
    let j = i + 1
    while (j < lines.length) {
      if (/^( {4}|\t)/.test(lines[j])) text.push(lines[j].replace(/^( {4}|\t)/, ''))
      else if (!lines[j].trim() && j + 1 < lines.length && /^( {4}|\t)\S/.test(lines[j + 1])) text.push('')
      else break
      j++
    }
    found.push({ id: m[1].toLowerCase(), from: i, to: j, text })
    i = j - 1
  }
  const defs = new Map<string, string>()
  if (!found.length) return { lines, defs }
  const drop = new Set<number>()
  const rest = lines.filter((_, i) => !found.some((f) => i >= f.from && i < f.to)).join('\n').toLowerCase()
  for (const f of found) {
    if (!rest.includes(`[^${f.id}]`) || defs.has(f.id)) continue
    defs.set(f.id, f.text.join('\n'))
    for (let i = f.from; i < f.to; i++) drop.add(i)
  }
  return { lines: lines.filter((_, i) => !drop.has(i)), defs }
}

const PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c)
const isAlnum = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)

/** Longueur de la suite de caractères `ch` qui commence en `i`. */
function runLength(s: string, i: number, ch: string): number {
  let n = 0
  while (s[i + n] === ch) n++
  return n
}

/**
 * Contexte d'analyse d'une chaîne. Les recherches de fermeture qui échouent
 * sont mémorisées (« aucune fermeture après la position p ») et les crochets
 * et parenthèses sont appariés en une seule passe : chaque niveau d'analyse
 * reste linéaire, même sur une entrée pathologique.
 */
class Scan {
  private noCode = new Map<number, number>()
  private noMath = new Map<number, number>()
  readonly noCloser = new Map<string, number>()
  private brackets: Int32Array | null = null
  private parens: Int32Array | null = null

  constructor(readonly s: string) {}

  /** Fin (exclue) d'un passage de code commençant en `i`, ou -1. */
  codeEnd(i: number): number {
    const s = this.s
    const n = runLength(s, i, '`')
    const none = this.noCode.get(n)
    if (none !== undefined && i >= none) return -1
    let j = i + n
    while (j < s.length) {
      const k = s.indexOf('`', j)
      if (k < 0) break
      const m = runLength(s, k, '`')
      if (m === n) return k + m
      j = k + m
    }
    this.noCode.set(n, Math.min(none ?? Infinity, i))
    return -1
  }

  /** Fin d'une formule $…$ ou $$…$$ commençant en `i` (pas d'espace juste à l'intérieur), ou -1. */
  mathEnd(i: number): number {
    const s = this.s
    const n = s[i + 1] === '$' ? 2 : 1
    const start = i + n
    if (isSpace(s[start]) || s[start] === '$') return -1
    const none = this.noMath.get(n)
    if (none !== undefined && start >= none) return -1
    let j = start
    while (j < s.length) {
      const k = s.indexOf(n === 2 ? '$$' : '$', j)
      if (k < 0) break
      if (s[k - 1] === '\\' || isSpace(s[k - 1]) || k === start) {
        j = k + 1
        continue
      }
      // « 5 $ et 10 $ » : un $ fermant suivi d'un chiffre n'en est pas un
      if (n === 1 && /[0-9]/.test(s[k + 1] ?? '')) return -1
      return k + n
    }
    this.noMath.set(n, Math.min(none ?? Infinity, start))
    return -1
  }

  /** Appariement en une passe, en sautant les échappements et le code. */
  private pair(open: string, close: string, skipCode: boolean): Int32Array {
    const s = this.s
    const match = new Int32Array(s.length).fill(-1)
    const stack: number[] = []
    for (let j = 0; j < s.length; j++) {
      const c = s[j]
      if (c === '\\') {
        j++
        continue
      }
      if (skipCode && c === '`') {
        const e = this.codeEnd(j)
        j = e > 0 ? e - 1 : j + runLength(s, j, '`') - 1
        continue
      }
      if (c === open) stack.push(j)
      else if (c === close && stack.length) match[stack.pop()!] = j
    }
    return match
  }

  closingBracket(i: number): number {
    return (this.brackets ??= this.pair('[', ']', true))[i]
  }

  /** Lit « (url "titre") » à partir de `i` ; renvoie l'adresse et la fin. */
  linkTarget(i: number): { href: string; end: number } | null {
    if (this.s[i] !== '(') return null
    const j = (this.parens ??= this.pair('(', ')', false))[i]
    if (j < 0) return null
    let inner = this.s.slice(i + 1, j).trim()
    const titled = /^(\S+)\s+["'(]/.exec(inner)
    if (titled && !inner.startsWith('<')) inner = titled[1]
    if (inner.startsWith('<') && inner.includes('>')) inner = inner.slice(1, inner.indexOf('>'))
    return { href: inner, end: j + 1 }
  }
}

interface Delim {
  ch: string
  k: number
  mark: (keyof Marks)[]
  /** Pas d'espace autorisé à l'intérieur (^exposant^, ~indice~). */
  tight?: boolean
  /** Interdit au milieu d'un mot (_italique_). */
  wordBound?: boolean
}

function delimFor(s: string, i: number): Delim | null {
  const c = s[i]
  if (c === '*' || c === '_') {
    const n = runLength(s, i, c)
    const wordBound = c === '_'
    if (n >= 3) return { ch: c, k: 3, mark: ['bold', 'italic'], wordBound }
    if (n === 2) return { ch: c, k: 2, mark: ['bold'], wordBound }
    return { ch: c, k: 1, mark: ['italic'], wordBound }
  }
  if (c === '~') {
    const n = runLength(s, i, '~')
    if (n === 2) return { ch: c, k: 2, mark: ['strike'] }
    if (n === 1) return { ch: c, k: 1, mark: ['sub'], tight: true }
    return null
  }
  if (c === '+' && runLength(s, i, '+') === 2) return { ch: c, k: 2, mark: ['underline'] }
  if (c === '^' && runLength(s, i, '^') === 1) return { ch: c, k: 1, mark: ['sup'], tight: true }
  return null
}

/** Cherche le délimiteur fermant ; renvoie la position de début du fermant, ou -1. */
function findCloser(scan: Scan, from: number, d: Delim): number {
  const s = scan.s
  const key = d.ch + d.k
  const none = scan.noCloser.get(key)
  if (!d.tight && none !== undefined && from >= none) return -1
  for (let j = from; j < s.length; j++) {
    const c = s[j]
    if (c === '\\') {
      j++
      continue
    }
    if (d.tight && /\s/.test(c)) return -1
    if (c === '`') {
      const e = scan.codeEnd(j)
      if (e > 0 && d.tight) return -1
      j = e > 0 ? e - 1 : j + runLength(s, j, '`') - 1
      continue
    }
    if (c === '$') {
      const e = scan.mathEnd(j)
      if (e > 0) {
        j = e - 1
        continue
      }
    }
    if (c !== d.ch) continue
    const len = runLength(s, j, d.ch)
    const close = j + len - d.k // les k derniers caractères de la suite ferment
    if ((len === d.k || len >= 3) && close > from && !isSpace(s[close - 1]) && !(d.wordBound && isAlnum(s[j + len]))) {
      return close
    }
    j += len - 1
  }
  if (!d.tight) scan.noCloser.set(key, Math.min(none ?? Infinity, from))
  return -1
}

/** Au-delà, le reste est gardé en texte : pas de récursion sans fin sur « ********… ». */
const MAX_INLINE_DEPTH = 24
const AUTOLINK = /<((?:https?|mailto):[^\s<>]+)>/iy

/** Analyse du Markdown en ligne. Un « \n » dans `src` est un retour à la ligne forcé. */
export function parseInline(src: string, warn?: MdWarn, marks: Marks = {}, depth = 0): Inline[] {
  if (depth > MAX_INLINE_DEPTH) return src ? [makeRun(src, marks)] : []
  const scan = new Scan(src)
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push(makeRun(buf, marks))
    buf = ''
  }
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '\\' && src[i + 1] === '(') {
      // \(…\) : formule en ligne (ce qu'écrivent volontiers les IA).
      const close = src.indexOf('\\)', i + 2)
      const tex = close > 0 ? src.slice(i + 2, close).trim() : ''
      if (tex && !tex.includes('\n\n')) {
        flush()
        out.push({ type: 'math', tex, ...mathMarks(marks) })
        i = close + 1
        continue
      }
    }
    if (c === '\\' && i + 1 < src.length && PUNCT.test(src[i + 1])) {
      buf += src[i + 1]
      i++
      continue
    }
    if (c === '`') {
      const e = scan.codeEnd(i)
      const n = runLength(src, i, '`')
      if (e > 0) {
        let inner = src.slice(i + n, e - n)
        if (inner.length > 2 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim()) inner = inner.slice(1, -1)
        flush()
        out.push(makeRun(inner, { ...marks, code: true }))
        i = e - 1
        continue
      }
      buf += src.slice(i, i + n)
      i += n - 1
      continue
    }
    if (c === '$') {
      const e = scan.mathEnd(i)
      if (e > 0) {
        const n = src[i + 1] === '$' ? 2 : 1
        flush()
        out.push({ type: 'math', tex: src.slice(i + n, e - n), ...mathMarks(marks) })
        i = e - 1
        continue
      }
    }
    if (c === '^' && src[i + 1] === '[' && !inNote) {
      // ^[texte] : une note (mais ^[2]^ reste un exposant).
      const close = scan.closingBracket(i + 1)
      if (close > i + 1 && src[close + 1] !== '^') {
        flush()
        out.push(noteInline(src.slice(i + 2, close), warn))
        i = close
        continue
      }
    }
    if (c === '[' && src[i + 1] === '^' && noteDefs && !inNote) {
      const close = src.indexOf(']', i + 2)
      const id = close > i + 2 ? src.slice(i + 2, close).toLowerCase() : ''
      const def = id && !/\s/.test(id) ? noteDefs.get(id) : undefined
      if (def !== undefined) {
        flush()
        out.push(noteInline(def, warn))
        i = close
        continue
      }
    }
    if (c === '!' && src[i + 1] === '[') {
      // Image : gardée telle quelle en texte.
      const close = scan.closingBracket(i + 1)
      const t = close > 0 ? scan.linkTarget(close + 1) : null
      if (t) {
        buf += src.slice(i, t.end)
        i = t.end - 1
        continue
      }
    }
    if (c === '[') {
      const close = scan.closingBracket(i)
      const t = close > 0 ? scan.linkTarget(close + 1) : null
      if (t) {
        flush()
        const label = src.slice(i + 1, close)
        if (t.href && isSafeLink(t.href)) out.push(...parseInline(label, warn, { ...marks, link: t.href }, depth + 1))
        else {
          if (t.href) warn?.('unsafe-link', t.href.slice(0, 80))
          out.push(...parseInline(label, warn, marks, depth + 1))
        }
        i = t.end - 1
        continue
      }
    }
    if (c === '{' && src[i + 1] === '{') {
      const close = src.indexOf('}}', i + 2)
      const inner = close > 0 && close - i < 80 ? src.slice(i + 2, close) : ''
      // {{merge:Nom}} : un champ de fusion (publipostage).
      const merge = /^merge:\s*([^{}]{1,80})$/i.exec(inner)
      if (merge && merge[1].trim()) {
        flush()
        out.push({ type: 'mergefield', name: merge[1].trim(), ...marks })
        i = close + 1
        continue
      }
      const field = inner && !inner.includes('{') ? parseFieldToken(inner) : null
      if (field) {
        flush()
        out.push({ type: 'field', name: field.name, format: field.format, ...marks })
        i = close + 1
        continue
      }
    }
    if (c === '<') {
      AUTOLINK.lastIndex = i
      const m = AUTOLINK.exec(src)
      if (m) {
        flush()
        out.push(makeRun(m[1].replace(/^mailto:/i, ''), { ...marks, link: m[1] }))
        i += m[0].length - 1
        continue
      }
    }
    const d = delimFor(src, i)
    if (d) {
      const open = i + d.k
      const canOpen = !isSpace(src[open]) && !(d.wordBound && isAlnum(src[i - 1]))
      const closer = canOpen ? findCloser(scan, open, d) : -1
      if (closer > 0) {
        flush()
        const add: Marks = { ...marks }
        for (const m of d.mark) (add as Record<string, unknown>)[m] = true
        out.push(...parseInline(src.slice(open, closer), warn, add, depth + 1))
        i = closer + d.k - 1
        continue
      }
      const n = runLength(src, i, d.ch)
      buf += src.slice(i, i + n)
      i += n - 1
      continue
    }
    buf += c
  }
  flush()
  return mergeRuns(out)
}

/**
 * Lignes d'un même paragraphe → texte : un saut de ligne simple devient une
 * espace ; deux espaces ou une barre oblique inverse en fin de ligne forcent
 * un retour à la ligne (« \n »).
 */
export function joinLines(lines: string[]): string {
  let out = ''
  lines.forEach((raw, i) => {
    let line = i === 0 ? raw.replace(/^\s+/, '') : raw.trim()
    let hard = false
    if (i < lines.length - 1) {
      if (/ {2,}$/.test(raw)) hard = true
      const bs = /(\\+)$/.exec(line)
      if (bs && bs[1].length % 2 === 1) {
        hard = true
        line = line.slice(0, -1)
      }
    }
    line = line.replace(/\s+$/, '')
    out += line
    if (i < lines.length - 1) out += hard ? '\n' : ' '
  })
  return out
}

/** Champ `md` d'un titre, d'un élément de liste ou d'une cellule. */
export function parseInlineField(md: string, warn?: MdWarn): Inline[] {
  return parseInline(joinLines(md.replace(/\r\n?/g, '\n').split('\n')), warn)
}

// --- blocs ------------------------------------------------------------------

const RE = {
  blank: /^\s*$/,
  fence: /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/,
  atx: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
  hr: /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/,
  quote: /^ {0,3}> ?(.*)$/,
  item: /^(\s*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*$)/,
  setext1: /^ {0,3}=+[ \t]*$/,
  setext2: /^ {0,3}-+[ \t]*$/,
  tableSep: /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/,
  mathOpen: /^ {0,3}(\$\$|\\\[)/,
}

/** Lignes maximales d'une équation centrée : au-delà, c'est du texte. */
const MAX_MATH_LINES = 200

/**
 * Équation centrée à partir de la ligne `i` : $$…$$ ou \[…\], sur une ou
 * plusieurs lignes, sans rien après la fermeture. Sinon null.
 */
function displayMath(lines: string[], i: number): { block: Block; next: number } | null {
  const open = RE.mathOpen.exec(lines[i])
  if (!open) return null
  const closer = open[1] === '$$' ? '$$' : '\\]'
  const body: string[] = []
  let rest = lines[i].slice(open[0].length)
  for (let k = i; k < lines.length && k - i < MAX_MATH_LINES; k++) {
    if (k > i) rest = lines[k]
    const at = rest.indexOf(closer)
    if (at < 0) {
      if (k > i && RE.blank.test(rest)) return null
      body.push(rest)
      continue
    }
    if (rest.slice(at + closer.length).trim()) return null
    body.push(rest.slice(0, at))
    const tex = body.join('\n').trim()
    if (!tex) return null
    const block: Block = { type: 'equation', tex, ...(/\\label\s*\{/.test(tex) ? { numbered: true as const } : {}) }
    return { block, next: k + 1 }
  }
  return null
}

const expandTabs = (line: string) => line.replace(/^[ \t]+/, (ws) => ws.replace(/\t/g, '    '))
const indentOf = (line: string) => /^ */.exec(line)![0].length

/** Découpe une ligne de tableau en cellules (les | échappés ou dans du code restent). */
export function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  const scan = new Scan(s)
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
      continue
    }
    if (c === '`') {
      const e = scan.codeEnd(i)
      const end = e > 0 ? e : i + runLength(s, i, '`')
      cur += s.slice(i, end)
      i = end - 1
      continue
    }
    if (c === '|') {
      cells.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  cells.push(cur.trim())
  return cells
}

const isTableStart = (lines: string[], i: number) =>
  lines[i].includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1]) && lines[i + 1].includes('-')

/** Comme en CommonMark : seule une puce ou « 1. » non vide interrompt un paragraphe. */
function interruptsWithItem(l: string): boolean {
  const m = RE.item.exec(l)
  return !!m && !!m[3] && (/^[-*+]$/.test(m[2]) || /^1[.)]$/.test(m[2]))
}

/** Une ligne qui commence un autre bloc interrompt un paragraphe. */
function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i]
  return (
    RE.fence.test(l) ||
    RE.atx.test(l) ||
    RE.hr.test(l) ||
    RE.quote.test(l) ||
    RE.mathOpen.test(l) ||
    interruptsWithItem(l) ||
    isTableStart(lines, i)
  )
}

const paragraph = (text: string, warn?: MdWarn): Block => ({ type: 'paragraph', content: parseInline(text, warn) })

const IMAGE_LINE = /^!\[([^\]\n]*)\]\(\s*<?([^\s<>)]+)>?(?:\s+"([^"\n]*)")?\s*\)$/

/** « ![texte](adresse "légende") » seul dans un paragraphe : un bloc image. */
function imageBlock(text: string, warn?: MdWarn): Block | null {
  const m = IMAGE_LINE.exec(text.trim())
  if (!m || !isImageSrc(m[2])) return null
  return {
    type: 'image',
    src: m[2],
    alt: m[1].trim(),
    width: 0,
    align: 'center',
    wrap: 'none',
    caption: m[3] ? parseInline(m[3], warn) : [],
  }
}

/** Alignements d'une ligne de séparation de tableau (« :--- », « :---: », « ---: »). */
function columnAligns(sep: string): (Align | null)[] {
  return splitRow(sep).map((c) => {
    const l = c.startsWith(':')
    const r = c.endsWith(':')
    return l && r ? 'center' : r ? 'right' : l ? 'left' : null
  })
}

/** Markdown d'un document entier → blocs. */
export function parseMarkdown(src: string, warn?: MdWarn, depth = 0): Block[] {
  let lines = src.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').map(expandTabs)
  if (depth > 0 || inNote) return parseBlocks(lines, warn, depth)
  const saved = noteDefs
  const found = extractNoteDefs(lines)
  lines = found.lines
  noteDefs = found.defs.size ? found.defs : null
  try {
    return parseBlocks(lines, warn, depth)
  } finally {
    noteDefs = saved
  }
}

function parseBlocks(lines: string[], warn: MdWarn | undefined, depth: number): Block[] {
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (RE.blank.test(line)) {
      i++
      continue
    }

    const fence = RE.fence.exec(line)
    if (fence) {
      const [, indent, marker, lang] = fence
      const body: string[] = []
      i++
      while (i < lines.length) {
        const l = lines[i]
        const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`)
        if (close.test(l)) {
          i++
          break
        }
        body.push(l.startsWith(indent) ? l.slice(indent.length) : l.replace(/^ +/, ''))
        i++
      }
      blocks.push({ type: 'code', language: lang ?? '', text: body.join('\n') })
      continue
    }

    const atx = RE.atx.exec(line)
    if (atx) {
      blocks.push({ type: 'heading', level: atx[1].length, content: parseInline((atx[2] ?? '').trim(), warn) })
      i++
      continue
    }

    if (RE.hr.test(line)) {
      blocks.push({ type: 'divider' })
      i++
      continue
    }

    if (RE.quote.test(line)) {
      const inner: string[] = []
      while (i < lines.length && RE.quote.test(lines[i])) {
        inner.push(RE.quote.exec(lines[i])![1])
        i++
      }
      // Alerte GitHub ou encadré Obsidian : « > [!NOTE] », « > [!tip] Titre ».
      const alert = /^\s*\[!([A-Za-z]+)\][+-]?[ \t]*(.*)$/.exec(inner[0] ?? '')
      const kind = alert ? CALLOUT_ALIASES[alert[1].toLowerCase()] : undefined
      if (alert && kind) inner.shift()
      const quoted = depth < 8 ? parseMarkdown(inner.join('\n'), warn, depth + 1) : [paragraph(joinLines(inner), warn)]
      const body = quoted.length ? quoted : [{ type: 'paragraph', content: [] } as Block]
      if (alert && kind) {
        const title = alert[2].trim().slice(0, 200)
        blocks.push({ type: 'callout', kind, ...(title ? { title } : {}), blocks: body.flatMap((x) => (x.type === 'callout' ? x.blocks : [x])) })
      } else blocks.push({ type: 'quote', blocks: body })
      continue
    }

    const eq = displayMath(lines, i)
    if (eq) {
      blocks.push(eq.block)
      i = eq.next
      continue
    }

    if (isTableStart(lines, i)) {
      const rows: string[][] = [splitRow(line)]
      const aligns = columnAligns(lines[i + 1])
      i += 2
      while (i < lines.length && !RE.blank.test(lines[i]) && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]))
        i++
      }
      const width = Math.max(...rows.map((r) => r.length))
      const cells: TableCell[][] = rows.map((r) => {
        const padded = [...r, ...Array(width - r.length).fill('')]
        return padded.map((t, k) => {
          const p = paragraph(t, warn)
          const a = aligns[k]
          return { blocks: [a && a !== 'left' ? ({ ...p, align: a } as Block) : p], colspan: 1, rowspan: 1 }
        })
      })
      blocks.push({ type: 'table', header: true, style: 'grid', rows: cells })
      continue
    }

    if (RE.item.test(line)) {
      i = parseList(lines, i, blocks, warn)
      continue
    }

    // Paragraphe, éventuellement titre souligné (=== ou ---).
    const para: string[] = [line]
    i++
    let setext = 0
    while (i < lines.length && !RE.blank.test(lines[i])) {
      if (RE.setext1.test(lines[i])) {
        setext = 1
        i++
        break
      }
      if (RE.setext2.test(lines[i])) {
        setext = 2
        i++
        break
      }
      if (startsBlock(lines, i)) break
      para.push(lines[i])
      i++
    }
    const text = joinLines(para)
    if (setext) blocks.push({ type: 'heading', level: setext, content: parseInline(text, warn) })
    else if (/^\[(toc|\[toc\])\]$/i.test(text.trim())) blocks.push({ type: 'toc', levels: 3, title: '' })
    else blocks.push(imageBlock(text, warn) ?? paragraph(text, warn))
  }
  return blocks
}

/** Types d'alerte Markdown (GitHub, Obsidian) → type d'encadré. */
const CALLOUT_ALIASES: Record<string, CalloutKind> = {
  note: 'note', info: 'note', abstract: 'note', summary: 'note', todo: 'note', example: 'note',
  tip: 'tip', hint: 'tip', success: 'tip', check: 'tip', done: 'tip',
  important: 'important', question: 'important', help: 'important',
  warning: 'warning', attention: 'warning',
  caution: 'caution', danger: 'caution', error: 'caution', failure: 'caution', bug: 'caution',
}

/** Liste à partir de la ligne `start` ; ajoute un ou plusieurs blocs et renvoie la ligne suivante. */
function parseList(lines: string[], start: number, blocks: Block[], warn?: MdWarn): number {
  // « - [ ] tâche » / « - [x] faite » : liste à cocher (GitHub).
  const TASK = /^\[([ xX])\]\s+/
  const styleOf = (marker: string, text = ''): ListStyle => (/\d/.test(marker) ? 'number' : TASK.test(text) ? 'check' : 'bullet')
  const first = RE.item.exec(lines[start])!
  const rootStyle = styleOf(first[2], first[3] ?? '')
  const listStart = rootStyle === 'number' ? Math.max(1, parseInt(first[2], 10) || 1) : 1
  const indents: number[] = [indentOf(lines[start])]
  const items: { lines: string[]; level: number; style: ListStyle; checked?: boolean }[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (i > start && RE.hr.test(line)) break
    const m = RE.item.exec(line)
    if (m) {
      const indent = m[1].length
      while (indents.length > 1 && indent < indents[indents.length - 1]) indents.pop()
      if (indent > indents[indents.length - 1] && items.length > 0 && indents.length < 9) indents.push(indent)
      const level = indent < indents[0] ? 0 : indents.length - 1
      const style = styleOf(m[2], m[3] ?? '')
      if (level === 0 && style !== rootStyle) break // une liste d'un autre type commence
      const task = style === 'check' ? TASK.exec(m[3] ?? '') : null
      items.push({ lines: [task ? (m[3] ?? '').slice(task[0].length) : (m[3] ?? '')], level, style, ...(task && task[1] !== ' ' ? { checked: true } : {}) })
      i++
      continue
    }
    if (RE.blank.test(line)) {
      // Une ligne vide termine la liste, sauf si la suite reprend la liste.
      let j = i + 1
      while (j < lines.length && RE.blank.test(lines[j])) j++
      const next = lines[j]
      if (next !== undefined && RE.item.test(next) && indentOf(next) >= indents[0]) {
        const nm = RE.item.exec(next)!
        if (indentOf(next) > indents[0] || styleOf(nm[2], nm[3] ?? '') === rootStyle) {
          i = j
          continue
        }
      }
      if (next !== undefined && indentOf(next) > indents[0] + 1 && items.length && !RE.item.test(next)) {
        // paragraphe de continuation indenté : rattaché à l'élément précédent
        items[items.length - 1].lines.push(next)
        i = j + 1
        continue
      }
      break
    }
    // Ligne de continuation (paresseuse ou indentée) de l'élément précédent.
    if (startsBlock(lines, i) && indentOf(line) <= indents[0]) break
    items[items.length - 1].lines.push(line)
    i++
  }
  const listItems: ListItem[] = items.map((it) => ({
    content: parseInline(joinLines(it.lines), warn),
    level: it.level,
    style: it.style,
    ...(it.checked ? { checked: true as const } : {}),
  }))
  blocks.push({ type: 'list', style: rootStyle, start: listStart, items: listItems })
  return i
}
