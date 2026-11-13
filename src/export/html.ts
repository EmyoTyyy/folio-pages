// Export en page web : un fichier .html autonome et sans script (images
// intégrées, formules en MathML, styles du document en CSS), lisible dans
// n'importe quel navigateur et imprimable. Le même rendu, en XHTML, sert au
// livre numérique (EPUB).

import { cssHighlight, HIGHLIGHT_VALUES } from '../format/color'
import { resolveStyle } from '../format/theme'
import type { Block, FolioDoc, Inline, PageSetup, Run, StyleDef } from '../format/types'
import { BUILTIN_STYLE_IDS } from '../format/theme'
import { hasOwn, isRun } from '../format/types'
import { tokenize } from '../editor/highlight'
import { adjustCss, cssText } from '../format/picture'
import { renderTex } from '../math'
import { base64Bytes, generated, imageData, imageSize, inlineText, listLabels, prepareExport, resolveColor, type ExportCommonOptions, type ExportContext, type Piece } from './common'

export interface HtmlOptions extends ExportCommonOptions {
  /** XHTML (EPUB) : balises vides fermées, espaces de noms. */
  xhtml?: boolean
  /** Adresse d'une image du document ; intégrée en data: par défaut. */
  imageHref?: (id: string, mime: string) => string
}

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Caractères interdits en XML (contrôles) retirés. */
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')

/** Largeur du texte d'une page, en points. */
export function textWidthPt(p: PageSetup): number {
  const w = p.orientation === 'landscape' ? p.height : p.width
  return Math.max(72, ((w - p.margins.left - p.margins.right) * 72) / 25.4)
}

const SERIF = /serif|newsreader|georgia|times|garamond|merriweather|lora|playfair|libre baskerville|crimson|cormorant|source serif|pt serif|noto serif|literata|spectral|bitter|charter|cambria|book/i
const MONO = /mono|code|courier|consolas|menlo/i

/** Pile de polices CSS : la police du thème (ou nommée), puis une famille générique proche. */
export function fontStack(name: string | undefined, doc: FolioDoc): string {
  const family = name === 'heading' || name === 'body' || name === 'mono' ? doc.theme.fonts[name] : name
  if (!family) return 'sans-serif'
  const generic = name === 'mono' || MONO.test(family) ? 'ui-monospace, monospace' : SERIF.test(family) ? 'Georgia, serif' : 'system-ui, sans-serif'
  return `'${family.replace(/['\\]/g, '')}', ${generic}`
}

const num = (n: number) => String(Math.round(n * 100) / 100)

/** Déclarations CSS d'un style (ou d'une mise en forme directe). */
function styleCss(d: StyleDef | Run | Record<string, unknown>, doc: FolioDoc, paragraph: boolean): string[] {
  const s = d as StyleDef & Run
  const css: string[] = []
  if (s.font) css.push(`font-family:${fontStack(s.font, doc)}`)
  if (s.size) css.push(`font-size:${num(s.size)}pt`)
  if (s.color) css.push(`color:${resolveColor(s.color, doc)}`)
  if (s.highlight) css.push(`background-color:${hasOwn(HIGHLIGHT_VALUES, s.highlight) ? cssHighlight(s.highlight) : resolveColor(s.highlight, doc, 'transparent')}`)
  if (s.bold === true) css.push('font-weight:700')
  else if (s.bold === false) css.push('font-weight:400')
  if (s.italic === true) css.push('font-style:italic')
  else if (s.italic === false) css.push('font-style:normal')
  const deco = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean)
  if (deco.length) css.push(`text-decoration:${deco.join(' ')}`)
  if (s.caps) css.push('text-transform:uppercase')
  if (s.smallcaps) css.push('font-variant:small-caps')
  if (s.letterSpacing) css.push(`letter-spacing:${num(s.letterSpacing)}pt`)
  const r = d as Run
  if (r.outline) css.push('-webkit-text-stroke:0.045em currentColor', '-webkit-text-fill-color:transparent')
  const shadows = [r.shadow && '0.07em 0.07em 0.1em rgba(0,0,0,.42)', r.glow && `0 0 0.22em ${resolveColor(r.glow, doc)}, 0 0 0.45em ${resolveColor(r.glow, doc)}`].filter(Boolean)
  if (shadows.length) css.push(`text-shadow:${shadows.join(', ')}`)
  if (r.textBorder) css.push(`box-shadow:inset 0 0 0 1px ${resolveColor(r.textBorder, doc)}`, 'padding:0 .12em')
  if (r.textShading && !s.highlight) css.push(`background-color:${resolveColor(r.textShading, doc)}`)
  if (paragraph) {
    if (s.align) css.push(`text-align:${s.align}`)
    if (s.line) css.push(`line-height:${num(s.line)}`)
    if (s.spacing?.before !== undefined) css.push(`margin-top:${num(s.spacing.before)}pt`)
    if (s.spacing?.after !== undefined) css.push(`margin-bottom:${num(s.spacing.after)}pt`)
    if (s.indent?.left) css.push(`margin-left:${num(s.indent.left)}pt`)
    if (s.indent?.right) css.push(`margin-right:${num(s.indent.right)}pt`)
    if (s.indent?.first) css.push(`text-indent:${num(s.indent.first)}pt`)
    if (s.shading) css.push(`background-color:${resolveColor(s.shading, doc, 'transparent')}`)
    if (s.border) css.push(`border:1px solid ${resolveColor(s.border, doc)};padding:4pt 6pt`)
    if (s.keepNext) css.push('break-after:avoid')
    if (s.keepLines) css.push('break-inside:avoid')
    if (s.pageBreakBefore) css.push('break-before:page')
  }
  return css
}

/** Feuille de style du document : thème, styles nommés, tableaux, code, notes. */
export function documentCss(doc: FolioDoc, o: { screen: boolean; fonts?: boolean }): string {
  const rules: string[] = []
  const width = textWidthPt(doc.page)
  for (const f of o.fonts === false ? [] : (doc.fonts ?? [])) {
    const d = imageData(f.src, doc) ?? (f.src.startsWith('asset:') && /^data:font\//.test(doc.assets[f.src.slice(6)] ?? '') ? { mime: '', base64: '', ext: '' } : null)
    const data = f.src.startsWith('asset:') ? doc.assets[f.src.slice(6)] : ''
    if (!d && !data) continue
    if (data && /^data:(font|application)\/[\w.+-]+;base64,/.test(data)) {
      rules.push(`@font-face{font-family:'${f.family.replace(/['\\]/g, '')}';src:url(${data});font-weight:${f.weight};font-style:${f.italic ? 'italic' : 'normal'}${f.unicodeRange ? `;unicode-range:${f.unicodeRange}` : ''}}`)
    }
  }
  const normal = resolveStyle(doc.styles, 'normal')
  const text = resolveColor('text', doc)
  if (o.screen) {
    rules.push(`html{background:#f3f4f2}`)
    rules.push(`body{margin:0;padding:32px 16px}`)
    rules.push(`.folio-page{box-sizing:border-box;max-width:${num(width + 96)}pt;margin:0 auto;padding:48pt;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.12)}`)
    rules.push(`@media (max-width:700px){body{padding:0}.folio-page{padding:20px 16px;box-shadow:none}}`)
    const pw = doc.page.orientation === 'landscape' ? doc.page.height : doc.page.width
    const ph = doc.page.orientation === 'landscape' ? doc.page.width : doc.page.height
    const m = doc.page.margins
    rules.push(`@media print{html{background:none}body{padding:0}.folio-page{max-width:none;padding:0;box-shadow:none}}`)
    rules.push(`@page{size:${num(pw)}mm ${num(ph)}mm;margin:${num(m.top)}mm ${num(m.right)}mm ${num(m.bottom)}mm ${num(m.left)}mm}`)
  }
  rules.push(`.folio-page{color:${text};${styleCss({ ...normal, color: undefined }, doc, true).filter((c) => !c.startsWith('margin')).join(';')};overflow-wrap:break-word}`)
  if (doc.hyphenate) rules.push(`.folio-page{hyphens:auto;-webkit-hyphens:auto}.folio-page pre{hyphens:manual}`)
  rules.push(`.folio-page p{margin:${num(normal.spacing?.before ?? 0)}pt 0 ${num(normal.spacing?.after ?? 7)}pt}`)
  for (let l = 1; l <= 6; l++) rules.push(`.folio-page h${l}{${styleCss(resolveStyle(doc.styles, `heading${l}`), doc, true).join(';')}}`)
  const ids = new Set([...BUILTIN_STYLE_IDS, ...Object.keys(doc.styles)])
  for (const id of ids) {
    if (id === 'normal' || /^heading[1-6]$/.test(id) || !/^[A-Za-z][\w-]*$/.test(id)) continue
    rules.push(`.folio-page .s-${id}{${styleCss(resolveStyle(doc.styles, id), doc, true).join(';')}}`)
  }
  const accent = resolveColor('accent1', doc)
  const code = doc.theme.code
  rules.push(
    `.folio-page a{color:${accent}}`,
    `.folio-page img{max-width:100%;height:auto}`,
    `.folio-page figure{margin:6pt 0 10pt;text-align:center}`,
    `.folio-page figure.left{text-align:left}.folio-page figure.right{text-align:right}`,
    `.folio-page figure.wrap-left{float:left;margin:0 12pt 6pt 0;max-width:50%}.folio-page figure.wrap-right{float:right;margin:0 0 6pt 12pt;max-width:50%}`,
    `.folio-page .crop{display:inline-block;overflow:hidden;vertical-align:top}`,
    `.folio-page .crop img{display:block;max-width:none}`,
    `.folio-page blockquote{margin:6pt 0 10pt 0;padding-left:14pt;border-left:3px solid ${accent}}`,
    `.folio-page pre{margin:4pt 0 10pt;padding:8pt 10pt;border-radius:4px;background:${resolveColor(code.background, doc, '#f6f6f4')};color:${resolveColor(code.text, doc)};font-family:${fontStack('mono', doc)};font-size:${num(resolveStyle(doc.styles, 'code').size ?? 9.5)}pt;line-height:1.5;white-space:pre-wrap}`,
    ...(['keyword', 'string', 'number', 'comment', 'function', 'type'] as const).map((k) => `.folio-page .tok-${k}{color:${resolveColor(code[k], doc)}${k === 'comment' ? ';font-style:italic' : ''}}`),
    `.folio-page code{font-family:${fontStack('mono', doc)};font-size:.92em}`,
    `.folio-page table{border-collapse:collapse;margin:4pt 0 10pt}`,
    `.folio-page td,.folio-page th{padding:3pt 6pt;vertical-align:top;text-align:left}`,
    `.folio-page td>p:last-child,.folio-page th>p:last-child{margin-bottom:0}.folio-page td>p:first-child,.folio-page th>p:first-child{margin-top:0}`,
    `.folio-page table.grid td,.folio-page table.grid th,.folio-page table.boxed th{border:1px solid var(--tb,#b9beb9)}`,
    `.folio-page table.boxed{border:1px solid var(--tb,#b9beb9)}`,
    `.folio-page table.lines tr{border-bottom:1px solid var(--tb,#b9beb9)}`,
    `.folio-page table.zebra tbody tr:nth-child(even){background:color-mix(in srgb,${accent} 7%,#fff)}`,
    `.folio-page table.zebra th,.folio-page table.boxed th{background:color-mix(in srgb,${accent} 14%,#fff)}`,
    `.folio-page table.first-col td:first-child{font-weight:700}`,
    `.folio-page th{font-weight:700}`,
    `.folio-page .equation{display:flex;align-items:center;justify-content:center;gap:12pt;margin:6pt 0 10pt}`,
    `.folio-page .equation .eq-num{margin-left:auto}`,
    `.folio-page .equation math{flex:0 1 auto}`,
    `.folio-page .equation.numbered::before{content:'';margin-right:auto}`,
    `.folio-page .columns>p:first-child{margin-top:0}`,
    `.folio-page .gen-title{font-weight:700;font-size:1.15em;margin-top:12pt}`,
    `.folio-page .gen-line{margin:0 0 3pt;display:flex;gap:6pt}`,
    `.folio-page .gen-line .text{flex:1}`,
    `.folio-page .gen-line.l1{padding-left:14pt}.folio-page .gen-line.l2{padding-left:28pt}.folio-page .gen-line.l3{padding-left:42pt}.folio-page .gen-line.l4{padding-left:56pt}.folio-page .gen-line.l5{padding-left:70pt}`,
    `.folio-page .gen-line .label{min-width:2.4em}`,
    `.folio-page .bib .gen-line .text{padding-left:2em;text-indent:-2em}`,
    `.folio-page hr{border:0;border-top:1px solid #b9beb9;margin:10pt 0}`,
    `.folio-page .page-break{break-after:page}`,
    `.folio-page [data-dropcap]::first-letter{float:left;font-size:calc(var(--fp-dropcap,3) * 1.32em);line-height:.82;margin:.05em .08em 0 0;font-weight:600}`,
    `@supports (initial-letter:2){.folio-page [data-dropcap]::first-letter{float:none;font-size:inherit;line-height:inherit;margin:0 .08em 0 0;initial-letter:var(--fp-dropcap,3)}}`,
    `.folio-page .notes{margin-top:24pt;border-top:1px solid #b9beb9;padding-top:8pt;font-size:.9em}`,
    `.folio-page .notes .note{display:flex;gap:6pt}`,
    `.folio-page .notes .note>div>p{margin:0 0 3pt}`,
    `.folio-page sup.fn{font-size:.75em;line-height:0}`,
    `.folio-page sup.fn a{text-decoration:none}`,
  )
  return rules.join('\n')
}

// --- rendu ---------------------------------------------------------------------

export class HtmlWriter {
  private x: boolean

  constructor(
    readonly ctx: ExportContext,
    private o: HtmlOptions = {},
  ) {
    this.x = !!o.xhtml
  }

  /** Balise vide : <br> ou <br/>. */
  private v(tag: string, attrs = ''): string {
    return this.x ? `<${tag}${attrs}/>` : `<${tag}${attrs}>`
  }

  private attr(name: string, value: string | undefined): string {
    return value === undefined || value === '' ? '' : ` ${name}="${esc(clean(value))}"`
  }

  private text(s: string): string {
    return esc(clean(s)).replace(/\n/g, this.v('br')).replace(/\t/g, '\u2003')
  }

  private math(tex: string, display: boolean): string {
    const r = renderTex(tex, display, this.ctx.math)
    if (!r.html) return `<code class="tex">${this.text(tex)}</code>`
    // En XHTML, un dessin SVG dans la formule garde son espace de noms.
    return this.x ? r.html.replace(/<svg role="img"/g, '<svg xmlns="http://www.w3.org/2000/svg" role="img"') : r.html
  }

  private run(r: Run): string {
    if (r.deleted || !r.text) return ''
    let s = this.text(r.text)
    const css = styleCss({ ...r, bold: undefined, italic: undefined, underline: undefined, strike: undefined }, this.ctx.doc, false)
    if (r.code) s = `<code>${s}</code>`
    if (css.length || r.lang) s = `<span${this.attr('style', css.join(';'))}${this.attr('lang', r.lang)}${this.x && r.lang ? this.attr('xml:lang', r.lang) : ''}>${s}</span>`
    if (r.sup) s = `<sup>${s}</sup>`
    if (r.sub) s = `<sub>${s}</sub>`
    if (r.strike) s = `<s>${s}</s>`
    if (r.underline) {
      const ul = [r.underlineStyle === 'thick' ? 'text-decoration-thickness:.14em' : r.underlineStyle ? `text-decoration-style:${r.underlineStyle === 'dashed' ? 'dashed' : r.underlineStyle}` : '', r.underlineColor ? `text-decoration-color:${resolveColor(r.underlineColor, this.ctx.doc)}` : ''].filter(Boolean)
      s = `<u${this.attr('style', ul.join(';'))}>${s}</u>`
    }
    if (r.italic) s = `<em>${s}</em>`
    if (r.bold) s = `<strong>${s}</strong>`
    if (r.link) {
      const href = safeHref(r.link)
      if (href) s = `<a${this.attr('href', href)}>${s}</a>`
    }
    return s
  }

  inline(items: Inline[]): string {
    let out = ''
    for (const x of items) {
      if (isRun(x)) {
        out += this.run(x)
        continue
      }
      switch (x.type) {
        case 'field':
        case 'seq':
        case 'mergefield':
        case 'cite':
          // Leur mise en forme est celle d'un texte : on les écrit comme un texte.
          out += this.run({ ...(x as unknown as Run), text: inlineText([x], this.ctx), link: undefined } as Run)
          break
        case 'math':
          out += this.math(x.tex, false)
          break
        case 'note': {
          const e = this.ctx.noteOf.get(x)
          if (e) out += `<sup class="fn"><a${this.attr('id', e.refId)}${this.attr('href', `#${e.id}`)}${this.x ? ' epub:type="noteref"' : ' role="doc-noteref"'}>${this.text(e.label)}</a></sup>`
          break
        }
        case 'bookmark':
          out += `<span${this.attr('id', `bm-${x.name}`)}></span>`
          break
        case 'xe':
          out += `<span${this.attr('id', this.ctx.entryId.get(x))}></span>`
          break
        case 'xref':
          out += `<a${this.attr('href', `#bm-${x.target}`)}>${this.run({ ...(x as unknown as Run), text: this.ctx.refs.text.get(x) ?? '', link: undefined } as Run)}</a>`
          break
      }
    }
    return out
  }

  private paraAttrs(b: Record<string, unknown>, cls = ''): string {
    const css = styleCss(b, this.ctx.doc, true)
    const drop = typeof b.dropCap === 'number' ? b.dropCap : 0
    if (drop) css.push(`--fp-dropcap:${drop}`)
    return `${this.attr('class', cls)}${this.attr('style', css.join(';'))}${drop ? this.attr('data-dropcap', String(drop)) : ''}`
  }

  private pieces(p: Piece[]): string {
    return p.map((x) => (x.italic ? `<em>${this.text(x.text)}</em>` : this.text(x.text))).join('')
  }

  private image(b: Extract<Block, { type: 'image' }>): string {
    const d = imageData(b.src, this.ctx.doc)
    let src: string
    if (d) {
      src = this.o.imageHref ? this.o.imageHref(b.src.slice(6), d.mime) : `data:${d.mime};base64,${d.base64}`
      if (!src) return ''
    } else if (/^https:\/\//.test(b.src) && !this.x) src = b.src
    else return ''
    const size = d && d.mime !== 'image/svg+xml' ? imageSize(base64Bytes(d.base64.slice(0, 64_000))) : null
    const maxW = textWidthPt(this.ctx.doc.page)
    const natW = size ? size.width * 0.75 : 0
    const w = b.width || Math.min(natW || maxW, maxW)
    const flips = [b.flip?.includes('h') && 'scaleX(-1)', b.flip?.includes('v') && 'scaleY(-1)', b.rotate && `rotate(${b.rotate}deg)`].filter(Boolean)
    const tf = flips.length ? `transform:${flips.join(' ')}` : ''
    const border = [b.border ? `border:1px solid ${resolveColor(b.border, this.ctx.doc)}` : '', cssText(adjustCss(b.adjust, (c) => resolveColor(c, this.ctx.doc)))].filter(Boolean).join(';')
    let img: string
    const c = b.crop
    if (c && size && (c.top || c.right || c.bottom || c.left)) {
      // Rognage : une fenêtre de la taille rognée, l'image entière décalée dedans.
      const fx = Math.max(0.05, 1 - (c.left + c.right) / 100)
      const fy = Math.max(0.05, 1 - (c.top + c.bottom) / 100)
      const h = b.height || (w * (size.height * fy)) / (size.width * fx)
      const iw = w / fx
      const ih = b.height ? h / fy : (iw * size.height) / size.width
      img = `<span class="crop"${this.attr('style', [`width:${num(w)}pt`, `height:${num(h)}pt`, tf, border].filter(Boolean).join(';'))}>${this.v('img', `${this.attr('src', src)}${this.attr('alt', b.alt)}${this.attr('style', `width:${num(iw)}pt;height:${num(ih)}pt;margin-left:${num((-iw * c.left) / 100)}pt;margin-top:${num((-ih * c.top) / 100)}pt`)}`)}</span>`
    } else {
      const style = [`width:${num(w)}pt`, b.height ? `height:${num(b.height)}pt` : '', tf, border].filter(Boolean).join(';')
      img = this.v('img', `${this.attr('src', src)}${this.attr('alt', b.alt)}${this.attr('style', style)}`)
    }
    const cls = [b.align !== 'center' ? b.align : '', b.wrap !== 'none' ? `wrap-${b.wrap}` : ''].filter(Boolean).join(' ')
    const cap = b.caption.length ? `<figcaption class="s-caption">${this.inline(b.caption)}</figcaption>` : ''
    return `<figure${this.attr('class', cls)}>${img}${cap}</figure>`
  }

  private list(b: Extract<Block, { type: 'list' }>): string {
    const labels = listLabels(b)
    let out = ''
    const stack: string[] = []
    b.items.forEach((it, i) => {
      const tag = it.style === 'number' ? 'ol' : 'ul'
      if (stack.length && it.level < stack.length) {
        while (stack.length - 1 > it.level) out += `</li></${stack.pop()}>`
        out += '</li>'
      }
      while (stack.length <= it.level) {
        const top = stack.length === 0
        const type = it.style === 'number' ? listType(b.numbering ?? 'default', stack.length) : ''
        const start = top && tag === 'ol' && b.start > 1 ? this.attr('start', String(b.start)) : ''
        const bullet = it.style === 'bullet' && b.bullet && stack.length === 0 ? this.attr('style', `list-style-type:'${b.bullet.replace(/['\\]/g, '')} '`) : ''
        out += `<${tag}${type ? this.attr('type', type) : ''}${start}${bullet}>`
        stack.push(tag)
      }
      const css = styleCss(it as unknown as Record<string, unknown>, this.ctx.doc, true)
      out += `<li${this.attr('style', css.join(';'))}${b.numbering === 'outline' && it.style === 'number' ? this.attr('value', labels[i].split('.').filter(Boolean).pop()) : ''}>${this.inline(it.content)}`
    })
    while (stack.length) out += `</li></${stack.pop()}>`
    return out
  }

  private table(b: Extract<Block, { type: 'table' }>): string {
    const cls = [b.style, b.firstColumn ? 'first-col' : ''].filter(Boolean).join(' ')
    const style = [b.border ? `--tb:${resolveColor(b.border, this.ctx.doc)}` : '', b.align === 'center' ? 'margin-left:auto;margin-right:auto' : b.align === 'right' ? 'margin-left:auto' : ''].filter(Boolean).join(';')
    let out = `<table${this.attr('class', cls)}${this.attr('style', style)}>`
    if (b.widths?.length) out += `<colgroup>${b.widths.map((w) => this.v('col', this.attr('style', `width:${num(w)}pt`))).join('')}</colgroup>`
    b.rows.forEach((row, i) => {
      const head = b.header && i === 0
      if (head) out += '<thead>'
      if (i === (b.header ? 1 : 0)) out += '<tbody>'
      out += '<tr>'
      for (const c of row) {
        const tag = head ? 'th' : 'td'
        const cs = [c.bg ? `background-color:${resolveColor(c.bg, this.ctx.doc, 'transparent')}` : '', c.valign && c.valign !== 'top' ? `vertical-align:${c.valign}` : '', b.rowHeight ? `height:${num(b.rowHeight)}pt` : ''].filter(Boolean).join(';')
        out += `<${tag}${c.colspan > 1 ? this.attr('colspan', String(c.colspan)) : ''}${c.rowspan > 1 ? this.attr('rowspan', String(c.rowspan)) : ''}${this.attr('style', cs)}>${this.blocks(c.blocks)}</${tag}>`
      }
      out += '</tr>'
      if (head) out += '</thead>'
    })
    if (b.rows.length > (b.header ? 1 : 0)) out += '</tbody>'
    return out + '</table>'
  }

  private code(b: Extract<Block, { type: 'code' }>): string {
    const text = clean(b.text)
    let body = ''
    let at = 0
    for (const tk of tokenize(text, b.language).slice(0, 20_000)) {
      if (tk.from < at) continue
      body += esc(text.slice(at, tk.from)) + `<span class="tok-${tk.kind}">${esc(text.slice(tk.from, tk.to))}</span>`
      at = tk.to
    }
    body += esc(text.slice(at))
    return `<pre><code${this.attr('class', b.language ? `language-${b.language.replace(/[^\w+#-]/g, '')}` : '')}>${body}</code></pre>`
  }

  private generated(b: Extract<Block, { type: 'toc' | 'figures' | 'index' | 'authorities' | 'bibliography' }>): string {
    const g = generated(b, this.ctx, this.o)
    const tag = b.type === 'toc' ? 'nav' : 'section'
    const role = b.type === 'toc' ? (this.x ? ' epub:type="toc"' : ' role="doc-toc"') : b.type === 'bibliography' ? (this.x ? ' epub:type="bibliography"' : ' role="doc-bibliography"') : b.type === 'index' && this.x ? ' epub:type="index"' : ''
    let out = `<${tag}${this.attr('class', `generated ${b.type === 'bibliography' ? 'bib' : b.type}`)}${role}>`
    if (g.title) out += `<p class="gen-title">${this.text(g.title)}</p>`
    const total = g.groups.reduce((n, gr) => n + gr.lines.length, 0)
    if (!total) out += `<p class="gen-empty">${this.text(g.empty)}</p>`
    for (const gr of g.groups) {
      if (gr.heading) out += `<p class="gen-title">${this.text(gr.heading)}</p>`
      for (const l of gr.lines) {
        const body = this.pieces(l.pieces)
        const text = l.href && b.type !== 'index' ? `<a${this.attr('href', l.href)}>${body}</a>` : l.href ? `<a${this.attr('href', l.href)}>${body}</a>` : body
        out += `<p${this.attr('class', `gen-line l${l.level}`)}>${l.label ? `<span class="label">${this.text(l.label)}</span>` : ''}<span class="text">${text}</span></p>`
      }
    }
    return out + `</${tag}>`
  }

  blocks(blocks: Block[], inQuote = false): string {
    let out = ''
    for (const b of blocks) {
      switch (b.type) {
        case 'paragraph': {
          const style = b.style && b.style !== 'normal' ? `s-${b.style}` : inQuote ? 's-quote' : ''
          const { type: _t, content: _c, style: _s, ...props } = b
          out += `<p${this.paraAttrs(props, style)}>${this.inline(b.content) || (this.x ? '<br/>' : '<br>')}</p>`
          break
        }
        case 'heading': {
          const n = Math.min(6, Math.max(1, b.level))
          const { type: _t, content: _c, level: _l, ...props } = b
          out += `<h${n}${this.attr('id', this.ctx.headingId.get(b))}${this.paraAttrs(props)}>${this.inline(b.content)}</h${n}>`
          break
        }
        case 'list':
          out += this.list(b)
          break
        case 'quote':
          out += `<blockquote>${this.blocks(b.blocks, true)}</blockquote>`
          break
        case 'code':
          out += this.code(b)
          break
        case 'table':
          out += this.table(b)
          break
        case 'divider':
          out += this.v('hr')
          break
        case 'equation': {
          const n = this.ctx.eqNumber.get(b)
          out += `<div${this.attr('class', n ? 'equation numbered' : 'equation')}>${this.math(b.tex, true)}${n ? `<span class="eq-num">(${n})</span>` : ''}</div>`
          break
        }
        case 'pagebreak':
        case 'section':
          out += '<div class="page-break"></div>'
          break
        case 'columns':
          out += `<div class="columns"${this.attr('style', `column-count:${b.count};column-gap:${num(b.gap)}pt${b.rule ? ';column-rule:1px solid #b9beb9' : ''}`)}>${this.blocks(b.blocks, inQuote)}</div>`
          break
        case 'columnbreak':
          out += '<div style="break-after:column"></div>'
          break
        case 'image':
          out += this.image(b)
          break
        case 'toc':
        case 'figures':
        case 'index':
        case 'authorities':
        case 'bibliography':
          out += this.generated(b)
          break
      }
    }
    return out
  }

  /** Les notes, à la fin. */
  notes(): string {
    if (!this.ctx.notes.length) return ''
    let out = `<section class="notes"${this.x ? ' epub:type="endnotes"' : ' role="doc-endnotes"'}><p class="gen-title">${this.text(this.ctx.words.notes)}</p>`
    for (const e of this.ctx.notes) {
      out += `<div class="note"${this.attr('id', e.id)}${this.x ? ' epub:type="endnote"' : ''}><a${this.attr('href', `#${e.refId}`)}${this.x ? '' : ' role="doc-backlink"'}>${this.text(e.label)}</a><div>${this.blocks(e.note.blocks)}</div></div>`
    }
    return out + '</section>'
  }
}

function listType(numbering: string, level: number): string {
  const kind = numbering === 'default' ? (['decimal', 'alpha', 'roman'] as const)[level % 3] : numbering
  return kind === 'alpha' ? 'a' : kind === 'ALPHA' ? 'A' : kind === 'roman' ? 'i' : kind === 'ROMAN' ? 'I' : ''
}

/** Seuls les liens web, de courriel et internes sont gardés. */
export function safeHref(link: string): string | null {
  const l = link.trim()
  if (/^(https?:|mailto:|tel:)/i.test(l)) return l
  if (/^#[\p{L}\p{N}_-]+$/u.test(l)) return `#bm-${l.slice(1)}`
  return null
}

/** Le document en page web autonome. */
export function toHtml(doc: FolioDoc, o: HtmlOptions = {}): string {
  const ctx = prepareExport(doc, o)
  const w = new HtmlWriter(ctx, o)
  const lang = doc.meta.lang || ctx.locale
  const title = doc.meta.title || ''
  const metas = [
    doc.meta.author && `<meta name="author" content="${esc(doc.meta.author)}">`,
    doc.meta.subject && `<meta name="description" content="${esc(doc.meta.subject)}">`,
    doc.meta.keywords.length ? `<meta name="keywords" content="${esc(doc.meta.keywords.join(', '))}">` : '',
  ].filter(Boolean)
  return [
    '<!doctype html>',
    `<html lang="${esc(lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="Folio Pages">',
    ...metas,
    `<title>${esc(title)}</title>`,
    `<style>\n${documentCss(doc, { screen: true })}\n</style>`,
    '</head>',
    '<body>',
    `<article class="folio-page">${w.blocks(doc.blocks)}${w.notes()}</article>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}
