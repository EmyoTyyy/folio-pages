// Galerie des modèles : « Nouveau à partir d'un modèle… ». Un modèle s'utilise
// ici (il remplace le document ouvert, annulable) ou dans un nouvel onglet.

import type { FolioApp } from '../app'
import { loadDocument } from '../format/load'
import { mintId, type FolioDoc } from '../format/types'
import type { Key } from '../i18n/dict'
import { lang, t } from '../i18n/i18n'
import { TEMPLATES, type Template } from '../templates/templates'
import { openDialog, toast } from './dialog'
import { h } from './dom'
import { openInNewTab } from './mailings'
import { withDefaultDesign } from '../defaults'

/** Le document d'un modèle, dans la langue de l'interface. */
export function templateDoc(tpl: Template, author = ''): FolioDoc | null {
  const fr = lang().startsWith('fr')
  const now = new Date().toISOString()
  const res = loadDocument(tpl.build(fr), { now })
  if (!res.ok) return null
  // Le document vide suit les réglages « par défaut » de l'utilisateur.
  const doc = tpl.id === 'blank' ? withDefaultDesign(res.doc) : res.doc
  doc.id = mintId()
  doc.meta = { ...doc.meta, author: author || doc.meta.author, created: now, modified: '' }
  return doc
}

/** Vignette : une page en miniature, dessinée à partir de l'esquisse du modèle. */
function thumbnail(tpl: Template): HTMLElement {
  const page = h('div', { class: 'fp-tpl__page', 'aria-hidden': 'true' })
  for (const line of tpl.sketch) page.append(h('i', { class: `fp-tpl__l fp-tpl__l--${line}` }))
  return page
}

export function useTemplate(app: FolioApp, tpl: Template): void {
  const cur = app.getDoc()
  const doc = templateDoc(tpl, app.isDemo ? '' : cur.meta.author)
  if (!doc) return
  // Le fichier ouvert garde son identité : on remplace son contenu, comme « Nouveau document vide ».
  doc.id = cur.id
  app.isDemo = false
  if (app.lockedReadOnly) app.editCopy()
  app.setReading(false)
  app.replaceDocument(doc, false)
  app.focus()
  toast(t('tpl.applied', { name: t(`tpl.${tpl.id}` as Key) }), { kind: 'success', timeout: 8000 })
}

export function templateGallery(app: FolioApp): void {
  let chosen: Template = TEMPLATES[0]
  const cards: HTMLButtonElement[] = []
  const grid = h('div', { class: 'fp-tpl__grid', role: 'radiogroup', 'aria-label': t('tpl.title') })
  const select = (tpl: Template) => {
    chosen = tpl
    cards.forEach((c) => {
      const on = c.dataset.template === tpl.id
      c.classList.toggle('is-selected', on)
      c.setAttribute('aria-checked', String(on))
      c.tabIndex = on ? 0 : -1
    })
  }
  let handle: ReturnType<typeof openDialog> | null = null
  for (const tpl of TEMPLATES) {
    const card = h(
      'button',
      { type: 'button', class: 'fp-tpl__card', role: 'radio', 'data-template': tpl.id, 'aria-checked': 'false' },
      thumbnail(tpl),
      h('span', { class: 'fp-tpl__name' }, t(`tpl.${tpl.id}` as Key)),
      h('span', { class: 'fp-tpl__desc' }, t(`tpl.${tpl.id}.desc` as Key)),
    ) as HTMLButtonElement
    card.addEventListener('click', () => select(tpl))
    card.addEventListener('dblclick', () => {
      select(tpl)
      handle?.close('use')
      useTemplate(app, tpl)
    })
    card.addEventListener('keydown', (e) => {
      const i = TEMPLATES.indexOf(tpl)
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
      if (!step) return
      e.preventDefault()
      const next = TEMPLATES[(i + step + TEMPLATES.length) % TEMPLATES.length]
      select(next)
      cards[TEMPLATES.indexOf(next)].focus()
    })
    cards.push(card)
    grid.append(card)
  }
  select(chosen)
  handle = openDialog({
    name: 'templates',
    title: t('tpl.title'),
    wide: true,
    focus: cards[0],
    body: [h('p', { class: 'fp-form__hint' }, t('tpl.intro')), grid, h('p', { class: 'fp-form__hint' }, t('tpl.useHint'))],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('tpl.newTab'),
        value: 'tab',
        run: () => {
          const doc = templateDoc(chosen, app.isDemo ? '' : app.getDoc().meta.author)
          if (!doc) return
          const name = `${t(`tpl.${chosen.id}` as Key)}.html`
          const how = openInNewTab(doc, name)
          toast(how === 'tab' ? t('tpl.openedTab', { name: t(`tpl.${chosen.id}` as Key) }) : t('tpl.downloaded', { file: name }), { kind: 'info', timeout: 8000 })
        },
      },
      { label: t('tpl.use'), value: 'use', primary: true, run: () => useTemplate(app, chosen) },
    ],
  })
}
