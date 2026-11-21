// Feuille de styles du document : variables du thème, styles nommés, polices
// intégrées. Elle est recalculée quand le thème, les styles ou les polices
// changent, et vit dans un <style> transitoire (jamais enregistré : le
// fichier se recalcule à partir du JSON).

import { cssAlign } from '../format/bidi'
import { cssColor, cssHighlight } from '../format/color'
import { resolveStyle, BUILTIN_STYLE_IDS } from '../format/theme'
import { CODE_COLORS, THEME_COLORS, THEME_FONTS, UNICODE_RANGE, hasOwn, type StyleDef, type Theme } from '../format/types'
import { cssFont } from './css'

export interface EditorFontFace {
  family: string
  src: string
  weight: number
  italic: boolean
  unicodeRange?: string
}

/** Déclarations CSS d'un style résolu. */
export function styleCss(s: StyleDef): string {
  const out: string[] = []
  if (s.font) out.push(`font-family:${cssFont(s.font)}`)
  if (s.size) out.push(`font-size:${s.size}pt`)
  if (s.color) out.push(`color:${cssColor(s.color)}`)
  if (s.highlight) out.push(`background-color:${cssHighlight(s.highlight)}`)
  if (s.bold !== undefined) out.push(`font-weight:${s.bold ? 700 : 400}`)
  if (s.italic !== undefined) out.push(`font-style:${s.italic ? 'italic' : 'normal'}`)
  const deco = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean)
  if (s.underline !== undefined || s.strike !== undefined) out.push(`text-decoration-line:${deco.length ? deco.join(' ') : 'none'}`)
  if (s.caps !== undefined) out.push(`text-transform:${s.caps ? 'uppercase' : 'none'}`)
  if (s.smallcaps !== undefined) out.push(`font-variant-caps:${s.smallcaps ? 'small-caps' : 'normal'}`)
  if (s.letterSpacing !== undefined) out.push(`letter-spacing:${s.letterSpacing}pt`)
  if (s.align) out.push(`text-align:${cssAlign(s.align)}`)
  if (s.indent?.left !== undefined) out.push(`margin-inline-start:${s.indent.left}pt`)
  if (s.indent?.right !== undefined) out.push(`margin-inline-end:${s.indent.right}pt`)
  if (s.indent?.first !== undefined) out.push(`text-indent:${s.indent.first}pt`)
  if (s.spacing?.before !== undefined) out.push(`margin-top:${s.spacing.before}pt`)
  if (s.spacing?.after !== undefined) out.push(`margin-bottom:${s.spacing.after}pt`)
  if (s.line) out.push(`line-height:${s.line}`)
  if (s.shading) out.push(`background-color:${cssColor(s.shading)}`, 'padding:2pt 6pt')
  if (s.border) out.push(`border:1px solid ${cssColor(s.border)}`, 'padding:4pt 6pt')
  if (s.keepNext) out.push('break-after:avoid')
  if (s.keepLines) out.push('break-inside:avoid')
  if (s.pageBreakBefore) out.push('break-before:page')
  return out.join(';')
}

const fontSrcOk = (src: string) => /^data:(font|application)\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/.test(src)

/**
 * CSS du document, sous le sélecteur `scope` (la page de l'éditeur, ou la
 * page imprimée). Rien ici ne vient du document sans avoir été validé : les
 * couleurs, polices et tailles ont déjà passé le format.
 */
export function documentCss(theme: Theme, styles: Record<string, StyleDef>, fonts: EditorFontFace[], scope = '.fp-prose'): string {
  const vars: string[] = []
  for (const c of THEME_COLORS) vars.push(`--doc-${c}:${theme.colors[c]}`)
  for (const f of THEME_FONTS) vars.push(`--doc-font-${f}:${cssFont(theme.fonts[f]).replace(/^var\(--doc-font-\w+\)$/, 'serif')}`)
  for (const c of CODE_COLORS) vars.push(`--doc-code-${c}:${theme.code[c]}`)
  const rules: string[] = [`${scope}{${vars.join(';')}}`]

  const normal = resolveStyle(styles, 'normal')
  rules.push(`${scope}{${styleCss(normal)}}`)
  // Les paragraphes héritent de Normal ; les marges de Normal valent pour chaque paragraphe.
  const para = styleCss({ spacing: normal.spacing, line: normal.line })
  rules.push(`${scope} p{${para}}`)
  for (let l = 1; l <= 6; l++) rules.push(`${scope} h${l}{${styleCss(resolveStyle(styles, `heading${l}`))}}`)
  rules.push(`${scope} blockquote{${styleCss(stripBox(resolveStyle(styles, 'quote'), normal))}}`)
  rules.push(`${scope} pre{${styleCss(stripBox(resolveStyle(styles, 'code'), normal))}}`)
  rules.push(`${scope} figcaption{${styleCss(resolveStyle(styles, 'caption'))}}`)
  // Notes : le style « Texte de note » (footnote) ; un style choisi pour un paragraphe de note l'emporte (règles suivantes).
  const note = resolveStyle(styles, 'footnote')
  rules.push(`${scope} .fp-note{${styleCss({ font: note.font, size: note.size, color: note.color, line: note.line })}}`)
  rules.push(`${scope} .fp-note p{${styleCss(note)}}`)
  const ids = new Set([...BUILTIN_STYLE_IDS, ...Object.keys(styles)])
  for (const id of ids) {
    if (/^heading\d$|^quote$|^code$|^normal$/.test(id)) continue
    if (!hasOwn(styles, id) && !['title', 'subtitle', 'caption', 'footnote'].includes(id)) continue
    rules.push(`${scope} p[data-style="${id}"]{${styleCss(resolveStyle(styles, id))}}`)
  }
  for (const f of fonts) {
    if (!fontSrcOk(f.src)) continue
    const family = f.family.replace(/["\\]/g, '')
    const range = f.unicodeRange && UNICODE_RANGE.test(f.unicodeRange) ? `;unicode-range:${f.unicodeRange}` : ''
    rules.unshift(`@font-face{font-family:"${family}";src:url(${f.src});font-weight:${f.weight};font-style:${f.italic ? 'italic' : 'normal'};font-display:swap${range}}`)
  }
  return rules.join('\n')
}

/** Une citation ou un bloc de code ne reprend pas les marges de Normal (déjà portées par ses paragraphes). */
function stripBox(s: StyleDef, normal: StyleDef): StyleDef {
  const out = { ...s }
  if (JSON.stringify(out.spacing) === JSON.stringify(normal.spacing)) delete out.spacing
  if (out.line === normal.line) delete out.line
  return out
}
