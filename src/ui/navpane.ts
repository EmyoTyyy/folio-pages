// Volet de navigation : le plan du document par ses titres. Un clic y mène ;
// le titre où se trouve le curseur est mis en évidence.

import { TextSelection } from 'prosemirror-state'
import type { FolioApp } from '../app'
import { currentHeading, outline, type OutlineItem } from '../editor/outline'
import { t } from '../i18n/i18n'
import { settings, updateSettings } from '../settings'
import { h, icon } from './dom'
import { ICONS } from './icons'

export class NavPane {
  readonly el: HTMLElement
  private readonly list: HTMLElement
  private items: OutlineItem[] = []
  private key = ''
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private app: FolioApp,
    private pageOf: (pos: number) => string | null,
  ) {
    this.list = h('ol', { class: 'fp-nav__list', role: 'tree', 'aria-label': t('nav.title') })
    const close = h('button', { type: 'button', class: 'fp-iconbtn', 'aria-label': t('action.close'), title: t('action.close'), onclick: () => this.toggle(false) }, icon(ICONS.close))
    this.el = h(
      'aside',
      { class: 'fp-nav', id: 'fp-nav', 'aria-label': t('nav.title') },
      h('div', { class: 'fp-nav__head' }, h('h2', { class: 'fp-nav__title' }, t('nav.title')), close),
      this.list,
    )
    this.el.hidden = !settings().navPane
    app.onChange(() => this.schedule())
    this.render()
  }

  toggle(on = this.el.hidden): void {
    updateSettings({ navPane: on })
    this.el.hidden = !on
    if (on) this.render()
    window.dispatchEvent(new Event('resize'))
    this.app.notifyUi()
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  private schedule(): void {
    if (this.el.hidden || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.render()
    }, 120)
  }

  render(): void {
    if (this.el.hidden) return
    this.items = outline(this.app.state.doc)
    const cur = currentHeading(this.items, this.app.state.selection.from)
    const pages = this.items.map((it) => this.pageOf(it.pos))
    const key = JSON.stringify([this.items, cur, pages])
    if (key === this.key) return
    this.key = key
    this.list.replaceChildren()
    if (!this.items.length) {
      this.list.append(h('li', { class: 'fp-nav__empty' }, t('nav.empty')))
      return
    }
    this.items.forEach((it, i) => {
      const b = h(
        'button',
        { type: 'button', class: 'fp-nav__item' + (i === cur ? ' is-current' : ''), 'data-level': String(it.level), 'data-pos': String(it.pos), role: 'treeitem', 'aria-current': i === cur ? 'true' : null, style: `--level:${it.level}` },
        h('span', { class: 'fp-nav__text' }, it.text || t('nav.untitled')),
        pages[i] ? h('span', { class: 'fp-nav__page' }, pages[i]) : null,
      )
      b.addEventListener('click', () => this.go(it.pos))
      this.list.append(h('li', {}, b))
    })
  }

  private go(pos: number): void {
    const { view } = this.app
    const node = view.state.doc.nodeAt(pos)
    if (!node) return
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1 + node.content.size))
    view.dispatch(tr)
    const dom = view.nodeDOM(pos) as HTMLElement | null
    dom?.scrollIntoView({ block: 'start', behavior: 'auto' })
    view.focus()
  }
}
