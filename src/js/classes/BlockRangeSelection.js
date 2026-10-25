import { CONFIG } from "../config.js";
import { nextFrame, isTypingTarget } from "../utils.js";
import { placementNearLine } from "../floatingPlacement.js";

// Tooltips and aria-labels (config.js, owner ruling U1)
const RANGE_MESSAGES = CONFIG.messages.blockRange;

// The class on the wrappers of the blocks in the range (the frame)
const RANGE_CLASS = "md-block-range";

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';

// Icons as the palette's (spec 5.15.3): inlined in each button, no <use>
// (a user-written id in the preview must not change them).
const ICONS = {
  delete: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/></svg>`,
  cut: `<svg viewBox="0 0 24 24" ${STROKE}><circle cx="6.5" cy="17.5" r="3"/><circle cx="17.5" cy="17.5" r="3"/><path d="M8.6 15.4L19 3.5M15.4 15.4L5 3.5"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" ${STROKE}><rect x="8.5" y="8" width="11.5" height="13" rx="1.5"/><path d="M15.5 8V4.5A1.5 1.5 0 0 0 14 3H5.5A1.5 1.5 0 0 0 4 4.5V15a1.5 1.5 0 0 0 1.5 1.5h3"/></svg>`,
  check: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2.2"/></svg>`,
};

const KINDS = ["delete", "cut", "copy"];

// Where a selection end is never a block range end (INV-74 (1), ruling U5):
// an editor, a cell, a gap editor or another text entry.
const ENTRY_SELECTOR = "textarea, input, select, .md-block-editing, .md-block-gap";

/**
 * The node holds something a reader sees: text that is not only white
 * space, or an element (not a table's tab, which is a control).
 * @purity semi-pure-b
 * @param {Node} node
 * @param {(node: Node) => boolean} isTab
 * @returns {boolean}
 */
function hasContent(node, isTab) {
  if (node.nodeType === Node.TEXT_NODE) return node.data.trim() !== "";
  return node.nodeType === Node.ELEMENT_NODE && !isTab(node);
}

/**
 * Nothing a reader sees lies between the start of wrapper and the point
 * (container, offset) (or, with after true, between the point and the end
 * of wrapper): the point is at the very start (end) of the block.
 * @purity semi-pure-b
 * @param {Element} wrapper
 * @param {Node} container
 * @param {number} offset
 * @param {boolean} after
 * @param {(node: Node) => boolean} isTab
 * @returns {boolean}
 */
function isAtEdge(wrapper, container, offset, after, isTab) {
  if (container.nodeType === Node.TEXT_NODE) {
    const part = after ? container.data.slice(offset) : container.data.slice(0, offset);
    if (part.trim() !== "") return false;
  } else {
    const children = [...container.childNodes];
    const part = after ? children.slice(offset) : children.slice(0, offset);
    if (part.some((child) => hasContent(child, isTab))) return false;
  }
  for (let node = container; node && node !== wrapper; node = node.parentNode) {
    for (let s = after ? node.nextSibling : node.previousSibling; s; s = after ? s.nextSibling : s.previousSibling) {
      if (hasContent(s, isTab)) return false;
    }
  }
  return true;
}

/**
 * Shows the selection of edit mode as a block range (INV-74, owner rulings
 * D1 to D14): the top-level blocks (INV-41) the text a mouse drag (a touch
 * long press) selects in the preview touches get a frame (a class on their
 * wrappers), and a bar of three buttons (Delete, Cut, Copy) shows right
 * under the selection's last line (above it when there is no room). What
 * the buttons do is not here: a press and release inside the same button
 * (as the palette, INV-34 / INV-36) asks host.onActionRequested(kind,
 * range), and 11-c does it.
 *
 * readRange() reads the selection and changes nothing; update() shows it,
 * once per frame at most (selectionchange, scrolls and resizes are
 * gathered). The ends of the selection go to the block that holds them; an
 * end outside every block (the margins, the space between blocks, or
 * outside the preview: Ctrl+A) goes inward to the next block (U2, U4). An
 * end in an editor, a cell, a gap editor, the bar or the palette, or the
 * focus in a text entry, makes no range (U5). While the mouse button is
 * held (a drag still making the selection) the frame follows but the bar
 * waits for the release. Only the blocks within a screen of the viewport
 * get the frame (it follows the scroll): Ctrl+A on 1 MB frames a screen,
 * not some 24,000 blocks. The release of a mouse drag that started in the
 * preview and left a selection there has its default stopped: Edge then
 * shows no mini menu, which would take the next key (Delete) from the page
 * (owner ruling S1, 2026-10-25). A plain click keeps its default.
 *
 * The bar is one element on the body (position: fixed), never in the
 * preview, whose children the renderer owns (as BlockGapInsert).
 *
 * blockLocator: getBlockElements(), findBlockIdAt(node), isTableTab(node).
 * host: { canSelect(), isPaletteNode(node), onRangeChanged(range),
 * onActionRequested(kind, range) } with range {kind: "blockRange",
 * firstId, lastId} and kind "delete" | "cut" | "copy".
 */
export default class BlockRangeSelection {
  /**
   * @param {HTMLElement} preview
   * @param {MarkdownRenderer} blockLocator
   * @param {object} host
   * @param {{isApple?: boolean, requestFrame?: (fn: () => void) => void}} [options]
   * @purity non-pure
   */
  constructor(preview, blockLocator, host, options = {}) {
    this.preview = preview;
    this.blockLocator = blockLocator;
    this.host = host;
    this.requestFrame = options.requestFrame ?? nextFrame;
    this._modifier = options.isApple ? CONFIG.messages.palette.modifier.apple : CONFIG.messages.palette.modifier.other;
    this._enabled = false;
    this._scheduled = false;
    this._range = null; // the range update() last showed: {kind: "blockRange", firstId, lastId} or null
    this._marked = null; // {wrappers, first, last}: the wrappers with the frame
    this._bar = null; // the element, made on first use
    this._buttons = null; // kind -> button
    this._press = null; // { button, kind, range } of a press on the bar
    this._copiedTimer = null;
    this._isPointerHeld = false; // a mouse drag is making the selection: no bar yet
    this._isPreviewPress = false; // that drag started in the preview in editModeIdle
    this._onChange = () => this._schedule();
    /** @purity non-pure */
    this._onPointerDown = (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || this.isBarNode(e.target)) return;
      this._isPointerHeld = true;
      this._isPreviewPress = this.host.canSelect() && e.target instanceof Node && this.preview.contains(e.target);
      this._hideBar();
    };
    // INV-74 (2), owner ruling S1: no Edge mini menu after a drag that selected in the preview
    /** @purity non-pure */
    this._onMouseUp = (e) => {
      const isPreviewPress = this._isPreviewPress;
      this._isPreviewPress = false;
      if (isPreviewPress && e.button === 0 && this._hasSelectionInPreview()) e.preventDefault();
    };
    /** @purity non-pure */
    this._onPointerUp = () => {
      if (!this._isPointerHeld) return;
      this._isPointerHeld = false;
      this._schedule();
    };
    // a release outside the window may never arrive: a move with no button held ends the drag too
    /** @purity non-pure */
    this._onPointerMove = (e) => {
      if (this._isPointerHeld && e.pointerType === "mouse" && e.buttons === 0) this._onPointerUp();
    };
    this._onBarPress = (e) => this._handleBarPress(e);
    this._onBarRelease = (e) => this._handleBarRelease(e);
    /** @purity non-pure */
    this._onBarCancel = () => {
      this._press = null;
    };
    /** @purity non-pure */
    this._keepSelection = (e) => e.preventDefault(); // a press on the bar keeps the selection and the focus
  }

  // ---- Queries (semi-pure-b: they read the selection and the layout, and change nothing) ----

  /**
   * The range the selection makes now, read again, or null (none, edit
   * mode off or busy, or the focus in a text entry). Shows nothing.
   * @purity semi-pure-b
   * @returns {{kind: "blockRange", firstId: number, lastId: number}|null}
   */
  readRange() {
    const found = this._findRange();
    return found ? this._readRangeIds(found) : null;
  }

  /**
   * A range is shown (as update() last read it; once per frame).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  hasRange() {
    return this._range !== null;
  }

  /**
   * The node is the bar (or inside it).
   * @purity semi-pure-b
   * @param {Node|null} node
   * @returns {boolean}
   */
  isBarNode(node) {
    return this._bar !== null && node instanceof Node && this._bar.contains(node);
  }

  /**
   * Some text is selected in the preview (the selection is not empty and
   * touches it).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  _hasSelectionInPreview() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
    for (let i = 0; i < selection.rangeCount; i++) {
      if (selection.getRangeAt(i).intersectsNode(this.preview)) return true;
    }
    return false;
  }

  /**
   * The selection as block indices, or null when it makes no range.
   * @purity semi-pure-b
   * @returns {{wrappers: HTMLElement[], first: number, last: number, end: {node: Node, offset: number}|null}|null}
   */
  _findRange() {
    if (!this._enabled || !this.host.canSelect() || isTypingTarget(document.activeElement)) return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const head = selection.getRangeAt(0);
    const tail = selection.getRangeAt(selection.rangeCount - 1); // Firefox: one range per table cell
    let start = { node: head.startContainer, offset: head.startOffset };
    let end = { node: tail.endContainer, offset: tail.endOffset };
    if (this._isExcludedEnd(start.node) || this._isExcludedEnd(end.node)) return null;
    const preview = this.preview;
    const whole = document.createRange();
    whole.setStart(start.node, start.offset);
    whole.setEnd(end.node, end.offset);
    if (!whole.intersectsNode(preview)) return null;
    // only the part in the preview counts (U4: Ctrl+A)
    if (!preview.contains(start.node)) start = { node: preview, offset: 0 };
    let isEndInBlock = true;
    if (!preview.contains(end.node)) {
      end = { node: preview, offset: preview.childNodes.length };
      isEndInBlock = false;
    }
    const wrappers = this.blockLocator.getBlockElements();
    const first = this._findEdgeIndex(wrappers, start, true).index;
    const last = this._findEdgeIndex(wrappers, end, false);
    if (first < 0 || last.index < first || last.index >= wrappers.length) return null;
    return { wrappers, first, last: last.index, end: isEndInBlock && !last.rounded ? end : null };
  }

  /**
   * The ids of a found range.
   * @purity semi-pure-b
   * @param {{wrappers: HTMLElement[], first: number, last: number}} found
   * @returns {{kind: "blockRange", firstId: number, lastId: number}}
   */
  _readRangeIds(found) {
    return {
      kind: "blockRange",
      firstId: this.blockLocator.findBlockIdAt(found.wrappers[found.first]),
      lastId: this.blockLocator.findBlockIdAt(found.wrappers[found.last]),
    };
  }

  /**
   * An end of the selection in an editor, a cell, a gap editor, the bar or
   * the palette (U5).
   * @purity semi-pure-b
   * @param {Node} node
   * @returns {boolean}
   */
  _isExcludedEnd(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return false;
    if (this.isBarNode(el) || this.host.isPaletteNode(el)) return true;
    return el.isContentEditable === true || el.closest(ENTRY_SELECTOR) !== null;
  }

  /**
   * The block index one end of the selection stands for. The start goes
   * forward and the end backward when it is not in a block, or at the very
   * end (start) of a block (U2: inward); rounded tells that it moved.
   * @purity semi-pure-b
   * @param {HTMLElement[]} wrappers
   * @param {{node: Node, offset: number}} point
   * @param {boolean} isStart
   * @returns {{index: number, rounded: boolean}}
   */
  _findEdgeIndex(wrappers, point, isStart) {
    const preview = this.preview;
    if (point.node === preview) {
      const child = isStart ? preview.childNodes[point.offset] : preview.childNodes[point.offset - 1];
      return { index: this._findNearestWrapper(wrappers, child ?? null, isStart), rounded: true };
    }
    let child = point.node;
    while (child.parentNode !== preview) child = child.parentNode;
    const index = wrappers.indexOf(child);
    if (index < 0) return { index: this._findNearestWrapper(wrappers, child, isStart), rounded: true };
    const isTab = (node) => this.blockLocator.isTableTab(node);
    if (isAtEdge(child, point.node, point.offset, isStart, isTab)) return { index: isStart ? index + 1 : index - 1, rounded: true };
    return { index, rounded: false };
  }

  /**
   * The first wrapper at or after a child of the preview (forward), or the
   * last at or before it (backward), by a binary search over the wrappers
   * in their order. null child: the end (forward: none) or nothing before.
   * @purity semi-pure-b
   * @param {HTMLElement[]} wrappers
   * @param {Node|null} child
   * @param {boolean} forward
   * @returns {number} an index; wrappers.length or -1 when there is none
   */
  _findNearestWrapper(wrappers, child, forward) {
    if (child === null) return forward ? wrappers.length : -1;
    // the first wrapper that is the child or comes after it
    let lo = 0;
    let hi = wrappers.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const w = wrappers[mid];
      if (w === child || child.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING) hi = mid;
      else lo = mid + 1;
    }
    if (forward) return lo;
    return wrappers[lo] === child ? lo : lo - 1;
  }

  /**
   * The part of first..last that gets the frame: the wrappers within one
   * screen above and below the viewport (by a binary search over their
   * boxes, in order). Without layout (every box at 0), all of them.
   * @purity semi-pure-b
   * @param {{wrappers: HTMLElement[], first: number, last: number}} found
   * @returns {{first: number, last: number}}
   */
  _findFramedPart(found) {
    const { wrappers } = found;
    const reach = window.innerHeight;
    /** @purity semi-pure-b */
    const findFirstWhere = (test) => {
      let lo = found.first;
      let hi = found.last + 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (test(wrappers[mid].getBoundingClientRect())) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    };
    const first = findFirstWhere((box) => box.bottom >= -reach);
    const last = findFirstWhere((box) => box.top > 2 * reach) - 1;
    return last < first ? { first, last: first - 1 } : { first, last };
  }

  /**
   * The line the selection ends on: the box of its end point, or, when the
   * end was moved to a block edge (or has no box), the bottom of the last
   * block in the range.
   * @purity semi-pure-b
   * @param {{node: Node, offset: number}|null} end
   * @param {HTMLElement} lastWrapper
   * @returns {{x: number, top: number, bottom: number}}
   */
  _measureEndLine(end, lastWrapper) {
    const rect = end ? this._measurePointRect(end) : null;
    if (rect) return { x: rect.left, top: rect.top, bottom: rect.bottom };
    const box = lastWrapper.getBoundingClientRect();
    return { x: box.left + Math.min(box.width, 2 * CONFIG.edit.blockRangeBarMarginPx), top: box.bottom, bottom: box.bottom };
  }

  /**
   * The box of the line at a selection point, or null (no layout, or no box).
   * @purity semi-pure-b
   * @param {{node: Node, offset: number}} point
   * @returns {DOMRect|null}
   */
  _measurePointRect(point) {
    const r = document.createRange();
    if (typeof r.getClientRects !== "function") return null;
    r.setStart(point.node, point.offset);
    r.collapse(true);
    let rects = r.getClientRects();
    if (rects.length === 0 && point.node.nodeType === Node.TEXT_NODE && point.offset > 0) {
      // a collapsed point at a line end may have no box: the character before it
      r.setStart(point.node, point.offset - 1);
      r.setEnd(point.node, point.offset);
      rects = r.getClientRects();
    }
    const rect = rects.length > 0 ? rects[rects.length - 1] : null;
    return rect && rect.height > 0 ? rect : null;
  }

  /**
   * The bar's button holding node, as its kind, or null.
   * @purity semi-pure-b
   * @param {EventTarget|null} node
   * @returns {string|null}
   */
  _findKindAt(node) {
    if (!(node instanceof Node)) return null;
    return KINDS.find((kind) => this._buttons[kind].contains(node)) ?? null;
  }

  // ---- Commands (non-pure) ----

  /**
   * Edit mode started: follow the selection.
   * @purity non-pure
   */
  enable() {
    if (this._enabled) return;
    this._enabled = true;
    document.addEventListener("selectionchange", this._onChange);
    document.addEventListener("pointerdown", this._onPointerDown, true);
    document.addEventListener("pointerup", this._onPointerUp, true);
    document.addEventListener("pointercancel", this._onPointerUp, true);
    document.addEventListener("mouseup", this._onMouseUp, true);
    document.addEventListener("pointermove", this._onPointerMove, { capture: true, passive: true });
    this.preview.addEventListener("scroll", this._onChange, { passive: true });
    window.addEventListener("scroll", this._onChange, { passive: true });
    window.addEventListener("resize", this._onChange);
    this._schedule();
  }

  /**
   * Edit mode ended: no frame, no bar, no listeners. The browser's
   * selection stays (outside edit mode it is the browser's own).
   * @purity non-pure
   */
  disable() {
    if (!this._enabled) return;
    this._enabled = false;
    document.removeEventListener("selectionchange", this._onChange);
    document.removeEventListener("pointerdown", this._onPointerDown, true);
    document.removeEventListener("pointerup", this._onPointerUp, true);
    document.removeEventListener("pointercancel", this._onPointerUp, true);
    document.removeEventListener("mouseup", this._onMouseUp, true);
    document.removeEventListener("pointermove", this._onPointerMove, true);
    this._isPointerHeld = false;
    this._isPreviewPress = false;
    this.preview.removeEventListener("scroll", this._onChange);
    window.removeEventListener("scroll", this._onChange);
    window.removeEventListener("resize", this._onChange);
    this.reset();
  }

  /**
   * Read the selection and show (or take away) the frame and the bar.
   * @purity non-pure
   */
  update() {
    this._apply(this._findRange());
  }

  /**
   * Forget the range: no frame, no bar (the browser's selection stays).
   * @purity non-pure
   */
  reset() {
    this._apply(null);
  }

  /**
   * Take the selection away too (Esc, a delete, a cut; INV-74 (3)).
   * @purity non-pure
   */
  clearSelection() {
    window.getSelection()?.removeAllRanges();
    this.reset();
  }

  /**
   * The Copy button shows a check for a moment (D11, U3), as the diagrams'
   * copy buttons show their message (CONFIG.ui.copyFeedbackDuration). The
   * bar is made if no frame has shown it yet.
   * @purity non-pure
   */
  showCopied() {
    const button = this._barElement() && this._buttons.copy;
    clearTimeout(this._copiedTimer);
    button.innerHTML = ICONS.check; // static markup from ICONS only
    button.classList.add("is-copied");
    /** @purity non-pure */
    this._copiedTimer = setTimeout(() => {
      button.innerHTML = ICONS.copy;
      button.classList.remove("is-copied");
    }, CONFIG.ui.copyFeedbackDuration);
  }

  /**
   * @purity non-pure
   */
  _schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    /** @purity non-pure */
    this.requestFrame(() => {
      this._scheduled = false;
      this.update();
    });
  }

  /**
   * Show the frame and the bar for found (or neither), and tell the host
   * when the range changed. The layout is read (the bar's place, the
   * framed part) before any class changes.
   * @purity non-pure
   * @param {{wrappers: HTMLElement[], first: number, last: number, end: object|null}|null} found
   */
  _apply(found) {
    // while the mouse still drags, the bar would come under it and stop the selection
    if (found && !this._isPointerHeld) this._showBar(found, found.wrappers[found.last]);
    else this._hideBar();
    this._mark(found ? { wrappers: found.wrappers, ...this._findFramedPart(found) } : null);
    const previous = this._range;
    this._range = found ? this._readRangeIds(found) : null;
    const changed = previous?.firstId !== this._range?.firstId || previous?.lastId !== this._range?.lastId;
    if (changed) this.host.onRangeChanged(this._range);
  }

  /**
   * The frame on wrappers first..last of the list. On the same list only
   * the wrappers that come or go change (a drag grows the range a little
   * each frame, a scroll moves the framed part).
   * @purity non-pure
   * @param {{wrappers: HTMLElement[], first: number, last: number}|null} next
   */
  _mark(next) {
    const old = this._marked;
    if (old && next && old.wrappers === next.wrappers && old.first === next.first && old.last === next.last) return;
    const isSameList = old !== null && next !== null && old.wrappers === next.wrappers;
    /** @purity pure */
    const isIn = (part, i) => isSameList && i >= part.first && i <= part.last;
    if (old) for (let i = old.first; i <= old.last; i++) if (!isIn(next, i)) old.wrappers[i].classList.remove(RANGE_CLASS);
    if (next) for (let i = next.first; i <= next.last; i++) if (!isIn(old, i)) next.wrappers[i].classList.add(RANGE_CLASS);
    this._marked = next;
  }

  /**
   * The bar under the selection's last line, else above it, always inside
   * the viewport (D10, U4; floatingPlacement.placementNearLine).
   * @purity non-pure
   * @param {{end: {node: Node, offset: number}|null}} found
   * @param {HTMLElement} lastWrapper
   */
  _showBar(found, lastWrapper) {
    const bar = this._barElement();
    bar.hidden = false;
    const line = this._measureEndLine(found.end, lastWrapper);
    const view = { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
    const size = { width: bar.offsetWidth, height: bar.offsetHeight };
    const at = placementNearLine(line, size, view, CONFIG.edit.blockRangeBarGapPx, CONFIG.edit.blockRangeBarMarginPx);
    bar.style.left = `${at.left}px`;
    bar.style.top = `${at.top}px`;
  }

  /**
   * @purity non-pure
   */
  _hideBar() {
    if (this._bar) this._bar.hidden = true;
  }

  /**
   * @purity non-pure
   */
  _barElement() {
    if (this._bar) return this._bar;
    const bar = document.createElement("div");
    bar.className = "grsmd-block-range-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", RANGE_MESSAGES.bar);
    bar.hidden = true;
    const labels = { delete: RANGE_MESSAGES.delete, cut: RANGE_MESSAGES.cut(this._modifier), copy: RANGE_MESSAGES.copy(this._modifier) };
    this._buttons = {};
    for (const kind of KINDS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "grsmd-block-range-btn";
      button.title = labels[kind];
      button.setAttribute("aria-label", labels[kind]);
      button.tabIndex = -1; // never takes the keyboard focus (as the palette, INV-53)
      button.innerHTML = ICONS[kind]; // static markup from ICONS only
      bar.appendChild(button);
      this._buttons[kind] = button;
    }
    bar.addEventListener("pointerdown", this._onBarPress);
    bar.addEventListener("mousedown", this._keepSelection);
    bar.addEventListener("touchstart", this._keepSelection, { passive: false });
    bar.addEventListener("pointerup", this._onBarRelease);
    bar.addEventListener("pointercancel", this._onBarCancel);
    document.body.appendChild(bar);
    this._bar = bar;
    return bar;
  }

  /**
   * A press on a button reads the range again (INV-74 (1)) and keeps it
   * for the release (a touch may take the selection away before it).
   * @purity non-pure
   * @param {PointerEvent} e
   */
  _handleBarPress(e) {
    e.preventDefault();
    const kind = this._findKindAt(e.target);
    const range = kind && e.button === 0 ? this.readRange() : null;
    this._press = range ? { kind, button: this._buttons[kind], range } : null;
  }

  /**
   * Released inside the button it was pressed on: run it.
   * @purity non-pure
   * @param {PointerEvent} e
   */
  _handleBarRelease(e) {
    const press = this._press;
    this._press = null;
    if (!press) return;
    // a touch keeps the pressed element as the target: ask where it was released
    const over = typeof document.elementFromPoint === "function" ? document.elementFromPoint(e.clientX, e.clientY) : e.target;
    if (!(over instanceof Node) || !press.button.contains(over)) return;
    e.preventDefault();
    this.host.onActionRequested(press.kind, press.range);
  }
}
