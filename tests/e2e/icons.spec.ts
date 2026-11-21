// Insertion → Icônes : jeu intégré (recherche, couleur), recherche en ligne
// (réponses simulées, contenu nettoyé), mode hors ligne.

import { expect, test, type Page } from '@playwright/test'
import { docJson, editor, makeFile, openEditor, rb, tab, watchErrors } from './helpers'

const DOC = { format: 'folio/doc', version: 1, meta: { title: 'Icônes', lang: 'fr' }, blocks: ['Texte.'] }
const svgOf = async (page: Page, i = 0) => {
  const d = await docJson(page)
  const img = d.blocks.filter((b: { type: string }) => b.type === 'image')[i]
  const uri: string = img.src.startsWith('asset:') ? d.assets[img.src.slice(6)] : img.src
  return { img, svg: Buffer.from(uri.split(',')[1], 'base64').toString('utf8') }
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
  })
})

test('jeu intégré : chercher en français, choisir une couleur, insérer (image SVG avec son nom)', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'i.html', DOC).url)
  await tab(page, 'insert')
  await rb(page, 'insert-icons')
  const dlg = page.locator('[data-dialog="icons"]')
  await expect(dlg.locator('.fp-icons__btn').first()).toBeVisible()
  expect(await dlg.locator('[data-field="icons"] .fp-icons__btn').count()).toBe(90)
  await dlg.locator('[data-field="icon-search"]').fill('coeur')
  await expect(dlg.locator('[data-field="icons"] .fp-icons__btn')).toHaveCount(1)
  await expect(dlg.locator('[data-icon="heart"]')).toHaveAttribute('aria-label', 'cœur')
  // Couleur : la première couleur du thème (accent).
  await dlg.locator('.fp-icons__color summary').click()
  await dlg.locator('.fp-icons__color [data-color="accent1"]').click()
  await dlg.locator('[data-icon="heart"]').click()
  await expect(dlg).toHaveCount(0)
  await expect(editor(page).locator('.fp-figure img')).toBeVisible()
  const { img, svg } = await svgOf(page)
  expect(img).toMatchObject({ alt: 'cœur', width: 48 })
  const accent = await page.evaluate(() => (window as any).folio.doc.theme.colors.accent1)
  expect(svg).toContain(`color="${accent.toLowerCase()}"`)
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"/)
  errors.check()
})

test('en ligne : résultats d’Iconify, nettoyés (ni script, ni attribut d’événement, ni lien)', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'i.html', DOC).url)
  const CORS = { 'access-control-allow-origin': '*' }
  await page.route(/api\.iconify\.design\/search/, (r) => r.fulfill({ status: 200, body: JSON.stringify({ icons: ['tabler:cat', 'tabler:dog', 'autre:ignoree'] }), headers: { ...CORS, 'content-type': 'application/json' } }))
  await page.route(/api\.iconify\.design\/tabler\/cat\.svg/, (r) =>
    r.fulfill({ status: 200, body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script><path onload="alert(2)" fill="none" stroke="currentColor" d="M3 3h18"/><a href="javascript:alert(3)"><path d="M1 1"/></a><image href="https://x.org/a.png"/></svg>', headers: { ...CORS, 'content-type': 'image/svg+xml' } }),
  )
  await page.route(/api\.iconify\.design\/tabler\/dog\.svg/, (r) => r.fulfill({ status: 200, body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/></svg>', headers: { ...CORS, 'content-type': 'image/svg+xml' } }))
  await tab(page, 'insert')
  await rb(page, 'insert-icons')
  const dlg = page.locator('[data-dialog="icons"]')
  await dlg.locator('[data-field="icon-search"]').fill('cat')
  await dlg.locator('[data-action="icons-online"]').click()
  await expect(dlg.locator('[data-field="icons-online"] .fp-icons__btn')).toHaveCount(2)
  await dlg.locator('[data-icon="tabler:cat"]').click()
  const { img, svg } = await svgOf(page)
  expect(img.alt).toBe('cat')
  expect(svg).toContain('<path fill="none" stroke="currentColor" d="M3 3h18"/>')
  expect(svg).not.toMatch(/script|onload|href|javascript|<a|<image/)
})

test('mode hors ligne : la recherche en ligne est désactivée, rien ne part sur le réseau', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false, offline: true })))
  await openEditor(page, makeFile(info, 'i.html', DOC).url)
  const remote: string[] = []
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) remote.push(r.url())
  })
  await tab(page, 'insert')
  await rb(page, 'insert-icons')
  const dlg = page.locator('[data-dialog="icons"]')
  await expect(dlg.locator('[data-action="icons-online"]')).toBeDisabled()
  await expect(dlg).toContainText('Mode hors ligne')
  await dlg.locator('[data-field="icon-search"]').fill('chat')
  await dlg.locator('[data-field="icon-search"]').press('Enter')
  await page.waitForTimeout(300)
  expect(remote).toEqual([])
})
