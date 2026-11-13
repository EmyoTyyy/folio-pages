// Le fichier qui se réécrit lui-même (principe repris de Bento, MIT).
//
// Au démarrage, avant que l'application ne touche au DOM, on clone le document
// tel qu'il a été lu. À l'enregistrement, on remplace dans ce clone le contenu
// du bloc #folio-doc, puis on le sérialise : la même application, avec le
// nouveau document à l'intérieur.

export const DOC_BLOCK_ID = 'folio-doc'
export const DOC_BLOCK_TYPE = 'application/folio+json'
// Coupé en deux pour que la séquence n'apparaisse jamais telle quelle dans le code.
const SCRIPT_CLOSE = '</scr' + 'ipt>'

/**
 * Ce que l'application ajoute au DOM au démarrage et qui ne doit JAMAIS être
 * écrit dans le fichier : la feuille de style et le script décompressés par le
 * chargeur (ils sont déjà dans le fichier, compressés), et en développement les
 * styles injectés par Vite.
 */
const TRANSIENT = '[data-folio-transient], style[data-vite-dev-id], script[src^="/@vite/"]'

let pristine: Document | null = null

/** À appeler en tout premier, avant toute modification du DOM. */
export function capturePristine(): void {
  pristine = document.cloneNode(true) as Document
}

export const hasPristine = () => pristine !== null

/** Texte du bloc #folio-doc de la page ouverte : '' s'il est vide, null s'il n'existe pas. */
export function readDocBlock(): string | null {
  const el = document.getElementById(DOC_BLOCK_ID)
  if (!el) return null
  return (el.textContent ?? '').replace(/\r\n/g, '\n').trim()
}

/** Le JSON ne peut jamais fermer la balise qui le contient. */
const escapeLt = (json: string) => json.replace(/</g, '\\u003c')

/**
 * Blocs de données en plus du document (paquets de langue intégrés) : écrits
 * dans le fichier à chaque enregistrement, jamais exécutés (type JSON).
 */
const extraBlocks = new Map<string, { type: string; json: string | null }>()

export function setExtraBlock(id: string, type: string, json: string | null): void {
  extraBlocks.set(id, { type, json })
}

/** Le fichier complet, avec `json` comme document et `title` comme titre. */
export function serializeShell(json: string, title: string): string {
  if (!pristine) throw new Error('capturePristine() n’a pas été appelé')
  const clone = pristine.cloneNode(true) as Document
  for (const el of Array.from(clone.querySelectorAll(TRANSIENT))) el.remove()
  for (const [id, b] of extraBlocks) {
    clone.getElementById(id)?.remove()
    if (b.json === null) continue
    const el = clone.createElement('script')
    el.setAttribute('type', b.type)
    el.id = id
    el.textContent = escapeLt(b.json)
    clone.head.appendChild(el)
  }

  let block = clone.getElementById(DOC_BLOCK_ID)
  if (!block) {
    block = clone.createElement('script')
    block.setAttribute('type', DOC_BLOCK_TYPE)
    block.id = DOC_BLOCK_ID
    clone.head.appendChild(block)
  }
  block.textContent = '\n' + escapeLt(json) + '\n'

  const titleEl = clone.querySelector('title')
  if (titleEl) titleEl.textContent = title

  const html = '<!DOCTYPE html>\n' + clone.documentElement.outerHTML
  // Contrôle de sûreté : autant de fermetures de script que de scripts.
  let count = 0
  for (let at = html.indexOf(SCRIPT_CLOSE); at >= 0; at = html.indexOf(SCRIPT_CLOSE, at + 1)) count++
  if (count !== clone.querySelectorAll('script').length) throw new Error('fichier incohérent : balise script inattendue')
  return html
}

// --- au niveau du texte (sans DOM) -------------------------------------------

const BLOCK_ATTR = ` id="${DOC_BLOCK_ID}"`

/** La position `at` est-elle à l'intérieur d'un commentaire HTML ? */
function inComment(html: string, at: number): boolean {
  const open = html.lastIndexOf('<!--', at)
  return open >= 0 && html.indexOf('-->', open + 4) > at
}

/**
 * Position du contenu du bloc dans un texte HTML, ou null. Seule une vraie
 * balise <script> compte : une mention dans un commentaire est ignorée.
 */
function locateBlock(html: string): { start: number; end: number } | null {
  for (let at = html.indexOf(BLOCK_ATTR); at >= 0; at = html.indexOf(BLOCK_ATTR, at + 1)) {
    if (inComment(html, at)) continue
    const open = html.lastIndexOf('<script', at)
    if (open < 0 || html.lastIndexOf('>', at) > open) continue // l'attribut n'est pas dans cette balise
    const start = html.indexOf('>', at + BLOCK_ATTR.length)
    if (start < 0) return null
    const end = html.indexOf(SCRIPT_CLOSE, start + 1)
    if (end < 0) return null
    return { start: start + 1, end }
  }
  return null
}

/** Contenu du bloc #folio-doc d'un fichier : '' si vide, null s'il n'y en a pas. */
export function extractDocBlock(html: string): string | null {
  const loc = locateBlock(html)
  if (!loc) return null
  return html.slice(loc.start, loc.end).replace(/\r\n/g, '\n').trim()
}

/** Remplace le document d'un fichier par `json` (ce que fait une IA, à la main). */
export function spliceDocBlock(html: string, json: string): string | null {
  const loc = locateBlock(html)
  if (!loc) return null
  return html.slice(0, loc.start) + '\n' + escapeLt(json) + '\n' + html.slice(loc.end)
}

export type FileKind = 'document' | 'blank-app' | 'encrypted' | 'foreign'

/** Que contient ce fichier ? (document, application vide, document chiffré, autre chose) */
export function recognizeHtml(html: string): FileKind {
  const block = extractDocBlock(html)
  if (block === null) return 'foreign'
  if (!/<meta\s+name="generator"\s+content="folio-pages/i.test(html)) return 'foreign'
  if (block === '') return 'blank-app'
  if (/^\{\s*"format"\s*:\s*"folio\/enc"/.test(block)) return 'encrypted'
  return 'document'
}
