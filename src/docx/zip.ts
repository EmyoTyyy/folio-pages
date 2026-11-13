// Lecture d'une archive .docx (ZIP) avec fflate (MIT), en se méfiant d'elle :
// on ne décompresse que les parties utiles, chacune bornée, et l'ensemble aussi
// (une archive minuscule peut annoncer des gigaoctets).

import { unzipSync } from 'fflate'

export const ZIP_LIMITS = {
  /** Taille du fichier .docx lui-même. */
  archive: 150_000_000,
  /** Une partie XML décompressée. */
  xml: 80_000_000,
  /** Une image décompressée (au-delà, elle n'est pas importée). */
  media: 22_000_000,
  /** Total décompressé. */
  total: 400_000_000,
  entries: 5_000,
}

export type DocxErrorCode = 'not-zip' | 'old-format' | 'not-docx' | 'too-large' | 'damaged'

export class DocxError extends Error {
  constructor(readonly code: DocxErrorCode) {
    super(code)
  }
}

const WANTED = /^(\[Content_Types\]\.xml|_rels\/\.rels|docProps\/(core|app|custom)\.xml|word\/.+|customXml\/item\d{1,3}\.xml)$/

export interface Archive {
  /** Contenu d'une partie, ou undefined. */
  bytes(path: string): Uint8Array | undefined
  /** Texte d'une partie XML, ou undefined. */
  text(path: string): string | undefined
  /** Parties trop grosses pour être lues (des images). */
  skipped: Set<string>
}

/** Ouvre l'archive ; lève DocxError si ce n'en est pas une, ou si elle dépasse les bornes. */
export function openArchive(data: Uint8Array): Archive {
  if (data.length > ZIP_LIMITS.archive) throw new DocxError('too-large')
  // Un ancien .doc et un .docx protégé par mot de passe sont des fichiers composés OLE.
  if (data.length >= 8 && data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0) throw new DocxError('old-format')
  if (data.length < 22 || data[0] !== 0x50 || data[1] !== 0x4b) throw new DocxError('not-zip')
  const skipped = new Set<string>()
  let total = 0
  let entries = 0
  let tooLarge = false
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data, {
      filter: (f) => {
        if (++entries > ZIP_LIMITS.entries) {
          tooLarge = true
          return false
        }
        const name = f.name.replace(/\\/g, '/')
        if (!WANTED.test(name) || name.includes('../')) return false
        const xml = /\.(xml|rels)$/i.test(name)
        if (f.originalSize > (xml ? ZIP_LIMITS.xml : ZIP_LIMITS.media)) {
          if (xml) tooLarge = true
          else skipped.add(name)
          return false
        }
        total += f.originalSize
        if (total > ZIP_LIMITS.total) {
          tooLarge = true
          return false
        }
        return true
      },
    })
  } catch {
    throw new DocxError('damaged')
  }
  if (tooLarge) throw new DocxError('too-large')
  const norm: Record<string, Uint8Array> = {}
  for (const k of Object.keys(files)) norm[k.replace(/\\/g, '/')] = files[k]
  const decoder = new TextDecoder('utf-8')
  return {
    bytes: (path) => (Object.prototype.hasOwnProperty.call(norm, path) ? norm[path] : undefined),
    text: (path) => {
      const b = Object.prototype.hasOwnProperty.call(norm, path) ? norm[path] : undefined
      if (!b) return undefined
      // UTF-16 (rare) : reconnu à sa marque d'ordre.
      if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) return new TextDecoder(b[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(b)
      return decoder.decode(b)
    },
    skipped,
  }
}

/** Chemin d'une cible de relation, relatif au dossier de la partie qui la cite. */
export function resolveTarget(partPath: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = partPath.split('/')
  parts.pop()
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}
