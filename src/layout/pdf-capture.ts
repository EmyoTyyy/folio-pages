// PDF direct (sans la fenêtre d'impression) : les pages telles qu'elles sont
// mises en page à l'écran sont relevées (texte mot à mot, fonds, bordures,
// images, dessin, puces et cases) et réécrites en PDF vectoriel, avec les
// polices standard de PDF à la place des polices du document.

import { PdfWriter, type PdfPage, type StdFont } from '../export/pdf'

type Rgb = [number, number, number]

export interface CaptureReport {
  /** Caractères sans équivalent dans les polices standard (remplacés par « ? »). */
  replaced: number
  /** Images qui n'ont pas pu être lues (sur un autre site, sans autorisation). */
  images: number
}

/** Ce qui n'est pas imprimé : outils, repères, surlignages d'écran. */
const SKIP = '.fp-figure__reflect, .fp-ink-layer, .fp-gap-mask, .ProseMirror-gapcursor, .ProseMirror-separator, .fp-figure__handle, .fp-figure__placeholder, .fp-cropper, .fp-callout__icon, .fp-hf-zone.is-empty, .fp-notes-measure, [data-folio-transient], .fp-linkbubble, .fp-page-break, .fp-section-break, .fp-column-break, .fp-xe, .fp-bookmark, .fp-spacer__label, button:not(.fp-note__num), .fp-toc__empty'
/** Fonds d'écran seulement (commentaires, recherche, phrases longues…). */
const SCREEN_BG = '.fp-comment, .fp-comment-draft, .fp-find-hit, .fp-long-sentence, .fp-term, .fp-current, .fp-redact, .fp-field, .ProseMirror-selectednode, .fp-hf-zone, .fp-multisel'

const alphaOf = (v: string | undefined) => (v === undefined ? 1 : v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v))
const colorCache = new Map<string, { c: Rgb; a: number } | null>()

/** Une couleur calculée (rgb(), color(srgb …), oklab… issus de color-mix) → RVB et opacité. */
function rgba(css: string): { c: Rgb; a: number } | null {
  if (!css || css === 'transparent' || css === 'none') return null
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(css)
  if (m) return { c: [Number(m[1]), Number(m[2]), Number(m[3])], a: alphaOf(m[4]) }
  const srgb = /color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([\d.]+%?))?\)/.exec(css)
  if (srgb) return { c: [srgb[1], srgb[2], srgb[3]].map((v) => Math.round(Math.max(0, Math.min(1, Number(v))) * 255)) as Rgb, a: alphaOf(srgb[4]) }
  // Autres espaces (oklab, lab…) : le navigateur les convertit en dessinant un pixel.
  if (colorCache.has(css)) return colorCache.get(css)!
  let out: { c: Rgb; a: number } | null = null
  try {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (ctx) {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      const d = ctx.getImageData(0, 0, 1, 1).data
      out = d[3] ? { c: [d[0], d[1], d[2]], a: d[3] / 255 } : null
    }
  } catch {
    out = null
  }
  colorCache.set(css, out)
  return out
}

/** Famille, graisse, style → police standard la plus proche. */
export function stdFontFor(family: string, weight: string, style: string): StdFont {
  // La première famille décide (« Hanken Grotesk, …, sans-serif » est une linéale).
  const f = family.split(',')[0].replace(/["']/g, '').trim().toLowerCase()
  const bold = Number(weight) >= 600 || weight === 'bold'
  const italic = style === 'italic' || style.startsWith('oblique')
  if (/mono|courier|consolas|menlo|code/.test(f)) return (bold ? (italic ? 'Courier-BoldOblique' : 'Courier-Bold') : italic ? 'Courier-Oblique' : 'Courier') as StdFont
  if (!/sans/.test(f) && /serif|newsreader|times|georgia|garamond|cambria|baskerville|merriweather|lora|playfair|crimson|spectral|bitter|book|math|stix|cormorant|alegreya/.test(f)) return bold ? (italic ? 'Times-BoldItalic' : 'Times-Bold') : italic ? 'Times-Italic' : 'Times-Roman'
  return bold ? (italic ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : italic ? 'Helvetica-Oblique' : 'Helvetica'
}

const visible = (el: Element) => {
  const cs = getComputedStyle(el)
  return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.01
}

export async function capturePdf(root: HTMLElement, info: { title?: string; author?: string; subject?: string; keywords?: string; lang?: string }): Promise<{ bytes: Uint8Array; report: CaptureReport }> {
  const sheets = Array.from(root.querySelectorAll<HTMLElement>('.fp-sheet'))
  if (!sheets.length) throw new Error('not-paged')
  const scale = sheets[0].getBoundingClientRect().height / (sheets[0].offsetHeight || 1) || 1
  const pdf = new PdfWriter()
  const pages = sheets.map((s) => {
    const rect = s.getBoundingClientRect()
    const [w, h] = snapPaper(((rect.width / scale) * 72) / 96, ((rect.height / scale) * 72) / 96)
    return { rect, page: pdf.addPage(w, h) }
  })
  const report: CaptureReport = { replaced: 0, images: 0 }
  const k = 72 / 96 / scale
  /** Page d'un point de l'écran (la plus proche verticalement s'il tombe entre deux). */
  const pageAt = (x: number, y: number) => {
    let best = 0
    let dist = Infinity
    pages.forEach((p, i) => {
      const d = y < p.rect.top ? p.rect.top - y : y > p.rect.bottom ? y - p.rect.bottom : 0
      const dx = x < p.rect.left ? p.rect.left - x : x > p.rect.right ? x - p.rect.right : 0
      if (d + dx < dist) {
        dist = d + dx
        best = i
      }
    })
    return best
  }
  const at = (i: number, x: number, y: number): [PdfPage, number, number] => [pages[i].page, (x - pages[i].rect.left) * k, (y - pages[i].rect.top) * k]
  const skipped = (el: Element) => !!el.closest(SKIP)

  // 1. Fonds de page et filigranes, puis fonds et bordures des éléments.
  for (const [i, s] of sheets.entries()) {
    const bg = rgba(getComputedStyle(s).backgroundColor)
    const p = pages[i].page
    if (bg && bg.a > 0.01 && !(bg.c[0] === 255 && bg.c[1] === 255 && bg.c[2] === 255)) p.fillRect(0, 0, p.width, p.height, bg.c)
  }
  const elements = Array.from(root.querySelectorAll<HTMLElement>('*'))
  for (const el of elements) {
    if (el instanceof SVGElement || skipped(el) || el.closest('svg, math')) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const opacity = Number(cs.opacity)
    const bg = rgba(cs.backgroundColor)
    const masked = (cs.maskImage && cs.maskImage !== 'none') || ((cs as unknown as { webkitMaskImage?: string }).webkitMaskImage ?? 'none') !== 'none'
    if (bg && bg.a > 0.01 && !el.matches(SCREEN_BG) && !el.classList.contains('fp-sheet') && !masked) {
      for (const r of Array.from(el.getClientRects())) {
        if (r.width < 0.5 || r.height < 0.5) continue
        const i = pageAt(r.left + r.width / 2, r.top + r.height / 2)
        const [p, x, y] = at(i, r.left, r.top)
        p.save()
        p.opacity(bg.a * opacity)
        p.fillRect(x, y, r.width * k, r.height * k, bg.c)
        p.restore()
      }
    }
    // Caviardage en attente : un pavé noir (le texte dessous n'est pas écrit).
    if (el.classList.contains('fp-redact')) {
      for (const r of Array.from(el.getClientRects())) {
        const [p, x, y] = at(pageAt(r.left, r.top + r.height / 2), r.left, r.top)
        p.fillRect(x, y, r.width * k, r.height * k, [0, 0, 0])
      }
    }
    if (el.matches('.fp-hf-zone, .fp-comment, .fp-hf') && !el.matches('.fp-notes-zone')) continue
    const r = el.getBoundingClientRect()
    if (r.width < 0.5 && r.height < 0.5) continue
    const sides: ['Top' | 'Right' | 'Bottom' | 'Left', number, number, number, number][] = [
      ['Top', r.left, r.top, r.right, r.top],
      ['Right', r.right, r.top, r.right, r.bottom],
      ['Bottom', r.left, r.bottom, r.right, r.bottom],
      ['Left', r.left, r.top, r.left, r.bottom],
    ]
    for (const [side, x1, y1, x2, y2] of sides) {
      const w = parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`))
      const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`)
      const col = rgba(cs.getPropertyValue(`border-${side.toLowerCase()}-color`))
      if (!(w > 0.2) || style === 'none' || style === 'hidden' || !col || col.a < 0.05) continue
      const i = pageAt((x1 + x2) / 2, (y1 + y2) / 2)
      // Le trait est à l'intérieur de la boîte : on le centre sur sa demi-épaisseur.
      const half = w / 2
      const dx = side === 'Left' ? half : side === 'Right' ? -half : 0
      const dy = side === 'Top' ? half : side === 'Bottom' ? -half : 0
      const [p, a1, b1] = at(i, x1 + dx, y1 + dy)
      const [, a2, b2] = at(i, x2 + dx, y2 + dy)
      p.save()
      p.opacity(col.a * opacity)
      p.line(a1, b1, a2, b2, w * k, col.c, style === 'dashed' ? [w * k * 3, w * k * 2] : style === 'dotted' ? [w * k, w * k * 1.5] : undefined)
      p.restore()
    }
  }

  // 2. Images (celles « devant le texte » viennent après le texte, en 5 bis).
  const inFront = (img: Element) => !!img.closest('.fp-figure[data-wrap="front"]')
  const drawImage = async (img: HTMLImageElement): Promise<void> => {
    const r = img.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return
    const data = await imageData(img)
    if (!data) {
      report.images++
      return
    }
    const id = pdf.addImage(data)
    const i = pageAt(r.left + r.width / 2, r.top + r.height / 2)
    const [p, x, y] = at(i, r.left, r.top)
    // Image rognée : coupée par son cadre.
    const crop = img.parentElement?.closest('.crop, .fp-figure__crop, [style*="overflow"]') as HTMLElement | null
    const op = Number(getComputedStyle(img.closest('.fp-watermark') ?? img).opacity)
    p.save()
    if (crop) {
      const c = crop.getBoundingClientRect()
      const [, cx, cy] = at(i, c.left, c.top)
      p.clip(cx, cy, c.width * k, c.height * k)
    }
    p.opacity(op)
    p.image(id, x, y, r.width * k, r.height * k)
    p.restore()
  }
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('img'))) {
    if (skipped(img) || !visible(img) || inFront(img)) continue
    await drawImage(img)
  }

  // 3. Dessin à main levée (vectoriel) et autres SVG (en image).
  for (const svg of Array.from(root.querySelectorAll<SVGSVGElement>('svg'))) {
    if (skipped(svg)) continue
    if (svg.classList.contains('fp-ink')) {
      for (const path of Array.from(svg.querySelectorAll('path'))) {
        const m = path.getScreenCTM()
        if (!m) continue
        const nums = (path.getAttribute('d') ?? '').match(/-?[\d.]+/g)?.map(Number) ?? []
        const pts: { x: number; y: number }[] = []
        for (let j = 0; j + 1 < nums.length; j += 2) pts.push(new DOMPoint(nums[j], nums[j + 1]).matrixTransform(m))
        if (!pts.length) continue
        const i = pageAt(pts[0].x, pts[0].y)
        const flat: number[] = []
        for (const q of pts) {
          const [, x, y] = at(i, q.x, q.y)
          flat.push(x, y)
        }
        const col = rgba(getComputedStyle(path).stroke) ?? { c: [0, 0, 0] as Rgb, a: 1 }
        const sw = Number(path.getAttribute('stroke-width') ?? 2) * m.a * k
        const p = pages[i].page
        p.save()
        p.opacity(1, Number(path.getAttribute('stroke-opacity') ?? 1))
        p.polyline(flat, sw, col.c, path.getAttribute('stroke-linecap') === 'square' ? 2 : 1)
        p.restore()
      }
      continue
    }
    const r = svg.getBoundingClientRect()
    if (r.width < 2 || r.height < 2 || !visible(svg)) continue
    const data = await svgData(svg, r.width, r.height)
    if (!data) continue
    const id = pdf.addImage(data)
    const i = pageAt(r.left + r.width / 2, r.top + r.height / 2)
    const [p, x, y] = at(i, r.left, r.top)
    p.image(id, x, y, r.width * k, r.height * k)
  }

  // 4. Puces, numéros et cases (dessinés par le navigateur, absents du texte).
  for (const li of Array.from(root.querySelectorAll<HTMLElement>('li'))) {
    if (skipped(li) || !visible(li)) continue
    const list = li.parentElement
    if (!list) continue
    const first = firstTextRect(li)
    if (!first) continue
    const cs = getComputedStyle(li)
    const size = parseFloat(cs.fontSize) * scale
    const i = pageAt(first.left, first.top + first.height / 2)
    const p = pages[i].page
    const color = rgba(cs.color)?.c ?? [0, 0, 0]
    if (list.classList.contains('fp-checklist')) {
      // Case : un carré, rempli et coché si l'élément l'est.
      const box = size * 0.92
      const [, x, y] = at(i, first.left - size * 1.45 + (li.getBoundingClientRect().left - first.left), first.top + (first.height - box) / 2)
      const s = box * k
      const checked = li.hasAttribute('data-checked')
      if (checked) p.fillRect(x, y, s, s, rgba(getComputedStyle(li, '::before').backgroundColor)?.c ?? [30, 107, 85])
      p.line(x, y, x + s, y, 1, color)
      p.line(x + s, y, x + s, y + s, 1, color)
      p.line(x + s, y + s, x, y + s, 1, color)
      p.line(x, y + s, x, y, 1, color)
      if (checked) p.polyline([x + s * 0.22, y + s * 0.52, x + s * 0.42, y + s * 0.72, x + s * 0.8, y + s * 0.3], s * 0.15, [255, 255, 255])
      continue
    }
    const marker = markerOf(li)
    if (!marker) continue
    const font = stdFontFor(cs.fontFamily, cs.fontWeight, 'normal')
    const [, x, base] = at(i, li.getBoundingClientRect().left, first.bottom - first.height * 0.22)
    const pt = (size / scale) * 0.75
    // Le numéro finit un peu avant le texte ; la puce est centrée dans la marge.
    p.text(marker, x - pt * (marker.length * 0.5 + 0.6), base, pt, font, color)
  }

  // 5. Texte, mot à mot, et ses soulignements.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let node: Node | null
  while ((node = walker.nextNode())) {
    const el = node.parentElement
    const text = node.nodeValue ?? ''
    if (!el || !text.trim() || skipped(el) || el.closest('svg, .fp-redact, annotation, style, script')) continue
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    const size = parseFloat(cs.fontSize)
    if (!(size > 0)) continue
    const font = stdFontFor(cs.fontFamily, cs.fontWeight, cs.fontStyle)
    const col = rgba(cs.color) ?? { c: [0, 0, 0] as Rgb, a: 1 }
    const deco = decorations(el)
    const water = el.closest<HTMLElement>('.fp-watermark')
    const angle = water ? rotation(el) : 0
    // Texte vertical (cellules tournées) : de haut en bas, ou de bas en haut (sideways-lr).
    const wm = cs.writingMode
    const vertical = /^(vertical|sideways)/.test(wm) ? (wm === 'sideways-lr' ? 'up' : 'down') : null
    const pt = size * 0.75
    let pos = 0
    for (const word of text.split(/(\s+)/)) {
      const start = pos
      pos += word.length
      if (!word.trim()) continue
      range.setStart(node, start)
      range.setEnd(node, pos)
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0)
      if (!rects.length) continue
      const pieces = rects.length === 1 ? [{ text: word, r: rects[0] }] : splitByLine(node, start, word, range)
      for (const piece of pieces) {
        const r = piece.r
        const i = pageAt(r.left + r.width / 2, r.top + r.height / 2)
        const p = pages[i].page
        report.replaced += [...piece.text].filter((ch) => !/[\x20-\x7e -ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ‑−α-ωΑ-Ω∀∃∑∏∫√∞≤≥≠≈±×÷→←↔⇒⇔∈∉⊂⊆∩∪∂∇]/.test(ch)).length
        if (angle) {
          // Filigrane tourné : posé depuis le centre de sa boîte.
          const box = el.getBoundingClientRect()
          const w = (el as HTMLElement).offsetWidth * 0.75
          const [, cx, cy] = at(i, box.left + box.width / 2, box.top + box.height / 2)
          p.save()
          p.opacity(Number(getComputedStyle(water!).opacity))
          p.text(text.trim(), cx - (Math.cos(angle) * w) / 2 - (Math.sin(angle) * pt * 0.35), cy + (Math.sin(angle) * w) / 2 + Math.cos(angle) * pt * 0.35, pt, font, col.c, w, -angle)
          p.restore()
          break
        }
        if (vertical) {
          // Le mot occupe une boîte haute et étroite ; sa ligne de base est verticale.
          const [, left, top] = at(i, r.left, r.top)
          const w = r.width * k
          p.save()
          p.opacity(col.a)
          if (vertical === 'down') p.text(piece.text, left + (w - pt) / 2 + pt * 0.2, top, pt, font, col.c, r.height * k, -Math.PI / 2)
          else p.text(piece.text, left + w - (w - pt) / 2 - pt * 0.2, top + r.height * k, pt, font, col.c, r.height * k, Math.PI / 2)
          p.restore()
          continue
        }
        const [, x, top] = at(i, r.left, r.top)
        const h = r.height * k
        const baseline = top + h - (h - pt) / 2 - pt * 0.2
        p.save()
        p.opacity(col.a)
        p.text(piece.text, x, baseline, pt, font, col.c, r.width * k)
        p.restore()
        if (deco.underline) p.line(x, baseline + pt * 0.12, x + r.width * k, baseline + pt * 0.12, Math.max(0.5, pt * 0.06), deco.color ?? col.c)
        if (deco.strike) p.line(x, baseline - pt * 0.28, x + r.width * k, baseline - pt * 0.28, Math.max(0.5, pt * 0.06), deco.color ?? col.c)
      }
      if (angle) break
    }
  }

  // Numéros d'appel de note : écrits par le style (attr(data-label)), pas dans le texte.
  for (const ref of Array.from(root.querySelectorAll<HTMLElement>('.fp-note-ref[data-label]'))) {
    if (skipped(ref) || !visible(ref)) continue
    const label = ref.dataset.label ?? ''
    const after = getComputedStyle(ref, '::after')
    const size = parseFloat(after.fontSize || getComputedStyle(ref).fontSize)
    const r = ref.getBoundingClientRect()
    const i = pageAt(r.left, r.top)
    // Exposant : la ligne de base est au-dessus de celle du texte.
    const [p, x, y] = at(i, r.left + parseFloat(getComputedStyle(ref).paddingLeft || '0') * scale, r.top + r.height / 2)
    p.text(label, x, y + size * scale * k * 0.15, size * 0.75, stdFontFor(after.fontFamily, after.fontWeight, after.fontStyle), rgba(after.color)?.c ?? [0, 0, 0])
  }

  // 5 bis. Images devant le texte.
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('.fp-figure[data-wrap="front"] img'))) {
    if (skipped(img) || !visible(img)) continue
    await drawImage(img)
  }

  // 6. Traits des formules (barres de fraction, radicaux), filet des notes.
  for (const fr of Array.from(root.querySelectorAll('mfrac'))) {
    if (fr.getAttribute('linethickness') === '0' || skipped(fr)) continue
    const [num, den] = Array.from(fr.children)
    if (!num || !den) continue
    const a = num.getBoundingClientRect()
    const b = den.getBoundingClientRect()
    const r = fr.getBoundingClientRect()
    const yMid = (a.bottom + b.top) / 2
    const i = pageAt(r.left, yMid)
    const [p, x1, y] = at(i, r.left + 1, yMid)
    const [, x2] = at(i, r.right - 1, yMid)
    p.line(x1, y, x2, y, 0.6, rgba(getComputedStyle(fr).color)?.c ?? [0, 0, 0])
  }
  for (const sq of Array.from(root.querySelectorAll('msqrt, mroot'))) {
    if (skipped(sq)) continue
    const base = sq.tagName.toLowerCase() === 'mroot' ? sq.children[0] : sq
    const r = sq.getBoundingClientRect()
    const b = (base ?? sq).getBoundingClientRect()
    const i = pageAt(r.left, r.top)
    const [p, x0, y0] = at(i, r.left, r.top + r.height * 0.6)
    const [, x1, y1] = at(i, b.left - 1, r.bottom - 1)
    const [, x2, y2] = at(i, b.left + 2, r.top + 1)
    const [, x3] = at(i, r.right, r.top + 1)
    p.polyline([x0, y0, (x0 + x1) / 2, y0 - 0.5, x1, y1, x2, y2, x3, y2], 0.6, rgba(getComputedStyle(sq).color)?.c ?? [0, 0, 0], 0)
  }
  for (const z of Array.from(root.querySelectorAll<HTMLElement>('.fp-notes-zone--foot'))) {
    const r = z.getBoundingClientRect()
    const i = pageAt(r.left, r.top + 4)
    const [p, x, y] = at(i, r.left, r.top + 3)
    p.line(x, y, x + r.width * k * 0.3, y, 0.5, [120, 120, 120])
  }

  // 7. Liens et plan (signets des titres).
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const href = a.getAttribute('href') ?? ''
    if (!/^(https?:|mailto:|tel:)/i.test(href) || skipped(a)) continue
    for (const r of Array.from(a.getClientRects())) {
      const i = pageAt(r.left, r.top + r.height / 2)
      const [p, x, y] = at(i, r.left, r.top)
      p.link(x, y, r.width * k, r.height * k, href)
    }
  }
  for (const h of Array.from(root.querySelectorAll<HTMLElement>('.fp-prose h1, .fp-prose h2, .fp-prose h3, .fp-prose h4'))) {
    const title = (h.textContent ?? '').trim()
    if (!title) continue
    const r = h.getBoundingClientRect()
    const i = pageAt(r.left, r.top + 2)
    const [, , y] = at(i, r.left, r.top)
    pdf.bookmark(title, i, Math.max(0, y - 6), Number(h.tagName[1]))
  }
  return { bytes: pdf.output(info), report }
}

/** Formats de papier connus (points), en portrait ; une page à 1 pt près en prend la taille exacte. */
const PAPERS: [number, number][] = [[595.28, 841.89], [612, 792], [612, 1008], [419.53, 595.28], [841.89, 1190.55], [498.9, 708.66], [792, 1224], [522, 756]]

function snapPaper(w: number, h: number): [number, number] {
  for (const [a, b] of PAPERS) {
    if (Math.abs(w - a) < 1.5 && Math.abs(h - b) < 1.5) return [a, b]
    if (Math.abs(w - b) < 1.5 && Math.abs(h - a) < 1.5) return [b, a]
  }
  return [w, h]
}

/** Premier rectangle de texte d'un élément de liste (sa première ligne). */
function firstTextRect(li: HTMLElement): DOMRect | null {
  const w = document.createTreeWalker(li, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = w.nextNode())) {
    if (!(n.nodeValue ?? '').trim()) continue
    const r = document.createRange()
    r.selectNodeContents(n)
    const rect = r.getClientRects()[0]
    if (rect) return rect
  }
  // Élément vide : la hauteur de sa première ligne.
  const p = li.firstElementChild?.getBoundingClientRect()
  return p ? new DOMRect(p.left, p.top, 0, Math.min(p.height, parseFloat(getComputedStyle(li).fontSize) * 1.4)) : null
}

/** Puce ou numéro d'un élément de liste, comme le navigateur l'affiche. */
function markerOf(li: HTMLElement): string {
  const list = li.parentElement!
  const type = getComputedStyle(list).listStyleType
  if (type === 'none') return ''
  const custom = /^"(.*)"$/.exec(type)
  if (custom) return custom[1].trim()
  if (list.tagName === 'UL') return type === 'circle' ? '◦' : type === 'square' ? '▪' : '•'
  const items = Array.from(list.children).filter((c) => c.tagName === 'LI')
  const n = Number(list.getAttribute('start') ?? 1) + items.indexOf(li)
  if (list.dataset.numbering === 'outline') {
    const nums = [n]
    let p: HTMLElement | null = list.parentElement?.closest('li') ?? null
    while (p && p.parentElement?.tagName === 'OL') {
      const ol = p.parentElement
      nums.unshift(Number(ol.getAttribute('start') ?? 1) + Array.from(ol.children).filter((c) => c.tagName === 'LI').indexOf(p))
      p = ol.parentElement?.closest('li') ?? null
    }
    return `${nums.join('.')}.`
  }
  const alpha = (v: number) => {
    let s = ''
    for (let x = v; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(97 + ((x - 1) % 26)) + s
    return s
  }
  const roman = (v: number) => {
    const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
    let s = ''
    let x = v
    for (const [val, sym] of t)
      while (x >= val) {
        s += sym
        x -= val
      }
    return s
  }
  const label = type.includes('alpha') || type.includes('latin') ? alpha(n) : type.includes('roman') ? roman(n) : String(n)
  return `${type.startsWith('upper') ? label.toUpperCase() : label}.`
}

/** Soulignement et barré, hérités des éléments en ligne autour. */
function decorations(el: HTMLElement): { underline: boolean; strike: boolean; color?: Rgb } {
  let underline = false
  let strike = false
  let color: Rgb | undefined
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    const cs = getComputedStyle(e)
    if (cs.textDecorationLine.includes('underline')) {
      underline = true
      color ??= rgba(cs.textDecorationColor)?.c
    }
    if (cs.textDecorationLine.includes('line-through')) strike = true
    if (cs.display !== 'inline' && cs.display !== 'contents') break
  }
  return { underline, strike, color }
}

/** Angle de rotation (radians) d'un élément tourné par CSS. */
function rotation(el: Element): number {
  for (let e: Element | null = el; e && !e.classList.contains('fp-sheet'); e = e.parentElement) {
    const t = getComputedStyle(e).transform
    const m = /matrix\(([-\d.e]+),\s*([-\d.e]+)/.exec(t)
    if (m) return Math.atan2(Number(m[2]), Number(m[1]))
  }
  return 0
}

/** Un mot coupé en fin de ligne (césure) : un morceau par ligne. */
function splitByLine(node: Node, start: number, word: string, range: Range): { text: string; r: DOMRect }[] {
  const out: { text: string; r: DOMRect }[] = []
  let cur = ''
  let rect: DOMRect | null = null
  for (let j = 0; j < word.length; j++) {
    range.setStart(node, start + j)
    range.setEnd(node, start + j + 1)
    const r = range.getClientRects()[0]
    if (!r) continue
    if (rect && Math.abs(r.top - rect.top) > r.height / 2) {
      out.push({ text: cur, r: rect })
      cur = ''
      rect = null
    }
    cur += word[j]
    rect = rect ? new DOMRect(rect.left, rect.top, r.right - rect.left, Math.max(rect.height, r.height)) : r
  }
  if (rect && cur) out.push({ text: cur, r: rect })
  return out
}

/** Une image de la page en données PDF (JPEG tel quel, sinon ses pixels). */
async function imageData(img: HTMLImageElement): Promise<{ jpeg?: Uint8Array; rgb?: Uint8Array; alpha?: Uint8Array; width: number; height: number } | null> {
  try {
    await img.decode().catch(() => undefined)
    if (!img.naturalWidth) return null
    const src = img.currentSrc || img.src
    const jpeg = /^data:image\/jpe?g;base64,/.exec(src)
    if (jpeg && !getComputedStyle(img).filter.includes('(')) {
      const bin = atob(src.slice(jpeg[0].length))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return { jpeg: bytes, width: img.naturalWidth, height: img.naturalHeight }
    }
    const max = 2400
    const f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    return pixels(img, Math.round(img.naturalWidth * f), Math.round(img.naturalHeight * f), getComputedStyle(img).filter)
  } catch {
    return null
  }
}

async function svgData(svg: SVGSVGElement, w: number, h: number) {
  try {
    const xml = new XMLSerializer().serializeToString(svg)
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }))
    const img = new Image()
    img.src = url
    await img.decode()
    const out = pixels(img, Math.ceil(w * 2), Math.ceil(h * 2), 'none')
    URL.revokeObjectURL(url)
    return out
  } catch {
    return null
  }
}

function pixels(src: CanvasImageSource, w: number, h: number, filter: string) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, w)
  c.height = Math.max(1, h)
  const ctx = c.getContext('2d')
  if (!ctx) return null
  // Les retouches d'image (filtres CSS) sont dessinées avec elle.
  if (filter && filter !== 'none') ctx.filter = filter
  ctx.drawImage(src, 0, 0, c.width, c.height)
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  const rgb = new Uint8Array(c.width * c.height * 3)
  const alpha = new Uint8Array(c.width * c.height)
  let opaque = true
  for (let i = 0, j = 0, a = 0; i < d.length; i += 4) {
    rgb[j++] = d[i]
    rgb[j++] = d[i + 1]
    rgb[j++] = d[i + 2]
    alpha[a++] = d[i + 3]
    if (d[i + 3] < 255) opaque = false
  }
  return { rgb, ...(opaque ? {} : { alpha }), width: c.width, height: c.height }
}
