import { describe, it, expect } from "vitest";
import MarkdownTextOps from "../js/classes/MarkdownTextOps.js";
import { makeLexer } from "./helpers/samples.js";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";

// INV-52 (request 1): where Insert table / Mermaid goes while a block editor
// is open. The editor text is cut at a line boundary: after the caret line,
// or before it when the caret is at the start of the line. A side that would
// be blank is not made (above / below). Only paragraphs, lists and quotes are
// cut; code, math, HTML and a table's source refuse, at any depth.

const lexBlocks = makeLexer();
const inlineMarked = new Marked();
inlineMarked.use(markedKatex({ throwOnError: false }));
const lexInline = (src) => new inlineMarked.Lexer(inlineMarked.defaults).inlineTokens(src);
const plan = (text, caret, blockType = "paragraph") => MarkdownTextOps.planBlockInsert(text, caret, blockType, { lexBlocks, lexInline });
const at = (text, needle, delta = 0) => text.indexOf(needle) + delta;

describe("AT-INS planBlockInsert (INV-52)", () => {
  it("AT-INS-01 an empty or blank editor: the block goes in its place (above)", () => {
    expect(plan("", 0, null)).toEqual({ kind: "above", line: 0 });
    expect(plan("  \n \n", 2, null)).toEqual({ kind: "above", line: 0 });
  });

  it.each([
    ["caret at the very start", 0, { kind: "above", line: 0 }],
    ["caret in the first line", 4, { kind: "split", line: 1 }],
    ["caret at the start of the second line", 9, { kind: "split", line: 1 }],
    ["caret in the last line", 15, { kind: "below", line: 2 }],
    ["caret at the very end", 17, { kind: "below", line: 2 }],
  ])("AT-INS-02 a paragraph is cut at a line boundary (%s)", (_n, caret, expected) => {
    expect(plan("Line one\nLine two", caret)).toEqual(expected);
  });

  it("AT-INS-03 a list and a quote are cut between their lines", () => {
    expect(plan("- a\n- b", 3, "list")).toEqual({ kind: "split", line: 1 });
    expect(plan("> a\n> b", 3, "blockquote")).toEqual({ kind: "split", line: 1 });
  });

  it("AT-INS-04 a block that is not a paragraph, list or quote is never cut", () => {
    expect(plan("Title\n=====", 3, "heading")).toEqual({ kind: "below", line: 2 });
    expect(plan("Title\n=====", 0, "heading")).toEqual({ kind: "above", line: 0 });
    expect(plan("# Head", 3, "heading")).toEqual({ kind: "below", line: 1 });
    expect(plan("---", 1, "hr")).toEqual({ kind: "below", line: 1 });
  });

  it.each([
    ["a fenced code block", "```js\nconst a\n```", "code"],
    ["a Mermaid block", "```mermaid\nflowchart TD\n```", "code"],
    ["a PlantUML block", "```plantuml\n@startuml\n@enduml\n```", "code"],
    ["an indented code block", "    code", "code"],
    ["a math block", "$$\nx^2\n$$", "blockKatex"],
    ["an HTML block", "<details>\n<summary>s</summary>\n</details>", "html"],
    ["a table's source", "| a |\n|---|\n| b |", "table"],
  ])("AT-INS-05 refuses in %s (the caret anywhere)", (_n, text, type) => {
    for (const caret of [0, 1, text.length]) expect(plan(text, caret, type)).toEqual({ kind: "refuse" });
  });

  it.each([
    ["code in a list item", "- step\n  ```sh\n  npm run\n  ```\n- b", "npm"],
    ["code in a quote", "> a\n> ```\n> x\n> ```\n> b", "x\n"],
    ["code in a list in a quote", "> - a\n>   ```\n>   y\n>   ```", "y"],
    ["math in a list item", "- a\n\n  $$\n  x^2\n  $$", "x^2"],
    ["HTML in a list item", "- <div>\n  z\n  </div>", "z"],
  ])("AT-INS-06 refuses with the caret in %s (any depth)", (_n, text, needle) => {
    const type = text.startsWith(">") ? "blockquote" : "list";
    expect(plan(text, at(text, needle, 1), type)).toEqual({ kind: "refuse" });
  });

  it("AT-INS-07 outside the nested code the list is cut as usual", () => {
    const text = "- step\n  ```sh\n  npm run\n  ```\n- b";
    expect(plan(text, at(text, "- b", 3), "list")).toEqual({ kind: "below", line: 5 });
    expect(plan("> a\n> ```\n> x\n> ```\n> b", 3, "blockquote")).toEqual({ kind: "split", line: 1 });
  });

  it("AT-INS-08 an editor text of several blocks: decided by the block at the caret", () => {
    const text = "a\n\n```\nx\n```\n\nb";
    expect(plan(text, at(text, "x", 1))).toEqual({ kind: "refuse" });
    expect(plan(text, at(text, "```", 0))).toEqual({ kind: "refuse" });
    // a blank line between blocks is a boundary itself
    expect(plan("a\n\nb", 2)).toEqual({ kind: "split", line: 1 });
    expect(plan("a\n\n# H\n\nb", at("a\n\n# H\n\nb", "H"))).toEqual({ kind: "split", line: 3 });
    expect(plan("a\n\n# H\n\nb", at("a\n\n# H\n\nb", "#"))).toEqual({ kind: "split", line: 2 });
  });

  it("AT-INS-09 blank lines at an end count as blank (no empty side is made)", () => {
    expect(plan("Line one\n\n", 10)).toEqual({ kind: "below", line: 3 });
    expect(plan("\n\nLine one", 1)).toEqual({ kind: "above", line: 0 });
    expect(plan("\n\nLine one", 2)).toEqual({ kind: "above", line: 0 });
  });

  it("AT-INS-10 CRLF line ends are cut the same way", () => {
    expect(plan("Line one\r\nLine two", 4)).toEqual({ kind: "split", line: 1 });
  });

  it("AT-INS-11 a large paragraph block is planned once, quickly", () => {
    const text = Array.from({ length: 5000 }, (_, i) => `line ${i} of the block`).join("\n");
    const start = performance.now();
    expect(plan(text, at(text, "line 2500", 2))).toEqual({ kind: "split", line: 2501 });
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("AT-INS-12 insertOffset: where the block goes in the committed text", () => {
    const text = "Line one\nLine two";
    expect(MarkdownTextOps.insertOffset(text, { kind: "above", line: 0 })).toBe(0);
    expect(MarkdownTextOps.insertOffset(text, { kind: "split", line: 1 })).toBe(8); // the end of the line before the cut
    expect(MarkdownTextOps.insertOffset(text, { kind: "below", line: 2 })).toBe(17);
    // trailing newlines are not in the committed block (replaceBlock drops them)
    expect(MarkdownTextOps.insertOffset("Line one\n\n", { kind: "below", line: 3 })).toBe(8);
    // line end spaces removed on commit (INV-71 (6)) keep the line numbers
    expect(MarkdownTextOps.insertOffset("a\nb", { kind: "split", line: 1 })).toBe(1);
    expect(MarkdownTextOps.insertOffset("a\n\nb", { kind: "split", line: 2 })).toBe(2);
  });

  it("AT-INS-13 a plan and its offset are pure (same input, same result)", () => {
    expect(plan("- a\n- b", 3, "list")).toEqual(plan("- a\n- b", 3, "list"));
  });
});

describe("AT-INS planBlockInsert after the first review (owner rulings D6-D8)", () => {
  it("AT-INS-14 a list is cut at the boundary of its top-level item (D6)", () => {
    const text = "- a\n  more\n- b";
    expect(plan(text, 3, "list")).toEqual({ kind: "split", line: 2 }); // end of "- a": after the item
    expect(plan(text, at(text, "  more"), "list")).toEqual({ kind: "split", line: 2 }); // its 2nd line
    expect(plan(text, at(text, "- b"), "list")).toEqual({ kind: "split", line: 2 }); // start of the next item
    expect(plan(text, at(text, "- b", 1), "list")).toEqual({ kind: "below", line: 3 });
    const nested = "- a\n  - b\n  - c\n- d";
    expect(plan(nested, at(nested, "b"), "list")).toEqual({ kind: "split", line: 3 });
    expect(plan("- a\n\n- b", 4, "list")).toEqual({ kind: "split", line: 1 }); // a loose list: after the item's text
    // a quote is still cut by line
    expect(plan("> a\n> b\n> c", 3, "blockquote")).toEqual({ kind: "split", line: 1 });
  });

  it("AT-INS-15 a table in a list or a quote refuses (D7)", () => {
    const list = "- a\n\n  | x |\n  |---|\n  | y |";
    expect(plan(list, at(list, "y"), "list")).toEqual({ kind: "refuse" });
    const quote = "> | x |\n> |---|\n> | y |";
    expect(plan(quote, at(quote, "y"), "blockquote")).toEqual({ kind: "refuse" });
  });

  it("AT-INS-16 lines marked drops (a duplicate definition with its title on the next line): below, not cut (D8)", () => {
    const text = '[a]: u\n[A]: v\n  "title"\n\npara one\npara two\n\n```\ncd\n```';
    for (const caret of [at(text, "para one", 4), at(text, "```\ncd"), at(text, "cd")]) {
      expect(plan(text, caret)).toEqual({ kind: "below", line: text.split("\n").length });
    }
  });
});

describe("AT-INS cutLineEndBreak (INV-71 (6) for the line before a cut, review L4)", () => {
  const cut = (text, p) => MarkdownTextOps.cutLineEndBreak(text, p, lexBlocks);

  it("AT-INS-17 the spaces of a line break that no longer breaks a line go; others stay", () => {
    expect(cut("x  \ny", { kind: "split", line: 1 })).toBe(2);
    expect(cut("x\ny", { kind: "split", line: 1 })).toBe(0);
    expect(cut("x  \ny", { kind: "above", line: 0 })).toBe(0);
    expect(cut("x  \ny", { kind: "below", line: 2 })).toBe(0);
    // an earlier line keeps its meaningless spaces (an unchanged editor): only the cut line is judged
    expect(cut("x  \n\ny  \nz", { kind: "split", line: 3 })).toBe(2);
    expect(cut("x  \n\ny\nz", { kind: "split", line: 3 })).toBe(0);
    // in a quote, a heading, a nested list, a blank line: they go
    expect(cut("> a\n> b  \n> c", { kind: "split", line: 2 })).toBe(2);
    expect(cut("# H  \n\npara", { kind: "split", line: 1 })).toBe(2);
    expect(cut("- a\n  - b  \n- c", { kind: "split", line: 2 })).toBe(2);
    expect(cut("a\n   \nb", { kind: "split", line: 2 })).toBe(3);
    // in fenced code, HTML or math they are content; a tab after them is no line break
    expect(cut("a\n\n```\ncode  \n```", { kind: "split", line: 4 })).toBe(0);
    expect(cut("<div>\nx  \n</div>", { kind: "split", line: 2 })).toBe(0);
    expect(cut("$$\nx  \n$$", { kind: "split", line: 2 })).toBe(0);
    expect(cut("a  \t\nb", { kind: "split", line: 1 })).toBe(0);
    // a backslash line break: the backslash goes too (strict review L1); an
    // even run is an escaped backslash (text), spaces after it are the break
    expect(cut("one\\\ntwo", { kind: "split", line: 1 })).toBe(1);
    expect(cut("one\\\\\\\ntwo", { kind: "split", line: 1 })).toBe(1);
    expect(cut("one\\\\\ntwo", { kind: "split", line: 1 })).toBe(0);
    expect(cut("one\\  \ntwo", { kind: "split", line: 1 })).toBe(2);
    expect(cut("```\na\\\n```", { kind: "split", line: 2 })).toBe(0);
    expect(cut("> a\\\n> b", { kind: "split", line: 1 })).toBe(1); // a paragraph of a quote
    // a backslash at the end of its block is text, not a line break (re-check N1)
    expect(cut("- a\\\n- b", { kind: "split", line: 1 })).toBe(0); // a list item's end
    expect(cut("a\\\n\nb", { kind: "split", line: 1 })).toBe(0); // a paragraph before a blank line
    expect(cut("# H\\\n\npara", { kind: "split", line: 1 })).toBe(0); // a heading
    // code in a list item: the spaces are content
    expect(cut("- a\n\n      code  \n- b", { kind: "split", line: 3 })).toBe(0);
  });
});

describe("AT-INS-18 an inline span across the cut line: below the paragraph, not cut (strict review M1)", () => {
  it.each([
    ["bold, as Bold on two selected lines makes it", "alpha **beta\ngamma** delta"],
    ["italic", "alpha *beta\ngamma* delta"],
    ["strikethrough", "alpha ~~beta\ngamma~~ delta"],
    ["a text color span", 'alpha <span style="color: #d1242f">beta\ngamma</span> delta'],
    ["a link's text", "alpha [li\nnk](https://example.com/) delta"],
    ["a code span", "alpha `beta\ngamma` delta"],
    ["an image's text (re-check N3)", "alpha ![alt\ntext](http://x/i.png) delta"],
    ["an HTML comment (re-check N3)", "alpha <!-- hidden\nstill hidden --> delta"],
    ["a tag with a line break inside (re-check N3)", 'alpha <span\nstyle="color: #d1242f">x</span> delta'],
  ])("%s: below the paragraph", (_n, text) => {
    expect(plan(text, 3)).toEqual({ kind: "below", line: 2 });
  });

  it("a span that does not cross the cut, and math on one line: cut as usual", () => {
    expect(plan("**a**\nb", 2)).toEqual({ kind: "split", line: 1 });
    expect(plan("a $x+y$\nb", 2)).toEqual({ kind: "split", line: 1 });
    // $...$ over two lines is not inline math (marked-katex): it is text, and is cut
    expect(plan("a $x\n+y$ b", 2)).toEqual({ kind: "split", line: 1 });
    expect(plan('<span style="color: #d1242f">a</span>\nb', 2)).toEqual({ kind: "split", line: 1 });
  });

  it("in a quote: below that paragraph of the quote (the quote is still cut there)", () => {
    expect(plan("> x **a\n> b** y\n> c", 3, "blockquote")).toEqual({ kind: "below", line: 3 });
    expect(plan("> **a\n> b**\n>\n> c", 3, "blockquote")).toEqual({ kind: "split", line: 2 });
  });

  it("inline lexing runs once per press", () => {
    let calls = 0;
    const counting = (src) => {
      calls++;
      return lexInline(src);
    };
    MarkdownTextOps.planBlockInsert("alpha **beta\ngamma** delta", 3, "paragraph", { lexBlocks, lexInline: counting });
    expect(calls).toBe(1);
  });
});

describe("AT-INS-19 a paragraph over the huge block limit: no inline lexing, cut by line (re-check N2, as D3 and INV-71)", () => {
  it("the inline check is skipped above maxInlineChars", () => {
    let calls = 0;
    const counting = (src) => {
      calls++;
      return lexInline(src);
    };
    const text = "alpha **beta\ngamma** delta";
    const lexers = { lexBlocks, lexInline: counting };
    expect(MarkdownTextOps.planBlockInsert(text, 3, "paragraph", { ...lexers, maxInlineChars: text.length - 1 })).toEqual({ kind: "split", line: 1 });
    expect(calls).toBe(0);
    expect(MarkdownTextOps.planBlockInsert(text, 3, "paragraph", { ...lexers, maxInlineChars: text.length })).toEqual({ kind: "below", line: 2 });
    expect(calls).toBe(1);
  });
});

// The line break spaces before a cut are found from the first of their run
// (review of the render hang): linear in the line. Runs always, as AT-FR-65.
const LONG_RUN_BUDGET_MS = 1000;

describe("AT-INS a long run of spaces inside the line before a cut (linear line-end-space search)", () => {
  it("AT-INS-20 cutLineEndBreak: 100,000 spaces inside the line, then a line break: 2 go, within 1,000 ms", () => {
    const text = `a${" ".repeat(100000)}x  \ny`;
    const t0 = performance.now();
    const count = MarkdownTextOps.cutLineEndBreak(text, { kind: "split", line: 1 }, lexBlocks);
    const ms = performance.now() - t0;
    expect(count).toBe(2);
    expect(ms).toBeLessThan(LONG_RUN_BUDGET_MS);
  });
});

describe("AT-INS a long run of newlines inside the editor text (linear trailing-newline search)", () => {
  it("AT-INS-21 insertOffset below a code block of 300,000 blank lines: the end of its text, within 1,000 ms", () => {
    const inner = "```\n" + "\n".repeat(300000) + "x\n```";
    const t0 = performance.now();
    const offset = MarkdownTextOps.insertOffset(inner + "\n", { kind: "below", line: 0 });
    const ms = performance.now() - t0;
    expect(offset).toBe(inner.length);
    expect(ms).toBeLessThan(LONG_RUN_BUDGET_MS);
  });
});
