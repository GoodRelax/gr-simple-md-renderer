import { describe, it, expect } from "vitest";
import {
  TEXT_ENCODINGS,
  detectBom,
  decodeFileBytes,
  decodeAs,
  buildReverseTable,
  encodeText,
  countLineEndings,
  hasMixedLineEndings,
  lineEndingsOf,
  applyLineEndings,
} from "../js/textEncoding.js";

// NE-6, NE-15, NE-16, NE-24, NE-25: reading and writing the text encodings
// of non-.md files, and their line endings. Non-ASCII text is written with
// \u escapes.

const KONNICHIWA = "\u3053\u3093\u306B\u3061\u306F"; // hiragana "konnichiwa"
const KANJI = "\u6F22"; // "kan"
const SJIS_KONNICHIWA = [0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd];
const EUC_KONNICHIWA = [0xa4, 0xb3, 0xa4, 0xf3, 0xa4, 0xcb, 0xa4, 0xc1, 0xa4, 0xcf];
const bytes = (list) => Uint8Array.from(list);
const list = (u8) => Array.from(u8);

describe("textEncoding (INV-89, INV-90; NE-6, NE-15, NE-24, NE-25)", () => {
  it("AT-ENC-01 lists the five encodings with WHATWG labels", () => {
    expect(TEXT_ENCODINGS).toEqual(["utf-8", "shift_jis", "euc-jp", "utf-16le", "utf-16be"]);
  });

  it("AT-ENC-02 detects the UTF-8, UTF-16LE and UTF-16BE BOMs and nothing else", () => {
    expect(detectBom(bytes([0xef, 0xbb, 0xbf, 0x41]))).toBe("utf-8");
    expect(detectBom(bytes([0xff, 0xfe, 0x41, 0x00]))).toBe("utf-16le");
    expect(detectBom(bytes([0xfe, 0xff, 0x00, 0x41]))).toBe("utf-16be");
    expect(detectBom(bytes([0xef, 0xbb]))).toBeNull();
    expect(detectBom(bytes([0x41, 0x42]))).toBeNull();
    expect(detectBom(bytes([]))).toBeNull();
  });

  it("AT-ENC-03 valid UTF-8 without a BOM: valid, bom false", () => {
    const u8 = new TextEncoder().encode("a" + KANJI + "\n");
    expect(decodeFileBytes(u8)).toEqual({ text: "a" + KANJI + "\n", encoding: "utf-8", bom: false, valid: true });
  });

  it("AT-ENC-04 UTF-8 with a BOM: the BOM is stripped, bom true, valid", () => {
    expect(decodeFileBytes(bytes([0xef, 0xbb, 0xbf, 0x61, 0x62]))).toEqual({ text: "ab", encoding: "utf-8", bom: true, valid: true });
  });

  it("AT-ENC-05 a BOM with broken UTF-8 after it is decoded with replacement chars and is not valid", () => {
    expect(decodeFileBytes(bytes([0xef, 0xbb, 0xbf, 0x61, 0xff]))).toEqual({ text: "a\uFFFD", encoding: "utf-8", bom: true, valid: false });
  });

  it("AT-ENC-06 Shift_JIS bytes are guessed as shift_jis, not valid", () => {
    expect(decodeFileBytes(bytes(SJIS_KONNICHIWA))).toEqual({ text: KONNICHIWA, encoding: "shift_jis", bom: false, valid: false });
  });

  it("AT-ENC-07 EUC-JP bytes (also valid Shift_JIS as half-width katakana) are guessed as euc-jp", () => {
    expect(decodeFileBytes(bytes(EUC_KONNICHIWA))).toEqual({ text: KONNICHIWA, encoding: "euc-jp", bom: false, valid: false });
  });

  it("AT-ENC-08 Shift_JIS half-width katakana stays shift_jis when it is not valid EUC-JP", () => {
    // 0xB1 0xB2 0xB3 = half-width "a i u"; 0x82 0xA0 = hiragana "a" (0x82 is no EUC-JP lead)
    expect(decodeFileBytes(bytes([0xb1, 0xb2, 0xb3, 0x82, 0xa0]))).toEqual({
      text: "\uFF71\uFF72\uFF73\u3042",
      encoding: "shift_jis",
      bom: false,
      valid: false,
    });
  });

  it("AT-ENC-09 bytes that no encoding decodes fall back to shift_jis with replacement chars", () => {
    const r = decodeFileBytes(bytes([0x61, 0x81, 0x20, 0xff, 0xfd]));
    expect(r.encoding).toBe("shift_jis");
    expect(r.valid).toBe(false);
    expect(r.bom).toBe(false);
    expect(r.text).toBe(decodeAs(bytes([0x61, 0x81, 0x20, 0xff, 0xfd]), "shift_jis"));
    expect(r.text).toContain("\uFFFD");
  });

  it("AT-ENC-10 UTF-16LE and UTF-16BE with a BOM are decoded, BOM stripped, not valid (not UTF-8)", () => {
    expect(decodeFileBytes(bytes([0xff, 0xfe, 0x41, 0x00, 0x22, 0x6f]))).toEqual({ text: "A" + KANJI, encoding: "utf-16le", bom: true, valid: false });
    expect(decodeFileBytes(bytes([0xfe, 0xff, 0x00, 0x41, 0x6f, 0x22]))).toEqual({ text: "A" + KANJI, encoding: "utf-16be", bom: true, valid: false });
  });

  it("AT-ENC-11 decodeAs decodes non-strictly and strips only the BOM of its own encoding", () => {
    expect(decodeAs(bytes([0xef, 0xbb, 0xbf, 0x61]), "utf-8")).toBe("a");
    expect(decodeAs(bytes([0xff, 0xfe, 0x61, 0x00]), "utf-16le")).toBe("a");
    expect(decodeAs(bytes(SJIS_KONNICHIWA), "shift_jis")).toBe(KONNICHIWA);
    expect(decodeAs(bytes([0x61, 0xff]), "utf-8")).toBe("a\uFFFD");
  });

  it("AT-ENC-12 round trip: decodeFileBytes then encodeText gives the same bytes (shift_jis, euc-jp, utf-16le, utf-16be, utf-8 + BOM)", () => {
    const samples = [
      bytes([0x61, 0x0d, 0x0a, ...SJIS_KONNICHIWA, 0x0a, 0x8a, 0xbf, 0x8e, 0x9a, 0xb1]), // + "kanji" in Shift_JIS, half-width "a"
      bytes([0x61, 0x0a, ...EUC_KONNICHIWA, 0xb4, 0xc1, 0xbb, 0xfa, 0x8e, 0xb1]), // + "kanji" in EUC-JP, half-width "a"
      bytes([0xff, 0xfe, 0x61, 0x00, 0x3d, 0xd8, 0x00, 0xde]), // "a" + U+1F600 as a surrogate pair
      bytes([0xfe, 0xff, 0x00, 0x61, 0xd8, 0x3d, 0xde, 0x00]),
      bytes([0xef, 0xbb, 0xbf, 0xe6, 0xbc, 0xa2, 0x0a]),
    ];
    const expected = ["shift_jis", "euc-jp", "utf-16le", "utf-16be", "utf-8"];
    samples.forEach((u8, i) => {
      const read = decodeFileBytes(u8);
      expect(read.encoding).toBe(expected[i]);
      const written = encodeText(read.text, read.encoding, read.bom);
      expect(written.unencodableLines).toEqual([]);
      expect(list(written.bytes)).toEqual(list(u8));
    });
  });

  it("AT-ENC-13 encodeText lists the 1-based lines with characters Shift_JIS cannot write and returns no bytes", () => {
    const r = encodeText("abc\n" + KANJI + "\n\uD83D\uDE00", "shift_jis", false);
    expect(r.unencodableLines).toEqual([3]);
    expect(r.bytes.length).toBe(0);
    const many = encodeText("\u00E9\n\nok\n\u20AC\u00E9", "euc-jp", false); // e-acute and the euro sign: not in JIS X 0208
    expect(many.unencodableLines).toEqual([1, 4]);
  });

  it("AT-ENC-14 the WHATWG encoder rules: U+00A5 -> 0x5C, U+203E -> 0x7E, U+2212 written as U+FF0D", () => {
    expect(list(encodeText("\u00A5\u203E\\~", "shift_jis", false).bytes)).toEqual([0x5c, 0x7e, 0x5c, 0x7e]);
    expect(list(encodeText("\u2212\uFF0D", "shift_jis", false).bytes)).toEqual([0x81, 0x7c, 0x81, 0x7c]);
    expect(list(encodeText("\u00A5\u2212", "euc-jp", false).bytes)).toEqual([0x5c, 0xa1, 0xdd]);
  });

  it("AT-ENC-15 half-width katakana: one byte in Shift_JIS, 0x8E + byte in EUC-JP", () => {
    expect(list(encodeText("\uFF71\uFF9F", "shift_jis", false).bytes)).toEqual([0xb1, 0xdf]);
    expect(list(encodeText("\uFF71\uFF9F", "euc-jp", false).bytes)).toEqual([0x8e, 0xb1, 0x8e, 0xdf]);
  });

  it("AT-ENC-16 Shift_JIS writes the first sequence of a character: NEC row 13 and IBM extensions, never leads 0xED-0xEF", () => {
    // Roman numeral one: 0x8754 (NEC row 13), also at 0xFA4A (IBM)
    expect(list(encodeText("\u2160", "shift_jis", false).bytes)).toEqual([0x87, 0x54]);
    // a kanji of the IBM extensions: 0xFA5C (IBM), also 0xED40 (NEC-selected), which is skipped
    expect(decodeAs(bytes([0xed, 0x40]), "shift_jis")).toBe(decodeAs(bytes([0xfa, 0x5c]), "shift_jis"));
    const ch = decodeAs(bytes([0xfa, 0x5c]), "shift_jis");
    expect(list(encodeText(ch, "shift_jis", false).bytes)).toEqual([0xfa, 0x5c]);
    const table = buildReverseTable("shift_jis");
    for (const code of table.values()) expect(code >> 8 >= 0xed && code >> 8 <= 0xef).toBe(false);
  });

  it("AT-ENC-17 every entry of both reverse tables decodes back to its own character", () => {
    for (const enc of ["shift_jis", "euc-jp"]) {
      const table = buildReverseTable(enc);
      expect(table.size).toBeGreaterThan(7000);
      for (const [cp, code] of table) {
        if (cp === 0xa5 || cp === 0x203e || cp === 0x2212) continue;
        const seq = code > 0xff ? [code >> 8, code & 0xff] : [code];
        expect(decodeAs(bytes(seq), enc).codePointAt(0), `${enc} U+${cp.toString(16)}`).toBe(cp);
      }
    }
  });

  it("AT-ENC-18 UTF-8 and UTF-16 encoding with and without BOM", () => {
    expect(list(encodeText("a" + KANJI, "utf-8", false).bytes)).toEqual([0x61, 0xe6, 0xbc, 0xa2]);
    expect(list(encodeText("a", "utf-8", true).bytes)).toEqual([0xef, 0xbb, 0xbf, 0x61]);
    expect(list(encodeText("a" + KANJI, "utf-16le", false).bytes)).toEqual([0x61, 0x00, 0x22, 0x6f]);
    expect(list(encodeText("a", "utf-16be", true).bytes)).toEqual([0xfe, 0xff, 0x00, 0x61]);
    expect(list(encodeText("a", "shift_jis", true).bytes)).toEqual([0x61]); // bom ignored
  });

  it("AT-ENC-19 a lone surrogate cannot be written in UTF-8 or UTF-16: its line is listed", () => {
    expect(encodeText("a\nb\ud800c", "utf-8", false)).toEqual({ bytes: new Uint8Array(0), unencodableLines: [2] });
    expect(encodeText("\udc00", "utf-16le", false).unencodableLines).toEqual([1]);
    expect(encodeText("\uD83D\uDE00", "utf-8", false).unencodableLines).toEqual([]);
  });

  it("AT-ENC-20 counts line endings: CRLF once as crlf, lone CR and LF", () => {
    expect(countLineEndings("a\r\nb\nc\rd\r\n")).toEqual({ crlf: 2, lf: 1, cr: 1 });
    expect(countLineEndings("")).toEqual({ crlf: 0, lf: 0, cr: 0 });
    expect(countLineEndings("\r\r\n\n")).toEqual({ crlf: 1, lf: 1, cr: 1 });
  });

  it("AT-ENC-21 mixed line endings: more than one kind present", () => {
    expect(hasMixedLineEndings({ crlf: 3, lf: 0, cr: 0 })).toBe(false);
    expect(hasMixedLineEndings({ crlf: 0, lf: 0, cr: 0 })).toBe(false);
    expect(hasMixedLineEndings({ crlf: 1, lf: 1, cr: 0 })).toBe(true);
    expect(hasMixedLineEndings({ crlf: 0, lf: 2, cr: 1 })).toBe(true);
  });

  it("AT-ENC-22 lineEndingsOf lists the ending after each line in order", () => {
    expect(lineEndingsOf("a\r\nb\nc\rd")).toEqual(["\r\n", "\n", "\r"]);
    expect(lineEndingsOf("x\r\n")).toEqual(["\r\n"]);
    expect(lineEndingsOf("none")).toEqual([]);
  });

  it("AT-ENC-23 applyLineEndings to one kind: every LF becomes it", () => {
    expect(applyLineEndings("a\nb\n", "\r\n")).toBe("a\r\nb\r\n");
    expect(applyLineEndings("a\nb\n", "\r")).toBe("a\rb\r");
    expect(applyLineEndings("a\nb", "\n")).toBe("a\nb");
  });

  it("AT-ENC-24 keep: an edit in the middle keeps the endings of the lines around it; new breaks get the majority", () => {
    const decoded = "l1\r\nl2\nl3\r\nl4\r\nl5\n";
    const original = { lines: "l1\nl2\nl3\nl4\nl5\n".split("\n"), endings: lineEndingsOf(decoded) };
    // l3 edited and a line inserted after it
    expect(applyLineEndings("l1\nl2\nL3\nnew\nl4\nl5\n", "keep", original)).toBe("l1\r\nl2\nL3\r\nnew\r\nl4\r\nl5\n");
    // unchanged text gives the decoded text back
    expect(applyLineEndings("l1\nl2\nl3\nl4\nl5\n", "keep", original)).toBe(decoded);
  });

  it("AT-ENC-25 keep: majority ties prefer LF, then CRLF; the last line has an ending only if the text ends with LF", () => {
    const tie = { lines: ["a", "b", "c"], endings: ["\r\n", "\n"] };
    expect(applyLineEndings("x\ny\nz", "keep", tie)).toBe("x\ny\nz");
    const crlfCr = { lines: ["a", "b", "c"], endings: ["\r", "\r\n"] };
    expect(applyLineEndings("x\ny\nz", "keep", crlfCr)).toBe("x\r\ny\r\nz");
    const crOnly = { lines: ["a", "b", "c"], endings: ["\r", "\r"] };
    expect(applyLineEndings("x\ny\nz\n", "keep", crOnly)).toBe("x\ry\rz\r");
    const none = { lines: ["a"], endings: [] };
    expect(applyLineEndings("a\nb", "keep", none)).toBe("a\nb");
  });

  it("AT-ENC-26 keep: a line appended at the end gets the majority, the old last line keeps its ending", () => {
    const original = { lines: ["a", "b", ""], endings: ["\r", "\r\n"] };
    expect(applyLineEndings("a\nb\nc\n", "keep", original)).toBe("a\rb\r\nc\r\n");
  });

  it("AT-ENC-28 (INV-90) the unencodable lines are counted on any line ending: CR, CRLF, LF and a mix give the LF text's numbers", () => {
    const lf = "a\n\uD83D\uDE00\nb\nc\uD83D\uDE00"; // an emoji on lines 2 and 4
    expect(encodeText(lf, "shift_jis", false).unencodableLines).toEqual([2, 4]);
    for (const mode of ["\r", "\r\n"]) {
      expect(encodeText(applyLineEndings(lf, mode), "shift_jis", false).unencodableLines, JSON.stringify(mode)).toEqual([2, 4]);
      expect(encodeText(applyLineEndings(lf, mode), "euc-jp", false).unencodableLines, JSON.stringify(mode)).toEqual([2, 4]);
    }
    expect(encodeText("a\r\n\uD83D\uDE00\rb\nc\uD83D\uDE00\r", "shift_jis", false).unencodableLines).toEqual([2, 4]);
    // "keep" (NE-25) with CR lines: the lines of the LF text
    const original = { lines: ["a", "x", "b", "c"], endings: ["\r", "\r", "\r"] };
    expect(encodeText(applyLineEndings(lf, "keep", original), "shift_jis", false).unencodableLines).toEqual([2, 4]);
    // a lone surrogate in UTF-8 and UTF-16
    expect(encodeText("a\rb\rc\ud800", "utf-8", false).unencodableLines).toEqual([3]);
    expect(encodeText("a\r\n\udc00\rb", "utf-16be", false).unencodableLines).toEqual([2]);
  });

  it("AT-ENC-27 encodeText on a 5 MB text runs in linear time", () => {
    const text = ("abc" + KONNICHIWA + KANJI + "\n").repeat(500000); // 5,000,000 chars
    const t0 = performance.now();
    const sjis = encodeText(text, "shift_jis", false);
    const utf16 = encodeText(text, "utf-16le", true);
    const utf8 = encodeText(text, "utf-8", false);
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(sjis.bytes.length).toBe(500000 * 16);
    expect(utf16.bytes.length).toBe(2 + text.length * 2);
    expect(utf8.bytes.length).toBe(500000 * 22);
  });
});
