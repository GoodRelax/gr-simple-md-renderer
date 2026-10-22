# Changelog

All notable changes to GRSMD are recorded here.
Format is loosely based on Keep a Changelog (https://keepachangelog.com/).

As of 2026-07-16 all rendering libraries are bundled into the build (see that
entry), so there are no runtime CDN resources or SRI hashes to maintain. Library
versions live in `package.json`. The earlier entries below record the previous
CDN + SRI era, in which each upstream `/+esm` rebuild required a documented
re-hash.

---

## [Unreleased] - 2026-10-10

### Security

- Sanitize all Markdown output with DOMPurify before it is inserted into the
  DOM. marked (v18) has no built-in sanitizer, so raw HTML such as
  `<img src=x onerror=...>` in a Markdown file used to run script as soon as
  it was rendered. Only the MathML `<semantics>` / `<annotation>` wrappers that
  KaTeX emits are added to the allow list; `<style>` is forbidden.
- Gate external images behind user consent, like PlantUML. External `img`
  `src` / `srcset` are held back and shown as click-to-load placeholders.
  Consent is kept in memory only and is revoked by Clear or a new file drop.
  Other remote-loading attributes (media, `poster`, `background`, CSS `url()`,
  SVG `image` href) are always removed, and `<img>` in Mermaid labels is
  dropped.
- Add a Content-Security-Policy `<meta>` to the built file (build-time sha256
  hash of the inlined script, `default-src 'none'`, `connect-src` limited to
  the PlantUML server).
- Escape the error message on the Markdown parse-error path, and make
  `escapeHtml` escape single quotes.

### Fixed

- Code View no longer imports highlight.js from cdnjs at runtime. That static
  import made the whole app fail to start when cdnjs was unreachable (offline,
  blocked proxy), and it had no SRI. Code View now uses the bundled
  highlight.js instance shared with the Markdown renderer. A build check now
  fails the build if the output still imports code from `http(s)://` or
  mentions `cdnjs`.
- Math is 1.5em again, as before the libraries were bundled. The bundled
  KaTeX CSS came after the app's rule and had set it to 1.21em.
- Diagram panning ends on pointer up and pointer cancel, and when the mouse
  moves with no button pressed. Before, after clicking a diagram (for
  example to open its code) in Safari, moving the mouse alone could scroll
  the preview.
- On touch screens, the prompt opened by a long press on `[?]` no longer
  closes as soon as the finger is lifted.
- Code View: a dropped file that cannot be read shows the read error and
  goes back to the start screen (no unhandled error), Reload of a file that
  cannot be read shows a notice, and Reload with no file says that no file
  is open instead of asking for Chrome / Edge 86+.

### Removed

- `docs/bak-index.html`, the CDN-era build kept for rollback since
  2026-07-16. It was still publicly served on GitHub Pages, loaded libraries
  from CDNs, and did not sanitize HTML in Markdown.
- The commented-out eruda debug loader in `src/index.html` (an unpinned CDN
  script that the new CSP would block anyway).

### Added

- In-place Markdown editing (SC-22 to SC-24). `[Edit]` (or `E`) shows a
  movable edit palette; while it is shown, clicking (tapping) a rendered block
  opens its Markdown source in place. Clicking outside applies the change and
  only the changed blocks are rendered again; `Esc` cancels. Lists, tables,
  `<details>` and other raw HTML open as one block; reference definitions and
  hidden HTML show as thin bands in edit mode.
  - Palette: a 7 x 2 grid of icons. Bold, Italic, Format (text color, paste
    link, remove link), four Mermaid samples, Save, Save as, Insert table,
    Insert / Delete row, Insert / Delete column, Table options (column
    alignment) and Undo. Buttons run on press-and-release inside the button;
    moving off a pressed button, or pressing a disabled one, drags the palette
    instead. A long press on the grip minimizes the palette to the grip (a dot
    marks unsaved changes) and restores it. The palette is pointer only: it
    takes no keyboard focus, and the keyboard uses the shortcuts below.
  - Undo also works while editing. It takes back the last change unit: a
    block commit, an insert, a cell commit, or a table row / column /
    alignment operation. If an open editor or cell has changes, Undo cancels
    those changes instead and leaves the last unit as it is.
  - Shortcuts: Ctrl+S / Ctrl+Shift+S save (the browser's "Save page" is
    always blocked in the GRSMD tab), Ctrl+Z is the Undo above in edit mode
    (inside a changed block editor it stays the browser's own undo), Ctrl+B /
    Ctrl+I in an editor or a cell. Mac uses Cmd. A held key runs once, and a
    held `Esc` cancels once.
  - Outside edit mode, a double-click (double-tap) on the preview enters edit
    mode and opens what was clicked: a block, or a table cell.
  - Table cells are edited in place as they are rendered. Tab / Shift+Tab move
    right / left, Enter moves down (and ends on the last row), Shift+Enter
    adds a line break, and `Esc` cancels the open cell only. A cell that
    cannot go back to the same Markdown (math, images, footnote references,
    HTML other than bold, italic, a line break or text color) opens as its
    Markdown text; a table whose rendered structure differs from its source
    opens the whole table source with a notice. The "Markdown" tab above a
    table opens the whole table source. Links in a cell keep their notation
    (reference, `<URL>`, bare URL).
  - Committing a changed table aligns its pipes (full-width characters count
    as two columns).
  - Text color (red, blue, green) is written as `<span style="color: ...">`
    and shown with dark-theme values in the dark theme. Bold, Italic and
    color split and merge spans without nesting them, and keep emphasis
    markers where they work next to punctuation.
  - Links: select text and paste a URL with Ctrl+V (Cmd+V) to make it a link,
    with no clipboard permission. The "Paste link" button reads the clipboard
    when pressed; the browser may ask for permission. In Chrome and Edge that
    permission is shared with the other pages on the same site
    (`goodrelax.github.io`); it can be withdrawn in the site settings. The
    button makes one clipboard read at a time, and a read still pending when
    edit mode ends is dropped. "Remove link" keeps the text. Nothing is sent
    over the network.
  - Enter / Shift+Enter in a paragraph, list item or quote inserts a Markdown
    line break (two trailing spaces); trailing spaces that make no line break
    are removed on commit. New list items are typed by the user (`- `). In a
    very large block (over 50,000 characters) Enter is the browser's plain
    newline, and the format and link buttons are checked when pressed.
  - While editing, invisible characters (no-break spaces, zero-width
    characters except the ones that join or style emoji, soft hyphens) and the
    two spaces of a line break are shown with a light mark (not in very large
    blocks or with more than 2,000 marks).
    The file keeps the characters as they are.
  - Save overwrites the dropped file through the File System Access API
    (Chrome / Edge, after the permission prompt), and asks before overwriting
    a file that changed on disk. Save as picks a new file. Browsers without
    file write support download the file instead, and the document stays
    marked unsaved. The original line endings, BOM and AI wrapper fence are
    written back.
  - Unsaved changes put `* ` in front of the tab title (never the file name)
    and make leaving the page, Reload, Clear and file drops ask first. Nothing
    is saved automatically and nothing is stored in the browser.
  - On the empty start screen, `[Edit]`, a double-click or a double-tap
    starts a new empty document.
  - Editing a PlantUML block never sends it automatically: the block shows a
    placeholder with a `[Render]` button that asks for consent first.
- `docs/sample-data-2.md` / `.txt`: a "9. Images" section with a small SVG
  embedded as a data URI.
- The help text now mentions math (LaTeX) support.
- Development: browser tests of the built file with Playwright
  (`npm run test:e2e`, Chromium and WebKit; `npm run test:e2e:firefox` for
  Firefox). `@playwright/test` is a devDependency only; see `e2e/README.md`.
- The help (English and Japanese) describes the editing features above:
  double-click editing, Undo and the shortcuts, the palette and its grip, table
  cells and the "Markdown" tab, text color and links, line breaks and list
  items, and the marks for invisible characters. It also says that in Chrome
  and Edge, once "Paste link from clipboard" is allowed, other pages on
  goodrelax.github.io can read the clipboard without asking, and how to set
  Clipboard back to Ask or Block in the site settings. The Details list gains
  the Ctrl+S / Ctrl+Shift+S line. The old line about moving from a block to
  the palette with `Tab` is removed.

### Changed

- **Behaviour change (ruling T33): while a Markdown document is shown, rendering
  from the top `#editor` box no longer strips a ```` ```markdown ```` wrapper.**
  The box already holds the document body, and stripping it again cut the
  fences off a document that starts with a `markdown` example block and ends
  with a code block. Line endings are still normalized. To strip the wrapper
  of a pasted AI answer, Clear first and paste again (the initial paste and a
  dropped `.md` file still strip it, as before).
- Colors follow GitHub (Primer): the whole dark theme, the light preview and
  Code View, an inline code ground, prettylights syntax colors (no
  highlight.js theme CSS), 16 px code block padding, and printing in the light
  colors (diagrams keep the colors they were drawn with). The editing color is
  blue.
- The full render now builds the preview block by block (one wrapper per
  top-level Markdown block). The output is the same HTML as before, sanitized
  the same way, but every existing view is affected; the pre-release tests
  A to T are to be run again.
- Line endings are normalized before the ```` ```markdown ```` wrapper is
  split, so a CRLF file no longer leaves `\r` in the body.
- Reload reads the file again with its BOM and line endings, and asks first
  when there are unsaved changes.
- Code View: files with an unknown extension, and languages that are not in the
  highlight.js common build, are shown as plaintext. `highlightAuto` is no
  longer used (slow on large files, unreliable guesses).
- `package.json` declares `"type": "module"` (silences the Vite 8 config
  loader notice), and Vitest skips agent worktrees under `.claude/`.
- README rewritten to match the current app (math, Code View, consent for
  external images, CSP, development steps). The pre-release test spec
  (`spec/gen2_prerelease_test_spec_ja.md`) is updated to v2.1 with a new
  security section, and to v2.2 with sections U to X for in-place editing and
  a chapter that lists the automated test IDs (`AT-...`).

- Update bundled dependencies to the latest release within the same major
  version (plantuml-encoder unchanged at 1.4.0, already the latest):

  | Library | Version |
  |---------|---------|
  | marked | 18.0.5 -> 18.1.0 |
  | mermaid | 11.16.0 -> 11.17.2 |
  | highlight.js | 11.11.1 -> 11.12.0 |
  | katex | 0.17.0 -> 0.18.11 |
  | marked-katex-extension | 5.1.10 -> 5.1.13 |
  | dompurify | 3.4.12 -> 3.4.16 (still deduped with mermaid's copy) |

  - katex stays on 0.18.x: 0.19.0 is out, but marked-katex-extension 5.1.13
    declares `katex >=0.16 <0.19` as its peer range.
  - katex 0.18.0 prefixes its internal CSS classes (for example `base` ->
    `katex-base`). GRSMD only styles `.katex`, which is unchanged. The font set
    (20 faces) is unchanged, and the build still embeds woff2 only.
  - katex 0.18.2 fixes GHSA-238p-pmpm-9mq7 (prototype pollution gadget) for the
    top-level copy.
  - highlight.js 11.12.0 keeps the same 36 languages in `lib/common`; the new
    `freedesktop` grammar is not in the common build.
  - Dev tooling (same major only): vite 7.3.6 -> 7.3.7,
    vite-plugin-singlefile 2.3.0 -> 2.3.3, vitest 4.1.10 -> 4.1.11
    (jsdom stays on 28.1.0, the latest 28.x).
  - Single file: ~4.37 MB (gzip ~1.38 MB), about +10 KB.

- Dev tooling major updates (bundled libraries unchanged):

  | Package | Version |
  |---------|---------|
  | vite | 7.3.7 -> 8.3.4 |
  | vitest | 4.1.11 -> 5.0.3 |

  - vite 8 replaces Rollup/esbuild with Rolldown/Oxc. `vite.config.js` needs
    no option changes: the inline PostCSS plugin (`katexWoff2Only`),
    `assetsInlineLimit` and both `generateBundle` plugins still run, and the CSP
    hash still matches the final inlined script. The Oxc minifier writes
    `import(...)` specifiers as template literals, so the `no-external-imports`
    check now also matches `` import(`https://...`) ``.
  - Single file: ~4.38 MB -> ~4.33 MB (gzip ~1.39 MB -> ~1.37 MB).
  - jsdom stays on 28.1.0: jsdom 30 requires Node `^22.22.2 || ^24.15.0 ||
    >=26.0.0`, and the current dev environment runs Node 24.12.0. Tests pass on
    jsdom 30.1.2 too, so it can be bumped after a Node update.
  - npm audit: the postcss, nanoid, source-map-js and undici findings are gone.
    The 3 high findings left (braces via micromatch via vite-plugin-singlefile)
    are build-time only and have no fixed braces release yet.
  - mermaid 12.1.0 was evaluated and deferred: it bundles the ELK layout engine
    (about +0.5 MB gzip) and makes it the default, which changes the layout of
    flowchart, state, class and requirement diagrams.

### Known issues

- mermaid 11.17.2 still pins its own nested `katex ^0.16.47` (used only for
  `$$...$$` math inside diagram labels, rendered as sanitized MathML). No
  0.16.x release fixes GHSA-238p-pmpm-9mq7 (low severity), so
  `npm audit --omit=dev` reports 2 low findings (katex, mermaid). mermaid 12.1.0
  pins the same range.

---

## [Unreleased] - 2026-07-16

### Changed

- Bundle all rendering libraries into the build instead of loading them from a
  CDN at runtime. marked, mermaid, highlight.js, katex, marked-katex-extension
  and plantuml-encoder are now npm dependencies, inlined into `docs/index.html`
  by vite-plugin-singlefile. The only remaining external call is the optional
  PlantUML rendering server (unchanged, still consent-gated).
  - Permanently ends the recurring jsdelivr `/+esm` SRI breakage: those bundles
    are no longer fetched at runtime, so there are no more SRI hashes to chase.
  - Zero external CDN requests; the app works fully offline after load.
    (Correction: Code View still imported highlight.js from cdnjs until
    2026-10-10. See the Fixed section of that entry.)
  - katex fonts are embedded as data URIs in woff2 only. All glyph coverage is
    retained; the woff/ttf fallbacks are dropped because every browser that can
    run this app supports woff2.
  - Single file grows from ~54 KB to ~4.37 MB (gzip ~1.38 MB).
  - Published as `docs/index.html`. The previous CDN-based build is kept as
    `docs/bak-index.html` for rollback.

### Removed

- All CDN `<script>` / `<link>` tags and their SRI `integrity` attributes from
  `src/index.html`.

---

## 2026-07-13

jsdelivr rebuilt the marked-katex-extension `/+esm` bundle again (about 11
days after the 2026-07-02 update), changing its bytes and breaking SRI once
more. Version unchanged; integrity refreshed to the value the browser now
computes. This is the second `/+esm` breakage - a permanent fix (bundle into
the build, or drop SRI on `/+esm`) is still pending.

### Fixed

- Refresh SRI after upstream `/+esm` rebuild (version unchanged):

  | Library | Version | integrity |
  |---------|---------|-----------|
  | marked-katex-extension | 5.1.10 | sha384-x9xvDHWk3lUv72Gr7xAxUj8r8t+tOPNMJgXRCqZo5w6YwLKb0+rIPoRo548HIel9 |

---

## 2026-07-02

Update CDN libraries to latest stable, refresh the SRI hashes for the
jsdelivr `/+esm` bundles that had drifted upstream, and add Markdown table
borders.

### Changed

- Update CDN libraries to latest stable (highlight.js unchanged at 11.11.1):

  | Library | Version | integrity |
  |---------|---------|-----------|
  | marked | 17.0.1 -> 18.0.5 | sha384-MU0bL51BF1u980ujv+Pk0Z0qCjhzfBIEHIFPkUq81289nkiAr+q1jSxEkdlIeHLJ |
  | mermaid | 11.12.2 -> 11.16.0 | sha384-H3I/GBuI2vR7qAVY20j3ATk7IbKGz5cjGE6Yu5r32ybgMxbG6WBs1dWh+nVIJzxW |
  | katex (css) | 0.16.28 -> 0.17.0 | sha384-vlBdW0r3AcZO/HboRPznQNowvexd3fY8qHOWkBi5q7KGgqJ+F48+DceybYmrVbmB |
  | marked-katex-extension | 5.1.6 -> 5.1.10 | sha384-4ilMNG5L/wzW3TbP7r/nxwO0/MqiurTlUVcNURb6DX670dmjbF+J58dsIp/O2tTL |

### Fixed

- plantuml-encoder: refreshed SRI only (version stays 1.4.0). Its jsdelivr
  `/+esm` bytes were rebuilt upstream and broke the integrity check.
  New integrity: `sha384-d/kiW+3z12HCqBMXLEwBmEa5t1QxA6p9Ba6Q148eFIuMvF+vakXndEOPSNWz12ud`

### Added

- Light-gray borders for Markdown tables (light and dark themes).

---

## [Baseline] - 2026-03-07

Snapshot of the current production state, recorded before the first
documented CDN update. Values reflect what is embedded in `src/index.html`
at this point.

### CDN dependencies

| Library                          | Version | integrity                                                                                       | Embed (src/index.html) |
| -------------------------------- | ------- | ----------------------------------------------------------------------------------------------- | ---------------------- |
| marked                           | 17.0.1  | sha384-AkwdwVgEdZpqPMfydlmViIGgV90b6sHb/NoxnNdlecRKY3puoyKdw/pi64E32c+6                         | line 84                |
| mermaid                          | 11.12.2 | sha384-bBdf+Hx1qc+N2a4poQjInyeO803gqSNqanHQiQ3DgvXaz/aeQz4mQLhIXpK9MP83                         | line 91                |
| highlight.js (es module)         | 11.11.1 | sha512-818kY2uYH1PRlHNZZL17hgbHng9LBOgA4k8TQVsXYTaKwgg5pMxBahxeHDUdAMTPUJ82CXLQmJZOl3OQUKZ18Q== | line 105               |
| highlight.js (css theme, vs2015) | 11.11.1 | sha512-mtXspRdOWHCYp+f4c7CkWGYPPRAhq9X+xCvJMUBVAb6pqA4U8pxhT3RWT3LP3bKbiolYL2CkL1bSKZZO4eeTew== | line 98                |
| katex (css)                      | 0.16.28 | sha384-Wsr4Nh3yrvMf2KCebJchRJoVo1gTU6kcP05uRSh5NV3sj9+a8IomuJoQzf3sMq4T                         | line 120               |
| plantuml-encoder                 | 1.4.0   | sha384-0soUzyKltgTFXRsH4USkmq6FPG3emb/n2JkcG7etR4fIXjKFFJkCLqTl6sM7boxe                         | line 113               |
| marked-katex-extension           | 5.1.6   | sha384-sXM6dT1KwUCU7buT3pldq9hy6hhfkoUXunVhnhf+ISmpQh3ofLks2w7oMwyG24Ex                         | line 126               |

Known issue at baseline: the `plantuml-encoder` and `marked-katex-extension`
entries use jsdelivr `/+esm` bundles. Their upstream bytes were rebuilt, so
the SRI hashes above no longer match and the browser blocks these resources.
This is the defect addressed by the next entry.

### Coupling rules (must stay consistent)

- marked and marked-katex-extension: the extension's peer range must include
  the chosen marked version.
- katex: the JS (pulled in by marked-katex-extension) and the CSS (loaded
  separately) must be the same version.
- highlight.js: the ES module and the CSS theme must be the same version.
- Version strings appear in both `src/index.html` and `src/js/main.js`;
  update both.

### Re-hash procedure

Paste the resource URL into https://srihash.org/, copy the generated
`integrity` value into `src/index.html`, then run `npm run build` to
regenerate `docs/index.html`.
