// Révision → Comparer : deux versions d'un document → un document dont les
// différences sont des modifications suivies (ajouts, suppressions, mise en
// forme des caractères et des paragraphes), à accepter ou refuser.
//
// Méthode : les deux documents sont d'abord ramenés à leur version finale
// (modifications en attente acceptées) ; les blocs sont alignés (diff de Myers
// sur leur contenu exact), puis, dans chaque zone qui diffère, les blocs
// semblables sont appariés et comparés mot à mot. Ce qui ne peut pas porter de
// marque de suivi (images, tableaux de forme différente, code, formules en
// bloc) prend la forme de la nouvelle version et est compté à part.

import { formatOnly, mergeRuns } from './runs'
import { isRun, type Block, type Change, type FolioDoc, type Inline, type ListItem, type Marks, type ParaBefore, type ParaProps, type Run } from './types'

export interface CompareStats {
  insertions: number
  deletions: number
  formatting: number
  /** Objets changés qui ne peuvent pas être montrés en marques (image, tableau, code…). */
  objects: number
}

type Op<T> = { op: 'eq'; a: T; b: T } | { op: 'del'; a: T } | { op: 'ins'; b: T }

/** Différence de deux suites (Myers, après le début et la fin communs). Au-delà de `limit` différences : tout est remplacé. */
export function diffSeq<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean, limit = 4000): Op<T>[] {
  let start = 0
  while (start < a.length && start < b.length && eq(a[start], b[start])) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && eq(a[endA - 1], b[endB - 1])) {
    endA--
    endB--
  }
  const head: Op<T>[] = a.slice(0, start).map((x, i) => ({ op: 'eq', a: x, b: b[i] }))
  const tail: Op<T>[] = a.slice(endA).map((x, i) => ({ op: 'eq', a: x, b: b[endB + i] }))
  const A = a.slice(start, endA)
  const B = b.slice(start, endB)
  const n = A.length
  const m = B.length
  const middle: Op<T>[] = []
  if (!n) B.forEach((y) => middle.push({ op: 'ins', b: y }))
  else if (!m) A.forEach((x) => middle.push({ op: 'del', a: x }))
  else {
    const max = Math.min(n + m, limit)
    const off = max + 1
    const v = new Int32Array(2 * max + 3)
    const trace: Int32Array[] = []
    let found = -1
    for (let d = 0; d <= max && found < 0; d++) {
      trace.push(v.slice())
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
        let y = x - k
        while (x < n && y < m && eq(A[x], B[y])) {
          x++
          y++
        }
        v[off + k] = x
        if (x >= n && y >= m) {
          found = d
          break
        }
      }
    }
    if (found < 0) {
      // Trop de différences : la zone est remplacée d'un bloc.
      A.forEach((x) => middle.push({ op: 'del', a: x }))
      B.forEach((y) => middle.push({ op: 'ins', b: y }))
    } else {
      // Remonte le chemin.
      let x = n
      let y = m
      const rev: Op<T>[] = []
      for (let d = found; d > 0; d--) {
        const vd = trace[d]
        const k = x - y
        const prevK = k === -d || (k !== d && vd[off + k - 1] < vd[off + k + 1]) ? k + 1 : k - 1
        const prevX = vd[off + prevK]
        const prevY = prevX - prevK
        while (x > prevX && y > prevY) rev.push({ op: 'eq', a: A[--x], b: B[--y] })
        if (x === prevX) rev.push({ op: 'ins', b: B[--y] })
        else rev.push({ op: 'del', a: A[--x] })
      }
      while (x > 0 && y > 0) rev.push({ op: 'eq', a: A[--x], b: B[--y] })
      middle.push(...rev.reverse())
    }
  }
  return [...head, ...middle, ...tail]
}

// --- version finale ------------------------------------------------------------

/** Les modifications en attente acceptées : texte supprimé retiré, marques de suivi enlevées. */
function finalInlines(items: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const x of items) {
    if (isRun(x)) {
      if (x.deleted) continue
      const { inserted, formatChange, ...rest } = x
      void inserted, formatChange
      out.push(rest)
    } else if (x.type === 'note') out.push({ ...x, blocks: finalBlocks(x.blocks) })
    else out.push(x)
  }
  return out
}

function finalBlocks(blocks: Block[]): Block[] {
  return blocks.map((b): Block => {
    const strip = <T extends ParaProps>(p: T): T => {
      const { formatChange, ...rest } = p
      void formatChange
      return rest as T
    }
    if (b.type === 'paragraph' || b.type === 'heading') return strip({ ...b, content: finalInlines(b.content) })
    if (b.type === 'list') return { ...b, items: b.items.map((it) => strip({ ...it, content: finalInlines(it.content) })) }
    if (b.type === 'quote' || b.type === 'callout' || b.type === 'columns') return { ...b, blocks: finalBlocks(b.blocks) } as Block
    if (b.type === 'table') return { ...b, rows: b.rows.map((r) => r.map((c) => ({ ...c, blocks: finalBlocks(c.blocks) }))) }
    if (b.type === 'image') return { ...b, caption: finalInlines(b.caption) }
    return b
  })
}

// --- mots ----------------------------------------------------------------------

type Token = { key: string; item: Inline }

const WORD = /\s+|[\p{L}\p{N}_’'-]+|[^\s\p{L}\p{N}_’'-]/gu

/** Les éléments en ligne en jetons : mots, espaces, ponctuation ; un objet en ligne compte pour un. */
function tokens(items: Inline[]): Token[] {
  const out: Token[] = []
  for (const x of items) {
    if (isRun(x)) {
      const { text, ...marks } = x
      for (const m of text.match(WORD) ?? []) out.push({ key: `t:${m}`, item: { ...marks, text: m } })
    } else out.push({ key: `o:${JSON.stringify(x)}`, item: x })
  }
  return out
}

const plain = (items: Inline[]) => items.map((x) => (isRun(x) ? x.text : '￼')).join('')

/** Ressemblance de deux textes (mots communs / mots de l'ensemble), 0 à 1. */
function similarity(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  const wb = new Set(b.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  if (!wa.size && !wb.size) return a.trim() === b.trim() ? 1 : 0.5
  let common = 0
  for (const w of wa) if (wb.has(w)) common++
  return common / (wa.size + wb.size - common)
}

const fmtKey = (m: Marks) => JSON.stringify(Object.entries(formatOnly(m)).sort(([x], [y]) => (x < y ? -1 : 1)))

class Comparer {
  stats: CompareStats = { insertions: 0, deletions: 0, formatting: 0, objects: 0 }
  constructor(private change: Change) {}

  /** Mot à mot : ajouts, suppressions, mise en forme changée. */
  inlines(a: Inline[], b: Inline[]): Inline[] {
    const out: Inline[] = []
    let lastIns = false
    let lastDel = false
    for (const o of diffSeq(tokens(a), tokens(b), (x, y) => x.key === y.key)) {
      if (o.op === 'eq') {
        lastIns = lastDel = false
        const now = o.b.item
        if (isRun(now) && isRun(o.a.item) && fmtKey(now) !== fmtKey(o.a.item)) {
          out.push({ ...now, formatChange: { ...this.change, before: formatOnly(o.a.item as Marks) } })
          this.stats.formatting++
        } else out.push(now)
      } else if (o.op === 'del') {
        if (isRun(o.a.item)) {
          const { comments, link, ...rest } = o.a.item as Run
          void comments
          out.push({ ...rest, ...(link ? { link } : {}), deleted: { ...this.change } })
          if (!lastDel && o.a.item.text.trim()) this.stats.deletions++
          lastDel = !!o.a.item.text.trim() || lastDel
        } else this.stats.objects++
      } else {
        if (isRun(o.b.item)) {
          out.push({ ...o.b.item, inserted: { ...this.change } })
          if (!lastIns && o.b.item.text.trim()) this.stats.insertions++
          lastIns = !!o.b.item.text.trim() || lastIns
        } else {
          out.push(o.b.item)
          this.stats.objects++
        }
      }
    }
    return mergeRuns(out)
  }

  /** Tout le texte ajouté, ou tout le texte supprimé. */
  private marked(items: Inline[], kind: 'inserted' | 'deleted'): Inline[] {
    const out: Inline[] = []
    for (const x of items) {
      if (isRun(x)) {
        const { comments, ...rest } = x
        out.push(kind === 'deleted' ? { ...rest, deleted: { ...this.change } } : { ...(comments ? { comments } : {}), ...rest, inserted: { ...this.change } })
      } else if (kind === 'inserted') out.push(x)
    }
    if (out.some((x) => isRun(x) && x.text.trim())) this.stats[kind === 'inserted' ? 'insertions' : 'deletions']++
    return out
  }

  /** Un bloc ajouté (marqué si c'est du texte ; tel quel sinon, compté). */
  private added(b: Block): Block {
    if (b.type === 'paragraph' || b.type === 'heading') return { ...b, content: this.marked(b.content, 'inserted') }
    if (b.type === 'list') return { ...b, items: b.items.map((it) => ({ ...it, content: this.marked(it.content, 'inserted') })) }
    if (b.type === 'quote' || b.type === 'callout' || b.type === 'columns') return { ...b, blocks: b.blocks.map((x) => this.added(x)) } as Block
    if (!['pagebreak', 'columnbreak', 'section', 'toc'].includes(b.type)) this.stats.objects++
    return b
  }

  /** Un bloc retiré : son texte reste, barré ; un objet disparaît (compté). */
  private removed(b: Block): Block | null {
    if (b.type === 'paragraph' || b.type === 'heading') return { ...b, content: this.marked(b.content, 'deleted') }
    if (b.type === 'list') return { ...b, items: b.items.map((it) => ({ ...it, content: this.marked(it.content, 'deleted') })) }
    if (b.type === 'quote' || b.type === 'callout' || b.type === 'columns') {
      const inner = b.blocks.map((x) => this.removed(x)).filter((x): x is Block => !!x)
      return inner.length ? ({ ...b, blocks: inner } as Block) : null
    }
    if (!['pagebreak', 'columnbreak', 'section', 'toc'].includes(b.type)) this.stats.objects++
    return null
  }

  /** Mise en forme de paragraphe d'avant, si elle diffère. */
  private paraBefore(a: Block, b: Block): ParaBefore | null {
    const state = (x: Block): ParaBefore => {
      const { type, content, ink, formatChange, level, style, ...props } = x as Record<string, unknown>
      void type, content, ink, formatChange
      return { kind: x.type === 'heading' ? 'heading' : 'paragraph', ...(x.type === 'heading' ? { level: level as number } : {}), ...(typeof style === 'string' ? { style } : {}), ...(props as ParaProps) }
    }
    const was = state(a)
    return JSON.stringify(was) === JSON.stringify(state(b)) ? null : was
  }

  /** Deux blocs appariés : comparés en profondeur. */
  private modified(a: Block, b: Block): Block {
    if ((a.type === 'paragraph' || a.type === 'heading') && (b.type === 'paragraph' || b.type === 'heading')) {
      const before = this.paraBefore(a, b)
      if (before) this.stats.formatting++
      return { ...b, content: this.inlines(a.content, b.content), ...(before ? { formatChange: { ...this.change, before } } : {}) } as Block
    }
    if (a.type === 'list' && b.type === 'list') return { ...b, items: this.items(a.items, b.items) }
    if ((a.type === 'quote' || a.type === 'callout' || a.type === 'columns') && a.type === b.type) return { ...b, blocks: this.blocks(a.blocks, (b as typeof a).blocks) } as Block
    if (a.type === 'table' && b.type === 'table' && a.rows.length === b.rows.length && a.rows.every((r, i) => r.length === b.rows[i].length)) {
      return { ...b, rows: b.rows.map((r, i) => r.map((c, j) => ({ ...c, blocks: this.blocks(a.rows[i][j].blocks, c.blocks) }))) }
    }
    if (a.type === 'image' && b.type === 'image') {
      if (a.src !== b.src || JSON.stringify({ ...a, caption: [] }) !== JSON.stringify({ ...b, caption: [] })) this.stats.objects++
      return { ...b, caption: this.inlines(a.caption, b.caption) }
    }
    this.stats.objects++
    return b
  }

  /** Éléments de liste : appariés comme des paragraphes. */
  private items(a: ListItem[], b: ListItem[]): ListItem[] {
    const out: ListItem[] = []
    const key = (it: ListItem) => JSON.stringify(it)
    const ops = diffSeq(a, b, (x, y) => key(x) === key(y))
    for (const group of regions(ops)) {
      if (group.kind === 'eq') {
        out.push(...group.b)
        continue
      }
      for (const p of pair(group.a, group.b, (x) => plain(x.content), () => true)) {
        if (p.a && p.b) out.push({ ...p.b, content: this.inlines(p.a.content, p.b.content) })
        else if (p.b) out.push({ ...p.b, content: this.marked(p.b.content, 'inserted') })
        else if (p.a) out.push({ ...p.a, content: this.marked(p.a.content, 'deleted') })
      }
    }
    return out
  }

  blocks(a: Block[], b: Block[]): Block[] {
    const out: Block[] = []
    const key = (x: Block) => JSON.stringify(x)
    for (const group of regions(diffSeq(a, b, (x, y) => key(x) === key(y)))) {
      if (group.kind === 'eq') {
        out.push(...group.b)
        continue
      }
      for (const p of pair(group.a, group.b, blockText, compatible)) {
        if (p.a && p.b) out.push(this.modified(p.a, p.b))
        else if (p.b) out.push(this.added(p.b))
        else if (p.a) {
          const r = this.removed(p.a)
          if (r) out.push(r)
        }
      }
    }
    return out
  }
}

/** Texte d'un bloc (pour l'appariement). */
function blockText(b: Block): string {
  if (b.type === 'paragraph' || b.type === 'heading') return plain(b.content)
  if (b.type === 'list') return b.items.map((it) => plain(it.content)).join('\n')
  if (b.type === 'quote' || b.type === 'callout' || b.type === 'columns') return b.blocks.map(blockText).join('\n')
  if (b.type === 'table') return b.rows.map((r) => r.map((c) => c.blocks.map(blockText).join(' ')).join('\t')).join('\n')
  if (b.type === 'image') return `${b.src.slice(0, 64)} ${plain(b.caption)}`
  if (b.type === 'code') return b.text
  return b.type
}

const TEXT = new Set(['paragraph', 'heading'])
/** Deux blocs qu'on peut comparer en profondeur. */
const compatible = (a: Block, b: Block) => (TEXT.has(a.type) && TEXT.has(b.type)) || a.type === b.type

/** Groupes successifs : égaux, ou une zone où la première version et la nouvelle diffèrent. */
function regions<T>(ops: Op<T>[]): ({ kind: 'eq'; b: T[] } | { kind: 'diff'; a: T[]; b: T[] })[] {
  const out: ({ kind: 'eq'; b: T[] } | { kind: 'diff'; a: T[]; b: T[] })[] = []
  for (const o of ops) {
    const last = out[out.length - 1]
    if (o.op === 'eq') {
      if (last?.kind === 'eq') last.b.push(o.b)
      else out.push({ kind: 'eq', b: [o.b] })
    } else {
      const g = last?.kind === 'diff' ? last : (out.push({ kind: 'diff', a: [], b: [] }), out[out.length - 1] as { kind: 'diff'; a: T[]; b: T[] })
      if (o.op === 'del') g.a.push(o.a)
      else g.b.push(o.b)
    }
  }
  return out
}

/**
 * Apparie, dans l'ordre, les éléments retirés et ajoutés qui se ressemblent
 * (plus longue suite commune pondérée par la ressemblance) ; les autres restent seuls.
 */
function pair<T>(a: T[], b: T[], text: (x: T) => string, ok: (x: T, y: T) => boolean): { a?: T; b?: T }[] {
  const n = a.length
  const m = b.length
  if (!n || !m || n * m > 250_000) return [...a.map((x) => ({ a: x })), ...b.map((y) => ({ b: y }))]
  // Un seul bloc remplacé par un seul : toujours comparé mot à mot (une cellule, un nombre changé).
  if (n === 1 && m === 1 && ok(a[0], b[0])) return [{ a: a[0], b: b[0] }]
  const ta = a.map(text)
  const tb = b.map(text)
  const sim = (i: number, j: number) => (ok(a[i], b[j]) ? similarity(ta[i], tb[j]) : 0)
  // score[i][j] : meilleur appariement de a[i..] et b[j..].
  const score = new Float64Array((n + 1) * (m + 1))
  const at = (i: number, j: number) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = sim(i, j)
      score[at(i, j)] = Math.max(score[at(i + 1, j)], score[at(i, j + 1)], s >= 0.3 ? s + score[at(i + 1, j + 1)] : 0)
    }
  }
  const out: { a?: T; b?: T }[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    const s = sim(i, j)
    if (s >= 0.3 && score[at(i, j)] === s + score[at(i + 1, j + 1)]) out.push({ a: a[i++], b: b[j++] })
    else if (score[at(i, j)] === score[at(i + 1, j)]) out.push({ a: a[i++] })
    else out.push({ b: b[j++] })
  }
  while (i < n) out.push({ a: a[i++] })
  while (j < m) out.push({ b: b[j++] })
  return out
}

/**
 * Compare `original` à `revised` : le document rendu est `revised`, avec les
 * différences en modifications suivies au nom de `change.author`.
 */
export function compareDocuments(original: FolioDoc, revised: FolioDoc, change: Change): { doc: FolioDoc; stats: CompareStats } {
  const c = new Comparer(change)
  const blocks = c.blocks(finalBlocks(original.blocks), finalBlocks(revised.blocks))
  const doc: FolioDoc = {
    ...revised,
    trackChanges: true,
    blocks,
    // Les images d'origine encore citées (une légende comparée, par exemple) restent disponibles.
    assets: { ...original.assets, ...revised.assets },
  }
  return { doc, stats: c.stats }
}

