import { EDIT_DICT } from './dict-edit'
import { LAYOUT_DICT } from './dict-layout'
import { REFS_DICT } from './dict-refs'
import { DOCX_DICT } from './dict-docx'
import { MATH_DICT } from './dict-math'
import { UI_DICT } from './dict-ui'
import { P7_DICT } from './dict-p7'
import { MERGE_DICT } from './dict-merge'
import { WORD_DICT } from './dict-word'
import { CITE_DICT } from './dict-cite'
import { ONLINE_DICT } from './dict-online'
import { TOOLS_DICT } from './dict-tools'
import { WORD2_DICT } from './dict-word2'

// Dictionnaire de l'interface : une entrée par phrase, une colonne par langue.
// Ajouter une langue = ajouter une colonne (le test i18n vérifie qu'aucune
// entrée ne manque). `{x}` est un paramètre ; { one, other } un pluriel.

type Entry = string | { one: string; other: string }
type Row = { fr: Entry; en: Entry }

const BASE_DICT = {
  'app.name': { fr: 'Folio Pages', en: 'Folio Pages' },
  'title.placeholder': { fr: 'Document sans titre', en: 'Untitled document' },
  'title.label': { fr: 'Titre du document', en: 'Document title' },
  'editor.label': { fr: 'Contenu du document', en: 'Document content' },

  // --- état de l'enregistrement
  'status.pristine': { fr: 'Aucune modification', en: 'No changes' },
  'status.dirty': { fr: 'Modifications non enregistrées', en: 'Unsaved changes' },
  'status.saving': { fr: 'Enregistrement…', en: 'Saving…' },
  'status.saved': { fr: 'Enregistré', en: 'Saved' },
  'status.savedIn': { fr: 'Enregistré dans « {name} »', en: 'Saved in “{name}”' },
  'status.downloaded': { fr: 'Copie téléchargée', en: 'Copy downloaded' },
  'status.error': { fr: 'Échec de l’enregistrement', en: 'Save failed' },
  'save.button': { fr: 'Enregistrer', en: 'Save' },
  'save.modeInPlace': { fr: 'Enregistrement dans le fichier', en: 'Saves into the file' },
  'save.modeDownload': { fr: 'Enregistrement par téléchargement d’une copie', en: 'Saves by downloading a copy' },
  'save.modeDownloadHelp': {
    fr: 'Ce navigateur ne peut pas réécrire le fichier ouvert : chaque enregistrement télécharge une copie à jour. Chrome et Edge enregistrent directement dans le fichier.',
    en: 'This browser cannot rewrite the open file: each save downloads an up-to-date copy. Chrome and Edge save straight into the file.',
  },
  'save.downloadedToast': {
    fr: 'Copie téléchargée : « {name} ». Gardez cette copie, elle remplace l’ancien fichier.',
    en: 'Copy downloaded: “{name}”. Keep this copy — it replaces the old file.',
  },
  'save.savedToast': { fr: 'Enregistré dans « {name} »', en: 'Saved in “{name}”' },
  'save.failed': { fr: 'L’enregistrement a échoué : {message}', en: 'Saving failed: {message}' },
  'save.permissionDenied': {
    fr: 'Folio Pages n’a pas reçu l’autorisation d’écrire dans le fichier.',
    en: 'Folio Pages was not allowed to write to the file.',
  },
  'save.conflictTitle': { fr: 'Le fichier a changé sur le disque', en: 'The file changed on disk' },
  'save.conflictBody': {
    fr: 'Un autre programme a modifié « {name} » depuis votre dernier enregistrement. L’écraser remplacera ces modifications par votre document.',
    en: 'Another program changed “{name}” since your last save. Overwriting it replaces those changes with your document.',
  },
  'save.overwrite': { fr: 'Écraser', en: 'Overwrite' },

  // --- menus
  'menu.file': { fr: 'Fichier', en: 'File' },
  'menu.edit': { fr: 'Édition', en: 'Edit' },
  'menu.ai': { fr: 'IA', en: 'AI' },
  'menu.help': { fr: 'Aide', en: 'Help' },
  'menu.newBlank': { fr: 'Nouveau document vide', en: 'New blank document' },
  'menu.save': { fr: 'Enregistrer', en: 'Save' },
  'menu.undo': { fr: 'Annuler', en: 'Undo' },
  'menu.redo': { fr: 'Rétablir', en: 'Redo' },
  'menu.selectAll': { fr: 'Tout sélectionner', en: 'Select all' },
  'menu.copyJson': { fr: 'Copier le JSON du document', en: 'Copy document JSON' },
  'menu.copyCompact': { fr: 'Copier le JSON compact (pour une IA)', en: 'Copy compact JSON (for an AI)' },
  'menu.replaceJson': { fr: 'Remplacer depuis le JSON…', en: 'Replace from JSON…' },
  'menu.aiHelp': { fr: 'Demander un document à une IA…', en: 'Ask an AI for a document…' },
  'menu.language': { fr: 'Langue de l’interface', en: 'Interface language' },
  'menu.loadReport': { fr: 'Rapport d’ouverture…', en: 'Opening report…' },
  'menu.about': { fr: 'À propos de Folio Pages', en: 'About Folio Pages' },

  // --- actions communes
  'action.cancel': { fr: 'Annuler', en: 'Cancel' },
  'action.close': { fr: 'Fermer', en: 'Close' },
  'action.copy': { fr: 'Copier', en: 'Copy' },
  'action.details': { fr: 'Détails', en: 'Details' },

  // --- document de démonstration
  'demo.banner': {
    fr: 'Vous lisez le document de démonstration. Modifiez-le librement, ou partez d’une page blanche.',
    en: 'You are reading the demo document. Edit it freely, or start from a blank page.',
  },
  'demo.newBlank': { fr: 'Nouveau document vide', en: 'New blank document' },
  'blank.done': { fr: 'Document vidé. Ctrl+Z pour annuler.', en: 'Document cleared. Ctrl+Z to undo.' },

  // --- copier / remplacer le JSON
  'json.copied': { fr: 'JSON du document copié', en: 'Document JSON copied' },
  'json.copiedCompact': {
    fr: 'JSON compact copié : collez-le dans votre conversation avec l’IA.',
    en: 'Compact JSON copied: paste it into your conversation with the AI.',
  },
  'json.copyManually': { fr: 'Copiez ce texte', en: 'Copy this text' },
  'json.copyManuallyHelp': {
    fr: 'Le presse-papiers n’est pas accessible ici. Sélectionnez le texte (Ctrl+A) puis copiez-le (Ctrl+C).',
    en: 'The clipboard is not available here. Select the text (Ctrl+A), then copy it (Ctrl+C).',
  },
  'replace.title': { fr: 'Remplacer depuis le JSON', en: 'Replace from JSON' },
  'replace.help': {
    fr: 'Collez le JSON d’un document Folio Pages, sous sa forme complète ou compacte, par exemple la réponse d’une IA. Tout le contenu est remplacé ; Ctrl+Z annule le remplacement.',
    en: 'Paste the JSON of a Folio Pages document, full or compact — for example an AI’s answer. All the content is replaced; Ctrl+Z undoes it.',
  },
  'replace.label': { fr: 'JSON du document', en: 'Document JSON' },
  'replace.submit': { fr: 'Remplacer le document', en: 'Replace the document' },
  'replace.empty': { fr: 'Collez d’abord un JSON.', en: 'Paste some JSON first.' },
  'replace.done': { fr: 'Document remplacé. Ctrl+Z pour annuler.', en: 'Document replaced. Ctrl+Z to undo.' },
  'replace.notDocument': { fr: 'Ce JSON n’est pas un document Folio Pages.', en: 'This JSON is not a Folio Pages document.' },
  'replace.encrypted': {
    fr: 'Ce JSON est un document chiffré : il ne peut pas être collé ici.',
    en: 'This JSON is an encrypted document: it cannot be pasted here.',
  },
  'replace.tooLarge': { fr: 'Ce JSON est trop volumineux.', en: 'This JSON is too large.' },
  'replace.jsonError': {
    fr: 'JSON invalide ligne {line}, colonne {column} : {message}.',
    en: 'Invalid JSON at line {line}, column {column}: {message}.',
  },

  // --- rapport d'ouverture
  'report.summary': {
    fr: 'Chargé : {ignored}, {warnings}',
    en: 'Loaded: {ignored}, {warnings}',
  },
  'report.ignored': { fr: { one: '{n} champ ignoré', other: '{n} champs ignorés' }, en: { one: '{n} field ignored', other: '{n} fields ignored' } },
  'report.warnings': { fr: { one: '{n} avertissement', other: '{n} avertissements' }, en: { one: '{n} warning', other: '{n} warnings' } },
  'report.title': { fr: 'Rapport d’ouverture', en: 'Opening report' },
  'report.intro': {
    fr: 'Le document s’est ouvert. Voici ce qui a été ignoré ou corrigé dans son JSON ; votre texte n’a pas été perdu.',
    en: 'The document opened. Here is what was ignored or corrected in its JSON; your text was not lost.',
  },
  'report.none': { fr: 'Rien à signaler : le document a été lu tel quel.', en: 'Nothing to report: the document was read as is.' },
  'report.kindIgnored': { fr: 'Ignoré', en: 'Ignored' },
  'report.kindWarning': { fr: 'Corrigé', en: 'Corrected' },
  'report.more': { fr: { one: 'et {n} autre…', other: 'et {n} autres…' }, en: { one: 'and {n} more…', other: 'and {n} more…' } },
  'report.root': { fr: '(document)', en: '(document)' },

  'issue.unknown-field': { fr: 'champ inconnu « {detail} »', en: 'unknown field “{detail}”' },
  'issue.wrong-type': { fr: 'type de valeur incorrect ({detail})', en: 'wrong value type ({detail})' },
  'issue.invalid-value': { fr: 'valeur non valide « {detail} »', en: 'invalid value “{detail}”' },
  'issue.missing-field': { fr: 'champ obligatoire manquant « {detail} »', en: 'missing required field “{detail}”' },
  'issue.too-many-items': { fr: '{detail} éléments en trop', en: '{detail} items too many' },
  'issue.too-deep': { fr: 'imbrication trop profonde', en: 'nested too deeply' },
  'issue.too-large': { fr: 'document trop grand : la fin est ignorée', en: 'document too large: the end is ignored' },
  'issue.unknown-block-type': { fr: 'type de bloc inconnu « {detail} »', en: 'unknown block type “{detail}”' },
  'issue.unsafe-link': { fr: 'lien refusé « {detail} » (le texte est gardé)', en: 'link refused “{detail}” (the text is kept)' },
  'issue.empty-run': { fr: 'morceau de texte vide', en: 'empty run of text' },
  'issue.coerced': { fr: 'valeur convertie ({detail})', en: 'value converted ({detail})' },
  'issue.clamped': { fr: 'valeur ramenée dans les limites ({detail})', en: 'value brought within limits ({detail})' },
  'issue.truncated': { fr: 'texte tronqué à {detail} caractères', en: 'text cut to {detail} characters' },
  'issue.block-converted': { fr: 'type de bloc inconnu, converti ({detail})', en: 'unknown block type, converted ({detail})' },
  'issue.level-adjusted': { fr: 'niveau de liste corrigé ({detail})', en: 'list level corrected ({detail})' },
  'issue.several-sources': {
    fr: 'plusieurs textes donnés : {detail} est utilisé',
    en: 'several texts given: {detail} is used',
  },
  'issue.markdown-ignored': { fr: '« markdown » ignoré car « blocks » est rempli', en: '“markdown” ignored because “blocks” is filled' },
  'issue.format-missing': { fr: 'champ « format » absent (attendu : {detail})', en: '“format” field missing (expected: {detail})' },
  'issue.format-unknown': { fr: 'format inattendu « {detail} »', en: 'unexpected format “{detail}”' },
  'issue.version-newer': {
    fr: 'document écrit pour une version plus récente du format ({detail})',
    en: 'document written for a newer format version ({detail})',
  },
  'issue.id-minted': { fr: 'nouvel identifiant créé', en: 'new identity created' },
  'issue.json-repaired': {
    fr: 'JSON réparé : virgules en trop ou commentaires retirés',
    en: 'JSON repaired: extra commas or comments removed',
  },
  'issue.cell-flattened': { fr: '« {detail} » ne peut pas aller dans une cellule : aplati', en: '“{detail}” cannot go in a cell: flattened' },
  'issue.note-flattened': { fr: '« {detail} » ne peut pas aller dans une note : aplati', en: '“{detail}” cannot go in a note: flattened' },
  'issue.source-unknown': { fr: 'Source « {detail} » introuvable : la citation est retirée', en: 'Source “{detail}” not found: the citation is removed' },
  'issue.source-duplicate': { fr: 'Source « {detail} » en double : seule la première est gardée', en: 'Duplicate source “{detail}”: only the first is kept' },
  'issue.bookmark-duplicate': { fr: 'Signet « {detail} » en double : seul le premier est gardé', en: 'Duplicate bookmark “{detail}”: only the first is kept' },
  'issue.comment-unknown': { fr: 'Commentaire « {detail} » introuvable : le texte garde sa place, sans commentaire', en: 'Comment “{detail}” not found: the text stays, without a comment' },
  'issue.comment-duplicate': { fr: 'Deux commentaires ont l’identifiant « {detail} » : le second est ignoré', en: 'Two comments share the id “{detail}”: the second is ignored' },
  'issue.comment-misplaced': { fr: 'Pas de commentaire dans un en-tête, un pied de page ou une note ({detail})', en: 'No comments in a header, footer or note ({detail})' },
  'issue.note-misplaced': { fr: 'Une note ne peut pas aller ici (dans une note, un en-tête ou un pied de page) : retirée (« {detail} »)', en: 'A note cannot go here (in a note, a header or a footer): removed (“{detail}”)' },

  // --- JSON illisible
  'broken.title': { fr: 'Le document de ce fichier est illisible', en: 'This file’s document cannot be read' },
  'broken.body': {
    fr: 'Le JSON du bloc « folio-doc » contient une erreur ligne {line}, colonne {column} : {message}. Le fichier n’a pas été modifié.',
    en: 'The JSON in the “folio-doc” block has an error at line {line}, column {column}: {message}. The file has not been changed.',
  },
  'broken.recover': { fr: 'Récupérer le texte', en: 'Recover the text' },
  'broken.recoverHelp': {
    fr: 'Ouvre le texte retrouvé dans le JSON ; vérifiez-le avant d’enregistrer.',
    en: 'Opens the text found in the JSON; check it before saving.',
  },
  'broken.showRaw': { fr: 'Voir le contenu brut', en: 'Show raw content' },
  'broken.startBlank': { fr: 'Commencer un document vide', en: 'Start a blank document' },
  'broken.recovered': {
    fr: { one: '{n} bloc de texte récupéré. Vérifiez-le avant d’enregistrer.', other: '{n} blocs de texte récupérés. Vérifiez-les avant d’enregistrer.' },
    en: { one: '{n} block of text recovered. Check it before saving.', other: '{n} blocks of text recovered. Check them before saving.' },
  },
  'broken.rawTitle': { fr: 'Contenu brut du bloc « folio-doc »', en: 'Raw content of the “folio-doc” block' },
  'jsonErr.unexpected-end': { fr: 'le texte s’arrête trop tôt', en: 'the text ends too early' },
  'jsonErr.unexpected-char': { fr: 'caractère inattendu « {found} »', en: 'unexpected character “{found}”' },
  'jsonErr.trailing-comma': { fr: 'virgule en trop avant « {found} »', en: 'extra comma before “{found}”' },
  'jsonErr.unterminated-string': { fr: 'texte entre guillemets non fermé', en: 'unclosed quoted text' },
  'jsonErr.bad-escape': { fr: 'séquence « \\ » non valide', en: 'invalid “\\” sequence' },
  'jsonErr.control-char': { fr: 'caractère invisible interdit dans un texte', en: 'invisible character not allowed in text' },
  'jsonErr.expected-colon': { fr: '« : » attendu après le nom du champ', en: '“:” expected after the field name' },
  'jsonErr.expected-comma': { fr: 'virgule manquante avant « {found} »', en: 'missing comma before “{found}”' },
  'jsonErr.expected-key': { fr: 'nom de champ entre guillemets doubles attendu', en: 'field name in double quotes expected' },
  'jsonErr.trailing-content': { fr: 'texte en trop après la fin du document', en: 'extra text after the end of the document' },
  'jsonErr.too-deep': { fr: 'imbrication trop profonde', en: 'nested too deeply' },
  'jsonErr.empty': { fr: 'le bloc est vide', en: 'the block is empty' },

  // --- autres refus
  'refused.encryptedTitle': { fr: 'Document protégé par un mot de passe', en: 'Password-protected document' },
  'refused.encryptedBody': {
    fr: 'Ce document est chiffré. Cette version de Folio Pages ne sait pas encore ouvrir les documents chiffrés ; le fichier n’a pas été modifié.',
    en: 'This document is encrypted. This version of Folio Pages cannot open encrypted documents yet; the file has not been changed.',
  },
  'refused.notDocumentTitle': { fr: 'Ce n’est pas un document Folio Pages', en: 'This is not a Folio Pages document' },
  'refused.notDocumentBody': {
    fr: 'Le bloc « folio-doc » de ce fichier ne contient pas un document. Le fichier n’a pas été modifié.',
    en: 'The “folio-doc” block of this file does not hold a document. The file has not been changed.',
  },
  'refused.tooLargeTitle': { fr: 'Document trop volumineux', en: 'Document too large' },
  'refused.tooLargeBody': {
    fr: 'Le document de ce fichier dépasse la taille maximale ({size} caractères). Le fichier n’a pas été modifié.',
    en: 'This file’s document is over the maximum size ({size} characters). The file has not been changed.',
  },

  // --- récupération après plantage
  'recovery.title': { fr: 'Modifications non enregistrées trouvées', en: 'Unsaved changes found' },
  'recovery.body': {
    fr: 'Des modifications non enregistrées du {date} ont été gardées dans ce navigateur.',
    en: 'Unsaved changes from {date} were kept in this browser.',
  },
  'recovery.older': {
    fr: 'Attention : cette copie semble plus ancienne que le fichier ouvert, enregistré le {date}.',
    en: 'Careful: this copy looks older than the open file, saved on {date}.',
  },
  'recovery.restore': { fr: 'Restaurer', en: 'Restore' },
  'recovery.ignore': { fr: 'Ignorer', en: 'Ignore' },
  'recovery.restored': { fr: 'Modifications restaurées. Ctrl+Z pour annuler.', en: 'Changes restored. Ctrl+Z to undo.' },

  // --- IA
  'ai.title': { fr: 'Demander un document à une IA', en: 'Ask an AI for a document' },
  'ai.intro': {
    fr: 'Ce fichier est fait pour être rempli par une IA : son contenu est du JSON lisible, et un guide pour les IA est écrit en tête du fichier.',
    en: 'This file is made to be filled by an AI: its content is readable JSON, and a guide for AIs is written at the top of the file.',
  },
  'ai.step1': {
    fr: 'Envoyez ce fichier .html à une IA avec votre demande, par exemple : « Fais-moi un compte rendu de la réunion d’hier avec un tableau des décisions. »',
    en: 'Send this .html file to an AI with your request, for example: “Make me a report of yesterday’s meeting with a table of the decisions.”',
  },
  'ai.step2': {
    fr: 'L’IA renvoie le fichier complété : ouvrez-le dans votre navigateur, c’est prêt.',
    en: 'The AI sends the completed file back: open it in your browser and it is ready.',
  },
  'ai.step3': {
    fr: 'Dans une conversation où l’on ne peut pas joindre de fichier : « Copier le JSON compact », collez-le avec votre demande, puis collez la réponse dans « Remplacer depuis le JSON… ».',
    en: 'In a chat that cannot take a file: “Copy compact JSON”, paste it with your request, then paste the answer into “Replace from JSON…”.',
  },
  'ai.promptLabel': { fr: 'Exemple de demande à copier', en: 'Example request to copy' },
  'ai.prompt': {
    fr: 'Voici un fichier Folio Pages. Lis le guide pour les IA en tête du fichier, puis remplis uniquement le bloc « folio-doc » avec : ',
    en: 'Here is a Folio Pages file. Read the guide for AIs at the top of the file, then fill only the “folio-doc” block with: ',
  },
  'ai.copyPrompt': { fr: 'Copier la demande', en: 'Copy the request' },
  'ai.promptCopied': { fr: 'Demande copiée', en: 'Request copied' },

  // --- à propos
  'about.title': { fr: 'À propos de Folio Pages', en: 'About Folio Pages' },
  'about.body': {
    fr: 'Un traitement de texte libre dans un seul fichier HTML : l’éditeur et le document à la fois. Aucune installation, aucun compte, aucun serveur.',
    en: 'A free word processor in a single HTML file: the editor and the document at once. No install, no account, no server.',
  },
  'about.version': { fr: 'Version {version}', en: 'Version {version}' },
  'about.licence': {
    fr: 'Logiciel libre sous licence MIT. Les notices de licence de Folio Pages, de Bento et de ProseMirror sont écrites dans chaque fichier enregistré.',
    en: 'Free software under the MIT licence. The licence notices of Folio Pages, Bento and ProseMirror are written into every saved file.',
  },
  'about.source': { fr: 'Code source', en: 'Source code' },

  // --- erreurs et divers
  'fatal.title': { fr: 'Folio Pages n’a pas pu démarrer', en: 'Folio Pages could not start' },
  'fatal.body': {
    fr: 'Erreur : {message}. Votre document n’a pas été modifié : il reste lisible en JSON dans ce fichier (bloc « folio-doc »).',
    en: 'Error: {message}. Your document has not been changed: it is still readable as JSON in this file (the “folio-doc” block).',
  },
  'fatal.copy': { fr: 'Copier le contenu du document', en: 'Copy the document content' },
  'copied': { fr: 'Copié', en: 'Copied' },
} as const satisfies Record<string, Row>

/** Le dictionnaire complet : l'interface de base, l'édition (dict-edit.ts), la mise en page (dict-layout.ts). */
export const DICT = { ...BASE_DICT, ...EDIT_DICT, ...LAYOUT_DICT, ...REFS_DICT, ...DOCX_DICT, ...MATH_DICT, ...UI_DICT, ...P7_DICT, ...MERGE_DICT, ...WORD_DICT, ...CITE_DICT, ...ONLINE_DICT, ...TOOLS_DICT, ...WORD2_DICT }

export type Key = keyof typeof DICT
