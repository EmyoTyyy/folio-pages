#!/usr/bin/env node
// Crée la paire de clés qui signe les mises à jour (ECDSA P-256).
//   node scripts/keygen.mjs
// La clé privée va dans ~/.folio-pages/release-key.json (lisible par vous seul),
// JAMAIS dans le dépôt. La clé publique s'affiche : elle va dans src/update.ts.
// Perdre la clé privée, c'est ne plus pouvoir publier de mise à jour acceptée
// par les fichiers déjà distribués : gardez-en une copie hors ligne.

import { webcrypto } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dir = join(homedir(), '.folio-pages')
const file = join(dir, 'release-key.json')
if (existsSync(file) && !process.argv.includes('--force')) {
  console.error(`Une clé existe déjà : ${file} (--force pour la remplacer, ce qui orpheline les fichiers déjà distribués).`)
  process.exit(1)
}
const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const priv = await webcrypto.subtle.exportKey('jwk', pair.privateKey)
const pub = await webcrypto.subtle.exportKey('jwk', pair.publicKey)
mkdirSync(dir, { recursive: true, mode: 0o700 })
writeFileSync(file, JSON.stringify({ private: priv, public: pub }, null, 2), { mode: 0o600 })
console.log(`Clé privée écrite : ${file}`)
console.log('Clé publique (pour src/update.ts) :')
console.log(JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }))
