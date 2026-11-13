// Schéma ProseMirror de l'éditeur.
//
// Il correspond exactement au format Folio (src/format/types.ts) : tout ce que
// l'éditeur peut contenir s'écrit dans le fichier, et inversement. Les règles
// parseDOM servent au collage : seuls les éléments connus sont repris, les
// liens dangereux sont refusés, les valeurs sont bornées, et rien d'autre n'est
// interprété.

import { Schema, type Attrs, type DOMOutputSpec, type MarkSpec, type NodeSpec } from 'prosemirror-model'
import { tableNodes } from 'prosemirror-tables'
import { cssColor, cssHighlight, parseHighlight } from '../format/color'
import { LIMITS, isImageSrc, isSafeLink } from '../format/spec'
import { texOfMathDom } from '../math/dom'
import { defaultTheme } from '../format/theme'
import { loadNoteBlocks } from '../format/load'
import { AUTHORITY_CATEGORIES, BOOKMARK_NAME, FIELD_NAMES, MERGE_OPTS, SOURCE_ID, XREF_SHOWS, defaultMath, defaultNotes, defaultPage, emptyHeaders } from '../format/types'
import { colorFromCss, cssFont, familyFromCss, paraCss, ptFromCss, type ParaAttrs } from './css'

const brDOM: DOMOutputSpec = ['br']

const clampPt = (v: number | null, min: number, max: number) => (v === null ? null : Math.min(max, Math.max(min, v)))

/** Attributs de mise en forme de paragraphe (null : suit le style). */
const paraAttrs = {
  align: { default: null },
  indentLeft: { default: null },
  indentRight: { default: null },
  indentFirst: { default: null },
  spaceBefore: { default: null },
  spaceAfter: { default: null },
  line: { default: null },
  keepNext: { default: false },
  keepLines: { default: false },
  pageBreakBefore: { default: false },
  shading: { default: null },
  border: { default: null },
  dropCap: { default: null },
}

export const PARA_ATTR_NAMES = Object.keys(paraAttrs) as (keyof ParaAttrs)[]

/** Ce qu'on reprend d'un paragraphe collé : alignement et retraits (le reste est du bruit de mise en page). */
function paraFromDOM(el: HTMLElement): Partial<ParaAttrs> {
  const s = el.style
  const out: Partial<ParaAttrs> = {}
  const align = s.textAlign
  if (['center', 'right', 'justify'].includes(align)) out.align = align
  const left = clampPt(ptFromCss(s.marginLeft), -300, 1000)
  if (left) out.indentLeft = left
  const first = clampPt(ptFromCss(s.textIndent), -500, 1000)
  if (first) out.indentFirst = first
  return out
}

function paraDOM(tag: string, attrs: Attrs, extra: Record<string, string> = {}): DOMOutputSpec {
  const css = paraCss(attrs as unknown as ParaAttrs)
  const dom: Record<string, string> = { ...extra }
  if (css) dom.style = css
  if (attrs.keepNext) dom['data-keep-next'] = ''
  if (attrs.keepLines) dom['data-keep-lines'] = ''
  if (attrs.pageBreakBefore) dom['data-break-before'] = ''
  if (attrs.dropCap) {
    dom['data-dropcap'] = String(attrs.dropCap)
    dom.style = `${dom.style ? dom.style + ';' : ''}--fp-dropcap:${attrs.dropCap}`
  }
  return [tag, dom, 0]
}

const tables = tableNodes({
  tableGroup: 'block',
  cellContent: 'cell_block+',
  cellAttributes: {
    bg: {
      default: null,
      getFromDOM: (dom) => colorFromCss((dom as HTMLElement).style.backgroundColor) ?? (dom as HTMLElement).getAttribute('data-bg'),
      setDOMAttr: (value, attrs) => {
        if (!value) return
        attrs['data-bg'] = value as string
        attrs.style = `${attrs.style ?? ''}background-color:${cssColor(value as string)};`
      },
    },
    valign: {
      default: null,
      getFromDOM: (dom) => {
        const v = (dom as HTMLElement).style.verticalAlign
        return v === 'middle' || v === 'bottom' ? v : null
      },
      setDOMAttr: (value, attrs) => {
        if (value) attrs.style = `${attrs.style ?? ''}vertical-align:${value};`
      },
    },
  },
})

/** Attributs DOM d'un tableau (aussi utilisés par la vue de tableau de l'éditeur). */
export function tableDOMAttrs(attrs: Attrs): Record<string, string> {
  const out: Record<string, string> = { class: 'fp-table', 'data-table-style': attrs.style }
  if (attrs.align) out['data-align'] = attrs.align
  if (attrs.firstColumn) out['data-first-column'] = ''
  if (attrs.border) out.style = `--fp-table-border:${cssColor(attrs.border)}`
  if (attrs.rowHeight) {
    out['data-row-height'] = ''
    out.style = `${out.style ? out.style + ';' : ''}--fp-row-height:${attrs.rowHeight}pt`
  }
  return out
}

tables.table = {
  ...tables.table,
  attrs: { style: { default: 'grid' }, align: { default: null }, firstColumn: { default: false }, border: { default: null }, rowHeight: { default: null }, repeatHeader: { default: false } },
  parseDOM: [{ tag: 'table', getAttrs: (dom) => ({ style: tableStyleFromDOM(dom as HTMLElement) }) }],
  toDOM: (node) => ['table', tableDOMAttrs(node.attrs), ['tbody', 0]],
}

function tableStyleFromDOM(el: HTMLElement): string {
  const s = el.getAttribute('data-table-style')
  return s && ['grid', 'lines', 'zebra', 'boxed', 'minimal'].includes(s) ? s : 'grid'
}

/** Groupes : « block » partout, « cell_block » ce qui peut aller dans une cellule de tableau. */
const nodes: Record<string, NodeSpec> = {
  doc: {
    // Les sauts de section ne vont qu'au premier niveau.
    content: '(block | section_break)+',
    // Propriétés, thème, styles et polices vivent dans l'état de l'éditeur pour
    // que leurs changements soient annulables comme le reste.
    attrs: {
      title: { default: '' },
      author: { default: '' },
      subject: { default: '' },
      organization: { default: '' },
      keywords: { default: [] },
      lang: { default: '' },
      theme: { default: defaultTheme() },
      /** Mise en page (format Folio), en-têtes et pieds de page (blocs du format, images en « asset:… »). */
      page: { default: defaultPage() },
      headers: { default: emptyHeaders() },
      footers: { default: emptyHeaders() },
      /** Numérotation des notes. */
      notes: { default: defaultNotes() },
      /** Équations : macros communes ({ macros }). */
      math: { default: defaultMath() },
      /** Publipostage (format Folio), ou null. */
      mailMerge: { default: null },
      /** Fils de commentaires (format Folio), ancrés par la marque « comment ». */
      comments: { default: [] },
      /** Suivi des modifications activé. */
      trackChanges: { default: false },
      /** Données des images des en-têtes et pieds de page. */
      hfAssets: { default: {} },
      styles: { default: {} },
      /** Polices intégrées : { family, src (URI data:), weight, italic, assetId } */
      fonts: { default: [] },
      /** Sources citées (format Folio) et style des citations. */
      sources: { default: [] },
      citationStyle: { default: 'apa' },
      /** Césure automatique. */
      hyphenate: { default: false },
      /** Filigrane (format Folio, image en URI data:), ou null. */
      watermark: { default: null },
    },
  },
  paragraph: {
    attrs: { ...paraAttrs, style: { default: null } },
    content: 'inline*',
    group: 'block cell_block',
    parseDOM: [
      {
        tag: 'p',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          const style = el.getAttribute('data-style')
          return { ...paraFromDOM(el), style: style && /^[A-Za-z][\w-]{0,63}$/.test(style) ? style : null }
        },
      },
    ],
    toDOM: (node) => paraDOM('p', node.attrs, node.attrs.style ? { 'data-style': node.attrs.style } : {}),
  },
  heading: {
    attrs: { level: { default: 1 }, ...paraAttrs },
    content: 'inline*',
    group: 'block cell_block',
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      getAttrs: (dom) => ({ level, ...paraFromDOM(dom as HTMLElement) }),
    })),
    toDOM: (node) => paraDOM(`h${node.attrs.level}`, node.attrs),
  },
  blockquote: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', 0],
  },
  code_block: {
    attrs: { language: { default: '' } },
    content: 'text*',
    marks: '',
    group: 'block cell_block',
    code: true,
    defining: true,
    parseDOM: [
      {
        tag: 'pre',
        preserveWhitespace: 'full',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          // data-language (Folio), <code class="language-x"> (GitHub, highlight.js), <pre class="language-x"> (Prism)
          const classes = `${el.querySelector('code')?.className ?? ''} ${el.className}`
          const lang = el.getAttribute('data-language') || /(?:^|\s)(?:language|lang)-([\w+#-]+)/.exec(classes)?.[1] || ''
          return { language: lang.slice(0, 40) }
        },
      },
    ],
    toDOM: (node) => ['pre', node.attrs.language ? { 'data-language': node.attrs.language } : {}, ['code', 0]],
  },
  /** Équation centrée : un atome ; la source LaTeX est dans ses attributs, la vue dessine le MathML. */
  equation: {
    group: 'block cell_block',
    atom: true,
    selectable: true,
    draggable: false,
    attrs: { tex: { default: '' }, numbered: { default: false } },
    parseDOM: [
      {
        tag: 'div[data-equation]',
        getAttrs: (dom) => {
          const tex = ((dom as HTMLElement).getAttribute('data-equation') ?? '').slice(0, LIMITS.tex).trim()
          return tex ? { tex, numbered: (dom as HTMLElement).hasAttribute('data-numbered') } : false
        },
      },
      // MathML collé (centré) : sa source LaTeX si elle l'accompagne, sinon on renonce.
      { tag: 'math[display=block]', getAttrs: (dom) => texOfMathDom(dom as Element) ?? false },
    ],
    toDOM: (node) => ['div', { class: 'fp-equation', 'data-equation': node.attrs.tex, ...(node.attrs.numbered ? { 'data-numbered': '' } : {}) }, `$$${node.attrs.tex}$$`],
  },
  horizontal_rule: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM: () => ['hr'],
  },
  page_break: {
    group: 'block',
    atom: true,
    selectable: true,
    parseDOM: [
      { tag: 'div.fp-page-break' },
      // Saut de page des traitements de texte : <br style="page-break-before:always">
      { tag: 'br', getAttrs: (d) => (/page-break-before:\s*always|break-before:\s*page/.test((d as HTMLElement).getAttribute('style') ?? '') ? null : false), priority: 60 },
    ],
    toDOM: () => ['div', { class: 'fp-page-break', contenteditable: 'false' }],
  },
  columns: {
    attrs: { count: { default: 2 }, gap: { default: 18 }, rule: { default: false } },
    content: '(paragraph | heading | blockquote | code_block | horizontal_rule | equation | bullet_list | ordered_list | table | figure | toc | refblock | column_break)+',
    group: 'block',
    defining: true,
    isolating: true,
    parseDOM: [
      {
        tag: 'div.fp-columns',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          const count = Math.min(6, Math.max(2, parseInt(el.getAttribute('data-count') ?? '2', 10) || 2))
          return { count, gap: 18, rule: el.hasAttribute('data-rule') }
        },
      },
    ],
    toDOM: (node) => [
      'div',
      {
        class: 'fp-columns',
        'data-count': String(node.attrs.count),
        ...(node.attrs.rule ? { 'data-rule': '' } : {}),
        style: `column-count:${node.attrs.count};column-gap:${node.attrs.gap}pt`,
      },
      0,
    ],
  },
  toc: {
    attrs: { levels: { default: 3 }, title: { default: '' } },
    group: 'block',
    atom: true,
    selectable: true,
    parseDOM: [{ tag: 'nav.fp-toc', getAttrs: (dom) => ({ levels: Math.min(6, Math.max(1, Number((dom as HTMLElement).dataset.levels) || 3)) }) }],
    toDOM: (node) => ['nav', { class: 'fp-toc', 'data-levels': String(node.attrs.levels) }],
  },
  /**
   * Liste générée : table des illustrations (figures), index, table des
   * références (authorities), bibliographie. Calculée à l'affichage, comme la
   * table des matières.
   */
  refblock: {
    attrs: { kind: { default: 'index' }, label: { default: 'figure' }, title: { default: '' }, columns: { default: 2 }, category: { default: 'all' }, all: { default: false } },
    group: 'block',
    atom: true,
    selectable: true,
    parseDOM: [
      {
        tag: 'div.fp-refblock',
        getAttrs: (dom) => {
          const kind = (dom as HTMLElement).dataset.kind ?? ''
          return ['figures', 'index', 'authorities', 'bibliography'].includes(kind) ? { kind, title: ((dom as HTMLElement).dataset.title ?? '').slice(0, 200) } : false
        },
      },
    ],
    toDOM: (node) => ['div', { class: 'fp-refblock', 'data-kind': node.attrs.kind, 'data-title': node.attrs.title }],
  },
  section_break: {
    attrs: {
      /** Mise en page de la section ({ size, width, height, orientation, margins }) ; null : celle d'avant. */
      page: { default: null },
      start: { default: 'page' },
      numberStart: { default: null },
      numberFormat: { default: null },
      firstPage: { default: null },
      /** En-têtes et pieds de page de la section (blocs du format) ; null : ceux de la section précédente. */
      headers: { default: null },
      footers: { default: null },
    },
    atom: true,
    selectable: true,
    parseDOM: [{ tag: 'div.fp-section-break', getAttrs: (dom) => ({ start: ['odd', 'even'].includes((dom as HTMLElement).dataset.start ?? '') ? (dom as HTMLElement).dataset.start : 'page' }) }],
    toDOM: (node) => ['div', { class: 'fp-section-break', 'data-start': node.attrs.start, contenteditable: 'false' }],
  },
  column_break: {
    atom: true,
    selectable: true,
    parseDOM: [{ tag: 'div.fp-column-break' }],
    toDOM: () => ['div', { class: 'fp-column-break', contenteditable: 'false' }],
  },
  figure: {
    attrs: {
      src: { default: '' },
      /** Identifiant de la ressource d'origine (gardé d'un enregistrement à l'autre). */
      assetId: { default: null },
      alt: { default: '' },
      width: { default: 0 },
      height: { default: 0 },
      align: { default: 'center' },
      wrap: { default: 'none' },
      crop: { default: null },
      rotate: { default: 0 },
      flip: { default: null },
      border: { default: null },
      adjust: { default: null },
    },
    content: 'inline*',
    group: 'block cell_block',
    draggable: true,
    isolating: true,
    parseDOM: [
      {
        tag: 'figure',
        contentElement: 'figcaption',
        getAttrs: (dom) => {
          const img = (dom as HTMLElement).querySelector('img')
          return img ? imageAttrsFromDOM(img) : false
        },
      },
      {
        tag: 'img[src]',
        getAttrs: (dom) => imageAttrsFromDOM(dom as HTMLElement),
      },
    ],
    toDOM: (node) => {
      const a = node.attrs
      const imgAttrs: Record<string, string> = { src: a.src, alt: a.alt }
      if (a.width) imgAttrs.style = `width:${a.width}pt`
      return [
        'figure',
        { class: 'fp-figure', 'data-align': a.align, 'data-wrap': a.wrap },
        ['img', imgAttrs],
        ['figcaption', 0],
      ]
    },
  },
  bullet_list: {
    attrs: { bullet: { default: null } },
    content: 'list_item+',
    group: 'block cell_block',
    parseDOM: [{ tag: 'ul' }],
    toDOM: (node) => ['ul', node.attrs.bullet ? { style: `list-style-type:"${node.attrs.bullet.replace(/["\\]/g, '')} "`, 'data-bullet': node.attrs.bullet } : {}, 0],
  },
  ordered_list: {
    attrs: { order: { default: 1 }, numbering: { default: null }, continue: { default: false } },
    content: 'list_item+',
    group: 'block cell_block',
    parseDOM: [
      {
        tag: 'ol',
        getAttrs: (dom) => {
          const start = parseInt((dom as HTMLElement).getAttribute('start') ?? '1', 10)
          return { order: Number.isFinite(start) && start >= 1 ? Math.min(start, 1_000_000) : 1 }
        },
      },
    ],
    toDOM: (node) => {
      const attrs: Record<string, string> = {}
      if (node.attrs.order !== 1) attrs.start = String(node.attrs.order)
      if (node.attrs.numbering) attrs['data-numbering'] = node.attrs.numbering
      if (node.attrs.numbering === 'outline') attrs.style = `counter-reset:fp-outline ${node.attrs.order - 1}`
      return ['ol', attrs, 0]
    },
  },
  list_item: {
    // Un paragraphe, puis d'éventuelles sous-listes : la forme plate du format.
    content: 'paragraph (bullet_list | ordered_list)*',
    defining: true,
    parseDOM: [{ tag: 'li' }],
    toDOM: () => ['li', 0],
  },
  ...tables,
  text: { group: 'inline' },
  field: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { name: { default: 'page' }, format: { default: '' } },
    parseDOM: [
      {
        tag: 'span[data-field]',
        getAttrs: (dom) => {
          const name = (dom as HTMLElement).getAttribute('data-field') ?? ''
          if (!(FIELD_NAMES as readonly string[]).includes(name)) return false
          return { name, format: ((dom as HTMLElement).getAttribute('data-format') ?? '').slice(0, 60) }
        },
      },
    ],
    toDOM: (node) => ['span', { class: 'fp-field', 'data-field': node.attrs.name, 'data-format': node.attrs.format }, `{{${node.attrs.name}}}`],
  },
  /**
   * Appel de note (de bas de page ou de fin) : un atome dont le contenu (blocs du
   * format) est dans ses attributs ; son numéro est calculé (décoration).
   */
  note: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { kind: { default: 'foot' }, blocks: { default: [] } },
    leafText: () => '',
    parseDOM: [
      {
        tag: 'sup[data-note]',
        // Avant la marque « exposant » (règle « sup »), qui le prendrait sinon.
        priority: 60,
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          let raw: unknown = []
          try {
            raw = JSON.parse(el.getAttribute('data-blocks') ?? '[]')
          } catch {
            raw = []
          }
          const blocks = loadNoteBlocks(raw, el.textContent ?? '')
          return { kind: el.getAttribute('data-note') === 'end' ? 'end' : 'foot', blocks }
        },
      },
    ],
    toDOM: (node) => ['sup', { class: `fp-note-ref fp-note-ref--${node.attrs.kind}`, 'data-note': node.attrs.kind, 'data-blocks': JSON.stringify(node.attrs.blocks) }],
  },
  /** Champ de fusion (publipostage) : un atome ; la vue montre «Nom» ou la valeur du destinataire. */
  mergefield: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { name: { default: '' }, opts: { default: null } },
    leafText: (node) => `«${node.attrs.name}»`,
    parseDOM: [
      {
        tag: 'span[data-merge]',
        getAttrs: (dom) => {
          const name = ((dom as HTMLElement).getAttribute('data-merge') ?? '').slice(0, 80).trim()
          if (!name) return false
          let opts: Record<string, string> | null = null
          try {
            const raw = JSON.parse((dom as HTMLElement).getAttribute('data-opts') ?? 'null')
            if (raw && typeof raw === 'object') {
              opts = {}
              for (const k of MERGE_OPTS) if (typeof raw[k] === 'string') opts[k] = String(raw[k]).slice(0, 2000)
            }
          } catch {
            opts = null
          }
          return { name, opts }
        },
      },
    ],
    toDOM: (node) => ['span', { class: 'fp-merge', 'data-merge': node.attrs.name, ...(node.attrs.opts ? { 'data-opts': JSON.stringify(node.attrs.opts) } : {}) }, `«${node.attrs.name}»`],
  },
  /** Numéro de légende (« Figure 3 ») : calculé par étiquette, dans l'ordre du document. */
  seq: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { label: { default: 'figure' } },
    leafText: () => '#',
    parseDOM: [{ tag: 'span[data-seq]', getAttrs: (dom) => ({ label: ((dom as HTMLElement).getAttribute('data-seq') ?? '').slice(0, 40).trim() || 'figure' }) }],
    toDOM: (node) => ['span', { class: 'fp-seq', 'data-seq': node.attrs.label }, '#'],
  },
  /** Signet : point nommé, invisible (montré avec les marques de mise en forme). */
  bookmark: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: false,
    marks: '',
    attrs: { name: { default: '' } },
    leafText: () => '',
    parseDOM: [
      {
        tag: 'span[data-bookmark]',
        getAttrs: (dom) => {
          const name = (dom as HTMLElement).getAttribute('data-bookmark') ?? ''
          return BOOKMARK_NAME.test(name) ? { name } : false
        },
      },
    ],
    toDOM: (node) => ['span', { class: 'fp-bookmark', 'data-bookmark': node.attrs.name, id: `bm-${node.attrs.name}` }],
  },
  /** Renvoi vers un signet. */
  xref: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { target: { default: '' }, show: { default: 'text' } },
    leafText: () => '',
    parseDOM: [
      {
        tag: 'span[data-xref]',
        getAttrs: (dom) => {
          const target = (dom as HTMLElement).getAttribute('data-xref') ?? ''
          const show = (dom as HTMLElement).getAttribute('data-show') ?? 'text'
          return BOOKMARK_NAME.test(target) ? { target, show: (XREF_SHOWS as readonly string[]).includes(show) ? show : 'text' } : false
        },
      },
    ],
    toDOM: (node) => ['span', { class: 'fp-xref', 'data-xref': node.attrs.target, 'data-show': node.attrs.show }],
  },
  /** Entrée d'index ou de table des références : invisible (montrée avec les marques de mise en forme). */
  xe: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    marks: '',
    attrs: { term: { default: '' }, sub: { default: '' }, see: { default: '' }, bold: { default: false }, italic: { default: false }, authority: { default: null }, short: { default: '' } },
    leafText: () => '',
    parseDOM: [
      {
        tag: 'span[data-xe]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          const term = (el.getAttribute('data-xe') ?? '').slice(0, 300).trim()
          if (!term) return false
          const authority = el.getAttribute('data-authority')
          return {
            term,
            sub: (el.getAttribute('data-sub') ?? '').slice(0, 300),
            see: (el.getAttribute('data-see') ?? '').slice(0, 300),
            authority: authority && (AUTHORITY_CATEGORIES as readonly string[]).includes(authority) ? authority : null,
            short: (el.getAttribute('data-short') ?? '').slice(0, 300),
          }
        },
      },
    ],
    toDOM: (node) => [
      'span',
      {
        class: 'fp-xe',
        'data-xe': node.attrs.term,
        ...(node.attrs.sub ? { 'data-sub': node.attrs.sub } : {}),
        ...(node.attrs.see ? { 'data-see': node.attrs.see } : {}),
        ...(node.attrs.authority ? { 'data-authority': node.attrs.authority } : {}),
        ...(node.attrs.short ? { 'data-short': node.attrs.short } : {}),
      },
    ],
  },
  /** Citation de sources : son texte dépend du style du document. */
  cite: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { ids: { default: [] }, locator: { default: '' } },
    leafText: () => '',
    parseDOM: [
      {
        tag: 'span[data-cite]',
        getAttrs: (dom) => {
          const ids = ((dom as HTMLElement).getAttribute('data-cite') ?? '').split(/\s+/).filter((x) => SOURCE_ID.test(x)).slice(0, 20)
          return ids.length ? { ids, locator: ((dom as HTMLElement).getAttribute('data-locator') ?? '').slice(0, 60) } : false
        },
      },
    ],
    toDOM: (node) => ['span', { class: 'fp-cite', 'data-cite': (node.attrs.ids as string[]).join(' '), ...(node.attrs.locator ? { 'data-locator': node.attrs.locator } : {}) }],
  },
  /** Formule en ligne : un atome, source LaTeX en attribut. */
  math: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    // Sa mise en forme est dans le LaTeX : seulement les commentaires.
    marks: 'comment',
    attrs: { tex: { default: '' } },
    leafText: (node) => `$${node.attrs.tex}$`,
    parseDOM: [
      {
        tag: 'span[data-math]',
        getAttrs: (dom) => {
          const tex = ((dom as HTMLElement).getAttribute('data-math') ?? '').slice(0, LIMITS.tex).trim()
          return tex ? { tex } : false
        },
      },
      { tag: 'math', getAttrs: (dom) => texOfMathDom(dom as Element) ?? false },
      // Formules copiées d'une page web : la copie visuelle (KaTeX) et l'image de repli
      // (Wikipédia) doublent la formule MathML, qui suffit.
      { tag: '.katex-html', ignore: true, priority: 70 },
      { tag: 'img.mwe-math-fallback-image-inline', ignore: true, priority: 70 },
      { tag: 'img.mwe-math-fallback-image-display', ignore: true, priority: 70 },
    ],
    toDOM: (node) => ['span', { class: 'fp-math', 'data-math': node.attrs.tex }, `$${node.attrs.tex}$`],
  },
  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => brDOM,
  },
}

/** Identifiant de commentaire relu (sinon la marque est ignorée). */
const idAttr = (id: string | null) => (id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? { id } : false)

/** Auteur et date d'une modification suivie relus du HTML, bornés. */
const changeAttrs = (el: HTMLElement) => ({ author: (el.getAttribute('data-author') ?? '').slice(0, 100), date: (el.getAttribute('data-date') ?? '').slice(0, 40) })

/** Infobulle d'une modification suivie : auteur · date (sans dépendre de la langue). */
const changeTitle = (a: Attrs) => [a.author, typeof a.date === 'string' ? a.date.slice(0, 16).replace('T', ' ') : ''].filter(Boolean).join(' · ')

/** Image collée : seulement une source sûre ; les dimensions des traitements de texte sont reprises. */
function imageAttrsFromDOM(img: HTMLElement): Attrs | false {
  const src = img.getAttribute('src') ?? ''
  if (!isImageSrc(src)) return false
  const w = ptFromCss(img.style.width) ?? (img.getAttribute('width') ? Number(img.getAttribute('width')) * 0.75 : null)
  return {
    src,
    alt: (img.getAttribute('alt') ?? '').slice(0, 2000),
    width: w && w > 0 ? Math.min(2000, Math.round(w * 2) / 2) : 0,
  }
}

const marks: Record<string, MarkSpec> = {
  /**
   * Ancre d'un commentaire. Plusieurs commentaires peuvent porter sur le même
   * texte (excludes vide). Relue depuis le HTML de l'éditeur lui-même (le
   * navigateur réécrit parfois le texte, qu'il faut relire sans perdre les
   * marques) ; un collage les retire (paste.ts). Le surlignage ne s'imprime pas.
   */
  comment: {
    attrs: { id: {} },
    inclusive: false,
    excludes: '',
    parseDOM: [{ tag: 'span.fp-comment[data-comment]', getAttrs: (el) => idAttr((el as HTMLElement).getAttribute('data-comment')) }],
    toDOM: (m) => ['span', { class: 'fp-comment', 'data-comment': m.attrs.id }, 0],
  },
  /**
   * Suivi des modifications : texte ajouté et texte supprimé, avec l'auteur et
   * la date. Jamais relus depuis du HTML (un collage n'apporte pas de
   * modification suivie : il en devient une s'il est fait avec le suivi).
   */
  insertion: {
    attrs: { author: { default: '' }, date: { default: '' } },
    inclusive: false,
    parseDOM: [{ tag: 'ins.fp-ins', getAttrs: (el) => changeAttrs(el as HTMLElement) }],
    toDOM: (m) => ['ins', { class: 'fp-ins', 'data-author': m.attrs.author, 'data-date': m.attrs.date, title: changeTitle(m.attrs) }, 0],
  },
  deletion: {
    attrs: { author: { default: '' }, date: { default: '' } },
    inclusive: false,
    parseDOM: [{ tag: 'del.fp-del', getAttrs: (el) => changeAttrs(el as HTMLElement) }],
    toDOM: (m) => ['del', { class: 'fp-del', 'data-author': m.attrs.author, 'data-date': m.attrs.date, title: changeTitle(m.attrs) }, 0],
  },
  link: {
    attrs: { href: {} },
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (dom) => {
          const href = (dom as HTMLElement).getAttribute('href') ?? ''
          return isSafeLink(href) && href.length <= 2048 ? { href } : false
        },
      },
    ],
    toDOM: (mark) => ['a', { href: mark.attrs.href, rel: 'noopener noreferrer', target: '_blank' }, 0],
  },
  bold: {
    parseDOM: [
      { tag: 'strong' },
      // Google Docs enveloppe tout dans <b style="font-weight:normal">
      { tag: 'b', getAttrs: (n) => (n as HTMLElement).style.fontWeight !== 'normal' && null },
      { style: 'font-weight=400', clearMark: (m) => m.type.name === 'bold' },
      { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[5-9]\d{2,})$/.test(v as string) && null },
    ],
    toDOM: () => ['strong', 0],
  },
  italic: {
    parseDOM: [
      { tag: 'i' },
      { tag: 'em' },
      { style: 'font-style=italic' },
      { style: 'font-style=normal', clearMark: (m) => m.type.name === 'italic' },
    ],
    toDOM: () => ['em', 0],
  },
  // Style et couleur du soulignement : avant « underline », pour envelopper le <u> qui dessine le trait.
  underline_style: {
    attrs: { value: {} },
    parseDOM: [{ tag: 'span[data-ul-style]', getAttrs: (d) => (/^(double|thick|dotted|dashed|wavy)$/.test((d as HTMLElement).getAttribute('data-ul-style') ?? '') ? { value: (d as HTMLElement).getAttribute('data-ul-style') } : false) }],
    toDOM: (m) => ['span', { class: 'fp-ul-style', 'data-ul-style': m.attrs.value }, 0],
  },
  underline_color: {
    attrs: { value: {} },
    parseDOM: [{ tag: 'span[data-ul-color]', getAttrs: (d) => (colorFromCss((d as HTMLElement).getAttribute('data-ul-color') ?? '') ? { value: (d as HTMLElement).getAttribute('data-ul-color') } : false) }],
    toDOM: (m) => ['span', { style: `--fp-ul-color:${cssColor(m.attrs.value)}`, 'data-ul-color': m.attrs.value }, 0],
  },
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration-line=underline' }, { style: 'text-decoration=underline' }],
    toDOM: () => ['u', 0],
  },
  strike: {
    parseDOM: [
      { tag: 's' },
      { tag: 'del' },
      { tag: 'strike' },
      { style: 'text-decoration-line=line-through' },
      { style: 'text-decoration=line-through' },
    ],
    toDOM: () => ['s', 0],
  },
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
  },
  sup: {
    excludes: 'sup sub',
    parseDOM: [{ tag: 'sup' }, { style: 'vertical-align=super' }],
    toDOM: () => ['sup', 0],
  },
  sub: {
    excludes: 'sup sub',
    parseDOM: [{ tag: 'sub' }, { style: 'vertical-align=sub' }],
    toDOM: () => ['sub', 0],
  },
  caps: {
    parseDOM: [{ style: 'text-transform=uppercase' }],
    toDOM: () => ['span', { class: 'fp-caps' }, 0],
  },
  smallcaps: {
    parseDOM: [{ style: 'font-variant=small-caps' }, { style: 'font-variant-caps=small-caps' }],
    toDOM: () => ['span', { class: 'fp-smallcaps' }, 0],
  },
  outline: {
    parseDOM: [{ tag: 'span.fp-outline' }],
    toDOM: () => ['span', { class: 'fp-outline' }, 0],
  },
  shadow: {
    parseDOM: [{ tag: 'span.fp-shadow' }],
    toDOM: () => ['span', { class: 'fp-shadow' }, 0],
  },
  glow: {
    attrs: { value: {} },
    parseDOM: [{ tag: 'span[data-glow]', getAttrs: (d) => ({ value: (d as HTMLElement).getAttribute('data-glow') }) }],
    toDOM: (m) => ['span', { class: 'fp-glow', style: `--fp-glow:${cssColor(m.attrs.value)}`, 'data-glow': m.attrs.value }, 0],
  },
  text_border: {
    attrs: { value: {} },
    parseDOM: [{ tag: 'span[data-text-border]', getAttrs: (d) => ({ value: (d as HTMLElement).getAttribute('data-text-border') }) }],
    toDOM: (m) => ['span', { class: 'fp-text-border', style: `--fp-tb:${cssColor(m.attrs.value)}`, 'data-text-border': m.attrs.value }, 0],
  },
  text_shading: {
    attrs: { value: {} },
    parseDOM: [{ tag: 'span[data-text-shading]', getAttrs: (d) => ({ value: (d as HTMLElement).getAttribute('data-text-shading') }) }],
    toDOM: (m) => ['span', { class: 'fp-text-shading', style: `background-color:${cssColor(m.attrs.value)}`, 'data-text-shading': m.attrs.value }, 0],
  },
  color: {
    attrs: { value: {} },
    parseDOM: [
      {
        style: 'color',
        getAttrs: (v) => {
          const c = colorFromCss(v as string)
          // Le noir imposé par les copier-coller de traitements de texte est du bruit.
          return c && c !== '#000000' ? { value: c } : false
        },
      },
      { tag: 'span[data-color]', getAttrs: (d) => ({ value: (d as HTMLElement).getAttribute('data-color') }) },
    ],
    toDOM: (m) => ['span', { style: `color:${cssColor(m.attrs.value)}`, 'data-color': m.attrs.value }, 0],
  },
  highlight: {
    attrs: { value: {} },
    parseDOM: [
      { tag: 'mark', getAttrs: (d) => ({ value: parseHighlight((d as HTMLElement).getAttribute('data-highlight') ?? '') ?? 'yellow' }) },
      {
        style: 'background-color',
        getAttrs: (v) => {
          const c = colorFromCss(v as string)
          return c && c !== '#ffffff' ? { value: c } : false
        },
      },
    ],
    toDOM: (m) => ['mark', { style: `background-color:${cssHighlight(m.attrs.value)}`, 'data-highlight': m.attrs.value }, 0],
  },
  font: {
    attrs: { family: {} },
    parseDOM: [
      { tag: 'span[data-font]', getAttrs: (d) => ({ family: (d as HTMLElement).getAttribute('data-font') }) },
      {
        style: 'font-family',
        getAttrs: (v) => {
          const f = familyFromCss(v as string)
          return f ? { family: f } : false
        },
      },
    ],
    toDOM: (m) => ['span', { style: `font-family:${cssFont(m.attrs.family)}`, 'data-font': m.attrs.family }, 0],
  },
  size: {
    attrs: { pt: {} },
    parseDOM: [
      {
        style: 'font-size',
        getAttrs: (v) => {
          const pt = ptFromCss(v as string)
          return pt && pt >= 1 && pt <= 400 ? { pt } : false
        },
      },
    ],
    toDOM: (m) => ['span', { style: `font-size:${m.attrs.pt}pt` }, 0],
  },
  letter_spacing: {
    attrs: { pt: {} },
    parseDOM: [
      {
        style: 'letter-spacing',
        getAttrs: (v) => {
          const pt = ptFromCss(v as string)
          return pt && pt >= -20 && pt <= 100 ? { pt } : false
        },
      },
    ],
    toDOM: (m) => ['span', { style: `letter-spacing:${m.attrs.pt}pt` }, 0],
  },
  lang: {
    attrs: { tag: {} },
    parseDOM: [
      {
        tag: 'span[lang]',
        getAttrs: (d) => {
          const tag = (d as HTMLElement).getAttribute('lang') ?? ''
          return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(tag) && tag.length <= 35 ? { tag } : false
        },
      },
    ],
    toDOM: (m) => ['span', { lang: m.attrs.tag }, 0],
  },
}

export const schema = new Schema({ nodes, marks })

/** Marques sans valeur : même nom dans l'éditeur et dans le format. */
export const FLAG_MARKS = ['bold', 'italic', 'underline', 'strike', 'code', 'sup', 'sub', 'caps', 'smallcaps', 'outline', 'shadow'] as const

/** Marques avec valeur : nom dans le format → [marque de l'éditeur, attribut]. */
export const VALUE_MARKS = {
  link: ['link', 'href'],
  color: ['color', 'value'],
  highlight: ['highlight', 'value'],
  font: ['font', 'family'],
  size: ['size', 'pt'],
  letterSpacing: ['letter_spacing', 'pt'],
  lang: ['lang', 'tag'],
  underlineStyle: ['underline_style', 'value'],
  underlineColor: ['underline_color', 'value'],
  glow: ['glow', 'value'],
  textBorder: ['text_border', 'value'],
  textShading: ['text_shading', 'value'],
} as const
