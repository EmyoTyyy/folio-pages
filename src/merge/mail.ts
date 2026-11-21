// Envoi des messages du publipostage, sans serveur : Folio Pages prépare les
// messages, le logiciel de messagerie de l'utilisateur les envoie.
//
// - lien mailto: (texte brut ; la longueur d'une adresse est limitée, le corps
//   est donc copié dans le presse-papiers quand il est trop long) ;
// - lien de rédaction d'une messagerie web (Gmail, Outlook.com) ;
// - brouillons .eml (HTML mis en forme + texte brut, images jointes), marqués
//   « X-Unsent: 1 » : la messagerie les ouvre comme des messages à envoyer.
//
// Tout est pur (sans DOM) pour être testé à part.

import { cssHighlight, HIGHLIGHT_VALUES } from '../format/color'
import type { Block, Inline, Theme } from '../format/types'
import { isRun } from '../format/types'
import { CALLOUT_COLORS, calloutLabel } from '../format/callout'
import type { EmailMessage } from './engine'

/** Au-delà, un lien mailto: risque d'être tronqué ou refusé par le système. */
export const MAILTO_MAX = 1800

export const WEBMAILS = ['app', 'gmail', 'outlook'] as const
export type Webmail = (typeof WEBMAILS)[number]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Adresse électronique plausible (une seule, sans espace ni séparateur). */
export const isEmail = (s: string): boolean => /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(s.trim())

/** Au plus autant d'adresses dans un même message. */
export const MAX_ADDRESSES = 100

/**
 * Adresses tapées à la main (« a@x.fr, b@y.fr ; c@z.fr ») : les valides, sans
 * doublon, et celles à corriger. On accepte aussi « Nom <adresse> ».
 */
export function parseAddresses(text: string): { ok: string[]; bad: string[] } {
  const ok: string[] = []
  const bad: string[] = []
  const seen = new Set<string>()
  for (const raw of text.slice(0, 20000).split(/[,;\n]+/)) {
    const part = raw.trim()
    if (!part) continue
    const a = (/<([^<>]+)>\s*$/.exec(part)?.[1] ?? part).trim()
    if (!isEmail(a)) {
      bad.push(part.slice(0, 200))
      continue
    }
    const k = a.toLowerCase()
    if (seen.has(k) || ok.length >= MAX_ADDRESSES) continue
    seen.add(k)
    ok.push(a)
  }
  return { ok, bad }
}

/** Lien de rédaction : vers la messagerie de l'ordinateur, ou une messagerie web. */
export function composeUrl(how: Webmail, m: { to: string; cc?: string; subject: string; body: string }, withBody = true): string {
  const to = m.to.trim()
  const cc = m.cc?.trim() ?? ''
  const body = withBody ? m.body : ''
  const q = (k: string, v: string) => (v ? `${k}=${encodeURIComponent(v)}` : '')
  const join = (...parts: string[]) => parts.filter(Boolean).join('&')
  if (how === 'gmail') return `https://mail.google.com/mail/?${join('view=cm', 'fs=1', q('to', to), q('cc', cc), q('su', m.subject), q('body', body))}`
  if (how === 'outlook') return `https://outlook.live.com/mail/0/deeplink/compose?${join(q('to', to), q('cc', cc), q('subject', m.subject), q('body', body))}`
  const params = join(q('cc', cc), q('subject', m.subject), q('body', body))
  // Plusieurs destinataires : séparés par des virgules, laissées telles quelles (RFC 6068).
  const addr = encodeURIComponent(to).replace(/%40/g, '@').replace(/%2C/g, ',').replace(/%20/g, '')
  return `mailto:${addr}${params ? `?${params}` : ''}`
}

/** Le corps tient-il dans le lien ? Sinon on le copie et on ouvre le message sans corps. */
export const fitsInUrl = (m: { body: string }): boolean => encodeURIComponent(m.body).length <= MAILTO_MAX * 3 && m.body.length <= MAILTO_MAX

// --- corps HTML ---------------------------------------------------------------------

export interface HtmlContext {
  theme?: Theme
  assets?: Record<string, string>
  /** Images utilisées : identifiant de ressource → cid. */
  images?: Map<string, string>
  /** Langue du document (titres par défaut des encadrés). */
  lang?: string
}

function color(c: string, theme?: Theme): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  const v = theme?.colors[c as keyof Theme['colors']]
  return v && /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'
}

function inlineHtml(items: Inline[], ctx: HtmlContext): string {
  let out = ''
  for (const x of items) {
    if (!isRun(x)) {
      if (x.type === 'math') out += `<code>${esc(x.tex)}</code>`
      continue
    }
    if (x.deleted) continue
    let s = esc(x.text).replace(/\n/g, '<br>')
    const css: string[] = []
    if (x.color) css.push(`color:${color(x.color, ctx.theme)}`)
    if (x.highlight) css.push(`background:${Object.prototype.hasOwnProperty.call(HIGHLIGHT_VALUES, x.highlight) ? cssHighlight(x.highlight) : color(x.highlight, ctx.theme)}`)
    if (x.size) css.push(`font-size:${Math.round(x.size * 10) / 10}pt`)
    if (x.caps) css.push('text-transform:uppercase')
    if (x.smallcaps) css.push('font-variant:small-caps')
    if (css.length) s = `<span style="${css.join(';')}">${s}</span>`
    if (x.code) s = `<code>${s}</code>`
    if (x.sup) s = `<sup>${s}</sup>`
    if (x.sub) s = `<sub>${s}</sub>`
    if (x.strike) s = `<s>${s}</s>`
    if (x.underline) s = `<u>${s}</u>`
    if (x.italic) s = `<em>${s}</em>`
    if (x.bold) s = `<strong>${s}</strong>`
    if (x.link && /^(https?:|mailto:)/i.test(x.link)) s = `<a href="${esc(x.link)}">${s}</a>`
    out += s
  }
  return out
}

function paraStyle(b: { align?: string; indent?: { left?: number } }): string {
  const css: string[] = ['margin:0 0 10px']
  if (b.align && b.align !== 'left') css.push(`text-align:${b.align}`)
  if (b.indent?.left) css.push(`margin-left:${Math.round(b.indent.left)}pt`)
  return css.join(';')
}

function listHtml(b: Extract<Block, { type: 'list' }>, ctx: HtmlContext): string {
  // Les éléments sont à plat, avec un niveau : on reconstruit l'imbrication.
  // Une sous-liste s'ouvre dans l'élément précédent, encore ouvert.
  let out = ''
  const stack: string[] = []
  for (const it of b.items) {
    const tag = it.style === 'number' ? 'ol' : 'ul'
    if (stack.length && it.level < stack.length) {
      while (stack.length - 1 > it.level) out += `</li></${stack.pop()}>`
      out += '</li>'
    }
    while (stack.length <= it.level) {
      const top = stack.length === 0
      out += top && tag === 'ol' && b.start > 1 ? `<ol start="${b.start}" style="margin:0 0 10px">` : `<${tag} style="margin:0 0 ${top ? 10 : 0}px">`
      stack.push(tag)
    }
    out += `<li>${inlineHtml(it.content, ctx)}`
  }
  while (stack.length) out += `</li></${stack.pop()}>`
  return out
}

/** Corps HTML d'un message (sous-ensemble sûr, styles en ligne pour les messageries). */
export function blocksHtml(blocks: Block[], ctx: HtmlContext = {}): string {
  let out = ''
  for (const b of blocks) {
    switch (b.type) {
      case 'paragraph':
        out += `<p style="${paraStyle(b)}">${inlineHtml(b.content, ctx) || '<br>'}</p>`
        break
      case 'heading': {
        const n = Math.min(6, Math.max(1, b.level))
        out += `<h${n} style="${paraStyle(b)}">${inlineHtml(b.content, ctx)}</h${n}>`
        break
      }
      case 'list':
        out += listHtml(b, ctx)
        break
      case 'quote':
        out += `<blockquote style="margin:0 0 10px;padding-left:12px;border-left:3px solid #ccc">${blocksHtml(b.blocks, ctx)}</blockquote>`
        break
      case 'callout': {
        const c = CALLOUT_COLORS[b.kind]
        out += `<div style="margin:0 0 10px;padding:8px 12px;border-left:4px solid ${c.bar};background:${c.fill}"><p style="margin:0 0 4px;font-weight:bold;color:${c.bar}">${esc(b.title || calloutLabel(b.kind, ctx.lang ?? ''))}</p>${blocksHtml(b.blocks, ctx)}</div>`
        break
      }
      case 'columns':
        out += blocksHtml(b.blocks, ctx)
        break
      case 'code':
        out += `<pre style="margin:0 0 10px;padding:8px;background:#f4f4f4;white-space:pre-wrap">${esc(b.text)}</pre>`
        break
      case 'equation':
        out += `<p style="text-align:center"><code>${esc(b.tex)}</code></p>`
        break
      case 'divider':
        out += '<hr>'
        break
      case 'table': {
        out += '<table style="border-collapse:collapse;margin:0 0 10px">'
        b.rows.forEach((row, i) => {
          out += '<tr>'
          for (const c of row) {
            const tag = b.header && i === 0 ? 'th' : 'td'
            const span = `${c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}`
            const bg = c.bg ? `;background:${color(c.bg, ctx.theme)}` : ''
            out += `<${tag}${span} style="border:1px solid #bbb;padding:4px 8px;text-align:left;vertical-align:top${bg}">${blocksHtml(c.blocks, ctx).replace(/margin:0 0 10px/g, 'margin:0')}</${tag}>`
          }
          out += '</tr>'
        })
        out += '</table>'
        break
      }
      case 'image': {
        const id = b.src.startsWith('asset:') ? b.src.slice(6) : ''
        const data = id && ctx.assets?.[id]
        if (!data || !ctx.images || !/^data:image\/(png|jpeg|gif|webp);base64,/.test(data)) break
        let cid = ctx.images.get(id)
        if (!cid) {
          cid = `img${ctx.images.size + 1}@folio`
          ctx.images.set(id, cid)
        }
        const w = b.width ? ` width="${Math.round((b.width * 4) / 3)}"` : ''
        out += `<p style="text-align:${b.align}"><img src="cid:${cid}" alt="${esc(b.alt)}"${w} style="max-width:100%"></p>`
        break
      }
      default:
        break
    }
  }
  return out
}

// --- brouillons .eml ----------------------------------------------------------------

/** Base64 d'un texte UTF-8, en lignes de 76 caractères (RFC 2045). */
function b64(text: string | Uint8Array): string {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return (btoa(bin).match(/.{1,76}/g) ?? []).join('\r\n')
}

/** En-tête encodé (RFC 2047) si besoin. */
function header(text: string): string {
  const clean = text.replace(/[\r\n]+/g, ' ').trim()
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${b64(clean).replace(/\r\n/g, '')}?=`
}

/** Une pièce jointe d'un brouillon. */
export interface EmlAttachment {
  name: string
  type: string
  data: Uint8Array | string
}

export interface EmlOptions {
  theme?: Theme
  assets?: Record<string, string>
  date?: Date
  /** Copie (adresses séparées par des virgules). */
  cc?: string
  attachments?: EmlAttachment[]
  /** Pour des séparateurs MIME reproductibles dans les tests. */
  boundary?: string
}

/** Nom de fichier sûr dans un en-tête MIME. */
const mimeName = (name: string) => header(name.replace(/["\\]/g, '_').slice(0, 150))

/** Un brouillon .eml : à ouvrir dans la messagerie, prêt à envoyer. */
export function emlMessage(m: EmailMessage, o: EmlOptions = {}): string {
  const files = (o.attachments ?? []).filter((a) => /^[\w.+-]+\/[\w.+-]+$/.test(a.type))
  const base = o.boundary ?? `folio${Math.random().toString(36).slice(2, 12)}`
  if (!files.length) return emlBody(m, { ...o, boundary: base })
  // Pièces jointes : le message (texte + HTML + images) puis les fichiers, dans un multipart/mixed.
  const inner = emlBody(m, { ...o, boundary: base }).split('\r\n')
  const start = inner.indexOf('MIME-Version: 1.0') + 1
  const head = inner.slice(0, start)
  const body = inner.slice(start)
  const mixed = `${base}-mix`
  const parts = [...head, `Content-Type: multipart/mixed; boundary="${mixed}"`, '', `--${mixed}`, ...body]
  for (const f of files) {
    const name = mimeName(f.name)
    parts.push(`--${mixed}`, `Content-Type: ${f.type}; name="${name}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${name}"`, '', b64(f.data))
  }
  parts.push(`--${mixed}--`, '')
  return parts.join('\r\n')
}

function emlBody(m: EmailMessage, o: EmlOptions): string {
  const images = new Map<string, string>()
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#222">${blocksHtml(m.blocks, { theme: o.theme, assets: o.assets, images })}</body></html>`
  const base = o.boundary ?? `folio${Math.random().toString(36).slice(2, 12)}`
  const alt = `${base}-alt`
  const rel = `${base}-rel`
  const date = (o.date ?? new Date()).toUTCString().replace('GMT', '+0000')
  const lines = [`To: ${m.to.replace(/[\r\n]/g, '')}`, ...(o.cc?.trim() ? [`Cc: ${o.cc.replace(/[\r\n]/g, '')}`] : []), `Subject: ${header(m.subject)}`, `Date: ${date}`, 'X-Unsent: 1', 'MIME-Version: 1.0']
  const altPart = [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(m.body),
    `--${alt}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html),
    `--${alt}--`,
  ]
  if (!images.size) return [...lines, ...altPart, ''].join('\r\n')
  const parts = [...lines, `Content-Type: multipart/related; boundary="${rel}"`, '', `--${rel}`, ...altPart]
  for (const [id, cid] of images) {
    const data = o.assets?.[id] ?? ''
    const mt = /^data:(image\/[a-z]+);base64,(.*)$/s.exec(data)
    if (!mt) continue
    const ext = mt[1].split('/')[1].replace('jpeg', 'jpg')
    parts.push(`--${rel}`, `Content-Type: ${mt[1]}; name="${id}.${ext}"`, 'Content-Transfer-Encoding: base64', `Content-ID: <${cid}>`, `Content-Disposition: inline; filename="${id}.${ext}"`, '', (mt[2].replace(/\s/g, '').match(/.{1,76}/g) ?? []).join('\r\n'))
  }
  parts.push(`--${rel}--`, '')
  return parts.join('\r\n')
}

/** Nom de fichier sûr pour le brouillon d'un destinataire. */
export function emlName(m: EmailMessage, n: number): string {
  const who = (m.to.split('@')[0] || `message-${n}`).replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 40)
  return `${String(n).padStart(3, '0')}-${who}.eml`
}

/** Adresses distinctes et valides, pour un envoi groupé (copie cachée). */
export function bccList(msgs: EmailMessage[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of msgs) {
    const a = m.to.trim()
    const k = a.toLowerCase()
    if (isEmail(a) && !seen.has(k)) {
      seen.add(k)
      out.push(a)
    }
  }
  return out
}
