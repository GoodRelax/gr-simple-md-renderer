import { CONFIG } from "../config.js";
import MarkdownBlockModel from "./MarkdownBlockModel.js";
import MarkdownTextOps from "./MarkdownTextOps.js";

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

/**
 * One cell of the transition table.
 * @purity pure
 * @param {string} to - next state
 * @param {string[]} actions
 * @param {string} [guard]
 * @returns {Readonly<{to: string, actions: ReadonlyArray<string>, guard?: string}>}
 */
function cell(to, actions, guard) {
  const c = { to, actions: Object.freeze(actions) };
  if (guard) c.guard = guard;
  return Object.freeze(c);
}

/**
 * One row of the table: the cell for each current state (null = no change).
 * @purity pure
 */
function row(browsing, idle, editing) {
  return Object.freeze({ [BROWSING]: browsing, [IDLE]: idle, [EDITING]: editing });
}

/**
 * Spec 11-c: event -> current state -> cell. "enqueueFullRender" is done by
 * the caller (UIController) after dispatch returns; "showToast" is part of
 * host.renderFromEditor() (INV-45).
 */
export const blockEditStateMachine = Object.freeze({
  paletteShown: row(cell(IDLE, []), null, null),
  paletteHidden: row(null, cell(BROWSING, []), cell(BROWSING, ["commitBlock"])),
  emptyDocumentStarted: row(
    cell(EDITING, ["startEmptyDocument", "showPalette", "openBlockEditor"]),
    cell(EDITING, ["startEmptyDocument", "openBlockEditor"]),
    null,
  ),
  blockTapped: row(null, cell(EDITING, ["openBlockEditor"]), null),
  blockTappedWithUnrenderedEditor: row(null, cell(IDLE, ["renderFromEditor", "showToast"]), null),
  otherBlockTapped: row(null, null, cell(EDITING, ["commitBlock", "resolveBlockById", "openBlockEditor"])),
  pointerPressedOutside: row(null, null, cell(IDLE, ["commitBlock"])),
  escapePressed: row(null, cell(BROWSING, ["hidePalette"]), cell(IDLE, ["restoreOriginalRaw"], "isImeIdle")),
  saveRequested: row(null, null, cell(IDLE, ["commitBlock"])),
  saveAsRequested: row(null, null, cell(IDLE, ["commitBlock"])),
  documentReplaced: row(null, null, cell(IDLE, ["discardBlockEditor"])),
  documentCleared: row(null, cell(BROWSING, ["hidePalette"]), cell(BROWSING, ["discardBlockEditor", "hidePalette"])),
  viewSwitchedToCode: row(null, cell(BROWSING, ["hidePalette"]), cell(BROWSING, ["discardBlockEditor", "hidePalette"])),
  fullRenderRequested: row(
    cell(BROWSING, ["enqueueFullRender"]),
    cell(IDLE, ["enqueueFullRender"]),
    cell(IDLE, ["commitBlock", "enqueueFullRender"]),
  ),
  editorFocused: row(null, null, cell(IDLE, ["commitBlock"])),
});

/**
 * In-place block editing (spec 5.14.6, 11-c): the start gesture, the
 * "outside" commit, and the block editor's keys. The editor element never
 * leaves this class; text and selection go through getSelectionRange() and
 * applyTextEdit() (LoD).
 *
 * host (BlockEditHost, implemented by UIController):
 *   showPalette(), hidePalette(), isPaletteNode(node) (palette and popovers,
 *   by reference), focusPalette(), isEditorChangedSinceRender(),
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
    this._state = BROWSING;
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
    const transitions = blockEditStateMachine[event];
    if (!transitions) throw new Error(`Unknown block edit event: ${event}`);
    const next = transitions[this._state];
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
   * Open the editor on a block (editModeIdle only).
   * @purity non-pure
   * @param {number} blockId
   */
  open(blockId) {
    if (this._state !== IDLE) return;
    this._openBlockEditor({ kind: "block", id: blockId });
    this._settle(EDITING);
  }

  /**
   * Commit the open editor (synchronous model update, INV-47).
   * @purity non-pure
   */
  commit() {
    if (this._state !== EDITING) return;
    this._commitBlock();
    this._settle(IDLE);
  }

  /**
   * Close the open editor without committing (INV-28).
   * @purity non-pure
   */
  cancel() {
    if (this._state !== EDITING) return;
    this._closeEditor();
    this._settle(IDLE);
  }

  /**
   * @purity semi-pure-b
   * @returns {{text: string, selStart: number, selEnd: number}|null}
   */
  getSelectionRange() {
    if (!this._editor) return null;
    const t = this._editor.textarea;
    return { text: t.value, selStart: t.selectionStart, selEnd: t.selectionEnd };
  }

  /**
   * Put text and selection into the editor; focus stays, nothing is committed.
   * @purity non-pure
   * @param {{text: string, selStart: number, selEnd: number}} edit
   */
  applyTextEdit(edit) {
    if (!this._editor) return;
    const t = this._editor.textarea;
    t.value = edit.text;
    t.setSelectionRange(edit.selStart, edit.selEnd);
    t.focus({ preventScroll: true });
    this._fitHeight();
  }

  /**
   * Move the focus back to the open editor (INV-53: Shift+Tab / Esc on the
   * palette). The textarea keeps its own selection.
   * @purity non-pure
   * @returns {boolean} false when no editor is open
   */
  focusEditor() {
    if (!this._editor) return false;
    this._editor.textarea.focus({ preventScroll: true });
    return true;
  }

  // ---- internals: actions ----

  /**
   * @purity non-pure
   */
  _run(next, target) {
    let resolved = target;
    let rendering = null;
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
          if (!rendering) this._openBlockEditor(resolved);
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
    if (this._state !== IDLE || this._editor) return;
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
    const wasBrowsing = this._state === BROWSING;
    this._state = next;
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
   * @purity non-pure
   */
  _openBlockEditor(target) {
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

    const anchor = this.scrollMemento.captureAnchor(wrapper);
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
    this.host.onEditStateChanged();
  }

  /**
   * Remove the editor and put the rendered content back.
   * @purity non-pure
   * @returns {{blockId: number|null, text: string, original: string}|null}
   */
  _closeEditor() {
    const ed = this._editor;
    if (!ed) return null;
    const t = ed.textarea;
    t.removeEventListener("keydown", this._onKeyDown);
    t.removeEventListener("input", this._onInput);
    t.removeEventListener("compositionstart", this._onCompositionStart);
    t.removeEventListener("compositionend", this._onCompositionEnd);
    ed.wrapper.replaceChildren(...ed.savedNodes);
    ed.wrapper.classList.remove("md-block-editing");
    this._editor = null;
    this._composing = false;
    this.orchestrator.releaseBlock();
    this.host.onEditStateChanged();
    return { blockId: ed.blockId, text: t.value, original: ed.original };
  }

  /**
   * Close the editor, then update the model (synchronous; the DOM render is
   * queued by the orchestrator). An unchanged text commits nothing.
   * @purity non-pure
   */
  _commitBlock() {
    const closed = this._closeEditor();
    if (!closed || closed.text === closed.original) return;
    if (closed.blockId === null) {
      // The empty first block of an empty document (INV-31, INV-49).
      if (closed.text.trim() !== "") void this.orchestrator.insertAfter(null, closed.text);
      return;
    }
    void this.orchestrator.commitBlock(closed.blockId, closed.text);
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
    this._press = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      pointerType: e.pointerType,
      outside,
      // The block id is taken now; layout may move before pointerup.
      target: outside && e.button === 0 ? this._targetAt(node) : null,
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
    if (this._state === EDITING && press.outside && press.pointerType !== "mouse") {
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
    const ed = this._editor;
    return ed !== null && (node === ed.wrapper || ed.textarea.contains(node));
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
   * Esc cancels, Enter in a table inserts the line break text, Tab goes to
   * the palette. Nothing is done during IME composition (INV-27, INV-28, INV-53).
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
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      this.host.focusPalette();
    }
  }

  /**
   * @purity non-pure
   */
  _insertTableLineBreak() {
    const t = this._editor.textarea;
    const start = t.selectionStart;
    const text = t.value.slice(0, start) + t.value.slice(t.selectionEnd);
    const edit = MarkdownTextOps.insertTextAt(text, start, CONFIG.edit.tableLineBreak);
    t.value = edit.text;
    t.setSelectionRange(edit.selStart, edit.selEnd);
    this._handleInput();
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
    const t = this._editor.textarea;
    t.style.height = "auto";
    // box-sizing: border-box (style.css): the height includes the borders
    t.style.height = `${t.scrollHeight + t.offsetHeight - t.clientHeight}px`;
  }
}
