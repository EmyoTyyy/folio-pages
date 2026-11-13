// Coloration syntaxique des extraits de code.
//
// Un petit analyseur lexical, sans dépendance, qui reconnaît les familles de
// langages courantes (C, JavaScript, Python, shell, SQL, HTML, CSS, JSON…).
// Il ne prétend pas analyser la grammaire : commentaires, chaînes, nombres,
// mots-clés, types et appels de fonction, ce qui suffit à rendre un extrait
// lisible. Les couleurs viennent du thème du document (theme.code).

import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

export type TokenKind = 'keyword' | 'string' | 'number' | 'comment' | 'function' | 'type'

export interface Token {
  from: number
  to: number
  kind: TokenKind
}

interface Lang {
  line?: string[]
  block?: [string, string][]
  strings: string[]
  /** Chaînes multilignes à trois guillemets (Python). */
  triple?: boolean
  keywords: Set<string>
  types?: Set<string>
  constants?: Set<string>
  caseInsensitive?: boolean
  /** $variable (shell, PHP). */
  dollarVars?: boolean
  /** @décorateur, @règle CSS. */
  at?: boolean
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean))

const C_LIKE = 'if else for while do switch case default break continue return goto sizeof typedef struct union enum static const extern volatile register inline'
const JS_KW = 'var let const function return if else for while do switch case default break continue new delete typeof instanceof in of class extends super this import export from as async await yield try catch finally throw void with debugger static get set interface type enum implements namespace declare readonly public private protected abstract keyof infer satisfies'
const JS_CONST = 'true false null undefined NaN Infinity'
const JS_TYPES = 'string number boolean any unknown never object symbol bigint Array Promise Map Set Record Date Error RegExp Object String Number Boolean'

const LANGS: Record<string, Lang> = {
  js: { line: ['//'], block: [['/*', '*/']], strings: ['"', "'", '`'], keywords: words(JS_KW), constants: words(JS_CONST), types: words(JS_TYPES), at: true },
  python: {
    line: ['#'],
    strings: ['"', "'"],
    triple: true,
    keywords: words('def class return if elif else for while in not and or is lambda import from as with try except finally raise pass break continue global nonlocal yield async await del assert match case'),
    constants: words('True False None self cls'),
    types: words('int float str bool list dict set tuple bytes object type Exception'),
    at: true,
  },
  c: {
    line: ['//'],
    block: [['/*', '*/']],
    strings: ['"', "'"],
    keywords: words(`${C_LIKE} class public private protected virtual override template typename namespace using new delete this throw try catch final package import interface extends implements abstract synchronized instanceof fn let mut impl trait pub mod use crate match loop where func go defer chan select range var val fun when object companion data sealed open lateinit guard protocol extension let struct`),
    types: words('int char float double void long short unsigned signed bool boolean byte size_t String string i8 i16 i32 i64 u8 u16 u32 u64 f32 f64 usize isize str Vec Option Result Box Self auto'),
    constants: words('true false null nullptr NULL nil None Some Ok Err'),
    at: true,
  },
  shell: {
    line: ['#'],
    strings: ['"', "'"],
    keywords: words('if then else elif fi for in do done while until case esac function return local export readonly declare unset shift exit set source alias echo cd ls grep sed awk cat mkdir rm cp mv chmod sudo npm npx git node python pip'),
    constants: words('true false'),
    dollarVars: true,
  },
  sql: {
    line: ['--'],
    block: [['/*', '*/']],
    strings: ["'", '"'],
    caseInsensitive: true,
    keywords: words('select from where and or not insert into values update set delete create table view index drop alter add column primary key foreign references join left right inner outer full on as group by order having limit offset distinct union all case when then else end exists in is like between with returning default constraint unique check asc desc'),
    types: words('int integer bigint smallint text varchar char date time timestamp boolean real float double numeric decimal serial blob json'),
    constants: words('null true false'),
  },
  css: {
    block: [['/*', '*/']],
    strings: ['"', "'"],
    keywords: words('important'),
    at: true,
    constants: words('inherit initial unset none auto'),
  },
  json: { strings: ['"'], keywords: new Set(), constants: words('true false null') },
  ruby: {
    line: ['#'],
    strings: ['"', "'"],
    keywords: words('def end class module if elsif else unless while until for in do return yield begin rescue ensure raise then case when and or not require include extend attr_accessor self super lambda proc'),
    constants: words('true false nil'),
  },
  r: {
    line: ['#'],
    strings: ['"', "'"],
    keywords: words('function if else for while repeat break next return in library require'),
    constants: words('TRUE FALSE NULL NA Inf NaN T F'),
  },
  latex: {
    line: ['%'],
    strings: [],
    keywords: new Set(),
  },
  yaml: {
    line: ['#'],
    strings: ['"', "'"],
    keywords: new Set(),
    constants: words('true false null yes no on off'),
  },
}

/** Noms usuels → famille de langage. */
const ALIASES: Record<string, string> = {
  javascript: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', node: 'js',
  py: 'python', python3: 'python', ipython: 'python',
  'c++': 'c', cpp: 'c', cc: 'c', h: 'c', hpp: 'c', 'c#': 'c', cs: 'c', csharp: 'c', java: 'c', go: 'c', golang: 'c', rust: 'c', rs: 'c', swift: 'c', kotlin: 'c', kt: 'c', scala: 'c', dart: 'c', php: 'c', objc: 'c', 'objective-c': 'c',
  sh: 'shell', bash: 'shell', zsh: 'shell', console: 'shell', terminal: 'shell', powershell: 'shell', ps1: 'shell', fish: 'shell',
  postgres: 'sql', postgresql: 'sql', mysql: 'sql', sqlite: 'sql', plsql: 'sql',
  scss: 'css', less: 'css', sass: 'css',
  jsonc: 'json', json5: 'json', geojson: 'json',
  rb: 'ruby', tex: 'latex', yml: 'yaml', toml: 'yaml', ini: 'yaml',
}

const MARKUP = new Set(['html', 'xml', 'svg', 'htm', 'xhtml', 'vue', 'markup'])

export function languageFamily(name: string): string | null {
  const k = name.trim().toLowerCase()
  if (!k) return null
  if (MARKUP.has(k)) return 'markup'
  if (Object.prototype.hasOwnProperty.call(LANGS, k)) return k
  return Object.prototype.hasOwnProperty.call(ALIASES, k) ? ALIASES[k] : null
}

const isIdStart = (c: string) => /[A-Za-z_\p{L}]/u.test(c)
const isId = (c: string) => /[\w\p{L}$]/u.test(c)

/** Découpe un extrait en jetons colorés (positions dans le texte). */
export function tokenize(text: string, language: string): Token[] {
  const fam = languageFamily(language)
  if (!fam) return []
  if (fam === 'markup') return tokenizeMarkup(text)
  const L = LANGS[fam]
  const out: Token[] = []
  const n = text.length
  let i = 0
  const push = (from: number, to: number, kind: TokenKind) => {
    if (to > from) out.push({ from, to, kind })
  }
  while (i < n) {
    const c = text[i]
    // commentaires
    const line = L.line?.find((p) => text.startsWith(p, i))
    if (line) {
      const e = text.indexOf('\n', i)
      const end = e < 0 ? n : e
      push(i, end, 'comment')
      i = end
      continue
    }
    const block = L.block?.find(([o]) => text.startsWith(o, i))
    if (block) {
      const e = text.indexOf(block[1], i + block[0].length)
      const end = e < 0 ? n : e + block[1].length
      push(i, end, 'comment')
      i = end
      continue
    }
    // chaînes
    if (L.strings.includes(c)) {
      const triple = L.triple && text.startsWith(c.repeat(3), i)
      const q = triple ? c.repeat(3) : c
      let j = i + q.length
      while (j < n) {
        if (text[j] === '\\') {
          j += 2
          continue
        }
        if (text.startsWith(q, j)) {
          j += q.length
          break
        }
        if (!triple && c !== '`' && text[j] === '\n') break
        j++
      }
      const end = Math.min(j, n)
      // En JSON, une clé (chaîne suivie de « : ») est colorée comme une propriété.
      const isKey = fam === 'json' && /^\s*:/.test(text.slice(end, end + 20))
      push(i, end, isKey ? 'function' : 'string')
      i = end
      continue
    }
    // nombres
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      if (i === 0 || !isId(text[i - 1])) {
        const m = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)[a-zA-Z%]*/.exec(text.slice(i, i + 64))
        if (m) {
          push(i, i + m[0].length, 'number')
          i += m[0].length
          continue
        }
      }
    }
    // variables $x
    if (L.dollarVars && c === '$') {
      const m = /^\$(\{[^}\n]*\}|[A-Za-z_][\w]*|[0-9@#?$!*-])/.exec(text.slice(i, i + 80))
      if (m) {
        push(i, i + m[0].length, 'type')
        i += m[0].length
        continue
      }
    }
    // @décorateur / @règle
    if (L.at && c === '@' && isIdStart(text[i + 1] ?? '')) {
      let j = i + 1
      while (j < n && /[\w-]/.test(text[j])) j++
      push(i, j, 'keyword')
      i = j
      continue
    }
    // mots
    if (isIdStart(c)) {
      let j = i + 1
      while (j < n && (isId(text[j]) || (fam === 'css' && text[j] === '-'))) j++
      const word = text.slice(i, j)
      const key = L.caseInsensitive ? word.toLowerCase() : word
      if (L.keywords.has(key)) push(i, j, 'keyword')
      else if (L.constants?.has(key)) push(i, j, 'number')
      else if (L.types?.has(key) || (fam !== 'css' && fam !== 'sql' && /^[A-Z][a-z0-9]+[A-Z]?\w*$/.test(word) && fam !== 'shell')) push(i, j, 'type')
      else if (/^\s*\(/.test(text.slice(j, j + 10))) push(i, j, 'function')
      else if (fam === 'css' && /^\s*:/.test(text.slice(j, j + 10))) push(i, j, 'function')
      i = j
      continue
    }
    i++
  }
  return out
}

/** HTML et XML : commentaires, balises, attributs et valeurs. */
function tokenizeMarkup(text: string): Token[] {
  const out: Token[] = []
  const n = text.length
  let i = 0
  while (i < n) {
    if (text.startsWith('<!--', i)) {
      const e = text.indexOf('-->', i + 4)
      const end = e < 0 ? n : e + 3
      out.push({ from: i, to: end, kind: 'comment' })
      i = end
      continue
    }
    if (text[i] === '<' && /[A-Za-z/!?]/.test(text[i + 1] ?? '')) {
      const m = /^<\/?[!?]?[\w:.-]+/.exec(text.slice(i, i + 100))
      if (m) {
        out.push({ from: i, to: i + m[0].length, kind: 'keyword' })
        i += m[0].length
        // attributs jusqu'à la fin de la balise
        while (i < n && text[i] !== '>') {
          const a = /^[\w:.-]+/.exec(text.slice(i, i + 100))
          if (a) {
            out.push({ from: i, to: i + a[0].length, kind: 'function' })
            i += a[0].length
            continue
          }
          if (text[i] === '"' || text[i] === "'") {
            const q = text[i]
            const e = text.indexOf(q, i + 1)
            const end = e < 0 ? n : e + 1
            out.push({ from: i, to: end, kind: 'string' })
            i = end
            continue
          }
          i++
        }
        continue
      }
    }
    if (text[i] === '&') {
      const m = /^&(#\d+|#x[0-9a-f]+|\w+);/i.exec(text.slice(i, i + 20))
      if (m) {
        out.push({ from: i, to: i + m[0].length, kind: 'number' })
        i += m[0].length
        continue
      }
    }
    i++
  }
  return out
}

// --- greffon ------------------------------------------------------------------

/** Jetons mis en cache par nœud : un extrait inchangé n'est pas réanalysé. */
const cache = new WeakMap<PMNode, Token[]>()

function tokensOf(node: PMNode): Token[] {
  let t = cache.get(node)
  if (!t) {
    // Au-delà, on ne colore pas (un journal de 2 Mo collé dans un bloc de code).
    t = node.textContent.length > 200_000 ? [] : tokenize(node.textContent, node.attrs.language as string)
    cache.set(node, t)
  }
  return t
}

function decorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return true
    for (const t of tokensOf(node)) decos.push(Decoration.inline(pos + 1 + t.from, pos + 1 + t.to, { class: `fp-tk-${t.kind}` }))
    return false
  })
  return DecorationSet.create(doc, decos)
}

export const highlightKey = new PluginKey<DecorationSet>('folio-highlight')

export function highlightPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: highlightKey,
    state: {
      init: (_c, state) => decorations(state.doc),
      apply: (tr, set) => (tr.docChanged ? decorations(tr.doc) : set),
    },
    props: { decorations: (state) => highlightKey.getState(state) },
  })
}
