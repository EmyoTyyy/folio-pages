// Équations et .docx (phase 6) : arbre LaTeX → OMML (export) et OMML → LaTeX (import).
//
// OMML (Office Math Markup Language) est le format des équations des
// fichiers .docx. L'export part de l'arbre du moteur (src/math/ast) : chaque
// nœud a son équivalent (fraction m:f, racine m:rad, indices m:sSub…, grands
// opérateurs m:nary, délimiteurs m:d, matrices m:m, accents m:acc…). L'import
// lit l'OMML et écrit du LaTeX lisible, que le moteur sait rendre.
// Les deux restent bornés : profondeur et taille limitées.

import type { MNode } from '../math/ast'
import type { MathContext } from '../math'
import { attr, kids, type XmlNode } from './xml'

/**
 * Le moteur d'équations, prêté par l'application (src/math/kit.ts) : le module
 * .docx est compilé à part et n'en embarque pas de copie.
 */
export interface MathKit {
  /** Arbre d'une formule ; lève une erreur si elle est illisible. */
  parse: (tex: string, display: boolean, ctx: MathContext) => MNode
  labelOf: (tex: string) => string | null
  /** Nom LaTeX d'un symbole (« α » → « alpha »). */
  glyph: (ch: string) => string | undefined
  /** Fonctions écrites droites (sin, log, lim…). */
  functions: ReadonlySet<string>
}

let kit: MathKit | null = null
/** Branche le moteur d'équations (sans lui, les équations passent en texte). */
export function useMath(k: MathKit): void {
  kit = k
}
export const mathKitInUse = (): MathKit | null => kit

/** Élément XML minimal (converti en composant docx par l'export). */
export interface X {
  n: string
  a?: Record<string, string>
  c?: (X | string)[]
}

const el = (n: string, a?: Record<string, string> | null, ...c: (X | string | null | undefined | false)[]): X => {
  const out: X = { n }
  if (a) out.a = a
  const cc = c.filter((x): x is X | string => !!x || x === '')
  if (cc.length) out.c = cc
  return out
}

const MAX_DEPTH = 60

/** Espace de noms de la partie customXml qui garde les sources LaTeX (export → import). */
export const MATH_PART_NS = 'urn:folio-pages:equations'

interface Style {
  /** m:sty : p (droit), b (gras), i (italique), bi. */
  sty?: string
  /** m:scr : double-struck, script, fraktur, sans-serif, monospace. */
  scr?: string
  /** Texte ordinaire (\text). */
  nor?: boolean
  color?: string
}

/** Une suite de caractères en équation : m:r. */
function run(text: string, st: Style = {}): X {
  const rPr: X[] = []
  if (st.nor) rPr.push(el('m:nor'))
  if (st.scr) rPr.push(el('m:scr', { 'm:val': st.scr }))
  if (st.sty) rPr.push(el('m:sty', { 'm:val': st.sty }))
  const w = st.color ? el('w:rPr', null, el('w:color', { 'w:val': st.color })) : null
  return el('m:r', null, rPr.length ? el('m:rPr', null, ...rPr) : null, w, el('m:t', { 'xml:space': 'preserve' }, text))
}

const SCR: Record<string, string> = { bb: 'double-struck', cal: 'script', scr: 'script', frak: 'fraktur', sf: 'sans-serif', sfit: 'sans-serif', tt: 'monospace' }
const STY: Record<string, string> = { bf: 'b', rm: 'p', it: 'i', bfit: 'bi', sf: 'p', tt: 'p' }

function fontStyle(font: string, parent: Style): Style {
  return { ...parent, scr: SCR[font] ?? parent.scr, sty: STY[font] ?? (SCR[font] ? 'p' : parent.sty) }
}

/** Couleur CSS simple → hexadécimal Word (sinon rien). */
const NAMED: Record<string, string> = { red: 'FF0000', blue: '0000FF', green: '008000', black: '000000', white: 'FFFFFF', gray: '808080', grey: '808080', orange: 'FFA500', purple: '800080', teal: '008080', brown: 'A52A2A', magenta: 'FF00FF', cyan: '00FFFF', yellow: 'FFFF00', violet: 'EE82EE', olive: '808000', navy: '000080', maroon: '800000', lime: '00FF00', pink: 'FFC0CB' }
function wordColor(c: string): string | undefined {
  const s = c.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s.slice(1).toUpperCase()
  if (/^#[0-9a-f]{3}$/.test(s)) return s.slice(1).split('').map((x) => x + x).join('').toUpperCase()
  return NAMED[s]
}

/** Opérateur de relation : coupe la portée d'un grand opérateur (∑ … = …). */
const RELATION = /^[=<>≤≥≠≈≡∼≃≅∝≪≫⊂⊃⊆⊇∈∉→←↔⇒⇐⇔⟹⟸⟺↦]$/

const isBig = (n: MNode): n is Extract<MNode, { k: 'sym' }> => n.k === 'sym' && !!n.big

class ToOmml {
  private depth = 0

  /** Éléments OMML d'un nœud (plusieurs pour une rangée). */
  nodes(n: MNode, st: Style): X[] {
    if (++this.depth > MAX_DEPTH) {
      this.depth--
      return [run('…', st)]
    }
    try {
      return this.convert(n, st)
    } finally {
      this.depth--
    }
  }

  /** Argument OMML (m:e, m:num…) : jamais vide (Word montrerait un carré). */
  arg(name: string, n: MNode | undefined, st: Style): X {
    const c = n ? this.nodes(n, st) : []
    return el(name, null, ...c)
  }

  row(items: MNode[], st: Style): X[] {
    const out: X[] = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      // Grand opérateur (∑, ∫…) : ce qui suit, jusqu'à une relation, en est l'argument.
      const big = isBig(it) ? { op: it, sub: undefined, sup: undefined, limits: false } : it.k === 'scr' && isBig(it.b) ? { op: it.b, sub: it.sub, sup: it.sup, limits: !!it.limits } : null
      if (big) {
        let j = i + 1
        while (j < items.length && !(items[j].k === 'sym' && (items[j] as { t: string }).t && RELATION.test((items[j] as { t: string }).t))) j++
        const body = items.slice(i + 1, j)
        out.push(this.nary(big.op.t, big.sub, big.sup, big.limits, body, st))
        i = j - 1
        continue
      }
      out.push(...this.nodes(it, st))
    }
    return out
  }

  nary(chr: string, sub: MNode | undefined, sup: MNode | undefined, limits: boolean, body: MNode[], st: Style): X {
    const pr: X[] = [el('m:chr', { 'm:val': chr }), el('m:limLoc', { 'm:val': limits || /[∑∏∐⋃⋂⨁⨂⋁⋀]/.test(chr) ? 'undOvr' : 'subSup' })]
    if (!sub) pr.push(el('m:subHide', { 'm:val': '1' }))
    if (!sup) pr.push(el('m:supHide', { 'm:val': '1' }))
    return el('m:nary', null, el('m:naryPr', null, ...pr), this.arg('m:sub', sub, st), this.arg('m:sup', sup, st), el('m:e', null, ...this.row(body, st)))
  }

  convert(n: MNode, st: Style): X[] {
    switch (n.k) {
      case 'row':
        return this.row(n.c, st)
      case 'sym': {
        if (n.big) return [this.nary(n.t, undefined, undefined, false, [], st)]
        // Lettres : italiques par défaut en OMML ; fonctions, chiffres et lettres droites : sty p.
        const plain = n.fn || n.up || n.cls === 'n' || n.cls === 'o'
        return [run(n.t, plain && !st.sty && !st.scr ? { ...st, sty: n.cls === 'o' && !n.fn ? undefined : 'p' } : st)]
      }
      case 'text':
        return [run(n.t, { ...st, nor: true })]
      case 'space': {
        if (n.em <= 0) return []
        const ch = n.em >= 1.9 ? '  ' : n.em >= 0.9 ? ' ' : n.em >= 0.27 ? ' ' : n.em >= 0.2 ? ' ' : ' '
        return [run(ch, st)]
      }
      case 'frac':
        return [
          el(
            'm:f',
            null,
            n.nobar ? el('m:fPr', null, el('m:type', { 'm:val': 'noBar' })) : null,
            this.arg('m:num', n.n, st),
            this.arg('m:den', n.d, st),
          ),
        ]
      case 'sqrt':
        return [el('m:rad', null, n.i ? null : el('m:radPr', null, el('m:degHide', { 'm:val': '1' })), this.arg('m:deg', n.i, st), this.arg('m:e', n.b, st))]
      case 'scr': {
        if (isBig(n.b)) return [this.nary(n.b.t, n.sub, n.sup, !!n.limits, [], st)]
        if (n.limits) {
          // Limites dessous / dessus (lim, max, sous-accolades…).
          let base: X = el('m:e', null, ...this.nodes(n.b, st))
          if (n.sub) base = el('m:e', null, el('m:limLow', null, base, this.arg('m:lim', n.sub, st)))
          if (n.sup) base = el('m:e', null, el('m:limUpp', null, base, this.arg('m:lim', n.sup, st)))
          return base.c as X[]
        }
        if (n.sub && n.sup) return [el('m:sSubSup', null, this.arg('m:e', n.b, st), this.arg('m:sub', n.sub, st), this.arg('m:sup', n.sup, st))]
        if (n.sub) return [el('m:sSub', null, this.arg('m:e', n.b, st), this.arg('m:sub', n.sub, st))]
        if (n.sup) return [el('m:sSup', null, this.arg('m:e', n.b, st), this.arg('m:sup', n.sup, st))]
        return this.nodes(n.b, st)
      }
      case 'fence':
        return [this.delim(n.l, n.r, this.nodes(n.c, st))]
      case 'table': {
        const rows = n.rows.map((r) => el('m:mr', null, ...r.map((c) => el('m:e', null, ...this.nodes(c, st)))))
        const cols = Math.max(1, ...n.rows.map((r) => r.length))
        const jc = n.cols ? n.cols : n.align === 'rl' ? 'rl' : ''
        const mcs = jc
          ? el(
              'm:mcs',
              null,
              ...Array.from({ length: cols }, (_v, i) => {
                const c = jc[Math.min(i, jc.length - 1)] ?? (n.align === 'rl' ? (i % 2 ? 'l' : 'r') : 'c')
                const at = n.align === 'rl' ? (i % 2 ? 'left' : 'right') : c === 'l' ? 'left' : c === 'r' ? 'right' : 'center'
                return el('m:mc', null, el('m:mcPr', null, el('m:count', { 'm:val': '1' }), el('m:mcJc', { 'm:val': at })))
              }),
            )
          : null
        const m = el('m:m', null, mcs ? el('m:mPr', null, mcs) : null, ...rows)
        return n.l || n.r ? [this.delim(n.l ?? '', n.r ?? '', [m])] : [m]
      }
      case 'accent': {
        const a = n.a
        if (a === '‾' || a === '_' || a === '¯') return [el('m:bar', null, el('m:barPr', null, el('m:pos', { 'm:val': n.under ? 'bot' : 'top' })), this.arg('m:e', n.b, st))]
        const COMBINING: Record<string, string> = { '^': '̂', '~': '̃', '→': '⃗', '˙': '̇', '¨': '̈', '´': '́', '`': '̀', '˘': '̆', ˇ: '̌', '˚': '̊' }
        // Accent (même large : chapeau, tilde) ; flèches, accolades et dessous : un caractère de groupe.
        const wide = n.stretchy && a !== '^' && a !== '~'
        if (!n.under && !wide && a in COMBINING) return [el('m:acc', null, el('m:accPr', null, el('m:chr', { 'm:val': COMBINING[a] })), this.arg('m:e', n.b, st))]
        return [el('m:groupChr', null, el('m:groupChrPr', null, el('m:chr', { 'm:val': a }), el('m:pos', { 'm:val': n.under ? 'bot' : 'top' }), el('m:vertJc', { 'm:val': n.under ? 'top' : 'bot' })), this.arg('m:e', n.b, st))]
      }
      case 'pad':
        return n.phantom ? [el('m:phant', null, this.arg('m:e', n.c, st))] : this.nodes(n.c, st)
      case 'multi': {
        const base = this.nodes(n.b, st)
        const pre = n.presub || n.presup ? [el('m:sPre', null, this.arg('m:sub', n.presub, st), this.arg('m:sup', n.presup, st), el('m:e', null, ...base))] : base
        if (n.sub || n.sup) return [el('m:sSubSup', null, el('m:e', null, ...pre), this.arg('m:sub', n.sub, st), this.arg('m:sup', n.sup, st))]
        return pre
      }
      case 'unknown':
        return [run(n.t, { ...st, nor: true })]
      case 'xarrow':
        return [el('m:groupChr', null, el('m:groupChrPr', null, el('m:chr', { 'm:val': n.a }), el('m:pos', { 'm:val': 'bot' }), el('m:vertJc', { 'm:val': 'bot' })), el('m:e', null, ...(n.over ? this.nodes(n.over, st) : [run(' ', st)])))]
      case 'style': {
        let s2 = st
        if (n.font) s2 = fontStyle(n.font, s2)
        if (n.bold) s2 = { ...s2, sty: 'b' }
        if (n.color) {
          const c = wordColor(n.color)
          if (c) s2 = { ...s2, color: c }
        }
        const inner = this.nodes(n.c, s2)
        if (n.color === 'transparent') return [el('m:phant', null, el('m:e', null, ...inner))]
        if (n.box || n.frame || n.cancel) {
          const pr: X[] = []
          if (n.cancel === true || n.cancel === 'x') pr.push(el('m:strikeBLTR', { 'm:val': '1' }))
          if (n.cancel === 'down' || n.cancel === 'x') pr.push(el('m:strikeTLBR', { 'm:val': '1' }))
          if (n.cancel === 'h') pr.push(el('m:strikeH', { 'm:val': '1' }))
          if (n.cancel) pr.push(el('m:hideTop', { 'm:val': '1' }), el('m:hideBot', { 'm:val': '1' }), el('m:hideLeft', { 'm:val': '1' }), el('m:hideRight', { 'm:val': '1' }))
          return [el('m:borderBox', null, pr.length ? el('m:borderBoxPr', null, ...pr) : null, el('m:e', null, ...inner))]
        }
        return inner
      }
      case 'bond':
        return [run(n.kind.includes('tri') ? '≡' : n.kind.includes('Double') || n.kind.includes('double') ? '=' : '−', st)]
    }
    return []
  }

  delim(l: string, r: string, inner: X[]): X {
    const pr: X[] = []
    if (l !== '(') pr.push(el('m:begChr', { 'm:val': l }))
    if (r !== ')') pr.push(el('m:endChr', { 'm:val': r }))
    return el('m:d', null, pr.length ? el('m:dPr', null, ...pr) : null, el('m:e', null, ...inner))
  }
}

/** Arbre de formule → m:oMath (dans la ligne) ou m:oMathPara (centrée). */
export function treeToOmml(tree: MNode, display: boolean): X {
  const math = el('m:oMath', null, ...new ToOmml().nodes(tree, {}))
  return display ? el('m:oMathPara', null, el('m:oMathParaPr', null, el('m:jc', { 'm:val': 'center' })), math) : math
}

const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Arbre → texte XML (tests, empreinte). */
export function xmlOf(x: X | string): string {
  if (typeof x === 'string') return escXml(x)
  const a = x.a ? Object.entries(x.a).map(([k, v]) => ` ${k}="${escXml(v)}"`).join('') : ''
  return x.c && x.c.length ? `<${x.n}${a}>${x.c.map(xmlOf).join('')}</${x.n}>` : `<${x.n}${a}/>`
}

/** Empreinte d'une formule OMML : le texte de ses m:t (sert à reconnaître nos propres équations). */
export function ommlPrint(x: X | XmlNode): string {
  let out = ''
  const walk = (n: X | XmlNode | string) => {
    if (typeof n === 'string') return
    if ('n' in n) {
      if (n.n === 'm:t') out += (n.c ?? []).filter((c): c is string => typeof c === 'string').join('')
      for (const c of n.c ?? []) walk(c)
    } else {
      if (n.name === 'm:t') out += n.text
      for (const c of n.children) walk(c)
    }
  }
  walk(x)
  return out.replace(/\s+/g, '')
}

// --- import : OMML → LaTeX --------------------------------------------------

/** Caractère → commande LaTeX (les lettres et chiffres restent tels quels). */
function texOfChar(ch: string): string {
  if (/^[A-Za-z0-9.,;:!?'()[\]|/+\-*=<> ]$/.test(ch)) return ch
  if (ch === '{') return '\\{'
  if (ch === '}') return '\\}'
  if (ch === '−') return '-'
  if (ch === ' ' || ch === ' ' || ch === ' ') return '\\,'
  if (ch === ' ') return '\\quad '
  if (ch === ' ' || ch === ' ') return '~'
  if (ch === '%' || ch === '#' || ch === '&' || ch === '$' || ch === '_') return `\\${ch}`
  if (ch === '\\') return '\\backslash '
  const s = kit?.glyph(ch)
  if (s) return `\\${s} `
  // Lettres mathématiques (𝑥, 𝐱, ℝ…) : leur lettre de base.
  const norm = ch.normalize('NFKC')
  if (norm !== ch && /^[A-Za-z0-9]$/.test(norm)) {
    const cp = ch.codePointAt(0)!
    if (ch === 'ℝ' || ch === 'ℕ' || ch === 'ℤ' || ch === 'ℚ' || ch === 'ℂ' || (cp >= 0x1d538 && cp <= 0x1d56b)) return `\\mathbb{${norm}}`
    if (cp >= 0x1d400 && cp <= 0x1d433) return `\\mathbf{${norm}}`
    return norm
  }
  return ch
}

const FUNCS = { has: (name: string) => !!kit?.functions.has(name) }

/** Texte d'une suite de caractères en LaTeX ; `plain` : écrit droit (sty p). */
function texOfText(text: string, plain: boolean): string {
  const t = text.trim() && FUNCS.has(text.trim()) ? `\\${text.trim()} ` : null
  if (t) return t
  let out = ''
  for (const ch of Array.from(text)) out += texOfChar(ch)
  if (plain && /^[A-Za-z]{2,}$/.test(text)) return `\\mathrm{${text}}`
  return out
}

const BIG_TEX: Record<string, string> = { '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap', '⨁': '\\bigoplus', '⨂': '\\bigotimes', '⋁': '\\bigvee', '⋀': '\\bigwedge' }
const ACC_TEX: Record<string, string> = { '̂': '\\hat', '^': '\\hat', '̃': '\\tilde', '~': '\\tilde', '⃗': '\\vec', '→': '\\vec', '̇': '\\dot', '˙': '\\dot', '̈': '\\ddot', '¨': '\\ddot', '̄': '\\bar', '̅': '\\bar', '¯': '\\bar', '́': '\\acute', '̀': '\\grave', '̆': '\\breve', '̌': '\\check', '̊': '\\mathring' }
const FENCE_TEX: Record<string, string> = { '(': '(', ')': ')', '[': '[', ']': ']', '{': '\\{', '}': '\\}', '|': '|', '‖': '\\|', '⟨': '\\langle', '⟩': '\\rangle', '〈': '\\langle', '〉': '\\rangle', '⌈': '\\lceil', '⌉': '\\rceil', '⌊': '\\lfloor', '⌋': '\\rfloor', '': '.' }

const val = (n: XmlNode | undefined, name: string): string | undefined => {
  const c = n ? kids(n, name)[0] : undefined
  return c ? attr(c, 'm:val') : undefined
}
const prOf = (n: XmlNode, name: string) => kids(n, name)[0]

/** Arguments séparés : un groupe {…} si besoin. */
const group = (s: string) => {
  const t = s.trim()
  return /^[A-Za-z0-9]$/.test(t) || /^\\[A-Za-z]+\s*$/.test(t) ? t : `{${t}}`
}

class FromOmml {
  private depth = 0
  private nodes = 0
  /** Un nœud OMML → LaTeX. */
  tex(n: XmlNode): string {
    if (++this.depth > MAX_DEPTH || ++this.nodes > 20_000) {
      this.depth--
      return ''
    }
    try {
      return this.convert(n)
    } finally {
      this.depth--
    }
  }
  all(n: XmlNode | undefined): string {
    if (!n) return ''
    let out = ''
    for (const c of n.children) {
      const t = this.tex(c)
      // Deux commandes accolées : une espace entre elles (\alpha x, pas \alphax).
      if (out && /\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(t)) out += ' '
      out += t
    }
    return out
  }
  arg(n: XmlNode, name: string): string {
    return this.all(kids(n, name)[0]).trim()
  }
  convert(n: XmlNode): string {
    switch (n.name) {
      case 'm:oMath':
      case 'm:e':
      case 'm:num':
      case 'm:den':
      case 'm:sub':
      case 'm:sup':
      case 'm:deg':
      case 'm:lim':
      case 'm:fName':
      case 'm:box':
      case 'w:ins':
        return this.all(n)
      case 'w:del':
        return ''
      case 'm:r': {
        const rPr = prOf(n, 'm:rPr')
        const text = kids(n, 'm:t').map((t) => t.text).join('') || kids(n, 'w:t').map((t) => t.text).join('')
        if (!text) return ''
        if (rPr && prOf(rPr, 'm:nor')) return `\\text{${text.replace(/[{}\\]/g, '')}}`
        const scr = val(rPr, 'm:scr')
        const sty = val(rPr, 'm:sty')
        const inner = texOfText(text, sty === 'p')
        if (scr === 'double-struck') return `\\mathbb{${text}}`
        if (scr === 'script') return `\\mathcal{${text}}`
        if (scr === 'fraktur') return `\\mathfrak{${text}}`
        if (scr === 'sans-serif') return `\\mathsf{${text}}`
        if (scr === 'monospace') return `\\mathtt{${text}}`
        if (sty === 'b' || sty === 'bi') return `\\mathbf{${inner}}`
        return inner
      }
      case 'm:f': {
        const type = val(prOf(n, 'm:fPr'), 'm:type')
        const a = this.arg(n, 'm:num')
        const b = this.arg(n, 'm:den')
        if (type === 'noBar') return `\\genfrac{}{}{0pt}{}{${a}}{${b}}`
        if (type === 'lin') return `${group(a)}/${group(b)}`
        return `\\frac{${a}}{${b}}`
      }
      case 'm:rad': {
        const deg = this.arg(n, 'm:deg')
        const hide = val(prOf(n, 'm:radPr'), 'm:degHide')
        return hide === '1' || hide === 'on' || hide === 'true' || !deg ? `\\sqrt{${this.arg(n, 'm:e')}}` : `\\sqrt[${deg}]{${this.arg(n, 'm:e')}}`
      }
      case 'm:sSup':
        return `${group(this.arg(n, 'm:e'))}^${group(this.arg(n, 'm:sup'))}`
      case 'm:sSub':
        return `${group(this.arg(n, 'm:e'))}_${group(this.arg(n, 'm:sub'))}`
      case 'm:sSubSup':
        return `${group(this.arg(n, 'm:e'))}_${group(this.arg(n, 'm:sub'))}^${group(this.arg(n, 'm:sup'))}`
      case 'm:sPre':
        return `{}_${group(this.arg(n, 'm:sub'))}^${group(this.arg(n, 'm:sup'))}${group(this.arg(n, 'm:e'))}`
      case 'm:nary': {
        const pr = prOf(n, 'm:naryPr')
        const chr = val(pr, 'm:chr') ?? '∫'
        const op = BIG_TEX[chr] ?? (kit?.glyph(chr) ? `\\${kit.glyph(chr)}` : chr)
        const sub = val(pr, 'm:subHide') === '1' ? '' : this.arg(n, 'm:sub')
        const sup = val(pr, 'm:supHide') === '1' ? '' : this.arg(n, 'm:sup')
        return `${op}${sub ? `_${group(sub)}` : ''}${sup ? `^${group(sup)}` : ''} ${this.arg(n, 'm:e')}`
      }
      case 'm:d': {
        const pr = prOf(n, 'm:dPr')
        const beg = val(pr, 'm:begChr') ?? '('
        const end = val(pr, 'm:endChr') ?? ')'
        const sep = val(pr, 'm:sepChr') ?? '|'
        const parts = kids(n, 'm:e').map((e) => this.all(e).trim())
        const l = FENCE_TEX[beg] ?? '.'
        const r = FENCE_TEX[end] ?? '.'
        const body = parts.join(` ${FENCE_TEX[sep] ?? sep} `)
        // Une matrice entre parenthèses ou crochets : son environnement.
        if (parts.length === 1 && /^\\begin\{matrix\}[\s\S]*\\end\{matrix\}$/.test(body)) {
          const env = beg === '(' && end === ')' ? 'pmatrix' : beg === '[' && end === ']' ? 'bmatrix' : beg === '|' && end === '|' ? 'vmatrix' : beg === '{' && end === '}' ? 'Bmatrix' : null
          if (env) return body.replace(/^\\begin\{matrix\}/, `\\begin{${env}}`).replace(/\\end\{matrix\}$/, `\\end{${env}}`)
        }
        if (beg === '{' && end === '' && parts.length === 1 && /^\\begin\{matrix\}/.test(body)) return body.replace(/^\\begin\{matrix\}/, '\\begin{cases}').replace(/\\end\{matrix\}$/, '\\end{cases}')
        return `\\left${l === '.' ? '.' : l} ${body} \\right${r === '.' ? '.' : r}`
      }
      case 'm:m': {
        const rows = kids(n, 'm:mr').map((r) => kids(r, 'm:e').map((e) => this.all(e).trim()).join(' & '))
        return `\\begin{matrix} ${rows.join(' \\\\ ')} \\end{matrix}`
      }
      case 'm:eqArr': {
        const rows = kids(n, 'm:e').map((e) => this.all(e).trim())
        return `\\begin{aligned} ${rows.join(' \\\\ ')} \\end{aligned}`
      }
      case 'm:acc': {
        const chr = val(prOf(n, 'm:accPr'), 'm:chr') ?? '̂'
        return `${ACC_TEX[chr] ?? '\\hat'}{${this.arg(n, 'm:e')}}`
      }
      case 'm:bar':
        return `${val(prOf(n, 'm:barPr'), 'm:pos') === 'bot' ? '\\underline' : '\\overline'}{${this.arg(n, 'm:e')}}`
      case 'm:groupChr': {
        const pr = prOf(n, 'm:groupChrPr')
        const chr = val(pr, 'm:chr') ?? '⏟'
        const bottom = (val(pr, 'm:pos') ?? 'bot') === 'bot'
        const e = this.arg(n, 'm:e')
        if (chr === '⏟' || chr === '⏞') return `${chr === '⏟' ? '\\underbrace' : '\\overbrace'}{${e}}`
        const named: Record<string, string> = bottom ? { '→': '\\underrightarrow', '←': '\\underleftarrow', _: '\\underline', '‾': '\\underline' } : { '→': '\\overrightarrow', '←': '\\overleftarrow', '^': '\\widehat', '~': '\\widetilde', '‾': '\\overline', '¯': '\\overline' }
        if (named[chr]) return `${named[chr]}{${e}}`
        const mark = /^[\^_~&%#$]$/.test(chr) ? `\\text{${/[_&%#$]/.test(chr) ? '\\' + chr : chr}}` : texOfChar(chr).trim()
        return bottom ? `\\underset{${mark}}{${e}}` : `\\overset{${mark}}{${e}}`
      }
      case 'm:limLow': {
        const e = this.arg(n, 'm:e')
        const lim = this.arg(n, 'm:lim')
        return /^\\(lim|max|min|sup|inf|limsup|liminf)\s*$/.test(e) ? `${e.trim()}_${group(lim)}` : `\\underset{${lim}}{${e}}`
      }
      case 'm:limUpp':
        return `\\overset{${this.arg(n, 'm:lim')}}{${this.arg(n, 'm:e')}}`
      case 'm:func': {
        const name = this.arg(n, 'm:fName').trim()
        const e = this.arg(n, 'm:e')
        const fn = /^\\mathrm\{([A-Za-z]+)\}$/.exec(name)
        const head = fn ? (FUNCS.has(fn[1]) ? `\\${fn[1]}` : `\\operatorname{${fn[1]}}`) : /^[A-Za-z]{2,}$/.test(name) ? (FUNCS.has(name) ? `\\${name}` : `\\operatorname{${name}}`) : name
        return `${head} ${e}`
      }
      case 'm:borderBox':
        return `\\boxed{${this.arg(n, 'm:e')}}`
      case 'm:phant':
        return `\\phantom{${this.arg(n, 'm:e')}}`
      default:
        // Propriétés (…Pr) et inconnus : ignorés ; un conteneur inconnu garde son contenu.
        if (n.name.endsWith('Pr')) return ''
        return this.all(n)
    }
  }
}

/** m:oMath → LaTeX (une ligne, lisible). */
export function ommlToTex(n: XmlNode): string {
  return new FromOmml()
    .tex(n)
    .replace(/[ \t]+/g, ' ')
    .replace(/ ([_^])/g, '$1')
    .trim()
}
