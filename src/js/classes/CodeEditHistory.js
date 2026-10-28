/**
 * The change between two texts: the common prefix and suffix are left out,
 * so a step stores only the part that changed (linear in the texts).
 * @purity pure
 * @param {string} before
 * @param {string} after
 * @returns {{at: number, removed: string, inserted: string}}
 */
function textChange(before, after) {
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < limit - prefix && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix++;
  return {
    at: prefix,
    removed: before.slice(prefix, before.length - suffix),
    inserted: after.slice(prefix, after.length - suffix),
  };
}

/**
 * The text with a change applied forward (removed -> inserted) or back.
 * @purity pure
 * @param {string} text
 * @param {{at: number, removed: string, inserted: string}} change
 * @param {boolean} forward
 * @returns {string}
 */
function applyChange(text, change, forward) {
  const from = forward ? change.removed : change.inserted;
  const to = forward ? change.inserted : change.removed;
  return text.slice(0, change.at) + to + text.slice(change.at + from.length);
}

/**
 * Undo and Redo of the code editor (NE-7, NE-18, NE-26): its own history,
 * not the browser's. A typing step lasts until typing pauses for pauseMs
 * or the caret moves; each whole operation (replace, replace all, indent,
 * fold) is one step. At most `limit` steps are kept (the oldest dropped);
 * a new record clears Redo.
 *
 * A closed step stores only the changed part (textChange). The open typing
 * step keeps the text from before it, so typing costs no diff per key; it
 * is turned into a change when it closes.
 */
export default class CodeEditHistory {
  /**
   * @purity non-pure
   * @param {{limit?: number, pauseMs?: number, now?: () => number}} [options]
   *   limit: steps kept (30); pauseMs: a typing pause that ends a step
   *   (1000, NE-26); now: the clock in ms (Date.now)
   */
  constructor(options = {}) {
    this._limit = options.limit ?? 30;
    this._pauseMs = options.pauseMs ?? 1000;
    this._now = options.now ?? (() => Date.now());
    this.reset("", 0, 0);
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
    this._undo = []; // closed steps: {change, beforeSel, afterSel}
    this._redo = [];
    this._open = null; // the open typing step: {beforeText, beforeSel, lastTime}
  }

  /**
   * Typing: joins the open typing step unless pauseMs passed since its
   * last record or the caret moved since (noteCaretMove).
   * @purity non-pure
   * @param {string} text
   * @param {number} selStart
   * @param {number} selEnd
   */
  recordTyping(text, selStart, selEnd) {
    const now = this._now();
    if (text === this._text) {
      this._sel = [selStart, selEnd];
      return;
    }
    if (this._open && now - this._open.lastTime >= this._pauseMs) this._closeOpen();
    // the limit is applied when the step closes (every undo closes it first)
    if (!this._open) this._open = { beforeText: this._text, beforeSel: this._sel, lastTime: now };
    this._open.lastTime = now;
    this._text = text;
    this._sel = [selStart, selEnd];
    this._redo = [];
  }

  /**
   * One whole operation (replace, replace all, indent, fold): its own step.
   * @purity non-pure
   * @param {string} text
   * @param {number} selStart
   * @param {number} selEnd
   */
  recordOperation(text, selStart, selEnd) {
    this._closeOpen();
    if (text !== this._text) {
      this._undo.push({ change: textChange(this._text, text), beforeSel: this._sel, afterSel: [selStart, selEnd] });
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
   * @purity semi-pure-b
   * @returns {boolean} true when there is a step to undo
   */
  canUndo() {
    return this._open !== null || this._undo.length > 0;
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean} true when there is a step to redo
   */
  canRedo() {
    return this._redo.length > 0;
  }

  /**
   * Undo one step.
   * @purity non-pure
   * @returns {{text: string, selStart: number, selEnd: number}|null} the text and selection before the step
   */
  undo() {
    this._closeOpen();
    const step = this._undo.pop();
    if (!step) return null;
    this._redo.push(step);
    this._text = applyChange(this._text, step.change, false);
    this._sel = step.beforeSel;
    return { text: this._text, selStart: step.beforeSel[0], selEnd: step.beforeSel[1] };
  }

  /**
   * Redo one step.
   * @purity non-pure
   * @returns {{text: string, selStart: number, selEnd: number}|null} the text and selection after the step
   */
  redo() {
    const step = this._redo.pop();
    if (!step) return null;
    this._undo.push(step);
    this._text = applyChange(this._text, step.change, true);
    this._sel = step.afterSel;
    return { text: this._text, selStart: step.afterSel[0], selEnd: step.afterSel[1] };
  }

  /**
   * Close the open typing step into a stored change.
   * @purity non-pure
   */
  _closeOpen() {
    if (!this._open) return;
    const open = this._open;
    this._open = null;
    if (open.beforeText === this._text) return;
    this._undo.push({ change: textChange(open.beforeText, this._text), beforeSel: open.beforeSel, afterSel: this._sel });
    this._trim(this._limit);
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
