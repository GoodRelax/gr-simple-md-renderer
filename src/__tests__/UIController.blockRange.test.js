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
vi.mock("../js/config.js", async () => ({
  ...(await vi.importActual("../js/config.js")),
  FILE_SYSTEM_HANDLE_SUPPORTED: true,
}));
vi.mock("../js/classes/ModalController.js", () => ({
  default: { setupModal: vi.fn(), show: vi.fn(), hide: vi.fn() },
}));

import { showToast } from "../js/utils.js";
import { CONFIG } from "../js/config.js";
import { setupApp, dropEvent, settle } from "./helpers/appStack.js";
import { keydown } from "./helpers/editDom.js";
import { fakeFileAccess, fakeFileHandle } from "./helpers/fakeFs.js";

// INV-74 through UIController: Delete / Backspace, the primary modifier + C
// / X, Esc, and the clipboard write (AT-RNG-31..38). The copy event that
// document.execCommand("copy") fires is faked (jsdom has no clipboard).

const DOC = "# Title\n\nHello world.\n\nSecond para.\n\nLast para.\n";
const AFTER = "# Title\n\nLast para.\n";

let app;
let copied; // what the copy event was given, or null when it was not fired

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  showToast.mockClear();
  copied = null;
  // execCommand("copy") fires a cancelable copy event with clipboardData
  document.execCommand = vi.fn((command) => {
    if (command !== "copy") return false;
    const data = {};
    const e = new Event("copy", { bubbles: true, cancelable: true });
    e.clipboardData = { setData: (type, value) => (data[type] = value) };
    document.dispatchEvent(e);
    copied = e.defaultPrevented ? data["text/plain"] : null;
    return true;
  });
});

afterEach(() => {
  window.getSelection().removeAllRanges();
  app?.teardown();
  app = null;
  delete document.execCommand;
  document.querySelectorAll(".grsmd-block-range-bar").forEach((el) => el.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function withDocument({ isApple = false, editMode = true, clipboard } = {}) {
  app = await setupApp({ fileAccess: fakeFileAccess(), isApple, clipboard });
  const access = fakeFileAccess();
  const handle = fakeFileHandle({ name: "doc.md", content: [DOC], calls: access.calls });
  document.dispatchEvent(dropEvent(new File([DOC], "doc.md", { lastModified: 1000 }), handle));
  await settle();
  if (editMode) keydown(document.body, "e");
  return app;
}

const el = (text) => app.block((b) => b.raw.startsWith(text)).el;
/** Select from the start of one block's text to some of another's. */
function selectBlocks(from, to) {
  const r = document.createRange();
  r.setStart(el(from).querySelector("h1, p").firstChild, 0);
  r.setEnd(el(to).querySelector("h1, p").firstChild, 2);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(r);
}
const ctrl = (key, init = {}) => keydown(document.body, key, { ctrlKey: true, code: `Key${key.toUpperCase()}`, ...init });
const body = () => app.orchestrator.getBody();

describe("AT-RNG Delete / Backspace (INV-74 (3), owner ruling D8)", () => {
  it.each(["Delete", "Backspace"])("AT-RNG-31 %s with a block range deletes its blocks in one unit; the unsaved mark follows", async (key) => {
    await withDocument();
    selectBlocks("Hello", "Second");
    const e = keydown(document.body, key);
    expect(e.defaultPrevented).toBe(true);
    expect(body()).toBe(AFTER);
    expect(document.title.startsWith(CONFIG.edit.titleUnsavedPrefix)).toBe(true);
    expect(showToast).not.toHaveBeenCalled(); // D2: no toast, no dialog
    expect(window.confirm).not.toHaveBeenCalled();
    await settle();
    keydown(document.body, "z", { ctrlKey: true, code: "KeyZ" });
    expect(body()).toBe(DOC);
  });

  it("AT-RNG-32 without a range, or outside edit mode, Delete is the browser's", async () => {
    await withDocument();
    expect(keydown(document.body, "Delete").defaultPrevented).toBe(false);
    keydown(document.body, "e"); // edit mode ends
    selectBlocks("Hello", "Second");
    expect(keydown(document.body, "Delete").defaultPrevented).toBe(false);
    expect(body()).toBe(DOC);
  });

  it("AT-RNG-33 not with a modifier, not in a text entry, not during IME composition; a held key acts once", async () => {
    await withDocument();
    selectBlocks("Hello", "Second");
    expect(keydown(document.body, "Delete", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(keydown(document.body, "Delete", { isComposing: true }).defaultPrevented).toBe(false);
    expect(keydown(app.elements.editor, "Delete").defaultPrevented).toBe(false);
    expect(body()).toBe(DOC);
    const held = keydown(document.body, "Delete", { repeat: true });
    expect(held.defaultPrevented).toBe(true);
    expect(body()).toBe(DOC);
  });
});

describe("AT-RNG the primary modifier + C / X (INV-74 (4), owner rulings D3, D7, U3)", () => {
  it("AT-RNG-34 Ctrl+C with a range copies the blocks' source whole; nothing changes; the bar's Copy shows a check", async () => {
    await withDocument();
    selectBlocks("Hello", "Second");
    const e = ctrl("c");
    expect(e.defaultPrevented).toBe(true);
    expect(copied).toBe("Hello world.\n\nSecond para.");
    expect(body()).toBe(DOC);
    expect(app.orchestrator.canUndo()).toBe(false);
    expect(document.querySelector(".grsmd-block-range-bar button.is-copied")).not.toBeNull();
    expect(window.getSelection().isCollapsed).toBe(false);
  });

  it("AT-RNG-35 Ctrl+X copies, then deletes in one unit (Cmd on Apple platforms)", async () => {
    await withDocument({ isApple: true });
    selectBlocks("Hello", "Second");
    expect(ctrl("x").defaultPrevented).toBe(false); // Ctrl is not the primary modifier there
    keydown(document.body, "x", { metaKey: true, code: "KeyX" });
    expect(copied).toBe("Hello world.\n\nSecond para.");
    expect(body()).toBe(AFTER);
    expect(document.querySelector(".grsmd-block-range-bar button.is-copied")).toBeNull();
  });

  it("AT-RNG-36 without a range (or outside edit mode) Ctrl+C / Ctrl+X are the browser's", async () => {
    await withDocument({ editMode: false });
    selectBlocks("Hello", "Second");
    expect(ctrl("c").defaultPrevented).toBe(false);
    expect(ctrl("x").defaultPrevented).toBe(false);
    keydown(document.body, "e");
    window.getSelection().removeAllRanges();
    expect(ctrl("c").defaultPrevented).toBe(false);
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it("AT-RNG-37 when the copy event is refused, a copy uses the clipboard's writeText (no read): the check once written, a toast when it fails", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn() };
    await withDocument({ clipboard });
    document.execCommand = vi.fn(() => false);
    selectBlocks("Hello", "Hello");
    ctrl("c");
    expect(clipboard.writeText).toHaveBeenCalledWith("Hello world.");
    expect(clipboard.readText).not.toHaveBeenCalled();
    await settle();
    expect(document.querySelector(".grsmd-block-range-bar button.is-copied")).not.toBeNull();
    expect(showToast).not.toHaveBeenCalled();
    clipboard.writeText.mockRejectedValue(new Error("denied"));
    ctrl("c");
    await settle();
    expect(showToast.mock.calls.map((c) => c[0])).toEqual([CONFIG.messages.blockRange.copyFailed]);
  });

  it("AT-RNG-44 when the copy event is refused, a cut deletes nothing, does not write later, and says so in one toast (no success toast ever)", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn() };
    await withDocument({ clipboard });
    document.execCommand = vi.fn(() => false);
    selectBlocks("Hello", "Second");
    ctrl("x");
    expect(body()).toBe(DOC);
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(showToast.mock.calls.map((c) => c[0])).toEqual([CONFIG.messages.blockRange.cutFailed]);
    document.execCommand = vi.fn((command) => {
      const e = new Event("copy", { bubbles: true, cancelable: true });
      e.clipboardData = { setData: () => {} };
      document.dispatchEvent(e);
      return command === "copy";
    });
    showToast.mockClear();
    selectBlocks("Hello", "Second");
    ctrl("x");
    expect(body()).toBe(AFTER);
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe("AT-RNG a copy the browser starts (INV-74 (4), owner ruling 2026-10-25)", () => {
  /** A copy event as the context menu, a phone's callout or a Mac's Edit menu fires it. */
  function menuCopy() {
    const data = {};
    const e = new Event("copy", { bubbles: true, cancelable: true });
    e.clipboardData = { setData: (type, value) => (data[type] = value) };
    document.body.dispatchEvent(e);
    return { e, text: data["text/plain"] };
  }

  it("AT-RNG-48 while blocks are selected, a menu's copy writes their source and shows the check; nothing changes", async () => {
    await withDocument();
    selectBlocks("Hello", "Second");
    const { e, text } = menuCopy();
    expect(e.defaultPrevented).toBe(true);
    expect(text).toBe("Hello world.\n\nSecond para.");
    expect(document.execCommand).not.toHaveBeenCalled(); // written into the event itself
    expect(document.querySelector(".grsmd-block-range-bar button.is-copied")).not.toBeNull();
    expect(body()).toBe(DOC);
    expect(app.orchestrator.canUndo()).toBe(false);
  });

  it("AT-RNG-49 without a range, outside edit mode, or with the focus in a text entry, a menu's copy is the browser's", async () => {
    await withDocument({ editMode: false });
    selectBlocks("Hello", "Second");
    expect(menuCopy().e.defaultPrevented).toBe(false);
    keydown(document.body, "e");
    window.getSelection().removeAllRanges();
    expect(menuCopy().e.defaultPrevented).toBe(false);
    selectBlocks("Hello", "Second");
    app.elements.editor.focus();
    expect(menuCopy().e.defaultPrevented).toBe(false);
  });
});

describe("AT-RNG-50 Shift+Delete / Shift+Backspace delete too (INV-74 (3), owner ruling 2026-10-25)", () => {
  it.each(["Delete", "Backspace"])("Shift+%s", async (key) => {
    await withDocument();
    selectBlocks("Hello", "Second");
    expect(keydown(document.body, key, { shiftKey: true }).defaultPrevented).toBe(true);
    expect(body()).toBe(AFTER);
  });
});

describe("AT-RNG Esc (INV-74 (3), owner ruling D14)", () => {
  it("AT-RNG-38 the first Esc takes the range away and keeps edit mode; the next one hides the palette", async () => {
    await withDocument();
    selectBlocks("Hello", "Second");
    keydown(document.body, "Escape");
    expect(window.getSelection().rangeCount).toBe(0);
    expect(app.ui.palette.isShown()).toBe(true);
    keydown(document.body, "Escape");
    expect(app.ui.palette.isShown()).toBe(false);
  });
});
