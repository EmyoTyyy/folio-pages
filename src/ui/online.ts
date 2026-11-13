// Fonctions en ligne, toutes facultatives et bloquées en mode hors ligne :
// demander à une IA dans une fenêtre voisine, dicter, images en ligne
// (Wikimedia Commons), rechercher (Wikipédia) et synonymes (Wiktionnaire),
// polices en ligne (Google Fonts, intégrées au document).

import { TextSelection } from 'prosemirror-state'
import type { FolioApp } from '../app'
import { pmToDoc } from '../editor/convert'
import { insertImageFiles, markdownSlice } from '../editor/paste'
import { schema } from '../editor/schema'
import { blocksToMarkdown } from '../format/markdown-out'
import type { Key } from '../i18n/dict'
import { lang, t } from '../i18n/i18n'
import { isOffline, OfflineError, openUrl } from '../net'
import { AI_SITES, buildPrompt, extractAnswer, siteUrl, type AiSite } from '../online/ai'
import { canDictate, Dictation, spokenToText } from '../online/dictate'
import { downloadFamily, GOOGLE_FONTS, isFamilyName, type FontCategory } from '../online/fonts'
import { cleanTerm, definitions, wikipediaSummary, type Definitions, type Summary } from '../online/lookup'
import { creditOf, downloadPicture, searchPictures, type OnlinePicture } from '../online/pictures'
import { settings } from '../settings'
import { reportDialog, reportSummary, writeClipboard } from './actions'
import { openDialog, toast } from './dialog'
import { h, icon } from './dom'
import { ICONS } from './icons'
import { imageHooks } from './panels'

const n = schema.nodes

/** Langue du document (sinon celle de l'interface). */
const docLang = (app: FolioApp) => ((app.state.doc.attrs.lang as string) || lang()).slice(0, 2)

/** Hors ligne : la fonction ne part pas ; un message le dit. */
function blockedOffline(): boolean {
  if (!isOffline()) return false
  toast(t('offline.blocked'), { kind: 'info' })
  return true
}

const netError = (e: unknown) => (e instanceof OfflineError ? t('offline.blocked') : t('online.failed'))

// --- demander à une IA ------------------------------------------------------------------

/** Ce qui a été envoyé à l'IA : la sélection d'alors (pour y remettre la réponse). */
let pending: { site: AiSite; from: number; to: number; selection: boolean } | null = null

/** IA → Demander à Claude / ChatGPT : la demande et le document copiés, le site ouvert à côté. */
export function askAiDialog(app: FolioApp, site: AiSite = 'claude'): void {
  const { from, to, empty } = app.state.selection
  const which = h('select', { class: 'fp-input', 'data-field': 'ai-site' }, ...(Object.keys(AI_SITES) as AiSite[]).map((k) => h('option', { value: k }, AI_SITES[k].name))) as HTMLSelectElement
  which.value = site
  const request = h('textarea', { class: 'fp-input', rows: '4', 'data-field': 'ai-request', placeholder: t('aiw.placeholder'), maxlength: '4000' }) as HTMLTextAreaElement
  const scope = h('select', { class: 'fp-input', 'data-field': 'ai-scope' }, h('option', { value: 'doc' }, t('aiw.scopeDoc')), h('option', { value: 'selection', ...(empty ? { disabled: '' } : {}) }, t('aiw.scopeSelection'))) as HTMLSelectElement
  scope.value = empty ? 'doc' : 'selection'
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  openDialog({
    name: 'ask-ai',
    title: t('aiw.title'),
    wide: true,
    focus: request,
    body: [
      h('p', { class: 'fp-form__hint' }, t('aiw.intro')),
      h('div', { class: 'fp-form--grid' }, row(t('aiw.site'), which), row(t('aiw.scope'), scope)),
      row(t('aiw.request'), request),
      h('p', { class: 'fp-form__hint' }, t('aiw.privacy')),
      error,
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('aiw.go'),
        value: 'ok',
        primary: true,
        run: async () => {
          if (!request.value.trim()) {
            error.textContent = t('aiw.empty')
            return false
          }
          if (blockedOffline()) return false
          const s = which.value as AiSite
          const sel = scope.value === 'selection'
          const prompt = buildPrompt({
            request: request.value,
            lang: lang(),
            ...(sel ? { selection: selectionMarkdown(app, from, to) } : { json: app.json(true) }),
          })
          const copied = await writeClipboard(prompt)
          const { url, prefilled } = siteUrl(s, prompt)
          // Une fenêtre à part, à droite de l'écran : le document reste visible.
          const w = Math.min(560, Math.round(screen.availWidth * 0.4))
          const opened = !isOffline() && window.open(url, 'folio-ai', `popup,noopener,noreferrer,width=${w},height=${screen.availHeight},left=${screen.availWidth - w},top=0`)
          if (opened === false) return false
          pending = { site: s, from, to, selection: sel }
          toast(t(prefilled ? 'aiw.openedPrefilled' : copied ? 'aiw.openedCopied' : 'aiw.openedNoCopy', { site: AI_SITES[s].name }), {
            kind: 'info',
            timeout: 14000,
            action: { label: t('aiw.pasteNow'), run: () => pasteAiAnswerDialog(app) },
          })
          // Au retour dans Folio Pages : proposer de coller la réponse.
          const back = () => {
            window.removeEventListener('focus', back)
            if (pending) toast(t('aiw.back', { site: AI_SITES[s].name }), { kind: 'info', timeout: 20000, action: { label: t('aiw.pasteNow'), run: () => pasteAiAnswerDialog(app) } })
          }
          setTimeout(() => window.addEventListener('focus', back), 800)
          return true
        },
      },
    ],
  })
}

/** La sélection en Markdown (titres, listes, tableaux, gras… gardés). */
function selectionMarkdown(app: FolioApp, from: number, to: number): string {
  const cut = app.state.doc.cut(from, to)
  const doc = pmToDoc(cut, { id: 'selection', created: '', modified: '' })
  return blocksToMarkdown(doc.blocks).slice(0, 200_000)
}

/** IA → Coller la réponse : un document JSON remplace le document ; du Markdown, la sélection d'alors. */
export function pasteAiAnswerDialog(app: FolioApp): void {
  const area = h('textarea', { class: 'fp-code fp-code--tall', 'data-field': 'ai-answer', spellcheck: 'false', placeholder: t('aiw.answerPlaceholder') }) as HTMLTextAreaElement
  const what = h('p', { class: 'fp-form__hint', 'data-field': 'ai-answer-kind', 'aria-live': 'polite' })
  const describe = () => {
    const a = extractAnswer(area.value)
    what.textContent = !a ? '' : a.kind === 'json' ? t('aiw.willReplaceDoc') : pending?.selection ? t('aiw.willReplaceSelection') : t('aiw.willInsert')
  }
  area.addEventListener('input', describe)
  const fromClipboard = h('button', { type: 'button', class: 'fp-btn', 'data-ai-clipboard': '' }, t('aiw.fromClipboard'))
  fromClipboard.addEventListener('click', async () => {
    try {
      area.value = (await navigator.clipboard.readText()).slice(0, 50_000_000)
      describe()
    } catch {
      toast(t('aiw.clipboardDenied'), { kind: 'info' })
    }
  })
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  openDialog({
    name: 'ai-answer',
    title: t('aiw.answerTitle'),
    wide: true,
    focus: area,
    body: [h('p', {}, t('aiw.answerIntro')), fromClipboard, area, what, error],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('aiw.apply'),
        value: 'ok',
        primary: true,
        run: () => {
          const a = extractAnswer(area.value)
          if (!a) {
            error.textContent = t('aiw.answerEmpty')
            return false
          }
          if (a.kind === 'json') {
            const res = app.loadInto(a.json)
            if (!res.ok) {
              error.textContent = t('aiw.answerBad')
              return false
            }
            const summary = reportSummary(res.report)
            toast(summary ? `${t('aiw.applied')} ${summary}` : t('aiw.applied'), { kind: summary ? 'warning' : 'success', action: summary ? { label: t('action.details'), run: () => reportDialog(app) } : undefined })
          } else {
            const p = pending
            app.run((state, dispatch) => {
              const size = state.doc.content.size
              let tr = state.tr
              if (p?.selection && p.to <= size) tr = tr.setSelection(TextSelection.create(tr.doc, p.from, p.to))
              dispatch?.(tr.replaceSelection(markdownSlice(a.md)).scrollIntoView())
              return true
            })
            toast(t('aiw.applied'), { kind: 'success' })
          }
          pending = null
          return true
        },
      },
    ],
  })
}

// --- dicter -----------------------------------------------------------------------------

let dictation: Dictation | null = null
let bubble: HTMLElement | null = null

export const isDictating = (): boolean => !!dictation
export { canDictate }

/** Accueil → Dicter : écoute et écrit au curseur ; un second clic arrête. */
export function toggleDictation(app: FolioApp, language?: string): void {
  if (dictation) {
    dictation.stop()
    return
  }
  if (!canDictate()) return void toast(t('dict.unsupported'), { kind: 'info', timeout: 9000 })
  if (blockedOffline()) return
  const code = language ?? dictationLang(app)
  try {
    dictation = new Dictation(code, {
      onFinal: (text) => {
        const s = app.state
        const before = s.doc.textBetween(Math.max(0, s.selection.from - 2), s.selection.from, '\n', '\n')
        const start = !before.trim() || /[.!?…]\s*$/.test(before) || s.selection.$from.parentOffset === 0
        let out = spokenToText(text, code, start)
        if (!out) return
        if (before && !/\s$/.test(before) && !/^[.,;:!?…»”)\n]/.test(out)) out = ' ' + out
        // Les retours à la ligne dictés : nouveaux paragraphes.
        const parts = out.split('\n')
        app.run((state, dispatch) => {
          let tr = state.tr
          parts.forEach((p, i) => {
            if (i > 0 && parts[i - 1] !== '' ) tr = tr.split(tr.selection.from)
            else if (i > 0) return
            if (p) tr = tr.insertText(p)
          })
          dispatch?.(tr.scrollIntoView())
          return true
        }, false)
      },
      onInterim: (text) => {
        if (bubble) bubble.querySelector('.fp-dictate__text')!.textContent = text || t('dict.listening')
      },
      onEnd: (err) => {
        dictation = null
        bubble?.remove()
        bubble = null
        if (err && err !== 'aborted' && err !== 'no-speech') toast(t(err === 'not-allowed' || err === 'service-not-allowed' ? 'dict.denied' : 'dict.error'), { kind: 'error', timeout: 9000 })
        app.notifyUi()
      },
    })
    dictation.start()
  } catch {
    dictation = null
    return void toast(t('dict.unsupported'), { kind: 'info' })
  }
  bubble = h(
    'div',
    { class: 'fp-dictate', role: 'status', 'aria-live': 'polite' },
    icon(ICONS.mic),
    h('span', { class: 'fp-dictate__text' }, t('dict.listening')),
    h('button', { type: 'button', class: 'fp-btn fp-btn--small', onclick: () => dictation?.stop() }, t('dict.stop')),
  )
  document.body.append(bubble)
  app.notifyUi()
  app.focus()
}

/** Langue de dictée : celle du document (région devinée). */
function dictationLang(app: FolioApp): string {
  const l = (app.state.doc.attrs.lang as string) || lang()
  if (l.includes('-')) return l
  return { fr: 'fr-FR', en: 'en-US', de: 'de-DE', es: 'es-ES', it: 'it-IT', pt: 'pt-PT', nl: 'nl-NL' }[l.slice(0, 2)] ?? l
}

export const DICTATION_LANGS = ['fr-FR', 'fr-CA', 'fr-BE', 'en-US', 'en-GB', 'de-DE', 'es-ES', 'it-IT', 'pt-PT', 'nl-NL']

// --- images en ligne -----------------------------------------------------------------------

/** Insertion → Images → Images en ligne : recherche sur Wikimedia Commons, insertion avec crédit. */
export function onlinePicturesDialog(app: FolioApp): void {
  if (blockedOffline()) return
  const query = h('input', { type: 'search', class: 'fp-input', 'data-field': 'pictures-query', placeholder: t('pic.placeholder'), maxlength: '200' }) as HTMLInputElement
  const go = h('button', { type: 'button', class: 'fp-btn fp-btn--primary', 'data-pictures-search': '' }, t('pic.search'))
  const grid = h('div', { class: 'fp-pics', role: 'listbox', 'aria-label': t('pic.results'), 'data-field': 'pictures' })
  const status = h('p', { class: 'fp-form__hint', 'aria-live': 'polite' }, t('pic.hint'))
  let chosen: OnlinePicture | null = null
  let results: OnlinePicture[] = []
  const run = async () => {
    const q = query.value.trim()
    if (!q) return
    go.disabled = true
    status.textContent = t('online.searching')
    grid.replaceChildren()
    chosen = null
    try {
      results = await searchPictures(q, docLang(app))
      status.textContent = results.length ? t('pic.count', { n: results.length }) : t('pic.none')
      results.forEach((p, i) => {
        const card = h(
          'button',
          { type: 'button', class: 'fp-pics__item', role: 'option', 'aria-selected': 'false', 'data-picture': String(i), title: creditOf(p) },
          h('img', { src: p.thumb, alt: p.title, loading: 'lazy', referrerpolicy: 'no-referrer' }),
          h('span', { class: 'fp-pics__credit' }, `${p.license}${p.author ? ` · ${p.author}` : ''}`),
        )
        card.addEventListener('click', () => {
          chosen = p
          grid.querySelectorAll('[aria-selected="true"]').forEach((x) => x.setAttribute('aria-selected', 'false'))
          card.setAttribute('aria-selected', 'true')
        })
        card.addEventListener('dblclick', () => (dlg.el.querySelector('[data-action="ok"]') as HTMLButtonElement | null)?.click())
        grid.append(card)
      })
    } catch (e) {
      status.textContent = netError(e)
    } finally {
      go.disabled = false
    }
  }
  go.addEventListener('click', () => void run())
  query.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void run()
    }
  })
  const dlg = openDialog({
    name: 'online-pictures',
    title: t('pic.title'),
    wide: true,
    focus: query,
    body: [h('div', { class: 'fp-ref__lookup' }, query, go), status, grid, h('p', { class: 'fp-form__hint' }, t('pic.license'))],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.insert'),
        value: 'ok',
        primary: true,
        run: async () => {
          if (!chosen) return false
          const p = chosen
          status.textContent = t('online.downloading')
          try {
            const file = await downloadPicture(p)
            const at = app.state.selection.from
            const count = await insertImageFiles(app.view, [file], imageHooks())
            if (!count) return false
            // Le crédit en légende (lien vers la page de l'image), et la description en texte de remplacement.
            app.run((state, dispatch) => {
              let pos = -1
              state.doc.nodesBetween(Math.max(0, at - 2), Math.min(state.doc.content.size, at + 4), (node, at2) => {
                if (pos < 0 && node.type === n.figure) pos = at2
                return pos < 0
              })
              if (pos < 0) return false
              const fig = state.doc.nodeAt(pos)!
              const link = schema.marks.link.create({ href: p.page })
              const caption = [schema.text(p.title || p.page), schema.text(` — ${[p.author, p.license].filter(Boolean).join(', ')}`)].map((x, i) => (i === 0 ? x.mark([link]) : x))
              let tr = state.tr.setNodeMarkup(pos, undefined, { ...fig.attrs, alt: (p.description || p.title).slice(0, 2000) })
              tr = tr.replaceWith(pos + 1, pos + 1 + fig.content.size, caption)
              dispatch?.(tr)
              return true
            })
            toast(t('pic.inserted'), { kind: 'success' })
            return true
          } catch (e) {
            status.textContent = netError(e)
            return false
          }
        },
      },
    ],
  })
}

// --- rechercher et synonymes ------------------------------------------------------------------

/** Le mot ou la sélection sous le curseur. */
export function wordAtCursor(app: FolioApp): string {
  const s = app.state.selection
  if (!s.empty) return cleanTerm(app.state.doc.textBetween(s.from, s.to, ' ', ' '))
  const $p = s.$from
  const text = $p.parent.textBetween(0, $p.parent.content.size, ' ', ' ')
  const off = $p.parentOffset
  const left = /[\p{L}\p{N}'’-]*$/u.exec(text.slice(0, off))?.[0] ?? ''
  const right = /^[\p{L}\p{N}'’-]*/u.exec(text.slice(off))?.[0] ?? ''
  return cleanTerm(left + right)
}

/** Remplace le mot sous le curseur (ou la sélection) par un synonyme. */
function replaceWord(app: FolioApp, word: string): void {
  const s = app.state.selection
  app.run((state, dispatch) => {
    let { from, to } = s
    if (s.empty) {
      const $p = s.$from
      const text = $p.parent.textBetween(0, $p.parent.content.size, ' ', ' ')
      const off = $p.parentOffset
      from = s.from - (/[\p{L}\p{N}'’-]*$/u.exec(text.slice(0, off))?.[0].length ?? 0)
      to = s.from + (/^[\p{L}\p{N}'’-]*/u.exec(text.slice(off))?.[0].length ?? 0)
    }
    const marks = state.doc.resolve(from).marksAcross(state.doc.resolve(to)) ?? undefined
    dispatch?.(state.tr.insertText(word, from, to).setStoredMarks(marks ?? null))
    return true
  })
}

/** Volet « Rechercher » : résumé Wikipédia, définitions et synonymes. */
export class LookupPane {
  readonly el: HTMLElement
  private readonly body: HTMLElement
  private readonly input: HTMLInputElement
  private mode: 'search' | 'thesaurus' = 'search'
  private seq = 0

  constructor(private app: FolioApp) {
    this.input = h('input', { type: 'search', class: 'fp-input', 'data-field': 'lookup-term', 'aria-label': t('look.term') }) as HTMLInputElement
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void this.search(this.input.value, this.mode)
      }
    })
    const close = h('button', { type: 'button', class: 'fp-iconbtn', 'aria-label': t('action.close'), title: t('action.close'), onclick: () => this.toggle(false) }, icon(ICONS.close))
    this.body = h('div', { class: 'fp-lookup__body', 'aria-live': 'polite' })
    this.el = h('aside', { class: 'fp-nav fp-lookup', id: 'fp-lookup', 'aria-label': t('look.title') }, h('div', { class: 'fp-nav__head' }, h('h2', { class: 'fp-nav__title' }, t('look.title')), close), h('div', { class: 'fp-lookup__search' }, this.input), this.body)
    this.el.hidden = true
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  toggle(on = this.el.hidden): void {
    this.el.hidden = !on
    window.dispatchEvent(new Event('resize'))
    this.app.notifyUi()
  }

  /** Cherche un terme : « search » (Wikipédia d'abord) ou « thesaurus » (synonymes d'abord). */
  async search(term: string, mode: 'search' | 'thesaurus' = 'search'): Promise<void> {
    this.mode = mode
    this.toggle(true)
    const q = cleanTerm(term)
    this.input.value = q
    this.body.replaceChildren()
    if (!q) return void this.body.append(h('p', { class: 'fp-muted' }, t('look.empty')))
    if (isOffline()) return void this.body.append(h('p', { class: 'fp-muted' }, t('offline.blocked')))
    const my = ++this.seq
    this.body.append(h('p', { class: 'fp-muted' }, t('online.searching')))
    const l = docLang(this.app)
    const [sum, defs] = await Promise.all([wikipediaSummary(q, l).catch(() => null), definitions(q, l).catch(() => null)])
    if (my !== this.seq) return
    this.body.replaceChildren(...this.render(q, sum, defs, mode))
  }

  private render(q: string, sum: Summary | null, defs: Definitions | null, mode: 'search' | 'thesaurus'): HTMLElement[] {
    const out: HTMLElement[] = []
    const thesaurus = () => {
      const s = h('section', { class: 'fp-lookup__section', 'data-section': 'thesaurus' }, h('h3', {}, t('look.synonyms')))
      if (defs?.synonyms.length) {
        const list = h('div', { class: 'fp-lookup__words' })
        for (const w of defs.synonyms) {
          const b = h('button', { type: 'button', class: 'fp-chip', 'data-synonym': w, title: t('look.replaceWith', { word: w }) }, w)
          b.addEventListener('click', () => replaceWord(this.app, w))
          list.append(b)
        }
        s.append(list)
      } else s.append(h('p', { class: 'fp-muted' }, t('look.noSynonyms')))
      if (defs?.antonyms.length) s.append(h('h3', {}, t('look.antonyms')), h('p', {}, defs.antonyms.join(', ')))
      return s
    }
    const definitionsSection = () => {
      const s = h('section', { class: 'fp-lookup__section', 'data-section': 'definitions' }, h('h3', {}, t('look.definitions')))
      if (defs?.senses.length) {
        for (const sense of defs.senses) {
          s.append(h('p', { class: 'fp-lookup__pos' }, sense.pos), h('ol', {}, ...sense.items.map((d) => h('li', {}, d))))
        }
        if (defs.url) s.append(this.source(defs.url, t('look.wiktionary')))
      } else s.append(h('p', { class: 'fp-muted' }, t('look.noDefinition')))
      return s
    }
    const wiki = () => {
      const s = h('section', { class: 'fp-lookup__section', 'data-section': 'wikipedia' }, h('h3', {}, sum?.title || q))
      if (sum) {
        s.append(h('p', {}, sum.extract))
        if (sum.url) s.append(this.source(sum.url, t('look.wikipedia')))
      } else s.append(h('p', { class: 'fp-muted' }, t('look.noArticle')))
      return s
    }
    if (mode === 'thesaurus') out.push(thesaurus(), definitionsSection(), wiki())
    else out.push(wiki(), definitionsSection(), thesaurus())
    out.push(h('p', { class: 'fp-form__hint' }, t('look.privacy')))
    return out
  }

  private source(url: string, label: string): HTMLElement {
    const a = h('a', { href: url, class: 'fp-lookup__source', rel: 'noopener noreferrer' }, label) as HTMLAnchorElement
    a.addEventListener('click', (e) => {
      e.preventDefault()
      openUrl(url)
    })
    return a
  }
}

let lookupPane: LookupPane | null = null
export const setLookupPane = (p: LookupPane): void => void (lookupPane = p)
export const getLookupPane = (): LookupPane | null => lookupPane

/** Révision → Synonymes (Maj+F7), Références → Rechercher, clic droit → Rechercher. */
export function lookUp(app: FolioApp, mode: 'search' | 'thesaurus'): void {
  if (!lookupPane) return
  void lookupPane.search(wordAtCursor(app), mode)
}

// --- polices en ligne -------------------------------------------------------------------------

/** Accueil → Police → Autres polices en ligne : choisir une police libre, l'intégrer au document. */
export function onlineFontsDialog(app: FolioApp): void {
  if (blockedOffline()) return
  const filter = h('select', { class: 'fp-input', 'data-field': 'fonts-category' }, h('option', { value: '' }, t('gf.all')), ...(['serif', 'sans', 'display', 'hand', 'mono'] as FontCategory[]).map((c) => h('option', { value: c }, t(`gf.cat.${c}` as Key))))
  const list = h('div', { class: 'fp-gfonts', role: 'listbox', 'data-field': 'fonts-online' })
  const other = h('input', { type: 'text', class: 'fp-input', 'data-field': 'fonts-other', placeholder: t('gf.otherPlaceholder'), maxlength: '60' }) as HTMLInputElement
  const status = h('p', { class: 'fp-form__hint', 'aria-live': 'polite' }, t('gf.hint'))
  let chosen = ''
  const installed = new Set(((app.state.doc.attrs.fonts as { family: string }[]) ?? []).map((f) => f.family))
  const render = () => {
    list.replaceChildren()
    for (const f of GOOGLE_FONTS.filter((x) => !filter.value || x.category === filter.value)) {
      const b = h(
        'button',
        { type: 'button', class: 'fp-gfonts__item', role: 'option', 'aria-selected': String(chosen === f.family), 'data-gfont': f.family },
        h('span', { class: 'fp-gfonts__name' }, f.family),
        h('span', { class: 'fp-muted' }, `${t(`gf.cat.${f.category}` as Key)} · ${f.license === 'OFL' ? 'SIL OFL' : 'Apache 2.0'}${installed.has(f.family) ? ` · ${t('gf.installed')}` : ''}`),
      )
      b.addEventListener('click', () => {
        chosen = f.family
        other.value = ''
        list.querySelectorAll('[aria-selected="true"]').forEach((x) => x.setAttribute('aria-selected', 'false'))
        b.setAttribute('aria-selected', 'true')
      })
      list.append(b)
    }
  }
  filter.addEventListener('change', render)
  other.addEventListener('input', () => {
    if (other.value.trim()) {
      chosen = ''
      list.querySelectorAll('[aria-selected="true"]').forEach((x) => x.setAttribute('aria-selected', 'false'))
    }
  })
  render()
  openDialog({
    name: 'online-fonts',
    title: t('gf.title'),
    wide: true,
    body: [status, row(t('gf.category'), filter), list, row(t('gf.other'), other, t('gf.otherHint'))],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('gf.add'),
        value: 'ok',
        primary: true,
        run: async () => {
          const family = (other.value.trim() || chosen).trim()
          if (!isFamilyName(family)) {
            status.textContent = t('gf.pick')
            return false
          }
          if (installed.has(family)) {
            applyFont(app, family)
            return true
          }
          status.textContent = t('online.downloading')
          try {
            const faces = await downloadFamily(family, (done, total) => (status.textContent = t('gf.progress', { done, total })))
            const fonts = [...((app.state.doc.attrs.fonts as unknown[]) ?? []), ...faces.map((f) => ({ ...f, assetId: null }))]
            app.setDocAttrs({ fonts })
            applyFont(app, family)
            toast(t('gf.added', { family }), { kind: 'success' })
            return true
          } catch (e) {
            status.textContent = e instanceof Error && e.message === 'not found' ? t('gf.notFound') : netError(e)
            return false
          }
        },
      },
    ],
  })
}

/** La police ajoutée s'applique à la sélection (s'il y en a une). */
function applyFont(app: FolioApp, family: string): void {
  const s = app.state.selection
  if (s.empty) return
  app.run((state, dispatch) => {
    dispatch?.(state.tr.addMark(s.from, s.to, schema.marks.font.create({ family })))
    return true
  })
}

// --- outils ----------------------------------------------------------------------------------

let seq = 0
function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || `fp-on-${++seq}`
  control.id = id
  return h('div', { class: 'fp-form__row' }, h('label', { class: 'fp-label', for: id }, label), control, hint ? h('p', { class: 'fp-form__hint' }, hint) : null)
}

/** Préférence non utilisée ailleurs : rien ne part sans geste (rappel pour les tests). */
export const onlineAllowed = (): boolean => !settings().offline
