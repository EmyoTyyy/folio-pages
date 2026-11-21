// Insertion → Diagramme : choisir une disposition (liste, processus, cycle,
// hiérarchie, pyramide, radial), écrire les éléments (une ligne chacun, deux
// espaces de retrait par niveau), un titre et des couleurs, avec un aperçu. Dans
// une liste à puces, le bouton transforme la liste en diagramme.

import { NodeSelection } from 'prosemirror-state'
import type { FolioApp } from '../app'
import { diagramAt, insertDiagram, listItemsAt, listToDiagram, updateDiagram } from '../editor/diagram'
import { chartLook } from '../format/chart'
import { DIAGRAM_COLORS, DIAGRAM_KINDS, DIAGRAM_LIMITS, diagramSvg, itemsFromText, itemsToText, type DiagramKind } from '../format/diagram'
import type { DiagramBlock, Theme } from '../format/types'
import type { Key } from '../i18n/dict'
import { t } from '../i18n/i18n'
import { openDialog } from './dialog'
import { h } from './dom'

const SAMPLE = (): DiagramBlock['items'] => [
  { text: t('dg.sample1'), level: 0 },
  { text: t('dg.sample2'), level: 0 },
  { text: t('dg.sample3'), level: 0 },
]

/** Le dialogue du diagramme : nouveau (`pos` absent) ou à modifier. */
export function diagramDialog(app: FolioApp, pos?: number, start?: DiagramBlock): void {
  const current = pos !== undefined ? diagramAt(app.state)?.diagram : undefined
  const fromList = pos === undefined && !start ? listItemsAt(app.state) : null
  const d: DiagramBlock = structuredClone(current ?? start ?? { type: 'diagram', kind: 'process', items: fromList?.items ?? SAMPLE() })
  const look = () => chartLook(app.state.doc.attrs.theme as Theme, app.state.doc.attrs.lang as string)
  const svgEl = (block: DiagramBlock) => {
    const tpl = document.createElement('template')
    tpl.innerHTML = diagramSvg(block, look())
    return tpl.content.firstElementChild as Element
  }

  const preview = h('div', { class: 'fp-dg-preview', 'data-dg-preview': '' })
  const kinds = h('div', { class: 'fp-dg-kinds', role: 'radiogroup', 'aria-label': t('dg.layout') })
  const draw = () => {
    preview.replaceChildren(svgEl(d))
    for (const b of Array.from(kinds.children)) b.setAttribute('aria-checked', String((b as HTMLElement).dataset.kind === d.kind))
  }
  for (const k of DIAGRAM_KINDS) {
    const sample: DiagramBlock = { type: 'diagram', kind: k, items: k === 'hierarchy' ? [{ text: 'A', level: 0 }, { text: 'B', level: 1 }, { text: 'C', level: 1 }] : [{ text: 'A', level: 0 }, { text: 'B', level: 0 }, { text: 'C', level: 0 }], ...(d.color ? { color: d.color } : {}) }
    const b = h('button', { type: 'button', class: 'fp-dg-kind', role: 'radio', 'data-kind': k, 'aria-checked': 'false', title: t(`dg.kind.${k}Hint` as Key) }, h('span', { class: 'fp-dg-kind__img' }, svgEl(sample)), h('span', {}, t(`dg.kind.${k}` as Key)))
    b.addEventListener('click', () => {
      d.kind = k as DiagramKind
      draw()
    })
    kinds.append(b)
  }
  const text = h('textarea', { class: 'fp-input fp-dg-text', rows: '7', 'data-field': 'dg-items', spellcheck: 'true', 'aria-label': t('dg.items') }) as HTMLTextAreaElement
  text.value = itemsToText(d.items)
  text.addEventListener('input', () => {
    const items = itemsFromText(text.value)
    d.items = items.length ? items : [{ text: '', level: 0 }]
    draw()
  })
  // Tab et Maj+Tab dans la zone de texte : un niveau de plus ou de moins pour la ligne.
  text.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const v = text.value
    const lineStart = v.lastIndexOf('\n', text.selectionStart - 1) + 1
    const caret = text.selectionStart
    if (e.shiftKey) {
      const n = v.startsWith('  ', lineStart) ? 2 : v.startsWith(' ', lineStart) ? 1 : 0
      text.value = v.slice(0, lineStart) + v.slice(lineStart + n)
      text.selectionStart = text.selectionEnd = Math.max(lineStart, caret - n)
    } else {
      text.value = v.slice(0, lineStart) + '  ' + v.slice(lineStart)
      text.selectionStart = text.selectionEnd = caret + 2
    }
    text.dispatchEvent(new Event('input'))
  })
  const title = h('input', { type: 'text', class: 'fp-input', maxlength: String(DIAGRAM_LIMITS.text), value: d.title ?? '', 'data-field': 'dg-title', 'aria-label': t('dg.title') }) as HTMLInputElement
  title.addEventListener('input', () => {
    const v = title.value.replace(/\s+/g, ' ').trim()
    if (v) d.title = v
    else delete d.title
    draw()
  })
  const color = h('select', { class: 'fp-input', 'data-field': 'dg-color', 'aria-label': t('dg.colors') }) as HTMLSelectElement
  for (const c of DIAGRAM_COLORS) color.append(h('option', { value: c, selected: (d.color ?? 'colorful') === c }, t(c === 'colorful' ? 'dg.colorful' : 'dg.oneColor', { n: c.slice(6) })))
  color.addEventListener('change', () => {
    if (color.value === 'colorful') delete d.color
    else d.color = color.value as DiagramBlock['color']
    draw()
  })

  const row = (label: string, control: HTMLElement) => h('label', { class: 'fp-form__row' }, h('span', { class: 'fp-label' }, label), control)
  draw()
  openDialog({
    name: 'diagram',
    title: t(current ? 'dg.editTitle' : 'dg.newTitle'),
    wide: true,
    focus: text,
    body: [
      kinds,
      h(
        'div',
        { class: 'fp-dg-layout' },
        h('div', { class: 'fp-dg-fields' }, row(t('dg.items'), text), h('p', { class: 'fp-form__hint' }, t('dg.itemsHint')), row(t('dg.title'), title), row(t('dg.colors'), color)),
        preview,
      ),
      fromList ? h('p', { class: 'fp-form__hint' }, t('dg.fromList')) : null,
    ].filter(Boolean) as HTMLElement[],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t(current ? 'action.ok' : 'action.insert'),
        value: 'ok',
        primary: true,
        run: () => {
          const items = itemsFromText(text.value)
          if (!items.length) {
            text.focus()
            return false
          }
          const block: DiagramBlock = { ...d, items }
          if (current && pos !== undefined) app.run(updateDiagram(pos, block))
          else if (fromList) {
            // La liste devient le diagramme (même étape d'annulation).
            app.run(listToDiagram(block.kind))
            const at = diagramAt(app.state)
            if (at) app.run(updateDiagram(at.pos, block))
          } else app.run(insertDiagram(block))
          return true
        },
      },
    ],
  })
}

/** Modifier le diagramme à cette position (double-clic, Entrée, menu contextuel). */
export function editDiagramAt(app: FolioApp, pos: number): void {
  if (diagramAt(app.state)?.pos !== pos) {
    const node = app.state.doc.nodeAt(pos)
    if (!node || node.type.name !== 'diagram') return
    app.view.dispatch(app.state.tr.setSelection(NodeSelection.create(app.state.doc, pos)))
  }
  diagramDialog(app, pos)
}
