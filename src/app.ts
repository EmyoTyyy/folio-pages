// Cœur de l'application : l'éditeur, l'état d'enregistrement, la copie de
// secours et les actions sur le document. L'interface (ui/) appelle ces
// méthodes ; window.folio (api.ts) aussi.

import { collab } from 'prosemirror-collab'
import type { SyncHub } from './sync/hub'
import type { SyncClient } from './sync/client'
import { TRACK_SKIP } from './editor/track'
import { selectAll } from 'prosemirror-commands'
import { closeHistory, redo, undo } from 'prosemirror-history'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, Selection, type Command, type Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { blocksToPM, designAttrs, docToPM, metaAttrs, pmToDoc, type Identity } from './editor/convert'
import { documentCss, type EditorFontFace } from './editor/docstyle'
import { fetchImageAsDataUrl } from './editor/images'
import { fixNumbering } from './editor/numbering'
import { schema } from './editor/schema'
import { editorPlugins, nodeViews, type EditorContext } from './editor/setup'
import { fieldsKey } from './editor/views'
import { setLink } from './editor/commands'
import type { MathHooks } from './editor/math'
import type { MathProblem } from './math'
import { toCompact } from './format/compact'
import type { FieldContext } from './format/fields'
import type { StyleDef, Theme, XrefShow } from './format/types'
import { settings } from './settings'
import type { Report } from './format/dsl'
import { prettyJson } from './format/json'
import { loadDocument, type LoadResult } from './format/load'
import { anchorSlug, combineDocuments, ensureKeys, freeKey, joinFile, parseDocLink, splitFile } from './format/documents'
import { crossRefValue, refsKey, type OtherDoc } from './editor/refs'
import { emptyMeta, mintId, type FolioDoc } from './format/types'
import type { Key } from './i18n/dict'
import { fileSize, formatDate, lang, t } from './i18n/i18n'
import { markupClasses } from './ui/markup'
import { deleteSnapshot, findBlankSnapshot, getSnapshot, pruneSnapshots, putSnapshot } from './file/recovery'
import { canWriteInPlace, fileNameFor, openedFileName, Saver, type FsHandle, type SaveOutcome } from './file/save'
import { rememberRecent } from './file/open'
import { addVersion, listVersions, type Version, type VersionReason } from './file/versions'
import { stats } from './editor/stats'
import { extractDocBlock, serializeShell } from './file/shell'
import { encryptText, forgetKeys, SessionSealer } from './file/crypto'
import { buildUpdatedFile, type ReleaseInfo } from './update'
import { deleteVersions } from './file/versions'
import { openDialog, toast } from './ui/dialog'
import { h } from './ui/dom'
import { effectiveList, type AutoCorrectOptions } from './editor/autocorrect'
import { withDefaultDesign } from './defaults'

/** blank : l'application vide ; template : un nouveau document ouvert à partir d'un modèle. */
export type BootKind = 'blank' | 'document' | 'recovered-text' | 'template'

export interface AppInit {
  doc: FolioDoc
  boot: BootKind
  report: Report | null
  /** Ouvert à partir d'un modèle : l'identité du modèle (pour le modifier lui-même). */
  templateId?: string
  /** Copie en lecture seule : s'ouvre en lecture. */
  readOnly?: boolean
  /** Document protégé : le mot de passe saisi à l'ouverture (gardé en mémoire seulement). */
  password?: string
}

/** Variantes d'enregistrement (CLAUDE.md 4.8). */
export type SaveVariant = 'copy' | 'new' | 'template' | 'readonly'

export type SaveStatus = 'pristine' | 'dirty' | 'saving' | 'saved' | 'downloaded' | 'error' | 'synced'

/** Ce qui compte pour comparer deux états du document (sans identité ni dates). */
function contentKey(doc: FolioDoc): string {
  const { title, author, subject, organization, keywords, lang: l } = doc.meta
  return JSON.stringify({
    meta: { title, author, subject, organization, keywords, lang: l },
    theme: doc.theme,
    styles: doc.styles,
    fonts: doc.fonts,
    blocks: doc.blocks,
    assets: doc.assets,
    documents: doc.documents?.map(contentKey),
  })
}

/**
 * Un document du fichier. Celui qui est affiché vit dans la vue (state et saved
 * sont alors ceux de l'application) ; les autres gardent ici leur état, avec
 * leur historique d'annulation.
 */
interface DocSlot {
  key: string
  state: EditorState | null
  /** Ce document tel qu'il est dans le fichier ; null s'il n'y est pas. */
  saved: PMNode | null
  /** Défilement quand on l'a quitté. */
  scroll: number
  /** Dernières pages connues de ses signets (vue page), pour les renvois des autres documents. */
  pages: Map<string, string> | null
}

export type ShortcutName = Parameters<NonNullable<EditorContext['onShortcut']>>[0]

function firstHeadingText(node: PMNode): string {
  let found = ''
  node.forEach((child) => {
    if (!found && child.type === schema.nodes.heading) found = child.textContent.trim()
  })
  return found
}

const SNAPSHOT_DELAY = 600
const SNAPSHOT_MAX_WAIT = 3000
/** Une version automatique toutes les dix minutes d'édition. */
export const AUTO_VERSION_MS = 10 * 60 * 1000

export class FolioApp {
  readonly view: EditorView
  /** Contexte de l'éditeur (aussi pour les volets du fractionnement). */
  editorCtx!: EditorContext
  /** Autres vues du document : volets et fenêtres ouvertes d'ici (fenêtre principale). */
  sync: SyncHub | null = null
  /** Fenêtre ouverte par une autre : elle lui envoie ses modifications. */
  syncClient: SyncClient | null = null
  /** Numéro de cette fenêtre (1 : la principale). */
  windowIndex = 1
  /** Après un changement complet d'état (document ouvert, historique oublié). */
  onStateReset: (() => void) | null = null
  boot: BootKind
  /** Mode lecture : le document ne se modifie pas. */
  reading = false
  /** Copie en lecture seule : on n'en sort qu'en faisant une copie modifiable. */
  lockedReadOnly = false
  /** Ouvert à partir d'un modèle : l'identité du modèle. */
  templateId: string | null
  /** On modifie le modèle lui-même : il est enregistré comme modèle. */
  private editingTemplate = false
  /** Nom choisi par « Enregistrer comme nouveau document » (pour les enregistrements suivants). */
  private chosenName: string | null = null
  /** Dernière version ajoutée à l'historique (ms). */
  private lastVersionAt = Date.now()
  private versionWrites: Promise<unknown> = Promise.resolve()
  report: Report | null
  /** Le document de démonstration est affiché et n'a pas encore été remplacé ni enregistré. */
  isDemo: boolean
  private identity: Identity
  /** État du document tel qu'il est dans le fichier ; null si le fichier ne le contient pas. */
  private savedDoc: PMNode | null
  private lastSave: { kind: 'saved' | 'downloaded'; name: string } | null = null
  private saving = false
  private saveFailed = false
  private downloadExplained = false
  private saver: Saver
  private listeners = new Set<() => void>()
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null
  private snapshotDue = 0
  private readonly docStyle: HTMLStyleElement
  private styledFrom: unknown[] = []
  /** Raccourcis traités par l'interface (Ctrl+K, Ctrl+F…). */
  onShortcut: ((name: ShortcutName) => boolean) | null = null
  /** Éditeur secondaire en cours (en-tête, pied de page) : les commandes du ruban s'y appliquent. */
  alt: EditorView | null = null
  /** Pages (vue page) : numéro de page d'une position, nombre de pages, écriture des numéros. */
  pagesInfo: { pageAt: (pos: number) => number; index: (pos: number) => number; pages: () => number; format: (n: number) => string } | null = null
  /** Vue page : la feuille de la section d'une position (px non mis à l'échelle) ; « own » : la section a sa propre mise en page. */
  sectionFrame: ((pos: number) => { left: number; width: number; marginLeft: number; marginRight: number; own: boolean } | null) | null = null
  /** Ouvre une note à la modification (vue page ou vue web). */
  openNote: ((pos: number) => void) | null = null
  /** Un fichier (pas une image) déposé : l'interface l'ouvre. */
  onFileDrop: ((file: File) => void) | null = null
  /** Modifier le lien sous le curseur (l'interface ouvre sa fenêtre). */
  editLink: (() => void) | null = null
  private formHintAt = 0
  /** Menu du type d'un encadré (posé par l'interface). */
  calloutMenu: ((pos: number, anchor: HTMLElement) => void) | null = null
  /** Modifier un graphique (installé par l'interface). */
  editChart: ((pos: number) => void) | null = null
  editDiagram: ((pos: number) => void) | null = null
  /** Modifier une formule (l'interface ouvre l'éditeur d'équation). */
  editMath: ((view: EditorView, pos: number) => void) | null = null
  /** Branchements des équations, partagés avec les éditeurs secondaires. */
  readonly mathHooks: MathHooks = {
    edit: (view, pos) => this.editMath?.(view, pos),
    problem: (p) => describeMathProblem(p),
  }
  private docListeners = new Set<(tr: Transaction) => void>()
  /** Les documents du fichier, dans l'ordre des onglets ; `active` : celui qui est affiché. */
  private slots: DocSlot[] = []
  private active = 0
  /** Ordre des documents au dernier enregistrement (ajout, suppression, déplacement : à enregistrer). */
  private savedOrder = ''
  private plugins: ReturnType<typeof editorPlugins> = []
  /** Export de plusieurs documents : l'état réel, pendant qu'un document temporaire est affiché. */
  private realState: EditorState | null = null
  /** Défilement de la page (posé par l'interface), pour le retrouver en revenant sur un document. */
  scrollHooks: { get: () => number; set: (y: number) => void } | null = null
  /** Avant de changer de document (l'interface ferme ce qui est ouvert sur l'ancien). */
  onBeforeSwitch: (() => void) | null = null

  constructor(init: AppInit, mount: HTMLElement) {
    this.boot = init.boot
    this.report = init.report
    this.templateId = init.templateId ?? null
    this.lockedReadOnly = !!init.readOnly
    this.reading = !!init.readOnly
    this.isDemo = init.boot === 'blank'
    this.identity = { id: init.doc.id, created: init.doc.meta.created, modified: init.doc.meta.modified }
    if (init.password) this.sealer = new SessionSealer(init.password)
    const ctx: EditorContext = {
      styles: () => this.state.doc.attrs.styles as Record<string, StyleDef>,
      fields: (doc) => this.fieldContext(doc),
      figure: {
        label: (key, params) => t(`figure.${key}`, params),
        fetchImage: fetchImageAsDataUrl,
        zoom: () => settings().zoom,
      },
      paste: {
        reduceImages: () => settings().reduceImages,
        layout: () => ({ wrap: settings().imageWrap, align: settings().imageAlign }),
        onImageError: (reason) => toast(t(reason === 'too-large' ? 'image.tooLarge' : 'image.unreadable'), { kind: 'error' }),
      },
      markdownTyping: () => settings().markdownTyping,
      autoCorrect: () => this.autoCorrectOptions(),
      toc: {
        pageOf: (pos) => (this.pagesInfo && this.pagesInfo.pages() > 1 ? this.pagesInfo.format(this.pagesInfo.pageAt(pos)) : this.pagesInfo ? '1' : null),
        jump: (pos) => this.jumpTo(pos),
        labels: () => ({ empty: t('toc.empty'), untitled: t('nav.untitled') }),
      },
      refs: {
        pageOf: (pos) => (this.pagesInfo ? { index: this.pagesInfo.index(pos), label: this.pagesInfo.format(this.pagesInfo.pageAt(pos)) } : null),
        jump: (pos) => this.jumpTo(pos),
        other: (key) => this.otherDoc(key),
        jumpDoc: (key, bookmark) => void this.jumpToAnchor(`${key}:${bookmark}`),
        lang: () => lang(),
        labels: () => ({
          missingBookmark: t('ref.missingBookmark'),
          inDoc: (title) => t('docs.inDoc', { title }),
          above: t('ref.above'),
          below: t('ref.below'),
          emptyFigures: t('ref.emptyFigures'),
          emptyIndex: t('ref.emptyIndex'),
          emptyAuthorities: t('ref.emptyAuthorities'),
          emptyBibliography: t('ref.emptyBibliography'),
          emptyGlossary: t('gl.emptyGlossary'),
          emptyAbbreviations: t('gl.emptyAbbreviations'),
          see: t('ref.see'),
          passim: 'passim',
          category: (c) => t(`ref.cat.${c}` as Key),
        }),
      },
      track: { author: () => settings().authorName || t('comment.anonymous') },
      notes: {
        pageOf: (pos) => this.pagesInfo?.index(pos) ?? 0,
        label: (kind) => t(kind === 'foot' ? 'note.foot' : 'note.end'),
        open: (pos) => this.openNote?.(pos),
      },
      onShortcut: (name) => this.onShortcut?.(name) ?? false,
      attachment: {
        size: (b) => fileSize(b),
        title: (name, size) => t('obj.attachTitle', { name, size: size || '—' }),
      },
      forms: {
        label: (k) => t(k === 'choose' ? 'form.choose' : 'form.type'),
        // Une frappe refusée : on le dit une fois, pas à chaque touche.
        blocked: () => {
          if (Date.now() - this.formHintAt < 4000) return
          this.formHintAt = Date.now()
          toast(t('form.lockedHint'), { kind: 'info' })
        },
      },
      chart: {
        edit: (pos) => this.editChart?.(pos),
        label: () => t('chart.editHint'),
      },
      diagram: {
        edit: (pos) => this.editDiagram?.(pos),
        label: () => t('dg.editHint'),
      },
      callout: {
        menu: (pos, anchor) => this.calloutMenu?.(pos, anchor),
        labels: () => ({ icon: t('callout.kindMenu'), title: t('callout.rename') }),
      },
      math: this.mathHooks,
      links: {
        labels: () => ({ open: t('link.open'), edit: t('link.editShort'), remove: t('link.removeShort'), hint: t('link.ctrlClick', { key: /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl' }) }),
        edit: () => this.editLink?.(),
        remove: () => void this.run(setLink(null)),
        jump: (anchor) => this.jumpToAnchor(anchor),
        blocked: () => toast(t('offline.blocked'), { kind: 'info' }),
      },
    }
    this.editorCtx = ctx
    this.plugins = editorPlugins(ctx)
    const docs = splitFile(init.doc)
    ensureKeys(docs)
    const state = this.makeState(docs[0])
    this.savedDoc = init.boot === 'recovered-text' ? null : state.doc
    this.slots = docs.map((d, i) => {
      const st = i === 0 ? null : this.makeState(d)
      return { key: d.key!, state: st, saved: st && init.boot !== 'recovered-text' ? st.doc : null, scroll: 0, pages: null }
    })
    this.savedOrder = this.order()
    this.docStyle = h('style', { id: 'fp-doc-style', 'data-folio-transient': '' })
    document.head.append(this.docStyle)
    this.view = new EditorView(mount, {
      state,
      nodeViews: nodeViews(ctx),
      attributes: (s) => ({
        class: 'fp-prose' + (settings().showMarks ? ' show-marks' : '') + ` track-${settings().trackView}` + markupClasses() + (s.doc.attrs.hyphenate ? ' is-hyphenated' : ''),
        spellcheck: settings().spellcheck ? 'true' : 'false',
        lang: s.doc.attrs.lang || lang(),
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': t('editor.label'),
      }),
      dispatchTransaction: (tr) => this.dispatch(tr),
      editable: () => !this.reading && !this.realState,
      handleDOMEvents: {
        // Un fichier déposé qui n'est pas une image ne remplace jamais l'application : on l'ouvre comme document.
        drop: (_view, e) => {
          const files = Array.from(e.dataTransfer?.files ?? [])
          if (files.length && !files.some((f) => f.type.startsWith('image/'))) {
            e.preventDefault()
            e.stopPropagation()
            this.onFileDrop?.(files[0])
            return true
          }
          return false
        },
      },
    })
    this.updateDocStyle()
    // Les renvois vers les autres documents du fichier (connus seulement maintenant).
    if (this.slots.length > 1) this.view.dispatch(this.state.tr.setMeta(refsKey, true).setMeta('addToHistory', false))
    // Les champs {{heure}} et {{date}} restent à l'heure.
    setInterval(() => {
      if (this.hasTimeFields()) this.view.dispatch(this.state.tr.setMeta(fieldsKey, true).setMeta('addToHistory', false))
    }, 30_000)
    this.saver = this.makeSaver()
    window.addEventListener('pagehide', () => this.flushSnapshot())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushSnapshot()
    })
    window.addEventListener('beforeunload', (e) => {
      if (this.needsSaving()) {
        this.flushSnapshot()
        e.preventDefault()
        e.returnValue = ''
      }
    })
    void pruneSnapshots()
  }

  // --- état ---------------------------------------------------------------

  private dispatch(tr: Transaction): void {
    const next = this.view.state.apply(tr)
    this.view.updateState(next)
    if (tr.docChanged) {
      this.saveFailed = false
      // Les autres vues du document reçoivent la modification (juste après).
      this.sync?.schedule(this.view)
      this.syncClient?.schedule()
      this.scheduleSnapshot()
      this.updateDocStyle()
      for (const fn of this.docListeners) fn(tr)
    }
    this.notify()
  }

  /** Appelé à chaque modification du document. */
  onDocChange(fn: (tr: Transaction) => void): () => void {
    this.docListeners.add(fn)
    return () => this.docListeners.delete(fn)
  }

  /** Feuille de styles du document, recalculée quand le thème, les styles ou les polices changent. */
  private updateDocStyle(): void {
    const a = this.state.doc.attrs
    const from = [a.theme, a.styles, a.fonts]
    if (from.every((x, i) => x === this.styledFrom[i])) return
    this.styledFrom = from
    // Le texte et les en-têtes et pieds de page suivent les mêmes styles.
    this.docStyle.textContent = documentCss(a.theme as Theme, a.styles as Record<string, StyleDef>, a.fonts as EditorFontFace[], ':is(.fp-prose, .fp-hf)')
  }

  private hasTimeFields(): boolean {
    let found = false
    this.state.doc.descendants((node) => {
      if (found) return false
      if (node.type === schema.nodes.field && ['time', 'date'].includes(node.attrs.name)) found = true
      return !found
    })
    return found
  }

  /** Valeurs des champs : propriétés du document, dates, nom du fichier. */
  fieldContext(doc: PMNode = this.state.doc): Omit<FieldContext, 'page' | 'pages'> {
    const a = doc.attrs
    return {
      title: a.title || firstHeadingText(doc),
      author: a.author,
      subject: a.subject,
      organization: a.organization,
      keywords: a.keywords,
      created: this.identity.created,
      modified: this.identity.modified,
      filename: this.lastSave?.name ?? openedFileName() ?? fileNameFor(a.title.trim() || firstHeadingText(doc), t('title.placeholder')),
      now: new Date(),
      locale: a.lang || lang(),
      ...(this.pagesInfo
        ? { pageAt: this.pagesInfo.pageAt, pages: this.pagesInfo.pages(), formatPage: this.pagesInfo.format }
        : {}),
    }
  }

  /** Place le curseur à la fin d'un bloc (titre…) et le fait défiler en haut de l'écran. */
  /** Lien interne « #titre » : va au titre dont le texte correspond. */
  jumpToAnchor(anchor: string): boolean {
    // « clé:ancre » : un autre document du fichier (ancre vide : son début).
    const other = parseDocLink(`#${anchor}`)
    if (other && this.slots.some((s) => s.key === other.doc)) {
      if (!this.switchToKey(other.doc)) return false
      if (!other.anchor) {
        this.view.dispatch(this.state.tr.setSelection(Selection.atStart(this.state.doc)).scrollIntoView())
        this.scrollHooks?.set(0)
        return true
      }
      return this.jumpToAnchor(other.anchor)
    }
    // Un signet de ce nom d'abord, puis un titre dont le texte correspond.
    let mark = -1
    this.state.doc.descendants((node, pos) => {
      if (mark < 0 && node.type === schema.nodes.bookmark && node.attrs.name === anchor) mark = pos
      return mark < 0 && !node.isAtom
    })
    if (mark >= 0) {
      this.jumpTo(mark)
      return true
    }
    const slug = anchorSlug
    const want = slug(anchor)
    if (!want) return false
    let found = -1
    this.state.doc.descendants((node, pos) => {
      if (found >= 0) return false
      if (node.type === schema.nodes.heading && slug(node.textContent) === want) found = pos
      return node.isBlock && !node.isTextblock
    })
    if (found < 0) return false
    this.jumpTo(found)
    return true
  }

  jumpTo(pos: number): void {
    const node = this.state.doc.nodeAt(pos)
    if (!node) return
    const end = node.isTextblock ? pos + 1 + node.content.size : pos
    this.view.dispatch(this.state.tr.setSelection(Selection.near(this.state.doc.resolve(end))))
    ;(this.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ block: 'start' })
    this.view.focus()
  }

  /** Exécute une commande d'édition ; renvoie false si elle ne s'applique pas ici. */
  run(cmd: Command, focus = true): boolean {
    if (this.reading) return false
    const v = this.alt ?? this.view
    const ok = cmd(v.state, (tr) => v.dispatch(tr), v)
    if (focus) v.focus()
    return ok
  }

  /** La commande s'appliquerait-elle ? (sans rien changer) */
  can(cmd: Command): boolean {
    if (this.reading) return false
    const v = this.alt ?? this.view
    return cmd(v.state, undefined, v)
  }

  /** Modifie des attributs du document (thème, styles, propriétés), en une étape annulable. */
  setDocAttrs(attrs: Record<string, unknown>, addToHistory = true): void {
    if (this.reading) return
    const tr = this.state.tr
    for (const [k, v] of Object.entries(attrs)) tr.setDocAttribute(k, v)
    if (!addToHistory) tr.setMeta('addToHistory', false)
    this.view.dispatch(tr)
  }

  /** Prévient l'interface d'un changement qui n'est pas une transaction (pinceau, préférences). */
  notifyUi(): void {
    this.notify()
  }

  createdLabel(): string {
    return this.identity.created ? formatDate(this.identity.created) : '—'
  }

  get theme(): Theme {
    return this.state.doc.attrs.theme as Theme
  }

  get styles(): Record<string, StyleDef> {
    return this.state.doc.attrs.styles as Record<string, StyleDef>
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }

  get state(): EditorState {
    return this.view.state
  }

  get dirty(): boolean {
    // Une fenêtre synchronisée : c'est la principale qui garde le fichier.
    if (this.syncClient?.active) return false
    const live = this.realState ?? this.state
    if (this.protectionChanged || this.savedDoc === null || !live.doc.eq(this.savedDoc) || this.order() !== this.savedOrder) return true
    return this.slots.some((s, i) => i !== this.active && (s.saved === null || !s.state!.doc.eq(s.saved)))
  }

  // --- plusieurs documents dans le fichier -------------------------------------------

  /** Nouvel état de l'éditeur pour un document (historique vide, numérotation des listes à jour). */
  private makeState(doc: FolioDoc): EditorState {
    let state = EditorState.create({ schema, doc: docToPM(doc), plugins: this.plugins })
    // Les listes qui continuent la numérotation prennent leur numéro dès l'ouverture.
    const fix = fixNumbering(state)
    if (fix) state = state.apply(fix.setMeta('addToHistory', false))
    return state
  }

  private order(): string {
    return this.slots.map((s) => s.key).join(',')
  }

  /** L'état d'un document (celui qui est affiché : l'état réel, même pendant un export). */
  private slotState(i: number): EditorState {
    return i === this.active ? (this.realState ?? this.view.state) : this.slots[i].state!
  }

  /** Les documents du fichier, dans l'ordre des onglets. */
  get documents(): { key: string; title: string; active: boolean; dirty: boolean }[] {
    return this.slots.map((s, i) => {
      const doc = this.slotState(i).doc
      const saved = i === this.active ? this.savedDoc : s.saved
      return { key: s.key, title: this.docTitleOf(doc, i), active: i === this.active, dirty: saved === null || !doc.eq(saved) }
    })
  }

  get activeIndex(): number {
    return this.active
  }

  get activeKey(): string {
    return this.slots[this.active].key
  }

  /** Titre d'un document : le sien, sinon son premier titre, sinon « Document n ». */
  private docTitleOf(doc: PMNode, i: number): string {
    return (doc.attrs.title as string).trim() || firstHeadingText(doc) || t('docs.untitled', { n: i + 1 })
  }

  /** Un autre document, pour les renvois { doc } (null : ce document-ci, ou clé inconnue). */
  private otherDoc(key: string): OtherDoc | null {
    const i = this.slots.findIndex((s) => s.key === key)
    if (i < 0) return null
    if (i === this.active && !this.realState) return null
    const slot = this.slots[i]
    const doc = this.slotState(i).doc
    return { doc, title: this.docTitleOf(doc, i), page: (b) => slot.pages?.get(b) ?? null }
  }

  /** Le document d'une clé : son état (pour les fenêtres Lien et Renvoi). */
  stateOf(key: string): EditorState | null {
    const i = this.slots.findIndex((s) => s.key === key)
    return i < 0 ? null : this.slotState(i)
  }

  /** La valeur actuelle d'un renvoi vers un signet d'un autre document (vide s'il manque). */
  crossValue(key: string, bookmark: string, show: XrefShow): string {
    const other = this.otherDoc(key)
    return other ? (crossRefValue(other, bookmark, show, this.editorCtx.refs!.labels()) ?? '') : ''
  }

  /** Une transaction sur un autre document (un signet ajouté pour un renvoi). */
  updateOther(key: string, fn: (state: EditorState) => Transaction | null): void {
    const i = this.slots.findIndex((s) => s.key === key)
    if (i < 0) return
    if (i === this.active) {
      const tr = fn(this.state)
      if (tr) this.view.dispatch(tr)
      return
    }
    const tr = fn(this.slots[i].state!)
    if (tr) {
      this.slots[i].state = this.slots[i].state!.apply(tr)
      this.scheduleSnapshot()
    }
  }

  /** Pages des signets du document affiché (vue page), pour les renvois des autres documents. */
  private bookmarkPages(): Map<string, string> | null {
    const info = this.pagesInfo
    if (!info) return this.slots[this.active].pages
    const out = new Map<string, string>()
    this.state.doc.descendants((node, pos) => {
      if (node.type === schema.nodes.bookmark && !out.has(node.attrs.name)) out.set(node.attrs.name, info.format(info.pageAt(pos)))
      return !node.isAtom || node.isBlock
    })
    return out
  }

  /** Affiche un autre document du fichier (son historique d'annulation le suit). */
  switchTo(i: number): boolean {
    if (i === this.active || !this.slots[i] || this.realState) return false
    this.onBeforeSwitch?.()
    const cur = this.slots[this.active]
    cur.state = this.view.state
    cur.saved = this.savedDoc
    cur.scroll = this.scrollHooks?.get() ?? 0
    cur.pages = this.bookmarkPages()
    const next = this.slots[i]
    const state = next.state!
    next.state = null
    this.active = i
    this.savedDoc = next.saved
    this.showState(state)
    this.scrollHooks?.set(next.scroll)
    return true
  }

  switchToKey(key: string): boolean {
    const i = this.slots.findIndex((s) => s.key === key)
    return i >= 0 && (i === this.active || this.switchTo(i))
  }

  /** Un état complet à l'écran : l'interface et les renvois suivent. */
  private showState(state: EditorState): void {
    this.view.updateState(state)
    this.view.setProps({})
    this.onStateReset?.()
    this.updateDocStyle()
    for (const fn of this.docListeners) fn(state.tr)
    // Les renvois vers les autres documents : ils ont pu changer pendant ce temps.
    this.view.dispatch(this.state.tr.setMeta(refsKey, true).setMeta('addToHistory', false))
    this.notify()
  }

  /** Ajoute un document au fichier (vide, ou celui donné) et l'affiche ; renvoie sa place. */
  addDocument(doc?: FolioDoc, at = this.active + 1): number {
    if (this.slots.length >= 50) {
      toast(t('docs.tooMany'), { kind: 'info' })
      return -1
    }
    let d = doc
    if (!d) {
      const fresh = loadDocument({ format: 'folio/doc', version: 1, blocks: [] })
      d = withDefaultDesign({ ...(fresh.ok ? fresh.doc : this.getDoc()), meta: { ...emptyMeta(), title: t('docs.untitled', { n: this.slots.length + 1 }) }, blocks: [], comments: [] })
    }
    const key = freeKey(this.slots.map((s) => s.key))
    const place = Math.max(0, Math.min(this.slots.length, at))
    this.slots.splice(place, 0, { key, state: this.makeState(d), saved: null, scroll: 0, pages: null })
    if (place <= this.active) this.active++
    if (this.isDemo) this.isDemo = false
    this.switchTo(place)
    this.scheduleSnapshot()
    this.notify()
    return place
  }

  /** Copie d'un document, juste après lui. */
  duplicateDocument(i: number): number {
    if (!this.slots[i]) return -1
    const d = pmToDoc(this.slotState(i).doc, this.identity)
    d.meta = { ...d.meta, title: t('docs.copyOf', { title: this.docTitleOf(this.slotState(i).doc, i) }).slice(0, 500) }
    return this.addDocument(d, i + 1)
  }

  /** Retire un document du fichier ; renvoie de quoi l'y remettre (Annuler). */
  removeDocument(i: number): (() => void) | null {
    if (this.slots.length < 2 || !this.slots[i] || this.realState) return null
    if (i === this.active) this.switchTo(i > 0 ? i - 1 : 1)
    const [slot] = this.slots.splice(i, 1)
    if (i < this.active) this.active--
    this.scheduleSnapshot()
    this.notify()
    return () => {
      if (this.slots.some((s) => s.key === slot.key)) return
      const at = Math.min(i, this.slots.length)
      this.slots.splice(at, 0, slot)
      if (at <= this.active) this.active++
      this.switchTo(at)
      this.scheduleSnapshot()
      this.notify()
    }
  }

  /** Change un document de place. */
  moveDocument(from: number, to: number): void {
    const n = this.slots.length
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return
    const activeKey = this.slots[this.active].key
    const [slot] = this.slots.splice(from, 1)
    this.slots.splice(to, 0, slot)
    this.active = this.slots.findIndex((s) => s.key === activeKey)
    this.scheduleSnapshot()
    this.notify()
  }

  /** Renomme un document (son titre). */
  renameDocument(i: number, title: string): void {
    const v = title.replace(/\s+/g, ' ').trim().slice(0, 500)
    if (i === this.active) return this.setTitle(v)
    const slot = this.slots[i]
    if (!slot?.state) return
    slot.state = slot.state.apply(slot.state.tr.setDocAttribute('title', v).setMeta('addToHistory', false))
    this.scheduleSnapshot()
    this.notify()
  }

  /** Tous les documents du fichier en un seul (export ou impression de tous les documents). */
  combinedDoc(): { doc: FolioDoc; styles: string[] } {
    const docs = this.slots.map((s, i) => ({ ...this.withCrossValues(pmToDoc(this.slotState(i).doc, this.identity), i), key: s.key }))
    const { doc, note } = combineDocuments(docs)
    return { doc, styles: note.styles }
  }

  /** Le document affiché, prêt pour un export seul : les renvois et liens vers les autres documents deviennent du texte. */
  standaloneDoc(): FolioDoc | null {
    const doc = this.withCrossValues(pmToDoc(this.slotState(this.active).doc, this.identity), this.active)
    let changed = false
    const walk = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(walk)
      if (!v || typeof v !== 'object') return v
      const o = v as Record<string, unknown>
      if (o.type === 'xref' && typeof o.doc === 'string' && o.doc) {
        changed = true
        const { type: _t, target: _g, show: _s, doc: _d, last, ...marks } = o
        return { ...marks, text: (last as string) || '?' }
      }
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(o)) out[k] = walk(x)
      if (typeof out.link === 'string' && parseDocLink(out.link)) {
        changed = true
        delete out.link
      }
      return out
    }
    const blocks = walk(doc.blocks) as FolioDoc['blocks']
    return changed ? { ...doc, blocks } : null
  }

  /** Les renvois vers d'autres documents gardent leur valeur actuelle (« last »), pour le fichier et les exports. */
  private withCrossValues(doc: FolioDoc, i: number): FolioDoc {
    const labels = this.editorCtx.refs!.labels()
    const resolve = (key: string, target: string, show: string): string | null => {
      const j = this.slots.findIndex((s) => s.key === key)
      if (j < 0 || j === i) return null
      const other = this.slotState(j).doc
      const pages = j === this.active && !this.realState ? this.bookmarkPages() : this.slots[j].pages
      return crossRefValue({ doc: other, title: this.docTitleOf(other, j), page: (b) => pages?.get(b) ?? null }, target, show as never, labels)
    }
    let found = false
    const walk = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(walk)
      if (!v || typeof v !== 'object') return v
      const o = v as Record<string, unknown>
      if (o.type === 'xref' && typeof o.doc === 'string' && o.doc) {
        found = true
        const value = resolve(o.doc, String(o.target), String(o.show))
        return value ? { ...o, last: value.slice(0, 2000) } : o
      }
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(o)) out[k] = walk(x)
      return out
    }
    const blocks = walk(doc.blocks) as FolioDoc['blocks']
    return found ? { ...doc, blocks } : doc
  }

  /**
   * Affiche un document temporaire (export ou impression de tous les documents)
   * le temps de `run`, puis revient au vrai. Rien n'est modifiable entre-temps,
   * et rien de ce document temporaire ne va dans le fichier.
   */
  async showTemporarily<T>(doc: FolioDoc, run: () => Promise<T>): Promise<T> {
    if (this.realState) return run()
    this.onBeforeSwitch?.()
    const scroll = this.scrollHooks?.get() ?? 0
    this.realState = this.view.state
    this.view.updateState(EditorState.create({ schema, doc: docToPM(doc), plugins: this.plugins }))
    this.view.setProps({})
    this.updateDocStyle()
    this.notify()
    try {
      return await run()
    } finally {
      const real = this.realState
      this.realState = null
      this.view.updateState(real)
      this.view.setProps({})
      this.updateDocStyle()
      this.view.dispatch(this.state.tr.setMeta(refsKey, true).setMeta('addToHistory', false))
      this.notify()
      this.scrollHooks?.set(scroll)
    }
  }

  get showingTemporary(): boolean {
    return this.realState !== null
  }

  /** Le fichier entier : le premier document, avec les autres dans « documents ». */
  fileDoc(): FolioDoc {
    const docs = this.slots.map((s, i) => ({ ...this.withCrossValues(pmToDoc(this.slotState(i).doc, this.identity), i), key: s.key }))
    return joinFile(docs)
  }

  /** Remplace tous les documents par ceux d'un fichier ; `saved` : le fichier les contient déjà. */
  private resetSlots(file: FolioDoc, saved: boolean): void {
    const docs = splitFile(file)
    ensureKeys(docs)
    const first = this.makeState(docs[0])
    this.active = 0
    this.slots = docs.map((d, i) => {
      const st = i === 0 ? null : this.makeState(d)
      return { key: d.key!, state: st, saved: saved && st ? st.doc : null, scroll: 0, pages: null }
    })
    this.savedOrder = saved ? this.order() : ''
    this.resetTo(first, saved)
    if (this.slots.length > 1) this.view.dispatch(this.state.tr.setMeta(refsKey, true).setMeta('addToHistory', false))
  }

  // --- protection par mot de passe (phase 7) ---------------------------------

  /** Mot de passe du document (en mémoire seulement), et ce qu'il chiffre dans le navigateur. */
  private sealer: SessionSealer | null = null
  /** La protection a changé depuis le dernier enregistrement. */
  private protectionChanged = false
  /** Contenu de la dernière version enregistrée dans l'historique (document protégé : on compare ici). */
  private lastVersionJson = ''

  get isProtected(): boolean {
    return this.sealer !== null
  }

  /** Mot de passe actuel (pour la copie mise à jour, qui reste protégée). */
  get password(): string | null {
    return this.sealer?.password ?? null
  }

  /**
   * Protège le document (ou retire la protection avec null). S'applique au
   * prochain enregistrement. Les copies gardées en clair dans ce navigateur
   * (copie de secours, versions) sont effacées.
   */
  setPassword(password: string | null): void {
    const was = this.sealer?.password ?? null
    if (was === password) return
    forgetKeys()
    this.sealer = password ? new SessionSealer(password) : null
    this.protectionChanged = true
    if (password) {
      void deleteSnapshot(this.identity.id)
      void deleteVersions(this.identity.id)
      this.lastVersionJson = ''
    }
    this.notify()
  }

  /** Titre écrit dans le fichier : neutre pour un document protégé (le titre ne doit pas fuir). */
  private fileTitle(): string {
    return this.sealer ? `${t('protect.fileTitle')} — Folio Pages` : this.windowTitle()
  }

  /** Bloc du document tel qu'il va dans le fichier : le JSON, ou son enveloppe chiffrée. */
  private async fileBlock(doc: FolioDoc): Promise<string> {
    const json = prettyJson(doc)
    return this.sealer ? encryptText(json, this.sealer.password, { id: doc.id }) : json
  }

  /**
   * Mettre à jour ce fichier : la nouvelle application (vérifiée), avec ce
   * document (chiffré s'il est protégé). Écrite à la place du fichier ouvert
   * quand on le peut, sinon téléchargée sous le même nom.
   */
  async updateFile(release: ReleaseInfo, carry: (html: string) => string): Promise<SaveOutcome> {
    if (this.saving) return { kind: 'cancelled' }
    const docAtSave = this.saveMarks()
    const modified = new Date().toISOString()
    this.saving = true
    this.notify()
    let outcome: SaveOutcome
    try {
      const doc = this.fileDoc()
      doc.meta.modified = modified
      doc.template = this.editingTemplate
      doc.readOnly = this.lockedReadOnly
      const html = await buildUpdatedFile(release, await this.fileBlock(doc), carry)
      outcome = await this.saver.save(html)
    } catch (e) {
      outcome = { kind: 'error', message: e instanceof Error ? e.message : String(e) }
    }
    this.saving = false
    if (outcome.kind === 'saved' || outcome.kind === 'downloaded') this.afterSave(outcome, docAtSave, modified)
    this.notify()
    return outcome
  }

  /** Le fichier complet à écrire (chiffré si le document est protégé). */
  async fileText(modified = this.identity.modified): Promise<string> {
    const doc = this.fileDoc()
    doc.meta.modified = modified
    doc.template = this.editingTemplate
    doc.readOnly = this.lockedReadOnly
    return serializeShell(await this.fileBlock(doc), this.fileTitle())
  }

  /** Le fichier sur le disque n'a pas ce qui est à l'écran. */
  needsSaving(): boolean {
    return this.dirty
  }

  get docId(): string {
    return this.identity.id
  }

  status(): SaveStatus {
    if (this.syncClient?.active) return 'synced'
    if (this.saving) return 'saving'
    if (this.saveFailed) return 'error'
    if (this.dirty) return 'dirty'
    if (this.lastSave) return this.lastSave.kind
    return 'pristine'
  }

  get savedName(): string | null {
    return this.lastSave?.name ?? null
  }

  get writesInPlace(): boolean {
    return canWriteInPlace()
  }

  /** Un fichier ouvert où l'on peut réécrire en place (enregistrement automatique). */
  get hasFileHandle(): boolean {
    return this.saver.hasHandle
  }

  get isSaving(): boolean {
    return this.saving
  }

  title(): string {
    return this.state.doc.attrs.title as string
  }

  /** Titre affiché : celui du document, sinon son premier titre, sinon « Document sans titre ». */
  displayTitle(): string {
    return this.title().trim() || firstHeadingText(this.state.doc) || t('title.placeholder')
  }

  setTitle(value: string): void {
    if (value === this.title()) return
    // Hors historique : on corrige un titre dans son champ, pas avec Ctrl+Z dans la page.
    this.view.dispatch(this.state.tr.setDocAttribute('title', value.slice(0, 500)).setMeta('addToHistory', false))
  }

  getDoc(): FolioDoc {
    return pmToDoc(this.state.doc, this.identity)
  }

  /** JSON du document ; la forme compacte (pour une IA) laisse les images de côté, elles sont reprises au retour. */
  json(compact = false): string {
    const doc = this.fileDoc()
    return compact ? JSON.stringify(toCompact(doc, { assets: false }), null, 2) : prettyJson(doc)
  }

  /** Le fichier complet tel qu'il serait enregistré maintenant. */
  serialize(modified = this.identity.modified): string {
    const doc = this.fileDoc()
    doc.meta.modified = modified
    doc.template = this.editingTemplate
    doc.readOnly = this.lockedReadOnly
    return serializeShell(prettyJson(doc), this.windowTitle())
  }

  private makeSaver(): Saver {
    return new Saver({
      docId: () => this.identity.id,
      suggestedName: () => this.suggestedFileName(),
      belongs: (text) => this.fileHoldsThisDocument(text),
    })
  }

  /**
   * Enregistrer une copie (on continue sur l'original), comme nouveau document
   * (on continue sur le nouveau), comme modèle, ou en lecture seule. Chaque
   * fichier écrit a sa propre identité : il ne remplacera jamais l'original.
   */
  async saveVariant(kind: SaveVariant): Promise<SaveOutcome | null> {
    if (this.saving) return null
    const id = mintId()
    const now = new Date().toISOString()
    const docAtSave = this.saveMarks()
    const doc = this.fileDoc()
    doc.id = id
    for (const d of doc.documents ?? []) d.id = id
    if (kind === 'new' || kind === 'template') doc.meta.created = now
    doc.meta.modified = now
    doc.template = kind === 'template'
    doc.readOnly = kind === 'readonly'
    // Une copie d'un document protégé l'est aussi, avec le même mot de passe.
    const html = serializeShell(await this.fileBlock(doc), this.fileTitle())
    const base = this.suggestedFileName().replace(/\.html?$/i, '')
    const name = kind === 'new' ? `${base}.html` : `${base} (${t(`saveAs.suffix.${kind}` as Key)}).html`
    const saver = new Saver({ docId: () => id, suggestedName: () => name, belongs: () => false })
    this.saving = true
    this.notify()
    let outcome: SaveOutcome
    try {
      outcome = await saver.save(html)
    } catch (e) {
      outcome = { kind: 'error', message: e instanceof Error ? e.message : String(e) }
    }
    this.saving = false
    const ok = outcome.kind === 'saved' || outcome.kind === 'downloaded'
    if (ok && kind === 'new') {
      // La session continue sur le nouveau document ; l'ancien fichier reste tel qu'il était.
      const oldId = this.identity.id
      this.identity = { id, created: doc.meta.created, modified: now }
      this.saver = saver
      this.chosenName = outcome.kind === 'saved' || outcome.kind === 'downloaded' ? outcome.name : name
      this.templateId = null
      this.editingTemplate = false
      this.boot = 'document'
      this.afterSave(outcome, docAtSave, now)
      void deleteSnapshot(oldId)
    } else if (ok) {
      toast(t(outcome.kind === 'saved' ? 'saveAs.done' : 'saveAs.downloaded', { name: (outcome as { name: string }).name }), { kind: 'success', timeout: 7000 })
    } else if (outcome.kind === 'denied') toast(t('save.permissionDenied'), { kind: 'error' })
    else if (outcome.kind === 'error') toast(t('save.failed', { message: outcome.message }), { kind: 'error' })
    this.notify()
    return outcome
  }

  /**
   * Ouvre un autre document dans cette fenêtre : il remplace celui-ci (après
   * proposition d'enregistrer), avec un historique d'annulation vide. S'il vient
   * d'un fichier que l'on peut réécrire (Chrome, Edge), on le réécrira en place.
   * Renvoie false si l'utilisateur renonce.
   */
  async openDocument(doc: FolioDoc, o: { handle: FsHandle | null; name: string; report: Report | null; imported?: boolean; password?: string }): Promise<boolean> {
    if (this.needsSaving() && !this.isDemo && !this.lockedReadOnly) {
      const choice = await openDialog({
        name: 'save-first',
        title: t('open.saveFirstTitle'),
        body: [h('p', {}, t('open.saveFirst', { title: this.displayTitle() }))],
        actions: [
          { label: t('action.cancel'), value: 'cancel' },
          { label: t('open.discard'), value: 'discard', danger: true },
          { label: t('menu.save'), value: 'save', primary: true },
        ],
      }).result
      if (choice === 'save') {
        const out = await this.save()
        if (!out || (out.kind !== 'saved' && out.kind !== 'downloaded')) return false
      } else if (choice !== 'discard') return false
    }
    this.flushSnapshot()
    if (!this.dirty) void deleteSnapshot(this.identity.id)
    let opened = doc
    let templateId: string | null = null
    if (doc.template) {
      templateId = doc.id
      const now = new Date().toISOString()
      opened = { ...doc, id: mintId(), template: false, meta: { ...doc.meta, created: now, modified: '' } }
    }
    this.identity = { id: opened.id, created: opened.meta.created, modified: opened.meta.modified }
    this.saver = this.makeSaver()
    if (o.handle && !templateId && !opened.readOnly && !o.imported) await this.saver.adopt(o.handle)
    this.chosenName = templateId ? null : o.name
    this.boot = templateId ? 'template' : 'document'
    this.templateId = templateId
    this.editingTemplate = false
    this.lockedReadOnly = opened.readOnly
    this.reading = opened.readOnly
    this.isDemo = false
    this.lastSave = null
    this.saveFailed = false
    this.report = o.report
    this.lastVersionAt = Date.now()
    forgetKeys()
    this.sealer = o.password ? new SessionSealer(o.password) : null
    this.protectionChanged = false
    this.lastVersionJson = ''
    this.resetState(opened, !o.imported && !templateId)
    if (o.handle && this.saver.hasHandle) void this.rememberFile()
    void this.checkRecovery()
    return true
  }

  /**
   * Fenêtre synchronisée : le document reçu de la fenêtre principale devient le sien, à cette version
   * de la synchronisation. Il passe par la validation du format (comme un fichier ouvert) ; s'il en
   * ressort différent, cette fenêtre garde la version validée et continue seule (renvoie false).
   */
  adoptShared(json: unknown, version: number): boolean {
    let doc: PMNode
    try {
      doc = schema.nodeFromJSON(json)
      doc.check()
    } catch {
      return false
    }
    const checked = loadDocument(pmToDoc(doc, this.identity) as unknown as Record<string, unknown>, { now: new Date().toISOString() })
    if (!checked.ok) return false
    const clean = docToPM(checked.doc)
    const same = clean.eq(doc)
    const plugins = this.view.state.plugins.filter((p) => !(p as unknown as { key: string }).key.startsWith('collab$'))
    const state = EditorState.create({ schema, doc: same ? doc : clean, plugins: same ? [...plugins, collab({ version })] : plugins })
    this.view.updateState(state)
    this.view.setProps({})
    this.savedDoc = state.doc
    this.updateDocStyle()
    for (const fn of this.docListeners) fn(state.tr)
    this.notify()
    return same
  }

  /** Le document n'est plus celui du fichier (fenêtre détachée : ses modifications sont à enregistrer). */
  markUnsaved(): void {
    this.savedDoc = null
    this.notify()
  }

  /** Oublie l'historique d'annulation (après un caviardage : le texte retiré ne doit plus revenir). */
  clearHistory(): void {
    // Sans le greffon d'historique, puis de nouveau avec lui : son état repart de zéro, celui des autres
    // greffons est gardé (dont les étapes pas encore envoyées aux autres vues du document).
    const plugins = this.view.state.plugins
    const without = this.view.state.reconfigure({ plugins: plugins.filter((p) => !(p as unknown as { key: string }).key.startsWith('history$')) })
    this.view.updateState(without.reconfigure({ plugins }))
    this.view.setProps({})
    this.notify()
  }

  /** Nouvel état de l'éditeur (historique vide) ; `saved` : le fichier contient déjà ce document. */
  private resetState(doc: FolioDoc, saved: boolean): void {
    this.resetSlots(doc, saved)
  }

  private resetTo(state: EditorState, saved: boolean): void {
    this.view.updateState(state)
    this.view.setProps({})
    this.onStateReset?.()
    this.savedDoc = saved ? state.doc : null
    this.updateDocStyle()
    for (const fn of this.docListeners) fn(state.tr)
    this.notify()
  }

  /** Mémorise le fichier courant parmi les fichiers récents (Chrome, Edge). */
  private async rememberFile(): Promise<void> {
    const handle = this.saver.currentHandle
    if (!handle) return
    await rememberRecent({ key: this.identity.id, name: handle.name, title: this.displayTitle(), at: Date.now(), handle })
  }

  /** Mode lecture : activé ou non (une copie en lecture seule y reste). */
  setReading(on: boolean): void {
    if (!on && this.lockedReadOnly) return
    if (on === this.reading) return
    this.reading = on
    this.view.setProps({})
    this.notify()
  }

  /** Copie en lecture seule : on en fait un nouveau document modifiable (rien n'est réécrit dans ce fichier). */
  editCopy(): void {
    if (!this.lockedReadOnly) return
    this.lockedReadOnly = false
    this.identity = { id: mintId(), created: new Date().toISOString(), modified: '' }
    this.saver = this.makeSaver()
    this.savedDoc = null
    this.lastSave = null
    this.boot = 'template'
    this.reading = false
    this.view.setProps({})
    this.notify()
    toast(t('read.copyStarted'), { kind: 'info', timeout: 8000 })
  }

  /** Ouvert à partir d'un modèle : modifier le modèle lui-même (il sera enregistré comme modèle). */
  editTemplate(): void {
    if (!this.templateId) return
    this.identity = { id: this.templateId, created: this.identity.created, modified: '' }
    this.templateId = null
    this.editingTemplate = true
    this.saver = this.makeSaver()
    this.boot = 'document'
    this.notify()
    toast(t('template.editing'), { kind: 'info', timeout: 8000 })
  }

  get isTemplate(): boolean {
    return this.editingTemplate
  }

  windowTitle(): string {
    // Plusieurs fenêtres sur le document : chacune son numéro.
    const numbered = this.windowIndex > 1 || (this.sync?.windows ?? 0) > 0
    return `${this.displayTitle()}${numbered ? ` (${this.windowIndex})` : ''} — Folio Pages`
  }

  suggestedFileName(): string {
    if (this.chosenName) return this.chosenName
    const opened = this.boot === 'document' ? openedFileName() : null
    const first = this.slotState(0).doc
    return opened ?? fileNameFor((first.attrs.title as string).trim() || firstHeadingText(first), t('title.placeholder'))
  }

  /** Un fichier mémorisé contient-il encore ce document ? (même identité) */
  private fileHoldsThisDocument(text: string): boolean {
    const block = extractDocBlock(text)
    if (block === null) return false
    if (block === '') return this.boot === 'blank'
    const m = /"id"\s*:\s*"([A-Za-z0-9_-]{6,64})"/.exec(block)
    return !!m && m[1] === this.identity.id
  }

  // --- enregistrement -----------------------------------------------------

  async save(): Promise<SaveOutcome | null> {
    if (this.saving) return null
    // Fenêtre synchronisée : la principale enregistre le fichier.
    if (this.syncClient?.active) {
      this.syncClient.requestSave()
      toast(t('win.savedByMain'), { kind: 'info' })
      return null
    }
    if (this.lockedReadOnly) {
      toast(t('read.locked'), { kind: 'info', action: { label: t('read.editCopy'), run: () => this.editCopy() } })
      return null
    }
    this.saving = true
    this.notify()
    if (this.realState) return null
    let outcome: SaveOutcome
    const docAtSave = this.saveMarks()
    const modified = new Date().toISOString()
    try {
      const html = await this.fileText(modified)
      outcome = await this.saver.save(html)
      if (outcome.kind === 'conflict') {
        const choice = await openDialog({
          name: 'conflict',
          title: t('save.conflictTitle'),
          body: [h('p', {}, t('save.conflictBody', { name: outcome.name }))],
          actions: [
            { label: t('action.cancel'), value: 'cancel' },
            { label: t('save.overwrite'), value: 'overwrite', primary: true, danger: true },
          ],
        }).result
        outcome = choice === 'overwrite' ? await this.saver.save(html, true) : { kind: 'cancelled' }
      }
    } catch (e) {
      outcome = { kind: 'error', message: e instanceof Error ? e.message : String(e) }
    }
    this.saving = false
    this.afterSave(outcome, docAtSave, modified)
    this.notify()
    return outcome
  }

  /** Ce que contient le fichier au moment de l'écrire : chaque document, et leur ordre. */
  private saveMarks(): { docs: Map<string, PMNode>; order: string } {
    return { docs: new Map(this.slots.map((s, i) => [s.key, this.slotState(i).doc])), order: this.order() }
  }

  private afterSave(outcome: SaveOutcome, marks: { docs: Map<string, PMNode>; order: string }, modified: string): void {
    switch (outcome.kind) {
      case 'saved':
      case 'downloaded': {
        this.identity.modified = modified
        this.slots.forEach((s, i) => {
          const d = marks.docs.get(s.key) ?? null
          if (i === this.active) this.savedDoc = d
          else s.saved = d
        })
        this.savedOrder = marks.order
        this.lastSave = { kind: outcome.kind, name: outcome.name }
        this.saveFailed = false
        this.isDemo = false
        this.protectionChanged = false
        void this.recordVersion('save')
        if (outcome.kind === 'saved') {
          void this.rememberFile()
          if (!this.dirty) void deleteSnapshot(this.identity.id)
        } else {
          // Le fichier d'origine n'est pas à jour : la copie de secours reste utile.
          void this.writeSnapshot(true)
          if (!this.downloadExplained) {
            this.downloadExplained = true
            toast(t('save.downloadedToast', { name: outcome.name }), { kind: 'info', timeout: 9000 })
          }
        }
        break
      }
      case 'denied':
        this.saveFailed = true
        toast(t('save.permissionDenied'), { kind: 'error' })
        break
      case 'error':
        this.saveFailed = true
        toast(t('save.failed', { message: outcome.message }), { kind: 'error' })
        break
      case 'cancelled':
      case 'conflict':
        break
    }
  }

  // --- copie de secours ---------------------------------------------------

  private scheduleSnapshot(): void {
    if (this.syncClient?.active) return
    const now = Date.now()
    if (!this.snapshotDue) this.snapshotDue = now + SNAPSHOT_MAX_WAIT
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer)
    const wait = Math.max(0, Math.min(SNAPSHOT_DELAY, this.snapshotDue - now))
    this.snapshotTimer = setTimeout(() => this.flushSnapshot(), wait)
  }

  flushSnapshot(): void {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer)
    this.snapshotTimer = null
    this.snapshotDue = 0
    void this.writeSnapshot(false)
  }

  // --- historique des versions -------------------------------------------

  /** Ajoute l'état actuel à l'historique (dans ce navigateur seulement). */
  recordVersion(reason: VersionReason): Promise<boolean> {
    this.lastVersionAt = Date.now()
    const json = JSON.stringify(this.fileDoc())
    const sealer = this.sealer
    // Document protégé : la version est chiffrée (et sans titre en clair) ; les doublons se voient ici.
    if (sealer && json === this.lastVersionJson) return Promise.resolve(false)
    this.lastVersionJson = json
    const base = { docId: this.identity.id, at: Date.now(), title: sealer ? t('protect.fileTitle') : this.displayTitle(), words: stats(this.state.doc).words, reason }
    // Les écritures se suivent (l'historique ne les lit jamais à moitié).
    const done = this.versionWrites.then(async () => addVersion({ ...base, json: sealer ? await sealer.seal(json) : json }))
    this.versionWrites = done.catch(() => false)
    return done
  }

  async versions(): Promise<Version[]> {
    await this.versionWrites
    return listVersions(this.identity.id)
  }

  /** Le document d'une version gardée (ouverte si elle est scellée), ou null s'il est illisible. */
  async versionDoc(v: Version): Promise<FolioDoc | null> {
    const json = this.sealer ? await this.sealer.open(v.json) : v.json
    if (json === null) return null
    const res = loadDocument(json)
    return res.ok ? res.doc : null
  }

  /** Revient à une version : une étape annulable ; l'état quitté est gardé dans l'historique. */
  async restoreVersion(v: Version): Promise<boolean> {
    const json = this.sealer ? await this.sealer.open(v.json) : v.json
    if (json === null) return false
    const res = loadDocument(json)
    if (!res.ok || this.reading) return false
    await this.recordVersion('restore')
    this.isDemo = false
    this.replaceFile(res.doc)
    return true
  }

  /** Écrit la copie de secours ; renvoie true si elle a été écrite. */
  async writeSnapshot(downloaded: boolean): Promise<boolean> {
    if (this.dirty && Date.now() - this.lastVersionAt > AUTO_VERSION_MS) void this.recordVersion('auto')
    if (!this.dirty && !downloaded) {
      if (this.lastSave?.kind !== 'downloaded') await deleteSnapshot(this.identity.id)
      return false
    }
    const sealer = this.sealer
    const json = JSON.stringify(this.fileDoc())
    return putSnapshot({
      key: this.identity.id,
      at: Date.now(),
      title: sealer ? t('protect.fileTitle') : this.displayTitle(),
      json: sealer ? await sealer.seal(json) : json,
      href: location.href,
      blank: this.boot === 'blank' || this.boot === 'template',
      downloaded: downloaded || this.lastSave?.kind === 'downloaded',
    })
  }

  /** Au démarrage : propose de restaurer des modifications non enregistrées. */
  async checkRecovery(): Promise<'none' | 'restored' | 'ignored' | 'same'> {
    let snap = await getSnapshot(this.identity.id)
    if (!snap && (this.boot === 'blank' || this.boot === 'template')) snap = await findBlankSnapshot(location.href)
    if (!snap) return 'none'
    // Une copie chiffrée s'ouvre avec le mot de passe du document ; sinon, on la laisse.
    const snapJson = this.sealer ? await this.sealer.open(snap.json) : /^\{\s*"format"\s*:\s*"folio\/enc"/.test(snap.json) ? null : snap.json
    if (snapJson === null) return 'none'
    const stored = loadDocument(snapJson)
    if (!stored.ok) {
      await deleteSnapshot(snap.key)
      return 'none'
    }
    if (contentKey(stored.doc) === contentKey(this.fileDoc())) {
      if (!snap.downloaded || this.boot === 'document') await deleteSnapshot(snap.key)
      return 'same'
    }
    const fileModified = Date.parse(this.identity.modified)
    const older = Number.isFinite(fileModified) && snap.at < fileModified
    const body: Node[] = [h('p', {}, t('recovery.body', { date: formatDate(snap.at) }))]
    if (older) body.push(h('p', { class: 'fp-warn' }, t('recovery.older', { date: formatDate(fileModified) })))
    const choice = await openDialog({
      name: 'recovery',
      title: t('recovery.title'),
      body,
      actions: [
        { label: t('recovery.ignore'), value: 'ignore' },
        { label: t('recovery.restore'), value: 'restore', primary: true },
      ],
    }).result
    if (choice !== 'restore') {
      await deleteSnapshot(snap.key)
      return 'ignored'
    }
    if ((this.boot === 'blank' || this.boot === 'template') && stored.doc.id !== this.identity.id) {
      // La session reprend son identité : c'est le même document.
      await deleteSnapshot(this.identity.id)
      this.identity = { id: stored.doc.id, created: stored.doc.meta.created, modified: '' }
    }
    this.isDemo = false
    this.replaceFile(stored.doc)
    toast(t('recovery.restored'), { kind: 'success' })
    return 'restored'
  }

  // --- actions sur le document --------------------------------------------

  /** Remplace tout le contenu (et les propriétés), en une étape annulable. */
  replaceDocument(doc: FolioDoc, keepMeta: boolean): void {
    if (this.reading) this.setReading(false)
    if (this.reading) return
    // Remplacer tout le document n'est pas une modification suivie.
    const tr = this.state.tr.replaceWith(0, this.state.doc.content.size, blocksToPM(doc.blocks, doc.assets)).setMeta(TRACK_SKIP, true)
    if (!keepMeta) for (const [k, v] of Object.entries({ ...metaAttrs(doc.meta), ...designAttrs(doc) })) tr.setDocAttribute(k, v)
    // Les commentaires vont avec le texte, même quand le reste est gardé.
    else tr.setDocAttribute('comments', JSON.parse(JSON.stringify(doc.comments ?? [])))
    tr.setSelection(Selection.atStart(tr.doc)).scrollIntoView()
    // Une étape d'annulation à elle seule, séparée de la frappe d'avant et d'après.
    this.view.dispatch(closeHistory(tr))
    this.view.dispatch(closeHistory(this.state.tr))
  }

  /**
   * Remplace le contenu du fichier : un seul document remplace celui qui est
   * affiché (une étape annulable) ; plusieurs documents remplacent tout le
   * fichier, et celui qui a la même clé que le document affiché reçoit son
   * contenu de façon annulable.
   */
  replaceFile(file: FolioDoc): void {
    const docs = splitFile(file)
    if (docs.length === 1) return this.replaceDocument(docs[0], false)
    ensureKeys(docs)
    const keep = Math.max(0, docs.findIndex((d) => d.key === this.slots[this.active].key))
    const current = this.slots[this.active]
    this.slots = docs.map((d, i) => (i === keep ? { ...current, key: d.key! } : { key: d.key!, state: this.makeState(d), saved: null, scroll: 0, pages: null }))
    this.active = keep
    this.replaceDocument(docs[keep], false)
    this.view.dispatch(this.state.tr.setMeta(refsKey, true).setMeta('addToHistory', false))
    this.notify()
  }

  private acCache: { key: string; list: Map<string, string> } | null = null

  /** Réglages de la correction automatique pour ce document (sa langue choisit la liste). */
  autoCorrectOptions(): AutoCorrectOptions | null {
    const s = settings()
    if (!s.autoCorrect) return null
    const docLang = (this.state.doc.attrs.lang as string) || lang()
    const key = `${docLang}\u0000${JSON.stringify(s.acCustom)}\u0000${s.acRemoved.join('\u0000')}`
    if (this.acCache?.key !== key) this.acCache = { key, list: effectiveList(docLang, s.acCustom, s.acRemoved) }
    return { quotes: s.acQuotes, frenchSpacing: s.acFrenchSpacing, replace: s.acReplace, capitalize: s.acCapitalize, list: this.acCache.list, lang: docLang }
  }

  /** Nouveau document vide : efface le contenu ; la démonstration perd aussi ses propriétés. */
  newBlank(): void {
    // Une copie en lecture seule ne s'efface pas : on part d'une copie modifiable.
    if (this.lockedReadOnly) this.editCopy()
    this.setReading(false)
    const wasDemo = this.isDemo
    this.isDemo = false
    let blank: FolioDoc
    if (wasDemo) {
      // Depuis la démonstration : un document neuf. Rien de la démonstration ne reste
      // (en-tête « {{title}} », pied de page, style « Astuce », destinataires, sources…).
      const fresh = loadDocument({ format: 'folio/doc', version: 1, blocks: [] })
      blank = { ...(fresh.ok ? fresh.doc : this.getDoc()), meta: emptyMeta(), blocks: [], comments: [] }
    } else {
      // Un document de l'utilisateur garde sa mise en page, son thème, ses propriétés, ses listes.
      blank = { ...this.getDoc(), blocks: [], comments: [] }
    }
    // Depuis la démonstration : le thème, les styles et la mise en page « par défaut » s'il y en a.
    this.replaceDocument(wasDemo ? withDefaultDesign(blank) : blank, !wasDemo)
    this.view.focus()
    toast(t('blank.done'), { kind: 'success' })
  }

  /** Charge un document (texte JSON ou objet) à la place du contenu actuel. */
  loadInto(input: unknown): LoadResult {
    // Une IA renvoie les images sous la forme « asset:… » sans leurs données : on reprend celles du document.
    const known = Object.assign({}, ...this.slots.map((_, i) => pmToDoc(this.slotState(i).doc, this.identity).assets)) as Record<string, string>
    const res = loadDocument(input, { assets: known })
    if (res.ok) {
      this.isDemo = false
      this.replaceFile(res.doc)
      this.report = res.report
      this.notify()
    }
    return res
  }

  undo(): void {
    this.view.focus()
    undo(this.state, this.view.dispatch)
  }

  redo(): void {
    this.view.focus()
    redo(this.state, this.view.dispatch)
  }

  selectAll(): void {
    this.view.focus()
    selectAll(this.state, this.view.dispatch)
  }

  focus(): void {
    this.view.focus()
  }
}

/** Pourquoi une formule ne se rend pas, en clair. */
export function describeMathProblem(p: MathProblem): string {
  if (p.kind === 'empty') return t('math.empty')
  if (p.kind === 'unknown') return t('math.unknownCommand', { command: p.command })
  return t('math.syntax', { message: p.message })
}
