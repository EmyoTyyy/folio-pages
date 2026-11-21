// Exports en Markdown et en texte brut. Le Markdown suit la syntaxe courante
// (GitHub) : titres, gras, italique, listes, tableaux, notes [^1], formules
// $…$ ; les images sont des fichiers à part (dossier images/), réunis avec le
// texte dans une archive .zip quand il y en a.

import { chartRows } from '../format/chart'
import { diagramBullets } from '../format/diagram'
import { chartMarkdown } from '../format/markdown-out'
import type { Block, FolioDoc, Inline, Run } from '../format/types'
import { isRun } from '../format/types'
import { calloutLabel } from '../format/callout'
import { base64Bytes, generated, imageData, inlineText, isEmptyContent, listLabels, prepareExport, type ExportCommonOptions, type ExportContext } from './common'
import { safeHref } from './html'

const escapeMd = (s: string) => s.replace(/([\\*_`~[\]$<>|#])/g, '\\$1')

export interface MarkdownResult {
  markdown: string
  /** Images à mettre à côté (chemin relatif → octets). */
  files: Record<string, Uint8Array>
}

class MdWriter {
  files: Record<string, Uint8Array> = {}
  private names = new Map<string, string>()

  constructor(private ctx: ExportContext) {}

  private run(r: Run, text: string): string {
    if (r.deleted || !text) return ''
    let s = r.code ? '`' + text.replace(/`/g, 'ˋ') + '`' : escapeMd(text).replace(/\n/g, '  \n')
    if (!s.trim()) return s
    const lead = /^\s*/.exec(s)![0]
    const trail = /\s*$/.exec(s)![0]
    s = s.trim()
    if (r.strike) s = `~~${s}~~`
    if (r.italic) s = `*${s}*`
    if (r.bold) s = `**${s}**`
    if (r.sup) s = `<sup>${s}</sup>`
    if (r.sub) s = `<sub>${s}</sub>`
    const href = r.link ? safeHref(r.link) : null
    if (href) s = `[${s}](${href.replace(/[()\s]/g, encodeURIComponent)})`
    return lead + s + trail
  }

  inline(items: Inline[]): string {
    let out = ''
    for (const x of items) {
      if (isRun(x)) out += this.run(x, x.text)
      else if (x.type === 'math') out += `$${x.tex}$`
      else if (x.type === 'note') {
        const e = this.ctx.noteOf.get(x)
        if (e) out += `[^${e.label.replace(/[^\p{L}\p{N}*†‡§¶‖]/gu, '') || e.id}]`
      } else if (x.type === 'xref') out += `[${escapeMd(this.ctx.refs.text.get(x) ?? '')}](#bm-${x.target})`
      else if (x.type === 'bookmark') out += `<a id="bm-${x.name}"></a>`
      else if (x.type !== 'xe') out += this.run(x as unknown as Run, inlineText([x], this.ctx))
    }
    return out
  }

  private image(b: Extract<Block, { type: 'image' }>): string {
    const d = imageData(b.src, this.ctx.doc)
    let path = ''
    if (d) {
      const id = b.src.slice(6)
      path = this.names.get(id) ?? ''
      if (!path) {
        path = `images/${String(this.names.size + 1).padStart(2, '0')}-${id.replace(/[^\w-]/g, '').slice(0, 30) || 'image'}.${d.ext}`
        this.names.set(id, path)
        this.files[path] = base64Bytes(d.base64)
      }
    } else if (/^https:\/\//.test(b.src)) path = b.src
    else return ''
    const img = `![${escapeMd(b.alt)}](${path.replace(/[()\s]/g, encodeURIComponent)})`
    return b.caption.length ? `${img}\n\n*${this.inline(b.caption).trim()}*` : img
  }

  blocks(blocks: Block[]): string[] {
    const out: string[] = []
    for (const b of blocks) {
      switch (b.type) {
        case 'paragraph':
          if (b.style === 'title') out.push(`# ${this.inline(b.content)}`)
          else if (b.style === 'subtitle') out.push(`*${this.inline(b.content).trim()}*`)
          else out.push(this.inline(b.content))
          break
        case 'heading':
          out.push(`${'#'.repeat(Math.min(6, Math.max(1, b.level)))} ${this.inline(b.content)}`)
          break
        case 'list': {
          const labels = listLabels(b)
          out.push(b.items.map((it, i) => `${'    '.repeat(it.level)}${it.style === 'number' ? `${/^\d+\.$/.test(labels[i]) ? labels[i] : '1.'}` : it.style === 'check' ? (it.checked ? '- [x]' : '- [ ]') : '-'} ${this.inline(it.content)}`).join('\n'))
          break
        }
        case 'quote':
          out.push(
            this.blocks(b.blocks)
              .join('\n\n')
              .split('\n')
              .map((l) => `> ${l}`.trimEnd())
              .join('\n'),
          )
          break
        case 'callout':
          // Alerte GitHub : « > [!NOTE] », avec le titre s'il n'est pas celui par défaut.
          out.push(
            [`[!${b.kind.toUpperCase()}]${b.title ? ` ${b.title}` : ''}`, ...this.blocks(b.blocks).join('\n\n').split('\n')]
              .map((l) => `> ${l}`.trimEnd())
              .join('\n'),
          )
          break
        case 'code':
          out.push(`${'```'}${b.language}\n${b.text}\n${'```'}`)
          break
        case 'equation': {
          const n = this.ctx.eqNumber.get(b)
          out.push(`$$\n${b.tex}${n ? ` \\tag{${n}}` : ''}\n$$`)
          break
        }
        case 'divider':
          out.push('---')
          break
        case 'columns':
          out.push(...this.blocks(b.blocks))
          break
        case 'table': {
          const cell = (blocks: Block[]) => this.blocks(blocks).join(' ').replace(/\n+/g, ' ').replace(/\|/g, '\\|') || ' '
          const width = Math.max(...b.rows.map((r) => r.reduce((n, c) => n + c.colspan, 0)), 1)
          const rows = b.rows.map((r) => {
            const cells = r.flatMap((c) => [cell(c.blocks), ...Array.from({ length: c.colspan - 1 }, () => ' ')])
            while (cells.length < width) cells.push(' ')
            return `| ${cells.join(' | ')} |`
          })
          // Le Markdown veut une ligne d'en-tête : vide si le tableau n'en a pas.
          if (!b.header) rows.unshift(`| ${Array.from({ length: width }, () => ' ').join(' | ')} |`)
          rows.splice(1, 0, `| ${Array.from({ length: width }, () => '---').join(' | ')} |`)
          out.push(rows.join('\n'))
          break
        }
        case 'chart':
          out.push(chartMarkdown(b, this.ctx.doc.meta.lang))
          break
        case 'diagram':
          out.push([b.title ? `**${b.title}**` : '', ...diagramBullets(b)].filter(Boolean).join('\n'))
          break
        case 'image':
          out.push(this.image(b))
          break
        case 'toc':
        case 'figures':
        case 'index':
        case 'authorities':
        case 'glossary':
        case 'abbreviations':
        case 'bibliography': {
          const g = generated(b, this.ctx)
          const parts: string[] = []
          if (g.title) parts.push(`**${escapeMd(g.title)}**`)
          for (const gr of g.groups) {
            if (gr.heading) parts.push(`*${escapeMd(gr.heading)}*`)
            const lines = gr.lines.map((l) => {
              const text = l.pieces.map((p) => (p.bold ? `**${escapeMd(p.text)}**` : p.italic ? `*${escapeMd(p.text)}*` : escapeMd(p.text))).join('')
              const body = b.type === 'toc' && l.href ? `[${text}](${l.href})` : text
              return `${'    '.repeat(l.level)}- ${l.label ? `${escapeMd(l.label)} ` : ''}${body}`
            })
            if (lines.length) parts.push(lines.join('\n'))
          }
          if (!g.groups.some((gr) => gr.lines.length)) parts.push(`*${escapeMd(g.empty)}*`)
          out.push(parts.join('\n\n'))
          break
        }
        default:
          break
      }
    }
    return out.filter((x) => x.trim() !== '')
  }

  notes(): string {
    return this.ctx.notes
      .map((e) => {
        const body = this.blocks(e.note.blocks).join('\n\n').split('\n').join('\n    ')
        return `[^${e.label.replace(/[^\p{L}\p{N}*†‡§¶‖]/gu, '') || e.id}]: ${body}`
      })
      .join('\n')
  }
}

export function toMarkdown(doc: FolioDoc, o: ExportCommonOptions = {}): MarkdownResult {
  const ctx = prepareExport(doc, o)
  const w = new MdWriter(ctx)
  const parts = w.blocks(doc.blocks)
  // Les notes de bas de page et de fin portent des numéros distincts : on évite les doublons d'étiquette.
  const labels = ctx.notes.map((e) => e.label)
  if (new Set(labels).size !== labels.length) ctx.notes.forEach((e, i) => (e.label = String(i + 1)))
  const notes = w.notes()
  const md = (parts.join('\n\n') + (notes ? `\n\n${notes}` : '')).replace(/\n{3,}/g, '\n\n').trim() + '\n'
  return { markdown: md, files: w.files }
}

// --- texte brut -----------------------------------------------------------------------

class TextWriter {
  constructor(private ctx: ExportContext) {}

  inline(items: Inline[]): string {
    let out = ''
    for (const x of items) {
      if (!isRun(x) && x.type === 'note') {
        const e = this.ctx.noteOf.get(x)
        if (e) out += `[${e.label}]`
      } else out += inlineText([x], this.ctx)
    }
    return out
  }

  blocks(blocks: Block[], indent = ''): string[] {
    const out: string[] = []
    const add = (s: string) => out.push(s.split('\n').map((l) => indent + l).join('\n'))
    for (const b of blocks) {
      switch (b.type) {
        case 'paragraph':
          if (!isEmptyContent(b.content)) add(this.inline(b.content))
          break
        case 'heading': {
          const t = this.inline(b.content)
          add(b.level <= 2 ? `${t}\n${(b.level === 1 ? '=' : '-').repeat(Math.min(72, Math.max(3, [...t].length)))}` : t)
          break
        }
        case 'list': {
          const labels = listLabels(b)
          add(b.items.map((it, i) => `${'   '.repeat(it.level)}${labels[i]} ${this.inline(it.content)}`).join('\n'))
          break
        }
        case 'quote':
          out.push(...this.blocks(b.blocks, indent + '    '))
          break
        case 'callout':
          // « REMARQUE : » (espace avant les deux-points en français), puis le contenu en retrait.
          add(`${(b.title || calloutLabel(b.kind, this.ctx.doc.meta.lang)).toUpperCase()}${/^fr\b/i.test(this.ctx.doc.meta.lang) ? ' :' : ':'}`)
          out.push(...this.blocks(b.blocks, indent + '    '))
          break
        case 'code':
          add(b.text.split('\n').map((l) => `    ${l}`).join('\n'))
          break
        case 'equation': {
          const n = this.ctx.eqNumber.get(b)
          add(`    ${b.tex}${n ? `    (${n})` : ''}`)
          break
        }
        case 'divider':
          add('* * *')
          break
        case 'columns':
          out.push(...this.blocks(b.blocks, indent))
          break
        case 'table':
          add(b.rows.map((r) => r.map((c) => this.blocks(c.blocks).join(' ').replace(/\s*\n\s*/g, ' ')).join('\t')).join('\n'))
          break
        case 'chart':
          add([b.title ?? '', ...chartRows(b, this.ctx.doc.meta.lang).map((r) => r.join('\t'))].filter(Boolean).join('\n'))
          break
        case 'diagram':
          add([b.title ?? '', ...diagramBullets(b)].filter(Boolean).join('\n'))
          break
        case 'image': {
          const cap = this.inline(b.caption).trim()
          add(`[${b.alt || cap || 'Image'}]${cap && b.alt ? ` ${cap}` : ''}`)
          break
        }
        case 'toc':
        case 'figures':
        case 'index':
        case 'authorities':
        case 'glossary':
        case 'abbreviations':
        case 'bibliography': {
          const g = generated(b, this.ctx)
          const lines: string[] = []
          if (g.title) lines.push(g.title)
          for (const gr of g.groups) {
            if (gr.heading) lines.push(gr.heading)
            for (const l of gr.lines) lines.push(`${'   '.repeat(l.level)}${l.label ? `${l.label} ` : ''}${l.pieces.map((p) => p.text).join('')}${l.page ? `  ${l.page}` : ''}`)
          }
          if (!g.groups.some((gr) => gr.lines.length)) lines.push(g.empty)
          add(lines.join('\n'))
          break
        }
        default:
          break
      }
    }
    return out
  }
}

export function toPlainText(doc: FolioDoc, o: ExportCommonOptions = {}): string {
  const ctx = prepareExport(doc, o)
  const w = new TextWriter(ctx)
  const parts = w.blocks(doc.blocks)
  if (ctx.notes.length) {
    parts.push(`${ctx.words.notes}\n${'-'.repeat(ctx.words.notes.length)}`)
    for (const e of ctx.notes) parts.push(`[${e.label}] ${w.blocks(e.note.blocks).join('\n')}`)
  }
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
