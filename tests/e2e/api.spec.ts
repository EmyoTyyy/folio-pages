// Contrat window.folio, utilisé par les scripts et les IA dans un fichier ouvert.

import { expect, test } from '@playwright/test'
import { docOfFile, editor, makeFile, openEditor, APP_VERSION } from './helpers'

test('window.folio : doc, serialize, loadDoc, schema, i18n', async ({ page }, info) => {
  const f = makeFile(info, 'api.html', { format: 'folio/doc', version: 1, id: 'api-doc-0001', meta: { title: 'API' }, blocks: ['un'] })
  await openEditor(page, f.url)

  const res = await page.evaluate(() =>
    (window as any).folio.loadDoc({ format: 'folio/doc', version: 1, blocks: [{ type: 'heading', text: 'Chargé par script' }, { type: 'h2', text: 'alias' }, { zut: 1 }] }),
  )
  expect(res).toMatchObject({ ok: true, ignored: 1, warnings: 1 })
  await expect(editor(page).locator('h1')).toHaveText('Chargé par script')
  expect(await page.evaluate(() => (window as any).folio.doc.id)).toBe('api-doc-0001')
  expect(await page.evaluate(() => (window as any).folio.dirty)).toBe(true)

  const bad = await page.evaluate(() => (window as any).folio.loadDoc('{"blocks": [1,]'))
  expect(bad).toMatchObject({ ok: false, reason: 'json', line: 1 })

  const html = await page.evaluate(() => (window as any).folio.serialize())
  expect(docOfFile(html).blocks[0]).toEqual({ type: 'heading', level: 1, content: [{ text: 'Chargé par script' }] })

  const schema = await page.evaluate(() => (window as any).folio.schema())
  expect(schema.$defs.Block.oneOf.map((v: any) => v.properties.type.const)).toEqual(['paragraph', 'heading', 'list', 'quote', 'callout', 'code', 'table', 'divider', 'chart', 'diagram', 'equation', 'pagebreak', 'columns', 'columnbreak', 'toc', 'figures', 'index', 'authorities', 'bibliography', 'glossary', 'abbreviations', 'section', 'image'])
  expect(JSON.stringify(schema.$defs.Inline)).toContain('"note"')
  expect(JSON.stringify(schema.$defs.Inline)).toContain('"math"')
  expect(schema.properties.notes.properties.foot.properties.format.enum).toContain('symbols')

  const compact = await page.evaluate(() => (window as any).folio.compact())
  expect(compact.blocks[0]).toEqual({ type: 'heading', text: 'Chargé par script' })

  await page.evaluate(() => (window as any).folio.i18n.setLang('en'))
  await expect(page.locator('[data-menu="file"]')).toHaveText('File')
  expect(await page.evaluate(() => (window as any).folio.i18n.t('menu.save'))).toBe('Save')
  expect(await page.evaluate(() => (window as any).folio.version)).toBe(APP_VERSION)
})
