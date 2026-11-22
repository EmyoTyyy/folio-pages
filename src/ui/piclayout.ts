// Disposition d'images : choisir la disposition (grille, bandeau, mise en
// avant, étapes, liste, mosaïque), les images (ajouter, remplacer, déplacer,
// retirer, ou les faire glisser dans la fenêtre), leurs légendes et textes, un
// titre et des couleurs, avec un aperçu. Depuis des images sélectionnées, elles
// deviennent la disposition (une étape annulable).

import { NodeSelection } from 'prosemirror-state'
import type { FolioApp } from '../app'
import { prepareFile } from '../editor/images'
import { figuresInSelection, figuresToPictures, insertPictures, itemOfFigure, picturesAt, picturesSvg, updatePictures, type PicItem, type PicturesAttrs } from '../editor/pictures'
import { DIAGRAM_COLORS } from '../format/diagram'
import { PICTURE_LAYOUTS, PICTURES_LIMITS, type PictureLayout } from '../format/pictures'
import type { PicturesBlock, Theme } from '../format/types'
import type { Key } from '../i18n/dict'
import { t } from '../i18n/i18n'
import { settings } from '../settings'
import { openDialog, toast } from './dialog'
import { h, icon } from './dom'
import { RIBBON_ICONS as I } from './icons'
import { popItem } from './popover'

const empty = (): PicItem => ({ src: '', assetId: null, caption: '', text: '' })

/** Choisir des fichiers image (plusieurs à la fois). */
function pickImages(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const el = h('input', { type: 'file', accept: 'image/*', class: 'fp-offscreen', 'data-folio-transient': '', ...(multiple ? { multiple: '' } : {}) }) as HTMLInputElement
    el.addEventListener('change', () => {
      resolve(Array.from(el.files ?? []))
      el.remove()
    })
    el.addEventListener('cancel', () => {
      resolve([])
      el.remove()
    })
    document.body.append(el)
    el.click()
  })
}

/** Des fichiers → des images prêtes (réduites comme à l'insertion) ; les illisibles sont signalées. */
async function prepare(files: File[]): Promise<string[]> {
  const out: string[] = []
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue
    try {
      out.push((await prepareFile(f, settings().reduceImages)).src)
    } catch (e) {
      const r = e instanceof Error ? e.message : String(e)
      toast(t(r === 'too-large' ? 'image.tooLarge' : 'image.unreadable'), { kind: 'error' })
    }
  }
  return out
}

/** Une petite disposition d'exemple (cadres vides) pour le choix de la disposition. */
const sample = (layout: PictureLayout, color: PicturesBlock['color'] | null): PicturesAttrs => ({
  layout,
  title: '',
  color,
  items: Array.from({ length: layout === 'list' || layout === 'process' ? 3 : 4 }, empty),
})

/**
 * La fenêtre de la disposition : nouvelle (`pos` absent), à modifier, ou faite des
 * images sélectionnées. `layout` : la disposition choisie d'avance.
 */
export function picturesDialog(app: FolioApp, pos?: number, layout?: PictureLayout): void {
  const current = pos !== undefined ? picturesAt(app.state) : null
  const figs = current ? [] : figuresInSelection(app.state)
  const d: PicturesAttrs = current
    ? structuredClone(current.attrs)
    : { layout: layout ?? 'grid', title: '', color: null, items: figs.map((f) => itemOfFigure(f.node)) }
  if (current && layout) d.layout = layout
  const theme = () => app.state.doc.attrs.theme as Theme
  const lang = () => app.state.doc.attrs.lang as string
  const svgEl = (a: PicturesAttrs) => {
    const tpl = document.createElement('template')
    tpl.innerHTML = picturesSvg(a, theme(), lang())
    return tpl.content.firstElementChild as Element
  }

  // --- choix de la disposition
  const kinds = h('div', { class: 'fp-dg-kinds', role: 'radiogroup', 'aria-label': t('pl.layout') })
  const drawKinds = () => {
    kinds.replaceChildren(
      ...PICTURE_LAYOUTS.map((k) => {
        const b = h(
          'button',
          { type: 'button', class: 'fp-dg-kind', role: 'radio', 'data-layout': k, 'aria-checked': String(d.layout === k), title: t(`pl.layout.${k}Hint` as Key) },
          h('span', { class: 'fp-dg-kind__img' }, svgEl(sample(k, d.color))),
          h('span', {}, t(`pl.layout.${k}` as Key)),
        )
        b.addEventListener('click', () => {
          d.layout = k
          for (const x of Array.from(kinds.children)) x.setAttribute('aria-checked', String((x as HTMLElement).dataset.layout === k))
          draw()
        })
        return b
      }),
    )
  }

  // --- aperçu
  const preview = h('div', { class: 'fp-dg-preview fp-pl-preview', 'data-pl-preview': '' })
  let pending = 0
  const draw = () => {
    cancelAnimationFrame(pending)
    pending = requestAnimationFrame(() => preview.replaceChildren(svgEl(d)))
  }

  // --- les images
  const list = h('div', { class: 'fp-pl-items', 'data-pl-items': '' })
  const addBtn = h('button', { type: 'button', class: 'fp-btn', 'data-action': 'pl-add' }, icon(I.image), h('span', {}, t('pl.add'))) as HTMLButtonElement
  const emptyBtn = h('button', { type: 'button', class: 'fp-btn', 'data-action': 'pl-add-empty' }, icon(I.plus), h('span', {}, t('pl.addEmpty'))) as HTMLButtonElement
  const room = () => PICTURES_LIMITS.items - d.items.length
  const full = () => {
    toast(t('pl.limit', { n: PICTURES_LIMITS.items }), { kind: 'info' })
  }
  const addSources = (srcs: string[]) => {
    if (srcs.length > room()) full()
    for (const src of srcs.slice(0, Math.max(0, room()))) d.items.push({ ...empty(), src })
    renderItems()
    draw()
  }
  const iconBtn = (label: string, svg: string, run: () => void, attrs: Record<string, string> = {}, disabled = false) => {
    const b = h('button', { type: 'button', class: 'fp-pl-item__btn', title: label, 'aria-label': label, ...attrs }, icon(svg)) as HTMLButtonElement
    b.disabled = disabled
    b.addEventListener('click', run)
    return b
  }
  const renderItems = () => {
    const focused = document.activeElement
    const keep = focused instanceof HTMLElement && list.contains(focused) ? { i: focused.closest<HTMLElement>('[data-pl-item]')?.dataset.plItem, field: focused.dataset.field } : null
    list.replaceChildren(
      ...(d.items.length
        ? d.items.map((it, i) => {
            const thumb = h(
              'button',
              { type: 'button', class: 'fp-pl-thumb', 'data-action': 'pl-pick', title: t(it.src ? 'pl.replace' : 'pl.choose'), 'aria-label': `${t('pl.number', { n: i + 1 })} : ${t(it.src ? 'pl.replace' : 'pl.choose')}` },
              it.src ? h('img', { src: it.src, alt: '' }) : icon(I.image),
            )
            thumb.addEventListener('click', async () => {
              const [src] = await prepare(await pickImages(false))
              if (!src) return
              it.src = src
              it.assetId = null
              renderItems()
              draw()
            })
            const caption = h('input', { type: 'text', class: 'fp-input', maxlength: String(PICTURES_LIMITS.caption), value: it.caption, placeholder: t('pl.caption'), 'aria-label': `${t('pl.number', { n: i + 1 })} : ${t('pl.caption')}`, 'data-field': 'pl-caption' }) as HTMLInputElement
            caption.addEventListener('input', () => {
              it.caption = caption.value
              draw()
            })
            const text = h('textarea', { class: 'fp-input', rows: '2', maxlength: String(PICTURES_LIMITS.text), placeholder: t('pl.text'), 'aria-label': `${t('pl.number', { n: i + 1 })} : ${t('pl.text')}`, 'data-field': 'pl-text' }) as HTMLTextAreaElement
            text.value = it.text
            text.addEventListener('input', () => {
              it.text = text.value
              draw()
            })
            const move = (to: number) => {
              const [x] = d.items.splice(i, 1)
              d.items.splice(to, 0, x)
              renderItems()
              draw()
              list.querySelector<HTMLElement>(`[data-pl-item="${to}"] [data-action="${to < i ? 'pl-up' : 'pl-down'}"]`)?.focus()
            }
            return h(
              'div',
              { class: 'fp-pl-item', 'data-pl-item': String(i) },
              thumb,
              h('div', { class: 'fp-pl-item__fields' }, caption, text),
              h(
                'div',
                { class: 'fp-pl-item__tools' },
                iconBtn(t('pl.up'), I.arrowUp, () => move(i - 1), { 'data-action': 'pl-up' }, i === 0),
                iconBtn(t('pl.down'), I.arrowDown, () => move(i + 1), { 'data-action': 'pl-down' }, i === d.items.length - 1),
                iconBtn(
                  t('pl.remove'),
                  I.close,
                  () => {
                    d.items.splice(i, 1)
                    renderItems()
                    draw()
                  },
                  { 'data-action': 'pl-remove' },
                ),
              ),
            )
          })
        : [h('p', { class: 'fp-pl-empty fp-muted' }, t('pl.empty'))]),
    )
    addBtn.disabled = emptyBtn.disabled = room() <= 0
    if (keep?.i !== undefined && keep.field) list.querySelector<HTMLElement>(`[data-pl-item="${keep.i}"] [data-field="${keep.field}"]`)?.focus()
  }
  addBtn.addEventListener('click', async () => addSources(await prepare(await pickImages(true))))
  emptyBtn.addEventListener('click', () => {
    if (room() <= 0) return full()
    d.items.push(empty())
    renderItems()
    draw()
    list.querySelector<HTMLElement>(`[data-pl-item="${d.items.length - 1}"] [data-field="pl-caption"]`)?.focus()
  })
  // Des images glissées dans la fenêtre s'ajoutent.
  const drop = h('div', { class: 'fp-pl-drop', 'data-pl-drop': '' }, list, h('div', { class: 'fp-pl-adds' }, addBtn, emptyBtn), h('p', { class: 'fp-form__hint' }, t('pl.dropHint')))
  drop.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    drop.classList.add('is-over')
  })
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'))
  drop.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files.length) return
    e.preventDefault()
    drop.classList.remove('is-over')
    addSources(await prepare(Array.from(e.dataTransfer.files)))
  })

  // --- titre, couleurs
  const title = h('input', { type: 'text', class: 'fp-input', maxlength: String(PICTURES_LIMITS.caption), value: d.title, 'data-field': 'pl-title', 'aria-label': t('dg.title') }) as HTMLInputElement
  title.addEventListener('input', () => {
    d.title = title.value.replace(/\s+/g, ' ')
    draw()
  })
  const color = h('select', { class: 'fp-input', 'data-field': 'pl-color', 'aria-label': t('dg.colors') }) as HTMLSelectElement
  for (const c of DIAGRAM_COLORS) color.append(h('option', { value: c, selected: (d.color ?? 'colorful') === c }, t(c === 'colorful' ? 'dg.colorful' : 'dg.oneColor', { n: c.slice(6) })))
  color.addEventListener('change', () => {
    d.color = color.value === 'colorful' ? null : (color.value as PicturesBlock['color'])
    drawKinds()
    draw()
  })

  const row = (label: string, control: HTMLElement) => h('label', { class: 'fp-form__row' }, h('span', { class: 'fp-label' }, label), control)
  drawKinds()
  renderItems()
  preview.replaceChildren(svgEl(d))
  const fromSelection = !current && figs.length > 0
  openDialog({
    name: 'pictures',
    title: t(current ? 'pl.editTitle' : 'pl.newTitle'),
    wide: true,
    focus: d.items.length ? (list.querySelector<HTMLElement>('[data-field="pl-caption"]') ?? addBtn) : addBtn,
    body: [
      kinds,
      h(
        'div',
        { class: 'fp-dg-layout fp-pl-layout' },
        h('div', { class: 'fp-dg-fields' }, h('span', { class: 'fp-label' }, t('pl.pictures')), drop),
        // L'aperçu, puis le titre et les couleurs (sous les yeux, sans faire défiler la fenêtre).
        h('div', { class: 'fp-pl-side' }, preview, row(t('dg.title'), title), row(t('dg.colors'), color)),
      ),
      fromSelection ? h('p', { class: 'fp-form__hint' }, t('pl.fromSelection')) : null,
    ].filter(Boolean) as HTMLElement[],
    actions: [
      { label: t('action.cancel'), value: 'cancel' },
      {
        label: t(current ? 'action.ok' : 'action.insert'),
        value: 'ok',
        primary: true,
        run: () => {
          const items = d.items.filter((it) => it.src || it.caption.trim() || it.text.trim())
          if (!items.length) {
            toast(t('pl.needOne'), { kind: 'info' })
            addBtn.focus()
            return false
          }
          const attrs: PicturesAttrs = { ...d, title: d.title.trim(), items }
          if (current) app.run(updatePictures(current.pos, attrs))
          else if (fromSelection) app.run(figuresToPictures(attrs))
          else app.run(insertPictures(attrs))
          return true
        },
      },
    ],
  })
}

/** Modifier la disposition à cette position (double-clic, Entrée, menu contextuel). */
export function editPicturesAt(app: FolioApp, pos: number): void {
  if (picturesAt(app.state)?.pos !== pos) {
    const node = app.state.doc.nodeAt(pos)
    if (!node || node.type.name !== 'pictures') return
    app.view.dispatch(app.state.tr.setSelection(NodeSelection.create(app.state.doc, pos)))
  }
  picturesDialog(app, pos)
}

/**
 * Format de l'image → Disposition de l'image → une disposition : les images
 * sélectionnées la prennent tout de suite (une étape annulable) ; une disposition
 * sélectionnée en change ; sinon, la fenêtre s'ouvre avec cette disposition.
 */
export function applyPictureLayout(app: FolioApp, layout: PictureLayout): void {
  const cur = picturesAt(app.state)
  if (cur) {
    app.run(updatePictures(cur.pos, { ...cur.attrs, layout }))
    return
  }
  if (figuresInSelection(app.state).length) {
    app.run(figuresToPictures({ layout }))
    return
  }
  picturesDialog(app, undefined, layout)
}

/** Format de l'image → Disposition de l'image : les dispositions (dessins d'exemple), puis « Plus d'options… ». */
export function layoutMenu(app: FolioApp): HTMLElement {
  const cur = picturesAt(app.state)?.attrs.layout
  const items = PICTURE_LAYOUTS.map((k) => {
    const b = popItem(h('span', { class: 'fp-pl-menu__img' }, layoutSample(app, k)), () => applyPictureLayout(app, k), { 'data-pl-layout': k, title: t(`pl.layout.${k}Hint` as Key), 'aria-label': t(`pl.layout.${k}` as Key) })
    b.classList.add('fp-pl-menu__item')
    if (cur === k) b.classList.add('is-active')
    b.append(h('span', { class: 'fp-pl-menu__label' }, t(`pl.layout.${k}` as Key)))
    return b
  })
  return h(
    'div',
    { class: 'fp-pop__list' },
    h('div', { class: 'fp-pl-menu', role: 'menu', 'aria-label': t('rb.pictureLayout') }, ...items),
    popItem(t('pl.more'), () => (picturesAt(app.state) ? editPicturesAt(app, picturesAt(app.state)!.pos) : picturesDialog(app)), { 'data-pl-layout': 'more' }),
  )
}

/** Le dessin d'exemple d'une disposition (menu du ruban). */
export function layoutSample(app: FolioApp, layout: PictureLayout): Element {
  const tpl = document.createElement('template')
  tpl.innerHTML = picturesSvg(sample(layout, null), app.state.doc.attrs.theme as Theme, app.state.doc.attrs.lang as string)
  return tpl.content.firstElementChild as Element
}
