// Sens d'écriture : détection du premier caractère fort (règle P2 de l'algorithme bidirectionnel Unicode, simplifiée).
// Le paragraphe sans sens imposé suit son texte, comme dir="auto" dans l'éditeur.

/** Écritures de droite à gauche : hébreu, arabe, syriaque, thâna, n’ko, samaritain, mandéen, et leurs formes de présentation. */
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u
const STRONG = /[\p{L}\p{M}]/u

/** Le sens du premier caractère fort du texte, ou null s'il n'y en a pas (chiffres, ponctuation…). */
export function firstStrong(text: string): 'rtl' | 'ltr' | null {
  for (const ch of text) {
    if (RTL.test(ch)) return 'rtl'
    if (STRONG.test(ch)) return 'ltr'
  }
  return null
}

/** Le texte contient-il une écriture de droite à gauche ? */
export function hasRtl(text: string): boolean {
  return RTL.test(text)
}

/** Texte brut des éléments en ligne (assez pour trouver le sens). */
function textOf(items: readonly unknown[] | undefined): string {
  let out = ''
  for (const x of items ?? []) {
    const t = (x as { text?: unknown } | null)?.text
    if (typeof t === 'string') out += t
    if (out.length > 400) break
  }
  return out
}

/** Sens effectif d'un paragraphe : celui qui est imposé, sinon celui de son texte. */
export function blockDir(b: { dir?: unknown; content?: readonly unknown[] }): 'rtl' | 'ltr' {
  return b.dir === 'rtl' || b.dir === 'ltr' ? b.dir : (firstStrong(textOf(b.content)) ?? 'ltr')
}

/** Sens à écrire pour un paragraphe lu ailleurs (`rtl` vrai : de droite à gauche), omis s'il se déduit du texte. */
export function dirToStore(rtl: boolean, content: readonly unknown[] | undefined): 'rtl' | 'ltr' | undefined {
  const auto = firstStrong(textOf(content)) ?? 'ltr'
  const want = rtl ? 'rtl' : 'ltr'
  return want === auto ? undefined : want
}

/** Texte vertical d'une cellule en CSS ; sideways-lr se replie sur vertical-lr dans les navigateurs qui ne l'ont pas. */
export const TEXT_DIR_CSS: Record<'tbrl' | 'btlr', string> = {
  tbrl: 'writing-mode:vertical-rl;text-orientation:sideways',
  btlr: 'writing-mode:vertical-lr;writing-mode:sideways-lr',
}

/** Alignement logique → CSS : gauche et droite suivent le sens du paragraphe (début et fin), comme dans les .docx. */
export function cssAlign(a: string): string {
  return a === 'left' ? 'start' : a === 'right' ? 'end' : a
}
