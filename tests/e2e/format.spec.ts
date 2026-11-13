// Phase 2 : mise en forme au ruban et au clavier, Markdown à la frappe,
// styles, thème, listes, casse, pinceau, champs, liens, caractères spéciaux,
// rechercher et remplacer.

import { expect, test, type Page } from '@playwright/test'
import { blocks, caretAfter, caretToEnd, docJson, editor, makeFile, mod, openEditor, rb, selectText, tab, watchErrors, watchNetwork } from './helpers'

const doc = (b: unknown[], extra: Record<string, unknown> = {}) => ({ format: 'folio/doc', version: 1, meta: { title: 'Essai' }, blocks: b, ...extra })

async function open(page: Page, info: import('@playwright/test').TestInfo, b: unknown[], extra: Record<string, unknown> = {}) {
  const f = makeFile(info, 'doc.html', doc(b, extra))
  await openEditor(page, f.url)
}

test.describe('mise en forme des caractères', () => {
  test('gras, italique, souligné, barré, exposant au ruban ; l’état du bouton suit la sélection', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, ['un mot ici'])
    await selectText(page, 'mot')
    for (const f of ['bold', 'italic', 'underline', 'strike', 'sup']) await rb(page, f)
    expect((await blocks(page))[0].content[1]).toEqual({ text: 'mot', bold: true, italic: true, underline: true, strike: true, sup: true })
    await expect(page.locator('.fp-ribbon [data-cmd="bold"]')).toHaveAttribute('aria-pressed', 'true')
    await selectText(page, 'ici')
    await expect(page.locator('.fp-ribbon [data-cmd="bold"]')).toHaveAttribute('aria-pressed', 'false')
    // l'indice remplace l'exposant
    await selectText(page, 'mot')
    await rb(page, 'sub')
    expect((await blocks(page))[0].content[1]).toMatchObject({ text: 'mot', sub: true })
    expect((await blocks(page))[0].content[1].sup).toBeUndefined()
    errors.check()
  })

  test('raccourcis clavier', async ({ page }, info) => {
    await open(page, info, ['abc'])
    await selectText(page, 'abc')
    await page.keyboard.press(`${mod}+b`)
    await page.keyboard.press(`${mod}+i`)
    await page.keyboard.press(`${mod}+Shift+x`)
    await page.keyboard.press(`${mod}+.`)
    expect((await blocks(page))[0].content).toEqual([{ text: 'abc', bold: true, italic: true, strike: true, sup: true }])
  })

  test('couleur, surlignage, police et taille', async ({ page }, info) => {
    await open(page, info, ['le texte coloré'])
    await selectText(page, 'texte')
    await rb(page, 'color-menu')
    await page.locator('[data-popover="color-menu"] [data-color="accent2"]').click()
    await rb(page, 'highlight-menu')
    await page.locator('[data-popover="highlight-menu"] [data-color="green"]').click()
    const family = page.locator('[data-cmd="font-family"]')
    await family.click()
    await family.fill('Newsreader')
    await family.press('Enter')
    await selectText(page, 'texte')
    const size = page.locator('[data-cmd="font-size"]')
    await size.click()
    await size.fill('14,5')
    await size.press('Enter')
    expect((await blocks(page))[0].content[1]).toEqual({ text: 'texte', color: 'accent2', highlight: 'green', font: 'Newsreader', size: 14.5 })
    // la liste des tailles ; puis agrandir d'un cran
    await selectText(page, 'texte')
    await page.locator('[data-combo="font-size"] .fp-rb-combo__arrow').click()
    await page.locator('[data-popover="font-size-list"] [data-value="24"]').click()
    await selectText(page, 'texte')
    await rb(page, 'grow')
    expect((await blocks(page))[0].content[1].size).toBe(28)
    // le champ de taille affiche la taille du texte sélectionné
    await expect(size).toHaveValue('28')
    // le bouton principal réapplique la dernière couleur
    await selectText(page, 'coloré')
    await rb(page, 'color')
    expect((await blocks(page))[0].content.at(-1)).toMatchObject({ text: 'coloré', color: 'accent2' })
    // une police invalide est refusée sans dommage
    await selectText(page, 'le')
    await family.click()
    await family.fill('Arial;color:red')
    await family.press('Enter')
    expect((await blocks(page))[0].content[0]).toEqual({ text: 'le ' })
  })

  test('effacer la mise en forme et changer la casse', async ({ page }, info) => {
    await open(page, info, [{ type: 'heading', level: 2, align: 'center', content: [{ text: 'Mot gras', bold: true, color: '#ff0000' }] }])
    await selectText(page, 'Mot gras')
    await rb(page, 'clear')
    expect(await blocks(page)).toEqual([{ type: 'paragraph', content: [{ text: 'Mot gras' }] }])
    await selectText(page, 'Mot gras')
    await rb(page, 'case')
    await page.locator('[data-popover="case"] [data-case="upper"]').click()
    expect((await blocks(page))[0].content[0].text).toBe('MOT GRAS')
    await selectText(page, 'MOT GRAS')
    await page.keyboard.press('Shift+F3')
    expect((await blocks(page))[0].content[0].text).toBe('mot gras')
  })

  test('boîte de dialogue Police', async ({ page }, info) => {
    await open(page, info, ['abc def'])
    await selectText(page, 'def')
    await page.locator('.fp-rb-launch[data-launch="font"]').click()
    const dlg = page.locator('[data-dialog="font"]')
    await dlg.locator('[data-field="font-size"]').fill('20')
    await dlg.locator('[data-flag="smallcaps"]').check()
    await dlg.locator('[data-field="letter-spacing"]').fill('1,5')
    await dlg.locator('[data-field="lang"]').fill('en-GB')
    await dlg.locator('[data-action="ok"]').click()
    expect((await blocks(page))[0].content[1]).toEqual({ text: 'def', smallcaps: true, size: 20, letterSpacing: 1.5, lang: 'en-GB' })
    // langue invalide : la fenêtre reste ouverte avec un message
    await selectText(page, 'abc')
    await page.locator('.fp-rb-launch[data-launch="font"]').click()
    await dlg.locator('[data-field="lang"]').fill('fr"><x')
    await dlg.locator('[data-action="ok"]').click()
    await expect(dlg.locator('.fp-field-error')).not.toBeEmpty()
    await dlg.locator('[data-action="cancel"]').click()
    expect((await blocks(page))[0].content[0]).toEqual({ text: 'abc ' })
  })
})

test.describe('paragraphes', () => {
  test('alignement, interligne, retrait, trame, au ruban et au clavier', async ({ page }, info) => {
    await open(page, info, ['premier', 'second'])
    await caretAfter(page, 'premier')
    await rb(page, 'align-center')
    await page.keyboard.press(`${mod}+Shift+r`)
    await caretAfter(page, 'second')
    await rb(page, 'line-spacing')
    await page.locator('[data-popover="line-spacing"] [data-line="1.5"]').click()
    await rb(page, 'indent-more')
    await rb(page, 'indent-more')
    await rb(page, 'shading-menu')
    await page.locator('[data-popover="shading-menu"] [data-color="#f5c518"]').click()
    expect(await blocks(page)).toEqual([
      { type: 'paragraph', content: [{ text: 'premier' }], align: 'right' },
      { type: 'paragraph', content: [{ text: 'second' }], indent: { left: 72 }, line: 1.5, shading: '#f5c518' },
    ])
    await expect(page.locator('.fp-ribbon [data-cmd="align-left"]')).toHaveAttribute('aria-pressed', 'true')
  })

  test('boîte de dialogue Paragraphe : centimètres et points', async ({ page }, info) => {
    await open(page, info, ['texte'])
    await caretAfter(page, 'texte')
    await page.locator('.fp-rb-launch[data-launch="paragraph"]').click()
    const dlg = page.locator('[data-dialog="paragraph"]')
    await dlg.locator('[data-field="indent-left"]').fill('2,54')
    await dlg.locator('[data-field="special"]').selectOption('hanging')
    await dlg.locator('[data-field="indent-first"]').fill('1,27')
    await dlg.locator('[data-field="space-before"]').fill('12')
    await dlg.locator('[data-field="line"]').fill('1,15')
    await dlg.locator('[data-field="keep-next"]').check()
    await dlg.locator('[data-action="ok"]').click()
    expect((await blocks(page))[0]).toEqual({ type: 'paragraph', content: [{ text: 'texte' }], indent: { left: 72, first: -36 }, spacing: { before: 12 }, line: 1.15, keepNext: true })
    // une valeur hors limites est refusée
    await page.locator('.fp-rb-launch[data-launch="paragraph"]').click()
    await dlg.locator('[data-field="line"]').fill('99')
    await dlg.locator('[data-action="ok"]').click()
    await expect(dlg.locator('.fp-field-error')).not.toBeEmpty()
    await dlg.locator('[data-action="cancel"]').click()
  })
})

test.describe('styles et thème', () => {
  test('la galerie applique les styles ; le style courant est signalé', async ({ page }, info) => {
    await open(page, info, ['Mon titre', 'texte'])
    await caretAfter(page, 'Mon titre')
    await page.locator('.fp-ribbon [data-style-id="heading2"]').click()
    await expect(page.locator('.fp-ribbon [data-style-id="heading2"]')).toHaveClass(/is-current/)
    await caretAfter(page, 'texte')
    await page.locator('.fp-ribbon [data-style-id="title"]').click()
    expect(await blocks(page)).toEqual([
      { type: 'heading', level: 2, content: [{ text: 'Mon titre' }] },
      { type: 'paragraph', content: [{ text: 'texte' }], style: 'title' },
    ])
    await page.keyboard.press(`${mod}+Alt+0`)
    expect((await blocks(page))[1]).toEqual({ type: 'paragraph', content: [{ text: 'texte' }] })
    await page.keyboard.press(`${mod}+Alt+3`)
    expect((await blocks(page))[1]).toMatchObject({ type: 'heading', level: 3 })
  })

  test('créer un style, le modifier, le supprimer', async ({ page }, info) => {
    await open(page, info, ['note importante', 'autre'])
    await caretAfter(page, 'note importante')
    await rb(page, 'styles-more')
    await page.locator('[data-popover="styles-more"] .fp-pop__item').filter({ hasText: /Nouveau style/ }).click()
    const dlg = page.locator('[data-dialog="style"]')
    await dlg.locator('[data-field="style-name"]').fill('Encadré vert')
    await dlg.locator('[data-field="style-color"]').selectOption('accent1')
    await dlg.locator('[data-field="style-bold"]').selectOption('yes')
    await dlg.locator('[data-action="ok"]').click()
    let d = await docJson(page)
    expect(d.styles['encadre-vert']).toEqual({ name: 'Encadré vert', basedOn: 'normal', color: 'accent1', bold: true })
    expect(d.blocks[0]).toEqual({ type: 'paragraph', content: [{ text: 'note importante' }], style: 'encadre-vert' })
    await expect(page.locator('.fp-ribbon [data-style-id="encadre-vert"]')).toBeVisible()
    // le texte prend vraiment la couleur du thème
    const color = await page.locator('.fp-prose p[data-style="encadre-vert"]').evaluate((el) => getComputedStyle(el).color)
    expect(color).toBe('rgb(30, 107, 85)')
    // modifier un style intégré
    await caretAfter(page, 'autre')
    await page.keyboard.press(`${mod}+Alt+1`)
    await rb(page, 'styles-more')
    await page.locator('[data-popover="styles-more"] .fp-pop__item').filter({ hasText: /^Modifier$/ }).click()
    await dlg.locator('[data-field="style-size"]').fill('26')
    await dlg.locator('[data-action="ok"]').click()
    d = await docJson(page)
    expect(d.styles.heading1).toEqual({ size: 26 })
    expect(parseFloat(await page.locator('.fp-prose h1').evaluate((el) => getComputedStyle(el).fontSize))).toBeCloseTo((26 * 4) / 3, 2)
    // supprimer le style personnel : ses paragraphes reviennent à Normal, en une étape annulable
    await page.locator('.fp-rb-launch[data-launch="styles"]').click()
    await page.locator('[data-dialog="styles"] [data-style-id="encadre-vert"] [data-style-action="Supprimer"]').click()
    await page.locator('[data-dialog="styles"] [data-action="close"]').click()
    d = await docJson(page)
    expect(d.styles['encadre-vert']).toBeUndefined()
    expect(d.blocks[0]).toEqual({ type: 'paragraph', content: [{ text: 'note importante' }] })
    await editor(page).click()
    await page.keyboard.press(`${mod}+z`)
    d = await docJson(page)
    expect(d.blocks[0].style).toBe('encadre-vert')
  })

  test('un thème change les polices et couleurs de tout le document', async ({ page }, info) => {
    await open(page, info, [{ type: 'heading', text: 'Titre' }, 'corps'])
    const font = () => page.locator('.fp-prose h1').evaluate((el) => getComputedStyle(el).fontFamily)
    expect(await font()).toMatch(/Newsreader/)
    await tab(page, 'design')
    await page.locator('[data-theme-name="modern"]').click()
    expect((await docJson(page)).theme.name).toBe('modern')
    expect(await font()).toMatch(/Hanken Grotesk/)
    // couleurs du thème
    await rb(page, 'theme-colors')
    await page.locator('[data-popover] [data-colors="custom"]').click()
    await page.locator('[data-dialog="theme-colors"] [data-theme-key="accent1"]').evaluate((el: HTMLInputElement) => {
      el.value = '#aa0000'
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.locator('[data-dialog="theme-colors"] [data-action="ok"]').click()
    expect((await docJson(page)).theme.colors.accent1).toBe('#aa0000')
    expect(await page.locator('.fp-prose h1').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(170, 0, 0)')
    await editor(page).click()
    await page.keyboard.press(`${mod}+z`)
    expect((await docJson(page)).theme.colors.accent1).not.toBe('#aa0000')
  })
})

test.describe('listes', () => {
  test('puces, numéros, niveaux, numérotation et départ', async ({ page }, info) => {
    await open(page, info, ['un', 'deux', 'trois'])
    await selectText(page, 'un')
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.up('Shift')
    await rb(page, 'bullets')
    let b = await blocks(page)
    expect(b).toHaveLength(1)
    expect(b[0].items.map((i: any) => i.content[0].text)).toEqual(['un', 'deux', 'trois'])
    await caretAfter(page, 'deux')
    await page.keyboard.press('Tab')
    b = await blocks(page)
    expect(b[0].items.map((i: any) => i.level)).toEqual([0, 1, 0])
    await page.keyboard.press('Shift+Tab')
    await rb(page, 'numbers')
    await rb(page, 'numbers-menu')
    await page.locator('[data-popover="numbers-menu"] [data-numbering="ROMAN"]').click()
    b = await blocks(page)
    expect(b[0]).toMatchObject({ type: 'list', style: 'number', numbering: 'ROMAN' })
    await expect(page.locator('.fp-prose ol')).toHaveCSS('list-style-type', 'upper-roman')
    await rb(page, 'numbers-menu')
    await page.locator('[data-popover="numbers-menu"] .fp-pop__item').filter({ hasText: /^Commencer à/ }).click()
    await page.locator('[data-dialog="list-start"] [data-field="start"]').fill('4')
    await page.locator('[data-dialog="list-start"] [data-action="ok"]').click()
    expect((await blocks(page))[0].start).toBe(4)
    await expect(page.locator('.fp-prose ol')).toHaveAttribute('start', '4')
    // retirer l'élément du milieu de la liste : la liste est coupée, la suite continue la numérotation
    await caretAfter(page, 'deux')
    await page.keyboard.press(`${mod}+Shift+7`)
    b = await blocks(page)
    expect(b.map((x: any) => x.type)).toEqual(['list', 'paragraph', 'list'])
    expect(b[2]).toMatchObject({ continue: true, start: 5 })
    await expect(page.locator('.fp-prose ol').nth(1)).toHaveAttribute('start', '5')
  })

  test('une liste qui continue la numérotation suit la précédente', async ({ page }, info) => {
    await open(page, info, [{ type: 'list', style: 'number', items: ['a', 'b', 'c'] }, 'milieu', { type: 'list', style: 'number', continue: true, items: ['d'] }])
    await expect(page.locator('.fp-prose ol').nth(1)).toHaveAttribute('start', '4')
    // ajouter un élément à la première liste décale la seconde
    await caretAfter(page, 'c')
    await page.keyboard.press('Enter')
    await page.keyboard.type('c2')
    await expect(page.locator('.fp-prose ol').nth(1)).toHaveAttribute('start', '5')
  })
})

test.describe('Markdown à la frappe', () => {
  test('titres, listes, emphase, code, citation, ligne, champs, échappement', async ({ page }, info) => {
    await open(page, info, [''])
    await editor(page).click()
    await page.keyboard.type('## Titre deux')
    await page.keyboard.press('Enter')
    await page.keyboard.type('du **gras** et *italique* et `code` et ~~barré~~ fin')
    await page.keyboard.press('Enter')
    await page.keyboard.type('- puce')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('> cité')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('page {{page}} et \\*pas italique* et snake_case_name fin')
    const b = await blocks(page)
    expect(b[0]).toEqual({ type: 'heading', level: 2, content: [{ text: 'Titre deux' }] })
    expect(b[1].content).toEqual([
      { text: 'du ' },
      { text: 'gras', bold: true },
      { text: ' et ' },
      { text: 'italique', italic: true },
      { text: ' et ' },
      { text: 'code', code: true },
      { text: ' et ' },
      { text: 'barré', strike: true },
      { text: ' fin' },
    ])
    expect(b[2]).toMatchObject({ type: 'list', style: 'bullet', items: [{ content: [{ text: 'puce' }] }] })
    expect(b[3]).toMatchObject({ type: 'quote' })
    const last = b.at(-1)
    expect(last.content).toEqual([{ text: 'page ' }, { type: 'field', name: 'page', format: '' }, { text: ' et *pas italique* et snake_case_name fin' }])
  })

  test('retour arrière défait une conversion ; la préférence la désactive', async ({ page }, info) => {
    await open(page, info, [''])
    await editor(page).click()
    await page.keyboard.type('# ')
    await page.keyboard.press('Backspace')
    expect((await blocks(page))[0]).toEqual({ type: 'paragraph', content: [{ text: '# ' }] })
    await page.keyboard.press(`${mod}+a`)
    await page.keyboard.press('Delete')
    await tab(page, 'view')
    await rb(page, 'view-markdown')
    await editor(page).click()
    await page.keyboard.type('# pas un titre **ni gras**')
    expect((await blocks(page))[0]).toEqual({ type: 'paragraph', content: [{ text: '# pas un titre **ni gras**' }] })
    await rb(page, 'view-markdown') // remettre la préférence
  })

  test('ligne horizontale et bloc de code', async ({ page }, info) => {
    await open(page, info, ['avant'])
    await caretToEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('--- ')
    await page.keyboard.type('```python ')
    await page.keyboard.type('def f(): return 1')
    const b = await blocks(page)
    expect(b.map((x: any) => x.type)).toEqual(['paragraph', 'divider', 'code'])
    expect(b[2]).toEqual({ type: 'code', language: 'python', text: 'def f(): return 1' })
    // coloration syntaxique
    await expect(page.locator('.fp-prose pre .fp-tk-keyword').first()).toHaveText('def')
  })
})

test.describe('insertions', () => {
  test('saut de page, ligne, citation, code, caractère spécial, champ', async ({ page }, info) => {
    await open(page, info, ['Rapport'], { meta: { title: 'Rapport annuel', author: 'Camille' } })
    await caretToEnd(page)
    await page.keyboard.press(`${mod}+Enter`)
    await tab(page, 'insert')
    await rb(page, 'insert-symbol')
    await page.locator('[data-popover="insert-symbol"] [data-symbol="«"]').click()
    await rb(page, 'insert-field')
    await page.locator('[data-popover="insert-field"] [data-field="title"]').click()
    const b = await blocks(page)
    expect(b.map((x: any) => x.type)).toEqual(['paragraph', 'pagebreak', 'paragraph'])
    expect(b[2].content).toEqual([{ text: '«' }, { type: 'field', name: 'title', format: '' }])
    await expect(page.locator('.fp-prose .fp-field')).toHaveText('Rapport annuel')
    // le champ suit le titre du document
    await page.locator('#fp-title').fill('Bilan 2026')
    await expect(page.locator('.fp-prose .fp-field')).toHaveText('Bilan 2026')
    await expect(page.locator('.fp-prose .fp-page-break')).toHaveCount(1)
  })

  test('date et heure : champ ou texte fixe', async ({ page }, info) => {
    await open(page, info, [''])
    await editor(page).click()
    await tab(page, 'insert')
    await rb(page, 'insert-date')
    const dlg = page.locator('[data-dialog="date-time"]')
    await dlg.locator('[data-field="date-format"]').selectOption('YYYY-MM-DD')
    await dlg.locator('[data-action="insert"]').click()
    const today = await page.evaluate(() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
    await expect(page.locator('.fp-prose .fp-field')).toHaveText(today)
    expect((await blocks(page))[0].content).toEqual([{ type: 'field', name: 'date', format: 'YYYY-MM-DD' }])
    await rb(page, 'insert-date')
    await dlg.locator('[data-field="date-format"]').selectOption('YYYY-MM-DD')
    await dlg.locator('[data-field="date-live"]').uncheck()
    await dlg.locator('[data-action="insert"]').click()
    expect((await blocks(page))[0].content[1]).toEqual({ text: today })
  })

  test('liens : insertion, modification, refus d’un lien dangereux, suppression', async ({ page }, info) => {
    await open(page, info, ['voir le site'])
    await selectText(page, 'le site')
    await page.keyboard.press(`${mod}+k`)
    const dlg = page.locator('[data-dialog="link"]')
    await dlg.locator('[data-field="href"]').fill('javascript:alert(1)')
    await dlg.locator('[data-action="ok"]').click()
    await expect(dlg.locator('.fp-field-error')).not.toBeEmpty()
    await dlg.locator('[data-field="href"]').fill('exemple.org')
    await dlg.locator('[data-action="ok"]').click()
    expect((await blocks(page))[0].content[1]).toEqual({ text: 'le site', link: 'https://exemple.org' })
    await caretAfter(page, 'le s')
    await page.keyboard.press(`${mod}+k`)
    await expect(dlg.locator('[data-field="href"]')).toHaveValue('https://exemple.org')
    await dlg.locator('[data-action="remove"]').click()
    expect((await blocks(page))[0].content).toEqual([{ text: 'voir le site' }])
  })
})

test.describe('pinceau, recherche, commandes', () => {
  test('reproduire la mise en forme', async ({ page }, info) => {
    await open(page, info, [{ content: [{ text: 'modèle', bold: true, color: 'accent2' }, { text: ' et cible' }] }])
    await caretAfter(page, 'mod')
    await rb(page, 'painter')
    await expect(page.locator('.fp-ribbon [data-cmd="painter"]')).toHaveAttribute('aria-pressed', 'true')
    await selectText(page, 'cible')
    await editor(page).dispatchEvent('mouseup')
    await expect(page.locator('.fp-ribbon [data-cmd="painter"]')).toHaveAttribute('aria-pressed', 'false')
    expect((await blocks(page))[0].content.at(-1)).toEqual({ text: 'cible', bold: true, color: 'accent2' })
  })

  test('rechercher et remplacer, avec expression régulière, en une étape annulable', async ({ page }, info) => {
    await open(page, info, ['Le chat et le Chat', 'un chaton', '2026-11-08 et 2025-01-02'])
    await editor(page).click()
    await page.keyboard.press(`${mod}+f`)
    const find = page.locator('#fp-find-input')
    await expect(find).toBeFocused()
    await find.fill('chat')
    await expect(page.locator('#fp-find-count')).toHaveText(/3/)
    await page.locator('[data-opt="wholeWord"]').click()
    await expect(page.locator('#fp-find-count')).toHaveText(/2/)
    await page.locator('[data-opt="caseSensitive"]').click()
    await expect(page.locator('#fp-find-count')).toHaveText(/1/)
    await expect(page.locator('.fp-prose .fp-find-hit')).toHaveCount(1)
    // expression régulière avec groupes
    await page.locator('[data-opt="caseSensitive"]').click()
    await page.locator('[data-opt="wholeWord"]').click()
    await page.locator('[data-opt="regex"]').click()
    await find.fill('(\\d{4})-(\\d{2})-(\\d{2})')
    await expect(page.locator('#fp-find-count')).toHaveText(/2/)
    await page.keyboard.press(`${mod}+h`)
    await page.locator('#fp-replace-input').fill('$3/$2/$1')
    await page.locator('[data-find="replace-all"]').click()
    expect((await blocks(page))[2].content[0].text).toBe('08/11/2026 et 02/01/2025')
    // expression invalide : signalée, sans erreur
    await find.fill('(')
    await expect(page.locator('#fp-find-count')).toHaveText(/invalide/i)
    await find.press('Escape')
    await expect(page.locator('#fp-find')).toHaveCount(0)
    await page.keyboard.press(`${mod}+z`)
    expect((await blocks(page))[2].content[0].text).toBe('2026-11-08 et 2025-01-02')
  })

  test('rechercher le texte surligné, depuis le surligneur ou l’option de la barre', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, [
      { content: [{ text: 'Un ' }, { text: 'passage jaune', highlight: 'yellow' }, { text: ' et une ' }, { text: 'trame', textShading: '#d9d9d9' }, { text: '.' }] },
      { content: [{ text: 'Le ' }, { text: 'chat', highlight: 'green' }, { text: ' et le chat.' }] },
    ])
    await caretAfter(page, 'Un')
    await rb(page, 'highlight-menu')
    await page.locator('[data-popover="highlight-menu"] [data-find-highlighted]').click()
    const find = page.locator('#fp-find-input')
    await expect(find).toBeFocused()
    await expect(find).toHaveValue('')
    await expect(page.locator('[data-opt="highlighted"]')).toHaveAttribute('aria-pressed', 'true')
    // deux passages surlignés ; la trame de caractère n'en est pas
    await expect(page.locator('#fp-find-count')).toHaveText(/2/)
    await expect(page.locator('.fp-prose .fp-find-hit')).toHaveCount(2)
    await find.press('Enter')
    await expect(page.locator('#fp-find-count')).toHaveText(/1 (sur|of) 2/)
    await expect(page.locator('.fp-prose .fp-find-hit--current')).toHaveText('passage jaune')
    await find.press('Enter')
    await expect(page.locator('#fp-find-count')).toHaveText(/2 (sur|of) 2/)
    await expect(page.locator('.fp-prose .fp-find-hit--current')).toHaveText('chat')
    // avec un texte : seul le « chat » surligné compte
    await find.fill('chat')
    await expect(page.locator('#fp-find-count')).toHaveText(/1/)
    await page.locator('[data-opt="highlighted"]').click()
    await expect(page.locator('#fp-find-count')).toHaveText(/2/)
    // remplacer dans le surlignage seulement, en une étape annulable
    await page.locator('[data-opt="highlighted"]').click()
    await page.keyboard.press(`${mod}+h`)
    await page.locator('#fp-replace-input').fill('chien')
    await page.locator('[data-find="replace-all"]').click()
    expect((await blocks(page))[1].content).toEqual([{ text: 'Le ' }, { text: 'chien', highlight: 'green' }, { text: ' et le chat.' }])
    await find.press('Escape')
    await expect(page.locator('#fp-find')).toHaveCount(0)
    await page.keyboard.press(`${mod}+z`)
    expect((await blocks(page))[1].content[1]).toEqual({ text: 'chat', highlight: 'green' })
    errors.check()
  })

  test('la recherche fait défiler jusqu’au résultat, surligné dans le texte sans cadre', async ({ page }, info) => {
    const errors = watchErrors(page)
    const paras = Array.from({ length: 120 }, (_, i) => (i === 100 ? 'ici la cible' : i === 30 ? 'une autre cible' : `Paragraphe ${i} de remplissage, assez long pour occuper une ligne.`))
    await open(page, info, paras)
    await editor(page).click()
    await page.keyboard.press(`${mod}+Home`)
    await page.keyboard.press(`${mod}+f`)
    const find = page.locator('#fp-find-input')
    const current = page.locator('.fp-prose .fp-find-hit--current')
    const visible = () =>
      current.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= innerHeight
      })
    // en tapant : le premier résultat après le curseur est montré
    await find.fill('cible')
    await expect(current).toHaveText('cible')
    await expect.poll(visible).toBe(true)
    // Entrée : premier, puis second résultat, loin dans le document
    await find.press('Enter')
    await expect(page.locator('#fp-find-count')).toHaveText(/1 (sur|of) 2/)
    await expect.poll(visible).toBe(true)
    await find.press('Enter')
    await expect(page.locator('#fp-find-count')).toHaveText(/2 (sur|of) 2/)
    await expect.poll(visible).toBe(true)
    await expect(find).toBeFocused()
    // le résultat reste dans la ligne : ni marge, ni cadre, ni ombre de la barre
    const style = await current.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { display: cs.display, padding: cs.paddingTop, border: cs.borderTopWidth, position: cs.position }
    })
    expect(style).toEqual({ display: 'inline', padding: '0px', border: '0px', position: 'static' })
    // précédent (Maj+Entrée) : retour au premier, de nouveau visible
    await find.press('Shift+Enter')
    await expect(page.locator('#fp-find-count')).toHaveText(/1 (sur|of) 2/)
    await expect.poll(visible).toBe(true)
    errors.check()
  })

  test('recherche d’une commande (Alt+Q)', async ({ page }, info) => {
    await open(page, info, ['mot'])
    await selectText(page, 'mot')
    await page.keyboard.press('Alt+q')
    await expect(page.locator('#fp-cmdsearch')).toBeFocused()
    await page.keyboard.type('itali')
    await expect(page.locator('[data-popover="command-search"] [data-pop-item]').first()).toContainText('Italique')
    await page.keyboard.press('Enter')
    expect((await blocks(page))[0].content[0]).toEqual({ text: 'mot', italic: true })
  })

  test('raccourcis et astuces (F1, ?)', async ({ page }, info) => {
    await open(page, info, ['x'])
    await page.keyboard.press('F1')
    await expect(page.locator('[data-dialog="shortcuts"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('#fp-save-mode').click()
    await page.keyboard.press('?')
    await expect(page.locator('[data-dialog="shortcuts"]')).toBeVisible()
    await page.keyboard.press('Escape')
    // dans le texte, « ? » s'écrit
    await caretToEnd(page)
    await page.keyboard.type('?')
    expect((await blocks(page))[0].content[0].text).toBe('x\u202f?') // correction automatique (document en français)
  })
})

test('aucune requête réseau pendant l’édition', async ({ page }, info) => {
  const net = watchNetwork(page)
  await open(page, info, [{ type: 'image', src: 'https://example.org/photo.png', alt: 'en ligne' }, 'texte'])
  await expect(page.locator('.fp-figure[data-kind="external"] .fp-figure__placeholder')).toBeVisible()
  for (const t of ['home', 'insert', 'design', 'view']) await tab(page, t)
  net.check()
})
