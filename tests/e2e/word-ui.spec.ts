// Ruban et menus disposés comme dans les traitements de texte habituels :
// groupes dans l'ordre, fonctions à venir grisées, clic droit partout,
// raccourcis d'édition où que soit le focus, et les petites fonctions ajoutées.

import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { blocks, docJson, editor, makeFile, mod, openEditor, pngDataUri, rb, selectText, tab, watchErrors } from './helpers'

const doc = (b: unknown[], extra: Record<string, unknown> = {}) => ({ format: 'folio/doc', version: 1, meta: { title: 'Essai', lang: 'fr' }, blocks: b, ...extra })
async function open(page: Page, info: TestInfo, b: unknown[], extra: Record<string, unknown> = {}) {
  await openEditor(page, makeFile(info, 'doc.html', doc(b, extra)).url)
}
const groups = (page: Page) => page.locator('.fp-ribbon__panel > .fp-rb-group').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.group))
const ctx = (page: Page) => page.locator('[data-context-menu]')
const ctxIds = (page: Page) => ctx(page).locator('.fp-ctx__list > [data-ctx]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.ctx))

test('chaque onglet a les groupes habituels, dans l’ordre', async ({ page }, info) => {
  await open(page, info, ['Texte', { type: 'image', src: pngDataUri(40, 30) }])
  const expected: Record<string, string[]> = {
    home: ['clipboard', 'font', 'paragraph', 'styles', 'editing', 'voice'],
    insert: ['pages', 'tables', 'illustrations', 'links', 'insert-comments', 'headers-footers', 'text', 'symbols', 'blocks'],
    design: ['themes', 'page-background'],
    layout: ['page-setup', 'layout-paragraph', 'arrange', 'sections'],
    references: ['toc', 'notes', 'research', 'citations', 'captions', 'index', 'glossary', 'authorities'],
    mailings: ['mm-send', 'mm-create', 'mm-start', 'mm-write', 'mm-preview', 'mm-finish'],
    review: ['proofing', 'speech', 'accessibility', 'review-language', 'comments', 'markup', 'tracking', 'compare', 'protect', 'redact'],
    view: ['views', 'immersive', 'dark-mode', 'page-movement', 'show', 'zoom', 'window', 'document', 'options'],
    help: ['help', 'updates'],
  }
  for (const [id, want] of Object.entries(expected)) {
    await tab(page, id)
    expect(await groups(page), id).toEqual(want)
  }
  // Format de l'image : l'onglet contextuel de l'image sélectionnée.
  await page.locator('.fp-figure__frame').click()
  await expect(page.locator('.fp-ribbon__tab[data-tab="image"]')).toHaveText('Format de l’image')
  expect(await groups(page)).toEqual(['image-adjust', 'picture-styles', 'image-access', 'image-arrange', 'image-size'])
})

test('une fonction à venir est grisée, sa bulle le dit, et le clic ne fait rien', async ({ page }, info) => {
  const errors = watchErrors(page)
  await open(page, info, ['Texte'])
  await tab(page, 'insert')
  const chart = page.locator('.fp-ribbon [data-cmd="insert-3d"]')
  await expect(chart).toHaveAttribute('aria-disabled', 'true')
  await expect(chart).toHaveAttribute('title', /bientôt dans Folio Pages/)
  const before = JSON.stringify(await blocks(page))
  await chart.click({ force: true })
  expect(JSON.stringify(await blocks(page))).toBe(before)
  await expect(page.locator('[data-popover], dialog[open]')).toHaveCount(0)
  // Dans un menu aussi : Sélectionner ▸ Sélectionner les objets.
  await tab(page, 'home')
  await rb(page, 'select')
  await expect(page.locator('[data-popover] .is-soon').first()).toHaveAttribute('title', /bientôt/)
  errors.check()
})

test('menu contextuel du texte, dans l’ordre habituel ; Options de collage en rangée', async ({ page }, info) => {
  await open(page, info, ['Un paragraphe de texte.'])
  await editor(page).getByText('paragraphe').click({ button: 'right' })
  await expect(ctx(page)).toBeVisible()
  const ids = await ctxIds(page)
  const order = ['cut', 'copy', 'paste-options', 'copy-link-location', 'font', 'paragraph', 'synonyms', 'read-aloud', 'link', 'new-comment']
  expect(ids.filter((i) => order.includes(i!))).toEqual(order)
  await expect(ctx(page).locator('[data-ctx="paste-options"] [data-ctx="paste"]')).toBeVisible()
  await expect(ctx(page).locator('[data-ctx="paste-options"] [data-ctx="paste-plain"]')).toBeVisible()
  await expect(ctx(page).locator('[data-ctx="synonyms"]')).toBeVisible()
  // Lien ▸ Insérer un lien…
  await ctx(page).locator('[data-ctx="link"]').hover()
  await page.locator('.fp-ctx--sub [data-ctx="insert-link"]').click()
  await expect(page.locator('dialog[data-dialog="link"]')).toBeVisible()
})

test('menu contextuel d’une image, dans l’ordre habituel, avec Style et Rogner dessous', async ({ page }, info) => {
  await open(page, info, [{ type: 'image', src: pngDataUri(60, 40) }, 'après'])
  await page.locator('.fp-figure__frame').click({ button: 'right' })
  const order = ['cut', 'copy', 'paste-options', 'edit-picture', 'change-picture', 'group', 'bring-front', 'send-back', 'link', 'save-picture', 'caption', 'picture-layout', 'wrap', 'alt-text', 'size', 'format-picture']
  expect(await ctxIds(page)).toEqual(order)
  await expect(page.locator('.fp-ctx-mini--image [data-cmd="mini-image-crop"]')).toBeVisible()
  // Format de l'image… ouvre l'onglet de l'image.
  await ctx(page).locator('[data-ctx="format-picture"]').click()
  await expect(page.locator('.fp-ribbon__tab[data-tab="image"]')).toHaveAttribute('aria-selected', 'true')
})

test('clic droit partout : marge et fond (menu du texte), ruban et barre d’état (menu de l’interface), champ de saisie (navigateur)', async ({ page }, info) => {
  await open(page, info, ['Premier paragraphe.', 'Second paragraphe.'])
  // Le fond gris, à gauche de la page.
  const page0 = (await page.locator('#fp-page').boundingBox())!
  await page.mouse.click(Math.max(8, page0.x - 40), page0.y + 120, { button: 'right' })
  await expect(ctx(page)).toBeVisible()
  await expect(ctx(page).locator('[data-ctx="font"]')).toBeVisible()
  await expect(page.locator('.fp-ctx-mini [data-cmd="bold"]')).toBeVisible()
  await page.keyboard.press('Escape')
  // Le ruban : réduire le ruban, puis l'afficher.
  await page.locator('.fp-ribbon__tab[data-tab="home"]').click({ button: 'right' })
  await expect(ctx(page).locator('[data-ctx="toggle-ribbon"]')).toBeVisible()
  await expect(page.locator('.fp-ctx-mini:not([hidden])')).toHaveCount(0)
  await ctx(page).locator('[data-ctx="toggle-ribbon"]').click()
  await expect(page.locator('#fp-ribbon')).toHaveClass(/is-collapsed/)
  await page.locator('.fp-statusbar').click({ button: 'right', position: { x: 600, y: 10 } })
  await expect(ctx(page).locator('[data-ctx="toggle-ribbon"]')).toContainText('Afficher le ruban')
  await ctx(page).locator('[data-ctx="toggle-ribbon"]').click()
  await expect(page.locator('#fp-ribbon')).not.toHaveClass(/is-collapsed/)
  // Un champ de saisie garde le menu du navigateur (on ne l'intercepte pas).
  const prevented = await page.locator('#fp-cmdsearch').evaluate((el) => {
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    el.dispatchEvent(ev)
    return ev.defaultPrevented
  })
  expect(prevented).toBe(false)
  await expect(ctx(page)).toHaveCount(0)
})

test('Ctrl+Z et les raccourcis d’édition marchent même quand le focus est sur le ruban', async ({ page }, info) => {
  await open(page, info, ['Texte à mettre en gras.'])
  await selectText(page, 'gras')
  // Un clic sur le bouton du ruban, puis Ctrl+Z : le gras s'en va.
  await page.locator('.fp-ribbon [data-cmd="bold"]').focus()
  await page.locator('.fp-ribbon [data-cmd="bold"]').click()
  expect(JSON.stringify((await blocks(page))[0])).toContain('"bold":true')
  await page.locator('.fp-ribbon [data-cmd="bold"]').focus()
  await page.keyboard.press(`${mod}+z`)
  expect(JSON.stringify((await blocks(page))[0])).not.toContain('"bold"')
  await page.keyboard.press(`${mod}+y`)
  expect(JSON.stringify((await blocks(page))[0])).toContain('"bold":true')
  // Ctrl+I depuis le ruban met en italique la sélection du document.
  await page.locator('.fp-ribbon [data-cmd="bold"]').focus()
  await page.keyboard.press(`${mod}+i`)
  expect(JSON.stringify((await blocks(page))[0])).toContain('"italic":true')
})

test('rogner par le ruban, puis Ctrl+Z annule le rognage (le focus est resté sur le bouton)', async ({ page }, info) => {
  await open(page, info, [{ type: 'image', src: pngDataUri(100, 100), width: 200 }, 'après'])
  await page.locator('.fp-figure__frame').click()
  await rb(page, 'image-crop')
  const box = (await page.locator('.fp-cropper').boundingBox())!
  const handle = (await page.locator('.fp-cropper__handle--w').boundingBox())!
  await page.mouse.move(handle.x + 2, handle.y + 10)
  await page.mouse.down()
  await page.mouse.move(handle.x + 2 + box.width * 0.25, handle.y + 10, { steps: 4 })
  await page.mouse.up()
  expect((await blocks(page))[0].crop.left).toBeGreaterThan(20)
  // Le rognage par la fenêtre, puis Ctrl+Z : le focus revient au bouton du ruban.
  await page.keyboard.press(`${mod}+z`)
  expect((await blocks(page))[0].crop).toBeUndefined()
  await page.keyboard.press('Escape')
  await page.locator('.fp-figure__frame').click()
  await rb(page, 'image-crop-menu')
  await page.locator('[data-crop-menu="dialog"]').click()
  await page.locator('[data-dialog="crop"] [data-crop="top"]').fill('15')
  await page.locator('[data-dialog="crop"] [data-action="ok"]').click()
  expect((await blocks(page))[0].crop.top).toBe(15)
  await page.keyboard.press(`${mod}+z`)
  expect((await blocks(page))[0].crop).toBeUndefined()
})

test('Trier, liste à plusieurs niveaux, bordures ; Ajouter le texte (niveau de titre)', async ({ page }, info) => {
  await open(page, info, ['Poire', 'abricot', 'Cerise', 'Banane 10', 'Banane 9'])
  await page.keyboard.press(`${mod}+a`)
  await rb(page, 'sort')
  await page.locator('[data-popover] [data-sort="asc"]').click()
  expect((await blocks(page)).map((b: any) => b.content[0].text)).toEqual(['abricot', 'Banane 9', 'Banane 10', 'Cerise', 'Poire'])
  await page.keyboard.press(`${mod}+z`)
  expect((await blocks(page)).map((b: any) => b.content[0].text)).toEqual(['Poire', 'abricot', 'Cerise', 'Banane 10', 'Banane 9'])
  // Liste à plusieurs niveaux.
  await page.keyboard.press(`${mod}+a`)
  await rb(page, 'multilevel')
  await page.locator('[data-popover] [data-multilevel="outline"]').click()
  expect((await blocks(page))[0]).toMatchObject({ type: 'list', style: 'number', numbering: 'outline' })
  // Bordures ▸ Bordures extérieures, puis Aucune bordure.
  await editor(page).getByText('Poire').click()
  await rb(page, 'para-border-menu')
  await page.locator('[data-popover] [data-border="box"]').click()
  expect(JSON.stringify(await blocks(page))).toContain('"border"')
  await rb(page, 'para-border-menu')
  await page.locator('[data-popover] [data-border="none"]').click()
  expect(JSON.stringify(await blocks(page))).not.toContain('"border"')
})

test('Références → Ajouter le texte : le paragraphe devient un titre du niveau choisi', async ({ page }, info) => {
  await open(page, info, ['Introduction', 'Cerise'])
  await editor(page).getByText('Cerise').click()
  await tab(page, 'references')
  await rb(page, 'add-text')
  await page.locator('[data-popover] [data-level="2"]').click()
  expect((await blocks(page)).find((b: any) => JSON.stringify(b).includes('Cerise'))).toMatchObject({ type: 'heading', level: 2 })
})

test('Création : couleurs et polices d’un autre thème, espacement des paragraphes', async ({ page }, info) => {
  await open(page, info, ['Texte'])
  await tab(page, 'design')
  const before = (await docJson(page)).theme
  await rb(page, 'theme-colors')
  await page.locator('[data-popover] [data-colors="ink"]').click()
  let th = (await docJson(page)).theme
  expect(th.fonts).toEqual(before.fonts)
  expect(th.colors).not.toEqual(before.colors)
  await rb(page, 'theme-fonts')
  await page.locator('[data-popover] [data-fonts="classic"]').click()
  th = (await docJson(page)).theme
  expect(th.fonts).not.toEqual(before.fonts)
  await rb(page, 'para-spacing')
  await page.locator('[data-popover] [data-spacing="double"]').click()
  expect((await docJson(page)).styles.normal).toMatchObject({ line: 2, spacing: { before: 0, after: 8 } })
  await rb(page, 'para-spacing')
  await page.locator('[data-popover] [data-spacing="default"]').click()
  expect((await docJson(page)).styles.normal?.line).toBeUndefined()
})

test('vérifier l’accessibilité : image sans texte de remplacement, tableau sans en-tête, titre sauté ; « Afficher »', async ({ page }, info) => {
  await open(page, info, [{ type: 'heading', level: 1, text: 'Rapport' }, { type: 'heading', level: 3, text: 'Détail' }, { type: 'image', src: pngDataUri(30, 30) }, { type: 'table', header: false, rows: [['a', 'b']] }, { content: [{ text: 'ici', link: 'https://exemple.org' }] }])
  await tab(page, 'review')
  await rb(page, 'check-access')
  const dlg = page.locator('[data-dialog="a11y"]')
  for (const k of ['alt', 'tableHeader', 'headingSkip', 'vagueLink']) await expect(dlg.locator(`[data-a11y="${k}"]`), k).toHaveCount(1)
  await expect(dlg.locator('[data-a11y="noTitle"]')).toHaveCount(0)
  await dlg.locator('[data-a11y="alt"] [data-a11y-go]').click()
  await expect(page.locator('.fp-figure.is-selected')).toBeVisible()
})

test('mode Focus (Échap pour sortir), zoom 100 % et une page, propriétés dans Affichage', async ({ page }, info) => {
  await open(page, info, ['Texte'])
  await tab(page, 'view')
  await rb(page, 'focus-mode')
  await expect(page.locator('#fp-ribbon')).toBeHidden()
  await expect(page.locator('#fp-focus-exit')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('#fp-ribbon')).toBeVisible()
  await expect(page.locator('#fp-focus-exit')).toHaveCount(0)
  await rb(page, 'zoom-page')
  const z = await page.evaluate(() => JSON.parse(localStorage.getItem('folio-pages:settings') ?? '{}').zoom)
  expect(z).toBeLessThan(1)
  await rb(page, 'zoom-100')
  await expect(page.locator('.fp-statusbar')).toContainText('100 %')
  await rb(page, 'properties')
  await expect(page.locator('[data-dialog="properties"]')).toBeVisible()
})

test('Format de l’image : cadre de la galerie, hauteur qui garde les proportions, habillage et rotation par menus', async ({ page }, info) => {
  await open(page, info, [{ type: 'image', src: pngDataUri(100, 50), width: 200 }, 'après'])
  await page.locator('.fp-figure__frame').click()
  await page.locator('.fp-ribbon [data-frame="accent1"]').click()
  expect((await blocks(page))[0].border).toBe('accent1')
  const height = page.locator('[data-cmd="image-height"]')
  await expect(height).toHaveValue('100')
  await height.fill('50')
  await height.press('Enter')
  expect(Math.abs((await blocks(page))[0].width - 100)).toBeLessThanOrEqual(1)
  await rb(page, 'image-wrap')
  await page.locator('[data-popover] [data-wrap="left"]').click()
  expect((await blocks(page))[0]).toMatchObject({ wrap: 'left', align: 'left' })
  await rb(page, 'image-reset-menu')
  await page.locator('[data-popover] [data-reset="all"]').click()
  expect((await blocks(page))[0].border).toBeUndefined()
  expect((await blocks(page))[0].width || undefined).toBeUndefined()
})

test('barre du menu contextuel : Styles, avec son libellé, applique un style', async ({ page }, info) => {
  await open(page, info, ['Un titre à venir'])
  await editor(page).getByText('titre').click({ button: 'right' })
  const styles = page.locator('.fp-ctx-mini [data-cmd="styles-more"]')
  await expect(styles).toContainText('Styles')
  await styles.click()
  await page.locator('[data-popover] [data-style-id="heading1"]').click()
  expect((await blocks(page))[0]).toMatchObject({ type: 'heading', level: 1 })
})

test('Aide → Afficher la visite ouvre le document de démonstration dans un nouvel onglet', async ({ page }, info) => {
  await open(page, info, ['Texte'])
  await tab(page, 'help')
  const [demo] = await Promise.all([page.context().waitForEvent('page'), rb(page, 'training')])
  await demo.waitForFunction(() => !!(window as any).folio?.doc, null, { timeout: 15_000 })
  expect(await demo.evaluate(() => (window as any).folio.doc.meta.title)).toMatch(/Folio Pages/)
  await demo.close()
})

test('cases à cocher, boutons radio et curseurs : dessinés par l’application, cochés à l’accent', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'cases.html', { format: 'folio/doc', version: 1, blocks: ['x'] }).url)
  await page.evaluate(() => {
    const box = document.createElement('div')
    box.id = 'probe'
    box.innerHTML = '<input type="checkbox" id="c1"><input type="checkbox" id="c2" checked><input type="radio" id="r1" checked><input type="range" id="s1" class="fp-input">'
    document.body.append(box)
  })
  const st = (id: string, prop: string) => page.evaluate(([i, p]) => getComputedStyle(document.getElementById(i)!).getPropertyValue(p), [id, prop])
  for (const id of ['c1', 'c2', 'r1', 's1']) expect(await st(id, 'appearance')).toBe('none')
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fp-accent').trim())
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
  expect(await st('c2', 'background-color')).toBe(rgb(accent))
  expect(await st('c1', 'background-color')).not.toBe(rgb(accent))
  expect(await st('r1', 'border-radius')).toBe('50%')
  expect(await st('s1', 'border-top-width')).toBe('0px')
  // cocher au clic reste natif
  await page.locator('#c1').click()
  expect(await page.locator('#c1').isChecked()).toBe(true)
  await expect.poll(() => st('c1', 'background-color')).toBe(rgb(accent))
})
