import { describe, it, expect } from "vitest";
import CodeDocument, { singleLineEnding } from "../js/classes/CodeDocument.js";

// AT-CDOC: the code document (Entity; SC-27, INV-89, INV-90).

const A = "\u3042"; // Shift_JIS 0x82 0xA0
const KAN = "\u6F22"; // Shift_JIS 0x8A 0xBF
const EMOJI = "\u{1F600}"; // not in Shift_JIS

function doc(over = {}) {
  return CodeDocument.fromDecoded({
    fileName: "a.txt",
    lastModified: 1000,
    text: "x\r\ny\r\n",
    encoding: "utf-8",
    bom: false,
    lineEndingMode: "\r\n",
    ...over,
  });
}

const bytesOf = (r) => [...r.bytes];

describe("CodeDocument (INV-89, INV-90; spec 5.19.1)", () => {
  it("AT-CDOC-01 fromDecoded keeps the text with LF endings as the text and the saved text; clean, nothing remembered", () => {
    const d = doc({ text: "a\r\nb\rc\n" });
    expect(d.text).toBe("a\nb\nc\n");
    expect(d.savedText).toBe("a\nb\nc\n");
    expect(d.isDirty()).toBe(false);
    expect(d.saveEncoding).toBeNull();
    expect(d.original).toBeNull();
    expect([d.fileName, d.lastModified, d.encoding, d.bom, d.lineEndingMode]).toEqual(["a.txt", 1000, "utf-8", false, "\r\n"]);
    expect(Object.isFrozen(d)).toBe(true);
  });

  it("AT-CDOC-02 'keep' records the lines and endings; unchanged text is written back with the same mixed endings", () => {
    const d = doc({ text: "a\r\nb\nc\r\nd", lineEndingMode: "keep" });
    expect(d.original).toEqual({ lines: ["a", "b", "c", "d"], endings: ["\r\n", "\n", "\r\n"] });
    expect(new TextDecoder().decode(d.toBytes(d.text, "utf-8").bytes)).toBe("a\r\nb\nc\r\nd");
    // a line changed in the middle: the lines around it keep theirs, it gets the majority (CRLF)
    const edited = d.withText("a\nB\nc\nd");
    expect(new TextDecoder().decode(edited.toBytes(edited.text, "utf-8").bytes)).toBe("a\r\nB\r\nc\r\nd");
  });

  it("AT-CDOC-03 withText makes it dirty; the saved text again makes it clean", () => {
    const d = doc();
    const typed = d.withText("x\nyz\n");
    expect(typed.isDirty()).toBe(true);
    expect(typed.savedText).toBe("x\ny\n");
    expect(typed.withText("x\ny\n").isDirty()).toBe(false);
    expect(d.isDirty()).toBe(false); // immutable
  });

  it("AT-CDOC-04 toBytes applies the line ending and the encoding: Shift_JIS with CRLF", () => {
    const d = doc({ text: `x${A}\r\ny${KAN}\r\n`, encoding: "shift_jis" });
    expect(bytesOf(d.toBytes(d.text, "shift_jis"))).toEqual([0x78, 0x82, 0xa0, 0x0d, 0x0a, 0x79, 0x8a, 0xbf, 0x0d, 0x0a]);
    // UTF-8 chosen for it: CRLF stays, no BOM
    expect(bytesOf(d.toBytes(d.text, "utf-8"))).toEqual([0x78, 0xe3, 0x81, 0x82, 0x0d, 0x0a, 0x79, 0xe6, 0xbc, 0xa2, 0x0d, 0x0a]);
  });

  it("AT-CDOC-05 the BOM is written in the document's own encoding only", () => {
    const utf8Bom = doc({ text: "a", bom: true, lineEndingMode: "\n" });
    expect(bytesOf(utf8Bom.toBytes("a", "utf-8"))).toEqual([0xef, 0xbb, 0xbf, 0x61]);
    const utf16 = doc({ text: "a", encoding: "utf-16le", bom: true, lineEndingMode: "\n" });
    expect(bytesOf(utf16.toBytes("a", "utf-16le"))).toEqual([0xff, 0xfe, 0x61, 0x00]);
    expect(bytesOf(utf16.toBytes("a", "utf-8"))).toEqual([0x61]);
  });

  it("AT-CDOC-06 characters the encoding cannot write: their lines, and no bytes", () => {
    const d = doc({ text: `a\n${EMOJI}\nb\nc${EMOJI}`, encoding: "shift_jis", lineEndingMode: "\n" });
    const r = d.toBytes(d.text, "shift_jis");
    expect(r.unencodableLines).toEqual([2, 4]);
    expect(r.bytes.length).toBe(0);
  });

  it("AT-CDOC-07 withSaved in its own encoding: new name, time and saved text; the typed text stays unsaved", () => {
    const d = doc({ encoding: "shift_jis", text: "x\r\n" }).withSaveEncoding("original").withText("x\nmore\n");
    const saved = d.withSaved("x\nmore\n", "b.txt", 5000, "shift_jis").withText("x\nmore\nagain\n");
    expect([saved.fileName, saved.lastModified, saved.encoding, saved.saveEncoding]).toEqual(["b.txt", 5000, "shift_jis", "original"]);
    expect(saved.savedText).toBe("x\nmore\n");
    expect(saved.isDirty()).toBe(true);
    expect(d.withSaved("x\nmore\n", "a.txt", null, "shift_jis").lastModified).toBeNull();
  });

  it("AT-CDOC-08 withSaved in UTF-8 for another encoding: UTF-8 from now on, no BOM, nothing remembered", () => {
    const d = doc({ encoding: "utf-16le", bom: true }).withSaveEncoding("original");
    const saved = d.withSaved(d.text, "a.txt", 2000, "utf-8");
    expect([saved.encoding, saved.bom, saved.saveEncoding]).toEqual(["utf-8", false, null]);
  });

  it("AT-CDOC-09 'keep' after a save: the next save keeps the endings that were written", () => {
    const d = doc({ text: "a\r\nb\nc", lineEndingMode: "keep" });
    // a new line in the middle gets the majority ending (tie: LF)
    const first = d.withText("a\nnew\nb\nc");
    expect(new TextDecoder().decode(first.toBytes(first.text, "utf-8").bytes)).toBe("a\r\nnew\nb\nc");
    const saved = first.withSaved(first.text, "a.txt", 2000, "utf-8");
    expect(saved.original).toEqual({ lines: ["a", "new", "b", "c"], endings: ["\r\n", "\n", "\n"] });
    expect(new TextDecoder().decode(saved.toBytes(saved.text, "utf-8").bytes)).toBe("a\r\nnew\nb\nc");
  });

  it("AT-CDOC-10 withReloaded keeps the encoding and the mode; text, saved text, time and BOM come from the file", () => {
    const d = doc({ text: "a\r\nb\n", lineEndingMode: "keep", encoding: "shift_jis" }).withText("typed");
    const r = d.withReloaded("z\nw\r\n", 7000, false);
    expect([r.encoding, r.lineEndingMode, r.lastModified, r.bom, r.text, r.savedText]).toEqual(["shift_jis", "keep", 7000, false, "z\nw\n", "z\nw\n"]);
    expect(r.original).toEqual({ lines: ["z", "w", ""], endings: ["\n", "\r\n"] });
    expect(r.isDirty()).toBe(false);
  });

  it("AT-CDOC-11 singleLineEnding: the one ending present, LF when none", () => {
    expect(singleLineEnding({ crlf: 3, lf: 0, cr: 0 })).toBe("\r\n");
    expect(singleLineEnding({ crlf: 0, lf: 2, cr: 0 })).toBe("\n");
    expect(singleLineEnding({ crlf: 0, lf: 0, cr: 1 })).toBe("\r");
    expect(singleLineEnding({ crlf: 0, lf: 0, cr: 0 })).toBe("\n");
  });
});
