// Interface réorganisée (0.6) : barre d'onglets, mode, partager, ruban replié au
// défilement, liens que l'on peut suivre, menu contextuel.

import { expect, test, type Page } from '@playwright/test'
import { blocks, caretAfter, docJson, editor, makeFile, mod, openEditor, rb, removeFsAccess, selectText, tab, watchErrors } from './helpers'

const LONG = Array.from({ length: 60 }, (_, i) => `Paragraphe ${i + 1} : du texte pour remplir la page et la faire défiler.`)
const DOC = {
  format: 'folio/doc',
  version: 1,
  id: 'interface-01',
  meta: { title: 'Interface' },
  blocks: [
    { type: 'heading', text: 'Objectifs du trimestre' },
    { content: ['Voir ', { text: 'le site', link: 'https://exemple.org/page' }, ' et ', { text: 'les objectifs', link: '#objectifs-du-trimestre' }, '.'] },
    { content: ['Une formule ', { type: 'math', tex: 'x^2' }, ' ici.'] },
    { type: 'table', rows: [['A', 'B'], ['1', '2']] },
    ...LONG,
  ],
}

const ctx = (page: Page) => page.locator('[data-context-menu]')
async function rightClick(page: Page, text: string) {
  const el = editor(page).getByText(text, { exact: false }).first()
  const box = (await el.boundingBox())!
  await page.mouse.click(box.x + 4, box.y + box.height / 2, { button: 'right' })
  await expect(ctx(page)).toBeVisible()
}
/** window.open simulé : les adresses ouvertes. */
async function stubOpen(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__opened = []
    window.open = ((url: string, target: string, features: string) => {
      ;(window as any).__opened.push([url, target, features])
      return null
    }) as typeof window.open
  })
}
const opened = (page: Page) => page.evaluate(() => (window as any).__opened as string[][])

test('barre d’onglets : Fichier d’abord, les onglets, puis Commentaires, Mode et Partager', async ({ page }, info) => {
  const errs = watchErrors(page)
  await openEditor(page, makeFile(info, 'ui.html', DOC).url)
  const tabs = await page.locator('.fp-ribbon__bar').evaluate((bar) =>
    Array.from(bar.querySelectorAll<HTMLElement>('[data-menu], .fp-ribbon__tab:not([hidden])')).map((b) => b.dataset.menu ?? b.dataset.tab),
  )
  expect(tabs).toEqual(['file', 'home', 'insert', 'design', 'layout', 'references', 'mailings', 'review', 'draw', 'view', 'developer', 'ai', 'help'])
  await expect(page.locator('.fp-ribbon__side #fp-comments-btn')).toContainText('Commentaires')
  await expect(page.locator('#fp-mode')).toContainText('Édition')
  await expect(page.locator('#fp-share')).toContainText('Partager')
  // Les menus Édition, Insertion… ont disparu : leurs commandes sont dans le ruban et la recherche.
  await expect(page.locator('[data-menu="edit"]')).toHaveCount(0)
  // Insertion : page vierge, commentaire, en-tête, pied de page, numéros, équation.
  await tab(page, 'insert')
  for (const c of ['blank-page', 'page-break', 'insert-table', 'insert-image', 'insert-link', 'insert-comment', 'edit-header', 'edit-footer', 'page-numbers', 'insert-equation', 'insert-symbol']) {
    await expect(page.locator(`.fp-ribbon [data-cmd="${c}"]`).first(), c).toBeVisible()
  }
  // Création : le fond de page y est ; Aide : à propos, langue ; IA : le JSON.
  await tab(page, 'design')
  await expect(page.locator('.fp-ribbon [data-cmd="page-color"]')).toBeVisible()
  await tab(page, 'ai')
  await expect(page.locator('.fp-ribbon [data-cmd="copy-compact"]')).toBeVisible()
  await tab(page, 'help')
  await rb(page, 'about')
  await expect(page.locator('dialog[data-dialog="about"]')).toBeVisible()
  errs.check()
})

test('barre d’état : les pastilles « Protégé » et « Hors ligne » n’apparaissent qu’à bon escient', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'doc.html', DOC).url)
  await expect(page.locator('#fp-lock')).toBeHidden()
  await expect(page.locator('#fp-offline')).toBeHidden()
  // le mode hors ligne fait apparaître sa pastille ; un clic dessus le coupe
  await tab(page, 'help')
  await rb(page, 'offline')
  await expect(page.locator('#fp-offline')).toBeVisible()
  await page.locator('#fp-offline').click()
  await expect(page.locator('#fp-offline')).toBeHidden()
})

test('mode : Révision active le suivi, Lecture le mode lecture, Édition revient', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'ui.html', DOC).url)
  await page.locator('#fp-mode').click()
  await page.locator('[data-mode="reviewing"]').click()
  // Le nom de l'auteur des modifications, demandé une fois.
  await page.locator('[data-dialog="author-name"] [data-field="author-name"]').fill('Camille')
  await page.locator('[data-dialog="author-name"] [data-action="ok"]').click()
  await expect(page.locator('#fp-mode')).toContainText('Révision')
  expect((await docJson(page)).trackChanges).toBe(true)
  await caretAfter(page, 'Une formule')
  await page.keyboard.type('X')
  expect((await blocks(page))[2].content[1]).toMatchObject({ text: 'X', inserted: {} })
  await page.locator('#fp-mode').click()
  await page.locator('[data-mode="viewing"]').click()
  await expect(page.locator('#fp-readbar')).toBeVisible()
  await expect(page.locator('#fp-mode')).toContainText('Lecture')
  // En lecture, le ruban est caché : la barre de lecture en fait sortir.
  await page.locator('#fp-read-exit').click()
  await expect(page.locator('#fp-readbar')).toBeHidden()
  await expect(page.locator('#fp-mode')).toContainText('Révision')
  await page.locator('#fp-mode').click()
  await page.locator('[data-mode="editing"]').click()
  expect((await docJson(page)).trackChanges).toBe(false)
  // Commentaires : le bouton montre ou cache le volet.
  const pane = page.locator('.fp-cm')
  const before = await pane.isVisible()
  await page.locator('#fp-comments-btn').click()
  await expect(pane).toBeVisible({ visible: !before })
})

test('Partager → Exporter en .docx télécharge le fichier', async ({ page }, info) => {
  await removeFsAccess(page)
  await openEditor(page, makeFile(info, 'ui.html', DOC).url)
  await page.locator('#fp-share').click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-share="docx"]').click()])
  expect(download.suggestedFilename()).toBe('ui.docx')
})

test('le ruban se replie en descendant, revient en remontant ou par un onglet', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'ui.html', DOC).url)
  const ribbon = page.locator('#fp-ribbon')
  const panel = page.locator('.fp-ribbon__panel')
  await expect(ribbon).not.toHaveClass(/is-autohidden/)
  const canvas = page.locator('#fp-canvas')
  await canvas.hover()
  await page.mouse.wheel(0, 600)
  await expect(ribbon).toHaveClass(/is-autohidden/)
  // Les onglets restent ; le panneau est plié.
  await expect(page.locator('.fp-ribbon__tab[data-tab="home"]')).toBeVisible()
  await expect.poll(async () => (await panel.boundingBox())?.height ?? 0).toBeLessThan(4)
  // Un onglet cliqué : il revient.
  await tab(page, 'insert')
  await expect(ribbon).not.toHaveClass(/is-autohidden/)
  await page.waitForTimeout(450)
  await canvas.hover()
  await page.mouse.wheel(0, 600)
  await expect(ribbon).toHaveClass(/is-autohidden/)
  // En haut du document : il revient.
  await canvas.evaluate((c) => c.scrollTo(0, 0))
  await expect(ribbon).not.toHaveClass(/is-autohidden/)
  // Désactivé dans Affichage → Options : il reste.
  await tab(page, 'view')
  await rb(page, 'view-autohide')
  await page.waitForTimeout(450)
  await canvas.hover()
  await page.mouse.wheel(0, 900)
  await page.waitForTimeout(450)
  await expect(ribbon).not.toHaveClass(/is-autohidden/)
})

test('liens : Ctrl+clic les suit, un clic les modifie ; la bulle montre l’adresse ; en lecture, un clic suffit', async ({ page }, info) => {
  const errs = watchErrors(page)
  await stubOpen(page)
  await openEditor(page, makeFile(info, 'ui.html', DOC).url)
  const link = editor(page).locator('a[href="https://exemple.org/page"]')
  // Un clic : le curseur dans le lien, la bulle apparaît.
  await link.click()
  expect(await opened(page)).toEqual([])
  const bubble = page.locator('.fp-linkbubble')
  await expect(bubble).toBeVisible()
  await expect(bubble.locator('.fp-linkbubble__url')).toHaveText('exemple.org/page')
  // L'adresse de la bulle ouvre le lien, dans un nouvel onglet isolé.
  await bubble.locator('.fp-linkbubble__url').click()
  expect(await opened(page)).toEqual([['https://exemple.org/page', '_blank', 'noopener,noreferrer']])
  // Ctrl+clic aussi.
  await link.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
  expect((await opened(page)).length).toBe(2)
  // Lien interne : on va au titre.
  await editor(page).locator('a[href="#objectifs-du-trimestre"]').click({ modifiers: ['Control'] })
  expect((await opened(page)).length).toBe(2)
  // En lecture : un simple clic ouvre (et la bulle n'apparaît pas).
  await tab(page, 'view')
  await rb(page, 'view-read')
  await link.click()
  expect((await opened(page)).length).toBe(3)
  await expect(bubble).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(page.locator('#fp-readbar')).toBeHidden()
  // Bulle → Retirer : plus de lien, le texte reste.
  await link.click()
  await bubble.locator('[data-link="remove"]').click()
  expect((await blocks(page))[1].content[0]).toEqual({ text: 'Voir le site et ' })
  await expect(bubble).toBeHidden()
  // Bulle → Modifier : la fenêtre du lien.
  await editor(page).locator('a[href^="#"]').click()
  await bubble.locator('[data-link="edit"]').click()
  await expect(page.locator('[data-dialog="link"]')).toBeVisible()
  errs.check()
})

test('menu contextuel sur du texte : recherche, commandes, barre de mise en forme ; Échap', async ({ page }, info) => {
  const errs = watchErrors(page)
  await openEditor(page, makeFile(info, 'ui.html', DOC).url)
  await selectText(page, 'Paragraphe 1 ')
  const sel = editor(page).getByText('Paragraphe 1 :', { exact: false }).first()
  const box = (await sel.boundingBox())!
  await page.mouse.click(box.x + 10, box.y + box.height / 2, { button: 'right' })
  await expect(ctx(page)).toBeVisible()
  for (const id of ['cut', 'copy', 'paste', 'paste-plain', 'font', 'paragraph', 'link', 'new-comment']) await expect(ctx(page).locator(`[data-ctx="${id}"]`), id).toBeVisible()
  // La barre de mise en forme : Gras sur la sélection.
  await page.locator('.fp-ctx-mini [data-cmd="bold"]').click()
  expect((await blocks(page))[4].content[0]).toMatchObject({ text: expect.stringMatching(/^Paragraphe 1 ?$/), bold: true })
  // Échap ferme.
  await page.keyboard.press('Escape')
  await expect(ctx(page)).toHaveCount(0)
  await expect(page.locator('.fp-ctx-mini')).toHaveCount(0)
  // Recherche dans les menus : une lettre part dans la recherche.
  await rightClick(page, 'Paragraphe 2')
  await page.keyboard.type('itali')
  await expect(ctx(page).locator('.fp-ctx__item').first()).toContainText('Italique')
  await page.keyboard.press('Enter')
  await expect(ctx(page)).toHaveCount(0)
  // Paragraphe… ouvre la fenêtre.
  await rightClick(page, 'Paragraphe 3')
  await ctx(page).locator('[data-ctx="paragraph"]').click()
  await expect(page.locator('[data-dialog="paragraph"]')).toBeVisible()
  errs.check()
})

test('menu contextuel selon l’objet : lien, formule, tableau', async ({ page }, info) => {
  await stubOpen(page)
  await openEditor(page, makeFile(info, 'ui.html', DOC).url)
  // Lien.
  await rightClick(page, 'le site')
  // Lien ▸ : ouvrir, copier, modifier, supprimer (dans le sous-menu, comme d'habitude).
  await ctx(page).locator('[data-ctx="link"]').hover()
  for (const id of ['open-link', 'copy-link', 'edit-link', 'remove-link']) await expect(page.locator(`.fp-ctx--sub [data-ctx="${id}"]`), id).toBeVisible()
  await page.locator('.fp-ctx--sub [data-ctx="open-link"]').click()
  expect(await opened(page)).toEqual([['https://exemple.org/page', '_blank', 'noopener,noreferrer']])
  // (Curseur hors du lien : sa bulle ne couvre plus la ligne suivante.)
  await caretAfter(page, 'Paragraphe 1 ')
  await expect(page.locator('.fp-linkbubble')).toBeHidden()
  // Formule : elle est sélectionnée, et se modifie.
  const math = editor(page).locator('.fp-math').first()
  const mb = (await math.boundingBox())!
  await page.mouse.click(mb.x + mb.width / 2, mb.y + mb.height / 2, { button: 'right' })
  await ctx(page).locator('[data-ctx="edit-equation"]').click()
  await expect(page.locator('[data-dialog="equation"] [data-field="tex"]')).toHaveValue('x^2')
  await page.keyboard.press('Escape')
  // Tableau : Insérer → ligne en dessous.
  await rightClick(page, 'A')
  await ctx(page).locator('[data-ctx="table-insert"]').hover()
  await page.locator('.fp-ctx--sub [data-ctx="row-below"]').click()
  const t = (await blocks(page))[3]
  expect(t.rows).toHaveLength(3)
  // Maj+clic droit : pas notre menu (celui du navigateur, avec l'orthographe).
  const p = (await editor(page).getByText('Paragraphe 5 :').boundingBox())!
  await page.keyboard.down('Shift')
  await page.mouse.click(p.x + 5, p.y + 5, { button: 'right' })
  await page.keyboard.up('Shift')
  await expect(ctx(page)).toHaveCount(0)
})

test('menu contextuel au clavier (Maj+F10) ; page vierge', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'ui.html', DOC).url)
  await caretAfter(page, 'Paragraphe 1 :')
  await page.keyboard.press('Shift+F10')
  await expect(ctx(page)).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(ctx(page)).toHaveCount(0)
  // Insertion → Page vierge : saut, paragraphe vide (le curseur y est), saut.
  await tab(page, 'insert')
  await rb(page, 'blank-page')
  await page.keyboard.type('page blanche')
  const bs = await blocks(page)
  const i = bs.findIndex((b: any) => b.content?.[0]?.text === 'page blanche')
  expect(bs[i - 1].type).toBe('pagebreak')
  expect(bs[i + 1].type).toBe('pagebreak')
  await page.keyboard.press(`${mod}+z`)
})
