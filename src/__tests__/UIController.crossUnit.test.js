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
import ModalController from "../js/classes/ModalController.js";
import { CONFIG } from "../js/config.js";
import { setupApp, dropEvent, settle } from "./helpers/appStack.js";
import { tap, pointer, keydown } from "./helpers/editDom.js";
import { fakeFileAccess, fakeFileHandle } from "./helpers/fakeFs.js";

// Cases that cross the UI units (A palette x B keys x D formats x E cells x
// G theme): review T-3 and K-1 to K-4. The whole app on the real renderer.

const M = CONFIG.messages.edit;
const TOAST_MS = CONFIG.codeView.toastDurationMs;
const DOC = "# Title\n\nHello word here.\n\n| A | B |\n|---|---|\n| x | y |\n| p | q |\n\nAfter.\n";

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

async function withDocument(doc = DOC) {
  access = fakeFileAccess();
  app = await setupApp({ fileAccess: access });
  const handle = fakeFileHandle({ name: "doc.md", content: [doc], calls: access.calls });
  document.dispatchEvent(dropEvent(new File([doc], "doc.md", { lastModified: 1000 }), handle));
  await settle();
  keydown(document.body, "e");
  return app;
}

const btn = (id) => app.paletteRoot().querySelector(`#${id}`);
const popoverButton = (label) =>
  document.body.querySelector(`:scope > div.edit-palette-popover button[aria-label="${label}"]`);
const tableEl = () => app.block((b) => b.type === "table").el.querySelector(":scope > table");
const cellEl = (r, c) => tableEl().rows[r].cells[c];
const tableRaw = () => app.block((b) => b.type === "table").block.raw;
const openCellEl = () => app.preview.querySelector(".grsmd-cell-editing");

/** Press and release (jsdom layout: every rect is at 0,0). */
function press(el) {
  pointer(el, "pointerdown", { x: 0, y: 0 });
  pointer(el, "pointerup", { x: 0, y: 0 });
}

/** Select all the text of the open cell, as the user does. */
function selectCellText() {
  const range = document.createRange();
  range.selectNodeContents(openCellEl());
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

const ctrl = (el, key, init = {}) => keydown(el, key, { ctrlKey: true, ...init });

/** Long press on the grip (fake timers on): minimize or restore (INV-68). */
function longPressGrip() {
  const grip = app.paletteRoot().querySelector(".edit-palette-grip");
  pointer(grip, "pointerdown", { x: 0, y: 0 });
  vi.advanceTimersByTime(CONFIG.edit.paletteLongPressMs);
  pointer(grip, "pointerup", { x: 0, y: 0 });
}

/** The marks layer is drawn in the frame after a block editor opens (INV-70). */
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Change the open cell's text (the user typed). */
function typeInCell(text) {
  const cell = openCellEl();
  cell.replaceChildren(document.createTextNode(text));
  cell.dispatchEvent(new Event("input", { bubbles: true }));
  return cell;
}

describe("AT-UI-51 K-1 an open popover stays open while the cell moves or the table changes (5.15.1, 11-f)", () => {
  const cases = [
    ["Align column", "paletteTableOptions", "paletteTableMenu"],
    ["Format", "paletteFormat", "paletteFormatMenu"],
  ];
  for (const [name, opener, menuId] of cases) {
    it(`${name}: Tab and Enter from a changed cell, Insert row and Insert column keep it open`, async () => {
      await withDocument();
      tap(cellEl(1, 0));
      press(btn(opener));
      const menu = document.getElementById(menuId);
      expect(menu.hidden).toBe(false);
      typeInCell("x1");
      keydown(openCellEl(), "Tab");
      expect(tableRaw()).toContain("x1");
      expect(openCellEl()).toBe(cellEl(1, 1));
      expect(menu.hidden, "Tab").toBe(false);
      typeInCell("y1");
      keydown(openCellEl(), "Enter");
      expect(tableRaw()).toContain("y1");
      expect(openCellEl()).toBe(cellEl(2, 1));
      expect(menu.hidden, "Enter").toBe(false);
      press(btn("paletteRow"));
      expect(tableEl().rows.length).toBe(4);
      expect(menu.hidden, "Insert row").toBe(false);
      press(btn("paletteColumn"));
      expect(tableEl().rows[0].cells.length).toBe(3);
      expect(menu.hidden, "Insert column").toBe(false);
    });
  }

  it("T-3 (8): the Enter of the last row, through the real setButtonStates, closes it (11-f openerDisabled)", async () => {
    await withDocument();
    tap(cellEl(2, 1));
    press(btn("paletteTableOptions"));
    const menu = document.getElementById("paletteTableMenu");
    expect(menu.hidden).toBe(false);
    typeInCell("q1");
    keydown(openCellEl(), "Enter");
    expect(app.ui.blockEdit.isEditingCell()).toBe(false);
    expect(btn("paletteTableOptions").getAttribute("aria-disabled")).toBe("true");
    expect(menu.hidden).toBe(true);
  });
});

describe("AT-UI-52 K-2 a held Esc acts once (owner ruling Q-a, INV-14, 5.11)", () => {
  const repeatEsc = (el) => keydown(el, "Escape", { repeat: true });

  it("in a cell: the first Esc cancels the cell, the repeats do not hide the palette", async () => {
    await withDocument();
    tap(cellEl(1, 0));
    const cell = typeInCell("changed");
    keydown(cell, "Escape");
    expect(app.ui.blockEdit.isEditingCell()).toBe(false);
    expect(tableRaw()).not.toContain("changed");
    repeatEsc(document.activeElement ?? document.body);
    repeatEsc(document.body);
    expect(app.ui.palette.isShown()).toBe(true);
  });

  it("in a block editor: the first Esc cancels it, the repeats do not hide the palette", async () => {
    await withDocument();
    tap(app.block((b) => b.type === "paragraph").el.firstElementChild);
    const ta = app.blockEditor();
    keydown(ta, "Escape");
    expect(app.blockEditor()).toBeNull();
    repeatEsc(document.body);
    expect(app.ui.palette.isShown()).toBe(true);
  });

  it("with a popover open: the first Esc closes the popover, the repeats keep the editor and the palette", async () => {
    await withDocument();
    tap(app.block((b) => b.type === "paragraph").el.firstElementChild);
    const ta = app.blockEditor();
    press(btn("paletteFormat"));
    const menu = document.getElementById("paletteFormatMenu");
    keydown(ta, "Escape");
    expect(menu.hidden).toBe(true);
    const repeat = repeatEsc(ta);
    expect(repeat.defaultPrevented).toBe(true);
    expect(app.blockEditor()).toBe(ta);
    repeatEsc(document.body);
    expect(app.ui.palette.isShown()).toBe(true);
  });

  it("a repeated Esc in a cell keeps the cell open", async () => {
    await withDocument();
    tap(cellEl(1, 0));
    const cell = typeInCell("changed");
    repeatEsc(cell);
    expect(app.ui.blockEdit.isEditingCell()).toBe(true);
  });

  it("in edit mode with nothing open, a held Esc hides the palette once; a new press hides it", async () => {
    await withDocument();
    repeatEsc(document.body);
    expect(app.ui.palette.isShown()).toBe(true);
    keydown(document.body, "Escape");
    expect(app.ui.palette.isShown()).toBe(false);
  });
});

describe("AT-UI-53 T-3 (1) Ctrl+B in a WYSIWYG cell, then Ctrl+Z (INV-48, INV-59 (c))", () => {
  it("Ctrl+Z right after Ctrl+B takes the cell's change back and keeps the record (INV-48 (1))", async () => {
    await withDocument();
    tap(cellEl(1, 0));
    selectCellText();
    expect(ctrl(openCellEl(), "b").defaultPrevented).toBe(true);
    expect(openCellEl().querySelector("strong")?.textContent).toBe("x");
    expect(app.orchestrator.canUndo()).toBe(false);
    ctrl(openCellEl(), "z");
    expect(app.ui.blockEdit.isEditingCell()).toBe(false);
    expect(tableRaw()).not.toContain("**");
    expect(cellEl(1, 0).querySelector("strong")).toBe(null);
    expect(app.orchestrator.canUndo()).toBe(false);
  });

  it("Ctrl+B, Tab, Ctrl+Z: the unit Undo goes back to the table before the format", async () => {
    await withDocument();
    const before = app.orchestrator.getBody();
    tap(cellEl(1, 0));
    selectCellText();
    ctrl(openCellEl(), "b");
    keydown(openCellEl(), "Tab");
    expect(tableRaw()).toContain("**x**");
    expect(openCellEl()).toBe(cellEl(1, 1));
    ctrl(openCellEl(), "z");
    expect(app.orchestrator.getBody()).toBe(before);
    expect(app.ui.blockEdit.isEditingCell()).toBe(false);
  });
});

describe("AT-UI-54 T-3 (2) Esc with a popover open while a cell is open (INV-53, INV-64)", () => {
  for (const [name, opener, menuId] of [
    ["Format", "paletteFormat", "paletteFormatMenu"],
    ["Align column", "paletteTableOptions", "paletteTableMenu"],
  ]) {
    it(`${name}: the first Esc closes the popover only, the second takes the cell back; the palette stays`, async () => {
      await withDocument();
      tap(cellEl(1, 0));
      typeInCell("changed");
      press(btn(opener));
      const menu = document.getElementById(menuId);
      expect(menu.hidden).toBe(false);
      const first = keydown(openCellEl(), "Escape");
      expect(first.defaultPrevented).toBe(true);
      expect(menu.hidden).toBe(true);
      expect(app.ui.blockEdit.isEditingCell()).toBe(true);
      expect(openCellEl().textContent).toBe("changed");
      keydown(openCellEl(), "Escape");
      expect(app.ui.blockEdit.isEditingCell()).toBe(false);
      expect(tableRaw()).not.toContain("changed");
      expect(app.ui.palette.isShown()).toBe(true);
    });
  }
});

describe("AT-UI-55 T-3 (3) Bold over invisible characters in a cell (INV-67, INV-70, ruling V1)", () => {
  it("the marks are there again after the cell is drawn again, the selection stays, the file keeps the characters", async () => {
    await withDocument("| A | B |\n|---|---|\n| a\u00a0b\u200bc | y |\n");
    tap(cellEl(1, 0));
    const marks = () => [...openCellEl().querySelectorAll("span.grsmd-invisible")].map((m) => m.textContent);
    expect(marks()).toEqual(["\u00a0", "\u200b"]);
    selectCellText();
    ctrl(openCellEl(), "b");
    expect(openCellEl().querySelector("strong")?.textContent).toBe("a\u00a0b\u200bc");
    expect(marks()).toEqual(["\u00a0", "\u200b"]);
    expect(window.getSelection().toString()).toBe("a\u00a0b\u200bc");
    keydown(openCellEl(), "Tab");
    expect(tableRaw()).toContain("**a\u00a0b\u200bc**");
    expect(tableRaw()).not.toContain("&nbsp;");
    expect(cellEl(1, 0).querySelector("span.grsmd-invisible")).toBe(null); // no marks outside editing
  });
});

describe("AT-UI-56 T-3 (4) a cell open while the palette is minimized (INV-68)", () => {
  it("the cell stays open; Tab, Ctrl+B and Ctrl+Z work; the dot follows unsaved", async () => {
    await withDocument();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      tap(cellEl(1, 0));
      longPressGrip();
      expect(app.ui.palette.isMinimized()).toBe(true);
      expect(app.ui.blockEdit.isEditingCell()).toBe(true);
      const root = app.paletteRoot();
      expect(root.classList.contains("edit-palette-unsaved")).toBe(false);
      typeInCell("x1");
      expect(root.classList.contains("edit-palette-unsaved")).toBe(true);
      keydown(openCellEl(), "Tab");
      expect(tableRaw()).toContain("x1");
      expect(openCellEl()).toBe(cellEl(1, 1));
      selectCellText();
      ctrl(openCellEl(), "b");
      expect(openCellEl().querySelector("strong")?.textContent).toBe("y");
      ctrl(openCellEl(), "z"); // the cell's change
      expect(cellEl(1, 1).querySelector("strong")).toBe(null);
      ctrl(document.body, "z"); // the unit: the Tab's commit
      expect(tableRaw()).not.toContain("x1");
      expect(root.classList.contains("edit-palette-unsaved")).toBe(false);
      expect(app.ui.palette.isMinimized()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AT-UI-57 T-3 (5) minimized, hidden with e, then a double click on a cell outside edit mode (INV-57, INV-32)", () => {
  it("the palette shows not minimized and the cell opens", async () => {
    await withDocument();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      longPressGrip();
      expect(app.ui.palette.isMinimized()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    keydown(document.body, "e");
    expect(app.ui.palette.isShown()).toBe(false);
    const td = cellEl(2, 1);
    td.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    expect(app.ui.palette.isShown()).toBe(true);
    expect(app.ui.palette.isMinimized()).toBe(false);
    expect(openCellEl()).toBe(cellEl(2, 1));
  });
});

describe("AT-UI-58 T-3 (6) a theme switch with a changed cell or block editor open (fullRenderRequested, INV-47)", () => {
  it("a changed cell: committed, then the full render; no cell is left open", async () => {
    await withDocument("| A | B |\n|---|---|\n| x | y |\n");
    tap(cellEl(1, 0));
    selectCellText();
    press(btn("paletteFormat"));
    press(popoverButton("Text color: Red"));
    expect(openCellEl().querySelector("span[style]")).not.toBe(null);
    await app.ui.handleRender("dark");
    await settle();
    expect(app.ui.blockEdit.isEditing()).toBe(false);
    expect(tableRaw()).toContain(`<span style="color: ${CONFIG.edit.textColors.red.light}">x</span>`);
    expect(app.preview.querySelector(".grsmd-cell-editing, [contenteditable]")).toBe(null);
    // the source keeps the light value; the dark one is CSS (theme e2e)
    expect(cellEl(1, 0).querySelector("span").getAttribute("style")).toContain(CONFIG.edit.textColors.red.light);
  });

  it("a changed block editor with its marks layer: committed, and no layer is left", async () => {
    await withDocument("Para\u00a0graph.\n");
    tap(app.block((b) => b.type === "paragraph").el.firstElementChild);
    await frame();
    expect(app.preview.querySelector(".md-invisible-overlay")).not.toBe(null);
    const ta = app.blockEditor();
    ta.value = "Para\u00a0graph changed.";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await app.ui.handleRender("light");
    await settle();
    await frame();
    expect(app.orchestrator.getBody()).toContain("graph changed.");
    expect(app.preview.querySelector(".md-invisible-overlay")).toBe(null);
    expect(app.blockEditor()).toBe(null);
  });
});

describe("AT-UI-59 T-3 (7) Ctrl+S / Ctrl+Shift+S with a changed cell open (INV-58, INV-21)", () => {
  for (const [name, init, write] of [
    ["Ctrl+S", {}, "writeFile:doc.md"],
    ["Ctrl+Shift+S", { shiftKey: true }, "writeFile:picked.md"],
  ]) {
    it(`${name}: the saved body has the cell's change, the table edit ends, nothing is unsaved`, async () => {
      await withDocument();
      tap(cellEl(1, 0));
      typeInCell("saved");
      const e = ctrl(openCellEl(), init.shiftKey ? "S" : "s", init);
      expect(e.defaultPrevented).toBe(true);
      expect(app.ui.blockEdit.isEditingCell()).toBe(false);
      await settle();
      expect(access.calls).toContain(write);
      expect(access.writes[access.writes.length - 1].text).toContain("| saved |");
      expect(document.title.startsWith(CONFIG.edit.titleUnsavedPrefix)).toBe(false);
      expect(app.paletteRoot().classList.contains("edit-palette-unsaved")).toBe(false);
    });
  }
});

describe("AT-UI-60 T-3 (8) an opener that the crossing disables closes its popover (11-f openerDisabled, real setButtonStates)", () => {
  it("Ctrl+S with Align column open: the cell closes, Align column is disabled, the popover closes", async () => {
    await withDocument();
    tap(cellEl(1, 0));
    press(btn("paletteTableOptions"));
    const menu = document.getElementById("paletteTableMenu");
    expect(menu.hidden).toBe(false);
    typeInCell("s1");
    ctrl(openCellEl(), "s");
    await settle();
    expect(btn("paletteTableOptions").getAttribute("aria-disabled")).toBe("true");
    expect(menu.hidden).toBe(true);
  });
});

describe("AT-UI-62 a long press on [?] opens the MCBSMD prompt, and lifting the finger does not close it (release test N1)", () => {
  const touch = (type) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    app.elements.helpBtn.dispatchEvent(e);
    return e;
  };

  it("the touchend of a long press is taken: no click (or overlay tap) follows; a short tap opens the help", async () => {
    app = await setupApp();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      ModalController.show.mockClear();
      touch("touchstart");
      vi.advanceTimersByTime(CONFIG.ui.longPressDuration);
      expect(ModalController.show).toHaveBeenCalledWith(app.elements.promptModal);
      expect(touch("touchend").defaultPrevented).toBe(true);
      expect(ModalController.show).toHaveBeenCalledTimes(1);
      ModalController.show.mockClear();
      touch("touchstart");
      expect(touch("touchend").defaultPrevented).toBe(true);
      expect(ModalController.show).toHaveBeenCalledWith(app.elements.helpModal);
      expect(ModalController.show).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AT-UI-66 review L3 / L4 / L5", () => {
  it("L3: a repeated Esc with a popover open leaves it open (a held Esc acts once)", async () => {
    await withDocument();
    tap(cellEl(1, 0));
    press(btn("paletteFormat"));
    const menu = document.getElementById("paletteFormatMenu");
    const e = keydown(openCellEl(), "Escape", { repeat: true });
    expect(e.defaultPrevented).toBe(true);
    expect(menu.hidden).toBe(false);
    expect(app.ui.blockEdit.isEditingCell()).toBe(true);
  });

  it("L4: the deferred button states follow even when an action of the crossing throws", async () => {
    await withDocument();
    tap(cellEl(1, 0));
    expect(btn("paletteTableOptions").getAttribute("aria-disabled")).toBe("false");
    vi.spyOn(app.ui.blockEdit._cells, "openCell").mockImplementation(() => {
      throw new Error("boom");
    });
    typeInCell("t1");
    expect(() => app.ui.blockEdit.dispatch("nextCellRequested")).toThrow("boom"); // the Tab's crossing
    expect(app.ui.blockEdit.isInTransition()).toBe(false);
    // the cell closed; the states were not left as they were inside the crossing
    expect(btn("paletteTableOptions").getAttribute("aria-disabled")).toBe("true");
  });

  it.each([
    ["the e key", () => keydown(document.body, "e")],
    ["Esc (the editor closed first)", () => keydown(document.body, "Escape")],
  ])("L5: a clipboard read that never settles keeps Paste link off only until edit mode ends: %s", async (_name, leave) => {
    const pending = { read: vi.fn(() => new Promise(() => {})), readText: vi.fn(() => new Promise(() => {})) };
    access = fakeFileAccess();
    app = await setupApp({ fileAccess: access, clipboard: pending });
    const handle = fakeFileHandle({ name: "doc.md", content: [DOC], calls: access.calls });
    document.dispatchEvent(dropEvent(new File([DOC], "doc.md", { lastModified: 1000 }), handle));
    await settle();
    keydown(document.body, "e");
    tap(app.block((b) => b.type === "paragraph").el.firstElementChild);
    const ta = app.blockEditor();
    ta.setSelectionRange(0, 5);
    press(btn("paletteFormat"));
    press(popoverButton("Paste copied link"));
    expect(pending.read).toHaveBeenCalledTimes(1);
    expect(app.ui._isReadingClipboard).toBe(true);
    keydown(ta, "Escape");
    leave(); // out of edit mode
    expect(app.ui.palette.isShown()).toBe(false);
    expect(app.ui._isReadingClipboard).toBe(false);
  });

  it("L5: a read given up and settling late does not end the wait of a newer one (one read at a time)", async () => {
    let releaseFirst;
    const first = new Promise((resolve) => (releaseFirst = resolve));
    const reads = [first, new Promise(() => {})];
    const clipboard = { read: vi.fn(() => reads.shift().then(() => [])), readText: vi.fn() };
    access = fakeFileAccess();
    app = await setupApp({ fileAccess: access, clipboard });
    const handle = fakeFileHandle({ name: "doc.md", content: [DOC], calls: access.calls });
    document.dispatchEvent(dropEvent(new File([DOC], "doc.md", { lastModified: 1000 }), handle));
    await settle();
    const pasteOnce = () => {
      keydown(document.body, "e");
      tap(app.block((b) => b.type === "paragraph").el.firstElementChild);
      app.blockEditor().setSelectionRange(0, 5);
      press(btn("paletteFormat"));
      press(popoverButton("Paste copied link"));
    };
    pasteOnce();
    keydown(app.blockEditor(), "Escape");
    keydown(document.body, "e"); // the first read is given up
    pasteOnce(); // a second read waits
    expect(clipboard.read).toHaveBeenCalledTimes(2);
    showToast.mockClear();
    releaseFirst(); // no URL in it: given up, it shows nothing
    await settle();
    expect(app.ui._isReadingClipboard).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe("AT-UI-67 a huge block: a format that cannot be applied is told (owner ruling Q-f, INV-71)", () => {
  const HUGE = `${"- one\n- two\n".repeat(Math.ceil((CONFIG.edit.invisibleMarkMaxChars + 10) / 12))}\nsmall\n`;

  it("Bold over two list items (not one inline range): nothing changes, the formatNotApplicable toast; Ctrl+B too", async () => {
    await withDocument(HUGE);
    tap(app.block((b) => b.type === "list").el.firstElementChild);
    const ta = app.blockEditor();
    const before = ta.value;
    ta.setSelectionRange(2, 10); // "one\n- tw"
    document.dispatchEvent(new Event("selectionchange"));
    await frame(); // the button states follow in the next frame (INV-51)
    expect(btn("paletteBold").getAttribute("aria-disabled")).toBe("false");
    expect(M.formatNotApplicable).toBe("You can't use this format here.");
    showToast.mockClear();
    press(btn("paletteBold"));
    expect(ta.value).toBe(before);
    expect(showToast).toHaveBeenCalledWith(M.formatNotApplicable, TOAST_MS);
    showToast.mockClear();
    ctrl(ta, "b");
    expect(ta.value).toBe(before);
    expect(showToast).toHaveBeenCalledWith(M.formatNotApplicable, TOAST_MS);
    // Remove link on a selection without a link: the same (on without checking)
    showToast.mockClear();
    app.ui._runPaletteCommand("linkRemove");
    expect(ta.value).toBe(before);
    expect(M.linkNotRemovable).toBe("There's no link to remove here.");
    expect(showToast).toHaveBeenCalledWith(M.linkNotRemovable, TOAST_MS);
  });

  it("below the limit the buttons are off where a format cannot go, so no toast", async () => {
    await withDocument("- one\n- two\n");
    tap(app.block((b) => b.type === "list").el.firstElementChild);
    const ta = app.blockEditor();
    ta.setSelectionRange(2, 10);
    showToast.mockClear();
    app.ui._runPaletteCommand("bold");
    expect(showToast).not.toHaveBeenCalled();
  });
});
