import { CONFIG } from "../config.js";
import { shortcutLetter } from "../utils.js";
import { inferIndentUnit, indentChange, leadingIndentAt } from "../indentText.js";
import { textChange } from "./CodeEditHistory.js";
import { releaseCodeView } from "./SourceFileRenderer.js";

// Keys that move the caret without typing: the next typing starts a new
// undo step (INV-88, NE-18).
const CARET_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

const PLAIN_CLASS = "code-edit-plain";
// typed since the layer was written: the textarea's text shows (INV-86)
const TYPING_CLASS = "code-edit-typing";
// room added past the text when the textarea had to scroll itself (px)
const GROW_PX = 64;

/**
 * The number of line feeds in a text.
 * @purity pure
 * @param {string} text
 * @returns {number}
 */
function lineFeedsIn(text) {
  let count = 0;
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) count++;
  return count;
}

/**
 * The offset where a line starts (0-based line; past the end: the text's end).
 * @purity pure
 * @param {string} text
 * @param {number} line
 * @returns {number}
 */
function lineStartOffset(text, line) {
  let at = 0;
  for (let n = 0; n < line; n++) {
    const next = text.indexOf("\n", at);
    if (next < 0) return text.length;
    at = next + 1;
  }
  return at;
}

/**
 * The 0-based line of an offset.
 * @purity pure
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
function lineOfOffset(text, offset) {
  let line = 0;
  for (let at = text.indexOf("\n"); at >= 0 && at < offset; at = text.indexOf("\n", at + 1)) line++;
  return line;
}

/**
 * The line numbers of the gutter, one a line.
 * @purity pure
 * @param {number} count
 * @returns {string}
 */
function gutterText(count) {
  return Array.from({ length: count }, (_, i) => i + 1).join("\n");
}

/**
 * The editing surface of the code view (UI; SC-27, INV-85 to INV-88): the
 * whole file in one textarea laid over a highlighted layer, with line
 * numbers, no wrapping and no scroll of its own (the page scrolls as in the
 * view).
 *
 * A key does no work on the whole text (G10): no write of the layer or the
 * gutter, no count of lines, no comparison and no read of the layout.
 * While typing, the textarea's own text shows and the layer behind it is
 * hidden; the lines typed (known from the input event) make room under the
 * text at once. When typing stops for CONFIG.codeEdit.highlightPauseMs (the
 * pause), the layer is written again (colored), the gutter follows the
 * number of lines, and the textarea's text is transparent again (INV-86).
 * A text longer than CONFIG.codeEdit.highlightMaxChars is plain: the
 * textarea's text always shows, the layer stays empty (print fills it) and
 * the number of lines gives the height. Should the textarea scroll itself
 * (a line longer, or more lines, than the room made), it is made larger at
 * once and the page scrolls instead.
 *
 * Undo and Redo are its own (INV-88): a CodeEditHistory given by the caller
 * (it lives as long as the document). Tab / Shift+Tab, a fold and a replace
 * are one step each; typing is one step until it pauses or the caret moves.
 * These operations, Undo and Redo write only the part that changed into the
 * textarea (setRangeText; N1): no assignment of the whole value, and no
 * count or comparison over the whole text (a replace or a fold, given a
 * whole new text, finds the changed part by textChange's block comparison).
 *
 * CodeEditorHost (the port it calls back, CodeEditController):
 *   highlight(text) -> string|null - highlight.js HTML; null: not colored
 *   canFold() -> boolean - the fold keys are taken (JSON, INV-92)
 *   onFold(direction) - "fold" / "unfold" pressed in the editor (INV-92)
 *   onTextChanged(text) - the text changed (typing, Undo, an operation)
 *   onTextSettled() - typing stopped for highlightPauseMs (the pause)
 */
export default class CodeEditor {
  /**
   * @purity non-pure
   * @param {HTMLElement} previewEl - #preview: the editor replaces the view's body there
   * @param {object} host - CodeEditorHost
   * @param {{isApple?: boolean}} [platform] - isApple: Cmd is the primary modifier, the
   *   fold keys are Cmd+Option+[ / ] (INV-14, INV-92)
   */
  constructor(previewEl, host, { isApple = false } = {}) {
    this._previewEl = previewEl;
    this._host = host;
    this._isApple = isApple;
    this._root = null; // #codeEditBody while editing
    this._gutter = null;
    this._stack = null;
    this._code = null; // the layer's <code>
    this._input = null; // the textarea
    this._history = null;
    this._unit = CONFIG.codeEdit.defaultIndent;
    this._lineCount = 0; // the lines the gutter shows; 0: not written yet
    this._plain = false;
    this._typing = false; // typed since the layer was written (TYPING_CLASS)
    this._extraLines = 0; // lines added since the layer was written
    this._before = null; // the selection at the last beforeinput: where a typing step begins
    this._settleTimer = 0;
    this._onBeforePrint = () => this._fillLayerForPrint();
    this._onAfterPrint = () => this._emptyPlainLayer();
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean} true while editing
   */
  isActive() {
    return this._root !== null;
  }

  /**
   * The indent unit inferred from the text when editing started (INV-87).
   * @purity semi-pure-b
   * @returns {string}
   */
  get indentUnit() {
    return this._unit;
  }

  /**
   * Start editing: the editor takes the place of the view's body in the
   * preview, at the same scroll place (the same line height and top).
   * @purity non-pure
   * @param {string} text - LF text
   * @param {CodeEditHistory} history - kept by the caller across edit modes
   */
  start(text, history) {
    if (this._root) this.stop();
    this._history = history;
    this._unit = inferIndentUnit(text, CONFIG.codeEdit.defaultIndent);
    this._build();
    const input = this._input;
    input.value = text;
    this._lineCount = 0;
    const scrollY = window.scrollY;
    releaseCodeView(this._previewEl);
    this._previewEl.replaceChildren(this._root);
    this._writeLayer(text);
    if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    const caret = lineStartOffset(text, this._firstShownLine());
    input.setSelectionRange(caret, caret);
    history.noteSelection(caret, caret);
    history.readSelectionWith(() => [input.selectionStart, input.selectionEnd]);
    input.focus({ preventScroll: true });
    window.addEventListener("beforeprint", this._onBeforePrint);
    window.addEventListener("afterprint", this._onAfterPrint);
  }

  /**
   * Stop editing: the editor leaves the preview (the caller shows the view).
   * @purity non-pure
   * @returns {string} the text edited
   */
  stop() {
    if (!this._root) return "";
    const text = this._input.value;
    clearTimeout(this._settleTimer);
    this._settleTimer = 0;
    this._history.noteCaretMove(); // the typing step ends with the selection now
    this._history.readSelectionWith(null);
    this._history.settle();
    window.removeEventListener("beforeprint", this._onBeforePrint);
    window.removeEventListener("afterprint", this._onAfterPrint);
    this._root.remove();
    this._root = null;
    this._gutter = null;
    this._stack = null;
    this._code = null;
    this._input = null;
    this._typing = false;
    this._extraLines = 0;
    this._before = null;
    return text;
  }

  /**
   * @purity semi-pure-b
   * @returns {string} the text being edited ("" when not editing)
   */
  text() {
    return this._input ? this._input.value : "";
  }

  /**
   * @purity semi-pure-b
   * @returns {HTMLTextAreaElement|null}
   */
  get input() {
    return this._input;
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean}
   */
  canUndo() {
    return Boolean(this._history?.canUndo());
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean}
   */
  canRedo() {
    return Boolean(this._history?.canRedo());
  }

  /**
   * Undo one step (INV-88): the text and the selection of the moment the
   * step began.
   * @purity non-pure
   * @returns {boolean} true when a step was undone
   */
  undo() {
    return this._replay(false);
  }

  /**
   * Redo one step (INV-88).
   * @purity non-pure
   * @returns {boolean} true when a step was redone
   */
  redo() {
    return this._replay(true);
  }

  /**
   * A whole operation (a fold, a replace, a replace of all): the new text
   * as one undo step (INV-88, NE-18). Only the part that changed is
   * written into the textarea (N1).
   * @purity non-pure
   * @param {string} text
   * @param {number} selStart
   * @param {number} selEnd
   */
  setText(text, selStart, selEnd) {
    if (!this._root) return;
    this._operate(textChange(this._input.value, text), selStart, selEnd);
  }

  /**
   * The layer follows the text now (Save as gave a name of another
   * language, INV-90 (7)): the pause's work at once.
   * @purity non-pure
   */
  recolor() {
    if (!this._root) return;
    clearTimeout(this._settleTimer);
    this._settleTimer = 0;
    this._settleNow();
  }

  /**
   * Select a range (a Search match) without moving the focus; the next
   * typing starts a new undo step from it.
   * @purity non-pure
   * @param {number} start
   * @param {number} end
   */
  select(start, end) {
    if (!this._root) return;
    this._history.noteSelection(start, end); // first: a typing step ends where its caret is
    this._input.setSelectionRange(start, end);
  }

  /**
   * Put the caret at the start of a line (an Index entry) without moving
   * the focus.
   * @purity non-pure
   * @param {number} line - 0-based
   */
  moveCaretToLine(line) {
    if (!this._root) return;
    const at = lineStartOffset(this._input.value, line);
    this.select(at, at);
  }

  /**
   * Where a line is: the textarea, and how far below its top the line's
   * top is (for ScrollMemento.scrollTargetTo).
   * @purity semi-pure-b
   * @param {number} line - 0-based
   * @returns {{element: HTMLElement, offset: number}|null}
   */
  linePlace(line) {
    if (!this._root) return null;
    const { top, lineHeight } = this._metrics();
    return { element: this._input, offset: top + line * lineHeight };
  }

  /**
   * Where the line holding an offset is (linePlace).
   * @purity semi-pure-b
   * @param {number} offset
   * @returns {{element: HTMLElement, offset: number}|null}
   */
  placeOf(offset) {
    if (!this._root) return null;
    return this.linePlace(lineOfOffset(this._input.value, offset));
  }

  /**
   * A DOM range over the layer's text from start to end (a Search match is
   * marked on it), or null: the layer does not hold the text now (plain,
   * or typed since it was written).
   * @purity semi-pure-b
   * @param {number} start
   * @param {number} end
   * @returns {Range|null}
   */
  rangeOf(start, end) {
    if (!this._root || this._plain || this._typing) return null;
    const walker = document.createTreeWalker(this._code, NodeFilter.SHOW_TEXT);
    let from = null;
    let at = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const next = at + node.data.length;
      if (!from && start < next) from = [node, start - at];
      if (from && end <= next) {
        const range = document.createRange();
        range.setStart(...from);
        range.setEnd(node, end - at);
        return range;
      }
      at = next;
    }
    return null;
  }

  // ---- internals ----

  /**
   * The DOM of the editor (design 2):
   * #codeEditBody > .code-edit-gutter + .code-edit-stack > (pre.code-edit-layer > code) + textarea.
   * @purity non-pure
   */
  _build() {
    const root = document.createElement("div");
    root.id = "codeEditBody";
    const gutter = document.createElement("div");
    gutter.className = "code-edit-gutter";
    gutter.setAttribute("aria-hidden", "true");
    const stack = document.createElement("div");
    stack.className = "code-edit-stack";
    const layer = document.createElement("pre");
    layer.className = "code-edit-layer";
    layer.setAttribute("aria-hidden", "true");
    const code = document.createElement("code");
    layer.append(code);
    const input = document.createElement("textarea");
    input.className = "code-edit-input";
    input.spellcheck = false;
    input.wrap = "off";
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("aria-label", CONFIG.messages.codeEdit.editorLabel);
    stack.append(layer, input);
    root.append(gutter, stack);
    input.addEventListener("input", (e) => this._onInput(e));
    input.addEventListener("keydown", (e) => this._onKeyDown(e));
    input.addEventListener("beforeinput", (e) => this._onBeforeInput(e));
    input.addEventListener("pointerdown", () => this._history.noteCaretMove());
    input.addEventListener("scroll", () => this._onScroll());
    this._root = root;
    this._gutter = gutter;
    this._stack = stack;
    this._code = code;
    this._input = input;
  }

  /**
   * Typing (or the browser's own edit): the text and the selection go to
   * the undo history (no comparison), the lines typed make room, the
   * textarea's text shows, and the pause is waited for. Nothing reads or
   * writes the whole text but the textarea's value itself (G10).
   * @purity non-pure
   * @param {InputEvent|{data: string}|undefined} e
   */
  _onInput(e) {
    const input = this._input;
    const text = input.value;
    const before = this._before;
    this._before = null;
    this._history.recordTyping(text, null, null, before); // the selection after: read when needed
    this._addLines(lineFeedsIn(this._insertedText(e, text, before)));
    this._setTyping(true);
    this._scheduleSettle();
    this._host.onTextChanged(text);
  }

  /**
   * The text an input inserted, from the event (not from the whole text):
   * its data, a line break, or the piece between the selection before it
   * and the caret after it (a paste or a drop without data). "" when not known.
   * @purity semi-pure-b
   * @param {InputEvent|{data: string}|undefined} e
   * @param {string} text - the text after the input
   * @param {number[]|null} before - the selection before the input
   * @returns {string}
   */
  _insertedText(e, text, before) {
    if (!e) return "";
    if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") return "\n";
    if (typeof e.data === "string") return e.data;
    if (before && typeof e.inputType === "string" && e.inputType.startsWith("insert")) {
      return text.slice(before[0], Math.max(before[0], this._input.selectionEnd));
    }
    return "";
  }

  /**
   * Room for lines added since the layer was written (the layer gives the
   * height of the lines it holds). Lines removed by the editor's own edits
   * are taken off (count < 0); those removed by typing are not known, so
   * the room is never less than the lines need.
   * @purity non-pure
   * @param {number} count
   */
  _addLines(count) {
    if (count === 0) return;
    this._extraLines += count;
    this._stack.style.setProperty("--code-extra-lines", String(Math.max(0, this._extraLines)));
  }

  /**
   * The textarea's text shows (typed since the layer was written), or the
   * layer's colors do.
   * @purity non-pure
   * @param {boolean} isTyping
   */
  _setTyping(isTyping) {
    if (isTyping === this._typing) return;
    this._typing = isTyping;
    this._root.classList.toggle(TYPING_CLASS, isTyping);
  }

  /**
   * The browser's Undo / Redo (the Edit menu, a context menu): this
   * editor's own instead (NE-7). Any other input that begins a typing step,
   * or pastes or drops: the selection before it (where the step begins,
   * INV-88 (3)); read only then (WebKit: its cost grows with the text).
   * @purity non-pure
   * @param {InputEvent} e
   */
  _onBeforeInput(e) {
    if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
      e.preventDefault();
      if (e.inputType === "historyUndo") this.undo();
      else this.redo();
      return;
    }
    const pasted = typeof e.inputType === "string" && e.inputType.startsWith("insertFrom");
    this._before = pasted || this._history.startsStep() ? [this._input.selectionStart, this._input.selectionEnd] : null;
  }

  /**
   * The keys of INV-87 / INV-88 / INV-92. A key taken here is
   * preventDefault-ed, so the document's shortcuts see it handled. Nothing
   * during IME composition. A held fold, Undo or Redo key acts once, as the
   * shortcuts outside it (INV-14 (2)).
   * @purity non-pure
   * @param {KeyboardEvent} e
   */
  _onKeyDown(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (CARET_KEYS.has(e.key)) {
      this._history.noteCaretMove();
      return;
    }
    const direction = this._foldDirection(e);
    if (direction) {
      if (!this._host.canFold()) return;
      e.preventDefault();
      if (!e.repeat) this._host.onFold(direction);
      return;
    }
    const letter = shortcutLetter(e, this._isApple);
    const isRedo = (letter === "z" && e.shiftKey) || (letter === "y" && !e.shiftKey && !this._isApple);
    if ((letter === "z" && !e.shiftKey) || isRedo) {
      e.preventDefault();
      if (e.repeat) return;
      if (isRedo) this.redo();
      else this.undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Tab") {
      e.preventDefault();
      this._indent(e.shiftKey);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const input = this._input;
      this._insertTyped("\n" + leadingIndentAt(input.value, input.selectionStart));
    } else if (e.key === "Escape") {
      e.preventDefault();
      this._input.blur(); // NE-5: Tab then moves the focus
    }
  }

  /**
   * The fold key pressed, by its place (event.code, NE-27): Ctrl+Shift+[ / ]
   * (Mac: Cmd+Option+[ / ], without Shift); null for any other key.
   * @purity semi-pure-a
   * @param {KeyboardEvent} e
   * @returns {"fold"|"unfold"|null}
   */
  _foldDirection(e) {
    const held = this._isApple
      ? e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey
      : e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
    if (!held) return null;
    if (e.code === "BracketLeft") return "fold";
    if (e.code === "BracketRight") return "unfold";
    return null;
  }

  /**
   * Tab / Shift+Tab: the selected lines one unit deeper / shallower (NE-5),
   * one undo step.
   * @purity non-pure
   * @param {boolean} outdent
   */
  _indent(outdent) {
    const input = this._input;
    const change = indentChange(input.value, input.selectionStart, input.selectionEnd, this._unit, outdent);
    if (change) this._operate(change, change.start, change.end);
  }

  /**
   * An operation as one undo step: its changed part is written into the
   * textarea (setRangeText: no input event, so no typing step), and the
   * history records that part (no comparison of the texts).
   * @purity non-pure
   * @param {{at: number, removed: string, inserted: string}} change
   * @param {number} selStart - the selection after it
   * @param {number} selEnd
   */
  _operate(change, selStart, selEnd) {
    const input = this._input;
    const before = [input.selectionStart, input.selectionEnd];
    this._history.noteCaretMove(); // an open typing step ends with the selection before the edit
    const text = this._writePart(change.at, change.removed, change.inserted);
    input.setSelectionRange(selStart, selEnd);
    this._history.recordOperation(text, selStart, selEnd, before, change);
    this._edited(lineFeedsIn(change.inserted) - lineFeedsIn(change.removed), text);
  }

  /**
   * Undo (redo false) or Redo one step: the step's changed part is written
   * back into the textarea, and the selection of the step is put.
   * @purity non-pure
   * @param {boolean} redo
   * @returns {boolean} true when a step was undone / redone
   */
  _replay(redo) {
    if (!this._root) return false;
    let lines = 0;
    /** @purity non-pure */
    const edit = (at, removed, inserted) => {
      lines = lineFeedsIn(inserted) - lineFeedsIn(removed);
      return this._writePart(at, removed, inserted);
    };
    const step = redo ? this._history.redo(edit) : this._history.undo(edit);
    if (!step) return false;
    this._input.setSelectionRange(step.selStart, step.selEnd);
    this._edited(lines, step.text);
    return true;
  }

  /**
   * Write a part of the text: removed, at at, becomes inserted (only that
   * part; the textarea's own undo is not used, INV-88).
   * @purity non-pure
   * @param {number} at
   * @param {string} removed
   * @param {string} inserted
   * @returns {string} the text after it
   */
  _writePart(at, removed, inserted) {
    const input = this._input;
    input.setRangeText(inserted, at, at + removed.length);
    return input.value;
  }

  /**
   * Insert typed text at the selection as the browser types it (its own
   * scroll to the caret, an input event); where the browser cannot, by
   * setRangeText.
   * @purity non-pure
   * @param {string} text
   */
  _insertTyped(text) {
    let inserted = false;
    try {
      inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }
    if (inserted) return;
    const input = this._input;
    this._before = [input.selectionStart, input.selectionEnd];
    input.setRangeText(text, input.selectionStart, input.selectionEnd, "end");
    this._onInput({ data: text });
  }

  /**
   * After the editor's own edit (Undo, Redo, an operation): as typing,
   * room for the lines it added (counted in its changed part only), the
   * textarea's text shown and the pause waited for.
   * @purity non-pure
   * @param {number} lines - the lines added (less than 0: removed)
   * @param {string} text - the text now
   */
  _edited(lines, text) {
    this._addLines(lines);
    this._setTyping(true);
    this._scheduleSettle();
    this._host.onTextChanged(text);
  }

  /**
   * The textarea scrolled itself (more lines, or a longer line, than the
   * room made while typing): it is made as large as its text plus some
   * room and put back unscrolled, and the page scrolls by as much where
   * the caret would otherwise be past the window's edge.
   * @purity non-pure
   */
  _onScroll() {
    const input = this._input;
    if (!input) return;
    const dx = input.scrollLeft;
    const dy = input.scrollTop;
    if (dx === 0 && dy === 0) return;
    const rect = input.getBoundingClientRect();
    if (dy !== 0) this._stack.style.minHeight = `${input.scrollHeight + GROW_PX}px`;
    if (dx !== 0) this._stack.style.minWidth = `${input.scrollWidth + GROW_PX}px`;
    input.scrollTop = 0;
    input.scrollLeft = 0;
    const right = rect.right + dx - window.innerWidth;
    const down = rect.bottom + dy - window.innerHeight;
    if (right > 0 || down > 0) window.scrollBy(Math.max(0, right), Math.max(0, down));
  }

  /**
   * @purity non-pure
   */
  _scheduleSettle() {
    clearTimeout(this._settleTimer);
    /** @purity non-pure */
    this._settleTimer = setTimeout(() => {
      this._settleTimer = 0;
      this._settleNow();
      this._host.onTextSettled();
    }, CONFIG.codeEdit.highlightPauseMs);
  }

  /**
   * The pause's work on the text now: the undo history settles, the layer
   * and the gutter follow.
   * @purity non-pure
   */
  _settleNow() {
    if (!this._root) return;
    this._history.settle();
    this._writeLayer(this._input.value);
  }

  /**
   * The work kept off the keys (the pause, and the start): plain or colored
   * by the text's length, the gutter when the number of lines changed, and
   * the room made while typing taken back. Colored: the layer is written
   * (colored, or plain text when there are no colors) and the textarea's
   * text is transparent again. Plain: the layer is empty, the number of
   * lines gives the height (CSS) and the width is read here once.
   * @purity non-pure
   * @param {string} text
   */
  _writeLayer(text) {
    const plain = text.length > CONFIG.codeEdit.highlightMaxChars;
    const style = this._stack.style;
    if (plain !== this._plain || this._lineCount === 0) {
      this._plain = plain;
      this._root.classList.toggle(PLAIN_CLASS, plain);
    }
    const count = lineFeedsIn(text) + 1;
    if (count !== this._lineCount) {
      this._lineCount = count;
      this._gutter.textContent = gutterText(count);
      style.setProperty("--code-lines", String(count));
    }
    style.removeProperty("--code-extra-lines");
    style.minHeight = "";
    this._extraLines = 0;
    if (plain) {
      this._code.textContent = "";
      if (style.minWidth === "") style.minWidth = `${this._input.scrollWidth}px`;
    } else {
      const html = this._host.highlight(text);
      if (html === null) this._code.textContent = text + "\n";
      else this._code.innerHTML = html + "\n"; // highlight.js output only (INV-19)
      style.minWidth = "";
    }
    this._setTyping(false);
  }

  /**
   * Print shows the layer (INV-85 (7)): the pause's work now if it waits,
   * and the text in the layer of a plain text.
   * @purity non-pure
   */
  _fillLayerForPrint() {
    if (!this._root) return;
    if (this._settleTimer) {
      clearTimeout(this._settleTimer);
      this._settleTimer = 0;
      this._settleNow();
      this._host.onTextSettled();
    }
    if (this._plain) this._code.textContent = this._input.value + "\n";
  }

  /**
   * After print: the layer of a plain text is empty again.
   * @purity non-pure
   */
  _emptyPlainLayer() {
    if (this._root && this._plain) this._code.textContent = "";
  }

  /**
   * The textarea's top padding and line height in px (0 when unknown).
   * @purity semi-pure-b
   * @returns {{top: number, lineHeight: number}}
   */
  _metrics() {
    const style = window.getComputedStyle(this._input);
    const top = parseFloat(style.paddingTop);
    const lineHeight = parseFloat(style.lineHeight);
    return { top: Number.isFinite(top) ? top : 0, lineHeight: Number.isFinite(lineHeight) ? lineHeight : 0 };
  }

  /**
   * The first line shown at the top of the preview: the caret goes there
   * when editing starts, so the view does not move.
   * @purity semi-pure-b
   * @returns {number}
   */
  _firstShownLine() {
    const { top, lineHeight } = this._metrics();
    if (lineHeight <= 0) return 0;
    const shownTop = Math.max(0, this._previewEl.getBoundingClientRect().top);
    const below = shownTop - this._input.getBoundingClientRect().top - top;
    return Math.max(0, Math.ceil(below / lineHeight));
  }
}
