// Import .docx : le jeu de fichiers de test (tests/fixtures/docx), écrit par
// trois producteurs différents, et des fichiers hostiles ou abîmés.

import { describe, expect, it } from 'vitest'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { importDocx } from '../../src/docx/import'
import { DocxError } from '../../src/docx/zip'
import { loadDocument } from '../../src/format/load'
import { isSafeLink } from '../../src/format/spec'
import type { Block, BlockOf, FolioDoc, Inline } from '../../src/format/types'
import { NOW, allText, fixture, open } from './docx-helpers'

const of = <T extends Block['type']>(doc: FolioDoc, type: T): BlockOf<T>[] => doc.blocks.filter((b): b is BlockOf<T> => b.type === type)
const texts = (items: Inline[]) => items.map((x) => ('text' in x ? x.text : `{${x.type}}`)).join('')
const lossMap = (res: { losses: { code: string; count: number }[] }) => Object.fromEntries(res.losses.map((l) => [l.code, l.count]))
type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

/** Le texte visible d'un fichier (tous ses w:t du corps), pour vérifier qu'aucun ne manque. */
function sourceWords(bytes: Uint8Array): string[] {
  const xml = new TextDecoder().decode(unzipSync(bytes)['word/document.xml'])
  return [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim()).filter(Boolean)
}

describe('rapport (python-docx, gabarit d’un traitement de texte de bureau)', () => {
  const { doc, res, issues } = open(fixture('rapport.docx'))

  it('s’ouvre sans rien ignorer, propriétés et mise en page comprises', () => {
    expect(issues).toEqual([])
    expect(doc.meta).toMatchObject({ title: "Rapport d'activité 2025", author: 'Camille Besnard', subject: 'Bilan annuel', keywords: ['bilan', 'activité', 'atelier'] })
    expect(doc.page).toMatchObject({ size: 'A4', orientation: 'portrait', margins: { top: 20, right: 25, bottom: 20, left: 25 } })
    expect(texts((doc.headers.default[0] as Any).content)).toBe('Atelier des Tilleuls')
    expect((doc.headers.default[0] as Any).align).toBe('right')
    expect(texts((doc.footers.default[0] as Any).content)).toBe('Page {field} sur {field}')
    expect((doc.footers.default[0] as Any).content.filter((x: Any) => x.type === 'field').map((f: Any) => f.name)).toEqual(['page', 'pages'])
  })

  it('reprend les styles et le thème, sans styles parasites', () => {
    expect(doc.theme.colors.accent1).toBe('#4f81bd')
    expect(doc.theme.fonts).toMatchObject({ heading: 'Calibri', body: 'Cambria' })
    expect(doc.styles.title).toMatchObject({ size: 26, color: '#17365d' })
    expect(doc.styles.heading1).toMatchObject({ size: 14 })
    expect(doc.styles.heading2?.color).toBe('accent1')
    // Ni « List Bullet », ni « Header », ni les dizaines de styles latents du gabarit.
    expect(Object.keys(doc.styles).filter((k) => !/^(normal|title|subtitle|heading\d|quote|caption|footnote|code)$/.test(k))).toEqual([])
    expect(doc.blocks[0]).toMatchObject({ type: 'paragraph', style: 'title' })
    expect(doc.blocks[1]).toMatchObject({ type: 'paragraph', style: 'subtitle' })
    expect(of(doc, 'heading').map((h) => [h.level, texts(h.content)])).toEqual([[1, 'Résumé'], [1, 'Activités'], [2, 'Stages'], [2, 'Calendrier'], [1, 'Chiffres'], [1, 'Atelier en image'], [1, 'Annexe']])
  })

  it('garde la mise en forme des caractères et le lien', () => {
    const p = doc.blocks[3] as BlockOf<'paragraph'>
    expect(p.content).toEqual([
      { text: "L'année a été " },
      { text: 'très bonne', bold: true },
      { text: " pour l'atelier : " },
      { text: '312 stagiaires', italic: true },
      { text: ' accueillis, soit ' },
      { text: '+18 %', bold: true, color: '#1e6b55' },
      { text: ' par rapport à 2024. Le détail est sur ' },
      { text: "le site de l'atelier", link: 'https://exemple.org/bilan?annee=2025&vue=detail' },
      { text: '.' },
    ])
    const q = (doc.blocks[4] as BlockOf<'paragraph'>).content as Any[]
    expect(q.find((x) => x.text === 'souligné')).toMatchObject({ underline: true })
    expect(q.find((x) => x.text === 'barré')).toMatchObject({ strike: true })
    expect(q.find((x) => x.text === 'surligné')).toMatchObject({ highlight: 'yellow' })
    expect(q.filter((x) => x.text === '2').map((x) => (x.sub ? 'sub' : x.sup ? 'sup' : ''))).toEqual(['sub', 'sup'])
    expect(q.find((x) => x.text === 'grand')).toMatchObject({ size: 16, font: 'Georgia' })
    expect(q.find((x) => x.text === 'petites capitales')).toMatchObject({ smallcaps: true })
    expect(doc.blocks[5]).toMatchObject({ align: 'center', indent: { left: 36 }, spacing: { before: 12 }, content: [{ text: 'Un paragraphe centré, avec un retour\nà la ligne.' }] })
  })

  it('reconstruit les listes (les styles « Liste à puces 2 » deviennent un niveau), la citation', () => {
    const [bullets, numbers] = of(doc, 'list')
    expect(bullets.style).toBe('bullet')
    expect(bullets.items.map((i) => [i.level, texts(i.content)])).toEqual([[0, 'Menuiserie'], [0, 'Reliure'], [0, 'Céramique'], [1, 'Tournage'], [1, 'Émaillage']])
    expect(numbers).toMatchObject({ style: 'number', start: 1 })
    expect(numbers.items.map((i) => texts(i.content))).toEqual(['Inscriptions en janvier', 'Stages de février à juin', 'Exposition en septembre'])
    expect(of(doc, 'quote')[0].blocks).toEqual([{ type: 'paragraph', content: [{ text: 'Citation : « on apprend en faisant ».' }] }])
  })

  it('lit les tableaux : en-tête donné par le style, fusions horizontale et verticale', () => {
    const [a, b] = of(doc, 'table')
    expect(a.header).toBe(true)
    expect(a.style).toBe('grid')
    expect(a.rows.map((r) => r.map((c) => allCell(c)))).toEqual([['Stage', 'Inscrits', 'Recettes'], ['Menuiserie', '120', '14 400 €'], ['Reliure', '92', '8 280 €'], ['Total', '22 680 €']])
    expect(a.rows[3][0].colspan).toBe(2)
    expect(b.header).toBe(false)
    expect(b.rows[0][0]).toMatchObject({ rowspan: 2 })
    expect(b.rows.map((r) => r.length)).toEqual([2, 1])
  })

  it('intègre l’image avec sa légende, le commentaire, le saut de page et la section', () => {
    const img = of(doc, 'image')[0]
    expect(doc.assets[img.src.slice(6)]).toMatch(/^data:image\/png;base64,iVBOR/)
    expect(img.width).toBeCloseTo(170, 0)
    expect(img.align).toBe('center')
    expect(texts(img.caption)).toBe('Figure 1 — La salle de reliure')
    expect(doc.comments).toHaveLength(1)
    expect(doc.comments[0]).toMatchObject({ author: 'Noé Laurent', text: 'À confirmer avec la comptabilité.', resolved: false, replies: [] })
    const commented = doc.blocks.find((x) => x.type === 'paragraph' && (x.content[0] as Any)?.comments) as BlockOf<'paragraph'>
    expect(commented.content).toEqual([{ text: 'Un passage commenté par la direction.', comments: [doc.comments[0].id] }])
    expect(of(doc, 'pagebreak')).toHaveLength(1)
    // L'annexe est en paysage : la section garde sa propre mise en page.
    expect(of(doc, 'section')).toEqual([{ type: 'section', start: 'page', page: { size: 'A4', width: 210, height: 297, orientation: 'landscape', margins: { top: 20, right: 25, bottom: 20, left: 25 } } }])
    expect(lossMap(res)).toEqual({})
  })

  it('ne perd aucun texte', () => {
    const got = allText(doc)
    for (const w of sourceWords(fixture('rapport.docx'))) expect(got, w).toContain(w)
  })
})

const allCell = (c: { blocks: Block[] }) => c.blocks.map((b) => ('content' in b ? texts(b.content) : '')).join('|')

describe('lettre (LibreOffice)', () => {
  const { doc, res, issues } = open(fixture('lettre.docx'))

  it('s’ouvre sans perte : champs, notes, suivi, commentaire', () => {
    expect(issues).toEqual([])
    expect(res.losses).toEqual([])
    expect(doc.meta.title).toBe('Lettre aux adhérents')
    expect(doc.trackChanges).toBe(true)
    const first = doc.blocks[0] as BlockOf<'paragraph'>
    expect(first.align).toBe('right')
    expect(first.content).toEqual([{ text: 'Saint-Aubin, le ' }, { type: 'field', name: 'date', format: 'DD/MM/YYYY' }])
    expect(doc.blocks[1]).toMatchObject({ type: 'heading', level: 1, content: [{ text: 'Travaux de la salle des fêtes' }] })
    const p = (doc.blocks[2] as BlockOf<'paragraph'>).content as Any[]
    expect(p.find((x) => x.deleted)).toEqual({ text: 'provisoirement ', deleted: { author: 'Léa Roy', date: '2026-03-02T09:31:00.000Z' } })
    expect(p.find((x) => x.inserted)).toMatchObject({ text: 'd’importants ', inserted: { author: 'Léa Roy' } })
    expect(p.find((x) => x.bold)).toMatchObject({ text: '3 au 21 avril' })
    const notes = p.filter((x) => x.type === 'note')
    expect(notes.map((n) => [n.kind, texts(n.blocks[0].content)])).toEqual([['foot', 'Dates sous réserve de la météo.'], ['end', 'Délibération du 12 février.']])
    const c = (doc.blocks[3] as BlockOf<'paragraph'>).content as Any[]
    expect(c.find((x) => x.comments)).toEqual({ text: 'déplacées au gymnase', comments: [doc.comments[0].id] })
    expect(doc.comments[0]).toMatchObject({ author: 'Paul Meyer', date: '2026-03-02T11:00:00.000Z', text: 'Vérifier avec le club de danse.' })
    expect(c.find((x) => x.link)).toEqual({ text: 'le calendrier', link: 'https://exemple.org/travaux' })
    expect(c.find((x) => x.italic)).toEqual({ text: 'les horaires', italic: true, color: '#b7791f' })
  })

  it('listes imbriquées, tableau à bordures portées par les cellules, image, tabulation', () => {
    const [bullets, numbers] = of(doc, 'list')
    expect(bullets.items.map((i) => [i.level, i.style, texts(i.content)])).toEqual([[0, 'bullet', 'Danse : lundi'], [1, 'bullet', 'Débutants à 18 h'], [0, 'bullet', 'Théâtre : jeudi']])
    expect(numbers.items.map((i) => [i.level, i.style])).toEqual([[0, 'number'], [0, 'number'], [1, 'number'], [0, 'number']])
    const t = of(doc, 'table')[0]
    expect(t).toMatchObject({ header: true, style: 'grid', align: 'center' })
    expect(t.widths).toEqual([227, 113.5])
    expect(t.rows[0].map((c) => c.bg)).toEqual(['#dde8cb', '#dde8cb'])
    expect((t.rows[1][1].blocks[0] as Any).align).toBe('right')
    expect(of(doc, 'image')[0]).toMatchObject({ alt: 'Plan de la salle', width: 127.5 })
    expect(texts((doc.blocks[doc.blocks.length - 1] as BlockOf<'paragraph'>).content)).toBe('Veuillez agréer nos salutations.\tLe maire')
    // La mise en forme directe qui répète le style n'encombre pas les paragraphes.
    expect(Object.keys(doc.blocks[3])).toEqual(['type', 'content'])
    expect(texts((doc.footers.default[0] as Any).content)).toBe('Page {field} sur {field}')
    const got = allText(doc)
    // (La date du jour écrite par le champ n'est pas du texte : le champ la recalcule.)
    for (const w of sourceWords(fixture('lettre.docx')).filter((x) => !/^\d\d\/\d\d\/\d{4}$/.test(x))) expect(got, w).toContain(w)
  })
})

describe('CV (page web convertie par LibreOffice)', () => {
  const { doc, res, issues } = open(fixture('cv.docx'))

  it('reconnaît les styles traduits : citation, texte préformaté, ligne horizontale', () => {
    expect(issues).toEqual([])
    expect(res.losses).toEqual([])
    expect(of(doc, 'quote')[0].blocks[0]).toMatchObject({ content: [{ text: '« Rigoureuse et pédagogue. »' }] })
    expect(of(doc, 'code')[0].text).toBe('python simulate.py --debit 12')
    expect(of(doc, 'divider')).toHaveLength(1)
    const langs = doc.blocks.find((b) => b.type === 'paragraph' && texts(b.content).startsWith('Français')) as BlockOf<'paragraph'>
    expect((langs.content as Any[]).find((x) => x.text === 'B1')).toEqual({ text: 'B1', sup: true })
    const t = of(doc, 'table')[0]
    expect(t).toMatchObject({ header: false, style: 'minimal' })
    expect(t.rows[0][1].blocks.map((b) => b.type)).toEqual(['paragraph', 'list'])
    const head = doc.blocks[1] as BlockOf<'paragraph'>
    expect((head.content as Any[]).filter((x) => x.link).map((x) => x.link)).toEqual(['mailto:jeanne.morel@exemple.org', 'https://exemple.org/jmorel'])
    const got = allText(doc)
    for (const w of sourceWords(fixture('cv.docx'))) expect(got, w).toContain(w)
  })
})

describe('compte rendu (dialecte d’un traitement de texte de bureau, écrit à la main)', () => {
  const { doc, res, issues } = open(fixture('compte-rendu.docx'))

  it('signale ce qui n’a pas d’équivalent, et rien d’autre', () => {
    expect(issues).toEqual([])
    // (Le MERGEFIELD est un vrai champ de fusion : plus de perte « champ ».)
    expect(lossMap(res)).toEqual({ 'heading-number': 2, 'hidden-text': 1, symbol: 1, textbox: 1, 'image-format': 1 })
  })

  it('propriétés, thème, notes, première page différente, numérotation des pages', () => {
    expect(doc.meta).toMatchObject({ title: 'Compte rendu & décisions', author: 'Inès Faure', organization: 'Syndicat des eaux', keywords: ['pilotage', 'budget'], lang: 'fr-FR', created: '2026-04-12T14:00:00.000Z' })
    expect(doc.theme.colors).toMatchObject({ text: '#000000', accent1: '#156082', accent2: '#e97132' })
    expect(doc.theme.fonts).toMatchObject({ heading: 'Aptos Display', body: 'Aptos' })
    expect(doc.notes).toEqual({ foot: { format: 'symbols', start: 1, restart: 'page' }, end: { format: 'decimal', start: 1, restart: 'continuous' } })
    expect(doc.page).toMatchObject({ firstPage: true, evenOdd: false, numberStart: 3, numberFormat: 'roman' })
    expect(doc.headers.first).toEqual([])
    expect(texts((doc.headers.default[0] as Any).content)).toBe('Comité de pilotage\t{field}')
    expect(doc.trackChanges).toBe(true)
  })

  it('table des matières : un bloc à jour, pas ses entrées recopiées', () => {
    expect(of(doc, 'toc')).toEqual([{ type: 'toc', levels: 2, title: 'Sommaire' }])
    expect(allText(doc)).not.toContain('1 Décisions')
    expect(doc.blocks.slice(0, 2).map((b) => (b as Any).style)).toEqual(['title', 'subtitle'])
    expect((doc.blocks[1] as Any).content[1]).toEqual({ type: 'field', name: 'date', format: 'D MMMM YYYY' })
  })

  it('suivi des modifications, notes avec lien, commentaires avec réponse et résolution', () => {
    const p = (doc.blocks[4] as BlockOf<'paragraph'>).content as Any[]
    expect(p.slice(0, 5)).toEqual([
      { text: 'Le comité valide le ' },
      { text: 'nouveau ', inserted: { author: 'Inès Faure', date: '2026-04-12T15:02:00.000Z' } },
      { text: 'calendrier' },
      { text: ' provisoire', deleted: { author: 'Inès Faure', date: '2026-04-12T15:03:00.000Z' } },
      { text: '.' },
    ])
    const [foot, end] = p.filter((x) => x.type === 'note')
    expect(foot.blocks[0].content).toEqual([{ text: 'Adopté à l’unanimité, voir ' }, { text: 'le relevé', link: 'https://exemple.org/releve' }, { text: '.' }])
    expect(end).toMatchObject({ kind: 'end', blocks: [{ content: [{ text: 'Annexe B, page 4.' }] }] })
    expect(doc.comments).toEqual([
      { id: 'c0', author: 'Marc Aubry', date: '2026-04-13T08:00:00.000Z', text: 'Juin ou juillet ?', resolved: true, replies: [{ author: 'Inès Faure', date: '2026-04-13T09:30:00.000Z', text: 'Juin, c’est acté.' }] },
      { id: 'c2', author: 'Marc Aubry', date: '2026-04-14T10:00:00.000Z', text: 'Premier paragraphe.\nSecond paragraphe.', resolved: false, replies: [] },
    ])
    const c = (doc.blocks[5] as BlockOf<'paragraph'>).content as Any[]
    expect(c[0]).toEqual({ text: 'Le prestataire sera choisi en juin', comments: ['c0'] })
    expect(c.find((x) => x.text === 'trois')).toEqual({ text: 'trois', bold: true, color: 'accent2' })
    expect(c.find((x) => x.code)).toEqual({ text: 'npm run build', code: true })
    // Un commentaire sans étendue porte sur le texte qui précède ; le texte masqué n'est pas importé.
    expect((doc.blocks[6] as Any).content).toEqual([{ text: 'Un commentaire sans étendue', comments: ['c2'] }, { text: ' et du texte visible.' }])
  })

  it('listes : coupée puis reprise, recommencée, puce personnalisée', () => {
    const lists = of(doc, 'list')
    expect(lists.map((l) => [l.style, l.start, !!l.continue, l.items.length])).toEqual([['number', 1, false, 4], ['number', 1, true, 1], ['number', 1, false, 1], ['bullet', 1, false, 1]])
    expect(lists[0].items.map((i) => i.level)).toEqual([0, 1, 1, 0])
    expect(lists[3].bullet).toBe('–')
    expect(doc.blocks.find((b) => b.type === 'paragraph' && texts(b.content).startsWith('(Les auditions'))).toMatchObject({ indent: { left: 36 } })
  })

  it('style personnel repris avec sa mise en forme ; titres numérotés devenus des titres', () => {
    expect(doc.styles.Encadr).toMatchObject({ name: 'Encadré', basedOn: 'normal', bold: true, shading: '#e8f1f5', border: '#156082', indent: { left: 14, right: 14 } })
    expect(doc.blocks.find((b) => b.type === 'paragraph' && b.style === 'Encadr')).toMatchObject({ content: [{ text: 'Note importante pour le comité.' }] })
    expect(of(doc, 'heading').map((h) => texts(h.content))).toEqual(['Décisions'])
    expect(doc.styles.heading1).toMatchObject({ size: 20, color: '#0f4761', bold: false })
  })

  it('équation, zone de texte, liens : le texte reste, les liens dangereux disparaissent', () => {
    const text = allText(doc)
    // L'équation est une formule : sa fraction en LaTeX.
    expect(text).toContain('Coût par usager : $\\frac{C}{n}=42$ euros.')
    expect(text).toContain('À retenir : la réunion suivante est le 14 mai.')
    expect(text.match(/À retenir/g)).toHaveLength(1)
    const links = doc.blocks.find((b) => b.type === 'paragraph' && texts(b.content).startsWith('lien douteux')) as BlockOf<'paragraph'>
    expect(links.content).toEqual([{ text: 'lien douteux ; ' }, { text: 'lien par champ', link: 'https://exemple.org/pilotage' }, { text: ' ; fusion : ' }, { type: 'mergefield', name: 'Prenom' }, { text: ' ; ' }, { type: 'field', name: 'author', format: '' }])
    expect(JSON.stringify(doc)).not.toContain('javascript:')
    const i = doc.blocks.findIndex((b) => b.type === 'pagebreak')
    expect([doc.blocks[i - 1], doc.blocks[i + 1]].map((b) => texts((b as Any).content))).toEqual(['Avant le saut.', 'Après le saut.'])
  })

  it('sections : colonnes, puis nouvelle section avec son pied de page', () => {
    const cols = of(doc, 'columns')[0]
    expect(cols).toMatchObject({ count: 2, gap: 28.5, rule: true })
    expect(cols.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'columnbreak', 'paragraph'])
    const s = of(doc, 'section')[0]
    expect(s).toMatchObject({ start: 'odd', numberStart: 1 })
    expect(texts((s.footers!.default[0] as Any).content)).toBe('Syndicat des eaux — {field} pages')
    expect(doc.blocks.indexOf(s)).toBeGreaterThan(doc.blocks.indexOf(cols))
  })

  it('tableau en traits horizontaux, image rognée avec légende, image non affichable, filet, code', () => {
    const t = of(doc, 'table')[0]
    expect(t).toMatchObject({ header: true, style: 'lines', align: 'center', border: '#808080', widths: [150, 100, 100] })
    expect(t.rows[1][0]).toMatchObject({ rowspan: 2, valign: 'middle' })
    expect(t.rows[1][2].bg).toBe('#fff2cc')
    expect(t.rows[2]).toHaveLength(1)
    expect(t.rows[2][0].colspan).toBe(2)
    const imgs = of(doc, 'image')
    expect(imgs).toHaveLength(2)
    expect(imgs[0]).toMatchObject({ alt: 'Schéma du réseau', width: 150, crop: { left: 10, right: 10, top: 0, bottom: 0 } })
    expect(texts(imgs[0].caption)).toBe('Figure 1 : schéma du réseau')
    expect(imgs[1]).toMatchObject({ alt: 'Logo', width: 60 })
    expect(Object.keys(doc.assets)).toHaveLength(1)
    expect(of(doc, 'divider')).toHaveLength(1)
    expect(of(doc, 'code')).toEqual([{ type: 'code', language: '', text: 'print("bonjour")\n  return 1' }])
    expect(doc.blocks[doc.blocks.length - 1]).toMatchObject({ align: 'justify', line: 1.8, spacing: { before: 12 }, indent: { first: 14 } })
  })
})

describe('fichiers hostiles ou abîmés', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  const make = (body: string, extra: Record<string, string> = {}) =>
    zipSync(Object.fromEntries(Object.entries({ 'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`, ...extra }).map(([k, v]) => [k, strToU8(v)])))
  const code = (data: Uint8Array) => {
    try {
      importDocx(data)
      return 'ok'
    } catch (e) {
      return e instanceof DocxError ? e.code : `autre : ${String(e)}`
    }
  }

  it('dit ce qui ne va pas, par un code, sans autre exception', () => {
    expect(code(strToU8('pas une archive du tout'))).toBe('not-zip')
    expect(code(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]))).toBe('old-format')
    expect(code(zipSync({ 'mimetype': strToU8('application/vnd.oasis.opendocument.text'), 'content.xml': strToU8('<a/>') }))).toBe('not-docx')
    expect(code(zipSync({ 'word/document.xml': strToU8('<w:document><w:body>') }))).toBe('damaged')
    expect(code(zipSync({ 'word/document.xml': strToU8('<html><body/></html>') }))).toBe('not-docx')
    expect(code(make('<w:p/>').slice(0, 60))).toBe('damaged')
    expect(code(zipSync({ 'word/document.xml': strToU8('<!DOCTYPE x [<!ENTITY a "aaaa">]><w:document><w:body/></w:document>') }))).toBe('damaged')
  })

  it('un document minimal, sans styles ni relations, s’ouvre', () => {
    const { doc, issues } = open(make('<w:p><w:r><w:t>Bonjour</w:t></w:r></w:p>'))
    expect(issues).toEqual([])
    expect(doc.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'Bonjour' }] }])
    expect(doc.page.size).toBe('A4')
    expect(open(make('')).doc.blocks).toEqual([])
  })

  it('les parties annexes abîmées n’empêchent pas d’ouvrir le texte', () => {
    const rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="a" Type="x/styles" Target="styles.xml"/><Relationship Id="b" Type="x/numbering" Target="numbering.xml"/><Relationship Id="c" Type="x/comments" Target="comments.xml"/><Relationship Id="d" Type="x/footnotes" Target="footnotes.xml"/><Relationship Id="e" Type="x/theme" Target="theme/theme1.xml"/></Relationships>'
    const bytes = make('<w:p><w:pPr><w:pStyle w:val="X"/><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Texte</w:t><w:footnoteReference w:id="3"/></w:r></w:p>', {
      'word/_rels/document.xml.rels': rels,
      'word/styles.xml': '<w:styles><w:style',
      'word/numbering.xml': 'pas du xml',
      'word/comments.xml': '<w:comments><w:comment></w:comments>',
      'word/footnotes.xml': '',
      'word/theme/theme1.xml': '<a:theme><a:themeElements>',
    })
    expect(allText(open(bytes).doc)).toContain('Texte')
  })

  it('liens et images : rien de dangereux ne passe', () => {
    const rels =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'vbscript:x', 'https://exemple.org/ok'].map((t, i) => `<Relationship Id="l${i}" Type="x/hyperlink" Target="${t.replace(/</g, '&lt;')}" TargetMode="External"/>`).join('') +
      '<Relationship Id="img" Type="x/image" Target="https://pisteur.exemple.org/pixel.png" TargetMode="External"/><Relationship Id="evade" Type="x/image" Target="../../../../etc/passwd"/><Relationship Id="html" Type="x/image" Target="media/x.png"/></Relationships>'
    const pic = (rid: string) => `<w:p><w:r><w:drawing><wp:inline xmlns:wp="x"><wp:extent cx="12700" cy="12700"/><a:blip xmlns:a="y" r:embed="${rid}"/></wp:inline></w:drawing></w:r></w:p>`
    const body =
      [0, 1, 2, 3, 4].map((i) => `<w:p><w:hyperlink r:id="l${i}"><w:r><w:t>lien ${i}</w:t></w:r></w:hyperlink></w:p>`).join('') +
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "javascript:alert(2)" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>champ</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>` +
      pic('img') + pic('evade') + pic('html') + pic('absent')
    const res = importDocx(make(body, { 'word/_rels/document.xml.rels': rels, 'word/media/x.png': '<html><script>alert(3)</script></html>' }))
    const l = loadDocument(res.doc, { now: NOW })
    if (!l.ok) throw new Error('refusé')
    expect(l.report.issues).toEqual([])
    const links: string[] = []
    JSON.stringify(l.doc, (k, v) => {
      if (k === 'link') links.push(v)
      return v
    })
    expect(links).toEqual(['https://exemple.org/ok'])
    for (const href of links) expect(isSafeLink(href)).toBe(true)
    expect(allText(l.doc)).toContain('lien 0')
    expect(allText(l.doc)).toContain('champ')
    expect(l.doc.assets).toEqual({})
    expect(l.doc.blocks.some((b) => b.type === 'image')).toBe(false)
    expect(lossMap(res)).toEqual({ 'image-missing': 3, 'image-format': 1 })
    expect(JSON.stringify(l.doc)).not.toMatch(/javascript:|<script|pisteur|passwd/)
  })

  it('champs jamais refermés, imbrications profondes, valeurs absurdes : pas de blocage', () => {
    const open5 = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'.repeat(200) + '<w:r><w:t>après</w:t></w:r>'
    expect(() => open(make(`<w:p>${open5}</w:p><w:p><w:r><w:t>suite</w:t></w:r></w:p>`))).not.toThrow()
    const nested = '<w:tbl><w:tr><w:tc>'.repeat(40) + '<w:p><w:r><w:t>au fond</w:t></w:r></w:p>' + '</w:tc></w:tr></w:tbl>'.repeat(40)
    const deep = open(make(nested))
    expect(allText(deep.doc)).toContain('au fond')
    expect(deep.issues).toEqual([])
    expect(lossMap(deep.res)).toEqual({ 'nested-table': 39 })
    const silly = open(
      make(
        '<w:p><w:pPr><w:ind w:left="99999999" w:hanging="-5"/><w:spacing w:before="-400" w:line="0"/><w:numPr><w:ilvl w:val="99"/><w:numId w:val="-3"/></w:numPr></w:pPr><w:r><w:rPr><w:sz w:val="99999"/><w:color w:val="zzzzzz"/></w:rPr><w:t>x</w:t></w:r></w:p>' +
          '<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="5000"/><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>' +
          '<w:sectPr><w:pgSz w:w="1" w:h="99999999"/><w:pgMar w:top="-99999" w:left="9999999"/><w:cols w:num="400"/></w:sectPr>',
      ),
    )
    expect(allText(silly.doc)).toContain('x')
    expect(silly.doc.page.margins.left).toBeLessThanOrEqual(200)
  })

  it('un style qui hérite de lui-même, une numérotation en boucle : pas de boucle sans fin', () => {
    const styles = `<w:styles ${W}><w:style w:type="paragraph" w:styleId="A"><w:name w:val="A"/><w:basedOn w:val="B"/></w:style><w:style w:type="paragraph" w:styleId="B"><w:name w:val="B"/><w:basedOn w:val="A"/><w:rPr><w:b/></w:rPr></w:style></w:styles>`
    const { doc } = open(make('<w:p><w:pPr><w:pStyle w:val="A"/></w:pPr><w:r><w:t>boucle</w:t></w:r></w:p>', { 'word/styles.xml': styles }))
    expect(allText(doc)).toContain('boucle')
    expect(doc.styles.A).toMatchObject({ bold: true })
  })
})
