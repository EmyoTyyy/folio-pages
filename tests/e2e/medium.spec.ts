// Fonctions de la 0.11 (suite) : sens d'écriture, recherche dans les notes,
// numéros de ligne, graphiques, fenêtres.

import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { blocks, editor, makeFile, mod, openEditor, rb, selectText, tab, watchErrors } from './helpers'

const doc = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({ format: 'folio/doc', version: 1, meta: { title: 'Essai', lang: 'fr', author: 'Ana Duval' }, blocks, ...extra })
const pop = (page: Page) => page.locator('[data-popover]')
async function open(page: Page, info: TestInfo, b: unknown[], extra: Record<string, unknown> = {}) {
  await openEditor(page, makeFile(info, 'essai.html', doc(b, extra)).url)
}
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
  })
})

/** Côté où le texte du paragraphe est posé : écart à gauche et à droite de sa boîte, en pixels. */
async function gaps(page: Page, text: string): Promise<{ left: number; right: number }> {
  return editor(page)
    .locator('p', { hasText: text })
    .evaluate((p) => {
      const box = p.getBoundingClientRect()
      const r = document.createRange()
      r.selectNodeContents(p)
      const t = r.getBoundingClientRect()
      return { left: Math.round(t.left - box.left), right: Math.round(box.right - t.right) }
    })
}

test.describe('sens d’écriture', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as any).showSaveFilePicker
    })
  })

  test('paragraphe de droite à gauche, alignement vu sur la page, texte vertical des cellules, PDF', async ({ page }, info) => {
    const errors = watchErrors(page)
    const { execFileSync } = await import('node:child_process')
    await open(page, info, ['שלום עולם', 'Bonjour tout le monde', { type: 'table', header: false, rows: [['Colonne', 'Ligne'], ['c', 'd']] }])
    const para = (text: string) => editor(page).locator('p', { hasText: text })
    // Un paragraphe en hébreu va de lui-même de droite à gauche, posé à droite.
    expect(await para('שלום').evaluate((el) => getComputedStyle(el).direction)).toBe('rtl')
    expect((await gaps(page, 'שלום')).right).toBeLessThan(2)
    expect((await gaps(page, 'שלום')).left).toBeGreaterThan(100)

    // Accueil → De droite à gauche sur un paragraphe en français.
    await tab(page, 'home')
    await selectText(page, 'Bonjour')
    await rb(page, 'dir-rtl')
    await expect(para('Bonjour')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('.fp-ribbon [data-cmd="dir-rtl"]')).toHaveAttribute('aria-pressed', 'true')
    // Son alignement naturel est à droite : c'est le bouton « droite » qui est enfoncé.
    await expect(page.locator('.fp-ribbon [data-cmd="align-right"]')).toHaveAttribute('aria-pressed', 'true')
    expect((await gaps(page, 'Bonjour')).right).toBeLessThan(2)
    expect((await blocks(page))[1]).toEqual({ type: 'paragraph', content: [{ text: 'Bonjour tout le monde' }], dir: 'rtl' })
    // « Aligner à gauche » le pose à gauche de la page (la fin du paragraphe : « right » dans le format).
    await rb(page, 'align-left')
    expect((await gaps(page, 'Bonjour')).left).toBeLessThan(2)
    await expect(page.locator('.fp-ribbon [data-cmd="align-left"]')).toHaveAttribute('aria-pressed', 'true')
    expect((await blocks(page))[1]).toMatchObject({ dir: 'rtl', align: 'right' })
    await page.keyboard.press(`${mod}+z`)
    await page.keyboard.press(`${mod}+z`)
    await expect(para('Bonjour')).toHaveAttribute('dir', 'auto')
    expect((await blocks(page))[1]).toEqual({ type: 'paragraph', content: [{ text: 'Bonjour tout le monde' }] })

    // Mise en page → Orientation du texte : le menu donne le sens du paragraphe et celui des cellules.
    await selectText(page, 'Colonne')
    await tab(page, 'layout')
    await rb(page, 'text-direction')
    await expect(pop(page).locator('[data-dir="ltr"]')).toHaveAttribute('aria-checked', 'true')
    await expect(pop(page).locator('[data-text-dir="none"]')).toHaveAttribute('aria-checked', 'true')
    await pop(page).locator('[data-text-dir="tbrl"]').click()
    const cell = editor(page).locator('td', { hasText: 'Colonne' })
    await expect(cell).toHaveAttribute('data-text-dir', 'tbrl')
    expect(await cell.evaluate((el) => getComputedStyle(el).writingMode)).toBe('vertical-rl')
    // le mot court verticalement : sa boîte est plus haute que large
    const word = await cell.locator('p').evaluate((p) => {
      const r = document.createRange()
      r.selectNodeContents(p)
      const b = r.getBoundingClientRect()
      return { w: b.width, h: b.height }
    })
    expect(word.h).toBeGreaterThan(word.w * 2)
    // onglet Tableau : de bas en haut pour l'autre cellule
    await selectText(page, 'Ligne')
    await tab(page, 'table')
    await rb(page, 'cell-text-direction')
    await pop(page).locator('[data-text-dir="btlr"]').click()
    await expect(editor(page).locator('td', { hasText: 'Ligne' })).toHaveAttribute('data-text-dir', 'btlr')
    const rows = (await blocks(page))[2].rows
    expect(rows[0].map((c: { textDir?: string }) => c.textDir)).toEqual(['tbrl', 'btlr'])
    expect(rows[1].map((c: { textDir?: string }) => c.textDir)).toEqual([undefined, undefined])
    // Hors d'un tableau, les choix des cellules sont grisés.
    await selectText(page, 'Bonjour')
    await tab(page, 'layout')
    await rb(page, 'text-direction')
    await expect(pop(page).locator('[data-text-dir="tbrl"]')).toBeDisabled()
    await page.keyboard.press('Escape')

    // PDF direct : les mots des cellules tournées sont écrits tournés (et restent lisibles par pdftotext).
    await page.locator('#fp-share').click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-share="pdf"]').click()])
    const file = info.outputPath('sens.pdf')
    await download.saveAs(file)
    const text = execFileSync('pdftotext', ['-raw', file, '-'], { encoding: 'utf8' })
    expect(text).toContain('Colonne')
    expect(text).toContain('Ligne')
    const bbox = execFileSync('pdftotext', ['-bbox', file, '-'], { encoding: 'utf8' })
    const box = (w: string) => {
      const m = new RegExp(`xMin="([\\d.]+)" yMin="([\\d.]+)" xMax="([\\d.]+)" yMax="([\\d.]+)">${w}<`).exec(bbox)
      if (!m) throw new Error(`${w} absent`)
      const [x0, y0, x1, y1] = m.slice(1).map(Number)
      return { w: x1 - x0, h: y1 - y0 }
    }
    for (const w of ['Colonne', 'Ligne']) expect(box(w).h).toBeGreaterThan(box(w).w * 2)
    expect(box('Bonjour').w).toBeGreaterThan(box('Bonjour').h * 2)
    expect(readFileSync(file).subarray(0, 5).toString('latin1')).toBe('%PDF-')
    errors.check()
  })
})

test.describe('rechercher dans les notes', () => {
  for (const view of ['page', 'web'] as const) {
    test(`vue ${view} : résultats des notes à leur place, note ouverte au résultat, remplacer un à un et tout`, async ({ page }, info) => {
      const errors = watchErrors(page)
      await open(page, info, [
        { content: [{ text: 'Le chat dort.' }, { type: 'note', text: 'Un chat noir, un chat blanc.' }] },
        { content: [{ text: 'Autre chat ici.' }, { type: 'note', kind: 'end', text: 'Le chat, encore.' }] },
      ])
      if (view === 'web') {
        await tab(page, 'view')
        await rb(page, 'view-web')
      }
      await editor(page).click()
      // (l'éditeur remet la sélection du clic peu après : on attend avant Ctrl+Début)
      await page.waitForTimeout(60)
      await page.keyboard.press(`${mod}+Home`)
      await page.keyboard.press(`${mod}+f`)
      const find = page.locator('#fp-find-input')
      const count = page.locator('#fp-find-count')
      await find.fill('chat')
      await expect(count).toHaveText(/5/)
      // les notes dessinées montrent leurs résultats
      await expect(page.locator('.fp-note mark.fp-find-hit')).toHaveCount(3)
      await expect(editor(page).locator('.fp-find-hit')).toHaveCount(2)
      await find.press('Enter')
      await expect(count).toHaveText(/1 (sur|of) 5/)
      // suivant : dans la note de bas de page, qui s'ouvre, résultat sélectionné ; le champ garde le focus
      await find.press('Enter')
      await expect(count).toHaveText(/2 (sur|of) 5/)
      const noteEditor = page.locator('.fp-note.is-editing .fp-hf')
      await expect(noteEditor).toBeVisible()
      await expect(noteEditor.locator('.fp-find-hit--current')).toHaveText('chat')
      await expect(noteEditor.locator('.fp-find-hit')).toHaveCount(2)
      await expect(find).toBeFocused()
      await find.press('Enter')
      await expect(count).toHaveText(/3 (sur|of) 5/)
      await expect(noteEditor.locator('.fp-find-hit--current')).toHaveText('chat')
      // retour au texte : la note se ferme
      await find.press('Enter')
      await expect(count).toHaveText(/4 (sur|of) 5/)
      await expect(page.locator('.fp-note.is-editing')).toHaveCount(0)
      await expect(editor(page).locator('.fp-find-hit--current')).toHaveText('chat')
      await find.press('Enter')
      await expect(count).toHaveText(/5 (sur|of) 5/)
      await expect(page.locator('.fp-note.is-editing .fp-find-hit--current')).toHaveText('chat')
      // précédent
      await find.press('Shift+Enter')
      await expect(count).toHaveText(/4 (sur|of) 5/)

      // Remplacer un à un : dans la note, puis le suivant
      await page.keyboard.press(`${mod}+h`)
      await page.locator('#fp-replace-input').fill('chien')
      // (Ctrl+H garde le résultat courant, le 4e : 5e, 1er, 2e)
      await expect(count).toHaveText(/4 (sur|of) 5/)
      for (let k = 0; k < 3; k++) await find.press('Enter')
      await expect(count).toHaveText(/2 (sur|of) 5/)
      await page.locator('[data-find="replace"]').click()
      await expect(count).toHaveText(/2 (sur|of) 4/)
      const notes = async () => {
        const b = await blocks(page)
        return b.flatMap((p: { content: { type?: string; blocks?: { content: { text: string }[] }[] }[] }) => p.content.filter((x) => x.type === 'note').map((n) => n.blocks![0].content.map((x) => x.text).join('')))
      }
      expect(await notes()).toEqual(['Un chien noir, un chat blanc.', 'Le chat, encore.'])
      await expect(page.locator('.fp-note.is-editing .fp-find-hit--current')).toHaveText('chat')
      // Tout remplacer : texte et notes, une étape annulable
      await page.locator('[data-find="replace-all"]').click()
      await expect(count).toHaveText(/aucun|no/i)
      expect(await notes()).toEqual(['Un chien noir, un chien blanc.', 'Le chien, encore.'])
      expect((await blocks(page))[1].content[0].text).toBe('Autre chien ici.')
      await find.press('Escape')
      await expect(page.locator('.fp-note mark.fp-find-hit')).toHaveCount(0)
      await page.keyboard.press(`${mod}+z`)
      expect(await notes()).toEqual(['Un chien noir, un chat blanc.', 'Le chat, encore.'])
      expect((await blocks(page))[0].content[0].text).toBe('Le chat dort.')
      errors.check()
    })
  }
})

test.describe('numéros de ligne', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as any).showSaveFilePicker
    })
  })

  test('menu de Mise en page : continus, par page, sans numéros pour un paragraphe, options ; vue web ; PDF et impression', async ({ page, browserName }, info) => {
    const errors = watchErrors(page)
    const { execFileSync } = await import('node:child_process')
    const long = 'Entre les soussignés, le bailleur et le locataire, il a été convenu ce qui suit. Le présent contrat a pour objet la location d’un logement meublé, avec une cave et une place de stationnement, pour un an.'
    await open(page, info, [{ type: 'heading', text: 'Contrat' }, long, { type: 'table', rows: [['Pièce', 'Surface'], ['Séjour', '24 m²']] }, 'Fait en deux exemplaires.', { type: 'pagebreak' }, 'Page deux, première ligne.', 'Page deux, seconde ligne.'])
    const nums = page.locator('.fp-line-numbers .fp-line-number')
    const labels = () => nums.allTextContents()
    await expect(nums).toHaveCount(0)
    await tab(page, 'layout')
    await rb(page, 'line-numbers')
    await expect(pop(page).locator('[data-line-numbers="none"]')).toHaveAttribute('aria-checked', 'true')
    await pop(page).locator('[data-line-numbers="continuous"]').click()
    expect((await blocks(page)).length).toBe(7)
    expect(await page.evaluate(() => (window as any).folio.doc.lineNumbers)).toEqual({ restart: 'continuous', start: 1, countBy: 1 })
    // le titre, les lignes du long paragraphe, la dernière ligne de la page 1, puis les deux de la page 2 ; pas le tableau
    const lines = await editor(page)
      .locator('p', { hasText: 'Entre les soussignés' })
      .evaluate((p) => {
        const r = document.createRange()
        r.selectNodeContents(p)
        return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size
      })
    expect(lines).toBeGreaterThan(1)
    await expect(nums).toHaveCount(1 + lines + 1 + 2)
    await expect.poll(labels).toEqual(Array.from({ length: lines + 4 }, (_, i) => String(i + 1)))
    // chaque numéro est sur sa ligne, à gauche du texte
    const placed = await page.evaluate(() => {
      const n = [...document.querySelectorAll<HTMLElement>('.fp-line-number')].find((e) => e.textContent === '1')!.getBoundingClientRect()
      const h = document.querySelector('.fp-prose h1')!
      const r = document.createRange()
      r.selectNodeContents(h)
      const t = r.getBoundingClientRect()
      return { dy: Math.abs(n.bottom - t.bottom), gap: t.left - n.right }
    })
    expect(placed.dy).toBeLessThan(8)
    expect(placed.gap).toBeGreaterThan(10)
    expect(placed.gap).toBeLessThan(40)

    // Recommencer à chaque page : la page 2 repart de 1.
    await rb(page, 'line-numbers')
    await pop(page).locator('[data-line-numbers="page"]').click()
    await expect.poll(async () => (await labels()).slice(-2)).toEqual(['1', '2'])
    // Sans numéros pour le paragraphe du curseur : ses lignes ne comptent plus.
    await selectText(page, 'Page deux, première')
    await tab(page, 'layout')
    await rb(page, 'line-numbers')
    await pop(page).locator('[data-line-numbers="suppress"]').click()
    expect((await blocks(page))[5]).toMatchObject({ noLineNumbers: true })
    await expect.poll(async () => (await labels()).slice(-1)).toEqual(['1'])
    await rb(page, 'line-numbers')
    await expect(pop(page).locator('[data-line-numbers="suppress"]')).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await page.keyboard.press(`${mod}+z`)
    await expect(nums.last()).toHaveText('2')

    // Options : commencer à 10, un numéro toutes les 5 lignes, continus.
    await rb(page, 'line-numbers')
    await pop(page).locator('[data-line-numbers="options"]').click()
    const d = page.locator('[data-dialog="line-numbers"]')
    await expect(d.locator('[data-field="ln-on"]')).toBeChecked()
    await d.locator('[data-field="ln-start"]').fill('10')
    await d.locator('[data-field="ln-count-by"]').fill('5')
    await d.locator('[data-field="ln-distance"]').fill('abc')
    await d.locator('[data-action="ok"]').click()
    await expect(d.locator('[data-field="ln-distance"]')).toHaveAttribute('aria-invalid', 'true')
    await d.locator('[data-field="ln-distance"]').fill('1')
    await d.locator('[data-field="ln-restart-continuous"]').check()
    await d.locator('[data-action="ok"]').click()
    await expect(d).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).folio.doc.lineNumbers)).toEqual({ restart: 'continuous', start: 10, countBy: 5, distance: 28.5 })
    await expect(nums.first()).toHaveText('10')
    const shown = (await labels()).map(Number)
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.every((n) => n % 5 === 0)).toBe(true)
    expect(shown[0]).toBe(10)

    // PDF direct : les numéros sont dans la marge.
    await page.locator('#fp-share').click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-share="pdf"]').click()])
    const file = info.outputPath('lignes.pdf')
    await download.saveAs(file)
    const bbox = execFileSync('pdftotext', ['-bbox', file, '-'], { encoding: 'utf8' })
    const xOf = (w: string) => Number(new RegExp(`xMin="([\\d.]+)"[^>]*>${w}<`).exec(bbox)?.[1] ?? NaN)
    expect(xOf('10')).toBeLessThan(xOf('Contrat'))
    expect(xOf('Contrat') - xOf('10')).toBeLessThan(60)

    // Impression (Chrome) : les numéros aussi.
    if (browserName === 'chromium') {
      await page.emulateMedia({ media: 'print' })
      await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
      const printed = info.outputPath('impression.pdf')
      writeFileSync(printed, pdf)
      const text = execFileSync('pdftotext', ['-layout', printed, '-'], { encoding: 'utf8' })
      expect(text).toMatch(/10\s+Contrat/)
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
      await page.emulateMedia({ media: 'screen' })
    }

    // Vue web : pas de pages, pas de numéros.
    await tab(page, 'view')
    await rb(page, 'view-web')
    await expect(nums).toHaveCount(0)
    await rb(page, 'view-page')
    await expect(nums.first()).toHaveText('10')
    errors.check()
  })
})

test.describe('graphiques', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as any).showSaveFilePicker
    })
  })

  test('depuis un tableau : fenêtre (type, titre, légende, données), modifier au double-clic, Entrée, menu, thème ; exemple ; PDF', async ({ page }, info) => {
    const errors = watchErrors(page)
    const { execFileSync } = await import('node:child_process')
    await open(page, info, [
      { type: 'table', rows: [['Mois', 'Ventes', 'Notes'], ['Janvier', '1 200 €', 'bien'], ['Février', '1 450 €', ''], ['Mars', '980 €', 'à revoir']] },
      'Après le tableau.',
      { type: 'table', rows: [['a', 'b'], ['c', 'd']] },
    ])
    const dialog = page.locator('[data-dialog="chart"]')
    const chart = editor(page).locator('.fp-chart')
    // Onglet Tableau → Graphique : les données du tableau (la colonne sans nombres n'est pas une série).
    await editor(page).locator('td', { hasText: 'Janvier' }).click()
    await tab(page, 'table')
    await rb(page, 'table-chart')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-label="0"]')).toHaveValue('Janvier')
    await expect(dialog.locator('[data-series="0"]')).toHaveValue('Ventes')
    await expect(dialog.locator('[data-value="0:0"]')).toHaveValue('1200')
    await expect(dialog.locator('[data-series="1"]')).toHaveCount(0)
    await expect(dialog.locator('[data-chart-preview] svg rect')).not.toHaveCount(0)
    // Courbes, un titre, une valeur changée, une étiquette ajoutée
    await dialog.locator('.fp-chart-kind[data-kind="line"]').click()
    await expect(dialog.locator('[data-chart-preview] svg path')).toHaveCount(1)
    await dialog.locator('[data-field="chart-title"]').fill('Ventes du trimestre')
    await dialog.locator('[data-value="2:0"]').fill('abc')
    await expect(dialog.locator('[data-value="2:0"]')).toHaveAttribute('aria-invalid', '')
    await dialog.locator('[data-value="2:0"]').fill('1 010,5')
    await dialog.locator('[data-add-row]').click()
    await dialog.locator('[data-label="3"]').fill('Avril')
    await dialog.locator('[data-value="3:0"]').fill('1500')
    await expect(dialog.locator('[data-chart-preview] svg title')).toHaveText('Ventes du trimestre')
    await dialog.locator('[data-action="ok"]').click()
    await expect(dialog).toHaveCount(0)
    // Le graphique vient juste après le tableau, sélectionné.
    let b = await blocks(page)
    expect(b.map((x: { type: string }) => x.type)).toEqual(['table', 'chart', 'paragraph', 'table'])
    expect(b[1]).toEqual({ type: 'chart', kind: 'line', title: 'Ventes du trimestre', labels: ['Janvier', 'Février', 'Mars', 'Avril'], series: [{ name: 'Ventes', values: [1200, 1450, 1010.5, 1500] }] })
    await expect(chart).toHaveClass(/ProseMirror-selectednode/)
    await expect(chart.locator('svg title')).toHaveText('Ventes du trimestre')
    // Entrée sur le graphique sélectionné : la fenêtre, en modification.
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.fp-chart-kind[data-kind="line"]')).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    // Double-clic : secteurs, sans légende.
    await chart.dblclick()
    await dialog.locator('.fp-chart-kind[data-kind="pie"]').click()
    await dialog.locator('[data-field="chart-legend"]').uncheck()
    await dialog.locator('[data-action="ok"]').click()
    b = await blocks(page)
    expect(b[1]).toMatchObject({ kind: 'pie', legend: false })
    await expect(chart.locator('svg path')).toHaveCount(4)
    await page.keyboard.press(`${mod}+z`)
    expect((await blocks(page))[1]).toMatchObject({ kind: 'line' })
    // Menu contextuel : modifier.
    await chart.click({ button: 'right' })
    await page.locator('[data-context-menu] [data-ctx="edit-chart"]').click()
    await expect(dialog).toBeVisible()
    await dialog.locator('[data-action="cancel"]').click()
    // Le thème change : les couleurs suivent.
    const stroke = () => chart.locator('svg path').first().getAttribute('stroke')
    const before = await stroke()
    await tab(page, 'design')
    await page.locator('[data-theme-name="modern"]').click()
    await expect.poll(stroke).not.toBe(before)
    // Un tableau sans nombres : expliqué, rien n'est inséré.
    await editor(page).locator('td', { hasText: 'c' }).first().click()
    await tab(page, 'insert')
    await rb(page, 'insert-chart')
    await expect(page.locator('.fp-toast')).toContainText(/nombres/)
    await expect(dialog).toHaveCount(0)
    // Hors tableau : des données d'exemple, placées après le paragraphe.
    await editor(page).locator('p', { hasText: 'Après le tableau' }).click()
    await rb(page, 'insert-chart')
    await dialog.locator('[data-action="ok"]').click()
    b = await blocks(page)
    expect(b.map((x: { type: string }) => x.type)).toEqual(['table', 'chart', 'paragraph', 'chart', 'table'])
    expect(b[3]).toMatchObject({ kind: 'bar', labels: ['T1', 'T2', 'T3', 'T4'] })

    // PDF direct : les graphiques sont des images.
    await page.locator('#fp-share').click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-share="pdf"]').click()])
    const file = info.outputPath('graphiques.pdf')
    await download.saveAs(file)
    const imgs = execFileSync('pdfimages', ['-list', file], { encoding: 'utf8' }).trim().split('\n').slice(2)
    expect(imgs.length).toBeGreaterThanOrEqual(2)
    expect(readFileSync(file).subarray(0, 5).toString('latin1')).toBe('%PDF-')
    errors.check()
  })
})

test.describe('fenêtres', () => {
  test('fractionner : second volet modifiable, synchronisé dans les deux sens ; côte à côte ; défilement synchrone ; fermer', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, ['Premier paragraphe.', ...Array.from({ length: 40 }, (_, i) => `Ligne ${i + 1} du document, pour pouvoir faire défiler.`)])
    const main = page.locator('#fp-editor .fp-prose')
    const pane = page.locator('[data-split-pane] .fp-prose')
    await tab(page, 'view')
    await rb(page, 'split-window')
    await expect(pane).toBeVisible()
    await expect(page.locator('.fp-splitbox')).toHaveClass(/is-split/)
    await expect(page.locator('.fp-ribbon [data-cmd="split-window"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(pane.locator('p').first()).toHaveText('Premier paragraphe.')
    // Écrire dans le volet : la page suit.
    await pane.locator('p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Ajout du volet.')
    await expect(main.locator('p').first()).toHaveText('Premier paragraphe. Ajout du volet.')
    // Écrire dans la page : le volet suit.
    await main.locator('p').nth(1).click()
    await page.keyboard.press('Home')
    await page.keyboard.type('Début : ')
    await expect(pane.locator('p').nth(1)).toHaveText(/^Début\s?: Ligne 1/)
    expect((await blocks(page))[0].content[0].text).toBe('Premier paragraphe. Ajout du volet.')
    // Mise en forme depuis le ruban, dans le volet : la page la reçoit.
    await pane.locator('p').nth(2).click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    // L'éditeur lit la sélection du navigateur juste après : on l'attend avant Ctrl+B.
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('Ligne 2 du document, pour pouvoir faire défiler.')
    await page.waitForTimeout(50)
    await page.keyboard.press(`${mod}+b`)
    await expect(main.locator('p').nth(2).locator('strong, b').first()).toBeVisible()
    // Annuler dans le volet défait ce qu'on y a fait, pas ce qui vient de la page.
    await page.keyboard.press(`${mod}+z`)
    await expect(main.locator('p').nth(2).locator('strong, b')).toHaveCount(0)
    await expect(main.locator('p').nth(1)).toHaveText(/^Début\s?: /)

    // Côte à côte, puis défilement synchrone.
    await rb(page, 'side-by-side')
    await expect(page.locator('.fp-splitbox')).toHaveClass(/is-columns/)
    const canvas = page.locator('#fp-canvas')
    const scroller = page.locator('.fp-split-pane__scroll')
    await rb(page, 'sync-scroll')
    await expect(page.locator('.fp-ribbon [data-cmd="sync-scroll"]')).toHaveAttribute('aria-pressed', 'true')
    const before = await scroller.evaluate((el) => el.scrollTop)
    await canvas.evaluate((el) => (el.scrollTop += 300))
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(before + 200)
    // Séparation déplacée au clavier, puis rétablie.
    await page.locator('[data-split-divider]').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.fp-splitbox')).toHaveAttribute('style', /--split-a: 0.55/)
    await rb(page, 'reset-window')
    await expect(page.locator('.fp-splitbox')).toHaveAttribute('style', /--split-a: 0.5;/)
    // Fermer le volet.
    await page.locator('[data-split-close]').click()
    await expect(page.locator('[data-split-pane]')).toHaveCount(0)
    await expect(page.locator('.fp-splitbox')).not.toHaveClass(/is-split/)
    await main.locator('p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    expect((await blocks(page))[0].content[0].text).toBe('Premier paragraphe. Ajout du volet.!')
    errors.check()
  })

  test('nouvelle fenêtre : même document, modifications dans les deux sens, enregistrer depuis elle ; la principale fermée, elle continue seule', async ({ page, context }, info) => {
    const errors = watchErrors(page)
    await open(page, info, ['Texte commun.', 'Deuxième paragraphe.'])
    const main = page.locator('#fp-editor .fp-prose')
    // Une modification pas encore enregistrée : la nouvelle fenêtre la voit.
    await main.locator('p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Avant.')
    await tab(page, 'view')
    const [child] = await Promise.all([context.waitForEvent('page'), rb(page, 'new-window')])
    const other = child.locator('#fp-editor .fp-prose')
    await expect(other.locator('p').first()).toHaveText('Texte commun. Avant.')
    await expect(child.locator('#fp-status')).toHaveAttribute('data-state', 'synced')
    await expect.poll(() => child.title()).toMatch(/\(2\)/)
    await expect.poll(() => page.title()).toMatch(/\(1\)/)
    // De la nouvelle fenêtre vers la principale…
    await other.locator('p').nth(1).click()
    await child.keyboard.press('End')
    await child.keyboard.type(' Écrit dans la fenêtre 2.')
    await expect(main.locator('p').nth(1)).toHaveText('Deuxième paragraphe. Écrit dans la fenêtre 2.')
    // … et de la principale vers elle, en même temps.
    await main.locator('p').first().click()
    await page.keyboard.press('Home')
    await page.keyboard.type('[1] ')
    await child.keyboard.type(' Encore.')
    await expect(other.locator('p').first()).toHaveText('[1] Texte commun. Avant.')
    await expect(main.locator('p').nth(1)).toHaveText('Deuxième paragraphe. Écrit dans la fenêtre 2. Encore.')
    await expect(other.locator('p').nth(1)).toHaveText('Deuxième paragraphe. Écrit dans la fenêtre 2. Encore.')
    // Enregistrer depuis la fenêtre 2 : c'est la principale qui écrit.
    await child.keyboard.press(`${mod}+s`)
    await expect(child.locator('.fp-toast').last()).toContainText(/fenêtre 1/)
    // La principale fermée : la fenêtre 2 continue seule, à enregistrer.
    await page.close()
    await expect(child.locator('.fp-toast').last()).toContainText(/continue seule/, { timeout: 8000 })
    await expect(child.locator('#fp-status')).toHaveAttribute('data-state', 'dirty')
    await child.keyboard.type(' Seule.')
    await expect(other.locator('p').nth(1)).toHaveText(/Seule\.$/)
    errors.check()
  })
})
