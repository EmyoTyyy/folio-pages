# Folio Pages — guide for AI agents

Folio Pages is a word processor that lives in **one HTML file**. The file is
both the editor and the document: open it in a browser, write, save, and the
file rewrites itself. This page tells an AI (or a script) how to write a
document into such a file so that it opens correctly, and how to make it a
*good* document rather than merely a valid one.

- App (blank, always the latest): <https://emyotyyy.github.io/folio-pages/folio-pages.html>
- JSON Schema (draft 2020-12): <https://emyotyyy.github.io/folio-pages/schema/folio-1.json>
- Source: <https://github.com/EmyoTyyy/folio-pages>

Format `folio/doc`, version **1**. This guide describes Folio Pages 0.6:
paragraphs, headings, lists, quotations, code, tables, pictures, pages and
sections, footnotes, comments, tracked changes and LaTeX equations. The page
grows with each version.

## 1. The mechanics

A Folio Pages file contains exactly one document block, near the top:

```html
<script type="application/folio+json" id="folio-doc">
{ "format": "folio/doc", "version": 1, "blocks": [ … ] }
</script>
```

- **Edit that block in place.** Never regenerate, retype or reformat the rest
  of the file. The blocks of type `folio/deflate-b122` further down are the
  compressed application: leave them byte for byte. They contain non-ASCII
  and control characters, so read and write the file as UTF-8 and edit it
  with a tool that only changes the bytes you replace.
- **Escape every `<` in the JSON as `<`.** The JSON sits inside a
  `<script>` element; a literal `</script>` in a string would end it early.
  `<` is ordinary JSON and reads back as `<`.
- **In the blank app the block is empty.** The browser then shows a demo
  document; on disk there is nothing to remove. Put your JSON into the empty
  block.
- **Identity:** leave `id` out of a new document (the app creates one when the
  file is first opened). Never change the `id` of an existing document: it
  links the file to its crash-recovery copy.
- The file opens offline, with no server. Do not add `<script>` or
  `<link>` tags; nothing outside the block is read as document content.
- **A password-protected document** holds only an encrypted envelope,
  `{ "format": "folio/enc", "v": 1, … }`. It cannot be read without the
  password, and replacing it destroys the document: leave it alone and ask the
  person for an unprotected copy.

To get a blank file:

```bash
curl -fsSL https://emyotyyy.github.io/folio-pages/folio-pages.html -o "My document.html"
```

### Without a file (chat interfaces)

If you cannot receive or return a file, the user can do the round trip in the
app's **AI** tab: **Copy compact JSON** gives you the current document; you
answer with a complete document JSON; the user pastes it into **Replace from
JSON…** (undoable with Ctrl+Z). Answer with the JSON only, in one code block.

### In a running file

`window.folio` exposes `{ doc, serialize(), loadDoc(json), schema(), compact(), i18n, version }`.
`loadDoc` accepts a JSON string or an object and returns
`{ ok, ignored, warnings, issues }` or `{ ok: false, reason, line, column }`.

## 2. A minimal document

Fields at their default value may be left out (the *compact* form). The app
fills in the defaults; the file it saves always holds the complete form.

```json
{
  "format": "folio/doc",
  "version": 1,
  "meta": { "title": "Weekly report", "lang": "en" },
  "blocks": [
    { "type": "heading", "text": "Weekly report" },
    { "text": "A paragraph of plain text." },
    { "md": "A paragraph with **bold**, *italic* and a [link](https://example.org)." },
    { "type": "heading", "level": 2, "text": "Tasks" },
    { "type": "list", "items": ["First", { "text": "A sub-point", "level": 1 }, "Second"] },
    { "type": "list", "style": "number", "items": ["Step one", "Step two"] },
    { "type": "table", "rows": [["Item", "Cost"], ["Paper", "12 €"]] },
    { "type": "quote", "text": "A quotation." },
    { "type": "code", "language": "python", "text": "print('hello')" },
    { "type": "divider" }
  ]
}
```

## 3. Reference

### Document

| Field | Type | Default | Notes |
|---|---|---|---|
| `format` | string | — | Always `"folio/doc"`. |
| `version` | integer | `1` | Format version. |
| `id` | string | created | 6–64 characters `A–Z a–z 0–9 _ -`. Leave out for a new document. |
| `meta` | object | — | See below. |
| `page` | object | A4 portrait | Paper, orientation, margins, numbering. See *Pages*. |
| `headers`, `footers` | object | empty | `{ "default", "first", "even" }`: blocks shown on every page. |
| `notes` | object | 1, 2, 3 and i, ii, iii | How footnotes and endnotes are numbered. See *Notes*. |
| `math` | object | no macros | `{ "macros": "…" }`: LaTeX definitions shared by every formula. See *Equations*. |
| `comments` | array | `[]` | Comment threads about passages of the text. See *Comments*. |
| `trackChanges` | boolean | `false` | Track changes: what people add or delete is marked until accepted. See *Tracked changes*. |
| `template` | boolean | `false` | A template: each opening starts a new document from it. Leave it out unless asked for a template. |
| `readOnly` | boolean | `false` | A read-only copy: opens in reading view. Leave it out unless asked. |
| `terms` | array | `[]` | Glossary terms and abbreviations, defined once. See *More blocks*. |
| `formsOnly` | boolean | `false` | A protected form: only the form fields can be filled in. |
| `goal` | object | none | A writing goal: `{ "words": 1500, "deadline": "2026-12-01" }`. |
| `hyphenate` | boolean | `false` | Automatic hyphenation. |
| `lineNumbers` | `true` or object | none | Line numbers in the left margin. See *More blocks*. |
| `mailMerge` | object | none | Mail merge: the list of recipients and how to merge. See *Mail merge*. |
| `sources` | array | `[]` | Sources cited by `cite` runs and listed by `bibliography` blocks. See *References and citations*. |
| `citationStyle` | string | `"apa"` | `apa`, `mla`, `chicago` (author-date), `harvard`, `ieee` (numbered), `iso690`. |
| `theme` | object | `folio` theme | Colours and fonts defined once. See *Theme and styles*. |
| `styles` | object | `{}` | Changed built-in styles and your own styles, by id. |
| `fonts` | array | `[]` | Fonts embedded in the document (rarely needed). `{ family, src, weight, italic, unicodeRange }`. |
| `blocks` | array | `[]` | The content, top to bottom. A plain string is a paragraph. |
| `markdown` | string | — | The whole content as Markdown, *instead of* `blocks`. |
| `assets` | object | `{}` | Pictures (and fonts) as `data:` URIs in base64, by id, used as `"asset:<id>"`. |
| `key` | string | — | With several documents in the file: a short name for this one (a letter, then letters, digits, `_`). See *Several documents in one file*. |
| `documents` | array | none | More documents in the same file, each complete and independent, shown as tabs. Only in the first document. |

### `meta`

| Field | Type | Notes |
|---|---|---|
| `title` | string | Browser tab and suggested file name. Always set it. |
| `author`, `subject`, `organization` | string | |
| `keywords` | array of strings | A comma-separated string is accepted too. |
| `lang` | string | Language of the text: `"fr"`, `"en"`, `"en-GB"`… Used for spell checking. |
| `created`, `modified` | ISO 8601 date | Set by the app. Leave them out. |

### Blocks

`type` may be left out for a paragraph.

| `type` | Fields | Notes |
|---|---|---|
| `paragraph` | text, `style`, paragraph options | `style`: `"title"`, `"subtitle"`, `"caption"` or one of yours. |
| `heading` | `level` 1–6 (default 1), text, paragraph options | One level-1 heading for the title. |
| `list` | `style` `"bullet"` (default), `"number"` or `"check"`, `start` (default 1), `items`, `numbering`, `bullet`, `continue` | A check list item may have `"checked": true`. |
| `quote` | text, or `blocks` | A block quotation. |
| `code` | `language` (default `""`), `text` | `text` holds the code, `\n` between lines. Highlighted by language. |
| `table` | `header` (default `true`), `rows`, `style`, `widths`, `align`, `firstColumn`, `border` | `rows` is an array of rows; a row is an array of cells. |
| `chart` | `kind` (`"bar"`, `"line"`, `"pie"`), `title`, `labels`, `series`, or `rows`; `legend`, `horizontal` | A chart drawn from its own data. See *More blocks*. |
| `diagram` | `kind` (`"list"`, `"process"`, `"cycle"`, `"hierarchy"`, `"pyramid"`, `"radial"`), `title`, `items` (strings or `{ "text", "level" }`), `color` | A diagram drawn from a short list (like SmartArt). See *More blocks*. |
| shape (inline) | `shape` (preset name: `rect`, `roundRect`, `ellipse`, `rightArrow`, `star5`, `wedgeRectCallout`, `flowChartDecision`, `line`…, or `textBox`, `picture`, `group`), `x`, `y`, `width`, `height` (points), `wrap`, `fill`, `line`, `lineWidth`, `text`/`md`/`blocks`, `rotate`, `children`, `src` (picture) | A shape, text box, freely placed picture or group anchored in a paragraph's `content`. See *Shapes and text boxes*. |
| `pictures` | `layout` (`"grid"`, `"strip"`, `"featured"`, `"process"`, `"list"`, `"mosaic"`), `title`, `items` (`{ "src", "caption", "text" }`, at most 12), `color` | Pictures arranged with their captions (a picture layout). See *More blocks*. |
| `callout` | `kind` (`"note"`, `"tip"`, `"important"`, `"warning"`, `"caution"`), `title`, text or `blocks` | A box that sets a passage apart. |
| `glossary`, `abbreviations` | `title`, `all` | The terms of `terms` used in the text, always up to date. |
| `image` | `src`, `alt`, `caption`, `width`, `align`, `wrap`, `crop`, `rotate`, `flip`, `border` | See *Pictures*. |
| `pagebreak` | — | Start a new page. |
| `columns` | `count` (2–6, default 2), `gap` (pt), `rule`, `blocks` | Text in balanced columns; a `columnbreak` block inside moves to the next column. |
| `section` | `start` (`"page"`, `"odd"`, `"even"`), `numberStart`, `numberFormat`, `firstPage`, `headers`, `footers` | Top level only. What follows starts a new page; settings left out continue those of the previous section. |
| `toc` | `levels` (1–6, default 3), `title` | A table of contents of the headings, with page numbers, always up to date. Put it after the title of a long document. |
| `equation` | `tex`, `numbered` (default `false`) | A centred formula in LaTeX. See *Equations*. |
| `divider` | — | A horizontal line. |

**Paragraph options** (paragraphs, headings, list items), all optional:
`align` (`"left"`, `"center"`, `"right"`, `"justify"`), `indent`
`{ "left", "right", "first" }` and `spacing` `{ "before", "after" }` in
points (72 pt = 1 inch; a negative `first` is a hanging indent), `line`
(line spacing as a multiple: 1, 1.15, 1.5, 2), `keepNext`, `keepLines`,
`pageBreakBefore` (`true`), `shading` and `border` (a colour), `dropCap` (the
first letter over 2 to 10 lines), `dir` (`"rtl"` for Arabic or Hebrew
paragraphs; left out, the direction follows the text), `noLineNumbers`
(`true`). Leave them out to follow the style. In a right-to-left paragraph,
`"left"` and `"right"` mean its start and its end.

**List options:** `numbering` — `"default"` (1. a. i. by level), `"decimal"`,
`"alpha"`, `"ALPHA"`, `"roman"`, `"ROMAN"`, `"outline"` (1. 1.1. 1.1.1.) —
for numbered lists; `bullet` (one character, such as `"–"` or `"✓"`) for
bulleted lists; `continue: true` makes a numbered list carry on from the
previous one.

**Table options:** `style` — `"grid"` (default), `"lines"`, `"zebra"`,
`"boxed"`, `"minimal"`; `widths` — one width per column, in points;
`align` — `"center"` or `"right"`; `firstColumn: true` to emphasise the first
column; `border` — a colour. Cells may have `bg` (a colour), `valign`
(`"middle"`, `"bottom"`) and `textDir` (`"tbrl"`: vertical, top to bottom;
`"btlr"`: bottom to top — for narrow header cells).

**Colours** are `"#rrggbb"` or a theme colour: `"text"`, `"accent1"` …
`"accent6"`. Theme colours follow the theme when it changes: prefer them.

**Text** — a paragraph, heading, list item, quote or cell takes exactly one of:

- `"text"`: plain text, used as is. `\n` is a line break inside the paragraph.
- `"md"`: Markdown — `**bold**`, `*italic*`, `++underline++`, `~~strike~~`,
  `` `code` ``, `^superscript^`, `~subscript~`, `[link](https://…)`. HTML is
  never interpreted; it stays text. In a paragraph, `md` may hold several
  paragraphs, headings or lists: they become separate blocks.
- `"content"`: runs of text. A string is a plain run; an object is
  `{ "text": "…", "bold": true, "italic": true, "underline": true, "strike": true, "code": true, "sup": true, "sub": true, "link": "https://…" }`
  with only the flags you need. A run may also have `caps`, `smallcaps`,
  `color`, `highlight` (`"yellow"`, `"green"`, `"cyan"`, `"pink"`, `"blue"`,
  `"red"`, `"orange"`, `"purple"`, `"gray"` or `"#rrggbb"`), `font` (a family,
  or `"heading"`, `"body"`, `"mono"` for the theme fonts), `size` in points,
  `letterSpacing` in points and `lang`. Underlines can have `underlineStyle`
  (`"double"`, `"thick"`, `"dotted"`, `"dashed"`, `"wavy"`) and
  `underlineColor`; text effects are `outline` and `shadow` (`true`) and `glow`
  (a colour); `textBorder` and `textShading` (colours) box or shade a passage.
- **Fields** are computed when the document is shown: in `md`, write
  `{{page}}`, `{{pages}}`, `{{title}}`, `{{author}}`, `{{subject}}`,
  `{{organization}}`, `{{keywords}}`, `{{date}}`, `{{time}}`, `{{created}}`,
  `{{modified}}`, `{{filename}}`; a date takes a pattern:
  `{{date:DD/MM/YYYY}}`, `{{date:dddd D MMMM YYYY}}`, `{{time:HH:mm}}`. In
  `content`, a field is `{ "type": "field", "name": "page" }`. Write `\{{` to
  keep the braces as text.
- **Notes** are numbered automatically: in `md`, write `^[the note]` right
  after the word it explains. In `content`, a note is a run
  `{ "type": "note", "text": "…" }`. See *Notes*.
- **Formulas** in the line: in `md`, write LaTeX between `$…$` (or `\\(…\\)`);
  in `content`, a formula is `{ "type": "math", "tex": "x^2" }`. See *Equations*.

```json
{
  "format": "folio/doc",
  "version": 1,
  "blocks": [
    { "content": ["Water is H", { "text": "2", "sub": true }, "O. See ", { "text": "the source", "link": "https://example.org" }, "."] }
  ]
}
```

**List items** are strings (plain text, top level) or objects with a text
field and, for nesting, a `level` from 0 to 8. Go one level deeper at a time.
A nested level inherits the parent's style unless the item says otherwise:

```json
{
  "format": "folio/doc",
  "version": 1,
  "blocks": [
    {
      "type": "list",
      "style": "number",
      "items": [
        "Prepare the room",
        { "text": "Chairs", "level": 1, "style": "bullet" },
        { "text": "Projector", "level": 1 },
        "Welcome the guests"
      ]
    }
  ]
}
```

**Table cells** are strings, or objects with a text field (or `blocks`) and
`colspan` / `rowspan` (default 1):

```json
{
  "format": "folio/doc",
  "version": 1,
  "blocks": [
    {
      "type": "table",
      "rows": [
        ["Quarter", "Revenue", "Margin"],
        ["Q1", "120 k€", "18 %"],
        [{ "md": "**Total**" }, { "text": "120 k€", "colspan": 2 }]
      ]
    }
  ]
}
```

### More blocks

**Charts.** Give the categories in `labels` and one or more `series`, each
with a `name` and one number per label (`null` for none). A pie chart shows the
first series. Instead of `labels` and `series`, `rows` may give the data like
a table: the first row names the series, the first column gives the labels.

```json
{
  "format": "folio/doc",
  "version": 1,
  "blocks": [
    { "type": "chart", "kind": "bar", "title": "Visitors", "labels": ["Jan", "Feb", "Mar"], "series": [{ "name": "2025", "values": [120, 95, 140] }, { "name": "2026", "values": [130, 110, null] }] },
    { "type": "chart", "kind": "pie", "title": "Budget", "rows": [["", "€"], ["Rent", 820], ["Food", 350], ["Leisure", 120]] }
  ]
}
```

**Diagrams** turn a short list into a drawing: steps joined by arrows
(`process`), steps around a circle (`cycle`), an organisation chart from the
levels (`hierarchy`), layers (`pyramid`), a centre with items around it
(`radial`), or stacked bars (`list`). A sub-item has `"level": 1` and belongs
to the item before it. `color` is `"colorful"` (default) or one theme colour.

```json
{
  "format": "folio/doc",
  "version": 1,
  "blocks": [
    { "type": "diagram", "kind": "process", "title": "Hiring", "items": ["Apply", "Interview", "Offer", "First day"] },
    { "type": "diagram", "kind": "hierarchy", "items": ["Director", { "text": "Sales", "level": 1 }, { "text": "Support", "level": 1 }, { "text": "Paris office", "level": 2 }] }
  ]
}
```

**Shapes and text boxes** sit in a paragraph's `content` (put them first) and
are placed freely on the page: `x` from the left margin, `y` from the top of that
paragraph, in points (A4 text is about 470 pt wide). `wrap` is `front`
(default for a shape), `behind`, `square` (default for a text box: the text goes
around it), `topBottom` or `inline` (a big character in the line). The shape
names are the preset names of .docx files (`rect`, `roundRect`, `ellipse`,
`triangle`, `diamond`, `rightArrow`, `chevron`, `star5`, `cloud`,
`wedgeRoundRectCallout`, `flowChartProcess`, `flowChartDecision`, `line`…; see
the JSON Schema for all 140). Lines take `tail`/`head` (`triangle` for an
arrow). `fill` and `line` are theme colours, `#rrggbb` or `"none"`. A group
(`"shape": "group"`) holds `children` placed from its top-left corner. A
picture placed freely is `"shape": "picture"` with `src` (`"asset:<id>"` or a
`data:image/…` URI), `alt`, and optionally `crop` and `adjust` as for an
`image` block; the text goes around it (`square`) unless `wrap` says otherwise.
Use an `image` block for a picture that sits on its own line with a caption.

```json
{
  "format": "folio/doc",
  "version": 1,
  "assets": { "photo": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGM4oaEBRwzIHAB22gjB9Lr9UAAAAABJRU5ErkJggg==" },
  "blocks": [
    { "content": [
      { "type": "shape", "shape": "textBox", "x": 300, "y": 0, "width": 170, "height": 90, "md": "**Did you know?** Shapes follow their paragraph." },
      "The paragraph text flows around the text box on the right."
    ] },
    { "content": [
      { "type": "shape", "shape": "group", "x": 60, "y": 6, "wrap": "topBottom", "children": [
        { "type": "shape", "shape": "flowChartDecision", "x": 0, "y": 0, "width": 110, "height": 64, "text": "Ready?" },
        { "type": "shape", "shape": "line", "x": 110, "y": 32, "width": 60, "height": 0, "tail": "triangle" },
        { "type": "shape", "shape": "flowChartTerminator", "x": 170, "y": 12, "width": 100, "height": 40, "fill": "accent3", "text": "Ship it" }
      ] },
      "A small flowchart above this line."
    ] },
    { "content": [
      { "type": "shape", "shape": "picture", "src": "asset:photo", "alt": "The harbour at dawn", "x": 330, "y": 0, "width": 140, "height": 95 },
      "This paragraph flows around a picture placed at the right of the page."
    ] }
  ]
}
```

**Picture layouts** (`pictures`) arrange pictures with their captions: a grid
with the caption and text under each picture (`grid`), tall pictures side by
side with the caption in a coloured band (`strip`), the first picture large and
the others beside it (`featured`), pictures joined by arrows (`process`), round
pictures with the text beside them (`list`), or a mosaic where the first
picture takes two by two cells (`mosaic`). Each picture is cropped to fill its
frame. `src` works like an image's: `"asset:<id>"` with the data in `assets`.
Without `src`, the frame stays empty (a soft placeholder) for the reader to
fill in by double-clicking: useful when you write the captions but have no
pictures. A plain string is a caption with an empty frame.

```json
{
  "format": "folio/doc",
  "version": 1,
  "blocks": [
    { "type": "pictures", "layout": "process", "title": "Repotting a plant", "items": [
      { "caption": "Water the day before" },
      { "caption": "Loosen the roots", "text": "Tease them apart gently." },
      { "caption": "Fresh soil, a size up" }
    ] }
  ]
}
```

With pictures, each `src` names an asset, as for an image:
`{ "src": "asset:market", "caption": "Market morning" }` with
`"assets": { "market": "data:image/jpeg;base64,/9j/4AAQ…" }` at the top level.

**Callouts** hold text (`text`, `md`, `content`) or `blocks`:
`{ "type": "callout", "kind": "tip", "md": "Press **F3** to insert a snippet." }`.

**Glossary and abbreviations.** Define each term once in `terms`
(`{ "term": "WHO", "definition": "World Health Organization", "kind": "abbreviation" }`;
`kind` is `"glossary"` by default), then put a `glossary` or `abbreviations`
block where the list should appear.

**Form fields** are runs: `{ "type": "formfield", "kind": "text", "name": "Name", "placeholder": "Your name" }`;
`kind` may be `"dropdown"` (with `options`), `"date"` (`value` YYYY-MM-DD) or
`"checkbox"` (`checked`). Set `"formsOnly": true` to protect the rest of the
document.

**Attached files** are runs too: `{ "type": "attachment", "src": "asset:f1", "name": "budget.xlsx", "size": 48213, "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }`,
with `assets.f1` a `data:application/octet-stream;base64,…` URI (no other data
type is accepted for a file). They are shown as a chip that saves the file on
double-click. Not inside notes.

**Line numbers** — `"lineNumbers": true`, or
`{ "restart": "page", "start": 1, "countBy": 5, "distance": 18 }` (`restart`:
`"continuous"`, `"page"` or `"section"`; `distance` in points). They show in
page view, when printing and in PDF; tables and notes are not numbered.

### Theme and styles

The theme defines the document's colours and fonts once. Built-in themes:
`folio` (default), `classic`, `modern`, `slate`, `ink`, `system`; change any
part of it. Built-in fonts: `"Hanken Grotesk"` (sans serif), `"Newsreader"`
(serif), `"JetBrains Mono"` (monospace).

Styles are named: `normal`, `title`, `subtitle`, `heading1` … `heading6`,
`quote`, `code`, `caption`, `footnote` (the text of notes). Change a built-in style field by field, or define
your own (with a `name`) and use it as a paragraph `style`:

```json
{
  "format": "folio/doc",
  "version": 1,
  "meta": { "title": "Field trip", "lang": "en" },
  "theme": { "name": "modern", "colors": { "accent1": "#0f766e" } },
  "styles": {
    "heading1": { "color": "accent1" },
    "tip": { "name": "Tip", "basedOn": "normal", "italic": true, "color": "accent2", "shading": "#f1f5f4" }
  },
  "blocks": [
    { "type": "paragraph", "style": "title", "text": "Field trip" },
    { "type": "paragraph", "style": "subtitle", "text": "Saturday 14 March" },
    { "type": "heading", "text": "Programme" },
    { "md": "Meet at the station at **8:30**.", "align": "justify" },
    { "type": "paragraph", "style": "tip", "text": "Bring a raincoat." },
    { "md": "Page {{page}} of {{pages}} · printed {{date:DD/MM/YYYY}}", "align": "center" }
  ]
}
```

### Pictures

A picture is an `image` block. Its data goes in `assets`, as a base64 `data:`
URI (PNG, JPEG, GIF, WebP, SVG or AVIF), and the block refers to it with
`"asset:<id>"` (a `data:` URI directly in `src` is accepted too and moved to
`assets`). An `https://` address is kept, but the app loads it only when the
reader asks, since that needs a connection. Always give `alt`.

```json
{
  "format": "folio/doc",
  "version": 1,
  "blocks": [
    {
      "type": "image",
      "src": "asset:dot",
      "alt": "A small red square",
      "caption": "Figure 1. A test picture",
      "width": 120,
      "align": "center"
    },
    { "type": "pagebreak" },
    { "md": "Text after the page break." }
  ],
  "assets": {
    "dot": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
  }
}
```

`width` is in points (the text of a page is about 470 pt wide; `0` or absent:
natural size). `wrap` is `"none"` (on its own line, default), `"left"` or
`"right"` (floating on that side, text flowing around its box), `"tight"` or
`"through"` (text follows the outline of a picture with transparent areas,
such as a PNG cut-out; the side comes from `align`), `"behind"` or `"front"`
(behind or in front of the text, at its place, taking no room: a background
picture or a stamp). Optional: `crop`
`{ "top", "right", "bottom", "left" }` in percent, `rotate` (90, 180, 270),
`flip` (`"h"`, `"v"`, `"hv"`), `border` (a colour), `height` (only to
stretch the picture on purpose), and `adjust` for corrections and effects:
`brightness` and `contrast` (−100 to 100), `saturation` (0 to 400, 100 is
unchanged), `recolor` (`"grayscale"`, `"sepia"`, `"washout"`, `"blackwhite"`),
`artistic` (`"blur"`, `"pencil"`, `"negative"`), `transparency` (0 to 95),
`shadow` (`true`), `glow` (a colour) and `softEdges` (points).

**Watermark and hyphenation.** A top-level `watermark` puts a text or a picture
behind the text of every page; `"hyphenate": true` splits long words at the
end of lines, by the rules of the document language:

```json
{
  "format": "folio/doc",
  "version": 1,
  "meta": { "title": "Budget 2027", "lang": "en" },
  "hyphenate": true,
  "watermark": { "text": "DRAFT", "color": "#9aa0a6", "diagonal": true, "opacity": 35 },
  "blocks": [{ "text": "Figures to be confirmed.", "dropCap": 2 }]
}
```

`watermark` takes `text` (or `image`: `"asset:<id>"` with `scale`, its width in
percent of the text), `color`, `diagonal`, `opacity` (5 to 100) and `size`
(points; 0 fits the page).

### Pages

The document is laid out in pages. `page` sets the paper (`size`: `"A4"`,
`"A5"`, `"A3"`, `"B5"`, `"Letter"`, `"Legal"`, `"Tabloid"`, `"Executive"`, or
`"custom"` with `width` and `height` in millimetres), `orientation`
(`"portrait"`, `"landscape"`), `margins` in millimetres, the distance of the
`header` and `footer` from the edge, `firstPage` (a different first page),
`evenOdd` (different even pages), `numberStart`, `numberFormat` (`"decimal"`,
`"roman"`, `"ROMAN"`, `"alpha"`, `"ALPHA"`), `background` and `border`
colours.

`headers` and `footers` hold blocks (paragraphs, images, small tables) for
`default` pages, the `first` page and `even` pages. Fields give page numbers:

```json
{
  "format": "folio/doc",
  "version": 1,
  "meta": { "title": "Annual report", "lang": "en" },
  "page": { "size": "Letter", "margins": { "top": 25, "right": 20, "bottom": 25, "left": 20 }, "numberFormat": "roman" },
  "headers": { "default": [{ "md": "{{title}}", "align": "right" }] },
  "footers": { "default": [{ "md": "Page {{page}} of {{pages}}", "align": "center" }] },
  "blocks": [
    { "type": "paragraph", "style": "title", "text": "Annual report" },
    { "md": "Preface, numbered i, ii, iii." },
    { "type": "section", "start": "odd", "numberStart": 1, "numberFormat": "decimal", "headers": { "default": [{ "md": "Chapter 1", "align": "right" }] } },
    { "type": "heading", "text": "1. Results" },
    { "type": "columns", "count": 2, "rule": true, "blocks": [{ "md": "Left column." }, { "type": "columnbreak" }, { "md": "Right column." }] }
  ]
}
```

A **section** can change the paper: `{ "type": "section", "page": { "size": "A4",
"orientation": "landscape", "margins": { … } } }` puts what follows on
landscape pages (a wide table, a chart); a later section with
`"page": { "orientation": "portrait" }` comes back. Without `page`, a section
keeps the previous section's paper. A table with `"repeatHeader": true`
repeats its header row at the top of every page it continues on.

### Notes

A footnote goes at the bottom of the page where it is called; an endnote goes
after the text, at the end of the document. Both are numbered automatically
(footnotes 1, 2, 3; endnotes i, ii, iii) and the numbers follow every change.

- In `md` (and in the document's `markdown`): `^[the note]`, or `[^1]` with the
  definition `[^1]: the note` on a line of its own (indent following lines by
  four spaces). Markdown notes are footnotes.
- In `content`: `{ "type": "note", "text": "…" }`, with `"kind": "end"` for an
  endnote (`"type": "footnote"` and `"type": "endnote"` work too). Use `md`
  instead of `text` for formatting, or `blocks` for several paragraphs or a
  list. A note holds paragraphs, lists and code only; it cannot hold another
  note, and there are no notes in headers or footers.
- `notes` at the top level changes the numbering: `format` (`"decimal"`,
  `"roman"`, `"ROMAN"`, `"alpha"`, `"ALPHA"`, `"symbols"` for *, †, ‡…),
  `start`, and `restart` (`"continuous"`, `"section"`, or `"page"` for
  footnotes).

```json
{
  "format": "folio/doc",
  "version": 1,
  "meta": { "title": "Reading notes", "lang": "en" },
  "notes": { "foot": { "format": "symbols", "restart": "page" } },
  "blocks": [
    { "type": "heading", "text": "Reading notes" },
    { "md": "The first edition sold out in a week.^[Publisher's catalogue, 1998, p. 4.]" },
    {
      "content": [
        "The method was later refined",
        { "type": "note", "kind": "end", "md": "See *Methods in Practice*, chapter 3." },
        " by several teams."
      ]
    }
  ]
}
```

### Equations

Formulas are written in LaTeX and drawn by the browser (MathML), with no
picture and no extra font.

- **In the line:** in `md`, `$E = mc^2$` — no space just inside the `$`
  signs, so a price such as `5 $ et 10 $` stays text. `\\(…\\)` works too.
  In `content`: `{ "type": "math", "tex": "E = mc^2" }`.
- **Centred:** a block `{ "type": "equation", "tex": "…" }`, or a paragraph
  whose `md` is only `$$…$$` (or `\\[…\\]`).
- **Numbered:** `"numbered": true` puts (1), (2)… on the right, in order. Put
  `\\label{name}` in the equation and write `\\eqref{name}` (gives "(2)") or
  `\\ref{name}` (gives "2") in another formula to refer to it.
- **Supported:** fractions, roots, scripts, sums and integrals with limits,
  `\\left…\\right`, matrices (`pmatrix`, `bmatrix`…), `cases`, `aligned`,
  `array`, accents, `\\mathbb`, `\\mathcal`, `\\text`, colours
  (`\\textcolor`), `\\boxed`, chemistry `\\ce{2H2 + O2 -> 2H2O}` and units
  `\\pu{9.81 m/s^2}`.
- **Macros:** `\\newcommand` and `\\DeclareMathOperator` work inside a
  formula; definitions shared by the whole document go in the top-level
  `"math": { "macros": "\\newcommand{\\R}{\\mathbb{R}}" }`.
- A formula carries no text formatting (bold, size…): put it in the LaTeX
  (`\\mathbf`, `\\large`, `\\textcolor`). Equations may go in table cells and
  notes. A formula that cannot be read is shown as its source, underlined, with
  the reason.

```json
{
  "format": "folio/doc",
  "version": 1,
  "math": { "macros": "\\newcommand{\\R}{\\mathbb{R}}" },
  "blocks": [
    { "md": "For every $x \\in \\R$, the square $x^2$ is never negative." },
    { "type": "equation", "tex": "a^2 + b^2 = c^2 \\label{pyth}", "numbered": true },
    { "md": "Equation $\\eqref{pyth}$ is Pythagoras’ theorem. Water: $\\ce{H2O}$." }
  ]
}
```

### Comments

Add comments only when you are asked to review a document. A comment thread
lives in the top-level `comments` array; the text it is about carries its id in
`comments` (several comments may cover the same text). Comments never print.

| Field | Type | Notes |
|---|---|---|
| `id` | string | `A–Z a–z 0–9 _ -`, unique. |
| `author`, `date` | string | Who and when (ISO 8601). |
| `text` | string | The comment, plain text. |
| `resolved` | boolean | Marked as done (default `false`). |
| `replies` | array | `{ "author", "date", "text" }`, oldest first. |

```json
{
  "format": "folio/doc",
  "version": 1,
  "comments": [
    { "id": "c1", "author": "Reviewer", "date": "2026-11-09T10:00:00Z", "text": "Which year is this figure from?" }
  ],
  "blocks": [
    { "content": ["Sales grew by ", { "text": "12 %", "comments": ["c1"] }, " over the period."] }
  ]
}
```

A comment whose text has been deleted stays in the list until someone deletes
it. There are no comments in headers, footers or notes.

### Tracked changes

When a person asks you to *suggest* edits rather than make them, mark them as
tracked changes: a run with `inserted` is proposed new text, a run with
`deleted` is text proposed for removal (it stays visible, struck through, until
someone accepts the change). Both take `{ "author", "date" }`. Set
`"trackChanges": true` so that the person's own edits are tracked too.

```json
{
  "format": "folio/doc",
  "version": 1,
  "trackChanges": true,
  "blocks": [
    {
      "content": [
        "The meeting is on ",
        { "text": "Tuesday", "deleted": { "author": "AI", "date": "2026-11-09T10:00:00Z" } },
        { "text": "Thursday", "inserted": { "author": "AI", "date": "2026-11-09T10:00:00Z" } },
        " at 10."
      ]
    }
  ]
}
```

### Mail merge

Use it only when asked for a form letter, labels, envelopes or a message sent
to several people. The document is written once with **merge fields**; the
list of recipients lives in the top-level `mailMerge` and travels with the
file. The person then previews the result and merges (Mailings → Finish &
Merge) into one copy per recipient.

A merge field is a run `{ "type": "mergefield", "name": "<column>" }` (it may
carry the usual marks, such as `"bold": true`); in `md`, write
`{{merge:<column>}}`. Special fields take `opts` (all strings):

| `name` | Gives | `opts` |
|---|---|---|
| a column | that recipient's value | — |
| `@address` | the address block (name, company, street, postal code and city, country if foreign) | `company` (`"yes"`/`"no"`), `country` (`"always"`, `"never"`, `"foreign"`), `home` (the home country) |
| `@greeting` | "Dear Ada," | `salutation`, `nameFormat` (`first`, `full`, `title-last`, `last`), `punct`, `fallback` (when the name is missing) |
| `@if` | text depending on a condition | `field`, `op`, `value`, `then`, `else` (may contain «Column») |
| `@skipif` | nothing; leaves the recipient out when true | `field`, `op`, `value` |
| `@next`, `@nextif` | moves to the next recipient in the same copy (labels, lists) | `@nextif`: `field`, `op`, `value` |
| `@fillin` | an answer asked once when merging | `prompt`, `default` |
| `@record`, `@sequence` | the recipient's number in the list, the copy's number | — |

`op` is one of `eq`, `ne`, `lt`, `gt`, `le`, `ge`, `empty`, `notEmpty`,
`contains`; numbers compare as numbers, text ignores case.

`mailMerge` fields:

| Field | Notes |
|---|---|
| `type` | `letters` (default), `emails`, `envelopes`, `labels`, `directory`. |
| `source` | `{ "name", "fields": [column names], "records": [[one value per column], …], "excluded": [row indices left out] }`. |
| `map` | Which column holds each address part: `title`, `first`, `last`, `company`, `address1`, `address2`, `city`, `state`, `postal`, `country`, `email`, `phone`. Needed by `@address` and `@greeting`. |
| `filters` | `[{ "field", "op", "value" }]`: only matching recipients are merged. |
| `sort` | `{ "field", "desc": true }`. |
| `email` | For `emails`: `{ "to": "<column>", "subject": "… «Column» …" }`. |
| `label` | For `labels`, in mm: `{ "name", "pageWidth", "pageHeight", "cols", "rows", "width", "height", "top", "left", "hgap", "vgap" }`. |

```json
{
  "format": "folio/doc",
  "version": 1,
  "meta": { "title": "Workshop invitation", "lang": "en" },
  "mailMerge": {
    "type": "letters",
    "source": {
      "name": "participants",
      "fields": ["First name", "Last name", "City", "Seats"],
      "records": [["Ada", "Okafor", "Leeds", "2"], ["Tom", "Becker", "York", "1"]]
    },
    "map": { "first": "First name", "last": "Last name", "city": "City" }
  },
  "blocks": [
    { "content": [{ "type": "mergefield", "name": "@greeting", "opts": { "salutation": "Dear" } }] },
    { "md": "We have kept {{merge:Seats}} seat(s) for you at the workshop in {{merge:City}}." },
    { "content": [{ "type": "mergefield", "name": "@if", "opts": { "field": "Seats", "op": "gt", "value": "1", "then": "Your guests are welcome too.", "else": "" } }] }
  ]
}
```

Do not invent recipients: if the person gave no list, write the fields and
leave `records` empty (or leave out `mailMerge`) so that they add their own.

### References and citations

Everything below is computed by the app and stays up to date: numbers,
page numbers, the order of the bibliography. Write the structure; never type
a number that the app can compute.

**Sources and citations.** List the works once in `sources`, cite them with
`cite` runs, and put a `bibliography` block where the list should appear
(usually at the end, after a "References" heading or with its own `title`).

| Source field | Notes |
|---|---|
| `id` | Required. Short tag used by `cite`: letters, digits, `_ : . -` (for example `Darwin1859`). |
| `type` | `book` (default), `article` (journal), `chapter` (in a book), `website`, `report`, `thesis`, `conference`, `film`, `interview`, `other`. |
| `authors` | Array of `"Last, First"`; an organisation as is (`"World Health Organization"`). |
| `title` | Title of the work. |
| `container` | Journal, book (for a chapter), website or conference. |
| `editors`, `publisher`, `place`, `year`, `volume`, `issue`, `pages`, `edition` | Strings. |
| `url`, `doi`, `isbn`, `accessed` | `doi` without `https://doi.org/`; `accessed` as an ISO date for websites. |

```json
{
  "format": "folio/doc",
  "version": 1,
  "meta": { "title": "Heredity", "lang": "en" },
  "citationStyle": "apa",
  "sources": [
    { "id": "Watson1953", "type": "article", "authors": ["Watson, James D.", "Crick, Francis H. C."], "title": "Molecular structure of nucleic acids", "container": "Nature", "volume": "171", "issue": "4356", "pages": "737-738", "year": "1953", "doi": "10.1038/171737a0" }
  ],
  "blocks": [
    { "content": ["The double helix was described in 1953 ", { "type": "cite", "id": "Watson1953", "locator": "p. 737" }, "."] },
    { "type": "bibliography", "title": "References" }
  ]
}
```

The citation is shown as *(Watson & Crick, 1953, p. 737)* in APA, *[1, p. 737]*
in IEEE. `cite` takes `id` (one source) or `ids` (several). `bibliography`
lists the cited sources; `"all": true` lists every source.

**Captions.** A caption is a paragraph with `"style": "caption"` (or an image
`caption`) holding the label word and a `seq` run, which the app numbers per
label in document order:

```json
{
  "format": "folio/doc",
  "version": 1,
  "blocks": [
    { "type": "paragraph", "style": "caption", "content": ["Table ", { "type": "seq", "label": "table" }, ": Monthly sales"] },
    { "type": "figures", "label": "table", "title": "List of tables" }
  ]
}
```

`label` is `figure`, `table`, `equation` or your own word. A `figures` block
(`{ "type": "figures", "label": "table", "title": "List of tables" }`) lists
the captions of a label with their pages.

**Bookmarks and cross-references.** Put a `bookmark` run (invisible) in the
paragraph you want to refer to, and an `xref` run where you refer to it:

```json
{
  "format": "folio/doc",
  "version": 1,
  "blocks": [
    { "content": ["As ", { "type": "xref", "target": "sales", "show": "label" }, " on page ", { "type": "xref", "target": "sales", "show": "page" }, " shows, sales grew."] },
    { "type": "table", "rows": [["Month", "Sales"], ["January", "120"]] },
    { "type": "paragraph", "style": "caption", "content": [{ "type": "bookmark", "name": "sales" }, "Table ", { "type": "seq", "label": "table" }, ": Monthly sales"] }
  ]
}
```

`show`: `text` (the whole paragraph), `label` (*Table 2*), `number` (*2*),
`page`, `above` (*above* / *below*). A link `"link": "#sales"` jumps to the
bookmark too. Names start with a letter, then letters, digits and `_`.

**Index.** An `xe` run (invisible) beside a word marks an index entry:
`{ "type": "xe", "term": "photosynthesis", "sub": "light phase" }` (`see`:
a "See …" reference instead of pages; `bold` / `italic` for the page
number). An `index` block (`"columns": 2`) lists the entries alphabetically
with their pages.

**Table of authorities** (legal documents): `xe` runs with `"authority":
"cases"` (or `statutes`, `rules`, `treatises`, `regulations`,
`constitution`, `other`), `"term"` the full citation and `"short"` its short
form; an `authorities` block lists them by category.

### Several documents in one file

One file can hold several documents, shown as tabs at the bottom of the
window: a report and its annexes, the chapters of a thesis, a letter and its
attachments. Use this only when asked for several documents. The first
document carries the others in `documents`; each one is complete and
independent (its own `meta`, `page`, `headers`, `theme`, `styles`, `blocks`,
`comments`, `assets`…) and has a `key`.

```json
{
  "format": "folio/doc",
  "version": 1,
  "key": "report",
  "meta": { "title": "Annual report", "lang": "en" },
  "blocks": [
    { "type": "heading", "level": 1, "text": "Annual report" },
    { "content": ["Sales grew in every region (see ", { "type": "xref", "doc": "annex", "target": "sales", "show": "label" }, ", in ", { "text": "the annex", "link": "#annex:" }, ")."] }
  ],
  "documents": [
    {
      "key": "annex",
      "meta": { "title": "Annex A", "lang": "en" },
      "page": { "orientation": "landscape" },
      "blocks": [
        { "type": "heading", "level": 1, "text": "Annex A: figures" },
        { "type": "table", "rows": [["Region", "Sales"], ["North", "120"]] },
        { "type": "paragraph", "style": "caption", "content": [{ "type": "bookmark", "name": "sales" }, "Table ", { "type": "seq", "label": "table" }, ": Sales by region"] }
      ]
    }
  ]
}
```

- A link `"#annex:sales"` opens the document `annex` at its bookmark (or a
  heading whose text gives that anchor, `#annex:annex-a-figures`); `"#annex:"`
  opens it at the start.
- A cross-reference with `"doc": "annex"` shows the text, label or number
  of a bookmark in that document, always up to date. `"show": "page"` shows
  its page once that document has been laid out; the app keeps the last value
  in `"last"` (leave it out).
- Exporting or printing asks for the document on screen or all of them, one
  after another, each starting on a new page.

### The whole document as Markdown

```json
{
  "format": "folio/doc",
  "version": 1,
  "meta": { "title": "Meeting notes", "lang": "en" },
  "markdown": "# Meeting notes\n\n## Decisions\n\n1. Approve the budget\n2. Hire a designer\n\n| Owner | Task |\n|---|---|\n| Sam | Draft the brief |\n\n> Next meeting on Friday."
}
```

Supported: ATX and underlined headings, paragraphs, bulleted and numbered
lists (indent to nest), `>` quotations, fenced code blocks, pipe tables (with
`:---:` column alignment), `---` dividers, a picture alone on its line
(`![alt](data:… "caption")`), fields, and the inline syntax above. If both
`blocks` and `markdown` are given, `blocks` wins.

## 4. Make a good document, not just a valid one

- **Language.** Write in the language of the request and set `meta.lang`.
- **Title.** Set `meta.title`; repeat it as the single level-1 heading.
- **Structure.** Use real headings (levels 2 and 3 for sections). Never fake a
  heading with bold text, capitals or a short paragraph.
- **Data goes in tables.** Figures, comparisons, schedules, prices, specs: a
  table with a header row — not a list of numbers, not tab-separated text.
- **Lists.** Steps in order: numbered. Points in no particular order:
  bulleted. Nest only as deep as the ideas go.
- **Paragraphs.** Short and complete. No filler, no placeholders such as
  "Lorem ipsum" or "[insert name]". If you lack a fact, say so in the text.
- **Equations.** Real LaTeX formulas, never pictures or plain text: `$…$` in a
  sentence, an `equation` block for anything that deserves its own line,
  `"numbered": true` when the text refers to it. Chemistry with `\\ce{}`.
- **Code.** In `code` blocks with a `language`, never in paragraphs.
- **Sources.** A final "References" heading with a list of sources and links.
- **Look.** Pick a theme; use styles (`title`, `subtitle`, headings) and theme
  colours rather than colouring or resizing runs one by one.
- **Pictures.** Only pictures you were given or can embed as data, each with
  `alt` text, and a caption when it helps the reader.

## 5. Before you finish

- [ ] Only the `folio-doc` block changed; the rest of the file is untouched.
- [ ] The JSON parses: no trailing commas, no comments; every `<` is `<`.
- [ ] `"format": "folio/doc"` and `"version": 1` are present; `id` is absent
      (new document) or unchanged (existing document).
- [ ] `meta.title` and `meta.lang` are set.
- [ ] Headings are real headings, data is in tables, steps are numbered.
- [ ] Every picture has `alt` text, and its data in `assets` (or in `src`).
- [ ] Formulas are LaTeX (`$…$`, `equation` blocks) with no space just inside
      the `$` signs, and every `\\eqref` names an existing `\\label`.
- [ ] Every `cite` id is in `sources`; every `xref` target is a `bookmark`
      (in the document named by its `doc`, if any);
      caption and page numbers are `seq` and `xref` runs, never typed by hand.
- [ ] Nothing is invented that the request or the sources do not support.

## 6. What the app does with mistakes

Folio Pages opens a document even when it is not perfect. Each field is
checked and bounded; a field that cannot be used is **ignored** rather than
blocking the file, and the app shows "Loaded: *n* fields ignored, *n* warnings"
with the details. It repairs trailing commas and comments, accepts common
aliases (`"h2"`, `"ul"`, `"ol"`, `"blockquote"`, `"hr"`…), turns a block of
unknown type that carries text into a paragraph, and refuses unsafe links
(`javascript:`, `data:`…) while keeping their text. If the JSON cannot be read
at all, the app shows the line and column of the error and offers to recover
the text. Aim for zero warnings anyway: they mean something you wrote was not
understood.
