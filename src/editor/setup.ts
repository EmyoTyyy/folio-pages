// Greffons et raccourcis de l'éditeur.
//
// Raccourcis : ceux de tout traitement de texte, en évitant ceux que les
// navigateurs se réservent (Ctrl+L, Ctrl+N, Ctrl+T…) : l'alignement est sur
// Ctrl+Maj+L/E/R/J, comme dans les traitements de texte en ligne.

import { baseKeymap, chainCommands, exitCode } from 'prosemirror-commands'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { history, redo, undo } from 'prosemirror-history'
import { undoInputRule } from 'prosemirror-inputrules'
import { keymap } from 'prosemirror-keymap'
import { sinkListItem, splitListItem } from 'prosemirror-schema-list'
import { Plugin, type Command } from 'prosemirror-state'
import { ReplaceAroundStep } from 'prosemirror-transform'
import { columnResizing, goToNextCell, tableEditing } from 'prosemirror-tables'
import type { StyleDef } from '../format/types'
import {
  applyStyle,
  changeCase,
  clearFormatting,
  insertColumnBreak,
  insertField,
  insertPageBreak,
  insertText,
  outdentListItem,
  setAlign,
  stepFontSize,
  toggleFlag,
  toggleList,
  checklistPlugin,
  type CaseMode,
} from './commands'
import { findPlugin } from './find'
import { highlightPlugin } from './highlight'
import { markdownInputRules } from './inputrules'
import { autoCorrectPlugin, type AutoCorrectOptions } from './autocorrect'
import { multiSelectionPlugin } from './multiselect'
import { numberingPlugin } from './numbering'
import { pastePlugin, type PasteHooks } from './paste'
import { schema } from './schema'
import { paginationPlugin } from '../layout/pages'
import { commentsPlugin } from './comments'
import { trackPlugin, type TrackContext } from './track'
import { notesPlugin, type NotesContext } from './notes'
import { mathPlugin, type MathHooks } from './math'
import { linksPlugin, type LinkHooks } from './links'
import { mergePlugin } from './merge'
import { refsPlugin, type RefsHooks } from './refs'
import { FigureView, FolioTableView, captionFocusPlugin, fieldsKey, fieldsPlugin, tocPlugin, type FieldContextProvider, type FigureHooks } from './views'
import { CalloutView, type CalloutHooks } from './callout'
import { ChartView, chartKeyPlugin, chartThemePlugin, type ChartHooks } from './chart'
import { DiagramView, diagramPlugin, type DiagramHooks } from './diagram'
import { PicturesView, picturesPlugin, type PicturesHooks } from './pictures'
import { ShapeView, shapesPlugin, type ShapeHooks } from './shapes'
import { currentBlockPlugin } from './current'
import { longSentencesPlugin } from './longsentences'
import { redactPlugin } from './redact'
import { FormView, formsOnlyPlugin, type FormHooks } from './forms'
import { AttachmentView, attachmentKeys, type AttachmentHooks } from './attachment'
import { outlinePlugin } from './outlineview'
import { inkPlugin } from './ink'

const n = schema.nodes

const insertHardBreak: Command = (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(n.hard_break.create()).scrollIntoView())
  return true
}

/** Tab hors liste et hors tableau : une tabulation, comme dans tout traitement de texte. */
const insertTab: Command = (state, dispatch) => {
  dispatch?.(state.tr.insertText('\t').scrollIntoView())
  return true
}

const swallow: Command = () => true

/** Maj+F3 : minuscules → MAJUSCULES → Première lettre, comme dans les traitements de texte. */
function cycleCase(): Command {
  let last: CaseMode = 'title'
  return (state, dispatch) => {
    const order: CaseMode[] = ['lower', 'upper', 'title']
    last = order[(order.indexOf(last) + 1) % order.length]
    return changeCase(last)(state, dispatch)
  }
}

/**
 * Un clic sur la bordure d'une colonne, sans la déplacer, ne doit rien changer :
 * le module des tableaux fixerait sinon la largeur de toutes les colonnes,
 * modification invisible qui coûterait une étape d'annulation.
 */
function columnClickGuard(): Plugin {
  let until = 0
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown: (view, e) => {
          if (!view.dom.classList.contains('resize-cursor')) return false
          const x = e.clientX
          const up = (ev: MouseEvent) => {
            window.removeEventListener('mouseup', up, true)
            if (Math.abs(ev.clientX - x) < 3) until = Date.now() + 200
          }
          window.addEventListener('mouseup', up, true)
          return false
        },
      },
    },
    filterTransaction: (tr) => !!tr.getMeta('collab$') || !(Date.now() < until && tr.docChanged && tr.steps.every((s) => s instanceof ReplaceAroundStep)),
  })
}

export const commands = {
  undo,
  redo,
  bold: toggleFlag('bold'),
  italic: toggleFlag('italic'),
  underline: toggleFlag('underline'),
}

export interface EditorContext {
  styles: () => Record<string, StyleDef>
  fields: FieldContextProvider
  figure: FigureHooks
  paste: PasteHooks
  /** Markdown à la frappe (préférence). */
  markdownTyping: () => boolean
  /** Correction automatique : ses réglages, ou null si elle est désactivée. */
  autoCorrect?: () => AutoCorrectOptions | null
  /** Table des matières : numéro de page d'une position, aller à un titre, textes. */
  toc?: { pageOf: (pos: number) => string | null; jump: (pos: number) => void; labels: () => { empty: string; untitled: string } }
  /** Notes : numéros, ouverture d'une note à la modification. */
  notes?: NotesContext
  /** Suivi des modifications : l'auteur. */
  track?: TrackContext
  /** Équations : modifier une formule, message d'erreur. */
  math?: MathHooks
  /** Liens : les suivre (Ctrl+clic), les modifier depuis la bulle. */
  links?: LinkHooks
  /** Références : légendes, renvois, index, citations, listes générées. */
  refs?: RefsHooks
  /** Encadrés : menu du type, libellés. */
  callout?: CalloutHooks
  /** Champs de formulaire : libellés. */
  forms?: FormHooks
  /** Diagrammes : modifier, infobulle. */
  diagram?: DiagramHooks
  /** Dispositions d'images : modifier, infobulle. */
  pictures?: PicturesHooks
  /** Formes et zones de texte : écrire dedans, infobulle. */
  shapes?: ShapeHooks
  /** Fichiers joints : taille lisible, bulle. */
  attachment?: AttachmentHooks
  /** Graphiques : modification. */
  chart?: ChartHooks
  /** Raccourcis de l'application traités hors de l'éditeur (Ctrl+K, Ctrl+F…). */
  onShortcut?: (name: 'link' | 'find' | 'replace' | 'painter-copy' | 'painter-paste' | 'footnote' | 'endnote' | 'comment' | 'equation' | 'mark-entry' | 'mark-citation' | 'bookmark' | 'thesaurus' | 'goto' | 'snippet' | 'define-term' | 'highlight' | 'table' | 'picture') => boolean
}

export function editorPlugins(ctx?: EditorContext): Plugin[] {
  const shortcut = (name: Parameters<NonNullable<EditorContext['onShortcut']>>[0]): Command => () => ctx?.onShortcut?.(name) ?? false
  // Entrée sur un fichier joint sélectionné : avant les raccourcis, qui remplaceraient la pastille.
  const plugins: Plugin[] = [attachmentKeys(), outlinePlugin()]
  // Les notes d'abord : Entrée sur un appel sélectionné ouvre la note (sinon Entrée le remplacerait).
  if (ctx?.notes) plugins.push(notesPlugin(ctx.notes))
  // Entrée sur une formule sélectionnée l'ouvre (avant le remplacement par Entrée).
  if (ctx?.math) plugins.push(mathPlugin(ctx.math))
  // De même pour un graphique ; ses couleurs suivent le thème.
  plugins.push(chartKeyPlugin(ctx?.chart), chartThemePlugin(), diagramPlugin(ctx?.diagram), picturesPlugin(ctx?.pictures), shapesPlugin(ctx?.shapes))
  // Le suivi des modifications retient la touche (Retour arrière ou Suppr) avant qu'elle agisse.
  if (ctx?.track) plugins.push(trackPlugin(ctx.track))
  const rules = markdownInputRules()
  if (ctx) {
    // Les règles de frappe se désactivent par préférence sans recréer l'éditeur.
    const props = rules.props as { handleTextInput?: (...args: unknown[]) => boolean }
    const original = props.handleTextInput
    if (original) props.handleTextInput = (...args: unknown[]) => (ctx.markdownTyping() ? original.apply(rules, args) : false)
  }
  plugins.push(rules)
  // Après le Markdown : « - » en début de ligne reste une puce, « *mot* » de l'italique.
  if (ctx?.autoCorrect) plugins.push(autoCorrectPlugin(ctx.autoCorrect))
  plugins.push(
    history({ depth: 500, newGroupDelay: 600 }),
    keymap({
      'Mod-z': undo,
      'Mod-y': redo,
      'Shift-Mod-z': redo,
      Backspace: undoInputRule,
      'Mod-b': toggleFlag('bold'),
      'Mod-i': toggleFlag('italic'),
      'Mod-u': toggleFlag('underline'),
      'Mod-Shift-x': toggleFlag('strike'),
      'Mod-.': toggleFlag('sup'),
      'Mod-,': toggleFlag('sub'),
      'Mod-Shift-l': setAlign('left'),
      'Mod-Shift-e': setAlign('center'),
      'Mod-Shift-r': setAlign('right'),
      'Mod-Shift-j': setAlign('justify'),
      'Mod-Alt-0': applyStyle('normal'),
      'Mod-Alt-1': applyStyle('heading1'),
      'Mod-Alt-2': applyStyle('heading2'),
      'Mod-Alt-3': applyStyle('heading3'),
      'Mod-Alt-4': applyStyle('heading4'),
      'Mod-Alt-5': applyStyle('heading5'),
      'Mod-Alt-6': applyStyle('heading6'),
      'Mod-Shift-7': toggleList('number'),
      'Mod-Shift-8': toggleList('bullet'),
      // 7 numérotée, 8 à puces, 9 cases à cocher.
      'Mod-Shift-9': toggleList('check'),
      // H comme « highlight » : le surligneur (de la dernière couleur), ou l'enlever.
      'Mod-Alt-h': shortcut('highlight'),
      // T comme tableau, I comme image.
      'Mod-Alt-t': shortcut('table'),
      'Mod-Alt-i': shortcut('picture'),
      // Espace insécable ; saut de colonne (à côté du saut de page, Ctrl+Entrée).
      'Mod-Shift-Space': insertText('\u00a0'),
      'Mod-Shift-Enter': insertColumnBreak,
      // Champs : D comme date, T comme time (heure), P comme page.
      'Alt-Shift-d': insertField('date'),
      'Alt-Shift-D': insertField('date'),
      'Alt-Shift-t': insertField('time'),
      'Alt-Shift-T': insertField('time'),
      'Alt-Shift-p': insertField('page'),
      'Alt-Shift-P': insertField('page'),
      'Mod-\\': clearFormatting,
      'Mod-Space': clearFormatting,
      'Mod-Shift-.': (s, d) => stepFontSize(1, ctx?.styles() ?? {})(s, d),
      'Mod-Shift->': (s, d) => stepFontSize(1, ctx?.styles() ?? {})(s, d),
      'Mod-Shift-,': (s, d) => stepFontSize(-1, ctx?.styles() ?? {})(s, d),
      'Mod-Shift-<': (s, d) => stepFontSize(-1, ctx?.styles() ?? {})(s, d),
      'Shift-F3': cycleCase(),
      'Mod-k': shortcut('link'),
      'Mod-f': shortcut('find'),
      'Mod-h': shortcut('replace'),
      'Mod-Alt-c': shortcut('painter-copy'),
      'Mod-Alt-v': shortcut('painter-paste'),
      'Mod-Alt-f': shortcut('footnote'),
      'Mod-Alt-d': shortcut('endnote'),
      'Mod-Alt-m': shortcut('comment'),
      'Alt-=': shortcut('equation'),
      'Alt-Shift-=': shortcut('equation'),
      'Alt-Shift-x': shortcut('mark-entry'),
      'Alt-Shift-X': shortcut('mark-entry'),
      'Alt-Shift-i': shortcut('mark-citation'),
      'Alt-Shift-I': shortcut('mark-citation'),
      'Alt-Shift-g': shortcut('define-term'),
      'Alt-Shift-G': shortcut('define-term'),
      'Mod-Shift-F5': shortcut('bookmark'),
      'Shift-F7': shortcut('thesaurus'),
      'Mod-g': shortcut('goto'),
      // F3 : le mot avant le curseur devient l'extrait qu'il désigne.
      F3: shortcut('snippet'),
      F5: shortcut('goto'),
      Enter: splitListItem(n.list_item),
      'Shift-Enter': chainCommands(exitCode, insertHardBreak),
      'Mod-Enter': chainCommands(exitCode, insertPageBreak),
      // Trait d'union conditionnel (visible seulement si le mot est coupé là).
      'Mod--': (state, dispatch) => (dispatch?.(state.tr.insertText('\u00ad').scrollIntoView()), true),
      // Tab : niveau de liste suivant, cellule suivante, sinon une tabulation.
      Tab: chainCommands(sinkListItem(n.list_item), goToNextCell(1), insertTab),
      'Shift-Tab': chainCommands(outdentListItem, goToNextCell(-1), swallow),
    }),
    keymap(baseKeymap),
    dropCursor({ color: 'var(--fp-accent)', width: 2 }),
    gapCursor(),
    numberingPlugin(),
    checklistPlugin(),
    currentBlockPlugin(),
    longSentencesPlugin(),
    redactPlugin(),
    formsOnlyPlugin(ctx?.forms),
    inkPlugin(),
    multiSelectionPlugin(),
    findPlugin(),
    highlightPlugin(),
  )
  if (ctx) {
    plugins.push(
      columnClickGuard(),
      columnResizing({ View: FolioTableView, cellMinWidth: 36, lastColumnResizable: false }),
      fieldsPlugin(ctx.fields),
      pastePlugin(ctx.paste),
      ...(ctx.links ? [linksPlugin(ctx.links)] : []),
      mergePlugin(),
      captionFocusPlugin(),
      paginationPlugin(),
      ...(ctx.toc ? [tocPlugin(ctx.toc.pageOf, ctx.toc.jump, ctx.toc.labels)] : []),
      ...(ctx.refs ? [refsPlugin(ctx.refs, [fieldsKey])] : []),
      commentsPlugin(),
    )
  }
  plugins.push(tableEditing())
  return plugins
}

/** Vues de nœuds de l'éditeur. */
export function nodeViews(ctx: EditorContext) {
  return {
    figure: (node: import('prosemirror-model').Node, view: import('prosemirror-view').EditorView, getPos: () => number | undefined) =>
      new FigureView(node, view, getPos, ctx.figure),
    callout: (node: import('prosemirror-model').Node, view: import('prosemirror-view').EditorView, getPos: () => number | undefined) => new CalloutView(node, view, getPos, ctx.callout),
    formfield: (node: import('prosemirror-model').Node, view: import('prosemirror-view').EditorView, getPos: () => number | undefined) => new FormView(node, view, getPos, ctx.forms),
    attachment: (node: import('prosemirror-model').Node) => new AttachmentView(node, ctx.attachment),
    chart: (node: import('prosemirror-model').Node, view: import('prosemirror-view').EditorView, getPos: () => number | undefined) => new ChartView(node, view, getPos, ctx.chart),
    diagram: (node: import('prosemirror-model').Node, view: import('prosemirror-view').EditorView, getPos: () => number | undefined) => new DiagramView(node, view, getPos, ctx.diagram),
    pictures: (node: import('prosemirror-model').Node, view: import('prosemirror-view').EditorView, getPos: () => number | undefined) => new PicturesView(node, view, getPos, ctx.pictures),
    shape: (node: import('prosemirror-model').Node, view: import('prosemirror-view').EditorView, getPos: () => number | undefined, decorations: readonly import('prosemirror-view').Decoration[]) =>
      new ShapeView(node, view, getPos, ctx.shapes, decorations),
  }
}
