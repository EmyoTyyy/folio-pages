// Onglet Format de l'image : corrections (luminosité, contraste), couleur
// (saturation, recoloration), effets artistiques, transparence, effets
// (ombre, halo, bords adoucis, reflet). Chaque choix montre un aperçu de l'image.

import type { FolioApp } from '../app'
import { selectedShapes, updateShapes } from '../editor/shapes'
import { figureAt, setFigureAttrs } from '../editor/tables'
import { parseColor } from '../format/color'
import { adjustCss, cleanAdjust, cssText, REFLECTION_MASK } from '../format/picture'
import type { PictureAdjust } from '../format/types'
import type { Key } from '../i18n/dict'
import { t } from '../i18n/i18n'
import { h } from './dom'
import { RIBBON_ICONS as I } from './icons'
import { colorPalette } from './palette'
import { popItem } from './popover'
import * as P from './panels'
import { dropdown, type Ctl } from './ribbon'

interface PictureTarget {
  src: string
  adjust: PictureAdjust | null
  set: (a: PictureAdjust | null) => void
}

/** L'image à retoucher : l'image du texte sélectionnée, sinon les images libres sélectionnées. */
export function pictureTarget(app: FolioApp): PictureTarget | null {
  const f = figureAt(app.state)
  if (f) return { src: (f.node.attrs.src as string) ?? '', adjust: (f.node.attrs.adjust as PictureAdjust | null) ?? null, set: (a) => app.run(setFigureAttrs({ adjust: a })) }
  const pics = selectedShapes(app.view.state).filter((r) => r.data.shape === 'picture')
  if (!pics.length) return null
  return {
    src: pics[0].data.src ?? '',
    adjust: pics[0].data.adjust ?? null,
    set: (a) =>
      updateShapes(app.view, pics, (d) => {
        const out = { ...d }
        if (a) out.adjust = a
        else delete out.adjust
        return out
      }),
  }
}

const current = (app: FolioApp): PictureAdjust => ({ ...(pictureTarget(app)?.adjust ?? {}) })

/** Change des retouches de l'image sélectionnée (undefined : retirée). */
export function adjust(app: FolioApp, patch: Partial<Record<keyof PictureAdjust, unknown>>): void {
  const next: Record<string, unknown> = { ...current(app) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) delete next[k]
    else next[k] = v
  }
  pictureTarget(app)?.set(cleanAdjust(next, (c) => parseColor(c)))
}

/** Aperçu : l'image sélectionnée, avec ces retouches. */
function preview(app: FolioApp, a: PictureAdjust, label: string, data: Record<string, string>, onPick: () => void, selected: boolean): HTMLElement {
  const src = pictureTarget(app)?.src ?? ''
  const img = h('img', { src, alt: '', class: 'fp-pfx__img', style: cssText(adjustCss(a, (c) => P.cssOf(app, c) ?? c)) })
  return popItem(h('span', { class: 'fp-pfx__cell' }, h('span', { class: 'fp-pfx__frame' }, img), h('span', { class: 'fp-pfx__label' }, label)), onPick, {
    ...data,
    title: label,
    role: 'menuitemradio',
    'aria-checked': String(selected),
  })
}

/** Aperçu d'un reflet : l'image en petit, et sa copie retournée coupée à `pct` %. */
function reflectionPreview(app: FolioApp, cur: PictureAdjust, pct: number, label: string, selected: boolean): HTMLElement {
  const src = pictureTarget(app)?.src ?? ''
  const style = cssText(adjustCss({ ...cur, reflection: undefined }, (c) => P.cssOf(app, c) ?? c))
  const shown = h('img', { src, alt: '', class: 'fp-pfx__img fp-pfx__img--small', style })
  const parts: HTMLElement[] = [shown]
  if (pct) {
    const mirror = h('img', { src, alt: '', class: 'fp-pfx__img fp-pfx__img--small fp-pfx__mirror', style })
    parts.push(h('span', { class: 'fp-pfx__reflect', style: `height:${Math.round((30 * pct) / 100)}px;mask-image:${REFLECTION_MASK};-webkit-mask-image:${REFLECTION_MASK}` }, mirror))
  }
  return popItem(h('span', { class: 'fp-pfx__cell' }, h('span', { class: 'fp-pfx__frame fp-pfx__frame--stack' }, ...parts), h('span', { class: 'fp-pfx__label' }, label)), () => adjust(app, { reflection: pct || undefined }), {
    'data-reflection': String(pct),
    title: label,
    role: 'menuitemradio',
    'aria-checked': String(selected),
  })
}

const grid = (cols: number, ...items: HTMLElement[]) => h('div', { class: 'fp-pfx__grid', style: `grid-template-columns:repeat(${cols}, 84px)`, role: 'menu' }, ...items)
const heading = (text: string) => h('div', { class: 'fp-pop__heading' }, text)
const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)} %`

export function corrections(app: FolioApp): Ctl {
  return dropdown({
    id: 'corrections',
    label: t('rb.corrections'),
    icon: I.corrections,
    large: true,
    menu: () => {
      const cur = current(app)
      const cells: HTMLElement[] = []
      for (const contrast of [-40, -20, 0, 20, 40]) {
        for (const brightness of [-40, -20, 0, 20, 40]) {
          const label = t('pfx.bc', { b: pct(brightness), c: pct(contrast) })
          cells.push(preview(app, { ...cur, brightness, contrast }, label, { 'data-correction': `${brightness}/${contrast}` }, () => adjust(app, { brightness, contrast }), (cur.brightness ?? 0) === brightness && (cur.contrast ?? 0) === contrast))
        }
      }
      return h('div', { class: 'fp-pop__list' }, heading(t('pfx.brightnessContrast')), grid(5, ...cells), h('hr', { class: 'fp-pop__sep' }), popItem(t('pfx.reset'), () => pictureTarget(app)?.set(null), { 'data-correction': 'reset' }))
    },
  })
}

export function pictureColor(app: FolioApp): Ctl {
  return dropdown({
    id: 'picture-color',
    label: t('rb.pictureColor'),
    icon: I.pictureColor,
    text: () => t('rb.pictureColor'),
    menu: () => {
      const cur = current(app)
      const sat = [0, 33, 66, 100, 200, 300, 400].map((s) => preview(app, { ...cur, saturation: s }, t('pfx.saturation', { n: s }), { 'data-saturation': String(s) }, () => adjust(app, { saturation: s === 100 ? undefined : s }), (cur.saturation ?? 100) === s))
      const re = ([undefined, 'grayscale', 'sepia', 'washout', 'blackwhite'] as const).map((r) =>
        preview(app, { ...cur, recolor: r }, t(`pfx.recolor.${r ?? 'none'}` as Key), { 'data-recolor': r ?? 'none' }, () => adjust(app, { recolor: r }), cur.recolor === r),
      )
      return h('div', { class: 'fp-pop__list' }, heading(t('pfx.saturationTitle')), grid(7, ...sat), heading(t('pfx.recolorTitle')), grid(5, ...re))
    },
  })
}

export function artistic(app: FolioApp): Ctl {
  return dropdown({
    id: 'artistic',
    label: t('rb.artistic'),
    icon: I.artistic,
    text: () => t('rb.artistic'),
    menu: () => {
      const cur = current(app)
      return grid(
        4,
        ...([undefined, 'blur', 'pencil', 'negative'] as const).map((a) => preview(app, { ...cur, artistic: a }, t(`pfx.artistic.${a ?? 'none'}` as Key), { 'data-artistic': a ?? 'none' }, () => adjust(app, { artistic: a }), cur.artistic === a)),
      )
    },
  })
}

export function transparency(app: FolioApp): Ctl {
  return dropdown({
    id: 'transparency',
    label: t('rb.transparency'),
    icon: I.transparency,
    text: () => t('rb.transparency'),
    menu: () => {
      const cur = current(app)
      return grid(
        4,
        ...[0, 15, 30, 50, 65, 80, 95].map((n) => preview(app, { ...cur, transparency: n }, t('pfx.transparencyN', { n }), { 'data-transparency': String(n) }, () => adjust(app, { transparency: n || undefined }), (cur.transparency ?? 0) === n)),
      )
    },
  })
}

export function pictureEffects(app: FolioApp): Ctl {
  return dropdown({
    id: 'picture-effects',
    label: t('rb.pictureEffects'),
    icon: I.pictureEffects,
    text: () => t('rb.pictureEffects'),
    menu: () => {
      const cur = current(app)
      const shadow = popItem(t('pfx.shadow'), () => adjust(app, { shadow: cur.shadow ? undefined : true }), { 'data-pfx': 'shadow', role: 'menuitemcheckbox', 'aria-checked': String(!!cur.shadow) })
      const soft = grid(
        6,
        ...[0, 2.5, 5, 10, 25, 50].map((n) => preview(app, { ...cur, softEdges: n }, n ? t('pfx.softN', { n: String(n).replace('.', t('number.decimal')) }) : t('pfx.softNone'), { 'data-soft': String(n) }, () => adjust(app, { softEdges: n ? Math.round(n) || 3 : undefined }), (cur.softEdges ?? 0) === (n ? Math.round(n) || 3 : 0))),
      )
      return h(
        'div',
        { class: 'fp-pop__list' },
        shadow,
        heading(t('pfx.glow')),
        colorPalette({ theme: app.theme, current: cur.glow ?? null, noneLabel: t('fx.noGlow'), onPick: (c) => adjust(app, { glow: c ?? undefined }) }),
        heading(t('pfx.softEdges')),
        soft,
        heading(t('pfx.reflection')),
        grid(4, ...([0, 33, 50, 100] as const).map((n) => reflectionPreview(app, cur, n, t(`pfx.reflection${n}` as Key), (cur.reflection ?? 0) === n))),
        h('hr', { class: 'fp-pop__sep' }),
        popItem(t('pfx.clearEffects'), () => adjust(app, { shadow: undefined, glow: undefined, softEdges: undefined, reflection: undefined }), { 'data-pfx': 'clear' }),
      )
    },
  })
}
