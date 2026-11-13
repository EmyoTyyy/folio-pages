// Contrat d'exécution : window.folio (CLAUDE.md, section 3).
//
//   { doc, serialize(), loadDoc(json), schema(), i18n }   l'application tourne ;
//   { locked: true }                                     écran de mot de passe (phase 7) ;
//   { refused: true, reason }                            l'application a affiché son propre refus.
//
// Le chargeur considère l'application démarrée dès que l'un de ces objets est publié.

import type { FolioApp } from './app'
import { toCompact } from './format/compact'
import type { Issue } from './format/dsl'
import { buildSchema } from './format/schema'
import type { FolioDoc } from './format/types'
import { availableLanguages, lang, setLang, t } from './i18n/i18n'
import type { Key } from './i18n/dict'

export type LoadDocResult =
  | { ok: true; ignored: number; warnings: number; issues: Issue[] }
  | { ok: false; reason: string; line?: number; column?: number; error?: string }

export interface FolioApi {
  readonly doc: FolioDoc
  readonly version: string
  serialize(): string
  loadDoc(json: unknown): LoadDocResult
  schema(): Record<string, unknown>
  compact(): Record<string, unknown>
  readonly dirty: boolean
  save(): Promise<string | null>
  i18n: { readonly lang: string; languages: readonly string[]; setLang(l: string): void; t(key: string, params?: Record<string, string | number>): string }
  loader?: unknown
}

declare global {
  interface Window {
    folio?: FolioApi | { locked: true } | { refused: true; reason: string }
  }
}

export function publishApi(app: FolioApp): FolioApi {
  const api: FolioApi = {
    get doc() {
      return app.getDoc()
    },
    version: __FOLIO_VERSION__,
    serialize: () => app.serialize(),
    loadDoc: (json) => {
      const res = app.loadInto(json)
      if (res.ok) return { ok: true, ignored: res.report.ignored, warnings: res.report.warnings, issues: res.report.issues }
      if (res.reason === 'json') return { ok: false, reason: 'json', line: res.error.line, column: res.error.column, error: res.error.code }
      return { ok: false, reason: res.reason }
    },
    schema: () => buildSchema(),
    compact: () => toCompact(app.getDoc()),
    get dirty() {
      return app.dirty
    },
    save: async () => (await app.save())?.kind ?? null,
    i18n: {
      get lang() {
        return lang()
      },
      get languages() {
        return availableLanguages().map((l) => l.code)
      },
      setLang,
      t: (key, params) => t(key as Key, params),
    },
  }
  const loader = (window.folio as { loader?: unknown } | undefined)?.loader
  if (loader) api.loader = loader
  window.folio = api
  return api
}

export function publishRefusal(reason: string): void {
  window.folio = { refused: true, reason }
}

/** Écran de mot de passe : l'application attend le déchiffrement. */
export function publishLocked(): void {
  window.folio = { locked: true }
}
