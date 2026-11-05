import { CONFIG } from "../config.js";
import { escapeHtml, shortcutLetter } from "../utils.js";
import { inferIndentUnit, indentChange, leadingIndentAt } from "../indentText.js";
import { textChange } from "./CodeEditHistory.js";
import { SEARCH_HIGHLIGHTS } from "./DocumentSearch.js";
import { releaseCodeView, splitHighlightedLines } from "./SourceFileRenderer.js";

// Keys that move the caret without typing: the next typing starts a new
// undo step (INV-88, NE-18).
const CARET_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

const PLAIN_CLASS = "code-edit-plain";
// the layer could not follow an edit (plain, or the text grew over the
// plain limit): the textarea's text shows until the pause (INV-86)
const TYPING_CLASS = "code-edit-typing";
// a block of lines of the layer (INV-86 (a)): an edit writes again only its blocks
const BLOCK_CLASS = "code-edit-block";
// the CSS highlight of the IME composition's text on the layer (the
// textarea's own mark is transparent with its text, INV-86 (c))
const COMPOSING_HIGHLIGHT = "grsmd-code-composing";
// a highlight.js sub-language's span (xml's <script> / <style>): class "language-<id>"
const LANGUAGE_PREFIX = "language-";
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
 * What the tags open at a line's start (carried) mean for coloring that
 * line alone (INV-86 (b)): how many there are, whether the innermost is a
 * scope of text (a comment, a string: CONFIG.codeEdit.textScopeClasses),
 * and the innermost sub-language (a highlight.js "language-<id>" span), if any.
 * @purity semi-pure-a
 * @param {string} carried
 * @returns {{depth: number, isText: boolean, language: string|null}}
 */
function carriedScope(carried) {
  const classes = [...carried.matchAll(/class="([^"]*)"/g)].map((m) => m[1].split(" "));
  const innermost = classes.at(-1) ?? [];
  const language = classes.flat().findLast((name) => name.startsWith(LANGUAGE_PREFIX));
  return {
    depth: classes.length,
    isText: innermost.some((name) => CONFIG.codeEdit.textScopeClasses.includes(name)),
    language: language ? language.slice(LANGUAGE_PREFIX.length) : null,
  };
}

/**
 * A DOM range over an element's text from start to end (offsets in its
 * text), or null when the text is shorter.
 * @purity semi-pure-b
 * @param {Element} root
 * @param {number} start
 * @param {number} end
 * @returns {Range|null}
 */
function rangeIn(root, start, end) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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

/**
 * The inside of a block of the layer: its lines' HTML, each with its line feed.
 * @purity pure
 * @param {string[]} lines
 * @returns {string}
 */
function blockInnerHtml(lines) {
  return `${lines.join("\n")}\n`;
}

/**
 * Blocks of the layer for these lines, each of at most size lines.
 * @purity pure
 * @param {string[]} lines - the lines' HTML
 * @param {number} size
 * @returns {string}
 */
function blocksHtml(lines, size) {
  let html = "";
  for (let at = 0; at < lines.length; at += size) {
    html += `<span class="${BLOCK_CLASS}">${blockInnerHtml(lines.slice(at, at + size))}</span>`;
  }
  return html;
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
 * The layer holds blocks of lines (CONFIG.codeEdit.layerBlockLines a block;
 * one element a line costs WebKit too much). A key makes again the lines it
 * touched (INV-86, BI-26): the textarea's text stays transparent and the
 * layer stays shown, so the text typed is colored at once. Each line is
 * colored alone: inside a comment or a string of several lines it takes
 * that scope's color; inside another span open at its start (a
 * sub-language of an HTML file, parameters over several lines) it is
 * colored in that span's language and wrapped in the span. In lines
 * longer than CONFIG.codeEdit.typedColorMaxChars, an edit writes its
 * characters, line feeds too, into the lines' colored text (no
 * highlight.js; the pause colors them). Finding the lines compares the
 * text with the layer's, which only a colored text (at most
 * CONFIG.codeEdit.highlightMaxChars) does; a key writes no gutter and
 * reads no layout. When typing stops for CONFIG.codeEdit.highlightPauseMs
 * (the pause), the whole layer is written again (colored in context) and
 * the gutter follows the number of lines. The IME composition's text is
 * underlined on the layer by a CSS highlight.
 * A text longer than CONFIG.codeEdit.highlightMaxChars is plain: the
 * textarea's text always shows, the layer stays empty (print fills it), a
 * key does no work on the whole text (G10), the lines typed (known from
 * the input event) make room under the text at once, and the number of
 * lines gives the height. Should the textarea scroll itself (a line
 * longer, or more lines, than the room made), it is made larger at once
 * and the page scrolls instead.
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
 *   highlight(text, language?) -> string|null - highlight.js HTML in a language
 *     (default: the file's); null: not colored
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
    this._typing = false; // edited since the layer was written whole: its offsets wait for the pause
    this._hidden = false; // the layer could not follow an edit: hidden until the pause (TYPING_CLASS)
    this._shown = ""; // the text the layer holds (colored), line by line
    this._lines = []; // a line of the layer: its HTML (its spans closed)
    this._carried = []; // a line of the layer: the highlight.js tags open at its start
    this._blocks = []; // the layer's blocks in order: {el, count} (count: its lines)
    this._composing = null; // {start, end}: the IME composition's text, marked on the layer
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
    this._composing = null;
    this._markComposition();
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
    this._hidden = false;
    this._shown = "";
    this._lines = [];
    this._carried = [];
    this._blocks = [];
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
   * marked on it), or null: the layer does not hold the text now (plain),
   * or the Search's offsets wait for the pause (edited since the layer was
   * written whole).
   * @purity semi-pure-b
   * @param {number} start
   * @param {number} end
   * @returns {Range|null}
   */
  rangeOf(start, end) {
    if (!this._root || this._plain || this._typing) return null;
    return rangeIn(this._code, start, end);
  }

  // ---- internals ----

  /**
   * The DOM of the editor (design 2):
   * #codeEditBody > .code-edit-gutter + .code-edit-stack > (pre.code-edit-layer > code > span.code-edit-block*) + textarea.
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
    input.addEventListener("compositionstart", () => this._onCompositionStart());
    input.addEventListener("compositionend", () => this._onCompositionEnd());
    this._root = root;
    this._gutter = gutter;
    this._stack = stack;
    this._code = code;
    this._input = input;
  }

  /**
   * Typing (or the browser's own edit): the text and the selection go to
   * the undo history (no comparison), the layer follows (colored: the
   * lines touched, found by comparing the text with the layer's; plain:
   * the lines typed make room), and the pause is waited for.
   * @purity non-pure
   * @param {InputEvent|{data: string}|undefined} e
   */
  _onInput(e) {
    const input = this._input;
    const text = input.value;
    const before = this._before;
    this._before = null;
    this._history.recordTyping(text, null, null, before); // the selection after: read when needed
    if (this._composing && e?.inputType === "insertCompositionText" && typeof e.data === "string") {
      this._composing.end = this._composing.start + e.data.length;
    }
    if (this._canFollow(text)) this._followEdit(text, textChange(this._shown, text));
    else this._leaveLayer(lineFeedsIn(this._insertedText(e, text, before)));
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
   * Whether the layer can follow an edit that leaves this text: it holds
   * the colored text (not plain, not hidden) and the text is not over the
   * plain limit (the comparison stays within it).
   * @purity semi-pure-b
   * @param {string} text
   * @returns {boolean}
   */
  _canFollow(text) {
    return !this._plain && !this._hidden && text.length <= CONFIG.codeEdit.highlightMaxChars;
  }

  /**
   * The layer follows an edit at once (INV-86, BI-26): the lines it
   * touched are made again, each colored alone, and only the blocks
   * holding them are written; the other blocks stay as they are. When the
   * touched lines are longer than CONFIG.codeEdit.typedColorMaxChars in
   * all, the edit goes into the layer's colored text instead (_writeInText:
   * no highlight.js; the pause colors it).
   * @purity non-pure
   * @param {string} text - the text after the edit
   * @param {{at: number, removed: string, inserted: string}} change - from the layer's text
   */
  _followEdit(text, change) {
    const { at, removed, inserted } = change;
    const first = lineOfOffset(text, at);
    const replaced = lineFeedsIn(removed) + 1;
    const span = this._blockSpan(first, replaced);
    const start = at === 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
    const next = text.indexOf("\n", at + inserted.length);
    const end = next < 0 ? text.length : next;
    const now = end - start <= CONFIG.codeEdit.typedColorMaxChars;
    if (!span || (!now && !this._writeInText(span, first, change))) {
      this._leaveLayer(lineFeedsIn(inserted) - lineFeedsIn(removed));
      return;
    }
    if (now) {
      this._takeLinesFromLayer(span);
      const carried = this._carried[first] ?? "";
      const scope = carriedScope(carried);
      const lines = text.slice(start, end).split("\n");
      this._lines.splice(first, replaced, ...lines.map((line) => this._lineHtml(line, carried, scope)));
      this._carried.splice(first, replaced, ...lines.map(() => carried));
      this._writeBlocks(span, span.count - replaced + lines.length);
    }
    this._shown = text;
    this._typing = true;
    this._markComposition();
  }

  /**
   * An edit in long lines (INV-86 (b-1), (b-2)): its characters, line
   * feeds too, go into the layer's text as it is colored (the removed ones
   * taken out of the text nodes from the place on, the inserted ones put
   * into the text node there), so the lines keep their colors and no
   * highlight.js runs. Blocks the edit spans become one. The lines' HTML is
   * taken from the layer when a block is written again. A place at a
   * line's start goes into the text node after the line feed before it.
   * @purity non-pure
   * @param {{from: number, to: number, start: number}} span - _blockSpan of the lines
   * @param {number} line - the first line (0-based)
   * @param {{at: number, removed: string, inserted: string}} change - from the layer's text
   * @returns {boolean} false when the layer does not hold the place (nothing usable written)
   */
  _writeInText(span, line, { at, removed, inserted }) {
    const offset = at - lineStartOffset(this._shown, span.start);
    const block = this._joinBlocks(span);
    const walker = document.createTreeWalker(block.el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let seen = 0;
    while (node && seen + node.data.length <= offset) {
      const after = walker.nextNode();
      if (seen + node.data.length === offset && (!node.data.endsWith("\n") || !after)) break;
      seen += node.data.length;
      node = after;
    }
    if (!node) return false;
    walker.currentNode = node;
    // whole values, not insertData / deleteData: Chromium takes about 0.9 s for
    // insertData in a 47 KB line, and no time for a new value (spec 5.19.12)
    const local = offset - seen;
    const here = Math.min(removed.length, node.data.length - local);
    const touched = [node];
    let rest = removed.length - here;
    node.data = node.data.slice(0, local) + inserted + node.data.slice(local + here);
    for (let piece = walker.nextNode(); rest > 0 && piece; piece = walker.nextNode()) {
      const taken = Math.min(rest, piece.data.length);
      piece.data = piece.data.slice(taken);
      rest -= taken;
      touched.push(piece);
    }
    this._dropSearchMarks((node) => touched.includes(node));
    if (rest > 0) return false;
    const lines = lineFeedsIn(inserted) + 1;
    const old = lineFeedsIn(removed) + 1;
    this._lines.splice(line, old, ...Array(lines).fill(null));
    this._carried.splice(line, old, ...Array(lines).fill(this._carried[line] ?? ""));
    block.count += lines - old;
    return true;
  }

  /**
   * The blocks of a span made one (their nodes moved into the first), so
   * an edit over them can go into one block's text. The Search's marks
   * with an end in the nodes moved are taken away first (moving them puts
   * the ends elsewhere).
   * @purity non-pure
   * @param {{from: number, to: number}} span - _blockSpan
   * @returns {{el: Element, count: number}} the block
   */
  _joinBlocks(span) {
    const blocks = this._blocks;
    const block = blocks[span.from];
    const moved = blocks.slice(span.from + 1, span.to + 1).map(({ el }) => el);
    if (moved.length > 0) this._dropSearchMarks((node) => moved.some((el) => el.contains(node)));
    for (let b = span.from + 1; b <= span.to; b++) {
      block.el.append(...blocks[b].el.childNodes);
      blocks[b].el.remove();
      block.count += blocks[b].count;
    }
    blocks.splice(span.from + 1, span.to - span.from);
    return block;
  }

  /**
   * The Search's marks with an end in nodes an edit wrote into or moved
   * are taken away: a new value or a move puts the ends of the ranges
   * elsewhere (the Search marks again when typing stops, INV-86 (4)).
   * @purity non-pure
   * @param {(node: Node) => boolean} touches - whether an end's node was written into or moved
   */
  _dropSearchMarks(touches) {
    const highlights = globalThis.CSS?.highlights;
    if (!highlights) return;
    for (const name of SEARCH_HIGHLIGHTS) {
      const ranges = highlights.get(name);
      if (ranges && [...ranges].some((range) => touches(range.startContainer) || touches(range.endContainer))) highlights.delete(name);
    }
  }

  /**
   * The HTML of lines written into the layer's text (_writeInText) taken
   * back from their blocks (cut into lines with their open tags), so a
   * block can be written again from _lines.
   * @purity non-pure
   * @param {{from: number, to: number, start: number}} span - _blockSpan
   */
  _takeLinesFromLayer(span) {
    let start = span.start;
    for (let b = span.from; b <= span.to; b++) {
      const { el, count } = this._blocks[b];
      if (this._lines.slice(start, start + count).includes(null)) {
        const { lines, carried } = splitHighlightedLines(el.innerHTML);
        for (let n = 0; n < count; n++) {
          if (this._lines[start + n] !== null) continue;
          this._lines[start + n] = lines[n];
          this._carried[start + n] = carried[n] || this._carried[start + n]; // a block cut alone loses the context
        }
      }
      start += count;
    }
  }

  /**
   * The blocks that hold count lines from the line first: the indexes of
   * the first and the last, the line the first starts with, and their
   * lines in all; null when the layer does not hold those lines (a block
   * missing, or taken off the layer).
   * @purity semi-pure-b
   * @param {number} first
   * @param {number} count
   * @returns {{from: number, to: number, start: number, count: number}|null}
   */
  _blockSpan(first, count) {
    const blocks = this._blocks;
    let from = 0;
    let start = 0;
    while (from < blocks.length && start + blocks[from].count <= first) start += blocks[from++].count;
    let to = from;
    let lines = 0;
    for (; to < blocks.length; to++) {
      lines += blocks[to].count;
      if (start + lines >= first + count) break;
    }
    if (to >= blocks.length) return null;
    for (let b = from; b <= to; b++) if (!blocks[b].el.isConnected) return null;
    return { from, to, start, count: lines };
  }

  /**
   * Write the blocks of a span again with its lines now (count of them,
   * from the span's start): one block in place while they fit in it, else
   * new blocks of CONFIG.codeEdit.layerBlockLines lines in their place.
   * @purity non-pure
   * @param {{from: number, to: number, start: number}} span - _blockSpan
   * @param {number} count
   */
  _writeBlocks(span, count) {
    const blocks = this._blocks;
    const size = CONFIG.codeEdit.layerBlockLines;
    const lines = this._lines.slice(span.start, span.start + count);
    const block = blocks[span.from];
    if (span.from === span.to && count <= size) {
      block.el.innerHTML = blockInnerHtml(lines); // highlight.js output and escaped text only (INV-19)
      block.count = count;
      return;
    }
    const fresh = document.createElement("template");
    fresh.innerHTML = blocksHtml(lines, size);
    const written = [...fresh.content.children];
    block.el.before(fresh.content);
    for (let b = span.from; b <= span.to; b++) blocks[b].el.remove();
    blocks.splice(span.from, span.to - span.from + 1, ...written.map((el, i) => ({ el, count: Math.min(size, count - i * size) })));
  }

  /**
   * One line colored alone (INV-86 (b)), in the tags open at its start
   * (carried): inside a scope of text (a comment, a string) in that
   * scope's color; else colored by highlight.js in the innermost
   * sub-language open (or the file's language) and wrapped in those tags.
   * @purity semi-pure-a
   * @param {string} line
   * @param {string} carried - the tags open at the line's start
   * @param {{depth: number, isText: boolean, language: string|null}} scope - carriedScope(carried)
   * @returns {string}
   */
  _lineHtml(line, carried, scope) {
    if (line === "") return "";
    const close = "</span>".repeat(scope.depth);
    if (scope.isText) return carried + escapeHtml(line) + close;
    const html = scope.language ? this._host.highlight(line, scope.language) : this._host.highlight(line);
    return carried + (html ?? escapeHtml(line)) + close;
  }

  /**
   * The layer cannot follow (plain, or the text grew over the plain
   * limit): the lines added make room, and the textarea's text shows until
   * the pause writes the layer again.
   * @purity non-pure
   * @param {number} lines - the lines added (less than 0: removed)
   */
  _leaveLayer(lines) {
    this._addLines(lines);
    this._typing = true;
    if (this._hidden) return;
    this._hidden = true;
    this._root.classList.add(TYPING_CLASS);
    this._markComposition();
  }

  /**
   * An IME composition starts: its text is marked on the colored layer
   * from the selection's start (read once, as at a typing step's start;
   * not on a plain text, where WebKit's read takes time growing with it).
   * @purity non-pure
   */
  _onCompositionStart() {
    if (this._plain || this._hidden) return;
    const start = this._input.selectionStart;
    this._composing = { start, end: start };
  }

  /**
   * The IME composition ends: its mark goes.
   * @purity non-pure
   */
  _onCompositionEnd() {
    this._composing = null;
    this._markComposition();
  }

  /**
   * Underline the IME composition's text on the layer (a CSS highlight
   * over the layer's text, INV-86 (c)), or take the underline away: no
   * composition, an empty one, or a layer that does not hold the text.
   * @purity non-pure
   */
  _markComposition() {
    const highlights = globalThis.CSS?.highlights;
    if (!highlights || typeof Highlight !== "function") return;
    const composing = this._composing;
    const shown = composing && composing.end > composing.start && this._root && !this._plain && !this._hidden;
    const range = shown ? this._lineRange(composing.start, composing.end) : null;
    if (range) highlights.set(COMPOSING_HIGHLIGHT, new Highlight(range));
    else highlights.delete(COMPOSING_HIGHLIGHT);
  }

  /**
   * A DOM range over the layer's text from start to end, within one line
   * (found in its block, not by walking the whole layer); null when the
   * layer does not hold that text.
   * @purity semi-pure-b
   * @param {number} start
   * @param {number} end
   * @returns {Range|null}
   */
  _lineRange(start, end) {
    const text = this._shown;
    if (end > text.length) return null;
    const span = this._blockSpan(lineOfOffset(text, start), 1);
    if (!span) return null;
    const blockStart = lineStartOffset(text, span.start);
    return rangeIn(this._blocks[span.from].el, start - blockStart, end - blockStart);
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
    this._edited(change, text);
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
    let change = null;
    /** @purity non-pure */
    const edit = (at, removed, inserted) => {
      change = { at, removed, inserted };
      return this._writePart(at, removed, inserted);
    };
    const step = redo ? this._history.redo(edit) : this._history.undo(edit);
    if (!step) return false;
    this._input.setSelectionRange(step.selStart, step.selEnd);
    this._edited(change, step.text);
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
   * After the editor's own edit (Undo, Redo, an operation): as typing, the
   * layer follows its changed part (colored: the lines it touched; plain:
   * room for the lines it added, counted in its changed part only) and the
   * pause is waited for.
   * @purity non-pure
   * @param {{at: number, removed: string, inserted: string}} change - the changed part
   * @param {string} text - the text now
   */
  _edited(change, text) {
    if (this._canFollow(text) && this._shown.length - change.removed.length + change.inserted.length === text.length) {
      this._followEdit(text, change);
    } else {
      this._leaveLayer(lineFeedsIn(change.inserted) - lineFeedsIn(change.removed));
    }
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
   * line by line (colored, or plain text when there are no colors) and
   * shown. Plain: the layer is empty, the number of lines gives the height
   * (CSS) and the width is read here once.
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
      this._shown = "";
      this._lines = [];
      this._carried = [];
      this._blocks = [];
      if (style.minWidth === "") style.minWidth = `${this._input.scrollWidth}px`;
    } else {
      const size = CONFIG.codeEdit.layerBlockLines;
      const { lines, carried } = splitHighlightedLines(this._host.highlight(text) ?? escapeHtml(text));
      this._code.innerHTML = blocksHtml(lines, size); // highlight.js output and escaped text only (INV-19)
      this._shown = text;
      this._lines = lines;
      this._carried = carried;
      this._blocks = [...this._code.children].map((el, i) => ({ el, count: Math.min(size, lines.length - i * size) }));
      style.minWidth = "";
    }
    this._typing = false;
    if (this._hidden) {
      this._hidden = false;
      this._root.classList.remove(TYPING_CLASS);
    }
    this._markComposition();
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
