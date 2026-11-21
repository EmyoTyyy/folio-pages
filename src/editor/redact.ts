// Caviardage : des passages marqués (en attente, visibles en hachures), puis
// remplacés pour de bon par des pavés noirs (█), un caractère pour un. Les
// marques en attente ne sont pas enregistrées dans le fichier : ce sont des
// décorations, suivies au fil des modifications.

import { Plugin, PluginKey, type Command, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { findMatches, type FindQuery } from './find'
import { schema } from './schema'
import { TRACK_SKIP } from './track'

export const BLOCK = '█'

type Meta = { add?: { from: number; to: number }[]; remove?: { from: number; to: number }; clear?: true }

export const redactKey = new PluginKey<DecorationSet>('folio-redact')

const deco = (from: number, to: number) => Decoration.inline(from, to, { class: 'fp-redact' }, { redact: true })

export function redactPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: redactKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set) => {
        set = set.map(tr.mapping, tr.doc)
        const meta = tr.getMeta(redactKey) as Meta | undefined
        if (!meta) return set
        if (meta.clear) return DecorationSet.empty
        if (meta.remove) set = set.remove(set.find(meta.remove.from, meta.remove.to))
        if (meta.add?.length) {
          // Sans chevauchement : une plage déjà marquée n'est pas ajoutée deux fois.
          const fresh = meta.add.filter((r) => r.to > r.from && !set.find(r.from, r.to).some((d) => d.from <= r.from && d.to >= r.to))
          set = set.add(tr.doc, fresh.map((r) => deco(r.from, r.to)))
        }
        return set
      },
    },
    props: { decorations: (state) => redactKey.getState(state) },
  })
}

/** Plages en attente, fusionnées et triées. */
export function pendingRedactions(state: EditorState): { from: number; to: number }[] {
  const list = (redactKey.getState(state)?.find() ?? []).map((d) => ({ from: d.from, to: d.to })).sort((a, b) => a.from - b.from)
  const out: { from: number; to: number }[] = []
  for (const r of list) {
    const last = out[out.length - 1]
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to)
    else out.push({ ...r })
  }
  return out
}

export function markRedaction(ranges: { from: number; to: number }[]): Command {
  return (state, dispatch) => {
    const real = ranges.filter((r) => r.to > r.from && state.doc.textBetween(r.from, r.to, ' ', ' ').trim())
    if (!real.length) return false
    dispatch?.(state.tr.setMeta(redactKey, { add: real }).setMeta('addToHistory', false))
    return true
  }
}

/** Retire les marques qui touchent la sélection (ou toutes). */
export function unmarkRedaction(all = false): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection
    if (!pendingRedactions(state).length) return false
    dispatch?.(state.tr.setMeta(redactKey, all ? { clear: true } : { remove: { from: Math.max(0, from - 1), to: to + 1 } }).setMeta('addToHistory', false))
    return true
  }
}

/** Expressions toutes faites : courriels, téléphones, numéros (IBAN, carte, sécurité sociale…). */
export const REDACT_PRESETS = {
  email: '[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}.-]+\\.\\p{L}{2,}',
  // Pas collé à d'autres groupes de chiffres (un IBAN, une référence) ni avant ni après.
  phone: '(?<!\\p{L})(?<!\\d[\\s.-]?)(?:\\+\\d{1,3}[\\s.-]?)?(?:\\(?\\d{1,4}\\)?[\\s.-]?){2,5}\\d{2,4}(?![\\s.-]?\\d)',
  number: '\\b[A-Z]{2}\\d{2}(?:\\s?[A-Z0-9]{4}){2,7}(?:\\s?[A-Z0-9]{1,3})?\\b|\\b(?:\\d[\\s-]?){12,19}\\b',
} as const

/** Toutes les occurrences d'un texte (ou d'une expression) : plages à marquer. */
export function findForRedaction(state: EditorState, q: FindQuery): { from: number; to: number }[] {
  return findMatches(state.doc, q).matches.filter((m) => {
    // Un numéro de téléphone a de 8 à 15 chiffres (sinon une date, une année, un compte…).
    const text = state.doc.textBetween(m.from, m.to)
    const digits = (text.match(/\d/g) ?? []).length
    return q.text !== REDACT_PRESETS.phone || (digits >= 8 && digits <= 15)
  })
}

/**
 * Applique les caviardages : chaque position marquée devient un pavé noir (la
 * longueur est gardée, le texte, les objets et les liens disparaissent). Rend
 * le nombre de passages caviardés.
 */
export function applyRedactions(onDone?: (n: number) => void): Command {
  return (state, dispatch) => {
    const ranges = pendingRedactions(state)
    if (!ranges.length) return false
    if (dispatch) {
      const tr = state.tr
      // Par paragraphe, de la fin vers le début (les positions précédentes ne bougent pas).
      const parts: { from: number; to: number }[] = []
      for (const r of ranges) {
        state.doc.nodesBetween(r.from, r.to, (node, pos) => {
          if (!node.isTextblock) return true
          const a = Math.max(r.from, pos + 1)
          const b = Math.min(r.to, pos + 1 + node.content.size)
          if (b > a) parts.push({ from: a, to: b })
          return false
        })
      }
      const keep = new Set([schema.marks.bold, schema.marks.italic, schema.marks.font, schema.marks.size])
      for (const p of parts.sort((x, y) => y.from - x.from)) {
        const marks = state.doc.resolve(p.from).marksAcross(state.doc.resolve(p.to))?.filter((m) => keep.has(m.type)) ?? []
        tr.replaceWith(p.from, p.to, schema.text(BLOCK.repeat(p.to - p.from), marks))
      }
      tr.setMeta(redactKey, { clear: true })
      // Jamais suivi : une suppression suivie garderait le texte, visible et dans le fichier.
      tr.setMeta(TRACK_SKIP, true)
      dispatch(tr)
    }
    onDone?.(ranges.length)
    return true
  }
}
