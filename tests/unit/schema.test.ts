// Le schéma publié, la documentation et les exemples ne peuvent pas diverger
// de ce que l'application accepte réellement.

import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import { readFileSync } from 'node:fs'
import { buildSchema } from '../../src/format/schema'
import { loadDocument } from '../../src/format/load'
import { toCompact } from '../../src/format/compact'
import { DEMO_SOURCES } from '../../src/demo/demo'
import { randomDoc } from './gen'

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const schema = buildSchema()
const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false })
const validate = ajv.compile(schema)

const valid = (doc: unknown) => {
  const ok = validate(doc)
  return ok ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`)
}

/** Les blocs ```json d'un texte Markdown. */
const jsonBlocks = (md: string) => [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]))

describe('JSON Schema', () => {
  it('est un schéma 2020-12 valide (Ajv strict)', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(typeof validate).toBe('function')
  })

  it('le fichier publié dans docs/ est à jour (npm run schema)', () => {
    expect(JSON.parse(read('docs/schema/folio-1.json'))).toEqual(schema)
  })

  it('accepte la forme complète et la forme compacte de documents aléatoires', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const doc = randomDoc(seed)
      expect(valid(doc), `complet, graine ${seed}`).toEqual([])
      expect(valid(toCompact(doc)), `compact, graine ${seed}`).toEqual([])
    }
  })

  it('accepte le document de démonstration', () => {
    for (const src of Object.values(DEMO_SOURCES)) expect(valid(src)).toEqual([])
  })

  it('refuse ce que l’application ignorerait', () => {
    expect(valid({ format: 'folio/doc', version: 1, blocks: [{ type: 'heading', level: 9 }] })).not.toEqual([])
    expect(valid({ format: 'folio/doc', version: 1, blocks: [{ type: 'mystery' }] })).not.toEqual([])
    expect(valid({ format: 'folio/doc', version: 1, couleur: 'rouge' })).not.toEqual([])
    expect(valid({ format: 'folio/doc', version: 1, blocks: [{ content: [{ text: 'x', link: 'javascript:x' }] }] })).toEqual([]) // motif non exprimable : refusé à l'exécution
  })
})

describe('documentation et exemples', () => {
  const examples = [
    ...jsonBlocks(read('docs/agents.md')).map((doc, i) => [`docs/agents.md, exemple ${i + 1}`, doc] as const),
    ['guide intégré au fichier', (() => {
      const g = read('shell/guide.txt')
      const s = g.slice(g.indexOf('MINIMAL DOCUMENT'), g.indexOf('BLOCKS'))
      return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1))
    })()] as const,
    ['fixture compte rendu', JSON.parse(read('tests/fixtures/ai-compte-rendu.json'))] as const,
    ['fixture Markdown', JSON.parse(read('tests/fixtures/ai-markdown.json'))] as const,
  ]

  it('la documentation contient bien des exemples', () => {
    expect(examples.length).toBeGreaterThanOrEqual(8)
  })

  for (const [name, doc] of examples) {
    it(`${name} : conforme au schéma et chargé sans aucun signalement`, () => {
      expect(valid(doc)).toEqual([])
      const r = loadDocument(doc)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.report.issues).toEqual([])
    })
  }
})
