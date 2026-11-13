// Phase 4 : variantes d'enregistrement, modèles, copies en lecture seule, mode lecture.

import { expect, test, type Page } from '@playwright/test'
import { caretAfter, docJson, docOfFile, editor, fsState, installFakeFs, makeFile, mod, openEditor, rb, tab, watchErrors, writeFile } from './helpers'

const DOC = { format: 'folio/doc', version: 1, id: 'original-0001', meta: { title: 'Compte rendu' }, blocks: ['Ordre du jour.', 'Décisions prises.'] }

async function fileMenu(page: Page, id: string) {
  await page.locator('[data-menu="file"]').click()
  await page.locator(`[data-menu-popup="file"] [data-item="${id}"]`).click()
}

test.describe('variantes d’enregistrement (fichier réécrit en place)', () => {
  test.beforeEach(async ({ page }) => installFakeFs(page))

  test('enregistrer une copie : un autre fichier, une autre identité ; on continue sur l’original', async ({ page }, info) => {
    const errs = watchErrors(page)
    await openEditor(page, makeFile(info, 'cr.html', DOC).url)
    await caretAfter(page, 'Ordre du jour')
    await page.keyboard.type(' complet')
    await fileMenu(page, 'save-copy')
    await expect(page.locator('.fp-toast')).toContainText('cr (copie).html')
    const fs = await fsState(page)
    expect(fs.pickerCalls.map((c: any) => c.suggestedName)).toEqual(['cr (copie).html'])
    const copy = docOfFile(fs.writes[0].text)
    expect(copy.id).not.toBe('original-0001')
    expect(copy.blocks[0].content[0].text).toBe('Ordre du jour complet.')
    expect(copy.template).toBe(false)
    // La session reste sur l'original : identité inchangée, toujours « non enregistré ».
    expect((await docJson(page)).id).toBe('original-0001')
    await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'dirty')
    errs.check()
  })

  test('enregistrer comme nouveau document : la suite s’enregistre dans le nouveau fichier', async ({ page }, info) => {
    await openEditor(page, makeFile(info, 'cr.html', DOC).url)
    await fileMenu(page, 'save-new')
    await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'saved')
    const id = (await docJson(page)).id
    expect(id).not.toBe('original-0001')
    await caretAfter(page, 'Décisions prises')
    await page.keyboard.type(' hier')
    await page.keyboard.press(`${mod}+s`)
    await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'saved')
    const fs = await fsState(page)
    // Un seul choix d'emplacement : le second enregistrement réécrit le nouveau fichier.
    expect(fs.pickerCalls).toHaveLength(1)
    expect(fs.writes.map((w: any) => w.name)).toEqual(['cr.html', 'cr.html'])
    expect(docOfFile(fs.writes[1].text).id).toBe(id)
  })

  test('annuler le choix d’emplacement ne change rien', async ({ page }, info) => {
    await openEditor(page, makeFile(info, 'cr.html', DOC).url)
    await page.evaluate(() => ((window as any).__fs.mode = 'abort'))
    await fileMenu(page, 'save-new')
    await page.waitForTimeout(200)
    expect((await docJson(page)).id).toBe('original-0001')
    expect((await fsState(page)).writes).toEqual([])
  })
})

test('un modèle ouvre un nouveau document ; « Modifier le modèle » le garde modèle', async ({ page }, info) => {
  await installFakeFs(page)
  const errs = watchErrors(page)
  await openEditor(page, makeFile(info, 'cr.html', DOC).url)
  await fileMenu(page, 'save-template')
  const fs = await fsState(page)
  const html = fs.writes[0].text
  expect(fs.pickerCalls[0].suggestedName).toBe('cr (modèle).html')
  expect(docOfFile(html).template).toBe(true)
  // Ouvrir le modèle : un nouveau document, nouvelle identité, rien à enregistrer.
  const tpl = writeFile(info, 'modele.html', html)
  await openEditor(page, tpl.url)
  await expect(page.locator('.fp-toast')).toContainText('modèle')
  const d1 = await docJson(page)
  expect(d1.id).not.toBe(docOfFile(html).id)
  expect(d1.template).toBe(false)
  await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'pristine')
  // Chaque ouverture : encore une autre identité.
  await page.reload()
  await page.waitForFunction(() => !!(window as any).folio)
  expect((await docJson(page)).id).not.toBe(d1.id)
  // Le nouveau document s'enregistre ailleurs, sans le drapeau de modèle.
  await caretAfter(page, 'Ordre du jour')
  await page.keyboard.type('!')
  await page.keyboard.press(`${mod}+s`)
  await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'saved')
  const after = await fsState(page)
  const saved = docOfFile(after.writes[after.writes.length - 1].text)
  expect(saved.template).toBe(false)
  // « Modifier le modèle » : il s'enregistre comme modèle, avec son identité.
  await page.reload()
  await page.waitForFunction(() => !!(window as any).folio)
  await page.locator('.fp-toast').getByRole('button', { name: 'Modifier le modèle' }).click()
  await caretAfter(page, 'Décisions')
  await page.keyboard.type(' (modèle)')
  await page.keyboard.press(`${mod}+s`)
  await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'saved')
  const fin = await fsState(page)
  const tplSaved = docOfFile(fin.writes[fin.writes.length - 1].text)
  expect(tplSaved.template).toBe(true)
  expect(tplSaved.id).toBe(docOfFile(html).id)
  errs.check()
})

test('copie en lecture seule : lecture, rien ne se modifie ; « Modifier une copie »', async ({ page }, info) => {
  await installFakeFs(page)
  const errs = watchErrors(page)
  await openEditor(page, makeFile(info, 'cr.html', DOC).url)
  await fileMenu(page, 'save-readonly')
  const html = (await fsState(page)).writes[0].text
  expect(docOfFile(html).readOnly).toBe(true)
  const ro = writeFile(info, 'lecture.html', html)
  await openEditor(page, ro.url)
  await expect(page.locator('#fp-readbar')).toBeVisible()
  await expect(page.locator('.fp-ribbon')).toBeHidden()
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false')
  await editor(page).locator('p').first().click()
  await page.keyboard.type('xyz')
  await page.keyboard.press(`${mod}+s`)
  await expect(page.locator('.fp-toast').last()).toContainText('lecture seule')
  expect(JSON.stringify((await docJson(page)).blocks)).not.toContain('xyz')
  // Échap ne sort pas d'une copie en lecture seule.
  await page.keyboard.press('Escape')
  await expect(page.locator('#fp-readbar')).toBeVisible()
  // Modifier une copie : un nouveau document modifiable, le fichier en lecture seule ne change pas.
  await page.locator('#fp-read-exit').click()
  await expect(page.locator('#fp-readbar')).toBeHidden()
  await expect(page.locator('.fp-ribbon')).toBeVisible()
  await caretAfter(page, 'Ordre du jour')
  await page.keyboard.type(' modifié')
  await page.keyboard.press(`${mod}+s`)
  await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'saved')
  const fs = await fsState(page)
  const saved = docOfFile(fs.writes[fs.writes.length - 1].text)
  expect(saved.readOnly).toBe(false)
  expect(saved.id).not.toBe(docOfFile(html).id)
  // Le fichier en lecture seule ne se réécrit pas : on choisit où ranger la copie.
  expect(fs.pickerCalls.map((c: any) => c.suggestedName)).toEqual(['Compte rendu.html'])
  errs.check()
})

test('mode lecture d’un document ordinaire : Affichage → Lecture, Échap pour en sortir', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'cr.html', DOC).url)
  await tab(page, 'view')
  await rb(page, 'view-read')
  await expect(page.locator('#fp-readbar')).toBeVisible()
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false')
  await expect(page.locator('.fp-ribbon__tab[data-tab="insert"]')).toBeHidden()
  // Pas de note ni d'en-tête à modifier en lecture.
  await page.locator('.fp-hf-zone--header').first().dblclick()
  await expect(page.locator('.fp-hf-zone.is-editing')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('#fp-readbar')).toBeHidden()
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true')
  await caretAfter(page, 'Ordre')
  await page.keyboard.type('!')
  expect((await docJson(page)).blocks[0].content[0].text).toBe('Ordre\u202f! du jour.')
})

test('sans File System Access (Firefox, Safari) : la copie est téléchargée sous son nom', async ({ page }, info) => {
  await page.addInitScript(() => delete (window as any).showSaveFilePicker)
  await openEditor(page, makeFile(info, 'cr.html', DOC).url)
  const [download] = await Promise.all([page.waitForEvent('download'), fileMenu(page, 'save-copy')])
  expect(download.suggestedFilename()).toBe('cr (copie).html')
  const path = info.outputPath('copie.html')
  await download.saveAs(path)
  const fs = await import('node:fs')
  const copy = docOfFile(fs.readFileSync(path, 'utf8'))
  expect(copy.id).not.toBe('original-0001')
  expect((await docJson(page)).id).toBe('original-0001')
})
