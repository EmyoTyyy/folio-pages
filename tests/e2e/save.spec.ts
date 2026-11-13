import { expect, test } from '@playwright/test'
import {
  caretToEnd,
  docOfFile,
  docText,
  editor,
  fsState,
  installFakeFs,
  makeFile,
  mod,
  openEditor,
  removeFsAccess,
  saveByDownload,
  status,
  watchErrors,
} from './helpers'

const existing = {
  format: 'folio/doc',
  version: 1,
  id: 'doc-test-0001',
  meta: { title: 'Rapport', created: '2026-01-01T00:00:00.000Z', modified: '2026-01-02T00:00:00.000Z' },
  blocks: [{ type: 'heading', text: 'Rapport' }, 'Premier paragraphe.'],
}

test.describe('enregistrement par téléchargement (Firefox, Safari)', () => {
  test.beforeEach(async ({ context }) => removeFsAccess(context))

  test('on ouvre, on écrit, on enregistre, on rouvre : le texte est là', async ({ page, context }, info) => {
    const errs = watchErrors(page)
    const f = makeFile(info, 'Rapport.html', existing)
    await openEditor(page, f.url)
    await caretToEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('Écrit pendant le test, avec des accents : été, ça, œuvre.')
    await expect(status(page)).toHaveText('Modifications non enregistrées')

    const saved = await saveByDownload(page, info, 'copie-1.html')
    expect(saved.suggested).toBe('Rapport.html')
    await expect(status(page)).toHaveText('Copie téléchargée')
    await expect(page.locator('.fp-toast')).toContainText('Copie téléchargée')

    // Le fichier enregistré est complet et propre.
    const doc = docOfFile(saved.html)
    expect(doc.id).toBe('doc-test-0001')
    expect(doc.meta.created).toBe('2026-01-01T00:00:00.000Z')
    expect(Date.parse(doc.meta.modified)).toBeGreaterThan(Date.parse('2026-01-02T00:00:00.000Z'))
    expect(saved.html).not.toMatch(/<[a-z]+\b[^<>]*\sdata-folio-transient/)
    expect(saved.html).not.toContain('id="folio-rt-style"')
    expect(saved.html).not.toContain('class="fp-app"')
    expect(saved.html).toContain('<title>Rapport — Folio Pages</title>')
    expect(saved.html).toContain('NOTICE: Folio Pages')
    expect(saved.html).toContain('AI AGENTS AND TOOLS')
    expect(saved.html).toContain('id="folio-splash"')

    // On rouvre la copie.
    const again = await context.newPage()
    await openEditor(again, saved.url)
    await expect(editor(again)).toContainText('Écrit pendant le test, avec des accents : été, ça, œuvre.')
    await expect(again.locator('#fp-banner')).toBeHidden()
    await expect(status(again)).toHaveText('Aucune modification')
    expect(await again.evaluate(() => (window as any).folio.doc.id)).toBe('doc-test-0001')

    // Deuxième tour : modification, enregistrement, réouverture.
    await caretToEnd(again)
    await again.keyboard.type(' Ajout du second tour.')
    const saved2 = await saveByDownload(again, info, 'copie-2.html')
    const third = await context.newPage()
    await openEditor(third, saved2.url)
    expect(await docText(third)).toContain('Écrit pendant le test')
    expect(await docText(third)).toContain('Ajout du second tour.')
    errs.check()
  })

  test('enregistrer plusieurs fois ne fait pas grossir le fichier', async ({ page }, info) => {
    const f = makeFile(info, 'stable.html', existing)
    await openEditor(page, f.url)
    await caretToEnd(page)
    await page.keyboard.type('x')
    const a = await saveByDownload(page, info, 'a.html')
    const b = await saveByDownload(page, info, 'b.html')
    expect(Math.abs(a.html.length - b.html.length)).toBeLessThan(5)
    const c = await saveByDownload(page, info, 'c.html')
    expect(Math.abs(b.html.length - c.html.length)).toBeLessThan(5)
  })

  test('le titre donne le nom du fichier et l’onglet', async ({ page }, info) => {
    const f = makeFile(info, 'vide.html', { format: 'folio/doc', version: 1, blocks: [] })
    await openEditor(page, f.url)
    await page.locator('#fp-title').fill('Budget 2026 : version / finale?')
    await expect(page).toHaveTitle('Budget 2026 : version / finale? — Folio Pages')
    await editor(page).click()
    await page.keyboard.type('Contenu')
    // Fichier ouvert sous un nom : on propose ce nom (on réécrit le fichier ouvert).
    const saved = await saveByDownload(page, info, 'titre.html')
    expect(saved.suggested).toBe('vide.html')
    expect(docOfFile(saved.html).meta.title).toBe('Budget 2026 : version / finale?')
  })

  test('depuis l’application vide, le nom proposé vient du titre', async ({ page }, info) => {
    const f = makeFile(info, 'folio-pages.html')
    await openEditor(page, f.url)
    await page.locator('#fp-new-blank').click()
    await page.locator('#fp-title').fill('Notes : réunion/projet')
    await editor(page).click()
    await page.keyboard.type('Texte')
    const saved = await saveByDownload(page, info, 'notes.html')
    expect(saved.suggested).toBe('Notes réunion projet.html')
  })

  test('un texte qui ressemble à du HTML reste du texte, dans le fichier aussi', async ({ page, context }, info) => {
    const dialogs: string[] = []
    page.on('dialog', (d) => (dialogs.push(d.message()), d.dismiss()))
    const f = makeFile(info, 'html.html', existing)
    await openEditor(page, f.url)
    await caretToEnd(page)
    const nasty = '</script><script>alert(1)</script><!-- --> <img src=x onerror=alert(2)> ${x} ]]>'
    await page.keyboard.type(nasty)
    const saved = await saveByDownload(page, info, 'html-copie.html')
    expect(saved.html).not.toContain('<script>alert(1)')
    const again = await context.newPage()
    again.on('dialog', (d) => (dialogs.push(d.message()), d.dismiss()))
    await openEditor(again, saved.url)
    expect(await docText(again)).toContain(nasty)
    await expect(again.locator('.fp-prose img')).toHaveCount(0)
    expect(dialogs).toEqual([])
  })
})

test.describe('enregistrement dans le fichier (Chrome, Edge)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'API File System Access')
  test.beforeEach(async ({ page }) => installFakeFs(page))

  test('le premier enregistrement demande où, les suivants réécrivent le même fichier', async ({ page }, info) => {
    const f = makeFile(info, 'Rapport.html', existing)
    await openEditor(page, f.url)
    await caretToEnd(page)
    await page.keyboard.type(' Un.')
    await page.keyboard.press(`${mod}+s`)
    await expect(status(page)).toHaveText('Enregistré dans « Rapport.html »')
    await page.keyboard.type(' Deux.')
    await expect(status(page)).toHaveText('Modifications non enregistrées')
    await page.locator('#fp-save').click()
    await expect(status(page)).toHaveText('Enregistré dans « Rapport.html »')
    const fs = await fsState(page)
    expect(fs.pickerCalls).toEqual([{ suggestedName: 'Rapport.html' }])
    expect(fs.writes).toHaveLength(2)
    expect(docOfFile(fs.writes[1].text).blocks[1].content[0].text).toBe('Premier paragraphe. Un. Deux.')
  })

  test('annuler le choix du fichier ne change rien', async ({ page }, info) => {
    const errs = watchErrors(page)
    const f = makeFile(info, 'annule.html', existing)
    await openEditor(page, f.url)
    await caretToEnd(page)
    await page.keyboard.type('!')
    await page.evaluate(() => ((window as any).__fs.mode = 'abort'))
    await page.keyboard.press(`${mod}+s`)
    await expect(status(page)).toHaveText('Modifications non enregistrées')
    await expect(page.locator('.fp-toast--error')).toHaveCount(0)
    errs.check()
  })

  test('un fichier modifié par un autre programme n’est pas écrasé sans accord', async ({ page }, info) => {
    const f = makeFile(info, 'conflit.html', existing)
    await openEditor(page, f.url)
    await caretToEnd(page)
    await page.keyboard.type(' A')
    await page.keyboard.press(`${mod}+s`)
    await expect(status(page)).toHaveText('Enregistré dans « conflit.html »')
    // Un autre programme modifie le fichier.
    await page.evaluate(() => {
      const fs = (window as any).__fs
      fs.files['conflit.html'] = { text: 'autre contenu', lastModified: Date.now() + 60_000 }
    })
    await page.keyboard.type(' B')
    await page.keyboard.press(`${mod}+s`)
    const dlg = page.locator('dialog[data-dialog="conflict"]')
    await expect(dlg).toBeVisible()
    await dlg.locator('[data-action="cancel"]').click()
    await expect(status(page)).toHaveText('Modifications non enregistrées')
    expect((await fsState(page)).writes).toHaveLength(1)
    await page.keyboard.press(`${mod}+s`)
    await dlg.locator('[data-action="overwrite"]').click()
    await expect(status(page)).toHaveText('Enregistré dans « conflit.html »')
    expect((await fsState(page)).writes).toHaveLength(2)
  })

  test('une autorisation refusée est signalée, et l’on peut réessayer', async ({ page }, info) => {
    const f = makeFile(info, 'refus.html', existing)
    await openEditor(page, f.url)
    await caretToEnd(page)
    await page.keyboard.type(' A')
    await page.keyboard.press(`${mod}+s`)
    await expect(status(page)).toHaveText('Enregistré dans « refus.html »')
    await page.evaluate(() => {
      const fs = (window as any).__fs
      fs.permission = 'prompt'
      fs.requestAnswer = 'denied'
    })
    await page.keyboard.type(' B')
    await page.keyboard.press(`${mod}+s`)
    await expect(page.locator('.fp-toast--error')).toContainText('autorisation')
    await expect(status(page)).toHaveText('Échec de l’enregistrement')
    await page.evaluate(() => ((window as any).__fs.requestAnswer = 'granted'))
    await page.keyboard.press(`${mod}+s`)
    await expect(status(page)).toHaveText('Enregistré dans « refus.html »')
  })

  test('une écriture qui échoue garde les modifications et le dit', async ({ page }, info) => {
    const f = makeFile(info, 'echec.html', existing)
    await openEditor(page, f.url)
    await caretToEnd(page)
    await page.keyboard.type(' A')
    await page.evaluate(() => ((window as any).__fs.mode = 'fail-write'))
    await page.keyboard.press(`${mod}+s`)
    await expect(page.locator('.fp-toast--error')).toContainText('disque plein')
    await expect(status(page)).toHaveText('Échec de l’enregistrement')
    await page.keyboard.type('B')
    await expect(status(page)).toHaveText('Modifications non enregistrées')
    await page.evaluate(() => ((window as any).__fs.mode = 'ok'))
    await page.keyboard.press(`${mod}+s`)
    await expect(status(page)).toHaveText(/Enregistré/)
  })
})

test('quitter avec des modifications non enregistrées demande confirmation', async ({ page }, info) => {
  const f = makeFile(info, 'quitter.html', existing)
  await openEditor(page, f.url)
  await caretToEnd(page)
  await page.keyboard.type(' modifié')
  const dialog = page.waitForEvent('dialog')
  void page.close({ runBeforeUnload: true })
  const d = await dialog
  expect(d.type()).toBe('beforeunload')
  await d.dismiss()
})
