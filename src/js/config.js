// ========================================
// Configuration
// ========================================

// The AI prompt that [?] (long press) offers to copy: the MCBSMD output
// rules, given to an AI chat as is.
const PROMPT_BODY = `
## Output Format

- Output the entire content **as a single Markdown code block** so it can be copied in one go.
- **Enclose the entire Markdown with six backticks \` \`\`\`\`\`\` \` at the beginning and end.** Specify its language as markdown.
- **Use these six backticks only once as the outermost enclosure.**
- **Never output speculation or fabrications.** If something is unclear or requires investigation, explicitly state so.
- This method is called **MCBSMD** (Multiple Code Blocks in a Single Markdown)

### Code and Diagram Block Rules

- As a rule, use Mermaid for diagrams. Use PlantUML only when the diagram cannot be expressed in Mermaid.
- Any diagrams or software code inside the Markdown must each be enclosed in their own code blocks using triple backticks \` \`\`\` \`.
- Each code block must specify a language or file type (e.g., \` \`\`\`python \` or \` \`\`\`mermaid \`).
- Each code or diagram block must be preceded by a descriptive title in the format **title:**
  (e.g., \`**System Architecture:**\`, \`**Login Flow:**\`)
- Always follow the structure below for every code or diagram block:

  > **title:**
  >
  > \`\`\`language
  > (code or diagram content here without truncation or abbreviation)
  > \`\`\`
  >
  > Write the explanation for the code block here, immediately after the block, following a blank line.

- Do not write explanations inside the code blocks.
- In all diagrams, prefer alphanumeric characters and underscores (\`_\`); non-ASCII text (no spaces) is allowed only when non-English is more appropriate for the diagram. Special symbols (e.g., \`\\\`, \`/\`, \`|\`, \`<\`, \`>\`, \`{\`, \`}\`) are strictly prohibited.
- Output all diagram content without omission. Never use \`...\` or any shorthand.

### Diagram Label and Notation Rules

- All arrows and relationship lines in diagrams MUST have labels. Follow these notation rules:
  1. Mermaid \`flowchart\` and \`graph\`: place the label inside the arrow using pipes (e.g., \`A -->|Label| B\`)
  2. Other Mermaid diagrams / All PlantUML: place the label after the arrow using a colon (e.g., \`A --> B : Label\`)
- For line breaks in labels or node text:
  1. Mermaid: use \`<br/>\` inside a quoted string (e.g., \`A -->|"Line1<br/>Line2"| B\`, \`A["Line1<br/>Line2"]\`)
  2. PlantUML: use \`\\n\` (e.g., \`A -> B : Line1\\nLine2\`)

### Math Rules

- Use standard LaTeX notation for all mathematical formulas.
  1. Inline math: always use single dollar signs. Place a space before the opening \`$\`
     and a space after the closing \`$\`
     (e.g., \`The function is $y = x + 1$ here.\`)
  2. Block equations: always place \`$$\` on its own line, above and below the formula.
     Example:
     > $$
     > E = mc^2
     > $$
`;

export const CONFIG = {
  rendering: {
    stabilityTimeout: 1000,
    stabilityDebounce: 50,
    // Code blocks of the Markdown view (5.8.1): highlight.js has language
    // patterns that are quadratic in a long block. A block without a
    // language is detected from its first highlightDetectChars characters;
    // a block longer than highlightMaxChars is not highlighted (plain text).
    highlightDetectChars: 3072,
    highlightMaxChars: 20480,
  },
  plantuml: {
    imageLoadTimeout: 5000,
    serverUrl: "https://www.plantuml.com/plantuml/svg/",
    darkTheme: "cyborg",
  },
  ui: {
    longPressDuration: 300,
    copyFeedbackDuration: 250,
    maxTextSelection: 99999,
  },
  zoom: {
    min: 0.5,
    max: 5.0,
    step: 0.1,
  },
  pan: {
    activationThresholdPx: 5,
  },
  // Updated: markdownExtensions only; all other files go to code view
  fileDrop: {
    markdownExtensions: [".md"],
    maxBytes: 5 * 1024 * 1024,
    messages: {
      tooLarge: "This file is too big. The limit is 5 MB.",
      readError: "Couldn't read this file.",
      binaryFile: "GRSMD can only open text files.",
    },
  },
  // Every text the user sees from JS (R15). Toasts and confirms use
  // contractions with the ASCII apostrophe (R13).
  messages: {
    plantuml: {
      // CON-04, INV-02: asked with window.confirm before anything is sent
      consent:
        "Is it OK to send your PlantUML diagram data to the official PlantUML server (www.plantuml.com)?",
      canceled: "PlantUML diagram (not sent)",
      encodingFailed: "Couldn't prepare this PlantUML diagram.",
      timeout: (seconds) => `The PlantUML server didn't answer in ${seconds} seconds.`,
      serverError: "Couldn't get the diagram from the PlantUML server.",
      diagramAlt: "PlantUML Diagram", // alt of the server image
    },
    externalImage: {
      // CON-12, INV-19: one fixed sentence; the hosts are on the placeholders
      consent: "Is it OK to get images from other sites?",
      placeholder: (alt, hosts) =>
        `Image from another site${alt ? `: ${alt}` : ""} (${hosts}) - click to show`,
      placeholderTitle: "Click to show images from other sites (asks you first)",
    },
    diagram: {
      tooltip: "Ctrl+wheel: zoom | Double-click: reset | Drag: move", // Mermaid and PlantUML
      copySvg: "Copy SVG", // DiagramCopyController buttons
      copyPng: "Copy PNG",
      copied: "Copied!",
      copyFailed: "Failed",
      loading: "Loading diagram...", // a Mermaid box before mermaid has run (INV-81)
      loadFailed: "The diagram library could not be loaded.",
    },
    index: {
      empty: "This document has no headings.", // DocumentIndex with no heading
      emptyCode: "Nothing to list in this file.", // the code view's Index with no entry (INV-91)
    },
    search: { // DocumentSearch: the count beside the query, and a toast
      count: (current, total) => (current > 0 ? `${current} / ${total}` : total),
      none: "No results",
      invalid: "Invalid pattern",
      stale: "Down: search again", // a regular expression after the text changed (INV-80 (3))
      replaced: (count) => `Replaced ${count}.`,
    },
    markdown: {
      parseError: (message) => `Couldn't read this Markdown: ${message}`, // marked threw
    },
    // Initial state hint in #preview (FS-16). The three steps are padded to
    // the same length (spec 5.10).
    startScreen:
      "Get started:\n\n" +
      "  1. Paste Markdown (Ctrl+V)  ->  Markdown Preview                     \n" +
      "  2. Drop a .md file          ->  Markdown Preview                     \n" +
      "  3. Drop any text file       ->  Code View  (.py  .js  .json  .c  ...)",
    fileInfo: { // #fileInfo of the code view
      lines: (count) => `${count} lines`,
      size: (kb) => `${kb} KB`,
      updated: (when) => `Updated: ${when}`,
      // INV-89: the second line also shows the encoding and the line endings
      encoding: (name, bom) => (bom ? `${name} BOM` : name),
      lineEndings: { "\r\n": "CRLF", "\n": "LF", "\r": "CR", keep: "Mixed (kept)" },
    },
    // Code files (SC-27): the open dialog (INV-89), the save encoding
    // question and the save stop (INV-90). The fixed labels are in index.html.
    codeEdit: {
      encodingNames: { "utf-8": "UTF-8", shift_jis: "Shift_JIS", "euc-jp": "EUC-JP", "utf-16le": "UTF-16LE", "utf-16be": "UTF-16BE" },
      bom: (has) => (has ? "BOM: yes" : "BOM: no"),
      lineEndingCounts: (counts) => `CRLF ${counts.crlf}, LF ${counts.lf}, CR ${counts.cr}`,
      saveQuestion: (name) => `This file is in ${name}. Save it in ${name} or in UTF-8?`,
      saveOriginal: (name) => `${name} (original)`,
      unencodable: (name, lines) =>
        `Not saved: some characters can't be written in ${name} (lines ${lines}). Change them, or save in UTF-8.`,
      fileType: (ext) => `${ext} file`, // the file type name in the save dialog (Save as, NE-8)
      savedMarkdownUtf8: "Saved in UTF-8: .md files are always UTF-8.", // NE-30
      editorLabel: "Code editor", // the aria-label of the editor's textarea (INV-85)
      // INV-92: JSON fold and unfold (toasts)
      foldJsonOnly: "Folding works on JSON files.",
      foldInvalid: "This JSON can't be read, so it wasn't folded.",
      nothingToFold: "Nothing more to fold.",
      nothingToUnfold: "Nothing more to unfold.",
    },
    // The command palette of the code view (INV-92, NE-13): [Commands] / p.
    // key is the fold modifier shown: Ctrl, or Option on Apple platforms.
    codeCommands: {
      title: "Commands",
      modifier: { apple: "Option", other: "Ctrl" },
      fold: (key) => `Fold one level (${key}+Left)`,
      unfold: (key) => `Unfold one level (${key}+Right)`,
    },
    copy: {
      failed: "Couldn't copy. Select the text and press Ctrl+C (Mac: Cmd+C).",
      blocked: "Your browser blocked copying. Select the text and press Ctrl+C (Mac: Cmd+C).",
    },
    prompt: { // the AI prompt dialog (long press on [?])
      copied: "Copied!",
      body: PROMPT_BODY,
    },
    edit: {
      unsavedConfirm: "You have unsaved changes. Discard them?",
      externalChangeConfirm:
        "Something outside GRSMD changed this file. Replace it with your version?",
      overwriteUnknownConfirm:
        "GRSMD can't tell if this file changed since your last save. Replace it with your version?",
      saved: (name) => `Saved: ${name}`,
      downloadStarted: (name) => `Downloading: ${name}. It's still not saved.`,
      savingInProgress: "Still saving. Try again in a moment.",
      reloadFailed: "Couldn't reload the file.",
      reloadCanceled: "Reload stopped: the document changed.",
      saveFailed: "Couldn't save. Your changes are kept.",
      saveDenied: "Save not allowed. Your changes are kept.",
      saveNotFound: "Couldn't find the file. Use Save as.",
      saveActivationLost: "Save couldn't start. Press Save again.",
      editorRenderedFirst: "Updated from the top box. Try again.", // INV-45: the pressed action did not run
      blockSplitFailed: "You'll edit this document as one block.",
      emptyEditorConfirm:
        "The top box is empty.\nOK: make the document empty.\nCancel: put the document back in the top box.",
      plantumlPending: "PlantUML diagram (not sent)",
      plantumlRenderButton: "Render",
      hiddenLinkDefinition: "Hidden link address",
      hiddenHtml: "Hidden HTML",
      tableTab: "Markdown", // the tab of a table block (7.1)
      saveFileType: "Markdown", // the file type name in the save dialog (Save as)
      tableSourceTab: "Edit the table as Markdown",
      tableNotCellEditable: "Can't edit by cell. Opened as Markdown.",
      tableEditEnded: "No longer a table. Table editing ended.",
      noUrlInClipboard: "Couldn't find a copied link.", // INV-69 (also when reading was refused)
      linkTargetChanged: "The text changed, so no link was added.", // INV-69
      linkNotPastable: "You can't paste a link here.", // INV-69 (owner ruling F-R2)
      formatNotApplicable: "You can't use this format here.", // INV-71 huge blocks (owner ruling Q-f)
      linkNotRemovable: "There's no link to remove here.", // INV-71 huge blocks (as Q-f)
      insertNotPossible: "Can't insert here. Try outside this block.", // an insert the block cannot take
      mathNotInsertable: "You can't insert math here.", // inline math that would not read as math there (INV-52)
      gapInsert: "Insert a block here", // the line and "+" between blocks (INV-73)
      statusUnsaved: (name) => `${name} * unsaved`,
      statusSaved: (name) => `${name} - saved`,
    },
    // The bar of a block range (INV-74, owner ruling U1): icons only, these
    // are their tooltips and aria-labels. mod as in palette.
    blockRange: {
      bar: "Selected blocks",
      delete: "Delete blocks (Delete)",
      cut: (mod) => `Cut blocks (${mod}+X)`,
      copy: (mod) => `Copy blocks (${mod}+C)`,
      copyFailed: "Couldn't copy the blocks.", // the clipboard refused the write (toast)
      cutFailed: "Couldn't cut the blocks. Nothing was deleted.", // ... so the cut deleted nothing (toast)
    },
    // Tooltips and aria-labels of the edit palette (5.15.3). mod is the
    // primary modifier shown ("Ctrl", or "Cmd" on Apple platforms).
    palette: {
      modifier: { apple: "Cmd", other: "Ctrl" }, // the primary modifier key in the tooltips (INV-14)
      root: "Edit palette",
      grip: "Move palette (long press: minimize / restore)", // INV-68
      bold: (mod) => `Bold (${mod}+B)`,
      italic: (mod) => `Italic (${mod}+I)`,
      format: "Text format", // the button and its popover
      mermaid: "Insert Mermaid sample",
      save: (mod) => `Save (${mod}+S)`,
      saveAs: (mod) => `Save as (${mod}+Shift+S)`,
      insertTable: "Insert table",
      insertRow: "Insert row",
      rowDelete: "Delete row",
      insertColumn: "Insert column",
      columnDelete: "Delete column",
      tableOptions: "Align column", // the button and its popover (R6)
      undo: (mod) => `Undo (${mod}+Z)`,
      redo: (mod) => `Redo (${mod}+Shift+Z)`, // the code editor's palette only (NE-2)
      search: (mod) => `Search (${mod}+F)`, // the code editor's palette only (NE-2)
      mermaidMenu: "Mermaid samples",
      flowchart: "Flowchart",
      sequence: "Sequence diagram",
      state: "State diagram",
      class: "Class diagram",
      colorRed: "Text color: Red",
      colorBlue: "Text color: Blue",
      colorGreen: "Text color: Green",
      colorNone: "Remove text color",
      linkPaste: "Paste copied link", // R5
      linkRemove: "Remove link",
      alignLeft: "Align left",
      alignCenter: "Align center",
      alignRight: "Align right",
      alignNone: "Remove alignment", // R6
      inlineMath: "Insert inline math: Euler's number (Napier's constant)", // owner ruling 2026-10-25
      mathBox: "Insert math boxes: Maxwell, Einstein, Schroedinger",
    },
  },
  // New: smooth scroll physics parameters
  scroll: {
    maxSpeed: 0.5,      // px/ms
    acceleration: 0.001, // px/ms^2
    friction: 0.5,       // velocity multiplier per 60fps frame
  },
  // New: code view settings
  codeView: {
    defaultTheme: "dark",
    keyHintDurationMs: 5000,
    toastDurationMs: 3000,
    reloadUnavailableMsg: "Reload works only in Chrome and Edge.",
    reloadNoFileMsg: "No file to reload. Drop a file first.",
    highlightWaitMs: 3000, // the code view waits this long for highlight.js, then shows the code plain (INV-81 (3))
  },
  // Editing non-.md files in the code view (SC-27)
  codeEdit: {
    highlightPauseMs: 200, // INV-86: the editor is colored again this long after typing stops
    highlightMaxChars: 200 * 1024, // INV-86: a longer text is plain while editing (provisional)
    undoPauseMs: 1000, // INV-88: a typing step ends after this long without typing
    defaultIndent: "    ", // INV-87: the indent unit when the file shows none
    sampleLines: 5, // INV-89: lines shown in the open dialog's preview
    maxListedLines: 10, // INV-90: line numbers listed when characters can't be saved
    downloadMimeType: "application/octet-stream", // INV-90: a code file downloaded (no write API)
  },
  // In-place Markdown editing (SC-22 to SC-24)
  edit: {
    paletteMarginPx: 16, // gap from viewport bottom-right (INV-32)
    paletteLongPressMs: 500, // grip long press toggles minimized (INV-68)
    textColors: { // INV-66; the light value is written in the source
      red: { light: "#CF222E", dark: "#F85149" },
      blue: { light: "#0550AE", dark: "#58A6FF" },
      green: { light: "#1A7F37", dark: "#3FB950" },
    },
    invisibleMarkMaxChars: 50000, // INV-70: no marks layer above this length
    invisibleMarkMaxMarks: 2000, // INV-70: ... nor above this many marks
    caretLineMaxChars: 20000, // INV-84: a wrapping text longer than this before the caret keeps the block's top
    linkSchemes: ["http:", "https:", "mailto:"], // a text that is a link URL (INV-69, INV-72 (a))
    maxPastedUrlLength: 2048, // INV-69
    doubleTapMaxIntervalMs: 300, // double-tap detection (INV-31), tune on device
    doubleTapMaxDistancePx: 24,
    defaultFileName: "untitled.md",
    // INV-79: the save dialog's id; the browser remembers its last folder
    // by this id (the app stores nothing)
    savePickerId: "grsmd-markdown",
    commitBudgetMs: 300, // performance target for 1 MB (INV-51), used by tests
    // A longer body is not written into the visible #editor on every commit,
    // undo or insert (laying out 1 MB of textarea text takes ~0.5 s in Chrome).
    // It is written before the user can use #editor (INV-47).
    editorSyncMaxChars: 100000,
    diffMaxCells: 250000, // max LCS table cells for the middle range (INV-42)
    titleUnsavedPrefix: "* ", // document.title prefix while dirty (INV-50)
    undoMaxSteps: 30, // Undo and Redo keep this many units each; the oldest goes first (INV-48)
    gapHitPx: 6, // B1: the insert line shows within this distance of a gap between blocks (INV-73)
    blockRangeBarGapPx: 6, // INV-74: the bar of a block range is this far below (above) the selection's last line
    blockRangeBarMarginPx: 8, // INV-74: ... and at least this far inside the viewport
    tableTemplate:
      "| Col1 | Col2 | Col3 |\n|---|---|---|\n|  |  |  |\n|  |  |  |\n|  |  |  |",
    tableLineBreak: "<br>", // inserted on Shift+Enter inside a table's source (INV-27)
    // The palette's math (Text format, owner ruling 2026-10-25): inline math at
    // the caret, and the three math boxes, each under its name, in one insert.
    inlineMathTemplate: String.raw`$e = \lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^{n} = \sum_{k=0}^{\infty} \frac{1}{k!}$`,
    mathBoxesTemplate: [
      "Maxwell's Equations",
      "",
      "$$",
      String.raw`\begin{aligned}`,
      String.raw`\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\`,
      String.raw`\nabla \cdot \mathbf{B} &= 0 \\`,
      String.raw`\nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t} \\`,
      String.raw`\nabla \times \mathbf{B} &= \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}`,
      String.raw`\end{aligned}`,
      "$$",
      "",
      "Einstein Field Equations and Christoffel Symbols",
      "",
      "$$",
      String.raw`\begin{aligned}`,
      String.raw`R_{\mu\nu} - \frac{1}{2} R \, g_{\mu\nu} + \Lambda g_{\mu\nu} &= \frac{8 \pi G}{c^{4}} T_{\mu\nu} \\`,
      String.raw`\Gamma^{\lambda}_{\mu\nu} &= \frac{1}{2} g^{\lambda\sigma} \left( \partial_{\mu} g_{\sigma\nu} + \partial_{\nu} g_{\sigma\mu} - \partial_{\sigma} g_{\mu\nu} \right)`,
      String.raw`\end{aligned}`,
      "$$",
      "",
      "Schroedinger Equation, Wavefunction Normalization, and Pauli Matrices",
      "",
      "$$",
      String.raw`\begin{aligned}`,
      String.raw`i\hbar \frac{\partial}{\partial t} \Psi(\mathbf{r}, t) &= \left[ -\frac{\hbar^{2}}{2m} \nabla^{2} + V(\mathbf{r}, t) \right] \Psi(\mathbf{r}, t) \\`,
      String.raw`\langle \Psi \mid \Psi \rangle &= \int \lvert \Psi \rvert^{2} \, d^{3}r = 1 \\`,
      String.raw`\sigma_x &= \begin{pmatrix} 0 & 1 \\ 1 & 0 \end{pmatrix}, \quad`,
      String.raw`\sigma_y = \begin{pmatrix} 0 & -i \\ i & 0 \end{pmatrix}, \quad`,
      String.raw`\sigma_z = \begin{pmatrix} 1 & 0 \\ 0 & -1 \end{pmatrix}`,
      String.raw`\end{aligned}`,
      "$$",
    ].join("\n"),
    mermaidSamples: {
      flowchart:
        "```mermaid\nflowchart TD\n    Start([Start]) -->|input| Check{Valid}\n    Check -->|yes| Process[Process_data]\n    Check -->|no| Error[Show_error]\n    Process -->|done| End([End])\n    Error -->|retry| Start\n```",
      sequence:
        "```mermaid\nsequenceDiagram\n    participant User\n    participant App\n    participant Server\n    User->>App: Click_button\n    App->>Server: Send_request\n    Server-->>App: Return_result\n    App-->>User: Show_result\n```",
      state:
        "```mermaid\nstateDiagram-v2\n    [*] --> Idle : start\n    Idle --> Running : run\n    Running --> Paused : pause\n    Paused --> Running : resume\n    Running --> Idle : stop\n    Idle --> [*] : exit\n```",
      class:
        "```mermaid\nclassDiagram\n    class Animal {\n        +String name\n        +move() void\n    }\n    class Dog {\n        +bark() void\n    }\n    class Owner {\n        +String name\n    }\n    Animal <|-- Dog : inherits\n    Owner \"1\" --> \"*\" Dog : owns\n```",
    },
  },
  // Editor background colors per view mode and theme (CSS-driven via body class)
  editorColors: {
    markdown: { light: "#FFF8F0", dark: "#2D2520" },
    code:     { light: "#F0F4FF", dark: "#1A1E2E" },
  },
  // Keyboard hint text per view mode
  keyHints: {
    markdown: "[I] Index; [F] Search; [L] Light; [D] Dark; [R] Reload; [N] New Tab; [C] Clear; [E] Edit;\n[Up][Down] Scroll Up/Down;",
    code:     "[I] Index; [F] Search; [P] Commands; [L] Light; [D] Dark; [R] Reload; [N] New Tab; [C] Clear; [E] Edit;\n[Up][Down] Scroll Up/Down; [Ctrl+Left][Ctrl+Right] Fold (JSON);",
  },
};

// ========================================
// Constants
// ========================================

// File extension to highlight.js language ID mapping (FR-02, Sect 3.10)
export const EXT_TO_HLJS = {
  // Python
  ".py": "python", ".pyw": "python",
  // JavaScript / TypeScript
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".jsx": "javascript", ".ts": "typescript", ".tsx": "typescript",
  // C / C++
  ".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp",
  ".cxx": "cpp", ".hpp": "cpp", ".hxx": "cpp",
  // C# / Java
  ".cs": "csharp", ".java": "java",
  // Go / Rust / Swift / Kotlin / Scala
  ".go": "go", ".rs": "rust", ".swift": "swift",
  ".kt": "kotlin", ".kts": "kotlin", ".scala": "scala",
  // Ruby / PHP / Perl
  ".rb": "ruby", ".php": "php", ".pl": "perl", ".pm": "perl",
  // Shell / PowerShell
  ".sh": "bash", ".bash": "bash", ".zsh": "bash",
  ".fish": "bash", ".ps1": "powershell", ".psm1": "powershell",
  // Data / Config
  ".json": "json", ".jsonc": "json", ".xml": "xml", ".svg": "xml",
  ".html": "xml", ".htm": "xml", ".yaml": "yaml", ".yml": "yaml",
  ".toml": "ini", ".ini": "ini", ".cfg": "ini", ".conf": "ini",
  // Web styles
  ".css": "css", ".scss": "scss", ".sass": "scss", ".less": "less",
  // Database
  ".sql": "sql",
  // Functional / System / Other
  ".r": "r", ".R": "r", ".lua": "lua",
  ".ex": "elixir", ".exs": "elixir",
  ".erl": "erlang", ".hrl": "erlang",
  ".hs": "haskell", ".lhs": "haskell",
  ".clj": "clojure", ".cljs": "clojure",
  ".dart": "dart", ".groovy": "groovy", ".gradle": "groovy",
  ".vim": "vim", ".tex": "latex",
  ".diff": "diff", ".patch": "diff",
  ".proto": "protobuf", ".graphql": "graphql", ".gql": "graphql",
  // Plain text (no color)
  ".txt": "plaintext", ".log": "plaintext",
  ".csv": "plaintext", ".tsv": "plaintext",
  ".md": "markdown", // normally routed to Markdown Preview
  // Extensionless files matched by full filename
  "Dockerfile": "dockerfile",
  "Makefile": "makefile",
  "GNUmakefile": "makefile",
};

// Binary file extensions blacklist (INV-18)
// Files with these extensions are rejected without content inspection.
export const BINARY_EXTENSIONS = new Set([
  // Images
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg", ".tiff", ".tif",
  // Audio
  ".mp3", ".wav", ".ogg", ".flac", ".aac", ".wma", ".m4a",
  // Video
  ".mp4", ".avi", ".mov", ".mkv", ".wmv", ".flv", ".webm",
  // Archives
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".xz",
  // Executables / Libraries
  ".exe", ".dll", ".so", ".dylib", ".bin", ".msi", ".dmg", ".app", ".deb", ".rpm",
  // Documents (binary formats)
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp",
  // Compiled / Object
  ".class", ".o", ".obj", ".pyc", ".pyo", ".wasm",
  // Fonts
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
  // Database
  ".db", ".sqlite", ".sqlite3",
]);

// FileSystemFileHandle availability check (CON-01): the receiver before the
// core uses it too (earlyInput.js)
export { FILE_SYSTEM_HANDLE_SUPPORTED } from "./earlyInput.js";
