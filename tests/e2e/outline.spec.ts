// Affichage → Plan : onglet Mode Plan, repli d'un titre, niveaux, déplacement.

import { expect, test, type Page } from '@playwright/test'
import { blocks, caretAfter, editor, makeFile, openEditor, rb, tab, watchErrors } from './helpers'

const H = (level: number, text: string) => ({ type: 'heading', level, text })
const DOC = { format: 'folio/doc', version: 1, meta: { title: 'Plan', lang: 'fr' }, blocks: [H(1, 'Introduction'), 'Texte de l’introduction.', H(2, 'Contexte'), 'Le contexte.', H(1, 'Méthode'), 'La méthode.'] }
const pop = (page: Page) => page.locator('[data-popover]')
const plan = async (page: Page) => (await blocks(page)).map((b: { type: string; level?: number; content: { text: string }[] }) => `${b.type === 'heading' ? `H${b.level}:` : ''}${b.content.map((r) => r.text).join('')}`)

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
  })
})

test('vue Plan : onglet Mode Plan, replier et déplier, niveaux montrés, monter un titre avec sa partie, fermer', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'plan.html', DOC).url)
  await tab(page, 'view')
  await rb(page, 'view-outline')
  await expect(page.locator('#fp-page')).toHaveClass(/is-outline/)
  await expect(page.locator('.fp-ribbon__tab[data-tab="outline"]')).toBeVisible()
  await expect(page.locator('#fp-pages')).toHaveText('Mode Plan')
  // Le texte garde son aspect (aucune classe en commun avec l'effet « contour »).
  expect(await editor(page).locator('p').first().evaluate((e) => getComputedStyle(e).webkitTextFillColor)).not.toBe('rgba(0, 0, 0, 0)')
  // Le titre « Introduction » se replie d'un clic sur son bouton.
  const toggles = editor(page).locator('.fp-ol-toggle')
  await expect(toggles).toHaveCount(3)
  await toggles.first().click()
  await expect(editor(page).getByText('Le contexte.')).toBeHidden()
  await expect(editor(page).getByText('Texte de l’introduction.')).toBeHidden()
  await expect(editor(page).getByText('La méthode.')).toBeVisible()
  await expect(toggles.first()).toHaveText('+')
  await toggles.first().click()
  await expect(editor(page).getByText('Le contexte.')).toBeVisible()
  // N'afficher que le niveau 1.
  await tab(page, 'outline')
  await rb(page, 'ol-level')
  await pop(page).locator('[data-ol-level="1"]').click()
  await expect(editor(page).locator('h2')).toBeHidden()
  await expect(editor(page).getByText('La méthode.')).toBeHidden()
  await rb(page, 'ol-level')
  await pop(page).locator('[data-ol-level="0"]').click()
  // « Méthode » monte au-dessus de « Introduction », avec son texte (Alt+Maj+↑).
  await caretAfter(page, 'Méthode')
  await page.keyboard.press('Alt+Shift+ArrowUp')
  expect(await plan(page)).toEqual(['H1:Méthode', 'La méthode.', 'H1:Introduction', 'Texte de l’introduction.', 'H2:Contexte', 'Le contexte.'])
  // Descendre d'un niveau, depuis le ruban.
  await rb(page, 'ol-demote')
  expect((await plan(page))[0]).toBe('H2:Méthode')
  // Fermer : retour à la vue page, plus d'onglet Mode Plan ni de boutons.
  await rb(page, 'ol-close')
  await expect(page.locator('#fp-page')).toHaveClass(/is-paged/)
  await expect(page.locator('.fp-ribbon__tab[data-tab="outline"]')).toBeHidden()
  await expect(editor(page).locator('.fp-ol-toggle')).toHaveCount(0)
  errors.check()
})
