// Glossaire et abréviations (Références → Glossaire) : définir un terme, gérer
// la liste (avec import et export CSV), rechercher les abréviations du texte,
// vérifier qu'elles sont développées à leur première occurrence, insérer les
// listes. Les termes vivent dans le document (annulables comme le reste).

import type { FolioApp } from '../app'
import { insertBlock } from '../editor/commands'
import { refBlockNode, textSegments } from '../editor/refs'
import { downloadFile } from '../file/save'
import { detectAbbreviations, TERM_LIMITS, unexpandedFirstUses } from '../format/terms'
import type { Term } from '../format/types'
import { t } from '../i18n/i18n'
import { parseCsv } from '../merge/source'
import { openDialog, toast } from './dialog'
import { h, icon } from './dom'
import { ICONS, RIBBON_ICONS as I } from './icons'
import { pickFile } from './panels'
import { popItem } from './popover'
import { button, col, dropdown, type Group } from './ribbon'

const termsOf = (app: FolioApp): Term[] => (app.state.doc.attrs.terms as Term[] | undefined) ?? []
const keyOf = (x: Pick<Term, 'term' | 'kind'>) => `${x.kind}\u0000${x.kind === 'abbreviation' ? x.term : x.term.toLocaleLowerCase()}`
const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max)

/** Nouvelle liste de termes : une seule étape d'annulation. */
export function setTerms(app: FolioApp, terms: Term[]): void {
  app.view.dispatch(app.state.tr.setDocAttribute('terms', terms.slice(0, TERM_LIMITS.count)))
}

function nextId(terms: Term[]): string {
  const used = new Set(terms.map((x) => x.id))
  for (let k = terms.length + 1; ; k++) if (!used.has(`t${k}`)) return `t${k}`
}

/** Ajoute ou remplace des termes (même terme, même type : remplacé). */
export function mergeTerms(current: Term[], incoming: Omit<Term, 'id'>[]): { terms: Term[]; added: number; updated: number } {
  const terms = current.map((x) => ({ ...x }))
  let added = 0
  let updated = 0
  for (const x of incoming) {
    const term = clean(x.term, TERM_LIMITS.term)
    if (!term) continue
    const item = { term, definition: clean(x.definition, TERM_LIMITS.definition), kind: x.kind, ...(x.plural ? { plural: clean(x.plural, TERM_LIMITS.term) } : {}) }
    const at = terms.findIndex((y) => keyOf(y) === keyOf(item))
    if (at >= 0) {
      terms[at] = { ...terms[at], ...item }
      updated++
    } else if (terms.length < TERM_LIMITS.count) {
      terms.push({ id: nextId(terms), ...item })
      added++
    }
  }
  return { terms, added, updated }
}

const field = (label: string, control: HTMLElement, hint?: string) => {
  control.id ||= `fp-gl-${Math.random().toString(36).slice(2, 8)}`
  return h('div', { class: 'fp-form__row' }, h('label', { class: 'fp-label', for: control.id }, label), control, hint ? h('p', { class: 'fp-form__hint' }, hint) : null)
}

/** Définir un terme (la sélection le propose ; un mot en capitales propose « abréviation »). */
export function defineTermDialog(app: FolioApp): void {
  const { from, to, empty } = app.state.selection
  const picked = empty ? '' : clean(app.state.doc.textBetween(from, to, ' ', ' '), TERM_LIMITS.term)
  const existing = termsOf(app).find((x) => x.term === picked || x.term.toLocaleLowerCase() === picked.toLocaleLowerCase())
  const term = h('input', { type: 'text', class: 'fp-input', 'data-field': 'term', maxlength: String(TERM_LIMITS.term) }) as HTMLInputElement
  term.value = existing?.term ?? picked
  const definition = h('textarea', { class: 'fp-input', rows: '3', 'data-field': 'term-definition', maxlength: String(TERM_LIMITS.definition) }) as HTMLTextAreaElement
  definition.value = existing?.definition ?? ''
  const kind = h('select', { class: 'fp-input', 'data-field': 'term-kind' }, h('option', { value: 'glossary' }, t('gl.kindGlossary')), h('option', { value: 'abbreviation' }, t('gl.kindAbbreviation'))) as HTMLSelectElement
  kind.value = existing?.kind ?? (/^\p{Lu}[\p{Lu}\p{N}]{1,7}$/u.test(picked) ? 'abbreviation' : 'glossary')
  const plural = h('input', { type: 'text', class: 'fp-input', 'data-field': 'term-plural', maxlength: String(TERM_LIMITS.term) }) as HTMLInputElement
  plural.value = existing?.plural ?? ''
  const defLabel = () => (kind.value === 'abbreviation' ? t('gl.longForm') : t('gl.definition'))
  const defRow = field(defLabel(), definition)
  kind.addEventListener('change', () => (defRow.querySelector('label')!.textContent = defLabel()))
  const error = h('p', { class: 'fp-field-error', role: 'alert', 'data-field': 'term-error' })
  openDialog({
    name: 'define-term',
    title: t('gl.defineTitle'),
    body: [h('div', { class: 'fp-form' }, field(t('gl.term'), term), field(t('gl.kind'), kind), defRow, field(t('gl.plural'), plural, t('gl.pluralHint'))), error],
    focus: term.value ? definition : term,
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          if (!clean(term.value, TERM_LIMITS.term)) {
            error.textContent = t('gl.needTerm')
            return false
          }
          const r = mergeTerms(termsOf(app), [{ term: term.value, definition: definition.value, kind: kind.value as Term['kind'], plural: plural.value.trim() || undefined }])
          if (!r.added && !r.updated) {
            error.textContent = t('gl.tooMany', { n: TERM_LIMITS.count })
            return false
          }
          setTerms(app, r.terms)
          toast(t(r.added ? 'gl.added' : 'gl.updated', { term: clean(term.value, 60) }), { kind: 'success' })
          app.focus()
        },
      },
    ],
  })
}

// --- CSV ---------------------------------------------------------------------------

const csvCell = (s: string) => (/[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export function termsToCsv(terms: Term[]): string {
  return ['term;definition;kind;plural', ...terms.map((x) => [x.term, x.definition, x.kind, x.plural ?? ''].map(csvCell).join(';'))].join('\r\n') + '\r\n'
}

/** CSV → termes : colonnes term, definition, kind, plural (ou en français) ; sans en-tête, les deux premières. */
export function termsFromCsv(text: string): Omit<Term, 'id'>[] {
  const parsed = parseCsv(text).source
  const names = parsed.fields.map((f) => f.trim().toLocaleLowerCase())
  const col = (...alts: string[]) => names.findIndex((n) => alts.includes(n))
  let iTerm = col('term', 'terme', 'abbreviation', 'abréviation', 'sigle', 'mot')
  let iDef = col('definition', 'définition', 'long form', 'forme longue', 'meaning', 'sens')
  const iKind = col('kind', 'type', 'genre')
  const iPlural = col('plural', 'pluriel')
  const rows = [...parsed.records]
  if (iTerm < 0 || iDef < 0) {
    // Pas d'en-tête reconnu : la première ligne est une donnée.
    rows.unshift(parsed.fields)
    iTerm = 0
    iDef = 1
  }
  return rows
    .map((r) => ({
      term: r[iTerm] ?? '',
      definition: r[iDef] ?? '',
      kind: (/^(abbr|abr|sigle|acronym)/i.test(iKind >= 0 ? (r[iKind] ?? '') : '') || (iKind < 0 && /^\p{Lu}[\p{Lu}\p{N}]{1,7}$/u.test((r[iTerm] ?? '').trim())) ? 'abbreviation' : 'glossary') as Term['kind'],
      ...(iPlural >= 0 && r[iPlural]?.trim() ? { plural: r[iPlural].trim() } : {}),
    }))
    .filter((x) => x.term.trim())
}

// --- gérer les termes --------------------------------------------------------------

export function manageTermsDialog(app: FolioApp): void {
  let work = termsOf(app).map((x) => ({ ...x }))
  const list = h('div', { class: 'fp-gl__list', role: 'list', 'data-field': 'term-list' })
  const filter = h('input', { type: 'search', class: 'fp-input', placeholder: t('gl.filter'), 'aria-label': t('gl.filter'), 'data-field': 'term-filter' }) as HTMLInputElement
  const render = () => {
    const q = filter.value.trim().toLocaleLowerCase()
    list.replaceChildren()
    if (!work.length) list.append(h('p', { class: 'fp-muted fp-gl__empty' }, t('gl.none')))
    for (const x of work) {
      if (q && !x.term.toLocaleLowerCase().includes(q) && !x.definition.toLocaleLowerCase().includes(q)) continue
      const term = h('input', { type: 'text', class: 'fp-input', value: x.term, maxlength: String(TERM_LIMITS.term), 'aria-label': t('gl.term'), 'data-term-name': x.term }) as HTMLInputElement
      const def = h('input', { type: 'text', class: 'fp-input', value: x.definition, maxlength: String(TERM_LIMITS.definition), 'aria-label': t('gl.definition'), 'data-term-def': x.term }) as HTMLInputElement
      const kind = h('select', { class: 'fp-input', 'aria-label': t('gl.kind'), 'data-term-kind': x.term }, h('option', { value: 'glossary' }, t('gl.kindGlossaryShort')), h('option', { value: 'abbreviation' }, t('gl.kindAbbreviationShort'))) as HTMLSelectElement
      kind.value = x.kind
      term.addEventListener('change', () => (x.term = clean(term.value, TERM_LIMITS.term) || x.term))
      def.addEventListener('change', () => (x.definition = clean(def.value, TERM_LIMITS.definition)))
      kind.addEventListener('change', () => (x.kind = kind.value as Term['kind']))
      const del = h('button', { type: 'button', class: 'fp-iconbtn', title: t('gl.remove', { term: x.term }), 'aria-label': t('gl.remove', { term: x.term }), 'data-term-remove': x.term }, icon(ICONS.close))
      del.addEventListener('click', () => {
        work = work.filter((y) => y !== x)
        render()
      })
      list.append(h('div', { class: 'fp-gl__row', role: 'listitem' }, term, kind, def, del))
    }
  }
  filter.addEventListener('input', render)
  render()
  const add = h('button', { type: 'button', class: 'fp-btn', 'data-gl-action': 'add' }, t('gl.addRow'))
  add.addEventListener('click', () => {
    if (work.length >= TERM_LIMITS.count) return
    work.unshift({ id: nextId(work), term: t('gl.newTerm'), definition: '', kind: 'glossary' })
    filter.value = ''
    render()
    ;(list.querySelector('input') as HTMLInputElement | null)?.select()
  })
  const exportBtn = h('button', { type: 'button', class: 'fp-btn', 'data-gl-action': 'export' }, t('gl.exportCsv'))
  exportBtn.addEventListener('click', () => downloadFile(termsToCsv(work), `${app.state.doc.attrs.title || 'glossaire'} – termes.csv`, 'text/csv'))
  const importBtn = h('button', { type: 'button', class: 'fp-btn', 'data-gl-action': 'import' }, t('gl.importCsv'))
  importBtn.addEventListener('click', async () => {
    const file = await pickFile('.csv,.tsv,.txt,text/csv')
    if (!file) return
    const r = mergeTerms(work, termsFromCsv(await file.text()))
    work = r.terms
    toast(t('gl.imported', { n: r.added + r.updated }), { kind: r.added + r.updated ? 'success' : 'info' })
    render()
  })
  openDialog({
    name: 'terms',
    title: t('gl.manageTitle'),
    wide: true,
    body: [h('p', { class: 'fp-form__hint' }, t('gl.manageHint')), h('div', { class: 'fp-gl__tools' }, filter, add), list, h('div', { class: 'fp-gl__tools' }, exportBtn, importBtn)],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          // Doublons (même terme, même type) : le premier reste.
          setTerms(app, mergeTerms([], work).terms.map((x, i) => ({ ...x, id: work[i]?.id ?? x.id })))
        },
      },
    ],
  })
}

// --- abréviations du texte ---------------------------------------------------------

export function findAbbreviationsDialog(app: FolioApp): void {
  const known = new Set(termsOf(app).filter((x) => x.kind === 'abbreviation').map((x) => x.term))
  const found = detectAbbreviations(textSegments(app.state.doc).map((s) => s.text)).filter((x) => !known.has(x.short))
  if (!found.length) {
    toast(t('gl.noneFound'), { kind: 'info' })
    return
  }
  const rows = found.slice(0, 300).map((x) => {
    const box = h('input', { type: 'checkbox', 'data-abbr-pick': x.short }) as HTMLInputElement
    box.checked = !!x.long
    const long = h('input', { type: 'text', class: 'fp-input', value: x.long, placeholder: t('gl.longForm'), 'aria-label': t('gl.longFormOf', { short: x.short }), 'data-abbr-long': x.short }) as HTMLInputElement
    long.addEventListener('input', () => (box.checked = !!long.value.trim()))
    return { x, box, long, el: h('div', { class: 'fp-gl__found', role: 'listitem' }, h('label', { class: 'fp-check' }, box, h('b', {}, x.short)), long) }
  })
  openDialog({
    name: 'find-abbreviations',
    title: t('gl.findTitle'),
    wide: true,
    body: [h('p', { class: 'fp-form__hint' }, t('gl.findHint', { n: found.length })), h('div', { class: 'fp-gl__list', role: 'list' }, ...rows.map((r) => r.el))],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('gl.addPicked'),
        value: 'ok',
        primary: true,
        run: () => {
          const picked = rows.filter((r) => r.box.checked).map((r) => ({ term: r.x.short, definition: r.long.value, kind: 'abbreviation' as const }))
          if (!picked.length) return
          const r = mergeTerms(termsOf(app), picked)
          setTerms(app, r.terms)
          toast(t('gl.addedN', { n: r.added + r.updated }), { kind: 'success' })
        },
      },
    ],
  })
}

/** Abréviations employées avant d'être développées : la liste, chacune cliquable. */
export function firstUseDialog(app: FolioApp): void {
  const terms = termsOf(app)
  const late = unexpandedFirstUses(textSegments(app.state.doc), terms)
  if (!late.length) {
    toast(t('gl.allExpanded'), { kind: 'success' })
    return
  }
  const byId = new Map(terms.map((x) => [x.id, x]))
  const d = openDialog({
    name: 'first-use',
    title: t('gl.firstUseTitle'),
    body: [
      h('p', { class: 'fp-form__hint' }, t('gl.firstUseHint')),
      h(
        'div',
        { class: 'fp-gl__list', role: 'list' },
        ...late.map((l) => {
          const x = byId.get(l.id)!
          const b = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-first-use': x.term }, t('gl.goTo'))
          b.addEventListener('click', () => {
            d.close('go')
            app.jumpTo(l.pos)
          })
          return h('div', { class: 'fp-gl__found', role: 'listitem' }, h('span', {}, h('b', {}, x.term), ` — ${x.definition}`), b)
        }),
      ),
    ],
    actions: [{ label: t('action.close'), value: 'close', primary: true }],
  })
}

/** Références → Glossaire. */
export function glossaryGroup(app: FolioApp): Group {
  const ins = (kind: 'glossary' | 'abbreviations') => app.run(insertBlock(refBlockNode({ kind, title: t(kind === 'glossary' ? 'gl.glossaryTitle' : 'gl.abbreviationsTitle'), all: false }), 'node'))
  return {
    id: 'glossary',
    label: t('gl.group'),
    controls: [
      button({ id: 'define-term', label: t('gl.define'), icon: I.markEntry, large: true, keys: 'Alt+Shift+G', run: () => defineTermDialog(app) }),
      col(
        dropdown({
          id: 'insert-glossary',
          label: t('gl.insertList'),
          icon: I.index,
          text: () => t('gl.insertList'),
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              popItem(t('gl.glossaryTitle'), () => ins('glossary'), { 'data-gl-insert': 'glossary' }),
              popItem(t('gl.abbreviationsTitle'), () => ins('abbreviations'), { 'data-gl-insert': 'abbreviations' }),
            ),
        }),
        button({ id: 'manage-terms', label: t('gl.manage'), icon: I.sources, text: true, run: () => manageTermsDialog(app) }),
        dropdown({
          id: 'abbreviation-tools',
          label: t('gl.abbrTools'),
          icon: I.find,
          text: () => t('gl.abbrTools'),
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list' },
              popItem(t('gl.find'), () => findAbbreviationsDialog(app), { 'data-gl-tool': 'find' }),
              popItem(t('gl.firstUse'), () => firstUseDialog(app), { 'data-gl-tool': 'first-use' }),
            ),
        }),
      ),
    ],
  }
}
