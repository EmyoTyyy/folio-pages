// Listes de destinataires (publipostage) : lecture d'un fichier CSV/TSV, JSON
// ou vCard (contacts), toujours bornée. Le résultat est rectangulaire : une
// valeur par colonne pour chaque destinataire.

import type { AddressField, MergeSource } from '../format/types'

export const SOURCE_LIMITS = { records: 10_000, fields: 60, cell: 2_000, fieldName: 80, bytes: 20_000_000 }

export interface ParsedSource {
  source: MergeSource
  /** Ce qui a été coupé (trop de lignes, de colonnes, cellules trop longues). */
  truncated: boolean
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)

/** Séparateur probable d'un CSV : celui qui revient le plus souvent dans la première ligne (hors guillemets). */
function detectDelimiter(text: string): string {
  const firstLine: string[] = []
  let inQuotes = false
  for (const ch of text.slice(0, 10_000)) {
    if (ch === '"') inQuotes = !inQuotes
    if (!inQuotes && (ch === '\n' || ch === '\r')) break
    if (!inQuotes) firstLine.push(ch)
  }
  let best = ','
  let bestCount = 0
  for (const d of [',', ';', '\t', '|']) {
    const c = firstLine.filter((x) => x === d).length
    if (c > bestCount) {
      best = d
      bestCount = c
    }
  }
  return best
}

/** CSV (RFC 4180, avec ; ou tabulation selon le fichier) : en-têtes sur la première ligne. */
export function parseCsv(input: string, name = ''): ParsedSource {
  const text = input.replace(/^﻿/, '')
  const d = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let truncated = false
  const pushCell = () => {
    if (row.length < SOURCE_LIMITS.fields) row.push(cell.length > SOURCE_LIMITS.cell ? ((truncated = true), clip(cell, SOURCE_LIMITS.cell)) : cell)
    else truncated = true
    cell = ''
  }
  const pushRow = () => {
    pushCell()
    if (row.some((c) => c.trim() !== '')) {
      if (rows.length <= SOURCE_LIMITS.records) rows.push(row)
      else truncated = true
    }
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += ch
    } else if (ch === '"' && cell === '') inQuotes = true
    else if (ch === d) pushCell()
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      pushRow()
    } else cell += ch
    if (rows.length > SOURCE_LIMITS.records) break
  }
  if (cell !== '' || row.length) pushRow()
  const header = rows.shift() ?? []
  return { source: rectangle(name, header, rows), truncated }
}

/** Colonnes nommées et uniques ; lignes de la même largeur. */
function rectangle(name: string, header: string[], rows: string[][]): MergeSource {
  const width = Math.min(SOURCE_LIMITS.fields, Math.max(header.length, ...rows.map((r) => r.length), 0))
  const seen = new Set<string>()
  const fields = Array.from({ length: width }, (_, i) => {
    let f = clip((header[i] ?? '').trim(), SOURCE_LIMITS.fieldName) || `Colonne ${i + 1}`
    const base = f
    let k = 2
    while (seen.has(f)) f = `${base} ${k++}`
    seen.add(f)
    return f
  })
  const records = rows.slice(0, SOURCE_LIMITS.records).map((r) => Array.from({ length: width }, (_, i) => clip((r[i] ?? '').trim(), SOURCE_LIMITS.cell)))
  return { name: clip(name, 200), fields, records }
}

/** JSON : un tableau d'objets (les clés font les colonnes), ou { fields, records }. */
export function parseJsonSource(input: string, name = ''): ParsedSource | null {
  let v: unknown
  try {
    v = JSON.parse(input)
  } catch {
    return null
  }
  const asText = (x: unknown) => (x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x))
  if (Array.isArray(v)) {
    const objects = v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
    const keys: string[] = []
    for (const o of objects.slice(0, SOURCE_LIMITS.records)) for (const k of Object.keys(o)) if (!keys.includes(k) && keys.length < SOURCE_LIMITS.fields) keys.push(k)
    const truncated = objects.length > SOURCE_LIMITS.records
    return { source: rectangle(name, keys, objects.slice(0, SOURCE_LIMITS.records).map((o) => keys.map((k) => asText(o[k])))), truncated }
  }
  if (v && typeof v === 'object' && Array.isArray((v as { fields?: unknown }).fields) && Array.isArray((v as { records?: unknown }).records)) {
    const o = v as { fields: unknown[]; records: unknown[] }
    const rows = o.records.filter(Array.isArray).map((r) => (r as unknown[]).map(asText))
    return { source: rectangle(name, o.fields.map(asText), rows), truncated: rows.length > SOURCE_LIMITS.records }
  }
  return null
}

/** vCard (.vcf, carnet d'adresses) : nom, société, adresse, courriel, téléphone. */
export function parseVcf(input: string, name = ''): ParsedSource {
  const unfolded = input.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '')
  const fields = ['Civilité', 'Prénom', 'Nom', 'Société', 'Adresse 1', 'Adresse 2', 'Ville', 'Région', 'Code postal', 'Pays', 'E-mail', 'Téléphone']
  const records: string[][] = []
  const unesc = (s: string) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()
  for (const card of unfolded.split(/BEGIN:VCARD/i).slice(1)) {
    if (records.length >= SOURCE_LIMITS.records) break
    const get = (prop: string) => {
      const m = new RegExp(`^${prop}(?:;[^:\\n]*)?:(.*)$`, 'im').exec(card)
      return m ? m[1] : ''
    }
    const n = get('N').split(';')
    const adr = get('ADR').split(';')
    const rec = [unesc(n[3] ?? ''), unesc(n[1] ?? ''), unesc(n[0] ?? ''), unesc(get('ORG').split(';')[0] ?? ''), unesc(adr[2] ?? ''), unesc(adr[1] ?? ''), unesc(adr[3] ?? ''), unesc(adr[4] ?? ''), unesc(adr[5] ?? ''), unesc(adr[6] ?? ''), unesc(get('EMAIL')), unesc(get('TEL'))]
    if (!rec[1] && !rec[2]) {
      const fn = unesc(get('FN')).split(/\s+/)
      rec[2] = fn.pop() ?? ''
      rec[1] = fn.join(' ')
    }
    records.push(rec.map((c) => clip(c, SOURCE_LIMITS.cell)))
  }
  return { source: { name: clip(name, 200), fields, records }, truncated: false }
}

/** Lit un fichier de destinataires selon son extension (ou son contenu). */
export function parseSourceFile(name: string, text: string): ParsedSource | null {
  if (text.length > SOURCE_LIMITS.bytes) return null
  const lower = name.toLowerCase()
  if (lower.endsWith('.vcf') || /^\s*BEGIN:VCARD/i.test(text)) return parseVcf(text, name)
  if (lower.endsWith('.json')) return parseJsonSource(text, name)
  const csv = parseCsv(text, name)
  return csv.source.fields.length ? csv : null
}

/** Colonnes d'une nouvelle liste tapée à la main. */
export const DEFAULT_FIELDS: Record<'fr' | 'en', string[]> = {
  fr: ['Civilité', 'Prénom', 'Nom', 'Société', 'Adresse 1', 'Adresse 2', 'Ville', 'Code postal', 'Pays', 'E-mail'],
  en: ['Title', 'First name', 'Last name', 'Company', 'Address 1', 'Address 2', 'City', 'Postal code', 'Country', 'E-mail'],
}

const SYNONYMS: Record<AddressField, string[]> = {
  title: ['civilite', 'titre', 'title', 'salutation', 'courtesytitle', 'prefix'],
  first: ['prenom', 'firstname', 'first', 'givenname', 'given', 'forename'],
  last: ['nom', 'lastname', 'last', 'surname', 'familyname', 'nomdefamille', 'name'],
  company: ['societe', 'entreprise', 'company', 'organisation', 'organization', 'org', 'raisonsociale'],
  address1: ['adresse', 'adresse1', 'address', 'address1', 'addressline1', 'street', 'rue', 'voie'],
  address2: ['adresse2', 'address2', 'addressline2', 'complement', 'complementdadresse'],
  city: ['ville', 'city', 'town', 'commune', 'localite'],
  state: ['region', 'state', 'province', 'departement', 'county'],
  postal: ['codepostal', 'cp', 'postal', 'postalcode', 'zip', 'zipcode', 'postcode'],
  country: ['pays', 'country', 'countryregion'],
  email: ['email', 'mail', 'courriel', 'adresseemail', 'emailaddress', 'adressemail'],
  phone: ['telephone', 'phone', 'tel', 'mobile', 'portable', 'phonenumber'],
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** Correspondance devinée des champs d'adresse d'après les noms de colonnes. */
export function guessMap(fields: string[]): Partial<Record<AddressField, string>> {
  const out: Partial<Record<AddressField, string>> = {}
  const used = new Set<string>()
  for (const [f, words] of Object.entries(SYNONYMS) as [AddressField, string[]][]) {
    const hit = fields.find((c) => !used.has(c) && words.includes(norm(c)))
    if (hit) {
      out[f] = hit
      used.add(hit)
    }
  }
  return out
}

/** La liste en CSV (pour l'exporter). */
export function toCsv(s: MergeSource): string {
  const q = (v: string) => (/[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return [s.fields, ...s.records].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n'
}
