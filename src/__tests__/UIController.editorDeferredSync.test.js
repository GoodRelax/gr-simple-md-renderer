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

import { CONFIG } from "../js/config.js";
import { setupApp, dropEvent, settle } from "./helpers/appStack.js";
import { tap, pointer, keydown } from "./helpers/editDom.js";
import { fakeFileAccess, fakeFileHandle } from "./helpers/fakeFs.js";

// INV-47 (large documents): writing a 1 MB body into the visible top editor
// costs about half a second of layout in Chrome on every commit. Above
// CONFIG.edit.editorSyncMaxChars the commit does not write #editor; the body
// is written before the user can use #editor (focus, a drag over it) and the
// system reads the model instead of the stale #editor text.

const DOC = "# Title\n\nHello world.\n\nSecond para.\n";
const isPara = (start) => (b) => b.type === "paragraph" && b.raw.startsWith(start);

let app;
let access;
let limit;

beforeEach(() => {
  limit = CONFIG.edit.editorSyncMaxChars;
  CONFIG.edit.editorSyncMaxChars = 20; // DOC (36 chars) counts as large here
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  CONFIG.edit.editorSyncMaxChars = limit;
  app?.teardown();
  app = null;
  vi.restoreAllMocks();
});

async function withDocument(md = DOC) {
  access = fakeFileAccess();
  app = await setupApp({ fileAccess: access });
  const handle = fakeFileHandle({ name: "doc.md", content: [md], calls: access.calls });
  document.dispatchEvent(dropEvent(new File([md], "doc.md", { lastModified: 1000 }), handle));
  await settle();
  access.calls.length = 0;
}

/** Open the paragraph, change it, and commit by pressing outside. */
function commit(start, text) {
  if (!app.ui.palette.isShown()) keydown(document.body, "e");
  tap(app.block(isPara(start)).el.firstElementChild);
  const ta = app.blockEditor();
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  pointer(document.body, "pointerdown", { x: 0, y: 0 });
}

const COMMITTED = "# Title\n\nHello changed.\n\nSecond para.\n";

describe("AT-UI-70 INV-47 a large body is not written into #editor on every commit", () => {
  it("the limit is a CONFIG value of 100,000 characters by default", () => {
    expect(limit).toBe(100000);
  });

  it("commit: the model changes, #editor keeps its text, nothing is marked unrendered", async () => {
    await withDocument();
    const before = app.elements.editor.value;
    const write = vi.spyOn(app.elements.editor, "value", "set");
    commit("Hello", "Hello changed.");
    expect(app.orchestrator.getBody()).toBe(COMMITTED);
    expect(write).not.toHaveBeenCalled();
    expect(app.elements.editor.value).toBe(before);
    expect(app.ui._editorChangedSinceRender).toBe(false);
    expect(document.title.startsWith(CONFIG.edit.titleUnsavedPrefix)).toBe(true);
  });

  it("a body under the limit is still written at once (as before)", async () => {
    CONFIG.edit.editorSyncMaxChars = 1000;
    await withDocument();
    commit("Hello", "Hello changed.");
    expect(app.elements.editor.value).toBe(COMMITTED);
  });

  it("focus into #editor writes the body first, before the user can type", async () => {
    await withDocument();
    commit("Hello", "Hello changed.");
    app.elements.editor.focus();
    expect(app.elements.editor.value).toBe(COMMITTED);
    expect(app.ui._editorChangedSinceRender).toBe(false);
  });

  it("focus while a block editor is open: the open block is committed, then the body is written", async () => {
    await withDocument();
    keydown(document.body, "e");
    tap(app.block(isPara("Second")).el.firstElementChild);
    const ta = app.blockEditor();
    ta.value = "Second changed.";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    app.elements.editor.focus();
    expect(app.elements.editor.value).toBe("# Title\n\nHello world.\n\nSecond changed.\n");
  });

  it("a drag entering #editor writes the body first", async () => {
    await withDocument();
    commit("Hello", "Hello changed.");
    app.elements.editor.dispatchEvent(new Event("dragenter", { bubbles: true }));
    expect(app.elements.editor.value).toBe(COMMITTED);
  });

  it("an input arriving while #editor is stale (no focus, no drag) is refused and the body is written", async () => {
    await withDocument();
    commit("Hello", "Hello changed.");
    const e = new InputEvent("beforeinput", { inputType: "insertFromDrop", data: "x", bubbles: true, cancelable: true });
    app.elements.editor.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(app.elements.editor.value).toBe(COMMITTED);
  });

  it("Render (l) with a stale #editor keeps the committed body (the model is read, not the old #editor text)", async () => {
    await withDocument();
    commit("Hello", "Hello changed.");
    keydown(document.body, "Escape");
    await app.ui.handleRender("light");
    await settle();
    expect(app.orchestrator.getBody()).toBe(COMMITTED);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("Save with a stale #editor writes the committed body", async () => {
    await withDocument();
    commit("Hello", "Hello changed.");
    const write = vi.spyOn(access, "writeFile");
    await app.ui.requestSave();
    await settle();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][1]).toBe(COMMITTED);
  });

  it("Undo and insert are deferred the same way; a later focus writes the current body", async () => {
    await withDocument();
    commit("Hello", "Hello changed.");
    app.ui._runPaletteCommand("undo");
    expect(app.orchestrator.getBody()).toBe(DOC);
    app.elements.editor.focus();
    expect(app.elements.editor.value).toBe(DOC);
  });

  it("the INV-56 check reads the model while #editor is stale: an old empty-looking #editor does not ask", async () => {
    await withDocument();
    commit("Hello", "Hello changed.");
    expect(app.ui._editorText()).toBe(COMMITTED);
  });

  it("a new document (drop) or Clear writes #editor and ends the stale state", async () => {
    await withDocument();
    commit("Hello", "Hello changed.");
    app.ui.doClear();
    await settle();
    expect(app.elements.editor.value).toBe("");
    expect(app.ui._editorText()).toBe("");
  });
});
