// Générateur de documents aléatoires (reproductibles) pour les tests d'aller-retour.
// Il couvre toutes les possibilités du format : marques, champs, mise en forme
// de paragraphe, styles, thème, listes, tableaux, images et ressources.

import { loadDocument } from '../../src/format/load'
import type { FolioDoc } from '../../src/format/types'

export function rng(seed: number) {
  let s = seed >>> 0 || 1
  const next = () => {
    // xorshift32
    s ^= s << 13
    s >>>= 0
    s ^= s >> 17
    s ^= s << 5
    s >>>= 0
    return s / 2 ** 32
  }
  const int = (a: number, b: number) => a + Math.floor(next() * (b - a + 1))
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]
  const chance = (p: number) => next() < p
  return { next, int, pick, chance }
}

type R = ReturnType<typeof rng>

const WORDS = ['été', 'données', 'Folio', 'résultat', 'x', 'déjà', '42', 'naïve', 'œuvre', '🎉', 'a<b', '"cité"', 'tab\tulé', 'C++', '$x^2$', '*', '_', '\\', 'mot', '{{page}}', '{', '}']
const LINKS = ['https://example.org', 'mailto:a@b.fr', '#section-2', 'tel:+33123456789', 'page.html']
const COLORS = ['#1e6b55', '#ff0000', 'accent1', 'accent3', 'text', '#000000']
const HIGHLIGHTS = ['yellow', 'green', 'pink', '#ffeeaa']
const FONTS = ['heading', 'body', 'mono', 'Newsreader', 'Arial', "Comic Sans MS"]
const FIELDS = ['title', 'author', 'date', 'time', 'page', 'pages', 'filename', 'created', 'keywords']
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

function text(r: R): string {
  const n = r.int(1, 6)
  const words: string[] = []
  for (let i = 0; i < n; i++) words.push(r.pick(WORDS))
  let s = words.join(r.chance(0.1) ? '\n' : ' ')
  if (r.chance(0.1)) s += '\n'
  return s
}

function marks(r: R, o: Record<string, unknown>): Record<string, unknown> {
  for (const f of ['bold', 'italic', 'underline', 'strike', 'code', 'sup', 'sub', 'caps', 'smallcaps']) if (r.chance(0.15)) o[f] = true
  if (r.chance(0.15)) o.link = r.pick(LINKS)
  if (r.chance(0.12)) o.color = r.pick(COLORS)
  if (r.chance(0.1)) o.comments = r.pick([['c1'], ['c2', 'c1'], ['inconnu'], 'c3'])
  if (r.chance(0.03)) o.comment = 'c2'
  if (r.chance(0.06)) o.inserted = r.pick([{ author: 'Camille', date: '2026-11-09T10:00:00Z' }, { author: '' }, { date: 'pas une date' }])
  if (r.chance(0.06)) o.deleted = r.pick([{ author: 'Sam', date: '2026-11-09' }, {}])
  if (r.chance(0.1)) o.highlight = r.pick(HIGHLIGHTS)
  if (r.chance(0.1)) o.font = r.pick(FONTS)
  if (r.chance(0.1)) o.size = r.pick([8, 10.5, 11, 14, 24])
  if (r.chance(0.05)) o.letterSpacing = r.pick([-0.5, 1, 2.3])
  if (r.chance(0.05)) o.lang = r.pick(['en', 'de-CH', 'fr'])
  return o
}

/** Formules variées : structures, environnements, chimie, couleurs, renvois, et une illisible. */
export const FORMULAS = [
  'E = mc^2',
  'x_i^2 + y_{j,k}',
  '\\frac{a+b}{c-d}',
  '\\sqrt{x^2+1} + \\sqrt[3]{8}',
  '\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}',
  '\\int_0^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}',
  '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1',
  '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
  'f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{sinon} \\end{cases}',
  '\\begin{aligned} a &= b + c \\\\ &= d \\end{aligned}',
  '\\ce{2H2 + O2 -> 2H2O}',
  '\\pu{9.81 m/s^2}',
  '\\left( \\frac{1}{2} \\right)^{n}',
  '\\vec{F} = m\\vec{a}',
  '\\overline{AB} \\perp \\hat{n}',
  '\\mathbb{R}^n \\subseteq \\mathcal{C}',
  '\\textcolor{teal}{x} + \\boxed{y}',
  '\\alpha\\beta\\gamma \\le \\Omega',
  '\\binom{n}{k} p^k (1-p)^{n-k}',
  'a \\eqref{eq1}',
  '\\frac{a}',
]

function runs(r: R): unknown[] {
  const out: unknown[] = []
  const n = r.int(0, 4)
  for (let i = 0; i < n; i++) {
    if (r.chance(0.35)) {
      out.push(text(r))
      continue
    }
    if (r.chance(0.1)) {
      out.push(marks(r, { type: 'field', name: r.pick(FIELDS), ...(r.chance(0.3) ? { format: r.pick(['DD/MM/YYYY', 'HH:mm', 'dddd D MMMM']) } : {}) }))
      continue
    }
    if (r.chance(0.08)) {
      out.push(note(r))
      continue
    }
    if (r.chance(0.06)) {
      out.push(marks(r, { type: 'math', tex: r.pick(FORMULAS) }))
      continue
    }
    out.push(marks(r, { text: text(r) }))
  }
  return out
}

/** Une note : texte, Markdown ou blocs (avec, parfois, ce qui n'y a pas sa place). */
function note(r: R): Record<string, unknown> {
  const kind = r.chance(0.3) ? { kind: r.pick(['end', 'foot', 'endnote']) } : {}
  switch (r.int(0, 4)) {
    case 0:
      return { type: 'note', ...kind, text: text(r) }
    case 1:
      return { type: r.pick(['footnote', 'endnote']), md: '*Source* : ' + text(r) + (r.chance(0.3) ? ' ^[imbriquée]' : '') }
    case 2:
      return {
        type: 'note',
        ...kind,
        blocks: [{ type: 'paragraph', content: [text(r), { type: 'note', text: 'imbriquée' }] }, r.pick([{ type: 'list', items: ['a', 'b'] }, { type: 'heading', level: 2, text: 'h' }, { type: 'quote', blocks: ['q'] }, { type: 'divider' }])],
      }
    case 3:
      return { type: 'note', ...kind, text: '' }
    default:
      return { type: 'note', ...kind, blocks: [{ type: 'code', text: 'x = 1' }, { type: 'table', rows: [['c1', 'c2']] }] }
  }
}

function para(r: R, o: Record<string, unknown>): Record<string, unknown> {
  if (r.chance(0.15)) o.align = r.pick(['left', 'center', 'right', 'justify'])
  if (r.chance(0.08)) o.indent = r.pick([{ left: 36 }, { first: -18, left: 18 }, { right: 12.5 }, { left: 0 }])
  if (r.chance(0.08)) o.spacing = r.pick([{ before: 12 }, { after: 0 }, { before: 6, after: 6 }])
  if (r.chance(0.08)) o.line = r.pick([1, 1.15, 1.5, 2])
  if (r.chance(0.04)) o.keepNext = true
  if (r.chance(0.04)) o.keepLines = true
  if (r.chance(0.03)) o.pageBreakBefore = true
  if (r.chance(0.04)) o.shading = r.pick(COLORS)
  if (r.chance(0.04)) o.border = r.pick(COLORS)
  return o
}

function image(r: R): unknown {
  const img: Record<string, unknown> = { type: 'image', src: r.pick([PNG, GIF, 'asset:logo', 'https://example.org/a.png']) }
  if (r.chance(0.5)) img.alt = 'Un logo'
  if (r.chance(0.4)) img.width = r.pick([0, 120, 240.5])
  if (r.chance(0.1)) img.height = r.pick([0, 80, 300])
  if (r.chance(0.3)) img.align = r.pick(['left', 'center', 'right'])
  if (r.chance(0.3)) img.wrap = r.pick(['none', 'left', 'right'])
  if (r.chance(0.4)) img.caption = r.chance(0.5) ? 'Figure *un*' : runs(r)
  if (r.chance(0.2)) img.crop = { top: 5, left: 10, right: 0, bottom: 2.5 }
  if (r.chance(0.2)) img.rotate = r.pick([90, 180, 270])
  if (r.chance(0.2)) img.flip = r.pick(['h', 'v', 'hv'])
  if (r.chance(0.1)) img.border = '#333333'
  return img
}

function cellBlock(r: R, depth: number): unknown {
  const k = r.int(0, 4)
  if (k === 0) return para(r, { type: 'heading', level: r.int(1, 6), content: runs(r) })
  if (k === 1) return list(r)
  if (k === 2) return { type: 'code', language: r.pick(['', 'js', 'python']), text: text(r) }
  if (k === 3 && r.chance(0.3)) return image(r)
  return block(r, depth + 9) // paragraphe
}

function list(r: R): unknown {
  const items: unknown[] = []
  let level = 0
  const n = r.int(1, 7)
  for (let i = 0; i < n; i++) {
    level = i === 0 ? 0 : Math.max(0, Math.min(8, level + r.int(-2, 1)))
    const it: Record<string, unknown> = { content: runs(r), level }
    if (r.chance(0.3)) it.style = r.pick(['bullet', 'number'])
    if (r.chance(0.1)) it.align = r.pick(['center', 'right'])
    items.push(it)
  }
  const out: Record<string, unknown> = { type: 'list', style: r.pick(['bullet', 'number']), start: r.int(1, 3) === 3 ? r.int(2, 99) : 1, items }
  if (r.chance(0.2)) out.numbering = r.pick(['decimal', 'alpha', 'ROMAN', 'outline'])
  if (r.chance(0.15)) out.bullet = r.pick(['–', '✓', '➤'])
  if (r.chance(0.1)) out.continue = true
  return out
}

function block(r: R, depth: number): unknown {
  const k = depth > 2 ? 0 : r.int(0, 11)
  switch (k) {
    case 1:
      return para(r, { type: 'heading', level: r.int(1, 6), content: runs(r) })
    case 2:
    case 3:
      return list(r)
    case 4:
      return { type: 'quote', blocks: Array.from({ length: r.int(1, 3) }, () => block(r, depth + 1)) }
    case 5:
      return { type: 'code', language: r.pick(['', 'ts', 'json']), text: text(r) + (r.chance(0.5) ? '\n' + text(r) : '') }
    case 6: {
      const cols = r.int(1, 4)
      const rows = Array.from({ length: r.int(1, 4) }, () =>
        Array.from({ length: cols }, () => {
          const c: Record<string, unknown> = { blocks: Array.from({ length: r.int(1, 2) }, () => cellBlock(r, depth + 1)) }
          if (r.chance(0.15)) c.bg = r.pick(COLORS)
          if (r.chance(0.1)) c.valign = r.pick(['middle', 'bottom'])
          return c
        }),
      )
      const t: Record<string, unknown> = { type: 'table', header: r.chance(0.6), rows }
      if (r.chance(0.4)) t.style = r.pick(['grid', 'lines', 'zebra', 'boxed', 'minimal'])
      if (r.chance(0.3)) t.widths = Array.from({ length: cols }, () => r.pick([50, 100, 120.5, 200]))
      if (r.chance(0.2)) t.align = r.pick(['center', 'right'])
      if (r.chance(0.2)) t.firstColumn = true
      if (r.chance(0.1)) t.border = '#cccccc'
      return t
    }
    case 7:
      if (r.chance(0.5)) {
        const tex = r.pick(FORMULAS)
        return { type: 'equation', tex: r.chance(0.2) ? `${tex} \\label{eq${r.int(1, 3)}}` : tex, ...(r.chance(0.4) ? { numbered: true } : {}) }
      }
      return { type: 'divider' }
    case 8:
      return { type: 'pagebreak' }
    case 9:
      return image(r)
    case 10:
      if (r.chance(0.2)) return { type: 'toc', ...(r.chance(0.5) ? { levels: r.int(1, 6) } : {}), ...(r.chance(0.5) ? { title: 'Sommaire' } : {}) }
      if (r.chance(0.5)) {
        return {
          type: 'columns',
          ...(r.chance(0.5) ? { count: r.int(2, 4) } : {}),
          ...(r.chance(0.3) ? { rule: true } : {}),
          ...(r.chance(0.2) ? { gap: 30 } : {}),
          blocks: [block(r, depth + 1), { type: 'columnbreak' }, block(r, depth + 1)],
        }
      }
      return { type: 'paragraph', content: runs(r) }
    default: {
      const p = para(r, { type: 'paragraph', content: runs(r) })
      if (r.chance(0.1)) p.style = r.pick(['title', 'subtitle', 'caption', 'note'])
      return p
    }
  }
}

/** Un document canonique aléatoire (passé par le chargeur). */
export function randomDoc(seed: number): FolioDoc {
  const r = rng(seed)
  const raw: Record<string, unknown> = {
    format: 'folio/doc',
    version: 1,
    meta: {
      title: r.chance(0.7) ? text(r).replace(/\n/g, ' ') : '',
      author: r.chance(0.3) ? 'Camille' : '',
      keywords: r.chance(0.3) ? ['a', 'b'] : [],
      lang: r.pick(['', 'fr', 'en-GB']),
    },
    styles: { note: { name: 'Note', basedOn: 'normal', italic: true, color: 'accent2' } },
    blocks: Array.from({ length: r.int(1, 8) }, () => block(r, 0)),
    assets: { logo: PNG },
  }
  if (r.chance(0.3)) {
    raw.page = r.pick([
      { size: 'Letter' },
      { size: 'A5', orientation: 'landscape', margins: { top: 10, right: 12, bottom: 10, left: 12 } },
      { size: 'custom', width: 120, height: 180, firstPage: true, numberStart: 3, numberFormat: 'roman' },
      { evenOdd: true, background: '#fffbe6', border: 'accent1', header: 8 },
    ])
  }
  if (r.chance(0.3)) raw.headers = { default: [{ md: 'Page {{page}} / {{pages}}', align: 'right' }], ...(r.chance(0.5) ? { first: [image(r)] } : {}) }
  if (r.chance(0.2)) raw.footers = { even: ['pair', { type: 'table', rows: [['a', 'b']] }] }
  if (r.chance(0.25)) {
    const blocks = raw.blocks as unknown[]
    const sec: Record<string, unknown> = { type: 'section', start: r.pick(['page', 'odd', 'even']) }
    if (r.chance(0.5)) sec.numberStart = r.int(1, 5)
    if (r.chance(0.3)) sec.numberFormat = r.pick(['roman', 'decimal'])
    if (r.chance(0.3)) sec.firstPage = r.chance(0.5)
    if (r.chance(0.3)) sec.headers = { default: [{ md: 'Chapitre {{page}}' }], ...(r.chance(0.5) ? { first: [image(r)] } : {}) }
    if (r.chance(0.2)) sec.footers = {}
    blocks.splice(r.int(0, blocks.length), 0, sec)
    // et une section imbriquée (devient un saut de page)
    if (r.chance(0.2)) blocks.push({ type: 'quote', blocks: ['a', { type: 'section' }, 'b'] })
  }
  if (r.chance(0.6)) {
    raw.comments = [
      { id: 'c1', author: 'Camille', date: '2026-11-09T10:00:00Z', text: text(r) },
      { id: 'c2', text: 'Sans auteur ni date', resolved: r.chance(0.5), replies: r.chance(0.5) ? [{ author: 'Sam', date: 'hier', text: 'Réponse' }] : [] },
      { id: 'c3', author: 'Léa', date: '2026-01-02', text: '', replies: [{ text: 'a' }, { author: 'b', text: 'c' }] },
      ...(r.chance(0.2) ? [{ id: 'c1', text: 'doublon' }] : []),
      ...(r.chance(0.2) ? [{ id: 'orphelin', text: 'sur du texte supprimé' }] : []),
    ]
  }
  if (r.chance(0.2)) raw.trackChanges = true
  if (r.chance(0.1)) raw.math = { macros: '\\newcommand{\\R}{\\mathbb{R}}\\DeclareMathOperator{\\tr}{tr}' }
  if (r.chance(0.2)) {
    raw.notes = r.pick([
      { foot: { format: 'symbols' } },
      { foot: { restart: 'page', start: 3 }, end: { format: 'decimal', restart: 'section' } },
      { end: { restart: 'page' } },
      { foot: { format: 'upper-roman' } },
    ])
  }
  if (r.chance(0.15)) raw.headers = { default: [{ type: 'paragraph', content: ['en-tête', { type: 'note', text: 'interdite ici' }] }] }
  if (r.chance(0.3)) raw.theme = r.pick([{ name: 'classic' }, { name: 'modern', colors: { accent1: '#123456' } }, { fonts: { body: 'Georgia' } }])
  if (r.chance(0.2)) (raw.styles as Record<string, unknown>).heading1 = { color: '#aa0000', bold: false }
  if (r.chance(0.1)) raw.fonts = [{ family: 'Ma police', src: 'data:font/woff2;base64,d09GMgABAAAAAA==', weight: 700 }]
  const res = loadDocument(raw, { now: '2026-01-01T00:00:00.000Z' })
  if (!res.ok) throw new Error('générateur : document refusé')
  return res.doc
}
