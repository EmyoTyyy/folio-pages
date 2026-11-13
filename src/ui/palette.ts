// Palettes de couleurs : couleurs du thème (elles suivent le thème quand il
// change), couleurs standard, couleur personnalisée ; surligneurs.

import { HIGHLIGHT_VALUES, parseColor } from '../format/color'
import { HIGHLIGHTS, THEME_COLORS, type Theme } from '../format/types'
import { t } from '../i18n/i18n'
import type { Key } from '../i18n/dict'
import { h } from './dom'
import { closePopovers } from './popover'

const STANDARD = ['#c00000', '#e03131', '#f08c00', '#f5c518', '#2f9e44', '#0c8599', '#1971c2', '#1c2d5a', '#7048e8', '#000000', '#595959', '#bfbfbf', '#ffffff']

const RECENT_KEY = 'folio-pages:recent-colors'

function recent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string' && parseColor(c, false) !== null).slice(0, 8) : []
  } catch {
    return []
  }
}

function remember(c: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([c, ...recent().filter((x) => x !== c)].slice(0, 8)))
  } catch {
    /* rien */
  }
}

function swatch(value: string, css: string, label: string, current: string | null, pick: (c: string) => void): HTMLButtonElement {
  const b = h('button', {
    type: 'button',
    class: 'fp-swatch' + (current === value ? ' is-current' : ''),
    'data-pop-item': '',
    'data-color': value,
    title: label,
    'aria-label': label,
    style: `--swatch:${css}`,
  }) as HTMLButtonElement
  b.addEventListener('click', () => {
    closePopovers()
    pick(value)
  })
  return b
}

export interface PaletteOptions {
  theme: Theme
  current: string | null
  /** Libellé du choix « aucune couleur » (Automatique, Aucune…). */
  noneLabel: string
  onPick: (color: string | null) => void
}

export function colorPalette(o: PaletteOptions): HTMLElement {
  const pick = (c: string) => {
    if (c.startsWith('#')) remember(c)
    o.onPick(c)
  }
  const none = h('button', { type: 'button', class: 'fp-pop__item fp-palette__none', 'data-pop-item': '', 'data-color': '' }, o.noneLabel) as HTMLButtonElement
  none.addEventListener('click', () => {
    closePopovers()
    o.onPick(null)
  })
  const themeRow = h(
    'div',
    { class: 'fp-palette__row' },
    ...THEME_COLORS.map((c) => swatch(c, o.theme.colors[c], t(`color.${c}` as Key), o.current, pick)),
  )
  const stdRow = h('div', { class: 'fp-palette__row' }, ...STANDARD.map((c) => swatch(c, c, c, o.current, pick)))
  const rec = recent()
  const custom = h('input', { type: 'color', class: 'fp-palette__custom', 'aria-label': t('color.custom'), value: o.current?.startsWith('#') ? o.current : '#1e6b55' }) as HTMLInputElement
  custom.addEventListener('change', () => {
    closePopovers()
    pick(custom.value.toLowerCase())
  })
  return h(
    'div',
    { class: 'fp-palette' },
    none,
    h('div', { class: 'fp-palette__label' }, t('color.themeColors')),
    themeRow,
    h('div', { class: 'fp-palette__label' }, t('color.standard')),
    stdRow,
    rec.length ? h('div', { class: 'fp-palette__label' }, t('color.recent')) : null,
    rec.length ? h('div', { class: 'fp-palette__row' }, ...rec.map((c) => swatch(c, c, c, o.current, pick))) : null,
    h('label', { class: 'fp-palette__more' }, custom, t('color.custom')),
  )
}

export function highlightPalette(current: string | null, onPick: (c: string | null) => void): HTMLElement {
  const none = h('button', { type: 'button', class: 'fp-pop__item fp-palette__none', 'data-pop-item': '', 'data-color': '' }, t('color.noHighlight')) as HTMLButtonElement
  none.addEventListener('click', () => {
    closePopovers()
    onPick(null)
  })
  return h(
    'div',
    { class: 'fp-palette' },
    none,
    h('div', { class: 'fp-palette__row' }, ...HIGHLIGHTS.map((c) => swatch(c, HIGHLIGHT_VALUES[c], t(`highlight.${c}` as Key), current, onPick))),
  )
}
