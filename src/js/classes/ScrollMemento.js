// the top bar stays at the top when the document scrolls (style.css, touch)
const STICKY_BAR_ID = "topbar";
// bounds of how far past a request the document scroll is tried (CSS px):
// one screen pixel and one more (see _scrollSearchSpan)
const SCROLL_SEARCH_MIN_PX = 2;
const SCROLL_SEARCH_MAX_PX = 32;

export default class ScrollMemento {
  /**
   * @param {HTMLElement} container
   * @purity non-pure
   */
  constructor(container) {
    this.container = container;
    this.useDocumentScroll = window.matchMedia(
      "(any-pointer: coarse)",
    ).matches;
  }

  /**
   * @returns {number}
   * @purity semi-pure-b
   */
  save() {
    return this.useDocumentScroll
      ? window.scrollY
      : this.container.scrollTop;
  }

  /**
   * Back to a position save() returned. When the document scrolls, a request
   * can land a step below it (see _scrollDocumentNear): the requests from
   * pos up to the search span past it are tried until scrollY reads pos, and
   * the nearest is kept (a request lands by itself, wherever the page was).
   * @param {number} pos
   * @purity non-pure
   */
  restore(pos) {
    if (!this.useDocumentScroll) {
      this.container.scrollTop = pos;
      return;
    }
    window.scrollTo(0, pos);
    const span = ScrollMemento._scrollSearchSpan();
    let best = pos;
    let bestMiss = Math.abs(window.scrollY - pos);
    let last = pos;
    for (let k = 1; k <= span && window.scrollY < pos; k++) {
      last = pos + k;
      window.scrollTo(0, last);
      const miss = Math.abs(window.scrollY - pos);
      if (miss < bestMiss) {
        best = last;
        bestMiss = miss;
      }
    }
    if (last !== best) window.scrollTo(0, best);
  }

  /**
   * Where the element's top is in the viewport now (INV-46).
   * @param {Element|null} element
   * @returns {{offsetTop: number}|null}
   * @purity semi-pure-b
   */
  captureAnchor(element) {
    if (!element) return null;
    return { offsetTop: element.getBoundingClientRect().top };
  }

  /**
   * The reader's place: the first child of the container that is shown and
   * reaches below the top of what is shown, and where the top of its content
   * is (its first shown element in the flow; a table block's tab is placed
   * out of it). A child without a box (display: none) is passed over, and
   * so is a block that edit mode alone shows (.md-block-hidden,
   * .md-block-empty): it is not there on the other side of the change.
   * null when no child can be the place.
   * @returns {{element: Element, anchor: {offsetTop: number}}|null}
   * @purity semi-pure-b
   */
  captureReadingAnchor() {
    const index = this._placeIndex(this._shownTop());
    if (index < 0) return null;
    const block = this.container.children[index];
    const first = ScrollMemento._placeFrom(block.children, 0, block.children.length, true);
    const element = first < block.children.length ? block.children[first] : block;
    return { element, anchor: this.captureAnchor(element) };
  }

  /**
   * What lies at a given top on screen, to follow an anchor measured before
   * a change of layout (RendererOrchestrator): inside a place, the last
   * child of it in the flow and shown that starts at or above that top
   * (never a table's tab, which is placed out of the flow), or the place
   * itself; in a gap above a place (a band that only
   * edit mode shows, or a margin), the bottom of the place before it.
   * @param {number} top - a top on screen (an anchor's offsetTop)
   * @returns {{element: Element, anchor: {offsetTop: number}, edge: string}|null}
   *   edge "top" or "bottom": which edge of element offsetTop is
   * @purity semi-pure-b
   */
  capturePlaceAt(top) {
    const index = this._placeIndex(top);
    if (index < 0) return null;
    const children = this.container.children;
    const block = children[index];
    const blockTop = block.getBoundingClientRect().top;
    if (blockTop > top) {
      let before = index - 1;
      while (before >= 0 && !ScrollMemento._canBePlace(children[before])) before--;
      if (before >= 0) {
        const element = children[before];
        return { element, anchor: { offsetTop: element.getBoundingClientRect().bottom }, edge: "bottom" };
      }
      return { element: block, anchor: { offsetTop: blockTop }, edge: "top" };
    }
    const element = ScrollMemento._childAt(block, top) ?? block;
    return { element, anchor: this.captureAnchor(element), edge: "top" };
  }

  /**
   * How far the element of a saved place has moved on screen since it was
   * saved (its top, or its bottom for edge "bottom"); 0 when there is none,
   * or it is gone or no longer shown.
   * @param {{element: Element, anchor: {offsetTop: number}, edge?: string}|null} saved
   * @returns {number}
   * @purity semi-pure-b
   */
  movedBy(saved) {
    if (!saved || !saved.element.isConnected || saved.element.getClientRects().length === 0) return 0;
    const rect = saved.element.getBoundingClientRect();
    return (saved.edge === "bottom" ? rect.bottom : rect.top) - saved.anchor.offsetTop;
  }

  /**
   * Back to the place captureReadingAnchor saw (nothing without one, or when
   * that element is gone or no longer shown).
   * @param {{element: Element, anchor: {offsetTop: number}}|null} saved
   * @purity non-pure
   */
  restoreReadingAnchor(saved) {
    if (this.movedBy(saved) === 0) return;
    this.restoreAnchor(saved.anchor, saved.element);
  }

  /**
   * The top of what is shown: the container's top, or, when the document
   * scrolls (touch), the bottom of the sticky top bar (0 without one).
   * @returns {number}
   * @purity semi-pure-b
   */
  _shownTop() {
    if (!this.useDocumentScroll) return this.container.getBoundingClientRect().top;
    const bar = document.getElementById(STICKY_BAR_ID);
    return bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
  }

  /**
   * Index of the first child that can be the place and reaches below top;
   * the last such child when all are above it; -1 when there is none.
   * Halving over "the next place at or after i reaches below top", which
   * rises with i (the shown children are in order). A scan for the next
   * place stops at the end of the range, so the halving reads each child at
   * most once, and the last scan reads a child once more at most.
   * @param {number} top
   * @returns {number}
   * @purity semi-pure-b
   */
  _placeIndex(top) {
    const children = this.container.children;
    let lo = 0;
    let hi = children.length; // the test holds at hi (there: no place, or one below top)
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const at = ScrollMemento._placeFrom(children, mid, hi);
      if (at === hi || children[at].getBoundingClientRect().bottom > top) hi = mid;
      else lo = at + 1;
    }
    const at = ScrollMemento._placeFrom(children, lo, children.length);
    if (at < children.length) return at;
    // everything shown is above the top: lo moved only past places
    return lo - 1;
  }

  /**
   * The last child of block in the flow and shown that starts at or above
   * top; null when there is none. Halving as in _placeIndex (the tops of
   * such children are in order): a whole-document block can hold every
   * element of the document.
   * @param {Element} block
   * @param {number} top
   * @returns {Element|null}
   * @purity semi-pure-b
   */
  static _childAt(block, top) {
    const children = block.children;
    let lo = 0;
    let hi = children.length; // the test holds at hi (there: none, or one starting below top)
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const at = ScrollMemento._placeFrom(children, mid, hi, true);
      if (at === hi || children[at].getBoundingClientRect().top > top) hi = mid;
      else lo = at + 1;
    }
    // lo moved only past children in the flow that start at or above top
    return lo > 0 ? children[lo - 1] : null;
  }

  /**
   * The first child in [i, end) that can be the reader's place, or, with
   * inFlow, that is shown and in the flow (end when there is none).
   * @param {HTMLCollection} children
   * @param {number} i
   * @param {number} end
   * @param {boolean} [inFlow]
   * @returns {number}
   * @purity semi-pure-b
   */
  static _placeFrom(children, i, end, inFlow = false) {
    while (i < end && !(inFlow ? ScrollMemento._inFlow(children[i]) : ScrollMemento._canBePlace(children[i]))) i++;
    return i;
  }

  /**
   * Whether an element inside a block is shown and in the flow: what is
   * placed out of it (the tab of a table, at the top of its block) does not
   * stand for where the content is.
   * @param {Element} child
   * @returns {boolean}
   * @purity semi-pure-b
   */
  static _inFlow(child) {
    if (child.getClientRects().length === 0) return false;
    const position = window.getComputedStyle(child).position;
    return position !== "absolute" && position !== "fixed";
  }

  /**
   * Whether a child of the container can be the reader's place: it has a box
   * and is not a block only edit mode shows.
   * @param {Element} child
   * @returns {boolean}
   * @purity semi-pure-b
   */
  static _canBePlace(child) {
    if (child.classList.contains("md-block-hidden") || child.classList.contains("md-block-empty")) return false;
    return child.getClientRects().length > 0;
  }

  /**
   * The least scroll that brings the element into what is shown (INV-52,
   * after an insert): none when it is in view; else its nearer edge goes to
   * that edge of what is shown (its top, when it is taller). Not smooth.
   * No element, or one without a box: nothing.
   * @param {Element|null} element
   * @purity non-pure
   */
  reveal(element) {
    if (!element || element.getClientRects().length === 0) return;
    const rect = element.getBoundingClientRect();
    const top = this._shownTop();
    const bottom = this.useDocumentScroll
      ? window.innerHeight
      : this.container.getBoundingClientRect().top + this.container.clientHeight;
    let delta = 0;
    if (rect.top < top) delta = rect.top - top;
    else if (rect.bottom > bottom) delta = Math.min(rect.bottom - bottom, rect.top - top);
    if (delta === 0) return;
    if (this.useDocumentScroll) window.scrollTo(0, window.scrollY + delta);
    else this.container.scrollTop += delta;
  }

  /**
   * Scroll so that the element's top is back where captureAnchor saw it.
   * No element or no anchor, or an element without a box (a hidden block
   * outside edit mode reads as top 0): nothing changes (spec 5.14.9).
   * @param {{offsetTop: number}|null} anchor
   * @param {Element|null} element - found by the caller from anchorBlockId
   * @purity non-pure
   */
  restoreAnchor(anchor, element) {
    if (!anchor || !element || element.getClientRects().length === 0) return;
    const delta = element.getBoundingClientRect().top - anchor.offsetTop;
    if (delta === 0) return;
    if (this.useDocumentScroll) {
      this._scrollDocumentNear(element, anchor.offsetTop, window.scrollY + delta);
    } else {
      this.container.scrollTop += delta;
    }
  }

  /**
   * Scroll the document so that the element's top is as near targetTop as
   * the browser can put it. WebKit on a zoomed-out page (no viewport meta)
   * scrolls by steps (measured in the e2e emulation: one screen pixel, 1 /
   * the zoom, about 2.5 CSS px, whatever the device pixel ratio), rounding
   * down, and reads scrollY as a whole number: one request lands below the
   * aim, and corrections that follow one another (in and out of edit mode,
   * again and again) would add up. The requests from request up to the
   * search span past it (toward the aim) are tried, and the one that lands
   * nearest is kept: within half a step of the aim (nearer cannot be
   * scrolled to), and back on the same step when the layout comes back, so
   * nothing adds up.
   * A browser that lands where asked (Chromium) stops at the first; a
   * document that cannot scroll that way (at its end) stops there too.
   * Where a request lands depends on the request alone (scrollTo goes to a
   * position, not by a distance), so going back to the best request lands
   * where it did.
   * @param {Element} element
   * @param {number} targetTop
   * @param {number} request
   * @purity non-pure
   */
  _scrollDocumentNear(element, targetTop, request) {
    const before = element.getBoundingClientRect().top - targetTop;
    let best = request;
    let bestMiss = this._missAfterScroll(element, targetTop, request);
    let last = request;
    const toward = bestMiss > 0 ? 1 : -1;
    const span = ScrollMemento._scrollSearchSpan();
    // nothing moved, and nothing moves a whole span further either: the
    // document is at its end that way (when the far try does move, the
    // search below ends on the best try, so the page does not stay there)
    if (Math.abs(bestMiss) >= 0.5 && bestMiss === before) {
      last = request + toward * span;
      if (this._missAfterScroll(element, targetTop, last) === before) return;
    }
    for (let k = 1; k <= span && Math.abs(bestMiss) >= 0.5; k++) {
      last = request + toward * k;
      const miss = this._missAfterScroll(element, targetTop, last);
      if (Math.abs(miss) < Math.abs(bestMiss)) {
        best = last;
        bestMiss = miss;
      }
      if (miss * toward < 0) break; // past the aim
    }
    if (last !== best) window.scrollTo(0, best);
  }

  /**
   * How far past a request the document scroll is tried, in CSS px: one
   * screen pixel (1 / the zoom: the step of WebKit on a zoomed-out page as
   * measured in the e2e emulation, whatever the device pixel ratio, which
   * there already holds the zoom) rounded up, and one more for the whole
   * number scrollY reads, within the bounds.
   * @returns {number}
   * @purity semi-pure-b
   */
  static _scrollSearchSpan() {
    const scale = window.visualViewport?.scale || 1;
    return Math.min(SCROLL_SEARCH_MAX_PX, Math.max(SCROLL_SEARCH_MIN_PX, Math.ceil(1 / scale) + 1));
  }

  /**
   * Scroll the document to y, then how far the element's top is from
   * targetTop (positive: below it).
   * @param {Element} element
   * @param {number} targetTop
   * @param {number} y
   * @returns {number}
   * @purity non-pure
   */
  _missAfterScroll(element, targetTop, y) {
    window.scrollTo(0, y);
    return element.getBoundingClientRect().top - targetTop;
  }
}
