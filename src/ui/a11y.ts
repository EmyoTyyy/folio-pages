// Vérifier l'accessibilité (Révision → Accessibilité) : ce qui gêne une
// personne qui lit avec un lecteur d'écran. Images sans texte de
// remplacement, tableaux sans ligne d'en-tête, niveaux de titre sautés, titres
// vides, liens au texte peu parlant, document sans titre ni langue.

import { NodeSelection, TextSelection } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import type { FolioApp } from '../app'
import { schema } from '../editor/schema'
import type { Key } from '../i18n/dict'
import { t } from '../i18n/i18n'
import { openDialog } from './dialog'
import { h } from './dom'

export interface A11yIssue {
  kind: 'alt' | 'tableHeader' | 'headingSkip' | 'emptyHeading' | 'noTitle' | 'noLang' | 'vagueLink'
  /** Position dans le document (pour « Afficher »), s'il y en a une. */
  pos?: number
  params?: Record<string, string | number>
}

const VAGUE = /^(ici|là|cliquez ici|clique ici|lien|ce lien|plus|en savoir plus|lire la suite|here|click here|link|this link|more|read more|learn more)$/i

/** Les problèmes du document, dans l'ordre du texte. */
export function checkAccessibility(doc: PMNode): A11yIssue[] {
  const out: A11yIssue[] = []
  if (!String(doc.attrs.title ?? '').trim()) out.push({ kind: 'noTitle' })
  if (!String(doc.attrs.lang ?? '').trim()) out.push({ kind: 'noLang' })
  let prevLevel = 0
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.figure) {
      if (!String(node.attrs.alt ?? '').trim()) out.push({ kind: 'alt', pos })
      return true
    }
    if (node.type === schema.nodes.table) {
      if (node.firstChild?.firstChild?.type !== schema.nodes.table_header) out.push({ kind: 'tableHeader', pos })
      return true
    }
    if (node.type === schema.nodes.heading) {
      const level = node.attrs.level as number
      if (!node.textContent.trim()) out.push({ kind: 'emptyHeading', pos })
      if (prevLevel && level > prevLevel + 1) out.push({ kind: 'headingSkip', pos, params: { from: prevLevel, to: level } })
      prevLevel = level
    }
    if (node.isText) {
      const link = node.marks.find((m) => m.type === schema.marks.link)
      if (link && VAGUE.test(node.text!.trim())) out.push({ kind: 'vagueLink', pos, params: { text: node.text!.trim() } })
    }
    return true
  })
  return out.slice(0, 300)
}

function show(app: FolioApp, pos: number): void {
  const node = app.state.doc.nodeAt(pos)
  const sel = node && !node.isText && (node.type === schema.nodes.figure || node.type === schema.nodes.table) ? NodeSelection.create(app.state.doc, pos) : TextSelection.near(app.state.doc.resolve(Math.min(pos + 1, app.state.doc.content.size)))
  app.view.dispatch(app.state.tr.setSelection(sel).scrollIntoView())
  app.focus()
}

/** La fenêtre du vérificateur : la liste, et « Afficher » pour chaque problème situé. */
export function accessibilityDialog(app: FolioApp): void {
  const issues = checkAccessibility(app.state.doc)
  const list = issues.length
    ? h(
        'ul',
        { class: 'fp-report', 'data-field': 'a11y' },
        ...issues.map((i) => {
          const li = h('li', { class: 'fp-report__item fp-report__item--warning', 'data-a11y': i.kind }, h('span', {}, t(`a11y.${i.kind}` as Key, i.params ?? {})))
          if (i.pos !== undefined) {
            const go = h('button', { type: 'button', class: 'fp-btn fp-btn--small', 'data-a11y-go': String(i.pos) }, t('a11y.go'))
            go.addEventListener('click', () => {
              dlg.close('close')
              show(app, i.pos!)
            })
            li.append(' ', go)
          }
          return li
        }),
      )
    : h('p', { class: 'fp-ok', 'data-field': 'a11y-ok' }, t('a11y.ok'))
  const dlg = openDialog({
    name: 'a11y',
    title: t('a11y.title'),
    body: [h('p', { class: 'fp-muted' }, t('a11y.intro')), list],
    actions: [{ label: t('action.close'), value: 'close', primary: true }],
  })
}
