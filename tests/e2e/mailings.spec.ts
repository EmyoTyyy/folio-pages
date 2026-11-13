// Publipostage : liste de destinataires, champs, aperçu, vérification, fusion,
// enveloppes, étiquettes, messages.

import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { chooseFile, docOfFile, makeFile, openEditor, rb, removeFsAccess, saveByDownload, tab, watchErrors } from './helpers'

const CSV = ['Civilité;Prénom;Nom;Ville;Code postal;Pays;E-mail;Montant', 'Mme;Camille;Durand;Lyon;69003;France;camille@exemple.fr;120', 'M.;Yusuf;Kaya;Boston;02110;USA;yusuf@example.com;45', ';;Lefèvre;Nantes;44000;France;;300'].join('\n')

const doc = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({ format: 'folio/doc', version: 1, meta: { title: 'Relance', lang: 'fr' }, blocks, ...extra })
const SOURCE = {
  name: 'clients.csv',
  fields: ['Civilité', 'Prénom', 'Nom', 'Ville', 'Code postal', 'Pays', 'E-mail', 'Montant'],
  records: [
    ['Mme', 'Camille', 'Durand', 'Lyon', '69003', 'France', 'camille@exemple.fr', '120'],
    ['M.', 'Yusuf', 'Kaya', 'Boston', '02110', 'USA', 'yusuf@example.com', '45'],
    ['', '', 'Lefèvre', 'Nantes', '44000', 'France', '', '300'],
  ],
}
const MAP = { title: 'Civilité', first: 'Prénom', last: 'Nom', city: 'Ville', postal: 'Code postal', country: 'Pays', email: 'E-mail' }

async function open(page: Page, info: TestInfo, blocks: unknown[], extra: Record<string, unknown> = {}) {
  await openEditor(page, makeFile(info, 'lettre.html', doc(blocks, extra)).url)
  await tab(page, 'mailings')
}
const mm = (page: Page) => page.evaluate(() => (window as any).folio.doc.mailMerge)
const dialog = (page: Page, name: string) => page.locator(`[data-dialog="${name}"]`)
const pop = (page: Page) => page.locator('[data-popover]')

/** Le document fusionné s'ouvre dans un nouvel onglet : on le récupère. */
async function mergedTab(page: Page, action: () => Promise<void>): Promise<Page> {
  const [tabPage] = await Promise.all([page.context().waitForEvent('page'), action()])
  await tabPage.waitForFunction(() => !!(window as any).folio?.doc, null, { timeout: 15_000 })
  return tabPage
}
const textOf = (p: Page) => p.evaluate(() => document.querySelector('.fp-prose')!.textContent ?? '')

test('lettres : liste CSV, champs, aperçu, vérification, fusion dans un nouvel onglet, enregistrement', async ({ page }, info) => {
  const errors = watchErrors(page)
  await removeFsAccess(page)
  await open(page, info, [''])
  // démarrer : lettres
  await rb(page, 'mm-start')
  await pop(page).locator('[data-mm-type="letters"]').click()
  expect((await mm(page)).type).toBe('letters')
  // liste existante (CSV au point-virgule)
  await rb(page, 'mm-recipients')
  await chooseFile(page, () => pop(page).locator('[data-recipients="use"]').click(), { name: 'clients.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })
  await expect(page.locator('.fp-toast').filter({ hasText: /3/ }).first()).toBeVisible()
  const m = await mm(page)
  expect(m.source.fields).toEqual(SOURCE.fields)
  expect(m.source.records).toEqual(SOURCE.records)
  expect(m.map).toMatchObject(MAP)
  // salutation, puis un champ
  await page.locator('.fp-prose p').first().click()
  await rb(page, 'mm-greeting')
  await expect(dialog(page, 'mm-greeting').locator('[data-field="greeting-preview"]')).toContainText('Bonjour Camille,')
  await dialog(page, 'mm-greeting').locator('[data-action="ok"]').click()
  await page.keyboard.press('Enter')
  await page.keyboard.type('Montant : ')
  await rb(page, 'mm-insert-field')
  await pop(page).locator('[data-merge-field="Montant"]').click()
  await page.keyboard.type(' €.')
  await expect(page.locator('.fp-merge[data-merge="Montant"]')).toHaveText('«Montant»')
  // aperçu des résultats et navigation
  await rb(page, 'mm-preview')
  await expect(page.locator('.fp-merge[data-merge="@greeting"]')).toHaveText('Bonjour Camille,')
  await expect(page.locator('.fp-merge[data-merge="Montant"]')).toHaveText('120')
  await rb(page, 'mm-next')
  await expect(page.locator('.fp-merge[data-merge="Montant"]')).toHaveText('45')
  await expect(page.locator('[data-cmd="mm-record"]')).toHaveValue('2')
  await rb(page, 'mm-last')
  await expect(page.locator('.fp-merge[data-merge="@greeting"]')).toHaveText('Madame, Monsieur,')
  await expect(page.locator('[data-cmd="mm-next"]')).toBeDisabled()
  // les champs restent des champs dans le document
  const b = await page.evaluate(() => (window as any).folio.doc.blocks)
  expect(b[0].content).toEqual([{ type: 'mergefield', name: '@greeting', opts: expect.objectContaining({ salutation: 'Bonjour', nameFormat: 'first' }) }])
  expect(b[1].content).toEqual([{ text: 'Montant\u00a0: ' }, { type: 'mergefield', name: 'Montant' }, { text: ' €.' }])
  // vérifier : rien à signaler sur ces champs
  await rb(page, 'mm-check')
  await expect(dialog(page, 'mm-check').locator('[data-field="check-ok"]')).toBeVisible()
  await dialog(page, 'mm-check').locator('[data-action="close"]').click()
  // terminer : modifier les documents → nouvel onglet, un exemplaire par destinataire
  await rb(page, 'mm-finish')
  await pop(page).locator('[data-finish="edit"]').click()
  const merged = await mergedTab(page, () => dialog(page, 'mm-finish').locator('[data-action="all"]').click())
  const md = await merged.evaluate(() => (window as any).folio.doc)
  expect(md.mailMerge).toBeUndefined()
  expect(md.blocks.filter((x: any) => x.type === 'section')).toHaveLength(2)
  const mt = await textOf(merged)
  expect(mt).toContain('Bonjour Camille,')
  expect(mt).toContain('Montant\u00a0: 45 €.')
  expect(mt).toContain('Madame, Monsieur,')
  expect(mt).not.toContain('«')
  await merged.close()
  // la liste voyage avec le document
  await page.bringToFront()
  await page.locator('.fp-prose').click()
  const saved = await saveByDownload(page, info, 'lettre.html')
  expect(docOfFile(saved.html).mailMerge.source.records).toHaveLength(3)
  errors.check()
})

test('modifier la liste : décocher, filtrer, trier, corriger une valeur ; une seule fiche à la fusion', async ({ page }, info) => {
  await open(page, info, [{ content: [{ type: 'mergefield', name: 'Nom' }, ' — ', { type: 'mergefield', name: 'Ville' }] }], { mailMerge: { type: 'directory', source: SOURCE, map: MAP } })
  await rb(page, 'mm-edit-list')
  const dlg = dialog(page, 'mm-list')
  await expect(dlg.locator('[data-field="recipients"] tbody tr')).toHaveCount(3)
  await dlg.locator('[data-row="1"]').uncheck()
  await dlg.locator('[data-cell="2:3"]').fill('Rennes')
  await dlg.locator('[data-field="sort-field"]').selectOption('Nom')
  await dlg.locator('[data-field="sort-desc"]').check()
  await dlg.locator('[data-action="ok"]').click()
  const m = await mm(page)
  expect(m.source.excluded).toEqual([1])
  expect(m.source.records[2][3]).toBe('Rennes')
  expect(m.sort).toEqual({ field: 'Nom', desc: true })
  // aperçu : le tri s'applique (Lefèvre avant Durand)
  await rb(page, 'mm-preview')
  await expect(page.locator('.fp-merge[data-merge="Nom"]')).toHaveText('Lefèvre')
  await expect(page.locator('.fp-merge[data-merge="Ville"]')).toHaveText('Rennes')
  // fusion du seul destinataire affiché
  await rb(page, 'mm-finish')
  await pop(page).locator('[data-finish="edit"]').click()
  const merged = await mergedTab(page, () => dialog(page, 'mm-finish').locator('[data-action="current"]').click())
  expect((await textOf(merged)).trim()).toBe('Lefèvre — Rennes')
  await merged.close()
  // annulable
  await page.locator('.fp-prose').click()
  await page.keyboard.press('Control+z')
  expect((await mm(page)).source.excluded).toBeUndefined()
})

test('règles : Si…Alors…Sinon, Ignorer si, Remplir (demandé une fois à la fusion)', async ({ page }, info) => {
  await open(page, info, [''], { mailMerge: { type: 'letters', source: SOURCE, map: MAP } })
  await page.locator('.fp-prose p').first().click()
  await rb(page, 'mm-rules')
  await pop(page).locator('[data-rule="if"]').click()
  const rule = dialog(page, 'mm-rule')
  await rule.locator('[data-field="rule-field"]').selectOption('Montant')
  await rule.locator('[data-field="rule-op"]').selectOption('gt')
  await rule.locator('[data-field="rule-value"]').fill('100')
  await rule.locator('[data-field="rule-then"]').fill('Merci «Prénom» !')
  await rule.locator('[data-field="rule-else"]').fill('À bientôt.')
  await rule.locator('[data-action="ok"]').click()
  await rb(page, 'mm-rules')
  await pop(page).locator('[data-rule="skipif"]').click()
  await rule.locator('[data-field="rule-field"]').selectOption('Pays')
  await rule.locator('[data-field="rule-value"]').fill('USA')
  await rule.locator('[data-action="ok"]').click()
  await rb(page, 'mm-rules')
  await pop(page).locator('[data-rule="fillin"]').click()
  const fill = dialog(page, 'mm-fillin')
  await fill.locator('[data-field="fillin-prompt"]').fill('Signature ?')
  await fill.locator('[data-field="fillin-default"]').fill('Le service client')
  await fill.locator('[data-action="ok"]').click()
  const content = (await page.evaluate(() => (window as any).folio.doc.blocks))[0].content
  expect(content.map((x: any) => x.name)).toEqual(['@if', '@skipif', '@fillin'])
  expect(content[0].opts).toEqual({ field: 'Montant', op: 'gt', value: '100', then: 'Merci «Prénom» !', else: 'À bientôt.' })
  await rb(page, 'mm-preview')
  await expect(page.locator('.fp-merge[data-merge="@if"]')).toHaveText('Merci Camille !')
  // fusion : la question est posée une fois, le destinataire américain est ignoré
  await rb(page, 'mm-finish')
  await pop(page).locator('[data-finish="edit"]').click()
  await dialog(page, 'mm-finish').locator('[data-action="all"]').click()
  await dialog(page, 'mm-fillins').locator('[data-fillin="Signature ?"]').fill('Alex')
  const merged = await mergedTab(page, () => dialog(page, 'mm-fillins').locator('[data-action="ok"]').click())
  const mt = await textOf(merged)
  expect(mt).toContain('Merci Camille !Alex')
  expect(mt).toContain('Merci  !Alex') // Lefèvre n'a pas de prénom
  expect(mt).not.toContain('Yusuf')
  await expect(page.locator('.fp-toast').filter({ hasText: /1/ }).last()).toBeVisible()
  await merged.close()
})

test('enveloppes et étiquettes : un modèle dans le document, ou une page toute prête', async ({ page }, info) => {
  await open(page, info, [''], { mailMerge: { type: 'letters', source: SOURCE, map: MAP } })
  // démarrer des étiquettes : le document devient le modèle d'une étiquette
  await rb(page, 'mm-start')
  await pop(page).locator('[data-mm-type="labels"]').click()
  await dialog(page, 'mm-labels').locator('[data-field="label-sheet"]').selectOption('0')
  await dialog(page, 'mm-labels').locator('[data-action="ok"]').click()
  let m = await mm(page)
  expect(m.type).toBe('labels')
  expect(m.label).toMatchObject({ cols: 3, rows: 7 })
  expect((await page.evaluate(() => (window as any).folio.doc.blocks))[0].content[0]).toMatchObject({ type: 'mergefield', name: '@address' })
  await rb(page, 'mm-finish')
  await pop(page).locator('[data-finish="edit"]').click()
  const labels = await mergedTab(page, () => dialog(page, 'mm-finish').locator('[data-action="all"]').click())
  const ld = await labels.evaluate(() => (window as any).folio.doc)
  expect(ld.page).toMatchObject({ size: 'custom', width: 210, height: 297 })
  expect(ld.blocks[0]).toMatchObject({ type: 'table', rowHeight: expect.any(Number) })
  expect(ld.blocks[0].rows).toHaveLength(7)
  expect(await textOf(labels)).toContain('Yusuf Kaya')
  await labels.close()
  // une page d'étiquettes identiques
  await rb(page, 'mm-labels')
  await dialog(page, 'mm-labels').locator('[data-field="label-text"]').fill('Bocaux — confiture de prunes')
  const sheet = await mergedTab(page, () => dialog(page, 'mm-labels').locator('[data-action="ok"]').click())
  const sd = await sheet.evaluate(() => (window as any).folio.doc)
  expect(JSON.stringify(sd.blocks).match(/confiture de prunes/g)).toHaveLength(21)
  await sheet.close()
  // une enveloppe toute prête
  await rb(page, 'mm-envelopes')
  await dialog(page, 'mm-envelope').locator('[data-field="envelope-size"]').selectOption('0')
  await dialog(page, 'mm-envelope').locator('[data-field="return-address"]').fill('Atelier Durand\n12 rue des Lilas')
  await dialog(page, 'mm-envelope').locator('[data-field="delivery-address"]').fill('Yusuf Kaya\n4 Market Street')
  const env = await mergedTab(page, () => dialog(page, 'mm-envelope').locator('[data-action="ok"]').click())
  const ed = await env.evaluate(() => (window as any).folio.doc)
  expect(ed.page).toMatchObject({ width: 110, height: 220, orientation: 'landscape' })
  expect(await textOf(env)).toContain('4 Market Street')
  await env.close()
  // revenir à un document normal : la liste reste
  await rb(page, 'mm-start')
  await pop(page).locator('[data-mm-type="none"]').click()
  m = await mm(page)
  expect(m.type).toBe('letters')
  expect(m.source.records).toHaveLength(3)
})

test('messages : un par un ou le suivant, Gmail, brouillons .eml ; adresses manquantes signalées', async ({ page }, info) => {
  await open(page, info, [{ content: [{ type: 'mergefield', name: '@greeting' }] }, 'Votre commande est prête.'], { mailMerge: { type: 'emails', source: SOURCE, map: MAP, email: { to: 'E-mail', subject: '' } } })
  await rb(page, 'mm-check')
  await expect(dialog(page, 'mm-check').locator('[data-problem="no-email"]')).toHaveCount(1)
  await dialog(page, 'mm-check').locator('[data-action="close"]').click()
  await rb(page, 'mm-finish')
  await pop(page).locator('[data-finish="email"]').click()
  const dlg = dialog(page, 'mm-emails')
  await dlg.locator('[data-field="email-subject"]').fill('Commande de «Prénom»')
  await dlg.locator('[data-action="prepare"]').click()
  // les liens sont interceptés : rien ne part vers une messagerie pendant le test
  await page.evaluate(() => {
    const w = window as any
    w.__opened = []
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.href.startsWith('mailto:')) w.__opened.push(this.href)
      else click.call(this)
    }
    window.open = ((url: string) => (w.__opened.push(url), null)) as typeof window.open
  })
  const opened = () => page.evaluate(() => (window as any).__opened as string[])
  const rows = dlg.locator('[data-email-row]')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(2)).toHaveClass(/is-invalid/)
  await expect(rows.nth(2).locator('[data-email]')).toBeDisabled()
  await expect(dlg.locator('[data-field="email-progress"]')).toHaveText(/0 sur 3/)
  // un par un, dans la messagerie de l'ordinateur
  await rows.first().locator('[data-email]').click()
  await expect.poll(opened).toHaveLength(1)
  expect((await opened())[0]).toMatch(/^mailto:camille@exemple\.fr\?subject=Commande%20de%20Camille&body=Bonjour%20Camille%2C/)
  await expect(rows.first()).toHaveClass(/is-sent/)
  await expect(dlg.locator('[data-field="email-progress"]')).toHaveText(/1 sur 3/)
  // « Ouvrir le suivant » passe au destinataire suivant, avec Gmail (choix mémorisé)
  await dlg.locator('[data-field="email-via"]').selectOption('gmail')
  await dlg.locator('[data-email-next]').click()
  await expect.poll(opened).toHaveLength(2)
  expect((await opened())[1]).toMatch(/^https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&to=yusuf%40example\.com&su=Commande%20de%20Yusuf/)
  await expect(dlg.locator('[data-field="email-progress"]')).toHaveText(/2 sur 3/)
  await dlg.locator('[data-email-next]').click()
  await expect(page.locator('.fp-toast').filter({ hasText: /ont été ouverts/ })).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('folio-pages:settings')!).mailVia)).toBe('gmail')
  // brouillons .eml : une archive avec un fichier par adresse valide
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-email-eml]').click()])
  expect(dl.suggestedFilename()).toMatch(/\.zip$/)
  const { unzipSync, strFromU8 } = await import('fflate')
  const fs = await import('node:fs')
  const files = unzipSync(new Uint8Array(fs.readFileSync((await dl.path())!)))
  expect(Object.keys(files).sort()).toEqual(['001-camille.eml', '002-yusuf.eml'])
  const eml = strFromU8(files['001-camille.eml'])
  expect(eml).toContain('To: camille@exemple.fr')
  expect(eml).toContain('X-Unsent: 1')
  expect(eml).toContain('Content-Type: text/html; charset=utf-8')
  expect((await mm(page)).email).toEqual({ to: 'E-mail', subject: 'Commande de «Prénom»' })
})

test('groupe E-mail : envoyer le document (plusieurs adresses, pièce jointe, brouillon .eml), un message par destinataire', async ({ page }, info) => {
  const errors = watchErrors(page)
  await open(page, info, [{ type: 'heading', level: 1, content: 'Compte rendu' }, 'Réunion du mardi : le budget est voté.'])
  // visible et utilisable sans liste de destinataires
  for (const id of ['mm-send-doc', 'mm-send-each', 'mm-mail-via']) await expect(page.locator(`.fp-ribbon [data-cmd="${id}"]`)).toBeEnabled()
  await page.evaluate(() => {
    const w = window as any
    w.__opened = []
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.href.startsWith('mailto:')) w.__opened.push(this.href)
      else click.call(this)
    }
    window.open = ((url: string) => (w.__opened.push(url), null)) as typeof window.open
  })
  const opened = () => page.evaluate(() => (window as any).__opened as string[])

  // dans le message : deux destinataires, une copie, un mot d'accompagnement
  await rb(page, 'mm-send-doc')
  const dlg = dialog(page, 'send-doc')
  await expect(dlg.locator('[data-field="send-subject"]')).toHaveValue('Relance')
  await expect(dlg.locator('[data-field="send-format"]')).toBeHidden()
  await dlg.locator('[data-field="send-to"]').fill('ana@exemple.fr, pas-une-adresse')
  await dlg.locator('[data-action="open"]').click()
  await expect(dlg.locator('[data-field="send-error"]')).toContainText('pas-une-adresse')
  await expect(dlg).toBeVisible()
  await dlg.locator('[data-field="send-to"]').fill('ana@exemple.fr; Léo Martin <leo@example.com>')
  await dlg.locator('[data-field="send-cc"]').fill('chef@exemple.fr')
  await dlg.locator('[data-field="send-note"]').fill('Bonjour, voici le compte rendu.')
  await dlg.locator('[data-action="open"]').click()
  await expect.poll(opened).toHaveLength(1)
  const url = (await opened())[0]
  expect(url).toMatch(/^mailto:ana@exemple\.fr,leo@example\.com\?cc=chef%40exemple\.fr&subject=Relance&body=Bonjour%2C%20voici%20le%20compte%20rendu\./)
  expect(decodeURIComponent(url)).toContain('le budget est voté')
  await expect(dlg).toHaveCount(0)

  // en pièce jointe, brouillon .eml : le fichier Folio Pages y est joint
  await rb(page, 'mm-send-doc')
  await dlg.locator('[data-field="send-to"]').fill('ana@exemple.fr')
  await dlg.locator('[data-field="send-content"]').selectOption('attach')
  await expect(dlg.locator('[data-field="send-format"]')).toBeVisible()
  await expect(dlg.locator('[data-field="send-hint"]')).toContainText('pièce jointe')
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-action="eml"]').click()])
  expect(dl.suggestedFilename()).toMatch(/\.eml$/)
  const fs = await import('node:fs')
  const eml = fs.readFileSync((await dl.path())!, 'utf8')
  expect(eml).toContain('To: ana@exemple.fr')
  expect(eml).toContain('X-Unsent: 1')
  expect(eml).toMatch(/Content-Disposition: attachment; filename="[^"]+\.html"/)
  const part = eml.split(/--folio[a-z0-9]+-mix/).find((p) => p.includes('Content-Disposition: attachment'))!
  const html = Buffer.from(part.split('\r\n\r\n')[1].replace(/\s/g, ''), 'base64').toString('utf8')
  expect(html).toContain('id="folio-doc"')
  expect(html).toContain('le budget est voté')
  // le corps dit qu'il y a une pièce jointe (pas de mot d'accompagnement)
  const alt = eml.split(/--folio[a-z0-9]+-alt/)[1]
  expect(Buffer.from(alt.split('\r\n\r\n')[1].replace(/\s/g, ''), 'base64').toString('utf8')).toContain('en pièce jointe')
  await expect(dlg).toHaveCount(0)

  // la messagerie choisie se voit dans le ruban
  await rb(page, 'mm-mail-via')
  await pop(page).locator('[data-mail-via="gmail"]').click()
  await expect(page.locator('.fp-ribbon [data-cmd="mm-mail-via"]')).toContainText('Gmail')

  // un message par destinataire : on choisit d'abord la liste, puis la fenêtre des messages s'ouvre
  await rb(page, 'mm-send-each')
  const need = dialog(page, 'mm-need-list')
  await chooseFile(page, () => need.locator('[data-action="use"]').click(), { name: 'clients.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })
  const emails = dialog(page, 'mm-emails')
  await expect(emails).toBeVisible()
  await expect(emails.locator('[data-field="email-to"]')).toHaveValue('E-mail')
  await expect(emails.locator('[data-field="email-via"]')).toHaveValue('gmail')
  expect((await mm(page)).type).toBe('emails')
  await emails.locator('[data-action="close"]').click()

  // aussi dans le menu Partager
  await page.locator('#fp-share').click()
  await pop(page).locator('[data-share="email"]').click()
  await expect(dlg).toBeVisible()
  errors.check()
})

test('envoyer le document en PDF : l’impression du navigateur, puis le message en un clic', async ({ page }, info) => {
  const errors = watchErrors(page)
  await open(page, info, ['Le budget est voté.'])
  await page.evaluate(() => {
    const w = window as any
    w.__opened = []
    w.__printed = 0
    // l'impression est bloquante dans un vrai navigateur : ici on la compte seulement
    window.print = () => void w.__printed++
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.href.startsWith('mailto:')) w.__opened.push(this.href)
      else click.call(this)
    }
  })
  await rb(page, 'mm-send-doc')
  const dlg = dialog(page, 'send-doc')
  await dlg.locator('[data-field="send-to"]').fill('ana@exemple.fr')
  await dlg.locator('[data-field="send-content"]').selectOption('attach')
  await dlg.locator('[data-field="send-format"]').selectOption('pdf')
  await expect(dlg.locator('[data-field="send-hint"]')).toContainText('Enregistrer au format PDF')
  // un brouillon .eml ne peut pas contenir ce PDF
  await expect(dlg.locator('[data-action="eml"]')).toBeDisabled()
  await dlg.locator('[data-field="send-format"]').selectOption('docx')
  await expect(dlg.locator('[data-action="eml"]')).toBeEnabled()
  await dlg.locator('[data-field="send-format"]').selectOption('pdf')
  await dlg.locator('[data-action="open"]').click()
  await expect(dlg).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toBe(1)
  // le message attend le clic (une messagerie web en a besoin pour s'ouvrir)
  expect(await page.evaluate(() => (window as any).__opened)).toEqual([])
  const notice = page.locator('.fp-toast').filter({ hasText: 'PDF enregistré' })
  await notice.getByRole('button', { name: 'Ouvrir le message' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__opened as string[])).toHaveLength(1)
  const url = (await page.evaluate(() => (window as any).__opened as string[]))[0]
  expect(url).toMatch(/^mailto:ana@exemple\.fr\?subject=Relance&body=/)
  expect(decodeURIComponent(url)).toContain('en pièce jointe')
  errors.check()
})
