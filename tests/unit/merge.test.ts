// Publipostage : listes de destinataires, fusion, format, aller-retour .docx.

import { describe, expect, it } from 'vitest'
import { exportDocx } from '../../src/docx/export'
import { docToPM, pmToDoc } from '../../src/editor/convert'
import { toCompact } from '../../src/format/compact'
import { loadDocument } from '../../src/format/load'
import { parseMarkdown } from '../../src/format/markdown'
import type { Block, FolioDoc, MailMerge } from '../../src/format/types'
import { addressLines, checkMerge, emailMessages, fillinPrompts, greetingText, LABEL_PRESETS, mergeDocument, plainText, recipients, test as cond } from '../../src/merge/engine'
import { bccList, blocksHtml, composeUrl, emlMessage, emlName, fitsInUrl, isEmail, MAILTO_MAX, MAX_ADDRESSES, parseAddresses } from '../../src/merge/mail'
import { guessMap, parseCsv, parseJsonSource, parseSourceFile, parseVcf, SOURCE_LIMITS, toCsv } from '../../src/merge/source'
import { NOW, open } from './docx-helpers'

const load = (v: Record<string, unknown>) => {
  const r = loadDocument({ format: 'folio/doc', version: 1, ...v }, { now: NOW })
  if (!r.ok) throw new Error('refusé')
  return r
}
const docOf = (v: Record<string, unknown>): FolioDoc => load(v).doc

const SOURCE = {
  name: 'clients.csv',
  fields: ['Civilité', 'Prénom', 'Nom', 'Société', 'Adresse 1', 'Ville', 'Code postal', 'Pays', 'E-mail', 'Montant'],
  records: [
    ['Mme', 'Camille', 'Durand', 'Atelier Durand', '12 rue des Lilas', 'Lyon', '69003', 'France', 'camille@exemple.fr', '120'],
    ['M.', 'Yusuf', 'Kaya', '', '4 Market Street', 'Boston', '02110', 'USA', 'yusuf@example.com', '45'],
    ['', '', 'Lefèvre', 'Lefèvre SA', '8 quai Est', 'Nantes', '44000', 'France', '', '300'],
  ],
}
const MAP = { title: 'Civilité', first: 'Prénom', last: 'Nom', company: 'Société', address1: 'Adresse 1', city: 'Ville', postal: 'Code postal', country: 'Pays', email: 'E-mail' }
const mm = (extra: Partial<MailMerge> = {}): MailMerge => ({ type: 'letters', source: structuredClone(SOURCE), map: MAP, ...extra }) as MailMerge
const f = (name: string, opts?: Record<string, string>) => ({ type: 'mergefield', name, ...(opts ? { opts } : {}) })
const texts = (blocks: Block[]) => plainText(blocks)

describe('listes de destinataires', () => {
  it('CSV : séparateur deviné, guillemets, retours à la ligne, BOM, lignes vides', () => {
    const csv = '﻿Nom;Ville;Note\r\n"Durand";"Lyon";"dit ""bonjour""\nà tous"\r\n\r\nKaya;Boston;\r\n'
    const { source, truncated } = parseCsv(csv, 'liste.csv')
    expect(truncated).toBe(false)
    expect(source.fields).toEqual(['Nom', 'Ville', 'Note'])
    expect(source.records).toEqual([
      ['Durand', 'Lyon', 'dit "bonjour"\nà tous'],
      ['Kaya', 'Boston', ''],
    ])
    expect(parseCsv('a\tb\n1\t2').source.records).toEqual([['1', '2']])
  })

  it('CSV : bornes (colonnes, longueur des cellules)', () => {
    const head = Array.from({ length: SOURCE_LIMITS.fields + 5 }, (_, i) => `c${i}`).join(',')
    const r = parseCsv(`${head}\n${'x'.repeat(SOURCE_LIMITS.cell + 10)}`)
    expect(r.truncated).toBe(true)
    expect(r.source.fields).toHaveLength(SOURCE_LIMITS.fields)
    expect(r.source.records[0][0]).toHaveLength(SOURCE_LIMITS.cell)
  })

  it('JSON : tableau d’objets ou { fields, records } ; sinon rien', () => {
    expect(parseJsonSource('[{"Nom":"Durand","Âge":41},{"Nom":"Kaya","Ville":"Boston"}]')!.source).toMatchObject({
      fields: ['Nom', 'Âge', 'Ville'],
      records: [
        ['Durand', '41', ''],
        ['Kaya', '', 'Boston'],
      ],
    })
    // une valeur de trop n'est pas perdue : elle a sa colonne
    expect(parseJsonSource('{"fields":["A","B"],"records":[["1","2","3"],["4"]]}')!.source).toMatchObject({
      fields: ['A', 'B', 'Colonne 3'],
      records: [
        ['1', '2', '3'],
        ['4', '', ''],
      ],
    })
    expect(parseJsonSource('{"a":1}')).toBeNull()
    expect(parseJsonSource('pas du JSON')).toBeNull()
  })

  it('vCard : nom, société, adresse, courriel ; lignes repliées ; FN si N manque', () => {
    const vcf = ['BEGIN:VCARD', 'VERSION:3.0', 'N:Durand;Camille;;Mme;', 'ORG:Atelier Durand', 'ADR;TYPE=WORK:;;12 rue des Lilas;Lyon;;69003;Fra', ' nce', 'EMAIL:camille@exemple.fr', 'END:VCARD', 'BEGIN:VCARD', 'FN:Yusuf Kaya', 'END:VCARD'].join('\r\n')
    const { source } = parseVcf(vcf)
    const row = (i: number) => Object.fromEntries(source.fields.map((k, j) => [k, source.records[i][j]]))
    expect(row(0)).toMatchObject({ Civilité: 'Mme', Prénom: 'Camille', Nom: 'Durand', Société: 'Atelier Durand', 'Adresse 1': '12 rue des Lilas', Ville: 'Lyon', 'Code postal': '69003', Pays: 'France', 'E-mail': 'camille@exemple.fr' })
    expect(row(1)).toMatchObject({ Prénom: 'Yusuf', Nom: 'Kaya' })
  })

  it('lecture selon l’extension ; CSV exporté puis relu à l’identique', () => {
    expect(parseSourceFile('a.vcf', 'BEGIN:VCARD\nN:A;B\nEND:VCARD')!.source.records).toHaveLength(1)
    expect(parseSourceFile('a.json', '[{"x":1}]')!.source.fields).toEqual(['x'])
    expect(parseSourceFile('a.csv', '')).toBeNull()
    expect(parseCsv(toCsv(SOURCE)).source).toMatchObject({ fields: SOURCE.fields, records: SOURCE.records })
    const tricky = { name: '', fields: ['A', 'B'], records: [['un, deux', 'il dit "oui"\npuis part']] }
    expect(parseCsv(toCsv(tricky)).source.records).toEqual(tricky.records)
  })

  it('correspondance des champs devinée (français, anglais, accents)', () => {
    expect(guessMap(SOURCE.fields)).toMatchObject(MAP)
    expect(guessMap(['First Name', 'Surname', 'ZIP', 'Email Address', 'Town'])).toEqual({ first: 'First Name', last: 'Surname', postal: 'ZIP', email: 'Email Address', city: 'Town' })
  })
})

describe('fusion', () => {
  it('destinataires : décochés, filtres, tri (les nombres en nombres)', () => {
    const m = mm({ filters: [{ field: 'Pays', op: 'eq', value: 'france' }] })
    expect(recipients(m).map((r) => r.values.Nom)).toEqual(['Durand', 'Lefèvre'])
    m.source!.excluded = [0]
    expect(recipients(m).map((r) => r.values.Nom)).toEqual(['Lefèvre'])
    expect(recipients(mm({ sort: { field: 'Montant', desc: true } })).map((r) => r.values.Montant)).toEqual(['300', '120', '45'])
    expect(recipients(undefined)).toEqual([])
  })

  it('conditions : comparaisons sans casse, nombres, vide, contient', () => {
    expect(cond('100', 'gt', '45')).toBe(true) // en nombres, pas en texte
    expect(cond('1 200,5', 'ge', '1200.5')).toBe(true)
    expect(cond('Lyon', 'eq', 'LYON')).toBe(true)
    expect(cond('', 'empty', '')).toBe(true)
    expect(cond('x', 'notEmpty', '')).toBe(true)
    expect(cond('Atelier Durand', 'contains', 'durand')).toBe(true)
    expect(cond('a', 'bogus', 'a')).toBe(false)
  })

  it('bloc d’adresse et salutation (formats français et américain, repli)', () => {
    const [fr, us, nobody] = recipients(mm())
    expect(addressLines(mm(), fr, { home: 'France' })).toEqual(['Mme Camille Durand', 'Atelier Durand', '12 rue des Lilas', '69003 Lyon'])
    expect(addressLines(mm(), us, { home: 'France' })).toEqual(['M. Yusuf Kaya', '4 Market Street', 'Boston, 02110', 'USA'])
    expect(addressLines(mm(), fr, { company: 'no', country: 'always' })).toEqual(['Mme Camille Durand', '12 rue des Lilas', '69003 Lyon', 'FRANCE'])
    expect(greetingText(mm(), fr)).toBe('Bonjour Camille,')
    expect(greetingText(mm(), fr, { salutation: 'Chère', nameFormat: 'title-last', punct: ' :' })).toBe('Chère Mme Durand :')
    expect(greetingText(mm(), nobody, { nameFormat: 'first' })).toBe('Madame, Monsieur,')
    expect(greetingText(mm(), us, {}, 'en')).toBe('Dear Yusuf,')
  })

  it('lettres : un exemplaire par destinataire, séparés par une nouvelle page ; règles et champs spéciaux', () => {
    const doc = docOf({
      meta: { title: 'Relance', lang: 'fr' },
      mailMerge: mm(),
      blocks: [
        { content: [f('@greeting')] },
        { content: ['Montant : ', f('Montant', undefined), ' €. ', f('@if', { field: 'Montant', op: 'gt', value: '100', then: 'Merci «Prénom» !', else: 'À bientôt.' })] },
        { content: ['Lettre ', f('@sequence'), ' (fiche ', f('@record'), '), objet : ', f('@fillin', { prompt: 'Objet ?', default: 'relance' })] },
      ],
    })
    expect(fillinPrompts(doc.blocks)).toEqual([{ prompt: 'Objet ?', default: 'relance' }])
    const r = mergeDocument(doc, { id: 'fusion-1', now: NOW, fillins: { 'Objet ?': 'facture' } })
    expect(r).toMatchObject({ count: 3, skipped: 0 })
    expect(r.doc.id).toBe('fusion-1')
    expect(r.doc.mailMerge).toBeUndefined()
    expect(r.doc.blocks.filter((b) => b.type === 'section')).toHaveLength(2)
    const text = texts(r.doc.blocks)
    expect(text).toContain('Bonjour Camille,')
    expect(text).toContain('Montant : 120 €. Merci Camille !')
    expect(text).toContain('Montant : 45 €. À bientôt.')
    expect(text).toContain('Lettre 3 (fiche 3), objet : facture')
    expect(text).toContain('Madame, Monsieur,')
    // la mise en forme du champ passe à la valeur
    const bold = mergeDocument(docOf({ mailMerge: mm(), blocks: [{ content: [{ ...f('Nom'), bold: true }] }] }), { id: 'x', now: NOW })
    expect((bold.doc.blocks[0] as any).content[0]).toEqual({ text: 'Durand', bold: true })
  })

  it('@skipif ignore un destinataire ; @next et @nextif passent au suivant dans le même exemplaire', () => {
    const skip = mergeDocument(docOf({ mailMerge: mm(), blocks: [{ content: [f('@skipif', { field: 'E-mail', op: 'empty' }), f('Nom')] }] }), { id: 'x', now: NOW })
    expect(skip).toMatchObject({ count: 2, skipped: 1 })
    const next = mergeDocument(docOf({ mailMerge: mm({ type: 'directory' }), blocks: [{ content: [f('Nom'), ' / ', f('@next'), f('Nom')] }] }), { id: 'x', now: NOW })
    expect(next.count).toBe(2)
    expect(texts(next.doc.blocks).split('\n\n')).toEqual(['Durand / Kaya', 'Lefèvre / '])
    const nextif = mergeDocument(docOf({ mailMerge: mm({ type: 'directory' }), blocks: [{ content: [f('Nom'), f('@nextif', { field: 'Pays', op: 'eq', value: 'France' }), '+', f('Nom')] }] }), { id: 'x', now: NOW })
    expect(texts(nextif.doc.blocks).split('\n\n')).toEqual(['Durand+Kaya', 'Lefèvre+'])
  })

  it('répertoire : les exemplaires à la suite ; champs dans les tableaux, listes et notes', () => {
    const doc = docOf({
      mailMerge: mm({ type: 'directory' }),
      blocks: [
        { type: 'list', items: [{ content: [f('Nom'), { type: 'note', blocks: ['Ville : ', { content: [f('Ville')] }] }] }] },
        { type: 'table', rows: [[{ blocks: [{ content: [f('Prénom')] }] }, 'fixe']] },
      ],
    })
    const r = mergeDocument(doc, { id: 'x', now: NOW })
    expect(r.doc.blocks.filter((b) => b.type === 'section')).toHaveLength(0)
    expect(r.doc.blocks).toHaveLength(6)
    expect(JSON.stringify(r.doc.blocks)).toContain('Ville : ')
    expect(JSON.stringify(r.doc.blocks)).toContain('"Boston"')
    expect(texts(r.doc.blocks)).toContain('Yusuf\tfixe')
  })

  it('étiquettes : une planche par page, cases à hauteur fixe, page aux dimensions de la planche', () => {
    const sheet = LABEL_PRESETS[0] // 3 × 7
    const source = { ...structuredClone(SOURCE), records: Array.from({ length: 23 }, (_, i) => [...SOURCE.records[0].slice(0, 2), `Nom${i + 1}`, ...SOURCE.records[0].slice(3)]) }
    const doc = docOf({ mailMerge: { type: 'labels', source, map: MAP, label: sheet }, blocks: [{ content: [f('@address')] }] })
    const r = mergeDocument(doc, { id: 'x', now: NOW })
    expect(r.count).toBe(23)
    const tables = r.doc.blocks.filter((b) => b.type === 'table') as Extract<Block, { type: 'table' }>[]
    expect(tables).toHaveLength(2) // 21 + 2
    expect(r.doc.blocks.filter((b) => b.type === 'pagebreak')).toHaveLength(1)
    expect(tables[0].rows).toHaveLength(7)
    expect(tables[0].rows[0]).toHaveLength(5) // 3 étiquettes et 2 gouttières
    expect(tables[0].rowHeight).toBeCloseTo(38.1 * (72 / 25.4), 0)
    expect(r.doc.page).toMatchObject({ size: 'custom', width: 210, height: 297, margins: { top: sheet.top, left: sheet.left } })
    expect(texts(r.doc.blocks)).toContain('Nom23')
  })

  it('messages : destinataire, objet avec «Champs», corps en texte brut', () => {
    const doc = docOf({ mailMerge: mm({ type: 'emails', email: { to: 'E-mail', subject: 'Votre facture, «Prénom»' } }), blocks: [{ content: [f('@greeting')] }, 'Merci.'] })
    const msgs = emailMessages(doc)
    expect(msgs).toHaveLength(3)
    expect(msgs[0]).toMatchObject({ to: 'camille@exemple.fr', subject: 'Votre facture, Camille', body: 'Bonjour Camille,\n\nMerci.', index: 0 })
    expect(plainText(msgs[0].blocks)).toBe(msgs[0].body)
    expect(msgs[2].to).toBe('')
  })

  it('vérifier les erreurs : liste absente, champ inconnu, valeur vide, courriel manquant', () => {
    expect(checkMerge(docOf({ blocks: ['x'] }))).toEqual([{ kind: 'no-source' }])
    const doc = docOf({ mailMerge: mm({ type: 'emails', email: { to: 'E-mail', subject: '' } }), blocks: [{ content: [f('Prénom'), f('Inconnu')] }] })
    const p = checkMerge(doc)
    expect(p).toContainEqual({ kind: 'unknown-field', field: 'Inconnu' })
    expect(p).toContainEqual({ kind: 'empty-value', field: 'Prénom', record: 3 })
    expect(p).toContainEqual({ kind: 'no-email', record: 3 })
    const all = mm()
    all.source!.excluded = [0, 1, 2]
    expect(checkMerge(docOf({ mailMerge: all, blocks: ['x'] }))).toEqual([{ kind: 'no-recipient' }])
  })
})

describe('format du document', () => {
  it('la liste est rendue rectangulaire, les réglages vérifiés contre ses colonnes', () => {
    const r = load({
      mailMerge: {
        type: 'bogus',
        source: { name: 'x', fields: ['A', 'A', ''], records: [['1', '2', '3', '4'], ['5'], 'pas une ligne'], excluded: [1, 9, -1, 'x'] },
        map: { last: 'A', city: 'Inconnue' },
        filters: [{ field: 'A', op: 'gt', value: '0' }, { field: 'Zzz', op: 'eq' }],
        sort: { field: 'Zzz' },
      },
      blocks: [{ content: [f('A'), { type: 'mergefield', name: '' }] }],
    })
    const m = r.doc.mailMerge!
    expect(m.type).toBe('letters')
    expect(m.source!.fields).toEqual(['A', 'A_2', 'Col3'])
    // une ligne invalide est écartée ; les autres ont une valeur par colonne
    expect(m.source!.records).toEqual([
      ['1', '2', '3'],
      ['5', '', ''],
    ])
    expect(m.source!.excluded).toEqual([1])
    expect(m.map).toEqual({ last: 'A' })
    expect(m.filters).toEqual([{ field: 'A', op: 'gt', value: '0' }])
    expect(m.sort).toBeUndefined()
    expect(r.report.issues.length).toBeGreaterThan(0)
    // un champ sans nom est ignoré
    expect((r.doc.blocks[0] as any).content).toEqual([{ type: 'mergefield', name: 'A' }])
  })

  it('options de champ bornées à la liste connue ; JSON compact et éditeur conservent tout', () => {
    const doc = docOf({
      mailMerge: mm({ label: LABEL_PRESETS[1] }),
      blocks: [{ content: [{ ...f('@if', { field: 'Pays', op: 'eq', value: 'France', then: 'oui', else: 'non' }), italic: true }, f('@address', { evil: 'x', company: 'no' } as any)] }, { type: 'table', rows: [['a']], rowHeight: 40 }],
    })
    const c = (doc.blocks[0] as any).content
    expect(c[0]).toEqual({ type: 'mergefield', name: '@if', opts: { field: 'Pays', op: 'eq', value: 'France', then: 'oui', else: 'non' }, italic: true })
    expect(c[1].opts).toEqual({ company: 'no' })
    const compact = toCompact(doc) as any
    expect(compact.mailMerge.source.records).toEqual(SOURCE.records)
    const back = docOf(compact)
    expect(back.mailMerge).toEqual(doc.mailMerge)
    expect(back.blocks).toEqual(doc.blocks)
    const pm = pmToDoc(docToPM(doc), { id: doc.id, created: doc.meta.created, modified: doc.meta.modified })
    expect(pm.mailMerge).toEqual(doc.mailMerge)
    expect(pm.blocks).toEqual(doc.blocks)
  })

  it('Markdown : {{merge:Nom}} devient un champ de fusion', () => {
    expect(parseMarkdown('Bonjour {{merge:Prénom}} **{{merge:Nom}}**')).toEqual([
      { type: 'paragraph', content: [{ text: 'Bonjour ' }, { type: 'mergefield', name: 'Prénom' }, { text: ' ' }, { type: 'mergefield', name: 'Nom', bold: true }] },
    ])
  })
})

describe('aller-retour .docx', () => {
  it('champs de fusion (simples, adresse, salutation, règles), hauteur de ligne et liste de destinataires', async () => {
    const doc = docOf({
      mailMerge: mm({ sort: { field: 'Nom' } }),
      blocks: [
        { content: [f('@address')] },
        { content: [f('@greeting', { salutation: 'Chère', nameFormat: 'first', punct: ',' })] },
        { content: ['Montant : ', { ...f('Montant'), bold: true }, ' ', f('@if', { field: 'Montant', op: 'gt', value: '100', then: 'merci', else: 'à bientôt' })] },
        { content: [f('@skipif', { field: 'Pays', op: 'eq', value: 'USA' }), f('@record'), f('@sequence'), f('@next'), f('@fillin', { prompt: 'Objet ?', default: 'relance' })] },
        { type: 'table', rows: [['a', 'b']], rowHeight: 40 },
      ],
    })
    const out = await exportDocx(doc, { now: new Date(NOW) })
    expect(out.losses).toEqual([])
    const back = open(out.bytes)
    expect(back.res.losses).toEqual([])
    expect(back.doc.mailMerge).toEqual(doc.mailMerge)
    const names = (b: Block) => ((b as any).content as any[]).filter((x) => x.type === 'mergefield').map((x) => x.name)
    expect(back.doc.blocks.slice(0, 4).map(names)).toEqual([['@address'], ['@greeting'], ['Montant', '@if'], ['@skipif', '@record', '@sequence', '@next', '@fillin']])
    const c2 = (back.doc.blocks[2] as any).content
    expect(c2.find((x: any) => x.name === 'Montant')).toMatchObject({ bold: true })
    expect(c2.find((x: any) => x.name === '@if').opts).toMatchObject({ field: 'Montant', op: 'gt', value: '100', then: 'merci', else: 'à bientôt' })
    expect((back.doc.blocks[3] as any).content.find((x: any) => x.name === '@fillin').opts).toEqual({ prompt: 'Objet ?', default: 'relance' })
    expect((back.doc.blocks[4] as any).rowHeight).toBe(40)
    // la fusion du document relu donne le même résultat que l'original
    const a = texts(mergeDocument(doc, { id: 'x', now: NOW, fillins: { 'Objet ?': 'z' } }).doc.blocks)
    const b = texts(mergeDocument(back.doc, { id: 'x', now: NOW, fillins: { 'Objet ?': 'z' } }).doc.blocks)
    expect(b).toBe(a)
  })
})

describe('envoi des messages', () => {
  const doc = () =>
    docOf({
      mailMerge: mm({ type: 'emails', email: { to: 'E-mail', subject: 'Facture « n° 4 », «Prénom»' } }),
      blocks: [
        { content: [f('@greeting')] },
        { type: 'heading', level: 2, content: [{ text: 'Détail' }] },
        { content: [{ text: 'Total ', bold: true }, { text: '<120 €>', italic: true, color: 'accent1' }, { text: ' — ' }, { text: 'site', link: 'https://exemple.fr/?a=1&b=2' }, { text: 'piège', link: 'javascript:alert(1)' }] },
        { type: 'list', style: 'bullet', items: [{ content: [{ text: 'un' }], level: 0 }, { content: [{ text: 'un.un' }], level: 1 }, { content: [{ text: 'deux' }], level: 0 }] },
        { type: 'table', header: true, rows: [[{ blocks: [{ content: [{ text: 'A' }] }] }, { blocks: [{ content: [{ text: 'B' }] }] }], [{ blocks: [{ content: [{ text: '1' }] }] }, { blocks: [{ content: [{ text: '2' }] }] }]] },
      ],
    })

  it('adresses : validité, liste pour une copie cachée sans doublon', () => {
    expect(isEmail('camille@exemple.fr')).toBe(true)
    for (const bad of ['', 'camille', 'a@b', 'a b@c.fr', 'a@b.fr, c@d.fr', '<a@b.fr>']) expect(isEmail(bad)).toBe(false)
    const msgs = emailMessages(doc())
    expect(bccList([...msgs, { ...msgs[0], to: 'CAMILLE@exemple.fr' }])).toEqual(['camille@exemple.fr', 'yusuf@example.com'])
  })

  it('liens de rédaction : messagerie, Gmail, Outlook.com ; corps omis à la demande', () => {
    const m = { to: 'camille@exemple.fr', subject: 'Objet & co', body: 'Ligne 1\nLigne 2' }
    expect(composeUrl('app', m)).toBe('mailto:camille@exemple.fr?subject=Objet%20%26%20co&body=Ligne%201%0ALigne%202')
    expect(composeUrl('app', m, false)).toBe('mailto:camille@exemple.fr?subject=Objet%20%26%20co')
    expect(composeUrl('gmail', m)).toBe('https://mail.google.com/mail/?view=cm&fs=1&to=camille%40exemple.fr&su=Objet%20%26%20co&body=Ligne%201%0ALigne%202')
    expect(composeUrl('outlook', m)).toMatch(/^https:\/\/outlook\.live\.com\/mail\/0\/deeplink\/compose\?to=camille%40exemple\.fr&subject=Objet/)
    // une adresse piégée ne peut pas ajouter de paramètre
    expect(composeUrl('app', { ...m, to: 'x@y.fr?bcc=z@w.fr' })).toMatch(/^mailto:x@y\.fr%3Fbcc%3Dz@w\.fr\?/)
    expect(fitsInUrl({ body: 'x'.repeat(MAILTO_MAX) })).toBe(true)
    expect(fitsInUrl({ body: 'x'.repeat(MAILTO_MAX + 1) })).toBe(false)
  })

  it('corps HTML : mise en forme, échappement, liens sûrs seulement, listes imbriquées, tableau', () => {
    const d = doc()
    const html = blocksHtml(emailMessages(d)[0].blocks, { theme: d.theme })
    expect(html).toContain('<p style="margin:0 0 10px">Bonjour Camille,</p>')
    expect(html).toContain('<h2 style="margin:0 0 10px">Détail</h2>')
    expect(html).toContain('<strong>Total </strong>')
    expect(html).toMatch(/<em><span style="color:#[0-9a-f]{6}">&lt;120 €&gt;<\/span><\/em>/)
    expect(html).toContain('<a href="https://exemple.fr/?a=1&amp;b=2">site</a>')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('piège')
    expect(html).toContain('<ul style="margin:0 0 10px"><li>un<ul style="margin:0 0 0px"><li>un.un</li></ul></li><li>deux</li></ul>')
    expect(html).toMatch(/<th [^>]*>.*A.*<\/th>/)
    expect(html).toMatch(/<td [^>]*>.*2.*<\/td>/)
  })

  it('brouillon .eml : en-têtes encodés, X-Unsent, texte et HTML en base64, images jointes', () => {
    const d = doc()
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const m = emailMessages(d)[0]
    const withImg = { ...m, blocks: [...m.blocks, { type: 'image', src: 'asset:logo', alt: 'Logo', width: 30, align: 'center', wrap: 'none', caption: [] } as Block] }
    const eml = emlMessage(withImg, { theme: d.theme, assets: { logo: png }, boundary: 'B', date: new Date(Date.UTC(2026, 10, 12, 9, 30)) })
    const lines = eml.split('\r\n')
    expect(lines).toContain('To: camille@exemple.fr')
    expect(lines).toContain('X-Unsent: 1')
    expect(lines).toContain('Date: Thu, 12 Nov 2026 09:30:00 +0000')
    const subj = lines.find((l) => l.startsWith('Subject: '))!
    expect(subj).toMatch(/^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(subj.slice(19, -2)), (c) => c.charCodeAt(0)))
    expect(decoded).toBe('Facture « n° 4 », Camille')
    expect(eml).toContain('Content-Type: multipart/related; boundary="B-rel"')
    expect(eml).toContain('Content-ID: <img1@folio>')
    expect(lines.every((l) => l.length <= 998)).toBe(true)
    // le HTML et le texte se décodent
    const parts = eml.split('--B-alt')
    const body = (i: number) => new TextDecoder().decode(Uint8Array.from(atob(parts[i].split('\r\n\r\n')[1].replace(/\r\n/g, '').trim()), (c) => c.charCodeAt(0)))
    expect(body(1)).toBe(m.body)
    expect(body(2)).toContain('<img src="cid:img1@folio" alt="Logo" width="40"')
    // sans image : simple multipart/alternative ; une adresse ne peut pas injecter d'en-tête
    const plain = emlMessage({ ...m, to: 'a@b.fr\r\nBcc: z@z.fr' }, { boundary: 'B' })
    expect(plain).toContain('Content-Type: multipart/alternative; boundary="B-alt"')
    expect(plain.split('\r\n').filter((l) => l.startsWith('Bcc'))).toEqual([])
    expect(emlName(m, 7)).toBe('007-camille.eml')
    expect(emlName({ ...m, to: '' }, 2)).toBe('002-message-2.eml')
  })

  it('envoyer le document : adresses tapées, plusieurs destinataires, copie', () => {
    expect(parseAddresses(' a@b.fr, Camille Durand <camille@exemple.fr> ; A@B.fr\nzed ,, x@y')).toEqual({ ok: ['a@b.fr', 'camille@exemple.fr'], bad: ['zed', 'x@y'] })
    expect(parseAddresses('')).toEqual({ ok: [], bad: [] })
    const many = Array.from({ length: MAX_ADDRESSES + 20 }, (_, i) => `p${i}@ex.fr`).join(',')
    expect(parseAddresses(many).ok).toHaveLength(MAX_ADDRESSES)
    const m = { to: 'a@b.fr, c@d.fr', cc: 'e@f.fr', subject: 'Rapport', body: 'Texte' }
    // mailto: : virgules gardées entre les adresses (RFC 6068), copie en paramètre
    expect(composeUrl('app', m)).toBe('mailto:a@b.fr,c@d.fr?cc=e%40f.fr&subject=Rapport&body=Texte')
    expect(composeUrl('gmail', m)).toBe('https://mail.google.com/mail/?view=cm&fs=1&to=a%40b.fr%2C%20c%40d.fr&cc=e%40f.fr&su=Rapport&body=Texte')
    expect(composeUrl('outlook', m)).toContain('&cc=e%40f.fr&subject=Rapport')
    // sans destinataire : la messagerie s'ouvre quand même, on remplira l'adresse là-bas
    expect(composeUrl('app', { ...m, to: '', cc: '' })).toBe('mailto:?subject=Rapport&body=Texte')
  })

  it('brouillon .eml avec pièce jointe : multipart/mixed, nom encodé, copie sans injection', () => {
    const m = emailMessages(doc())[0]
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff])
    const eml = emlMessage(m, {
      boundary: 'B',
      cc: 'chef@exemple.fr\r\nBcc: z@z.fr',
      attachments: [
        { name: 'Compte rendu « mars ».docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: bytes },
        { name: 'rapport.html', type: 'text/html', data: '<!doctype html><p>é</p>' },
        { name: 'piège.exe', type: 'bad type\r\nX: y', data: 'x' },
      ],
    })
    const lines = eml.split('\r\n')
    expect(lines).toContain('Content-Type: multipart/mixed; boundary="B-mix"')
    expect(lines.filter((l) => l.startsWith('Cc: '))).toEqual(['Cc: chef@exemple.frBcc: z@z.fr'])
    expect(lines.filter((l) => /^Bcc/i.test(l))).toEqual([])
    // le message lui-même reste lisible (texte + HTML), avant les fichiers
    expect(eml.indexOf('multipart/alternative')).toBeLessThan(eml.indexOf('Content-Disposition: attachment'))
    const files = eml.split('--B-mix').slice(2, -1)
    expect(files).toHaveLength(2)
    expect(files[0]).toMatch(/filename="=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?="/)
    const data = (part: string) => Uint8Array.from(atob(part.split('\r\n\r\n')[1].replace(/\r\n/g, '').trim()), (c) => c.charCodeAt(0))
    expect([...data(files[0])]).toEqual([...bytes])
    expect(new TextDecoder().decode(data(files[1]))).toBe('<!doctype html><p>é</p>')
    expect(files[1]).toContain('Content-Type: text/html; name="rapport.html"')
    expect(eml.trimEnd().endsWith('--B-mix--')).toBe(true)
    expect(lines.every((l) => l.length <= 998)).toBe(true)
  })
})
