// Affichage → Lecteur immersif : colonne, couleur de page, focus de ligne,
// espacement, lecture à voix haute ; rien ne se modifie, Échap ferme.

import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { docJson, editor, makeFile, openEditor, rb, tab, watchErrors } from './helpers'

const LONG = Array.from({ length: 30 }, (_, i) => `Paragraphe ${i + 1} : une phrase assez longue pour remplir une ligne entière de la colonne de lecture, et même un peu plus.`)
const doc = { format: 'folio/doc', version: 1, meta: { title: 'Lecture', lang: 'fr' }, blocks: [{ type: 'heading', text: 'Un long texte' }, { type: 'paragraph', content: ['Voir ', { text: 'le site', link: 'https://exemple.org/' }, '.'] }, ...LONG] }

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('folio-pages:settings')) localStorage.setItem('folio-pages:settings', JSON.stringify({ ribbonAutoHide: false }))
    // Une voix de l'appareil simulée : chaque phrase « dite » est notée, puis finie un peu plus tard.
    const said: string[] = []
    ;(window as any).__said = said
    class Utterance {
      text: string
      voice: unknown = null
      lang = ''
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(text: string) {
        this.text = text
      }
    }
    // La phrase en cours ne finit que quand le test le demande (__next) : pas de course.
    let current: Utterance | null = null
    ;(window as any).__next = () => {
      const u = current
      current = null
      u?.onend?.()
    }
    const synth = {
      speaking: false,
      getVoices: () => [{ localService: true, lang: 'fr-FR', name: 'Voix' }],
      speak(u: Utterance) {
        said.push(u.text)
        current = u
      },
      cancel() {
        current = null
      },
    }
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true })
  })
})

async function openReader(page: Page, info: TestInfo) {
  await openEditor(page, makeFile(info, 'lecture.html', doc).url)
  await tab(page, 'view')
  await rb(page, 'immersive-reader')
  const reader = page.locator('[data-immersive]')
  await expect(reader).toBeVisible()
  return reader
}

test('le texte du document, sans pages ni édition ; Échap ferme et rend la main à l’éditeur', async ({ page }, info) => {
  const errors = watchErrors(page)
  const reader = await openReader(page, info)
  const text = reader.locator('.fp-immersive__text')
  await expect(text.locator('h1, h2').first()).toHaveText('Un long texte')
  await expect(text.locator('p')).toHaveCount(31)
  expect(await text.locator('[contenteditable], .fp-spacer, [id]').count()).toBe(0)
  // Taper ne change rien au document.
  const before = JSON.stringify((await docJson(page)).blocks)
  await reader.locator('.fp-immersive__scroll').click()
  await page.keyboard.type('xyz')
  expect(JSON.stringify((await docJson(page)).blocks)).toBe(before)
  // Un lien ne fait pas quitter la page.
  await page.evaluate(() => ((window as any).__opened = []) && (window.open = ((u: string) => ((window as any).__opened.push(u), null)) as typeof window.open))
  await text.getByText('le site').click()
  expect(page.url()).toMatch(/lecture\.html$/)
  await expect.poll(() => page.evaluate(() => (window as any).__opened)).toEqual(['https://exemple.org/'])
  await page.keyboard.press('Escape')
  await expect(reader).toHaveCount(0)
  await expect(editor(page)).toBeFocused()
  errors.check()
})

test('colonne, couleur de page, espacement : appliqués et mémorisés', async ({ page }, info) => {
  const reader = await openReader(page, info)
  const column = reader.locator('.fp-immersive__column')
  const w = async () => (await column.boundingBox())!.width
  const moderate = await w()
  await reader.locator('[data-imm="width"][data-value="narrow"]').click()
  expect(await w()).toBeLessThan(moderate - 50)
  await expect(reader.locator('[data-imm="width"][data-value="narrow"]')).toHaveAttribute('aria-pressed', 'true')
  await reader.locator('[data-imm="color"][data-value="sepia"]').click()
  expect(await reader.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(245, 236, 217)')
  await reader.locator('[data-imm="color"][data-value="inverse"]').click()
  expect(await column.evaluate((e) => getComputedStyle(e).filter)).toContain('invert')
  const p = reader.locator('.fp-immersive__text p').nth(3)
  const spacing = () => p.evaluate((e) => parseFloat(getComputedStyle(e).letterSpacing) || 0)
  expect(await spacing()).toBe(0)
  await reader.locator('[data-imm="spacing"]').click()
  expect(await spacing()).toBeGreaterThan(0)
  await page.keyboard.press('Escape')
  // Rouvert : les mêmes réglages.
  await rb(page, 'immersive-reader')
  await expect(page.locator('[data-immersive]')).toHaveAttribute('data-width', 'narrow')
  await expect(page.locator('[data-immersive]')).toHaveAttribute('data-color', 'inverse')
  await expect(page.locator('[data-immersive]')).toHaveClass(/is-spaced/)
})

test('focus de ligne : trois lignes visibles au milieu, les flèches avancent d’une ligne', async ({ page }, info) => {
  const reader = await openReader(page, info)
  await reader.locator('[data-imm="focus"][data-value="3"]').click()
  const top = reader.locator('.fp-immersive__veil--top')
  const bottom = reader.locator('.fp-immersive__veil--bottom')
  await expect(top).toBeVisible()
  const a = (await top.boundingBox())!
  const b = (await bottom.boundingBox())!
  const lh = await reader.locator('.fp-immersive__text p').first().evaluate((e) => parseFloat(getComputedStyle(e).lineHeight))
  expect(Math.abs(b.y - (a.y + a.height) - 3 * lh)).toBeLessThan(2)
  const scroller = reader.locator('.fp-immersive__scroll')
  await scroller.focus()
  const y0 = await scroller.evaluate((e) => e.scrollTop)
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => scroller.evaluate((e) => e.scrollTop)).toBeGreaterThan(y0 + lh - 2)
  await reader.locator('[data-imm="focus"][data-value="0"]').click()
  await expect(top).toBeHidden()
})

test('lecture à voix haute : paragraphe par paragraphe, surligné ; le bouton l’arrête', async ({ page }, info) => {
  const reader = await openReader(page, info)
  await reader.locator('[data-imm="speak"]').click()
  await expect(reader.locator('.is-spoken')).toHaveCount(1)
  await expect(reader.locator('.is-spoken')).toHaveText('Un long texte')
  await page.evaluate(() => (window as any).__next())
  await expect(reader.locator('.is-spoken')).toHaveText('Voir le site.')
  await page.evaluate(() => (window as any).__next())
  await expect(reader.locator('.is-spoken')).toHaveText(LONG[0])
  expect(await page.evaluate(() => (window as any).__said)).toEqual(['Un long texte', 'Voir le site.', LONG[0]])
  await expect(reader.locator('[data-imm="speak"]')).toHaveAttribute('aria-pressed', 'true')
  // Arrêter : plus de surlignage, plus rien n'est dit.
  await reader.locator('[data-imm="speak"]').click()
  await expect(reader.locator('.is-spoken')).toHaveCount(0)
  await page.evaluate(() => (window as any).__next())
  expect(await page.evaluate(() => (window as any).__said.length)).toBe(3)
})
