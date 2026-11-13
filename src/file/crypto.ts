// Chiffrement par mot de passe (phase 7, CLAUDE.md 4.8), repris de Bento
// (kernel/src/save.ts, MIT, © 2026 The Bento authors).
//
// Un document protégé garde le même bloc #folio-doc, qui contient alors une
// enveloppe au lieu du document :
//   { "format": "folio/enc", "v": 1, "it": 600000, "salt": …, "iv": …, "data": … }
// AES-256-GCM sur le JSON du document, clé dérivée du mot de passe par
// PBKDF2-SHA-256 ; sel (16 octets) et vecteur (12 octets) tirés au hasard à
// chaque enregistrement. Le nombre de tours voyage dans l'enveloppe : un
// fichier écrit avec un autre nombre s'ouvre toujours.
//
// Le mot de passe ne quitte jamais la mémoire de l'onglet. Perdu, il ne se
// retrouve pas : il n'y a ni serveur, ni clé de secours.

export const ENC_FORMAT = 'folio/enc'

/** Tours de PBKDF2 des nouvelles enveloppes (recommandation OWASP pour SHA-256). */
export const ENC_ITERATIONS = 600_000
/** Au-delà, une enveloppe est refusée (une valeur absurde bloquerait l'onglet). */
const MAX_ITERATIONS = 10_000_000
const MIN_ITERATIONS = 1_000
/** Taille maximale des données chiffrées (comme le JSON d'un document). */
const MAX_DATA = 110_000_000

export interface Envelope {
  format: typeof ENC_FORMAT
  v: 1
  /** Identité du document, en clair (un identifiant aléatoire, rien de son contenu) : sert à reconnaître son fichier. */
  id?: string
  it?: number
  salt: string
  iv: string
  data: string
}

const b64 = {
  enc(bytes: Uint8Array): string {
    let s = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk))
    return btoa(s)
  },
  dec(s: string): Uint8Array {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  },
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/

/** Lit une enveloppe (texte ou objet) ; null si ce n'en est pas une valide. */
export function parseEnvelope(input: unknown): Envelope | null {
  let v = input
  if (typeof input === 'string') {
    if (!/^\s*\{\s*"format"\s*:\s*"folio\/enc"/.test(input)) return null
    try {
      v = JSON.parse(input)
    } catch {
      return null
    }
  }
  if (!v || typeof v !== 'object') return null
  const e = v as Record<string, unknown>
  if (e.format !== ENC_FORMAT || e.v !== 1) return null
  for (const k of ['salt', 'iv', 'data'] as const) if (typeof e[k] !== 'string' || !B64.test(e[k] as string)) return null
  if ((e.data as string).length > MAX_DATA || (e.salt as string).length > 200 || (e.iv as string).length > 200) return null
  if (e.it !== undefined && (typeof e.it !== 'number' || !Number.isInteger(e.it) || e.it < MIN_ITERATIONS || e.it > MAX_ITERATIONS)) return null
  const id = typeof e.id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(e.id) ? e.id : undefined
  return { format: ENC_FORMAT, v: 1, ...(id ? { id } : {}), it: e.it as number | undefined, salt: e.salt as string, iv: e.iv as string, data: e.data as string }
}

export const isEnvelopeText = (text: string): boolean => parseEnvelope(text) !== null

// Clés dérivées gardées pour la session : une dérivation (≈ 0,5 s) par sel, pas par écriture.
const keys = new Map<string, Promise<CryptoKey>>()

function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const id = `${iterations}:${b64.enc(salt)}:${password}`
  let k = keys.get(id)
  if (!k) {
    k = (async () => {
      const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
      return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    })()
    keys.set(id, k)
    // Une seule entrée par mot de passe et sel ; on en garde peu.
    if (keys.size > 16) keys.delete(keys.keys().next().value as string)
  }
  return k
}

/** Oublie les clés dérivées (mot de passe retiré ou changé). */
export function forgetKeys(): void {
  keys.clear()
}

export interface EncryptOptions {
  iterations?: number
  /** Identité du document, gardée en clair dans l'enveloppe. */
  id?: string
  /** Sel imposé (copies de secours d'une même session : une seule dérivation). */
  salt?: Uint8Array
}

/** Chiffre un texte ; renvoie l'enveloppe en JSON. */
export async function encryptText(text: string, password: string, o: EncryptOptions = {}): Promise<string> {
  const iterations = o.iterations ?? ENC_ITERATIONS
  const salt = o.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, iterations)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(text))
  const env: Envelope = { format: ENC_FORMAT, v: 1, ...(o.id ? { id: o.id } : {}), it: iterations, salt: b64.enc(salt), iv: b64.enc(iv), data: b64.enc(new Uint8Array(ct)) }
  return JSON.stringify(env)
}

/** Déchiffre ; null si le mot de passe est faux (ou l'enveloppe abîmée). */
export async function decryptEnvelope(env: Envelope, password: string): Promise<string | null> {
  try {
    const key = await deriveKey(password, b64.dec(env.salt), env.it ?? ENC_ITERATIONS)
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(env.iv) as BufferSource }, key, b64.dec(env.data) as BufferSource)
    return new TextDecoder().decode(pt)
  } catch {
    return null
  }
}

/**
 * Chiffrement des copies gardées dans le navigateur (copie de secours,
 * historique des versions) : même mot de passe, un sel par session, pour ne
 * dériver la clé qu'une fois.
 */
export class SessionSealer {
  private salt = crypto.getRandomValues(new Uint8Array(16))
  constructor(readonly password: string) {}
  seal(text: string): Promise<string> {
    return encryptText(text, this.password, { salt: this.salt })
  }
  async open(text: string): Promise<string | null> {
    const env = parseEnvelope(text)
    return env ? decryptEnvelope(env, this.password) : text
  }
}

/** Force d'un mot de passe, pour un indice : 0 (faible) à 3 (fort). */
export function passwordStrength(p: string): 0 | 1 | 2 | 3 {
  let classes = 0
  if (/[a-z]/.test(p)) classes++
  if (/[A-Z]/.test(p)) classes++
  if (/[0-9]/.test(p)) classes++
  if (/[^A-Za-z0-9]/.test(p)) classes++
  const len = [...p].length
  if (len < 8) return 0
  if (len >= 16 || (len >= 12 && classes >= 3)) return 3
  if (len >= 12 || classes >= 3) return 2
  return 1
}
