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
import { saveOperationStateMachine } from "../js/classes/DocumentLifecycle.js";
import { setupApp, dropEvent, settle, BASE_TITLE } from "./helpers/appStack.js";
import { tap, pointer, keydown } from "./helpers/editDom.js";
import { fakeFileAccess, fakeFileHandle, deferred, domError } from "./helpers/fakeFs.js";
import { loadFixtureLf } from "./helpers/samples.js";

const M = CONFIG.messages.edit;
const TOAST_MS = CONFIG.codeView.toastDurationMs;
const DOC = "# Title\n\nHello world.\n\nSecond para.\n";
const isPara = (start) => (b) => b.type === "paragraph" && b.raw.startsWith(start);

let app;
let access;
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

/** App with a fake file access; a .md document dropped from doc.md (handle). */
async function withDocument(accessOpts = {}, md = DOC) {
  access = fakeFileAccess(accessOpts);
  app = await setupApp({ fileAccess: access });
  const handle = fakeFileHandle({ name: "doc.md", content: [md], calls: access.calls });
  document.dispatchEvent(dropEvent(new File([md], "doc.md", { lastModified: 1000 }), handle));
  await settle();
  access.calls.length = 0;
  return handle;
}

const paletteButton = (id) => app.paletteRoot().querySelector(`#${id}`);

/** Press and release a palette button (jsdom layout: every rect is at 0,0). */
function press(el) {
  pointer(el, "pointerdown", { x: 0, y: 0 });
  pointer(el, "pointerup", { x: 0, y: 0 });
}

function showPalette() {
  if (!app.ui.palette.isShown()) keydown(document.body, "e");
}

function openChanged(start = "Hello", text = "Changed A.") {
  showPalette();
  tap(app.block(isPara(start)).el.firstElementChild);
  const ta = app.blockEditor();
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return ta;
}

function typeInEditor(text) {
  app.elements.editor.value = text;
  app.elements.editor.dispatchEvent(new Event("input", { bubbles: true }));
}

const isDirtyTitle = () => document.title === CONFIG.edit.titleUnsavedPrefix + BASE_TITLE;

function beforeUnloadPrevented() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

/** Record the synchronous steps of a save press. */
function recordSteps() {
  const steps = access.calls;
  vi.spyOn(app.orchestrator, "commitBlock").mockImplementation(function (...args) {
    steps.push("commit");
    return Object.getPrototypeOf(app.orchestrator).commitBlock.apply(app.orchestrator, args);
  });
  vi.spyOn(app.ui.documents.saveDocument, "execute").mockImplementation(function (...args) {
    steps.push("execute");
    return Object.getPrototypeOf(app.ui.documents.saveDocument).execute.apply(app.ui.documents.saveDocument, args);
  });
  vi.spyOn(app.ui.documents.saveDocumentAs, "execute").mockImplementation(function (...args) {
    steps.push("executeAs");
    return Object.getPrototypeOf(app.ui.documents.saveDocumentAs).execute.apply(app.ui.documents.saveDocumentAs, args);
  });
  return steps;
}

describe("AT-UI-26 INV-33: the steps before the first await of the press handler", () => {
  it("Save with a target: startPermissionRequest -> commit -> execute, all synchronous", async () => {
    const permission = deferred();
    await withDocument({ permission: permission.promise });
    openChanged();
    const steps = recordSteps();
    press(paletteButton("paletteSave"));
    expect(steps).toEqual(["startPermissionRequest", "commit", "execute"]);
    expect(app.orchestrator.getBody()).toContain("Changed A.");
    permission.resolve("granted");
    await settle();
    expect(access.writes).toHaveLength(1);
  });

  it("Save without a target (pasted document): startSavePicker first", async () => {
    access = fakeFileAccess();
    app = await setupApp({ fileAccess: access });
    await app.ui._startPastedDocument("# Pasted\n", "light");
    showPalette();
    recordSteps();
    press(paletteButton("paletteSave"));
    expect(access.calls.slice(0, 2)).toEqual([`startSavePicker:${CONFIG.edit.defaultFileName}`, "execute"]);
  });

  it("Save as: startSavePicker with the current name first", async () => {
    await withDocument();
    openChanged();
    const steps = recordSteps();
    showPalette();
    press(paletteButton("paletteSaveAs"));
    expect(steps).toEqual(["startSavePicker:doc.md", "commit", "executeAs"]);
  });

  it("download (no write API): startDownload inside the handler, after the commit", async () => {
    await withDocument({ canWrite: false });
    openChanged();
    const steps = recordSteps();
    press(paletteButton("paletteSave"));
    // SaveDocument hands over to its own SaveDocumentAs, which starts the download.
    expect(steps).toEqual(["commit", "execute", "startDownload:doc.md"]);
  });
});

describe("AT-UI-44 unrendered #editor changes are taken in before saving", () => {
  it.each([
    ["Save", {}, "paletteSave", (a) => a.writes[0].text],
    ["Save as", {}, "paletteSaveAs", (a) => a.writes[0].text],
    ["download", { canWrite: false }, "paletteSave", (a) => a.downloads[0].text],
  ])("%s: XYZ is in the model before the first await and in the written text; clean afterwards (except download)", async (name, opts, button, written) => {
    const permission = deferred();
    await withDocument({ ...opts, permission: permission.promise });
    const session = app.ui.documents.session;
    showPalette();
    typeInEditor(app.elements.editor.value + "XYZ\n");
    press(paletteButton(button));
    expect(app.orchestrator.getBody()).toContain("XYZ");
    expect(app.ui._editorChangedSinceRender).toBe(false);
    permission.resolve("granted");
    await settle();
    expect(written(access)).toContain("XYZ");
    if (name === "download") {
      expect(app.ui.documents.session).toBe(session);
      expect(isDirtyTitle()).toBe(true);
    } else {
      expect(app.ui.documents.session.documentId).toBe(session.documentId);
      expect(isDirtyTitle()).toBe(false);
    }
  });

  it("AT-UI-43 (b) #editor focus commits A, then XYZ; Save writes both", async () => {
    await withDocument();
    openChanged();
    app.elements.editor.focus();
    typeInEditor(app.elements.editor.value + "XYZ\n");
    await app.ui.requestSave();
    expect(access.writes[0].text).toContain("Changed A.");
    expect(access.writes[0].text).toContain("XYZ");
  });

  it("AT-UI-46 (b) markdown view: the saved file keeps the leading markdown fence (no split, T33)", async () => {
    await withDocument({}, loadFixtureLf("example-then-code.md"));
    typeInEditor(app.elements.editor.value.replace(/^Text\n\n/, ""));
    await app.ui.requestSave();
    expect(access.writes[0].text.startsWith("```markdown\n# ex\n```")).toBe(true);
  });
});

describe("AT-UI-27 / 28 / 29 / 06 / 39 save results", () => {
  it("AT-UI-27 saved: the '* ' goes, toast 'Saved: <name>'; after Save as the target is the new file", async () => {
    await withDocument();
    openChanged();
    pointer(document.body, "pointerdown");
    expect(isDirtyTitle()).toBe(true);
    await app.ui.requestSave();
    expect(isDirtyTitle()).toBe(false);
    expect(showToast).toHaveBeenCalledWith(M.saved("doc.md"), TOAST_MS);

    await app.ui.requestSaveAs();
    expect(app.ui.documents.location.fileName).toBe("picked.md");
    await app.ui.requestSave();
    expect(access.calls).toContain("writeFile:picked.md");
  });

  it("AT-UI-28 an outcome for another document id changes neither session nor target", async () => {
    const permission = deferred();
    await withDocument({ permission: permission.promise });
    const saving = app.ui.requestSave();
    const { session, location } = { session: app.ui.documents.session, location: app.ui.documents.location };
    const result = app.ui.documents.finishSave({ status: "saved", documentId: 999, session: { documentId: 999 }, location: { fileName: "x.md" }, message: "m" });
    expect(result).toEqual({ applied: false, message: "m" }); // the toast is still shown (11-e)
    expect(app.ui.documents.session).toBe(session);
    expect(app.ui.documents.location).toBe(location);
    permission.resolve("granted");
    await saving;
  });

  it("AT-UI-29 confirmOverwrite asks with externalChangeConfirm and resolves with the answer", async () => {
    await withDocument();
    confirmSpy.mockReturnValueOnce(false);
    await expect(app.ui.confirmOverwrite("changed")).resolves.toBe(false);
    expect(confirmSpy).toHaveBeenCalledWith(M.externalChangeConfirm);
    await expect(app.ui.confirmOverwrite("changed")).resolves.toBe(true);
  });

  it("INV-39 an unknown baseline asks with its own message (not 'changed outside')", async () => {
    await withDocument();
    confirmSpy.mockReturnValueOnce(false);
    await expect(app.ui.confirmOverwrite("unknown")).resolves.toBe(false);
    expect(confirmSpy).toHaveBeenCalledWith(M.overwriteUnknownConfirm);
    expect(M.overwriteUnknownConfirm).not.toBe(M.externalChangeConfirm);
    expect(M.overwriteUnknownConfirm).toMatch(/^[\x20-\x7e]+$/);
  });

  it("INV-39 a file changed on disk: Cancel keeps it unsaved, nothing written", async () => {
    await withDocument({ lastModified: 5555 });
    openChanged();
    pointer(document.body, "pointerdown");
    confirmSpy.mockReturnValueOnce(false);
    await app.ui.requestSave();
    expect(confirmSpy).toHaveBeenCalledWith(M.externalChangeConfirm);
    expect(access.writes).toHaveLength(0);
    expect(isDirtyTitle()).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("AT-UI-06 a download keeps the '* ' and beforeunload still asks", async () => {
    await withDocument({ canWrite: false });
    openChanged();
    pointer(document.body, "pointerdown");
    await app.ui.requestSave();
    expect(access.downloads).toHaveLength(1);
    expect(isDirtyTitle()).toBe(true);
    expect(beforeUnloadPrevented()).toBe(true);
    expect(showToast).toHaveBeenCalledWith(M.downloadStarted("doc.md"), TOAST_MS);
  });

  /** A rejected promise that is already handled (no unhandled rejection report). */
  const rejected = (error) => {
    const p = Promise.reject(error);
    p.catch(() => {});
    return p;
  };

  it.each([
    ["saved", () => ({}), () => M.saved("doc.md"), false],
    ["download", () => ({ canWrite: false }), () => M.downloadStarted("doc.md"), true],
    ["write failed", () => ({ writeError: domError("NotAllowedError") }), () => M.saveFailed, true],
    ["permission denied", () => ({ permission: Promise.resolve("denied") }), () => M.saveDenied, true],
    ["file not found", () => ({ readLastModifiedError: domError("NotFoundError") }), () => M.saveNotFound, true],
    ["activation lost", () => ({ permission: rejected(domError("SecurityError")) }), () => M.saveActivationLost, true],
  ])("AT-UI-39 %s: toast text; still unsaved: %s", async (_name, makeOpts, message, stillDirty) => {
    await withDocument(makeOpts());
    openChanged();
    pointer(document.body, "pointerdown");
    const baseline = app.ui.documents.session;
    await app.ui.requestSave();
    expect(showToast).toHaveBeenCalledWith(message(), TOAST_MS);
    expect(isDirtyTitle()).toBe(stillDirty);
    if (stillDirty) expect(app.ui.documents.session).toBe(baseline);
  });

  it("AT-UI-65 a canceled save dialog shows no toast and stays unsaved", async () => {
    const picker = Promise.reject(domError("AbortError"));
    picker.catch(() => {});
    await withDocument({ picker });
    openChanged();
    pointer(document.body, "pointerdown");
    await app.ui.requestSaveAs();
    expect(showToast).not.toHaveBeenCalled();
    expect(isDirtyTitle()).toBe(true);
  });
});

describe("AT-UI-41 the save rows of 5.14.11", () => {
  it.each([
    ["Save (success)", {}, "requestSave", "withSaved", "same"],
    ["Save as (success)", {}, "requestSaveAs", "withSaved", "new"],
    ["download", { canWrite: false }, "requestSave", "same", "same"],
  ])("%s", async (_name, opts, method, sessionRow, locationRow) => {
    await withDocument(opts);
    openChanged();
    pointer(document.body, "pointerdown");
    expect(app.orchestrator.canUndo()).toBe(true);
    const before = { session: app.ui.documents.session, location: app.ui.documents.location };
    const reset = vi.spyOn(app.markdownRenderer, "resetExternalImageConsent");
    await app.ui[method]();
    if (sessionRow === "same") expect(app.ui.documents.session).toBe(before.session);
    else {
      expect(app.ui.documents.session).not.toBe(before.session);
      expect(app.ui.documents.session.documentId).toBe(before.session.documentId);
      expect(app.ui.documents.session.isBodyChanged(app.orchestrator.getBody())).toBe(false);
    }
    if (locationRow === "same") expect(app.ui.documents.location).toBe(before.location);
    else expect(app.ui.documents.location.fileName).toBe("picked.md");
    expect(reset).not.toHaveBeenCalled();
    expect(app.orchestrator.canUndo()).toBe(true);
  });
});

describe("AT-SSM 11-e save operation (27 cells), with UI stimuli", () => {
  it("AT-SSM-01 / 02 idle -> writingFile; while writing, Save and Save as are ignored (no second execute)", async () => {
    const permission = deferred();
    await withDocument({ permission: permission.promise });
    showPalette();
    const execute = vi.spyOn(app.ui.documents.saveDocument, "execute");
    const executeAs = vi.spyOn(app.ui.documents.saveDocumentAs, "execute");
    press(paletteButton("paletteSave"));
    expect(app.ui.documents.saveOperationState).toBe("writingFile");
    press(paletteButton("paletteSave"));
    press(paletteButton("paletteSaveAs"));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(executeAs).not.toHaveBeenCalled();
    permission.resolve("granted");
    await settle();
    expect(app.ui.documents.saveOperationState).toBe("idle");
    press(paletteButton("paletteSaveAs"));
    expect(executeAs).toHaveBeenCalledTimes(1);
    await settle();
  });

  it.each([
    ["AT-SSM-03 fileWritten", {}, "saved"],
    ["AT-SSM-04 downloadStarted", { canWrite: false }, "download"],
    ["AT-SSM-05 writeFailed", { writeError: domError("NotAllowedError") }, "failed"],
  ])("%s: writingFile -> idle", async (_name, opts) => {
    await withDocument(opts);
    const saving = app.ui.requestSave();
    expect(app.ui.documents.saveOperationState).toBe("writingFile");
    await saving;
    expect(app.ui.documents.saveOperationState).toBe("idle");
  });

  it("AT-SSM-06 saveCanceled: writingFile -> idle, no toast", async () => {
    const picker = Promise.reject(domError("AbortError"));
    picker.catch(() => {});
    await withDocument({ picker });
    await app.ui.requestSaveAs();
    expect(app.ui.documents.saveOperationState).toBe("idle");
    expect(showToast).not.toHaveBeenCalled();
  });

  it.each(["fileWritten", "downloadStarted", "writeFailed", "saveCanceled"])("AT-SSM-03..06 documents.finishSave(%s) in idle returns null and changes nothing", async (event) => {
    await withDocument();
    const session = app.ui.documents.session;
    const result = app.ui.documents.finishSave({ status: { fileWritten: "saved", downloadStarted: "downloadStarted", writeFailed: "failed", saveCanceled: "canceled" }[event], documentId: session.documentId, session: { documentId: session.documentId }, location: null, message: "x" });
    expect(result).toBeNull();
    expect(app.ui.documents.session).toBe(session);
    expect(app.ui.documents.saveOperationState).toBe("idle");
  });

  it("AT-SSM-03..06 through the UI: a save outcome that comes in idle shows no toast and changes nothing", async () => {
    const permission = deferred();
    await withDocument({ permission: permission.promise });
    const saving = app.ui.requestSave();
    // the save state goes back to idle before the use case settles (white box: another outcome)
    app.ui.documents.finishSave({ status: "failed", documentId: app.ui.documents.session.documentId, session: app.ui.documents.session, location: app.ui.documents.location, message: null });
    const session = app.ui.documents.session;
    permission.resolve("granted");
    await saving;
    expect(access.writes).toHaveLength(1); // the file was written, but its outcome came in idle
    expect(showToast).not.toHaveBeenCalled();
    expect(app.ui.documents.session).toBe(session);
    expect(app.ui.documents.saveOperationState).toBe("idle");
  });

  const REPLACES = [
    [".md drop", async () => { document.dispatchEvent(dropEvent(new File(["# N\n"], "n.md"), null)); await settle(); }],
    ["non-.md drop", async () => { document.dispatchEvent(dropEvent(new File(["x"], "a.py"), null)); await settle(); }],
    ["Reload", async () => app.ui.handleReload()],
    ["initial paste (entry point)", async () => app.ui._startPastedDocument("# P\n", "light")],
    ["initial #editor render (entry point)", async () => app.ui._startPastedDocument("# R\n", "dark")],
    ["empty document (entry point)", async () => app.ui._startEmptyDocument()],
    ["Clear", async () => keydown(document.body, "c")],
  ];

  it.each(REPLACES)("AT-SSM-07 writingFile: %s is refused with savingInProgress (INV-54)", async (_name, act) => {
    const permission = deferred();
    await withDocument({ permission: permission.promise });
    typeInEditor(app.elements.editor.value + "x\n");
    const saving = app.ui.requestSave();
    const { session, location } = { session: app.ui.documents.session, location: app.ui.documents.location };
    const model = app.orchestrator.getModel();
    await act();
    expect(showToast).toHaveBeenCalledWith(M.savingInProgress, TOAST_MS);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(app.ui.documents.session).toBe(session);
    expect(app.ui.documents.location).toBe(location);
    expect(app.orchestrator.getModel()).toBe(model);
    expect(app.orchestrator.isPreRenderState()).toBe(false);
    permission.resolve("granted");
    await saving;
  });

  it.each([
    ["l (theme / render from #editor)", () => keydown(document.body, "l")],
    ["d (theme / render from #editor)", () => keydown(document.body, "d")],
  ])("AT-SSM-07 writingFile: %s is not refused", async (_name, act) => {
    const permission = deferred();
    await withDocument({ permission: permission.promise });
    const saving = app.ui.requestSave();
    const rerender = vi.spyOn(app.orchestrator, "reRender");
    act();
    expect(rerender).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalledWith(M.savingInProgress, TOAST_MS);
    permission.resolve("granted");
    await saving;
  });

  it("AT-SSM-07 writingFile: a Save as that finishes right after Reload read the file still refuses the Reload (INV-54; the read and the checks are one synchronous step)", async () => {
    const picker = deferred();
    await withDocument({ picker: picker.promise });
    const saving = app.ui.requestSaveAs();
    expect(app.ui.documents.saveOperationState).toBe("writingFile");
    const read = deferred();
    access.readFile = () => read.promise;
    const reloading = app.ui.handleReload();
    const body = app.orchestrator.getBody();
    const session = app.ui.documents.session;
    // the Save as outcome comes in the same turn, in the microtask right after the read settles
    read.resolve({ bytesHead: new Uint8Array([35, 32, 79]), text: "# Old file\n", lastModified: 500 });
    void Promise.resolve().then(() => {
      const picked = fakeFileHandle({ name: "picked.md" });
      app.ui.documents.finishSave({
        status: "saved",
        documentId: session.documentId,
        session: session.withSaved(body, 3000),
        location: { fileName: "picked.md", fileHandle: picked },
        message: M.saved("picked.md"),
      });
    });
    await reloading;
    expect(showToast).toHaveBeenCalledWith(M.savingInProgress, TOAST_MS);
    expect(app.orchestrator.getBody()).toBe(body);
    expect(app.elements.editor.value).not.toContain("Old file");
    expect(app.ui.documents.location.fileName).toBe("picked.md"); // the save itself was applied
    picker.resolve(fakeFileHandle({ name: "picked.md" }));
    await saving;
  });

  it.each(REPLACES)("AT-SSM-09 pushing: %s is refused with savingInProgress (INV-54, INV-88 (4))", async (_name, act) => {
    await withDocument();
    app.ui.documents._saveOperationState = "pushing"; // white box: a push in flight (GitHubController starts it)
    const { session, location } = { session: app.ui.documents.session, location: app.ui.documents.location };
    const model = app.orchestrator.getModel();
    await act();
    expect(showToast).toHaveBeenCalledWith(M.savingInProgress, TOAST_MS);
    expect(app.ui.documents.session).toBe(session);
    expect(app.ui.documents.location).toBe(location);
    expect(app.orchestrator.getModel()).toBe(model);
    expect(app.ui.documents.saveOperationState).toBe("pushing");
  });

  it("AT-SSM-09 pushing: Save and Save as are ignored (no execute, no state change)", async () => {
    await withDocument();
    showPalette();
    app.ui.documents._saveOperationState = "pushing";
    const execute = vi.spyOn(app.ui.documents.saveDocument, "execute");
    const executeAs = vi.spyOn(app.ui.documents.saveDocumentAs, "execute");
    press(paletteButton("paletteSave"));
    press(paletteButton("paletteSaveAs"));
    await app.ui.requestSave();
    expect(execute).not.toHaveBeenCalled();
    expect(executeAs).not.toHaveBeenCalled();
    expect(app.ui.documents.saveOperationState).toBe("pushing");
  });

  it("AT-SSM-07 idle: a replace is not refused (the save machine is not involved)", async () => {
    await withDocument();
    keydown(document.body, "c");
    expect(app.orchestrator.isPreRenderState()).toBe(true);
    expect(showToast).not.toHaveBeenCalledWith(M.savingInProgress, TOAST_MS);
  });

  it("AT-SSM-08 the saveOperationStateMachine definition matches the 27 cells", () => {
    const I = "idle";
    const W = "writingFile";
    const P = "pushing";
    const TABLE = {
      saveRequested: { [I]: [W, ["startPermissionRequest", "commitOpenBlock", "applyEditorText", "runSaveDocument"]], [W]: null, [P]: null },
      saveAsRequested: { [I]: [W, ["startSavePicker", "commitOpenBlock", "applyEditorText", "runSaveDocumentAs"]], [W]: null, [P]: null },
      fileWritten: { [I]: null, [W]: [I, ["applyOutcomeIfSameDocument", "refreshDirtyMark", "showSavedToast"]], [P]: null },
      downloadStarted: { [I]: null, [W]: [I, ["showDownloadStartedToast"]], [P]: null },
      writeFailed: { [I]: null, [W]: [I, ["showErrorToast"]], [P]: null },
      saveCanceled: { [I]: null, [W]: [I, []], [P]: null },
      replaceRequested: { [I]: null, [W]: [W, ["rejectReplace", "showSavingToast"]], [P]: [P, ["rejectReplace", "showSavingToast"]] },
      pushRequested: { [I]: [P, ["runPush"]], [W]: null, [P]: null },
      pushFinished: { [I]: null, [W]: null, [P]: [I, ["applyPushIfSameDocument", "refreshDirtyMark", "showPushedToast"]] },
    };
    expect(Object.keys(saveOperationStateMachine).sort()).toEqual(Object.keys(TABLE).sort());
    for (const [event, row] of Object.entries(TABLE)) {
      expect(Object.keys(saveOperationStateMachine[event]).sort(), event).toEqual([I, P, W].sort());
      for (const state of [I, W, P]) {
        const def = saveOperationStateMachine[event][state];
        if (row[state] === null) expect(def, `${event} x ${state}`).toBeNull();
        else {
          expect(def.to, `${event} x ${state}`).toBe(row[state][0]);
          expect(def.actions, `${event} x ${state}`).toEqual(row[state][1]);
        }
      }
    }
  });
});

describe("the handwritten save steps follow the 11-e action names", () => {
  // commitOpenBlock runs only with an open block editor; applyEditorText only
  // with unrendered #editor text (a commit's onModelChanged already took #editor in).
  const CONDITIONAL = new Set(["commitOpenBlock", "applyEditorText"]);

  it.each([
    ["saveRequested", "paletteSave", "open block editor"],
    ["saveRequested", "paletteSave", "unrendered #editor"],
    ["saveAsRequested", "paletteSaveAs", "open block editor"],
    ["saveAsRequested", "paletteSaveAs", "unrendered #editor"],
  ])("%s (%s, with an %s): the observed steps are the cell's actions, in order", async (event, button, condition) => {
    const permission = deferred();
    await withDocument({ permission: permission.promise });
    if (condition === "open block editor") openChanged();
    else {
      showPalette();
      typeInEditor(app.elements.editor.value + "typed\n");
    }
    const steps = [];
    const original = { ...access };
    access.startPermissionRequest = (h) => (steps.push("startPermissionRequest"), original.startPermissionRequest.call(access, h));
    access.startSavePicker = (n) => (steps.push("startSavePicker"), original.startSavePicker.call(access, n));
    vi.spyOn(app.orchestrator, "commitBlock").mockImplementation(function (...args) {
      steps.push("commitOpenBlock");
      return Object.getPrototypeOf(app.orchestrator).commitBlock.apply(app.orchestrator, args);
    });
    vi.spyOn(app.ui, "_takeEditorIntoModel").mockImplementation(function (...args) {
      steps.push("applyEditorText");
      return Object.getPrototypeOf(app.ui)._takeEditorIntoModel.apply(app.ui, args);
    });
    vi.spyOn(app.ui.documents.saveDocument, "execute").mockImplementation(() => (steps.push("runSaveDocument"), new Promise(() => {})));
    vi.spyOn(app.ui.documents.saveDocumentAs, "execute").mockImplementation(() => (steps.push("runSaveDocumentAs"), new Promise(() => {})));
    press(paletteButton(button));
    const expected = saveOperationStateMachine[event].idle.actions.filter((a) => !CONDITIONAL.has(a) || steps.includes(a));
    expect(steps).toEqual(expected);
    expect(steps.some((a) => CONDITIONAL.has(a))).toBe(true);
  });
});

describe("AT-BSM-09 / 10 Save and Save as while editing commit the open block", () => {
  it.each(["paletteSave", "paletteSaveAs"])("%s: editingBlock -> editModeIdle, committed text is saved", async (button) => {
    await withDocument();
    openChanged();
    press(paletteButton(button));
    expect(app.ui.blockEdit.isEditing()).toBe(false);
    expect(app.ui.palette.isShown()).toBe(true);
    await settle();
    expect(access.writes[0].text).toContain("Changed A.");
  });
});
