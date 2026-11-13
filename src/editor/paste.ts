// Presse-papiers et glisser-déposer : images (fichiers), texte Markdown,
// collage sans mise en forme (Ctrl+Maj+V), nettoyage du HTML des traitements
// de texte. Le HTML collé passe ensuite par le schéma, qui ne garde que les
// éléments connus.

import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model'
import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { parseMarkdown } from '../format/markdown'
import { findTex } from '../math'
import { blocksToPM } from './convert'
import { imageFiles, prepareFile } from './images'
import { schema } from './schema'

const n = schema.nodes

export interface PasteHooks {
  reduceImages: () => boolean
  /** Une image n'a pas pu être insérée (fichier trop lourd, illisible…). */
  onImageError: (reason: string) => void
}

/** Texte qui a l'air d'être du Markdown (titres, listes, emphase, liens, tableaux). */
export function looksLikeMarkdown(text: string): boolean {
  if (text.length > 2_000_000) return false
  // Des formules $…$ ou \(…\) : on les lit (le reste du texte passe tel quel).
  if (findTex(text.slice(0, 200_000)).length) return true
  const lines = text.split(/\r?\n/)
  let hits = 0
  for (const l of lines.slice(0, 400)) {
    if (/^(#{1,6}\s|\s*[-*+]\s+\S|\s*\d{1,3}[.)]\s+\S|>\s|```|\|.+\|)/.test(l)) hits++
    else if (/\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)|(^|\s)`[^`\n]+`/.test(l)) hits++
  }
  return hits >= 1 && (lines.length < 3 ? hits >= 1 : hits >= 2 || /^#{1,6}\s/m.test(text) || /\*\*[^*]+\*\*/.test(text))
}

/** Markdown → morceau de document à coller (ouvert aux deux bouts, comme un collage ordinaire). */
export function markdownSlice(text: string): Slice {
  const nodes = blocksToPM(parseMarkdown(text))
  return new Slice(Fragment.from(nodes), 1, nodes.length && nodes[nodes.length - 1].isTextblock ? 1 : 0)
}

/** Texte brut → paragraphes sans mise en forme. */
export function plainSlice(text: string): Slice {
  const paras = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => n.paragraph.create(null, l ? schema.text(l.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')) : null))
  return new Slice(Fragment.from(paras), 1, 1)
}

/** Commentaires conditionnels et balises propres aux traitements de texte. */
export function cleanOfficeHtml(html: string): string {
  return html
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')
    .replace(/<\/?(o|w|m|v):[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
}

/** Insère des images à une position (ou à la sélection), après les avoir préparées. */
export async function insertImageFiles(view: EditorView, files: File[], hooks: PasteHooks, at: number | null = null): Promise<number> {
  const docBefore = view.state.doc
  const prepared: PMNode[] = []
  for (const f of files) {
    try {
      const img = await prepareFile(f, hooks.reduceImages())
      prepared.push(n.figure.create({ src: img.src, alt: '', width: 0 }))
    } catch (e) {
      hooks.onImageError(e instanceof Error ? e.message : String(e))
    }
  }
  if (!prepared.length) return 0
  const state = view.state
  let pos = at !== null && state.doc === docBefore ? at : state.selection.from
  pos = Math.min(Math.max(0, pos), state.doc.content.size)
  const $pos = state.doc.resolve(pos)
  // Le bloc qui contient la position : on insère après lui (ou à la place d'un paragraphe vide).
  let depth = $pos.depth
  while (depth > 0) {
    const parent = $pos.node(depth - 1)
    if (parent.canReplaceWith($pos.index(depth - 1), $pos.index(depth - 1), n.figure)) break
    depth--
  }
  const tr = state.tr
  if (depth === 0) {
    tr.insert(state.doc.content.size, prepared)
  } else {
    const block = $pos.node(depth)
    const blockPos = $pos.before(depth)
    if (block.type === n.paragraph && block.content.size === 0) tr.replaceWith(blockPos, blockPos + block.nodeSize, prepared)
    else tr.insert(blockPos + block.nodeSize, prepared)
  }
  view.dispatch(tr.scrollIntoView())
  return prepared.length
}

export function pastePlugin(hooks: PasteHooks): Plugin {
  let plainUntil = 0
  return new Plugin({
    props: {
      handleKeyDown: (_view, e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') plainUntil = Date.now() + 1500
        return false
      },
      handlePaste: (view, event) => {
        const data = event.clipboardData
        if (!data) return false
        if (Date.now() < plainUntil) {
          const text = data.getData('text/plain')
          if (!text) return true // collage vide : on attend le vrai (le navigateur peut en envoyer deux)
          plainUntil = 0
          view.dispatch(view.state.tr.replaceSelection(plainSlice(text)).scrollIntoView())
          return true
        }
        const files = imageFiles(data)
        const html = data.getData('text/html')
        // Une image copiée depuis une page web arrive aussi en HTML ; s'il n'y a pas de texte, on prend le fichier.
        const htmlText = html ? html.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') : ''
        if (files.length && !htmlText) {
          event.preventDefault()
          void insertImageFiles(view, files, hooks)
          return true
        }
        return false
      },
      clipboardTextParser: (text, _$context, plain) => {
        if (!plain && looksLikeMarkdown(text)) return markdownSlice(text)
        return plainSlice(text)
      },
      transformPastedHTML: cleanOfficeHtml,
      // Ce qu'on colle est la version finale : sans texte supprimé, sans marque d'ajout,
      // sans commentaire (sauf quand on déplace un passage dans le document).
      transformPasted: (slice, view) => finalSlice(slice, !!(view as unknown as { dragging?: { move?: boolean } }).dragging?.move),
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const files = imageFiles((event as DragEvent).dataTransfer)
        if (!files.length) return false
        event.preventDefault()
        const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })
        void insertImageFiles(view, files, hooks, at ? at.pos : null)
        return true
      },
    },
  })
}

/** Version finale d'un morceau collé : texte supprimé retiré, ajouts devenus du texte, commentaires retirés. */
export function finalSlice(slice: Slice, keepComments: boolean): Slice {
  const marks = schema.marks
  let changed = false
  const clean = (f: Fragment): Fragment => {
    const out: PMNode[] = []
    f.forEach((n) => {
      if (n.isInline) {
        if (marks.deletion.isInSet(n.marks)) {
          changed = true
          return
        }
        const kept = n.marks.filter((m) => m.type !== marks.insertion && (keepComments || m.type !== marks.comment))
        if (kept.length !== n.marks.length) changed = true
        out.push(kept.length !== n.marks.length ? n.mark(kept) : n)
      } else out.push(n.copy(clean(n.content)))
    })
    return Fragment.from(out)
  }
  const content = clean(slice.content)
  return changed ? new Slice(content, slice.openStart, slice.openEnd) : slice
}
