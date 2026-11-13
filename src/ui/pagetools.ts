// Réglages de la page et du document (onglets Création et Mise en page) :
// filigrane, césure, « Définir par défaut » (thème, styles et mise en page des
// nouveaux documents).

import type { FolioApp } from '../app'
import { defaultWatermark, type Watermark } from '../format/types'
import type { Key } from '../i18n/dict'
import { lang, t } from '../i18n/i18n'
import { settings, updateSettings } from '../settings'
import { openDialog, toast } from './dialog'
import { h } from './dom'
import { RIBBON_ICONS as I } from './icons'
import { colorPalette } from './palette'
import { popItem } from './popover'
import * as P from './panels'
import { button, dropdown, type Ctl } from './ribbon'

/** Change un réglage du document, en une étape annulable. */
export function setDocAttr(app: FolioApp, key: string, value: unknown): void {
  app.view.dispatch(app.state.tr.setDocAttribute(key, value))
  app.focus()
}

// --- césure ---------------------------------------------------------------------

export function hyphenation(app: FolioApp): Ctl {
  return dropdown({
    id: 'hyphenation',
    label: t('rb.hyphenation'),
    icon: I.hyphenation,
    text: () => t('rb.hyphenation'),
    menu: () => {
      const on = !!app.state.doc.attrs.hyphenate
      return h(
        'div',
        { class: 'fp-pop__list', role: 'menu' },
        popItem(t('hy.none'), () => setDocAttr(app, 'hyphenate', false), { 'data-hyphenation': 'none', role: 'menuitemradio', 'aria-checked': String(!on) }),
        popItem(t('hy.auto'), () => setDocAttr(app, 'hyphenate', true), { 'data-hyphenation': 'auto', role: 'menuitemradio', 'aria-checked': String(on) }),
        h('hr', { class: 'fp-pop__sep' }),
        popItem(h('span', {}, h('span', { class: 'fp-pop__main' }, t('hy.soft')), h('span', { class: 'fp-pop__hint' }, t('hy.softHint'))), () => insertSoftHyphen(app), { 'data-hyphenation': 'soft' }),
      )
    },
  })
}

/** Trait d'union conditionnel : visible seulement si le mot est coupé à cet endroit. */
export function insertSoftHyphen(app: FolioApp): void {
  app.view.dispatch(app.state.tr.insertText('­').scrollIntoView())
  app.focus()
}

// --- filigrane ---------------------------------------------------------------------

const PRESETS: Record<'fr' | 'en', string[]> = {
  fr: ['CONFIDENTIEL', 'NE PAS COPIER', 'BROUILLON', 'EXEMPLE', 'URGENT', 'PROJET'],
  en: ['CONFIDENTIAL', 'DO NOT COPY', 'DRAFT', 'SAMPLE', 'URGENT', 'ASAP'],
}
const presets = () => PRESETS[lang().startsWith('fr') ? 'fr' : 'en']

/** Filigrane du document (image en données), ou null. */
const currentWatermark = (app: FolioApp) => app.state.doc.attrs.watermark as Watermark | null

function thumb(text: string, diagonal: boolean): HTMLElement {
  return h('span', { class: 'fp-wm-thumb', 'aria-hidden': 'true' }, h('span', { class: 'fp-wm-thumb__text' + (diagonal ? ' is-diagonal' : '') }, text))
}

export function watermark(app: FolioApp): Ctl {
  return dropdown({
    id: 'watermark',
    label: t('rb.watermark'),
    icon: I.watermark,
    large: true,
    menu: () => {
      const cur = currentWatermark(app)
      const grid = h('div', { class: 'fp-wm-grid', role: 'menu' })
      for (const text of presets()) {
        for (const diagonal of [true, false]) {
          grid.append(
            popItem(h('span', { class: 'fp-wm-item' }, thumb(text, diagonal), h('span', { class: 'fp-wm-item__label' }, `${text}${diagonal ? '' : ` (${t('wm.horizontalShort')})`}`)), () => setDocAttr(app, 'watermark', { ...defaultWatermark(), text, diagonal }), {
              'data-watermark': `${text}${diagonal ? '' : '-h'}`,
              role: 'menuitemradio',
              'aria-checked': String(!!cur && cur.text === text && cur.diagonal === diagonal),
            }),
          )
        }
      }
      return h(
        'div',
        { class: 'fp-pop__list' },
        grid,
        h('hr', { class: 'fp-pop__sep' }),
        popItem(t('wm.custom'), () => watermarkDialog(app), { 'data-watermark': 'custom' }),
        popItem(t('wm.remove'), () => setDocAttr(app, 'watermark', null), { 'data-watermark': 'remove', ...(cur ? {} : { disabled: '' }) }),
      )
    },
  })
}

/** Fenêtre « Filigrane personnalisé » : aucun, image (taille, délavée) ou texte (taille, couleur, disposition, transparence). */
export function watermarkDialog(app: FolioApp): void {
  const cur = currentWatermark(app) ?? defaultWatermark()
  let image = cur.image ?? ''
  let color = cur.color
  const kind = h('div', { class: 'fp-wm-kinds', role: 'radiogroup' })
  const radio = (v: 'none' | 'image' | 'text') => {
    const input = h('input', { type: 'radio', name: 'wm-kind', value: v, 'data-field': `wm-kind-${v}` }) as HTMLInputElement
    input.checked = v === (currentWatermark(app) ? (cur.image ? 'image' : 'text') : 'none')
    kind.append(h('label', { class: 'fp-check' }, input, h('span', {}, t(`wm.kind.${v}` as Key))))
    return input
  }
  const rNone = radio('none')
  const rImage = radio('image')
  const rText = radio('text')
  // Image
  const pick = h('button', { type: 'button', class: 'fp-btn', 'data-wm-pick': '' }, t('wm.pickImage'))
  const preview = h('img', { class: 'fp-wm-preview', alt: '', ...(image ? { src: image } : { hidden: '' }) }) as HTMLImageElement
  const scale = h('input', { type: 'range', min: '10', max: '100', step: '5', value: String(cur.scale), 'data-field': 'wm-scale', 'aria-label': t('wm.scale') }) as HTMLInputElement
  const washout = h('input', { type: 'checkbox', 'data-field': 'wm-washout' }) as HTMLInputElement
  washout.checked = !!cur.image && cur.opacity < 100
  pick.addEventListener('click', () => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml', style: 'display:none' }) as HTMLInputElement
    input.addEventListener('change', async () => {
      const f = input.files?.[0]
      if (!f) return
      if (f.size > 8_000_000) return void toast(t('image.tooLarge'), { kind: 'error' })
      image = await new Promise<string>((res) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.readAsDataURL(f)
      })
      preview.src = image
      preview.hidden = false
      rImage.checked = true
      sync()
    })
    document.body.append(input)
    input.click()
    input.remove()
  })
  const imagePart = h('fieldset', { class: 'fp-wm-part', 'data-part': 'image' }, h('div', { class: 'fp-wm-row' }, pick, preview), h('label', { class: 'fp-form__row' }, h('span', { class: 'fp-label' }, t('wm.scale')), scale), h('label', { class: 'fp-check' }, washout, h('span', {}, t('wm.washout'))))
  // Texte
  const text = h('input', { type: 'text', class: 'fp-input', list: 'fp-wm-presets', maxlength: '60', value: cur.text ?? presets()[0], 'data-field': 'wm-text' }) as HTMLInputElement
  const datalist = h('datalist', { id: 'fp-wm-presets' }, ...presets().map((p) => h('option', { value: p })))
  const size = h('select', { class: 'fp-input', 'data-field': 'wm-size' }, h('option', { value: '0' }, t('wm.auto')), ...[36, 48, 60, 72, 96, 120, 144].map((n) => h('option', { value: String(n) }, String(n)))) as HTMLSelectElement
  size.value = String(cur.size)
  const swatch = h('button', { type: 'button', class: 'fp-btn fp-wm-color', 'data-wm-color': '' })
  const paint = () => {
    swatch.textContent = ''
    swatch.append(h('span', { class: 'fp-wm-swatch', style: `background:${P.cssOf(app, color)}` }), t('wm.color'))
  }
  paint()
  const palette = h('div', { class: 'fp-wm-palette', hidden: '' })
  palette.append(
    colorPalette({
      theme: app.theme,
      current: color,
      noneLabel: t('wm.grey'),
      onPick: (c) => {
        color = c ?? defaultWatermark().color
        paint()
        palette.hidden = true
      },
    }),
  )
  swatch.addEventListener('click', () => (palette.hidden = !palette.hidden))
  const diagonal = h('input', { type: 'radio', name: 'wm-layout', 'data-field': 'wm-diagonal' }) as HTMLInputElement
  const horizontal = h('input', { type: 'radio', name: 'wm-layout', 'data-field': 'wm-horizontal' }) as HTMLInputElement
  diagonal.checked = cur.diagonal
  horizontal.checked = !cur.diagonal
  const opacity = h('input', { type: 'range', min: '5', max: '100', step: '5', value: String(cur.image ? 35 : cur.opacity), 'data-field': 'wm-opacity', 'aria-label': t('wm.opacity') }) as HTMLInputElement
  const textPart = h(
    'fieldset',
    { class: 'fp-wm-part', 'data-part': 'text' },
    h('label', { class: 'fp-form__row' }, h('span', { class: 'fp-label' }, t('wm.text')), text),
    datalist,
    h('label', { class: 'fp-form__row' }, h('span', { class: 'fp-label' }, t('wm.size')), size),
    h('div', { class: 'fp-form__row' }, h('span', { class: 'fp-label' }, t('wm.colorLabel')), h('div', {}, swatch, palette)),
    h('div', { class: 'fp-form__row' }, h('span', { class: 'fp-label' }, t('wm.layout')), h('div', { class: 'fp-wm-kinds' }, h('label', { class: 'fp-check' }, diagonal, h('span', {}, t('wm.diagonal'))), h('label', { class: 'fp-check' }, horizontal, h('span', {}, t('wm.horizontal'))))),
    h('label', { class: 'fp-form__row' }, h('span', { class: 'fp-label' }, t('wm.opacity')), opacity),
  )
  const sync = () => {
    imagePart.disabled = !rImage.checked
    textPart.disabled = !rText.checked
  }
  for (const r of [rNone, rImage, rText]) r.addEventListener('change', sync)
  sync()
  openDialog({
    name: 'watermark',
    title: t('wm.title'),
    body: [kind, imagePart, textPart],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          if (rNone.checked) return void setDocAttr(app, 'watermark', null)
          if (rImage.checked) {
            if (!image) return false
            return void setDocAttr(app, 'watermark', { ...defaultWatermark(), image, diagonal: false, scale: Number(scale.value), opacity: washout.checked ? 35 : 100 })
          }
          const value = text.value.replace(/\s+/g, ' ').trim().slice(0, 60)
          if (!value) return false
          setDocAttr(app, 'watermark', { ...defaultWatermark(), text: value, color, diagonal: diagonal.checked, size: Number(size.value), opacity: Number(opacity.value) })
        },
      },
    ],
  })
}

// --- définir par défaut ------------------------------------------------------------

/** Ce que « Définir par défaut » garde pour les nouveaux documents. */
export interface DefaultDesign {
  theme: unknown
  styles: unknown
  page: unknown
}

export function setAsDefault(app: FolioApp): Ctl {
  return button({
    id: 'set-default',
    label: t('rb.setDefault'),
    icon: I.setDefault,
    text: true,
    run: () =>
      void openDialog({
        name: 'set-default',
        title: t('def.title'),
        body: [h('p', {}, t('def.body')), ...(settings().defaultDesign ? [h('p', { class: 'fp-form__hint' }, t('def.already'))] : [])],
        actions: [
          ...(settings().defaultDesign ? [{ label: t('def.reset'), value: 'reset', run: () => {
                    updateSettings({ defaultDesign: null })
                    toast(t('def.resetDone'), { kind: 'success' })
                  },
                }] : []),
          { label: t('action.cancel'), value: 'cancel' },
          {
            label: t('def.ok'),
            value: 'ok',
            primary: true,
            run: () => {
              const a = app.state.doc.attrs
              updateSettings({ defaultDesign: JSON.parse(JSON.stringify({ theme: a.theme, styles: a.styles, page: a.page })) })
              toast(t('def.done'), { kind: 'success' })
            },
          },
        ],
      }),
  })
}
