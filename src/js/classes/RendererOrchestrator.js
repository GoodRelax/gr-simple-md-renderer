import { CONFIG } from "../config.js";
import { applyTheme, waitForDOMStability } from "../utils.js";

/**
 * Coordinates the full rendering pipeline.
 * Owns: all renderer instances, view state, scroll manager.
 */
export default class RendererOrchestrator {
  /**
   * @param {ApplicationState} state
   * @param {MarkdownRenderer} markdownRenderer
   * @param {MermaidRenderer} mermaidRenderer
   * @param {PlantUMLRenderer} plantumlRenderer
   * @param {ScrollManager} scrollManager
   * @param {HTMLElement} preview
   * @param {SourceFileRenderer} sourceFileRenderer
   */
  constructor(
    state,
    markdownRenderer,
    mermaidRenderer,
    plantumlRenderer,
    scrollManager,
    preview,
    sourceFileRenderer,
  ) {
    this.state = state;
    this.markdownRenderer = markdownRenderer;
    this.mermaidRenderer = mermaidRenderer;
    this.plantumlRenderer = plantumlRenderer;
    this.scrollManager = scrollManager;
    this.preview = preview;
    this.sourceFileRenderer = sourceFileRenderer;
    this._viewState = "initial"; // 'initial' | 'markdown' | 'code'
  }

  // ---- State queries (CQS: pure queries, no side effects) ----

  /** @returns {boolean} */
  isPreRenderState() {
    return this._viewState === "initial";
  }

  /** @returns {boolean} */
  isCodeViewActive() {
    return this._viewState === "code";
  }

  // ---- Commands ----

  /**
   * Load and render a markdown text string.
   * @param {string} text - raw markdown text
   * @param {string} theme - 'light' | 'dark'
   */
  async loadMarkdown(text, theme) {
    this._viewState = "markdown";
    this.preview.classList.remove("code-view");
    this._hideAffordance();
    this.state.setMarkdownText(text);
    this.state.setTheme(theme);
    applyTheme(theme);
    await this.renderAll();
  }

  /**
   * Load a non-.md file into code view.
   * Forces dark theme on first load (FR-06).
   * @param {File} file
   * @param {FileSystemFileHandle|null} fileHandle
   */
  async renderCodeView(file, fileHandle) {
    this._viewState = "code";
    this.preview.classList.add("code-view");
    this._hideAffordance();
    applyTheme("dark");
    this.state.setTheme("dark");
    await this.sourceFileRenderer.render(
      file,
      fileHandle,
      CONFIG.codeView.defaultTheme,
    );
  }

  /**
   * Destroy code/markdown view and return to initial state.
   * Caller is responsible for clearing the editor textarea and
   * restoring the system theme.
   */
  clear() {
    this._viewState = "initial";
    this.preview.classList.remove("code-view");
    this.sourceFileRenderer.destroy();
    this._showAffordance();
  }

  /**
   * Full markdown rendering pipeline: Markdown -> Mermaid -> PlantUML.
   * Uses state.markdownText and state.currentTheme.
   */
  async renderAll() {
    try {
      const scrollTop = this.scrollManager.save();

      await this.markdownRenderer.render(this.state.markdownText);
      await this.mermaidRenderer.render(this.state.currentTheme);
      await this.plantumlRenderer.render(this.state.currentTheme);

      await waitForDOMStability(this.preview);
      this.scrollManager.restore(scrollTop);
    } catch (error) {
      console.error("Rendering orchestration error:", error);
    }
  }

  // ---- Private helpers ----

  _hideAffordance() {
    const el = this.preview.querySelector("#affordanceText");
    if (el) el.style.display = "none";
  }

  _showAffordance() {
    // After destroy(), innerHTML is empty so affordanceText is gone.
    // Recreate it from scratch.
    let el = this.preview.querySelector("#affordanceText");
    if (!el) {
      el = document.createElement("div");
      el.id = "affordanceText";
      this.preview.appendChild(el);
    }
    el.textContent =
      "Get started:\n\n" +
      "  1. Paste Markdown (Ctrl+V)  ->  Markdown Preview\n" +
      "  2. Drop a .md file          ->  Markdown Preview\n" +
      "  3. Drop any text file       ->  Code View  (.py  .js  .json  .c  ...)";
    el.style.display = "block";
  }
}
