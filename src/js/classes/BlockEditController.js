import { CONFIG } from "../config.js";
import MarkdownBlockModel from "./MarkdownBlockModel.js";
import MarkdownTextOps from "./MarkdownTextOps.js";
import { cell, row } from "../stateTable.js";

const BROWSING = "browsingPreview";
const IDLE = "editModeIdle";
const EDITING = "editingBlock";

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

const STATES = [BROWSING, IDLE, EDITING];
const transitions = (...cells) => row(STATES, cells);

/**
 * Spec 11-c: event -> current state -> cell. "enqueueFullRender" is done by
 * the caller (UIController) after dispatch returns; "showToast" is part of
 * host.renderFromEditor() (INV-45).
 */
export const blockEditStateMachine = Object.freeze({
  paletteShown: transitions(cell(IDLE, []), null, null),
  paletteHidden: transitions(null, cell(BROWSING, []), cell(BROWSING, ["commitBlock"])),
  emptyDocumentStarted: transitions(
    cell(EDITING, ["startEmptyDocument", "showPalette", "openBlockEditor"]),
    cell(EDITING, ["startEmptyDocument", "openBlockEditor"]),
    null,
  ),
  blockTapped: transitions(null, cell(EDITING, ["openBlockEditor"]), null),
  blockTappedWithUnrenderedEditor: transitions(null, cell(IDLE, ["renderFromEditor", "showToast"]), null),
  otherBlockTapped: transitions(null, null, cell(EDITING, ["commitBlock", "resolveBlockById", "openBlockEditor"])),
  pointerPressedOutside: transitions(null, null, cell(IDLE, ["commitBlock"])),
  escapePressed: transitions(null, cell(BROWSING, ["hidePalette"]), cell(IDLE, ["restoreOriginalRaw"], "isImeIdle")),
  saveRequested: transitions(null, null, cell(IDLE, ["commitBlock"])),
  saveAsRequested: transitions(null, null, cell(IDLE, ["commitBlock"])),
  documentReplaced: transitions(null, null, cell(IDLE, ["discardBlockEditor"])),
  documentCleared: transitions(null, cell(BROWSING, ["hidePalette"]), cell(BROWSING, ["discardBlockEditor", "hidePalette"])),
  viewSwitchedToCode: transitions(null, cell(BROWSING, ["hidePalette"]), cell(BROWSING, ["discardBlockEditor", "hidePalette"])),
  fullRenderRequested: transitions(
    cell(BROWSING, ["enqueueFullRender"]),
    cell(IDLE, ["enqueueFullRender"]),
    cell(IDLE, ["commitBlock", "enqueueFullRender"]),
  ),
  editorFocused: transitions(null, null, cell(IDLE, ["commitBlock"])),
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
 *   editor opened or closed: unsaved mark and palette buttons).
 */
export default class BlockEditController {
  /**
   * @param {HTMLElement} preview
   * @param {RendererOrchestrator} orchestrator - model and commits
   * @param {MarkdownRenderer} blockLocator - block wrappers by reference
   * @param {ScrollMemento} scrollMemento - anchor on open (INV-46)
   * @param {object} host - BlockEditHost
   * @purity non-pure
   */
  constructor(preview, orchestrator, blockLocator, scrollMemento, host) {
    this.preview = preview;
    this.orchestrator = orchestrator;
    this.blockLocator = blockLocator;
    this.scrollMemento = scrollMemento;
    this.host = host;
    this._blockEditState = BROWSING;
    this._editor = null; // { textarea, wrapper, blockId, blockType, original, savedNodes }
    this._press = null; // the pointerdown being followed
    this._composing = false;
    this._lastOpenedBlockId = null;
    this._onPointerDown = (e) => this._handlePointerDown(e);
    this._onPointerUp = (e) => this._handlePointerUp(e);
    this._onPointerCancel = () => this._forgetPress();
    this._onKeyDown = (e) => this._handleKeyDown(e);
    this._onInput = () => this._handleInput();
    this._onCompositionStart = () => this._setComposing(true);
    this._onCompositionEnd = () => this._setComposing(false);
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
    const next = cells[this._blockEditState];
    if (!next) return undefined;
    if (next.guard === "isImeIdle" && this._composing) return undefined;
    return this._run(next, target);
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isEditing() {
    // The editor itself, so a commit's onModelChanged (inside the transition)
    // already sees the editor closed.
    return this._editor !== null;
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

  // ---- internals: actions ----

  /**
   * @purity non-pure
   */
  _run(next, target) {
    let resolved = target;
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
        default:
          // showToast: inside renderFromEditor; enqueueFullRender: by the caller
          break;
      }
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
    const next = to === EDITING && !this._editor ? IDLE : to;
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
    if (!target || target.kind !== "block" || !next.actions.includes("openBlockEditor")) return null;
    return target.place ?? this._placeOf(target.id);
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
    if (!target || target.kind !== "block") return target;
    const model = this.orchestrator.getModel();
    return model && model.findIndexById(target.id) >= 0 ? target : null;
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
    textarea.style.fontFamily = "monospace";
    textarea.style.overflowY = "hidden"; // INV-40: the height follows the content
    const savedNodes = [...wrapper.childNodes];
    wrapper.replaceChildren(textarea);
    wrapper.classList.add("md-block-editing");
    this._editor = { textarea, wrapper, blockId, blockType, original: raw, savedNodes };
    this._composing = false;
    if (blockId !== null) {
      this.orchestrator.holdBlock(blockId); // Q-d1
      this._lastOpenedBlockId = blockId;
    }

    textarea.addEventListener("keydown", this._onKeyDown);
    textarea.addEventListener("input", this._onInput);
    textarea.addEventListener("compositionstart", this._onCompositionStart);
    textarea.addEventListener("compositionend", this._onCompositionEnd);
    this._fitHeight();
    textarea.focus({ preventScroll: true });
    this.scrollMemento.restoreAnchor(anchor, wrapper);
    if (blockId !== null) this.orchestrator.retargetPendingAnchor(blockId);
    this.host.onEditStateChanged();
  }

  /**
   * Remove the editor and put the rendered content back.
   * @purity non-pure
   * @returns {{blockId: number|null, text: string, original: string}|null}
   */
  _closeEditor() {
    const openEditor = this._editor;
    if (!openEditor) return null;
    const { textarea } = openEditor;
    textarea.removeEventListener("keydown", this._onKeyDown);
    textarea.removeEventListener("input", this._onInput);
    textarea.removeEventListener("compositionstart", this._onCompositionStart);
    textarea.removeEventListener("compositionend", this._onCompositionEnd);
    openEditor.wrapper.replaceChildren(...openEditor.savedNodes);
    openEditor.wrapper.classList.remove("md-block-editing");
    this._editor = null;
    this._composing = false;
    this.orchestrator.releaseBlock();
    this.host.onEditStateChanged();
    return { blockId: openEditor.blockId, text: textarea.value, original: openEditor.original };
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
    if (closed.blockId === null) {
      // The empty first block of an empty document (INV-31, INV-49).
      if (closed.text.trim() !== "") void this.orchestrator.insertAfter(null, closed.text);
      return;
    }
    void this.orchestrator.commitBlock(closed.blockId, closed.text, anchor);
  }

  // ---- internals: pointer (INV-29, INV-30) ----

  /**
   * @purity non-pure
   */
  _handlePointerDown(e) {
    const node = e.target;
    const inEditor = this._isInEditor(node);
    const inPalette = this.host.isPaletteNode(node);
    const onScrollbar = this._isScrollbarPress(e);
    const outside = !inEditor && !inPalette && !onScrollbar;
    // The block id and its place on screen are taken now; layout may move
    // before pointerup (a mouse press commits an open editor below).
    const target = outside && e.button === 0 ? this._targetAt(node) : null;
    if (target && target.kind === "block") target.place = this._placeOf(target.id);
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
    if (this._blockEditState === EDITING && press.outside && press.pointerType !== "mouse") {
      this.dispatch(isTap ? "otherBlockTapped" : "pointerPressedOutside", press.target);
      return;
    }
    if (!isTap) return;
    const event = this.host.isEditorChangedSinceRender() ? "blockTappedWithUnrenderedEditor" : "blockTapped";
    this.dispatch(event, press.target);
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
    return id === null ? null : { kind: "block", id };
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
   * A press on the scroll bar of the preview (or of the page) is not "outside".
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
   * Esc cancels, Enter in a table inserts the line break text. Tab is left
   * to the browser (INV-53). Nothing is done during IME composition (INV-27,
   * INV-28).
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
    }
  }

  /**
   * @purity non-pure
   */
  _insertTableLineBreak() {
    const { textarea } = this._editor;
    const start = textarea.selectionStart;
    const text = textarea.value.slice(0, start) + textarea.value.slice(textarea.selectionEnd);
    this._replaceText(MarkdownTextOps.insertTextAt(text, start, CONFIG.edit.tableLineBreak));
    this._handleInput();
  }

  /**
   * Replace the editor text with edit.text as one undoable step: only the
   * changed range is selected and inserted with execCommand("insertText"),
   * which the browser puts on the editor's own undo history (INV-52, OS-18).
   * Where that is refused or missing, the value is assigned instead.
   * @purity non-pure
   * @param {{text: string, selStart: number, selEnd: number}} edit
   */
  _replaceText(edit) {
    const { textarea } = this._editor;
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
      if (!inserted || textarea.value !== edit.text) textarea.value = edit.text;
    }
    textarea.setSelectionRange(edit.selStart, edit.selEnd);
    textarea.focus({ preventScroll: true });
  }

  /**
   * @purity non-pure
   */
  _handleInput() {
    this._fitHeight();
    this.host.onEditorInput();
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
