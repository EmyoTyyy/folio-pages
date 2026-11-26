// Aide-mémoire : les raccourcis clavier, le Markdown à la frappe, les champs,
// les formules et quelques astuces, écrits une seule fois. Ils servent à la
// fenêtre « Aide-mémoire » (F1 ou ?) et au document à imprimer, qui est un
// document Folio Pages comme un autre (deux pages A4 en paysage, en colonnes).
//
// Une ligne a des touches (combinaisons, séparées par « / » à l'affichage) ou
// un texte à taper (« # » puis espace…), et ce qu'elle fait.

import { loadDocument } from '../format/load'
import type { FolioDoc } from '../format/types'

export type CheatLang = 'fr' | 'en'

export interface CheatRow {
  /** Combinaisons de touches, en jetons : Mod, Shift, Alt, Enter, Esc, Del, Space, Tab, Wheel, Click… */
  keys?: string[]
  /** Ce qu'on tape (Markdown, champ, formule), montré en police à chasse fixe. */
  type?: string[]
  text: string
}

export interface CheatSection {
  id: string
  title: string
  rows: CheatRow[]
  /** Page du document imprimé : 1 (raccourcis) ou 2 (saisie et astuces). */
  page: 1 | 2
}

export interface CheatSheet {
  title: string
  subtitle: string
  sections: CheatSection[]
  tips: string[]
  tipsTitle: string
}

/** Une combinaison de touches lisible : « Ctrl+Maj+X », ou « ⌘⇧X » sur Mac. */
export function keyLabel(combo: string, lang: CheatLang, mac: boolean): string {
  const fr = lang === 'fr'
  const names: Record<string, string> = mac
    ? { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' }
    : { Mod: 'Ctrl', Shift: fr ? 'Maj' : 'Shift', Alt: 'Alt', Ctrl: 'Ctrl' }
  const words: Record<string, string> = {
    Enter: fr ? 'Entrée' : 'Enter',
    Esc: fr ? 'Échap' : 'Esc',
    Del: fr ? 'Suppr' : 'Delete',
    Space: fr ? 'Espace' : 'Space',
    Wheel: fr ? 'molette' : 'wheel',
    Click: fr ? 'clic' : 'click',
    Drag: fr ? 'glisser' : 'drag',
    Arrows: fr ? 'flèches' : 'arrows',
    Menu: fr ? 'touche Menu' : 'Menu key',
    Middle: fr ? 'clic du milieu' : 'middle click',
    Backspace: fr ? 'Retour arrière' : 'Backspace',
    PageDown: fr ? 'Page suiv.' : 'Page Down',
    PageUp: fr ? 'Page préc.' : 'Page Up',
  }
  // Un nom de touche en plusieurs mots ne se coupe pas (seul « / » entre deux touches le peut).
  const parts = combo.split('+').map((p) => names[p] ?? words[p]?.replace(/ /g, '\u00a0') ?? p)
  // Sur Mac, les modificateurs se collent à la touche (⌘⇧X) ; ailleurs, avec « + ».
  if (mac) {
    const mods = parts.filter((p) => ['⌘', '⇧', '⌥', '⌃'].includes(p)).join('')
    const rest = parts.filter((p) => !['⌘', '⇧', '⌥', '⌃'].includes(p)).join('+')
    return mods + rest
  }
  return parts.join('+')
}

/** Le contenu, dans une langue (le français ou l'anglais ; les autres langues prennent l'anglais). */
export function cheatSheet(lang: CheatLang): CheatSheet {
  const L = (fr: string, en: string) => (lang === 'fr' ? fr : en)
  const k = (text: string, ...keys: string[]): CheatRow => ({ keys, text })
  const y = (text: string, ...type: string[]): CheatRow => ({ type, text })
  const date = L('{{date:JJ/MM/AAAA}}', '{{date:DD/MM/YYYY}}')

  const sections: CheatSection[] = [
    {
      id: 'text',
      page: 1,
      title: L('Mise en forme du texte', 'Text formatting'),
      rows: [
        k(L('Gras', 'Bold'), 'Mod+B'),
        k(L('Italique', 'Italic'), 'Mod+I'),
        k(L('Souligné', 'Underline'), 'Mod+U'),
        k(L('Barré', 'Strikethrough'), 'Mod+Shift+X'),
        k(L('Surligner (encore : enlever)', 'Highlight (again: remove)'), 'Mod+Alt+H'),
        k(L('Exposant · indice', 'Superscript · subscript'), 'Mod+.', 'Mod+,'),
        k(L('Agrandir · réduire la police', 'Grow · shrink the font'), 'Mod+Shift+>', 'Mod+Shift+<'),
        k(L('minuscules → MAJUSCULES → Première lettre', 'lower → UPPER → Capitalised'), 'Shift+F3'),
        k(L('Effacer la mise en forme', 'Clear formatting'), 'Mod+Space', 'Mod+\\'),
        k(L('Copier · appliquer la mise en forme', 'Copy · paste formatting'), 'Mod+Alt+C', 'Mod+Alt+V'),
        k(L('Lien', 'Link'), 'Mod+K'),
        k(L('Ouvrir un lien', 'Follow a link'), 'Mod+Click'),
      ],
    },
    {
      id: 'paragraph',
      page: 1,
      title: L('Paragraphes et styles', 'Paragraphs and styles'),
      rows: [
        k(L('Titre 1 à 6', 'Heading 1 to 6'), 'Mod+Alt+1…6'),
        k(L('Texte normal', 'Normal text'), 'Mod+Alt+0'),
        k(L('Aligner à gauche, centrer, à droite, justifier', 'Align left, centre, right, justify'), 'Mod+Shift+L / E / R / J'),
        k(L('Liste numérotée · à puces · à cocher', 'Numbered · bulleted · check list'), 'Mod+Shift+7', 'Mod+Shift+8', 'Mod+Shift+9'),
        k(L('Niveau de liste suivant · précédent', 'Next · previous list level'), 'Tab', 'Shift+Tab'),
        k(L('Retour à la ligne dans le paragraphe', 'Line break inside the paragraph'), 'Shift+Enter'),
        k(L('Saut de page · saut de colonne', 'Page break · column break'), 'Mod+Enter', 'Mod+Shift+Enter'),
        k(L('Espace insécable · trait d’union conditionnel', 'Non-breaking space · optional hyphen'), 'Mod+Shift+Space', 'Mod+-'),
      ],
    },
    {
      id: 'insert',
      page: 1,
      title: L('Insérer', 'Insert'),
      rows: [
        k(L('Tableau · image', 'Table · picture'), 'Mod+Alt+T', 'Mod+Alt+I'),
        k(L('Date · heure · numéro de page', 'Date · time · page number'), 'Alt+Shift+D', 'Alt+Shift+T', 'Alt+Shift+P'),
        k(L('Note de bas de page · de fin', 'Footnote · endnote'), 'Mod+Alt+F', 'Mod+Alt+D'),
        k(L('Équation', 'Equation'), 'Alt+='),
        k(L('Commentaire', 'Comment'), 'Mod+Alt+M'),
        k(L('Signet', 'Bookmark'), 'Mod+Shift+F5'),
        k(L('Entrée d’index', 'Index entry'), 'Alt+Shift+X'),
        k(L('Citation pour la table des références', 'Citation for the table of authorities'), 'Alt+Shift+I'),
        k(L('Définir un terme (glossaire)', 'Define a term (glossary)'), 'Alt+Shift+G'),
        k(L('Le mot avant le curseur devient son extrait', 'The word before the caret becomes its snippet'), 'F3'),
      ],
    },
    {
      id: 'edit',
      page: 1,
      title: L('Édition et navigation', 'Editing and navigation'),
      rows: [
        k(L('Annuler · rétablir', 'Undo · redo'), 'Mod+Z', 'Mod+Y'),
        k(L('Rechercher · remplacer', 'Find · replace'), 'Mod+F', 'Mod+H'),
        k(L('Résultat suivant · précédent (recherche)', 'Next · previous match (find)'), 'Enter', 'Shift+Enter'),
        k(L('Aller à (page, titre, note…)', 'Go to (page, heading, note…)'), 'Mod+G', 'F5'),
        k(L('Coller sans la mise en forme', 'Paste as plain text'), 'Mod+Shift+V'),
        k(L('Synonymes', 'Thesaurus'), 'Shift+F7'),
        k(L('Défaire la dernière conversion automatique', 'Undo the last automatic conversion'), 'Backspace'),
        k(L('Menu de l’endroit (clic droit)', 'Menu for this place (right-click)'), 'Shift+F10', 'Menu'),
        k(L('Rechercher une commande', 'Search the commands'), 'Alt+Q'),
      ],
    },
    {
      id: 'file',
      page: 1,
      title: L('Fichier et affichage', 'File and view'),
      rows: [
        k(L('Enregistrer (dans le fichier lui-même)', 'Save (into the file itself)'), 'Mod+S'),
        k(L('Ouvrir', 'Open'), 'Mod+O'),
        k(L('Imprimer, PDF', 'Print, PDF'), 'Mod+P'),
        k(L('Zoom', 'Zoom'), 'Mod+Wheel'),
        k(L('Ajuster à la largeur de la fenêtre', 'Fit to the window width'), 'Mod+0'),
        k(L('Replier ou déplier le ruban', 'Collapse or expand the ribbon'), 'Mod+F1'),
        k(L('Quitter la lecture, le mode Focus, un outil', 'Leave reading view, Focus mode, a tool'), 'Esc'),
        k(L('Cet aide-mémoire', 'This cheat sheet'), 'F1', '?'),
      ],
    },
    {
      id: 'tables',
      page: 1,
      title: L('Tableaux', 'Tables'),
      rows: [k(L('Cellule suivante · précédente', 'Next · previous cell'), 'Tab', 'Shift+Tab')],
    },
    {
      id: 'shapes',
      page: 1,
      title: L('Formes, images et dessin', 'Shapes, pictures and drawing'),
      rows: [
        k(L('Déplacer la forme choisie (de 10 points)', 'Move the selected shape (by 10 points)'), 'Arrows', 'Shift+Arrows'),
        k(L('Forme suivante · précédente', 'Next · previous shape'), 'Tab', 'Shift+Tab'),
        k(L('Écrire dans la forme', 'Type in the shape'), 'Enter', 'F2'),
        k(L('Ajouter à la sélection', 'Add to the selection'), 'Shift+Click', 'Mod+Click'),
        k(L('Tracer : carré, cercle, trait à 45°', 'Draw: square, circle, line at 45°'), 'Shift+Drag'),
        k(L('Redimensionner : garder (forme) ou libérer (image) les proportions', 'Resize: keep (shape) or free (picture) the proportions'), 'Shift+Drag'),
        k(L('Tourner par pas de 15°', 'Rotate in 15° steps'), 'Shift+Drag'),
        k(L('Dessin : trait droit · supprimer la sélection du lasso', 'Draw: straight line · delete the lasso selection'), 'Shift+Drag', 'Del'),
      ],
    },
    {
      id: 'outline',
      page: 1,
      title: L('Mode Plan', 'Outline view'),
      rows: [
        k(L('Monter · descendre d’un niveau', 'Promote · demote'), 'Alt+Shift+←', 'Alt+Shift+→'),
        k(L('Déplacer la partie vers le haut · le bas', 'Move the section up · down'), 'Alt+Shift+↑', 'Alt+Shift+↓'),
      ],
    },
    {
      id: 'documents',
      page: 1,
      title: L('Documents du fichier', 'Documents in the file'),
      rows: [
        k(L('Volet Documents : parcourir, ouvrir', 'Documents pane: move, open'), 'Arrows', 'Enter'),
        k(L('Document suivant · précédent (onglets)', 'Next · previous document (tabs)'), 'Alt+PageDown', 'Alt+PageUp'),
        k(L('Renommer', 'Rename'), 'F2'),
        k(L('Supprimer (annulable)', 'Delete (can be undone)'), 'Del'),
        k(L('Fermer un onglet', 'Close a tab'), 'Middle'),
      ],
    },
    {
      id: 'markdown',
      page: 2,
      title: L('Markdown à la frappe', 'Markdown as you type'),
      rows: [
        y(L('Titre 1 à 6 (puis espace)', 'Heading 1 to 6 (then space)'), '# ', '## ', '###### '),
        y(L('Liste à puces', 'Bulleted list'), '- ', '* '),
        y(L('Liste numérotée', 'Numbered list'), '1. '),
        y(L('Liste de cases à cocher', 'Check list'), '[ ] ', '[x] '),
        y(L('Citation', 'Quotation'), '> '),
        y(L('Extrait de code (avec son langage)', 'Code block (with its language)'), '``` ', '```python '),
        y(L('Ligne de séparation', 'Divider'), '--- '),
        y(L('Encadré (note, astuce, important, attention, prudence)', 'Callout (note, tip, important, warning, caution)'), '[!note] ', '[!tip] '),
        y(L('Gras · italique', 'Bold · italic'), L('**gras**', '**bold**'), L('*italique*', '*italic*')),
        y(L('Barré · code', 'Strikethrough · code'), L('~~barré~~', '~~struck~~'), '`code`'),
        y(L('Garder un marqueur tel quel', 'Keep a marker as typed'), '\\*'),
        y(L('Points de suspension', 'Ellipsis'), '... → …'),
      ],
    },
    {
      id: 'fields',
      page: 2,
      title: L('Champs (calculés à l’affichage)', 'Fields (computed when shown)'),
      rows: [
        y(L('Numéro de page · nombre de pages', 'Page number · number of pages'), '{{page}}', '{{pages}}'),
        y(L('Titre · auteur du document', 'Document title · author'), L('{{titre}}', '{{title}}'), L('{{auteur}}', '{{author}}')),
        y(L('Date du jour, au format voulu', 'Today’s date, in any format'), '{{date}}', date),
        y(L('Heure · nom du fichier', 'Time · file name'), L('{{heure}}', '{{time}}'), L('{{fichier}}', '{{filename}}')),
        y(L('Garder les accolades', 'Keep the braces as text'), '\\{{'),
      ],
    },
    {
      id: 'math',
      page: 2,
      title: L('Formules (LaTeX)', 'Formulas (LaTeX)'),
      rows: [
        y(L('Dans la ligne (sans espace juste à l’intérieur des $)', 'In the line (no space just inside the $)'), '$E = mc^2$'),
        y(L('Équation centrée (seule dans son paragraphe)', 'Centred equation (alone in its paragraph)'), '$$…$$'),
        y(L('Fraction · racine · puissance · indice', 'Fraction · root · power · index'), '\\frac{a}{b}', '\\sqrt{x}', 'x^{2}', 'x_{i}'),
        y(L('Somme · intégrale · limite', 'Sum · integral · limit'), '\\sum_{i=1}^{n}', '\\int_0^1', '\\lim_{x \\to 0}'),
        y(L('Lettres grecques · ensembles', 'Greek letters · sets'), '\\alpha \\pi \\Omega', '\\mathbb{R}'),
        y(L('Matrice · cas', 'Matrix · cases'), '\\begin{pmatrix}…\\end{pmatrix}', '\\begin{cases}…'),
        y(L('Chimie · unités', 'Chemistry · units'), '\\ce{H2O}', '\\pu{9.81 m/s^2}'),
        y(L('Numéroter et citer une équation', 'Number and refer to an equation'), '\\label{e1}', '\\eqref{e1}'),
        y(L('Raccourcis communs à tout le document', 'Shortcuts shared by the whole document'), '\\newcommand{\\R}{\\mathbb{R}}'),
      ],
    },
  ]

  const tips = [
    L('Double-clic sur une formule, un graphique, un diagramme ou une forme pour le modifier.', 'Double-click a formula, chart, diagram or shape to edit it.'),
    L('Préférez les styles (Titre 1, Citation…) à la mise en forme directe : la table des matières et la navigation s’en servent.', 'Prefer styles (Heading 1, Quote…) to direct formatting: the table of contents and navigation use them.'),
    L('Collez ou déposez une image dans la page. Les photos sont réduites à 2560 pixels ; les captures d’écran restent sans perte.', 'Paste or drop a picture into the page. Photos are reduced to 2560 pixels; screenshots stay lossless.'),
    L('Un fichier lâché sur le volet Documents s’ajoute au fichier (.docx, .odt, .md, Folio Pages…).', 'A file dropped on the Documents pane is added to the file (.docx, .odt, .md, Folio Pages…).'),
    L('Clic droit : les commandes de l’endroit et une recherche dans les menus. Maj+clic droit : le menu du navigateur et ses suggestions d’orthographe.', 'Right-click: the commands for that place and a search of the menus. Shift+right-click: the browser’s menu and its spelling suggestions.'),
    L('Envoyez le fichier à une IA avec une consigne en une phrase : elle remplit le document et vous rend un fichier prêt à ouvrir.', 'Send the file to an AI with a one-sentence request: it fills in the document and gives you back a file ready to open.'),
    L('Chaque document enregistré est aussi une copie de l’application : il s’ouvre partout, sans installation ni connexion.', 'Every saved document is also a copy of the app: it opens anywhere, with no install and no connection.'),
  ]

  return {
    title: L('Aide-mémoire Folio Pages', 'Folio Pages cheat sheet'),
    subtitle: L('Raccourcis clavier, saisie rapide et astuces', 'Keyboard shortcuts, quick typing and tips'),
    sections,
    tips,
    tipsTitle: L('Astuces', 'Tips'),
  }
}

/**
 * L'aide-mémoire à imprimer : un document Folio Pages de deux pages A4 en
 * paysage, en trois colonnes (les raccourcis, puis la saisie et les astuces).
 */
export function cheatSheetDocument(lang: CheatLang, mac: boolean, version = ''): FolioDoc {
  const sheet = cheatSheet(lang)
  const row = (r: CheatRow): unknown => {
    const lead = r.keys
      ? [{ text: r.keys.map((c) => keyLabel(c, lang, mac)).join(' / '), bold: true, color: 'accent1' }]
      : r.type!.flatMap((s, i) => [...(i ? [' '] : []), { text: s, code: true }])
    return { style: 'cheatRow', content: [...lead, '  ', r.text] }
  }
  const page = (n: 1 | 2): unknown[] => sheet.sections.filter((s) => s.page === n).flatMap((s) => [{ type: 'heading', level: 2, text: s.title }, ...s.rows.map(row)])
  const tips = [{ type: 'heading', level: 2, text: sheet.tipsTitle }, ...sheet.tips.map((t) => ({ style: 'cheatRow', text: `· ${t}` }))]
  const raw = {
    format: 'folio/doc',
    version: 1,
    meta: { title: sheet.title, lang },
    page: { size: 'A4', orientation: 'landscape', margins: { top: 11, right: 12, bottom: 11, left: 12 } },
    theme: { name: 'folio' },
    styles: {
      normal: { size: 9.5, spacing: { before: 0, after: 2 }, line: 1.1 },
      title: { size: 18, spacing: { before: 0, after: 0 } },
      subtitle: { size: 10, spacing: { before: 0, after: 6 } },
      heading2: { size: 10.5, color: 'accent1', spacing: { before: 6, after: 2 }, keepNext: true },
      cheatRow: { name: lang === 'fr' ? 'Ligne d’aide-mémoire' : 'Cheat sheet row', basedOn: 'normal', indent: { left: 10, first: -10 }, keepLines: true },
    },
    footers: {
      default: [
        {
          align: 'center',
          content: [
            { text: `Folio Pages${version ? ` ${version}` : ''} · page `, size: 7 },
            { type: 'field', name: 'page', size: 7 },
            { text: ' / ', size: 7 },
            { type: 'field', name: 'pages', size: 7 },
          ],
        },
      ],
    },
    blocks: [
      { style: 'title', text: sheet.title },
      { style: 'subtitle', text: sheet.subtitle },
      { type: 'columns', count: 3, gap: 16, rule: true, blocks: page(1) },
      { type: 'pagebreak' },
      { type: 'columns', count: 3, gap: 16, rule: true, blocks: [...page(2), ...tips] },
    ],
  }
  const r = loadDocument(raw)
  if (!r.ok) throw new Error('aide-mémoire invalide')
  return r.doc
}
