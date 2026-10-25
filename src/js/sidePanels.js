// The part of the window the document scrolls in, and the column of
// floating panels (#sidePanels: the Index) at its right edge (INV-77, owner
// rulings 2026-10-25). #preview scrolls on a desktop; on a touch device the
// page scrolls, under the sticky top bar (FS-15).

/** Least room between the panels and the view's edges. */
const EDGE_MARGIN_PX = 8;

/**
 * @purity semi-pure-a
 * @param {HTMLElement} preview
 * @param {HTMLElement} topbar
 * @returns {{scroller: (Window|HTMLElement), top: number, right: number}}
 *   top: the top of the visible document; right: the left edge of the scroll bar
 */
export function documentView(preview, topbar) {
  if (getComputedStyle(preview).overflowY === "visible") {
    return { scroller: window, top: topbar.getBoundingClientRect().bottom, right: document.documentElement.clientWidth };
  }
  const box = preview.getBoundingClientRect();
  return { scroller: preview, top: box.top, right: box.left + preview.clientLeft + preview.clientWidth };
}

/**
 * The column under the top bar, at the right edge of the view, down to the
 * bottom of the window.
 * @purity non-pure
 * @param {HTMLElement} column
 * @param {HTMLElement} preview
 * @param {HTMLElement} topbar
 */
export function placeSidePanels(column, preview, topbar) {
  const view = documentView(preview, topbar);
  const top = view.top + EDGE_MARGIN_PX / 2;
  column.style.top = `${top}px`;
  column.style.right = `${window.innerWidth - view.right + EDGE_MARGIN_PX}px`;
  column.style.maxHeight = `${Math.max(window.innerHeight - top - EDGE_MARGIN_PX, 0)}px`;
}

/**
 * Scroll the document so that the point y (viewport) comes below the top
 * of the view by at least minPx, or by ratio of the view's height.
 * @purity non-pure
 * @param {HTMLElement} preview
 * @param {HTMLElement} topbar
 * @param {number} y
 * @param {number} ratio
 * @param {number} minPx
 */
export function revealInView(preview, topbar, y, ratio, minPx) {
  const view = documentView(preview, topbar);
  const below = Math.max(minPx, ratio * (window.innerHeight - view.top));
  view.scroller.scrollBy(0, y - view.top - below);
}
