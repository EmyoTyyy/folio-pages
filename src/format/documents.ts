// Plusieurs documents dans un fichier : le premier document porte les autres
// (« documents »), chacun complet et indépendant, avec sa clé. Les liens
// « #clé:ancre » et les renvois { "doc": "clé" } vont d'un document à l'autre.
//
// Ici : les clés, le découpage du fichier en documents et l'inverse, les liens
// entre documents, et l'assemblage de tous les documents en un seul (export
// « tous les documents » : chacun commence une nouvelle page).

import { BOOKMARK_NAME, DOC_KEY, type Block, type FolioDoc, type StyleDef } from './types'

/** « #clé:ancre » : un lien vers un autre document du fichier (ancre vide : son début). */
export function parseDocLink(href: string): { doc: string; anchor: string } | null {
  const m = /^#([A-Za-z][A-Za-z0-9_]{0,31}):(.*)$/.exec(href)
  if (!m) return null
  let anchor = m[2]
  try {
    anchor = decodeURIComponent(anchor)
  } catch {
    /* ancre telle quelle */
  }
  return { doc: m[1], anchor }
}

export const docLink = (doc: string, anchor: string): string => `#${doc}:${anchor}`

/** L'ancre d'un titre : son texte sans accents, en minuscules, les mots séparés par des tirets. */
export function anchorSlug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Une clé libre, « doc1 », « doc2 »… */
export function freeKey(used: Iterable<string>): string {
  const taken = new Set(used)
  let i = 1
  while (taken.has(`doc${i}`)) i++
  return `doc${i}`
}

/** Chaque document a une clé valable et unique (les manquantes ou en double sont remplacées). */
export function ensureKeys(docs: FolioDoc[]): string[] {
  const seen = new Set<string>()
  const changed: string[] = []
  for (const d of docs) {
    if (d.key && DOC_KEY.test(d.key) && !seen.has(d.key)) {
      seen.add(d.key)
      continue
    }
    const key = freeKey([...seen, ...docs.map((x) => x.key ?? '')])
    if (d.key) changed.push(d.key)
    d.key = key
    seen.add(key)
  }
  return changed
}

/** Le fichier en documents : le premier (sans « documents »), puis les autres. */
export function splitFile(file: FolioDoc): FolioDoc[] {
  const { documents, ...first } = file
  return [first as FolioDoc, ...(documents ?? [])]
}

/** Les documents en un fichier : les autres dans le premier ; une clé à chacun s'il y en a plusieurs. */
export function joinFile(docs: FolioDoc[]): FolioDoc {
  const [first, ...rest] = docs
  if (!rest.length) {
    const { key: _k, documents: _d, ...alone } = first
    return alone as FolioDoc
  }
  const all = docs.map((d) => ({ ...d }))
  ensureKeys(all)
  for (const d of all) delete d.documents
  const [head, ...others] = all
  return { ...head, documents: others.map((d) => ({ ...d, id: head.id })) }
}

// --- parcours générique du JSON --------------------------------------------------

type Json = unknown

/** Copie profonde où chaque objet passe par `fix` (après ses enfants). */
function mapDeep(v: Json, fix: (o: Record<string, unknown>) => Record<string, unknown>): Json {
  if (Array.isArray(v)) return v.map((x) => mapDeep(x, fix))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = mapDeep(x, fix)
    return fix(out)
  }
  return v
}

/** Les signets d'un document (noms). */
export function bookmarksOf(doc: FolioDoc): Set<string> {
  const names = new Set<string>()
  mapDeep(doc.blocks, (o) => {
    if (o.type === 'bookmark' && typeof o.name === 'string') names.add(o.name)
    return o
  })
  return names
}

/** Nom de signet préfixé par la clé du document, toujours valable (40 caractères au plus). */
const prefixed = (key: string, name: string): string => {
  const v = `${key}_${name}`.slice(0, 40)
  return BOOKMARK_NAME.test(v) ? v : name
}

export interface CombineNote {
  /** Styles du même nom définis autrement dans un document suivant : celui du premier l'emporte. */
  styles: string[]
}

/**
 * Tous les documents en un seul, pour l'exporter ou l'imprimer d'un coup :
 * chacun commence une nouvelle page (saut de section, avec sa mise en page, ses
 * en-têtes et pieds de page, sa numérotation à partir de 1). Le thème et les
 * réglages du document sont ceux du premier ; styles, polices, sources et
 * termes sont réunis. Signets, commentaires et ressources sont renommés par
 * document ; les renvois et liens entre documents deviennent internes.
 */
export function combineDocuments(input: FolioDoc[]): { doc: FolioDoc; note: CombineNote } {
  const docs = input.map((d) => structuredClone(d))
  ensureKeys(docs)
  const marks = new Map(docs.map((d) => [d.key!, bookmarksOf(d)]))
  const first = docs[0]
  const note: CombineNote = { styles: [] }
  const blocks: Block[] = []
  const comments: FolioDoc['comments'] = []
  const assets: Record<string, string> = {}
  const styles: Record<string, StyleDef> = { ...first.styles }
  const fonts = [...first.fonts]
  const sources = [...(first.sources ?? [])]
  const terms = [...(first.terms ?? [])]
  const macros: string[] = first.math.macros ? [first.math.macros] : []

  docs.forEach((d, i) => {
    const key = d.key!
    const own = marks.get(key)!
    const linkFix = (href: string): string => {
      const other = parseDocLink(href)
      if (other) {
        if (!other.anchor) return href
        return marks.get(other.doc)?.has(other.anchor) ? `#${prefixed(other.doc, other.anchor)}` : `#${other.anchor}`
      }
      if (href.startsWith('#') && own.has(href.slice(1))) return `#${prefixed(key, href.slice(1))}`
      return href
    }
    const assetFix = (s: string): string => (i > 0 && s.startsWith('asset:') ? `asset:${key}_${s.slice(6)}` : s)
    const fix = (o: Record<string, unknown>): Record<string, unknown> => {
      if (o.type === 'bookmark' && typeof o.name === 'string') o.name = prefixed(key, o.name)
      if (o.type === 'xref' && typeof o.target === 'string') {
        const target = typeof o.doc === 'string' && o.doc ? o.doc : key
        o.target = prefixed(target, o.target)
        delete o.doc
        delete o.last
      }
      if (typeof o.link === 'string') o.link = linkFix(o.link)
      if (typeof o.href === 'string') o.href = linkFix(o.href)
      if (Array.isArray(o.comments) && o.comments.every((c) => typeof c === 'string')) o.comments = (o.comments as string[]).map((c) => `${key}_${c}`.slice(0, 64))
      for (const f of ['src', 'image']) if (typeof o[f] === 'string') o[f] = assetFix(o[f] as string)
      return o
    }
    const part = mapDeep(d.blocks, fix) as Block[]
    if (i > 0) {
      blocks.push({
        type: 'section',
        start: 'page',
        numberStart: d.page.numberStart,
        numberFormat: d.page.numberFormat,
        firstPage: d.page.firstPage,
        headers: mapDeep(d.headers, fix) as FolioDoc['headers'],
        footers: mapDeep(d.footers, fix) as FolioDoc['footers'],
        page: { size: d.page.size, width: d.page.width, height: d.page.height, orientation: d.page.orientation, margins: { ...d.page.margins } },
      } as Block)
    }
    blocks.push(...part)
    for (const c of d.comments) comments.push({ ...c, id: `${key}_${c.id}`.slice(0, 64) })
    for (const [id, data] of Object.entries(d.assets)) assets[i > 0 ? `${key}_${id}` : id] = data
    if (i > 0) {
      for (const [name, def] of Object.entries(d.styles)) {
        if (!(name in styles)) styles[name] = def
        else if (JSON.stringify(styles[name]) !== JSON.stringify(def)) note.styles.push(name)
      }
      for (const f of d.fonts) if (!fonts.some((x) => x.family === f.family && x.weight === f.weight && x.italic === f.italic)) fonts.push({ ...f, src: assetFix(f.src) })
      for (const s of d.sources ?? []) if (!sources.some((x) => x.id === s.id)) sources.push(s)
      for (const x of d.terms ?? []) if (!terms.some((y) => y.id === x.id)) terms.push(x)
      if (d.math.macros && !macros.includes(d.math.macros)) macros.push(d.math.macros)
    }
  })
  // Les en-têtes et pieds de page du premier document : ses signets et ses liens aussi.
  const key0 = first.key!
  const own0 = marks.get(key0)!
  const fix0 = (o: Record<string, unknown>) => {
    if (typeof o.link === 'string' && o.link.startsWith('#') && own0.has(o.link.slice(1))) o.link = `#${prefixed(key0, o.link.slice(1))}`
    return o
  }
  const { documents: _d, key: _k, ...rest } = first
  const doc: FolioDoc = {
    ...rest,
    headers: mapDeep(first.headers, fix0) as FolioDoc['headers'],
    footers: mapDeep(first.footers, fix0) as FolioDoc['footers'],
    math: { macros: macros.join('\n') },
    styles,
    fonts,
    ...(sources.length ? { sources } : {}),
    ...(terms.length ? { terms } : {}),
    blocks,
    comments,
    trackChanges: docs.some((d) => d.trackChanges),
    assets,
  }
  return { doc, note: { styles: [...new Set(note.styles)] } }
}
