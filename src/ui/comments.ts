// Volet des commentaires, à droite de la page : les fils dans l'ordre du texte,
// leurs réponses, la résolution. Un clic sur un fil montre son texte ; le fil
// du texte sous le curseur est mis en évidence. Le surlignage des passages
// commentés (plus marqué pour le fil courant, effacé pour les fils résolus)
// vient d'une feuille de style recalculée ici : rien n'est écrit dans le texte.

import type { FolioApp } from '../app'
import {
  addComment,
  commentsAt,
  commentsKey,
  deleteComment,
  deleteReply,
  editComment,
  placedThreads,
  replyToComment,
  selectComment,
  setCommentDraft,
  setResolved,
  threadsOf,
  wordAt,
  type PlacedThread,
} from '../editor/comments'
import type { CommentReply } from '../format/types'
import { lang, t } from '../i18n/i18n'
import { settings, updateSettings } from '../settings'
import { openDialog, toast } from './dialog'
import { h, icon } from './dom'
import { ICONS } from './icons'

/** Fenêtre trop étroite pour un volet à côté de la page. */
const narrow = () => window.innerWidth < 1000

type Draft = { kind: 'new' } | { kind: 'reply'; id: string } | { kind: 'edit'; id: string; index: number }

/** Initiales et teinte d'un auteur (toujours la même pour le même nom). */
function avatar(name: string): HTMLElement {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const initials = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase()
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  return h('span', { class: 'fp-cm__avatar', style: `--hue:${hash % 360}`, 'aria-hidden': 'true' }, initials)
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(lang(), { dateStyle: 'medium', timeStyle: 'short' }).format(d)
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ')
  }
}

/** Le nom de l'auteur : demandé une fois, puis gardé dans ce navigateur. */
export function withAuthor(app: FolioApp, then: (name: string) => void): void {
  const known = settings().authorName
  if (known) return then(known)
  const field = h('input', { type: 'text', class: 'fp-input', 'data-field': 'author-name', maxlength: '100', value: (app.state.doc.attrs.author as string) || '' }) as HTMLInputElement
  openDialog({
    name: 'author-name',
    title: t('comment.whoTitle'),
    body: [h('label', { class: 'fp-form__row' }, h('span', {}, t('comment.who')), field), h('p', { class: 'fp-muted' }, t('comment.whoHelp'))],
    focus: field,
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const name = field.value.trim().slice(0, 100)
          if (!name) return false
          updateSettings({ authorName: name })
          setTimeout(() => then(name), 0)
          return true
        },
      },
    ],
  })
}

export class CommentsPane {
  readonly el: HTMLElement
  private readonly list: HTMLElement
  private readonly style: HTMLStyleElement
  private readonly resolvedToggle: HTMLInputElement
  private key = ''
  private styleKey = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  private draft: Draft | null = null
  private draftText = ''
  /** Fil mis en évidence (sous le curseur, ou choisi dans le volet). */
  current: string | null = null
  private lastSelection = ''

  constructor(private app: FolioApp) {
    this.list = h('div', { class: 'fp-cm__list' })
    this.resolvedToggle = h('input', { type: 'checkbox', 'data-field': 'show-resolved' }) as HTMLInputElement
    this.resolvedToggle.checked = true
    this.resolvedToggle.addEventListener('change', () => this.render(true))
    const close = h('button', { type: 'button', class: 'fp-iconbtn', 'aria-label': t('action.close'), title: t('action.close'), onclick: () => this.toggle(false) }, icon(ICONS.close))
    this.el = h(
      'aside',
      { class: 'fp-cm', id: 'fp-comments', 'aria-label': t('comment.pane') },
      h('div', { class: 'fp-cm__head' }, h('h2', { class: 'fp-cm__title' }, t('comment.pane')), close),
      h('label', { class: 'fp-cm__filter' }, this.resolvedToggle, h('span', {}, t('comment.showResolved'))),
      this.list,
    )
    this.style = h('style', { id: 'fp-comment-style', 'data-folio-transient': '' }) as HTMLStyleElement
    document.head.append(this.style)
    this.el.hidden = !settings().commentsPane || !threadsOf(app.state).length || narrow()
    app.onChange(() => this.changed())
    this.changed()
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  toggle(on = this.el.hidden): void {
    updateSettings({ commentsPane: on })
    this.el.hidden = !on
    if (on) this.render(true)
    window.dispatchEvent(new Event('resize'))
    this.app.notifyUi()
  }

  /** Après chaque changement : fil courant, surlignage, volet. */
  private changed(): void {
    const s = this.app.state
    const sel = `${s.selection.from}:${s.selection.to}`
    if (sel !== this.lastSelection && !this.app.alt) {
      this.lastSelection = sel
      const here = commentsAt(s)
      // Le fil choisi dans le volet reste courant tant que le curseur est dans son texte.
      this.current = this.current && here.includes(this.current) ? this.current : (here[0] ?? null)
    }
    this.updateStyle()
    // Un premier commentaire (chargé ou collé par annulation) ouvre le volet, sauf s'il a été fermé
    // ou si la fenêtre est étroite (il couvrirait la page).
    if (this.el.hidden && settings().commentsPane && threadsOf(s).length && !this.app.alt && !narrow()) this.el.hidden = false
    this.schedule()
  }

  private schedule(): void {
    if (this.el.hidden || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.render()
    }, 80)
  }

  /** Surlignage : fils résolus effacés, fil courant renforcé. */
  private updateStyle(): void {
    const threads = threadsOf(this.app.state)
    const resolved = threads.filter((x) => x.resolved).map((x) => x.id)
    const key = JSON.stringify([resolved, this.current])
    if (key === this.styleKey) return
    this.styleKey = key
    const sel = (id: string) => `.fp-prose .fp-comment[data-comment="${id}"]`
    const rules: string[] = []
    if (resolved.length) rules.push(`${resolved.map(sel).join(',')}{background:none;border-bottom-color:transparent}`)
    if (this.current && !resolved.includes(this.current)) rules.push(`${sel(this.current)}{background:var(--fp-comment-current);border-bottom-color:var(--fp-comment-line-current)}`)
    this.style.textContent = rules.join('\n')
  }

  /** Commencer un commentaire sur la sélection (ou le mot sous le curseur). */
  startNew(): void {
    const app = this.app
    if (app.reading) return
    if (app.alt) {
      toast(t('comment.cannot'), { kind: 'info' })
      return
    }
    const s = app.state
    const range = s.selection.empty ? wordAt(s) : { from: s.selection.from, to: s.selection.to }
    if (!range || !addComment({ author: '', date: '', text: '' }, range)(s)) {
      toast(t('comment.select'), { kind: 'info' })
      return
    }
    withAuthor(app, () => {
      app.view.dispatch(setCommentDraft(app.state, range))
      this.draft = { kind: 'new' }
      this.draftText = ''
      updateSettings({ commentsPane: true })
      this.el.hidden = false
      window.dispatchEvent(new Event('resize'))
      this.render(true)
      this.focusDraft()
      app.notifyUi()
    })
  }

  private focusDraft(): void {
    requestAnimationFrame(() => {
      const box = this.list.querySelector<HTMLTextAreaElement>('textarea')
      if (!box) return
      box.focus()
      box.setSelectionRange(box.value.length, box.value.length)
      box.closest('.fp-cm__card')?.scrollIntoView({ block: 'nearest' })
    })
  }

  private cancelDraft(): void {
    const wasNew = this.draft?.kind === 'new'
    this.draft = null
    this.draftText = ''
    if (wasNew) this.app.view.dispatch(setCommentDraft(this.app.state, null))
    this.render(true)
    this.app.focus()
  }

  private submitDraft(): void {
    const text = this.draftText.trim()
    const d = this.draft
    if (!d || !text) return
    const app = this.app
    const me: CommentReply = { author: settings().authorName, date: new Date().toISOString(), text }
    if (d.kind === 'new') {
      const range = commentsKey.getState(app.state)?.draft
      this.draft = null
      this.draftText = ''
      app.view.dispatch(setCommentDraft(app.state, null))
      if (!range || !app.run(addComment(me, range, (id) => (this.current = id)), false)) toast(t('comment.lost'), { kind: 'error' })
    } else if (d.kind === 'reply') {
      this.draft = null
      this.draftText = ''
      app.run(replyToComment(d.id, me), false)
    } else {
      this.draft = null
      this.draftText = ''
      app.run(editComment(d.id, d.index, text), false)
    }
    this.render(true)
    app.focus()
  }

  /** Zone d'écriture (nouveau commentaire, réponse, modification). */
  private composer(placeholder: string, submitLabel: string): HTMLElement {
    const area = h('textarea', { class: 'fp-cm__input', rows: '3', placeholder, 'aria-label': placeholder, 'data-field': 'comment-text' }) as HTMLTextAreaElement
    area.value = this.draftText
    const submit = h('button', { type: 'button', class: 'fp-btn fp-btn--primary fp-btn--small', 'data-action': 'comment-submit', onclick: () => this.submitDraft() }, submitLabel) as HTMLButtonElement
    submit.disabled = !this.draftText.trim()
    area.addEventListener('input', () => {
      this.draftText = area.value
      submit.disabled = !area.value.trim()
    })
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        this.submitDraft()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.cancelDraft()
      }
    })
    const cancel = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-action': 'comment-cancel', onclick: () => this.cancelDraft() }, t('action.cancel'))
    return h('div', { class: 'fp-cm__compose' }, area, h('div', { class: 'fp-cm__compose-actions' }, cancel, submit))
  }

  private message(m: CommentReply, id: string, index: number): HTMLElement {
    const editing = this.draft?.kind === 'edit' && this.draft.id === id && this.draft.index === index
    const actions = h(
      'span',
      { class: 'fp-cm__msg-actions' },
      h('button', { type: 'button', class: 'fp-cm__link', 'data-action': 'edit', onclick: () => this.begin({ kind: 'edit', id, index }, m.text) }, t('comment.edit')),
      index >= 0 ? h('button', { type: 'button', class: 'fp-cm__link', 'data-action': 'delete-reply', onclick: () => this.app.run(deleteReply(id, index), false) }, t('comment.deleteReply')) : null,
    )
    return h(
      'div',
      { class: 'fp-cm__msg', 'data-index': String(index) },
      h('div', { class: 'fp-cm__who' }, avatar(m.author || '?'), h('span', { class: 'fp-cm__author' }, m.author || t('comment.anonymous')), h('time', { class: 'fp-cm__date', datetime: m.date || null }, formatDate(m.date))),
      editing ? this.composer(t('comment.editPlaceholder'), t('comment.save')) : h('p', { class: 'fp-cm__text' }, m.text || '—'),
      editing ? null : actions,
    )
  }

  private begin(d: Draft, text = ''): void {
    if (this.draft?.kind === 'new') this.app.view.dispatch(setCommentDraft(this.app.state, null))
    this.draft = d
    this.draftText = text
    this.render(true)
    this.focusDraft()
  }

  private card(p: PlacedThread): HTMLElement {
    const th = p.thread
    const id = th.id
    const replying = this.draft?.kind === 'reply' && this.draft.id === id
    const el = h(
      'article',
      {
        class: 'fp-cm__card' + (th.resolved ? ' is-resolved' : '') + (id === this.current ? ' is-current' : '') + (p.from === null ? ' is-orphan' : ''),
        'data-comment': id,
        'aria-label': t('comment.by', { name: th.author || t('comment.anonymous') }),
      },
      p.quote ? h('blockquote', { class: 'fp-cm__quote' }, p.quote.length > 140 ? p.quote.slice(0, 140) + '…' : p.quote) : null,
      this.message(th, id, -1),
      ...th.replies.map((r, i) => this.message(r, id, i)),
      replying ? this.composer(t('comment.replyPlaceholder'), t('comment.reply')) : null,
      h(
        'div',
        { class: 'fp-cm__actions' },
        !replying && !th.resolved ? h('button', { type: 'button', class: 'fp-cm__link', 'data-action': 'reply', onclick: () => this.begin({ kind: 'reply', id }) }, t('comment.reply')) : null,
        h(
          'button',
          { type: 'button', class: 'fp-cm__link', 'data-action': th.resolved ? 'reopen' : 'resolve', onclick: () => this.app.run(setResolved(id, !th.resolved), false) },
          th.resolved ? t('comment.reopen') : t('comment.resolve'),
        ),
        h('button', { type: 'button', class: 'fp-cm__link fp-cm__link--danger', 'data-action': 'delete', onclick: () => this.app.run(deleteComment(id), false) }, t('comment.delete')),
      ),
    )
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button, textarea')) return
      this.current = id
      this.updateStyle()
      this.render(true)
      if (p.from !== null) this.app.run(selectComment(id), false)
    })
    return el
  }

  render(force = false): void {
    if (this.el.hidden) return
    const state = this.app.state
    const placed = placedThreads(state).filter((p) => this.resolvedToggle.checked || !p.thread.resolved || p.thread.id === this.current)
    const draftRange = this.draft?.kind === 'new' ? commentsKey.getState(state)?.draft ?? null : null
    const key = JSON.stringify([placed.map((p) => [p.thread, p.from, p.quote]), this.current, this.draft, draftRange, lang()])
    if (!force && key === this.key) return
    // On n'efface pas ce qu'on est en train d'écrire.
    const typing = this.list.contains(document.activeElement) && document.activeElement?.tagName === 'TEXTAREA'
    this.key = key
    const cards: HTMLElement[] = []
    let draftPlaced = !draftRange
    const draftCard = () =>
      h(
        'article',
        { class: 'fp-cm__card is-draft is-current', 'data-comment': '' },
        h('blockquote', { class: 'fp-cm__quote' }, state.doc.textBetween(draftRange!.from, draftRange!.to, ' ', ' ').slice(0, 140)),
        h('div', { class: 'fp-cm__who' }, avatar(settings().authorName), h('span', { class: 'fp-cm__author' }, settings().authorName)),
        this.composer(t('comment.placeholder'), t('comment.post')),
      )
    for (const p of placed) {
      if (!draftPlaced && (p.from === null || p.from > draftRange!.from)) {
        cards.push(draftCard())
        draftPlaced = true
      }
      if (p.from === null && !cards.some((c) => c.classList.contains('fp-cm__orphans'))) cards.push(h('h3', { class: 'fp-cm__orphans' }, t('comment.orphans')))
      cards.push(this.card(p))
    }
    if (!draftPlaced) cards.push(draftCard())
    if (!cards.length) cards.push(h('p', { class: 'fp-cm__empty' }, t('comment.empty')))
    this.list.replaceChildren(...cards)
    if (typing) this.focusDraft()
    else this.list.querySelector('.fp-cm__card.is-current')?.scrollIntoView({ block: 'nearest' })
  }
}
