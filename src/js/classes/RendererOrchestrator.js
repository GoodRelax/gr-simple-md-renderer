import { CONFIG } from "../config.js";
import { applyTheme, waitForDOMStability } from "../utils.js";
import MarkdownBlockModel from "./MarkdownBlockModel.js";
import MarkdownTable from "./MarkdownTable.js";
import BlockCaretMap from "./BlockCaretMap.js";

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
 * In-place editing (INV-47): a commit, insert, undo or redo updates the model
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
   * @param {LibraryLoader|null} [libraries] - the libraries that run on demand (INV-81); null: the renderers have them
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
    libraries = null,
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
    this._undoModels = []; // undo record: the models before each unit, oldest first (INV-48)
    this._redoModels = []; // redo record: the models an undo left, oldest first
    this._renderQueue = Promise.resolve();
    this._generation = 0; // bumped when the document is rebuilt or dropped
    this._pendingAnchor = null; // { scroll, blockId } of the latest request
    this._renderingAnchor = null; // the anchor of the partial render in progress
    this._nextBlockId = 1; // app-wide block id counter, never goes back
    this._modelChangedListener = null;
    this._heldBlockId = null; // block with an open editor: its wrapper is kept (Q-d1)
    this._lexer = (src) => this.markdownRenderer.lex(src);
    this.libraries = libraries;
    this._missingLibraries = new Set(); // what the screen shows without (drawn again when it runs)
    this._awaitedLibraries = new Set(); // asked for: drawn again when they arrive
  }

  // ---- Libraries that run on demand (INV-81, spec 5.17) ----

  /**
   * A library has run outside a render (the idle preload): the renderers
   * use it, and what was drawn without it is drawn again, in the queue.
   * @param {string} name
   * @param {object} library
   * @returns {Promise<void>}
   * @purity non-pure
   */
  libraryLoaded(name, library) {
    return this._enqueue(() => this._useLibrary(name, library, "loaded"));
  }

  /**
   * After a render step: a library it needed runs now when its data is in
   * the page, and the blocks are drawn again before the next frame (no
   * frame shows them without it); a library still on its way draws them
   * again when it arrives. step: "full" (the full render draws the
   * diagrams of the whole preview next) or "partial". Resolves true when
   * blocks were drawn again (a block passed to it may have left the page).
   * @param {"full"|"partial"} step
   * @returns {Promise<boolean>}
   * @purity non-pure
   */
  async _settleLibraries(step) {
    if (!this.libraries) return false;
    let redrawn = false;
    const names = new Set([...this.markdownRenderer.takeMissingLibraries(), ...this.mermaidRenderer.takeMissingLibraries()]);
    for (const name of names) {
      this._missingLibraries.add(name);
      let library;
      try {
        library = this.libraries.loadIfArrived(name);
      } catch {
        this._libraryFailed(name); // it never will: say so now (M3)
        continue;
      }
      if (library) redrawn = (await this._useLibrary(name, library, step)) || redrawn;
      else this._useWhenArrived(name);
    }
    return redrawn;
  }

  /**
   * Draw again when the library arrives (one wait per library at a time).
   * @param {string} name
   * @purity non-pure
   */
  _useWhenArrived(name) {
    if (this._awaitedLibraries.has(name)) return;
    this._awaitedLibraries.add(name);
    this.libraries.get(name).then(
      /** @purity non-pure */
      (library) => {
        this._awaitedLibraries.delete(name);
        this.libraryLoaded(name, library);
      },
      /** @purity non-pure */
      () => {
        this._awaitedLibraries.delete(name);
        this._libraryFailed(name);
      },
    );
  }

  /**
   * A library could not run (LibraryLoader logged why): what waits for it
   * says so where it can. mermaid's boxes say so; the math stays TeX and
   * the code plain.
   * @param {string} name
   * @purity non-pure
   */
  _libraryFailed(name) {
    this._missingLibraries.delete(name);
    if (name === "mermaid") this.mermaidRenderer.showLoadFailed();
  }

  /**
   * Give a library to the renderers; draw again what was drawn without it.
   * step: "full" or "partial" inside a render (which puts the view back by
   * itself), "loaded" outside one.
   * @param {string} name
   * @param {object} library
   * @param {"full"|"partial"|"loaded"} step
   * @returns {Promise<boolean>} true when blocks were replaced (the math)
   * @purity non-pure
   */
  async _useLibrary(name, library, step) {
    for (const renderer of [this.markdownRenderer, this.mermaidRenderer, this.plantumlRenderer, this.sourceFileRenderer]) {
      renderer.useLibrary?.(name, library);
    }
    if (!this._missingLibraries.delete(name)) return false;
    if (name === "hljs" && this._viewState === "code") {
      // the code view was shown plain after its wait (spec 5.17.3): colored now
      const metadata = this.sourceFileRenderer.recolor();
      if (metadata) this._modelChangedListener?.onCodeViewRecolored?.(metadata);
      return false;
    }
    if (!this._renderedModel) return false;
    if (name === "hljs") this.markdownRenderer.highlightPending();
    if (name === "mermaid") await this.mermaidRenderer.renderLoading(this.state.currentTheme);
    if (name !== "katex") return false;
    await this._redrawMath(step);
    return true;
  }

  /**
   * The blocks that show a formula as TeX are drawn again (KaTeX has run).
   * Their diagrams are drawn here unless the full render draws them next.
   * Outside a render (no one acted) their PlantUML gets the answer the full
   * render got (no new dialog), and the place being read stays where it is.
   * @param {"full"|"partial"|"loaded"} step
   * @purity non-pure
   */
  async _redrawMath(step) {
    const model = this._renderedModel;
    const place = step === "loaded" ? this.scrollManager.captureReadingAnchor() : null;
    const replaced = this.markdownRenderer.replaceBlocks(model, model, this._heldBlockId);
    if (replaced.length === 0 || step === "full") return;
    const theme = this.state.currentTheme;
    await this.mermaidRenderer.render(theme, replaced);
    await this._settleLibraries("partial");
    await this.plantumlRenderer.render(theme, replaced, step === "loaded" ? "repeat" : "placeholder");
    if (!place) return;
    await waitForDOMStability(this.preview);
    this.scrollManager.restoreReadingAnchor(place);
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
    return this._undoModels.length > 0;
  }

  /**
   * @returns {boolean} true when the last undo can be redone (INV-48)
   * @purity semi-pure-b
   */
  canRedo() {
    return this._redoModels.length > 0;
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
   * Returns CodeViewMeta for UIController to display in #fileInfo, or null
   * when another document was opened meanwhile (nothing was shown).
   * @param {File} file
   * @param {FileSystemFileHandle|null} fileHandle
   * @returns {Promise<CodeViewMeta|null>}
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
      this._codeViewIsCurrent(),
    );
    this._settleCodeView();
    return metadata;
  }

  /**
   * Whether the code view asked for now is still the one to show: another
   * file or a Markdown document opened while it read or waited (INV-81 (3),
   * M1) makes it stale.
   * @returns {Function} () => boolean
   * @purity semi-pure-b
   */
  _codeViewIsCurrent() {
    const generation = this._generation;
    return () => generation === this._generation && this._viewState === "code";
  }

  /**
   * The code view was shown plain (highlight.js did not come within its
   * wait): it is colored when highlight.js arrives.
   * @purity non-pure
   */
  _settleCodeView() {
    if (!this.libraries) return;
    for (const name of this.sourceFileRenderer.takeMissingLibraries?.() ?? []) {
      this._missingLibraries.add(name);
      this._useWhenArrived(name);
    }
  }

  /**
   * Drop the Markdown document: no model, no undo or redo record, and queued partial
   * renders and anchors are discarded. No full render is queued (INV-47).
   * @purity non-pure
   */
  clearDocument() {
    this._generation++;
    this._currentModel = null;
    this._renderedModel = null;
    this._forgetHistory();
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
   * Returns CodeViewMeta for UIController to update #fileInfo; null when
   * there is no file to reload, or another document was opened meanwhile.
   * @param {'light'|'dark'} theme
   * @returns {Promise<CodeViewMeta|null>}
   * @purity non-pure
   */
  async reloadCodeView(theme) {
    const metadata = await this.sourceFileRenderer.reload(theme, this._codeViewIsCurrent());
    this._settleCodeView();
    return metadata;
  }

  /**
   * Full render of state.markdownText (spec 5.14.4). The model is rebuilt
   * synchronously (new generation, empty undo and redo records); the drawing by block
   * (PlantUML with its consent dialog) runs in the render queue.
   * @returns {Promise<void>} settles when the render is done
   * @purity non-pure
   */
  renderAll() {
    this._generation++;
    this._pendingAnchor = null;
    this._forgetHistory();
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
   * @param {{offsetTop: number, line?: {offset: number, sourceOffset: number}}|null} [anchor] - the
   *   scroll anchor of the block, measured by the caller; left out, it is
   *   measured here (INV-46). line: the editor's caret line, kept instead (INV-84)
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
    this._recordUnit(model);
    return this._applyChange(change, scroll, change.anchorBlockId);
  }

  /**
   * Delete the blocks from firstId to lastId as one undoable change
   * (INV-74, INV-48). The block that comes into the place of the first one
   * gone keeps that place on screen (INV-46). Ids not in the current model
   * (a newer render or an undo removed them) change nothing.
   * @param {number} firstId
   * @param {number} lastId
   * @returns {Promise<void>} settles when the render is done
   * @purity non-pure
   */
  deleteBlocks(firstId, lastId) {
    const model = this._currentModel;
    if (!model) return Promise.resolve();
    markCommitStart();
    const change = model.removeRange(firstId, lastId, this._lexer, CONFIG.edit.diffMaxCells);
    if (!change.isChanged) {
      clearCommitMark();
      return Promise.resolve();
    }
    const scroll = this._capture(this.markdownRenderer.getBlockElement(firstId));
    this._recordUnit(model);
    return this._applyChange(change, scroll, change.anchorBlockId);
  }

  /**
   * Replace the whole body as one undoable change (search and replace,
   * INV-80): blocks whose text did not change keep their ids, so the render
   * is partial (INV-42); the block at offset keeps its place on screen
   * (INV-46).
   * @param {string} body
   * @param {number} offset - a body offset in the changed part
   * @returns {Promise<void>} settles when the render is done
   * @purity non-pure
   */
  replaceBody(body, offset) {
    const model = this._currentModel;
    if (!model) return Promise.resolve();
    markCommitStart();
    const change = model.withBody(body, this._lexer, CONFIG.edit.diffMaxCells);
    if (!change.isChanged) {
      clearCommitMark();
      return Promise.resolve();
    }
    const scroll = this._capture(this.markdownRenderer.getBlockElement(model.blockIdAt(offset)));
    this._recordUnit(model);
    return this._applyChange(change, scroll, change.model.blockIdAt(offset));
  }

  /**
   * The source of the blocks from firstId to lastId (INV-74), or null when
   * they are not in the current model.
   * @param {number} firstId
   * @param {number} lastId
   * @returns {string|null}
   * @purity semi-pure-b
   */
  readBlocksSource(firstId, lastId) {
    return this._currentModel ? this._currentModel.rangeSource(firstId, lastId) : null;
  }

  /**
   * The change a table block's new text would make (INV-42, INV-62), on
   * base (the current model by default; a table operation after a cell
   * commit plans on the cell commit's model). keptId: the table keeps its
   * id. Nothing is applied (11-c guard canKeepTableId); replaceTableBlock()
   * applies it unchanged. null without a model.
   * @purity semi-pure-b
   * @param {number} blockId
   * @param {string} newRaw
   * @param {MarkdownBlockModel} [base]
   * @returns {{model: MarkdownBlockModel, isChanged: boolean, anchorBlockId: number|null, keptId: boolean, base: MarkdownBlockModel}|null}
   */
  planTableReplace(blockId, newRaw, base = this._currentModel) {
    if (!base) return null;
    return { ...base.planTableReplace(blockId, newRaw, this._lexer, CONFIG.edit.diffMaxCells), base };
  }

  /**
   * Apply a planned table change (commitBlock for a table edited by cell or
   * by a table operation; INV-46 / 47 / 48): one undoable unit, synchronous.
   * A plan made on another model than the current one changes nothing.
   * While the table is held, the queued partial render keeps its DOM
   * (writeHeldInterior writes inside it). No scroll anchor is taken: only
   * the held table's inside changes, so nothing above it moves (INV-46),
   * and reading the layout of a big table here costs a layout of it
   * (INV-51). An anchor still pending from an earlier commit stays.
   * @purity non-pure
   * @param {number} blockId - the table block
   * @param {object|null} change - from planTableReplace()
   * @returns {Promise<void>} settles when the render is done
   */
  replaceTableBlock(blockId, change) {
    if (!change || !change.isChanged || change.base !== this._currentModel) return Promise.resolve();
    void blockId; // the table: its id is in the plan (anchorBlockId)
    markCommitStart();
    const pending = this._pendingAnchor;
    this._recordUnit(change.base);
    const rendered = this._applyChange(change, null, change.anchorBlockId);
    this._pendingAnchor = pending;
    return rendered;
  }

  /**
   * INV-47 exception: write inside the held block only (a cell's children,
   * or its table element after a table operation), outside the render
   * queue. write() must put in marked + DOMPurify output (and run the image
   * gate on it) or the nodes saved when a cell opened. The wrapper, the
   * order and the other blocks are not touched. Afterwards the block counts
   * as showing the current model. Not held (or not on screen): nothing.
   * @purity non-pure
   * @param {number} blockId
   * @param {() => void} write
   * @returns {boolean} true when written
   */
  writeHeldInterior(blockId, write) {
    if (this._heldBlockId !== blockId || !this.markdownRenderer.getBlockElement(blockId)) return false;
    write();
    const model = this._currentModel;
    const index = model ? model.findIndexById(blockId) : -1;
    if (index >= 0) this.markdownRenderer.markWrittenInPlace(model.getBlocks()[index], model.links);
    return true;
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
    return this.insertBlock(raw, { afterBlockId: blockId }).rendering;
  }

  /**
   * Insert a block as one undoable change of its own (INV-48, INV-52):
   * after a block (afterBlockId; null or unknown: at the end; that block
   * keeps its place on screen), or at a body offset (a line boundary; inside
   * a block it cuts the block in two). With an offset, scroll is the anchor
   * the caller measured and the block at anchorOffset in the new model keeps
   * that place (INV-46); without scroll, no anchor is taken. removeBefore:
   * characters right before the offset that go in the same change.
   * @param {string} raw
   * @param {{afterBlockId: number|null}|{offset: number, scroll?: object|null, anchorOffset?: number, removeBefore?: number}} at
   * @returns {{rendering: Promise<void>, blockId: number|null, lastBlockId: number|null}} blockId: the new
   *   block (the first one when raw has more blocks); lastBlockId: its last block
   * @purity non-pure
   */
  insertBlock(raw, at) {
    const model = this._currentModel;
    if (!model) return { rendering: Promise.resolve(), blockId: null, lastBlockId: null };
    const maxCells = CONFIG.edit.diffMaxCells;
    let change;
    let scroll;
    let anchorBlockId;
    if ("afterBlockId" in at) {
      const known = at.afterBlockId !== null && model.findIndexById(at.afterBlockId) >= 0;
      scroll = known ? this._capture(this.markdownRenderer.getBlockElement(at.afterBlockId)) : null;
      change = model.insertAfter(known ? at.afterBlockId : null, raw, this._lexer, maxCells);
      anchorBlockId = known ? at.afterBlockId : change.anchorBlockId;
    } else {
      scroll = at.scroll ?? null;
      change = model.insertAt(at.offset, raw, this._lexer, maxCells, { anchorOffset: at.anchorOffset, removeBefore: at.removeBefore ?? 0 });
      anchorBlockId = change.anchorBlockId;
    }
    this._recordUnit(model);
    const rendering = this._applyChange(change, scroll, anchorBlockId);
    return { rendering, blockId: change.insertedBlockId, lastBlockId: change.lastInsertedBlockId };
  }

  /**
   * Undo the last change (INV-48, spec 5.14.9): the model before it comes
   * back, and the current one goes on the redo record. New ids keep growing.
   * @returns {Promise<void>}
   * @purity non-pure
   */
  undoLastCommit() {
    const current = this._currentModel;
    if (!current || this._undoModels.length === 0) return Promise.resolve();
    const previous = this._undoModels.pop();
    this._redoModels.push(current.withoutJoinedBody());
    return this._restoreModel(previous);
  }

  /**
   * Redo the last undone change (INV-48): the model the last undo left comes
   * back, and the current one goes on the undo record. New ids keep growing
   * (R4).
   * @returns {Promise<void>}
   * @purity non-pure
   */
  redoLastCommit() {
    const current = this._currentModel;
    if (!current || this._redoModels.length === 0) return Promise.resolve();
    const next = this._redoModels.pop();
    this._undoModels.push(current.withoutJoinedBody());
    return this._restoreModel(next);
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

  /**
   * Run change (edit mode on or off) and keep what the reader is looking at
   * where it was: edit mode shows the hidden bands and the empty block (the
   * tables' tabs take no room), and a browser without scroll anchoring would
   * let the text move (5.1, PRT-X08). Only in the markdown view. The anchor
   * of a render still to come (a block committed as edit mode is left) was
   * measured in the layout before the change: it follows its place, or that
   * render would move the text back (INV-46).
   * @param {() => void} change
   * @purity non-pure
   */
  keepReadingPosition(change) {
    if (this._viewState !== "markdown") {
      change();
      return;
    }
    const memento = this.scrollManager;
    const saved = memento.captureReadingAnchor();
    const anchors = [...new Set([this._pendingAnchor, this._renderingAnchor])].filter((a) => a && a.scroll);
    const places = anchors.map((a) => memento.capturePlaceAt(a.scroll.offsetTop));
    change();
    memento.restoreReadingAnchor(saved);
    for (let i = 0; i < anchors.length; i++) {
      const moved = memento.movedBy(places[i]);
      if (moved !== 0) anchors[i].scroll = { ...anchors[i].scroll, offsetTop: anchors[i].scroll.offsetTop + moved };
    }
  }

  // ---- internals ----

  /**
   * A new change of the model (INV-48): the model before it goes on the undo
   * record (the oldest beyond CONFIG.edit.undoMaxSteps goes), and the redo
   * record is emptied. A record keeps no joined body text (1 MB each for a
   * 1 MB document); it shares the blocks with the models around it.
   * @purity non-pure
   * @param {MarkdownBlockModel} before
   */
  _recordUnit(before) {
    this._undoModels.push(before.withoutJoinedBody());
    const extra = this._undoModels.length - CONFIG.edit.undoMaxSteps;
    if (extra > 0) this._undoModels.splice(0, extra);
    this._redoModels = [];
  }

  /**
   * @purity non-pure
   */
  _forgetHistory() {
    this._undoModels = [];
    this._redoModels = [];
  }

  /**
   * Make a recorded model current again (Undo or Redo), numbered from the
   * current counter so no id comes back (INV-48), with the partial render of
   * INV-42. The anchor is the first block that comes back; when only blocks
   * go, the block that now takes the place of the first one gone (INV-46).
   * @purity non-pure
   * @param {MarkdownBlockModel} recorded
   * @returns {Promise<void>}
   */
  _restoreModel(recorded) {
    const current = this._currentModel;
    const restored = recorded.withNextBlockId(this._nextBlockId);
    const restoredBlocks = restored.getBlocks();
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
    const change = { model: restored, isChanged: true, anchorBlockId };
    return this._applyChange(change, scroll, anchorBlockId, true);
  }

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
   * force: render even when the model is the one last rendered (an undo
   * right after a cell commit brings back that very model, while the cell
   * was written in place, INV-47).
   * @purity non-pure
   */
  _applyChange(change, scroll, anchorBlockId, force = false) {
    const previous = this._currentModel;
    this._currentModel = change.model;
    this._nextBlockId = Math.max(this._nextBlockId, change.model.getNextBlockId());
    this.state.setMarkdownText(change.model.toBody());
    this._pendingAnchor = scroll && anchorBlockId !== null ? { scroll, blockId: anchorBlockId } : null;
    if (this._modelChangedListener) this._modelChangedListener.onModelChanged(change);
    this._noticeWholeDocument(previous, change.model);
    const generation = this._generation;
    return this._enqueue(() => this._renderPartial(generation, force));
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
    // INV-78: when the user moves the view while the diagrams are drawn (a
    // wheel, a scroll key, the Index), the view goes back to where they
    // were reading last; otherwise to scrollTop, as before
    const userMoves = this.scrollManager.watchUserMoves();
    try {
      this.markdownRenderer.renderBlocks(model);
      this._renderedModel = model;
      await this._settleLibraries("full");
      await this.mermaidRenderer.render(this.state.currentTheme);
      await this._settleLibraries("full");
      await this.plantumlRenderer.render(this.state.currentTheme, this.preview, "consent");
      await waitForDOMStability(this.preview);
      const place = userMoves.place();
      if (place) this.scrollManager.restoreReadingAnchor(place);
      else this.scrollManager.restore(scrollTop);
    } finally {
      userMoves.stop();
    }
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
    const redrawn = await this._settleLibraries("partial");
    // Nothing above the anchor block moved when it is the only block that
    // changed and the number of blocks is the same: its top is where it was,
    // so the correction can wait for the one after DOM stability (a
    // correction here forces a layout of the whole preview). A caret line
    // (INV-84) moves inside the block: corrected now.
    const line = Boolean(this._renderingAnchor?.scroll?.line);
    if (line || !this._onlyAnchorChanged(before, target, replaced)) this._restoreAnchor(this._renderingAnchor, generation);
    try {
      // a block drawn again with its math (settled above) left the page
      const shown = redrawn ? replaced.filter((el) => el.isConnected) : replaced;
      if (shown.length > 0) {
        const theme = this.state.currentTheme;
        await this.mermaidRenderer.render(theme, shown);
        await this._settleLibraries("partial");
        await this.plantumlRenderer.render(theme, shown, "placeholder");
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
    const element = this.markdownRenderer.getBlockElement(anchor.blockId);
    this.scrollManager.restoreAnchor(this._lineAnchor(anchor, element), element);
  }

  /**
   * The anchor's scroll, with the caret line of a commit (INV-84) turned
   * into the block's top: the line is found in the rendered block from the
   * block's source as the editor shows it.
   * @purity semi-pure-b
   * @param {{scroll: object, blockId: number}} anchor
   * @param {Element|null} element
   * @returns {{offsetTop: number}|null}
   */
  _lineAnchor(anchor, element) {
    if (!anchor.scroll?.line) return anchor.scroll;
    const model = this._renderedModel;
    const index = model ? model.findIndexById(anchor.blockId) : -1;
    if (index < 0) return { offsetTop: anchor.scroll.offsetTop };
    const block = model.getBlocks()[index];
    return BlockCaretMap.lineAnchor(anchor.scroll, element, MarkdownBlockModel.toEditableText(block.raw), block.type);
  }
}
