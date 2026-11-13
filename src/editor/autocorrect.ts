// Correction automatique pendant la frappe : fautes courantes et symboles
// (« (c) » → ©, « -> » → →), guillemets typographiques (« » en français,
// “ ” en anglais), apostrophe courbe, espace insécable avant ; : ! ? en
// français, majuscule en début de phrase (désactivée par défaut).
//
// Chaque correction est une règle de saisie : Retour arrière juste après la
// défait, comme pour le Markdown à la frappe. Rien ne change dans le code,
// dans une formule en cours de frappe ni dans une adresse web.

import { InputRule, inputRules } from 'prosemirror-inputrules'
import type { EditorState, Plugin } from 'prosemirror-state'
import { inCode } from './inputrules'

/** Espace insécable (avant : et dans « »). */
export const NBSP = ' '
/** Espace fine insécable (avant ; ! ?). */
export const NNBSP = ' '

export interface AutoCorrectOptions {
  /** Guillemets et apostrophes typographiques. */
  quotes: boolean
  /** Espaces insécables de la typographie française. */
  frenchSpacing: boolean
  /** Remplacer pendant la frappe (liste). */
  replace: boolean
  /** Majuscule en début de phrase. */
  capitalize: boolean
  /** Liste effective : ce qu'on tape → ce qui le remplace. */
  list: ReadonlyMap<string, string>
  /** Langue du document (fr, en…). */
  lang: string
}

// --- listes intégrées ------------------------------------------------------------

/** Symboles, dans toutes les langues. */
const SYMBOLS: [string, string][] = [
  ['(c)', '©'],
  ['(C)', '©'],
  ['(r)', '®'],
  ['(R)', '®'],
  ['(tm)', '™'],
  ['(TM)', '™'],
  ['->', '→'],
  ['<-', '←'],
  ['=>', '⇒'],
  ['<=>', '⇔'],
  ['<->', '↔'],
  ['--', '–'],
  ['---', '—'],
  ['+-', '±'],
  ['!=', '≠'],
  ['<=', '≤'],
  ['>=', '≥'],
  ['1/2', '½'],
  ['1/4', '¼'],
  ['3/4', '¾'],
  ['etc…', 'etc.'],
]

const FRENCH: [string, string][] = [
  ['deja', 'déjà'],
  ['voila', 'voilà'],
  ['etre', 'être'],
  ['tres', 'très'],
  ['apres', 'après'],
  ['probleme', 'problème'],
  ['systeme', 'système'],
  ['interessant', 'intéressant'],
  ['developpement', 'développement'],
  ['dévelopement', 'développement'],
  ['parceque', 'parce que'],
  ['quelquechose', 'quelque chose'],
  ['aujourdhui', 'aujourd’hui'],
  ['oeuvre', 'œuvre'],
  ['coeur', 'cœur'],
  ['soeur', 'sœur'],
  ['oeil', 'œil'],
  ['oeuf', 'œuf'],
  ['boeuf', 'bœuf'],
  ['noeud', 'nœud'],
  ['voeu', 'vœu'],
  ['voeux', 'vœux'],
  ['manoeuvre', 'manœuvre'],
  ['parmis', 'parmi'],
  ['apeller', 'appeler'],
  ['aquérir', 'acquérir'],
  ['language', 'langage'],
  ['example', 'exemple'],
  ['addresse', 'adresse'],
]

const ENGLISH: [string, string][] = [
  ['i', 'I'],
  ['teh', 'the'],
  ['adn', 'and'],
  ['recieve', 'receive'],
  ['seperate', 'separate'],
  ['definately', 'definitely'],
  ['occured', 'occurred'],
  ['untill', 'until'],
  ['wich', 'which'],
  ['becuase', 'because'],
  ['beleive', 'believe'],
  ['freind', 'friend'],
  ['goverment', 'government'],
  ['tommorow', 'tomorrow'],
  ['accomodate', 'accommodate'],
  ['acheive', 'achieve'],
  ['alot', 'a lot'],
  ['dont', 'don’t'],
  ['doesnt', 'doesn’t'],
  ['didnt', 'didn’t'],
  ['cant', 'can’t'],
  ['wont', 'won’t'],
  ['isnt', 'isn’t'],
  ['thier', 'their'],
  ['wierd', 'weird'],
  ['truely', 'truly'],
  ['neccessary', 'necessary'],
  ['enviroment', 'environment'],
  ['existance', 'existence'],
  ['begining', 'beginning'],
  ['calender', 'calendar'],
  ['comming', 'coming'],
  ['independant', 'independent'],
  ['occassion', 'occasion'],
  ['publically', 'publicly'],
  ['recomend', 'recommend'],
  ['refered', 'referred'],
  ['succesful', 'successful'],
]

/** La langue de base d'un code (fr-CA → fr) ; seules fr et en ont leur liste. */
export const acLang = (lang: string): 'fr' | 'en' | 'other' => {
  const b = (lang || '').slice(0, 2).toLowerCase()
  return b === 'fr' ? 'fr' : b === 'en' ? 'en' : 'other'
}

/** La liste d'origine pour une langue : symboles, puis fautes courantes de la langue. */
export function builtinList(lang: string): [string, string][] {
  const l = acLang(lang)
  return [...SYMBOLS, ...(l === 'fr' ? FRENCH : l === 'en' ? ENGLISH : [])]
}

/** Bornes de la liste personnelle (gardée dans le navigateur). */
export const AC_LIMITS = { entries: 500, from: 40, to: 200 }

/** Une entrée valide : un « mot » sans espace ni retour à la ligne, un remplacement court. */
export const validEntry = (from: string, to: string): boolean =>
  from.length > 0 && from.length <= AC_LIMITS.from && !/[\s]/.test(from) && to.length > 0 && to.length <= AC_LIMITS.to && !/[\r\n]/.test(to)

/**
 * Liste effective : la liste d'origine sans les entrées retirées, plus les
 * entrées personnelles (qui l'emportent).
 */
export function effectiveList(lang: string, custom: [string, string][], removed: string[]): Map<string, string> {
  const out = new Map<string, string>()
  const gone = new Set(removed)
  for (const [k, v] of builtinList(lang)) if (!gone.has(k)) out.set(k, v)
  for (const [k, v] of custom.slice(0, AC_LIMITS.entries)) if (validEntry(k, v)) out.set(k, v)
  return out
}

/** Ce qui sépare la liste d'origine de la liste voulue : entrées personnelles et entrées retirées. */
export function diffList(lang: string, wanted: [string, string][]): { custom: [string, string][]; removed: string[] } {
  const base = new Map(builtinList(lang))
  const want = new Map(wanted.filter(([k, v]) => validEntry(k, v)).slice(0, AC_LIMITS.entries))
  const custom: [string, string][] = []
  for (const [k, v] of want) if (base.get(k) !== v) custom.push([k, v])
  const removed = [...base.keys()].filter((k) => !want.has(k))
  return { custom, removed }
}

// --- logique pure (testée à part) -------------------------------------------------

const isUpper = (s: string) => s === s.toLocaleUpperCase() && s !== s.toLocaleLowerCase()
const capFirst = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1)

/**
 * Le remplacement d'un mot : exact d'abord ; sinon sans tenir compte de la
 * casse, en gardant la majuscule initiale (« Teh » → « The ») ou les
 * capitales (« TEH » → « THE »). Les symboles ne suivent que la forme exacte.
 */
export function replacementFor(word: string, list: ReadonlyMap<string, string>): string | null {
  const exact = list.get(word)
  if (exact !== undefined) return exact
  if (!/\p{L}/u.test(word)) return null
  const lower = word.toLocaleLowerCase()
  const hit = list.get(lower)
  if (hit === undefined || !/^\p{L}/u.test(hit)) return null
  if (word.length > 1 && isUpper(word)) return hit.toLocaleUpperCase()
  if (isUpper(word.charAt(0))) return capFirst(hit)
  return null
}

/** Ce qui ouvre des guillemets : début de paragraphe, espace, parenthèse, tiret. */
const OPENS_BEFORE = /^$|[\s([{  «“‘—–/-]$/

/** Le guillemet typographique pour un guillemet droit tapé après `before`. */
export function smartQuote(before: string, typed: '"' | "'", lang: string): { text: string; replaceSpace: boolean } {
  const opening = OPENS_BEFORE.test(before.slice(-1))
  const fr = acLang(lang) === 'fr'
  if (typed === "'") return { text: opening ? '‘' : '’', replaceSpace: false }
  if (fr) {
    // Un « encore ouvert dans le paragraphe : ce guillemet le ferme, même tapé après une espace.
    const open = before.lastIndexOf('«') > before.lastIndexOf('»')
    if (!open && opening) return { text: '«' + NBSP, replaceSpace: false }
    // « mot » : l'espace tapée avant le guillemet fermant devient insécable.
    return before.endsWith(' ') ? { text: NBSP + '»', replaceSpace: true } : { text: NBSP + '»', replaceSpace: false }
  }
  return { text: opening ? '“' : '”', replaceSpace: false }
}

/** Le texte depuis la dernière espace ressemble-t-il à une adresse (web, courriel, fichier) ? */
export const looksLikeAddress = (before: string): boolean => {
  const word = /\S*$/.exec(before)?.[0] ?? ''
  return /:\/\/|^www\.|@|\\|\p{L}\/|\/\p{L}/u.test(word) || /\p{L}\.\p{L}{2}/u.test(word)
}

/**
 * Typographie française : l'espace avant ; ! ? (fine) et : » (normale) devient
 * insécable. Tapés juste après une lettre, ; ! ? reçoivent leur espace fine.
 * Renvoie le texte qui remplace `before`'s dernière espace (ou s'insère), ou null.
 */
export function frenchSpace(before: string, typed: string): { text: string; replaceSpace: boolean } | null {
  if (!/^[;:!?»]$/.test(typed)) return null
  const space = typed === ':' || typed === '»' ? NBSP : NNBSP
  const last = before.slice(-1)
  if (last === ' ') return { text: space + typed, replaceSpace: true }
  // Directement après une lettre : seulement ; ! ? (« 10:30 », « http: » gardent leur deux-points).
  if (typed !== ':' && typed !== '»' && /\p{L}$/u.test(before) && !looksLikeAddress(before)) return { text: NNBSP + typed, replaceSpace: false }
  return null
}

/** Le mot qu'on vient de taper commence-t-il une phrase ? (`before` : le texte qui le précède.) */
export function startsSentence(before: string): boolean {
  if (!before.trim()) return true
  // Après . ! ? … (et d'éventuels guillemets ou parenthèses fermants), puis une espace.
  return /[.!?…]["”»)\]’]*[\s  ]+$/u.test(before) && !/\b(?:e\.g|i\.e|etc|cf|p|pp|vol|n°|M|Mme|Dr|St|av|apr|J\.-C)\.\s+$/u.test(before)
}

// --- règles de saisie -------------------------------------------------------------

/** Caractères qui terminent un mot (et déclenchent le remplacement). */
const BOUNDARY = ' .,;:!?»”’)]}"\u00a0\u202f'
const escapeClass = (s: string) => s.replace(/[\]\\^-]/g, '\\$&')
const BOUNDARY_CLASS = `[${escapeClass(BOUNDARY)}]`

export function autoCorrectPlugin(options: () => AutoCorrectOptions | null): Plugin {
  const blocked = (state: EditorState, at: number) => inCode(state, at)

  // Mot (sans espace) suivi d'un caractère de fin de mot.
  const word = new InputRule(new RegExp(`(^|[\\s\\u00a0\\u202f«“‘"'(\\[{])([^\\s\\u00a0\\u202f«“‘"]{1,40})(${BOUNDARY_CLASS})$`, 'u'), (state, match, start, end) => {
    const o = options()
    if (!o || (!o.replace && !o.capitalize)) return null
    const [, lead, token, typed] = match
    const from = start + lead.length
    if (blocked(state, from)) return null
    const $from = state.doc.resolve(from)
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
    let out: string | null = null
    if (o.replace) {
      // Ponctuation collée au mot (« (c), ») : le mot sans elle, s'il est dans la liste.
      out = replacementFor(token, o.list)
      // « - » seul entre deux mots devient un tiret (« 1 - 2 » → « 1 – 2 ») ; pas en début de paragraphe (liste à puces).
      if (out === null && token === '-' && typed === ' ' && before.trim()) out = '–'
      if (out !== null && token === '-' && !before.trim()) out = null
    }
    if (out === null && o.capitalize && /^\p{Ll}[\p{L}’'-]*$/u.test(token) && startsSentence(before)) out = capFirst(token)
    if (out === null || out === token) return null
    if (looksLikeAddress(before + token) && !/^[\p{L}’]+$/u.test(token)) return null
    // Le caractère tapé suit, avec la typographie française s'il le faut.
    let tail = typed
    if (typed === '"') tail = o.quotes ? smartQuote(before + out, '"', o.lang).text : '"'
    if (o.frenchSpacing && acLang(o.lang) === 'fr') {
      const fs = frenchSpace(before + out, typed)
      if (fs && !fs.replaceSpace) tail = fs.text
    }
    return state.tr.insertText(out + tail, from, end)
  })

  const quote = new InputRule(/(["'])$/, (state, match, start, end) => {
    const o = options()
    if (!o?.quotes || blocked(state, start)) return null
    const $s = state.doc.resolve(start)
    const before = $s.parent.textBetween(0, $s.parentOffset, undefined, '￼')
    // Une apostrophe dans une adresse ou un code tapé en texte : on la laisse.
    if (match[1] === '"' && looksLikeAddress(before)) return null
    const q = smartQuote(before, match[1] as '"' | "'", o.lang)
    return state.tr.insertText(q.text, q.replaceSpace ? start - 1 : start, end)
  })

  const french = new InputRule(/([\s\S]?)([;:!?»])$/u, (state, match, start, end) => {
    const o = options()
    if (!o?.frenchSpacing || acLang(o.lang) !== 'fr') return null
    const at = start + match[1].length
    if (blocked(state, at)) return null
    const $s = state.doc.resolve(at)
    const before = $s.parent.textBetween(0, $s.parentOffset, undefined, '￼')
    if (looksLikeAddress(before.trimEnd())) return null
    const fs = frenchSpace(before, match[2])
    if (!fs) return null
    return state.tr.insertText(fs.text, fs.replaceSpace ? at - 1 : at, end)
  })

  // Après « tapé avec une espace : l'espace devient insécable.
  const afterGuillemet = new InputRule(/«( )$/, (state, _match, start, end) => {
    const o = options()
    if (!o?.frenchSpacing || acLang(o.lang) !== 'fr' || blocked(state, start)) return null
    return state.tr.insertText('«' + NBSP, start, end)
  })

  return inputRules({ rules: [word, quote, french, afterGuillemet] })
}
