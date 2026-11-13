// Phase 6 : équations et .docx (OMML), dans les deux sens.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { exportDocx } from '../../src/docx/export'
import { ommlToTex, treeToOmml, xmlOf } from '../../src/docx/omml'
import { parseXml } from '../../src/docx/xml'
import { parseTex, renderTex } from '../../src/math'
import { toMathML } from '../../src/math/mathml'
import { loadDocument } from '../../src/format/load'
import type { Block, FolioDoc } from '../../src/format/types'
import { NOW, open, parts } from './docx-helpers'
import { FORMULAS } from './gen'

const NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const omml = (tex: string, display = false) => xmlOf(treeToOmml(parseTex(tex, display), display))
/** OMML écrit à la main (comme Word) → LaTeX. */
const tex = (inner: string) => ommlToTex(parseXml(`<m:oMath ${NS}>${inner}</m:oMath>`))
const r = (t: string, pr = '') => `<m:r>${pr ? `<m:rPr>${pr}</m:rPr>` : ''}<m:t>${t}</m:t></m:r>`

function load(raw: Record<string, unknown>): FolioDoc {
  const l = loadDocument({ format: 'folio/doc', version: 1, ...raw }, { now: NOW })
  if (!l.ok) throw new Error('refusé')
  return l.doc
}

describe('LaTeX → OMML', () => {
  it('chaque structure a son équivalent', () => {
    expect(omml('\\frac{a}{b}')).toContain('<m:f><m:num><m:r><m:t xml:space="preserve">a</m:t></m:r></m:num><m:den>')
    expect(omml('\\sqrt{x}')).toContain('<m:degHide m:val="1"/>')
    expect(omml('\\sqrt[3]{x}')).toMatch(/<m:rad><m:deg><m:r><m:rPr><m:sty m:val="p"\/><\/m:rPr><m:t xml:space="preserve">3<\/m:t>/)
    expect(omml('x_i^2')).toContain('<m:sSubSup>')
    expect(omml('\\binom{n}{k}')).toContain('<m:type m:val="noBar"/>')
    expect(omml('\\left[ x \\right]')).toContain('<m:begChr m:val="["/><m:endChr m:val="]"/>')
    expect(omml('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')).toMatch(/<m:d>.*<m:m>.*<m:mr>.*<\/m:m>.*<\/m:d>/)
    expect(omml('\\hat{x} \\vec{v}')).toContain('<m:acc>')
    expect(omml('\\overline{AB}')).toContain('<m:bar><m:barPr><m:pos m:val="top"/>')
    expect(omml('\\underbrace{a+b}_{n}')).toContain('<m:groupChr>')
    expect(omml('\\text{si } x')).toContain('<m:nor/>')
    expect(omml('\\mathbb{R}')).toContain('<m:scr m:val="double-struck"/>')
    expect(omml('\\textcolor{red}{x}')).toContain('<w:color w:val="FF0000"/>')
    expect(omml('\\boxed{x}')).toContain('<m:borderBox>')
    expect(omml('\\sin x')).toContain('<m:sty m:val="p"/></m:rPr><m:t xml:space="preserve">sin</m:t>')
  })

  it('un grand opérateur prend pour argument ce qui suit, jusqu’à la relation', () => {
    const x = omml('\\sum_{k=1}^{n} k^2 = S', true)
    expect(x).toMatch(/^<m:oMathPara><m:oMathParaPr><m:jc m:val="center"\/><\/m:oMathParaPr><m:oMath>/)
    expect(x).toContain('<m:chr m:val="∑"/><m:limLoc m:val="undOvr"/>')
    // k² est dans l'argument (m:e) de la somme, « = S » après.
    expect(x).toMatch(/<m:e><m:sSup><m:e><m:r><m:t xml:space="preserve">k<\/m:t><\/m:r><\/m:e>.*<\/m:sSup><\/m:e><\/m:nary><m:r><m:t xml:space="preserve">=<\/m:t>/)
    expect(omml('\\int_0^1 f\\,dx')).toContain('<m:limLoc m:val="subSup"/>')
    expect(omml('\\oint')).toContain('<m:subHide m:val="1"/><m:supHide m:val="1"/>')
  })

  it('l’OMML produit est du XML bien formé, toujours borné', () => {
    for (const f of FORMULAS.slice(0, -1)) expect(() => parseXml(`<x ${NS}>${omml(f)}</x>`), f).not.toThrow()
    const deep = '\\frac{'.repeat(200) + 'x' + '}{y}'.repeat(200)
    expect(() => omml(deep)).not.toThrow()
  })
})

describe('OMML → LaTeX (fichiers d’autres traitements de texte)', () => {
  it('lit les structures courantes', () => {
    expect(tex(`<m:f><m:num>${r('a')}</m:num><m:den>${r('b')}</m:den></m:f>`)).toBe('\\frac{a}{b}')
    expect(tex(`<m:sSup><m:e>${r('x')}</m:e><m:sup>${r('2')}</m:sup></m:sSup>`)).toBe('x^2')
    expect(tex(`<m:sSubSup><m:e>${r('x')}</m:e><m:sub>${r('i')}</m:sub><m:sup>${r('n+1')}</m:sup></m:sSubSup>`)).toBe('x_i^{n+1}')
    // ∫ par défaut, bornes, argument.
    expect(tex(`<m:nary><m:naryPr><m:limLoc m:val="subSup"/></m:naryPr><m:sub>${r('0')}</m:sub><m:sup>${r('1')}</m:sup><m:e>${r('f')}</m:e></m:nary>`)).toBe('\\int_0^1 f')
    expect(tex(`<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${r('k=1')}</m:sub><m:sup>${r('n')}</m:sup><m:e>${r('k')}</m:e></m:nary>`)).toBe('\\sum_{k=1}^n k')
    expect(tex(`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${r('x')}</m:e></m:rad>`)).toBe('\\sqrt{x}')
    expect(tex(`<m:rad><m:deg>${r('3')}</m:deg><m:e>${r('x')}</m:e></m:rad>`)).toBe('\\sqrt[3]{x}')
    // Délimiteurs : parenthèses par défaut, séparateurs, matrices.
    expect(tex(`<m:d><m:e>${r('a')}</m:e><m:e>${r('b')}</m:e></m:d>`)).toBe('\\left( a | b \\right)')
    expect(tex(`<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e><m:m><m:mr><m:e>${r('1')}</m:e><m:e>${r('0')}</m:e></m:mr></m:m></m:e></m:d>`)).toBe('\\begin{bmatrix} 1 & 0 \\end{bmatrix}')
    expect(tex(`<m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/></m:dPr><m:e><m:m><m:mr><m:e>${r('1')}</m:e></m:mr></m:m></m:e></m:d>`)).toBe('\\begin{cases} 1 \\end{cases}')
    expect(tex(`<m:func><m:fName>${r('sin', '<m:sty m:val="p"/>')}</m:fName><m:e>${r('x')}</m:e></m:func>`)).toBe('\\sin x')
    expect(tex(`<m:limLow><m:e>${r('lim', '<m:sty m:val="p"/>')}</m:e><m:lim>${r('n→∞')}</m:lim></m:limLow>`)).toBe('\\lim_{n\\to \\infty}')
    expect(tex(`<m:acc><m:e>${r('x')}</m:e></m:acc>`)).toBe('\\hat{x}')
    expect(tex(`<m:acc><m:accPr><m:chr m:val="\u20D7"/></m:accPr><m:e>${r('v')}</m:e></m:acc>`)).toBe('\\vec{v}')
    expect(tex(`<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e>${r('x')}</m:e></m:bar>`)).toBe('\\underline{x}')
    expect(tex(`<m:eqArr><m:e>${r('a=b')}</m:e><m:e>${r('c=d')}</m:e></m:eqArr>`)).toBe('\\begin{aligned} a=b \\\\ c=d \\end{aligned}')
    expect(tex(`<m:borderBox><m:e>${r('x')}</m:e></m:borderBox>`)).toBe('\\boxed{x}')
    // Texte, police, lettres mathématiques Unicode, grec.
    expect(tex(r('si ', '<m:nor/>'))).toBe('\\text{si }')
    expect(tex(r('R', '<m:scr m:val="double-struck"/>'))).toBe('\\mathbb{R}')
    expect(tex(r('𝑥+α≤∞'))).toBe('x+\\alpha \\le \\infty')
  })

  it('tout ce qui en sort se rend, et le plus souvent à l’identique', () => {
    const common = JSON.parse(readFileSync(new URL('../fixtures/math/maths-common.json', import.meta.url), 'utf8')).mustRender as { src: string; display?: boolean }[]
    let renders = 0
    let same = 0
    let visible = 0
    for (const f of common) {
      const tree = parseTex(f.src, !!f.display)
      const ml = toMathML(tree, !!f.display)
      // Une formule sans rien de visible (\large seul, \\) ne compte pas.
      if (!/<m(i|n|o|text)[ >]/.test(ml)) continue
      visible++
      const back = ommlToTex(parseXml(xmlOf(treeToOmml(tree, false)).replace('<m:oMath', `<m:oMath ${NS}`)))
      const rr = renderTex(back, !!f.display)
      if (rr.html && !rr.error) renders++
      if (rr.html && toMathML(parseTex(back, !!f.display), !!f.display) === ml) same++
    }
    expect(renders).toBe(visible)
    expect(same / visible).toBeGreaterThan(0.7)
  })

  it('un OMML hostile reste borné (imbrication, taille)', () => {
    // Trop profond pour le lecteur XML : refusé d'emblée.
    expect(() => tex('<m:f><m:num>'.repeat(500) + r('x') + '</m:num><m:den/></m:f>'.repeat(500))).toThrow()
    // Assez profond pour lui, borné par la conversion.
    const deep = '<m:f><m:num>'.repeat(110) + r('x') + '</m:num><m:den/></m:f>'.repeat(110)
    expect(() => tex(deep)).not.toThrow()
    expect(tex(deep).length).toBeLessThan(2_000)
    const wide = r('x').repeat(30_000)
    expect(tex(wide).length).toBeLessThanOrEqual(20_000)
  })
})

describe('équations dans un fichier .docx', () => {
  const DOC = () =>
    load({
      math: { macros: '\\newcommand{\\vv}[1]{\\mathbf{#1}}' },
      blocks: [
        { content: ['Soit ', { type: 'math', tex: '\\vv{u} \\cdot \\vv{v}' }, ', voir ', { type: 'math', tex: '\\eqref{pyth}' }, '.'] },
        { type: 'equation', tex: 'a^2 + b^2 = c^2 \\label{pyth}', numbered: true },
        { type: 'equation', tex: '\\int_0^1 x\\,dx = \\frac{1}{2}' },
        { type: 'table', rows: [[{ blocks: [{ type: 'equation', tex: '\\ce{H2O}' }] }]] },
        { content: ['Note', { type: 'note', blocks: [{ type: 'equation', tex: 'e^{i\\pi} + 1 = 0' }] }] },
      ],
    })

  it('nos propres fichiers retrouvent la source exacte (macros, \\label, \\eqref)', async () => {
    const out = await exportDocx(DOC(), { now: new Date(NOW) })
    expect(out.losses).toEqual([])
    const p = parts(out.bytes)
    expect(p['word/document.xml']).toContain('<m:oMathPara>')
    expect(p['word/document.xml']).toMatch(/<w:tab\/><\/w:r><m:oMath>.*<w:tab\/><w:t xml:space="preserve">\(1\)<\/w:t>/)
    expect(p['customXml/item1.xml']).toContain('urn:folio-pages:equations')
    expect(p['word/_rels/document.xml.rels']).toContain('../customXml/item1.xml')
    expect(p['[Content_Types].xml']).toContain('/customXml/itemProps1.xml')
    const back = open(out.bytes)
    expect(back.issues).toEqual([])
    expect(back.res.losses).toEqual([])
    expect(back.doc.blocks.slice(0, 4)).toEqual(DOC().blocks.slice(0, 4))
    const note = back.doc.blocks[4]
    expect(note.type === 'paragraph' && note.content[1]).toMatchObject({ type: 'note', blocks: [{ type: 'equation', tex: 'e^{i\\pi} + 1 = 0' }] })
  })

  it('sans la partie des sources (fichier repassé ailleurs) : l’OMML est converti, et se rend', async () => {
    const files = unzipSync((await exportDocx(DOC(), { now: new Date(NOW) })).bytes)
    delete files['customXml/item1.xml']
    const back = open(zipSync(files))
    expect(back.res.losses).toEqual([])
    const all: string[] = []
    const walk = (bs: Block[]) => {
      for (const b of bs) {
        if (b.type === 'equation') all.push(b.tex)
        if (b.type === 'paragraph') for (const x of b.content) if ('type' in x && x.type === 'math') all.push(x.tex)
        if (b.type === 'table') for (const row of b.rows) for (const c of row) walk(c.blocks)
      }
    }
    walk(back.doc.blocks)
    expect(all).toHaveLength(5)
    for (const t of all) expect(renderTex(t, true).html, t).toBeTruthy()
    // La macro a été dépliée à l'export : 𝐮 en gras.
    expect(all[0]).toContain('\\mathbf{u}')
    const eq = back.doc.blocks.find((b) => b.type === 'equation' && b.numbered)
    expect(eq).toBeTruthy()
  })

  it('une équation modifiée ailleurs n’est pas remplacée par sa source d’origine', async () => {
    const files = unzipSync((await exportDocx(load({ blocks: [{ type: 'equation', tex: 'x = 1' }] }), { now: new Date(NOW) })).bytes)
    const xml = strFromU8(files['word/document.xml']).replace('<m:t xml:space="preserve">1</m:t>', '<m:t xml:space="preserve">2</m:t>')
    files['word/document.xml'] = strToU8(xml)
    expect(open(zipSync(files)).doc.blocks[0]).toEqual({ type: 'equation', tex: 'x=2' })
  })

  it('une formule illisible part en texte dans l’équation, et c’est dit', async () => {
    const out = await exportDocx(load({ blocks: [{ type: 'equation', tex: '\\frac{a}' }] }), { now: new Date(NOW) })
    expect(out.losses).toEqual([{ code: 'equation-error', count: 1 }])
    expect(parts(out.bytes)['word/document.xml']).toContain('\\frac{a}')
    expect(open(out.bytes).doc.blocks[0]).toEqual({ type: 'equation', tex: '\\frac{a}' })
  })
})

// LibreOffice, s'il est installé : nos équations deviennent ses formules.
const soffice = ['soffice', 'libreoffice'].find((c) => spawnSync(c, ['--version'], { timeout: 20_000 }).status === 0)

describe.skipIf(!soffice)('équations ouvertes par LibreOffice', () => {
  it('chaque équation devient un objet formule', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'folio-math-'))
    const doc = load({ blocks: [{ content: ['a ', { type: 'math', tex: '\\frac{1}{2}' }] }, { type: 'equation', tex: '\\sum_{k=1}^{n} k^2' }, { type: 'equation', tex: 'E = mc^2', numbered: true }] })
    writeFileSync(join(dir, 'eq.docx'), (await exportDocx(doc, { now: new Date(NOW) })).bytes)
    execFileSync(soffice!, ['--headless', `-env:UserInstallation=file://${dir}/profil`, '--convert-to', 'fodt', '--outdir', dir, join(dir, 'eq.docx')], { timeout: 120_000, stdio: 'ignore' })
    const fodt = readFileSync(join(dir, 'eq.fodt'), 'utf8')
    const formulas = fodt.match(/<math[\s>]/g) ?? []
    expect(formulas.length).toBe(3)
    expect(fodt).toContain('<mfrac')
    expect(fodt).toContain('∑')
  }, 180_000)
})
