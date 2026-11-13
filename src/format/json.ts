// Outils JSON : localiser une erreur (ligne et colonne, quel que soit le
// navigateur), réparer les deux fautes les plus fréquentes des IA (virgule en
// trop, commentaires), et écrire un JSON lisible pour le bloc #folio-doc.

export type JsonErrorCode =
  | 'unexpected-end'
  | 'unexpected-char'
  | 'trailing-comma'
  | 'unterminated-string'
  | 'bad-escape'
  | 'control-char'
  | 'expected-colon'
  | 'expected-comma'
  | 'expected-key'
  | 'trailing-content'
  | 'too-deep'
  | 'empty'

export interface JsonError {
  code: JsonErrorCode
  /** Position (0-based) dans le texte. */
  offset: number
  /** Ligne et colonne, à partir de 1. */
  line: number
  column: number
  /** Le caractère trouvé, s'il y en a un. */
  found?: string
}

function position(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let last = -1
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      last = i
    }
  }
  return { line, column: offset - last }
}

class Fail extends Error {
  constructor(
    readonly code: JsonErrorCode,
    readonly at: number,
  ) {
    super(code)
  }
}

/** Valide `text` en JSON strict ; renvoie la première erreur, ou null. */
export function locateJsonError(text: string): JsonError | null {
  let i = 0
  const n = text.length
  const ws = () => {
    while (i < n) {
      const c = text.charCodeAt(i)
      if (c === 32 || c === 9 || c === 10 || c === 13) i++
      else break
    }
  }
  const expectEnd = () => {
    if (i >= n) throw new Fail('unexpected-end', n)
  }
  const string = () => {
    i++ // "
    while (true) {
      if (i >= n) throw new Fail('unterminated-string', n)
      const c = text.charCodeAt(i)
      if (c === 34) {
        i++
        return
      }
      if (c === 10 || c === 13) throw new Fail('unterminated-string', i)
      if (c < 32) throw new Fail('control-char', i)
      if (c === 92) {
        const e = text[i + 1]
        if (e === undefined) throw new Fail('unterminated-string', n)
        if ('"\\/bfnrt'.includes(e)) i += 2
        else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) i += 6
        else throw new Fail('bad-escape', i)
        continue
      }
      i++
    }
  }
  const number = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400))
    if (!m || !m[0] || m[0] === '-') throw new Fail('unexpected-char', i)
    i += m[0].length
  }
  const value = (depth: number) => {
    if (depth > 4000) throw new Fail('too-deep', i)
    ws()
    expectEnd()
    const c = text[i]
    if (c === '{') {
      i++
      ws()
      if (text[i] === '}') {
        i++
        return
      }
      while (true) {
        ws()
        expectEnd()
        if (text[i] === '}') throw new Fail('trailing-comma', i)
        if (text[i] !== '"') throw new Fail('expected-key', i)
        string()
        ws()
        expectEnd()
        if (text[i] !== ':') throw new Fail('expected-colon', i)
        i++
        value(depth + 1)
        ws()
        expectEnd()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === '}') {
          i++
          return
        }
        throw new Fail('expected-comma', i)
      }
    }
    if (c === '[') {
      i++
      ws()
      if (text[i] === ']') {
        i++
        return
      }
      while (true) {
        ws()
        expectEnd()
        if (text[i] === ']') throw new Fail('trailing-comma', i)
        value(depth + 1)
        ws()
        expectEnd()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === ']') {
          i++
          return
        }
        throw new Fail('expected-comma', i)
      }
    }
    if (c === '"') return string()
    if (c === '-' || (c >= '0' && c <= '9')) return number()
    for (const lit of ['true', 'false', 'null']) {
      if (text.startsWith(lit, i)) {
        i += lit.length
        return
      }
    }
    throw new Fail('unexpected-char', i)
  }
  try {
    ws()
    if (i >= n) throw new Fail('empty', 0)
    value(0)
    ws()
    if (i < n) throw new Fail('trailing-content', i)
    return null
  } catch (e) {
    if (!(e instanceof Fail)) throw e
    const at = Math.min(e.at, n)
    return { code: e.code, offset: at, ...position(text, at), found: text[at] }
  }
}

/**
 * Retire les commentaires (// et /* *\/) et les virgules en trop avant } ou ],
 * hors des chaînes. Renvoie null si rien n'a changé.
 */
export function repairJson(text: string): string | null {
  let out = ''
  let changed = false
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\') j++
        j++
      }
      out += text.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++
      changed = true
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
      changed = true
      continue
    }
    if (c === ',') {
      let j = i + 1
      // regarder au-delà des espaces et des commentaires
      while (j < n) {
        if (/\s/.test(text[j])) j++
        else if (text[j] === '/' && text[j + 1] === '/') {
          while (j < n && text[j] !== '\n') j++
        } else if (text[j] === '/' && text[j + 1] === '*') {
          const end = text.indexOf('*/', j + 2)
          j = end < 0 ? n : end + 2
        } else break
      }
      if (text[j] === '}' || text[j] === ']') {
        changed = true
        i++
        continue
      }
    }
    out += c
    i++
  }
  return changed ? out : null
}

/**
 * JSON lisible : une valeur tient sur une ligne si elle fait au plus `width`
 * caractères, sinon elle est dépliée. Facile à lire et à modifier à la main.
 */
export function prettyJson(value: unknown, width = 100): string {
  const write = (v: unknown, indent: string): string => {
    const flat = JSON.stringify(v)
    if (flat === undefined) return 'null'
    if (v === null || typeof v !== 'object' || flat.length + indent.length <= width) return flat
    const inner = indent + '  '
    if (Array.isArray(v)) {
      if (!v.length) return '[]'
      return '[\n' + v.map((x) => inner + write(x, inner)).join(',\n') + '\n' + indent + ']'
    }
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined)
    if (!entries.length) return '{}'
    return (
      '{\n' +
      entries.map(([k, x]) => inner + JSON.stringify(k) + ': ' + write(x, inner)).join(',\n') +
      '\n' +
      indent +
      '}'
    )
  }
  return write(value, '')
}

/** Le JSON ne doit jamais pouvoir fermer la balise <script> qui le contient. */
export const escapeForScript = (json: string): string => json.replace(/</g, '\\u003c')
