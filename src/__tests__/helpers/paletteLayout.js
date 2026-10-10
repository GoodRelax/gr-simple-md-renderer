import { vi } from "vitest";

// Fake layout for EditPalette (jsdom has none). The palette and the popover
// are placed by their style.left / style.top; their buttons sit in one line
// inside them, 28 px square every 32 px, starting 4 px from the corner.
export const PALETTE_SIZE = { width: 200, height: 80 };
export const POPOVER_SIZE = { width: 160, height: 150 };
const BUTTON_SIZE = 28;
const BUTTON_STEP = 32;

/** The palette root and the popover (children of body that EditPalette appended). */
export function paletteElements() {
  return {
    root: document.body.querySelector(":scope > div.edit-palette"),
    popover: document.body.querySelector(":scope > div.edit-palette-popover"),
  };
}

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} };
}

function boxOf(el) {
  const left = parseFloat(el.style.left) || 0;
  const top = parseFloat(el.style.top) || 0;
  const size = el.classList.contains("edit-palette") ? PALETTE_SIZE : POPOVER_SIZE;
  return rect(left, top, size.width, size.height);
}

/** Stub getBoundingClientRect and pointer capture. Restore with vi.restoreAllMocks. */
export function fakePaletteLayout() {
  const original = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
    if (this.classList.contains("edit-palette") || this.classList.contains("edit-palette-popover")) {
      return boxOf(this);
    }
    const container = this.closest(".edit-palette, .edit-palette-popover");
    if (container && (this.tagName === "BUTTON" || this.classList.contains("edit-palette-grip"))) {
      const items = [...container.querySelectorAll("button, .edit-palette-grip")];
      const i = items.indexOf(this);
      const box = boxOf(container);
      return rect(box.left + 4 + BUTTON_STEP * i, box.top + 4, BUTTON_SIZE, BUTTON_SIZE);
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
