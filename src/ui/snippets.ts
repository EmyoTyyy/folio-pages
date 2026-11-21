// Extraits réutilisables : la bibliothèque (dans ce navigateur), « Enregistrer
// la sélection comme extrait », « Gérer les extraits », et leur place dans le
// menu Composants (Insertion → Texte).

import type { FolioApp } from '../app'
import { cleanSnippet, expandSnippet, insertSnippet, newId, selectionContent, SHORTCUT, SNIPPET_LIMITS, type Snippet } from '../editor/snippets'
import { idbDelete, idbGetAll, idbPut, STORES } from '../file/idb'
import { downloadFile } from '../file/save'
import { runsText } from '../format/runs'
import type { Block } from '../format/types'
import { t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h, icon } from './dom'
import { ICONS } from './icons'
import { pickFile } from './panels'
import { popItem } from './popover'

const LS_KEY = 'folio-pages:snippets'
let cache: Snippet[] = []
let loading: Promise<void> | null = null
/** IndexedDB refusé (navigation privée…) : les extraits vont dans localStorage. */
let fallback = false

const byName = (a: Snippet, b: Snippet) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

export function loadSnippets(): Promise<void> {
  loading ??= (async () => {
    const all = await idbGetAll<Snippet>(STORES.snippets).catch(() => null)
    if (all) cache = all.filter((s) => s && typeof s.name === 'string' && Array.isArray(s.blocks)).sort(byName)
    else {
      fallback = true
      try {
        const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as unknown[]
        cache = raw.map((r) => cleanSnippet(r, new Date().toISOString())).filter((s): s is Snippet => !!s).sort(byName)
      } catch {
        cache = []
      }
    }
  })()
  return loading
}

export const snippetList = (): Snippet[] => cache

async function persist(s: Snippet | null, removeId?: string): Promise<boolean> {
  if (!fallback) {
    const ok = s ? await idbPut(STORES.snippets, s) : await idbDelete(STORES.snippets, removeId!)
    if (ok !== false) return true
    fallback = true
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache))
    return true
  } catch {
    return false
  }
}

export async function putSnippet(s: Snippet): Promise<boolean> {
  cache = [...cache.filter((x) => x.id !== s.id), s].sort(byName)
  const ok = await persist(s)
  if (!ok) toast(t('snip.storageFull'), { kind: 'error' })
  return ok
}

export async function removeSnippet(id: string): Promise<void> {
  cache = cache.filter((x) => x.id !== id)
  await persist(null, id)
}

/** Aperçu d'un extrait : son début, en texte. */
export function snippetPreview(s: Pick<Snippet, 'blocks'>, max = 70): string {
  const parts: string[] = []
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (parts.join(' ').length > max) return
      if (b.type === 'paragraph' || b.type === 'heading') parts.push(runsText(b.content))
      else if (b.type === 'list') for (const it of b.items) parts.push(runsText(it.content))
      else if (b.type === 'quote' || b.type === 'callout' || b.type === 'columns') walk(b.blocks)
      else if (b.type === 'table') for (const r of b.rows) for (const c of r) walk(c.blocks)
      else if (b.type === 'code') parts.push(b.text)
      else if (b.type === 'equation') parts.push(b.tex)
      else if (b.type === 'image') parts.push(b.alt || '🖼')
    }
  }
  walk(s.blocks)
  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const field = (label: string, control: HTMLElement, hint?: string) => {
  control.id ||= `fp-snip-${Math.random().toString(36).slice(2, 8)}`
  return h('div', { class: 'fp-form__row' }, h('label', { class: 'fp-label', for: control.id }, label), control, hint ? h('p', { class: 'fp-form__hint' }, hint) : null)
}

/** Insertion → Composants → Enregistrer la sélection comme extrait. */
export async function saveSelectionDialog(app: FolioApp): Promise<void> {
  await loadSnippets()
  const content = selectionContent(app.state)
  if (!content) {
    toast(t('snip.selectFirst'), { kind: 'info' })
    return
  }
  if (cache.length >= SNIPPET_LIMITS.count) {
    toast(t('snip.tooMany', { n: SNIPPET_LIMITS.count }), { kind: 'error' })
    return
  }
  const preview = snippetPreview(content)
  const name = h('input', { type: 'text', class: 'fp-input', 'data-field': 'snip-name', maxlength: String(SNIPPET_LIMITS.name) }) as HTMLInputElement
  name.value = preview.split(' ').slice(0, 4).join(' ').replace(/[…,.;:!?]+$/, '').slice(0, SNIPPET_LIMITS.name)
  const shortcut = h('input', { type: 'text', class: 'fp-input', 'data-field': 'snip-shortcut', maxlength: String(SNIPPET_LIMITS.shortcut), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement
  const error = h('p', { class: 'fp-field-error', role: 'alert', 'data-field': 'snip-error' })
  const d = openDialog({
    name: 'snippet-save',
    title: t('snip.saveTitle'),
    body: [
      h('p', { class: 'fp-snip__preview', 'data-field': 'snip-preview' }, preview || '—'),
      h('div', { class: 'fp-form' }, field(t('snip.name'), name), field(t('snip.shortcut'), shortcut, t('snip.shortcutHint'))),
      error,
    ],
    focus: name,
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('snip.save'),
        value: 'ok',
        primary: true,
        run: async () => {
          const n = name.value.replace(/\s+/g, ' ').trim()
          const sc = shortcut.value.trim()
          if (!n) error.textContent = t('snip.needName')
          else if (sc && !SHORTCUT.test(sc)) error.textContent = t('snip.badShortcut')
          else if (sc && cache.some((s) => s.shortcut.toLocaleLowerCase() === sc.toLocaleLowerCase())) error.textContent = t('snip.shortcutTaken', { shortcut: sc })
          else {
            const ok = await putSnippet({ id: newId(), name: n, shortcut: sc, ...content, created: new Date().toISOString() })
            if (ok) toast(t('snip.saved', { name: n }), { kind: 'success' })
            return
          }
          return false
        },
      },
    ],
  })
  void d.result
}

/** Insère un extrait, puis rend la main au texte. */
export function useSnippet(app: FolioApp, s: Snippet): void {
  app.run(insertSnippet(s))
  app.focus()
}

/** F3 : le mot avant le curseur → l'extrait qu'il désigne. */
export function expandAtCursor(app: FolioApp): boolean {
  return app.run(expandSnippet(snippetList, (w) => toast(w ? t('snip.noMatch', { word: w }) : t('snip.typeShortcut'), { kind: 'info' })))
}

/** Les extraits dans le menu Composants (avec « Enregistrer la sélection » et « Gérer »). */
export function snippetMenuItems(app: FolioApp): HTMLElement[] {
  const items: HTMLElement[] = cache.slice(0, 40).map((s) =>
    popItem(
      h('span', { class: 'fp-snip__item' }, h('span', { class: 'fp-pop__main' }, s.name), s.shortcut ? h('span', { class: 'fp-pop__hint' }, `${s.shortcut} · F3`) : null, h('span', { class: 'fp-snip__peek' }, snippetPreview(s, 60))),
      () => useSnippet(app, s),
      { 'data-snippet': s.name },
    ),
  )
  if (!cache.length) items.push(h('p', { class: 'fp-pop__empty' }, t('snip.none')))
  items.push(
    popItem(t('snip.saveSelection'), () => void saveSelectionDialog(app), { 'data-snip-action': 'save', 'aria-disabled': app.state.selection.empty ? 'true' : null }),
    popItem(t('snip.manage'), () => void manageSnippetsDialog(app), { 'data-snip-action': 'manage' }),
  )
  return items
}

/** Gérer les extraits : renommer, changer le raccourci, insérer, supprimer, exporter, importer. */
export async function manageSnippetsDialog(app: FolioApp): Promise<void> {
  await loadSnippets()
  const list = h('div', { class: 'fp-snip__list', role: 'list', 'data-field': 'snip-list' })
  const error = h('p', { class: 'fp-field-error', role: 'alert', 'data-field': 'snip-error' })
  const render = () => {
    list.replaceChildren()
    if (!cache.length) list.append(h('p', { class: 'fp-muted' }, t('snip.none')))
    for (const s of cache) {
      const name = h('input', { type: 'text', class: 'fp-input', value: s.name, maxlength: String(SNIPPET_LIMITS.name), 'aria-label': t('snip.name'), 'data-snip-name': s.name }) as HTMLInputElement
      const sc = h('input', { type: 'text', class: 'fp-input fp-snip__sc', value: s.shortcut, maxlength: String(SNIPPET_LIMITS.shortcut), 'aria-label': t('snip.shortcut'), placeholder: t('snip.shortcut'), spellcheck: 'false', 'data-snip-shortcut': s.name }) as HTMLInputElement
      const commit = async () => {
        const n = name.value.replace(/\s+/g, ' ').trim()
        const k = sc.value.trim()
        error.textContent = ''
        if (!n) {
          name.value = s.name
          return
        }
        if (k && (!SHORTCUT.test(k) || cache.some((x) => x.id !== s.id && x.shortcut.toLocaleLowerCase() === k.toLocaleLowerCase()))) {
          error.textContent = SHORTCUT.test(k) ? t('snip.shortcutTaken', { shortcut: k }) : t('snip.badShortcut')
          sc.value = s.shortcut
          return
        }
        if (n !== s.name || k !== s.shortcut) {
          await putSnippet({ ...s, name: n, shortcut: k })
          s.name = n
          s.shortcut = k
          // Les libellés de la ligne suivent le nouveau nom (sans tout redessiner : le focus reste).
          for (const el of [name, sc, use, del]) for (const a of ['snipName', 'snipShortcut', 'snipInsert', 'snipDelete']) if (el.dataset[a] !== undefined) el.dataset[a] = n
          del.title = del.ariaLabel = t('snip.delete', { name: n })
        }
      }
      name.addEventListener('change', () => void commit())
      sc.addEventListener('change', () => void commit())
      const use = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-snip-insert': s.name }, t('snip.insert'))
      use.addEventListener('click', () => {
        d.close('insert')
        useSnippet(app, s)
      })
      const del = h('button', { type: 'button', class: 'fp-iconbtn', 'data-snip-delete': s.name, title: t('snip.delete', { name: s.name }), 'aria-label': t('snip.delete', { name: s.name }) }, icon(ICONS.close))
      del.addEventListener('click', async () => {
        await removeSnippet(s.id)
        render()
      })
      list.append(h('div', { class: 'fp-snip__row', role: 'listitem' }, h('div', { class: 'fp-snip__fields' }, name, sc), h('p', { class: 'fp-snip__peek' }, snippetPreview(s)), use, del))
    }
  }
  render()
  const exportBtn = h('button', { type: 'button', class: 'fp-btn', 'data-snip-action': 'export' }, t('snip.export'))
  exportBtn.addEventListener('click', () => {
    if (!cache.length) return
    downloadFile(JSON.stringify({ format: 'folio/snippets', version: 1, snippets: cache }, null, 1), 'folio-snippets.json', 'application/json')
  })
  const importBtn = h('button', { type: 'button', class: 'fp-btn', 'data-snip-action': 'import' }, t('snip.import'))
  importBtn.addEventListener('click', async () => {
    const file = await pickFile('.json,application/json')
    if (!file) return
    const n = await importSnippets(file)
    if (n === null) error.textContent = t('snip.badFile')
    else toast(t('snip.imported', { n }), { kind: n ? 'success' : 'info' })
    render()
  })
  const d = openDialog({
    name: 'snippets',
    title: t('snip.manage'),
    wide: true,
    body: [h('p', { class: 'fp-form__hint' }, t('snip.manageHint')), list, error, h('div', { class: 'fp-snip__io' }, exportBtn, importBtn)],
    actions: [{ label: t('action.close'), value: 'close', primary: true }],
  })
}

/** Importe un fichier d'extraits ; le nombre ajouté, ou null si le fichier n'en est pas un. */
export async function importSnippets(file: File): Promise<number | null> {
  if (file.size > SNIPPET_LIMITS.json) return null
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    return null
  }
  const items = raw && typeof raw === 'object' && Array.isArray((raw as { snippets?: unknown }).snippets) ? ((raw as { snippets: unknown[] }).snippets) : Array.isArray(raw) ? raw : null
  if (!items) return null
  await loadSnippets()
  let added = 0
  const now = new Date().toISOString()
  for (const r of items) {
    if (cache.length >= SNIPPET_LIMITS.count) break
    const s = cleanSnippet(r, now)
    if (!s) continue
    // Même nom : remplacé ; raccourci déjà pris : retiré.
    const same = cache.find((x) => x.name.toLocaleLowerCase() === s.name.toLocaleLowerCase())
    if (same) s.id = same.id
    if (s.shortcut && cache.some((x) => x.id !== s.id && x.shortcut.toLocaleLowerCase() === s.shortcut.toLocaleLowerCase())) s.shortcut = ''
    if (await putSnippet(s)) added++
  }
  return added
}
