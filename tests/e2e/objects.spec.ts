// Phase 2 : tableaux, images, polices intégrées.

import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  blocks,
  caretAfter,
  caretToEnd,
  chooseFile,
  docJson,
  docOfFile,
  editor,
  makeFile,
  makePng,
  mod,
  openEditor,
  pngDataUri,
  rb,
  removeFsAccess,
  saveByDownload,
  selectText,
  tab,
  watchErrors,
  watchNetwork,
} from './helpers'

const doc = (b: unknown[], extra: Record<string, unknown> = {}) => ({ format: 'folio/doc', version: 1, meta: { title: 'Objets' }, blocks: b, ...extra })

async function open(page: Page, info: TestInfo, b: unknown[], extra: Record<string, unknown> = {}) {
  const f = makeFile(info, 'doc.html', doc(b, extra))
  await openEditor(page, f.url)
}

/** Égalité à l'arrondi près (pixels, points, pourcentages). */
const near = (a: number, b: number, tol = 1.5) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

const cellTexts = (t: any) => t.rows.map((r: any[]) => r.map((c: any) => c.blocks.map((b: any) => (b.content ?? []).map((x: any) => x.text ?? '').join('')).join('|')))

test.describe('tableaux', () => {
  test('insérer par la grille, l’onglet Tableau apparaît, Tab passe de cellule en cellule', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, ['avant'])
    await caretToEnd(page)
    await tab(page, 'insert')
    await rb(page, 'insert-table')
    await page.locator('[data-popover="insert-table"] [data-rows="2"][data-cols="3"]').click()
    await expect(page.locator('.fp-ribbon__tab[data-tab="table"]')).toBeVisible()
    await page.keyboard.type('A')
    await page.keyboard.press('Tab')
    await page.keyboard.type('B')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.type('D')
    const t = (await blocks(page))[1]
    expect(t).toMatchObject({ type: 'table', header: true, style: 'grid' })
    expect(cellTexts(t)).toEqual([
      ['A', 'B', ''],
      ['D', '', ''],
    ])
    // hors du tableau, l'onglet disparaît
    await caretAfter(page, 'avant')
    await expect(page.locator('.fp-ribbon__tab[data-tab="table"]')).toBeHidden()
    errors.check()
  })

  test('lignes, colonnes, fusion, en-tête, style, couleur, tri', async ({ page }, info) => {
    await open(page, info, [
      {
        type: 'table',
        rows: [
          ['Nom', 'Âge'],
          ['Zoé', '31'],
          ['Ali', '9'],
          ['Marc', '100'],
        ],
      },
    ])
    await caretAfter(page, 'Zoé')
    await tab(page, 'table')
    await rb(page, 'row-below')
    await rb(page, 'col-right')
    let t = (await blocks(page))[0]
    expect(t.rows).toHaveLength(5)
    expect(t.rows[0]).toHaveLength(3)
    // tri numérique de la colonne du curseur, l'en-tête reste en place
    await caretAfter(page, '31')
    await rb(page, 'table-sort')
    await page.locator('[data-popover="table-sort"] .fp-pop__item').first().click()
    t = (await blocks(page))[0]
    expect(cellTexts(t).map((r: string[]) => r[2])).toEqual(['Âge', '9', '31', '100', ''])
    expect(cellTexts(t).map((r: string[]) => r[0])).toEqual(['Nom', 'Ali', 'Zoé', 'Marc', ''])
    // style zébré, première colonne, couleur de fond
    await rb(page, 'table-style')
    await page.locator('[data-popover="table-style"] [data-table-style="zebra"]').click()
    await rb(page, 'first-column')
    await caretAfter(page, 'Ali')
    await rb(page, 'cell-bg-menu')
    await page.locator('[data-popover="cell-bg-menu"] [data-color="accent3"]').click()
    t = (await blocks(page))[0]
    expect(t).toMatchObject({ style: 'zebra', firstColumn: true })
    expect(t.rows[1][0].bg).toBe('accent3')
    await expect(page.locator('.fp-prose table')).toHaveAttribute('data-table-style', 'zebra')
    // en-tête désactivé
    await rb(page, 'header-row')
    expect((await blocks(page))[0].header).toBe(false)
    // fusion de deux cellules : sélection au clavier
    await caretAfter(page, 'Ali')
    await page.keyboard.press('Shift+ArrowRight') // fin de cellule : sélection de cellules
    await expect(page.locator('.fp-prose .selectedCell')).toHaveCount(2)
    await rb(page, 'merge-cells')
    t = (await blocks(page))[0]
    expect(t.rows[1][0].colspan).toBe(2)
    // un tableau fusionné ne se trie pas : message, pas de dégât
    await rb(page, 'table-sort')
    await page.locator('[data-popover="table-sort"] .fp-pop__item').first().click()
    await expect(page.locator('.fp-toast').last()).toContainText(/fusionnées/)
    await rb(page, 'split-cell')
    expect((await blocks(page))[0].rows[1][0].colspan).toBe(1)
    // supprimer le tableau
    await rb(page, 'table-delete')
    await page.locator('[data-popover="table-delete"] .fp-pop__item').last().click()
    expect((await blocks(page)).some((b: any) => b.type === 'table')).toBe(false)
  })

  test('répartir les colonnes donne des largeurs égales, gardées dans le fichier', async ({ page, context }, info) => {
    await removeFsAccess(context)
    await open(page, info, [{ type: 'table', rows: [['a', 'b', 'c']] }])
    await caretAfter(page, 'a')
    await tab(page, 'table')
    await rb(page, 'distribute')
    const t = (await blocks(page))[0]
    expect(t.widths).toHaveLength(3)
    expect(new Set(t.widths).size).toBe(1)
    const saved = await saveByDownload(page, info, 'widths.html')
    expect(docOfFile(saved.html).blocks[0].widths).toEqual(t.widths)
  })
})

test.describe('images', () => {
  test('insérer une image depuis un fichier, la redimensionner, la disposer, la retrouver après enregistrement', async ({ page, context }, info) => {
    const errors = watchErrors(page)
    const net = watchNetwork(page)
    await removeFsAccess(context)
    await open(page, info, ['avant', 'après'])
    await caretAfter(page, 'avant')
    await tab(page, 'insert')
    await chooseFile(page, () => rb(page, 'insert-image'), { name: 'carre.png', mimeType: 'image/png', buffer: makePng(120, 80) })
    await expect(page.locator('.fp-prose .fp-figure img')).toBeVisible()
    let b = await blocks(page)
    expect(b.map((x: any) => x.type)).toEqual(['paragraph', 'image', 'paragraph'])
    const d = await docJson(page)
    const id = b[1].src.slice(6)
    expect(d.assets[id]).toMatch(/^data:image\/png;base64,/)
    // sélection de l'image : l'onglet Image s'ouvre
    await page.locator('.fp-figure__frame').click()
    await expect(page.locator('.fp-ribbon__tab[data-tab="image"]')).toHaveClass(/is-current/)
    // largeur au clavier
    const width = page.locator('[data-cmd="image-width"]')
    await width.fill('150')
    await width.press('Enter')
    // poignée de redimensionnement : proportions gardées
    const handle = page.locator('.fp-figure__handle--se')
    await page.locator('.fp-figure__frame').click()
    const box = (await handle.boundingBox())!
    await page.mouse.move(box.x + 5, box.y + 5)
    await page.mouse.down()
    await page.mouse.move(box.x + 45, box.y + 30, { steps: 4 })
    await page.mouse.up()
    b = await blocks(page)
    expect(b[1].width).toBeGreaterThan(150)
    expect(b[1].height).toBeUndefined()
    // habillage, rotation, retournement, texte de remplacement
    await page.locator('.fp-figure__frame').click()
    await rb(page, 'image-wrap')
    await page.locator('[data-popover] [data-wrap="right"]').click()
    await rb(page, 'image-rotate')
    await page.locator('[data-popover] [data-rotate="right"]').click()
    await rb(page, 'image-rotate')
    await page.locator('[data-popover] [data-rotate="flip-h"]').click()
    await rb(page, 'image-alt')
    await page.locator('[data-dialog="alt-text"] [data-field="alt"]').fill('Un carré rouge')
    await page.locator('[data-dialog="alt-text"] [data-action="ok"]').click()
    b = await blocks(page)
    expect(b[1]).toMatchObject({ type: 'image', wrap: 'right', align: 'right', rotate: 90, flip: 'h', alt: 'Un carré rouge' })
    await expect(page.locator('.fp-figure')).toHaveAttribute('data-wrap', 'right')
    // légende
    await rb(page, 'image-caption')
    await page.keyboard.type('Figure 1. Un carré')
    expect((await blocks(page))[1].caption).toEqual([{ text: 'Figure 1. Un carré' }])
    // enregistrement, réouverture
    const saved = await saveByDownload(page, info, 'image.html')
    const back = docOfFile(saved.html)
    expect(back.blocks[1]).toMatchObject({ type: 'image', wrap: 'right', rotate: 90, alt: 'Un carré rouge' })
    expect(Object.values(back.assets)).toHaveLength(1)
    await page.goto(saved.url)
    await page.waitForFunction(() => !!(window as any).folio?.doc)
    await expect(page.locator('.fp-prose .fp-figure img')).toBeVisible()
    expect(await page.locator('.fp-prose .fp-figure img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(120)
    net.check()
    errors.check()
  })

  test('rogner par la fenêtre « Taille et rognage », puis annuler le rognage', async ({ page }, info) => {
    await open(page, info, [{ type: 'image', src: pngDataUri(100, 100) }])
    await page.locator('.fp-figure__frame').click()
    const dialog = async () => {
      await rb(page, 'image-crop-menu')
      await page.locator('[data-crop-menu="dialog"]').click()
    }
    await dialog()
    const dlg = page.locator('[data-dialog="crop"]')
    await dlg.locator('[data-crop="left"]').fill('20')
    await dlg.locator('[data-crop="top"]').fill('10')
    await dlg.locator('[data-action="ok"]').click()
    expect((await blocks(page))[0].crop).toEqual({ top: 10, right: 0, bottom: 0, left: 20 })
    // le cadre prend les proportions de l'image rognée (80 × 90)
    const ratio = await page.locator('.fp-figure__frame').evaluate((el) => el.getBoundingClientRect().width / el.getBoundingClientRect().height)
    expect(ratio).toBeCloseTo(80 / 90, 1)
    await page.locator('.fp-figure__frame').click()
    await dialog()
    await dlg.locator('[data-action="reset"]').click()
    expect((await blocks(page))[0].crop).toBeUndefined()
  })

  test('rogner à la souris : poignées noires, l’image garde son échelle, Entrée termine, Ctrl+Z annule', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, [{ type: 'image', src: pngDataUri(100, 100), width: 200 }, 'après'])
    const frame = page.locator('.fp-figure__frame')
    await frame.click()
    await rb(page, 'image-crop')
    await expect(page.locator('.fp-figure.is-cropping')).toBeVisible()
    await expect(page.locator('.fp-cropper__handle')).toHaveCount(8)
    const box = (await page.locator('.fp-cropper').boundingBox())!
    const drag = async (sel: string, dx: number, dy: number) => {
      const b = (await page.locator(sel).boundingBox())!
      const x = b.x + b.width / 2
      const y = b.y + b.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 3 })
      await page.mouse.move(x + dx, y + dy, { steps: 3 })
      await page.mouse.up()
    }
    // côté gauche : 20 % ; coin bas-droit : 10 % à droite et 30 % en bas
    await drag('.fp-cropper__handle--w', box.width * 0.2, 0)
    let img = (await blocks(page))[0]
    near(img.crop.left, 20)
    near(img.width, 160)
    // l'image garde son échelle : l'image entière a toujours la même taille à l'écran
    const box2 = (await page.locator('.fp-cropper').boundingBox())!
    near(box2.width, box.width)
    near(box2.height, box.height)
    await drag('.fp-cropper__handle--se', -box.width * 0.1, -box.height * 0.3)
    img = (await blocks(page))[0]
    near(img.crop.right, 10)
    near(img.crop.bottom, 30)
    near(img.width, 140)
    // tirer l'intérieur déplace l'image sous le cadre (la taille gardée ne change pas)
    const win = (await page.locator('.fp-cropper__window').boundingBox())!
    await page.mouse.move(win.x + win.width / 2, win.y + win.height / 2)
    await page.mouse.down()
    await page.mouse.move(win.x + win.width / 2 - box.width * 0.5, win.y + win.height / 2 + box.height * 0.5, { steps: 5 })
    await page.mouse.up()
    img = (await blocks(page))[0]
    near(img.crop.left, 0)
    near(img.crop.right, 30)
    near(img.crop.top, 30)
    near(img.crop.bottom, 0)
    near(img.width, 140)
    // Entrée termine le rognage
    await page.keyboard.press('Enter')
    await expect(page.locator('.fp-cropper')).toHaveCount(0)
    await expect(page.locator('.fp-figure.is-cropping')).toHaveCount(0)
    expect(await blocks(page)).toHaveLength(2)
    // le cadre a les proportions de la partie gardée (70 × 70)
    const fb = (await frame.boundingBox())!
    expect(fb.width / fb.height).toBeCloseTo(1, 1)
    // chaque geste s'annule : déplacement, coin, côté
    await page.keyboard.press(`${mod}+z`)
    near((await blocks(page))[0].crop.left, 20)
    near((await blocks(page))[0].crop.bottom, 30)
    await page.keyboard.press(`${mod}+z`)
    await page.keyboard.press(`${mod}+z`)
    img = (await blocks(page))[0]
    expect(img.crop).toBeUndefined()
    expect(img.width).toBe(200)
    errors.check()
  })

  test('rogner : Échap et un clic ailleurs terminent ; une image tournée passe par la fenêtre', async ({ page }, info) => {
    await open(page, info, [{ type: 'image', src: pngDataUri(100, 100), width: 150 }, 'texte après', { type: 'image', src: pngDataUri(80, 40), rotate: 90 }])
    const fig = page.locator('.fp-figure').first()
    await fig.locator('.fp-figure__frame').click()
    await rb(page, 'image-crop')
    await expect(fig).toHaveClass(/is-cropping/)
    await page.keyboard.press('Escape')
    await expect(fig).not.toHaveClass(/is-cropping/)
    // Échap n'a rien changé, le document non plus
    expect((await blocks(page))[0].crop).toBeUndefined()
    await fig.locator('.fp-figure__frame').click()
    await rb(page, 'image-crop')
    await expect(fig).toHaveClass(/is-cropping/)
    await page.locator('.fp-prose p').filter({ hasText: 'texte après' }).click()
    await expect(fig).not.toHaveClass(/is-cropping/)
    await expect(page.locator('.fp-cropper')).toHaveCount(0)
    // image tournée : la fenêtre « Taille et rognage »
    await page.locator('.fp-figure').nth(1).locator('.fp-figure__frame').click()
    await rb(page, 'image-crop')
    await expect(page.locator('[data-dialog="crop"]')).toBeVisible()
    await expect(page.locator('.fp-cropper')).toHaveCount(0)
  })

  test('clic droit sur une image : la barre Style et Rogner, sous le menu', async ({ page }, info) => {
    await open(page, info, [{ type: 'image', src: pngDataUri(100, 100) }, 'texte'])
    const frame = page.locator('.fp-figure__frame')
    await frame.click({ button: 'right' })
    const mini = page.locator('.fp-ctx-mini--image')
    await expect(mini).toBeVisible()
    await expect(mini.locator('[data-cmd="mini-image-style"]')).toContainText('Style')
    await expect(mini.locator('[data-cmd="mini-image-crop"]')).toContainText('Rogner')
    // la barre est sous le menu, comme d'habitude
    const menuBox = (await page.locator('.fp-ctx').boundingBox())!
    const miniBox = (await mini.boundingBox())!
    expect(miniBox.y).toBeGreaterThan(menuBox.y + menuBox.height - 1)
    // Style : la bordure de l'image
    await mini.locator('[data-cmd="mini-image-style"]').click()
    await page.locator('[data-popover] [data-color]:not([data-color=""])').first().click()
    expect((await blocks(page))[0].border).toBeTruthy()
    // Rogner : le menu se ferme, les poignées apparaissent
    await frame.click({ button: 'right' })
    await page.locator('.fp-ctx-mini--image [data-cmd="mini-image-crop"]').click()
    await expect(page.locator('.fp-ctx')).toHaveCount(0)
    await expect(page.locator('.fp-cropper__handle')).toHaveCount(8)
    await page.keyboard.press('Escape')
    // sur du texte, la barre de mise en forme habituelle
    await page.locator('.fp-prose p').filter({ hasText: 'texte' }).click({ button: 'right' })
    await expect(page.locator('.fp-ctx-mini [data-cmd="bold"]')).toBeVisible()
    await expect(page.locator('.fp-ctx-mini--image')).toHaveCount(0)
  })

  test('une image en ligne ne se charge qu’à la demande ; une image manquante est signalée', async ({ page }, info) => {
    const net = watchNetwork(page)
    await open(page, info, [
      { type: 'image', src: 'https://example.invalid/photo.jpg', alt: 'photo' },
      { type: 'image', src: 'asset:absente', alt: 'plan' },
    ])
    await expect(page.locator('.fp-figure[data-kind="external"] .fp-figure__placeholder')).toContainText('example.invalid')
    await expect(page.locator('.fp-figure[data-kind="missing"] .fp-figure__placeholder')).toContainText('absente')
    net.check()
    // le document garde les deux images telles quelles
    const b = await blocks(page)
    expect(b.map((x: any) => x.src)).toEqual(['https://example.invalid/photo.jpg', 'asset:absente'])
  })

  test('coller une image (Chrome) ; les grandes photos sont réduites, les captures restent intactes', async ({ page, browserName }, info) => {
    test.skip(browserName === 'firefox', 'Firefox ne permet pas de fabriquer un événement de collage avec des fichiers ; le choix de fichier est testé plus haut.')
    await open(page, info, [''])
    await editor(page).click()
    await page.evaluate(async () => {
      const make = async (w: number, h: number, type: string) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')!
        // une « photo » : du bruit, que le JPEG compresse
        const img = ctx.createImageData(w, h)
        for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 2654435761) % 255
        ctx.putImageData(img, 0, 0)
        return new Promise<Blob>((r) => c.toBlob((b) => r(b!), type, 0.95))
      }
      const paste = (file: File) => {
        const dt = new DataTransfer()
        dt.items.add(file)
        document.querySelector('.fp-prose')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      }
      paste(new File([await make(3200, 1800, 'image/jpeg')], 'photo.jpg', { type: 'image/jpeg' }))
      await new Promise((r) => setTimeout(r, 1500))
      paste(new File([await make(3000, 400, 'image/png')], 'capture.png', { type: 'image/png' }))
    })
    await expect(page.locator('.fp-prose .fp-figure')).toHaveCount(2, { timeout: 15000 })
    const sizes = await page.locator('.fp-prose .fp-figure img').evaluateAll((imgs: HTMLImageElement[]) => imgs.map((i) => [i.naturalWidth, i.naturalHeight, i.src.slice(0, 22)]))
    expect(sizes).toEqual([
      [2560, 1440, 'data:image/jpeg;base64'],
      [3000, 400, 'data:image/png;base64,'],
    ])
  })

  test('compresser les images du document affiche le gain', async ({ page }, info) => {
    await open(page, info, [{ type: 'image', src: pngDataUri(40, 40) }])
    await page.locator('.fp-figure__frame').click()
    await rb(page, 'compress-images')
    await expect(page.locator('.fp-toast').last()).toContainText(/légères|compressées/)
  })
})

test.describe('polices intégrées', () => {
  test('ajouter une police au document, l’utiliser, la retrouver après enregistrement', async ({ page, context }, info) => {
    await removeFsAccess(context)
    await open(page, info, ['texte en police maison'])
    await tab(page, 'design')
    await rb(page, 'embedded-fonts')
    const dlg = page.locator('[data-dialog="fonts"]')
    const fontFile = (await import('node:fs')).readFileSync(new URL('../../src/fonts/jetbrains-mono-latin-wght-normal.woff2', import.meta.url))
    await dlg.locator('[data-field="font-file"]').setInputFiles({ name: 'Ma-Police-Regular.woff2', mimeType: 'font/woff2', buffer: fontFile })
    await expect(dlg.locator('[data-field="font-name"]')).toHaveValue('Ma Police')
    await dlg.locator('[data-action="add"]').click()
    await expect(dlg.locator('.fp-list__row')).toContainText('Ma Police')
    await dlg.locator('[data-action="close"]').click()
    // la police apparaît dans la liste du ruban
    await selectText(page, 'police maison')
    await tab(page, 'home')
    const family = page.locator('[data-cmd="font-family"]')
    await family.click()
    await family.fill('Ma Police')
    await family.press('Enter')
    expect((await blocks(page))[0].content[1]).toEqual({ text: 'police maison', font: 'Ma Police' })
    expect(await page.evaluate(() => document.fonts.check('12px "Ma Police"'))).toBe(true)
    const saved = await saveByDownload(page, info, 'police.html')
    const d = docOfFile(saved.html)
    expect(d.fonts).toEqual([{ family: 'Ma Police', src: expect.stringMatching(/^asset:font-/), weight: 400, italic: false }])
    expect(d.assets[d.fonts[0].src.slice(6)]).toMatch(/^data:font\/woff2;base64,/)
    // un fichier qui n'est pas une police est refusé
    await tab(page, 'design')
    await rb(page, 'embedded-fonts')
    await dlg.locator('[data-field="font-file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') })
    await dlg.locator('[data-action="add"]').click()
    await expect(dlg.locator('.fp-field-error')).not.toBeEmpty()
    await page.keyboard.press('Escape')
    void mod
  })
})
