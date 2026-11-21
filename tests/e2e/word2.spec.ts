// Fonctions de traitement de texte de la 0.10 : effets du texte, lettrine,
// césure, filigrane, « Définir par défaut », Atteindre, mise en forme
// semblable, nombre, page de garde, ligne de signature, capture d'écran,
// retouches d'image, brouillon.

import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { blocks, caretToEnd, docJson, editor, makeFile, mod, openEditor, pngDataUri, rb, selectText, tab, watchErrors } from './helpers'

const doc = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({ format: 'folio/doc', version: 1, meta: { title: 'Essai', lang: 'fr', author: 'Ana Duval' }, blocks, ...extra })
const dialog = (page: Page, name: string) => page.locator(`[data-dialog="${name}"]`)
const pop = (page: Page) => page.locator('[data-popover]')
async function open(page: Page, info: TestInfo, b: unknown[], extra: Record<string, unknown> = {}) {
  await openEditor(page, makeFile(info, 'essai.html', doc(b, extra)).url)
}
// Le ruban reste ouvert même quand la page défile (les boutons restent visibles).
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
  })
})

const runs = async (page: Page, i = 0) => (await blocks(page))[i].content as Record<string, unknown>[]

test.describe('effets du texte', () => {
  test('bordure, trame, soulignement double et coloré, contour, ombre, halo, texte décoratif', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, ['Un mot ici et là.'])
    await tab(page, 'home')
    await selectText(page, 'mot')
    await rb(page, 'char-border')
    await selectText(page, 'ici')
    await rb(page, 'char-shading')
    await selectText(page, 'et')
    await rb(page, 'underline-menu')
    await pop(page).locator('[data-underline="double"]').click()
    await selectText(page, 'et')
    await rb(page, 'underline-menu')
    await pop(page).locator('[data-color="accent2"]').first().click()
    await selectText(page, 'là')
    await rb(page, 'text-effects')
    await pop(page).locator('[data-fx="outline"]').click()
    await selectText(page, 'là')
    await rb(page, 'text-effects')
    await pop(page).locator('[data-fx="shadow"]').click()
    const r = await runs(page)
    expect(r.find((x) => x.text === 'mot')).toMatchObject({ textBorder: 'text' })
    expect(r.find((x) => x.text === 'ici')).toMatchObject({ textShading: '#d9d9d9' })
    expect(r.find((x) => x.text === 'et')).toMatchObject({ underline: true, underlineStyle: 'double', underlineColor: 'accent2' })
    expect(r.find((x) => x.text === 'là')).toMatchObject({ outline: true, shadow: true })
    // Ce qui se voit : contour (lettres évidées), ombre, double trait.
    const la = editor(page).locator('.fp-outline', { hasText: 'là' })
    expect(await la.evaluate((e) => getComputedStyle(e).webkitTextStroke || getComputedStyle(e).getPropertyValue('-webkit-text-stroke-width'))).toBeTruthy()
    expect(await editor(page).locator('u', { hasText: 'et' }).evaluate((e) => getComputedStyle(e).textDecorationStyle)).toBe('double')
    expect(await editor(page).locator('.fp-shadow').evaluate((e) => getComputedStyle(e).textShadow)).not.toBe('none')
    // Texte décoratif sans sélection : une ligne centrée « Votre texte ici », sélectionnée.
    await caretToEnd(page)
    await page.keyboard.press('Enter')
    await tab(page, 'insert')
    await rb(page, 'insert-decorative')
    await pop(page).locator('[data-decorative="glow"]').click()
    const b = await blocks(page)
    const last = b[b.length - 1]
    expect(last.align).toBe('center')
    expect(last.content[0]).toMatchObject({ text: 'Votre texte ici', bold: true, glow: 'accent3', font: 'heading', size: 36 })
    await page.keyboard.type('Grand titre')
    expect((await blocks(page)).at(-1).content[0].text).toBe('Grand titre')
    errors.check()
  })
})

test('lettrine, césure, trait d’union conditionnel', async ({ page }, info) => {
  await open(page, info, ['Il était une fois un très long paragraphe.', 'Suite.'])
  await selectText(page, 'Il était', 0, true)
  await tab(page, 'insert')
  await rb(page, 'insert-dropcap')
  await pop(page).locator('[data-dropcap="3"]').click()
  expect((await blocks(page))[0].dropCap).toBe(3)
  await expect(editor(page).locator('p[data-dropcap="3"]')).toHaveCount(1)
  await tab(page, 'layout')
  await rb(page, 'hyphenation')
  await pop(page).locator('[data-hyphenation="auto"]').click()
  expect((await docJson(page)).hyphenate).toBe(true)
  await expect(editor(page)).toHaveClass(/is-hyphenated/)
  expect(await editor(page).evaluate((e) => getComputedStyle(e).hyphens)).toBe('auto')
  // Ctrl+- : un trait d'union conditionnel (invisible tant que le mot n'est pas coupé).
  await selectText(page, 'paragraphe', 0, false)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press(`${mod}+-`)
  expect((await blocks(page))[0].content.map((x: { text: string }) => x.text).join('')).toContain('­')
  // Annulable.
  await page.keyboard.press(`${mod}+z`)
  expect((await blocks(page))[0].content.map((x: { text: string }) => x.text).join('')).not.toContain('­')
})

test('filigrane : modèle, filigrane personnalisé, suppression ; dessiné sur chaque page', async ({ page }, info) => {
  await open(page, info, ['Première page.', { type: 'pagebreak' }, 'Deuxième page.'])
  await tab(page, 'design')
  await rb(page, 'watermark')
  await pop(page).locator('[data-watermark="BROUILLON"]').click()
  expect((await docJson(page)).watermark).toMatchObject({ text: 'BROUILLON', diagonal: true })
  await expect(page.locator('.fp-sheet .fp-watermark__text')).toHaveCount(2)
  await expect(page.locator('.fp-sheet .fp-watermark__text').first()).toHaveText('BROUILLON')
  // Personnalisé : texte horizontal, opacité.
  await rb(page, 'watermark')
  await pop(page).locator('[data-watermark="custom"]').click()
  const dlg = dialog(page, 'watermark')
  await dlg.locator('[data-field="wm-text"]').fill('Interne')
  await dlg.locator('[data-field="wm-horizontal"]').check()
  await dlg.locator('[data-action="ok"]').click()
  expect((await docJson(page)).watermark).toMatchObject({ text: 'Interne', diagonal: false })
  await expect(page.locator('.fp-sheet .fp-watermark__text').first()).toHaveText('Interne')
  expect(await page.locator('.fp-sheet .fp-watermark__text').first().evaluate((e) => e.style.transform)).toBe('')
  // Ctrl+Z revient au filigrane d'avant ; « Supprimer » l'enlève.
  await editor(page).click()
  await page.keyboard.press(`${mod}+z`)
  expect((await docJson(page)).watermark.text).toBe('BROUILLON')
  await rb(page, 'watermark')
  await pop(page).locator('[data-watermark="remove"]').click()
  expect((await docJson(page)).watermark).toBeUndefined()
  await expect(page.locator('.fp-watermark')).toHaveCount(0)
})

test('Définir par défaut : le thème et la mise en page suivent les nouveaux documents', async ({ page }, info) => {
  await open(page, info, ['x'], { theme: { name: 'modern' }, page: { orientation: 'landscape' } })
  await tab(page, 'design')
  await rb(page, 'set-default')
  await dialog(page, 'set-default').locator('[data-action="ok"]').click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('folio-pages:settings')!).defaultDesign)
  expect(saved.theme.name).toBe('modern')
  // La démonstration → « Nouveau document vide » : thème et orientation par défaut.
  await openEditor(page, makeFile(info, 'vide.html').url)
  await page.locator('#fp-new-blank').click()
  const d = await docJson(page)
  expect(d.theme.name).toBe('modern')
  expect(d.page.orientation).toBe('landscape')
})

test('Atteindre (Ctrl+G) : page, titre suivant, signet ; Sélectionner le texte de mise en forme semblable', async ({ page }, info) => {
  const errors = watchErrors(page)
  await open(page, info, [
    { type: 'heading', level: 1, text: 'Début' },
    { content: [{ text: 'gras', bold: true }, ' et normal'] },
    { type: 'pagebreak' },
    { type: 'heading', level: 1, text: 'Milieu' },
    { content: ['page deux ', { text: 'aussi gras', bold: true }, { type: 'bookmark', name: 'Repere' }] },
  ])
  await editor(page).locator('h1').first().click()
  const dlg = dialog(page, 'goto')
  // Le curseur va là où Atteindre l'a mené (on le voit une fois la fenêtre fermée).
  const where = async () => {
    await dlg.locator('[data-action="close"]').click()
    await expect(editor(page)).toBeFocused()
    await page.keyboard.type('§')
    const b = await blocks(page)
    const hit = b.find((x: { content?: { text?: string }[] }) => (x.content ?? []).some((r) => r.text?.includes('§')))
    await page.keyboard.press('Backspace')
    return hit ? hit.content.map((r: { text?: string }) => r.text ?? '').join('').replace('§', '') : undefined
  }
  await page.keyboard.press(`${mod}+g`)
  await expect(dlg).toBeVisible()
  await dlg.locator('[data-field="goto-target"]').fill('2')
  await dlg.locator('[data-goto="go"]').click()
  await expect(dlg.locator('[data-field="goto-status"]')).toHaveText('')
  expect(await where()).toBe('Milieu')
  await page.keyboard.press(`${mod}+g`)
  await dlg.locator('[data-field="goto-kind"]').selectOption('heading')
  await dlg.locator('[data-goto="previous"]').click()
  expect(await where()).toBe('Début')
  await page.keyboard.press('F5')
  await dlg.locator('[data-field="goto-kind"]').selectOption('bookmark')
  await expect(dlg.locator('[data-field="goto-name"] option')).toHaveText(['Repere'])
  await dlg.locator('[data-goto="go"]').click()
  expect(await where()).toBe('page deux aussi gras')
  // Mise en forme semblable : les deux passages en gras, puis une couleur pour tous.
  await selectText(page, 'gras')
  await tab(page, 'home')
  await rb(page, 'select')
  await pop(page).locator('[data-select="similar"]').click()
  await expect(editor(page).locator('.fp-multisel')).toHaveCount(2)
  await rb(page, 'color-menu')
  await pop(page).locator('[data-color="accent2"]').first().click()
  const colored = (await blocks(page)).flatMap((b: { content?: Record<string, unknown>[] }) => (b.content ?? []).filter((r) => r.color === 'accent2').map((r) => r.text))
  expect(colored).toEqual(['gras', 'aussi gras'])
  errors.check()
})

test('Insertion → Nombre : en lettres, en chiffres romains', async ({ page }, info) => {
  await open(page, info, ['Montant : '])
  await caretToEnd(page)
  await tab(page, 'insert')
  await rb(page, 'insert-number')
  const dlg = dialog(page, 'insert-number')
  await dlg.locator('[data-field="number-value"]').fill('1234')
  await expect(dlg.locator('[data-field="number-format"] option[value="words"]')).toHaveText('mille-deux-cent-trente-quatre')
  await dlg.locator('[data-field="number-format"]').selectOption('words')
  await dlg.locator('[data-action="ok"]').click()
  expect((await blocks(page))[0].content[0].text).toMatch(/mille-deux-cent-trente-quatre$/)
  await rb(page, 'insert-number')
  await dlg.locator('[data-field="number-value"]').fill('2026')
  await dlg.locator('[data-field="number-format"]').selectOption('ROMAN')
  await dlg.locator('[data-action="ok"]').click()
  expect((await blocks(page))[0].content[0].text).toMatch(/MMXXVI$/)
})

test('page de garde au début ; ligne de signature avec une signature tracée', async ({ page }, info) => {
  await open(page, info, ['Le texte du rapport.'])
  await caretToEnd(page)
  await tab(page, 'insert')
  await rb(page, 'cover-page')
  await pop(page).locator('[data-cover="classic"]').click()
  const b = await blocks(page)
  expect(b[1]).toMatchObject({ type: 'paragraph', style: 'title' })
  expect(b[1].content[0]).toMatchObject({ type: 'field', name: 'title' })
  expect(b.findIndex((x: { type: string }) => x.type === 'pagebreak')).toBeGreaterThan(1)
  expect(b.at(-1).content[0].text).toBe('Le texte du rapport.')
  // La page de garde montre le titre du document.
  await expect(editor(page).locator('p[data-style="title"]')).toHaveText('Essai')
  // Ligne de signature : nom prérempli (l'auteur), fonction, signature à la souris.
  await caretToEnd(page)
  await rb(page, 'insert-signature')
  await pop(page).locator('[data-signature="line"]').click()
  const dlg = dialog(page, 'signature')
  await expect(dlg.locator('[data-field="sign-name"]')).toHaveValue('Ana Duval')
  await dlg.locator('[data-field="sign-title"]').fill('Directrice')
  const pad = (await dlg.locator('[data-field="sign-pad"]').boundingBox())!
  await page.mouse.move(pad.x + 20, pad.y + pad.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(pad.x + 20 + i * 25, pad.y + pad.height / 2 + (i % 2 ? -15 : 15))
  await page.mouse.up()
  await dlg.locator('[data-action="ok"]').click()
  const after = await blocks(page)
  const img = after.find((x: { type: string; alt?: string }) => x.type === 'image' && x.alt === 'Signature de Ana Duval')
  expect(img).toBeTruthy()
  const d = await docJson(page)
  expect(d.assets[img.src.slice(6)]).toMatch(/^data:image\/png;base64,/)
  expect(JSON.stringify(after)).toContain('Directrice')
  expect(JSON.stringify(after)).toContain('X\\u2003___'.replace('\\u2003', ' '))
})

test('capture d’écran : l’image choisie dans la fenêtre du navigateur est insérée', async ({ page }, info) => {
  await open(page, info, ['Avant.'])
  // La fenêtre de choix du navigateur ne s'automatise pas : on lui substitue une source dessinée.
  await page.evaluate(() => {
    ;(navigator.mediaDevices as any).getDisplayMedia = async () => {
      const c = document.createElement('canvas')
      c.width = 320
      c.height = 200
      const g = c.getContext('2d')!
      const paint = () => {
        g.fillStyle = '#1e6b55'
        g.fillRect(0, 0, 320, 200)
      }
      paint()
      const stream = (c as any).captureStream(10)
      const timer = setInterval(paint, 50)
      stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer))
      return stream
    }
  })
  await caretToEnd(page)
  await tab(page, 'insert')
  await rb(page, 'insert-screenshot')
  await pop(page).locator('[data-shot="window"]').click()
  await expect.poll(async () => (await blocks(page)).some((b: { type: string }) => b.type === 'image')).toBe(true)
  const img = (await blocks(page)).find((b: { type: string }) => b.type === 'image')
  const data = (await docJson(page)).assets[img.src.slice(6)]
  expect(data).toMatch(/^data:image\/(png|jpeg|webp);base64,/)
})

test('retouches d’image : corrections, couleur, transparence, effets', async ({ page }, info) => {
  const errors = watchErrors(page)
  await open(page, info, ['Avant', { type: 'image', src: pngDataUri(80, 60), alt: 'carré' }, 'après'])
  await page.locator('.fp-figure__frame').click()
  await expect(page.locator('.fp-ribbon__tab[data-tab="image"]')).toHaveClass(/is-current/)
  await rb(page, 'corrections')
  await expect(pop(page).locator('[data-correction] img')).toHaveCount(25)
  await pop(page).locator('[data-correction="20/-20"]').click()
  await page.locator('.fp-figure__frame').click()
  await rb(page, 'picture-color')
  await pop(page).locator('[data-recolor="sepia"]').click()
  await page.locator('.fp-figure__frame').click()
  await rb(page, 'transparency')
  await pop(page).locator('[data-transparency="50"]').click()
  await page.locator('.fp-figure__frame').click()
  await rb(page, 'picture-effects')
  await pop(page).locator('[data-pfx="shadow"]').click()
  const img = (await blocks(page))[1]
  expect(img.adjust).toEqual({ brightness: 20, contrast: -20, recolor: 'sepia', transparency: 50, shadow: true })
  const frame = page.locator('.fp-figure__frame')
  expect(await frame.evaluate((e) => getComputedStyle(e).filter)).toMatch(/brightness\(1\.2\).*contrast\(0\.8\).*sepia\(1\).*drop-shadow/)
  expect(await frame.evaluate((e) => getComputedStyle(e).opacity)).toBe('0.5')
  // Rétablir l'image.
  await page.locator('.fp-figure__frame').click()
  await rb(page, 'corrections')
  await pop(page).locator('[data-correction="reset"]').click()
  expect((await blocks(page))[1].adjust).toBeUndefined()
  errors.check()
})

test('reflet d’image : aperçus, copie retournée sous l’image, la légende suit ; annulable', async ({ page }, info) => {
  const errors = watchErrors(page)
  await open(page, info, ['Avant', { type: 'image', src: pngDataUri(80, 60), alt: 'carré', width: 120, caption: ['Légende'] }, 'après'])
  await page.locator('.fp-figure__frame').click()
  await rb(page, 'picture-effects')
  await expect(pop(page).locator('[data-reflection]')).toHaveCount(4)
  await expect(pop(page).locator('[data-reflection="50"] .fp-pfx__mirror')).toHaveCount(1)
  await expect(pop(page).locator('[data-reflection="0"]')).toHaveAttribute('aria-checked', 'true')
  await pop(page).locator('[data-reflection="50"]').click()
  expect((await blocks(page))[1].adjust).toEqual({ reflection: 50 })
  const reflect = page.locator('.fp-figure__reflect')
  await expect(reflect).toHaveCount(1)
  await expect(reflect).toHaveAttribute('aria-hidden', 'true')
  const frame = (await page.locator('.fp-figure__frame').boundingBox())!
  const box = (await reflect.boundingBox())!
  // Sous l'image, même largeur, la moitié de sa hauteur ; la légende vient après.
  expect(Math.abs(box.width - frame.width)).toBeLessThan(1.5)
  expect(Math.abs(box.height - frame.height / 2)).toBeLessThan(1.5)
  expect(box.y).toBeGreaterThanOrEqual(frame.y + frame.height)
  const cap = (await page.locator('.fp-figure figcaption').boundingBox())!
  expect(cap.y).toBeGreaterThanOrEqual(box.y + box.height - 0.5)
  expect(await reflect.evaluate((e) => getComputedStyle(e.firstElementChild!).transform)).toMatch(/matrix\(1, 0, 0, -1/)
  expect(await reflect.locator('[data-handle]').count()).toBe(0)
  // Un clic sur le reflet ne sélectionne rien de plus ; Ctrl+Z l'enlève.
  await page.keyboard.press(`${mod}+z`)
  await expect(reflect).toHaveCount(0)
  await page.keyboard.press(`${mod}+y`)
  await expect(reflect).toHaveCount(1)
  // Reflet complet : aussi haut que l'image ; « Effacer les effets » l'enlève.
  await page.locator('.fp-figure__frame').click()
  await rb(page, 'picture-effects')
  await pop(page).locator('[data-reflection="100"]').click()
  await expect.poll(async () => Math.round((await reflect.boundingBox())!.height)).toBe(Math.round(frame.height))
  await page.locator('.fp-figure__frame').click()
  await rb(page, 'picture-effects')
  await pop(page).locator('[data-pfx="clear"]').click()
  await expect(reflect).toHaveCount(0)
  expect((await blocks(page))[1].adjust).toBeUndefined()
  errors.check()
})

test('mode brouillon : texte sur toute la largeur, choix mémorisé', async ({ page }, info) => {
  await open(page, info, ['Texte.'])
  await tab(page, 'view')
  await rb(page, 'view-draft')
  await expect(page.locator('#fp-page')).toHaveClass(/is-draft/)
  await expect(page.locator('.fp-ribbon [data-cmd="view-draft"]')).toHaveClass(/is-active|is-on/)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('folio-pages:settings')!).view)).toBe('draft')
  await page.reload()
  await page.waitForFunction(() => !!(window as any).folio?.doc)
  await expect(page.locator('#fp-page')).toHaveClass(/is-draft/)
  await tab(page, 'view')
  await rb(page, 'view-page')
  await expect(page.locator('#fp-page')).not.toHaveClass(/is-draft/)
})
