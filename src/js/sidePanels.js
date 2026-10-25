// The column of floating panels (#sidePanels: Search above the Index) at the
// right edge of what is shown (INV-77 (6), INV-80 (8)). Where that is comes
// from ScrollMemento: it knows whether #preview or the page scrolls (FS-15).

/** Least room between the panels and the edges of what is shown. */
const EDGE_MARGIN_PX = 8;

/**
 * The column just under the top of what is shown, at its right edge (left
 * of the scroll bar), down to the bottom of the window.
 * @purity non-pure
 * @param {HTMLElement} column
 * @param {ScrollMemento} scrollMemento
 */
export function placeSidePanels(column, scrollMemento) {
  const top = scrollMemento.shownTop() + EDGE_MARGIN_PX / 2;
  column.style.top = `${top}px`;
  column.style.right = `${window.innerWidth - scrollMemento.shownRight() + EDGE_MARGIN_PX}px`;
  column.style.maxHeight = `${Math.max(window.innerHeight - top - EDGE_MARGIN_PX, 0)}px`;
}
