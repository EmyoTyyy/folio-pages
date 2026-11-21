// Onglet Publipostage : enveloppes et étiquettes, liste de destinataires,
// champs de fusion (bloc d'adresse, salutation, règles), aperçu des résultats,
// vérification et fusion. Comme dans les traitements de texte habituels, et
// sans serveur : la liste est gardée dans le document, les documents fusionnés
// s'ouvrent dans un nouvel onglet, les messages dans votre messagerie.

import type { FolioApp } from '../app'
import { insertMergeField, mailMergeOf, mergeViewOf, setMailMerge, setMergeView } from '../editor/merge'
import { prettyJson } from '../format/json'
import { ADDRESS_FIELDS, MERGE_OPS, mintId, type AddressField, type Block, type FolioDoc, type LabelSheet, type MailMerge, type MergeFilter, type MergeType } from '../format/types'
import { downloadFile } from '../file/save'
import { serializeShell } from '../file/shell'
import { strToU8, zipSync } from 'fflate'
import { addressLines, checkMerge, emailMessages, type EmailMessage, ENVELOPE_PRESETS, fillinPrompts, greetingText, LABEL_PRESETS, mergeDocument, plainText, recipients } from '../merge/engine'
import { bccList, blocksHtml, composeUrl, emlMessage, emlName, fitsInUrl, isEmail, parseAddresses, WEBMAILS, type EmlAttachment, type Webmail } from '../merge/mail'
import { DEFAULT_FIELDS, guessMap, parseSourceFile, toCsv } from '../merge/source'
import type { Key } from '../i18n/dict'
import { baseLang, t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h, icon } from './dom'
import { ICONS, RIBBON_ICONS as I } from './icons'
import { isOffline, openUrl } from '../net'
import { settings, updateSettings } from '../settings'
import { popItem } from './popover'
import * as P from './panels'
import { pdfFile } from './pdf'
import { button, dropdown, type Ctl } from './ribbon'
import { buildExport } from './exports'

type Group = { id: string; label: string; controls: Ctl[]; launcher?: () => void }

const mmOf = (app: FolioApp): MailMerge | undefined => mailMergeOf(app.state)
const lang = () => baseLang()

function setMm(app: FolioApp, mm: MailMerge | null): void {
  app.run(setMailMerge(mm))
}

function patchMm(app: FolioApp, patch: Partial<MailMerge>): void {
  const cur = mmOf(app) ?? { type: 'letters' as MergeType }
  setMm(app, { ...cur, ...patch })
}

const fieldsOf = (app: FolioApp): string[] => mmOf(app)?.source?.fields ?? []

function select(options: [string, string][], value: string, attrs: Record<string, string> = {}): HTMLSelectElement {
  const s = h('select', { class: 'fp-input', ...attrs }) as HTMLSelectElement
  for (const [v, label] of options) s.append(h('option', { value: v }, label))
  s.value = value
  return s
}

function row(label: string, control: HTMLElement): HTMLElement {
  return h('label', { class: 'fp-form__row fp-mm__row' }, h('span', { class: 'fp-label' }, label), control)
}

const opOptions = (): [string, string][] => MERGE_OPS.map((o) => [o, t(`mm.op.${o}` as Key)])

// --- nouveau document dans un onglet ------------------------------------------

/** Ouvre un document (fusionné, enveloppe, étiquettes) dans un nouvel onglet ; téléchargé si l'onglet est refusé. */
export function openInNewTab(doc: FolioDoc, name: string, print = false): 'tab' | 'download' {
  const html = serializeShell(prettyJson(doc), `${doc.meta.title || name} — Folio Pages`)
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  const win = window.open(url + (print ? '#print' : ''), '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 120_000)
  if (win) return 'tab'
  downloadFile(html, name)
  return 'download'
}

const fileName = (app: FolioApp, suffix: string) => `${app.suggestedFileName().replace(/\.html?$/i, '')} (${suffix}).html`

// --- démarrer ---------------------------------------------------------------------

function startType(app: FolioApp, type: MergeType | 'none'): void {
  if (type === 'none') {
    const cur = mmOf(app)
    // Document normal : on garde la liste (pour y revenir), mais plus de type de fusion.
    if (cur) setMm(app, cur.source ? { type: 'letters', source: cur.source, ...(cur.map ? { map: cur.map } : {}) } : null)
    app.run(setMergeView({ preview: false }))
    return
  }
  if (type === 'labels') return labelsDialog(app, true)
  if (type === 'envelopes') return envelopeDialog(app, true)
  const patch: Partial<MailMerge> = { type }
  if (type === 'emails' && !mmOf(app)?.email) patch.email = { to: mmOf(app)?.map?.email ?? '', subject: '' }
  patchMm(app, patch)
}

// --- liste de destinataires ----------------------------------------------------

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null))
    input.click()
  })
}

/** Utiliser une liste existante (CSV, TSV, JSON, vCard). */
export async function useExistingList(app: FolioApp, file?: File | null): Promise<void> {
  const f = file ?? (await pickFile('.csv,.tsv,.txt,.json,.vcf,text/csv,application/json,text/vcard'))
  if (!f) return
  const parsed = parseSourceFile(f.name, await f.text())
  if (!parsed || !parsed.source.fields.length) return void toast(t('mm.unreadable'), { kind: 'error' })
  const cur = mmOf(app)
  setMm(app, { type: cur?.type ?? 'letters', ...(cur?.label ? { label: cur.label } : {}), ...(cur?.envelope ? { envelope: cur.envelope } : {}), source: parsed.source, map: guessMap(parsed.source.fields), ...(cur?.email ? { email: { ...cur.email, to: guessMap(parsed.source.fields).email ?? cur.email.to } } : {}) })
  toast(t('mm.loaded', { n: parsed.source.records.length, f: parsed.source.fields.length }) + (parsed.truncated ? ` ${t('mm.truncated')}` : ''), { kind: parsed.truncated ? 'warning' : 'success', timeout: 8000 })
}

/** Taper une nouvelle liste : colonnes usuelles, une ligne vide. */
function typeNewList(app: FolioApp): void {
  const fields = [...DEFAULT_FIELDS[lang()]]
  const cur = mmOf(app)
  setMm(app, { type: cur?.type ?? 'letters', ...(cur?.label ? { label: cur.label } : {}), ...(cur?.envelope ? { envelope: cur.envelope } : {}), source: { name: t('mm.listTitle'), fields, records: [fields.map(() => '')] }, map: guessMap(fields) })
  editListDialog(app, true)
}

/** Modifier la liste de destinataires : cocher, trier, filtrer, corriger, ajouter. */
export function editListDialog(app: FolioApp, editing = false): void {
  const mm0 = mmOf(app)
  if (!mm0?.source) return void toast(t('mm.noList'), { kind: 'info' })
  // On travaille sur une copie ; « OK » l'applique en une étape annulable.
  const mm: MailMerge = JSON.parse(JSON.stringify(mm0))
  const src = mm.source!
  const excluded = new Set(src.excluded ?? [])
  const table = h('table', { class: 'fp-mm__table', 'data-field': 'recipients' })
  const info = h('p', { class: 'fp-muted', 'data-field': 'list-info' })
  const MAX_SHOWN = 300
  const filterField = select([['', t('mm.filterNone')], ...src.fields.map((f): [string, string] => [f, f])], mm.filters?.[0]?.field ?? '', { 'data-field': 'filter-field' })
  const filterOp = select(opOptions(), mm.filters?.[0]?.op ?? 'eq', { 'data-field': 'filter-op' })
  const filterValue = h('input', { type: 'text', class: 'fp-input', 'data-field': 'filter-value', value: mm.filters?.[0]?.value ?? '' }) as HTMLInputElement
  const sortField = select([['', t('mm.sortNone')], ...src.fields.map((f): [string, string] => [f, f])], mm.sort?.field ?? '', { 'data-field': 'sort-field' })
  const sortDesc = h('input', { type: 'checkbox', 'data-field': 'sort-desc' }) as HTMLInputElement
  sortDesc.checked = !!mm.sort?.desc
  const apply = () => {
    src.excluded = [...excluded].sort((a, b) => a - b)
    if (!src.excluded.length) delete src.excluded
    mm.filters = filterField.value ? [{ field: filterField.value, op: filterOp.value as MergeFilter['op'], ...(filterValue.value ? { value: filterValue.value } : {}) }] : undefined
    if (!mm.filters) delete mm.filters
    mm.sort = sortField.value ? { field: sortField.value, ...(sortDesc.checked ? { desc: true } : {}) } : undefined
    if (!mm.sort) delete mm.sort
  }
  const render = () => {
    apply()
    const kept = new Set(recipients(mm).map((r) => r.index))
    info.textContent = t('mm.listInfo', { n: kept.size, total: src.records.length })
    table.replaceChildren()
    const head = h('tr', {}, h('th', {}, t('mm.include')), ...src.fields.map((f) => h('th', { scope: 'col' }, f)), editing ? h('th', {}, '') : null)
    table.append(h('thead', {}, head))
    const body = h('tbody', {})
    src.records.slice(0, MAX_SHOWN).forEach((rec, i) => {
      const box = h('input', { type: 'checkbox', 'data-row': String(i), 'aria-label': `${t('mm.include')} ${i + 1}` }) as HTMLInputElement
      box.checked = !excluded.has(i)
      box.addEventListener('change', () => {
        if (box.checked) excluded.delete(i)
        else excluded.add(i)
        render()
      })
      const tr = h('tr', { class: kept.has(i) ? '' : 'is-out' }, h('td', {}, box))
      rec.forEach((v, c) => {
        if (!editing) tr.append(h('td', {}, v))
        else {
          const cell = h('input', { type: 'text', class: 'fp-input fp-mm__cell', value: v, 'data-cell': `${i}:${c}`, 'aria-label': src.fields[c] }) as HTMLInputElement
          // À chaque frappe : un nouveau rendu (tri, filtre) ne perd pas la saisie en cours.
          cell.addEventListener('input', () => {
            rec[c] = cell.value.slice(0, 2000)
          })
          tr.append(h('td', {}, cell))
        }
      })
      if (editing) {
        const del = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-delete-row': String(i) }, t('mm.deleteRow'))
        del.addEventListener('click', () => {
          src.records.splice(i, 1)
          // Les indices décochés suivent la suppression.
          const next = new Set<number>()
          for (const x of excluded) if (x !== i) next.add(x > i ? x - 1 : x)
          excluded.clear()
          for (const x of next) excluded.add(x)
          render()
        })
        tr.append(h('td', {}, del))
      }
      body.append(tr)
    })
    table.append(body)
    if (src.records.length > MAX_SHOWN) table.append(h('caption', { class: 'fp-muted' }, t('mm.more', { n: src.records.length - MAX_SHOWN })))
  }
  for (const c of [filterField, filterOp, filterValue, sortField, sortDesc]) c.addEventListener('change', render)
  const tools = h('div', { class: 'fp-mm__tools' })
  const tool = (label: string, id: string, run: () => void) => {
    const b = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-tool': id }, label)
    b.addEventListener('click', () => {
      run()
      render()
    })
    tools.append(b)
  }
  tool(t('mm.selectAll'), 'all', () => excluded.clear())
  tool(t('mm.selectNone'), 'none', () => src.records.forEach((_, i) => excluded.add(i)))
  tool(t('mm.duplicates'), 'duplicates', () => {
    const seen = new Set<string>()
    let n = 0
    src.records.forEach((r, i) => {
      const key = r.map((v) => v.trim().toLowerCase()).join('\u0000')
      if (seen.has(key) && !excluded.has(i)) {
        excluded.add(i)
        n++
      }
      seen.add(key)
    })
    toast(t('mm.duplicatesDone', { n }), { kind: 'info' })
  })
  if (editing) {
    tool(t('mm.addRow'), 'add-row', () => {
      if (src.records.length < 10_000) src.records.push(src.fields.map(() => ''))
    })
    tool(t('mm.addColumn'), 'add-column', () => {
      const name = (prompt(t('mm.columnName')) ?? '').trim().slice(0, 80)
      if (!name || src.fields.includes(name) || src.fields.length >= 60) return
      src.fields.push(name)
      for (const r of src.records) r.push('')
    })
  }
  render()
  openDialog({
    name: 'mm-list',
    title: `${t('mm.listTitle')}${src.name ? ` — ${src.name}` : ''}`,
    wide: true,
    body: [
      info,
      h('div', { class: 'fp-mm__filters' }, row(t('mm.filter'), h('span', { class: 'fp-mm__inline' }, filterField, filterOp, filterValue)), row(t('mm.sortBy'), h('span', { class: 'fp-mm__inline' }, sortField, h('label', { class: 'fp-check' }, sortDesc, h('span', {}, t('mm.desc')))))),
      tools,
      h('div', { class: 'fp-mm__scroll' }, table),
      h('p', { class: 'fp-form__hint' }, t('mm.listKept')),
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          apply()
          setMm(app, mm)
        },
      },
    ],
  })
}

/** Faire correspondre les champs : chaque champ d'adresse ↔ une colonne. */
function matchFieldsDialog(app: FolioApp): void {
  const mm = mmOf(app)
  if (!mm?.source) return void toast(t('mm.noList'), { kind: 'info' })
  const options: [string, string][] = [['', t('mm.notMatched')], ...mm.source.fields.map((f): [string, string] => [f, f])]
  const selects = new Map<AddressField, HTMLSelectElement>()
  const rows = ADDRESS_FIELDS.map((f) => {
    const s = select(options, mm.map?.[f] ?? '', { 'data-match': f })
    selects.set(f, s)
    return row(t(`mm.f.${f}` as Key), s)
  })
  openDialog({
    name: 'mm-match',
    title: t('mm.match'),
    body: [h('p', { class: 'fp-form__hint' }, t('mm.matchHint')), h('div', { class: 'fp-mm__grid' }, ...rows)],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const map: Partial<Record<AddressField, string>> = {}
          for (const [f, s] of selects) if (s.value) map[f] = s.value
          patchMm(app, { map })
        },
      },
    ],
  })
}

// --- champs ---------------------------------------------------------------------

function previewRecipient(app: FolioApp) {
  const list = recipients(mmOf(app))
  return { list, r: list[Math.min(mergeViewOf(app.state).index, list.length - 1)] }
}

function addressDialog(app: FolioApp): void {
  const company = h('input', { type: 'checkbox', 'data-field': 'company' }) as HTMLInputElement
  company.checked = true
  const country = select((['always', 'never', 'foreign'] as const).map((c): [string, string] => [c, t(`mm.country.${c}` as Key)]), 'foreign', { 'data-field': 'country' })
  const home = h('input', { type: 'text', class: 'fp-input', 'data-field': 'home', value: lang() === 'fr' ? 'France' : '' }) as HTMLInputElement
  const preview = h('pre', { class: 'fp-mm__preview', 'data-field': 'address-preview' })
  const opts = () => ({ company: company.checked ? 'yes' : 'no', country: country.value, ...(home.value.trim() ? { home: home.value.trim() } : {}) })
  const refresh = () => {
    const { r } = previewRecipient(app)
    preview.textContent = r ? addressLines(mmOf(app), r, opts()).join('\n') : t('mm.noList')
  }
  for (const c of [company, country, home]) c.addEventListener('input', refresh)
  refresh()
  openDialog({
    name: 'mm-address',
    title: t('mm.addressTitle'),
    body: [h('label', { class: 'fp-check' }, company, h('span', {}, t('mm.includeCompany'))), row(t('mm.countryMode'), h('span', { class: 'fp-mm__inline' }, country, home)), h('div', { class: 'fp-label' }, t('mm.previewOf', { n: mergeViewOf(app.state).index + 1 })), preview],
    actions: [
      { label: t('mm.match'), value: 'match', run: () => void setTimeout(() => matchFieldsDialog(app), 0) },
      { label: t('action.cancel'), value: 'cancel' },
      { label: t('math.insertAt'), value: 'ok', primary: true, run: () => void app.run(insertMergeField('@address', opts())) },
    ],
  })
}

function greetingDialog(app: FolioApp): void {
  const fr = lang() === 'fr'
  const salutation = select((fr ? ['Bonjour', 'Madame, Monsieur', 'Cher', 'Chère', 'Bonsoir', 'Dear', 'Hello'] : ['Dear', 'Hello', 'Hi', 'To', 'Bonjour']).map((s): [string, string] => [s, s]), fr ? 'Bonjour' : 'Dear', { 'data-field': 'salutation' })
  const nameFormat = select((['first', 'full', 'title-last', 'last'] as const).map((f): [string, string] => [f, t(`mm.name.${f}` as Key)]), 'first', { 'data-field': 'name-format' })
  const punct = select([[',', ','], [':', ':'], ['', '(—)'], ['!', '!']], ',', { 'data-field': 'punct' })
  const fallback = h('input', { type: 'text', class: 'fp-input', 'data-field': 'fallback', value: fr ? 'Madame, Monsieur,' : 'Dear Sir or Madam,' }) as HTMLInputElement
  const preview = h('p', { class: 'fp-mm__preview', 'data-field': 'greeting-preview' })
  const opts = () => ({ salutation: salutation.value, nameFormat: nameFormat.value, punct: punct.value, fallback: fallback.value })
  const refresh = () => {
    const { r } = previewRecipient(app)
    preview.textContent = r ? greetingText(mmOf(app), r, opts(), lang()) : t('mm.noList')
  }
  for (const c of [salutation, nameFormat, punct, fallback]) c.addEventListener('input', refresh)
  refresh()
  openDialog({
    name: 'mm-greeting',
    title: t('mm.greetingTitle'),
    body: [row(t('mm.salutation'), salutation), row(t('mm.nameFormat'), nameFormat), row(t('mm.punct'), punct), row(t('mm.fallback'), fallback), h('div', { class: 'fp-label' }, t('mm.previewOf', { n: mergeViewOf(app.state).index + 1 })), preview],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      { label: t('math.insertAt'), value: 'ok', primary: true, run: () => void app.run(insertMergeField('@greeting', opts())) },
    ],
  })
}

/** Règles à condition : Si… Alors… Sinon, Enregistrement suivant si, Ignorer si. */
function conditionDialog(app: FolioApp, rule: '@if' | '@nextif' | '@skipif'): void {
  const fields = fieldsOf(app)
  if (!fields.length) return void toast(t('mm.noField'), { kind: 'info' })
  const field = select(fields.map((f): [string, string] => [f, f]), fields[0], { 'data-field': 'rule-field' })
  const op = select(opOptions(), 'eq', { 'data-field': 'rule-op' })
  const value = h('input', { type: 'text', class: 'fp-input', 'data-field': 'rule-value' }) as HTMLInputElement
  const then = h('textarea', { class: 'fp-input', rows: '2', 'data-field': 'rule-then' }) as HTMLTextAreaElement
  const els = h('textarea', { class: 'fp-input', rows: '2', 'data-field': 'rule-else' }) as HTMLTextAreaElement
  const body: HTMLElement[] = [row(t('mm.field'), field), row(t('mm.comparison'), op), row(t('mm.compareTo'), value)]
  if (rule === '@if') body.push(row(t('mm.thenText'), then), row(t('mm.elseText'), els), h('p', { class: 'fp-form__hint' }, t('mm.tokensHint')))
  openDialog({
    name: 'mm-rule',
    title: rule === '@if' ? t('mm.ifTitle') : t(`mm.ruleTitle.${rule.slice(1)}` as Key),
    body,
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('math.insertAt'),
        value: 'ok',
        primary: true,
        run: () => {
          const opts: Record<string, string> = { field: field.value, op: op.value }
          if (value.value) opts.value = value.value
          if (rule === '@if') {
            if (then.value) opts.then = then.value
            if (els.value) opts.else = els.value
          }
          app.run(insertMergeField(rule, opts))
        },
      },
    ],
  })
}

function fillinDialog(app: FolioApp): void {
  const promptText = h('input', { type: 'text', class: 'fp-input', 'data-field': 'fillin-prompt' }) as HTMLInputElement
  const def = h('input', { type: 'text', class: 'fp-input', 'data-field': 'fillin-default' }) as HTMLInputElement
  openDialog({
    name: 'mm-fillin',
    title: t('mm.fillinTitle'),
    focus: promptText,
    body: [row(t('mm.prompt'), promptText), row(t('mm.defaultAnswer'), def)],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('math.insertAt'),
        value: 'ok',
        primary: true,
        run: () => {
          if (!promptText.value.trim()) return false
          app.run(insertMergeField('@fillin', { prompt: promptText.value.trim(), ...(def.value ? { default: def.value } : {}) }))
          return true
        },
      },
    ],
  })
}

// --- enveloppes et étiquettes ---------------------------------------------------

/** Page aux dimensions données (mm) : largeur et hauteur rangées en portrait, l'orientation dit le sens. */
const mmToPage = (w: number, h0: number, margins: { top: number; right: number; bottom: number; left: number }) => ({ size: 'custom', width: Math.min(w, h0), height: Math.max(w, h0), orientation: w > h0 ? ('landscape' as const) : ('portrait' as const), margins })

/** Enveloppe : format, adresse de l'expéditeur. `start` : le document devient le modèle de l'enveloppe. */
function envelopeDialog(app: FolioApp, start: boolean): void {
  const cur = mmOf(app)?.envelope
  const size = select(ENVELOPE_PRESETS.map((e, i): [string, string] => [String(i), e.name]), String(Math.max(0, ENVELOPE_PRESETS.findIndex((e) => e.width === cur?.width && e.height === cur?.height))), { 'data-field': 'envelope-size' })
  const ret = h('textarea', { class: 'fp-input', rows: '4', 'data-field': 'return-address' }) as HTMLTextAreaElement
  ret.value = cur?.returnAddress ?? ''
  const delivery = h('textarea', { class: 'fp-input', rows: '4', 'data-field': 'delivery-address' }) as HTMLTextAreaElement
  const body: HTMLElement[] = [row(t('mm.envelopeSize'), size), row(t('mm.returnAddress'), ret)]
  if (!start) body.push(row(t('mm.delivery'), delivery))
  openDialog({
    name: 'mm-envelope',
    title: t('mm.envelopeTitle'),
    body,
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: start ? t('action.ok') : t('mm.newDocument'),
        value: 'ok',
        primary: true,
        run: () => {
          const e = ENVELOPE_PRESETS[Number(size.value)] ?? ENVELOPE_PRESETS[0]
          const envelope = { name: e.name, width: e.width, height: e.height, returnAddress: ret.value.slice(0, 1000) }
          const blocks = envelopeBlocks(envelope, start ? null : delivery.value)
          const page = mmToPage(e.width, e.height, { top: 12, right: 12, bottom: 10, left: 15 })
          if (start) {
            patchMm(app, { type: 'envelopes', envelope })
            P.setPage(app, page)
            // Un document vide reçoit le modèle d'enveloppe (adresse de l'expéditeur, bloc d'adresse).
            const doc = app.getDoc()
            if (isEmptyDoc(doc.blocks)) app.replaceDocument({ ...doc, blocks }, true)
            toast(t('mm.envelopesStarted'), { kind: 'info' })
          } else {
            const doc = blankDoc(app, blocks)
            doc.page = { ...doc.page, ...page }
            openInNewTab(doc, `${t('mm.envelopeTitle')}.html`)
          }
        },
      },
    ],
  })
}

function envelopeBlocks(e: { width: number; height: number; returnAddress: string }, delivery: string | null): Block[] {
  const ret: Block = { type: 'paragraph', content: e.returnAddress ? [{ text: e.returnAddress, size: 9 }] : [] }
  const indent = Math.round(((e.width * 0.42) * 72) / 25.4)
  const before = Math.round(((e.height * 0.28) * 72) / 25.4)
  const addr: Block = { type: 'paragraph', indent: { left: indent }, spacing: { before }, content: delivery === null ? [{ type: 'mergefield', name: '@address', opts: { company: 'yes', country: 'foreign' } }] : [{ text: delivery }] }
  return [ret, addr]
}

const isEmptyDoc = (blocks: Block[]) => blocks.every((b) => b.type === 'paragraph' && !b.content.length)

function blankDoc(app: FolioApp, blocks: Block[]): FolioDoc {
  const doc = app.getDoc()
  return { ...doc, id: mintId(), blocks, comments: [], mailMerge: undefined, template: false, readOnly: false, meta: { ...doc.meta, created: new Date().toISOString(), modified: '' } }
}

/** Étiquettes : planche, texte. `start` : le document devient le modèle d'une étiquette. */
function labelsDialog(app: FolioApp, start: boolean): void {
  const cur = mmOf(app)?.label
  const idx = Math.max(0, LABEL_PRESETS.findIndex((p) => p.name === cur?.name))
  const sheetSel = select([...LABEL_PRESETS.map((p, i): [string, string] => [String(i), p.name]), ['custom', t('mm.custom')]], cur && idx < 0 ? 'custom' : String(idx), { 'data-field': 'label-sheet' })
  const base = cur ?? LABEL_PRESETS[0]
  const numbers = new Map<keyof LabelSheet, HTMLInputElement>()
  const custom = h('div', { class: 'fp-mm__grid', 'data-field': 'label-custom' })
  for (const k of ['pageWidth', 'pageHeight', 'cols', 'rows', 'width', 'height', 'top', 'left', 'hgap', 'vgap'] as const) {
    const inp = h('input', { type: 'number', class: 'fp-input', step: k === 'cols' || k === 'rows' ? '1' : '0.1', min: '0', value: String(base[k]), 'data-label': k }) as HTMLInputElement
    numbers.set(k, inp)
    custom.append(row(t(`mm.l.${k}` as Key), inp))
  }
  const syncCustom = () => (custom.hidden = sheetSel.value !== 'custom')
  sheetSel.addEventListener('change', syncCustom)
  syncCustom()
  const text = h('textarea', { class: 'fp-input', rows: '4', 'data-field': 'label-text' }) as HTMLTextAreaElement
  const body: HTMLElement[] = [row(t('mm.labelSheet'), sheetSel), custom]
  if (!start) body.push(row(t('mm.labelText'), text), h('p', { class: 'fp-form__hint' }, t('mm.labelFull')))
  const sheetOf = (): LabelSheet => {
    if (sheetSel.value !== 'custom') return LABEL_PRESETS[Number(sheetSel.value)]
    const v = (k: keyof LabelSheet) => Math.max(0, Number(numbers.get(k)!.value) || 0)
    return { name: t('mm.custom').replace('…', ''), pageWidth: v('pageWidth') || 210, pageHeight: v('pageHeight') || 297, cols: Math.min(10, Math.max(1, Math.round(v('cols')))), rows: Math.min(40, Math.max(1, Math.round(v('rows')))), width: v('width') || 50, height: v('height') || 20, top: v('top'), left: v('left'), hgap: v('hgap'), vgap: v('vgap') }
  }
  openDialog({
    name: 'mm-labels',
    title: t('mm.labelTitle'),
    body,
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: start ? t('action.ok') : t('mm.newDocument'),
        value: 'ok',
        primary: true,
        run: () => {
          const label = sheetOf()
          if (start) {
            patchMm(app, { type: 'labels', label })
            const doc = app.getDoc()
            if (isEmptyDoc(doc.blocks)) app.replaceDocument({ ...doc, blocks: [{ type: 'paragraph', content: [{ type: 'mergefield', name: '@address', opts: { company: 'yes', country: 'foreign' } }] }] }, true)
            toast(t('mm.labelsStarted'), { kind: 'info' })
          } else {
            // Une page entière de la même étiquette : la fusion des étiquettes, avec une « liste » d'un seul texte répété.
            const src = { name: '', fields: ['Text'], records: Array.from({ length: label.cols * label.rows }, () => [text.value.slice(0, 2000)]) }
            const tmpl: FolioDoc = { ...blankDoc(app, [{ type: 'paragraph', content: [{ type: 'mergefield', name: 'Text' }] }]), mailMerge: { type: 'labels', label, source: src } }
            const merged = mergeDocument(tmpl, { id: mintId(), lang: lang() })
            openInNewTab(merged.doc, `${t('mm.labelTitle')}.html`)
          }
        },
      },
    ],
  })
}

// --- aperçu, recherche, vérification --------------------------------------------

function go(app: FolioApp, index: number): void {
  const n = recipients(mmOf(app)).length
  if (!n) return
  app.run(setMergeView({ preview: true, index: Math.max(0, Math.min(n - 1, index)) }), false)
}

function navigator_(app: FolioApp): Ctl {
  const count = () => recipients(mmOf(app)).length
  const mk = (id: string, ic: string, label: string, run: () => void) => {
    const b = h('button', { type: 'button', class: 'fp-rb-btn', 'data-cmd': id, title: label, 'aria-label': label }) as HTMLButtonElement
    b.append(icon(ic))
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', run)
    return b
  }
  const input = h('input', { type: 'number', min: '1', class: 'fp-rb-num fp-mm__record', 'data-cmd': 'mm-record', 'aria-label': t('mm.recordNumber'), title: t('mm.recordNumber') }) as HTMLInputElement
  input.addEventListener('change', () => go(app, (Number(input.value) || 1) - 1))
  const first = mk('mm-first', I.mmFirst, t('mm.first'), () => go(app, 0))
  const prev = mk('mm-prev', I.mmPrev, t('mm.prev'), () => go(app, mergeViewOf(app.state).index - 1))
  const next = mk('mm-next', I.mmNext, t('mm.next'), () => go(app, mergeViewOf(app.state).index + 1))
  const last = mk('mm-last', I.mmLast, t('mm.last'), () => go(app, count() - 1))
  const el = h('div', { class: 'fp-mm__nav' }, first, prev, input, next, last)
  return {
    el,
    update: () => {
      const n = count()
      const v = mergeViewOf(app.state)
      const on = v.preview && n > 0
      for (const b of [first, prev, next, last]) b.disabled = !on
      input.disabled = !on
      if (document.activeElement !== input) input.value = on ? String(Math.min(v.index, n - 1) + 1) : ''
      prev.disabled = !on || v.index <= 0
      first.disabled = prev.disabled
      next.disabled = !on || v.index >= n - 1
      last.disabled = next.disabled
    },
  }
}

function findDialog(app: FolioApp): void {
  const mm = mmOf(app)
  if (!mm?.source) return void toast(t('mm.noList'), { kind: 'info' })
  const text = h('input', { type: 'search', class: 'fp-input', 'data-field': 'find-recipient' }) as HTMLInputElement
  const where = select([['', t('mm.allFields')], ...mm.source.fields.map((f): [string, string] => [f, f])], '', { 'data-field': 'find-in' })
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  openDialog({
    name: 'mm-find',
    title: t('mm.findTitle'),
    focus: text,
    body: [row(t('mm.findText'), text), row(t('mm.findIn'), where), error],
    actions: [
      { label: t('action.close'), value: 'cancel' },
      {
        label: t('mm.next'),
        value: 'ok',
        primary: true,
        run: () => {
          const q = text.value.trim().toLocaleLowerCase()
          if (!q) return false
          const list = recipients(mmOf(app))
          const start = mergeViewOf(app.state).preview ? mergeViewOf(app.state).index + 1 : 0
          for (let k = 0; k < list.length; k++) {
            const i = (start + k) % list.length
            const vals = where.value ? [list[i].values[where.value] ?? ''] : Object.values(list[i].values)
            if (vals.some((v) => v.toLocaleLowerCase().includes(q))) {
              go(app, i)
              error.textContent = ''
              return false
            }
          }
          error.textContent = t('mm.notFound')
          return false
        },
      },
    ],
  })
}

function checkDialog(app: FolioApp): void {
  const problems = checkMerge(app.getDoc())
  openDialog({
    name: 'mm-check',
    title: t('mm.checkTitle'),
    body: problems.length
      ? [h('ul', { class: 'fp-report' }, ...problems.map((p) => h('li', { class: 'fp-report__item fp-report__item--warning', 'data-problem': p.kind }, t(`mm.err.${p.kind}` as Key, { field: p.field ?? '', record: p.record ?? '' }))))]
      : [h('p', { class: 'fp-ok', 'data-field': 'check-ok' }, t('mm.checkOk'))],
    actions: [{ label: t('action.close'), value: 'close', primary: true }],
  })
}

// --- terminer -------------------------------------------------------------------

/** Les réponses aux questions « Remplir », demandées une fois avant la fusion. */
async function askFillins(app: FolioApp): Promise<Record<string, string> | null> {
  const prompts = fillinPrompts(app.getDoc().blocks)
  if (!prompts.length) return {}
  const inputs = prompts.map((p) => h('input', { type: 'text', class: 'fp-input', value: p.default, 'data-fillin': p.prompt }) as HTMLInputElement)
  const res = await openDialog({
    name: 'mm-fillins',
    title: t('mm.fillinAsk'),
    focus: inputs[0],
    body: prompts.map((p, i) => row(p.prompt || '?', inputs[i])),
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      { label: t('action.ok'), value: 'ok', primary: true },
    ],
  }).result
  if (res !== 'ok') return null
  return Object.fromEntries(prompts.map((p, i) => [p.prompt, inputs[i].value]))
}

async function finish(app: FolioApp, print: boolean): Promise<void> {
  const doc = app.getDoc()
  if (!doc.mailMerge?.source) return void toast(t('mm.noList'), { kind: 'info' })
  const range = await openDialog({
    name: 'mm-finish',
    title: print ? t('mm.printDocs').replace('…', '') : t('mm.editDocs').replace('…', ''),
    body: [h('p', {}, t('mm.listInfo', { n: recipients(doc.mailMerge).length, total: doc.mailMerge.source.records.length }))],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      { label: t('mm.range.current'), value: 'current' },
      { label: t('mm.range.all'), value: 'all', primary: true },
    ],
  }).result
  if (range !== 'all' && range !== 'current') return
  const fillins = await askFillins(app)
  if (!fillins) return
  const res = mergeDocument(doc, { fillins, id: mintId(), lang: lang(), ...(range === 'current' ? { only: mergeViewOf(app.state).index } : {}) })
  res.doc.meta = { ...res.doc.meta, title: `${doc.meta.title || app.displayTitle()} (${t('mm.mergedSuffix')})` }
  const name = fileName(app, t('mm.mergedSuffix'))
  const how = openInNewTab(res.doc, name, print)
  const skipped = res.skipped ? ` ${t('mm.skipped', { n: res.skipped })}` : ''
  toast((how === 'tab' ? t('mm.merged', { n: res.count }) : t('mm.mergedDownload', { n: res.count, name })) + skipped, { kind: 'success', timeout: 9000 })
}

/** Copier un message : mis en forme (HTML) quand le navigateur le permet, sinon en texte. */
async function copyMessage(app: FolioApp, m: EmailMessage): Promise<boolean> {
  const doc = app.getDoc()
  const html = blocksHtml(m.blocks, { theme: doc.theme })
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([m.body], { type: 'text/plain' }) })])
    } else await navigator.clipboard.writeText(m.body)
    return true
  } catch {
    try {
      await navigator.clipboard.writeText(m.body)
      return true
    } catch {
      return false
    }
  }
}

/** Ouvrir un message dans la messagerie choisie. Un corps trop long pour le lien est copié. */
async function composeOne(app: FolioApp, m: EmailMessage & { cc?: string }, via: Webmail): Promise<boolean> {
  if (via !== 'app' && isOffline()) {
    toast(t('offline.blocked'), { kind: 'info' })
    return false
  }
  const fits = fitsInUrl(m)
  if (!fits) {
    const ok = await copyMessage(app, m)
    toast(ok ? t('mm.bodyCopied') : t('mm.bodyTooLong'), { kind: 'info', timeout: 9000 })
  }
  const url = composeUrl(via, m, fits)
  if (via === 'app') {
    // Un lien mailto: suivi dans la page : pas d'onglet vide ouvert pour rien.
    const a = h('a', { href: url, style: 'display:none' }) as HTMLAnchorElement
    document.body.append(a)
    a.click()
    a.remove()
    return true
  }
  return openUrl(url)
}

function emailDialog(app: FolioApp): void {
  const mm = mmOf(app)
  if (!mm?.source) return void toast(t('mm.noList'), { kind: 'info' })
  const to = select(mm.source.fields.map((f): [string, string] => [f, f]), mm.email?.to || mm.map?.email || mm.source.fields[0], { 'data-field': 'email-to' })
  const subject = h('input', { type: 'text', class: 'fp-input', 'data-field': 'email-subject', value: mm.email?.subject ?? '' }) as HTMLInputElement
  const via = select(
    WEBMAILS.map((w): [string, string] => [w, t(`mm.via.${w}` as Key)]),
    settings().mailVia,
    { 'data-field': 'email-via' },
  )
  via.addEventListener('change', () => updateSettings({ mailVia: via.value as Webmail }))
  const progress = h('span', { class: 'fp-mm__progress', 'data-field': 'email-progress', 'aria-live': 'polite' })
  const tools = h('div', { class: 'fp-mm__email-tools', hidden: '' })
  const list = h('div', { class: 'fp-mm__emails', 'data-field': 'emails' })
  let msgs: EmailMessage[] = []
  const sent = new Set<number>()
  const rows: HTMLElement[] = []
  const showProgress = () => {
    progress.textContent = t('mm.sentCount', { n: sent.size, total: msgs.length })
    rows.forEach((r, i) => r.classList.toggle('is-sent', sent.has(i)))
  }
  const send = async (i: number) => {
    if (await composeOne(app, msgs[i], via.value as Webmail)) {
      sent.add(i)
      rows[i]?.setAttribute('data-sent', 'true')
      showProgress()
    }
  }
  const next = h('button', { type: 'button', class: 'fp-btn fp-btn--primary', 'data-email-next': '' }, t('mm.openNext'))
  next.addEventListener('click', () => {
    const i = msgs.findIndex((m, k) => !sent.has(k) && isEmail(m.to))
    if (i < 0) return void toast(t('mm.allSent'), { kind: 'success' })
    void send(i)
    rows[i]?.scrollIntoView({ block: 'nearest' })
  })
  const eml = h('button', { type: 'button', class: 'fp-btn', 'data-email-eml': '', title: t('mm.emlHint') }, t('mm.downloadEml'))
  eml.addEventListener('click', () => {
    const doc = app.getDoc()
    const ok = msgs.filter((m) => isEmail(m.to))
    if (!ok.length) return
    const o = { theme: doc.theme, assets: doc.assets }
    if (ok.length === 1) downloadFile(emlMessage(ok[0], o), emlName(ok[0], 1), 'message/rfc822')
    else {
      const files: Record<string, Uint8Array> = {}
      ok.forEach((m, i) => (files[emlName(m, i + 1)] = strToU8(emlMessage(m, o))))
      const zip = zipSync(files, { level: 6 })
      const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }))
      const a = h('a', { href: url, download: fileName(app, t('mm.emlFolder')).replace(/\.html$/, '.zip'), style: 'display:none' }) as HTMLAnchorElement
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    }
    toast(t('mm.emlDone', { n: ok.length }), { kind: 'success', timeout: 9000 })
  })
  const bcc = h('button', { type: 'button', class: 'fp-btn', 'data-email-bcc': '', title: t('mm.copyAddressesHint') }, t('mm.copyAddresses'))
  bcc.addEventListener('click', () => {
    const all = bccList(msgs)
    void navigator.clipboard
      ?.writeText(all.join(', '))
      .then(() => toast(t('mm.addressesCopied', { n: all.length }), { kind: 'success' }))
      .catch(() => undefined)
  })
  tools.append(progress, next, eml, bcc)
  const prepare = async () => {
    patchMm(app, { email: { to: to.value, subject: subject.value.slice(0, 300) } })
    const fillins = await askFillins(app)
    if (!fillins) return
    msgs = emailMessages(app.getDoc(), fillins).slice(0, 500)
    sent.clear()
    rows.length = 0
    list.replaceChildren()
    tools.hidden = !msgs.length
    if (!msgs.length) list.append(h('p', { class: 'fp-muted' }, t('mm.noEmails')))
    msgs.forEach((m, i) => {
      const valid = isEmail(m.to)
      const write = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-email': m.to, ...(valid ? {} : { disabled: '' }) }, t('mm.write'))
      write.addEventListener('click', () => void send(i))
      const copy = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-email-copy': String(i) }, t('mm.copyMessage'))
      copy.addEventListener('click', () => void copyMessage(app, m).then((ok) => ok && toast(t('mm.messageCopied'), { kind: 'success' })))
      const r = h(
        'div',
        { class: 'fp-mm__email' + (valid ? '' : ' is-invalid'), 'data-email-row': String(i) },
        h('span', { class: 'fp-mm__sent', 'aria-hidden': 'true' }, icon(ICONS.check)),
        h('div', { class: 'fp-mm__who' }, h('strong', {}, m.to || '—'), h('span', { class: 'fp-muted' }, valid ? ` · ${m.subject}` : ` · ${t('mm.badAddress')}`)),
        write,
        copy,
      )
      rows.push(r)
      list.append(r)
    })
    showProgress()
  }
  openDialog({
    name: 'mm-emails',
    title: t('mm.emailTitle'),
    wide: true,
    body: [
      h('div', { class: 'fp-mm__email-head' }, row(t('mm.emailTo'), to), row(t('mm.emailVia'), via)),
      row(t('mm.emailSubject'), subject),
      h('p', { class: 'fp-form__hint' }, t('mm.emailHint')),
      tools,
      list,
    ],
    actions: [
      { label: t('action.close'), value: 'close' },
      {
        label: t('mm.prepare'),
        value: 'prepare',
        primary: true,
        run: async () => {
          await prepare()
          return false
        },
      },
    ],
  })
}

// --- envoyer le document par e-mail ----------------------------------------------

/** Télécharger un fichier binaire (pièce jointe à glisser dans le message). */
function downloadBytes(bytes: Uint8Array, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const a = h('a', { href: url, download: name, style: 'display:none' }) as HTMLAnchorElement
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

type AttachFormat = 'html' | 'docx' | 'odt' | 'pdf'

/**
 * Le fichier joint : le document Folio Pages (modifiable, chiffré s'il est
 * protégé), ou une copie .docx, .odt ou PDF (fabriquée ici même).
 */
async function attachmentOf(app: FolioApp, format: AttachFormat): Promise<EmlAttachment | null> {
  if (format === 'pdf') {
    const f = await pdfFile(app)
    return f ? { name: f.name, type: 'application/pdf', data: f.bytes } : null
  }
  if (format === 'odt') {
    const f = await buildExport(app, 'odt')
    return { name: f.name, type: f.mime, data: f.bytes }
  }
  if (format === 'docx') {
    const made = await P.docxFile(app)
    return made ? { name: made.name, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: made.res.bytes } : null
  }
  return { name: app.suggestedFileName(), type: 'text/html', data: await app.fileText() }
}

/**
 * Envoyer ce document par e-mail, sans publipostage : à une ou plusieurs
 * adresses, dans le corps du message, en pièce jointe, ou les deux.
 */
export function sendDocumentDialog(app: FolioApp): void {
  const title = app.displayTitle()
  const to = h('input', { type: 'text', class: 'fp-input', 'data-field': 'send-to', placeholder: t('mail.toPlaceholder'), autocomplete: 'email', maxlength: '4000' }) as HTMLInputElement
  const cc = h('input', { type: 'text', class: 'fp-input', 'data-field': 'send-cc', autocomplete: 'email', maxlength: '4000' }) as HTMLInputElement
  const subject = h('input', { type: 'text', class: 'fp-input', 'data-field': 'send-subject', value: title.slice(0, 300), maxlength: '300' }) as HTMLInputElement
  const note = h('textarea', { class: 'fp-input fp-mm__note', 'data-field': 'send-note', rows: '3', maxlength: '5000', placeholder: t('mail.notePlaceholder') }) as HTMLTextAreaElement
  const content = select(
    (['body', 'attach', 'both'] as const).map((k): [string, string] => [k, t(`mail.content.${k}` as Key)]),
    'body',
    { 'data-field': 'send-content' },
  )
  const format = select(
    [
      ['html', t('mail.format.html')],
      ['docx', t('mail.format.docx')],
      ['odt', t('mail.format.odt')],
      ['pdf', t('mail.format.pdf')],
    ],
    'html',
    { 'data-field': 'send-format' },
  )
  const via = select(
    WEBMAILS.map((w): [string, string] => [w, t(`mm.via.${w}` as Key)]),
    settings().mailVia,
    { 'data-field': 'send-via' },
  )
  via.addEventListener('change', () => updateSettings({ mailVia: via.value as Webmail }))
  const formatRow = row(t('mail.format'), format)
  const hint = h('p', { class: 'fp-form__hint', 'data-field': 'send-hint' })
  const error = h('p', { class: 'fp-field-error', 'data-field': 'send-error', role: 'alert', hidden: '' })
  const refresh = () => {
    const attach = content.value !== 'body'
    formatRow.hidden = !attach
    hint.textContent = attach ? t('mail.attachHint') : t('mail.bodyHint')
  }
  content.addEventListener('change', refresh)
  format.addEventListener('change', refresh)
  refresh()

  /** Le message, ou null (avec l'erreur affichée) si une adresse est à corriger. */
  const build = (): (EmailMessage & { cc: string }) | null => {
    const a = parseAddresses(to.value)
    const c = parseAddresses(cc.value)
    const bad = [...a.bad, ...c.bad]
    error.hidden = !bad.length
    error.textContent = bad.length ? t('mail.badAddresses', { list: bad.slice(0, 3).join(', ') }) : ''
    if (bad.length) return null
    const doc = app.getDoc()
    const inBody = content.value !== 'attach'
    const noteLines = note.value.trim() ? note.value.trim().split(/\n/) : []
    const intro: Block[] = noteLines.map((line) => ({ type: 'paragraph', content: line ? [{ text: line }] : [] }) as Block)
    const fallback = noteLines.length ? [] : [{ type: 'paragraph', content: [{ text: t('mail.attached', { name: title }) }] } as Block]
    const blocks = inBody ? [...intro, ...doc.blocks] : [...intro, ...fallback]
    return { to: a.ok.join(', '), cc: c.ok.join(', '), subject: subject.value.trim().slice(0, 300), body: plainText(blocks), blocks, index: 0 }
  }

  const busy = { on: false }
  const openMessage = async (): Promise<boolean> => {
    const m = build()
    if (!m || busy.on) return false
    busy.on = true
    try {
      if (content.value !== 'body') {
        const file = await attachmentOf(app, format.value as AttachFormat)
        if (!file) return false
        if (typeof file.data === 'string') downloadFile(file.data, file.name, file.type)
        else downloadBytes(file.data, file.name, file.type)
        toast(t('mail.attachDownloaded', { name: file.name }), { kind: 'info', timeout: 12000 })
      }
      return await composeOne(app, m, via.value as Webmail)
    } finally {
      busy.on = false
    }
  }
  const draft = async (): Promise<boolean> => {
    const m = build()
    if (!m || busy.on) return false
    busy.on = true
    try {
      const doc = app.getDoc()
      const files: EmlAttachment[] = []
      if (content.value !== 'body') {
        const file = await attachmentOf(app, format.value as AttachFormat)
        if (!file) return false
        files.push(file)
      }
      const name = `${app.suggestedFileName().replace(/\.html?$/i, '')}.eml`
      downloadFile(emlMessage(m, { theme: doc.theme, assets: doc.assets, cc: m.cc, attachments: files }), name, 'message/rfc822')
      toast(t('mail.draftDone', { name }), { kind: 'success', timeout: 9000 })
      return true
    } finally {
      busy.on = false
    }
  }

  openDialog({
    name: 'send-doc',
    title: t('mail.title'),
    focus: to,
    body: [
      row(t('mail.to'), to),
      row(t('mail.cc'), cc),
      row(t('mm.emailSubject'), subject),
      row(t('mail.note'), note),
      row(t('mail.content'), content),
      formatRow,
      row(t('mm.emailVia'), via),
      hint,
      error,
    ],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      { label: t('mail.draft'), value: 'eml', run: draft },
      { label: t('mail.open'), value: 'open', primary: true, run: openMessage },
    ],
  })
  refresh()
}

/** « Un e-mail par destinataire » : demande d'abord une liste s'il n'y en a pas. */
function personalEmails(app: FolioApp): void {
  const start = () => {
    if (mmOf(app)?.type !== 'emails') startType(app, 'emails')
    emailDialog(app)
  }
  if (mmOf(app)?.source) return start()
  void openDialog({
    name: 'mm-need-list',
    title: t('mail.perRecipient').replace('…', ''),
    body: [h('p', {}, t('mail.needList'))],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      { label: t('mm.typeList'), value: 'type' },
      { label: t('mm.useList'), value: 'use', primary: true },
    ],
  }).result.then(async (v) => {
    if (v === 'type') {
      startType(app, 'emails')
      typeNewList(app)
    } else if (v === 'use') {
      await useExistingList(app)
      if (mmOf(app)?.source) start()
    }
  })
}

// --- onglet ----------------------------------------------------------------------

export function mailingsGroups(app: FolioApp): Group[] {
  const hasList = () => !!mmOf(app)?.source
  const isLabels = () => mmOf(app)?.type === 'labels'
  const fieldMenu = () => {
    const fields = fieldsOf(app)
    const content = h('div', { class: 'fp-pop__list', role: 'menu' })
    if (!fields.length) content.append(h('p', { class: 'fp-pop__empty' }, t('mm.noField')))
    for (const f of fields) content.append(popItem(f, () => app.run(insertMergeField(f)), { 'data-merge-field': f }))
    return content
  }
  const rulesMenu = () =>
    h(
      'div',
      { class: 'fp-pop__list', role: 'menu' },
      popItem(t('mm.rule.if'), () => conditionDialog(app, '@if'), { 'data-rule': 'if' }),
      popItem(t('mm.rule.fillin'), () => fillinDialog(app), { 'data-rule': 'fillin' }),
      popItem(t('mm.rule.record'), () => app.run(insertMergeField('@record')), { 'data-rule': 'record' }),
      popItem(t('mm.rule.sequence'), () => app.run(insertMergeField('@sequence')), { 'data-rule': 'sequence' }),
      popItem(t('mm.rule.next'), () => app.run(insertMergeField('@next')), { 'data-rule': 'next' }),
      popItem(t('mm.rule.nextif'), () => conditionDialog(app, '@nextif'), { 'data-rule': 'nextif' }),
      popItem(t('mm.rule.skipif'), () => conditionDialog(app, '@skipif'), { 'data-rule': 'skipif' }),
    )
  return [
    {
      id: 'mm-send',
      label: t('mail.group'),
      controls: [
        button({ id: 'mm-send-doc', label: t('mail.sendDoc'), icon: I.mailSend, large: true, run: () => sendDocumentDialog(app) }),
        button({ id: 'mm-send-each', label: t('mail.perRecipient'), icon: I.mailMany, large: true, run: () => personalEmails(app) }),
        dropdown({
          id: 'mm-mail-via',
          label: t('mm.emailVia'),
          icon: I.envelope,
          text: () => t(`mail.via.short.${settings().mailVia}` as Key),
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list', role: 'menu' },
              ...WEBMAILS.map((w) => popItem(t(`mm.via.${w}` as Key), () => updateSettings({ mailVia: w }), { 'data-mail-via': w, role: 'menuitemradio', 'aria-checked': String(settings().mailVia === w) })),
            ),
        }),
      ],
    },
    {
      id: 'mm-create',
      label: t('mm.create'),
      controls: [
        button({ id: 'mm-envelopes', label: t('mm.envelopes'), icon: I.envelope, large: true, run: () => envelopeDialog(app, false) }),
        button({ id: 'mm-labels', label: t('mm.labels'), icon: I.labels, large: true, run: () => labelsDialog(app, false) }),
      ],
    },
    {
      id: 'mm-start',
      label: t('mm.startGroup'),
      controls: [
        dropdown({
          id: 'mm-start',
          label: t('mm.start'),
          icon: I.mmStart,
          large: true,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list', role: 'menu' },
              ...(['letters', 'emails', 'envelopes', 'labels', 'directory', 'none'] as const).map((k) =>
                popItem(t(`mm.type.${k}` as Key), () => startType(app, k), { 'data-mm-type': k, 'aria-checked': String(k === 'none' ? !mmOf(app)?.source : mmOf(app)?.type === k && !!mmOf(app)) }),
              ),
            ),
        }),
        dropdown({
          id: 'mm-recipients',
          label: t('mm.selectRecipients'),
          icon: I.mmRecipients,
          large: true,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list', role: 'menu' },
              popItem(t('mm.typeList'), () => typeNewList(app), { 'data-recipients': 'type' }),
              popItem(t('mm.useList'), () => void useExistingList(app), { 'data-recipients': 'use' }),
              ...(hasList()
                ? [
                    h('hr', { class: 'fp-pop__sep' }),
                    popItem(t('mm.exportList'), () => downloadFile(toCsv(mmOf(app)!.source!), `${mmOf(app)!.source!.name.replace(/\.[^.]+$/, '') || 'destinataires'}.csv`, 'text/csv'), { 'data-recipients': 'export' }),
                    popItem(t('mm.removeList'), () => patchMm(app, { source: undefined, map: undefined, filters: undefined, sort: undefined }), { 'data-recipients': 'remove' }),
                  ]
                : []),
            ),
        }),
        button({ id: 'mm-edit-list', label: t('mm.editList'), icon: I.mmEditList, large: true, enabled: hasList, run: () => editListDialog(app, true) }),
      ],
    },
    {
      id: 'mm-write',
      label: t('mm.writeGroup'),
      controls: [
        button({ id: 'mm-highlight', label: t('mm.highlight'), icon: I.highlight, large: true, active: () => mergeViewOf(app.state).highlight, run: () => app.run(setMergeView({ highlight: !mergeViewOf(app.state).highlight })) }),
        button({ id: 'mm-address', label: t('mm.address'), icon: I.mmAddress, large: true, enabled: hasList, run: () => addressDialog(app) }),
        button({ id: 'mm-greeting', label: t('mm.greeting'), icon: I.mmGreeting, large: true, enabled: hasList, run: () => greetingDialog(app) }),
        dropdown({ id: 'mm-insert-field', label: t('mm.insertField'), icon: I.mmField, large: true, enabled: hasList, menu: fieldMenu }),
        dropdown({ id: 'mm-rules', label: t('mm.rules'), icon: I.mmRules, text: () => t('mm.rules'), enabled: hasList, menu: rulesMenu }),
        button({ id: 'mm-match', label: t('mm.match'), icon: I.mmMatch, text: true, enabled: hasList, run: () => matchFieldsDialog(app) }),
        button({ id: 'mm-update-labels', label: t('mm.updateLabels'), icon: I.labels, text: true, enabled: isLabels, run: () => labelsDialog(app, true) }),
      ],
    },
    {
      id: 'mm-preview',
      label: t('mm.previewGroup'),
      controls: [
        button({ id: 'mm-preview', label: t('mm.preview'), icon: I.mmPreview, large: true, enabled: hasList, active: () => mergeViewOf(app.state).preview, run: () => app.run(setMergeView({ preview: !mergeViewOf(app.state).preview })) }),
        navigator_(app),
        button({ id: 'mm-find', label: t('mm.find'), icon: I.find, text: true, enabled: hasList, run: () => findDialog(app) }),
        button({ id: 'mm-check', label: t('mm.check'), icon: I.mmCheck, text: true, enabled: hasList, run: () => checkDialog(app) }),
      ],
    },
    {
      id: 'mm-finish',
      label: t('mm.finishGroup'),
      controls: [
        dropdown({
          id: 'mm-finish',
          label: t('mm.finish'),
          icon: I.mmFinish,
          large: true,
          enabled: hasList,
          menu: () =>
            h(
              'div',
              { class: 'fp-pop__list', role: 'menu' },
              popItem(t('mm.editDocs'), () => void finish(app, false), { 'data-finish': 'edit' }),
              popItem(t('mm.printDocs'), () => void finish(app, true), { 'data-finish': 'print' }),
              popItem(t('mm.sendEmails'), () => emailDialog(app), { 'data-finish': 'email' }),
            ),
        }),
      ],
    },
  ]
}
