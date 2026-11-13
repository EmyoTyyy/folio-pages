// Lecteur XML des fichiers .docx et lecture d'archive : ce qu'ils acceptent,
// et surtout ce qu'ils refusent.

import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { XML_LIMITS, XmlError, attr, child, decodeEntities, descendants, escapeXml, kids, num, onOff, parseXml, path, textOf } from '../../src/docx/xml'
import { DocxError, ZIP_LIMITS, openArchive, resolveTarget } from '../../src/docx/zip'

describe('lecteur XML', () => {
  it('lit éléments, attributs, texte, CDATA, et saute commentaires et instructions', () => {
    const root = parseXml(`﻿<?xml version="1.0"?><!-- c --><w:a x="1" y='deux &amp; "trois"'><w:b/>texte &lt;b&gt; &#233;&#x1F600;<![CDATA[<brut> & ]]><w:c n="4">fin</w:c><?pi x?></w:a>`)
    expect(root.name).toBe('w:a')
    expect(root.attrs).toEqual({ x: '1', y: 'deux & "trois"' })
    expect(root.children.map((c) => c.name)).toEqual(['w:b', 'w:c'])
    expect(root.text).toBe('texte <b> é😀<brut> & ')
    expect(textOf(root)).toBe('texte <b> é😀<brut> & fin')
    expect(num(child(root, 'w:c'), 'n')).toBe(4)
    expect(attr(root, 'x')).toBe('1')
    expect(kids(root, 'w:b')).toHaveLength(1)
    expect(path(root, 'w:c')?.text).toBe('fin')
    expect(path(root, 'w:x', 'w:y')).toBeUndefined()
  })

  it('garde les espaces du texte et l’ordre des descendants', () => {
    const root = parseXml('<r><t xml:space="preserve">  a  </t><g><t>b</t><g><t>c</t></g></g><t>d</t></r>')
    expect(descendants(root, 't').map((t) => t.text)).toEqual(['  a  ', 'b', 'c', 'd'])
  })

  it('propriétés à bascule : présent = vrai, « 0 », « false », « off » = faux', () => {
    const p = parseXml('<p><w:b/><w:i w:val="0"/><w:u w:val="false"/><w:s w:val="off"/><w:c w:val="1"/><w:d w:val="true"/></p>')
    expect(p.children.map((c) => onOff(c))).toEqual([true, false, false, false, true, true])
    expect(onOff(undefined)).toBeUndefined()
  })

  it('refuse un DOCTYPE : aucune entité à développer, donc pas de « bombe » d’entités', () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><lolz>&lol2;</lolz>`
    expect(() => parseXml(bomb)).toThrow(XmlError)
    expect(() => parseXml('<!DOCTYPE a SYSTEM "file:///etc/passwd"><a/>')).toThrow('doctype')
  })

  it('une entité inconnue reste du texte ; les caractères de contrôle sont retirés', () => {
    expect(decodeEntities('&xxe; &amp; &#0; &#8; &#9; &#xD800; &#1114112;')).toBe('&xxe; &   \t  ')
    expect(decodeEntities('sans entité')).toBe('sans entité')
  })

  it('refuse le XML mal formé, sans jamais boucler', () => {
    for (const bad of ['', '<a>', '<a></b>', '<a><b></a></b>', '</a>', '<a x=1/>', '<a x="1/>', '<a><!-- </a>', '<a><![CDATA[ </a>', '< a/>', '<a/', '<a x/>', 'texte seul', '<?xml version="1.0"?>']) {
      expect(() => parseXml(bad), JSON.stringify(bad)).toThrow(XmlError)
    }
  })

  it('borne la profondeur, le nombre de nœuds et la taille', () => {
    const deep = '<a>'.repeat(XML_LIMITS.depth + 5) + '</a>'.repeat(XML_LIMITS.depth + 5)
    expect(() => parseXml(deep)).toThrow('too-deep')
    const ok = '<a>'.repeat(XML_LIMITS.depth - 2) + '</a>'.repeat(XML_LIMITS.depth - 2)
    expect(parseXml(ok).name).toBe('a')
    const saved = { ...XML_LIMITS }
    try {
      XML_LIMITS.nodes = 10
      expect(() => parseXml(`<a>${'<b/>'.repeat(20)}</a>`)).toThrow('too-many-nodes')
      XML_LIMITS.chars = 10
      expect(() => parseXml('<a>trop long pour la borne</a>')).toThrow('too-large')
    } finally {
      Object.assign(XML_LIMITS, saved)
    }
  })

  it('échappe le texte écrit dans du XML', () => {
    expect(escapeXml(`a<b>&"c'`)).toBe('a&lt;b&gt;&amp;&quot;c&apos;')
    expect(parseXml(`<a v="${escapeXml(`<&"'>`)}"/>`).attrs.v).toBe(`<&"'>`)
  })
})

describe('archive .docx', () => {
  const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))

  it('ne lit que les parties utiles, et reconnaît ce qui n’est pas une archive', () => {
    const a = openArchive(zip({ 'word/document.xml': '<a/>', '[Content_Types].xml': '<t/>', 'autre/secret.xml': '<x/>', 'word/../../evasion.xml': '<y/>', 'docProps/core.xml': '<c/>' }))
    expect(a.text('word/document.xml')).toBe('<a/>')
    expect(a.text('docProps/core.xml')).toBe('<c/>')
    expect(a.text('autre/secret.xml')).toBeUndefined()
    expect(a.text('word/../../evasion.xml')).toBeUndefined()
    expect(a.bytes('toString')).toBeUndefined()
    const code = (data: Uint8Array) => {
      try {
        openArchive(data)
        return 'ok'
      } catch (e) {
        return e instanceof DocxError ? e.code : 'autre'
      }
    }
    expect(code(strToU8('<html>pas une archive</html>'))).toBe('not-zip')
    expect(code(new Uint8Array(0))).toBe('not-zip')
    expect(code(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toBe('old-format')
    const cut = zip({ 'word/document.xml': '<a>' + 'x'.repeat(5000) + '</a>' })
    expect(code(cut.slice(0, cut.length - 40))).toBe('damaged')
  })

  it('refuse une archive qui annonce trop de données', () => {
    const saved = { ...ZIP_LIMITS }
    const big = zip({ 'word/document.xml': '<a>' + ' '.repeat(50_000) + '</a>', 'word/media/image1.png': 'x'.repeat(30_000) })
    try {
      ZIP_LIMITS.xml = 10_000
      expect(() => openArchive(big)).toThrow('too-large')
      Object.assign(ZIP_LIMITS, saved)
      // Une image trop lourde est seulement laissée de côté.
      ZIP_LIMITS.media = 1_000
      const a = openArchive(big)
      expect(a.bytes('word/media/image1.png')).toBeUndefined()
      expect([...a.skipped]).toEqual(['word/media/image1.png'])
      Object.assign(ZIP_LIMITS, saved)
      ZIP_LIMITS.total = 20_000
      expect(() => openArchive(big)).toThrow('too-large')
      Object.assign(ZIP_LIMITS, saved)
      ZIP_LIMITS.entries = 1
      expect(() => openArchive(big)).toThrow('too-large')
      Object.assign(ZIP_LIMITS, saved)
      ZIP_LIMITS.archive = 100
      expect(() => openArchive(big)).toThrow('too-large')
    } finally {
      Object.assign(ZIP_LIMITS, saved)
    }
  })

  it('résout les cibles des relations', () => {
    expect(resolveTarget('word/document.xml', 'media/image1.png')).toBe('word/media/image1.png')
    expect(resolveTarget('word/document.xml', '../docProps/core.xml')).toBe('docProps/core.xml')
    expect(resolveTarget('word/document.xml', '/word/styles.xml')).toBe('word/styles.xml')
    expect(resolveTarget('word/sub/part.xml', './x.xml')).toBe('word/sub/x.xml')
  })
})
