// Phase 4 : notes de bas de page et de fin (fichier construit, Chrome et Firefox).

import { expect, test, type Page } from '@playwright/test'
import { caretAfter, docJson, editor, makeFile, mod, openEditor, rb, tab, watchErrors } from './helpers'

const sentence = (i: number) => `Phrase ${i} d’un paragraphe assez long pour occuper plusieurs lignes de la page.`
const words = (n: number, from = 0) => Array.from({ length: n }, (_, i) => sentence(from + i + 1)).join(' ')

/** Un long document : des paragraphes avec des notes de longueurs variées. */
function notesDoc(n = 40, extra: Record<string, unknown> = {}) {
  const blocks: unknown[] = [{ type: 'heading', text: 'Rapport' }]
  for (let i = 0; i < n; i++) {
    const content: unknown[] = [words(3 + (i % 4), i * 10)]
    if (i % 2 === 0) content.push({ type: 'note', text: `Note du paragraphe ${i}. ` + 'Précision supplémentaire. '.repeat((i * 7) % 9) })
    content.push(' Fin du paragraphe.')
    blocks.push({ type: 'paragraph', content })
  }
  return { format: 'folio/doc', version: 1, blocks, ...extra }
}

async function settle(page: Page) {
  let prev = ''
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150)
    const now = await page.evaluate(
      () =>
        [...document.querySelectorAll('.fp-spacer')].map((s) => getComputedStyle(s).height).join(',') +
        '|' +
        document.querySelectorAll('.fp-sheet').length +
        '|' +
        [...document.querySelectorAll('.fp-notes-zone')].map((z) => z.getBoundingClientRect().top.toFixed(0)).join(','),
    )
    if (now === prev) return
    prev = now
  }
}

/** Où est chaque appel, chaque note ; le texte passe-t-il sous des notes ; les zones restent-elles dans le cadre du texte ? */
function layout(page: Page) {
  return page.evaluate(() => {
    const css = getComputedStyle(document.documentElement)
    const px = (v: string) => parseFloat(css.getPropertyValue(v))
    const sheets = [...document.querySelectorAll('.fp-sheet')].map((s) => s.getBoundingClientRect())
    const sheetOf = (y: number) => sheets.findIndex((r) => y >= r.top - 0.5 && y < r.bottom + 0.5)
    const refs = [...document.querySelectorAll<HTMLElement>('.fp-prose .fp-note-ref')].map((el) => {
      const r = el.getBoundingClientRect()
      return { label: el.dataset.label!, kind: el.dataset.note!, sheet: sheetOf((r.top + r.bottom) / 2) }
    })
    const notes = [...document.querySelectorAll<HTMLElement>('.fp-notes-zone .fp-note')].map((el) => {
      const r = el.getBoundingClientRect()
      return { label: el.querySelector('.fp-note__num')!.textContent!, kind: el.classList.contains('fp-note--end') ? 'end' : 'foot', sheet: sheetOf((r.top + r.bottom) / 2), text: el.querySelector('.fp-note__body')!.textContent! }
    })
    const zones = [...document.querySelectorAll<HTMLElement>('.fp-notes-zone')].map((z) => z.getBoundingClientRect())
    const scale = (document.querySelector('.fp-page') as HTMLElement).getBoundingClientRect().width / (document.querySelector('.fp-page') as HTMLElement).offsetWidth
    const top = px('--pg-top') * scale
    const bottom = px('--pg-bottom') * scale
    const outside = zones.filter((z) => {
      const k = sheetOf(z.top + 1)
      return k < 0 || z.top < sheets[k].top + top - 1 || z.bottom > sheets[k].bottom - bottom + 1
    }).length
    let overlaps = 0
    let lastLine = 0
    const walker = document.createTreeWalker(document.querySelector('.fp-prose')!, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let n: Node | null
    while ((n = walker.nextNode())) {
      range.selectNodeContents(n)
      for (const r of Array.from(range.getClientRects())) {
        if (!r.height) continue
        lastLine = Math.max(lastLine, r.bottom)
        for (const z of zones) if (r.bottom > z.top + 1 && r.top < z.bottom - 1) overlaps++
      }
    }
    return { refs, notes, overlaps, outside, sheets: sheets.length, lastLine, zones: zones.map((z) => ({ top: z.top, bottom: z.bottom })) }
  })
}

test.describe('notes de bas de page', () => {
  test('chaque note est sur la page de son appel, sans recouvrir le texte', async ({ page }, info) => {
    const errs = watchErrors(page)
    await openEditor(page, makeFile(info, 'notes.html', notesDoc(48)).url)
    await settle(page)
    const l = await layout(page)
    expect(l.sheets).toBeGreaterThan(3)
    const foot = l.refs.filter((r) => r.kind === 'foot')
    expect(foot.map((r) => r.label)).toEqual(Array.from({ length: 24 }, (_, i) => String(i + 1)))
    expect(l.notes.map((n) => n.label)).toEqual(foot.map((r) => r.label))
    for (const r of foot) expect(l.notes.find((n) => n.label === r.label)!.sheet, `note ${r.label}`).toBe(r.sheet)
    expect(l.overlaps).toBe(0)
    expect(l.outside).toBe(0)
    expect(l.notes[0].text).toContain('Note du paragraphe 0.')
    errs.check()
  })

  test('la coupure suit les modifications et le zoom', async ({ page }, info) => {
    const errs = watchErrors(page)
    await openEditor(page, makeFile(info, 'notes.html', notesDoc(30)).url)
    await settle(page)
    // Une note qui s'allonge repousse le texte de sa page.
    await page.locator('.fp-notes-zone .fp-note__body').first().click()
    await expect(page.locator('.fp-note.is-editing')).toHaveCount(1)
    await page.keyboard.press('End')
    for (let i = 0; i < 6; i++) await page.keyboard.type(' Une longue phrase ajoutée à la note pour la faire grandir nettement.')
    await page.keyboard.press('Escape')
    await settle(page)
    let l = await layout(page)
    for (const r of l.refs.filter((x) => x.kind === 'foot')) expect(l.notes.find((n) => n.label === r.label)!.sheet).toBe(r.sheet)
    expect(l.overlaps).toBe(0)
    await page.locator('#fp-zoom-in').click()
    await page.evaluate(() => window.dispatchEvent(new Event('resize')))
    await settle(page)
    l = await layout(page)
    for (const r of l.refs.filter((x) => x.kind === 'foot')) expect(l.notes.find((n) => n.label === r.label)!.sheet).toBe(r.sheet)
    expect(l.overlaps).toBe(0)
    expect(l.outside).toBe(0)
    errs.check()
  })

  test('insérer une note (Ctrl+Alt+F), l’écrire, revenir au texte, annuler', async ({ page }, info) => {
    const errs = watchErrors(page)
    await openEditor(page, makeFile(info, 'vide.html', { format: 'folio/doc', version: 1, blocks: ['Premier paragraphe.', 'Second paragraphe.'] }).url)
    await caretAfter(page, 'Premier paragraphe')
    await page.keyboard.press(`${mod}+Alt+f`)
    const body = page.locator('.fp-note.is-editing .fp-note__body')
    await expect(body).toHaveCount(1)
    await expect(page.locator('.fp-note.is-editing .fp-note__num')).toHaveText('1')
    await page.keyboard.type('Ma source : ')
    await page.keyboard.press(`${mod}+i`)
    await page.keyboard.type('le livre')
    await page.keyboard.press('Escape')
    await expect(page.locator('.fp-note.is-editing')).toHaveCount(0)
    // Retour au texte, juste après l'appel.
    await page.keyboard.type('X')
    const d = await docJson(page)
    expect(d.blocks[0].content).toEqual([
      { text: 'Premier paragraphe' },
      { type: 'note', kind: 'foot', blocks: [{ type: 'paragraph', content: [{ text: 'Ma source : ' }, { text: 'le livre', italic: true }] }] },
      { text: 'X.' },
    ])
    await expect(page.locator('.fp-notes-zone .fp-note')).toHaveText(/1\s*Ma source : le livre/)
    // Annuler : la lettre, puis la note.
    await page.keyboard.press(`${mod}+z`)
    expect((await docJson(page)).blocks[0].content[2]).toEqual({ text: '.' })
    for (let i = 0; i < 3 && (await page.locator('.fp-prose .fp-note-ref').count()) > 0; i++) await page.keyboard.press(`${mod}+z`)
    await expect(page.locator('.fp-prose .fp-note-ref')).toHaveCount(0)
    await expect(page.locator('.fp-notes-zone')).toHaveCount(0)
    errs.check()
  })

  test('clic sur une note : on la modifie ; sur son numéro : retour à l’appel', async ({ page }, info) => {
    await openEditor(page, makeFile(info, 'notes.html', notesDoc(6)).url)
    await settle(page)
    await page.locator('.fp-notes-zone .fp-note').nth(1).locator('.fp-note__body').click()
    await expect(page.locator('.fp-note.is-editing')).toHaveCount(1)
    await page.keyboard.press(`${mod}+a`)
    await page.keyboard.type('Remplacée.')
    // Un clic dans le texte ferme la note et l'enregistre.
    await editor(page).locator('p').first().click()
    await expect(page.locator('.fp-note.is-editing')).toHaveCount(0)
    await expect(page.locator('.fp-notes-zone .fp-note').nth(1)).toContainText('Remplacée.')
    await page.locator('.fp-notes-zone .fp-note').nth(2).locator('.fp-note__num').click()
    await expect(page.locator('.fp-prose .fp-note-ref.ProseMirror-selectednode')).toHaveAttribute('data-label', '3')
    // Entrée sur l'appel sélectionné ouvre la note ; double-clic aussi.
    await page.keyboard.press('Enter')
    await expect(page.locator('.fp-note.is-editing .fp-note__num')).toHaveText('3')
    await page.keyboard.press('Escape')
    await page.locator('.fp-prose .fp-note-ref').first().dblclick()
    await expect(page.locator('.fp-note.is-editing .fp-note__num')).toHaveText('1')
    await page.keyboard.press('Escape')
  })

  test('supprimer l’appel supprime la note ; les numéros suivent', async ({ page }, info) => {
    await openEditor(page, makeFile(info, 'notes.html', notesDoc(6)).url)
    await settle(page)
    await page.locator('.fp-notes-zone .fp-note').first().locator('.fp-note__num').click()
    await page.keyboard.press('Delete')
    await settle(page)
    await expect(page.locator('.fp-prose .fp-note-ref')).toHaveCount(2)
    await expect(page.locator('.fp-notes-zone .fp-note__num')).toHaveText(['1', '2'])
    await expect(page.locator('.fp-notes-zone .fp-note').first()).toContainText('Note du paragraphe 2.')
  })

  test('ruban : insérer, aller à la note suivante, options (symboles, recommencer à chaque page)', async ({ page }, info) => {
    const errs = watchErrors(page)
    await openEditor(page, makeFile(info, 'notes.html', notesDoc(40)).url)
    await settle(page)
    await tab(page, 'references')
    await caretAfter(page, 'Rapport')
    await page.locator('.fp-ribbon [data-cmd="note-next"]').click()
    await page.locator('[data-go="next-foot"]').click()
    await expect(page.locator('.fp-prose .fp-note-ref.ProseMirror-selectednode')).toHaveAttribute('data-label', '1')
    await page.locator('.fp-ribbon [data-launch="notes"]').click()
    await page.locator('[data-field="foot-format"]').selectOption('symbols')
    await page.locator('[data-field="foot-restart"]').selectOption('page')
    await page.locator('[data-dialog="notes"] [data-action="ok"]').click()
    await settle(page)
    const l = await layout(page)
    const foot = l.refs.filter((r) => r.kind === 'foot')
    // Chaque page recommence à « * ».
    for (let k = 0; k < l.sheets; k++) {
      const onPage = foot.filter((r) => r.sheet === k)
      if (onPage.length) expect(onPage[0].label).toBe('*')
      expect(onPage.map((r) => r.label)).toEqual(['*', '†', '‡', '§', '¶', '‖', '**'].slice(0, onPage.length))
    }
    for (const r of foot) expect(l.notes.filter((n) => n.sheet === r.sheet).map((n) => n.label)).toContain(r.label)
    expect((await docJson(page)).notes.foot).toEqual({ format: 'symbols', start: 1, restart: 'page' })
    // Annulable en une fois.
    await page.keyboard.press(`${mod}+z`)
    expect((await docJson(page)).notes.foot.format).toBe('decimal')
    errs.check()
  })

  test('une note ne va ni dans un en-tête ni dans une note', async ({ page }, info) => {
    await openEditor(page, makeFile(info, 'notes.html', notesDoc(4)).url)
    await settle(page)
    await page.locator('.fp-notes-zone .fp-note__body').first().click()
    await page.keyboard.press(`${mod}+Alt+f`)
    await expect(page.locator('.fp-toast')).toContainText(/ne peut pas aller ici/)
    await page.keyboard.press('Escape')
    await expect(page.locator('.fp-prose .fp-note-ref')).toHaveCount(2)
  })
})

test.describe('notes de fin', () => {
  test('après le texte, sur des pages ajoutées s’il le faut ; numérotées i, ii, iii', async ({ page }, info) => {
    const errs = watchErrors(page)
    const blocks: unknown[] = [{ type: 'heading', text: 'Article' }]
    for (let i = 0; i < 14; i++) blocks.push({ type: 'paragraph', content: [words(4, i * 5), { type: 'note', kind: 'end', text: `Note de fin ${i + 1}. ` + 'Référence détaillée et commentée. '.repeat(6 + (i % 5) * 3) }] })
    blocks.push({ type: 'paragraph', content: ['Dernière ligne du texte', { type: 'note', text: 'Et une note de bas de page.' }] })
    await openEditor(page, makeFile(info, 'fin.html', { format: 'folio/doc', version: 1, blocks }).url)
    await settle(page)
    const l = await layout(page)
    const ends = l.notes.filter((n) => n.kind === 'end')
    expect(ends.map((n) => n.label)).toEqual(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv'])
    // Les notes de fin commencent après la dernière ligne de texte, et continuent sur des pages ajoutées.
    const lastTextSheet = Math.max(...l.refs.map((r) => r.sheet))
    expect(ends[0].sheet).toBeGreaterThanOrEqual(lastTextSheet)
    expect(ends[ends.length - 1].sheet).toBeGreaterThan(lastTextSheet)
    expect(l.sheets).toBe(ends[ends.length - 1].sheet + 1)
    expect(l.overlaps).toBe(0)
    expect(l.outside).toBe(0)
    // Les pages ajoutées comptent dans {{pages}} et la barre d'état.
    await expect(page.locator('#fp-pages')).toContainText(String(l.sheets))
    // La note de bas de page de la dernière page reste en bas de cette page.
    const foot = l.notes.find((n) => n.kind === 'foot')!
    expect(foot.sheet).toBe(l.refs.find((r) => r.kind === 'foot')!.sheet)
    errs.check()
  })

  test('l’impression donne autant de pages que l’écran, notes comprises (Chrome)', async ({ page, browserName }, info) => {
    test.skip(browserName !== 'chromium', 'page.pdf() n’existe que pour Chromium.')
    const blocks: unknown[] = []
    for (let i = 0; i < 20; i++) blocks.push({ type: 'paragraph', content: [words(4, i * 5), { type: 'note', kind: i % 3 ? 'foot' : 'end', text: 'Note. '.repeat(10 + i * 3) }] })
    await openEditor(page, makeFile(info, 'pdf.html', { format: 'folio/doc', version: 1, blocks }).url)
    await settle(page)
    const sheets = await page.locator('.fp-sheet').count()
    await page.emulateMedia({ media: 'print' })
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(sheets)
    await page.emulateMedia({ media: 'screen' })
  })
})

test('vue web : les notes à la suite du texte, modifiables', async ({ page }, info) => {
  const errs = watchErrors(page)
  const doc = { format: 'folio/doc', version: 1, blocks: [{ type: 'paragraph', content: ['Texte', { type: 'note', text: 'Bas de page.' }, ' et', { type: 'note', kind: 'end', text: 'Fin.' }] }] }
  await openEditor(page, makeFile(info, 'web.html', doc).url)
  await tab(page, 'view')
  await rb(page, 'view-web')
  await expect(page.locator('.fp-notes-end')).toBeVisible()
  await expect(page.locator('.fp-notes-end__group[data-kind="foot"] .fp-note')).toHaveText(/1\s*Bas de page\./)
  await expect(page.locator('.fp-notes-end__group[data-kind="end"] .fp-note')).toHaveText(/i\s*Fin\./)
  await page.locator('.fp-notes-end .fp-note__body').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Ajout.')
  await page.keyboard.press('Escape')
  await expect(page.locator('.fp-notes-end__group[data-kind="foot"] .fp-note')).toHaveText(/Bas de page\. Ajout\./)
  expect(JSON.stringify((await docJson(page)).blocks)).toContain('Bas de page. Ajout.')
  // Retour en vue page : les notes reviennent en bas de page.
  await rb(page, 'view-page')
  await expect(page.locator('.fp-notes-end')).toBeHidden()
  await expect(page.locator('.fp-notes-zone--foot .fp-note')).toHaveText(/Ajout\./)
  errs.check()
})

test('les notes passent par le fichier enregistré', async ({ page }, info) => {
  await openEditor(page, makeFile(info, 'notes.html', notesDoc(4)).url)
  await settle(page)
  const html = await page.evaluate(() => (window as any).folio.serialize())
  const again = makeFile(info, 'relu.html', null)
  const fs = await import('node:fs')
  fs.writeFileSync(again.path, html)
  await openEditor(page, again.url)
  await settle(page)
  await expect(page.locator('.fp-prose .fp-note-ref')).toHaveCount(2)
  await expect(page.locator('.fp-notes-zone .fp-note').first()).toContainText('Note du paragraphe 0.')
})
