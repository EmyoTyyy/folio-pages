// Document de démonstration, affiché quand le fichier ne contient pas encore
// de document (l'application vide telle qu'on la télécharge).
//
// Il est écrit dans la forme compacte du format et passe par le même
// chargeur qu'un document écrit par une IA : la démonstration sert aussi de
// test du format. Chaque section montre une fonction et dit comment s'en servir.
// Il grandit à chaque phase du projet (CLAUDE.md, 4.7). Une seule structure
// pour toutes les langues : seuls les textes changent.

import { loadDocument } from '../format/load'
import { parseInline } from '../format/markdown'
import type { FolioDoc } from '../format/types'
import type { Lang } from '../i18n/i18n'

const REPO = 'https://github.com/EmyoTyyy/folio-pages'

/** Illustration originale : une page au coin plié et son signet (dessinée pour le projet). */
const PAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160"><rect width="240" height="160" rx="14" fill="#e9f2ee"/><path d="M78 22h62l24 24v92a6 6 0 0 1-6 6H78a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6z" fill="#fffdf8" stroke="#1e6b55" stroke-width="3"/><path d="M140 22v18a6 6 0 0 0 6 6h18" fill="#cfe3da" stroke="#1e6b55" stroke-width="3"/><path d="M90 62h56M90 76h56M90 90h40M90 104h56M90 118h34" stroke="#9fb9ae" stroke-width="5" stroke-linecap="round"/><path d="M92 22h16v34l-8-7-8 7z" fill="#d95f45"/></svg>`
const PAGE_IMAGE = `data:image/svg+xml;base64,${btoa(PAGE_SVG)}`

const JSON_SAMPLE = (title: string, day: string, items: string[]) => `<script type="application/folio+json" id="folio-doc">
{
  "format": "folio/doc",
  "version": 1,
  "meta": { "title": "${title}" },
  "blocks": [
    { "type": "heading", "text": "${day}" },
    { "type": "list", "items": [${items.map((i) => `"${i}"`).join(', ')}] }
  ]
}
</script>`

const CODE = `def moyenne(notes):
    """Moyenne d'une liste de notes (0 si la liste est vide)."""
    return sum(notes) / len(notes) if notes else 0

print(moyenne([12, 15.5, 9]))  # 12.17`

const CODE_EN = `def average(marks):
    """Average of a list of marks (0 if the list is empty)."""
    return sum(marks) / len(marks) if marks else 0

print(average([12, 15.5, 9]))  # 12.17`

type Texts = Record<string, string | string[] | string[][]>

const FR: Texts = {
  title: 'Bienvenue dans Folio Pages',
  subtitle: 'Un traitement de texte libre dans un seul fichier',
  intro:
    'Ce fichier est **à la fois l’éditeur et le document**. Vous l’ouvrez dans un navigateur, vous écrivez, vous enregistrez : le fichier se réécrit avec votre texte. Aucune installation, aucun compte, aucun serveur, et tout fonctionne hors connexion.',
  writeTitle: 'Écrire et enregistrer',
  writeSteps: ['Cliquez n’importe où dans cette page et écrivez : ce document est le vôtre.', 'Appuyez sur **Ctrl+S** (⌘S sur Mac) pour enregistrer.', 'Rouvrez le fichier plus tard : votre texte est là.'],
  saving:
    'Sur Chrome et Edge, Folio Pages réécrit directement le fichier ouvert^[Grâce à l’interface *File System Access* du navigateur : une page ne peut réécrire que le fichier que vous lui avez confié.]. Le menu **Fichier** enregistre aussi une copie, un modèle ou une copie en lecture seule, et garde un **historique des versions** dans votre navigateur. Sur Firefox et Safari, il télécharge une copie à jour, qui remplace l’ancienne. Si le navigateur se ferme avant l’enregistrement, rouvrez le fichier : Folio Pages propose de *restaurer* vos modifications.',
  formatTitle: 'Mettre en forme',
  formatIntro:
    'Le ruban, en haut, rassemble toutes les commandes : onglet **Accueil** pour le texte et les paragraphes, **Insertion** pour les tableaux, images, liens et champs, **Création** pour le thème, **Affichage** pour le zoom.',
  runsLead: 'Le texte peut être ',
  runs: ['coloré', 'surligné', 'plus grand', 'en petites capitales', 'dans une autre police'],
  runsTail: 'Les exposants et les indices aussi : E = mc^2^, H~2~O, le 1^er^ janvier.',
  stylesLead:
    'Les **styles** donnent une allure cohérente : choisissez *Titre 1*, *Citation* ou *Légende* dans la galerie du ruban plutôt que de grossir le texte à la main. Modifier un style change tous les paragraphes qui l’utilisent ; le **thème** (onglet Création) change d’un coup les couleurs et les polices du document.',
  tip: 'Astuce : ce paragraphe utilise un style personnel, « Astuce », défini dans le document lui-même.',
  tipName: 'Astuce',
  markdown:
    'Le **Markdown à la frappe** marche aussi : tapez `# ` pour un titre, `- ` pour une liste, `**gras**`, `*italique*` ou `` `code` ``. Une barre oblique inverse avant le marqueur le garde tel quel.',
  effects:
    'Accueil → **Effets du texte** ajoute contour, ombre ou halo ; Insertion → **Lettrine** agrandit la première lettre d’un paragraphe ; Création → **Filigrane** écrit BROUILLON ou CONFIDENTIEL derrière chaque page. Ctrl+G (Atteindre) mène à une page, un titre ou une note.',
  autocorrect:
    'La **correction automatique** corrige pendant la frappe : « coeur » devient « cœur », (c) devient ©, les guillemets droits deviennent « » et une espace insécable se place avant ; : ! ?. Retour arrière juste après la défait ; **Révision → Orthographe → Correction automatique…** règle la liste.',
  listTitle: 'Listes et tableaux',
  listLead: 'Une liste peut avoir plusieurs niveaux (`Tab` et `Maj+Tab`) et une numérotation hiérarchique :',
  list: ['Préparer un voyage', 'Réserver le train', 'Imprimer les billets', 'Faire la valise', 'Vêtements pour trois jours'],
  checklist: ['Valise prête', 'Clés rendues au voisin'],
  table: [
    ['Pour…', 'Faites…'],
    ['Mettre en **gras**, en *italique*, ++souligner++', '`Ctrl+B`, `Ctrl+I`, `Ctrl+U`'],
    ['Centrer, justifier', '`Ctrl+Maj+E`, `Ctrl+Maj+J`'],
    ['Appliquer *Titre 1* à *Titre 3*', '`Ctrl+Alt+1` à `Ctrl+Alt+3`'],
    ['Rechercher, remplacer', '`Ctrl+F`, `Ctrl+H`'],
    ['Insérer un saut de page', '`Ctrl+Entrée`'],
    ['Toutes les touches et astuces', '`?` ou `F1`'],
  ],
  tableCaption: 'Les tableaux ont des styles rapides (ici « Zébré »), des cellules fusionnables et des colonnes à la largeur réglable.',
  chartTip: 'Dans un tableau de nombres, **Tableau → Graphique** dessine des barres, des courbes ou des secteurs. Double-cliquez sur le graphique ci-dessous pour changer son type ou ses données : il suit aussi les couleurs du thème.',
  chartTitle: 'Mots écrits cette semaine',
  diagramTip: 'Une liste peut devenir un **diagramme** : clic droit sur la liste → Convertir en diagramme, ou **Insertion → Diagramme**. Processus, cycle, hiérarchie, pyramide… double-cliquez pour changer.',
  diagramItems: ['Semer', 'Arroser', 'Récolter', 'Partager'],
  chartLabels: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'],
  chartSeries: ['Rapport', 'Lettres'],
  refsTitle: 'Sources, renvois et index',
  refsCite: [
    'Folio Pages met vos citations en forme : la sélection naturelle a été décrite au XIXe siècle ',
    ', la double hélice de l’ADN bien plus tard ',
    '. Changez de style dans **Références → Style** (APA, MLA, Chicago, IEEE…) : citations et bibliographie suivent. **Insérer une citation → Retrouver par DOI ou ISBN** remplit une source pour vous.',
  ],
  refsXref: [
    'Les légendes se numérotent toutes seules (**Références → Insérer une légende**). Les renvois restent justes quand le texte bouge : ',
    ' est en page ',
    ', ',
    '. Un mot marqué pour l’index (**Alt+Maj+X**) rejoint l’index en fin de document.',
  ],
  bibTitle: 'Références',
  indexTitle: 'Index',
  imageTitle: 'Images et code',
  imageAlt: 'Une page au coin plié, avec un signet corail',
  imageCaption: 'Une image intégrée au fichier, avec sa légende numérotée.',
  figureWord: 'Figure',
  tableWord: 'Tableau',
  imageText:
    'Collez une image, déposez-la dans la page ou passez par **Insertion → Image**. Elle voyage avec le document. Sélectionnez-la pour la redimensionner par ses poignées, la rogner à la souris (clic droit → **Rogner**), la faire pivoter ou faire couler le texte autour, comme ici. Les photos sont réduites à 2560 pixels ; les captures d’écran restent intactes.',
  codeLead: 'Un extrait de code garde ses espaces et se colore selon son langage :',
  layoutTitle: 'Mise en page',
  layoutLead:
    'Le document se répartit en vraies pages, comme il sera imprimé. L’onglet **Mise en page** règle le format du papier, l’orientation et les marges ; la **règle**, au-dessus de la page, déplace les retraits et les marges à la souris.',
  layoutCols: [
    'Ce passage est composé en deux colonnes, comme une lettre d’information : sélectionnez des paragraphes, puis **Mise en page → Colonnes**.',
    'L’en-tête et le pied de page de chaque feuille se modifient d’un **double-clic**. Le pied de page de ce document affiche « Page {{page}} sur {{pages}} » grâce à deux champs.',
    'Les **sauts de section** donnent à une partie sa propre numérotation (en chiffres romains pour une préface, par exemple) et ses propres en-têtes.',
  ],
  footer: 'Page {{page}} sur {{pages}}',
  tocTitle: 'Sommaire',
  notesTitle: 'Notes, sommaire et commentaires',
  notesText:
    'Une **note de bas de page** s’insère avec **Références → Insérer une note de bas de page** (`Ctrl+Alt+F`), et son numéro suit tout seul^[Comme celle-ci. Cliquez sur son texte, en bas de la page, pour la modifier ; cliquez sur son numéro pour revenir à l’appel.]. Les **notes de fin** se rangent après le texte, à la fin du document',
  endnote: 'Une note de fin : elle vient après le dernier paragraphe du document.',
  commentLead: 'Pour discuter d’un passage, sélectionnez-le puis **Révision → Nouveau commentaire** (`Ctrl+Alt+M`) : ',
  commentAnchor: 'le fil s’affiche dans le volet de droite',
  commentTail: ', où l’on répond, résout ou supprime. Les commentaires ne s’impriment jamais.',
  commentText: 'Un exemple de commentaire. Répondez-y, ou cliquez sur « Résoudre ».',
  tocText:
    'Le **sommaire**, en haut de ce document, suit les titres de lui-même et donne leur page : cliquez sur une ligne pour y aller. Le **volet de navigation** (onglet Références) affiche les titres à côté de la page.',
  mathTitle: 'Équations',
  mathLead:
    'Une formule en LaTeX entre deux `$` se met en forme d’elle-même : la gravitation, $F = G\\frac{m_1 m_2}{r^2}$, ou un capital placé à intérêts composés, $C_n = C_0(1+t)^n$. **Double-cliquez** sur une formule pour la modifier, avec un aperçu en direct ; **Insertion → Équation** (`Alt+=`) en crée une.',
  equation: '\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2} \\label{somme}',
  mathTail:
    'Une équation centrée peut être numérotée et citée : $\\eqref{somme}$ donne la somme des premiers entiers. La chimie s’écrit aussi, $\\ce{CO2 + H2O <=> H2CO3}$, et un prix comme 5 $ reste du texte.',
  aiTitle: 'Demander un document à une IA',
  aiLead: 'Folio Pages est pensé pour les IA : un guide écrit en tête du fichier leur explique comment le remplir, et ce qu’est un *bon* document.',
  aiSteps: [
    'Envoyez ce fichier à une IA avec votre demande, par exemple : « Fais-moi une fiche de révision sur la photosynthèse, avec un tableau des étapes. »',
    'Elle vous renvoie le fichier rempli : ouvrez-le, c’est prêt.',
    'Si la conversation n’accepte pas de fichier : onglet **IA → Copier le JSON compact**, puis **IA → Remplacer depuis le JSON…** pour coller sa réponse.',
    'Ou bien **IA → Demander à Claude** (ou **à ChatGPT**) : le site s’ouvre à côté du document, avec votre demande copiée ; **IA → Coller la réponse** la reprend, et Ctrl+Z l’annule.',
  ],
  docxTitle: 'Échanger des fichiers .docx',
  docx: 'Le menu **Fichier → Ouvrir…** importe un fichier `.docx`, et **Fichier → Exporter en .docx…** en écrit un. Tout se passe dans ce fichier, sans connexion. Styles, listes, tableaux, images, notes, commentaires et suivi des modifications font le voyage ; ce qui n’a pas d’équivalent est listé, et le texte n’est jamais perdu.',
  formats:
    '**Fichier → Exporter dans un autre format…** écrit aussi un `.odt` (LibreOffice), un livre numérique `.epub`, une page web, du Markdown ou du texte brut. Et **Fichier → Nouveau à partir d’un modèle…** propose lettre, CV, rapport, compte rendu, facture, mémoire, recette et fiche d’exercices.',
  readableTitle: 'Votre texte reste lisible',
  readable: 'Le document est rangé en tête du fichier, en JSON lisible, dans un bloc `folio-doc`. On peut le lire et le modifier avec n’importe quel éditeur de texte, même sans Folio Pages :',
  sample: ['Liste de courses', 'Samedi', 'Pain', 'Tomates', 'Café'],
  quote: '« Rien dans la vie n’est à craindre, tout est à comprendre. » — Marie Curie',
  nextTitle: 'Et ensuite',
  mergeTitle: 'Publipostage',
  mergeLead:
    'L’onglet **Publipostage** écrit la même lettre à toute une liste. Les champs entre chevrons ci-dessous viennent d’une petite liste rangée dans ce document : **Publipostage → Aperçu des résultats**, puis les flèches, montrent chaque destinataire.',
  mergeFields: ['Prénom', 'Ville', 'Panier'],
  mergeRecords: [
    ['Inès', 'Lille', 'légumes d’hiver'],
    ['Théo', 'Rennes', 'fruits rouges'],
    ['Mariam', 'Nîmes', 'herbes fraîches'],
  ],
  mergeParts: ['Bonjour ', ', votre panier de ', ' vous attend au marché de ', '.'],
  mergeTail:
    'Une liste s’importe depuis un tableur (CSV), un carnet d’adresses (vCard), ou se tape à la main. **Terminer et fusionner** ouvre les lettres dans un nouvel onglet ; enveloppes, étiquettes et messages électroniques se préparent de la même façon.',
  ownTitle: 'Votre fichier, vos règles',
  own: [
    '**Révision → Protéger** chiffre le document par un mot de passe (AES-256) : sans lui, le fichier ne montre rien, pas même son titre.',
    '**Aide → Mode hors ligne** coupe toute fonction réseau : liens du web, mises à jour, et les fonctions en ligne facultatives — **Dicter**, **Images en ligne**, **Rechercher** et **Synonymes**, **Polices en ligne**.',
    'À chaque ouverture, Folio Pages regarde si une version plus récente existe ; si oui, un bouton **Mettre à jour** apparaît en haut à droite. Il remplace l’application en gardant le document, et seulement si la nouvelle version est signée. **Aide → Rechercher à chaque ouverture** coupe cette recherche.',
    '**Aide → Langue** ajoute une langue à partir d’un paquet de traduction, qui peut voyager dans le fichier.',
    'Un fichier peut contenir plusieurs documents : le **+** en bas de la fenêtre en ajoute un (une annexe, un chapitre), chacun dans son onglet. Liens et renvois vont de l’un à l’autre ; l’export et l’impression proposent ce document ou tous.',
  ],
  nextLead: 'Les sept étapes prévues sont faites. La suite dépend aussi de vous :',
  next: ['Signalez un problème ou proposez une idée sur la page du projet.'],
  source: 'Code source, nouvelles versions et suggestions : ',
  fields: 'Ce paragraphe contient des champs, recalculés à l’affichage : « {{title}} », ouvert le {{date}}.',
  start: 'Pour commencer votre propre document, cliquez sur **Nouveau document vide**, en haut de la page.',
}

const EN: Texts = {
  title: 'Welcome to Folio Pages',
  subtitle: 'A free word processor in a single file',
  intro:
    'This file is **both the editor and the document**. Open it in a browser, write, save: the file rewrites itself with your text. No install, no account, no server, and everything works offline.',
  writeTitle: 'Write and save',
  writeSteps: ['Click anywhere on this page and type: this document is yours.', 'Press **Ctrl+S** (⌘S on a Mac) to save.', 'Open the file again later: your text is there.'],
  saving:
    'In Chrome and Edge, Folio Pages rewrites the open file directly^[Through the browser’s *File System Access* interface: a page can only rewrite the file you gave it.]. The **File** menu also saves a copy, a template or a read-only copy, and keeps a **version history** in your browser. In Firefox and Safari, it downloads an up-to-date copy that replaces the old one. If the browser closes before you save, open the file again: Folio Pages offers to *restore* your changes.',
  formatTitle: 'Formatting',
  formatIntro:
    'The ribbon at the top holds every command: the **Home** tab for text and paragraphs, **Insert** for tables, pictures, links and fields, **Design** for the theme, **View** for zoom.',
  runsLead: 'Text can be ',
  runs: ['coloured', 'highlighted', 'larger', 'in small capitals', 'in another font'],
  runsTail: 'Superscripts and subscripts too: E = mc^2^, H~2~O, the 1^st^ of January.',
  stylesLead:
    '**Styles** keep the look consistent: pick *Heading 1*, *Quote* or *Caption* in the ribbon gallery rather than enlarging text by hand. Changing a style changes every paragraph that uses it; the **theme** (Design tab) changes the document’s colours and fonts at once.',
  tip: 'Tip: this paragraph uses a custom style, “Tip”, defined in the document itself.',
  tipName: 'Tip',
  markdown:
    '**Markdown while typing** works too: type `# ` for a heading, `- ` for a list, `**bold**`, `*italic*` or `` `code` ``. A backslash before a marker keeps it as is.',
  effects:
    'Home → **Text Effects** adds an outline, a shadow or a glow; Insert → **Drop Cap** enlarges a paragraph’s first letter; Design → **Watermark** writes DRAFT or CONFIDENTIAL behind every page. Ctrl+G (Go To) jumps to a page, a heading or a note.',
  autocorrect:
    '**AutoCorrect** fixes as you type: “teh” becomes “the”, (c) becomes ©, straight quotes become curly ones. Backspace right after undoes it; **Review → Spelling → AutoCorrect Options…** edits the list.',
  listTitle: 'Lists and tables',
  listLead: 'A list can have several levels (`Tab` and `Shift+Tab`) and outline numbering:',
  list: ['Plan a trip', 'Book the train', 'Print the tickets', 'Pack the bag', 'Clothes for three days'],
  checklist: ['Bag packed', 'Keys left with the neighbour'],
  table: [
    ['To…', 'Do…'],
    ['Make text **bold**, *italic*, ++underlined++', '`Ctrl+B`, `Ctrl+I`, `Ctrl+U`'],
    ['Centre, justify', '`Ctrl+Shift+E`, `Ctrl+Shift+J`'],
    ['Apply *Heading 1* to *Heading 3*', '`Ctrl+Alt+1` to `Ctrl+Alt+3`'],
    ['Find, replace', '`Ctrl+F`, `Ctrl+H`'],
    ['Insert a page break', '`Ctrl+Enter`'],
    ['Every key and tip', '`?` or `F1`'],
  ],
  tableCaption: 'Tables have quick styles (here “Striped”), cells that can be merged and columns you can resize.',
  chartTip: 'In a table of numbers, **Table → Chart** draws bars, lines or a pie. Double-click the chart below to change its type or its data: it also follows the theme colours.',
  chartTitle: 'Words written this week',
  diagramTip: 'A list can become a **diagram**: right-click the list → Convert List to Diagram, or **Insert → Diagram**. Process, cycle, hierarchy, pyramid… double-click to change it.',
  diagramItems: ['Sow', 'Water', 'Harvest', 'Share'],
  chartLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  chartSeries: ['Report', 'Letters'],
  refsTitle: 'Sources, cross-references and index',
  refsCite: [
    'Folio Pages formats your citations: natural selection was described in the nineteenth century ',
    ', the DNA double helix much later ',
    '. Change the style in **References → Style** (APA, MLA, Chicago, IEEE…): citations and bibliography follow. **Insert citation → Find by DOI or ISBN** fills in a source for you.',
  ],
  refsXref: [
    'Captions number themselves (**References → Insert caption**). Cross-references stay right when the text moves: ',
    ' is on page ',
    ', ',
    '. A word marked for the index (**Alt+Shift+X**) joins the index at the end of the document.',
  ],
  bibTitle: 'References',
  indexTitle: 'Index',
  imageTitle: 'Pictures and code',
  imageAlt: 'A page with a folded corner and a coral bookmark',
  imageCaption: 'A picture embedded in the file, with its numbered caption.',
  figureWord: 'Figure',
  tableWord: 'Table',
  imageText:
    'Paste a picture, drop it on the page or use **Insert → Picture**. It travels with the document. Select it to resize it by its handles, crop it with the mouse (right-click → **Crop**), rotate it or let the text flow around it, as here. Photos are reduced to 2560 pixels; screenshots stay intact.',
  codeLead: 'A code block keeps its spaces and is coloured by language:',
  layoutTitle: 'Page layout',
  layoutLead:
    'The document is laid out in real pages, as it will print. The **Layout** tab sets paper size, orientation and margins; the **ruler** above the page moves indents and margins with the mouse.',
  layoutCols: [
    'This passage is set in two columns, like a newsletter: select some paragraphs, then **Layout → Columns**.',
    'Double-click the header or footer of any sheet to edit it. This document’s footer shows “Page {{page}} of {{pages}}” with two fields.',
    '**Section breaks** give a part its own numbering (Roman numerals for a preface, for example) and its own headers.',
  ],
  footer: 'Page {{page}} of {{pages}}',
  tocTitle: 'Contents',
  notesTitle: 'Notes, contents and comments',
  notesText:
    'Insert a **footnote** with **References → Insert footnote** (`Ctrl+Alt+F`): its number takes care of itself^[Like this one. Click its text, at the bottom of the page, to edit it; click its number to go back to the reference.]. **Endnotes** go after the text, at the end of the document',
  endnote: 'An endnote: it comes after the last paragraph of the document.',
  commentLead: 'To discuss a passage, select it, then **Review → New comment** (`Ctrl+Alt+M`): ',
  commentAnchor: 'the thread shows in the pane on the right',
  commentTail: ', where you reply, resolve or delete. Comments never print.',
  commentText: 'An example comment. Reply to it, or click “Resolve”.',
  tocText:
    'The **table of contents** at the top of this document follows the headings by itself and gives their page: click a line to go there. The **navigation pane** (References tab) shows the headings beside the page.',
  mathTitle: 'Equations',
  mathLead:
    'A LaTeX formula between two `$` signs typesets itself: gravitation, $F = G\\frac{m_1 m_2}{r^2}$, or savings with compound interest, $C_n = C_0(1+r)^n$. **Double-click** a formula to edit it, with a live preview; **Insert → Equation** (`Alt+=`) makes a new one.',
  equation: '\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2} \\label{sum}',
  mathTail:
    'A centred equation can be numbered and cited: $\\eqref{sum}$ gives the sum of the first whole numbers. Chemistry works too, $\\ce{CO2 + H2O <=> H2CO3}$, and a price such as $5 stays text.',
  aiTitle: 'Ask an AI for a document',
  aiLead: 'Folio Pages is made for AIs: a guide at the top of the file tells them how to fill it, and what makes a *good* document.',
  aiSteps: [
    'Send this file to an AI with your request, for example: “Make me a revision sheet on photosynthesis, with a table of the stages.”',
    'It sends the filled file back: open it, and it is ready.',
    'If the chat cannot take a file: the **AI** tab, **Copy compact JSON**, then **Replace from JSON…** to paste its answer.',
    'Or **AI → Ask Claude** (or **Ask ChatGPT**): the site opens next to the document, with your request copied; **AI → Paste the answer** brings it back, and Ctrl+Z undoes it.',
  ],
  docxTitle: 'Exchanging .docx files',
  docx: 'The menu **File → Open…** imports a `.docx` file, and **File → Export as .docx…** writes one. It all happens inside this file, offline. Styles, lists, tables, pictures, notes, comments and tracked changes make the trip; anything without an equivalent is listed, and the text is never lost.',
  formats:
    '**File → Export to Another Format…** also writes an `.odt` (LibreOffice), an `.epub` e-book, a web page, Markdown or plain text. And **File → New from Template…** offers a letter, résumé, report, meeting minutes, invoice, thesis, recipe and worksheet.',
  readableTitle: 'Your text stays readable',
  readable: 'The document sits at the top of the file as readable JSON, in a `folio-doc` block. Any text editor can read and change it, even without Folio Pages:',
  sample: ['Shopping list', 'Saturday', 'Bread', 'Tomatoes', 'Coffee'],
  quote: '“Nothing in life is to be feared, it is only to be understood.” — Marie Curie',
  nextTitle: 'What comes next',
  mergeTitle: 'Mail merge',
  mergeLead:
    'The **Mailings** tab writes the same letter to a whole list. The fields in chevrons below come from a small list kept in this document: **Mailings → Preview Results**, then the arrows, show each recipient.',
  mergeFields: ['First name', 'Town', 'Box'],
  mergeRecords: [
    ['Inès', 'Leeds', 'winter vegetables'],
    ['Theo', 'Bath', 'red berries'],
    ['Mariam', 'York', 'fresh herbs'],
  ],
  mergeParts: ['Hello ', ', your box of ', ' is waiting at the market in ', '.'],
  mergeTail:
    'A list is imported from a spreadsheet (CSV), an address book (vCard), or typed in. **Finish & Merge** opens the letters in a new tab; envelopes, labels and e-mails are prepared the same way.',
  ownTitle: 'Your file, your rules',
  own: [
    '**Review → Protect** encrypts the document with a password (AES-256): without it, the file shows nothing, not even its title.',
    '**Help → Offline mode** turns off every network feature: web links, updates, and the optional online features — **Dictate**, **Online Pictures**, **Search** and **Thesaurus**, **Online fonts**.',
    'Each time it opens, Folio Pages looks for a newer version; if there is one, an **Update** button appears at the top right. It replaces the application and keeps the document, only if the new version is signed. **Help → Check each time the file opens** turns this off.',
    '**Help → Language** adds a language from a translation pack, which can travel inside the file.',
    'One file can hold several documents: the **+** at the bottom of the window adds one (an annex, a chapter), each in its own tab. Links and cross-references go from one to another; exporting and printing offer this document or all of them.',
  ],
  nextLead: 'The seven planned stages are done. What comes next is up to you too:',
  next: ['Report a problem or suggest an idea on the project page.'],
  source: 'Source code, new versions and suggestions: ',
  fields: 'This paragraph holds fields, computed when shown: “{{title}}”, opened on {{date}}.',
  start: 'To start your own document, click **New blank document** at the top of the page.',
}

function build(T: Texts, lang: Lang): unknown {
  const s = (k: string) => T[k] as string
  const a = (k: string) => T[k] as string[]
  const runs = a('runs')
  const sample = a('sample')
  const list = a('list')
  return {
    format: 'folio/doc',
    version: 1,
    meta: { title: s('title'), lang },
    headers: { default: [{ md: '{{title}}', align: 'right' }] },
    footers: { default: [{ md: s('footer'), align: 'center' }] },
    styles: { tip: { name: s('tipName'), basedOn: 'normal', italic: true, color: 'accent1', shading: '#eef5f1', spacing: { before: 4, after: 10 } } },
    blocks: [
      { type: 'paragraph', style: 'title', text: s('title') },
      { type: 'paragraph', style: 'subtitle', text: s('subtitle') },
      { md: s('intro') },
      { type: 'toc', levels: 2, title: s('tocTitle') },
      { type: 'heading', level: 2, text: s('writeTitle') },
      { type: 'list', style: 'number', items: a('writeSteps').map((md) => ({ md })) },
      { md: s('saving') },
      { type: 'heading', level: 2, text: s('formatTitle') },
      { md: s('formatIntro') },
      {
        content: [
          s('runsLead'),
          { text: runs[0], color: 'accent2', bold: true },
          ', ',
          { text: runs[1], highlight: 'yellow' },
          ', ',
          { text: runs[2], size: 14 },
          ', ',
          { text: runs[3], smallcaps: true },
          lang === 'fr' ? ' ou ' : ' or ',
          { text: runs[4], font: 'Newsreader', italic: true },
          '.',
        ],
      },
      { md: s('runsTail') },
      { md: s('stylesLead') },
      { type: 'paragraph', style: 'tip', text: s('tip') },
      { md: s('markdown') },
      { md: s('autocorrect') },
      { md: s('effects') },
      { type: 'heading', level: 2, text: s('listTitle') },
      { md: s('listLead') },
      {
        type: 'list',
        style: 'number',
        numbering: 'outline',
        items: [list[0], { text: list[1], level: 1 }, { text: list[2], level: 1 }, list[3], { text: list[4], level: 1 }],
      },
      { type: 'list', style: 'check', items: [{ text: a('checklist')[0], checked: true }, a('checklist')[1]] },
      {
        type: 'table',
        style: 'zebra',
        widths: [270, 200],
        rows: (T.table as string[][]).map((row) => row.map((md) => ({ md }))),
      },
      { type: 'paragraph', style: 'caption', content: [{ type: 'bookmark', name: 'demo_table' }, `${s('tableWord')} `, { type: 'seq', label: 'table' }, `. ${s('tableCaption')}`] },
      { type: 'callout', kind: 'tip', md: s('chartTip') },
      { type: 'chart', kind: 'bar', title: s('chartTitle'), labels: a('chartLabels'), series: [{ name: a('chartSeries')[0], values: [820, 1150, 640, 1310, 990] }, { name: a('chartSeries')[1], values: [240, 180, 410, 120, 300] }] },
      { type: 'callout', kind: 'tip', md: s('diagramTip') },
      { type: 'diagram', kind: 'cycle', items: a('diagramItems') },
      { type: 'heading', level: 2, text: s('imageTitle') },
      { type: 'image', src: 'asset:page', alt: s('imageAlt'), caption: [{ type: 'bookmark', name: 'demo_figure' }, `${s('figureWord')} `, { type: 'seq', label: 'figure' }, `. ${s('imageCaption')}`], width: 170, align: 'right', wrap: 'right' },
      { md: s('imageText') },
      { md: s('codeLead') },
      { type: 'code', language: 'python', text: lang === 'fr' ? CODE : CODE_EN },
      { type: 'heading', level: 2, text: s('layoutTitle') },
      { md: s('layoutLead') },
      { type: 'columns', count: 2, rule: true, blocks: a('layoutCols').map((md) => ({ md })) },
      { type: 'heading', level: 2, text: s('notesTitle') },
      { content: [...parseInline(s('notesText')), { type: 'note', kind: 'end', text: s('endnote') }, '.'] },
      { md: s('tocText') },
      { content: [...parseInline(s('commentLead')), { text: s('commentAnchor'), comments: ['demo'] }, ...parseInline(s('commentTail'))] },
      { type: 'heading', level: 2, text: s('mathTitle') },
      { md: s('mathLead') },
      { type: 'equation', tex: s('equation'), numbered: true },
      { md: s('mathTail') },
      { type: 'heading', level: 2, text: s('refsTitle') },
      {
        content: [
          a('refsCite')[0],
          { type: 'cite', id: 'Darwin1859', locator: lang === 'fr' ? 'p. 61' : 'p. 61' },
          { type: 'xe', term: lang === 'fr' ? 'sélection naturelle' : 'natural selection' },
          a('refsCite')[1],
          { type: 'cite', id: 'Watson1953' },
          { type: 'xe', term: lang === 'fr' ? 'ADN' : 'DNA' },
          ...parseInline(a('refsCite')[2]),
        ],
      },
      {
        content: [
          ...parseInline(a('refsXref')[0]),
          { type: 'xref', target: 'demo_figure', show: 'label' },
          a('refsXref')[1],
          { type: 'xref', target: 'demo_figure', show: 'page' },
          a('refsXref')[2],
          { type: 'xref', target: 'demo_table', show: 'label' },
          ' ',
          { type: 'xref', target: 'demo_table', show: 'above' },
          ...parseInline(a('refsXref')[3]),
        ],
      },
      { type: 'bibliography', title: s('bibTitle') },
      { type: 'heading', level: 2, text: s('mergeTitle') },
      { md: s('mergeLead') },
      {
        content: [
          a('mergeParts')[0],
          { type: 'mergefield', name: a('mergeFields')[0], bold: true },
          a('mergeParts')[1],
          { type: 'mergefield', name: a('mergeFields')[2] },
          a('mergeParts')[2],
          { type: 'mergefield', name: a('mergeFields')[1] },
          a('mergeParts')[3],
        ],
      },
      { md: s('mergeTail') },
      { type: 'heading', level: 2, text: s('ownTitle') },
      { type: 'list', items: a('own').map((md) => ({ md })) },
      { type: 'heading', level: 2, text: s('aiTitle') },
      { md: s('aiLead') },
      { type: 'list', items: a('aiSteps').map((md) => ({ md })) },
      { type: 'heading', level: 2, text: s('docxTitle') },
      { md: s('docx') },
      { md: s('formats') },
      { type: 'heading', level: 2, text: s('readableTitle') },
      { md: s('readable') },
      { type: 'code', language: 'html', text: JSON_SAMPLE(sample[0], sample[1], sample.slice(2)) },
      { type: 'quote', md: s('quote') },
      { md: s('fields'), align: 'center' },
      { type: 'heading', level: 2, text: s('nextTitle') },
      { text: s('nextLead') },
      { type: 'list', items: a('next') },
      { type: 'divider' },
      { content: [s('source'), { text: 'github.com/EmyoTyyy/folio-pages', link: REPO }, '.'] },
      { md: s('start') },
      { type: 'index', columns: 2, title: s('indexTitle') },
    ],
    comments: [{ id: 'demo', author: 'Folio Pages', text: s('commentText') }],
    sources: [
      { id: 'Darwin1859', type: 'book', authors: ['Darwin, Charles'], title: 'On the Origin of Species', publisher: 'John Murray', place: 'London', year: '1859' },
      { id: 'Watson1953', type: 'article', authors: ['Watson, James D.', 'Crick, Francis H. C.'], title: 'Molecular structure of nucleic acids', container: 'Nature', volume: '171', issue: '4356', pages: '737-738', year: '1953', doi: '10.1038/171737a0' },
    ],
    mailMerge: { type: 'letters', source: { name: s('mergeTitle'), fields: a('mergeFields'), records: T.mergeRecords as string[][] }, map: { first: a('mergeFields')[0], city: a('mergeFields')[1] } },
    assets: { page: PAGE_IMAGE },
  }
}

export const DEMO_SOURCES: Record<Lang, unknown> = { fr: build(FR, 'fr'), en: build(EN, 'en') }

/** Le document de démonstration dans la langue demandée. */
export function demoDocument(lang: Lang, now?: string): FolioDoc {
  const r = loadDocument(DEMO_SOURCES[lang], { now })
  if (!r.ok) throw new Error('document de démonstration invalide')
  return r.doc
}
