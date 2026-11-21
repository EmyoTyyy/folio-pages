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

// --- lisibilité ----------------------------------------------------------------------

/** Au-delà de ce nombre de mots, une phrase est dite longue. */
export const LONG_SENTENCE = 25

/** Mots par minute : lecture silencieuse et parole (estimations courantes). */
export const READING_WPM = 230
export const SPEAKING_WPM = 130

export interface Sentence {
  /** Décalages dans le texte du paragraphe. */
  from: number
  to: number
  words: number
}

type SentenceSegmenter = { segment(s: string): Iterable<{ segment: string; index: number }> }
let sentenceSeg: SentenceSegmenter | null | undefined

/** Phrases d'un texte (Intl.Segmenter, sinon ponctuation finale) avec leur nombre de mots. */
export function sentences(text: string, locale?: string): Sentence[] {
  if (sentenceSeg === undefined) {
    const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => SentenceSegmenter }).Segmenter
    sentenceSeg = Seg ? new Seg(locale, { granularity: 'sentence' }) : null
  }
  const out: Sentence[] = []
  const push = (from: number, raw: string) => {
    const trimmed = raw.replace(/\s+$/u, '')
    const lead = raw.length - raw.trimStart().length
    const words = countWords(trimmed, locale)
    if (words > 0) out.push({ from: from + lead, to: from + trimmed.length, words })
  }
  if (sentenceSeg) for (const s of sentenceSeg.segment(text)) push(s.index, s.segment)
  else {
    const re = /[^.!?…]+(?:[.!?…]+["»”’)\]]*|$)\s*/gu
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) && m[0]) push(m.index, m[0])
  }
  return out
}

/** Syllabes d'un mot, par groupes de voyelles (approximation pour les indices de lisibilité). */
export function syllables(word: string, lang = 'en'): number {
  const w = word.toLowerCase().replace(/[^a-zà-ÿœæ]/g, '')
  if (!w) return 0
  let n = (w.match(/[aeiouyàâäéèêëîïôöùûüÿœæ]+/g) ?? []).length
  if (/^fr/i.test(lang)) {
    // e muet final (« table », « tables », « parlent »).
    if (w.length > 3 && /[^aeiouy](e|es|ent)$/.test(w)) n--
  } else if (w.length > 3 && /[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w)) n--
  return Math.max(1, n)
}

export interface Readability {
  sentences: number
  /** Mots par phrase, en moyenne. */
  avgSentence: number
  longSentences: number
  /** Indice de Flesch (anglais) ou de Kandel et Moles (français), de 0 à 100 ; null si trop peu de texte. */
  score: number | null
  /** Minutes de lecture et de parole. */
  readMinutes: number
  speakMinutes: number
}

/** Texte de chaque paragraphe du document (ou d'une portion). */
function blockTexts(doc: PMNode, from = 0, to = doc.content.size): string[] {
  const out: string[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.name === 'code_block') return false
    const start = Math.max(from, pos + 1)
    const end = Math.min(to, pos + 1 + node.content.size)
    out.push(node.textBetween(start - pos - 1, end - pos - 1, '\n', ' '))
    return false
  })
  return out
}

export function readability(doc: PMNode, lang = 'en', from = 0, to = doc.content.size): Readability {
  let count = 0
  let words = 0
  let longs = 0
  let syl = 0
  for (const text of blockTexts(doc, from, to)) {
    for (const s of sentences(text, lang || undefined)) {
      count++
      words += s.words
      if (s.words > LONG_SENTENCE) longs++
    }
    for (const w of text.match(/[\p{L}]+(?:['’-][\p{L}]+)*/gu) ?? []) syl += syllables(w, lang)
  }
  const fr = /^fr/i.test(lang)
  let score: number | null = null
  if (words >= 30 && count > 0) {
    const raw = fr ? 207 - 1.015 * (words / count) - 73.6 * (syl / words) : 206.835 - 1.015 * (words / count) - 84.6 * (syl / words)
    score = Math.round(Math.max(0, Math.min(100, raw)))
  }
  return {
    sentences: count,
    avgSentence: count ? Math.round((words / count) * 10) / 10 : 0,
    longSentences: longs,
    score,
    readMinutes: words / READING_WPM,
    speakMinutes: words / SPEAKING_WPM,
  }
}

/** Phrases longues du document : positions (pour les surligner). */
export function longSentenceRanges(doc: PMNode, lang = 'en'): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.name === 'code_block') return false
    // Une position par caractère : les objets en ligne comptent pour un.
    let text = ''
    node.forEach((child) => (text += child.isText ? child.text : child.type.name === 'hard_break' ? '\n' : ' '))
    for (const s of sentences(text, lang || undefined)) if (s.words > LONG_SENTENCE) out.push({ from: pos + 1 + s.from, to: pos + 1 + s.to })
    return false
  })
  return out
}
