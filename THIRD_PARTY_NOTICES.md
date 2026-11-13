# Third-party notices

Folio Pages is MIT-licensed (© 2026 EmyoT; see `LICENSE`).
The single-file app (`folio-pages.html`) embeds the components below. Their
licences require these notices to accompany copies, so the same text is
written as a `NOTICE` comment near the top of the built file and of every
document Folio Pages saves.

## Code reused from Bento

- Project: [Bento](https://github.com/nyblnet/bento) — MIT License,
  © 2026 The Bento authors.
- What: the file format principle (a plain-text JSON block at the top of a
  self-saving HTML file), the self-saving mechanism, the loader, the base86
  payload codec (`scripts/lib/b86.mjs`) and the raw DEFLATE decoder
  (`scripts/lib/inflate-raw.js`, copied with one added bounds check on stored
  blocks), and the LaTeX → MathML equation engine (`src/math/ast.ts`,
  `latex.ts`, `mathml.ts`, `symbols.ts`, `mhchem.ts`, from Bento's
  `slides/src/maths`, copied unchanged but for import paths) with its test
  fixtures (`tests/fixtures/math`).

## Bundled runtime

| Component | Licence | Copyright |
|---|---|---|
| prosemirror-model, -state, -view, -transform, -commands, -keymap, -history, -schema-list, -gapcursor, -dropcursor, -inputrules | MIT | © 2015-2017 Marijn Haverbeke and others |
| prosemirror-tables | MIT | © 2015-2016 Marijn Haverbeke and others |
| orderedmap, rope-sequence, w3c-keyname | MIT | © 2016 Marijn Haverbeke and others |
| docx (the .docx export; loaded on demand from its own compressed block) | MIT | © 2016 Dolan |
| fflate (ZIP archives, for .docx import and export) | MIT | © 2026 Arjun Barrett |
| nanoid (used by docx) | MIT | © 2017 Andrey Sitnik |

## Embedded fonts

| Font | Licence | Copyright |
|---|---|---|
| Hanken Grotesk (variable, latin and latin-ext) | SIL Open Font License 1.1 | © 2021 The Hanken Grotesk Project Authors |
| Newsreader (variable, latin and latin-ext) | SIL Open Font License 1.1 | © 2020 The Newsreader Project Authors |
| JetBrains Mono (variable, latin and latin-ext) | SIL Open Font License 1.1 | © 2020 The JetBrains Mono Project Authors |

The font files come from the Fontsource packages (`@fontsource-variable/*`,
version 5.3.0). The full licence text is in `src/fonts/OFL.txt` and, in the
app, under Help → About; the `NOTICE` comment of every saved file names it.

Development tools (TypeScript, Vite, esbuild, Vitest, Playwright, Ajv,
jsdom) build and test Folio Pages but are not embedded in the file, so they
are not listed here.
