// Révision → Volet Vérifications : toutes les marques du document dans une
// liste (ajouts, suppressions, mise en forme, commentaires), avec leur nombre,
// leur auteur et leur date. Un clic va à la marque ; ✓ et ✗ acceptent ou
// refusent une modification. À gauche (vertical) ou sous le texte (horizontal) ;
// la liste suit le filtre des marques.

import { TextSelection } from 'prosemirror-state'
import type { FolioApp } from '../app'
import { placedThreads } from '../editor/comments'
import { changesOf, resolveChanges, type TrackedChange } from '../editor/track'
import { settings, updateSettings } from '../settings'
import type { Key } from '../i18n/dict'
import { formatDate, t } from '../i18n/i18n'
import { h, icon } from './dom'
import { ICONS } from './icons'
import { isAuthorShown, isTypeShown } from './markup'

type Item = { kind: 'insert' | 'delete' | 'format' | 'comment'; from: number; to: number; author: string; date: string; text: string; change?: TrackedChange; block?: boolean; id?: string }

const excerpt = (s: string) => {
  const x = s.replace(/\s+/g, ' ').trim()
  return x.length > 140 ? `${x.slice(0, 137)}…` : x
}

export class ReviewPane {
  readonly el: HTMLElement
  private readonly list: HTMLElement
  private readonly summary: HTMLElement
  private readonly title: HTMLElement
  private timer: ReturnType<typeof setTimeout> | null = null
  private key = ''

  constructor(
    private app: FolioApp,
    private place: (side: 'vertical' | 'horizontal', el: HTMLElement) => void,
  ) {
    this.title = h('h2', { class: 'fp-review__title' })
    this.summary = h('p', { class: 'fp-review__summary', 'aria-live': 'polite' })
    this.list = h('ol', { class: 'fp-review__list' })
    const close = h('button', { type: 'button', class: 'fp-iconbtn', 'aria-label': t('action.close'), title: t('action.close'), onclick: () => this.show('off') }, icon(ICONS.close))
    this.el = h('aside', { class: 'fp-review', id: 'fp-review', 'aria-label': t('review.title') }, h('div', { class: 'fp-review__head' }, this.title, close), this.summary, this.list)
    app.onChange(() => this.schedule())
    this.show(settings().reviewPane, false)
  }

  get side(): 'off' | 'vertical' | 'horizontal' {
    return this.el.hidden ? 'off' : (this.el.dataset.side as 'vertical' | 'horizontal')
  }

  /** Ouvre le volet de ce côté, ou le ferme. */
  show(side: 'off' | 'vertical' | 'horizontal', remember = true): void {
    if (remember) updateSettings({ reviewPane: side })
    this.el.hidden = side === 'off'
    if (side !== 'off') {
      this.el.dataset.side = side
      this.place(side, this.el)
      this.key = ''
      this.render()
    }
    window.dispatchEvent(new Event('resize'))
    this.app.notifyUi()
  }

  private schedule(): void {
    if (this.el.hidden || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.render()
    }, 150)
  }

  private items(): Item[] {
    const state = this.app.state
    const out: Item[] = []
    for (const c of changesOf(state.doc)) {
      const text = c.block ? state.doc.nodeAt(c.from)?.textContent ?? '' : state.doc.textBetween(c.from, c.to, ' ', '￼')
      out.push({ kind: c.kind, from: c.from, to: c.to, author: c.author, date: c.date, text, change: c, block: c.block })
    }
    for (const p of placedThreads(state)) {
      if (p.from === null || p.to === null) continue
      out.push({ kind: 'comment', from: p.from, to: p.to, author: p.thread.author, date: p.thread.date, text: p.thread.text, id: p.thread.id })
    }
    return out.sort((a, b) => a.from - b.from || a.to - b.to)
  }

  render(): void {
    if (this.el.hidden) return
    const all = this.items()
    const type = (k: Item['kind']) => (k === 'comment' ? 'comments' : k === 'format' ? 'format' : 'changes')
    const shown = all.filter((it) => isTypeShown(type(it.kind)) && isAuthorShown(it.author))
    const count = (k: Item['kind']) => shown.filter((it) => it.kind === k).length
    const key = JSON.stringify([shown.map((it) => [it.kind, it.from, it.to, it.author, it.date, it.text]), all.length])
    if (key === this.key) return
    this.key = key
    this.title.textContent = t('review.count', { n: shown.length })
    this.summary.replaceChildren(
      ...(['insert', 'delete', 'format', 'comment'] as const).map((k) => h('span', { class: `fp-review__stat fp-review__stat--${k}`, 'data-stat': k }, t(`review.${k}s` as Key, { n: count(k) }))),
    )
    this.list.replaceChildren()
    if (!shown.length) {
      this.list.append(h('li', { class: 'fp-review__empty' }, t(all.length ? 'review.allHidden' : 'review.none')))
      return
    }
    for (const it of shown) {
      const label = it.kind === 'format' && it.block ? t('review.paraFormat') : t(`review.kind.${it.kind}` as Key)
      const go = h(
        'button',
        { type: 'button', class: 'fp-review__go', 'data-review-kind': it.kind, 'data-from': String(it.from) },
        h('span', { class: 'fp-review__meta' }, h('span', { class: `fp-review__kind fp-review__kind--${it.kind}` }, label), h('span', { class: 'fp-review__author' }, it.author || '—'), it.date ? h('span', { class: 'fp-review__date' }, formatDate(it.date)) : null),
        h('span', { class: 'fp-review__text' }, excerpt(it.text) || '¶'),
      )
      go.addEventListener('click', () => this.go(it))
      const actions: HTMLElement[] = []
      if (it.change) {
        const c = it.change
        const accept = h('button', { type: 'button', class: 'fp-iconbtn fp-review__act', 'data-review-act': 'accept', title: t('review.accept'), 'aria-label': t('review.accept') }, icon(ICONS.check))
        const reject = h('button', { type: 'button', class: 'fp-iconbtn fp-review__act', 'data-review-act': 'reject', title: t('review.reject'), 'aria-label': t('review.reject') }, icon(ICONS.close))
        accept.addEventListener('click', () => this.app.run(resolveChanges(true, [c])))
        reject.addEventListener('click', () => this.app.run(resolveChanges(false, [c])))
        actions.push(accept, reject)
      }
      this.list.append(h('li', { class: 'fp-review__item' }, go, actions.length ? h('span', { class: 'fp-review__acts' }, ...actions) : null))
    }
  }

  private go(it: Item): void {
    const { view } = this.app
    const doc = view.state.doc
    const from = it.block ? it.from + 1 : it.from
    const to = it.block ? it.to - 1 : it.to
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, Math.min(from, doc.content.size), Math.min(to, doc.content.size))).scrollIntoView())
    view.focus()
  }
}
