// Éditeur d'équation (phase 6) : source LaTeX, aperçu en direct, modèles,
// disposition (dans la ligne, centrée, numérotée). Ouvert par double-clic ou
// Entrée sur une formule, Alt+= ou Insertion → Équation.

import type { EditorView } from 'prosemirror-view'
import type { FolioApp } from '../app'
import { describeMathProblem } from '../app'
import { insertEquation, insertMath, mathContextOf, setMath, drawTex, convertTexText } from '../editor/math'
import { schema } from '../editor/schema'
import { renderTex } from '../math'
import { t } from '../i18n/i18n'
import { openDialog, toast } from './dialog'
import { h } from './dom'

type Snippet = [tex: string, insert?: string]

/** Modèles : ce qui est montré (rendu), et ce qui est inséré ({} : le curseur va dans la première paire). */
const PALETTE: { key: 'structures' | 'greek' | 'operators' | 'relations' | 'more'; items: Snippet[] }[] = [
  {
    key: 'structures',
    items: [
      ['\\frac{a}{b}', '\\frac{}{}'],
      ['x^{n}', '^{}'],
      ['x_{i}', '_{}'],
      ['\\sqrt{x}', '\\sqrt{}'],
      ['\\sqrt[n]{x}', '\\sqrt[]{}'],
      ['\\sum_{i=1}^{n}', '\\sum_{i=1}^{n} '],
      ['\\prod_{i=1}^{n}', '\\prod_{i=1}^{n} '],
      ['\\int_{a}^{b}', '\\int_{}^{} \\,dx'],
      ['\\oint', '\\oint '],
      ['\\lim_{x\\to 0}', '\\lim_{x \\to } '],
      ['\\left( x \\right)', '\\left(  \\right)'],
      ['\\binom{n}{k}', '\\binom{}{}'],
      ['\\vec{v}', '\\vec{}'],
      ['\\hat{x}', '\\hat{}'],
      ['\\overline{AB}', '\\overline{}'],
      ['\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', '\\begin{pmatrix}\n  a & b \\\\\n  c & d\n\\end{pmatrix}'],
      ['\\begin{cases} 1 \\\\ 0 \\end{cases}', 'f(x) = \\begin{cases}\n  1 & \\text{si } x > 0 \\\\\n  0 & \\text{sinon}\n\\end{cases}'],
      ['\\begin{aligned} a&=b \\\\ &=c \\end{aligned}', '\\begin{aligned}\n  a &= b \\\\\n    &= c\n\\end{aligned}'],
      ['\\text{abc}', '\\text{}'],
    ],
  },
  {
    key: 'greek',
    items: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'phi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega'].map((g) => [`\\${g}`, `\\${g} `] as Snippet),
  },
  {
    key: 'operators',
    items: ['\\pm', '\\mp', '\\times', '\\div', '\\cdot', '\\circ', '\\partial', '\\nabla', '\\infty', '\\sin', '\\cos', '\\tan', '\\ln', '\\log', '\\exp', '\\max', '\\min', '\\cup', '\\cap', '\\setminus', '\\oplus', '\\otimes', '\\land', '\\lor', '\\neg', "f'"].map((x) => [x, `${x} `] as Snippet),
  },
  {
    key: 'relations',
    items: ['\\le', '\\ge', '\\ne', '\\approx', '\\equiv', '\\sim', '\\propto', '\\ll', '\\gg', '\\in', '\\notin', '\\subset', '\\subseteq', '\\forall', '\\exists', '\\to', '\\gets', '\\mapsto', '\\Rightarrow', '\\Leftrightarrow', '\\implies', '\\iff', '\\leftrightharpoons'].map((x) => [x, `${x} `] as Snippet),
  },
  {
    key: 'more',
    items: [
      ['\\mathbb{R}', '\\mathbb{R}'],
      ['\\mathbb{N}', '\\mathbb{N}'],
      ['\\mathbb{Z}', '\\mathbb{Z}'],
      ['\\mathbb{Q}', '\\mathbb{Q}'],
      ['\\mathbb{C}', '\\mathbb{C}'],
      ['\\emptyset', '\\emptyset '],
      ['\\{a, b\\}', '\\{ \\}'],
      ['\\ce{H2O}', '\\ce{}'],
      ['\\ce{A + B -> C}', '\\ce{ -> }'],
      ['\\ce{A <=> B}', '\\ce{ <=> }'],
      ['\\pu{9.81 m/s^2}', '\\pu{}'],
      ['\\textcolor{teal}{x}', '\\textcolor{teal}{}'],
      ['\\boxed{x}', '\\boxed{}'],
      ['\\dots', '\\dots '],
      ['\\quad', '\\quad '],
    ],
  },
]

/** Insère un modèle à la place de la sélection de la zone de texte ; le curseur va dans la première paire {}. */
function insertSnippet(area: HTMLTextAreaElement, snippet: string): void {
  const { selectionStart: a, selectionEnd: b, value } = area
  const selected = value.slice(a, b)
  let text = snippet
  const hole = text.indexOf('{}')
  // Le texte sélectionné va dans la première case.
  if (selected && hole >= 0) text = text.slice(0, hole + 1) + selected + text.slice(hole + 1)
  area.setRangeText(text, a, b, 'end')
  const caret = hole >= 0 && !selected ? a + hole + 1 : a + text.length
  area.setSelectionRange(caret, caret)
  area.dispatchEvent(new Event('input'))
  area.focus()
}

function paletteEl(area: HTMLTextAreaElement): HTMLElement {
  const tabs = h('div', { class: 'fp-eq-pal__tabs', role: 'tablist', 'aria-label': t('math.palette') })
  const panes = h('div', { class: 'fp-eq-pal__panes' })
  PALETTE.forEach((group, i) => {
    const tab = h('button', { type: 'button', role: 'tab', class: 'fp-eq-pal__tab', 'data-pal': group.key, 'aria-selected': String(i === 0) }, t(`math.pal.${group.key}`))
    const pane = h('div', { class: 'fp-eq-pal__pane', role: 'tabpanel', 'data-pal-pane': group.key })
    pane.hidden = i !== 0
    for (const [tex, ins] of group.items) {
      const b = h('button', { type: 'button', class: 'fp-eq-pal__item', title: ins ?? tex, 'data-snippet': ins ?? tex })
      const r = renderTex(tex, false)
      if (r.html) b.innerHTML = r.html
      else b.textContent = tex
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', () => insertSnippet(area, ins ?? tex))
      pane.append(b)
    }
    tab.addEventListener('click', () => {
      for (const x of Array.from(tabs.children)) x.setAttribute('aria-selected', String(x === tab))
      for (const p of Array.from(panes.children) as HTMLElement[]) p.hidden = p.dataset.palPane !== group.key
    })
    tabs.append(tab)
    panes.append(pane)
  })
  return h('div', { class: 'fp-eq-pal' }, tabs, panes)
}

export interface EquationTarget {
  view: EditorView
  /** Position de la formule modifiée ; null : nouvelle formule. */
  pos: number | null
  tex: string
  display: boolean
  numbered: boolean
}

/** Ouvre l'éditeur d'équation. */
export function equationDialog(app: FolioApp, target: EquationTarget): void {
  if (app.reading) return
  const ctx = mathContextOf(app.state)
  const area = h('textarea', { class: 'fp-input fp-eq__source', rows: '4', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'data-field': 'tex', 'aria-label': t('math.source') }) as HTMLTextAreaElement
  area.value = target.tex
  const preview = h('div', { class: 'fp-eq__preview', 'aria-live': 'polite', 'data-preview': '' })
  const status = h('p', { class: 'fp-eq__status', role: 'status' })
  const inline = h('input', { type: 'radio', name: 'fp-eq-layout', value: 'inline' }) as HTMLInputElement
  const display = h('input', { type: 'radio', name: 'fp-eq-layout', value: 'display' }) as HTMLInputElement
  const numbered = h('input', { type: 'checkbox', 'data-field': 'numbered' }) as HTMLInputElement
  inline.checked = !target.display
  display.checked = target.display
  numbered.checked = target.numbered
  // Dans un en-tête ou une note : pas d'équation numérotée (la numérotation suit le texte principal).
  const inMain = target.view === app.view
  const layout = h(
    'fieldset',
    { class: 'fp-eq__layout' },
    h('legend', { class: 'fp-label' }, t('math.layout')),
    h('label', { class: 'fp-check' }, inline, h('span', {}, t('math.inline'))),
    h('label', { class: 'fp-check' }, display, h('span', {}, t('math.display'))),
    inMain ? h('label', { class: 'fp-check' }, numbered, h('span', {}, t('math.numbered'))) : null,
  )

  const refresh = () => {
    const tex = area.value
    const isDisplay = display.checked
    numbered.disabled = !isDisplay
    preview.classList.toggle('is-display', isDisplay)
    if (!tex.trim()) {
      preview.replaceChildren(h('span', { class: 'fp-eq__placeholder' }, t('math.previewEmpty')))
      status.textContent = ''
      status.className = 'fp-eq__status'
      return
    }
    const host = h(isDisplay ? 'div' : 'span', { class: 'fp-eq__render' })
    const problem = drawTex(host, tex, isDisplay, ctx, describeMathProblem)
    preview.replaceChildren(host)
    status.textContent = problem ? describeMathProblem(problem) : t('math.ok')
    status.className = 'fp-eq__status' + (problem ? ' is-error' : ' is-ok')
  }
  area.addEventListener('input', refresh)
  for (const r of [inline, display]) r.addEventListener('change', refresh)

  const apply = (): boolean => {
    const tex = area.value.trim()
    const v = target.view
    const run = (cmd: import('prosemirror-state').Command) => {
      const ok = cmd(v.state, (tr) => v.dispatch(tr), v)
      v.focus()
      return ok
    }
    if (target.pos !== null) {
      run(setMath(target.pos, { tex, display: display.checked, numbered: numbered.checked && inMain }))
      return true
    }
    if (!tex) return true
    const ok = display.checked ? run(insertEquation(tex, numbered.checked && inMain)) : run(insertMath(tex))
    if (!ok) toast(t('math.notHere'), { kind: 'error' })
    return true
  }

  const actions = [
    { label: t('action.cancel'), value: 'cancel' },
    { label: target.pos === null ? t('math.insertAt') : t('action.ok'), value: 'ok', primary: true, run: apply },
  ]
  if (target.pos !== null) {
    actions.unshift({
      label: t('math.delete'),
      value: 'delete',
      danger: true,
      run: () => {
        area.value = ''
        return apply()
      },
    } as never)
  }
  const dlg = openDialog({
    name: 'equation',
    title: target.pos === null ? t('math.dialog.new') : t('math.dialog.edit'),
    wide: true,
    focus: area,
    body: [
      h('div', { class: 'fp-eq' }, h('label', { class: 'fp-label', for: 'fp-eq-src' }, t('math.source')), area, paletteEl(area), h('div', { class: 'fp-label' }, t('math.preview')), preview, status, layout, h('p', { class: 'fp-form__hint' }, t('math.keys'))),
    ],
    actions,
  })
  area.id = 'fp-eq-src'
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      apply()
      dlg.close('ok')
    }
  })
  refresh()
  area.setSelectionRange(area.value.length, area.value.length)
}

/** Ouvre l'éditeur sur la formule en `pos` de `view`. */
export function editMathAt(app: FolioApp, view: EditorView, pos: number): void {
  const node = view.state.doc.nodeAt(pos)
  if (!node || (node.type !== schema.nodes.math && node.type !== schema.nodes.equation)) return
  equationDialog(app, { view, pos, tex: node.attrs.tex as string, display: node.type === schema.nodes.equation, numbered: !!node.attrs.numbered })
}

/** Nouvelle formule : le texte sélectionné (s'il y en a) en devient la source. */
export function newEquation(app: FolioApp, display: boolean, numbered = false): void {
  const view = app.alt ?? app.view
  const s = view.state
  const selected = s.selection.empty ? '' : s.doc.textBetween(s.selection.from, s.selection.to, ' ', ' ').slice(0, 20_000)
  equationDialog(app, { view, pos: null, tex: selected.replace(/^\$+|\$+$/g, '').trim(), display, numbered })
}

/** Convertit les $…$ du texte sélectionné (ou de tout le document) en formules. */
export function convertTex(app: FolioApp): void {
  const all = app.state.selection.empty
  let count = 0
  const ok = app.run(convertTexText(all, (n) => (count = n)))
  toast(ok ? t('math.converted', { n: count }) : t('math.noneFound'), { kind: ok ? 'success' : 'info' })
}

/** Macros communes à toutes les formules du document. */
export function macrosDialog(app: FolioApp): void {
  const current = ((app.state.doc.attrs.math as { macros?: string } | undefined)?.macros ?? '') as string
  const area = h('textarea', { class: 'fp-input fp-eq__source', rows: '8', spellcheck: 'false', 'data-field': 'macros' }) as HTMLTextAreaElement
  area.value = current
  const error = h('p', { class: 'fp-field-error', role: 'alert' })
  openDialog({
    name: 'math-macros',
    title: t('math.macros.title'),
    wide: true,
    focus: area,
    body: [h('p', { class: 'fp-form__hint' }, t('math.macros.help')), area, error],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t('action.ok'),
        value: 'ok',
        primary: true,
        run: () => {
          const macros = area.value.slice(0, 50_000)
          // Des macros qui cassent toute formule : on le dit avant d'enregistrer.
          const probe = renderTex('x', false, { macros })
          if (!probe.html && probe.error?.kind === 'syntax') {
            error.textContent = t('math.macros.bad', { message: probe.error.message })
            return false
          }
          if (macros !== current) {
            app.run((state, dispatch) => {
              if (dispatch) dispatch(state.tr.setDocAttribute('math', { macros }))
              return true
            })
          }
          return true
        },
      },
    ],
  })
}
