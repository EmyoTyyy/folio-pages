// Aide-mémoire (F1, ?) : recherche, ouverture comme document et impression,
// lien « #cheat-sheet » du site ; et les raccourcis ajoutés avec lui.

import { expect, test } from '@playwright/test'
import { BLANK, blocks, docJson, editor, makeFile, mod, openEditor, selectText, watchErrors } from './helpers'
import { pathToFileURL } from 'node:url'

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
  })
})

const doc = (b: unknown[], more: Record<string, unknown> = {}) => ({ format: 'folio/doc', version: 1, meta: { title: 'Raccourcis', lang: 'fr' }, blocks: b, ...more })

test('la fenêtre : toutes les rubriques, la recherche (sans accents), rien trouvé', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'a.html', doc(['x'])).url)
  await page.keyboard.press('F1')
  const dlg = page.locator('[data-dialog="shortcuts"]')
  await expect(dlg.locator('.fp-dialog__title')).toHaveText('Aide-mémoire Folio Pages')
  await expect(dlg.locator('[data-field="cheat-search"]')).toBeFocused()
  await expect(dlg.locator('[data-cheat]')).toHaveCount(13)
  await expect(dlg.locator('[data-cheat="text"]')).toContainText('Ctrl+Alt+H')
  await expect(dlg.locator('[data-cheat="fields"]')).toContainText('{{date:JJ/MM/AAAA}}')
  // « equation » trouve « Équation » ; les rubriques sans résultat se cachent.
  await page.keyboard.type('equation')
  await expect(dlg.locator('[data-cheat]:visible')).toHaveCount(2)
  await expect(dlg.locator('[data-cheat="insert"] dd:visible')).toHaveText(['Équation'])
  await dlg.locator('[data-field="cheat-search"]').fill('xyzzy')
  await expect(dlg.locator('[data-cheat]:visible')).toHaveCount(0)
  await expect(dlg.locator('[data-field="cheat-empty"]')).toBeVisible()
  await dlg.locator('[data-field="cheat-search"]').fill('')
  await expect(dlg.locator('[data-cheat]:visible')).toHaveCount(13)
  errors.check()
})

test('ouvrir comme document, imprimer : deux pages A4 en paysage, dans un nouvel onglet', async ({ page, context }, info) => {
  const errors = watchErrors(page)
  await context.addInitScript(() => {
    ;(window as any).__printed = 0
    window.print = () => void ((window as any).__printed += 1)
  })
  await openEditor(page, makeFile(info, 'b.html', doc(['x'])).url)
  await page.keyboard.press('F1')
  const [tab] = await Promise.all([context.waitForEvent('page'), page.locator('[data-dialog="shortcuts"] [data-action="open"]').click()])
  await tab.waitForSelector('.fp-prose')
  await expect(tab.locator('#fp-title')).toHaveValue('Aide-mémoire Folio Pages')
  await expect(tab.locator('#fp-pages')).toHaveText(/sur 2/)
  const sheet = await tab.evaluate(() => (window as any).folio.doc)
  expect(sheet.page.orientation).toBe('landscape')
  expect(sheet.blocks.filter((b: any) => b.type === 'columns')).toHaveLength(2)
  await tab.close()
  // Imprimer : le même document, l'impression lancée d'elle-même.
  await page.keyboard.press('F1')
  const [printed] = await Promise.all([context.waitForEvent('page'), page.locator('[data-dialog="shortcuts"] [data-action="print"]').click()])
  await printed.waitForSelector('.fp-prose')
  await expect.poll(() => printed.evaluate(() => (window as any).__printed), { timeout: 8000 }).toBe(1)
  errors.check()
})

test('lien du site « #cheat-sheet » : l’aide-mémoire dans la langue du navigateur, un nouveau document', async ({ page }) => {
  const errors = watchErrors(page)
  await page.addInitScript(() => localStorage.setItem('folio-pages:lang', 'en'))
  await openEditor(page, pathToFileURL(BLANK).href + '#cheat-sheet')
  await expect(page.locator('#fp-title')).toHaveValue('Folio Pages cheat sheet')
  await expect(editor(page)).toContainText('Ctrl+Shift+Space')
  // Pas la démonstration : pas de bandeau « document de démonstration ».
  await expect(page.locator('#fp-banner')).toBeHidden()
  errors.check()
})

test('nouveaux raccourcis : surligner, liste à cocher, espace insécable, champs date, heure, page', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'c.html', doc(['un mot ici', 'tâche'])).url)
  await selectText(page, 'mot')
  await page.keyboard.press(`${mod}+Alt+h`)
  expect((await blocks(page))[0].content[1]).toMatchObject({ text: 'mot', highlight: 'yellow' })
  await page.keyboard.press(`${mod}+Alt+h`)
  expect((await blocks(page))[0].content).toEqual([{ text: 'un mot ici' }])
  // 7, 8, 9 : numérotée, à puces, à cocher.
  await editor(page).getByText('tâche').click()
  await page.keyboard.press(`${mod}+Shift+9`)
  expect((await blocks(page))[1]).toMatchObject({ type: 'list', style: 'check' })
  // Espace insécable, puis les champs.
  await editor(page).getByText('un mot ici').click()
  await page.keyboard.press('End')
  await page.keyboard.press(`${mod}+Shift+Space`)
  await page.keyboard.press('Alt+Shift+D')
  await page.keyboard.press('Alt+Shift+T')
  await page.keyboard.press('Alt+Shift+P')
  const p = (await blocks(page))[0].content
  expect(p[0].text).toBe('un mot ici ')
  expect(p.slice(1).map((x: any) => [x.type, x.name])).toEqual([
    ['field', 'date'],
    ['field', 'time'],
    ['field', 'page'],
  ])
  errors.check()
})

test('nouveaux raccourcis : tableau, image, saut de colonne, document suivant ou précédent', async ({ page }, info) => {
  const errors = watchErrors(page)
  const file = doc([{ type: 'columns', count: 2, blocks: ['gauche', 'droite'] }, 'après'], {
    key: 'a',
    documents: [{ key: 'b', meta: { title: 'Deuxième', lang: 'fr' }, blocks: ['B'] }, { key: 'c', meta: { title: 'Troisième', lang: 'fr' }, blocks: ['C'] }],
  })
  await openEditor(page, makeFile(info, 'd.html', file).url)
  // Saut de colonne : dans des colonnes seulement.
  await editor(page).getByText('gauche').click()
  await page.keyboard.press('End')
  await page.keyboard.press(`${mod}+Shift+Enter`)
  expect((await blocks(page))[0].blocks.map((b: any) => b.type ?? 'paragraph')).toEqual(['paragraph', 'columnbreak', 'paragraph'])
  await editor(page).getByText('après').click()
  await page.keyboard.press(`${mod}+Shift+Enter`)
  expect((await blocks(page)).length).toBe(2)
  // T comme tableau (3 × 3, avec en-tête), I comme image (le sélecteur de fichiers).
  await page.keyboard.press(`${mod}+Alt+t`)
  const table = (await blocks(page)).find((b: any) => b.type === 'table')
  expect(table.rows).toHaveLength(3)
  expect(table.rows[0]).toHaveLength(3)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press(`${mod}+Alt+i`)])
  expect(chooser.isMultiple()).toBe(false)
  await chooser.setFiles([])
  // Alt+Page suivante / précédente : les onglets, en boucle.
  await page.keyboard.press('Alt+PageDown')
  await expect(page.locator('.fp-doctab.is-active')).toHaveText('Deuxième')
  await expect(editor(page)).toBeFocused()
  await page.keyboard.press('Alt+PageUp')
  await page.keyboard.press('Alt+PageUp')
  await expect(page.locator('.fp-doctab.is-active')).toHaveText('Troisième')
  expect((await docJson(page)).meta.title).toBe('Raccourcis')
  errors.check()
})
