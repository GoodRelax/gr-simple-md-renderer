import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import EditPalette from "../js/classes/EditPalette.js";
import { CONFIG } from "../js/config.js";
import { pointer, keydown, trackListeners } from "./helpers/editDom.js";
import { fakePaletteLayout, paletteElements, centerOf, positionOf, PALETTE_SIZE, POPOVER_SIZE } from "./helpers/paletteLayout.js";

const here = dirname(fileURLToPath(import.meta.url));
const jsDir = resolve(here, "../js");

const MARGIN = CONFIG.edit.paletteMarginPx;
const W = 1024;
const H = 768;

let palette;
let host;
let layout;
let root;
let popover;

function fakeHost() {
  return {
    runCommand: vi.fn(),
    focusEditor: vi.fn(() => false),
    requestHide: vi.fn(),
  };
}

function setViewport(width, height) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

beforeEach(() => {
  setViewport(W, H);
  layout = fakePaletteLayout();
  host = fakeHost();
  palette = new EditPalette(host);
  ({ root, popover } = paletteElements());
});

afterEach(() => {
  palette.hide();
  root?.remove();
  popover?.remove();
  layout.restore();
  vi.restoreAllMocks();
});

const btn = (id) => root.querySelector(`#${id}`);
const popBtn = (label) => [...popover.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label);

/** pointerdown at the center of el, then pointerup moved by (dx, dy) from there. */
function press(el, { dx = 0, dy = 0, upEl = el } = {}) {
  const c = centerOf(el);
  const down = pointer(el, "pointerdown", { x: c.x, y: c.y });
  pointer(upEl, "pointerup", { x: c.x + dx, y: c.y + dy });
  return down;
}

function enableAll() {
  palette.setButtonStates(true, true, true, false);
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

  it("AT-PAL-02 the position is not remembered, and nothing is stored", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    palette.show();
    const grip = root.querySelector(".edit-palette-grip");
    const c = centerOf(grip);
    pointer(grip, "pointerdown", { x: c.x, y: c.y });
    pointer(grip, "pointermove", { x: 50, y: 50 });
    pointer(grip, "pointerup", { x: 50, y: 50 });
    expect(positionOf(root).left).toBeLessThan(200);
    palette.hide();
    expect(root.hidden).toBe(true);
    palette.show();
    expect(positionOf(root)).toEqual({ left: W - PALETTE_SIZE.width - MARGIN, top: H - PALETTE_SIZE.height - MARGIN });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("AT-PAL-03 the 9 buttons, the grip and the status, in two rows; labels and inline SVG only", () => {
    const rows = [...root.querySelectorAll(".edit-palette-row")];
    expect(rows).toHaveLength(2);
    const ids = (r) => [...r.querySelectorAll("button, .edit-palette-grip")].map((el) => el.id);
    expect(ids(rows[0])).toEqual(["paletteGrip", "paletteBold", "paletteItalic", "paletteUndo", "paletteSave", "paletteSaveAs"]);
    expect(ids(rows[1])).toEqual(["paletteTable", "paletteRow", "paletteColumn", "paletteMermaid"]);
    expect(root.querySelector("#paletteStatus")).not.toBeNull();
    const labels = {
      paletteGrip: "Move palette",
      paletteBold: "Bold",
      paletteItalic: "Italic",
      paletteUndo: "Undo",
      paletteSave: "Save",
      paletteSaveAs: "Save as",
      paletteTable: "Insert table",
      paletteRow: "Insert row",
      paletteColumn: "Insert column",
      paletteMermaid: "Insert Mermaid sample",
    };
    for (const [id, label] of Object.entries(labels)) {
      const el = root.querySelector(`#${id}`);
      expect(el.getAttribute("title"), id).toBe(label);
      expect(el.getAttribute("aria-label"), id).toBe(label);
      expect(el.querySelector("svg"), id).not.toBeNull();
    }
    expect(btn("paletteMermaid").querySelectorAll("svg")).toHaveLength(2); // icon + submenu mark
    for (const el of [root, popover]) {
      expect(el.querySelector("img, use, image, script, foreignObject")).toBeNull();
      for (const node of el.querySelectorAll("*")) {
        expect(node.hasAttribute("href")).toBe(false);
        expect(node.hasAttribute("xlink:href")).toBe(false);
        expect(node.hasAttribute("src")).toBe(false);
        expect(node.getAttribute("style") ?? "").not.toContain("url(");
      }
    }
  });

  it("AT-PAL-04 there is no minimize button and no Redo button", () => {
    const text = [...root.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label").toLowerCase());
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

  it.each(["grip", "gap"])("AT-PAL-10 pressing the %s moves from the start; release runs nothing", (which) => {
    const target = which === "grip" ? root.querySelector(".edit-palette-grip") : root;
    const start = which === "grip" ? centerOf(target) : { x: positionOf(root).left + 190, y: positionOf(root).top + 70 };
    const before = positionOf(root);
    pointer(target, "pointerdown", { x: start.x, y: start.y });
    pointer(target, "pointermove", { x: start.x - 30, y: start.y - 20 });
    expect(positionOf(root)).toEqual({ left: before.left - 30, top: before.top - 20 });
    pointer(target, "pointerup", { x: start.x - 30, y: start.y - 20 });
    expect(host.runCommand).not.toHaveBeenCalled();
  });

  it("AT-PAL-11 a disabled button: press and release run nothing and do not move", () => {
    palette.setButtonStates(false, false, false, false);
    const b = btn("paletteBold");
    expect(b.disabled).toBe(true);
    const c = centerOf(b);
    const before = positionOf(root);
    pointer(b, "pointerdown", { x: c.x, y: c.y });
    pointer(b, "pointermove", { x: c.x - 100, y: c.y - 100 });
    pointer(b, "pointerup", { x: c.x - 100, y: c.y - 100 });
    expect(host.runCommand).not.toHaveBeenCalled();
    expect(positionOf(root)).toEqual(before);
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
    const gripDown = press(root.querySelector(".edit-palette-grip"));
    expect(gripDown.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(ta);
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([6, 10]);
    ta.remove();
  });

  it("AT-PAL-15 dragging past the viewport stops at the edges", () => {
    const grip = root.querySelector(".edit-palette-grip");
    const c = centerOf(grip);
    pointer(grip, "pointerdown", { x: c.x, y: c.y });
    pointer(grip, "pointermove", { x: -5000, y: -5000 });
    expect(positionOf(root)).toEqual({ left: 0, top: 0 });
    pointer(grip, "pointermove", { x: 9000, y: 9000 });
    expect(positionOf(root)).toEqual({ left: W - PALETTE_SIZE.width, top: H - PALETTE_SIZE.height });
    pointer(grip, "pointerup", { x: 9000, y: 9000 });
  });

  it("AT-PAL-16 a smaller viewport (resize) moves the palette back inside", () => {
    setViewport(500, 300);
    window.dispatchEvent(new Event("resize"));
    expect(positionOf(root)).toEqual({ left: 500 - PALETTE_SIZE.width, top: 300 - PALETTE_SIZE.height });
  });
});

describe("AT-PAL Mermaid popover (5.15.1, INV-37)", () => {
  beforeEach(() => {
    palette.show();
  });

  function moveRootTo(left, top) {
    const grip = root.querySelector(".edit-palette-grip");
    const c = centerOf(grip);
    const p = positionOf(root);
    pointer(grip, "pointerdown", { x: c.x, y: c.y });
    pointer(grip, "pointermove", { x: c.x + left - p.left, y: c.y + top - p.top });
    pointer(grip, "pointerup", { x: c.x + left - p.left, y: c.y + top - p.top });
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
    ["Esc in the popover", () => keydown(popBtn("Sequence diagram"), "Escape")],
    ["a pointerdown outside palette and popover", () => pointer(document.body, "pointerdown")],
    ["hiding the palette", () => palette.hide()],
  ])("AT-PAL-18 closes on %s", (_name, act) => {
    press(btn("paletteMermaid"));
    expect(popover.hidden).toBe(false);
    act();
    expect(popover.hidden).toBe(true);
  });

  it("AT-PAL-18 a pointerdown on the palette or the popover keeps it open", () => {
    press(btn("paletteMermaid"));
    pointer(root, "pointerdown", { x: positionOf(root).left + 190, y: positionOf(root).top + 70 });
    pointer(root, "pointerup", { x: positionOf(root).left + 190, y: positionOf(root).top + 70 });
    pointer(popover, "pointerdown", { x: positionOf(popover).left + 150, y: positionOf(popover).top + 140 });
    pointer(popover, "pointerup", { x: positionOf(popover).left + 150, y: positionOf(popover).top + 140 });
    expect(popover.hidden).toBe(false);
  });

  it("AT-PAL-19 four sample buttons; press and release runs; moving away moves the palette", () => {
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
    pointer(b, "pointermove", { x: c.x - 80, y: c.y - 30 });
    pointer(b, "pointerup", { x: c.x - 80, y: c.y - 30 });
    expect(host.runCommand).toHaveBeenCalledTimes(1);
    expect(positionOf(root)).toEqual({ left: before.left - 20, top: before.top - 30 });
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
});

describe("AT-PAL keyboard (INV-53)", () => {
  beforeEach(() => {
    palette.show();
  });

  const tabStops = () => [...root.querySelectorAll("button")].filter((b) => b.tabIndex === 0);

  it("AT-PAL-20 one roving tab stop; arrows move it (wrapping, skipping disabled); Enter and Space run at once", () => {
    palette.setButtonStates(false, false, false, false);
    expect(tabStops()).toHaveLength(1);
    palette.focus();
    expect(document.activeElement).toBe(tabStops()[0]);
    expect(document.activeElement.disabled).toBe(false);
    const enabled = [...root.querySelectorAll("button")].filter((b) => !b.disabled);
    expect(enabled.map((b) => b.id)).toEqual(["paletteSave", "paletteSaveAs", "paletteTable", "paletteMermaid"]);
    palette.focus();
    let current = document.activeElement;
    for (let i = 0; i < enabled.length; i++) {
      const e = keydown(current, "ArrowRight");
      expect(e.defaultPrevented).toBe(true);
      current = document.activeElement;
      expect(tabStops()).toEqual([current]);
    }
    expect(current).toBe(tabStops()[0]);
    const startIndex = enabled.indexOf(current);
    keydown(current, "ArrowLeft");
    expect(document.activeElement).toBe(enabled[(startIndex - 1 + enabled.length) % enabled.length]);

    btn("paletteTable").focus();
    const enter = keydown(btn("paletteTable"), "Enter");
    expect(enter.defaultPrevented).toBe(true);
    expect(host.runCommand).toHaveBeenLastCalledWith("insertTable");
    keydown(btn("paletteSave"), " ");
    expect(host.runCommand).toHaveBeenLastCalledWith("save");
    expect(host.runCommand).toHaveBeenCalledTimes(2);
  });

  it("AT-PAL-20 a tab stop that becomes disabled moves to an enabled button", () => {
    palette.setButtonStates(true, true, false, false);
    btn("paletteBold").focus();
    keydown(btn("paletteBold"), "ArrowLeft");
    keydown(document.activeElement, "ArrowRight");
    expect(tabStops()).toEqual([btn("paletteBold")]);
    palette.setButtonStates(false, false, false, false);
    expect(tabStops()).toHaveLength(1);
    expect(tabStops()[0].disabled).toBe(false);
  });

  it("AT-PAL-20 Enter on Mermaid opens the popover and focuses its first button; Enter there runs", () => {
    btn("paletteMermaid").focus();
    keydown(btn("paletteMermaid"), "Enter");
    expect(popover.hidden).toBe(false);
    expect(document.activeElement).toBe(popBtn("Flowchart"));
    keydown(popBtn("Flowchart"), "ArrowDown");
    expect(document.activeElement).toBe(popBtn("Sequence diagram"));
    keydown(document.activeElement, "Enter");
    expect(host.runCommand).toHaveBeenCalledWith("insertMermaid", "sequence");
    expect(popover.hidden).toBe(true);
  });

  it("AT-PAL-21 Shift+Tab or Esc returns to the open editor", () => {
    host.focusEditor.mockReturnValue(true);
    palette.focus();
    const shiftTab = keydown(document.activeElement, "Tab", { shiftKey: true });
    expect(shiftTab.defaultPrevented).toBe(true);
    palette.focus();
    keydown(document.activeElement, "Escape");
    expect(host.focusEditor).toHaveBeenCalledTimes(2);
    expect(host.requestHide).not.toHaveBeenCalled();
  });

  it("AT-PAL-21 without an editor: Esc asks to hide the palette (T3); Shift+Tab is left to the browser", () => {
    palette.focus();
    const shiftTab = keydown(document.activeElement, "Tab", { shiftKey: true });
    expect(shiftTab.defaultPrevented).toBe(false);
    expect(host.requestHide).not.toHaveBeenCalled();
    keydown(document.activeElement, "Escape");
    expect(host.requestHide).toHaveBeenCalledTimes(1);
  });
});

describe("AT-PAL states, status, life cycle, security", () => {
  it("AT-PAL-23 setButtonStates: all 16 combinations follow 5.15.5", () => {
    palette.show();
    const ALWAYS = ["paletteTable", "paletteMermaid", "paletteSave", "paletteSaveAs"];
    for (let bits = 0; bits < 16; bits++) {
      const [isInBlock, hasSelection, isInTable, canUndo] = [8, 4, 2, 1].map((m) => (bits & m) !== 0);
      palette.setButtonStates(isInBlock, hasSelection, isInTable, canUndo);
      const label = JSON.stringify({ isInBlock, hasSelection, isInTable, canUndo });
      expect(btn("paletteBold").disabled, label).toBe(!(isInBlock && hasSelection));
      expect(btn("paletteItalic").disabled, label).toBe(!(isInBlock && hasSelection));
      expect(btn("paletteUndo").disabled, label).toBe(!(!isInBlock && canUndo));
      expect(btn("paletteRow").disabled, label).toBe(!(isInBlock && isInTable));
      expect(btn("paletteColumn").disabled, label).toBe(!(isInBlock && isInTable));
      for (const id of ALWAYS) expect(btn(id).disabled, `${label} ${id}`).toBe(false);
    }
  });

  it("AT-PAL-24 setStatusText changes the status line", () => {
    palette.setStatusText("notes.md * unsaved");
    expect(root.querySelector("#paletteStatus").textContent).toBe("notes.md * unsaved");
    palette.setStatusText("notes.md - saved");
    expect(root.querySelector("#paletteStatus").textContent).toBe("notes.md - saved");
  });

  it("AT-PAL-25 move / up / resize listeners come with show and go with hide; 10 cycles add none", () => {
    const tracker = trackListeners();
    const onGlobal = (t) => t === document || t === window;
    const before = tracker.active(onGlobal);
    palette.show();
    expect(tracker.active(onGlobal)).toBeGreaterThanOrEqual(before + 3);
    palette.hide();
    expect(tracker.active(onGlobal)).toBe(before);
    for (let i = 0; i < 10; i++) {
      palette.show();
      press(btn("paletteMermaid"));
      palette.hide();
    }
    expect(tracker.active(onGlobal)).toBe(before);
    tracker.restore();
  });

  it("AT-PAL-26 no inline on* handler attributes in the palette or the popover", () => {
    palette.show();
    press(btn("paletteMermaid"));
    for (const el of [root, popover, ...root.querySelectorAll("*"), ...popover.querySelectorAll("*")]) {
      for (const attr of el.attributes) expect(attr.name.startsWith("on"), `${el.tagName} ${attr.name}`).toBe(false);
    }
  });

  it("AT-PAL-28 a user-written #editPalette is never touched; product code has no getElementById('editPalette')", () => {
    const fake = document.createElement("div");
    fake.innerHTML = '<div id="editPalette" role="toolbar"><a href="#x">fake toolbar</a></div>';
    document.body.insertBefore(fake, document.body.firstChild);
    const fakePalette = fake.firstElementChild;
    palette.show();
    const grip = root.querySelector(".edit-palette-grip");
    const c = centerOf(grip);
    pointer(grip, "pointerdown", { x: c.x, y: c.y });
    pointer(grip, "pointermove", { x: c.x - 100, y: c.y - 100 });
    pointer(grip, "pointerup", { x: c.x - 100, y: c.y - 100 });
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

  it("contains(node) recognizes the palette and the popover by reference only", () => {
    palette.show();
    expect(palette.contains(btn("paletteBold"))).toBe(true);
    expect(palette.contains(popBtn("Flowchart"))).toBe(true);
    const fake = document.createElement("div");
    fake.id = "editPalette";
    fake.setAttribute("role", "toolbar");
    document.body.appendChild(fake);
    expect(palette.contains(fake)).toBe(false);
    expect(palette.contains(document.body)).toBe(false);
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
