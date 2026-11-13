// Statistiques : mots, caractères, paragraphes (document ou sélection).

import type { Node as PMNode } from 'prosemirror-model'

export interface Stats {
  words: number
  chars: number
  charsNoSpaces: number
  paragraphs: number
}

type Segmenter = { segment(s: string): Iterable<{ isWordLike?: boolean }> }

let segmenter: Segmenter | null | undefined

/** Découpage en mots de la langue (Intl.Segmenter), sinon par espaces et ponctuation. */
export function countWords(text: string, locale?: string): number {
  if (!text.trim()) return 0
  if (segmenter === undefined) {
    const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => Segmenter }).Segmenter
    segmenter = Seg ? new Seg(locale, { granularity: 'word' }) : null
  }
  if (segmenter) {
    let n = 0
    for (const s of segmenter.segment(text)) if (s.isWordLike) n++
    return n
  }
  return (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length
}

/** Statistiques d'une portion du document (tout le document par défaut). */
export function stats(doc: PMNode, from = 0, to = doc.content.size): Stats {
  let words = 0
  let chars = 0
  let charsNoSpaces = 0
  let paragraphs = 0
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    const start = Math.max(from, pos + 1)
    const end = Math.min(to, pos + 1 + node.content.size)
    const text = node.textBetween(start - pos - 1, end - pos - 1, '\n', '￼').replace(/￼/g, '')
    if (text.trim()) paragraphs++
    words += countWords(text)
    chars += [...text].length
    charsNoSpaces += [...text.replace(/\s/g, '')].length
    return false
  })
  return { words, chars, charsNoSpaces, paragraphs }
}
