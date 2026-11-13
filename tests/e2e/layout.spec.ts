// Phase 3 : vue page, coupure en pages, en-têtes et pieds de page, mise en
// page, impression.

import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { blocks, caretAfter, caretToEnd, docJson, editor, makeFile, mod, openEditor, rb, selectText, tab, watchErrors } from './helpers'

const sentence = (i: number) => `Phrase ${i} d’un paragraphe assez long pour occuper plusieurs lignes de la page imprimée.`
const para = (k: number, n: number) => ({ text: `[${k}] ` + Array.from({ length: n }, (_, i) => sentence(i + 1)).join(' ') })

function longDoc(extra: Record<string, unknown> = {}, sections = 6) {
  const b: unknown[] = []
  for (let s = 1; s <= sections; s++) {
    b.push({ type: 'heading', text: `Section ${s}` })
    for (let p = 0; p < 5; p++) b.push(para(s * 10 + p, 3 + ((s * p) % 5)))
    b.push({ type: 'list', items: ['un', 'deux', { text: 'trois', level: 1 }, 'quatre'] })
  }
  b.splice(8, 0, { type: 'table', rows: Array.from({ length: 36 }, (_, i) => [`Ligne ${i + 1}`, `${i * 3}`]) })
  return { format: 'folio/doc', version: 1, meta: { title: 'Long' }, blocks: b, ...extra }
}

async function open(page: Page, info: TestInfo, doc: unknown) {
  const f = makeFile(info, 'doc.html', doc)
  await openEditor(page, f.url)
  await page.waitForFunction(() => document.querySelectorAll('.fp-sheet').length > 0)
  await settle(page)
}

/** Attend que la coupure en pages soit stable (deux mesures identiques). */
async function settle(page: Page) {
  let prev = ''
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150)
    const now = await page.evaluate(() => [...document.querySelectorAll('.fp-spacer')].map((s) => getComputedStyle(s).height).join(',') + '|' + document.querySelectorAll('.fp-sheet').length)
    if (now === prev) return
    prev = now
  }
}

/** Aucune ligne de texte ne déborde de la zone de texte de sa feuille. */
async function linesInsideSheets(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector('.fp-page') as HTMLElement
    const scale = paper.getBoundingClientRect().width / paper.offsetWidth
    const top0 = paper.getBoundingClientRect().top
    const css = getComputedStyle(document.documentElement)
    const px = (v: string) => parseFloat(css.getPropertyValue(v))
    const H = px('--pg-h')
    const mt = px('--pg-top')
    const mb = px('--pg-bottom')
    const gap = px('--fp-gap')
    const bad: string[] = []
    const walker = document.createTreeWalker(document.querySelector('.fp-prose')!, NodeFilter.SHOW_TEXT)
    const r = document.createRange()
    let n: Node | null
    while ((n = walker.nextNode())) {
      r.selectNodeContents(n)
      for (const rect of Array.from(r.getClientRects())) {
        if (!rect.height) continue
        const y0 = (rect.top - top0) / scale
        const y1 = (rect.bottom - top0) / scale
        const k = Math.floor(y0 / (H + gap))
        const sheetTop = k * (H + gap)
        if (y0 < sheetTop + mt - 4 || y1 > sheetTop + H - mb + 4) bad.push(`${(n.nodeValue ?? '').slice(0, 30)} @${Math.round(y0)}`)
      }
    }
    return bad
  })
}

test.describe('vue page', () => {
  test('le texte se répartit en feuilles, sans ligne qui déborde ; les pages suivent les modifications', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, longDoc())
    const sheets = await page.locator('.fp-sheet').count()
    expect(sheets).toBeGreaterThanOrEqual(5)
    expect(await linesInsideSheets(page)).toEqual([])
    await expect(page.locator('#fp-pages')).toHaveText(new RegExp(`sur ${sheets}$`))
    // une page de plus quand on ajoute beaucoup de texte
    await caretToEnd(page)
    for (let i = 0; i < 25; i++) await page.keyboard.press('Enter')
    await page.keyboard.type('fin')
    await settle(page)
    expect(await page.locator('.fp-sheet').count()).toBeGreaterThan(sheets)
    expect(await linesInsideSheets(page)).toEqual([])
    // et une de moins quand on annule
    await page.keyboard.press(`${mod}+z`)
    await page.keyboard.press(`${mod}+z`)
    await settle(page)
    expect(await page.locator('.fp-sheet').count()).toBe(sheets)
    errors.check()
  })

  test('saut de page, titre solidaire, paragraphe « saut de page avant »', async ({ page }, info) => {
    await open(page, info, {
      format: 'folio/doc',
      version: 1,
      blocks: ['avant', { type: 'pagebreak' }, 'après le saut', { text: 'nouvelle page', pageBreakBefore: true }],
    })
    expect(await page.locator('.fp-sheet').count()).toBe(3)
    // « après le saut » est en haut de la deuxième feuille
    const tops = await page.evaluate(() => {
      const paper = document.querySelector('.fp-page')!.getBoundingClientRect().top
      return [...document.querySelectorAll('.fp-prose p')].map((p) => Math.round(p.getBoundingClientRect().top - paper))
    })
    const css = await page.evaluate(() => ['--pg-h', '--pg-top', '--fp-gap'].map((v) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v))))
    const [H, mt, gap] = css
    expect(Math.abs(tops[1] - (H + gap + mt))).toBeLessThan(3)
    expect(Math.abs(tops[2] - (2 * (H + gap) + mt))).toBeLessThan(3)
  })

  test('en-têtes et pieds de page : numéros, première page différente, pages paires', async ({ page }, info) => {
    await open(
      page,
      info,
      longDoc({
        page: { firstPage: true, evenOdd: true, numberStart: 3, numberFormat: 'roman' },
        headers: { default: [{ md: 'Impaire' }], first: [{ md: 'Couverture' }], even: [{ md: 'Paire' }] },
        footers: { default: [{ md: 'Page {{page}} / {{pages}}', align: 'center' }] },
      }),
    )
    const n = await page.locator('.fp-sheet').count()
    const headers = await page.locator('.fp-hf-zone--header').allInnerTexts()
    expect(headers[0].trim()).toBe('Couverture')
    // page 2 = numéro 4 (pair), page 3 = numéro 5 (impair)
    expect(headers[1].trim()).toBe('Paire')
    expect(headers[2].trim()).toBe('Impaire')
    const footers = await page.locator('.fp-hf-zone--footer').allInnerTexts()
    // Pages paires différentes : une page paire prend le pied de page pair (vide ici), comme dans tout traitement de texte.
    expect(footers[1].trim()).toBe('')
    expect(footers[2].trim()).toBe(`Page v / ${n}`)
  })

  test('modifier un en-tête : double-clic, saisie, Échap ; annulable', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, longDoc({}, 2))
    await page.locator('.fp-hf-zone--header').nth(1).dblclick()
    await expect(page.locator('.fp-hf-zone.is-editing .ProseMirror')).toBeFocused()
    await expect(page.locator('.fp-ribbon__tab[data-tab="hf"]')).toBeVisible()
    await page.keyboard.type('Rapport annuel — page ')
    await rb(page, 'hf-page')
    await page.keyboard.press('Escape')
    await expect(page.locator('.fp-hf-zone.is-editing')).toHaveCount(0)
    const d = await docJson(page)
    expect(d.headers.default).toEqual([{ type: 'paragraph', content: [{ text: 'Rapport annuel — page ' }, { type: 'field', name: 'page', format: '' }] }])
    await settle(page)
    expect((await page.locator('.fp-hf-zone--header').allInnerTexts()).map((x) => x.trim()).slice(0, 2)).toEqual(['Rapport annuel — page 1', 'Rapport annuel — page 2'])
    // annuler dans le document annule la modification de l'en-tête
    await editor(page).click()
    await page.keyboard.press(`${mod}+z`)
    expect((await docJson(page)).headers.default).toEqual([])
    errors.check()
  })

  test('numéros de page depuis le ruban, puis suppression', async ({ page }, info) => {
    await open(page, info, longDoc({}, 2))
    // Insertion → En-tête et pied de page, comme dans les traitements de texte habituels.
    await tab(page, 'insert')
    await rb(page, 'page-numbers')
    await page.locator('[data-popover="page-numbers"] [data-pn="footers-of"]').click()
    await settle(page)
    const n = await page.locator('.fp-sheet').count()
    expect((await page.locator('.fp-hf-zone--footer').first().innerText()).trim()).toBe(`Page 1 sur ${n}`)
    await rb(page, 'page-numbers')
    await page.locator('[data-popover="page-numbers"] [data-pn="remove"]').click()
    expect((await docJson(page)).footers.default).toEqual([])
  })

  test('mise en page : paysage, marges, taille ; la boîte de dialogue en centimètres', async ({ page }, info) => {
    await open(page, info, longDoc({}, 3))
    const before = await page.locator('.fp-sheet').count()
    await tab(page, 'layout')
    await rb(page, 'orientation')
    await page.locator('[data-popover="orientation"] [data-orientation="landscape"]').click()
    await settle(page)
    const w = await page.locator('.fp-sheet').first().evaluate((el) => el.getBoundingClientRect().width)
    expect(Math.round(w)).toBe(Math.round((297 * 96) / 25.4))
    expect(await page.locator('.fp-sheet').count()).not.toBe(before)
    expect(await linesInsideSheets(page)).toEqual([])
    await rb(page, 'margins')
    await page.locator('[data-popover="margins"] [data-margins="narrow"]').click()
    await rb(page, 'page-size')
    await page.locator('[data-popover="page-size"] [data-size="A5"]').click()
    let d = await docJson(page)
    expect(d.page).toMatchObject({ size: 'A5', orientation: 'landscape', margins: { top: 12.7, left: 12.7 } })
    await page.locator('.fp-rb-launch[data-launch="page-setup"]').click()
    const dlg = page.locator('[data-dialog="page-setup"]')
    await dlg.locator('[data-field="size"]').selectOption('custom')
    await dlg.locator('[data-field="width"]').fill('15')
    await dlg.locator('[data-field="height"]').fill('20')
    await dlg.locator('[data-field="orientation"]').selectOption('portrait')
    await dlg.locator('[data-field="margin-left"]').fill('3')
    await dlg.locator('[data-action="ok"]').click()
    d = await docJson(page)
    expect(d.page).toMatchObject({ size: 'custom', width: 150, height: 200, orientation: 'portrait', margins: { left: 30 } })
    await settle(page)
    expect(await linesInsideSheets(page)).toEqual([])
    // tout est annulable
    await editor(page).click()
    for (let i = 0; i < 4; i++) await page.keyboard.press(`${mod}+z`)
    expect((await docJson(page)).page).toMatchObject({ size: 'A4', orientation: 'portrait' })
  })

  test('les champs {{page}} du texte donnent la page où ils se trouvent', async ({ page }, info) => {
    const d = longDoc({}, 4) as { blocks: unknown[] }
    d.blocks.push({ md: 'Ici, page {{page}} sur {{pages}}.' })
    await open(page, info, d)
    const n = await page.locator('.fp-sheet').count()
    await expect(page.locator('.fp-prose .fp-field').first()).toHaveText(String(n))
    await expect(page.locator('.fp-prose .fp-field').nth(1)).toHaveText(String(n))
  })

  test('vue web : texte continu, sans feuilles ; retour à la vue page', async ({ page }, info) => {
    await open(page, info, longDoc({}, 2))
    await tab(page, 'view')
    await rb(page, 'view-web')
    await expect(page.locator('.fp-sheet')).toHaveCount(0)
    await expect(page.locator('.fp-spacer')).toHaveCount(0)
    await expect(page.locator('#fp-pages')).toHaveText(/web/i)
    await rb(page, 'view-page')
    await settle(page)
    expect(await page.locator('.fp-sheet').count()).toBeGreaterThan(1)
  })

  test('les flèches traversent la limite de page', async ({ page }, info) => {
    await open(page, info, { format: 'folio/doc', version: 1, blocks: [para(1, 140)] })
    expect(await page.locator('.fp-spacer--inline').count()).toBeGreaterThan(0)
    // curseur sur la dernière ligne de la page 1, flèche bas : on arrive sur la page 2
    await page.locator('.fp-spacer--inline').first().evaluate((el) => el.scrollIntoView({ block: 'center' }))
    const lineEnd = await page.evaluate(() => {
      const sp = document.querySelector('.fp-spacer--inline')!
      return sp.getBoundingClientRect().top - 10
    })
    const box = (await editor(page).boundingBox())!
    await page.mouse.click(box.x + 40, lineEnd)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.type('§')
    const y = await page.evaluate(() => {
      const t = [...document.querySelectorAll('.fp-prose p')][0]
      const walker = document.createTreeWalker(t, NodeFilter.SHOW_TEXT)
      let n: Node | null
      while ((n = walker.nextNode())) {
        const i = n.nodeValue!.indexOf('§')
        if (i >= 0) {
          const r = document.createRange()
          r.setStart(n, i)
          r.setEnd(n, i + 1)
          return r.getBoundingClientRect().top - document.querySelector('.fp-spacer--inline')!.getBoundingClientRect().bottom
        }
      }
      return null
    })
    expect(y).not.toBeNull()
    expect(y!).toBeGreaterThanOrEqual(-2)
    expect(y!).toBeLessThan(60)
    // et la flèche haut revient sur la dernière ligne de la page 1
    await page.keyboard.press('ArrowUp')
    await page.keyboard.type('¤')
    const up = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.querySelector('.fp-prose p')!, NodeFilter.SHOW_TEXT)
      let n: Node | null
      while ((n = walker.nextNode())) {
        const i = n.nodeValue!.indexOf('¤')
        if (i >= 0) {
          const r = document.createRange()
          r.setStart(n, i)
          r.setEnd(n, i + 1)
          return document.querySelector('.fp-spacer--inline')!.getBoundingClientRect().top - r.getBoundingClientRect().bottom
        }
      }
      return null
    })
    expect(up).not.toBeNull()
    expect(up!).toBeGreaterThanOrEqual(-2)
    expect(up!).toBeLessThan(40)
  })

  test('au zoom, la coupure en pages ne change pas', async ({ page }, info) => {
    await open(page, info, longDoc({}, 3))
    const n = await page.locator('.fp-sheet').count()
    await page.locator('#fp-zoom-in').click()
    await page.locator('#fp-zoom-in').click()
    // nouvelle coupure, au zoom, sans changer le texte
    await page.evaluate(() => window.dispatchEvent(new Event('resize')))
    await settle(page)
    expect(await page.locator('.fp-sheet').count()).toBe(n)
    expect(await linesInsideSheets(page)).toEqual([])
  })

  test('l’impression donne autant de pages que l’écran (Chrome)', async ({ page, browserName }, info) => {
    test.skip(browserName !== 'chromium', 'page.pdf() n’existe que pour Chromium.')
    await open(
      page,
      info,
      longDoc({ headers: { default: ['En-tête'] }, footers: { default: [{ md: '{{page}}', align: 'center' }] } }),
    )
    const sheets = await page.locator('.fp-sheet').count()
    await page.emulateMedia({ media: 'print' })
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
    expect(pages).toBe(sheets)
    await page.emulateMedia({ media: 'screen' })
    await caretAfter(page, 'Section 1')
    void blocks
  })
})

test.describe('règle', () => {
  test('retraits à la souris et au clavier, marges, affichage', async ({ page }, info) => {
    await open(page, info, { format: 'folio/doc', version: 1, blocks: ['premier paragraphe', 'second'] })
    await caretAfter(page, 'premier')
    await expect(page.locator('#fp-ruler')).toBeVisible()
    // première ligne : glisser de 1 cm vers la droite
    const first = page.locator('.fp-ruler__marker--first')
    const b = (await first.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + (10 * 96) / 25.4, b.y + b.height / 2, { steps: 5 })
    await page.mouse.up()
    expect((await blocks(page))[0]).toMatchObject({ indent: { first: 28.5 } })
    // retrait gauche au clavier : deux crans de 0,25 cm
    await page.locator('.fp-ruler__marker--left').focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    expect((await blocks(page))[0].indent.left).toBe(14)
    // le paragraphe suivant n'a pas bougé
    expect((await blocks(page))[1].indent).toBeUndefined()
    // marge gauche de la page
    await page.locator('.fp-ruler__marker--margin').first().focus()
    await page.keyboard.press('ArrowLeft')
    expect((await docJson(page)).page.margins.left).toBe(19.5)
    // masquer la règle
    await tab(page, 'view')
    await rb(page, 'view-ruler')
    await expect(page.locator('#fp-ruler')).toBeHidden()
    await rb(page, 'view-ruler')
    await expect(page.locator('#fp-ruler')).toBeVisible()
  })
})

test.describe('colonnes et sections', () => {
  test('colonnes depuis le ruban, ligne de séparation, saut de colonne, retour à une colonne', async ({ page }, info) => {
    await open(page, info, { format: 'folio/doc', version: 1, blocks: ['titre', 'un texte en colonnes', 'suite', 'après'] })
    await selectText(page, 'un texte')
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.up('Shift')
    await tab(page, 'layout')
    await rb(page, 'columns')
    await page.locator('[data-popover="columns"] [data-columns="3"]').click()
    let b = await blocks(page)
    expect(b.map((x: any) => x.type)).toEqual(['paragraph', 'columns', 'paragraph'])
    expect(b[1]).toMatchObject({ count: 3, rule: false })
    await expect(page.locator('.fp-prose .fp-columns')).toHaveCSS('column-count', '3')
    await rb(page, 'columns')
    await page.locator('[data-popover="columns"] [data-columns="rule"]').click()
    await expect(page.locator('.fp-prose .fp-columns')).toHaveAttribute('data-rule', '')
    await caretAfter(page, 'un texte en colonnes')
    await rb(page, 'breaks')
    await page.locator('[data-popover="breaks"] [data-break="column"]').click()
    b = await blocks(page)
    expect(b[1].blocks.map((x: any) => x.type)).toEqual(['paragraph', 'columnbreak', 'paragraph'])
    await rb(page, 'columns')
    await page.locator('[data-popover="columns"] [data-columns="1"]').click()
    expect((await blocks(page)).map((x: any) => x.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph'])
  })

  test('sections : numérotation romaine puis arabe, page impaire, en-têtes propres', async ({ page }, info) => {
    const errors = watchErrors(page)
    await open(page, info, {
      format: 'folio/doc',
      version: 1,
      page: { numberFormat: 'roman' },
      headers: { default: ['Préface'] },
      footers: { default: [{ md: '{{page}}', align: 'center' }] },
      blocks: [
        { type: 'paragraph', style: 'title', text: 'Thèse' },
        para(1, 20),
        { type: 'section', start: 'odd', numberStart: 1, numberFormat: 'decimal', headers: { default: ['Chapitre 1'] } },
        { type: 'heading', text: 'Chapitre 1' },
        para(2, 4),
      ],
    })
    const footers = (await page.locator('.fp-hf-zone--footer').allInnerTexts()).map((x) => x.trim())
    const headers = (await page.locator('.fp-hf-zone--header').allInnerTexts()).map((x) => x.trim())
    // préface : i, ii (si le texte en prend deux) ; puis une page blanche si besoin pour commencer sur 1 (impaire)
    expect(footers[0]).toBe('i')
    expect(footers.at(-1)).toBe('1')
    expect(headers.at(-1)).toBe('Chapitre 1')
    expect(headers[0]).toBe('Préface')
    // le chapitre commence sur une page impaire de la feuille : sa page est numérotée 1
    const n = footers.length
    const chapterSheet = footers.indexOf('1')
    expect(chapterSheet).toBeGreaterThan(0)
    expect(n).toBe(chapterSheet + 1)
    // modifier l'en-tête du chapitre ne touche pas la préface
    await page.locator('.fp-hf-zone--header').last().dblclick()
    await page.keyboard.press('End')
    await page.keyboard.type(' — introduction')
    await page.keyboard.press('Escape')
    await settle(page)
    const d = await docJson(page)
    expect(d.headers.default).toEqual([{ type: 'paragraph', content: [{ text: 'Préface' }] }])
    expect(d.blocks[2].headers.default).toEqual([{ type: 'paragraph', content: [{ text: 'Chapitre 1 — introduction' }] }])
    errors.check()
  })

  test('saut de section depuis le ruban, options de section, liaison des en-têtes', async ({ page }, info) => {
    await open(page, info, { format: 'folio/doc', version: 1, headers: { default: ['Commun'] }, blocks: ['un', 'deux'] })
    await caretAfter(page, 'un')
    await tab(page, 'layout')
    await rb(page, 'breaks')
    await page.locator('[data-popover="breaks"] [data-break="section-page"]').click()
    await settle(page)
    expect(await page.locator('.fp-sheet').count()).toBe(2)
    await expect(page.locator('.fp-prose .fp-section-break')).toHaveCount(1)
    await caretAfter(page, 'deux')
    await rb(page, 'section-options')
    const dlg = page.locator('[data-dialog="section"]')
    await dlg.locator('[data-field="section-restart"]').check()
    await dlg.locator('[data-field="section-number"]').fill('10')
    await dlg.locator('[data-field="section-linked"]').uncheck()
    await dlg.locator('[data-action="ok"]').click()
    const d = await docJson(page)
    const sec = d.blocks.find((x: any) => x.type === 'section')
    expect(sec).toMatchObject({ start: 'page', numberStart: 10, headers: { default: [{ type: 'paragraph', content: [{ text: 'Commun' }] }] } })
    // dans la première section, les options renvoient à la mise en page
    await caretAfter(page, 'un')
    await rb(page, 'section-options')
    await expect(page.locator('[data-dialog="page-setup"]')).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('l’impression avec sections et page blanche donne autant de pages que l’écran (Chrome)', async ({ page, browserName }, info) => {
    test.skip(browserName !== 'chromium', 'page.pdf() n’existe que pour Chromium.')
    await open(page, info, { format: 'folio/doc', version: 1, blocks: ['un', { type: 'section', start: 'even' }, 'deux', { type: 'columns', blocks: [para(1, 6), { type: 'columnbreak' }, para(2, 3)] }] })
    const sheets = await page.locator('.fp-sheet').count()
    expect(sheets).toBe(2)
    await page.emulateMedia({ media: 'print' })
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(sheets)
  })
})
