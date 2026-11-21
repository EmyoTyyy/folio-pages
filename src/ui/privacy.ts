// Avant de partager : l'inspection du document (commentaires, modifications
// suivies, noms d'auteurs, propriétés, liste de destinataires, historique et
// copie de secours gardés dans le navigateur), et le caviardage.

import type { FolioApp } from '../app'
import { applyRedactions, findForRedaction, markRedaction, pendingRedactions, REDACT_PRESETS, unmarkRedaction } from '../editor/redact'
import { schema } from '../editor/schema'
import { changesOf, resolveChanges } from '../editor/track'
import { deleteSnapshot, getSnapshot } from '../file/recovery'
import { deleteVersions, listVersions } from '../file/versions'
import type { CommentThread, MailMerge } from '../format/types'
import { t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h } from './dom'
import { RIBBON_ICONS as I } from './icons'
import { button, col, type Group } from './ribbon'

interface Finding {
  id: string
  title: string
  detail: string
  action: string
  run: () => void | Promise<void>
}

/** Ce que l'inspection trouve, avec de quoi le retirer. */
export async function inspect(app: FolioApp): Promise<Finding[]> {
  const a = app.state.doc.attrs
  const out: Finding[] = []
  const comments = (a.comments as CommentThread[]) ?? []
  if (comments.length) {
    out.push({
      id: 'comments',
      title: t('inspect.comments'),
      detail: t('inspect.commentsN', { n: comments.length }),
      action: t('inspect.removeAll'),
      run: () => {
        const tr = app.state.tr.removeMark(0, app.state.doc.content.size, schema.marks.comment).setDocAttribute('comments', [])
        app.view.dispatch(tr)
      },
    })
  }
  const changes = changesOf(app.state.doc)
  if (changes.length) {
    out.push({ id: 'changes', title: t('inspect.changes'), detail: t('inspect.changesN', { n: changes.length }), action: t('inspect.acceptAll'), run: () => void app.run(resolveChanges(true, 'all')) })
  }
  // Noms : auteurs des commentaires et des modifications suivies.
  const names = new Set<string>()
  for (const c of comments) {
    if (c.author) names.add(c.author)
    for (const r of c.replies) if (r.author) names.add(r.author)
  }
  app.state.doc.descendants((node) => {
    for (const m of node.marks) if ((m.type === schema.marks.insertion || m.type === schema.marks.deletion) && m.attrs.author) names.add(m.attrs.author)
    return true
  })
  const anon = t('inspect.anonymousAuthor')
  names.delete(anon)
  if (names.size) {
    out.push({
      id: 'names',
      title: t('inspect.names'),
      detail: [...names].slice(0, 6).join(', ') + (names.size > 6 ? '…' : ''),
      action: t('inspect.anonymize'),
      run: () => {
        const tr = app.state.tr
        tr.setDocAttribute('comments', comments.map((c) => ({ ...c, author: c.author ? anon : '', replies: c.replies.map((r) => ({ ...r, author: r.author ? anon : '' })) })))
        app.state.doc.descendants((node, pos) => {
          for (const m of node.marks) {
            if ((m.type === schema.marks.insertion || m.type === schema.marks.deletion) && m.attrs.author) tr.addMark(pos, pos + node.nodeSize, m.type.create({ ...m.attrs, author: anon }))
          }
          return true
        })
        app.view.dispatch(tr)
      },
    })
  }
  const props = (['author', 'organization', 'subject'] as const).filter((k) => a[k]).map((k) => `${t(`props.${k}`)} : ${a[k]}`)
  if ((a.keywords as string[]).length) props.push(`${t('props.keywords')} : ${(a.keywords as string[]).join(', ')}`)
  if (props.length) {
    out.push({
      id: 'properties',
      title: t('inspect.properties'),
      detail: props.join(' · '),
      action: t('inspect.clear'),
      run: () => {
        const tr = app.state.tr
        for (const k of ['author', 'organization', 'subject'] as const) tr.setDocAttribute(k, '')
        tr.setDocAttribute('keywords', [])
        app.view.dispatch(tr)
      },
    })
  }
  const mm = a.mailMerge as MailMerge | null
  if (mm?.source?.records.length) {
    out.push({
      id: 'recipients',
      title: t('inspect.recipients'),
      detail: t('inspect.recipientsN', { n: mm.source.records.length, name: mm.source.name }),
      action: t('inspect.remove'),
      run: () => {
        const { source: _s, ...rest } = mm
        app.view.dispatch(app.state.tr.setDocAttribute('mailMerge', rest))
      },
    })
  }
  const pending = pendingRedactions(app.state)
  if (pending.length) out.push({ id: 'redactions', title: t('redact.pending'), detail: t('redact.pendingN', { n: pending.length }), action: t('redact.apply'), run: () => applyRedactionsUi(app, false) })
  // Dans ce navigateur : historique des versions et copie de secours (jamais dans le fichier, mais sur cet ordinateur).
  const versions = await listVersions(app.docId)
  if (versions.length) out.push({ id: 'versions', title: t('inspect.versions'), detail: t('inspect.versionsN', { n: versions.length }), action: t('inspect.delete'), run: () => deleteVersions(app.docId) })
  if (await getSnapshot(app.docId)) out.push({ id: 'snapshot', title: t('inspect.snapshot'), detail: t('inspect.snapshotHint'), action: t('inspect.delete'), run: () => deleteSnapshot(app.docId) })
  return out
}

/** Fichier → Inspecter le document : la liste, et un bouton par élément trouvé. */
export async function inspectDialog(app: FolioApp): Promise<void> {
  const list = h('div', { class: 'fp-inspect', role: 'list', 'data-field': 'inspect-list' })
  const render = async () => {
    const found = await inspect(app)
    list.replaceChildren()
    if (!found.length) list.append(h('p', { class: 'fp-inspect__ok', 'data-field': 'inspect-clean' }, t('inspect.clean')))
    for (const f of found) {
      const b = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-inspect': f.id }, f.action)
      b.addEventListener('click', async () => {
        await f.run()
        await render()
      })
      list.append(h('div', { class: 'fp-inspect__row', role: 'listitem' }, h('div', {}, h('p', { class: 'fp-inspect__title' }, f.title), h('p', { class: 'fp-inspect__detail' }, f.detail)), b))
    }
  }
  await render()
  openDialog({
    name: 'inspect',
    title: t('inspect.title'),
    wide: true,
    body: [h('p', { class: 'fp-form__hint' }, t('inspect.hint')), list],
    actions: [{ label: t('action.close'), value: 'close', primary: true }],
  })
}

// --- caviardage ----------------------------------------------------------------------

export function markSelectionForRedaction(app: FolioApp): void {
  const { from, to, empty } = app.state.selection
  if (empty || !app.run(markRedaction([{ from, to }]))) toast(t('redact.selectFirst'), { kind: 'info' })
}

/** Rechercher et marquer : un texte, une expression, ou un modèle (courriels, téléphones, numéros). */
export function findAndMarkDialog(app: FolioApp): void {
  const text = h('input', { type: 'text', class: 'fp-input', 'data-field': 'redact-text', placeholder: t('redact.findPlaceholder') }) as HTMLInputElement
  const matchCase = h('input', { type: 'checkbox', 'data-field': 'redact-case' }) as HTMLInputElement
  const whole = h('input', { type: 'checkbox', 'data-field': 'redact-whole' }) as HTMLInputElement
  let preset: string | null = null
  const count = h('p', { class: 'fp-muted', 'data-field': 'redact-count', 'aria-live': 'polite' })
  const query = () => (preset ? { text: preset, regex: true, caseSensitive: false, wholeWord: false } : { text: text.value, regex: false, caseSensitive: matchCase.checked, wholeWord: whole.checked })
  const found = () => (query().text ? findForRedaction(app.state, query()) : [])
  const refresh = () => (count.textContent = query().text ? t('redact.found', { n: found().length }) : '')
  text.addEventListener('input', () => {
    preset = null
    refresh()
  })
  matchCase.addEventListener('change', refresh)
  whole.addEventListener('change', refresh)
  const presets = h(
    'div',
    { class: 'fp-redact__presets' },
    ...(Object.keys(REDACT_PRESETS) as (keyof typeof REDACT_PRESETS)[]).map((k) => {
      const b = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-redact-preset': k }, t(`redact.preset.${k}`))
      b.addEventListener('click', () => {
        preset = REDACT_PRESETS[k]
        text.value = ''
        refresh()
      })
      return b
    }),
  )
  openDialog({
    name: 'redact-find',
    title: t('redact.findTitle'),
    body: [
      h('div', { class: 'fp-form' }, h('div', { class: 'fp-form__row' }, h('label', { class: 'fp-label' }, t('redact.findLabel'), text))),
      h('label', { class: 'fp-check' }, matchCase, h('span', {}, t('find.matchCase'))),
      h('label', { class: 'fp-check' }, whole, h('span', {}, t('find.wholeWord'))),
      h('p', { class: 'fp-label' }, t('redact.orPreset')),
      presets,
      count,
    ],
    focus: text,
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('redact.markAll'),
        value: 'ok',
        primary: true,
        run: () => {
          const ranges = found()
          if (!ranges.length) {
            count.textContent = t('redact.found', { n: 0 })
            return false
          }
          app.run(markRedaction(ranges))
          toast(t('redact.marked', { n: ranges.length }), { kind: 'success' })
        },
      },
    ],
  })
}

/** Appliquer : définitif. L'historique d'annulation est vidé ; les copies du navigateur, supprimées si on le veut. */
export function applyRedactionsUi(app: FolioApp, ask = true): void {
  const n = pendingRedactions(app.state).length
  if (!n) {
    toast(t('redact.none'), { kind: 'info' })
    return
  }
  const run = async (wipe: boolean) => {
    app.run(applyRedactions())
    app.clearHistory()
    if (wipe) {
      await deleteVersions(app.docId)
      await deleteSnapshot(app.docId)
    }
    toast(t('redact.applied', { n }), { kind: 'success', timeout: 8000 })
  }
  if (!ask) return void run(false)
  const wipe = h('input', { type: 'checkbox', 'data-field': 'redact-wipe' }) as HTMLInputElement
  wipe.checked = true
  openDialog({
    name: 'redact-apply',
    title: t('redact.applyTitle'),
    body: [h('p', {}, t('redact.applyBody', { n })), h('label', { class: 'fp-check' }, wipe, h('span', {}, t('redact.wipe'))), h('p', { class: 'fp-form__hint' }, t('redact.applyHint'))],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      { label: t('redact.apply'), value: 'ok', primary: true, danger: true, run: () => void run(wipe.checked) },
    ],
  })
}

/** Révision → Caviarder. */
export function redactGroup(app: FolioApp): Group {
  return {
    id: 'redact',
    label: t('redact.group'),
    controls: [
      button({ id: 'redact-mark', label: t('redact.mark'), icon: I.redact, large: true, run: () => markSelectionForRedaction(app) }),
      col(
        button({ id: 'redact-find', label: t('redact.findMark'), icon: I.find, text: true, run: () => findAndMarkDialog(app) }),
        button({ id: 'redact-apply', label: t('redact.apply'), icon: I.redactApply, text: true, enabled: () => pendingRedactions(app.state).length > 0, run: () => applyRedactionsUi(app) }),
        button({ id: 'redact-clear', label: t('redact.clear'), icon: I.erase, text: true, enabled: () => pendingRedactions(app.state).length > 0, run: () => void app.run(unmarkRedaction(true)) }),
      ),
      button({ id: 'inspect', label: t('inspect.button'), icon: I.inspect, large: true, run: () => void inspectDialog(app) }),
    ],
  }
}
