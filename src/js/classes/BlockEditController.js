import { CONFIG } from "../config.js";
import MarkdownBlockModel from "./MarkdownBlockModel.js";
import MarkdownTextOps from "./MarkdownTextOps.js";
import InvisibleCharOverlay from "./InvisibleCharOverlay.js";
import TableCellEditor from "./TableCellEditor.js";
import ClipboardLink from "./ClipboardLink.js";
import BlockGapInsert from "./BlockGapInsert.js";
import BlockRangeSelection from "./BlockRangeSelection.js";
import { cell, row, choice, selectCell } from "../stateTable.js";
import { isPastActivation } from "../utils.js";

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
const CELL_ACTIONS = new Set(["openCell", "commitCell", "discardCell", "endTableSession"]);
// The toasts of a block range (config.js) and the 11-c event of each
// button of its bar (INV-74).
const RANGE_MESSAGES = CONFIG.messages.blockRange;
const RANGE_EVENTS = { delete: "blockRangeDeleteRequested", cut: "blockRangeCutRequested", copy: "blockRangeCopyRequested" };

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
  // Esc applies and closes (INV-28, owner ruling D1); Ctrl+Z then takes it back.
  // A block range is taken away first (INV-74, owner ruling D14).
  escapePressed: transitions(
    null,
    choice(cell(IDLE, ["clearBlockRange"], "hasBlockRange"), cell(BROWSING, ["hidePalette"])),
    cell(IDLE, ["commitBlock"], "isImeIdle"),
    cell(IDLE, ["commitCell", "endTableSession"], "isImeIdle"),
  ),
  // INV-48 (1): a changed editor or cell is applied, and that unit undone
  // (Redo brings it back); a commit that made no unit undoes nothing (R1).
  undoRequested: transitions(
    null,
    cell(IDLE, ["undoLastUnit"]),
    choice(cell(IDLE, ["commitBlock", "undoJustCommitted"], "hasUncommittedChange"), cell(IDLE, ["commitBlock", "undoLastUnit"])),
    choice(
      cell(IDLE, ["commitCell", "endTableSession", "undoJustCommitted"], "hasUncommittedChange"),
      cell(IDLE, ["commitCell", "endTableSession", "undoLastUnit"]),
    ),
  ),
  // INV-48 / INV-59: a changed editor or cell has nothing to redo (R2): it
  // stays open and the redo record is kept.
  redoRequested: transitions(
    null,
    cell(IDLE, ["redoLastUnit"]),
    choice(cell(EDITING, [], "hasUncommittedChange"), cell(IDLE, ["commitBlock", "redoLastUnit"])),
    choice(cell(CELL, [], "hasUncommittedChange"), cell(IDLE, ["commitCell", "endTableSession", "redoLastUnit"])),
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
      // a table not editable by cell: as a click there (owner ruling Q-c, INV-62 (1))
      cell(EDITING, ["clearSelection", "showPalette", "openTableSourceWithToast"], "isCellTarget"),
      cell(EDITING, ["clearSelection", "showPalette", "openBlockEditor"], "isEmptyDocument"),
      cell(EDITING, ["clearSelection", "showPalette", "openBlockEditor"], "isBlockTarget"),
      cell(IDLE, ["clearSelection", "showPalette"]),
    ),
    null,
    null,
    null,
  ),
  // INV-52: Insert table / Mermaid / math boxes. While editing, the editor is committed
  // first (a change of its own), then the block goes in where planned; a
  // place that refuses keeps the editor open and tells why.
  blockInsertRequested: transitions(
    null,
    cell(IDLE, ["insertBlock"]),
    choice(cell(IDLE, ["commitBlock", "insertBlock"], "canInsertBlock"), cell(EDITING, ["showInsertRefusedToast"])),
    null,
  ),
  // INV-73 (owner ruling B1): the line in a gap between blocks was clicked.
  // An open editor or cell is committed first (a change of its own), then an
  // empty editor opens in that gap; what is typed goes in as a new block
  // when it is committed, and an empty one changes nothing.
  gapInsertRequested: transitions(
    null,
    choice(
      cell(IDLE, ["renderFromEditor", "showToast"], "hasUnrenderedEditor"),
      cell(EDITING, ["resolveBlockById", "openBlockEditor"]),
    ),
    cell(EDITING, ["commitBlock", "resolveBlockById", "openBlockEditor"]),
    cell(EDITING, ["commitCell", "endTableSession", "resolveBlockById", "openBlockEditor"]),
  ),
  // INV-74 (owner rulings D1 to D14): the blocks a selection touches in the
  // preview are deleted (Delete, Backspace, the bar), cut (Ctrl+X) or
  // copied (Ctrl+C) as a whole. A delete or a cut is one unit; with an
  // unrendered #editor change nothing happens but the full render (INV-45).
  // A copy changes nothing, so it copies what is on screen.
  blockRangeDeleteRequested: transitions(
    null,
    choice(cell(IDLE, ["renderFromEditor", "showToast"], "hasUnrenderedEditor"), cell(IDLE, ["deleteBlockRange"])),
    null,
    null,
  ),
  blockRangeCutRequested: transitions(
    null,
    choice(cell(IDLE, ["renderFromEditor", "showToast"], "hasUnrenderedEditor"), cell(IDLE, ["cutBlockRange"])),
    null,
    null,
  ),
  blockRangeCopyRequested: transitions(null, cell(IDLE, ["copyBlockRange"]), null, null),
  // INV-52: the inserted block has been drawn and nothing else happened
  // meanwhile: a table opens its first cell, a Mermaid block its source
  // (the math boxes open nothing: this event is not dispatched for them).
  insertedBlockRendered: transitions(
    null,
    choice(
      cell(CELL, ["startTableSession", "openCell"], "isCellEditableTable"),
      cell(EDITING, ["openTableSourceWithToast"], "isCellTarget"),
      cell(EDITING, ["openBlockEditor"]),
    ),
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
 *   onTransitionEnded() (an 11-c crossing ended: the deferred button states),
 *   showToast(message) (the table toasts of 11-c),
 *   writeClipboardNow(text) (a block range's source to the clipboard inside
 *   the key or button handler, INV-74 (4): true when written) and
 *   writeClipboardLater(text) (the same through navigator.clipboard: a
 *   promise of whether it was written).
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
   * @param {(gapHost: object) => BlockGapInsert} [createGaps] - INV-73
   * @param {(rangeHost: object) => BlockRangeSelection} [createRanges] - INV-74
   * @purity non-pure
   */
  constructor(
    preview,
    orchestrator,
    blockLocator,
    scrollMemento,
    host,
    createOverlay = (textarea, options) => new InvisibleCharOverlay(textarea, options),
    createGaps = (gapHost) => new BlockGapInsert(preview, blockLocator, gapHost),
    createRanges = (rangeHost) => new BlockRangeSelection(preview, blockLocator, rangeHost, { isApple: Boolean(host.isApple) }),
  ) {
    this.preview = preview;
    this.orchestrator = orchestrator;
    this.blockLocator = blockLocator;
    this.scrollMemento = scrollMemento;
    this.host = host;
    this.createOverlay = createOverlay;
    this._blockEditState = BROWSING;
    this._editor = null; // { textarea, wrapper, blockId, blockType, original, savedNodes, overlay, gap }
    this._lexers = null; // the orchestrator's text lexers, block lexing cached per text
    this._press = null; // the pointerdown being followed
    this._composing = false;
    this._lastOpenedBlockId = null;
    this._transitionDepth = 0; // 11-c crossings running (nested: INV-45)
    this._insertPlans = new WeakMap(); // blockInsertRequested target -> its plan (INV-52)
    this._insertsPending = 0; // inserts whose opening after the render has not run (owner ruling D5)
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
    this._gaps = createGaps({
      onGapChosen: (target) => this.dispatch("gapInsertRequested", target),
      isSuppressed: () => this._ranges.hasRange(), // no "+" while blocks are selected (INV-74)
    });
    this._ranges = createRanges({
      canSelect: () => this._blockEditState === IDLE && !this.isEditing(),
      isPaletteNode: (node) => this.host.isPaletteNode(node),
      /** @purity non-pure */
      onRangeChanged: (range) => {
        if (range) this._gaps.hide();
      },
      onActionRequested: (kind, range) => this.dispatch(RANGE_EVENTS[kind], range),
    });
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
   * only for emptyDocumentStarted and blockInsertRequested (an editor or a
   * cell opens after the render).
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
    // The host defers the palette's button states while a crossing runs (a
    // cell closes before the next one opens, K-1), and gets them once at the
    // end of the outermost one (a crossing can dispatch another, INV-45).
    this._transitionDepth++;
    try {
      return this._run(next, target, event);
    } finally {
      this._transitionDepth--;
      if (this._transitionDepth === 0) this.host.onTransitionEnded?.();
    }
  }

  /**
   * An insert's block is not drawn yet: its cell or source opens after the
   * render (INV-52). The page's one-key shortcuts wait meanwhile (owner
   * ruling D5).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isInsertPending() {
    return this._insertsPending > 0;
  }

  /**
   * An 11-c crossing is running (its actions have not all been done).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isInTransition() {
    return this._transitionDepth > 0;
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
   * The block range the selection makes in edit mode (INV-74), read now:
   * {kind: "blockRange", firstId, lastId}, or null (none, not editModeIdle,
   * or the focus in a text entry). Shows nothing.
   * @purity semi-pure-b
   * @returns {{kind: "blockRange", firstId: number, lastId: number}|null}
   */
  readBlockRange() {
    return this._ranges.readRange();
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
    // a huge block: any selection; the format checks when pressed (isHugeBlock)
    if (this._isHugeBlock()) return true;
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
    if (this._isHugeBlock()) return false; // a caret: the place is not lexed
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
    if (this._isHugeBlock()) return range.selStart !== range.selEnd;
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
   * 5.15.5 Insert inline math: a block editor (not a cell: owner ruling
   * 2026-10-25) whose caret (the selection end) is where inline math can go
   * (only the place is checked, one inline lexing: INV-51). Off in a huge
   * block (not lexed, as INV-71).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  canInsertInlineMath() {
    if (this._cells.isOpen() || this._isHugeBlock()) return false;
    const range = this.getSelectionRange();
    if (!range) return false;
    return MarkdownTextOps.canInsertInlineMath(range.text, range.selEnd, this._formatContext());
  }

  /**
   * The palette's inline math (INV-52): math goes in at the caret (the
   * selection end; the selected text stays), with a space before or after
   * where marked needs one. An editor change (not a commit), one undoable
   * step of the editor.
   * @purity non-pure
   * @param {string} math - the "$...$" template
   * @returns {boolean} true when the text changed
   */
  insertInlineMath(math) {
    if (this._cells.isOpen() || this._isHugeBlock()) return false;
    const range = this.getSelectionRange();
    if (!range) return false;
    const edit = MarkdownTextOps.insertInlineMath(range.text, range.selEnd, math, this._formatContext());
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
   * The open block editor holds more than CONFIG.edit.invisibleMarkMaxChars
   * characters (owner ruling 2026-10-23, as INV-70): its whole text is not
   * lexed on each key or frame. Enter is the browser's newline, and the
   * format and link buttons are on for a selection and check when pressed.
   * @purity semi-pure-b
   * @returns {boolean}
   */
  _isHugeBlock() {
    return this._editor !== null && this._editor.textarea.value.length > CONFIG.edit.invisibleMarkMaxChars;
  }

  /**
   * The open block editor is a huge block (_isHugeBlock): its format buttons
   * are on without checking, so a format that cannot go in is told (owner
   * ruling Q-f).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isHugeBlock() {
    return this._isHugeBlock();
  }

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
      case "canInsertBlock":
        return this._insertPlan(target).kind !== "refuse";
      case "hasBlockRange":
        return this._ranges.readRange() !== null;
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
    let committed = null; // where the committed text is now (commitBlock)
    let inserting = null; // { rendering, blockId, model } of insertBlock
    const modelBefore = this.orchestrator.getModel(); // undoJustCommitted
    // INV-46: where the tapped block was before an open editor above it
    // closed and changed the layout (PRT-U07).
    const tapped = this._tappedPlace(next, target);
    for (const action of next.actions) {
      switch (action) {
        case "commitBlock":
          committed = this._commitBlock();
          break;
        case "discardBlockEditor":
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
        case "undoJustCommitted":
          // INV-48 (1): only the unit the commit of this crossing made (R1)
          if (this.orchestrator.getModel() !== modelBefore) this.orchestrator.undoLastCommit();
          break;
        case "redoLastUnit":
          // as undoLastUnit: #editor changes are rendered instead (R3)
          if (this.host.isEditorChangedSinceRender()) this.host.renderFromEditor();
          else this.orchestrator.redoLastCommit();
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
            this._cells.openCell(resolved.row, resolved.col, resolved.caret ?? null, resolved.selectAll === true);
          }
          break;
        case "commitCell":
          this._cells.commitCell();
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
        case "insertBlock":
          inserting = this._insertBlock(target, committed);
          break;
        case "showInsertRefusedToast":
          this.host.showToast(CONFIG.messages.edit.insertNotPossible);
          break;
        case "clearBlockRange":
          this._ranges.clearSelection();
          break;
        case "copyBlockRange":
          this._copyBlockRange(target);
          break;
        case "cutBlockRange":
          this._cutBlockRange(target);
          break;
        case "deleteBlockRange":
          this._deleteBlockRange(target);
          break;
        default:
          // showToast: inside renderFromEditor; enqueueFullRender: by the caller
          break;
      }
    }
    // A cell opened or closed: told before the state moves on (11-c contract).
    if (next.actions.some((a) => CELL_ACTIONS.has(a))) this.host.onEditStateChanged();
    if (inserting) {
      this._settle(next.to);
      this._insertsPending++;
      return inserting.rendering
        .then(() => this._openInsertedAfterRender(inserting, target))
        .catch((error) => console.error("Opening the inserted block failed:", error))
        .finally(() => this._insertsPending--);
    }
    if (!rendering) {
      this._settle(next.to);
      return undefined;
    }
    // The empty block exists only after the full render.
    this._settle(IDLE);
    return rendering.then(() => this._openEmptyAfterRender());
  }

  /**
   * INV-74 (4): the source of the range to the clipboard (the host writes
   * it, nothing is read). Written now, or else a little later through
   * navigator.clipboard: the Copy button shows a check once written (U3),
   * or a toast says it failed. Ids no longer in the model: nothing.
   * @purity non-pure
   * @param {{kind: string, firstId: number, lastId: number}|null} target
   */
  _copyBlockRange(target) {
    const text = this._readRangeSource(target);
    if (text === null) return;
    if (this.host.writeClipboardNow(text)) {
      this._ranges.showCopied();
      return;
    }
    /** @purity non-pure */
    void this.host.writeClipboardLater(text).then((isWritten) => {
      if (isWritten) this._ranges.showCopied();
      else this.host.showToast(RANGE_MESSAGES.copyFailed);
    });
  }

  /**
   * INV-74 (4): a cut deletes only when its source was written now; else
   * its blocks stay, nothing is written later, and a toast says so
   * (coordinator ruling 2026-10-24).
   * @purity non-pure
   * @param {{kind: string, firstId: number, lastId: number}|null} target
   */
  _cutBlockRange(target) {
    const text = this._readRangeSource(target);
    if (text === null) return;
    if (this.host.writeClipboardNow(text)) this._deleteBlockRange(target);
    else this.host.showToast(RANGE_MESSAGES.cutFailed);
  }

  /**
   * INV-74 (3): the blocks of the range go as one unit, and the selection
   * with them. The scroll anchor is taken first, while the layout is clean
   * (taking the frame off first would lay the preview out again, INV-51).
   * @purity non-pure
   * @param {{kind: string, firstId: number, lastId: number}|null} target
   */
  _deleteBlockRange(target) {
    if (target?.kind === "blockRange") void this.orchestrator.deleteBlocks(target.firstId, target.lastId);
    this._ranges.clearSelection();
  }

  /**
   * The source of a block range target, or null (no range, or its ids are
   * no longer in the model).
   * @purity semi-pure-b
   * @param {{kind: string, firstId: number, lastId: number}|null} target
   * @returns {string|null}
   */
  _readRangeSource(target) {
    if (target?.kind !== "blockRange") return null;
    return this.orchestrator.readBlocksSource(target.firstId, target.lastId);
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
   * The plan of an insert in the open editor (INV-52), worked out once per
   * press (the guard, then insertBlock after the commit); kept per target.
   * @purity non-pure
   * @param {object} target - the blockInsertRequested target
   * @returns {{kind: string, line?: number}}
   */
  _insertPlan(target) {
    let plan = this._insertPlans.get(target);
    if (!plan) {
      let range = this.getSelectionRange();
      if (range && this._editor.gap) {
        // planned on the text the gap editor commits (INV-73)
        const { text, lead } = BlockEditController._gapText(range.text);
        range = { text, selEnd: Math.min(Math.max(range.selEnd - lead, 0), text.length) };
      }
      plan = range
        ? MarkdownTextOps.planBlockInsert(range.text, range.selEnd, this._editor.blockType, {
            ...this._textLexers(),
            maxInlineChars: CONFIG.edit.invisibleMarkMaxChars, // a huge paragraph is not lexed inline (INV-71)
          })
        : { kind: "refuse" };
      this._insertPlans.set(target, plan);
    }
    return plan;
  }

  /**
   * INV-52: put target.raw in, as one change of its own. After a commit,
   * where the plan puts it in the committed text (cutting that block in
   * two, and the line end spaces that no longer break a line go); the
   * block at the committed block's start keeps its place (its upper part,
   * or the inserted block when it went above. INV-46). Not editing: after
   * the last opened block, or at the end. The inserted block (the last
   * one, when raw has more blocks: the math boxes) becomes the last opened
   * one. null without a model.
   * @purity non-pure
   * @param {{raw: string}} target
   * @param {{start: number, text: string, anchor: object|null}|null} committed
   * @returns {{rendering: Promise<void>, blockId: number, model: MarkdownBlockModel}|null}
   */
  _insertBlock(target, committed) {
    const plan = this._insertPlans.get(target);
    let at = { afterBlockId: this._lastOpenedBlockId };
    if (committed && plan) {
      const { lexBlocks } = this._textLexers();
      at = {
        offset: committed.start + MarkdownTextOps.insertOffset(committed.text, plan),
        removeBefore: MarkdownTextOps.cutLineEndBreak(committed.text, plan, lexBlocks),
        scroll: committed.anchor,
        anchorOffset: committed.start,
      };
    }
    const { rendering, blockId, lastBlockId } = this.orchestrator.insertBlock(target.raw, at);
    if (blockId === null) return null;
    this._lastOpenedBlockId = lastBlockId; // the next insert goes after it (review L5)
    return { rendering, blockId, model: this.orchestrator.getModel() };
  }

  /**
   * INV-52: the inserted block is drawn. Only when nothing happened
   * meanwhile (still editModeIdle, no editor or cell open, the model is the
   * one of the insert, no unrendered #editor change), and the block is of
   * the inserted kind (not a whole document that could not be split): a table's first
   * header cell opens with its text selected, a Mermaid block's source with
   * the caret at the end of the diagram's first line. Then the least scroll
   * that shows it (none when it is in view). The math boxes (opens "none")
   * open nothing, so that they are seen drawn: only the least scroll that
   * shows the first inserted block.
   * @purity non-pure
   * @param {{blockId: number, model: MarkdownBlockModel}} inserting
   * @param {{opens: "cell"|"source"|"none"}} target
   */
  _openInsertedAfterRender(inserting, target) {
    if (this._blockEditState !== IDLE || this.isEditing()) return;
    if (this.orchestrator.getModel() !== inserting.model || this.host.isEditorChangedSinceRender()) return;
    const id = inserting.blockId;
    if (target.opens === "none") {
      this.scrollMemento.reveal(this.blockLocator.getBlockElement(id));
      return;
    }
    const block = inserting.model.getBlocks()[inserting.model.findIndexById(id)];
    if (block?.type !== (target.opens === "cell" ? "table" : "code")) return;
    const opened =
      target.opens === "cell"
        ? { kind: "cell", id, row: 0, col: 0, caret: null, selectAll: true }
        : { kind: "block", id, caretLineEnd: 1 };
    this.dispatch("insertedBlockRendered", opened);
    this.scrollMemento.reveal(this._editor?.textarea ?? this._cells.openCellElement());
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
      this._gaps.enable();
      this._ranges.enable();
      document.addEventListener("pointerdown", this._onPointerDown, true);
      document.addEventListener("pointerup", this._onPointerUp, true);
      document.addEventListener("pointercancel", this._onPointerCancel, true);
    } else if (!wasBrowsing && next === BROWSING) {
      this._gaps.disable();
      this._ranges.disable();
      document.removeEventListener("pointerdown", this._onPointerDown, true);
      document.removeEventListener("pointerup", this._onPointerUp, true);
      document.removeEventListener("pointercancel", this._onPointerCancel, true);
      this._press = null;
    }
    // a block range is only for editModeIdle (INV-74): an editor or a cell takes it away
    if (next === EDITING || next === CELL) this._ranges.reset();
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
    if (target?.kind === "gap") return this._resolveGap(target);
    if (!target || target.id === undefined) return target;
    const model = this.orchestrator.getModel();
    return model && model.findIndexById(target.id) >= 0 ? target : null;
  }

  /**
   * The gap of a gapInsertRequested on the current model, as the block it
   * comes after (null: before the first block), and the block after it; null
   * when it is gone (INV-73). The start and the end of the document always
   * stay; another gap follows its upper block, or else its lower one (a
   * commit before it may have changed either).
   * @purity semi-pure-b
   * @param {{afterBlockId: number|null, beforeBlockId: number|null}} target
   * @returns {{kind: "gap", afterBlockId: number|null, beforeBlockId: number|null}|null}
   */
  _resolveGap(target) {
    const model = this.orchestrator.getModel();
    const blocks = model ? model.getBlocks() : [];
    if (blocks.length === 0) return null;
    /** @purity semi-pure-b */
    const gap = (index) => ({ kind: "gap", afterBlockId: index < 0 ? null : blocks[index].id, beforeBlockId: blocks[index + 1]?.id ?? null });
    if (target.afterBlockId === null) return gap(-1);
    const after = model.findIndexById(target.afterBlockId);
    if (after >= 0) return gap(after);
    if (target.beforeBlockId === null) return gap(blocks.length - 1);
    const before = model.findIndexById(target.beforeBlockId);
    return before >= 0 ? gap(before - 1) : null;
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
    } else if (target.kind === "gap") {
      // INV-73: a wrapper of its own in the gap, kept there by the renderer
      wrapper = document.createElement("div");
      wrapper.className = "md-block md-block-gap";
      this.blockLocator.placeGapEditor(wrapper, target.afterBlockId, target.beforeBlockId);
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
    const gap = target.kind === "gap" ? { afterBlockId: target.afterBlockId } : null;
    this._editor = { textarea, wrapper, blockId, blockType, original: raw, savedNodes, overlay: null, gap };
    this._gaps.hide();
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
    if (typeof target.caretLineEnd === "number") {
      // INV-52: the end of a line of the source (a Mermaid diagram's first line)
      const end = raw.split("\n").slice(0, target.caretLineEnd + 1).join("\n").length;
      textarea.setSelectionRange(end, end);
    }
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
    if (openEditor.gap) this.blockLocator.removeGapEditor();
    this._editor = null;
    this._composing = false;
    this.editGeneration++;
    this._lexers = null; // the kept block lexing goes with the editor
    this.orchestrator.releaseBlock();
    this.host.onEditStateChanged();
    return {
      blockId: openEditor.blockId,
      blockType: openEditor.blockType,
      text: textarea.value,
      original: openEditor.original,
      gap: openEditor.gap,
    };
  }

  /**
   * Close the editor, then update the model (synchronous; the DOM render is
   * queued by the orchestrator). An unchanged text commits nothing.
   * Returns where the block's text is in the body now (start, and the text
   * committed or kept) and the anchor taken, for an insert that follows
   * (INV-52); null when no editor was open.
   * @purity non-pure
   * @returns {{start: number, text: string, anchor: object|null}|null}
   */
  _commitBlock() {
    // INV-46: the anchor is taken while the editor is still open, when the
    // layout is still clean; the block's top does not move when its own
    // content changes. Taking it after closing forced a layout of the whole
    // preview (~20 ms on a 1 MB document).
    const open = this._editor;
    const anchor = open && (open.blockId !== null || open.gap) ? this.scrollMemento.captureAnchor(open.wrapper) : undefined;
    const model = this.orchestrator.getModel();
    const closed = this._closeEditor();
    if (!closed) return null;
    if (closed.gap) return this._commitGap(closed, model, anchor ?? null);
    const kept = {
      start: !model ? 0 : closed.blockId === null ? model.toBody().length : model.startOffsetOf(closed.blockId),
      text: closed.blockId === null ? "" : closed.original,
      anchor: anchor ?? null,
    };
    if (closed.text === closed.original) return kept;
    const text = this._committedText(closed);
    if (text === closed.original) return kept;
    if (closed.blockId === null) {
      // The empty first block of an empty document (INV-31, INV-49).
      if (closed.text.trim() === "") return kept;
      void this.orchestrator.insertAfter(null, closed.text);
      // it went in at the end of the (blank) body
      return { ...kept, start: this.orchestrator.getBody().length - closed.text.length, text: closed.text };
    }
    void this.orchestrator.commitBlock(closed.blockId, text, anchor);
    return { ...kept, text };
  }

  /**
   * INV-73: what was typed in a gap editor goes in at that gap as one
   * change of its own (blank lines around it as needed), and the new block
   * keeps the place the editor had (INV-46). Blank: nothing changes. Returns
   * as _commitBlock (where the text is now).
   * @purity non-pure
   * @param {{text: string, gap: {afterBlockId: number|null}}} closed
   * @param {MarkdownBlockModel|null} model - the model when it was open
   * @param {object|null} anchor
   * @returns {{start: number, text: string, anchor: object|null}}
   */
  _commitGap(closed, model, anchor) {
    const offset = model ? model.gapOffset(closed.gap.afterBlockId) : 0;
    const kept = { start: offset, text: "", anchor };
    const { text } = BlockEditController._gapText(closed.text);
    if (!model || text === "") return kept;
    const { blockId } = this.orchestrator.insertBlock(text, { offset, scroll: anchor });
    if (blockId === null) return kept;
    this._lastOpenedBlockId = blockId; // the next Insert table / Mermaid goes after it (INV-52)
    // the text went in as typed, after the blank lines the gap needed (only "\n")
    return { start: this.orchestrator.getBody().indexOf(text, offset), text, anchor };
  }

  /**
   * The text a gap editor puts in (INV-73): its leading blank lines and
   * trailing white space belong to the gap, not to the block. lead: the
   * length taken off the start.
   * @purity pure
   * @param {string} value
   * @returns {{text: string, lead: number}}
   */
  static _gapText(value) {
    const lead = /^(?:[ \t]*\n)*/.exec(value)[0].length;
    return { text: value.slice(lead).trimEnd(), lead };
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
      maxMarks: CONFIG.edit.invisibleMarkMaxMarks,
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
    const onGapLine = this._gaps.isLineNode(node);
    if (!onGapLine) this._gaps.hide(); // a touch shows it until the next press
    const inEditor = this._isInEditor(node) || this._cells.containsNode(node);
    const inPalette = this.host.isPaletteNode(node);
    const onScrollbar = this._isScrollbarPress(e);
    // INV-30: while a cell is open, its table is not outside; a press on
    // another of its cells is a cell tap at pointerup.
    const inSessionTable = !inEditor && this._cells.isInSessionTable(node);
    const outside = !inEditor && !inPalette && !onScrollbar && !inSessionTable;
    // INV-73: a touch on a gap between blocks (in the preview, not on the
    // top bar over it) shows its line at pointerup (a tap on that line
    // inserts); it opens no block.
    const onPreview = node instanceof Node && this.preview.contains(node);
    const gap = outside && onPreview && !onGapLine && e.pointerType !== "mouse" && e.button === 0 ? this._gaps.gapAt(e.clientX, e.clientY) : null;
    // The block id (and the cell) and its place on screen are taken now;
    // layout may move before pointerup (a mouse press commits an open
    // editor below).
    const target = gap ?? ((outside || inSessionTable) && e.button === 0 ? this._targetAt(node) : null);
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
    if (isPastActivation(press, { x: e.clientX, y: e.clientY })) return; // a drag, judged at the release only
    const isTap = press.target !== null && this._isSelectionEmpty();
    const target = press.target?.kind === "cell" ? { ...press.target, caret: { ...press.target.caret, x: e.clientX, y: e.clientY } } : press.target;
    const isEditing = this._blockEditState === EDITING || this._blockEditState === CELL;
    if (target?.kind === "gap") {
      // INV-73: an open editor or cell is committed (outside); then the line
      // shows where the gap is now
      if (isEditing) this.dispatch("pointerPressedOutside");
      const gap = isTap ? this._gaps.gapAt(e.clientX, e.clientY) : null;
      if (gap) this._gaps.show(gap);
      return;
    }
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
   * Esc applies and closes (INV-28), Shift+Enter in a table inserts the line
   * break text and Enter is the browser's newline there (INV-27, owner
   * ruling B2), Enter / Shift+Enter in a paragraph, list or quote the line
   * break mark (INV-71); with Ctrl / Alt / Meta, Enter is the browser's in
   * both. Tab is left to the browser (INV-53). Nothing is done during IME
   * composition (INV-27, INV-28).
   * @purity non-pure
   */
  _handleKeyDown(e) {
    if (e.isComposing || e.keyCode === 229 || this._composing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (!e.repeat) this.dispatch("escapePressed"); // a held Esc acts once (ruling Q-a)
    } else if (e.key === "Enter" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // with Ctrl / Alt / Meta, Enter is the browser's (INV-27 by owner ruling Q-b, INV-71)
      if (this._editor.blockType === "table") {
        if (!e.shiftKey) return; // the browser's newline (owner ruling B2)
        e.preventDefault();
        this._insertTableLineBreak();
      } else if (HARD_BREAK_TYPES.has(this._editor.blockType)) {
        this._insertHardBreak(e);
      }
    }
  }

  /**
   * INV-71: the line break mark through the editor's undoable insert; a
   * line that is not paragraph text keeps the browser's newline.
   * @purity non-pure
   * @param {KeyboardEvent} e
   */
  _insertHardBreak(e) {
    if (this._isHugeBlock()) return; // the browser's newline (owner ruling 2026-10-23)
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
