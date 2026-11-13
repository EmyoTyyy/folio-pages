// Références : légendes et table des illustrations, signets et renvois, index,
// table des références, sources (recherche par DOI), citations et
// bibliographie. Tout passe par le ruban et les fenêtres, et s'annule.

import { expect, test, type Page } from '@playwright/test'
import { blocks, caretAfter, docJson, editor, makeFile, mod, openEditor, pngDataUri, rb, selectText, tab, watchErrors } from './helpers'

const dialog = (page: Page, name: string) => page.locator(`[data-dialog="${name}"]`)
const pop = (page: Page) => page.locator('[data-popover]')

const sentence = (i: number) => `Phrase ${i} d’un paragraphe assez long pour occuper plusieurs lignes de la page imprimée.`
const long = (n: number) => Array.from({ length: n }, (_, i) => sentence(i + 1)).join(' ')

test('légendes : image et tableau numérotés, table des illustrations à jour, annulable', async ({ page }, info) => {
  const errors = watchErrors(page)
  await openEditor(
    page,
    makeFile(info, 'legendes.html', {
      format: 'folio/doc',
      version: 1,
      meta: { lang: 'fr' },
      blocks: [{ type: 'heading', text: 'Rapport' }, 'Début.', { type: 'image', src: pngDataUri(40, 20), width: 120, caption: 'Un port' }, { type: 'table', rows: [['Alpha', 'Beta']] }, 'Fin.'],
    }).url,
  )
  // L'image sélectionnée : la légende va devant la sienne.
  await page.locator('.fp-figure img').first().click()
  await tab(page, 'references')
  await rb(page, 'insert-caption')
  const dlg = dialog(page, 'caption')
  await expect(dlg.locator('[data-field="caption-preview"]')).toHaveText('Figure 1')
  await dlg.locator('[data-action="ok"]').click()
  await expect(page.locator('.fp-figure figcaption')).toHaveText('Figure 1 : Un port')
  // Le tableau : légende au-dessus.
  await caretAfter(page, 'Alpha')
  await rb(page, 'insert-caption')
  await dlg.locator('[data-field="caption-label"]').selectOption('table')
  await dlg.locator('[data-field="caption-text"]').fill('Mesures')
  await expect(dlg.locator('[data-field="caption-preview"]')).toHaveText('Tableau 1 : Mesures')
  await expect(dlg.locator('[data-field="caption-position"]')).toHaveValue('above')
  await dlg.locator('[data-action="ok"]').click()
  const b = await blocks(page)
  expect(b[3]).toEqual({ type: 'paragraph', style: 'caption', content: [{ text: 'Tableau ' }, { type: 'seq', label: 'table' }, { text: ' : Mesures' }] })
  expect(b[4].type).toBe('table')
  // Table des illustrations, au début.
  await caretAfter(page, 'Début.')
  await rb(page, 'table-of-figures')
  await dialog(page, 'figures').locator('[data-action="ok"]').click()
  const tof = page.locator('.fp-refblock[data-kind="figures"]')
  await expect(tof.locator('.fp-toc__text')).toHaveText(['Figure 1 : Un port'])
  await expect(tof.locator('.fp-toc__page')).toHaveText(['1'])
  // Annulable : Ctrl+Z la retire, Ctrl+Y la remet.
  await editor(page).focus()
  await page.keyboard.press(`${mod}+z`)
  await expect(tof).toHaveCount(0)
  await page.keyboard.press(`${mod}+y`)
  await expect(tof).toHaveCount(1)
  // Une deuxième image avant la première : les numéros suivent, partout.
  await page.evaluate(() => {
    const f = (window as any).folio
    const d = f.doc
    d.blocks.splice(1, 0, { type: 'image', src: d.blocks.find((x: any) => x.type === 'image').src, caption: [{ text: 'Figure ' }, { type: 'seq', label: 'figure' }, { text: ' : Avant' }] })
    f.loadDoc(d)
  })
  await expect(page.locator('.fp-figure figcaption')).toHaveText(['Figure 1 : Avant', 'Figure 2 : Un port'])
  await expect(page.locator('.fp-refblock[data-kind="figures"] .fp-toc__text')).toHaveText(['Figure 1 : Avant', 'Figure 2 : Un port'])
  errors.check()
})

test('signets et renvois : page, texte, étiquette ; Ctrl+clic y va ; lien #signet', async ({ page }, info) => {
  await openEditor(
    page,
    makeFile(info, 'renvois.html', {
      format: 'folio/doc',
      version: 1,
      meta: { lang: 'fr' },
      blocks: [{ type: 'heading', text: 'Introduction' }, 'Voir ici.', long(60), { type: 'heading', text: 'Annexe' }, { type: 'paragraph', style: 'caption', content: ['Figure ', { type: 'seq', label: 'figure' }, ' : Schéma'] }, 'Fin.'],
    }).url,
  )
  // Un signet sur « Fin ».
  await selectText(page, 'Fin')
  await tab(page, 'insert')
  await rb(page, 'insert-bookmark')
  const bm = dialog(page, 'bookmark')
  await expect(bm.locator('[data-field="bookmark-name"]')).toHaveValue('Fin')
  await bm.locator('[data-field="bookmark-name"]').fill('conclusion')
  await bm.locator('[data-action="add"]').click()
  await expect(bm).toBeHidden()
  // Renvoi : numéro de page du signet.
  await caretAfter(page, 'Voir ici')
  await page.keyboard.type(' (p. ')
  await rb(page, 'insert-crossref')
  const xr = dialog(page, 'xref')
  await xr.locator('[data-field="xref-type"]').selectOption('bookmark')
  await xr.locator('[data-field="xref-show"]').selectOption('page')
  await expect(xr.locator('[data-field="xref-list"] option')).toHaveText(['conclusion'])
  await xr.locator('[data-action="ok"]').click()
  await page.keyboard.type(')')
  await expect(page.locator('.fp-xref[data-show="page"]')).toHaveText('2')
  // Renvoi vers un titre (texte) puis vers une légende (étiquette et numéro) : un signet caché est posé.
  await page.keyboard.type(', ')
  await rb(page, 'insert-crossref')
  await xr.locator('[data-field="xref-type"]').selectOption('heading')
  await xr.locator('[data-field="xref-list"]').selectOption({ label: 'Annexe' })
  await xr.locator('[data-action="ok"]').click()
  await expect(page.locator('.fp-xref[data-show="text"]')).toHaveText('Annexe')
  await page.keyboard.type(', ')
  await rb(page, 'insert-crossref')
  await xr.locator('[data-field="xref-type"]').selectOption('cap:figure')
  await expect(xr.locator('[data-field="xref-show"]')).toHaveValue('label')
  await xr.locator('[data-action="ok"]').click()
  await expect(page.locator('.fp-xref[data-show="label"]')).toHaveText('Figure 1')
  const d = await docJson(page)
  const annexe = d.blocks.find((b: any) => b.type === 'heading' && b.content.some((x: any) => x.text === 'Annexe'))
  expect(annexe.content[0]).toMatchObject({ type: 'bookmark', name: expect.stringMatching(/^_Ref\d+$/) })
  // Le titre change : le renvoi suit.
  // (La première occurrence d'« Annexe » est le renvoi lui-même.)
  await selectText(page, 'Annexe', 1, true)
  await page.keyboard.type(' A')
  await expect(page.locator('.fp-xref[data-show="text"]')).toHaveText('Annexe A')
  // Ctrl+clic sur le renvoi : on va au titre.
  await page.locator('.fp-xref[data-show="label"]').click({ modifiers: [mod] })
  await expect.poll(() => page.evaluate(() => (window as any).folio && document.getSelection()?.anchorNode?.textContent)).toContain('Figure')
  // Les signets cachés ne sont pas listés, sauf demande.
  await rb(page, 'insert-bookmark')
  await expect(bm.locator('[data-field="bookmark-list"] option')).toHaveText(['conclusion'])
  await bm.locator('[data-field="bookmark-hidden"]').check()
  await expect(bm.locator('[data-field="bookmark-list"] option')).toHaveCount(3)
  await bm.locator('[data-action="close"]').click()
  // Annuler retire le dernier renvoi.
  await editor(page).focus()
  await page.keyboard.press(`${mod}+z`)
  await page.keyboard.press(`${mod}+z`)
  await page.keyboard.press(`${mod}+z`)
  await expect(page.locator('.fp-xref[data-show="label"]')).toHaveCount(0)
})

test('index : marquer une entrée et toutes ses occurrences (Alt+Maj+X), insérer l’index avec les pages', async ({ page }, info) => {
  await openEditor(
    page,
    makeFile(info, 'index.html', {
      format: 'folio/doc',
      version: 1,
      meta: { lang: 'fr' },
      blocks: ['La photosynthèse est vitale.', long(60), 'Encore la photosynthèse, et le chlorophylle.', 'Fin.'],
    }).url,
  )
  await selectText(page, 'photosynthèse')
  await page.keyboard.press('Alt+Shift+X')
  const dlg = dialog(page, 'mark-entry')
  await expect(dlg.locator('[data-field="xe-term"]')).toHaveValue('photosynthèse')
  await dlg.locator('[data-action="all"]').click()
  await expect(page.locator('.fp-toast').filter({ hasText: '2 entrées marquées' })).toBeVisible()
  await selectText(page, 'chlorophylle')
  await tab(page, 'references')
  await rb(page, 'mark-entry')
  await dlg.locator('[data-field="xe-sub"]').fill('pigment')
  await dlg.locator('[data-field="xe-bold"]').check()
  await dlg.locator('[data-action="ok"]').click()
  // Invisibles, sauf avec les marques de mise en forme.
  await expect(page.locator('.fp-xe').first()).toBeAttached()
  expect(await page.locator('.fp-xe').first().evaluate((el) => el.getBoundingClientRect().width)).toBe(0)
  await caretAfter(page, 'Fin.')
  await rb(page, 'insert-index')
  await dialog(page, 'index').locator('[data-action="ok"]').click()
  const ix = page.locator('.fp-refblock[data-kind="index"]')
  await expect(ix.locator('.fp-index__letter')).toHaveText(['C', 'P'])
  await expect(ix.locator('.fp-index__entry')).toHaveText(['chlorophylle', 'pigment, 2', 'photosynthèse, 1, 2'])
  await expect(ix.locator('.fp-index__entry[data-level="1"] a')).toHaveCSS('font-weight', '700')
  const xe = (await docJson(page)).blocks.flatMap((b: any) => b.content ?? []).filter((x: any) => x.type === 'xe')
  expect(xe).toEqual([{ type: 'xe', term: 'photosynthèse' }, { type: 'xe', term: 'photosynthèse' }, { type: 'xe', term: 'chlorophylle', sub: 'pigment', bold: true }])
})

test('table des références : marquer une citation (Alt+Maj+I), table par catégorie', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'toa.html', { format: 'folio/doc', version: 1, meta: { lang: 'fr' }, blocks: ['Selon Cass. civ. 1re, 3 mai 2000, la règle est claire.', 'Fin.'] }).url)
  await selectText(page, 'Cass. civ. 1re, 3 mai 2000')
  await page.keyboard.press('Alt+Shift+I')
  const dlg = dialog(page, 'mark-citation')
  await dlg.locator('[data-field="ta-short"]').fill('Cass. 2000')
  await dlg.locator('[data-action="ok"]').click()
  await caretAfter(page, 'Fin.')
  await tab(page, 'references')
  await rb(page, 'insert-authorities')
  await dialog(page, 'authorities').locator('[data-action="ok"]').click()
  const ta = page.locator('.fp-refblock[data-kind="authorities"]')
  await expect(ta.locator('.fp-index__letter')).toHaveText(['Jurisprudence'])
  await expect(ta.locator('.fp-authority')).toHaveText([/Cass\. civ\. 1re, 3 mai 2000.*1/])
})

test('sources : retrouvée par DOI (réseau simulé), citation, style, bibliographie, page citée', async ({ page }, info) => {
  const errors = watchErrors(page)
  await page.route('https://api.crossref.org/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ message: { type: 'journal-article', title: ['Molecular structure of nucleic acids'], author: [{ given: 'J. D.', family: 'Watson' }, { given: 'F. H. C.', family: 'Crick' }], 'container-title': ['Nature'], volume: '171', issue: '4356', page: '737-738', issued: { 'date-parts': [[1953]] }, DOI: '10.1038/171737a0' } }),
    }),
  )
  await openEditor(
    page,
    makeFile(info, 'sources.html', {
      format: 'folio/doc',
      version: 1,
      meta: { lang: 'fr' },
      sources: [{ id: 'Darwin1859', type: 'book', authors: ['Darwin, Charles'], title: 'On the Origin of Species', publisher: 'John Murray', year: '1859' }],
      blocks: ['Une découverte majeure.', 'Fin.'],
    }).url,
  )
  await caretAfter(page, 'majeure')
  await page.keyboard.type(' ')
  await tab(page, 'references')
  await rb(page, 'insert-citation')
  await pop(page).locator('[data-cite-menu="lookup"]').click()
  const src = dialog(page, 'source')
  await src.locator('[data-field="source-lookup"]').fill('https://doi.org/10.1038/171737a0')
  await src.locator('[data-source-lookup]').click()
  await expect(src.locator('[data-field="source-title"]')).toHaveValue('Molecular structure of nucleic acids')
  await expect(src.locator('[data-field="source-type"]')).toHaveValue('article')
  await expect(src.locator('[data-field="source-id"]')).toHaveValue('Watson1953')
  await expect(src.locator('[data-field="source-preview"]')).toContainText('Watson, J. D., & Crick, F. H. C. (1953).')
  await src.locator('[data-action="ok"]').click()
  await expect(page.locator('.fp-cite')).toHaveText('(Watson & Crick, 1953)')
  // Une deuxième citation, depuis la liste des sources.
  await caretAfter(page, 'Fin')
  await page.keyboard.type(' ')
  await rb(page, 'insert-citation')
  await pop(page).locator('[data-cite-source="Darwin1859"]').click()
  await expect(page.locator('.fp-cite')).toHaveText(['(Watson & Crick, 1953)', '(Darwin, 1859)'])
  // Page citée : modifier la citation.
  await page.locator('.fp-cite').nth(1).click()
  await rb(page, 'insert-citation')
  await pop(page).locator('[data-cite-menu="edit"]').click()
  await dialog(page, 'cite-edit').locator('[data-field="cite-locator"]').fill('12')
  await dialog(page, 'cite-edit').locator('[data-action="ok"]').click()
  await expect(page.locator('.fp-cite').nth(1)).toHaveText('(Darwin, 1859, p. 12)')
  // Bibliographie, puis style IEEE : citations et bibliographie suivent.
  await caretAfter(page, 'Fin')
  await page.keyboard.press('End')
  await rb(page, 'bibliography')
  await pop(page).locator('[data-bib="references"]').click()
  const bib = page.locator('.fp-refblock[data-kind="bibliography"]')
  await expect(bib.locator('.fp-refblock__title')).toHaveText('Références')
  await expect(bib.locator('.fp-bib__entry')).toHaveText([/^Darwin, C\. \(1859\)\. On the Origin of Species\. John Murray\.$/, /^Watson, J\. D\., & Crick, F\. H\. C\. \(1953\)/])
  await expect(bib.locator('.fp-bib__entry em').first()).toHaveText('On the Origin of Species')
  await rb(page, 'citation-style')
  await pop(page).locator('[data-citation-style="ieee"]').click()
  await expect(page.locator('.fp-cite')).toHaveText(['[1]', '[2, p. 12]'])
  await expect(bib.locator('.fp-bib__label')).toHaveText(['[1]', '[2]'])
  const d = await docJson(page)
  expect(d.citationStyle).toBe('ieee')
  expect(d.sources.map((s: any) => s.id)).toEqual(['Darwin1859', 'Watson1953'])
  expect(d.sources[1]).toMatchObject({ type: 'article', container: 'Nature', doi: '10.1038/171737a0', authors: ['Watson, J. D.', 'Crick, F. H. C.'] })
  // Le gestionnaire : une source citée ne se supprime pas.
  await rb(page, 'manage-sources')
  const mgr = dialog(page, 'sources')
  await expect(mgr.locator('[data-source]')).toHaveCount(2)
  await mgr.locator('[data-source-delete="Darwin1859"]').click()
  await expect(page.locator('.fp-toast').filter({ hasText: 'est citée' })).toBeVisible()
  await expect(mgr.locator('[data-source]')).toHaveCount(2)
  await mgr.locator('[data-action="close"]').click()
  // Annuler le changement de style.
  await editor(page).focus()
  await page.keyboard.press(`${mod}+z`)
  await expect(page.locator('.fp-cite').first()).toHaveText('(Watson & Crick, 1953)')
  errors.check()
})

test('hors ligne : la recherche par DOI ne part pas sur le réseau', async ({ page }, info) => {
  let hits = 0
  await page.route('https://api.crossref.org/**', (route) => {
    hits++
    return route.abort()
  })
  await openEditor(page, makeFile(info, 'off.html', { format: 'folio/doc', version: 1, blocks: ['x'] }).url)
  await page.evaluate(() => localStorage.setItem('folio-pages:settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('folio-pages:settings') ?? '{}'), offline: true })))
  await page.reload()
  await page.waitForFunction(() => !!(window as any).folio?.doc)
  await tab(page, 'references')
  await rb(page, 'manage-sources')
  await dialog(page, 'sources').locator('[data-source-new]').click()
  const src = dialog(page, 'source')
  await src.locator('[data-field="source-lookup"]').fill('10.1038/171737a0')
  await src.locator('[data-source-lookup]').click()
  await expect(src.locator('.fp-form__hint').first()).toContainText('hors ligne')
  expect(hits).toBe(0)
})
