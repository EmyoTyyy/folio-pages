// Plusieurs documents dans un fichier : onglets, changement de document,
// annulation propre à chaque document, renvois et liens d'un document à
// l'autre, ajout / renommage / duplication / déplacement / suppression,
// enregistrement et réouverture, export et impression de tous les documents.

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { docOfFile, editor, makeFile, mod, openEditor, rb, removeFsAccess, saveByDownload, tab, watchErrors } from './helpers'

const FILE = {
  format: 'folio/doc',
  version: 1,
  id: 'multi-doc-0001',
  key: 'report',
  meta: { title: 'Rapport', lang: 'fr' },
  blocks: [
    { type: 'heading', level: 1, text: 'Rapport annuel' },
    { content: ['Voir ', { type: 'xref', doc: 'annex', target: 'ventes', show: 'label' }, ' (page ', { type: 'xref', doc: 'annex', target: 'ventes', show: 'page' }, ') et ', { text: 'l’annexe', link: '#annex:' }, '.'] },
    'Texte du rapport.',
  ],
  documents: [
    {
      key: 'annex',
      meta: { title: 'Annexe A', lang: 'fr' },
      page: { orientation: 'landscape' },
      blocks: [
        { type: 'heading', level: 1, text: 'Annexe A' },
        'Premier paragraphe de l’annexe.',
        { type: 'pagebreak' },
        { content: [{ type: 'bookmark', name: 'ventes' }, 'Tableau ', { type: 'seq', label: 'table' }, ' : Ventes par région'] },
      ],
    },
  ],
}

const tabs = (page: Page) => page.locator('.fp-doctab')
const active = (page: Page) => page.locator('.fp-doctab.is-active')
const xrefs = (page: Page) => editor(page).locator('.fp-xref')
const file = (page: Page) => page.evaluate(() => (window as any).folio.doc)

test.beforeEach(async ({ context }) => {
  // Les enregistrements et les exports se téléchargent (comme dans Firefox).
  await removeFsAccess(context)
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
  })
})

test('onglets : changer de document, annuler dans chacun, renvois et liens vers l’autre document', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'multi.html', FILE).url)
  await expect(tabs(page)).toHaveText(['Rapport', 'Annexe A'])
  await expect(active(page)).toHaveText('Rapport')
  await expect(page.locator('#fp-doctabs [role="tablist"]')).toHaveAttribute('aria-label', 'Documents de ce fichier')
  // Le renvoi montre l'étiquette de la légende de l'annexe ; sa page n'est pas encore connue.
  await expect(xrefs(page)).toHaveText(['Tableau 1', '?'])

  // L'annexe : sa propre mise en page (paysage), son titre dans la barre de titre.
  await tabs(page).nth(1).click()
  await expect(active(page)).toHaveText('Annexe A')
  await expect(editor(page).locator('h1')).toHaveText('Annexe A')
  await expect(page).toHaveTitle(/^Annexe A/)
  await expect(page.locator('#fp-pages')).toHaveText(/sur 2/)
  // Une modification dans l'annexe…
  await editor(page).getByText('Premier paragraphe').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Ajout.')
  await expect(tabs(page).nth(1).locator('.fp-doctab__dot')).toBeVisible()

  // …ne s'annule pas depuis le rapport ; la page du renvoi est maintenant connue.
  await tabs(page).nth(0).click()
  await expect(xrefs(page)).toHaveText(['Tableau 1', '2'])
  await editor(page).getByText('Texte du rapport.').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Fin.')
  await page.keyboard.press(`${mod}+z`)
  await expect(editor(page).getByText('Texte du rapport.', { exact: true })).toBeVisible()
  await tabs(page).nth(1).click()
  await expect(editor(page).getByText('Premier paragraphe de l’annexe. Ajout.')).toBeVisible()
  await editor(page).getByText('Premier paragraphe').click()
  await page.keyboard.press(`${mod}+z`)
  await expect(editor(page).getByText('Premier paragraphe de l’annexe.', { exact: true })).toBeVisible()

  // Le lien « l'annexe » (Ctrl+clic) ouvre l'annexe au début ; un renvoi (Ctrl+clic) va à son signet.
  await tabs(page).nth(0).click()
  await editor(page).locator('a', { hasText: 'l’annexe' }).click({ modifiers: [mod] })
  await expect(active(page)).toHaveText('Annexe A')
  await tabs(page).nth(0).click()
  await xrefs(page).first().click({ modifiers: [mod] })
  await expect(active(page)).toHaveText('Annexe A')
  await expect.poll(() => page.evaluate(() => getSelection()?.anchorNode?.textContent ?? '')).toContain('Ventes par région')

  // Le clavier : flèches entre les onglets, Entrée pour ouvrir.
  await active(page).focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Enter')
  await expect(active(page)).toHaveText('Rapport')
  errors.check()
})

test('ajouter, renommer, dupliquer, déplacer, supprimer (et annuler), enregistrer et rouvrir', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'gestion.html', FILE).url)
  // + : un document vide, nommé tout de suite.
  await page.locator('#fp-doc-add').click()
  const name = page.locator('[data-doc-rename]')
  await expect(name).toBeFocused()
  await name.fill('Notes de réunion')
  await name.press('Enter')
  await expect(tabs(page)).toHaveText(['Rapport', 'Notes de réunion', 'Annexe A'])
  await expect(active(page)).toHaveText('Notes de réunion')
  await expect(page.locator('#fp-title')).toHaveValue('Notes de réunion')
  await editor(page).click()
  await page.keyboard.type('Ordre du jour.')
  // Double-clic : renommer.
  await tabs(page).nth(2).dblclick()
  await name.fill('Annexe A — chiffres')
  await name.press('Enter')
  await expect(tabs(page).nth(2)).toHaveText('Annexe A — chiffres')
  // Menu de l'onglet : dupliquer, déplacer.
  await tabs(page).nth(0).click({ button: 'right' })
  await page.locator('[data-popover="doc-tab"] [data-doc-action="duplicate"]').click()
  await expect(tabs(page)).toHaveText(['Rapport', 'Rapport (copie)', 'Notes de réunion', 'Annexe A — chiffres'])
  await expect(active(page)).toHaveText('Rapport (copie)')
  await tabs(page).nth(1).click({ button: 'right' })
  await page.locator('[data-popover="doc-tab"] [data-doc-action="right"]').click()
  await expect(tabs(page)).toHaveText(['Rapport', 'Notes de réunion', 'Rapport (copie)', 'Annexe A — chiffres'])
  // Supprimer (confirmé), puis Annuler dans le message : le document revient à sa place.
  await tabs(page).nth(2).click({ button: 'right' })
  await page.locator('[data-popover="doc-tab"] [data-doc-action="delete"]').click()
  await page.locator('[data-dialog="doc-delete"] [data-action="delete"]').click()
  await expect(tabs(page)).toHaveText(['Rapport', 'Notes de réunion', 'Annexe A — chiffres'])
  await page.locator('.fp-toast__action', { hasText: 'Annuler' }).click()
  await expect(tabs(page)).toHaveText(['Rapport', 'Notes de réunion', 'Rapport (copie)', 'Annexe A — chiffres'])
  // Supprimé pour de bon.
  await tabs(page).nth(2).click({ button: 'right' })
  await page.locator('[data-popover="doc-tab"] [data-doc-action="delete"]').click()
  await page.locator('[data-dialog="doc-delete"] [data-action="delete"]').click()
  await expect(tabs(page)).toHaveText(['Rapport', 'Notes de réunion', 'Annexe A — chiffres'])

  // Le renvoi vers l'annexe a sa page une fois l'annexe affichée, et la garde dans le fichier.
  await tabs(page).nth(2).click()
  await tabs(page).nth(0).click()
  await expect(xrefs(page)).toHaveText(['Tableau 1', '2'])
  const saved = await saveByDownload(page, info, 'gestion-saved.html')
  const json = docOfFile(saved.html)
  expect(json.key).toBe('report')
  expect(json.documents.map((d: any) => [d.key, d.meta.title])).toEqual([
    [expect.any(String), 'Notes de réunion'],
    ['annex', 'Annexe A — chiffres'],
  ])
  expect(json.documents[0].blocks[0].content[0].text).toBe('Ordre du jour.')
  expect(json.blocks[1].content.filter((x: any) => x.type === 'xref').map((x: any) => x.last)).toEqual(['Tableau 1', '2'])
  await expect(page.locator('#fp-status')).not.toHaveAttribute('data-state', 'dirty')

  // Réouverture : les trois documents, le premier affiché, la page connue d'avance.
  await openEditor(page, saved.url)
  await expect(tabs(page)).toHaveText(['Rapport', 'Notes de réunion', 'Annexe A — chiffres'])
  await expect(active(page)).toHaveText('Rapport')
  await expect(xrefs(page)).toHaveText(['Tableau 1', '2'])
  await expect(page.locator('.fp-doctab__dot')).toHaveCount(0)
  // Mode lecture : on lit les autres documents, sans en ajouter.
  await tab(page, 'view')
  await rb(page, 'view-read')
  await expect(page.locator('#fp-doc-add')).toBeHidden()
  await tabs(page).nth(1).click()
  await expect(editor(page).getByText('Ordre du jour.')).toBeVisible()
  errors.check()
})

test('glisser un onglet : il reste sur sa ligne, les autres s’écartent ; pas de contour après un nouveau nom', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'glisser.html', FILE).url)
  // Nouveau document nommé avec Entrée : on écrit dans le document, l'onglet n'a pas le focus.
  await page.locator('#fp-doc-add').click()
  await page.locator('[data-doc-rename]').fill('Notes')
  await page.locator('[data-doc-rename]').press('Enter')
  await expect(tabs(page)).toHaveText(['Rapport', 'Notes', 'Annexe A'])
  await expect(editor(page)).toBeFocused()
  await expect(active(page)).not.toBeFocused()
  // F2 sur l'onglet : on y revient après le renommage.
  await active(page).focus()
  await page.keyboard.press('F2')
  await page.locator('[data-doc-rename]').press('Enter')
  await expect(active(page)).toBeFocused()

  // Glisser « Rapport » vers la droite, au-delà de « Notes ».
  const first = await tabs(page).nth(0).boundingBox()
  const second = await tabs(page).nth(1).boundingBox()
  const third = await tabs(page).nth(2).boundingBox()
  await page.mouse.move(first!.x + 10, first!.y + first!.height / 2)
  await page.mouse.down()
  await page.mouse.move(first!.x + 30, first!.y + first!.height / 2 + 40, { steps: 4 })
  await page.mouse.move(second!.x + second!.width - 5, first!.y + first!.height / 2 + 40, { steps: 8 })
  // Pendant le glissement : même hauteur, « Notes » a glissé à gauche, « Annexe A » n'a pas bougé.
  await expect(tabs(page).nth(0)).toHaveClass(/is-dragging/)
  await expect.poll(async () => (await tabs(page).nth(0).boundingBox())!.y).toBeCloseTo(first!.y, 0)
  await expect.poll(async () => (await tabs(page).nth(1).boundingBox())!.x).toBeLessThan(second!.x - 20)
  expect((await tabs(page).nth(2).boundingBox())!.x).toBeCloseTo(third!.x, 0)
  await page.mouse.up()
  await expect(tabs(page)).toHaveText(['Notes', 'Rapport', 'Annexe A'])
  // Le lâcher ne compte pas comme un clic : le document affiché ne change pas.
  await expect(active(page)).toHaveText('Notes')
  await expect(page.locator('.fp-doctab.is-dragging')).toHaveCount(0)

  // Échap pendant le glissement : rien ne bouge.
  const a = await tabs(page).nth(2).boundingBox()
  await page.mouse.move(a!.x + 10, a!.y + a!.height / 2)
  await page.mouse.down()
  await page.mouse.move(a!.x - 200, a!.y + a!.height / 2, { steps: 8 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(tabs(page)).toHaveText(['Notes', 'Rapport', 'Annexe A'])

  // Un simple clic change toujours de document.
  await tabs(page).nth(2).click()
  await expect(active(page)).toHaveText('Annexe A')
  errors.check()
})

test('renvoi et lien vers un autre document depuis leurs fenêtres', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'fenetres.html', FILE).url)
  await editor(page).getByText('Texte du rapport.').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Cf. ')
  // Renvoi : le document « Annexe A », son titre (un signet caché y est ajouté).
  await tab(page, 'references')
  await rb(page, 'cross-reference')
  const dlg = page.locator('[data-dialog="xref"]')
  await dlg.locator('[data-field="xref-doc"]').selectOption('annex')
  await dlg.locator('[data-field="xref-type"]').selectOption('heading')
  await dlg.locator('[data-field="xref-list"]').selectOption({ label: 'Annexe A' })
  await dlg.locator('[data-field="xref-show"]').selectOption('text')
  await expect(dlg.locator('[data-field="xref-show"] option[value="above"]')).toHaveCount(0)
  await dlg.locator('[data-action="ok"]').click()
  await expect(xrefs(page).last()).toHaveText('Annexe A')
  const f = await file(page)
  const ref = f.blocks[2].content.find((x: any) => x.type === 'xref')
  expect(ref).toMatchObject({ doc: 'annex', show: 'text' })
  // Le signet est dans l'annexe.
  expect(JSON.stringify(f.documents[0].blocks[0])).toContain(`"name":"${ref.target}"`)

  // Lien : « Ou un endroit de ce fichier » propose les titres de l'annexe.
  await page.keyboard.type(' et ')
  await page.keyboard.press(`${mod}+k`)
  const link = page.locator('[data-dialog="link"]')
  await link.locator('[data-field="link-text"]').fill('le tableau')
  await link.locator('[data-field="link-place"]').selectOption('#annex:ventes')
  await expect(link.locator('[data-field="href"]')).toHaveValue('#annex:ventes')
  await link.locator('[data-action="ok"]').click()
  await editor(page).locator('a', { hasText: 'le tableau' }).click({ modifiers: [mod] })
  await expect(active(page)).toHaveText('Annexe A')
  errors.check()
})

test('exporter et imprimer : ce document ou tous les documents', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'export.html', FILE).url)
  const exportDocx = async (scope: 'one' | 'all') => {
    await page.locator('[data-menu="file"]').click()
    await page.locator('[data-menu-popup="file"] [data-item="export-docx"]').click()
    const dlg = page.locator('[data-dialog="doc-scope"]')
    await expect(dlg).toBeVisible()
    await dlg.locator(`[data-field="scope-${scope}"]`).check()
    const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-action="ok"]').click()])
    const zip = unzipSync(new Uint8Array(readFileSync((await download.path())!)))
    return strFromU8(zip['word/document.xml'])
  }
  // Tous : les deux documents, l'annexe dans sa section paysage ; le renvoi devient interne.
  const all = await exportDocx('all')
  expect(all).toContain('Rapport annuel')
  expect(all).toContain('Ventes par région')
  expect(all).toContain('w:orient="landscape"')
  expect(all).toContain('annex_ventes')
  // Le vrai document est revenu, modifiable, sans rien de changé.
  await expect(tabs(page)).toHaveText(['Rapport', 'Annexe A'])
  await expect(editor(page).locator('h1')).toHaveText('Rapport annuel')
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true')
  await expect(page.locator('#fp-status')).not.toHaveAttribute('data-state', 'dirty')
  // Ce document : seulement le rapport ; le renvoi vers l'annexe est son texte.
  const one = await exportDocx('one')
  expect(one).toContain('Rapport annuel')
  expect(one).not.toContain('Ventes par région')
  expect(one).toContain('Tableau 1')

  // Imprimer tous les documents : l'impression voit les deux.
  await page.evaluate(() => {
    ;(window as any).__printed = []
    window.print = () => void (window as any).__printed.push(document.querySelector('.fp-prose')!.textContent)
  })
  await page.keyboard.press(`${mod}+p`)
  const pd = page.locator('[data-dialog="print"]')
  await pd.locator('[data-field="scope-all"]').check()
  await expect(pd.locator('[data-field="print-current"]')).toBeDisabled()
  await pd.locator('[data-action="ok"]').click()
  await expect.poll(() => page.evaluate(() => (window as any).__printed.length)).toBe(1)
  const printed = await page.evaluate(() => (window as any).__printed[0] as string)
  expect(printed).toContain('Rapport annuel')
  expect(printed).toContain('Ventes par région')
  await expect(editor(page).locator('h1')).toHaveText('Rapport annuel')
  errors.check()
})

test('un seul document : un onglet et +, le fichier ne change pas de forme', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(page, makeFile(info, 'seul.html', { format: 'folio/doc', version: 1, meta: { title: 'Seul' }, blocks: ['Texte.'] }).url)
  await expect(tabs(page)).toHaveText(['Seul'])
  await expect(page.locator('#fp-doc-add')).toBeVisible()
  const f = await file(page)
  expect(f.documents).toBeUndefined()
  expect(f.key).toBeUndefined()
  // Exporter : pas de question quand il n'y a qu'un document.
  await page.locator('[data-menu="file"]').click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-menu-popup="file"] [data-item="export-docx"]').click()])
  expect(download.suggestedFilename()).toBe('seul.docx')
  await expect(page.locator('[data-dialog="doc-scope"]')).toHaveCount(0)
  errors.check()
})
