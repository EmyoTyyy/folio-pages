// Phase 4 : ouvrir un fichier (Ctrl+O), fichiers récents, fichiers reconnus.

import { expect, test, type Page } from '@playwright/test'
import { blankHtml, docJson, docOfFile, editor, fsState, installFakeFs, makeFile, mod, openEditor, watchErrors } from './helpers'
import { spliceDocBlock } from '../../src/file/shell'

const doc = (id: string, title: string, text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: 'folio/doc', version: 1, id, meta: { title }, blocks: [text], ...extra })
const folioFile = (json: string) => spliceDocBlock(blankHtml(), json)!

/** Sélecteur d'ouverture simulé (Chrome) : les fichiers de window.__fs.files, le prochain nom dans __openNext. */
async function fakeOpenPicker(page: Page) {
  await installFakeFs(page)
  await page.addInitScript(() => {
    const fs = (window as any).__fs
    ;(window as any).showOpenFilePicker = async () => {
      const name = (window as any).__openNext
      if (!name) throw new DOMException('annulé', 'AbortError')
      fs.openCalls = (fs.openCalls ?? 0) + 1
      const handle: any = {
        kind: 'file',
        name,
        async getFile() {
          const f = fs.files[name]
          return new File([f.text], name, { lastModified: f.lastModified })
        },
        async queryPermission() {
          return 'granted'
        },
        async requestPermission() {
          return 'granted'
        },
        async createWritable() {
          let buf = ''
          return {
            async write(d: Blob) {
              buf += await d.text()
            },
            async close() {
              fs.files[name] = { text: buf, lastModified: Date.now() }
              fs.writes.push({ name, text: buf })
            },
          }
        },
      }
      return [handle]
    }
  })
}

async function putFile(page: Page, name: string, text: string) {
  await page.evaluate(([n, t]) => {
    ;(window as any).__fs.files[n] = { text: t, lastModified: Date.now() - 5000 }
    ;(window as any).__openNext = n
  }, [name, text] as const)
}

test('Ctrl+O ouvre un document Folio Pages ; Ctrl+S le réécrit en place ; il rejoint les fichiers récents', async ({ page }, info) => {
  const errs = watchErrors(page)
  await fakeOpenPicker(page)
  await openEditor(page, makeFile(info, 'courant.html', JSON.parse(doc('courant-0001', 'Courant', 'Texte courant.'))).url)
  await putFile(page, 'rapport.html', folioFile(doc('rapport-0001', 'Rapport', 'Contenu du rapport.')))
  await page.keyboard.press(`${mod}+o`)
  await expect(page.locator('.fp-toast').last()).toContainText('rapport.html')
  const d = await docJson(page)
  expect(d.id).toBe('rapport-0001')
  expect(d.blocks[0].content[0].text).toBe('Contenu du rapport.')
  await expect(page.locator('#fp-title')).toHaveValue('Rapport')
  await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'pristine')
  // Annuler ne ramène pas l'ancien document.
  await editor(page).click()
  await page.keyboard.press(`${mod}+z`)
  expect((await docJson(page)).blocks[0].content[0].text).toBe('Contenu du rapport.')
  // Enregistrer réécrit le fichier ouvert, sans rien demander.
  await page.keyboard.press('End')
  await page.keyboard.type(' Ajout.')
  await page.keyboard.press(`${mod}+s`)
  await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'saved')
  const fs = await fsState(page)
  expect(fs.pickerCalls).toEqual([])
  expect(fs.writes.map((w: any) => w.name)).toEqual(['rapport.html'])
  expect(docOfFile(fs.writes[0].text).blocks[0].content[0].text).toBe('Contenu du rapport. Ajout.')
  // Fichiers récents : il y est ; on le rouvre de là.
  await page.locator('[data-menu="file"]').click()
  await page.locator('[data-menu-popup="file"] [data-item="open-recent"]').click()
  const row = page.locator('[data-dialog="recent"] [data-recent="rapport-0001"]')
  await expect(row).toContainText('rapport.html')
  await row.locator('[data-action="open-recent"]').click()
  expect((await docJson(page)).id).toBe('rapport-0001')
  errs.check()
})

test('modifications non enregistrées : on propose d’enregistrer, de ne pas enregistrer ou d’annuler', async ({ page }, info) => {
  await fakeOpenPicker(page)
  await openEditor(page, makeFile(info, 'courant.html', JSON.parse(doc('courant-0001', 'Courant', 'Texte courant.'))).url)
  await editor(page).click()
  await page.keyboard.type('modifié ')
  await putFile(page, 'autre.html', folioFile(doc('autre-00001', 'Autre', 'Autre texte.')))
  await page.keyboard.press(`${mod}+o`)
  await expect(page.locator('[data-dialog="save-first"]')).toBeVisible()
  await page.locator('[data-dialog="save-first"] [data-action="cancel"]').click()
  expect((await docJson(page)).id).toBe('courant-0001')
  await page.keyboard.press(`${mod}+o`)
  await page.locator('[data-dialog="save-first"] [data-action="discard"]').click()
  await expect.poll(async () => (await docJson(page)).id).toBe('autre-00001')
})

test('reconnaît ce qui n’est pas un document, et le dit', async ({ page }, info) => {
  await fakeOpenPicker(page)
  await openEditor(page, makeFile(info, 'courant.html', JSON.parse(doc('courant-0001', 'Courant', 'Texte courant.'))).url)
  const cases: [string, string, RegExp][] = [
    ['vide.html', blankHtml(), /application Folio Pages vide/],
    ['abime-secret.html', folioFile('{"format":"folio/enc","v":1,"salt":"!!","iv":"b","data":"c"}'), /mot de passe/],
    ['page.html', '<!doctype html><html><body><p>Bonjour</p></body></html>', /n’est pas un document Folio Pages/],
    ['abime.html', folioFile('{"format": "folio/doc", "blocks": [1,,]}'), /illisible \(ligne 1\)/],
    ['slides.html', '<!doctype html><script type="application/bento+json" id="bento-doc">{}</script>', /présentation Bento/],
  ]
  for (const [name, text, msg] of cases) {
    await putFile(page, name, text)
    await page.keyboard.press(`${mod}+o`)
    await expect(page.locator('.fp-toast').last()).toContainText(msg)
    expect((await docJson(page)).id).toBe('courant-0001')
  }
  // Un document protégé (enveloppe bien formée) : le mot de passe est demandé ; Annuler ne change rien.
  await putFile(page, 'secret.html', folioFile('{"format":"folio/enc","v":1,"salt":"AAAA","iv":"BBBB","data":"CCCC"}'))
  await page.keyboard.press(`${mod}+o`)
  const dlg = page.locator('[data-dialog="open-password"]')
  await expect(dlg).toContainText('secret.html')
  await dlg.locator('[data-action="cancel"]').click()
  expect((await docJson(page)).id).toBe('courant-0001')
})

test('importer du Markdown ou du texte : un nouveau document, qui s’enregistre en .html', async ({ page }, info) => {
  await fakeOpenPicker(page)
  await openEditor(page, makeFile(info, 'courant.html', JSON.parse(doc('courant-0001', 'Courant', 'Texte courant.'))).url)
  await putFile(page, 'notes.md', '# Réunion\n\n- point un\n- point deux\n\nUne note^[en bas de page].')
  await page.keyboard.press(`${mod}+o`)
  await expect(page.locator('.fp-toast').last()).toContainText('importé')
  const d = await docJson(page)
  expect(d.blocks.map((b: any) => b.type)).toEqual(['heading', 'list', 'paragraph'])
  expect(d.blocks[2].content.some((x: any) => x.type === 'note')).toBe(true)
  expect(d.meta.title).toBe('notes')
  // Pas enregistré : le .md ne sera jamais réécrit en HTML.
  await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'dirty')
  await page.keyboard.press(`${mod}+s`)
  await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'saved')
  const fs = await fsState(page)
  expect(fs.pickerCalls.map((c: any) => c.suggestedName)).toEqual(['notes.html'])
  expect(fs.files['notes.md'].text.startsWith('# Réunion')).toBe(true)
  // Texte brut : un paragraphe par bloc.
  await putFile(page, 'liste.txt', 'Premier.\n\nDeuxième\navec un retour.')
  await page.keyboard.press(`${mod}+o`)
  const t = await docJson(page)
  expect(t.blocks.map((b: any) => b.content[0].text)).toEqual(['Premier.', 'Deuxième\navec un retour.'])
})

test('sans File System Access : le sélecteur classique ; un fichier déposé s’ouvre aussi', async ({ page }, info) => {
  const errs = watchErrors(page)
  await page.addInitScript(() => {
    delete (window as any).showOpenFilePicker
    delete (window as any).showSaveFilePicker
  })
  await openEditor(page, makeFile(info, 'courant.html', JSON.parse(doc('courant-0001', 'Courant', 'Texte courant.'))).url)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press(`${mod}+o`)])
  await chooser.setFiles({ name: 'rapport.html', mimeType: 'text/html', buffer: Buffer.from(folioFile(doc('rapport-0001', 'Rapport', 'Contenu.'))) })
  await expect.poll(async () => (await docJson(page)).id).toBe('rapport-0001')
  // Enregistrer télécharge sous le nom du fichier ouvert.
  await editor(page).click()
  await page.keyboard.type('x')
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${mod}+s`)])
  expect(download.suggestedFilename()).toBe('rapport.html')
  // Dépôt d'un fichier Markdown sur la page.
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['# Déposé\n\nTexte.'], 'depose.md', { type: 'text/markdown' }))
    for (const type of ['dragenter', 'dragover', 'drop']) document.querySelector('.fp-prose')!.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
  // (Le document venait d'être enregistré : rien à proposer.)
  await expect.poll(async () => (await docJson(page)).blocks[0].content[0].text).toBe('Déposé')
  // Fichiers récents : indisponibles ici, et c'est dit.
  await page.locator('[data-menu="file"]').click()
  await page.locator('[data-menu-popup="file"] [data-item="open-recent"]').click()
  await expect(page.locator('[data-dialog="recent"]')).toContainText('ne sait pas rouvrir')
  errs.check()
})

test('un modèle ouvert par Ctrl+O devient un nouveau document', async ({ page }, info) => {
  await fakeOpenPicker(page)
  await openEditor(page, makeFile(info, 'courant.html', JSON.parse(doc('courant-0001', 'Courant', 'Texte courant.'))).url)
  await putFile(page, 'modele.html', folioFile(doc('modele-0001', 'Facture', 'Montant :', { template: true })))
  await page.keyboard.press(`${mod}+o`)
  const d = await docJson(page)
  expect(d.id).not.toBe('modele-0001')
  expect(d.blocks[0].content[0].text).toBe('Montant :')
  await editor(page).click()
  await page.keyboard.type('12 €')
  await page.keyboard.press(`${mod}+s`)
  await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'saved')
  const fs = await fsState(page)
  // Le modèle n'est pas réécrit : on a choisi où ranger le nouveau document.
  expect(fs.pickerCalls).toHaveLength(1)
  expect(docOfFile(fs.files['modele.html'].text).template).toBe(true)
})
