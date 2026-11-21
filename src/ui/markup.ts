// Révision → Marques : quelles marques se voient (commentaires, ajouts et
// suppressions, mise en forme) et de quels réviseurs. Le filtre vaut pour la
// session (comme dans les traitements de texte habituels) ; il agit sur
// l'affichage (classes du texte, règles par auteur) et sur le volet Vérifications.

import type { FolioApp } from '../app'
import { threadsOf } from '../editor/comments'
import { changesOf } from '../editor/track'
import { t } from '../i18n/i18n'
import { h } from './dom'
import { popItem } from './popover'

export type MarkupType = 'comments' | 'changes' | 'format'
export const MARKUP_TYPES: readonly MarkupType[] = ['comments', 'changes', 'format']

const hiddenTypes = new Set<MarkupType>()
const hiddenAuthors = new Set<string>()
let style: HTMLStyleElement | null = null

export const isTypeShown = (k: MarkupType): boolean => !hiddenTypes.has(k)
export const isAuthorShown = (a: string): boolean => !hiddenAuthors.has(a || '—')
export const isFiltered = (): boolean => hiddenTypes.size > 0 || hiddenAuthors.size > 0

/** Classes du texte selon le filtre (ajoutées à « fp-prose »). */
export const markupClasses = (): string => [...hiddenTypes].map((k) => ` markup-no-${k}`).join('')

/** Les réviseurs du document : auteurs des modifications et des commentaires, dans l'ordre alphabétique. */
export function reviewers(app: FolioApp): string[] {
  const names = new Set<string>()
  for (const c of changesOf(app.state.doc)) names.add(c.author || '—')
  for (const th of threadsOf(app.state)) {
    names.add(th.author || '—')
    for (const r of th.replies) names.add(r.author || '—')
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

/** Règles d'affichage des réviseurs masqués : leurs marques ne se voient plus. */
function applyAuthors(app: FolioApp): void {
  if (!style) {
    style = h('style', { id: 'fp-markup-filter', 'data-folio-transient': '' }) as HTMLStyleElement
    document.head.append(style)
  }
  const rules: string[] = []
  for (const a of hiddenAuthors) {
    const v = CSS.escape(a === '—' ? '' : a)
    rules.push(`.fp-prose .fp-ins[data-author="${v}"]{color:inherit;text-decoration:inherit}`, `.fp-prose .fp-del[data-author="${v}"]{display:none}`, `.fp-prose .fp-fmt[data-author="${v}"]{border-bottom:0}`, `.fp-prose .fp-fmt-para[data-fmt-author="${v}"]{box-shadow:none}`)
  }
  // Commentaires : ceux dont le fil a été ouvert par un réviseur masqué.
  for (const th of threadsOf(app.state)) if (hiddenAuthors.has(th.author || '—')) rules.push(`.fp-prose .fp-comment[data-comment="${CSS.escape(th.id)}"]{background:none;border:0;box-shadow:none}`)
  style.textContent = rules.join('\n')
}

function changed(app: FolioApp): void {
  applyAuthors(app)
  app.view.setProps({})
  app.notifyUi()
}

export function toggleType(app: FolioApp, k: MarkupType): void {
  if (hiddenTypes.has(k)) hiddenTypes.delete(k)
  else hiddenTypes.add(k)
  changed(app)
}

export function toggleAuthor(app: FolioApp, a: string): void {
  if (hiddenAuthors.has(a)) hiddenAuthors.delete(a)
  else hiddenAuthors.add(a)
  changed(app)
}

export function showAll(app: FolioApp): void {
  hiddenTypes.clear()
  hiddenAuthors.clear()
  changed(app)
}

/** Le menu du filtre : types de marques, puis réviseurs. */
export function markupMenu(app: FolioApp): HTMLElement {
  const check = (label: string, on: boolean, run: () => void, data: Record<string, string>) => popItem(label, run, { ...data, role: 'menuitemcheckbox', 'aria-checked': String(on) })
  const people = reviewers(app)
  return h(
    'div',
    { class: 'fp-pop__list', role: 'menu' },
    ...MARKUP_TYPES.map((k) => check(t(`markup.${k}`), isTypeShown(k), () => toggleType(app, k), { 'data-markup': k })),
    h('hr', { class: 'fp-pop__sep' }),
    h('div', { class: 'fp-pop__heading' }, t('markup.people')),
    check(t('markup.allPeople'), hiddenAuthors.size === 0, () => (hiddenAuthors.size ? showAll(app) : undefined), { 'data-markup-person': '*' }),
    ...(people.length ? people.map((p) => check(p, isAuthorShown(p), () => toggleAuthor(app, p), { 'data-markup-person': p })) : [h('div', { class: 'fp-pop__note' }, t('markup.nobody'))]),
  )
}
