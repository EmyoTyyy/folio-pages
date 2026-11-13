// Phase 4 : suivi des modifications, avec de vraies frappes (Chrome et Firefox).

import { expect, test, type Page } from '@playwright/test'
import { caretAfter, docJson, editor, makeFile, mod, openEditor, rb, selectText, tab, watchErrors } from './helpers'

const DOC = { format: 'folio/doc', version: 1, blocks: ['Le chat dort sur le canapé.', 'Second paragraphe.'] }

/** Le premier paragraphe, avec [+ajouts+] et [-suppressions-]. */
async function shown(page: Page, i = 0): Promise<string> {
  const d = await docJson(page)
  return (d.blocks[i].content as any[]).map((r) => (r.inserted ? `[+${r.text}+]` : r.deleted ? `[-${r.text}-]` : (r.text ?? '?'))).join('')
}

async function startTracking(page: Page) {
  await tab(page, 'review')
  await rb(page, 'track-toggle')
  const dialog = page.locator('[data-dialog="author-name"]')
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.locator('[data-field="author-name"]').fill('Noé Laurent')
    await dialog.locator('[data-action="ok"]').click()
  }
  await expect(page.locator('#fp-track')).toBeVisible()
}

test('taper et effacer avec le suivi : ajouts soulignés, suppressions barrées', async ({ page }, info) => {
  const errs = watchErrors(page)
  await openEditor(page, makeFile(info, 't.html', DOC).url)
  await startTracking(page)
  expect((await docJson(page)).trackChanges).toBe(true)
  await caretAfter(page, 'Le chat')
  await page.keyboard.type(' noir')
  expect(await shown(page)).toBe('Le chat[+ noir+] dort sur le canapé.')
  await expect(editor(page).locator('ins.fp-ins')).toHaveText(' noir')
  // Retour arrière sur du texte d'origine : il reste, barré ; on continue vers la gauche.
  await caretAfter(page, 'sur le')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace')
  expect(await shown(page)).toBe('Le chat[+ noir+] dort sur[- le-] canapé.')
  await expect(editor(page).locator('del.fp-del')).toHaveText(' le')
  // Taper à cet endroit : avant le texte barré.
  await page.keyboard.type('X')
  expect(await shown(page)).toBe('Le chat[+ noir+] dort sur[+X+][- le-] canapé.')
  // Effacer un ajout le retire vraiment.
  await page.keyboard.press('Backspace')
  expect(await shown(page)).toBe('Le chat[+ noir+] dort sur[- le-] canapé.')
  // Suppr : vers la droite.
  await caretAfter(page, 'canap')
  await page.keyboard.press('Delete')
  expect(await shown(page)).toBe('Le chat[+ noir+] dort sur[- le-] canap[-é-].')
  const d = await docJson(page)
  expect(d.blocks[0].content[1]).toMatchObject({ inserted: { author: 'Noé Laurent' } })
  errs.check()
})

test('remplacer une sélection, et annuler', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 't.html', { ...DOC, trackChanges: true }).url)
  await page.evaluate(() => localStorage.setItem('folio-pages:settings', JSON.stringify({ authorName: 'Sam' })))
  await selectText(page, 'chat')
  await page.keyboard.type('chien')
  expect(await shown(page)).toBe('Le [-chat-][+chien+] dort sur le canapé.')
  // Annuler défait la frappe et son suivi ensemble.
  await page.keyboard.press(`${mod}+z`)
  expect(await shown(page)).toBe('Le chat dort sur le canapé.')
})

test('accepter et refuser : sous le curseur, ou tout', async ({ page }, info) => {
  const errs = watchErrors(page)
  const blocks = [
    { content: ['Le ', { text: 'chat', deleted: { author: 'A', date: '2026-11-09T10:00:00Z' } }, { text: 'chien', inserted: { author: 'A', date: '2026-11-09T10:00:00Z' } }, ' dort.'] },
    { content: ['Il ', { text: 'ronfle', inserted: { author: 'B', date: '2026-11-09T11:00:00Z' } }, ' fort.'] },
  ]
  await openEditor(page, makeFile(info, 't.html', { format: 'folio/doc', version: 1, blocks }).url)
  await tab(page, 'review')
  await caretAfter(page, 'chi')
  await rb(page, 'track-accept')
  await page.locator('[data-track="accept-here"]').click()
  expect(await shown(page)).toBe('Le [-chat-]chien dort.')
  await rb(page, 'track-reject')
  await page.locator('[data-track="reject-all"]').click()
  expect(await shown(page)).toBe('Le chat chien dort.'.replace('chat chien', 'chatchien'))
  expect(await shown(page, 1)).toBe('Il  fort.')
  await page.keyboard.press(`${mod}+z`)
  expect(await shown(page, 1)).toBe('Il [+ronfle+] fort.')
  await rb(page, 'track-accept')
  await page.locator('[data-track="accept-all"]').click()
  expect(await shown(page, 1)).toBe('Il ronfle fort.')
  errs.check()
})

test('modification suivante, précédente ; affichage final et original', async ({ page }, info) => {
  const blocks = [{ content: ['un ', { text: 'deux', inserted: { author: 'A' } }, ' trois ', { text: 'quatre', deleted: { author: 'B' } }, ' cinq'] }]
  await openEditor(page, makeFile(info, 't.html', { format: 'folio/doc', version: 1, blocks }).url)
  await tab(page, 'review')
  await caretAfter(page, 'un')
  await rb(page, 'track-next')
  await rb(page, 'track-next')
  await rb(page, 'track-reject')
  await page.locator('[data-track="reject-here"]').click()
  expect(await shown(page)).toBe('un [+deux+] trois quatre cinq')
  await rb(page, 'track-view')
  await page.locator('[data-view="final"]').click()
  await expect(editor(page).locator('ins.fp-ins')).toHaveCSS('text-decoration-line', 'none')
  await rb(page, 'track-view')
  await page.locator('[data-view="original"]').click()
  await expect(editor(page).locator('ins.fp-ins')).toBeHidden()
  await rb(page, 'track-view')
  await page.locator('[data-view="all"]').click()
  await expect(editor(page).locator('ins.fp-ins')).toHaveCSS('text-decoration-line', 'underline')
})

test('le suivi et les modifications passent par le fichier ; on le coupe depuis la barre d’état', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 't.html', DOC).url)
  await startTracking(page)
  await caretAfter(page, 'Second')
  await page.keyboard.type(' et dernier')
  const html = await page.evaluate(() => (window as any).folio.serialize())
  const again = makeFile(info, 'relu.html', null)
  const fs = await import('node:fs')
  fs.writeFileSync(again.path, html)
  await openEditor(page, again.url)
  await expect(page.locator('#fp-track')).toBeVisible()
  expect(await shown(page, 1)).toBe('Second[+ et dernier+] paragraphe.')
  await page.locator('#fp-track').click()
  await expect(page.locator('#fp-track')).toBeHidden()
  await caretAfter(page, 'Le chat')
  await page.keyboard.type('!')
  expect(await shown(page)).toBe('Le chat\u202f! dort sur le canapé.')
})
