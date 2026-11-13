// Modèles intégrés : des documents de départ, en français et en anglais,
// écrits dans la forme compacte du format (celle du guide pour les IA). Ils
// passent par le même chargement tolérant qu'un fichier : un test vérifie
// qu'aucun champ n'est ignoré.
//
// Textes d'exemple originaux. Noms, adresses et numéros sont fictifs.

export const TEMPLATE_IDS = ['blank', 'letter', 'cv', 'report', 'minutes', 'invoice', 'thesis', 'recipe', 'worksheet'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

/** Esquisse de la vignette : une ligne par élément de la première page. */
export type SketchLine = 'title' | 'subtitle' | 'h' | 'text' | 'short' | 'right' | 'center' | 'list' | 'table' | 'gap' | 'rule' | 'cols'

export interface Template {
  id: TemplateId
  sketch: SketchLine[]
  /** Le document, dans la langue demandée (forme compacte). */
  build: (fr: boolean) => Record<string, unknown>
}

const doc = (fr: boolean, title: string, rest: Record<string, unknown>) => ({
  format: 'folio/doc',
  version: 1,
  meta: { title, lang: fr ? 'fr' : 'en' },
  ...rest,
})

const pageFooter = (fr: boolean) => ({ default: [{ md: fr ? 'Page {{page}} sur {{pages}}' : 'Page {{page}} of {{pages}}', align: 'center' }] })

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    sketch: [],
    build: (fr) => doc(fr, '', { blocks: [''] }),
  },
  {
    id: 'letter',
    sketch: ['short', 'short', 'short', 'gap', 'right', 'right', 'right', 'gap', 'right', 'gap', 'short', 'gap', 'text', 'text', 'text', 'gap', 'text', 'text', 'gap', 'right'],
    build: (fr) =>
      doc(fr, fr ? 'Lettre' : 'Letter', {
        theme: { name: 'classic' },
        blocks: fr
          ? [
              { content: [{ text: 'Camille Martin', bold: true }, '\n12 rue des Lilas\n69003 Lyon\ncamille.martin@exemple.fr · 06 12 34 56 78'], spacing: { after: 24 } },
              { text: 'Société Horizon\nService des ressources humaines\n8 avenue de la Gare\n75010 Paris', indent: { left: 250 }, spacing: { after: 24 } },
              { md: 'Lyon, le {{date:D MMMM YYYY}}', align: 'right', spacing: { after: 18 } },
              { md: '**Objet :** candidature au poste de chargée de projet', spacing: { after: 18 } },
              { text: 'Madame, Monsieur,' },
              { text: 'Écrivez ici le premier paragraphe : la raison de votre lettre, en une ou deux phrases.', align: 'justify' },
              { text: 'Développez ensuite : ce que vous proposez, ce que vous demandez, les éléments utiles au destinataire.', align: 'justify' },
              { text: 'Concluez par ce que vous attendez (un rendez-vous, une réponse) et vos disponibilités.', align: 'justify' },
              { text: 'Je vous prie d’agréer, Madame, Monsieur, l’expression de mes salutations distinguées.', align: 'justify', spacing: { after: 24 } },
              { text: 'Camille Martin', indent: { left: 300 } },
            ]
          : [
              { content: [{ text: 'Alex Morgan', bold: true }, '\n42 Willow Street\nPortland, OR 97201\nalex.morgan@example.com · (503) 555-0142'], spacing: { after: 24 } },
              { md: '{{date:MMMM D, YYYY}}', spacing: { after: 18 } },
              { text: 'Jordan Lee\nHiring Manager\nHorizon Ltd.\n8 Station Avenue\nSeattle, WA 98101', spacing: { after: 18 } },
              { md: '**Re:** application for the project coordinator position', spacing: { after: 18 } },
              { text: 'Dear Jordan Lee,' },
              { text: 'Write your first paragraph here: why you are writing, in one or two sentences.', align: 'justify' },
              { text: 'Then give the details: what you offer, what you ask for, what the reader needs to know.', align: 'justify' },
              { text: 'End with what you expect next (a meeting, a reply) and when you are available.', align: 'justify', spacing: { after: 18 } },
              { text: 'Sincerely,', spacing: { after: 30 } },
              { text: 'Alex Morgan' },
            ],
      }),
  },
  {
    id: 'cv',
    sketch: ['title', 'subtitle', 'short', 'rule', 'h', 'short', 'text', 'list', 'list', 'short', 'text', 'list', 'h', 'short', 'text', 'h', 'cols'],
    build: (fr) =>
      doc(fr, fr ? 'Curriculum vitæ' : 'Résumé', {
        theme: { name: 'modern' },
        page: { margins: { top: 18, right: 18, bottom: 18, left: 18 } },
        blocks: [
          { type: 'paragraph', style: 'title', text: fr ? 'Camille Martin' : 'Alex Morgan' },
          { type: 'paragraph', style: 'subtitle', text: fr ? 'Chargée de projet · 8 ans d’expérience' : 'Project coordinator · 8 years of experience' },
          { md: fr ? 'Lyon · camille.martin@exemple.fr · 06 12 34 56 78 · [portfolio.exemple.fr](https://portfolio.exemple.fr)' : 'Portland, OR · alex.morgan@example.com · (503) 555-0142 · [portfolio.example.com](https://portfolio.example.com)' },
          { type: 'divider' },
          { type: 'heading', level: 2, text: fr ? 'Profil' : 'Profile' },
          { text: fr ? 'Deux ou trois phrases sur ce que vous savez faire et ce que vous cherchez.' : 'Two or three sentences on what you do well and what you are looking for.', align: 'justify' },
          { type: 'heading', level: 2, text: fr ? 'Expérience' : 'Experience' },
          { md: fr ? '**Chargée de projet** — Société Horizon, Lyon' : '**Project coordinator** — Horizon Ltd., Portland', spacing: { after: 0 } },
          { md: fr ? '*2021 – aujourd’hui*' : '*2021 – present*', spacing: { after: 2 } },
          { type: 'list', items: fr ? ['Une réalisation chiffrée (délais tenus, budget, équipe).', 'Une responsabilité importante.', 'Un outil ou une méthode que vous maîtrisez.'] : ['An achievement with numbers (deadlines met, budget, team).', 'A key responsibility.', 'A tool or method you know well.'] },
          { md: fr ? '**Assistante de projet** — Atelier Lumière, Grenoble' : '**Project assistant** — Bright Studio, Seattle', spacing: { after: 0 } },
          { md: '*2017 – 2021*', spacing: { after: 2 } },
          { type: 'list', items: fr ? ['Une réalisation.', 'Une responsabilité.'] : ['An achievement.', 'A responsibility.'] },
          { type: 'heading', level: 2, text: fr ? 'Formation' : 'Education' },
          { md: fr ? '**Master de gestion de projet** — Université de Lyon, 2017' : '**MSc in Project Management** — Portland State University, 2017' },
          { type: 'heading', level: 2, text: fr ? 'Compétences et langues' : 'Skills and languages' },
          {
            type: 'columns',
            count: 2,
            blocks: [
              { type: 'list', items: fr ? ['Planification et suivi', 'Animation d’équipe', 'Tableurs et outils de gestion'] : ['Planning and tracking', 'Leading a team', 'Spreadsheets and project tools'] },
              { type: 'columnbreak' },
              { type: 'list', items: fr ? ['Français : langue maternelle', 'Anglais : courant (C1)', 'Espagnol : intermédiaire (B1)'] : ['English: native', 'Spanish: fluent (C1)', 'French: intermediate (B1)'] },
            ],
          },
        ],
      }),
  },
  {
    id: 'report',
    sketch: ['gap', 'gap', 'title', 'subtitle', 'gap', 'gap', 'center', 'center'],
    build: (fr) =>
      doc(fr, fr ? 'Rapport' : 'Report', {
        theme: { name: 'slate' },
        footers: pageFooter(fr),
        headers: { default: [{ md: '{{title}}', align: 'right' }] },
        page: { firstPage: true },
        blocks: [
          { text: '', spacing: { before: 150 } },
          { type: 'paragraph', style: 'title', text: fr ? 'Titre du rapport' : 'Report title' },
          { type: 'paragraph', style: 'subtitle', text: fr ? 'Sous-titre : le sujet en une ligne' : 'Subtitle: the subject in one line' },
          { md: '{{author}} · {{date:MMMM YYYY}}', spacing: { before: 120 } },
          { type: 'pagebreak' },
          { type: 'toc', levels: 2, title: fr ? 'Sommaire' : 'Contents' },
          { type: 'pagebreak' },
          { type: 'heading', level: 1, text: fr ? 'Résumé' : 'Summary' },
          { text: fr ? 'L’essentiel du rapport en un paragraphe : la question, la méthode, les résultats, la recommandation.' : 'The whole report in one paragraph: the question, the method, the findings, the recommendation.', align: 'justify' },
          { type: 'heading', level: 1, text: fr ? 'Introduction' : 'Introduction' },
          { text: fr ? 'Le contexte, la question posée et le plan du rapport.' : 'The background, the question and how the report is organized.', align: 'justify' },
          { type: 'heading', level: 1, text: fr ? 'Résultats' : 'Findings' },
          { type: 'heading', level: 2, text: fr ? 'Premier résultat' : 'First finding' },
          { md: fr ? 'Ce que montrent les données, avec leur source.^[Indiquez ici la source des chiffres.]' : 'What the data shows, with its source.^[Give the source of the figures here.]', align: 'justify' },
          {
            type: 'table',
            style: 'zebra',
            rows: fr
              ? [['Indicateur', '2025', '2026', 'Évolution'], ['Premier indicateur', '120', '138', '+15 %'], ['Second indicateur', '64', '59', '−8 %']]
              : [['Measure', '2025', '2026', 'Change'], ['First measure', '120', '138', '+15%'], ['Second measure', '64', '59', '−8%']],
          },
          { type: 'heading', level: 2, text: fr ? 'Second résultat' : 'Second finding' },
          { text: fr ? 'Un autre résultat, expliqué.' : 'Another finding, explained.', align: 'justify' },
          { type: 'heading', level: 1, text: fr ? 'Recommandations' : 'Recommendations' },
          { type: 'list', style: 'number', items: fr ? ['Première recommandation, avec son coût et son délai.', 'Deuxième recommandation.'] : ['First recommendation, with its cost and timing.', 'Second recommendation.'] },
          { type: 'heading', level: 1, text: 'Conclusion' },
          { text: fr ? 'Ce qu’il faut retenir et la suite à donner.' : 'What to remember and what happens next.', align: 'justify' },
        ],
      }),
  },
  {
    id: 'minutes',
    sketch: ['title', 'table', 'table', 'h', 'list', 'list', 'h', 'text', 'text', 'h', 'table', 'table'],
    build: (fr) =>
      doc(fr, fr ? 'Compte rendu de réunion' : 'Meeting minutes', {
        theme: { name: 'folio' },
        footers: pageFooter(fr),
        blocks: [
          { type: 'paragraph', style: 'title', text: fr ? 'Compte rendu de réunion' : 'Meeting minutes' },
          {
            type: 'table',
            style: 'minimal',
            header: false,
            firstColumn: true,
            widths: [110, 350],
            rows: fr
              ? [['Date', { md: '{{date:dddd D MMMM YYYY}}' }], ['Lieu', 'Salle de réunion, 2ᵉ étage'], ['Présents', 'Prénom Nom, Prénom Nom, Prénom Nom'], ['Excusés', 'Prénom Nom'], ['Rédaction', { md: '{{author}}' }]]
              : [['Date', { md: '{{date:dddd, MMMM D, YYYY}}' }], ['Place', 'Meeting room, 2nd floor'], ['Present', 'First Last, First Last, First Last'], ['Apologies', 'First Last'], ['Minutes by', { md: '{{author}}' }]],
          },
          { type: 'heading', level: 2, text: fr ? 'Ordre du jour' : 'Agenda' },
          { type: 'list', style: 'number', items: fr ? ['Point sur l’avancement', 'Budget', 'Questions diverses'] : ['Progress update', 'Budget', 'Any other business'] },
          { type: 'heading', level: 2, text: fr ? '1. Point sur l’avancement' : '1. Progress update' },
          { md: fr ? '**Discussion :** ce qui a été dit, en quelques phrases.' : '**Discussion:** what was said, in a few sentences.' },
          { md: fr ? '**Décision :** ce qui a été décidé.' : '**Decision:** what was decided.' },
          { type: 'heading', level: 2, text: fr ? '2. Budget' : '2. Budget' },
          { md: fr ? '**Discussion :** …' : '**Discussion:** …' },
          { md: fr ? '**Décision :** …' : '**Decision:** …' },
          { type: 'heading', level: 2, text: fr ? 'Actions' : 'Action items' },
          {
            type: 'table',
            style: 'lines',
            widths: [250, 110, 100],
            rows: fr
              ? [['Action', 'Responsable', 'Échéance'], ['Envoyer le compte rendu', 'Prénom Nom', 'JJ/MM/AAAA'], ['Préparer le budget révisé', 'Prénom Nom', 'JJ/MM/AAAA']]
              : [['Action', 'Owner', 'Due'], ['Send the minutes', 'First Last', 'MM/DD/YYYY'], ['Prepare the revised budget', 'First Last', 'MM/DD/YYYY']],
          },
          { md: fr ? '**Prochaine réunion :** date, heure et lieu.' : '**Next meeting:** date, time and place.', spacing: { before: 12 } },
        ],
      }),
  },
  {
    id: 'invoice',
    sketch: ['subtitle', 'short', 'short', 'gap', 'title', 'right', 'right', 'gap', 'short', 'short', 'gap', 'table', 'table', 'table', 'table', 'right', 'right', 'gap', 'text'],
    build: (fr) =>
      doc(fr, fr ? 'Facture' : 'Invoice', {
        theme: { name: 'modern' },
        footers: { default: [{ md: fr ? 'Atelier Lumière · SIRET 000 000 000 00000 · TVA FR00 000000000' : 'Bright Studio · Tax ID 00-0000000', align: 'center' }] },
        blocks: [
          { content: fr ? [{ text: 'Atelier Lumière', bold: true }, '\n5 place du Marché, 38000 Grenoble\ncontact@atelier-lumiere.exemple · 04 76 00 00 00'] : [{ text: 'Bright Studio', bold: true }, '\n5 Market Square, Seattle, WA 98101\nhello@bright-studio.example · (206) 555-0175'], spacing: { after: 18 } },
          { type: 'paragraph', style: 'title', text: fr ? 'Facture' : 'Invoice' },
          {
            type: 'table',
            style: 'minimal',
            header: false,
            firstColumn: true,
            widths: [120, 200],
            rows: fr
              ? [['Numéro', '2026-001'], ['Date', { md: '{{date:DD/MM/YYYY}}' }], ['Échéance', '30 jours']]
              : [['Number', '2026-001'], ['Date', { md: '{{date:MM/DD/YYYY}}' }], ['Due', 'Net 30']],
          },
          { content: fr ? [{ text: 'Facturé à', bold: true }, '\nClient SARL\n10 rue du Port\n44000 Nantes'] : [{ text: 'Bill to', bold: true }, '\nClient Inc.\n10 Harbor Road\nPortland, OR 97201'], spacing: { before: 12, after: 12 } },
          {
            type: 'table',
            style: 'zebra',
            widths: [250, 60, 80, 80],
            rows: fr
              ? [['Désignation', 'Qté', 'Prix unit. HT', 'Total HT'], ['Conception graphique', '1', '800,00 €', '800,00 €'], ['Impression (100 ex.)', '100', '1,50 €', '150,00 €'], ['Livraison', '1', '25,00 €', '25,00 €']]
              : [['Description', 'Qty', 'Unit price', 'Amount'], ['Graphic design', '1', '$800.00', '$800.00'], ['Printing (100 copies)', '100', '$1.50', '$150.00'], ['Delivery', '1', '$25.00', '$25.00']],
          },
          {
            type: 'table',
            style: 'lines',
            header: false,
            align: 'right',
            widths: [120, 90],
            rows: fr
              ? [['Total HT', '975,00 €'], ['TVA 20 %', '195,00 €'], [{ md: '**Total TTC**' }, { md: '**1 170,00 €**' }]]
              : [['Subtotal', '$975.00'], ['Tax (8%)', '$78.00'], [{ md: '**Total**' }, { md: '**$1,053.00**' }]],
          },
          { md: fr ? '**Règlement** par virement : IBAN FR76 0000 0000 0000 0000 0000 000. Pénalités de retard : trois fois le taux d’intérêt légal ; indemnité forfaitaire de recouvrement : 40 €.' : '**Payment** by bank transfer: account 000000000, routing 000000000. Please quote the invoice number.', spacing: { before: 18 } },
          { text: fr ? 'Merci de votre confiance.' : 'Thank you for your business.' },
        ],
      }),
  },
  {
    id: 'thesis',
    sketch: ['gap', 'center', 'gap', 'title', 'subtitle', 'gap', 'center', 'center', 'gap', 'gap', 'center'],
    build: (fr) =>
      doc(fr, fr ? 'Mémoire' : 'Thesis', {
        theme: { name: 'classic' },
        page: { firstPage: true },
        footers: { default: [{ md: '{{page}}', align: 'center' }] },
        citationStyle: fr ? 'iso690' : 'apa',
        sources: [
          {
            id: 'Exemple2024',
            type: 'book',
            authors: [fr ? 'Durand, Claire' : 'Doe, Jane'],
            title: fr ? 'Un livre de référence sur le sujet' : 'A reference book on the subject',
            publisher: fr ? 'Presses universitaires' : 'University Press',
            place: fr ? 'Paris' : 'Oxford',
            year: '2024',
          },
        ],
        blocks: [
          { text: fr ? 'Université · Faculté · Département' : 'University · Faculty · Department', align: 'center', spacing: { before: 40, after: 120 } },
          { type: 'paragraph', style: 'title', text: fr ? 'Titre du mémoire' : 'Thesis title', align: 'center' },
          { type: 'paragraph', style: 'subtitle', text: fr ? 'Sous-titre éventuel' : 'Optional subtitle', align: 'center' },
          { content: [fr ? 'Mémoire présenté par ' : 'A thesis submitted by ', { type: 'field', name: 'author', bold: true }, fr ? '\nsous la direction de Prénom Nom' : '\nunder the supervision of First Last'], align: 'center', spacing: { before: 90 } },
          { md: fr ? 'Année universitaire 2026–2027' : 'Academic year 2026–2027', align: 'center', spacing: { before: 120 } },
          { type: 'pagebreak' },
          { type: 'heading', level: 1, text: fr ? 'Résumé' : 'Abstract' },
          { text: fr ? 'Le sujet, la question de recherche, la méthode et les principaux résultats, en 200 à 300 mots.' : 'The topic, the research question, the method and the main findings, in 200 to 300 words.', align: 'justify' },
          { md: fr ? '**Mots-clés :** premier, deuxième, troisième.' : '**Keywords:** first, second, third.' },
          { type: 'pagebreak' },
          { type: 'toc', levels: 3, title: fr ? 'Table des matières' : 'Contents' },
          { type: 'pagebreak' },
          { type: 'heading', level: 1, text: 'Introduction' },
          { content: [fr ? 'Le contexte et l’état de la question, appuyés sur les travaux existants ' : 'The background and what is already known, based on earlier work ', { type: 'cite', id: 'Exemple2024', locator: fr ? 'p. 12' : 'p. 12' }, fr ? '. La problématique et le plan suivent.' : '. The research question and outline follow.'], align: 'justify' },
          { type: 'heading', level: 1, text: fr ? 'Chapitre 1 : Cadre théorique' : 'Chapter 1: Theoretical framework' },
          { type: 'heading', level: 2, text: fr ? '1.1 Première notion' : '1.1 First concept' },
          { md: fr ? 'Définitions et discussion.^[Une note de bas de page pour une précision.]' : 'Definitions and discussion.^[A footnote for a detail.]', align: 'justify' },
          { type: 'heading', level: 1, text: fr ? 'Chapitre 2 : Méthode' : 'Chapter 2: Method' },
          { text: fr ? 'Le terrain, les données, les outils d’analyse.' : 'The setting, the data, the analysis tools.', align: 'justify' },
          { type: 'heading', level: 1, text: fr ? 'Chapitre 3 : Résultats et discussion' : 'Chapter 3: Results and discussion' },
          { text: fr ? 'Les résultats, puis leur interprétation.' : 'The results, then what they mean.', align: 'justify' },
          { type: 'heading', level: 1, text: 'Conclusion' },
          { text: fr ? 'La réponse à la question, les limites et les pistes de recherche.' : 'The answer to the question, the limits and further research.', align: 'justify' },
          { type: 'heading', level: 1, text: fr ? 'Bibliographie' : 'References' },
          { type: 'bibliography', title: '' },
        ],
      }),
  },
  {
    id: 'recipe',
    sketch: ['title', 'subtitle', 'gap', 'cols', 'cols', 'cols', 'h', 'list', 'list', 'list', 'list', 'gap', 'text'],
    build: (fr) =>
      doc(fr, fr ? 'Recette' : 'Recipe', {
        theme: { name: 'folio' },
        blocks: [
          { type: 'paragraph', style: 'title', text: fr ? 'Tarte aux pommes' : 'Apple pie' },
          { type: 'paragraph', style: 'subtitle', text: fr ? 'Pour 6 personnes · Préparation 20 min · Cuisson 35 min' : 'Serves 6 · Prep 20 min · Bake 35 min' },
          {
            type: 'columns',
            count: 2,
            rule: true,
            blocks: [
              { type: 'heading', level: 2, text: fr ? 'Ingrédients' : 'Ingredients' },
              { type: 'list', bullet: '✓', items: fr ? ['1 pâte brisée', '5 pommes', '50 g de sucre', '30 g de beurre', '1 sachet de sucre vanillé'] : ['1 pie crust', '5 apples', '1/4 cup sugar', '2 tbsp butter', '1 tsp vanilla sugar'] },
              { type: 'columnbreak' },
              { type: 'heading', level: 2, text: fr ? 'Matériel' : 'Equipment' },
              { type: 'list', items: fr ? ['Un moule à tarte de 28 cm', 'Un économe', 'Un four à 180 °C'] : ['A 9-inch pie dish', 'A peeler', 'An oven at 350 °F'] },
            ],
          },
          { type: 'heading', level: 2, text: fr ? 'Étapes' : 'Steps' },
          {
            type: 'list',
            style: 'number',
            items: fr
              ? ['Préchauffez le four à 180 °C.', 'Étalez la pâte dans le moule et piquez le fond à la fourchette.', 'Épluchez les pommes, coupez-les en fines lamelles et disposez-les en rosace.', 'Saupoudrez de sucre, ajoutez le beurre en morceaux.', 'Enfournez 35 minutes, jusqu’à ce que les pommes soient dorées.']
              : ['Preheat the oven to 350 °F.', 'Line the dish with the crust and prick the bottom with a fork.', 'Peel the apples, slice them thinly and lay them in a circle.', 'Sprinkle with sugar and dot with butter.', 'Bake for 35 minutes, until the apples are golden.'],
          },
          { type: 'quote', md: fr ? '**Astuce :** servez tiède, avec une boule de glace à la vanille.' : '**Tip:** serve warm, with a scoop of vanilla ice cream.' },
        ],
      }),
  },
  {
    id: 'worksheet',
    sketch: ['short', 'rule', 'title', 'text', 'h', 'text', 'center', 'text', 'h', 'text', 'table', 'table', 'h', 'text', 'text'],
    build: (fr) =>
      doc(fr, fr ? 'Fiche d’exercices' : 'Worksheet', {
        theme: { name: 'folio' },
        footers: pageFooter(fr),
        blocks: [
          { text: fr ? 'Nom : ____________________   Classe : ________   Date : ____________' : 'Name: ____________________   Class: ________   Date: ____________' },
          { type: 'divider' },
          { type: 'paragraph', style: 'title', text: fr ? 'Fiche d’exercices : les fonctions' : 'Worksheet: functions' },
          { md: fr ? '*Durée : 30 minutes. Calculatrice autorisée. Justifiez chaque réponse.*' : '*Time: 30 minutes. Calculators allowed. Show your work.*' },
          { type: 'heading', level: 2, text: fr ? 'Exercice 1' : 'Exercise 1' },
          { md: fr ? 'Soit la fonction $f$ définie sur $\\R$ par :' : 'Let $f$ be the function defined on $\\R$ by:' },
          { type: 'equation', tex: 'f(x) = 2x^2 - 3x + 1' },
          { type: 'list', style: 'number', numbering: 'alpha', items: (fr ? ['Calculez $f(0)$ et $f(2)$.', 'Résolvez $f(x) = 0$.', 'Dressez le tableau de variations de $f$.'] : ['Compute $f(0)$ and $f(2)$.', 'Solve $f(x) = 0$.', 'Draw the variation table of $f$.']).map((md) => ({ md })) },
          { type: 'heading', level: 2, text: fr ? 'Exercice 2' : 'Exercise 2' },
          { md: fr ? 'Complétez le tableau de valeurs de $g(x) = x^2$.' : 'Fill in the table of values of $g(x) = x^2$.' },
          { type: 'table', style: 'grid', firstColumn: true, rows: [[{ md: '$x$' }, '−2', '−1', '0', '1', '2'], [{ md: '$g(x)$' }, '', '', '', '', '']] },
          { type: 'heading', level: 2, text: fr ? 'Exercice 3' : 'Exercise 3' },
          { text: fr ? 'Expliquez avec vos mots ce qu’est une fonction croissante.' : 'Explain in your own words what an increasing function is.' },
          { text: '______________________________________________________________________' },
          { text: '______________________________________________________________________' },
        ],
      }),
  },
]

export const templateById = (id: string): Template | undefined => TEMPLATES.find((t) => t.id === id)
