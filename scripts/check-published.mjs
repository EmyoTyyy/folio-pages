#!/usr/bin/env node
// Vérifie que l'application publiée (docs/folio-pages.html, servie par le site)
// correspond aux sources : on compare les fichiers après décompression des
// charges utiles, pour ne pas dépendre de la version de zlib qui les a compressées.

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { decode } from './lib/b86.mjs'

const normalize = (html) =>
  html.replace(/(<script id="[\w-]+" type="folio\/deflate-b86" data-len="\d+") data-hash="\w+">([^<]*)<\/script>/g, (_m, open, body) => {
    const raw = inflateRawSync(Buffer.from(decode(body.trim())))
    return `${open}>${createHash('sha256').update(raw).digest('hex')}</script>`
  })

const [a, b] = ['dist/folio-pages.html', 'docs/folio-pages.html'].map((p) => normalize(readFileSync(p, 'utf8')))
if (a !== b) {
  console.error('docs/folio-pages.html n’est pas à jour : lancez `npm run build` et validez le résultat.')
  process.exit(1)
}
console.log('docs/folio-pages.html correspond aux sources.')
