// Insertion → Icônes : un jeu d'icônes libres intégré au fichier (Tabler Icons,
// MIT), cherchables en français et en anglais, de la couleur choisie ; et, si on
// le veut, le reste du jeu (plus de 5 000 icônes) cherché en ligne (Iconify),
// jamais en mode hors ligne. L'icône devient une image SVG du document, avec
// son nom en texte de remplacement.

import type { FolioApp } from '../app'
import { schema } from '../editor/schema'
import { isOffline, netFetch, OfflineError } from '../net'
import { settings } from '../settings'
import type { Key } from '../i18n/dict'
import { lang, t } from '../i18n/i18n'
import { openDialog } from './dialog'
import { h } from './dom'
import { ICON_SET } from './iconset'
import { colorPalette } from './palette'
import * as P from './panels'

const CATEGORIES = ['people', 'communication', 'work', 'places', 'nature', 'objects', 'symbols', 'science', 'food'] as const
const ONLINE = 'https://api.iconify.design'

/** Éléments et attributs admis dans une icône venue d'ailleurs (le reste est retiré). */
const TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g'])
const ATTRS = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-rule', 'clip-rule'])

/** Contenu SVG sûr : seulement des formes, des couleurs « currentColor » ou « none ». */
export function cleanIconBody(svg: string): string | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = doc.documentElement
  if (root.nodeName !== 'svg' || doc.querySelector('parsererror')) return null
  const out: string[] = []
  const walk = (el: Element) => {
    for (const c of Array.from(el.children)) {
      if (!TAGS.has(c.nodeName)) continue
      const attrs: string[] = []
      for (const a of Array.from(c.attributes)) {
        if (!ATTRS.has(a.name)) continue
        const v = a.value
        if ((a.name === 'fill' || a.name === 'stroke') && v !== 'none' && v !== 'currentColor') continue
        if (!/^[\w\s.,#%+-]*$/.test(v) || v.length > 20_000) continue
        attrs.push(`${a.name}="${v}"`)
      }
      if (c.nodeName === 'g') {
        out.push(`<g ${attrs.join(' ')}>`)
        walk(c)
        out.push('</g>')
      } else out.push(`<${c.nodeName} ${attrs.join(' ')}/>`)
    }
  }
  walk(root)
  const body = out.join('')
  return body.length ? body : null
}

/** L'icône en image SVG (URI data:), à la couleur donnée. */
export function iconDataUri(body: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" fill="none" color="${color}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
}

/** Insère l'icône au curseur : une image de 48 pt, sans habillage. */
function insert(app: FolioApp, body: string, label: string, color: string): void {
  const node = schema.nodes.figure.create({ src: iconDataUri(body, color), alt: label, width: 48, wrap: 'none', align: settings().imageAlign })
  app.run((state, dispatch) => {
    dispatch?.(state.tr.replaceSelectionWith(node).scrollIntoView())
    return true
  })
  app.focus()
}

/** Pour chercher : sans accents ni casse, « œ » et « æ » écrits en deux lettres (« coeur » trouve « cœur »). */
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')

export function iconsDialog(app: FolioApp): void {
  const fr = lang() === 'fr'
  let color = '#1f2937'
  const swatch = h('span', { class: 'fp-icons__swatch', 'aria-hidden': 'true' })
  const setColor = (c: string | null) => {
    color = (c && P.cssOf(app, c)) || app.theme.colors.text || '#1f2937'
    swatch.style.background = color
    for (const b of Array.from(dlg.el.querySelectorAll<HTMLElement>('.fp-icons__btn'))) b.style.color = color
  }
  const query = h('input', { type: 'search', class: 'fp-input', 'data-field': 'icon-search', placeholder: t('icons.search'), 'aria-label': t('icons.search') }) as HTMLInputElement
  const grid = h('div', { class: 'fp-icons__grid', 'data-field': 'icons' })
  const online = h('div', { class: 'fp-icons__grid', 'data-field': 'icons-online' })
  const onlineStatus = h('p', { class: 'fp-form__hint', 'aria-live': 'polite' })
  const button = (body: string, label: string, id: string) => {
    const b = h('button', { type: 'button', class: 'fp-icons__btn', title: label, 'aria-label': label, 'data-icon': id, style: `color:${color}` })
    b.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
    b.addEventListener('click', () => {
      insert(app, body, label, color)
      dlg.close('inserted')
    })
    return b
  }
  const render = () => {
    const q = norm(query.value.trim())
    grid.replaceChildren()
    let shown = 0
    for (const cat of CATEGORIES) {
      const items = ICON_SET.filter(([c, id, f, e]) => c === cat && (!q || norm(`${id} ${f} ${e}`).includes(q)))
      if (!items.length) continue
      shown += items.length
      grid.append(h('div', { class: 'fp-icons__cat' }, t(`icons.cat.${cat}` as Key)), ...items.map(([, id, f, e, body]) => button(body, fr ? f : e, id)))
    }
    if (!shown) grid.append(h('p', { class: 'fp-muted' }, t('icons.none')))
  }
  const searchOnline = async () => {
    const q = query.value.trim()
    online.replaceChildren()
    if (!q) {
      onlineStatus.textContent = t('icons.onlineHint')
      return
    }
    if (isOffline()) {
      onlineStatus.textContent = t('icons.offline')
      return
    }
    onlineStatus.textContent = t('online.searching')
    try {
      const res = await netFetch(`${ONLINE}/search?query=${encodeURIComponent(q)}&prefix=tabler&limit=48`)
      const data = (await res.json()) as { icons?: unknown[] }
      const names = (Array.isArray(data.icons) ? data.icons : []).filter((x): x is string => typeof x === 'string' && /^tabler:[a-z0-9-]{1,60}$/.test(x)).map((x) => x.slice(7))
      onlineStatus.textContent = names.length ? t('icons.onlineFound', { n: names.length }) : t('icons.none')
      const bodies = await Promise.all(names.map((n) => netFetch(`${ONLINE}/tabler/${n}.svg`).then((r) => (r.ok ? r.text() : '')).catch(() => '')))
      names.forEach((n, i) => {
        const body = bodies[i] ? cleanIconBody(bodies[i]) : null
        if (body) online.append(button(body, n.replace(/-/g, ' '), `tabler:${n}`))
      })
    } catch (e) {
      onlineStatus.textContent = e instanceof OfflineError ? t('icons.offline') : t('icons.onlineFailed')
    }
  }
  query.addEventListener('input', render)
  query.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void searchOnline()
    }
  })
  const more = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-action': 'icons-online', disabled: isOffline() }, t('icons.online'))
  more.addEventListener('click', () => void searchOnline())
  const palette = colorPalette({ theme: app.theme, current: null, noneLabel: t('icons.defaultColor'), onPick: (c) => setColor(c) })
  const dlg = openDialog({
    name: 'icons',
    title: t('icons.title'),
    wide: true,
    focus: query,
    body: [
      h('div', { class: 'fp-icons__bar' }, query, h('details', { class: 'fp-icons__color' }, h('summary', {}, swatch, t('icons.color')), palette)),
      grid,
      h('div', { class: 'fp-icons__more' }, more, onlineStatus),
      online,
      h('p', { class: 'fp-form__hint' }, t('icons.license')),
    ],
    actions: [{ label: t('action.close'), value: 'close', primary: true }],
  })
  setColor(null)
  render()
  if (isOffline()) onlineStatus.textContent = t('icons.offline')
}
