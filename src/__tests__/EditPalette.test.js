import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import EditPalette from "../js/classes/EditPalette.js";
import { CONFIG } from "../js/config.js";
import { pointer, keydown, trackListeners } from "./helpers/editDom.js";
import {
  fakePaletteLayout,
  paletteElements,
  removePaletteElements,
  centerOf,
  positionOf,
  PALETTE_SIZE,
  POPOVER_SIZE,
  MINIMIZED_SIZE,
} from "./helpers/paletteLayout.js";

const here = dirname(fileURLToPath(import.meta.url));
const jsDir = resolve(here, "../js");
const css = readFileSync(resolve(here, "../css/style.css"), "utf8");

const MARGIN = CONFIG.edit.paletteMarginPx;
const W = 1024;
const H = 768;

// Every key of setButtonStates (5.15.5) true.
const ALL_ON = {
  bold: true,
  italic: true,
  format: true,
  textColor: true,
  linkPaste: true,
  linkRemove: true,
  insertTable: true,
  insertMermaid: true,
  undo: true,
  insertRow: true,
  insertColumn: true,
  rowDelete: true,
  columnDelete: true,
  tableOptions: true,
  insertInlineMath: true,
  insertMathBox: true,
  alignment: null,
};

let palette;
let host;
let layout;
let root;
let popover;
let formatMenu;
let tableMenu;

function setViewport(width, height) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

beforeEach(() => {
  setViewport(W, H);
  layout = fakePaletteLayout();
  host = { runCommand: vi.fn() };
  palette = new EditPalette(host);
  ({ root, popover, formatMenu, tableMenu } = paletteElements());
});

afterEach(() => {
  palette.hide();
  removePaletteElements();
  layout.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const btn = (id) => root.querySelector(`#${id}`);
const popBtn = (label) => [...popover.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label);
const off = (el) => el.getAttribute("aria-disabled") === "true";
const grip = () => root.querySelector(".edit-palette-grip");

/** pointerdown at the center of el, then pointerup moved by (dx, dy) from there. */
function press(el, { dx = 0, dy = 0, upEl = el } = {}) {
  const c = centerOf(el);
  const down = pointer(el, "pointerdown", { x: c.x, y: c.y });
  pointer(upEl, "pointerup", { x: c.x + dx, y: c.y + dy });
  return down;
}

function enableAll() {
  palette.setButtonStates(ALL_ON);
}

/** Press the grip, wait the long press time, release (fake timers must be on). */
function longPressGrip() {
  const c = centerOf(grip());
  pointer(grip(), "pointerdown", { x: c.x, y: c.y });
  vi.advanceTimersByTime(CONFIG.edit.paletteLongPressMs);
  pointer(grip(), "pointerup", { x: c.x, y: c.y });
}

describe("AT-PAL show and layout (INV-32, 5.15.1)", () => {
  it("AT-PAL-01 show: a fixed toolbar directly under body, bottom-right with the margin", () => {
    palette.show();
    expect(root).not.toBeNull();
    expect(root.parentNode).toBe(document.body);
    expect(root.id).toBe("editPalette");
    expect(root.getAttribute("role")).toBe("toolbar");
    expect(root.getAttribute("aria-label")).toBe("Edit palette");
    expect(root.style.position).toBe("fixed");
    expect(root.hidden).toBe(false);
    expect(positionOf(root)).toEqual({
      left: W - PALETTE_SIZE.width - MARGIN,
      top: H - PALETTE_SIZE.height - MARGIN,
    });
    expect(palette.isShown()).toBe(true);
  });

  describe("PRT-U16 a status text that changes the size keeps the bottom-right corner (INV-32)", () => {
    const STATUS_H = 11;
    beforeEach(() => {
      vi.restoreAllMocks();
      layout.restore();
      layout = fakePaletteLayout({ statusHeight: STATUS_H });
    });

    const nextFrame = () => new Promise((r) => setTimeout(r, 40));

    it("setStatusText reads no layout itself (a commit must not force a layout of the preview)", () => {
      palette.show();
      const reads = vi.mocked(Element.prototype.getBoundingClientRect).mock.calls.length;
      palette.setStatusText("doc.md * unsaved");
      expect(vi.mocked(Element.prototype.getBoundingClientRect).mock.calls.length).toBe(reads);
    });

    it("shown with no status, then the status arrives: the bottom margin stays 16 px (from the next frame)", async () => {
      palette.show();
      palette.setStatusText("untitled.md - saved");
      await nextFrame();
      expect(positionOf(root)).toEqual({
        left: W - PALETTE_SIZE.width - MARGIN,
        top: H - (PALETTE_SIZE.height + STATUS_H) - MARGIN,
      });
    });

    it("a palette the user moved keeps its bottom edge too", async () => {
      palette.show();
      const c = centerOf(grip());
      pointer(grip(), "pointerdown", { x: c.x, y: c.y });
      pointer(grip(), "pointermove", { x: c.x - 300, y: c.y - 200 });
      pointer(grip(), "pointerup", { x: c.x - 300, y: c.y - 200 });
      const before = positionOf(root);
      palette.setStatusText("doc.md * unsaved");
      await nextFrame();
      expect(positionOf(root)).toEqual({ left: before.left, top: before.top - STATUS_H });
    });

    it("the same text again, or a hidden palette, does not move it", async () => {
      palette.setStatusText("untitled.md - saved"); // hidden: nothing placed
      await nextFrame();
      expect(root.style.top).toBe("");
      palette.show();
      const shown = positionOf(root);
      palette.setStatusText("untitled.md - saved");
      await nextFrame();
      expect(positionOf(root)).toEqual(shown);
    });

    it("a palette hidden before the frame is not moved", async () => {
      palette.show();
      const shown = positionOf(root);
      palette.setStatusText("doc.md * unsaved");
      palette.hide();
      await nextFrame();
      expect(positionOf(root)).toEqual(shown);
    });
  });

  it("AT-PAL-02 the position is not remembered, and nothing is stored", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    palette.show();
    const c = centerOf(grip());
    pointer(grip(), "pointerdown", { x: c.x, y: c.y });
    pointer(grip(), "pointermove", { x: 50, y: 50 });
    pointer(grip(), "pointerup", { x: 50, y: 50 });
    expect(positionOf(root).left).toBeLessThan(200);
    palette.hide();
    expect(root.hidden).toBe(true);
    palette.show();
    expect(positionOf(root)).toEqual({ left: W - PALETTE_SIZE.width - MARGIN, top: H - PALETTE_SIZE.height - MARGIN });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("AT-PAL-03 7 x 2: the grip and 13 buttons in two rows, no separators; labels and inline SVG only", () => {
    const rows = [...root.querySelectorAll(".edit-palette-row")];
    expect(rows).toHaveLength(2);
    const ids = (r) => [...r.children].map((el) => el.id);
    expect(ids(rows[0])).toEqual(["paletteGrip", "paletteBold", "paletteItalic", "paletteFormat", "paletteMermaid", "paletteSave", "paletteSaveAs"]);
    expect(ids(rows[1])).toEqual([
      "paletteTable",
      "paletteRow",
      "paletteRowDelete",
      "paletteColumn",
      "paletteColumnDelete",
      "paletteTableOptions",
      "paletteUndo",
    ]);
    expect(root.querySelector(".edit-palette-sep")).toBeNull();
    expect(root.querySelector("#paletteStatus")).not.toBeNull();
    const labels = {
      paletteGrip: "Move palette (double-click or long press: minimize / restore)",
      paletteBold: "Bold (Ctrl+B)",
      paletteItalic: "Italic (Ctrl+I)",
      paletteFormat: "Text format",
      paletteMermaid: "Insert Mermaid sample",
      paletteSave: "Save (Ctrl+S)",
      paletteSaveAs: "Save as (Ctrl+Shift+S)",
      paletteTable: "Insert table",
      paletteRow: "Insert row",
      paletteRowDelete: "Delete row",
      paletteColumn: "Insert column",
      paletteColumnDelete: "Delete column",
      paletteTableOptions: "Align column",
      paletteUndo: "Undo (Ctrl+Z)",
    };
    for (const [id, label] of Object.entries(labels)) {
      const el = root.querySelector(`#${id}`);
      expect(el.getAttribute("title"), id).toBe(label);
      expect(el.getAttribute("aria-label"), id).toBe(label);
      expect(el.querySelector("svg"), id).not.toBeNull();
    }
    for (const id of ["paletteMermaid", "paletteFormat", "paletteTableOptions"]) {
      expect(btn(id).querySelectorAll("svg"), id).toHaveLength(2); // icon + submenu mark
      expect(btn(id).hasAttribute("aria-haspopup"), id).toBe(false); // the popover is a toolbar, not a menu
      expect(btn(id).getAttribute("aria-expanded"), id).toBe("false");
    }
    for (const el of [root, popover, formatMenu, tableMenu]) {
      expect(el.querySelector("img, use, image, script, foreignObject")).toBeNull();
      for (const node of el.querySelectorAll("*")) {
        expect(node.hasAttribute("href")).toBe(false);
        expect(node.hasAttribute("xlink:href")).toBe(false);
        expect(node.hasAttribute("src")).toBe(false);
        expect(node.getAttribute("style") ?? "").not.toContain("url(");
      }
    }
  });

  it("AT-PAL-03 the three popovers: ids, labels and buttons (5.1, 5.15.3)", () => {
    expect(popover.getAttribute("aria-label")).toBe("Mermaid samples");
    expect(formatMenu.getAttribute("aria-label")).toBe("Text format");
    expect(tableMenu.getAttribute("aria-label")).toBe("Align column");
    for (const el of [popover, formatMenu, tableMenu]) {
      expect(el.parentNode).toBe(document.body);
      expect(el.getAttribute("role")).toBe("toolbar");
      expect(el.style.position).toBe("fixed");
      expect(el.hidden).toBe(true);
    }
    const items = (el) => [...el.querySelectorAll("button")].map((b) => [b.id, b.getAttribute("aria-label")]);
    expect(items(formatMenu)).toEqual([
      ["paletteColorRed", "Text color: Red"],
      ["paletteColorBlue", "Text color: Blue"],
      ["paletteColorGreen", "Text color: Green"],
      ["paletteColorNone", "Remove text color"],
      ["paletteLinkPaste", "Paste copied link"],
      ["paletteLinkRemove", "Remove link"],
      ["paletteInlineMath", "Insert inline math: Euler's number (Napier's constant)"],
      ["paletteMathBox", "Insert math boxes: Maxwell, Einstein, Schroedinger"],
    ]);
    expect(items(tableMenu)).toEqual([
      ["paletteAlignLeft", "Align left"],
      ["paletteAlignCenter", "Align center"],
      ["paletteAlignRight", "Align right"],
      ["paletteAlignNone", "Remove alignment"],
    ]);
    for (const color of ["red", "blue", "green"]) {
      const b = formatMenu.querySelector(`.edit-palette-swatch-${color}`);
      expect(b.classList.contains("edit-palette-swatch")).toBe(true);
      expect(b.querySelector("svg").getAttribute("fill")).toBe("currentColor");
    }
    for (const b of [...formatMenu.querySelectorAll("button"), ...tableMenu.querySelectorAll("button")]) {
      expect(b.getAttribute("title")).toBe(b.getAttribute("aria-label"));
      expect(b.querySelector("svg")).not.toBeNull();
    }
  });

  it("AT-PAL-36 Text format has two rows: the formats, then inline math and the math boxes (owner ruling 2026-10-25)", () => {
    expect(formatMenu.classList.contains("edit-palette-popover-rows")).toBe(true);
    const rows = [...formatMenu.children];
    expect(rows.map((r) => r.className)).toEqual(["edit-palette-popover-row", "edit-palette-popover-row"]);
    const ids = (r) => [...r.children].map((el) => el.id);
    expect(ids(rows[0])).toEqual(["paletteColorRed", "paletteColorBlue", "paletteColorGreen", "paletteColorNone", "paletteLinkPaste", "paletteLinkRemove"]);
    expect(ids(rows[1])).toEqual(["paletteInlineMath", "paletteMathBox"]);
    // one press each: no submenu mark, no popover of their own
    for (const id of ["paletteInlineMath", "paletteMathBox"]) {
      const b = formatMenu.querySelector(`#${id}`);
      expect(b.querySelectorAll("svg"), id).toHaveLength(1);
      expect(b.hasAttribute("aria-expanded"), id).toBe(false);
      expect(b.tabIndex, id).toBe(-1);
    }
    // the other popovers keep one row of buttons
    for (const el of [popover, tableMenu]) {
      expect(el.classList.contains("edit-palette-popover-rows")).toBe(false);
      expect([...el.children].every((c) => c.tagName === "BUTTON")).toBe(true);
    }
  });

  it("AT-PAL-03 on Apple platforms the tooltips say Cmd (INV-14 platform test)", () => {
    removePaletteElements();
    palette = new EditPalette(host, { isApple: true });
    ({ root } = paletteElements());
    expect(btn("paletteBold").title).toBe("Bold (Cmd+B)");
    expect(btn("paletteSaveAs").title).toBe("Save as (Cmd+Shift+S)");
    expect(btn("paletteUndo").getAttribute("aria-label")).toBe("Undo (Cmd+Z)");
  });

  it("AT-PAL-04 there is no minimize button and no Redo button", () => {
    const text = [...root.querySelectorAll("button[aria-label]")].map((el) => el.getAttribute("aria-label").toLowerCase());
    expect(text.some((t) => t.includes("minim"))).toBe(false);
    expect(text.some((t) => t.includes("redo"))).toBe(false);
  });
});

describe("AT-PAL gestures (INV-34, INV-35, INV-36)", () => {
  beforeEach(() => {
    palette.show();
    enableAll();
  });

  it("AT-PAL-05 press and release inside an enabled button runs the command once, on release", () => {
    const b = btn("paletteTable");
    const c = centerOf(b);
    pointer(b, "pointerdown", { x: c.x, y: c.y });
    expect(host.runCommand).not.toHaveBeenCalled();
    pointer(b, "pointerup", { x: c.x + 3, y: c.y + 3 });
    expect(host.runCommand).toHaveBeenCalledTimes(1);
    expect(host.runCommand).toHaveBeenCalledWith("insertTable");
  });

  it("AT-PAL-06 a click event alone runs nothing", () => {
    btn("paletteTable").click();
    btn("paletteSave").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(host.runCommand).not.toHaveBeenCalled();
  });

  it("AT-PAL-07 leaving the pressed button moves the palette with the pointer; release runs nothing", () => {
    const b = btn("paletteTable");
    const c = centerOf(b);
    const before = positionOf(root);
    pointer(b, "pointerdown", { x: c.x, y: c.y });
    pointer(b, "pointermove", { x: c.x - 40, y: c.y }); // out of the button: switches to moving
    pointer(b, "pointermove", { x: c.x - 140, y: c.y - 100 });
    expect(positionOf(root)).toEqual({ left: before.left - 100, top: before.top - 100 });
    pointer(b, "pointerup", { x: c.x - 140, y: c.y - 100 });
    expect(host.runCommand).not.toHaveBeenCalled();
  });

  it("AT-PAL-08 out and back onto the button, then release: nothing runs", () => {
    const b = btn("paletteTable");
    const c = centerOf(b);
    pointer(b, "pointerdown", { x: c.x, y: c.y });
    pointer(b, "pointermove", { x: c.x + 40, y: c.y });
    pointer(b, "pointermove", { x: c.x, y: c.y });
    const back = centerOf(b);
    pointer(b, "pointerup", { x: back.x, y: back.y });
    expect(host.runCommand).not.toHaveBeenCalled();
  });

  it("AT-PAL-09 small moves inside the pressed button keep the press; release runs", () => {
    const b = btn("paletteBold");
    const c = centerOf(b);
    const before = positionOf(root);
    pointer(b, "pointerdown", { x: c.x, y: c.y });
    pointer(b, "pointermove", { x: c.x + 10, y: c.y - 10 });
    expect(positionOf(root)).toEqual(before);
    pointer(b, "pointerup", { x: c.x + 10, y: c.y - 10 });
    expect(host.runCommand).toHaveBeenCalledWith("bold");
  });

  it("AT-PAL-10 pressing the gap moves from the start; release runs nothing", () => {
    const start = { x: positionOf(root).left + 190, y: positionOf(root).top + 70 };
    const before = positionOf(root);
    pointer(root, "pointerdown", { x: start.x, y: start.y });
    pointer(root, "pointermove", { x: start.x - 3, y: start.y - 2 });
    expect(positionOf(root)).toEqual({ left: before.left - 3, top: before.top - 2 });
    pointer(root, "pointermove", { x: start.x - 30, y: start.y - 20 });
    expect(positionOf(root)).toEqual({ left: before.left - 30, top: before.top - 20 });
    pointer(root, "pointerup", { x: start.x - 30, y: start.y - 20 });
    expect(host.runCommand).not.toHaveBeenCalled();
  });

  it("AT-PAL-10 pressing the grip moves once the pointer goes beyond the threshold (INV-68); release runs nothing", () => {
    const start = centerOf(grip());
    const before = positionOf(root);
    const t = CONFIG.pan.activationThresholdPx;
    pointer(grip(), "pointerdown", { x: start.x, y: start.y });
    pointer(grip(), "pointermove", { x: start.x - t, y: start.y }); // at the threshold: not yet
    expect(positionOf(root)).toEqual(before);
    pointer(grip(), "pointermove", { x: start.x - 30, y: start.y - 20 });
    expect(positionOf(root)).toEqual({ left: before.left - 30, top: before.top - 20 });
    pointer(grip(), "pointerup", { x: start.x - 30, y: start.y - 20 });
    expect(host.runCommand).not.toHaveBeenCalled();
  });

  it("AT-PAL-11 a disabled palette button: pressing it moves the palette from the start (INV-35); nothing runs", () => {
    palette.setButtonStates({});
    const b = btn("paletteBold");
    expect(off(b)).toBe(true);
    expect(b.disabled).toBe(false); // aria-disabled: the button still gets the pointer events
    const c = centerOf(b);
    const before = positionOf(root);
    pointer(b, "pointerdown", { x: c.x, y: c.y });
    pointer(b, "pointermove", { x: c.x - 3, y: c.y - 2 }); // a move inside the button already moves
    expect(positionOf(root)).toEqual({ left: before.left - 3, top: before.top - 2 });
    pointer(b, "pointermove", { x: c.x - 100, y: c.y - 100 });
    pointer(b, "pointerup", { x: c.x - 100, y: c.y - 100 });
    expect(host.runCommand).not.toHaveBeenCalled();
    expect(positionOf(root)).toEqual({ left: before.left - 100, top: before.top - 100 });
  });

  it("AT-PAL-11 a disabled popover button and the popover gap: nothing runs and nothing moves (INV-34, INV-35)", () => {
    press(btn("paletteFormat"));
    palette.setButtonStates({ ...ALL_ON, textColor: false });
    expect(formatMenu.hidden).toBe(false);
    const red = formatMenu.querySelector("#paletteColorRed");
    const before = positionOf(root);
    for (const [el, x, y] of [
      [red, centerOf(red).x, centerOf(red).y],
      [formatMenu, positionOf(formatMenu).left + 150, positionOf(formatMenu).top + 140],
    ]) {
      pointer(el, "pointerdown", { x, y });
      pointer(el, "pointermove", { x: x - 80, y: y - 50 });
      pointer(el, "pointerup", { x: x - 80, y: y - 50 });
    }
    expect(host.runCommand).not.toHaveBeenCalled();
    expect(positionOf(root)).toEqual(before);
    expect(formatMenu.hidden).toBe(false);
  });

  it.each(["pressing", "dragging"])("AT-PAL-12 pointercancel while %s returns to idle and runs nothing", (mode) => {
    const b = btn("paletteTable");
    const c = centerOf(b);
    pointer(b, "pointerdown", { x: c.x, y: c.y });
    if (mode === "dragging") pointer(b, "pointermove", { x: c.x - 50, y: c.y });
    pointer(b, "pointercancel", { x: c.x, y: c.y });
    const before = positionOf(root);
    pointer(b, "pointermove", { x: c.x - 200, y: c.y - 200 });
    expect(positionOf(root)).toEqual(before);
    pointer(b, "pointerup", { x: c.x, y: c.y });
    expect(host.runCommand).not.toHaveBeenCalled();
  });

  it("AT-PAL-13 the press captures the pointer; hide during the gesture releases it", () => {
    const b = btn("paletteTable");
    const c = centerOf(b);
    pointer(b, "pointerdown", { x: c.x, y: c.y });
    expect(layout.capture).toHaveBeenCalledWith(1);
    palette.hide();
    expect(layout.release).toHaveBeenCalledWith(1);
  });

  it("AT-PAL-14 the palette pointerdown is prevented: the editor keeps focus and selection", () => {
    const ta = document.createElement("textarea");
    ta.value = "Hello word here";
    document.body.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(6, 10);
    const down = press(btn("paletteBold"));
    expect(down.defaultPrevented).toBe(true);
    const gripDown = press(grip());
    expect(gripDown.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(ta);
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([6, 10]);
    ta.remove();
  });

  it("AT-PAL-15 dragging past the viewport stops at the edges", () => {
    const c = centerOf(grip());
    pointer(grip(), "pointerdown", { x: c.x, y: c.y });
    pointer(grip(), "pointermove", { x: -5000, y: -5000 });
    expect(positionOf(root)).toEqual({ left: 0, top: 0 });
    pointer(grip(), "pointermove", { x: 9000, y: 9000 });
    expect(positionOf(root)).toEqual({ left: W - PALETTE_SIZE.width, top: H - PALETTE_SIZE.height });
    pointer(grip(), "pointerup", { x: 9000, y: 9000 });
  });

  it("AT-PAL-16 a smaller viewport (resize) moves the palette back inside", () => {
    setViewport(500, 300);
    window.dispatchEvent(new Event("resize"));
    expect(positionOf(root)).toEqual({ left: 500 - PALETTE_SIZE.width, top: 300 - PALETTE_SIZE.height });
  });

  it("AT-PAL-16 a resize keeps an open popover open and inside the viewport (11-f viewportResized)", () => {
    press(btn("paletteFormat"));
    setViewport(500, 300);
    window.dispatchEvent(new Event("resize"));
    expect(formatMenu.hidden).toBe(false);
    const pop = positionOf(formatMenu);
    expect(pop.left + POPOVER_SIZE.width).toBeLessThanOrEqual(500);
    expect(pop.top + POPOVER_SIZE.height).toBeLessThanOrEqual(300);
  });
});

describe("AT-PAL popovers (5.15.1, 11-f, INV-37, INV-53)", () => {
  beforeEach(() => {
    palette.show();
    enableAll();
  });

  function moveRootTo(left, top) {
    const c = centerOf(grip());
    const p = positionOf(root);
    pointer(grip(), "pointerdown", { x: c.x, y: c.y });
    pointer(grip(), "pointermove", { x: c.x + left - p.left, y: c.y + top - p.top });
    pointer(grip(), "pointerup", { x: c.x + left - p.left, y: c.y + top - p.top });
  }

  it("AT-PAL-17 at the right edge the popover opens on the left; at the left edge on the right; always inside", () => {
    press(btn("paletteMermaid"));
    expect(popover.hidden).toBe(false);
    const p = positionOf(root);
    const pop = positionOf(popover);
    expect(pop.left + POPOVER_SIZE.width).toBeLessThanOrEqual(p.left);
    expect(pop.top).toBeGreaterThanOrEqual(0);
    expect(pop.top + POPOVER_SIZE.height).toBeLessThanOrEqual(H);
    press(btn("paletteMermaid")); // toggles closed
    expect(popover.hidden).toBe(true);

    moveRootTo(0, 0);
    press(btn("paletteMermaid"));
    const p2 = positionOf(root);
    const pop2 = positionOf(popover);
    expect(pop2.left).toBeGreaterThanOrEqual(p2.left + PALETTE_SIZE.width);
    expect(pop2.left + POPOVER_SIZE.width).toBeLessThanOrEqual(W);
    expect(pop2.top).toBeGreaterThanOrEqual(0);
    expect(pop2.top + POPOVER_SIZE.height).toBeLessThanOrEqual(H);
  });

  it.each([
    ["choosing a sample", () => press(popBtn("Flowchart"))],
    ["Esc (document capture, INV-53)", () => keydown(document.body, "Escape")],
    ["a pointerdown outside palette and popover", () => pointer(document.body, "pointerdown")],
    ["hiding the palette", () => palette.hide()],
    ["the opener becoming disabled", () => palette.setButtonStates({ ...ALL_ON, insertMermaid: false })],
  ])("AT-PAL-18 closes on %s", (_name, act) => {
    press(btn("paletteMermaid"));
    expect(popover.hidden).toBe(false);
    expect(btn("paletteMermaid").getAttribute("aria-expanded")).toBe("true");
    act();
    expect(popover.hidden).toBe(true);
    expect(btn("paletteMermaid").getAttribute("aria-expanded")).toBe("false");
  });

  it("AT-PAL-18 a pointerdown on the palette or the popover keeps it open", () => {
    press(btn("paletteMermaid"));
    pointer(root, "pointerdown", { x: positionOf(root).left + 190, y: positionOf(root).top + 70 });
    pointer(root, "pointerup", { x: positionOf(root).left + 190, y: positionOf(root).top + 70 });
    pointer(popover, "pointerdown", { x: positionOf(popover).left + 150, y: positionOf(popover).top + 140 });
    pointer(popover, "pointerup", { x: positionOf(popover).left + 150, y: positionOf(popover).top + 140 });
    expect(popover.hidden).toBe(false);
  });

  it("AT-PAL-18 one popover at a time: another opener switches; a disabled item keeps it open", () => {
    press(btn("paletteMermaid"));
    press(btn("paletteFormat"));
    expect(popover.hidden).toBe(true);
    expect(formatMenu.hidden).toBe(false);
    press(btn("paletteTableOptions"));
    expect(formatMenu.hidden).toBe(true);
    expect(tableMenu.hidden).toBe(false);
    palette.setButtonStates({ ...ALL_ON, alignment: "left" }); // the items stay enabled
    expect(tableMenu.hidden).toBe(false);
    press(btn("paletteTableOptions"));
    expect(tableMenu.hidden).toBe(true);
  });

  it("AT-PAL-18 Esc in a popover goes no further: not to an editor, not to the document; IME Esc is left alone", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    const seen = vi.fn();
    ta.addEventListener("keydown", seen);
    document.addEventListener("keydown", seen);
    press(btn("paletteFormat"));
    const ime = keydown(ta, "Escape", { isComposing: true });
    expect(ime.defaultPrevented).toBe(false);
    expect(formatMenu.hidden).toBe(false);
    const ime229 = keydown(ta, "Escape", { keyCode: 229 });
    expect(ime229.defaultPrevented).toBe(false);
    expect(seen).toHaveBeenCalledTimes(4);
    seen.mockClear();
    const e = keydown(ta, "Escape");
    expect(e.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    expect(formatMenu.hidden).toBe(true);
    const next = keydown(ta, "Escape"); // no popover open: not taken
    expect(next.defaultPrevented).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    document.removeEventListener("keydown", seen);
    ta.remove();
  });

  it("AT-PAL-19 four sample buttons; press and release runs; moving away does nothing (INV-35)", () => {
    press(btn("paletteMermaid"));
    const labels = [...popover.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Flowchart", "Sequence diagram", "State diagram", "Class diagram"]);
    for (const b of popover.querySelectorAll("button")) {
      expect(b.getAttribute("title")).toBe(b.getAttribute("aria-label"));
      expect(b.querySelector("svg")).not.toBeNull();
    }
    const down = press(popBtn("State diagram"));
    expect(down.defaultPrevented).toBe(true);
    expect(host.runCommand).toHaveBeenCalledWith("insertMermaid", "state");

    press(btn("paletteMermaid"));
    const b = popBtn("Class diagram");
    const c = centerOf(b);
    const before = positionOf(root);
    pointer(b, "pointerdown", { x: c.x, y: c.y });
    pointer(b, "pointermove", { x: c.x - 60, y: c.y });
    expect(layout.release).toHaveBeenCalledWith(1); // 11-d: idle / releasePointer
    pointer(b, "pointermove", { x: c.x - 80, y: c.y - 30 });
    pointer(b, "pointermove", { x: c.x, y: c.y }); // back on the button
    pointer(b, "pointerup", { x: c.x, y: c.y });
    expect(host.runCommand).toHaveBeenCalledTimes(1);
    expect(positionOf(root)).toEqual(before);
    expect(popover.hidden).toBe(false);
  });

  it.each([
    ["flowchart", "Flowchart"],
    ["sequence", "Sequence diagram"],
    ["state", "State diagram"],
    ["class", "Class diagram"],
  ])("AT-PAL-19 %s sample key", (key, label) => {
    expect(Object.keys(CONFIG.edit.mermaidSamples)).toContain(key);
    press(btn("paletteMermaid"));
    press(popBtn(label));
    expect(host.runCommand).toHaveBeenCalledWith("insertMermaid", key);
  });

  it("AT-PAL-19 the format and table items run with their command and argument, and close the popover", () => {
    const cases = [
      ["paletteFormat", formatMenu, "paletteColorRed", ["textColor", "red"]],
      ["paletteFormat", formatMenu, "paletteColorBlue", ["textColor", "blue"]],
      ["paletteFormat", formatMenu, "paletteColorGreen", ["textColor", "green"]],
      ["paletteFormat", formatMenu, "paletteColorNone", ["textColor", "none"]],
      ["paletteFormat", formatMenu, "paletteLinkPaste", ["linkPaste", undefined]],
      ["paletteFormat", formatMenu, "paletteLinkRemove", ["linkRemove", undefined]],
      ["paletteFormat", formatMenu, "paletteInlineMath", ["insertInlineMath", undefined]], // AT-PAL-36
      ["paletteFormat", formatMenu, "paletteMathBox", ["insertMathBox", undefined]],
      ["paletteTableOptions", tableMenu, "paletteAlignLeft", ["alignColumn", "left"]],
      ["paletteTableOptions", tableMenu, "paletteAlignCenter", ["alignColumn", "center"]],
      ["paletteTableOptions", tableMenu, "paletteAlignRight", ["alignColumn", "right"]],
      ["paletteTableOptions", tableMenu, "paletteAlignNone", ["alignColumn", "none"]],
    ];
    for (const [opener, menu, id, args] of cases) {
      host.runCommand.mockClear();
      press(btn(opener));
      expect(menu.hidden, id).toBe(false);
      press(menu.querySelector(`#${id}`));
      expect(host.runCommand, id).toHaveBeenCalledTimes(1);
      expect(host.runCommand, id).toHaveBeenCalledWith(...args);
      expect(menu.hidden, id).toBe(true);
    }
  });
});

describe("AT-PAL minimize (INV-68, 11-f)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    palette.show();
    enableAll();
  });

  it("AT-PAL-30 a long press on the grip minimizes at the time, keeping the grip in place; another restores", () => {
    const gripBefore = grip().getBoundingClientRect();
    const c = centerOf(grip());
    pointer(grip(), "pointerdown", { x: c.x, y: c.y });
    vi.advanceTimersByTime(CONFIG.edit.paletteLongPressMs - 1);
    expect(palette.isMinimized()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(palette.isMinimized()).toBe(true); // before the release
    expect(root.classList.contains("edit-palette-minimized")).toBe(true);
    expect(grip().getBoundingClientRect().left).toBe(gripBefore.left);
    expect(grip().getBoundingClientRect().top).toBe(gripBefore.top);
    const before = positionOf(root);
    pointer(grip(), "pointermove", { x: c.x - 100, y: c.y - 100 }); // no move until the release
    expect(positionOf(root)).toEqual(before);
    pointer(grip(), "pointerup", { x: c.x - 100, y: c.y - 100 });
    expect(host.runCommand).not.toHaveBeenCalled();

    longPressGrip();
    expect(palette.isMinimized()).toBe(false);
    expect(root.classList.contains("edit-palette-minimized")).toBe(false);
    expect(grip().getBoundingClientRect().left).toBe(gripBefore.left);
  });

  it("AT-PAL-31 a short press, or a move beyond the threshold before the time, does not minimize", () => {
    press(grip());
    vi.advanceTimersByTime(CONFIG.edit.paletteLongPressMs * 2);
    expect(palette.isMinimized()).toBe(false);

    const c = centerOf(grip());
    pointer(grip(), "pointerdown", { x: c.x, y: c.y });
    pointer(grip(), "pointermove", { x: c.x - CONFIG.pan.activationThresholdPx - 1, y: c.y });
    vi.advanceTimersByTime(CONFIG.edit.paletteLongPressMs * 2);
    expect(palette.isMinimized()).toBe(false);
    pointer(grip(), "pointerup", { x: c.x - 20, y: c.y });

    pointer(grip(), "pointerdown", { x: c.x, y: c.y });
    pointer(grip(), "pointermove", { x: c.x - CONFIG.pan.activationThresholdPx, y: c.y }); // within: still a long press
    vi.advanceTimersByTime(CONFIG.edit.paletteLongPressMs);
    expect(palette.isMinimized()).toBe(true);
    pointer(grip(), "pointerup", { x: c.x, y: c.y });
  });

  it("AT-PAL-31 only the grip: a long press on a button, a disabled button or the gap does not minimize", () => {
    palette.setButtonStates({ ...ALL_ON, bold: false });
    const gap = { x: positionOf(root).left + 228, y: positionOf(root).top + 76 };
    for (const [el, x, y] of [
      [btn("paletteTable"), centerOf(btn("paletteTable")).x, centerOf(btn("paletteTable")).y],
      [btn("paletteBold"), centerOf(btn("paletteBold")).x, centerOf(btn("paletteBold")).y],
      [root, gap.x, gap.y],
    ]) {
      pointer(el, "pointerdown", { x, y });
      vi.advanceTimersByTime(CONFIG.edit.paletteLongPressMs * 2);
      expect(palette.isMinimized(), el.id || "gap").toBe(false);
      pointer(el, "pointerup", { x, y });
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["pointercancel", () => pointer(grip(), "pointercancel")],
    ["hide", () => palette.hide()],
  ])("AT-PAL-32 the long press timer stops on %s", (_name, act) => {
    const c = centerOf(grip());
    pointer(grip(), "pointerdown", { x: c.x, y: c.y });
    act();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(CONFIG.edit.paletteLongPressMs * 2);
    expect(palette.isMinimized()).toBe(false);
  });

  it("AT-PAL-33 minimizing closes an open popover; the unsaved dot is a class; showing again is not minimized, bottom-right", () => {
    press(btn("paletteFormat"));
    expect(formatMenu.hidden).toBe(false);
    longPressGrip();
    expect(formatMenu.hidden).toBe(true);
    expect(btn("paletteFormat").getAttribute("aria-expanded")).toBe("false");
    palette.setUnsaved(true);
    expect(root.classList.contains("edit-palette-unsaved")).toBe(true);
    palette.setUnsaved(false);
    expect(root.classList.contains("edit-palette-unsaved")).toBe(false);
    palette.hide();
    expect(root.classList.contains("edit-palette-minimized")).toBe(false);
    palette.show();
    expect(palette.isMinimized()).toBe(false);
    expect(positionOf(root)).toEqual({ left: W - PALETTE_SIZE.width - MARGIN, top: H - PALETTE_SIZE.height - MARGIN });
  });

  it("AT-PAL-34 restoring near the edge keeps the expanded palette inside the viewport (clampIntoViewport)", () => {
    longPressGrip();
    // Move the minimized palette to the bottom-right corner.
    const c = centerOf(grip());
    pointer(grip(), "pointerdown", { x: c.x, y: c.y });
    pointer(grip(), "pointermove", { x: 9000, y: 9000 });
    pointer(grip(), "pointerup", { x: 9000, y: 9000 });
    expect(positionOf(root)).toEqual({ left: W - MINIMIZED_SIZE.width, top: H - MINIMIZED_SIZE.height });
    longPressGrip();
    expect(palette.isMinimized()).toBe(false);
    expect(positionOf(root)).toEqual({ left: W - PALETTE_SIZE.width, top: H - PALETTE_SIZE.height });
  });

  it("AT-PAL-35 no context menu on the palette and the popovers; -webkit-touch-callout is none (INV-68)", () => {
    for (const el of [grip(), btn("paletteBold"), popover, formatMenu, tableMenu]) {
      const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    }
    const rule = /\.edit-palette,\s*\.edit-palette-popover\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule).toContain("-webkit-touch-callout: none");
  });

  it("AT-PAL-37 a double click on the grip minimizes and restores, keeping the grip in place, the editor's focus and selection (INV-68, INV-36)", () => {
    const editor = document.createElement("textarea");
    editor.value = "Hello world";
    document.body.appendChild(editor);
    editor.focus();
    editor.setSelectionRange(2, 7);
    const gripBefore = grip().getBoundingClientRect();
    const doubleClick = () => {
      const c = centerOf(grip());
      const downs = [];
      for (let i = 0; i < 2; i++) {
        downs.push(pointer(grip(), "pointerdown", { x: c.x, y: c.y }));
        pointer(grip(), "pointerup", { x: c.x, y: c.y });
      }
      // The grip press captures the pointer on the palette, so browsers send
      // the dblclick to the palette, not to the grip (e2e paletteDoubleClick).
      root.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }));
      return downs;
    };
    const downs = doubleClick();
    expect(downs.every((e) => e.defaultPrevented)).toBe(true); // no text selection, no focus move
    expect(palette.isMinimized()).toBe(true);
    expect(grip().getBoundingClientRect().left).toBe(gripBefore.left);
    expect(grip().getBoundingClientRect().top).toBe(gripBefore.top);
    doubleClick();
    expect(palette.isMinimized()).toBe(false);
    expect(document.activeElement).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 7]);
    expect(host.runCommand).not.toHaveBeenCalled();
    const rule = /\.edit-palette\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule).toContain("user-select: none");
    expect(rule).toContain("touch-action: none"); // no browser zoom on a double tap of the grip
    editor.remove();
  });

  it("AT-PAL-38 a double click on a button or the gap, or a dblclick while hidden, does not minimize", () => {
    const b = btn("paletteTable");
    const c = centerOf(b);
    for (let i = 0; i < 2; i++) {
      pointer(b, "pointerdown", { x: c.x, y: c.y });
      pointer(b, "pointerup", { x: c.x, y: c.y });
    }
    b.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }));
    root.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }));
    expect(palette.isMinimized()).toBe(false);
    expect(host.runCommand).toHaveBeenCalledTimes(2); // the two presses, nothing more
    const g = centerOf(grip());
    for (let i = 0; i < 2; i++) {
      pointer(grip(), "pointerdown", { x: g.x, y: g.y });
      pointer(grip(), "pointerup", { x: g.x, y: g.y });
    }
    palette.hide(); // forgets the two taps
    grip().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }));
    palette.show();
    expect(palette.isMinimized()).toBe(false);
  });
});

describe("AT-PAL states, status, life cycle, security", () => {
  it("AT-PAL-23 setButtonStates: each key enables its buttons only; a missing key is false (5.15.5)", () => {
    palette.show();
    const BUTTONS = {
      bold: ["paletteBold"],
      italic: ["paletteItalic"],
      format: ["paletteFormat"],
      textColor: ["paletteColorRed", "paletteColorBlue", "paletteColorGreen", "paletteColorNone"],
      linkPaste: ["paletteLinkPaste"],
      linkRemove: ["paletteLinkRemove"],
      insertInlineMath: ["paletteInlineMath"],
      insertMathBox: ["paletteMathBox"],
      insertTable: ["paletteTable"],
      insertMermaid: ["paletteMermaid"],
      undo: ["paletteUndo"],
      insertRow: ["paletteRow"],
      insertColumn: ["paletteColumn"],
      rowDelete: ["paletteRowDelete"],
      columnDelete: ["paletteColumnDelete"],
      tableOptions: ["paletteTableOptions", "paletteAlignLeft", "paletteAlignCenter", "paletteAlignRight", "paletteAlignNone"],
    };
    const ALWAYS = ["paletteSave", "paletteSaveAs"];
    const any = (id) => document.getElementById(id);
    for (const [key, ids] of Object.entries(BUTTONS)) {
      palette.setButtonStates({ [key]: true });
      for (const [otherKey, otherIds] of Object.entries(BUTTONS)) {
        for (const id of otherIds) expect(off(any(id)), `${key}: ${id}`).toBe(otherKey !== key);
      }
      for (const id of ALWAYS) expect(off(any(id)), `${key}: ${id}`).toBe(false);
      for (const b of popover.querySelectorAll("button")) expect(off(b), `${key}: sample`).toBe(false);
      expect(Object.keys(BUTTONS).flatMap((k) => BUTTONS[k]).length + ALWAYS.length).toBe(
        root.querySelectorAll("button").length + formatMenu.querySelectorAll("button").length + tableMenu.querySelectorAll("button").length,
      );
    }
    palette.setButtonStates({});
    for (const ids of Object.values(BUTTONS)) for (const id of ids) expect(off(any(id)), id).toBe(true);
    for (const id of ALWAYS) expect(off(any(id)), id).toBe(false);
    for (const b of [...root.querySelectorAll("button"), ...formatMenu.querySelectorAll("button")]) {
      expect(b.disabled, b.id).toBe(false); // never the disabled attribute (INV-35)
    }
  });

  it("AT-PAL-23 alignment marks one alignment button with aria-pressed (5.1)", () => {
    palette.show();
    const ALIGN = { left: "paletteAlignLeft", center: "paletteAlignCenter", right: "paletteAlignRight", none: "paletteAlignNone" };
    for (const [value, id] of Object.entries(ALIGN)) {
      palette.setButtonStates({ tableOptions: true, alignment: value });
      for (const otherId of Object.values(ALIGN)) {
        expect(tableMenu.querySelector(`#${otherId}`).getAttribute("aria-pressed"), `${value} ${otherId}`).toBe(String(otherId === id));
      }
    }
    palette.setButtonStates({ tableOptions: true, alignment: null });
    for (const id of Object.values(ALIGN)) expect(tableMenu.querySelector(`#${id}`).getAttribute("aria-pressed")).toBe("false");
  });

  it("AT-PAL-23 a disabled button runs nothing even through its command path", () => {
    palette.show();
    palette.setButtonStates({});
    for (const id of ["paletteBold", "paletteUndo", "paletteRowDelete"]) press(btn(id));
    expect(host.runCommand).not.toHaveBeenCalled();
    press(btn("paletteSave"));
    expect(host.runCommand).toHaveBeenCalledWith("save");
  });

  it("AT-PAL-24 setStatusText changes the status line", () => {
    palette.setStatusText("notes.md * unsaved");
    expect(root.querySelector("#paletteStatus").textContent).toBe("notes.md * unsaved");
    palette.setStatusText("notes.md - saved");
    expect(root.querySelector("#paletteStatus").textContent).toBe("notes.md - saved");
  });

  it("AT-PAL-25 move / up / cancel / down / key / resize listeners come with show and go with hide; 10 cycles add none", () => {
    const tracker = trackListeners();
    const onGlobal = (t) => t === document || t === window;
    const before = tracker.active(onGlobal);
    palette.show();
    expect(tracker.active(onGlobal)).toBeGreaterThanOrEqual(before + 5); // document: move, up, cancel, down, key
    palette.hide();
    expect(tracker.active(onGlobal)).toBe(before);
    enableAll();
    for (let i = 0; i < 10; i++) {
      palette.show();
      press(btn("paletteMermaid"));
      palette.hide();
    }
    expect(tracker.active(onGlobal)).toBe(before);
    tracker.restore();
  });

  it("AT-PAL-26 no inline on* handler attributes in the palette or the popovers", () => {
    palette.show();
    enableAll();
    press(btn("paletteMermaid"));
    const all = [root, popover, formatMenu, tableMenu];
    for (const el of [...all, ...all.flatMap((c) => [...c.querySelectorAll("*")])]) {
      for (const attr of el.attributes) expect(attr.name.startsWith("on"), `${el.tagName} ${attr.name}`).toBe(false);
    }
  });

  it("AT-PAL-28 a user-written #editPalette is never touched; product code has no getElementById('editPalette')", () => {
    const fake = document.createElement("div");
    fake.innerHTML = '<div id="editPalette" role="toolbar"><a href="#x">fake toolbar</a></div>';
    document.body.insertBefore(fake, document.body.firstChild);
    const fakePalette = fake.firstElementChild;
    palette.show();
    const c = centerOf(grip());
    pointer(grip(), "pointerdown", { x: c.x, y: c.y });
    pointer(grip(), "pointermove", { x: c.x - 100, y: c.y - 100 });
    pointer(grip(), "pointerup", { x: c.x - 100, y: c.y - 100 });
    palette.hide();
    expect(fakePalette.getAttribute("style")).toBeNull();
    expect(fakePalette.hidden).toBe(false);
    expect(document.getElementById("editPalette")).toBe(fakePalette); // the fake comes first in the document
    expect(root.hidden).toBe(true);
    fake.remove();

    const files = [resolve(jsDir, "main.js"), ...readdirSync(resolve(jsDir, "classes")).map((n) => resolve(jsDir, "classes", n))];
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/getElementById\(\s*["']editPalette["']\s*\)/);
    }
  });

  it("contains(node) recognizes the palette and the popovers by reference only", () => {
    palette.show();
    expect(palette.contains(btn("paletteBold"))).toBe(true);
    expect(palette.contains(popBtn("Flowchart"))).toBe(true);
    expect(palette.contains(formatMenu.querySelector("#paletteLinkPaste"))).toBe(true);
    expect(palette.contains(tableMenu)).toBe(true);
    const fake = document.createElement("div");
    fake.id = "editPalette";
    fake.setAttribute("role", "toolbar");
    document.body.appendChild(fake);
    expect(palette.contains(fake)).toBe(false);
    expect(palette.contains(document.body)).toBe(false);
    expect(palette.contains(null)).toBe(false);
    fake.remove();
  });

  it("body has the edit-mode class exactly while the palette is shown (CSS for bands and the empty block)", () => {
    expect(document.body.classList.contains("edit-mode")).toBe(false);
    palette.show();
    expect(document.body.classList.contains("edit-mode")).toBe(true);
    palette.hide();
    expect(document.body.classList.contains("edit-mode")).toBe(false);
  });

  it("isShown follows show and hide", () => {
    expect(palette.isShown()).toBe(false);
    palette.show();
    expect(palette.isShown()).toBe(true);
    palette.hide();
    expect(palette.isShown()).toBe(false);
  });
});

describe("EditPalette code mode (SC-27, INV-85)", () => {
  const visible = () =>
    [...root.querySelectorAll(".edit-palette-row")].map((row) =>
      [...row.children].filter((el) => !el.hidden).map((el) => el.id),
    );

  it("AT-PAL-39 setMode('code'): only the grip, Save, Save as, Undo, Redo and Search, in one row; 'markdown': all of them again, in place; an open popover closes", () => {
    palette.show();
    palette.setButtonStates(ALL_ON);
    press(root.querySelector("#paletteFormat"));
    expect(palette.openPopoverKey()).toBe("format");
    palette.setMode("code");
    expect(palette.openPopoverKey()).toBeNull();
    expect(root.classList.contains("edit-palette-code")).toBe(true);
    expect(visible()).toEqual([["paletteGrip", "paletteSave", "paletteSaveAs", "paletteUndo", "paletteRedo", "paletteSearch"], []]);
    palette.setButtonStates({ undo: true });
    press(root.querySelector("#paletteUndo"));
    expect(host.runCommand).toHaveBeenLastCalledWith("undo");
    palette.setMode("markdown");
    expect(root.classList.contains("edit-palette-code")).toBe(false);
    expect(visible()).toEqual([
      ["paletteGrip", "paletteBold", "paletteItalic", "paletteFormat", "paletteMermaid", "paletteSave", "paletteSaveAs"],
      ["paletteTable", "paletteRow", "paletteRowDelete", "paletteColumn", "paletteColumnDelete", "paletteTableOptions", "paletteUndo"],
    ]);
  });

  it("AT-PAL-40 style.css: hidden palette buttons take no place; code mode is one row of six", () => {
    const rule = (selector) => {
      for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].split(",").map((s) => s.trim()).includes(selector)) return m[2];
      return null;
    };
    expect(rule(".edit-palette-btn[hidden]")).toMatch(/display:\s*none/);
    expect(rule(".edit-palette.edit-palette-code .edit-palette-row")).toMatch(/grid-template-columns:\s*repeat\(6, 28px\)/);
    expect(rule(".edit-palette.edit-palette-code .edit-palette-row + .edit-palette-row")).toMatch(/display:\s*none/);
  });

  it("AT-PAL-41 Redo and Search (NE-2): in the palette in code mode only; tooltips with the primary key; Redo off without a step; each runs its command", () => {
    expect([document.getElementById("paletteRedo"), document.getElementById("paletteSearch")]).toEqual([null, null]);
    palette.show();
    palette.setMode("code");
    const redo = root.querySelector("#paletteRedo");
    const search = root.querySelector("#paletteSearch");
    expect([redo.title, redo.getAttribute("aria-label"), search.title, redo.tabIndex]).toEqual(["Redo (Ctrl+Shift+Z)", "Redo (Ctrl+Shift+Z)", "Search (Ctrl+F)", -1]);
    palette.setButtonStates({ undo: true });
    expect([redo.getAttribute("aria-disabled"), search.getAttribute("aria-disabled")]).toEqual(["true", "false"]);
    press(redo);
    expect(host.runCommand).not.toHaveBeenCalled();
    palette.setButtonStates({ redo: true });
    press(redo);
    press(search);
    expect(host.runCommand.mock.calls).toEqual([["redo"], ["search"]]);
    palette.setMode("markdown");
    expect([redo.isConnected, search.isConnected]).toEqual([false, false]);
    palette.hide();
    removePaletteElements();
    palette = new EditPalette(host, { isApple: true });
    ({ root } = paletteElements());
    palette.setMode("code");
    expect([root.querySelector("#paletteRedo").title, root.querySelector("#paletteSearch").title]).toEqual(["Redo (Cmd+Shift+Z)", "Search (Cmd+F)"]);
  });
});
