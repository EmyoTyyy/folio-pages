#!/usr/bin/env node
// Captures d'écran du site (docs/assets), prises sur le VRAI fichier construit.
//   npm run build && node scripts/site-screenshots.mjs
// Écrit des PNG dans build/shots ; scripts/site-images.py les convertit en WebP.

import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'build/shots')
const tmp = join(root, 'build/shots/files')
mkdirSync(tmp, { recursive: true })
const blank = readFileSync(join(root, 'dist/folio-pages.html'), 'utf8')
const EMPTY = '<script type="application/folio+json" id="folio-doc"></script>'

function file(name, doc) {
  const json = typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2)
  const html = blank.replace(EMPTY, () => `<script type="application/folio+json" id="folio-doc">\n${json.replace(/</g, '\\u003c')}\n</script>`)
  const p = join(tmp, name)
  writeFileSync(p, html)
  return pathToFileURL(p).href
}

const garden = {
  format: 'folio/doc',
  version: 1,
  id: 'site-garden-0001',
  meta: { title: 'Community garden: spring plan', lang: 'en', modified: '2026-03-02T10:00:00.000Z' },
  blocks: [
    { type: 'heading', text: 'Community garden: spring plan' },
    { md: 'Twelve households share the plot on Mill Lane this year. This plan sets out **who grows what**, the work days, and the budget agreed at the March meeting.' },
    { type: 'heading', level: 2, text: 'Beds and crops' },
    {
      type: 'table',
      rows: [
        ['Bed', 'Crop', 'Sow', 'Lead'],
        ['1', 'Early potatoes', '12 March', 'Amira'],
        ['2', 'Peas and broad beans', '19 March', 'Jonas'],
        ['3', 'Salads, in succession', 'Every two weeks', 'Priya'],
        ['4', 'Herbs and flowers', '2 April', 'Tom'],
      ],
    },
    { type: 'heading', level: 2, text: 'Work days' },
    {
      type: 'list',
      style: 'number',
      items: ['Saturday 15 March: clear the beds, mend the fence', 'Saturday 5 April: compost and mulch', 'Sunday 27 April: plant out the tomatoes'],
    },
    { type: 'heading', level: 2, text: 'Budget' },
    { md: 'Seeds and compost come to **€184**, about €15 per household. Water is free this year thanks to the new rain butts.' },
    { type: 'quote', text: '“Plant in the spring, share in the summer.” (the noticeboard by the gate)' },
  ],
}

const maths = {
  format: 'folio/doc',
  version: 1,
  id: 'site-maths-0001',
  meta: { title: 'Physics revision: motion', lang: 'en', modified: '2026-03-02T10:00:00.000Z' },
  blocks: [
    { type: 'heading', text: 'Motion with constant acceleration' },
    { md: 'A ball is thrown straight up at $v_0 = 12\\,\\mathrm{m/s}$. Gravity slows it at $g \\approx 9.81\\,\\mathrm{m/s^2}$, so its height after $t$ seconds is' },
    { type: 'equation', tex: 'h(t) = v_0 t - \\frac{1}{2} g t^2 \\label{height}', numbered: true },
    { md: 'It stops rising when its speed is zero, at $t_{\\max} = v_0 / g$. Put back into $\\eqref{height}$:' },
    { type: 'equation', tex: 'h_{\\max} = \\frac{v_0^2}{2g} \\approx 7.3\\,\\mathrm{m}', numbered: true },
    { md: 'The same idea in chemistry: burning methane, $\\ce{CH4 + 2O2 -> CO2 + 2H2O}$, balances atoms on both sides.' },
  ],
}

const sloppy = `{
  "format": "folio/doc", "version": 1,
  "meta": { "title": "Field notes", "lang": "en", "colour": "green" },
  "blocks": [
    { "type": "h2", "text": "Tuesday" },
    { "type": "callout", "text": "Kept as a paragraph." },
    { "type": "list", "items": ["a", { "text": "b", "level": 4 }] },
    { "content": [{ "text": "a link", "link": "javascript:alert(1)" }] },
  ]
}`

const broken = `{
  "format": "folio/doc",
  "version": 1,
  "meta": { "title": "Thesis, chapter 2" },
  "blocks": [
    { "type": "heading", "text": "Method" }
    { "text": "A comma is missing just before this line." }
  ]
}`

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'en-GB' })

async function open(url) {
  const page = await ctx.newPage()
  await page.goto(url)
  await page.waitForFunction(() => !!window.folio)
  await page.addStyleTag({ content: '.fp-toasts{display:none!important} *{caret-color:transparent!important}' })
  await page.waitForTimeout(400)
  return page
}

// 1. La fenêtre complète, document d'exemple.
{
  const page = await open(file('garden.html', garden))
  await page.mouse.click(10, 890) // retirer le focus
  await page.screenshot({ path: join(out, 'hero.png') })
  // 2. L'onglet IA du ruban.
  await page.locator('.fp-ribbon__tab[data-tab="ai"]').click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(out, 'ai-menu.png'), clip: { x: 0, y: 0, width: 760, height: 210 } })
  await page.close()
}

// 2 bis. Des équations, et l'éditeur d'équation ouvert sur l'une d'elles.
{
  const page = await open(file('maths.html', maths))
  await page.mouse.click(10, 890)
  await page.locator('.fp-equation').nth(1).dblclick()
  const dlg = page.locator('dialog[data-dialog="equation"]')
  await dlg.waitFor()
  // La page reste visible derrière : fenêtre à droite, sans voile flou.
  await page.addStyleTag({ content: 'dialog::backdrop{background:rgba(18,28,22,.10)!important;backdrop-filter:none!important} dialog[data-dialog="equation"]{margin:auto 24px auto auto!important;width:560px!important;max-width:560px!important}' })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(out, 'equations.png'), clip: { x: 0, y: 70, width: 1440, height: 830 } })
  await page.close()
}

// 3. Récupération après plantage.
{
  const url = file('crash.html', garden)
  const page = await open(url)
  await page.locator('.fp-prose p').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Two more households joined in February.')
  await page.waitForTimeout(1500)
  await page.close()
  const again = await open(url)
  const dlg = again.locator('dialog[data-dialog="recovery"]')
  await dlg.waitFor()
  await again.addStyleTag({ content: '.fp-app{visibility:hidden} dialog::backdrop{background:#e2e6e1!important;backdrop-filter:none!important}' })
  await dlg.screenshot({ path: join(out, 'recovery.png') })
  await again.close()
}

// 4. Rapport d'ouverture d'un document maladroit.
{
  const page = await open(file('sloppy.html', sloppy))
  await page.locator('#fp-report').click()
  const dlg = page.locator('dialog[data-dialog="report"]')
  await dlg.waitFor()
  await page.addStyleTag({ content: '.fp-app{visibility:hidden} dialog::backdrop{background:#e2e6e1!important;backdrop-filter:none!important}' })
  await dlg.screenshot({ path: join(out, 'report.png') })
  await page.close()
}

// 5. JSON illisible.
{
  const page = await ctx.newPage()
  await page.goto(file('broken.html', broken))
  const card = page.locator('.fp-screen__card')
  await card.waitFor()
  await page.waitForFunction(() => !document.getElementById('folio-splash'))
  await card.screenshot({ path: join(out, 'broken.png') })
  await page.close()
}

// 6. Le même document, dans Folio Pages puis exporté en .docx et ouvert par LibreOffice.
{
  const page = await open(file('garden-docx.html', garden))
  await page.setViewportSize({ width: 1100, height: 1500 })
  await page.waitForTimeout(500)
  const sheet = page.locator('.fp-sheet').first()
  await sheet.screenshot({ path: join(out, 'docx-folio.png') })
  await page.evaluate(() => delete window.showSaveFilePicker)
  await page.locator('[data-menu="file"]').click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-menu-popup="file"] [data-item="export-docx"]').click()])
  const docx = join(tmp, 'garden.docx')
  await download.saveAs(docx)
  await page.close()
  // LibreOffice rend la première page en image. On lui prête les polices du document
  // (celles que Folio Pages embarque), comme sur un ordinateur où elles sont installées.
  const home = join(tmp, 'lo-home')
  mkdirSync(join(home, 'fonts'), { recursive: true })
  cpSync(join(root, 'src/fonts'), join(home, 'fonts'), { recursive: true })
  try {
    execFileSync('soffice', ['--headless', `-env:UserInstallation=${pathToFileURL(join(tmp, 'lo-profile')).href}`, '--convert-to', 'png', '--outdir', tmp, docx], {
      stdio: 'ignore',
      timeout: 120_000,
      env: { ...process.env, XDG_DATA_HOME: home },
    })
    cpSync(join(tmp, 'garden.png'), join(out, 'docx-other.png'))
  } catch (e) {
    console.warn('LibreOffice absent ou en échec : docx-other.png n’est pas refait.', e.message)
  }
}

// 7. Image de partage (1200×630), composée avec la police du site.
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  const fonts = pathToFileURL(join(root, 'docs/fonts')).href
  const hero = pathToFileURL(join(out, 'hero.png')).href
  const cardPath = join(out, 'social.html')
  writeFileSync(cardPath, `<!doctype html><html><head><style>
    @font-face{font-family:N;src:url('${fonts}/newsreader-latin-wght-normal.woff2')}
    @font-face{font-family:NI;src:url('${fonts}/newsreader-latin-wght-italic.woff2')}
    @font-face{font-family:H;src:url('${fonts}/hanken-grotesk-latin-wght-normal.woff2')}
    body{margin:0;width:1200px;height:630px;overflow:hidden;background:radial-gradient(70% 90% at 12% 30%,#dbe9e2,#f6f7f5 70%);font-family:H}
    .t{position:absolute;left:72px;top:92px;width:470px}
    h1{font:600 64px/1.02 N;letter-spacing:-.02em;color:#121714;margin:0}
    h1 em{font-family:NI;font-weight:500;color:#1e6b55}
    p{font-size:25px;line-height:1.4;color:#2a312d;margin:26px 0 0}
    .b{position:absolute;left:72px;bottom:64px;display:flex;align-items:center;gap:12px;font-size:24px;font-weight:600;color:#1e5e4b}
    .shot{position:absolute;left:600px;top:70px;width:760px;border-radius:12px;box-shadow:0 30px 70px -20px rgba(18,28,22,.4);border:1px solid #dde1dc}
  </style></head><body>
    <div class="t"><h1>A word processor in a <em>single file.</em></h1><p>Open it, write, save: the file rewrites itself. Opens and exports .docx. Free and open source.</p></div>
    <div class="b"><svg width="40" height="40" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="7" fill="#1E5E4B"/><path d="M9.5 6H19l5 5v14a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 8 25V7.5A1.5 1.5 0 0 1 9.5 6z" fill="#F7F3EA"/><path d="M19 6v4a1 1 0 0 0 1 1h4z" fill="#C3D9CF"/><path d="M12 6h4v9.2l-2-1.7-2 1.7z" fill="#E8735A"/></svg>Folio Pages</div>
    <img class="shot" src="${hero}">
  </body></html>`)
  await page.goto(pathToFileURL(cardPath).href)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(out, 'social.png') })
  await page.close()
}

await browser.close()
console.log('captures écrites dans build/shots')
