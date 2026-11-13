// Modifier un en-tête, un pied de page ou une note : un petit éditeur ouvert à
// sa place, sur la feuille (double-clic, clic ou ruban). À la fermeture, le
// contenu revient dans le document en une seule étape annulable.

import { baseKeymap } from 'prosemirror-commands'
import { history, redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { EditorState, Plugin, TextSelection } from 'prosemirror-state'
import { finalSlice } from '../editor/paste'
import { EditorView } from 'prosemirror-view'
import type { FolioApp } from '../app'
import { setAlign, toggleFlag } from '../editor/commands'
import { blocksToPM, pmToBlocks } from '../editor/convert'
import { markdownInputRules } from '../editor/inputrules'
import { schema } from '../editor/schema'
import { FigureView, fieldsPlugin } from '../editor/views'
import { mathContextOf, mathPlugin } from '../editor/math'
import type { Block } from '../format/types'
import { t } from '../i18n/i18n'
import type { Key } from '../i18n/dict'
import type { HeaderKind, HeaderWhich } from './sheets'
import { fetchImageAsDataUrl } from '../editor/images'
import { settings } from '../settings'

export class HeaderFooterEditor {
  readonly view: EditorView
  private closed = false

  constructor(
    private app: FolioApp,
    readonly kind: HeaderKind | 'note',
    readonly which: HeaderWhich,
    /** Contenu actuel, et écriture du nouveau contenu (document, saut de section ou note). */
    private io: {
      read: () => Block[]
      write: (blocks: Block[], assets: Record<string, string>) => void
      /** Numéro de page des champs {{page}}. */
      label: string
      /** Nom de la zone pour les lecteurs d'écran (par défaut : en-tête ou pied de page). */
      ariaLabel?: string
      /** Un contenu vide reste un paragraphe vide (une note), au lieu de « rien » (un en-tête). */
      keepEmpty?: boolean
      /** Après une fermeture par Échap (retour au texte). */
      onEscape?: () => void
    },
    mount: HTMLElement,
    private onClose: () => void,
  ) {
    const a = app.state.doc.attrs
    const assets = a.hfAssets as Record<string, string>
    const doc = schema.nodes.doc.create(null, blocksToPM(io.read(), assets))
    const state = EditorState.create({
      schema,
      doc,
      plugins: [
        markdownInputRules(),
        // Un collage n'apporte ni commentaire, ni modification suivie.
        new Plugin({ props: { transformPasted: (slice) => finalSlice(slice, false) } }),
        history(),
        keymap({
          'Mod-z': undo,
          'Mod-y': redo,
          'Shift-Mod-z': redo,
          'Mod-b': toggleFlag('bold'),
          'Mod-i': toggleFlag('italic'),
          'Mod-u': toggleFlag('underline'),
          'Mod-Shift-l': setAlign('left'),
          'Mod-Shift-e': setAlign('center'),
          'Mod-Shift-r': setAlign('right'),
          // Pas de note ici : l'interface le dit.
          'Mod-Alt-f': () => app.onShortcut?.('footnote') ?? true,
          'Mod-Alt-d': () => app.onShortcut?.('endnote') ?? true,
          'Mod-Alt-m': () => app.onShortcut?.('comment') ?? true,
          Escape: () => {
            this.close()
            this.io.onEscape?.()
            return true
          },
        }),
        keymap(baseKeymap),
        mathPlugin({ ...app.mathHooks, context: () => mathContextOf(app.state) }),
        fieldsPlugin(() => ({
          ...app.fieldContext(),
          pageAt: () => 1,
          pages: app.pagesInfo?.pages() ?? 1,
          formatPage: () => io.label,
        })),
      ],
    })
    mount.classList.add('is-editing')
    const host = document.createElement('div')
    host.className = 'fp-hf-editor'
    mount.replaceChildren(host)
    this.view = new EditorView(host, {
      state,
      attributes: {
        class: 'fp-hf',
        'aria-label': io.ariaLabel ?? t(`hf.${kind === 'headers' ? 'header' : 'footer'}Label` as Key),
        spellcheck: settings().spellcheck ? 'true' : 'false',
      },
      nodeViews: {
        figure: (node, view, getPos) =>
          new FigureView(node, view, getPos, {
            label: (key, params) => t(`figure.${key}` as Key, params),
            fetchImage: fetchImageAsDataUrl,
            zoom: () => settings().zoom,
          }),
      },
      dispatchTransaction: (tr) => {
        this.view.updateState(this.view.state.apply(tr))
        app.notifyUi()
      },
    })
    app.alt = this.view
    this.view.focus()
    const end = TextSelection.atEnd(this.view.state.doc)
    this.view.dispatch(this.view.state.tr.setSelection(end))
  }

  /** Enregistre le contenu dans le document (une étape annulable) et ferme. */
  close(): void {
    if (this.closed) return
    this.closed = true
    const a = this.app.state.doc.attrs
    const { blocks, assets } = pmToBlocks(this.view.state.doc, a.hfAssets as Record<string, string>)
    // Un paragraphe vide seul : pas d'en-tête.
    const empty = blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].content.length
    const next = empty && !this.io.keepEmpty ? [] : blocks
    if (JSON.stringify(next) !== JSON.stringify(this.io.read())) this.io.write(next, assets)
    if (this.app.alt === this.view) this.app.alt = null
    this.view.destroy()
    this.onClose()
    this.app.notifyUi()
  }

  get isOpen(): boolean {
    return !this.closed
  }
}
