// Plusieurs vues d'un même document : le volet du fractionnement (dans cette
// fenêtre) et les nouvelles fenêtres (onglets ouverts par « Nouvelle fenêtre »).
//
// La fenêtre principale fait autorité (prosemirror-collab) : chaque vue lui
// envoie ses étapes, elle les numérote et les renvoie à toutes, qui les
// appliquent (en rebasant leurs étapes non confirmées). Une nouvelle fenêtre
// communique par postMessage avec celle qui l'a ouverte, et seulement avec
// elle (la source de chaque message est vérifiée) ; les étapes reçues sont
// relues par le schéma, comme un document ouvert.

import { collab, getVersion, receiveTransaction, sendableSteps } from 'prosemirror-collab'
import { EditorState } from 'prosemirror-state'
import { Step } from 'prosemirror-transform'
import type { EditorView } from 'prosemirror-view'
import { schema } from '../editor/schema'

/** Marque des transactions venues d'une autre vue (posée par prosemirror-collab). */
export const isRemote = (tr: { getMeta(key: string): unknown }): boolean => !!tr.getMeta('collab$')

/** Préfixe des messages entre fenêtres. */
export const SYNC_TAG = 'folio-pages-sync'

export type SyncMessage =
  | { tag: typeof SYNC_TAG; type: 'hello' }
  | { tag: typeof SYNC_TAG; type: 'init'; doc: unknown; version: number; title: string; index: number }
  | { tag: typeof SYNC_TAG; type: 'steps'; version: number; steps: unknown[]; clientIDs: (string | number)[] }
  | { tag: typeof SYNC_TAG; type: 'send'; version: number; steps: unknown[]; clientID: string | number }
  | { tag: typeof SYNC_TAG; type: 'need'; version: number }
  | { tag: typeof SYNC_TAG; type: 'save' }
  | { tag: typeof SYNC_TAG; type: 'detach' }
  | { tag: typeof SYNC_TAG; type: 'bye' }

export const isSyncMessage = (d: unknown): d is SyncMessage => !!d && typeof d === 'object' && (d as { tag?: unknown }).tag === SYNC_TAG && typeof (d as { type?: unknown }).type === 'string'

/** Le greffon de collaboration d'un état (présent ou non). */
export const hasCollab = (state: EditorState): boolean => {
  try {
    getVersion(state)
    return true
  } catch {
    return false
  }
}

/** Ajoute le greffon de collaboration (à cette version) à un état qui ne l'a pas. */
export function withCollab(state: EditorState, version: number): EditorState {
  const plugins = state.plugins.filter((p) => !(p as unknown as { key?: string }).key?.startsWith('collab$'))
  return state.reconfigure({ plugins: [...plugins, collab({ version })] })
}

/** Étapes JSON reçues → étapes du schéma (null si l'une est illisible). */
export function stepsFromJson(list: unknown[]): Step[] | null {
  try {
    return list.map((j) => Step.fromJSON(schema, j as never))
  } catch {
    return null
  }
}

interface Remote {
  win: Window
  /** Version qu'elle a reçue. */
  version: number
  index: number
}

export interface HubHost {
  /** La vue principale. */
  main: () => EditorView
  /** Titre du document (pour les autres fenêtres). */
  title: () => string
  /** Demande d'enregistrement venue d'une autre fenêtre. */
  save: () => void
  /** Le nombre de vues a changé (interface). */
  changed: () => void
}

export class SyncHub {
  private version = 0
  /** Version de la première étape gardée. */
  private base = 0
  private steps: Step[] = []
  private clientIDs: (string | number)[] = []
  private panes = new Set<EditorView>()
  private remotes: Remote[] = []
  private scheduled = new Set<EditorView>()
  private nextIndex = 2
  private watch = 0

  constructor(private host: HubHost) {
    window.addEventListener('message', (e) => this.onMessage(e))
    // Fermée, la fenêtre principale libère les autres (elles continuent seules).
    window.addEventListener('pagehide', () => this.detachAll())
  }

  /** Nombre de fenêtres ouvertes depuis celle-ci. */
  get windows(): number {
    return this.remotes.length
  }

  /** La vue principale prend part à la synchronisation (au premier volet ou à la première fenêtre). */
  private ensureMain(): void {
    const main = this.host.main()
    if (!hasCollab(main.state)) main.updateState(withCollab(main.state, this.version))
  }

  /** Après une modification d'une vue : ses étapes seront confirmées (juste après, pas pendant sa transaction). */
  schedule(view: EditorView): void {
    if (!hasCollab(view.state) || this.scheduled.has(view)) return
    this.scheduled.add(view)
    queueMicrotask(() => {
      this.scheduled.delete(view)
      const s = sendableSteps(view.state)
      if (s) this.receive(s.version, s.steps, s.clientID)
    })
  }

  /** Étapes proposées par une vue : acceptées si elle était à jour, puis envoyées à toutes. */
  private receive(version: number, steps: readonly Step[], clientID: string | number): boolean {
    if (version !== this.version) return false
    for (const s of steps) {
      this.steps.push(s)
      this.clientIDs.push(clientID)
    }
    this.version += steps.length
    this.distribute()
    return true
  }

  /** Chaque vue reçoit ce qui lui manque. */
  private distribute(): void {
    for (const view of [this.host.main(), ...this.panes]) this.catchUp(view)
    for (const r of this.remotes) this.sendTo(r)
    this.trim()
  }

  private catchUp(view: EditorView): void {
    if (!hasCollab(view.state)) return
    const v = getVersion(view.state)
    if (v >= this.version) return
    if (v < this.base) return // ne devrait pas arriver : les volets sont toujours à jour
    view.dispatch(receiveTransaction(view.state, this.steps.slice(v - this.base), this.clientIDs.slice(v - this.base), { mapSelectionBackward: true }))
  }

  private sendTo(r: Remote): void {
    // Pas encore prête (elle se charge) : elle dira « hello ».
    if (r.version < 0 || r.version >= this.version) return
    if (r.version < this.base) return this.init(r)
    const from = r.version - this.base
    this.post(r.win, { tag: SYNC_TAG, type: 'steps', version: r.version, steps: this.steps.slice(from).map((s) => s.toJSON()), clientIDs: this.clientIDs.slice(from) })
    r.version = this.version
  }

  /** Les étapes que toutes les vues ont reçues ne servent plus. */
  private trim(): void {
    const views = [this.host.main(), ...this.panes].filter((v) => hasCollab(v.state)).map((v) => getVersion(v.state))
    const min = Math.min(this.version, ...views, ...this.remotes.map((r) => r.version))
    if (min > this.base) {
      this.steps.splice(0, min - this.base)
      this.clientIDs.splice(0, min - this.base)
      this.base = min
    }
  }

  // --- volets (dans cette fenêtre) --------------------------------------------------

  /** État de départ d'un volet : le document confirmé, avec ses greffons et la collaboration. */
  paneState(plugins: EditorState['plugins']): EditorState {
    this.ensureMain()
    this.flushNow()
    const doc = this.host.main().state.doc
    return EditorState.create({ schema, doc, plugins: [...plugins, collab({ version: this.version })] })
  }

  addPane(view: EditorView): void {
    this.panes.add(view)
    this.host.changed()
  }

  removePane(view: EditorView): void {
    this.panes.delete(view)
    this.scheduled.delete(view)
    this.host.changed()
  }

  /** Confirme tout de suite ce que la vue principale a d'étapes en attente. */
  private flushNow(): void {
    const main = this.host.main()
    const s = sendableSteps(main.state)
    if (s) this.receive(s.version, s.steps, s.clientID)
  }

  // --- autres fenêtres ----------------------------------------------------------------

  /** Ouvre une nouvelle fenêtre sur ce document (null si le navigateur la refuse). */
  openWindow(url: string): Window | null {
    this.ensureMain()
    const index = this.nextIndex++
    const win = window.open(`${url.split('#')[0]}#folio-window=${index}`, `folio-window-${Date.now()}-${index}`)
    if (!win) {
      this.nextIndex--
      return null
    }
    this.remotes.push({ win, version: -1, index })
    this.host.changed()
    // Une fenêtre fermée sans prévenir est oubliée.
    if (!this.watch) this.watch = window.setInterval(() => this.prune(), 1500)
    return win
  }

  private prune(): void {
    const before = this.remotes.length
    this.remotes = this.remotes.filter((r) => !r.win.closed)
    if (this.remotes.length !== before) this.host.changed()
    if (!this.remotes.length && this.watch) {
      clearInterval(this.watch)
      this.watch = 0
    }
  }

  private init(r: Remote): void {
    this.flushNow()
    this.post(r.win, { tag: SYNC_TAG, type: 'init', doc: this.host.main().state.doc.toJSON(), version: this.version, title: this.host.title(), index: r.index })
    r.version = this.version
  }

  private post(win: Window, msg: SyncMessage): void {
    try {
      win.postMessage(msg, '*')
    } catch {
      /* fenêtre fermée */
    }
  }

  private onMessage(e: MessageEvent): void {
    if (!isSyncMessage(e.data)) return
    const r = this.remotes.find((x) => x.win === e.source)
    if (!r) return
    const m = e.data
    switch (m.type) {
      case 'hello':
        this.init(r)
        break
      case 'send': {
        const steps = stepsFromJson(m.steps)
        if (!steps || typeof m.version !== 'number') return this.init(r)
        // Refusées si la fenêtre n'était pas à jour : elle les renverra, rebasées.
        if (!this.receive(m.version, steps, m.clientID)) this.sendTo(r)
        break
      }
      case 'need':
        if (typeof m.version !== 'number' || m.version < this.base) return this.init(r)
        r.version = Math.min(r.version, m.version)
        this.sendTo(r)
        break
      case 'save':
        this.host.save()
        break
      case 'bye':
        this.remotes = this.remotes.filter((x) => x !== r)
        this.host.changed()
        break
    }
  }

  /** Le document a été remplacé (ouverture, nouveau document) : les autres fenêtres continuent seules, les volets repartent. */
  reset(): void {
    this.detachAll()
    this.version = 0
    this.base = 0
    this.steps = []
    this.clientIDs = []
    const main = this.host.main()
    if (hasCollab(main.state) || this.panes.size) main.updateState(withCollab(main.state, 0))
  }

  private detachAll(): void {
    for (const r of this.remotes) this.post(r.win, { tag: SYNC_TAG, type: 'detach' })
    this.remotes = []
    this.host.changed()
  }
}
