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
import { encodeText } from "../js/textEncoding.js";
import { setupApp, dropEvent, settle, BASE_TITLE } from "./helpers/appStack.js";
import { fakeFileAccess, fakeFileHandle, deferred } from "./helpers/fakeFs.js";

// AT-UI-70..: UIController routes the code view to the code document
// (SC-27): opening (INV-89), file info, unsaved, Reload, Save (INV-90, NE-19).

const A = "\u3042"; // hiragana a
const sjis = (text) => encodeText(text, "shift_jis", false).bytes;

let app;
let access;
let dialog;

beforeEach(() => {
  showToast.mockClear();
  dialog = { askOpen: vi.fn(async () => null), askSaveEncoding: vi.fn(async () => null) };
});

afterEach(() => {
  app?.teardown();
  app = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function start(opts = {}) {
  access = fakeFileAccess(opts);
  app = await setupApp({ fileAccess: access, codeDialog: dialog });
  return app;
}

async function drop(content, name, handle = null) {
  document.dispatchEvent(dropEvent(new File([content], name, { lastModified: 1000 }), handle));
  await settle();
}

const bodyView = () => [...document.body.classList].find((c) => c.startsWith("view-"));

describe("UIController and the code document (SC-27; INV-85 (5), INV-89, INV-90, INV-54)", () => {
  it("AT-UI-70 a Shift_JIS file: the open dialog, the decoded text in the view, and the encoding and line endings in the file info", async () => {
    await start();
    dialog.askOpen.mockResolvedValue({ encoding: "shift_jis", lineEndingMode: "\r\n" });
    await drop(sjis(`x = "${A}"\r\n`), "a.py");
    expect(dialog.askOpen).toHaveBeenCalledTimes(1);
    expect(app.sourceFileRenderer.render.mock.calls[0][4]).toBe(`x = "${A}"\n`);
    expect(bodyView()).toBe("view-code");
    expect(app.elements.fileInfo.textContent).toBe("a.py  |  1 lines  |  0.01 KB\nUpdated: x  |  Shift_JIS  |  CRLF");
  });

  it("AT-UI-71 valid UTF-8: no dialog; the file info says UTF-8 BOM / LF", async () => {
    await start();
    await drop(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61, 0x0a]), "a.py");
    expect(dialog.askOpen).not.toHaveBeenCalled();
    expect(app.sourceFileRenderer.render.mock.calls[0][4]).toBe("a\n");
    expect(app.elements.fileInfo.textContent).toBe("a.py  |  1 lines  |  0.01 KB\nUpdated: x  |  UTF-8 BOM  |  LF");
  });

  it("AT-UI-72 the open dialog canceled: the Markdown document stays, nothing is asked or drawn", async () => {
    await start();
    await drop("# Doc\n", "doc.md");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await drop(sjis(`${A}\n`), "a.txt");
    expect(dialog.askOpen).toHaveBeenCalledTimes(1);
    expect(app.sourceFileRenderer.render).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(bodyView()).toBe("view-markdown");
    expect(app.documents.fileName()).toBe("doc.md");
  });

  it("AT-UI-73 an unsaved code document: the title mark, the unload guard, and Clear asks first (Cancel keeps it)", async () => {
    await start();
    await drop("a\n", "a.py");
    app.codeEdit.updateText("b\n");
    app.ui._refreshDirtyMark();
    expect(document.title).toBe(CONFIG.edit.titleUnsavedPrefix + BASE_TITLE);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    app.elements.clearBtn.click();
    expect(confirm).toHaveBeenCalledWith(CONFIG.messages.edit.unsavedConfirm);
    expect([bodyView(), app.codeEdit.currentText()]).toEqual(["view-code", "b\n"]);
    confirm.mockReturnValue(true);
    app.elements.clearBtn.click();
    expect([bodyView(), app.codeEdit.hasDocument(), document.title]).toEqual(["view-initial", false, BASE_TITLE]);
  });

  it("AT-UI-74 a Markdown drop over an unsaved code document asks first; OK drops the code document", async () => {
    await start();
    await drop("a\n", "a.py");
    app.codeEdit.updateText("b\n");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await drop("# Doc\n", "doc.md");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(bodyView()).toBe("view-code");
    confirm.mockReturnValue(true);
    await drop("# Doc\n", "doc.md");
    expect([bodyView(), app.codeEdit.hasDocument(), document.title]).toEqual(["view-markdown", false, BASE_TITLE]);
  });

  it("AT-UI-75 Reload in the code view reads in the opened encoding; unsaved: asked first, Cancel reads nothing", async () => {
    await start();
    dialog.askOpen.mockResolvedValue({ encoding: "shift_jis", lineEndingMode: "\n" });
    const handle = fakeFileHandle({ name: "a.txt", content: [sjis(`${A}\n`)] });
    await drop(sjis(`${A}\n`), "a.txt", handle);
    app.sourceFileRenderer.reload.mockImplementation(async (theme, isCurrent, readText) => {
      await readText(new File([sjis(`${A}${A}\n`)], "a.txt", { lastModified: 3000 }));
      return { fileName: "a.txt", fileSize: 5, lineCount: 2, language: "plaintext", updatedAtStr: "y" };
    });
    app.codeEdit.updateText("typed\n");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await app.ui.handleReload();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(app.sourceFileRenderer.reload).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await app.ui.handleReload();
    expect([app.codeEdit.currentText(), app.codeEdit.isDirty(), dialog.askOpen.mock.calls.length]).toEqual([`${A}${A}\n`, false, 1]);
    expect(app.elements.fileInfo.textContent).toBe("a.txt  |  2 lines  |  0.00 KB\nUpdated: y  |  Shift_JIS  |  LF");
  });

  it("AT-UI-76 while the code document is saved, a drop is refused with the toast (INV-54)", async () => {
    const permission = deferred();
    await start({ permission: permission.promise });
    await drop("a\n", "a.py", fakeFileHandle({ name: "a.py" }));
    const saving = app.ui.requestSave();
    await drop("# Doc\n", "doc.md");
    expect(showToast).toHaveBeenCalledWith(CONFIG.messages.edit.savingInProgress, CONFIG.codeView.toastDurationMs);
    expect(bodyView()).toBe("view-code");
    permission.resolve("granted");
    await saving;
  });

  it("AT-UI-77 Save as with another code name: the file info shows the written file; the title is clean", async () => {
    const picked = fakeFileHandle({ name: "b.py" });
    await start({ picker: Promise.resolve(picked) });
    await drop("a\n", "a.py");
    app.codeEdit.updateText("bb\n");
    app.ui._refreshDirtyMark();
    await app.ui.requestSaveAs();
    expect(app.sourceFileRenderer.retarget.mock.calls[0][1]).toBe(picked);
    expect(app.elements.fileInfo.textContent).toBe("b.py  |  1 lines  |  0.00 KB\nUpdated: x  |  UTF-8  |  LF");
    expect(document.title).toBe(BASE_TITLE);
    expect(showToast).toHaveBeenCalledWith(CONFIG.messages.edit.saved("b.py"), CONFIG.codeView.toastDurationMs);
  });

  it("AT-UI-78 Save as .md reopens the file in the Markdown view (NE-19)", async () => {
    const picked = fakeFileHandle({ name: "notes.md" });
    await start({ picker: Promise.resolve(picked) });
    await drop("# Title\n\nBody.\n", "a.txt");
    await app.ui.requestSaveAs();
    await settle();
    expect([bodyView(), app.documents.fileName(), app.codeEdit.hasDocument()]).toEqual(["view-markdown", "notes.md", false]);
    expect(app.elements.editor.value).toBe("# Title\n\nBody.\n");
    expect(app.preview.querySelector("h1").textContent).toBe("Title");
    expect(app.documents.location.fileHandle).toBe(picked);
  });
});
