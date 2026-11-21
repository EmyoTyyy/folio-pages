// Insertion → Objet : le texte d'un autre fichier, et les fichiers joints.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { blocks, caretAfter, chooseFile, docJson, docOfFile, editor, makeFile, mod, openEditor, rb, removeFsAccess, saveByDownload, tab, watchErrors } from './helpers'

const doc = (b: unknown[]) => ({ format: 'folio/doc', version: 1, meta: { title: 'Essai', lang: 'fr' }, blocks: b })
const pop = (page: Page) => page.locator('[data-popover]')
const toast = (page: Page, re: RegExp) => page.locator('.fp-toast').filter({ hasText: re }).first()

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
  })
})

async function open(page: Page, info: TestInfo, b: unknown[]) {
  await openEditor(page, makeFile(info, 'essai.html', doc(b)).url)
}

async function objectItem(page: Page, item: 'text-from-file' | 'attach-file', file: { name: string; mimeType: string; buffer: Buffer }) {
  await tab(page, 'insert')
  await rb(page, 'insert-object')
  await chooseFile(page, () => pop(page).locator(`[data-item="${item}"]`).click(), file)
}

test('texte d’un fichier : Markdown puis .docx insérés au curseur, annulable', async ({ page }, info) => {
  const errors = watchErrors(page)
  await open(page, info, ['Début.', 'Fin.'])
  await caretAfter(page, 'Début.')
  await objectItem(page, 'text-from-file', { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('## Ordre du jour\n\n- Budget\n- **Calendrier**\n') })
  await expect(toast(page, /notes\.md/)).toBeVisible()
  const b = await blocks(page)
  expect(b.map((x: { type: string }) => x.type)).toEqual(['paragraph', 'heading', 'list', 'paragraph'])
  expect(JSON.stringify(b[2])).toContain('Calendrier')
  expect(JSON.stringify(b[3])).toContain('Fin.')
  await page.keyboard.press(`${mod}+z`)
  await expect.poll(async () => (await blocks(page)).length).toBe(2)
  // Un .docx (avec ses titres et son texte)
  await caretAfter(page, 'Fin.')
  const docx = readFileSync(join(process.cwd(), 'tests/fixtures/docx/lettre.docx'))
  await objectItem(page, 'text-from-file', { name: 'lettre.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx })
  await expect(toast(page, /lettre\.docx/)).toBeVisible()
  await expect.poll(async () => (await blocks(page)).length).toBeGreaterThan(3)
  expect(await page.evaluate(() => (window as any).folio.doc.meta.title)).toBe('Essai')
  errors.check()
})

test('texte d’un fichier : un fichier illisible le dit, rien ne change', async ({ page }, info) => {
  await open(page, info, ['Texte.'])
  await objectItem(page, 'text-from-file', { name: 'faux.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('pas un zip') })
  await expect(page.locator('.fp-toast[data-kind="error"]')).toBeVisible()
  expect(await blocks(page)).toHaveLength(1)
})

test('fichier joint : pastille, enregistrement par double-clic, Entrée et clic droit ; gardé à l’enregistrement', async ({ page }, info) => {
  test.setTimeout(60_000)
  const errors = watchErrors(page)
  await removeFsAccess(page)
  await open(page, info, ['Les chiffres sont joints : ', 'Suite.'])
  await caretAfter(page, 'joints : ')
  const bytes = Buffer.from('mois;ventes\njanvier;12\nfévrier;15\n', 'utf8')
  await objectItem(page, 'attach-file', { name: 'ventes.csv', mimeType: 'text/csv', buffer: bytes })
  const chip = editor(page).locator('.fp-attach')
  await expect(chip).toHaveCount(1)
  await expect(chip).toContainText('ventes.csv')
  await expect(chip.locator('.fp-attach__size')).toHaveText(/\d+\s*o|\d+\s*B/)
  await expect(toast(page, /ventes\.csv/)).toBeVisible()
  // Le document : une ressource en octets bruts, le type d'origine à part.
  const json = await docJson(page)
  const item = json.blocks[0].content.find((x: { type?: string }) => x.type === 'attachment')
  expect(item).toMatchObject({ name: 'ventes.csv', size: bytes.length, mime: 'text/csv' })
  expect(json.assets[item.src.slice(6)]).toBe('data:application/octet-stream;base64,' + bytes.toString('base64'))
  // Double-clic : le fichier est enregistré, identique.
  const [dl] = await Promise.all([page.waitForEvent('download'), chip.dblclick()])
  expect(dl.suggestedFilename()).toBe('ventes.csv')
  expect(readFileSync(await dl.path())).toEqual(bytes)
  // Sélectionnée, Entrée l'enregistre aussi (et ne la remplace pas).
  await chip.click()
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')])
  expect(dl2.suggestedFilename()).toBe('ventes.csv')
  await expect(chip).toHaveCount(1)
  // Clic droit : « Enregistrer le fichier joint ».
  await chip.click({ button: 'right' })
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.locator('[data-ctx="save-attachment"], [data-item="save-attachment"]').first().click()])
  expect(dl3.suggestedFilename()).toBe('ventes.csv')
  // Enregistrer, rouvrir : la pastille et ses octets sont là.
  const saved = await saveByDownload(page, info, 'joint.html')
  const back = docOfFile(saved.html)
  const again = back.blocks[0].content.find((x: { type?: string }) => x.type === 'attachment')
  expect(back.assets[again.src.slice(6)]).toBe(json.assets[item.src.slice(6)])
  await page.goto(saved.url)
  await page.waitForFunction(() => !!(window as any).folio?.doc)
  await expect(editor(page).locator('.fp-attach')).toContainText('ventes.csv')
  errors.check()
})

test('fichier joint trop gros : refusé avec un message', async ({ page }, info) => {
  await open(page, info, ['Texte.'])
  await page.evaluate(() => {
    // Un fichier de 21 Mo sans l'écrire sur le disque : le sélecteur reçoit un vrai File.
    const big = new File([new Uint8Array(21_000_000)], 'gros.bin')
    const input = HTMLInputElement.prototype
    const desc = Object.getOwnPropertyDescriptor(input, 'files')!
    Object.defineProperty(HTMLInputElement.prototype, 'files', { configurable: true, get() { return this.accept === '' ? ([big] as unknown as FileList) : desc.get!.call(this) } })
    HTMLInputElement.prototype.click = function () { if (this.type === 'file') setTimeout(() => this.dispatchEvent(new Event('change')), 0) }
  })
  await tab(page, 'insert')
  await rb(page, 'insert-object')
  await pop(page).locator('[data-item="attach-file"]').click()
  await expect(toast(page, /trop gros/)).toBeVisible()
  await expect(editor(page).locator('.fp-attach')).toHaveCount(0)
})
