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
import { tap, keydown } from "./helpers/editDom.js";
import { fakeFileAccess, fakeFileHandle } from "./helpers/fakeFs.js";

// INV-56: taking an empty #editor (whitespace only) into a document that is
// not empty asks first. Cancel changes nothing: not #editor, not the model,
// not the unsaved mark. OK goes on as before.

const M = CONFIG.messages.edit;
const DOC = "# Title\n\nHello world.\n\nSecond para.\n";
const isPara = (start) => (b) => b.type === "paragraph" && b.raw.startsWith(start);

let app;
let access;
let confirmSpy;

beforeEach(() => {
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  showToast.mockClear();
});

afterEach(() => {
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

function typeInEditor(text) {
  app.elements.editor.value = text;
  app.elements.editor.dispatchEvent(new Event("input", { bubbles: true }));
}

function showPalette() {
  if (!app.ui.palette.isShown()) keydown(document.body, "e");
}

/** Everything that Cancel must leave as it was. */
function snapshot() {
  return {
    editor: app.elements.editor.value,
    body: app.orchestrator.getBody(),
    title: document.title,
    dirty: app.ui._isDocumentDirty(),
    editorChanged: app.ui._editorChangedSinceRender,
    saveState: app.ui._saveOperationState,
  };
}

const confirmCalls = () => confirmSpy.mock.calls.filter(([message]) => message === M.emptyEditorConfirm);

// Each path takes the (empty) #editor into the document.
const PATHS = [
  ["l (Render Light) in the markdown view", async () => {
    keydown(document.body, "l");
  }],
  ["[Render Dark] in the markdown view", async () => {
    await app.ui.handleRender("dark");
  }],
  ["a block tap with unrendered #editor changes (INV-45)", async () => {
    showPalette();
    tap(app.block(isPara("Hello")).el.firstElementChild);
  }],
  ["palette Undo with unrendered #editor changes (T31)", async () => {
    showPalette();
    app.ui._runPaletteCommand("undo");
  }],
  ["palette Insert table with unrendered #editor changes (T31)", async () => {
    showPalette();
    app.ui._runPaletteCommand("insertTable");
  }],
  ["Save (applyEditorText)", async () => {
    await app.ui.requestSave();
  }],
  ["Save as (applyEditorText)", async () => {
    await app.ui.requestSaveAs();
  }],
];

describe("INV-56 an empty #editor taken into a non-empty document asks first", () => {
  it("the message is ASCII English in messages.edit", () => {
    expect(M.emptyEditorConfirm).toMatch(/^[\x20-\x7e]+$/);
  });

  describe.each(PATHS)("%s", (_name, run) => {
    it.each([[""], [" \n\t\n"]])("Cancel (#editor %j): nothing changes, no toast, no file access", async (blank) => {
      await withDocument();
      typeInEditor(blank);
      const before = snapshot();
      confirmSpy.mockReturnValue(false);
      await run();
      await settle();
      expect(confirmCalls()).toHaveLength(1);
      expect(snapshot()).toEqual(before);
      expect(app.orchestrator.getBody()).toBe(DOC);
      expect(app.blockEditor()).toBeNull();
      expect(showToast).not.toHaveBeenCalledWith(M.editorRenderedFirst, expect.anything());
      expect(access.calls).toEqual([]);
    });

    it("OK: goes on as before; the document becomes the empty #editor", async () => {
      await withDocument();
      typeInEditor("");
      confirmSpy.mockReturnValue(true);
      await run();
      await settle();
      expect(confirmCalls()).toHaveLength(1);
      expect(app.orchestrator.getBody()).toBe("");
      expect(app.ui._editorChangedSinceRender).toBe(false);
    });
  });

  it("OK on Save: the permission request starts right after the confirm, before the use case (INV-33)", async () => {
    await withDocument();
    typeInEditor("");
    const order = [];
    confirmSpy.mockImplementation(() => {
      order.push("confirm");
      return true;
    });
    const started = app.ui.requestSave();
    order.push(...access.calls.slice(0, 1));
    await started;
    await settle();
    expect(order).toEqual(["confirm", "startPermissionRequest"]);
  });

  it("an empty #editor with an empty document does not ask", async () => {
    await withDocument("");
    typeInEditor(" \n");
    keydown(document.body, "l");
    await settle();
    await app.ui.requestSave();
    await settle();
    expect(confirmCalls()).toHaveLength(0);
  });

  it("a #editor with text does not ask, even when the text is very short", async () => {
    await withDocument();
    typeInEditor("x");
    keydown(document.body, "l");
    await settle();
    expect(confirmCalls()).toHaveLength(0);
    expect(app.orchestrator.getBody()).toBe("x");
  });

  it("Save with no unrendered #editor change does not ask (#editor is not taken in)", async () => {
    await withDocument();
    await app.ui.requestSave();
    await settle();
    expect(confirmCalls()).toHaveLength(0);
  });

  it("a second Save press while writing is ignored without asking", async () => {
    await withDocument();
    typeInEditor("");
    app.ui._saveOperationState = "writingFile";
    await app.ui.requestSave();
    expect(confirmCalls()).toHaveLength(0);
    expect(app.orchestrator.getBody()).toBe(DOC);
  });

  it("Cancel keeps the unsaved mark as it was (the title is the same)", async () => {
    await withDocument();
    typeInEditor("");
    const title = document.title;
    expect(title).toBe(CONFIG.edit.titleUnsavedPrefix + BASE_TITLE);
    confirmSpy.mockReturnValue(false);
    keydown(document.body, "l");
    await settle();
    expect(document.title).toBe(title);
  });
});
