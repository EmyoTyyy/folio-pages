// Dispositions d'images dans l'éditeur : vue (le dessin SVG aux couleurs du
// thème), insertion, modification, et images sélectionnées changées en
// disposition (Format de l'image → Disposition de l'image).

import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, Plugin, type Command, type EditorState } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { chartLook } from '../format/chart'
import { PICTURES_LIMITS, picturesDrawing, type PictureLayout } from '../format/pictures'
import type { PicturesBlock, Theme } from '../format/types'
import { schema } from './schema'

const n = schema.nodes

/** Une image d'une disposition, dans l'éditeur : l'image en data: (et sa ressource d'origine). */
export interface PicItem {
  src: string
  assetId: string | null
  caption: string
  text: string
}

/** Les réglages d'une disposition, dans l'éditeur. */
export interface PicturesAttrs {
  layout: PictureLayout
  title: string
  items: PicItem[]
  color: PicturesBlock['color'] | null
}

export interface PicturesHooks {
  /** Modifier la disposition (double-clic, Entrée). */
  edit: (pos: number) => void
  /** Infobulle. */
  label: () => string
}

/** Pour dessiner : le bloc, ses images déjà en data:. */
export const drawable = (a: PicturesAttrs): PicturesBlock => ({
  type: 'pictures',
  layout: a.layout,
  items: a.items.map((it) => ({ ...(it.src ? { src: it.src } : {}), ...(it.caption ? { caption: it.caption } : {}), ...(it.text ? { text: it.text } : {}) })),
  ...(a.title ? { title: a.title } : {}),
  ...(a.color ? { color: a.color } : {}),
})

const dataOnly = (s: string | undefined) => (s && /^data:image\//i.test(s) ? s : null)

/** Le dessin d'une disposition de l'éditeur (SVG). */
export function picturesSvg(a: PicturesAttrs, theme: Theme, lang: string): string {
  return picturesDrawing(drawable(a), chartLook(theme, lang), dataOnly).svg
}

const views = new Set<PicturesView>()

export class PicturesView implements NodeView {
  dom: HTMLElement
  private drawn: { attrs: unknown; theme: unknown; lang: unknown } | null = null

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private hooks: PicturesHooks | undefined,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'fp-pictures'
    this.dom.contentEditable = 'false'
    this.dom.addEventListener('dblclick', (e) => {
      const pos = this.getPos()
      if (pos === undefined || !this.view.editable) return
      e.preventDefault()
      this.hooks?.edit(pos)
    })
    views.add(this)
    this.render()
  }

  render(): void {
    const a = this.view.state.doc.attrs
    // Les images peuvent être lourdes : on compare les objets, pas leur texte.
    const d = this.drawn
    if (d && d.attrs === this.node.attrs && d.theme === a.theme && d.lang === a.lang) return
    this.drawn = { attrs: this.node.attrs, theme: a.theme, lang: a.lang }
    this.dom.title = this.hooks?.label() ?? ''
    this.dom.dataset.layout = this.node.attrs.layout
    const tpl = document.createElement('template')
    tpl.innerHTML = picturesSvg(this.node.attrs as PicturesAttrs, a.theme as Theme, a.lang as string)
    this.dom.replaceChildren(tpl.content)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  stopEvent(e: Event): boolean {
    return e.type === 'dblclick'
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    views.delete(this)
  }
}

/** Le thème change : les dispositions suivent ; Entrée sur une disposition sélectionnée la modifie. */
export function picturesPlugin(hooks: PicturesHooks | undefined): Plugin {
  return new Plugin({
    view: () => ({
      update: (view, prev) => {
        const a = view.state.doc.attrs
        const b = prev.doc.attrs
        if (a.theme === b.theme && a.lang === b.lang) return
        for (const v of views) v.render()
      },
    }),
    props: {
      handleKeyDown: (view, e) => {
        const sel = view.state.selection
        if (e.key !== 'Enter' || !(sel instanceof NodeSelection) || sel.node.type !== n.pictures || !hooks) return false
        hooks.edit(sel.from)
        return true
      },
    },
  })
}

/** La disposition sélectionnée, s'il y en a une. */
export function picturesAt(state: EditorState): { pos: number; attrs: PicturesAttrs } | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.node.type === n.pictures) return { pos: sel.from, attrs: sel.node.attrs as PicturesAttrs }
  return null
}

const cleanAttrs = (a: PicturesAttrs): PicturesAttrs => ({
  layout: a.layout,
  title: a.title.trim().slice(0, PICTURES_LIMITS.caption),
  color: a.color ?? null,
  items: a.items.slice(0, PICTURES_LIMITS.items).map((it) => ({ src: it.src, assetId: it.assetId, caption: it.caption.trim().slice(0, PICTURES_LIMITS.caption), text: it.text.trim().slice(0, PICTURES_LIMITS.text) })),
})

/** Insère une disposition après le bloc du curseur ; elle est sélectionnée. */
export function insertPictures(a: PicturesAttrs): Command {
  return (state, dispatch) => {
    const { $to } = state.selection
    const pos = $to.depth ? $to.after(1) : $to.pos
    if (dispatch) {
      const tr = state.tr.insert(pos, n.pictures.create(cleanAttrs(a)))
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView())
    }
    return true
  }
}

/** Remplace une disposition. */
export function updatePictures(pos: number, a: PicturesAttrs): Command {
  return (state, dispatch) => {
    if (state.doc.nodeAt(pos)?.type !== n.pictures) return false
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(pos, null, cleanAttrs(a))
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)))
    }
    return true
  }
}

/** Les images (figures) de la sélection : celle qui est sélectionnée, ou toutes celles de la plage. */
export function figuresInSelection(state: EditorState): { pos: number; node: PMNode }[] {
  const sel = state.selection
  if (sel instanceof NodeSelection) return sel.node.type === n.figure ? [{ pos: sel.from, node: sel.node }] : []
  const out: { pos: number; node: PMNode }[] = []
  if (sel.empty) return out
  state.doc.nodesBetween(sel.from, sel.to, (node, pos) => {
    if (node.type === n.figure) {
      out.push({ pos, node })
      return false
    }
    return true
  })
  return out.slice(0, PICTURES_LIMITS.items)
}

/** Une image (figure) devenue élément d'une disposition : l'image, sa légende (sinon son texte de remplacement). */
export const itemOfFigure = (fig: PMNode): PicItem => ({
  src: String(fig.attrs.src ?? ''),
  assetId: (fig.attrs.assetId as string | null) ?? null,
  caption: (fig.textContent.trim() || '').slice(0, PICTURES_LIMITS.caption),
  text: '',
})

/**
 * Les images sélectionnées deviennent une disposition (à la place de la première,
 * les autres retirées) ; une seule étape annulable. `a` : les réglages (sinon une grille).
 */
export function figuresToPictures(a: Partial<PicturesAttrs> = {}): Command {
  return (state, dispatch) => {
    const figs = figuresInSelection(state)
    if (!figs.length) return false
    if (dispatch) {
      const attrs = cleanAttrs({ layout: a.layout ?? 'grid', title: a.title ?? '', color: a.color ?? null, items: a.items ?? figs.map((f) => itemOfFigure(f.node)) })
      const tr = state.tr
      for (let i = figs.length - 1; i > 0; i--) {
        const { pos, node } = figs[i]
        // Seule dans sa case (de tableau, d'encadré…) : un paragraphe vide garde la place.
        if (tr.doc.resolve(pos).parent.childCount === 1) tr.replaceWith(pos, pos + node.nodeSize, n.paragraph.create())
        else tr.delete(pos, pos + node.nodeSize)
      }
      tr.replaceWith(figs[0].pos, figs[0].pos + figs[0].node.nodeSize, n.pictures.create(attrs))
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, figs[0].pos)).scrollIntoView())
    }
    return true
  }
}
