// Outils des tests de bout en bout : ils manipulent le VRAI fichier construit.

import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spliceDocBlock } from '../../src/file/shell'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const BLANK = join(root, 'dist', 'folio-pages.html')
export const blankHtml = () => readFileSync(BLANK, 'utf8')

/** Écrit un fichier de test (l'application vide, éventuellement remplie) et renvoie son adresse. */
export function makeFile(info: TestInfo, name: string, doc: unknown | string | null = null): { path: string; url: string } {
  let html = blankHtml()
  if (doc !== null) {
    const json = typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2)
    html = spliceDocBlock(html, json)!
  }
  const path = info.outputPath(name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, html)
  return { path, url: pathToFileURL(path).href }
}

/** Écrit un fichier tel quel (contenu HTML déjà fabriqué). */
export function writeFile(info: TestInfo, name: string, html: string): { path: string; url: string } {
  const path = info.outputPath(name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, html)
  return { path, url: pathToFileURL(path).href }
}

/** Les erreurs de la page font échouer le test (appeler `check()` à la fin). */
export function watchErrors(page: Page, allow: RegExp[] = []) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !allow.some((r) => r.test(m.text()))) errors.push('console: ' + m.text())
  })
  return { errors, check: () => expect(errors).toEqual([]) }
}

/** Aucune requête réseau : seules les adresses locales sont permises. */
export function watchNetwork(page: Page) {
  const remote: string[] = []
  page.on('request', (r) => {
    if (!/^(file|data|blob|about):/.test(r.url())) remote.push(r.url())
  })
  return { remote, check: () => expect(remote).toEqual([]) }
}

export async function openApp(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.waitForFunction(() => !!(window as any).folio)
}

export async function openEditor(page: Page, url: string): Promise<void> {
  await openApp(page, url)
  await expect(page.locator('.fp-prose')).toBeVisible()
}

export const editor = (page: Page) => page.locator('.fp-prose')
export const status = (page: Page) => page.locator('#fp-status')

export const docJson = (page: Page) => page.evaluate(() => (window as any).folio.doc)

/** Texte de tout le document, depuis window.folio. */
export const docText = (page: Page) =>
  page.evaluate(() => {
    const parts: string[] = []
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (k === 'text' && typeof x === 'string') parts.push(x)
          else walk(x)
        }
      }
    }
    walk((window as any).folio.doc.blocks)
    return parts.join('\n')
  })

/** Place le curseur à la fin du document. */
export async function caretToEnd(page: Page): Promise<void> {
  await editor(page).click()
  await page.keyboard.press('Control+End')
}

export const mod = 'Control'

/**
 * Fausse API File System Access (Chrome) : enregistrements gardés en mémoire
 * dans window.__fs, pour tester l'enregistrement en place de façon déterministe.
 */
export async function installFakeFs(context: BrowserContext | Page): Promise<void> {
  await context.addInitScript(() => {
    const fs = {
      pickerCalls: [] as { suggestedName?: string }[],
      writes: [] as { name: string; text: string }[],
      mode: 'ok' as 'ok' | 'abort' | 'deny-write' | 'fail-write',
      permission: 'granted' as PermissionState,
      requestAnswer: 'granted' as PermissionState,
      files: {} as Record<string, { text: string; lastModified: number }>,
    }
    ;(window as any).__fs = fs
    const handleFor = (name: string) => ({
      kind: 'file',
      name,
      async getFile() {
        const f = fs.files[name] ?? { text: '', lastModified: 0 }
        return new File([f.text], name, { lastModified: f.lastModified })
      },
      async queryPermission() {
        return fs.permission
      },
      async requestPermission() {
        fs.permission = fs.requestAnswer
        return fs.requestAnswer
      },
      async createWritable() {
        if (fs.mode === 'deny-write') throw new DOMException('refusé', 'NotAllowedError')
        let buf = ''
        return {
          async write(data: Blob) {
            if (fs.mode === 'fail-write') throw new Error('disque plein')
            buf += await data.text()
          },
          async close() {
            const prev = fs.files[name]?.lastModified ?? 0
            fs.files[name] = { text: buf, lastModified: Math.max(Date.now(), prev + 1) }
            fs.writes.push({ name, text: buf })
          },
          async abort() {},
        }
      },
    })
    ;(window as any).showSaveFilePicker = async (o: { suggestedName?: string }) => {
      fs.pickerCalls.push({ suggestedName: o?.suggestedName })
      if (fs.mode === 'abort') throw new DOMException('annulé', 'AbortError')
      return handleFor(o?.suggestedName ?? 'document.html')
    }
  })
}

/** Simule un navigateur sans File System Access (Chrome → chemin « téléchargement »). */
export async function removeFsAccess(context: BrowserContext | Page): Promise<void> {
  await context.addInitScript(() => {
    delete (window as any).showSaveFilePicker
  })
}

export const fsState = (page: Page) => page.evaluate(() => (window as any).__fs)

/** Enregistre par Ctrl+S et attend le téléchargement ; renvoie le texte du fichier téléchargé. */
export async function saveByDownload(page: Page, info: TestInfo, name: string): Promise<{ path: string; url: string; html: string; suggested: string }> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${mod}+s`)])
  const path = info.outputPath(name)
  await download.saveAs(path)
  const html = readFileSync(path, 'utf8')
  return { path, url: pathToFileURL(path).href, html, suggested: download.suggestedFilename() }
}

/** Extrait et lit le JSON du bloc #folio-doc d'un fichier. */
export function docOfFile(html: string): any {
  const m = /<script type="application\/folio\+json" id="folio-doc">([\s\S]*?)<\/script>/.exec(html)
  if (!m) throw new Error('bloc #folio-doc introuvable')
  return JSON.parse(m[1])
}

// --- phase 2 : ruban et sélection ------------------------------------------------

/** Ouvre un onglet du ruban. */
export async function tab(page: Page, id: string): Promise<void> {
  await page.locator(`.fp-ribbon__tab[data-tab="${id}"]`).click()
}

/** Clique une commande du ruban (dans l'onglet visible). */
export async function rb(page: Page, cmd: string): Promise<void> {
  await page.locator(`.fp-ribbon [data-cmd="${cmd}"]`).first().click()
}

/** Sélectionne la n-ième occurrence d'un texte dans la page, comme à la souris. */
export async function selectText(page: Page, text: string, occurrence = 0, collapseToEnd = false): Promise<void> {
  // L'éditeur remet sa propre sélection 20 ms après avoir reçu le focus : on attend avant de sélectionner.
  // Toujours attendre : le focus peut avoir été rendu à l'éditeur juste avant (fermeture d'une fenêtre).
  await page.evaluate(() => (document.querySelector('.fp-prose') as HTMLElement).focus())
  await page.waitForTimeout(60)
  await page.evaluate(
    ([needle, occ, collapse]) => {
      const root = document.querySelector('.fp-prose') as HTMLElement
      root.focus()
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node: Node | null
      let seen = 0
      while ((node = walker.nextNode())) {
        const i = node.textContent!.indexOf(needle as string)
        if (i >= 0 && seen++ === occ) {
          const r = document.createRange()
          r.setStart(node, collapse ? i + (needle as string).length : i)
          r.setEnd(node, i + (needle as string).length)
          const s = getSelection()!
          s.removeAllRanges()
          s.addRange(r)
          return
        }
      }
      throw new Error(`texte introuvable : ${needle}`)
    },
    [text, occurrence, collapseToEnd] as const,
  )
  // L'éditeur lit la sélection du navigateur à l'événement selectionchange.
  await page.waitForTimeout(80)
}

/** Place le curseur juste après un texte (sans touche fléchée : dans un tableau, elle changerait de cellule). */
export async function caretAfter(page: Page, text: string): Promise<void> {
  await selectText(page, text, 0, true)
}

/** Blocs du document courant. */
export const blocks = (page: Page) => page.evaluate(() => (window as any).folio.doc.blocks)

/** PNG uni de w × h pixels, fabriqué sans bibliothèque (zlib + CRC des blocs). */
export function makePng(w: number, h: number, rgb: [number, number, number] = [200, 40, 40]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // profondeur
  ihdr[9] = 2 // RVB
  const row = Buffer.alloc(1 + w * 3)
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export function pngDataUri(w: number, h: number, rgb?: [number, number, number]): string {
  return `data:image/png;base64,${makePng(w, h, rgb).toString('base64')}`
}

/** Choisit un fichier dans la boîte de dialogue d'ouverture déclenchée par `trigger`. */
export async function chooseFile(page: Page, trigger: () => Promise<void>, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()])
  await chooser.setFiles(file)
}

/** Version de l'application (celle de package.json, injectée à la construction). */
export const APP_VERSION: string = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
