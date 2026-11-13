// Barre Rechercher et remplacer (Ctrl+F, Ctrl+H) : non modale, au-dessus de
// la page. Options : respecter la casse, mot entier, expression régulière,
// texte surligné seulement.

import type { FolioApp } from '../app'
import { findNext, findState, replaceAll, replaceCurrent, setQuery, type FindQuery } from '../editor/find'
import { t } from '../i18n/i18n'
import { h, icon } from './dom'
import { ICONS, RIBBON_ICONS as I } from './icons'
import { toast } from './dialog'

let bar: FindBar | null = null

class FindBar {
  readonly el: HTMLElement
  private readonly find: HTMLInputElement
  private readonly repl: HTMLInputElement
  private readonly count: HTMLElement
  private readonly replRow: HTMLElement
  private opts = { caseSensitive: false, wholeWord: false, regex: false, highlighted: false }
  private optButtons: Record<string, HTMLButtonElement> = {}
  private off: () => void

  constructor(private app: FolioApp) {
    this.find = h('input', { type: 'search', class: 'fp-find__input', id: 'fp-find-input', 'aria-label': t('find.find'), placeholder: t('find.find'), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement
    this.repl = h('input', { type: 'text', class: 'fp-find__input', id: 'fp-replace-input', 'aria-label': t('find.replaceWith'), placeholder: t('find.replaceWith'), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement
    this.count = h('span', { class: 'fp-find__count', id: 'fp-find-count', 'aria-live': 'polite' })
    const opt = (key: keyof typeof this.opts, label: string, ic: string) => {
      const b = h('button', { type: 'button', class: 'fp-iconbtn fp-find__opt', 'data-opt': key, 'aria-pressed': 'false', title: label, 'aria-label': label }) as HTMLButtonElement
      b.append(icon(ic))
      b.addEventListener('click', () => {
        this.opts[key] = !this.opts[key]
        b.setAttribute('aria-pressed', String(this.opts[key]))
        this.search()
      })
      this.optButtons[key] = b
      return b
    }
    const btn = (id: string, label: string, ic: string | null, run: () => void) => {
      const b = h('button', { type: 'button', class: ic ? 'fp-iconbtn' : 'fp-btn fp-btn--small', 'data-find': id, title: label, 'aria-label': label })
      if (ic) b.append(icon(ic))
      else b.textContent = label
      b.addEventListener('click', run)
      return b
    }
    this.replRow = h(
      'div',
      { class: 'fp-find__row' },
      this.repl,
      btn('replace', t('find.replace'), null, () => {
        this.app.run(replaceCurrent(this.repl.value), false)
        this.reveal()
      }),
      btn('replace-all', t('find.replaceAll'), null, () => {
        const before = findState(this.app.state)?.matches.length ?? 0
        this.app.run(replaceAll(this.repl.value), false)
        toast(t('find.replacedAll', { n: before }), { kind: before ? 'success' : 'info' })
      }),
    )
    this.el = h(
      'div',
      { class: 'fp-find', id: 'fp-find', role: 'search', 'aria-label': t('find.title') },
      h(
        'div',
        { class: 'fp-find__row' },
        this.find,
        this.count,
        opt('caseSensitive', t('find.matchCase'), I.matchCase),
        opt('wholeWord', t('find.wholeWord'), I.wholeWord),
        opt('regex', t('find.regex'), I.regex),
        opt('highlighted', t('find.highlighted'), I.highlight),
        btn('prev', t('find.prev'), I.arrowUp, () => this.go(-1)),
        btn('next', t('find.next'), I.arrowDown, () => this.go(1)),
        btn('close', t('action.close'), ICONS.close, () => this.close()),
      ),
      this.replRow,
    )
    this.find.addEventListener('input', () => this.search())
    this.find.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.go(e.shiftKey ? -1 : 1)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.close()
      }
    })
    this.repl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.app.run(replaceCurrent(this.repl.value), false)
        this.reveal()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.close()
      }
    })
    this.off = app.onChange(() => this.renderCount())
  }

  query(): FindQuery {
    return { text: this.find.value, ...this.opts }
  }

  search(): void {
    this.app.run(setQuery(this.query()), false)
    this.renderCount()
    this.reveal()
  }

  go(dir: 1 | -1): void {
    this.app.run(findNext(dir), false)
    this.renderCount()
    this.reveal()
  }

  /**
   * Fait défiler la page jusqu'au résultat courant. ProseMirror ne défile pas
   * vers la sélection quand le focus est hors de l'éditeur (ici, dans le champ
   * de recherche) : on défile nous-mêmes.
   */
  reveal(): void {
    const hit = this.app.view.dom.querySelector('.fp-find-hit--current')
    hit?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }

  renderCount(): void {
    const fs = findState(this.app.state)
    this.find.removeAttribute('aria-invalid')
    if (!fs || !(fs.query?.text || fs.query?.highlighted)) this.count.textContent = ''
    else if (fs.error) {
      this.count.textContent = t('find.invalid')
      this.find.setAttribute('aria-invalid', 'true')
    } else if (!fs.matches.length) this.count.textContent = t('find.none')
    else {
      const { from, to } = this.app.state.selection
      const i = fs.matches.findIndex((m) => m.from === from && m.to === to)
      this.count.textContent = i >= 0 ? t('find.position', { i: i + 1, n: fs.matches.length }) : t('find.count', { n: fs.matches.length })
      if (fs.truncated) this.count.textContent += '+'
    }
  }

  setOpt(key: keyof typeof this.opts, on: boolean): void {
    this.opts[key] = on
    this.optButtons[key].setAttribute('aria-pressed', String(on))
  }

  /** highlighted : ouvre directement sur « texte surligné seulement », champ vide. */
  open(replace: boolean, highlighted = false): void {
    this.replRow.hidden = !replace
    this.el.classList.toggle('with-replace', replace)
    const { from, to, empty } = this.app.state.selection
    if (highlighted) {
      this.setOpt('highlighted', true)
      this.find.value = ''
    } else if (!empty) {
      const text = this.app.state.doc.textBetween(from, to, ' ')
      if (text.length < 200 && !text.includes('\n')) this.find.value = text
    }
    this.find.focus()
    this.find.select()
    this.search()
  }

  close(): void {
    this.app.run(setQuery(null), false)
    this.off()
    this.el.remove()
    bar = null
    this.app.focus()
  }
}

export function openFindBar(app: FolioApp, host: HTMLElement, replace: boolean, highlighted = false): void {
  if (!bar) {
    bar = new FindBar(app)
    host.append(bar.el)
  }
  bar.open(replace, highlighted)
}

export const findBarOpen = () => !!bar
