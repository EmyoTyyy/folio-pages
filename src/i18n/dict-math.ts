// Dictionnaire des équations (phase 6). Fait partie du dictionnaire unique
// (dict.ts le réunit au reste).

type Entry = string | { one: string; other: string }
type Row = { fr: Entry; en: Entry }

export const MATH_DICT = {
  'math.empty': { fr: 'Formule vide', en: 'Empty formula' },
  'math.unknownCommand': { fr: 'Commande inconnue : {command}', en: 'Unknown command: {command}' },
  'math.syntax': { fr: 'Formule incomplète ou mal formée ({message})', en: 'Incomplete or malformed formula ({message})' },
  'math.dialog.new': { fr: 'Nouvelle équation', en: 'New equation' },
  'math.dialog.edit': { fr: 'Modifier l’équation', en: 'Edit equation' },
  'math.source': { fr: 'Source LaTeX', en: 'LaTeX source' },
  'math.preview': { fr: 'Aperçu', en: 'Preview' },
  'math.previewEmpty': { fr: 'Écrivez une formule, par exemple E = mc^2', en: 'Type a formula, for example E = mc^2' },
  'math.ok': { fr: 'La formule se lit correctement.', en: 'The formula reads correctly.' },
  'math.layout': { fr: 'Disposition', en: 'Layout' },
  'math.inline': { fr: 'Dans la ligne', en: 'In line' },
  'math.display': { fr: 'Centrée', en: 'Centred' },
  'math.numbered': { fr: 'Numérotée', en: 'Numbered' },
  'math.keys': {
    fr: 'Ctrl+Entrée pour valider · Échap pour annuler · \\label{eq1} puis \\eqref{eq1} pour y renvoyer',
    en: 'Ctrl+Enter to apply · Esc to cancel · \\label{eq1} then \\eqref{eq1} to refer to it',
  },
  'math.insertAt': { fr: 'Insérer', en: 'Insert' },
  'math.delete': { fr: 'Supprimer', en: 'Delete' },
  'math.palette': { fr: 'Modèles', en: 'Templates' },
  'math.pal.structures': { fr: 'Structures', en: 'Structures' },
  'math.pal.greek': { fr: 'Lettres grecques', en: 'Greek letters' },
  'math.pal.operators': { fr: 'Opérateurs', en: 'Operators' },
  'math.pal.relations': { fr: 'Relations et flèches', en: 'Relations and arrows' },
  'math.pal.more': { fr: 'Ensembles, chimie, unités', en: 'Sets, chemistry, units' },
  'math.macros.title': { fr: 'Macros des équations', en: 'Equation macros' },
  'math.macros.help': {
    fr: 'Définitions lues avant chaque formule du document, par exemple \\newcommand{\\R}{\\mathbb{R}} ou \\DeclareMathOperator{\\tr}{tr}.',
    en: 'Definitions read before every formula of the document, for example \\newcommand{\\R}{\\mathbb{R}} or \\DeclareMathOperator{\\tr}{tr}.',
  },
  'math.macros.bad': { fr: 'Ces macros empêchent les formules de se lire : {message}', en: 'These macros stop formulas from reading: {message}' },
  'math.convert': { fr: 'Convertir les $…$ en équations', en: 'Convert $…$ to equations' },
  'math.converted': {
    fr: { one: '{n} formule convertie', other: '{n} formules converties' },
    en: { one: '{n} formula converted', other: '{n} formulas converted' },
  },
  'math.noneFound': { fr: 'Aucune formule $…$ ni \\(…\\) dans ce texte.', en: 'No $…$ or \\(…\\) formula in this text.' },
  'math.notHere': { fr: 'Une équation ne peut pas aller ici.', en: 'An equation cannot go here.' },
  'math.copyLatex': { fr: 'Copier le LaTeX', en: 'Copy LaTeX' },
  'math.copyMathml': { fr: 'Copier le MathML', en: 'Copy MathML' },
  'ribbon.equation': { fr: 'Équation', en: 'Equation' },
  'ribbon.equationInline': { fr: 'Formule dans la ligne', en: 'Formula in line' },
  'ribbon.equationDisplay': { fr: 'Équation centrée', en: 'Centred equation' },
  'ribbon.equationNumbered': { fr: 'Équation numérotée', en: 'Numbered equation' },
  'ribbon.equationMacros': { fr: 'Macros des équations…', en: 'Equation macros…' },
  'issue.math-empty': { fr: 'formule vide ignorée', en: 'empty formula ignored' },
  'issue.math-invalid': { fr: 'formule illisible : {detail}', en: 'unreadable formula: {detail}' },
} satisfies Record<string, Row>
