// Exporter ou imprimer quand le fichier contient plusieurs documents : celui
// qui est affiché, ou tous à la suite (chacun commence une nouvelle page). Le
// document à exporter est montré le temps de l'export (la mise en page donne
// les numéros de page), puis le vrai revient ; rien ne change dans le fichier.

import type { FolioApp } from '../app'
import { t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h } from './dom'
import { getPageView } from './panels'

export type DocScope = 'one' | 'all'

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/** La mise en page du document montré est faite (ou presque : au plus 2 s). */
export async function layoutSettled(): Promise<void> {
  const pv = getPageView()
  if (pv && pv.mode === 'page') {
    await new Promise<void>((resolve) => {
      const done = () => {
        off()
        clearTimeout(timer)
        resolve()
      }
      const off = pv.onLayout(done)
      const timer = setTimeout(done, 2000)
    })
  }
  await frame()
  await frame()
}

/** Les choix « ce document / tous » (une case à cocher pour chacun), à mettre dans une fenêtre. */
export function scopeField(app: FolioApp, onChange?: (s: DocScope) => void): { el: HTMLElement | null; value: () => DocScope } {
  const docs = app.documents
  if (docs.length < 2) return { el: null, value: () => 'one' }
  const current = docs.find((d) => d.active)?.title ?? ''
  const radio = (v: DocScope, label: string) => {
    const r = h('input', { type: 'radio', name: 'fp-doc-scope', value: v, 'data-field': `scope-${v}` }) as HTMLInputElement
    r.addEventListener('change', () => onChange?.(v))
    return { r, el: h('label', { class: 'fp-check' }, r, h('span', {}, label)) }
  }
  const one = radio('one', t('docs.scopeOne', { title: current }))
  const all = radio('all', t('docs.scopeAll'))
  one.r.checked = true
  const el = h('fieldset', { class: 'fp-print__set', 'data-field': 'doc-scope' }, h('legend', { class: 'fp-label' }, t('docs.scopeBody', { n: docs.length })), one.el, all.el)
  return { el, value: () => (all.r.checked ? 'all' : 'one') }
}

/** Demande « ce document ou tous » quand il y en a plusieurs ; null si l'on renonce. */
export async function askScope(app: FolioApp): Promise<DocScope | null> {
  const f = scopeField(app)
  if (!f.el) return 'one'
  const choice = await openDialog({
    name: 'doc-scope',
    title: t('docs.scopeTitle'),
    body: [f.el],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      { label: t('action.ok'), value: 'ok', primary: true },
    ],
  }).result
  return choice === 'ok' ? f.value() : null
}

/**
 * Exécute un export sur le document choisi : tous les documents réunis, ou
 * celui qui est affiché (ses renvois vers les autres documents devenus du texte).
 */
export async function runScoped<T>(app: FolioApp, scope: DocScope, run: () => Promise<T>): Promise<T> {
  if (scope === 'all') {
    const { doc, styles } = app.combinedDoc()
    const done = toast(t('docs.preparing'), { kind: 'info', timeout: 60000 })
    if (styles.length) toast(t('docs.scopeStyles', { list: styles.slice(0, 6).join(', ') }), { kind: 'info', timeout: 9000 })
    try {
      return await app.showTemporarily(doc, async () => {
        await layoutSettled()
        done()
        return run()
      })
    } finally {
      done()
    }
  }
  const alone = app.documents.length > 1 ? app.standaloneDoc() : null
  if (!alone) return run()
  return app.showTemporarily(alone, async () => {
    await layoutSettled()
    return run()
  })
}

/** Demande la portée puis exécute ; null si l'on renonce. */
export async function withScope<T>(app: FolioApp, run: () => Promise<T>): Promise<T | null> {
  const scope = await askScope(app)
  if (!scope) return null
  return runScoped(app, scope, run)
}
