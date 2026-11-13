// Phase 7 : chiffrement, mises à jour signées, paquets de langue, mode hors ligne.

import { webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptEnvelope, encryptText, ENC_ITERATIONS, parseEnvelope, passwordStrength, SessionSealer } from '../../src/file/crypto'
import { checkForUpdates, compareVersions, RELEASE_KEY, verifyManifest, verifySigned } from '../../src/update'
import { checkPack } from '../../src/ui/packs'
import { registerPack, setLang, t, unregisterPack, availableLanguages } from '../../src/i18n/i18n'
import { DICT } from '../../src/i18n/dict'

const FAST = { iterations: 2000 }

describe('chiffrement par mot de passe', () => {
  it('chiffre et déchiffre ; un mauvais mot de passe donne null', async () => {
    const env = await encryptText('{"format":"folio/doc","blocks":["secret"]}', 'correct horse', { ...FAST, id: 'doc-000001' })
    expect(env).not.toContain('secret')
    const parsed = parseEnvelope(env)!
    expect(parsed).toMatchObject({ format: 'folio/enc', v: 1, id: 'doc-000001', it: 2000 })
    expect(await decryptEnvelope(parsed, 'correct horse')).toContain('secret')
    expect(await decryptEnvelope(parsed, 'wrong horse')).toBeNull()
  })

  it('les nouvelles enveloppes prennent 600 000 tours ; le nombre écrit dans l’enveloppe est celui qui sert', async () => {
    const env = parseEnvelope(await encryptText('x', 'pw'))!
    expect(env.it).toBe(ENC_ITERATIONS)
    expect(ENC_ITERATIONS).toBe(600_000)
    expect(await decryptEnvelope(env, 'pw')).toBe('x')
  }, 30_000)

  it('sel et vecteur sont tirés à chaque fois', async () => {
    const a = parseEnvelope(await encryptText('même texte', 'pw', FAST))!
    const b = parseEnvelope(await encryptText('même texte', 'pw', FAST))!
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
    expect(a.data).not.toBe(b.data)
  })

  it('une enveloppe altérée ne s’ouvre pas', async () => {
    const env = parseEnvelope(await encryptText('texte', 'pw', FAST))!
    const bytes = Uint8Array.from(atob(env.data), (c) => c.charCodeAt(0))
    bytes[3] ^= 1
    expect(await decryptEnvelope({ ...env, data: btoa(String.fromCharCode(...bytes)) }, 'pw')).toBeNull()
    expect(await decryptEnvelope({ ...env, iv: btoa('123456789012') }, 'pw')).toBeNull()
  })

  it('refuse les enveloppes mal formées ou absurdes', () => {
    expect(parseEnvelope('{"format":"folio/doc"}')).toBeNull()
    expect(parseEnvelope('{"format":"folio/enc","v":2,"salt":"a","iv":"b","data":"c"}')).toBeNull()
    expect(parseEnvelope('{"format":"folio/enc","v":1,"salt":"a","iv":"b"}')).toBeNull()
    expect(parseEnvelope('{"format":"folio/enc","v":1,"salt":"a!","iv":"b","data":"c"}')).toBeNull()
    expect(parseEnvelope('{"format":"folio/enc","v":1,"it":999999999,"salt":"a","iv":"b","data":"c"}')).toBeNull()
    expect(parseEnvelope('{"format":"folio/enc","v":1,"it":10,"salt":"a","iv":"b","data":"c"}')).toBeNull()
    expect(parseEnvelope('{"format":"folio/enc","v":1,"salt":"AA==","iv":"AA==","data":"AA==","id":"<script>"}')).toEqual({ format: 'folio/enc', v: 1, it: undefined, salt: 'AA==', iv: 'AA==', data: 'AA==' })
  })

  it('les copies gardées dans le navigateur sont chiffrées avec le même mot de passe', async () => {
    const s = new SessionSealer('pw')
    const sealed = await s.seal('{"a":1}')
    expect(sealed).not.toContain('"a"')
    expect(await s.open(sealed)).toBe('{"a":1}')
    expect(await new SessionSealer('autre').open(sealed)).toBeNull()
    // Une copie en clair (d'avant la protection) se lit telle quelle.
    expect(await s.open('{"b":2}')).toBe('{"b":2}')
  }, 30_000)

  it('force d’un mot de passe', () => {
    expect(passwordStrength('abc')).toBe(0)
    expect(passwordStrength('abcdefgh')).toBe(1)
    expect(passwordStrength('Abcdefg1!')).toBe(2)
    expect(passwordStrength('une phrase de passe longue')).toBe(3)
  })
})

describe('mises à jour signées', () => {
  const keys = async () => {
    const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    return { priv: pair.privateKey, pub: (await webcrypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey }
  }
  const sign = async (priv: CryptoKey, payload: object | string) => {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const sig = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode(text))).toString('base64')
    return JSON.stringify({ payload: text, sig })
  }
  const release = { app: 'folio-pages', version: '9.9.9', sha256: 'a'.repeat(64), url: 'https://exemple.org/folio-pages.html', notes: { fr: ['Nouveau'], en: ['New'] } }

  it('un manifeste bien signé est accepté ; altéré, ou signé par une autre clé, il est refusé', async () => {
    const k = await keys()
    const good = await sign(k.priv, release)
    expect(await verifyManifest(good, k.pub)).toMatchObject({ version: '9.9.9', sha256: 'a'.repeat(64), notes: { fr: ['Nouveau'], en: ['New'] } })
    const tampered = JSON.stringify({ ...JSON.parse(good), payload: JSON.parse(good).payload.replace('9.9.9', '9.9.8') })
    await expect(verifyManifest(tampered, k.pub)).rejects.toThrow('signature invalid')
    const other = await keys()
    await expect(verifyManifest(good, other.pub)).rejects.toThrow('signature invalid')
    // La clé embarquée ne reconnaît pas une clé de test.
    await expect(verifyManifest(good, RELEASE_KEY)).rejects.toThrow('signature invalid')
  })

  it('le contenu doit avoir la bonne forme (application, version, empreinte, https)', async () => {
    const k = await keys()
    for (const bad of [{ ...release, app: 'autre' }, { ...release, version: 'x' }, { ...release, sha256: 'zz' }, { ...release, url: 'http://exemple.org/f.html' }, { ...release, url: 'javascript:alert(1)' }]) {
      await expect(verifyManifest(await sign(k.priv, bad), k.pub)).rejects.toThrow('malformed')
    }
    await expect(verifySigned('pas du json', k.pub)).rejects.toThrow()
    await expect(verifySigned('{"payload":1,"sig":"x"}', k.pub)).rejects.toThrow('malformed')
  })

  it('versions comparées nombre par nombre ; jamais de retour en arrière', async () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.6.0', '0.7.0')).toBeLessThan(0)
    // Une version égale ou plus ancienne : « à jour ».
    const k = await keys()
    const server = async (manifest: string) => {
      const real = globalThis.fetch
      globalThis.fetch = (async () => new Response(manifest)) as typeof fetch
      try {
        return await checkForUpdates('https://exemple.org/release.json', k.pub, '9.9.9')
      } finally {
        globalThis.fetch = real
      }
    }
    expect(await server(await sign(k.priv, release))).toEqual({ status: 'current', version: '9.9.9' })
    expect((await server(await sign(k.priv, { ...release, version: '10.0.0' }))).status).toBe('update')
    expect((await server('{"payload":"{}","sig":"AAAA"}')).status).toBe('error')
  })
})

describe('paquets de langue', () => {
  const pack = (strings: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ format: 'folio/lang', v: 1, lang: 'de', name: 'Deutsch', version: '0.7.0', strings, ...extra })

  it('garde les phrases valides, ignore le reste (clé inconnue, paramètres différents, trop longue)', () => {
    const r = checkPack(
      pack({
        'menu.file': 'Datei',
        'math.unknownCommand': 'Unbekannter Befehl: {command}',
        'math.syntax': 'Fehler ({falsch})',
        'pas.une.cle': 'x',
        'menu.edit': 'x'.repeat(5000),
        'math.converted': { one: '{n} Formel', other: '{n} Formeln' },
      }),
    )
    expect(r.pack!.strings).toEqual({ 'menu.file': 'Datei', 'math.unknownCommand': 'Unbekannter Befehl: {command}', 'math.converted': { one: '{n} Formel', other: '{n} Formeln' } })
    expect(r.ignored).toBe(3)
    expect(r.missing).toBe(Object.keys(DICT).length - 3)
  })

  it('refuse ce qui n’est pas un paquet, ou remplacerait une langue intégrée', () => {
    expect(checkPack('pas du json').error).toBe('format')
    expect(checkPack({ format: 'autre' }).error).toBe('format')
    expect(checkPack(pack({ 'menu.file': 'x' }, { lang: 'fr' })).error).toBe('builtin')
    expect(checkPack(pack({ 'menu.file': 'x' }, { lang: 'deutsch!' })).error).toBe('lang')
    expect(checkPack(pack({})).error).toBe('empty')
    // Le nom est nettoyé et borné.
    expect(checkPack(pack({ 'menu.file': 'x' }, { name: 'De\u0000utsch'.padEnd(80, 'x') })).pack!.name).toHaveLength(40)
  })

  it('une langue ajoutée traduit ce qu’elle sait, le reste reste en anglais', () => {
    const r = checkPack(pack({ 'menu.file': 'Datei' }))
    registerPack(r.pack!)
    expect(availableLanguages().map((l) => l.code)).toEqual(['fr', 'en', 'de'])
    setLang('de', false)
    expect(t('menu.file')).toBe('Datei')
    expect(t('menu.edit')).toBe(t('menu.edit', {}, 'en'))
    unregisterPack('de')
    expect(availableLanguages().map((l) => l.code)).toEqual(['fr', 'en'])
    setLang('fr', false)
  })
})
