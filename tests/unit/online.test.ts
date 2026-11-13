// Fonctions en ligne, sans réseau : lecture des réponses (Commons, Wikipédia,
// Wiktionnaire, Datamuse, Google Fonts), demande à une IA et lecture de sa
// réponse, ponctuation dictée, Markdown d'un passage.

import { describe, expect, it } from 'vitest'
import { buildPrompt, extractAnswer, MAX_URL_PROMPT, siteUrl } from '../../src/online/ai'
import { spokenToText } from '../../src/online/dictate'
import { cssUrl, isFamilyName, parseFontCss } from '../../src/online/fonts'
import { parseDatamuse, parseEnDefinitions, parseFrWiktionary, parseSummary, wikiPlain } from '../../src/online/lookup'
import { creditOf, isFreeLicense, parseSearch, searchUrl } from '../../src/online/pictures'
import { blocksToMarkdown } from '../../src/format/markdown-out'
import { parseMarkdown } from '../../src/format/markdown'

describe('images en ligne (Wikimedia Commons)', () => {
  const page = (index: number, license: string, extra: Record<string, unknown> = {}) => ({
    index,
    title: `File:Phare ${index}.jpg`,
    imageinfo: [
      {
        mime: 'image/jpeg',
        thumburl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Phare_${index}.jpg/1280px-Phare_${index}.jpg?utm_source=commons`,
        thumbwidth: 1280,
        thumbheight: 853,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:Phare_${index}.jpg`,
        extmetadata: {
          ObjectName: { value: `Phare ${index}` },
          Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jo">Jo &amp; Lu</a>' },
          LicenseShortName: { value: license },
          LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
          ImageDescription: { value: 'Un <b>phare</b> au loin' },
        },
        ...extra,
      },
    ],
  })

  it('garde les images libres, dans l’ordre, champs nettoyés ; vignette et adresse sans suivi', () => {
    const res = parseSearch({ query: { pages: { a: page(2, 'CC BY-SA 4.0'), b: page(1, 'Public domain'), c: page(3, 'Fair use'), d: page(4, 'CC0', { mime: 'application/pdf' }) } } })
    expect(res.map((p) => p.title)).toEqual(['Phare 1', 'Phare 2'])
    const p = res[1]
    expect(p.url).toBe('https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Phare_2.jpg/1280px-Phare_2.jpg')
    expect(p.thumb).toBe('https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Phare_2.jpg/330px-Phare_2.jpg')
    expect(p.author).toBe('Jo & Lu')
    expect(p.description).toBe('Un phare au loin')
    expect(creditOf(p)).toBe('Phare 2 — Jo & Lu, CC BY-SA 4.0')
    expect(parseSearch({ query: { pages: { x: page(1, 'CC BY 4.0', { thumburl: 'https://evil.example/x.jpg' }) } } })).toEqual([])
    expect(parseSearch(null)).toEqual([])
  })

  it('licences libres seulement ; requête bornée, sans autre donnée que les mots', () => {
    for (const l of ['CC BY 4.0', 'CC-BY-SA-3.0', 'CC0', 'Public domain']) expect(isFreeLicense(l)).toBe(true)
    for (const l of ['Fair use', 'All rights reserved', '']) expect(isFreeLicense(l)).toBe(false)
    const u = new URL(searchUrl('phare breton', 'fr-FR'))
    expect(u.origin).toBe('https://commons.wikimedia.org')
    expect(u.searchParams.get('gsrsearch')).toBe('phare breton filetype:bitmap|drawing')
    expect(u.searchParams.get('iiextmetadatalanguage')).toBe('fr')
    expect(u.searchParams.get('origin')).toBe('*')
  })
})

describe('rechercher et synonymes', () => {
  it('résumé Wikipédia', () => {
    expect(parseSummary({ title: 'Chat', extract: 'Le <b>chat</b> est un mammifère.', content_urls: { desktop: { page: 'https://fr.wikipedia.org/wiki/Chat' } } })).toEqual({ title: 'Chat', extract: 'Le chat est un mammifère.', url: 'https://fr.wikipedia.org/wiki/Chat' })
    expect(parseSummary({ title: 'x', extract: '', content_urls: {} })).toBeNull()
    expect(parseSummary({ title: 'x', extract: 'y', content_urls: { desktop: { page: 'https://evil.example' } } })?.url).toBe('')
  })

  it('Wiktionnaire : définitions par nature, synonymes, antonymes, de la bonne langue', () => {
    const wikitext = [
      '== {{langue|fr}} ==',
      '=== {{S|étymologie}} ===',
      ': Du latin.',
      '=== {{S|adjectif|fr}} ===',
      "'''rapide'''",
      '# Qui se [[mouvoir|meut]] avec [[vitesse]].',
      '#* {{exemple|Le fleuve rapide.}}',
      '# {{figuré|fr}} Qui [[comprendre|comprend]] vite.',
      '==== {{S|synonymes}} ====',
      '* [[véloce]]',
      '* [[prompt]], [[vif]]',
      '==== {{S|antonymes}} ====',
      '* [[lent]]',
      '=== {{S|nom|fr}} ===',
      '# Partie d’un [[cours d’eau]].',
      '== {{langue|en}} ==',
      '=== {{S|adjectif|en}} ===',
      '# Anglais : rapide.',
    ].join('\n')
    const r = parseFrWiktionary(wikitext, 'fr')
    expect(r.senses).toEqual([
      { pos: 'adjectif', items: ['Qui se meut avec vitesse.', '(figuré) Qui comprend vite.'] },
      { pos: 'nom', items: ['Partie d’un cours d’eau.'] },
    ])
    expect(r.synonyms).toEqual(['véloce', 'prompt', 'vif'])
    expect(r.antonyms).toEqual(['lent'])
    expect(parseFrWiktionary(wikitext, 'de').senses).toEqual([])
    expect(wikiPlain("{{lien|chat|fr}} et [[chien|chiens]] ''gras''")).toBe('chat et chiens gras')
  })

  it('Wiktionary anglais et Datamuse', () => {
    expect(parseEnDefinitions({ en: [{ partOfSpeech: 'Adjective', definitions: [{ definition: 'Moving <b>fast</b>.' }, { definition: '' }] }], fr: [] })).toEqual([{ pos: 'adjective', items: ['Moving fast.'] }])
    expect(parseEnDefinitions({ de: [{ partOfSpeech: 'Adjektiv', definitions: [{ definition: 'schnell' }] }] }, 'de')).toEqual([{ pos: 'adjektiv', items: ['schnell'] }])
    expect(parseDatamuse([{ word: 'quick' }, { word: '<i>swift</i>' }, {}])).toEqual(['quick', 'swift'])
    expect(parseDatamuse('nope')).toEqual([])
  })
})

describe('polices en ligne', () => {
  const css = (subset: string, style: string, weight: number) =>
    `/* ${subset} */\n@font-face {\n  font-family: 'Lora';\n  font-style: ${style};\n  font-weight: ${weight};\n  font-display: swap;\n  src: url(https://fonts.gstatic.com/s/lora/v37/${subset}${weight}${style}.woff2) format('woff2');\n  unicode-range: U+0000-00FF, U+0131, U+0152-0153;\n}\n`
  it('garde le latin et le latin étendu, graisse, style, plages', () => {
    const faces = parseFontCss(css('cyrillic', 'normal', 400) + css('latin-ext', 'normal', 400) + css('latin', 'italic', 700) + css('vietnamese', 'normal', 700))
    expect(faces).toEqual([
      { subset: 'latin-ext', weight: 400, italic: false, url: 'https://fonts.gstatic.com/s/lora/v37/latin-ext400normal.woff2', unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153' },
      { subset: 'latin', weight: 700, italic: true, url: 'https://fonts.gstatic.com/s/lora/v37/latin700italic.woff2', unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153' },
    ])
    // Une adresse d'un autre site est ignorée.
    expect(parseFontCss(css('latin', 'normal', 400).replace('https://fonts.gstatic.com', 'https://evil.example'))).toEqual([])
  })
  it('adresses et noms', () => {
    expect(cssUrl('Playfair Display', 'full')).toBe('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap')
    expect(cssUrl('Lora', 'regular')).toBe('https://fonts.googleapis.com/css2?family=Lora&display=swap')
    expect(isFamilyName('Source Serif 4')).toBe(true)
    expect(isFamilyName('x"); body{')).toBe(false)
  })
  it('une police intégrée avec sa plage Unicode passe la validation et revient à l’identique', async () => {
    const { loadDocument } = await import('../../src/format/load')
    const { toCompact } = await import('../../src/format/compact')
    const src = 'data:font/woff2;base64,d09GMgABAAAAAA=='
    const r = loadDocument({ format: 'folio/doc', version: 1, fonts: [{ family: 'Lora', src, weight: 700, italic: true, unicodeRange: 'U+0000-00FF, U+0131' }, { family: 'Lora', src, unicodeRange: 'url(x)' }], blocks: ['x'] }, { now: '2026-01-01T00:00:00.000Z' })
    if (!r.ok) throw new Error('refusé')
    expect(r.doc.fonts[0]).toMatchObject({ family: 'Lora', weight: 700, italic: true, unicodeRange: 'U+0000-00FF, U+0131' })
    expect(r.doc.fonts[1].unicodeRange).toBeUndefined()
    expect((toCompact(r.doc).fonts as unknown[])[0]).toMatchObject({ unicodeRange: 'U+0000-00FF, U+0131' })
  })
})

describe('demander à une IA', () => {
  it('la demande : consigne, format attendu, document ou passage', () => {
    const p = buildPrompt({ request: 'Ajoute une conclusion.', json: '{"format":"folio/doc","blocks":["x"]}', lang: 'fr' })
    expect(p.startsWith('Ajoute une conclusion.')).toBe(true)
    expect(p).toContain('```json\n{"format":"folio/doc","blocks":["x"]}\n```')
    expect(p).toContain('asset:')
    const q = buildPrompt({ request: 'Rewrite.', selection: '**Bold** text', lang: 'en' })
    expect(q).toContain('```markdown\n**Bold** text\n```')
  })

  it('adresse : la demande dans l’adresse si elle est courte, sinon le site seul', () => {
    expect(siteUrl('claude', 'Bonjour ?')).toEqual({ url: 'https://claude.ai/new?q=Bonjour%20%3F', prefilled: true })
    expect(siteUrl('chatgpt', 'x'.repeat(MAX_URL_PROMPT + 1))).toEqual({ url: 'https://chatgpt.com/', prefilled: false })
  })

  it('la réponse : document JSON (bloc, nu ou entouré de texte), sinon Markdown', () => {
    const doc = '{"format":"folio/doc","version":1,"blocks":["Bonjour"]}'
    expect(extractAnswer(`Voici :\n\`\`\`json\n${doc}\n\`\`\`\nBonne journée`)).toEqual({ kind: 'json', json: doc })
    expect(extractAnswer(doc)).toEqual({ kind: 'json', json: doc })
    expect(extractAnswer(`Le document : ${doc} — voilà.`)).toEqual({ kind: 'json', json: doc })
    expect(extractAnswer('Voici :\n```markdown\n# Titre\n\nTexte\n```')).toEqual({ kind: 'markdown', md: '# Titre\n\nTexte' })
    expect(extractAnswer('Simplement du **texte**.')).toEqual({ kind: 'markdown', md: 'Simplement du **texte**.' })
    expect(extractAnswer('{"a": 1}')).toEqual({ kind: 'markdown', md: '{"a": 1}' })
    expect(extractAnswer('   ')).toBeNull()
  })
})

describe('dicter', () => {
  it('ponctuation dite, majuscules, retours à la ligne (français et anglais)', () => {
    expect(spokenToText('bonjour virgule comment allez-vous point d’interrogation'.replace('’', "'"), 'fr-FR', true)).toBe('Bonjour, comment allez-vous ?')
    expect(spokenToText('fin de la phrase point nouveau paragraphe suite', 'fr-FR', false)).toBe('fin de la phrase.\n\nSuite')
    expect(spokenToText('hello comma world period new line next', 'en-US', true)).toBe('Hello, world.\nNext')
  })
})

describe('Markdown d’un passage', () => {
  it('relu à l’identique par le lecteur Markdown', () => {
    const md = '# Titre\n\nUn **gras**, un *italique*, du `code`, un [lien](https://exemple.org) et $x^2$.\n\n- un\n- deux\n   - sous\n\n1. premier\n2. second\n\n> citation\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'
    const blocks = parseMarkdown(md)
    const again = blocksToMarkdown(blocks)
    expect(parseMarkdown(again)).toEqual(blocks)
  })
})
