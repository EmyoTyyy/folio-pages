// Échelle d'affichage d'un élément mis à l'échelle par le zoom (transformation).
//
// `offsetWidth` est arrondi au pixel : une page A4 (793,7 px) en donne 794, soit
// une échelle fausse de 0,04 %. L'erreur grandit avec la distance au haut de la
// page : 0,4 px par feuille, plusieurs lignes au bout de 300 pages. La largeur
// calculée (getComputedStyle), elle, n'est pas arrondie.

/** Largeur affichée ÷ largeur CSS de l'élément (1 si l'élément n'est pas affiché). */
export function displayScale(el: HTMLElement): number {
  const shown = el.getBoundingClientRect().width
  const cs = getComputedStyle(el)
  let width = parseFloat(cs.width)
  if (cs.boxSizing !== 'border-box') {
    for (const v of [cs.paddingLeft, cs.paddingRight, cs.borderLeftWidth, cs.borderRightWidth]) width += parseFloat(v) || 0
  }
  return shown > 0 && width > 0 ? shown / width : 1
}
