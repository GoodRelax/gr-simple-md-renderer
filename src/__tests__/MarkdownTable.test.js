import { describe, it, expect } from "vitest";
import { marked, Marked } from "marked";
import markedKatex from "marked-katex-extension";
import MarkdownTable from "../js/classes/MarkdownTable.js";
import { displayWidth } from "../js/textWidth.js";

// INV-61 / 5.14.13: parse and format a GFM table; the row and column
// operations of INV-65 (used by the cell editor, unit E).

const lexer = (src) => marked.lexer(src, { gfm: true });

/** Display columns of the pipes that separate cells, per line. */
function pipeColumns(text) {
  return text.split("\n").map((line) => {
    const cols = [];
    let w = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "\\") {
        w += displayWidth(line.slice(i, i + 2));
        i++;
        continue;
      }
      if (line[i] === "|") cols.push(w);
      w += displayWidth(String.fromCodePoint(line.codePointAt(i)));
      if (line.codePointAt(i) > 0xffff) i++;
    }
    return cols;
  });
}

const fmt = (raw) => MarkdownTable.format(MarkdownTable.parse(raw));

describe("AT-MT parse", () => {
  it("reads the alignments, the header and the body; cells keep their text, trimmed of spaces and tabs only", () => {
    const t = MarkdownTable.parse("| A | :B | C: | :D: |\n|---|:---|---:|:-:|\n| a1 |\u3000b1\u3000| c1 | d1 |");
    expect(t.aligns).toEqual(["none", "left", "right", "center"]);
    expect(t.rows).toEqual([
      ["A", ":B", "C:", ":D:"],
      ["a1", "\u3000b1\u3000", "c1", "d1"],
    ]);
    expect(t.extras).toEqual([[], []]);
  });

  it("tables without outer pipes; escaped pipes and pipes inside code spans", () => {
    const t = MarkdownTable.parse("A | B\n--- | ---\nx \\| y | `a\\|b`");
    expect(t.rows).toEqual([
      ["A", "B"],
      ["x \\| y", "`a\\|b`"],
    ]);
  });

  it("a short row is padded with empty cells; a long row keeps its extra cells", () => {
    const t = MarkdownTable.parse("| A | B | C |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 | 5 |");
    expect(t.rows).toEqual([
      ["A", "B", "C"],
      ["1", "", ""],
      ["1", "2", "3"],
    ]);
    expect(t.extras).toEqual([[], [], ["4", "5"]]);
  });

  it.each([
    ["one line", "| A | B |"],
    ["no delimiter row", "| A | B |\n| a | b |"],
    ["header and delimiter counts differ", "| A | B |\n|---|---|---|\n| a | b |"],
    ["a broken delimiter cell", "| A | B |\n|---|-x-|"],
    ["a paragraph", "just text\nmore text"],
    ["empty", ""],
  ])("not a table: %s -> null", (_name, raw) => {
    expect(MarkdownTable.parse(raw)).toBeNull();
  });
});

describe("AT-MT format (INV-61)", () => {
  it("outer pipes, one space around cells, columns padded to the widest cell, the delimiter keeps the colons", () => {
    expect(fmt("|A|:B|C:|:D:|\n|-|:-|-:|:-:|\n|long cell|b|c|d|")).toBe(
      [
        "| A         | :B  | C:  | :D: |",
        "| --------- | :-- | --: | :-: |",
        "| long cell | b   | c   | d   |",
      ].join("\n"),
    );
  });

  it("a column is at least 3 wide (the delimiter needs 3)", () => {
    expect(fmt("|a|b|\n|-|-|\n|1|2|")).toBe(["| a   | b   |", "| --- | --- |", "| 1   | 2   |"].join("\n"));
  });

  it("full-width text: the pipes line up by display width", () => {
    const out = fmt("| \u540d\u524d | Age |\n|---|---|\n| \u5c71\u7530\u592a\u90ce | 30 |\n| Bob | \u4e8c\u5341 |");
    const cols = pipeColumns(out);
    for (const c of cols) expect(c).toEqual(cols[0]);
    expect(out.split("\n")[2]).toBe("| \u5c71\u7530\u592a\u90ce | 30   |");
  });

  it.each([
    ["combining marks", "e\u0301 and \u304b\u3099"],
    ["an Ambiguous character", "\u25cb\u2460\u03b1"],
    ["a surrogate pair", "\ud840\udc0b\ud840\udc0b"],
    ["a ZWJ and a zero-width space", "a\u200db\u200bc"],
  ])("the pipes line up by display width with %s", (_name, text) => {
    const out = fmt(`| A | B |\n|---|---|\n| ${text} | x |\n| y | ${text}${text} |`);
    const cols = pipeColumns(out);
    for (const c of cols) expect(c).toEqual(cols[0]);
  });

  it("tables without outer pipes get them; a short row is padded; extra cells stay at the end as they were", () => {
    expect(fmt("A | B\n--- | ---\n1\n1 | 2 | x | y")).toBe(
      ["| A   | B   |", "| --- | --- |", "| 1   |     |", "| 1   | 2   | x | y |"].join("\n"),
    );
  });

  it("escaped pipes and code-span pipes are kept and counted as written", () => {
    const out = fmt("| A | B |\n|---|---|\n| x \\| y | `a\\|b` |");
    expect(out).toBe(["| A      | B      |", "| ------ | ------ |", "| x \\| y | `a\\|b` |"].join("\n"));
    const cols = pipeColumns(out);
    for (const c of cols) expect(c).toEqual(cols[0]);
  });

  it("formatting a formatted table changes nothing; the result is still the same table for marked", () => {
    const raw = "|A|B|\n|:-|-:|\n|\u6f22|x|";
    const once = fmt(raw);
    expect(fmt(once)).toBe(once);
    const before = lexer(raw)[0];
    const after = lexer(once)[0];
    expect(after.type).toBe("table");
    expect(after.align).toEqual(before.align);
    expect(after.header.map((h) => h.text)).toEqual(before.header.map((h) => h.text));
    expect(after.rows.map((r) => r.map((c) => c.text))).toEqual(before.rows.map((r) => r.map((c) => c.text)));
  });
});

describe("AT-MT formatTablesIn (INV-61: the table blocks of an edited text)", () => {
  it("formats every table block and leaves the rest of the text as it is", () => {
    const text = "|a|b|\n|-|-|\n|1|2|\n\nA *paragraph*  \nline\n\n|x|\n|-|";
    expect(MarkdownTable.formatTablesIn(text, lexer)).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\nA *paragraph*  \nline\n\n| x   |\n| --- |",
    );
  });

  it("text without a table, or that does not lex back to itself, is returned unchanged", () => {
    expect(MarkdownTable.formatTablesIn("just text", lexer)).toBe("just text");
    expect(MarkdownTable.formatTablesIn("|a|b|\n|-|-|", () => [{ type: "table", raw: "|a|" }])).toBe("|a|b|\n|-|-|");
  });
});

describe("AT-MT formatting never changes what marked renders (the app's marked: GFM + KaTeX)", () => {
  const app = new Marked();
  app.use(markedKatex({ throwOnError: false }));
  const appLexer = (src) => app.lexer(src);
  it.each([
    ["an unescaped pipe in a code span", "| A | B |\n|---|---|\n| `a|b` | c |"],
    ["an escaped pipe in a code span", "| A | B |\n|---|---|\n| `a\\|b` | c |"],
    ["an escaped backslash before a pipe", "| A | B |\n|---|---|\n| x\\\\|y | z |"],
    ["an escaped backslash and an escaped pipe", "| A | B |\n|---|---|\n| x\\\\\\|y | z |"],
    ["a cell ending in a backslash", "| A | B |\n|---|---|\n| x\\ | y |"],
    ["a pipe in a link", "| A | B |\n|---|---|\n| [x|y](u) | z |"],
    ["a pipe in inline HTML", '| A | B |\n|---|---|\n| <span title="x|y">t</span> | z |'],
    ["a pipe in math", "| A | B |\n|---|---|\n| $x|y$ | z |"],
    ["no outer pipes", "A | B\n--- | ---\n1 | 2"],
    ["3-space indentation", "   | A | B |\n   |---|---|\n   | 1 | 2 |"],
    ["a header-only table", "| A | B |\n|:-|-:|"],
    ["trailing whitespace lines", "| A | B |\n|---|---|\n| 1 | 2 |\n   \n\t\n"],
    ["a paragraph followed by a table", "para\n\n| A | B |\n|---|---|\n| 1 | 2 |"],
    ["a table in a blockquote (left as it is)", "> | A | B |\n> |---|---|\n> | 1 | 2 |"],
    ["a table in a list (left as it is)", "- | A | B |\n  |---|---|\n  | 1 | 2 |"],
    ["short rows and empty extra cells", "| A | B | C |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 |  |  |"],
    ["full-width text and spaces", "| \u540d | \u3000\u5024\u3000 |\n|---|---|\n| \u00a0x | \u5c71\u7530 |"],
  ])("%s", (_name, src) => {
    const once = MarkdownTable.formatTablesIn(src, appLexer);
    expect(app.parse(once)).toBe(app.parse(src));
    expect(MarkdownTable.formatTablesIn(once, appLexer)).toBe(once);
  });
});

describe("AT-MT row and column operations (INV-65, D2)", () => {
  const base = () => MarkdownTable.parse("| A | B |\n|:--|--:|\n| 1 | 2 |\n| 3 | 4 |");

  it("insertRow: under the row; under the header it becomes the first body row", () => {
    expect(MarkdownTable.insertRow(base(), 2).rows).toEqual([["A", "B"], ["1", "2"], ["3", "4"], ["", ""]]);
    expect(MarkdownTable.insertRow(base(), 0).rows).toEqual([["A", "B"], ["", ""], ["1", "2"], ["3", "4"]]);
  });

  it("deleteRow: a body row goes; the header row cannot be deleted (D2) -> null", () => {
    expect(MarkdownTable.deleteRow(base(), 1).rows).toEqual([["A", "B"], ["3", "4"]]);
    expect(MarkdownTable.deleteRow(base(), 0)).toBeNull();
  });

  it("insertColumn: right of the column, empty cells, default alignment", () => {
    const t = MarkdownTable.insertColumn(base(), 0);
    expect(t.aligns).toEqual(["left", "none", "right"]);
    expect(t.rows).toEqual([["A", "", "B"], ["1", "", "2"], ["3", "", "4"]]);
  });

  it("deleteColumn: the column goes; the last column cannot be deleted (D2) -> null", () => {
    const t = MarkdownTable.deleteColumn(base(), 0);
    expect(t.aligns).toEqual(["right"]);
    expect(t.rows).toEqual([["B"], ["2"], ["4"]]);
    expect(MarkdownTable.deleteColumn(t, 0)).toBeNull();
  });

  it("setAlignment: left / center / right / none", () => {
    for (const a of ["left", "center", "right", "none"]) expect(MarkdownTable.setAlignment(base(), 1, a).aligns).toEqual(["left", a]);
    expect(MarkdownTable.format(MarkdownTable.setAlignment(base(), 0, "center")).split("\n")[1]).toBe("| :-: | --: |");
  });

  it("operations do not change their input (pure)", () => {
    const t = base();
    const snapshot = JSON.stringify(t);
    MarkdownTable.insertRow(t, 1);
    MarkdownTable.deleteRow(t, 1);
    MarkdownTable.insertColumn(t, 1);
    MarkdownTable.deleteColumn(t, 1);
    MarkdownTable.setAlignment(t, 1, "center");
    expect(JSON.stringify(t)).toBe(snapshot);
  });
});
