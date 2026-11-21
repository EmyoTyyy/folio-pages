// PDF direct : le document mis en page (vue Page) devient un fichier PDF, sans
// passer par la fenêtre d'impression ; il peut ainsi aller dans un brouillon
// .eml ou être joint à un message.

import type { FolioApp } from '../app'
import { saveExport } from '../file/docx'
import { capturePdf, type CaptureReport } from '../layout/pdf-capture'
import { t } from '../i18n/i18n'
import { toast } from './dialog'
import { getPageView } from './panels'

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

/** Le PDF du document (vue Page le temps de le fabriquer). */
export async function pdfFile(app: FolioApp): Promise<{ name: string; bytes: Uint8Array; report: CaptureReport } | null> {
  const pv = getPageView()
  const root = document.querySelector<HTMLElement>('#fp-page')
  if (!pv || !root) return null
  const before = pv.mode
  const reading = app.reading
  if (before !== 'page') {
    pv.setMode('page')
    await frame()
    await new Promise((r) => setTimeout(r, 300))
    await frame()
  }
  try {
    await document.fonts?.ready
    const meta = app.state.doc.attrs
    const { bytes, report } = await capturePdf(root, {
      title: app.displayTitle(),
      author: meta.author as string,
      subject: meta.subject as string,
      keywords: (meta.keywords as string[]).join(', '),
      lang: (meta.lang as string) || undefined,
    })
    return { name: app.suggestedFileName().replace(/\.html?$/i, '') + '.pdf', bytes, report }
  } finally {
    if (before !== 'page' && !reading) pv.setMode(before)
  }
}

let busy = false

/** Fichier → Exporter → PDF, Partager → PDF. */
export async function exportPdfUi(app: FolioApp): Promise<void> {
  if (busy) return
  busy = true
  const done = toast(t('pdf.making'), { kind: 'info', timeout: 60000 })
  try {
    const f = await pdfFile(app)
    done()
    if (!f) return
    const out = await saveExport(f.bytes, f.name, 'application/pdf', '.pdf', 'PDF')
    if (out.kind === 'cancelled') return
    if (out.kind === 'error') return void toast(t('exp.failed', { message: out.message }), { kind: 'error', timeout: 9000 })
    const notes = [f.report.replaced ? t('pdf.replaced', { n: f.report.replaced }) : '', f.report.images ? t('pdf.images', { n: f.report.images }) : ''].filter(Boolean).join(' ')
    toast(`${t('exp.done', { name: out.name })}${notes ? ` ${notes}` : ''}`, { kind: notes ? 'warning' : 'success', timeout: 9000 })
  } catch (e) {
    done()
    toast(t('exp.failed', { message: e instanceof Error ? e.message : String(e) }), { kind: 'error', timeout: 9000 })
  } finally {
    busy = false
  }
}
