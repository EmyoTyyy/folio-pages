// Dictionnaire des fonctions en ligne : demander à une IA, dicter, images en
// ligne, rechercher et synonymes, polices en ligne. Fait partie du dictionnaire
// unique (dict.ts le réunit au reste).

type Entry = string | { one: string; other: string }
type Row = { fr: Entry; en: Entry }

export const ONLINE_DICT = {
  'online.failed': { fr: 'Échec de la connexion. Vérifiez le réseau et réessayez.', en: 'Connection failed. Check the network and try again.' },
  'online.searching': { fr: 'Recherche…', en: 'Searching…' },
  'online.downloading': { fr: 'Téléchargement…', en: 'Downloading…' },
  'online.group': { fr: 'En ligne', en: 'Online' },

  // --- demander à une IA
  'aiw.group': { fr: 'Assistant', en: 'Assistant' },
  'aiw.askClaude': { fr: 'Demander à Claude', en: 'Ask Claude' },
  'aiw.askChatGPT': { fr: 'Demander à ChatGPT', en: 'Ask ChatGPT' },
  'aiw.paste': { fr: 'Coller la réponse', en: 'Paste the answer' },
  'aiw.title': { fr: 'Demander à une IA', en: 'Ask an AI' },
  'aiw.intro': {
    fr: 'Le site s’ouvre dans une fenêtre à côté du document, avec votre demande et le contenu copiés. Vous utilisez votre compte habituel : aucune clé, rien de plus à payer.',
    en: 'The site opens in a window next to the document, with your request and the content copied. You use your usual account: no key, nothing more to pay.',
  },
  'aiw.site': { fr: 'Assistant', en: 'Assistant' },
  'aiw.scope': { fr: 'Envoyer', en: 'Send' },
  'aiw.scopeDoc': { fr: 'Tout le document', en: 'The whole document' },
  'aiw.scopeSelection': { fr: 'La sélection seulement', en: 'The selection only' },
  'aiw.request': { fr: 'Votre demande', en: 'Your request' },
  'aiw.placeholder': { fr: 'Par exemple : « Ajoute une conclusion de deux paragraphes et corrige les fautes. »', en: 'For example: “Add a two-paragraph conclusion and fix the typos.”' },
  'aiw.privacy': {
    fr: 'Ce qui est envoyé quitte votre ordinateur : le site de l’IA le reçoit quand vous validez la demande. Les images ne sont pas envoyées.',
    en: 'What you send leaves your computer: the AI site receives it when you submit the request. Pictures are not sent.',
  },
  'aiw.go': { fr: 'Copier et ouvrir', en: 'Copy and open' },
  'aiw.empty': { fr: 'Écrivez votre demande.', en: 'Write your request.' },
  'aiw.openedPrefilled': { fr: '{site} s’ouvre avec votre demande. Copiez sa réponse, puis revenez ici.', en: '{site} opens with your request. Copy its answer, then come back here.' },
  'aiw.openedCopied': {
    fr: 'Demande copiée : collez-la dans {site} (Ctrl+V). Copiez ensuite sa réponse et revenez ici.',
    en: 'Request copied: paste it into {site} (Ctrl+V). Then copy its answer and come back here.',
  },
  'aiw.openedNoCopy': { fr: '{site} s’ouvre. La copie a été refusée : utilisez « Copier le JSON compact ».', en: '{site} opens. Copying was refused: use “Copy compact JSON”.' },
  'aiw.back': { fr: 'De retour de {site} ? Collez sa réponse.', en: 'Back from {site}? Paste its answer.' },
  'aiw.pasteNow': { fr: 'Coller la réponse', en: 'Paste the answer' },
  'aiw.answerTitle': { fr: 'Coller la réponse de l’IA', en: 'Paste the AI’s answer' },
  'aiw.answerIntro': {
    fr: 'Collez toute la réponse : Folio Pages y trouve le document (JSON) ou le passage (Markdown). Ctrl+Z annule.',
    en: 'Paste the whole answer: Folio Pages finds the document (JSON) or the passage (Markdown) in it. Ctrl+Z undoes.',
  },
  'aiw.answerPlaceholder': { fr: 'Collez ici la réponse (Ctrl+V)', en: 'Paste the answer here (Ctrl+V)' },
  'aiw.fromClipboard': { fr: 'Coller depuis le presse-papiers', en: 'Paste from clipboard' },
  'aiw.clipboardDenied': { fr: 'Accès au presse-papiers refusé : collez avec Ctrl+V dans la zone.', en: 'Clipboard access refused: paste with Ctrl+V in the box.' },
  'aiw.willReplaceDoc': { fr: 'Un document : il remplacera le document actuel (annulable).', en: 'A document: it will replace the current document (undoable).' },
  'aiw.willReplaceSelection': { fr: 'Un passage : il remplacera la sélection envoyée.', en: 'A passage: it will replace the selection you sent.' },
  'aiw.willInsert': { fr: 'Un passage : il sera inséré au curseur.', en: 'A passage: it will be inserted at the cursor.' },
  'aiw.apply': { fr: 'Appliquer', en: 'Apply' },
  'aiw.answerEmpty': { fr: 'Collez d’abord la réponse.', en: 'Paste the answer first.' },
  'aiw.answerBad': { fr: 'Le document de la réponse est illisible : demandez à l’IA de renvoyer le JSON complet.', en: 'The answer’s document can’t be read: ask the AI to send the complete JSON again.' },
  'aiw.applied': { fr: 'Réponse appliquée (Ctrl+Z pour annuler).', en: 'Answer applied (Ctrl+Z to undo).' },

  // --- dicter
  'dict.dictate': { fr: 'Dicter', en: 'Dictate' },
  'dict.group': { fr: 'Voix', en: 'Voice' },
  'dict.listening': { fr: 'Je vous écoute…', en: 'Listening…' },
  'dict.stop': { fr: 'Arrêter', en: 'Stop' },
  'dict.language': { fr: 'Langue de dictée', en: 'Dictation language' },
  'dict.unsupported': {
    fr: 'Ce navigateur ne propose pas la reconnaissance vocale (Firefox) : utilisez Chrome, Edge ou Safari.',
    en: 'This browser has no speech recognition (Firefox): use Chrome, Edge or Safari.',
  },
  'dict.denied': { fr: 'Micro refusé : autorisez-le dans les réglages du navigateur.', en: 'Microphone refused: allow it in the browser settings.' },
  'dict.error': { fr: 'La dictée s’est arrêtée (réseau ou micro).', en: 'Dictation stopped (network or microphone).' },
  'dict.hint': {
    fr: 'Le son est envoyé au service de reconnaissance du navigateur. Dites « virgule », « point », « à la ligne »…',
    en: 'Audio goes to the browser’s speech service. Say “comma”, “period”, “new line”…',
  },

  // --- images en ligne
  'pic.online': { fr: 'Images en ligne…', en: 'Online Pictures…' },
  'pic.title': { fr: 'Images en ligne', en: 'Online pictures' },
  'pic.placeholder': { fr: 'Chercher des images libres (phare, chat, Paris…)', en: 'Search free pictures (lighthouse, cat, Paris…)' },
  'pic.search': { fr: 'Rechercher', en: 'Search' },
  'pic.results': { fr: 'Résultats', en: 'Results' },
  'pic.hint': { fr: 'Images libres de Wikimedia Commons. Seuls les mots cherchés sont envoyés.', en: 'Free pictures from Wikimedia Commons. Only the search words are sent.' },
  'pic.count': { fr: { one: '{n} résultat', other: '{n} résultats' }, en: { one: '{n} result', other: '{n} results' } },
  'pic.none': { fr: 'Aucune image libre trouvée.', en: 'No free picture found.' },
  'pic.license': {
    fr: 'Licences Creative Commons ou domaine public : l’auteur et la licence sont mis en légende, avec un lien vers la source.',
    en: 'Creative Commons or public domain: the author and licence go in the caption, with a link to the source.',
  },
  'pic.inserted': { fr: 'Image insérée, avec son crédit en légende.', en: 'Picture inserted, with its credit as caption.' },

  // --- rechercher et synonymes
  'look.search': { fr: 'Rechercher', en: 'Search' },
  'look.title': { fr: 'Rechercher', en: 'Search' },
  'look.term': { fr: 'Terme cherché', en: 'Search term' },
  'look.research': { fr: 'Recherche', en: 'Research' },
  'look.empty': { fr: 'Sélectionnez un mot ou écrivez-le ci-dessus.', en: 'Select a word or type it above.' },
  'look.synonyms': { fr: 'Synonymes', en: 'Synonyms' },
  'look.antonyms': { fr: 'Antonymes', en: 'Antonyms' },
  'look.definitions': { fr: 'Définitions', en: 'Definitions' },
  'look.noSynonyms': { fr: 'Aucun synonyme trouvé.', en: 'No synonym found.' },
  'look.noDefinition': { fr: 'Aucune définition trouvée.', en: 'No definition found.' },
  'look.noArticle': { fr: 'Aucun article trouvé.', en: 'No article found.' },
  'look.replaceWith': { fr: 'Remplacer par « {word} »', en: 'Replace with “{word}”' },
  'look.wikipedia': { fr: 'Lire sur Wikipédia', en: 'Read on Wikipedia' },
  'look.wiktionary': { fr: 'Voir dans le Wiktionnaire', en: 'See on Wiktionary' },
  'look.privacy': { fr: 'Seul le mot cherché est envoyé (Wikipédia, Wiktionnaire).', en: 'Only the search word is sent (Wikipedia, Wiktionary).' },
  'look.ctx': { fr: 'Rechercher « {word} »', en: 'Search “{word}”' },

  // --- polices en ligne
  'gf.more': { fr: 'Autres polices en ligne…', en: 'More fonts online…' },
  'gf.title': { fr: 'Polices en ligne', en: 'Online fonts' },
  'gf.hint': {
    fr: 'Polices libres (SIL OFL, Apache 2.0) de Google Fonts : elles sont intégrées au document et marchent ensuite hors ligne.',
    en: 'Free fonts (SIL OFL, Apache 2.0) from Google Fonts: they are embedded in the document and then work offline.',
  },
  'gf.category': { fr: 'Catégorie', en: 'Category' },
  'gf.all': { fr: 'Toutes', en: 'All' },
  'gf.cat.serif': { fr: 'Avec empattements', en: 'Serif' },
  'gf.cat.sans': { fr: 'Sans empattements', en: 'Sans serif' },
  'gf.cat.display': { fr: 'Titres', en: 'Display' },
  'gf.cat.hand': { fr: 'Manuscrites', en: 'Handwriting' },
  'gf.cat.mono': { fr: 'Chasse fixe', en: 'Monospace' },
  'gf.other': { fr: 'Autre police', en: 'Other font' },
  'gf.otherPlaceholder': { fr: 'Nom exact sur fonts.google.com', en: 'Exact name on fonts.google.com' },
  'gf.otherHint': { fr: 'Vérifiez sa licence sur fonts.google.com avant de l’intégrer.', en: 'Check its licence on fonts.google.com before embedding it.' },
  'gf.add': { fr: 'Ajouter au document', en: 'Add to document' },
  'gf.pick': { fr: 'Choisissez une police.', en: 'Pick a font.' },
  'gf.installed': { fr: 'déjà intégrée', en: 'already embedded' },
  'gf.progress': { fr: 'Téléchargement : {done} sur {total} fichiers…', en: 'Downloading: {done} of {total} files…' },
  'gf.added': { fr: '« {family} » est intégrée au document.', en: '“{family}” is embedded in the document.' },
  'gf.notFound': { fr: 'Police introuvable sur Google Fonts.', en: 'Font not found on Google Fonts.' },
} satisfies Record<string, Row>
