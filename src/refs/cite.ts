// Citations et bibliographie, sans DOM : une citation dans le texte et les
// entrées de la bibliographie, dans le style choisi pour le document.
//
// Styles : APA (7e éd.), MLA (9e éd.), Chicago (auteur-date, ou notes et
// bibliographie : la citation est une note de bas de page, complète la première
// fois, abrégée ensuite), Harvard, IEEE et Vancouver (numérotés, dans l'ordre
// de première citation) et ISO 690 (auteur-date). Ce
// sont des mises en forme fidèles à l'usage courant, pas des moteurs CSL
// complets : les cas rares (traducteurs, rééditions…) restent simples.

import type { CitationStyle, Source } from '../format/types'

/** Un morceau de texte, éventuellement en italique. */
export interface Piece {
  text: string
  italic?: true
  bold?: true
}

type Lang = 'fr' | 'en'

const WORDS: Record<Lang, Record<string, string>> = {
  en: { and: 'and', etal: 'et al.', nd: 'n.d.', p: 'p.', pp: 'pp.', ed: 'ed.', eds: 'eds.', edition: 'ed.', retrieved: 'Retrieved', from: 'from', accessed: 'Accessed', available: 'Available at:', online: '[Online]', in: 'In', vol: 'vol.', no: 'no.', thesis: 'Thesis', report: 'Report', film: 'Film', interview: 'Interview', missing: 'Source not found' },
  fr: { and: 'et', etal: 'et al.', nd: 's. d.', p: 'p.', pp: 'p.', ed: 'dir.', eds: 'dir.', edition: 'éd.', retrieved: 'Consulté le', from: 'sur', accessed: 'Consulté le', available: 'Disponible à l’adresse :', online: '[En ligne]', in: 'In', vol: 'vol.', no: 'n°', thesis: 'Thèse', report: 'Rapport', film: 'Film', interview: 'Entretien', missing: 'Source introuvable' },
}

interface Name {
  last: string
  first: string
  /** Un organisme (ou un nom sans virgule) : écrit tel quel. */
  literal: boolean
}

/** « Nom, Prénom » → nom et prénom ; sans virgule : un organisme, gardé tel quel. */
export function parseName(s: string): Name {
  const i = s.indexOf(',')
  if (i < 0) return { last: s.trim(), first: '', literal: true }
  return { last: s.slice(0, i).trim(), first: s.slice(i + 1).trim(), literal: false }
}

/** Initiales : « Jean-Paul Marie » → « J.-P. M. » */
export function initials(first: string, sep = ' '): string {
  return first
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      w
        .split('-')
        .map((p) => (p ? `${p[0].toUpperCase()}.` : ''))
        .join('-'),
    )
    .join(sep)
}

const yearOf = (s: Source): string => /^\d{4}/.exec(s.year ?? '')?.[0] ?? (s.year ?? '').trim()

/** Une liste lisible : « A, B et C ». */
function joinList(items: string[], and: string, serial = false): string {
  if (items.length <= 1) return items.join('')
  if (items.length === 2) return `${items[0]} ${and} ${items[1]}`
  return `${items.slice(0, -1).join(', ')}${serial ? ',' : ''} ${and} ${items[items.length - 1]}`
}

const end = (s: string) => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`)

export interface CiteContext {
  style: CitationStyle
  lang: Lang
  sources: Map<string, Source>
  /** IEEE : numéro de chaque source (ordre de première citation). */
  numbers: Map<string, number>
  /** Même auteur, même année : « 2020a », « 2020b ». */
  suffix: Map<string, string>
  /** Chicago (notes) : sources déjà citées (la note suivante est abrégée). */
  seen: Set<string>
}

/** Styles numérotés (dans l'ordre de première citation). */
export const isNumbered = (style: CitationStyle): boolean => style === 'ieee' || style === 'vancouver'

/** Italique dans le texte d'une citation (titres des notes Chicago) : entre ces deux caractères. */
export const IT_ON = '\u0001'
export const IT_OFF = '\u0002'
const ital = (s: string) => (s ? `${IT_ON}${s}${IT_OFF}` : '')

/** Le texte d'une citation en morceaux (italique ou non). */
export function citePieces(text: string): Piece[] {
  const out: Piece[] = []
  let italic = false
  for (const part of text.split(/([\u0001\u0002])/)) {
    if (part === IT_ON) italic = true
    else if (part === IT_OFF) italic = false
    else if (part) out.push(italic ? { text: part, italic: true } : { text: part })
  }
  return out
}

/** Le texte d'une citation, sans les marques d'italique. */
export const citePlain = (text: string): string => text.replace(/[\u0001\u0002]/g, '')

/**
 * Prépare les citations d'un document : `cited` est la liste des sources dans
 * l'ordre où elles sont citées (avec répétitions).
 */
export function citeContext(sources: Source[], cited: string[], style: CitationStyle, lang: string): CiteContext {
  const map = new Map(sources.map((s) => [s.id, s]))
  const numbers = new Map<string, number>()
  for (const id of cited) if (map.has(id) && !numbers.has(id)) numbers.set(id, numbers.size + 1)
  // Les sources jamais citées (bibliographie « toutes les sources ») viennent après.
  for (const s of sources) if (!numbers.has(s.id)) numbers.set(s.id, numbers.size + 1)
  const ctx: CiteContext = { style, lang: lang.startsWith('fr') ? 'fr' : 'en', sources: map, numbers, suffix: new Map(), seen: new Set() }
  // Lettres pour distinguer les sources d'un même auteur la même année.
  const groups = new Map<string, Source[]>()
  for (const s of sources) {
    const k = `${authorKey(s)}|${yearOf(s)}`
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  for (const list of groups.values()) {
    if (list.length < 2 || !yearOf(list[0])) continue
    list.sort((a, b) => a.title.localeCompare(b.title)).forEach((s, i) => ctx.suffix.set(s.id, String.fromCharCode(97 + (i % 26))))
  }
  return ctx
}

const authorKey = (s: Source) => s.authors.map((a) => parseName(a).last.toLowerCase()).join('|') || s.title.toLowerCase()

/** Noms courts des auteurs pour une citation dans le texte. */
function shortAuthors(s: Source, ctx: CiteContext, opts: { max: number; amp?: boolean; upper?: boolean }): string {
  const w = WORDS[ctx.lang]
  const names = s.authors.map((a) => {
    const n = parseName(a)
    return opts.upper && !n.literal ? n.last.toUpperCase() : n.last
  })
  if (!names.length) return s.title.length > 40 ? `${s.title.slice(0, 37)}…` : s.title
  if (names.length > opts.max) return `${names[0]} ${w.etal}`
  const and = opts.amp ? '&' : w.and
  return joinList(names, and)
}

const yearSuffix = (s: Source, ctx: CiteContext) => (yearOf(s) || WORDS[ctx.lang].nd) + (ctx.suffix.get(s.id) ?? '')

/** Une citation dans le texte : « (Darwin, 1859, p. 12) », « [3] »… */
export function citationText(ctx: CiteContext, ids: string[], locator = ''): string {
  const w = WORDS[ctx.lang]
  const list = ids.map((id) => ctx.sources.get(id)).filter((s): s is Source => !!s)
  if (!list.length) return `[${w.missing}]`
  const loc = locator.trim()
  const withP = (sep: string) => (loc ? `${sep}${/^\d/.test(loc) ? `${w.p} ${loc}` : loc}` : '')
  switch (ctx.style) {
    case 'ieee': {
      const nums = list.map((s) => ctx.numbers.get(s.id) ?? 0).filter(Boolean)
      return `[${nums.join(', ')}${list.length === 1 ? withP(', ') : ''}]`
    }
    case 'vancouver': {
      const nums = list.map((s) => ctx.numbers.get(s.id) ?? 0).filter(Boolean)
      return `(${compactNumbers(nums)}${list.length === 1 ? withP(', ') : ''})`
    }
    case 'chicago-notes': {
      // Note complète la première fois, abrégée ensuite ; la page sans « p. ».
      const page = loc.replace(/^p+\.\s*/, '')
      const notes = list.map((s) => {
        const full = !ctx.seen.has(s.id)
        ctx.seen.add(s.id)
        return full ? chicagoNote(s, ctx) : chicagoShort(s, ctx)
      })
      // Ponctuation à l'américaine : virgule et point à l'intérieur des guillemets.
      let text = notes.join('; ')
      if (page) text = /”$/.test(text) ? text.replace(/”$/, `,” ${page}`) : `${text}, ${page}`
      return /”$/.test(text) ? text.replace(/”$/, '.”') : `${text}.`
    }
    case 'mla':
      return `(${list.map((s) => `${shortAuthors(s, ctx, { max: 2 })}`).join('; ')}${loc ? ` ${loc.replace(/^p+\.\s*/, '')}` : ''})`
    case 'chicago':
      return `(${list.map((s) => `${shortAuthors(s, ctx, { max: 3 })} ${yearSuffix(s, ctx)}`).join('; ')}${loc ? `, ${loc.replace(/^p+\.\s*/, '')}` : ''})`
    case 'iso690':
      return `(${list.map((s) => `${shortAuthors(s, ctx, { max: 3, upper: true })}, ${yearSuffix(s, ctx)}`).join('; ')}${withP(', ')})`
    case 'harvard':
      return `(${list.map((s) => `${shortAuthors(s, ctx, { max: 3 })}, ${yearSuffix(s, ctx)}`).join('; ')}${withP(', ')})`
    case 'apa':
    default:
      return `(${list.map((s) => `${shortAuthors(s, ctx, { max: 2, amp: true })}, ${yearSuffix(s, ctx)}`).join('; ')}${withP(', ')})`
  }
}

/** « 1, 2, 3, 5 » → « 1–3, 5 ». */
function compactNumbers(nums: number[]): string {
  const sorted = [...new Set(nums)].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    out.push(j - i >= 2 ? `${sorted[i]}–${sorted[j]}` : sorted.slice(i, j + 1).join(', '))
    i = j
  }
  return out.join(', ')
}

/** Titre abrégé (notes Chicago) : jusqu'aux deux-points, quatre mots au plus, sans article initial. */
const SMALL = /^(of|the|a|an|and|in|on|for|to|de|du|des|la|le|les|l['’]|et|en|sur|un|une|pour)$/i

function shortTitle(title: string): string {
  const main = title.split(/[:.?!]/)[0].trim()
  // Sans article ni préposition au début (« On the Origin… » → « Origin… »).
  const words = main.split(/\s+/)
  while (words.length > 1 && SMALL.test(words[0])) words.shift()
  // Quatre mots au plus ; on s'arrête avant un petit mot qui suit déjà deux mots (« Molecular Structure »).
  const out: string[] = []
  for (const w of words) {
    if (out.length >= 4 || (out.length >= 2 && SMALL.test(w))) break
    out.push(w)
  }
  return out.join(' ')
}

/** Auteurs d'une note Chicago : « Prénom Nom », « A et B », « A et al. » au-delà de trois. */
function noteAuthors(s: Source, ctx: CiteContext): string {
  const w = WORDS[ctx.lang]
  const a = s.authors.map(fullFirstLast)
  if (a.length > 3) return `${a[0]} ${w.etal}`
  return joinList(a, w.and, a.length > 2)
}

/** Note Chicago complète : « Charles Darwin, *On the Origin of Species* (London: John Murray, 1859) ». */
function chicagoNote(s: Source, ctx: CiteContext): string {
  const w = WORDS[ctx.lang]
  const who = noteAuthors(s, ctx)
  const part = s.type === 'article' || s.type === 'chapter' || s.type === 'conference' || (s.type === 'website' && !!s.container)
  const pub = [s.place, s.publisher].filter(Boolean).join(ctx.lang === 'fr' ? ' : ' : ': ')
  const year = yearOf(s)
  let out = who ? `${who}, ` : ''
  if (part) {
    out += `“${s.title},” `
    if (s.type === 'chapter' && s.container) out += `${w.in} ${ital(s.container)}${pub || year ? ` (${[pub, year].filter(Boolean).join(', ')})` : ''}`
    else if (s.container) out += `${ital(s.container)}${s.volume ? ` ${s.volume}` : ''}${s.issue ? `, ${w.no} ${s.issue}` : ''}${year ? ` (${year})` : ''}`
  } else {
    out += ital(s.title)
    if (pub || year) out += ` (${[pub, year].filter(Boolean).join(', ')})`
  }
  return out.replace(/,\s*$/, '')
}

/** Note Chicago abrégée : « Darwin, *Origin of Species* ». */
function chicagoShort(s: Source, ctx: CiteContext): string {
  const w = WORDS[ctx.lang]
  const last = s.authors.map((a) => parseName(a).last)
  const who = last.length > 3 ? `${last[0]} ${w.etal}` : joinList(last, w.and)
  const part = s.type === 'article' || s.type === 'chapter' || s.type === 'conference' || (s.type === 'website' && !!s.container)
  const title = part ? `“${shortTitle(s.title)}”` : ital(shortTitle(s.title))
  return `${who ? `${who}, ` : ''}${title}`
}

// --- bibliographie ----------------------------------------------------------------

function apaName(a: string): string {
  const n = parseName(a)
  return n.literal ? n.last : `${n.last}, ${initials(n.first)}`.trim().replace(/,$/, '')
}

function fullFirstLast(a: string): string {
  const n = parseName(a)
  return n.literal ? n.last : `${n.first} ${n.last}`.trim()
}

function lastFirst(a: string): string {
  const n = parseName(a)
  return n.literal ? n.last : `${n.last}, ${n.first}`.replace(/,\s*$/, '')
}

function authorsFor(s: Source, ctx: CiteContext): string {
  const w = WORDS[ctx.lang]
  const a = s.authors
  if (!a.length) return ''
  switch (ctx.style) {
    case 'apa': {
      const names = a.slice(0, 20).map(apaName)
      return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`
    }
    case 'mla':
      if (a.length === 1) return lastFirst(a[0])
      if (a.length === 2) return `${lastFirst(a[0])}, ${w.and} ${fullFirstLast(a[1])}`
      return `${lastFirst(a[0])}, ${w.etal}`
    case 'vancouver': {
      // « Watson JD, Crick FH » : six auteurs, puis « et al. ».
      const names = a.map((x) => {
        const n = parseName(x)
        return n.literal ? n.last : `${n.last} ${initials(n.first, '').replace(/[.-]/g, '')}`.trim()
      })
      return names.length > 6 ? `${names.slice(0, 6).join(', ')}, ${w.etal}` : names.join(', ')
    }
    case 'chicago':
    case 'chicago-notes':
      // Le premier auteur est inversé : une virgule le sépare du suivant, même s'ils ne sont que deux.
      if (a.length === 2) return `${lastFirst(a[0])}, ${w.and} ${fullFirstLast(a[1])}`
      return joinList([lastFirst(a[0]), ...a.slice(1).map(fullFirstLast)], w.and, true)
    case 'harvard':
      return joinList(a.map((x) => apaName(x).replace(/\.\s+(?=[A-Z])/g, '.')), w.and)
    case 'ieee':
      return joinList(
        a.map((x) => {
          const n = parseName(x)
          return n.literal ? n.last : `${initials(n.first)} ${n.last}`.trim()
        }),
        w.and,
        a.length > 2,
      )
    case 'iso690':
      return a
        .map((x) => {
          const n = parseName(x)
          return n.literal ? n.last.toUpperCase() : `${n.last.toUpperCase()}, ${n.first}`.replace(/,\s*$/, '')
        })
        .join(', ')
  }
}

const doiUrl = (s: Source) => (s.doi ? `https://doi.org/${s.doi}` : (s.url ?? ''))

/** Une entrée de la bibliographie. */
export function bibliographyEntry(ctx: CiteContext, s: Source): Piece[] {
  const w = WORDS[ctx.lang]
  const out: Piece[] = []
  const t = (text: string) => text && out.push({ text })
  const it = (text: string) => text && out.push({ text, italic: true })
  const authors = authorsFor(s, ctx)
  const year = yearSuffix(s, ctx)
  const part = s.type === 'article' || s.type === 'chapter' || s.type === 'conference' || (s.type === 'website' && !!s.container)
  const volIssue = (fmt: 'apa' | 'mla' | 'chicago' | 'ieee') => {
    if (fmt === 'apa') return [s.volume ? s.volume : '', s.issue ? `(${s.issue})` : ''].join('')
    if (fmt === 'mla' || fmt === 'ieee') return [s.volume ? `${w.vol} ${s.volume}` : '', s.issue ? `${w.no} ${s.issue}` : ''].filter(Boolean).join(', ')
    return [s.volume ?? '', s.issue ? `(${s.issue})` : ''].join(' ').trim()
  }
  const pages = s.pages ? s.pages.replace(/-+/g, '–') : ''
  const pub = [s.place, s.publisher].filter(Boolean).join(': ')
  switch (ctx.style) {
    case 'apa': {
      t(authors ? `${end(authors)} ` : '')
      t(`(${year}). `)
      if (part) {
        t(`${end(s.title)} `)
        if (s.type === 'chapter' && s.container) {
          t(`${w.in} ${s.editors?.length ? `${joinList(s.editors.map(fullFirstLast), '&')} (${s.editors.length > 1 ? w.eds : w.ed}), ` : ''}`)
          it(s.container)
          t(`${pages ? ` (${w.pp} ${pages})` : ''}. `)
        } else if (s.container) {
          it(s.container)
          const vi = volIssue('apa')
          if (vi) {
            t(', ')
            it(s.volume ?? '')
            t(s.issue ? `(${s.issue})` : '')
          }
          t(`${pages ? `, ${pages}` : ''}. `)
        }
      } else {
        it(s.title)
        t(s.edition ? ` (${s.edition} ${w.edition})` : '')
        t('. ')
      }
      if (s.publisher && s.type !== 'article') t(`${end(s.publisher)} `)
      t(doiUrl(s))
      break
    }
    case 'mla': {
      t(authors ? `${end(authors)} ` : '')
      if (part) {
        t(`“${end(s.title)}” `)
        if (s.container) {
          it(s.container)
          t(', ')
        }
        t([volIssue('mla'), s.publisher && s.type !== 'article' ? s.publisher : '', s.year ?? '', pages ? `${w.pp} ${pages}` : ''].filter(Boolean).join(', '))
        t('. ')
      } else {
        it(end(s.title))
        t(` ${[s.publisher, s.year].filter(Boolean).join(', ')}${s.publisher || s.year ? '. ' : ''}`)
      }
      t(s.doi ? `https://doi.org/${s.doi}.` : s.url ? `${s.url}.` : '')
      if (s.accessed && s.type === 'website') t(` ${w.accessed} ${s.accessed.slice(0, 10)}.`)
      break
    }
    case 'chicago': {
      t(authors ? `${end(authors)} ` : '')
      t(`${year}. `)
      if (part) {
        t(`“${end(s.title)}” `)
        if (s.type === 'chapter' && s.container) {
          t(`${w.in} `)
          it(s.container)
          t(`${pages ? `, ${pages}` : ''}. ${pub ? `${end(pub)} ` : ''}`)
        } else if (s.container) {
          it(s.container)
          const vi = volIssue('chicago')
          t(`${vi ? ` ${vi}` : ''}${pages ? `: ${pages}` : ''}. `)
        }
      } else {
        it(end(s.title))
        t(pub ? ` ${end(pub)} ` : ' ')
      }
      t(s.doi ? `https://doi.org/${s.doi}.` : s.url ? `${s.url}.` : '')
      break
    }
    case 'chicago-notes': {
      // Bibliographie « notes » : comme l'auteur-date, l'année à la fin.
      t(authors ? `${end(authors)} ` : '')
      if (part) {
        t(`“${end(s.title)}” `)
        if (s.type === 'chapter' && s.container) {
          t(`${w.in} `)
          it(s.container)
          t(`${pages ? `, ${pages}` : ''}. ${[pub, yearOf(s)].filter(Boolean).join(', ')}${pub || yearOf(s) ? '. ' : ''}`)
        } else if (s.container) {
          it(s.container)
          t(`${s.volume ? ` ${s.volume}` : ''}${s.issue ? `, ${w.no} ${s.issue}` : ''}${yearOf(s) ? ` (${yearOf(s)})` : ''}${pages ? `: ${pages}` : ''}. `)
        }
      } else {
        it(end(s.title))
        t(` ${[pub, yearOf(s)].filter(Boolean).join(', ')}${pub || yearOf(s) ? '. ' : ''}`)
      }
      t(s.doi ? `https://doi.org/${s.doi}.` : s.url ? `${s.url}.` : '')
      break
    }
    case 'vancouver': {
      t(authors ? `${end(authors)} ` : '')
      if (part) {
        t(`${end(s.title)} `)
        if (s.type === 'chapter' && s.container) t(`${w.in}: ${end(s.container)} ${[pub, yearOf(s)].filter(Boolean).join('; ')}${pages ? `. p. ${pages}` : ''}. `)
        else if (s.container) t(`${end(s.container)} ${yearOf(s)}${s.volume ? `;${s.volume}` : ''}${s.issue ? `(${s.issue})` : ''}${pages ? `:${pages}` : ''}. `)
      } else {
        t(`${end(s.title)}${s.type === 'website' ? ' [Internet]' : ''} `)
        if (s.edition) t(`${s.edition} ${w.edition} `)
        t(`${[pub, yearOf(s)].filter(Boolean).join('; ')}${pub || yearOf(s) ? '. ' : ''}`)
      }
      if (s.doi) t(`doi:${s.doi}`)
      else if (s.url) t(`${ctx.lang === 'fr' ? 'Disponible sur' : 'Available from'}: ${s.url}`)
      break
    }
    case 'harvard': {
      t(authors ? `${authors} ` : '')
      t(`(${year}) `)
      if (part) {
        t(`‘${s.title}’, `)
        if (s.container) it(s.container)
        const vi = [s.volume ?? '', s.issue ? `(${s.issue})` : ''].join('')
        t(`${vi ? `, ${vi}` : ''}${pages ? `, ${w.pp} ${pages}` : ''}. `)
      } else {
        it(s.title)
        t(`. ${s.edition ? `${s.edition} ${w.edition} ` : ''}${pub ? `${end(pub)} ` : ''}`)
      }
      if (s.doi || s.url) t(`${w.available} ${doiUrl(s)}`)
      if (s.accessed) t(` (${w.accessed} ${s.accessed.slice(0, 10)})`)
      t(s.doi || s.url ? '.' : '')
      break
    }
    case 'ieee': {
      t(authors ? `${authors}, ` : '')
      if (part) {
        t(`“${s.title},” `)
        if (s.container) {
          t(s.type === 'chapter' || s.type === 'conference' ? `${w.in} ` : '')
          it(s.container)
          t(', ')
        }
        t([volIssue('ieee'), pages ? `${w.pp} ${pages}` : '', s.year ?? ''].filter(Boolean).join(', '))
        t(s.doi ? `, doi: ${s.doi}.` : '.')
      } else {
        it(s.title)
        t(`${s.type === 'website' ? ` ${w.online}` : ''}. `)
        t([pub, s.year].filter(Boolean).join(', '))
        t(s.year || pub ? '.' : '')
        if (s.url && !s.doi) t(` ${w.available} ${s.url}`)
      }
      break
    }
    case 'iso690': {
      t(authors ? `${end(authors)} ` : '')
      t(`${year}. `)
      if (part) {
        t(`${end(s.title)} `)
        if (s.container) {
          t(s.type === 'chapter' ? `${w.in} : ` : '')
          it(s.container)
          t('. ')
        }
        t([s.volume ? `${w.vol} ${s.volume}` : '', s.issue ? `${w.no} ${s.issue}` : '', pages ? `${w.p} ${pages}` : ''].filter(Boolean).join(', '))
        t(s.volume || s.issue || pages ? '. ' : '')
      } else {
        it(end(s.title))
        t(` ${s.edition ? `${s.edition} ${w.edition} ` : ''}${[s.place, s.publisher].filter(Boolean).join(' : ')}${s.place || s.publisher ? '. ' : ''}`)
      }
      if (s.isbn) t(`ISBN ${s.isbn}. `)
      if (s.doi) t(`DOI ${s.doi}. `)
      else if (s.url) t(`${w.available} ${s.url}${s.accessed ? ` (${w.accessed} ${s.accessed.slice(0, 10)})` : ''}. `)
      break
    }
  }
  // Espaces en double et espace finale.
  const pieces = out.filter((p) => p.text)
  if (pieces.length) pieces[pieces.length - 1] = { ...pieces[pieces.length - 1], text: pieces[pieces.length - 1].text.replace(/\s+$/, '') }
  return pieces.map((p) => ({ ...p, text: p.text.replace(/ {2,}/g, ' ') }))
}

/** Sources de la bibliographie, dans leur ordre : numéros (IEEE) ou alphabétique. */
export function bibliographyOrder(ctx: CiteContext, ids: string[]): Source[] {
  const list = [...new Set(ids)].map((id) => ctx.sources.get(id)).filter((s): s is Source => !!s)
  if (isNumbered(ctx.style)) return list.sort((a, b) => (ctx.numbers.get(a.id) ?? 1e9) - (ctx.numbers.get(b.id) ?? 1e9))
  const coll = new Intl.Collator(ctx.lang, { sensitivity: 'base', numeric: true })
  return list.sort((a, b) => coll.compare(authorKey(a), authorKey(b)) || coll.compare(yearSuffix(a, ctx), yearSuffix(b, ctx)) || coll.compare(a.title, b.title))
}

/** Préfixe d'une entrée numérotée (IEEE) : « [3] ». */
export const entryLabel = (ctx: CiteContext, s: Source): string => (ctx.style === 'ieee' ? `[${ctx.numbers.get(s.id) ?? '?'}]` : ctx.style === 'vancouver' ? `${ctx.numbers.get(s.id) ?? '?'}.` : '')

/** Texte brut d'une entrée (aperçu, tests). */
export const piecesText = (p: Piece[]): string => p.map((x) => x.text).join('')
