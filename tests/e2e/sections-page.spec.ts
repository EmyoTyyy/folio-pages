// Sections de format différent : une section en paysage au milieu d'un
// document en portrait (pour un grand tableau), marges propres, coupure en
// pages, feuilles, en-têtes, impression.

import { writeFileSync } from 'node:fs'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { makeFile, openEditor, watchErrors } from './helpers'

const sentence = (i: number) => `Phrase ${i} d’un paragraphe assez long pour occuper plusieurs lignes de la page imprimée.`
const para = (k: number, n: number) => ({ text: `[${k}] ` + Array.from({ length: n }, (_, i) => sentence(i + 1)).join(' ') })

const DOC = {
  format: 'folio/doc',
  version: 1,
  meta: { title: 'Mixte', lang: 'fr' },
  footers: { default: [{ md: '{{page}}', align: 'center' }] },
  blocks: [
    { type: 'heading', text: 'Portrait' },
    ...Array.from({ length: 8 }, (_, i) => para(i, 5)),
    { type: 'section', page: { size: 'A4', orientation: 'landscape', margins: { top: 15, right: 15, bottom: 15, left: 15 } } },
    { type: 'heading', text: 'Paysage' },
    { type: 'table', header: true, repeatHeader: true, rows: [['Mois', 'Ventes', 'Coûts', 'Marge', 'Note'], ...Array.from({ length: 40 }, (_, i) => [`M${i + 1}`, `${i * 10}`, `${i * 7}`, `${i * 3}`, 'ok'])] },
    { type: 'section', page: { size: 'A4', orientation: 'portrait', margins: { top: 25, right: 22, bottom: 25, left: 22 } } },
    { type: 'heading', text: 'Retour' },
    para(99, 4),
  ],
}

async function settle(page: Page) {
  let prev = ''
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150)
    const now = await page.evaluate(() => [...document.querySelectorAll('.fp-spacer')].map((s) => getComputedStyle(s).height).join(',') + '|' + document.querySelectorAll('.fp-sheet').length)
    if (now === prev) return
    prev = now
  }
}

async function open(page: Page, info: TestInfo, doc: unknown) {
  await openEditor(page, makeFile(info, 'mixte.html', doc).url)
  await page.waitForFunction(() => document.querySelectorAll('.fp-sheet').length > 0)
  await settle(page)
}

/** Chaque ligne de texte et chaque ligne de tableau est dans la zone de texte de sa feuille (verticalement et horizontalement). */
function outside(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector('.fp-page') as HTMLElement
    const scale = paper.getBoundingClientRect().width / paper.offsetWidth
    const box = paper.getBoundingClientRect()
    const sheets = [...document.querySelectorAll<HTMLElement>('.fp-sheet')].map((s) => {
      const r = s.getBoundingClientRect()
      return { top: (r.top - box.top) / scale, bottom: (r.bottom - box.top) / scale, left: (r.left - box.left) / scale, right: (r.right - box.left) / scale }
    })
    const bad: string[] = []
    const check = (rect: DOMRect, what: string) => {
      const y = (rect.top - box.top) / scale + 1
      const s = sheets.find((x) => y >= x.top && y <= x.bottom)
      const x0 = (rect.left - box.left) / scale
      const x1 = (rect.right - box.left) / scale
      if (!s) bad.push(`${what}: hors feuille @${Math.round(y)}`)
      else if (x0 < s.left + 20 || x1 > s.right - 20 || (rect.bottom - box.top) / scale > s.bottom - 20) bad.push(`${what}: déborde @${Math.round(y)} (${Math.round(x0)}–${Math.round(x1)} dans ${Math.round(s.left)}–${Math.round(s.right)})`)
    }
    const walker = document.createTreeWalker(document.querySelector('.fp-prose')!, NodeFilter.SHOW_TEXT)
    const r = document.createRange()
    let n: Node | null
    while ((n = walker.nextNode())) {
      r.selectNodeContents(n)
      for (const rect of Array.from(r.getClientRects())) if (rect.height && rect.width) check(rect, (n.nodeValue ?? '').slice(0, 20))
    }
    for (const tr of document.querySelectorAll('.fp-prose tr')) check(tr.getBoundingClientRect(), 'ligne de tableau')
    return bad
  })
}

test('une section en paysage : feuilles larges centrées, texte dans sa page, en-tête du tableau répété, retour au portrait', async ({ page }, info) => {
  const errors = watchErrors(page)
  await page.setViewportSize({ width: 1400, height: 900 })
  await open(page, info, DOC)
  const sheets = await page.locator('.fp-sheet').evaluateAll((els) => els.map((e) => ({ w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), x: Math.round(e.getBoundingClientRect().left) })))
  const portrait = sheets[0]
  const land = sheets.filter((s) => s.w > s.h)
  expect(land.length).toBeGreaterThanOrEqual(2)
  expect(land[0].w).toBe(portrait.h)
  // Les feuilles sont centrées les unes sur les autres.
  expect(Math.abs(portrait.x + portrait.w / 2 - (land[0].x + land[0].w / 2))).toBeLessThan(2)
  // Retour au portrait à la fin.
  expect(sheets[sheets.length - 1].w).toBe(portrait.w)
  await page.locator('.fp-prose h1', { hasText: 'Paysage' }).evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(200)
  await page.screenshot({ path: info.outputPath('mixte.png'), fullPage: false })
  expect(await outside(page)).toEqual([])
  // L'en-tête du tableau est redessiné en haut de chaque page où le tableau continue, sans chevaucher les lignes.
  const heads = page.locator('.fp-repeat-head')
  expect(await heads.count()).toBeGreaterThanOrEqual(1)
  await expect(heads.first().locator('th')).toHaveText(['Mois', 'Ventes', 'Coûts', 'Marge', 'Note'])
  const overlap = await page.evaluate(() => {
    const out: string[] = []
    for (const head of document.querySelectorAll('.fp-repeat-head')) {
      const hr = head.getBoundingClientRect()
      const rows = [...document.querySelectorAll('.fp-prose tr')].map((r) => r.getBoundingClientRect()).filter((r) => r.top >= hr.top - 2 && r.top < hr.bottom + 200)
      const firstBelow = rows.find((r) => r.top >= hr.top - 2)
      if (!firstBelow) out.push('aucune ligne sous l’en-tête')
      else if (firstBelow.top < hr.bottom - 1.5) out.push(`chevauchement ${Math.round(hr.bottom - firstBelow.top)} px`)
      else if (firstBelow.top > hr.bottom + 3) out.push(`trou ${Math.round(firstBelow.top - hr.bottom)} px`)
      // Même largeur que le tableau.
      const table = document.querySelector('.fp-prose table')!.getBoundingClientRect()
      if (Math.abs(hr.width - table.width) > 2 || Math.abs(hr.left - table.left) > 2) out.push('largeur ou position différente du tableau')
    }
    return out
  })
  expect(overlap).toEqual([])
  // Les numéros de page suivent, sur chaque feuille.
  const footers = await page.locator('.fp-hf-zone--footer .fp-hf').allTextContents()
  expect(footers.map((x) => x.trim())).toEqual(sheets.map((_, i) => String(i + 1)))
  errors.check()
})

test('impression : chaque page à son format (portrait, paysage, portrait), autant de pages que l’écran (Chrome)', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'page.pdf() n’existe que pour Chromium.')
  await open(page, info, DOC)
  const sheets = await page.locator('.fp-sheet').evaluateAll((els) => els.map((e) => (e.getBoundingClientRect().width > e.getBoundingClientRect().height ? 'L' : 'P')))
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
  await expect(page.locator('.fp-print-page')).toHaveCount(sheets.length)
  await page.emulateMedia({ media: 'print' })
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
  const boxes = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => (Number(m[1]) > Number(m[2]) ? 'L' : 'P'))
  expect(boxes).toEqual(sheets)
  writeFileSync(info.outputPath('mixte.pdf'), pdf)
  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(page.locator('.fp-print-pages')).toHaveCount(0)
})

test('mise en page « à partir de ce point » : section en paysage ; l’orientation du ruban ne change que la section ; « tout le document » ; répéter l’en-tête', async ({ page }, info) => {
  const { caretAfter, docJson, mod, rb, tab } = await import('./helpers')
  await open(page, info, { format: 'folio/doc', version: 1, meta: { lang: 'fr' }, blocks: ['Avant.', 'Ici commence le tableau.', { type: 'table', rows: [['Nom', 'Valeur'], ['a', '1']] }, 'Après.'] })
  await caretAfter(page, 'Ici commence')
  await tab(page, 'layout')
  await page.locator('.fp-rb-launch[data-launch="page-setup"]').click()
  const dlg = page.locator('[data-dialog="page-setup"]')
  await dlg.locator('[data-field="orientation"]').selectOption('landscape')
  await expect(dlg.locator('[data-field="apply-to"] option')).toHaveText(['Tout le document', 'À partir de ce point'])
  await dlg.locator('[data-field="apply-to"]').selectOption('forward')
  await dlg.locator('[data-action="ok"]').click()
  await settle(page)
  let d = await docJson(page)
  expect(d.page.orientation).toBe('portrait')
  expect(d.blocks[1]).toMatchObject({ type: 'section', start: 'page', page: { orientation: 'landscape', size: 'A4' } })
  const shapes = () => page.locator('.fp-sheet').evaluateAll((els) => els.map((e) => (e.getBoundingClientRect().width > e.getBoundingClientRect().height ? 'L' : 'P')))
  await expect.poll(shapes).toEqual(['P', 'L'])
  // Dans la section : le ruban change l'orientation de la section seulement.
  await caretAfter(page, 'Après')
  await rb(page, 'orientation')
  await page.locator('[data-popover] [data-orientation="portrait"]').click()
  await settle(page)
  d = await docJson(page)
  expect(d.blocks[1].page.orientation).toBe('portrait')
  expect(d.page.orientation).toBe('portrait')
  await page.keyboard.press(`${mod}+z`)
  await settle(page)
  expect((await docJson(page)).blocks[1].page.orientation).toBe('landscape')
  // Répéter la ligne d'en-tête du tableau.
  await caretAfter(page, 'Nom')
  await tab(page, 'table')
  await rb(page, 'repeat-header')
  expect((await docJson(page)).blocks.find((b: any) => b.type === 'table').repeatHeader).toBe(true)
  // « Tout le document » : la section reprend le format du document.
  await caretAfter(page, 'Après')
  await tab(page, 'layout')
  await page.locator('.fp-rb-launch[data-launch="page-setup"]').click()
  await expect(dlg.locator('[data-field="apply-to"]')).toHaveValue('section')
  await expect(dlg.locator('[data-field="orientation"]')).toHaveValue('landscape')
  await dlg.locator('[data-field="orientation"]').selectOption('portrait')
  await dlg.locator('[data-field="apply-to"]').selectOption('doc')
  await dlg.locator('[data-action="ok"]').click()
  await settle(page)
  d = await docJson(page)
  expect(d.blocks[1].page).toBeUndefined()
  await expect.poll(shapes).toEqual(['P', 'P'])
})

test('listes générées longues : la table des matières et la bibliographie continuent sur la page suivante', async ({ page }, info) => {
  const errors = watchErrors(page)
  const headings = Array.from({ length: 70 }, (_, i) => ({ type: 'heading', level: 2, text: `Partie ${i + 1}` }))
  const sources = Array.from({ length: 60 }, (_, i) => ({ id: `S${i}`, type: 'book', authors: [`Auteur${i}, Prénom`], title: `Un titre assez long pour la source numéro ${i}`, publisher: 'Éditions', year: String(1900 + i) }))
  await open(page, info, {
    format: 'folio/doc',
    version: 1,
    meta: { lang: 'fr' },
    sources,
    blocks: [{ type: 'toc', title: 'Sommaire', levels: 3 }, { content: sources.map((s) => ({ type: 'cite', id: s.id })) }, { type: 'bibliography', title: 'Références' }, ...headings],
  })
  // Des intercalaires dans les listes, et chaque ligne dans la zone de texte de sa feuille.
  await expect.poll(() => page.locator('.fp-toc .fp-spacer--inner').count()).toBeGreaterThanOrEqual(1)
  await expect.poll(() => page.locator('.fp-refblock[data-kind="bibliography"] .fp-spacer--inner').count()).toBeGreaterThanOrEqual(1)
  await settle(page)
  expect(await outside(page)).toEqual([])
  // Les numéros de page de la table suivent la coupure.
  const last = await page.locator('.fp-toc .fp-toc__page').last().textContent()
  expect(Number(last)).toBeGreaterThan(2)
  errors.check()
})
