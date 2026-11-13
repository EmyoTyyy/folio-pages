// Notes de version embarquées : ce qui est nouveau dans cette version,
// montré une fois après une mise à jour (et à la demande, Aide → Nouveautés).

export const RELEASE_NOTES: Record<string, { fr: string[]; en: string[] }> = {
  '0.10.0': {
    fr: [
      'Effets du texte : contour, ombre, halo, bordure et trame des caractères, soulignement double, épais, pointillé, tirets ou ondulé, et sa couleur ; texte décoratif tout fait.',
      'Lettrine, césure automatique (et trait d’union conditionnel, Ctrl+-), filigrane texte ou image, « Définir par défaut ».',
      'Image : corrections, couleur, effets artistiques, transparence, ombre, halo, bords adoucis — gardés dans .docx et .odt.',
      'Atteindre (Ctrl+G), sélection du texte de mise en forme semblable, nombre en lettres ou en chiffres romains, page de garde, ligne de signature, capture d’écran, mode brouillon.',
      'Rechercher le texte surligné : option de la barre de recherche, ou menu du surligneur ; avec un texte, seuls les passages surlignés comptent.',
    ],
    en: [
      'Text effects: outline, shadow, glow, character border and shading, double, thick, dotted, dashed or wavy underline and its colour; ready-made decorative text.',
      'Drop cap, automatic hyphenation (and optional hyphen, Ctrl+-), text or picture watermark, “Set as Default”.',
      'Pictures: corrections, colour, artistic effects, transparency, shadow, glow, soft edges, kept in .docx and .odt.',
      'Go To (Ctrl+G), select text with similar formatting, numbers in words or Roman numerals, cover page, signature line, screenshot, draft view.',
      'Find highlighted text: an option of the find bar, or the highlighter menu; with a search text, only highlighted passages count.',
    ],
  },
  '0.9.0': {
    fr: [
      'Correction automatique pendant la frappe : fautes courantes, symboles (©, →, ½), guillemets « » et “ ”, apostrophe ’, espaces insécables avant ; : ! ? ; liste modifiable.',
      'Fichier → Nouveau à partir d’un modèle : lettre, CV, rapport, compte rendu, facture, mémoire, recette, fiche d’exercices.',
      'Fichier → Exporter dans un autre format : OpenDocument (.odt), livre numérique (.epub), page web, Markdown, texte brut.',
      'Publipostage → E-mail : la pièce jointe peut être une copie .odt.',
    ],
    en: [
      'AutoCorrect while typing: common typos, symbols (©, →, ½), curly quotes and apostrophes, French non-breaking spaces; the list can be edited.',
      'File → New from Template: letter, résumé, report, meeting minutes, invoice, thesis, recipe, worksheet.',
      'File → Export to Another Format: OpenDocument (.odt), e-book (.epub), web page, Markdown, plain text.',
      'Mailings → E-mail: the attachment can be an .odt copy.',
    ],
  },
  '0.8.0': {
    fr: [
      'Citations et bibliographie (APA, MLA, Chicago, Harvard, IEEE, ISO 690), sources retrouvées par DOI ou ISBN.',
      'Légendes numérotées, table des illustrations, signets et renvois, index, table des références.',
      'Une section peut avoir son propre format : une page en paysage au milieu du document, imprimée en paysage.',
      'La ligne d’en-tête d’un tableau se répète sur chaque page ; les longues tables des matières continuent sur la page suivante.',
      'Publipostage → E-mail : envoyer le document à une ou plusieurs adresses (dans le message ou en pièce jointe), ou des e-mails personnalisés un par un, avec votre messagerie, Gmail, Outlook.com ou en brouillons .eml.',
      'En ligne, si vous le voulez : demander à Claude ou ChatGPT dans une fenêtre voisine, dicter, images libres, rechercher et synonymes, polices Google intégrées.',
    ],
    en: [
      'Citations and bibliography (APA, MLA, Chicago, Harvard, IEEE, ISO 690), sources found by DOI or ISBN.',
      'Numbered captions, table of figures, bookmarks and cross-references, index, table of authorities.',
      'A section can have its own paper: a landscape page in the middle of the document, printed in landscape.',
      'A table’s header row repeats on every page; long tables of contents continue on the next page.',
      'Mailings → E-mail: send the document to one or more addresses (in the message or attached), or personalized e-mails one by one, with your mail app, Gmail, Outlook.com or as .eml drafts.',
      'Online, if you want it: ask Claude or ChatGPT in a window alongside, dictate, free pictures, search and thesaurus, embedded Google fonts.',
    ],
  },
  '0.7.0': {
    fr: [
      'Protection par mot de passe : le document est chiffré (AES-256), titre compris.',
      'Onglet Publipostage : lettres, e-mails, enveloppes, étiquettes et répertoires à partir d’une liste de destinataires.',
      'Mode hors ligne : un interrupteur bloque toute fonction réseau.',
      'Mises à jour signées : « Mettre à jour ce fichier » garde le document et change l’application.',
      'Langues ajoutables : un paquet de langue s’importe, et peut voyager dans le fichier.',
      'Rogner une image à la souris, avec ses poignées, et un bouton Rogner sous le menu du clic droit.',
      'Ruban et menus du clic droit disposés comme d’habitude ; clic droit partout ; Ctrl+Z où que soit le focus.',
      'Vérifier l’accessibilité, trier, mode Focus, zoom sur une page, styles d’image.',
    ],
    en: [
      'Password protection: the document is encrypted (AES-256), title included.',
      'Mailings tab: letters, e-mails, envelopes, labels and directories from a list of recipients.',
      'Offline mode: one switch blocks every network feature.',
      'Signed updates: “Update this file” keeps the document and replaces the application.',
      'Extra languages: a language pack can be imported, and can travel inside the file.',
      'Crop a picture with the mouse, by its handles, and a Crop button under the right-click menu.',
      'Ribbon and right-click menus laid out as usual; right-click anywhere; Ctrl+Z wherever the focus is.',
      'Accessibility checker, sorting, focus mode, one-page zoom, picture styles.',
    ],
  },
  '0.6.0': {
    fr: ['Équations LaTeX, en ligne et centrées, numérotées, en .docx aussi.', 'Ruban à la manière des traitements de texte habituels, menu contextuel, liens à suivre.'],
    en: ['LaTeX equations, in line and centred, numbered, in .docx too.', 'A ribbon laid out like usual word processors, a context menu, links you can follow.'],
  },
}
