// L'arborescence des documents du fichier : des dossiers, qui rangent les
// documents (un document n'a pas d'enfants). Dans le fichier, elle tient dans
// le champ « tree » du premier document, une liste où chaque élément est la clé
// d'un document ou un dossier { "folder": "Titre", "items": [...] }. Les
// documents eux-mêmes restent dans « documents », dans l'ordre de l'arbre.
//
// Lecture tolérante : une clé inconnue ou répétée est ignorée, un document
// absent de l'arbre est ajouté à la racine, un dossier trop profond est remonté.

/** Un élément de « tree » dans le fichier. */
export type TreeItem = string | { folder: string; items?: TreeItem[] }

export interface FolderNode {
  kind: 'folder'
  /** Identifiant de session (pas dans le fichier). */
  id: string
  title: string
  children: TreeNode[]
}
export interface DocNode {
  kind: 'doc'
  key: string
}
export type TreeNode = FolderNode | DocNode

export const TREE_LIMITS = { folders: 200, depth: 8, title: 200, items: 300 }

let seq = 0
/** Un identifiant de dossier unique dans la session. */
export const folderId = (): string => `f${++seq}`

export const cleanTitle = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, TREE_LIMITS.title)

export interface TreeIssue {
  path: string
  what: 'unknown-key' | 'duplicate-key' | 'too-deep' | 'too-many-folders'
  detail: string
}

/** L'arbre de la session, à partir de « tree » (s'il y en a un) et des clés des documents. */
export function buildTree(json: readonly TreeItem[] | undefined, keys: readonly string[], issues: TreeIssue[] = []): TreeNode[] {
  const known = new Set(keys)
  const seen = new Set<string>()
  let folders = 0
  const walk = (items: readonly TreeItem[], path: string, depth: number, out: TreeNode[]) => {
    items.forEach((it, i) => {
      const p = `${path}[${i}]`
      if (typeof it === 'string') {
        if (!known.has(it)) issues.push({ path: p, what: 'unknown-key', detail: it })
        else if (seen.has(it)) issues.push({ path: p, what: 'duplicate-key', detail: it })
        else {
          seen.add(it)
          out.push({ kind: 'doc', key: it })
        }
        return
      }
      if (!it || typeof it !== 'object' || typeof it.folder !== 'string') return
      const items = Array.isArray(it.items) ? it.items : []
      // Trop profond, ou trop de dossiers : son contenu remonte ici.
      if (depth >= TREE_LIMITS.depth || folders >= TREE_LIMITS.folders) {
        issues.push({ path: p, what: depth >= TREE_LIMITS.depth ? 'too-deep' : 'too-many-folders', detail: it.folder })
        walk(items, `${p}.items`, depth, out)
        return
      }
      folders++
      const node: FolderNode = { kind: 'folder', id: folderId(), title: cleanTitle(it.folder) || '…', children: [] }
      out.push(node)
      walk(items, `${p}.items`, depth + 1, node.children)
    })
  }
  const root: TreeNode[] = []
  if (json) walk(json, 'tree', 0, root)
  for (const k of keys) if (!seen.has(k)) root.push({ kind: 'doc', key: k })
  return root
}

export const hasFolders = (nodes: readonly TreeNode[]): boolean => nodes.some((n) => n.kind === 'folder')

/** « tree » pour le fichier ; rien quand il n'y a pas de dossier (l'ordre de « documents » suffit). */
export function treeJson(nodes: readonly TreeNode[]): TreeItem[] | undefined {
  if (!hasFolders(nodes)) return undefined
  const out = (list: readonly TreeNode[]): TreeItem[] => list.map((n) => (n.kind === 'doc' ? n.key : { folder: n.title, items: out(n.children) }))
  return out(nodes)
}

/** Les clés des documents, dans l'ordre de l'arbre (de haut en bas). */
export function docOrder(nodes: readonly TreeNode[]): string[] {
  const out: string[] = []
  const walk = (list: readonly TreeNode[]) => {
    for (const n of list) {
      if (n.kind === 'doc') out.push(n.key)
      else walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/** Ce qui compte pour savoir si l'arbre a changé. */
export const treeSignature = (nodes: readonly TreeNode[]): string => JSON.stringify(treeJson(nodes) ?? docOrder(nodes))

export interface Located {
  node: TreeNode
  /** Le dossier qui le contient (null : la racine). */
  parent: FolderNode | null
  list: TreeNode[]
  index: number
  depth: number
}

/** Trouve un élément : une clé de document, ou un identifiant de dossier. */
export function locate(nodes: TreeNode[], ref: string): Located | null {
  const walk = (list: TreeNode[], parent: FolderNode | null, depth: number): Located | null => {
    for (let i = 0; i < list.length; i++) {
      const n = list[i]
      if ((n.kind === 'doc' ? n.key : n.id) === ref) return { node: n, parent, list, index: i, depth }
      if (n.kind === 'folder') {
        const found = walk(n.children, n, depth + 1)
        if (found) return found
      }
    }
    return null
  }
  return walk(nodes, null, 0)
}

export const refOf = (n: TreeNode): string => (n.kind === 'doc' ? n.key : n.id)

/** Le dossier d'un identifiant (null : inconnu). */
export function folderById(nodes: TreeNode[], id: string): FolderNode | null {
  const at = locate(nodes, id)
  return at && at.node.kind === 'folder' ? at.node : null
}

/** La liste des enfants d'un dossier (null : la racine). */
export function childrenOf(nodes: TreeNode[], parent: string | null): TreeNode[] | null {
  if (parent === null) return nodes
  return folderById(nodes, parent)?.children ?? null
}

/** Les clés des documents d'un dossier (et de ses sous-dossiers). */
export const docsIn = (folder: FolderNode): string[] => docOrder(folder.children)

/** Profondeur des dossiers sous un élément (0 : un document ou un dossier sans sous-dossier). */
function height(n: TreeNode): number {
  if (n.kind === 'doc') return 0
  let h = 0
  for (const c of n.children) if (c.kind === 'folder') h = Math.max(h, 1 + height(c))
  return h
}

/** On peut placer `ref` dans `parent` : pas dans lui-même ni dans un de ses dossiers, pas trop profond. */
export function canMove(nodes: TreeNode[], ref: string, parent: string | null): boolean {
  const at = locate(nodes, ref)
  if (!at) return false
  if (parent === null) return true
  const target = locate(nodes, parent)
  if (!target || target.node.kind !== 'folder') return false
  if (at.node.kind === 'folder') {
    if (at.node.id === parent || locate(at.node.children, parent)) return false
    return target.depth + 1 + height(at.node) < TREE_LIMITS.depth
  }
  return true
}

/**
 * Déplace un élément dans `parent`, à la place `index` (comptée avant le
 * déplacement, dans la liste d'arrivée). Renvoie false si c'est impossible.
 */
export function moveNode(nodes: TreeNode[], ref: string, parent: string | null, index: number): boolean {
  if (!canMove(nodes, ref, parent)) return false
  const at = locate(nodes, ref)!
  const dest = childrenOf(nodes, parent)!
  let i = Math.max(0, Math.min(dest.length, index))
  if (dest === at.list && at.index < i) i--
  at.list.splice(at.index, 1)
  dest.splice(i, 0, at.node)
  return true
}

/** Ajoute un élément dans `parent` (inconnu : la racine), à la place `index` (au-delà : à la fin). */
export function insertNode(nodes: TreeNode[], node: TreeNode, parent: string | null, index = Infinity): void {
  const dest = childrenOf(nodes, parent) ?? nodes
  dest.splice(Math.max(0, Math.min(dest.length, index)), 0, node)
}

/** Le chemin d'un élément : les titres des dossiers qui le contiennent. */
export function pathOf(nodes: TreeNode[], ref: string): string[] {
  const out: string[] = []
  const walk = (list: TreeNode[]): boolean => {
    for (const n of list) {
      if (refOf(n) === ref) return true
      if (n.kind === 'folder') {
        out.push(n.title)
        if (walk(n.children)) return true
        out.pop()
      }
    }
    return false
  }
  return walk(nodes) ? out : []
}

export const countFolders = (nodes: readonly TreeNode[]): number => nodes.reduce((s, n) => s + (n.kind === 'folder' ? 1 + countFolders(n.children) : 0), 0)

/** Un sous-arbre limité à certaines clés (les dossiers vides en sortent). */
export function subtree(nodes: readonly TreeNode[], keys: ReadonlySet<string>): TreeNode[] {
  const out: TreeNode[] = []
  for (const n of nodes) {
    if (n.kind === 'doc') {
      if (keys.has(n.key)) out.push({ ...n })
      continue
    }
    const children = subtree(n.children, keys)
    if (children.length) out.push({ ...n, children })
  }
  return out
}

/** Copie profonde (les dossiers gardent leur identifiant). */
export const cloneTree = (nodes: readonly TreeNode[]): TreeNode[] => nodes.map((n) => (n.kind === 'doc' ? { ...n } : { ...n, children: cloneTree(n.children) }))

/** Renomme les clés de documents d'un arbre de fichier (import). */
export function rekeyTree(items: readonly TreeItem[], map: ReadonlyMap<string, string>): TreeItem[] {
  return items.map((it) => (typeof it === 'string' ? (map.get(it) ?? it) : { folder: it.folder, items: rekeyTree(it.items ?? [], map) }))
}
