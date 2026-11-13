// Phase 4 : apparence, volet de navigation, table des matières.

import { expect, test } from '@playwright/test'
import { blocks, caretAfter, docJson, editor, makeFile, openEditor, rb, tab } from './helpers'

const sentence = (i: number) => `Phrase ${i} d’un paragraphe assez long pour occuper plusieurs lignes de la page imprimée.`
const long = (n: number) => ({ text: Array.from({ length: n }, (_, i) => sentence(i + 1)).join(' ') })

const DOC = {
  format: 'folio/doc',
  version: 1,
  blocks: [
    { type: 'toc', title: 'Sommaire' },
    { type: 'heading', text: 'Introduction' },
    long(40),
    { type: 'heading', level: 2, text: 'Contexte' },
    long(40),
    { type: 'heading', text: 'Résultats' },
    long(10),
    { type: 'heading', level: 4, text: 'Détail profond' },
  ],
}

test('apparence claire, sombre, système ; la page reste blanche', async ({ page }, info) => {
  const f = makeFile(info, 'doc.html', DOC)
  await openEditor(page, f.url)
  await tab(page, 'view')
  await rb(page, 'appearance')
  await page.locator('[data-popover="appearance"] [data-appearance="dark"]').click()
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
  const chrome = await page.locator('.fp-titlebar').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(chrome).toBe('rgb(24, 27, 25)')
  const paper = await page.locator('.fp-sheet').first().evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(paper).toBe('rgb(255, 255, 255)')
  await page.reload()
  await page.waitForFunction(() => !!(window as any).folio?.doc)
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
  await tab(page, 'view')
  await rb(page, 'appearance')
  await page.locator('[data-popover="appearance"] [data-appearance="system"]').click()
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'system')
})

test('volet de navigation : titres, titre courant, saut vers un titre', async ({ page }, info) => {
  const f = makeFile(info, 'doc.html', DOC)
  await openEditor(page, f.url)
  await tab(page, 'view')
  await rb(page, 'view-nav')
  const items = page.locator('#fp-nav .fp-nav__item')
  await expect(items).toHaveCount(4)
  await expect(items.nth(1)).toContainText('Contexte')
  await items.nth(2).click()
  await expect(items.nth(2)).toHaveClass(/is-current/)
  await page.keyboard.type('!')
  expect((await blocks(page))[5].content[0].text).toBe('Résultats\u202f!')
  // un nouveau titre apparaît dans le volet
  await caretAfter(page, 'Détail profond')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Conclusion')
  await page.keyboard.press('Control+Alt+1')
  await expect(items).toHaveCount(5)
  await expect(items.nth(4)).toContainText('Conclusion')
})

test('table des matières : titres, numéros de page, lien, mise à jour, insertion depuis le ruban', async ({ page }, info) => {
  const f = makeFile(info, 'doc.html', DOC)
  await openEditor(page, f.url)
  const entries = page.locator('.fp-prose .fp-toc .fp-toc__entry')
  // niveaux 1 à 3 : le titre de niveau 4 n'y est pas
  await expect(entries).toHaveCount(3)
  await expect(page.locator('.fp-prose .fp-toc__title')).toHaveText('Sommaire')
  await expect(entries.nth(0).locator('.fp-toc__page')).toHaveText('1')
  await page.waitForFunction(() => document.querySelectorAll('.fp-sheet').length > 1)
  const lastPage = await entries.nth(2).locator('.fp-toc__page').textContent()
  expect(Number(lastPage)).toBeGreaterThan(1)
  // le lien mène au titre
  await entries.nth(2).locator('a').click()
  await page.keyboard.type('?')
  expect((await blocks(page))[5].content[0].text).toBe('Résultats\u202f?')
  await expect(entries.nth(2).locator('.fp-toc__text')).toHaveText('Résultats\u202f?')
  // insérer une seconde table depuis le ruban (titres 1 à 4)
  await caretAfter(page, 'Détail profond')
  await tab(page, 'references')
  await rb(page, 'insert-toc')
  await page.locator('[data-popover="insert-toc"] [data-toc="4"]').click()
  const d = await docJson(page)
  expect(d.blocks.filter((b: any) => b.type === 'toc')).toHaveLength(2)
  await expect(page.locator('.fp-prose .fp-toc').nth(1).locator('.fp-toc__entry')).toHaveCount(4)
  void editor
})
