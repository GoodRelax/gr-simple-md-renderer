import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return {
    ...actual,
    applyTheme: vi.fn(),
    applySystemTheme: vi.fn(),
    showToast: vi.fn(),
    waitForDOMStability: vi.fn().mockResolvedValue(true),
  };
});
vi.mock("../js/classes/ModalController.js", () => ({
  default: { setupModal: vi.fn(), show: vi.fn(), hide: vi.fn() },
}));

import { showToast } from "../js/utils.js";
import { CONFIG } from "../js/config.js";
import { TYPING_PAUSE_MS } from "../js/classes/DocumentSearch.js";
import { setupApp, dropEvent, settle } from "./helpers/appStack.js";
import { keydown, pointer } from "./helpers/editDom.js";

// INV-80 (5)(6)(7), 5.11, owner rulings S4, S6, S8, S9, S11: Search as
// UIController wires it. jsdom has no layout: scrolling is stubbed.

let app;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function withFile(name, text) {
  document.dispatchEvent(dropEvent(new File([text], name, { lastModified: 1000 }), null));
  await settle();
}

function type(value) {
  app.searchEl.input.value = value;
  app.searchEl.input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  Range.prototype.getClientRects = () => [{}];
  showToast.mockClear();
  app = await setupApp({ withSearch: true, withIndex: true });
});

afterEach(() => {
  app?.teardown();
  app = null;
  delete Element.prototype.scrollIntoView;
  delete Range.prototype.getBoundingClientRect;
  delete Range.prototype.getClientRects;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AT-SRCH-12 (INV-80 (5)(6)(7), 11-c, 5.11) UIController and Search", () => {
  it("(a) INV-80, 5.11: f opens Search in the Markdown and the code view, also in edit mode (S8), not in an input or the initial state", async () => {
    expect(app.searchEl.button.disabled).toBe(true);
    keydown(document.body, "f");
    expect(app.search.isShown()).toBe(false);

    await withFile("doc.md", "# A\n\nsome text\n");
    expect(app.searchEl.button.disabled).toBe(false);
    keydown(app.elements.editor, "f");
    expect(app.search.isShown()).toBe(false);
    const f = keydown(document.body, "f");
    expect(app.search.isShown()).toBe(true);
    expect(f.defaultPrevented).toBe(true); // the f is not typed into the box
    expect(document.activeElement).toBe(app.searchEl.input);
    app.search.hide();

    keydown(document.body, "e");
    expect(app.ui.palette.isShown()).toBe(true);
    keydown(document.body, "f");
    expect(app.search.isShown()).toBe(true);
    app.search.hide();

    await withFile("code.py", "print(1)\n");
    expect(app.searchEl.button.disabled).toBe(false);
    expect(app.searchEl.replaceRow.hidden).toBe(true);
  });

  it("(b) INV-80 (7): Ctrl+F (Mac: Cmd+F) opens Search in edit mode only, also from a block editor; outside edit mode it is the browser's (S6)", async () => {
    await withFile("doc.md", "# A\n\nsome text\n");
    const outside = keydown(document.body, "f", { ctrlKey: true, code: "KeyF" });
    expect(outside.defaultPrevented).toBe(false);
    expect(app.search.isShown()).toBe(false);

    keydown(document.body, "e");
    const { el } = app.block((b) => b.type === "paragraph");
    pointer(el, "pointerdown");
    pointer(el, "pointerup");
    el.click();
    await settle();
    const editor = app.blockEditor();
    expect(editor).not.toBeNull();
    editor.focus();
    const inEditor = keydown(editor, "f", { ctrlKey: true, code: "KeyF" });
    expect(inEditor.defaultPrevented).toBe(true);
    expect(app.search.isShown()).toBe(true);
  });

  it("(c) INV-80 (6), INV-77 (4): Esc: in the box it closes Search at once (S11); outside, the palette, then Search, then the Index (S9)", async () => {
    await withFile("doc.md", "# A\n\nsome text\n");
    keydown(document.body, "e");
    keydown(document.body, "i");
    keydown(document.body, "f");
    const inBox = keydown(app.searchEl.input, "Escape");
    expect(inBox.defaultPrevented).toBe(true);
    expect(app.search.isShown()).toBe(false);
    expect(app.ui.palette.isShown()).toBe(true);

    keydown(document.body, "f");
    app.searchEl.input.blur();
    keydown(document.body, "Escape");
    expect([app.ui.palette.isShown(), app.search.isShown(), app.index.isShown()]).toEqual([false, true, true]);
    keydown(document.body, "Escape");
    expect([app.search.isShown(), app.index.isShown()]).toEqual([false, true]);
    keydown(document.body, "Escape");
    expect(app.index.isShown()).toBe(false);
  });

  it("(e) INV-80 (6), INV-53 (review L17): with a palette popover open, the first Esc in the box closes the popover only; the next one closes Search", async () => {
    await withFile("doc.md", "# A\n\nsome text\n");
    keydown(document.body, "e");
    keydown(document.body, "f");
    app.searchEl.input.focus();
    const mermaidButton = app.paletteRoot().querySelector("#paletteMermaid");
    pointer(mermaidButton, "pointerdown", { x: 0, y: 0 });
    pointer(mermaidButton, "pointerup", { x: 0, y: 0 });
    const popover = document.querySelector("#paletteMermaidMenu");
    expect(popover.hidden).toBe(false);
    expect(document.activeElement).toBe(app.searchEl.input);
    const first = keydown(app.searchEl.input, "Escape");
    expect(first.defaultPrevented).toBe(true);
    expect(popover.hidden).toBe(true);
    expect(app.search.isShown()).toBe(true);
    keydown(app.searchEl.input, "Escape");
    expect(app.search.isShown()).toBe(false);
    expect(app.ui.palette.isShown()).toBe(true);
  });

  it("(d) INV-80 (5)(7), 11-c: a replace applies the open block first (11-c searchReplaceRequested) and is one Undo; Ctrl+Z in the box is the box's own; replace follows edit mode (S4)", async () => {
    await withFile("doc.md", "# A\n\nsome text\n\nmore text\n");
    keydown(document.body, "f");
    expect(app.searchEl.replaceOne.disabled).toBe(true);
    keydown(app.searchEl.input, "Escape");

    keydown(document.body, "e");
    expect(app.searchEl.replaceOne.disabled).toBe(false);
    const { el } = app.block((b) => b.raw.startsWith("some"));
    pointer(el, "pointerdown");
    pointer(el, "pointerup");
    el.click();
    await settle();
    const editor = app.blockEditor();
    editor.value = "some edited text";
    editor.dispatchEvent(new Event("input", { bubbles: true }));

    keydown(editor, "f", { ctrlKey: true, code: "KeyF" });
    type("text");
    await wait(TYPING_PAUSE_MS + 50);
    const dispatch = vi.spyOn(app.ui.blockEdit, "dispatch");
    app.searchEl.replaceInput.value = "words";
    app.searchEl.replaceAll.click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith("searchReplaceRequested");
    expect(app.orchestrator.getBody()).toBe("# A\n\nsome edited words\n\nmore words\n");
    expect(showToast).toHaveBeenCalledWith(CONFIG.messages.search.replaced(2), expect.anything());

    const inBox = keydown(app.searchEl.input, "z", { ctrlKey: true, code: "KeyZ" });
    expect(inBox.defaultPrevented).toBe(false);
    app.searchEl.input.blur();
    keydown(document.body, "z", { ctrlKey: true, code: "KeyZ" });
    await settle();
    expect(app.orchestrator.getBody()).toBe("# A\n\nsome edited text\n\nmore text\n");

    keydown(document.body, "e"); // the palette hides: no replacing
    expect(app.searchEl.replaceAll.disabled).toBe(true);
  });
});
