// Actions de l'interface qui ouvrent une fenêtre : JSON du document, IA,
// rapport d'ouverture, à propos.

import OFL_TEXT from '../fonts/OFL.txt?raw'
import type { FolioApp } from '../app'
import type { Issue, Report } from '../format/dsl'
import type { JsonError } from '../format/json'
import { t, type Params } from '../i18n/i18n'
import type { Key } from '../i18n/dict'
import { openDialog, toast } from './dialog'
import { h } from './dom'

const REPO = 'https://github.com/EmyoTyyy/folio-pages'

// --- presse-papiers ---------------------------------------------------------

/** Copie du texte ; renvoie false si aucun moyen n'a fonctionné. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* on essaie l'ancienne méthode */
  }
  const area = h('textarea', { 'aria-hidden': 'true', class: 'fp-offscreen' }) as HTMLTextAreaElement
  area.value = text
  document.body.appendChild(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}

/** Quand le presse-papiers est refusé : le texte, sélectionné, à copier soi-même. */
function manualCopyDialog(text: string): void {
  const area = h('textarea', { class: 'fp-code fp-code--tall', readonly: true, spellcheck: 'false', 'aria-label': t('json.copyManually') }) as HTMLTextAreaElement
  area.value = text
  openDialog({
    name: 'manual-copy',
    title: t('json.copyManually'),
    body: [h('p', {}, t('json.copyManuallyHelp')), area],
    actions: [{ label: t('action.close'), value: 'close', primary: true }],
    wide: true,
    focus: area,
  })
  area.select()
}

export async function copyJson(app: FolioApp, compact: boolean): Promise<void> {
  const text = app.json(compact)
  if (await writeClipboard(text)) toast(t(compact ? 'json.copiedCompact' : 'json.copied'), { kind: 'success' })
  else manualCopyDialog(text)
}

// --- descriptions -----------------------------------------------------------

export function describeIssue(issue: Issue): string {
  if (issue.code === 'import-loss') {
    // Ce qu'un import .docx n'a pas repris : « code:nombre ».
    const [code, n] = (issue.detail ?? '').split(':')
    return t(`docx.in.${code}` as Key, { n: Number(n) || 1 })
  }
  return t(`issue.${issue.code}` as Key, { detail: issue.detail ?? '' })
}

export function describeJsonError(e: JsonError): string {
  const found = e.found === undefined ? '' : e.found === '\n' ? '↵' : e.found
  return t(`jsonErr.${e.code}` as Key, { found } as Params)
}

export function reportSummary(report: Report | null): string | null {
  if (!report || (!report.ignored && !report.warnings)) return null
  return t('report.summary', {
    ignored: t('report.ignored', { n: report.ignored }),
    warnings: t('report.warnings', { n: report.warnings }),
  })
}

// --- fenêtres -----------------------------------------------------------------

export function reportDialog(app: FolioApp): void {
  const report = app.report
  const body: Node[] = []
  if (!report || !report.issues.length) body.push(h('p', {}, t('report.none')))
  else {
    body.push(h('p', {}, t('report.intro')), h('p', { class: 'fp-report__summary' }, reportSummary(report) ?? ''))
    const list = h('ul', { class: 'fp-report' })
    for (const issue of report.issues) {
      list.append(
        h(
          'li',
          { class: `fp-report__item fp-report__item--${issue.kind}` },
          h('span', { class: 'fp-report__kind' }, t(issue.kind === 'ignored' ? 'report.kindIgnored' : 'report.kindWarning')),
          h('code', { class: 'fp-report__path' }, issue.path || t('report.root')),
          h('span', { class: 'fp-report__msg' }, describeIssue(issue)),
        ),
      )
    }
    const hidden = report.ignored + report.warnings - report.issues.length
    if (hidden > 0) list.append(h('li', { class: 'fp-report__more' }, t('report.more', { n: hidden })))
    body.push(list)
  }
  openDialog({ name: 'report', title: t('report.title'), body, actions: [{ label: t('action.close'), value: 'close', primary: true }], wide: true })
}

export function replaceFromJsonDialog(app: FolioApp): void {
  const area = h('textarea', {
    class: 'fp-code fp-code--tall',
    id: 'fp-replace-json',
    spellcheck: 'false',
    'aria-label': t('replace.label'),
    placeholder: '{ "format": "folio/doc", "version": 1, "blocks": [ … ] }',
  }) as HTMLTextAreaElement
  const error = h('p', { class: 'fp-field-error', role: 'alert', id: 'fp-replace-error' })
  const fail = (message: string) => {
    error.textContent = message
    area.setAttribute('aria-invalid', 'true')
    return false
  }
  openDialog({
    name: 'replace-json',
    title: t('replace.title'),
    body: [h('p', {}, t('replace.help')), area, error],
    wide: true,
    focus: area,
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('replace.submit'),
        value: 'replace',
        primary: true,
        run: () => {
          if (!area.value.trim()) return fail(t('replace.empty'))
          const res = app.loadInto(area.value)
          if (!res.ok) {
            if (res.reason === 'json')
              return fail(t('replace.jsonError', { line: res.error.line, column: res.error.column, message: describeJsonError(res.error) }))
            if (res.reason === 'encrypted') return fail(t('replace.encrypted'))
            if (res.reason === 'too-large') return fail(t('replace.tooLarge'))
            return fail(t('replace.notDocument'))
          }
          const summary = reportSummary(res.report)
          toast(summary ? `${t('replace.done')} ${summary}` : t('replace.done'), {
            kind: summary ? 'warning' : 'success',
            action: summary ? { label: t('action.details'), run: () => reportDialog(app) } : undefined,
          })
          app.focus()
          return true
        },
      },
    ],
  })
}

export function aiHelpDialog(app: FolioApp): void {
  const prompt = t('ai.prompt')
  const promptBox = h('textarea', { class: 'fp-code', readonly: true, rows: '3', 'aria-label': t('ai.promptLabel') }) as HTMLTextAreaElement
  promptBox.value = prompt + '…'
  openDialog({
    name: 'ai-help',
    title: t('ai.title'),
    wide: true,
    body: [
      h('p', {}, t('ai.intro')),
      h('ol', { class: 'fp-steps' }, h('li', {}, t('ai.step1')), h('li', {}, t('ai.step2')), h('li', {}, t('ai.step3'))),
      h('label', { class: 'fp-label' }, t('ai.promptLabel')),
      promptBox,
    ],
    actions: [
      {
        label: t('ai.copyPrompt'),
        value: 'copy',
        run: async () => {
          if (await writeClipboard(prompt)) toast(t('ai.promptCopied'), { kind: 'success' })
          return false
        },
      },
      { label: t('menu.copyCompact'), value: 'compact', run: () => void copyJson(app, true) },
      { label: t('action.close'), value: 'close', primary: true },
    ],
  })
}

export function aboutDialog(): void {
  openDialog({
    name: 'about',
    title: t('about.title'),
    body: [
      h('p', {}, t('about.body')),
      h('p', { class: 'fp-muted' }, t('about.version', { version: __FOLIO_VERSION__ })),
      h('p', {}, t('about.licence')),
      h('details', { class: 'fp-about__ofl' }, h('summary', {}, t('about.fonts')), h('pre', { class: 'fp-code fp-code--tall' }, OFL_TEXT)),
      h('p', {}, h('a', { href: REPO, target: '_blank', rel: 'noopener noreferrer' }, t('about.source'))),
    ],
    actions: [{ label: t('action.close'), value: 'close', primary: true }],
  })
}
