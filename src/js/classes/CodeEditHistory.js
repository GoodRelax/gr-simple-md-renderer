// Below this many chars a common part is compared char by char; above it,
// in blocks compared as strings (native code), galloping (N1).
const BLOCK_CHARS = 256;

/**
 * The length of the common part of a and b at their starts (atEnd false)
 * or at their ends (atEnd true), at most limit. Blocks are compared whole,
 * doubling while they match and halving once one does not, so the work is
 * linear in the common part with a small factor (no char loop over it).
 * @purity pure
 * @param {string} a
 * @param {string} b
 * @param {number} limit
 * @param {boolean} atEnd
 * @returns {number}
 */
function commonLength(a, b, limit, atEnd) {
  const blockOf = (s, from, size) => (atEnd ? s.slice(s.length - from - size, s.length - from) : s.slice(from, from + size));
  const charOf = (s, i) => (atEnd ? s.charCodeAt(s.length - 1 - i) : s.charCodeAt(i));
  let n = 0;
  let hi = limit; // the common part is at most this long
  let size = BLOCK_CHARS;
  while (hi - n > BLOCK_CHARS) {
    const m = Math.min(size, hi - n);
    if (blockOf(a, n, m) === blockOf(b, n, m)) {
      n += m;
      size = m * 2;
    } else {
      hi = n + m - 1;
      size = Math.ceil(m / 2);
    }
  }
  while (n < hi && charOf(a, n) === charOf(b, n)) n++;
  return n;
}

/**
 * The change between two texts: the common prefix and suffix are left out,
 * so a step stores only the part that changed (linear in the common parts,
 * compared in blocks: N1).
 * @purity pure
 * @param {string} before
 * @param {string} after
 * @returns {{at: number, removed: string, inserted: string}}
 */
export function textChange(before, after) {
  const limit = Math.min(before.length, after.length);
  const prefix = commonLength(before, after, limit, false);
  const suffix = commonLength(before, after, limit - prefix, true);
  return {
    at: prefix,
    removed: before.slice(prefix, before.length - suffix),
    inserted: after.slice(prefix, after.length - suffix),
  };
}

/**
 * Undo and Redo of the code editor (NE-7, NE-18, NE-26): its own history,
 * not the browser's. A typing step lasts until typing pauses for pauseMs
 * or the caret moves; each whole operation (replace, replace all, indent,
 * fold) is one step. At most `limit` steps are kept (the oldest dropped);
 * a new record clears Redo. Undo puts back the text and the selection of
 * the moment the step began (INV-88 (3)); Redo the selection after it.
 *
 * A key costs no work on the whole text (G10, M1): a typing record keeps
 * the text given (no comparison), and a typing step that ends keeps its
 * texts until settle() (the typing pause) turns it into the changed part
 * (textChange) and drops it when nothing changed. Until then canUndo() is
 * true for a step that may have changed nothing; settle() makes it exact.
 * Nor does a key read the selection (WebKit takes time growing with the
 * text for it): a typing record may leave it unknown (null), and it is
 * read through readSelectionWith's reader when a step needs it.
 */
export default class CodeEditHistory {
  /**
   * @purity non-pure
   * @param {{now: () => number, limit?: number, pauseMs?: number}} options
   *   now: the clock in ms (given by the caller); limit: steps kept (30);
   *   pauseMs: a typing pause that ends a step (1000, NE-26)
   */
  constructor(options) {
    if (typeof options?.now !== "function") throw new TypeError("CodeEditHistory needs a clock (options.now)");
    this._limit = options.limit ?? 30;
    this._pauseMs = options.pauseMs ?? 1000;
    this._now = options.now;
    this._readSelection = null; // () => [start, end]: the selection now (the editor's)
    this.reset("", 0, 0);
  }

  /**
   * Where the selection is read when a typing record left it unknown
   * (null: nowhere; then [0, 0]).
   * @purity non-pure
   * @param {(() => number[])|null} read
   */
  readSelectionWith(read) {
    this._readSelection = read;
  }

  /**
   * True when the next typing record begins a new step (none open, or the
   * pause passed): its selection before is wanted then.
   * @purity semi-pure-b
   * @returns {boolean}
   */
  startsStep() {
    return this._open === null || this._now() - this._open.lastTime >= this._pauseMs;
  }

  /**
   * Start over with a text: no Undo, no Redo.
   * @purity non-pure
   * @param {string} text
   * @param {number} selStart
   * @param {number} selEnd
   */
  reset(text, selStart, selEnd) {
    this._text = text;
    this._sel = [selStart, selEnd];
    // closed steps: {change, beforeSel, afterSel}, or until settle() /
    // undo() {beforeText, afterText, beforeSel, afterSel}
    this._undo = [];
    this._redo = [];
    // the open typing step: {beforeText, beforeSel, lastTime, changed}
    // (changed: null until settle() compares, then true / false)
    this._open = null;
  }

  /**
   * The selection now, without typing (the caret placed when editing
   * starts, a selection made): the next typing step begins from it.
   * @purity non-pure
   * @param {number} selStart
   * @param {number} selEnd
   */
  noteSelection(selStart, selEnd) {
    this._closeOpen();
    this._sel = [selStart, selEnd];
  }

  /**
   * Typing: joins the open typing step unless pauseMs passed since its
   * last record or the caret moved since (noteCaretMove). No comparison of
   * texts (an input event changes the text).
   * @purity non-pure
   * @param {string} text
   * @param {number|null} selStart - null: not known now (read when needed)
   * @param {number|null} selEnd
   * @param {number[]|null} [before] - the selection just before this input
   *   ([start, end]); a new step begins from it (INV-88 (3)); null: the last known
   */
  recordTyping(text, selStart, selEnd, before = null) {
    const now = this._now();
    // the step the pause ended closes with the selection before this input
    if (this._open && now - this._open.lastTime >= this._pauseMs) this._closeOpen(before);
    // the limit is applied when the step closes (every undo closes it first)
    if (!this._open) this._open = { beforeText: this._text, beforeSel: before ?? this._selection(), lastTime: now, changed: null };
    this._open.lastTime = now;
    this._open.changed = null;
    this._text = text;
    this._sel = selStart === null ? null : [selStart, selEnd];
    this._redo = [];
  }

  /**
   * One whole operation (replace, replace all, indent, fold): its own step.
   * Given its changed part (the editor knows it), the texts are not
   * compared (N1: no work on the whole text); else they are (textChange).
   * @purity non-pure
   * @param {string} text - the text after it
   * @param {number} selStart
   * @param {number} selEnd
   * @param {number[]|null} [before] - the selection just before it ([start, end]),
   *   which Undo puts back (INV-88 (3)); null: the last known
   * @param {{at: number, removed: string, inserted: string}|null} [change] - its
   *   changed part; null: compared here
   */
  recordOperation(text, selStart, selEnd, before = null, change = null) {
    this._closeOpen();
    const step = change ?? (text === this._text ? null : textChange(this._text, text));
    if (step && step.removed !== step.inserted) {
      this._undo.push({ change: step, beforeSel: before ?? this._selection(), afterSel: [selStart, selEnd] });
      this._trim(this._limit);
      this._redo = [];
    }
    this._text = text;
    this._sel = [selStart, selEnd];
  }

  /**
   * The caret moved without typing: the next typing starts a new step.
   * @purity non-pure
   */
  noteCaretMove() {
    this._closeOpen();
  }

  /**
   * The typing pause (the work kept off the keys): the steps closed since
   * are turned into their changed parts or dropped when nothing changed,
   * and the open step is compared with the text before it.
   * @purity non-pure
   */
  settle() {
    this._undo = this._undo.filter((step) => this._compact(step));
    if (this._open && this._open.changed === null) this._open.changed = this._open.beforeText !== this._text;
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean} true when there is a step to undo (exact after settle())
   */
  canUndo() {
    return this._undo.length > 0 || (this._open !== null && this._open.changed !== false);
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean} true when there is a step to redo
   */
  canRedo() {
    return this._redo.length > 0;
  }

  /**
   * Undo one step (a step that changed nothing is skipped). The step's
   * changed part is put back through edit (the editor's textarea: only
   * that part is written, N1), which gives the text after it.
   * @purity non-pure
   * @param {((at: number, removed: string, inserted: string) => string)|null} [edit] -
   *   the part from at, removed, becomes inserted; null: the edit is made on the text kept here
   * @returns {{text: string, selStart: number, selEnd: number}|null} the text and selection before the step
   */
  undo(edit = null) {
    this._closeOpen();
    let step = this._undo.pop();
    while (step && !this._compact(step)) step = this._undo.pop();
    if (!step) return null;
    this._redo.push(step);
    const { at, removed, inserted } = step.change;
    this._text = this._edit(edit, at, inserted, removed);
    this._sel = step.beforeSel;
    return { text: this._text, selStart: step.beforeSel[0], selEnd: step.beforeSel[1] };
  }

  /**
   * Redo one step (as undo, forward).
   * @purity non-pure
   * @param {((at: number, removed: string, inserted: string) => string)|null} [edit]
   * @returns {{text: string, selStart: number, selEnd: number}|null} the text and selection after the step
   */
  redo(edit = null) {
    const step = this._redo.pop();
    if (!step) return null;
    this._undo.push(step);
    const { at, removed, inserted } = step.change;
    this._text = this._edit(edit, at, removed, inserted);
    this._sel = step.afterSel;
    return { text: this._text, selStart: step.afterSel[0], selEnd: step.afterSel[1] };
  }

  /**
   * One edit of an Undo or Redo: by the editor's edit, or on the text kept.
   * @purity non-pure
   * @param {Function|null} edit
   * @param {number} at
   * @param {string} removed
   * @param {string} inserted
   * @returns {string} the text after it
   */
  _edit(edit, at, removed, inserted) {
    return edit ? edit(at, removed, inserted) : this._text.slice(0, at) + inserted + this._text.slice(at + removed.length);
  }

  /**
   * The selection last known, read now when a typing record left it unknown.
   * @purity non-pure
   * @returns {number[]}
   */
  _selection() {
    if (this._sel === null) this._sel = this._readSelection?.() ?? [0, 0];
    return this._sel;
  }

  /**
   * Close the open typing step; it keeps its texts until settle() or undo().
   * @purity non-pure
   * @param {number[]|null} [afterSel] - the selection after it; null: the last known
   */
  _closeOpen(afterSel = null) {
    if (!this._open) return;
    const open = this._open;
    this._open = null;
    const after = afterSel ?? this._selection();
    if (open.changed === false) return;
    this._undo.push({ beforeText: open.beforeText, afterText: this._text, beforeSel: open.beforeSel, afterSel: after });
    this._trim(this._limit);
  }

  /**
   * A closed step as its changed part (done once).
   * @purity non-pure
   * @param {object} step
   * @returns {boolean} false: the step changed nothing
   */
  _compact(step) {
    if (step.change) return true;
    if (step.beforeText === step.afterText) return false;
    step.change = textChange(step.beforeText, step.afterText);
    delete step.beforeText;
    delete step.afterText;
    return true;
  }

  /**
   * Drop the oldest closed steps beyond max.
   * @purity non-pure
   * @param {number} max
   */
  _trim(max) {
    if (this._undo.length > max) this._undo.splice(0, this._undo.length - max);
  }
}
