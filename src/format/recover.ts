// Récupération du texte d'un bloc #folio-doc illisible.
//
// Quand le JSON est cassé (fichier tronqué, édition à la main, IA maladroite),
// on ne doit jamais perdre le texte. On relit donc les chaînes du JSON une à
// une, avec tolérance, et on garde celles qui ressemblent à du contenu. Si le
// bloc n'est pas du JSON du tout, on garde son texte tel quel, par paragraphes.

import { parseMarkdown } from './markdown'
import { plainRuns } from './runs'
import type { Block } from './types'

/** Clés dont les valeurs sont du contenu à garder. */
const CONTENT_KEYS = new Set(['text', 'md', 'markdown', 'title', 'subject', 'author'])
/** Clés structurelles : leurs valeurs ne sont jamais du contenu. */
const STRUCTURAL_KEYS = new Set([
  'type',
  'style',
  'format',
  'version',
  'id',
  'language',
  'lang',
  'link',
  'created',
  'modified',
  '$schema',
  'src',
  'font',
  'family',
  'color',
  'highlight',
  'bg',
  'align',
  'wrap',
  'flip',
  'name',
  'numbering',
  'bullet',
  'valign',
  'border',
  'shading',
  'basedOn',
  'next',
])

const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }

function decode(body: string): string {
  return body.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e: string) =>
    e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : (ESCAPES[e] ?? e),
  )
}

export interface Recovered {
  title: string
  blocks: Block[]
  /** Nombre de paragraphes ou de blocs retrouvés. */
  count: number
}

export function recoverText(raw: string): Recovered {
  const blocks: Block[] = []
  let title = ''
  const strings = /"((?:[^"\\\n]|\\.)*)"/g
  let found = 0
  let lastKey = ''
  const next = /\s*(\S)/y
  let m: RegExpExecArray | null
  let end = 0
  const take = (value: string, isKey: boolean) => {
    if (isKey) {
      lastKey = value
      return
    }
    if (STRUCTURAL_KEYS.has(lastKey)) return
    // Les images et polices (URI data:) ne sont jamais du texte.
    if (value.startsWith('data:')) return
    const keep = CONTENT_KEYS.has(lastKey) || /\s/.test(value.trim()) || value.length > 24
    if (!keep || !value.trim()) return
    if (lastKey === 'title' && !title) {
      title = value.trim()
      return
    }
    if (lastKey === 'md' || lastKey === 'markdown') blocks.push(...parseMarkdown(value))
    else for (const part of value.split(/\n{2,}/)) if (part.trim()) blocks.push({ type: 'paragraph', content: plainRuns(part.trim()) })
  }
  while ((m = strings.exec(raw))) {
    found++
    end = strings.lastIndex
    next.lastIndex = strings.lastIndex
    const after = next.exec(raw)
    take(decode(m[1]), !!after && after[1] === ':')
  }
  // Fichier tronqué : la dernière chaîne n'a pas de guillemet fermant.
  const tail = /"((?:[^"\\\n]|\\.)*)\\?$/.exec(raw.slice(end))
  if (tail && tail[1].trim()) {
    found++
    take(decode(tail[1]), false)
  }
  if (!found) {
    // Pas de chaîne JSON du tout : du texte brut, découpé par lignes vides.
    for (const part of raw.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
      const t = part.trim()
      if (t) blocks.push({ type: 'paragraph', content: plainRuns(t) })
    }
  }
  return { title, blocks, count: blocks.length }
}
