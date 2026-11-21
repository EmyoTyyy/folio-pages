// Fichier joint (Insertion → Objet → Fichier joint) : une pastille à son nom
// dans le texte. Un double-clic (ou Entrée sur la pastille sélectionnée)
// enregistre le fichier sur l'ordinateur ; il n'est jamais ouvert dans la page.

import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, Plugin, type EditorState } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { schema } from './schema'

export interface AttachmentHooks {
  /** Taille lisible (« 12 Ko »). */
  size: (bytes: number) => string
  /** Bulle : nom, taille, comment l'enregistrer. */
  title: (name: string, size: string) => string
}

/** Octets d'une URI data: base64. */
export function bytesOfData(uri: string): Uint8Array {
  const comma = uri.indexOf(',')
  const bin = atob(uri.slice(comma + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Enregistre le fichier joint sur l'ordinateur (téléchargement sous son nom). */
export function saveAttachment(attrs: { src: string; name: string }): boolean {
  if (!attrs.src.startsWith('data:')) return false
  const blob = new Blob([bytesOfData(attrs.src) as BlobPart], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = attrs.name || 'fichier'
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}

/** La pastille sélectionnée, s'il y en a une. */
export function selectedAttachment(state: EditorState): PMNode | null {
  const sel = state.selection
  return sel instanceof NodeSelection && sel.node.type === schema.nodes.attachment ? sel.node : null
}

export class AttachmentView implements NodeView {
  dom: HTMLElement

  constructor(
    private node: PMNode,
    hooks?: AttachmentHooks,
  ) {
    this.dom = document.createElement('span')
    this.dom.className = 'fp-attach'
    this.dom.contentEditable = 'false'
    this.dom.dataset.attachment = ''
    const name = document.createElement('span')
    name.className = 'fp-attach__name'
    name.textContent = node.attrs.name
    this.dom.append(name)
    const bytes = node.attrs.size as number | null
    const size = bytes !== null && hooks ? hooks.size(bytes) : ''
    if (size) {
      const s = document.createElement('span')
      s.className = 'fp-attach__size'
      s.textContent = size
      this.dom.append(s)
    }
    if (hooks) this.dom.title = hooks.title(node.attrs.name, size)
    this.dom.addEventListener('dblclick', (e) => {
      e.preventDefault()
      saveAttachment(this.node.attrs as { src: string; name: string })
    })
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type || node.attrs.src !== this.node.attrs.src || node.attrs.name !== this.node.attrs.name || node.attrs.size !== this.node.attrs.size) return false
    this.node = node
    return true
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  ignoreMutation(): boolean {
    return true
  }
}

/** Entrée sur une pastille sélectionnée : le fichier est enregistré (au lieu de remplacer la pastille). */
export function attachmentKeys(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown: (view: EditorView, e: KeyboardEvent) => {
        if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false
        const node = selectedAttachment(view.state)
        if (!node) return false
        saveAttachment(node.attrs as { src: string; name: string })
        return true
      },
    },
  })
}
