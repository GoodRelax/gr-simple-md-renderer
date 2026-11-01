import { describe, it, expect, vi, afterEach, onTestFinished } from "vitest";
import MarkdownFileAccess from "../js/classes/MarkdownFileAccess.js";
import { CONFIG } from "../js/config.js";
import { fakeFileHandle, domError } from "./helpers/fakeFs.js";
import { withBom, toCrlf } from "./helpers/samples.js";

const BOM = String.fromCharCode(0xfeff);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("MarkdownFileAccess (Adapter: local file read/write, no network)", () => {
  it("AT-FA-01 canWriteInPlace is true only when showSaveFilePicker is a function", () => {
    expect(new MarkdownFileAccess({ showSaveFilePicker: () => {} }).canWriteInPlace()).toBe(true);
    expect(new MarkdownFileAccess({ showSaveFilePicker: undefined }).canWriteInPlace()).toBe(false);
  });

  it("AT-FA-02 startPermissionRequest calls requestPermission({mode: readwrite}) synchronously (INV-33)", async () => {
    const handle = fakeFileHandle();
    const access = new MarkdownFileAccess(window);
    const p = access.startPermissionRequest(handle);
    expect(handle.calls).toEqual(["requestPermission:readwrite"]);
    await expect(p).resolves.toBe("granted");
  });

  it("AT-FA-02 a synchronous throw becomes a rejected promise", async () => {
    const access = new MarkdownFileAccess(window);
    const handle = {
      requestPermission() {
        throw domError("SecurityError");
      },
    };
    await expect(access.startPermissionRequest(handle)).rejects.toMatchObject({ name: "SecurityError" });
  });

  it("AT-FA-03 startSavePicker calls showSaveFilePicker synchronously with the suggested name (INV-33)", async () => {
    const calls = [];
    const picker = vi.fn((opts) => {
      calls.push(opts.suggestedName);
      return Promise.resolve(fakeFileHandle({ name: opts.suggestedName }));
    });
    const access = new MarkdownFileAccess({ showSaveFilePicker: picker });
    const p = access.startSavePicker("notes.md");
    expect(calls).toEqual(["notes.md"]);
    expect((await p).name).toBe("notes.md");
    // the file type name the save dialog shows comes from CONFIG (R15)
    expect(picker.mock.calls[0][0].types).toEqual([{ description: CONFIG.messages.edit.saveFileType, accept: { "text/markdown": [".md"] } }]);
    expect(CONFIG.messages.edit.saveFileType).toBe("Markdown");
  });

  it("AT-FA-09 the save dialog starts in the folder of the last file noted or chosen in this tab, by the browser's id otherwise; nothing is stored (INV-79)", async () => {
    let picked = 0;
    const picker = vi.fn(() => Promise.resolve(fakeFileHandle({ name: `picked${++picked}.md` })));
    const access = new MarkdownFileAccess({ showSaveFilePicker: picker });
    const storedBefore = localStorage.length;

    // no file yet: only the id, so the browser starts where it last saved with it
    const first = await access.startSavePicker("a.md");
    expect(picker.mock.calls[0][0].id).toBe(CONFIG.edit.savePickerId);
    expect(CONFIG.edit.savePickerId).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect("startIn" in picker.mock.calls[0][0]).toBe(false);

    // the file chosen there is where the next dialog starts
    await access.startSavePicker("b.md");
    expect(picker.mock.calls[1][0].startIn).toBe(first);

    // a dropped file is noted; null leaves the last one
    const dropped = fakeFileHandle({ name: "dropped.md" });
    access.noteFile(dropped);
    access.noteFile(null);
    await access.startSavePicker("c.md");
    expect(picker.mock.calls[2][0].startIn).toBe(dropped);
    expect(picker.mock.calls[2][0].id).toBe(CONFIG.edit.savePickerId);

    // a canceled dialog changes nothing
    picker.mockImplementationOnce(() => Promise.reject(domError("AbortError")));
    await expect(access.startSavePicker("d.md")).rejects.toMatchObject({ name: "AbortError" });
    await access.startSavePicker("e.md");
    expect(picker.mock.calls[4][0].startIn.name).toBe("picked3.md");

    // the dialog is still started synchronously (INV-33) and nothing is stored
    const sync = vi.fn(() => Promise.resolve(fakeFileHandle()));
    new MarkdownFileAccess({ showSaveFilePicker: sync }).startSavePicker("f.md");
    expect(sync).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(storedBefore);
  });

  it("AT-FA-04 readFile returns the first bytes (with BOM), the decoded text and lastModified", async () => {
    const bytes = withBom(toCrlf("# A\nb\n"));
    const handle = fakeFileHandle({ content: [bytes], lastModified: 4242 });
    const loaded = await new MarkdownFileAccess(window).readFile(handle);
    expect([...loaded.bytesHead]).toEqual([0xef, 0xbb, 0xbf]);
    expect(loaded.text).toBe("# A\r\nb\r\n");
    expect(loaded.lastModified).toBe(4242);
  });

  it("AT-FT-21 INV-18 (1)(4), INV-21 Reload: readFile gives the file to check before its text is read; a refusal stops the read", async () => {
    const handle = fakeFileHandle({ name: "doc.md", content: ["# A\n"] });
    const seen = [];
    const text = vi.spyOn(Blob.prototype, "text");
    await new MarkdownFileAccess(window).readFile(handle, (file) => seen.push([file.name, file.size, text.mock.calls.length]));
    expect(seen).toEqual([["doc.md", 4, 0]]); // name and size, before any text was read
    text.mockClear();
    const refused = new Error("refused");
    await expect(
      new MarkdownFileAccess(window).readFile(handle, () => {
        throw refused;
      }),
    ).rejects.toBe(refused);
    expect(text).not.toHaveBeenCalled();
  });

  it("AT-FA-05 readLastModified returns getFile().lastModified and lets NotFoundError through", async () => {
    const access = new MarkdownFileAccess(window);
    await expect(access.readLastModified(fakeFileHandle({ lastModified: 77 }))).resolves.toBe(77);
    const gone = fakeFileHandle({ getFileError: domError("NotFoundError") });
    await expect(access.readLastModified(gone)).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("AT-FA-06 writeFile does createWritable -> write -> close and returns the new lastModified", async () => {
    const handle = fakeFileHandle({ lastModified: 1000 });
    const lm = await new MarkdownFileAccess(window).writeFile(handle, "new text");
    expect(handle.calls).toEqual(["createWritable", "write", "close", "getFile"]);
    expect(handle.state.written).toEqual(["new text"]);
    expect(lm).toBe(2000);
  });

  it("AT-FA-06 a failed write aborts the writable and then throws", async () => {
    const handle = fakeFileHandle({ writeError: new Error("disk full") });
    await expect(new MarkdownFileAccess(window).writeFile(handle, "x")).rejects.toThrow("disk full");
    expect(handle.calls).toEqual(["createWritable", "write", "abort"]);
  });

  it("AT-FA-07 startDownload clicks a blob: link synchronously, revokes it a minute later (review T-2), leaves no <a>", async () => {
    vi.useFakeTimers();
    const blobs = [];
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      blobs.push(b);
      return "blob:fake-1";
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      clicked.push({ href: this.getAttribute("href"), download: this.download, inDom: this.isConnected });
    });

    new MarkdownFileAccess(window).startDownload("notes.md", "" + BOM + "# A\r\n");

    expect(create).toHaveBeenCalledTimes(1);
    expect(blobs[0].type).toBe("text/markdown;charset=utf-8");
    // Blob.text() would drop the BOM, so compare the bytes.
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    expect([...bytes]).toEqual([...new TextEncoder().encode(BOM + "# A\r\n")]);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(clicked).toEqual([{ href: "blob:fake-1", download: "notes.md", inDom: true }]);
    expect(document.querySelectorAll("a").length).toBe(0);
    expect(revoke).not.toHaveBeenCalled();
    // not in the next task: a busy browser has not read the blob yet
    vi.advanceTimersByTime(59999);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith("blob:fake-1");
  });

  it("AT-FA-08 no operation uses the network", async () => {
    const fetchSpy = vi.fn();
    const sendBeacon = vi.fn();
    const xhr = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", xhr);
    // jsdom has no navigator.sendBeacon: define a spy for this test only.
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
    onTestFinished(() => delete navigator.sendBeacon);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const access = new MarkdownFileAccess({ showSaveFilePicker: () => Promise.resolve(fakeFileHandle()) });
    const handle = fakeFileHandle();
    await access.startPermissionRequest(handle);
    await access.startSavePicker("a.md");
    await access.readFile(handle);
    await access.readLastModified(handle);
    await access.writeFile(handle, "x");
    access.startDownload("a.md", "x");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});

describe("writeFile clean-up and the lastModified read", () => {
  function handle({ writeError, closeError, abortError, getFileError } = {}) {
    const calls = [];
    return {
      calls,
      name: "doc.md",
      async createWritable() {
        calls.push("createWritable");
        return {
          async write() {
            calls.push("write");
            if (writeError) throw writeError;
          },
          async close() {
            calls.push("close");
            if (closeError) throw closeError;
          },
          async abort() {
            calls.push("abort");
            if (abortError) throw abortError;
          },
        };
      },
      async getFile() {
        calls.push("getFile");
        if (getFileError) throw getFileError;
        return new File(["x"], "doc.md", { lastModified: 42 });
      },
    };
  }

  it("a failed close aborts the writable and throws the close error", async () => {
    const h = handle({ closeError: new Error("close failed") });
    await expect(new MarkdownFileAccess(window).writeFile(h, "x")).rejects.toThrow("close failed");
    expect(h.calls).toEqual(["createWritable", "write", "close", "abort"]);
  });

  it("an abort that throws does not hide the write error", async () => {
    const h = handle({ writeError: new Error("disk full"), abortError: new Error("abort failed") });
    await expect(new MarkdownFileAccess(window).writeFile(h, "x")).rejects.toThrow("disk full");
  });

  it("an abort that throws does not hide the close error", async () => {
    const h = handle({ closeError: new Error("close failed"), abortError: new Error("abort failed") });
    await expect(new MarkdownFileAccess(window).writeFile(h, "x")).rejects.toThrow("close failed");
  });

  it("after a successful write, a failing lastModified read gives null (the file is written)", async () => {
    const h = handle({ getFileError: new Error("gone") });
    await expect(new MarkdownFileAccess(window).writeFile(h, "x")).resolves.toBeNull();
    expect(h.calls).toEqual(["createWritable", "write", "close", "getFile"]);
  });
});

describe("MarkdownFileAccess for code files (INV-90)", () => {
  it("AT-FA-10 startSavePicker offers the types given (a code file's extension), none for an empty list; same dialog id", async () => {
    const picker = vi.fn((opts) => Promise.resolve(fakeFileHandle({ name: opts.suggestedName })));
    const access = new MarkdownFileAccess({ showSaveFilePicker: picker });
    const types = [{ description: "PY file", accept: { "text/plain": [".py"] } }];
    await access.startSavePicker("a.py", types);
    await access.startSavePicker("Makefile", []);
    expect(picker.mock.calls[0][0]).toEqual({ id: CONFIG.edit.savePickerId, suggestedName: "a.py", types });
    // a picked file is noted, so the second dialog starts in its folder (INV-79)
    expect(Object.keys(picker.mock.calls[1][0]).sort()).toEqual(["id", "startIn", "suggestedName"]);
    expect(picker.mock.calls[1][0].suggestedName).toBe("Makefile");
  });

  it("AT-FA-11 startDownload of bytes with a type: the blob holds those bytes and that type", async () => {
    const blobs = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      blobs.push(b);
      return "blob:fake-2";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    new MarkdownFileAccess(window).startDownload("a.txt", Uint8Array.from([0x93, 0xfa, 0x0a]), "application/octet-stream");
    expect(blobs[0].type).toBe("application/octet-stream");
    expect([...new Uint8Array(await blobs[0].arrayBuffer())]).toEqual([0x93, 0xfa, 0x0a]);
  });
});

/** A fake trace environment: a clock the test moves and the lines logged. */
function traceEnv(userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.4314.58") {
  const env = { t: 1000, lines: [] };
  env.make = () => ({ now: () => env.t, log: (line) => env.lines.push(line), userAgent, buildDate: "2026-11-01" });
  return env;
}

describe("MarkdownFileAccess: the save log (INV-109)", () => {
  const TAIL = "Edg/156.0.4314.58 build=2026-11-01";

  it("AT-FA-12 Save as: one line each for the save dialog, createWritable, write and close, timed from the press; ids and types without names", async () => {
    const env = traceEnv();
    const handle = fakeFileHandle({ name: "secret-notes.md" });
    const picker = vi.fn(() => {
      env.t += 400;
      return Promise.resolve(handle);
    });
    const access = new MarkdownFileAccess({ showSaveFilePicker: picker }, env.make);
    const chosen = await access.startSavePicker("secret-notes.md");
    env.t += 12.4;
    await access.writeFile(chosen, "# A\n");
    expect(env.lines).toEqual([
      `GRSMD save: picker ok 400 ms id=yes startIn=no type=.md ${TAIL}`,
      `GRSMD save: createWritable ok 412 ms id=yes startIn=no type=.md ${TAIL}`,
      `GRSMD save: write ok 412 ms id=yes startIn=no type=.md ${TAIL}`,
      `GRSMD save: close ok 412 ms id=yes startIn=no type=.md ${TAIL}`,
    ]);
    // the next save dialog starts in that file's folder (INV-79): startIn=yes
    await access.startSavePicker("x.md");
    expect(env.lines.at(-1)).toBe(`GRSMD save: picker ok 400 ms id=yes startIn=yes type=.md ${TAIL}`);
  });

  it("AT-FA-13 the save dialog's AbortError: one fail line with the name and the message (the R5 example)", async () => {
    const env = traceEnv();
    const picker = () => {
      env.t += 412;
      return Promise.reject(domError("AbortError", "The user aborted a request."));
    };
    const access = new MarkdownFileAccess({ showSaveFilePicker: picker }, env.make);
    await expect(access.startSavePicker("notes.md")).rejects.toMatchObject({ name: "AbortError" });
    expect(env.lines).toEqual([`GRSMD save: picker fail AbortError "The user aborted a request." 412 ms id=yes startIn=no type=.md ${TAIL}`]);
    // a synchronous throw logs the same way
    const throwing = new MarkdownFileAccess({ showSaveFilePicker: () => { throw domError("SecurityError", "Must be handling a user gesture"); } }, env.make);
    await expect(throwing.startSavePicker("notes.md", [])).rejects.toMatchObject({ name: "SecurityError" });
    expect(env.lines.at(-1)).toBe(`GRSMD save: picker fail SecurityError "Must be handling a user gesture" 0 ms id=yes startIn=no type=none ${TAIL}`);
  });

  it("AT-FA-14 Save in place: the permission line (granted, another state, an error); no save dialog: id and startIn are -", async () => {
    const env = traceEnv();
    const access = new MarkdownFileAccess(window, env.make);
    const granted = fakeFileHandle({ name: "a.py" });
    await access.startPermissionRequest(granted);
    await access.writeFile(granted, "x");
    expect(env.lines).toEqual([
      `GRSMD save: permission ok 0 ms id=- startIn=- type=.py ${TAIL}`,
      `GRSMD save: createWritable ok 0 ms id=- startIn=- type=.py ${TAIL}`,
      `GRSMD save: write ok 0 ms id=- startIn=- type=.py ${TAIL}`,
      `GRSMD save: close ok 0 ms id=- startIn=- type=.py ${TAIL}`,
    ]);
    env.lines.length = 0;
    await access.startPermissionRequest(fakeFileHandle({ name: "Makefile", permission: "denied" }));
    const refused = Object.assign(new Error("denied"), { name: "NotAllowedError" }); // fakeFileHandle rejects an Error
    await expect(access.startPermissionRequest(fakeFileHandle({ permission: refused }))).rejects.toBe(refused);
    expect(env.lines).toEqual([
      `GRSMD save: permission fail state=denied 0 ms id=- startIn=- type=none ${TAIL}`,
      `GRSMD save: permission fail NotAllowedError "denied" 0 ms id=- startIn=- type=.md ${TAIL}`,
    ]);
    // no requestPermission (an older handle): no line
    env.lines.length = 0;
    await access.startPermissionRequest({ name: "a.md" });
    expect(env.lines).toEqual([]);
  });

  it("AT-FA-15 a failed write logs the step that failed; the file names and paths in a message are replaced", async () => {
    const env = traceEnv();
    const handle = fakeFileHandle({ name: "diary.md", writeError: domError("InvalidStateError", "diary.md at C:\\Users\\me\\diary.md changed") });
    const access = new MarkdownFileAccess({ showSaveFilePicker: () => Promise.resolve(handle) }, env.make);
    await access.startSavePicker("untitled.md");
    await expect(access.writeFile(handle, "x")).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(env.lines.map((l) => l.split(" ms ")[0])).toEqual([
      "GRSMD save: picker ok 0",
      "GRSMD save: createWritable ok 0",
      `GRSMD save: write fail InvalidStateError "<hidden>" 0`, // a path in the message: hidden (INV-109 (4))
    ]);
    // the close step fails after the write: its own line
    const closing = {
      name: "c.md",
      createWritable: async () => ({ write: async () => {}, close: async () => { throw domError("InvalidStateError", "c.md was closed"); }, abort: async () => {} }),
    };
    await access.startPermissionRequest(closing);
    await expect(access.writeFile(closing, "x")).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(env.lines.slice(-3).map((l) => l.split(" ms ")[0])).toEqual([
      "GRSMD save: createWritable ok 0",
      "GRSMD save: write ok 0",
      `GRSMD save: close fail InvalidStateError "<name> was closed" 0`,
    ]);
    const broken = { name: "b.md", createWritable: () => Promise.reject(domError("NoModificationAllowedError", "locked")) };
    await expect(access.writeFile(broken, "x")).rejects.toBeTruthy();
    expect(env.lines.at(-1)).toBe(`GRSMD save: createWritable fail NoModificationAllowedError "locked" 0 ms id=- startIn=- type=.md ${TAIL}`);
    for (const line of env.lines) {
      expect(line).not.toMatch(/diary|untitled|Users|me\\/);
      expect(line).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it("AT-FA-16 the log goes to the console only: console.info by default; nothing stored, nothing in the page", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const storedBefore = localStorage.length + sessionStorage.length;
    const bodyBefore = document.body.innerHTML;
    const handle = fakeFileHandle({ name: "a.md" });
    const access = new MarkdownFileAccess({ showSaveFilePicker: () => Promise.resolve(handle) });
    await access.writeFile(await access.startSavePicker("a.md"), "# A\n");
    expect(info).toHaveBeenCalledTimes(4);
    expect(info.mock.calls.every(([line]) => line.startsWith("GRSMD save: "))).toBe(true);
    expect(info.mock.calls[0][0]).toMatch(/ build=unknown$/); // the tests have no stamped help
    expect(localStorage.length + sessionStorage.length).toBe(storedBefore);
    expect(document.body.innerHTML).toBe(bodyBefore);
  });
});

describe("MarkdownFileAccess: the save log never changes the save (INV-109 (5)(6), review 1)", () => {
  it("AT-FA-17 (INV-109 (6)) a console that throws, or a trace that cannot be made: the save dialog, the permission and the write still succeed", async () => {
    for (const make of [
      () => ({ now: () => 0, log: () => { throw new Error("console replaced"); }, userAgent: "", buildDate: "x" }),
      () => { throw new Error("no environment"); },
    ]) {
      const handle = fakeFileHandle({ name: "a.md", lastModified: 1000 });
      const access = new MarkdownFileAccess({ showSaveFilePicker: () => Promise.resolve(handle) }, make);
      const chosen = await access.startSavePicker("a.md");
      expect(chosen).toBe(handle);
      await expect(access.writeFile(chosen, "# A\n")).resolves.toBe(2000);
      expect(handle.state.written).toEqual(["# A\n"]);
      await expect(access.startPermissionRequest(handle)).resolves.toBe("granted");
      await expect(access.writeFile(handle, "# B\n")).resolves.toBe(3000);
    }
  });

  it("AT-FA-17 (INV-109 (6)) Save as through the real file access is saved while the console throws", async () => {
    const { default: SaveDocumentAs } = await import("../js/classes/SaveDocumentAs.js");
    const { default: DocumentSession } = await import("../js/classes/DocumentSession.js");
    const { default: DocumentLocation } = await import("../js/classes/DocumentLocation.js");
    const handle = fakeFileHandle({ name: "chosen.md" });
    const make = () => ({ now: () => 0, log: () => { throw new Error("console replaced"); }, userAgent: "", buildDate: "x" });
    const access = new MarkdownFileAccess({ showSaveFilePicker: () => Promise.resolve(handle) }, make);
    const saveAs = new SaveDocumentAs(access, CONFIG.messages.edit, CONFIG.edit.defaultFileName);
    const out = await saveAs.execute({
      session: DocumentSession.fromPastedText("# P\n", 1),
      location: new DocumentLocation(CONFIG.edit.defaultFileName, null),
      bodyText: "# P\n",
      permissionOrPicker: access.startSavePicker(CONFIG.edit.defaultFileName),
      confirmer: { confirmOverwrite: async () => true },
    });
    expect(out.status).toBe("saved");
    expect(handle.state.written).toEqual(["# P\n"]);
  });

  it("AT-FA-18 (INV-109 (5)) a new start replaces the trace a save left on the handle (no write: the overwrite No, a denied permission)", async () => {
    const env = traceEnv();
    const access = new MarkdownFileAccess(window, env.make);
    const handle = fakeFileHandle({ name: "a.md" });
    await access.startPermissionRequest(handle); // t = 1000; the save ends without a write
    env.t = 1500;
    await access.startPermissionRequest(handle); // the next save starts here
    env.t = 1600;
    await access.writeFile(handle, "x");
    expect(env.lines.slice(-3).map((l) => l.split(" id=")[0])).toEqual([
      "GRSMD save: createWritable ok 100 ms",
      "GRSMD save: write ok 100 ms",
      "GRSMD save: close ok 100 ms",
    ]);
  });

  it("AT-FA-19 (INV-109 (4)) the save dialog's other names stay out of the log; bad arguments still reject, not throw (review 1, finding 4)", async () => {
    const env = traceEnv();
    const picker = () => Promise.reject(domError("AbortError", "a.py and a.txt are open"));
    const access = new MarkdownFileAccess({ showSaveFilePicker: picker }, env.make);
    await expect(access.startSavePicker("a.txt", [], ["a.py"])).rejects.toMatchObject({ name: "AbortError" });
    expect(env.lines.at(-1)).toContain('picker fail AbortError "<name> and <name> are open"');
    let started;
    expect(() => {
      started = access.startSavePicker("a.md", null);
    }).not.toThrow();
    await expect(started).rejects.toBeInstanceOf(TypeError);
    expect(() => {
      started = access.startPermissionRequest(null);
    }).not.toThrow();
    await expect(started).rejects.toBeInstanceOf(TypeError);
  });
});
