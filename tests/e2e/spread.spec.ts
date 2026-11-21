// Mode lecture → Côte à côte : deux pages par écran, tourner les pages
// (boutons, clavier, molette), table des matières, liens internes, Rechercher,
// une seule page sur un écran étroit, retour à la lecture verticale.

import { expect, test, type Page } from '@playwright/test'
import { makeFile, openEditor, rb, tab, watchErrors } from './helpers'

const H = (text: string) => ({ type: 'heading', level: 1, text, pageBreakBefore: true })
const DOC = {
  format: 'folio/doc',
  version: 1,
  meta: { title: 'Livre', lang: 'fr' },
  blocks: [
    { type: 'heading', level: 1, text: 'Début' },
    { type: 'toc', title: 'Sommaire' },
    { content: ['Aller au ', { text: 'chapitre trois', link: '#chapitre-trois' }, '.'] },
    H('Chapitre un'),
    'Premier texte.',
    H('Chapitre deux'),
    'Deuxième texte.',
    H('Chapitre trois'),
    'Troisième texte avec le mot girafe.',
    H('Chapitre quatre'),
    'Quatrième texte.',
  ],
}

const label = (page: Page) => page.locator('.fp-spread__label')
const shown = (page: Page) => page.locator('.fp-spread__page').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.page)))

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
  })
})

test('côte à côte : deux pages par écran, boutons, clavier, molette, sommaire, lien, recherche, retour vertical', async ({ page }, info) => {
  const errors = watchErrors(page)
  await page.setViewportSize({ width: 1400, height: 900 })
  await openEditor(page, makeFile(info, 'livre.html', DOC).url)
  await expect(page.locator('#fp-pages')).toHaveText(/sur 5/)
  await expect(page.locator('#fp-spread')).toBeHidden()

  // Affichage → Côte à côte : le mode lecture s'ouvre, deux pages.
  await tab(page, 'view')
  await rb(page, 'movement-side')
  await expect(page.locator('.fp-app')).toHaveClass(/is-reading/)
  await expect(page.locator('#fp-spread')).toBeVisible()
  await expect(label(page)).toHaveText('Pages 1–2 sur 5')
  expect(await shown(page)).toEqual([1, 2])
  await expect(page.locator('[data-read-layout="side"]')).toHaveAttribute('aria-pressed', 'true')
  // Les pages sont des copies : leur texte, sans éditeur.
  const first = page.locator('.fp-spread__page').first()
  await expect(first.getByRole('heading', { name: 'Début' })).toBeVisible()
  await expect(page.locator('.fp-spread [contenteditable="true"]')).toHaveCount(0)
  await expect(page.locator('.fp-spread [id]')).toHaveCount(0)
  // Côte à côte : la seconde page est à droite de la première, à la même hauteur.
  const [a, b] = await page.locator('.fp-spread__page').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))
  expect(b.left).toBeGreaterThan(a.right)
  expect(Math.abs(a.top - b.top)).toBeLessThan(1)
  // La page tient dans la hauteur de l'écran.
  expect(a.bottom).toBeLessThan(900)

  // Bouton précédent grisé au début ; suivant.
  await expect(page.locator('[data-spread="prev"]')).toBeDisabled()
  await page.locator('[data-spread="next"]').click()
  await expect(label(page)).toHaveText('Pages 3–4 sur 5')
  await expect(page.locator('.fp-spread__page').first().getByRole('heading', { name: 'Chapitre deux' })).toBeVisible()
  // Le texte des autres pages n'y est pas lisible (ni par un lecteur d'écran).
  await expect(page.locator('.fp-spread__page').first().getByText('Premier texte.')).toBeHidden()
  await expect(page.locator('.fp-spread__page').first().locator('.fp-prose > [aria-hidden="true"]').first()).toBeAttached()
  // Clavier : flèche droite, puis la dernière page seule ; Origine.
  await page.keyboard.press('ArrowRight')
  await expect(label(page)).toHaveText('Page 5 sur 5')
  await expect(page.locator('[data-spread="next"]')).toBeDisabled()
  await page.keyboard.press('ArrowRight')
  await expect(label(page)).toHaveText('Page 5 sur 5')
  await page.keyboard.press('Home')
  await expect(label(page)).toHaveText('Pages 1–2 sur 5')
  await page.keyboard.press('PageDown')
  await expect(label(page)).toHaveText('Pages 3–4 sur 5')
  await page.keyboard.press('ArrowLeft')
  await expect(label(page)).toHaveText('Pages 1–2 sur 5')
  // Molette : un mouvement tourne une fois.
  await page.locator('.fp-spread__stage').hover()
  await page.mouse.wheel(0, 120)
  await expect(label(page)).toHaveText('Pages 3–4 sur 5')
  await page.waitForTimeout(450)
  await page.mouse.wheel(0, -120)
  await expect(label(page)).toHaveText('Pages 1–2 sur 5')

  // Sommaire : une entrée mène à sa page.
  await page.locator('.fp-spread__page[data-page="1"] .fp-toc__entry a', { hasText: 'Chapitre quatre' }).click()
  await expect(label(page)).toHaveText('Page 5 sur 5')
  await page.keyboard.press('Home')
  // Lien interne vers un titre.
  await page.locator('.fp-spread__page[data-page="1"] a[href="#chapitre-trois"]').click()
  await expect(label(page)).toHaveText('Pages 3–4 sur 5')
  await page.keyboard.press('Home')
  await expect(label(page)).toHaveText('Pages 1–2 sur 5')

  // Rechercher : le résultat amène sa page, surligné.
  await page.keyboard.press('Control+f')
  await page.locator('#fp-find-input').fill('girafe')
  await page.locator('#fp-find-input').press('Enter')
  await expect(label(page)).toHaveText('Pages 3–4 sur 5')
  await expect(page.locator('.fp-spread__page[data-page="4"] .fp-find-hit')).toBeVisible()
  // Les flèches tapées dans la recherche restent à la recherche.
  await page.locator('#fp-find-input').press('ArrowLeft')
  await expect(label(page)).toHaveText('Pages 3–4 sur 5')
  // Échap ferme la recherche, pas le mode lecture.
  await page.locator('#fp-find-input').press('Escape')
  await expect(page.locator('#fp-find-input')).toBeHidden()
  await expect(page.locator('.fp-app')).toHaveClass(/is-reading/)
  await expect(page.locator('#fp-spread')).toBeVisible()

  // Écran étroit : une page à la fois.
  await page.setViewportSize({ width: 640, height: 900 })
  await expect(label(page)).toHaveText(/^Page \d sur 5$/)
  expect((await shown(page)).length).toBe(1)
  await page.setViewportSize({ width: 1400, height: 900 })
  await expect(label(page)).toHaveText(/^Pages \d–\d sur 5$/)

  // Retour à la lecture verticale, à la même page ; le réglage est gardé.
  await page.locator('[data-read-layout="vertical"]').click()
  await expect(page.locator('#fp-spread')).toBeHidden()
  await expect(page.locator('.fp-app')).toHaveClass(/is-reading/)
  const top = await page.evaluate(() => {
    const sheet = document.querySelector('.fp-sheets .fp-sheet[data-page="3"]')!.getBoundingClientRect()
    return sheet.top - document.querySelector('#fp-canvas')!.getBoundingClientRect().top
  })
  expect(Math.abs(top)).toBeLessThan(60)
  await page.locator('[data-read-layout="side"]').click()
  await expect(label(page)).toHaveText('Pages 3–4 sur 5')
  // Échap quitte le mode lecture (et la vue côte à côte) ; le réglage reste pour la prochaine fois.
  await page.keyboard.press('Escape')
  await expect(page.locator('.fp-app')).not.toHaveClass(/is-reading/)
  await expect(page.locator('#fp-spread')).toBeHidden()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('folio-pages:settings')!).readSpread)).toBe(true)
  // Le bouton Côte à côte du ruban est allumé seulement en lecture.
  await tab(page, 'view')
  await expect(page.locator('[data-cmd="movement-side"]')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-cmd="movement-vertical"]')).toHaveAttribute('aria-pressed', 'true')
  // Mode lecture : il revient côte à côte.
  await rb(page, 'view-read')
  await expect(page.locator('#fp-spread')).toBeVisible()
  errors.check()
})

test('côte à côte depuis la vue web : la vue Page le temps de la lecture, puis la vue web revient', async ({ page }, info) => {
  const errors = watchErrors(page)
  await page.setViewportSize({ width: 1400, height: 900 })
  await openEditor(page, makeFile(info, 'web.html', DOC).url)
  await tab(page, 'view')
  await rb(page, 'view-web')
  await expect(page.locator('#fp-page')).not.toHaveClass(/is-paged/)
  // Affichage → Plusieurs pages : la même vue.
  await rb(page, 'zoom-multi')
  await expect(page.locator('#fp-spread')).toBeVisible()
  await expect(label(page)).toHaveText('Pages 1–2 sur 5')
  // Modifier : la vue web revient, le document se modifie.
  await page.locator('#fp-read-exit').click()
  await expect(page.locator('#fp-spread')).toBeHidden()
  await expect(page.locator('#fp-page')).not.toHaveClass(/is-paged/)
  await expect(page.locator('.fp-app')).not.toHaveClass(/is-reading/)
  errors.check()
})
