// Dictionnaire des fonctions de traitement de texte ajoutées en 0.10 :
// effets du texte, lettrine, filigrane, césure, Atteindre, nombres, page de
// garde, ligne de signature, capture d'écran, retouches d'image, mode brouillon.

type Entry = string | { one: string; other: string }
type Row = { fr: Entry; en: Entry }

export const WORD2_DICT = {
  // --- effets du texte
  'fx.noBorder': { fr: 'Aucune bordure', en: 'No border' },
  'fx.noShading': { fr: 'Aucune trame', en: 'No shading' },
  'fx.noGlow': { fr: 'Aucun halo', en: 'No glow' },
  'fx.outline': { fr: 'Contour', en: 'Outline' },
  'fx.shadow': { fr: 'Ombre', en: 'Shadow' },
  'fx.glow': { fr: 'Halo', en: 'Glow' },
  'fx.clear': { fr: 'Effacer les effets', en: 'Clear effects' },
  'fx.placeholder': { fr: 'Votre texte ici', en: 'Your text here' },
  'fx.preset.fill': { fr: 'Couleur d’accent, ombre', en: 'Accent colour, shadow' },
  'fx.preset.outline': { fr: 'Contour', en: 'Outline' },
  'fx.preset.glow': { fr: 'Halo', en: 'Glow' },
  'fx.preset.shadow': { fr: 'Ombre portée', en: 'Drop shadow' },
  'fx.preset.spaced': { fr: 'Capitales espacées', en: 'Spaced capitals' },
  'fx.preset.outlineGlow': { fr: 'Contour et halo', en: 'Outline and glow' },

  // --- lettrine
  'dc.none': { fr: 'Aucune', en: 'None' },
  'dc.lines': { fr: { one: 'Lettrine sur {n} ligne', other: 'Lettrine sur {n} lignes' }, en: { one: 'Dropped, {n} line', other: 'Dropped, {n} lines' } },

  // --- césure
  'hy.none': { fr: 'Aucune', en: 'None' },
  'hy.auto': { fr: 'Automatique', en: 'Automatic' },
  'hy.soft': { fr: 'Trait d’union conditionnel', en: 'Optional hyphen' },
  'hy.softHint': { fr: 'Ctrl+- : coupe le mot ici si besoin', en: 'Ctrl+-: break the word here if needed' },

  // --- filigrane
  'wm.custom': { fr: 'Filigrane personnalisé…', en: 'Custom Watermark…' },
  'wm.remove': { fr: 'Supprimer le filigrane', en: 'Remove Watermark' },
  'wm.horizontalShort': { fr: 'horizontal', en: 'horizontal' },
  'wm.title': { fr: 'Filigrane', en: 'Watermark' },
  'wm.kind.none': { fr: 'Aucun filigrane', en: 'No watermark' },
  'wm.kind.image': { fr: 'Image', en: 'Picture' },
  'wm.kind.text': { fr: 'Texte', en: 'Text' },
  'wm.pickImage': { fr: 'Choisir une image…', en: 'Select Picture…' },
  'wm.scale': { fr: 'Taille', en: 'Scale' },
  'wm.washout': { fr: 'Délavée', en: 'Washout' },
  'wm.text': { fr: 'Texte', en: 'Text' },
  'wm.size': { fr: 'Taille', en: 'Size' },
  'wm.auto': { fr: 'Automatique', en: 'Auto' },
  'wm.color': { fr: 'Choisir', en: 'Choose' },
  'wm.colorLabel': { fr: 'Couleur', en: 'Colour' },
  'wm.grey': { fr: 'Gris clair', en: 'Light grey' },
  'wm.layout': { fr: 'Disposition', en: 'Layout' },
  'wm.diagonal': { fr: 'Diagonale', en: 'Diagonal' },
  'wm.horizontal': { fr: 'Horizontale', en: 'Horizontal' },
  'wm.opacity': { fr: 'Opacité', en: 'Opacity' },

  // --- définir par défaut
  'def.title': { fr: 'Définir par défaut', en: 'Set as Default' },
  'def.body': {
    fr: 'Les nouveaux documents (Nouveau document vide, modèle « Document vide ») prendront le thème, les styles et la mise en page de ce document. Le réglage est gardé dans ce navigateur.',
    en: 'New documents (New blank document, the “Blank document” template) will use this document’s theme, styles and page setup. The setting is kept in this browser.',
  },
  'def.already': { fr: 'Un réglage par défaut existe déjà : il sera remplacé.', en: 'A default is already set: it will be replaced.' },
  'def.ok': { fr: 'Définir par défaut', en: 'Set as Default' },
  'def.reset': { fr: 'Revenir à l’origine', en: 'Restore original' },
  'def.done': { fr: 'Les nouveaux documents suivront ce thème, ces styles et cette mise en page.', en: 'New documents will use this theme, these styles and this page setup.' },
  'def.resetDone': { fr: 'Les nouveaux documents reprennent les réglages d’origine.', en: 'New documents are back to the original settings.' },

  // --- retouches d'image
  'pfx.brightnessContrast': { fr: 'Luminosité et contraste', en: 'Brightness and contrast' },
  'pfx.bc': { fr: 'Luminosité {b}, contraste {c}', en: 'Brightness {b}, contrast {c}' },
  'pfx.reset': { fr: 'Rétablir l’image', en: 'Reset picture' },
  'pfx.saturationTitle': { fr: 'Saturation des couleurs', en: 'Colour saturation' },
  'pfx.saturation': { fr: 'Saturation {n} %', en: 'Saturation {n}%' },
  'pfx.recolorTitle': { fr: 'Recolorier', en: 'Recolour' },
  'pfx.recolor.none': { fr: 'Aucune recoloration', en: 'No recolour' },
  'pfx.recolor.grayscale': { fr: 'Niveaux de gris', en: 'Greyscale' },
  'pfx.recolor.sepia': { fr: 'Sépia', en: 'Sepia' },
  'pfx.recolor.washout': { fr: 'Délavé', en: 'Washout' },
  'pfx.recolor.blackwhite': { fr: 'Noir et blanc', en: 'Black and white' },
  'pfx.artistic.none': { fr: 'Aucun', en: 'None' },
  'pfx.artistic.blur': { fr: 'Flou', en: 'Blur' },
  'pfx.artistic.pencil': { fr: 'Crayon', en: 'Pencil sketch' },
  'pfx.artistic.negative': { fr: 'Négatif', en: 'Negative' },
  'pfx.transparencyN': { fr: 'Transparence {n} %', en: 'Transparency {n}%' },
  'pfx.shadow': { fr: 'Ombre portée', en: 'Drop shadow' },
  'pfx.glow': { fr: 'Halo', en: 'Glow' },
  'pfx.softEdges': { fr: 'Bords adoucis', en: 'Soft edges' },
  'pfx.softNone': { fr: 'Aucun', en: 'None' },
  'pfx.softN': { fr: '{n} pt', en: '{n} pt' },
  'pfx.clearEffects': { fr: 'Retirer les effets', en: 'Remove effects' },

  // --- Atteindre
  'goto.title': { fr: 'Atteindre', en: 'Go To' },
  'goto.what': { fr: 'Atteindre', en: 'Go to what' },
  'goto.kind.page': { fr: 'Page', en: 'Page' },
  'goto.kind.heading': { fr: 'Titre', en: 'Heading' },
  'goto.kind.footnote': { fr: 'Note de bas de page', en: 'Footnote' },
  'goto.kind.endnote': { fr: 'Note de fin', en: 'Endnote' },
  'goto.kind.bookmark': { fr: 'Signet', en: 'Bookmark' },
  'goto.kind.comment': { fr: 'Commentaire', en: 'Comment' },
  'goto.kind.table': { fr: 'Tableau', en: 'Table' },
  'goto.kind.image': { fr: 'Image', en: 'Graphic' },
  'goto.kind.equation': { fr: 'Équation', en: 'Equation' },
  'goto.enterPage': { fr: 'Numéro de la page', en: 'Enter page number' },
  'goto.enterNumber': { fr: 'Numéro : {what}', en: 'Enter {what} number' },
  'goto.enterName': { fr: 'Nom du signet', en: 'Enter bookmark name' },
  'goto.hintPage': { fr: 'Tapez + ou − pour avancer ou reculer depuis la page actuelle (+2 avance de deux pages).', en: 'Enter + and − to move relative to the current page (+2 moves forward two pages).' },
  'goto.hintOther': { fr: 'Sans numéro : Suivant et Précédent passent d’un élément au suivant.', en: 'Without a number, Next and Previous move from one item to the next.' },
  'goto.go': { fr: 'Atteindre', en: 'Go To' },
  'goto.next': { fr: 'Suivant', en: 'Next' },
  'goto.previous': { fr: 'Précédent', en: 'Previous' },
  'goto.notFound': { fr: 'Introuvable : {what}.', en: 'Not found: {what}.' },

  // --- mise en forme semblable
  'similar.none': { fr: 'Aucun texte de cette mise en forme.', en: 'No text with this formatting.' },
  'similar.done': {
    fr: { one: '{n} passage sélectionné : la mise en forme que vous choisissez s’applique à tous.', other: '{n} passages sélectionnés : la mise en forme que vous choisissez s’applique à tous.' },
    en: { one: '{n} passage selected: the formatting you pick applies to all.', other: '{n} passages selected: the formatting you pick applies to all of them.' },
  },

  // --- nombre
  'num.title': { fr: 'Nombre', en: 'Number' },
  'num.value': { fr: 'Nombre', en: 'Number' },
  'num.format': { fr: 'Format', en: 'Number type' },
  'num.f.digits': { fr: '1 234,5', en: '1,234.5' },
  'num.f.words': { fr: 'en lettres (mille deux-cent…)', en: 'in words (one thousand two hundred…)' },
  'num.f.ordinal': { fr: '1er, 2e, 3e…', en: '1st, 2nd, 3rd…' },
  'num.f.ordinalWords': { fr: 'premier, deuxième…', en: 'first, second…' },
  'num.f.roman': { fr: 'i, ii, iii…', en: 'i, ii, iii…' },
  'num.f.ROMAN': { fr: 'I, II, III…', en: 'I, II, III…' },
  'num.f.alpha': { fr: 'a, b, c…', en: 'a, b, c…' },
  'num.f.ALPHA': { fr: 'A, B, C…', en: 'A, B, C…' },

  // --- page de garde
  'cover.classic': { fr: 'Classique', en: 'Classic' },
  'cover.band': { fr: 'Bandeau', en: 'Banded' },
  'cover.side': { fr: 'Filet', en: 'Sideline' },
  'cover.minimal': { fr: 'Épurée', en: 'Minimal' },
  'cover.note': { fr: 'Le titre, le sujet, l’auteur et l’organisation viennent des propriétés du document.', en: 'The title, subject, author and organization come from the document properties.' },
  'cover.hint': { fr: 'Page de garde insérée. Donnez un titre au document (en haut de la fenêtre) : il s’y affichera.', en: 'Cover page inserted. Give the document a title (at the top of the window): it will show there.' },

  // --- ligne de signature
  'sign.menu': { fr: 'Ligne de signature…', en: 'Signature Line…' },
  'sign.title': { fr: 'Ligne de signature', en: 'Signature line' },
  'sign.name': { fr: 'Nom du signataire', en: 'Suggested signer' },
  'sign.role': { fr: 'Fonction', en: 'Title' },
  'sign.email': { fr: 'Adresse e-mail', en: 'E-mail address' },
  'sign.date': { fr: 'Ajouter la date du jour', en: 'Show the date' },
  'sign.draw': { fr: 'Signer ici (facultatif)', en: 'Sign here (optional)' },
  'sign.padLabel': { fr: 'Zone de signature', en: 'Signature pad' },
  'sign.padHint': { fr: 'À la souris, au stylet ou au doigt. Vide : une ligne à signer à la main.', en: 'With a mouse, pen or finger. Left empty: a line to sign by hand.' },
  'sign.clear': { fr: 'Effacer', en: 'Clear' },

  // --- capture d'écran
  'shot.window': { fr: 'Capturer une fenêtre ou l’écran…', en: 'Capture a window or the screen…' },
  'shot.hint': { fr: 'Le navigateur demande quoi capturer', en: 'The browser asks what to capture' },
  'shot.fileName': { fr: 'Capture d’écran', en: 'Screenshot' },
  'shot.unsupported': { fr: 'Ce navigateur ne permet pas la capture d’écran (essayez Chrome, Edge ou Firefox sur ordinateur).', en: 'This browser can’t capture the screen (try Chrome, Edge or Firefox on a computer).' },
  'shot.failed': { fr: 'La capture d’écran n’a pas pu être faite.', en: 'The screenshot could not be taken.' },
} satisfies Record<string, Row>
