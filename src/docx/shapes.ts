// Formes et zones de texte en .docx : de vraies formes de Word (wps:wsp, wpg:wgp),
// ancrées dans leur paragraphe (position depuis la colonne et le paragraphe),
// avec leur forme prédéfinie, leurs couleurs du thème, leur texte (w:txbxContent).
// L'export pose une marque à la place de chaque forme et range le texte des
// zones de texte en fin de document ; withShapes met ensuite le dessin à la
// place de la marque et le texte dans sa zone. L'import fait l'inverse.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { isLineKind, isShapeKind } from '../format/shapes'
import { THEME_COLORS, type ShapeInline } from '../format/types'

const EMU = 12700
const emu = (pt: number) => Math.round(pt * EMU)
const xa = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'

export const SHAPE_MARK = 'FOLIOSHAPE'
export const TEXT_MARK = 'FOLIOTXBX'

/** Les noms des couleurs du thème dans DrawingML. */
const SCHEME: Record<string, string> = { text: 'tx1', accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6' }

function color(c: string, mods = ''): string {
  if (SCHEME[c]) return `<a:schemeClr val="${SCHEME[c]}">${mods}</a:schemeClr>`
  const hex = /^#([0-9a-f]{6})$/i.exec(c)?.[1] ?? '000000'
  return `<a:srgbClr val="${hex.toUpperCase()}">${mods}</a:srgbClr>`
}

const DASH: Record<string, string> = { dash: 'dash', dot: 'sysDot', dashDot: 'dashDot', longDash: 'lgDash' }
const END: Record<string, string> = { arrow: 'arrow', triangle: 'triangle', oval: 'oval', diamond: 'diamond' }

/** Les propriétés de la forme (wps:spPr) : place dans le groupe, forme, remplissage, contour, ombre. */
function spPr(d: ShapeInline, off: [number, number]): string {
  const rot = d.rotate ? ` rot="${Math.round(d.rotate * 60000)}"` : ''
  const flip = `${d.flip?.includes('h') ? ' flipH="1"' : ''}${d.flip?.includes('v') ? ' flipV="1"' : ''}`
  const prst = d.shape === 'textBox' ? 'rect' : d.shape
  const line = isLineKind(d.shape)
  let fill = '<a:noFill/>'
  if (!line && d.fill && d.fill !== 'none') fill = `<a:solidFill>${color(d.fill, d.transparency ? `<a:alpha val="${(100 - d.transparency) * 1000}"/>` : '')}</a:solidFill>`
  let ln = '<a:ln><a:noFill/></a:ln>'
  if (d.line && d.line !== 'none') {
    // Le contour de la couleur du remplissage : plus sombre, comme Word.
    const shade = !line && d.fill === d.line ? '<a:shade val="72000"/>' : ''
    const ends = `${d.head && END[d.head] ? `<a:headEnd type="${END[d.head]}"/>` : ''}${d.tail && END[d.tail] ? `<a:tailEnd type="${END[d.tail]}"/>` : ''}`
    ln = `<a:ln w="${emu(d.lineWidth ?? 1)}"><a:solidFill>${color(d.line, shade)}</a:solidFill>${d.dash && DASH[d.dash] ? `<a:prstDash val="${DASH[d.dash]}"/>` : ''}${ends}</a:ln>`
  }
  const fx = d.shadow ? '<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000" algn="tl" rotWithShape="0"><a:prstClr val="black"><a:alpha val="40000"/></a:prstClr></a:outerShdw></a:effectLst>' : ''
  return `<wps:spPr><a:xfrm${rot}${flip}><a:off x="${emu(off[0])}" y="${emu(off[1])}"/><a:ext cx="${emu(d.width)}" cy="${emu(d.height)}"/></a:xfrm><a:prstGeom prst="${xa(prst)}"><a:avLst/></a:prstGeom>${fill}${ln}${fx}</wps:spPr>`
}

/** La couleur du texte dans la forme (style de la forme) : blanc sur un remplissage foncé. */
const style = (white: boolean) =>
  `<wps:style><a:lnRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor">${white ? '<a:srgbClr val="FFFFFF"/>' : '<a:schemeClr val="tx1"/>'}</a:fontRef></wps:style>`

export interface ShapeXmlOpts {
  /** Le texte d'une forme (w:p…), déjà écrit, ou null. */
  text: (id: string) => string | null
  /** Le texte est-il blanc (remplissage foncé) ? */
  white: (d: ShapeInline) => boolean
  /** L'identifiant de relation de l'image d'une image libre (dans un groupe), ou null. */
  blip?: (d: ShapeInline) => string | null
}

/** Une image libre dans un groupe (pic:pic), à la position `off` du groupe. */
function picXml(d: ShapeInline, rid: string, off: [number, number], id: number): string {
  const rot = d.rotate ? ` rot="${Math.round(d.rotate * 60000)}"` : ''
  const flip = `${d.flip?.includes('h') ? ' flipH="1"' : ''}${d.flip?.includes('v') ? ' flipV="1"' : ''}`
  const c = d.crop
  const crop = c && (c.top || c.right || c.bottom || c.left) ? `<a:srcRect l="${Math.round(c.left * 1000)}" t="${Math.round(c.top * 1000)}" r="${Math.round(c.right * 1000)}" b="${Math.round(c.bottom * 1000)}"/>` : ''
  const ln = d.line && d.line !== 'none' ? `<a:ln w="${emu(d.lineWidth ?? 1)}"><a:solidFill>${color(d.line)}</a:solidFill>${d.dash && DASH[d.dash] ? `<a:prstDash val="${DASH[d.dash]}"/>` : ''}</a:ln>` : ''
  return (
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${Math.abs(id)}" name="${xa(d.name ?? d.id)}"${d.alt ? ` descr="${xa(d.alt)}"` : ''}/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/>${crop}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm${rot}${flip}><a:off x="${emu(off[0])}" y="${emu(off[1])}"/><a:ext cx="${emu(d.width)}" cy="${emu(d.height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${ln}</pic:spPr></pic:pic>`
  )
}

/** Une forme (wps:wsp), à la position `off` (dans un groupe). */
function wsp(d: ShapeInline, o: ShapeXmlOpts, off: [number, number], id: number): string {
  const conn = d.shape === 'bentConnector3' || d.shape === 'curvedConnector3'
  const nv = conn ? '<wps:cNvCnPr/>' : `<wps:cNvSpPr${d.shape === 'textBox' ? ' txBox="1"' : ''}/>`
  const text = !isLineKind(d.shape) ? o.text(d.id) : null
  const anchor = d.valign === 'top' ? 't' : d.valign === 'bottom' ? 'b' : 'ctr'
  const docPr = off[0] || off[1] || id < 0 ? `<wps:cNvPr id="${Math.abs(id)}" name="${xa(d.name ?? d.id)}"${d.alt ? ` descr="${xa(d.alt)}"` : ''}/>` : ''
  return (
    `<wps:wsp>${docPr}${nv}${spPr(d, off)}${!isLineKind(d.shape) ? style(o.white(d)) : ''}` +
    `${text ? `<wps:txbx><w:txbxContent>${text}</w:txbxContent></wps:txbx>` : ''}` +
    `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${anchor}" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp>`
  )
}

/** Un groupe (wpg:wgp ou wpg:grpSp dans un groupe). */
function group(d: ShapeInline, o: ShapeXmlOpts, off: [number, number], top: boolean, seq: { n: number }): string {
  const rot = d.rotate ? ` rot="${Math.round(d.rotate * 60000)}"` : ''
  const flip = `${d.flip?.includes('h') ? ' flipH="1"' : ''}${d.flip?.includes('v') ? ' flipV="1"' : ''}`
  const xfrm = `<a:xfrm${rot}${flip}><a:off x="${emu(off[0])}" y="${emu(off[1])}"/><a:ext cx="${emu(d.width)}" cy="${emu(d.height)}"/><a:chOff x="0" y="0"/><a:chExt cx="${emu(d.width)}" cy="${emu(d.height)}"/></a:xfrm>`
  const kid = (c: ShapeInline): string => {
    if (c.shape === 'group') return group(c, o, [c.x, c.y], false, seq)
    if (c.shape === 'picture') {
      const rid = o.blip?.(c)
      return rid ? picXml(c, rid, [c.x, c.y], ++seq.n) : ''
    }
    return wsp(c, o, [c.x, c.y], -++seq.n)
  }
  const kids = (d.children ?? []).map(kid).join('')
  const tag = top ? 'wpg:wgp' : 'wpg:grpSp'
  const nv = top ? '<wpg:cNvGrpSpPr/>' : `<wpg:cNvPr id="${++seq.n}" name="${xa(d.name ?? d.id)}"/><wpg:cNvGrpSpPr/>`
  return `<${tag}>${nv}<wpg:grpSpPr>${xfrm}</wpg:grpSpPr>${kids}</${tag}>`
}

/** Le dessin d'une forme (w:r avec w:drawing), ancré ou dans la ligne. */
export function shapeRun(d: ShapeInline, o: ShapeXmlOpts, n: number, rank: number): string {
  const seq = { n: 5000 + n * 100 }
  const isGroup = d.shape === 'group'
  const graphic = isGroup
    ? `<a:graphic ${ns}><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">${group(d, o, [0, 0], true, seq)}</a:graphicData></a:graphic>`
    : `<a:graphic ${ns}><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">${wsp(d, o, [0, 0], 0)}</a:graphicData></a:graphic>`
  const docPr = `<wp:docPr id="${4000 + n}" name="${xa(d.name ?? d.id)}"${d.alt ? ` descr="${xa(d.alt)}"` : ''}${d.hidden ? ' hidden="1"' : ''}/>`
  const extent = `<wp:extent cx="${emu(d.width)}" cy="${emu(d.height)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`
  const frame = isGroup ? '<wp:cNvGraphicFramePr/>' : '<wp:cNvGraphicFramePr/>'
  let drawing: string
  if (d.wrap === 'inline') {
    drawing = `<wp:inline distT="0" distB="0" distL="0" distR="0">${extent}${docPr}${frame}${graphic}</wp:inline>`
  } else {
    const wrap = d.wrap === 'square' ? '<wp:wrapSquare wrapText="bothSides"/>' : d.wrap === 'topBottom' ? '<wp:wrapTopAndBottom/>' : '<wp:wrapNone/>'
    const dist = d.wrap === 'square' || d.wrap === 'topBottom' ? ' distT="45720" distB="45720" distL="114300" distR="114300"' : ' distT="0" distB="0" distL="114300" distR="114300"'
    drawing =
      `<wp:anchor${dist} simplePos="0" relativeHeight="${251659264 + rank * 1024}" behindDoc="${d.wrap === 'behind' ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
      `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${emu(d.x)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>${emu(d.y)}</wp:posOffset></wp:positionV>` +
      `${extent}${wrap}${docPr}${frame}${graphic}</wp:anchor>`
  }
  const req = isGroup ? 'wpg' : 'wps'
  return `<w:r><w:rPr><w:noProof/></w:rPr><mc:AlternateContent><mc:Choice Requires="${req}"><w:drawing>${drawing}</w:drawing></mc:Choice></mc:AlternateContent></w:r>`
}

const NS: Record<string, string> = {
  'xmlns:mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  'xmlns:wps': 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  'xmlns:wpg': 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
  'xmlns:wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
}

/**
 * Met les formes à la place de leurs marques (FOLIOSHAPE<n>#) et le texte des
 * zones de texte (rangé entre FOLIOTXBX<k>S et FOLIOTXBX<k>E en fin de document)
 * dans leur zone.
 */
export function withShapes(
  bytes: Uint8Array,
  shapes: { data: ShapeInline; texts: Map<string, number>; rank: number }[],
  white: (d: ShapeInline) => boolean,
  media: (d: ShapeInline) => { data: Uint8Array; ext: 'png' | 'jpeg' | 'gif' } | null = () => null,
): Uint8Array {
  if (!shapes.length) return bytes
  const files = unzipSync(bytes)
  const name = 'word/document.xml'
  let xml = strFromU8(files[name])
  // Les images libres des groupes : un fichier et une relation chacune.
  const blips = new Map<string, string>()
  const rels = 'word/_rels/document.xml.rels'
  let relXml = files[rels] ? strFromU8(files[rels]) : ''
  let types = strFromU8(files['[Content_Types].xml'])
  const walkPics = (d: ShapeInline, top: boolean) => {
    if (d.shape === 'picture' && !top && relXml) {
      const m = media(d)
      if (!m) return
      const k = blips.size + 1
      const ext = m.ext === 'jpeg' ? 'jpg' : m.ext
      files[`word/media/folio-shape-pic${k}.${ext}`] = m.data
      relXml = relXml.replace('</Relationships>', () => `<Relationship Id="rIdFolioPic${k}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/folio-shape-pic${k}.${ext}"/></Relationships>`)
      if (!new RegExp(`Extension="${ext}"`, 'i').test(types)) types = types.replace('</Types>', () => `<Default Extension="${ext}" ContentType="image/${m.ext}"/></Types>`)
      blips.set(d.id, `rIdFolioPic${k}`)
    }
    d.children?.forEach((c) => walkPics(c, false))
  }
  for (const sh of shapes) walkPics(sh.data, true)
  if (blips.size) {
    files[rels] = strToU8(relXml)
    files['[Content_Types].xml'] = strToU8(types)
  }
  // Le texte des zones : les paragraphes entre les deux marques, retirés du corps.
  const texts = new Map<number, string>()
  const para = (mark: string) => new RegExp(`<w:p\\b(?:(?!<w:p\\b)[\\s\\S])*?${mark}[\\s\\S]*?<\\/w:p>`)
  for (let k = 0; ; k++) {
    const s = para(`${TEXT_MARK}${k}S`).exec(xml)
    if (!s) break
    const e = para(`${TEXT_MARK}${k}E`).exec(xml.slice(s.index))
    if (!e) break
    const from = s.index
    const inner = xml.slice(from + s[0].length, from + e.index)
    texts.set(k, inner)
    xml = xml.slice(0, from) + xml.slice(from + e.index + e[0].length)
  }
  xml = xml.replace(new RegExp(`<w:r>(?:(?!<\\/w:r>)[\\s\\S])*?${SHAPE_MARK}(\\d+)#(?:(?!<\\/w:r>)[\\s\\S])*?<\\/w:r>`, 'g'), (_all, n: string) => {
    const s = shapes[Number(n)]
    if (!s) return ''
    return shapeRun(s.data, { text: (id) => (s.texts.has(id) ? (texts.get(s.texts.get(id)!) ?? null) : null), white, blip: (d) => blips.get(d.id) ?? null }, Number(n), s.rank)
  })
  // Les espaces de noms des formes, s'il en manque.
  xml = xml.replace(/<w:document\b[^>]*>/, (root) => {
    let r = root
    for (const [k, v] of Object.entries(NS)) if (!r.includes(`${k}=`)) r = r.replace(/>$/, ` ${k}="${v}">`)
    if (!/mc:Ignorable="[^"]*wps/.test(r)) r = r.includes('mc:Ignorable="') ? r.replace('mc:Ignorable="', 'mc:Ignorable="wps wpg ') : r.replace(/>$/, ' mc:Ignorable="wps wpg">')
    return r
  })
  files[name] = strToU8(xml)
  return zipSync(files, { level: 6 })
}

// --- import -----------------------------------------------------------------------------

/** Un nœud XML de l'import (forme minimale). */
export interface XNode {
  name: string
  attrs: Record<string, string>
  children: XNode[]
  text: string
}
const kid = (n: XNode | undefined, name: string) => n?.children.find((c) => c.name === name)
const all = (n: XNode | undefined, name: string): XNode[] => {
  const out: XNode[] = []
  const walk = (x: XNode) => {
    for (const c of x.children) {
      if (c.name === name) out.push(c)
      walk(c)
    }
  }
  if (n) walk(n)
  return out
}
const num = (v: string | undefined) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const pt = (v: string | undefined) => {
  const x = num(v)
  return x === null ? 0 : Math.round((x / EMU) * 10) / 10
}

const SCHEME_BACK: Record<string, string> = { tx1: 'text', dk1: 'text', tx2: 'text', dk2: 'text', accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6', lt1: '#ffffff', bg1: '#ffffff', lt2: '#eeece1', bg2: '#eeece1' }

/** Une couleur DrawingML → couleur du format (et transparence), ou null. */
function colorOf(n: XNode | undefined): { c: string; alpha?: number } | null {
  if (!n) return null
  const s = kid(n, 'a:schemeClr') ?? kid(n, 'a:srgbClr') ?? kid(n, 'a:prstClr') ?? kid(n, 'a:sysClr')
  if (!s) return null
  let c: string | null = null
  if (s.name === 'a:schemeClr') c = SCHEME_BACK[s.attrs.val ?? ''] ?? null
  else if (s.name === 'a:srgbClr' && /^[0-9a-f]{6}$/i.test(s.attrs.val ?? '')) c = `#${s.attrs.val!.toLowerCase()}`
  else if (s.name === 'a:sysClr' && /^[0-9a-f]{6}$/i.test(s.attrs.lastClr ?? '')) c = `#${s.attrs.lastClr!.toLowerCase()}`
  else if (s.name === 'a:prstClr') c = s.attrs.val === 'white' ? '#ffffff' : '#000000'
  if (!c) return null
  const alpha = num(kid(s, 'a:alpha')?.attrs.val)
  return { c, ...(alpha !== null ? { alpha: alpha / 1000 } : {}) }
}

const DASH_BACK: Record<string, string> = { dash: 'dash', sysDash: 'dash', sysDot: 'dot', dot: 'dot', dashDot: 'dashDot', sysDashDot: 'dashDot', lgDash: 'longDash', lgDashDot: 'longDash', lgDashDotDot: 'longDash', sysDashDotDot: 'dashDot' }
const END_BACK: Record<string, string> = { arrow: 'arrow', triangle: 'triangle', stealth: 'triangle', oval: 'oval', diamond: 'diamond' }

/** Une forme de Word (wps:wsp) → forme du format ; `text` lit le texte d'une zone. */
export function shapeFromWsp(w: XNode, text: (box: XNode) => unknown[], lose: (code: string) => void): Record<string, unknown> {
  const sp = kid(w, 'wps:spPr')
  const xfrm = kid(sp, 'a:xfrm')
  const prst = kid(sp, 'a:prstGeom')?.attrs.prst ?? ''
  // Une zone de texte : marquée comme telle, ou un rectangle qui contient du texte.
  const txBox = kid(w, 'wps:cNvSpPr')?.attrs.txBox === '1' || ((prst === 'rect' || !prst) && all(w, 'w:txbxContent').length > 0)
  let shape = prst === 'rect' && txBox ? 'textBox' : prst
  if (!isShapeKind(shape) && shape !== 'textBox') {
    if (kid(sp, 'a:custGeom') || prst) lose('shape-geometry')
    shape = txBox ? 'textBox' : 'rect'
  }
  if (prst === 'straightConnector1') shape = 'line'
  const out: Record<string, unknown> = { type: 'shape', shape, x: pt(kid(xfrm, 'a:off')?.attrs.x), y: pt(kid(xfrm, 'a:off')?.attrs.y), width: pt(kid(xfrm, 'a:ext')?.attrs.cx), height: pt(kid(xfrm, 'a:ext')?.attrs.cy) }
  const rot = num(xfrm?.attrs.rot)
  if (rot) out.rotate = rot / 60000
  const flip = `${xfrm?.attrs.flipH === '1' ? 'h' : ''}${xfrm?.attrs.flipV === '1' ? 'v' : ''}`
  if (flip) out.flip = flip
  const st = kid(w, 'wps:style')
  // Remplissage : celui de la forme, sinon celui de son style.
  if (kid(sp, 'a:noFill')) out.fill = 'none'
  else {
    const solid = kid(sp, 'a:solidFill') ?? kid(kid(kid(sp, 'a:gradFill'), 'a:gsLst'), 'a:gs')
    const c = colorOf(solid) ?? (kid(st, 'a:fillRef') && kid(st, 'a:fillRef')!.attrs.idx !== '0' ? colorOf(kid(st, 'a:fillRef')) : null)
    if (c) {
      out.fill = c.c
      if (c.alpha !== undefined && c.alpha < 100) out.transparency = Math.round(100 - c.alpha)
    } else if (!kid(st, 'a:fillRef')) out.fill = 'none'
  }
  const ln = kid(sp, 'a:ln')
  if (ln && kid(ln, 'a:noFill')) out.line = 'none'
  else {
    const c = colorOf(kid(ln, 'a:solidFill')) ?? (kid(st, 'a:lnRef') && kid(st, 'a:lnRef')!.attrs.idx !== '0' ? colorOf(kid(st, 'a:lnRef')) : null)
    if (c) out.line = c.c
    else if (!ln && !kid(st, 'a:lnRef')) out.line = 'none'
  }
  const w0 = num(ln?.attrs.w)
  if (w0) out.lineWidth = Math.round((w0 / EMU) * 100) / 100
  const dash = DASH_BACK[kid(ln, 'a:prstDash')?.attrs.val ?? '']
  if (dash) out.dash = dash
  const head = END_BACK[kid(ln, 'a:headEnd')?.attrs.type ?? '']
  const tail = END_BACK[kid(ln, 'a:tailEnd')?.attrs.type ?? '']
  if (head) out.head = head
  if (tail) out.tail = tail
  if (kid(kid(sp, 'a:effectLst'), 'a:outerShdw')) out.shadow = true
  const anchor = kid(w, 'wps:bodyPr')?.attrs.anchor
  if (anchor) out.valign = anchor === 't' ? 'top' : anchor === 'b' ? 'bottom' : 'middle'
  const box = all(w, 'w:txbxContent')[0]
  if (box && !isLineKind(shape)) {
    const blocks = text(box)
    if (blocks.length) out.blocks = blocks
  }
  const nv = kid(w, 'wps:cNvPr')
  if (nv?.attrs.name && !/^shape\d+$/.test(nv.attrs.name)) out.name = nv.attrs.name
  if (nv?.attrs.descr) out.alt = nv.attrs.descr
  return out
}

/** Un groupe de Word (wpg:wgp ou wpg:grpSp) → groupe du format, ses formes ramenées à sa taille. */
/** Une image (pic:pic) dans un groupe → image libre ; `pic` donne la source d'une relation. */
export function pictureFromPic(p: XNode, pic: (rid: string) => string | null): Record<string, unknown> | null {
  const blip = all(p, 'a:blip')[0]
  const src = blip ? pic(blip.attrs['r:embed'] ?? blip.attrs['r:link'] ?? '') : null
  if (!src) return null
  const sp = kid(p, 'pic:spPr')
  const xfrm = kid(sp, 'a:xfrm')
  const out: Record<string, unknown> = { type: 'shape', shape: 'picture', src, x: pt(kid(xfrm, 'a:off')?.attrs.x), y: pt(kid(xfrm, 'a:off')?.attrs.y), width: pt(kid(xfrm, 'a:ext')?.attrs.cx), height: pt(kid(xfrm, 'a:ext')?.attrs.cy) }
  const rot = num(xfrm?.attrs.rot)
  if (rot) out.rotate = rot / 60000
  const flip = `${xfrm?.attrs.flipH === '1' ? 'h' : ''}${xfrm?.attrs.flipV === '1' ? 'v' : ''}`
  if (flip) out.flip = flip
  const rect = all(p, 'a:srcRect')[0]
  if (rect) {
    const pc = (k: string) => Math.max(0, Math.min(95, (num(rect.attrs[k]) ?? 0) / 1000))
    const crop = { top: pc('t'), right: pc('r'), bottom: pc('b'), left: pc('l') }
    if (crop.top || crop.right || crop.bottom || crop.left) out.crop = crop
  }
  const ln = kid(sp, 'a:ln')
  const c = ln && !kid(ln, 'a:noFill') ? colorOf(kid(ln, 'a:solidFill')) : null
  if (c) {
    out.line = c.c
    const w0 = num(ln?.attrs.w)
    if (w0) out.lineWidth = Math.round((w0 / EMU) * 100) / 100
  }
  const nv = kid(kid(p, 'pic:nvPicPr'), 'pic:cNvPr')
  if (nv?.attrs.name && !/^shape\d+$/.test(nv.attrs.name)) out.name = nv.attrs.name
  if (nv?.attrs.descr) out.alt = nv.attrs.descr
  return out
}

export function groupFrom(g: XNode, text: (box: XNode) => unknown[], lose: (code: string) => void, pic: (rid: string) => string | null = () => null): Record<string, unknown> {
  const xfrm = kid(kid(g, 'wpg:grpSpPr'), 'a:xfrm')
  const [ox, oy, cx, cy] = [pt(kid(xfrm, 'a:off')?.attrs.x), pt(kid(xfrm, 'a:off')?.attrs.y), pt(kid(xfrm, 'a:ext')?.attrs.cx), pt(kid(xfrm, 'a:ext')?.attrs.cy)]
  const [chx, chy, chw, chh] = [pt(kid(xfrm, 'a:chOff')?.attrs.x), pt(kid(xfrm, 'a:chOff')?.attrs.y), pt(kid(xfrm, 'a:chExt')?.attrs.cx) || cx, pt(kid(xfrm, 'a:chExt')?.attrs.cy) || cy]
  const [kx, ky] = [chw ? cx / chw : 1, chh ? cy / chh : 1]
  const children: Record<string, unknown>[] = []
  for (const c of g.children) {
    let k: Record<string, unknown> | null = null
    if (c.name === 'wps:wsp') k = shapeFromWsp(c, text, lose)
    else if (c.name === 'wpg:grpSp') k = groupFrom(c, text, lose, pic)
    else if (c.name === 'pic:pic') {
      k = pictureFromPic(c, pic)
      if (!k) lose('drawing')
    } else if (c.name === 'wpg:graphicFrame') lose('drawing')
    if (!k) continue
    // Les coordonnées des formes du groupe : ramenées à la taille du groupe.
    k.x = Math.round(((k.x as number) - chx) * kx * 10) / 10
    k.y = Math.round(((k.y as number) - chy) * ky * 10) / 10
    k.width = Math.round((k.width as number) * kx * 10) / 10
    k.height = Math.round((k.height as number) * ky * 10) / 10
    children.push(k)
  }
  const out: Record<string, unknown> = { type: 'shape', shape: 'group', x: ox, y: oy, width: cx, height: cy, children }
  const rot = num(xfrm?.attrs.rot)
  if (rot) out.rotate = rot / 60000
  const flip = `${xfrm?.attrs.flipH === '1' ? 'h' : ''}${xfrm?.attrs.flipV === '1' ? 'v' : ''}`
  if (flip) out.flip = flip
  return out
}

/**
 * Le dessin d'une forme (w:drawing) → forme du format, avec sa place : ancrée
 * (position depuis la colonne et le paragraphe, habillage, plan) ou dans la ligne.
 * `col` : largeur de la colonne (pt) et marge gauche, pour les positions alignées
 * ou comptées depuis la page.
 */
export function shapeFromDrawing(drawing: XNode, text: (box: XNode) => unknown[], lose: (code: string) => void, col: { width: number; marginLeft: number }, pic: (rid: string) => string | null = () => null): Record<string, unknown> | null {
  const anchor = all(drawing, 'wp:anchor')[0]
  const inline = all(drawing, 'wp:inline')[0]
  const host = anchor ?? inline
  if (!host) return null
  const data = kid(kid(host, 'a:graphic'), 'a:graphicData')
  const wspNode = kid(data, 'wps:wsp')
  const wgp = kid(data, 'wpg:wgp')
  if (!wspNode && !wgp) return null
  const shape = wgp ? groupFrom(wgp, text, lose, pic) : shapeFromWsp(wspNode!, text, lose)
  const ext = kid(host, 'wp:extent')
  if (ext) {
    shape.width = pt(ext.attrs.cx)
    shape.height = pt(ext.attrs.cy)
  }
  const doc = kid(host, 'wp:docPr')
  // Nos identifiants (shape12) ne sont pas des noms.
  if (doc?.attrs.name && !/^shape\d+$/.test(doc.attrs.name)) shape.name = doc.attrs.name
  if (doc?.attrs.descr) shape.alt = doc.attrs.descr
  if (doc?.attrs.hidden === '1' || doc?.attrs.hidden === 'true') shape.hidden = true
  if (!anchor) {
    shape.wrap = 'inline'
    shape.x = 0
    shape.y = 0
    return shape
  }
  placeAnchored(shape, anchor, lose, col)
  return shape
}

/** La place d'un dessin ancré (forme ou image libre) : position, habillage, plan. */
export function placeAnchored(shape: Record<string, unknown>, anchor: XNode, lose: (code: string) => void, col: { width: number; marginLeft: number }): void {
  const w = shape.width as number
  const ph = kid(anchor, 'wp:positionH')
  const pv = kid(anchor, 'wp:positionV')
  const offText = (n: XNode | undefined) => {
    const v = kid(n, 'wp:posOffset')?.text.trim() ?? ''
    return v ? pt(v) : null
  }
  const align = (n: XNode | undefined) => kid(n, 'wp:align')?.text.trim()
  let x = offText(ph) ?? 0
  const ha = align(ph)
  if (ha === 'center') x = (col.width - w) / 2
  else if (ha === 'right' || ha === 'outside') x = col.width - w
  else if (ha === 'left' || ha === 'inside') x = 0
  else if (ph?.attrs.relativeFrom === 'page') x -= col.marginLeft
  shape.x = Math.round(x * 10) / 10
  const vrel = pv?.attrs.relativeFrom
  shape.y = vrel === 'paragraph' || vrel === 'line' ? (offText(pv) ?? 0) : 0
  if (vrel && vrel !== 'paragraph' && vrel !== 'line') lose('shape-position')
  if (kid(anchor, 'wp:wrapNone')) shape.wrap = anchor.attrs.behindDoc === '1' || anchor.attrs.behindDoc === 'true' ? 'behind' : 'front'
  else if (kid(anchor, 'wp:wrapTopAndBottom')) shape.wrap = 'topBottom'
  else shape.wrap = 'square'
  const rh = num(anchor.attrs.relativeHeight)
  // Le plan : relativeHeight de Word (à partir de 251658240 d'habitude) ; absent ou nul : sans ordre.
  if (rh !== null && rh >= 251658240) shape.z = Math.min(100000, Math.round((rh - 251658240) / 1024))
  else if (rh) shape.z = Math.min(100000, Math.round(rh / 1024))
}

/** Les couleurs du thème du format (pour les tests). */
export const SHAPE_THEME_COLORS = THEME_COLORS
