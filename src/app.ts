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
import type { StyleDef, Theme } from './format/types'
import { settings } from './settings'
import type { Report } from './format/dsl'
import { prettyJson } from './format/json'
import { loadDocument, type LoadResult } from './format/load'
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
  })
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
        lang: () => lang(),
        labels: () => ({
          missingBookmark: t('ref.missingBookmark'),
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
    let state = EditorState.create({ schema, doc: docToPM(init.doc), plugins: editorPlugins(ctx) })
    // Les listes qui continuent la numérotation prennent leur numéro dès l'ouverture.
    const fix = fixNumbering(state)
    if (fix) state = state.apply(fix.setMeta('addToHistory', false))
    this.savedDoc = init.boot === 'recovered-text' ? null : state.doc
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
      editable: () => !this.reading,
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
    const slug = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
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
    return this.protectionChanged || this.savedDoc === null || !this.state.doc.eq(this.savedDoc)
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
    const docAtSave = this.state.doc
    const modified = new Date().toISOString()
    this.saving = true
    this.notify()
    let outcome: SaveOutcome
    try {
      const doc = this.getDoc()
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
    const doc = this.getDoc()
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
    const doc = this.getDoc()
    return compact ? JSON.stringify(toCompact(doc, { assets: false }), null, 2) : prettyJson(doc)
  }

  /** Le fichier complet tel qu'il serait enregistré maintenant. */
  serialize(modified = this.identity.modified): string {
    const doc = this.getDoc()
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
    const docAtSave = this.state.doc
    const doc = this.getDoc()
    doc.id = id
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
    let state = EditorState.create({ schema, doc: docToPM(doc), plugins: this.view.state.plugins })
    const fix = fixNumbering(state)
    if (fix) state = state.apply(fix.setMeta('addToHistory', false))
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
    return opened ?? fileNameFor(this.title().trim() || firstHeadingText(this.state.doc), t('title.placeholder'))
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
    let outcome: SaveOutcome
    const docAtSave = this.state.doc
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

  private afterSave(outcome: SaveOutcome, docAtSave: PMNode, modified: string): void {
    switch (outcome.kind) {
      case 'saved':
      case 'downloaded': {
        this.identity.modified = modified
        this.savedDoc = docAtSave
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
    const json = JSON.stringify(this.getDoc())
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
    this.replaceDocument(res.doc, false)
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
    const json = JSON.stringify(this.getDoc())
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
    if (contentKey(stored.doc) === contentKey(this.getDoc())) {
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
    this.replaceDocument(stored.doc, false)
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
    const res = loadDocument(input, { assets: this.getDoc().assets })
    if (res.ok) {
      this.isDemo = false
      this.replaceDocument(res.doc, false)
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
