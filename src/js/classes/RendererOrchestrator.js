import { CONFIG } from "../config.js";
import { applyTheme, waitForDOMStability } from "../utils.js";
import MarkdownBlockModel from "./MarkdownBlockModel.js";
import MarkdownTable from "./MarkdownTable.js";

// Performance marker for PRT-U25 (spec 5.14.3): from the start of a commit to
// the DOM swap of its partial render. Only the last measure is kept; nothing
// leaves the page.
const COMMIT_MARK = "grsmd-commit-start";
const COMMIT_MEASURE = "grsmd-commit";

/**
 * @purity semi-pure-b
 * @returns {boolean} the User Timing API is there
 */
function canMeasure() {
  return typeof performance !== "undefined" && typeof performance.mark === "function" && typeof performance.measure === "function";
}

/**
 * Start (or restart) the commit mark; at most one mark exists.
 * @purity non-pure
 */
function markCommitStart() {
  if (!canMeasure()) return;
  performance.clearMarks(COMMIT_MARK);
  performance.mark(COMMIT_MARK);
}

/**
 * @purity non-pure
 */
function clearCommitMark() {
  if (canMeasure()) performance.clearMarks(COMMIT_MARK);
}

/**
 * Replace the last commit measure, if a commit mark is waiting.
 * @purity non-pure
 */
function measureCommit() {
  if (!canMeasure() || performance.getEntriesByName(COMMIT_MARK, "mark").length === 0) return;
  performance.clearMeasures(COMMIT_MEASURE);
  performance.measure(COMMIT_MEASURE, COMMIT_MARK);
  performance.clearMarks(COMMIT_MARK);
}

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
    // Block editing state (INV-47, INV-48)
    this._currentModel = null;
    this._renderedModel = null;
    this._previousModel = null; // undo record (1 entry)
    this._renderQueue = Promise.resolve();
    this._generation = 0; // bumped when the document is rebuilt or dropped
    this._pendingAnchor = null; // { scroll, blockId } of the latest request
    this._renderingAnchor = null; // the anchor of the partial render in progress
    this._nextBlockId = 1; // app-wide block id counter, never goes back
    this._modelChangedListener = null;
    this._heldBlockId = null; // block with an open editor: its wrapper is kept (Q-d1)
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
   * @param {{onModelChanged: Function, onBlockSplitFailed: Function}|null} listener - ModelChangedPort
   * @purity non-pure
   */
  setModelChangedListener(listener) {
    this._modelChangedListener = listener;
  }

  /**
   * Load and render a markdown text string.
   * @param {string} text - markdown body
   * @param {string} theme - 'light' | 'dark'
   * @purity non-pure
   */
  async loadMarkdown(text, theme) {
    this._viewState = "markdown";
    this.state.setMarkdownText(text);
    this.state.setTheme(theme);
    applyTheme(theme);
    await this.renderAll();
  }

  /**
   * A new document from another source: ask again before contacting the
   * image hosts it names (INV-43). Reload and theme switches keep the consent.
   * @purity non-pure
   */
  resetExternalImageConsent() {
    this.markdownRenderer.resetExternalImageConsent();
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
    const previous = this._currentModel;
    this._currentModel = this._newModel(this.state.markdownText);
    this._noticeWholeDocument(previous, this._currentModel);
    const generation = this._generation;
    return this._enqueue(() => this._renderFull(generation));
  }

  /**
   * Commit the text of one block (spec 5.14.3). An unknown id or an unchanged
   * text changes nothing (INV-48, AT-ORC-18).
   * @param {number} blockId
   * @param {string} newRaw - editor text
   * @returns {Promise<void>} settles when the render is done
   * @purity non-pure
   */
  commitBlock(blockId, newRaw, anchor = undefined) {
    const model = this._currentModel;
    if (!model || model.findIndexById(blockId) < 0) return Promise.resolve();
    markCommitStart();
    const scroll = anchor !== undefined ? anchor : this._capture(this.markdownRenderer.getBlockElement(blockId));
    const change = model.replaceBlock(blockId, newRaw, this._lexer, CONFIG.edit.diffMaxCells);
    if (!change.isChanged) {
      clearCommitMark();
      return Promise.resolve();
    }
    this._previousModel = model;
    return this._applyChange(change, scroll, change.anchorBlockId);
  }

  /**
   * The lexers the block editor's text edits use (INV-67, INV-71): blocks
   * only (as the model), inline tokens with the document's reference
   * definitions, blocks and inline tokens, and marked.walkTokens.
   * @purity semi-pure-b
   * @returns {{lexBlocks: Function, lexInline: Function, lexFull: Function, walkTokens: Function}}
   */
  textLexers() {
    const renderer = this.markdownRenderer;
    return {
      lexBlocks: this._lexer,
      lexInline: (src) => renderer.lexInline(src, this._currentModel?.links),
      lexFull: (src) => renderer.lexFull(src),
      walkTokens: (tokens, fn) => renderer.walkTokens(tokens, fn),
    };
  }

  /**
   * The edited text of a table block with its tables aligned (INV-61). The
   * text is lexed alone, with the same lexer as the model.
   * @purity semi-pure-b
   * @param {string} text
   * @returns {string}
   */
  formatTableText(text) {
    return MarkdownTable.formatTablesIn(text, this._lexer);
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

  /**
   * The block with an open editor keeps its wrapper in partial renders even
   * when its HTML changed (Q-d1); it is redrawn when released.
   * @param {number} blockId
   * @purity non-pure
   */
  holdBlock(blockId) {
    this._heldBlockId = blockId;
  }

  /**
   * The editor closed: redraw the held block if a render skipped it.
   * @purity non-pure
   */
  releaseBlock() {
    const id = this._heldBlockId;
    this._heldBlockId = null;
    if (id === null || !this.markdownRenderer.isStale(id)) return;
    const generation = this._generation;
    this._enqueue(() => this._renderPartial(generation, true));
  }

  /**
   * The block just opened becomes the anchor of the partial render of the
   * commit before it, queued or already running (with a mouse the commit
   * happens at pointerdown, and its render can be waiting for the DOM when
   * pointerup opens the block): the opened block keeps its place on screen
   * (INV-46). Without such an anchor nothing changes.
   * @param {number} blockId
   * @purity non-pure
   */
  retargetPendingAnchor(blockId) {
    if (!this._pendingAnchor && !this._renderingAnchor) return;
    const element = this.markdownRenderer.getBlockElement(blockId);
    if (!element) return;
    const anchor = { scroll: this.scrollManager.captureAnchor(element), blockId };
    if (this._pendingAnchor) this._pendingAnchor = anchor;
    if (this._renderingAnchor) this._renderingAnchor = anchor;
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
    const previous = this._currentModel;
    this._currentModel = change.model;
    this._nextBlockId = Math.max(this._nextBlockId, change.model.getNextBlockId());
    this.state.setMarkdownText(change.model.toBody());
    this._pendingAnchor = scroll && anchorBlockId !== null ? { scroll, blockId: anchorBlockId } : null;
    if (this._modelChangedListener) this._modelChangedListener.onModelChanged(change);
    this._noticeWholeDocument(previous, change.model);
    const generation = this._generation;
    return this._enqueue(() => this._renderPartial(generation));
  }

  /**
   * A body that could not be split into blocks is kept whole and never
   * rewritten (INV-41); this is logged and told to the user once, when the
   * model becomes whole.
   * @purity non-pure
   * @param {MarkdownBlockModel|null} previous
   * @param {MarkdownBlockModel} model
   */
  _noticeWholeDocument(previous, model) {
    if (!model.isWholeDocument || previous?.isWholeDocument) return;
    console.error("Markdown block split failed: the document is edited as one block.");
    if (this._modelChangedListener) this._modelChangedListener.onBlockSplitFailed();
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
   * A full render queued for an older generation is skipped: the newer one
   * draws the same model, and PlantUML asks once.
   * @purity non-pure
   * @param {number} generation
   */
  async _renderFull(generation) {
    if (generation !== this._generation) return;
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
   * force: run even when the model did not change (a held block was released).
   * @purity non-pure
   */
  async _renderPartial(generation, force = false) {
    if (generation !== this._generation) return;
    const target = this._currentModel;
    if (!target || !this._renderedModel || (target === this._renderedModel && !force)) return;
    this._renderingAnchor = this._pendingAnchor;
    this._pendingAnchor = null;
    const before = this._renderedModel;
    const replaced = this.markdownRenderer.replaceBlocks(before, target, this._heldBlockId);
    measureCommit();
    this._renderedModel = target;
    // Nothing above the anchor block moved when it is the only block that
    // changed and the number of blocks is the same: its top is where it was,
    // so the correction can wait for the one after DOM stability (a
    // correction here forces a layout of the whole preview).
    if (!this._onlyAnchorChanged(before, target, replaced)) this._restoreAnchor(this._renderingAnchor, generation);
    try {
      if (replaced.length > 0) {
        const theme = this.state.currentTheme;
        await this.mermaidRenderer.render(theme, replaced);
        await this.plantumlRenderer.render(theme, replaced, "placeholder");
      }
      await waitForDOMStability(this.preview);
      // Read again: an editor opened meanwhile may have retargeted it.
      this._restoreAnchor(this._renderingAnchor, generation);
    } finally {
      this._renderingAnchor = null;
    }
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean}
   */
  _onlyAnchorChanged(before, target, replaced) {
    const anchor = this._renderingAnchor;
    if (!anchor || replaced.length !== 1) return false;
    if (before.getBlocks().length !== target.getBlocks().length) return false;
    return replaced[0] === this.markdownRenderer.getBlockElement(anchor.blockId);
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
