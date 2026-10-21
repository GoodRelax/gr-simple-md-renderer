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
import { tap, pointer, keydown } from "./helpers/editDom.js";
import { fakeFileAccess, fakeFileHandle } from "./helpers/fakeFs.js";

const M = CONFIG.messages.edit;
const TOAST_MS = CONFIG.codeView.toastDurationMs;
const DOC = "# Title\n\nHello word here.\n\nSecond para.\n\n| A | B |\n|---|---|\n| x | y |\n";
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

async function withDocument() {
  access = fakeFileAccess();
  app = await setupApp({ fileAccess: access });
  const handle = fakeFileHandle({ name: "doc.md", content: [DOC], calls: access.calls });
  document.dispatchEvent(dropEvent(new File([DOC], "doc.md", { lastModified: 1000 }), handle));
  await settle();
  keydown(document.body, "e");
  return app;
}

const btn = (id) => app.paletteRoot().querySelector(`#${id}`);
const off = (el) => el.getAttribute("aria-disabled") === "true";
const popoverButton = (label) =>
  document.body.querySelector(`:scope > div.edit-palette-popover button[aria-label="${label}"]`);

/** Press and release (jsdom layout: every rect is at 0,0). */
function press(el) {
  const down = pointer(el, "pointerdown", { x: 0, y: 0 });
  pointer(el, "pointerup", { x: 0, y: 0 });
  return down;
}

function open(pred) {
  const el = app.block(pred).el;
  tap(el.querySelector(":scope > .grsmd-table-tab") ?? el.firstElementChild); // a table: its source (INV-29 (b))
  return app.blockEditor();
}

/** One animation frame (the button states are batched per frame, INV-51). */
const nextFrame = () =>
  new Promise((resolve) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 16)));

async function selectInEditor(ta, start, end) {
  ta.setSelectionRange(start, end);
  document.dispatchEvent(new Event("selectionchange"));
  await nextFrame();
}

/** Type into the open block editor (an input event, as the browser sends). */
function typeInBlock(ta, text) {
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

function typeInEditor(text) {
  app.elements.editor.value = text;
  app.elements.editor.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("button states follow the editor (5.15.5)", () => {
  it("not editing: Bold / Italic / Row / Column disabled; Undo disabled without a record", async () => {
    await withDocument();
    for (const id of ["paletteBold", "paletteItalic", "paletteRow", "paletteColumn", "paletteUndo"]) {
      expect(off(btn(id)), id).toBe(true);
    }
    for (const id of ["paletteTable", "paletteMermaid", "paletteSave", "paletteSaveAs"]) {
      expect(off(btn(id)), id).toBe(false);
    }
  });

  it("editing a paragraph: Bold needs a selection; Row / Column stay disabled", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    expect(off(btn("paletteBold"))).toBe(true);
    await selectInEditor(ta, 6, 10);
    expect(off(btn("paletteBold"))).toBe(false);
    expect(off(btn("paletteItalic"))).toBe(false);
    expect(off(btn("paletteRow"))).toBe(true);
  });

  it("editing a table: Row and Column enabled", async () => {
    await withDocument();
    open((b) => b.type === "table");
    expect(off(btn("paletteRow"))).toBe(false);
    expect(off(btn("paletteColumn"))).toBe(false);
  });
});

describe("Bold / Italic / Insert row / column (INV-52, INV-36)", () => {
  it("Bold wraps the selection; the editor keeps the focus; nothing is committed", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    await selectInEditor(ta, 6, 10);
    const commit = vi.spyOn(app.orchestrator, "commitBlock");
    const down = press(btn("paletteBold"));
    expect(down.defaultPrevented).toBe(true);
    expect(ta.value).toBe("Hello **word** here.");
    expect(document.activeElement).toBe(ta);
    expect(commit).not.toHaveBeenCalled();
    expect(app.ui.blockEdit.isEditing()).toBe(true);
  });

  it("Italic on an italic selection removes it", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    await selectInEditor(ta, 6, 10);
    press(btn("paletteItalic"));
    expect(ta.value).toBe("Hello *word* here.");
    await selectInEditor(ta, ta.selectionStart, ta.selectionEnd);
    press(btn("paletteItalic"));
    expect(ta.value).toBe("Hello word here.");
  });

  it("the states follow the selection once per frame (INV-51)", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    const states = vi.spyOn(app.ui.palette, "setButtonStates");
    states.mockClear();
    ta.setSelectionRange(6, 10);
    document.dispatchEvent(new Event("selectionchange"));
    ta.setSelectionRange(6, 9);
    document.dispatchEvent(new Event("selectionchange"));
    expect(states).not.toHaveBeenCalled();
    await nextFrame();
    expect(states).toHaveBeenCalledTimes(1);
    expect(off(btn("paletteBold"))).toBe(false);
  });

  it("Bold / Italic / colors are disabled where no inline range holds the selection (INV-67 (6))", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    typeInBlock(ta, "a\n\nb");
    await selectInEditor(ta, 0, 4);
    for (const id of ["paletteBold", "paletteItalic"]) expect(off(btn(id)), id).toBe(true);
    for (const label of ["Text color: Red", "Remove text color"]) expect(off(popoverButton(label)), label).toBe(true);
    await selectInEditor(ta, 0, 1);
    for (const id of ["paletteBold", "paletteItalic"]) expect(off(btn(id)), id).toBe(false);
    for (const label of ["Text color: Red", "Remove text color"]) expect(off(popoverButton(label)), label).toBe(false);
  });

  it("Bold where the selection crosses markers keeps the rest of the text (INV-67 (7))", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    typeInBlock(ta, "x __y__ z");
    await selectInEditor(ta, 8, 9);
    press(btn("paletteBold"));
    expect(ta.value).toBe("x __y__ **z**");
  });

  it("a text color from the format popover; Remove text color takes it away (INV-66)", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    await selectInEditor(ta, 6, 10);
    press(btn("paletteFormat"));
    press(popoverButton("Text color: Red"));
    expect(ta.value).toBe(`Hello <span style="color: ${CONFIG.edit.textColors.red.light}">word</span> here.`);
    expect(document.activeElement).toBe(ta);
    await selectInEditor(ta, ta.selectionStart, ta.selectionEnd);
    press(btn("paletteFormat"));
    press(popoverButton("Remove text color"));
    expect(ta.value).toBe("Hello word here.");
  });

  it("Insert row / column in a table change only the editor text", async () => {
    await withDocument();
    const ta = open((b) => b.type === "table");
    const caret = ta.value.indexOf("x") + 1;
    await selectInEditor(ta, caret, caret);
    press(btn("paletteRow"));
    expect(ta.value.split("\n")).toHaveLength(4);
    press(btn("paletteColumn"));
    expect(ta.value.split("\n")[0].split("|").length).toBe(5);
    expect(app.orchestrator.getBody()).toBe(DOC);
  });
});

describe("palette wiring of unit A (5.15.5, INV-68)", () => {
  it("Format is enabled while a block editor is open; the not yet wired buttons stay disabled", async () => {
    await withDocument();
    expect(off(btn("paletteFormat"))).toBe(true);
    open(isPara("Hello"));
    expect(off(btn("paletteFormat"))).toBe(false);
    for (const id of ["paletteRowDelete", "paletteColumnDelete", "paletteTableOptions"]) expect(off(btn(id)), id).toBe(true);
  });

  it("Esc with the Format popover open closes only the popover; the next Esc cancels the editor (INV-53, PRT-V12)", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    ta.value = "Changed.";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    press(btn("paletteFormat"));
    const menu = document.getElementById("paletteFormatMenu");
    expect(menu.hidden).toBe(false);
    const first = keydown(ta, "Escape");
    expect(first.defaultPrevented).toBe(true);
    expect(menu.hidden).toBe(true);
    expect(app.blockEditor()).toBe(ta);
    expect(ta.value).toBe("Changed.");
    expect(app.ui.palette.isShown()).toBe(true);
    keydown(ta, "Escape");
    expect(app.blockEditor()).toBeNull();
    expect(app.orchestrator.getBody()).toBe(DOC);
    expect(app.ui.palette.isShown()).toBe(true);
  });

  it("INV-68: minimizing keeps the open editor, its text and edit mode; the dot follows unsaved (cancel, commit, Undo)", async () => {
    await withDocument();
    const root = app.paletteRoot();
    const grip = root.querySelector(".edit-palette-grip");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const longPress = () => {
      pointer(grip, "pointerdown", { x: 0, y: 0 });
      vi.advanceTimersByTime(CONFIG.edit.paletteLongPressMs);
      pointer(grip, "pointerup", { x: 0, y: 0 });
    };
    try {
      let ta = open(isPara("Hello"));
      ta.value = "Changed.";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      longPress();
      expect(app.ui.palette.isMinimized()).toBe(true);
      expect(app.blockEditor()).toBe(ta); // the editor stays open
      expect(ta.value).toBe("Changed.");
      expect(document.body.classList.contains("edit-mode")).toBe(true);
      expect(app.ui.palette.isShown()).toBe(true);
      expect(root.classList.contains("edit-palette-unsaved")).toBe(true);

      keydown(ta, "Escape"); // cancel: nothing unsaved any more
      expect(app.blockEditor()).toBeNull();
      expect(app.ui.palette.isMinimized()).toBe(true);
      expect(root.classList.contains("edit-palette-unsaved")).toBe(false);

      ta = open(isPara("Hello"));
      ta.value = "Changed again.";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      pointer(document.body, "pointerdown"); // commit
      expect(app.orchestrator.getBody()).toContain("Changed again.");
      expect(root.classList.contains("edit-palette-unsaved")).toBe(true);

      longPress(); // restore, then Undo
      expect(app.ui.palette.isMinimized()).toBe(false);
      press(btn("paletteUndo"));
      expect(app.orchestrator.getBody()).toBe(DOC);
      expect(root.classList.contains("edit-palette-unsaved")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the unsaved dot of the minimized palette follows the unsaved mark", async () => {
    await withDocument();
    const root = app.paletteRoot();
    expect(root.classList.contains("edit-palette-unsaved")).toBe(false);
    const ta = open(isPara("Hello"));
    ta.value = "Changed.";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    expect(root.classList.contains("edit-palette-unsaved")).toBe(true);
  });
});

describe("AT-UI-35 Undo", () => {
  it("INV-48: disabled without a record and without a change; enabled by a change in the open editor; enabled after a commit; press undoes and disables it", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    expect(off(btn("paletteUndo"))).toBe(true);
    ta.value = "Changed.";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await nextFrame(); // typing: the states follow in the next frame (INV-51)
    expect(off(btn("paletteUndo"))).toBe(false);
    pointer(document.body, "pointerdown");
    expect(off(btn("paletteUndo"))).toBe(false);
    press(btn("paletteUndo"));
    expect(app.orchestrator.getBody()).toBe(DOC);
    expect(off(btn("paletteUndo"))).toBe(true);
  });

  it("INV-48 (1): Undo with a changed open editor cancels the change and closes it; the record stays", async () => {
    await withDocument();
    let ta = open(isPara("Hello"));
    ta.value = "Changed.";
    pointer(document.body, "pointerdown"); // the record
    ta = open(isPara("Second"));
    ta.value = "Second changed.";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    press(btn("paletteUndo"));
    expect(app.blockEditor()).toBeNull();
    expect(app.orchestrator.getBody()).toContain("Changed.");
    expect(app.orchestrator.getBody()).not.toContain("Second changed.");
    expect(off(btn("paletteUndo"))).toBe(false);
    press(btn("paletteUndo")); // (2): the record
    expect(app.orchestrator.getBody()).toBe(DOC);
  });

  it("INV-48 (2): Undo with an unchanged open editor closes it and undoes the record", async () => {
    await withDocument();
    let ta = open(isPara("Hello"));
    ta.value = "Changed.";
    pointer(document.body, "pointerdown");
    ta = open(isPara("Second"));
    press(btn("paletteUndo"));
    expect(app.blockEditor()).toBeNull();
    expect(app.orchestrator.getBody()).toBe(DOC);
  });

  it("with unrendered #editor changes: no undo; #editor is rendered (its text stays), toast, the record is empty", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    ta.value = "Changed.";
    pointer(document.body, "pointerdown");
    typeInEditor(app.elements.editor.value + "Typed\n");
    const undo = vi.spyOn(app.orchestrator, "undoLastCommit");
    press(btn("paletteUndo"));
    expect(undo).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(M.editorRenderedFirst, TOAST_MS);
    expect(app.orchestrator.getBody()).toContain("Typed");
    expect(app.elements.editor.value).toContain("Typed");
    expect(app.orchestrator.canUndo()).toBe(false);
  });
});

describe("AT-UI-36 / 37 Insert table and Mermaid samples", () => {
  it("while editing: only the editor text changes; the undo record is unchanged", async () => {
    await withDocument();
    const ta = open(isPara("Second"));
    await selectInEditor(ta, ta.value.length, ta.value.length);
    press(btn("paletteTable"));
    expect(ta.value).toContain(CONFIG.edit.tableTemplate);
    expect(app.orchestrator.getBody()).toBe(DOC);
    expect(app.orchestrator.canUndo()).toBe(false);
  });

  it("not editing: after the last opened block, as one model change (undoable)", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    keydown(ta, "Escape");
    press(btn("paletteTable"));
    const body = app.orchestrator.getBody();
    expect(body.indexOf(CONFIG.edit.tableTemplate)).toBeGreaterThan(body.indexOf("Hello word here."));
    expect(body.indexOf(CONFIG.edit.tableTemplate)).toBeLessThan(body.indexOf("Second para."));
    expect(app.orchestrator.canUndo()).toBe(true);
    expect(app.elements.editor.value).toBe(body);
  });

  it("not editing and nothing opened yet: at the end of the document", async () => {
    await withDocument();
    press(btn("paletteTable"));
    expect(app.orchestrator.getBody().trimEnd().endsWith(CONFIG.edit.tableTemplate)).toBe(true);
  });

  it("not editing with unrendered #editor changes: no insert; render from #editor and toast", async () => {
    await withDocument();
    typeInEditor(DOC + "Typed\n");
    const insert = vi.spyOn(app.orchestrator, "insertAfter");
    press(btn("paletteTable"));
    expect(insert).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(M.editorRenderedFirst, TOAST_MS);
    expect(app.orchestrator.getBody()).toContain("Typed");
  });

  it("AT-UI-37 popover Sequence diagram: the sequence sample is inserted and the popover closes", async () => {
    await withDocument();
    const insert = vi.spyOn(app.orchestrator, "insertAfter");
    press(btn("paletteMermaid"));
    press(popoverButton("Sequence diagram"));
    expect(insert.mock.calls[0][1]).toBe(CONFIG.edit.mermaidSamples.sequence);
    expect(popoverButton("Sequence diagram").closest(".edit-palette-popover").hidden).toBe(true);
  });
});

describe("AT-UI-38 nothing is stored", () => {
  it("after showing, moving, editing, saving and downloading: no storage, no cookie", async () => {
    localStorage.clear();
    sessionStorage.clear();
    await withDocument();
    const grip = app.paletteRoot().querySelector(".edit-palette-grip");
    pointer(grip, "pointerdown", { x: 5, y: 5 });
    pointer(grip, "pointermove", { x: 50, y: 50 });
    pointer(grip, "pointerup", { x: 50, y: 50 });
    const ta = open(isPara("Hello"));
    ta.value = "Edited.";
    pointer(document.body, "pointerdown");
    await app.ui.requestSave();
    await app.ui.requestSaveAs();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });
});

describe("AT-UI-39 an open table cell (5.15.5, INV-65, W7)", () => {
  const tableEl = () => app.block((b) => b.type === "table").el.querySelector(":scope > table");
  const cellEl = (r, c) => tableEl().rows[r].cells[c];
  const tableRaw = () => app.block((b) => b.type === "table").block.raw;

  it("Insert table and Mermaid off; Row / Column, Delete row / column and Table options on; the column's alignment pressed", async () => {
    await withDocument();
    tap(cellEl(1, 0));
    expect(app.ui.blockEdit.isEditingCell()).toBe(true);
    for (const id of ["paletteTable", "paletteMermaid"]) expect(off(btn(id)), id).toBe(true);
    for (const id of ["paletteRow", "paletteColumn", "paletteRowDelete", "paletteColumnDelete", "paletteTableOptions", "paletteFormat"]) {
      expect(off(btn(id)), id).toBe(false);
    }
    expect(popoverButton("Default alignment").getAttribute("aria-pressed")).toBe("true");
    expect(popoverButton("Align center").getAttribute("aria-pressed")).toBe("false");
  });

  it("the header row cannot be deleted; a table of one column cannot lose its column (D2)", async () => {
    await withDocument();
    tap(cellEl(0, 1));
    expect(off(btn("paletteRowDelete"))).toBe(true);
    expect(off(btn("paletteColumnDelete"))).toBe(false);
  });

  it("not in a cell: Delete row / column and Table options are off (also in the table's source)", async () => {
    await withDocument();
    for (const id of ["paletteRowDelete", "paletteColumnDelete", "paletteTableOptions"]) expect(off(btn(id)), id).toBe(true);
    open((b) => b.type === "table");
    for (const id of ["paletteRowDelete", "paletteColumnDelete", "paletteTableOptions"]) expect(off(btn(id)), id).toBe(true);
    expect(off(btn("paletteRow"))).toBe(false);
  });

  it("the buttons run INV-65 on the cell's table: Insert row, Delete column, an alignment", async () => {
    await withDocument();
    tap(cellEl(1, 0));
    press(btn("paletteRow"));
    expect(tableEl().rows.length).toBe(3);
    expect(cellEl(2, 0).classList.contains("grsmd-cell-editing")).toBe(true);
    press(btn("paletteColumnDelete"));
    expect(tableEl().rows[0].cells.length).toBe(1);
    press(btn("paletteTableOptions"));
    press(popoverButton("Align right"));
    expect(tableRaw().split("\n")[1]).toMatch(/^\| -+: \|$/);
    expect(popoverButton("Align right").getAttribute("aria-pressed")).toBe("true");
  });

  it("Insert table does nothing while a cell is open (W7)", async () => {
    await withDocument();
    tap(cellEl(1, 0));
    const body = app.orchestrator.getBody();
    app.ui._runPaletteCommand("insertTable");
    expect(app.orchestrator.getBody()).toBe(body);
  });

  it("Bold follows the selection in the cell and applies to it", async () => {
    await withDocument();
    tap(cellEl(1, 0));
    const td = cellEl(1, 0);
    const range = document.createRange();
    range.selectNodeContents(td);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await nextFrame();
    expect(off(btn("paletteBold"))).toBe(false);
    press(btn("paletteBold"));
    expect(td.querySelector("strong")?.textContent).toBe("x");
  });
});
