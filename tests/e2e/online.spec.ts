// Fonctions en ligne, le réseau simulé : images en ligne (Wikimedia Commons),
// rechercher et synonymes (Wikipédia, Wiktionnaire), polices en ligne (Google
// Fonts), demander à une IA (fenêtre voisine, réponse collée), dicter
// (reconnaissance vocale simulée). En mode hors ligne, rien ne part.

import { expect, test, type Page } from '@playwright/test'
import { caretAfter, docJson, editor, makeFile, makePng, mod, openEditor, rb, selectText, tab, watchErrors } from './helpers'

const dialog = (page: Page, name: string) => page.locator(`[data-dialog="${name}"]`)
const pop = (page: Page) => page.locator('[data-popover]')
const CORS = { 'access-control-allow-origin': '*' }
const doc = (blocks: unknown[]) => ({ format: 'folio/doc', version: 1, meta: { lang: 'fr' }, blocks })

test('images en ligne : recherche sur Commons, insertion avec crédit, lien et texte de remplacement', async ({ page }, info) => {
  const errors = watchErrors(page)
  const png = makePng(60, 40, [20, 120, 200])
  const item = (i: number) => ({
    index: i,
    title: `File:Phare ${i}.jpg`,
    imageinfo: [
      {
        mime: 'image/png',
        thumburl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a${i}/Phare_${i}.png/1280px-Phare_${i}.png?utm_source=x`,
        thumbwidth: 60,
        thumbheight: 40,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:Phare_${i}.png`,
        extmetadata: { ObjectName: { value: `Phare ${i}` }, Artist: { value: 'Jo Lu' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, ImageDescription: { value: `Un phare (${i})` } },
      },
    ],
  })
  let query = ''
  await page.route('https://commons.wikimedia.org/**', (route) => {
    query = new URL(route.request().url()).searchParams.get('gsrsearch') ?? ''
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ query: { pages: { a: item(1), b: item(2) } } }) })
  })
  await page.route('https://thumb.wikimedia.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', headers: CORS, body: png }))
  await openEditor(page, makeFile(info, 'images.html', doc(['Un paragraphe.'])).url)
  await caretAfter(page, 'paragraphe.')
  await tab(page, 'insert')
  await rb(page, 'insert-image-menu')
  await pop(page).locator('[data-image="online"]').click()
  const dlg = dialog(page, 'online-pictures')
  await dlg.locator('[data-field="pictures-query"]').fill('phare')
  await dlg.locator('[data-field="pictures-query"]').press('Enter')
  await expect(dlg.locator('[data-picture]')).toHaveCount(2)
  await expect(dlg.locator('p[aria-live="polite"]').first()).toHaveText('2 résultats')
  expect(query).toBe('phare filetype:bitmap|drawing')
  await dlg.locator('[data-picture="1"]').click()
  await dlg.locator('[data-action="ok"]').click()
  await expect(dlg).toBeHidden()
  const fig = (await docJson(page)).blocks.find((b: any) => b.type === 'image')
  expect(fig.alt).toBe('Un phare (2)')
  expect(fig.src).toMatch(/^asset:/)
  expect(fig.caption).toEqual([{ text: 'Phare 2', link: 'https://commons.wikimedia.org/wiki/File:Phare_2.png' }, { text: ' — Jo Lu, CC BY-SA 4.0' }])
  errors.check()
})

test('rechercher et synonymes : volet, Maj+F7, remplacer un mot, clic droit', async ({ page }, info) => {
  const errors = watchErrors(page)
  const wikitext = ['== {{langue|fr}} ==', '=== {{S|adjectif|fr}} ===', '# Qui se [[mouvoir|meut]] avec [[vitesse]].', '==== {{S|synonymes}} ====', '* [[véloce]]', '* [[prompt]]'].join('\n')
  await page.route('https://fr.wiktionary.org/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ parse: { title: 'rapide', wikitext } }) }))
  await page.route('https://fr.wikipedia.org/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ title: 'Vitesse', extract: 'La vitesse est une grandeur.', content_urls: { desktop: { page: 'https://fr.wikipedia.org/wiki/Vitesse' } } }) }))
  await openEditor(page, makeFile(info, 'look.html', doc(['Un train rapide traverse la plaine.'])).url)
  await caretAfter(page, 'rapi')
  await page.keyboard.press('Shift+F7')
  const pane = page.locator('#fp-lookup')
  await expect(pane).toBeVisible()
  await expect(pane.locator('[data-field="lookup-term"]')).toHaveValue('rapide')
  await expect(pane.locator('[data-section="thesaurus"] [data-synonym]')).toHaveText(['véloce', 'prompt'])
  await expect(pane.locator('[data-section="definitions"] li')).toHaveText(['Qui se meut avec vitesse.'])
  await expect(pane.locator('[data-section="wikipedia"]')).toContainText('La vitesse est une grandeur.')
  await pane.locator('[data-synonym="véloce"]').click()
  await expect(editor(page)).toHaveText('Un train véloce traverse la plaine.')
  await page.keyboard.press(`${mod}+z`)
  await expect(editor(page)).toHaveText('Un train rapide traverse la plaine.')
  // Clic droit sur un mot : « Rechercher « plaine » ».
  await selectText(page, 'plaine')
  const r = await page.evaluate(() => {
    const b = getSelection()!.getRangeAt(0).getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  })
  await page.mouse.click(r.x, r.y, { button: 'right' })
  await expect(page.locator('.fp-ctx [data-ctx="lookup"]')).toContainText('Rechercher « plaine »')
  await page.keyboard.press('Escape')
  errors.check()
})

test('polices en ligne : liste libre, téléchargement des sous-ensembles latins, intégrée et appliquée', async ({ page }, info) => {
  const errors = watchErrors(page, [/OTS|font|downloadable/i])
  const face = (subset: string, style: string, weight: number) =>
    `/* ${subset} */\n@font-face {\n  font-family: 'Lora';\n  font-style: ${style};\n  font-weight: ${weight};\n  src: url(https://fonts.gstatic.com/s/lora/${subset}-${style}-${weight}.woff2) format('woff2');\n  unicode-range: U+0000-00FF;\n}\n`
  let cssRequests = 0
  await page.route('https://fonts.googleapis.com/**', (route) => {
    cssRequests++
    return route.fulfill({ status: 200, contentType: 'text/css', headers: CORS, body: face('cyrillic', 'normal', 400) + face('latin-ext', 'normal', 400) + face('latin', 'normal', 400) + face('latin', 'italic', 700) })
  })
  await page.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 200, contentType: 'font/woff2', headers: CORS, body: Buffer.from('wOF2fake') }))
  await openEditor(page, makeFile(info, 'fonts.html', doc(['Un titre élégant.'])).url)
  await selectText(page, 'titre')
  await page.locator('.fp-ribbon [data-combo="font-family"] .fp-rb-combo__arrow').click()
  await page.locator('[data-popover="font-family-list"] [data-value="__online"]').click()
  const dlg = dialog(page, 'online-fonts')
  await expect(dlg.locator('[data-gfont]')).toHaveCount(39)
  await dlg.locator('[data-field="fonts-category"]').selectOption('serif')
  await dlg.locator('[data-gfont="Lora"]').click()
  await dlg.locator('[data-action="ok"]').click()
  await expect(dlg).toBeHidden()
  const d = await docJson(page)
  expect(d.fonts.map((f: any) => [f.family, f.weight, f.italic, f.unicodeRange])).toEqual([
    ['Lora', 400, false, 'U+0000-00FF'],
    ['Lora', 400, false, 'U+0000-00FF'],
    ['Lora', 700, true, 'U+0000-00FF'],
  ])
  expect(cssRequests).toBe(1)
  expect(d.blocks[0].content.find((r: any) => r.font === 'Lora')?.text).toBe('titre')
  errors.check()
})

test('demander à une IA : fenêtre voisine, demande copiée, réponse JSON appliquée puis annulée ; passage en Markdown', async ({ page }, info) => {
  const errors = watchErrors(page)
  await page.addInitScript(() => {
    const w = window as any
    w.__opened = []
    w.__copied = []
    window.open = ((url: string, name: string, features: string) => (w.__opened.push({ url, name, features }), null)) as typeof window.open
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void w.__copied.push(t), readText: async () => w.__clipboard ?? '', write: async () => undefined }, configurable: true })
  })
  await openEditor(page, makeFile(info, 'ia.html', doc([{ type: 'heading', text: 'Rapport' }, 'Premier paragraphe.', 'Second paragraphe.'])).url)
  await tab(page, 'ai')
  await rb(page, 'ask-claude')
  const dlg = dialog(page, 'ask-ai')
  await expect(dlg.locator('[data-field="ai-scope"]')).toHaveValue('doc')
  await dlg.locator('[data-field="ai-request"]').fill('Ajoute une conclusion.')
  await dlg.locator('[data-action="ok"]').click()
  await expect(dlg).toBeHidden()
  const opened = await page.evaluate(() => (window as any).__opened)
  expect(opened).toHaveLength(1)
  expect(opened[0].url).toMatch(/^https:\/\/claude\.ai\/new\?q=Ajoute%20une%20conclusion\./)
  expect(opened[0].features).toMatch(/popup/)
  const copied = await page.evaluate(() => (window as any).__copied[0] as string)
  expect(copied).toContain('Ajoute une conclusion.')
  expect(copied).toContain('"Premier paragraphe."')
  // La réponse : un document complet.
  await page.evaluate(() => ((window as any).__clipboard = 'Voici le document :\n```json\n{"format":"folio/doc","version":1,"blocks":[{"type":"heading","text":"Rapport"},"Premier paragraphe.","Second paragraphe.",{"type":"heading","level":2,"text":"Conclusion"},"Tout va bien."]}\n```'))
  await rb(page, 'ai-paste')
  const ans = dialog(page, 'ai-answer')
  await ans.locator('[data-ai-clipboard]').click()
  await expect(ans.locator('[data-field="ai-answer-kind"]')).toContainText('remplacera le document')
  await ans.locator('[data-action="ok"]').click()
  await expect(editor(page).locator('h2')).toHaveText('Conclusion')
  await editor(page).focus()
  await page.keyboard.press(`${mod}+z`)
  await expect(editor(page).locator('h2')).toHaveCount(0)
  // Une sélection seulement : la réponse en Markdown la remplace.
  await selectText(page, 'Second paragraphe.')
  await rb(page, 'ask-chatgpt')
  await expect(dlg.locator('[data-field="ai-scope"]')).toHaveValue('selection')
  await dlg.locator('[data-field="ai-request"]').fill('Mets en gras.')
  await dlg.locator('[data-action="ok"]').click()
  const second = await page.evaluate(() => (window as any).__opened[1].url as string)
  expect(second).toMatch(/^https:\/\/chatgpt\.com\/\?q=/)
  expect(decodeURIComponent(second)).toContain('```markdown\nSecond paragraphe.\n```')
  await rb(page, 'ai-paste')
  await ans.locator('[data-field="ai-answer"]').fill('```markdown\n**Second paragraphe.**\n```')
  await expect(ans.locator('[data-field="ai-answer-kind"]')).toContainText('remplacera la sélection')
  await ans.locator('[data-action="ok"]').click()
  await expect(editor(page).locator('p strong')).toHaveText('Second paragraphe.')
  expect((await docJson(page)).blocks).toHaveLength(3)
  errors.check()
})

test('dicter : le texte reconnu est écrit au curseur, ponctuation dite comprise ; arrêt', async ({ page }, info) => {
  const errors = watchErrors(page)
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = ''
      continuous = false
      interimResults = false
      onresult: any = null
      onerror: any = null
      onend: any = null
      start() {
        ;(window as any).__rec = this
        setTimeout(() => {
          const r = (t: string, isFinal: boolean) => Object.assign([{ transcript: t }], { isFinal })
          this.onresult?.({ resultIndex: 0, results: [r('bonjour virgule le', false)] })
          this.onresult?.({ resultIndex: 0, results: [r('bonjour virgule le monde point', true)] })
        }, 50)
      }
      stop() {
        setTimeout(() => this.onend?.(), 10)
      }
      abort() {}
    }
    ;(window as any).webkitSpeechRecognition = FakeRecognition
    ;(window as any).SpeechRecognition = FakeRecognition
  })
  await openEditor(page, makeFile(info, 'dicter.html', doc(['Début.'])).url)
  await caretAfter(page, 'Début.')
  await rb(page, 'dictate')
  await expect(page.locator('.fp-dictate')).toBeVisible()
  await expect(editor(page)).toHaveText('Début. Bonjour, le monde.')
  expect(await page.evaluate(() => (window as any).__rec.lang)).toBe('fr-FR')
  await expect(page.locator('.fp-ribbon [data-cmd="dictate"]').first()).toHaveAttribute('aria-pressed', 'true')
  await rb(page, 'dictate')
  await expect(page.locator('.fp-dictate')).toHaveCount(0)
  errors.check()
})

test('hors ligne : rien ne part (images, recherche, polices, IA, dictée)', async ({ page }, info) => {
  let hits = 0
  await page.route(/^https:\/\//, (route) => {
    hits++
    return route.abort()
  })
  await page.addInitScript(() => {
    localStorage.setItem('folio-pages:settings', JSON.stringify({ offline: true }))
    ;(window as any).__opened = []
    window.open = ((url: string) => ((window as any).__opened.push(url), null)) as typeof window.open
  })
  await openEditor(page, makeFile(info, 'off.html', doc(['Un mot rapide.'])).url)
  await caretAfter(page, 'rapi')
  await page.keyboard.press('Shift+F7')
  await expect(page.locator('#fp-lookup')).toContainText('hors ligne')
  await tab(page, 'ai')
  await expect(page.locator('.fp-ribbon [data-cmd="ask-claude"]')).toBeDisabled()
  await tab(page, 'home')
  await expect(page.locator('.fp-ribbon [data-cmd="dictate"]').first()).toBeDisabled()
  expect(await page.evaluate(() => (window as any).__opened)).toEqual([])
  expect(hits).toBe(0)
})
