// Ouverture d'un document : texte JSON (ou objet) → document canonique + rapport.
//
// Jamais d'exception pour une donnée invalide : soit un document (avec la liste
// de ce qui a été ignoré ou corrigé), soit une raison claire de refus.

import { check, DROP, isPlainObject, Report, type Ctx } from './dsl'
import { locateJsonError, repairJson, type JsonError } from './json'
import { normalizeDoc } from './normalize'
import { DEFS, LIMITS, VALIDATION_LIMITS } from './spec'
import type { Block, FolioDoc, NoteInline } from './types'

export type LoadResult =
  | { ok: true; doc: FolioDoc; report: Report; repaired: boolean }
  | { ok: false; reason: 'json'; error: JsonError }
  | { ok: false; reason: 'encrypted' }
  | { ok: false; reason: 'too-large'; size: number }
  | { ok: false; reason: 'not-a-document' }

export interface LoadOptions {
  /** Date de création à utiliser si le document n'en a pas (ISO 8601). */
  now?: string
  /**
   * Ressources déjà connues (images et polices du document ouvert) : une IA
   * renvoie les « asset:… » sans leurs données, on les reprend ici.
   */
  assets?: Record<string, string>
}

/** Enveloppe de document chiffré (format repris de Bento, phase 7). */
export const isEncryptedEnvelope = (v: unknown): boolean =>
  isPlainObject(v) && v.format === 'folio/enc'

export function parseJsonText(text: string): { ok: true; value: unknown; repaired: boolean } | { ok: false; error: JsonError } {
  const src = text.replace(/^﻿/, '').trim()
  try {
    return { ok: true, value: JSON.parse(src), repaired: false }
  } catch {
    const fixed = repairJson(src)
    if (fixed !== null) {
      try {
        return { ok: true, value: JSON.parse(fixed), repaired: true }
      } catch {
        /* l'erreur est localisée sur le texte d'origine */
      }
    }
    const error = locateJsonError(src) ?? { code: 'unexpected-char' as const, offset: 0, line: 1, column: 1 }
    return { ok: false, error }
  }
}

export function loadDocument(input: unknown, opts: LoadOptions = {}): LoadResult {
  const now = opts.now ?? new Date().toISOString()
  let value = input
  let repaired = false
  if (typeof input === 'string') {
    if (input.length > LIMITS.jsonChars) return { ok: false, reason: 'too-large', size: input.length }
    const parsed = parseJsonText(input)
    if (!parsed.ok) return { ok: false, reason: 'json', error: parsed.error }
    value = parsed.value
    repaired = parsed.repaired
  }

  const report = new Report()
  if (repaired) report.warn('', 'json-repaired')

  // Tolérance : une liste de blocs seule, ou un texte Markdown seul.
  if (Array.isArray(value)) {
    report.warn('', 'coerced', 'blocks')
    value = { blocks: value }
  } else if (typeof value === 'string') {
    report.warn('', 'coerced', 'markdown')
    value = { markdown: value }
  }
  if (!isPlainObject(value)) return { ok: false, reason: 'not-a-document' }
  if (isEncryptedEnvelope(value)) return { ok: false, reason: 'encrypted' }

  const ctx: Ctx = { report, defs: DEFS, limits: VALIDATION_LIMITS, depth: 0, nodes: 0, tooLarge: false }
  const checked = check(DEFS.Document, value, '', ctx)
  if (checked === DROP) return { ok: false, reason: 'not-a-document' }
  const doc = normalizeDoc(checked as Record<string, unknown>, report, now, opts.assets)
  return { ok: true, doc, report, repaired }
}

/**
 * Contenu d'une note venu d'ailleurs (collage) : vérifié et borné comme dans un
 * document. Contenu illisible : un paragraphe avec le texte de repli.
 */
export function loadNoteBlocks(raw: unknown, fallback = ''): Block[] {
  const r = loadDocument({ blocks: [{ type: 'paragraph', content: [{ type: 'note', blocks: Array.isArray(raw) ? raw : [] }] }] })
  const p = r.ok ? r.doc.blocks[0] : null
  const note = p && p.type === 'paragraph' ? (p.content.find((x) => 'type' in x && x.type === 'note') as NoteInline | undefined) : undefined
  const blocks = note?.blocks ?? []
  const empty = !blocks.length || (blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].content.length)
  return empty && fallback.trim() ? [{ type: 'paragraph', content: [{ text: fallback.trim() }] }] : blocks.length ? blocks : [{ type: 'paragraph', content: [] }]
}
