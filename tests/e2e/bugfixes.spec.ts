// Corrections signalées (TODO.txt, « Bug fixes ») : curseur, en-têtes, menus, textes.

import { expect, test, type Page } from '@playwright/test'
import { blocks, chooseFile, circlePng, editor, makeFile, makePng, openEditor, rb, selectText, tab } from './helpers'

const settingsInit = (page: Page) => page.addInitScript(() => localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false })))
const doc = (...b: unknown[]) => ({ format: 'folio/doc', version: 1, blocks: b })
const focused = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.classList.contains('fp-prose') ?? false)
const headerOpen = (page: Page) => page.locator('.fp-hf-zone.is-editing')

async function openHeader(page: Page) {
  await page.locator('.fp-hf-zone--header').first().dblclick()
  await expect(headerOpen(page)).toHaveCount(1)
  await page.keyboard.type('Entête')
}

/** Un point de la première feuille, sous le texte, dans la fenêtre. */
async function belowText(page: Page) {
  const sheet = (await page.locator('.fp-sheet').first().boundingBox())!
  return { x: sheet.x + sheet.width / 2, y: sheet.y + 400 }
}

test.describe('curseur et en-têtes', () => {
  test('le curseur est dans le texte dès l’ouverture', async ({ page }, info) => {
    await openEditor(page, makeFile(info, 'vide.html', doc('')).url)
    await expect.poll(() => focused(page)).toBe(true)
    await page.keyboard.type('abc')
    expect(await blocks(page)).toEqual([{ type: 'paragraph', content: [{ text: 'abc' }] }])
  })

  test('un clic sur la page hors du texte (sous le texte, dans la marge) y met le curseur', async ({ page }, info) => {
    await settingsInit(page)
    await openEditor(page, makeFile(info, 'marge.html', doc('Première ligne.', 'Deuxième ligne.')).url)
    // Le focus part ailleurs (barre d'état), puis clic sous le texte : curseur en fin de document.
    await page.locator('#fp-save-mode').focus()
    const p = await belowText(page)
    await page.mouse.click(p.x, p.y)
    expect(await focused(page)).toBe(true)
    await page.keyboard.type('X')
    expect((await blocks(page))[1].content[0].text).toBe('Deuxième ligne.X')
    // Dans la marge de gauche, à hauteur de la première ligne : son début.
    const first = (await editor(page).locator('p').first().boundingBox())!
    const sheet = (await page.locator('.fp-sheet').first().boundingBox())!
    await page.mouse.click(sheet.x + 20, first.y + first.height / 2)
    await page.keyboard.type('Y')
    expect((await blocks(page))[0].content[0].text).toBe('YPremière ligne.')
  })

  for (const how of ['bouton Fermer', 'clic dans le texte', 'clic sous le texte', 'double-clic sous le texte', 'clic dans la marge grise']) {
    test(`quitter un en-tête (${how}) rend le curseur au texte`, async ({ page }, info) => {
      await settingsInit(page)
      await openEditor(page, makeFile(info, 'entete.html', doc('Un texte court.')).url)
      await openHeader(page)
      if (how === 'bouton Fermer') await page.locator('[data-cmd="hf-close"]').click()
      else if (how === 'clic dans le texte') await editor(page).locator('p').first().click({ position: { x: 400, y: 5 } })
      else if (how === 'clic dans la marge grise') {
        const canvas = (await page.locator('#fp-canvas').boundingBox())!
        await page.mouse.click(canvas.x + 8, canvas.y + 300)
      } else {
        const p = await belowText(page)
        if (how === 'clic sous le texte') await page.mouse.click(p.x, p.y)
        else await page.mouse.dblclick(p.x, p.y)
      }
      await expect(headerOpen(page)).toHaveCount(0)
      expect(await focused(page)).toBe(true)
      await page.keyboard.press('End')
      await page.keyboard.type('ZZ')
      expect((await blocks(page))[0].content[0].text).toBe('Un texte court.ZZ')
      // L'en-tête a gardé ce qu'on y a écrit.
      await expect(page.locator('.fp-hf-zone--header').first()).toContainText('Entête')
    })
  }
})

const pop = (page: Page) => page.locator('[data-popover]')
const LOREM = 'Le café du matin refroidit sur la table près de la fenêtre pendant que le renard brun saute par-dessus le chien. '.repeat(8)

test.describe('menus et textes', () => {
  test('le code (bloc ou en ligne) n’a pas la correction orthographique du navigateur', async ({ page }, info) => {
    await openEditor(page, makeFile(info, 'code.html', doc({ type: 'code', language: 'js', text: 'cnost x = 1' }, { md: 'Un `vraiable` en ligne.' })).url)
    await expect(editor(page).locator('pre')).toHaveAttribute('spellcheck', 'false')
    await expect(editor(page).locator('p code')).toHaveAttribute('spellcheck', 'false')
    // Le reste du texte garde la correction.
    await expect(editor(page)).toHaveAttribute('spellcheck', 'true')
  })

  test('menu du clic droit : « ? » explique dans une info-bulle comment avoir le menu du navigateur', async ({ page }, info) => {
    await openEditor(page, makeFile(info, 'menu.html', doc('Du texte.')).url)
    await editor(page).locator('p').first().click({ button: 'right' })
    const menu = page.locator('[data-context-menu]')
    await expect(menu).toBeVisible()
    // Plus de bulle sur tout le menu : seulement sur « ? ».
    await expect(menu).not.toHaveAttribute('title', /.+/)
    const help = menu.locator('[data-ctx-help]')
    const tip = page.locator('#fp-tooltip')
    // Au survol.
    await help.hover()
    await expect(tip).toHaveClass(/is-open/)
    await expect(tip).toContainText('Maj + clic droit')
    // Le menu reste ouvert, et un clic montre ou cache la bulle tout de suite.
    await help.click()
    await expect(tip).not.toHaveClass(/is-open/)
    await expect(menu).toBeVisible()
    await help.click()
    await expect(tip).toHaveClass(/is-open/)
    await page.keyboard.press('Escape')
    await expect(tip).not.toHaveClass(/is-open/)
  })

  test('info-bulles mises en forme sur les boutons ; le title revient après le survol ; au-dessus d’une fenêtre', async ({ page }, info) => {
    await settingsInit(page)
    await openEditor(page, makeFile(info, 'bulles.html', doc('x')).url)
    const btn = page.locator('#fp-zoom-in')
    const title = (await btn.getAttribute('title')) ?? (await btn.getAttribute('aria-label'))
    const tip = page.locator('#fp-tooltip')
    await page.locator('.fp-ribbon [data-cmd="bold"]').hover()
    await expect(tip).toHaveClass(/is-open/)
    const boldTip = (await tip.textContent())!
    expect(boldTip.length).toBeGreaterThan(0)
    // Pendant le survol : pas de title (sinon le navigateur montrerait sa bulle aussi), un nom accessible gardé.
    await expect(page.locator('.fp-ribbon [data-cmd="bold"]')).not.toHaveAttribute('title', /.+/)
    await expect(page.locator('.fp-ribbon [data-cmd="bold"]')).toHaveAccessibleName(/.+/)
    // La bulle est dans la fenêtre, sous ou au-dessus du bouton, pas dessus.
    const b = (await page.locator('.fp-ribbon [data-cmd="bold"]').boundingBox())!
    const t = (await tip.boundingBox())!
    expect(t.y >= b.y + b.height || t.y + t.height <= b.y).toBe(true)
    expect(t.x).toBeGreaterThanOrEqual(0)
    // Le pointeur s'en va : la bulle se ferme, le title revient.
    await page.mouse.move(5, 600)
    await expect(tip).not.toHaveClass(/is-open/)
    await expect(page.locator('.fp-ribbon [data-cmd="bold"]')).toHaveAttribute('title', boldTip)
    // Au clavier aussi (focus visible), sans toucher au title.
    await btn.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(tip).toHaveClass(/is-open/)
    if (title) await expect(tip).toHaveText(title)
    // Dans une fenêtre ouverte : la bulle passe devant elle.
    await page.keyboard.press('F1')
    const dlg = page.locator('dialog[open]')
    await expect(dlg).toBeVisible()
    const close = dlg.locator('[title], .fp-iconbtn[aria-label]').first()
    await close.evaluate((el) => el.setAttribute('title', el.getAttribute('title') || 'Fermer'))
    await close.hover()
    await expect(tip).toHaveClass(/is-open/)
    const tb = (await tip.boundingBox())!
    const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id ?? '', [tb.x + tb.width / 2, tb.y + tb.height / 2])
    // (la bulle ne capte pas le pointeur : on vérifie qu'elle est dans la couche du dessus)
    expect(await tip.evaluate((el) => (el.matches(':popover-open') ? 'top' : getComputedStyle(el).zIndex))).toBeTruthy()
    expect(top).not.toBe('fp-tooltip')
  })

  test('caractères spéciaux → plus de caractères : un clic insère le caractère et ferme la fenêtre', async ({ page }, info) => {
    await settingsInit(page)
    await openEditor(page, makeFile(info, 'symb.html', doc('abc')).url)
    await page.keyboard.press('End')
    await tab(page, 'insert')
    await rb(page, 'insert-symbol')
    await pop(page).getByText('Plus de caractères…').click()
    const dlg = page.locator('[data-dialog="symbols"]')
    await expect(dlg).toBeVisible()
    const first = dlg.locator('[data-symbol]').first()
    const ch = (await first.getAttribute('data-symbol'))!
    await first.click()
    await expect(dlg).toHaveCount(0)
    expect((await blocks(page))[0].content[0].text).toBe('abc' + ch)
    // On reprend l'écriture tout de suite.
    await page.keyboard.type('d')
    expect((await blocks(page))[0].content[0].text).toBe('abc' + ch + 'd')
  })

  test('textes retirés ou raccourcis : graphique, capture d’écran', async ({ page }, info) => {
    await settingsInit(page)
    await openEditor(page, makeFile(info, 'textes.html', doc('x')).url)
    await tab(page, 'insert')
    await rb(page, 'insert-screenshot')
    await expect(pop(page).locator('[data-shot="window"]')).toBeVisible()
    await expect(pop(page)).not.toContainText('Le navigateur demande')
    await page.keyboard.press('Escape')
    await rb(page, 'insert-chart')
    const chart = page.locator('[data-dialog="chart"]')
    await expect(chart).toBeVisible()
    await expect(chart).not.toContainText('Une ligne par étiquette')
  })
})

test.describe('habillage des images', () => {
  /** Lignes du paragraphe qui suit l'image, à hauteur de l'image : leur bord le plus proche de l'image. */
  const nearest = (page: Page) =>
    page.evaluate(() => {
      const fig = document.querySelector('.fp-prose .fp-figure') as HTMLElement
      const f = fig.querySelector('.fp-figure__frame')!.getBoundingClientRect()
      const p = fig.nextElementSibling as HTMLElement
      const range = document.createRange()
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      let left = Infinity
      let n: Node | null
      while ((n = walker.nextNode())) {
        range.selectNodeContents(n)
        for (const r of Array.from(range.getClientRects())) if (r.top > f.top && r.bottom < f.bottom) left = Math.min(left, r.left)
      }
      return { gap: left - f.right, frameWidth: f.width }
    })

  async function withCircle(page: Page, info: import('@playwright/test').TestInfo, wrap: string) {
    await settingsInit(page)
    const src = 'data:image/png;base64,' + circlePng(160).toString('base64')
    await openEditor(page, makeFile(info, `cercle-${wrap}.html`, { format: 'folio/doc', version: 1, assets: { c: src }, blocks: [{ type: 'image', src: 'asset:c', alt: 'Disque', width: 150, align: 'left', wrap }, LOREM, 'Fin.'] }).url)
    await expect(editor(page).locator('.fp-figure img')).toHaveJSProperty('complete', true)
  }

  test('rapproché : le texte suit le contour d’un disque, plus près qu’en carré', async ({ page }, info) => {
    await withCircle(page, info, 'left')
    const square = await nearest(page)
    expect(square.gap).toBeGreaterThan(0)
    // Le menu Habillage : rapproché.
    await editor(page).locator('.fp-figure__frame').click()
    await tab(page, 'image')
    await rb(page, 'image-wrap')
    for (const w of ['left', 'right', 'tight', 'through', 'none', 'behind', 'front']) await expect(pop(page).locator(`[data-wrap="${w}"]`)).toBeVisible()
    await expect(pop(page).locator('[data-soon]')).toHaveCount(2)
    await expect(pop(page).locator('[data-wrap="left"]')).toHaveAttribute('aria-checked', 'true')
    await pop(page).locator('[data-wrap="tight"]').click()
    const fig = editor(page).locator('.fp-figure')
    await expect(fig).toHaveAttribute('data-wrap', 'tight')
    await expect(fig).toHaveAttribute('data-side', 'left')
    await expect.poll(() => fig.evaluate((el) => getComputedStyle(el).shapeOutside)).toContain('polygon')
    // Au moins une ligne entre dans le carré de l'image (le haut ou le bas du disque).
    await expect.poll(async () => (await nearest(page)).gap).toBeLessThan(-10)
    expect((await blocks(page))[0]).toMatchObject({ wrap: 'tight', align: 'left' })
  })

  test('derrière et devant le texte : l’image ne prend pas de place ; le texte passe dessus ou dessous', async ({ page }, info) => {
    await withCircle(page, info, 'behind')
    const state = () =>
      page.evaluate(() => {
        const fig = document.querySelector('.fp-prose .fp-figure') as HTMLElement
        const frame = fig.querySelector('.fp-figure__frame')!.getBoundingClientRect()
        const next = (fig.nextElementSibling as HTMLElement).getBoundingClientRect()
        // Ce qui est dessiné au milieu de l'image, sur une ligne de texte.
        const range = document.createRange()
        const t = (fig.nextElementSibling as HTMLElement).firstChild!
        range.setStart(t, 0)
        range.setEnd(t, 1)
        const line = range.getBoundingClientRect()
        const hit = document.elementFromPoint(frame.left + frame.width / 2, line.top + line.height / 2)
        return { height: fig.getBoundingClientRect().height, textTop: next.top - frame.top, onTop: hit?.closest('.fp-figure') ? 'image' : 'text', frameHeight: frame.height }
      })
    let s = await state()
    expect(s.height).toBe(0)
    expect(s.frameHeight).toBeGreaterThan(150)
    expect(Math.abs(s.textTop)).toBeLessThan(20)
    expect(s.onTop).toBe('text')
    await page.evaluate(() => (window as any).folio.loadDoc({ ...(window as any).folio.doc, blocks: (window as any).folio.doc.blocks.map((b: any, i: number) => (i === 0 ? { ...b, wrap: 'front' } : b)) }))
    await expect(editor(page).locator('.fp-figure')).toHaveAttribute('data-wrap', 'front')
    s = await state()
    expect(s.height).toBe(0)
    expect(s.onTop).toBe('image')
  })

  test('« définir comme disposition par défaut » : les images insérées ensuite la reprennent', async ({ page }, info) => {
    await withCircle(page, info, 'right')
    await editor(page).locator('.fp-figure__frame').click()
    await tab(page, 'image')
    await rb(page, 'image-wrap')
    await pop(page).locator('[data-wrap-option="default"]').click()
    await expect(page.locator('.fp-toast')).toContainText('prochaines images')
    await selectText(page, 'Fin.', 0, true)
    await tab(page, 'insert')
    await chooseFile(page, () => rb(page, 'insert-image'), { name: 'carre.png', mimeType: 'image/png', buffer: makePng(60, 40) })
    await expect(editor(page).locator('.fp-figure')).toHaveCount(2)
    const imgs = (await blocks(page)).filter((b: { type: string }) => b.type === 'image')
    expect(imgs[1]).toMatchObject({ wrap: 'right', align: 'right' })
  })
})
