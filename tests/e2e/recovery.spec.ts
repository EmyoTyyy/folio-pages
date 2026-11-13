// Récupération après plantage : une copie de secours est gardée pendant l'édition.

import { expect, test, type Page } from '@playwright/test'
import { caretToEnd, docText, editor, installFakeFs, makeFile, mod, openEditor, status, watchErrors } from './helpers'

const doc = (id: string, modified = '2026-01-02T00:00:00.000Z') => ({
  format: 'folio/doc',
  version: 1,
  id,
  meta: { title: 'Journal', created: '2026-01-01T00:00:00.000Z', modified },
  blocks: ['Texte d’origine.'],
})

/** Attend que la copie de secours soit écrite (au plus 3 s après la dernière frappe). */
async function waitForSnapshot(page: Page): Promise<void> {
  await page.waitForTimeout(1500)
}

const recoveryDialog = (page: Page) => page.locator('dialog[data-dialog="recovery"]')

test('après une fermeture brutale, on retrouve les modifications', async ({ page, context }, info) => {
  const errs = watchErrors(page)
  const f = makeFile(info, 'journal.html', doc('recov-doc-001'))
  await openEditor(page, f.url)
  await caretToEnd(page)
  await page.keyboard.type(' Ajouté avant la panne.')
  await waitForSnapshot(page)
  await page.close() // « plantage » : pas d'enregistrement

  const again = await context.newPage()
  await openEditor(again, f.url)
  const dlg = recoveryDialog(again)
  await expect(dlg).toBeVisible()
  await expect(dlg).toContainText('Modifications non enregistrées trouvées')
  await expect(dlg).toContainText('2026') // date lisible
  await dlg.locator('[data-action="restore"]').click()
  await expect(editor(again)).toContainText('Texte d’origine. Ajouté avant la panne.')
  await expect(status(again)).toHaveText('Modifications non enregistrées')
  await expect(again.locator('.fp-toast')).toContainText('restaurées')

  // La restauration s'annule avec Ctrl+Z.
  await editor(again).click()
  await again.keyboard.press(`${mod}+z`)
  await expect(editor(again)).not.toContainText('Ajouté avant la panne.')
  await again.keyboard.press(`${mod}+y`)
  await expect(editor(again)).toContainText('Ajouté avant la panne.')
  errs.check()
})

test('« Ignorer » oublie la copie de secours', async ({ page, context }, info) => {
  const f = makeFile(info, 'ignorer.html', doc('recov-doc-002'))
  await openEditor(page, f.url)
  await caretToEnd(page)
  await page.keyboard.type(' brouillon')
  await waitForSnapshot(page)
  await page.close()

  const p2 = await context.newPage()
  await openEditor(p2, f.url)
  await recoveryDialog(p2).locator('[data-action="ignore"]').click()
  await expect(editor(p2)).not.toContainText('brouillon')
  await p2.waitForTimeout(500)
  await p2.close()

  const p3 = await context.newPage()
  await openEditor(p3, f.url)
  await p3.waitForTimeout(800)
  await expect(recoveryDialog(p3)).toHaveCount(0)
})

test('une session partie de l’application vide se retrouve aussi', async ({ page, context }, info) => {
  const f = makeFile(info, 'folio-pages.html')
  await openEditor(page, f.url)
  await page.locator('#fp-new-blank').click()
  await editor(page).click()
  await page.keyboard.type('Mon brouillon de lettre.')
  await waitForSnapshot(page)
  await page.close()

  const again = await context.newPage()
  await openEditor(again, f.url)
  await recoveryDialog(again).locator('[data-action="restore"]').click()
  await expect(editor(again)).toHaveText('Mon brouillon de lettre.')
  await expect(again.locator('#fp-banner')).toBeHidden()
})

test('une copie plus ancienne que le fichier est signalée', async ({ page, context }, info) => {
  const f = makeFile(info, 'ancien.html', doc('recov-doc-003'))
  await openEditor(page, f.url)
  await caretToEnd(page)
  await page.keyboard.type(' vieille modification')
  await waitForSnapshot(page)
  await page.close()

  // Le même document, enregistré entre-temps ailleurs (date future).
  const newer = makeFile(info, 'ancien-plus-recent.html', doc('recov-doc-003', '2099-01-01T00:00:00.000Z'))
  const again = await context.newPage()
  await openEditor(again, newer.url)
  const dlg = recoveryDialog(again)
  await expect(dlg).toBeVisible()
  await expect(dlg.locator('.fp-warn')).toContainText('plus ancienne que le fichier')
})

test.describe('après un enregistrement dans le fichier', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'API File System Access')
  test('aucune restauration n’est proposée', async ({ page, context }, info) => {
    await installFakeFs(context)
    const f = makeFile(info, 'enregistre.html', doc('recov-doc-004'))
    await openEditor(page, f.url)
    await caretToEnd(page)
    await page.keyboard.type(' enregistré')
    await waitForSnapshot(page)
    await page.keyboard.press(`${mod}+s`)
    await expect(status(page)).toHaveText(/Enregistré dans/)
    await page.waitForTimeout(500)
    await page.close()
    const again = await context.newPage()
    await openEditor(again, f.url)
    await again.waitForTimeout(800)
    await expect(recoveryDialog(again)).toHaveCount(0)
  })
})

test('une copie identique au fichier ne déclenche rien', async ({ page, context }, info) => {
  const f = makeFile(info, 'identique.html', doc('recov-doc-005'))
  await openEditor(page, f.url)
  await caretToEnd(page)
  await page.keyboard.type('x')
  await page.keyboard.press('Backspace') // revenu à l'identique
  await waitForSnapshot(page)
  await page.close()
  const again = await context.newPage()
  await openEditor(again, f.url)
  await again.waitForTimeout(800)
  await expect(recoveryDialog(again)).toHaveCount(0)
  expect(await docText(again)).toBe('Texte d’origine.')
})
