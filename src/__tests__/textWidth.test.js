import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { displayWidth, codePointWidth, unpackRanges } from "../js/textWidth.js";

// INV-61 / 5.14.13: the width of a table cell in a full-width monospace font.
// F / W = 2; Mn / Me and zero-width characters (Cf except the visible
// prepended concatenation marks, variation selectors) = 0; everything else
// (Ambiguous, tab) = 1.

const here = dirname(fileURLToPath(import.meta.url));

describe("AT-TW displayWidth", () => {
  it.each([
    ["", 0],
    ["abc", 3],
    ["A1 !~", 5],
    ["\u6f22\u5b57", 4], // kanji
    ["\u304b\u306a\u30ab\u30ca", 8], // hiragana, katakana
    ["\uff21\uff11", 4], // full-width A 1
    ["\uff01\u3001\u3002", 6], // full-width punctuation
    ["\u3000", 2], // ideographic space
    ["\uff76\uff85", 2], // half-width katakana (H) = 1 each
    ["\u25cb", 1], // Ambiguous: white circle
    ["\u2460", 1], // Ambiguous: circled one
    ["\u03b1", 1], // Ambiguous: Greek alpha
    ["\u203b\u00d7", 2], // Ambiguous: reference mark, multiplication sign
    ["e\u0301", 1], // e + combining acute (Mn)
    ["\u0488", 0], // combining cyrillic hundred thousands sign (Me)
    ["\u200d", 0], // ZWJ (Cf)
    ["\u200b\u2060\ufeff\u00ad", 0], // zero-width space, word joiner, BOM, soft hyphen (Cf)
    ["\ufe0f", 0], // variation selector 16 (Mn)
    ["\udb40\udd00", 0], // variation selector 17, U+E0100 (surrogate pair)
    ["\t", 1],
    ["\ud840\udc0b", 2], // CJK extension B U+2000B (surrogate pair)
    ["\u0600", 1], // Arabic number sign: Cf but visible (prepended concatenation mark)
    ["\u304b\u3099", 2], // ka + combining voiced mark (W and Mn: 0)
    ["a|b\\|c", 6],
  ])("%j -> %i", (text, width) => {
    expect(displayWidth(text)).toBe(width);
  });

  it("known limits (5.14.13): a ZWJ emoji sequence adds up its parts; VS16 counts 1", () => {
    // man + ZWJ + woman: 2 + 0 + 2 (shown as one glyph of width 2)
    expect(displayWidth("\ud83d\udc68\u200d\ud83d\udc69")).toBe(4);
    // heavy black heart (N) + VS16: 1 + 0 (shown as 2)
    expect(displayWidth("\u2764\ufe0f")).toBe(1);
  });

  it.each([
    [0x10ff, 1],
    [0x1100, 2],
    [0x115f, 2],
    [0x1160, 1], // Hangul jungseong filler: Lo, N
    [0x303e, 2],
    [0x303f, 1],
    [0xff60, 2],
    [0xff61, 1],
    [0x1f1e6, 1], // regional indicator: N
    [0x1f600, 2], // emoji: W
    [0x1f3fb, 2], // skin tone modifier: W (known limit 5.14.13 (2))
    [0x20000, 2],
    [0x3fffd, 2], // unassigned, default W
    [0xe0001, 0], // language tag: Cf
  ])("boundary %d -> %i", (cp, width) => {
    expect(codePointWidth(cp)).toBe(width);
  });

  it.skipIf(process.versions.unicode !== "16.0")("the zero table is exactly Mn + Me + Cf minus the 13 prepended concatenation marks (Unicode 16.0)", () => {
    const marks = new Set([0x600, 0x601, 0x602, 0x603, 0x604, 0x605, 0x6dd, 0x70f, 0x890, 0x891, 0x8e2, 0x110bd, 0x110cd]);
    const re = /^[\p{Mn}\p{Me}\p{Cf}]$/u;
    const wrong = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const zero = re.test(String.fromCodePoint(cp)) && !marks.has(cp);
      if ((codePointWidth(cp) === 0) !== zero) wrong.push(cp.toString(16));
      if (wrong.length > 5) break;
    }
    expect(wrong).toEqual([]);
  });

  it("unpackRanges reads the packed tables: base-36 gaps and lengths, sorted and disjoint", () => {
    expect(unpackRanges("1.0,2.1,a.z")).toEqual([[1, 1], [3, 4], [14, 49]]);
    const src = readFileSync(resolve(here, "../js/textWidth.js"), "utf8");
    for (const name of ["WIDE_PACKED", "ZERO_PACKED"]) {
      const m = new RegExp(`const ${name} =([^;]+);`).exec(src);
      const packed = m[1].replace(/[\s"+]/g, "");
      const ranges = unpackRanges(packed);
      expect(ranges.length, name).toBeGreaterThan(100);
      for (let i = 0; i < ranges.length; i++) {
        expect(ranges[i][0] <= ranges[i][1], name).toBe(true);
        if (i > 0) expect(ranges[i][0] > ranges[i - 1][1], name).toBe(true);
      }
    }
  });

  it("the module names the Unicode version and how its tables were made, and reads no CONFIG / window / document", () => {
    const src = readFileSync(resolve(here, "../js/textWidth.js"), "utf8");
    expect(src).toMatch(/Unicode 16\.0\.0/);
    expect(src).toMatch(/EastAsianWidth\.txt/);
    expect(src).toMatch(/DerivedGeneralCategory\.txt/);
    expect(src).not.toMatch(/\bimport\b/);
    expect(src).not.toMatch(/\b(window|document|CONFIG)\b/);
  });
});
