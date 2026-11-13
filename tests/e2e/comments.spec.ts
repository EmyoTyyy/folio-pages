// Phase 4 : commentaires (fichier construit, Chrome et Firefox).

import { expect, test, type Page } from '@playwright/test'
import { caretAfter, docJson, editor, makeFile, mod, openEditor, rb, selectText, tab, watchErrors } from './helpers'

const DOC = {
  format: 'folio/doc',
  version: 1,
  comments: [
    { id: 'c1', author: 'Camille Martin', date: '2026-11-08T09:30:00Z', text: 'Ce chiffre vient de quelle source ?', replies: [{ author: 'Sam', date: '2026-11-08T10:00:00Z', text: 'Le rapport annuel, page 12.' }] },
    { id: 'c2', author: 'Léa', date: '2026-11-09T08:00:00Z', text: 'Formulation à revoir.', resolved: true },
  ],
  blocks: [
    { type: 'heading', text: 'Rapport trimestriel' },
    { content: ['Le chiffre d’affaires atteint ', { text: '120 k€', comments: ['c1'] }, ' ce trimestre, ', { text: 'une hausse nette', comments: ['c2'] }, ' par rapport au précédent.'] },
    'Un autre paragraphe pour commenter quelque chose de nouveau.',
  ],
}

const cards = (page: Page) => page.locator('.fp-cm__card')
const card = (page: Page, id: string) => page.locator(`.fp-cm__card[data-comment="${id}"]`)

async function nameOnce(page: Page, name = 'Noé Laurent') {
  await expect(page.locator('[data-dialog="author-name"]')).toBeVisible()
  await page.locator('[data-dialog="author-name"] [data-field="author-name"]').fill(name)
  await page.locator('[data-dialog="author-name"] [data-action="ok"]').click()
}

test('le volet montre les fils dans l’ordre du texte ; le texte commenté est surligné, sauf s’il est résolu', async ({ page }, info) => {
  const errs = watchErrors(page)
  await openEditor(page, makeFile(info, 'c.html', DOC).url)
  await expect(page.locator('#fp-comments')).toBeVisible()
  await expect(cards(page)).toHaveCount(2)
  await expect(cards(page).nth(0)).toContainText('Ce chiffre vient de quelle source ?')
  await expect(cards(page).nth(0)).toContainText('Le rapport annuel, page 12.')
  await expect(cards(page).nth(0).locator('.fp-cm__quote')).toHaveText('120 k€')
  await expect(card(page, 'c2')).toHaveClass(/is-resolved/)
  const bg = (id: string) => editor(page).locator(`.fp-comment[data-comment="${id}"]`).evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(await bg('c1')).not.toBe('rgba(0, 0, 0, 0)')
  expect(await bg('c2')).toBe('rgba(0, 0, 0, 0)')
  // Masquer les résolus.
  await page.locator('[data-field="show-resolved"]').uncheck()
  await expect(cards(page)).toHaveCount(1)
  errs.check()
})

test('nouveau commentaire : le nom est demandé une fois, Ctrl+Entrée publie, Échap annule', async ({ page }, info) => {
  const errs = watchErrors(page)
  await openEditor(page, makeFile(info, 'c.html', DOC).url)
  await selectText(page, 'quelque chose')
  await page.keyboard.press(`${mod}+Alt+m`)
  await nameOnce(page)
  const draft = page.locator('.fp-cm__card.is-draft')
  await expect(draft).toBeVisible()
  await expect(draft.locator('.fp-cm__quote')).toHaveText('quelque chose')
  // Le texte commenté reste visible pendant qu'on écrit.
  await expect(editor(page).locator('.fp-comment-draft')).toHaveText('quelque chose')
  await expect(draft.locator('[data-action="comment-submit"]')).toBeDisabled()
  await page.keyboard.type('Préciser quoi, exactement.')
  await page.keyboard.press(`${mod}+Enter`)
  await expect(draft).toHaveCount(0)
  const d = await docJson(page)
  expect(d.blocks[2].content).toEqual([{ text: 'Un autre paragraphe pour commenter ' }, { text: 'quelque chose', comments: ['c3'] }, { text: ' de nouveau.' }])
  expect(d.comments[2]).toMatchObject({ id: 'c3', author: 'Noé Laurent', text: 'Préciser quoi, exactement.', resolved: false, replies: [] })
  await expect(card(page, 'c3')).toContainText('Noé Laurent')
  // Deuxième fois : pas de question ; Échap annule sans rien changer.
  await selectText(page, 'nouveau')
  await tab(page, 'review')
  await rb(page, 'comment-new')
  await expect(page.locator('[data-dialog="author-name"]')).toHaveCount(0)
  await expect(page.locator('.fp-cm__card.is-draft')).toBeVisible()
  await page.keyboard.type('brouillon')
  await page.keyboard.press('Escape')
  await expect(page.locator('.fp-cm__card.is-draft')).toHaveCount(0)
  await expect(editor(page).locator('.fp-comment-draft')).toHaveCount(0)
  expect((await docJson(page)).comments).toHaveLength(3)
  // Annuler (dans le texte) retire le commentaire publié, en une fois.
  await editor(page).locator('p').first().click()
  await page.keyboard.press(`${mod}+z`)
  expect((await docJson(page)).comments).toHaveLength(2)
  expect(JSON.stringify((await docJson(page)).blocks[2])).not.toContain('comments')
  errs.check()
})

test('le nom reste dans le navigateur, d’une ouverture à l’autre', async ({ page }, info) => {
  const f = makeFile(info, 'c.html', DOC)
  await openEditor(page, f.url)
  await selectText(page, 'nouveau')
  await page.keyboard.press(`${mod}+Alt+m`)
  await nameOnce(page, 'Alex Dupont')
  await page.keyboard.press('Escape')
  await page.reload()
  await page.waitForFunction(() => !!(window as any).folio)
  await selectText(page, 'nouveau')
  await page.keyboard.press(`${mod}+Alt+m`)
  await expect(page.locator('.fp-cm__card.is-draft .fp-cm__author')).toHaveText('Alex Dupont')
  await expect(page.locator('[data-dialog="author-name"]')).toHaveCount(0)
  // Le nom ne va jamais dans le document.
  await page.keyboard.press('Escape')
  expect(JSON.stringify(await docJson(page))).not.toContain('Alex Dupont')
})

test('répondre, modifier, résoudre, rouvrir, supprimer (annulable)', async ({ page }, info) => {
  const errs = watchErrors(page)
  await page.addInitScript(() => localStorage.setItem('folio-pages:settings', JSON.stringify({ authorName: 'Noé Laurent' })))
  await openEditor(page, makeFile(info, 'c.html', DOC).url)
  const c1 = card(page, 'c1')
  await c1.locator('[data-action="reply"]').click()
  await page.keyboard.type('Vérifié.')
  await c1.locator('[data-action="comment-submit"]').click()
  await expect(c1.locator('.fp-cm__msg')).toHaveCount(3)
  await expect(c1.locator('.fp-cm__msg').last()).toContainText('Noé Laurent')
  // Modifier le premier message.
  await c1.locator('.fp-cm__msg').first().hover()
  await c1.locator('.fp-cm__msg').first().locator('[data-action="edit"]').click()
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type('Quelle source ?')
  await page.keyboard.press(`${mod}+Enter`)
  await expect(c1.locator('.fp-cm__msg').first()).toContainText('Quelle source ?')
  // Supprimer une réponse.
  await c1.locator('.fp-cm__msg').nth(1).hover()
  await c1.locator('.fp-cm__msg').nth(1).locator('[data-action="delete-reply"]').click()
  await expect(c1.locator('.fp-cm__msg')).toHaveCount(2)
  // Résoudre, rouvrir.
  await c1.locator('[data-action="resolve"]').click()
  await expect(c1).toHaveClass(/is-resolved/)
  expect((await docJson(page)).comments[0].resolved).toBe(true)
  await c1.locator('[data-action="reopen"]').click()
  expect((await docJson(page)).comments[0].resolved).toBe(false)
  // Supprimer, puis annuler.
  await c1.locator('[data-action="delete"]').click()
  await expect(card(page, 'c1')).toHaveCount(0)
  expect(JSON.stringify((await docJson(page)).blocks)).not.toContain('"c1"')
  await editor(page).locator('p').first().click()
  await page.keyboard.press(`${mod}+z`)
  await expect(card(page, 'c1')).toHaveCount(1)
  expect((await docJson(page)).blocks[1].content[1]).toEqual({ text: '120 k€', comments: ['c1'] })
  errs.check()
})

test('clic sur un fil : son texte est sélectionné ; curseur dans le texte : son fil est mis en avant', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'c.html', DOC).url)
  await card(page, 'c1').locator('.fp-cm__text').first().click()
  await expect(card(page, 'c1')).toHaveClass(/is-current/)
  // Le texte du fil courant est plus marqué que les autres.
  const bg = (id: string) => editor(page).locator(`.fp-comment[data-comment="${id}"]`).evaluate((el) => getComputedStyle(el).borderBottomColor)
  expect(await bg('c1')).toBe('rgba(196, 128, 0, 0.95)')
  await caretAfter(page, 'une hausse')
  await expect(card(page, 'c2')).toHaveClass(/is-current/)
  await expect(card(page, 'c1')).not.toHaveClass(/is-current/)
})

test('texte commenté supprimé : le fil reste, à part, jusqu’à ce qu’on le supprime', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'c.html', DOC).url)
  await selectText(page, '120 k€')
  await page.keyboard.press('Backspace')
  await expect(editor(page).locator('.fp-comment[data-comment="c1"]')).toHaveCount(0)
  await expect(page.locator('.fp-cm__orphans')).toBeVisible()
  await expect(card(page, 'c1')).toHaveClass(/is-orphan/)
  // Il est enregistré avec le document…
  expect((await docJson(page)).comments.map((c: any) => c.id)).toEqual(['c1', 'c2'])
  // … jusqu'à ce qu'on le supprime.
  await card(page, 'c1').locator('[data-action="delete"]').click()
  expect((await docJson(page)).comments.map((c: any) => c.id)).toEqual(['c2'])
})

test('ruban Révision : suivant, précédent, supprimer les résolus, volet', async ({ page }, info) => {
  const errs = watchErrors(page)
  await openEditor(page, makeFile(info, 'c.html', DOC).url)
  await tab(page, 'review')
  await caretAfter(page, 'Rapport')
  await rb(page, 'comment-next')
  await expect(card(page, 'c1')).toHaveClass(/is-current/)
  await rb(page, 'comment-next')
  await expect(card(page, 'c2')).toHaveClass(/is-current/)
  await rb(page, 'comment-prev')
  await expect(card(page, 'c1')).toHaveClass(/is-current/)
  await rb(page, 'comment-delete')
  await page.locator('[data-del="resolved"]').click()
  expect((await docJson(page)).comments.map((c: any) => c.id)).toEqual(['c1'])
  await rb(page, 'comments-pane')
  await expect(page.locator('#fp-comments')).toBeHidden()
  await rb(page, 'comments-pane')
  await expect(page.locator('#fp-comments')).toBeVisible()
  await rb(page, 'comment-delete')
  await page.locator('[data-del="all"]').click()
  expect((await docJson(page)).comments).toEqual([])
  await expect(page.locator('.fp-cm__empty')).toBeVisible()
  errs.check()
})

test('pas de commentaire dans un en-tête ; rien ne s’imprime', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'c.html', DOC).url)
  await page.locator('.fp-hf-zone--header').first().dblclick()
  await expect(page.locator('.fp-hf-zone.is-editing')).toHaveCount(1)
  await page.keyboard.type('En-tête')
  await page.keyboard.press(`${mod}+Alt+m`)
  await expect(page.locator('.fp-toast')).toContainText(/en-tête/)
  await page.keyboard.press('Escape')
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('#fp-comments')).toBeHidden()
  expect(await editor(page).locator('.fp-comment[data-comment="c1"]').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  await page.emulateMedia({ media: 'screen' })
})

test('les commentaires passent par le fichier enregistré', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'c.html', DOC).url)
  const html = await page.evaluate(() => (window as any).folio.serialize())
  const again = makeFile(info, 'relu.html', null)
  const fs = await import('node:fs')
  fs.writeFileSync(again.path, html)
  await openEditor(page, again.url)
  await expect(cards(page)).toHaveCount(2)
  expect((await docJson(page)).comments).toEqual((await docJson(page)).comments)
  expect((await docJson(page)).blocks[1].content[1]).toEqual({ text: '120 k€', comments: ['c1'] })
})
