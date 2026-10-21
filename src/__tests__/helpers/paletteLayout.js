import { vi } from "vitest";

// Fake layout for EditPalette (jsdom has none). The palette and the popovers
// are placed by their style.left / style.top. The palette's grip and buttons
// sit in a grid of 7 columns, 28 px square every 32 px, starting 4 px from
// the corner; a popover's buttons sit in one line. The minimized palette
// (grip only) is MINIMIZED_SIZE, with its grip 6 px from the corner (so that
// keeping the grip in place moves the palette by 2 px).
export const PALETTE_SIZE = { width: 232, height: 80 };
export const POPOVER_SIZE = { width: 200, height: 150 };
export const MINIMIZED_SIZE = { width: 40, height: 40 };
const BUTTON_SIZE = 28;
const BUTTON_STEP = 32;
const COLUMNS = 7;

/** The palette root and the popovers (children of body that EditPalette appended). */
export function paletteElements() {
  const byId = (id) => [...document.body.children].find((el) => el.id === id && el.classList.contains("edit-palette-popover")) ?? null;
  return {
    root: document.body.querySelector(":scope > div.edit-palette"),
    popover: byId("paletteMermaidMenu"),
    formatMenu: byId("paletteFormatMenu"),
    tableMenu: byId("paletteTableMenu"),
  };
}

/** Remove every palette element EditPalette appended to body. */
export function removePaletteElements() {
  for (const el of document.body.querySelectorAll(":scope > div.edit-palette, :scope > div.edit-palette-popover")) el.remove();
}

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} };
}

function boxOf(el, statusHeight) {
  const left = parseFloat(el.style.left) || 0;
  const top = parseFloat(el.style.top) || 0;
  if (!el.classList.contains("edit-palette")) return rect(left, top, POPOVER_SIZE.width, POPOVER_SIZE.height);
  if (el.classList.contains("edit-palette-minimized")) return rect(left, top, MINIMIZED_SIZE.width, MINIMIZED_SIZE.height);
  const hasStatus = (el.querySelector("#paletteStatus")?.textContent ?? "") !== "";
  return rect(left, top, PALETTE_SIZE.width, PALETTE_SIZE.height + (hasStatus ? statusHeight : 0));
}

/**
 * Stub getBoundingClientRect and pointer capture. Restore with vi.restoreAllMocks.
 * @param {{statusHeight?: number}} [opts] - the palette grows by this much while
 *   its status text is not empty (default 0: a fixed size)
 */
export function fakePaletteLayout({ statusHeight = 0 } = {}) {
  const original = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
    if (this.classList.contains("edit-palette") || this.classList.contains("edit-palette-popover")) {
      return boxOf(this, statusHeight);
    }
    const container = this.closest(".edit-palette, .edit-palette-popover");
    if (container && (this.tagName === "BUTTON" || this.classList.contains("edit-palette-grip"))) {
      const items = [...container.querySelectorAll("button, .edit-palette-grip")];
      const i = items.indexOf(this);
      const box = boxOf(container, statusHeight);
      if (container.classList.contains("edit-palette-minimized")) return rect(box.left + 6, box.top + 6, BUTTON_SIZE, BUTTON_SIZE);
      const columns = container.classList.contains("edit-palette") ? COLUMNS : items.length;
      const col = i % columns;
      const line = Math.floor(i / columns);
      return rect(box.left + 4 + BUTTON_STEP * col, box.top + 4 + BUTTON_STEP * line, BUTTON_SIZE, BUTTON_SIZE);
    }
    return original.call(this);
  });
  const capture = vi.fn();
  const release = vi.fn();
  Element.prototype.setPointerCapture = capture;
  Element.prototype.releasePointerCapture = release;
  return {
    capture,
    release,
    restore() {
      delete Element.prototype.setPointerCapture;
      delete Element.prototype.releasePointerCapture;
    },
  };
}

/** Center of an element in the fake layout. */
export function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Current top-left of the palette or popover. */
export function positionOf(el) {
  return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
}
