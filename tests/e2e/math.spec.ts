// Phase 6 : équations LaTeX (rendu MathML, éditeur, frappe, collage, numérotation, .docx).

import { expect, test, type Page } from '@playwright/test'
import { blocks, caretAfter, docJson, editor, makeFile, mod, openEditor, rb, removeFsAccess, saveByDownload, tab, watchErrors } from './helpers'

const DOC = {
  format: 'folio/doc',
  version: 1,
  id: 'maths-00001',
  meta: { title: 'Maths' },
  math: { macros: '\\newcommand{\\vv}[1]{\\mathbf{#1}}' },
  blocks: [
    { md: 'Soit $\\vv{u} \\cdot \\vv{v}$, voir $\\eqref{pyth}$. Prix : 5 $ et 10 $.' },
    { type: 'equation', tex: 'a^2 + b^2 = c^2 \\label{pyth}', numbered: true },
    { md: 'Erreur : $\\frac{a}$ et fin.' },
    { type: 'equation', tex: '\\int_0^1 x\\,dx = \\frac{1}{2}' },
    'Dernier paragraphe.',
  ],
}

const dialog = (page: Page) => page.locator('[data-dialog="equation"]')
const source = (page: Page) => dialog(page).locator('[data-field="tex"]')

test('les formules sont dessinées en MathML, numérotées, renvoyées ; une formule illisible montre sa source', async ({ page }, info) => {
  const errs = watchErrors(page)
  await openEditor(page, makeFile(info, 'm.html', DOC).url)
  const prose = editor(page)
  await expect(prose.locator('.fp-math math')).toHaveCount(2)
  await expect(prose.locator('.fp-equation math')).toHaveCount(2)
  await expect(prose.locator('.fp-equation__num').first()).toHaveText('(1)')
  // \eqref donne le numéro ; la macro du document est lue (𝐮 en gras).
  await expect(prose.locator('.fp-math').nth(1)).toContainText('(1)')
  await expect(prose.locator('.fp-math').first()).toContainText('𝐮')
  // Le prix reste du texte.
  await expect(prose).toContainText('Prix : 5 $ et 10 $.')
  const bad = prose.locator('.fp-math.is-error')
  await expect(bad).toHaveText('$\\frac{a}$')
  await expect(bad).toHaveAttribute('title', /incomplète|malformed/)
  // Le MathML a une vraie taille (rendu natif, pas une ligne vide).
  const box = await prose.locator('.fp-equation math').first().boundingBox()
  expect(box!.height).toBeGreaterThan(12)
  expect(box!.width).toBeGreaterThan(60)
  errs.check()
})

test('Alt+= ouvre l’éditeur : aperçu en direct, erreurs, modèles ; Ctrl+Entrée insère', async ({ page }, info) => {
  const errs = watchErrors(page)
  await openEditor(page, makeFile(info, 'm.html', DOC).url)
  await caretAfter(page, 'Dernier')
  await page.keyboard.press('Alt+=')
  await expect(dialog(page)).toBeVisible()
  await source(page).fill('\\frac{1}{')
  await expect(dialog(page).locator('.fp-eq__status')).toHaveClass(/is-error/)
  await source(page).fill('x^2')
  await expect(dialog(page).locator('[data-preview] math')).toHaveCount(1)
  await expect(dialog(page).locator('.fp-eq__status')).toHaveClass(/is-ok/)
  // Un modèle : la fraction, le curseur dans le numérateur.
  const frac = dialog(page).locator('.fp-eq-pal__item').first()
  await expect(frac).toHaveAttribute('data-snippet', '\\frac{}{}')
  await frac.click()
  await page.keyboard.type('a')
  await expect(source(page)).toHaveValue('x^2\\frac{a}{}')
  await source(page).fill('E = mc^2')
  await page.keyboard.press(`${mod}+Enter`)
  await expect(dialog(page)).toHaveCount(0)
  const b = (await blocks(page))[4]
  expect(b.content).toEqual([{ text: 'Dernier' }, { type: 'math', tex: 'E = mc^2' }, { text: ' paragraphe.' }])
  // Annulable.
  await page.keyboard.press(`${mod}+z`)
  expect((await blocks(page))[4].content).toEqual([{ text: 'Dernier paragraphe.' }])
  errs.check()
})

test('Insertion → Équation numérotée ; double-clic pour la modifier, la passer dans la ligne, la supprimer', async ({ page }, info) => {
  const errs = watchErrors(page)
  await openEditor(page, makeFile(info, 'm.html', DOC).url)
  await caretAfter(page, 'Dernier paragraphe.')
  await tab(page, 'insert')
  await page.locator('.fp-ribbon [data-cmd="insert-equation-menu"]').click()
  await page.locator('[data-eq="numbered"]').click()
  await source(page).fill('\\sum_{k=1}^{n} k')
  await dialog(page).locator('[data-action="ok"]').click()
  let bs = await blocks(page)
  expect(bs[5]).toEqual({ type: 'equation', tex: '\\sum_{k=1}^{n} k', numbered: true })
  await expect(editor(page).locator('.fp-equation__num').nth(2)).toHaveText('(2)')
  // Double-clic : la source, la disposition.
  await editor(page).locator('.fp-equation').nth(2).dblclick()
  await expect(source(page)).toHaveValue('\\sum_{k=1}^{n} k')
  await dialog(page).locator('input[value="inline"]').check()
  await dialog(page).locator('[data-action="ok"]').click()
  bs = await blocks(page)
  expect(bs[5]).toEqual({ type: 'paragraph', content: [{ type: 'math', tex: '\\sum_{k=1}^{n} k' }] })
  // Entrée sur une formule sélectionnée l'ouvre aussi ; Supprimer l'enlève.
  await editor(page).locator('.fp-math').last().click()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeVisible()
  await dialog(page).locator('[data-action="delete"]').click()
  bs = await blocks(page)
  expect(bs[5]).toEqual({ type: 'paragraph', content: [] })
  errs.check()
})

test('à la frappe : $x^2$ devient une formule, _ n’y met pas d’italique ; $$…$$ seul, une équation', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'm.html', DOC).url)
  await caretAfter(page, 'Dernier paragraphe.')
  await page.keyboard.press('Enter')
  await page.keyboard.type('aire $\\pi r_1^2$ et 3 $ de plus')
  let bs = await blocks(page)
  expect(bs[5].content).toEqual([{ text: 'aire ' }, { type: 'math', tex: '\\pi r_1^2' }, { text: ' et 3 $ de plus' }])
  await page.keyboard.press('Enter')
  await page.keyboard.type('$$E=mc^2$$')
  bs = await blocks(page)
  expect(bs[6]).toEqual({ type: 'equation', tex: 'E=mc^2' })
  // Le curseur est dans le paragraphe d'après : on continue d'écrire.
  await page.keyboard.type('suite')
  expect((await blocks(page))[7].content).toEqual([{ text: 'suite' }])
})

test('coller du texte avec des $…$ (réponse d’une IA) donne des formules', async ({ page, browserName }, info) => {
  test.skip(browserName === 'firefox', 'Firefox ne permet pas de fabriquer un événement de collage avec données.')
  await openEditor(page, makeFile(info, 'm.html', DOC).url)
  await caretAfter(page, 'Dernier paragraphe.')
  await page.keyboard.press('Enter')
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData('text/plain', 'La relation \\(F = ma\\) et\n\n$$\\frac{d}{dt}p = F$$\n\nfin, 5 $.')
    document.querySelector('.fp-prose')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await expect.poll(async () => (await blocks(page)).length).toBeGreaterThan(6)
  const bs = await blocks(page)
  expect(bs.slice(5)).toEqual([
    { type: 'paragraph', content: [{ text: 'La relation ' }, { type: 'math', tex: 'F = ma' }, { text: ' et' }] },
    { type: 'equation', tex: '\\frac{d}{dt}p = F' },
    { type: 'paragraph', content: [{ text: 'fin, 5 $.' }] },
  ])
})

test('macros du document : Insertion → Équation → Macros ; toutes les formules suivent, annulable', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'm.html', DOC).url)
  await tab(page, 'insert')
  await page.locator('.fp-ribbon [data-cmd="insert-equation-menu"]').click()
  await page.locator('[data-eq="macros"]').click()
  const area = page.locator('[data-dialog="math-macros"] [data-field="macros"]')
  await expect(area).toHaveValue('\\newcommand{\\vv}[1]{\\mathbf{#1}}')
  await area.fill('\\newcommand{\\vv}[1]{\\vec{#1}}')
  await page.locator('[data-dialog="math-macros"] [data-action="ok"]').click()
  // \vec : une flèche, plus de gras.
  await expect(editor(page).locator('.fp-math').first()).not.toContainText('𝐮')
  expect((await docJson(page)).math).toEqual({ macros: '\\newcommand{\\vv}[1]{\\vec{#1}}' })
  await editor(page).click()
  await page.keyboard.press(`${mod}+z`)
  expect((await docJson(page)).math).toEqual({ macros: '\\newcommand{\\vv}[1]{\\mathbf{#1}}' })
})

test('convertir les $…$ d’un texte existant ; enregistrer et rouvrir garde tout', async ({ page }, info) => {
  const errs = watchErrors(page)
  await removeFsAccess(page)
  const raw = { format: 'folio/doc', version: 1, id: 'brut-000001', meta: { title: 'Brut' }, blocks: [{ text: 'Un $x^2$ resté en texte.' }, { text: '$$\\int f$$' }] }
  await openEditor(page, makeFile(info, 'brut.html', raw).url)
  await tab(page, 'insert')
  await page.locator('.fp-ribbon [data-cmd="insert-equation-menu"]').click()
  await page.locator('[data-eq="convert"]').click()
  await expect(page.locator('.fp-toast').last()).toContainText('2 formules converties')
  expect(await blocks(page)).toEqual([
    { type: 'paragraph', content: [{ text: 'Un ' }, { type: 'math', tex: 'x^2' }, { text: ' resté en texte.' }] },
    { type: 'equation', tex: '\\int f' },
  ])
  const saved = await saveByDownload(page, info, 'brut2.html')
  await openEditor(page, saved.url)
  await expect(editor(page).locator('math')).toHaveCount(2)
  errs.check()
})

test('en lecture, une formule ne s’ouvre pas ; en vue page, une équation prend sa place', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'm.html', DOC).url)
  // Vue page : l'équation a une hauteur, le paragraphe suivant est dessous.
  const eq = await editor(page).locator('.fp-equation').first().boundingBox()
  const next = await editor(page).locator('p', { hasText: 'Erreur' }).boundingBox()
  expect(next!.y).toBeGreaterThanOrEqual(eq!.y + eq!.height - 1)
  await tab(page, 'view')
  await rb(page, 'view-read')
  await editor(page).locator('.fp-equation').first().dblclick()
  await expect(dialog(page)).toHaveCount(0)
})
