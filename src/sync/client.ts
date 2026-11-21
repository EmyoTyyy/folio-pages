// Une fenêtre ouverte par « Nouvelle fenêtre » : elle reçoit le document de
// celle qui l'a ouverte, puis échange avec elle ses modifications (étapes).
// Seuls les messages de cette fenêtre-là sont écoutés. Si elle se ferme ou
// ouvre un autre document, celle-ci continue seule.

import { getVersion, receiveTransaction, sendableSteps } from 'prosemirror-collab'
import type { EditorView } from 'prosemirror-view'
import { hasCollab, isSyncMessage, stepsFromJson, SYNC_TAG, type SyncMessage } from './hub'

export interface ClientHost {
  view: () => EditorView
  /** Le document reçu (JSON ProseMirror) devient celui de cette fenêtre, à cette version. */
  adopt: (doc: unknown, version: number, title: string, index: number) => boolean
  /** La fenêtre principale s'est fermée (ou a changé de document) : on continue seul. */
  detached: () => void
  /** Synchronisée (l'interface montre l'état). */
  ready: () => void
}

/** Numéro de fenêtre demandé par l'adresse (#folio-window=2), si celle-ci a été ouverte par une autre. */
export function windowRequest(): number | null {
  const m = /#folio-window=(\d{1,3})$/.exec(location.hash)
  return m && window.opener ? Number(m[1]) : null
}

export class SyncClient {
  private opener: Window
  private ready = false
  private sent = { version: -1, count: 0 }
  private pending = false
  private watch = 0

  constructor(private host: ClientHost) {
    this.opener = window.opener as Window
    // L'adresse redevient celle du fichier (un rechargement ne redemande rien).
    try {
      history.replaceState(null, '', location.href.split('#')[0])
    } catch {
      /* adresse de fichier : on garde le fragment */
    }
    window.addEventListener('message', (e) => this.onMessage(e))
    window.addEventListener('pagehide', () => this.post({ tag: SYNC_TAG, type: 'bye' }))
    this.post({ tag: SYNC_TAG, type: 'hello' })
    // La fenêtre principale fermée sans prévenir.
    this.watch = window.setInterval(() => {
      if (this.opener.closed) this.detach()
    }, 1500)
  }

  get active(): boolean {
    return this.ready
  }

  private post(msg: SyncMessage): void {
    try {
      this.opener.postMessage(msg, '*')
    } catch {
      this.detach()
    }
  }

  /** Après une modification : les étapes partent juste après la transaction. */
  schedule(): void {
    if (!this.ready || this.pending) return
    this.pending = true
    queueMicrotask(() => {
      this.pending = false
      this.send()
    })
  }

  private send(): void {
    const view = this.host.view()
    if (!this.ready || !hasCollab(view.state)) return
    const s = sendableSteps(view.state)
    if (!s) return
    // Pas deux fois les mêmes étapes à la même version.
    if (s.version === this.sent.version && s.steps.length === this.sent.count) return
    this.sent = { version: s.version, count: s.steps.length }
    this.post({ tag: SYNC_TAG, type: 'send', version: s.version, steps: s.steps.map((x) => x.toJSON()), clientID: s.clientID })
  }

  /** Recommander la vue depuis une version (étapes manquantes). */
  private need(): void {
    this.post({ tag: SYNC_TAG, type: 'need', version: getVersion(this.host.view().state) })
  }

  /** Enregistrer : c'est la fenêtre principale qui écrit le fichier. */
  requestSave(): void {
    this.post({ tag: SYNC_TAG, type: 'save' })
  }

  private onMessage(e: MessageEvent): void {
    if (e.source !== this.opener || !isSyncMessage(e.data)) return
    const m = e.data
    switch (m.type) {
      case 'init':
        if (typeof m.version !== 'number' || !this.host.adopt(m.doc, m.version, String(m.title ?? ''), Number(m.index) || 2)) return this.detach()
        this.ready = true
        this.sent = { version: -1, count: 0 }
        this.host.ready()
        break
      case 'steps': {
        if (!this.ready) return
        const view = this.host.view()
        const steps = stepsFromJson(m.steps)
        const v = getVersion(view.state)
        if (!steps || typeof m.version !== 'number' || m.version > v) return this.need()
        const skip = v - m.version
        if (skip < steps.length) {
          try {
            view.dispatch(receiveTransaction(view.state, steps.slice(skip), m.clientIDs.slice(skip), { mapSelectionBackward: true }))
          } catch {
            return this.need()
          }
        }
        this.send()
        break
      }
      case 'detach':
        this.detach()
        break
    }
  }

  private detach(): void {
    if (this.watch) clearInterval(this.watch)
    this.watch = 0
    if (!this.ready) return
    this.ready = false
    this.host.detached()
  }
}
