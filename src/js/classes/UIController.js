import { CONFIG, FILE_SYSTEM_HANDLE_SUPPORTED } from "../config.js";
import { applyTheme, applySystemTheme, systemTheme } from "../utils.js";
import ModalController from "./ModalController.js";

/**
 * Translates UI events into use-case calls.
 * Handles: render buttons, utility buttons, file drop (all files),
 * paste, keyboard shortcuts, modals, long-press.
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

    this.setupEventListeners();
    this.setupModals();
    this.setupPromptText();
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
   * - Initial state: no-op.
   * @param {'light'|'dark'} theme
   */
  async handleRender(theme) {
    if (this.orchestrator.isCodeViewActive()) {
      await this.orchestrator.sourceFileRenderer.reload(theme);
    } else if (!this.orchestrator.isPreRenderState()) {
      const content = this.preprocessInput(this.elements.editor.value);
      this.state.setTheme(theme);
      this.state.setMarkdownText(content);
      applyTheme(theme);
      await this.orchestrator.renderAll();
    }
  }

  /**
   * Full clear: destroy view, clear editor, restore system theme.
   */
  doClear() {
    this.scrollEngine.destroy();
    this.orchestrator.clear();
    this.elements.editor.value = "";
    applySystemTheme();
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
        // Markdown path
        let text;
        try {
          text = await file.text();
        } catch (_) {
          alert(CONFIG.fileDrop.messages.readError);
          return;
        }
        await this.orchestrator.loadMarkdown(text, systemTheme());
      } else {
        // Code view path (FR-01: all non-.md files including .txt)
        const fileHandle = handlePromise ? await handlePromise : null;
        await this.orchestrator.renderCodeView(file, fileHandle);
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
