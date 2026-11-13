---
name: folio-pages
description: >-
  Create and edit Folio Pages documents — single-file .html word-processor
  documents whose content is plain JSON in a "folio-doc" script block. Use
  when the user wants a document (report, letter, notes, revision sheet,
  minutes, CV…) as a Folio Pages file, starting from NOTHING (it downloads
  the latest blank app automatically) or by improving an existing Folio Pages
  file. Writes the document JSON in place and checks it. Full reference:
  https://emyotyyy.github.io/folio-pages/agents.md
---

# Writing Folio Pages documents

A Folio Pages file is one self-contained `.html` file: the word processor and
the document at once. The document is plain JSON in a single block:

```html
<script type="application/folio+json" id="folio-doc"> { "format": "folio/doc", ... } </script>
```

You change **that block only**. Everything else (the compressed application in
`folio/deflate-b86` blocks) stays byte for byte.

## 1. Get a file

If the user has no Folio Pages file yet, download the latest blank app and
name it after the document:

```bash
curl -fsSL https://emyotyyy.github.io/folio-pages/folio-pages.html -o "<Title>.html"
```

(Windows without curl: `iwr https://emyotyyy.github.io/folio-pages/folio-pages.html -OutFile "<Title>.html"`.)

The `folio-doc` block of a blank app is **empty** (a browser shows a demo
document, but on disk there is nothing to remove).

## 2. Read the guide, then write the JSON

Fetch https://emyotyyy.github.io/folio-pages/agents.md before writing your
first document (the file itself also carries a short guide in an HTML comment
just above the block). Write the document to a separate JSON file. Minimal
shape:

```json
{
  "format": "folio/doc",
  "version": 1,
  "meta": { "title": "Weekly report", "lang": "en" },
  "blocks": [
    { "type": "heading", "text": "Weekly report" },
    { "md": "A paragraph with **bold** and a [link](https://example.org)." },
    { "type": "list", "style": "number", "items": ["First step", "Second step"] },
    { "type": "table", "rows": [["Item", "Cost"], ["Paper", "12 €"]] }
  ]
}
```

Rules that matter:

- Leave `id` out of a new document. Never change the `id` of an existing one.
- Set `meta.title` and `meta.lang`; write in the language of the request.
- Real headings (one level 1, then 2 and 3), tables for any data, numbered
  lists for steps, short complete paragraphs, no placeholders.
- Equations: LaTeX, `$…$` in a sentence and `{ "type": "equation", "tex": "…" }`
  for a centred one (`"numbered": true` to number it); `\\ce{H2O}` for chemistry.

## 3. Put it into the file

Use the helper next to this file (Python 3, standard library only). It finds
the real block (not the mention in the guide comment), escapes every `<` as
`<`, and keeps an existing document's `id`:

```bash
python3 "<skill dir>/fill_folio.py" "<Title>.html" doc.json            # blank file
python3 "<skill dir>/fill_folio.py" "<Title>.html" doc.json --replace  # existing document
python3 "<skill dir>/fill_folio.py" "<Title>.html" --check
```

Without the helper, edit the file directly: replace the empty
`<script type="application/folio+json" id="folio-doc"></script>` (it occurs
exactly once outside comments) with the block containing your JSON, with every
`<` written as `<`.

## 4. Check, then hand over

Run `--check`, then open the file (`xdg-open`, `open` or `start`). It opens
straight into the editor with your document. If the app shows "Loaded: n
fields ignored, n warnings", click it to see what was not understood, fix the
JSON and fill again. Tell the user that **Ctrl+S** saves into the same file
(Chrome, Edge) or downloads an updated copy (Firefox, Safari).
