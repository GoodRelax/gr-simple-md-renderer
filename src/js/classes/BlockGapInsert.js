import { CONFIG } from "../config.js";
import { nextFrame } from "../utils.js";

// Room left between the end of the line and a table's tab.
const TAB_MARGIN_PX = 8;

// What a press keeps for itself, as the targets a tap never opens (INV-29):
// the line is not shown over them.
const CONTROL_SELECTOR = [
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
 * The gaps between the top-level blocks in edit mode (INV-73, owner ruling
 * B1): where a new block can go in. A mouse over a gap shows a dashed line
 * with a "+"; a touch tap on a gap shows it. A click (a tap) on that line
 * asks for the insert through host.onGapChosen(target). There is a gap
 * before the first block and after the last one too.
 *
 * The line is one element on the body (position: fixed), never in the
 * preview, whose children the renderer owns. It is placed from the blocks'
 * rectangles; the blocks are found by a binary search over the renderer's
 * list of them (made again only when the document changes; a 1 MB document
 * has some 9,000 blocks, INV-51), once per frame at most for the mouse.
 *
 * blockLocator: getBlockElements(), findBlockIdAt(node), isTableTab(node).
 * host: { onGapChosen(target), isSuppressed() } with target {kind: "gap",
 * afterBlockId, beforeBlockId} (null: the start or the end of the
 * document); while isSuppressed() is true (blocks are selected, INV-74) no
 * gap is offered.
 */
export default class BlockGapInsert {
  /**
   * @param {HTMLElement} preview
   * @param {MarkdownRenderer} blockLocator - getBlockElements(), findBlockIdAt(), isTableTab()
   * @param {{onGapChosen: (target: object) => void}} host
   * @param {{requestFrame?: (fn: () => void) => void}} [options] - the mouse is followed once per frame
   * @purity non-pure
   */
  constructor(preview, blockLocator, host, options = {}) {
    this.preview = preview;
    this.blockLocator = blockLocator;
    this.host = host;
    this.requestFrame = options.requestFrame ?? nextFrame;
    this._move = null; // the last mouse move not followed yet: {x, y, over}
    this._moveScheduled = false;
    this._line = null; // the element, made on first use
    this._shown = null; // the target the line shows, or null
    this._pressed = false; // a press began on the line: its click inserts
    this._enabled = false;
    this._onPointerMove = (e) => this._handlePointerMove(e);
    this._onScroll = () => this.hide();
    this._onLineClick = (e) => this._handleLineClick(e);
    /** @purity non-pure */
    this._onLinePress = (e) => {
      if (e.button !== 0) return; // only the main button ends in a click
      this._pressed = true;
      this._move = null; // the press keeps the line: a move before it is stale
    };
  }

  /**
   * Edit mode started: follow the mouse.
   * @purity non-pure
   */
  enable() {
    if (this._enabled) return;
    this._enabled = true;
    document.addEventListener("pointermove", this._onPointerMove, { passive: true });
    this.preview.addEventListener("scroll", this._onScroll, { passive: true });
    window.addEventListener("scroll", this._onScroll, { passive: true });
  }

  /**
   * Edit mode ended: no line, no listeners.
   * @purity non-pure
   */
  disable() {
    if (!this._enabled) return;
    this._enabled = false;
    document.removeEventListener("pointermove", this._onPointerMove);
    this.preview.removeEventListener("scroll", this._onScroll);
    window.removeEventListener("scroll", this._onScroll);
    this._move = null;
    this.hide();
  }

  /**
   * The node is the line (or inside it).
   * @purity semi-pure-b
   * @param {Node|null} node
   * @returns {boolean}
   */
  isLineNode(node) {
    return this._line !== null && node instanceof Node && this._line.contains(node);
  }

  /**
   * The gap at a point of the viewport, or null: within CONFIG.edit.gapHitPx
   * of the middle of a gap, or in the gap itself. Into a block the zone
   * reaches half that distance, a quarter of its height at most, and not
   * into an open editor; a gap next to an open gap editor has none (that
   * editor is the insert). Not over a table's tab, a link, a button or
   * another control of the preview, nor where something else is over the
   * preview (the top bar of a touch layout), nor while blocks are selected.
   * @purity semi-pure-b
   * @param {number} x
   * @param {number} y
   * @returns {{kind: "gap", afterBlockId: number|null, beforeBlockId: number|null, top: number, bottom: number, line: number, left: number, width: number}|null}
   */
  gapAt(x, y) {
    if (!this._enabled || this.host.isSuppressed()) return null;
    const area = this.preview.getBoundingClientRect();
    const style = getComputedStyle(this.preview);
    const left = area.left + parseFloat(style.paddingLeft || "0");
    const right = area.right - parseFloat(style.paddingRight || "0");
    if (x < left || x > right || y < area.top || y > area.bottom) return null;
    const wrappers = this._solidElements();
    if (wrappers.length === 0) return null;
    // the first element whose top is below y
    let lo = 0;
    let hi = wrappers.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (wrappers[mid].getBoundingClientRect().top > y) hi = mid;
      else lo = mid + 1;
    }
    // the gap above that element, then the one above the element before it
    for (const k of [lo, lo - 1]) {
      if (k < 0 || k > wrappers.length) continue;
      const zone = this._zone(wrappers, k, area);
      if (zone && y >= zone.top && y <= zone.bottom) {
        // a table's tab sits in the gap above it (INV-29 (b)): the line
        // stops short of it, and the tab stays the tab's
        const tab = k < wrappers.length ? this._tableTab(wrappers[k]) : null;
        const end = tab ? Math.min(right, tab.getBoundingClientRect().left - TAB_MARGIN_PX) : right;
        if (x > end || this._isOverControl(x, y)) return null;
        return { ...zone, left, width: Math.max(end - left, 0) };
      }
    }
    return null;
  }

  /**
   * Show the line on a gap (a touch tap, or the mouse over it).
   * @purity non-pure
   * @param {object} target - from gapAt()
   */
  show(target) {
    const line = this._lineElement();
    line.style.left = `${target.left}px`;
    line.style.width = `${target.width}px`;
    line.style.top = `${target.top}px`;
    line.style.height = `${Math.max(target.bottom - target.top, 1)}px`;
    line.style.setProperty("--grsmd-gap-line", `${target.line - target.top}px`);
    line.hidden = false;
    this._shown = target;
  }

  /**
   * @purity non-pure
   */
  hide() {
    if (this._line) this._line.hidden = true;
    this._shown = null;
    this._pressed = false;
    this._move = null; // a move before the hide must not show it again
  }

  /**
   * The gap the line shows, or null.
   * @purity semi-pure-b
   * @returns {object|null}
   */
  shownGap() {
    return this._shown;
  }

  // ---- internals ----

  /**
   * The block wrappers in order, with an open gap editor among them (its id
   * is null: the gaps next to it are not offered).
   * @purity semi-pure-b
   * @returns {HTMLElement[]}
   */
  _solidElements() {
    const wrappers = this.blockLocator.getBlockElements();
    const gapEditor = this.preview.querySelector(":scope > .md-block-gap");
    if (!gapEditor) return wrappers;
    // the renderer's list is shared: a copy with the gap editor in it
    const index = wrappers.findIndex((w) => gapEditor.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING);
    const at = index < 0 ? wrappers.length : index;
    return [...wrappers.slice(0, at), gapEditor, ...wrappers.slice(at)];
  }

  /**
   * The zone of the gap k (above element k; k = length: after the last).
   * @purity semi-pure-b
   */
  _zone(elements, k, area) {
    const hit = CONFIG.edit.gapHitPx;
    const above = k > 0 ? elements[k - 1] : null;
    const below = k < elements.length ? elements[k] : null;
    if ((above && !this._isBlock(above)) || (below && !this._isBlock(below))) return null;
    const a = above?.getBoundingClientRect() ?? null;
    const b = below?.getBoundingClientRect() ?? null;
    // the room before the first block and after the last one: up to the
    // preview's padding, at least the hit distance
    const upper = a ? a.bottom : Math.max(area.top, b.top - 2 * hit);
    const lower = b ? b.top : Math.min(area.bottom, a.bottom + 2 * hit);
    const line = (upper + lower) / 2;
    const into = (rect, el) => (rect && !el.classList.contains("md-block-editing") ? Math.min(hit / 2, rect.height / 4) : 0);
    // the gap itself and gapHitPx above and below its middle line, but into
    // a block no further than into() (INV-73 (1))
    const top = Math.max(Math.min(upper, line - hit), upper - into(a, above));
    const bottom = Math.min(Math.max(lower, line + hit), lower + into(b, below));
    return {
      kind: "gap",
      afterBlockId: above ? this.blockLocator.findBlockIdAt(above) : null,
      beforeBlockId: below ? this.blockLocator.findBlockIdAt(below) : null,
      top: Math.max(top, area.top),
      bottom: Math.min(bottom, area.bottom),
      line,
    };
  }

  /**
   * A block wrapper (not the open gap editor).
   * @purity semi-pure-b
   */
  _isBlock(el) {
    return this.blockLocator.findBlockIdAt(el) !== null;
  }

  /**
   * The topmost element at the point under the line is a control of the
   * preview (CONTROL_SELECTOR, or a table's tab), or is not in the preview
   * at all (the top bar over the preview in a touch layout, the palette).
   * @purity semi-pure-b
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  _isOverControl(x, y) {
    if (typeof document.elementsFromPoint !== "function") return false;
    for (const el of document.elementsFromPoint(x, y)) {
      if (this.isLineNode(el)) continue;
      if (el === this.preview) return false;
      if (!this.preview.contains(el)) return true;
      return el.closest(CONTROL_SELECTOR) !== null || this.blockLocator.isTableTab(el);
    }
    return false;
  }

  /**
   * The "Markdown" tab the renderer put on a table block's wrapper, or null
   * (known by reference: a document's own class is not one).
   * @purity semi-pure-b
   * @param {HTMLElement} wrapper
   * @returns {HTMLElement|null}
   */
  _tableTab(wrapper) {
    for (const child of wrapper.children) if (this.blockLocator.isTableTab(child)) return child;
    return null;
  }

  /**
   * @purity non-pure
   */
  _lineElement() {
    if (this._line) return this._line;
    const line = document.createElement("div");
    line.className = "grsmd-gap-insert";
    line.title = CONFIG.messages.edit.gapInsert;
    line.hidden = true;
    const plus = document.createElement("span");
    plus.className = "grsmd-gap-insert-plus";
    plus.textContent = "+";
    line.appendChild(plus);
    line.addEventListener("pointerdown", this._onLinePress);
    line.addEventListener("click", this._onLineClick);
    document.body.appendChild(line);
    this._line = line;
    return line;
  }

  /**
   * The mouse shows the line over a gap and hides it elsewhere, worked out
   * once per frame for the last move (INV-51). While a button is held (a
   * press on the line, a selection being made) the line stays as it is, so
   * the press on it ends in its click.
   * @purity non-pure
   * @param {PointerEvent} e
   */
  _handlePointerMove(e) {
    if (e.pointerType !== "mouse" || e.buttons !== 0) return;
    const over = e.target instanceof Node && (this.preview.contains(e.target) || this.isLineNode(e.target));
    this._move = { x: e.clientX, y: e.clientY, over };
    if (this._moveScheduled) return;
    this._moveScheduled = true;
    this.requestFrame(() => this._followMove());
  }

  /**
   * @purity non-pure
   */
  _followMove() {
    this._moveScheduled = false;
    const move = this._move;
    this._move = null;
    if (!move || !this._enabled) return;
    const gap = move.over ? this.gapAt(move.x, move.y) : null;
    if (gap) this.show(gap);
    else this.hide();
  }

  /**
   * A click whose press began on the line inserts. The click of the touch
   * tap that showed the line lands on it too (it is there by then): that one
   * only shows it.
   * @purity non-pure
   * @param {MouseEvent} e
   */
  _handleLineClick(e) {
    if (!this._pressed) return;
    const target = this._shown;
    e.preventDefault();
    this.hide();
    if (target) this.host.onGapChosen({ kind: "gap", afterBlockId: target.afterBlockId, beforeBlockId: target.beforeBlockId });
  }
}
