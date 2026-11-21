// Statistiques (clic sur le nombre de mots, Révision → Statistiques) : comptage,
// temps de lecture et de parole, lisibilité, phrases longues surlignées, et
// objectif d'écriture (gardé dans le document, suivi dans la barre d'état).

import type { FolioApp } from '../app'
import { setLongSentences } from '../editor/longsentences'
import { collectNotes, noteText } from '../editor/notes'
import { countWords, LONG_SENTENCE, longSentenceRanges, readability, stats } from '../editor/stats'
import type { Block, WritingGoal } from '../format/types'
import type { Key } from '../i18n/dict'
import { lang, t } from '../i18n/i18n'
import { settings, updateSettings } from '../settings'
import { openDialog } from './dialog'
import { h } from './dom'

const nf = () => new Intl.NumberFormat(lang())
const docLang = (app: FolioApp) => (app.state.doc.attrs.lang as string) || lang()

/** « 4 min », « moins d'une minute », « 1 h 05 ». */
export function duration(minutes: number): string {
  if (minutes < 1) return t('stats.lessThanMinute')
  const m = Math.round(minutes)
  if (m < 60) return t('stats.minutes', { n: m })
  return t('stats.hours', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') })
}

/** Libellé d'un indice de lisibilité (0 : très difficile, 100 : très facile). */
export function scoreLabel(score: number): Key {
  if (score >= 90) return 'stats.score.veryEasy'
  if (score >= 80) return 'stats.score.easy'
  if (score >= 70) return 'stats.score.fairlyEasy'
  if (score >= 60) return 'stats.score.standard'
  if (score >= 50) return 'stats.score.fairlyHard'
  if (score >= 30) return 'stats.score.hard'
  return 'stats.score.veryHard'
}

/** Jours entiers d'ici la date limite (0 : aujourd'hui ; négatif : dépassée). */
export function daysLeft(deadline: string, now = new Date()): number {
  const [y, mo, d] = deadline.split('-').map(Number)
  const end = Date.UTC(y, mo - 1, d)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((end - today) / 86_400_000)
}

/** Progression vers l'objectif : le texte de la barre d'état et le pourcentage. */
export function goalProgress(words: number, goal: WritingGoal, now = new Date()): { pct: number; remaining: number; perDay: number | null; days: number | null } {
  const remaining = Math.max(0, goal.words - words)
  const days = goal.deadline ? daysLeft(goal.deadline, now) : null
  const perDay = days !== null && remaining > 0 ? Math.ceil(remaining / Math.max(1, days + 1)) : null
  return { pct: Math.min(100, Math.round((words / goal.words) * 100)), remaining, perDay, days }
}

function tile(stat: string, label: string, value: string, sub?: string): HTMLElement {
  return h('div', { class: 'fp-stat' }, h('span', { class: 'fp-stat__value', 'data-stat': stat }, value), h('span', { class: 'fp-stat__label' }, label), sub ? h('span', { class: 'fp-stat__sub' }, sub) : null)
}

function noteWords(app: FolioApp): number {
  return collectNotes(app.state.doc).reduce((s, r) => s + countWords(noteText(r.node.attrs.blocks as Block[])), 0)
}

export function statsDialog(app: FolioApp): void {
  const doc = app.state.doc
  const n = nf()
  const all = stats(doc)
  const { from, to, empty } = app.state.selection
  const sel = empty ? null : stats(doc, from, to)
  const lng = docLang(app)
  const rd = readability(doc, lng, ...(sel ? [from, to] as const : []))
  const both = (a: number, s?: number) => (sel && s !== undefined ? t('stats.ofTotal', { s: n.format(s), n: n.format(a) }) : n.format(a))
  const pages = app.pagesInfo?.pages() ?? 1
  const notes = noteWords(app)

  // En-tête : le nombre de mots, en grand.
  const head = h(
    'div',
    { class: 'fp-stats__head' },
    h('span', { class: 'fp-stats__big', 'data-stat': 'words' }, n.format(sel ? sel.words : all.words)),
    h('span', { class: 'fp-stats__unit' }, sel ? t('stats.wordsSelected', { n: n.format(all.words) }) : t('stats.wordsLabel')),
  )
  const counts = h(
    'div',
    { class: 'fp-stats__grid' },
    tile('chars', t('stats.chars'), both(all.chars, sel?.chars)),
    tile('charsNoSpaces', t('stats.charsNoSpaces'), both(all.charsNoSpaces, sel?.charsNoSpaces)),
    tile('paragraphs', t('stats.paragraphs'), both(all.paragraphs, sel?.paragraphs)),
    tile('sentences', t('stats.sentences'), n.format(rd.sentences)),
    tile('pages', t('stats.pages'), n.format(pages)),
    ...(notes ? [tile('notes', t('stats.noteWords'), n.format(notes))] : []),
  )
  const time = h(
    'div',
    { class: 'fp-stats__grid fp-stats__grid--two' },
    tile('read', t('stats.readTime'), duration(rd.readMinutes), t('stats.readHint')),
    tile('speak', t('stats.speakTime'), duration(rd.speakMinutes), t('stats.speakHint')),
  )

  // Lisibilité : l'indice et sa jauge, la longueur des phrases, les phrases longues.
  const fr = /^fr/i.test(lng)
  const score = rd.score
  const gauge = h('div', { class: 'fp-gauge', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(score ?? 0), 'aria-label': t(fr ? 'stats.scoreFr' : 'stats.scoreEn') }, h('span', { class: 'fp-gauge__fill', style: `width:${score ?? 0}%` }))
  const longBox = h('input', { type: 'checkbox', 'data-field': 'long-sentences' }) as HTMLInputElement
  longBox.checked = settings().longSentences
  longBox.addEventListener('change', () => {
    updateSettings({ longSentences: longBox.checked })
    refreshLongSentences(app)
  })
  const readable = h(
    'div',
    { class: 'fp-stats__read' },
    score === null
      ? h('p', { class: 'fp-muted', 'data-stat': 'score' }, t('stats.notEnough'))
      : h('div', { class: 'fp-stats__score' }, h('span', { class: 'fp-stats__scoreval', 'data-stat': 'score' }, String(score)), h('span', {}, h('b', {}, t(scoreLabel(score))), h('br'), h('span', { class: 'fp-muted' }, t(fr ? 'stats.scoreFr' : 'stats.scoreEn'))), gauge),
    h('div', { class: 'fp-stats__grid fp-stats__grid--two' }, tile('avg', t('stats.avgSentence'), t('stats.wordsPer', { n: String(rd.avgSentence).replace('.', t('number.decimal')) })), tile('long', t('stats.longSentences', { n: LONG_SENTENCE }), n.format(rd.longSentences))),
    h('label', { class: 'fp-check' }, longBox, h('span', {}, t('stats.highlightLong'))),
  )

  // Objectif : nombre de mots visé, date limite facultative.
  const goal = app.state.doc.attrs.goal as WritingGoal | null
  const words = h('input', { type: 'number', class: 'fp-input', min: '1', max: '10000000', step: '50', 'data-field': 'goal-words', placeholder: '2000' }) as HTMLInputElement
  const deadline = h('input', { type: 'date', class: 'fp-input', 'data-field': 'goal-deadline' }) as HTMLInputElement
  if (goal) {
    words.value = String(goal.words)
    deadline.value = goal.deadline ?? ''
  }
  const progress = h('div', { class: 'fp-goal', 'data-field': 'goal-progress' })
  const renderProgress = (g: WritingGoal | null) => {
    progress.replaceChildren()
    if (!g) return
    const p = goalProgress(all.words, g)
    progress.append(
      h('div', { class: 'fp-goal__bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(p.pct) }, h('span', { class: 'fp-goal__fill' + (p.pct >= 100 ? ' is-done' : ''), style: `width:${p.pct}%` })),
      h('p', { class: 'fp-goal__text', 'data-stat': 'goal' }, p.remaining ? t('stats.goalLeft', { n: n.format(all.words), goal: n.format(g.words), pct: p.pct, left: n.format(p.remaining) }) : t('stats.goalDone', { goal: n.format(g.words) })),
    )
    if (p.days !== null) progress.append(h('p', { class: 'fp-muted', 'data-stat': 'goal-days' }, p.days < 0 ? t('stats.goalLate', { n: -p.days }) : p.remaining ? t('stats.goalPerDay', { n: p.days, days: p.days, perDay: n.format(p.perDay ?? 0) }) : t('stats.goalDays', { n: p.days })))
  }
  renderProgress(goal)
  const error = h('p', { class: 'fp-field-error', role: 'alert', 'data-field': 'goal-error' })
  const save = h('button', { type: 'button', class: 'fp-btn', 'data-goal': 'save' }, t('stats.goalSave'))
  const remove = h('button', { type: 'button', class: 'fp-btn fp-btn--ghost', 'data-goal': 'remove' }, t('stats.goalRemove'))
  save.addEventListener('click', () => {
    const w = Math.round(Number(words.value))
    if (!Number.isFinite(w) || w < 1 || w > 10_000_000) {
      error.textContent = t('stats.goalBad')
      return
    }
    error.textContent = ''
    const g: WritingGoal = { words: w, ...(deadline.value ? { deadline: deadline.value } : {}) }
    app.view.dispatch(app.state.tr.setDocAttribute('goal', g))
    renderProgress(g)
  })
  remove.addEventListener('click', () => {
    app.view.dispatch(app.state.tr.setDocAttribute('goal', null))
    words.value = ''
    deadline.value = ''
    renderProgress(null)
  })
  const goalForm = h(
    'div',
    { class: 'fp-stats__goal' },
    progress,
    h('div', { class: 'fp-form fp-form--grid' }, h('div', { class: 'fp-form__row' }, h('label', { class: 'fp-label' }, t('stats.goalWords'), words)), h('div', { class: 'fp-form__row' }, h('label', { class: 'fp-label' }, t('stats.goalDeadline'), deadline))),
    error,
    h('div', { class: 'fp-stats__actions' }, save, remove),
  )

  const section = (title: string, ...body: HTMLElement[]) => h('section', { class: 'fp-stats__section' }, h('h3', { class: 'fp-stats__title' }, title), ...body)
  openDialog({
    name: 'word-count',
    title: t('stats.title'),
    wide: true,
    body: [h('div', { class: 'fp-stats' }, head, counts, section(t('stats.time'), time), section(t('stats.readability'), readable), section(t('stats.goal'), goalForm))],
    actions: [{ label: t('action.close'), value: 'close', primary: true }],
  })
}

// --- phrases longues dans le texte ---------------------------------------------------

/** Pose les phrases longues (ou les retire si le réglage est coupé). */
export function refreshLongSentences(app: FolioApp): void {
  const ranges = settings().longSentences ? longSentenceRanges(app.state.doc, docLang(app)) : []
  app.view.dispatch(setLongSentences(app.state.tr, ranges))
}

/** Recalcul au repos (une demi-seconde après la dernière modification). */
export function installLongSentences(app: FolioApp): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let last = app.state.doc
  app.onChange(() => {
    if (!settings().longSentences || app.state.doc === last) return
    last = app.state.doc
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      refreshLongSentences(app)
    }, 500)
  })
  if (settings().longSentences) refreshLongSentences(app)
}

/** Texte et progression du bouton de la barre d'état. */
export function statusWords(app: FolioApp, words: number, selected: number | null): { text: string; pct: number | null } {
  const n = nf()
  const goal = app.state.doc.attrs.goal as WritingGoal | null
  if (selected !== null) return { text: t('stats.statusSelection', { s: n.format(selected), n: n.format(words) }), pct: null }
  if (!goal) return { text: t('stats.status', { n: words }), pct: null }
  return { text: t('stats.statusGoal', { n: n.format(words), goal: n.format(goal.words) }), pct: goalProgress(words, goal).pct }
}
