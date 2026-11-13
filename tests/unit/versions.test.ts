// @vitest-environment jsdom
// Historique des versions, avec le stockage de repli (localStorage : jsdom n'a pas IndexedDB).
import { beforeEach, describe, expect, it } from 'vitest'
import { addVersion, deleteVersions, listVersions, versionsBackend } from '../../src/file/versions'

const v = (docId: string, at: number, json = `{"n":${at}}`) => ({ docId, at, title: 'T', json, words: 3, reason: 'save' as const })

describe('historique des versions', () => {
  beforeEach(() => localStorage.clear())

  it('garde les versions d’un document, la plus récente d’abord', async () => {
    expect(await versionsBackend()).toBe('local')
    const now = Date.now()
    expect(await addVersion(v('doc-aaaaaa', now - 2000), now)).toBe(true)
    expect(await addVersion(v('doc-aaaaaa', now - 1000), now)).toBe(true)
    expect(await addVersion(v('doc-bbbbbb', now - 500), now)).toBe(true)
    expect((await listVersions('doc-aaaaaa')).map((x) => x.at)).toEqual([now - 1000, now - 2000])
    expect(await listVersions('doc-bbbbbb')).toHaveLength(1)
  })

  it('n’ajoute rien si le document n’a pas changé', async () => {
    const now = Date.now()
    await addVersion(v('doc-aaaaaa', now - 2000, '{"x":1}'), now)
    expect(await addVersion(v('doc-aaaaaa', now - 1000, '{"x":1}'), now)).toBe(false)
    expect(await listVersions('doc-aaaaaa')).toHaveLength(1)
  })

  it('oublie les plus anciennes au-delà de la limite, et celles de plus de 90 jours', async () => {
    const now = Date.now()
    for (let i = 0; i < 12; i++) await addVersion(v('doc-aaaaaa', now - 100_000 + i * 1000), now)
    const list = await listVersions('doc-aaaaaa')
    expect(list).toHaveLength(8)
    expect(list[0].at).toBe(now - 100_000 + 11_000)
    localStorage.clear()
    const old = now - 91 * 24 * 3600 * 1000
    await addVersion(v('doc-cccccc', old), old)
    await addVersion(v('doc-cccccc', now), now)
    expect((await listVersions('doc-cccccc')).map((x) => x.at)).toEqual([now])
  })

  it('n’enregistre pas un document trop gros pour le stockage de repli', async () => {
    expect(await addVersion(v('doc-aaaaaa', Date.now(), JSON.stringify({ big: 'x'.repeat(2_000_000) })))).toBe(false)
  })

  it('efface l’historique d’un document seulement', async () => {
    const now = Date.now()
    await addVersion(v('doc-aaaaaa', now), now)
    await addVersion(v('doc-bbbbbb', now), now)
    await deleteVersions('doc-aaaaaa')
    expect(await listVersions('doc-aaaaaa')).toEqual([])
    expect(await listVersions('doc-bbbbbb')).toHaveLength(1)
  })

  it('ignore une entrée illisible', async () => {
    localStorage.setItem('folio-pages:version:doc-aaaaaa:1', '{pas du json')
    expect(await listVersions('doc-aaaaaa')).toEqual([])
  })
})
