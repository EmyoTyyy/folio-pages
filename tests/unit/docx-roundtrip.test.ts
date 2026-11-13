// Aller-retour .docx : un document exporté puis réimporté revient identique,
// à ce que le format ne peut pas porter près (voir `comparable`).

import { describe, expect, it } from 'vitest'
import { exportDocx } from '../../src/docx/export'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { loadDocument } from '../../src/format/load'
import { demoDocument } from '../../src/demo/demo'
import type { FolioDoc } from '../../src/format/types'
import { bytesOfDataUri } from '../../src/docx/maps'
import { NOW, allText, comparable, open } from './docx-helpers'
import { randomDoc } from './gen'

const PNG = bytesOfDataUri('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')!.bytes

function stable(seed: number): FolioDoc {
  const d0 = randomDoc(seed)
  const d1 = pmToDoc(docToPM(d0), { id: d0.id, created: d0.meta.created, modified: d0.meta.modified })
  const l = loadDocument(JSON.parse(JSON.stringify(d1)), { now: NOW })
  if (!l.ok) throw new Error('refusé')
  return l.doc
}

describe('aller-retour .docx', () => {
  it('rend le même document (300 documents aléatoires)', async () => {
    for (let seed = 1; seed <= 300; seed++) {
      const doc = stable(seed)
      const out = await exportDocx(doc, { now: new Date(NOW) })
      const back = open(out.bytes)
      expect(back.res.losses, `graine ${seed}`).toEqual([])
      expect(comparable(back.doc), `graine ${seed}`).toEqual(comparable(doc))
    }
  }, 180_000)

  it('ne perd jamais de texte, même là où la structure change', async () => {
    for (let seed = 301; seed <= 360; seed++) {
      const doc = stable(seed)
      const back = open((await exportDocx(doc, { now: new Date(NOW) })).bytes)
      const words = (s: string) => s.split(/\s+/).filter(Boolean).sort()
      // Une image du web devient son texte de remplacement : ces mots-là s'ajoutent, aucun ne disparaît.
      const got = words(allText(back.doc))
      for (const w of new Set(words(allText(doc)))) expect(got, `graine ${seed} : « ${w} »`).toContain(w)
    }
  }, 120_000)

  it('un second aller-retour ne change plus rien', async () => {
    for (const seed of [3, 15, 39, 88, 207]) {
      const once = open((await exportDocx(stable(seed), { now: new Date(NOW) })).bytes).doc
      const twice = open((await exportDocx(once, { now: new Date(NOW) })).bytes).doc
      expect(comparable(twice), `graine ${seed}`).toEqual(comparable(once))
    }
  }, 60_000)

  it('le document de démonstration fait l’aller-retour', async () => {
    for (const lang of ['fr', 'en'] as const) {
      const doc = demoDocument(lang, NOW)
      // Le logo est un dessin vectoriel : l'application en fait une image de repli (ici, un PNG tout prêt).
      const out = await exportDocx(doc, { now: new Date(NOW), rasterize: async () => PNG })
      expect(out.losses.map((l) => l.code)).toEqual(['code-colors'])
      const back = open(out.bytes)
      expect(back.res.losses).toEqual([])
      expect(back.issues).toEqual([])
      expect(comparable(back.doc)).toEqual(comparable(doc))
    }
  })
})
