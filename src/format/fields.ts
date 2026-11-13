// Champs ({{page}}, {{date:DD/MM/YYYY}}…) : noms acceptés, formats de date,
// et calcul de leur valeur à l'affichage.

import { FIELD_NAMES, type FieldName } from './types'

/** Noms acceptés à l'écriture, en français et en anglais. */
const ALIASES: Record<string, FieldName> = {
  titre: 'title',
  auteur: 'author',
  autrice: 'author',
  sujet: 'subject',
  organisation: 'organization',
  organisme: 'organization',
  motscles: 'keywords',
  'mots-cles': 'keywords',
  'mots-clés': 'keywords',
  motsclés: 'keywords',
  heure: 'time',
  creation: 'created',
  création: 'created',
  cree: 'created',
  créé: 'created',
  modification: 'modified',
  modifie: 'modified',
  modifié: 'modified',
  fichier: 'filename',
  nomfichier: 'filename',
  'nom-fichier': 'filename',
  file: 'filename',
  nbpages: 'pages',
  numpages: 'pages',
  'nombre-pages': 'pages',
  numpage: 'page',
}

export function resolveFieldName(raw: string): FieldName | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '')
  if ((FIELD_NAMES as readonly string[]).includes(s)) return s as FieldName
  return Object.prototype.hasOwnProperty.call(ALIASES, s) ? ALIASES[s] : null
}

/** Jetons de format en français (JJ/MM/AAAA) → jetons canoniques (DD/MM/YYYY). */
export function normalizeDateFormat(f: string): string {
  return f
    .slice(0, 60)
    .replace(/[\u0000-\u001f\u007f{}]/g, '')
    .replace(/jjjj/g, 'dddd')
    .replace(/jjj/g, 'ddd')
    // « AAAA » (année) mais pas « A » seul, qui est AM/PM
    .replace(/A{2,}/g, (m) => 'Y'.repeat(m.length))
    .replace(/J+/g, (m) => 'D'.repeat(m.length))
}

/** Lecture d'un champ écrit « {{nom}} » ou « {{nom:format}} ». */
export function parseFieldToken(inner: string): { name: FieldName; format: string } | null {
  const i = inner.indexOf(':')
  const name = resolveFieldName(i < 0 ? inner : inner.slice(0, i))
  if (!name) return null
  const format = i < 0 ? '' : normalizeDateFormat(inner.slice(i + 1).trim())
  return { name, format }
}

/** Écriture d'un champ en texte (Markdown, forme compacte). */
export const fieldToken = (name: FieldName, format: string): string => (format ? `{{${name}:${format}}}` : `{{${name}}}`)

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/**
 * Date mise en forme selon un motif : YYYY YY MMMM MMM MM M DD D dddd ddd HH H
 * hh h mm ss A. Le texte entre crochets [ ] est gardé tel quel.
 */
export function formatWithPattern(d: Date, pattern: string, locale: string): string {
  const month = (style: 'long' | 'short') => new Intl.DateTimeFormat(locale, { month: style }).format(d)
  const weekday = (style: 'long' | 'short') => new Intl.DateTimeFormat(locale, { weekday: style }).format(d)
  const h12 = d.getHours() % 12 || 12
  const tokens: Record<string, () => string> = {
    YYYY: () => String(d.getFullYear()),
    YY: () => pad(d.getFullYear() % 100),
    MMMM: () => month('long'),
    MMM: () => month('short'),
    MM: () => pad(d.getMonth() + 1),
    M: () => String(d.getMonth() + 1),
    dddd: () => weekday('long'),
    ddd: () => weekday('short'),
    DD: () => pad(d.getDate()),
    D: () => String(d.getDate()),
    HH: () => pad(d.getHours()),
    H: () => String(d.getHours()),
    hh: () => pad(h12),
    h: () => String(h12),
    mm: () => pad(d.getMinutes()),
    ss: () => pad(d.getSeconds()),
    A: () => (d.getHours() < 12 ? 'AM' : 'PM'),
  }
  return pattern.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|H|hh|h|mm|ss|A/g, (m, lit: string | undefined) =>
    lit !== undefined ? lit : tokens[m](),
  )
}

export interface FieldContext {
  title: string
  author: string
  subject: string
  organization: string
  keywords: string[]
  created: string
  modified: string
  filename: string
  page: number
  pages: number
  now: Date
  locale: string
  /** Écriture des numéros de page (romain, lettres…) ; décimal par défaut. */
  formatPage?: (n: number) => string
}

function formatDateValue(d: Date, format: string, ctx: FieldContext, time: boolean): string {
  if (Number.isNaN(d.getTime())) return ''
  if (format) return formatWithPattern(d, format, ctx.locale)
  try {
    return new Intl.DateTimeFormat(ctx.locale, time ? { timeStyle: 'short' } : { dateStyle: 'long' }).format(d)
  } catch {
    return time ? d.toTimeString().slice(0, 5) : d.toDateString()
  }
}

/** Valeur affichée d'un champ. */
export function fieldValue(name: FieldName, format: string, ctx: FieldContext): string {
  switch (name) {
    case 'title':
    case 'author':
    case 'subject':
    case 'organization':
    case 'filename':
      return ctx[name]
    case 'keywords':
      return ctx.keywords.join(', ')
    case 'date':
      return formatDateValue(ctx.now, format, ctx, false)
    case 'time':
      return formatDateValue(ctx.now, format, ctx, true)
    case 'created':
    case 'modified':
      return ctx[name] ? formatDateValue(new Date(ctx[name]), format, ctx, false) : ''
    case 'page':
      return ctx.formatPage ? ctx.formatPage(ctx.page) : String(ctx.page)
    case 'pages':
      return String(ctx.pages)
  }
}
