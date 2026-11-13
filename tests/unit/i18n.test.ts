import { describe, expect, it } from 'vitest'
import { DICT } from '../../src/i18n/dict'
import { LANGUAGES, setLang, t } from '../../src/i18n/i18n'
import type { Key } from '../../src/i18n/dict'

const placeholders = (s: string) => [...s.matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)].map((m) => m[1]).sort()
const forms = (e: unknown): string[] => (typeof e === 'string' ? [e] : Object.values(e as Record<string, string>))

describe('dictionnaire', () => {
  it('chaque entrée existe dans chaque langue, non vide', () => {
    for (const [key, row] of Object.entries(DICT)) {
      for (const l of LANGUAGES) {
        const e = (row as Record<string, unknown>)[l]
        expect(e, `${key} [${l}]`).toBeTruthy()
        for (const f of forms(e)) expect(f.trim(), `${key} [${l}]`).not.toBe('')
      }
    }
  })

  // {{page}} et autres doubles accolades sont du texte (des champs), pas des paramètres.
  it('les paramètres sont les mêmes dans toutes les langues', () => {
    for (const [key, row] of Object.entries(DICT)) {
      const ref = forms((row as Record<string, unknown>).fr).map(placeholders)
      for (const l of LANGUAGES) {
        const got = forms((row as Record<string, unknown>)[l]).map(placeholders)
        expect(new Set(got.flat()), `${key} [${l}]`).toEqual(new Set(ref.flat()))
      }
    }
  })

  it('un code de problème de validation a toujours son message', async () => {
    const codes = ['unknown-field', 'wrong-type', 'invalid-value', 'missing-field', 'too-many-items', 'too-deep', 'too-large', 'unknown-block-type', 'unsafe-link', 'empty-run', 'coerced', 'clamped', 'truncated', 'block-converted', 'level-adjusted', 'several-sources', 'markdown-ignored', 'format-missing', 'format-unknown', 'version-newer', 'id-minted', 'cell-flattened', 'json-repaired']
    for (const c of codes) expect(DICT).toHaveProperty(`issue.${c}`)
    const jsonCodes = ['unexpected-end', 'unexpected-char', 'trailing-comma', 'unterminated-string', 'bad-escape', 'control-char', 'expected-colon', 'expected-comma', 'expected-key', 'trailing-content', 'too-deep', 'empty']
    for (const c of jsonCodes) expect(DICT).toHaveProperty(`jsonErr.${c}`)
  })
})

describe('traduction', () => {
  it('remplace les paramètres et choisit le pluriel', () => {
    setLang('fr', false)
    expect(t('report.ignored', { n: 1 })).toBe('1 champ ignoré')
    expect(t('report.ignored', { n: 0 })).toBe('0 champ ignoré')
    expect(t('report.ignored', { n: 3 })).toBe('3 champs ignorés')
    setLang('en', false)
    expect(t('report.ignored', { n: 0 })).toBe('0 fields ignored')
    expect(t('report.ignored', { n: 1 })).toBe('1 field ignored')
    expect(t('status.savedIn', { name: 'a.html' })).toBe('Saved in “a.html”')
    setLang('fr', false)
  })
  it('laisse un paramètre absent visible plutôt que de planter', () => {
    expect(t('status.savedIn' as Key)).toBe('Enregistré dans « {name} »')
  })
})

describe('dates', () => {
  it('suivent la variante régionale du navigateur quand elle correspond à la langue', async () => {
    const { formatDate } = await import('../../src/i18n/i18n')
    const at = new Date(2026, 10, 8, 12, 0).getTime() // midi, heure locale : le 8 novembre partout
    const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', { value: { languages: ['en-GB'], language: 'en-GB' }, configurable: true })
    try {
      expect(formatDate(at, 'en')).toMatch(/^8 November 2026/)
      expect(formatDate(at, 'fr')).toMatch(/^8 novembre 2026/)
      expect(formatDate('pas une date', 'fr')).toBe('pas une date')
    } finally {
      if (nav) Object.defineProperty(globalThis, 'navigator', nav)
      else delete (globalThis as { navigator?: unknown }).navigator
    }
  })
})
