// Types du format de document Folio Pages (forme complète, canonique).
//
// C'est la forme que l'application écrit dans le bloc #folio-doc. À la
// lecture, l'application accepte aussi une forme compacte (champs par défaut
// omis, raccourcis texte) : voir spec.ts et normalize.ts.
//
// Les mises en forme facultatives (alignement, couleur, police…) sont absentes
// quand elles ne sont pas définies : le texte suit alors son style. « Absent »
// n'est donc pas « valeur par défaut », et la forme complète ne les écrit pas.

export const FORMAT = 'folio/doc'
export const FORMAT_VERSION = 1

/** Puces, numéros, ou cases à cocher (liste de tâches). */
export type ListStyle = 'bullet' | 'number' | 'check'

/** Couleurs du thème, utilisables partout où une couleur est attendue. */
export const THEME_COLORS = ['text', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const
export type ThemeColor = (typeof THEME_COLORS)[number]

/** Surlignages nommés (comme les surligneurs) ; une couleur #rrggbb est aussi acceptée. */
export const HIGHLIGHTS = ['yellow', 'green', 'cyan', 'pink', 'blue', 'red', 'orange', 'purple', 'gray'] as const

/** Polices du thème : une marque `font` peut y renvoyer au lieu de nommer une famille. */
export const THEME_FONTS = ['heading', 'body', 'mono'] as const
export type ThemeFont = (typeof THEME_FONTS)[number]

/** Mises en forme sans valeur (présentes ou absentes). */
export const RUN_FLAGS = ['bold', 'italic', 'underline', 'strike', 'code', 'sup', 'sub', 'caps', 'smallcaps', 'outline', 'shadow'] as const
export type RunFlag = (typeof RUN_FLAGS)[number]

/** Mises en forme avec une valeur, dans l'ordre d'écriture. */
export const RUN_VALUES = ['link', 'color', 'highlight', 'font', 'size', 'letterSpacing', 'lang', 'underlineStyle', 'underlineColor', 'textBorder', 'textShading', 'glow'] as const

/** Styles de soulignement (en plus du trait simple). */
export const UNDERLINE_STYLES = ['double', 'thick', 'dotted', 'dashed', 'wavy'] as const
export type UnderlineStyle = (typeof UNDERLINE_STYLES)[number]
export type RunValue = (typeof RUN_VALUES)[number]

export interface Marks {
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  code?: true
  sup?: true
  sub?: true
  /** Affiché en capitales (le texte n'est pas modifié). */
  caps?: true
  /** Petites capitales. */
  smallcaps?: true
  link?: string
  /** #rrggbb ou couleur du thème. */
  color?: string
  /** Surlignage nommé ou #rrggbb. */
  highlight?: string
  /** Famille de police, ou police du thème (heading, body, mono). */
  font?: string
  /** Taille en points. */
  size?: number
  /** Espacement des caractères en points (négatif : resserré). */
  letterSpacing?: number
  /** Langue du passage (correction orthographique, césure). */
  lang?: string
  /** Style du soulignement (trait simple s'il est absent). */
  underlineStyle?: UnderlineStyle
  /** Couleur du soulignement (celle du texte s'il est absent). */
  underlineColor?: string
  /** Lettres évidées (contour). */
  outline?: true
  /** Ombre portée du texte. */
  shadow?: true
  /** Halo lumineux autour du texte : sa couleur. */
  glow?: string
  /** Bordure autour du texte : sa couleur. */
  textBorder?: string
  /** Trame de fond du texte (distincte du surlignage) : sa couleur. */
  textShading?: string
  /** Commentaires qui portent sur ce texte : leurs identifiants (voir FolioDoc.comments), triés. */
  comments?: string[]
  /** Suivi des modifications : texte ajouté (en attente d'acceptation). */
  inserted?: Change
  /** Suivi des modifications : texte supprimé (encore visible jusqu'à acceptation). */
  deleted?: Change
  /** Suivi des modifications : mise en forme changée ; `before`, celle d'avant (accepter garde la nouvelle). */
  formatChange?: FormatChange
}

/** Mise en forme de caractères changée pendant le suivi. */
export interface FormatChange extends Change {
  before: Marks
}

/** Mise en forme de paragraphe d'avant une modification suivie (avec le type de bloc, le niveau et le style). */
export interface ParaBefore extends Omit<ParaProps, 'ink' | 'formatChange'> {
  kind?: 'paragraph' | 'heading'
  level?: number
  style?: string
}

/** Mise en forme de paragraphe changée pendant le suivi. */
export interface ParaChange extends Change {
  before: ParaBefore
}

/** Qui a fait une modification suivie, et quand (date ISO 8601, ou vide). */
export interface Change {
  author: string
  date: string
}

/** Identifiant d'un commentaire. */
export const COMMENT_ID = /^[A-Za-z0-9_-]{1,64}$/

/** Une réponse dans un fil de commentaires. */
export interface CommentReply {
  author: string
  /** Date ISO 8601, ou vide si inconnue. */
  date: string
  text: string
}

/**
 * Un fil de commentaires. Il porte sur le texte marqué par son identifiant ;
 * si ce texte est supprimé, le fil reste (« sur du texte supprimé ») jusqu'à
 * ce qu'on le supprime.
 */
export interface CommentThread extends CommentReply {
  id: string
  resolved: boolean
  replies: CommentReply[]
}

/** Un morceau de texte et sa mise en forme. Un « \n » dans `text` est un retour à la ligne. */
export interface Run extends Marks {
  text: string
}

/** Champs : valeurs calculées à l'affichage ({{page}}, {{date}}…). */
export const FIELD_NAMES = [
  'title',
  'author',
  'subject',
  'organization',
  'keywords',
  'date',
  'time',
  'created',
  'modified',
  'page',
  'pages',
  'filename',
] as const
export type FieldName = (typeof FIELD_NAMES)[number]

export interface FieldInline extends Marks {
  type: 'field'
  name: FieldName
  /** Format de date ou d'heure (DD/MM/YYYY, HH:mm…) ; vide : format usuel de la langue. */
  format: string
}

/** Note de bas de page (ou de fin) : son appel dans le texte et son contenu. */
export interface NoteInline {
  type: 'note'
  kind: 'foot' | 'end'
  blocks: Block[]
}

/**
 * Formule LaTeX en ligne ($…$), rendue en MathML. Sa mise en forme est dans
 * le LaTeX (\textcolor, \mathbf…) : elle ne porte que des commentaires.
 */
export interface MathInline {
  type: 'math'
  tex: string
  comments?: string[]
}

/** Ce qu'une formule garde des marques du texte autour : ses commentaires. */
export function mathMarks(m: { comments?: string[] }): { comments?: string[] } {
  return m.comments && m.comments.length ? { comments: [...m.comments] } : {}
}

/**
 * Champ de fusion (publipostage) : la valeur d'une colonne de la liste de
 * destinataires, ou un champ spécial (« @address », « @greeting », règles…)
 * dont les réglages sont dans `opts`.
 */
export interface MergeInline extends Marks {
  type: 'mergefield'
  name: string
  opts?: Record<string, string>
}

/** Champs spéciaux du publipostage. */
export const MERGE_SPECIALS = ['@address', '@greeting', '@record', '@sequence', '@next', '@nextif', '@skipif', '@if', '@fillin'] as const
/** Réglages admis d'un champ de fusion. */
export const MERGE_OPTS = ['field', 'op', 'value', 'then', 'else', 'prompt', 'default', 'salutation', 'nameFormat', 'punct', 'fallback', 'company', 'country', 'home'] as const
export const MERGE_OPS = ['eq', 'ne', 'lt', 'gt', 'le', 'ge', 'empty', 'notEmpty', 'contains'] as const

// --- références : légendes, signets, renvois, index, citations -------------------

/** Étiquettes de légende intégrées ; une étiquette personnelle est un texte libre. */
export const CAPTION_LABELS = ['figure', 'table', 'equation'] as const

/**
 * Numéro de légende (« Figure 3 ») : compté, par étiquette, dans l'ordre du
 * document. Le mot « Figure » est du texte ordinaire avant lui.
 */
export interface SeqInline extends Marks {
  type: 'seq'
  label: string
}

/** Nom de signet : une lettre (ou _), puis lettres, chiffres, _ ; 40 au plus. Commençant par _ : caché. */
/** Clé d'un document dans un fichier qui en contient plusieurs (liens « #clé:ancre », renvois). */
export const DOC_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/
export const BOOKMARK_NAME = /^[\p{L}_][\p{L}\p{N}_]{0,39}$/u

/** Signet : un point nommé du texte, cible des renvois et des liens « #nom ». */
export interface BookmarkInline {
  type: 'bookmark'
  name: string
}

/** Ce qu'un renvoi affiche de sa cible. */
export const XREF_SHOWS = ['text', 'label', 'number', 'page', 'above'] as const
export type XrefShow = (typeof XREF_SHOWS)[number]

/**
 * Renvoi vers un signet : le texte du paragraphe où il est, « Figure 3 »
 * (étiquette et numéro d'une légende), le numéro seul, le numéro de page, ou
 * « ci-dessus » / « ci-dessous ». Toujours à jour.
 */
export interface XrefInline extends Marks {
  type: 'xref'
  target: string
  show: XrefShow
  /** Clé d'un autre document du même fichier (le signet est dans ce document). */
  doc?: string
  /** Dernière valeur affichée (renvoi vers un autre document : sert tant qu'il n'a pas été mis en page). */
  last?: string
}

/** Catégories de la table des références (jurisprudence, lois…). */
export const AUTHORITY_CATEGORIES = ['cases', 'statutes', 'other', 'rules', 'treatises', 'regulations', 'constitution'] as const
export type AuthorityCategory = (typeof AUTHORITY_CATEGORIES)[number]

/**
 * Entrée d'index (invisible) : le terme, et éventuellement un sous-terme. Avec
 * `authority`, c'est une entrée de la table des références : `term` est la
 * citation complète, `short` sa forme courte.
 */
export interface IndexInline {
  type: 'xe'
  term: string
  sub?: string
  /** Renvoi « Voir … » au lieu des numéros de page. */
  see?: string
  bold?: true
  italic?: true
  authority?: AuthorityCategory
  short?: string
}

/** Citation d'une ou plusieurs sources (FolioDoc.sources), mise en forme selon le style choisi. */
export interface CiteInline extends Marks {
  type: 'cite'
  ids: string[]
  /** Précision : page, chapitre… (« p. 12 »). */
  locator?: string
}

/** Champs de formulaire (onglet Développeur) : texte, liste déroulante, date, case à cocher. */
export const FORM_KINDS = ['text', 'dropdown', 'date', 'checkbox'] as const
export type FormKind = (typeof FORM_KINDS)[number]

/** Un champ de formulaire à remplir ; sa valeur est gardée dans le document. */
export interface FormInline extends Marks {
  type: 'formfield'
  kind: FormKind
  /** Nom (identifiant du champ, « Nom », « Date de naissance »…). */
  name?: string
  /** Texte saisi, choix de la liste, ou date AAAA-MM-JJ. */
  value?: string
  /** Liste déroulante : les choix. */
  options?: string[]
  /** Case à cocher : cochée. */
  checked?: true
  /** Texte d'aide quand le champ est vide. */
  placeholder?: string
}

/** Élément en ligne : du texte, ou un objet (champ, note, formule…) qui en tient lieu. */
/**
 * Fichier joint (Insertion → Objet) : ses octets dans les ressources du document,
 * toujours en « application/octet-stream » (jamais affiché ni exécuté, seulement
 * enregistré sur l'ordinateur) ; son type d'origine à part, pour l'information.
 */
export interface AttachmentInline {
  type: 'attachment'
  /** « asset:<id> » (ou, à l'entrée, une URI data:application/octet-stream;base64,…). */
  src: string
  /** Nom du fichier, sans chemin. */
  name: string
  /** Taille en octets. */
  size?: number
  /** Type d'origine (« application/pdf »…). */
  mime?: string
}

export type Inline = Run | FieldInline | NoteInline | MathInline | MergeInline | SeqInline | BookmarkInline | XrefInline | IndexInline | CiteInline | FormInline | AttachmentInline

/** Éléments en ligne qui ne montrent rien d'eux-mêmes (signet, entrée d'index). */
export const isHiddenInline = (x: Inline): boolean => 'type' in x && (x.type === 'bookmark' || x.type === 'xe')

export const isRun = (x: Inline): x is Run => !('type' in x)

export type Align = 'left' | 'center' | 'right' | 'justify'

/** Mise en forme d'un paragraphe. Retraits et espacements en points. */
export interface ParaProps {
  align?: Align
  indent?: { left?: number; right?: number; first?: number }
  spacing?: { before?: number; after?: number }
  /** Interligne, en multiple de la hauteur de ligne (1, 1.15, 1.5, 2…). */
  line?: number
  keepNext?: true
  keepLines?: true
  pageBreakBefore?: true
  /** Trame de fond du paragraphe. */
  shading?: string
  /** Bordure autour du paragraphe (couleur). */
  border?: string
  /** Lettrine : la première lettre occupe ce nombre de lignes (2 à 10). */
  dropCap?: number
  /** Dessin à main levée (onglet Dessin), placé par rapport au coin haut gauche du paragraphe. */
  ink?: InkStroke[]
  /** Sens d'écriture : de droite à gauche (arabe, hébreu…) ou forcé de gauche à droite ; absent : selon le texte. */
  dir?: 'rtl' | 'ltr'
  /** Sans numéros de ligne (ses lignes ne comptent pas). */
  noLineNumbers?: true
  /** Suivi des modifications : mise en forme du paragraphe changée. */
  formatChange?: ParaChange
}

/** Un trait de dessin : stylo ou surligneur ; points en points typographiques (x, y, x, y…). */
export interface InkStroke {
  tool: 'pen' | 'highlighter'
  color: string
  /** Épaisseur en points. */
  width: number
  points: number[]
}

export const INK_LIMITS = { strokes: 200, points: 4000, coord: 3000 }

export const PARA_KEYS = ['align', 'indent', 'spacing', 'line', 'keepNext', 'keepLines', 'pageBreakBefore', 'shading', 'border', 'dropCap', 'ink', 'dir', 'noLineNumbers'] as const

export interface ListItem extends ParaProps {
  content: Inline[]
  /** 0 pour le premier niveau, jusqu'à 8. */
  level: number
  /** Style de la liste à laquelle appartient l'élément. */
  style: ListStyle
  /** Liste à cocher : la case est cochée. */
  checked?: true
}

/** Numérotation : « default » alterne 1. a. i. selon le niveau ; « outline » donne 1.1.1. */
export const NUMBERINGS = ['default', 'decimal', 'alpha', 'ALPHA', 'roman', 'ROMAN', 'outline'] as const
export type Numbering = (typeof NUMBERINGS)[number]

export const TABLE_STYLES = ['grid', 'lines', 'zebra', 'boxed', 'minimal'] as const
export type TableStyle = (typeof TABLE_STYLES)[number]

export interface TableCell {
  blocks: Block[]
  colspan: number
  rowspan: number
  /** Couleur de fond. */
  bg?: string
  valign?: 'top' | 'middle' | 'bottom'
  /** Texte vertical : de haut en bas (tbrl) ou de bas en haut (btlr). */
  textDir?: 'tbrl' | 'btlr'
}

export interface Crop {
  top: number
  right: number
  bottom: number
  left: number
}

export type Block =
  | ({ type: 'paragraph'; content: Inline[]; style?: string } & ParaProps)
  | ({ type: 'heading'; level: number; content: Inline[] } & ParaProps)
  | {
      type: 'list'
      style: ListStyle
      start: number
      items: ListItem[]
      numbering?: Numbering
      bullet?: string
      /** Reprend la numérotation de la liste numérotée précédente. */
      continue?: true
    }
  | { type: 'quote'; blocks: Block[] }
  /**
   * Encadré : une remarque mise à part (note, astuce, important, avertissement,
   * attention), avec un titre (celui du type s'il est absent).
   */
  | { type: 'callout'; kind: CalloutKind; title?: string; blocks: Block[] }
  | { type: 'code'; language: string; text: string }
  | {
      type: 'table'
      header: boolean
      /** Hauteur fixe de chaque ligne, en points (étiquettes) ; absente : selon le contenu. */
      rowHeight?: number
      rows: TableCell[][]
      style: TableStyle
      /** Largeur de chaque colonne en points. */
      widths?: number[]
      align?: 'left' | 'center' | 'right'
      firstColumn?: true
      /** Couleur des bordures. */
      border?: string
      /** La ligne d'en-tête est répétée en haut de chaque page où le tableau continue. */
      repeatHeader?: true
    }
  | { type: 'divider' }
  /** Graphique (barres, courbes, secteurs), avec ses propres données. */
  | ChartBlock
  | DiagramBlock
  /** Équation centrée ($$…$$) ; numérotée (1), (2)… si `numbered`. */
  | { type: 'equation'; tex: string; numbered?: true }
  | { type: 'pagebreak' }
  /** Texte en colonnes (équilibrées) ; un saut de colonne force la colonne suivante. */
  | { type: 'columns'; count: number; gap: number; rule: boolean; blocks: Block[] }
  | { type: 'columnbreak' }
  /** Table des matières, générée à partir des titres (toujours à jour). */
  | { type: 'toc'; levels: number; title: string }
  /** Table des illustrations : les légendes d'une étiquette (figure, table…), avec leur page. */
  | { type: 'figures'; label: string; title: string }
  /** Index : les entrées marquées (xe), par ordre alphabétique, avec leurs pages. */
  | { type: 'index'; columns: number; title: string }
  /** Table des références : les entrées marquées d'une catégorie (ou toutes). */
  | { type: 'authorities'; category: AuthorityCategory | 'all'; title: string }
  /** Bibliographie : les sources citées (ou toutes), dans le style de citation du document. */
  | { type: 'bibliography'; title: string; all?: true }
  /** Glossaire : les termes (FolioDoc.terms) employés dans le texte (ou tous), avec leur définition. */
  | { type: 'glossary'; title: string; all?: true }
  /** Liste des abréviations : les abréviations employées (ou toutes) et leur forme longue. */
  | { type: 'abbreviations'; title: string; all?: true }
  /**
   * Saut de section : la suite commence une nouvelle page (ou la prochaine page
   * impaire ou paire) et peut avoir sa numérotation, ses en-têtes et pieds de
   * page. Absents, ils continuent ceux de la section précédente.
   */
  | {
      type: 'section'
      start: 'page' | 'odd' | 'even'
      numberStart?: number
      numberFormat?: PageNumberFormat
      firstPage?: boolean
      headers?: HeaderSet
      footers?: HeaderSet
      /** Mise en page de la section (format, orientation, marges) ; absente : celle de la section précédente. */
      page?: SectionPage
    }
  | {
      type: 'image'
      /** « asset:id » (image du document), ou adresse https:// non chargée. */
      src: string
      alt: string
      /** Largeur en points ; 0 : taille naturelle, limitée à la largeur du texte. */
      width: number
      /** Hauteur en points, seulement si l'image est déformée exprès (sinon ses proportions sont gardées). */
      height?: number
      align: 'left' | 'center' | 'right'
      /**
       * none : seule sur sa ligne ; left / right : flottante, le texte l'habille ;
       * tight / through : le texte suit son contour (côté : align) ; behind / front : derrière ou devant le texte.
       */
      wrap: 'none' | 'left' | 'right' | 'tight' | 'through' | 'behind' | 'front'
      caption: Inline[]
      /** Rognage en pourcentage de chaque côté. */
      crop?: Crop
      rotate?: 90 | 180 | 270
      flip?: 'h' | 'v' | 'hv'
      border?: string
      /** Retouches : couleurs, transparence, ombre, halo, bords adoucis. */
      adjust?: PictureAdjust
    }

/** Retouches d'une image. Absentes : l'image telle quelle. */
export interface PictureAdjust {
  /** Luminosité, −100 à 100 %. */
  brightness?: number
  /** Contraste, −100 à 100 %. */
  contrast?: number
  /** Saturation, 0 (gris) à 400 % ; 100 : inchangée. */
  saturation?: number
  /** Recoloration : niveaux de gris, sépia, délavée, noir et blanc. */
  recolor?: 'grayscale' | 'sepia' | 'washout' | 'blackwhite'
  /** Effet artistique : flou, crayon, négatif. */
  artistic?: 'blur' | 'pencil' | 'negative'
  /** Transparence, 0 à 95 %. */
  transparency?: number
  /** Ombre portée. */
  shadow?: true
  /** Halo autour de l'image : sa couleur. */
  glow?: string
  /** Bords adoucis, en points. */
  softEdges?: number
  /** Reflet sous l'image : la part de sa hauteur reflétée, 10 à 100 %. */
  reflection?: number
}

/** Types d'encadré (les mêmes que les alertes Markdown de GitHub). */
export const CHART_KINDS = ['bar', 'line', 'pie'] as const
export type ChartKind = (typeof CHART_KINDS)[number]
/** Une série : un nom (la légende) et une valeur par étiquette (null : pas de valeur). */
export interface ChartSeries {
  name: string
  values: (number | null)[]
}
/** Graphique : des étiquettes (catégories), et une ou plusieurs séries de valeurs. Secteurs : la première série. */
export interface ChartBlock {
  type: 'chart'
  kind: ChartKind
  title?: string
  labels: string[]
  series: ChartSeries[]
  /** Légende (par défaut : oui, quand il y a plusieurs séries ou des secteurs). */
  legend?: false
  /** Barres horizontales (sinon verticales). */
  horizontal?: true
}

/** Un élément de diagramme : son texte et son niveau (0 : premier niveau). */
export interface DiagramItem {
  text: string
  level: number
}

/** Diagramme : une liste mise en forme (liste, processus, cycle, hiérarchie, pyramide, radial). */
export interface DiagramBlock {
  type: 'diagram'
  kind: import('./diagram').DiagramKind
  items: DiagramItem[]
  title?: string
  /** 'colorful' (une couleur du thème par élément, par défaut) ou une couleur du thème pour tous. */
  color?: (typeof import('./diagram').DIAGRAM_COLORS)[number]
}

export const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const
export type CalloutKind = (typeof CALLOUT_KINDS)[number]

/** Blocs contenus dans un bloc conteneur (citation, encadré, colonnes), sinon null. */
export const innerBlocks = (b: Block): Block[] | null => (b.type === 'quote' || b.type === 'callout' || b.type === 'columns' ? b.blocks : null)

export type BlockType = Block['type']
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>

export interface Meta {
  title: string
  author: string
  subject: string
  organization: string
  keywords: string[]
  lang: string
  created: string
  modified: string
}

export interface Theme {
  name: string
  colors: Record<ThemeColor, string>
  fonts: Record<ThemeFont, string>
  /** Couleurs de la coloration syntaxique des extraits de code. */
  code: Record<CodeColor, string>
}

export const CODE_COLORS = ['background', 'text', 'keyword', 'string', 'number', 'comment', 'function', 'type'] as const
export type CodeColor = (typeof CODE_COLORS)[number]

/** Définition (ou modification) d'un style nommé. */
export interface StyleDef {
  /** Nom affiché ; obligatoire pour un style personnel. */
  name?: string
  basedOn?: string
  /** Style du paragraphe suivant (Entrée en fin de paragraphe). */
  next?: string
  font?: string
  size?: number
  color?: string
  highlight?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  caps?: boolean
  smallcaps?: boolean
  letterSpacing?: number
  align?: Align
  indent?: { left?: number; right?: number; first?: number }
  spacing?: { before?: number; after?: number }
  line?: number
  keepNext?: boolean
  keepLines?: boolean
  pageBreakBefore?: boolean
  shading?: string
  border?: string
}

/** Police intégrée au document. */
export interface FontFace {
  family: string
  /** « asset:id » */
  src: string
  weight: number
  italic: boolean
  /** Caractères couverts (« U+0000-00FF, U+0131 ») : une police découpée en sous-ensembles. */
  unicodeRange?: string
}

/** Liste de plages Unicode d'une règle @font-face. */
export const UNICODE_RANGE = /^U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?(,\s*U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?)*$/

/** Formats de papier connus, en millimètres (portrait). */
export const PAPER_SIZES: Record<string, [number, number]> = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  B5: [176, 250],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  Tabloid: [279.4, 431.8],
  Executive: [184.15, 266.7],
}

export const PAGE_NUMBER_FORMATS = ['decimal', 'roman', 'ROMAN', 'alpha', 'ALPHA'] as const
export type PageNumberFormat = (typeof PAGE_NUMBER_FORMATS)[number]

/** Mise en page du document. Longueurs en millimètres. */
/** Ce qu'une section peut changer de la mise en page. */
export interface SectionPage {
  size: string
  width: number
  height: number
  orientation: 'portrait' | 'landscape'
  margins: { top: number; right: number; bottom: number; left: number }
}

export interface PageSetup {
  /** A4, Letter… ou « custom » (largeur et hauteur données). */
  size: string
  /** Dimensions du papier en portrait. */
  width: number
  height: number
  orientation: 'portrait' | 'landscape'
  margins: { top: number; right: number; bottom: number; left: number }
  /** Distance de l'en-tête au bord du haut, du pied de page au bord du bas. */
  header: number
  footer: number
  /** En-tête et pied de page différents sur la première page. */
  firstPage: boolean
  /** En-tête et pied de page différents sur les pages paires. */
  evenOdd: boolean
  /** Numéro de la première page. */
  numberStart: number
  numberFormat: PageNumberFormat
  /** Couleur de la page. */
  background?: string
  /** Bordure de la page (couleur). */
  border?: string
}

/** En-têtes ou pieds de page : celui de toutes les pages, de la première, des pages paires. */
export interface HeaderSet {
  default: Block[]
  first: Block[]
  even: Block[]
}

/** Numérotation des notes : chiffres, romains, lettres ou symboles (*, †, ‡…). */
export const NOTE_FORMATS = ['decimal', 'roman', 'ROMAN', 'alpha', 'ALPHA', 'symbols'] as const
export type NoteFormat = (typeof NOTE_FORMATS)[number]
/** Recommencer la numérotation : jamais, à chaque section, à chaque page (notes de bas de page). */
export const NOTE_RESTARTS = ['continuous', 'section', 'page'] as const
export type NoteRestart = (typeof NOTE_RESTARTS)[number]

export interface NoteKindSettings {
  format: NoteFormat
  start: number
  restart: NoteRestart
}

export interface NoteSettings {
  foot: NoteKindSettings
  end: NoteKindSettings
}

export const defaultNotes = (): NoteSettings => ({
  foot: { format: 'decimal', start: 1, restart: 'continuous' },
  end: { format: 'roman', start: 1, restart: 'continuous' },
})

/** Champs d'adresse standard, reliés aux colonnes de la liste (« faire correspondre les champs »). */
export const ADDRESS_FIELDS = ['title', 'first', 'last', 'company', 'address1', 'address2', 'city', 'state', 'postal', 'country', 'email', 'phone'] as const
export type AddressField = (typeof ADDRESS_FIELDS)[number]

export const MERGE_TYPES = ['letters', 'emails', 'envelopes', 'labels', 'directory'] as const
export type MergeType = (typeof MERGE_TYPES)[number]

/** Liste de destinataires, gardée dans le document. */
export interface MergeSource {
  /** Nom d'origine (fichier importé) ou nom donné. */
  name: string
  fields: string[]
  records: string[][]
  /** Lignes décochées (indices dans `records`). */
  excluded?: number[]
}

export interface MergeFilter {
  field: string
  op: (typeof MERGE_OPS)[number]
  value?: string
}

/** Planche d'étiquettes, en millimètres. */
export interface LabelSheet {
  name: string
  pageWidth: number
  pageHeight: number
  cols: number
  rows: number
  width: number
  height: number
  top: number
  left: number
  hgap: number
  vgap: number
}

export interface MailMerge {
  type: MergeType
  source?: MergeSource
  /** Colonne de chaque champ d'adresse standard. */
  map?: Partial<Record<AddressField, string>>
  filters?: MergeFilter[]
  sort?: { field: string; desc?: boolean }
  /** Messages électroniques : la colonne du destinataire et l'objet (avec «Champs»). */
  email?: { to: string; subject: string }
  label?: LabelSheet
  /** Enveloppe : taille (mm) et adresse de l'expéditeur. */
  envelope?: { name: string; width: number; height: number; returnAddress: string }
}

/** Réglages des équations : macros LaTeX communes à tout le document. */
export interface MathSettings {
  /** \newcommand, \DeclareMathOperator… lus avant chaque formule. */
  macros: string
}

export const defaultMath = (): MathSettings => ({ macros: '' })

// --- sources et citations ---------------------------------------------------------

export const SOURCE_TYPES = ['book', 'article', 'chapter', 'website', 'report', 'thesis', 'conference', 'film', 'interview', 'other'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

/** Identifiant d'une source (comme une « balise ») : lettres, chiffres, _ : . - */
export const SOURCE_ID = /^[\p{L}\p{N}_:.-]{1,64}$/u

/** Une source citée : livre, article, site… Les auteurs s'écrivent « Nom, Prénom » (ou un organisme). */
export interface Source {
  id: string
  type: SourceType
  authors: string[]
  title: string
  /** Revue, ouvrage collectif, site, conférence… */
  container?: string
  editors?: string[]
  publisher?: string
  place?: string
  /** Année (ou date ISO). */
  year?: string
  volume?: string
  issue?: string
  pages?: string
  edition?: string
  url?: string
  doi?: string
  isbn?: string
  /** Date de consultation (sites), ISO 8601. */
  accessed?: string
  note?: string
}

export const CITATION_STYLES = ['apa', 'mla', 'chicago', 'chicago-notes', 'harvard', 'ieee', 'vancouver', 'iso690'] as const
export type CitationStyle = (typeof CITATION_STYLES)[number]

/** Numéros de ligne dans la marge de gauche. */
export interface LineNumbers {
  /** Recommencer la numérotation : jamais, à chaque page, à chaque section. */
  restart: 'continuous' | 'page' | 'section'
  /** Premier numéro. */
  start: number
  /** Un numéro affiché toutes les n lignes (5 : 5, 10, 15…), les autres lignes comptent. */
  countBy: number
  /** Distance au texte en points ; absent : automatique (18 pt). */
  distance?: number
}
export const LINE_NUMBER_RESTARTS = ['continuous', 'page', 'section'] as const

export interface FolioDoc {
  format: typeof FORMAT
  version: number
  id: string
  meta: Meta
  page: PageSetup
  headers: HeaderSet
  footers: HeaderSet
  /** Numérotation des notes de bas de page et de fin. */
  notes: NoteSettings
  /** Équations : macros communes. */
  math: MathSettings
  /** Publipostage : type de document principal, liste de destinataires, réglages. */
  mailMerge?: MailMerge
  theme: Theme
  /** Styles modifiés et styles personnels ; un style intégré absent garde sa définition. */
  styles: Record<string, StyleDef>
  fonts: FontFace[]
  blocks: Block[]
  /** Fils de commentaires, ancrés dans le texte par leur identifiant. */
  comments: CommentThread[]
  /** Suivi des modifications activé (les ajouts et suppressions sont marqués). */
  trackChanges: boolean
  /** Césure automatique (coupure des mots en fin de ligne, selon la langue). */
  hyphenate?: true
  /** Numéros de ligne dans la marge (vue page, impression, PDF). */
  lineNumbers?: LineNumbers
  /** Filigrane derrière le texte de chaque page. */
  watermark?: Watermark
  /** Objectif d'écriture : un nombre de mots, et une date limite (AAAA-MM-JJ) facultative. */
  goal?: WritingGoal
  /** Modèle : chaque ouverture commence un nouveau document à partir de celui-ci. */
  template: boolean
  /** Copie en lecture seule : s'ouvre en lecture, sans modification. */
  readOnly: boolean
  /** Images et polices du document, en URI data:, désignées par « asset:id ». */
  assets: Record<string, string>
  /** Sources citées (citations, bibliographie). */
  sources?: Source[]
  /** Style des citations et de la bibliographie. */
  citationStyle?: CitationStyle
  /** Termes du glossaire et abréviations, définis une fois, retrouvés dans le texte. */
  terms?: Term[]
  /** Formulaire protégé : seuls les champs de formulaire se remplissent. */
  formsOnly?: true
  /** Plusieurs documents dans le fichier : la clé de celui-ci (liens « #clé:ancre », renvois). */
  key?: string
  /** Les autres documents du fichier (seulement dans le premier), chacun complet et indépendant. */
  documents?: FolioDoc[]
}

/** Un terme du glossaire (avec sa définition) ou une abréviation (avec sa forme longue). */
export interface Term {
  id: string
  term: string
  definition: string
  kind: 'glossary' | 'abbreviation'
  /** Pluriel, s'il ne suit pas la règle (« critères », « données »). */
  plural?: string
}

export interface WritingGoal {
  words: number
  deadline?: string
}

/** Filigrane : un texte (BROUILLON, CONFIDENTIEL…) ou une image, derrière le texte de chaque page. */
export interface Watermark {
  /** Le texte (60 caractères au plus) ; absent si c'est une image. */
  text?: string
  /** L'image (« asset:id ») ; absente si c'est un texte. */
  image?: string
  /** Couleur du texte (thème ou #rrggbb). */
  color: string
  /** En diagonale (sinon horizontal). */
  diagonal: boolean
  /** Opacité en pour cent (5 à 100). */
  opacity: number
  /** Taille du texte en points ; 0 : la plus grande qui tient dans la page. */
  size: number
  /** Largeur de l'image en pour cent de la largeur du texte (10 à 100). */
  scale: number
}

export const defaultWatermark = (): Watermark => ({ color: '#9aa0a6', diagonal: true, opacity: 35, size: 0, scale: 70 })

export const defaultPage = (): PageSetup => ({
  size: 'A4',
  width: 210,
  height: 297,
  orientation: 'portrait',
  margins: { top: 25, right: 22, bottom: 25, left: 22 },
  header: 12.5,
  footer: 12.5,
  firstPage: false,
  evenOdd: false,
  numberStart: 1,
  numberFormat: 'decimal',
})

export const emptyHeaders = (): HeaderSet => ({ default: [], first: [], even: [] })

export const emptyMeta = (): Meta => ({
  title: '',
  author: '',
  subject: '',
  organization: '',
  keywords: [],
  lang: '',
  created: '',
  modified: '',
})

/** Identifiant de document : aléatoire, jamais régénéré une fois écrit dans un fichier. */
export function mintId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let s = ''
  for (const b of bytes) s += alphabet[b & 63]
  return s
}

export const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/
/** Identifiants de styles et de ressources. */
export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

export const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)
