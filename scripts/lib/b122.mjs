// SPDX-License-Identifier: MIT
// Base122 pour Folio Pages : écrit dans le HTML les octets compressés de l'application.
// Idée reprise du schéma « Base-122 » de Kevin Albertson ; code écrit pour Folio Pages.
//
// Les octets sont découpés en tranches de 7 bits. Une tranche s'écrit telle quelle
// (un caractère ASCII, un octet dans le fichier en UTF-8), sauf si ce caractère est
// interdit dans un bloc <script> : il est alors écrit avec la tranche suivante dans
// un seul caractère sur deux octets (U+0180 à U+07FF). Le fichier grossit de 8/7
// (+14 %) au lieu de 5/4 (+25 %) pour la base86 de Bento.
//
// Caractères interdits :
//   NUL : remplacé par U+FFFD par l'analyseur HTML ;
//   LF, CR : un éditeur ou git peut changer les fins de ligne (le décodeur les saute) ;
//   ESC : un `cat` ou un `grep` du fichier ne doit pas piloter le terminal ;
//   < : « </script » et « <!-- » deviennent impossibles.

export const ILLEGAL = [0x00, 0x0a, 0x0d, 0x1b, 0x3c]
/** Indice 7 : la dernière tranche est interdite, sans tranche après elle. */
const LAST = 7

/** Uint8Array → texte. */
export function encode(bytes) {
  const chunks = []
  let acc = 0
  let bits = 0
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 7) {
      bits -= 7
      chunks.push((acc >> bits) & 127)
    }
    acc &= (1 << bits) - 1
  }
  if (bits) chunks.push((acc << (7 - bits)) & 127)
  const out = []
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const k = ILLEGAL.indexOf(c)
    if (k < 0) out.push(String.fromCharCode(c))
    else if (i + 1 < chunks.length) out.push(String.fromCharCode(((k + 1) << 8) | 128 | chunks[++i]))
    else out.push(String.fromCharCode((LAST << 8) | 128 | k))
  }
  return out.join('')
}

/** Texte → Uint8Array ; un caractère hors du code est une erreur. Les fins de ligne sont sautées. */
export function decode(text) {
  const out = new Uint8Array(Math.floor((text.length * 14) / 8) + 1)
  let o = 0
  let acc = 0
  let bits = 0
  const put = (c) => {
    acc = (acc << 7) | c
    bits += 7
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 255
      acc &= (1 << bits) - 1
    }
  }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 10 || c === 13) continue
    if (c < 128) {
      if (ILLEGAL.includes(c)) throw new Error(`b122 : caractère interdit ${c} à la position ${i}`)
      put(c)
      continue
    }
    const k = c >> 8
    const d = c & 127
    if (c > 0x7ff || k < 1 || !(c & 128) || (k === LAST ? d >= ILLEGAL.length : k > ILLEGAL.length)) throw new Error(`b122 : caractère ${c} invalide à la position ${i}`)
    if (k === LAST) put(ILLEGAL[d])
    else {
      put(ILLEGAL[k - 1])
      put(d)
    }
  }
  return out.slice(0, o)
}

/** Séquences qu'aucune charge utile ne doit contenir (vérifié à la construction). */
export const FORBIDDEN = ['<', '\0', '\r', '\n', '\x1b']

/** Le décodeur tel qu'il est écrit dans le chargeur : même arithmétique, en ES5, sans fermeture par tranche. */
export const LOADER_DECODER = `
  var b122decode = function (t) {
    var ill = ${JSON.stringify(ILLEGAL)}, n = t.length, out = new Uint8Array(((n * 14) >> 3) + 1)
    var o = 0, acc = 0, bits = 0, i, c, k, d, q, m
    for (i = 0; i < n; i++) {
      c = t.charCodeAt(i)
      if (c === 10 || c === 13) continue
      if (c < 128) {
        if (ill.indexOf(c) >= 0) throw new Error('base122: bad character code ' + c + ' at index ' + i)
        q = c; m = -1
      } else {
        k = c >> 8; d = c & 127
        if (c > 2047 || k < 1 || !(c & 128) || (k === 7 ? d >= ill.length : k > ill.length)) throw new Error('base122: bad character code ' + c + ' at index ' + i)
        if (k === 7) { q = ill[d]; m = -1 } else { q = ill[k - 1]; m = d }
      }
      for (;;) {
        acc = (acc << 7) | q; bits += 7
        if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; acc &= (1 << bits) - 1 }
        if (m < 0) break
        q = m; m = -1
      }
    }
    return out.subarray(0, o)
  }
`
