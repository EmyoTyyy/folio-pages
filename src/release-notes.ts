// Notes de version embarquées : ce qui est nouveau dans cette version,
// montré une fois après une mise à jour (et à la demande, Aide → Nouveautés).

export const RELEASE_NOTES: Record<string, { fr: string[]; en: string[] }> = {
  '0.18.0': {
    fr: [
      'Aide-mémoire (F1 ou ?) : tous les raccourcis, le Markdown à la frappe, les champs et les formules, avec une recherche. « Imprimer… » donne deux pages A4 en paysage, à garder près du clavier.',
      'Nouveaux raccourcis faciles à retenir : Ctrl+Alt+H surligner, Ctrl+Maj+9 liste à cocher (après 7 numérotée et 8 à puces), Ctrl+Maj+Espace espace insécable, Ctrl+Maj+Entrée saut de colonne, Alt+Maj+D / T / P date, heure et numéro de page, Ctrl+Alt+T tableau, Ctrl+Alt+I image, Alt+Page suivante / précédente pour changer de document.',
      'La démonstration suit la langue de l’interface : tant qu’on ne l’a pas modifiée, changer de langue l’affiche dans la nouvelle langue.',
    ],
    en: [
      'Cheat sheet (F1 or ?): every shortcut, Markdown typing, fields and formulas, with a search box. “Print…” gives two landscape A4 pages to keep by the keyboard.',
      'New easy-to-remember shortcuts: Ctrl+Alt+H highlight, Ctrl+Shift+9 check list (after 7 numbered and 8 bulleted), Ctrl+Shift+Space non-breaking space, Ctrl+Shift+Enter column break, Alt+Shift+D / T / P date, time and page number, Ctrl+Alt+T table, Ctrl+Alt+I picture, Alt+Page Down / Page Up to change document.',
      'The demo follows the interface language: as long as it has not been edited, changing the language shows it in the new language.',
    ],
  },
  '0.17.0': {
    fr: [
      'Volet Documents : les documents du fichier rangés dans des dossiers (et des dossiers dans des dossiers), comme l’explorateur d’un éditeur de code. Le bouton en bas à gauche (ou Affichage → Documents) le montre ou le cache ; on glisse pour ranger, on l’élargit en tirant son bord.',
      'Les documents ouverts sont des onglets en bas : × ou un clic du milieu ferme un onglet, le document reste dans le fichier. Le navigateur se souvient des onglets ouverts et des dossiers repliés.',
      'Ajouter des fichiers : un .docx, un .odt, un .rtf, du Markdown, du texte, ou un autre fichier Folio Pages avec tous ses documents et dossiers (aussi en les déposant sur le volet). Clic droit : enregistrer un document ou un dossier comme fichier à part, l’exporter en PDF, l’imprimer.',
      'Export et impression : ce document, son dossier, tous, ou les documents que vous cochez.',
    ],
    en: [
      'Documents pane: the documents of the file arranged in folders (and folders in folders), like the explorer of a code editor. The button at the bottom left (or View → Documents) shows or hides it; drag to arrange, drag its edge to widen it.',
      'Open documents are tabs at the bottom: × or a middle click closes a tab, the document stays in the file. The browser remembers the open tabs and the collapsed folders.',
      'Add files: a .docx, .odt, .rtf, Markdown or text file, or another Folio Pages file with all its documents and folders (also by dropping them on the pane). Right-click: save a document or a folder as a separate file, export it to PDF, print it.',
      'Export and print: this document, its folder, all of them, or the documents you tick.',
    ],
  },
  '0.16.0': {
    fr: [
      'Onglet Dessin : crayon (au grain de mine), lasso pour prendre des traits (les déplacer, les supprimer, les convertir), gomme partielle qui coupe un trait là où elle passe. Chaque stylo a ses couleurs, une couleur au choix et une épaisseur au curseur ; Maj trace un trait droit. Formes, zones de texte et images libres sont aussi dans l’onglet.',
      'Encre en forme : un trait, une flèche, un rectangle, une ellipse, un triangle ou un losange dessinés à la main deviennent de vraies formes, modifiables et gardées en .docx et .odt. Rejouer le dessin le refait trait après trait.',
      'Le ruban tient toujours dans la fenêtre : libellés plus courts (le complet reste dans l’infobulle), grands boutons ajustés, un bouton principal par groupe ; quand la place manque, les groupes se resserrent puis se replient en un bouton qui les ouvre dessous.',
    ],
    en: [
      'Draw tab: a pencil (with a lead grain), a lasso to take strokes (move, delete, convert them), a point eraser that cuts a stroke where it passes. Each pen has its colours, any colour, and a thickness slider; Shift draws a straight line. Shapes, text boxes and free pictures are on the tab too.',
      'Ink to shape: a hand-drawn line, arrow, rectangle, ellipse, triangle or diamond becomes a real shape, editable and kept in .docx and .odt. Ink replay redraws the ink stroke by stroke.',
      'The ribbon always fits the window: shorter labels (the full one stays in the tooltip), tighter large buttons, one main button per group; when space runs out, groups tighten, then fold into one button that opens them underneath.',
    ],
  },
  '0.15.0': {
    fr: [
      'Formes et zones de texte : Insertion → Formes (plus de 140 formes : traits et flèches, rectangles, formes de base, flèches pleines, équations, organigramme, étoiles et bannières, bulles) et Insertion → Zone de texte. Une forme suit son paragraphe mais se place librement : on la déplace, la redimensionne, la fait pivoter, on écrit dedans.',
      'Onglet Format de la forme : styles, remplissage, contour (épaisseur, tirets, flèches), ombre, transparence, habillage du texte, position, avancer et reculer, aligner et distribuer, grouper et dissocier, rotation ; volet Sélection pour renommer, masquer et réordonner. Gardées en .docx (vraies formes) et en .odt.',
      'Images libres : une image se place n’importe où sur la page comme une forme (Habillage → Placer librement sur la page, ou Insertion → Images → Image libre). Elle garde ses proportions, ses retouches, se groupe avec des formes, et revient dans le texte en un clic.',
      'La forme se voit pendant qu’on la dessine. L’onglet courant du ruban est rattaché au ruban.',
    ],
    en: [
      'Shapes and text boxes: Insert → Shapes (over 140 shapes: lines and arrows, rectangles, basic shapes, block arrows, equation shapes, flowchart, stars and banners, speech bubbles) and Insert → Text Box. A shape follows its paragraph but sits anywhere on the page: move it, resize it, rotate it, type inside it.',
      'Shape Format tab: styles, fill, outline (weight, dashes, arrows), shadow, transparency, text wrapping, position, bring forward and send backward, align and distribute, group and ungroup, rotate; a Selection pane to rename, hide and reorder. Kept in .docx (real shapes) and .odt.',
      'Free pictures: a picture sits anywhere on the page like a shape (Wrap Text → Place freely on the page, or Insert → Pictures → Free picture). It keeps its proportions and corrections, groups with shapes, and goes back into the text in one click.',
      'A shape shows while you draw it. The current ribbon tab is attached to the ribbon.',
    ],
  },
  '0.14.0': {
    fr: [
      'Disposition d’images (Format de l’image → Disposition de l’image, ou Insertion → Images) : des images et leurs légendes en grille, en bandeau, autour d’une image mise en avant, en étapes, en liste ou en mosaïque. Les images sélectionnées deviennent la disposition ; double-clic pour ajouter, remplacer, déplacer ou retirer des images, changer les légendes ou la disposition. Gardée en .docx et .odt.',
    ],
    en: [
      'Picture layouts (Picture Format → Picture Layout, or Insert → Pictures): pictures and their captions as a grid, a strip, a featured picture, steps, a list or a mosaic. The selected pictures become the layout; double-click to add, replace, reorder or remove pictures, change the captions or the layout. Kept in .docx and .odt.',
    ],
  },
  '0.13.0': {
    fr: [
      'Plusieurs documents dans un fichier : des onglets en bas de la fenêtre (+ pour en ajouter, double-clic pour renommer, clic droit pour dupliquer, déplacer ou supprimer). Chaque document est complet et indépendant, avec sa mise en page, son thème et son historique d’annulation.',
      'Liens et renvois d’un document à l’autre : Insertion → Lien propose les titres et signets de tous les documents du fichier, Références → Renvoi peut viser un autre document (texte, « Tableau 2 », numéro, page).',
      'Exporter et imprimer : ce document ou tous les documents à la suite, chacun commençant une nouvelle page.',
      'Corrections : « Mettre à jour ce fichier » propose le fichier ouvert (Chrome, Edge) au lieu d’en créer un autre ; « Nouveau document vide » efface aussi l’en-tête, le pied de page et le filigrane.',
    ],
    en: [
      'Several documents in one file: tabs at the bottom of the window (+ to add one, double-click to rename, right-click to duplicate, move or delete). Each document is complete and independent, with its own page setup, theme and undo history.',
      'Links and cross-references from one document to another: Insert → Link lists the headings and bookmarks of every document in the file, References → Cross-reference can point into another document (text, “Table 2”, number, page).',
      'Export and print: this document or all of them, one after another, each starting on a new page.',
      'Fixes: “Update this file” offers the open file (Chrome, Edge) instead of making another one; “New blank document” also clears the header, footer and watermark.',
    ],
  },
  '0.12.0': {
    fr: [
      'Mode lecture côte à côte (Affichage → Côte à côte, ou dans la barre du mode lecture) : deux pages par écran comme un livre ouvert, tournées avec les flèches, le clavier, la molette ou le doigt ; le sommaire, les liens et Rechercher y mènent à la bonne page.',
      'Correction : en mode lecture, Échap dans la recherche ferme la recherche sans quitter le mode lecture.',
    ],
    en: [
      'Side-to-side reading (View → Side to Side, or in the reading-mode bar): two pages per screen like an open book, turned with the arrows, keyboard, mouse wheel or a swipe; the table of contents, links and Find take you to the right page.',
      'Fix: in reading mode, Esc in the find box closes the find box without leaving reading mode.',
    ],
  },
  '0.11.0': {
    fr: [
      'Listes à cocher, encadrés (Note, Astuce, Attention…), extraits réutilisables (F3), glossaire et liste des abréviations.',
      'Statistiques et lisibilité (clic sur le nombre de mots), objectif d’écriture, défilement machine à écrire, enregistrement automatique.',
      'Graphiques en barres, courbes ou secteurs, depuis un tableau en un clic ; de vrais graphiques dans les .docx.',
      'Numéros de ligne, paragraphes de droite à gauche, texte vertical dans les cellules, export PDF direct, impression d’un livret ou de quelques pages.',
      'Fractionner la fenêtre, côte à côte avec défilement synchrone, nouvelle fenêtre synchronisée ; rechercher et remplacer dans les notes.',
      'Formulaires à remplir, onglet Dessin, inspection et caviardage, sources BibTeX / RIS / CSL-JSON, styles Vancouver et Chicago (notes), ouverture des .odt et .rtf.',
      'Habillage des images : rapproché (le texte suit le contour), au travers, derrière ou devant le texte, disposition par défaut.',
      'Corrections : un long texte reste aligné sur ses pages, le curseur est là dès l’ouverture et après un en-tête, un clic hors du texte y place le curseur.',
      'Diagrammes (Insertion) : une liste devient processus, cycle, organigramme, pyramide ou diagramme radial, aux couleurs du thème.',
      'Icônes (Insertion) : 90 icônes libres intégrées, cherchables, de la couleur choisie, et plus de 5 000 en ligne.',
      'Mode Plan (Affichage) : titres repliables, niveaux affichés, monter ou descendre un titre avec toute sa partie.',
      'Comparer : avec un autre fichier ou une version enregistrée ; les différences s’ouvrent dans un nouvel onglet en modifications suivies.',
      'Révision : la mise en forme est suivie (caractères et paragraphes, gardée dans les .docx), marques simples, filtre des marques par type et par réviseur, volet Vérifications.',
      'Lecteur immersif (Affichage) : une colonne de texte, largeur, couleur de page, focus sur 1, 3 ou 5 lignes, espacement, lecture à voix haute surlignée.',
      'Insertion → Objet : le texte d’un autre fichier (.docx, .odt, .rtf, Markdown…) au curseur, ou un fichier joint, enregistré d’un double-clic.',
      'Image : reflet (rapproché, demi, complet) ; ombre, halo et reflet deviennent de vrais effets d’image dans les .docx.',
      'Mises à jour : recherche à chaque ouverture (désactivable) et bouton « Mettre à jour » dans la barre de titre ; le fichier est 90 Ko plus léger.',
    ],
    en: [
      'Check lists, callouts (Note, Tip, Warning…), reusable snippets (F3), glossary and list of abbreviations.',
      'Statistics and readability (click the word count), writing goal, typewriter scrolling, AutoSave.',
      'Bar, line and pie charts, from a table in one click; real charts in .docx files.',
      'Line numbers, right-to-left paragraphs, vertical text in table cells, direct PDF export, printing a booklet or a range of pages.',
      'Split the window, side by side with synchronous scrolling, a synced new window; find and replace in notes.',
      'Fillable forms, Draw tab, Inspect Document and redaction, BibTeX / RIS / CSL-JSON sources, Vancouver and Chicago notes styles, opening .odt and .rtf files.',
      'Picture wrapping: tight (text follows the outline), through, behind or in front of text, default layout.',
      'Fixes: a long text stays aligned with its pages, the cursor is there on opening and after a header, a click outside the text places the cursor.',
      'Diagrams (Insert): a list becomes a process, cycle, organisation chart, pyramid or radial diagram, in the theme colours.',
      'Icons (Insert): 90 free built-in icons, searchable, in any colour, and over 5,000 online.',
      'Outline view (View): foldable headings, Show Level, promote, demote and move a heading with its whole part.',
      'Compare: with another file or a saved version; the differences open in a new tab as tracked changes.',
      'Review: formatting changes are tracked (characters and paragraphs, kept in .docx), simple markup, markup filter by type and reviewer, Reviewing Pane.',
      'Immersive Reader (View): one column of text, width, page colour, 1, 3 or 5 line focus, text spacing, highlighted read aloud.',
      'Insert → Object: the text of another file (.docx, .odt, .rtf, Markdown…) at the cursor, or an attached file, saved with a double-click.',
      'Pictures: reflection (tight, half, full); shadow, glow and reflection become real picture effects in .docx files.',
      'Updates: a check each time the file opens (can be turned off) and an “Update” button in the title bar; the file is 90 KB lighter.',
    ],
  },
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
