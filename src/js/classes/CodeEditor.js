import { CONFIG } from "../config.js";
import { shortcutLetter } from "../utils.js";
import { inferIndentUnit, indentLines, outdentLines, leadingIndentAt } from "../indentText.js";

// Keys that move the caret without typing: the next typing starts a new
// undo step (INV-88, NE-18).
const CARET_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

const PLAIN_CLASS = "code-edit-plain";

/**
 * The number of lines of a text (one more than its line feeds).
 * @purity pure
 * @param {string} text
 * @returns {number}
 */
function lineCountOf(text) {
  let count = 1;
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
 * Typing writes the plain text into the layer at once (textContent, so the
 * colors never lag behind the caret's place), and the layer is colored again
 * when typing stops for CONFIG.codeEdit.highlightPauseMs (INV-86). A text
 * longer than CONFIG.codeEdit.highlightMaxChars is plain: the textarea's own
 * text shows and the layer is written only when typing stops (it keeps the
 * size and is what print shows). The gutter is written only when the number
 * of lines changes.
 *
 * Undo and Redo are its own (INV-88): a CodeEditHistory given by the caller
 * (it lives as long as the document). Tab / Shift+Tab, a fold and a replace
 * are one step each; typing is one step until it pauses or the caret moves.
 *
 * CodeEditorHost (the port it calls back, CodeEditController):
 *   highlight(text) -> string|null - highlight.js HTML; null: not colored
 *   canFold() -> boolean - the fold keys are taken (JSON, INV-92)
 *   onFold(direction) - "fold" / "unfold" pressed in the editor (INV-92)
 *   onTextChanged(text) - the text changed (typing, Undo, an operation)
 *   onTextSettled() - typing stopped for highlightPauseMs
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
    this._lineCount = 0;
    this._plain = false;
    this._highlightTimer = 0;
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean} true while editing
   */
  isActive() {
    return this._root !== null;
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
    this._previewEl.replaceChildren(this._root);
    this._refresh(text, true);
    if (!this._plain) this._highlightNow();
    if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    const caret = lineStartOffset(text, this._firstShownLine());
    input.setSelectionRange(caret, caret);
    input.focus({ preventScroll: true });
  }

  /**
   * Stop editing: the editor leaves the preview (the caller shows the view).
   * @purity non-pure
   * @returns {string} the text edited
   */
  stop() {
    if (!this._root) return "";
    const text = this._input.value;
    clearTimeout(this._highlightTimer);
    this._highlightTimer = 0;
    this._root.remove();
    this._root = null;
    this._gutter = null;
    this._stack = null;
    this._code = null;
    this._input = null;
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
   * Undo one step (INV-88).
   * @purity non-pure
   * @returns {boolean} true when a step was undone
   */
  undo() {
    if (!this._root) return false;
    const step = this._history.undo();
    if (!step) return false;
    this._show(step.text, step.selStart, step.selEnd);
    return true;
  }

  /**
   * Redo one step (INV-88).
   * @purity non-pure
   * @returns {boolean} true when a step was redone
   */
  redo() {
    if (!this._root) return false;
    const step = this._history.redo();
    if (!step) return false;
    this._show(step.text, step.selStart, step.selEnd);
    return true;
  }

  /**
   * A whole operation (a fold, a replace, a replace of all): the new text
   * as one undo step (INV-88, NE-18).
   * @purity non-pure
   * @param {string} text
   * @param {number} selStart
   * @param {number} selEnd
   */
  setText(text, selStart, selEnd) {
    if (!this._root) return;
    this._history.recordOperation(text, selStart, selEnd);
    this._show(text, selStart, selEnd);
  }

  /**
   * Select a range (a Search match) without moving the focus; the next
   * typing starts a new undo step.
   * @purity non-pure
   * @param {number} start
   * @param {number} end
   */
  select(start, end) {
    if (!this._root) return;
    this._input.setSelectionRange(start, end);
    this._history.noteCaretMove();
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
   * marked on it), or null: the layer does not hold the text now (plain).
   * @purity semi-pure-b
   * @param {number} start
   * @param {number} end
   * @returns {Range|null}
   */
  rangeOf(start, end) {
    if (!this._root || this._plain) return null;
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
    input.addEventListener("input", () => this._onInput());
    input.addEventListener("keydown", (e) => this._onKeyDown(e));
    input.addEventListener("beforeinput", (e) => this._onBeforeInput(e));
    input.addEventListener("pointerdown", () => this._history.noteCaretMove());
    input.addEventListener("scroll", () => this._keepUnscrolled());
    this._root = root;
    this._gutter = gutter;
    this._stack = stack;
    this._code = code;
    this._input = input;
  }

  /**
   * Typing (or the browser's own edit): one typing step, the layer and the
   * gutter now, the colors when typing stops.
   * @purity non-pure
   */
  _onInput() {
    const input = this._input;
    const text = input.value;
    this._history.recordTyping(text, input.selectionStart, input.selectionEnd);
    this._refresh(text, false);
    this._scheduleHighlight();
    this._host.onTextChanged(text);
  }

  /**
   * The browser's Undo / Redo (the Edit menu, a context menu): this
   * editor's own instead (NE-7).
   * @purity non-pure
   * @param {InputEvent} e
   */
  _onBeforeInput(e) {
    if (e.inputType !== "historyUndo" && e.inputType !== "historyRedo") return;
    e.preventDefault();
    if (e.inputType === "historyUndo") this.undo();
    else this.redo();
  }

  /**
   * The keys of INV-87 / INV-88 / INV-92. A key taken here is
   * preventDefault-ed, so the document's shortcuts see it handled. Nothing
   * during IME composition.
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
   * (Mac: Cmd+Option+[ / ]); null for any other key.
   * @purity semi-pure-a
   * @param {KeyboardEvent} e
   * @returns {"fold"|"unfold"|null}
   */
  _foldDirection(e) {
    const held = this._isApple ? e.metaKey && e.altKey && !e.ctrlKey : e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
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
    const change = (outdent ? outdentLines : indentLines)(input.value, input.selectionStart, input.selectionEnd, this._unit);
    if (change.text === input.value) return;
    this.setText(change.text, change.start, change.end);
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
    this._input.setRangeText(text, this._input.selectionStart, this._input.selectionEnd, "end");
    this._onInput();
  }

  /**
   * Show a text set by the editor itself (Undo, Redo, an operation).
   * @purity non-pure
   * @param {string} text
   * @param {number} selStart
   * @param {number} selEnd
   */
  _show(text, selStart, selEnd) {
    const input = this._input;
    input.value = text;
    input.setSelectionRange(selStart, selEnd);
    this._refresh(text, false);
    this._scheduleHighlight();
    this._host.onTextChanged(text);
  }

  /**
   * The parts that follow the text at once: plain or colored by its length,
   * the layer's plain text (colored mode; plain mode writes it when typing
   * stops), the gutter when the number of lines changed, and no scroll of
   * the textarea's own.
   * @purity non-pure
   * @param {string} text
   * @param {boolean} isStart
   */
  _refresh(text, isStart) {
    const plain = text.length > CONFIG.codeEdit.highlightMaxChars;
    if (plain !== this._plain || isStart) {
      this._plain = plain;
      this._root.classList.toggle(PLAIN_CLASS, plain);
    }
    if (!plain || isStart) this._code.textContent = text + "\n";
    const count = lineCountOf(text);
    if (count !== this._lineCount) {
      this._lineCount = count;
      this._gutter.textContent = gutterText(count);
    }
    if (plain) this._fitWidth();
    this._keepUnscrolled();
  }

  /**
   * Plain mode: the layer may hold an older text until typing stops; the
   * stack is made as wide as the textarea's longest line meanwhile.
   * @purity non-pure
   */
  _fitWidth() {
    const input = this._input;
    if (input.scrollWidth > input.clientWidth) this._stack.style.minWidth = `${input.scrollWidth}px`;
  }

  /**
   * The textarea is as large as its text: it never scrolls itself (the
   * layer under it would no longer match).
   * @purity non-pure
   */
  _keepUnscrolled() {
    const input = this._input;
    if (!input) return;
    if (input.scrollTop !== 0) input.scrollTop = 0;
    if (input.scrollLeft !== 0) input.scrollLeft = 0;
  }

  /**
   * @purity non-pure
   */
  _scheduleHighlight() {
    clearTimeout(this._highlightTimer);
    /** @purity non-pure */
    this._highlightTimer = setTimeout(() => {
      this._highlightTimer = 0;
      this._highlightNow();
      this._host.onTextSettled();
    }, CONFIG.codeEdit.highlightPauseMs);
  }

  /**
   * Color the layer (INV-86): highlight.js HTML (its output only), or the
   * plain text when there are no colors or the text is plain.
   * @purity non-pure
   */
  _highlightNow() {
    if (!this._root) return;
    const text = this._input.value;
    if (this._plain) {
      this._code.textContent = text + "\n";
      this._stack.style.minWidth = "";
      this._fitWidth();
      return;
    }
    const html = this._host.highlight(text);
    if (html === null) this._code.textContent = text + "\n";
    else this._code.innerHTML = html + "\n"; // highlight.js output only (INV-19)
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
