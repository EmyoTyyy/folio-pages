// Aller-retour avec une IA depuis l'interface : copier le JSON, remplacer depuis le JSON.

import { expect, test, type Page } from '@playwright/test'
import { docJson, editor, makeFile, mod, openEditor, status, watchErrors } from './helpers'

const start = {
  format: 'folio/doc',
  version: 1,
  id: 'json-ui-doc-1',
  meta: { title: 'Avant' },
  blocks: [{ type: 'heading', text: 'Avant' }, { md: 'Texte **initial**.' }],
}

/** Une commande d'un onglet du ruban (les commandes pour les IA sont dans l'onglet IA). */
async function menu(page: Page, tabId: string, cmd: string) {
  await page.locator(`.fp-ribbon__tab[data-tab="${tabId}"]`).click()
  await page.locator(`.fp-ribbon [data-cmd="${cmd}"]`).first().click()
}

/** Remplace window.navigator.clipboard par un faux qui garde le texte. */
async function fakeClipboard(page: Page, works = true) {
  await page.addInitScript((ok) => {
    const store = { text: '' }
    ;(window as any).__clip = store
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (t: string) => {
          if (!ok) throw new DOMException('refusé', 'NotAllowedError')
          store.text = t
        },
      },
    })
    if (!ok) document.execCommand = () => false
  }, works)
}

test('copier le JSON du document, complet puis compact', async ({ page }, info) => {
  await fakeClipboard(page)
  const f = makeFile(info, 'copie.html', start)
  await openEditor(page, f.url)
  await menu(page, 'ai', 'copy-json')
  await expect(page.locator('.fp-toast')).toContainText('JSON du document copié')
  const full = JSON.parse(await page.evaluate(() => (window as any).__clip.text))
  expect(full).toEqual(await docJson(page))
  expect(full.id).toBe('json-ui-doc-1')

  await menu(page, 'ai', 'copy-compact')
  await expect(page.locator('.fp-toast').last()).toContainText('collez-le dans votre conversation')
  const compactText = await page.evaluate(() => (window as any).__clip.text)
  const compact = JSON.parse(compactText)
  expect(compact.id).toBeUndefined()
  expect(compact.blocks[0]).toEqual({ type: 'heading', text: 'Avant' })
  expect(compactText.length).toBeLessThan(JSON.stringify(full, null, 2).length)
})

test('sans presse-papiers, le texte est proposé à copier soi-même', async ({ page }, info) => {
  await fakeClipboard(page, false)
  const f = makeFile(info, 'sans-presse-papiers.html', start)
  await openEditor(page, f.url)
  await menu(page, 'ai', 'copy-json')
  const area = page.locator('dialog[data-dialog="manual-copy"] textarea')
  await expect(area).toBeVisible()
  expect(JSON.parse(await area.inputValue()).id).toBe('json-ui-doc-1')
})

test('remplacer depuis le JSON, puis annuler et rétablir', async ({ page }, info) => {
  const errs = watchErrors(page)
  const f = makeFile(info, 'remplacer.html', start)
  await openEditor(page, f.url)
  await menu(page, 'ai', 'replace-json')
  const dlg = page.locator('dialog[data-dialog="replace-json"]')
  await dlg.locator('textarea').fill(
    JSON.stringify({ format: 'folio/doc', version: 1, id: 'autre-identite', meta: { title: 'Après' }, blocks: [{ type: 'heading', text: 'Après' }, { type: 'list', items: ['un', 'deux'] }] }),
  )
  await dlg.locator('[data-action="replace"]').click()
  await expect(dlg).toHaveCount(0)
  await expect(editor(page).locator('h1')).toHaveText('Après')
  await expect(editor(page).locator('li')).toHaveCount(2)
  await expect(page.locator('#fp-title')).toHaveValue('Après')
  await expect(page).toHaveTitle('Après — Folio Pages')
  await expect(status(page)).toHaveText('Modifications non enregistrées')
  // L'identité du fichier ne change pas.
  expect((await docJson(page)).id).toBe('json-ui-doc-1')

  await editor(page).click()
  await page.keyboard.press(`${mod}+z`)
  await expect(editor(page).locator('h1')).toHaveText('Avant')
  await expect(page.locator('#fp-title')).toHaveValue('Avant')
  await expect(status(page)).toHaveText('Aucune modification')
  await page.keyboard.press(`${mod}+y`)
  await expect(editor(page).locator('h1')).toHaveText('Après')
  errs.check()
})

test('un JSON invalide est refusé avec sa ligne, sans toucher au document', async ({ page }, info) => {
  const f = makeFile(info, 'invalide.html', start)
  await openEditor(page, f.url)
  await menu(page, 'ai', 'replace-json')
  const dlg = page.locator('dialog[data-dialog="replace-json"]')
  await dlg.locator('[data-action="replace"]').click()
  await expect(dlg.locator('#fp-replace-error')).toHaveText('Collez d’abord un JSON.')
  await dlg.locator('textarea').fill('{\n  "blocks": [\n    "a"\n    "b"\n  ]\n}')
  await dlg.locator('[data-action="replace"]').click()
  await expect(dlg.locator('#fp-replace-error')).toContainText('ligne 4, colonne 5')
  await dlg.locator('textarea').fill('{"format":"folio/enc","data":"x"}')
  await dlg.locator('[data-action="replace"]').click()
  await expect(dlg.locator('#fp-replace-error')).toContainText('chiffré')
  await dlg.locator('textarea').fill('[1, 2')
  await dlg.locator('[data-action="replace"]').click()
  await expect(dlg.locator('#fp-replace-error')).toContainText('JSON invalide')
  await page.keyboard.press('Escape')
  await expect(editor(page).locator('h1')).toHaveText('Avant')
  await expect(status(page)).toHaveText('Aucune modification')
})

test('un JSON maladroit est accepté avec un rapport', async ({ page }, info) => {
  const f = makeFile(info, 'maladroit.html', start)
  await openEditor(page, f.url)
  await menu(page, 'ai', 'replace-json')
  const dlg = page.locator('dialog[data-dialog="replace-json"]')
  await dlg.locator('textarea').fill('{"blocks": [{"type": "h2", "text": "Titre"}, {"texte": "faute de frappe"}],}')
  await dlg.locator('[data-action="replace"]').click()
  const toast = page.locator('.fp-toast').last()
  await expect(toast).toContainText('Document remplacé')
  await expect(toast).toContainText('1 champ ignoré')
  await toast.locator('.fp-toast__action').click()
  await expect(page.locator('dialog[data-dialog="report"]')).toContainText('champ inconnu « texte »')
  await expect(page.locator('#fp-report')).toBeVisible()
})

test('le guide pour demander un document à une IA', async ({ page }, info) => {
  await fakeClipboard(page)
  const f = makeFile(info, 'aide-ia.html', start)
  await openEditor(page, f.url)
  await menu(page, 'ai', 'ai-help')
  const dlg = page.locator('dialog[data-dialog="ai-help"]')
  await expect(dlg).toContainText('Envoyez ce fichier .html à une IA')
  await dlg.locator('[data-action="copy"]').click()
  await expect(dlg).toBeVisible() // la fenêtre reste ouverte
  expect(await page.evaluate(() => (window as any).__clip.text)).toContain('folio-doc')
})
