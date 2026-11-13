// Paquets de langue (phase 7, CLAUDE.md 4.9).
//
// Un paquet est un fichier JSON :
//   { "format": "folio/lang", "v": 1, "lang": "de", "name": "Deutsch",
//     "version": "0.7.0", "strings": { "menu.file": "Datei", … } }
// C'est une donnée, jamais du code : chaque phrase est vérifiée (clé connue,
// longueur bornée, mêmes {paramètres} que l'original) ; ce qui ne va pas est
// ignoré, et une phrase absente s'affiche en anglais.
//
// Un paquet ajouté est gardé dans ce navigateur. Il peut aussi être intégré au
// fichier (« Garder dans ce fichier ») : il voyage alors avec le document,
// dans un bloc <script type="application/folio-lang+json"> qui n'est jamais
// exécuté.

import { DICT } from '../i18n/dict'
import type { Key } from '../i18n/dict'
import { availableLanguages, lang, packList, registerPack, setLang, t, unregisterPack, type Entry, type LangPack } from '../i18n/i18n'
import { downloadFile } from '../file/save'
import { setExtraBlock } from '../file/shell'
import { openDialog, toast } from './dialog'
import { h } from './dom'

export const PACK_FORMAT = 'folio/lang'
export const PACKS_BLOCK_ID = 'folio-lang'
const STORE_KEY = 'folio-pages:packs'
const MAX_PACK_CHARS = 2_000_000
const MAX_STRING = 4000

/** Paquets intégrés au fichier ouvert (code de langue). */
const embedded = new Set<string>()

const paramsOf = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

function sourceParams(key: string): string {
  const row = (DICT as Record<string, { fr: Entry; en: Entry }>)[key]
  const forms = (e: Entry) => (typeof e === 'string' ? [e] : [e.one, e.other])
  return [...new Set(forms(row.fr).flatMap((x) => paramsOf(x).split(',').filter(Boolean)))].sort().join(',')
}

export interface PackCheck {
  pack: LangPack | null
  /** Phrases reprises, ignorées (clé inconnue, paramètres différents, trop longues), manquantes. */
  kept: number
  ignored: number
  missing: number
  error?: 'format' | 'lang' | 'builtin' | 'empty'
}

/** Vérifie un paquet (texte JSON ou objet). */
export function checkPack(input: unknown): PackCheck {
  let v = input
  if (typeof input === 'string') {
    if (input.length > MAX_PACK_CHARS) return { pack: null, kept: 0, ignored: 0, missing: 0, error: 'format' }
    try {
      v = JSON.parse(input)
    } catch {
      return { pack: null, kept: 0, ignored: 0, missing: 0, error: 'format' }
    }
  }
  const o = v as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || o.format !== PACK_FORMAT || o.v !== 1 || !o.strings || typeof o.strings !== 'object') return { pack: null, kept: 0, ignored: 0, missing: 0, error: 'format' }
  const code = typeof o.lang === 'string' ? o.lang.trim() : ''
  if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(code)) return { pack: null, kept: 0, ignored: 0, missing: 0, error: 'lang' }
  if (code === 'fr' || code === 'en') return { pack: null, kept: 0, ignored: 0, missing: 0, error: 'builtin' }
  const name = (typeof o.name === 'string' ? o.name : code).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || code
  const strings: Record<string, Entry> = {}
  let ignored = 0
  for (const [key, value] of Object.entries(o.strings as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(DICT, key)) {
      ignored++
      continue
    }
    const want = sourceParams(key)
    const okText = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_STRING && paramsOf(x) === want
    // Le pluriel : one/other, avec les mêmes paramètres (un seul des deux peut omettre {n}).
    if (typeof value === 'string' && okText(value)) strings[key] = value
    else if (value && typeof value === 'object' && okText((value as { other?: unknown }).other) && typeof (value as { one?: unknown }).one === 'string' && ((value as { one: string }).one.length <= MAX_STRING)) {
      strings[key] = { one: (value as { one: string }).one, other: (value as { other: string }).other }
    } else ignored++
  }
  const kept = Object.keys(strings).length
  if (!kept) return { pack: null, kept: 0, ignored, missing: Object.keys(DICT).length, error: 'empty' }
  const version = typeof o.version === 'string' ? o.version.slice(0, 20) : ''
  return { pack: { lang: code, name, version, strings }, kept, ignored, missing: Object.keys(DICT).length - kept }
}

// --- où les paquets sont gardés -------------------------------------------------

function storedPacks(): LangPack[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as unknown[]
    return Array.isArray(list) ? list.map((p) => checkPack(p).pack).filter((p): p is LangPack => !!p) : []
  } catch {
    return []
  }
}

function storePacks(list: LangPack[]): boolean {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list.map((p) => ({ format: PACK_FORMAT, v: 1, ...p }))))
    return true
  } catch {
    return false
  }
}

/** Le bloc des paquets intégrés, tel qu'il va dans le fichier (ou null s'il n'y en a pas). */
function embeddedBlock(): string | null {
  const list = packList().filter((p) => embedded.has(p.lang))
  if (!list.length) return null
  return JSON.stringify(list.map((p) => ({ format: PACK_FORMAT, v: 1, ...p })))
}

function syncEmbedded(): void {
  setExtraBlock(PACKS_BLOCK_ID, 'application/folio-lang+json', embeddedBlock())
}

/** Au démarrage : les paquets du fichier, puis ceux du navigateur. */
export function loadPacks(): void {
  const block = document.getElementById(PACKS_BLOCK_ID)
  if (block && block.getAttribute('type') === 'application/folio-lang+json') {
    try {
      const list = JSON.parse(block.textContent ?? '[]') as unknown[]
      for (const raw of Array.isArray(list) ? list.slice(0, 20) : []) {
        const p = checkPack(raw).pack
        if (p) {
          registerPack(p)
          embedded.add(p.lang)
        }
      }
    } catch {
      /* bloc illisible : ignoré */
    }
  }
  for (const p of storedPacks()) if (!embedded.has(p.lang)) registerPack(p)
  syncEmbedded()
}

/** Mise à jour du fichier : les paquets intégrés passent dans la nouvelle version. */
export function carryPacks(html: string): string {
  const block = embeddedBlock()
  if (!block || html.includes(`id="${PACKS_BLOCK_ID}"`)) return html
  const tag = `<script type="application/folio-lang+json" id="${PACKS_BLOCK_ID}">${block.replace(/</g, '\\u003c')}</script>`
  return html.replace('</head>', () => `${tag}\n</head>`)
}

/** Ajoute un paquet (fichier choisi) ; renvoie le compte rendu. */
export function installPack(text: string): PackCheck {
  const res = checkPack(text)
  if (!res.pack) return res
  registerPack(res.pack)
  const list = storedPacks().filter((p) => p.lang !== res.pack!.lang)
  storePacks([...list, res.pack])
  if (embedded.has(res.pack.lang)) syncEmbedded()
  return res
}

export function removePack(code: string): void {
  unregisterPack(code)
  embedded.delete(code)
  storePacks(storedPacks().filter((p) => p.lang !== code))
  syncEmbedded()
}

export function setEmbedded(code: string, on: boolean): void {
  if (on) embedded.add(code)
  else embedded.delete(code)
  syncEmbedded()
}

export const isEmbedded = (code: string): boolean => embedded.has(code)

/** Modèle de traduction : toutes les phrases, en français et en anglais, à traduire. */
export function translationTemplate(): string {
  const strings: Record<string, Entry> = {}
  const reference: Record<string, { fr: Entry; en: Entry }> = {}
  for (const [key, row] of Object.entries(DICT as Record<string, { fr: Entry; en: Entry }>)) {
    strings[key] = row.en
    reference[key] = { fr: row.fr, en: row.en }
  }
  return JSON.stringify({ format: PACK_FORMAT, v: 1, lang: 'xx', name: 'Language name', version: __FOLIO_VERSION__, strings, reference }, null, 2)
}

// --- interface ---------------------------------------------------------------------

function pickJsonFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null))
    input.click()
  })
}

/** Aide → Langue → Ajouter une langue… */
export async function addLanguageUi(file?: File | null): Promise<void> {
  const f = file ?? (await pickJsonFile())
  if (!f) return
  if (f.size > MAX_PACK_CHARS) return void toast(t('pack.bad'), { kind: 'error' })
  const res = installPack(await f.text())
  if (!res.pack) return void toast(t(`pack.${res.error ?? 'bad'}` as Key), { kind: 'error', timeout: 9000 })
  setLang(res.pack.lang)
  toast(t('pack.added', { name: res.pack.name, n: res.kept, missing: res.missing }), { kind: 'success', timeout: 10000 })
}

/** Aide → Langue → Gérer les langues… */
export function languagesDialog(): void {
  const list = h('div', { class: 'fp-packs', 'data-field': 'packs' })
  const render = () => {
    list.replaceChildren()
    const items = packList()
    if (!items.length) list.append(h('p', { class: 'fp-muted' }, t('pack.none')))
    for (const p of items) {
      const keep = h('input', { type: 'checkbox', 'data-pack-embed': p.lang }) as HTMLInputElement
      keep.checked = isEmbedded(p.lang)
      keep.addEventListener('change', () => setEmbedded(p.lang, keep.checked))
      const remove = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-pack-remove': p.lang }, t('pack.remove'))
      remove.addEventListener('click', () => {
        removePack(p.lang)
        render()
      })
      list.append(
        h(
          'div',
          { class: 'fp-packs__row', 'data-pack': p.lang },
          h('div', {}, h('strong', {}, p.name), h('span', { class: 'fp-muted' }, ` ${p.lang}${p.version ? ` · ${p.version}` : ''} · ${t('pack.count', { n: Object.keys(p.strings).length })}`)),
          h('label', { class: 'fp-check' }, keep, h('span', {}, t('pack.embed'))),
          remove,
        ),
      )
    }
  }
  render()
  openDialog({
    name: 'languages',
    title: t('pack.title'),
    wide: true,
    body: [
      h('p', {}, t('pack.intro')),
      h('p', { class: 'fp-muted' }, t('pack.current', { name: availableLanguages().find((l) => l.code === lang())?.name ?? lang() })),
      list,
      h('p', { class: 'fp-form__hint' }, t('pack.embedHint')),
    ],
    actions: [
      {
        label: t('pack.template'),
        value: 'template',
        run: () => {
          downloadFile(translationTemplate(), 'folio-pages-translation.json', 'application/json')
          return false
        },
      },
      {
        label: t('pack.add'),
        value: 'add',
        run: async () => {
          await addLanguageUi()
          render()
          return false
        },
      },
      { label: t('action.close'), value: 'close', primary: true },
    ],
  })
}
