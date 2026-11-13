import { describe, expect, it } from 'vitest'
import { extractDocBlock, recognizeHtml, spliceDocBlock } from '../../src/file/shell'
import { fileNameFor } from '../../src/file/save'

const shell = (body: string) =>
  `<!DOCTYPE html><html><head><meta name="generator" content="folio-pages 0.1.0">
<!-- guide : le bloc s'écrit <script type="application/folio+json" id="folio-doc"> … -->
<script type="application/folio+json" id="folio-doc">${body}</script>
<script id="folio-rt" type="folio/deflate-b86">abc</script></head><body></body></html>`

describe('bloc de document dans le texte du fichier', () => {
  it('trouve le vrai bloc, pas une mention dans un commentaire', () => {
    expect(extractDocBlock(shell('{"a":1}'))).toBe('{"a":1}')
    const spliced = spliceDocBlock(shell(''), '{"b":"<x>"}')!
    expect(extractDocBlock(spliced)).toBe('{"b":"\\u003cx>"}')
    expect(spliced).toContain('<!-- guide : le bloc s\'écrit <script type="application/folio+json" id="folio-doc"> … -->')
  })
  it('distingue bloc vide et bloc absent', () => {
    expect(extractDocBlock(shell(''))).toBe('')
    expect(extractDocBlock('<html><body>rien</body></html>')).toBeNull()
    expect(spliceDocBlock('<html></html>', '{}')).toBeNull()
  })
  it('normalise les fins de ligne Windows', () => {
    expect(extractDocBlock(shell('\r\n{"a":\r\n1}\r\n'))).toBe('{"a":\n1}')
  })
  it('n’est pas trompé par un attribut data-id', () => {
    const html = '<div data-id="folio-doc">x</div>' + shell('{"ok":true}')
    expect(extractDocBlock(html)).toBe('{"ok":true}')
  })
  it('reconnaît chaque sorte de fichier', () => {
    expect(recognizeHtml(shell(''))).toBe('blank-app')
    expect(recognizeHtml(shell('{"format":"folio/doc"}'))).toBe('document')
    expect(recognizeHtml(shell('{"format":"folio/enc","v":1}'))).toBe('encrypted')
    expect(recognizeHtml(shell('{}').replace('folio-pages 0.1.0', 'autre'))).toBe('foreign')
    expect(recognizeHtml('<html><script type="application/bento+json" id="bento-doc"></script></html>')).toBe('foreign')
  })
})

describe('nom de fichier', () => {
  it('nettoie les caractères interdits', () => {
    expect(fileNameFor('Rapport : version 2/3 ?')).toBe('Rapport version 2 3.html')
    expect(fileNameFor('   ')).toBe('Document.html')
    expect(fileNameFor('', 'Sans titre')).toBe('Sans titre.html')
    expect(fileNameFor('..cachée')).toBe('cachée.html')
    expect(fileNameFor('a\u0000b\nc')).toBe('a b c.html')
    expect(fileNameFor('x'.repeat(300))).toBe('x'.repeat(100) + '.html')
  })
})
