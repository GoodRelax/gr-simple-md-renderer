import { describe, it, expect, vi, afterEach } from "vitest";
import DocumentLifecycle, { saveOperationStateMachine } from "../js/classes/DocumentLifecycle.js";
import SaveDocument from "../js/classes/SaveDocument.js";
import SaveDocumentAs from "../js/classes/SaveDocumentAs.js";
import { CONFIG } from "../js/config.js";
import { fakeFileAccess, fakeFileHandle, deferred, domError } from "./helpers/fakeFs.js";

// AT-DLC: DocumentLifecycle without the UI (5.14.11, 11-e, INV-54, INV-55).
// The UI steps of a save are a fake SaveSteps that records its calls.

const M = CONFIG.messages.edit;
const NAME = CONFIG.edit.defaultFileName;
const BOM_BYTES = new Uint8Array([0xef, 0xbb, 0xbf]);

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(opts = {}) {
  const access = fakeFileAccess(opts);
  const documents = new DocumentLifecycle(access, {
    saveDocument: new SaveDocument(access, M, NAME),
    saveDocumentAs: new SaveDocumentAs(access, M, NAME),
    messages: M,
    defaultFileName: NAME,
  });
  return { access, documents };
}

/** A fake SaveSteps; every call goes into `calls` (shared with the file access). */
function fakeSteps(calls, { confirm = true, body = "# Saved\n" } = {}) {
  return {
    confirmStart: vi.fn(() => (calls.push("confirmStart"), confirm)),
    commitEdits: vi.fn((event) => calls.push(`commitEdits:${event}`)),
    getBody: vi.fn(() => (calls.push("getBody"), body)),
    confirmer: { confirmOverwrite: vi.fn().mockResolvedValue(true) },
    onFinished: vi.fn(),
  };
}

function loaded(text, { bom = false, lastModified = 7000 } = {}) {
  return { bytesHead: bom ? BOM_BYTES : new Uint8Array([35, 32, 65]), text, lastModified };
}

describe("AT-DLC DocumentLifecycle: the rows of 5.14.11", () => {
  it("AT-DLC-01 a new lifecycle has no session, no target, idle; the name is the default", () => {
    const { documents } = setup();
    expect(documents.session).toBeNull();
    expect(documents.location).toBeNull();
    expect(documents.hasSession()).toBe(false);
    expect(documents.saveOperationState).toBe("idle");
    expect(documents.isSaving()).toBe(false);
    expect(documents.fileName()).toBe(NAME);
    expect(documents.isBodyChanged("anything")).toBe(false);
  });

  it("AT-DLC-02 .md drop: fromFileText (wrapper, line ending, BOM) and the file's name and handle", () => {
    const { documents } = setup();
    const handle = fakeFileHandle({ name: "a.md" });
    documents.openFile("```markdown\r\n# A\r\n```", true, 5000, "a.md", handle);
    const s = documents.session;
    expect(s.getBodyText()).toBe("# A");
    expect(s.wrapperPrefix).toBe("```markdown\n");
    expect(s.lineEnding).toBe("\r\n");
    expect(s.hasBom).toBe(true);
    expect(s.baselineLastModified).toBe(5000);
    expect(documents.location.fileName).toBe("a.md");
    expect(documents.location.fileHandle).toBe(handle);
    expect(documents.fileName()).toBe("a.md");
    expect(documents.isBodyChanged("# A")).toBe(false);
    expect(documents.isBodyChanged("# B")).toBe(true);
  });

  it("AT-DLC-03 Reload: a new session (BOM and line ending read again), the same target value", () => {
    const { documents } = setup();
    documents.openFile("# A\n", false, 1000, "a.md", fakeFileHandle({ name: "a.md" }));
    const location = documents.location;
    const oldId = documents.session.documentId;
    documents.reload(loaded("# B\r\n", { bom: true, lastModified: 7000 }));
    expect(documents.session.documentId).toBeGreaterThan(oldId);
    expect(documents.session.getBodyText()).toBe("# B\n");
    expect(documents.session.hasBom).toBe(true);
    expect(documents.session.lineEnding).toBe("\r\n");
    expect(documents.session.baselineLastModified).toBe(7000);
    expect(documents.location).toBe(location);
  });

  it("AT-DLC-04 paste / initial render / empty document: fromPastedText, no target", () => {
    const { documents } = setup();
    documents.openFile("# A\n", false, 1000, "a.md", null);
    documents.startPasted("# P\n");
    expect(documents.session.getBodyText()).toBe("# P\n");
    expect(documents.session.lineEnding).toBe("\n");
    expect(documents.session.hasBom).toBe(false);
    expect(documents.session.baselineLastModified).toBeNull();
    expect(documents.location).toBeNull();
    expect(documents.fileName()).toBe(NAME);
    documents.startPasted("");
    expect(documents.session.getBodyText()).toBe("");
  });

  it("AT-DLC-05 Clear / non-.md drop: no session, no target; not changed", () => {
    const { documents } = setup();
    documents.openFile("# A\n", false, 1000, "a.md", null);
    documents.close();
    expect(documents.session).toBeNull();
    expect(documents.location).toBeNull();
    expect(documents.isBodyChanged("# other")).toBe(false);
  });

  it("AT-DLC-06 one document id counter for every rebuild, always increasing", () => {
    const { documents } = setup();
    const ids = [];
    documents.startPasted("a");
    ids.push(documents.session.documentId);
    documents.openFile("b", false, 1, "b.md", null);
    ids.push(documents.session.documentId);
    documents.reload(loaded("c"));
    ids.push(documents.session.documentId);
    documents.close();
    documents.startPasted("");
    ids.push(documents.session.documentId);
    expect(ids).toEqual([1, 2, 3, 4]);
  });
});

describe("AT-DLC Reload: reloadTarget / readFile / isStale (INV-21 Reload order: read first)", () => {
  it("AT-DLC-07 no target, or a target without a handle: reloadTarget is null; else the target and the document id", () => {
    const { documents } = setup();
    expect(documents.reloadTarget()).toBeNull();
    documents.openFile("# A\n", false, 1, "a.md", null);
    expect(documents.reloadTarget()).toBeNull();
    const handle = fakeFileHandle({ name: "b.md" });
    documents.openFile("# B\n", false, 1, "b.md", handle);
    expect(documents.reloadTarget()).toEqual({ location: documents.location, documentId: documents.session.documentId });
    expect(documents.reloadTarget().location.fileHandle).toBe(handle);
  });

  it("AT-DLC-08 readFile returns the file access's promise as it is, with the open check passed on (INV-18 on Reload); a read error rejects it, the session stays", async () => {
    const { access, documents } = setup();
    documents.openFile("# A\n", false, 1, "a.md", fakeFileHandle({ getFileError: domError("NotReadableError") }));
    const session = documents.session;
    const gate = deferred();
    const spy = vi.spyOn(access, "readFile").mockReturnValue(gate.promise);
    const target = documents.reloadTarget();
    const check = () => undefined;
    expect(documents.readFile(target, check)).toBe(gate.promise); // no await in between (one step for the caller)
    expect(spy).toHaveBeenCalledWith(target.location.fileHandle, check);
    spy.mockRestore();
    await expect(documents.readFile(target)).rejects.toThrow();
    expect(documents.session).toBe(session);
  });

  it("AT-DLC-09 read: the file's bytes, text and time; not stale when nothing changed; nothing replaced yet", async () => {
    const { documents } = setup();
    const handle = fakeFileHandle({ content: ["# New\n"], lastModified: 9000 });
    documents.openFile("# A\n", false, 1, "a.md", handle);
    const session = documents.session;
    const target = documents.reloadTarget();
    const read = await documents.readFile(target);
    expect(read.text).toBe("# New\n");
    expect(read.lastModified).toBe(9000);
    expect(documents.isStale(target)).toBe(false);
    expect(documents.session).toBe(session);
  });

  it.each([
    ["the document was rebuilt", (d) => d.startPasted("# P\n")],
    ["the document was cleared", (d) => d.close()],
    ["another file was dropped", (d) => d.openFile("# B\n", false, 1, "b.md", fakeFileHandle())],
    ["another Reload finished (same target, new id)", (d) => d.reload(loaded("# R\n"))],
    [
      "the save target changed (a Save as finished; white box: its state)",
      (d) => {
        d._saveOperationState = "writingFile";
        d.finishSave({ status: "saved", documentId: d.session.documentId, session: d.session, location: { fileName: "x.md" }, message: "m" });
      },
    ],
  ])("AT-DLC-10 %s while the file was read: stale", async (_name, change) => {
    const { access, documents } = setup();
    documents.openFile("# A\n", false, 1, "a.md", fakeFileHandle());
    const gate = deferred();
    vi.spyOn(access, "readFile").mockReturnValue(gate.promise);
    const target = documents.reloadTarget();
    const reading = documents.readFile(target);
    change(documents);
    gate.resolve(loaded("# X\n"));
    await reading;
    expect(documents.isStale(target)).toBe(true);
  });
});

describe("AT-DLC save (11-e, INV-33, INV-54)", () => {
  it("AT-DLC-11 Save with a target: confirmStart -> permission -> commitEdits -> getBody -> execute, synchronously", () => {
    const { access, documents } = setup({ permission: new Promise(() => {}) });
    documents.openFile("# A\n", false, 1000, "a.md", fakeFileHandle({ name: "a.md" }));
    const execute = vi.spyOn(documents.saveDocument, "execute").mockImplementation(() => (access.calls.push("execute"), new Promise(() => {})));
    const steps = fakeSteps(access.calls);
    void documents.save("saveRequested", steps);
    expect(access.calls).toEqual(["confirmStart", "startPermissionRequest", "commitEdits:saveRequested", "getBody", "execute"]);
    expect(documents.saveOperationState).toBe("writingFile");
    expect(documents.isSaving()).toBe(true);
    const request = execute.mock.calls[0][0];
    expect(request.session).toBe(documents.session);
    expect(request.location).toBe(documents.location);
    expect(request.bodyText).toBe("# Saved\n");
    expect(request.confirmer).toBe(steps.confirmer);
  });

  it("AT-DLC-12 Save without a target and Save as: the save dialog with the name, a default target", () => {
    const { access, documents } = setup({ picker: new Promise(() => {}) });
    documents.startPasted("# P\n");
    const execute = vi.spyOn(documents.saveDocument, "execute").mockReturnValue(new Promise(() => {}));
    void documents.save("saveRequested", fakeSteps(access.calls));
    expect(access.calls[1]).toBe(`startSavePicker:${NAME}`);
    expect(execute.mock.calls[0][0].location.fileName).toBe(NAME);
    expect(execute.mock.calls[0][0].location.fileHandle).toBeNull();

    const other = setup({ picker: new Promise(() => {}) });
    other.documents.openFile("# A\n", false, 1, "a.md", fakeFileHandle({ name: "a.md" }));
    const executeAs = vi.spyOn(other.documents.saveDocumentAs, "execute").mockReturnValue(new Promise(() => {}));
    void other.documents.save("saveAsRequested", fakeSteps(other.access.calls));
    expect(other.access.calls).toEqual(["confirmStart", "startSavePicker:a.md", "commitEdits:saveAsRequested", "getBody"]);
    expect(executeAs).toHaveBeenCalledTimes(1);
  });

  it("AT-DLC-13 no write API: no access is started (download inside the use case)", async () => {
    const { access, documents } = setup({ canWrite: false });
    documents.startPasted("# P\n");
    const steps = fakeSteps(access.calls);
    await documents.save("saveRequested", steps);
    expect(access.calls).toEqual(["confirmStart", "commitEdits:saveRequested", "getBody", `startDownload:${NAME}`]);
    expect(steps.onFinished).toHaveBeenCalledWith({ applied: false, message: M.downloadStarted(NAME) });
    expect(documents.saveOperationState).toBe("idle");
  });

  it("AT-DLC-14 ignored: no session, or a press while writing; no step is called", () => {
    const { access, documents } = setup({ permission: new Promise(() => {}) });
    const steps = fakeSteps(access.calls);
    void documents.save("saveRequested", steps);
    expect(access.calls).toEqual([]);
    documents.openFile("# A\n", false, 1, "a.md", fakeFileHandle());
    vi.spyOn(documents.saveDocument, "execute").mockReturnValue(new Promise(() => {}));
    void documents.save("saveRequested", fakeSteps(access.calls));
    access.calls.length = 0;
    void documents.save("saveRequested", steps);
    void documents.save("saveAsRequested", steps);
    expect(access.calls).toEqual([]);
    expect(steps.confirmStart).not.toHaveBeenCalled();
  });

  it("AT-DLC-15 confirmStart false (INV-56 Cancel): nothing starts, the state stays idle", async () => {
    const { access, documents } = setup();
    documents.openFile("# A\n", false, 1, "a.md", fakeFileHandle());
    const steps = fakeSteps(access.calls, { confirm: false });
    await documents.save("saveRequested", steps);
    expect(access.calls).toEqual(["confirmStart"]);
    expect(steps.onFinished).not.toHaveBeenCalled();
    expect(documents.saveOperationState).toBe("idle");
  });

  it("AT-DLC-16 saved: the new session and target for the same document; onFinished(applied, Saved)", async () => {
    const { access, documents } = setup({ lastModified: 1000, writtenLastModified: 2000 });
    const handle = fakeFileHandle({ name: "a.md", calls: access.calls });
    documents.openFile("# A\n", false, 1000, "a.md", handle);
    const id = documents.session.documentId;
    const location = documents.location;
    const steps = fakeSteps(access.calls, { body: "# A2\n" });
    await documents.save("saveRequested", steps);
    expect(steps.onFinished).toHaveBeenCalledTimes(1);
    expect(steps.onFinished).toHaveBeenCalledWith({ applied: true, message: M.saved("a.md") });
    expect(documents.session.documentId).toBe(id);
    expect(documents.session.baselineLastModified).toBe(2000);
    expect(documents.isBodyChanged("# A2\n")).toBe(false);
    expect(documents.location).toBe(location);
    expect(documents.saveOperationState).toBe("idle");
  });

  it("AT-DLC-17 Save as: the picked file becomes the target", async () => {
    const { access, documents } = setup();
    documents.startPasted("# P\n");
    await documents.save("saveAsRequested", fakeSteps(access.calls));
    expect(documents.location.fileName).toBe("picked.md");
    expect(documents.fileName()).toBe("picked.md");
  });

  it("AT-DLC-18 INV-54: the outcome of another document changes nothing but is still told", async () => {
    const permission = deferred();
    const { access, documents } = setup({ permission: permission.promise });
    documents.openFile("# A\n", false, 1000, "a.md", fakeFileHandle({ name: "a.md" }));
    const steps = fakeSteps(access.calls);
    const saving = documents.save("saveRequested", steps);
    // the document is rebuilt meanwhile (the UI refuses it while writing; white box here)
    documents.startPasted("# Other\n");
    const other = documents.session;
    permission.resolve("granted");
    await saving;
    expect(documents.session).toBe(other);
    expect(documents.location).toBeNull();
    expect(steps.onFinished).toHaveBeenCalledWith({ applied: false, message: M.saved("a.md") });
  });

  it("AT-DLC-19 a use case that throws: failed with saveFailed, back to idle", async () => {
    const { access, documents } = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    documents.openFile("# A\n", false, 1000, "a.md", fakeFileHandle());
    const session = documents.session;
    vi.spyOn(documents.saveDocument, "execute").mockRejectedValue(new Error("boom"));
    const steps = fakeSteps(access.calls);
    await documents.save("saveRequested", steps);
    expect(steps.onFinished).toHaveBeenCalledWith({ applied: false, message: M.saveFailed });
    expect(documents.session).toBe(session);
    expect(documents.saveOperationState).toBe("idle");
  });

  it("AT-DLC-20 canceled: no message, nothing applied", async () => {
    const picker = Promise.reject(domError("AbortError"));
    picker.catch(() => {});
    const { access, documents } = setup({ picker });
    documents.startPasted("# P\n");
    const steps = fakeSteps(access.calls);
    await documents.save("saveAsRequested", steps);
    expect(steps.onFinished).toHaveBeenCalledWith({ applied: false, message: null });
    expect(documents.saveOperationState).toBe("idle");
  });

  it.each(["saved", "downloadStarted", "failed", "canceled"])("AT-DLC-21 finishSave(%s) in idle: null, nothing changes", (status) => {
    const { documents } = setup();
    documents.startPasted("# P\n");
    const session = documents.session;
    const result = documents.finishSave({ status, documentId: session.documentId, session: { documentId: session.documentId }, location: null, message: "x" });
    expect(result).toBeNull();
    expect(documents.session).toBe(session);
    expect(documents.saveOperationState).toBe("idle");
  });

  it("AT-DLC-23 a dropped .md file is noted for the next save dialog's folder (INV-79)", () => {
    const { access, documents } = setup();
    const handle = fakeFileHandle({ name: "dropped.md" });
    documents.openFile("# A\n", false, 1, "dropped.md", handle);
    expect(access.noted).toEqual([handle]);
    documents.openFile("# B\n", false, 1, "pasted.md", null); // noteFile ignores null
    expect(access.noted).toEqual([handle, null]);
  });

  it("AT-DLC-22 isSaving follows the replaceRequested cell of 11-e", () => {
    expect(saveOperationStateMachine.replaceRequested.idle).toBeNull();
    expect(saveOperationStateMachine.replaceRequested.writingFile.to).toBe("writingFile");
    const { documents } = setup();
    documents._saveOperationState = "writingFile";
    expect(documents.isSaving()).toBe(true);
  });
});
