// Outils sur les éléments en ligne : comparaison des mises en forme et fusion
// des morceaux voisins identiques, pour une forme canonique unique.

import { parseColor, parseHighlight } from './color'
import { mathMarks, COMMENT_ID, RUN_FLAGS, RUN_VALUES, UNDERLINE_STYLES, isRun, type BookmarkInline, type CiteInline, type IndexInline, type Inline, type Marks, type Run, type SeqInline, type XrefInline } from './types'

export type { Marks }

export function sameMarks(a: Marks, b: Marks): boolean {
  for (const f of RUN_FLAGS) if (!!a[f] !== !!b[f]) return false
  for (const v of RUN_VALUES) if ((a[v] ?? null) !== (b[v] ?? null)) return false
  const change = (c?: { author: string; date: string }) => (c ? `${c.author}\u0000${c.date}` : '')
  return (a.comments ?? []).join(' ') === (b.comments ?? []).join(' ') && change(a.inserted) === change(b.inserted) && change(a.deleted) === change(b.deleted)
}

/**
 * Copie propre des marques : seules les marques actives, dans un ordre fixe,
 * valeurs ramenées à leur forme canonique. Les valeurs ont déjà été validées.
 */
export function cleanMarks(m: Marks | Record<string, unknown>): Marks {
  const src = m as Record<string, unknown>
  const out: Marks = {}
  for (const f of RUN_FLAGS) if (src[f] === true) out[f] = true
  // Exposant et indice s'excluent ; l'exposant l'emporte.
  if (out.sup && out.sub) delete out.sub
  if (typeof src.link === 'string' && src.link) out.link = src.link
  if (typeof src.color === 'string') {
    const c = parseColor(src.color)
    if (c) out.color = c
  }
  if (typeof src.highlight === 'string') {
    const c = parseHighlight(src.highlight)
    if (c) out.highlight = c
  }
  if (typeof src.font === 'string' && src.font.trim()) out.font = src.font.trim()
  if (typeof src.size === 'number' && Number.isFinite(src.size) && src.size > 0) out.size = src.size
  if (typeof src.letterSpacing === 'number' && Number.isFinite(src.letterSpacing) && src.letterSpacing !== 0) out.letterSpacing = src.letterSpacing
  if (typeof src.lang === 'string' && src.lang) out.lang = src.lang
  if (typeof src.underlineStyle === 'string' && (UNDERLINE_STYLES as readonly string[]).includes(src.underlineStyle)) out.underlineStyle = src.underlineStyle as Marks['underlineStyle']
  for (const k of ['underlineColor', 'glow', 'textBorder', 'textShading'] as const) {
    if (typeof src[k] !== 'string') continue
    const c = parseColor(src[k] as string)
    if (c) out[k] = c
  }
  // Commentaires : liste d'identifiants (« comment » seul est accepté aussi), sans doublon, triée.
  const ids = [...(Array.isArray(src.comments) ? src.comments : []), ...(typeof src.comment === 'string' ? [src.comment] : [])].filter(
    (x): x is string => typeof x === 'string' && COMMENT_ID.test(x),
  )
  if (ids.length) out.comments = [...new Set(ids)].sort()
  for (const k of ['inserted', 'deleted'] as const) {
    const c = src[k]
    if (c && typeof c === 'object') out[k] = cleanChange(c as Record<string, unknown>)
  }
  return out
}

/** Auteur et date d'une modification suivie, sous forme canonique. */
export function cleanChange(c: Record<string, unknown>): { author: string; date: string } {
  const author = typeof c.author === 'string' ? c.author.trim().slice(0, 100) : ''
  const t = typeof c.date === 'string' && c.date.trim() ? Date.parse(c.date) : NaN
  return { author, date: Number.isFinite(t) ? new Date(t).toISOString() : '' }
}

export function marksOfInline(x: Inline): Marks {
  return cleanMarks(x as Marks)
}

export function makeRun(text: string, marks: Marks = {}): Run {
  return { text, ...cleanMarks(marks) }
}

/** Retire les morceaux vides et fusionne les voisins de même mise en forme. */
export function mergeRuns(items: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const r of items) {
    if (!isRun(r)) {
      if (r.type === 'note') out.push({ type: 'note', kind: r.kind, blocks: r.blocks })
      else if (r.type === 'math') out.push({ type: 'math', tex: r.tex, ...mathMarks(r) })
      else if (r.type === 'mergefield') out.push({ type: 'mergefield', name: r.name, ...(r.opts ? { opts: { ...r.opts } } : {}), ...cleanMarks(r) })
      else if (r.type === 'field') out.push({ type: r.type, name: r.name, format: r.format, ...cleanMarks(r) })
      else out.push(refInline(r))
      continue
    }
    if (!r.text) continue
    const last = out[out.length - 1]
    if (last && isRun(last) && sameMarks(last, r)) last.text += r.text
    else out.push(makeRun(r.text, r))
  }
  return out
}

export type RefInline = SeqInline | BookmarkInline | XrefInline | IndexInline | CiteInline

/** Copie canonique d'un élément de référence (numéro de légende, signet, renvoi, entrée d'index, citation). */
export function refInline(r: RefInline): Inline {
  switch (r.type) {
    case 'seq':
      return { type: 'seq', label: r.label, ...cleanMarks(r) }
    case 'bookmark':
      return { type: 'bookmark', name: r.name }
    case 'xref':
      return { type: 'xref', target: r.target, show: r.show, ...cleanMarks(r) }
    case 'cite':
      return { type: 'cite', ids: [...r.ids], ...(r.locator ? { locator: r.locator } : {}), ...cleanMarks(r) }
    case 'xe':
      return {
        type: 'xe',
        term: r.term,
        ...(r.sub ? { sub: r.sub } : {}),
        ...(r.see ? { see: r.see } : {}),
        ...(r.bold ? { bold: true as const } : {}),
        ...(r.italic ? { italic: true as const } : {}),
        ...(r.authority ? { authority: r.authority } : {}),
        ...(r.short ? { short: r.short } : {}),
      }
  }
}

/** Texte brut d'éléments en ligne (un champ compte comme son jeton {{nom}}). */
export const runsText = (items: Inline[]): string =>
  items.map((r) => (isRun(r) ? r.text : r.type === 'field' ? `{{${r.name}${r.format ? ':' + r.format : ''}}}` : r.type === 'math' ? `$${r.tex}$` : r.type === 'mergefield' ? `«${r.name}»` : '')).join('')

export const plainRuns = (text: string): Run[] => (text ? [{ text }] : [])

export const isPlainRun = (r: Inline): r is Run => isRun(r) && Object.keys(r).length === 1
