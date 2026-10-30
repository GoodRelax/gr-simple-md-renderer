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
import { fakeFileAccess, fakeFileHandle } from "./helpers/fakeFs.js";

// The [Save] button (INV-105, PL-19 to PL-22): it saves as Ctrl+S does, and
// for a document the launcher opened (no file handle, a full path known) it
// first puts the file's full path on the clipboard, to paste as the file
// name in the save dialog. Once the document has a file to save to, there is
// no path to offer.

const FULL_PATH = ["D:", "work", "note.md"].join("\\");
const CODE_PATH = ["D:", "work", "a.py"].join("\\");
const labels = CONFIG.messages.saveButton;
const MOD = CONFIG.messages.palette.modifier.other;

let app;
let access;
let clipboard;

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "alert").mockImplementation(() => {});
  clipboard = { writeText: vi.fn(async () => {}) };
});

afterEach(() => {
  app?.teardown();
  app = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function start(extra = {}, accessOpts = {}) {
  access = fakeFileAccess(accessOpts);
  app = await setupApp({ fileAccess: access, clipboard, ...extra });
  return app;
}

/** The launcher's early drop: a file with no handle and its full path. */
async function launch(content, name, launchPath) {
  await app.ui.receiveEarlyInput({ kind: "drop", file: new File([content], name, { lastModified: 1000 }), handlePromise: null, launchPath });
  await settle();
  access.calls.length = 0;
}

async function drop(content, name, handle = null) {
  document.dispatchEvent(dropEvent(new File([content], name, { lastModified: 1000 }), handle));
  await settle();
  access.calls.length = 0;
}

/** The button's tooltip as the pointer comes over it. */
function hoverTitle() {
  app.elements.saveBtn.dispatchEvent(new Event("pointerenter"));
  return app.elements.saveBtn.title;
}

describe("the [Save] button (INV-105)", () => {
  it("AT-LAUNCH-37 a launched document: the full path goes to the clipboard, then the save dialog opens with the file name", async () => {
    await start();
    await launch("# A\n", "note.md", FULL_PATH);
    expect(app.elements.saveBtn.disabled).toBe(false);
    expect(hoverTitle()).toBe(labels.titleWithPath(MOD));
    app.elements.saveBtn.click();
    await settle();
    expect(clipboard.writeText).toHaveBeenCalledWith(FULL_PATH);
    expect(access.calls[0]).toBe("startSavePicker:note.md");
  });

  it("AT-LAUNCH-37 after the first save the document has its file: no path, the plain tooltip", async () => {
    await start();
    await launch("# A\n", "note.md", FULL_PATH);
    expect(hoverTitle()).toBe(labels.titleWithPath(MOD));
    app.elements.saveBtn.click();
    await settle();
    clipboard.writeText.mockClear();
    access.calls.length = 0;
    expect(app.elements.saveBtn.title).toBe(labels.title(MOD)); // the pointer still over the button
    expect(hoverTitle()).toBe(labels.title(MOD));
    app.elements.saveBtn.click();
    await settle();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(access.calls).not.toContain("startSavePicker:note.md");
  });

  it.each([
    ["dropped with a handle", true],
    ["dropped without a handle (no launch path)", false],
  ])("AT-LAUNCH-38 a document %s: nothing on the clipboard, the plain tooltip", async (_label, withHandle) => {
    await start();
    const handle = withHandle ? fakeFileHandle({ name: "doc.md", content: ["# A\n"], calls: access.calls }) : null;
    await drop("# A\n", "doc.md", handle);
    expect(hoverTitle()).toBe(labels.title(MOD));
    app.elements.saveBtn.click();
    await settle();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(access.calls.length).toBeGreaterThan(0); // it saved as Ctrl+S does
  });

  it("AT-LAUNCH-38 a launched code file: the code document offers the path too", async () => {
    const dialog = { askOpen: vi.fn(async () => null), askSaveEncoding: vi.fn(async () => null) };
    await start({ codeDialog: dialog }, { picker: Promise.resolve(fakeFileHandle({ name: "a.py" })) });
    await launch("x = 1\n", "a.py", CODE_PATH);
    expect(hoverTitle()).toBe(labels.titleWithPath(MOD));
    app.elements.saveBtn.click();
    await settle();
    expect(clipboard.writeText).toHaveBeenCalledWith(CODE_PATH);
    expect(access.calls).toEqual(["startSavePicker:a.py", "writeFile:a.py"]);
    // saved: the code document has its file now
    clipboard.writeText.mockClear();
    expect(hoverTitle()).toBe(labels.title(MOD));
    app.elements.saveBtn.click();
    await settle();
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("AT-LAUNCH-39 the initial view: [Save] is off and a click does nothing", async () => {
    await start();
    expect(app.elements.saveBtn.disabled).toBe(true);
    await app.ui.saveFromButton();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(access.calls).toEqual([]);
  });

  it("AT-LAUNCH-39 the code view without the code editor: [Save] is off", async () => {
    await start();
    await launch("x = 1\n", "a.py", CODE_PATH);
    expect(app.elements.saveBtn.disabled).toBe(true);
    await app.ui.saveFromButton();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(access.calls).toEqual([]);
  });

  it.each([
    ["a launched Markdown file", "# A\n", "note.md", FULL_PATH, {}],
    ["a launched code file", "x = 1\n", "a.py", CODE_PATH, { codeDialog: { askOpen: vi.fn(async () => null), askSaveEncoding: vi.fn(async () => null) } }],
  ])("AT-LAUNCH-45 INV-105 (3): saving is a download (no write API): %s gets the path at each press, and the download tooltip", async (_label, content, name, path, extra) => {
    await start(extra, { canWrite: false });
    await launch(content, name, path);
    expect(hoverTitle()).toBe(labels.titleWithPathDownload(MOD));
    for (const press of [1, 2]) {
      app.elements.saveBtn.click();
      await settle();
      expect(clipboard.writeText).toHaveBeenCalledTimes(press);
      expect(access.downloads).toHaveLength(press);
    }
    expect(clipboard.writeText).toHaveBeenLastCalledWith(path);
    expect(access.downloads[1].name).toBe(name);
    expect(app.elements.saveBtn.title).toBe(labels.titleWithPathDownload(MOD)); // the location did not change
  });

  it("AT-LAUNCH-46 INV-105 (1): a clipboard that refuses the path does not stop the save: the save dialog opens inside the press", async () => {
    clipboard = { writeText: vi.fn(() => Promise.reject(new Error("denied"))) };
    await start();
    await launch("# A\n", "note.md", FULL_PATH);
    app.elements.saveBtn.click(); // no await: the dialog must be asked for in the press itself (INV-33)
    expect(access.calls[0]).toBe("startSavePicker:note.md");
    await settle();
    expect(clipboard.writeText).toHaveBeenCalledWith(FULL_PATH);
  });
});
