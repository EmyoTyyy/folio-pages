// Le ruban tient dans la fenêtre : libellés courts (le complet en infobulle),
// grands boutons ramenés à leur plus longue ligne, groupes resserrés puis
// repliés quand la place manque, et ouverts sous leur bouton.

import { expect, test, type Page } from '@playwright/test'
import { makeFile, openEditor, rb, tab, watchErrors } from './helpers'

const TABS = ['home', 'insert', 'design', 'layout', 'references', 'mailings', 'review', 'draw', 'view', 'developer', 'ai', 'help']
const doc = { format: 'folio/doc', version: 1, meta: { title: 'Ruban', lang: 'fr' }, blocks: ['Un paragraphe.'] }

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
  })
})

/** Ce qui dépasse du ruban (px). */
const overflow = (page: Page) => page.$eval('#fp-ribbon-panel', (el) => el.scrollWidth - el.clientWidth)
const shrunk = (page: Page) => page.$$eval('.fp-rb-group', (gs) => gs.filter((g) => /is-(compact|folded)/.test(g.className)).map((g) => g.dataset.group))

for (const lang of ['fr', 'en'] as const) {
  test(`aucun onglet ne déborde, large ou étroit (${lang})`, async ({ page }, info) => {
    const errors = watchErrors(page)
    await page.addInitScript((l) => localStorage.setItem('folio-pages:lang', l), lang)
    await page.setViewportSize({ width: 1920, height: 900 })
    await openEditor(page, makeFile(info, 'r.html', doc).url)
    // Large : tout tient sans rien resserrer.
    for (const id of TABS) {
      await tab(page, id)
      expect(await overflow(page), id).toBeLessThanOrEqual(1)
      expect(await shrunk(page), id).toEqual([])
    }
    // Étroit : tout tient encore, en resserrant ou repliant des groupes.
    for (const w of [1280, 1024]) {
      await page.setViewportSize({ width: w, height: 800 })
      for (const id of TABS) {
        await tab(page, id)
        expect(await overflow(page), `${id} à ${w}`).toBeLessThanOrEqual(1)
      }
    }
    errors.check()
  })
}

test('libellés courts : le libellé complet reste dans l’infobulle et pour les lecteurs d’écran', async ({ page }, info) => {
  const errors = watchErrors(page)
  await page.setViewportSize({ width: 1920, height: 900 })
  await openEditor(page, makeFile(info, 'r.html', doc).url)
  await tab(page, 'references')
  const foot = page.locator('.fp-ribbon [data-cmd="insert-footnote"]')
  await expect(foot).toHaveText('Note de bas de page')
  await expect(foot).toHaveAttribute('aria-label', 'Insérer une note de bas de page')
  await expect(foot).toHaveAttribute('title', /^Insérer une note de bas de page/)
  await tab(page, 'mailings')
  await expect(page.locator('.fp-ribbon [data-cmd="mm-highlight"]')).toHaveText('Surligner les champs')
  // Un grand bouton sur deux lignes n'est pas plus large que sa plus longue ligne.
  const w = await page.$eval('.fp-ribbon [data-cmd="mm-send-doc"] .fp-rb-btn__label', (l) => l.getBoundingClientRect().width)
  expect(w).toBeLessThan(80)
  errors.check()
})

test('groupe replié : il s’ouvre sous son bouton, ses commandes marchent, Échap et un clic dehors le ferment', async ({ page }, info) => {
  const errors = watchErrors(page)
  await page.setViewportSize({ width: 980, height: 800 })
  await openEditor(page, makeFile(info, 'r.html', doc).url)
  await tab(page, 'view')
  const level = () => page.locator('#fp-zoom-label').textContent()
  const fold = page.locator('[data-fold="zoom"]')
  await expect(fold).toBeVisible()
  await expect(page.locator('[data-group="zoom"] > .fp-rb-group__body')).toBeHidden()
  await fold.click()
  const fly = page.locator('.fp-rb-flyout[data-flyout="zoom"]')
  await expect(fly).toBeVisible()
  await expect(fold).toHaveAttribute('aria-expanded', 'true')
  // Sous son bouton, avec les libellés.
  const [fb, yb] = [(await fold.boundingBox())!, (await fly.boundingBox())!]
  expect(yb.y).toBeGreaterThanOrEqual(fb.y + fb.height)
  await expect(fly.locator('[data-cmd="zoom-page"]')).toContainText('Une page')
  // Une commande : elle s'applique et le groupe se referme, ses contrôles reviennent dans le ruban.
  const before = await level()
  await fly.locator('[data-cmd="zoom-page"]').click()
  await expect(fly).toHaveCount(0)
  await expect.poll(level).not.toBe(before)
  await expect(page.locator('[data-group="zoom"] > .fp-rb-group__body')).toHaveCount(1)
  // Une case à cocher (groupe Afficher) : le groupe reste ouvert.
  await page.locator('[data-fold="show"]').click()
  const show = page.locator('.fp-rb-flyout[data-flyout="show"]')
  await show.locator('[data-cmd="view-nav"]').check()
  await expect(page.locator('#fp-nav')).toBeVisible()
  await expect(show).toBeVisible()
  // Échap ferme et rend le focus au bouton.
  await page.keyboard.press('Escape')
  await expect(show).toHaveCount(0)
  // Au clavier, le focus entre dans le groupe ; Échap le rend au bouton ; un clic dehors ferme aussi.
  await fold.focus()
  await page.keyboard.press('Enter')
  await expect(fly).toBeVisible()
  await expect(fly.locator('button:not(:disabled)').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(fly).toHaveCount(0)
  await expect(fold).toBeFocused()
  await fold.click()
  await expect(fly).toBeVisible()
  await page.locator('.fp-prose').click()
  await expect(fly).toHaveCount(0)
  // Le helper du ruban passe par le groupe replié.
  await rb(page, 'zoom-100')
  await expect.poll(level).toContain('100')
  // La fenêtre s'élargit : plus rien de replié ; elle se rétrécit : ça revient.
  await page.setViewportSize({ width: 1920, height: 800 })
  await expect.poll(() => shrunk(page)).toEqual([])
  await page.setViewportSize({ width: 980, height: 800 })
  await expect.poll(() => shrunk(page)).toContain('zoom')
  errors.check()
})

test('groupe replié : une liste ouverte depuis le groupe garde le groupe ouvert jusqu’au choix', async ({ page }, info) => {
  const errors = watchErrors(page)
  await page.setViewportSize({ width: 760, height: 800 })
  await openEditor(page, makeFile(info, 'r.html', doc).url)
  await tab(page, 'draw')
  // À cette largeur, l'onglet Dessin replie des groupes : Insérer en fait partie.
  await expect.poll(() => shrunk(page)).toContain('ink-insert')
  await page.locator('[data-fold="ink-insert"]').click()
  const fly = page.locator('.fp-rb-flyout[data-flyout="ink-insert"]')
  await fly.locator('[data-cmd="ink-shapes"]').click()
  await expect(page.locator('[data-popover="ink-shapes"]')).toBeVisible()
  await expect(fly).toBeVisible()
  await page.locator('[data-popover="ink-shapes"] [data-shape-entry="rect"]').click()
  await expect(fly).toHaveCount(0)
  await expect(page.locator('body')).toHaveClass(/fp-drawing-shape/)
  await page.keyboard.press('Escape')
  errors.check()
})
