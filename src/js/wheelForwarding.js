// A wheel turn over a small element on the body (position: fixed) that
// stands over the preview: the gap line (INV-73) and the block range bar
// (INV-74). Such an element is not in the preview, so the browser would
// scroll what is under the body: nothing when the preview scrolls itself
// (the desktop layout; owner ruling AQ8). The turn is passed to the preview
// then. When the document scrolls (the touch layout), or with Ctrl (the
// browser's zoom, as over the preview), it is left to the browser.

// A wheel turn given in lines (WheelEvent.DOM_DELTA_LINE): pixels per line,
// as Chromium scrolls a line.
export const WHEEL_LINE_PX = 40;

/**
 * How far a wheel turn scrolls, in pixels: lines and pages turned into
 * pixels; Shift turns a vertical turn sideways.
 * @purity pure
 * @param {{deltaX: number, deltaY: number, deltaMode: number, shiftKey: boolean}} wheel
 * @param {number} pageHeight - the pixels of a page (the scroller's clientHeight)
 * @returns {{left: number, top: number}}
 */
export function wheelScrollDelta(wheel, pageHeight) {
  const unit = wheel.deltaMode === 1 ? WHEEL_LINE_PX : wheel.deltaMode === 2 ? pageHeight : 1;
  let left = wheel.deltaX * unit;
  let top = wheel.deltaY * unit;
  if (wheel.shiftKey && left === 0) [left, top] = [top, 0];
  return { left, top };
}

/**
 * The element is a scroll container (overflow auto or scroll) with more
 * content than it shows.
 * @purity semi-pure-b
 * @param {HTMLElement} el
 * @returns {boolean}
 */
export function isScrollingElement(el) {
  const style = getComputedStyle(el);
  const scrolls = (v) => v === "auto" || v === "scroll";
  return (
    (scrolls(style.overflowY) && el.scrollHeight > el.clientHeight) ||
    (scrolls(style.overflowX) && el.scrollWidth > el.clientWidth)
  );
}

/**
 * Pass a wheel turn to the scroller when it scrolls itself and Ctrl is not
 * held: the browser's default is taken and the scroller scrolls by the
 * turn. Otherwise nothing is done (the browser keeps the turn).
 * @purity non-pure
 * @param {WheelEvent} e - from a listener added with passive: false
 * @param {HTMLElement} scroller
 * @returns {boolean} the turn was passed
 */
export function forwardWheel(e, scroller) {
  if (e.ctrlKey || !isScrollingElement(scroller)) return false;
  e.preventDefault();
  scroller.scrollBy(wheelScrollDelta(e, scroller.clientHeight));
  return true;
}
