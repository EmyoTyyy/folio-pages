// Mini-langage de description des données.
//
// Une seule table (spec.ts) sert à deux choses :
//   1. valider et borner un document à l'ouverture, de façon TOLÉRANTE : un
//      champ invalide est ignoré (et compté) au lieu de bloquer l'ouverture ;
//   2. générer le JSON Schema (draft 2020-12) publié pour les IA.
// Les deux ne peuvent donc pas diverger.

export type IssueKind = 'ignored' | 'warning'

export type IssueCode =
  | 'unknown-field'
  | 'wrong-type'
  | 'invalid-value'
  | 'missing-field'
  | 'too-many-items'
  | 'too-deep'
  | 'too-large'
  | 'unknown-block-type'
  | 'unsafe-link'
  | 'empty-run'
  | 'coerced'
  | 'clamped'
  | 'truncated'
  | 'block-converted'
  | 'level-adjusted'
  | 'several-sources'
  | 'markdown-ignored'
  | 'format-missing'
  | 'format-unknown'
  | 'version-newer'
  | 'id-minted'
  | 'cell-flattened'
  | 'note-flattened'
  | 'callout-flattened'
  | 'term-duplicate'
  | 'note-misplaced'
  | 'comment-unknown'
  | 'comment-duplicate'
  | 'comment-misplaced'
  | 'json-repaired'
  | 'unsafe-image'
  | 'unsafe-attachment'
  | 'asset-missing'
  | 'style-unknown'
  | 'import-loss'
  | 'math-empty'
  | 'chart-empty'
  | 'math-invalid'
  | 'source-unknown'
  | 'source-duplicate'
  | 'bookmark-duplicate'

export interface Issue {
  kind: IssueKind
  code: IssueCode
  /** Chemin JSON du champ concerné, par exemple « blocks[3].level ». */
  path: string
  /** Précision lisible : nom du champ, valeur attendue… */
  detail?: string
}

/** Au-delà, on compte encore les problèmes mais on n'en garde pas le détail. */
const MAX_KEPT_ISSUES = 500

export class Report {
  readonly issues: Issue[] = []
  ignored = 0
  warnings = 0

  ignore(path: string, code: IssueCode, detail?: string): void {
    this.ignored++
    this.keep({ kind: 'ignored', code, path, detail })
  }

  warn(path: string, code: IssueCode, detail?: string): void {
    this.warnings++
    this.keep({ kind: 'warning', code, path, detail })
  }

  private keep(issue: Issue): void {
    if (this.issues.length < MAX_KEPT_ISSUES) this.issues.push(issue)
  }
}

// --- descripteurs -----------------------------------------------------------

interface Common {
  /** Description reprise dans le JSON Schema. */
  doc?: string
  /** null est une valeur acceptée, gardée telle quelle (une valeur manquante d'un graphique). */
  nullable?: boolean
}

export interface StringDesc extends Common {
  k: 'string'
  max: number
  def?: string
  pattern?: RegExp
  /** Contrôle supplémentaire ; false = valeur ignorée. */
  test?: (s: string) => boolean
  /** Code signalé quand `pattern` ou `test` refuse la valeur. */
  refusal?: IssueCode
  /** Format JSON Schema (« date-time », « uri »…), purement indicatif. */
  format?: string
}

export interface IntDesc extends Common {
  k: 'int'
  min: number
  max: number
  def?: number
  /** Hors bornes : ignoré plutôt que ramené dans les bornes (un indice, par exemple). */
  strict?: boolean
}

/** Nombre décimal, arrondi au pas `step` (0,5 pour une taille en points…). */
export interface NumDesc extends Common {
  k: 'num'
  min: number
  max: number
  def?: number
  step?: number
}

export interface BoolDesc extends Common {
  k: 'bool'
  def?: boolean
}

export interface EnumDesc extends Common {
  k: 'enum'
  values: readonly string[]
  def?: string
  /** Variantes acceptées à la lecture, ramenées à une valeur canonique. */
  aliases?: Record<string, string>
}

export interface ArrayDesc extends Common {
  k: 'array'
  of: Desc
  max: number
  /** Une chaîne à la place du tableau : la découper (mots-clés « a, b »). */
  fromString?: (s: string) => unknown[]
}

/** Objet à clés libres (styles, ressources) : chaque clé suit `key`, chaque valeur `of`. */
export interface MapDesc extends Common {
  k: 'map'
  key: RegExp
  of: Desc
  max: number
}

export interface ObjectDesc extends Common {
  k: 'object'
  fields: Record<string, Desc>
  required?: string[]
}

export interface EitherDesc extends Common {
  k: 'either'
  options: Desc[]
}

export interface RefDesc extends Common {
  k: 'ref'
  name: string
}

export interface TagResolution {
  variant: string
  /** Champs implicites apportés par l'alias (« h2 » apporte level: 2). */
  patch?: Record<string, unknown>
}

export interface TaggedDesc extends Common {
  k: 'tagged'
  tag: string
  variants: Record<string, ObjectDesc>
  /** Variante utilisée quand le champ `tag` est absent. */
  fallback: string
  /** Alias tolérés pour la valeur du tag. */
  resolve?: (tag: string) => TagResolution | null
  /** Variante de repli pour un type inconnu qui porte du texte (null = bloc ignoré). */
  salvage?: (value: Record<string, unknown>) => string | null
}

export type Desc =
  | StringDesc
  | IntDesc
  | NumDesc
  | BoolDesc
  | EnumDesc
  | ArrayDesc
  | MapDesc
  | ObjectDesc
  | EitherDesc
  | RefDesc
  | TaggedDesc

type Opt<T> = Omit<T, 'k'>

export const str = (o: Opt<StringDesc>): StringDesc => ({ k: 'string', ...o })
export const int = (o: Opt<IntDesc>): IntDesc => ({ k: 'int', ...o })
export const num = (o: Opt<NumDesc>): NumDesc => ({ k: 'num', ...o })
export const map = (key: RegExp, of: Desc, o: Omit<Opt<MapDesc>, 'key' | 'of'>): MapDesc => ({ k: 'map', key, of, ...o })
export const bool = (o: Opt<BoolDesc> = {}): BoolDesc => ({ k: 'bool', ...o })
export const enumOf = (values: readonly string[], o: Omit<Opt<EnumDesc>, 'values'> = {}): EnumDesc => ({
  k: 'enum',
  values,
  ...o,
})
export const arr = (of: Desc, o: Omit<Opt<ArrayDesc>, 'of'>): ArrayDesc => ({ k: 'array', of, ...o })
export const obj = (fields: Record<string, Desc>, o: Omit<Opt<ObjectDesc>, 'fields'> = {}): ObjectDesc => ({
  k: 'object',
  fields,
  ...o,
})
export const either = (options: Desc[], o: Common = {}): EitherDesc => ({ k: 'either', options, ...o })
export const ref = (name: string): RefDesc => ({ k: 'ref', name })
export const tagged = (o: Opt<TaggedDesc>): TaggedDesc => ({ k: 'tagged', ...o })

// --- validation -------------------------------------------------------------

export interface Limits {
  /** Profondeur d'imbrication maximale (citations dans des citations…). */
  maxDepth: number
  /** Nombre total maximal d'objets dans le document. */
  maxNodes: number
}

export interface Ctx {
  report: Report
  defs: Record<string, Desc>
  limits: Limits
  depth: number
  nodes: number
  /** Dépassement de taille déjà signalé : on ne le répète pas. */
  tooLarge: boolean
}

export const DROP: unique symbol = Symbol('drop')

/** Chemin d'origine d'un objet validé, pour des messages exacts même après un élément ignoré. */
const PATH: unique symbol = Symbol('path')
export const pathOf = (o: unknown, fallback: string): string =>
  (isPlainObject(o) && typeof (o as { [PATH]?: string })[PATH] === 'string' ? (o as { [PATH]: string })[PATH] : fallback)
export type Checked = unknown | typeof DROP

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const describeType = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v

const join = (path: string, key: string) => (path ? `${path}.${key}` : key)

export function check(d: Desc, v: unknown, path: string, ctx: Ctx): Checked {
  if (v === null && d.nullable) return null
  switch (d.k) {
    case 'string':
      return checkString(d, v, path, ctx)
    case 'int':
      return checkInt(d, v, path, ctx)
    case 'num':
      return checkNum(d, v, path, ctx)
    case 'map':
      return checkMap(d, v, path, ctx)
    case 'bool':
      return checkBool(d, v, path, ctx)
    case 'enum':
      return checkEnum(d, v, path, ctx)
    case 'array':
      return checkArray(d, v, path, ctx)
    case 'object':
      return checkObject(d, v, path, ctx)
    case 'either':
      return checkEither(d, v, path, ctx)
    case 'ref':
      return checkRef(d, v, path, ctx)
    case 'tagged':
      return checkTagged(d, v, path, ctx)
  }
}

function checkString(d: StringDesc, v: unknown, path: string, ctx: Ctx): Checked {
  let s: string
  if (typeof v === 'string') s = v
  else if (typeof v === 'number' && Number.isFinite(v)) {
    s = String(v)
    ctx.report.warn(path, 'coerced', 'string')
  } else if (typeof v === 'boolean') {
    s = String(v)
    ctx.report.warn(path, 'coerced', 'string')
  } else {
    ctx.report.ignore(path, 'wrong-type', `string ← ${describeType(v)}`)
    return DROP
  }
  if (s.length > d.max) {
    s = s.slice(0, d.max)
    ctx.report.warn(path, 'truncated', String(d.max))
  }
  if ((d.pattern && !d.pattern.test(s)) || (d.test && !d.test(s))) {
    ctx.report.ignore(path, d.refusal ?? 'invalid-value', s.slice(0, 80))
    return DROP
  }
  return s
}

const NUMERIC = /^\s*-?\d+(\.\d+)?\s*$/

function checkInt(d: IntDesc, v: unknown, path: string, ctx: Ctx): Checked {
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string' && NUMERIC.test(v)) {
    n = Number(v)
    ctx.report.warn(path, 'coerced', 'integer')
  } else {
    ctx.report.ignore(path, 'wrong-type', `integer ← ${describeType(v)}`)
    return DROP
  }
  if (!Number.isFinite(n)) {
    ctx.report.ignore(path, 'invalid-value', String(n))
    return DROP
  }
  if (!Number.isInteger(n)) {
    n = Math.round(n)
    ctx.report.warn(path, 'coerced', 'integer')
  }
  if (d.strict && (n < d.min || n > d.max)) {
    ctx.report.ignore(path, 'invalid-value', String(n))
    return DROP
  }
  if (n < d.min || n > d.max) {
    const clamped = Math.min(d.max, Math.max(d.min, n))
    ctx.report.warn(path, 'clamped', `${n} → ${clamped}`)
    n = clamped
  }
  return n
}

function checkNum(d: NumDesc, v: unknown, path: string, ctx: Ctx): Checked {
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string' && NUMERIC.test(v)) {
    n = Number(v)
    ctx.report.warn(path, 'coerced', 'number')
  } else {
    ctx.report.ignore(path, 'wrong-type', `number ← ${describeType(v)}`)
    return DROP
  }
  if (!Number.isFinite(n)) {
    ctx.report.ignore(path, 'invalid-value', String(n))
    return DROP
  }
  if (n < d.min || n > d.max) {
    const clamped = Math.min(d.max, Math.max(d.min, n))
    ctx.report.warn(path, 'clamped', `${n} → ${clamped}`)
    n = clamped
  }
  if (d.step) {
    // Arrondi sans bruit de virgule flottante (0,1 + 0,2…), sans avertissement.
    const r = Math.round(n / d.step) * d.step
    n = Number(r.toFixed(6))
    if (n < d.min) n = d.min
    if (n > d.max) n = d.max
  }
  return n
}

/** Clés réservées de JavaScript : jamais reprises, même si elles suivent le motif. */
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString', 'valueOf'])

function checkMap(d: MapDesc, v: unknown, path: string, ctx: Ctx): Checked {
  if (!isPlainObject(v)) {
    ctx.report.ignore(path, 'wrong-type', `object ← ${describeType(v)}`)
    return DROP
  }
  if (!countNode(path, ctx)) return DROP
  const out: Record<string, unknown> = {}
  const keys = Object.keys(v)
  let kept = 0
  for (const key of keys) {
    if (!d.key.test(key) || RESERVED_KEYS.has(key)) {
      ctx.report.ignore(join(path, key), 'invalid-value', key.slice(0, 60))
      continue
    }
    if (kept >= d.max) {
      ctx.report.ignore(path, 'too-many-items', String(keys.length - d.max))
      break
    }
    const r = check(d.of, v[key], join(path, key), ctx)
    if (r !== DROP) {
      out[key] = r
      kept++
    }
  }
  return out
}

function checkBool(_d: BoolDesc, v: unknown, path: string, ctx: Ctx): Checked {
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === 1) {
    ctx.report.warn(path, 'coerced', 'boolean')
    return true
  }
  if (v === 'false' || v === 0) {
    ctx.report.warn(path, 'coerced', 'boolean')
    return false
  }
  ctx.report.ignore(path, 'wrong-type', `boolean ← ${describeType(v)}`)
  return DROP
}

function checkEnum(d: EnumDesc, v: unknown, path: string, ctx: Ctx): Checked {
  if (typeof v !== 'string') {
    ctx.report.ignore(path, 'wrong-type', `${d.values.join('|')} ← ${describeType(v)}`)
    return DROP
  }
  if (d.values.includes(v)) return v
  const key = v.trim().toLowerCase()
  const found = d.values.find((x) => x.toLowerCase() === key) ?? (d.aliases && hasOwn(d.aliases, key) ? d.aliases[key] : undefined)
  if (found !== undefined) {
    ctx.report.warn(path, 'coerced', `${v} → ${found}`)
    return found
  }
  ctx.report.ignore(path, 'invalid-value', `${v.slice(0, 40)} ∉ ${d.values.join('|')}`)
  return DROP
}

function checkArray(d: ArrayDesc, v: unknown, path: string, ctx: Ctx): Checked {
  let list: unknown[]
  if (Array.isArray(v)) list = v
  else if (typeof v === 'string' && d.fromString) {
    list = d.fromString(v)
    ctx.report.warn(path, 'coerced', 'array')
  } else {
    ctx.report.ignore(path, 'wrong-type', `array ← ${describeType(v)}`)
    return DROP
  }
  const out: unknown[] = []
  const n = Math.min(list.length, d.max)
  for (let i = 0; i < n; i++) {
    const r = check(d.of, list[i], `${path}[${i}]`, ctx)
    if (r !== DROP) out.push(r)
  }
  if (list.length > d.max) ctx.report.ignore(path, 'too-many-items', `${list.length - d.max}`)
  return out
}

/** Compte un objet de plus ; au-delà de la limite, le reste du document est ignoré. */
function countNode(path: string, ctx: Ctx): boolean {
  ctx.nodes++
  if (ctx.nodes <= ctx.limits.maxNodes) return true
  if (!ctx.tooLarge) {
    ctx.tooLarge = true
    ctx.report.ignore(path, 'too-large', String(ctx.limits.maxNodes))
  }
  return false
}

function checkObject(d: ObjectDesc, v: unknown, path: string, ctx: Ctx): Checked {
  if (!isPlainObject(v)) {
    ctx.report.ignore(path, 'wrong-type', `object ← ${describeType(v)}`)
    return DROP
  }
  if (!countNode(path, ctx)) return DROP
  const out: Record<string, unknown> = {}
  Object.defineProperty(out, PATH, { value: path, enumerable: false })
  for (const key of Object.keys(v)) {
    if (!hasOwn(d.fields, key)) {
      ctx.report.ignore(join(path, key), 'unknown-field', key.slice(0, 60))
      continue
    }
    const r = check(d.fields[key], v[key], join(path, key), ctx)
    if (r !== DROP) out[key] = r
  }
  for (const key of d.required ?? []) {
    if (!hasOwn(out, key)) {
      ctx.report.ignore(path, 'missing-field', key)
      return DROP
    }
  }
  for (const [key, f] of Object.entries(d.fields)) {
    if (hasOwn(out, key)) continue
    const def = defaultOf(f)
    if (def !== undefined) out[key] = def
  }
  return out
}

function defaultOf(d: Desc): unknown {
  switch (d.k) {
    case 'string':
    case 'int':
    case 'num':
    case 'bool':
    case 'enum':
      return d.def
    default:
      return undefined
  }
}

function kindMatches(d: Desc, v: unknown, defs: Record<string, Desc>): boolean {
  switch (d.k) {
    case 'string':
    case 'enum':
      return typeof v === 'string'
    case 'int':
    case 'num':
      return typeof v === 'number'
    case 'bool':
      return typeof v === 'boolean'
    case 'array':
      return Array.isArray(v)
    case 'object':
    case 'tagged':
    case 'map':
      return isPlainObject(v)
    case 'ref':
      return kindMatches(defs[d.name], v, defs)
    case 'either':
      return d.options.some((o) => kindMatches(o, v, defs))
  }
}

function checkEither(d: EitherDesc, v: unknown, path: string, ctx: Ctx): Checked {
  const exact = d.options.find((o) => kindMatches(o, v, ctx.defs))
  if (exact) return check(exact, v, path, ctx)
  // Un nombre ou un booléen là où un texte est accepté : on le convertit.
  const asString = d.options.find((o) => o.k === 'string')
  if (asString && (typeof v === 'number' || typeof v === 'boolean')) return check(asString, v, path, ctx)
  ctx.report.ignore(path, 'wrong-type', describeType(v))
  return DROP
}

function checkRef(d: RefDesc, v: unknown, path: string, ctx: Ctx): Checked {
  const target = ctx.defs[d.name]
  if (!target) throw new Error(`dsl: définition inconnue ${d.name}`)
  if (ctx.depth >= ctx.limits.maxDepth) {
    ctx.report.ignore(path, 'too-deep', String(ctx.limits.maxDepth))
    return DROP
  }
  ctx.depth++
  try {
    return check(target, v, path, ctx)
  } finally {
    ctx.depth--
  }
}

function checkTagged(d: TaggedDesc, v: unknown, path: string, ctx: Ctx): Checked {
  if (!isPlainObject(v)) {
    ctx.report.ignore(path, 'wrong-type', `object ← ${describeType(v)}`)
    return DROP
  }
  const raw = v[d.tag]
  let variant: string
  let patch: Record<string, unknown> | undefined
  if (raw === undefined) {
    variant = d.fallback
    // Sans type, mais dont les champs disent ce que c'est ({ items } : une liste, { tex } : une formule).
    const guess = d.salvage ? d.salvage(v) : null
    if (guess && guess !== d.fallback && hasOwn(d.variants, guess)) {
      variant = guess
      ctx.report.warn(join(path, d.tag), 'coerced', `→ ${guess}`)
    }
  } else if (typeof raw === 'string' && hasOwn(d.variants, raw)) {
    variant = raw
  } else {
    const res = typeof raw === 'string' && d.resolve ? d.resolve(raw) : null
    if (res && hasOwn(d.variants, res.variant)) {
      variant = res.variant
      patch = res.patch
      ctx.report.warn(join(path, d.tag), 'coerced', `${String(raw)} → ${variant}`)
    } else if (d.salvage && d.salvage(v) && hasOwn(d.variants, d.salvage(v) as string)) {
      // Type inconnu mais porteur de texte : on le garde sous la forme la plus proche.
      variant = d.salvage(v) as string
      ctx.report.warn(join(path, d.tag), 'block-converted', `${String(raw).slice(0, 40)} → ${variant}`)
    } else {
      ctx.report.ignore(path, 'unknown-block-type', String(raw).slice(0, 40))
      return DROP
    }
  }
  const rest: Record<string, unknown> = { ...patch }
  for (const key of Object.keys(v)) if (key !== d.tag) rest[key] = v[key]
  const out = check(d.variants[variant], rest, path, ctx)
  if (out === DROP) return DROP
  const res: Record<string, unknown> = { [d.tag]: variant, ...(out as Record<string, unknown>) }
  Object.defineProperty(res, PATH, { value: path, enumerable: false })
  return res
}

// --- JSON Schema ------------------------------------------------------------

type Json = Record<string, unknown>

export function toJsonSchema(d: Desc, defs: Record<string, Desc>, out: Record<string, Json>): Json {
  if (d.nullable) return { anyOf: [toJsonSchema({ ...d, nullable: false } as Desc, defs, out), { type: 'null' }] }
  const withDoc = (s: Json): Json => (d.doc ? { description: d.doc, ...s } : s)
  switch (d.k) {
    case 'string': {
      const s: Json = { type: 'string', maxLength: d.max }
      if (d.pattern) s.pattern = d.pattern.source
      if (d.format) s.format = d.format
      if (d.def !== undefined) s.default = d.def
      return withDoc(s)
    }
    case 'int': {
      const s: Json = { type: 'integer', minimum: d.min, maximum: d.max }
      if (d.def !== undefined) s.default = d.def
      return withDoc(s)
    }
    case 'num': {
      const s: Json = { type: 'number', minimum: d.min, maximum: d.max }
      if (d.def !== undefined) s.default = d.def
      return withDoc(s)
    }
    case 'map':
      return withDoc({
        type: 'object',
        propertyNames: { pattern: d.key.source },
        additionalProperties: toJsonSchema(d.of, defs, out),
        maxProperties: d.max,
      })
    case 'bool': {
      const s: Json = { type: 'boolean' }
      if (d.def !== undefined) s.default = d.def
      return withDoc(s)
    }
    case 'enum': {
      const s: Json = { type: 'string', enum: [...d.values] }
      if (d.def !== undefined) s.default = d.def
      return withDoc(s)
    }
    case 'array':
      return withDoc({ type: 'array', items: toJsonSchema(d.of, defs, out), maxItems: d.max })
    case 'object':
      return withDoc(objectSchema(d, defs, out))
    case 'either':
      return withDoc({ anyOf: d.options.map((o) => toJsonSchema(o, defs, out)) })
    case 'ref': {
      if (!out[d.name]) {
        out[d.name] = {} // réservé avant la récursion
        out[d.name] = toJsonSchema(defs[d.name], defs, out)
      }
      return { $ref: `#/$defs/${d.name}` }
    }
    case 'tagged':
      return withDoc({
        oneOf: Object.entries(d.variants).map(([name, variant]) => {
          const s = objectSchema(variant, defs, out)
          const props = s.properties as Json
          s.properties = { [d.tag]: { const: name }, ...props }
          if (name !== d.fallback) s.required = [d.tag, ...((s.required as string[]) ?? [])]
          if (variant.doc) s.description = variant.doc
          return s
        }),
      })
  }
}

function objectSchema(d: ObjectDesc, defs: Record<string, Desc>, out: Record<string, Json>): Json {
  const properties: Json = {}
  for (const [key, f] of Object.entries(d.fields)) properties[key] = toJsonSchema(f, defs, out)
  const s: Json = { type: 'object', properties, additionalProperties: false }
  if (d.required?.length) s.required = [...d.required]
  return s
}
