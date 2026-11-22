// Phase 5 : compatibilité .docx. Import (Ctrl+O, dépôt), export (menu Fichier),
// module chargé à la demande, messages. Le fichier exporté est relu ici par le
// même code d'import, et par ses parties XML.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { expect, test, type Download, type Page } from '@playwright/test'
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate'
import { importDocx } from '../../src/docx/import'
import { BLANK, blankHtml, docJson, editor, installFakeFs, fsState, makeFile, mod, openEditor, watchErrors, writeFile } from './helpers'

const FIXTURES = join(dirname(BLANK), '..', 'tests', 'fixtures', 'docx')
const fixture = (name: string) => readFileSync(join(FIXTURES, name))
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Sans File System Access : le sélecteur classique et les téléchargements (comme Firefox et Safari). */
async function plainBrowser(page: Page) {
  await page.addInitScript(() => {
    delete (window as any).showOpenFilePicker
    delete (window as any).showSaveFilePicker
  })
}

async function openFile(page: Page, name: string, buffer: Buffer, mimeType = DOCX) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press(`${mod}+o`)])
  await chooser.setFiles({ name, mimeType, buffer })
}

async function exportDocx(page: Page): Promise<Download> {
  await page.locator('[data-menu="file"]').click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-menu-popup="file"] [data-item="export-docx"]').click()])
  return download
}

async function bytesOf(download: Download): Promise<Uint8Array> {
  const path = await download.path()
  return new Uint8Array(readFileSync(path!))
}

const textOf = (blocks: any[]): string => {
  let s = ''
  const inl = (items: any[]) => items.forEach((x) => (x.type === 'note' ? walk(x.blocks) : (s += x.text ?? '')))
  const walk = (bs: any[]) =>
    bs.forEach((b) => {
      if (b.content) inl(b.content)
      if (b.type === 'list') b.items.forEach((i: any) => inl(i.content))
      if (b.blocks) walk(b.blocks)
      if (b.rows) b.rows.forEach((r: any[]) => r.forEach((c) => walk(c.blocks)))
      if (b.text) s += b.text
      if (b.caption) inl(b.caption)
      s += '\n'
    })
  walk(blocks)
  return s
}

test.describe('importer un .docx', () => {
  test('Ctrl+O : un rapport s’ouvre mis en forme, comme un nouveau document à enregistrer', async ({ page }, info) => {
    const errs = watchErrors(page)
    await plainBrowser(page)
    await openEditor(page, makeFile(info, 'courant.html', { format: 'folio/doc', version: 1, id: 'courant-0001', blocks: ['Texte courant.'] }).url)
    // Le module .docx n'est pas chargé tant qu'on n'en a pas besoin.
    expect(await page.evaluate(() => typeof (window as any).FolioDocx)).toBe('undefined')
    await openFile(page, 'rapport.docx', fixture('rapport.docx'))
    // L'annexe en paysage garde sa mise en page : plus rien n'est perdu.
    await expect(page.locator('.fp-toast').last()).toContainText('importé')
    await expect(page.locator('.fp-toast').last()).not.toContainText('avertissement')
    expect(await page.evaluate(() => typeof (window as any).FolioDocx)).toBe('object')
    const d = await docJson(page)
    expect(d.id).not.toBe('courant-0001')
    expect(d.meta.title).toBe("Rapport d'activité 2025")
    await expect(page.locator('#fp-title')).toHaveValue("Rapport d'activité 2025")
    expect(d.blocks.filter((b: any) => b.type === 'heading').map((h: any) => h.content[0].text)).toEqual(['Résumé', 'Activités', 'Stages', 'Calendrier', 'Chiffres', 'Atelier en image', 'Annexe'])
    // À l'écran : titres, tableau, image, liste, en-tête et pied de page.
    await expect(editor(page).locator('h1').first()).toHaveText('Résumé')
    await expect(editor(page).locator('table')).toHaveCount(2)
    await expect(editor(page).locator('img')).toHaveCount(1)
    expect(await editor(page).locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(120)
    await expect(editor(page).locator('ul > li').first()).toHaveText('Menuiserie')
    await expect(page.locator('.fp-hf-zone--header').first()).toContainText('Atelier des Tilleuls')
    await expect(page.locator('.fp-hf-zone--footer').first()).toContainText(/Page 1 sur \d/)
    // L'annexe en paysage : une section avec sa propre mise en page.
    expect(d.blocks.find((b: any) => b.type === 'section')).toMatchObject({ page: { orientation: 'landscape' } })
    // Pas encore un fichier Folio Pages : l'enregistrer propose « rapport.html », le .docx n'est pas touché.
    await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'dirty')
    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${mod}+s`)])
    expect(download.suggestedFilename()).toBe('rapport.html')
    // Annuler ne ramène pas le document précédent.
    await editor(page).click()
    await page.keyboard.press(`${mod}+z`)
    expect((await docJson(page)).meta.title).toBe("Rapport d'activité 2025")
    errs.check()
  })

  for (const name of ['lettre.docx', 'cv.docx', 'compte-rendu.docx']) {
    test(`${name} s’ouvre sans erreur, tout son texte à l’écran`, async ({ page }, info) => {
      const errs = watchErrors(page)
      await plainBrowser(page)
      await openEditor(page, makeFile(info, 'courant.html', { format: 'folio/doc', version: 1, id: 'courant-0001', blocks: ['Texte courant.'] }).url)
      await openFile(page, name, fixture(name))
      await expect.poll(async () => (await docJson(page)).id).not.toBe('courant-0001')
      const d = await docJson(page)
      const expected = importDocx(new Uint8Array(fixture(name))).doc.blocks as any[]
      expect(d.blocks.map((b: any) => b.type)).toEqual(expected.map((b) => b.type))
      // Le texte du document est celui que l'éditeur affiche (mots dans l'ordre, hors notes et champs).
      const shown = (await editor(page).innerText()).replace(/\s+/g, ' ')
      for (const b of d.blocks) {
        if (b.type !== 'paragraph' && b.type !== 'heading') continue
        for (const r of b.content) if (r.text && !r.deleted && r.text.trim().length > 3) expect(shown).toContain(r.text.replace(/\s+/g, ' ').trim())
      }
      await expect(page.locator('#fp-pages')).toContainText(/\d/)
      errs.check()
    })
  }

  test('le compte rendu : notes, commentaires, suivi, colonnes, et la liste de ce qui manque', async ({ page }, info) => {
    await plainBrowser(page)
    await openEditor(page, makeFile(info, 'courant.html', { format: 'folio/doc', version: 1, id: 'courant-0001', blocks: ['Texte courant.'] }).url)
    await openFile(page, 'compte-rendu.docx', fixture('compte-rendu.docx'))
    // (L'équation du fichier est maintenant une vraie formule, la zone de texte une vraie zone de texte : deux signalements de moins.)
    await expect(page.locator('.fp-toast').last()).toContainText('4 avertissements')
    await expect(editor(page).locator('.fp-shape[data-shape="textBox"]')).toContainText('la réunion suivante est le 14 mai')
    await expect(editor(page).locator('.fp-note-ref, [data-note]').first()).toBeVisible()
    await expect(editor(page).locator('.fp-ins, ins').first()).toContainText('nouveau')
    await expect(editor(page).locator('.fp-del, del').first()).toContainText('provisoire')
    await expect(editor(page).locator('.fp-toc, [data-toc]').first()).toContainText('Décisions')
    await expect(page.locator('#fp-track')).toBeVisible()
    const d = await docJson(page)
    expect(d.comments.map((c: any) => [c.author, c.resolved, c.replies.length])).toEqual([['Marc Aubry', true, 1], ['Marc Aubry', false, 0]])
    await page.locator('.fp-toast').last().getByRole('button', { name: 'Détails' }).click()
    const report = page.locator('[data-dialog="report"]')
    for (const msg of ['1 passage de texte masqué', 'EMF, WMF, TIFF', 'numéros automatiques de 2 titres', 'police de symboles']) await expect(report).toContainText(msg)
    // Rien de dangereux n'est entré.
    expect(JSON.stringify(d)).not.toContain('javascript:')
    expect(await page.locator('.fp-prose a[href^="javascript"]').count()).toBe(0)
  })

  test('déposer un .docx sur la page l’importe', async ({ page }, info) => {
    await openEditor(page, makeFile(info, 'courant.html', { format: 'folio/doc', version: 1, id: 'courant-0001', blocks: ['Texte courant.'] }).url)
    const b64 = fixture('lettre.docx').toString('base64')
    await page.evaluate(
      ([data, type]) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
        const dt = new DataTransfer()
        dt.items.add(new File([bytes], 'lettre.docx', { type }))
        for (const kind of ['dragenter', 'dragover', 'drop']) document.querySelector('.fp-prose')!.dispatchEvent(new DragEvent(kind, { dataTransfer: dt, bubbles: true, cancelable: true }))
      },
      [b64, DOCX] as const,
    )
    await expect.poll(async () => (await docJson(page)).meta.title).toBe('Lettre aux adhérents')
    await expect(page.locator('.fp-toast').last()).toContainText('importé')
  })

  test('ce qui n’est pas un .docx lisible : un message clair, le document reste', async ({ page }, info) => {
    const errs = watchErrors(page)
    await plainBrowser(page)
    await openEditor(page, makeFile(info, 'courant.html', { format: 'folio/doc', version: 1, id: 'courant-0001', blocks: ['Texte courant.'] }).url)
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(600).fill(0)])
    const good = fixture('lettre.docx')
    const cases: [string, Buffer, RegExp][] = [
      ['ancien.doc', ole, /ancien fichier \.doc, ou un fichier protégé par mot de passe/],
      ['protege.docx', ole, /protégé par mot de passe/],
      ['texte.docx', Buffer.from('Ceci est du texte renommé en .docx'), /n’est pas un fichier \.docx lisible/],
      ['tableur.docx', Buffer.from(zipSync({ 'xl/workbook.xml': strToU8('<workbook/>') })), /n’est pas un document \.docx/],
      ['coupe.docx', good.subarray(0, 4000), /abîmé/],
      ['vide.docx', Buffer.alloc(0), /n’est pas un fichier \.docx lisible/],
    ]
    for (const [name, buffer, msg] of cases) {
      await openFile(page, name, buffer)
      await expect(page.locator('.fp-toast').last()).toContainText(msg)
      expect((await docJson(page)).id).toBe('courant-0001')
    }
    errs.check()
  })

  test('modifications non enregistrées : on propose d’enregistrer avant d’importer', async ({ page }, info) => {
    await plainBrowser(page)
    await openEditor(page, makeFile(info, 'courant.html', { format: 'folio/doc', version: 1, id: 'courant-0001', blocks: ['Texte courant.'] }).url)
    await editor(page).click()
    await page.keyboard.type('modifié ')
    await openFile(page, 'cv.docx', fixture('cv.docx'))
    await expect(page.locator('[data-dialog="save-first"]')).toBeVisible()
    await page.locator('[data-dialog="save-first"] [data-action="cancel"]').click()
    expect((await docJson(page)).id).toBe('courant-0001')
  })
})

test.describe('exporter en .docx', () => {
  test('le document de démonstration : un .docx téléchargé, complet, qui se relit', async ({ page }) => {
    const errs = watchErrors(page)
    await plainBrowser(page)
    await openEditor(page, pathToFileURL(BLANK).href)
    const before = await docJson(page)
    const download = await exportDocx(page)
    expect(download.suggestedFilename()).toMatch(/\.docx$/)
    const bytes = await bytesOf(download)
    const files = unzipSync(bytes)
    for (const part of ['word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/footnotes.xml', 'word/comments.xml', '[Content_Types].xml']) expect(Object.keys(files)).toContain(part)
    // Le logo vectoriel est converti par le navigateur : le dessin, et une image de repli.
    const media = Object.keys(files).filter((k) => k.startsWith('word/media/'))
    expect(media.some((m) => m.endsWith('.svg'))).toBe(true)
    const png = media.find((m) => m.endsWith('.png'))!
    expect([...files[png].slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(files[png].length).toBeGreaterThan(200)
    // Seule la coloration du code ne passe pas, et c'est dit.
    await expect(page.locator('.fp-toast').last()).toContainText('1 point ne passe pas tel quel')
    await page.locator('.fp-toast').last().getByRole('button', { name: 'Détails' }).click()
    await expect(page.locator('[data-dialog="docx-losses"] [data-loss]')).toHaveCount(1)
    await expect(page.locator('[data-dialog="docx-losses"] [data-loss="code-colors"]')).toContainText('coloration')
    await page.keyboard.press('Escape')
    // Relu : mêmes blocs, même texte ; la table des matières porte les numéros de page.
    const back = importDocx(bytes)
    expect(back.losses).toEqual([])
    expect((back.doc.blocks as any[]).map((b) => b.type)).toEqual(before.blocks.map((b: any) => b.type))
    expect(textOf(back.doc.blocks as any[])).toBe(textOf(before.blocks))
    const body = strFromU8(files['word/document.xml'])
    expect(body).toMatch(/<w:pStyle w:val="TOC\d"\/>[\s\S]*?<w:tab\/><w:t[^>]*>\d+</)
    expect(body).not.toContain('w:dirty="true"')
    // L'export ne modifie pas le document, ni son état d'enregistrement.
    expect(await docJson(page)).toEqual(before)
    await expect(page.locator('#fp-status')).toHaveAttribute('data-state', 'pristine')
    errs.check()
  })

  test('avec le choix de l’emplacement (Chrome, Edge) : écrit là, sous le nom du document ; annuler ne fait rien', async ({ page }, info) => {
    await installFakeFs(page)
    await page.addInitScript(() => {
      // Le faux disque garde aussi les octets des fichiers binaires.
      const real = (window as any).showSaveFilePicker
      ;(window as any).showSaveFilePicker = async (o: any) => {
        const h = await real(o)
        ;(window as any).__picked = { name: o?.suggestedName, types: o?.types }
        return {
          ...h,
          async createWritable() {
            return {
              async write(data: Blob) {
                ;(window as any).__bytes = Array.from(new Uint8Array(await data.arrayBuffer()))
              },
              async close() {},
            }
          },
        }
      }
    })
    await openEditor(page, makeFile(info, 'note.html', { format: 'folio/doc', version: 1, id: 'export-00001', meta: { title: 'Note de service' }, blocks: [{ type: 'heading', level: 1, content: ['Objet'] }, 'Bonjour à tous.'] }).url)
    await page.locator('[data-menu="file"]').click()
    await page.locator('[data-menu-popup="file"] [data-item="export-docx"]').click()
    await expect(page.locator('.fp-toast').last()).toContainText('Exporté : note.docx')
    const picked = await page.evaluate(() => (window as any).__picked)
    expect(picked.name).toBe('note.docx')
    expect(Object.values(picked.types[0].accept)[0]).toEqual(['.docx'])
    const bytes = new Uint8Array(await page.evaluate(() => (window as any).__bytes))
    const back = importDocx(bytes)
    expect((back.doc.meta as any).title).toBe('Note de service')
    expect(textOf(back.doc.blocks as any[])).toBe('Objet\nBonjour à tous.\n')
    // Le fichier .html du document n'est pas réécrit par un export.
    expect((await fsState(page)).writes).toEqual([])
    await page.evaluate(() => ((window as any).__fs.mode = 'abort'))
    const toasts = await page.locator('.fp-toast').count()
    await page.locator('[data-menu="file"]').click()
    await page.locator('[data-menu-popup="file"] [data-item="export-docx"]').click()
    await page.waitForTimeout(400)
    expect(await page.locator('.fp-toast').count()).toBeLessThanOrEqual(toasts)
  })

  test('aller-retour dans le navigateur : importer, modifier, exporter, relire', async ({ page }, info) => {
    const errs = watchErrors(page)
    await plainBrowser(page)
    await openEditor(page, makeFile(info, 'courant.html', { format: 'folio/doc', version: 1, id: 'courant-0001', blocks: ['Texte courant.'] }).url)
    await openFile(page, 'compte-rendu.docx', fixture('compte-rendu.docx'))
    await expect.poll(async () => (await docJson(page)).meta.title).toBe('Compte rendu & décisions')
    await editor(page).locator('p', { hasText: 'Fin du compte rendu.' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Relu et approuvé.')
    const before = await docJson(page)
    const bytes = await bytesOf(await exportDocx(page))
    const back = importDocx(bytes)
    expect(back.losses).toEqual([])
    const blocks = back.doc.blocks as any[]
    expect(blocks.map((b) => b.type)).toEqual(before.blocks.map((b: any) => b.type))
    expect(textOf(blocks)).toBe(textOf(before.blocks))
    expect(textOf(blocks)).toContain('Fin du compte rendu. Relu et approuvé.')
    // Le suivi était actif : la phrase tapée est un ajout, et le reste aussi après export.
    const last = blocks[blocks.length - 1].content
    expect(last[last.length - 1]).toMatchObject({ text: ' Relu et approuvé.', inserted: {} })
    expect((back.doc.comments as any[]).map((c) => [c.author, c.resolved, c.replies.length])).toEqual([['Marc Aubry', true, 1], ['Marc Aubry', false, 0]])
    expect(back.doc.trackChanges).toBe(true)
    errs.check()
  })

  test('le module .docx voyage avec le document enregistré', async ({ page }, info) => {
    await plainBrowser(page)
    await openEditor(page, makeFile(info, 'note.html', { format: 'folio/doc', version: 1, id: 'voyage-00001', meta: { title: 'Voyage' }, blocks: ['Un texte.'] }).url)
    const html: string = await page.evaluate(() => (window as any).folio.serialize())
    expect(html).toContain('id="folio-rt-docx"')
    // Le module chargé n'a rien laissé dans le fichier (ni script en clair, ni variable).
    await exportDocx(page)
    const after: string = await page.evaluate(() => (window as any).folio.serialize())
    expect(after.length).toBe(html.length)
    expect(after).not.toContain('folio-pages-docx.js')
    const saved = writeFile(info, 'enregistre.html', after)
    await openEditor(page, saved.url)
    const back = importDocx(await bytesOf(await exportDocx(page)))
    expect(textOf(back.doc.blocks as any[])).toBe('Un texte.\n')
  })

  test('fichier privé de son module .docx : c’est dit, à l’export comme à l’import', async ({ page }, info) => {
    await plainBrowser(page)
    const html = blankHtml().replace(/<script id="folio-rt-docx"[^>]*>[^<]*<\/script>\s*/, '')
    expect(html).not.toContain('folio-rt-docx"')
    const doc = JSON.stringify({ format: 'folio/doc', version: 1, id: 'sans-module1', blocks: ['Un texte.'] })
    const file = writeFile(info, 'sans-module.html', html.replace(/(<script type="application\/folio\+json" id="folio-doc">)(<\/script>)/, `$1${doc}$2`))
    await openEditor(page, file.url)
    await page.locator('[data-menu="file"]').click()
    await page.locator('[data-menu-popup="file"] [data-item="export-docx"]').click()
    await expect(page.locator('.fp-toast').last()).toContainText('module .docx de ce fichier est illisible')
    await openFile(page, 'lettre.docx', fixture('lettre.docx'))
    await expect(page.locator('.fp-toast').last()).toContainText('module .docx de ce fichier est illisible')
    expect((await docJson(page)).id).toBe('sans-module1')
  })

  test('en anglais : menu et messages traduits', async ({ page }, info) => {
    await plainBrowser(page)
    await page.addInitScript(() => localStorage.setItem('folio-pages:lang', 'en'))
    await openEditor(page, makeFile(info, 'note.html', { format: 'folio/doc', version: 1, id: 'anglais-0001', blocks: [{ type: 'code', language: 'js', text: 'let a = 1' }] }).url)
    await page.locator('[data-menu="file"]').click()
    await expect(page.locator('[data-menu-popup="file"] [data-item="export-docx"]')).toHaveText(/Export as \.docx…/)
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-menu-popup="file"] [data-item="export-docx"]').click()])
    expect(download.suggestedFilename()).toBe('note.docx')
    await expect(page.locator('.fp-toast').last()).toContainText('1 thing does not carry over to .docx as is')
    await openFile(page, 'old.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(600).fill(0)]))
    await expect(page.locator('.fp-toast').last()).toContainText('old .doc file')
  })
})
