// Plan du document : les titres, dans l'ordre, avec leur niveau et leur position.

import type { Node as PMNode } from 'prosemirror-model'

export interface OutlineItem {
  level: number
  text: string
  pos: number
}

/** Titres du document (au premier niveau et dans les citations et colonnes). */
export function outline(doc: PMNode, maxLevel = 6): OutlineItem[] {
  const out: OutlineItem[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      if (node.attrs.level <= maxLevel) out.push({ level: node.attrs.level, text: node.textContent.trim(), pos })
      return false
    }
    // Pas de titres dans les tableaux, les listes ou les légendes pour le plan.
    return ['doc', 'blockquote', 'columns'].includes(node.type.name)
  })
  return out
}

/** Titre qui contient (ou précède) une position. */
export function currentHeading(items: OutlineItem[], pos: number): number {
  let found = -1
  for (let i = 0; i < items.length; i++) {
    if (items[i].pos <= pos) found = i
    else break
  }
  return found
}
