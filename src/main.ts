// Démarrage de Folio Pages.
//
// Ordre imposé : 1) cloner le fichier tel quel (avant toute modification du
// DOM), 2) lire le bloc #folio-doc, 3) monter l'éditeur ou un écran
// d'explication, 4) publier window.folio, 5) retirer l'écran de chargement.
// Toute erreur imprévue aboutit à un écran lisible, jamais à une page blanche.

import 'prosemirror-view/style/prosemirror.css'
import 'prosemirror-tables/style/tables.css'
import 'prosemirror-gapcursor/style/gapcursor.css'
import './fonts/fonts.css'
import './ui/styles.css'

import { publishApi, publishRefusal } from './api'
import { FolioApp, type AppInit } from './app'
import { demoDocument } from './demo/demo'
import { loadDocument } from './format/load'
import { recoverText } from './format/recover'
import { makeDoc } from './format/doc'
import { mintId } from './format/types'
import { baseLang, detectLang, lang, setLang, t } from './i18n/i18n'
import { applyAppearance } from './settings'
import { capturePristine, readDocBlock } from './file/shell'
import { reportDialog, reportSummary } from './ui/actions'
import { buildChrome } from './ui/chrome'
import { toast } from './ui/dialog'
import { brokenScreen, fatalScreen, refusedScreen, unlockScreen } from './ui/screens'
import { decryptEnvelope, parseEnvelope } from './file/crypto'
import { publishLocked } from './api'
import { loadPacks } from './ui/packs'
import { announceUpdate } from './ui/updates'

function dismissSplash(): void {
  const s = document.getElementById('folio-splash')
  if (!s) return
  s.classList.add('done')
  setTimeout(() => s.remove(), 400)
}

/** Identité d'un document illisible : on la garde si on la retrouve (jamais régénérée sans raison). */
function salvageId(raw: string): string {
  const m = /"id"\s*:\s*"([A-Za-z0-9_-]{6,64})"/.exec(raw)
  return m ? m[1] : mintId()
}

function start(init: AppInit): FolioApp {
  const chrome = buildChrome()
  document.body.appendChild(chrome.root)
  const app = new FolioApp(init, chrome.editorMount)
  chrome.attach(app)
  publishApi(app)
  const summary = reportSummary(init.report)
  if (summary) toast(summary, { kind: 'warning', action: { label: t('action.details'), run: () => reportDialog(app) } })
  if (init.boot !== 'recovered-text') void app.checkRecovery()
  announceUpdate()
  // Document fusionné ouvert pour être imprimé (Publipostage → Imprimer des documents).
  if (location.hash === '#print') setTimeout(() => window.print(), 1500)
  return app
}

function boot(): void {
  capturePristine()
  // Les paquets de langue (du fichier et du navigateur) avant de choisir la langue.
  loadPacks()
  setLang(detectLang(), false)
  const raw = readDocBlock()
  applyAppearance()
  document.documentElement.lang = lang()

  if (raw === null || raw === '') {
    start({ doc: demoDocument(baseLang()), boot: 'blank', report: null })
    return
  }

  // Document protégé : l'écran de mot de passe, puis le document déchiffré.
  const env = parseEnvelope(raw)
  if (env) {
    publishLocked()
    unlockScreen(async (password) => {
      const json = await decryptEnvelope(env, password)
      if (json === null) return false
      const r = loadDocument(json)
      if (!r.ok) {
        toast(t('unlock.damaged'), { kind: 'error' })
        return false
      }
      try {
        start({ doc: r.doc, boot: 'document', report: r.report, readOnly: r.doc.readOnly, password })
      } catch (e) {
        fatalScreen(e instanceof Error ? e.message : String(e), null)
      }
      return true
    })
    return
  }

  const res = loadDocument(raw)
  if (res.ok) {
    if (res.doc.template) {
      // Un modèle : chaque ouverture commence un nouveau document (nouvelle identité, nouveau fichier).
      const now = new Date().toISOString()
      const doc = { ...res.doc, id: mintId(), template: false, readOnly: false, meta: { ...res.doc.meta, created: now, modified: '' } }
      const app = start({ doc, boot: 'template', report: res.report, templateId: res.doc.id })
      toast(t('template.opened'), { kind: 'info', timeout: 10000, action: { label: t('template.edit'), run: () => app.editTemplate() } })
      return
    }
    start({ doc: res.doc, boot: 'document', report: res.report, readOnly: res.doc.readOnly })
    return
  }

  if (res.reason === 'json') {
    publishRefusal('json')
    brokenScreen(res.error, raw, {
      recover: () => {
        const found = recoverText(raw)
        const doc = makeDoc({ id: salvageId(raw), meta: { title: found.title, created: new Date().toISOString() }, blocks: found.blocks })
        start({ doc, boot: 'recovered-text', report: null })
        toast(t('broken.recovered', { n: found.count }), { kind: 'warning', timeout: 9000 })
      },
      blank: () => {
        const doc = makeDoc({ id: salvageId(raw), meta: { created: new Date().toISOString() } })
        start({ doc, boot: 'recovered-text', report: null })
      },
    })
    return
  }

  publishRefusal(res.reason)
  refusedScreen(res.reason, raw, res.reason === 'too-large' ? res.size : 0)
}

try {
  boot()
} catch (e) {
  console.error(e)
  // Si l'application a déjà été publiée, l'erreur est survenue après son démarrage.
  if (!window.folio) publishRefusal('fatal')
  let raw: string | null = null
  try {
    raw = readDocBlock()
  } catch {
    raw = null
  }
  fatalScreen(e instanceof Error ? e.message : String(e), raw)
} finally {
  dismissSplash()
}
