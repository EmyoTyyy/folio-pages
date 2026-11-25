// Fenêtre Imprimer (Ctrl+P, Fichier → Imprimer) : quelles pages, en livret
// plié, avec la liste des commentaires à la fin ; puis l'impression du
// navigateur (ou « Enregistrer en PDF »).

import type { FolioApp } from '../app'
import { runScoped, scopeField } from './docscope'
import type { CommentThread } from '../format/types'
import { formatDate, t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h } from './dom'
import { getPageView } from './panels'

/** « 1-3, 5, 8- » → indices de pages (à partir de 0), triés ; null si la saisie est fautive. */
export function parsePageRange(input: string, max: number): number[] | null {
  const out = new Set<number>()
  const parts = input.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return null
  for (const part of parts) {
    const m = /^(\d+)?\s*(?:([-–])\s*(\d+)?)?$/.exec(part)
    if (!m || (!m[1] && !m[3])) return null
    const a = m[1] ? Number(m[1]) : 1
    const b = m[2] ? (m[3] ? Number(m[3]) : max) : a
    if (a < 1 || b < a || a > max) return null
    for (let k = a; k <= Math.min(b, max); k++) out.add(k - 1)
  }
  return [...out].sort((x, y) => x - y)
}

/** Texte commenté de chaque fil (dans l'ordre du document). */
function quotes(app: FolioApp): Map<string, string> {
  const out = new Map<string, string>()
  app.state.doc.descendants((node) => {
    if (!node.isText) return true
    for (const m of node.marks) if (m.type.name === 'comment') out.set(m.attrs.id, (out.get(m.attrs.id) ?? '') + node.text)
    return false
  })
  return out
}

/** La page des commentaires : chaque fil, le texte commenté, les réponses. */
export function commentsPrintout(app: FolioApp): HTMLElement | null {
  const threads = (app.state.doc.attrs.comments as CommentThread[] | undefined) ?? []
  if (!threads.length) return null
  const q = quotes(app)
  const when = (d: string) => (d ? ` · ${formatDate(d)}` : '')
  return h(
    'div',
    { class: 'fp-print-comments' },
    h('h2', {}, t('print.commentsTitle')),
    ...threads.map((c, i) =>
      h(
        'div',
        { class: 'fp-print-comment' },
        q.get(c.id) ? h('blockquote', {}, q.get(c.id)!.slice(0, 300)) : null,
        h('p', {}, h('span', { class: 'who' }, `${i + 1}. ${c.author || t('comment.anonymous')}`), when(c.date), c.resolved ? ` · ${t('print.resolved')}` : ''),
        h('p', {}, c.text),
        ...c.replies.map((r) => h('p', { class: 'reply' }, h('span', { class: 'who' }, r.author || t('comment.anonymous')), `${when(r.date)} — ${r.text}`)),
      ),
    ),
  )
}

export function printDialog(app: FolioApp, preset?: string[]): void {
  const pv = getPageView()
  const paged = pv?.mode === 'page'
  const total = pv?.pageCount ?? 1
  const current = paged ? (pv?.currentPageIndex() ?? 0) : 0
  const radio = (value: string, label: string) => {
    const r = h('input', { type: 'radio', name: 'fp-print-range', value, 'data-field': `print-${value}` }) as HTMLInputElement
    return { r, el: h('label', { class: 'fp-check' }, r, h('span', {}, label)) }
  }
  const all = radio('all', t('print.allPages', { n: total }))
  const cur = radio('current', t('print.currentPage', { n: current + 1 }))
  const some = radio('some', t('print.somePages'))
  all.r.checked = true
  const range = h('input', { type: 'text', class: 'fp-input fp-print__range', 'data-field': 'print-pages', placeholder: '1-3, 5', 'aria-label': t('print.somePages') }) as HTMLInputElement
  range.addEventListener('input', () => (some.r.checked = true))
  const booklet = h('input', { type: 'checkbox', 'data-field': 'print-booklet' }) as HTMLInputElement
  const comments = h('input', { type: 'checkbox', 'data-field': 'print-comments' }) as HTMLInputElement
  const hasComments = ((app.state.doc.attrs.comments as unknown[] | undefined) ?? []).length > 0
  comments.disabled = !hasComments
  const error = h('p', { class: 'fp-field-error', role: 'alert', 'data-field': 'print-error' })
  for (const c of [all.r, cur.r, some.r, range, booklet]) c.toggleAttribute('disabled', !paged)
  // Plusieurs documents : celui-ci, ou tous (toutes leurs pages, à la suite).
  const scope = scopeField(
    app,
    (s) => {
      if (s !== 'one') all.r.checked = true
      for (const c of [cur.r, some.r, range]) c.toggleAttribute('disabled', !paged || s !== 'one')
    },
    preset,
  )
  if (scope.value() !== 'one') for (const c of [cur.r, some.r, range]) c.toggleAttribute('disabled', true)
  openDialog({
    name: 'print',
    title: t('print.title'),
    body: [
      paged ? null : h('p', { class: 'fp-form__hint', 'data-field': 'print-webview' }, t('print.pageViewOnly')),
      scope.el,
      h('fieldset', { class: 'fp-print__set' }, h('legend', { class: 'fp-label' }, t('print.pages')), all.el, cur.el, h('div', { class: 'fp-print__some' }, some.el, range)),
      h('label', { class: 'fp-check' }, booklet, h('span', {}, t('print.booklet'))),
      h('p', { class: 'fp-form__hint' }, t('print.bookletHint')),
      h('label', { class: 'fp-check' }, comments, h('span', {}, hasComments ? t('print.comments') : t('print.noComments'))),
      h('p', { class: 'fp-form__hint' }, t('print.pdfHint')),
      error,
    ].filter((x) => x !== null) as HTMLElement[],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('print.print'),
        value: 'ok',
        primary: true,
        run: () => {
          if (!scope.valid()) return false
          let pages: number[] | undefined
          if (some.r.checked) {
            const p = parsePageRange(range.value, total)
            if (!p) {
              error.textContent = t('print.badRange', { n: total })
              return false
            }
            pages = p
          } else if (cur.r.checked) pages = [current]
          const wantComments = comments.checked
          const print = async () => {
            const extra = wantComments ? commentsPrintout(app) : null
            if (pv && (pages || booklet.checked || extra)) pv.printOptions = { ...(pages ? { pages } : {}), ...(booklet.checked ? { booklet: true } : {}), ...(extra ? { extra } : {}) }
            try {
              window.print()
            } catch {
              toast(t('print.failed'), { kind: 'error' })
            }
          }
          const chosen = scope.value()
          // Après la fermeture de la fenêtre (sinon elle serait imprimée).
          setTimeout(() => void (app.documents.length > 1 ? runScoped(app, chosen, print) : print()), 0)
        },
      },
    ],
  })
}
