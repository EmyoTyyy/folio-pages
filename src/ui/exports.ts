// Fenêtre « Exporter » : une copie du document dans un autre format (.docx,
// .odt, PDF, EPUB, page web, Markdown, texte). Tout est fabriqué ici, sans connexion.

import type { FolioApp } from '../app'
import { strToU8, zipSync } from 'fflate'
import { outline } from '../editor/outline'
import { exportEpub } from '../export/epub'
import { toHtml } from '../export/html'
import { exportOdt, ODT_MIME } from '../export/odt'
import { toMarkdown, toPlainText } from '../export/text'
import type { ExportCommonOptions } from '../export/common'
import { bakePicture, rasterize, saveExport } from '../file/docx'
import type { Key } from '../i18n/dict'
import { lang, t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h } from './dom'
import * as P from './panels'

export const EXPORT_FORMATS = ['docx', 'odt', 'pdf', 'epub', 'html', 'md', 'txt'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/** Ce que la vue page sait (numéros de page du sommaire, de l'index…). */
export function exportOptions(app: FolioApp): ExportCommonOptions {
  const info = app.pagesInfo
  return {
    filename: app.suggestedFileName(),
    locale: lang(),
    pages: info?.pages() ?? 1,
    headingPages: info ? outline(app.state.doc, 6).map((o) => info.pageAt(o.pos)) : undefined,
    refPages: info ? P.refPagesOf(app) : undefined,
  }
}

/** Le fichier d'un format (sauf .docx et PDF, qui ont leur propre chemin). */
export async function buildExport(app: FolioApp, format: Exclude<ExportFormat, 'docx' | 'pdf'>): Promise<{ bytes: Uint8Array; name: string; mime: string; ext: string; losses: number }> {
  const doc = app.getDoc()
  const base = app.suggestedFileName().replace(/\.html?$/i, '')
  const o = exportOptions(app)
  switch (format) {
    case 'odt': {
      const r = await exportOdt(doc, { ...o, rasterize, bake: bakePicture, version: __FOLIO_VERSION__ })
      return { bytes: r.bytes, name: `${base}.odt`, mime: ODT_MIME, ext: '.odt', losses: r.losses.reduce((n, l) => n + l.count, 0) }
    }
    case 'epub':
      return { bytes: exportEpub(doc, o).bytes, name: `${base}.epub`, mime: 'application/epub+zip', ext: '.epub', losses: 0 }
    case 'html':
      return { bytes: strToU8(toHtml(doc, o)), name: `${base} (web).html`, mime: 'text/html', ext: '.html', losses: 0 }
    case 'md': {
      const r = toMarkdown(doc, o)
      const names = Object.keys(r.files)
      if (!names.length) return { bytes: strToU8(r.markdown), name: `${base}.md`, mime: 'text/markdown', ext: '.md', losses: 0 }
      // Avec des images : le texte et son dossier images/, dans une archive.
      const zip = zipSync({ [`${base}.md`]: strToU8(r.markdown), ...Object.fromEntries(names.map((n) => [n, [r.files[n], { level: 0 }]])) }, { level: 6 })
      return { bytes: zip, name: `${base}.zip`, mime: 'application/zip', ext: '.zip', losses: 0 }
    }
    case 'txt':
      return { bytes: strToU8(toPlainText(doc, o)), name: `${base}.txt`, mime: 'text/plain', ext: '.txt', losses: 0 }
  }
}

let busy = false

export async function exportAs(app: FolioApp, format: ExportFormat): Promise<void> {
  if (format === 'docx') return P.exportDocxUi(app)
  if (format === 'pdf') return void window.print()
  if (busy) return
  busy = true
  try {
    const f = await buildExport(app, format)
    const out = await saveExport(f.bytes, f.name, f.mime, f.ext, t(`exp.${format}` as Key))
    if (out.kind === 'cancelled') return
    if (out.kind === 'error') return void toast(t('exp.failed', { message: out.message }), { kind: 'error', timeout: 9000 })
    toast(f.losses ? t('exp.losses', { name: out.name, n: f.losses }) : t('exp.done', { name: out.name }), { kind: f.losses ? 'warning' : 'success', timeout: 8000 })
  } catch (e) {
    toast(t('exp.failed', { message: e instanceof Error ? e.message : String(e) }), { kind: 'error', timeout: 9000 })
  } finally {
    busy = false
  }
}

export function exportDialog(app: FolioApp, initial: ExportFormat = 'odt'): void {
  let chosen: ExportFormat = initial
  const cards: HTMLButtonElement[] = []
  const grid = h('div', { class: 'fp-exp__grid', role: 'radiogroup', 'aria-label': t('exp.title') })
  const select = (f: ExportFormat) => {
    chosen = f
    for (const c of cards) {
      const on = c.dataset.format === f
      c.classList.toggle('is-selected', on)
      c.setAttribute('aria-checked', String(on))
      c.tabIndex = on ? 0 : -1
    }
  }
  let handle: ReturnType<typeof openDialog> | null = null
  for (const f of EXPORT_FORMATS) {
    const card = h(
      'button',
      { type: 'button', class: 'fp-exp__card', role: 'radio', 'data-format': f, 'aria-checked': 'false' },
      h('span', { class: 'fp-exp__ext', 'aria-hidden': 'true' }, f === 'pdf' ? 'PDF' : `.${f}`),
      h('span', { class: 'fp-exp__text' }, h('span', { class: 'fp-exp__name' }, t(`exp.${f}` as Key)), h('span', { class: 'fp-exp__desc' }, t(`exp.${f}.desc` as Key))),
    ) as HTMLButtonElement
    card.addEventListener('click', () => select(f))
    card.addEventListener('dblclick', () => {
      handle?.close('go')
      void exportAs(app, f)
    })
    card.addEventListener('keydown', (e) => {
      const i = EXPORT_FORMATS.indexOf(f)
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
      if (!step) return
      e.preventDefault()
      const next = EXPORT_FORMATS[(i + step + EXPORT_FORMATS.length) % EXPORT_FORMATS.length]
      select(next)
      cards[EXPORT_FORMATS.indexOf(next)].focus()
    })
    cards.push(card)
    grid.append(card)
  }
  select(chosen)
  handle = openDialog({
    name: 'export',
    title: t('exp.title'),
    wide: true,
    focus: cards[EXPORT_FORMATS.indexOf(chosen)],
    body: [h('p', { class: 'fp-form__hint' }, t('exp.intro')), grid, h('p', { class: 'fp-form__hint' }, t('exp.tracked'))],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('exp.go'),
        value: 'go',
        primary: true,
        // La fenêtre se ferme d'abord : l'impression ne doit pas l'imprimer.
        run: () => void setTimeout(() => void exportAs(app, chosen), chosen === 'pdf' ? 120 : 0),
      },
    ],
  })
}
