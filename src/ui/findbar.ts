// Barre Rechercher et remplacer (Ctrl+F, Ctrl+H) : non modale, au-dessus de
// la page. Options : respecter la casse, mot entier, expression régulière,
// texte surligné seulement. Les notes de bas de page et de fin sont cherchées
// avec le texte : un résultat dans une note l'ouvre, à sa place.

import { closeHistory } from 'prosemirror-history'
import { TextSelection, type Command } from 'prosemirror-state'
import type { FolioApp } from '../app'
import { currentMatch, findKey, findNext, findState, replaceAll, replaceCurrent, setQuery, type FindQuery } from '../editor/find'
import { getPageView } from './panels'
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
      btn('replace', t('find.replace'), null, () => this.replaceOne()),
      btn('replace-all', t('find.replaceAll'), null, () => {
        if (this.app.reading) return
        getPageView()?.closeEditor()
        const before = findState(this.app.state)?.matches.length ?? 0
        this.main(replaceAll(this.repl.value), true)
        this.sync()
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
        this.replaceOne()
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

  /**
   * Les commandes de recherche vont au texte du document, même quand une note ou un en-tête est ouvert.
   * `step` : un remplacement est une étape d'annulation à lui seul (jamais fondue avec la précédente).
   */
  private main(cmd: Command, step = false): boolean {
    const v = this.app.view
    return cmd(v.state, (tr) => v.dispatch(step ? closeHistory(tr) : tr), v)
  }

  search(): void {
    this.main(setQuery(this.query()))
    this.sync()
  }

  go(dir: 1 | -1): void {
    this.main(findNext(dir))
    this.sync()
  }

  private replaceOne(): void {
    if (this.app.reading) return
    // La note ouverte rend d'abord ce qu'on y a écrit : le remplacement se fait dans le document.
    getPageView()?.closeEditor()
    this.main(replaceCurrent(this.repl.value), true)
    this.sync()
  }

  /**
   * Montre le résultat courant : dans le texte, sélectionné ; dans une note, la note s'ouvre à sa place,
   * le résultat y est sélectionné, et le champ de recherche garde le focus. Les autres notes dessinées
   * montrent leurs résultats.
   */
  private sync(): void {
    const pv = getPageView()
    const m = currentMatch(this.app.state)
    const query = findState(this.app.state)?.query ?? null
    const focused = document.activeElement
    if (m?.note !== undefined && pv && !this.app.reading) {
      if (pv.openNotePos !== m.note) pv.openNote(m.note)
      const nv = pv.editingNote?.view
      if (nv && m.to <= nv.state.doc.content.size) nv.dispatch(nv.state.tr.setSelection(TextSelection.create(nv.state.doc, m.from, m.to)).setMeta(findKey, { query }))
      if (focused instanceof HTMLInputElement && this.el.contains(focused)) focused.focus()
    } else if (pv?.openNotePos != null) pv.closeEditor()
    pv?.refreshFindHits()
    this.renderCount()
    this.reveal()
  }

  /**
   * Fait défiler la page jusqu'au résultat courant. ProseMirror ne défile pas
   * vers la sélection quand le focus est hors de l'éditeur (ici, dans le champ
   * de recherche) : on défile nous-mêmes.
   */
  reveal(): void {
    const note = getPageView()?.editingNote?.view.dom
    const hit = (note?.querySelector('.fp-find-hit--current') ?? this.app.view.dom.querySelector('.fp-find-hit--current')) as HTMLElement | null
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
      // Position : le résultat courant s'il est sélectionné (ou dans une note, où va la recherche).
      const { from, to } = this.app.state.selection
      const cur = fs.matches[fs.current]
      const i = cur && (cur.note !== undefined || (cur.from === from && cur.to === to)) ? fs.current : -1
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
    this.main(setQuery(null))
    const nv = getPageView()?.editingNote?.view
    if (nv) nv.dispatch(nv.state.tr.setMeta(findKey, { query: null }))
    getPageView()?.refreshFindHits()
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
