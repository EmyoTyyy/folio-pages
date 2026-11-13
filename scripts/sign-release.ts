// Signe le manifeste de la version publiée (docs/release.json).
//   npm run release        (construit, puis signe)
// La clé privée est lue dans ~/.folio-pages/release-key.json (scripts/keygen.mjs),
// jamais dans le dépôt. Le manifeste donne la version, l'empreinte SHA-256 du
// fichier publié (docs/folio-pages.html) et ses notes ; les fichiers déjà
// distribués le vérifient avec la clé publique de src/update.ts.

import { webcrypto } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RELEASE_NOTES } from '../src/release-notes'

const root = fileURLToPath(new URL('..', import.meta.url))
const version: string = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const keyFile = process.env.FOLIO_RELEASE_KEY ?? join(homedir(), '.folio-pages', 'release-key.json')
const key = JSON.parse(readFileSync(keyFile, 'utf8')) as { private: JsonWebKey; public: JsonWebKey }

const published = readFileSync(join(root, 'docs', 'folio-pages.html'))
const sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', published)).toString('hex')
const notes = RELEASE_NOTES[version] ?? { fr: [], en: [] }
const payload = JSON.stringify({ app: 'folio-pages', version, sha256, url: 'https://emyotyyy.github.io/folio-pages/folio-pages.html', notes, at: new Date().toISOString() })

// La clé publique du fichier doit être celle de cette clé privée : sinon, personne ne pourrait mettre à jour.
const embedded = readFileSync(join(root, 'src', 'update.ts'), 'utf8')
if (!embedded.includes(String(key.public.x)) || !embedded.includes(String(key.public.y))) {
  console.error('La clé publique de src/update.ts ne correspond pas à cette clé privée : rien n’est signé.')
  process.exit(1)
}

const priv = await webcrypto.subtle.importKey('jwk', key.private, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
const sig = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode(payload))).toString('base64')
writeFileSync(join(root, 'docs', 'release.json'), JSON.stringify({ payload, sig }, null, 2) + '\n')
console.log(`docs/release.json signé : version ${version}, sha256 ${sha256.slice(0, 16)}…`)
