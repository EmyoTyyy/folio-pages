# Folio Pages

A free word processor in a single HTML file. The file is both the editor and the
document: open it in a browser, write, press <kbd>Ctrl</kbd> <kbd>S</kbd>, and
the file rewrites itself with your text. No install, no account, no server, and
it works offline.

> A *folio* is a sheet folded to make the pages of a book. Folio Pages folds the
> word processor into the page.

Website: <https://emyotyyy.github.io/folio-pages/> (source in [`docs/`](docs)) ·
App: [`folio-pages.html`](https://emyotyyy.github.io/folio-pages/folio-pages.html) ·
Guide for AIs: [`agents.md`](docs/agents.md)

The interface is in French and English. The website and the app share one
look: white paper on a neutral green-grey, green ink, Newsreader titles. This is
**version 0.15**, with an interface laid out the way word processors usually are.

---

## Using it

1. Open [`folio-pages.html`](https://emyotyyy.github.io/folio-pages/folio-pages.html),
   or download it and double-click it. It opens on a short demo document.
2. Write. **New blank document** clears the demo.
3. Save with <kbd>Ctrl</kbd> <kbd>S</kbd> (<kbd>⌘</kbd> <kbd>S</kbd> on a Mac).

| Browser | Version | Saving |
|---|---|---|
| Chrome, Edge, Brave, Opera | 111+ | Rewrites the open file in place (File System Access API). The first save asks where; later ones write straight to that file. |
| Firefox | 113+ | Downloads an up-to-date copy, which replaces the old file. |
| Safari | 16.4+ | Downloads an up-to-date copy. |

Every saved document is a complete copy of the application: send the file to
someone and they can open and edit it too.

While you write, a backup copy is kept **in your browser only**. If the tab or
the browser closes before you save, reopen the file: Folio Pages offers to
restore the changes, and warns you if the backup is older than the file.

## What it does (version 0.15)

- **A ribbon**: File first, then Home, Insert, Design, Layout, References,
  Mailings, Review, View, AI and Help, with contextual Table, Picture Format and
  Header tabs, laid out the way word processors usually are (same groups, same
  order, large buttons and columns of small ones). Features still to come are
  shown greyed out, with a tooltip saying so;
  Comments, a Mode switch (Editing, Reviewing with tracked changes, Viewing) and
  Share on the right; undo and redo next to the title; a command search box
  (<kbd>Alt</kbd> <kbd>Q</kbd>). Scrolling down folds the ribbon away (the tabs
  stay); scrolling up, or a tab, brings it back.
- **Right-click menu**, anywhere: a "Search the menus" box, Cut, Copy and the
  Paste Options row, then the commands for what was clicked (text, link,
  formula, table, picture), and a small formatting toolbar (Style and Crop for a
  picture). Around the page it acts on the nearest text; on the ribbon and the
  status bar it offers the interface commands; text fields keep the browser's
  menu. Editing shortcuts (<kbd>Ctrl</kbd> <kbd>Z</kbd>, <kbd>Ctrl</kbd> <kbd>B</kbd>…)
  work wherever the focus is, even on a ribbon button.
  <kbd>Shift</kbd>+right-click keeps the browser's own menu, with its spelling
  suggestions; <kbd>Shift</kbd> <kbd>F10</kbd> or the Menu key opens it at the cursor.
- **Equations**: LaTeX typed between `$…$` typesets as you close it, and `$$…$$`
  alone on a line makes a centred equation; <kbd>Alt</kbd> <kbd>=</kbd> or
  **Insert → Equation** opens an editor with a live preview and a palette of
  templates (double-click a formula to edit it). Centred equations can be
  numbered and cited (`\label`, `\eqref`); document-wide macros; chemistry
  (`\ce`) and units (`\pu`); matrices, cases, aligned. The browser draws them
  (MathML), so they cost no picture and no font. Pasted formulas from KaTeX
  pages (chat assistants) or Wikipedia keep their LaTeX, and plain text with
  `$…$` converts on paste or with **Convert $…$ to equations**.
- **Links**: <kbd>Ctrl</kbd>+click (<kbd>⌘</kbd>+click) follows a link while
  editing, a simple click in reading view; a bubble under a link shows its
  address, to open, edit or remove it. Links open in a new tab, cut off from the
  document.
- **Text**: bold, italic, underline, strikethrough, superscript, subscript,
  capitals and small capitals, colour, highlight, font, size, letter spacing,
  language of a passage, change case, clear formatting, format painter.
- **Paragraphs**: alignment, indents (first line, hanging), spacing, line
  spacing, keep with next, shading and borders.
- **Styles and themes**: named styles (Normal, Title, Subtitle, Heading 1–6,
  Quote, Code, Caption and your own), editable and resettable; a document theme
  (colours and fonts defined once, six presets). Three fonts are embedded
  (Hanken Grotesk, Newsreader, JetBrains Mono, SIL OFL) and you can embed your own.
- **Lists**: bullets, numbers and outline numbering (1.1.1), custom bullets,
  restart or continue numbering, levels with <kbd>Tab</kbd>.
- **Tables**: insert from a grid, add or delete rows and columns, merge and
  split cells, header row, quick styles (Grid, Lines, Striped, Boxed, Minimal),
  cell colours, column widths, sorting.
- **Pictures**: insert, paste or drop; resize with the handles; crop with the
  mouse (**Picture → Crop**, or **Crop** under the right-click menu: the whole
  picture shows dimmed, drag the black handles or move the picture under the
  frame, <kbd>Enter</kbd> to finish); rotate, flip, caption, alternative text.
  **Wrap Text**: square, tight or through (the text follows the outline of a
  picture with transparent areas), top and bottom, behind or in front of the
  text, and a default layout for the next pictures. Photos are reduced to
  2560 px; screenshots stay intact; a command compresses the document's pictures.
- **Pages**: real pages on screen, exactly as they print (paper size, portrait or
  landscape, margins); headers and footers with page numbers, a different first
  page, different even pages; section breaks that restart numbering (Roman for a
  preface, Arabic after) and have their own headers and their own paper (a
  landscape section for a wide table, printed in landscape); table header rows
  repeated on every page; text in columns; page colour and border; a ruler for
  indents and margins that follows the section; page and web views.
- **References**: footnotes and endnotes, numbered automatically (1, 2, 3;
  i, ii, iii; or symbols), restarting by section or by page, edited in place at
  the bottom of the page; a table of contents that keeps itself up to date (and
  continues on the next page when long); a navigation pane of the headings;
  numbered captions and a table of figures; bookmarks and cross-references
  (text, "Figure 2", number, page, above/below); an index and a table of
  authorities from marked entries (<kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>X</kbd>,
  <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>I</kbd>); sources, citations and a
  bibliography in APA, MLA, Chicago, Harvard, IEEE or ISO 690, a source being
  filled in from its DOI or ISBN. All of it survives a `.docx` round trip as the
  usual fields (SEQ, REF, PAGEREF, XE, TA, CITATION, INDEX, TOA, BIBLIOGRAPHY),
  with the sources in the word processor's source manager.
- **Review**: comments on any passage, with replies, resolve and reopen, in a
  side pane; tracked changes (additions underlined, deletions struck through,
  formatting changes dotted, reformatted paragraphs marked in the margin, with
  author and date), accepted or rejected one by one or all at once, shown as
  simple markup (final text, a bar beside changed paragraphs), all markup,
  final or original; **Filter Markup** and **Show Markup** hide comments,
  insertions and deletions, formatting, or chosen reviewers; the **Reviewing
  Pane** (left or bottom) lists every revision with its counts, goes to it and
  accepts or rejects it. Formatting changes travel in `.docx` as Word's own
  revisions. **Compare** sets this document against an earlier version (another
  file — Folio Pages, `.docx`, `.odt`, `.rtf`, Markdown — or a version saved in
  the browser) and opens, in a new tab, the current text with every difference
  as a tracked change: words added and removed, formatting, paragraph styles.
  Pictures, tables of another shape and code blocks that changed show in their
  new version and are counted. Your name is asked once and kept in the browser only; comments
  never print.
- **Opening**: <kbd>Ctrl</kbd> <kbd>O</kbd> opens another Folio Pages document in
  the same window (it is then saved in place on Chrome and Edge), imports
  Markdown and plain text, and says plainly what a file is when it cannot be
  opened (an empty app, an encrypted document, a presentation…); recent files
  reopen in one click on Chrome and Edge; a dropped file opens too.
- **.docx**: <kbd>Ctrl</kbd> <kbd>O</kbd> (or a drop) imports a `.docx` file; **File →
  Export as .docx…** writes one. Both run inside the file, offline: text and
  formatting, styles and theme, lists, tables (merged cells, widths, quick
  styles), pictures (cropped, rotated, floating, SVG with a PNG fallback),
  footnotes and endnotes, comments with replies and resolution, tracked
  changes, headers and footers, sections, columns, fields and the table of
  contents. A report lists anything that did not carry over.
- **Other formats**: **File → Export to Another Format…** writes an OpenDocument
  `.odt` for LibreOffice (named styles, lists, tables, footnotes and endnotes, a
  table of contents LibreOffice can update, headers and footers with page
  numbers, sections, columns, pictures, formulas as MathML objects, comments),
  an `.epub` e-book (one chapter per level-1 heading), a standalone web page
  with no script, Markdown (with an `images/` folder, zipped) or plain text.
- **Templates**: **File → New from Template…** starts from a letter, résumé,
  report, meeting minutes, invoice, thesis, recipe or worksheet, in French or
  English, either in place (Ctrl+Z goes back) or in a new tab.
- **Word-style tools**: text effects (outline, shadow, glow, character border
  and shading, underline styles and colours, ready-made decorative text), drop
  cap, automatic hyphenation and the optional hyphen (<kbd>Ctrl</kbd> <kbd>-</kbd>),
  text or picture watermark, Set as Default (theme, styles and page setup for
  new documents), Go To (<kbd>Ctrl</kbd> <kbd>G</kbd>, <kbd>F5</kbd>), select
  text with similar formatting, numbers in words or Roman numerals, four cover
  pages, a signature line (signed with the mouse or a finger), screenshots, and
  a draft view. Pictures take corrections (brightness, contrast), colour
  (saturation, greyscale, sepia, washout), artistic effects, transparency,
  shadow, glow, soft edges and reflection.
- **Diagrams** (**Insert → Diagram**, or right-click a list → Convert List to
  Diagram): a short list drawn as a list, a process, a cycle, an organisation
  chart, a pyramid or a radial diagram, in the theme colours; double-click to
  change the layout, the items (one per line, <kbd>Tab</kbd> for a sub-item),
  the title or the colours. In `.docx` and `.odt` a diagram is an SVG picture
  that becomes an editable diagram again when the file is opened in Folio
  Pages.
- **Shapes and text boxes (new in 0.15)**: **Insert → Shapes** has over 140
  shapes (lines and arrows, rectangles, basic shapes, block arrows, equation
  shapes, flowchart, stars and banners, speech bubbles), drawn on the page with
  the mouse; **Insert → Text Box** adds a box for rich text. A shape follows its
  paragraph but sits anywhere on the page: drag it, resize and rotate it with
  its handles, type inside it, and choose how the text goes around it (in line,
  square, top and bottom, behind, in front). The **Shape Format** tab has
  styles, fill, outline (weight, dashes, arrows), shadow and transparency,
  position presets, bring forward and send backward, align and distribute,
  group and ungroup, rotate and flip, and the size; the **Selection pane** lists
  every shape to rename, hide or reorder it. A shape shows its size while you
  draw it. Pictures can be placed freely too (**Wrap Text → Place freely on the
  page**, or **Insert → Pictures → Free picture…**): they move, resize (keeping
  their proportions), rotate, stack and group like shapes, keep their
  corrections, and go back into the text in one click. In `.docx` they are real
  Word shapes, text boxes and anchored pictures (and come back as such); in
  `.odt`, LibreOffice shapes and frames.
- **Picture layouts (new in 0.14)** (**Picture Format → Picture Layout**, **Insert →
  Pictures → Picture Layout…**, or right-click several selected pictures):
  pictures with their captions arranged as a grid, a strip with coloured
  caption bands, a featured picture with smaller ones beside it, steps joined
  by arrows, a list of round pictures with text, or a mosaic. The selected
  pictures become the layout (<kbd>Ctrl</kbd>+<kbd>Z</kbd> brings them back);
  double-click to add, replace, reorder or remove pictures (or drag them into
  the window), edit the captions, or change the layout and colours. In `.docx`
  and `.odt` a layout is one SVG picture that becomes an editable layout again,
  with its pictures, when the file is opened in Folio Pages.
- **Insert → Icons**: 90 free icons built into the file (Tabler Icons, MIT),
  searchable in French and English, in any theme or custom colour; inserted as
  an SVG picture named in its alternative text. **Search more icons online**
  looks through the rest of the set (over 5 000 icons, through Iconify); it is
  blocked by offline mode, and what comes back is cleaned (shapes only) before
  it is shown.
- **Insert → Object**: **Text from File** inserts the content of another
  document (Folio Pages, `.docx`, `.odt`, `.rtf`, Markdown, text) at the
  cursor; **Attached File** puts any file (up to 20 MB) in the document as a
  chip with its name and size. Double-click the chip, press <kbd>Enter</kbd> on
  it or right-click → Save Attached File to save it to the computer. The file
  is kept as plain bytes: it is never opened or run inside the page. Web page
  exports keep it as a download link; `.docx`, `.odt`, EPUB and Markdown keep
  its name only (reported for `.docx` and `.odt`).
- **AutoCorrect**: common typos, symbols (`(c)` → ©, `->` → →, `1/2` → ½),
  curly quotes and apostrophes, and the French non-breaking spaces before
  ; : ! ? and inside « ». Backspace right after a correction undoes it; the
  list can be edited (kept in the browser).
- **Saving**: save a copy, save as a new document, save as a template (each
  opening starts a new document), save a read-only copy (opens in reading
  view); a reading mode for any document, with the pages one under the other
  or **side to side** (new in 0.12: two pages per screen like an open book,
  turned with the arrows, <kbd>←</kbd> <kbd>→</kbd>, the mouse wheel or a
  swipe; one page on a narrow screen); a version history kept in the
  browser only (a version at each save and every ten minutes of editing),
  restorable and undoable.
- **Mailings**: a list of recipients (imported from CSV, TSV, JSON or a vCard
  address book, or typed in) kept inside the document; merge fields, an address
  block and a greeting line; rules (If…Then…Else, Skip record if, Next record,
  Fill-in, record and merge numbers); a preview that steps through the
  recipients; checking for errors; sending the document itself by e-mail (to
  several addresses, in the message or attached as `.html`, `.docx` or PDF); letters, e-mails (one ready-to-send message
  per recipient, opened one after the other in your mail program, Gmail or
  Outlook.com, or downloaded as formatted `.eml` drafts), envelopes, labels (common A4 and Letter
  sheets or your own) and directories. The merged document opens in a new tab,
  to edit, save or print. Merge fields and the list survive a `.docx` round trip.
- **Password protection**: **Review → Protect** encrypts the document
  (AES-256-GCM, key derived from the password with PBKDF2-SHA-256, 600 000
  iterations), title included; the file opens on a password screen. The copies
  kept in the browser (recovery, versions) are encrypted too. A lost password
  cannot be recovered.
- **Offline mode**: one switch (**Help → Offline mode**, remembered in the
  browser) blocks every network feature: web links, update checks and the
  online features below.
- **Online, if you want it**: **AI → Ask Claude / Ask ChatGPT** opens the site in
  a window beside the document with your request and the document copied, and
  **Paste the answer** brings the reply back (undoable); **Home → Dictate**
  types what you say; **Insert → Pictures → Online Pictures** finds free
  pictures on Wikimedia Commons and credits them in the caption; **Search** and
  **Thesaurus** (<kbd>Shift</kbd> <kbd>F7</kbd>, or right-click) show Wikipedia,
  definitions and synonyms in a side pane; **More fonts online** embeds a free
  Google font in the document. Nothing is sent without a click.
- **Updates**: each time the file opens, it fetches the signed release manifest
  from the project's website (one request, no identifier, no cookie). If a newer
  version exists, an **Update** button appears in the title bar (and a notice,
  once per version). Updating downloads the new version only if its signature
  (ECDSA P-256, public key built in) and checksum are valid, then writes the
  same document into the new application; it always takes a click. **Help →
  Check each time the file opens** turns the check off, offline mode blocks it,
  and **Help → Check for updates** runs it by hand.
- **Languages**: French and English built in; a language pack (a JSON file of
  translated sentences, checked line by line) adds another, and can be embedded
  in the file to travel with the document. **Help → Language → Manage**
  downloads a template to translate.
- **Reviewing aids**: an accessibility checker (pictures without alternative
  text, tables without a header row, skipped heading levels, vague link text,
  missing title or language), read aloud with the device's own voices, sorting
  paragraphs or list items, a focus mode that leaves only the page.
- **Outline view** (**View → Outline**): the document as an outline, with a
  button on each heading to fold or unfold its part, body text indented under
  its heading, a Show Level filter (1 to 6) and first line only. The
  **Outlining** tab (or <kbd>Alt</kbd> <kbd>Shift</kbd> and the arrow keys)
  promotes and demotes headings, turns them back into body text, and moves a
  heading up or down with its whole part.
- **Immersive Reader** (**View → Immersive Reader**): the text alone in one
  column, without pages or tools; column width, page colour (white, sepia,
  soft, inverse), line focus on one, three or five lines (the arrow keys move
  it), wider text spacing, and read aloud paragraph by paragraph with the one
  being read highlighted. Settings are remembered; <kbd>Esc</kbd> closes it.
- **Several documents in one file (new in 0.13)**: tabs at the bottom of the
  window, like the sheets of a spreadsheet: **+** adds a document,
  double-click (or <kbd>F2</kbd>) renames it, right-click duplicates, moves
  or deletes it (with Undo), and tabs can be dragged. Each document is
  complete and independent (its own page setup, theme, styles, comments and
  undo history). **Insert → Link** lists the headings and bookmarks of every
  document; **References → Cross-reference** can point into another document
  (its text, "Table 2", the number or the page), always up to date. Export and
  print offer this document or all of them, one after another, each starting
  on a new page.
- **Writing tools (new in 0.11)**: check lists (click a box to tick it, or
  type `[ ] `); callouts (Note, Tip, Important, Warning, Caution, or type
  `[!note] `); snippets (save a passage, insert it from Quick Parts or with
  <kbd>F3</kbd> after its shortcut); typewriter scrolling and dimmed
  paragraphs in focus mode; statistics and readability (click the word
  count), long sentences shown, a writing goal with a deadline; a glossary and
  a list of abbreviations, always up to date; AutoSave.
- **Layout and pages (new in 0.11)**: line numbers (continuous, by page or by
  section, every n lines, a paragraph left out); right-to-left paragraphs
  (Arabic, Hebrew) and vertical text in table cells; printing a range of
  pages, a booklet, the comments; direct PDF export, with no print dialog.
- **Charts (new in 0.11)**: bars (vertical or horizontal), lines and pies,
  drawn from a table in one click (**Table → Chart**) or from data typed in
  their window; they follow the theme colours, and are real charts in `.docx`
  (with their data, editable in Word) and LibreOffice.
- **Windows (new in 0.11)**: **View → Split** (or **Side by Side**) adds a
  second editable pane on the same document, with synchronous scrolling;
  **View → New Window** opens the document in another tab, every change shows
  in both. Find and replace also searches footnotes and endnotes.
- **More (new in 0.11)**: fillable forms (Developer tab: text, list, date and
  check box fields, a protected form), a Draw tab (pen, highlighter, eraser),
  Inspect Document and redaction, BibTeX / RIS / CSL-JSON sources, Vancouver
  and Chicago notes citation styles, opening `.odt` and `.rtf` files.
- **Interface**: light or dark, or following the system (the page stays white).
- **Also**: code blocks with syntax highlighting, links, special characters,
  page breaks, fields (`{{page}}`, `{{title}}`, `{{date:DD/MM/YYYY}}`…),
  Markdown as you type and on paste, paste without formatting, find and replace
  with regular expressions (or only in highlighted text), word count, zoom, and a shortcuts window (<kbd>?</kbd> or <kbd>F1</kbd>).

## Asking an AI for a document

Send the blank file to an AI with a one-sentence request ("make me a revision
sheet on photosynthesis with a table of the stages"). A guide at the top of the
file tells it where the document goes, what a good document looks like, and
what to check before handing the file back. Open the file it returns: done.

In a chat that cannot take files, use the **AI** tab: **Copy compact JSON**, paste
it with your request, and paste the answer into **Replace from JSON…** (undo with
<kbd>Ctrl</kbd> <kbd>Z</kbd>).

For agents and scripts:

- [`docs/agents.md`](docs/agents.md) — the format, examples, advice and a final checklist;
- [`docs/schema/folio-1.json`](docs/schema/folio-1.json) — JSON Schema (draft 2020-12), generated from the app's own validation tables;
- [`docs/llms.txt`](docs/llms.txt);
- a Claude Code plugin that downloads the latest blank file and fills it:

  ```
  /plugin marketplace add EmyoTyyy/folio-pages
  /plugin install folio-pages@folio-pages
  ```

## The file

```
<head>        title, icon
<!-- … -->    licence notices (Folio Pages, Bento, ProseMirror)
<!-- … -->    guide for AI agents
<script type="application/folio+json" id="folio-doc">   ← the document, readable JSON
splash        a CSS-only loading screen
<script type="folio/deflate-b122">                      ← the app, DEFLATE + base122
<script>      browser check (ES5), then the loader
```

The document block comes first so that a person or an AI finds it without
reading any code. The application is minified (Terser) and compressed with
Zopfli, a DEFLATE encoder that packs tighter than zlib for the same format,
then written as base122: 7 bits per byte of the file, so the compressed code
grows by 14 % instead of 25 % with base64-like encodings. Most characters are
plain ASCII; about one in twenty is a two-byte character (U+0180 to U+07FF),
and some are control characters, so the file must be read and written as
UTF-8, byte for byte (any editor or script does this by default). The three
embedded fonts (Latin and Latin Extended, weights 400 to 700 only,
`scripts/slim-fonts.py`) take ≈ 250 KB of the file, the application ≈ 590 KB
and the `.docx` module ≈ 135 KB. The blank file weighs about 1.03 MB.

A minimal document:

```json
{
  "format": "folio/doc",
  "version": 1,
  "meta": { "title": "Weekly report", "lang": "en" },
  "blocks": [
    { "type": "heading", "text": "Weekly report" },
    { "md": "A paragraph with **bold** and a [link](https://example.org)." },
    { "type": "list", "style": "number", "items": ["First", "Second"] },
    { "type": "table", "rows": [["Item", "Cost"], ["Paper", "12 €"]] }
  ]
}
```

Fields at their default value may be left out; the app fills them in and always
saves the complete form. Validation is **tolerant and bounded**: an invalid
field is ignored rather than blocking the file, text is never dropped, and the
app reports "Loaded: *n* fields ignored, *n* warnings" with the details. If the
JSON cannot be read at all, it shows the line and column of the error and offers
to recover the text — never a blank page.

`window.folio` exposes `{ doc, serialize(), loadDoc(json), schema(), compact(), i18n, version }`
in a running file.

## Developing

Node 18.19 or newer.

```bash
npm install
npm run dev          # Vite dev server, http://localhost:5173/dev.html
npm run build        # typecheck → dist/folio-pages.html (copied to docs/) → docs/schema
                     # (FOLIO_FAST=1 npm run build: zlib instead of Zopfli, quicker, ≈ 30 KB bigger)
npm test             # unit tests (Vitest)
npm run test:e2e     # end-to-end tests on the built file (Playwright: Chrome and Firefox)
npm run test:all     # all of the above
```

The `.docx` tests read the sample files in [`tests/fixtures/docx`](tests/fixtures/docx)
(written by python-docx, by LibreOffice, and by hand in a desktop word
processor's dialect; the scripts that make them are in `make/`), check a
300-document export → import round trip, and, when LibreOffice is installed,
open every export with it.

The end-to-end tests use the Chrome installed on the machine (`channel: 'chrome'`)
and Playwright's Firefox (`npx playwright install firefox`). CI uses Playwright's
Chromium instead (project `chromium-ci`).

Website images are reproducible from the real app:
`node scripts/site-screenshots.mjs && python3 scripts/site-images.py`.

### Layout

| Path | What |
|---|---|
| `src/format/` | The document format: validation tables (`spec.ts`) and the small DSL that turns them into both a tolerant validator and the JSON Schema (`dsl.ts`), normalisation, the compact form, Markdown, JSON error location and repair, text recovery. No DOM: everything here runs in Node. |
| `src/editor/` | ProseMirror schema, lossless conversion to and from the format, keymaps. |
| `src/file/` | The self-saving shell (`shell.ts`), saving (`save.ts`), crash-recovery storage. |
| `src/ui/` | Window chrome, menus, dialogs, error screens, styles. |
| `src/i18n/` | One dictionary, one entry per phrase, one column per language. |
| `src/demo/` | The demo document, written in the format itself. |
| `shell/` | The HTML template, licence notices, AI guide, splash, browser check and loader. |
| `scripts/` | Build of the single file, schema generation, site images, publication check. |
| `tests/unit/`, `tests/e2e/` | Vitest and Playwright suites. |
| `docs/` | The website (GitHub Pages), the built app, `agents.md`, `llms.txt`, the schema. |
| `plugins/folio-pages/` | The Claude Code skill. |

## Testing

Every feature ships with tests, and the end-to-end suite runs against the real
built file opened from disk, in Chrome and Firefox.

- **Unit (Vitest, 520+ tests):** the validator (hostile keys such as
  `__proto__` and `constructor`, bounds, coercions, depth and size limits), the
  Markdown parser (including pathological input, which must stay linear), JSON
  error location and repair, text recovery, round trips on 2 000 random
  documents (compact ⇄ full, format ⇄ editor), the schema under Ajv strict mode,
  every example in `agents.md`, paste sanitising, base122 and the DEFLATE decoder,
  the i18n dictionary.
- **End to end (Playwright, ~225 tests, each in Chrome and Firefox):** open → write → save → reopen in both
  saving modes; conflicts, refused permissions and failed writes; crash recovery;
  documents written by an AI following only the embedded guide; damaged files,
  encrypted files, a damaged application, an old browser, JavaScript disabled;
  the JSON round trip in the UI; editing, menus by keyboard; no network requests;
  password protection and unlocking, offline mode, signed updates (a test
  manifest is signed with the local key when it exists), language packs, mail
  merge from a CSV list to the merged tab, e-mailing, cropping with the mouse,
  captions, cross-references, index and citations, landscape sections and their
  printing, and every online feature against a simulated network.

## Security

A received `.html` file is a program, so Folio Pages treats its document as
data only. The document JSON is never evaluated; text is rendered through the
DOM, never as HTML; links are limited to `http(s)`, `mailto`, `tel` and anchors;
pasted HTML goes through the editor schema, which keeps only known elements;
every field is bounded. The application code is checked against a length and a
checksum before it runs. Report vulnerabilities through GitHub's private
advisories rather than public issues.

## Known limitations (version 0.15)

- Shapes: pictures are not yet placed freely like shapes; shapes cannot go in
  headers, footers or notes; the text of a shape inside a group is edited after
  ungrouping it. In `.odt` the dashes and arrowheads of lines are not kept, and a
  shape placed from the page in a `.docx` file is placed from its paragraph.

Page layout: a block in columns, and an index in several columns, stay whole on
one page. A landscape section in the middle of the document is printed page by
page at its own size; browsers without named pages (older Safari) print it on
the first section's paper.

Several documents: a cross-reference to the page of another document shows
the last page known, which is updated once that document has been shown (and
kept in the file). Exporting all the documents uses the theme and styles of the
first one. Undoing **Replace from JSON** with several documents restores the
document on screen only.

Notes: a footnote stays whole on its page (a very long one is not continued on
the next page).

Windows: the second pane of a split shows the text continuously, without
pages. Side by side, the page keeps its paper width (zoom out, or use Page
Width). A new window needs the browser to allow pop-ups for the file; it is
the first window that writes the file.

Direct PDF export: it uses the 14 standard PDF fonts, so characters outside
Latin, Greek and common symbols (Arabic, Hebrew, Chinese…) are replaced; print
to PDF for those. Charts are pictures in the PDF. Line numbers show in page
view only.


Tracked changes cover text and its formatting (characters and paragraphs):
paragraph splits and joins, list changes, and deleting whole objects
(pictures, tables, breaks, notes, code) are applied directly, not tracked.
Edits inside notes, headers and footers are not tracked. The Original view
shows the text before the changes, but with its new formatting. Simple markup's
margin bar needs Firefox 121 or later (any recent Chrome, Edge or Safari).

Word-style tools: text glow shows in Word but not in LibreOffice. A picture's
shadow, glow and reflection are written as Word's own picture effects in
`.docx`; in `.odt`, shadow and glow are kept and the reflection is reported as
lost. The direct PDF export leaves the reflection out. The watermark is not exported to `.odt`.

Picture wrapping: a picture behind or in front of the text stays where it is
anchored (it cannot be dragged anywhere on the page yet), and one behind the
text is selected with the keyboard. Tight and through wrapping follow the
outline in Folio Pages and LibreOffice; in a `.docx`, Word recomputes the
outline, while LibreOffice wraps it square. An exported web page wraps it
square.
Hyphenation follows the browser's dictionaries (French and English in Chrome
and Firefox).

Other formats: exports show tracked changes as accepted. Comments go only into
`.docx` and `.odt` (in `.odt`, replies are written inside the comment). The web
page, Markdown and EPUB have no pages, so page numbers and headers and footers
are left out; the web page and EPUB use the theme fonts if they are installed,
and a similar font otherwise. In `.odt`, a rotated picture is not rotated, and a
formula that draws stretched arrows stays as LaTeX text.

`.docx`: the conversion is done by a module kept in its own compressed block
(about 130 KB of the file), unpacked the first time you import or export. What
has no equivalent is reported, never silently dropped:

- on import, equations come back as LaTeX (an unreadable one stays text), shapes and charts are skipped, text
  boxes are placed after their paragraph, a table inside a cell is flattened,
  automatic heading numbers are not kept, EMF/WMF/TIFF pictures are skipped, and
  a continuous section break that changes the page size is not kept;
- on export, code loses its syntax colouring, a quote keeps only its plain
  paragraphs, links inside the document become text, web pictures are replaced
  by their alternative text, and fonts are not embedded (the reader needs them,
  or gets a substitute);
- old `.doc` files and password-protected files cannot be opened.

Equations: they are drawn by the browser with the system's mathematics font
(Cambria Math, STIX, Latin Modern…), so they look slightly different from one
computer to another, and Safari was not tested here. A formula carries no text
formatting of its own (bold, size, highlight): that goes in the LaTeX
(`\mathbf`, `\large`, `\textcolor`). In a `.docx`, a numbered equation is an
equation followed by its number after a tab; our own files keep the exact LaTeX
in a hidden part, which other word processors keep but do not read. Tracked
changes do not cover inserting or deleting a formula.

Interface: the right-click menu replaces the browser's (Shift+right-click for
spelling suggestions).

References: citation styles follow common usage for APA, MLA, Chicago
(author-date), Harvard, IEEE and ISO 690, without every rare case of the official
manuals (translators, reprints…). In a `.docx`, a cross-reference that shows only
"Figure 2" becomes the whole caption if you update the fields in another word
processor (Folio Pages bookmarks a point, not a range).

Online features (all optional, all blocked by offline mode): asking Claude or
ChatGPT opens their site in a separate window, because those sites refuse to be
shown inside another page; the answer comes back by pasting it. Dictation needs
Chrome, Edge or Safari (Firefox has no speech recognition), and Chrome sends the
audio to Google's service. Online pictures come from Wikimedia Commons, look-up
and synonyms from Wikipedia and Wiktionary (Datamuse for English synonyms), online
fonts from a curated list of SIL OFL and Apache fonts on Google Fonts.

Mailings: Folio Pages sends nothing itself. E-mails are prepared one per
recipient and open in your mail program, Gmail or Outlook.com one at a time
(plain text; a longer message is copied for you to paste), or download as
formatted `.eml` drafts (one per recipient, in a `.zip`); merged letters, envelopes and labels open in a new tab, and
printing uses the browser. Labels are a table with fixed row heights, so very
small printer margins may shift them slightly: print a test sheet first.

Password protection: the password cannot be recovered, and a protected file
cannot be exported unencrypted to `.docx` without opening it first. Updates
need a network connection to the project's website.

See the [roadmap](https://emyotyyy.github.io/folio-pages/#roadmap) on the website.

## Licence and credits

MIT — see [`LICENSE`](LICENSE). Folio Pages reuses the file format idea, the
self-saving mechanism, the loader and the DEFLATE decoder of
[Bento](https://github.com/nyblnet/bento) (MIT, © 2026 The Bento authors), and
is built on [ProseMirror](https://prosemirror.net) (MIT). Details in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). The website's fonts
(Newsreader, Hanken Grotesk, JetBrains Mono) are under the SIL Open Font
Licence ([`docs/fonts/OFL.txt`](docs/fonts/OFL.txt)).
