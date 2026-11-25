// Formes et zones de texte : dessiner, écrire dedans, déplacer, redimensionner,
// faire pivoter, habillage, position, ordre de superposition, volet Sélection,
// grouper, aligner, menu contextuel, enregistrer et rouvrir, .docx.

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { docOfFile, editor, makeFile, makePng, mod, openEditor, pngDataUri, rb, removeFsAccess, saveByDownload, tab, watchErrors } from './helpers'

const LOREM = 'Les formes se placent n’importe où sur la page, le texte passe autour. '
const DOC = (blocks: unknown[] = [LOREM.repeat(5), LOREM.repeat(5), LOREM.repeat(5)]) => ({ format: 'folio/doc', version: 1, meta: { title: 'Formes', lang: 'fr' }, blocks })
const shapes = (page: Page) =>
  page.evaluate(() => {
    const out: any[] = []
    const walk = (bs: any[]) => bs.forEach((b) => (b.content ?? []).forEach((x: any) => x.type === 'shape' && out.push(x)))
    walk((window as any).folio.doc.blocks)
    return out
  })
const box = (page: Page, i = 0) => editor(page).locator('.fp-shape__box').nth(i)
const pop = (page: Page) => page.locator('[data-popover]')

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
  })
})

/** Insertion → Formes → une forme, dessinée par un glissé sur le 2e paragraphe. */
async function draw(page: Page, entry: string, dx = 140, dy = 90, from = { x: 60, y: 10 }) {
  await tab(page, 'insert')
  await rb(page, 'insert-shapes')
  await pop(page).locator(`[data-shape-entry="${entry}"]`).click()
  const p = (await editor(page).locator('p').nth(1).boundingBox())!
  await page.mouse.move(p.x + from.x, p.y + from.y)
  await page.mouse.down()
  await page.mouse.move(p.x + from.x + dx / 2, p.y + from.y + dy / 2, { steps: 3 })
  await page.mouse.move(p.x + from.x + dx, p.y + from.y + dy, { steps: 3 })
  await page.mouse.up()
}

test('dessiner une forme, écrire dedans, la déplacer, la redimensionner, la faire pivoter ; Ctrl+Z', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'f.html', DOC()).url)
  await draw(page, 'roundRect')
  await expect(box(page)).toBeVisible()
  await expect(page.locator('.fp-ribbon__tab[data-tab="shape"]')).toBeVisible()
  let [s] = await shapes(page)
  expect(s).toMatchObject({ shape: 'roundRect', wrap: 'front', fill: 'accent1' })
  expect(s.width).toBeGreaterThan(95)
  expect(s.width).toBeLessThan(115)
  // Une lettre : on écrit dans la forme ; Échap revient à la forme.
  await page.keyboard.type('Bonjour')
  await expect(box(page).locator('.fp-hf')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await shapes(page))[0].blocks?.[0]?.content?.[0]?.text).toBe('Bonjour')
  await expect(box(page)).toContainText('Bonjour')
  // Glisser : la forme se déplace (en points : 3/4 des pixels à 100 %).
  ;[s] = await shapes(page)
  const b = (await box(page).boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 4, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => Math.round((await shapes(page))[0].x - s.x)).toBe(45)
  // La poignée de droite : plus large.
  const w0 = (await shapes(page))[0].width
  const e = (await box(page).locator('[data-h="e"]').boundingBox())!
  await page.mouse.move(e.x + 4, e.y + 4)
  await page.mouse.down()
  await page.mouse.move(e.x + 44, e.y + 4, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => Math.round((await shapes(page))[0].width - w0)).toBe(30)
  // La poignée du haut : la rotation (Maj : par 15°).
  const r = (await box(page).locator('[data-h="rot"]').boundingBox())!
  const c = (await box(page).boundingBox())!
  await page.mouse.move(r.x + 5, r.y + 5)
  await page.mouse.down()
  await page.keyboard.down('Shift')
  await page.mouse.move(c.x + c.width + 120, c.y + c.height / 2, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect.poll(async () => (await shapes(page))[0].rotate).toBe(90)
  // Les flèches déplacent la forme (Maj : 10 pt).
  const x0 = (await shapes(page))[0].x
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => Math.round((await shapes(page))[0].x - x0)).toBe(11)
  // Annuler jusqu'au début : plus de forme.
  for (let i = 0; i < 8; i++) await page.keyboard.press(`${mod}+z`)
  await expect.poll(async () => (await shapes(page)).length).toBe(0)
  errors.check()
})

test('zone de texte : texte riche ; habillage carré (le texte s’écarte), position, dans la ligne', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'f.html', DOC()).url)
  await editor(page).locator('p').nth(1).click()
  await tab(page, 'insert')
  await rb(page, 'insert-textbox')
  await pop(page).locator('[data-textbox="simple"]').click()
  await expect(box(page).locator('.fp-hf')).toBeFocused()
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type('Titre')
  await page.keyboard.press(`${mod}+b`)
  await page.keyboard.type(' gras')
  // Cliquer ailleurs ferme la zone : le texte est dans le document.
  await editor(page).locator('p').first().click()
  await expect.poll(async () => JSON.stringify((await shapes(page))[0].blocks)).toContain('"bold":true')
  let [s] = await shapes(page)
  expect(s).toMatchObject({ shape: 'textBox', wrap: 'square' })
  // Le texte du paragraphe passe à côté : une zone d'habillage flotte avant lui.
  await expect(editor(page).locator('.fp-shape-wrap')).toHaveCount(1)
  // Position : en haut à gauche de la page, texte autour.
  await box(page).click()
  await tab(page, 'shape')
  await rb(page, 'shape-position')
  await pop(page).locator('[data-position="tl"]').click()
  await expect.poll(async () => (await shapes(page))[0].x).toBe(0)
  const sb = (await box(page).boundingBox())!
  const first = (await editor(page).locator('p').first().boundingBox())!
  expect(Math.abs(sb.y - first.y)).toBeLessThan(6)
  // Habillage : dans la ligne (un grand caractère), puis derrière le texte.
  await rb(page, 'shape-wrap')
  await pop(page).locator('[data-shape-wrap="inline"]').click()
  await expect(editor(page).locator('.fp-shape[data-wrap="inline"]')).toHaveCount(1)
  await expect(editor(page).locator('.fp-shape-wrap')).toHaveCount(0)
  await rb(page, 'shape-wrap')
  await pop(page).locator('[data-shape-wrap="behind"]').click()
  ;[s] = await shapes(page)
  expect(s.wrap).toBe('behind')
  errors.check()
})

test('ordre de superposition, volet Sélection (renommer, masquer, réordonner), grouper, aligner, dissocier', async ({ page }, info) => {
  const errors = watchErrors(page)
  const doc = DOC([
    { content: [{ type: 'shape', shape: 'rect', id: 'r', x: 10, y: 0, width: 80, height: 60, name: 'Rouge', fill: '#cc3333' }, { type: 'shape', shape: 'ellipse', id: 'b', x: 50, y: 20, width: 80, height: 60, name: 'Bleu', fill: '#3355cc' }, { type: 'shape', shape: 'triangle', id: 't', x: 200, y: 40, width: 60, height: 60, name: 'Vert', fill: '#33aa55' }, LOREM] },
    LOREM.repeat(3),
  ])
  await openEditor(page, makeFile(info, 'f.html', doc).url)
  const sel = async (id: string, add = false) => {
    await editor(page).locator(`.fp-shape:has(.fp-shape__box) >> nth=${['r', 'b', 't'].indexOf(id)}`).locator('.fp-shape__box').click({ modifiers: add ? ['Shift'] : [], position: { x: 6, y: 6 } })
  }
  const order = async () => {
    const all = await shapes(page)
    return all.sort((a, b) => (a.z ?? 0) - (b.z ?? 0)).map((s) => s.id)
  }
  await sel('r')
  await tab(page, 'shape')
  await page.locator('.fp-ribbon [data-cmd="shape-forward"]').first().click()
  expect(await order()).toEqual(['b', 'r', 't'])
  await rb(page, 'shape-forward-menu')
  await pop(page).locator('[data-stack="front"]').click()
  expect(await order()).toEqual(['b', 't', 'r'])
  // Volet Sélection : du premier plan à l'arrière-plan.
  await rb(page, 'shape-selection-pane')
  const pane = page.locator('#fp-selpane')
  await expect(pane.locator('.fp-selpane__name')).toHaveText(['Rouge', 'Vert', 'Bleu'])
  await expect(pane.locator('.fp-selpane__item.is-selected')).toHaveText('Rouge')
  // Renommer (double-clic) ; masquer (l'œil) ; un clic sélectionne.
  await pane.locator('.fp-selpane__item', { hasText: 'Vert' }).dblclick()
  await pane.locator('[data-pane="rename"]').fill('Triangle vert')
  await pane.locator('[data-pane="rename"]').press('Enter')
  await expect.poll(async () => (await shapes(page)).find((s) => s.id === 't')?.name).toBe('Triangle vert')
  await pane.locator('.fp-selpane__item', { hasText: 'Bleu' }).locator('[data-pane="eye"]').click()
  await expect.poll(async () => (await shapes(page)).find((s) => s.id === 'b')?.hidden).toBe(true)
  await expect(editor(page).locator('.fp-shape[hidden]')).toHaveCount(1)
  await pane.locator('[data-pane="show-all"]').click()
  await expect(editor(page).locator('.fp-shape[hidden]')).toHaveCount(0)
  // Deux formes (Maj+clic) : aligner à gauche, puis grouper.
  await pane.locator('.fp-selpane__item', { hasText: 'Rouge' }).click()
  await pane.locator('.fp-selpane__item', { hasText: 'Triangle vert' }).click({ modifiers: ['Shift'] })
  await expect(pane.locator('.fp-selpane__item.is-selected')).toHaveCount(2)
  await rb(page, 'shape-align')
  await pop(page).locator('[data-align-shapes="left"]').click()
  await expect.poll(async () => (await shapes(page)).filter((s) => s.id !== 'b').map((s) => s.x)).toEqual([10, 10])
  await rb(page, 'shape-group')
  await pop(page).locator('[data-group="group"]').click()
  let all = await shapes(page)
  expect(all.map((s) => s.shape).sort()).toEqual(['ellipse', 'group'])
  const g = all.find((s) => s.shape === 'group')
  expect(g.children.map((c: any) => c.id).sort()).toEqual(['r', 't'])
  expect(g.x).toBe(10)
  // Dissocier : les deux formes reviennent à la même place.
  await rb(page, 'shape-group')
  await pop(page).locator('[data-group="ungroup"]').click()
  all = await shapes(page)
  expect(all.map((s) => [s.id, s.x]).sort()).toEqual([
    ['b', 50],
    ['r', 10],
    ['t', 10],
  ])
  errors.check()
})

test('un trait : ses bouts se déplacent ; contour, flèches, style ; menu contextuel', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'f.html', DOC()).url)
  await draw(page, 'lineArrow', 150, 0)
  let [s] = await shapes(page)
  expect(s).toMatchObject({ shape: 'line', tail: 'triangle', height: 0 })
  // Le bout de fin, plus bas : le trait penche.
  const end = (await box(page).locator('[data-h="b"]').boundingBox())!
  await page.mouse.move(end.x + 5, end.y + 5)
  await page.mouse.down()
  await page.mouse.move(end.x + 5, end.y + 65, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => Math.round((await shapes(page))[0].height)).toBe(45)
  // Contour : 3 pt, tirets ; flèche du début.
  await tab(page, 'shape')
  await rb(page, 'shape-outline')
  await pop(page).locator('[data-weight="3"]').click()
  await rb(page, 'shape-outline')
  await pop(page).locator('[data-dash="dash"]').click()
  await rb(page, 'shape-outline')
  await pop(page).locator('[data-head="oval"]').click()
  ;[s] = await shapes(page)
  expect(s).toMatchObject({ lineWidth: 3, dash: 'dash', head: 'oval', tail: 'triangle' })
  // Une forme : un style prêt ; clic droit : habillage, premier plan, texte de remplacement.
  await draw(page, 'ellipse', 80, 60, { x: 300, y: 30 })
  await tab(page, 'shape')
  await rb(page, 'shape-styles-more')
  await pop(page).locator('[data-shape-style="outline-accent2"]').click()
  const e = (await shapes(page)).find((x) => x.shape === 'ellipse')
  expect(e).toMatchObject({ fill: '#ffffff', line: 'accent2' })
  await box(page, 1).click({ button: 'right' })
  await expect(page.locator('[data-ctx="shape-wrap"]')).toBeVisible()
  await expect(page.locator('[data-ctx="shape-order"]')).toBeVisible()
  await page.locator('[data-ctx="shape-alt"]').click()
  await page.locator('[data-field="shape-alt"]').fill('Un rond')
  await page.locator('[data-dialog="shape-alt"] [data-action="ok"]').click()
  await expect.poll(async () => (await shapes(page)).find((x) => x.shape === 'ellipse')?.alt).toBe('Un rond')
  errors.check()
})

test('enregistré, relu ; export .docx rouvert : les formes reviennent', async ({ page }, info) => {
  const errors = watchErrors(page)
  await removeFsAccess(page)
  await page.addInitScript(() => delete (window as any).showOpenFilePicker)
  const doc = DOC([
    { content: [{ type: 'textbox', x: 280, y: 0, width: 180, height: 80, md: 'Une **zone**', wrap: 'square' }, { type: 'group', x: 0, y: 0, wrap: 'front', children: [{ type: 'shape', shape: 'flowChartDecision', x: 0, y: 0, width: 90, height: 50, text: 'Oui ?' }, { type: 'shape', shape: 'line', x: 90, y: 25, width: 40, height: 0, tail: 'triangle' }] }, LOREM.repeat(4)] },
  ])
  await openEditor(page, makeFile(info, 'f.html', doc).url)
  await expect(editor(page).locator('.fp-shape')).toHaveCount(2)
  const saved = await saveByDownload(page, info, 'formes.html')
  const json = docOfFile(saved.html)
  expect(json.blocks[0].content.filter((x: any) => x.type === 'shape').map((x: any) => x.shape)).toEqual(['textBox', 'group'])
  await page.goto(saved.url)
  await page.waitForFunction(() => !!(window as any).folio?.doc)
  await expect(editor(page).locator('.fp-shape')).toHaveCount(2)
  await expect(editor(page).locator('.fp-shape')).toContainText(['Une zone', 'Oui ?'])
  // .docx : de vraies formes ; rouvert dans l'application, elles reviennent.
  await page.locator('[data-menu="file"]').click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-menu-popup="file"] [data-item="export-docx"]').click()])
  const bytes = readFileSync((await download.path())!)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press(`${mod}+o`)])
  await chooser.setFiles({ name: 'formes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: bytes })
  await expect.poll(async () => (await shapes(page)).map((s) => s.shape)).toEqual(['textBox', 'group'])
  await expect(editor(page).locator('.fp-shape')).toContainText(['Une zone', 'Oui ?'])
  errors.check()
})

test('PDF direct : les formes dessinées, leur texte en vrai texte', async ({ page }, info) => {
  const errors = watchErrors(page)
  await removeFsAccess(page)
  const doc = DOC([{ content: [{ type: 'shape', shape: 'star5', x: 300, y: 0, width: 90, height: 90, fill: '#dd4422' }, { type: 'textbox', x: 0, y: 0, width: 200, height: 60, text: 'Texte dans la zone', wrap: 'square' }, { type: 'shape', shape: 'picture', src: pngDataUri(60, 40, [20, 90, 200]), x: 200, y: 120, width: 90, height: 60, wrap: 'front' }, LOREM.repeat(3)] }])
  await openEditor(page, makeFile(info, 'f.html', doc).url)
  await expect(editor(page).locator('.fp-shape')).toHaveCount(3)
  await page.locator('#fp-share').click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-share="pdf"]').click()])
  const path = info.outputPath('formes.pdf')
  await download.saveAs(path)
  const { execFileSync } = await import('node:child_process')
  const imgs = execFileSync('pdfimages', ['-list', path], { encoding: 'utf8' }).trim().split('\n').slice(2).filter((l) => l.trim().split(/\s+/)[2] === 'image')
  expect(imgs.length).toBeGreaterThanOrEqual(3)
  // L'image libre : à sa taille d'origine (60 × 40).
  expect(imgs.some((l) => /^\s*\d+\s+\d+\s+image\s+60\s+40\b/.test(l))).toBe(true)
  const text = execFileSync('pdftotext', [path, '-'], { encoding: 'utf8' })
  expect(text).toContain('Texte dans la zone')
  errors.check()
})

test('dessiner : la forme se voit pendant le glissé ; sur un tableau en fin de document, elle se raccroche au paragraphe voisin', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'f.html', DOC([LOREM.repeat(3), { type: 'table', rows: [['Article', 'Prix'], ['Papier', '12 €'], ['Encre', '30 €']] }])).url)
  await tab(page, 'insert')
  await rb(page, 'insert-shapes')
  await pop(page).locator('[data-shape-entry="star5"]').click()
  const t = (await editor(page).locator('table').boundingBox())!
  await page.mouse.move(t.x + 40, t.y + 8)
  await page.mouse.down()
  await page.mouse.move(t.x + 90, t.y + 40, { steps: 3 })
  await page.mouse.move(t.x + 140, t.y + 70, { steps: 3 })
  // L'aperçu : la vraie forme, à la taille du glissé.
  const ghost = page.locator('.fp-draw-ghost svg path').first()
  await expect(ghost).toBeAttached()
  const g = (await page.locator('.fp-draw-ghost').boundingBox())!
  expect(Math.round(g.width)).toBe(100)
  expect(Math.round(g.height)).toBe(62)
  await page.mouse.up()
  await expect(page.locator('.fp-draw-ghost')).toHaveCount(0)
  // La forme existe, là où on l'a dessinée (raccrochée au paragraphe d'avant le tableau).
  await expect.poll(async () => (await shapes(page)).length).toBe(1)
  const b = (await box(page).boundingBox())!
  expect(Math.abs(b.x - (t.x + 40))).toBeLessThan(3)
  expect(Math.abs(b.y - (t.y + 8))).toBeLessThan(3)
  expect(Math.round(b.width)).toBe(100)
  errors.check()
})

test('images libres : placer librement, déplacer, proportions gardées, retouches, remettre dans le texte ; insérer ; enregistrer, .docx', async ({ page }, info) => {
  const errors = watchErrors(page)
  await removeFsAccess(page)
  await page.addInitScript(() => delete (window as any).showOpenFilePicker)
  const png = pngDataUri(120, 80, [30, 120, 90])
  await openEditor(page, makeFile(info, 'f.html', DOC([LOREM.repeat(3), { type: 'image', src: png, alt: 'Paysage', width: 150, caption: 'Une légende' }, LOREM.repeat(3)])).url)
  // L'image du texte → libre, au même endroit ; sa légende reste dans le texte.
  const frame = editor(page).locator('.fp-figure__frame')
  const f0 = (await frame.boundingBox())!
  await frame.click()
  await tab(page, 'image')
  await rb(page, 'image-wrap')
  await page.locator('[data-popover] [data-wrap-option="free"]').click()
  await expect(editor(page).locator('figure')).toHaveCount(0)
  await expect(editor(page)).toContainText('Une légende')
  let [s] = await shapes(page)
  expect(s).toMatchObject({ shape: 'picture', alt: 'Paysage', wrap: 'topBottom', width: 150, height: 100 })
  const b0 = (await box(page).boundingBox())!
  expect(Math.abs(b0.x - f0.x)).toBeLessThan(2)
  expect(Math.abs(b0.y - f0.y)).toBeLessThan(2)
  await expect(box(page).locator('img')).toHaveAttribute('alt', 'Paysage')
  await expect(page.locator('.fp-ribbon__tab[data-tab="shape"]')).toBeVisible()
  // Glisser : elle se déplace ; un coin : la taille change, les proportions restent (Maj les libère).
  await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2)
  await page.mouse.down()
  await page.mouse.move(b0.x + b0.width / 2 + 80, b0.y + b0.height / 2 + 4, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => Math.round((await shapes(page))[0].x - s.x)).toBe(60)
  const se = (await box(page).locator('[data-h="se"]').boundingBox())!
  await page.mouse.move(se.x + 4, se.y + 4)
  await page.mouse.down()
  await page.mouse.move(se.x + 64, se.y + 10, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => (await shapes(page))[0].width).toBe(195)
  ;[s] = await shapes(page)
  expect(Math.round(s.height)).toBe(130)
  // Retouches : le groupe Image de l'onglet Format de la forme.
  await tab(page, 'shape')
  await expect(page.locator('.fp-rb-group[data-group="shape-picture"], .fp-ribbon [data-cmd="picture-back-in-text"]').first()).toBeVisible()
  await rb(page, 'picture-color')
  await page.locator('[data-popover] [data-recolor="grayscale"]').first().click()
  await expect.poll(async () => (await shapes(page))[0].adjust).toEqual({ recolor: 'grayscale' })
  await expect(box(page).locator('img')).toHaveCSS('filter', /grayscale/)
  // Enregistré : une forme « picture » dont l'image est dans les ressources.
  const saved = await saveByDownload(page, info, 'images-libres.html')
  const json = docOfFile(saved.html)
  const pic = json.blocks.flatMap((b: any) => b.content ?? []).find((x: any) => x.type === 'shape')
  expect(pic).toMatchObject({ shape: 'picture', alt: 'Paysage', adjust: { recolor: 'grayscale' } })
  expect(json.assets[pic.src.slice(6)]).toMatch(/^data:image\/png/)
  // Remettre dans le texte : une image ordinaire, avec sa taille et ses retouches ; Ctrl+Z la rend libre.
  await rb(page, 'picture-back-in-text')
  await expect(editor(page).locator('figure')).toHaveCount(1)
  expect(await shapes(page)).toEqual([])
  const img = await page.evaluate(() => (window as any).folio.doc.blocks.find((b: any) => b.type === 'image'))
  expect(img).toMatchObject({ alt: 'Paysage', width: 195, adjust: { recolor: 'grayscale' } })
  await page.keyboard.press(`${mod}+z`)
  await expect.poll(async () => (await shapes(page)).map((x) => [x.width, x.adjust])).toEqual([[195, { recolor: 'grayscale' }]])
  await expect(editor(page).locator('figure')).toHaveCount(0)
  // .docx : une vraie image ancrée ; rouverte, une image libre.
  await page.locator('[data-menu="file"]').click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-menu-popup="file"] [data-item="export-docx"]').click()])
  const bytes = readFileSync((await download.path())!)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press(`${mod}+o`)])
  await chooser.setFiles({ name: 'images.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: bytes })
  await expect.poll(async () => (await shapes(page)).map((x) => [x.shape, x.alt, Math.round(x.width)])).toEqual([['picture', 'Paysage', 195]])
  await expect(box(page).locator('img')).toBeVisible()
  // Insertion → Images → Image libre : posée au curseur, à sa taille naturelle (au plus la moitié de la colonne).
  await editor(page).locator('p').first().click()
  await tab(page, 'insert')
  await rb(page, 'insert-image-menu')
  const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-popover] [data-image="free"]').click()])
  await chooser2.setFiles({ name: 'carre.png', mimeType: 'image/png', buffer: makePng(80, 80, [200, 40, 40]) })
  await expect.poll(async () => (await shapes(page)).length).toBe(2)
  const added = (await shapes(page)).find((x) => x.width === 60)
  expect(added).toMatchObject({ shape: 'picture', width: 60, height: 60, wrap: 'square' })
  errors.check()
})

test('ruban : l’onglet courant est rattaché au panneau', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'f.html', DOC()).url)
  for (const id of ['home', 'insert']) {
    await tab(page, id)
    const cur = page.locator(`.fp-ribbon__tab[data-tab="${id}"]`)
    const t = (await cur.boundingBox())!
    const p = (await page.locator('.fp-ribbon__panel').boundingBox())!
    // Le bas de l'onglet touche le haut du panneau, sans bordure entre les deux.
    expect(Math.abs(t.y + t.height - p.y)).toBeLessThanOrEqual(1)
    await expect(cur).toHaveCSS('border-bottom-width', '0px')
    await expect(cur).toHaveCSS('background-color', await page.locator('.fp-ribbon__panel').evaluate((e) => getComputedStyle(e).backgroundColor))
  }
})

test('dessiner bas dans un long paragraphe : la page ne défile pas', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'f.html', DOC(['Début.', LOREM.repeat(40), 'Fin.'])).url)
  const canvas = page.locator('.fp-canvas')
  await canvas.evaluate((e) => (e.scrollTop = 700))
  await expect.poll(() => canvas.evaluate((e) => e.scrollTop)).toBeGreaterThan(400)
  const before = await canvas.evaluate((e) => e.scrollTop)
  await tab(page, 'insert')
  await rb(page, 'insert-shapes')
  await pop(page).locator('[data-shape-entry="star5"]').click()
  await page.mouse.move(500, 600)
  await page.mouse.down()
  await page.mouse.move(560, 650, { steps: 3 })
  await page.mouse.move(620, 700, { steps: 3 })
  await page.mouse.up()
  await expect.poll(async () => (await shapes(page)).length).toBe(1)
  await page.waitForTimeout(200)
  expect(await canvas.evaluate((e) => e.scrollTop)).toBe(before)
  // Elle est là où on l'a dessinée.
  const b = (await box(page).boundingBox())!
  expect(Math.abs(b.x - 500)).toBeLessThan(3)
  expect(Math.abs(b.y - 600)).toBeLessThan(3)
  errors.check()
})

test('galerie des formes : une seule barre de défilement, verticale, et jamais de défilement horizontal', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'galerie.html', { format: 'folio/doc', version: 1, blocks: ['Texte.'] }).url)
  for (const [id, cmd] of [['insert', 'insert-shapes'], ['draw', 'ink-shapes']]) {
    await tab(page, id)
    await page.locator(`.fp-ribbon [data-cmd="${cmd}"]`).first().click()
    const pop = page.locator('.fp-popover')
    await expect(pop.locator('.fp-shapes')).toBeVisible()
    const m = await pop.evaluate((el) => {
      const g = el.querySelector('.fp-shapes')!
      return { pop: [el.scrollWidth - el.clientWidth, el.scrollHeight - el.clientHeight], galH: g.scrollWidth - g.clientWidth, galV: g.scrollHeight > g.clientHeight }
    })
    expect(m.pop, cmd).toEqual([0, 0])
    expect(m.galH, cmd).toBe(0)
    expect(m.galV, cmd).toBe(true)
    await page.keyboard.press('Escape')
  }
  errors.check()
})
