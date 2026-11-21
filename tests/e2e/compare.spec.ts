// Révision → Comparer : avec un fichier (version précédente) ou une version
// enregistrée ; le résultat s'ouvre dans un nouvel onglet, en modifications suivies.

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { blocks, caretAfter, chooseFile, editor, makeFile, openEditor, rb, tab, watchErrors } from './helpers'

const doc = (b: unknown[], title = 'Contrat') => ({ format: 'folio/doc', version: 1, meta: { title, lang: 'fr' }, blocks: b })
const NEW = doc([{ type: 'heading', level: 1, text: 'Contrat de location' }, 'Le loyer est de 900 euros par mois.', 'Le bail dure trois ans.', 'Signé à Lyon.'])
const OLD = doc([{ type: 'heading', level: 1, text: 'Contrat de location' }, 'Le loyer est de 850 euros par mois.', 'Le dépôt de garantie est d’un mois.', 'Le bail dure trois ans.'], 'Contrat v1')

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false, authorName: 'Ana' }))
  })
})

/** Le document ouvert dans le nouvel onglet. */
async function resultOf(page: Page, trigger: () => Promise<void>) {
  const [tabPage] = await Promise.all([page.context().waitForEvent('page'), trigger()])
  await tabPage.waitForFunction(() => !!(window as any).folio?.doc)
  return { tab: tabPage, doc: await tabPage.evaluate(() => JSON.parse(JSON.stringify((window as any).folio.doc))) }
}
const shown = (content: { text?: string; inserted?: unknown; deleted?: unknown }[]) => content.map((r) => (r.inserted ? `[+${r.text}+]` : r.deleted ? `[-${r.text}-]` : r.text)).join('')

test('avec un fichier : le résultat, dans un nouvel onglet, montre les différences ; ce document ne change pas', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'contrat.html', NEW).url)
  const before = JSON.stringify(await blocks(page))
  const old = makeFile(info, 'contrat-v1.html', OLD)
  await tab(page, 'review')
  await rb(page, 'compare')
  const { tab: result, doc: d } = await resultOf(page, () => chooseFile(page, () => page.locator('[data-popover] [data-item="compare-file"]').click(), { name: 'contrat-v1.html', mimeType: 'text/html', buffer: readFileSync(old.path) }))
  expect(d.trackChanges).toBe(true)
  expect(d.meta.title).toBe('Contrat (comparé à contrat-v1.html)')
  expect(d.id).not.toBe(await page.evaluate(() => (window as any).folio.doc.id))
  expect(d.blocks.map((b: { content?: never[] }) => (b.content ? shown(b.content) : ''))).toEqual([
    'Contrat de location',
    'Le loyer est de [-850-][+900+] euros par mois.',
    '[-Le dépôt de garantie est d’un mois.-]',
    'Le bail dure trois ans.',
    '[+Signé à Lyon.+]',
  ])
  expect(d.blocks[1].content.find((r: { inserted?: { author: string } }) => r.inserted).inserted.author).toBe('Ana')
  // Le résultat s'ouvre avec le suivi activé, et ses marques se voient.
  await expect(result.locator('.fp-prose .fp-del').first()).toBeVisible()
  await expect(page.locator('.fp-toast').filter({ hasText: /nouvel onglet/ })).toContainText('2 insertions')
  expect(JSON.stringify(await blocks(page))).toBe(before)
  errors.check()
})

test('avec une version enregistrée de ce navigateur', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'contrat.html', NEW).url)
  // Garder la version actuelle, puis changer le texte.
  await page.evaluate(() => (window as any).folio)
  await page.locator('.fp-menubar__top').first().click()
  await page.locator('[data-item="versions"]').click()
  await page.locator('[data-dialog="versions"] [data-action="keep-version"]').click()
  await page.keyboard.press('Escape')
  await caretAfter(page, 'Signé à Lyon')
  await page.keyboard.type(', le 3 mars')
  await tab(page, 'review')
  await rb(page, 'compare')
  await page.locator('[data-popover] [data-item="compare-version"]').click()
  const dlg = page.locator('[data-dialog="compare-versions"]')
  await expect(dlg.locator('[data-action="compare-version"]')).toHaveCount(1)
  const { doc: d } = await resultOf(page, () => dlg.locator('[data-action="compare-version"]').click())
  expect(shown(d.blocks[3].content)).toBe('Signé à Lyon[+, le 3 mars+].')
})

test('rien de différent : on le dit, aucun onglet ne s’ouvre', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'contrat.html', NEW).url)
  const same = makeFile(info, 'pareil.html', NEW)
  let opened = 0
  page.context().on('page', () => opened++)
  await tab(page, 'review')
  await rb(page, 'compare')
  await chooseFile(page, () => page.locator('[data-popover] [data-item="compare-file"]').click(), { name: 'pareil.html', mimeType: 'text/html', buffer: readFileSync(same.path) })
  await expect(page.locator('.fp-toast').filter({ hasText: /Aucune différence/ })).toBeVisible()
  expect(opened).toBe(0)
  await expect(editor(page)).toBeVisible()
})
