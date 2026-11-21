// Dictionnaire de la compatibilité .docx (phase 5) : import, export, et ce
// qui n'a pas pu être repris. Fait partie du dictionnaire unique (dict.ts le
// réunit au reste).

type Entry = string | { one: string; other: string }
type Row = { fr: Entry; en: Entry }

export const DOCX_DICT = {
  'docx.export.menu': { fr: 'Exporter en .docx…', en: 'Export as .docx…' },
  'docx.export.type': { fr: 'Document .docx', en: '.docx document' },
  'docx.export.preparing': { fr: 'Préparation du fichier .docx…', en: 'Preparing the .docx file…' },
  'docx.export.done': { fr: 'Exporté : {name}', en: 'Exported: {name}' },
  'docx.export.downloaded': { fr: 'Export téléchargé : {name}', en: 'Export downloaded: {name}' },
  'docx.export.withLosses': {
    fr: { one: 'Exporté : {name}. {n} point ne passe pas tel quel en .docx.', other: 'Exporté : {name}. {n} points ne passent pas tels quels en .docx.' },
    en: { one: 'Exported: {name}. {n} thing does not carry over to .docx as is.', other: 'Exported: {name}. {n} things do not carry over to .docx as is.' },
  },
  'docx.export.failed': { fr: 'L’export en .docx a échoué : {message}', en: 'The .docx export failed: {message}' },
  'docx.export.module': {
    fr: 'Le module .docx de ce fichier est illisible. Téléchargez une copie neuve de Folio Pages.',
    en: 'The .docx module of this file cannot be read. Download a fresh copy of Folio Pages.',
  },
  'docx.losses.title': { fr: 'Différences à l’export .docx', en: 'Differences in the .docx export' },
  'docx.losses.intro': {
    fr: 'Le texte est entier dans le fichier exporté. Voici ce qui n’y est pas tel que dans le document :',
    en: 'All the text is in the exported file. Here is what is not there as in the document:',
  },
  'docx.out.image-remote': {
    fr: { one: '{n} image du web n’est pas dans le fichier : son texte de remplacement tient sa place.', other: '{n} images du web ne sont pas dans le fichier : leur texte de remplacement tient leur place.' },
    en: { one: '{n} web image is not in the file: its alt text stands in for it.', other: '{n} web images are not in the file: their alt text stands in for them.' },
  },
  'docx.out.image-format': {
    fr: { one: '{n} image n’a pas pu être convertie pour .docx : son texte de remplacement tient sa place.', other: '{n} images n’ont pas pu être converties pour .docx : leur texte de remplacement tient leur place.' },
    en: { one: '{n} image could not be converted for .docx: its alt text stands in for it.', other: '{n} images could not be converted for .docx: their alt text stands in for them.' },
  },
  'docx.out.image-missing': {
    fr: { one: '{n} image est introuvable dans le document.', other: '{n} images sont introuvables dans le document.' },
    en: { one: '{n} image is missing from the document.', other: '{n} images are missing from the document.' },
  },
  'docx.out.code-colors': {
    fr: { one: 'La coloration de {n} extrait de code n’est pas exportée (le code y est, en une couleur).', other: 'La coloration de {n} extraits de code n’est pas exportée (le code y est, en une couleur).' },
    en: { one: 'The colouring of {n} code listing is not exported (the code is there, in one colour).', other: 'The colouring of {n} code listings is not exported (the code is there, in one colour).' },
  },
  'docx.out.link-internal': {
    fr: { one: '{n} lien interne au document est écrit comme du texte.', other: '{n} liens internes au document sont écrits comme du texte.' },
    en: { one: '{n} link inside the document is written as plain text.', other: '{n} links inside the document are written as plain text.' },
  },
  'docx.out.font-embedded': {
    fr: 'Les polices ajoutées au document ne sont pas intégrées au fichier .docx : il faut les avoir sur l’ordinateur qui l’ouvre.',
    en: 'Fonts added to the document are not embedded in the .docx file: the computer that opens it needs to have them.',
  },
  'docx.out.comment-orphan': {
    fr: { one: '{n} commentaire dont le texte a été supprimé est rattaché au début du document.', other: '{n} commentaires dont le texte a été supprimé sont rattachés au début du document.' },
    en: { one: '{n} comment whose text was deleted is attached to the start of the document.', other: '{n} comments whose text was deleted are attached to the start of the document.' },
  },
  'docx.out.quote-content': {
    fr: { one: 'Dans {n} citation, ce qui n’est pas un simple paragraphe (titre, liste, tableau…) sort de la citation.', other: 'Dans {n} citations, ce qui n’est pas un simple paragraphe (titre, liste, tableau…) sort de la citation.' },
    en: { one: 'In {n} quote, anything that is not a plain paragraph (heading, list, table…) leaves the quote.', other: 'In {n} quotes, anything that is not a plain paragraph (heading, list, table…) leaves the quote.' },
  },
  'docx.out.chart-hf': {
    fr: { one: '{n} graphique d’en-tête ou de pied de page n’est pas exporté.', other: '{n} graphiques d’en-tête ou de pied de page ne sont pas exportés.' },
    en: { one: '{n} chart in a header or footer is not exported.', other: '{n} charts in headers or footers are not exported.' },
  },
  'docx.out.attachment': {
    fr: { one: '{n} fichier joint n’est pas dans le .docx : seul son nom reste.', other: '{n} fichiers joints ne sont pas dans le .docx : seuls leurs noms restent.' },
    en: { one: '{n} attached file is not in the .docx: only its name remains.', other: '{n} attached files are not in the .docx: only their names remain.' },
  },
  'docx.out.ink': {
    fr: { one: '{n} dessin à main levée n’a pas pu être converti en image.', other: '{n} dessins à main levée n’ont pas pu être convertis en image.' },
    en: { one: '{n} ink drawing could not be turned into a picture.', other: '{n} ink drawings could not be turned into pictures.' },
  },
  'docx.out.picture-effects': {
    fr: { one: '{n} image n’a pas pu garder ses retouches de couleur ni ses bords adoucis.', other: '{n} images n’ont pas pu garder leurs retouches de couleur ni leurs bords adoucis.' },
    en: { one: '{n} picture could not keep its colour corrections or soft edges.', other: '{n} pictures could not keep their colour corrections or soft edges.' },
  },
  'docx.out.equation-error': {
    fr: { one: '{n} formule illisible est écrite telle quelle, en LaTeX, dans son équation.', other: '{n} formules illisibles sont écrites telles quelles, en LaTeX, dans leur équation.' },
    en: { one: '{n} unreadable formula is written as is, in LaTeX, inside its equation.', other: '{n} unreadable formulas are written as is, in LaTeX, inside their equation.' },
  },
  'docx.out.columns-nested': {
    fr: { one: '{n} passage en colonnes placé dans une citation est écrit sur une seule colonne.', other: '{n} passages en colonnes placés dans une citation sont écrits sur une seule colonne.' },
    en: { one: '{n} column layout placed inside a quote is written as a single column.', other: '{n} column layouts placed inside a quote are written as a single column.' },
  },
  'docx.in.equation': {
    fr: { one: '{n} équation n’a pas pu être lue : son texte est gardé, en italique.', other: '{n} équations n’ont pas pu être lues : leur texte est gardé, en italique.' },
    en: { one: '{n} equation could not be read: its text is kept, in italics.', other: '{n} equations could not be read: their text is kept, in italics.' },
  },
  'docx.in.merge-source': {
    fr: { one: 'Document de publipostage : sa liste de destinataires est un fichier à part, à sélectionner de nouveau (Publipostage → Sélectionner les destinataires).', other: 'Documents de publipostage : leur liste de destinataires est un fichier à part, à sélectionner de nouveau.' },
    en: { one: 'Mail merge document: its recipient list is a separate file, to select again (Mailings → Select Recipients).', other: 'Mail merge documents: their recipient list is a separate file, to select again.' },
  },
  'docx.in.changes': {
    fr: { one: 'Les modifications suivies ont été acceptées à l’ouverture (le texte actuel est gardé).', other: 'Les modifications suivies ont été acceptées à l’ouverture (le texte actuel est gardé).' },
    en: { one: 'Tracked changes were accepted on opening (the current text is kept).', other: 'Tracked changes were accepted on opening (the current text is kept).' },
  },
  'docx.in.image': {
    fr: { one: '{n} image n’a pas pu être reprise (format non pris en charge ou absente du fichier).', other: '{n} images n’ont pas pu être reprises (format non pris en charge ou absentes du fichier).' },
    en: { one: '{n} picture could not be kept (unsupported format or missing from the file).', other: '{n} pictures could not be kept (unsupported format or missing from the file).' },
  },
  'docx.in.other': {
    fr: { one: '{n} élément inconnu : seul son texte est gardé.', other: '{n} éléments inconnus : seul leur texte est gardé.' },
    en: { one: '{n} unknown element: only its text is kept.', other: '{n} unknown elements: only their text is kept.' },
  },
  'docx.in.drawing': {
    fr: { one: '{n} dessin ou forme n’est pas importé.', other: '{n} dessins ou formes ne sont pas importés.' },
    en: { one: '{n} drawing or shape is not imported.', other: '{n} drawings or shapes are not imported.' },
  },
  'docx.in.textbox': {
    fr: { one: '{n} zone de texte : son texte est placé à la suite du paragraphe.', other: '{n} zones de texte : leur texte est placé à la suite du paragraphe.' },
    en: { one: '{n} text box: its text is placed after the paragraph.', other: '{n} text boxes: their text is placed after the paragraph.' },
  },
  'docx.in.chart': {
    fr: { one: '{n} graphique n’est pas importé.', other: '{n} graphiques ne sont pas importés.' },
    en: { one: '{n} chart is not imported.', other: '{n} charts are not imported.' },
  },
  'docx.in.chart-type': {
    fr: { one: '{n} graphique d’un type que Folio Pages ne dessine pas (aires, nuage de points, radar…) devient un graphique en courbes ou en barres.', other: '{n} graphiques d’un type que Folio Pages ne dessine pas (aires, nuage de points, radar…) deviennent des graphiques en courbes ou en barres.' },
    en: { one: '{n} chart of a type Folio Pages does not draw (area, scatter, radar…) becomes a line or bar chart.', other: '{n} charts of a type Folio Pages does not draw (area, scatter, radar…) become line or bar charts.' },
  },
  'docx.in.object': {
    fr: { one: '{n} objet incorporé (feuille de calcul, etc.) : seul son aperçu, s’il existe, est gardé.', other: '{n} objets incorporés (feuilles de calcul, etc.) : seul leur aperçu, s’il existe, est gardé.' },
    en: { one: '{n} embedded object (spreadsheet, etc.): only its preview, if any, is kept.', other: '{n} embedded objects (spreadsheets, etc.): only their preview, if any, is kept.' },
  },
  'docx.in.image-format': {
    fr: { one: '{n} image d’un format que les navigateurs n’affichent pas (EMF, WMF, TIFF…) n’est pas importée.', other: '{n} images d’un format que les navigateurs n’affichent pas (EMF, WMF, TIFF…) ne sont pas importées.' },
    en: { one: '{n} image in a format browsers cannot show (EMF, WMF, TIFF…) is not imported.', other: '{n} images in a format browsers cannot show (EMF, WMF, TIFF…) are not imported.' },
  },
  'docx.in.image-large': {
    fr: { one: '{n} image trop lourde n’est pas importée.', other: '{n} images trop lourdes ne sont pas importées.' },
    en: { one: '{n} image is too large and is not imported.', other: '{n} images are too large and are not imported.' },
  },
  'docx.in.image-missing': {
    fr: { one: '{n} image est absente du fichier (image liée, non intégrée).', other: '{n} images sont absentes du fichier (images liées, non intégrées).' },
    en: { one: '{n} image is not in the file (linked, not embedded).', other: '{n} images are not in the file (linked, not embedded).' },
  },
  'docx.in.field': {
    fr: { one: '{n} champ calculé est gardé avec sa dernière valeur, comme du texte.', other: '{n} champs calculés sont gardés avec leur dernière valeur, comme du texte.' },
    en: { one: '{n} computed field is kept with its last value, as text.', other: '{n} computed fields are kept with their last value, as text.' },
  },
  'docx.in.section-layout': {
    fr: 'Des sections ont un format de page différent : la mise en page de la première vaut pour tout le document.',
    en: 'Some sections have a different page layout: the layout of the first one applies to the whole document.',
  },
  'docx.in.symbol': {
    fr: { one: '{n} caractère d’une police de symboles n’est pas repris.', other: '{n} caractères d’une police de symboles ne sont pas repris.' },
    en: { one: '{n} character from a symbol font is not carried over.', other: '{n} characters from a symbol font are not carried over.' },
  },
  'docx.in.hidden-text': {
    fr: { one: '{n} passage de texte masqué n’est pas importé.', other: '{n} passages de texte masqué ne sont pas importés.' },
    en: { one: '{n} run of hidden text is not imported.', other: '{n} runs of hidden text are not imported.' },
  },
  'docx.in.heading-number': {
    fr: { one: 'Le numéro automatique de {n} titre n’est pas repris.', other: 'Les numéros automatiques de {n} titres ne sont pas repris.' },
    en: { one: 'The automatic number of {n} heading is not carried over.', other: 'The automatic numbers of {n} headings are not carried over.' },
  },
  'docx.in.embedded-document': {
    fr: { one: '{n} document incorporé n’est pas importé.', other: '{n} documents incorporés ne sont pas importés.' },
    en: { one: '{n} embedded document is not imported.', other: '{n} embedded documents are not imported.' },
  },
  'docx.in.nested-table': {
    fr: { one: '{n} tableau placé dans une cellule : son contenu est gardé, à la suite dans la cellule.', other: '{n} tableaux placés dans une cellule : leur contenu est gardé, à la suite dans la cellule.' },
    en: { one: '{n} table placed inside a cell: its content is kept, one item after another in the cell.', other: '{n} tables placed inside a cell: their content is kept, one item after another in the cell.' },
  },
  'open.docx.old-format': {
    fr: '« {name} » est un ancien fichier .doc, ou un fichier protégé par mot de passe. Enregistrez-le en .docx sans mot de passe pour l’ouvrir ici.',
    en: '“{name}” is an old .doc file, or a password-protected file. Save it as .docx without a password to open it here.',
  },
  'open.docx.not-zip': { fr: '« {name} » n’est pas un fichier .docx lisible.', en: '“{name}” is not a readable .docx file.' },
  'open.docx.not-docx': { fr: '« {name} » n’est pas un document .docx (c’est une autre sorte d’archive).', en: '“{name}” is not a .docx document (it is another kind of archive).' },
  'open.docx.damaged': { fr: '« {name} » est abîmé : il n’a pas pu être lu.', en: '“{name}” is damaged: it could not be read.' },
  'open.docx.too-large': { fr: '« {name} » est trop gros pour être importé.', en: '“{name}” is too large to import.' },
  'open.docx.module': {
    fr: 'Le module .docx de ce fichier est illisible. Téléchargez une copie neuve de Folio Pages.',
    en: 'The .docx module of this file cannot be read. Download a fresh copy of Folio Pages.',
  },
  'issue.import-loss': { fr: '{detail}', en: '{detail}' },
} satisfies Record<string, Row>
