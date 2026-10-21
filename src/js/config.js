// ========================================
// Configuration
// ========================================

export const CONFIG = {
  rendering: {
    stabilityTimeout: 1000,
    stabilityDebounce: 50,
  },
  plantuml: {
    imageLoadTimeout: 5000,
    serverUrl: "https://www.plantuml.com/plantuml/svg/",
    darkTheme: "cyborg",
  },
  // External images in Markdown are consent-gated (CON-12, INV-19)
  externalImage: {
    maxHostsInDialog: 10,
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
      tooLarge: "Dropped file is too large. Maximum file size is 5 MB.",
      readError: "Failed to read the dropped file.",
      unsupportedType: "Unsupported file type. Only text-based files with recognized extensions are accepted.",
      binaryFile: "Binary file is not supported.",
    },
  },
  messages: {
    plantuml: {
      canceled: "Rendering Canceled",
      encodingFailed: "PlantUML encoding failed",
      timeout: (seconds) => `PlantUML timeout (${seconds}s)`,
      serverError: "PlantUML server error",
    },
    externalImage: {
      placeholder: (alt, hosts) =>
        `External image${alt ? `: ${alt}` : ""} (${hosts}) - click to load`,
      placeholderTitle: "Click to load external images (asks for consent first)",
    },
    copy: {
      failed: "Copy failed.",
      blocked: "Browser denied copy.",
    },
    edit: {
      unsavedConfirm: "You have unsaved changes. Discard them?",
      externalChangeConfirm:
        "This file was changed outside GRSMD. Overwrite it?",
      overwriteUnknownConfirm:
        "GRSMD could not confirm whether this file changed since the last save. Overwrite it?",
      saved: (name) => `Saved: ${name}`,
      downloadStarted: (name) =>
        `Download started: ${name}. The tab stays marked unsaved.`,
      savingInProgress: "Saving. Try again when the save finishes.",
      reloadFailed: "Reload failed. The file could not be read.",
      reloadCanceled: "Reload canceled. The document changed while reading.",
      saveFailed: "Save failed. Your changes are kept.",
      saveDenied: "Write permission was denied. Your changes are kept.",
      saveNotFound: "The file was not found. Use Save as.",
      saveActivationLost: "Save could not start. Press Save again.",
      editorRenderedFirst:
        "The top editor had unrendered changes. Rendered them first.",
      blockSplitFailed:
        "This document could not be split into blocks. It is edited as one block.",
      emptyEditorConfirm:
        "The top editor is empty. OK: replace the whole document with an empty one. Cancel: put the document back into the top editor.",
      plantumlPending: "PlantUML diagram (not sent)",
      plantumlRenderButton: "Render",
      hiddenLinkDefinition: "link definition",
      hiddenHtml: "hidden HTML",
      tableSourceTab: "Edit the table as Markdown",
      tableNotCellEditable:
        "This table cannot be edited by cell. Opened its Markdown instead.",
      tableEditEnded: "The table changed into other blocks. Table editing ended.",
      statusUnsaved: (name) => `${name} * unsaved`,
      statusSaved: (name) => `${name} - saved`,
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
    reloadUnavailableMsg: "Reload not available (Chrome/Edge 86+ required)",
    reloadNoFileMsg: "No file to reload. Drop a file to enable reload.",
  },
  // In-place Markdown editing (SC-22 to SC-24)
  edit: {
    paletteMarginPx: 16, // gap from viewport bottom-right (INV-32)
    paletteLongPressMs: 500, // grip long press toggles minimized (INV-68)
    textColors: { // INV-66; the light value is written in the source
      red: { light: "#B84F00", dark: "#E0661A" },
      blue: { light: "#0072B2", dark: "#56B4E9" },
      green: { light: "#007A58", dark: "#009E73" },
    },
    invisibleMarkMaxChars: 50000, // INV-70: no marks layer above this length
    linkSchemes: ["http:", "https:", "mailto:"], // a text that is a link URL (INV-69, INV-72 (a))
    maxPastedUrlLength: 2048, // INV-69
    doubleTapMaxIntervalMs: 300, // double-tap detection (INV-31), tune on device
    doubleTapMaxDistancePx: 24,
    defaultFileName: "untitled.md",
    commitBudgetMs: 300, // performance target for 1 MB (INV-51), used by tests
    // A longer body is not written into the visible #editor on every commit,
    // undo or insert (laying out 1 MB of textarea text takes ~0.5 s in Chrome).
    // It is written before the user can use #editor (INV-47).
    editorSyncMaxChars: 100000,
    diffMaxCells: 250000, // max LCS table cells for the middle range (INV-42)
    titleUnsavedPrefix: "* ", // document.title prefix while dirty (INV-50)
    tableTemplate:
      "| Col1 | Col2 | Col3 |\n|---|---|---|\n|  |  |  |\n|  |  |  |\n|  |  |  |",
    tableLineBreak: "<br>", // inserted on Enter inside a table (INV-27)
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
    markdown: "[L] Light; [D] Dark; [R] Reload; [N] New Tab; [C] Clear; [E] Edit;\n[Up][Down] Scroll Up/Down;",
    code:     "[L] Light; [D] Dark; [R] Reload; [N] New Tab; [C] Clear;\n[Up][Down] Scroll Up/Down;",
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

// FileSystemFileHandle availability check (CON-01)
export const FILE_SYSTEM_HANDLE_SUPPORTED =
  typeof DataTransferItem !== "undefined" &&
  typeof DataTransferItem.prototype.getAsFileSystemHandle === "function";
