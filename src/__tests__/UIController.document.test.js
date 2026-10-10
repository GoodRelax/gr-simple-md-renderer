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

import { showToast, waitForDOMStability } from "../js/utils.js";
import { CONFIG } from "../js/config.js";
import { setupApp, dropEvent, settle, BASE_TITLE } from "./helpers/appStack.js";
import { tap, pointer, keydown } from "./helpers/editDom.js";
import { fakeFileHandle, deferred, domError } from "./helpers/fakeFs.js";
import { loadFixtureLf, toCrlf } from "./helpers/samples.js";

const M = CONFIG.messages.edit;
const BOM = String.fromCharCode(0xfeff);
const DOC = "# Title\n\nHello world.\n\nSecond para.\n";

let app;
let confirmSpy;

beforeEach(() => {
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "alert").mockImplementation(() => {});
  showToast.mockClear();
});

afterEach(() => {
  app?.teardown();
  app = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mdFile = (text, name = "doc.md", lastModified = 1000) => new File([text], name, { lastModified });

/** Drop a .md file (with a fake handle) and let it render. */
async function dropMd(text, { name = "doc.md", handle } = {}) {
  const h = handle ?? fakeFileHandle({ name, content: [text] });
  document.dispatchEvent(dropEvent(mdFile(text, name), h));
  await settle();
  return h;
}

function typeInEditor(text) {
  app.elements.editor.value = text;
  app.elements.editor.dispatchEvent(new Event("input", { bubbles: true }));
}

function showPalette() {
  keydown(document.body, "e");
}

const isPara = (start) => (b) => b.type === "paragraph" && b.raw.startsWith(start);

/** Open a block in edit mode and change its text (the palette is shown first). */
function editBlock(start, newText) {
  if (!app.ui.palette.isShown()) showPalette();
  const { el } = app.block(isPara(start));
  tap(el.firstElementChild);
  const ta = app.blockEditor();
  ta.value = newText;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return ta;
}

function commitByPressingOutside() {
  pointer(document.body, "pointerdown");
  pointer(document.body, "pointerup");
}

const isDirtyTitle = () => document.title === CONFIG.edit.titleUnsavedPrefix + BASE_TITLE;

function beforeUnloadPrevented() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

describe("AT-UI unsaved state (INV-21, INV-22, INV-50)", () => {
  it("AT-UI-01 derived: no session -> clean; commit -> dirty; undo back -> clean; open change -> dirty; #editor input -> dirty, a render to the same body -> clean", async () => {
    app = await setupApp();
    expect(app.ui._isDocumentDirty()).toBe(false);
    await dropMd(DOC);
    expect(app.ui._isDocumentDirty()).toBe(false);
    editBlock("Hello", "Hello there.");
    expect(app.ui._isDocumentDirty()).toBe(true); // open editor with a change
    commitByPressingOutside();
    expect(app.ui._isDocumentDirty()).toBe(true); // committed body differs
    app.orchestrator.undoLastCommit();
    expect(app.ui._isDocumentDirty()).toBe(false);
    typeInEditor(app.elements.editor.value + "x");
    expect(app.ui._isDocumentDirty()).toBe(true);
    typeInEditor(DOC);
    await app.ui.handleRender("light");
    expect(app.ui._isDocumentDirty()).toBe(false);
  });

  it("AT-UI-02 title gets '* ' while dirty and never the file name", async () => {
    app = await setupApp();
    await dropMd(DOC, { name: "secret-name.md" });
    expect(document.title).toBe(BASE_TITLE);
    editBlock("Hello", "Changed.");
    expect(isDirtyTitle()).toBe(true);
    expect(document.title).not.toContain("secret-name");
    keydown(app.blockEditor(), "Escape");
    expect(document.title).toBe(BASE_TITLE);
  });

  it("AT-UI-03 the palette status shows '<name> * unsaved' / '<name> - saved'", async () => {
    app = await setupApp();
    await dropMd(DOC, { name: "notes.md" });
    showPalette();
    const status = app.paletteRoot().querySelector("#paletteStatus");
    expect(status.textContent).toBe(M.statusSaved("notes.md"));
    editBlock("Hello", "Changed.");
    expect(status.textContent).toBe(M.statusUnsaved("notes.md"));
  });

  it.each([
    ["commit", () => { editBlock("Hello", "C."); commitByPressingOutside(); }, true],
    ["undo", () => { editBlock("Hello", "C."); commitByPressingOutside(); app.orchestrator.undoLastCommit(); }, false],
    ["editor input", () => editBlock("Hello", "C."), true],
    ["#editor input", () => typeInEditor("# Other\n"), true],
    ["full render (taken in)", async () => { typeInEditor(DOC); await app.ui.handleRender("dark"); }, false],
  ])("AT-UI-04 the title is right right after: %s", async (_name, act, dirty) => {
    app = await setupApp();
    await dropMd(DOC);
    await act();
    expect(isDirtyTitle()).toBe(dirty);
  });

  it("AT-UI-05 beforeunload: prevented for a committed change, an open change, and #editor changes; not otherwise", async () => {
    app = await setupApp();
    expect(beforeUnloadPrevented()).toBe(false);
    await dropMd(DOC);
    expect(beforeUnloadPrevented()).toBe(false);
    const ta = editBlock("Hello", "Changed.");
    expect(beforeUnloadPrevented()).toBe(true);
    keydown(ta, "Escape");
    expect(beforeUnloadPrevented()).toBe(false);
    editBlock("Hello", "Changed.");
    commitByPressingOutside();
    expect(beforeUnloadPrevented()).toBe(true);
    app.orchestrator.undoLastCommit();
    typeInEditor(DOC + "x");
    expect(beforeUnloadPrevented()).toBe(true);
  });
});

describe("AT-UI replacing the document (INV-21, INV-43, INV-55)", () => {
  it("AT-UI-07 .md drop on an unsaved document, Cancel: nothing changes, consent kept", async () => {
    app = await setupApp();
    await dropMd(DOC);
    const ta = editBlock("Hello", "Unsaved text.");
    const reset = vi.spyOn(app.orchestrator, "resetExternalImageConsent");
    const model = app.orchestrator.getModel();
    const editorText = app.elements.editor.value;
    confirmSpy.mockReturnValue(false);
    document.dispatchEvent(dropEvent(mdFile("# New\n", "new.md"), null));
    await settle();
    expect(confirmSpy).toHaveBeenCalledWith(M.unsavedConfirm);
    expect(app.orchestrator.getModel()).toBe(model);
    expect(app.blockEditor()).toBe(ta);
    expect(ta.value).toBe("Unsaved text.");
    expect(app.elements.editor.value).toBe(editorText);
    expect(app.orchestrator.isPreRenderState()).toBe(false);
    expect(reset).not.toHaveBeenCalled();
  });

  it("AT-UI-08 .md drop, OK: the editor is discarded (no commit); replace right after confirm, before the next await", async () => {
    app = await setupApp();
    await dropMd(DOC);
    editBlock("Hello", "Unsaved text.");
    const order = [];
    const commit = vi.spyOn(app.orchestrator, "commitBlock");
    vi.spyOn(app.orchestrator, "resetExternalImageConsent").mockImplementation(() => order.push("resetConsent"));
    const load = vi.spyOn(app.orchestrator, "loadMarkdown");
    load.mockImplementation(function (...args) {
      order.push("loadMarkdown");
      return Object.getPrototypeOf(app.orchestrator).loadMarkdown.apply(app.orchestrator, args);
    });
    confirmSpy.mockImplementation(() => {
      order.push("confirm");
      queueMicrotask(() => order.push("next microtask"));
      return true;
    });
    const handle = fakeFileHandle({ name: "new.md", content: ["# New\n"] });
    document.dispatchEvent(dropEvent(mdFile("# New\n", "new.md", 5000), handle));
    await settle();
    expect(order.slice(0, 4)).toEqual(["confirm", "resetConsent", "loadMarkdown", "next microtask"]);
    expect(commit).not.toHaveBeenCalled();
    expect(app.blockEditor()).toBeNull();
    expect(app.orchestrator.getBody()).toBe("# New\n");
    expect(app.ui._location.fileName).toBe("new.md");
    expect(app.ui._location.fileHandle).toBe(handle);
    expect(app.ui._session.baselineLastModified).toBe(5000);
    expect(app.ui._isDocumentDirty()).toBe(false);
  });

  it("AT-UI-09 non-.md drop on an unsaved document, OK: no document, code view, consent kept, title clean", async () => {
    app = await setupApp();
    await dropMd(DOC);
    typeInEditor("# changed\n");
    const reset = vi.spyOn(app.orchestrator, "resetExternalImageConsent");
    const load = vi.spyOn(app.orchestrator, "loadMarkdown");
    document.dispatchEvent(dropEvent(new File(["print(1)\n"], "a.py"), null));
    await settle();
    expect(confirmSpy).toHaveBeenCalledWith(M.unsavedConfirm);
    expect(app.sourceFileRenderer.render).toHaveBeenCalled();
    expect(app.orchestrator.isCodeViewActive()).toBe(true);
    expect(app.orchestrator.getModel()).toBeNull();
    expect(app.state.markdownText).toBe("");
    expect(app.ui._session).toBeNull();
    expect(app.ui._location).toBeNull();
    expect(app.ui._isDocumentDirty()).toBe(false);
    expect(document.title).toBe(BASE_TITLE);
    expect(load).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it("AT-UI-10 drop order: handle (sync) -> read -> confirm -> replace", async () => {
    app = await setupApp();
    await dropMd(DOC);
    typeInEditor("# changed\n");
    const order = [];
    const file = {
      name: "n.md",
      size: 10,
      lastModified: 1,
      slice: () => ({ arrayBuffer: async () => (order.push("readHead"), new Uint8Array([35, 32, 78]).buffer) }),
      text: async () => (order.push("readText"), "# N\n"),
    };
    confirmSpy.mockImplementation(() => (order.push("confirm"), true));
    vi.spyOn(app.orchestrator, "loadMarkdown").mockImplementation(async () => order.push("replace"));
    const event = dropEvent(file, null);
    document.dispatchEvent(event);
    expect(event.calls).toEqual(["getAsFileSystemHandle"]); // before the first await

    await settle();
    expect(order).toEqual(["readHead", "readText", "confirm", "replace"]);
  });

  it.each([
    ["over 5 MB", () => ({ name: "big.md", size: CONFIG.fileDrop.maxBytes + 1 }), CONFIG.fileDrop.messages.tooLarge],
    ["a binary extension", () => ({ name: "x.png", size: 10 }), CONFIG.fileDrop.messages.binaryFile],
  ])("AT-UI-11 %s is refused before any confirm", async (_name, make, message) => {
    app = await setupApp();
    await dropMd(DOC);
    typeInEditor("# changed\n");
    const f = make();
    const file = { ...f, lastModified: 1, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }), text: async () => "" };
    document.dispatchEvent(dropEvent(file, null));
    await settle();
    expect(window.alert).toHaveBeenCalledWith(message);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("AT-UI-11 an unknown extension with a null byte is refused before any confirm", async () => {
    app = await setupApp();
    await dropMd(DOC);
    typeInEditor("# changed\n");
    document.dispatchEvent(dropEvent(new File([new Uint8Array([65, 0, 66])], "data.xyz"), null));
    await settle();
    expect(window.alert).toHaveBeenCalledWith(CONFIG.fileDrop.messages.binaryFile);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("AT-UI-12 (a) Reload reads first; a read failure changes nothing and asks nothing", async () => {
    app = await setupApp();
    const handle = fakeFileHandle({ name: "doc.md", content: [DOC], getFileError: domError("NotReadableError") });
    await dropMd(DOC, { handle });
    typeInEditor("# changed\n");
    const model = app.orchestrator.getModel();
    await app.ui.handleReload();
    expect(showToast).toHaveBeenCalledWith(M.reloadFailed, CONFIG.codeView.toastDurationMs);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(app.orchestrator.getModel()).toBe(model);
  });

  it("AT-UI-12 (a) the document changed while reading: reloadCanceled, nothing changes", async () => {
    app = await setupApp();
    const gate = deferred();
    const handle = {
      name: "doc.md",
      getFile: async () => {
        await gate.promise;
        return new File(["# Disk\n"], "doc.md", { lastModified: 9 });
      },
    };
    await dropMd(DOC, { handle });
    const reloading = app.ui.handleReload();
    await dropMd("# Other\n", { name: "other.md" });
    const model = app.orchestrator.getModel();
    gate.resolve();
    await reloading;
    expect(showToast).toHaveBeenCalledWith(M.reloadCanceled, CONFIG.codeView.toastDurationMs);
    expect(app.orchestrator.getModel()).toBe(model);
    expect(app.orchestrator.getBody()).toBe("# Other\n");
  });

  it("AT-UI-12 (c)(d) unsaved: Cancel keeps everything; OK replaces with the file (BOM and line endings read again), same save target, consent kept", async () => {
    app = await setupApp();
    const handle = fakeFileHandle({ name: "doc.md", content: [DOC] });
    await dropMd(DOC, { handle });
    const location = app.ui._location;
    const oldId = app.ui._session.documentId;
    typeInEditor("# changed\n");
    handle.state.content = [BOM + toCrlf("# Disk\n\nNew.\n")];
    handle.state.lastModified = 7000;
    const reset = vi.spyOn(app.orchestrator, "resetExternalImageConsent");

    confirmSpy.mockReturnValueOnce(false);
    await app.ui.handleReload();
    expect(app.elements.editor.value).toBe("# changed\n");
    expect(app.ui._session.documentId).toBe(oldId);

    await app.ui.handleReload();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(app.orchestrator.getBody()).toBe("# Disk\n\nNew.\n");
    expect(app.elements.editor.value).toBe("# Disk\n\nNew.\n");
    expect(app.ui._session.documentId).not.toBe(oldId);
    expect(app.ui._session.hasBom).toBe(true);
    expect(app.ui._session.lineEnding).toBe("\r\n");
    expect(app.ui._session.baselineLastModified).toBe(7000);
    expect(app.ui._location).toBe(location);
    expect(reset).not.toHaveBeenCalled();
    expect(app.ui._isDocumentDirty()).toBe(false);
  });

  it("AT-UI-13 Reload of a pasted document (no save target) shows the old toast and changes nothing", async () => {
    app = await setupApp();
    await app.ui._startPastedDocument("# Pasted\n", "light");
    const model = app.orchestrator.getModel();
    await app.ui.handleReload();
    expect(showToast).toHaveBeenCalledWith(CONFIG.codeView.reloadNoFileMsg, CONFIG.codeView.toastDurationMs);
    expect(app.orchestrator.getModel()).toBe(model);
  });

  it("AT-UI-14 Clear: Cancel keeps all; OK discards the editor, drops session and target, initial state, palette hidden, consent revoked", async () => {
    app = await setupApp();
    await dropMd(DOC);
    const ta = editBlock("Hello", "Unsaved.");
    ta.blur(); // the editor keeps the keys while it has the focus (INV-14)
    confirmSpy.mockReturnValueOnce(false);
    keydown(document.body, "c");
    expect(app.blockEditor()).toBe(ta);
    expect(app.orchestrator.isPreRenderState()).toBe(false);

    const commit = vi.spyOn(app.orchestrator, "commitBlock");
    const reset = vi.spyOn(app.markdownRenderer, "resetExternalImageConsent");
    app.elements.clearBtn.click();
    expect(commit).not.toHaveBeenCalled();
    expect(app.blockEditor()).toBeNull();
    expect(app.orchestrator.isPreRenderState()).toBe(true);
    expect(app.orchestrator.getModel()).toBeNull();
    expect(app.ui._session).toBeNull();
    expect(app.ui._location).toBeNull();
    expect(app.ui.palette.isShown()).toBe(false);
    expect(reset).toHaveBeenCalled();
    expect(app.ui._isDocumentDirty()).toBe(false);
    expect(document.title).toBe(BASE_TITLE);
  });

  it.each(["clear", "drop", "reload"])("AT-UI-15 no confirm when not unsaved: %s", async (what) => {
    app = await setupApp();
    await dropMd(DOC);
    if (what === "clear") app.ui.doClear();
    if (what === "drop") await dropMd("# B\n", { name: "b.md" });
    if (what === "reload") await app.ui.handleReload();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("CRLF .md drop: line endings are normalized before the wrapper split; no \\r in the body", async () => {
    app = await setupApp();
    await dropMd(toCrlf("```markdown\n# A\nB\n```\n"));
    expect(app.orchestrator.getBody()).toBe("# A\nB");
    expect(app.elements.editor.value).not.toContain("\r");
    expect(app.orchestrator.getBody()).not.toContain("\r");
    expect(app.ui._session.lineEnding).toBe("\r\n");
  });

  it("AT-UI-33 a BOM + CRLF .md: the session keeps BOM and CRLF; #editor has the LF body", async () => {
    app = await setupApp();
    await dropMd(BOM + toCrlf("# A\n\nB\n"));
    expect(app.ui._session.hasBom).toBe(true);
    expect(app.ui._session.lineEnding).toBe("\r\n");
    expect(app.elements.editor.value).toBe("# A\n\nB\n");
  });
});

describe("AT-UI rendering from #editor and pasting (INV-45, 5.14.1, T33)", () => {
  it("AT-UI-16 markdown view [Render Dark]: commits the open editor first, no confirm, same session; the mark drops in the handler", async () => {
    app = await setupApp();
    await dropMd(DOC);
    const session = app.ui._session;
    editBlock("Hello", "Committed by render.");
    app.elements.editor.dispatchEvent(new Event("input", { bubbles: true }));
    const rendering = app.ui.handleRender("dark");
    expect(app.ui._editorChangedSinceRender).toBe(false);
    expect(app.orchestrator.getBody()).toContain("Committed by render.");
    await rendering;
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(app.ui._session).toBe(session);
    expect(app.state.currentTheme).toBe("dark");
  });

  it("AT-UI-17 unrendered #editor changes: a block tap renders from #editor and toasts instead of opening", async () => {
    app = await setupApp();
    await dropMd(DOC);
    showPalette();
    typeInEditor("# Title\n\nHello world.\n\nSecond para.\n\nTyped.\n");
    tap(app.block(isPara("Hello")).el.firstElementChild);
    expect(app.blockEditor()).toBeNull();
    expect(showToast).toHaveBeenCalledWith(M.editorRenderedFirst, CONFIG.codeView.toastDurationMs);
    expect(app.orchestrator.getBody()).toContain("Typed.");
    expect(app.elements.editor.value).toContain("Typed.");
  });

  it("AT-UI-18 #editor has the new body when the commit handler returns; text typed before the render stays", async () => {
    app = await setupApp();
    await dropMd(DOC);
    editBlock("Hello", "New hello.");
    pointer(document.body, "pointerdown");
    expect(app.elements.editor.value).toBe("# Title\n\nNew hello.\n\nSecond para.\n");
    app.elements.editor.value += "Typed";
    await settle();
    expect(app.elements.editor.value.endsWith("Typed")).toBe(true);
  });

  it("AT-UI-30 an initial CRLF paste with a wrapper: normalized, then split; a pasted session", async () => {
    app = await setupApp();
    const e = new Event("paste", { bubbles: true, cancelable: true });
    e.clipboardData = { getData: () => "```markdown  \r\n# A\r\n```" };
    document.dispatchEvent(e);
    await settle();
    expect(e.defaultPrevented).toBe(true);
    expect(app.preview.querySelector("h1").textContent).toBe("A");
    expect(app.elements.editor.value).toBe("# A");
    expect(app.ui._session.hasBom).toBe(false);
    expect(app.ui._location).toBeNull();
  });

  it("AT-UI-31 a paste in the markdown view does not render", async () => {
    app = await setupApp();
    await dropMd(DOC);
    const load = vi.spyOn(app.orchestrator, "loadMarkdown");
    const e = new Event("paste", { bubbles: true, cancelable: true });
    e.clipboardData = { getData: () => "# X" };
    document.dispatchEvent(e);
    await settle();
    expect(e.defaultPrevented).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it("AT-UI-32 initial [Render]: normalize -> split -> new pasted session, no save target (untitled.md)", async () => {
    app = await setupApp();
    app.elements.editor.value = "```markdown\r\n# R\r\n```";
    app.elements.renderLightBtn.click();
    await settle();
    expect(app.orchestrator.getBody()).toBe("# R");
    expect(app.ui._location).toBeNull();
    keydown(document.body, "e");
    expect(app.paletteRoot().querySelector("#paletteStatus").textContent).toBe(M.statusSaved(CONFIG.edit.defaultFileName));
  });

  it("AT-UI-45 input during the render raises the mark again and it stays", async () => {
    app = await setupApp();
    await dropMd(DOC);
    typeInEditor(DOC + "A\n");
    const gate = deferred();
    waitForDOMStability.mockReturnValueOnce(gate.promise);
    const rendering = app.ui.handleRender("light");
    expect(app.ui._isDocumentDirty()).toBe(true); // body now differs from the baseline
    expect(app.ui._editorChangedSinceRender).toBe(false);
    typeInEditor(app.elements.editor.value + "B\n");
    expect(app.ui._editorChangedSinceRender).toBe(true);
    expect(isDirtyTitle()).toBe(true);
    gate.resolve(true);
    await rendering;
    expect(app.ui._editorChangedSinceRender).toBe(true);
  });

  it("AT-UI-46 (a) markdown view: a body that starts with a markdown example and ends with a code block keeps its fences; an initial paste of it is split", async () => {
    app = await setupApp();
    await dropMd(loadFixtureLf("example-then-code.md"));
    expect(app.orchestrator.getBody().startsWith("Text\n")).toBe(true);
    const edited = app.elements.editor.value.replace(/^Text\n\n/, "");
    typeInEditor(edited);
    app.elements.renderLightBtn.click();
    await settle();
    expect(app.orchestrator.getBody().startsWith("```markdown\n# ex\n```")).toBe(true);
    expect(app.orchestrator.getBody().trimEnd().endsWith("```js\nx\n```")).toBe(true);

    app.ui.doClear();
    await app.ui._startPastedDocument(edited, "light");
    expect(app.orchestrator.getBody().startsWith("```markdown")).toBe(false);
  });
});

describe("AT-UI-41 rebuilding the document (5.14.11, first 7 rows)", () => {
  // Rows: session (new / same / none), location, consent reset, undo record.
  async function withUndoRecord() {
    const handle = fakeFileHandle({ name: "doc.md", content: [DOC] });
    await dropMd(DOC, { handle });
    editBlock("Hello", "Changed.");
    commitByPressingOutside();
    expect(app.orchestrator.canUndo()).toBe(true);
    return handle;
  }

  const ROWS = [
    ["a .md drop", async () => dropMd("# B\n", { name: "b.md" }), "new", "b.md", true],
    ["Reload", async () => app.ui.handleReload(), "new", "same", false],
    ["markdown view render from #editor", async () => app.ui.handleRender("light"), "same", "same", false],
    ["Clear", async () => app.ui.doClear(), "none", "none", true],
    ["a non-.md drop", async () => { document.dispatchEvent(dropEvent(new File(["x"], "a.py"), null)); await settle(); }, "none", "none", false],
  ];

  it.each(ROWS)("%s", async (_name, act, session, location, consentReset) => {
    app = await setupApp();
    await withUndoRecord();
    const before = { session: app.ui._session, location: app.ui._location };
    const reset = vi.spyOn(app.markdownRenderer, "resetExternalImageConsent");
    await act();
    await settle();
    if (session === "new") expect(app.ui._session.documentId).not.toBe(before.session.documentId);
    if (session === "same") expect(app.ui._session).toBe(before.session);
    if (session === "none") expect(app.ui._session).toBeNull();
    if (location === "same") expect(app.ui._location).toBe(before.location);
    else if (location === "none") expect(app.ui._location).toBeNull();
    else expect(app.ui._location.fileName).toBe(location);
    expect(reset.mock.calls.length > 0).toBe(consentReset);
    expect(app.orchestrator.canUndo()).toBe(false);
  });

  it.each([
    ["an initial paste / #editor render", async () => app.ui._startPastedDocument("# P\n", "light")],
    ["an empty document", async () => app.ui._startEmptyDocument()],
  ])("%s: new session, no target, consent kept, no undo record", async (_name, act) => {
    app = await setupApp();
    const reset = vi.spyOn(app.markdownRenderer, "resetExternalImageConsent");
    await act();
    await settle();
    expect(app.ui._session.documentId).toBeGreaterThan(0);
    expect(app.ui._location).toBeNull();
    expect(reset).not.toHaveBeenCalled();
    expect(app.orchestrator.canUndo()).toBe(false);
  });
});

describe("AT-UI-47 rebuilding the document lowers the #editor mark", () => {
  it.each([
    ["a .md drop", async () => dropMd("# B\n\nPara b.\n", { name: "b.md" }), true],
    ["Reload", async () => app.ui.handleReload(), true],
    ["Clear", async () => app.ui.doClear(), false],
    ["a non-.md drop", async () => { document.dispatchEvent(dropEvent(new File(["x"], "a.py"), null)); await settle(); }, false],
  ])("%s (OK): clean afterwards", async (_name, act, opensBlock) => {
    app = await setupApp();
    await dropMd(DOC, { handle: fakeFileHandle({ name: "doc.md", content: [DOC] }) });
    typeInEditor(DOC + "typed\n");
    await act();
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(app.ui._editorChangedSinceRender).toBe(false);
    expect(isDirtyTitle()).toBe(false);
    expect(beforeUnloadPrevented()).toBe(false);
    if (opensBlock) {
      showPalette();
      const first = app.orchestrator.getModel().getBlocks().find((b) => b.type === "paragraph");
      tap(app.markdownRenderer.getBlockElement(first.id).firstElementChild);
      expect(app.blockEditor()).not.toBeNull();
      expect(showToast).not.toHaveBeenCalledWith(M.editorRenderedFirst, CONFIG.codeView.toastDurationMs);
    }
  });

  it.each([
    ["an initial paste", async () => app.ui._startPastedDocument("# P\n", "light")],
    ["an empty document", async () => app.ui._startEmptyDocument()],
  ])("%s (entry point): the mark is down", async (_name, act) => {
    app = await setupApp();
    app.ui._editorChangedSinceRender = true;
    await act();
    expect(app.ui._editorChangedSinceRender).toBe(false);
    expect(isDirtyTitle()).toBe(false);
  });
});
