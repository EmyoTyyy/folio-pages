// Onglet Dessin : crayon, couleurs et épaisseur, trait droit (Maj), gomme
// partielle, lasso (déplacer, supprimer, convertir), encre en forme, rejouer,
// formes et images depuis l'onglet.

import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { blocks, editor, makeFile, openEditor, rb, tab, watchErrors } from './helpers'

const LINE = 'Un paragraphe assez long pour dessiner dessus sans gêne, avec de la place tout autour. '
const doc = (b: unknown[]) => ({ format: 'folio/doc', version: 1, meta: { title: 'Dessin', lang: 'fr' }, blocks: b })
const pop = (page: Page) => page.locator('[data-popover]')
const shapes = (page: Page) =>
  page.evaluate(() => {
    const out: any[] = []
    for (const b of (window as any).folio.doc.blocks) for (const x of b.content ?? []) if (x.type === 'shape') out.push(x)
    return out
  })
const inkOf = async (page: Page) => (await blocks(page)).flatMap((b: any) => b.ink ?? [])

async function open(page: Page, info: TestInfo) {
  await openEditor(page, makeFile(info, 'dessin.html', doc([LINE.repeat(3), LINE.repeat(3), LINE.repeat(3), 'Fin.'])).url)
  await tab(page, 'draw')
}
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
  })
})

/** Un tracé à la souris passant par des points (px de l'écran), Maj tenue si demandé. */
async function trace(page: Page, pts: [number, number][], shift = false) {
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.move(pts[0][0], pts[0][1])
  await page.mouse.down()
  for (let i = 1; i < pts.length; i++) await page.mouse.move(pts[i][0], pts[i][1], { steps: 8 })
  await page.mouse.up()
  if (shift) await page.keyboard.up('Shift')
}
/** Le coin haut gauche du n-ième paragraphe. */
const para = async (page: Page, i = 1) => (await editor(page).locator('p').nth(i).boundingBox())!

test('crayon : couleur, épaisseur au curseur, grain ; Maj trace un trait droit', async ({ page }, info) => {
  const errors = watchErrors(page)
  await open(page, info)
  await rb(page, 'ink-pencil-menu')
  await pop(page).locator('[data-ink-color="#78350f"]').click()
  await expect(page.locator('[data-ink-layer]')).toBeVisible()
  await expect(page.locator('.fp-ribbon [data-cmd="ink-pencil"]')).toHaveAttribute('aria-pressed', 'true')
  await rb(page, 'ink-pencil-menu')
  await pop(page).locator('[data-ink-width="pencil"]').fill('3')
  await page.keyboard.press('Escape')
  const p = await para(page)
  await trace(page, [[p.x + 20, p.y + 20], [p.x + 80, p.y + 40], [p.x + 160, p.y + 18]])
  let ink = await inkOf(page)
  expect(ink).toHaveLength(1)
  expect(ink[0]).toMatchObject({ tool: 'pencil', color: '#78350f', width: 3 })
  await expect(editor(page).locator('svg.fp-ink path')).toHaveAttribute('filter', 'url(#fp-pencil-grain)')
  // Maj : un zigzag devient un trait droit (deux points).
  await trace(page, [[p.x + 20, p.y + 60], [p.x + 70, p.y + 90], [p.x + 120, p.y + 50], [p.x + 200, p.y + 70]], true)
  ink = await inkOf(page)
  expect(ink).toHaveLength(2)
  expect(ink[1].points).toHaveLength(4)
  // Les réglages restent pour la prochaine ouverture.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('folio-pages:ink')!).color.pencil)).toBe('#78350f')
  errors.check()
})

test('gomme partielle : coupe un trait en deux ; un passage, une annulation', async ({ page }, info) => {
  const errors = watchErrors(page)
  await open(page, info)
  await rb(page, 'ink-pen')
  const p = await para(page)
  await trace(page, [[p.x + 20, p.y + 30], [p.x + 320, p.y + 30]])
  expect(await inkOf(page)).toHaveLength(1)
  await rb(page, 'ink-eraser-menu')
  await pop(page).locator('[data-eraser="point"]').click()
  await expect(page.locator('.fp-ribbon [data-cmd="ink-eraser"]')).toHaveAttribute('aria-pressed', 'true')
  await trace(page, [[p.x + 170, p.y + 5], [p.x + 170, p.y + 30], [p.x + 172, p.y + 55]])
  const ink = await inkOf(page)
  expect(ink).toHaveLength(2)
  expect(Math.max(...ink[0].points.filter((_: number, i: number) => i % 2 === 0))).toBeLessThan(Math.min(...ink[1].points.filter((_: number, i: number) => i % 2 === 0)))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+z')
  expect(await inkOf(page)).toHaveLength(1)
  errors.check()
})

test('lasso : prendre des traits, les déplacer, les supprimer, les convertir en formes', async ({ page }, info) => {
  const errors = watchErrors(page)
  await open(page, info)
  await rb(page, 'ink-pen')
  const p = await para(page)
  // Un trait en haut, et un rectangle à main levée plus bas.
  await trace(page, [[p.x + 20, p.y + 15], [p.x + 220, p.y + 20]])
  const [rx, ry] = [p.x + 40, p.y + 60]
  await trace(page, [[rx, ry], [rx + 160, ry + 1], [rx + 161, ry + 80], [rx + 1, ry + 81], [rx, ry + 2]])
  expect(await inkOf(page)).toHaveLength(2)
  await expect(page.locator('.fp-ribbon [data-cmd="ink-delete-selection"]')).toBeDisabled()
  // Le lasso autour du premier trait seulement.
  await rb(page, 'ink-lasso')
  await trace(page, [[p.x + 5, p.y + 3], [p.x + 240, p.y + 3], [p.x + 240, p.y + 35], [p.x + 5, p.y + 35], [p.x + 5, p.y + 4]])
  await expect(page.locator('[data-ink-selection="1"]')).toBeVisible()
  await expect(page.locator('.fp-ribbon [data-cmd="ink-delete-selection"]')).toBeEnabled()
  // Glisser dans le cadre : le trait se déplace.
  const before = (await inkOf(page))[0].points[0]
  const frame = (await page.locator('.fp-ink-sel__box').boundingBox())!
  await trace(page, [[frame.x + frame.width / 2, frame.y + frame.height / 2], [frame.x + frame.width / 2 + 60, frame.y + frame.height / 2]])
  await expect.poll(async () => (await inkOf(page))[0].points[0]).toBeGreaterThan(before + 20)
  await expect(page.locator('[data-ink-selection="1"]')).toBeVisible()
  // Suppr : supprimé.
  await page.keyboard.press('Delete')
  expect(await inkOf(page)).toHaveLength(1)
  await expect(page.locator('[data-ink-selection]')).toHaveCount(0)
  // Le rectangle au lasso, puis Convertir en formes : une vraie forme, sans remplissage, de la couleur du trait.
  await trace(page, [[rx - 25, ry - 20], [rx + 190, ry - 20], [rx + 190, ry + 105], [rx - 25, ry + 105], [rx - 25, ry - 19]])
  await expect(page.locator('[data-ink-selection="1"]')).toBeVisible()
  await rb(page, 'ink-convert-selection')
  expect(await inkOf(page)).toHaveLength(0)
  const [s] = await shapes(page)
  expect(s).toMatchObject({ shape: 'rect', fill: 'none', line: '#1f2937', lineWidth: 2 })
  expect(s.width).toBeGreaterThan(100)
  expect(s.height).toBeGreaterThan(45)
  await expect(editor(page).locator('.fp-shape__box')).toHaveCount(1)
  // Une seule étape d'annulation : le trait revient, la forme part.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+z')
  expect(await shapes(page)).toHaveLength(0)
  expect(await inkOf(page)).toHaveLength(1)
  errors.check()
})

test('encre en forme : un rectangle, une ellipse, une flèche deviennent des formes ; un gribouillis reste un trait', async ({ page }, info) => {
  const errors = watchErrors(page)
  await open(page, info)
  await rb(page, 'ink-to-shape')
  await expect(page.locator('.fp-ribbon [data-cmd="ink-to-shape"]')).toHaveAttribute('aria-pressed', 'true')
  // Le stylo est pris tout seul.
  await expect(page.locator('[data-ink-layer]')).toBeVisible()
  const p = await para(page)
  const [x, y] = [p.x + 30, p.y + 15]
  await trace(page, [[x, y], [x + 150, y], [x + 151, y + 70], [x, y + 71], [x + 1, y + 1]])
  // Une ellipse.
  const ell: [number, number][] = []
  for (let a = 0; a <= 24; a++) ell.push([x + 320 + Math.cos((a / 24) * Math.PI * 2) * 70, y + 40 + Math.sin((a / 24) * Math.PI * 2) * 35])
  await trace(page, ell)
  // Une flèche d'un geste : la hampe, puis la pointe.
  await trace(page, [[x, y + 130], [x + 200, y + 130], [x + 186, y + 120], [x + 200, y + 130], [x + 186, y + 140]])
  // Un gribouillis.
  await trace(page, [[x, y + 180], [x + 30, y + 210], [x + 60, y + 175], [x + 90, y + 215], [x + 120, y + 180]])
  const list = await shapes(page)
  expect(new Set(list.map((s) => s.shape))).toEqual(new Set(['rect', 'ellipse', 'line']))
  expect(list.find((s) => s.shape === 'line')).toMatchObject({ tail: 'triangle', height: 0 })
  expect(list.find((s) => s.shape === 'ellipse').width).toBeGreaterThan(90)
  expect(await inkOf(page)).toHaveLength(1)
  await expect(editor(page).locator('.fp-shape__box')).toHaveCount(3)
  // Le réglage se retire.
  await rb(page, 'ink-to-shape')
  await expect(page.locator('.fp-ribbon [data-cmd="ink-to-shape"]')).toHaveAttribute('aria-pressed', 'false')
  errors.check()
})

test('rejouer le dessin ; Échap arrête', async ({ page }, info) => {
  const errors = watchErrors(page)
  await open(page, info)
  await rb(page, 'ink-replay')
  await expect(page.locator('.fp-toast', { hasText: 'Aucun dessin' })).toBeVisible()
  await rb(page, 'ink-pen')
  const p = await para(page)
  await trace(page, [[p.x + 20, p.y + 20], [p.x + 200, p.y + 30]])
  await trace(page, [[p.x + 20, p.y + 50], [p.x + 200, p.y + 60]])
  await rb(page, 'ink-replay')
  await expect(page.locator('[data-ink-replay] path')).toHaveCount(2)
  await expect(editor(page).locator('svg.fp-ink').first()).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-ink-replay]')).toHaveCount(0)
  await expect(editor(page).locator('svg.fp-ink').first()).toBeVisible()
  // Rien n'a changé dans le document.
  expect(await inkOf(page)).toHaveLength(2)
  errors.check()
})

test('formes, zone de texte et image libre depuis l’onglet Dessin', async ({ page }, info) => {
  const errors = watchErrors(page)
  await open(page, info)
  await rb(page, 'ink-pen')
  await rb(page, 'ink-shapes')
  await pop(page).locator('[data-shape-entry="ellipse"]').click()
  // Le stylo est rangé : on dessine la forme.
  await expect(page.locator('[data-ink-layer]')).toHaveCount(0)
  const p = await para(page)
  await page.mouse.move(p.x + 40, p.y + 10)
  await page.mouse.down()
  await page.mouse.move(p.x + 160, p.y + 80, { steps: 5 })
  await page.mouse.up()
  expect((await shapes(page)).map((s) => s.shape)).toEqual(['ellipse'])
  await tab(page, 'draw')
  await rb(page, 'ink-textbox')
  await expect(pop(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.fp-ribbon [data-cmd="ink-picture"]')).toBeEnabled()
  errors.check()
})
