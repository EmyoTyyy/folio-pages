// « Définir par défaut » : le thème, les styles et la mise en page que
// l'utilisateur a choisis pour ses nouveaux documents (gardés dans ce
// navigateur). Ils repassent par le chargement tolérant du format.

import { loadDocument } from './format/load'
import type { FolioDoc } from './format/types'
import { settings } from './settings'

/** Le document, avec le thème, les styles et la mise en page par défaut s'il y en a. */
export function withDefaultDesign(doc: FolioDoc): FolioDoc {
  const d = settings().defaultDesign
  if (!d) return doc
  const res = loadDocument({ format: 'folio/doc', version: 1, theme: d.theme, styles: d.styles, page: d.page, blocks: [] })
  if (!res.ok) return doc
  return { ...doc, theme: res.doc.theme, styles: res.doc.styles, page: res.doc.page }
}
