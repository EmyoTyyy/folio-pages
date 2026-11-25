// Dossiers de documents : l'arbre du fichier (« tree »), sa lecture tolérante,
// les déplacements, et les documents ajoutés depuis un autre fichier.

import { describe, expect, it } from 'vitest'
import { joinFile, rekeyDocuments, splitFile } from '../../src/format/documents'
import { toCompact } from '../../src/format/compact'
import { loadDocument } from '../../src/format/load'
import { buildTree, canMove, docOrder, locate, moveNode, subtree, treeJson, TREE_LIMITS, type TreeIssue, type TreeItem } from '../../src/format/tree'
import type { FolioDoc } from '../../src/format/types'

const KEYS = ['intro', 'ch1', 'ch2', 'annex']
const TREE: TreeItem[] = ['intro', { folder: 'Chapitres', items: ['ch1', { folder: 'Brouillons', items: ['ch2'] }] }, 'annex']

describe('arbre des documents', () => {
  it('se lit, garde l’ordre de l’arbre, et revient tel quel', () => {
    const t = buildTree(TREE, KEYS)
    expect(docOrder(t)).toEqual(['intro', 'ch1', 'ch2', 'annex'])
    expect(treeJson(t)).toEqual(TREE)
  })

  it('tolérant : clé inconnue ou répétée ignorée, document oublié ajouté à la fin, sans dossier : rien à écrire', () => {
    const issues: TreeIssue[] = []
    const t = buildTree(['ch2', 'ghost', { folder: '  Partie   un ', items: ['ch1', 'ch2'] }], KEYS, issues)
    expect(issues.map((i) => [i.what, i.detail])).toEqual([
      ['unknown-key', 'ghost'],
      ['duplicate-key', 'ch2'],
    ])
    expect(docOrder(t)).toEqual(['ch2', 'ch1', 'intro', 'annex'])
    expect(treeJson(t)).toEqual(['ch2', { folder: 'Partie un', items: ['ch1'] }, 'intro', 'annex'])
    expect(treeJson(buildTree(['annex', 'intro'], KEYS))).toBeUndefined()
  })

  it('trop profond : le contenu remonte d’un cran', () => {
    let deep: TreeItem = { folder: 'f', items: ['ch1'] }
    for (let i = 0; i < TREE_LIMITS.depth + 2; i++) deep = { folder: `f${i}`, items: [deep] }
    const issues: TreeIssue[] = []
    const t = buildTree([deep], KEYS, issues)
    expect(issues.some((i) => i.what === 'too-deep')).toBe(true)
    expect(docOrder(t)).toContain('ch1')
    let depth = 0
    let n = t[0]
    while (n.kind === 'folder' && n.children[0]?.kind === 'folder') {
      n = n.children[0]
      depth++
    }
    expect(depth).toBeLessThan(TREE_LIMITS.depth)
  })

  it('déplacer : dans un dossier, à sa place ; jamais un dossier dans lui-même ou dans un de ses dossiers', () => {
    const t = buildTree(TREE, KEYS)
    const chapters = t[1]
    if (chapters.kind !== 'folder') throw new Error('dossier')
    const drafts = chapters.children[1]
    if (drafts.kind !== 'folder') throw new Error('dossier')
    expect(moveNode(t, 'annex', chapters.id, 0)).toBe(true)
    expect(docOrder(t)).toEqual(['intro', 'annex', 'ch1', 'ch2'])
    // Même liste, plus loin : la place est comptée avant le déplacement.
    expect(moveNode(t, 'intro', null, 2)).toBe(true)
    expect(t.map((n) => (n.kind === 'doc' ? n.key : n.title))).toEqual(['Chapitres', 'intro'])
    expect(canMove(t, chapters.id, drafts.id)).toBe(false)
    expect(canMove(t, chapters.id, chapters.id)).toBe(false)
    expect(moveNode(t, chapters.id, drafts.id, 0)).toBe(false)
    expect(moveNode(t, drafts.id, null, 0)).toBe(true)
    expect(locate(t, 'ch2')!.depth).toBe(1)
  })

  it('une partie de l’arbre (enregistrer un dossier à part) : les dossiers vides en sortent', () => {
    const t = buildTree(TREE, KEYS)
    expect(treeJson(subtree(t, new Set(['ch2', 'annex'])))).toEqual([{ folder: 'Chapitres', items: [{ folder: 'Brouillons', items: ['ch2'] }] }, 'annex'])
  })
})

const FILE = {
  format: 'folio/doc',
  version: 1,
  key: 'intro',
  meta: { title: 'Intro' },
  blocks: ['Intro.'],
  documents: [
    { key: 'ch1', meta: { title: 'Un' }, blocks: [{ content: ['Voir ', { text: 'deux', link: '#ch2:' }, ' et ', { type: 'xref', doc: 'ch2', target: 'b', show: 'text' }] }] },
    { key: 'ch2', meta: { title: 'Deux' }, blocks: [{ content: [{ type: 'bookmark', name: 'b' }, 'Deux.'] }] },
  ],
  tree: ['intro', { folder: 'Chapitres', items: ['ch1', 'ch2', 'nope'] }],
}

describe('le format', () => {
  it('« tree » se lit (clé inconnue signalée), se garde, et passe dans la forme compacte', () => {
    const r = loadDocument(FILE)
    if (!r.ok) throw new Error('chargement')
    expect(r.doc.tree).toEqual(['intro', { folder: 'Chapitres', items: ['ch1', 'ch2'] }])
    expect(r.report.issues.some((i) => i.kind === 'ignored' && i.detail === 'nope')).toBe(true)
    expect(toCompact(r.doc).tree).toEqual(r.doc.tree)
    // Un « tree » dans un document secondaire est ignoré.
    const r2 = loadDocument({ ...FILE, tree: undefined, documents: [{ ...FILE.documents[0], tree: ['ch1'] }, FILE.documents[1]] })
    if (!r2.ok) throw new Error('chargement')
    expect(r2.report.issues.some((i) => i.path === 'documents[0].tree')).toBe(true)
  })

  it('un seul document rangé dans un dossier garde sa clé ; découpé, le fichier perd « tree »', () => {
    const one = { ...(FILE as unknown as FolioDoc), documents: undefined }
    const joined = joinFile([one], [{ folder: 'Seul', items: ['intro'] }])
    expect(joined.key).toBe('intro')
    expect(joined.tree).toEqual([{ folder: 'Seul', items: ['intro'] }])
    expect(joined.documents).toBeUndefined()
    expect(splitFile(joined)[0].tree).toBeUndefined()
    expect(joinFile([one]).key).toBeUndefined()
  })

  it('documents venus d’un autre fichier : clés libres ici, et leurs liens et renvois suivent', () => {
    const r = loadDocument(FILE)
    if (!r.ok) throw new Error('chargement')
    const docs = splitFile(r.doc)
    const map = rekeyDocuments(docs, ['intro', 'ch2', 'doc1'])
    expect(docs.map((d) => d.key)).toEqual(['doc2', 'ch1', 'doc3'])
    expect(map.get('ch2')).toBe('doc3')
    const json = JSON.stringify(docs[1].blocks)
    expect(json).toContain('"link":"#doc3:"')
    expect(json).toContain('"doc":"doc3"')
  })
})
