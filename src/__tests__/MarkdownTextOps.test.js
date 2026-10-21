import { describe, it, expect } from "vitest";
import MarkdownTextOps from "../js/classes/MarkdownTextOps.js";
import { CONFIG } from "../js/config.js";
import { makeLexer } from "./helpers/samples.js";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";

const lex = makeLexer();
const blockTokens = (text) => lex(text).filter((t) => t.type !== "space");
const tableOf = (text) => {
  const t = blockTokens(text);
  expect(t).toHaveLength(1);
  expect(t[0].type).toBe("table");
  return t[0];
};
const cellTexts = (row) => row.map((c) => c.text);
const caretIn = (text, needle, delta = 1) => text.indexOf(needle) + delta;

describe("MarkdownTextOps (pure; marked is the reference for tables)", () => {
  // Bold / Italic go through formatRange (INV-67; toggleWrap was replaced).
  const lexBlocks = (src) => lex(src);
  const ctx = {
    lexBlocks,
    lexInline: (src) => {
      const marked = new Marked();
      marked.use(markedKatex({ throwOnError: false }));
      return new marked.Lexer(marked.defaults).inlineTokens(src);
    },
    colors: [],
  };
  const wrap = (text, s, e, kind) => MarkdownTextOps.formatRange(text, s, e, { kind }, ctx);

  it("AT-TXT-01 wraps the selection with ** and keeps the word selected", () => {
    expect(wrap("a word b", 2, 6, "strong")).toEqual({
      text: "a **word** b",
      selStart: 4,
      selEnd: 8,
    });
  });

  it("AT-TXT-02 unwraps when the markers surround the selection, or are inside it (Q6 a)", () => {
    expect(wrap("a **word** b", 4, 8, "strong")).toEqual({
      text: "a word b",
      selStart: 2,
      selEnd: 6,
    });
    expect(wrap("a **word** b", 2, 10, "strong")).toEqual({
      text: "a word b",
      selStart: 2,
      selEnd: 6,
    });
  });

  it("AT-TXT-03 does the same with * for italic, and does not take a bold marker as italic", () => {
    expect(wrap("a word b", 2, 6, "em").text).toBe("a *word* b");
    expect(wrap("a *word* b", 3, 7, "em")).toEqual({
      text: "a word b",
      selStart: 2,
      selEnd: 6,
    });
    expect(wrap("a **word** b", 4, 8, "em").text).toBe("a ***word*** b");
  });

  it("AT-TXT-04 an empty selection changes nothing (null)", () => {
    expect(wrap("a word b", 3, 3, "strong")).toBe(null);
  });

  const T = "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |";

  it("AT-TXT-05 insertTableRow adds an empty row under the caret line with the header's cell count", () => {
    const edit = MarkdownTextOps.insertTableRow(T, caretIn(T, "| 1 |"));
    const table = tableOf(edit.text);
    expect(table.rows).toHaveLength(3);
    expect(cellTexts(table.rows[0])).toEqual(["1", "2"]);
    expect(cellTexts(table.rows[1])).toEqual(["", ""]);
    expect(cellTexts(table.rows[2])).toEqual(["3", "4"]);
    const rowStart = edit.text.indexOf("| 1 | 2 |\n") + "| 1 | 2 |\n".length;
    const rowEnd = edit.text.indexOf("\n", rowStart);
    expect(edit.selStart).toBe(edit.selEnd);
    expect(edit.selStart).toBe(rowEnd);
  });

  it.each([
    ["header line", "| A"],
    ["delimiter line", "|---"],
  ])("AT-TXT-06 a caret on the %s inserts the row right under the delimiter (Q6 b)", (_n, needle) => {
    const edit = MarkdownTextOps.insertTableRow(T, caretIn(T, needle));
    const table = tableOf(edit.text);
    expect(table.rows).toHaveLength(3);
    expect(cellTexts(table.rows[0])).toEqual(["", ""]);
    expect(cellTexts(table.rows[1])).toEqual(["1", "2"]);
  });

  it("AT-TXT-07 insertTableColumn adds a column right of the caret column on every row", () => {
    const edit = MarkdownTextOps.insertTableColumn(T, caretIn(T, "| 2", 2));
    const table = tableOf(edit.text);
    expect(cellTexts(table.header)).toEqual(["A", "B", ""]);
    expect(cellTexts(table.rows[0])).toEqual(["1", "2", ""]);
    expect(cellTexts(table.rows[1])).toEqual(["3", "4", ""]);
    const caretLine = edit.text.indexOf("| 1 | 2 |  |");
    expect(edit.selStart).toBe(caretLine + "| 1 | 2 |  ".length);
    expect(edit.selEnd).toBe(edit.selStart);
    const first = MarkdownTextOps.insertTableColumn(T, caretIn(T, "| 1"));
    expect(cellTexts(tableOf(first.text).header)).toEqual(["A", "", "B"]);
  });

  it("AT-TXT-08 an escaped pipe in a cell is not a separator (same as marked)", () => {
    const t = "| Expr | Meaning |\n|---|---|\n| `a \\| b` | or |";
    const before = tableOf(t);
    expect(before.header).toHaveLength(2);
    const edit = MarkdownTextOps.insertTableColumn(t, caretIn(t, "| or", 2));
    const after = tableOf(edit.text);
    expect(after.header).toHaveLength(3);
    expect(after.rows[0]).toHaveLength(3);
    expect(after.rows[0][0].text).toBe(before.rows[0][0].text);
  });

  it("AT-TXT-09 an unescaped pipe inside a code span is a separator (same as marked)", () => {
    const t = "| A | B | C |\n|---|---|---|\n| `p | q` | r |\n| s | t | u |";
    expect(tableOf(t).header).toHaveLength(3);
    const edit = MarkdownTextOps.insertTableColumn(t, caretIn(t, "| s", 2));
    const after = tableOf(edit.text);
    expect(after.header).toHaveLength(4);
    for (const row of after.rows) expect(row).toHaveLength(4);
    expect(cellTexts(after.rows[1])).toEqual(["s", "", "t", "u"]);
  });

  it("AT-TXT-10 a table without outer pipes stays a table with one more column", () => {
    const t = "a | b\n--|--\n1 | 2";
    const edit = MarkdownTextOps.insertTableColumn(t, caretIn(t, "1", 0));
    const after = tableOf(edit.text);
    expect(cellTexts(after.header)).toEqual(["a", "", "b"]);
    expect(cellTexts(after.rows[0])).toEqual(["1", "", "2"]);
  });

  it("AT-TXT-11 existing alignments are kept and the new column has the default alignment", () => {
    const t = "| Left | Right | Center |\n|:--|--:|:-:|\n| l | r | c |";
    const edit = MarkdownTextOps.insertTableColumn(t, caretIn(t, "| r", 2));
    expect(tableOf(edit.text).align).toEqual(["left", "right", null, "center"]);
  });

  it("AT-TXT-12 insertBlockText in the middle of a paragraph adds blank lines around the block", () => {
    const text = "Para one two";
    const edit = MarkdownTextOps.insertBlockText(text, 8, CONFIG.edit.tableTemplate);
    expect(blockTokens(edit.text).map((t) => t.type)).toEqual(["paragraph", "table", "paragraph"]);
    const end = edit.text.indexOf(CONFIG.edit.tableTemplate) + CONFIG.edit.tableTemplate.length;
    expect(edit.selStart).toBe(end);
    expect(edit.selEnd).toBe(end);
  });

  it.each([
    ["start", "Para", 0, "B\n\nPara"],
    ["end", "Para", 4, "Para\n\nB"],
    ["end after a newline", "Para\n", 5, "Para\n\nB"],
    ["blank line already before", "A\n\nC", 3, "A\n\nB\n\nC"],
    ["blank line already after", "A\n\nC", 1, "A\n\nB\n\nC"],
    ["empty text", "", 0, "B"],
    ["offset out of range is clamped (Q6 d)", "A", 99, "A\n\nB"],
  ])("AT-TXT-13 insertBlockText never doubles blank lines (%s)", (_n, text, offset, expected) => {
    const edit = MarkdownTextOps.insertBlockText(text, offset, "B");
    expect(edit.text).toBe(expected);
    expect(edit.text).not.toContain("\n\n\n");
  });

  it("AT-TXT-14 insertTextAt puts <br> at the caret and moves the caret after it", () => {
    expect(MarkdownTextOps.insertTextAt("| a b |", 4, "<br>")).toEqual({
      text: "| a <br>b |",
      selStart: 8,
      selEnd: 8,
    });
  });

  it("AT-TXT-15 the templates from CONFIG.edit become a table and mermaid code blocks", () => {
    const table = blockTokens(MarkdownTextOps.insertBlockText("", 0, CONFIG.edit.tableTemplate).text);
    expect(table.map((t) => t.type)).toEqual(["table"]);
    for (const key of ["flowchart", "sequence", "state", "class"]) {
      const out = blockTokens(MarkdownTextOps.insertBlockText("", 0, CONFIG.edit.mermaidSamples[key]).text);
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe("code");
      expect(out[0].lang).toBe("mermaid");
    }
  });

  it("AT-TXT-16 same arguments give the same result; inputs are not changed", () => {
    const args = ["a word b", 2, 6, { kind: "strong" }, ctx];
    expect(MarkdownTextOps.formatRange(...args)).toEqual(MarkdownTextOps.formatRange(...args));
    expect(args[3]).toEqual({ kind: "strong" });
    expect(MarkdownTextOps.insertTableColumn(T, 3)).toEqual(MarkdownTextOps.insertTableColumn(T, 3));
    expect(MarkdownTextOps.insertBlockText("x", 1, "y")).toEqual(MarkdownTextOps.insertBlockText("x", 1, "y"));
  });
});

describe("MarkdownTextOps.changedRange (replace only the changed range, INV-52)", () => {
  const apply = (before, r) => before.slice(0, r.start) + r.text + before.slice(r.end);

  it.each([
    ["bold around a word", "Hello word here.", "Hello **word** here.", { start: 6, end: 10, text: "**word**" }],
    ["insert in the middle", "ab", "aXb", { start: 1, end: 1, text: "X" }],
    ["delete in the middle", "aXb", "ab", { start: 1, end: 2, text: "" }],
    ["append to a repeated run", "aaa", "aaaa", { start: 3, end: 3, text: "a" }],
    ["no change", "same", "same", { start: 4, end: 4, text: "" }],
    ["from empty", "", "new", { start: 0, end: 0, text: "new" }],
    ["to empty", "old", "", { start: 0, end: 3, text: "" }],
  ])("%s", (_name, before, after, expected) => {
    const r = MarkdownTextOps.changedRange(before, after);
    expect(r).toEqual(expected);
    expect(apply(before, r)).toBe(after);
  });
});
