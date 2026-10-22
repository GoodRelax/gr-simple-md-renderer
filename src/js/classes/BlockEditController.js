import { CONFIG } from "../config.js";
import MarkdownBlockModel from "./MarkdownBlockModel.js";
import MarkdownTextOps from "./MarkdownTextOps.js";
import InvisibleCharOverlay from "./InvisibleCharOverlay.js";
import TableCellEditor from "./TableCellEditor.js";
import ClipboardLink from "./ClipboardLink.js";
import { cell, row, choice, selectCell } from "../stateTable.js";

const BROWSING = "browsingPreview";
const IDLE = "editModeIdle";
const EDITING = "editingBlock";
const CELL = "editingCell";

// The INV-64 moves: to the cell, or (the id not kept) out of the table session.
const MOVE_EVENTS = { nextCellRequested: "next", previousCellRequested: "previous", cellBelowRequested: "below" };
// Taps whose block keeps its place on screen when an editor above it closes
// first (INV-46), and the actions that open that block or its table.
const PLACED_KINDS = new Set(["block", "cell", "tableSource"]);
const OPENING_ACTIONS = new Set(["openBlockEditor", "startTableSession", "openTableSourceWithToast"]);
// Actions that open or close a cell: the host refreshes the palette after them.
const CELL_ACTIONS = new Set(["openCell", "commitCell", "revertCell", "discardCell", "endTableSession"]);

// Targets a tap never opens (INV-29). The list is kept as written in the
// spec: user HTML may contain the same classes and roles, and they stay
// excluded (ruling T2). Editor and palette are recognized by reference.
const OPEN_EXCLUDED_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "summary",
  "[role=button]",
  ".external-image-placeholder",
  ".plantuml-pending",
  ".diagram-copy-btn",
].join(", ");

// Block types whose Enter inserts a line break mark (INV-71).
const HARD_BREAK_TYPES = new Set(["paragraph", "list", "blockquote"]);

// A double click here keeps its own meaning (zoom reset of a diagram, INV-57).
const DIAGRAM_SELECTOR = [".mermaid", ".plantuml-wrapper", ".plantuml-diagram", ".plantuml-pending"].join(", ");

const STATES = [BROWSING, IDLE, EDITING, CELL];
const transitions = (...cells) => row(STATES, cells);

/**
 * The two cells of an INV-64 move in editingCell (11-c).
 * @purity pure
 * @param {string} guard - hasNextCell, hasPreviousCell or hasCellBelow
 * @returns {ReadonlyArray<object>}
 */
function moveCells(guard) {
  return choice(
    cell(CELL, ["commitCell", "moveToCell", "openCell"], `${guard}&&canKeepTableId`),
    cell(IDLE, ["commitCell", "endTableSession", "showTableEditEndedToast"], guard),
  );
}

/**
 * Spec 11-c: event -> current state -> cell (or guarded alternatives, tried
 * in order; "a&&b" is both guards). "enqueueFullRender" is done by the
 * caller (UIController) after dispatch returns; "showToast" is part of
 * host.renderFromEditor() (INV-45).
 */
export const blockEditStateMachine = Object.freeze({
  paletteShown: transitions(cell(IDLE, []), null, null, null),
  paletteHidden: transitions(
    null,
    cell(BROWSING, []),
    cell(BROWSING, ["commitBlock"]),
    cell(BROWSING, ["commitCell", "endTableSession"]),
  ),
  emptyDocumentStarted: transitions(
    cell(EDITING, ["startEmptyDocument", "showPalette", "openBlockEditor"]),
    cell(EDITING, ["startEmptyDocument", "openBlockEditor"]),
    null,
    null,
  ),
  blockTapped: transitions(null, cell(EDITING, ["openBlockEditor"]), null, null),
  blockTappedWithUnrenderedEditor: transitions(null, cell(IDLE, ["renderFromEditor", "showToast"]), null, null),
  otherBlockTapped: transitions(
    null,
    null,
    cell(EDITING, ["commitBlock", "resolveBlockById", "openBlockEditor"]),
    cell(EDITING, ["commitCell", "endTableSession", "resolveBlockById", "openBlockEditor"]),
  ),
  cellTapped: transitions(
    null,
    choice(
      cell(CELL, ["startTableSession", "openCell"], "isCellEditableTable"),
      cell(EDITING, ["openTableSourceWithToast"]),
    ),
    choice(
      cell(CELL, ["commitBlock", "resolveBlockById", "startTableSession", "openCell"], "isCellEditableTable"),
      cell(EDITING, ["commitBlock", "resolveBlockById", "openTableSourceWithToast"]),
    ),
    choice(
      cell(CELL, ["commitCell", "openCell"], "isInSessionTable&&canKeepTableId"),
      cell(IDLE, ["commitCell", "endTableSession", "showTableEditEndedToast"], "isInSessionTable"),
      cell(CELL, ["commitCell", "endTableSession", "resolveBlockById", "startTableSession", "openCell"], "isCellEditableTable"),
      cell(EDITING, ["commitCell", "endTableSession", "resolveBlockById", "openTableSourceWithToast"]),
    ),
  ),
  cellTappedWithUnrenderedEditor: transitions(null, cell(IDLE, ["renderFromEditor", "showToast"]), null, null),
  tableSourceTapped: transitions(
    null,
    cell(EDITING, ["openBlockEditor"]),
    cell(EDITING, ["commitBlock", "resolveBlockById", "openBlockEditor"]),
    cell(EDITING, ["commitCell", "endTableSession", "resolveBlockById", "openBlockEditor"]),
  ),
  tableSourceTappedWithUnrenderedEditor: transitions(null, cell(IDLE, ["renderFromEditor", "showToast"]), null, null),
  nextCellRequested: transitions(null, null, null, moveCells("hasNextCell")),
  previousCellRequested: transitions(null, null, null, moveCells("hasPreviousCell")),
  cellBelowRequested: transitions(
    null,
    null,
    null,
    choice(...moveCells("hasCellBelow"), cell(IDLE, ["commitCell", "endTableSession"])),
  ),
  tableOperationRequested: transitions(
    null,
    null,
    null,
    choice(
      cell(CELL, ["commitCell", "applyTableOperation", "openCell"], "canApplyTableOperation&&canKeepTableId"),
      cell(IDLE, ["commitCell", "applyTableOperation", "endTableSession", "showTableEditEndedToast"], "canApplyTableOperation"),
    ),
  ),
  pointerPressedOutside: transitions(null, null, cell(IDLE, ["commitBlock"]), cell(IDLE, ["commitCell", "endTableSession"])),
  escapePressed: transitions(
    null,
    cell(BROWSING, ["hidePalette"]),
    cell(IDLE, ["restoreOriginalRaw"], "isImeIdle"),
    cell(IDLE, ["revertCell", "endTableSession"], "isImeIdle"),
  ),
  undoRequested: transitions(
    null,
    cell(IDLE, ["undoLastUnit"]),
    choice(cell(IDLE, ["restoreOriginalRaw"], "hasUncommittedChange"), cell(IDLE, ["commitBlock", "undoLastUnit"])),
    choice(
      cell(IDLE, ["revertCell", "endTableSession"], "hasUncommittedChange"),
      cell(IDLE, ["commitCell", "endTableSession", "undoLastUnit"]),
    ),
  ),
  saveRequested: transitions(null, null, cell(IDLE, ["commitBlock"]), cell(IDLE, ["commitCell", "endTableSession"])),
  saveAsRequested: transitions(null, null, cell(IDLE, ["commitBlock"]), cell(IDLE, ["commitCell", "endTableSession"])),
  documentReplaced: transitions(null, null, cell(IDLE, ["discardBlockEditor"]), cell(IDLE, ["discardCell", "endTableSession"])),
  documentCleared: transitions(
    null,
    cell(BROWSING, ["hidePalette"]),
    cell(BROWSING, ["discardBlockEditor", "hidePalette"]),
    cell(BROWSING, ["discardCell", "endTableSession", "hidePalette"]),
  ),
  viewSwitchedToCode: transitions(
    null,
    cell(BROWSING, ["hidePalette"]),
    cell(BROWSING, ["discardBlockEditor", "hidePalette"]),
    cell(BROWSING, ["discardCell", "endTableSession", "hidePalette"]),
  ),
  fullRenderRequested: transitions(
    cell(BROWSING, ["enqueueFullRender"]),
    cell(IDLE, ["enqueueFullRender"]),
    cell(IDLE, ["commitBlock", "enqueueFullRender"]),
    cell(IDLE, ["commitCell", "endTableSession", "enqueueFullRender"]),
  ),
  editorFocused: transitions(null, null, cell(IDLE, ["commitBlock"]), cell(IDLE, ["commitCell", "endTableSession"])),
  previewDoubleClicked: transitions(
    choice(
      cell(IDLE, ["clearSelection", "showPalette", "renderFromEditor", "showToast"], "hasUnrenderedEditor"),
      cell(CELL, ["clearSelection", "showPalette", "startTableSession", "openCell"], "isCellTarget&&isCellEditableTable"),
      cell(EDITING, ["clearSelection", "showPalette", "openBlockEditor"], "isEmptyDocument"),
      cell(EDITING, ["clearSelection", "showPalette", "openBlockEditor"], "isBlockTarget"),
      cell(IDLE, ["clearSelection", "showPalette"]),
    ),
    null,
    null,
    null,
  ),
});

/**
 * In-place block editing (spec 5.14.6, 11-c): the start gesture, the
 * "outside" commit, and the block editor's keys. The editor element never
 * leaves this class; text and selection go through getSelectionRange() and
 * applyTextEdit() (LoD).
 *
 * host (BlockEditHost, implemented by UIController):
 *   showPalette(), hidePalette(), isPaletteNode(node) (palette and popovers,
 *   by reference), isEditorChangedSinceRender(),
 *   renderFromEditor() (full render from #editor and the toast, INV-45),
 *   onEditorInput() (refresh the unsaved mark), onEditStateChanged() (an
 *   editor or a cell opened or closed: unsaved mark and palette buttons),
 *   showToast(message) (the table toasts of 11-c).
 * Table cells (editingCell, INV-62 to INV-65) are edited by a
 * TableCellEditor that this class owns and drives through 11-c.
 */
export default class BlockEditController {
  /**
   * @param {HTMLElement} preview
   * @param {RendererOrchestrator} orchestrator - model and commits
   * @param {MarkdownRenderer} blockLocator - block wrappers by reference
   * @param {ScrollMemento} scrollMemento - anchor on open (INV-46)
   * @param {object} host - BlockEditHost
   * @param {(textarea: HTMLTextAreaElement, options: object) => InvisibleCharOverlay} [createOverlay] - INV-70
   * @purity non-pure
   */
  constructor(
    preview,
    orchestrator,
    blockLocator,
    scrollMemento,
    host,
    createOverlay = (textarea, options) => new InvisibleCharOverlay(textarea, options),
  ) {
    this.preview = preview;
    this.orchestrator = orchestrator;
    this.blockLocator = blockLocator;
    this.scrollMemento = scrollMemento;
    this.host = host;
    this.createOverlay = createOverlay;
    this._blockEditState = BROWSING;
    this._editor = null; // { textarea, wrapper, blockId, blockType, original, savedNodes, overlay }
    this._lexers = null; // the orchestrator's text lexers, block lexing cached per text
    this._press = null; // the pointerdown being followed
    this._composing = false;
    this._lastOpenedBlockId = null;
    this.editGeneration = 0; // INV-69: the editor opened, closed or changed
    this._onPointerDown = (e) => this._handlePointerDown(e);
    this._onPointerUp = (e) => this._handlePointerUp(e);
    this._onPointerCancel = () => this._forgetPress();
    this._onKeyDown = (e) => this._handleKeyDown(e);
    this._onInput = () => this._handleInput();
    this._onPaste = (e) => this._handlePaste(e);
    this._onCompositionStart = () => this._setComposing(true);
    this._onCompositionEnd = () => this._setComposing(false);
    this._cells = new TableCellEditor(
      orchestrator,
      blockLocator,
      { dispatch: (event) => this.dispatch(event), onCellInput: () => this.host.onEditorInput() },
      { isApple: Boolean(host.isApple) },
    );
  }

  /**
   * Two taps close enough in time and place (INV-31, CONFIG.edit).
   * @purity semi-pure-a
   * @param {{time: number, x: number, y: number}|null} first
   * @param {{time: number, x: number, y: number}|null} second
   * @param {object} [limits] - CONFIG.edit
   * @returns {boolean}
   */
  static isDoubleTap(first, second, limits = CONFIG.edit) {
    if (!first || !second) return false;
    const interval = second.time - first.time;
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    return interval >= 0 && interval <= limits.doubleTapMaxIntervalMs && distance <= limits.doubleTapMaxDistancePx;
  }

  // ---- state machine (11-c) ----

  /**
   * Handle one 11-c event. A "-" cell changes nothing. Returns a Promise
   * only for emptyDocumentStarted (the editor opens after the render).
   * @purity non-pure
   * @param {string} event
   * @param {{kind: string, id?: number}|null} [target] - the tapped block
   * @returns {Promise<void>|undefined}
   */
  dispatch(event, target = null) {
    const cells = blockEditStateMachine[event];
    if (!cells) throw new Error(`Unknown block edit event: ${event}`);
    /** @purity non-pure */
    const isTrue = (guard) => guard.split("&&").every((g) => this._isGuardTrue(g, target));
    const next = selectCell(cells[this._blockEditState], isTrue);
    if (!next) return undefined;
    return this._run(next, target, event);
  }

  /**
   * What a double click opens (INV-57), for previewDoubleClicked: null on
   * the scroll bar, inside the INV-29 exclusions and the diagrams (nothing
   * happens); {kind: "empty"} when the document has no block;
   * {kind: "block", id}; {kind: "cell", id, row, col, caret}; or
   * {kind: "none"} (a margin, also a table's: edit mode only).
   * @purity semi-pure-b
   * @param {MouseEvent|PointerEvent} e - the dblclick, or the pointerup of a double tap
   * @returns {{kind: string, id?: number}|null}
   */
  doubleClickTarget(e) {
    const node = e.target;
    if (!(node instanceof Element) || !this.preview.contains(node)) return null;
    if (this._isScrollbarPress(e)) return null;
    if (node.closest(OPEN_EXCLUDED_SELECTOR) || node.closest(DIAGRAM_SELECTOR)) return null;
    const model = this.orchestrator.getModel();
    if (model && model.getBlocks().length === 0) return { kind: "empty" };
    const target = this._targetAt(node);
    if (target?.kind === "cell") return { ...target, caret: this._caretOf(target, e) };
    return target && target.kind !== "tableSource" && target.kind !== "tableMargin" ? target : { kind: "none" };
  }

  /**
   * The node is the open block editor's textarea (INV-59 (b), by reference).
   * @purity semi-pure-b
   * @param {Node|null} node
   * @returns {boolean}
   */
  isEditorElement(node) {
    return this._editor !== null && node === this._editor.textarea;
  }

  /**
   * The node is in the open cell (INV-59 (c), by reference).
   * @purity semi-pure-b
   * @param {Node|null} node
   * @returns {boolean}
   */
  isCellElement(node) {
    return this._cells.containsNode(node);
  }

  /**
   * A block editor or a cell is open.
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isEditing() {
    // The editor itself, so a commit's onModelChanged (inside the transition)
    // already sees the editor closed (a cell closes before its commit too).
    return this._editor !== null || this._cells.isOpen();
  }

  /**
   * A cell is open (editingCell).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isEditingCell() {
    return this._cells.isOpen();
  }

  /**
   * Where the open cell is (5.15.5: row and column buttons, alignment), or null.
   * @purity semi-pure-b
   * @returns {{row: number, col: number, columns: number, alignment: string, kind: string}|null}
   */
  cellState() {
    return this._cells.cellState();
  }

  /**
   * The open block is a table (Insert row / column, 5.15.5).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isEditingTable() {
    return this._editor !== null && this._editor.blockType === "table";
  }

  /**
   * The last block an editor was opened on (INV-52: insert after it), or null.
   * @purity semi-pure-b
   * @returns {number|null}
   */
  getLastOpenedBlockId() {
    return this._lastOpenedBlockId;
  }

  /**
   * The open editor differs from the raw it was opened with (INV-21 b).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  hasUncommittedChange() {
    if (this._cells.isOpen()) return this._cells.hasUncommittedChange();
    return this._editor !== null && this._editor.textarea.value !== this._editor.original;
  }

  /**
   * @purity semi-pure-b
   * @returns {{text: string, selStart: number, selEnd: number}|null}
   */
  getSelectionRange() {
    if (!this._editor) return null;
    const { textarea } = this._editor;
    return { text: textarea.value, selStart: textarea.selectionStart, selEnd: textarea.selectionEnd };
  }

  /**
   * The selection is in one inline range of the open editor (5.15.5: Bold /
   * Italic / colors; INV-67 (6)).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  canFormatSelection() {
    if (this._cells.isOpen()) return this._cells.canFormatSelection();
    const range = this.getSelectionRange();
    if (!range || range.selStart === range.selEnd) return false;
    return MarkdownTextOps.canFormatRange(range.text, range.selStart, range.selEnd, this._textLexers().lexBlocks);
  }

  /**
   * Bold / Italic / text color on the editor's selection (INV-66, INV-67):
   * an editor change (not a commit), one undoable step of the editor.
   * @purity non-pure
   * @param {{kind: "strong"|"em"|"color", value?: string|null}} op
   * @returns {boolean} true when the text changed
   */
  formatSelection(op) {
    if (this._cells.isOpen()) return this._cells.applyFormat(op);
    const range = this.getSelectionRange();
    if (!range) return false;
    const edit = MarkdownTextOps.formatRange(range.text, range.selStart, range.selEnd, op, this._formatContext());
    if (!edit) return false;
    this.applyTextEdit(edit);
    return true;
  }

  /**
   * What the palette's Paste link acts on (INV-69, the wait for the
   * clipboard): the open editor (its block id) or cell (TableCellEditor),
   * the selection and the edit generation; null when none is open. The
   * button compares it by value when the clipboard has been read.
   * @purity semi-pure-b
   * @returns {object|null}
   */
  linkTarget() {
    if (this._cells.isOpen()) return this._cells.linkTarget();
    if (!this._editor) return null;
    const { textarea, blockId } = this._editor;
    return { kind: "block", blockId, generation: this.editGeneration, start: textarea.selectionStart, end: textarea.selectionEnd };
  }

  /**
   * 5.15.5 Paste link: editing, with a selection in one inline range
   * (INV-67 (6)), or a caret where a link can go in (owner ruling F-R1).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  canPasteLink() {
    if (this._cells.isOpen()) return this._cells.canPasteLink();
    const range = this.getSelectionRange();
    if (!range) return false;
    if (range.selStart !== range.selEnd) return this.canFormatSelection();
    return MarkdownTextOps.canInsertLink(range.text, range.selStart, this._formatContext());
  }

  /**
   * 5.15.5 Remove link: the caret or the selection is on a link.
   * @purity semi-pure-b
   * @returns {boolean}
   */
  canRemoveLink() {
    if (this._cells.isOpen()) return this._cells.canRemoveLink();
    const range = this.getSelectionRange();
    if (!range) return false;
    return MarkdownTextOps.canRemoveLink(range.text, range.selStart, range.selEnd, this._formatContext());
  }

  /**
   * The palette's Paste link with the clipboard's URL (INV-69): the
   * selection becomes a link to url; with no selection a link goes in at
   * the caret, its text label (the clipboard's link text) or else url, and
   * that text is selected. An editor change (not a commit).
   * @purity non-pure
   * @param {string} url
   * @param {string|null} label
   * @returns {boolean} true when the text changed
   */
  pasteLink(url, label) {
    if (this._cells.isOpen()) return this._cells.pasteLink(url, label);
    const range = this.getSelectionRange();
    if (!range) return false;
    const op = ClipboardLink.linkOp(url);
    const context = this._formatContext();
    const edit =
      range.selStart === range.selEnd
        ? // the clipboard's link text, or the URL when that text cannot go in as written
          (MarkdownTextOps.insertLink(range.text, range.selStart, label || op.url, op.link, context) ??
          (label && label !== op.url ? MarkdownTextOps.insertLink(range.text, range.selStart, op.url, op.link, context) : null))
        : MarkdownTextOps.formatRange(range.text, range.selStart, range.selEnd, op, context);
    if (!edit) return false;
    this.applyTextEdit(edit);
    return true;
  }

  /**
   * The palette's Remove link (INV-69): the link at the caret, or every
   * link the selection touches, comes off. An editor change (not a commit).
   * @purity non-pure
   * @returns {boolean} true when the text changed
   */
  removeLink() {
    if (this._cells.isOpen()) return this._cells.removeLink();
    const range = this.getSelectionRange();
    if (!range) return false;
    const edit = MarkdownTextOps.removeLink(range.text, range.selStart, range.selEnd, this._formatContext());
    if (!edit) return false;
    this.applyTextEdit(edit);
    return true;
  }

  /**
   * Put text and selection into the editor; focus stays, nothing is committed.
   * The change goes in as one undoable step of the editor (INV-52, OS-18).
   * @purity non-pure
   * @param {{text: string, selStart: number, selEnd: number}} edit
   */
  applyTextEdit(edit) {
    if (!this._editor) return;
    this._replaceText(edit);
    this._fitHeight();
  }

  // ---- internals: guards and actions ----

  /**
   * The lexers and palette colors of formatRange and the link operations.
   * @purity non-pure
   */
  _formatContext() {
    const { lexBlocks, lexInline } = this._textLexers();
    return { lexBlocks, lexInline, colors: Object.values(CONFIG.edit.textColors).map((c) => c.light) };
  }

  /**
   * The orchestrator's lexers; the block lexing of the last text is kept
   * (the button states ask once per frame, INV-51).
   * @purity non-pure
   */
  _textLexers() {
    if (this._lexers) return this._lexers;
    const lexers = this.orchestrator.textLexers();
    // the last two texts: the editor's, and a rewrite of it checked in the
    // same frame (a link on an empty line, INV-69) does not push it out.
    // The inline lexing the same way: the button states of one frame lex
    // the inline range once (INV-51). The tokens are only read.
    /** @purity non-pure */
    const cached = (lex) => {
      let cache = [];
      /** @purity non-pure */
      return (src) => {
        const hit = cache.find((c) => c.src === src);
        if (hit) return hit.tokens;
        const tokens = lex(src);
        cache = [{ src, tokens }, ...cache].slice(0, 2);
        return tokens;
      };
    };
    this._lexers = { ...lexers, lexBlocks: cached(lexers.lexBlocks), lexInline: cached(lexers.lexInline) };
    return this._lexers;
  }

  /**
   * The 11-c guards.
   * @purity semi-pure-b
   */
  _isGuardTrue(guard, target) {
    switch (guard) {
      case "isImeIdle":
        return !this._composing && !this._cells.isComposing();
      case "hasUncommittedChange":
        return this.hasUncommittedChange();
      case "hasUnrenderedEditor":
        return this.host.isEditorChangedSinceRender();
      case "isEmptyDocument":
        return target?.kind === "empty";
      case "isBlockTarget":
        return target?.kind === "block";
      case "isCellTarget":
        return target?.kind === "cell";
      case "isCellEditableTable":
        return target?.kind === "cell" && this._cells.isCellEditableTable(target.id);
      case "isInSessionTable":
        return target?.kind === "cell" && target.id === this._cells.sessionBlockId();
      case "canKeepTableId":
        return this._cells.planFor(target?.op ?? null);
      case "hasNextCell":
        return this._cells.neighbour("next") !== null;
      case "hasPreviousCell":
        return this._cells.neighbour("previous") !== null;
      case "hasCellBelow":
        return this._cells.neighbour("below") !== null;
      case "canApplyTableOperation":
        return Boolean(target?.op) && this._cells.canApplyOperation(target.op);
      default:
        throw new Error(`Unknown block edit guard: ${guard}`);
    }
  }

  /**
   * @purity non-pure
   */
  _run(next, target, event) {
    let resolved = target;
    // The cell an INV-64 move opens, taken before the open cell closes.
    const move = MOVE_EVENTS[event] ? this._cellTarget(this._cells.neighbour(MOVE_EVENTS[event])) : null;
    let rendering = null;
    // INV-46: where the tapped block was before an open editor above it
    // closed and changed the layout (PRT-U07).
    const tapped = this._tappedPlace(next, target);
    for (const action of next.actions) {
      switch (action) {
        case "commitBlock":
          this._commitBlock();
          break;
        case "discardBlockEditor":
        case "restoreOriginalRaw":
          this._closeEditor();
          break;
        case "showPalette":
          this.host.showPalette();
          break;
        case "hidePalette":
          this.host.hidePalette();
          break;
        case "startEmptyDocument":
          rendering = this.orchestrator.startEmptyDocument();
          resolved = { kind: "empty" };
          break;
        case "resolveBlockById":
          resolved = this._resolve(resolved);
          break;
        case "openBlockEditor":
          if (!rendering) this._openBlockEditor(resolved, tapped);
          break;
        case "renderFromEditor":
          this.host.renderFromEditor();
          break;
        case "clearSelection":
          // The word a double click selected (INV-57).
          window.getSelection()?.removeAllRanges();
          break;
        case "undoLastUnit":
          // INV-48 (2); #editor changes are rendered first instead (INV-45).
          if (this.host.isEditorChangedSinceRender()) this.host.renderFromEditor();
          else this.orchestrator.undoLastCommit();
          break;
        case "startTableSession":
          // the tapped table is gone (the commit before changed it): nothing opens
          if (!resolved) break;
          this._cells.startSession(resolved.id);
          this._lastOpenedBlockId = resolved.id;
          this._keepTappedPlace(tapped, resolved.id);
          break;
        case "endTableSession":
          this._cells.endSession();
          break;
        case "openCell":
          if (resolved?.kind === "cell" && this._cells.sessionBlockId() === resolved.id) {
            this._cells.openCell(resolved.row, resolved.col, resolved.caret ?? null);
          }
          break;
        case "commitCell":
          this._cells.commitCell();
          break;
        case "revertCell":
          this._cells.revertCell();
          break;
        case "discardCell":
          this._cells.discardCell();
          break;
        case "moveToCell":
          resolved = move;
          break;
        case "applyTableOperation":
          resolved = this._cellTarget(this._cells.applyTableOperation(target.op));
          break;
        case "openTableSourceWithToast":
          // the toast only when the source did open (the table may be gone)
          this._openBlockEditor(resolved, tapped);
          if (this._editor) this.host.showToast(CONFIG.messages.edit.tableNotCellEditable);
          break;
        case "showTableEditEndedToast":
          this.host.showToast(CONFIG.messages.edit.tableEditEnded);
          break;
        default:
          // showToast: inside renderFromEditor; enqueueFullRender: by the caller
          break;
      }
    }
    // A cell opened or closed: told before the state moves on (11-c contract).
    if (next.actions.some((a) => CELL_ACTIONS.has(a))) this.host.onEditStateChanged();
    if (!rendering) {
      this._settle(next.to);
      return undefined;
    }
    // The empty block exists only after the full render.
    this._settle(IDLE);
    return rendering.then(() => this._openEmptyAfterRender());
  }

  /**
   * @purity non-pure
   */
  _openEmptyAfterRender() {
    if (this._blockEditState !== IDLE || this._editor) return;
    this._openBlockEditor({ kind: "empty" });
    this._settle(EDITING);
  }

  /**
   * The next state; an editing cell whose editor could not open stays idle.
   * Entering or leaving edit mode adds or removes the document listeners.
   * @purity non-pure
   */
  _settle(to) {
    if (to === CELL && !this._cells.isOpen() && this._cells.sessionBlockId() !== null) {
      this._cells.endSession(); // the cell did not open (11-c note)
      this.host.onEditStateChanged();
    }
    const next = (to === EDITING && !this._editor) || (to === CELL && !this._cells.isOpen()) ? IDLE : to;
    const wasBrowsing = this._blockEditState === BROWSING;
    this._blockEditState = next;
    if (wasBrowsing && next !== BROWSING) {
      document.addEventListener("pointerdown", this._onPointerDown, true);
      document.addEventListener("pointerup", this._onPointerUp, true);
      document.addEventListener("pointercancel", this._onPointerCancel, true);
    } else if (!wasBrowsing && next === BROWSING) {
      document.removeEventListener("pointerdown", this._onPointerDown, true);
      document.removeEventListener("pointerup", this._onPointerUp, true);
      document.removeEventListener("pointercancel", this._onPointerCancel, true);
      this._press = null;
    }
  }

  /**
   * The tapped block's element and its place on screen before anything of
   * the tap changed the layout: taken at pointerdown (a mouse press outside
   * commits there, INV-30), or else before the actions of the cell run. null
   * when the cell opens no block.
   * @purity semi-pure-b
   * @returns {{wrapper: Element, anchor: object}|null}
   */
  _tappedPlace(next, target) {
    if (!target || !PLACED_KINDS.has(target.kind)) return null;
    if (!next.actions.some((a) => OPENING_ACTIONS.has(a))) return null;
    return target.place ?? this._placeOf(target.id);
  }

  /**
   * INV-46 for a table session started by a tap: the table goes back to
   * where it was when it was pressed (an open editor above it closed), and
   * the commit's queued render keeps it there.
   * @purity non-pure
   * @param {{wrapper: Element, anchor: object}|null} tapped
   * @param {number} blockId - the table block
   */
  _keepTappedPlace(tapped, blockId) {
    const wrapper = this.blockLocator.getBlockElement(blockId);
    if (!tapped || tapped.wrapper !== wrapper) return;
    this.scrollMemento.restoreAnchor(tapped.anchor, wrapper);
    this.orchestrator.retargetPendingAnchor(blockId);
  }

  /**
   * A block's element and where its top is on screen now.
   * @purity semi-pure-b
   * @returns {{wrapper: Element, anchor: object}|null}
   */
  _placeOf(blockId) {
    const wrapper = this.blockLocator.getBlockElement(blockId);
    return wrapper ? { wrapper, anchor: this.scrollMemento.captureAnchor(wrapper) } : null;
  }

  /**
   * The tapped block, if it is still in the current model (INV-30).
   * @purity semi-pure-b
   */
  _resolve(target) {
    if (!target || target.id === undefined) return target;
    const model = this.orchestrator.getModel();
    return model && model.findIndexById(target.id) >= 0 ? target : null;
  }

  /**
   * Where a press on a cell was, and the top of that cell then: the cell can
   * move before it opens (the palette's edit-mode layout, a commit above
   * or in the same table), and the caret point follows it (INV-57, INV-62).
   * @purity semi-pure-b
   * @param {{id: number, row: number, col: number}} target
   * @param {MouseEvent|PointerEvent} e
   * @returns {{x: number, y: number, top: number|null}}
   */
  _caretOf(target, e) {
    const cell = this.blockLocator.getTableElement(target.id)?.rows[target.row]?.cells[target.col];
    return { x: e.clientX, y: e.clientY, top: cell ? cell.getBoundingClientRect().top : null };
  }

  /**
   * A cell of the session's table as a target, or null.
   * @purity semi-pure-b
   * @param {{row: number, col: number}|null} at
   */
  _cellTarget(at) {
    const id = this._cells.sessionBlockId();
    return at && id !== null ? { kind: "cell", id, row: at.row, col: at.col } : null;
  }

  /**
   * Put the editor in place of the block's rendered content (INV-46 anchor).
   * tapped: the place the block had before this cell closed another editor;
   * the block goes back there, and a queued render keeps it there.
   * @purity non-pure
   * @param {{kind: string, id?: number}|null} target
   * @param {{wrapper: Element, anchor: object}|null} [tapped]
   */
  _openBlockEditor(target, tapped = null) {
    if (!target || this._editor) return;
    let wrapper;
    let raw = "";
    let blockId = null;
    let blockType = null;
    if (target.kind === "empty") {
      wrapper = this.blockLocator.getEmptyBlockElement();
    } else {
      // a block, a table's tab, or a table opened as its source
      const model = this.orchestrator.getModel();
      const index = model ? model.findIndexById(target.id) : -1;
      if (index < 0) return;
      const block = model.getBlocks()[index];
      wrapper = this.blockLocator.getBlockElement(block.id);
      raw = MarkdownBlockModel.toEditableText(block.raw);
      blockId = block.id;
      blockType = block.type;
    }
    if (!wrapper) return;

    const anchor = tapped && tapped.wrapper === wrapper ? tapped.anchor : this.scrollMemento.captureAnchor(wrapper);
    const textarea = document.createElement("textarea");
    textarea.className = "md-block-editor";
    textarea.spellcheck = false;
    textarea.rows = 1;
    textarea.value = raw;
    textarea.style.overflowY = "hidden"; // INV-40: the height follows the content
    const savedNodes = [...wrapper.childNodes];
    wrapper.replaceChildren(textarea);
    wrapper.classList.add("md-block-editing");
    this._editor = { textarea, wrapper, blockId, blockType, original: raw, savedNodes, overlay: null };
    this._composing = false;
    this.editGeneration++;
    if (blockId !== null) {
      this.orchestrator.holdBlock(blockId); // Q-d1
      this._lastOpenedBlockId = blockId;
    }

    textarea.addEventListener("keydown", this._onKeyDown);
    textarea.addEventListener("input", this._onInput);
    textarea.addEventListener("paste", this._onPaste);
    textarea.addEventListener("compositionstart", this._onCompositionStart);
    textarea.addEventListener("compositionend", this._onCompositionEnd);
    this._fitHeight();
    this._attachOverlay(textarea, blockType);
    textarea.focus({ preventScroll: true });
    this.scrollMemento.restoreAnchor(anchor, wrapper);
    if (blockId !== null) this.orchestrator.retargetPendingAnchor(blockId);
    this.host.onEditStateChanged();
  }

  /**
   * Remove the editor and put the rendered content back.
   * @purity non-pure
   * @returns {{blockId: number|null, blockType: string|null, text: string, original: string}|null}
   */
  _closeEditor() {
    const openEditor = this._editor;
    if (!openEditor) return null;
    const { textarea } = openEditor;
    textarea.removeEventListener("keydown", this._onKeyDown);
    textarea.removeEventListener("input", this._onInput);
    textarea.removeEventListener("paste", this._onPaste);
    textarea.removeEventListener("compositionstart", this._onCompositionStart);
    textarea.removeEventListener("compositionend", this._onCompositionEnd);
    openEditor.overlay?.detach();
    openEditor.wrapper.replaceChildren(...openEditor.savedNodes);
    openEditor.wrapper.classList.remove("md-block-editing");
    this._editor = null;
    this._composing = false;
    this.editGeneration++;
    this._lexers = null; // the kept block lexing goes with the editor
    this.orchestrator.releaseBlock();
    this.host.onEditStateChanged();
    return { blockId: openEditor.blockId, blockType: openEditor.blockType, text: textarea.value, original: openEditor.original };
  }

  /**
   * Close the editor, then update the model (synchronous; the DOM render is
   * queued by the orchestrator). An unchanged text commits nothing.
   * @purity non-pure
   */
  _commitBlock() {
    // INV-46: the anchor is taken while the editor is still open, when the
    // layout is still clean; the block's top does not move when its own
    // content changes. Taking it after closing forced a layout of the whole
    // preview (~20 ms on a 1 MB document).
    const open = this._editor;
    const anchor = open && open.blockId !== null ? this.scrollMemento.captureAnchor(open.wrapper) : undefined;
    const closed = this._closeEditor();
    if (!closed || closed.text === closed.original) return;
    const text = this._committedText(closed);
    if (text === closed.original) return;
    if (closed.blockId === null) {
      // The empty first block of an empty document (INV-31, INV-49).
      if (closed.text.trim() !== "") void this.orchestrator.insertAfter(null, closed.text);
      return;
    }
    void this.orchestrator.commitBlock(closed.blockId, text, anchor);
  }

  /**
   * The text a changed block is committed with: a table is aligned
   * (INV-61); in a paragraph, list or quote the line ends of spaces that
   * make no line break go (INV-71 (6)).
   * @purity semi-pure-b
   * @param {{blockType: string|null, text: string}} closed
   * @returns {string}
   */
  _committedText(closed) {
    if (closed.blockType === "table") return this.orchestrator.formatTableText(closed.text);
    if (!HARD_BREAK_TYPES.has(closed.blockType)) return closed.text;
    const { lexFull, walkTokens } = this._textLexers();
    return MarkdownTextOps.stripMeaninglessHardBreaks(closed.text, lexFull, walkTokens);
  }

  /**
   * The marks layer behind the editor (INV-70); line end marks only in the
   * blocks of INV-71.
   * @purity non-pure
   */
  _attachOverlay(textarea, blockType) {
    /** @purity non-pure */
    const lineEndMarks = (value) => MarkdownTextOps.hardBreakLines(value, this._textLexers().lexBlocks);
    const overlay = this.createOverlay(textarea, {
      maxChars: CONFIG.edit.invisibleMarkMaxChars,
      lineEndMarks: HARD_BREAK_TYPES.has(blockType) ? lineEndMarks : null,
    });
    this._editor.overlay = overlay;
    overlay.attach();
  }

  // ---- internals: pointer (INV-29, INV-30) ----

  /**
   * @purity non-pure
   */
  _handlePointerDown(e) {
    const node = e.target;
    const inEditor = this._isInEditor(node) || this._cells.containsNode(node);
    const inPalette = this.host.isPaletteNode(node);
    const onScrollbar = this._isScrollbarPress(e);
    // INV-30: while a cell is open, its table is not outside; a press on
    // another of its cells is a cell tap at pointerup.
    const inSessionTable = !inEditor && this._cells.isInSessionTable(node);
    const outside = !inEditor && !inPalette && !onScrollbar && !inSessionTable;
    // The block id (and the cell) and its place on screen are taken now;
    // layout may move before pointerup (a mouse press commits an open
    // editor below).
    const target = (outside || inSessionTable) && e.button === 0 ? this._targetAt(node) : null;
    if (target?.kind === "cell") target.caret = this._caretOf(target, e);
    // INV-46: where the tapped block is before an open editor or cell is
    // committed by this press (nothing moves when none is open)
    const isOpen = this._editor !== null || this._cells.isOpen();
    if (target && outside && isOpen && PLACED_KINDS.has(target.kind)) target.place = this._placeOf(target.id);
    this._press = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      pointerType: e.pointerType,
      outside,
      target,
    };
    if (outside && e.pointerType === "mouse") this.dispatch("pointerPressedOutside");
  }

  /**
   * @purity non-pure
   */
  _handlePointerUp(e) {
    const press = this._press;
    this._press = null;
    if (!press || press.pointerId !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (moved > CONFIG.pan.activationThresholdPx) return;
    const isTap = press.target !== null && this._isSelectionEmpty();
    const target = press.target?.kind === "cell" ? { ...press.target, caret: { ...press.target.caret, x: e.clientX, y: e.clientY } } : press.target;
    const isEditing = this._blockEditState === EDITING || this._blockEditState === CELL;
    if (isEditing && press.outside && press.pointerType !== "mouse") {
      this.dispatch(isTap ? this._tapEvent(target, true) : "pointerPressedOutside", target);
      return;
    }
    if (!isTap) return;
    const event = this._tapEvent(target, false);
    if (event) this.dispatch(event, target);
  }

  /**
   * The 11-c event of a tap on target. whileEditing: a touch tap outside
   * the open editor or cell (it commits there, INV-30). The *WithUnrenderedEditor
   * events come from editModeIdle only (#editor focus ends editing).
   * @purity semi-pure-b
   * @returns {string|null}
   */
  _tapEvent(target, whileEditing) {
    const unrendered = !whileEditing && this.host.isEditorChangedSinceRender() ? "WithUnrenderedEditor" : "";
    switch (target.kind) {
      case "cell":
        return `cellTapped${unrendered}`;
      case "tableSource":
        return `tableSourceTapped${unrendered}`;
      case "tableMargin":
        return whileEditing ? "pointerPressedOutside" : null; // W6 / M1: opens nothing
      default:
        return whileEditing ? "otherBlockTapped" : `blockTapped${unrendered}`;
    }
  }

  /**
   * @purity non-pure
   */
  _forgetPress() {
    this._press = null;
  }

  /**
   * The block a tap on node would open, or null (exclusions of INV-29).
   * @purity semi-pure-b
   * @returns {{kind: string, id?: number}|null}
   */
  _targetAt(node) {
    if (!(node instanceof Element) || !this.preview.contains(node) || node === this.preview) return null;
    if (node.closest(OPEN_EXCLUDED_SELECTOR)) return null;
    const empty = this.blockLocator.getEmptyBlockElement();
    if (empty && empty.contains(node)) return { kind: "empty" };
    const id = this.blockLocator.findBlockIdAt(node);
    if (id === null) return null;
    const table = this.blockLocator.getTableElement(id);
    if (!table) return { kind: "block", id };
    // INV-29 (a) to (c): a cell of the rendered table, the tab, or the margin
    if (this.blockLocator.isTableTab(node)) return { kind: "tableSource", id };
    const at = TableCellEditor.cellAt(table, node);
    return at ? { kind: "cell", id, row: at.row, col: at.col } : { kind: "tableMargin", id };
  }

  /**
   * Inside the open editor (by reference; its wrapper counts as the editor).
   * @purity semi-pure-b
   */
  _isInEditor(node) {
    const openEditor = this._editor;
    return openEditor !== null && (node === openEditor.wrapper || openEditor.textarea.contains(node));
  }

  /**
   * A press on the scroll bar of the preview (or of the page): not "outside",
   * and not a double click on the preview.
   * @purity semi-pure-b
   */
  _isScrollbarPress(e) {
    const el = e.target;
    if (el !== this.preview && el !== document.documentElement) return false;
    return (el.clientWidth > 0 && e.offsetX > el.clientWidth) || (el.clientHeight > 0 && e.offsetY > el.clientHeight);
  }

  /**
   * @purity semi-pure-b
   */
  _isSelectionEmpty() {
    const selection = window.getSelection();
    return !selection || selection.isCollapsed;
  }

  // ---- internals: editor keys and size ----

  /**
   * Esc cancels, Enter in a table inserts the line break text, Enter /
   * Shift+Enter in a paragraph, list or quote the line break mark (INV-71;
   * with Ctrl / Alt / Meta it is the browser's). Tab is left to the browser
   * (INV-53). Nothing is done during IME composition (INV-27, INV-28).
   * @purity non-pure
   */
  _handleKeyDown(e) {
    if (e.isComposing || e.keyCode === 229 || this._composing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.dispatch("escapePressed");
    } else if (e.key === "Enter" && this._editor.blockType === "table") {
      e.preventDefault();
      this._insertTableLineBreak();
    } else if (e.key === "Enter" && !e.ctrlKey && !e.altKey && !e.metaKey && HARD_BREAK_TYPES.has(this._editor.blockType)) {
      this._insertHardBreak(e);
    }
  }

  /**
   * INV-71: the line break mark through the editor's undoable insert; a
   * line that is not paragraph text keeps the browser's newline.
   * @purity non-pure
   * @param {KeyboardEvent} e
   */
  _insertHardBreak(e) {
    const { textarea } = this._editor;
    const edit = MarkdownTextOps.insertHardBreak(textarea.value, textarea.selectionStart, textarea.selectionEnd, this._textLexers());
    if (!edit) return;
    e.preventDefault();
    if (!this._replaceText(edit)) this._handleInput();
  }

  /**
   * @purity non-pure
   */
  _insertTableLineBreak() {
    const { textarea } = this._editor;
    const start = textarea.selectionStart;
    const text = textarea.value.slice(0, start) + textarea.value.slice(textarea.selectionEnd);
    if (!this._replaceText(MarkdownTextOps.insertTextAt(text, start, CONFIG.edit.tableLineBreak))) this._handleInput();
  }

  /**
   * Replace the editor text with edit.text as one undoable step: only the
   * changed range is selected and inserted with execCommand("insertText"),
   * which the browser puts on the editor's own undo history (INV-52, OS-18).
   * Where that is refused or missing, the value is assigned instead.
   * @purity non-pure
   * @param {{text: string, selStart: number, selEnd: number}} edit
   * @returns {boolean} true when the browser inserted it (its input event has run)
   */
  _replaceText(edit) {
    const { textarea } = this._editor;
    let byBrowser = false;
    if (textarea.value !== edit.text) {
      const range = MarkdownTextOps.changedRange(textarea.value, edit.text);
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(range.start, range.end);
      let inserted = false;
      try {
        inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, range.text);
      } catch {
        inserted = false;
      }
      byBrowser = inserted && textarea.value === edit.text;
      if (!byBrowser) textarea.value = edit.text;
      this.editGeneration++; // also when assigned: no input event then
    }
    textarea.setSelectionRange(edit.selStart, edit.selEnd);
    textarea.focus({ preventScroll: true });
    this._editor.overlay?.refresh(); // an assigned value fires no input event
    return byBrowser;
  }

  /**
   * @purity non-pure
   */
  _handleInput() {
    this.editGeneration++;
    this._fitHeight();
    this.host.onEditorInput();
  }

  /**
   * INV-69 (Ctrl+V / Cmd+V, and the context menu's paste): selected text,
   * the paste's text/plain a URL (read synchronously, no permission), the
   * selected text not a URL itself (ruling Q6), and the selection where a
   * link can go (formatRange with strictEnds: one inline range, not in a
   * code span, an inline HTML tag or a link destination): the paste is
   * stopped and the selection becomes a link, put in as one undoable step
   * of the editor. Otherwise the browser's paste is left alone.
   * @purity non-pure
   * @param {ClipboardEvent} e
   */
  _handlePaste(e) {
    if (!this._editor || this._composing) return;
    const { textarea } = this._editor;
    const { selectionStart: start, selectionEnd: end } = textarea;
    if (start === end) return;
    const options = ClipboardLink.urlOptions();
    const url = ClipboardLink.urlFromPasteEvent(e, options);
    if (!url || ClipboardLink.isLinkableUrl(textarea.value.slice(start, end), options.schemes, options.maxLength)) return;
    const edit = MarkdownTextOps.formatRange(textarea.value, start, end, ClipboardLink.linkOp(url, true), this._formatContext());
    if (!edit) return;
    e.preventDefault();
    if (!this._replaceText(edit)) this._handleInput();
  }

  /**
   * @purity non-pure
   */
  _setComposing(isComposing) {
    this._composing = isComposing;
  }

  /**
   * INV-40: the editor is as tall as its content.
   * @purity non-pure
   */
  _fitHeight() {
    const { textarea } = this._editor;
    textarea.style.height = "auto";
    // box-sizing: border-box (style.css): the height includes the borders
    textarea.style.height = `${textarea.scrollHeight + textarea.offsetHeight - textarea.clientHeight}px`;
  }
}
