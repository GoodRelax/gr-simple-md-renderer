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
const popoverButton = (label) =>
  document.body.querySelector(`:scope > div.edit-palette-popover button[aria-label="${label}"]`);

/** Press and release (jsdom layout: every rect is at 0,0). */
function press(el) {
  const down = pointer(el, "pointerdown", { x: 0, y: 0 });
  pointer(el, "pointerup", { x: 0, y: 0 });
  return down;
}

function open(pred) {
  tap(app.block(pred).el.firstElementChild);
  return app.blockEditor();
}

function selectInEditor(ta, start, end) {
  ta.setSelectionRange(start, end);
  document.dispatchEvent(new Event("selectionchange"));
}

function typeInEditor(text) {
  app.elements.editor.value = text;
  app.elements.editor.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("button states follow the editor (5.15.5)", () => {
  it("not editing: Bold / Italic / Row / Column disabled; Undo disabled without a record", async () => {
    await withDocument();
    for (const id of ["paletteBold", "paletteItalic", "paletteRow", "paletteColumn", "paletteUndo"]) {
      expect(btn(id).disabled, id).toBe(true);
    }
    for (const id of ["paletteTable", "paletteMermaid", "paletteSave", "paletteSaveAs"]) {
      expect(btn(id).disabled, id).toBe(false);
    }
  });

  it("editing a paragraph: Bold needs a selection; Row / Column stay disabled", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    expect(btn("paletteBold").disabled).toBe(true);
    selectInEditor(ta, 6, 10);
    expect(btn("paletteBold").disabled).toBe(false);
    expect(btn("paletteItalic").disabled).toBe(false);
    expect(btn("paletteRow").disabled).toBe(true);
  });

  it("editing a table: Row and Column enabled", async () => {
    await withDocument();
    open((b) => b.type === "table");
    expect(btn("paletteRow").disabled).toBe(false);
    expect(btn("paletteColumn").disabled).toBe(false);
  });
});

describe("Bold / Italic / Insert row / column (INV-52, INV-36)", () => {
  it("Bold wraps the selection; the editor keeps the focus; nothing is committed", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    selectInEditor(ta, 6, 10);
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
    selectInEditor(ta, 6, 10);
    press(btn("paletteItalic"));
    expect(ta.value).toBe("Hello *word* here.");
    selectInEditor(ta, ta.selectionStart, ta.selectionEnd);
    press(btn("paletteItalic"));
    expect(ta.value).toBe("Hello word here.");
  });

  it("Insert row / column in a table change only the editor text", async () => {
    await withDocument();
    const ta = open((b) => b.type === "table");
    const caret = ta.value.indexOf("x") + 1;
    selectInEditor(ta, caret, caret);
    press(btn("paletteRow"));
    expect(ta.value.split("\n")).toHaveLength(4);
    press(btn("paletteColumn"));
    expect(ta.value.split("\n")[0].split("|").length).toBe(5);
    expect(app.orchestrator.getBody()).toBe(DOC);
  });
});

describe("AT-UI-35 Undo", () => {
  it("disabled while editing and without a record; enabled after a commit; press undoes and disables it", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    ta.value = "Changed.";
    expect(btn("paletteUndo").disabled).toBe(true);
    pointer(document.body, "pointerdown");
    expect(btn("paletteUndo").disabled).toBe(false);
    press(btn("paletteUndo"));
    expect(app.orchestrator.getBody()).toBe(DOC);
    expect(btn("paletteUndo").disabled).toBe(true);
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
    selectInEditor(ta, ta.value.length, ta.value.length);
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
