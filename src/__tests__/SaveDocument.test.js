import { describe, it, expect, vi, afterEach } from "vitest";
import SaveDocument from "../js/classes/SaveDocument.js";
import SaveDocumentAs from "../js/classes/SaveDocumentAs.js";
import DocumentSession from "../js/classes/DocumentSession.js";
import DocumentLocation from "../js/classes/DocumentLocation.js";
import { CONFIG } from "../js/config.js";
import { fakeFileAccess, fakeFileHandle, deferred, domError } from "./helpers/fakeFs.js";

const M = CONFIG.messages.edit;
const BOM = String.fromCharCode(0xfeff);

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(opts = {}) {
  const access = fakeFileAccess(opts);
  const save = new SaveDocument(access, M, CONFIG.edit.defaultFileName);
  const saveAs = new SaveDocumentAs(access, M, CONFIG.edit.defaultFileName);
  return { access, save, saveAs };
}

function fileSession(text = "# Doc\n", lastModified = 1000, id = 9) {
  return DocumentSession.fromFileText(text, false, lastModified, id);
}

function request(over = {}) {
  const handle = over.handle === undefined ? fakeFileHandle({ name: "doc.md" }) : over.handle;
  return {
    session: over.session ?? fileSession(),
    location: over.location ?? new DocumentLocation(handle ? handle.name : null, handle),
    bodyText: over.bodyText ?? "# Doc changed\n",
    permissionOrPicker: over.permissionOrPicker ?? Promise.resolve("granted"),
    confirmer: over.confirmer ?? { confirmOverwrite: vi.fn().mockResolvedValue(true) },
  };
}

describe("SaveDocument / SaveDocumentAs (UseCase)", () => {
  it("AT-SAVE-01 Save: permission granted and no external change -> writes, saved, new session, same location", async () => {
    const { access, save } = setup({ lastModified: 1000, writtenLastModified: 2000 });
    const req = request();
    const out = await save.execute(req);
    expect(req.confirmer.confirmOverwrite).not.toHaveBeenCalled();
    expect(access.writes).toEqual([{ handle: req.location.fileHandle, text: "# Doc changed\n" }]);
    expect(out.status).toBe("saved");
    expect(out.documentId).toBe(9);
    expect(out.session.baselineBodyText).toBe("# Doc changed\n");
    expect(out.session.baselineLastModified).toBe(2000);
    expect(out.location).toBe(req.location);
    expect(out.message).toBe(M.saved("doc.md"));
  });

  it("AT-SAVE-02 external change + Cancel -> not written, canceled, same session", async () => {
    const { access, save } = setup({ lastModified: 1500 });
    const req = request({ confirmer: { confirmOverwrite: vi.fn().mockResolvedValue(false) } });
    const out = await save.execute(req);
    expect(req.confirmer.confirmOverwrite).toHaveBeenCalledTimes(1);
    expect(access.writes).toEqual([]);
    expect(out.status).toBe("canceled");
    expect(out.session).toBe(req.session);
  });

  it("AT-SAVE-03 external change + OK -> written, saved", async () => {
    const { access, save } = setup({ lastModified: 1500 });
    const out = await save.execute(request());
    expect(access.writes).toHaveLength(1);
    expect(out.status).toBe("saved");
  });

  it("AT-SAVE-04 permission denied -> failed with saveDenied, nothing written", async () => {
    const { access, save } = setup();
    const req = request({ permissionOrPicker: Promise.resolve("denied") });
    const out = await save.execute(req);
    expect(out).toMatchObject({ status: "failed", message: M.saveDenied });
    expect(out.session).toBe(req.session);
    expect(access.writes).toEqual([]);
  });

  it("AT-SAVE-05 the file is gone (NotFoundError) -> failed with saveNotFound", async () => {
    const { save } = setup({ readLastModifiedError: domError("NotFoundError") });
    const out = await save.execute(request());
    expect(out).toMatchObject({ status: "failed", message: M.saveNotFound });
  });

  it("AT-SAVE-06 write error -> failed with saveFailed, same session", async () => {
    const { save } = setup({ writeError: new Error("disk") });
    const req = request();
    const out = await save.execute(req);
    expect(out).toMatchObject({ status: "failed", message: M.saveFailed });
    expect(out.session).toBe(req.session);
  });

  it("AT-SAVE-07 permission rejected with SecurityError (activation lost) -> failed with saveActivationLost", async () => {
    const { save } = setup();
    const out = await save.execute(request({ permissionOrPicker: Promise.reject(domError("SecurityError")) }));
    expect(out).toMatchObject({ status: "failed", message: M.saveActivationLost });
  });

  it("AT-SAVE-08 Save without a file handle behaves like Save as (uses the picker promise)", async () => {
    const { access, save } = setup();
    const picked = fakeFileHandle({ name: "chosen.md" });
    const req = request({
      handle: null,
      location: new DocumentLocation(null, null),
      permissionOrPicker: Promise.resolve(picked),
    });
    const out = await save.execute(req);
    expect(access.calls).not.toContain("readLastModified");
    expect(access.writes[0].handle).toBe(picked);
    expect(out.status).toBe("saved");
    expect(out.location.fileHandle).toBe(picked);
    expect(out.location.fileName).toBe("chosen.md");
  });

  it("AT-SAVE-09 no write API -> download started synchronously; baseline and location do not change (INV-26)", () => {
    const { access, saveAs } = setup({ canWrite: false });
    const req = request({ location: new DocumentLocation("doc.md", null) });
    const pending = saveAs.execute(req);
    expect(access.downloads).toEqual([{ name: "doc.md", text: "# Doc changed\n" }]);
    return pending.then((out) => {
      expect(out.status).toBe("downloadStarted");
      expect(out.session).toBe(req.session);
      expect(out.location).toBe(req.location);
      expect(out.message).toBe(M.downloadStarted("doc.md"));
    });
  });

  it("AT-SAVE-09 Save (not Save as) also downloads when there is no write API", async () => {
    const { access, save } = setup({ canWrite: false });
    const req = request();
    const out = await save.execute(req);
    expect(access.downloads).toHaveLength(1);
    expect(out.status).toBe("downloadStarted");
    expect(out.session.baselineBodyText).toBe(req.session.baselineBodyText);
  });

  it("AT-SAVE-10 Save as writes to the picked file and returns it as the new location (INV-55)", async () => {
    const { access, saveAs } = setup({ writtenLastModified: 3000 });
    const picked = fakeFileHandle({ name: "copy.md" });
    const req = request({ permissionOrPicker: Promise.resolve(picked) });
    const out = await saveAs.execute(req);
    expect(access.writes[0].handle).toBe(picked);
    expect(out.status).toBe("saved");
    expect(out.location).toBeInstanceOf(DocumentLocation);
    expect(out.location.fileHandle).toBe(picked);
    expect(out.location.fileName).toBe("copy.md");
    expect(out.session.baselineLastModified).toBe(3000);
    expect(out.message).toBe(M.saved("copy.md"));
  });

  it("AT-SAVE-11 a canceled picker (AbortError) -> canceled, no message", async () => {
    const { saveAs } = setup();
    const out = await saveAs.execute(request({ permissionOrPicker: Promise.reject(domError("AbortError")) }));
    expect(out.status).toBe("canceled");
    expect(out.message).toBe(null);
  });

  it("AT-SAVE-12 without a location or a name, the download name is untitled.md", async () => {
    const { access, saveAs } = setup({ canWrite: false });
    await saveAs.execute(request({ handle: null, location: new DocumentLocation(null, null) }));
    expect(access.downloads[0].name).toBe("untitled.md");
  });

  it("AT-SAVE-13 the outcome carries the document id of the request's session (INV-54)", async () => {
    const { save, saveAs } = setup();
    const req = request({ session: fileSession("x", 1000, 41) });
    expect((await save.execute(req)).documentId).toBe(41);
    expect((await saveAs.execute(request({ session: fileSession("x", 1, 42), permissionOrPicker: Promise.resolve(fakeFileHandle()) }))).documentId).toBe(42);
  });

  it("AT-SAVE-14 the use cases never touch the UI directly (confirm only through the port)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const create = vi.spyOn(document, "createElement");
    const { save, saveAs } = setup({ lastModified: 5555 });
    await save.execute(request());
    await saveAs.execute(request({ permissionOrPicker: Promise.resolve(fakeFileHandle()) }));
    expect(confirm).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("AT-SAVE-15 restores CRLF, BOM and the wrapper for a file; writes only the body for a pasted document", async () => {
    const { access, save, saveAs } = setup({ lastModified: 1000 });
    const original = "```markdown\r\n# T\r\n```\r\n";
    const session = DocumentSession.fromFileText(original, true, 1000, 1);
    await save.execute(request({ session, bodyText: session.getBodyText() }));
    expect(access.writes[0].text).toBe(BOM + original);
    const pasted = DocumentSession.fromPastedText("# T", 2);
    await saveAs.execute(request({ session: pasted, bodyText: "# T", permissionOrPicker: Promise.resolve(fakeFileHandle()) }));
    expect(access.writes[1].text).toBe("# T");
  });

  it("AT-SAVE-16 nothing is read or written before the permission promise resolves (INV-33)", async () => {
    const { access, save } = setup();
    const perm = deferred();
    const pending = save.execute(request({ permissionOrPicker: perm.promise }));
    await Promise.resolve();
    await Promise.resolve();
    expect(access.calls).toEqual([]);
    perm.resolve("granted");
    await pending;
    expect(access.calls).toEqual(["readLastModified", "writeFile:doc.md"]);
  });

  it("AT-SAVE-17 a 6 MB body can be saved (no size limit on save)", async () => {
    const { access, save } = setup();
    const big = "0123456789\n".repeat(600000);
    const out = await save.execute(request({ bodyText: big }));
    expect(out.status).toBe("saved");
    expect(access.writes[0].text.length).toBe(big.length);
  });

  it("AT-SAVE-18 Save as: picker rejected with SecurityError -> failed, saveActivationLost, nothing changes", async () => {
    const { saveAs } = setup();
    const req = request({ permissionOrPicker: Promise.reject(domError("SecurityError")) });
    const out = await saveAs.execute(req);
    expect(out).toMatchObject({ status: "failed", message: M.saveActivationLost });
    expect(out.session).toBe(req.session);
    expect(out.location).toBe(req.location);
  });

  it("AT-SAVE-19 Save as: write fails after picking -> failed, session and location unchanged", async () => {
    const { saveAs } = setup({ writeError: new Error("disk") });
    const req = request({ permissionOrPicker: Promise.resolve(fakeFileHandle({ name: "new.md" })) });
    const out = await saveAs.execute(req);
    expect(out).toMatchObject({ status: "failed", message: M.saveFailed });
    expect(out.session).toBe(req.session);
    expect(out.location).toBe(req.location);
  });

  it("AT-SAVE-20 after a successful save, the next save sees no external change", async () => {
    const access = fakeFileAccess({ lastModified: 1000, writtenLastModified: 2000 });
    const save = new SaveDocument(access, M, CONFIG.edit.defaultFileName);
    const confirmer = { confirmOverwrite: vi.fn().mockResolvedValue(true) };
    const first = await save.execute(request({ confirmer }));
    // The file now reports the time written by the first save.
    const access2 = fakeFileAccess({ lastModified: 2000 });
    const save2 = new SaveDocument(access2, M, CONFIG.edit.defaultFileName);
    await save2.execute(request({ session: first.session, location: first.location, confirmer }));
    expect(confirmer.confirmOverwrite).not.toHaveBeenCalled();
  });
});
