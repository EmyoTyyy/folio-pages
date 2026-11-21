// Sources ⇄ BibTeX, RIS et CSL-JSON (Zotero, Mendeley, Google Scholar, JabRef…).
// Lecture tolérante : une entrée illisible est sautée, pas le fichier ; chaque
// champ est borné. Les auteurs s'écrivent « Nom, Prénom » (un organisme tel quel).

import { SOURCE_ID, SOURCE_TYPES, type Source, type SourceType } from '../format/types'

export const IMPORT_LIMITS = { file: 10_000_000, entries: 2_000, field: 1_000 }

export type SourceFormat = 'bibtex' | 'ris' | 'csl'

const clip = (s: string, n = IMPORT_LIMITS.field) => s.replace(/\s+/g, ' ').trim().slice(0, n)

/** « Jean Dupont », « Dupont, Jean », « {Organisation mondiale} » → « Nom, Prénom » (ou l'organisme). */
export function normalizeName(raw: string): string {
  const s = clip(raw, 200)
  if (!s) return ''
  if (/^\{.*\}$/.test(s)) return s.slice(1, -1).trim()
  if (s.includes(',')) return s
  const parts = s.split(' ')
  if (parts.length === 1) return s
  // Particules (de, van, von, da…) avec le nom.
  let i = parts.length - 1
  while (i > 1 && /^(de|du|des|van|von|der|den|da|di|del|della|la|le|ten|ter)$/i.test(parts[i - 1])) i--
  return `${parts.slice(i).join(' ')}, ${parts.slice(0, i).join(' ')}`
}

/** Identifiant valide et unique (clé d'origine si possible). */
function uniqueId(raw: string, taken: Set<string>, s: Partial<Source>): string {
  let base = (raw || '').replace(/[^\p{L}\p{N}_:.-]/gu, '').slice(0, 60)
  if (!base || !SOURCE_ID.test(base)) {
    const last = (s.authors?.[0] ?? s.title ?? 'source').split(',')[0].replace(/[^\p{L}\p{N}]/gu, '').slice(0, 30) || 'source'
    base = `${last}${(s.year ?? '').slice(0, 4)}`
  }
  let id = base
  for (let k = 2; taken.has(id); k++) id = `${base}${String.fromCharCode(96 + Math.min(26, k - 1))}${k > 27 ? k : ''}`
  taken.add(id)
  return id
}

function finish(partial: Partial<Source> & { key?: string }, taken: Set<string>): Source | null {
  const title = clip(partial.title ?? '', 500)
  if (!title && !partial.authors?.length) return null
  const type: SourceType = partial.type && (SOURCE_TYPES as readonly string[]).includes(partial.type) ? partial.type : 'other'
  const out: Source = { id: uniqueId(partial.key ?? '', taken, partial), type, authors: (partial.authors ?? []).map(normalizeName).filter(Boolean).slice(0, 100), title }
  for (const k of ['container', 'publisher', 'place', 'year', 'volume', 'issue', 'pages', 'edition', 'url', 'doi', 'isbn', 'accessed', 'note'] as const) {
    const v = partial[k]
    if (typeof v === 'string' && v.trim()) out[k] = clip(v, k === 'note' ? 1000 : 300)
  }
  if (partial.editors?.length) out.editors = partial.editors.map(normalizeName).filter(Boolean).slice(0, 50)
  if (out.doi) out.doi = out.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
  if (out.pages) out.pages = out.pages.replace(/\s*-{1,2}\s*|–/g, '-')
  return out
}

// --- BibTeX -------------------------------------------------------------------------

const TEX_ACCENTS: Record<string, Record<string, string>> = {
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ć', n: 'ń', s: 'ś', z: 'ź', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
  '~': { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  c: { c: 'ç', C: 'Ç', s: 'ş' },
}

/** LaTeX courant → texte : accents, tirets, accolades. */
export function texToText(s: string): string {
  return s
    .replace(/\\([`'^"~])\{?\\?([A-Za-z])\}?/g, (_m, acc: string, ch: string) => TEX_ACCENTS[acc]?.[ch] ?? ch)
    .replace(/\\c\{?([cCs])\}?/g, (_m, ch: string) => TEX_ACCENTS.c[ch] ?? ch)
    .replace(/\\(oe|OE|ae|AE|ss|o|O|l|L|aa|AA)\b\{?\}?/g, (_m, w: string) => ({ oe: 'œ', OE: 'Œ', ae: 'æ', AE: 'Æ', ss: 'ß', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', aa: 'å', AA: 'Å' })[w] ?? w)
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/\\_/g, '_')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/\\(textit|emph|textbf|textsc|mathrm)\{([^{}]*)\}/g, '$2')
    .replace(/[{}]/g, '')
    .replace(/~/g, ' ')
}

const BIB_TYPES: Record<string, SourceType> = {
  article: 'article', book: 'book', booklet: 'book', inbook: 'chapter', incollection: 'chapter', inproceedings: 'conference', conference: 'conference', proceedings: 'book',
  phdthesis: 'thesis', mastersthesis: 'thesis', thesis: 'thesis', techreport: 'report', report: 'report', online: 'website', electronic: 'website', www: 'website', webpage: 'website', movie: 'film', video: 'film', misc: 'other', unpublished: 'other', manual: 'report',
}

/** Valeur d'un champ BibTeX à partir de `i` : {…} imbriquées, "…", nombre ou macro. Rend la valeur et la suite. */
function bibValue(s: string, i: number, strings: Map<string, string>): [string, number] {
  let out = ''
  for (;;) {
    while (/\s/.test(s[i] ?? '')) i++
    if (s[i] === '{') {
      let depth = 0
      const start = i
      for (; i < s.length; i++) {
        if (s[i] === '\\') i++
        else if (s[i] === '{') depth++
        else if (s[i] === '}' && --depth === 0) break
      }
      out += s.slice(start + 1, i)
      i++
    } else if (s[i] === '"') {
      const start = ++i
      let depth = 0
      for (; i < s.length && !(s[i] === '"' && depth === 0); i++) {
        if (s[i] === '{') depth++
        else if (s[i] === '}') depth--
      }
      out += s.slice(start, i)
      i++
    } else {
      const m = /^[\w:.-]+/.exec(s.slice(i))
      if (!m) break
      out += strings.get(m[0].toLowerCase()) ?? m[0]
      i += m[0].length
    }
    while (/\s/.test(s[i] ?? '')) i++
    if (s[i] === '#') {
      i++
      continue
    }
    return [out, i]
  }
  return [out, i]
}

export function parseBibtex(text: string, taken = new Set<string>()): Source[] {
  const out: Source[] = []
  const strings = new Map<string, string>(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((m, i) => [m, String(i + 1)]))
  const re = /@(\w+)\s*[{(]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) && out.length < IMPORT_LIMITS.entries) {
    const kind = m[1].toLowerCase()
    let i = re.lastIndex
    if (kind === 'comment' || kind === 'preamble') continue
    if (kind === 'string') {
      const k = /^\s*([\w:.-]+)\s*=/.exec(text.slice(i))
      if (k) {
        const [v] = bibValue(text, i + k[0].length, strings)
        strings.set(k[1].toLowerCase(), v)
      }
      continue
    }
    const keyM = /^\s*([^,\s]*)\s*,/.exec(text.slice(i))
    if (!keyM) continue
    i += keyM[0].length
    const f: Record<string, string> = {}
    for (let guard = 0; guard < 200; guard++) {
      while (/[\s,]/.test(text[i] ?? '')) i++
      if (text[i] === '}' || text[i] === ')' || i >= text.length) break
      const name = /^([\w-]+)\s*=/.exec(text.slice(i))
      if (!name) break
      const [v, next] = bibValue(text, i + name[0].length, strings)
      f[name[1].toLowerCase()] = texToText(v)
      i = next
    }
    re.lastIndex = i
    const names = (v?: string) => (v ? v.split(/\s+and\s+/i).map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== 'others') : [])
    const pages = f.pages?.replace(/-+/g, '-')
    const src = finish(
      {
        key: keyM[1],
        type: BIB_TYPES[kind] ?? (f.url ? 'website' : 'other'),
        authors: names(f.author),
        editors: names(f.editor),
        title: f.title ?? '',
        container: f.journal ?? f.journaltitle ?? f.booktitle ?? f.series,
        publisher: f.publisher ?? f.institution ?? f.school ?? f.organization,
        place: f.address ?? f.location,
        year: f.year ?? f.date?.slice(0, 10),
        volume: f.volume,
        issue: f.number ?? f.issue,
        pages,
        edition: f.edition,
        url: f.url,
        doi: f.doi,
        isbn: f.isbn,
        accessed: f.urldate,
        note: f.note,
      },
      taken,
    )
    if (src) out.push(src)
  }
  return out
}

const TYPE_TO_BIB: Record<SourceType, string> = { book: 'book', article: 'article', chapter: 'incollection', website: 'online', report: 'techreport', thesis: 'phdthesis', conference: 'inproceedings', film: 'misc', interview: 'misc', other: 'misc' }

const bibEscape = (s: string) => s.replace(/([&%_#])/g, '\\$1').replace(/[{}]/g, '')

export function toBibtex(sources: Source[]): string {
  return (
    sources
      .map((s) => {
        const f: [string, string | undefined][] = [
          ['author', s.authors.map((a) => (a.includes(',') ? a : `{${a}}`)).join(' and ')],
          ['editor', s.editors?.join(' and ')],
          ['title', s.title],
          [s.type === 'article' ? 'journal' : 'booktitle', s.container],
          [s.type === 'thesis' ? 'school' : s.type === 'report' ? 'institution' : 'publisher', s.publisher],
          ['address', s.place],
          ['year', s.year],
          ['volume', s.volume],
          ['number', s.issue],
          ['pages', s.pages?.replace(/-/g, '--')],
          ['edition', s.edition],
          ['url', s.url],
          ['doi', s.doi],
          ['isbn', s.isbn],
          ['urldate', s.accessed?.slice(0, 10)],
          ['note', s.note],
        ]
        const body = f.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${k === 'url' || k === 'doi' ? v!.replace(/[{}]/g, '') : bibEscape(v!)}}`)
        return `@${TYPE_TO_BIB[s.type]}{${s.id},\n${body.join(',\n')}\n}`
      })
      .join('\n\n') + '\n'
  )
}

// --- RIS ----------------------------------------------------------------------------

const RIS_TYPES: Record<string, SourceType> = { JOUR: 'article', JFULL: 'article', MGZN: 'article', NEWS: 'article', EJOUR: 'article', BOOK: 'book', EBOOK: 'book', CHAP: 'chapter', ECHAP: 'chapter', CONF: 'conference', CPAPER: 'conference', THES: 'thesis', RPRT: 'report', ELEC: 'website', WEB: 'website', BLOG: 'website', VIDEO: 'film', MPCT: 'film', PCOMM: 'interview', GEN: 'other' }

export function parseRis(text: string, taken = new Set<string>()): Source[] {
  const out: Source[] = []
  let cur: Record<string, string[]> | null = null
  const flush = () => {
    if (!cur || out.length >= IMPORT_LIMITS.entries) return
    const g = (...keys: string[]) => keys.map((k) => cur![k]?.[0]).find(Boolean)
    const sp = g('SP')
    const ep = g('EP')
    const src = finish(
      {
        key: g('ID'),
        type: RIS_TYPES[g('TY') ?? ''] ?? 'other',
        authors: [...(cur.AU ?? []), ...(cur.A1 ?? [])],
        editors: [...(cur.ED ?? []), ...(cur.A2 ?? [])].filter(() => g('TY') !== 'JOUR'),
        title: g('TI', 'T1', 'CT') ?? '',
        container: g('T2', 'JO', 'JF', 'JA', 'BT', 'SECONDARY'),
        publisher: g('PB'),
        place: g('CY', 'PP'),
        year: (g('PY', 'Y1', 'DA') ?? '').replace(/\/+$/, '').split('/')[0],
        volume: g('VL'),
        issue: g('IS', 'CP'),
        pages: sp ? (ep ? `${sp}-${ep}` : sp) : undefined,
        edition: g('ET'),
        url: g('UR', 'L2'),
        doi: g('DO'),
        isbn: g('SN'),
        accessed: g('Y2'),
        note: g('N1'),
      },
      taken,
    )
    if (src) out.push(src)
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])  -(?: (.*))?$/.exec(line)
    if (!m) continue
    const [, tag, value = ''] = m
    if (tag === 'TY') {
      cur = { TY: [value.trim()] }
      continue
    }
    if (tag === 'ER') {
      flush()
      cur = null
      continue
    }
    if (cur) (cur[tag] ??= []).push(value.trim())
  }
  if (cur) flush()
  return out
}

const TYPE_TO_RIS: Record<SourceType, string> = { book: 'BOOK', article: 'JOUR', chapter: 'CHAP', website: 'ELEC', report: 'RPRT', thesis: 'THES', conference: 'CONF', film: 'VIDEO', interview: 'PCOMM', other: 'GEN' }

export function toRis(sources: Source[]): string {
  const lines: string[] = []
  for (const s of sources) {
    const put = (tag: string, v?: string) => v && lines.push(`${tag}  - ${v.replace(/\s+/g, ' ')}`)
    put('TY', TYPE_TO_RIS[s.type])
    put('ID', s.id)
    for (const a of s.authors) put('AU', a)
    for (const e of s.editors ?? []) put('ED', e)
    put('TI', s.title)
    put('T2', s.container)
    put('PB', s.publisher)
    put('CY', s.place)
    put('PY', s.year)
    put('VL', s.volume)
    put('IS', s.issue)
    const [sp, ep] = (s.pages ?? '').split('-')
    put('SP', sp)
    put('EP', ep)
    put('ET', s.edition)
    put('UR', s.url)
    put('DO', s.doi)
    put('SN', s.isbn)
    put('Y2', s.accessed?.slice(0, 10))
    put('N1', s.note)
    lines.push('ER  - ', '')
  }
  return lines.join('\r\n')
}

// --- CSL-JSON -----------------------------------------------------------------------

const CSL_TYPES: Record<string, SourceType> = { 'article-journal': 'article', 'article-magazine': 'article', 'article-newspaper': 'article', article: 'article', book: 'book', chapter: 'chapter', 'paper-conference': 'conference', webpage: 'website', 'post-weblog': 'website', post: 'website', report: 'report', thesis: 'thesis', motion_picture: 'film', broadcast: 'film', interview: 'interview' }
const TYPE_TO_CSL: Record<SourceType, string> = { book: 'book', article: 'article-journal', chapter: 'chapter', website: 'webpage', report: 'report', thesis: 'thesis', conference: 'paper-conference', film: 'motion_picture', interview: 'interview', other: 'document' }

type CslName = { family?: string; given?: string; literal?: string }
type CslDate = { 'date-parts'?: (number | string)[][]; raw?: string; literal?: string }

const cslName = (n: CslName) => (n.literal ? n.literal : [n.family, n.given].filter(Boolean).join(', '))
const cslDate = (d?: CslDate) => {
  const parts = d?.['date-parts']?.[0]
  if (parts?.length) return parts.map((p, i) => (i ? String(p).padStart(2, '0') : String(p))).join('-')
  return d?.raw ?? d?.literal ?? ''
}
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined)

export function parseCslJson(text: string, taken = new Set<string>()): Source[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  const items = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items) ? (data as { items: unknown[] }).items : [data]
  const out: Source[] = []
  for (const it of items.slice(0, IMPORT_LIMITS.entries)) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const names = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is CslName => !!n && typeof n === 'object').map(cslName) : [])
    const src = finish(
      {
        key: str(o['citation-key']) ?? str(o.id),
        type: CSL_TYPES[str(o.type) ?? ''] ?? 'other',
        authors: names(o.author),
        editors: names(o.editor),
        title: str(o.title) ?? '',
        container: str(o['container-title']),
        publisher: str(o.publisher),
        place: str(o['publisher-place']),
        year: cslDate(o.issued as CslDate).slice(0, 10),
        volume: str(o.volume),
        issue: str(o.issue),
        pages: str(o.page),
        edition: str(o.edition),
        url: str(o.URL),
        doi: str(o.DOI),
        isbn: str(o.ISBN),
        accessed: cslDate(o.accessed as CslDate),
        note: str(o.note),
      },
      taken,
    )
    if (src) out.push(src)
  }
  return out
}

export function toCslJson(sources: Source[]): string {
  const name = (a: string) => {
    const i = a.indexOf(',')
    return i < 0 ? { literal: a } : { family: a.slice(0, i).trim(), given: a.slice(i + 1).trim() }
  }
  const date = (s?: string) => {
    const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(s ?? '')
    return m ? { 'date-parts': [[m[1], m[2], m[3]].filter(Boolean).map(Number)] } : s ? { literal: s } : undefined
  }
  const items = sources.map((s) => {
    const o: Record<string, unknown> = { id: s.id, type: TYPE_TO_CSL[s.type], title: s.title }
    if (s.authors.length) o.author = s.authors.map(name)
    if (s.editors?.length) o.editor = s.editors.map(name)
    const map: [string, string | undefined][] = [['container-title', s.container], ['publisher', s.publisher], ['publisher-place', s.place], ['volume', s.volume], ['issue', s.issue], ['page', s.pages], ['edition', s.edition], ['URL', s.url], ['DOI', s.doi], ['ISBN', s.isbn], ['note', s.note]]
    for (const [k, v] of map) if (v) o[k] = v
    if (s.year) o.issued = date(s.year)
    if (s.accessed) o.accessed = date(s.accessed)
    return o
  })
  return JSON.stringify(items, null, 2) + '\n'
}

// --- détection ----------------------------------------------------------------------

export function detectFormat(text: string): SourceFormat | null {
  const t = text.trimStart()
  if (t.startsWith('[') || t.startsWith('{')) return 'csl'
  if (/^TY {2}-/m.test(t)) return 'ris'
  if (/@\w+\s*[{(]/.test(t)) return 'bibtex'
  return null
}

/** Lit un fichier de sources, quel que soit son format ; les identifiants déjà pris sont évités. */
export function parseSources(text: string, taken: Iterable<string> = []): { format: SourceFormat | null; sources: Source[] } {
  const format = detectFormat(text)
  const ids = new Set(taken)
  if (!format || text.length > IMPORT_LIMITS.file) return { format, sources: [] }
  const sources = format === 'csl' ? parseCslJson(text, ids) : format === 'ris' ? parseRis(text, ids) : parseBibtex(text, ids)
  return { format, sources }
}
