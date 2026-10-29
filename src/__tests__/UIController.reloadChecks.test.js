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

// AT-FT-17..20: Reload reads the file from disk again, so it runs the same
// checks as a drop (INV-18 (1)-(5), coordinator ruling 2026-10-30): the
// file type by the file's name, 5 MB, U+0000 in the decoded text. A
// refusal shows the same alert as at open, and the view, the document,
// the save target and the unsaved state stay as they were.

const NUL = "\u0000";
const messages = CONFIG.fileDrop.messages;
const tooBig = () => "x".repeat(CONFIG.fileDrop.maxBytes + 1);
const toasts = () => showToast.mock.calls.map((c) => c[0]);
const bodyView = () => [...document.body.classList].find((c) => c.startsWith("view-"));

let app;
let access;
let dialog;

beforeEach(() => {
  showToast.mockClear();
  dialog = { askOpen: vi.fn(async () => null), askSaveEncoding: vi.fn(async () => null) };
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  app?.teardown();
  app = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function start() {
  access = fakeFileAccess();
  app = await setupApp({ fileAccess: access, codeDialog: dialog, codeEditor: true });
  return app;
}

async function drop(content, name, handle = null) {
  document.dispatchEvent(dropEvent(new File([content], name, { lastModified: 1000 }), handle));
  await settle();
}

/** A dropped .md with a save target, then one block changed (unsaved). */
async function openUnsavedMarkdown() {
  await start();
  const handle = fakeFileHandle({ name: "doc.md", content: ["# Kept\n\nText.\n"], calls: access.calls });
  await drop("# Kept\n\nText.\n", "doc.md", handle);
  keydown(document.body, "e"); // the palette: edit mode
  const id = app.block((b) => b.raw.startsWith("Text")).block.id;
  await app.orchestrator.commitBlock(id, "Changed.");
  await settle();
  app.ui._refreshDirtyMark();
  expect(document.title).toBe(CONFIG.edit.titleUnsavedPrefix + BASE_TITLE);
  return handle;
}

function expectMarkdownKept(handle) {
  expect(bodyView()).toBe("view-markdown");
  expect(app.orchestrator.getBody()).toBe("# Kept\n\nChanged.\n");
  expect(app.preview.querySelector("h1").textContent).toBe("Kept");
  expect(app.documents.location.fileHandle).toBe(handle);
  expect(document.title).toBe(CONFIG.edit.titleUnsavedPrefix + BASE_TITLE); // still unsaved
  expect(window.confirm).not.toHaveBeenCalled(); // refused before the unsaved question
  expect(toasts()).not.toContain(CONFIG.messages.edit.reloadFailed);
}

describe("AT-FT-17 INV-18 (1), INV-21 Reload: a Markdown file now over 5 MB is refused on Reload", () => {
  it("the tooLarge alert; the text is not read; the document, its save target and the unsaved state stay", async () => {
    const handle = await openUnsavedMarkdown();
    handle.state.content = [tooBig()];
    const text = vi.spyOn(Blob.prototype, "text");
    await app.ui.handleReload();
    await settle();
    expect(window.alert).toHaveBeenCalledWith(messages.tooLarge);
    expect(text).not.toHaveBeenCalled(); // checked before the read
    expectMarkdownKept(handle);
  });
});

describe("AT-FT-18 INV-18 (2)(4), INV-21 Reload: a file whose name is not in the table is refused on Reload", () => {
  it("Markdown view: the notAllowed alert; nothing changes", async () => {
    const handle = await openUnsavedMarkdown();
    handle.name = "doc.xyz"; // the file the save target reads is not of a listed type
    await app.ui.handleReload();
    await settle();
    expect(window.alert).toHaveBeenCalledWith(messages.notAllowed);
    expectMarkdownKept(handle);
  });
});

describe("AT-FT-19 INV-18 (5), INV-21 Reload: a Markdown file whose text now holds U+0000 is refused on Reload", () => {
  it("the binaryFile alert; nothing changes; a clean file reloads afterwards", async () => {
    const handle = await openUnsavedMarkdown();
    handle.state.content = [`# New\n\nA${NUL}B\n`];
    await app.ui.handleReload();
    await settle();
    expect(window.alert).toHaveBeenCalledWith(messages.binaryFile);
    expectMarkdownKept(handle);
    handle.state.content = ["# New\n"];
    await app.ui.handleReload();
    await settle();
    expect(window.confirm).toHaveBeenCalledTimes(1); // the unsaved question, then the reload
    expect(app.preview.querySelector("h1").textContent).toBe("New");
  });
});

describe("AT-FT-20 INV-18 (1)(4)(5), INV-89 (6), INV-21 Reload: the code view's Reload runs the same checks", () => {
  /** A dropped .js with a save target, its text changed (unsaved); Reload reads the handle's file. */
  async function openUnsavedCode() {
    await start();
    const handle = fakeFileHandle({ name: "a.js", content: ["let a = 1;\n"], calls: access.calls });
    await drop("let a = 1;\n", "a.js", handle);
    app.codeEdit.updateText("let a = 2;\n");
    app.ui._refreshDirtyMark();
    app.sourceFileRenderer.reload.mockImplementation(async (theme, isCurrent, readText = (file) => file.text()) => {
      await readText(await handle.getFile());
      return { fileName: handle.name, fileSize: 1, lineCount: 1, language: "javascript", updatedAtStr: "y" };
    });
    const info = app.elements.fileInfo.textContent;
    return { handle, info };
  }

  function expectCodeKept(info) {
    expect(bodyView()).toBe("view-code");
    expect(app.codeEdit.currentText()).toBe("let a = 2;\n");
    expect(app.codeEdit.isDirty()).toBe(true);
    expect(document.title).toBe(CONFIG.edit.titleUnsavedPrefix + BASE_TITLE);
    expect(app.elements.fileInfo.textContent).toBe(info);
    expect(toasts()).not.toContain(CONFIG.messages.edit.reloadFailed);
  }

  it.each([
    ["over 5 MB", (h) => (h.state.content = [tooBig()]), messages.tooLarge],
    ["a name not in the table", (h) => (h.name = "a.xyz"), messages.notAllowed],
    ["U+0000 in the decoded text", (h) => (h.state.content = [`let b${NUL} = 1;\n`]), messages.binaryFile],
  ])("%s: the same alert as at open; the code document, its text and the unsaved state stay", async (_label, change, message) => {
    const { handle, info } = await openUnsavedCode();
    change(handle);
    await app.ui.handleReload();
    await settle();
    expect(window.alert).toHaveBeenCalledWith(message);
    expectCodeKept(info);
  });
});

describe("AT-FT-22 INV-21 (2) before (3)(4), INV-18 (8): the code view's Reload reads and checks before the questions; a refusal keeps edit mode", () => {
  const textarea = () => app.preview.querySelector("#codeEditBody textarea.code-edit-input");
  function type(value) {
    const ta = textarea();
    ta.value = value;
    ta.setSelectionRange(value.length, value.length);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /** A dropped .js in code edit mode with typed text (unsaved); Reload reads the handle's file. */
  async function openEditingCode() {
    await start();
    const handle = fakeFileHandle({ name: "a.js", content: ["let a = 1;\n"], calls: access.calls });
    await drop("let a = 1;\n", "a.js", handle);
    keydown(document.body, "e");
    type("let a = 2;\n");
    app.ui._refreshDirtyMark();
    expect(app.codeEdit.isEditing()).toBe(true);
    app.sourceFileRenderer.reload.mockImplementation(async (theme, isCurrent, readText = (file) => file.text()) => {
      const text = await readText(await handle.getFile());
      if (text === null) return null;
      return { fileName: handle.name, fileSize: 1, lineCount: 1, language: "javascript", updatedAtStr: "y" };
    });
    return handle;
  }

  function expectStillEditing() {
    expect(app.codeEdit.isEditing()).toBe(true);
    expect(textarea().value).toBe("let a = 2;\n");
    expect(app.codeEdit.shownText()).toBe("let a = 2;\n");
    expect(app.sourceFileRenderer.showText).not.toHaveBeenCalled(); // the view was not drawn again
    expect(document.title).toBe(CONFIG.edit.titleUnsavedPrefix + BASE_TITLE);
  }

  it.each([
    ["over 5 MB", (h) => (h.state.content = [tooBig()]), messages.tooLarge],
    ["a name not in the table", (h) => (h.name = "a.xyz"), messages.notAllowed],
    ["U+0000 in the decoded text", (h) => (h.state.content = [`let b${NUL} = 1;\n`]), messages.binaryFile],
  ])("%s while editing: the alert, no unsaved question, and edit mode goes on with the typed text", async (_label, change, message) => {
    const handle = await openEditingCode();
    change(handle);
    await app.ui.handleReload();
    await settle();
    expect(window.alert).toHaveBeenCalledWith(message);
    expect(window.confirm).not.toHaveBeenCalled();
    expectStillEditing();
  });

  it("the file is read before the unsaved question; Cancel then changes nothing and edit mode goes on", async () => {
    const handle = await openEditingCode();
    const order = [];
    handle.calls.length = 0;
    window.confirm.mockImplementation(() => {
      order.push(`confirm after ${handle.calls.join(",")}`);
      return false;
    });
    await app.ui.handleReload();
    await settle();
    expect(order).toEqual(["confirm after getFile"]);
    expectStillEditing();
  });

  it("a file that cannot be read: the reloadFailed toast before any question; edit mode goes on", async () => {
    await openEditingCode();
    app.sourceFileRenderer.reload.mockRejectedValue(new Error("NotReadableError"));
    await app.ui.handleReload();
    await settle();
    expect(toasts()).toContain(CONFIG.messages.edit.reloadFailed);
    expect(window.confirm).not.toHaveBeenCalled();
    expectStillEditing();
  });

  it("OK after the checks passed: edit mode ends (after the question, not before the read) and the file read is the document", async () => {
    const handle = await openEditingCode();
    handle.state.content = ["let c = 3;\n"];
    handle.calls.length = 0;
    const order = [];
    window.confirm.mockImplementation(() => {
      order.push(`confirm after ${handle.calls.join(",")}, editing ${app.codeEdit.isEditing()}`);
      return true;
    });
    await app.ui.handleReload();
    await settle();
    expect(order).toEqual(["confirm after getFile, editing true"]);
    expect([app.codeEdit.isEditing(), app.codeEdit.currentText(), app.codeEdit.isDirty()]).toEqual([false, "let c = 3;\n", false]);
  });
});
