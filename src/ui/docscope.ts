// Exporter ou imprimer quand le fichier contient plusieurs documents : celui
// qui est affiché, ou tous à la suite (chacun commence une nouvelle page). Le
// document à exporter est montré le temps de l'export (la mise en page donne
// les numéros de page), puis le vrai revient ; rien ne change dans le fichier.

import type { FolioApp, TreeView } from '../app'
import { t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h } from './dom'
import { getPageView } from './panels'

/** Ce document, tous, ou une liste de documents (leurs clés, dans n'importe quel ordre). */
export type DocScope = 'one' | 'all' | string[]

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

export interface ScopeField {
  el: HTMLElement | null
  value: () => DocScope
  /** Vrai si le choix est valable (au moins un document coché) ; sinon le dit dans la fenêtre. */
  valid: () => boolean
}

/**
 * Les choix « ce document / ce dossier / tous / choisir… », à mettre dans une
 * fenêtre. « Choisir » montre l'arbre avec une case par document et par dossier.
 * `preset` : les documents à proposer d'abord (un dossier choisi dans le volet).
 */
export function scopeField(app: FolioApp, onChange?: (s: DocScope) => void, preset?: string[]): ScopeField {
  const docs = app.documents
  if (docs.length < 2) return { el: null, value: () => 'one', valid: () => true }
  const current = docs.find((d) => d.active)
  const folder = presetFolder(app, preset) ?? app.parentOf(app.activeKey)
  const folderKeys = folder ? app.folderDocs(folder.id) : []
  const radio = (v: string, label: string) => {
    const r = h('input', { type: 'radio', name: 'fp-doc-scope', value: v, 'data-field': `scope-${v}` }) as HTMLInputElement
    r.addEventListener('change', () => {
      pick.hidden = !picked.r.checked
      error.textContent = ''
      onChange?.(value())
    })
    return { r, el: h('label', { class: 'fp-check' }, r, h('span', {}, label)) }
  }
  const one = radio('one', t('docs.scopeOne', { title: current?.title ?? '' }))
  const inFolder = folder && folderKeys.length > 1 && folderKeys.length < docs.length ? radio('folder', t('docs.scopeFolder', { title: folder.title, n: folderKeys.length })) : null
  const all = radio('all', t('docs.scopeAll'))
  const picked = radio('pick', t('docs.scopePick'))
  const error = h('p', { class: 'fp-field-error', role: 'alert', 'data-field': 'scope-error' })

  // L'arbre à cocher : un dossier coche ou décoche tout ce qu'il contient.
  const boxes = new Map<string, HTMLInputElement>()
  const folderBoxes: { box: HTMLInputElement; keys: string[] }[] = []
  const sync = () => {
    for (const f of folderBoxes) {
      const on = f.keys.filter((k) => boxes.get(k)!.checked).length
      f.box.checked = on > 0 && on === f.keys.length
      f.box.indeterminate = on > 0 && on < f.keys.length
    }
  }
  const tree = (list: TreeView[], depth: number): HTMLElement[] =>
    list.flatMap((n) => {
      const box = h('input', { type: 'checkbox' }) as HTMLInputElement
      const row = h('label', { class: 'fp-check fp-scope__row', style: `--depth:${depth}` }, box, h('span', {}, n.kind === 'doc' ? n.title : `${n.title} /`))
      if (n.kind === 'doc') {
        box.dataset.scopeDoc = n.key
        boxes.set(n.key, box)
        box.addEventListener('change', () => {
          sync()
          error.textContent = ''
          onChange?.(value())
        })
        return [row]
      }
      box.dataset.scopeFolder = n.id
      const keys = keysOf(n.children)
      folderBoxes.push({ box, keys })
      box.addEventListener('change', () => {
        for (const k of keys) boxes.get(k)!.checked = box.checked
        sync()
        error.textContent = ''
        onChange?.(value())
      })
      return [row, ...tree(n.children, depth + 1)]
    })
  const pick = h('div', { class: 'fp-scope__tree', 'data-field': 'scope-tree' }, ...tree(app.docTree, 0))
  pick.hidden = true

  const value = (): DocScope => {
    if (all.r.checked) return 'all'
    if (inFolder?.r.checked) return folderKeys
    if (picked.r.checked) return [...boxes].filter(([, b]) => b.checked).map(([k]) => k)
    return 'one'
  }
  // Le choix de départ : ce que propose le volet, sinon ce document.
  const want = preset ?? [app.activeKey]
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k))
  if (same(want, [app.activeKey])) one.r.checked = true
  else if (inFolder && same(want, folderKeys)) inFolder.r.checked = true
  else if (want.length === docs.length) all.r.checked = true
  else {
    picked.r.checked = true
    pick.hidden = false
  }
  for (const [k, b] of boxes) b.checked = want.includes(k)
  sync()
  const el = h('fieldset', { class: 'fp-print__set', 'data-field': 'doc-scope' }, h('legend', { class: 'fp-label' }, t('docs.scopeBody', { n: docs.length })), one.el, inFolder?.el ?? null, all.el, picked.el, pick, error)
  return {
    el,
    value,
    valid: () => {
      const v = value()
      if (Array.isArray(v) && !v.length) {
        error.textContent = t('docs.scopeNone')
        return false
      }
      return true
    },
  }
}

const keysOf = (list: TreeView[]): string[] => list.flatMap((n) => (n.kind === 'doc' ? [n.key] : keysOf(n.children)))

/** Le dossier dont `keys` sont exactement les documents (null : aucun). */
function presetFolder(app: FolioApp, keys?: string[]): { id: string; title: string } | null {
  if (!keys?.length) return null
  const find = (list: TreeView[]): { id: string; title: string } | null => {
    for (const n of list) {
      if (n.kind !== 'folder') continue
      const inside = keysOf(n.children)
      if (inside.length === keys.length && inside.every((k) => keys.includes(k))) return { id: n.id, title: n.title }
      const deeper = find(n.children)
      if (deeper) return deeper
    }
    return null
  }
  return find(app.docTree)
}

/** Demande quels documents quand il y en a plusieurs ; null si l'on renonce. */
export async function askScope(app: FolioApp, preset?: string[]): Promise<DocScope | null> {
  const f = scopeField(app, undefined, preset)
  if (!f.el) return 'one'
  const choice = await openDialog({
    name: 'doc-scope',
    title: t('docs.scopeTitle'),
    body: [f.el],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      { label: t('action.ok'), value: 'ok', primary: true, run: () => f.valid() },
    ],
  }).result
  return choice === 'ok' ? f.value() : null
}

/** Les clés d'un choix, dans l'ordre de l'arbre. */
export function scopeKeys(app: FolioApp, scope: DocScope): string[] {
  const all = app.documents.map((d) => d.key)
  if (scope === 'all') return all
  if (scope === 'one') return [app.activeKey]
  return all.filter((k) => scope.includes(k))
}

/**
 * Exécute un export sur les documents choisis : plusieurs documents réunis (à la
 * suite, chacun sur une nouvelle page), ou un seul (ses renvois vers les autres
 * documents devenus du texte). Un dossier donne son nom à l'ensemble.
 */
export async function runScoped<T>(app: FolioApp, scope: DocScope, run: () => Promise<T>): Promise<T> {
  const keys = scopeKeys(app, scope)
  // Le fichier exporté porte le nom de ce qu'il contient : un document, un dossier.
  const all = keys.length === app.documents.length
  const folder = !all && keys.length > 1 ? presetFolder(app, keys) : null
  const one = !all && keys.length === 1 ? app.documents.find((d) => d.key === keys[0]) : null
  app.exportBase = folder?.title ?? one?.title ?? null
  try {
    return await runKeys(app, keys, folder, run)
  } finally {
    app.exportBase = null
  }
}

async function runKeys<T>(app: FolioApp, keys: string[], folder: { title: string } | null, run: () => Promise<T>): Promise<T> {
  if (keys.length > 1) {
    const { doc, styles } = app.combinedDoc(keys)
    if (folder) doc.meta = { ...doc.meta, title: folder.title }
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
  const i = app.indexOf(keys[0] ?? app.activeKey)
  const alone = app.documents.length > 1 ? app.standaloneDoc(i < 0 ? undefined : i) : null
  if (!alone) return run()
  return app.showTemporarily(alone, async () => {
    await layoutSettled()
    return run()
  })
}

/** Demande la portée puis exécute ; null si l'on renonce. */
export async function withScope<T>(app: FolioApp, run: () => Promise<T>, preset?: string[]): Promise<T | null> {
  const scope = await askScope(app, preset)
  if (!scope) return null
  return runScoped(app, scope, run)
}
