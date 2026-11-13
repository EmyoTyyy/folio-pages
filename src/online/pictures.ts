// Images en ligne : recherche d'images libres sur Wikimedia Commons (licences
// Creative Commons et domaine public), puis insertion avec le crédit de
// l'auteur et la licence dans la légende.
//
// Fonction réseau facultative (netFetch : refusée hors ligne). La requête
// n'emporte que les mots cherchés. Les réponses sont des données : chaque champ
// est nettoyé (balises retirées) et borné.

import { netFetch } from '../net'

export interface OnlinePicture {
  title: string
  /** Vignette pour la grille de résultats. */
  thumb: string
  /** Image à insérer (réduite à 1600 px de large au plus). */
  url: string
  width: number
  height: number
  author: string
  license: string
  licenseUrl: string
  /** Page de l'image sur Commons (crédit). */
  page: string
  description: string
}

const API = 'https://commons.wikimedia.org/w/api.php'

const clean = (v: unknown, max = 300): string =>
  typeof v === 'string'
    ? v
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : ''

/** Licences acceptées : Creative Commons, domaine public, CC0 (pas de « fair use » ni d'images non libres). */
export const isFreeLicense = (l: string): boolean => /^(CC[ -]|CC0|Public domain|PD\b|Domaine public)/i.test(l.trim())

/** Adresse de recherche (Commons, espace des fichiers, images matricielles et SVG). */
export function searchUrl(query: string, lang = 'fr', limit = 24): string {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${query.trim().slice(0, 200)} filetype:bitmap|drawing`,
    gsrlimit: String(Math.min(50, Math.max(1, limit))),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1280',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ImageDescription|ObjectName|Credit',
    iiextmetadatalanguage: lang.slice(0, 2),
  })
  return `${API}?${q.toString()}`
}

/** Réponse de l'API → images libres, dans l'ordre de pertinence. */
export function parseSearch(json: unknown): OnlinePicture[] {
  const pages = (json as { query?: { pages?: Record<string, unknown> } } | null)?.query?.pages
  if (!pages || typeof pages !== 'object') return []
  const list = Object.values(pages) as Record<string, unknown>[]
  list.sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
  const out: OnlinePicture[] = []
  for (const p of list.slice(0, 60)) {
    const info = (Array.isArray(p.imageinfo) ? p.imageinfo[0] : null) as Record<string, unknown> | null
    if (!info) continue
    const mime = String(info.mime ?? '')
    if (!/^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(mime)) continue
    const meta = (info.extmetadata ?? {}) as Record<string, { value?: unknown }>
    const license = clean(meta.LicenseShortName?.value, 80)
    if (!isFreeLicense(license)) continue
    // Sans les paramètres de suivi ajoutés aux adresses.
    const url = String(info.thumburl ?? info.url ?? '').replace(/[?#].*$/, '')
    const page = String(info.descriptionurl ?? '')
    if (!/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(url) || !/^https:\/\/commons\.wikimedia\.org\//.test(page)) continue
    // Vignette : même image, 330 px (une des tailles de vignette de Commons).
    const thumb = url.replace(/\/(\d+)px-([^/]+)$/, '/330px-$2')
    const title = clean(meta.ObjectName?.value, 200) || clean(String(p.title ?? '').replace(/^File:|^Fichier:/, '').replace(/\.[a-z0-9]+$/i, ''), 200)
    const licenseUrl = String(meta.LicenseUrl?.value ?? '')
    out.push({
      title,
      thumb,
      url,
      width: Number(info.thumbwidth ?? info.width ?? 0) || 0,
      height: Number(info.thumbheight ?? info.height ?? 0) || 0,
      author: clean(meta.Artist?.value, 150) || clean(meta.Credit?.value, 150),
      license,
      licenseUrl: /^https?:\/\//.test(licenseUrl) ? licenseUrl.slice(0, 300) : '',
      page,
      description: clean(meta.ImageDescription?.value, 1000),
    })
  }
  return out
}

/** Le crédit d'une image : « Titre — Auteur, Licence ». */
export function creditOf(p: OnlinePicture): string {
  return [p.title, [p.author, p.license].filter(Boolean).join(', ')].filter(Boolean).join(' — ')
}

export async function searchPictures(query: string, lang: string): Promise<OnlinePicture[]> {
  const res = await netFetch(searchUrl(query, lang))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (text.length > 5_000_000) throw new Error('too large')
  return parseSearch(JSON.parse(text))
}

/** Télécharge l'image choisie (30 Mo au plus) et la rend comme fichier, prêt à insérer. */
export async function downloadPicture(p: OnlinePicture): Promise<File> {
  const res = await netFetch(p.url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  if (blob.size > 30_000_000) throw new Error('too large')
  const ext = (blob.type.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg').replace('svg+xml', 'svg')
  return new File([blob], `${p.title.slice(0, 60) || 'image'}.${ext}`, { type: blob.type || 'image/jpeg' })
}
