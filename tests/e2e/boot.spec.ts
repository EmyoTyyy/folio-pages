import { expect, test } from '@playwright/test'
import { BLANK, blankHtml, editor, openEditor, watchErrors, watchNetwork, writeFile } from './helpers'
import { pathToFileURL } from 'node:url'

const BLANK_URL = pathToFileURL(BLANK).href

test('l’application vide s’ouvre sur la démonstration, sans erreur ni réseau', async ({ page }) => {
  const errs = watchErrors(page)
  const net = watchNetwork(page)
  await openEditor(page, BLANK_URL)
  await expect(page.locator('#folio-splash')).toHaveCount(0)
  await expect(editor(page).locator('p[data-style="title"]')).toHaveText('Bienvenue dans Folio Pages')
  await expect(page.locator('#fp-banner')).toBeVisible()
  await expect(page.locator('#fp-new-blank')).toBeVisible()
  await expect(page).toHaveTitle('Bienvenue dans Folio Pages — Folio Pages')
  await expect(page.locator('#fp-status')).toHaveText('Aucune modification')
  const contract = await page.evaluate(() => {
    const f = (window as any).folio
    return {
      doc: f.doc.format,
      serialize: typeof f.serialize,
      loadDoc: typeof f.loadDoc,
      schema: f.schema().$schema,
      lang: f.i18n.lang,
      loader: f.loader?.path,
    }
  })
  expect(contract).toEqual({
    doc: 'folio/doc',
    serialize: 'function',
    loadDoc: 'function',
    schema: 'https://json-schema.org/draft/2020-12/schema',
    lang: 'fr',
    loader: 'inline',
  })
  errs.check()
  net.check()
})

test.describe('en anglais', () => {
  test.use({ locale: 'en-US' })
  test('la démonstration et l’interface suivent la langue du navigateur', async ({ page }) => {
    await openEditor(page, BLANK_URL)
    await expect(editor(page).locator('p[data-style="title"]')).toHaveText('Welcome to Folio Pages')
    await expect(page.locator('[data-menu="file"]')).toHaveText('File')
    await expect(page.locator('#fp-save')).toContainText('Save')
  })
})

test('changer de langue met toute l’interface à jour et s’en souvient', async ({ page }) => {
  await openEditor(page, BLANK_URL)
  await page.locator('.fp-ribbon__tab[data-tab="review"]').click()
  await page.locator('.fp-ribbon [data-cmd="language"]').click()
  await page.locator('[data-item="lang-en"]').click()
  await expect(page.locator('[data-menu="file"]')).toHaveText('File')
  await expect(page.locator('#fp-save')).toContainText('Save')
  await expect(page.locator('#fp-status')).toHaveText('No changes')
  await expect(page.locator('#fp-banner')).toContainText('demo document')
  await page.reload()
  await expect(page.locator('[data-menu="file"]')).toHaveText('File')
})

test.describe('sans JavaScript', () => {
  test.use({ javaScriptEnabled: false })
  test('un message lisible remplace la page blanche', async ({ page }) => {
    await page.goto(BLANK_URL)
    // (le moteur de texte de Playwright ignore <noscript> : on lit le texte rendu)
    expect(await page.locator('body').innerText()).toContain('Ce document a besoin de JavaScript pour s’ouvrir')
    await expect(page.locator('#folio-splash')).toBeHidden()
  })
})

test('un navigateur trop ancien reçoit une explication, pas une page blanche', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error simulation d'un navigateur ancien
    delete window.structuredClone
  })
  await page.goto(BLANK_URL)
  await expect(page.getByText('Ce fichier est un document Folio Pages.')).toBeVisible()
  await expect(page.getByText('Chrome ou Edge 111 ou plus')).toBeVisible()
  await expect(page.locator('#folio-splash')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).folio)).toBeUndefined()
})

test('une application abîmée affiche une erreur claire', async ({ page }, info) => {
  // On change dix caractères au milieu de la charge utile compressée.
  const original = blankHtml()
  const start = original.indexOf('id="folio-rt" ')
  const body = original.indexOf('>', start) + 1 + 40_000
  const swap = (c: string) => (c === 'a' ? 'b' : 'a')
  let html = original.slice(0, body)
  for (let i = 0; i < 10; i++) html += swap(original[body + i])
  html += original.slice(body + 10)
  expect(html.length).toBe(original.length)
  expect(html).not.toBe(original)
  const f = writeFile(info, 'abime.html', html)
  await page.goto(f.url)
  await expect(page.getByText('Ce fichier Folio Pages n’a pas pu démarrer')).toBeVisible()
  await expect(page.getByText('bloc « folio-doc »')).toBeVisible()
})

test('le fichier vierge respecte l’ordre prévu et reste léger', async () => {
  const html = blankHtml()
  const order = ['<meta name="generator"', 'NOTICE: Folio Pages', 'AI AGENTS AND TOOLS', 'id="folio-doc"', 'id="folio-splash"', 'id="folio-rt-css"', 'id="folio-rt"', '__folioOk']
  const positions = order.map((s) => html.indexOf(s))
  for (const p of positions) expect(p).toBeGreaterThan(-1)
  expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  expect(Buffer.byteLength(html)).toBeLessThan(1_500_000)
  expect(html).toContain('Copyright (c) 2026 The Bento authors')
  expect(html).toContain('Marijn Haverbeke')
})
