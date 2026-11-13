// Écrit le JSON Schema du format dans docs/schema/ (servi par le site).
// Lancé par `npm run schema` ; un test vérifie que le fichier publié est à jour.

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildSchema } from '../src/format/schema'
import { FORMAT_VERSION } from '../src/format/types'

const out = new URL(`../docs/schema/folio-${FORMAT_VERSION}.json`, import.meta.url)
mkdirSync(new URL('.', out), { recursive: true })
writeFileSync(out, JSON.stringify(buildSchema(), null, 2) + '\n')
console.log('schéma écrit :', fileURLToPath(out))
