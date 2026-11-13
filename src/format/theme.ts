// Thèmes et styles intégrés : ils font partie du format (version 1).
//
// Un document ne stocke que ce qu'il change : un style intégré absent de
// `styles` garde la définition ci-dessous, et un thème est complet (couleurs,
// polices, couleurs du code). Les styles renvoient au thème (« heading »,
// « accent1 »…) : changer le thème change tout ce qui y fait référence.

import { hasOwn, type StyleDef, type Theme } from './types'

/** Polices embarquées dans l'application (SIL OFL). */
export const EMBEDDED_FONTS = ['Hanken Grotesk', 'Newsreader', 'JetBrains Mono'] as const

const codeLight = {
  background: '#f6f5f1',
  text: '#24292f',
  keyword: '#a2348a',
  string: '#2f7a3f',
  number: '#9a5b00',
  comment: '#7d7a72',
  function: '#2b5fb4',
  type: '#8a6100',
}

export const THEME_PRESETS: Record<string, Theme> = {
  folio: {
    name: 'folio',
    colors: {
      text: '#1d1c19',
      accent1: '#1e6b55',
      accent2: '#d95f45',
      accent3: '#2f5d9e',
      accent4: '#b7791f',
      accent5: '#7b4fa0',
      accent6: '#5f6b73',
    },
    fonts: { heading: 'Newsreader', body: 'Hanken Grotesk', mono: 'JetBrains Mono' },
    code: codeLight,
  },
  classic: {
    name: 'classic',
    colors: {
      text: '#1a1a1a',
      accent1: '#23395b',
      accent2: '#8c2f39',
      accent3: '#3d6b45',
      accent4: '#a46c1f',
      accent5: '#5b4b8a',
      accent6: '#606060',
    },
    fonts: { heading: 'Newsreader', body: 'Newsreader', mono: 'JetBrains Mono' },
    code: codeLight,
  },
  modern: {
    name: 'modern',
    colors: {
      text: '#16181d',
      accent1: '#2557d6',
      accent2: '#e0613b',
      accent3: '#0f8a7a',
      accent4: '#c58b00',
      accent5: '#8e44ad',
      accent6: '#59606d',
    },
    fonts: { heading: 'Hanken Grotesk', body: 'Hanken Grotesk', mono: 'JetBrains Mono' },
    code: codeLight,
  },
  slate: {
    name: 'slate',
    colors: {
      text: '#22262b',
      accent1: '#3b4a5a',
      accent2: '#6c8ead',
      accent3: '#9a6b4f',
      accent4: '#7a8c5c',
      accent5: '#8a6f9e',
      accent6: '#8a9099',
    },
    fonts: { heading: 'Hanken Grotesk', body: 'Newsreader', mono: 'JetBrains Mono' },
    code: codeLight,
  },
  ink: {
    name: 'ink',
    colors: {
      text: '#111111',
      accent1: '#111111',
      accent2: '#c8102e',
      accent3: '#444444',
      accent4: '#777777',
      accent5: '#c8102e',
      accent6: '#999999',
    },
    fonts: { heading: 'Newsreader', body: 'Newsreader', mono: 'JetBrains Mono' },
    code: { ...codeLight, keyword: '#c8102e', function: '#111111', type: '#444444', string: '#555555' },
  },
  system: {
    name: 'system',
    colors: {
      text: '#1d1c19',
      accent1: '#1f5fa8',
      accent2: '#c0392b',
      accent3: '#27855a',
      accent4: '#b8860b',
      accent5: '#7d3c98',
      accent6: '#5d6d7e',
    },
    fonts: { heading: 'system-ui', body: 'Georgia', mono: 'monospace' },
    code: codeLight,
  },
}

export const DEFAULT_THEME = 'folio'

export const cloneTheme = (t: Theme): Theme => ({
  name: t.name,
  colors: { ...t.colors },
  fonts: { ...t.fonts },
  code: { ...t.code },
})

export const defaultTheme = (): Theme => cloneTheme(THEME_PRESETS[DEFAULT_THEME])

export const presetOf = (name: string): Theme =>
  cloneTheme(hasOwn(THEME_PRESETS, name) ? THEME_PRESETS[name] : THEME_PRESETS[DEFAULT_THEME])

/** Styles intégrés. Leur nom affiché vient du dictionnaire de l'interface. */
export const BUILTIN_STYLES: Record<string, StyleDef> = {
  normal: { font: 'body', size: 11, color: 'text', line: 1.45, spacing: { before: 0, after: 7 } },
  title: { basedOn: 'normal', next: 'normal', font: 'heading', size: 30, line: 1.1, letterSpacing: -0.3, spacing: { before: 0, after: 4 }, keepNext: true },
  subtitle: { basedOn: 'normal', next: 'normal', size: 14, color: 'accent6', spacing: { before: 0, after: 16 }, keepNext: true },
  heading1: { basedOn: 'normal', next: 'normal', font: 'heading', size: 21, bold: true, color: 'accent1', line: 1.2, spacing: { before: 18, after: 6 }, keepNext: true },
  heading2: { basedOn: 'normal', next: 'normal', font: 'heading', size: 16, bold: true, line: 1.2, spacing: { before: 14, after: 5 }, keepNext: true },
  heading3: { basedOn: 'normal', next: 'normal', font: 'heading', size: 13.5, bold: true, line: 1.25, spacing: { before: 12, after: 4 }, keepNext: true },
  heading4: { basedOn: 'normal', next: 'normal', size: 12, bold: true, line: 1.3, spacing: { before: 10, after: 4 }, keepNext: true },
  heading5: { basedOn: 'normal', next: 'normal', size: 11, bold: true, italic: true, spacing: { before: 8, after: 3 }, keepNext: true },
  heading6: { basedOn: 'normal', next: 'normal', size: 10, bold: true, caps: true, letterSpacing: 0.6, color: 'accent6', spacing: { before: 8, after: 3 }, keepNext: true },
  quote: { basedOn: 'normal', italic: true, color: 'accent6' },
  code: { basedOn: 'normal', font: 'mono', size: 9.5, line: 1.5 },
  caption: { basedOn: 'normal', size: 9.5, italic: true, color: 'accent6', align: 'center', spacing: { before: 4, after: 10 } },
  /** Texte des notes de bas de page et de fin. */
  footnote: { basedOn: 'normal', size: 9, line: 1.3, spacing: { before: 0, after: 2 } },
}

export const BUILTIN_STYLE_IDS = Object.keys(BUILTIN_STYLES)

/** Styles qu'on applique à un paragraphe (les titres passent par `heading`). */
export const PARAGRAPH_STYLE_IDS = ['normal', 'title', 'subtitle', 'caption'] as const

export const isBuiltinStyle = (id: string): boolean => hasOwn(BUILTIN_STYLES, id)

const STYLE_KEYS: (keyof StyleDef)[] = [
  'name',
  'basedOn',
  'next',
  'font',
  'size',
  'color',
  'highlight',
  'bold',
  'italic',
  'underline',
  'strike',
  'caps',
  'smallcaps',
  'letterSpacing',
  'align',
  'indent',
  'spacing',
  'line',
  'keepNext',
  'keepLines',
  'pageBreakBefore',
  'shading',
  'border',
]

/** Copie d'une définition, champs dans l'ordre fixe, objets imbriqués copiés. */
export function cleanStyle(d: StyleDef): StyleDef {
  const out: Record<string, unknown> = {}
  for (const k of STYLE_KEYS) {
    const v = d[k]
    if (v === undefined) continue
    if (k === 'indent' || k === 'spacing') {
      const o = v as Record<string, number | undefined>
      const sub: Record<string, number> = {}
      for (const s of k === 'indent' ? ['left', 'right', 'first'] : ['before', 'after']) if (typeof o[s] === 'number') sub[s] = o[s]!
      if (Object.keys(sub).length) out[k] = sub
    } else out[k] = v
  }
  return out as StyleDef
}

/** Définition effective d'un style : modifications du document sur la définition intégrée. */
export function styleDef(styles: Record<string, StyleDef>, id: string): StyleDef | null {
  const own = hasOwn(styles, id) ? styles[id] : null
  const builtin = isBuiltinStyle(id) ? BUILTIN_STYLES[id] : null
  if (!own && !builtin) return null
  if (!own) return builtin
  if (!builtin) return own
  const merged: StyleDef = { ...builtin, ...own }
  if (builtin.indent || own.indent) merged.indent = { ...builtin.indent, ...own.indent }
  if (builtin.spacing || own.spacing) merged.spacing = { ...builtin.spacing, ...own.spacing }
  return cleanStyle(merged)
}

/**
 * Propriétés résolues d'un style, héritage compris (basedOn), sans boucle :
 * une chaîne trop longue ou circulaire s'arrête.
 */
export function resolveStyle(styles: Record<string, StyleDef>, id: string): StyleDef {
  const chain: StyleDef[] = []
  const seen = new Set<string>()
  let cur: string | undefined = id
  while (cur && !seen.has(cur) && chain.length < 10) {
    seen.add(cur)
    const d = styleDef(styles, cur)
    if (!d) break
    chain.unshift(d)
    cur = d.basedOn
  }
  let out: StyleDef = {}
  for (const d of chain) {
    const indent = out.indent || d.indent ? { ...out.indent, ...d.indent } : undefined
    const spacing = out.spacing || d.spacing ? { ...out.spacing, ...d.spacing } : undefined
    out = { ...out, ...d }
    if (indent) out.indent = indent
    if (spacing) out.spacing = spacing
  }
  delete out.name
  delete out.basedOn
  return out
}

/** Les styles d'un document sans les modifications qui ne changent rien. */
export function pruneStyles(styles: Record<string, StyleDef>): Record<string, StyleDef> {
  const out: Record<string, StyleDef> = {}
  for (const id of Object.keys(styles)) {
    const d = cleanStyle(styles[id])
    if (isBuiltinStyle(id)) {
      const b = BUILTIN_STYLES[id]
      const diff: Record<string, unknown> = {}
      for (const k of Object.keys(d) as (keyof StyleDef)[]) {
        if (JSON.stringify(d[k]) !== JSON.stringify(b[k])) diff[k] = d[k]
      }
      if (Object.keys(diff).length) out[id] = cleanStyle(diff as StyleDef)
    } else if (d.name) out[id] = d
  }
  return out
}
