// Construction d'un document complet à partir de quelques champs.

import { defaultTheme } from './theme'
import { FORMAT, FORMAT_VERSION, defaultMath, defaultNotes, defaultPage, emptyHeaders, emptyMeta, mintId, type Block, type FolioDoc, type Meta } from './types'

export function makeDoc(p: { id?: string; meta?: Partial<Meta>; blocks?: Block[] } = {}): FolioDoc {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    id: p.id ?? mintId(),
    meta: { ...emptyMeta(), ...p.meta },
    page: defaultPage(),
    headers: emptyHeaders(),
    footers: emptyHeaders(),
    notes: defaultNotes(),
    math: defaultMath(),
    theme: defaultTheme(),
    styles: {},
    fonts: [],
    blocks: p.blocks ?? [],
    comments: [],
    trackChanges: false,
    template: false,
    readOnly: false,
    assets: {},
  }
}
