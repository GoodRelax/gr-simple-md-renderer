// Where a small floating element goes next to a line of text (INV-74 (2),
// owner ruling D10, ruling U4): right under the line, or above it when
// there is no room under it; always inside the viewport by a margin, also
// when the line itself is out of view. Pure module: it imports nothing and
// reads no global state.

/**
 * The top-left corner of an element of the given size near a line.
 * @purity pure
 * @param {{x: number, top: number, bottom: number}} line - the line's box (x: where it ends)
 * @param {{width: number, height: number}} size - the element's size
 * @param {{width: number, height: number}} view - the viewport's size
 * @param {number} gap - room between the line and the element
 * @param {number} margin - least room between the element and the viewport's edges
 * @returns {{left: number, top: number}}
 */
export function placementNearLine(line, size, view, gap, margin) {
  let top = line.bottom + gap;
  if (top + size.height > view.height - margin) top = line.top - gap - size.height;
  top = Math.min(Math.max(top, margin), Math.max(view.height - size.height - margin, margin));
  const left = Math.min(Math.max(line.x - size.width / 2, margin), Math.max(view.width - size.width - margin, margin));
  return { left, top };
}
