// Mises à jour signées (phase 7, CLAUDE.md 4.9), reprises de Bento
// (kernel/src/update.ts, MIT, © 2026 The Bento authors).
//
// « Mettre à jour ce fichier » remplace le code de l'application en gardant
// le document intact. Chaîne de confiance :
//   1. le manifeste de version est SIGNÉ (ECDSA P-256 / SHA-256) avec une clé
//      gardée hors ligne ; la clé publique est écrite ici, dans chaque fichier ;
//   2. le manifeste donne l'empreinte SHA-256 du nouveau fichier ; ce qui est
//      téléchargé doit avoir exactement cette empreinte ;
//   3. seule une version plus récente est proposée (jamais de retour en arrière).
// Un hébergement ou un dépôt compromis ne peut donc pas imposer de code.
//
// Rien ne part sur le réseau sans un geste de l'utilisateur, et rien en mode
// hors ligne (net.ts). La requête ne porte aucun identifiant.

import { isOffline, netFetch, OfflineError } from './net'
import { extractDocBlock, spliceDocBlock } from './file/shell'

export const APP_ID = 'folio-pages'
export const APP_VERSION: string = __FOLIO_VERSION__

/** Où les fichiers cherchent la dernière version. */
export const MANIFEST_URL = 'https://emyotyyy.github.io/folio-pages/release.json'

/**
 * Clé publique de signature des versions. La clé privée est gardée hors ligne
 * (scripts/keygen.mjs → ~/.folio-pages/release-key.json) et signe le
 * manifeste (scripts/sign-release.mjs). Changer cette clé rend orphelins tous
 * les fichiers déjà distribués : il faut garder la clé privée, pas la remplacer.
 */
export const RELEASE_KEY: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'XtyQA9dhJWIAWdAeJnTrYiRTqJ5K6ylXhGG_ToHPZzM',
  y: '_M6hAkwbrF9fGYGkXFioy92_nrx6XDT3QQvmbe6JTzo',
}

export interface ReleaseInfo {
  app: string
  version: string
  /** Empreinte SHA-256 (hexadécimal) du nouveau fichier. */
  sha256: string
  /** Adresse https du nouveau fichier (application vide). */
  url: string
  /** Notes de version, par langue. */
  notes?: Record<string, string[]>
  at?: string
}

export type UpdateCheck = { status: 'current'; version: string } | { status: 'update'; release: ReleaseInfo } | { status: 'offline' } | { status: 'error'; message: string }

/** Comparaison de versions 1.2.3 ; positive si a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

const b64ToBytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
export const sha256Hex = async (bytes: BufferSource): Promise<string> => hex(await crypto.subtle.digest('SHA-256', bytes))

/**
 * Vérifie une enveloppe signée { payload: "<json>", sig: "<base64>" } : la
 * signature porte sur les octets UTF-8 exacts de `payload`. Lève une erreur
 * à la moindre anomalie ; renvoie le contenu lu.
 */
export async function verifySigned(raw: string, key: JsonWebKey = RELEASE_KEY): Promise<unknown> {
  if (raw.length > 1_000_000) throw new Error('manifest too large')
  let payload: unknown
  let sig: unknown
  try {
    ;({ payload, sig } = JSON.parse(raw))
  } catch {
    throw new Error('manifest is not JSON')
  }
  if (typeof payload !== 'string' || typeof sig !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(sig)) throw new Error('manifest is malformed')
  const k = await crypto.subtle.importKey('jwk', key, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, b64ToBytes(sig) as BufferSource, new TextEncoder().encode(payload))
  if (!ok) throw new Error('signature invalid')
  try {
    return JSON.parse(payload)
  } catch {
    throw new Error('payload is not JSON')
  }
}

/** Le manifeste : signature, puis forme. */
export async function verifyManifest(raw: string, key: JsonWebKey = RELEASE_KEY): Promise<ReleaseInfo> {
  const info = (await verifySigned(raw, key)) as Partial<ReleaseInfo> | null
  if (!info || info.app !== APP_ID || typeof info.version !== 'string' || !/^\d+(\.\d+){1,3}$/.test(info.version) || !/^[0-9a-f]{64}$/i.test(info.sha256 ?? '') || typeof info.url !== 'string' || !/^https:\/\//i.test(info.url)) {
    throw new Error('manifest payload is malformed')
  }
  const notes: Record<string, string[]> = {}
  if (info.notes && typeof info.notes === 'object') {
    for (const [l, list] of Object.entries(info.notes)) {
      if (/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(l) && Array.isArray(list)) notes[l] = list.filter((x): x is string => typeof x === 'string').slice(0, 20).map((x) => x.slice(0, 300))
    }
  }
  return { app: info.app, version: info.version, sha256: info.sha256!.toLowerCase(), url: info.url, notes, at: typeof info.at === 'string' ? info.at.slice(0, 40) : undefined }
}

/** Y a-t-il une version plus récente ? */
export async function checkForUpdates(url = MANIFEST_URL, key: JsonWebKey = RELEASE_KEY, current = APP_VERSION): Promise<UpdateCheck> {
  if (isOffline()) return { status: 'offline' }
  try {
    const res = await netFetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const release = await verifyManifest(await res.text(), key)
    if (compareVersions(release.version, current) <= 0) return { status: 'current', version: current }
    return { status: 'update', release }
  } catch (e) {
    if (e instanceof OfflineError) return { status: 'offline' }
    return { status: 'error', message: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Le nouveau fichier, avec ce document : téléchargé, son empreinte vérifiée,
 * puis le bloc du document (en clair ou chiffré) remis à sa place. Les
 * paquets de langue intégrés au fichier suivent (`carry`).
 */
export async function buildUpdatedFile(release: ReleaseInfo, docBlock: string, carry: (html: string) => string = (x) => x): Promise<string> {
  const res = await netFetch(release.url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const bytes = await res.arrayBuffer()
  if ((await sha256Hex(bytes)) !== release.sha256) throw new Error('integrity check failed')
  const shell = new TextDecoder().decode(bytes)
  if (extractDocBlock(shell) === null || !/<meta\s+name="generator"\s+content="folio-pages/i.test(shell)) throw new Error('not a Folio Pages file')
  const html = spliceDocBlock(shell, docBlock)
  if (html === null) throw new Error('not a Folio Pages file')
  return carry(html)
}
