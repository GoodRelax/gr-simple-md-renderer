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
import { setupApp, dropEvent, settle, BASE_TITLE } from "./helpers/appStack.js";
import { fakeFileAccess, fakeFileHandle } from "./helpers/fakeFs.js";
import { keydown } from "./helpers/editDom.js";

// AT-UI-80..: UIController routes the code view's edit mode (SC-27, INV-85
// to INV-88), the JSON fold keys and the command palette (INV-92), the Index
// of a code file (INV-91) and Search in the code editor (INV-80).

const JSON_TEXT = '{\n  "a": {\n    "b": 1\n  },\n  "c": 2\n}\n';
const JSON_FOLDED = '{\n  "a": { "b": 1 },\n  "c": 2\n}\n';

let app;
let access;
let dialog;

beforeEach(() => {
  showToast.mockClear();
  dialog = { askOpen: vi.fn(async () => null), askSaveEncoding: vi.fn(async () => null) };
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  app?.teardown();
  app = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function start(opts = {}) {
  access = fakeFileAccess();
  app = await setupApp({ fileAccess: access, codeDialog: dialog, codeEditor: true, withIndex: true, withSearch: true, ...opts });
  return app;
}

async function drop(content, name, handle = null) {
  document.dispatchEvent(dropEvent(new File([content], name, { lastModified: 1000 }), handle));
  await settle();
}

const textarea = () => app.preview.querySelector("#codeEditBody textarea.code-edit-input");
const lines = () => [...app.preview.querySelectorAll("#codeViewBody .code-line")].map((l) => l.textContent);
const toasts = () => showToast.mock.calls.map((c) => c[0]);
const shownButtons = () => [...app.paletteRoot().querySelectorAll("button")].filter((b) => !b.hidden).map((b) => b.id);

function type(value) {
  const ta = textarea();
  ta.value = value;
  ta.setSelectionRange(value.length, value.length);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("UIController: the code view's edit mode (SC-27; INV-85, INV-88, INV-90)", () => {
  it("AT-UI-80 e / [Edit] in the code view: the editor, the palette with Save, Save as, Undo, Redo and Search; Esc leaves the editor, e the edit mode, the view shows the edited text", async () => {
    await start();
    await drop("a\nb\n", "a.py");
    expect(app.elements.editBtn.disabled).toBe(false);
    expect(keydown(document.body, "e").defaultPrevented).toBe(true); // not typed into the editor it focuses
    expect([app.codeEdit.isEditing(), app.ui.palette.isShown(), document.body.classList.contains("code-edit")]).toEqual([true, true, true]);
    expect(shownButtons()).toEqual(["paletteSave", "paletteSaveAs", "paletteUndo", "paletteRedo", "paletteSearch"]);
    expect(document.activeElement).toBe(textarea());
    type("a\nb\nc\n");
    expect(document.title).toBe(CONFIG.edit.titleUnsavedPrefix + BASE_TITLE);
    expect(keydown(textarea(), "Escape").defaultPrevented).toBe(true);
    expect(app.codeEdit.isEditing()).toBe(true);
    keydown(document.body, "e");
    expect([app.codeEdit.isEditing(), app.ui.palette.isShown(), document.body.classList.contains("code-edit")]).toEqual([false, false, false]);
    expect(lines()).toEqual(["a", "b", "c", ""]);
    expect(app.elements.fileInfo.textContent).toMatch(/^a\.py {2}\| {2}4 lines/);
    app.elements.editBtn.click();
    expect(app.codeEdit.isEditing()).toBe(true);
    expect(textarea().value).toBe("a\nb\nc\n");
  });

  it("AT-UI-81 Undo: the palette's button (on only when there is a step) and primary+Z / Shift+Z outside the editor are the editor's; in a text entry the browser's", async () => {
    await start();
    await drop("a\n", "a.py");
    keydown(document.body, "e");
    const undoBtn = app.paletteRoot().querySelector("#paletteUndo");
    expect(undoBtn.getAttribute("aria-disabled")).toBe("true");
    type("ab\n");
    app.ui._updatePaletteStates();
    expect(undoBtn.getAttribute("aria-disabled")).toBe("false");
    app.ui._runPaletteCommand("undo");
    expect(textarea().value).toBe("a\n");
    textarea().blur();
    expect(keydown(document.body, "z", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(textarea().value).toBe("ab\n");
    expect(keydown(document.body, "z", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(textarea().value).toBe("a\n");
    app.searchEl.input.focus();
    expect(keydown(app.searchEl.input, "y", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(textarea().value).toBe("a\n");
  });

  it("AT-UI-93 the palette's Redo (on only with a step) redoes in the editor; its Search opens Search (NE-2)", async () => {
    await start();
    await drop("a\n", "a.py");
    keydown(document.body, "e");
    const redoBtn = app.paletteRoot().querySelector("#paletteRedo");
    type("ab\n");
    app.ui._runPaletteCommand("undo");
    expect(textarea().value).toBe("a\n");
    expect(redoBtn.getAttribute("aria-disabled")).toBe("false");
    app.ui._runPaletteCommand("redo");
    expect(textarea().value).toBe("ab\n");
    expect(redoBtn.getAttribute("aria-disabled")).toBe("true");
    app.ui._runPaletteCommand("search");
    expect([app.search.isShown(), document.activeElement]).toEqual([true, app.searchEl.input]);
  });

  it("AT-UI-82 Save (primary+S) while editing writes the editor's text and edit mode stays", async () => {
    await start();
    await drop("a\n", "a.py", fakeFileHandle({ name: "a.py", calls: access.calls }));
    keydown(document.body, "e");
    type("typed\n");
    keydown(textarea(), "s", { ctrlKey: true });
    await settle();
    expect(new TextDecoder().decode(access.writes[0].text)).toBe("typed\n");
    expect([app.codeEdit.isEditing(), app.codeEdit.isDirty(), document.title]).toEqual([true, false, BASE_TITLE]);
  });

  it("AT-UI-83 Reload and a dropped Markdown file end edit mode first; the palette is the Markdown one again; Reload does not draw the edited text first (L5)", async () => {
    await start();
    await drop("a\n", "a.py", fakeFileHandle({ name: "a.py", content: ["a\n"] }));
    keydown(document.body, "e");
    await app.ui.handleReload();
    expect([app.codeEdit.isEditing(), app.ui.palette.isShown(), app.sourceFileRenderer.showText.mock.calls.length]).toEqual([false, false, 0]);
    expect(app.sourceFileRenderer.reload).toHaveBeenCalledTimes(1);
    keydown(document.body, "e");
    await drop("# Doc\n", "doc.md");
    expect([app.codeEdit.isEditing(), app.ui.palette.isShown(), document.body.classList.contains("code-edit")]).toEqual([false, false, false]);
    keydown(document.body, "e");
    expect(shownButtons()).toContain("paletteBold");
  });

  it("AT-UI-94 (INV-85 (3); review L5) a Reload that cannot read the file after edit mode ended: the view shows the document's text again", async () => {
    await start();
    await drop("a\n", "a.py", fakeFileHandle({ name: "a.py", content: ["a\n"] }));
    keydown(document.body, "e");
    type("typed\n");
    app.sourceFileRenderer.reload.mockRejectedValue(new Error("gone"));
    await app.ui.handleReload();
    expect(app.codeEdit.isEditing()).toBe(false);
    expect(app.sourceFileRenderer.showText.mock.calls.map((c) => c[0])).toEqual(["typed\n"]);
    expect(toasts()).toContain(CONFIG.messages.edit.reloadFailed);
  });

  it("AT-UI-95 (INV-85 (5), INV-86; review M1) the unsaved mark while typing is not compared on a key; when typing stops it is exact (typed back: no mark)", async () => {
    await start();
    await drop("same\n", "a.py");
    keydown(document.body, "e");
    const compare = vi.spyOn(Object.getPrototypeOf(app.codeEdit.document), "isDirty");
    type("samX\n");
    type("same\n");
    expect(document.title).toBe("* " + BASE_TITLE);
    expect(compare).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, CONFIG.codeEdit.highlightPauseMs + 20));
    expect(compare).toHaveBeenCalled();
    expect([document.title, app.ui._paletteStates().undo]).toEqual([BASE_TITLE, false]);
  });

  it("AT-UI-96 (INV-92 (4), NE-23; review L12) the key hint of the code view on a Mac names Option for the fold keys", async () => {
    await start({ isApple: true });
    await drop("{}\n", "a.json");
    expect(app.elements.keyHint.textContent).toBe(CONFIG.keyHints.codeApple);
    expect(app.elements.keyHint.textContent).toContain("[Option+Left][Option+Right]");
    expect(app.elements.keyHint.textContent).not.toContain("Ctrl");
    app.teardown();
    await start();
    await drop("{}\n", "a.json");
    expect(app.elements.keyHint.textContent).toBe(CONFIG.keyHints.code);
  });

  it("AT-UI-97 (INV-89; review L19) a UTF-16 file with a BOM and an unknown extension opens (its NUL bytes do not make it binary); without a BOM it is refused", async () => {
    await start();
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const le = Uint8Array.from([0xff, 0xfe, 0x61, 0x00, 0x0a, 0x00]);
    dialog.askOpen.mockResolvedValue({ encoding: "utf-16le", lineEndingMode: "\n" }); // not UTF-8: the open dialog (NE-15)
    await drop(le, "x.utf16data");
    expect(alert).not.toHaveBeenCalled();
    expect([app.codeEdit.currentText(), app.codeEdit.fileInfo().encoding]).toEqual(["a\n", "utf-16le"]);
    await drop(Uint8Array.from([0x61, 0x00, 0x62]), "y.utf16data");
    expect(alert).toHaveBeenCalledWith(CONFIG.fileDrop.messages.binaryFile);
  });

  it("AT-UI-84 Esc outside the editor in edit mode: the command palette, then Search, then the Index close; edit mode stays", async () => {
    await start();
    await drop(JSON_TEXT, "a.json");
    keydown(document.body, "i");
    keydown(document.body, "e");
    textarea().blur();
    keydown(document.body, "f");
    app.searchEl.input.blur();
    keydown(document.body, "p");
    expect([app.ui.codeCommands.isShown(), app.search.isShown(), app.index.isShown()]).toEqual([true, true, true]);
    document.activeElement.blur();
    keydown(document.body, "Escape");
    expect([app.ui.codeCommands.isShown(), app.search.isShown(), app.index.isShown()]).toEqual([false, true, true]);
    keydown(document.body, "Escape");
    keydown(document.body, "Escape");
    expect([app.search.isShown(), app.index.isShown(), app.codeEdit.isEditing(), app.ui.palette.isShown()]).toEqual([false, false, true, true]);
  });
});

describe("UIController: JSON fold keys and the command palette (INV-92)", () => {
  it("AT-UI-85 Ctrl+Left / Ctrl+Right in the view fold / unfold the text shown, not unsaved; in a text entry not taken", async () => {
    await start();
    await drop(JSON_TEXT, "a.json");
    expect(keydown(document.body, "ArrowLeft", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(lines().join("\n")).toBe(JSON_FOLDED);
    expect([app.codeEdit.isDirty(), document.title]).toEqual([false, BASE_TITLE]);
    keydown(document.body, "ArrowRight", { ctrlKey: true });
    expect(lines().join("\n")).toBe(JSON_TEXT);
    expect(keydown(app.elements.editor, "ArrowLeft", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(keydown(document.body, "ArrowLeft", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(lines().join("\n")).toBe(JSON_TEXT);
  });

  it("AT-UI-86 in edit mode Ctrl+Left outside the editor folds the editor's text (unsaved, one undo step)", async () => {
    await start();
    await drop(JSON_TEXT, "a.json");
    keydown(document.body, "e");
    textarea().blur();
    keydown(document.body, "ArrowLeft", { ctrlKey: true });
    expect([textarea().value, app.codeEdit.isDirty()]).toEqual([JSON_FOLDED, true]);
    keydown(document.body, "z", { ctrlKey: true });
    expect(textarea().value).toBe(JSON_TEXT);
  });

  it("AT-UI-87 Mac: Option+Left / Option+Right; Ctrl+Left is not taken", async () => {
    await start({ isApple: true });
    await drop(JSON_TEXT, "a.json");
    expect(keydown(document.body, "ArrowLeft", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(lines().join("\n")).toBe(JSON_TEXT);
    expect(keydown(document.body, "ArrowLeft", { altKey: true }).defaultPrevented).toBe(true);
    expect(lines().join("\n")).toBe(JSON_FOLDED);
    keydown(document.body, "ArrowRight", { altKey: true });
    expect(lines().join("\n")).toBe(JSON_TEXT);
  });

  it("AT-UI-88 not JSON: the fold keys are not taken; p says folding is for JSON; [Commands] is off", async () => {
    await start();
    await drop("a\n", "a.py");
    expect(keydown(document.body, "ArrowLeft", { ctrlKey: true }).defaultPrevented).toBe(false);
    keydown(document.body, "p");
    expect(toasts()).toEqual([CONFIG.messages.codeEdit.foldJsonOnly]);
    expect([app.commandsBtn.disabled, app.ui.codeCommands.isShown()]).toEqual([true, false]);
  });

  it("AT-UI-89 JSON: p and [Commands] open the command palette; its buttons fold and unfold the view; off again in the Markdown view", async () => {
    await start();
    await drop(JSON_TEXT, "a.json");
    expect(app.commandsBtn.disabled).toBe(false);
    keydown(document.body, "p");
    expect(app.ui.codeCommands.isShown()).toBe(true);
    const [fold, unfold] = app.commandsBox.querySelectorAll("button");
    fold.click();
    expect(lines().join("\n")).toBe(JSON_FOLDED);
    fold.click();
    expect(toasts()).toEqual([CONFIG.messages.codeEdit.nothingToFold]);
    unfold.click();
    expect(lines().join("\n")).toBe(JSON_TEXT);
    keydown(document.body, "p");
    expect(app.ui.codeCommands.isShown()).toBe(false);
    app.commandsBtn.click();
    expect(app.ui.codeCommands.isShown()).toBe(true);
    await drop("# Doc\n", "doc.md");
    expect([app.commandsBtn.disabled, app.ui.codeCommands.isShown()]).toEqual([true, false]);
  });
});

describe("UIController: code edit behaviour of the spec without a test before (INV-14, INV-58, INV-91, INV-92; review L22)", () => {
  it("AT-UI-98 INV-92 (4): a held Ctrl+Left on the page is taken and folds once; during IME composition it is not taken", async () => {
    await start();
    await drop(JSON_TEXT, "a.json");
    expect(keydown(document.body, "ArrowLeft", { ctrlKey: true, isComposing: true }).defaultPrevented).toBe(false);
    expect(lines().join("\n")).toBe(JSON_TEXT);
    keydown(document.body, "ArrowLeft", { ctrlKey: true });
    expect(keydown(document.body, "ArrowRight", { ctrlKey: true, repeat: true }).defaultPrevented).toBe(true);
    expect(lines().join("\n")).toBe(JSON_FOLDED);
  });

  it("AT-UI-99 5.19.7 / INV-14: e and p typed in the editor are characters (edit mode and the command palette stay as they are)", async () => {
    await start();
    await drop(JSON_TEXT, "a.json");
    keydown(document.body, "e");
    expect(keydown(textarea(), "e").defaultPrevented).toBe(false);
    expect(keydown(textarea(), "p").defaultPrevented).toBe(false);
    expect([app.codeEdit.isEditing(), app.ui.codeCommands.isShown()]).toEqual([true, false]);
  });

  it("AT-UI-100 INV-58: primary+Shift+S in the code view is Save as (the save dialog with the file's name)", async () => {
    await start();
    await drop("a\n", "a.py");
    expect(keydown(document.body, "s", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    await settle();
    expect(access.calls[0]).toBe("startSavePicker:a.py");
  });

  it("AT-UI-101 INV-91 (2): the Index follows the editor's text when typing stops", async () => {
    await start();
    await drop("def one():\n    pass\n", "a.py");
    keydown(document.body, "i");
    keydown(document.body, "e");
    type("def one():\n    pass\ndef two():\n    pass\n");
    const names = () => [...app.indexPanel.querySelectorAll(".index-entry")].map((e) => e.textContent);
    expect(names().some((n) => n.includes("two"))).toBe(false);
    await new Promise((r) => setTimeout(r, CONFIG.codeEdit.highlightPauseMs + 20));
    expect(names().some((n) => n.includes("two"))).toBe(true);
  });
});

describe("UIController: the Index and Search of a code file (INV-91, INV-80)", () => {
  it("AT-UI-90 the Index: on for JSON (its keys, after a fold too), off for a language without an outline", async () => {
    await start();
    await drop(JSON_TEXT, "a.json");
    expect(app.indexBtn.disabled).toBe(false);
    keydown(document.body, "i");
    const entries = () => [...app.indexPanel.querySelectorAll(".index-entry")].map((e) => [e.className.split(" ")[1], e.textContent]);
    expect(entries()).toEqual([
      ["index-h1", "a"],
      ["index-h2", "b"],
      ["index-h1", "c"],
    ]);
    keydown(document.body, "ArrowLeft", { ctrlKey: true });
    expect(entries()).toEqual([
      ["index-h1", "a"],
      ["index-h1", "c"],
    ]);
    const scrollTargetTo = vi.spyOn(app.index.scrollMemento, "scrollTargetTo").mockImplementation(() => {});
    app.indexPanel.querySelectorAll(".index-entry")[1].click();
    expect(scrollTargetTo).toHaveBeenLastCalledWith(app.preview.querySelectorAll(".code-line")[2], 8);
    await drop("a\n", "a.txt");
    expect([app.indexBtn.disabled, app.index.isShown()]).toEqual([true, false]);
  });

  it("AT-UI-91 the Index in edit mode: a pick puts the caret at the start of its line", async () => {
    await start();
    await drop(JSON_TEXT, "a.json");
    keydown(document.body, "i");
    keydown(document.body, "e");
    vi.spyOn(app.index.scrollMemento, "scrollTargetTo").mockImplementation(() => {});
    app.indexPanel.querySelectorAll(".index-entry")[2].click();
    expect(textarea().selectionStart).toBe(JSON_TEXT.indexOf('  "c"'));
  });

  it("AT-UI-92 Search in edit mode: Replace changes the editor's text, and primary+Z outside the editor takes it back", async () => {
    vi.stubGlobal("Highlight", class {});
    vi.stubGlobal("CSS", { highlights: new Map() });
    await start();
    await drop("cat dog cat\n", "a.txt");
    keydown(document.body, "e");
    keydown(textarea(), "f", { ctrlKey: true });
    expect([app.search.isShown(), app.searchEl.replaceRow.hidden, app.searchEl.replaceOne.disabled]).toEqual([true, false, false]);
    app.searchEl.input.value = "cat";
    app.searchEl.input.dispatchEvent(new Event("input", { bubbles: true }));
    app.searchEl.replaceInput.value = "cow";
    app.searchEl.replaceAll.click();
    expect([textarea().value, app.codeEdit.isDirty()]).toEqual(["cow dog cow\n", true]);
    keydown(app.searchEl.panel, "Escape");
    keydown(document.body, "z", { ctrlKey: true });
    expect(textarea().value).toBe("cat dog cat\n");
    keydown(document.body, "e");
    expect([app.searchEl.replaceRow.hidden, app.searchEl.replaceOne.disabled]).toEqual([true, true]);
  });
});
