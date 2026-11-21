// Révision : suivi de la mise en forme, filtre des marques, marques simples,
// volet Vérifications (vertical, horizontal), accepter et refuser depuis le volet.

import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { blocks, docJson, editor, makeFile, mod, openEditor, rb, selectText, tab, watchErrors } from './helpers'

const D = '2026-11-18T10:00:00.000Z'
const DOC = {
  format: 'folio/doc',
  version: 1,
  trackChanges: true,
  meta: { title: 'Rapport', lang: 'fr' },
  comments: [{ id: 'c1', author: 'Léa', date: D, text: 'Source ?', resolved: false, replies: [] }],
  blocks: [
    { type: 'heading', level: 1, content: ['Rapport'] },
    { content: ['Les ventes ont ', { text: 'fortement ', inserted: { author: 'Ana', date: D } }, { text: 'légèrement ', deleted: { author: 'Ana', date: D } }, 'progressé.'] },
    { content: [{ text: 'Chiffre', comments: ['c1'] }, ' provisoire.'] },
  ],
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false, authorName: 'Moi' }))
  })
})

const open = (page: Page, info: TestInfo, doc: unknown = DOC) => openEditor(page, makeFile(info, 'rapport.html', doc).url)
const pop = (page: Page) => page.locator('[data-popover]')

test('mise en forme suivie : gras et alignement notés, visibles, puis refusés', async ({ page }, info) => {
  const errors = watchErrors(page)
  await open(page, info)
  await selectText(page, 'provisoire')
  await page.keyboard.press(`${mod}+b`)
  const fmt = editor(page).locator('.fp-fmt')
  await expect(fmt).toHaveText('provisoire')
  expect(await fmt.evaluate((e) => getComputedStyle(e).borderBottomStyle)).toBe('dotted')
  const para = (await blocks(page))[2]
  expect(para.content.find((r: { text?: string }) => r.text === 'provisoire')).toMatchObject({ bold: true, formatChange: { author: 'Moi', before: {} } })
  // Centrer le paragraphe : la mise en forme du paragraphe est notée aussi.
  await page.keyboard.press(`${mod}+Shift+e`)
  await expect(editor(page).locator('p.fp-fmt-para')).toHaveCount(1)
  expect((await blocks(page))[2]).toMatchObject({ align: 'center', formatChange: { author: 'Moi', before: { kind: 'paragraph' } } })
  // Tout refuser : plus de gras ni de centrage ; les autres modifications aussi.
  await tab(page, 'review')
  await rb(page, 'track-reject')
  await pop(page).locator('[data-track="reject-all"]').click()
  await expect.poll(async () => JSON.stringify((await blocks(page))[2])).not.toContain('formatChange')
  expect(JSON.stringify((await blocks(page))[2])).not.toContain('"bold"')
  expect((await blocks(page))[2].align).toBeUndefined()
  errors.check()
})

test('volet Vérifications : compte, liste dans l’ordre, aller à une marque, accepter et refuser ; gardé ouvert', async ({ page }, info) => {
  const errors = watchErrors(page)
  await open(page, info)
  await tab(page, 'review')
  await rb(page, 'review-pane')
  await pop(page).locator('[data-review-side="vertical"]').click()
  const pane = page.locator('#fp-review')
  await expect(pane).toBeVisible()
  await expect(pane).toHaveAttribute('data-side', 'vertical')
  // À gauche du texte.
  expect((await pane.boundingBox())!.x).toBeLessThan((await page.locator('.fp-canvas').first().boundingBox())!.x)
  await expect(pane.locator('.fp-review__title')).toHaveText('3 révisions')
  // Gardé ouvert à la réouverture.
  await page.reload()
  await page.waitForFunction(() => !!(window as any).folio?.doc)
  await expect(page.locator('#fp-review')).toBeVisible()
  await expect(pane.locator('[data-stat="insert"]')).toHaveText('1 insertion')
  await expect(pane.locator('.fp-review__kind')).toHaveText(['Inséré', 'Supprimé', 'Commentaire'])
  // Aller à la suppression : elle est sélectionnée.
  await pane.locator('.fp-review__go[data-review-kind="delete"]').click()
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('légèrement ')
  // Accepter l'ajout, refuser la suppression : le texte reste, sans marque.
  await pane.locator('.fp-review__item').first().hover()
  await pane.locator('.fp-review__item').first().locator('[data-review-act="accept"]').click()
  await expect(pane.locator('.fp-review__title')).toHaveText('2 révisions')
  await pane.locator('.fp-review__item').first().hover()
  await pane.locator('.fp-review__item').first().locator('[data-review-act="reject"]').click()
  await expect(pane.locator('.fp-review__title')).toHaveText('1 révision')
  expect(JSON.stringify((await blocks(page))[1])).toBe(JSON.stringify({ type: 'paragraph', content: [{ text: 'Les ventes ont fortement légèrement progressé.' }] }))
  // En bas en mode horizontal.
  await tab(page, 'review')
  await rb(page, 'review-pane')
  await pop(page).locator('[data-review-side="horizontal"]').click()
  const h = (await page.locator('#fp-review').boundingBox())!
  const canvas = (await page.locator('.fp-canvas').first().boundingBox())!
  expect(h.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1)
  await rb(page, 'review-pane')
  await pop(page).locator('[data-review-side="horizontal"]').click()
  await expect(page.locator('#fp-review')).toBeHidden()
  errors.check()
})

test('filtre des marques : par type et par réviseur, dans le texte et dans le volet', async ({ page }, info) => {
  await open(page, info)
  await tab(page, 'review')
  await rb(page, 'review-pane')
  await pop(page).locator('[data-review-side="vertical"]').click()
  const del = editor(page).locator('.fp-del')
  const ins = editor(page).locator('.fp-ins')
  // Sans insertions ni suppressions : le texte final, rien dans le volet pour elles.
  await rb(page, 'filter-markup')
  await expect(pop(page).locator('[data-markup="changes"]')).toHaveAttribute('aria-checked', 'true')
  await pop(page).locator('[data-markup="changes"]').click()
  await expect(del).toBeHidden()
  expect(await ins.evaluate((e) => getComputedStyle(e).textDecorationLine)).toBe('none')
  await expect(page.locator('#fp-review .fp-review__kind')).toHaveText(['Commentaire'])
  await expect(page.locator('.fp-ribbon [data-cmd="filter-markup"]')).toHaveClass(/is-active/)
  await rb(page, 'show-markup')
  await pop(page).locator('[data-markup="changes"]').click()
  await expect(del).toBeVisible()
  // Masquer Ana : ses marques disparaissent, celles de Léa restent.
  await rb(page, 'filter-markup')
  await pop(page).locator('[data-markup-person="Ana"]').click()
  await expect(del).toBeHidden()
  await expect(page.locator('#fp-review .fp-review__kind')).toHaveText(['Commentaire'])
  await rb(page, 'filter-markup')
  await pop(page).locator('[data-markup-person="*"]').click()
  await expect(del).toBeVisible()
  await expect(page.locator('#fp-review .fp-review__item')).toHaveCount(3)
})

test('marques simples : le texte final, une barre dans la marge du paragraphe modifié', async ({ page }, info) => {
  await open(page, info)
  await tab(page, 'review')
  await rb(page, 'track-view')
  await pop(page).locator('[data-view="simple"]').click()
  await expect(editor(page)).toHaveClass(/track-simple/)
  await expect(editor(page).locator('.fp-del')).toBeHidden()
  const paras = editor(page).locator('p')
  expect(await paras.nth(0).evaluate((e) => getComputedStyle(e).boxShadow)).not.toBe('none')
  expect(await paras.nth(1).evaluate((e) => getComputedStyle(e).boxShadow)).toBe('none')
  expect((await docJson(page)).blocks).toHaveLength(3)
})
