# Changelog

All notable changes to GRSMD are recorded here.
Format is loosely based on Keep a Changelog (https://keepachangelog.com/).

As of 2026-07-16 all rendering libraries are bundled into the build (see that
entry), so there are no runtime CDN resources or SRI hashes to maintain. Library
versions live in `package.json`. The earlier entries below record the previous
CDN + SRI era, in which each upstream `/+esm` rebuild required a documented
re-hash.

Versions and their headings follow the version rule in spec/grsmd_gen2_spec_ja.md section 1.7.

---

## [Unreleased]

### Changed

- Block editing: the editor shows its text the way the block is shown. A
  paragraph, heading, list or quote is edited in the body text's font,
  size and line spacing (a heading at its own size, in bold, with its `#`
  marks), and a code block in the code font. A table's source, math and
  diagrams stay in the monospace font, so the table pipes still line up.
  The editor has no inner padding; its blue frame is drawn around it and
  takes no room, so the text does not jump when it opens or closes. A new
  block (in an empty document, or opened from a gap between blocks) is
  edited in the body text's font too.
- Block editing: the caret goes where you double-clicked (or clicked, in
  edit mode), not to the end of the block, and that line stays where it
  was on the screen. When you press Esc or click outside, the caret's line
  stays where it was too. Before, the lines of a long block (a code block,
  a long list) moved when it opened or closed, and the first key typed
  jumped to the end of the block. In a very long paragraph (more than 20,000
  characters before the caret) the block's top stays in place instead, so
  that opening it stays quick.
- Block editing: typing no longer moves the view, also near the end of the
  document (for example in a tall code block at the end of the document,
  seen in Edge).
- The Index and Search panels let less of the page show through (15%, it
  was 25%), so they are easier to read.
- Faster startup: the page is usable before the whole file has arrived
  (within 1 s on a 4 Mbps line with a 100 ms round trip, where it waited
  for the whole file; a new tab is fast too). The file now starts with the styles,
  the page and the app itself; mermaid, highlight.js, KaTeX and the
  PlantUML encoder come after it as data that runs when a document needs
  it, or when the page is idle. Until then a formula shows its TeX source
  in a dashed box, code is shown without colors and a diagram shows
  "Loading diagram..." (a PlantUML diagram too; see below); each
  is drawn as soon as its library is in. The code view waits up to 3
  seconds for highlight.js, then shows the code plain and colors it when
  highlight.js comes. A file dropped or text pasted while the
  page is still loading is opened once the app runs (the browser no longer
  opens the dropped file instead). Still one file, with the same
  Content-Security-Policy rules: every script, the libraries' data included,
  runs only by its hash.
- The save dialog (Save as, or Save of a document that has no file yet;
  Chrome and Edge) now opens in the folder you last used instead of the
  browser's default: the folder of the `.md` file you dropped or last chose
  in this tab, otherwise the folder the browser remembers for this dialog
  (that one survives a reload). GRSMD itself stores nothing. Browsers
  without the save dialog (Safari, Firefox, iPhone, iPad) still download.
- Code blocks in the Markdown view (paste, drop, Render or editing): a
  block longer than 20,480 characters (about 20 KB) is shown without syntax
  highlighting, and a block without a language has its language detected
  from its first 3,072 characters (about 3 KB) only. highlight.js could take seconds on a long block (some
  language patterns are quadratic, and detection runs every language over
  the whole block): a block of 100,000 blank lines stopped the render.
  The help says so in both languages.
- Rename the tool to **GR Simple Markdown** (formerly "GR Simple MD Renderer &
  Viewer"): it now edits documents in place, not just renders them. The
  short name GRSMD, the repository name and the URL stay. The header logo,
  the help's title and the page's title, description, Open Graph, Twitter
  and JSON-LD data carry the new name; the descriptions and JSON-LD
  (`alternateName`) keep the former name.
- Help: an `English | Japanese` switch next to the close button shows one
  language at a time. The first language follows the browser's language;
  the choice is kept in memory only. Both languages have the same sections
  (the Japanese help gains Sample Data).
- Help: a **Download GRSMD** button at the top (the latest GitHub release's
  `GRSMD.html`, opened in a new tab), a one-line note that it is a single
  HTML file that works offline, and the version of the open file.
- Help: Reload works in Chrome and Edge only; Esc (also closes the help),
  Copy SVG / Copy PNG (PC), printing, pasting on a phone, where the
  Download button goes, and that the clipboard permission note applies on
  goodrelax.github.io.
- While the help or the AI prompt is open, the one-key shortcuts (I, F, L,
  D, R, N, C, E, arrows, Esc) no longer act on the page behind it; Esc closes it.
  Opening it moves the focus in (the help's chosen language, or the prompt's
  close button), Tab and Shift+Tab go round inside it, and closing it gives
  the focus back to [?]. The close control is a real button (keyboard and
  screen readers).
- Page metadata: the title stays short; the former name and the reason for
  the rename are in the descriptions (also Open Graph and Twitter), the
  keywords and the JSON-LD.
- Esc in a block editor or a table cell now applies the change and closes
  it (it used to discard it). Ctrl+Z right after it takes the change back.
  With a change still open, the palette's Undo (and Ctrl+Z outside the
  editor) applies it and undoes it, so Redo can bring it back. Esc during
  IME composition still only cancels the composition.
- Undo goes back up to 30 changes (it was 1), and Redo goes forward again
  with Ctrl+Y or Ctrl+Shift+Z (Mac: Cmd+Shift+Z). There is no Redo button.
  In an open block, Redo is always the browser's (typing undone with Ctrl+Z
  comes back). The undo history does not keep a full copy of the text per
  change: 30 changes of a 1 MB document take about 2 MB (also with reference
  link definitions or many blank lines at the top).
- Enter in a table's Markdown source is a plain new line; Shift+Enter
  inserts `<br>`.
- The palette's red, blue and green are GitHub's colors (light `#CF222E`,
  `#0550AE`, `#1A7F37`; dark `#F85149`, `#58A6FF`, `#3FB950`), easier to
  tell apart. Text written with the former colors keeps its color as
  written.
- Help: the title row (title, language switch, close button) stays at the
  top while the help scrolls; the help's text is 75% of its former size;
  the Editing chapter is gone. Details lists Esc, Undo / Redo and the new
  insert line. The note on the clipboard permission of Paste copied link
  (shared by the pages of goodrelax.github.io in Chrome and Edge, and how
  to withdraw it) moves to Privacy & Security.
- Touch editing, PlantUML and small fixes: on a phone or tablet, a double
  tap on the preview zooms as the browser does and no longer starts
  editing; press `[Edit]`, then tap a block (a mouse double-click, or a
  pen double tap, still opens the block). The help's Details and the fourth line of the start
  screen now say how to start editing. A PlantUML diagram shows
  "Loading diagram..." until the page has fully loaded; then one dialog
  asks for all the diagrams that waited, and only the allowed ones are
  sent (a diagram added by an edit still waits for its Render button;
  Copy SVG / PNG of an allowed diagram fetches it again without asking).
  The mouse wheel over the dashed insert line between blocks, or over the
  bar of selected blocks, now scrolls the page as it does over the text
  (it did nothing). Ctrl+B / Ctrl+I (Mac: Cmd) in the Search box no longer
  formats the text of a block left open.

### Added

- Search: a **Search** button right of Index (or the `f` key; in edit mode
  also `Ctrl+F` / `Cmd+F`) shows a search box above the Index. It finds text
  in the Markdown source (in the code view, the file), including diagram and
  math source; `Aa` matches case and `.*` takes a regular expression (it is
  searched when you stop typing). `Down` / `Up` in the box go to the next /
  previous match; Enter does nothing. The block of the match gets a frame
  and its text a color (the current one orange), and a big table scrolls to
  the right row, sideways too. In edit mode, **Replace** and **All** replace
  the current match or all of them (`$1` and the like with a regular
  expression, read as the browser's `String.replace` reads them), and one
  Undo takes it back. A regular expression is run only when you search
  (stop typing, `Down` / `Up`, Replace / All): after a commit or an Undo
  the count says "Down: search again". A slow regular expression can still
  freeze the page while it runs: save before you replace with one. `Esc` in
  the box closes it;
  elsewhere `Esc` hides the edit palette first, then Search, then the Index.
  Nothing of it is stored or printed. The help says so in both languages.
- Index: an **Index** button, the first of the top bar's buttons (left of
  Search and Render Light), or the `i` key, shows the
  document's headings (h1 to h6) in a panel floating at the right edge of the
  Markdown view, under the top bar. Its ground lets 25 % of the text behind
  show through, and the panel scrolls by itself. Press a heading to bring it
  to the top of the view; the panel stays open until Index, `i` or `Esc` is
  pressed (`Esc` hides the edit palette first). The list follows every
  render, commit and Undo (only the changed blocks' headings are built
  again). Math in a heading is shown as its TeX source. The
  button is off on the start screen and in the code view, and the panel is
  not printed. The help says so in both languages.
- Math templates in the edit palette: the Text format popover has a second
  row with two buttons. **Insert inline math** puts the formula for Euler's
  number (Napier's constant) at the cursor of the open block; a space goes
  before or after it only where Markdown needs one to read it as math, and
  where it would not read as math (or not as before) nothing changes and a
  toast says so. It is off in a table cell. **Insert math boxes** adds three
  display math boxes at once, each under its name: Maxwell's Equations,
  Einstein Field Equations and Christoffel Symbols, and Schroedinger
  Equation, Wavefunction Normalization, and Pauli Matrices. They go in like
  Insert table and the Mermaid samples (the open block is applied and cut at
  the cursor line; refused inside code, math, HTML and a table's source),
  nothing opens afterwards so they are seen drawn, and one Undo takes all
  of them away. The help says so in both languages.
- The edit palette's grip (`::`) also shrinks the palette to the grip, and
  brings it back, on a double click; a press and hold still works. On a
  phone or tablet, and with a pen, two quick taps (within 0.5 s) do it; the
  palette takes no browser zoom, so the double tap does not zoom the page.
  Only two plain presses count: moving the palette or a press and hold
  in between does not. The double click selects no text and leaves the open
  block, its cursor and its selection as they were. The grip's tooltip and
  the help say so (owner rulings PD1 to PD3).
- In edit mode, drag over the text of some blocks (on a phone, long press
  and move the handles) to select those blocks whole: they get a blue frame
  and a small bar [Delete] [Cut] [Copy] shows under the selection (above it
  when there is no room). Even one block works. `Delete` / `Backspace`
  delete them, `Ctrl+X` cuts and `Ctrl+C` copies their Markdown source
  whole (Mac: `Cmd`), as do the context menu's Copy, a phone's callout and
  a Mac's Edit menu; Shift+Delete deletes too. The Copy button shows a check
  for a moment. No dialog
  or toast; one Undo brings all deleted blocks back. `Esc` clears the
  selection first. Outside edit mode a selection stays the browser's own.
  The clipboard is only written, never read; if the browser refuses the
  write, a toast says so and a cut deletes nothing. Paste with the existing ways
  (a block's editor, or the "+" between blocks).

- In edit mode, a dashed line with "+" shows in the gap between two blocks
  (and before the first and after the last one) under the mouse; click it
  to type a new block there, for example below a diagram or a table at the
  end of the document. On a phone, tap the gap to show the line, then tap
  the line. An empty one changes nothing; one Undo removes the new block.
  A block added at the end keeps the file's last newline.

- Date-time versions: `npm run build:release` shows the release's version in
  the help; any other build shows "Development build" and the time of the
  HEAD commit. `tools/release.mjs` writes a release's version and prints the
  tag and GitHub release commands. A test keeps `package.json`,
  `package-lock.json`, this file and `README.md` on the same version.

- A beta build: `npm run build:beta` makes the production build (into
  `output/beta/`) and writes `docs/grsmd-beta.html` from it: the same file
  as `docs/index.html` except that it asks search engines not to index it
  (`<meta name="robots" content="noindex" />`). That robots meta is the only
  difference: no BETA mark, and the same help,
  Content-Security-Policy and scripts. `docs/index.html` is not touched. It
  lets the next release be tried on a device without a local server (for
  example an iPad), at
  https://goodrelax.github.io/gr-simple-md-renderer/grsmd-beta.html once it
  is placed on `main`.

- Third-party notices: the built file now carries the copyright and license
  texts of the open source software it bundles, in a comment at the end of
  the file (a one-line pointer sits near the top), and the help gains a
  short **Licenses** section that lists them (name, version, license). The
  list covers every package whose code is in the bundle (direct and
  indirect, nested copies included), code that other tools bundled into a
  package's dist (for example langium and chevrotain inside
  @mermaid-js/parser, pako inside plantuml-encoder, the four packages
  inside roughjs, fmin inside @upsetjs/venn.js, gl-matrix inside cytoscape),
  the helpers that tools put into a dist (Babel, webpack, browserify,
  esbuild, @rollup/plugin-commonjs), the KaTeX fonts (SIL Open Font License 1.1) and the
  bundler's helpers (Vite, Rolldown). The
  texts come from node_modules, and from `tools/third-party-licenses/` for
  code whose own package is not installed (copied once from the npm
  tarballs); the build fetches nothing. DOMPurify is shown under
  Apache-2.0, chosen from its (MPL-2.0 OR Apache-2.0). The build fails on a
  license outside the allowed list (no GPL and the like), a missing text,
  or bundled code that `tools/third-party-extras.mjs` does not list (found
  by its marks, by a declared dependency that is not a module, or because a
  prebuilt dist has no record for its version, which means reading that dist
  again on each update), so a dependency update cannot drop a notice
  silently. The CSP hash does
  not change (comment and text only). About +15 KB gzip.

- Review standard: `spec/grsmd_review_standards_ja.md` is the rule for code
  reviews before a feature goes into `develop`. It takes the review standard
  of gr-sw-maker (a verbatim copy, pinned to commit `63e6fdc`, is
  `spec/upstream_review_standards_ja.md`), maps its rows onto GRSMD, marks
  the rows that do not apply, and adds GRSMD's own rows (privacy, single
  file, documents in step, tests that fail before the fix). The spec now
  names review rules by chapter and name instead of the old row numbers.

### Fixed

- A full render (Render, a theme switch, a dropped or pasted document) no
  longer takes the view back to where it was when the render began if you
  moved the view while the diagrams were being drawn (the Index, Search,
  the mouse wheel, a finger, a scroll key or the scroll bar): the view comes
  back to the text you were reading when you last moved it, even when the
  diagrams above it grow. Other keys (such as Shift) and presses outside the
  text do not count: the view goes back where it was.
- In edit mode, Delete now deletes the selected blocks in Microsoft Edge
  too. Edge shows its mini menu (Copilot, Copy, Search) beside a text
  selection, and while it shows, the keys do not reach the page. A mouse
  drag that selects text in the preview in edit mode no longer brings up
  that menu, also when the drag starts with a block open; a click
  (also on the selected text, which still clears the selection), the
  right-click menu and the selection itself are as before.
- A diagram's drag-to-pan now starts only past 5 px of movement, as every
  other tap-versus-drag decision does; a move of exactly 5 px no longer
  pans.
- A document with many leading blank lines no longer hangs on Render, paste
  or opening a `.md` file. The check for an AI ```` ```markdown ```` wrapper
  tried every way to split the blank lines, so each line doubled the time
  (41 lines took hours in Chrome; about 1 s in Safari). It now reads them
  line by line, with the same result. A static test flags nested
  quantifiers in the source's regular expressions.
- Long runs of spaces or newlines inside a line or a block no longer make
  editing slow. The end spaces and trailing newlines were found with
  patterns like `/[ \t]+$/`, which read a run that is not at the end again
  from every start in it (100,000 spaces in a line: seconds for each
  check). They are now counted from the end, with the same result. A
  static test flags such patterns and lookbehinds (which Safari before
  16.4 cannot parse).
- A long HTML block with many `<` and no `>` after them no longer makes
  opening or editing the document slow (600 KB took 16 s). The tags are
  now looked for only up to the last `>`, with the same result.

### Known issues

- Edit mode: the text selection callout of a phone or tablet (iPhone,
  iPad, Android) still shows over selected blocks; the bar shows below it.
  If Edge's mini menu shows anyway (for example after Ctrl+A), press Esc
  or click to close it before pressing Delete; Edge's settings can turn
  the mini menu off.
- Code View: a file whose content does not look like its language can take
  long to show (a `.js` file of only blank lines, 200 KB: 17.6 s), because
  some highlight.js language patterns are quadratic there. Real code is
  linear (5 MB in about 2 s; times of highlight.js alone, measured in
  Node). Open such a file with an extension that fits its content. The
  20,480-character limit of Markdown code blocks does not apply to Code
  View.

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
    newline, and the format and link buttons are checked when pressed (a
    notice says so when the format cannot be applied or there is no link to
    remove).
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

- Plain English UI texts. Toasts, confirms, alerts, the texts shown in place
  of diagrams and images, and the edit palette's tooltips are rewritten in
  short, everyday English (for example `Couldn't save. Your changes are
  kept.`, `Downloading: NAME. It's still not saved.`). The top input box is
  called "the top box". Palette names: "Paste link from clipboard" is now
  "Paste copied link", "Table options" is "Align column" and "Default
  alignment" is "Remove alignment"; the help follows.
  - The consent messages are one short question each. PlantUML: "Is it OK to
    send your PlantUML diagram data to the official PlantUML server
    (www.plantuml.com)?". Images from other sites: "Is it OK to get images
    from other sites?"; the dialog no longer lists the host names (the
    placeholders still show them). How consent works is unchanged.
  - Every text that JS shows to the user is now in `src/js/config.js`
    (`CONFIG.messages`); a static check keeps it there. The unused
    `fileDrop.messages.unsupportedType` and `externalImage.maxHostsInDialog`
    are removed.
  - A long toast wraps inside the screen instead of running off both sides.
- Insert table and Insert Mermaid sample no longer show the template's
  Markdown in the open editor. While a block is open, the editor is committed
  first, then the new block goes in at a line boundary: after the caret's
  line, or before it when the caret is at the start of a line (never in the
  middle of a word). Only paragraphs, lists and quotes are cut in two (a list
  between its items); other blocks get the new block above or below them. A
  table's first cell `Col1` then opens with its text selected (typing
  replaces it); a Mermaid sample opens its source with the caret after its
  first diagram line. In an empty document the table takes the empty block's
  place.
  - Inside code (including Mermaid and PlantUML), math, HTML or a table
    (also a table's source), at any depth in lists and quotes, the press is
    refused with the toast "Can't insert here. Try outside this block." and
    nothing changes.
  - Until the new cell or source opens, one-key shortcuts (such as `n` and
    `c`) are ignored, so typing right after the press opens no tab and
    clears nothing.
  - The commit and the insert are two undo steps: one Undo removes only the
    inserted block. A line break mark (two spaces or a backslash) left at
    the end of the cut line goes in the insert's step.
  - A cut never splits bold, italic, a link, a code span, a text color or
    other inline formatting that runs over two lines: the new block goes
    below that paragraph instead.
  - The opened cell or editor is scrolled into view only as far as needed.
- **Behaviour change: while a Markdown document is shown, rendering
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
- Internal: the document lifecycle moves out of `UIController` into a new
  class, `DocumentLifecycle` (use case layer, no UI). It holds the current
  `DocumentSession` and `DocumentLocation`, the document id, the save
  operation state machine (11-e) and runs Save / Save as and the Reload read.
  `main.js` composes it (with `SaveDocument` / `SaveDocumentAs`) and passes it
  to `UIController` as `services.documents` instead of `services.fileAccess`.
  No change in behavior.

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
