// JSON Schema (draft 2020-12) du format, généré à partir des tables de
// validation (spec.ts). Exposé par window.folio.schema() et publié dans
// docs/schema/folio-1.json par `npm run schema`.

import { toJsonSchema } from './dsl'
import { DEFS } from './spec'
import { FORMAT_VERSION } from './types'

export const SCHEMA_ID = `https://emyotyyy.github.io/folio-pages/schema/folio-${FORMAT_VERSION}.json`

export function buildSchema(): Record<string, unknown> {
  const defs: Record<string, Record<string, unknown>> = {}
  const root = toJsonSchema(DEFS.Document, DEFS, defs)
  // Les définitions sont triées pour que le fichier publié soit stable.
  const sorted = Object.fromEntries(Object.keys(defs).sort().map((k) => [k, defs[k]]))
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: SCHEMA_ID,
    title: 'Folio Pages document',
    description:
      'The JSON inside the <script type="application/folio+json" id="folio-doc"> block of a Folio Pages file. ' +
      'Fields at their default value may be left out. Guide: https://emyotyyy.github.io/folio-pages/agents.md',
    ...root,
    $defs: sorted,
  }
}
