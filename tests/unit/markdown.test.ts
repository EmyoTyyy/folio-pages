import { describe, expect, it } from 'vitest'
import { joinLines, parseInline, parseInlineField, parseMarkdown, splitRow } from '../../src/format/markdown'
import type { Block } from '../../src/format/types'

const p = (s: string) => parseInline(s)

describe('Markdown en ligne', () => {
  it('reconnaît chaque mise en forme', () => {
    expect(p('**g**')).toEqual([{ text: 'g', bold: true }])
    expect(p('__g__')).toEqual([{ text: 'g', bold: true }])
    expect(p('*i*')).toEqual([{ text: 'i', italic: true }])
    expect(p('_i_')).toEqual([{ text: 'i', italic: true }])
    expect(p('++u++')).toEqual([{ text: 'u', underline: true }])
    expect(p('~~s~~')).toEqual([{ text: 's', strike: true }])
    expect(p('`c`')).toEqual([{ text: 'c', code: true }])
    expect(p('x^2^')).toEqual([{ text: 'x' }, { text: '2', sup: true }])
    expect(p('H~2~O')).toEqual([{ text: 'H' }, { text: '2', sub: true }, { text: 'O' }])
    expect(p('[site](https://example.org)')).toEqual([{ text: 'site', link: 'https://example.org' }])
  })

  it('imbrique les mises en forme', () => {
    expect(p('***bi***')).toEqual([{ text: 'bi', bold: true, italic: true }])
    expect(p('**gras *et italique***')).toEqual([
      { text: 'gras ', bold: true },
      { text: 'et italique', bold: true, italic: true },
    ])
    expect(p('*a **b** c*')).toEqual([
      { text: 'a ', italic: true },
      { text: 'b', bold: true, italic: true },
      { text: ' c', italic: true },
    ])
    expect(p('[**gras** lien](https://a.fr)')).toEqual([
      { text: 'gras', bold: true, link: 'https://a.fr' },
      { text: ' lien', link: 'https://a.fr' },
    ])
  })

  it('laisse les délimiteurs isolés tels quels', () => {
    expect(p('2 * 3 * 4')).toEqual([{ text: '2 * 3 * 4' }])
    expect(p('**pas fermé')).toEqual([{ text: '**pas fermé' }])
    expect(p('C++ et C++')).toEqual([{ text: 'C++ et C++' }])
    expect(p('snake_case_name')).toEqual([{ text: 'snake_case_name' }])
    expect(p('~ environ ~')).toEqual([{ text: '~ environ ~' }])
    expect(p('a ^ b ^ c')).toEqual([{ text: 'a ^ b ^ c' }])
    expect(p('* liste?')).toEqual([{ text: '* liste?' }])
  })

  it('respecte les échappements', () => {
    expect(p('\\*pas italique\\*')).toEqual([{ text: '*pas italique*' }])
    expect(p('a\\\\b')).toEqual([{ text: 'a\\b' }])
    expect(p('\\[pas un lien](x)')).toEqual([{ text: '[pas un lien](x)' }])
  })

  it('protège le code : rien n’y est interprété', () => {
    expect(p('`**x**`')).toEqual([{ text: '**x**', code: true }])
    expect(p('``a ` b``')).toEqual([{ text: 'a ` b', code: true }])
    expect(p('` a `')).toEqual([{ text: 'a', code: true }])
    expect(p('`pas fermé')).toEqual([{ text: '`pas fermé' }])
  })

  it('lit les formules LaTeX (sans y voir de mise en forme) et ne confond pas un prix avec une formule', () => {
    expect(p('Soit $x_1^2 + y_1^2$ et *z*')).toEqual([{ text: 'Soit ' }, { type: 'math', tex: 'x_1^2 + y_1^2' }, { text: ' et ' }, { text: 'z', italic: true }])
    expect(p('$$\\sum_{i=1}^n i$$')).toEqual([{ type: 'math', tex: '\\sum_{i=1}^n i' }])
    expect(p('Coûte 5 $ et 10 $')).toEqual([{ text: 'Coûte 5 $ et 10 $' }])
    expect(p('$5 et $10 *ici*')).toEqual([{ text: '$5 et $10 ' }, { text: 'ici', italic: true }])
    expect(p('$ x $ reste du texte')).toEqual([{ text: '$ x $ reste du texte' }])
    expect(p('\\$x\\$ échappé')).toEqual([{ text: '$x$ échappé' }])
    // \(…\) : ce qu'écrivent les IA.
    expect(p('soit \\(a^2\\) ici')).toEqual([{ text: 'soit ' }, { type: 'math', tex: 'a^2' }, { text: ' ici' }])
    // Dans du gras : la formule ne prend pas la mise en forme du texte (elle est dans son LaTeX).
    expect(p('**vaut $x$**')).toEqual([{ text: 'vaut ', bold: true }, { type: 'math', tex: 'x' }])
  })

  it('un paragraphe $$…$$ ou \\[…\\] seul est une équation centrée (numérotée si elle a un \\label)', () => {
    expect(parseMarkdown('$$\\int_0^1 x\\,dx$$')).toEqual([{ type: 'equation', tex: '\\int_0^1 x\\,dx' }])
    expect(parseMarkdown('Texte\n$$\na = b\n\\\\ c = d\n$$\nsuite')).toEqual([
      { type: 'paragraph', content: [{ text: 'Texte' }] },
      { type: 'equation', tex: 'a = b\n\\\\ c = d' },
      { type: 'paragraph', content: [{ text: 'suite' }] },
    ])
    expect(parseMarkdown('\\[ E = mc^2 \\label{e} \\]')).toEqual([{ type: 'equation', tex: 'E = mc^2 \\label{e}', numbered: true }])
    // Pas fermée : du texte ; quelque chose après la fermeture : du texte aussi.
    expect(parseMarkdown('$$ a\n\nb')).toEqual([{ type: 'paragraph', content: [{ text: '$$ a' }] }, { type: 'paragraph', content: [{ text: 'b' }] }])
    expect(parseMarkdown('$$a$$ et la suite')[0].type).toBe('paragraph')
  })

  it('ne crée jamais de lien dangereux, mais garde le texte', () => {
    const warns: string[] = []
    const r = parseInline('[clic](javascript:alert(1)) et [b](data:text/html,x)', (_c, d) => warns.push(d))
    expect(r).toEqual([{ text: 'clic et b' }])
    expect(warns).toHaveLength(2)
  })

  it('reconnaît les liens automatiques', () => {
    expect(p('<https://a.fr>')).toEqual([{ text: 'https://a.fr', link: 'https://a.fr' }])
    expect(p('<mailto:a@b.fr>')).toEqual([{ text: 'a@b.fr', link: 'mailto:a@b.fr' }])
  })

  it('accepte un titre et des chevrons dans la cible d’un lien', () => {
    expect(p('[a](https://a.fr "Titre")')).toEqual([{ text: 'a', link: 'https://a.fr' }])
    expect(p('[a](<https://a.fr/x y>)')).toEqual([{ text: 'a', link: 'https://a.fr/x y' }])
    expect(p('[a](https://fr.wikipedia.org/wiki/Paris_(France))')).toEqual([
      { text: 'a', link: 'https://fr.wikipedia.org/wiki/Paris_(France)' },
    ])
  })

  it('garde le HTML et les images en texte', () => {
    expect(p('<b>non</b> <script>x</script>')).toEqual([{ text: '<b>non</b> <script>x</script>' }])
    expect(p('![logo](img.png)')).toEqual([{ text: '![logo](img.png)' }])
  })

  it('gère les retours à la ligne', () => {
    expect(joinLines(['a', 'b'])).toBe('a b')
    expect(joinLines(['a  ', 'b'])).toBe('a\nb')
    expect(joinLines(['a\\', 'b'])).toBe('a\nb')
    expect(parseInlineField('un\ndeux  \ntrois')).toEqual([{ text: 'un deux\ntrois' }])
  })

  it('traite les caractères Unicode et les emoji', () => {
    expect(p('**été** 🎉 _ça_')).toEqual([{ text: 'été', bold: true }, { text: ' 🎉 ' }, { text: 'ça', italic: true }])
  })

  it('reste rapide sur une entrée pathologique et n’en perd aucune lettre', () => {
    const pieces = ['*', '_', '[', '`', '$', '~', '^', '+', '](', '\\']
    let nasty = ''
    for (const c of pieces) nasty += c.repeat(3000) + 'mot'
    for (let i = 0; i < 4000; i++) nasty += pieces[i % pieces.length] + 'x'
    const t = Date.now()
    const r = p(nasty)
    expect(Date.now() - t).toBeLessThan(2000)
    const letters = (s: string) => s.replace(/[^a-z]/g, '')
    expect(letters(r.map((x) => ('text' in x ? x.text : 'tex' in x ? x.tex : '')).join(''))).toBe(letters(nasty))
  })

  it('ne déborde pas la pile sur une imbrication énorme', () => {
    const deep = '*a '.repeat(30000) + 'b' + ' a*'.repeat(30000)
    expect(() => p(deep)).not.toThrow()
    const nested = '**'.repeat(20000) + 'x' + '**'.repeat(20000)
    expect(() => p(nested)).not.toThrow()
  })
})

describe('Markdown par blocs', () => {
  const md = (s: string) => parseMarkdown(s)
  const para = (text: string): Block => ({ type: 'paragraph', content: [{ text }] })

  it('titres ATX et soulignés', () => {
    expect(md('# Un\n## Deux ##\n###### Six')).toEqual([
      { type: 'heading', level: 1, content: [{ text: 'Un' }] },
      { type: 'heading', level: 2, content: [{ text: 'Deux' }] },
      { type: 'heading', level: 6, content: [{ text: 'Six' }] },
    ])
    expect(md('Grand\n===\n\nMoyen\n---')).toEqual([
      { type: 'heading', level: 1, content: [{ text: 'Grand' }] },
      { type: 'heading', level: 2, content: [{ text: 'Moyen' }] },
    ])
    expect(md('#pas un titre')).toEqual([para('#pas un titre')])
    expect(md('####### sept')).toEqual([para('####### sept')])
  })

  it('paragraphes séparés par des lignes vides', () => {
    expect(md('a\nb\n\n\nc')).toEqual([para('a b'), para('c')])
    expect(md('\r\n\r\nWindows\r\nligne\r\n')).toEqual([para('Windows ligne')])
    expect(md('')).toEqual([])
    expect(md('   \n\t\n')).toEqual([])
  })

  it('listes à puces, numérotées, imbriquées', () => {
    expect(md('- a\n- b\n  - b1\n    - b11\n- c')).toEqual([
      {
        type: 'list',
        style: 'bullet',
        start: 1,
        items: [
          { content: [{ text: 'a' }], level: 0, style: 'bullet' },
          { content: [{ text: 'b' }], level: 0, style: 'bullet' },
          { content: [{ text: 'b1' }], level: 1, style: 'bullet' },
          { content: [{ text: 'b11' }], level: 2, style: 'bullet' },
          { content: [{ text: 'c' }], level: 0, style: 'bullet' },
        ],
      },
    ])
    const ol = md('3. trois\n4. quatre\n   - puce')
    expect(ol).toEqual([
      {
        type: 'list',
        style: 'number',
        start: 3,
        items: [
          { content: [{ text: 'trois' }], level: 0, style: 'number' },
          { content: [{ text: 'quatre' }], level: 0, style: 'number' },
          { content: [{ text: 'puce' }], level: 1, style: 'bullet' },
        ],
      },
    ])
  })

  it('une liste d’un autre type au premier niveau commence une nouvelle liste', () => {
    const r = md('- a\n- b\n1. un\n2. deux')
    expect(r.map((b) => b.type === 'list' && b.style)).toEqual(['bullet', 'number'])
  })

  it('les puces *, + et - et les tabulations', () => {
    const r = md('* a\n+ b\n\t- c')
    expect(r).toHaveLength(1)
    const list = r[0] as Extract<Block, { type: 'list' }>
    expect(list.items.map((i) => i.level)).toEqual([0, 0, 1])
  })

  it('liste aérée et lignes de continuation', () => {
    const r = md('- a\n\n- b\n  suite de b\n\n  paragraphe de b\n\nFin')
    expect(r).toHaveLength(2)
    const list = r[0] as Extract<Block, { type: 'list' }>
    expect(list.items.map((i) => (i.content[0] as { text: string }).text)).toEqual(['a', 'b suite de b paragraphe de b'])
    expect(r[1]).toEqual(para('Fin'))
  })

  it('ligne de séparation et liste ne se confondent pas', () => {
    expect(md('---')).toEqual([{ type: 'divider' }])
    expect(md('* * *')).toEqual([{ type: 'divider' }])
    expect(md('- a\n---\n- b').map((b) => b.type)).toEqual(['list', 'divider', 'list'])
  })

  it('un paragraphe n’est interrompu que par « 1. » ou une puce', () => {
    expect(md('En 1999. Une belle année')).toEqual([para('En 1999. Une belle année')])
    expect(md('Texte\n2024. Rapport')).toEqual([para('Texte 2024. Rapport')])
    expect(md('Texte\n- puce').map((b) => b.type)).toEqual(['paragraph', 'list'])
  })

  it('citations, imbriquées', () => {
    expect(md('> a\n> b\n>\n> > c')).toEqual([
      {
        type: 'quote',
        blocks: [para('a b'), { type: 'quote', blocks: [para('c')] }],
      },
    ])
  })

  it('blocs de code clôturés, avec ou sans langage', () => {
    expect(md('```python\nif x:\n    print("**")\n```')).toEqual([
      { type: 'code', language: 'python', text: 'if x:\n    print("**")' },
    ])
    expect(md('~~~\na\n\nb\n~~~')).toEqual([{ type: 'code', language: '', text: 'a\n\nb' }])
    expect(md('```\nnon fermé\n# pas un titre')).toEqual([{ type: 'code', language: '', text: 'non fermé\n# pas un titre' }])
  })

  it('tableaux, y compris irréguliers et avec | échappé', () => {
    const r = md('| A | B |\n|:--|--:|\n| 1 | `a|b` |\n| x \\| y |\n| p | q | r |')
    expect(r).toHaveLength(1)
    const t = r[0] as Extract<Block, { type: 'table' }>
    expect(t.header).toBe(true)
    const text = t.rows.map((row) => row.map((c) => (c.blocks[0] as Extract<Block, { type: 'paragraph' }>).content.map((x) => ('text' in x ? x.text : '')).join('')))
    expect(text).toEqual([
      ['A', 'B', ''],
      ['1', 'a|b', ''],
      ['x | y', '', ''],
      ['p', 'q', 'r'],
    ])
    expect(splitRow('|a|b|')).toEqual(['a', 'b'])
  })

  it('le HTML reste du texte', () => {
    expect(md('<div onclick="x">salut</div>')).toEqual([para('<div onclick="x">salut</div>')])
  })

  it('document complet réaliste', () => {
    const r = md(
      [
        '# Compte rendu',
        '',
        'Réunion du **12 mars**.',
        '',
        '## Décisions',
        '',
        '1. Valider le budget',
        '2. Recruter',
        '',
        '| Poste | Coût |',
        '|---|---|',
        '| Matériel | 1 200 € |',
        '',
        '> Le plus dur est fait.',
      ].join('\n'),
    )
    expect(r.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'list', 'table', 'quote'])
  })
})
