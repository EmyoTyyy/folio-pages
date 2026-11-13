// Onglet Insertion : page de garde (quatre modèles), ligne de signature (avec
// une signature tracée à la souris ou au doigt), capture d'écran.

import type { FolioApp } from '../app'
import { Fragment, type Node as PMNode } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import { blocksToPM } from '../editor/convert'
import { insertImageFiles } from '../editor/paste'
import { loadDocument } from '../format/load'
import type { Key } from '../i18n/dict'
import { lang, t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h } from './dom'
import { RIBBON_ICONS as I } from './icons'
import { popItem } from './popover'
import * as P from './panels'
import { dropdown, type Ctl } from './ribbon'

/** Blocs du format (forme compacte) → nœuds de l'éditeur, validés par le chargement tolérant. */
function nodesOf(blocks: unknown[], assets: Record<string, string> = {}): PMNode[] {
  const res = loadDocument({ format: 'folio/doc', version: 1, blocks, assets })
  if (!res.ok) return []
  return blocksToPM(res.doc.blocks, res.doc.assets)
}

// --- page de garde ------------------------------------------------------------------

export const COVERS = ['classic', 'band', 'side', 'minimal'] as const
export type CoverId = (typeof COVERS)[number]

/** Les blocs d'une page de garde : titre, sous-titre (le sujet), auteur, date, puis un saut de page. */
export function coverBlocks(id: CoverId, fr: boolean): unknown[] {
  const date = fr ? '{{date:D MMMM YYYY}}' : '{{date:MMMM D, YYYY}}'
  const title = { type: 'paragraph', style: 'title', md: '{{title}}' }
  switch (id) {
    case 'classic':
      return [
        { md: '{{organization}}', align: 'center', spacing: { before: 60, after: 150 } },
        { ...title, align: 'center' },
        { type: 'paragraph', style: 'subtitle', md: '{{subject}}', align: 'center' },
        { type: 'divider' },
        { md: '**{{author}}**', align: 'center', spacing: { before: 160 } },
        { md: date, align: 'center' },
        { type: 'pagebreak' },
      ]
    case 'band':
      return [
        { text: '', spacing: { before: 120 } },
        { type: 'paragraph', md: '{{title}}', shading: 'accent1', spacing: { before: 0, after: 0 }, line: 1.1 },
        { md: '{{subject}}', shading: 'accent1', spacing: { before: 0, after: 0 } },
        { text: '', spacing: { before: 200 } },
        { md: '**{{author}}**', align: 'right' },
        { md: date, align: 'right' },
        { type: 'pagebreak' },
      ]
    case 'side':
      return [
        { text: '', spacing: { before: 200 } },
        { ...title, indent: { left: 36 }, border: 'accent2' },
        { type: 'paragraph', style: 'subtitle', md: '{{subject}}', indent: { left: 36 } },
        { text: '', spacing: { before: 120 } },
        { md: '{{author}} · {{organization}}', indent: { left: 36 } },
        { md: date, indent: { left: 36 } },
        { type: 'pagebreak' },
      ]
    case 'minimal':
      return [
        { text: '', spacing: { before: 380 } },
        { ...title },
        { md: `{{author}} — ${date}` },
        { type: 'pagebreak' },
      ]
  }
}

/** Le texte de la bande colorée : blanc, en grand (la bande est une trame de paragraphe). */
function bandText(blocks: unknown[]): unknown[] {
  return blocks.map((b, i) => (i === 1 || i === 2 ? { ...(b as object), content: [{ type: 'field', name: i === 1 ? 'title' : 'subject', color: '#ffffff', size: i === 1 ? 30 : 14, font: 'heading', bold: i === 1 || undefined }], md: undefined } : b))
}

export function insertCover(app: FolioApp, id: CoverId): void {
  const fr = ((app.state.doc.attrs.lang as string) || lang()).startsWith('fr')
  let blocks = coverBlocks(id, fr)
  if (id === 'band') blocks = bandText(blocks)
  const nodes = nodesOf(blocks)
  if (!nodes.length) return
  // Toujours au début du document, comme dans les traitements de texte.
  const tr = app.state.tr.insert(0, Fragment.from(nodes))
  tr.setSelection(TextSelection.create(tr.doc, 1)).scrollIntoView()
  app.view.dispatch(tr)
  app.focus()
  if (!app.state.doc.attrs.title) toast(t('cover.hint'), { kind: 'info', timeout: 9000 })
}

const SKETCH: Record<CoverId, string[]> = {
  classic: ['gap', 'center s', 'gap', 'gap', 'center title', 'center sub', 'rule', 'gap', 'center', 'center s'],
  band: ['gap', 'gap', 'band', 'band', 'gap', 'gap', 'right', 'right s'],
  side: ['gap', 'gap', 'gap', 'side title', 'side sub', 'gap', 'side', 'side s'],
  minimal: ['gap', 'gap', 'gap', 'gap', 'gap', 'gap', 'gap', 'title', 'left'],
}

export function coverPage(app: FolioApp): Ctl {
  return dropdown({
    id: 'cover-page',
    label: t('rb.coverPage'),
    icon: I.coverPage,
    text: () => t('rb.coverPage'),
    menu: () => {
      const grid = h('div', { class: 'fp-cover-grid', role: 'menu' })
      for (const id of COVERS) {
        const page = h('span', { class: `fp-cover fp-cover--${id}`, 'aria-hidden': 'true' }, ...SKETCH[id].map((l) => h('i', { class: `fp-cover__l ${l.split(' ').map((c) => `is-${c}`).join(' ')}` })))
        grid.append(popItem(h('span', { class: 'fp-cover-item' }, page, h('span', {}, t(`cover.${id}` as Key))), () => insertCover(app, id), { 'data-cover': id }))
      }
      return h('div', { class: 'fp-pop__list' }, grid, h('p', { class: 'fp-pop__note' }, t('cover.note')))
    },
  })
}

// --- ligne de signature -----------------------------------------------------------

/** Les blocs d'une ligne de signature : la signature tracée (facultative), le trait, le nom, la fonction, l'adresse. */
export function signatureBlocks(o: { name: string; title: string; email: string; date: boolean; image?: string }, fr: boolean): unknown[] {
  const out: unknown[] = []
  if (o.image) out.push({ type: 'image', src: o.image, alt: fr ? `Signature de ${o.name || 'signataire'}` : `Signature of ${o.name || 'signer'}`, width: 160, align: 'left' })
  out.push({ text: `X ${'_'.repeat(34)}`, spacing: { before: o.image ? 0 : 30, after: 2 } })
  if (o.name) out.push({ content: [{ text: o.name, bold: true }], spacing: { after: 0 } })
  if (o.title) out.push({ text: o.title, spacing: { after: 0 } })
  if (o.email) out.push({ text: o.email, spacing: { after: 0 } })
  if (o.date) out.push({ md: fr ? 'Le {{date:DD/MM/YYYY}}' : '{{date:MM/DD/YYYY}}', spacing: { after: 0 } })
  return out
}

/** Zone où l'on signe à la souris, au stylet ou au doigt ; renvoie l'image (PNG transparent) ou null si vide. */
function signaturePad(): { el: HTMLElement; image: () => string | null; clear: () => void } {
  const canvas = h('canvas', { class: 'fp-sign__pad', width: '600', height: '200', 'data-field': 'sign-pad', 'aria-label': t('sign.padLabel') }) as HTMLCanvasElement
  const g = canvas.getContext('2d')!
  g.lineWidth = 3.2
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.strokeStyle = '#1c2a6b'
  let drawing = false
  let drawn = false
  const at = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    return [((e.clientX - r.left) * canvas.width) / r.width, ((e.clientY - r.top) * canvas.height) / r.height]
  }
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true
    canvas.setPointerCapture(e.pointerId)
    const [x, y] = at(e)
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + 0.1, y + 0.1)
    g.stroke()
    drawn = true
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return
    const [x, y] = at(e)
    g.lineTo(x, y)
    g.stroke()
  })
  const end = () => (drawing = false)
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  const clear = () => {
    g.clearRect(0, 0, canvas.width, canvas.height)
    drawn = false
  }
  const clearBtn = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-sign-clear': '' }, t('sign.clear'))
  clearBtn.addEventListener('click', clear)
  return { el: h('div', { class: 'fp-sign' }, canvas, h('div', { class: 'fp-sign__bar' }, h('span', { class: 'fp-form__hint' }, t('sign.padHint')), clearBtn)), image: () => (drawn ? canvas.toDataURL('image/png') : null), clear }
}

export function signatureDialog(app: FolioApp): void {
  const input = (field: string, value = '') => h('input', { type: 'text', class: 'fp-input', maxlength: '200', 'data-field': field, value }) as HTMLInputElement
  const doc = app.getDoc()
  const name = input('sign-name', doc.meta.author)
  const title = input('sign-title')
  const email = input('sign-email')
  const date = h('input', { type: 'checkbox', 'data-field': 'sign-date' }) as HTMLInputElement
  const pad = signaturePad()
  const row = (label: string, control: HTMLElement) => h('label', { class: 'fp-form__row' }, h('span', { class: 'fp-label' }, label), control)
  openDialog({
    name: 'signature',
    title: t('sign.title'),
    focus: name,
    body: [
      row(t('sign.name'), name),
      row(t('sign.role'), title),
      row(t('sign.email'), email),
      h('label', { class: 'fp-check' }, date, h('span', {}, t('sign.date'))),
      h('p', { class: 'fp-form__title' }, t('sign.draw')),
      pad.el,
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.insert'),
        value: 'ok',
        primary: true,
        run: () => {
          const fr = ((app.state.doc.attrs.lang as string) || lang()).startsWith('fr')
          const image = pad.image() ?? undefined
          const nodes = nodesOf(signatureBlocks({ name: name.value.trim(), title: title.value.trim(), email: email.value.trim(), date: date.checked, image }, fr))
          if (!nodes.length) return false
          app.run((state, dispatch) => {
            const { $from } = state.selection
            const depth = Math.max(1, $from.depth)
            const at = $from.after(depth)
            dispatch?.(state.tr.insert(at, Fragment.from(nodes)).scrollIntoView())
            return true
          })
        },
      },
    ],
  })
}

export function signatureLine(app: FolioApp): Ctl {
  return dropdown({
    id: 'insert-signature',
    label: t('rb.signature'),
    icon: I.signature,
    text: () => t('rb.signature'),
    menu: () => h('div', { class: 'fp-pop__list', role: 'menu' }, popItem(t('sign.menu'), () => signatureDialog(app), { 'data-signature': 'line' })),
  })
}

// --- capture d'écran ---------------------------------------------------------------

/** Une image d'une fenêtre, d'un onglet ou de l'écran, choisi dans la fenêtre du navigateur. */
export async function captureScreen(): Promise<Blob | null> {
  const media = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (o: unknown) => Promise<MediaStream> }
  if (!media?.getDisplayMedia) throw new Error('unsupported')
  const stream = await media.getDisplayMedia({ video: true, audio: false })
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play()
    // Une image vraiment dessinée (la première peut être noire).
    await new Promise((r) => setTimeout(r, 250))
    const w = video.videoWidth
    const hgt = video.videoHeight
    if (!w || !hgt) return null
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = hgt
    canvas.getContext('2d')!.drawImage(video, 0, 0, w, hgt)
    video.pause()
    return await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  } finally {
    for (const track of stream.getTracks()) track.stop()
  }
}

export async function insertScreenshot(app: FolioApp): Promise<void> {
  try {
    const blob = await captureScreen()
    if (!blob) return
    const file = new File([blob], t('shot.fileName') + '.png', { type: 'image/png' })
    await insertImageFiles(app.view, [file], P.imageHooks())
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    if (name === 'NotAllowedError' || name === 'AbortError') return
    toast(t(e instanceof Error && e.message === 'unsupported' ? 'shot.unsupported' : 'shot.failed'), { kind: 'error', timeout: 8000 })
  }
}

export function screenshot(app: FolioApp): Ctl {
  return dropdown({
    id: 'insert-screenshot',
    label: t('rb.screenshot'),
    icon: I.screenshot,
    text: () => t('rb.screenshot'),
    menu: () =>
      h(
        'div',
        { class: 'fp-pop__list', role: 'menu' },
        popItem(h('span', {}, h('span', { class: 'fp-pop__main' }, t('shot.window')), h('span', { class: 'fp-pop__hint' }, t('shot.hint'))), () => void insertScreenshot(app), { 'data-shot': 'window' }),
      ),
  })
}
