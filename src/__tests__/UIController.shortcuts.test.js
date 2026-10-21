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
import { shortcutLetter } from "../js/utils.js";
import { setupApp, dropEvent, settle } from "./helpers/appStack.js";
import { tap, pointer, keydown } from "./helpers/editDom.js";
import { fakeFileAccess, fakeFileHandle, deferred } from "./helpers/fakeFs.js";

// INV-14 (revised), INV-58 to INV-60: the primary-modifier shortcuts.

const DOC = "# Title\n\nHello word here.\n\nSecond para.\n";
const isPara = (start) => (b) => b.type === "paragraph" && b.raw.startsWith(start);

let app;
let access;

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  showToast.mockClear();
});

afterEach(() => {
  app?.teardown();
  app = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function withDocument({ isApple = false, permission, doc = DOC } = {}) {
  access = fakeFileAccess();
  app = await setupApp({ fileAccess: access, isApple });
  const handle = fakeFileHandle({ name: "doc.md", content: [doc], calls: access.calls, permission });
  document.dispatchEvent(dropEvent(new File([doc], "doc.md", { lastModified: 1000 }), handle));
  await settle();
  return app;
}

const btn = (id) => app.paletteRoot().querySelector(`#${id}`);
const showPalette = () => keydown(document.body, "e");
const ctrl = (el, key, init = {}) => keydown(el, key, { ctrlKey: true, code: `Key${key.toUpperCase()}`, ...init });

function open(pred) {
  tap(app.block(pred).el.firstElementChild);
  return app.blockEditor();
}

function commitChange(pred, text) {
  const ta = open(pred);
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  pointer(document.body, "pointerdown");
}

describe("AT-KEY-01 shortcutLetter: the INV-14 formula (pure)", () => {
  const ev = (init) => ({ key: "s", code: "KeyS", ctrlKey: false, metaKey: false, altKey: false, repeat: false, isComposing: false, keyCode: 83, ...init });
  it.each([
    ["Windows Ctrl+S", ev({ ctrlKey: true }), false, "s"],
    ["Windows Ctrl+Shift+S (key is S)", ev({ ctrlKey: true, key: "S", shiftKey: true }), false, "s"],
    ["Windows Meta+S", ev({ metaKey: true }), false, null],
    ["Windows Ctrl+Meta+S", ev({ ctrlKey: true, metaKey: true }), false, null],
    ["Mac Cmd+S", ev({ metaKey: true }), true, "s"],
    ["Mac Ctrl+S (not taken, ruling UIR-19)", ev({ ctrlKey: true }), true, null],
    ["Mac Cmd+Ctrl+S", ev({ ctrlKey: true, metaKey: true }), true, null],
    ["AltGr (Ctrl+Alt)", ev({ ctrlKey: true, altKey: true }), false, null],
    ["Alt", ev({ altKey: true }), false, null],
    ["repeat keeps its letter (the caller takes it and runs nothing)", ev({ ctrlKey: true, repeat: true }), false, "s"],
    ["IME isComposing", ev({ ctrlKey: true, isComposing: true }), false, null],
    ["IME keyCode 229", ev({ ctrlKey: true, keyCode: 229 }), false, null],
    ["Russian layout: key \u044b, code KeyS", ev({ ctrlKey: true, key: "\u044b" }), false, "s"],
    ["Latin key wins over code (AZERTY z on KeyW)", ev({ ctrlKey: true, key: "z", code: "KeyW" }), false, "z"],
    ["non-letter key, non-letter code", ev({ ctrlKey: true, key: "1", code: "Digit1" }), false, null],
    ["no modifier", ev({}), false, null],
  ])("%s", (_name, e, isApple, expected) => {
    expect(shortcutLetter(e, isApple)).toBe(expected);
  });
});

describe("AT-KEY-02 primary + S / Shift+S: Save / Save as in the Markdown view (INV-58)", () => {
  it("taken with the palette closed, too; Shift is Save as", async () => {
    await withDocument();
    const save = vi.spyOn(app.ui, "requestSave");
    const saveAs = vi.spyOn(app.ui, "requestSaveAs");
    expect(app.ui.palette.isShown()).toBe(false);
    const e = ctrl(document.body, "s");
    expect(e.defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    const e2 = ctrl(document.body, "S", { shiftKey: true });
    expect(e2.defaultPrevented).toBe(true);
    expect(saveAs).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("taken in the block editor and in #editor too (before the INV-14 guard); the editor is committed first", async () => {
    await withDocument();
    showPalette();
    const ta = open(isPara("Hello"));
    ta.value = "Hello saved.";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    const e = ctrl(ta, "s");
    expect(e.defaultPrevented).toBe(true);
    expect(app.orchestrator.getBody()).toContain("Hello saved.");
    expect(app.blockEditor()).toBeNull();
    app.elements.editor.focus();
    const save = vi.spyOn(app.ui, "requestSave");
    expect(ctrl(app.elements.editor, "s").defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("the permission request starts inside the keydown (synchronous start, INV-33)", async () => {
    await withDocument();
    access.calls.length = 0;
    ctrl(document.body, "s");
    expect(access.calls[0]).toBe("startPermissionRequest"); // before the first await
  });

  it("ignored while a save is running (11-e): one write only", async () => {
    const permission = deferred();
    await withDocument({ permission: permission.promise });
    showPalette();
    commitChange(isPara("Hello"), "Hello changed.");
    ctrl(document.body, "s");
    const second = ctrl(document.body, "s");
    expect(second.defaultPrevented).toBe(true); // no browser "Save page" either
    permission.resolve("granted");
    await settle();
    expect(access.calls.filter((c) => c.startsWith("writeFile:"))).toHaveLength(1);
  });

  it("taken in the initial state and in the code view too, but nothing is saved (owner ruling: GRSMD owns Ctrl+S)", async () => {
    app = await setupApp();
    const save = vi.spyOn(app.ui, "requestSave");
    const saveAs = vi.spyOn(app.ui, "requestSaveAs");
    expect(ctrl(document.body, "s").defaultPrevented).toBe(true);
    app.elements.editor.focus();
    expect(ctrl(app.elements.editor, "S", { shiftKey: true }).defaultPrevented).toBe(true);
    document.dispatchEvent(dropEvent(new File(["x = 1\n"], "a.py"), null));
    await settle();
    expect(ctrl(document.body, "s").defaultPrevented).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(saveAs).not.toHaveBeenCalled();
  });

  it("a held key: the first keydown saves, the repeats are taken and do nothing (owner ruling)", async () => {
    await withDocument();
    const save = vi.spyOn(app.ui, "requestSave");
    expect(ctrl(document.body, "s").defaultPrevented).toBe(true);
    for (let i = 0; i < 3; i++) expect(ctrl(document.body, "s", { repeat: true }).defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("Mac: Cmd+S saves, Ctrl+S is the browser's", async () => {
    await withDocument({ isApple: true });
    const save = vi.spyOn(app.ui, "requestSave");
    expect(ctrl(document.body, "s").defaultPrevented).toBe(false);
    expect(keydown(document.body, "s", { metaKey: true, code: "KeyS" }).defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("not taken with Alt (AltGr) or during IME; a repeat is taken but saves nothing; a non-Latin layout uses the code", async () => {
    await withDocument();
    const save = vi.spyOn(app.ui, "requestSave");
    expect(ctrl(document.body, "s", { altKey: true }).defaultPrevented).toBe(false);
    expect(ctrl(document.body, "s", { repeat: true }).defaultPrevented).toBe(true);
    expect(ctrl(document.body, "s", { isComposing: true }).defaultPrevented).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(keydown(document.body, "\u044b", { ctrlKey: true, code: "KeyS" }).defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("AT-KEY-03 primary + Z: the unit Undo in edit mode (INV-59, ruling Q2 / Q3)", () => {
  it("(Q3) edit mode off: not taken, nothing undone", async () => {
    await withDocument();
    showPalette();
    commitChange(isPara("Hello"), "Hello changed.");
    showPalette(); // hide
    expect(app.ui.palette.isShown()).toBe(false);
    expect(ctrl(document.body, "z").defaultPrevented).toBe(false);
    expect(app.orchestrator.getBody()).toContain("Hello changed.");
  });

  it("(c) edit mode, no editor: taken, undoes the last unit", async () => {
    await withDocument();
    showPalette();
    commitChange(isPara("Hello"), "Hello changed.");
    const e = ctrl(document.body, "z");
    expect(e.defaultPrevented).toBe(true);
    expect(app.orchestrator.getBody()).toBe(DOC);
  });

  it("(a) focus in #editor or in another input: the browser's", async () => {
    await withDocument();
    showPalette();
    commitChange(isPara("Hello"), "Hello changed.");
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(ctrl(input, "z").defaultPrevented).toBe(false);
    input.remove();
    app.elements.editor.focus();
    expect(ctrl(app.elements.editor, "z").defaultPrevented).toBe(false);
    expect(app.orchestrator.getBody()).toContain("Hello changed.");
  });

  it("(b) block editor with a change: the browser's character Undo; the editor stays open", async () => {
    await withDocument();
    showPalette();
    const ta = open(isPara("Hello"));
    ta.value = "Hello typed.";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    const e = ctrl(ta, "z");
    expect(e.defaultPrevented).toBe(false);
    expect(app.blockEditor()).toBe(ta);
    expect(ta.value).toBe("Hello typed.");
  });

  it("(c) block editor without a change: taken; the editor closes and the last unit is undone", async () => {
    await withDocument();
    showPalette();
    commitChange(isPara("Hello"), "Hello changed.");
    const ta = open(isPara("Second"));
    const e = ctrl(ta, "z");
    expect(e.defaultPrevented).toBe(true);
    expect(app.blockEditor()).toBeNull();
    expect(app.orchestrator.getBody()).toBe(DOC);
  });

  it("(c) with unrendered #editor changes: no undo; #editor is rendered and the toast is shown (INV-45)", async () => {
    await withDocument();
    showPalette();
    commitChange(isPara("Hello"), "Hello changed.");
    app.elements.editor.value = app.elements.editor.value + "Typed\n";
    app.elements.editor.dispatchEvent(new Event("input", { bubbles: true }));
    const undo = vi.spyOn(app.orchestrator, "undoLastCommit");
    document.body.focus();
    expect(ctrl(document.body, "z").defaultPrevented).toBe(true);
    expect(undo).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(CONFIG.messages.edit.editorRenderedFirst, CONFIG.codeView.toastDurationMs);
    expect(app.orchestrator.getBody()).toContain("Typed");
  });

  it("while minimized (still edit mode, Q3): taken and undone", async () => {
    await withDocument();
    showPalette();
    commitChange(isPara("Hello"), "Hello changed.");
    app.ui.palette.dispatchDisplay("minimizeToggled");
    expect(app.ui.palette.isMinimized()).toBe(true);
    expect(ctrl(document.body, "z").defaultPrevented).toBe(true);
    expect(app.orchestrator.getBody()).toBe(DOC);
  });

  it("(c) focus outside a changed editor: the change is cancelled (11-c [hasUncommittedChange]); the record stays", async () => {
    await withDocument();
    showPalette();
    commitChange(isPara("Hello"), "Hello changed.");
    const ta = open(isPara("Second"));
    ta.value = "Second typed.";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.blur(); // e.g. Tab out of the editor
    expect(ctrl(document.body, "z").defaultPrevented).toBe(true);
    expect(app.blockEditor()).toBeNull();
    expect(app.orchestrator.getBody()).toContain("Hello changed.");
    expect(app.orchestrator.getBody()).not.toContain("Second typed.");
    expect(app.orchestrator.canUndo()).toBe(true);
  });

  it("a held key: undone once, the repeats are taken and do nothing", async () => {
    await withDocument();
    showPalette();
    commitChange(isPara("Hello"), "Hello changed.");
    const undo = vi.spyOn(app.orchestrator, "undoLastCommit");
    ctrl(document.body, "z");
    expect(ctrl(document.body, "z", { repeat: true }).defaultPrevented).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("primary + Shift + Z and Ctrl+Y are not taken (no Redo; block editor keeps the browser's)", async () => {
    await withDocument();
    showPalette();
    commitChange(isPara("Hello"), "Hello changed.");
    expect(ctrl(document.body, "Z", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(ctrl(document.body, "y").defaultPrevented).toBe(false);
    expect(app.orchestrator.getBody()).toContain("Hello changed.");
  });
});

describe("AT-KEY-04 primary + B / I in an editor (INV-60)", () => {
  it("with a selection: taken and applied (the editor stays open, nothing committed)", async () => {
    await withDocument();
    showPalette();
    const ta = open(isPara("Hello"));
    ta.setSelectionRange(6, 10);
    const e = ctrl(ta, "b");
    expect(e.defaultPrevented).toBe(true);
    expect(ta.value).toBe("Hello **word** here.");
    ta.setSelectionRange(0, 5);
    expect(ctrl(ta, "i").defaultPrevented).toBe(true);
    expect(ta.value).toBe("*Hello* **word** here.");
    expect(app.blockEditor()).toBe(ta);
    expect(app.orchestrator.getBody()).toBe(DOC);
  });

  it("without a selection: taken (the browser does nothing either), the text is unchanged", async () => {
    await withDocument();
    showPalette();
    const ta = open(isPara("Hello"));
    ta.setSelectionRange(3, 3);
    expect(ctrl(ta, "b").defaultPrevented).toBe(true);
    expect(ta.value).toBe("Hello word here.");
  });

  it("a held key: applied once, the repeats are taken and do nothing", async () => {
    await withDocument();
    showPalette();
    const ta = open(isPara("Hello"));
    ta.setSelectionRange(6, 10);
    ctrl(ta, "b");
    expect(ta.value).toBe("Hello **word** here.");
    ta.setSelectionRange(8, 12); // "word" inside the stars: a second Bold would remove them
    expect(ctrl(ta, "b", { repeat: true }).defaultPrevented).toBe(true);
    expect(ta.value).toBe("Hello **word** here.");
  });

  it("not editing, or in #editor, or with Shift: the browser's", async () => {
    await withDocument();
    showPalette();
    expect(ctrl(document.body, "b").defaultPrevented).toBe(false);
    expect(ctrl(document.body, "i").defaultPrevented).toBe(false);
    app.elements.editor.focus();
    expect(ctrl(app.elements.editor, "b").defaultPrevented).toBe(false);
    const ta = open(isPara("Hello"));
    ta.setSelectionRange(6, 10);
    expect(ctrl(ta, "B", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(ta.value).toBe("Hello word here.");
  });
});

describe("AT-KEY-05 INV-14 (1): a key another handler already took is not a shortcut", () => {
  it("defaultPrevented 'l' and Ctrl+S do nothing on the document", async () => {
    await withDocument();
    const save = vi.spyOn(app.ui, "requestSave");
    const render = vi.spyOn(app.ui, "handleRender");
    const take = (e) => e.preventDefault();
    document.body.addEventListener("keydown", take);
    keydown(document.body, "l");
    ctrl(document.body, "s");
    document.body.removeEventListener("keydown", take);
    expect(render).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("other Ctrl keys stay with the browser (PRT-J01)", async () => {
    await withDocument();
    for (const key of ["c", "v", "x", "a", "f", "p", "l", "d"]) {
      expect(ctrl(document.body, key).defaultPrevented, key).toBe(false);
    }
  });
});

describe("AT-KEY-06 Apple platforms: Cmd is the primary modifier", () => {
  it("Cmd+Z and Cmd+B are taken; Ctrl+Z and Ctrl+B are the browser's", async () => {
    await withDocument({ isApple: true });
    showPalette();
    commitChange(isPara("Hello"), "Hello changed.");
    expect(ctrl(document.body, "z").defaultPrevented).toBe(false);
    expect(keydown(document.body, "z", { metaKey: true, code: "KeyZ" }).defaultPrevented).toBe(true);
    expect(app.orchestrator.getBody()).toBe(DOC);
    const ta = open(isPara("Hello"));
    ta.setSelectionRange(6, 10);
    expect(ctrl(ta, "b").defaultPrevented).toBe(false);
    expect(ta.value).toBe("Hello word here.");
    expect(keydown(ta, "b", { metaKey: true, code: "KeyB" }).defaultPrevented).toBe(true);
    expect(ta.value).toBe("Hello **word** here.");
  });
});

describe("AT-KEY-07 in a table cell: primary + Z is the unit Undo, B / I format the cell (INV-59 (c), INV-60)", () => {
  const TDOC = `${DOC}\n| A | B |\n| --- | --- |\n| x | y |\n`;
  const cellEl = (r, c) => app.block((b) => b.type === "table").el.querySelector(":scope > table").rows[r].cells[c];

  function typeInCell(td, text) {
    td.textContent = text;
    td.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("a changed cell: Ctrl+Z is taken and takes the cell's change back (INV-48 (1)); the table session ends", async () => {
    await withDocument({ doc: TDOC });
    showPalette();
    tap(cellEl(1, 0));
    const td = cellEl(1, 0);
    td.focus();
    typeInCell(td, "changed");
    const e = ctrl(td, "z");
    expect(e.defaultPrevented).toBe(true);
    expect(app.ui.blockEdit.isEditing()).toBe(false);
    expect(cellEl(1, 0).textContent).toBe("x");
    expect(app.orchestrator.getBody()).toBe(TDOC);
  });

  it("a cell without a change: Ctrl+Z undoes the last unit (the cell committed before)", async () => {
    await withDocument({ doc: TDOC });
    showPalette();
    tap(cellEl(1, 0));
    typeInCell(cellEl(1, 0), "x2");
    keydown(cellEl(1, 0), "Tab");
    expect(app.orchestrator.getBody()).toContain("x2");
    const e = ctrl(cellEl(1, 1), "z");
    expect(e.defaultPrevented).toBe(true);
    expect(app.orchestrator.getBody()).toBe(TDOC);
  });

  it("Ctrl+B with a selection in the cell makes it bold; Ctrl+Shift+Z is stopped (no Redo)", async () => {
    await withDocument({ doc: TDOC });
    showPalette();
    tap(cellEl(1, 1));
    const td = cellEl(1, 1);
    const range = document.createRange();
    range.selectNodeContents(td);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    expect(ctrl(td, "b").defaultPrevented).toBe(true);
    expect(td.querySelector("strong")?.textContent).toBe("y");
    expect(ctrl(td, "z", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(app.ui.blockEdit.isEditingCell()).toBe(true);
  });
});
