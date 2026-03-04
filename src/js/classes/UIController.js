import { CONFIG, EXT_TO_HLJS, BINARY_EXTENSIONS, FILE_SYSTEM_HANDLE_SUPPORTED } from "../config.js";
import { applySystemTheme, systemTheme } from "../utils.js";
import ModalController from "./ModalController.js";

/**
 * Translates UI events into use-case calls.
 * Handles: render buttons, utility buttons, file drop (all files),
 * paste, keyboard shortcuts, modals, long-press.
 * Manages view mode UI chrome via setViewMode() and showKeyHint().
 */
export default class UIController {
  /**
   * @param {RendererOrchestrator} orchestrator
   * @param {ApplicationState} state
   * @param {object} elements
   * @param {SmoothScrollEngine} scrollEngine
   */
  constructor(orchestrator, state, elements, scrollEngine) {
    this.orchestrator = orchestrator;
    this.state = state;
    this.elements = elements;
    this.scrollEngine = scrollEngine;
    this.longPressTimer = null;
    this.isLongPress = false;
    this._keyHintTimer = null;

    this.setupEventListeners();
    this.setupModals();
    this.setupPromptText();

    // Initialize view: show affordance and set initial view mode
    this._showAffordance();
    this.setViewMode("initial");
  }

  setupEventListeners() {
    this.setupRenderButtons();
    this.setupUtilityButtons();
    this.setupHelpButton();
    this.setupPromptButton();
    this.setupFileDrop();
    this.setupAutoRenderOnPaste();
    this.setupKeyboard();
    // Apply OS color-scheme preference on first load
    applySystemTheme();
  }

  /**
   * Strip an optional ```markdown fenced wrapper that AI tools sometimes add.
   * @param {string} rawText
   * @returns {string}
   */
  preprocessInput(rawText) {
    return rawText
      .replace(/^(?:\s*\n)*`{3,}markdown\s*\n/i, "")
      .replace(/\n`{3,}\s*$/i, "");
  }

  // ---- View mode management ----

  /**
   * Set the application view mode and update UI chrome accordingly.
   * @param {'initial'|'markdown'|'code'} mode
   * @param {CodeViewMeta} [metadata] - required when mode is 'code'
   */
  setViewMode(mode, metadata) {
    // Set body class: view-initial / view-markdown / view-code
    document.body.classList.remove("view-initial", "view-markdown", "view-code");
    document.body.classList.add(`view-${mode}`);

    const fileInfo = this.elements.fileInfo;
    const editor = this.elements.editor;
    const affordance = document.getElementById("affordanceText");

    switch (mode) {
      case "code":
        if (fileInfo) {
          fileInfo.textContent = this._formatFileInfo(metadata);
          fileInfo.style.display = "block";
        }
        editor.readOnly = true;
        editor.style.display = "none";
        if (affordance) affordance.style.display = "none";
        break;
      case "markdown":
        if (fileInfo) fileInfo.style.display = "none";
        editor.readOnly = false;
        editor.style.display = "";
        if (affordance) affordance.style.display = "none";
        break;
      case "initial":
        if (fileInfo) fileInfo.style.display = "none";
        editor.readOnly = false;
        editor.style.display = "";
        if (affordance) affordance.style.display = "block";
        break;
    }
  }

  /**
   * Show keyboard shortcut hints in #keyHint, then fade out.
   * @param {'initial'|'markdown'|'code'} mode
   */
  showKeyHint(mode) {
    const hint = this.elements.keyHint;
    if (!hint) return;
    const text = CONFIG.keyHints[mode];
    if (!text) {
      hint.style.display = "none";
      return;
    }
    hint.textContent = text;
    hint.style.opacity = "1";
    hint.style.display = "block";
    clearTimeout(this._keyHintTimer);
    this._keyHintTimer = setTimeout(() => {
      hint.style.opacity = "0";
    }, CONFIG.codeView.keyHintDurationMs);
  }

  /**
   * Format CodeViewMeta into a display string for #fileInfo.
   * @param {CodeViewMeta} metadata
   * @returns {string}
   */
  _formatFileInfo(metadata) {
    if (!metadata) return "";
    const { fileName, fileSize, lineCount, language, loadedAtStr } = metadata;
    const sizeStr = (fileSize / 1024).toFixed(2) + " KB";
    return `${fileName}  |  ${lineCount} lines  |  ${sizeStr}  |  ${language || "plaintext"}  |  Loaded: ${loadedAtStr}`;
  }

  // ---- Affordance management ----

  /**
   * Show affordance text in #preview. Called during initialization
   * and on clear to display the initial state hint.
   */
  _showAffordance() {
    let el = this.elements.preview.querySelector("#affordanceText");
    if (!el) {
      el = document.createElement("div");
      el.id = "affordanceText";
      this.elements.preview.appendChild(el);
    }
    el.textContent =
      "Get started:\n\n" +
      "  1. Paste Markdown (Ctrl+V)  ->  Markdown Preview\n" +
      "  2. Drop a .md file          ->  Markdown Preview\n" +
      "  3. Drop any text file       ->  Code View  (.py  .js  .json  .c  ...)";
    el.style.display = "block";
  }

  // ---- Event setup ----

  setupRenderButtons() {
    this.elements.renderLightBtn.addEventListener("click", async () => {
      await this.handleRender("light");
    });
    this.elements.renderDarkBtn.addEventListener("click", async () => {
      await this.handleRender("dark");
    });
  }

  setupUtilityButtons() {
    this.elements.newTabBtn.addEventListener("click", () => {
      window.open(window.location.href, "_blank");
    });
    this.elements.clearBtn.addEventListener("click", () => {
      this.doClear();
    });
  }

  /**
   * Dispatch render based on current view state (FR-06, Sect 3.4).
   * - Code view: reload the source file with the new theme.
   * - Markdown view: re-render markdown with the new theme.
   * - Initial state with editor content: first render via loadMarkdown.
   * @param {'light'|'dark'} theme
   */
  async handleRender(theme) {
    if (this.orchestrator.isCodeViewActive()) {
      const metadata = await this.orchestrator.reloadCodeView(theme);
      if (metadata) this.setViewMode("code", metadata);
    } else if (!this.orchestrator.isPreRenderState()) {
      const content = this.preprocessInput(this.elements.editor.value);
      this.state.setMarkdownText(content);
      await this.orchestrator.reRender(theme);
      this.setViewMode("markdown");
      this.showKeyHint("markdown");
    } else {
      // Initial state: render if editor has content (paste / manual input)
      const content = this.preprocessInput(this.elements.editor.value);
      if (content.trim()) {
        await this.orchestrator.loadMarkdown(content, theme);
        this.setViewMode("markdown");
        this.showKeyHint("markdown");
      }
    }
  }

  /**
   * Full clear: destroy view, clear editor, restore system theme,
   * set view mode to initial.
   */
  doClear() {
    this.scrollEngine.destroy();
    this.orchestrator.clear();
    this.elements.editor.value = "";
    applySystemTheme();
    this._showAffordance();
    this.setViewMode("initial");
  }

  /**
   * Document-level drag-and-drop handler.
   * Routes by extension: .md -> Markdown Preview, all others -> Code View.
   * Follows CON-01: getAsFileSystemHandle() must be called synchronously
   * before the first await.
   */
  setupFileDrop() {
    document.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });

    document.addEventListener("drop", async (e) => {
      e.preventDefault();

      const item = e.dataTransfer.items?.[0];

      // CON-01: call synchronously before any await
      const handlePromise =
        FILE_SYSTEM_HANDLE_SUPPORTED
          ? item?.getAsFileSystemHandle?.() ?? null
          : null;

      const file = e.dataTransfer.files[0];
      if (!file) return;

      if (file.size > CONFIG.fileDrop.maxBytes) {
        alert(CONFIG.fileDrop.messages.tooLarge);
        return;
      }

      const ext = file.name.includes(".")
        ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
        : "";

      if (CONFIG.fileDrop.markdownExtensions.includes(ext)) {
        // (1) .md -> Markdown Preview (with preprocessInput)
        let text;
        try {
          text = await file.text();
        } catch (_) {
          alert(CONFIG.fileDrop.messages.readError);
          return;
        }
        text = this.preprocessInput(text);
        this.elements.editor.value = text;
        await this.orchestrator.loadMarkdown(text, systemTheme());
        this.setViewMode("markdown");
        this.showKeyHint("markdown");
      } else if (EXT_TO_HLJS[ext] || EXT_TO_HLJS[file.name]) {
        // (2) Known text extension -> Code View
        this.elements.editor.value = ""; // RTC2-07: clear editor before code view
        const fileHandle = handlePromise ? await handlePromise : null;
        const metadata = await this.orchestrator.renderCodeView(file, fileHandle);
        this.setViewMode("code", metadata);
        this.showKeyHint("code");
      } else if (BINARY_EXTENSIONS.has(ext)) {
        // (3) Known binary extension -> reject
        alert(CONFIG.fileDrop.messages.binaryFile);
      } else {
        // (4)/(5) Unknown extension -> null byte check on first 8KB
        let bytes;
        try {
          const slice = file.slice(0, 8192);
          bytes = new Uint8Array(await slice.arrayBuffer());
        } catch (_) {
          alert(CONFIG.fileDrop.messages.readError);
          return;
        }
        if (bytes.some((b) => b === 0)) {
          alert(CONFIG.fileDrop.messages.binaryFile);
          return;
        }
        // Text file with unknown extension -> Code View (plaintext)
        this.elements.editor.value = ""; // RTC2-07: clear editor before code view
        const fileHandle = handlePromise ? await handlePromise : null;
        const metadata = await this.orchestrator.renderCodeView(file, fileHandle);
        this.setViewMode("code", metadata);
        this.showKeyHint("code");
      }
    });
  }

  /**
   * Global paste handler: auto-render when in initial state and editor is empty.
   */
  setupAutoRenderOnPaste() {
    document.addEventListener("paste", async (e) => {
      const target = e.target;
      const isOtherInput =
        (target.tagName === "TEXTAREA" || target.tagName === "INPUT") &&
        target !== this.elements.editor;
      if (isOtherInput) return;
      // Only auto-render from initial state with empty editor
      if (
        !this.orchestrator.isPreRenderState() ||
        this.elements.editor.value.trim() !== ""
      )
        return;
      const text = e.clipboardData.getData("text/plain");
      if (!text) return;
      e.preventDefault();
      this.elements.editor.value = text;
      await this.handleRender(systemTheme());
    });
  }

  /**
   * Keyboard shortcuts (Sect 3.12).
   * Up/Down: smooth scroll (disabled in initial state).
   * l / d: render or reload with theme.
   * n: new tab.
   * c: clear.
   */
  setupKeyboard() {
    document.addEventListener("keydown", (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          if (!this.orchestrator.isPreRenderState())
            this.scrollEngine.startScroll(-1);
          break;
        case "ArrowDown":
          e.preventDefault();
          if (!this.orchestrator.isPreRenderState())
            this.scrollEngine.startScroll(+1);
          break;
        case "l":
          this.handleRender("light");
          break;
        case "d":
          this.handleRender("dark");
          break;
        case "n":
          window.open(window.location.href, "_blank");
          break;
        case "c":
          this.doClear();
          break;
      }
    });

    document.addEventListener("keyup", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown")
        this.scrollEngine.stopScroll();
    });
  }

  setupHelpButton() {
    this.elements.helpBtn.addEventListener("mousedown", (e) =>
      this.startPress(e),
    );
    this.elements.helpBtn.addEventListener("mouseup", () =>
      this.cancelPress(),
    );
    this.elements.helpBtn.addEventListener("mouseleave", () =>
      this.cancelPress(),
    );

    this.elements.helpBtn.addEventListener("touchstart", (e) =>
      this.startPress(e),
    );
    this.elements.helpBtn.addEventListener("touchend", (e) => {
      this.cancelPress();
      if (!this.isLongPress) {
        e.preventDefault();
        this.handleHelpClick(e);
      }
    });

    this.elements.helpBtn.addEventListener("click", (e) =>
      this.handleHelpClick(e),
    );
  }

  setupPromptButton() {
    this.elements.copyPromptBtn.addEventListener("click", async () => {
      const text = this.elements.promptText.value;
      if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(text);
          this.showCopySuccess();
          return;
        } catch {
          // Fall through to execCommand fallback
        }
      }
      this.elements.promptText.select();
      this.elements.promptText.setSelectionRange(
        0,
        CONFIG.ui.maxTextSelection,
      );
      try {
        const ok = document.execCommand("copy");
        if (ok) {
          this.showCopySuccess();
        } else {
          alert(CONFIG.messages.copy.failed);
        }
      } catch (err) {
        alert(CONFIG.messages.copy.blocked);
      }
    });
  }

  setupModals() {
    const helpCloseBtn =
      this.elements.helpModal.querySelector(".close-btn");
    const promptCloseBtn =
      this.elements.promptModal.querySelector(".prompt-close");
    ModalController.setupModal(this.elements.helpModal, [helpCloseBtn]);
    ModalController.setupModal(this.elements.promptModal, [
      promptCloseBtn,
    ]);
  }

  setupPromptText() {
    const COPY_PAYLOAD = `
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
- In all diagrams, use alphanumeric characters and underscores (\`_\`) by default; non-ASCII plain text (no spaces) is permitted when necessary. Special symbols (e.g., \`\\\`, \`/\`, \`|\`, \`<\`, \`>\`, \`{\`, \`}\`) are strictly prohibited.
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
    this.elements.promptText.value = COPY_PAYLOAD;
  }

  /** @param {Event} e */
  startPress(e) {
    if (e.type === "mousedown" && e.button !== 0) return;
    this.isLongPress = false;
    this.longPressTimer = setTimeout(() => {
      this.isLongPress = true;
      ModalController.show(this.elements.promptModal);
    }, CONFIG.ui.longPressDuration);
  }

  cancelPress() {
    clearTimeout(this.longPressTimer);
  }

  /** @param {Event} e */
  handleHelpClick(e) {
    if (this.isLongPress) {
      e.preventDefault();
      e.stopPropagation();
      this.isLongPress = false;
      return;
    }
    ModalController.show(this.elements.helpModal);
  }

  showCopySuccess() {
    const original = this.elements.copyPromptBtn.textContent;
    this.elements.copyPromptBtn.textContent = "Copied!";
    setTimeout(() => {
      this.elements.copyPromptBtn.textContent = original;
      ModalController.hide(this.elements.promptModal);
    }, CONFIG.ui.copyFeedbackDuration);
  }
}
