// Phase 4 : historique des versions (dans le navigateur seulement).

import { expect, test, type Page } from '@playwright/test'
import { caretAfter, docJson, docOfFile, installFakeFs, makeFile, mod, openEditor, watchErrors } from './helpers'

const DOC = { format: 'folio/doc', version: 1, id: 'versions-0001', meta: { title: 'Notes' }, blocks: ['Version un.'] }

const text = async (page: Page) => (await docJson(page)).blocks[0].content[0].text as string

async function openHistory(page: Page) {
  await page.locator('[data-menu="file"]').click()
  await page.locator('[data-menu-popup="file"] [data-item="versions"]').click()
  await expect(page.locator('[data-dialog="versions"]')).toBeVisible()
}

test('une version par enregistrement ; restaurer s’annule ; l’état quitté est gardé', async ({ page, browserName }, info) => {
  const errs = watchErrors(page)
  if (browserName === 'chromium') await installFakeFs(page)
  await openEditor(page, makeFile(info, 'v.html', DOC).url)
  const save = async () => {
    if (browserName === 'chromium') {
      await page.keyboard.press(`${mod}+s`)
      await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'saved')
    } else {
      await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${mod}+s`)])
      await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'downloaded')
    }
  }
  await caretAfter(page, 'Version un')
  await page.keyboard.type(' (a)')
  await save()
  await caretAfter(page, '(a)')
  await page.keyboard.type(' (b)')
  await save()
  expect(await text(page)).toBe('Version un (a) (b).')
  // Du texte pas encore enregistré : restaurer ne doit pas le perdre.
  await caretAfter(page, '(b)')
  await page.keyboard.type(' (c)')
  await openHistory(page)
  const rows = page.locator('.fp-versions__row')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('Enregistrement')
  // Restaurer la plus ancienne.
  await rows.nth(1).locator('[data-action="restore-version"]').click()
  await expect(page.locator('[data-dialog="versions"]')).toHaveCount(0)
  expect(await text(page)).toBe('Version un (a).')
  // Annulable.
  await page.locator('.fp-prose').click()
  await page.keyboard.press(`${mod}+z`)
  expect(await text(page)).toBe('Version un (a) (b) (c).')
  // L'état quitté par la restauration est dans l'historique.
  await openHistory(page)
  await expect(page.locator('.fp-versions__row[data-reason="restore"]')).toHaveCount(1)
  // Rien de l'historique dans le fichier.
  const html = await page.evaluate(() => (window as any).folio.serialize())
  expect(html).not.toContain('Version un (a).')
  expect(Object.keys(docOfFile(html))).not.toContain('versions')
  errs.check()
})

test('une version automatique après dix minutes d’édition ; effacer l’historique', async ({ page }, info) => {
  await page.clock.install()
  await openEditor(page, makeFile(info, 'v.html', DOC).url)
  await caretAfter(page, 'Version un')
  await page.keyboard.type(' début')
  await page.clock.runFor(2000)
  await page.clock.fastForward('11:00')
  await page.keyboard.type(' suite')
  await page.clock.runFor(4000)
  await page.waitForTimeout(300)
  await openHistory(page)
  await expect(page.locator('.fp-versions__row[data-reason="auto"]')).toHaveCount(1)
  // Rien n'a changé depuis : « garder une version » le dit, sans doublon.
  await page.locator('[data-action="keep-version"]').click()
  await expect(page.locator('.fp-toast').last()).toContainText('Rien n’a changé')
  await expect(page.locator('.fp-versions__row')).toHaveCount(1)
  // Après une modification, une version à la demande ; puis tout effacer.
  await page.keyboard.press('Escape')
  await caretAfter(page, 'suite')
  await page.keyboard.type(' fin')
  await openHistory(page)
  await page.locator('[data-action="keep-version"]').click()
  await expect(page.locator('.fp-versions__row')).toHaveCount(2)
  await page.locator('[data-dialog="versions"] [data-action="clear"]').click()
  await openHistory(page)
  await expect(page.locator('.fp-versions__row')).toHaveCount(0)
  await expect(page.locator('[data-dialog="versions"]')).toContainText('Aucune version')
})
