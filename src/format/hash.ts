// Empreinte FNV-1a 32 bits d'une chaîne (unités UTF-16) : identifiants stables
// et courts pour les ressources du document. Pas une empreinte cryptographique.

export function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Identifiant de ressource déduit de son contenu (img-…, font-…). */
export function assetIdFor(data: string): string {
  const kind = data.startsWith('data:image/') ? 'img' : 'font'
  return `${kind}-${fnv1a(data).toString(36)}${(data.length % 1296).toString(36)}`
}
