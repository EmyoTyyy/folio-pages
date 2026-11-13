// Équations LaTeX (phase 6) : point d'entrée de Folio Pages.
//
// Le moteur (ast, latex, mathml, symbols, mhchem) est repris de Bento
// (slides/src/maths, MIT, © 2026 The Bento authors) : LaTeX → arbre → MathML,
// sans police ni mise en page, le navigateur dessine le MathML lui-même.
// Ce module ajoute ce dont un traitement de texte a besoin :
//   - les macros communes du document, lues avant chaque formule ;
//   - \eqref{nom} et \ref{nom} qui donnent le numéro de l'équation \label{nom} ;
//   - un cache borné (une formule est rendue une fois, pas à chaque frappe) ;
//   - un message clair, traduisible, quand une formule ne se rend pas.
// Le MathML produit ne contient que des balises et attributs construits par
// l'émetteur (aucun lien, aucun gestionnaire, couleurs vérifiées) : il peut
// être inséré tel quel.

import { MathError, type MNode } from './ast'
import { parseLatex } from './latex'
import { toMathML } from './mathml'

export type { MNode } from './ast'

export interface MathContext {
  /** Macros du document (\newcommand…), lues avant la formule. */
  macros?: string
  /** Numéros des équations, par étiquette (\label). */
  labels?: ReadonlyMap<string, number>
}

export interface Rendered {
  /** Le MathML, ou null si la formule est illisible. */
  html: string | null
  /** Pourquoi elle ne se rend pas (ou pas entièrement), sinon null. */
  error: MathProblem | null
}

/** Raison d'un échec : commande inconnue, ou erreur de syntaxe (message du moteur, en anglais). */
export type MathProblem = { kind: 'unknown'; command: string } | { kind: 'syntax'; message: string } | { kind: 'empty' }

/** Taille au-delà de laquelle on ne rend pas (le format borne déjà à 20 000). */
const MAX_TEX = 20_000

/** \label{…} d'une formule (le premier). */
export function labelOf(tex: string): string | null {
  const m = /\\label\s*\{([^{}]{1,100})\}/.exec(tex)
  return m ? m[1].trim() : null
}

/** \eqref{x} → « (n) », \ref{x} → « n » ; une étiquette inconnue → « ?? ». */
export function resolveRefs(tex: string, labels?: ReadonlyMap<string, number>): string {
  if (tex.indexOf('ref') < 0) return tex
  return tex.replace(/\\(eqref|ref)\s*\{([^{}]{1,100})\}/g, (_m, kind: string, name: string) => {
    const n = labels?.get(name.trim())
    const v = n === undefined ? '??' : String(n)
    return `\\text{${kind === 'eqref' ? `(${v})` : v}}`
  })
}

/** Le texte que le moteur lit : macros du document, puis la formule. */
function source(tex: string, ctx: MathContext): string {
  const body = resolveRefs(tex, ctx.labels)
  return ctx.macros && ctx.macros.trim() ? `${ctx.macros}\n${body}` : body
}

function problemOf(e: unknown): MathProblem {
  const msg = e instanceof Error ? e.message : String(e)
  const unknown = /^unknown command (\\\S+)/.exec(msg)
  return unknown ? { kind: 'unknown', command: unknown[1] } : { kind: 'syntax', message: msg.slice(0, 200) }
}

/** Arbre de la formule (pour l'export .docx) ; lève MathError si elle est illisible. */
export function parseTex(tex: string, display: boolean, ctx: MathContext = {}, lenient = true): MNode {
  return parseLatex(source(tex, ctx), display, lenient)
}

// Cache : clé = mode + macros + formule. Borné, le plus ancien sort en premier.
const CACHE_MAX = 600
const cache = new Map<string, Rendered>()

/**
 * Rend une formule. Jamais d'exception. Une commande inconnue est dessinée sous
 * son nom (en rouge) et le reste de la formule s'affiche ; l'erreur est alors
 * renseignée, pour l'indice de l'éditeur.
 */
export function renderTex(tex: string, display: boolean, ctx: MathContext = {}): Rendered {
  const src = source(tex, ctx)
  if (!tex.trim()) return { html: null, error: { kind: 'empty' } }
  if (src.length > MAX_TEX + (ctx.macros?.length ?? 0)) return { html: null, error: { kind: 'syntax', message: 'too long' } }
  const key = `${display ? 'D' : 'I'}${src}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  let out: Rendered
  try {
    const html = toMathML(parseLatex(src, display, true), display)
    let error: MathProblem | null = null
    if (html.includes('bento-math-unknown')) {
      try {
        parseLatex(src, display, false)
      } catch (e) {
        error = problemOf(e)
      }
    }
    out = { html, error }
  } catch (e) {
    out = { html: null, error: problemOf(e) }
  }
  cache.set(key, out)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return out
}

export { MathError }

// --- repérage des formules dans du texte ------------------------------------

export interface TexSpan {
  from: number
  to: number
  tex: string
  display: boolean
}

/**
 * Formules dans un texte brut (collage, champ « md ») : $$…$$, \[…\] (centrées),
 * $…$ et \(…\) (en ligne). Règle de Bento pour $…$ : pas d'espace juste à
 * l'intérieur, pas de chiffre juste après le $ fermant (« 5 $ et 10 $ » reste
 * du texte). Un \$ est un dollar.
 */
export function findTex(text: string): TexSpan[] {
  const out: TexSpan[] = []
  if (text.indexOf('$') < 0 && text.indexOf('\\(') < 0 && text.indexOf('\\[') < 0) return out
  const re = /(?<!\\)\$\$((?:[^$\\]|\\[\s\S])+?)\$\$|(?<!\\)\\\[([\s\S]+?)\\\]|(?<!\\)\\\(([\s\S]+?)\\\)|(?<![\\$])\$((?:[^$\\\s]|\\[^\n])(?:(?:[^$\\\n]|\\[^\n])*?(?:[^$\\\s]|\\[^\n]))?)\$(?!\d)/g
  for (const m of text.matchAll(re)) {
    const tex = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim()
    if (!tex) continue
    out.push({ from: m.index!, to: m.index! + m[0].length, tex, display: m[1] !== undefined || m[2] !== undefined })
  }
  return out
}
