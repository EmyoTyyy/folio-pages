// Édition de texte simple (phase 1) et sûreté du collage.

import { expect, test, type Page } from '@playwright/test'
import { APP_VERSION, caretToEnd, docJson, editor, makeFile, mod, openEditor, rb, status, tab, watchErrors } from './helpers'
import { pathToFileURL } from 'node:url'
import { BLANK } from './helpers'

const empty = { format: 'folio/doc', version: 1, id: 'edit-doc-0001', blocks: [] }

const blocks = async (page: Page) => (await docJson(page)).blocks

test('écrire, aller à la ligne, mettre en forme', async ({ page }, info) => {
  const errs = watchErrors(page)
  const f = makeFile(info, 'ecrire.html', empty)
  await openEditor(page, f.url)
  await editor(page).click()
  await page.keyboard.type('Premier paragraphe.')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Du ')
  await page.keyboard.press(`${mod}+b`)
  await page.keyboard.type('gras')
  await page.keyboard.press(`${mod}+b`)
  await page.keyboard.type(', de l’')
  await page.keyboard.press(`${mod}+i`)
  await page.keyboard.type('italique')
  await page.keyboard.press(`${mod}+i`)
  await page.keyboard.type(' et du ')
  await page.keyboard.press(`${mod}+u`)
  await page.keyboard.type('souligné')
  await page.keyboard.press(`${mod}+u`)
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('nouvelle ligne')
  expect(await blocks(page)).toEqual([
    { type: 'paragraph', content: [{ text: 'Premier paragraphe.' }] },
    {
      type: 'paragraph',
      content: [
        { text: 'Du ' },
        { text: 'gras', bold: true },
        { text: ', de l’' },
        { text: 'italique', italic: true },
        { text: ' et du ' },
        { text: 'souligné', underline: true },
        { text: '\nnouvelle ligne' },
      ],
    },
  ])
  await expect(status(page)).toHaveText('Modifications non enregistrées')
  errs.check()
})

test('listes : Entrée, Tab et Maj+Tab', async ({ page }, info) => {
  const f = makeFile(info, 'listes.html', { ...empty, blocks: [{ type: 'list', items: ['un'] }] })
  await openEditor(page, f.url)
  await editor(page).locator('li').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('deux')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.type('deux-a')
  await page.keyboard.press('Enter')
  await page.keyboard.type('deux-b')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.type('trois')
  const [list] = await blocks(page)
  expect(list.items.map((i: any) => [i.content[0]?.text, i.level])).toEqual([
    ['un', 0],
    ['deux', 0],
    ['deux-a', 1],
    ['deux-b', 1],
    ['trois', 0],
  ])
  // Entrée sur un élément vide sort de la liste.
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('après la liste')
  const after = await blocks(page)
  expect(after[after.length - 1]).toEqual({ type: 'paragraph', content: [{ text: 'après la liste' }] })
})

test('tableaux : Tab passe à la cellule suivante', async ({ page }, info) => {
  const f = makeFile(info, 'tableau.html', { ...empty, blocks: [{ type: 'table', rows: [['A', 'B'], ['', '']] }] })
  await openEditor(page, f.url)
  await editor(page).locator('td').first().click()
  await page.keyboard.type('1')
  await page.keyboard.press('Tab')
  await page.keyboard.type('2')
  const [table] = await blocks(page)
  expect(table.rows[1].map((c: any) => c.blocks[0].content[0]?.text)).toEqual(['1', '2'])
  expect(table.header).toBe(true)
})

test('Tab hors liste et tableau insère une tabulation', async ({ page }, info) => {
  const f = makeFile(info, 'tab.html', empty)
  await openEditor(page, f.url)
  await editor(page).click()
  await page.keyboard.type('a')
  await page.keyboard.press('Tab')
  await page.keyboard.type('b')
  expect(await blocks(page)).toEqual([{ type: 'paragraph', content: [{ text: 'a\tb' }] }])
})

test('le collage ne laisse passer ni script, ni lien dangereux, ni image', async ({ page, browserName }, info) => {
  // Firefox ignore clipboardData sur un événement de collage synthétique ; la logique
  // de collage (ProseMirror + schéma) est la même partout et testée aussi en unitaire.
  test.skip(browserName === 'firefox', 'collage synthétique non pris en charge par Firefox')
  const errs = watchErrors(page)
  const dialogs: string[] = []
  page.on('dialog', (d) => (dialogs.push(d.message()), d.dismiss()))
  const f = makeFile(info, 'collage.html', empty)
  await openEditor(page, f.url)
  await editor(page).click()
  await page.evaluate(() => {
    const html =
      '<p>Texte <b>gras</b> <a href="javascript:alert(1)">piège</a> <a href="https://ok.example">sûr</a></p>' +
      '<img src="x" onerror="alert(2)"><script>alert(3)</script><style>p{color:red}</style>' +
      '<h2 onclick="alert(4)">Titre collé</h2><ul><li>point</li></ul>'
    const dt = new DataTransfer()
    dt.setData('text/html', html)
    dt.setData('text/plain', 'texte brut')
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    document.querySelector('.fp-prose')!.dispatchEvent(ev)
  })
  await expect(editor(page)).toContainText('Titre collé')
  await expect(editor(page).locator('script, img, style')).toHaveCount(0)
  await expect(editor(page).locator('[onclick], [onerror]')).toHaveCount(0)
  await expect(editor(page).locator('a[href^="javascript"]')).toHaveCount(0)
  await expect(editor(page).locator('a[href="https://ok.example"]')).toHaveText('sûr')
  await expect(editor(page)).toContainText('piège')
  await page.waitForTimeout(300)
  expect(dialogs).toEqual([])
  const json = JSON.stringify(await blocks(page))
  expect(json).not.toContain('javascript')
  errs.check()
})

test('un fichier lâché sur la page ne remplace pas l’application', async ({ page }, info) => {
  const f = makeFile(info, 'lacher.html', empty)
  await openEditor(page, f.url)
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['<h1>autre</h1>'], 'autre.html', { type: 'text/html' }))
    for (const type of ['dragenter', 'dragover', 'drop']) {
      document.querySelector('.fp-prose')!.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
    }
  })
  await page.waitForTimeout(300)
  expect(page.url()).toBe(f.url)
  await expect(editor(page)).toBeVisible()
})

test('nouveau document vide depuis la démonstration, annulable', async ({ page }) => {
  await openEditor(page, pathToFileURL(BLANK).href)
  await expect(page.locator('#fp-title')).toHaveValue('Bienvenue dans Folio Pages')
  await page.locator('#fp-new-blank').click()
  await expect(editor(page)).toHaveText('')
  await expect(page.locator('#fp-title')).toHaveValue('')
  await expect(page.locator('#fp-banner')).toBeHidden()
  await expect(page).toHaveTitle('Document sans titre — Folio Pages')
  // Rien de la démonstration ne reste : ni son en-tête « {{title}} », ni son pied de page, ni son style « Astuce ».
  const doc = await docJson(page)
  expect(JSON.stringify(doc.headers ?? {})).not.toContain('{{')
  expect(JSON.stringify(doc.footers ?? {})).not.toContain('{{')
  expect(doc.styles?.tip).toBeUndefined()
  await expect(page.locator('.fp-hf-zone').filter({ hasText: /\S/ })).toHaveCount(0)
  await page.keyboard.type('Ma lettre')
  await page.keyboard.press(`${mod}+z`)
  await page.keyboard.press(`${mod}+z`)
  await expect(editor(page).locator('p[data-style="title"]')).toHaveText('Bienvenue dans Folio Pages')
  await expect(page.locator('#fp-title')).toHaveValue('Bienvenue dans Folio Pages')
})

test('nouveau document vide garde les propriétés d’un vrai document', async ({ page }, info) => {
  const f = makeFile(info, 'garde.html', { ...empty, meta: { title: 'Mon titre', author: 'Ana' }, blocks: ['texte'] })
  await openEditor(page, f.url)
  await page.locator('[data-menu="file"]').click()
  await page.locator('[data-item="new-blank"]').click()
  await expect(editor(page)).toHaveText('')
  const doc = await docJson(page)
  expect(doc.meta.title).toBe('Mon titre')
  expect(doc.meta.author).toBe('Ana')
})

test('nouveau document vide : ni en-tête, ni pied de page, ni filigrane ; annulable', async ({ page }, info) => {
  const hf = (text: string) => ({ default: [text], first: [], even: [] })
  const f = makeFile(info, 'entetes.html', { ...empty, meta: { title: 'Rapport' }, headers: hf('Haut {{title}}'), footers: hf('Page {{page}}'), watermark: { text: 'BROUILLON' }, blocks: ['texte'] })
  await openEditor(page, f.url)
  await expect(page.locator('.fp-hf-zone').filter({ hasText: 'Haut' }).first()).toBeVisible()
  await page.locator('[data-menu="file"]').click()
  await page.locator('[data-item="new-blank"]').click()
  await expect(editor(page)).toHaveText('')
  const doc = await docJson(page)
  expect(doc.headers?.default ?? []).toEqual([])
  expect(doc.footers?.default ?? []).toEqual([])
  expect(doc.watermark).toBeUndefined()
  // Les propriétés restent.
  expect(doc.meta.title).toBe('Rapport')
  await expect(page.locator('.fp-hf-zone').filter({ hasText: /\S/ })).toHaveCount(0)
  // Une seule annulation rend tout : texte, en-tête, pied de page.
  await page.keyboard.press(`${mod}+z`)
  await expect(editor(page)).toHaveText('texte')
  const back = await docJson(page)
  expect(JSON.stringify(back.headers)).toContain('Haut {{title}}')
  expect(JSON.stringify(back.footers)).toContain('Page {{page}}')
  expect(back.watermark?.text).toBe('BROUILLON')
})

test('nouveau document vide sur la démonstration, après l’ajout d’un autre document', async ({ page }) => {
  await openEditor(page, pathToFileURL(BLANK).href)
  await page.locator('#fp-docs-toggle').click()
  await page.locator('#fp-doc-add').click()
  await page.locator('[data-tree-rename]').press('Enter')
  await page.locator('.fp-doctab').first().click()
  await expect(page.locator('#fp-title')).toHaveValue('Bienvenue dans Folio Pages')
  await page.locator('[data-menu="file"]').click()
  await page.locator('[data-item="new-blank"]').click()
  await expect(editor(page)).toHaveText('')
  await expect(page.locator('#fp-title')).toHaveValue('')
  const doc = await docJson(page)
  expect(JSON.stringify(doc.headers ?? {})).not.toContain('{{')
  expect(JSON.stringify(doc.footers ?? {})).not.toContain('{{')
  expect(doc.styles?.tip).toBeUndefined()
  await expect(page.locator('.fp-hf-zone').filter({ hasText: /\S/ })).toHaveCount(0)
  // L'autre document est toujours là.
  await expect(page.locator('.fp-doctab')).toHaveCount(2)
})

test('menu Fichier au clavier : ouvrir, parcourir, fermer ; annuler et rétablir en haut', async ({ page }, info) => {
  const f = makeFile(info, 'menus.html', { ...empty, blocks: ['un texte'] })
  await openEditor(page, f.url)
  // Fichier est le premier « onglet », avant Accueil.
  const first = await page.locator('.fp-ribbon__bar button').first().getAttribute('data-menu')
  expect(first).toBe('file')
  await page.locator('[data-menu="file"]').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-menu-popup="file"]')).toBeVisible()
  await expect(page.locator('[data-item="new-blank"]')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-item="new-template"]')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-item="open"]')).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.locator('[data-item="properties"]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.fp-menu')).toHaveCount(0)
  await expect(page.locator('[data-menu="file"]')).toBeFocused()
  // Annuler / rétablir : les boutons de la barre de titre.
  await caretToEnd(page)
  await page.keyboard.type(' !')
  await page.locator('[data-cmd="qat-undo"]').click()
  expect((await blocks(page))[0].content[0].text).toBe('un texte')
  await page.locator('[data-cmd="qat-redo"]').click()
  expect((await blocks(page))[0].content[0].text).toBe('un texte\u202f!') // correction automatique : espace fine insécable
  // Un clic ailleurs ferme le menu.
  await page.locator('[data-menu="file"]').click()
  await expect(page.locator('[data-menu-popup="file"]')).toBeVisible()
  await editor(page).click()
  await expect(page.locator('.fp-menu')).toHaveCount(0)
})

test('à propos : version et licence', async ({ page }, info) => {
  const f = makeFile(info, 'apropos.html', empty)
  await openEditor(page, f.url)
  await tab(page, 'help')
  await rb(page, 'about')
  const dlg = page.locator('dialog[data-dialog="about"]')
  await expect(dlg).toContainText(`Version ${APP_VERSION}`)
  await expect(dlg).toContainText('licence MIT')
})
