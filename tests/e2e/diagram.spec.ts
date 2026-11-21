// Insertion → Diagramme : nouveau, depuis une liste, modifier, annuler, enregistrer.

import { expect, test, type Page } from '@playwright/test'
import { blocks, caretAfter, docOfFile, editor, makeFile, mod, openEditor, rb, removeFsAccess, saveByDownload, tab, watchErrors } from './helpers'

const DOC = { format: 'folio/doc', version: 1, meta: { title: 'Diagrammes', lang: 'fr' }, blocks: ['Les étapes :', { type: 'list', items: ['Semer', { text: 'en avril', level: 1 }, 'Arroser', 'Récolter'] }, 'Fin.'] }
const dlg = (page: Page) => page.locator('[data-dialog="diagram"]')

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
  })
})

test('nouveau diagramme : disposition, éléments (Tab pour un sous-élément), aperçu, insertion', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'd.html', DOC).url)
  await caretAfter(page, 'Fin.')
  await tab(page, 'insert')
  await rb(page, 'insert-diagram')
  await expect(dlg(page).locator('.fp-dg-kind')).toHaveCount(6)
  await dlg(page).locator('[data-kind="hierarchy"]').click()
  await expect(dlg(page).locator('[data-kind="hierarchy"]')).toHaveAttribute('aria-checked', 'true')
  const text = dlg(page).locator('[data-field="dg-items"]')
  await text.fill('Direction\nVentes')
  await text.press('Home')
  await text.press('Tab')
  await expect(dlg(page).locator('[data-dg-preview] svg')).toContainText('Ventes')
  await dlg(page).locator('[data-field="dg-title"]').fill('Organisation')
  await dlg(page).locator('[data-action="ok"]').click()
  await expect(dlg(page)).toHaveCount(0)
  await expect(editor(page).locator('.fp-diagram svg')).toBeVisible()
  const d = (await blocks(page)).find((b: { type: string }) => b.type === 'diagram')
  expect(d).toEqual({ type: 'diagram', kind: 'hierarchy', title: 'Organisation', items: [{ text: 'Direction', level: 0 }, { text: 'Ventes', level: 1 }] })
  errors.check()
})

test('une liste devient un diagramme (clic droit) ; double-clic pour le modifier ; Ctrl+Z ; enregistré et relu', async ({ page }, info) => {
  const errors = watchErrors(page)
  await removeFsAccess(page)
  await openEditor(page, makeFile(info, 'd.html', DOC).url)
  await caretAfter(page, 'Arroser')
  await editor(page).getByText('Arroser').click({ button: 'right' })
  await page.locator('[data-ctx="list-to-diagram"]').click()
  await expect(dlg(page).locator('[data-field="dg-items"]')).toHaveValue('Semer\n  en avril\nArroser\nRécolter')
  await dlg(page).locator('[data-kind="cycle"]').click()
  await dlg(page).locator('[data-action="ok"]').click()
  let b = await blocks(page)
  expect(b.map((x: { type: string }) => x.type)).toEqual(['paragraph', 'diagram', 'paragraph'])
  expect(b[1]).toMatchObject({ kind: 'cycle', items: [{ text: 'Semer', level: 0 }, { text: 'en avril', level: 1 }, { text: 'Arroser', level: 0 }, { text: 'Récolter', level: 0 }] })
  // Double-clic : la pyramide, en une couleur.
  await editor(page).locator('.fp-diagram').dblclick()
  await dlg(page).locator('[data-kind="pyramid"]').click()
  await dlg(page).locator('[data-field="dg-color"]').selectOption('accent2')
  await dlg(page).locator('[data-action="ok"]').click()
  b = await blocks(page)
  expect(b[1]).toMatchObject({ kind: 'pyramid', color: 'accent2' })
  // Annuler jusqu'à retrouver la liste.
  await page.keyboard.press(`${mod}+z`)
  await page.keyboard.press(`${mod}+z`)
  await expect.poll(async () => (await blocks(page))[1].type).toBe('list')
  await page.keyboard.press(`${mod}+y`)
  await page.keyboard.press(`${mod}+y`)
  await expect.poll(async () => (await blocks(page))[1].kind).toBe('pyramid')
  const saved = await saveByDownload(page, info, 'diag.html')
  expect(docOfFile(saved.html).blocks[1]).toMatchObject({ type: 'diagram', kind: 'pyramid' })
  await page.goto(saved.url)
  await page.waitForFunction(() => !!(window as any).folio?.doc)
  await expect(editor(page).locator('.fp-diagram svg')).toContainText('Récolter')
  errors.check()
})
