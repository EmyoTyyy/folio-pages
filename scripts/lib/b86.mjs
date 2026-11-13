// SPDX-License-Identifier: MIT
// Base86 — repris de Bento (scripts/lib/b86.mjs), © 2026 The Bento authors, licence MIT.
// Adapté pour Folio Pages.
//
// 86 caractères ASCII imprimables choisis pour que les séquences dangereuses
// dans un HTML (« </script », « <!-- », « --> », « ]]> », « ${ ») soient
// impossibles à produire : on exclut < > & " ' \ - {. 4 octets → 5 caractères,
// soit 6,25 % de moins que la base64.

export const ALPHABET = (() => {
  let s = ''
  for (let c = 0x21; c <= 0x7e; c++) {
    const ch = String.fromCharCode(c)
    if ('<>&"\'\\-{'.includes(ch)) continue
    s += ch
  }
  return s
})()
export const BASE = ALPHABET.length
if (BASE !== 86) throw new Error(`b86 : alphabet de ${BASE} symboles au lieu de 86`)

const VALUE = new Int16Array(128).fill(-1)
for (let i = 0; i < BASE; i++) VALUE[ALPHABET.charCodeAt(i)] = i

/** Uint8Array → texte base86. */
export function encode(bytes) {
  const out = []
  const n = bytes.length
  let i = 0
  for (; i + 4 <= n; i += 4) {
    let v = ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3]
    const c4 = v % BASE; v = Math.floor(v / BASE)
    const c3 = v % BASE; v = Math.floor(v / BASE)
    const c2 = v % BASE; v = Math.floor(v / BASE)
    const c1 = v % BASE; v = Math.floor(v / BASE)
    out.push(ALPHABET[v], ALPHABET[c1], ALPHABET[c2], ALPHABET[c3], ALPHABET[c4])
  }
  const rest = n - i
  if (rest) {
    let v = 0
    for (let k = 0; k < 4; k++) v = v * 256 + (k < rest ? bytes[i + k] : 0)
    const chars = new Array(5)
    for (let k = 4; k >= 0; k--) { chars[k] = ALPHABET[v % BASE]; v = Math.floor(v / BASE) }
    out.push(...chars.slice(0, rest + 1))
  }
  return out.join('')
}

/** Texte base86 → Uint8Array ; un caractère hors alphabet est une erreur. */
export function decode(text) {
  const len = text.length
  const full = Math.floor(len / 5)
  const rest = len - full * 5
  if (rest === 1) throw new Error('b86 : un caractère seul en fin de texte ne code aucun octet')
  const out = new Uint8Array(full * 4 + (rest ? rest - 1 : 0))
  let o = 0
  let i = 0
  const val = (c) => { const v = VALUE[c]; if (v < 0) throw new Error(`b86 : caractère interdit ${JSON.stringify(String.fromCharCode(c))}`); return v }
  for (; i + 5 <= len; i += 5) {
    const v = (((val(text.charCodeAt(i)) * BASE + val(text.charCodeAt(i + 1))) * BASE + val(text.charCodeAt(i + 2))) * BASE + val(text.charCodeAt(i + 3))) * BASE + val(text.charCodeAt(i + 4))
    out[o++] = (v / 16777216) & 255; out[o++] = (v >>> 16) & 255; out[o++] = (v >>> 8) & 255; out[o++] = v & 255
  }
  if (rest) {
    let v = 0
    for (let k = 0; k < 5; k++) v = v * BASE + (k < rest ? val(text.charCodeAt(i + k)) : BASE - 1)
    const bytes = [(v / 16777216) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
    for (let k = 0; k < rest - 1; k++) out[o++] = bytes[k]
  }
  return out
}

/** Séquences qu'aucune charge utile ne doit contenir (vérifié à la construction). */
export const FORBIDDEN = ['</script', '<!--', '-->', ']]>', '${']

/** Le décodeur tel qu'il est écrit dans le chargeur : même arithmétique, en ES5. */
export const LOADER_DECODER = `
  var B86 = ${JSON.stringify(ALPHABET)}
  var b86v = new Int16Array(128); for (var q = 0; q < 128; q++) b86v[q] = -1
  for (var q = 0; q < 86; q++) b86v[B86.charCodeAt(q)] = q
  var b86decode = function (t) {
    var n = t.length, full = (n / 5) | 0, rest = n - full * 5
    if (rest === 1) throw new Error('base86: truncated payload')
    var out = new Uint8Array(full * 4 + (rest ? rest - 1 : 0)), o = 0, i = 0, v
    var c = function (j) { var x = t.charCodeAt(j), y = x < 128 ? b86v[x] : -1; if (y < 0) throw new Error('base86: bad character code ' + x + ' at index ' + j); return y }
    for (; i + 5 <= n; i += 5) {
      v = (((c(i) * 86 + c(i + 1)) * 86 + c(i + 2)) * 86 + c(i + 3)) * 86 + c(i + 4)
      out[o++] = (v / 16777216) & 255; out[o++] = (v >>> 16) & 255; out[o++] = (v >>> 8) & 255; out[o++] = v & 255
    }
    if (rest) {
      v = 0
      for (var k = 0; k < 5; k++) v = v * 86 + (k < rest ? c(i + k) : 85)
      var tail = [(v / 16777216) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
      for (var k2 = 0; k2 < rest - 1; k2++) out[o++] = tail[k2]
    }
    return out
  }
`
