// Phase 2 : un document riche survit à l'enregistrement ; le JSON pour une IA
// laisse les images de côté et les retrouve au retour ; zoom, propriétés,
// statistiques, collage, préférences, langue.

import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { blocks, caretAfter, caretToEnd, docJson, docOfFile, editor, makeFile, mod, openEditor, pngDataUri, rb, removeFsAccess, saveByDownload, selectText, tab, watchErrors } from './helpers'

const RICH = {
  format: 'folio/doc',
  version: 1,
  meta: { title: 'Dossier complet', author: 'Camille', keywords: ['essai', 'phase 2'], lang: 'fr' },
  theme: { name: 'classic', colors: { accent1: '#123456' } },
  styles: { note: { name: 'Note', basedOn: 'normal', italic: true, color: 'accent2' }, heading2: { color: 'accent3' } },
  blocks: [
    { type: 'paragraph', style: 'title', text: 'Dossier complet' },
    { type: 'heading', level: 2, md: 'Résumé', keepNext: true },
    { md: 'Un **texte** riche, ==non==, avec {{page}} sur {{pages}}, un [lien](https://example.org) et H~2~O.', align: 'justify', indent: { first: 18 }, line: 1.5 },
    { content: [{ text: 'couleurs', color: 'accent1', highlight: 'yellow', font: 'Newsreader', size: 13, letterSpacing: 0.5, smallcaps: true }, { type: 'field', name: 'date', format: 'DD/MM/YYYY' }] },
    { text: 'Une remarque.', style: 'note', shading: '#eeeeee', border: 'accent2' },
    { type: 'list', style: 'number', numbering: 'outline', start: 3, items: ['Un', { text: 'Un point un', level: 1 }, 'Deux'] },
    { type: 'list', bullet: '✓', items: ['Fait'] },
    { type: 'table', style: 'zebra', firstColumn: true, align: 'center', widths: [120, 80], rows: [['Poste', 'Coût'], [{ text: 'Papier', bg: 'accent4', valign: 'middle' }, '12 €']] },
    { type: 'image', src: 'asset:logo', alt: 'Logo', width: 90, align: 'left', wrap: 'right', caption: 'Figure 1', crop: { top: 5, right: 0, bottom: 0, left: 5 }, rotate: 90, flip: 'v', border: 'text' },
    { type: 'pagebreak' },
    { type: 'code', language: 'python', text: 'print("ok")' },
    { type: 'quote', text: 'Citation finale.' },
  ],
  assets: { logo: pngDataUri(30, 20) },
}

async function open(page: Page, info: TestInfo, d: unknown) {
  const f = makeFile(info, 'doc.html', d)
  await openEditor(page, f.url)
}

test('un document riche est identique après enregistrement et réouverture', async ({ page, context }, info) => {
  const errors = watchErrors(page)
  await removeFsAccess(context)
  await open(page, info, RICH)
  const before = await docJson(page)
  expect(before.blocks).toHaveLength(12)
  // une modification, pour que l'enregistrement écrive vraiment
  await caretToEnd(page)
  await page.keyboard.type(' Fin.')
  const edited = await docJson(page)
  const saved = await saveByDownload(page, info, 'riche.html')
  const fileDoc = docOfFile(saved.html)
  for (const k of ['theme', 'styles', 'fonts', 'blocks', 'assets']) expect(fileDoc[k], k).toEqual(edited[k])
  await page.goto(saved.url)
  await page.waitForFunction(() => !!(window as any).folio?.doc)
  const after = await docJson(page)
  for (const k of ['meta', 'theme', 'styles', 'fonts', 'blocks', 'assets']) {
    if (k === 'meta') expect({ ...after.meta, modified: '' }).toEqual({ ...edited.meta, modified: '' })
    else expect(after[k], k).toEqual(edited[k])
  }
  // aucun signalement à la réouverture d'un fichier écrit par l'application
  await expect(page.locator('#fp-report')).toBeHidden()
  errors.check()
})

test('le JSON compact pour une IA laisse les images de côté et les retrouve au retour', async ({ page, context, browserName }, info) => {
  test.skip(browserName === 'firefox', 'Lecture du presse-papiers non autorisable dans Firefox piloté.')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await open(page, info, RICH)
  await tab(page, 'ai')
  await rb(page, 'copy-compact')
  const text = await page.evaluate(() => navigator.clipboard.readText())
  const compact = JSON.parse(text)
  expect(compact.assets).toBeUndefined()
  expect(text.length).toBeLessThan(4000)
  expect(compact.blocks.find((b: any) => b.type === 'image').src).toBe('asset:logo')
  // l'IA renvoie le document modifié, sans les données de l'image
  compact.blocks.push({ md: 'Paragraphe ajouté par l’IA.' })
  await tab(page, 'ai')
  await rb(page, 'replace-json')
  await page.locator('#fp-replace-json').fill(JSON.stringify(compact))
  await page.locator('[data-dialog="replace-json"] [data-action="replace"]').click()
  const d = await docJson(page)
  expect(d.blocks.at(-1).content[0].text).toBe('Paragraphe ajouté par l’IA.')
  expect(Object.keys(d.assets)).toEqual(['logo'])
  await expect(page.locator('.fp-prose .fp-figure img')).toBeVisible()
  await expect(page.locator('#fp-report')).toBeHidden()
})

test('zoom : Ctrl+molette, boutons, largeur de page ; un clic place le curseur au bon endroit', async ({ page }, info) => {
  await open(page, info, ['alpha beta gamma delta', 'second paragraphe'])
  await editor(page).click()
  await page.keyboard.down('Control')
  await page.mouse.move(600, 500)
  await page.mouse.wheel(0, -100)
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await expect(page.locator('#fp-zoom-label')).toHaveText('120 %')
  await page.locator('#fp-zoom-in').click()
  await expect(page.locator('#fp-zoom-label')).toHaveText('130 %')
  // clic au milieu du mot « gamma » à l'échelle 1,3
  const box = await page.evaluate(() => {
    const p = document.querySelector('.fp-prose p')!
    const node = p.firstChild!
    const r = document.createRange()
    const i = node.textContent!.indexOf('gamma')
    r.setStart(node, i + 2)
    r.setEnd(node, i + 3)
    const b = r.getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  })
  await page.mouse.click(box.x, box.y)
  await page.keyboard.type('X')
  const text = (await blocks(page))[0].content[0].text
  expect(text).toMatch(/gaXmma|gamXma/)
  await page.keyboard.press(`${mod}+0`)
  const label = await page.locator('#fp-zoom-label').textContent()
  expect(label).not.toBe('130 %')
  await page.locator('#fp-zoom-label').click()
  await expect(page.locator('#fp-zoom-label')).toHaveText('100 %')
})

test('propriétés du document, statistiques et barre d’état', async ({ page }, info) => {
  await open(page, info, [{ md: 'Le {{auteur}} écrit trois mots.' }, 'deux mots'])
  // un champ n'est pas un mot
  await expect(page.locator('#fp-words')).toHaveText(/^6 mots$/)
  await selectText(page, 'deux mots')
  await expect(page.locator('#fp-words')).toHaveText(/2 sur 6 mots/)
  await tab(page, 'view')
  await rb(page, 'properties')
  const dlg = page.locator('[data-dialog="properties"]')
  await dlg.locator('[data-field="prop-author"]').fill('Dominique')
  await dlg.locator('[data-field="prop-keywords"]').fill('a, b ; c')
  await dlg.locator('[data-field="prop-lang"]').fill('en-GB')
  await dlg.locator('[data-action="ok"]').click()
  const d = await docJson(page)
  expect(d.meta).toMatchObject({ author: 'Dominique', keywords: ['a', 'b', 'c'], lang: 'en-GB' })
  await expect(page.locator('.fp-prose .fp-field')).toHaveText('Dominique')
  await expect(editor(page)).toHaveAttribute('lang', 'en-GB')
  await tab(page, 'review')
  await rb(page, 'review-words')
  await expect(page.locator('[data-dialog="word-count"]')).toContainText('6')
})

test('coller du Markdown, coller sans mise en forme (Chrome)', async ({ page, browserName }, info) => {
  test.skip(browserName === 'firefox', 'Firefox ne permet pas de fabriquer un événement de collage avec données.')
  await open(page, info, [''])
  await editor(page).click()
  const paste = (data: Record<string, string>) =>
    page.evaluate((d) => {
      const dt = new DataTransfer()
      for (const [k, v] of Object.entries(d)) dt.setData(k, v)
      document.querySelector('.fp-prose')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, data)
  await paste({ 'text/plain': '# Titre collé\n\n- un\n- **deux**\n\nfin' })
  let b = await blocks(page)
  expect(b[0]).toEqual({ type: 'heading', level: 1, content: [{ text: 'Titre collé' }] })
  expect(b[1]).toMatchObject({ type: 'list', items: [{ content: [{ text: 'un' }] }, { content: [{ text: 'deux', bold: true }] }] })
  // Le curseur sur le dernier paragraphe, sans dépendre de l'endroit où tomberait un clic au milieu de la page.
  await editor(page).locator('p', { hasText: /^fin$/ }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await blocks(page)).length).toBe(b.length + 1)
  // Raccourci envoyé comme événement : une vraie frappe ferait aussi coller le presse-papiers du système.
  await editor(page).dispatchEvent('keydown', { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true })
  await paste({ 'text/html': '<p><b>gras</b> <i>italique</i> <span style="color:red">rouge</span></p>', 'text/plain': 'gras italique rouge' })
  b = await blocks(page)
  expect(b.at(-1)).toEqual({ type: 'paragraph', content: [{ text: 'gras italique rouge' }] })
  // collage HTML ordinaire : la mise en forme connue est gardée, le reste ignoré
  await page.keyboard.press('Enter')
  await paste({ 'text/html': '<p><b>gras</b> <span style="color:#c00000;font-size:14pt;font-family:Georgia">rouge</span><script>x()</script></p>', 'text/plain': 'gras rouge' })
  b = await blocks(page)
  expect(b.at(-1).content).toEqual([{ text: 'gras', bold: true }, { text: ' ' }, { text: 'rouge', color: '#c00000', font: 'Georgia', size: 14 }])
})

test('préférences gardées dans le navigateur ; ruban réduit ; correction orthographique', async ({ page }, info) => {
  await open(page, info, ['texte'])
  await page.locator('#fp-ribbon-collapse').click()
  await expect(page.locator('#fp-ribbon')).toHaveClass(/is-collapsed/)
  await tab(page, 'view')
  await expect(page.locator('#fp-ribbon')).not.toHaveClass(/is-collapsed/)
  await rb(page, 'view-spell')
  await expect(editor(page)).toHaveAttribute('spellcheck', 'false')
  await page.reload()
  await page.waitForFunction(() => !!(window as any).folio?.doc)
  await expect(editor(page)).toHaveAttribute('spellcheck', 'false')
  await tab(page, 'view')
  await rb(page, 'view-spell')
  await expect(editor(page)).toHaveAttribute('spellcheck', 'true')
})

test('impression (Ctrl+P) ; langue anglaise du ruban', async ({ page }, info) => {
  await open(page, info, ['texte'])
  await page.evaluate(() => {
    ;(window as any).__printed = 0
    window.print = () => void ((window as any).__printed += 1)
  })
  await caretAfter(page, 'texte')
  await page.keyboard.press(`${mod}+p`)
  expect(await page.evaluate(() => (window as any).__printed)).toBe(1)
  await tab(page, 'review')
  await rb(page, 'language')
  await page.locator('[data-item="lang-en"]').click()
  await expect(page.locator('.fp-ribbon__tab[data-tab="home"]')).toHaveText('Home')
  await tab(page, 'home')
  await expect(page.locator('.fp-ribbon [data-cmd="bold"]')).toHaveAttribute('aria-label', 'Bold')
  await expect(page.locator('#fp-words')).toHaveText(/1 word/)
  await tab(page, 'review')
  await rb(page, 'language')
  await page.locator('[data-item="lang-fr"]').click()
})
