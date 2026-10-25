// Search and replace (INV-80, owner rulings S1 to S14, 2026-10-25): a panel
// above the Index at the right edge of the view. The Markdown view searches
// the document's source (the model's body), the code view the file's text.
// Replacing is for the edit mode of the Markdown view only; one replace, or
// one replace of all, is one change for Undo (INV-48).

import { placeSidePanels } from "../sidePanels.js";
import { searchPattern, findMatches, occurrences, countOccurrences, replaceOne, replaceAll } from "../textSearch.js";
import { nextFrame, cancelFrame } from "../utils.js";

/** The most matches counted and visited; Replace all replaces every one. */
const MAX_MATCHES = 10000;
/** The most marks put on the text of one block or line (more when the current match is further on). */
const MAX_MARKS = 100;
/** The names of the CSS highlights (style.css ::highlight): the other places, and the current one. */
const HIGHLIGHT = "grsmd-search";
const HIGHLIGHT_CURRENT = "grsmd-search-current";
/** Typing moves the view to the first match when it stops for this long (G10: a key costs little). */
export const TYPING_PAUSE_MS = 150;
/** A regular expression is searched when typing stops for this long (owner ruling S13). */
export const REGEX_TYPING_PAUSE_MS = 300;
/** Where a match is scrolled to: a quarter of what is shown down, at least this far below its top. */
const REVEAL_RATIO = 0.25;
const REVEAL_MIN_PX = 8;

/**
 * Ranges over the rendered text of element where it reads text, at least
 * atLeast of them when there are. The rendered text may differ from the
 * source (markup), then there is none.
 * @purity semi-pure-a
 * @param {HTMLElement} element
 * @param {string} text
 * @param {boolean} matchCase
 * @param {number} atLeast
 * @returns {Range[]}
 */
function textRanges(element, text, matchCase, atLeast) {
  if (text === "") return [];
  const nodes = [];
  let joined = "";
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node, start: joined.length });
    joined += node.data;
  }
  const hay = matchCase ? joined : joined.toLowerCase();
  const needle = matchCase ? text : text.toLowerCase();
  const ranges = [];
  let i = 0;
  /** @purity non-pure */
  const point = (offset, isEnd) => {
    while (i + 1 < nodes.length && (isEnd ? nodes[i + 1].start < offset : nodes[i + 1].start <= offset)) i++;
    return [nodes[i].node, offset - nodes[i].start];
  };
  const most = Math.max(MAX_MARKS, atLeast);
  for (const at of occurrences(hay, needle)) {
    if (ranges.length >= most) break;
    const range = document.createRange();
    range.setStart(...point(at, false));
    range.setEnd(...point(at + needle.length, true));
    ranges.push(range);
  }
  return ranges;
}

export default class DocumentSearch {
  /**
   * @param {object} elements - button, column, panel, preview, input,
   *   matchCase, regex, count, prev, next, close, replaceRow, replaceInput,
   *   replaceOne, replaceAll
   * @param {ScrollMemento} scrollMemento - where the view is and how it scrolls
   * @param {object} documents - getModel() (MarkdownBlockModel|null),
   *   blockElement(blockId), replaceBody(text, offset) -> Promise
   * @param {object} host - beforeReplace(): boolean (commits the open
   *   edits first; false: replace nothing), toast(message)
   * @param {object} messages - CONFIG.messages.search
   * @purity non-pure
   */
  constructor(elements, scrollMemento, documents, host, messages) {
    this.el = elements;
    this.scrollMemento = scrollMemento;
    this.documents = documents;
    this.host = host;
    this.messages = messages;
    this._mode = "initial";
    this._pattern = null; // the pattern of the matches, or null: none (an empty query, or an invalid one: _invalid)
    this._invalid = false; // the query is not a valid regular expression
    this._searched = null; // the conditions of the matches ({query, isRegex, matchCase}), or null: not searched for this text
    this._stale = false; // the text changed after a regular expression search, which is not run again by itself (M2)
    this._text = ""; // the text the matches are in
    this._matches = [];
    this._current = -1; // the index of the match gone to, or -1: none yet
    this._hit = null; // the block or line marked, or null: none
    this._typingTimer = 0; // the move (or the regular expression search) after typing stops, or 0: none
    this._pendingSteps = 0; // next / previous presses not yet moved to (negative: back)
    this._stepFrame = 0; // the frame that moves (a nextFrame id), or 0: none asked for
    this._onResize = () => placeSidePanels(this.el.column, this.scrollMemento);
    this._wire();
  }

  /** @purity non-pure */
  _wire() {
    const el = this.el;
    el.button.addEventListener("click", () => (this.isShown() ? this.hide() : this.open()));
    el.close.addEventListener("click", () => this.hide());
    el.prev.addEventListener("click", () => this._queueStep(-1));
    el.next.addEventListener("click", () => this._queueStep(1));
    el.replaceOne.addEventListener("click", () => this._replace(false));
    el.replaceAll.addEventListener("click", () => this._replace(true));
    for (const toggle of [el.matchCase, el.regex]) {
      /** @purity non-pure */
      toggle.addEventListener("click", () => {
        toggle.setAttribute("aria-pressed", String(!this._isOn(toggle)));
        this._cancelPending();
        this._search();
      });
    }
    // A key costs only the search (G10); the view moves when typing stops.
    // A regular expression is searched only then (owner ruling S13): a slow
    // one does not block each key typed.
    /** @purity non-pure */
    el.input.addEventListener("input", () => {
      this._cancelPending();
      this._stale = false;
      if (this._isOn(el.regex)) {
        this._showCount();
        this._typingTimer = setTimeout(() => this._search(), REGEX_TYPING_PAUSE_MS);
        return;
      }
      this._run();
      this._showCount();
      this._typingTimer = setTimeout(() => this._step(1), TYPING_PAUSE_MS);
    });
    // Down / Up: next / previous (owner ruling S7). Enter does nothing in
    // either field (S7, S12: it is pressed by mistake); Esc closes the panel
    // at once (S11).
    /** @purity non-pure */
    el.panel.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return; // the IME's own keys (choosing, canceling)
      if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target === el.input) {
        e.preventDefault();
        this._queueStep(e.key === "ArrowDown" ? 1 : -1);
      }
    });
  }

  /** @purity semi-pure-a */
  isShown() {
    return !this.el.panel.hidden;
  }

  /**
   * @param {'initial'|'markdown'|'code'} mode
   * @purity non-pure
   */
  setMode(mode) {
    this._mode = mode;
    this.el.button.disabled = mode === "initial";
    this.el.replaceRow.hidden = mode !== "markdown";
    if (mode === "initial") this.hide();
    else if (this.isShown()) this.refresh();
  }

  /**
   * Replacing is for the edit mode only (owner ruling 2026-10-25).
   * @param {boolean} canReplace
   * @purity non-pure
   */
  setReplaceEnabled(canReplace) {
    for (const control of [this.el.replaceInput, this.el.replaceOne, this.el.replaceAll]) control.disabled = !canReplace;
  }

  /**
   * Show the panel, or bring the focus back to it; the query is selected.
   * @purity non-pure
   */
  open() {
    if (this.el.button.disabled) return;
    if (!this.isShown()) {
      this.el.panel.hidden = false;
      this.el.button.setAttribute("aria-expanded", "true");
      this._onResize();
      window.addEventListener("resize", this._onResize);
      this.refresh();
    }
    this.el.input.focus();
    this.el.input.select();
  }

  /** @purity non-pure */
  hide() {
    if (!this.isShown()) return;
    if (this.el.panel.contains(document.activeElement)) document.activeElement.blur();
    this._cancelPending();
    this._clearHit();
    window.removeEventListener("resize", this._onResize);
    this.el.panel.hidden = true;
    this.el.button.setAttribute("aria-expanded", "false");
  }

  /**
   * The document changed (a commit, an Undo, a new document): a plain query
   * is searched again (nothing scrolls). A regular expression is not run by
   * itself (a slow one would block the page at each commit, M2): its
   * matches are dropped and the count says Down searches again. An invalid
   * one stays invalid, whatever the text.
   * @purity non-pure
   */
  refresh() {
    if (!this.isShown() || this._searched === null || this._invalid || this._documentText() === this._text) return this._showCount();
    if (this._searched.isRegex) {
      this._dropMatches();
      this._stale = true;
    } else {
      this._searchAgain();
    }
    this._showCount();
  }

  // ---- internals ----

  /** @purity semi-pure-a */
  _isOn(toggle) {
    return toggle.getAttribute("aria-pressed") === "true";
  }

  /**
   * The conditions of a search as the panel reads now.
   * @purity semi-pure-a
   * @returns {{query: string, isRegex: boolean, matchCase: boolean}}
   */
  _conditions() {
    return { query: this.el.input.value, isRegex: this._isOn(this.el.regex), matchCase: this._isOn(this.el.matchCase) };
  }

  /**
   * @purity pure
   * @param {{query: string, isRegex: boolean, matchCase: boolean}} a
   * @param {{query: string, isRegex: boolean, matchCase: boolean}} b
   * @returns {boolean}
   */
  static _same(a, b) {
    return a.query === b.query && a.isRegex === b.isRegex && a.matchCase === b.matchCase;
  }

  /**
   * The matches are of the conditions as they are now.
   * @purity semi-pure-a
   */
  _isSearched() {
    return this._searched !== null && DocumentSearch._same(this._searched, this._conditions());
  }

  /**
   * The text searched: the Markdown source, or the code view's lines.
   * @purity semi-pure-a
   */
  _documentText() {
    if (this._mode === "markdown") return this.documents.getModel()?.toBody() ?? "";
    return Array.from(this._codeLines(), (line) => line.textContent).join("\n");
  }

  /** @purity semi-pure-a */
  _codeLines() {
    return this.el.preview.querySelector("#codeViewBody")?.children ?? [];
  }

  /**
   * Find the matches of the query as it is now (no scrolling).
   * @purity non-pure
   */
  _run() {
    this._clearHit();
    const conditions = this._conditions();
    this._searched = conditions;
    this._stale = false;
    this._text = this._documentText();
    this._current = -1;
    this._invalid = false;
    try {
      this._pattern = searchPattern(conditions.query, conditions);
    } catch {
      this._pattern = null;
      this._invalid = true;
    }
    this._matches = this._pattern ? findMatches(this._text, this._pattern, MAX_MATCHES) : [];
    return !this._invalid;
  }

  /**
   * Search the changed text with the same conditions, keeping the place of
   * the match gone to.
   * @purity non-pure
   */
  _searchAgain() {
    const current = this._current;
    this._run();
    this._current = Math.min(current, this._matches.length - 1);
  }

  /** @purity non-pure */
  _dropMatches() {
    this._clearHit();
    this._searched = null;
    this._pattern = null;
    this._invalid = false;
    this._matches = [];
    this._current = -1;
  }

  /** A new query: search and go to the first match. @purity non-pure */
  _search() {
    if (this._run()) this._step(1);
    else this._showCount();
  }

  /** @purity non-pure */
  _showCount() {
    const total = this._matches.length;
    const count = this.el.count;
    if (!this._isSearched()) count.textContent = this._stale ? this.messages.stale : "";
    else if (this._invalid) count.textContent = this.messages.invalid;
    else if (!this._pattern) count.textContent = "";
    else if (total === 0) count.textContent = this.messages.none;
    else count.textContent = this.messages.count(this._current + 1, total >= MAX_MATCHES ? `${total}+` : `${total}`);
  }

  /**
   * A next / previous press: the presses of one frame (a held key repeats)
   * move the view once (G10).
   * @param {number} direction - 1 or -1
   * @purity non-pure
   */
  _queueStep(direction) {
    clearTimeout(this._typingTimer);
    this._pendingSteps += direction;
    if (this._stepFrame) return;
    /** @purity non-pure */
    this._stepFrame = nextFrame(() => {
      this._stepFrame = 0;
      const steps = this._pendingSteps;
      this._pendingSteps = 0;
      if (steps !== 0) this._step(steps);
    });
  }

  /** @purity non-pure */
  _cancelPending() {
    clearTimeout(this._typingTimer);
    cancelFrame(this._stepFrame);
    this._stepFrame = 0;
    this._pendingSteps = 0;
  }

  /**
   * Move by steps matches (negative: back), round the ends. With no match
   * chosen yet, forward starts at the first and back at the last.
   * @param {number} steps
   * @purity non-pure
   */
  _step(steps) {
    if (!this._isSearched() && !this._run()) return this._showCount();
    const total = this._matches.length;
    if (total > 0) {
      const from = this._current >= 0 ? this._current : steps > 0 ? -1 : 0;
      this._current = (((from + steps) % total) + total) % total;
      this._go(this._matches[this._current]);
    }
    this._showCount();
  }

  /**
   * Mark the block (or line) of match and color its text where the rendered
   * text reads the same: the current match in its own color. The match is
   * the n-th place of its text from where the block (or line) starts, so the
   * n-th place in the rendered text is the one scrolled to a quarter of the
   * view (a wide table also scrolls sideways). A match the rendered text
   * does not read the same goes to its table row, or to the block.
   * @purity non-pure
   */
  _go(match) {
    this._clearHit();
    const place = this._mode === "code" ? this._codePlace(match) : this._blockPlace(match);
    if (!place) return;
    const { element, start } = place;
    element.classList.add("search-hit");
    this._hit = element;
    const matchCase = this._isOn(this.el.matchCase);
    const fold = (text) => (matchCase ? text : text.toLowerCase());
    const before = this._text.slice(start, match.index);
    const nth = countOccurrences(fold(before), fold(match[0]));
    const ranges = textRanges(element, match[0], matchCase, nth + 1);
    const current = ranges[nth] ?? null;
    if (typeof Highlight === "function") {
      CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges.filter((range) => range !== current)));
      if (current) CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(current));
    }
    const target = current ?? this._tableRow(element, before) ?? element;
    const box = current ? current.startContainer.parentElement : target;
    box.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    const shown = window.innerHeight - this.scrollMemento.shownTop();
    this.scrollMemento.scrollTargetTo(target, Math.max(REVEAL_MIN_PX, REVEAL_RATIO * shown));
  }

  /**
   * The block of a match in the Markdown view, and where it starts.
   * @purity semi-pure-a
   * @returns {{element: HTMLElement, start: number}|null}
   */
  _blockPlace(match) {
    const model = this.documents.getModel();
    const id = model ? model.blockIdAt(match.index) : null;
    const element = id === null ? null : this.documents.blockElement(id);
    return element ? { element, start: model.startOffsetOf(id) } : null;
  }

  /**
   * The line of a match in the code view, and where it starts.
   * @purity semi-pure-a
   * @returns {{element: HTMLElement, start: number}|null}
   */
  _codePlace(match) {
    let line = 0;
    let start = 0;
    for (let at = this._text.indexOf("\n"); at >= 0 && at < match.index; at = this._text.indexOf("\n", at + 1)) {
      line++;
      start = at + 1;
    }
    const element = this._codeLines()[line];
    return element ? { element, start } : null;
  }

  /**
   * The row of a table block for a source line: the header for the first
   * two lines (the header and the delimiter row), then one row a line.
   * @purity semi-pure-a
   * @param {HTMLElement} element
   * @param {string} before - the block's source up to the match
   * @returns {HTMLTableRowElement|null}
   */
  _tableRow(element, before) {
    const table = element.querySelector("table");
    if (!table) return null;
    const line = countOccurrences(before, "\n");
    return table.rows[line < 2 ? 0 : line - 1] ?? null;
  }

  /** @purity non-pure */
  _clearHit() {
    this._hit?.classList.remove("search-hit");
    this._hit = null;
    if (typeof Highlight === "function") {
      CSS.highlights.delete(HIGHLIGHT);
      CSS.highlights.delete(HIGHLIGHT_CURRENT);
    }
  }

  /**
   * Replace the current match (the first press only finds one), or all.
   * The open block editor or cell is committed first; one Undo takes the
   * replace back.
   * @purity non-pure
   */
  _replace(all) {
    if (this._mode !== "markdown" || this.el.replaceOne.disabled) return;
    this._cancelPending();
    const pressed = this._conditions();
    const current = this._isSearched() ? this._current : -1;
    if (!this.host.beforeReplace()) return;
    // the commit may have changed the text; a regular expression is then
    // not searched again by itself (M2), the press searches it
    if (!this._isSearched() || this._documentText() !== this._text) {
      this._run();
      this._current = Math.min(current, this._matches.length - 1);
    }
    if (!this._pattern || this._matches.length === 0) return this._showCount();
    const isRegex = pressed.isRegex;
    const template = this.el.replaceInput.value;
    if (all) {
      const at = this._matches[Math.max(this._current, 0)].index;
      const { text, count } = replaceAll(this._text, this._pattern, template, isRegex);
      void this.documents.replaceBody(text, at);
      this.host.toast(this.messages.replaced(count));
      return;
    }
    if (this._current < 0) return this._step(1);
    const match = this._matches[this._current];
    const text = replaceOne(this._text, match, this._pattern, template, isRegex);
    // the next match starts after the replacement (it may match again)
    const after = match.index + text.length - this._text.length + match[0].length;
    /** @purity non-pure */
    void this.documents.replaceBody(text, match.index).then(() => {
      // closed, or another query since the press: nothing more (review L8)
      if (!this.isShown() || !DocumentSearch._same(pressed, this._conditions())) return;
      // refresh() (the model changed) searched a plain query again by now
      if (!this._isSearched() || this._documentText() !== this._text) this._run();
      const next = this._matches.findIndex((m) => m.index >= after);
      this._current = (next < 0 ? 0 : next) - 1;
      this._step(1);
    });
  }
}
