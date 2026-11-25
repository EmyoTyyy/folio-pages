// Documents rangés dans des dossiers : le volet Documents (arbre, dossiers,
// glisser-déposer, clavier, menu), les onglets des documents ouverts (fermer,
// rouvrir), l'ajout de fichiers comme documents, un document ou un dossier
// enregistré à part, et l'export ou l'impression d'un dossier ou d'un choix.

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { docOfFile, editor, makeFile, mod, openEditor, removeFsAccess, saveByDownload, tab, rb, watchErrors } from './helpers'

const FILE = {
  format: 'folio/doc',
  version: 1,
  id: 'tree-doc-0001',
  key: 'intro',
  meta: { title: 'Introduction', lang: 'fr' },
  blocks: [{ content: ['Voir ', { text: 'le chapitre deux', link: '#ch2:' }, '.'] }],
  documents: [
    { key: 'ch1', meta: { title: 'Chapitre 1', lang: 'fr' }, blocks: ['Premier chapitre.'] },
    { key: 'ch2', meta: { title: 'Chapitre 2', lang: 'fr' }, blocks: [{ content: ['Second chapitre, voir ', { text: 'l’annexe', link: '#annex:' }, '.'] }] },
    { key: 'annex', meta: { title: 'Annexe', lang: 'fr' }, blocks: ['Annexe.'] },
  ],
  tree: ['intro', { folder: 'Chapitres', items: ['ch1', 'ch2', { folder: 'Brouillons', items: [] }] }, 'annex'],
}

const rows = (page: Page) => page.locator('#fp-docs .fp-tree__row')
const row = (page: Page, text: string) => page.locator('#fp-docs .fp-tree__row', { hasText: text })
const tabs = (page: Page) => page.locator('.fp-doctab')
const active = (page: Page) => page.locator('.fp-doctab.is-active')
const outline = (page: Page) => rows(page).evaluateAll((rs) => rs.map((r) => `${'  '.repeat(Number(r.getAttribute('aria-level')) - 1)}${r.textContent}`))
const file = (page: Page) => page.evaluate(() => (window as any).folio.doc)

test.beforeEach(async ({ context }) => {
  await removeFsAccess(context)
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
  })
})

test('un fichier rangé en dossiers : le volet s’ouvre, les onglets sont ceux hors dossiers ; ouvrir, fermer, rouvrir', async ({ page }, info) => {
  const errors = watchErrors(page)
  const f = makeFile(info, 'arbre.html', FILE)
  await openEditor(page, f.url)
  await expect(page.locator('#fp-docs')).toBeVisible()
  await expect(page.locator('#fp-docs-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => outline(page)).toEqual(['Introduction', 'Chapitres', '  Chapitre 1', '  Chapitre 2', '  Brouillons', 'Annexe'])
  await expect(row(page, 'Chapitres')).toHaveAttribute('aria-expanded', 'true')
  await expect(tabs(page)).toHaveText(['Introduction', 'Annexe'])
  await expect(row(page, 'Introduction')).toHaveClass(/is-active/)

  // Un clic dans l'arbre ouvre le document (un onglet de plus, juste après celui affiché).
  await row(page, 'Chapitre 2').click()
  await expect(editor(page)).toContainText('Second chapitre')
  await expect(tabs(page)).toHaveText(['Introduction', 'Chapitre 2', 'Annexe'])
  await expect(active(page)).toHaveAttribute('title', 'Chapitres › Chapitre 2')
  // Un lien vers un document fermé l'ouvre aussi.
  await editor(page).locator('a', { hasText: 'l’annexe' }).click({ modifiers: [mod] })
  await expect(active(page)).toHaveText('Annexe')

  // × ferme l'onglet : le document reste dans le fichier et l'onglet voisin s'affiche.
  await active(page).locator('[data-tab-close]').click()
  await expect(tabs(page)).toHaveText(['Introduction', 'Chapitre 2'])
  await expect(row(page, 'Annexe')).toBeVisible()
  expect((await file(page)).documents.map((d: any) => d.key)).toEqual(['ch1', 'ch2', 'annex'])
  // Clic du milieu : ferme aussi.
  await tabs(page).nth(0).click({ button: 'middle' })
  await expect(tabs(page)).toHaveText(['Chapitre 2'])
  // Le dernier onglet ne se ferme pas.
  await expect(tabs(page).locator('[data-tab-close]')).toHaveCount(0)
  // Fermer les autres onglets.
  await row(page, 'Chapitre 1').click()
  await row(page, 'Introduction').click()
  await expect(tabs(page)).toHaveText(['Chapitre 2', 'Chapitre 1', 'Introduction'])
  await tabs(page).nth(1).click({ button: 'right' })
  await page.locator('[data-popover="doc-tab"] [data-doc-action="close-others"]').click()
  await expect(tabs(page)).toHaveText(['Chapitre 1'])
  await expect(row(page, 'Chapitre 1')).toHaveClass(/is-active/)
  // Fermer des onglets ne change pas le fichier.
  await expect(page.locator('#fp-status')).not.toHaveAttribute('data-state', 'dirty')

  // Le navigateur se souvient des onglets ouverts et des dossiers repliés.
  await row(page, 'Chapitres').locator('.fp-tree__twisty').click()
  await expect(row(page, 'Chapitre 1')).toHaveCount(0)
  await row(page, 'Annexe').click()
  await openEditor(page, f.url)
  await expect(tabs(page)).toHaveText(['Introduction', 'Chapitre 1', 'Annexe'])
  await expect(row(page, 'Chapitres')).toHaveAttribute('aria-expanded', 'false')
  // « Montrer dans le volet » ouvre ses dossiers.
  await tabs(page).nth(1).click({ button: 'right' })
  await page.locator('[data-popover="doc-tab"] [data-doc-action="reveal"]').click()
  await expect(row(page, 'Chapitre 1')).toBeFocused()
  errors.check()
})

test('dossiers : créer, renommer, ranger en glissant, au clavier ; supprimer (et annuler) ; enregistrer et rouvrir', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'ranger.html', FILE).url)
  // Nouveau dossier : après le document affiché, nommé tout de suite.
  await page.locator('#fp-folder-add').click()
  const name = page.locator('[data-tree-rename]')
  await expect(name).toBeFocused()
  await name.fill('Annexes')
  await name.press('Enter')
  await expect.poll(() => outline(page)).toEqual(['Introduction', 'Annexes', 'Chapitres', '  Chapitre 1', '  Chapitre 2', '  Brouillons', 'Annexe'])
  await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'dirty')

  // Glisser « Annexe » dans le dossier « Annexes » (au milieu de la ligne : dedans).
  await row(page, 'Annexe').last().dragTo(row(page, 'Annexes'))
  await expect.poll(() => outline(page)).toEqual(['Introduction', 'Annexes', '  Annexe', 'Chapitres', '  Chapitre 1', '  Chapitre 2', '  Brouillons'])
  // Glisser « Chapitre 2 » avant « Chapitre 1 » (le haut de la ligne).
  await row(page, 'Chapitre 2').dragTo(row(page, 'Chapitre 1'), { targetPosition: { x: 40, y: 3 } })
  await expect.poll(() => outline(page)).toEqual(['Introduction', 'Annexes', '  Annexe', 'Chapitres', '  Chapitre 2', '  Chapitre 1', '  Brouillons'])
  // Un dossier ne va pas dans un de ses dossiers.
  await row(page, 'Chapitres').dragTo(row(page, 'Brouillons'))
  await expect.poll(() => outline(page)).toEqual(['Introduction', 'Annexes', '  Annexe', 'Chapitres', '  Chapitre 2', '  Chapitre 1', '  Brouillons'])

  // Nouveau document dans un dossier (menu du dossier) : il s'ouvre, nommé tout de suite.
  await row(page, 'Brouillons').click({ button: 'right' })
  await page.locator('[data-popover="doc-tree"] [data-tree-action="new-doc"]').click()
  await name.fill('Plan du chapitre 3')
  await name.press('Enter')
  await expect(editor(page)).toBeFocused()
  await page.keyboard.type('Idées.')
  await expect.poll(() => outline(page)).toEqual(['Introduction', 'Annexes', '  Annexe', 'Chapitres', '  Chapitre 2', '  Chapitre 1', '  Brouillons', '    Plan du chapitre 3'])
  await expect(active(page)).toHaveText('Plan du chapitre 3')

  // Au clavier : flèches, gauche ferme le dossier, droite l'ouvre, F2 renomme, Entrée ouvre.
  await row(page, 'Chapitres').focus()
  await page.keyboard.press('ArrowLeft')
  await expect(row(page, 'Chapitres')).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(row(page, 'Chapitre 2')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('F2')
  await name.fill('Premier chapitre')
  await name.press('Enter')
  await expect(row(page, 'Premier chapitre')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(active(page)).toHaveText('Premier chapitre')
  await row(page, 'Annexes').focus()
  await page.keyboard.press('F2')
  await name.fill('Annexes et notes')
  await name.press('Enter')
  await expect(row(page, 'Annexes et notes')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(row(page, 'Annexes et notes')).toHaveAttribute('aria-expanded', 'false')
  expect(await page.evaluate(() => localStorage.getItem('folio-pages:folders:tree-doc-0001'))).toContain('/Annexes et notes')
  await page.keyboard.press('ArrowUp')
  await expect(row(page, 'Introduction')).toBeFocused()

  // Supprimer un dossier : confirmé, puis annulé ; supprimé pour de bon.
  await row(page, 'Chapitres').click({ button: 'right' })
  await page.locator('[data-popover="doc-tree"] [data-tree-action="delete"]').click()
  await expect(page.locator('[data-dialog="folder-delete"]')).toContainText('3 documents')
  await page.locator('[data-dialog="folder-delete"] [data-action="delete"]').click()
  await expect.poll(() => outline(page)).toEqual(['Introduction', 'Annexes et notes'])
  await expect(active(page)).not.toHaveText(/chapitre/i)
  await page.locator('.fp-toast__action', { hasText: 'Annuler' }).click()
  await expect.poll(() => outline(page)).toEqual(['Introduction', 'Annexes et notes', 'Chapitres', '  Chapitre 2', '  Premier chapitre', '  Brouillons', '    Plan du chapitre 3'])
  await row(page, 'Brouillons').click({ button: 'right' })
  await page.locator('[data-popover="doc-tree"] [data-tree-action="delete"]').click()
  await page.locator('[data-dialog="folder-delete"] [data-action="delete"]').click()
  await expect.poll(() => outline(page)).toEqual(['Introduction', 'Annexes et notes', 'Chapitres', '  Chapitre 2', '  Premier chapitre'])

  // Enregistrer : l'arbre dans le fichier, les documents dans son ordre ; rouvrir : pareil.
  const saved = await saveByDownload(page, info, 'ranger-saved.html')
  const json = docOfFile(saved.html)
  expect(json.tree).toEqual(['intro', { folder: 'Annexes et notes', items: ['annex'] }, { folder: 'Chapitres', items: ['ch2', 'ch1'] }])
  expect(json.documents.map((d: any) => d.key)).toEqual(['annex', 'ch2', 'ch1'])
  expect(json.documents[2].meta.title).toBe('Premier chapitre')
  await expect(page.locator('#fp-status')).not.toHaveAttribute('data-state', 'dirty')
  await openEditor(page, saved.url)
  // Le dossier fermé plus haut l'est encore (ce navigateur s'en souvient).
  await expect.poll(() => outline(page)).toEqual(['Introduction', 'Annexes et notes', 'Chapitres', '  Chapitre 2', '  Premier chapitre'])
  await row(page, 'Annexes et notes').click()
  await expect.poll(() => outline(page)).toEqual(['Introduction', 'Annexes et notes', '  Annexe', 'Chapitres', '  Chapitre 2', '  Premier chapitre'])
  // Mode lecture : on ouvre, on ne range pas.
  await tab(page, 'view')
  await rb(page, 'view-read')
  await expect(page.locator('#fp-folder-add')).toBeDisabled()
  const annex = page.locator('#fp-docs [data-node="annex"]')
  await expect(annex).toHaveAttribute('draggable', 'false')
  await annex.click()
  await expect(active(page)).toHaveText('Annexe')
  errors.check()
})

test('ajouter des fichiers : Markdown, et un fichier Folio Pages de plusieurs documents (dans un dossier, liens suivis)', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'ajout.html', FILE).url)
  const other = {
    format: 'folio/doc',
    version: 1,
    key: 'ch1',
    meta: { title: 'Guide', lang: 'fr' },
    blocks: [{ content: ['Voir ', { text: 'la suite', link: '#annex:' }] }],
    documents: [{ key: 'annex', meta: { title: 'Suite', lang: 'fr' }, blocks: ['La suite.'] }],
  }
  const folio = readFileSync(makeFile(info, 'guide.html', other).path)
  await row(page, 'Brouillons').click({ button: 'right' })
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-popover="doc-tree"] [data-tree-action="add-files"]').click()])
  expect(chooser.isMultiple()).toBe(true)
  await chooser.setFiles([
    { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes de terrain\n\nUn paragraphe.') },
    { name: 'guide.html', mimeType: 'text/html', buffer: folio },
  ])
  await expect(page.locator('.fp-toast', { hasText: '2 fichiers ajoutés' })).toBeVisible()
  await expect.poll(() => outline(page)).toEqual(['Introduction', 'Chapitres', '  Chapitre 1', '  Chapitre 2', '  Brouillons', '    notes', '    Guide', '      Guide', '      Suite', 'Annexe'])
  // Le lien du guide vers sa suite suit la nouvelle clé (pas l'annexe de ce fichier).
  await row(page, 'Guide').last().click()
  await editor(page).locator('a', { hasText: 'la suite' }).click({ modifiers: [mod] })
  await expect(active(page)).toHaveText('Suite')
  const f = await file(page)
  const keys = f.documents.map((d: any) => d.key)
  expect(new Set([f.key, ...keys]).size).toBe(7)
  // Déposer un fichier sur le volet l'ajoute aussi.
  const data = await page.evaluateHandle(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['Texte brut.'], 'brut.txt', { type: 'text/plain' }))
    return dt
  })
  await row(page, 'Annexe').dispatchEvent('dragover', { dataTransfer: data })
  await row(page, 'Annexe').dispatchEvent('drop', { dataTransfer: data })
  await expect(row(page, 'brut')).toBeVisible()
  errors.check()
})

test('enregistrer un document ou un dossier à part : un fichier Folio Pages avec seulement eux', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'apart.html', FILE).url)
  const saveFrom = async (text: string) => {
    await row(page, text).click({ button: 'right' })
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-popover="doc-tree"] [data-tree-action="save-file"]').click()])
    const path = info.outputPath(download.suggestedFilename())
    await download.saveAs(path)
    return { name: download.suggestedFilename(), json: docOfFile(readFileSync(path, 'utf8')), url: `file://${path}` }
  }
  // Un document : seul, sans clé ni arbre, son lien vers l'annexe devenu du texte.
  const one = await saveFrom('Chapitre 2')
  expect(one.name).toBe('Chapitre 2.html')
  expect(one.json.meta.title).toBe('Chapitre 2')
  expect(one.json.documents).toBeUndefined()
  expect(one.json.key).toBeUndefined()
  expect(JSON.stringify(one.json.blocks)).not.toContain('#annex:')
  expect(one.json.id).not.toBe('tree-doc-0001')
  // Un dossier : ses documents, son contenu à la racine du nouveau fichier.
  const folder = await saveFrom('Chapitres')
  expect(folder.name).toBe('Chapitres.html')
  expect([folder.json.key, ...folder.json.documents.map((d: any) => d.key)]).toEqual(['ch1', 'ch2'])
  expect(folder.json.tree).toBeUndefined()
  // Le fichier ouvert ne change pas.
  await expect(page.locator('#fp-status')).not.toHaveAttribute('data-state', 'dirty')
  await openEditor(page, folder.url)
  await expect(page.locator('.fp-doctab')).toHaveText(['Chapitre 1', 'Chapitre 2'])
  errors.check()
})

test('exporter et imprimer : ce dossier, un choix de documents ; PDF et impression depuis le volet', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'export.html', FILE).url)
  await row(page, 'Chapitre 1').click()
  const exportDocx = async (pick: (dlg: ReturnType<Page['locator']>) => Promise<void>) => {
    await page.locator('[data-menu="file"]').click()
    await page.locator('[data-menu-popup="file"] [data-item="export-docx"]').click()
    const dlg = page.locator('[data-dialog="doc-scope"]')
    await pick(dlg)
    const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-action="ok"]').click()])
    return { name: download.suggestedFilename(), xml: strFromU8(unzipSync(new Uint8Array(readFileSync((await download.path())!)))['word/document.xml']) }
  }
  // « Ce dossier » : les deux chapitres, le fichier au nom du dossier.
  const folder = await exportDocx(async (dlg) => {
    await expect(dlg.locator('[data-field="scope-folder"]')).toBeVisible()
    await expect(dlg).toContainText('Ce dossier : « Chapitres » (2 documents)')
    await dlg.locator('[data-field="scope-folder"]').check()
  })
  expect(folder.name).toBe('Chapitres.docx')
  expect(folder.xml).toContain('Premier chapitre.')
  expect(folder.xml).toContain('Second chapitre')
  expect(folder.xml).not.toContain('Annexe.')
  // « Choisir » : l'arbre à cocher ; un dossier coche son contenu ; rien de coché : refusé.
  const chosen = await exportDocx(async (dlg) => {
    await dlg.locator('[data-field="scope-pick"]').check()
    const tree = dlg.locator('[data-field="scope-tree"]')
    await expect(tree).toBeVisible()
    await tree.locator('[data-scope-doc="ch1"]').uncheck()
    await dlg.locator('[data-action="ok"]').click()
    await expect(dlg.locator('[data-field="scope-error"]')).toHaveText('Cochez au moins un document.')
    await expect(dlg).toBeVisible()
    await tree.locator('[data-scope-doc="intro"]').check()
    await tree.locator('[data-scope-doc="annex"]').check()
    await expect(tree.locator('[data-scope-folder]').first()).toHaveJSProperty('indeterminate', false)
  })
  expect(chosen.xml).toContain('Voir ')
  expect(chosen.xml).toContain('Annexe.')
  expect(chosen.xml).not.toContain('Premier chapitre.')

  // PDF depuis le menu d'un dossier : pas de question, le PDF du dossier.
  await row(page, 'Chapitres').click({ button: 'right' })
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.locator('[data-popover="doc-tree"] [data-tree-action="pdf"]').click()])
  expect(pdf.suggestedFilename()).toBe('Chapitres.pdf')
  await expect(page.locator('[data-dialog="doc-scope"]')).toHaveCount(0)
  // Imprimer depuis le dossier : la fenêtre d'impression propose ce dossier.
  await row(page, 'Chapitres').click({ button: 'right' })
  await page.locator('[data-popover="doc-tree"] [data-tree-action="print"]').click()
  const pd = page.locator('[data-dialog="print"]')
  await expect(pd.locator('[data-field="scope-folder"]')).toBeChecked()
  await expect(pd.locator('[data-field="print-current"]')).toBeDisabled()
  await pd.locator('[data-action="cancel"]').click()
  // Le vrai document est revenu, inchangé.
  await expect(editor(page)).toHaveText('Premier chapitre.')
  await expect(page.locator('#fp-status')).not.toHaveAttribute('data-state', 'dirty')
  errors.check()
})

test('le volet se montre ou se cache (bouton, Affichage, ×) et s’en souvient ; sans dossier, caché d’abord', async ({ page }, info) => {
  const errors = watchErrors(page)
  const plain = makeFile(info, 'plat.html', { ...FILE, tree: undefined })
  await openEditor(page, plain.url)
  await expect(page.locator('#fp-docs')).toBeHidden()
  await expect(tabs(page)).toHaveText(['Introduction', 'Chapitre 1', 'Chapitre 2', 'Annexe'])
  await page.locator('#fp-docs-toggle').click()
  await expect(page.locator('#fp-docs')).toBeVisible()
  await expect.poll(() => outline(page)).toEqual(['Introduction', 'Chapitre 1', 'Chapitre 2', 'Annexe'])
  await tab(page, 'view')
  await expect(page.locator('.fp-ribbon [data-cmd="view-docs"]')).toBeChecked()
  await page.locator('#fp-docs-close').click()
  await expect(page.locator('#fp-docs')).toBeHidden()
  await expect(page.locator('.fp-ribbon [data-cmd="view-docs"]')).not.toBeChecked()
  // Caché exprès : il le reste, même pour un fichier avec des dossiers.
  await openEditor(page, makeFile(info, 'arbre.html', FILE).url)
  await expect(page.locator('#fp-docs')).toBeHidden()
  await tab(page, 'view')
  await page.locator('.fp-ribbon [data-cmd="view-docs"]').check()
  await expect(page.locator('#fp-docs')).toBeVisible()
  // On l'élargit en tirant son bord (ou au clavier).
  const before = (await page.locator('#fp-docs').boundingBox())!.width
  await page.locator('.fp-docs__resize').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  expect((await page.locator('#fp-docs').boundingBox())!.width).toBeCloseTo(before + 32, 0)
  errors.check()
})
