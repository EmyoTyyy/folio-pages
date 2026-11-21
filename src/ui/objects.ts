// Insertion → Objet : le texte d'un autre fichier (document Folio Pages, .docx,
// .odt, .rtf, Markdown, texte), ou un fichier joint au document.

import { EditorState } from 'prosemirror-state'
import type { FolioApp } from '../app'
import { docToPM } from '../editor/convert'
import { schema } from '../editor/schema'
import { insertSnippet, selectionContent } from '../editor/snippets'
import { readOpened } from '../file/open'
import { cleanFileName, cleanMime } from '../format/spec'
import type { Key } from '../i18n/dict'
import { fileSize, t } from '../i18n/i18n'
import { toast } from './dialog'
import { popItem } from './popover'
import { pickFile } from './panels'
import { RIBBON_ICONS as I } from './icons'
import { dropdown, type Ctl } from './ribbon'
import { h } from './dom'

/** Taille maximale d'un fichier joint : il voyage dans le fichier HTML (en base64, +33 %). */
export const MAX_ATTACHMENT = 20_000_000

const TEXT_TYPES = '.html,.htm,.docx,.docm,.dotx,.odt,.ott,.rtf,.md,.markdown,.txt,.json'

/** Insertion → Objet → Texte d'un fichier… : son contenu à la place du curseur. */
export async function insertTextFromFile(app: FolioApp, file?: File | null): Promise<void> {
  const picked = file ?? (await pickFile(TEXT_TYPES))
  if (!picked) return
  const o = await readOpened(picked, null)
  if (o.kind !== 'document') {
    const key =
      o.kind === 'encrypted'
        ? 'obj.protected'
        : o.kind === 'too-large'
          ? 'open.tooLarge'
          : o.kind === 'docx-failed'
            ? (`open.docx.${o.code}` as Key)
            : o.kind === 'broken'
              ? 'open.broken'
              : o.kind === 'blank-app'
                ? 'obj.blankApp'
                : 'open.unreadable'
    toast(t(key, { name: picked.name, line: o.kind === 'broken' ? String(o.error.line) : '' }), { kind: 'error', timeout: 9000 })
    return
  }
  const state = EditorState.create({ schema, doc: docToPM(o.doc) })
  const content = selectionContent(state, 0, state.doc.content.size)
  if (!content) {
    toast(t('obj.empty', { name: picked.name }), { kind: 'info' })
    return
  }
  app.run(insertSnippet({ ...content, inline: false }))
  app.focus()
  toast(t('obj.inserted', { name: picked.name }), { kind: 'success' })
}

/** Le contenu d'un fichier en URI data: d'octets bruts (jamais d'un type que le navigateur afficherait). */
function readBytes(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const url = String(r.result)
      resolve('data:application/octet-stream;base64,' + url.slice(url.indexOf(',') + 1))
    }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/** Insertion → Objet → Fichier joint… : une pastille à son nom, ses octets dans le document. */
export async function attachFile(app: FolioApp, file?: File | null): Promise<void> {
  const picked = file ?? (await pickFile(''))
  if (!picked) return
  const name = cleanFileName(picked.name) || 'fichier'
  if (picked.size > MAX_ATTACHMENT) {
    toast(t('obj.tooBig', { name, max: fileSize(MAX_ATTACHMENT) }), { kind: 'error', timeout: 9000 })
    return
  }
  let src: string
  try {
    src = await readBytes(picked)
  } catch {
    toast(t('open.unreadable', { name }), { kind: 'error' })
    return
  }
  const node = schema.nodes.attachment.create({ src, name, size: picked.size, mime: cleanMime(picked.type) })
  app.run((state, dispatch) => {
    dispatch?.(state.tr.replaceSelectionWith(node, false).scrollIntoView())
    return true
  })
  app.focus()
  toast(t('obj.attached', { name, size: fileSize(picked.size) }), { kind: 'success' })
}

/** Le bouton Objet du ruban (onglet Insertion). */
export function objectMenu(app: FolioApp): Ctl {
  return dropdown({
    id: 'insert-object',
    label: t('rb.object'),
    icon: I.object,
    text: () => t('rb.object'),
    menu: () =>
      h(
        'div',
        { class: 'fp-pop__list', role: 'menu' },
        popItem(t('obj.textFromFile'), () => void insertTextFromFile(app), { 'data-item': 'text-from-file' }),
        popItem(t('obj.attach'), () => void attachFile(app), { 'data-item': 'attach-file' }),
      ),
  })
}
