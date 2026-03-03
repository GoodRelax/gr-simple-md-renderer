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
    },
  },
  messages: {
    plantuml: {
      canceled: "Rendering Canceled",
      encodingFailed: "PlantUML encoding failed",
      timeout: (seconds) => `PlantUML timeout (${seconds}s)`,
      serverError: "PlantUML server error",
    },
    copy: {
      failed: "Copy failed.",
      blocked: "Browser denied copy.",
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
    keyHintDurationMs: 3000,
    toastDurationMs: 3000,
    reloadUnavailableMsg: "Reload not available (Chrome/Edge 86+ required)",
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

// FileSystemFileHandle availability check (CON-01)
export const FILE_SYSTEM_HANDLE_SUPPORTED =
  typeof DataTransferItem !== "undefined" &&
  typeof DataTransferItem.prototype.getAsFileSystemHandle === "function";
