// @vitest-environment jsdom
// Correction automatique : listes, guillemets, typographie française, frappe dans l'éditeur.

import { describe, expect, it } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { undoInputRule } from 'prosemirror-inputrules'
import { docToPM } from '../../src/editor/convert'
import { markdownInputRules } from '../../src/editor/inputrules'
import {
  acLang,
  autoCorrectPlugin,
  builtinList,
  diffList,
  effectiveList,
  frenchSpace,
  looksLikeAddress,
  NBSP,
  NNBSP,
  replacementFor,
  smartQuote,
  startsSentence,
  validEntry,
  type AutoCorrectOptions,
} from '../../src/editor/autocorrect'
import { loadDocument } from '../../src/format/load'

describe('listes', () => {
  it('liste d’origine par langue, entrées personnelles et retirées', () => {
    expect(acLang('fr-CA')).toBe('fr')
    expect(acLang('en-GB')).toBe('en')
    expect(acLang('de')).toBe('other')
    expect(new Map(builtinList('fr')).get('coeur')).toBe('cœur')
    expect(new Map(builtinList('en')).get('teh')).toBe('the')
    expect(new Map(builtinList('de')).get('teh')).toBeUndefined()
    expect(new Map(builtinList('de')).get('(c)')).toBe('©')
    const list = effectiveList('fr', [['fp', 'Folio Pages'], ['bad entry', 'x'], ['coeur', 'Cœur']], ['voila'])
    expect(list.get('fp')).toBe('Folio Pages')
    expect(list.get('coeur')).toBe('Cœur')
    expect(list.has('voila')).toBe(false)
    expect(list.has('bad entry')).toBe(false)
    // aller-retour : la liste voulue donne ce qui la sépare de celle d'origine
    const wanted = [...list.entries()]
    const d = diffList('fr', wanted)
    expect(d.custom).toEqual([['coeur', 'Cœur'], ['fp', 'Folio Pages']].sort((a, b) => wanted.findIndex((w) => w[0] === a[0]) - wanted.findIndex((w) => w[0] === b[0])))
    expect(d.removed).toEqual(['voila'])
    expect(effectiveList('fr', d.custom, d.removed)).toEqual(list)
    expect(validEntry('x'.repeat(41), 'y')).toBe(false)
    expect(validEntry('a', '')).toBe(false)
    expect(validEntry('a', 'b\nc')).toBe(false)
  })

  it('remplacement : forme exacte, majuscule initiale, capitales ; symboles exacts seulement', () => {
    const list = effectiveList('en', [], [])
    expect(replacementFor('teh', list)).toBe('the')
    expect(replacementFor('Teh', list)).toBe('The')
    expect(replacementFor('TEH', list)).toBe('THE')
    expect(replacementFor('(c)', list)).toBe('©')
    expect(replacementFor('(C)', list)).toBe('©')
    expect(replacementFor('->', list)).toBe('→')
    expect(replacementFor('i', list)).toBe('I')
    expect(replacementFor('the', list)).toBeNull()
  })
})

describe('typographie', () => {
  it('guillemets : français « », anglais “ ”, apostrophe ’', () => {
    expect(smartQuote('', '"', 'fr')).toEqual({ text: '«' + NBSP, replaceSpace: false })
    expect(smartQuote('il dit ', '"', 'fr').text).toBe('«' + NBSP)
    expect(smartQuote('il dit « bonjour', '"', 'fr')).toEqual({ text: NBSP + '»', replaceSpace: false })
    expect(smartQuote('il dit « bonjour ', '"', 'fr')).toEqual({ text: NBSP + '»', replaceSpace: true })
    expect(smartQuote('he said ', '"', 'en').text).toBe('“')
    expect(smartQuote('he said “hi', '"', 'en').text).toBe('”')
    expect(smartQuote('l', "'", 'fr').text).toBe('’')
    expect(smartQuote('', "'", 'en').text).toBe('‘')
  })

  it('espaces insécables du français ; adresses et heures épargnées', () => {
    expect(frenchSpace('Pourquoi ', '?')).toEqual({ text: NNBSP + '?', replaceSpace: true })
    expect(frenchSpace('Note ', ':')).toEqual({ text: NBSP + ':', replaceSpace: true })
    expect(frenchSpace('Pourquoi', '?')).toEqual({ text: NNBSP + '?', replaceSpace: false })
    expect(frenchSpace('Il est 10', ':')).toBeNull()
    expect(frenchSpace('voir http', ':')).toBeNull()
    expect(frenchSpace('Quoi?', '!')).toBeNull()
    expect(frenchSpace('Ah', ',')).toBeNull()
    expect(looksLikeAddress('voir https://exemple.fr/page')).toBe(true)
    expect(looksLikeAddress('écrire à ana@exemple.fr')).toBe(true)
    expect(looksLikeAddress('dossier/fichier')).toBe(true)
    expect(looksLikeAddress('1/2')).toBe(false)
    expect(looksLikeAddress('un mot')).toBe(false)
  })

  it('début de phrase', () => {
    expect(startsSentence('')).toBe(true)
    expect(startsSentence('Fini. ')).toBe(true)
    expect(startsSentence('Vraiment ? ')).toBe(true)
    expect(startsSentence('un ')).toBe(false)
    expect(startsSentence('voir p. ')).toBe(false)
    expect(startsSentence('e.g. ')).toBe(false)
  })
})

describe('frappe dans l’éditeur', () => {
  const docOf = (lang: string): PMNode => {
    const r = loadDocument({ format: 'folio/doc', version: 1, meta: { lang }, blocks: [''] }, { now: '2026-11-13T10:00:00.000Z' })
    if (!r.ok) throw new Error('refusé')
    return docToPM(r.doc)
  }
  const options = (lang: string, extra: Partial<AutoCorrectOptions> = {}): AutoCorrectOptions => ({
    quotes: true,
    frenchSpacing: true,
    replace: true,
    capitalize: false,
    list: effectiveList(lang, [], []),
    lang,
    ...extra,
  })
  /** Tape le texte caractère par caractère, comme au clavier ; « ⌫ » : Retour arrière. */
  const type = (text: string, lang = 'fr', extra: Partial<AutoCorrectOptions> | null = {}, markdown = true) => {
    const host = document.createElement('div')
    const d = docOf(lang)
    const plugins = [...(markdown ? [markdownInputRules()] : []), autoCorrectPlugin(() => (extra === null ? null : options(lang, extra)))]
    const view = new EditorView(host, { state: EditorState.create({ doc: d, plugins, selection: TextSelection.atEnd(d) }) })
    for (const ch of text) {
      if (ch === '⌫') {
        undoInputRule(view.state, view.dispatch)
        continue
      }
      const { from, to } = view.state.selection
      const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
      if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
    }
    const out = view.state.doc.textContent
    const first = view.state.doc.firstChild!.type.name
    view.destroy()
    return { text: out, first }
  }

  it('français : fautes, symboles, guillemets, espaces insécables', () => {
    expect(type('Voila le coeur du probleme. ').text).toBe('Voilà le cœur du problème. ')
    expect(type('Il dit "bonjour" ').text).toBe(`Il dit «${NBSP}bonjour${NBSP}» `)
    expect(type('Il dit "voila" ').text).toBe(`Il dit «${NBSP}voilà${NBSP}» `)
    expect(type("l'équipe ").text).toBe('l’équipe ')
    expect(type('Pourquoi ? Note : ok ; fin !').text).toBe(`Pourquoi${NNBSP}? Note${NBSP}: ok${NNBSP}; fin${NNBSP}!`)
    expect(type('Pourquoi?').text).toBe(`Pourquoi${NNBSP}?`)
    expect(type('deja!').text).toBe(`déjà${NNBSP}!`)
    expect(type('(c) 2026 -> suite ').text).toBe('© 2026 → suite ')
    expect(type('de 1 - 2 ').text).toBe('de 1 – 2 ')
    expect(type('Il est 10:30 ').text).toBe('Il est 10:30 ')
    expect(type('voir https://exemple.fr/a?b ').text).toBe('voir https://exemple.fr/a?b ')
  })

  it('anglais : fautes et guillemets “ ”, pas d’espace insécable', () => {
    expect(type('i think teh answer is "yes" ', 'en').text).toBe('I think the answer is “yes” ')
    expect(type("dont stop ", 'en').text).toBe('don’t stop ')
    expect(type('Why ? ', 'en').text).toBe('Why ? ')
  })

  it('Retour arrière défait la correction ; rien dans le code ; désactivée : rien ne change', () => {
    expect(type('teh ⌫', 'en').text).toBe('teh ')
    expect(type('"⌫', 'en').text).toBe('"')
    expect(type('`teh` "x" ', 'en').text).toBe('teh “x” ')
    expect(type('teh "x" ', 'en', null).text).toBe('teh "x" ')
    expect(type('teh ', 'en', { replace: false }).text).toBe('teh ')
    // le Markdown passe d'abord : « - » en début de ligne reste une puce
    expect(type('- liste').first).toBe('bullet_list')
    expect(type('- liste', 'fr', {}, false).text).toBe('- liste')
  })

  it('majuscule en début de phrase (si demandée)', () => {
    expect(type('bonjour. ça va ', 'fr', { capitalize: true }).text).toBe('Bonjour. Ça va ')
    expect(type('voir p. dix ', 'fr', { capitalize: true }).text).toBe('Voir p. dix ')
    expect(type('bonjour ', 'fr').text).toBe('bonjour ')
  })
})
