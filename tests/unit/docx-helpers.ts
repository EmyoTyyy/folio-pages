// Outils des tests .docx : lecture des fichiers de test, et mise en forme
// « comparable » d'un document pour vérifier un aller-retour.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import { importDocx, type ImportResult } from '../../src/docx/import'
import { pageTextWidth } from '../../src/docx/export'
import { loadDocument } from '../../src/format/load'
import { mergeRuns } from '../../src/format/runs'
import type { FolioDoc } from '../../src/format/types'

export const NOW = '2026-01-01T00:00:00.000Z'

export const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/docx/${name}`, import.meta.url))))

/** Parties XML d'un fichier .docx, en texte. */
export function parts(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {}
  const files = unzipSync(bytes)
  for (const k of Object.keys(files)) if (/\.(xml|rels)$/.test(k)) out[k] = strFromU8(files[k])
  return out
}

/** Importe un .docx puis le fait passer par la validation de l'application, comme à l'ouverture. */
export function open(bytes: Uint8Array): { doc: FolioDoc; res: ImportResult; issues: unknown[] } {
  const res = importDocx(bytes)
  const l = loadDocument(res.doc, { now: NOW })
  if (!l.ok) throw new Error(`refusé : ${l.reason}`)
  return { doc: l.doc, res, issues: l.report.issues }
}

/** Tout le texte d'un document, dans l'ordre (corps, notes, légendes, code). */
export function allText(doc: FolioDoc): string {
  let s = ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inl = (items: any[]) => {
    for (const x of items) {
      if (x.type === 'note') blk(x.blocks)
      else if (x.type === 'math') s += `$${x.tex}$`
      else if (x.type !== 'field') s += x.text
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blk = (blocks: any[]) => {
    for (const b of blocks) {
      if (b.content) inl(b.content)
      if (b.items) for (const it of b.items) inl(it.content)
      if (b.blocks) blk(b.blocks)
      if (b.rows) for (const r of b.rows) for (const c of r) blk(c.blocks)
      if (b.type === 'code') s += b.text
      if (b.type === 'image') inl(b.caption)
      s += '\n'
    }
  }
  blk(doc.blocks)
  return s
}

const SAFE = /^(https?:|mailto:|tel:)/i
type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

/** La première cellule de cette ligne est-elle bien dans la première colonne ? (pas sous une fusion verticale) */
function firstCol(t: Any, ri: number): boolean {
  for (let r = 0; r < ri; r++) if ((t.rows[r][0]?.rowspan ?? 1) > ri - r) return false
  return true
}

/** Le dernier paragraphe d'une cellule n'a pas d'espace sous lui, qu'on l'ait demandé ou non. */
function tight(blocks: Any[]): Any[] {
  const last = blocks[blocks.length - 1]
  if (!last || (last.type !== 'paragraph' && last.type !== 'heading') || last.spacing?.after !== 0) return blocks
  const spacing = { ...last.spacing }
  delete spacing.after
  const copy = { ...last, spacing }
  if (!Object.keys(spacing).length) delete copy.spacing
  return [...blocks.slice(0, -1), copy]
}

/**
 * Le document tel qu'un aller-retour .docx doit le rendre : identique, à ce
 * qu'un fichier .docx ne peut pas porter près. Chaque règle ci-dessous est une
 * limite connue et documentée du format, pas une tolérance de confort :
 *
 *   - les identifiants des images et des commentaires sont réattribués ;
 *   - un lien interne (« #ancre ») devient du texte ; la langue d'un extrait de code est perdue ;
 *   - une image du web ou introuvable est remplacée par son texte de remplacement ;
 *   - une image plus large que la place disponible est ramenée à cette largeur ;
 *   - un commentaire couvre tout ce qui se trouve entre son premier et son dernier passage ;
 *   - une citation ne garde que ses paragraphes sans style ; des colonnes dans une citation sont mises à plat ;
 *   - le gras d'une ligne d'en-tête ou d'une première colonne vient du tableau ; le dernier paragraphe d'une
 *     cellule n'a pas d'espace sous lui ;
 *   - capitales et petites capitales ensemble : des capitales ;
 *   - un texte à la fois « ajouté » et « supprimé » est supprimé ; sans auteur ni date, ceux de l'export ;
 *   - un saut de section en tête de document règle le document lui-même.
 */
export function comparable(doc: FolioDoc): Any {
  const textWidth = pageTextWidth(doc.page)
  const ids = new Map<string, string>(doc.comments.map((c, i) => [c.id, `k${i}`]))
  const inl = (items: Any[], inTable: boolean, strong = false): Any[] =>
    mergeRuns(
      items.map((x) => {
        const y = { ...x }
        if (y.link && !SAFE.test(y.link)) delete y.link
        if (y.caps && y.smallcaps) delete y.smallcaps
        if (y.type === 'field' && !['date', 'time', 'created', 'modified'].includes(y.name)) y.format = ''
        if (y.comments) y.comments = y.comments.map((id: string) => ids.get(id) ?? id).sort()
        for (const k of ['inserted', 'deleted']) if (y[k]) y[k] = { author: y[k].author || '—', date: y[k].date || NOW }
        if (y.type === 'note') y.blocks = blk(y.blocks, inTable)
        if (y.inserted && y.deleted) delete y.inserted
        if (strong) delete y.bold
        return y
      }) as Any,
    )
  const blk = (blocks: Any[], inTable: boolean, strong = false): Any[] => {
    let numbered = false
    let prev: Any = null
    return blocks.flatMap((b) => {
      const out = one(b)
      if (out.length) prev = out[out.length - 1]
      return out
    })
    function one(b: Any): Any[] {
      const y = { ...b }
      // Numérotation « 1. 1. 1. » ou « 1.1. » : la même chose que « 1. a. i. » tant qu'aucun sous-niveau n'est numéroté.
      if (y.type === 'list' && y.style === 'number' && (y.numbering === 'decimal' || y.numbering === 'outline')) {
        const first = (l: number) => y.items.find((it: Any) => it.level === l)?.style
        const s1 = first(1) ?? 'number'
        const s2 = first(2) ?? s1
        if (s1 === 'bullet' && s2 === 'bullet' && !y.items.some((it: Any) => it.level > 0 && it.style === 'number')) delete y.numbering
        // « 1. a. i. » numérote les niveaux 1, 4, 7 en chiffres : si seuls ceux-là sont numérotés, c'est « 1. 1. 1. ».
        else if (y.numbering === 'decimal' && y.items.every((it: Any) => it.style !== 'number' || it.level % 3 === 0)) delete y.numbering
      }
      if (y.type === 'list' && y.style === 'number') {
        // « continue » sans liste numérotée avant, dans le même conteneur : sans effet.
        if (!numbered) delete y.continue
        numbered = true
        // Une liste qui continue la précédente en suit le numéro et l'écriture.
        if (y.continue) {
          y.start = 1
          delete y.numbering
        }
      }
      if (y.content) y.content = inl(y.content, inTable, strong)
      if (y.items) y.items = y.items.map((it: Any) => ({ ...it, content: inl(it.content, inTable, strong) }))
      // Une liste qui continue celle qui la précède immédiatement : c'est la même liste, plus longue.
      if (y.type === 'list' && y.continue && prev && prev.type === 'list' && prev.style === 'number') {
        prev.items = [...prev.items, ...y.items]
        return []
      }
      if (y.blocks) y.blocks = blk(y.blocks, inTable, strong)
      if (y.rows) y.rows = y.rows.map((r: Any[], ri: number) => r.map((c, ci) => ({ ...c, blocks: tight(blk(c.blocks, true, (y.header && ri === 0) || (y.firstColumn && ci === 0 && firstCol(y, ri)))) })))
      if (y.type === 'code') y.language = ''
      if (y.type === 'section') for (const k of ['headers', 'footers']) if (y[k]) y[k] = { default: blk(y[k].default, false), first: blk(y[k].first, false), even: blk(y[k].even, false) }
      if (y.type === 'table' && (y.style === 'zebra' || y.style === 'minimal')) delete y.border
      if (b.type === 'quote') {
        const out: Any[] = []
        let cur: Any[] = []
        const flush = () => {
          if (cur.length) out.push({ type: 'quote', blocks: cur })
          cur = []
        }
        const each = (qs: Any[], flat: boolean) => {
          for (const q of qs) {
            if (q.type === 'paragraph' && (!q.style || q.style === 'normal')) cur.push(...blk([q], inTable, strong))
            else if (q.type === 'columns') each(q.blocks, true)
            else if (q.type === 'quote') each(q.blocks, flat)
            else if (q.type === 'columnbreak' && flat) continue
            else {
              flush()
              out.push(...blk([q], inTable, strong))
            }
          }
        }
        each(b.blocks, false)
        flush()
        return out
      }
      if (y.type === 'columns') y.blocks = y.blocks.map((c: Any) => (c.type === 'pagebreak' ? { type: 'columnbreak' } : c))
      if (y.type === 'image') {
        y.caption = inl(y.caption, inTable, strong)
        const uri = y.src.startsWith('asset:') ? doc.assets[y.src.slice(6)] : null
        if (!uri) {
          return [
            { type: 'paragraph', content: [{ text: `[${y.alt || (y.src.startsWith('http') ? y.src : '') || 'image'}]`, italic: true }], ...(y.align !== 'left' ? { align: y.align } : {}) },
            ...(y.caption.length ? [{ type: 'paragraph', content: y.caption, style: 'caption' }] : []),
          ]
        }
        y.src = `asset:${uri.length}:${uri.slice(-24)}`
        y.width = inTable ? 0 : Math.round(Math.min(y.width, textWidth))
        if (inTable) delete y.height
      }
      return [y]
    }
  }
  const blocks0 = blk(doc.blocks, false)
  let blocks = blocks0
  const page = { ...doc.page }
  const s0 = blocks[0]?.type === 'section' ? blocks[0] : null
  if (s0) {
    blocks = blocks.slice(1)
    if (s0.numberStart !== undefined) page.numberStart = s0.numberStart
    if (s0.numberFormat) page.numberFormat = s0.numberFormat
    if (s0.firstPage !== undefined) page.firstPage = s0.firstPage
  }
  const set = (h: FolioDoc['headers']) => ({ default: blk(h.default, false), first: blk(h.first, false), even: blk(h.even, false) })
  const headers = s0?.headers ?? set(doc.headers)
  const footers = s0?.footers ?? set(doc.footers)
  // « Première page différente » répété d'une section à l'autre : sans effet.
  let title = page.firstPage
  for (const b of blocks) {
    if (b.type !== 'section') continue
    if (b.firstPage === title) delete b.firstPage
    else if (b.firstPage !== undefined) title = b.firstPage
  }
  // Un paragraphe vide après un saut de section final ne se distingue pas de l'absence de paragraphe.
  const last = blocks[blocks.length - 1]
  if (blocks.length > 1 && blocks[blocks.length - 2].type === 'section' && last.type === 'paragraph' && !last.content.length && Object.keys(last).length === 2) blocks = blocks.slice(0, -1)
  // Un commentaire couvre tout ce qui se trouve entre son premier et son dernier passage.
  const all: Any[] = []
  const holders: [Any, string][] = []
  const walk = (bs: Any[]) => {
    for (const b of bs) {
      if (b.type === 'paragraph' || b.type === 'heading') {
        all.push(...b.content)
        holders.push([b, 'content'])
      } else if (b.type === 'list') {
        for (const it of b.items) {
          all.push(...it.content)
          holders.push([it, 'content'])
        }
      } else if (b.type === 'quote' || b.type === 'columns') walk(b.blocks)
      else if (b.type === 'table') for (const r of b.rows) for (const c of r) walk(c.blocks)
      else if (b.type === 'image') {
        all.push(...b.caption)
        holders.push([b, 'caption'])
      }
    }
  }
  walk(blocks)
  const span = new Map<string, [number, number]>()
  all.forEach((x, i) => {
    for (const id of x.comments ?? []) span.set(id, [span.get(id)?.[0] ?? i, i])
  })
  for (const [id, [a, b]] of span) for (let i = a; i <= b; i++) if (all[i].type !== 'note') all[i].comments = [...new Set([...(all[i].comments ?? []), id])].sort()
  for (const [h, k] of holders) h[k] = mergeRuns(h[k])
  return {
    blocks,
    comments: doc.comments.map((c, i) => ({ ...c, id: `k${i}`, date: c.date || NOW, replies: c.replies.map((r) => ({ ...r, date: r.date || NOW })) })),
    headers,
    footers,
    notes: doc.notes,
    page,
    styles: doc.styles,
    theme: doc.theme,
    trackChanges: doc.trackChanges,
    meta: { ...doc.meta, created: '', modified: '' },
  }
}
