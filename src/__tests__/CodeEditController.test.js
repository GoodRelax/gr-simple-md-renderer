import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import CodeEditController from "../js/classes/CodeEditController.js";
import CodeEditor from "../js/classes/CodeEditor.js";
import { CONFIG } from "../js/config.js";
import { encodeText } from "../js/textEncoding.js";
import FileRefusal from "../js/classes/FileRefusal.js";
import { fakeFileAccess, fakeFileHandle, domError, deferred } from "./helpers/fakeFs.js";

// AT-CEC: the code document while the code view is shown (SC-27): opening
// with the dialog (INV-89), Reload, Save / Save as (INV-90, NE-24, NE-19).

const A = "\u3042"; // hiragana a
const KAN = "\u6F22"; // kanji kan
const EMOJI = "\u{1F600}";
const m = CONFIG.messages;

const sjis = (text) => encodeText(text, "shift_jis", false).bytes;
const utf8 = (text) => new TextEncoder().encode(text);
const bytesOf = (data) => [...data];

let access;
let dialog;
let host;
let ctrl;

beforeEach(() => {
  access = fakeFileAccess();
  dialog = { askOpen: vi.fn(async () => null), askSaveEncoding: vi.fn(async () => null), askSaveUtf8: vi.fn(async () => false) };
  host = {
    toast: vi.fn(),
    confirmOverwrite: vi.fn(async () => true),
    codeFileSaved: vi.fn(),
    reopenAsMarkdown: vi.fn(async () => {}),
  };
  ctrl = new CodeEditController(access, dialog, host);
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function file(bytes, name = "a.py", lastModified = 1000) {
  return new File([bytes], name, { lastModified });
}

/** Read and open a file; the handle is a fake with the shared calls. */
async function open(bytes, { name = "a.py", handle = fakeFileHandle({ name, calls: access.calls }) } = {}) {
  const doc = await ctrl.read(file(bytes, name));
  ctrl.opened(doc, handle);
  return { doc, handle };
}

describe("CodeEditController: opening (INV-89)", () => {
  it("AT-CEC-01 valid UTF-8 with one kind of line ending: no dialog; the document holds it", async () => {
    const doc = await ctrl.read(file(utf8(`x = "${A}"\r\ny = 2\r\n`), "a.py", 1234));
    expect(dialog.askOpen).not.toHaveBeenCalled();
    expect([doc.fileName, doc.lastModified, doc.encoding, doc.bom, doc.lineEndingMode]).toEqual(["a.py", 1234, "utf-8", false, "\r\n"]);
    expect(doc.text).toBe(`x = "${A}"\ny = 2\n`);
  });

  it("AT-CEC-02 UTF-8 with a BOM: no dialog, the BOM is noted and not in the text; no line ending: LF", async () => {
    const doc = await ctrl.read(file(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61])));
    expect(dialog.askOpen).not.toHaveBeenCalled();
    expect([doc.encoding, doc.bom, doc.lineEndingMode, doc.text]).toEqual(["utf-8", true, "\n", "a"]);
  });

  it("AT-CEC-03 not valid UTF-8: the dialog gets the bytes and the guess; its answer decodes the text", async () => {
    const bytes = sjis(`${A}\r\n${KAN}\r\n`);
    dialog.askOpen.mockResolvedValue({ encoding: "shift_jis", lineEndingMode: "\r\n" });
    const doc = await ctrl.read(file(bytes, "old.txt"));
    const arg = dialog.askOpen.mock.calls[0][0];
    expect(arg.fileName).toBe("old.txt");
    expect(bytesOf(arg.bytes)).toEqual(bytesOf(bytes));
    expect([arg.decoded.encoding, arg.decoded.valid, arg.mixed]).toEqual(["shift_jis", false, false]);
    expect(arg.counts).toEqual({ crlf: 2, lf: 0, cr: 0 });
    expect([doc.encoding, doc.bom, doc.lineEndingMode, doc.text]).toEqual(["shift_jis", false, "\r\n", `${A}\n${KAN}\n`]);
  });

  it("AT-CEC-04 another encoding chosen in the dialog: the text is decoded in it", async () => {
    dialog.askOpen.mockResolvedValue({ encoding: "euc-jp", lineEndingMode: "\n" });
    const doc = await ctrl.read(file(Uint8Array.from([0xa4, 0xa2, 0x0a])));
    expect([doc.encoding, doc.text]).toEqual(["euc-jp", `${A}\n`]);
  });

  it("AT-CEC-05 mixed line endings in UTF-8: the dialog asks; 'keep' records the original endings", async () => {
    dialog.askOpen.mockResolvedValue({ encoding: "utf-8", lineEndingMode: "keep" });
    const doc = await ctrl.read(file(utf8("a\r\nb\nc")));
    expect(dialog.askOpen.mock.calls[0][0].mixed).toBe(true);
    expect(doc.lineEndingMode).toBe("keep");
    expect(doc.original).toEqual({ lines: ["a", "b", "c"], endings: ["\r\n", "\n"] });
  });

  it("AT-FT-13 INV-18 (AQ11) read: a decoded text with U+0000 throws FileRefusal binaryFile before the dialog; the dialog's encoding with U+0000 too; nothing opened", async () => {
    await expect(ctrl.read(file(Uint8Array.from([0x61, 0x00, 0x62])))).rejects.toBeInstanceOf(FileRefusal);
    await expect(ctrl.read(file(Uint8Array.from([0xfe, 0xff, 0x00, 0x00])))).rejects.toMatchObject({ reason: "binaryFile" }); // UTF-16BE U+0000
    expect(dialog.askOpen).not.toHaveBeenCalled();
    dialog.askOpen.mockResolvedValue({ encoding: "utf-8", lineEndingMode: "\n" });
    await expect(ctrl.read(file(Uint8Array.from([0xff, 0xfe, 0x61, 0x00])))).rejects.toMatchObject({ reason: "binaryFile" });
    expect(dialog.askOpen).toHaveBeenCalledTimes(1);
    expect(ctrl.hasDocument()).toBe(false);
    dialog.askOpen.mockResolvedValue({ encoding: "utf-16le", lineEndingMode: "\n" });
    expect((await ctrl.read(file(Uint8Array.from([0xff, 0xfe, 0x61, 0x00])))).text).toBe("a");
  });

  it("AT-CEC-06 the dialog canceled: null, nothing opened", async () => {
    dialog.askOpen.mockResolvedValue(null);
    expect(await ctrl.read(file(sjis(`${A}\n`)))).toBeNull();
    expect(ctrl.hasDocument()).toBe(false);
  });

  it("AT-CEC-07 opened keeps the document and notes the file (INV-79); updateText makes it dirty; close drops it", async () => {
    const { handle } = await open(utf8("a\n"));
    expect(access.noted).toEqual([handle]);
    expect([ctrl.hasDocument(), ctrl.isDirty(), ctrl.currentText(), ctrl.fileName()]).toEqual([true, false, "a\n", "a.py"]);
    expect(ctrl.fileInfo()).toEqual({ encoding: "utf-8", bom: false, lineEndingMode: "\n" });
    ctrl.updateText("b\n");
    expect([ctrl.isDirty(), ctrl.currentText()]).toEqual([true, "b\n"]);
    ctrl.close();
    expect([ctrl.hasDocument(), ctrl.isDirty(), ctrl.currentText(), ctrl.fileInfo()]).toEqual([false, false, "", null]);
  });

  it("AT-CEC-08 Reload decodes in the document's encoding and keeps its mode; commit applies it once the view shows it", async () => {
    dialog.askOpen.mockResolvedValue({ encoding: "shift_jis", lineEndingMode: "\r\n" });
    await open(sjis(`${A}\r\n`));
    ctrl.updateText("typed\n");
    const reader = ctrl.reloadReader();
    const text = await reader.readText(file(sjis(`${KAN}\n`), "a.py", 9000));
    expect(text).toBe(`${KAN}\n`);
    expect(ctrl.currentText()).toBe("typed\n"); // not yet
    reader.commit();
    expect([ctrl.currentText(), ctrl.isDirty(), ctrl.document.lastModified, ctrl.document.encoding, ctrl.document.lineEndingMode]).toEqual([`${KAN}\n`, false, 9000, "shift_jis", "\r\n"]);
    expect(dialog.askOpen).toHaveBeenCalledTimes(1);
  });

  it("AT-CEC-09 a Reload that went stale (another document opened meanwhile) changes nothing", async () => {
    await open(utf8("first\n"));
    const reader = ctrl.reloadReader();
    await reader.readText(file(utf8("reloaded\n")));
    await open(utf8("second\n"), { name: "b.py" });
    reader.commit();
    expect([ctrl.currentText(), ctrl.fileName()]).toEqual(["second\n", "b.py"]);
  });
});

describe("CodeEditController: Save (INV-90)", () => {
  it("AT-CEC-10 Save in place: the permission request starts synchronously (INV-33), then the time check and the write of the bytes", async () => {
    const { handle } = await open(utf8("a\r\nb\r\n"));
    ctrl.updateText("a\nc\n");
    const saving = ctrl.save();
    expect(access.calls).toEqual(["startPermissionRequest"]);
    expect(ctrl.isSaving()).toBe(true);
    await saving;
    expect(access.calls).toEqual(["startPermissionRequest", "readLastModified", "writeFile:a.py"]);
    expect(access.writes[0].handle).toBe(handle);
    expect(bytesOf(access.writes[0].text)).toEqual(bytesOf(utf8("a\r\nc\r\n")));
    expect(host.toast).toHaveBeenCalledWith(m.edit.saved("a.py"));
    expect([ctrl.isDirty(), ctrl.isSaving(), ctrl.document.lastModified]).toEqual([false, false, 2000]);
    const [saved, savedHandle] = host.codeFileSaved.mock.calls[0];
    expect([saved.name, saved.size, saved.lastModified, savedHandle]).toEqual(["a.py", 6, 2000, handle]);
    expect(host.reopenAsMarkdown).not.toHaveBeenCalled();
  });

  it("AT-CEC-11 the file changed on disk: asked first (INV-39); No writes nothing", async () => {
    access = fakeFileAccess({ lastModified: 5555 });
    ctrl = new CodeEditController(access, dialog, host);
    await open(utf8("a\n"));
    host.confirmOverwrite.mockResolvedValue(false);
    await ctrl.save();
    expect(host.confirmOverwrite).toHaveBeenCalledWith("changed");
    expect(access.writes).toEqual([]);
    expect(host.toast).not.toHaveBeenCalled();
  });

  it("AT-CEC-12 after a write whose time could not be read, the next Save asks 'unknown'", async () => {
    const write = vi.spyOn(access, "writeFile").mockResolvedValue(null);
    await open(utf8("a\n"));
    await ctrl.save();
    expect(ctrl.document.lastModified).toBeNull();
    expect(host.confirmOverwrite).not.toHaveBeenCalled();
    await ctrl.save();
    expect(host.confirmOverwrite.mock.calls).toEqual([["unknown"]]);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["the permission denied", () => ({ permission: Promise.resolve("denied") }), m.edit.saveDenied],
    ["the file gone", () => ({ writeError: domError("NotFoundError") }), m.edit.saveNotFound],
    ["the press too old", () => ({ get permission() { return Promise.reject(domError("SecurityError")); } }), m.edit.saveActivationLost],
    ["another error", () => ({ writeError: new Error("disk full") }), m.edit.saveFailed],
  ])("AT-CEC-13 Save fails with %s: its toast, still unsaved", async (_name, opts, message) => {
    access = fakeFileAccess(opts());
    ctrl = new CodeEditController(access, dialog, host);
    await open(utf8("a\n"));
    ctrl.updateText("b\n");
    await ctrl.save();
    expect(host.toast.mock.calls).toEqual([[message]]);
    expect([ctrl.isDirty(), ctrl.isSaving()]).toEqual([true, false]);
    expect(host.codeFileSaved).not.toHaveBeenCalled();
  });

  it("AT-CEC-14 Save as: the save dialog starts synchronously with the file's name and its extension as the type (NE-8)", async () => {
    const picked = fakeFileHandle({ name: "renamed.py", calls: access.calls });
    access = fakeFileAccess({ picker: Promise.resolve(picked), calls: access.calls });
    ctrl = new CodeEditController(access, dialog, host);
    await open(utf8("a\n"));
    const saving = ctrl.saveAs();
    expect(access.calls).toEqual(["startSavePicker:a.py"]);
    expect(access.pickerTypes).toEqual([[{ description: "PY file", accept: { "text/plain": [".py"] } }]]);
    await saving;
    expect(access.calls).toEqual(["startSavePicker:a.py", "writeFile:renamed.py"]);
    expect(host.toast).toHaveBeenCalledWith(m.edit.saved("renamed.py"));
    expect(ctrl.fileName()).toBe("renamed.py");
    expect(host.codeFileSaved.mock.calls[0][1]).toBe(picked);
    expect(host.codeFileSaved.mock.calls[0][2]).toBe(false); // .py to .py: the same language
    // the next Save writes the chosen file in place
    await ctrl.save();
    expect(access.writes.map((w) => w.handle)).toEqual([picked, picked]);
  });

  it("AT-CEC-15 Save as of a name without an extension offers all files only; a canceled dialog writes nothing and says nothing", async () => {
    access = fakeFileAccess({ get picker() { return Promise.reject(domError("AbortError")); } });
    ctrl = new CodeEditController(access, dialog, host);
    await open(utf8("all:\n"), { name: "Makefile" });
    await ctrl.saveAs();
    expect(access.pickerTypes).toEqual([[]]);
    expect(access.writes).toEqual([]);
    expect(host.toast).not.toHaveBeenCalled();
  });

  it("AT-CEC-16 Save without a file handle opens the save dialog", async () => {
    await open(utf8("a\n"), { handle: null });
    await ctrl.save();
    expect(access.calls[0]).toBe("startSavePicker:a.py");
    expect(access.writes).toHaveLength(1);
  });

  it("AT-CEC-17 no write API: the bytes are downloaded at once as application/octet-stream; still unsaved", async () => {
    access = fakeFileAccess({ canWrite: false });
    ctrl = new CodeEditController(access, dialog, host);
    await open(utf8("a\r\n"));
    ctrl.updateText("b\n");
    const saving = ctrl.saveAs();
    expect(access.calls).toEqual(["startDownload:a.py"]);
    await saving;
    expect(bytesOf(access.downloads[0].text)).toEqual(bytesOf(utf8("b\r\n")));
    expect(access.downloadTypes).toEqual(["application/octet-stream"]);
    expect(host.toast).toHaveBeenCalledWith(m.edit.downloadStarted("a.py"));
    expect(ctrl.isDirty()).toBe(true);
  });

  it("AT-CEC-18 a non-UTF-8 file: Save asks once (original), writes in it, and then remembers; Save as asks each time", async () => {
    dialog.askOpen.mockResolvedValue({ encoding: "shift_jis", lineEndingMode: "\r\n" });
    await open(sjis(`${A}\r\n`), { name: "a.txt" });
    dialog.askSaveEncoding.mockResolvedValue("original");
    await ctrl.save();
    expect(dialog.askSaveEncoding.mock.calls).toEqual([["shift_jis"]]);
    expect(bytesOf(access.writes[0].text)).toEqual([0x82, 0xa0, 0x0d, 0x0a]);
    expect(ctrl.document.saveEncoding).toBe("original");
    await ctrl.save();
    expect(dialog.askSaveEncoding).toHaveBeenCalledTimes(1);
    expect(access.writes).toHaveLength(2);
    // Save as asks although Save remembers; its answer is not remembered
    dialog.askSaveEncoding.mockResolvedValue(null);
    await ctrl.saveAs();
    await ctrl.saveAs();
    expect(dialog.askSaveEncoding).toHaveBeenCalledTimes(3);
    expect(ctrl.document.saveEncoding).toBe("original");
  });

  it("AT-CEC-19 UTF-8 chosen: UTF-8 bytes (no BOM) are written, and the document is UTF-8 from then on (no more questions)", async () => {
    dialog.askOpen.mockResolvedValue({ encoding: "shift_jis", lineEndingMode: "\r\n" });
    await open(sjis(`${A}\r\n`), { name: "a.txt" });
    dialog.askSaveEncoding.mockResolvedValue("utf-8");
    await ctrl.save();
    expect(bytesOf(access.writes[0].text)).toEqual([0xe3, 0x81, 0x82, 0x0d, 0x0a]);
    expect(ctrl.fileInfo()).toEqual({ encoding: "utf-8", bom: false, lineEndingMode: "\r\n" });
    await ctrl.saveAs();
    expect(dialog.askSaveEncoding).toHaveBeenCalledTimes(1);
  });

  it("AT-CEC-20 the encoding question canceled: nothing starts, nothing is remembered", async () => {
    dialog.askOpen.mockResolvedValue({ encoding: "euc-jp", lineEndingMode: "\n" });
    await open(Uint8Array.from([0xa4, 0xa2, 0x0a]), { name: "a.txt" });
    dialog.askSaveEncoding.mockResolvedValue(null);
    await ctrl.save();
    expect(access.calls).toEqual([]);
    expect([ctrl.isSaving(), ctrl.document.saveEncoding]).toEqual([false, null]);
  });

  it("AT-CEC-21 (INV-90 (3), NE-31) characters the encoding cannot write: asked whether to save in UTF-8 (the encoding and the lines), before the permission; Cancel writes nothing and asks again next time", async () => {
    dialog.askOpen.mockResolvedValue({ encoding: "shift_jis", lineEndingMode: "\n" });
    await open(sjis(`${A}\n`), { name: "a.txt" });
    ctrl.updateText(`a\n${EMOJI}\nb\nc${EMOJI}\n`);
    dialog.askSaveEncoding.mockResolvedValue("original");
    await ctrl.save();
    expect(dialog.askSaveUtf8.mock.calls).toEqual([["shift_jis", "2, 4"]]);
    expect(window.alert).not.toHaveBeenCalled();
    expect(access.calls).toEqual([]);
    expect([ctrl.document.saveEncoding, ctrl.document.encoding]).toEqual([null, "shift_jis"]);
    // more than 10 lines: the first 10, then "..."
    ctrl.updateText(Array.from({ length: 12 }, () => EMOJI).join("\n"));
    await ctrl.save();
    expect(dialog.askSaveUtf8).toHaveBeenLastCalledWith("shift_jis", "1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ...");
    expect(dialog.askSaveEncoding).toHaveBeenCalledTimes(2);
    expect(access.writes).toHaveLength(0);
  });

  it("AT-CEC-47 (INV-90 (3), NE-31) [Save in UTF-8]: the same Save goes on in UTF-8 (the permission starts after the answer), no .md toast; the document is UTF-8 after", async () => {
    dialog.askOpen.mockResolvedValue({ encoding: "shift_jis", lineEndingMode: "\n" });
    await open(sjis(`${A}\n`), { name: "a.txt" });
    ctrl.updateText(`${A}${EMOJI}\n`);
    dialog.askSaveEncoding.mockResolvedValue("original");
    dialog.askSaveUtf8.mockImplementation(async () => {
      access.calls.push("askSaveUtf8");
      return true;
    });
    await ctrl.save();
    expect(access.calls).toEqual(["askSaveUtf8", "startPermissionRequest", "readLastModified", "writeFile:a.txt"]);
    expect(bytesOf(access.writes[0].text)).toEqual(bytesOf(utf8(`${A}${EMOJI}\n`)));
    expect(host.toast.mock.calls).toEqual([[m.edit.saved("a.txt")]]);
    expect([ctrl.document.encoding, ctrl.isDirty()]).toEqual(["utf-8", false]);
    // the next Save: UTF-8, no question
    await ctrl.save();
    expect([dialog.askSaveEncoding.mock.calls.length, dialog.askSaveUtf8.mock.calls.length, access.writes.length]).toEqual([1, 1, 2]);
  });

  it("AT-CEC-48 (INV-90 (3), NE-31) no write API: [Save in UTF-8] downloads in UTF-8 and Save remembers UTF-8; a lone surrogate in a UTF encoding is not asked about (UTF-8 cannot write it either): the alert", async () => {
    access = fakeFileAccess({ canWrite: false });
    ctrl = new CodeEditController(access, dialog, host);
    dialog.askOpen.mockResolvedValue({ encoding: "shift_jis", lineEndingMode: "\n" });
    await open(sjis(`${A}\n`), { name: "a.txt" });
    ctrl.updateText(`${EMOJI}\n`);
    dialog.askSaveEncoding.mockResolvedValue("original");
    dialog.askSaveUtf8.mockResolvedValue(true);
    await ctrl.save();
    expect(bytesOf(access.downloads[0].text)).toEqual(bytesOf(utf8(`${EMOJI}\n`)));
    expect([ctrl.document.saveEncoding, ctrl.document.encoding]).toEqual(["utf-8", "shift_jis"]);
    await ctrl.save();
    expect([dialog.askSaveEncoding.mock.calls.length, dialog.askSaveUtf8.mock.calls.length, access.downloads.length]).toEqual([1, 1, 2]);
    // UTF-8 with a lone surrogate
    await open(utf8("a\n"), { name: "b.txt" });
    ctrl.updateText("a\n\ud800\n");
    await ctrl.save();
    expect(dialog.askSaveUtf8).toHaveBeenCalledTimes(1);
    expect(window.alert).toHaveBeenCalledWith(
      "Not saved: UTF-8 can't write lines 2. Change them.",
    );
    expect(access.downloads).toHaveLength(2);
  });

  it("AT-CEC-22 a second press while saving is ignored, as in the Markdown view (INV-54, INV-58 / 11-e; L16)", async () => {
    const permission = deferred();
    access = fakeFileAccess({ permission: permission.promise });
    ctrl = new CodeEditController(access, dialog, host);
    await open(utf8("a\n"));
    const first = ctrl.save();
    await ctrl.saveAs();
    expect(host.toast).not.toHaveBeenCalled();
    permission.resolve("granted");
    await first;
    expect(access.calls.filter((c) => c.startsWith("startPermission") || c.startsWith("startSavePicker"))).toEqual(["startPermissionRequest"]);
    expect(access.writes).toHaveLength(1);
  });

  it("AT-CEC-23 saved as .md: reopened as a Markdown file with the bytes and the handle, after the save has ended (NE-19)", async () => {
    const picked = fakeFileHandle({ name: "notes.md" });
    access = fakeFileAccess({ picker: Promise.resolve(picked) });
    ctrl = new CodeEditController(access, dialog, host);
    let savingAtReopen = null;
    host.reopenAsMarkdown.mockImplementation(async () => {
      savingAtReopen = ctrl.isSaving();
    });
    await open(utf8("# T\r\n"), { name: "a.txt" });
    await ctrl.saveAs();
    const [reopened, handle] = host.reopenAsMarkdown.mock.calls[0];
    expect([reopened.name, reopened.lastModified, handle, savingAtReopen]).toEqual(["notes.md", 2000, picked, false]);
    expect(await reopened.text()).toBe("# T\r\n");
    expect(host.codeFileSaved).not.toHaveBeenCalled();
    expect(host.toast).toHaveBeenCalledWith(m.edit.saved("notes.md"));
  });

  it("AT-CEC-24 a save that ends after another file was opened leaves that document as it is", async () => {
    const permission = deferred();
    access = fakeFileAccess({ permission: permission.promise });
    ctrl = new CodeEditController(access, dialog, host);
    await open(utf8("a\n"));
    ctrl.updateText("first edit\n");
    const saving = ctrl.save();
    await open(utf8("other\n"), { name: "b.py" });
    permission.resolve("granted");
    await saving;
    expect([ctrl.fileName(), ctrl.currentText(), ctrl.document.lastModified]).toEqual(["b.py", "other\n", 1000]);
    expect(host.codeFileSaved).not.toHaveBeenCalled();
  });

  it("AT-CEC-39 L20: no write API: Save's answer to the encoding question is remembered when the download starts (still unsaved)", async () => {
    access = fakeFileAccess({ canWrite: false });
    ctrl = new CodeEditController(access, dialog, host);
    dialog.askOpen.mockResolvedValue({ encoding: "shift_jis", lineEndingMode: "\r\n" });
    await open(sjis(`${A}\r\n`), { name: "a.txt" });
    dialog.askSaveEncoding.mockResolvedValue("original");
    await ctrl.save();
    await ctrl.save();
    expect(dialog.askSaveEncoding).toHaveBeenCalledTimes(1);
    expect(access.downloads.map((d) => bytesOf(d.text))).toEqual([[0x82, 0xa0, 0x0d, 0x0a], [0x82, 0xa0, 0x0d, 0x0a]]);
    expect([ctrl.document.saveEncoding, ctrl.document.encoding]).toEqual(["original", "shift_jis"]);
    // UTF-8 chosen: remembered too (the file is not replaced, so the document stays Shift_JIS)
    await open(sjis(`${A}\r\n`), { name: "b.txt" });
    dialog.askSaveEncoding.mockResolvedValue("utf-8");
    await ctrl.save();
    await ctrl.save();
    expect(dialog.askSaveEncoding).toHaveBeenCalledTimes(2);
    expect(bytesOf(access.downloads[3].text)).toEqual(bytesOf(utf8(`${A}\r\n`)));
    // Save as asks each time and is not remembered
    await ctrl.saveAs();
    expect(dialog.askSaveEncoding).toHaveBeenCalledTimes(3);
  });

  it("AT-CEC-40 L25 / NE-8: after a Save as to another extension, Save as offers the name with the extension the file was opened with", async () => {
    const picked = fakeFileHandle({ name: "notes.py", calls: access.calls });
    access = fakeFileAccess({ picker: Promise.resolve(picked), calls: access.calls });
    ctrl = new CodeEditController(access, dialog, host);
    await open(utf8("a\n"), { name: "notes.txt" });
    await ctrl.saveAs();
    expect(ctrl.fileName()).toBe("notes.py");
    await ctrl.saveAs();
    expect(access.calls.filter((c) => c.startsWith("startSavePicker"))).toEqual(["startSavePicker:notes.txt", "startSavePicker:notes.txt"]);
    expect(access.pickerTypes[1]).toEqual([{ description: "TXT file", accept: { "text/plain": [".txt"] } }]);
  });

  it("AT-CEC-45 INV-90 (4): the save dialog's file type: 1 to 15 letters, digits or +; a name starting with its only dot has none", async () => {
    const types = (name) => ctrl._pickerTypes(name).map((t) => t.accept["text/plain"][0]);
    expect(types("a.c++")).toEqual([".c++"]);
    expect(types("a." + "x".repeat(15))).toEqual(["." + "x".repeat(15)]);
    expect(types("a." + "x".repeat(16))).toEqual([]);
    expect(types(".bashrc")).toEqual([]);
    expect(types("a.tar-gz")).toEqual([]);
  });

  it("AT-CEC-25 without a document, Save does nothing", async () => {
    await ctrl.save();
    await ctrl.saveAs();
    expect(access.calls).toEqual([]);
    expect(host.toast).not.toHaveBeenCalled();
  });
});

describe("CodeEditController: edit mode (INV-85, INV-88) and the JSON fold (INV-92)", () => {
  let preview;
  let clock;

  /** The controller with a real CodeEditor in a preview, and the edit host calls. */
  function withEditor() {
    preview = document.createElement("div");
    document.body.append(preview);
    clock = 0;
    Object.assign(host, {
      codeEditModeChanged: vi.fn(),
      showCodeText: vi.fn(),
      codeTextChanged: vi.fn(),
      codeTextSettled: vi.fn(),
    });
    const createEditor = vi.fn((editorHost) => new CodeEditor(preview, editorHost));
    ctrl = new CodeEditController(access, dialog, host, { createEditor, highlight: () => null, now: () => clock });
    return createEditor;
  }

  const textarea = () => preview.querySelector("textarea.code-edit-input");
  function type(value) {
    textarea().value = value;
    textarea().setSelectionRange(value.length, value.length);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  }

  afterEach(() => {
    ctrl.close();
    preview?.remove();
    preview = null;
  });

  it("AT-CEC-26 toggleEdit: the editor (made once) starts on the document's text; the host hears of edit mode; again: the view shows the edited text", async () => {
    const createEditor = withEditor();
    await open(utf8("a\n"));
    ctrl.toggleEdit();
    expect([ctrl.isEditing(), textarea().value, host.codeEditModeChanged.mock.calls]).toEqual([true, "a\n", [[true]]]);
    type("ab\n");
    expect([ctrl.currentText(), ctrl.isDirty(), host.codeTextChanged.mock.calls.length]).toEqual(["ab\n", true, 1]);
    ctrl.toggleEdit();
    expect([ctrl.isEditing(), textarea(), ctrl.currentText(), ctrl.isDirty()]).toEqual([false, null, "ab\n", true]);
    expect(host.showCodeText.mock.calls).toEqual([["ab\n", true]]);
    expect(host.codeEditModeChanged.mock.calls).toEqual([[true], [false]]);
    ctrl.toggleEdit();
    expect(createEditor).toHaveBeenCalledTimes(1);
  });

  it("AT-CEC-49 (INV-85 (1), NE-32) edit mode on a file of 200 KB or more (its bytes): one toast, once a document; under it none; a Reload or another file tells again", async () => {
    withEditor();
    const big = utf8("x".repeat(CONFIG.codeEdit.slowEditBytes - 2) + A); // the hiragana is 3 bytes: 1 byte over, 1 char under
    await open(big);
    ctrl.toggleEdit();
    expect(host.toast.mock.calls).toEqual([[m.codeEdit.slowEdit]]);
    ctrl.toggleEdit();
    ctrl.toggleEdit();
    expect(host.toast).toHaveBeenCalledTimes(1);
    ctrl.toggleEdit();
    const reload = ctrl.reloadReader();
    await reload.readText(file(big, "a.py"));
    reload.commit();
    ctrl.toggleEdit();
    expect(host.toast).toHaveBeenCalledTimes(2);
    ctrl.toggleEdit();
    await open(utf8("x".repeat(CONFIG.codeEdit.slowEditBytes - 1)));
    ctrl.toggleEdit();
    expect(host.toast).toHaveBeenCalledTimes(2);
    expect(m.codeEdit.slowEdit).toBe("This file is 200 KB or larger. Showing and editing it may take time.");
  });

  it("AT-CEC-50 (INV-85 (9), NE-32, review 3 P4) the size is the file's size now: a file saved at 200 KB or more tells on the next edit mode", async () => {
    withEditor();
    await open(utf8("a\n"));
    ctrl.toggleEdit();
    type("x".repeat(CONFIG.codeEdit.slowEditBytes));
    await ctrl.save();
    expect(ctrl.document.fileBytes).toBe(CONFIG.codeEdit.slowEditBytes);
    ctrl.toggleEdit();
    host.toast.mockClear();
    ctrl.toggleEdit();
    expect(host.toast.mock.calls).toEqual([[m.codeEdit.slowEdit]]);
  });

  it("AT-CEC-27 without an editor factory (or a document), toggleEdit does nothing", async () => {
    ctrl.toggleEdit();
    await open(utf8("a\n"));
    ctrl.toggleEdit();
    expect([ctrl.isEditing(), ctrl.editor]).toEqual([false, null]);
  });

  it("AT-CEC-28 the Undo history is kept across edit modes, and new for another file, a Reload and a close", async () => {
    withEditor();
    await open(utf8("a\n"));
    ctrl.toggleEdit();
    type("ab\n");
    ctrl.toggleEdit();
    ctrl.toggleEdit();
    expect([ctrl.canUndo(), ctrl.undo(), textarea().value]).toEqual([true, true, "a\n"]);
    ctrl.toggleEdit();
    const reader = ctrl.reloadReader();
    await reader.readText(file(utf8("r\n")));
    reader.commit();
    ctrl.toggleEdit();
    expect([textarea().value, ctrl.canUndo()]).toEqual(["r\n", false]);
    ctrl.close();
    expect([ctrl.isEditing(), host.codeEditModeChanged.mock.calls.at(-1)]).toEqual([false, [false]]);
  });

  it("AT-CEC-29 Save while editing writes the editor's text and edit mode stays", async () => {
    withEditor();
    await open(utf8("a\n"));
    ctrl.toggleEdit();
    type("typed\n");
    await ctrl.save();
    expect(bytesOf(access.writes[0].text)).toEqual(bytesOf(utf8("typed\n")));
    expect([ctrl.isEditing(), ctrl.isDirty(), textarea().value]).toEqual([true, false, "typed\n"]);
  });

  it("AT-CEC-30 a file opened, or the code view closed, while editing: the editor stops without drawing the view", async () => {
    withEditor();
    await open(utf8("a\n"));
    ctrl.toggleEdit();
    type("b\n");
    await open(utf8("other\n"), { name: "b.py" });
    expect([ctrl.isEditing(), textarea(), host.showCodeText.mock.calls.length]).toEqual([false, null, 0]);
    expect(host.codeEditModeChanged.mock.calls).toEqual([[true], [false]]);
  });

  it("AT-CEC-31 fold in the view: the text shown changes, the document does not (not unsaved); edit mode starts from the document's text", async () => {
    withEditor();
    await open(utf8('{\n  "a": {\n    "b": 1\n  }\n}\n'), { name: "x.json" });
    ctrl.fold("fold");
    expect(host.showCodeText.mock.calls).toEqual([['{\n  "a": { "b": 1 }\n}\n', false]]);
    expect([ctrl.shownText(), ctrl.isDirty()]).toEqual(['{\n  "a": { "b": 1 }\n}\n', false]);
    ctrl.fold("unfold");
    expect(host.showCodeText.mock.calls[1]).toEqual(['{\n  "a": {\n    "b": 1\n  }\n}\n', false]);
    ctrl.fold("fold");
    ctrl.toggleEdit();
    expect(textarea().value).toBe('{\n  "a": {\n    "b": 1\n  }\n}\n');
  });

  it("AT-CEC-32 (INV-92, INV-86 (4)) fold in the editor: its text, as one undo step; unsaved; Search and the Index follow at the typing pause, not in the operation (N1)", async () => {
    withEditor();
    await open(utf8('{\n  "a": {\n    "b": 1\n  }\n}\n'), { name: "x.json" });
    ctrl.toggleEdit();
    vi.useFakeTimers();
    ctrl.fold("fold");
    expect([textarea().value, ctrl.currentText(), ctrl.isDirty()]).toEqual(['{\n  "a": { "b": 1 }\n}\n', '{\n  "a": { "b": 1 }\n}\n', true]);
    expect(host.codeTextSettled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CONFIG.codeEdit.highlightPauseMs);
    expect(host.codeTextSettled).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    ctrl.undo();
    expect([textarea().value, ctrl.isDirty()]).toEqual(['{\n  "a": {\n    "b": 1\n  }\n}\n', false]);
  });

  it.each([
    ["not JSON", "a.txt", "{}", "fold", m.codeEdit.foldJsonOnly],
    ["not readable", "x.json", "{ oops", "fold", m.codeEdit.foldInvalid],
    ["nothing more to fold", "x.json", '{ "a": 1 }', "fold", m.codeEdit.nothingToFold],
    ["nothing more to unfold", "x.json", '{\n  "a": 1\n}', "unfold", m.codeEdit.nothingToUnfold],
  ])("AT-CEC-33 fold, %s: the toast, nothing changes", async (_name, name, text, direction, message) => {
    withEditor();
    await open(utf8(text), { name });
    ctrl.fold(direction);
    expect(host.toast.mock.calls).toEqual([[message]]);
    expect(host.showCodeText).not.toHaveBeenCalled();
    expect(ctrl.shownText()).toBe(text);
  });

  it("AT-CEC-41 L24: unfold uses the indent unit of the file (inferred once), not one inferred from the folded text shown", async () => {
    withEditor();
    // 4-space steps under a 2-space first level: the file's unit is 4
    const text = '{\n  "a": {\n      "b": {\n          "x": 1\n      },\n      "c": {\n          "y": 2\n      }\n  }\n}\n';
    await open(utf8(text), { name: "x.json" });
    ctrl.fold("fold");
    ctrl.fold("fold"); // the text shown has only the 2-space first level now
    ctrl.fold("unfold");
    expect(ctrl.shownText()).toBe('{\n  "a": {\n      "b": { "x": 1 },\n      "c": { "y": 2 }\n  }\n}\n');
    // in the editor: the unit the editor inferred when editing started
    ctrl.toggleEdit();
    expect(ctrl.editor.indentUnit).toBe("    ");
    ctrl.fold("fold");
    ctrl.fold("fold");
    ctrl.fold("unfold");
    expect(textarea().value).toBe('{\n  "a": {\n      "b": { "x": 1 },\n      "c": { "y": 2 }\n  }\n}\n');
  });

  it("AT-CEC-42 M1: typing compares no texts for the unsaved mark (count-based); asked otherwise, it is exact", async () => {
    withEditor();
    await open(utf8("same\n"));
    ctrl.toggleEdit();
    const compare = vi.spyOn(Object.getPrototypeOf(ctrl.document), "isDirty");
    type("samX\n"); // the same length as the saved text
    type("same\n"); // typed back
    expect(ctrl.isDirty(true)).toBe(true); // the mark while typing: not compared yet
    expect(compare).not.toHaveBeenCalled();
    expect(ctrl.isDirty()).toBe(false); // INV-21 asks: compared now
    expect(compare).toHaveBeenCalledTimes(1);
    type("same!\n"); // another length: unsaved without a comparison
    expect([ctrl.isDirty(true), ctrl.isDirty(), compare.mock.calls.length]).toEqual([true, true, 1]);
  });

  it("AT-CEC-43 L6 / INV-90 (7): a Save as to a name of another language while editing colors the editor in it at once", async () => {
    const picked = fakeFileHandle({ name: "notes.py", calls: access.calls });
    access = fakeFileAccess({ picker: Promise.resolve(picked), calls: access.calls });
    preview = document.createElement("div");
    document.body.append(preview);
    Object.assign(host, { codeEditModeChanged: vi.fn(), showCodeText: vi.fn(), codeTextChanged: vi.fn(), codeTextSettled: vi.fn() });
    const highlight = vi.fn((text, language) => (language === "python" ? `<span class="py">${text}</span>` : null));
    ctrl = new CodeEditController(access, dialog, host, { createEditor: (h) => new CodeEditor(preview, h), highlight, now: () => 0 });
    await open(utf8("x = 1\n"), { name: "notes.txt" });
    ctrl.toggleEdit();
    expect(preview.querySelector(".code-edit-layer code").innerHTML).toBe("x = 1\n\n");
    await ctrl.saveAs();
    expect(highlight).toHaveBeenLastCalledWith("x = 1\n", "python");
    expect(preview.querySelector(".code-edit-layer code").innerHTML).toBe('<span class="py">x = 1\n</span>\n');
  });

  it("AT-CEC-46 INV-88 (5): the Undo history stays after a Save; an Undo then makes the document unsaved again", async () => {
    withEditor();
    await open(utf8("a\n"));
    ctrl.toggleEdit();
    type("ab\n");
    await ctrl.save();
    expect(ctrl.isDirty()).toBe(false);
    expect([ctrl.canUndo(), ctrl.undo(), textarea().value, ctrl.isDirty()]).toEqual([true, true, "a\n", true]);
  });

  it("AT-CEC-34 the language follows the file name (EXT_TO_HLJS); none: plaintext", async () => {
    withEditor();
    expect(ctrl.language()).toBe("plaintext");
    await open(utf8("{}"), { name: "x.JSON" });
    expect([ctrl.language(), ctrl.isJson()]).toEqual(["json", true]);
    await open(utf8("a"), { name: "Makefile" });
    expect(ctrl.language()).toBe("makefile");
    await open(utf8("a"), { name: "a.unknown" });
    expect([ctrl.language(), ctrl.isJson()]).toEqual(["plaintext", false]);
  });
});

describe("CodeEditController: a .md name is written in UTF-8 (INV-90 (6); NE-30)", () => {
  it("AT-CEC-44 L4: a UTF-8 file saved as .md: no savedMarkdownUtf8 toast (it was UTF-8 already)", async () => {
    const picked = fakeFileHandle({ name: "notes.md", calls: access.calls });
    access = fakeFileAccess({ picker: Promise.resolve(picked), calls: access.calls });
    ctrl = new CodeEditController(access, dialog, host);
    await open(utf8("# a\n"), { name: "notes.txt" });
    await ctrl.saveAs();
    expect(host.toast.mock.calls).toEqual([[m.edit.saved("notes.md")]]);
    expect(host.reopenAsMarkdown).toHaveBeenCalledTimes(1);
  });

  async function sjisDoc(text, name = "old.txt") {
    dialog.askOpen.mockResolvedValue({ encoding: "shift_jis", lineEndingMode: "\r\n" });
    await open(sjis(text.replace(/\n/g, "\r\n")), { name });
  }

  it("AT-CEC-35 Save as of a Shift_JIS file to notes.md, original chosen: UTF-8 bytes (no BOM, line endings kept), the toast, reopened in the Markdown view", async () => {
    const picked = fakeFileHandle({ name: "notes.MD" });
    access = fakeFileAccess({ picker: Promise.resolve(picked) });
    ctrl = new CodeEditController(access, dialog, host);
    await sjisDoc(`# ${A}\n`);
    dialog.askSaveEncoding.mockResolvedValue("original");
    await ctrl.saveAs();
    expect(dialog.askSaveEncoding).toHaveBeenCalledTimes(1);
    expect(bytesOf(access.writes[0].text)).toEqual(bytesOf(utf8(`# ${A}\r\n`)));
    expect(host.toast.mock.calls).toEqual([[m.edit.saved("notes.MD")], [m.codeEdit.savedMarkdownUtf8]]);
    const [reopened] = host.reopenAsMarkdown.mock.calls[0];
    expect(await reopened.text()).toBe(`# ${A}\r\n`);
    // UTF-8 chosen: no such toast
    await sjisDoc(`# ${A}\n`);
    host.toast.mockClear();
    dialog.askSaveEncoding.mockResolvedValue("utf-8");
    await ctrl.saveAs();
    expect(host.toast.mock.calls).toEqual([[m.edit.saved("notes.MD")]]);
  });

  it("AT-CEC-36 (INV-90 (3)(6), NE-31) Save as: characters the chosen encoding cannot write are asked about before the save dialog (it may create the file), whatever name would be picked; [Save in UTF-8] opens it and writes UTF-8", async () => {
    const picked = fakeFileHandle({ name: "notes.md" });
    access = fakeFileAccess({ picker: Promise.resolve(picked) });
    ctrl = new CodeEditController(access, dialog, host);
    await sjisDoc(`${A}\n`);
    ctrl.updateText(`${EMOJI}\n`);
    dialog.askSaveEncoding.mockResolvedValue("original");
    await ctrl.saveAs(); // Cancel
    expect(dialog.askSaveUtf8.mock.calls).toEqual([["shift_jis", "1"]]);
    expect([access.calls, access.writes.length]).toEqual([[], 0]);
    dialog.askSaveUtf8.mockResolvedValue(true);
    await ctrl.saveAs();
    expect(access.calls).toEqual(["startSavePicker:old.txt", "writeFile:notes.md"]);
    expect(bytesOf(access.writes[0].text)).toEqual(bytesOf(utf8(`${EMOJI}\r\n`)));
    expect(host.toast.mock.calls).toEqual([[m.edit.saved("notes.md")]]); // UTF-8 chosen: no .md toast
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("AT-CEC-37 (INV-90 (3)(6), NE-31) another name keeps the chosen encoding; a later Save as with characters it cannot write asks before the dialog", async () => {
    const picked = fakeFileHandle({ name: "copy.txt" });
    access = fakeFileAccess({ picker: Promise.resolve(picked) });
    ctrl = new CodeEditController(access, dialog, host);
    await sjisDoc(`${A}\n`);
    dialog.askSaveEncoding.mockResolvedValue("original");
    await ctrl.saveAs();
    expect(bytesOf(access.writes[0].text)).toEqual(bytesOf(sjis(`${A}\r\n`)));
    expect(host.toast.mock.calls).toEqual([[m.edit.saved("copy.txt")]]);
    ctrl.updateText(`${EMOJI}\n`);
    await ctrl.saveAs();
    expect(access.calls.filter((c) => c.startsWith("startSavePicker")).length).toBe(1);
    expect(access.writes).toHaveLength(1);
    expect(dialog.askSaveUtf8).toHaveBeenCalledTimes(1);
  });

  it("AT-CEC-38 Save as to a name of another language tells the host so (the view is colored again); the same language does not", async () => {
    const picked = fakeFileHandle({ name: "data.json", calls: access.calls });
    access = fakeFileAccess({ picker: Promise.resolve(picked), calls: access.calls });
    ctrl = new CodeEditController(access, dialog, host);
    await open(utf8("{}\n"));
    await ctrl.saveAs();
    expect(host.codeFileSaved.mock.calls[0][0].name).toBe("data.json");
    expect(host.codeFileSaved.mock.calls[0][2]).toBe(true);
    await ctrl.save();
    expect(host.codeFileSaved.mock.calls[1][2]).toBe(false);
  });
});
