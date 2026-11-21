// Onglet Affichage, groupe Fenêtre : nouvelle fenêtre (synchronisée),
// fractionner, côte à côte, défilement synchrone, rétablir la position.
//
// Le fractionnement ajoute un second volet modifiable sur le même document,
// sous la page (fractionner) ou à côté (côte à côte), en texte continu. Les
// deux vues échangent leurs modifications par étapes (sync/hub.ts).

import { markupClasses } from './markup'
import { EditorView } from 'prosemirror-view'
import type { FolioApp } from '../app'
import { editorPlugins, nodeViews } from '../editor/setup'
import { lang, t } from '../i18n/i18n'
import { settings } from '../settings'
import { SyncClient, windowRequest } from '../sync/client'
import { SyncHub } from '../sync/hub'
import { toast } from './dialog'
import { h, icon } from './dom'
import { ICONS } from './icons'

export type SplitMode = 'rows' | 'columns'

class SplitPane {
  readonly el: HTMLElement
  readonly scroller: HTMLElement
  view: EditorView
  private mount: HTMLElement

  constructor(
    private app: FolioApp,
    private hub: SyncHub,
    onClose: () => void,
  ) {
    this.mount = h('div', { class: 'fp-editor' })
    const page = h('div', { class: 'fp-page fp-split-page' }, this.mount)
    this.scroller = h('div', { class: 'fp-split-pane__scroll' }, page)
    const close = h('button', { type: 'button', class: 'fp-iconbtn', 'data-split-close': '', title: t('win.closePane'), 'aria-label': t('win.closePane') }, icon(ICONS.close))
    close.addEventListener('click', onClose)
    this.el = h('section', { class: 'fp-split-pane', 'data-split-pane': '', 'aria-label': t('win.pane') }, h('div', { class: 'fp-split-pane__bar' }, h('span', {}, t('win.pane')), close), this.scroller)
    this.view = this.create()
  }

  private create(): EditorView {
    const app = this.app
    const view: EditorView = new EditorView(this.mount, {
      state: this.hub.paneState(editorPlugins(app.editorCtx)),
      nodeViews: nodeViews(app.editorCtx),
      attributes: (s) => ({
        class: 'fp-prose' + (settings().showMarks ? ' show-marks' : '') + ` track-${settings().trackView}` + markupClasses() + (s.doc.attrs.hyphenate ? ' is-hyphenated' : ''),
        spellcheck: settings().spellcheck ? 'true' : 'false',
        lang: (s.doc.attrs.lang as string) || lang(),
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': `${t('editor.label')} — ${t('win.pane')}`,
      }),
      editable: () => !app.reading,
      dispatchTransaction: (tr) => {
        view.updateState(view.state.apply(tr))
        if (tr.docChanged) this.hub.schedule(view)
        app.notifyUi()
      },
    })
    // Les commandes du ruban vont au volet où l'on écrit.
    view.dom.addEventListener('focus', () => (app.alt = view))
    this.hub.addPane(view)
    return view
  }

  /** Le document a été remplacé : le volet repart sur le nouveau. */
  rebuild(): void {
    this.hub.removePane(this.view)
    if (this.app.alt === this.view) this.app.alt = null
    this.view.destroy()
    this.view = this.create()
  }

  destroy(): void {
    this.hub.removePane(this.view)
    if (this.app.alt === this.view) this.app.alt = null
    this.view.destroy()
    this.el.remove()
  }
}

/** État du groupe Fenêtre, pour le ruban. */
export interface WindowsUi {
  mode: () => SplitMode | null
  split: (mode: SplitMode) => void
  syncScroll: () => boolean
  toggleSyncScroll: () => void
  resetPosition: () => void
  newWindow: () => void
  canOpenWindows: () => boolean
}

let ui: WindowsUi | null = null
export const windowsUi = () => ui

/**
 * Installe les vues multiples : dans une fenêtre ouverte par une autre, la synchronisation avec elle ;
 * sinon, le fractionnement et les nouvelles fenêtres.
 */
export function installWindows(app: FolioApp, box: HTMLElement, canvas: HTMLElement): WindowsUi {
  const index = windowRequest()
  if (index) {
    app.syncClient = new SyncClient({
      view: () => app.view,
      adopt: (doc, version, _title, n) => {
        app.windowIndex = n
        const ok = app.adoptShared(doc, version)
        toast(ok ? t('win.joined', { n }) : t('win.unsafe'), { kind: ok ? 'success' : 'info' })
        return ok
      },
      ready: () => app.notifyUi(),
      detached: () => {
        app.windowIndex = 1
        app.markUnsaved()
        toast(t('win.detached'), { kind: 'info', timeout: 10000 })
        app.notifyUi()
      },
    })
  } else {
    app.sync = new SyncHub({
      main: () => app.view,
      title: () => app.title(),
      save: () => void app.save(),
      changed: () => app.notifyUi(),
    })
  }

  let pane: SplitPane | null = null
  let mode: SplitMode | null = null
  let ratio = 0.5
  let sync = false
  const divider = h('div', { class: 'fp-split-divider', role: 'separator', tabindex: '0', 'aria-label': t('win.divider'), 'data-split-divider': '' })

  const layout = () => {
    box.classList.toggle('is-split', !!mode)
    box.classList.toggle('is-columns', mode === 'columns')
    divider.setAttribute('aria-orientation', mode === 'columns' ? 'vertical' : 'horizontal')
    box.style.setProperty('--split-a', String(ratio))
    box.style.setProperty('--split-b', String(1 - ratio))
  }
  const close = () => {
    pane?.destroy()
    pane = null
    divider.remove()
    mode = null
    layout()
    app.focus()
    app.notifyUi()
  }
  const split = (m: SplitMode) => {
    if (!app.sync) return
    if (mode === m) return close()
    mode = m
    if (!pane) {
      pane = new SplitPane(app, app.sync, close)
      box.append(divider, pane.el)
      // Le volet s'ouvre là où l'on est.
      pane.scroller.scrollTop = canvas.scrollTop
    }
    layout()
    app.notifyUi()
  }

  // Un nouveau document : les volets repartent dessus, les autres fenêtres continuent seules.
  app.onStateReset = () => {
    app.sync?.reset()
    pane?.rebuild()
  }
  // Écrire dans la page reprend les commandes du ruban.
  app.view.dom.addEventListener('focus', () => {
    if (pane && app.alt === pane.view) app.alt = null
  })

  // Glisser la séparation (ou flèches au clavier).
  divider.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    divider.setPointerCapture(e.pointerId)
    const r = box.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      const f = mode === 'columns' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height
      ratio = Math.max(0.15, Math.min(0.85, f))
      layout()
    }
    const up = () => {
      divider.removeEventListener('pointermove', move)
      divider.removeEventListener('pointerup', up)
    }
    divider.addEventListener('pointermove', move)
    divider.addEventListener('pointerup', up)
  })
  divider.addEventListener('keydown', (e) => {
    const step = { ArrowUp: -0.05, ArrowLeft: -0.05, ArrowDown: 0.05, ArrowRight: 0.05 }[e.key]
    if (step === undefined) return
    e.preventDefault()
    ratio = Math.max(0.15, Math.min(0.85, ratio + step))
    layout()
  })

  // Défilement synchrone : l'un suit l'autre, du même écart.
  const last = new WeakMap<HTMLElement, number>()
  let echo: HTMLElement | null = null
  const follow = (from: HTMLElement, to: () => HTMLElement | null) => {
    from.addEventListener('scroll', () => {
      const prev = last.get(from) ?? from.scrollTop
      last.set(from, from.scrollTop)
      const other = to()
      if (!sync || !other) return
      if (echo === from) {
        echo = null
        return
      }
      echo = other
      other.scrollTop += from.scrollTop - prev
      last.set(other, other.scrollTop)
    })
  }
  follow(canvas, () => pane?.scroller ?? null)
  const watchPane = () => {
    if (pane && !pane.scroller.dataset.followed) {
      pane.scroller.dataset.followed = '1'
      follow(pane.scroller, () => canvas)
    }
  }

  ui = {
    mode: () => mode,
    split: (m) => {
      split(m)
      watchPane()
    },
    syncScroll: () => sync,
    toggleSyncScroll: () => {
      sync = !sync
      if (pane) {
        last.set(canvas, canvas.scrollTop)
        last.set(pane.scroller, pane.scroller.scrollTop)
      }
      app.notifyUi()
    },
    resetPosition: () => {
      ratio = 0.5
      layout()
    },
    newWindow: () => {
      if (!app.sync) return void toast(t('win.childOnly'), { kind: 'info' })
      const win = app.sync.openWindow(location.href)
      if (!win) return void toast(t('win.blocked'), { kind: 'error', timeout: 8000 })
      toast(t('win.opened', { n: app.sync.windows + 1 }), { kind: 'success' })
    },
    canOpenWindows: () => !!app.sync,
  }
  return ui
}
