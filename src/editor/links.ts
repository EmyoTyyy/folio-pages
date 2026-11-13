// Liens : les suivre et les retoucher.
//
// Pendant l'édition, un clic place le curseur (on écrit dans le lien) ;
// Ctrl+clic (⌘+clic sur Mac) l'ouvre, comme dans les traitements de texte
// habituels. En lecture, un simple clic suffit. Le lien s'ouvre dans un nouvel
// onglet, sans accès à cette page (noopener). Un lien interne (#ancre) mène au
// titre correspondant.
//
// Quand le curseur est dans un lien, une petite bulle sous le lien montre son
// adresse (cliquable), et permet de le modifier ou de le retirer.

import type { Mark } from 'prosemirror-model'
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { isSafeLink } from '../format/spec'
import { isOffline, isWebUrl, openUrl } from '../net'
import { schema } from './schema'

export interface LinkHooks {
  labels: () => { open: string; edit: string; remove: string; hint: string }
  /** Ouvre la fenêtre de modification du lien. */
  edit: () => void
  /** Retire le lien sous le curseur. */
  remove: () => void
  /** Va à un titre (#ancre) ; renvoie false s'il n'existe pas. */
  jump?: (anchor: string) => boolean
  /** Ouverture d'une adresse (remplaçable pour les tests). */
  open?: (href: string) => void
  /** Une adresse du web refusée (mode hors ligne). */
  blocked?: (href: string) => void
}

export const linksKey = new PluginKey('folio-links')

/** Le lien sous le curseur (sélection vide, ou toute dans le même lien). */
export function linkAt(state: EditorState): { from: number; to: number; mark: Mark } | null {
  const type = schema.marks.link
  const { $from, from, to } = state.selection
  const mark = type.isInSet($from.marks()) ?? (from === to ? null : type.isInSet(state.doc.resolve(from + 1).marks()))
  if (!mark) return null
  // Les étendues contiguës de ce lien dans le bloc ; celle qui contient le curseur.
  const base = $from.start()
  const ranges: { from: number; to: number }[] = []
  $from.parent.forEach((child, offset) => {
    if (!mark.isInSet(child.marks)) return
    const a = base + offset
    const last = ranges[ranges.length - 1]
    if (last && last.to === a) last.to = a + child.nodeSize
    else ranges.push({ from: a, to: a + child.nodeSize })
  })
  const r = ranges.find((x) => x.from <= from && to <= x.to)
  return r ? { ...r, mark } : null
}

/** Ouvre une adresse : jamais javascript:, data:…, toujours dans un nouvel onglet isolé. */
export function followLink(href: string, hooks?: Pick<LinkHooks, 'jump' | 'open' | 'blocked'>): boolean {
  if (!href || !isSafeLink(href)) return false
  if (href.startsWith('#')) return hooks?.jump?.(decodeURIComponent(href.slice(1))) ?? false
  // Le mode hors ligne bloque les adresses du web (le courriel et le téléphone restent).
  if (isOffline() && isWebUrl(href)) {
    hooks?.blocked?.(href)
    return false
  }
  if (hooks?.open) hooks.open(href)
  else openUrl(href)
  return true
}

const anchorOf = (view: EditorView, target: EventTarget | null): HTMLAnchorElement | null => {
  const el = target instanceof Element ? target.closest('a[href]') : null
  // Seulement les liens du texte (pas les entrées de la table des matières, qui ont leur clic).
  return el && view.dom.contains(el) && !el.closest('.fp-toc, [contenteditable="false"]:not(.fp-prose)') ? (el as HTMLAnchorElement) : null
}

class LinkBubble {
  readonly el: HTMLElement
  private url: HTMLAnchorElement
  private href = ''
  constructor(
    view: EditorView,
    private hooks: LinkHooks,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'fp-linkbubble'
    this.el.setAttribute('role', 'toolbar')
    this.el.hidden = true
    this.url = document.createElement('a')
    this.url.className = 'fp-linkbubble__url'
    this.url.rel = 'noopener noreferrer'
    this.url.target = '_blank'
    this.url.addEventListener('click', (e) => {
      e.preventDefault()
      followLink(this.href, this.hooks)
    })
    const button = (name: string, run: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'fp-linkbubble__btn'
      b.dataset.link = name
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', run)
      return b
    }
    this.el.append(this.url, button('edit', () => this.hooks.edit()), button('remove', () => this.hooks.remove()))
    document.body.append(this.el)
    this.update(view)
  }
  update(view: EditorView): void {
    const link = view.editable && view.hasFocus() ? linkAt(view.state) : null
    if (!link) {
      this.el.hidden = true
      return
    }
    const l = this.hooks.labels()
    this.href = link.mark.attrs.href as string
    this.url.href = this.href
    this.url.textContent = this.href.replace(/^mailto:/, '').replace(/^https?:\/\//, '').slice(0, 60) + (this.href.length > 68 ? '…' : '')
    this.url.title = `${l.open} : ${this.href}`
    const [edit, remove] = Array.from(this.el.querySelectorAll('button'))
    edit.textContent = l.edit
    remove.textContent = l.remove
    // Sous le début du lien, sans sortir de la fenêtre.
    const at = view.coordsAtPos(link.from)
    const end = view.coordsAtPos(link.to)
    this.el.hidden = false
    const w = this.el.offsetWidth
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, at.left))
    this.el.style.left = `${left}px`
    this.el.style.top = `${Math.min(window.innerHeight - this.el.offsetHeight - 8, Math.max(at.bottom, end.bottom) + 6)}px`
  }
  destroy(): void {
    this.el.remove()
  }
}

export function linksPlugin(hooks: LinkHooks): Plugin {
  let bubble: LinkBubble | null = null
  return new Plugin({
    key: linksKey,
    view: (view) => {
      bubble = new LinkBubble(view, hooks)
      const hide = () => {
        // Le défilement déplace le texte : la bulle se replace (ou se cache).
        if (bubble) bubble.update(view)
      }
      window.addEventListener('scroll', hide, true)
      // Ctrl (⌘) enfoncé : la main au-dessus des liens, qui se suivent au clic.
      const ctrl = (e: KeyboardEvent) => document.documentElement.classList.toggle('is-ctrl', e.ctrlKey || e.metaKey)
      const off = () => document.documentElement.classList.remove('is-ctrl')
      window.addEventListener('keydown', ctrl)
      window.addEventListener('keyup', ctrl)
      window.addEventListener('blur', off)
      return {
        update: (v) => bubble?.update(v),
        destroy: () => {
          window.removeEventListener('keydown', ctrl)
          window.removeEventListener('keyup', ctrl)
          window.removeEventListener('blur', off)
          window.removeEventListener('scroll', hide, true)
          bubble?.destroy()
          bubble = null
        },
      }
    },
    props: {
      handleDOMEvents: {
        // Le navigateur ne suit jamais un lien de l'éditeur de lui-même (il quitterait l'application).
        click: (view, e) => {
          const a = anchorOf(view, e.target)
          if (!a) return false
          e.preventDefault()
          if (!view.editable || e.ctrlKey || e.metaKey) {
            followLink(a.getAttribute('href') ?? '', hooks)
            return true
          }
          return false
        },
        auxclick: (view, e) => {
          const a = anchorOf(view, e.target)
          if (!a) return false
          e.preventDefault()
          if (e.button === 1) followLink(a.getAttribute('href') ?? '', hooks)
          return true
        },
        mouseover: (view, e) => {
          const a = anchorOf(view, e.target)
          if (a && !a.title) a.title = view.editable ? `${a.getAttribute('href')}\n${hooks.labels().hint}` : (a.getAttribute('href') ?? '')
          return false
        },
        focus: (view) => {
          bubble?.update(view)
          return false
        },
        blur: (view) => {
          // Un clic dans la bulle ne doit pas la faire disparaître avant d'agir.
          setTimeout(() => bubble?.update(view), 120)
          return false
        },
      },
    },
  })
}
