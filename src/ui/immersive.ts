// Affichage → Lecteur immersif : le texte du document dans une colonne, sans
// pages ni outils, avec des réglages de lecture : largeur de colonne, couleur
// de page, focus sur une à cinq lignes, espacement du texte, lecture à voix
// haute (voix de l'appareil seulement). Rien n'y est modifiable ; Échap ferme.
//
// Le contenu est une copie de l'éditeur (mêmes styles du document), nettoyée
// de ce qui sert à la mise en page et à l'édition.

import type { FolioApp } from '../app'
import { settings, updateSettings } from '../settings'
import type { Key } from '../i18n/dict'
import { t } from '../i18n/i18n'
import { toast } from './dialog'
import { h, icon } from './dom'
import { ICONS, RIBBON_ICONS as I } from './icons'
import { openExternal } from './panels'
import { localVoice } from './speech'

export const IMM_WIDTHS = ['narrow', 'moderate', 'wide', 'full'] as const
export const IMM_COLORS = ['none', 'sepia', 'soft', 'inverse'] as const
export const IMM_FOCUS = [0, 1, 3, 5] as const
type Width = (typeof IMM_WIDTHS)[number]
type Color = (typeof IMM_COLORS)[number]

/** Ce qui ne se lit pas : mise en page, poignées, marques invisibles, boutons. */
const STRIP =
  '.fp-spacer, .fp-figure__reflect, .fp-ink-layer, .fp-gap-mask, .ProseMirror-gapcursor, .ProseMirror-separator, .ProseMirror-trailingBreak, .fp-figure__handle, .fp-figure__placeholder, .fp-cropper, .fp-page-break, .fp-section-break, .fp-column-break, .fp-xe, .fp-bookmark, .fp-spacer__label, .fp-toc__empty, button:not(.fp-note__num), [data-folio-transient]'

let open: { close: () => void } | null = null

export const isImmersive = (): boolean => open !== null

const pick = <T extends readonly (string | number)[]>(list: T, v: unknown, def: T[number]): T[number] => ((list as readonly unknown[]).includes(v) ? (v as T[number]) : def)

/** La copie lisible du document. */
function readableCopy(app: FolioApp): HTMLElement {
  const copy = app.view.dom.cloneNode(true) as HTMLElement
  for (const el of Array.from(copy.querySelectorAll(STRIP))) el.remove()
  for (const el of [copy, ...Array.from(copy.querySelectorAll<HTMLElement>('*'))]) {
    el.removeAttribute('contenteditable')
    el.removeAttribute('id')
    el.removeAttribute('draggable')
    el.classList.remove('ProseMirror-selectednode', 'fp-current', 'is-selected')
  }
  copy.classList.remove('ProseMirror', 'ProseMirror-focused')
  copy.classList.add('fp-immersive__text')
  copy.removeAttribute('role')
  copy.removeAttribute('aria-label')
  copy.removeAttribute('spellcheck')
  copy.removeAttribute('translate')
  copy.removeAttribute('style')
  return copy
}

/** Paragraphes lisibles à voix haute, dans l'ordre. */
const readableBlocks = (text: HTMLElement): HTMLElement[] =>
  Array.from(text.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, li, blockquote > p, figcaption, td, th')).filter((el) => !el.querySelector('p, li') && (el.textContent ?? '').trim())

export function openImmersive(app: FolioApp): void {
  if (open) return
  const s = settings()
  let width: Width = pick(IMM_WIDTHS, s.immWidth, 'moderate')
  let color: Color = pick(IMM_COLORS, s.immColor, 'none')
  let focus = pick(IMM_FOCUS, s.immFocus, 0) as number
  let spacing = !!s.immSpacing

  const text = readableCopy(app)
  const column = h('div', { class: 'fp-immersive__column' }, text)
  const scroller = h('div', { class: 'fp-immersive__scroll', tabindex: '0', 'aria-label': t('imm.content') }, column)
  const veilTop = h('div', { class: 'fp-immersive__veil fp-immersive__veil--top', 'aria-hidden': 'true' })
  const veilBottom = h('div', { class: 'fp-immersive__veil fp-immersive__veil--bottom', 'aria-hidden': 'true' })

  // --- barre d'outils : un groupe de choix par réglage
  const group = <T extends string | number>(name: string, label: string, values: readonly T[], get: () => T, set: (v: T) => void, text: (v: T) => string) => {
    const buttons = values.map((v) => {
      const b = h('button', { type: 'button', class: 'fp-immersive__opt', 'data-imm': name, 'data-value': String(v) }, text(v)) as HTMLButtonElement
      b.addEventListener('click', () => {
        set(v)
        apply()
      })
      return b
    })
    const sync = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(values[i] === get())))
    return { el: h('div', { class: 'fp-immersive__group', role: 'group', 'aria-label': label }, h('span', { class: 'fp-immersive__label' }, label), ...buttons), sync }
  }
  const groups = [
    group('width', t('imm.width'), IMM_WIDTHS, () => width, (v) => (width = v), (v) => t(`imm.width.${v}` as Key)),
    group('color', t('imm.color'), IMM_COLORS, () => color, (v) => (color = v), (v) => t(`imm.color.${v}` as Key)),
    group('focus', t('imm.focus'), IMM_FOCUS, () => focus as (typeof IMM_FOCUS)[number], (v) => (focus = v), (v) => (v ? t('imm.focusN', { n: v }) : t('imm.off'))),
  ]
  const spacingBtn = h('button', { type: 'button', class: 'fp-immersive__opt fp-immersive__toggle', 'data-imm': 'spacing' }, t('imm.spacing')) as HTMLButtonElement
  spacingBtn.addEventListener('click', () => {
    spacing = !spacing
    apply()
  })
  const speakBtn = h('button', { type: 'button', class: 'fp-btn fp-immersive__speak', 'data-imm': 'speak' }, icon(I.readAloud), h('span', {}, t('rb.readAloud'))) as HTMLButtonElement
  const closeBtn = h('button', { type: 'button', class: 'fp-iconbtn fp-immersive__close', 'data-imm': 'close', 'aria-label': t('imm.close'), title: t('imm.close') }, icon(ICONS.close))
  const bar = h(
    'div',
    { class: 'fp-immersive__bar', role: 'toolbar', 'aria-label': t('rb.immersiveReader') },
    h('strong', { class: 'fp-immersive__title' }, t('rb.immersiveReader')),
    ...groups.map((g) => g.el),
    h('div', { class: 'fp-immersive__group' }, spacingBtn),
    h('span', { class: 'fp-immersive__spacer' }),
    speakBtn,
    closeBtn,
  )
  const root = h('div', { class: 'fp-immersive', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('rb.immersiveReader'), 'data-immersive': '' }, bar, scroller, veilTop, veilBottom)

  /** Focus de ligne : deux voiles laissent voir `focus` lignes au milieu de l'écran. */
  const lineHeight = () => {
    const p = text.querySelector('p') ?? text
    const lh = parseFloat(getComputedStyle(p).lineHeight)
    return Number.isFinite(lh) ? lh : parseFloat(getComputedStyle(p).fontSize) * 1.5
  }
  const placeVeils = () => {
    const on = focus > 0
    veilTop.hidden = veilBottom.hidden = !on
    root.classList.toggle('has-focus', on)
    if (!on) return
    const r = scroller.getBoundingClientRect()
    const band = lineHeight() * focus
    const top = r.top + Math.max(0, (r.height - band) / 2)
    veilTop.style.top = `${r.top}px`
    veilTop.style.height = `${top - r.top}px`
    veilBottom.style.top = `${top + band}px`
    veilBottom.style.height = `${Math.max(0, r.bottom - top - band)}px`
    // Le texte peut monter jusque dans la bande, au début comme à la fin.
    column.style.paddingTop = `${top - r.top}px`
    column.style.paddingBottom = `${r.bottom - top - band}px`
  }

  function apply(): void {
    root.dataset.width = width
    root.dataset.color = color
    root.classList.toggle('is-spaced', spacing)
    spacingBtn.setAttribute('aria-pressed', String(spacing))
    for (const g of groups) g.sync()
    if (!focus) column.style.paddingTop = column.style.paddingBottom = ''
    placeVeils()
    updateSettings({ immWidth: width, immColor: color, immFocus: focus, immSpacing: spacing })
  }

  // --- lecture à voix haute : paragraphe après paragraphe, celui qui est lu est surligné
  let speaking = false
  const stopSpeaking = () => {
    speaking = false
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    text.querySelector('.is-spoken')?.classList.remove('is-spoken')
    speakBtn.classList.remove('is-active')
    speakBtn.setAttribute('aria-pressed', 'false')
  }
  const speakFrom = (start: number) => {
    const voice = localVoice((app.state.doc.attrs.lang as string) || document.documentElement.lang || 'fr')
    if (!voice) {
      toast(t('rb.noVoice'), { kind: 'info' })
      return
    }
    const blocks = readableBlocks(text)
    speaking = true
    speakBtn.classList.add('is-active')
    speakBtn.setAttribute('aria-pressed', 'true')
    const next = (i: number) => {
      text.querySelector('.is-spoken')?.classList.remove('is-spoken')
      if (!speaking || i >= blocks.length) return stopSpeaking()
      const el = blocks[i]
      el.classList.add('is-spoken')
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      const u = new SpeechSynthesisUtterance((el.textContent ?? '').slice(0, 20_000))
      u.voice = voice
      u.lang = voice.lang
      u.onend = () => next(i + 1)
      u.onerror = () => stopSpeaking()
      speechSynthesis.speak(u)
    }
    speechSynthesis.cancel()
    next(start)
  }
  speakBtn.addEventListener('click', () => {
    if (speaking) return stopSpeaking()
    // Depuis le premier paragraphe visible.
    const r = scroller.getBoundingClientRect()
    const blocks = readableBlocks(text)
    const first = Math.max(0, blocks.findIndex((b) => b.getBoundingClientRect().bottom > r.top + 8))
    speakFrom(first)
  })

  // --- liens : jamais de navigation dans cette page
  text.addEventListener('click', (e) => {
    const a = (e.target as Element).closest('a[href]') as HTMLAnchorElement | null
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href') ?? ''
    if (/^https?:|^mailto:|^tel:/i.test(href)) openExternal(href)
  })

  // --- clavier : Échap ferme ; flèches et Page : ligne par ligne avec le focus de ligne
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (focus && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !(e.target as Element).closest?.('button')) {
      e.preventDefault()
      scroller.scrollBy({ top: (e.key === 'ArrowDown' ? 1 : -1) * lineHeight() })
    }
  }
  const onResize = () => placeVeils()

  function close(): void {
    stopSpeaking()
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', onResize)
    root.remove()
    open = null
    app.notifyUi()
    app.focus()
  }

  closeBtn.addEventListener('click', close)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', onResize)
  document.body.append(root)
  open = { close }
  apply()
  // À l'endroit du curseur : le paragraphe correspondant de la copie, s'il se retrouve.
  scroller.focus({ preventScroll: true })
  app.notifyUi()
}

export function closeImmersive(): void {
  open?.close()
}
