// Formules collées depuis une autre page : on ne garde que leur source LaTeX.
//
// KaTeX, MathJax, Temml (et Bento) joignent la source au MathML dans
// <annotation encoding="application/x-tex">. D'autres la mettent dans
// l'attribut alttext. Sans source, on renonce (le texte de la formule est
// alors repris comme du texte ordinaire) : le MathML collé lui-même n'est
// jamais inséré.

const MAX = 20_000

export function texOfMathDom(el: Element): { tex: string } | null {
  const ann = el.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="TeX"], annotation[encoding="application/x-latex"]')
  const raw = (ann?.textContent ?? el.getAttribute('alttext') ?? '').trim()
  if (!raw || raw.length > MAX) return null
  // Une source KaTeX en mode bloc commence parfois par \displaystyle ; Wikipédia
  // écrit « {\displaystyle …} » : inutile ici.
  const wrapped = /^\{\\displaystyle\s*([\s\S]*)\}$/.exec(raw)
  const tex = (wrapped ? wrapped[1] : raw).replace(/^\\displaystyle\s*/, '').trim()
  return tex ? { tex } : null
}
