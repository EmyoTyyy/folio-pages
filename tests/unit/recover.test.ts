import { describe, expect, it } from 'vitest'
import { recoverText } from '../../src/format/recover'
import type { Block } from '../../src/format/types'

const texts = (blocks: Block[]) =>
  blocks.map((b) => (b.type === 'paragraph' || b.type === 'heading' ? b.content.map((r) => ('text' in r ? r.text : '')).join('') : b.type))

describe('récupération du texte d’un JSON cassé', () => {
  it('garde le contenu, pas la structure', () => {
    const broken =
      '{"format":"folio/doc","id":"abcdefgh","meta":{"title":"Mon rapport"},"blocks":[' +
      '{"type":"heading","content":[{"text":"Introduction"}]},' +
      '{"type":"paragraph","text":"Premier paragraphe du texte."}' +
      '{"type":"paragraph","text":"Deuxième, après une virgule oubliée."}]}'
    const r = recoverText(broken)
    expect(r.title).toBe('Mon rapport')
    expect(texts(r.blocks)).toEqual(['Introduction', 'Premier paragraphe du texte.', 'Deuxième, après une virgule oubliée.'])
  })

  it('décode les échappements', () => {
    const r = recoverText('{"blocks":[{"text":"Guillemets \\"ici\\", accent \\u00e9 et \\u003cb\\u003e"}')
    expect(texts(r.blocks)).toEqual(['Guillemets "ici", accent é et <b>'])
  })

  it('retrouve la fin d’un fichier tronqué au milieu d’une chaîne', () => {
    const r = recoverText('{"blocks":[{"text":"Complet."},{"text":"Coupé au mil')
    expect(texts(r.blocks)).toEqual(['Complet.', 'Coupé au mil'])
  })

  it('relit le Markdown des champs md et markdown', () => {
    const r = recoverText('{"markdown":"# Titre\\n\\nTexte **gras**."  oups')
    expect(r.blocks[0]).toMatchObject({ type: 'heading', level: 1 })
    expect(texts(r.blocks)).toEqual(['Titre', 'Texte gras.'])
  })

  it('découpe un long texte en paragraphes', () => {
    const r = recoverText('{"text":"Un.\\n\\nDeux.\\n\\n\\nTrois."')
    expect(texts(r.blocks)).toEqual(['Un.', 'Deux.', 'Trois.'])
  })

  it('garde un texte qui n’est pas du JSON du tout', () => {
    const r = recoverText('Juste du texte\nsur deux lignes.\n\nEt un second paragraphe.')
    expect(texts(r.blocks)).toEqual(['Juste du texte\nsur deux lignes.', 'Et un second paragraphe.'])
  })

  it('ignore les valeurs structurelles', () => {
    const r = recoverText('{"type":"paragraph","style":"bullet","language":"python","link":"https://a.fr/une page"')
    expect(r.blocks).toEqual([])
  })

  it('reste linéaire sur un très gros bloc', () => {
    const big = '{"blocks":[' + Array.from({ length: 50_000 }, (_, i) => `{"text":"paragraphe numéro ${i}"}`).join(',')
    const t = Date.now()
    const r = recoverText(big)
    expect(Date.now() - t).toBeLessThan(3000)
    expect(r.count).toBe(50_000)
  })
})
