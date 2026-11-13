// Valeurs des références calculées sur le format (sans éditeur) : pour l'export
// .docx, qui écrit chaque champ avec sa valeur à jour. Même règles que le
// greffon de l'éditeur (editor/refs.ts), même ordre de parcours (celui du
// document, hors notes, en-têtes et pieds de page).

import type { Block, FolioDoc, Inline, XrefShow } from '../format/types'
import { isRun } from '../format/types'
import { citationText, citeContext, type CiteContext } from './cite'

export interface FormatRefs {
  /** Numéro de chaque élément « seq », par identité de l'objet. */
  seq: Map<Inline, number>
  /** Texte de chaque renvoi et de chaque citation. */
  text: Map<Inline, string>
  /** Légendes, dans l'ordre : étiquette, numéro, texte complet. */
  captions: { label: string; number: number; text: string }[]
  /** Entrées d'index et de table des références, dans l'ordre du document. */
  entries: Extract<Inline, { type: 'xe' }>[]
  /** Sources citées, dans l'ordre de première citation. */
  cited: string[]
  cite: CiteContext
}

interface Para {
  content: Inline[]
}

/** Paragraphes du document dans l'ordre (légendes d'images comprises). */
function paragraphs(blocks: Block[], out: Para[] = []): Para[] {
  for (const b of blocks) {
    if (b.type === 'paragraph' || b.type === 'heading') out.push({ content: b.content })
    else if (b.type === 'list') for (const it of b.items) out.push({ content: it.content })
    else if (b.type === 'quote' || b.type === 'columns') paragraphs(b.blocks, out)
    else if (b.type === 'table') for (const row of b.rows) for (const c of row) paragraphs(c.blocks, out)
    else if (b.type === 'image') out.push({ content: b.caption })
  }
  return out
}

const textOf = (p: Para, seq: Map<Inline, number>, until?: Inline): string => {
  let s = ''
  for (const x of p.content) {
    if (isRun(x)) s += x.text
    else if (x.type === 'seq') s += String(seq.get(x) ?? '?')
    if (x === until) break
  }
  return s.replace(/\s+/g, ' ').trim()
}

export interface FormatRefsOptions {
  lang: string
  /** Page de chaque signet (vue page de l'application), si connue. */
  bookmarkPage?: (name: string) => string | null
  labels: { missing: string; above: string; below: string }
}

export function formatRefs(doc: FolioDoc, o: FormatRefsOptions): FormatRefs {
  const paras = paragraphs(doc.blocks)
  const seq = new Map<Inline, number>()
  const counts = new Map<string, number>()
  const marks = new Map<string, { para: Para; order: number }>()
  const captions: FormatRefs['captions'] = []
  const entries: FormatRefs['entries'] = []
  const xrefs: { x: Extract<Inline, { type: 'xref' }>; order: number }[] = []
  const cites: Extract<Inline, { type: 'cite' }>[] = []
  let order = 0
  for (const p of paras) {
    let first: Extract<Inline, { type: 'seq' }> | null = null
    for (const x of p.content) {
      order++
      if (isRun(x)) continue
      if (x.type === 'seq') {
        const k = (counts.get(x.label) ?? 0) + 1
        counts.set(x.label, k)
        seq.set(x, k)
        first ??= x
      } else if (x.type === 'bookmark' && !marks.has(x.name)) marks.set(x.name, { para: p, order })
      else if (x.type === 'xref') xrefs.push({ x, order })
      else if (x.type === 'cite') cites.push(x)
      else if (x.type === 'xe') entries.push(x)
    }
    if (first) captions.push({ label: first.label, number: seq.get(first) ?? 0, text: textOf(p, seq) })
  }
  const text = new Map<Inline, string>()
  for (const { x, order: at } of xrefs) {
    const m = marks.get(x.target)
    if (!m) {
      text.set(x, o.labels.missing)
      continue
    }
    const first = m.para.content.find((y) => !isRun(y) && y.type === 'seq')
    const show: XrefShow = x.show
    text.set(
      x,
      show === 'page'
        ? (o.bookmarkPage?.(x.target) ?? '1')
        : show === 'above'
          ? at < m.order
            ? o.labels.below
            : o.labels.above
          : show === 'number' && first
            ? String(seq.get(first) ?? '')
            : show === 'label' && first
              ? textOf(m.para, seq, first)
              : textOf(m.para, seq),
    )
  }
  const cited = cites.flatMap((c) => c.ids)
  const cite = citeContext(doc.sources ?? [], cited, doc.citationStyle ?? 'apa', doc.meta.lang || o.lang)
  for (const c of cites) text.set(c, citationText(cite, c.ids, c.locator ?? ''))
  return { seq, text, captions, entries, cited, cite }
}
