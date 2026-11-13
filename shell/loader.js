// Chargeur (repris de Bento, MIT) : décode la base86, décompresse le DEFLATE et
// lance l'application, de façon SYNCHRONE (l'éditeur est prêt avant
// DOMContentLoaded). Si une politique de sécurité refuse un script inséré, on
// essaie new Function, puis en dernier recours un import de blob.
;(async function () {
  if (!window.__folioOk) return
  var violations = 0
  document.addEventListener('securitypolicyviolation', function () { violations++ })
  var failText = function (text) {
    var s = document.getElementById('folio-splash')
    if (s) s.remove()
    var d = document.createElement('div')
    d.setAttribute('data-folio-transient', '')
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#e7eae6;color:#121714;font:16px/1.6 system-ui,sans-serif;padding:12vh 24px'
    var card = document.createElement('div')
    card.style.cssText = 'max-width:560px;margin:0 auto;background:#fff;padding:28px;border:1px solid #dde1dc;border-radius:12px'
    card.textContent = text
    d.appendChild(card)
    document.body.appendChild(d)
  }
  /*INFLATER*/
  /*B86*/
  var payload = function (id) {
    var el = document.getElementById(id)
    if (!el) throw new Error('payload ' + id + ' missing')
    var out = inflateRaw(b86decode((el.textContent || '').trim()))
    var expected = Number(el.getAttribute('data-len'))
    if (expected && out.length !== expected) throw new Error('payload ' + id + ' is damaged (' + out.length + ' bytes instead of ' + expected + ')')
    var hash = el.getAttribute('data-hash')
    if (hash) {
      var h = 0x811c9dc5
      for (var i = 0; i < out.length; i++) h = Math.imul(h ^ out[i], 0x01000193) >>> 0
      if (('0000000' + h.toString(16)).slice(-8) !== hash) throw new Error('payload ' + id + ' is damaged (checksum mismatch)')
    }
    return new TextDecoder().decode(out)
  }
  // Les modules chargés à la demande (export .docx…) se décompressent par là.
  window.__folioPayload = payload
  var mounted = function () {
    var f = window.folio
    return !!(f && (f.doc || f.locked || f.refused))
  }
  var fr = /^fr/i.test(navigator.language || '')
  try {
    var css = payload('folio-rt-css')
    var st = document.createElement('style')
    st.id = 'folio-rt-style'
    st.setAttribute('data-folio-transient', '')
    st.textContent = css
    document.head.appendChild(st)
    var js = payload('folio-rt')
    var src = js + '\n//# sourceURL=folio-pages.js'
    var tried = []
    var path = null
    try {
      var sc = document.createElement('script')
      sc.setAttribute('data-folio-transient', '')
      sc.textContent = src
      document.body.appendChild(sc)
      if (mounted()) path = 'inline'
      else {
        sc.remove()
        tried.push('inline: no app')
      }
    } catch (e) {
      tried.push('inline: ' + (e && e.message))
    }
    if (!path) {
      try {
        new Function(src)()
        if (mounted()) path = 'function'
        else tried.push('function: no app')
      } catch (e) {
        tried.push('function: ' + (e && e.message))
      }
    }
    if (!path) {
      try {
        var url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }))
        await import(url)
        if (mounted()) path = 'blob'
        else tried.push('blob: no app')
      } catch (e) {
        tried.push('blob: ' + (e && e.message))
      }
    }
    if (!path) throw new Error(tried.join('; '))
    window.folio.loader = { path: path, tried: tried, violations: violations }
  } catch (e) {
    failText(
      (fr
        ? 'Ce fichier Folio Pages n’a pas pu démarrer : '
        : 'This Folio Pages file could not start: ') +
        (e && e.message ? e.message : String(e)) +
        (fr
          ? '. Le document n’a pas été modifié : son texte reste lisible en JSON dans ce fichier (bloc « folio-doc »).'
          : '. The document has not been changed: its text is still readable as JSON in this file (the “folio-doc” block).'),
    )
  }
})()
