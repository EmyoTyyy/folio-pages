// Ouverture d'un document : texte JSON (ou objet) → document canonique + rapport.
//
// Jamais d'exception pour une donnée invalide : soit un document (avec la liste
// de ce qui a été ignoré ou corrigé), soit une raison claire de refus.

import { check, DROP, isPlainObject, Report, type Ctx } from './dsl'
import { locateJsonError, repairJson, type JsonError } from './json'
import { ensureKeys } from './documents'
import { buildTree, treeJson, type TreeIssue, type TreeItem } from './tree'
import { normalizeDoc } from './normalize'
import { DEFS, LIMITS, VALIDATION_LIMITS } from './spec'
import type { Block, FolioDoc, NoteInline, ShapeInline } from './types'

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
  // Plusieurs documents : chacun se vérifie et se complète à part ; un seul niveau.
  const raw = checked as Record<string, unknown>
  const more = Array.isArray(raw.documents) ? (raw.documents as unknown[]) : []
  const tree = Array.isArray(raw.tree) ? (raw.tree as TreeItem[]) : undefined
  delete raw.documents
  delete raw.tree
  const doc = normalizeDoc(raw, report, now, opts.assets)
  if (more.length) {
    const subs: FolioDoc[] = []
    more.forEach((d, i) => {
      if (!isPlainObject(d)) return
      if (Array.isArray(d.documents) && d.documents.length) report.ignore(`documents[${i}].documents`, 'invalid-value', 'documents')
      if (Array.isArray(d.tree)) report.ignore(`documents[${i}].tree`, 'invalid-value', 'tree')
      delete d.documents
      delete d.tree
      // Le format est celui du fichier : pas d'avertissement s'il n'est pas répété.
      d.format ??= raw.format
      d.version ??= raw.version
      subs.push({ ...normalizeDoc(d, report, now, opts.assets), id: doc.id, template: false, readOnly: false })
    })
    if (subs.length) {
      doc.documents = subs
      const all = [doc, ...subs]
      for (const k of ensureKeys(all)) report.warn('documents', 'invalid-value', `key ${k}`)
    }
  }
  // Les dossiers : rangés d'après les clés connues (inconnues ou répétées : ignorées).
  if (tree?.length) {
    if (!doc.key) ensureKeys([doc])
    const issues: TreeIssue[] = []
    const nodes = buildTree(tree, [doc, ...(doc.documents ?? [])].map((d) => d.key!), issues)
    for (const x of issues) report.ignore(x.path, x.what === 'unknown-key' || x.what === 'duplicate-key' ? 'invalid-value' : 'too-deep', x.detail)
    const json = treeJson(nodes)
    if (json) doc.tree = json
  }
  return { ok: true, doc, report, repaired }
}

/**
 * Contenu d'une note venu d'ailleurs (collage) : vérifié et borné comme dans un
 * document. Contenu illisible : un paragraphe avec le texte de repli.
 */
/** Une forme venue d'ailleurs (collage) : vérifiée comme dans un fichier ; null si elle n'est pas valable. */
export function loadShape(raw: unknown): ShapeInline | null {
  if (!raw || typeof raw !== 'object') return null
  const r = loadDocument({ blocks: [{ type: 'paragraph', content: [{ ...(raw as Record<string, unknown>), type: 'shape' }] }] })
  const p = r.ok ? r.doc.blocks[0] : null
  const sh = p && p.type === 'paragraph' ? ((p.content.find((x) => 'type' in x && x.type === 'shape') as ShapeInline | undefined) ?? null) : null
  if (!sh || !r.ok) return sh
  // Les images libres gardent leur URI data: (l'éditeur n'a pas de table des ressources).
  const assets = r.doc.assets
  const keep = (d: ShapeInline): ShapeInline => {
    if (d.children) d.children = d.children.map(keep)
    if (d.src?.startsWith('asset:') && Object.prototype.hasOwnProperty.call(assets, d.src.slice(6))) d.src = assets[d.src.slice(6)]
    return d
  }
  return keep(sh)
}

export function loadNoteBlocks(raw: unknown, fallback = ''): Block[] {
  const r = loadDocument({ blocks: [{ type: 'paragraph', content: [{ type: 'note', blocks: Array.isArray(raw) ? raw : [] }] }] })
  const p = r.ok ? r.doc.blocks[0] : null
  const note = p && p.type === 'paragraph' ? (p.content.find((x) => 'type' in x && x.type === 'note') as NoteInline | undefined) : undefined
  const blocks = note?.blocks ?? []
  const empty = !blocks.length || (blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].content.length)
  return empty && fallback.trim() ? [{ type: 'paragraph', content: [{ text: fallback.trim() }] }] : blocks.length ? blocks : [{ type: 'paragraph', content: [] }]
}
