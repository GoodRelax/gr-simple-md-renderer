import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return { ...actual, applyTheme: vi.fn(), waitForDOMStability: vi.fn().mockResolvedValue(true) };
});

import EditPalette from "../js/classes/EditPalette.js";
import { setupEdit } from "./helpers/editStack.js";
import { tap, keydown } from "./helpers/editDom.js";
import { fakePaletteLayout, paletteElements, removePaletteElements } from "./helpers/paletteLayout.js";

// INV-53 / 5.15.6 (ruling K1): the palette is pointer only. No roving tab
// stop, no arrow keys, no Enter / Space, and the block editor's Tab stays
// with the browser.

let s;
let palette;
let layout;
afterEach(() => {
  palette?.hide();
  removePaletteElements();
  layout?.restore();
  s?.teardown();
  s = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ALL_ON = { bold: true, italic: true, format: true, textColor: true, linkPaste: true, linkRemove: true, insertTable: true, insertMermaid: true, undo: true, insertRow: true, insertColumn: true, rowDelete: true, columnDelete: true, tableOptions: true };

describe("AT-PAL-20 the palette takes no keyboard focus and no keys (INV-53)", () => {
  it("every palette and popover button has tabindex -1, and there is no focus() API", () => {
    layout = fakePaletteLayout();
    palette = new EditPalette({ runCommand: vi.fn() });
    palette.show();
    palette.setButtonStates(ALL_ON);
    const { root, popover, formatMenu, tableMenu } = paletteElements();
    const buttons = [root, popover, formatMenu, tableMenu].flatMap((el) => [...el.querySelectorAll("button")]);
    expect(buttons.length).toBe(13 + 4 + 6 + 2 + 4); // Text format: 6 formats and 2 math (owner ruling 2026-10-25)
    for (const b of buttons) expect(b.tabIndex, b.id || b.getAttribute("aria-label")).toBe(-1);
    expect(root.querySelector('[tabindex="0"]')).toBeNull();
    expect(palette.focus).toBeUndefined();
  });

  it.each(["Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " ", "Escape"])(
    "%s on a focused button is not handled: nothing runs, nothing moves, the default is kept",
    (key) => {
      layout = fakePaletteLayout();
      const host = { runCommand: vi.fn() };
      palette = new EditPalette(host);
      palette.show();
      palette.setButtonStates(ALL_ON);
      const { root, popover } = paletteElements();
      for (const b of [root.querySelector("#paletteBold"), root.querySelector("#paletteMermaid"), popover.querySelector("button")]) {
        b.focus();
        const e = keydown(b, key);
        expect(e.defaultPrevented, `${key} ${b.id}`).toBe(false);
        expect(document.activeElement, `${key} ${b.id}`).toBe(b);
      }
      expect(host.runCommand).not.toHaveBeenCalled();
      expect(popover.hidden).toBe(true);
      expect(palette.isShown()).toBe(true);
    },
  );

  it("the block editor's Tab does not move to the palette (the browser keeps Tab)", async () => {
    s = await setupEdit("Hello word here.\n");
    layout = fakePaletteLayout();
    palette = new EditPalette({ runCommand: vi.fn() });
    s.host.isPaletteNode.mockImplementation((node) => palette.contains(node));
    palette.show();
    palette.setButtonStates(ALL_ON);
    tap(s.preview.querySelector(".md-block p"));
    const ta = s.editor();
    ta.focus();
    const e = keydown(ta, "Tab");
    expect(e.defaultPrevented).toBe(false);
    expect(palette.contains(document.activeElement)).toBe(false);
    expect(s.bec.isEditing()).toBe(true);
  });
});
