// Version 0.9 : correction automatique, modèles, exports (ODT, EPUB, page web, Markdown, texte).

import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import { blocks, caretToEnd, docJson, editor, makeFile, openEditor, pngDataUri, removeFsAccess, watchErrors } from './helpers'

const NBSP = ' '
const NNBSP = ' '

const doc = (lang: string, blocks: unknown[], extra: Record<string, unknown> = {}) => ({ format: 'folio/doc', version: 1, meta: { title: 'Essai', lang }, blocks, ...extra })
const dialog = (page: Page, name: string) => page.locator(`[data-dialog="${name}"]`)
const menuItem = async (page: Page, menu: string, item: string) => {
  await page.locator(`[data-menu="${menu}"]`).click()
  await page.locator(`[data-menu-popup="${menu}"] [data-item="${item}"]`).click()
}
async function open(page: Page, info: TestInfo, lang: string, blocks: unknown[] = [''], extra: Record<string, unknown> = {}) {
  await openEditor(page, makeFile(info, 'essai.html', doc(lang, blocks, extra)).url)
  await caretToEnd(page)
}
const firstText = async (page: Page) => (await blocks(page))[0].content.map((x: { text?: string }) => x.text ?? '').join('')

test.describe('correction automatique', () => {
  test('français : guillemets, espaces insécables, fautes et symboles ; Retour arrière défait', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, 'fr')
    await page.keyboard.type('Il dit "voila" : (c) coeur, ok? ')
    expect(await firstText(page)).toBe(`Il dit «${NBSP}voilà${NBSP}»${NBSP}: © cœur, ok${NNBSP}? `)
    // Retour arrière juste après une correction la défait (une fois).
    await page.keyboard.type('teh ')
    await page.keyboard.type('apres')
    await page.keyboard.type(' ')
    expect(await firstText(page)).toMatch(/après $/)
    await page.keyboard.press('Backspace')
    expect(await firstText(page)).toMatch(/apres $/)
    errors.check()
  })

  test('anglais : “ ” et fautes courantes ; options et liste personnelle gardées dans le navigateur', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, 'en')
    await page.keyboard.type('i said "teh end" ')
    expect(await firstText(page)).toBe('I said “the end” ')
    // Fenêtre : ajouter un remplacement, couper les guillemets.
    await page.locator('[data-tab="review"]').click()
    await page.locator('.fp-ribbon [data-cmd="review-spell-menu"]').click()
    await page.locator('[data-popover] [data-spell="autocorrect"]').click()
    const dlg = dialog(page, 'autocorrect')
    await expect(dlg).toBeVisible()
    await expect(dlg.locator('[data-ac-entry="teh"]')).toContainText('the')
    await dlg.locator('[data-field="ac-from"]').fill('fp')
    await dlg.locator('[data-field="ac-to"]').fill('Folio Pages')
    await dlg.locator('[data-field="ac-to"]').press('Enter')
    await expect(dlg.locator('[data-ac-entry="fp"]')).toContainText('Folio Pages')
    await dlg.locator('[data-ac-remove="teh"]').click()
    await expect(dlg.locator('[data-ac-entry="teh"]')).toHaveCount(0)
    await dlg.locator('[data-field="ac-quotes"]').uncheck()
    await dlg.locator('[data-action="ok"]').click()
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('folio-pages:settings')!))
    expect(saved.acCustom).toEqual([['fp', 'Folio Pages']])
    expect(saved.acRemoved).toEqual(['teh'])
    expect(saved.acQuotes).toBe(false)
    await editor(page).click()
    await caretToEnd(page)
    await page.keyboard.type('fp "teh" ')
    expect(await firstText(page)).toBe('I said “the end” Folio Pages "teh" ')
    // Tout couper : rien ne change plus.
    await page.locator('.fp-ribbon [data-cmd="review-spell-menu"]').click()
    await page.locator('[data-popover] [data-spell="autocorrect"]').click()
    await dlg.locator('[data-field="ac-enabled"]').uncheck()
    await expect(dlg.locator('[data-field="ac-replace"]')).toBeDisabled()
    await dlg.locator('[data-action="ok"]').click()
    await editor(page).click()
    await caretToEnd(page)
    await page.keyboard.type('fp (c)')
    await page.keyboard.type(' ')
    expect(await firstText(page)).toMatch(/fp \(c\) $/)
    errors.check()
  })
})

test.describe('modèles', () => {
  test('galerie : utiliser ici (annulable), ou dans un nouvel onglet', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, 'fr', ['Mon texte à garder.'])
    await menuItem(page, 'file', 'new-template')
    const dlg = dialog(page, 'templates')
    await expect(dlg.locator('[data-template]')).toHaveCount(9)
    await expect(dlg.locator('[data-template="blank"]')).toHaveAttribute('aria-checked', 'true')
    await dlg.locator('[data-template="invoice"]').click()
    await expect(dlg.locator('[data-template="invoice"]')).toHaveAttribute('aria-checked', 'true')
    await dlg.locator('[data-action="use"]').click()
    await expect(dlg).toHaveCount(0)
    const d = await docJson(page)
    expect(d.meta.title).toBe('Facture')
    expect(d.theme.name).toBe('modern')
    expect(d.blocks.some((b: { type: string; style?: string }) => b.type === 'paragraph' && b.style === 'title')).toBe(true)
    expect(JSON.stringify(d.blocks)).toContain('Conception graphique')
    // Ctrl+Z : le document d'avant revient.
    await editor(page).click()
    await page.keyboard.press('Control+z')
    expect(await firstText(page)).toBe('Mon texte à garder.')
    // Nouvel onglet : le document ouvert ne change pas.
    await menuItem(page, 'file', 'new-template')
    await dlg.locator('[data-template="cv"]').click()
    const [tabPage] = await Promise.all([page.context().waitForEvent('page'), dlg.locator('[data-action="tab"]').click()])
    await tabPage.waitForFunction(() => !!(window as any).folio?.doc, null, { timeout: 15_000 })
    expect(await tabPage.evaluate(() => (window as any).folio.doc.meta.title)).toBe('Curriculum vitæ')
    expect(await firstText(page)).toBe('Mon texte à garder.')
    errors.check()
  })

  test('depuis la démonstration : le bouton du bandeau, et le clavier dans la galerie', async ({ page }, info) => {
    await openEditor(page, makeFile(info, 'vide.html').url)
    await page.locator('#fp-new-template').click()
    const dlg = dialog(page, 'templates')
    await expect(dlg.locator('[data-template="blank"]')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(dlg.locator('[data-template="cv"]')).toBeFocused()
    await dlg.locator('[data-template="letter"]').dblclick()
    await expect(dlg).toHaveCount(0)
    expect((await docJson(page)).meta.title).toBe('Lettre')
    await expect(page.locator('#fp-banner')).toBeHidden()
  })
})

test.describe('exports', () => {
  test.beforeEach(async ({ context }) => removeFsAccess(context))

  const exportTo = async (page: Page, format: string) => {
    await menuItem(page, 'file', 'export')
    const dlg = dialog(page, 'export')
    await dlg.locator(`[data-format="${format}"]`).click()
    const [dl] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-action="go"]').click()])
    return { name: dl.suggestedFilename(), bytes: new Uint8Array(readFileSync((await dl.path())!)) }
  }

  test('ODT, EPUB, page web, Markdown (avec images), texte : chaque fichier se lit', async ({ page }, info) => {
    const errors = watchErrors(page)
    const pic = pngDataUri(40, 20)
    await openEditor(
      page,
      makeFile(
        info,
        'rapport.html',
        doc('fr', [
          { type: 'toc', title: 'Sommaire' },
          { type: 'heading', level: 1, text: 'Introduction' },
          { md: 'Un texte en **gras** avec une note.^[La note.] Et $x^2$.' },
          { type: 'image', src: 'asset:p1', alt: 'Rectangle', caption: 'Un rectangle' },
          { type: 'heading', level: 1, text: 'Suite' },
          { type: 'table', rows: [['A', 'B'], ['1', '2']] },
        ], { assets: { p1: pic }, footers: { default: [{ md: 'Page {{page}}' }] } }),
      ).url,
    )
    await expect(dialog(page, 'export')).toHaveCount(0)
    // .odt
    const odt = await exportTo(page, 'odt')
    expect(odt.name).toBe('rapport.odt')
    const files = unzipSync(odt.bytes)
    expect(strFromU8(files.mimetype)).toBe('application/vnd.oasis.opendocument.text')
    const content = strFromU8(files['content.xml'])
    expect(content).toContain('text:outline-level="1">Introduction</text:h>')
    expect(content).toContain('<text:note ')
    expect(content).toMatch(/<text:table-of-content [^>]*>.*Introduction.*<text:tab\/>1</)
    expect(Object.keys(files)).toContain('Pictures/001.png')
    expect(strFromU8(files['styles.xml'])).toContain('<text:page-number')
    await expect(page.locator('.fp-toast').filter({ hasText: 'rapport.odt' })).toBeVisible()
    // .epub
    const epub = await exportTo(page, 'epub')
    expect(epub.name).toBe('rapport.epub')
    const e = unzipSync(epub.bytes)
    expect(strFromU8(e.mimetype)).toBe('application/epub+zip')
    expect(Object.keys(e).filter((n) => /chapter-\d+\.xhtml$/.test(n))).toHaveLength(3)
    expect(strFromU8(e['OEBPS/nav.xhtml'])).toContain('>Suite</a>')
    // page web : on l'ouvre dans le navigateur, sans script, et elle s'affiche.
    const web = await exportTo(page, 'html')
    expect(web.name).toBe('rapport (web).html')
    const html = strFromU8(web.bytes)
    expect(html).not.toMatch(/<script/i)
    const shown = await page.context().newPage()
    await shown.setContent(html)
    await expect(shown.locator('h1').first()).toHaveText('Introduction')
    await expect(shown.locator('img[alt="Rectangle"]')).toBeVisible()
    expect(await shown.locator('img[alt="Rectangle"]').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(40)
    await expect(shown.locator('math')).toHaveCount(1)
    await expect(shown.locator('.notes')).toContainText('La note.')
    await shown.close()
    // Markdown : une archive avec le texte et ses images.
    const md = await exportTo(page, 'md')
    expect(md.name).toBe('rapport.zip')
    const z = unzipSync(md.bytes)
    expect(Object.keys(z).sort()).toEqual(['images/01-p1.png', 'rapport.md'])
    expect(strFromU8(z['rapport.md'])).toContain('Un texte en **gras** avec une note.[^1] Et $x^2$.')
    // texte brut
    const txt = await exportTo(page, 'txt')
    expect(txt.name).toBe('rapport.txt')
    expect(strFromU8(txt.bytes)).toContain('Introduction\n============')
    errors.check()
  })

  test('le menu Partager mène aux exports ; .docx et PDF y sont aussi ; ODT en pièce jointe d’un courriel', async ({ page }, info) => {
    await open(page, info, 'fr', ['Bonjour.'])
    await page.locator('#fp-share').click()
    await page.locator('[data-popover] [data-share="export"]').click()
    const dlg = dialog(page, 'export')
    await expect(dlg.locator('[data-format]')).toHaveCount(7)
    await expect(dlg.locator('[data-format="odt"]')).toHaveAttribute('aria-checked', 'true')
    // .docx : le chemin habituel
    await dlg.locator('[data-format="docx"]').click()
    const [dl] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-action="go"]').click()])
    expect(dl.suggestedFilename()).toBe('essai.docx')
    // Courriel : la copie .odt va dans le brouillon.
    await page.locator('[data-tab="mailings"]').click()
    await page.locator('.fp-ribbon [data-cmd="mm-send-doc"]').click()
    const mail = dialog(page, 'send-doc')
    await mail.locator('[data-field="send-content"]').selectOption('attach')
    await mail.locator('[data-field="send-format"]').selectOption('odt')
    const [draft] = await Promise.all([page.waitForEvent('download'), mail.locator('[data-action="eml"]').click()])
    const eml = readFileSync((await draft.path())!, 'utf8')
    expect(eml).toMatch(/Content-Type: application\/vnd\.oasis\.opendocument\.text; name="essai\.odt"/)
  })
})
