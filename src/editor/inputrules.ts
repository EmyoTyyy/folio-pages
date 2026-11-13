// Markdown à la frappe : « # » pour un titre, « - » pour une liste, **gras**,
// *italique*, `code`, ~~barré~~, {{page}}… Une barre oblique inverse juste
// avant le marqueur annule la conversion (« \*mot* » reste « *mot* »).
// Retour arrière juste après une conversion la défait.

import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules'
import type { MarkType } from 'prosemirror-model'
import type { EditorState } from 'prosemirror-state'
import { parseFieldToken } from '../format/fields'
import { mathInputRules } from './math'
import { schema } from './schema'

const n = schema.nodes
const m = schema.marks

/** Pas de conversion dans le code (bloc ou marque), ni dans une formule $…$ en cours de frappe. */
export function inCode(state: EditorState, start: number): boolean {
  const $s = state.doc.resolve(start)
  if ($s.parent.type.spec.code) return true
  if (m.code.isInSet($s.marks())) return true
  return inOpenMath($s.parent.textBetween(0, $s.parentOffset, undefined, '\ufffc'))
}

/** Un $ ou $$ ouvert et pas encore fermé dans ce texte (x_1 ou a*b n'y sont pas de la mise en forme). */
export function inOpenMath(before: string): boolean {
  if (before.indexOf('$') < 0) return false
  const s = before.replace(/\\[\\$]/g, '')
  let display = false
  let inline = false
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '$') continue
    if (s[i + 1] === '$' && !inline) {
      display = !display
      i++
    } else if (!display) inline = !inline
  }
  return display || inline
}

/**
 * Règle de marque : `délimiteur texte délimiteur` en fin de saisie devient
 * `texte` avec la marque. Précédé d'une barre oblique inverse, le marqueur
 * reste en texte (et la barre disparaît).
 */
function markRule(delim: string, type: MarkType): InputRule {
  // En mode « u », seul * doit être échappé (~, _ et ` ne sont pas des caractères spéciaux).
  const esc = (x: string) => x.replace(/\*/g, '\\*')
  const d = esc(delim)
  const c = esc(delim[0])
  // Pas de marqueur collé à un autre (« ***** »), ni au milieu d'un mot pour _.
  const guard = delim[0] === '_' ? '\\p{L}\\p{N}_\\\\' : `${c}\\\\`
  const body = delim === '`' ? '[^`]+' : `[^\\s${c}](?:[^${c}]*[^\\s${c}])?`
  const re = new RegExp(`(?<![${guard}])(\\\\?)${d}(${body})${d}$`, 'u')
  return new InputRule(re, (state, match, start, end) => {
    const [whole, escape, text] = match
    if (inCode(state, start)) return null
    const tr = state.tr
    if (escape) {
      tr.delete(start, start + 1)
      tr.insertText(whole.slice(-1), tr.mapping.map(end))
      return tr
    }
    const textStart = start + delim.length
    const textEnd = textStart + text.length
    if (textEnd < end) tr.delete(textEnd, end)
    tr.delete(start, textStart)
    tr.addMark(start, start + text.length, type.create())
    tr.removeStoredMark(type)
    return tr
  })
}

/** {{page}}, {{date:JJ/MM/AAAA}}… deviennent des champs. */
const fieldRule = new InputRule(/(\\?)\{\{([^{}\n]{1,60})\}\}$/, (state, match, start, end) => {
  if (inCode(state, start)) return null
  const [, escape, inner] = match
  const field = parseFieldToken(inner)
  if (!field) return null
  const tr = state.tr
  if (escape) {
    tr.delete(start, start + 1)
    tr.insertText('}', tr.mapping.map(end))
    return tr
  }
  const marks = state.doc.resolve(start).marks()
  return tr.replaceWith(start, end, n.field.create(field, null, marks))
})

/** Typographie : trois points deviennent des points de suspension. */
const typography = [new InputRule(/\.\.\.$/, (state, _m, start, end) => (inCode(state, start) ? null : state.tr.insertText('…', start, end)))]

export function markdownInputRules() {
  const rules: InputRule[] = [
    textblockTypeInputRule(/^(#{1,6})\s$/, n.heading, (match) => ({ level: match[1].length })),
    wrappingInputRule(/^\s*([-+*])\s$/, n.bullet_list),
    wrappingInputRule(
      /^(\d{1,6})[.)]\s$/,
      n.ordered_list,
      (match) => ({ order: Math.max(1, Number(match[1])) }),
      (match, node) => node.childCount + node.attrs.order === Number(match[1]),
    ),
    wrappingInputRule(/^\s*>\s$/, n.blockquote),
    textblockTypeInputRule(/^```([\w+#-]*)\s$/, n.code_block, (match) => ({ language: match[1] ?? '' })),
    new InputRule(/^(?:---|\*\*\*|___)\s$/, (state, _match, start, end) => {
      const $s = state.doc.resolve(start)
      if ($s.parent.type !== n.paragraph) return null
      const host = $s.node($s.depth - 1)
      if (!host.canReplaceWith($s.index($s.depth - 1), $s.index($s.depth - 1), n.horizontal_rule)) return null
      const blockStart = $s.before()
      return state.tr.delete(start, end).insert(blockStart, n.horizontal_rule.create())
    }),
    markRule('**', m.bold),
    markRule('__', m.bold),
    markRule('*', m.italic),
    markRule('_', m.italic),
    markRule('~~', m.strike),
    markRule('`', m.code),
    fieldRule,
    ...typography,
    ...mathInputRules(),
  ]
  return inputRules({ rules })
}
