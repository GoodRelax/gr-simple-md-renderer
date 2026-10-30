import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  SOURCE,
  CODE_OUTPUT,
  SPEC_OUTPUT,
  BEGIN_MARKER,
  END_MARKER,
  MIN_ROWS,
  problemsOf,
  rowsOf,
  codeModuleOf,
  specTableOf,
  specWithTable,
  withEolOf,
  checkOutputs,
} from "../../tools/fileTypes.mjs";
import { FILE_TYPES } from "../js/fileTypes.js";
import { CONFIG } from "../js/config.js";
import { classifyDroppedFile } from "../js/fileOpenChecks.js";
import { containsNul } from "../js/textEncoding.js";

// The file types GRSMD opens (INV-18, INV-102; owner rulings AQ1, AQ5, AQ9,
// AQ12): one source, spec/data/file-types.json, from which tools/fileTypes.mjs
// makes the spec 5.4 table and src/js/fileTypes.js. These tests read the
// generated module; no separate fixture is made.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRows = () => rowsOf(readFileSync(resolve(root, SOURCE), "utf8"));
const row = (id, match, open = "code", hljs = null) => ({ id, match, open, hljs });
/** MIN_ROWS good rows, then the given ones. */
const enough = (...extra) => [...Array.from({ length: MIN_ROWS }, (_, i) => row(`FT-${i + 1}`, `.e${i}`)), ...extra];

describe("AT-GEN INV-102: the generator of the file types (tools/fileTypes.mjs)", () => {
  it("AT-GEN-01 INV-102 the source passes the generator's own checks: 95 rows, .md and .markdown first and the only Markdown rows", () => {
    const rows = sourceRows();
    expect(problemsOf(rows)).toEqual([]);
    expect(rows).toHaveLength(95);
    expect(rows.length).toBeGreaterThanOrEqual(MIN_ROWS);
    expect(rows.slice(0, 2).map((r) => [r.id, r.match, r.open])).toEqual([["FT-1", ".md", "markdown"], ["FT-2", ".markdown", "markdown"]]);
    expect(rows.filter((r) => r.open === "markdown")).toHaveLength(2);
  });

  it("AT-GEN-02 INV-102 the checks find a duplicate id or match, a missing or unknown field, an unknown open, an extension that can never match, too few rows", () => {
    expect(problemsOf(enough())).toEqual([]);
    expect(problemsOf(enough(row("FT-1", ".zz")))).toEqual(["row 91: duplicate id FT-1"]);
    expect(problemsOf(enough(row("FT-91", ".e0")))).toEqual(["row 91: duplicate match .e0"]);
    expect(problemsOf(enough({ id: "FT-91", match: ".zz", open: "code" }))).toEqual(['row 91: missing field "hljs"']);
    expect(problemsOf(enough({ ...row("FT-91", ".zz"), color: "red" }))).toEqual(['row 91: unknown field "color"']);
    expect(problemsOf(enough(row("FT-91", ".zz", "binary")))).toEqual(['row 91: unknown open "binary"']);
    expect(problemsOf(enough(row("FT-91", ".R", "code", "r")))).toEqual(['row 91: bad match ".R"']); // the extension is lower-cased before the lookup
    expect(problemsOf(enough(row("FT-91", "a.b")))).toEqual(['row 91: bad match "a.b"']);
    expect(problemsOf(enough(row("X-91", ".zz")))).toEqual(['row 91: bad id "X-91"']);
    expect(problemsOf(enough(row("FT-91", ".zz", "code", "Java Script")))).toEqual(['row 91: bad hljs "Java Script"']);
    expect(problemsOf(enough().slice(1))).toEqual([`${MIN_ROWS - 1} rows: at least ${MIN_ROWS} expected`]);
    expect(problemsOf({})).toEqual(["the source is not an array"]);
    expect(() => rowsOf(JSON.stringify(enough(row("FT-1", ".zz"))))).toThrow(/duplicate id FT-1/);
  });

  it(`AT-GEN-03 INV-102 ${CODE_OUTPUT} is what the generator makes from the source, byte for byte (node tools/fileTypes.mjs --check)`, () => {
    expect(checkOutputs(root).filter((f) => f.path === CODE_OUTPUT)).toEqual([]);
    expect(FILE_TYPES).toEqual(sourceRows());
    const text = readFileSync(resolve(root, CODE_OUTPUT), "utf8");
    expect(text.replace(/\r\n/g, "\n").startsWith("// Generated. Do not edit.\n")).toBe(true);
  });

  it(`AT-GEN-04 INV-102 the table in ${SPEC_OUTPUT} 5.4 is what the generator makes from the source, byte for byte`, () => {
    expect(checkOutputs(root).filter((f) => f.path === SPEC_OUTPUT)).toEqual([]);
  });

  it("AT-GEN-05 INV-102 the spec table: only the lines between the markers change; the line endings stay; markers missing or twice: refused", () => {
    const rows = enough(row("FT-91", "LICENSE"));
    const table = specTableOf(rows);
    expect(table.split("\n").slice(2, 4)).toEqual(["| ID | \u7a2e\u985e | \u4e00\u81f4 | \u958b\u304d\u65b9 | highlight.js |", "| --- | --- | --- | --- | --- |"]);
    expect(table.split("\n")).toHaveLength(5 + rows.length);
    expect(table.split("\n").at(-2)).toBe("| FT-91 | \u540d\u524d | `LICENSE` | \u30b3\u30fc\u30c9\u30d3\u30e5\u30fc | \u8272\u306a\u3057 |");
    expect(table.split("\n").at(-1)).toBe("");
    const spec = ["# A", BEGIN_MARKER, "old", END_MARKER, "after", ""].join("\r\n");
    const out = specWithTable(spec, "t1\nt2");
    expect(out).toBe(["# A", BEGIN_MARKER, "t1", "t2", END_MARKER, "after", ""].join("\r\n"));
    expect(specWithTable(out, "t1\nt2")).toBe(out);
    expect(() => specWithTable("# A\n", table)).toThrow(/markers/);
    expect(() => specWithTable([BEGIN_MARKER, END_MARKER, BEGIN_MARKER, END_MARKER].join("\n"), table)).toThrow(/markers/);
    expect(() => specWithTable([END_MARKER, BEGIN_MARKER].join("\n"), table)).toThrow(/markers/);
  });

  it("AT-GEN-06 INV-102 the module text: one frozen row per entry; a CRLF checkout is compared with CRLF", () => {
    const text = codeModuleOf([row("FT-1", ".md", "markdown", "markdown"), row("FT-2", "LICENSE")]);
    expect(text).toContain('  { id: "FT-1", match: ".md", open: "markdown", hljs: "markdown" },\n');
    expect(text).toContain('  { id: "FT-2", match: "LICENSE", open: "code", hljs: null },\n');
    expect(/^[\x00-\x7f]*$/.test(text)).toBe(true);
    expect(withEolOf("a\nb\n", null)).toBe("a\nb\n");
    expect(withEolOf("a\nb\n", "x\r\ny")).toBe("a\r\nb\r\n");
    expect(Object.isFrozen(FILE_TYPES) && FILE_TYPES.every((t) => Object.isFrozen(t))).toBe(true);
  });
});

describe("AT-FT INV-18: what a dropped file opens in, by its file type (classifyDroppedFile)", () => {
  it("AT-FT-01 INV-18 every listed file type opens as its row says, by extension (any case) or by whole name", () => {
    for (const t of FILE_TYPES) {
      const names = t.match.startsWith(".") ? [`a${t.match}`, `A${t.match.toUpperCase()}`] : [t.match];
      for (const name of names) expect(classifyDroppedFile(name, 10), name).toBe(t.open);
    }
    expect(classifyDroppedFile("notes.markdown", 10)).toBe("markdown");
    expect(classifyDroppedFile("LICENSE", 10)).toBe("code");
    expect(classifyDroppedFile(".gitignore", 10)).toBe("code");
    expect(classifyDroppedFile("analysis.R", 10)).toBe("code");
  });

  it("AT-FT-02 INV-18 (D29) a file of no listed type is notAllowed: no black list, no look at its bytes", () => {
    for (const name of ["image.png", "app.exe", "doc.pdf", "data.xyz", "archive.zip", "photo.psd", "README", "license", "Makefile.bak", "noext."]) {
      expect(classifyDroppedFile(name, 10), name).toBe("notAllowed");
    }
  });

  it("AT-FT-03 INV-11 over 5 MB is tooLarge before the file type", () => {
    expect(classifyDroppedFile("big.md", CONFIG.fileDrop.maxBytes + 1)).toBe("tooLarge");
    expect(classifyDroppedFile("big.png", CONFIG.fileDrop.maxBytes + 1)).toBe("tooLarge");
    expect(classifyDroppedFile("edge.md", CONFIG.fileDrop.maxBytes)).toBe("markdown");
  });

  it("AT-FT-05 INV-18 (AQ11) containsNul: U+0000 anywhere in the decoded text, also past 8 KB", () => {
    expect(containsNul("abc")).toBe(false);
    expect(containsNul("")).toBe(false);
    expect(containsNul("a\u0000b")).toBe(true);
    expect(containsNul("x".repeat(9000) + "\u0000")).toBe(true);
    expect(containsNul("\u2400 \\0 0")).toBe(false); // the NUL symbol and a written \0 are text
  });
});
