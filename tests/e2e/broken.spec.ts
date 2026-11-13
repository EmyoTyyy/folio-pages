// Ouverture robuste : JSON illisible, document chiffré, contenu étranger.

import { expect, test } from '@playwright/test'
import { docOfFile, editor, makeFile, openApp, openEditor, removeFsAccess, saveByDownload, status, watchErrors } from './helpers'

const BROKEN = `{
  "format": "folio/doc",
  "version": 1,
  "id": "broken-doc-42",
  "meta": { "title": "Mémoire de stage" },
  "blocks": [
    { "type": "heading", "text": "Introduction" },
    { "text": "Le stage s’est déroulé au laboratoire." }
    { "text": "Une virgule manque juste avant cette ligne." }
  ]
}`

test('JSON illisible : l’erreur et sa ligne, et le contenu n’est pas perdu', async ({ page, context }, info) => {
  await removeFsAccess(context)
  const errs = watchErrors(page)
  const f = makeFile(info, 'casse.html', BROKEN)
  await openApp(page, f.url)
  const screen = page.locator('[data-screen="broken"]')
  await expect(screen).toBeVisible()
  await expect(screen).toContainText('ligne 9, colonne 5')
  await expect(screen).toContainText('virgule manquante')
  expect(await page.evaluate(() => (window as any).folio)).toMatchObject({ refused: true, reason: 'json' })
  await expect(page.locator('#folio-splash')).toHaveCount(0)

  // Voir le contenu brut.
  await screen.locator('[data-action="raw"]').click()
  const raw = page.locator('dialog[data-dialog="raw"] textarea')
  await expect(raw).toHaveValue(/Une virgule manque/)
  await page.keyboard.press('Escape')

  // Récupérer le texte.
  await screen.locator('[data-action="recover"]').click()
  await expect(screen).toHaveCount(0)
  await expect(editor(page)).toContainText('Introduction')
  await expect(editor(page)).toContainText('Le stage s’est déroulé au laboratoire.')
  await expect(editor(page)).toContainText('Une virgule manque juste avant cette ligne.')
  await expect(page.locator('#fp-title')).toHaveValue('Mémoire de stage')
  await expect(status(page)).toHaveText('Modifications non enregistrées')
  await expect(page.locator('.fp-toast')).toContainText('récupérés')

  // L'identité est conservée et le fichier enregistré est de nouveau sain.
  const saved = await saveByDownload(page, info, 'repare.html')
  const doc = docOfFile(saved.html)
  expect(doc.id).toBe('broken-doc-42')
  const again = await context.newPage()
  await openEditor(again, saved.url)
  await expect(editor(again)).toContainText('Une virgule manque')
  errs.check()
})

test('JSON illisible : on peut repartir d’un document vide', async ({ page }, info) => {
  const f = makeFile(info, 'casse2.html', '{"blocks": [')
  await openApp(page, f.url)
  await expect(page.locator('[data-screen="broken"]')).toContainText('le texte s’arrête trop tôt')
  await page.locator('[data-action="blank"]').click()
  await expect(editor(page)).toBeVisible()
  await expect(editor(page)).toHaveText('')
})

test('JSON avec virgules en trop et commentaires : réparé et ouvert', async ({ page }, info) => {
  const f = makeFile(info, 'virgules.html', '{\n  // commentaire\n  "format": "folio/doc", "version": 1,\n  "blocks": ["un", "deux",],\n}')
  await openEditor(page, f.url)
  await expect(editor(page).locator('p')).toHaveCount(2)
  await expect(page.locator('#fp-report')).toContainText('1 avertissement')
})

test('un document chiffré demande son mot de passe ; une enveloppe abîmée est refusée, laissée intacte', async ({ page }, info) => {
  // Enveloppe bien formée : l'écran de déverrouillage (phase 7).
  const f = makeFile(info, 'chiffre.html', { format: 'folio/enc', v: 1, salt: 'AAAA', iv: 'BBBB', data: 'CCCC' })
  await openApp(page, f.url)
  await expect(page.locator('#fp-unlock-password')).toBeVisible()
  expect(await page.evaluate(() => (window as any).folio)).toMatchObject({ locked: true })
  await expect(page.locator('.fp-prose')).toHaveCount(0)
  // Données qui ne se déchiffrent pas : « mot de passe incorrect », rien d'autre.
  await page.locator('#fp-unlock-password').fill('peu importe')
  await page.locator('[data-action="unlock"]').click()
  await expect(page.locator('#fp-unlock-error')).not.toBeEmpty()
  await expect(page.locator('.fp-prose')).toHaveCount(0)
  // Enveloppe abîmée (pas du base64) : refusée clairement.
  const g = makeFile(info, 'abime.html', { format: 'folio/enc', v: 1, salt: '!!', iv: 'BBBB', data: 'CCCC' })
  await openApp(page, g.url)
  await expect(page.locator('[data-screen="encrypted"]')).toContainText('Document protégé par un mot de passe')
  expect(await page.evaluate(() => (window as any).folio)).toMatchObject({ refused: true, reason: 'encrypted' })
  await expect(page.locator('.fp-prose')).toHaveCount(0)
})

test('un contenu qui n’est pas un document est refusé clairement', async ({ page }, info) => {
  const f = makeFile(info, 'nombre.html', '42')
  await openApp(page, f.url)
  await expect(page.locator('[data-screen="not-a-document"]')).toContainText('Ce n’est pas un document Folio Pages')
  await page.locator('[data-action="raw"]').click()
  await expect(page.locator('dialog[data-dialog="raw"] textarea')).toHaveValue('42')
})
