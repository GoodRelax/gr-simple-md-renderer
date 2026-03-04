import { CONFIG, FILE_SYSTEM_HANDLE_SUPPORTED } from "../config.js";
import { applyTheme, waitForDOMStability, showToast } from "../utils.js";

/**
 * Coordinates the full rendering pipeline.
 * Owns: all renderer instances, view state, scroll manager.
 * Does NOT manipulate DOM classList or UI chrome (delegated to UIController).
 */
export default class RendererOrchestrator {
  /**
   * @param {ApplicationState} state
   * @param {MarkdownRenderer} markdownRenderer
   * @param {MermaidRenderer} mermaidRenderer
   * @param {PlantUMLRenderer} plantumlRenderer
   * @param {ScrollMemento} scrollManager
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
    this._mdFileHandle = null;
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
   * @param {FileSystemFileHandle|null} [fileHandle] - for reload support
   */
  async loadMarkdown(text, theme, fileHandle = undefined) {
    if (fileHandle !== undefined) this._mdFileHandle = fileHandle;
    this._viewState = "markdown";
    this.state.setMarkdownText(text);
    this.state.setTheme(theme);
    applyTheme(theme);
    await this.renderAll();
  }

  /**
   * Load a non-.md file into code view.
   * Forces dark theme on first load (FR-06).
   * Returns CodeViewMeta for UIController to display in #fileInfo.
   * @param {File} file
   * @param {FileSystemFileHandle|null} fileHandle
   * @returns {Promise<CodeViewMeta>}
   */
  async renderCodeView(file, fileHandle) {
    this._viewState = "code";
    applyTheme(CONFIG.codeView.defaultTheme);
    this.state.setTheme(CONFIG.codeView.defaultTheme);
    const metadata = await this.sourceFileRenderer.render(
      file,
      fileHandle,
      CONFIG.codeView.defaultTheme,
    );
    return metadata;
  }

  /**
   * Destroy code/markdown view and return to initial state.
   * Caller is responsible for clearing the editor textarea,
   * restoring the system theme, and calling setViewMode('initial').
   */
  clear() {
    this._viewState = "initial";
    this._mdFileHandle = null;
    this.sourceFileRenderer.destroy();
  }

  /**
   * Facade: re-render markdown with a new theme (Sect 5.8).
   * Called by UIController.handleRender() for markdown view.
   * @param {'light'|'dark'} theme
   */
  async reRender(theme) {
    this.state.setTheme(theme);
    this.state.setMarkdownText(
      this.state.markdownText // already stored; no-op re-set for explicitness
    );
    applyTheme(theme);
    await this.renderAll();
  }

  /**
   * Facade: reload the current code view with a new theme (Sect 5.8).
   * Returns CodeViewMeta for UIController to update #fileInfo.
   * @param {'light'|'dark'} theme
   * @returns {Promise<CodeViewMeta|null>}
   */
  async reloadCodeView(theme) {
    return await this.sourceFileRenderer.reload(theme);
  }

  /**
   * Read the .md file from stored fileHandle.
   * Returns raw text string, or null if unavailable (with toast).
   * Caller (UIController) is responsible for preprocessInput and loadMarkdown.
   * @returns {Promise<string|null>}
   */
  async readMarkdownFile() {
    if (!this._mdFileHandle) {
      const msg = FILE_SYSTEM_HANDLE_SUPPORTED
        ? CONFIG.codeView.reloadNoFileMsg
        : CONFIG.codeView.reloadUnavailableMsg;
      showToast(msg, CONFIG.codeView.toastDurationMs);
      return null;
    }
    const file = await this._mdFileHandle.getFile();
    return await file.text();
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
}
