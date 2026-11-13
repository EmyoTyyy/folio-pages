// Critère de la phase 1 : une IA remplit un fichier vide, qui s'ouvre sans erreur.
// Les documents ci-dessous sont écrits en suivant uniquement le guide intégré au fichier.

import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { blankHtml, docJson, editor, makeFile, openEditor, watchErrors, writeFile } from './helpers'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')

/** L'exemple minimal tel qu'il est écrit dans le guide du fichier construit. */
function guideExample(): unknown {
  const html = blankHtml()
  const from = html.indexOf('MINIMAL DOCUMENT')
  const to = html.indexOf('BLOCKS', from)
  const section = html.slice(from, to)
  const json = section.slice(section.indexOf('{'), section.lastIndexOf('}') + 1)
  return JSON.parse(json)
}

/** Ce que fait une IA qui suit le guide : remplacer le bloc vide par son JSON, à la main. */
function aiSplice(json: string): string {
  const empty = '<script type="application/folio+json" id="folio-doc"></script>'
  const html = blankHtml()
  expect(html.split(empty)).toHaveLength(2) // une seule occurrence, facile à trouver
  return html.replace(empty, `<script type="application/folio+json" id="folio-doc">\n${json.replace(/</g, '\\u003c')}\n</script>`)
}

test('l’exemple minimal du guide s’ouvre sans aucun signalement', async ({ page }, info) => {
  const errs = watchErrors(page)
  const f = writeFile(info, 'guide.html', aiSplice(JSON.stringify(guideExample(), null, 2)))
  await openEditor(page, f.url)
  await expect(page.locator('#fp-report')).toBeHidden()
  await expect(editor(page).locator('h1')).toHaveText('Weekly report')
  await expect(editor(page).locator('table th').first()).toHaveText('Item')
  await expect(editor(page).locator('ol li')).toHaveCount(2)
  await expect(editor(page).locator('pre')).toHaveText("print('hello')")
  await expect(page).toHaveTitle('Weekly report — Folio Pages')
  await expect(page.locator('#fp-banner')).toBeHidden()
  errs.check()
})

test('un compte rendu écrit par une IA s’ouvre fidèlement', async ({ page }, info) => {
  const errs = watchErrors(page)
  const f = writeFile(info, 'compte-rendu.html', aiSplice(fixture('ai-compte-rendu.json')))
  await openEditor(page, f.url)
  await expect(page.locator('#fp-report')).toBeHidden()
  await expect(editor(page).locator('h1')).toHaveText('Compte rendu – Assemblée du club de randonnée')
  await expect(editor(page).locator('h2')).toHaveCount(5)
  await expect(editor(page).locator('table tr')).toHaveCount(5)
  await expect(editor(page).locator('table tr').last().locator('strong').first()).toHaveText('Solde')
  await expect(editor(page).locator('ul ul li')).toHaveCount(2)
  await expect(editor(page).locator('sup')).toHaveText('er')
  await expect(editor(page).locator('a[href="https://example.org/club"]')).toHaveText('le site du club')
  await expect(editor(page).locator('blockquote')).toContainText('Marcher ensemble')
  const doc = await docJson(page)
  expect(doc.meta.keywords).toEqual(['randonnée', 'assemblée', 'budget'])
  expect(doc.meta.lang).toBe('fr')
  await expect(editor(page)).toHaveAttribute('lang', 'fr')
  errs.check()
})

test('un document entièrement en Markdown s’ouvre, formules comprises', async ({ page }, info) => {
  const f = writeFile(info, 'markdown.html', aiSplice(fixture('ai-markdown.json')))
  await openEditor(page, f.url)
  await expect(page.locator('#fp-report')).toBeHidden()
  await expect(editor(page).locator('h1')).toHaveText('Photosynthesis — revision sheet')
  // La formule est dessinée (MathML), et le document garde son LaTeX.
  await expect(editor(page).locator('.fp-math math')).toHaveCount(1)
  expect(JSON.stringify((await page.evaluate(() => (window as any).folio.doc)).blocks)).toContain('"type":"math","tex":"6CO_2 + 6H_2O \\\\rightarrow C_6H_{12}O_6 + 6O_2"')
  await expect(editor(page).locator('table tr')).toHaveCount(3)
  await expect(editor(page).locator('ol > li')).toHaveCount(3)
  await expect(editor(page).locator('ol ul li sub')).toHaveText('2')
  await expect(editor(page).locator('a[href="https://en.wikipedia.org/wiki/Photosynthesis"]')).toBeVisible()
})

test('un document maladroit s’ouvre quand même, avec un rapport détaillé', async ({ page }, info) => {
  const errs = watchErrors(page)
  const f = makeFile(info, 'maladroit.html', fixture('ai-sloppy.txt'))
  await openEditor(page, f.url)
  const chip = page.locator('#fp-report')
  await expect(chip).toBeVisible()
  await expect(chip).toHaveText(/^Chargé : \d+ champs? ignorés?, \d+ avertissements?$/)
  await expect(page.locator('.fp-toast')).toContainText('Chargé :')
  // Rien n'est perdu : le texte du bloc inconnu et la chaîne simple sont là.
  await expect(editor(page)).toContainText('Texte d\'un bloc inconnu, gardé.')
  await expect(editor(page)).toContainText('Une simple chaîne')
  await expect(editor(page)).toContainText('clic')
  await expect(editor(page).locator('a[href^="javascript"]')).toHaveCount(0)
  await expect(editor(page).locator('h2')).toHaveText('Section')
  await expect(editor(page).locator('h6')).toHaveText('Trop profond')
  await chip.click()
  const dlg = page.locator('dialog[data-dialog="report"]')
  await expect(dlg).toBeVisible()
  await expect(dlg).toContainText('meta.colour')
  await expect(dlg).toContainText('champ inconnu « colour »')
  await expect(dlg).toContainText('lien refusé')
  await expect(dlg).toContainText('niveau de liste corrigé')
  await expect(dlg).toContainText('type de bloc inconnu, converti (callout → paragraph)')
  await page.keyboard.press('Escape')
  await expect(dlg).toHaveCount(0)
  errs.check()
})

test('un « < » non échappé ne casse rien tant qu’il ne ferme pas la balise', async ({ page }, info) => {
  const f = makeFile(info, 'chevron.html', '{"format":"folio/doc","version":1,"blocks":[{"text":"a < b et <b>pas du gras</b>"}]}')
  await openEditor(page, f.url)
  await expect(editor(page)).toContainText('a < b et <b>pas du gras</b>')
  await expect(editor(page).locator('b')).toHaveCount(0)
})

test('« </script> » non échappé : le texte reste récupérable', async ({ page }, info) => {
  const html = blankHtml().replace(
    '<script type="application/folio+json" id="folio-doc"></script>',
    '<script type="application/folio+json" id="folio-doc">{"format":"folio/doc","version":1,"blocks":[{"text":"Avant </script> après"}]}</script>',
  )
  const f = writeFile(info, 'script.html', html)
  await page.goto(f.url)
  await expect(page.locator('[data-screen="broken"]')).toBeVisible()
  await page.locator('[data-action="recover"]').click()
  await expect(editor(page)).toContainText('Avant')
})

test('un fichier rempli par l’outil de la compétence Claude Code s’ouvre sans signalement', async ({ page }, info) => {
  const { execFileSync } = await import('node:child_process')
  const { copyFileSync, writeFileSync } = await import('node:fs')
  const { pathToFileURL } = await import('node:url')
  const helper = fileURLToPath(new URL('../../plugins/folio-pages/skills/folio-pages/fill_folio.py', import.meta.url))
  const file = info.outputPath('competence.html')
  copyFileSync(fileURLToPath(new URL('../../dist/folio-pages.html', import.meta.url)), file)
  const json = info.outputPath('doc.json')
  writeFileSync(json, fixture('ai-compte-rendu.json'))
  execFileSync('python3', [helper, file, json])
  await openEditor(page, pathToFileURL(file).href)
  await expect(page.locator('#fp-report')).toBeHidden()
  await expect(editor(page).locator('h1')).toHaveText('Compte rendu – Assemblée du club de randonnée')

  // --replace garde l'identité du document déjà présent
  const kept = info.outputPath('identite.html')
  copyFileSync(fileURLToPath(new URL('../../dist/folio-pages.html', import.meta.url)), kept)
  writeFileSync(json, JSON.stringify({ format: 'folio/doc', version: 1, id: 'skill-keep-id-01', meta: { title: 'V1', lang: 'fr' }, blocks: ['v1'] }))
  execFileSync('python3', [helper, kept, json])
  writeFileSync(json, JSON.stringify({ format: 'folio/doc', version: 1, id: 'autre-id-123', meta: { title: 'V2', lang: 'fr' }, blocks: ['v2'] }))
  execFileSync('python3', [helper, kept, json, '--replace'])
  await openEditor(page, pathToFileURL(kept).href)
  expect((await docJson(page)).id).toBe('skill-keep-id-01')
  await expect(editor(page)).toHaveText('v2')
})
