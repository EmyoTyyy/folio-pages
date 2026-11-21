// Fonctions de la 0.11 : listes à cocher, encadrés, extraits, défilement
// machine à écrire, objectif d'écriture et statistiques, glossaire,
// formulaires, dessin, inspection, caviardage, enregistrement automatique,
// impression, PDF, formats de sources.

import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { blocks, caretAfter, caretToEnd, docJson, docOfFile, editor, fsState, installFakeFs, makeFile, mod, openEditor, rb, selectText, tab, watchErrors } from './helpers'

const doc = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({ format: 'folio/doc', version: 1, meta: { title: 'Essai', lang: 'fr', author: 'Ana Duval' }, blocks, ...extra })
const dialog = (page: Page, name: string) => page.locator(`[data-dialog="${name}"]`)
const pop = (page: Page) => page.locator('[data-popover]')
async function open(page: Page, info: TestInfo, b: unknown[], extra: Record<string, unknown> = {}) {
  await openEditor(page, makeFile(info, 'essai.html', doc(b, extra)).url)
}
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
  })
})
void [dialog, pop, docJson, caretAfter]

test.describe('listes à cocher', () => {
  test('bouton du ruban, clic sur la case, saisie « [ ] », menu contextuel, annulation', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, ['Acheter du pain', 'Appeler Léa'])
    await tab(page, 'home')
    await selectText(page, 'Acheter du pain')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+End')
    await rb(page, 'checklist')
    await expect(page.locator('.fp-prose ul.fp-checklist > li')).toHaveCount(2)
    await expect(page.locator('.fp-ribbon [data-cmd="checklist"]')).toHaveAttribute('aria-pressed', 'true')
    // un clic sur la case coche l'élément, sans déplacer le texte
    const first = page.locator('.fp-prose ul.fp-checklist > li').first()
    const box = await first.boundingBox()
    await page.mouse.click(box!.x - 12, box!.y + 9)
    await expect(first).toHaveAttribute('data-checked', 'true')
    expect((await blocks(page))[0]).toMatchObject({ type: 'list', style: 'check', items: [{ checked: true }, {}] })
    await page.mouse.click(box!.x - 12, box!.y + 9)
    await expect(first).not.toHaveAttribute('data-checked', 'true')
    await page.keyboard.press(`${mod}+z`)
    await expect(first).toHaveAttribute('data-checked', 'true')
    // Entrée : un nouvel élément, non coché
    await caretToEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('Poster la lettre')
    expect((await blocks(page))[0].items).toHaveLength(3)
    expect((await blocks(page))[0].items[2]).toEqual({ content: [{ text: 'Poster la lettre' }], level: 0, style: 'check' })
    // menu contextuel : cocher au clavier
    await editor(page).locator('li', { hasText: 'Poster' }).click({ button: 'right' })
    await page.locator('[data-context-menu] [data-ctx="toggle-check"]').click()
    expect((await blocks(page))[0].items[2].checked).toBe(true)
    // saisie Markdown : « [x] » en début de paragraphe, et « - [ ] »
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('[x] Fait ')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('- [ ] Reste')
    const b = await blocks(page)
    expect(b.at(-2)).toMatchObject({ type: 'list', style: 'check', items: [{ content: [{ text: 'Fait ' }], checked: true }] })
    expect(b.at(-1)).toMatchObject({ type: 'list', style: 'check', items: [{ content: [{ text: 'Reste' }] }] })
    expect(b.at(-1).items[0].checked).toBeUndefined()
    errors.check()
  })
})

test.describe('encadrés', () => {
  test('insertion, titre renommé sur place, type changé, retrait, saisie « [!warning] »', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, ['Premier paragraphe.', 'Second paragraphe.'])
    await tab(page, 'insert')
    await caretAfter(page, 'Premier')
    await rb(page, 'callout')
    const box = page.locator('.fp-prose aside.fp-callout')
    await expect(box).toHaveCount(1)
    await expect(box).toHaveAttribute('data-kind', 'note')
    await expect(box.locator('.fp-callout__title')).toHaveText('Remarque')
    await page.keyboard.type('Pensez à enregistrer.')
    expect((await blocks(page))[1]).toEqual({ type: 'callout', kind: 'note', blocks: [{ type: 'paragraph', content: [{ text: 'Pensez à enregistrer.' }] }] })
    // renommer sur place
    await box.locator('.fp-callout__title').click()
    const input = box.locator('.fp-callout__rename')
    await expect(input).toBeFocused()
    await input.fill('À retenir')
    await input.press('Enter')
    await expect(box.locator('.fp-callout__title')).toHaveText('À retenir')
    expect((await blocks(page))[1].title).toBe('À retenir')
    // changer de type depuis l'icône
    await box.locator('.fp-callout__icon').click()
    await pop(page).locator('[data-callout="warning"]').click()
    await expect(box).toHaveAttribute('data-kind', 'warning')
    // Échap annule un renommage
    await box.locator('.fp-callout__title').click()
    await input.fill('autre chose')
    await input.press('Escape')
    await expect(box.locator('.fp-callout__title')).toHaveText('À retenir')
    // Ctrl+Z : revient au type d'avant
    await editor(page).locator('p', { hasText: 'Pensez' }).click()
    await page.keyboard.press(`${mod}+z`)
    await expect(box).toHaveAttribute('data-kind', 'note')
    // retirer l'encadré : le texte reste
    await rb(page, 'callout-menu')
    await pop(page).locator('[data-callout-action="remove"]').click()
    await expect(box).toHaveCount(0)
    expect((await blocks(page))[1]).toEqual({ type: 'paragraph', content: [{ text: 'Pensez à enregistrer.' }] })
    // une sélection de deux paragraphes entre dans un encadré « astuce »
    await selectText(page, 'Premier paragraphe.')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+End')
    await rb(page, 'callout-menu')
    await pop(page).locator('[data-callout="tip"]').click()
    expect((await blocks(page))[0]).toMatchObject({ type: 'callout', kind: 'tip', blocks: [{ type: 'paragraph' }, { type: 'paragraph' }] })
    // saisie Markdown en fin de document
    await caretToEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('[!warning] Danger')
    const last = (await blocks(page)).at(-1)
    expect(last).toEqual({ type: 'callout', kind: 'warning', blocks: [{ type: 'paragraph', content: [{ text: 'Danger' }] }] })
    errors.check()
  })
})

test.describe('extraits', () => {
  test('enregistrer la sélection, insérer depuis Composants, F3, gérer, exporter et importer, garder au rechargement', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, [{ content: [{ text: 'Bien ' }, { text: 'cordialement', bold: true }, { text: ',' }] }, 'Ana Duval', 'Lettre suivante : '])
    const selectLine = async () => {
      await selectText(page, 'Bien')
      await page.keyboard.press('Home')
      await page.keyboard.press('Shift+End')
    }
    // menu contextuel : l'entrée existe sur une sélection
    await selectLine()
    await editor(page).locator('strong').first().click({ button: 'right' })
    await expect(page.locator('[data-context-menu] [data-ctx="save-snippet"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await selectLine()
    await tab(page, 'insert')
    await rb(page, 'insert-field')
    await expect(pop(page).locator('.fp-pop__empty')).toBeVisible()
    await pop(page).locator('[data-snip-action="save"]').click()
    const save = dialog(page, 'snippet-save')
    await expect(save.locator('[data-field="snip-preview"]')).toHaveText('Bien cordialement,')
    await save.locator('[data-field="snip-name"]').fill('Politesse')
    await save.locator('[data-field="snip-shortcut"]').fill('b c')
    await save.locator('[data-action="ok"]').click()
    await expect(save.locator('[data-field="snip-error"]')).not.toBeEmpty()
    await save.locator('[data-field="snip-shortcut"]').fill('bc')
    await save.locator('[data-action="ok"]').click()
    await expect(save).toHaveCount(0)
    // insertion depuis le menu, à la fin du document (en ligne : pas de nouveau paragraphe)
    await caretToEnd(page)
    await rb(page, 'insert-field')
    await pop(page).locator('[data-snippet="Politesse"]').click()
    expect((await blocks(page)).at(-1).content).toEqual([{ text: 'Lettre suivante : Bien ' }, { text: 'cordialement', bold: true }, { text: ',' }])
    // F3 : le raccourci tapé devient l'extrait ; un mot inconnu est signalé
    await page.keyboard.press('Enter')
    await page.keyboard.type('Merci. bc')
    await page.keyboard.press('F3')
    expect((await blocks(page)).at(-1).content).toEqual([{ text: 'Merci. Bien ' }, { text: 'cordialement', bold: true }, { text: ',' }])
    await page.keyboard.type(' zzz')
    await page.keyboard.press('F3')
    await expect(page.locator('.fp-toast', { hasText: 'zzz' })).toBeVisible()
    // gérer : renommer, exporter
    await rb(page, 'insert-field')
    await pop(page).locator('[data-snip-action="manage"]').click()
    const manage = dialog(page, 'snippets')
    await manage.locator('[data-snip-name="Politesse"]').fill('Formule')
    await manage.locator('[data-snip-name="Politesse"]').press('Tab')
    const [download] = await Promise.all([page.waitForEvent('download'), manage.locator('[data-snip-action="export"]').click()])
    const file = info.outputPath('snippets.json')
    await download.saveAs(file)
    const exported = JSON.parse(readFileSync(file, 'utf8'))
    expect(exported.snippets[0]).toMatchObject({ name: 'Formule', shortcut: 'bc', inline: true })
    // supprimer, puis réimporter le fichier
    await manage.locator('[data-snip-delete="Formule"]').click()
    await expect(manage.locator('[data-snip-name]')).toHaveCount(0)
    const chooser = page.waitForEvent('filechooser')
    await manage.locator('[data-snip-action="import"]').click()
    await (await chooser).setFiles(file)
    await expect(manage.locator('[data-snip-name="Formule"]')).toHaveCount(1)
    await manage.locator('[data-action="close"]').click()
    // les extraits restent dans le navigateur
    await page.reload()
    await expect(editor(page)).toBeVisible()
    await tab(page, 'insert')
    await rb(page, 'insert-field')
    await expect(pop(page).locator('[data-snippet="Formule"]')).toHaveCount(1)
    errors.check()
  })
})

test.describe('défilement machine à écrire', () => {
  test('la ligne du curseur reste à la même hauteur ; la molette n’est pas contrariée ; paragraphes estompés', async ({ page }, info) => {
    const errors = watchErrors(page)
    const paras = Array.from({ length: 40 }, (_, i) => `Paragraphe ${i + 1} de remplissage, pour avoir une page qui défile.`)
    await open(page, info, paras)
    await tab(page, 'view')
    await rb(page, 'focus-mode-menu')
    await pop(page).locator('[data-focus-opt="typewriter"]').click()
    await expect(page.locator('html')).toHaveClass(/fp-typewriter/)
    // 30 lignes tapées : plus de temps quand la machine est chargée (tests en parallèle).
    test.setTimeout(60_000)
    const canvas = page.locator('#fp-canvas')
    expect(await canvas.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom) / innerHeight)).toBeCloseTo(0.5, 1)
    await editor(page).locator('p', { hasText: /^Paragraphe 3 de/ }).click()
    await page.keyboard.press('End')
    const caretY = () =>
      page.evaluate(() => {
        const sel = getSelection()!
        const r = sel.getRangeAt(0).getBoundingClientRect()
        const box = document.querySelector('#fp-canvas')!.getBoundingClientRect()
        return ((r.top + r.bottom) / 2 - box.top) / box.height
      })
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Enter')
      await page.keyboard.type(`ligne ${i}`)
      // Les dernières lignes : la ligne du curseur revient à 40 % de la hauteur (attendue, sous une machine chargée).
      if (i >= 20) await expect.poll(async () => Math.abs((await caretY()) - 0.4), { timeout: 3000 }).toBeLessThan(0.06)
    }
    // la molette : la page part, rien ne la ramène tant qu'on ne tape pas
    await canvas.hover()
    await page.mouse.wheel(0, -600)
    await page.waitForTimeout(400)
    const after = await canvas.evaluate((el) => el.scrollTop)
    await page.waitForTimeout(300)
    expect(await canvas.evaluate((el) => el.scrollTop)).toBe(after)
    // la frappe suivante ramène la ligne
    await page.keyboard.type('x')
    await expect.poll(async () => Math.abs((await caretY()) - 0.4)).toBeLessThan(0.06)
    // paragraphes estompés : tous sauf celui du curseur
    await rb(page, 'focus-mode-menu')
    await pop(page).locator('[data-focus-opt="dimOthers"]').click()
    await expect(page.locator('html')).toHaveClass(/fp-dim-others/)
    await expect(editor(page).locator('p.fp-current')).toHaveCount(1)
    await expect(editor(page).locator('p.fp-current')).toContainText('ligne 29x')
    expect(Number(await editor(page).locator('p', { hasText: /^Paragraphe 1 de/ }).evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.5)
    expect(Number(await editor(page).locator('p.fp-current').evaluate((el) => getComputedStyle(el).opacity))).toBe(1)
    // à l'impression, rien n'est estompé
    await page.emulateMedia({ media: 'print' })
    expect(Number(await editor(page).locator('p', { hasText: /^Paragraphe 1 de/ }).evaluate((el) => getComputedStyle(el).opacity))).toBe(1)
    await page.emulateMedia({ media: 'screen' })
    // réglages gardés au rechargement
    await page.reload()
    // (le fichier se recharge : sous une machine chargée, l'application démarre en plus de 5 s)
    await expect(page.locator('.fp-prose')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('html')).toHaveClass(/fp-typewriter/)
    await expect(page.locator('html')).toHaveClass(/fp-dim-others/)
    errors.check()
  })
})

test.describe('statistiques et objectif', () => {
  test('clic sur le nombre de mots : comptage, temps, lisibilité, phrases longues, objectif dans la barre d’état', async ({ page }, info) => {
    const errors = watchErrors(page)
    const long = Array.from({ length: 32 }, (_, i) => `mot${i}`).join(' ') + '.'
    await open(page, info, ['Le chat dort. Il fait beau. Nous lisons un livre. La porte est ouverte. Le pain est bon. On part demain.', long])
    await page.locator('#fp-words').click()
    const d = dialog(page, 'word-count')
    await expect(d.locator('[data-stat="words"]')).toHaveText('53')
    await expect(d.locator('[data-stat="sentences"]')).toHaveText('7')
    await expect(d.locator('[data-stat="paragraphs"]')).toHaveText('2')
    await expect(d.locator('[data-stat="read"]')).toHaveText('moins d’une minute')
    await expect(d.locator('[data-stat="score"]')).toHaveText(/^\d+$/)
    await expect(d.locator('[data-stat="long"]')).toHaveText('1')
    // surligner les phrases longues
    await d.locator('[data-field="long-sentences"]').check()
    await expect(page.locator('.fp-prose .fp-long-sentence')).toHaveCount(1)
    await expect(page.locator('.fp-prose .fp-long-sentence')).toHaveText(long)
    // objectif : 100 mots
    await d.locator('[data-field="goal-words"]').fill('100')
    await d.locator('[data-goal="save"]').click()
    await expect(d.locator('[data-stat="goal"]')).toContainText('53 mots sur 100 (53 %)')
    await d.locator('[data-action="close"]').click()
    await expect(page.locator('#fp-words')).toHaveText('53 / 100 mots')
    await expect(page.locator('#fp-words')).toHaveClass(/has-goal/)
    expect((await docJson(page)).goal).toEqual({ words: 100 })
    // la frappe met à jour le compte et les phrases longues
    await caretToEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type(Array.from({ length: 30 }, (_, i) => `autre${i}`).join(' ') + '.')
    await expect(page.locator('.fp-prose .fp-long-sentence')).toHaveCount(2)
    await expect(page.locator('#fp-words')).toHaveText('83 / 100 mots')
    // l'objectif s'annule comme le reste
    await page.locator('#fp-words').click()
    await d.locator('[data-goal="remove"]').click()
    await d.locator('[data-action="close"]').click()
    await expect(page.locator('#fp-words')).toHaveText('83 mots')
    await page.keyboard.press(`${mod}+z`)
    await expect(page.locator('#fp-words')).toHaveText('83 / 100 mots')
    // décocher : plus de surlignage
    await page.locator('#fp-words').click()
    await d.locator('[data-field="long-sentences"]').uncheck()
    await expect(page.locator('.fp-prose .fp-long-sentence')).toHaveCount(0)
    errors.check()
  })
})

test.describe('glossaire et abréviations', () => {
  test('définir un terme, listes à jour, rechercher les abréviations, gérer, première occurrence', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, ['Selon l’OMS, la photosynthèse nourrit la planète.', 'L’Organisation mondiale de la santé (OMS) publie ; l’ADN (acide désoxyribonucléique) aussi.', 'Fin.'])
    // Alt+Maj+G sur une sélection
    await selectText(page, 'photosynthèse')
    await page.keyboard.press('Alt+Shift+G')
    const def = dialog(page, 'define-term')
    await expect(def.locator('[data-field="term"]')).toHaveValue('photosynthèse')
    await expect(def.locator('[data-field="term-kind"]')).toHaveValue('glossary')
    await def.locator('[data-field="term-definition"]').fill('Production de matière organique grâce à la lumière.')
    await def.locator('[data-action="ok"]').click()
    expect((await docJson(page)).terms).toEqual([{ id: 't1', term: 'photosynthèse', definition: 'Production de matière organique grâce à la lumière.', kind: 'glossary' }])
    // le terme est souligné, sa définition au survol
    await expect(editor(page).locator('.fp-term')).toHaveAttribute('title', 'Production de matière organique grâce à la lumière.')
    // insérer le glossaire à la fin
    await caretToEnd(page)
    await tab(page, 'references')
    await rb(page, 'insert-glossary')
    await pop(page).locator('[data-gl-insert="glossary"]').click()
    const gloss = editor(page).locator('.fp-refblock[data-kind="glossary"]')
    await expect(gloss.locator('dt')).toHaveText(['photosynthèse'])
    // rechercher les abréviations : OMS et ADN, forme longue trouvée
    await rb(page, 'abbreviation-tools')
    await pop(page).locator('[data-gl-tool="find"]').click()
    const found = dialog(page, 'find-abbreviations')
    await expect(found.locator('[data-abbr-long="OMS"]')).toHaveValue('Organisation mondiale de la santé')
    await expect(found.locator('[data-abbr-long="ADN"]')).toHaveValue('acide désoxyribonucléique')
    await found.locator('[data-abbr-pick="ADN"]').uncheck()
    await found.locator('[data-action="ok"]').click()
    expect((await docJson(page)).terms.map((x: { term: string }) => x.term)).toEqual(['photosynthèse', 'OMS'])
    // liste des abréviations
    await caretToEnd(page)
    await rb(page, 'insert-glossary')
    await pop(page).locator('[data-gl-insert="abbreviations"]').click()
    const abbr = editor(page).locator('.fp-refblock[data-kind="abbreviations"]')
    await expect(abbr.locator('dt')).toHaveText(['OMS'])
    await expect(abbr.locator('dd')).toHaveText(['Organisation mondiale de la santé'])
    // première occurrence : « OMS » apparaît avant sa forme longue
    await rb(page, 'abbreviation-tools')
    await pop(page).locator('[data-gl-tool="first-use"]').click()
    const fu = dialog(page, 'first-use')
    await expect(fu.locator('[data-first-use="OMS"]')).toBeVisible()
    await fu.locator('[data-action="close"]').click()
    // gérer : changer une définition, retirer un terme
    await rb(page, 'manage-terms')
    const mg = dialog(page, 'terms')
    await mg.locator('[data-term-def="photosynthèse"]').fill('Synthèse par la lumière.')
    await mg.locator('[data-term-def="photosynthèse"]').press('Tab')
    await mg.locator('[data-term-remove="OMS"]').click()
    await mg.locator('[data-action="ok"]').click()
    await expect(gloss.locator('dd')).toHaveText(['Synthèse par la lumière.'])
    await expect(abbr.locator('.fp-toc__empty')).toBeVisible()
    // une seule étape d'annulation
    await editor(page).locator('p', { hasText: 'Fin.' }).click()
    await page.keyboard.press(`${mod}+z`)
    await expect(abbr.locator('dt')).toHaveText(['OMS'])
    errors.check()
  })
})

test.describe('enregistrement automatique', () => {
  test('Chrome : l’allumer demande où enregistrer, puis chaque modification est écrite ; une erreur l’arrête', async ({ page, browserName }, info) => {
    test.skip(browserName !== 'chromium', 'API File System Access')
    await installFakeFs(page)
    const errors = watchErrors(page, [/disque plein/])
    await open(page, info, ['Premier paragraphe.'])
    const sw = page.locator('#fp-autosave')
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    let fs = await fsState(page)
    expect(fs.pickerCalls).toHaveLength(1)
    expect(fs.writes).toHaveLength(1)
    // une modification : écrite deux secondes plus tard, sans Ctrl+S
    await caretToEnd(page)
    await page.keyboard.type(' Ajout.')
    await expect.poll(async () => (await fsState(page)).writes.length, { timeout: 6000 }).toBe(2)
    fs = await fsState(page)
    expect(docOfFile(fs.writes[1].text).blocks[0].content[0].text).toBe('Premier paragraphe. Ajout.')
    expect(fs.pickerCalls).toHaveLength(1)
    await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'saved')
    // gardé au rechargement (réglage), menu Fichier coché
    await page.locator('[data-menu="file"]').click()
    await expect(page.locator('[data-menu-popup="file"] [data-item="autosave"]')).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    // une écriture qui échoue : arrêt, et on le dit
    await page.evaluate(() => ((window as any).__fs.mode = 'fail-write'))
    await caretToEnd(page)
    await page.keyboard.type(' Encore.')
    await expect(page.locator('.fp-toast', { hasText: 'Enregistrement automatique arrêté' })).toBeVisible({ timeout: 8000 })
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    errors.check()
  })

  test('Firefox : l’interrupteur est grisé (pas d’écriture en place)', async ({ page, browserName }, info) => {
    test.skip(browserName !== 'firefox', 'Firefox seulement')
    await open(page, info, ['x'])
    await expect(page.locator('#fp-autosave')).toBeDisabled()
    await expect(page.locator('#fp-autosave')).toHaveAttribute('title', /Chrome ou Edge/)
  })
})

test.describe('impression', () => {
  const long = (n: number) => Array.from({ length: n }, (_, i) => [{ type: 'heading', text: `Partie ${i + 1}` }, 'Texte de la partie.', { type: 'pagebreak' }]).flat().slice(0, -1)
  /** window.print() remplacé : prépare l'impression (beforeprint) et la garde pour l'examiner. */
  const stubPrint = (page: Page) =>
    page.evaluate(() => {
      ;(window as any).__printed = 0
      window.print = () => {
        ;(window as any).__printed++
        window.dispatchEvent(new Event('beforeprint'))
      }
    })
  const afterPrint = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('afterprint')))

  test('à l’impression, les sauts de page ne décalent pas les pages suivantes', async ({ page }, info) => {
    await open(page, info, long(5))
    const tops = () =>
      page.evaluate(() => {
        const pg = document.querySelector('#fp-page') as HTMLElement
        const top = pg.getBoundingClientRect().top
        const sheets = [...pg.querySelectorAll('.fp-sheet')].map((s) => s.getBoundingClientRect().top - top)
        return [...pg.querySelectorAll('h1')].map((x, i) => Math.round(x.getBoundingClientRect().top - top - sheets[i]))
      })
    const screen = await tops()
    await page.emulateMedia({ media: 'print' })
    const printed = await tops()
    await page.emulateMedia({ media: 'screen' })
    expect(screen).toHaveLength(5)
    for (let i = 0; i < 5; i++) expect(Math.abs(printed[i] - screen[i])).toBeLessThan(3)
  })

  test('Ctrl+P : plage de pages, page en cours, livret, commentaires ; PDF de Chrome', async ({ page, browserName }, info) => {
    const errors = watchErrors(page)
    await open(page, info, long(5), { comments: [{ id: 'c1', author: 'Léa', date: '2026-11-01T10:00:00Z', text: 'À vérifier.', resolved: false, replies: [{ author: 'Sam', date: '', text: 'Fait.' }] }] })
    await expect(page.locator('#fp-pages')).toContainText('5')
    await stubPrint(page)
    // pages 2 à 3
    await page.keyboard.press(`${mod}+p`)
    const d = dialog(page, 'print')
    await d.locator('[data-field="print-pages"]').fill('7')
    await d.locator('[data-action="ok"]').click()
    await expect(d.locator('[data-field="print-error"]')).toContainText('de 1 à 5')
    await d.locator('[data-field="print-pages"]').fill('2-3')
    await d.locator('[data-action="ok"]').click()
    await expect(page.locator('.fp-print-pages > .fp-print-page')).toHaveCount(2)
    expect(await page.locator('.fp-print-pages > .fp-print-page').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.page))).toEqual(['2', '3'])
    await afterPrint(page)
    await expect(page.locator('.fp-print-pages')).toHaveCount(0)
    // livret de 5 pages : 4 faces, deux pages chacune (blanches comprises), et la page des commentaires
    await page.keyboard.press(`${mod}+p`)
    await d.locator('[data-field="print-booklet"]').check()
    await d.locator('[data-field="print-comments"]').check()
    await d.locator('[data-action="ok"]').click()
    await expect(page.locator('.fp-print-sheet')).toHaveCount(4)
    expect(await page.locator('.fp-print-sheet').evaluateAll((els) => els.map((e) => [...e.querySelectorAll('.fp-print-half')].map((x) => (x.querySelector('[data-page]') as HTMLElement | null)?.dataset.page ?? '-').join('|')))).toEqual(['-|1', '2|-', '-|3', '4|5'])
    const extra = page.locator('.fp-print-extra')
    await expect(extra).toContainText('Commentaires')
    await expect(extra).toContainText('Léa')
    await expect(extra).toContainText('À vérifier.')
    await expect(extra).toContainText('Fait.')
    if (browserName === 'chromium') {
      await page.emulateMedia({ media: 'print' })
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
      const boxes = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => (Number(m[1]) > Number(m[2]) ? 'L' : 'P'))
      writeFileSync(info.outputPath('livret.pdf'), pdf)
      expect(boxes).toEqual(['L', 'L', 'L', 'L', 'P'])
      await page.emulateMedia({ media: 'screen' })
    }
    await afterPrint(page)
    expect(await page.evaluate(() => (window as any).__printed)).toBe(2)
    // l'impression suivante reprend tout le document
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
    await expect(page.locator('.fp-print-pages')).toHaveCount(0)
    errors.check()
  })
})

test.describe('confidentialité', () => {
  test('caviardage : marquer, rechercher et marquer, appliquer (définitif, sans annulation)', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, ['Contact : lea.martin@exemple.fr ou 06 12 34 56 78.', 'Le dossier de Léa Martin est clos.'])
    await tab(page, 'review')
    await selectText(page, 'Léa Martin')
    await rb(page, 'redact-mark')
    await expect(editor(page).locator('.fp-redact')).toHaveText('Léa Martin')
    await rb(page, 'redact-find')
    const fd = dialog(page, 'redact-find')
    await fd.locator('[data-redact-preset="email"]').click()
    await expect(fd.locator('[data-field="redact-count"]')).toContainText('1 passage')
    await fd.locator('[data-action="ok"]').click()
    await rb(page, 'redact-find')
    await fd.locator('[data-redact-preset="phone"]').click()
    await fd.locator('[data-action="ok"]').click()
    await expect(editor(page).locator('.fp-redact')).toHaveCount(3)
    // l'impression noircit déjà les marques en attente
    await page.emulateMedia({ media: 'print' })
    expect(await editor(page).locator('.fp-redact').first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 0, 0)')
    await page.emulateMedia({ media: 'screen' })
    await rb(page, 'redact-apply')
    const ap = dialog(page, 'redact-apply')
    await expect(ap.locator('[data-field="redact-wipe"]')).toBeChecked()
    await ap.locator('[data-action="ok"]').click()
    await expect(editor(page).locator('.fp-redact')).toHaveCount(0)
    const b = await blocks(page)
    expect(b[0].content).toEqual([{ text: 'Contact : █████████████████████ ou ██████████████.' }])
    expect(b[1].content).toEqual([{ text: 'Le dossier de ██████████ est clos.' }])
    // Ctrl+Z ne fait rien revenir
    await editor(page).locator('p').first().click()
    await page.keyboard.press(`${mod}+z`)
    await page.keyboard.press(`${mod}+z`)
    expect(JSON.stringify(await docJson(page))).not.toContain('Léa Martin')
    errors.check()
  })

  test('inspecter : commentaires, modifications suivies, noms, propriétés, destinataires', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, [{ content: [{ text: 'Un ' }, { text: 'mot', comments: ['c1'] }, { text: ' ajouté', inserted: { author: 'Sam Petit', date: '' } }, { text: '.' }] }], {
      meta: { title: 'Essai', lang: 'fr', author: 'Ana Duval', organization: 'Atelier' },
      comments: [{ id: 'c1', author: 'Léa', date: '', text: 'Hum.', resolved: false, replies: [] }],
      mailMerge: { type: 'letters', source: { name: 'clients.csv', fields: ['Nom'], records: [['Dupont'], ['Durand']] } },
    })
    await page.locator('[data-menu="file"]').click()
    await page.locator('[data-menu-popup="file"] [data-item="inspect"]').click()
    const d = dialog(page, 'inspect')
    for (const id of ['comments', 'changes', 'names', 'properties', 'recipients']) await expect(d.locator(`[data-inspect="${id}"]`)).toBeVisible()
    await expect(d).toContainText('Sam Petit')
    await d.locator('[data-inspect="names"]').click()
    await expect(d.locator('[data-inspect="names"]')).toHaveCount(0)
    expect((await docJson(page)).comments[0].author).toBe('Auteur')
    for (const id of ['comments', 'changes', 'properties', 'recipients']) await d.locator(`[data-inspect="${id}"]`).click()
    // Ce que garde le navigateur (copie de secours, versions : Chrome sur un fichier local) se supprime aussi.
    for (const id of ['snapshot', 'versions']) if (await d.locator(`[data-inspect="${id}"]`).count()) await d.locator(`[data-inspect="${id}"]`).click()
    await expect(d.locator('[data-inspect="comments"], [data-inspect="changes"], [data-inspect="properties"], [data-inspect="recipients"], [data-inspect="names"]')).toHaveCount(0)
    const doc = await docJson(page)
    expect(doc.comments).toEqual([])
    expect(doc.meta.author).toBe('')
    expect(doc.mailMerge.source).toBeUndefined()
    expect(doc.blocks[0].content).toEqual([{ text: 'Un mot ajouté.' }])
    errors.check()
  })
})

test.describe('références', () => {
  test('importer du BibTeX, notes Chicago (citations en notes de bas de page), Vancouver, exporter en RIS', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, ['Une idée célèbre.', 'Une autre.'])
    await tab(page, 'references')
    await rb(page, 'manage-sources')
    const d = dialog(page, 'sources')
    const bib = info.outputPath('refs.bib')
    writeFileSync(bib, '@book{darwin, author = {Charles Darwin}, title = {On the Origin of Species}, publisher = {John Murray}, address = {London}, year = {1859}}\n@article{watson, author = {Watson, James D. and Crick, Francis}, title = {Molecular Structure of Nucleic Acids}, journal = {Nature}, year = 1953, volume = 171, pages = {737--738}}\n')
    const chooser = page.waitForEvent('filechooser')
    await d.locator('[data-source-import]').click()
    await (await chooser).setFiles(bib)
    await expect(d.locator('[data-source]')).toHaveCount(2)
    await expect(page.locator('.fp-toast', { hasText: 'BibTeX' })).toBeVisible()
    // exporter en RIS
    const [download] = await Promise.all([page.waitForEvent('download'), d.locator('[data-field="source-export"]').selectOption('ris')])
    const ris = info.outputPath('refs.ris')
    await download.saveAs(ris)
    expect(readFileSync(ris, 'utf8')).toContain('TY  - BOOK\r\nID  - darwin\r\nAU  - Darwin, Charles')
    await d.locator('[data-action="close"]').click()
    // deux citations dans le texte (APA), puis le style « notes »
    await caretAfter(page, 'célèbre')
    await rb(page, 'insert-citation')
    await pop(page).locator('[data-cite-source="darwin"]').click()
    await caretAfter(page, 'autre')
    await rb(page, 'insert-citation')
    await pop(page).locator('[data-cite-source="darwin"]').click()
    await expect(editor(page).locator('.fp-cite').first()).toHaveText('(Darwin, 1859)')
    await rb(page, 'citation-style')
    await pop(page).locator('[data-citation-style="chicago-notes"]').click()
    await expect(editor(page).locator('.fp-cite')).toHaveCount(0)
    await expect(editor(page).locator('sup.fp-note, .fp-note-ref, [data-note]')).toHaveCount(2)
    const notes = page.locator('.fp-notes-zone .fp-note')
    await expect(notes).toHaveCount(2)
    await expect(notes.nth(0).locator('.fp-cite')).toHaveText('Charles Darwin, On the Origin of Species (London : John Murray, 1859).')
    await expect(notes.nth(0).locator('.fp-cite i')).toHaveText('On the Origin of Species')
    await expect(notes.nth(1).locator('.fp-cite')).toHaveText('Darwin, Origin of Species.')
    // une nouvelle citation va directement dans une note
    await caretToEnd(page)
    await rb(page, 'insert-citation')
    await pop(page).locator('[data-cite-source="watson"]').click()
    await expect(notes).toHaveCount(3)
    await expect(notes.nth(2).locator('.fp-cite')).toContainText('“Molecular Structure of Nucleic Acids,” Nature 171')
    // Vancouver : les notes redeviennent des citations numérotées
    await rb(page, 'citation-style')
    await pop(page).locator('[data-citation-style="vancouver"]').click()
    await expect(notes).toHaveCount(0)
    await expect(editor(page).locator('.fp-cite')).toHaveText(['(1)', '(1)', '(2)'])
    await page.keyboard.press(`${mod}+z`)
    await expect(notes).toHaveCount(3)
    errors.check()
  })
})

test.describe('formulaires', () => {
  test('Développeur : insérer les champs, propriétés, remplir, protéger (seuls les champs se remplissent)', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, ['Nom : ', 'Pays : ', 'Accord : '])
    await tab(page, 'developer')
    await caretAfter(page, 'Nom :')
    await page.keyboard.press('End')
    await rb(page, 'form-text')
    await rb(page, 'form-props')
    const props = dialog(page, 'form-props')
    await props.locator('[data-field="form-name"]').fill('Nom')
    await props.locator('[data-field="form-placeholder"]').fill('Votre nom')
    await props.locator('[data-action="ok"]').click()
    // liste : la fenêtre des propriétés s'ouvre pour les choix
    await caretAfter(page, 'Pays :')
    await page.keyboard.press('End')
    await rb(page, 'form-dropdown')
    await props.locator('[data-field="form-options"]').fill('France\nBelgique\nSuisse')
    await props.locator('[data-action="ok"]').click()
    await caretAfter(page, 'Accord :')
    await page.keyboard.press('End')
    await rb(page, 'form-checkbox')
    // remplir
    const text = editor(page).locator('.fp-form[data-form="text"] input')
    await expect(text).toHaveAttribute('placeholder', 'Votre nom')
    await text.click()
    await page.keyboard.type('Léa Martin')
    await editor(page).locator('.fp-form[data-form="dropdown"] select').selectOption('Belgique')
    await editor(page).locator('.fp-form[data-form="checkbox"] input').check()
    const b = await blocks(page)
    expect(b[0].content[1]).toEqual({ type: 'formfield', kind: 'text', name: 'Nom', value: 'Léa Martin', placeholder: 'Votre nom' })
    expect(b[1].content[1]).toEqual({ type: 'formfield', kind: 'dropdown', options: ['France', 'Belgique', 'Suisse'], value: 'Belgique' })
    expect(b[2].content[1]).toEqual({ type: 'formfield', kind: 'checkbox', checked: true })
    // protéger : le texte ne bouge plus, les champs si
    await rb(page, 'forms-only')
    expect((await docJson(page)).formsOnly).toBe(true)
    await editor(page).locator('p', { hasText: 'Pays' }).click()
    await page.keyboard.press('Home')
    await page.keyboard.type('XYZ')
    await expect(page.locator('.fp-toast', { hasText: 'Formulaire protégé : remplissez' })).toHaveCount(1)
    expect((await blocks(page))[1].content[0].text).toBe('Pays : ')
    await editor(page).locator('.fp-form[data-form="checkbox"] input').uncheck()
    expect((await blocks(page))[2].content[1].checked).toBeUndefined()
    // vider le formulaire, puis lever la protection
    await rb(page, 'form-clear')
    expect((await blocks(page))[0].content[1].value).toBeUndefined()
    await rb(page, 'forms-only')
    expect((await docJson(page)).formsOnly).toBeUndefined()
    errors.check()
  })
})

test.describe('dessin', () => {
  test('stylo, surligneur, gomme ; le trait suit son paragraphe ; annulation', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, ['Premier paragraphe du texte.', 'Second paragraphe, à annoter.', 'Fin.'])
    await tab(page, 'draw')
    await rb(page, 'ink-pen')
    await expect(page.locator('[data-ink-layer]')).toBeVisible()
    const target = editor(page).locator('p', { hasText: 'Second' })
    const box = (await target.boundingBox())!
    const drawLine = async (x0: number, y0: number, x1: number, y1: number) => {
      await page.mouse.move(x0, y0)
      await page.mouse.down()
      for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10)
      await page.mouse.up()
    }
    await drawLine(box.x + 10, box.y + box.height / 2, box.x + 150, box.y + box.height / 2 + 6)
    let b = await blocks(page)
    expect(b[1].ink).toHaveLength(1)
    expect(b[1].ink[0]).toMatchObject({ tool: 'pen', color: '#1f2937', width: 2 })
    expect(b[1].ink[0].points.length).toBeGreaterThanOrEqual(4)
    expect(b[0].ink).toBeUndefined()
    await expect(target.locator('svg.fp-ink path')).toHaveCount(1)
    // surligneur jaune, plus épais et transparent
    await rb(page, 'ink-highlighter')
    await drawLine(box.x + 10, box.y + 4, box.x + 120, box.y + 4)
    b = await blocks(page)
    expect(b[1].ink[1]).toMatchObject({ tool: 'highlighter', color: '#facc15', width: 10 })
    // le dessin suit son paragraphe quand le texte au-dessus s'allonge
    await rb(page, 'ink-select')
    await expect(page.locator('[data-ink-layer]')).toHaveCount(0)
    const before = (await target.locator('svg.fp-ink').boundingBox())!.y
    await editor(page).locator('p', { hasText: 'Premier' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Une ligne de plus.')
    await expect.poll(async () => (await target.locator('svg.fp-ink').boundingBox())!.y).toBeGreaterThan(before + 10)
    // gomme : un passage sur le premier trait le retire
    await rb(page, 'ink-eraser')
    const now = (await target.boundingBox())!
    await drawLine(now.x + 148, now.y + now.height / 2 - 2, now.x + 148, now.y + now.height / 2 + 12)
    b = await blocks(page)
    expect(b[2].ink.map((s: { tool: string }) => s.tool)).toEqual(['highlighter'])
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-ink-layer]')).toHaveCount(0)
    await page.keyboard.press(`${mod}+z`)
    expect((await blocks(page))[2].ink).toHaveLength(2)
    // effacer tout le dessin
    await rb(page, 'ink-clear')
    expect((await blocks(page))[2].ink).toBeUndefined()
    errors.check()
  })
})

test.describe('ouvrir .odt et .rtf', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as any).showOpenFilePicker
      delete (window as any).showSaveFilePicker
    })
  })
  for (const [ext, mime] of [['odt', 'application/vnd.oasis.opendocument.text'], ['rtf', 'application/rtf']] as const) {
    test(`Ctrl+O : un fichier .${ext} de LibreOffice s’ouvre en document`, async ({ page }, info) => {
      const errors = watchErrors(page)
      await open(page, info, ['x'])
      const buffer = readFileSync(`tests/fixtures/${ext}/rapport.${ext}`)
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press(`${mod}+o`)])
      await chooser.setFiles({ name: `rapport.${ext}`, mimeType: mime, buffer })
      await expect(editor(page)).toContainText('312 stagiaires accueillis')
      await expect(editor(page).locator('h1, h2').first()).toBeVisible()
      await expect(editor(page).locator('table')).toHaveCount(2)
      await expect(editor(page).locator('img')).toHaveCount(1)
      expect((await docJson(page)).meta.title).toBe('Rapport d’activité 2025'.replace('’', "'"))
      errors.check()
    })
  }
})

test.describe('PDF direct', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as any).showSaveFilePicker
    })
  })
  test('Partager → Exporter en PDF : un vrai PDF (pages, texte, liens, plan, métadonnées), sans impression', async ({ page }, info) => {
    const errors = watchErrors(page)
    const { execFileSync } = await import('node:child_process')
    await open(
      page,
      info,
      [
        { type: 'heading', text: 'Rapport annuel' },
        { content: [{ text: 'Texte en ' }, { text: 'gras', bold: true }, { text: ', un ' }, { text: 'lien', link: 'https://example.org/page' }, { text: ' et une formule ' }, { type: 'math', tex: '\\alpha + \\beta \\leq \\pi' }, { text: '.' }, { type: 'note', text: 'Une note de bas de page.' }] },
        { type: 'list', items: ['Premier point', 'Second point'] },
        { type: 'list', style: 'check', items: [{ text: 'Tâche faite', checked: true }, 'Tâche à faire'] },
        { type: 'table', header: true, rows: [['Mois', 'Ventes'], ['Janvier', '1 200 €']] },
        { type: 'callout', kind: 'warning', text: 'Attention aux délais.' },
        { type: 'pagebreak' },
        { type: 'heading', level: 2, text: 'Annexe' },
        'Dernière page.',
      ],
      { meta: { title: 'Rapport PDF', lang: 'fr', author: 'Ana Duval' } },
    )
    await page.locator('#fp-share').click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-share="pdf"]').click()])
    expect(download.suggestedFilename()).toBe('essai.pdf')
    const file = info.outputPath('rapport.pdf')
    await download.saveAs(file)
    expect(readFileSync(file).subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const meta = execFileSync('pdfinfo', [file], { encoding: 'utf8' })
    expect(meta).toMatch(/Pages:\s+2/)
    expect(meta).toMatch(/Title:\s+Rapport PDF/)
    expect(meta).toMatch(/Author:\s+Ana Duval/)
    expect(meta).toMatch(/Page size:\s+595\.28 x 841\.89 pts \(A4\)/)
    const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
    for (const s of ['Rapport annuel', 'gras', 'lien', 'Premier point', 'Tâche faite', 'Janvier', '1 200 €', 'Attention aux délais', 'Une note de bas de page', 'Annexe', 'Dernière page', 'α', 'β', '≤', 'π']) expect(text).toContain(s)
    // puces et numéros dessinés, liens cliquables, plan des titres
    expect(text).toMatch(/•\s+Premier point/)
    const raw = readFileSync(file).toString('latin1')
    expect(raw).toContain('/URI (https://example.org/page)')
    expect(raw).toContain('/Outlines')
    errors.check()
  })
})
