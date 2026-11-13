// Lecteur XML minimal pour les parties d'un fichier .docx.
//
// Volontairement réduit : éléments, attributs, texte, CDATA, entités
// prédéfinies et numériques. Pas de DTD (un DOCTYPE est refusé : aucune entité
// à développer, donc pas de « bombe » d'entités), pas d'accès réseau, et des
// bornes sur la taille, la profondeur et le nombre de nœuds. Les préfixes
// d'espaces de noms sont gardés tels quels (« w:p ») : les producteurs de
// .docx utilisent tous les préfixes habituels.

export interface XmlNode {
  /** Nom qualifié, préfixe compris (« w:p »). */
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  /** Texte directement contenu (concaténé), utile pour w:t, w:instrText… */
  text: string
}

export class XmlError extends Error {}

export const XML_LIMITS = { chars: 80_000_000, depth: 256, nodes: 4_000_000 }

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/** Développe les entités d'un texte ou d'une valeur d'attribut. Une entité inconnue reste telle quelle. */
export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      if (!Number.isFinite(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ''
      // Caractères de contrôle interdits en XML 1.0 : jamais dans le document.
      if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) return ''
      return String.fromCodePoint(code)
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m
  })
}

const isNameChar = (c: number) =>
  (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 58 || c === 95 || c === 45 || c === 46 || c > 127

/** Analyse un document XML ; lève XmlError s'il est mal formé ou dépasse les bornes. */
export function parseXml(src: string): XmlNode {
  if (src.length > XML_LIMITS.chars) throw new XmlError('too-large')
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  let nodes = 0
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0
  const n = src.length
  while (i < n) {
    const lt = src.indexOf('<', i)
    const top = stack[stack.length - 1]
    if (lt < 0) {
      if (stack.length > 1) throw new XmlError('unclosed')
      break
    }
    if (lt > i && stack.length > 1) top.text += decodeEntities(src.slice(i, lt))
    i = lt
    const c = src.charCodeAt(i + 1)
    if (c === 33 /* ! */) {
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i + 4)
        if (end < 0) throw new XmlError('comment')
        i = end + 3
      } else if (src.startsWith('<![CDATA[', i)) {
        const end = src.indexOf(']]>', i + 9)
        if (end < 0) throw new XmlError('cdata')
        if (stack.length > 1) top.text += src.slice(i + 9, end)
        i = end + 3
      } else {
        // <!DOCTYPE …> : refusé (entités, sous-ensemble interne).
        throw new XmlError('doctype')
      }
      continue
    }
    if (c === 63 /* ? */) {
      const end = src.indexOf('?>', i + 2)
      if (end < 0) throw new XmlError('pi')
      i = end + 2
      continue
    }
    if (c === 47 /* / */) {
      const end = src.indexOf('>', i + 2)
      if (end < 0) throw new XmlError('close')
      const name = src.slice(i + 2, end).trim()
      if (stack.length < 2 || top.name !== name) throw new XmlError('mismatch')
      stack.pop()
      i = end + 1
      continue
    }
    // Balise ouvrante.
    let j = i + 1
    while (j < n && isNameChar(src.charCodeAt(j))) j++
    if (j === i + 1) throw new XmlError('name')
    const node: XmlNode = { name: src.slice(i + 1, j), attrs: {}, children: [], text: '' }
    if (++nodes > XML_LIMITS.nodes) throw new XmlError('too-many-nodes')
    let selfClosing = false
    for (;;) {
      while (j < n && src.charCodeAt(j) <= 32) j++
      if (j >= n) throw new XmlError('open')
      const ch = src.charCodeAt(j)
      if (ch === 62 /* > */) {
        j++
        break
      }
      if (ch === 47 /* / */) {
        if (src.charCodeAt(j + 1) !== 62) throw new XmlError('open')
        selfClosing = true
        j += 2
        break
      }
      const a0 = j
      while (j < n && isNameChar(src.charCodeAt(j))) j++
      if (j === a0) throw new XmlError('attr')
      const an = src.slice(a0, j)
      while (j < n && src.charCodeAt(j) <= 32) j++
      if (src.charCodeAt(j) !== 61 /* = */) throw new XmlError('attr')
      j++
      while (j < n && src.charCodeAt(j) <= 32) j++
      const q = src.charCodeAt(j)
      if (q !== 34 && q !== 39) throw new XmlError('attr')
      const close = src.indexOf(q === 34 ? '"' : "'", j + 1)
      if (close < 0) throw new XmlError('attr')
      node.attrs[an] = decodeEntities(src.slice(j + 1, close))
      j = close + 1
    }
    top.children.push(node)
    if (!selfClosing) {
      if (stack.length >= XML_LIMITS.depth) throw new XmlError('too-deep')
      stack.push(node)
    }
    i = j
  }
  if (stack.length > 1) throw new XmlError('unclosed')
  const el = root.children[0]
  if (!el) throw new XmlError('empty')
  return el
}

/** Premier enfant de ce nom. */
export const child = (n: XmlNode | undefined | null, name: string): XmlNode | undefined => n?.children.find((c) => c.name === name)

/** Enfants de ce nom. */
export const kids = (n: XmlNode | undefined | null, name: string): XmlNode[] => (n ? n.children.filter((c) => c.name === name) : [])

/** Descendant par chemin de noms (« w:pPr », « w:numPr »…). */
export function path(n: XmlNode | undefined | null, ...names: string[]): XmlNode | undefined {
  let cur = n ?? undefined
  for (const name of names) {
    if (!cur) return undefined
    cur = child(cur, name)
  }
  return cur
}

/** Tous les descendants de ce nom, dans l'ordre du document. */
export function descendants(n: XmlNode | undefined | null, name: string, out: XmlNode[] = []): XmlNode[] {
  if (!n) return out
  const todo: XmlNode[] = [...n.children].reverse()
  while (todo.length) {
    const c = todo.pop()!
    if (c.name === name) out.push(c)
    for (let k = c.children.length - 1; k >= 0; k--) todo.push(c.children[k])
  }
  return out
}

/** Attribut (« w:val » par défaut). */
export const attr = (n: XmlNode | undefined | null, name = 'w:val'): string | undefined => n?.attrs[name]

/** Attribut numérique entier ; undefined s'il manque ou n'est pas un nombre. */
export function num(n: XmlNode | undefined | null, name = 'w:val'): number | undefined {
  const v = n?.attrs[name]
  if (v === undefined) return undefined
  const x = Number(v)
  return Number.isFinite(x) ? x : undefined
}

/** Propriété à bascule (w:b, w:i…) : présente sans valeur = vrai ; « 0 », « false », « off » = faux. */
export function onOff(n: XmlNode | undefined | null): boolean | undefined {
  if (!n) return undefined
  const v = n.attrs['w:val']
  return !(v === '0' || v === 'false' || v === 'off')
}

/** Texte de tout le sous-arbre. */
export function textOf(n: XmlNode | undefined | null): string {
  if (!n) return ''
  let s = n.text
  for (const c of n.children) s += textOf(c)
  return s
}

/** Échappe un texte pour l'écrire dans du XML. */
export const escapeXml = (s: string): string =>
  s.replace(/[<>&"']/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&apos;'))
