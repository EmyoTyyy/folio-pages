// Listes : forme plate (éléments avec un niveau) ⇄ arbre (listes imbriquées).
//
// Le format stocke une liste comme une suite d'éléments portant un `level`,
// comme on la pense (Tab pour descendre d'un niveau). L'éditeur, lui, imbrique
// des listes dans les éléments. Une seule règle de construction, ici, sert au
// chargement, à l'écriture compacte et à la conversion vers l'éditeur.
//
// Règles :
//   - on ne descend que d'un niveau à la fois (un saut est ramené) ;
//   - un élément qui ouvre un niveau sans style hérite du style du parent ;
//   - au même niveau, un changement de style ouvre une nouvelle sous-liste ;
//   - au premier niveau, le style est toujours celui de la liste.

import type { Inline, ListItem, ListStyle, ParaProps } from './types'

export const MAX_LEVEL = 8

/** Cases des listes à cocher, là où il faut un caractère (texte, .docx, .odt). */
export const EMPTY_BOX = '☐'
export const CHECKED_BOX = '☒'

export interface FlatInput {
  content: Inline[]
  level: number
  style?: ListStyle
  /** Mise en forme du paragraphe de l'élément. */
  props?: ParaProps
  /** Case cochée (liste à cocher). */
  checked?: boolean
}

export interface TreeList {
  style: ListStyle
  items: TreeItem[]
}

export interface TreeItem {
  content: Inline[]
  props: ParaProps
  sublists: TreeList[]
  checked?: boolean
}

export type AdjustFn = (index: number, kind: 'level' | 'style', from: string, to: string) => void

/** Construit l'arbre pas à pas ; sait aussi dire quel style serait déduit. */
export class ListBuilder {
  readonly root: TreeList
  private stack: TreeList[]

  constructor(rootStyle: ListStyle) {
    this.root = { style: rootStyle, items: [] }
    this.stack = [this.root]
  }

  private top(): TreeList {
    return this.stack[this.stack.length - 1]
  }

  /** Niveau effectivement utilisé pour un élément demandé au niveau `level`. */
  effectiveLevel(level: number): number {
    const deepest = this.stack.length - 1
    let l = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)))
    if (this.root.items.length === 0) l = 0
    if (l > deepest + 1) l = deepest + 1
    return l
  }

  /** Style qu'aurait un élément de niveau `level` sans style explicite. */
  inferredStyle(level: number): ListStyle {
    const l = this.effectiveLevel(level)
    if (l === 0) return this.root.style
    if (l <= this.stack.length - 1) return this.stack[l].style
    return this.top().style // ouverture d'un niveau : style du parent
  }

  add(item: FlatInput): { level: number; style: ListStyle } {
    const l = this.effectiveLevel(item.level)
    while (this.stack.length - 1 > l) this.stack.pop()
    if (l === 0) {
      this.root.items.push({ content: item.content, props: item.props ?? {}, sublists: [], ...(item.checked ? { checked: true } : {}) })
      return { level: 0, style: this.root.style }
    }
    const style = item.style ?? this.inferredStyle(l)
    if (l === this.stack.length) {
      this.open(style)
    } else if (style !== this.top().style) {
      // même niveau, autre style : nouvelle sous-liste sous le même parent
      this.stack.pop()
      this.open(style)
    }
    this.top().items.push({ content: item.content, props: item.props ?? {}, sublists: [], ...(item.checked ? { checked: true } : {}) })
    return { level: l, style }
  }

  private open(style: ListStyle): void {
    const parent = this.top()
    const host = parent.items[parent.items.length - 1]
    const list: TreeList = { style, items: [] }
    host.sublists.push(list)
    this.stack.push(list)
  }
}

export function buildTree(rootStyle: ListStyle, items: FlatInput[], adjust?: AdjustFn): TreeList {
  const b = new ListBuilder(rootStyle)
  items.forEach((it, i) => {
    const res = b.add(it)
    if (adjust && res.level !== it.level) adjust(i, 'level', String(it.level), String(res.level))
    if (adjust && it.style && res.level === 0 && it.style !== rootStyle) adjust(i, 'style', it.style, rootStyle)
  })
  return b.root
}

export type FlatItem = ListItem

/** Arbre → éléments plats, chacun avec son niveau et le style de sa liste. */
export function flattenTree(tree: TreeList, level = 0, out: FlatItem[] = []): FlatItem[] {
  for (const item of tree.items) {
    out.push({ content: item.content, level, style: tree.style, ...item.props, ...(tree.style === 'check' && item.checked ? { checked: true as const } : {}) })
    for (const sub of item.sublists) flattenTree(sub, level + 1, out)
  }
  return out
}
