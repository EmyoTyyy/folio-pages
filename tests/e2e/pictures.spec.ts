// Disposition d'images : des images sélectionnées qui deviennent une disposition
// (Format de l'image, menu contextuel, Insertion), la fenêtre (ajouter, remplacer,
// déplacer, retirer, glisser), Ctrl+Z, enregistrement, export .docx relu.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { importDocx } from '../../src/docx/import'
import { expect, test, type Page } from '@playwright/test'
import { blocks, caretAfter, docOfFile, editor, makeFile, makePng, mod, openEditor, pngDataUri, rb, removeFsAccess, saveByDownload, tab, watchErrors } from './helpers'

const RED = pngDataUri(40, 30, [200, 40, 40])
const BLUE = pngDataUri(30, 40, [40, 60, 200])
const DOC = {
  format: 'folio/doc',
  version: 1,
  meta: { title: 'Album', lang: 'fr' },
  blocks: ['Début.', { type: 'image', src: RED, alt: 'Rouge', caption: ['Le rouge'] }, 'Entre les deux.', { type: 'image', src: BLUE, alt: 'Bleu' }, 'Fin.'],
}
const dlg = (page: Page) => page.locator('[data-dialog="pictures"]')
const pop = (page: Page) => page.locator('[data-popover]')
const pictures = async (page: Page) => (await blocks(page)).filter((b: { type: string }) => b.type === 'pictures')
const file = (name: string, rgb: [number, number, number]) => ({ name, mimeType: 'image/png', buffer: makePng(24, 18, rgb) })

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
  })
})

test('une image : Format de l’image → Disposition de l’image, tout de suite ; Ctrl+Z la rend', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'album.html', DOC).url)
  await editor(page).locator('.fp-figure__frame').first().click()
  await tab(page, 'image')
  await rb(page, 'picture-layout')
  await expect(pop(page).locator('[data-pl-layout]')).toHaveCount(7)
  await expect(pop(page).locator('[data-pl-layout="grid"] svg')).toBeVisible()
  await pop(page).locator('[data-pl-layout="list"]').click()
  await expect(editor(page).locator('.fp-pictures svg image')).toHaveCount(1)
  let p = await pictures(page)
  expect(p).toHaveLength(1)
  expect(p[0]).toMatchObject({ type: 'pictures', layout: 'list', items: [{ caption: 'Le rouge' }] })
  expect((await page.evaluate(() => (window as any).folio.doc.assets))[p[0].items[0].src.slice(6)]).toBe(RED)
  // Toujours sélectionnée : une autre disposition depuis le menu contextuel → la fenêtre.
  await expect(editor(page).locator('.fp-pictures.ProseMirror-selectednode')).toHaveCount(1)
  await page.keyboard.press(`${mod}+z`)
  await expect.poll(async () => (await blocks(page)).map((b: { type: string }) => b.type)).toEqual(['paragraph', 'image', 'paragraph', 'image', 'paragraph'])
  errors.check()
})

test('deux images sélectionnées → la fenêtre ; légendes, ordre, ajout, retrait, titre, couleurs ; double-clic pour modifier', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'album.html', DOC).url)
  await editor(page).click()
  await page.keyboard.press(`${mod}+a`)
  await editor(page).getByText('Entre les deux.').click({ button: 'right' })
  // Le clic droit dans la sélection la garde : « Disposition d'images… ».
  await page.locator('[data-ctx="picture-layout"]').click()
  await expect(dlg(page).locator('[data-pl-item]')).toHaveCount(2)
  await expect(dlg(page).locator('[data-pl-item="0"] img')).toHaveAttribute('src', RED)
  await expect(dlg(page).locator('[data-pl-item="0"] [data-field="pl-caption"]')).toHaveValue('Le rouge')
  await expect(dlg(page).locator('.fp-dg-kind')).toHaveCount(6)
  await dlg(page).locator('[data-layout="strip"]').click()
  await expect(dlg(page).locator('[data-layout="strip"]')).toHaveAttribute('aria-checked', 'true')
  await dlg(page).locator('[data-pl-item="1"] [data-field="pl-caption"]').fill('Le bleu')
  await dlg(page).locator('[data-pl-item="1"] [data-field="pl-text"]').fill('Une image haute.')
  await expect(dlg(page).locator('[data-pl-preview] svg')).toContainText('Le bleu')
  // Ajouter une image (fenêtre de fichiers), la monter en tête, en retirer une autre.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), dlg(page).locator('[data-action="pl-add"]').click()])
  await chooser.setFiles([file('vert.png', [40, 160, 60])])
  await expect(dlg(page).locator('[data-pl-item]')).toHaveCount(3)
  await dlg(page).locator('[data-pl-item="2"] [data-field="pl-caption"]').fill('Le vert')
  await dlg(page).locator('[data-pl-item="2"] [data-action="pl-up"]').click()
  await dlg(page).locator('[data-pl-item="1"] [data-action="pl-up"]').click()
  await expect(dlg(page).locator('[data-pl-item="0"] [data-field="pl-caption"]')).toHaveValue('Le vert')
  await dlg(page).locator('[data-pl-item="1"] [data-action="pl-remove"]').click()
  const captions = () => dlg(page).locator('[data-field="pl-caption"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
  await expect.poll(captions).toEqual(['Le vert', 'Le bleu'])
  // Un cadre vide, avec seulement une légende.
  await dlg(page).locator('[data-action="pl-add-empty"]').click()
  await expect(dlg(page).locator('[data-pl-item="2"] [data-field="pl-caption"]')).toBeFocused()
  await page.keyboard.type('Plus tard')
  await dlg(page).locator('[data-field="pl-title"]').fill('Couleurs')
  await dlg(page).locator('[data-field="pl-color"]').selectOption('accent3')
  await expect(dlg(page).locator('.fp-form__hint').filter({ hasText: 'images sélectionnées' })).toBeVisible()
  await dlg(page).locator('[data-action="ok"]').click()
  await expect(dlg(page)).toHaveCount(0)
  let all = await blocks(page)
  expect(all.map((b: { type: string }) => b.type)).toEqual(['paragraph', 'pictures', 'paragraph', 'paragraph'])
  expect(all[1]).toMatchObject({ layout: 'strip', title: 'Couleurs', color: 'accent3', items: [{ caption: 'Le vert' }, { caption: 'Le bleu', text: 'Une image haute.' }, { caption: 'Plus tard' }] })
  expect(all[1].items[2].src).toBeUndefined()
  await expect(editor(page).locator('.fp-pictures svg image')).toHaveCount(2)
  // Double-clic : la fenêtre de modification, la disposition cochée ; Annuler ne change rien.
  await editor(page).locator('.fp-pictures').dblclick()
  await expect(dlg(page).locator('[data-layout="strip"]')).toHaveAttribute('aria-checked', 'true')
  await dlg(page).locator('[data-layout="mosaic"]').click()
  await dlg(page).locator('[data-action="cancel"]').click()
  expect((await pictures(page))[0].layout).toBe('strip')
  // Entrée sur la disposition sélectionnée : la fenêtre aussi.
  await editor(page).locator('.fp-pictures').click()
  await page.keyboard.press('Enter')
  await dlg(page).locator('[data-layout="mosaic"]').click()
  await dlg(page).locator('[data-action="ok"]').click()
  expect((await pictures(page))[0].layout).toBe('mosaic')
  // Ctrl+Z deux fois : les deux images reviennent.
  await page.keyboard.press(`${mod}+z`)
  await page.keyboard.press(`${mod}+z`)
  await expect.poll(async () => (await blocks(page)).map((b: { type: string }) => b.type)).toEqual(['paragraph', 'image', 'paragraph', 'image', 'paragraph'])
  all = await blocks(page)
  expect(all[1].caption).toEqual([{ text: 'Le rouge' }])
  errors.check()
})

test('Insertion → Images → Disposition d’images : nouvelle, images glissées ; enregistrée, relue, exportée en .docx puis rouverte', async ({ page }, info) => {
  const errors = watchErrors(page)
  await removeFsAccess(page)
  // Ctrl+O passe par un champ de fichier (comme dans Firefox), pour le rouvrir ensuite.
  await page.addInitScript(() => delete (window as any).showOpenFilePicker)
  await openEditor(page, makeFile(info, 'neuf.html', { format: 'folio/doc', version: 1, meta: { title: 'Neuf', lang: 'fr' }, blocks: ['Un paragraphe.'] }).url)
  await caretAfter(page, 'paragraphe.')
  await tab(page, 'insert')
  await rb(page, 'insert-image-menu')
  await pop(page).locator('[data-image="layout"]').click()
  await expect(dlg(page).locator('.fp-pl-empty')).toBeVisible()
  // Rien à insérer : un message, la fenêtre reste.
  await dlg(page).locator('[data-action="ok"]').click()
  await expect(page.locator('.fp-toast').filter({ hasText: 'au moins une image' })).toBeVisible()
  await expect(dlg(page)).toBeVisible()
  // Deux images glissées dans la fenêtre.
  const transfer = await page.evaluateHandle(async (uris: string[]) => {
    const dt = new DataTransfer()
    for (const [i, u] of uris.entries()) dt.items.add(new File([await (await fetch(u)).blob()], `p${i}.png`, { type: 'image/png' }))
    return dt
  }, [RED, BLUE])
  await dlg(page).locator('[data-pl-drop]').dispatchEvent('dragover', { dataTransfer: transfer })
  await dlg(page).locator('[data-pl-drop]').dispatchEvent('drop', { dataTransfer: transfer })
  await expect(dlg(page).locator('[data-pl-item]')).toHaveCount(2)
  await dlg(page).locator('[data-layout="process"]').click()
  await dlg(page).locator('[data-pl-item="0"] [data-field="pl-caption"]').fill('Avant')
  await dlg(page).locator('[data-pl-item="1"] [data-field="pl-caption"]').fill('Après')
  // Remplacer la seconde image.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), dlg(page).locator('[data-pl-item="1"] [data-action="pl-pick"]').click()])
  await chooser.setFiles([file('jaune.png', [220, 200, 40])])
  await expect(dlg(page).locator('[data-pl-item="1"] img')).not.toHaveAttribute('src', BLUE)
  await dlg(page).locator('[data-action="ok"]').click()
  await expect(editor(page).locator('.fp-pictures[data-layout="process"] svg image')).toHaveCount(2)
  const p = (await pictures(page))[0]
  expect(p.items.map((it: { caption: string }) => it.caption)).toEqual(['Avant', 'Après'])

  // Enregistré : les images sont des ressources du fichier ; relu à l'identique.
  const saved = await saveByDownload(page, info, 'album-enregistre.html')
  const json = docOfFile(saved.html)
  const b = json.blocks.find((x: { type: string }) => x.type === 'pictures')
  expect(b.layout).toBe('process')
  const first = json.assets[b.items[0].src.slice(6)]
  expect(first).toMatch(/^data:image\/png;base64,/)
  await page.goto(saved.url)
  await page.waitForFunction(() => !!(window as any).folio?.doc)
  await expect(editor(page).locator('.fp-pictures svg image')).toHaveCount(2)
  await expect(editor(page).locator('.fp-pictures svg')).toContainText('Après')

  // Export .docx : une image SVG avec son PNG de repli (dessiné avec les images), puis rouvert dans
  // l'application (Ctrl+O) : la disposition revient, modifiable, avec ses images.
  await page.locator('[data-menu="file"]').click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-menu-popup="file"] [data-item="export-docx"]').click()])
  const bytes = readFileSync((await download.path())!)
  const media = Object.keys(unzipSync(new Uint8Array(bytes))).filter((k) => k.startsWith('word/media/'))
  expect(media.some((k) => k.endsWith('.svg'))).toBe(true)
  expect(media.some((k) => k.endsWith('.png'))).toBe(true)
  const back = importDocx(new Uint8Array(bytes)).doc as any
  const again = back.blocks.find((x: { type: string }) => x.type === 'pictures') as any
  expect(again).toMatchObject({ layout: 'process', items: [{ caption: 'Avant' }, { caption: 'Après' }] })
  const src0: string = again.items[0].src
  expect(src0.startsWith('asset:') ? back.assets[src0.slice(6)] : src0).toBe(first)
  const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press(`${mod}+o`)])
  await chooser2.setFiles({ name: 'album.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: bytes })
  await expect(editor(page).locator('.fp-pictures[data-layout="process"] svg image')).toHaveCount(2)
  errors.check()
})

test('PDF direct : la disposition est une image, ses images dedans', async ({ page }, info) => {
  const errors = watchErrors(page)
  await removeFsAccess(page)
  await openEditor(page, makeFile(info, 'pdf.html', { format: 'folio/doc', version: 1, meta: { title: 'PDF', lang: 'fr' }, blocks: ['Texte.', { type: 'pictures', layout: 'mosaic', items: [{ src: RED, caption: 'Rouge' }, { src: BLUE, caption: 'Bleu' }, { src: RED }] }] }).url)
  await expect(editor(page).locator('.fp-pictures svg image')).toHaveCount(3)
  await page.locator('#fp-share').click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-share="pdf"]').click()])
  const path = info.outputPath('dispositions.pdf')
  await download.saveAs(path)
  // Une image (la disposition dessinée, avec ses images) : pas perdue en route.
  // (pdfimages liste aussi le masque de transparence : « smask ».)
  const imgs = execFileSync('pdfimages', ['-list', path], { encoding: 'utf8' }).trim().split('\n').slice(2).filter((l) => l.trim().split(/\s+/)[2] === 'image')
  expect(imgs.length).toBe(1)
  const [, , , width] = imgs[0].trim().split(/\s+/)
  expect(Number(width)).toBeGreaterThan(600)
  // Ses couleurs : du rouge et du bleu (les images sont bien dessinées dedans).
  const png = info.outputPath('extrait')
  execFileSync('pdfimages', ['-png', path, png])
  const bytes = readFileSync(`${png}-000.png`)
  const colors = await page.evaluate(async (b64: string) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let red = 0
    let blue = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 180 && d[i + 1] < 70 && d[i + 2] < 70) red++
      if (d[i + 2] > 180 && d[i] < 70 && d[i + 1] < 90) blue++
    }
    return { red, blue }
  }, bytes.toString('base64'))
  expect(colors.red).toBeGreaterThan(1000)
  expect(colors.blue).toBeGreaterThan(1000)
  errors.check()
})
