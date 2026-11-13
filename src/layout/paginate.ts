// Coupure en pages, sans DOM : à partir des boîtes mesurées (paragraphes et
// leurs lignes, lignes de tableau, images…) en coordonnées « sans pages »
// (comme si le texte coulait d'un seul tenant), dire où commence chaque page.
//
// Règles, dans l'ordre où elles s'appliquent :
//   - un saut de page (nœud) ou « saut de page avant » commence une page ;
//   - un paragraphe se coupe entre deux lignes, avec au moins deux lignes de
//     chaque côté quand il en a assez (veuves et orphelines) ;
//   - « lignes solidaires », une image, une ligne de tableau ne se coupent pas :
//     ils passent entiers à la page suivante ;
//   - « paragraphes solidaires » (un titre) suit le paragraphe d'après quand
//     celui-ci change de page ;
//   - une boîte plus haute qu'une page reste seule sur sa page et déborde :
//     visible et corrigeable, plutôt qu'une boucle sans fin ;
//   - les notes de bas de page d'une ligne vont sur la même page qu'elle : la
//     place qu'elles prennent en bas de page est retirée de celle du texte.

export interface Line {
  top: number
  bottom: number
}

/** Une note de bas de page appelée dans une boîte : où (milieu de l'appel) et sa hauteur. */
export interface NoteNeed {
  y: number
  height: number
}

export interface Box {
  top: number
  bottom: number
  /** Notes de bas de page appelées dans la boîte. */
  notes?: NoteNeed[]
  /** text : se coupe entre ses lignes ; atomic : jamais ; break : saut de page (commence une page après lui). */
  kind: 'text' | 'atomic' | 'break'
  keepNext?: boolean
  keepLines?: boolean
  breakBefore?: boolean
  /** Lignes du paragraphe (mesurées à la demande, seulement s'il faut le couper). */
  lines?: () => Line[]
  /** Ligne d'un tableau dont l'en-tête se répète : hauteur de l'en-tête redessiné en haut de la page qu'elle commence. */
  repeatHeight?: number
}

export interface PageBreak {
  /** Indice de la boîte qui commence la nouvelle page. */
  box: number
  /** Première ligne de cette boîte sur la nouvelle page (0 : la boîte entière). */
  line: number
  /** Haut du contenu de la nouvelle page (coordonnées sans pages). */
  top: number
  /** Hauteur occupée sur la page qui se termine. */
  used: number
}

const EPS = 0.5

/**
 * `noteSep` : hauteur du filet qui sépare le texte des notes de bas de page
 * (comptée une fois par page qui a des notes). `contentHeight` : la hauteur
 * du texte d'une page, ou une fonction qui la donne d'après la première boîte
 * de la page (une section peut changer de format ou d'orientation).
 */
export function paginate(boxes: Box[], contentHeight: number | ((firstBox: number) => number), noteSep = 0): PageBreak[] {
  const breaks: PageBreak[] = []
  const heightOf = typeof contentHeight === 'number' ? () => contentHeight : contentHeight
  if (!boxes.length || heightOf(0) <= 0) return breaks
  let pageTop = boxes[0].top
  let firstOnPage = 0
  /** Première ligne, sur la page courante, de la boîte en cours (si elle a été coupée). */
  let lineStart = 0
  /** Hauteur des notes des boîtes déjà placées sur la page. */
  let pageNotes = 0
  let i = 0
  let guard = 0

  const newPage = (box: number, line: number, top: number) => {
    breaks.push({ box, line, top, used: top - pageTop })
    // Une ligne de tableau en haut de page sous son en-tête répété : l'en-tête prend sa place.
    pageTop = top - (line === 0 ? (boxes[box]?.repeatHeight ?? 0) : 0)
    firstOnPage = box
    lineStart = line
    pageNotes = 0
  }
  /** Notes appelées dans la boîte entre deux hauteurs. */
  const notesIn = (b: Box, from: number, to: number): number => {
    if (!b.notes) return 0
    let s = 0
    for (const n of b.notes) if (n.y >= from && n.y < to) s += n.height
    return s
  }
  /** Place prise en bas de page par des notes de cette hauteur (filet compris). */
  const zone = (h: number) => (h > 0 ? h + noteSep : 0)

  while (i < boxes.length && guard++ < 1_000_000) {
    const b = boxes[i]
    const limit = pageTop + Math.max(1, heightOf(firstOnPage))
    // Saut de page demandé avant ce paragraphe.
    if (b.breakBefore && lineStart === 0 && i > firstOnPage) {
      newPage(i, 0, b.top)
      continue
    }
    // Haut de ce qui reste de la boîte sur cette page (une boîte coupée reprend à une ligne).
    const from = lineStart > 0 && b.lines ? b.lines()[lineStart].top : -Infinity
    const boxNotes = notesIn(b, from, Infinity)
    if (b.bottom + zone(pageNotes + boxNotes) <= limit + EPS) {
      pageNotes += boxNotes
      if (b.kind === 'break' && i + 1 < boxes.length) {
        newPage(i + 1, 0, boxes[i + 1].top)
        i++
        continue
      }
      i++
      lineStart = 0
      continue
    }
    // La boîte dépasse la page.
    if (b.kind === 'text' && !b.keepLines && b.lines) {
      const lines = b.lines()
      let k = -1
      for (let x = lineStart; x < lines.length; x++) {
        if (lines[x].bottom + zone(pageNotes + notesIn(b, from, lines[x].bottom)) > limit + EPS) {
          k = x
          break
        }
      }
      if (k < 0) {
        // Les lignes tiennent (la boîte déborde par sa marge intérieure) : on continue.
        pageNotes += boxNotes
        i++
        lineStart = 0
        continue
      }
      const raw = k
      const remaining = lines.length - lineStart
      // Orpheline : une seule ligne du paragraphe resterait en bas de page.
      if (k - lineStart === 1 && remaining >= 3) k = lineStart
      // Veuve : une seule ligne passerait en haut de la page suivante.
      if (k > lineStart && lines.length - k === 1 && k - 1 > lineStart && remaining >= 3) k -= 1
      // Seule en haut de sa page, la boîte ne peut pas changer de page : on la coupe sans ces règles.
      if (k === lineStart && lineStart === 0 && i === firstOnPage && raw > 0) k = raw
      if (k > lineStart) {
        newPage(i, k, lines[k].top)
        continue
      }
      if (lineStart > 0) {
        // La suite d'un paragraphe coupé ne tient pas sur une page vide : la ligne est plus haute que la page.
        newPage(i, lineStart + 1 < lines.length ? lineStart + 1 : lineStart, lines[Math.min(lineStart + 1, lines.length - 1)].top)
        if (lineStart + 1 >= lines.length) {
          i++
          lineStart = 0
        }
        continue
      }
    }
    // Toute la boîte passe à la page suivante ; les titres « solidaires » qui la précèdent aussi.
    let j = i
    while (j - 1 > firstOnPage && boxes[j - 1].keepNext && lineStart === 0) j--
    if (j > firstOnPage && lineStart === 0) {
      newPage(j, 0, boxes[j].top)
      i = j
      continue
    }
    // La boîte est seule en haut de sa page et plus haute qu'elle : elle déborde ; la suivante change de page.
    i++
    lineStart = 0
    if (i < boxes.length) newPage(i, 0, boxes[i].top)
  }
  return breaks
}

/** Numéro de page affiché : décimal, romain ou alphabétique. */
export function pageLabel(n: number, format: string): string {
  if (format === 'decimal' || n <= 0) return String(n)
  if (format === 'roman' || format === 'ROMAN') {
    const table: [number, string][] = [
      [1000, 'm'],
      [900, 'cm'],
      [500, 'd'],
      [400, 'cd'],
      [100, 'c'],
      [90, 'xc'],
      [50, 'l'],
      [40, 'xl'],
      [10, 'x'],
      [9, 'ix'],
      [5, 'v'],
      [4, 'iv'],
      [1, 'i'],
    ]
    let x = n
    let s = ''
    for (const [v, r] of table) while (x >= v) {
      s += r
      x -= v
    }
    return format === 'ROMAN' ? s.toUpperCase() : s
  }
  // a, b, … z, aa, ab…
  let x = n
  let s = ''
  while (x > 0) {
    x--
    s = String.fromCharCode(97 + (x % 26)) + s
    x = Math.floor(x / 26)
  }
  return format === 'ALPHA' ? s.toUpperCase() : s
}
