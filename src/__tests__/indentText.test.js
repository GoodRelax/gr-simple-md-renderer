import { describe, it, expect } from "vitest";
import { inferIndentUnit, indentLines, outdentLines, leadingIndentAt } from "../js/indentText.js";

// NE-5: Tab / Shift+Tab over the selected lines, the indent unit read from
// the file, and the indent Enter carries.

describe("indentText (INV-87; NE-5)", () => {
  it("AT-IND-01 infers a tab when more indented lines start with a tab than with a space", () => {
    expect(inferIndentUnit("a:\n\tb\n\tc\n  d\n")).toBe("\t");
  });

  it("AT-IND-02 infers the most common increase of leading spaces (2, 4 or 8)", () => {
    expect(inferIndentUnit("a\n  b\n    c\n  d\ne\n  f\n")).toBe("  ");
    expect(inferIndentUnit("def f():\n    x = 1\n    if x:\n        y\n")).toBe("    ");
    expect(inferIndentUnit("a\n        b\nc\n        d\n")).toBe(" ".repeat(8));
  });

  it("AT-IND-03 a tie between increases takes the smaller; blank lines between do not break the pair", () => {
    expect(inferIndentUnit("a\n  b\nc\n    d\n")).toBe("  ");
    expect(inferIndentUnit("a\n\n   \n    b\n")).toBe("    ");
  });

  it("AT-IND-04 increases other than 2, 4, 8 are not counted; no indent gives the fallback", () => {
    expect(inferIndentUnit("a\n   b\n      c\n")).toBe("    ");
    expect(inferIndentUnit("a\nb\n", "\t")).toBe("\t");
    expect(inferIndentUnit("", "  ")).toBe("  ");
  });

  it("AT-IND-05 Tab at a caret indents its line and the caret moves with its text", () => {
    expect(indentLines("ab\ncd", 4, 4, "  ")).toEqual({ text: "ab\n  cd", start: 6, end: 6 });
    expect(indentLines("ab\ncd", 3, 3, "\t")).toEqual({ text: "ab\n\tcd", start: 4, end: 4 });
    expect(indentLines("", 0, 0, "  ")).toEqual({ text: "  ", start: 2, end: 2 });
  });

  it("AT-IND-06 Tab on a selection inside one line indents the line and keeps the selection on the same text", () => {
    expect(indentLines("x\nabcd\ny", 3, 5, "  ")).toEqual({ text: "x\n  abcd\ny", start: 5, end: 7 });
  });

  it("AT-IND-07 Tab on lines: every touched line, empty lines skipped, the selection starts at the first line's start", () => {
    const text = "a\nbb\n\ncc\ndd";
    // from inside "bb" to inside "cc"
    expect(indentLines(text, 3, 7, "  ")).toEqual({ text: "a\n  bb\n\n  cc\ndd", start: 2, end: 11 });
  });

  it("AT-IND-08 a selection that ends at a line's start does not touch that line", () => {
    expect(indentLines("aa\nbb\ncc", 0, 6, "\t")).toEqual({ text: "\taa\n\tbb\ncc", start: 0, end: 8 });
  });

  it("AT-IND-09 Shift+Tab removes one unit, else one tab, else up to unit.length spaces", () => {
    expect(outdentLines("    a\n\tb\n  c\nd", 0, 13, "    ")).toEqual({ text: "a\nb\nc\nd", start: 0, end: 6 });
    expect(outdentLines("      a", 0, 0, "    ")).toEqual({ text: "  a", start: 0, end: 0 });
    expect(outdentLines("\t\ta", 3, 3, "\t")).toEqual({ text: "\ta", start: 2, end: 2 });
  });

  it("AT-IND-10 Shift+Tab: a caret in the removed indent goes to the line start; after it moves back with its text", () => {
    expect(outdentLines("x\n    abc", 4, 4, "    ")).toEqual({ text: "x\nabc", start: 2, end: 2 });
    expect(outdentLines("x\n    abc", 8, 8, "    ")).toEqual({ text: "x\nabc", start: 4, end: 4 });
  });

  it("AT-IND-11 Shift+Tab on a line without indent changes nothing", () => {
    expect(outdentLines("abc\ndef", 5, 5, "  ")).toEqual({ text: "abc\ndef", start: 5, end: 5 });
  });

  it("AT-IND-12 indent then outdent gives the text back", () => {
    const text = "if x:\n    a\n    b\n";
    const ind = indentLines(text, 6, 17, "    ");
    expect(ind.text).toBe("if x:\n        a\n        b\n");
    const out = outdentLines(ind.text, ind.start, ind.end, "    ");
    expect(out).toEqual({ text, start: 6, end: 17 });
  });

  it("AT-IND-13 leadingIndentAt gives the line's leading white space, up to the offset", () => {
    const text = "a\n  \tb c\nd";
    expect(leadingIndentAt(text, 8)).toBe("  \t");
    expect(leadingIndentAt(text, 3)).toBe(" ");
    expect(leadingIndentAt(text, 10)).toBe("");
    expect(leadingIndentAt("\n  x", 0)).toBe("");
    expect(leadingIndentAt("    x", 5)).toBe("    ");
  });
});
