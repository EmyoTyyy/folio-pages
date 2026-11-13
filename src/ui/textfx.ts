// Mise en forme du texte (onglet Accueil) : bordure et trame des caractères,
// styles et couleur du soulignement, effets du texte (contour, ombre, halo)
// et texte décoratif (styles tout faits, onglet Insertion).

import type { FolioApp } from '../app'
import { TextSelection, type Command } from 'prosemirror-state'
import { markActive, markValue, paraAttr, setMark, setParaAttrs } from '../editor/commands'
import { schema } from '../editor/schema'
import type { Key } from '../i18n/dict'
import { t } from '../i18n/i18n'
import { h } from './dom'
import { colorPalette } from './palette'
import { RIBBON_ICONS as I } from './icons'
import { popItem } from './popover'
import * as P from './panels'
import { button, dropdown, split, type Ctl } from './ribbon'

const m = schema.marks

/** Dernières couleurs choisies (le bouton les réapplique d'un clic). */
const last = { border: 'text', shading: '#d9d9d9', underline: 'accent1', glow: 'accent1' }

/** Pose ou retire plusieurs marques d'un coup (une seule étape d'annulation). */
export function applyMarks(list: { type: keyof typeof m; attrs: Record<string, unknown> | null }[]): Command {
  return (state, dispatch) => {
    const { empty, $cursor, ranges } = state.selection as TextSelection
    if (empty && !$cursor) return false
    if (!dispatch) return true
    const tr = state.tr
    for (const { type, attrs } of list) {
      const mt = m[type]
      if ($cursor) {
        tr.removeStoredMark(mt)
        if (attrs) tr.addStoredMark(mt.create(attrs))
      } else
        for (const r of ranges) {
          tr.removeMark(r.$from.pos, r.$to.pos, mt)
          if (attrs) tr.addMark(r.$from.pos, r.$to.pos, mt.create(attrs))
        }
    }
    dispatch(tr.scrollIntoView())
    return true
  }
}

const toggleValue = (app: FolioApp, type: 'text_border' | 'text_shading' | 'glow', value: string) =>
  app.run(setMark(m[type], markActive(app.state, m[type]) ? null : { value }))

export function charBorder(app: FolioApp): Ctl {
  return split({
    id: 'char-border',
    label: t('rb.charBorder'),
    icon: I.charBorder,
    active: () => markActive(app.state, m.text_border),
    run: () => toggleValue(app, 'text_border', last.border),
    menu: () =>
      colorPalette({
        theme: app.theme,
        current: (markValue(app.state, m.text_border, 'value') as string | null) ?? null,
        noneLabel: t('fx.noBorder'),
        onPick: (c) => {
          if (c) last.border = c
          app.run(setMark(m.text_border, c ? { value: c } : null))
        },
      }),
  })
}

export function charShading(app: FolioApp): Ctl {
  return split({
    id: 'char-shading',
    label: t('rb.charShading'),
    icon: I.charShading,
    active: () => markActive(app.state, m.text_shading),
    indicator: () => P.cssOf(app, last.shading),
    run: () => toggleValue(app, 'text_shading', last.shading),
    menu: () =>
      colorPalette({
        theme: app.theme,
        current: (markValue(app.state, m.text_shading, 'value') as string | null) ?? null,
        noneLabel: t('fx.noShading'),
        onPick: (c) => {
          if (c) last.shading = c
          app.run(setMark(m.text_shading, c ? { value: c } : null))
        },
      }),
  })
}

/** Menu du soulignement : simple, double, épais, pointillé, tirets, ondulé ; couleur. */
export function underlineMenu(app: FolioApp): HTMLElement {
  const current = markActive(app.state, m.underline) ? ((markValue(app.state, m.underline_style, 'value') as string | null) ?? 'single') : null
  const pick = (style: string) =>
    app.run(applyMarks([
      { type: 'underline', attrs: {} },
      { type: 'underline_style', attrs: style === 'single' ? null : { value: style } },
    ]))
  const list = h('div', { class: 'fp-pop__list' })
  for (const k of ['single', 'double', 'thick', 'dotted', 'dashed', 'wavy'] as const) {
    const sample = h('span', { class: 'fp-ul-sample', 'data-ul-style': k }, t(`rb.underline.${k}` as Key))
    list.append(popItem(sample, () => pick(k), { 'data-underline': k, role: 'menuitemradio', 'aria-checked': String(current === k) }))
  }
  list.append(h('hr', { class: 'fp-pop__sep' }), h('p', { class: 'fp-pop__heading' }, t('rb.underline.color')))
  list.append(
    colorPalette({
      theme: app.theme,
      current: (markValue(app.state, m.underline_color, 'value') as string | null) ?? null,
      noneLabel: t('color.automatic'),
      onPick: (c) => {
        if (c) last.underline = c
        app.run(applyMarks([...(markActive(app.state, m.underline) ? [] : [{ type: 'underline' as const, attrs: {} }]), { type: 'underline_color', attrs: c ? { value: c } : null }]))
      },
    }),
  )
  return list
}

/** Styles tout faits du texte décoratif : police des titres, grande taille, effets. */
export const DECORATIVE = {
  fill: (): [keyof typeof m, Record<string, unknown> | null][] => [['bold', {}], ['color', { value: 'accent1' }], ['shadow', {}], ['outline', null], ['glow', null]],
  outline: (): [keyof typeof m, Record<string, unknown> | null][] => [['bold', {}], ['color', { value: 'accent1' }], ['outline', {}], ['shadow', null], ['glow', null]],
  glow: (): [keyof typeof m, Record<string, unknown> | null][] => [['bold', {}], ['color', { value: 'text' }], ['glow', { value: 'accent3' }], ['outline', null], ['shadow', null]],
  shadow: (): [keyof typeof m, Record<string, unknown> | null][] => [['bold', {}], ['color', { value: 'text' }], ['shadow', {}], ['outline', null], ['glow', null]],
  spaced: (): [keyof typeof m, Record<string, unknown> | null][] => [['bold', {}], ['caps', {}], ['letter_spacing', { pt: 3 }], ['color', { value: 'accent2' }], ['outline', null], ['shadow', null], ['glow', null]],
  outlineGlow: (): [keyof typeof m, Record<string, unknown> | null][] => [['bold', {}], ['color', { value: 'accent1' }], ['outline', {}], ['glow', { value: 'accent1' }], ['shadow', null]],
} as const
export type DecorativeId = keyof typeof DECORATIVE

/** Applique un style décoratif à la sélection ; sans sélection, insère une ligne de titre à modifier. */
export function applyDecorative(app: FolioApp, id: DecorativeId): void {
  const marks = DECORATIVE[id]().map(([type, attrs]) => ({ type, attrs }))
  const font = { type: 'font' as const, attrs: { family: 'heading' } }
  if (!app.state.selection.empty) {
    app.run(applyMarks([...marks, font]))
    return
  }
  // Un paragraphe centré « Votre texte ici », sélectionné pour être remplacé.
  const text = t('fx.placeholder')
  const node = schema.nodes.paragraph.create({ align: 'center' }, schema.text(text, [...marks.filter((x) => x.attrs).map((x) => m[x.type].create(x.attrs!)), m.font.create({ family: 'heading' }), m.size.create({ pt: 36 })]))
  app.run((state, dispatch) => {
    const { $from } = state.selection
    const depth = Math.max(1, $from.depth)
    const block = $from.node(depth)
    const pos = $from.before(depth)
    const empty = block.isTextblock && block.content.size === 0
    const tr = empty ? state.tr.replaceWith(pos, pos + block.nodeSize, node) : state.tr.insert(pos + block.nodeSize, node)
    const at = empty ? pos : pos + block.nodeSize
    tr.setSelection(TextSelection.create(tr.doc, at + 1, at + 1 + text.length))
    dispatch?.(tr.scrollIntoView())
    return true
  })
}

function decorativeGrid(app: FolioApp): HTMLElement {
  const grid = h('div', { class: 'fp-fx-grid', role: 'menu' })
  for (const id of Object.keys(DECORATIVE) as DecorativeId[]) {
    const sample = h('span', { class: `fp-fx-sample fp-fx-sample--${id}` }, 'Aa')
    grid.append(popItem(sample, () => applyDecorative(app, id), { 'data-decorative': id, title: t(`fx.preset.${id}` as Key), 'aria-label': t(`fx.preset.${id}` as Key) }))
  }
  return grid
}

/** Menu « Effets du texte » : styles tout faits, puis contour, ombre et halo un par un. */
export function textEffects(app: FolioApp): Ctl {
  return dropdown({
    id: 'text-effects',
    label: t('rb.textEffects'),
    icon: I.textEffects,
    menu: () => {
      const list = h('div', { class: 'fp-pop__list' })
      list.append(decorativeGrid(app), h('hr', { class: 'fp-pop__sep' }))
      list.append(
        popItem(t('fx.outline'), () => app.run(setMark(m.outline, markActive(app.state, m.outline) ? null : {})), { 'data-fx': 'outline', role: 'menuitemcheckbox', 'aria-checked': String(markActive(app.state, m.outline)) }),
        popItem(t('fx.shadow'), () => app.run(setMark(m.shadow, markActive(app.state, m.shadow) ? null : {})), { 'data-fx': 'shadow', role: 'menuitemcheckbox', 'aria-checked': String(markActive(app.state, m.shadow)) }),
        h('p', { class: 'fp-pop__heading' }, t('fx.glow')),
        colorPalette({
          theme: app.theme,
          current: (markValue(app.state, m.glow, 'value') as string | null) ?? null,
          noneLabel: t('fx.noGlow'),
          onPick: (c) => {
            if (c) last.glow = c
            app.run(setMark(m.glow, c ? { value: c } : null))
          },
        }),
        h('hr', { class: 'fp-pop__sep' }),
        popItem(t('fx.clear'), () => app.run(applyMarks([{ type: 'outline', attrs: null }, { type: 'shadow', attrs: null }, { type: 'glow', attrs: null }])), { 'data-fx': 'clear' }),
      )
      return list
    },
  })
}

/** Onglet Insertion → Texte décoratif. */
export function decorativeText(app: FolioApp): Ctl {
  return dropdown({ id: 'insert-decorative', label: t('rb.decorativeText'), icon: I.decorativeText, text: () => t('rb.decorativeText'), menu: () => decorativeGrid(app) })
}

/** Onglet Insertion → Lettrine : aucune, ou la première lettre sur 2 à 5 lignes. */
export function dropCap(app: FolioApp): Ctl {
  return dropdown({
    id: 'insert-dropcap',
    label: t('rb.dropCap'),
    icon: I.dropCap,
    text: () => t('rb.dropCap'),
    menu: () => {
      const cur = (paraAttr(app.state, 'dropCap') as number | null) ?? 0
      const list = h('div', { class: 'fp-pop__list', role: 'menu' })
      list.append(popItem(t('dc.none'), () => app.run(setParaAttrs({ dropCap: null })), { 'data-dropcap': '0', role: 'menuitemradio', 'aria-checked': String(!cur) }))
      for (const n of [2, 3, 4, 5]) list.append(popItem(t('dc.lines', { n }), () => app.run(setParaAttrs({ dropCap: n })), { 'data-dropcap': String(n), role: 'menuitemradio', 'aria-checked': String(cur === n) }))
      return list
    },
  })
}

export { button }
