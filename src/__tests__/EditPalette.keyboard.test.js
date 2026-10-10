import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return { ...actual, applyTheme: vi.fn(), waitForDOMStability: vi.fn().mockResolvedValue(true) };
});

import EditPalette from "../js/classes/EditPalette.js";
import MarkdownTextOps from "../js/classes/MarkdownTextOps.js";
import { setupEdit } from "./helpers/editStack.js";
import { tap, keydown } from "./helpers/editDom.js";
import { paletteElements } from "./helpers/paletteLayout.js";

// AT-PAL-22: the real BlockEditController and EditPalette, joined by a small
// glue that stands in for UIController (unit f) for the Bold command only.

let s;
let palette;
afterEach(() => {
  palette?.hide();
  const { root, popover } = paletteElements();
  root?.remove();
  popover?.remove();
  s?.teardown();
  s = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AT-PAL-22 keyboard Bold from the editor (INV-53)", () => {
  it("select 'word', Tab to the palette, Bold with Enter: the editor gets **word** and the focus back", async () => {
    s = await setupEdit("Hello word here.\n");
    palette = new EditPalette({
      runCommand: (command) => {
        if (command !== "bold") return;
        const r = s.bec.getSelectionRange();
        s.bec.applyTextEdit(MarkdownTextOps.toggleWrap(r.text, r.selStart, r.selEnd, "**"));
      },
      focusEditor: () => s.bec.focusEditor(),
      requestHide: vi.fn(),
    });
    s.host.focusPalette.mockImplementation(() => palette.focus());
    s.host.isPaletteNode.mockImplementation((node) => palette.contains(node));
    palette.show();
    palette.setButtonStates(true, true, false, false);

    tap(s.preview.querySelector(".md-block p"));
    const ta = s.editor();
    ta.setSelectionRange(6, 10);
    expect(keydown(ta, "Tab").defaultPrevented).toBe(true);
    const { root } = paletteElements();
    expect(root.contains(document.activeElement)).toBe(true);

    const bold = root.querySelector("#paletteBold");
    for (let i = 0; i < 9 && document.activeElement !== bold; i++) keydown(document.activeElement, "ArrowLeft");
    expect(document.activeElement).toBe(bold);
    keydown(bold, "Enter");

    expect(ta.value).toBe("Hello **word** here.");
    expect(document.activeElement).toBe(ta);
    expect(s.bec.isEditing()).toBe(true);
  });

  it("AT-PAL-21 Esc on the palette returns the focus to the open editor", async () => {
    s = await setupEdit("Hello word here.\n");
    palette = new EditPalette({ runCommand: vi.fn(), focusEditor: () => s.bec.focusEditor(), requestHide: vi.fn() });
    palette.show();
    tap(s.preview.querySelector(".md-block p"));
    const ta = s.editor();
    palette.focus();
    expect(document.activeElement).not.toBe(ta);
    keydown(document.activeElement, "Escape");
    expect(document.activeElement).toBe(ta);
    expect(s.bec.isEditing()).toBe(true);
  });
});
