// Blocs Folio → Markdown (pour envoyer un passage à une IA, qui le rend en
// Markdown). Le sous-ensemble que relit parseMarkdown : titres, paragraphes,
// listes, citations, code, tableaux, équations, gras, italique, code, liens,
// barré, formules. Le reste (images, notes, champs) est laissé de côté ou réduit
// à son texte.

import type { Block, Inline } from './types'
import { isRun } from './types'

const escapeMd = (s: string) => s.replace(/([\\*_`~[\]$])/g, '\\$1')

export function inlineMarkdown(items: Inline[]): string {
  let out = ''
  for (const x of items) {
    if (!isRun(x)) {
      if (x.type === 'math') out += `$${x.tex}$`
      else if (x.type === 'field') out += `{{${x.name}${x.format ? ':' + x.format : ''}}}`
      continue
    }
    if (x.deleted) continue
    let s = x.code ? `\`${x.text.replace(/`/g, '')}\`` : escapeMd(x.text).replace(/\n/g, '  \n')
    if (!s.trim()) {
      out += s
      continue
    }
    // Les marques entourent le texte sans ses espaces de bord (« ** gras** » n'est pas du gras).
    const lead = /^\s*/.exec(s)![0]
    const trail = /\s*$/.exec(s)![0]
    s = s.trim()
    if (x.strike) s = `~~${s}~~`
    if (x.italic) s = `*${s}*`
    if (x.bold) s = `**${s}**`
    if (x.link && /^(https?:|mailto:|#)/.test(x.link)) s = `[${s}](${x.link})`
    out += lead + s + trail
  }
  return out
}

export function blocksToMarkdown(blocks: Block[]): string {
  const out: string[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'paragraph':
        out.push(inlineMarkdown(b.content))
        break
      case 'heading':
        out.push(`${'#'.repeat(Math.min(6, Math.max(1, b.level)))} ${inlineMarkdown(b.content)}`)
        break
      case 'list': {
        const counters: number[] = []
        out.push(
          b.items
            .map((it) => {
              counters.length = it.level + 1
              counters[it.level] = (counters[it.level] ?? (it.level === 0 ? b.start - 1 : 0)) + 1
              const mark = it.style === 'number' ? `${counters[it.level]}.` : '-'
              return `${'   '.repeat(it.level)}${mark} ${inlineMarkdown(it.content)}`
            })
            .join('\n'),
        )
        break
      }
      case 'quote':
        out.push(
          blocksToMarkdown(b.blocks)
            .split('\n')
            .map((l) => `> ${l}`.trimEnd())
            .join('\n'),
        )
        break
      case 'code':
        out.push(`\`\`\`${b.language}\n${b.text}\n\`\`\``)
        break
      case 'equation':
        out.push(`$$${b.tex}$$`)
        break
      case 'divider':
        out.push('---')
        break
      case 'columns':
        out.push(blocksToMarkdown(b.blocks))
        break
      case 'table': {
        const rows = b.rows.map((r) => `| ${r.map((c) => blocksToMarkdown(c.blocks).replace(/\n+/g, ' ').replace(/\|/g, '\\|')).join(' | ')} |`)
        if (rows.length) rows.splice(1, 0, `| ${b.rows[0].map(() => '---').join(' | ')} |`)
        out.push(rows.join('\n'))
        break
      }
      default:
        break
    }
  }
  return out.filter((x) => x !== '').join('\n\n')
}
