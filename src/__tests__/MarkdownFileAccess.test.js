import { describe, it, expect, vi, afterEach, onTestFinished } from "vitest";
import MarkdownFileAccess from "../js/classes/MarkdownFileAccess.js";
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
  });

  it("AT-FA-04 readFile returns the first bytes (with BOM), the decoded text and lastModified", async () => {
    const bytes = withBom(toCrlf("# A\nb\n"));
    const handle = fakeFileHandle({ content: [bytes], lastModified: 4242 });
    const loaded = await new MarkdownFileAccess(window).readFile(handle);
    expect([...loaded.bytesHead]).toEqual([0xef, 0xbb, 0xbf]);
    expect(loaded.text).toBe("# A\r\nb\r\n");
    expect(loaded.lastModified).toBe(4242);
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

  it("AT-FA-07 startDownload clicks a blob: link synchronously, revokes it in a later task, leaves no <a>", async () => {
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
    vi.runAllTimers();
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
