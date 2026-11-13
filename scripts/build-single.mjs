#!/usr/bin/env node
// Assemble le fichier unique dist/folio-pages.html à partir du build Vite.
//
//   head → notices → guide pour les IA → #folio-doc (vide) → écran de chargement
//   → application compressée (DEFLATE + base86) → vérification du navigateur
//   → chargeur
//
// Principe et code du chargeur repris de Bento (MIT). Le fichier produit est
// vérifié ici même : charge utile décompressable et identique, aucune séquence
// interdite, bloc de document lisible par simple recherche de texte.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { transformSync } from 'esbuild'
import { decode, encode, FORBIDDEN, LOADER_DECODER } from './lib/b86.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const pkg = JSON.parse(read('package.json'))
const VERSION = pkg.version
// Cible : 1 Mo (CLAUDE.md). Dépassement accepté pour l’instant (avertissement), limite dure à 1,5 Mo.
const TARGET_BYTES = 1_000_000
const MAX_BYTES = 1_500_000

const fail = (msg) => {
  console.error('build-single : ' + msg)
  process.exit(1)
}

// --- application compilée ---------------------------------------------------
const js = read('build/app/app.js')
const css = read('build/app/app.css')

/** Empreinte FNV-1a 32 bits, recalculée par le chargeur pour détecter un fichier abîmé. */
function fnv1a(bytes) {
  let h = 0x811c9dc5
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

function pack(text, id) {
  const raw = Buffer.from(text, 'utf8')
  const packed = deflateRawSync(raw, { level: 9 })
  if (!inflateRawSync(packed).equals(raw)) fail(`la charge utile ${id} ne se décompresse pas à l'identique`)
  const b86 = encode(packed)
  if (!Buffer.from(decode(b86)).equals(packed)) fail(`la base86 de ${id} ne se relit pas à l'identique`)
  for (const f of FORBIDDEN) if (b86.includes(f)) fail(`la charge utile ${id} contient « ${f} »`)
  return {
    tag: `    <script id="${id}" type="folio/deflate-b86" data-len="${raw.length}" data-hash="${fnv1a(raw)}">${b86}</script>`,
    raw: raw.length,
    packed: b86.length,
  }
}

const cssPack = pack(css, 'folio-rt-css')
const jsPack = pack(js, 'folio-rt')
// Module .docx : décompressé seulement quand on importe ou exporte un .docx.
const docxPack = pack(read('build/docx/docx.js'), 'folio-rt-docx')

// --- chargeur -----------------------------------------------------------------
const inflaterSrc = read('scripts/lib/inflate-raw.js').replace(/^export function/m, 'function')
let inflater = transformSync(inflaterSrc + '\nwindow.__folioInflate = inflateRaw', { minify: true, target: 'es2017' }).code.trim()
inflater = `var inflateRaw = (function(){${inflater.replace('window.__folioInflate=', 'return ')}})();`
const loader = read('shell/loader.js').replace('/*INFLATER*/', inflater).replace('/*B86*/', LOADER_DECODER.trim())
const check = read('shell/check.js')

for (const [name, code] of [['chargeur', loader], ['vérification', check]]) {
  if (/<\/script|<!--/i.test(code)) fail(`le ${name} contient une séquence interdite`)
}

// --- texte du gabarit ---------------------------------------------------------
const notices = read('shell/notices.txt').replaceAll('{{VERSION}}', VERSION).trimEnd()
const guide = read('shell/guide.txt').replaceAll('{{VERSION}}', VERSION).trimEnd()
for (const [name, text] of [['notices', notices], ['guide', guide]]) {
  if (text.includes('--') || text.includes('<!')) fail(`le texte « ${name} » ne peut pas aller dans un commentaire HTML (-- ou <!)`)
  // Une recherche de texte (une IA, un outil) doit trouver le VRAI bloc en premier.
  if (/id="folio-doc"|<script/i.test(text)) fail(`le texte « ${name} » ne doit pas citer la balise du bloc de document`)
}

const MARK =
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect x='1' y='1' width='30' height='30' rx='7' fill='#1E5E4B'/>` +
  `<path d='M9.5 6H19l5 5v14a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 8 25V7.5A1.5 1.5 0 0 1 9.5 6z' fill='#F7F3EA'/>` +
  `<path d='M19 6v4a1 1 0 0 0 1 1h4z' fill='#C3D9CF'/><path d='M12 6h4v9.2l-2-1.7-2 1.7z' fill='#E8735A'/></svg>`
const icon = 'data:image/svg+xml,' + MARK.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')

const fill = (tpl, values) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in values)) fail(`gabarit : valeur manquante ${k}`)
    return values[k]
  })

const html = fill(read('shell/template.html'), {
  VERSION,
  ICON: icon,
  NOTICES: notices,
  GUIDE: guide,
  SPLASH_CSS: read('shell/splash.css').trimEnd(),
  SPLASH_HTML: read('shell/splash.html').trimEnd(),
  PAYLOADS: cssPack.tag + '\n' + jsPack.tag + '\n' + docxPack.tag,
  CHECK: check.trimEnd(),
  LOADER: loader.trimEnd(),
})

// --- vérifications du fichier produit ----------------------------------------
const outsideComments = html.replace(/<!--[\s\S]*?-->/g, '')
const opens = (outsideComments.match(/<script\b/g) ?? []).length
const closes = (outsideComments.match(/<\/script>/g) ?? []).length
if (opens !== closes) fail(`balises script déséquilibrées (${opens} ouvertures, ${closes} fermetures)`)
const docAt = html.indexOf('id="folio-doc"')
if (html.indexOf('folio-doc"') !== docAt + 4) fail('la première mention de folio-doc" doit être le bloc lui-même')
if (docAt < 0 || docAt > html.indexOf('type="folio/deflate-b86"')) fail('le bloc #folio-doc doit précéder le code de l’application')
if (!/<script type="application\/folio\+json" id="folio-doc"><\/script>/.test(html)) fail('le bloc #folio-doc doit être vide dans l’application vierge')
const bytes = Buffer.byteLength(html, 'utf8')
if (bytes > MAX_BYTES) fail(`fichier trop gros : ${bytes} octets (limite ${MAX_BYTES})`)
if (bytes > TARGET_BYTES) console.warn(`build-single : attention, ${bytes} octets (cible ${TARGET_BYTES})`)

const out = join(root, 'dist/folio-pages.html')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html)
mkdirSync(join(root, 'docs'), { recursive: true })
copyFileSync(out, join(root, 'docs/folio-pages.html'))
// Le site affiche le poids du fichier : il suit chaque build.
const site = join(root, 'docs/index.html')
const page = readFileSync(site, 'utf8')
const sized = page.replace(/(<span data-app-size>)[^<]*(<\/span>)/g, `$1${Math.round(bytes / 1024)}$2`)
if (sized !== page) writeFileSync(site, sized)

const kb = (n) => (n / 1024).toFixed(1) + ' Ko'
console.log(`dist/folio-pages.html : ${kb(bytes)} (application ${kb(jsPack.raw)} → ${kb(jsPack.packed)}, styles ${kb(cssPack.raw)} → ${kb(cssPack.packed)}, module .docx ${kb(docxPack.raw)} → ${kb(docxPack.packed)})`)
console.log('copie : docs/folio-pages.html')
