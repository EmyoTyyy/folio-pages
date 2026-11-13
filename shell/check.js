// Vérification du navigateur, en ES5 : elle doit pouvoir s'exécuter partout,
// même là où le reste ne le peut pas, pour expliquer au lieu d'une page blanche.
(function () {
  var ok = false
  try {
    ok =
      typeof Uint8Array === 'function' &&
      typeof TextDecoder === 'function' &&
      typeof Promise === 'function' &&
      typeof Array.prototype.at === 'function' &&
      typeof Object.hasOwn === 'function' &&
      typeof structuredClone === 'function' &&
      typeof HTMLDialogElement === 'function' &&
      typeof Intl === 'object' &&
      typeof Intl.PluralRules === 'function'
  } catch (e) {
    ok = false
  }
  window.__folioOk = ok
  if (ok) return
  var fr = /^fr/i.test(navigator.language || navigator.userLanguage || '')
  var text = fr
    ? ['Ce fichier est un document Folio Pages.', 'Pour l’ouvrir, il faut un navigateur récent : Chrome ou Edge 111 ou plus, Firefox 113 ou plus, ou Safari 16.4 ou plus.', 'Rien n’est perdu : le contenu est enregistré en JSON lisible dans ce même fichier. Ouvrez-le avec un navigateur plus récent, ou avec un éditeur de texte (cherchez le bloc « folio-doc »).']
    : ['This file is a Folio Pages document.', 'Opening it needs a recent browser: Chrome or Edge 111 or later, Firefox 113 or later, or Safari 16.4 or later.', 'Nothing is lost: the content is stored as readable JSON inside this same file. Open it in a newer browser, or in a text editor (look for the block marked “folio-doc”).']
  var show = function () {
    var s = document.getElementById('folio-splash')
    if (s && s.parentNode) s.parentNode.removeChild(s)
    var d = document.createElement('div')
    d.setAttribute('style', 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:#e7eae6;color:#121714;font:16px/1.6 sans-serif;padding:12vh 24px')
    var card = document.createElement('div')
    card.setAttribute('style', 'max-width:560px;margin:0 auto;background:#fff;padding:28px;border:1px solid #dde1dc')
    for (var i = 0; i < text.length; i++) {
      var p = document.createElement(i === 0 ? 'b' : 'p')
      p.appendChild(document.createTextNode(text[i]))
      card.appendChild(p)
    }
    d.appendChild(card)
    document.body.appendChild(d)
  }
  if (document.body) show()
  else document.addEventListener('DOMContentLoaded', show)
})()
