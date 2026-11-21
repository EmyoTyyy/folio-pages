// Phase 7 : protection par mot de passe, mode hors ligne, mises à jour signées,
// paquets de langue.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { webcrypto } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { BLANK, blankHtml, chooseFile, docOfFile, editor, installFakeFs, makeFile, mod, openApp, openEditor, rb, removeFsAccess, saveByDownload, tab, watchErrors, watchNetwork, writeFile } from './helpers'
import { spliceDocBlock } from '../../src/file/shell'
import { encryptText } from '../../src/file/crypto'

// L'adresse du manifeste (src/update.ts, qui ne se charge pas hors de la construction).
const MANIFEST_URL = /^https:\/\/emyotyyy\.github\.io\/folio-pages\/release\.json/
// Node 18 : WebCrypto n'est pas encore global.
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto

const DOC = { format: 'folio/doc', version: 1, id: 'secret-0001', meta: { title: 'Budget confidentiel' }, blocks: [{ type: 'heading', text: 'Budget 2027' }, { content: ['Voir ', { text: 'le site', link: 'https://exemple.org/page' }, ' pour le détail.'] }] }
const PASSWORD = 'prunier-bleu-42'
const toast = (page: Page, re: RegExp) => page.locator('.fp-toast').filter({ hasText: re }).first()

test.describe('mot de passe', () => {
  test('protéger, enregistrer : le fichier ne contient que l’enveloppe ; le rouvrir demande le mot de passe', async ({ page }, info) => {
    test.setTimeout(90_000)
    const errors = watchErrors(page)
    await removeFsAccess(page)
    await openEditor(page, makeFile(info, 'budget.html', DOC).url)
    await tab(page, 'review')
    await rb(page, 'protect')
    const dlg = page.locator('[data-dialog="protect"]')
    // trop court, différent, non accepté : refusé avec un message
    await dlg.locator('[data-field="protect-password"]').fill('abc')
    await dlg.locator('[data-action="ok"]').click()
    await expect(dlg.locator('.fp-field-error')).not.toBeEmpty()
    await dlg.locator('[data-field="protect-password"]').fill(PASSWORD)
    await expect(dlg.locator('.fp-protect__meter')).not.toHaveAttribute('data-strength', '0')
    // la jauge est sous le champ, sans le chevaucher
    const field = (await dlg.locator('[data-field="protect-password"]').boundingBox())!
    const bar = (await dlg.locator('.fp-protect__meter span').boundingBox())!
    expect(bar.y).toBeGreaterThanOrEqual(field.y + field.height)
    await dlg.locator('[data-field="protect-confirm"]').fill(PASSWORD + 'x')
    await dlg.locator('[data-action="ok"]').click()
    await expect(dlg).toBeVisible()
    await dlg.locator('[data-field="protect-confirm"]').fill(PASSWORD)
    await dlg.locator('[data-field="protect-accept"]').check()
    await dlg.locator('[data-action="ok"]').click()
    await expect(dlg).toBeHidden()
    await expect(page.locator('#fp-lock')).toBeVisible()
    // enregistré : ni le titre ni le texte en clair
    await editor(page).click()
    const saved = await saveByDownload(page, info, 'budget-protege.html')
    expect(saved.html).not.toContain('Budget 2027')
    expect(saved.html).not.toContain('confidentiel')
    const block = /<script type="application\/folio\+json" id="folio-doc">([\s\S]*?)<\/script>/.exec(saved.html)![1]
    expect(JSON.parse(block)).toMatchObject({ format: 'folio/enc', v: 1, id: 'secret-0001' })
    // rouvrir : écran de déverrouillage, mauvais mot de passe refusé
    await page.goto(saved.url)
    await expect(page.locator('#fp-unlock-password')).toBeVisible()
    expect(await page.evaluate(() => (window as any).folio)).toMatchObject({ locked: true })
    expect(await page.evaluate(() => (window as any).folio.doc)).toBeUndefined()
    await page.locator('#fp-unlock-password').fill('mauvais-mot')
    await page.locator('[data-action="unlock"]').click()
    await expect(page.locator('#fp-unlock-error')).toContainText(/incorrect|Mot de passe/i, { timeout: 20_000 })
    await page.locator('#fp-unlock-password').fill(PASSWORD)
    await page.locator('[data-action="unlock"]').click()
    await expect(editor(page)).toContainText('Budget 2027', { timeout: 20_000 })
    await expect(page.locator('#fp-lock')).toBeVisible()
    // retirer la protection : le fichier suivant est en clair
    await tab(page, 'review')
    await rb(page, 'protect')
    await page.locator('[data-dialog="protect-manage"] [data-action="remove"]').click()
    await expect(page.locator('#fp-lock')).toBeHidden()
    await editor(page).click()
    const plain = await saveByDownload(page, info, 'budget-clair.html')
    expect(JSON.stringify(docOfFile(plain.html).blocks[0])).toContain('Budget 2027')
    errors.check()
  })

  test('Ctrl+O sur un fichier protégé : le mot de passe est demandé dans l’application', async ({ page, browserName }, info) => {
    test.setTimeout(90_000)
    const env = await encryptText(JSON.stringify(DOC), PASSWORD, { id: DOC.id })
    const html = spliceDocBlock(blankHtml(), env)!
    const file = writeFile(info, 'budget-protege.html', html)
    if (browserName === 'chromium') {
      await installFakeFs(page)
      await page.addInitScript((text: string) => {
        ;(window as any).showOpenFilePicker = async () => [
          {
            kind: 'file',
            name: 'budget-protege.html',
            getFile: async () => new File([text], 'budget-protege.html'),
            queryPermission: async () => 'granted',
            requestPermission: async () => 'granted',
          },
        ]
      }, html)
    }
    await openEditor(page, makeFile(info, 'autre.html', { format: 'folio/doc', version: 1, blocks: ['autre document'] }).url)
    await editor(page).click()
    if (browserName === 'chromium') await page.keyboard.press(`${mod}+o`)
    else await chooseFile(page, () => page.keyboard.press(`${mod}+o`), { name: 'budget-protege.html', mimeType: 'text/html', buffer: readFileSync(file.path) })
    const dlg = page.locator('[data-dialog="open-password"]')
    await expect(dlg).toBeVisible()
    await dlg.locator('[data-field="password"]').fill('pas le bon')
    await dlg.locator('[data-action="ok"]').click()
    await expect(dlg.locator('.fp-field-error')).toContainText(/incorrect|Mot de passe/i, { timeout: 20_000 })
    await dlg.locator('[data-field="password"]').fill(PASSWORD)
    await dlg.locator('[data-action="ok"]').click()
    await expect(editor(page)).toContainText('Budget 2027', { timeout: 20_000 })
    await expect(page.locator('#fp-lock')).toBeVisible()
  })
})

/** window.open simulé : les adresses ouvertes. */
async function stubOpen(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__opened = []
    window.open = ((url: string) => {
      ;(window as any).__opened.push(url)
      return null
    }) as typeof window.open
  })
}

test('mode hors ligne : ni lien du web ni recherche de mise à jour ; mémorisé ; désactivable', async ({ page }, info) => {
  await stubOpen(page)
  const f = makeFile(info, 'doc.html', DOC)
  await openEditor(page, f.url)
  const net = watchNetwork(page)
  await tab(page, 'help')
  await rb(page, 'offline')
  await expect(page.locator('#fp-offline')).toBeVisible()
  // un lien du web n'est pas ouvert
  await editor(page).getByText('le site').click({ modifiers: ['Control'] })
  await expect(toast(page, /hors ligne/i)).toBeVisible()
  expect(await page.evaluate(() => (window as any).__opened)).toEqual([])
  // rechercher une mise à jour : refusé sans requête
  await tab(page, 'help')
  await expect(page.locator('.fp-ribbon [data-cmd="check-update"]')).toBeDisabled()
  net.check()
  // mémorisé dans le navigateur
  await page.reload()
  await page.waitForFunction(() => !!(window as any).folio?.doc)
  await expect(page.locator('#fp-offline')).toBeVisible()
  // la pastille le coupe
  await page.locator('#fp-offline').click()
  await expect(page.locator('#fp-offline')).toBeHidden()
  await editor(page).getByText('le site').click({ modifiers: ['Control'] })
  await expect.poll(() => page.evaluate(() => (window as any).__opened.length)).toBe(1)
})

// --- mises à jour ------------------------------------------------------------------

const KEY_FILE = process.env.FOLIO_RELEASE_KEY ?? join(homedir(), '.folio-pages', 'release-key.json')

async function signed(payload: unknown, keyFile = KEY_FILE): Promise<string> {
  const key = JSON.parse(readFileSync(keyFile, 'utf8'))
  const priv = await webcrypto.subtle.importKey('jwk', key.private, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const text = JSON.stringify(payload)
  const sig = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode(text))).toString('base64')
  return JSON.stringify({ payload: text, sig })
}
const sha256 = async (bytes: Uint8Array) => Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex')
const CORS = { 'access-control-allow-origin': '*' }

test.describe('mises à jour', () => {
  test('signature fausse ou manifeste malformé : refusé, rien n’est proposé', async ({ page }, info) => {
    await openEditor(page, makeFile(info, 'doc.html', DOC).url)
    let body = JSON.stringify({ payload: JSON.stringify({ app: 'folio-pages', version: '99.0.0', sha256: 'a'.repeat(64), url: 'https://exemple.org/x.html' }), sig: Buffer.from('faux').toString('base64') })
    await page.route(MANIFEST_URL, (r) => r.fulfill({ status: 200, body, headers: CORS }))
    await tab(page, 'help')
    await rb(page, 'check-update')
    await expect(toast(page, /signature/i)).toBeVisible()
    await expect(page.locator('[data-dialog="update"]')).toHaveCount(0)
    body = 'pas du JSON'
    await rb(page, 'check-update')
    await expect(toast(page, /JSON/)).toBeVisible()
    await page.unroute(MANIFEST_URL)
    await page.route(MANIFEST_URL, (r) => r.fulfill({ status: 503, body: '', headers: CORS }))
    await rb(page, 'check-update')
    await expect(toast(page, /503/)).toBeVisible()
  })

  test('mise à jour signée : le nouveau code est vérifié, le document reste intact', async ({ page }, info) => {
    test.skip(!existsSync(KEY_FILE), 'pas de clé de signature locale')
    test.setTimeout(60_000)
    const errors = watchErrors(page)
    await removeFsAccess(page)
    await openEditor(page, makeFile(info, 'doc.html', DOC).url)
    const app = new Uint8Array(readFileSync(BLANK))
    const NEW = 'https://exemple.org/folio-pages-99.html'
    const manifest = async (sum: string) => signed({ app: 'folio-pages', version: '99.0.0', sha256: sum, url: NEW, notes: { fr: ['Une nouveauté.'], en: ['Something new.'] } })
    let current = await manifest('0'.repeat(64))
    await page.route(MANIFEST_URL, (r) => r.fulfill({ status: 200, body: current, headers: CORS }))
    await page.route(NEW, (r) => r.fulfill({ status: 200, body: Buffer.from(app), headers: { ...CORS, 'content-type': 'text/html' } }))
    await tab(page, 'help')
    // empreinte différente : refusé
    await rb(page, 'check-update')
    const dlg = page.locator('[data-dialog="update"]')
    await expect(dlg).toContainText('99.0.0')
    await expect(dlg).toContainText('Une nouveauté.')
    await dlg.locator('[data-action="apply"]').click()
    await expect(toast(page, /integrity/i)).toBeVisible()
    // bonne empreinte : le fichier mis à jour est téléchargé, avec le document
    current = await manifest(await sha256(app))
    await rb(page, 'check-update')
    const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-action="apply"]').click()])
    const out = info.outputPath('maj.html')
    await download.saveAs(out)
    const html = readFileSync(out, 'utf8')
    expect(JSON.stringify(docOfFile(html).blocks[0])).toContain('Budget 2027')
    expect(html).toContain('folio/deflate-b122')
    errors.check()
  })
})

test.describe('recherche de mise à jour à l’ouverture', () => {
  /** Un vrai navigateur : la recherche à l'ouverture est sautée quand il est piloté par un programme. */
  const asUser = (page: Page) => page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }))
  const watchManifest = async (page: Page, body: () => string) => {
    const hits: string[] = []
    await page.route(MANIFEST_URL, (r) => {
      hits.push(r.request().url())
      return r.fulfill({ status: 200, body: body(), headers: CORS })
    })
    return hits
  }

  test('version plus récente : bouton « Mettre à jour » et bulle (une fois par version) ; le bouton propose la mise à jour', async ({ page }, info) => {
    test.skip(!existsSync(KEY_FILE), 'pas de clé de signature locale')
    const errors = watchErrors(page)
    await asUser(page)
    const manifest = await signed({ app: 'folio-pages', version: '99.0.0', sha256: '0'.repeat(64), url: 'https://exemple.org/folio-pages-99.html', notes: { fr: ['Une nouveauté.'] } })
    const hits = await watchManifest(page, () => manifest)
    await openEditor(page, makeFile(info, 'doc.html', DOC).url)
    const btn = page.locator('#fp-update')
    await expect(btn).toBeVisible()
    await expect(btn).toHaveText('Mettre à jour')
    await expect(btn).toHaveAttribute('title', /99\.0\.0.*ce fichier : \d+\.\d+\.\d+/)
    await expect(toast(page, /99\.0\.0 est disponible/)).toBeVisible()
    expect(hits).toHaveLength(1)
    await btn.click()
    const dlg = page.locator('[data-dialog="update"]')
    await expect(dlg).toContainText('99.0.0')
    await expect(dlg).toContainText('Une nouveauté.')
    await dlg.locator('[data-action="cancel"]').click()
    // rouvert : nouvelle recherche, le bouton revient, la bulle ne se répète pas
    await page.reload()
    await page.waitForFunction(() => !!(window as any).folio?.doc)
    await expect(btn).toBeVisible()
    expect(hits).toHaveLength(2)
    await page.waitForTimeout(300)
    await expect(page.locator('.fp-toast').filter({ hasText: /est disponible/ })).toHaveCount(0)
    errors.check()
  })

  test('déjà à jour, ou manifeste refusé : ni bouton ni bulle', async ({ page }, info) => {
    test.skip(!existsSync(KEY_FILE), 'pas de clé de signature locale')
    await asUser(page)
    let body = await signed({ app: 'folio-pages', version: '0.0.1', sha256: '0'.repeat(64), url: 'https://exemple.org/x.html' })
    const hits = await watchManifest(page, () => body)
    await openEditor(page, makeFile(info, 'doc.html', DOC).url)
    await expect.poll(() => hits.length).toBe(1)
    await page.waitForTimeout(300)
    await expect(page.locator('#fp-update')).toBeHidden()
    await expect(page.locator('.fp-toast')).toHaveCount(0)
    // signature fausse : silencieux à l'ouverture (rien n'est proposé)
    body = JSON.stringify({ payload: JSON.stringify({ app: 'folio-pages', version: '99.0.0', sha256: 'a'.repeat(64), url: 'https://exemple.org/x.html' }), sig: Buffer.from('faux').toString('base64') })
    await page.reload()
    await expect.poll(() => hits.length).toBe(2)
    await page.waitForTimeout(300)
    await expect(page.locator('#fp-update')).toBeHidden()
    await expect(page.locator('.fp-toast')).toHaveCount(0)
  })

  test('réglage coupé ou mode hors ligne : aucune requête ; le réactiver cherche aussitôt', async ({ page }, info) => {
    test.skip(!existsSync(KEY_FILE), 'pas de clé de signature locale')
    await asUser(page)
    const manifest = await signed({ app: 'folio-pages', version: '99.0.0', sha256: '0'.repeat(64), url: 'https://exemple.org/x.html' })
    const hits = await watchManifest(page, () => manifest)
    await openEditor(page, makeFile(info, 'doc.html', DOC).url)
    await expect(page.locator('#fp-update')).toBeVisible()
    await tab(page, 'help')
    const box = page.locator('.fp-ribbon [data-cmd="auto-update"]')
    await expect(box).toBeChecked()
    await box.click()
    await expect(box).not.toBeChecked()
    // mémorisé : à la réouverture, rien ne part
    await page.reload()
    await page.waitForFunction(() => !!(window as any).folio?.doc)
    await page.waitForTimeout(2000)
    expect(hits).toHaveLength(1)
    await expect(page.locator('#fp-update')).toBeHidden()
    // le réactiver : une recherche tout de suite
    await tab(page, 'help')
    await box.click()
    await expect(page.locator('#fp-update')).toBeVisible()
    expect(hits).toHaveLength(2)
    // mode hors ligne : le bouton s'efface, et rien ne part à l'ouverture
    await rb(page, 'offline')
    await expect(page.locator('#fp-update')).toBeHidden()
    await page.reload()
    await page.waitForFunction(() => !!(window as any).folio?.doc)
    await page.waitForTimeout(2000)
    expect(hits).toHaveLength(2)
  })

  test('navigateur piloté par un programme : aucune recherche à l’ouverture', async ({ page }, info) => {
    const net = watchNetwork(page)
    await openEditor(page, makeFile(info, 'doc.html', DOC).url)
    await page.waitForTimeout(2000)
    net.check()
  })
})

// --- paquets de langue ---------------------------------------------------------------

const PACK = {
  format: 'folio/lang',
  v: 1,
  lang: 'es',
  name: 'Español',
  version: '1.0',
  strings: { 'ribbon.tab.home': 'Inicio', 'ribbon.tab.insert': 'Insertar', 'clé.inconnue': 'x', 'menu.about': 'Acerca de {nada}' },
}

test('paquet de langue : ajouter, choisir, intégrer au fichier, retirer', async ({ page, browser }, info) => {
  await removeFsAccess(page)
  await openEditor(page, makeFile(info, 'doc.html', DOC).url)
  await tab(page, 'review')
  await rb(page, 'language')
  await chooseFile(page, () => page.locator('[data-popover] [data-item="add-language"]').click(), { name: 'es.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(PACK)) })
  // l'interface passe à la langue ajoutée ; ce qui manque est en anglais
  await expect(page.locator('.fp-ribbon__tab[data-tab="home"]')).toHaveText('Inicio')
  await expect(page.locator('.fp-ribbon__tab[data-tab="review"]')).toHaveText('Review')
  // une phrase aux paramètres différents est ignorée
  await expect(toast(page, /Español/)).toBeVisible()
  // la gestion des langues : intégrer au fichier
  await tab(page, 'review')
  await rb(page, 'language')
  await page.locator('[data-popover] [data-item="manage-languages"]').click()
  const dlg = page.locator('[data-dialog="languages"]')
  await expect(dlg.locator('[data-pack="es"]')).toContainText('Español')
  await dlg.locator('[data-pack-embed="es"]').check()
  await page.keyboard.press('Escape')
  await editor(page).click()
  const saved = await saveByDownload(page, info, 'doc-es.html')
  expect(saved.html).toContain('id="folio-lang"')
  expect(saved.html).toContain('Inicio')
  // le fichier porte sa langue : un autre navigateur (sans le paquet) la retrouve
  const other = await browser.newContext()
  const p2 = await other.newPage()
  await openApp(p2, saved.url)
  await p2.locator('.fp-ribbon__tab[data-tab="review"]').click()
  await p2.locator('.fp-ribbon [data-cmd="language"]').click()
  await expect(p2.locator('[data-popover] [data-item="lang-es"]')).toBeVisible()
  await other.close()
  // retirer le paquet : retour au français
  await tab(page, 'review')
  await rb(page, 'language')
  await page.locator('[data-popover] [data-item="manage-languages"]').click()
  await dlg.locator('[data-pack-remove="es"]').click()
  await expect(dlg.locator('[data-pack="es"]')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('.fp-ribbon__tab[data-tab="home"]')).toHaveText('Accueil')
})
