import { CONFIG, FILE_SYSTEM_HANDLE_SUPPORTED } from "../config.js";
import { applyTheme, waitForDOMStability, showToast } from "../utils.js";
import MarkdownBlockModel from "./MarkdownBlockModel.js";

/**
 * Coordinates the full rendering pipeline.
 * Owns: all renderer instances, view state, scroll manager, and the block
 * model of the Markdown document (spec 5.14.3).
 * Does NOT manipulate DOM classList or UI chrome (delegated to UIController).
 *
 * In-place editing (INV-47): a commit, insert or undo updates the model
 * synchronously inside the caller's event handler and tells the
 * ModelChangedPort; only the DOM work goes into one serial render queue.
 * Each render goes from the last rendered model to the model current at
 * that time. A new document (or none) starts a new generation: renders and
 * anchors queued for an older generation are dropped.
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
   * @purity non-pure
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
    // Block editing state (INV-47, INV-48)
    this._currentModel = null;
    this._renderedModel = null;
    this._previousModel = null; // undo record (1 entry)
    this._renderQueue = Promise.resolve();
    this._generation = 0; // bumped when the document is rebuilt or dropped
    this._pendingAnchor = null; // { scroll, blockId } of the latest request
    this._nextBlockId = 1; // app-wide block id counter, never goes back
    this._modelChangedListener = null;
    this._lexer = (src) => this.markdownRenderer.lex(src);
  }

  // ---- State queries (CQS: pure queries, no side effects) ----

  /**
   * @returns {boolean}
   * @purity semi-pure-b
   */
  isPreRenderState() {
    return this._viewState === "initial";
  }

  /**
   * @returns {boolean}
   * @purity semi-pure-b
   */
  isCodeViewActive() {
    return this._viewState === "code";
  }

  /**
   * @returns {MarkdownBlockModel|null} the current model (an immutable value)
   * @purity semi-pure-b
   */
  getModel() {
    return this._currentModel;
  }

  /**
   * @returns {string} the current body ("" without a document)
   * @purity semi-pure-b
   */
  getBody() {
    return this._currentModel ? this._currentModel.toBody() : "";
  }

  /**
   * @returns {boolean} true when the last change can be undone (INV-48)
   * @purity semi-pure-b
   */
  canUndo() {
    return this._previousModel !== null;
  }

  // ---- Commands ----

  /**
   * @param {{onModelChanged: Function}|null} listener - ModelChangedPort
   * @purity non-pure
   */
  setModelChangedListener(listener) {
    this._modelChangedListener = listener;
  }

  /**
   * Load and render a markdown text string.
   * @param {string} text - raw markdown text
   * @param {string} theme - 'light' | 'dark'
   * @param {FileSystemFileHandle|null} [fileHandle] - for reload support
   * @purity non-pure
   */
  async loadMarkdown(text, theme, fileHandle = undefined) {
    if (fileHandle !== undefined) {
      this._mdFileHandle = fileHandle;
      // A dropped file is a new document: ask again before contacting the
      // image hosts it names. Reload and theme switches keep the consent.
      this.markdownRenderer.resetExternalImageConsent();
    }
    this._viewState = "markdown";
    this.state.setMarkdownText(text);
    this.state.setTheme(theme);
    applyTheme(theme);
    await this.renderAll();
  }

  /**
   * Start an empty document in the markdown view (INV-31).
   * @returns {Promise<void>} settles when the full render is done
   * @purity non-pure
   */
  startEmptyDocument() {
    this._viewState = "markdown";
    this.state.setMarkdownText("");
    return this.renderAll();
  }

  /**
   * Load a non-.md file into code view.
   * Forces dark theme on first load (FR-06).
   * Returns CodeViewMeta for UIController to display in #fileInfo.
   * @param {File} file
   * @param {FileSystemFileHandle|null} fileHandle
   * @returns {Promise<CodeViewMeta>}
   * @purity non-pure
   */
  async renderCodeView(file, fileHandle) {
    this.clearDocument();
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
   * Drop the Markdown document: no model, no undo record, and queued partial
   * renders and anchors are discarded. No full render is queued (INV-47).
   * @purity non-pure
   */
  clearDocument() {
    this._generation++;
    this._currentModel = null;
    this._renderedModel = null;
    this._previousModel = null;
    this._pendingAnchor = null;
    this.state.setMarkdownText("");
  }

  /**
   * Destroy code/markdown view and return to initial state.
   * Caller is responsible for clearing the editor textarea,
   * restoring the system theme, and calling setViewMode('initial').
   * @purity non-pure
   */
  clear() {
    this.clearDocument();
    this._viewState = "initial";
    this._mdFileHandle = null;
    this.markdownRenderer.resetExternalImageConsent();
    this.sourceFileRenderer.destroy();
  }

  /**
   * Facade: re-render markdown with a new theme (Sect 5.8).
   * Called by UIController.handleRender() for markdown view.
   * @param {'light'|'dark'} theme
   * @purity non-pure
   */
  async reRender(theme) {
    this.state.setTheme(theme);
    applyTheme(theme);
    await this.renderAll();
  }

  /**
   * Facade: reload the current code view with a new theme (Sect 5.8).
   * Returns CodeViewMeta for UIController to update #fileInfo.
   * @param {'light'|'dark'} theme
   * @returns {Promise<CodeViewMeta|null>}
   * @purity non-pure
   */
  async reloadCodeView(theme) {
    return await this.sourceFileRenderer.reload(theme);
  }

  /**
   * Read the .md file from stored fileHandle.
   * Returns raw text string, or null if unavailable (with toast).
   * Caller (UIController) is responsible for preprocessInput and loadMarkdown.
   * @returns {Promise<string|null>}
   * @purity non-pure
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
   * Full render of state.markdownText (spec 5.14.4). The model is rebuilt
   * synchronously (new generation, empty undo record); the drawing by block
   * (PlantUML with its consent dialog) runs in the render queue.
   * @returns {Promise<void>} settles when the render is done
   * @purity non-pure
   */
  renderAll() {
    this._generation++;
    this._pendingAnchor = null;
    this._previousModel = null;
    this._currentModel = this._newModel(this.state.markdownText);
    return this._enqueue(() => this._renderFull());
  }

  /**
   * Commit the text of one block (spec 5.14.3). An unknown id or an unchanged
   * text changes nothing (INV-48, AT-ORC-18).
   * @param {number} blockId
   * @param {string} newRaw - editor text
   * @returns {Promise<void>} settles when the render is done
   * @purity non-pure
   */
  commitBlock(blockId, newRaw) {
    const model = this._currentModel;
    if (!model || model.findIndexById(blockId) < 0) return Promise.resolve();
    const scroll = this._capture(this.markdownRenderer.getBlockElement(blockId));
    const change = model.replaceBlock(blockId, newRaw, this._lexer, CONFIG.edit.diffMaxCells);
    if (!change.isChanged) return Promise.resolve();
    this._previousModel = model;
    return this._applyChange(change, scroll, change.anchorBlockId);
  }

  /**
   * Insert a block after blockId (or at the end), as one undoable change (INV-52).
   * The block it was inserted after keeps its place on screen.
   * @param {number|null} blockId
   * @param {string} raw
   * @returns {Promise<void>}
   * @purity non-pure
   */
  insertAfter(blockId, raw) {
    const model = this._currentModel;
    if (!model) return Promise.resolve();
    const known = blockId !== null && model.findIndexById(blockId) >= 0;
    const scroll = known ? this._capture(this.markdownRenderer.getBlockElement(blockId)) : null;
    const change = model.insertAfter(known ? blockId : null, raw, this._lexer, CONFIG.edit.diffMaxCells);
    this._previousModel = model;
    return this._applyChange(change, scroll, known ? blockId : change.anchorBlockId);
  }

  /**
   * Undo the last change (INV-48, spec 5.14.9). New ids keep growing.
   * @returns {Promise<void>}
   * @purity non-pure
   */
  undoLastCommit() {
    const current = this._currentModel;
    const previous = this._previousModel;
    if (!current || !previous) return Promise.resolve();
    const restored = previous.withNextBlockId(this._nextBlockId);
    const restoredBlocks = restored.getBlocks();
    // The first restored block; when the undo only removes blocks, the block
    // that now takes the place of the first removed one.
    let index = restoredBlocks.findIndex((b) => current.findIndexById(b.id) < 0);
    if (index < 0) {
      const removed = current.getBlocks().findIndex((b) => restored.findIndexById(b.id) < 0);
      index = Math.min(Math.max(removed, 0), restoredBlocks.length - 1);
    }
    const anchorBlockId = restoredBlocks.length === 0 ? null : restoredBlocks[index].id;
    let element = null;
    if (anchorBlockId !== null) {
      element = this.markdownRenderer.getBlockElement(anchorBlockId);
      if (!element) {
        const same = current.getBlocks()[index];
        element = same ? this.markdownRenderer.getBlockElement(same.id) : null;
      }
    }
    const scroll = this._capture(element);
    this._previousModel = null;
    const change = { model: restored, isChanged: true, anchorBlockId };
    return this._applyChange(change, scroll, anchorBlockId);
  }

  // ---- internals ----

  /**
   * A new model numbered from the app-wide counter, which then moves on.
   * @purity non-pure
   */
  _newModel(body) {
    const model = MarkdownBlockModel.fromBody(body, this._lexer, this._nextBlockId);
    this._nextBlockId = model.getNextBlockId();
    return model;
  }

  /**
   * @purity non-pure
   */
  _capture(element) {
    return element ? this.scrollManager.captureAnchor(element) : null;
  }

  /**
   * Make the change current (synchronously), notify, and queue a partial render.
   * @purity non-pure
   */
  _applyChange(change, scroll, anchorBlockId) {
    this._currentModel = change.model;
    this._nextBlockId = Math.max(this._nextBlockId, change.model.getNextBlockId());
    this.state.setMarkdownText(change.model.toBody());
    this._pendingAnchor = scroll && anchorBlockId !== null ? { scroll, blockId: anchorBlockId } : null;
    if (this._modelChangedListener) this._modelChangedListener.onModelChanged(change);
    const generation = this._generation;
    return this._enqueue(() => this._renderPartial(generation));
  }

  /**
   * Run task after the previous render; a failure is logged and the queue
   * goes on (Q11).
   * @purity non-pure
   */
  _enqueue(task) {
    /** @purity non-pure */
    const run = this._renderQueue.then(task).catch((error) => {
      console.error("Rendering orchestration error:", error);
    });
    this._renderQueue = run;
    return run;
  }

  /**
   * Full render by block, PlantUML with consent (spec 5.14.4, INV-02).
   * @purity non-pure
   */
  async _renderFull() {
    const model = this._currentModel;
    if (!model) return;
    const scrollTop = this.scrollManager.save();
    this.markdownRenderer.renderBlocks(model);
    this._renderedModel = model;
    await this.mermaidRenderer.render(this.state.currentTheme);
    await this.plantumlRenderer.render(this.state.currentTheme, this.preview, "consent");
    await waitForDOMStability(this.preview);
    this.scrollManager.restore(scrollTop);
  }

  /**
   * Partial render from the last rendered model to the current one (spec
   * 5.14.3 steps 6-8). PlantUML is never sent here: placeholder mode (INV-23).
   * @purity non-pure
   */
  async _renderPartial(generation) {
    if (generation !== this._generation) return;
    const target = this._currentModel;
    if (!target || !this._renderedModel || target === this._renderedModel) return;
    const anchor = this._pendingAnchor;
    this._pendingAnchor = null;
    const replaced = this.markdownRenderer.replaceBlocks(this._renderedModel, target);
    this._renderedModel = target;
    this._restoreAnchor(anchor, generation);
    if (replaced.length > 0) {
      const theme = this.state.currentTheme;
      await this.mermaidRenderer.render(theme, replaced);
      await this.plantumlRenderer.render(theme, replaced, "placeholder");
    }
    await waitForDOMStability(this.preview);
    this._restoreAnchor(anchor, generation);
  }

  /**
   * Restore the anchor only while the same document is shown (INV-47).
   * @purity non-pure
   */
  _restoreAnchor(anchor, generation) {
    if (!anchor || generation !== this._generation) return;
    this.scrollManager.restoreAnchor(anchor.scroll, this.markdownRenderer.getBlockElement(anchor.blockId));
  }
}
