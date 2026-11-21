// Tables de validation du format Folio Pages, version 1.
//
// Ces tables décrivent tout ce que l'application accepte à la lecture, forme
// complète et forme compacte. Le JSON Schema publié (window.folio.schema(),
// docs/schema/folio-1.json) en est généré : modifier le format, c'est modifier
// ce fichier. Les descriptions sont en anglais car elles sont destinées aux IA.

import { isColor, isFontName, isHexColor, isHighlight } from './color'
import { arr, bool, either, enumOf, int, map, num, obj, ref, str, tagged, type Desc, type Limits, type TagResolution } from './dsl'
import { resolveFieldName } from './fields'
import { CHART_LIMITS } from './chart'
import { DIAGRAM_COLORS, DIAGRAM_KINDS, DIAGRAM_LIMITS } from './diagram'
import { CALLOUT_KINDS, CHART_KINDS, FORM_KINDS, INK_LIMITS, UNDERLINE_STYLES, UNICODE_RANGE, AUTHORITY_CATEGORIES, BOOKMARK_NAME, DOC_KEY, CITATION_STYLES, SOURCE_ID, SOURCE_TYPES, XREF_SHOWS, CODE_COLORS, COMMENT_ID, FIELD_NAMES, ID_PATTERN, KEY_PATTERN, NOTE_FORMATS, NOTE_RESTARTS, NUMBERINGS, PAGE_NUMBER_FORMATS, PAPER_SIZES, TABLE_STYLES, THEME_COLORS, MERGE_OPS, MERGE_TYPES, ADDRESS_FIELDS } from './types'

export const LIMITS = {
  /** Taille maximale du JSON du document, en caractères. */
  jsonChars: 80_000_000,
  text: 1_000_000,
  markdown: 5_000_000,
  runs: 20_000,
  blocks: 100_000,
  documents: 50,
  listItems: 20_000,
  tableRows: 5_000,
  tableCols: 100,
  link: 2_048,
  /** Source LaTeX d'une formule ; macros communes du document. */
  tex: 20_000,
  mergeRecords: 10_000,
  mergeFields: 60,
  macros: 50_000,
  /** Une image ou une police, en URI data: (≈ 22 Mo de données). */
  asset: 30_000_000,
  assets: 2_000,
  styles: 200,
  fonts: 40,
}

export const VALIDATION_LIMITS: Limits = { maxDepth: 16, maxNodes: 1_000_000 }

/** Liens acceptés : web, courriel, téléphone et ancres. Jamais javascript:, data:, file:… */
export function isSafeLink(href: string): boolean {
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return false
  const s = href.trim()
  if (s.startsWith('//')) return false
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s)
  if (!scheme) return true // lien relatif ou ancre « #section »
  return ['http', 'https', 'mailto', 'tel'].includes(scheme[1].toLowerCase())
}

const IMAGE_TYPES = ['png', 'jpeg', 'jpg', 'gif', 'webp', 'svg+xml', 'avif', 'bmp']
const FONT_TYPES = ['woff2', 'woff', 'ttf', 'otf', 'sfnt']

/** URI data: en base64 d'un type accepté (images, polices), sans rien d'autre. */
export function dataUriType(s: string): 'image' | 'font' | 'file' | null {
  const m = /^data:([a-z]+)\/([a-z0-9.+-]+);base64,/i.exec(s.slice(0, 80))
  if (!m) return null
  const head = m[0].length
  // Vérification linéaire du base64 sans expression régulière sur 30 Mo.
  for (let i = head; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47 || c === 61
    if (!ok) return null
  }
  const [type, sub] = [m[1].toLowerCase(), m[2].toLowerCase()]
  if (type === 'image' && IMAGE_TYPES.includes(sub)) return 'image'
  if ((type === 'font' || type === 'application') && FONT_TYPES.some((f) => sub === f || sub === `font-${f}` || sub === `x-font-${f}`)) return 'font'
  // Fichier joint : toujours en octets bruts, que le navigateur n'affiche ni n'exécute.
  if (type === 'application' && sub === 'octet-stream') return 'file'
  return null
}

export const isAssetRef = (s: string): boolean => s.startsWith('asset:') && KEY_PATTERN.test(s.slice(6))

/** Fichier joint : ressource du document, ou URI data:application/octet-stream. */
export const isAttachmentSrc = (s: string): boolean => isAssetRef(s) || (s.startsWith('data:') && dataUriType(s) === 'file')

/** Nom d'un fichier joint : sans chemin ni caractère de contrôle. */
export const cleanFileName = (s: string): string =>
  s
    .replace(/^.*[\\/]/, '')
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .trim()
    .slice(0, 255)

/** Type d'origine d'un fichier joint (« application/pdf »), ou '' s'il n'est pas de cette forme. */
export const cleanMime = (s: string): string => (/^[a-z0-9][\w.+-]{0,63}\/[\w.+-]{1,100}$/i.test(s) ? s.toLowerCase() : '')

/** Source d'image : ressource du document, URI data: d'image, ou adresse web (jamais chargée sans accord). */
export function isImageSrc(s: string): boolean {
  if (isAssetRef(s)) return true
  if (s.startsWith('data:')) return dataUriType(s) === 'image'
  return /^https?:\/\/[^\s]+$/i.test(s) && s.length <= LIMITS.link
}

const isFontSrc = (s: string) => isAssetRef(s) || (s.startsWith('data:') && dataUriType(s) === 'font')

const isDate = (s: string) => s === '' || !Number.isNaN(Date.parse(s))

const LANG_PATTERN = /^$|^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/

const textFields = (): Record<string, Desc> => ({
  text: str({ max: LIMITS.text, doc: 'Plain text, used as is. "\\n" is a line break.' }),
  md: str({
    max: LIMITS.text,
    doc: 'Text in Markdown: **bold**, *italic*, ++underline++, ~~strike~~, `code`, ^sup^, ~sub~, [link](https://…), {{page}} and other fields.',
  }),
  content: inlineList('Formatted runs of text. A plain string is an unformatted run.'),
})

function inlineList(doc: string) {
  return arr(either([str({ max: LIMITS.text, doc: 'A plain run of text.' }), ref('Inline')]), { max: LIMITS.runs, doc })
}

/** Une suite de blocs ; une simple chaîne y est un paragraphe de texte brut. */
const blockList = (doc?: string) =>
  arr(either([str({ max: LIMITS.text, doc: 'A paragraph of plain text.' }), ref('Block')]), { max: LIMITS.blocks, doc })

const listStyle = (def?: string) =>
  enumOf(['bullet', 'number', 'check'], {
    def,
    doc: 'bullet (•), number (1, 2, 3) or check (a box to tick, for task lists).',
    aliases: {
      checklist: 'check',
      checkbox: 'check',
      checkboxes: 'check',
      task: 'check',
      tasks: 'check',
      tasklist: 'check',
      todo: 'check',
      bullets: 'bullet',
      disc: 'bullet',
      dash: 'bullet',
      unordered: 'bullet',
      ul: 'bullet',
      numbered: 'number',
      numbers: 'number',
      ordered: 'number',
      decimal: 'number',
      ol: 'number',
    },
  })

const color = (doc = 'A colour: "#rrggbb" or a theme colour (text, accent1 … accent6).') =>
  str({ max: 30, test: isColor, doc })
const hexColor = (doc?: string) => str({ max: 30, test: isHexColor, doc: doc ?? 'A colour "#rrggbb".' })
const fontName = (doc = 'A font family name, or a theme font: heading, body or mono.') => str({ max: 100, test: isFontName, doc })
const pt = (min: number, max: number, doc?: string) => num({ min, max, step: 0.5, doc })

/** Mises en forme de caractères seules (ce qu'une modification de mise en forme suivie garde « avant »). */
const formatFields = (): Record<string, Desc> => {
  const { link, comments, comment, inserted, deleted, ...rest } = baseMarkFields()
  void link, comments, comment, inserted, deleted
  return rest
}

/** Mises en forme de caractères, communes aux morceaux de texte et aux champs. */
const markFields = (): Record<string, Desc> => ({
  ...baseMarkFields(),
  formatChange: obj(
    { ...change(), before: obj(formatFields(), { doc: 'The formatting before the change (only what was set).' }) },
    { doc: 'Tracked change: the formatting of this text was changed, by author on date; "before" is the earlier formatting. Accepting keeps the new one.' },
  ),
})

const baseMarkFields = (): Record<string, Desc> => ({
  bold: bool(),
  italic: bool(),
  underline: bool(),
  strike: bool(),
  code: bool({ doc: 'Inline code, in a monospace font.' }),
  sup: bool({ doc: 'Superscript.' }),
  sub: bool({ doc: 'Subscript.' }),
  caps: bool({ doc: 'Shown in capitals (the text itself is unchanged).' }),
  smallcaps: bool({ doc: 'Small capitals.' }),
  link: str({
    max: LIMITS.link,
    test: isSafeLink,
    refusal: 'unsafe-link',
    doc: 'Link target: https://…, mailto:…, tel:… or #anchor.',
  }),
  color: color('Text colour: "#rrggbb" or a theme colour (text, accent1 … accent6).'),
  highlight: str({
    max: 30,
    test: isHighlight,
    doc: 'Highlighter: yellow, green, cyan, pink, blue, red, orange, purple, gray, or "#rrggbb".',
  }),
  font: fontName(),
  size: pt(1, 400, 'Font size in points.'),
  letterSpacing: num({ min: -20, max: 100, step: 0.1, doc: 'Extra space between letters, in points.' }),
  lang: str({ max: 35, pattern: LANG_PATTERN, doc: 'Language of this passage, for example "en" or "de-CH".' }),
  underlineStyle: enumOf([...UNDERLINE_STYLES], { aliases: { dash: 'dashed', dot: 'dotted', wave: 'wavy', bold: 'thick' }, doc: 'Underline style (with "underline": true): double, thick, dotted, dashed or wavy.' }),
  underlineColor: color('Colour of the underline.'),
  outline: bool({ doc: 'Hollow letters (outline only).' }),
  shadow: bool({ doc: 'A drop shadow behind the letters.' }),
  glow: color('A soft glow around the letters, in this colour.'),
  textBorder: color('A border around this text, in this colour.'),
  textShading: color('Background shading of this text (distinct from the highlighter).'),
  comments: arr(str({ max: 64, pattern: COMMENT_ID }), {
    max: 50,
    fromString: (s) => [s],
    doc: 'Ids of the comments (top-level "comments") about this text.',
  }),
  comment: str({ max: 64, pattern: COMMENT_ID, doc: 'The id of one comment about this text (same as "comments": [id]).' }),
  inserted: obj(change(), { doc: 'Tracked change: this text was added, by author on date, and awaits acceptance.' }),
  deleted: obj(change(), { doc: 'Tracked change: this text was deleted, by author on date; it stays visible until accepted.' }),
})

function change(): Record<string, Desc> {
  return { author: str({ max: 100, doc: 'Who made the change.' }), date: str({ max: 40, doc: 'When, as an ISO 8601 date.' }) }
}

const run = obj(
  { text: str({ max: LIMITS.text, doc: 'The text of the run. "\\n" is a line break.' }), ...markFields() },
  { required: ['text'], doc: 'A run of text with its formatting.' },
)

const fieldNames = enumOf(FIELD_NAMES, {
  doc: 'title, author, subject, organization, keywords (document properties), date, time (now), created, modified, page, pages, filename.',
  aliases: Object.fromEntries(
    ['titre', 'auteur', 'sujet', 'organisation', 'heure', 'fichier', 'nomfichier', 'motscles'].map((a) => [a, resolveFieldName(a)!]),
  ),
})

/** Réglages d'un champ de fusion (règles, bloc d'adresse, ligne de salutation). */
const mergeOpts = obj(
  {
    field: str({ max: 80, doc: 'Column tested by a rule.' }),
    op: enumOf(MERGE_OPS, { doc: 'Comparison: eq, ne, lt, gt, le, ge, empty, notEmpty, contains.' }),
    value: str({ max: 500, doc: 'Value compared with.' }),
    then: str({ max: 2000, doc: '@if: text when true; «Column» is replaced.' }),
    else: str({ max: 2000, doc: '@if: text when false.' }),
    prompt: str({ max: 300, doc: '@fillin: the question asked when merging.' }),
    default: str({ max: 500, doc: '@fillin: the suggested answer.' }),
    salutation: str({ max: 80, doc: '@greeting: "Dear", "Bonjour"…' }),
    nameFormat: enumOf(['first', 'full', 'title-last', 'last'], { doc: '@greeting: how the name is written.' }),
    punct: str({ max: 4, doc: '@greeting: punctuation after the name.' }),
    fallback: str({ max: 200, doc: '@greeting: greeting used when the name is missing.' }),
    company: enumOf(['yes', 'no'], { doc: '@address: include the company.' }),
    country: enumOf(['always', 'never', 'foreign'], { doc: '@address: country line always, never, or only when it differs from "home".' }),
    home: str({ max: 80, doc: '@address: the home country, left out when country is "foreign".' }),
  },
  { doc: 'Settings of a special merge field.' },
)

const inline = tagged({
  tag: 'type',
  fallback: 'text',
  resolve: (t) => {
    const k = t.toLowerCase()
    if (['run', 'span', 'string'].includes(k)) return { variant: 'text' }
    if (k === 'footnote') return { variant: 'note', patch: { kind: 'foot' } }
    if (k === 'endnote') return { variant: 'note', patch: { kind: 'end' } }
    if (['formula', 'latex', 'tex', 'equation', 'inlinemath'].includes(k)) return { variant: 'math' }
    const kk = k.replace(/[\s_-]/g, '')
    if (['merge', 'mergefield', 'mailmerge'].includes(kk)) return { variant: 'mergefield' }
    if (['seq', 'captionnumber', 'sequence'].includes(kk)) return { variant: 'seq' }
    if (['bookmark', 'anchor'].includes(kk)) return { variant: 'bookmark' }
    if (['xref', 'crossref', 'crossreference', 'ref'].includes(kk)) return { variant: 'xref' }
    if (['xe', 'indexentry', 'index'].includes(kk)) return { variant: 'xe' }
    if (['cite', 'citation'].includes(kk)) return { variant: 'cite' }
    if (['formfield', 'form', 'input', 'textfield', 'textinput'].includes(kk)) return { variant: 'formfield' }
    if (['checkbox', 'tickbox', 'case'].includes(kk)) return { variant: 'formfield', patch: { kind: 'checkbox' } }
    if (['dropdown', 'select', 'combobox', 'choice'].includes(kk)) return { variant: 'formfield', patch: { kind: 'dropdown' } }
    if (['date', 'datepicker', 'datefield'].includes(kk)) return { variant: 'formfield', patch: { kind: 'date' } }
    if (['attachment', 'attachedfile', 'file', 'embed', 'embeddedfile', 'object'].includes(kk)) return { variant: 'attachment' }
    return null
  },
  salvage: (v) => ('text' in v ? 'text' : 'tex' in v ? 'math' : null),
  doc: 'An inline item: a run of text (no "type"), a field, a note, a formula, a caption number, a bookmark, a cross-reference, an index entry, a citation, a form field or an attached file.',
  variants: {
    text: run,
    field: obj(
      {
        name: fieldNames,
        format: str({ max: 60, def: '', doc: 'Date or time pattern, for example "DD/MM/YYYY" or "HH:mm". Empty: the usual format.' }),
        ...markFields(),
      },
      { required: ['name'], doc: 'A value computed when the document is shown, such as the page number. In md, write {{page}}.' },
    ),
    note: obj(
      {
        kind: enumOf(['foot', 'end'], { def: 'foot', doc: 'foot: at the bottom of the page; end: at the end of the document.', aliases: { footnote: 'foot', endnote: 'end', bottom: 'foot' } }),
        text: str({ max: LIMITS.text, doc: 'The note, as plain text.' }),
        md: str({ max: LIMITS.text, doc: 'The note, in Markdown.' }),
        blocks: blockList('The note as blocks (several paragraphs).'),
      },
      { doc: 'A footnote or endnote, numbered automatically. In md, write ^[the note text].' },
    ),
    mergefield: obj(
      {
        name: str({ max: 80, doc: 'A column of the recipient list (top-level "mailMerge"), or a special field: @address (address block), @greeting (greeting line), @record, @sequence, @next, @nextif, @skipif, @if, @fillin.' }),
        opts: mergeOpts,
        ...markFields(),
      },
      { required: ['name'], doc: 'A mail merge field: replaced by each recipient’s value when merging. In md, write {{merge:Name}}.' },
    ),
    seq: obj(
      { label: str({ max: 40, def: 'figure', doc: 'Caption label counted: figure, table, equation, or your own label.' }), ...markFields() },
      { doc: 'A caption number, counted per label in document order. Write the word before it: ["Figure ", {"type":"seq","label":"figure"}, ": A cat"] in a paragraph with style "caption" (or an image caption).' },
    ),
    bookmark: obj(
      { name: str({ max: 40, pattern: BOOKMARK_NAME, doc: 'Name: a letter or _, then letters, digits, _ (40 at most). Starting with _: hidden.' }) },
      { required: ['name'], doc: 'A named, invisible anchor: the target of cross-references and of links "#name".' },
    ),
    xref: obj(
      {
        target: str({ max: 40, pattern: BOOKMARK_NAME, doc: 'Name of the bookmark referred to.' }),
        doc: str({ max: 32, pattern: DOC_KEY, doc: 'Key of another document of this file (see "documents"): the bookmark is in that document.' }),
        last: str({ max: 2000, doc: 'Filled in by the application: the last value shown for a reference to another document.' }),
        show: enumOf(XREF_SHOWS, {
          def: 'text',
          doc: 'text: the text of the paragraph holding the bookmark; label: "Figure 3" (caption label and number); number: "3"; page: its page number; above: "above" or "below".',
          aliases: { page: 'page', pagenumber: 'page', abovebelow: 'above', caption: 'label', labelnumber: 'label' },
        }),
        ...markFields(),
      },
      { required: ['target'], doc: 'A cross-reference to a bookmark, always up to date. To refer to a heading or caption, put a bookmark in it. With "doc", the bookmark is in another document of the file.' },
    ),
    xe: obj(
      {
        term: str({ max: 300, doc: 'The index term (or, with "authority", the full citation).' }),
        sub: str({ max: 300, doc: 'Subentry under the term.' }),
        see: str({ max: 300, doc: 'Cross-reference instead of page numbers: "See …".' }),
        bold: bool({ doc: 'Page number in bold.' }),
        italic: bool({ doc: 'Page number in italic.' }),
        authority: enumOf(AUTHORITY_CATEGORIES, { doc: 'Makes this an entry of the table of authorities, in this category.' }),
        short: str({ max: 300, doc: 'Short form of an authority citation.' }),
      },
      { required: ['term'], doc: 'An invisible index entry at this place (or a table of authorities entry). Listed by "index" blocks with its page.' },
    ),
    formfield: obj(
      {
        kind: enumOf(FORM_KINDS, { def: 'text', doc: 'text, dropdown (a list of options), date (YYYY-MM-DD) or checkbox.', aliases: { input: 'text', select: 'dropdown', list: 'dropdown', choice: 'dropdown', tick: 'checkbox', check: 'checkbox' } }),
        name: str({ max: 64, doc: 'Name of the field ("Name", "Date of birth").' }),
        value: str({ max: 1000, doc: 'What is filled in: text, one of the options, or a date YYYY-MM-DD.' }),
        options: arr(str({ max: 200 }), { max: 50, doc: 'Dropdown: the choices.' }),
        checked: bool({ doc: 'Checkbox: ticked.' }),
        placeholder: str({ max: 200, doc: 'Hint shown while the field is empty ("Click to type").' }),
        ...markFields(),
      },
      { doc: 'A form field to fill in (Developer tab). With "formsOnly", only the fields can be changed.' },
    ),
    attachment: obj(
      {
        src: str({ max: LIMITS.asset, test: isAttachmentSrc, refusal: 'unsafe-attachment', doc: 'The file: "asset:<id>" (see "assets"), or a "data:application/octet-stream;base64," URI.' }),
        name: str({ max: 255, doc: 'File name, for example "budget.xlsx".' }),
        size: int({ min: 0, max: 100_000_000, doc: 'Size in bytes.' }),
        mime: str({ max: 170, doc: 'Original type, for example "application/pdf" (for information: the file is always saved as plain bytes).' }),
      },
      { required: ['src', 'name'], doc: 'An attached file, shown as a chip with its name; double-click saves it to the computer.' },
    ),
    cite: obj(
      {
        ids: arr(str({ max: 64, pattern: SOURCE_ID }), { max: 20, fromString: (s) => [s], doc: 'Ids of the cited sources (top-level "sources").' }),
        id: str({ max: 64, pattern: SOURCE_ID, doc: 'One source id (same as "ids": [id]).' }),
        locator: str({ max: 60, doc: 'Page or part cited, for example "p. 12".' }),
        ...markFields(),
      },
      { doc: 'A citation, written in the document’s citation style (APA, MLA…). Add a "bibliography" block to list the sources.' },
    ),
    math: obj(
      {
        tex: str({ max: LIMITS.tex, doc: 'The formula in LaTeX, without the $ signs, for example "E = mc^2". Colour and size go in the LaTeX (\\textcolor, \\large).' }),
        comments: markFields().comments,
        comment: markFields().comment,
      },
      { required: ['tex'], doc: 'A formula in the line of text. In md, write $E = mc^2$ (no space just inside the $ signs).' },
    ),
  },
})

/** Mise en forme de paragraphe ; retraits et espacements en points. */
const paraFields = (): Record<string, Desc> => {
  const { ink, ...before } = baseParaFields()
  void ink
  return {
    ...baseParaFields(),
    formatChange: obj(
      {
        ...change(),
        before: obj(
          {
            ...before,
            kind: enumOf(['paragraph', 'heading'], { doc: 'What the block was: a paragraph or a heading.' }),
            level: int({ min: 1, max: 6, doc: 'Heading level, if it was a heading.' }),
            style: str({ max: 64, pattern: /^[A-Za-z][\w-]{0,63}$/, doc: 'Paragraph style, if it had one.' }),
          },
          { doc: 'The paragraph formatting before the change.' },
        ),
      },
      { doc: 'Tracked change: the paragraph formatting was changed, by author on date; "before" is the earlier formatting.' },
    ),
  }
}

const baseParaFields = (): Record<string, Desc> => ({
  align: enumOf(['left', 'center', 'right', 'justify'], {
    aliases: { start: 'left', end: 'right', centre: 'center', centered: 'center', middle: 'center', justified: 'justify', both: 'justify' },
  }),
  indent: obj(
    {
      left: pt(-300, 1000, 'Left indent in points (72 pt = 1 inch).'),
      right: pt(-300, 1000),
      first: pt(-500, 1000, 'First-line indent; negative for a hanging indent.'),
    },
    { doc: 'Indents in points.' },
  ),
  spacing: obj({ before: pt(0, 1000), after: pt(0, 1000) }, { doc: 'Space before and after the paragraph, in points.' }),
  line: num({ min: 0.5, max: 10, step: 0.05, doc: 'Line spacing as a multiple: 1, 1.15, 1.5, 2.' }),
  keepNext: bool({ doc: 'Keep on the same page as the next paragraph.' }),
  keepLines: bool({ doc: 'Do not split this paragraph across pages.' }),
  pageBreakBefore: bool({ doc: 'Start on a new page.' }),
  shading: color('Background colour of the paragraph.'),
  border: color('Draw a border around the paragraph, in this colour.'),
  dropCap: int({ min: 2, max: 10, doc: 'Drop cap: the first letter is enlarged over this many lines (2 to 10).' }),
  noLineNumbers: bool({ doc: 'Leave this paragraph out of the line numbers (its lines are not counted).' }),
  dir: enumOf(['ltr', 'rtl'], { doc: 'Writing direction: rtl for Arabic, Hebrew…; left out, it follows the text.', aliases: { 'right-to-left': 'rtl', 'left-to-right': 'ltr' } }),
  ink: arr(
    obj(
      {
        tool: enumOf(['pen', 'highlighter'], { def: 'pen' }),
        color: color(),
        width: num({ min: 0.25, max: 40, step: 0.25, def: 2 }),
        points: arr(num({ min: -INK_LIMITS.coord, max: INK_LIMITS.coord }), { max: INK_LIMITS.points * 2, doc: 'x, y, x, y… in points from the top-left corner of the paragraph.' }),
      },
      { required: ['points'] },
    ),
    { max: INK_LIMITS.strokes, doc: 'Hand drawing over this paragraph (Draw tab). Usually left to the app.' },
  ),
})

const listItem = obj({
  ...textFields(),
  level: int({ min: 0, max: 8, def: 0, doc: 'Nesting level: 0 is the top level. Go one level deeper at a time.' }),
  style: listStyle(),
  checked: bool({ doc: 'In a check list: the box is ticked.' }),
  ...paraFields(),
})

const cell = obj({
  ...textFields(),
  blocks: blockList('Several paragraphs or a list inside one cell.'),
  colspan: int({ min: 1, max: LIMITS.tableCols, def: 1 }),
  rowspan: int({ min: 1, max: LIMITS.tableRows, def: 1 }),
  bg: color('Background colour of the cell.'),
  valign: enumOf(['top', 'middle', 'bottom'], { aliases: { center: 'middle', centre: 'middle' } }),
  textDir: enumOf(['tbrl', 'btlr'], { doc: 'Vertical text: tbrl (top to bottom) or btlr (bottom to top).', aliases: { vertical: 'tbrl', down: 'tbrl', up: 'btlr', 'top-to-bottom': 'tbrl', 'bottom-to-top': 'btlr' } }),
})

/** Alias tolérés pour le type de bloc (une IA écrit volontiers « h2 » ou « ul »). */
export function resolveBlockType(tag: string): TagResolution | null {
  const t = tag.trim().toLowerCase().replace(/[\s_-]/g, '')
  const h = /^h([1-6])$/.exec(t) ?? /^heading([1-6])$/.exec(t)
  if (h) return { variant: 'heading', patch: { level: Number(h[1]) } }
  const table: Record<string, TagResolution> = {
    paragraph: { variant: 'paragraph' },
    p: { variant: 'paragraph' },
    para: { variant: 'paragraph' },
    text: { variant: 'paragraph' },
    heading: { variant: 'heading' },
    header: { variant: 'heading' },
    title: { variant: 'paragraph', patch: { style: 'title' } },
    subtitle: { variant: 'paragraph', patch: { style: 'subtitle' } },
    list: { variant: 'list' },
    ul: { variant: 'list', patch: { style: 'bullet' } },
    bulletlist: { variant: 'list', patch: { style: 'bullet' } },
    bullets: { variant: 'list', patch: { style: 'bullet' } },
    ol: { variant: 'list', patch: { style: 'number' } },
    checklist: { variant: 'list', patch: { style: 'check' } },
    tasklist: { variant: 'list', patch: { style: 'check' } },
    todo: { variant: 'list', patch: { style: 'check' } },
    orderedlist: { variant: 'list', patch: { style: 'number' } },
    numberedlist: { variant: 'list', patch: { style: 'number' } },
    quote: { variant: 'quote' },
    alert: { variant: 'callout' },
    admonition: { variant: 'callout' },
    aside: { variant: 'callout' },
    encadre: { variant: 'callout' },
    note: { variant: 'callout', patch: { kind: 'note' } },
    tip: { variant: 'callout', patch: { kind: 'tip' } },
    important: { variant: 'callout', patch: { kind: 'important' } },
    warning: { variant: 'callout', patch: { kind: 'warning' } },
    caution: { variant: 'callout', patch: { kind: 'caution' } },
    blockquote: { variant: 'quote' },
    citation: { variant: 'quote' },
    code: { variant: 'code' },
    codeblock: { variant: 'code' },
    pre: { variant: 'code' },
    table: { variant: 'table' },
    chart: { variant: 'chart' },
    smartart: { variant: 'diagram' },
    orgchart: { variant: 'diagram', patch: { kind: 'hierarchy' } },
    organigramme: { variant: 'diagram', patch: { kind: 'hierarchy' } },
    process: { variant: 'diagram', patch: { kind: 'process' } },
    cycle: { variant: 'diagram', patch: { kind: 'cycle' } },
    pyramid: { variant: 'diagram', patch: { kind: 'pyramid' } },
    graph: { variant: 'chart' },
    graphique: { variant: 'chart' },
    diagramme: { variant: 'chart' },
    plot: { variant: 'chart' },
    barchart: { variant: 'chart', patch: { kind: 'bar' } },
    columnchart: { variant: 'chart', patch: { kind: 'bar' } },
    histogram: { variant: 'chart', patch: { kind: 'bar' } },
    linechart: { variant: 'chart', patch: { kind: 'line' } },
    linegraph: { variant: 'chart', patch: { kind: 'line' } },
    piechart: { variant: 'chart', patch: { kind: 'pie' } },
    camembert: { variant: 'chart', patch: { kind: 'pie' } },
    divider: { variant: 'divider' },
    equation: { variant: 'equation' },
    math: { variant: 'equation' },
    displaymath: { variant: 'equation' },
    formula: { variant: 'equation' },
    latex: { variant: 'equation' },
    tex: { variant: 'equation' },
    columns: { variant: 'columns' },
    toc: { variant: 'toc' },
    tableofcontents: { variant: 'toc' },
    contents: { variant: 'toc' },
    figures: { variant: 'figures' },
    tableoffigures: { variant: 'figures' },
    listoffigures: { variant: 'figures' },
    index: { variant: 'index' },
    authorities: { variant: 'authorities' },
    tableofauthorities: { variant: 'authorities' },
    bibliography: { variant: 'bibliography' },
    glossaire: { variant: 'glossary' },
    abbreviationlist: { variant: 'abbreviations' },
    listofabbreviations: { variant: 'abbreviations' },
    acronyms: { variant: 'abbreviations' },
    abreviations: { variant: 'abbreviations' },
    references: { variant: 'bibliography' },
    workscited: { variant: 'bibliography' },
    cols: { variant: 'columns' },
    columnbreak: { variant: 'columnbreak' },
    colbreak: { variant: 'columnbreak' },
    hr: { variant: 'divider' },
    rule: { variant: 'divider' },
    horizontalrule: { variant: 'divider' },
    separator: { variant: 'divider' },
    pagebreak: { variant: 'pagebreak' },
    newpage: { variant: 'pagebreak' },
    break: { variant: 'pagebreak' },
    image: { variant: 'image' },
    img: { variant: 'image' },
    picture: { variant: 'image' },
    figure: { variant: 'image' },
    photo: { variant: 'image' },
  }
  return Object.prototype.hasOwnProperty.call(table, t) ? table[t] : null
}

const headerSet = (what: string) =>
  obj(
    {
      default: blockList(`The ${what} of every page. Fields such as {{page}} and {{pages}} work here.`),
      first: blockList(`The ${what} of the first page, when page.firstPage is true.`),
      even: blockList(`The ${what} of even pages, when page.evenOdd is true.`),
    },
    { doc: `Page ${what}s: paragraphs, images, small tables.` },
  )

const block = tagged({
  tag: 'type',
  fallback: 'paragraph',
  resolve: resolveBlockType,
  salvage: (v) => {
    if ('items' in v) return 'list'
    if ('series' in v) return 'chart'
    if ('rows' in v) return 'table'
    if ('src' in v) return 'image'
    if ('text' in v || 'md' in v || 'content' in v) return 'paragraph'
    if ('blocks' in v) return 'quote'
    if ('tex' in v) return 'equation'
    return null
  },
  doc: 'A block of the document. "type" may be omitted for a paragraph.',
  variants: {
    paragraph: obj(
      {
        ...textFields(),
        style: str({
          max: 64,
          pattern: KEY_PATTERN,
          doc: 'Named style: normal, title, subtitle, caption, or the id of a style defined in "styles".',
        }),
        ...paraFields(),
      },
      { doc: 'A paragraph. Give text, md or content.' },
    ),
    heading: obj(
      { level: int({ min: 1, max: 6, def: 1, doc: '1 is the top level.' }), ...textFields(), ...paraFields() },
      { doc: 'A heading, level 1 to 6. Use real headings rather than bold text.' },
    ),
    list: obj(
      {
        style: listStyle('bullet'),
        start: int({ min: 1, max: 1_000_000, def: 1, doc: 'First number of a numbered list.' }),
        numbering: enumOf(NUMBERINGS, {
          doc: 'Numbering scheme: default (1. a. i. by level), decimal, alpha (a.), ALPHA (A.), roman (i.), ROMAN (I.), outline (1.1.1).',
          aliases: { legal: 'outline', multilevel: 'outline', letters: 'alpha', 'lower-alpha': 'alpha', 'upper-alpha': 'ALPHA', 'lower-roman': 'roman', 'upper-roman': 'ROMAN' },
        }),
        bullet: str({ max: 4, test: (s) => /^[^\s\u0000-\u001f]{1,2}$/u.test(s), doc: 'Bullet character, for example "–" or "✓".' }),
        continue: bool({ doc: 'Continue the numbering of the previous numbered list.' }),
        items: arr(either([str({ max: LIMITS.text, doc: 'A plain-text item at level 0.' }), ref('ListItem')]), {
          max: LIMITS.listItems,
        }),
      },
      { required: ['items'], doc: 'A bulleted, numbered or check list. Nested items carry a "level"; check list items may carry "checked": true.' },
    ),
    quote: obj(
      { ...textFields(), blocks: blockList() },
      { doc: 'A block quotation: text/md/content for one paragraph, or blocks.' },
    ),
    callout: obj(
      {
        kind: enumOf(CALLOUT_KINDS, {
          def: 'note',
          doc: 'note (blue), tip (green), important (purple), warning (amber) or caution (red).',
          aliases: { info: 'note', remark: 'note', remarque: 'note', hint: 'tip', astuce: 'tip', conseil: 'tip', danger: 'caution', attention: 'caution', error: 'caution', warn: 'warning', avertissement: 'warning' },
        }),
        title: str({ max: 200, doc: 'Title shown at the top of the box; without it, the name of the kind ("Note", "Tip"…).' }),
        ...textFields(),
        blocks: blockList(),
      },
      { doc: 'A callout box that sets a passage apart: a coloured bar, an icon and a title, then text/md/content for one paragraph, or blocks. No callout inside a callout.' },
    ),
    code: obj(
      {
        language: str({ max: 40, def: '', doc: 'Language name, for example "python" or "json".' }),
        text: str({ max: LIMITS.text, def: '', doc: 'The code, with "\\n" between lines.' }),
      },
      { doc: 'A code listing in a monospace font, with syntax highlighting.' },
    ),
    table: obj(
      {
        header: bool({ def: true, doc: 'The first row is a header row.' }),
        style: enumOf(TABLE_STYLES, {
          def: 'grid',
          doc: 'grid (all borders), lines (horizontal lines), zebra (striped rows), boxed (outer frame), minimal.',
          aliases: { striped: 'zebra', banded: 'zebra', stripes: 'zebra', bordered: 'grid', borders: 'grid', box: 'boxed', plain: 'minimal', none: 'minimal', rows: 'lines' },
        }),
        widths: arr(pt(5, 2000), { max: LIMITS.tableCols, doc: 'Width of each column, in points.' }),
        rowHeight: pt(5, 1000, 'Exact height of every row, in points (labels). Left out: rows fit their content.'),
        align: enumOf(['left', 'center', 'right'], { aliases: { centre: 'center' } }),
        firstColumn: bool({ doc: 'Emphasise the first column.' }),
        border: color('Colour of the borders.'),
        repeatHeader: bool({ doc: 'Repeat the header row at the top of each page the table continues on.' }),
        rows: arr(
          arr(either([str({ max: LIMITS.text, doc: 'A plain-text cell.' }), ref('Cell')]), { max: LIMITS.tableCols }),
          { max: LIMITS.tableRows, doc: 'Rows of cells, top to bottom.' },
        ),
      },
      { required: ['rows'], doc: 'A table. Use tables for data, not lists of numbers.' },
    ),
    divider: obj({}, { doc: 'A horizontal line between sections.' }),
    chart: obj(
      {
        kind: enumOf(CHART_KINDS, {
          def: 'bar',
          doc: 'bar (bars, vertical unless "horizontal"), line (lines with points) or pie (slices of the first series).',
          aliases: { column: 'bar', columns: 'bar', bars: 'bar', histogram: 'bar', histogramme: 'bar', barres: 'bar', lines: 'line', courbe: 'line', courbes: 'line', curve: 'line', area: 'line', scatter: 'line', pie: 'pie', doughnut: 'pie', donut: 'pie', camembert: 'pie', secteurs: 'pie' },
        }),
        title: str({ max: CHART_LIMITS.text, doc: 'Title above the chart.' }),
        labels: arr(str({ max: CHART_LIMITS.text }), { max: CHART_LIMITS.labels, doc: 'The categories, in order: months, products, answers…' }),
        series: arr(
          obj(
            {
              name: str({ max: CHART_LIMITS.text, def: '', doc: 'Name shown in the legend.' }),
              values: arr(either([num({ min: -1e15, max: 1e15 }), str({ max: 40 })], { nullable: true }), { max: CHART_LIMITS.labels, doc: 'One number per label (null or "" for none). Numbers written as text ("1 200,5", "12 %") are read.' }),
            },
            { required: ['values'] },
          ),
          { max: CHART_LIMITS.series, doc: 'One or more series of values. A pie chart uses the first.' },
        ),
        rows: arr(arr(either([str({ max: CHART_LIMITS.text }), num({ min: -1e15, max: 1e15 })], { nullable: true }), { max: CHART_LIMITS.series + 1 }), { max: CHART_LIMITS.labels + 1, doc: 'Instead of labels and series: the data as table rows. The first row names the series, the first column gives the labels.' }),
        legend: bool({ def: true, doc: 'Show the legend (when there are several series, or for a pie chart).' }),
        horizontal: bool({ def: false, doc: 'Horizontal bars (bar charts only).' }),
      },
      { doc: 'A chart drawn from its own data: bars, lines or a pie. Give labels and series, or rows like a table.' },
    ),
    diagram: obj(
      {
        kind: enumOf(DIAGRAM_KINDS, {
          def: 'list',
          doc: 'list (stacked bars), process (steps joined by arrows), cycle (steps around a circle), hierarchy (an organisation chart from the levels), pyramid (layers) or radial (a centre and items around it).',
          aliases: { steps: 'process', etapes: 'process', processus: 'process', timeline: 'process', circle: 'cycle', cycle: 'cycle', orgchart: 'hierarchy', org: 'hierarchy', tree: 'hierarchy', organigramme: 'hierarchy', hierarchie: 'hierarchy', pyramide: 'pyramid', hub: 'radial', radiale: 'radial', liste: 'list' },
        }),
        title: str({ max: DIAGRAM_LIMITS.text, doc: 'Title above the diagram.' }),
        items: arr(either([str({ max: DIAGRAM_LIMITS.text }), obj({ text: str({ max: DIAGRAM_LIMITS.text }), level: int({ min: 0, max: DIAGRAM_LIMITS.level, def: 0 }) }, { required: ['text'] })]), {
          max: DIAGRAM_LIMITS.items,
          doc: 'The items, in order: strings, or { "text", "level" } (level 0 is the top level; a level-1 item belongs to the item before it).',
        }),
        text: str({ max: DIAGRAM_LIMITS.items * (DIAGRAM_LIMITS.text + 8), doc: 'Instead of items: one item per line, two spaces of indent per level.' }),
        color: enumOf(DIAGRAM_COLORS, { def: 'colorful', doc: 'colorful (one theme colour per item) or one theme colour for all (accent1 … accent6).' }),
      },
      { doc: 'A diagram drawn from a short list: process steps, a cycle, an organisation chart, a pyramid… (like SmartArt).' },
    ),
    equation: obj(
      {
        tex: str({ max: LIMITS.tex, doc: 'The formula in LaTeX, without $$, for example "\\int_0^1 x^2\\,dx = \\frac{1}{3}". Matrices, cases, aligned, \\ce{} for chemistry.' }),
        numbered: bool({ def: false, doc: 'Number the equation (1), (2)… on the right. Write \\label{name} in it and \\eqref{name} elsewhere to refer to it.' }),
      },
      { required: ['tex'], doc: 'A centred (display) equation. In md, a paragraph $$…$$ on its own.' },
    ),
    pagebreak: obj({}, { doc: 'Start a new page.' }),
    columns: obj(
      {
        count: int({ min: 2, max: 6, def: 2, doc: 'Number of columns.' }),
        gap: pt(0, 200, 'Space between columns, in points (default 18).'),
        rule: bool({ def: false, doc: 'Draw a line between the columns.' }),
        blocks: blockList('The content, flowing from one column to the next. A columnbreak block moves to the next column.'),
      },
      { required: ['blocks'], doc: 'Text in balanced columns, like a newsletter. Kept whole on one page.' },
    ),
    columnbreak: obj({}, { doc: 'Inside columns: continue in the next column.' }),
    toc: obj(
      {
        levels: int({ min: 1, max: 6, def: 3, doc: 'Heading levels listed (3: levels 1 to 3).' }),
        title: str({ max: 200, def: '', doc: 'Title shown above the table, for example "Contents".' }),
      },
      { doc: 'A table of contents built from the headings, always up to date, with page numbers.' },
    ),
    figures: obj(
      {
        label: str({ max: 40, def: 'figure', doc: 'Caption label listed: figure, table, equation, or your own.' }),
        title: str({ max: 200, def: '', doc: 'Title shown above the list.' }),
      },
      { doc: 'A table of figures: every caption with this label (a "seq" item), with its page number.' },
    ),
    index: obj(
      {
        columns: int({ min: 1, max: 3, def: 2, doc: 'Number of columns.' }),
        title: str({ max: 200, def: '', doc: 'Title shown above the index.' }),
      },
      { doc: 'An index of the entries marked with "xe" items, alphabetical, with page numbers.' },
    ),
    authorities: obj(
      {
        category: enumOf([...AUTHORITY_CATEGORIES, 'all'], { def: 'all', doc: 'Category listed, or all.' }),
        title: str({ max: 200, def: '', doc: 'Title shown above the table.' }),
      },
      { doc: 'A table of authorities: the "xe" items with an "authority" category, with their pages.' },
    ),
    bibliography: obj(
      {
        title: str({ max: 200, def: '', doc: 'Title, for example "References" or "Works Cited".' }),
        all: bool({ doc: 'List every source, not only the cited ones.' }),
      },
      { doc: 'The bibliography: the sources cited ("cite" items), in the citation style of the document.' },
    ),
    glossary: obj(
      {
        title: str({ max: 200, def: '', doc: 'Title, for example "Glossary".' }),
        all: bool({ doc: 'List every glossary term, not only those used in the text.' }),
      },
      { doc: 'The glossary: the terms of "terms" (kind "glossary") used in the text, alphabetically, with their definition. Always up to date.' },
    ),
    abbreviations: obj(
      {
        title: str({ max: 200, def: '', doc: 'Title, for example "Abbreviations".' }),
        all: bool({ doc: 'List every abbreviation, not only those used in the text.' }),
      },
      { doc: 'The list of abbreviations: the terms of "terms" (kind "abbreviation") used in the text, with their long form.' },
    ),
    section: obj(
      {
        start: enumOf(['page', 'odd', 'even'], { def: 'page', doc: 'Where the new section starts: the next page, the next odd page or the next even page.' }),
        numberStart: int({ min: 0, max: 100_000, doc: 'Restart page numbering at this number.' }),
        numberFormat: enumOf(PAGE_NUMBER_FORMATS, { doc: 'Page number format in this section.' }),
        firstPage: bool({ doc: 'A different header and footer on the first page of the section.' }),
        headers: headerSet('header'),
        footers: headerSet('footer'),
        page: obj(
          {
            size: enumOf([...Object.keys(PAPER_SIZES), 'custom'], { doc: 'Paper of the section.', aliases: { 'us-letter': 'Letter', usletter: 'Letter' } }),
            width: num({ min: 50, max: 1200, step: 0.05, doc: 'Paper width in millimetres (portrait), for a custom size.' }),
            height: num({ min: 50, max: 1200, step: 0.05 }),
            orientation: enumOf(['portrait', 'landscape'], { aliases: { paysage: 'landscape', horizontal: 'landscape', vertical: 'portrait' } }),
            margins: obj(
              { top: num({ min: 0, max: 300, step: 0.05 }), right: num({ min: 0, max: 300, step: 0.05 }), bottom: num({ min: 0, max: 300, step: 0.05 }), left: num({ min: 0, max: 300, step: 0.05 }) },
              { doc: 'Margins in millimetres.' },
            ),
          },
          { doc: 'Page setup of this section (paper, orientation, margins); left out: the previous section’s. For example a landscape section for a wide table.' },
        ),
      },
      { doc: 'A section break, at the top level: what follows starts a new page and may have its own numbering, headers and footers (left out: the previous section’s).' },
    ),
    image: obj(
      {
        src: str({
          max: LIMITS.asset,
          test: isImageSrc,
          refusal: 'unsafe-image',
          doc: 'The picture: "asset:<id>" (see "assets"), a "data:image/…;base64," URI, or an https:// address (shown only if the reader allows it).',
        }),
        alt: str({ max: 2000, def: '', doc: 'Alternative text: what the picture shows, for readers who cannot see it.' }),
        width: pt(0, 2000, 'Width in points (the page text is about 470 pt wide). 0: natural size.'),
        height: pt(0, 4000, 'Height in points, only to stretch the picture on purpose. Leave it out to keep its proportions.'),
        align: enumOf(['left', 'center', 'right'], { def: 'center', aliases: { centre: 'center' } }),
        wrap: enumOf(['none', 'left', 'right', 'tight', 'through', 'behind', 'front'], {
          def: 'none',
          doc: 'none: on its own line; left or right: floating on that side, text flowing around its box; tight or through: text follows the outline of a picture with transparent areas (side given by "align"); behind or front: behind or in front of the text, taking no room.',
          aliases: {
            inline: 'none',
            block: 'none',
            topbottom: 'none',
            topandbottom: 'none',
            'top-and-bottom': 'none',
            'float-left': 'left',
            'float-right': 'right',
            square: 'left',
            contour: 'tight',
            'behind-text': 'behind',
            behindtext: 'behind',
            background: 'behind',
            'in-front': 'front',
            infront: 'front',
            infrontoftext: 'front',
            'in-front-of-text': 'front',
            foreground: 'front',
          },
        }),
        caption: either([
          str({ max: LIMITS.text, doc: 'Caption in Markdown.' }),
          inlineList('Caption as formatted runs.'),
        ]),
        crop: obj(
          { top: num({ min: 0, max: 95, step: 0.1 }), right: num({ min: 0, max: 95, step: 0.1 }), bottom: num({ min: 0, max: 95, step: 0.1 }), left: num({ min: 0, max: 95, step: 0.1 }) },
          { doc: 'Cropping, in percent of each side.' },
        ),
        rotate: int({ min: -360, max: 360, doc: 'Rotation in degrees: 90, 180 or 270.' }),
        flip: enumOf(['h', 'v', 'hv'], { aliases: { horizontal: 'h', vertical: 'v', both: 'hv' } }),
        border: color('Draw a border around the picture, in this colour.'),
        adjust: obj(
          {
            brightness: int({ min: -100, max: 100, doc: 'Brightness, -100 to 100 (percent).' }),
            contrast: int({ min: -100, max: 100, doc: 'Contrast, -100 to 100 (percent).' }),
            saturation: int({ min: 0, max: 400, doc: 'Colour saturation in percent: 0 is grey, 100 unchanged.' }),
            recolor: enumOf(['grayscale', 'sepia', 'washout', 'blackwhite'], { aliases: { greyscale: 'grayscale', gray: 'grayscale', grey: 'grayscale', bw: 'blackwhite' } }),
            artistic: enumOf(['blur', 'pencil', 'negative'], { aliases: { invert: 'negative', sketch: 'pencil' } }),
            transparency: int({ min: 0, max: 95, doc: 'Transparency in percent.' }),
            shadow: bool({ doc: 'A drop shadow.' }),
            glow: color('A soft glow around the picture, in this colour.'),
            softEdges: int({ min: 0, max: 50, doc: 'Soft edges, in points.' }),
            reflection: int({ min: 0, max: 100, doc: 'A reflection below the picture: the share of its height reflected, 10 to 100 (percent).' }),
          },
          { doc: 'Picture corrections and effects.' },
        ),
      },
      { required: ['src'], doc: 'A picture, with an optional caption.' },
    ),
  },
})

const meta = obj(
  {
    title: str({ max: 500, def: '', doc: 'Document title: browser tab and suggested file name.' }),
    author: str({ max: 300, def: '' }),
    subject: str({ max: 500, def: '' }),
    organization: str({ max: 300, def: '' }),
    keywords: arr(str({ max: 100 }), {
      max: 100,
      fromString: (s) =>
        s
          .split(/[,;]/)
          .map((x) => x.trim())
          .filter(Boolean),
    }),
    lang: str({
      max: 35,
      def: '',
      pattern: LANG_PATTERN,
      doc: 'Language of the text, for example "fr" or "en-GB".',
    }),
    created: str({ max: 40, def: '', test: isDate, format: 'date-time', doc: 'Set by the app.' }),
    modified: str({ max: 40, def: '', test: isDate, format: 'date-time', doc: 'Set by the app on every save.' }),
  },
  { doc: 'Document properties.' },
)

const mm = (min: number, max: number, doc?: string) => num({ min, max, step: 0.05, doc })

const page = obj(
  {
    size: enumOf([...Object.keys(PAPER_SIZES), 'custom'], {
      doc: 'Paper: A3, A4, A5, B5, Letter, Legal, Tabloid, Executive, or custom (give width and height).',
      aliases: { 'us-letter': 'Letter', usletter: 'Letter', 'us-legal': 'Legal', ledger: 'Tabloid', perso: 'custom', personnalise: 'custom' },
    }),
    width: mm(50, 1200, 'Paper width in millimetres (portrait), for a custom size.'),
    height: mm(50, 1200, 'Paper height in millimetres (portrait), for a custom size.'),
    orientation: enumOf(['portrait', 'landscape'], { aliases: { paysage: 'landscape', horizontal: 'landscape', vertical: 'portrait' } }),
    margins: obj(
      { top: mm(0, 300), right: mm(0, 300), bottom: mm(0, 300), left: mm(0, 300) },
      { doc: 'Margins in millimetres.' },
    ),
    header: mm(0, 200, 'Distance of the header from the top edge, in millimetres.'),
    footer: mm(0, 200, 'Distance of the footer from the bottom edge, in millimetres.'),
    firstPage: bool({ doc: 'A different header and footer on the first page.' }),
    evenOdd: bool({ doc: 'A different header and footer on even pages.' }),
    numberStart: int({ min: 0, max: 100_000, doc: 'Number of the first page.' }),
    numberFormat: enumOf(PAGE_NUMBER_FORMATS, { doc: 'Page numbers: decimal (1), roman (i), ROMAN (I), alpha (a), ALPHA (A).' }),
    background: color('Page colour.'),
    border: color('Draw a border around each page, in this colour.'),
  },
  { doc: 'Page setup. Lengths in millimetres.' },
)

const theme = obj(
  {
    name: str({ max: 40, doc: 'Preset the other fields start from: folio, classic, modern, slate, ink or system.' }),
    colors: obj(Object.fromEntries(THEME_COLORS.map((c) => [c, hexColor()])), {
      doc: 'Theme colours. Text and styles refer to them by name, so changing one changes the whole document.',
    }),
    fonts: obj(
      {
        heading: fontName('Font of titles and headings.'),
        body: fontName('Font of body text.'),
        mono: fontName('Font of code.'),
      },
      { doc: 'Built in: "Hanken Grotesk" (sans serif), "Newsreader" (serif), "JetBrains Mono" (monospace).' },
    ),
    code: obj(Object.fromEntries(CODE_COLORS.map((c) => [c, hexColor()])), { doc: 'Colours of code listings.' }),
  },
  { doc: 'Document theme: colours and fonts defined once.' },
)

const styleDesc = obj(
  {
    name: str({ max: 100, doc: 'Displayed name. Required for a new style.' }),
    basedOn: str({ max: 64, pattern: KEY_PATTERN, doc: 'Style this one inherits from.' }),
    next: str({ max: 64, pattern: KEY_PATTERN, doc: 'Style of the paragraph that follows.' }),
    font: fontName(),
    size: pt(1, 400),
    color: color(),
    highlight: str({ max: 30, test: isHighlight }),
    bold: bool(),
    italic: bool(),
    underline: bool(),
    strike: bool(),
    caps: bool(),
    smallcaps: bool(),
    letterSpacing: num({ min: -20, max: 100, step: 0.1 }),
    ...paraFields(),
  },
  { doc: 'A named style. Built-in styles (normal, title, subtitle, heading1 … heading6, quote, code, caption) may be changed field by field.' },
)

const fontFace = obj(
  {
    family: str({ max: 100, test: isFontName }),
    src: str({ max: LIMITS.asset, test: isFontSrc, doc: '"asset:<id>" or a data: URI of a .woff2, .woff, .ttf or .otf font.' }),
    weight: int({ min: 100, max: 900, def: 400 }),
    italic: bool({ def: false }),
    unicodeRange: str({ max: 4000, pattern: UNICODE_RANGE, doc: 'Characters this file covers, as in CSS ("U+0000-00FF, U+0131"): a font split into subsets.' }),
  },
  { required: ['family', 'src'], doc: 'A font embedded in the document.' },
)

const noteKind = (format: string, what: string) =>
  obj(
    {
      format: enumOf(NOTE_FORMATS, {
        def: format,
        doc: 'decimal (1), roman (i), ROMAN (I), alpha (a), ALPHA (A), symbols (*, †, ‡…).',
        aliases: { number: 'decimal', numbers: 'decimal', 'lower-roman': 'roman', 'upper-roman': 'ROMAN', 'lower-alpha': 'alpha', 'upper-alpha': 'ALPHA', symbol: 'symbols' },
      }),
      start: int({ min: 1, max: 9999, def: 1, doc: 'Number of the first note.' }),
      restart: enumOf(NOTE_RESTARTS, {
        def: 'continuous',
        doc: what === 'foot' ? 'Start numbering again: never (continuous), at each section, or on each page.' : 'Start numbering again: never (continuous) or at each section.',
        aliases: { never: 'continuous', none: 'continuous', 'each-section': 'section', 'each-page': 'page' },
      }),
    },
    { doc: what === 'foot' ? 'Footnotes.' : 'Endnotes.' },
  )

const commentReply = (doc: string) => ({
  author: str({ max: 100, doc: 'Who wrote it.' }),
  date: str({ max: 40, doc: 'When, as an ISO 8601 date ("2026-11-09T14:30:00Z").' }),
  text: str({ max: 20_000, doc }),
})

const commentThread = obj(
  {
    id: str({ max: 64, pattern: COMMENT_ID, doc: 'Referred to by the "comments" of the runs it is about.' }),
    ...commentReply('The comment, as plain text.'),
    resolved: bool({ def: false, doc: 'Marked as done.' }),
    replies: arr(obj(commentReply('The reply, as plain text.'), { required: ['text'] }), { max: 1_000, doc: 'Answers, oldest first.' }),
  },
  { required: ['id', 'text'], doc: 'A comment thread about a passage of text.' },
)

const mmNum = (min: number, max: number, doc?: string) => num({ min, max, step: 0.1, doc })
const mailMergeDesc = obj(
  {
    type: enumOf(MERGE_TYPES, { def: 'letters', doc: 'Kind of main document: letters, emails, envelopes, labels, directory.' }),
    source: obj(
      {
        name: str({ max: 200, def: '', doc: 'Name of the list (the imported file, for example).' }),
        fields: arr(str({ max: 80 }), { max: LIMITS.mergeFields, doc: 'Column names.' }),
        records: arr(arr(str({ max: 2000 }), { max: LIMITS.mergeFields }), { max: LIMITS.mergeRecords, doc: 'One array of values per recipient, in the order of "fields".' }),
        excluded: arr(int({ min: 0, max: LIMITS.mergeRecords, strict: true }), { max: LIMITS.mergeRecords, doc: 'Recipients left out (indices in "records").' }),
      },
      { required: ['fields', 'records'], doc: 'The recipient list, kept in the document.' },
    ),
    map: obj(Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, str({ max: 80 })])), { doc: 'Column of each standard address field (title, first, last, company, address1, address2, city, state, postal, country, email, phone).' }),
    filters: arr(obj({ field: str({ max: 80 }), op: enumOf(MERGE_OPS, { def: 'eq' }), value: str({ max: 500 }) }, { required: ['field'] }), { max: 10, doc: 'Keep only the recipients that pass every filter.' }),
    sort: obj({ field: str({ max: 80 }), desc: bool() }, { required: ['field'], doc: 'Order of the recipients.' }),
    email: obj({ to: str({ max: 80, doc: 'Column of the e-mail address.' }), subject: str({ max: 300, def: '', doc: 'Subject line; «Column» is replaced.' }) }, { required: ['to'] }),
    label: obj(
      {
        name: str({ max: 80, def: '' }),
        pageWidth: mmNum(50, 1000),
        pageHeight: mmNum(50, 1000),
        cols: int({ min: 1, max: 10 }),
        rows: int({ min: 1, max: 40 }),
        width: mmNum(5, 500),
        height: mmNum(5, 500),
        top: mmNum(0, 200),
        left: mmNum(0, 200),
        hgap: mmNum(0, 100),
        vgap: mmNum(0, 100),
      },
      { required: ['pageWidth', 'pageHeight', 'cols', 'rows', 'width', 'height'], doc: 'Sheet of labels, in millimetres.' },
    ),
    envelope: obj({ name: str({ max: 80, def: '' }), width: mmNum(50, 500), height: mmNum(50, 500), returnAddress: str({ max: 1000, def: '' }) }, { required: ['width', 'height'], doc: 'Envelope size in millimetres, and the sender’s address.' }),
  },
  { doc: 'Mail merge: the kind of main document, its recipient list and its settings.' },
)

const sourceDesc = obj(
  {
    id: str({ max: 64, pattern: SOURCE_ID, doc: 'Short id used by "cite" items, for example "Darwin1859".' }),
    type: enumOf(SOURCE_TYPES, {
      def: 'book',
      doc: 'book, article (journal), chapter (in a book), website, report, thesis, conference, film, interview, other.',
      aliases: { journal: 'article', paper: 'article', web: 'website', webpage: 'website', page: 'website', incollection: 'chapter', inbook: 'chapter', phdthesis: 'thesis', inproceedings: 'conference', proceedings: 'conference', misc: 'other' },
    }),
    authors: arr(str({ max: 200 }), { max: 30, fromString: (s) => s.split(/\s*;\s*|\s+and\s+/).filter(Boolean), doc: 'Authors as "Last, First", or an organisation name.' }),
    title: str({ max: 1000, def: '' }),
    container: str({ max: 500, doc: 'Journal, book, website or conference the work is part of.' }),
    editors: arr(str({ max: 200 }), { max: 20 }),
    publisher: str({ max: 300 }),
    place: str({ max: 200, doc: 'Place of publication.' }),
    year: str({ max: 40, doc: 'Year, or a date (ISO 8601).' }),
    volume: str({ max: 40 }),
    issue: str({ max: 40 }),
    pages: str({ max: 40, doc: 'Pages, for example "12-34".' }),
    edition: str({ max: 40 }),
    url: str({ max: LIMITS.link, test: (u) => /^https?:\/\//i.test(u) && isSafeLink(u) }),
    doi: str({ max: 200, test: (d) => /^10\.\d{4,9}\/\S+$/.test(d), doc: 'DOI without "https://doi.org/", for example "10.1038/171737a0".' }),
    isbn: str({ max: 20, test: (d) => /^[0-9Xx-]{10,17}$/.test(d) }),
    accessed: str({ max: 40, test: isDate, doc: 'Date the website was consulted.' }),
    note: str({ max: 1000 }),
  },
  { required: ['id'], doc: 'A source that can be cited.' },
)

const notesDesc = obj({ foot: noteKind('decimal', 'foot'), end: noteKind('roman', 'end') }, { doc: 'Numbering of footnotes and endnotes.' })

const documentDesc = obj(
  {
    $schema: str({ max: 300 }),
    format: str({ max: 40, doc: 'Always "folio/doc".' }),
    version: int({ min: 1, max: 1000, doc: 'Format version. This is version 1.' }),
    id: str({ max: 64, pattern: ID_PATTERN, doc: 'Document identity. Leave it out: the app creates one.' }),
    meta,
    page,
    headers: headerSet('header'),
    footers: headerSet('footer'),
    notes: notesDesc,
    mailMerge: mailMergeDesc,
    sources: arr(sourceDesc, { max: 2_000, doc: 'Sources cited with "cite" items and listed by "bibliography" blocks.' }),
    terms: arr(
      obj(
        {
          id: str({ max: 64, pattern: /^[\w-]{1,64}$/, doc: 'Identifier; the app makes one when it is missing.' }),
          term: str({ max: 200, doc: 'The term or the abbreviation, as written in the text ("OMS", "photosynthesis").' }),
          definition: str({ max: 2_000, def: '', doc: 'Its definition, or the long form of an abbreviation.' }),
          kind: enumOf(['glossary', 'abbreviation'], { def: 'glossary', doc: 'glossary (a term and its definition) or abbreviation (and its long form).', aliases: { abbr: 'abbreviation', acronym: 'abbreviation', abreviation: 'abbreviation', abréviation: 'abbreviation', sigle: 'abbreviation', term: 'glossary', glossaire: 'glossary' } }),
          plural: str({ max: 200, doc: 'Plural form, when it is not the term + s.' }),
        },
        { required: ['term'] },
      ),
      { max: 2_000, doc: 'Glossary terms and abbreviations, defined once; "glossary" and "abbreviations" blocks list those found in the text (whole words; abbreviations are case-sensitive).' },
    ),
    citationStyle: enumOf(CITATION_STYLES, {
      def: 'apa',
      doc: 'Citation and bibliography style: apa, mla, chicago (author-date), chicago-notes (citations in footnotes), harvard, ieee (numbered), vancouver (numbered, medicine), iso690.',
      aliases: { 'apa7': 'apa', 'mla9': 'mla', 'chicagoauthordate': 'chicago', chicagonotes: 'chicago-notes', 'chicago-notes-bibliography': 'chicago-notes', notes: 'chicago-notes', footnotes: 'chicago-notes', icmje: 'vancouver', nlm: 'vancouver', numeric: 'ieee', numbered: 'ieee', 'iso-690': 'iso690' },
    }),
    math: obj(
      { macros: str({ max: LIMITS.macros, def: '', doc: 'LaTeX definitions shared by every formula, for example "\\newcommand{\\R}{\\mathbb{R}}".' }) },
      { doc: 'Equations: macros shared by the whole document.' },
    ),
    theme,
    styles: map(KEY_PATTERN, styleDesc, { max: LIMITS.styles, doc: 'Changed built-in styles and new styles, by id.' }),
    fonts: arr(fontFace, { max: LIMITS.fonts, doc: 'Fonts embedded in the document.' }),
    blocks: blockList('The content, top to bottom. A plain string is a paragraph.'),
    comments: arr(commentThread, { max: 5_000, doc: 'Comment threads. A run says which comments are about it: { "text": "…", "comments": ["c1"] }.' }),
    trackChanges: bool({ def: false, doc: 'Track changes: additions and deletions are marked until accepted or rejected.' }),
    formsOnly: bool({ doc: 'A protected form: only the form fields can be filled in.' }),
    goal: obj(
      {
        words: int({ min: 1, max: 10_000_000, doc: 'Target number of words.' }),
        deadline: str({ max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/, doc: 'Optional deadline, "YYYY-MM-DD".' }),
      },
      { required: ['words'], doc: 'A writing goal: the status bar shows the progress towards it.' },
    ),
    hyphenate: bool({ def: false, doc: 'Automatic hyphenation: long words are split at the end of lines, by the rules of the document language.' }),
    lineNumbers: either([
      bool({ doc: 'true: numbered lines with the default settings.' }),
      obj(
      {
        restart: enumOf(['continuous', 'page', 'section'], { def: 'continuous', doc: 'Start again from the first number on each page, each section, or never.', aliases: { 'each-page': 'page', 'new-page': 'page', 'each-section': 'section', none: 'continuous' } }),
        start: int({ min: 1, max: 32_767, def: 1, doc: 'First number.' }),
        countBy: int({ min: 1, max: 100, def: 1, doc: 'Show every n-th number (5: 5, 10, 15…); every line still counts.' }),
        distance: pt(0, 144, 'Distance from the text, in points (left out: automatic).'),
      },
      { doc: 'Line numbers in the left margin (page view, printing, PDF), as in legal documents, scripts or drafts to review. Tables, notes, headers and footers are not numbered.' },
      ),
    ], { doc: 'Line numbers in the left margin (page view, printing, PDF). true, or the settings.' }),
    watermark: obj(
      {
        text: str({ max: 60, doc: 'The watermark text, for example "DRAFT" or "CONFIDENTIAL".' }),
        image: str({ max: LIMITS.asset, test: (s: string) => /^asset:/.test(s) || /^data:image\//.test(s), doc: '"asset:<id>" of a picture (instead of text).' }),
        color: color('Text colour (default a light grey).'),
        diagonal: bool({ def: true, doc: 'Diagonal (true) or horizontal (false).' }),
        opacity: int({ min: 5, max: 100, def: 35, doc: 'Opacity in percent.' }),
        size: int({ min: 0, max: 400, def: 0, doc: 'Font size in points; 0 fits the page.' }),
        scale: int({ min: 10, max: 100, def: 70, doc: 'Picture width, in percent of the text width.' }),
      },
      { doc: 'A watermark behind the text of every page: a text or a picture.' },
    ),
    key: str({ max: 32, pattern: DOC_KEY, doc: 'With several documents in the file: a short name for this one (a letter, then letters, digits or _), used by links "#key:anchor" and cross-references "doc": "key".' }),
    documents: arr(ref('Document'), {
      max: LIMITS.documents,
      doc: 'More documents in the same file, each complete and independent (its own title, page setup, theme, styles, content…), shown as tabs at the bottom of the window. Only in the first document. Give each document, this one included, a "key".',
    }),
    template: bool({ def: false, doc: 'A template: each time the file opens, a new document starts from it.' }),
    readOnly: bool({ def: false, doc: 'A read-only copy: the file opens in reading view, without editing.' }),
    markdown: str({
      max: LIMITS.markdown,
      doc: 'The whole content as Markdown, instead of "blocks". Converted when the file opens.',
    }),
    assets: map(KEY_PATTERN, str({ max: LIMITS.asset, test: (s) => dataUriType(s) !== null, refusal: 'unsafe-image' }), {
      max: LIMITS.assets,
      doc: 'Pictures, fonts and attached files (application/octet-stream) as base64 data: URIs, referred to as "asset:<id>".',
    }),
  },
  { doc: 'A Folio Pages document.' },
)

export const DEFS: Record<string, Desc> = {
  Document: documentDesc,
  Block: block,
  Inline: inline,
  ListItem: listItem,
  Cell: cell,
}
