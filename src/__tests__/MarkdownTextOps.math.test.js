import { describe, it, expect } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import katex from "katex";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import MarkdownTextOps from "../js/classes/MarkdownTextOps.js";
import MarkdownRenderer from "../js/classes/MarkdownRenderer.js";
import { CONFIG } from "../js/config.js";

// The palette's math (Text format, owner ruling 2026-10-25): inline math
// put in at the caret of the block editor, and the templates themselves.

const app = new Marked();
app.use(markedKatex({ throwOnError: false }));

/** Block tokens only, as MarkdownRenderer.lex. */
function lexBlocks(src) {
  const lexer = new app.Lexer(app.defaults);
  lexer.blockTokens(src, lexer.tokens);
  return lexer.tokens;
}

const ctx = {
  lexBlocks,
  lexInline: (src) => new app.Lexer(app.defaults).inlineTokens(src),
  colors: [],
};

const M = CONFIG.edit.inlineMathTemplate;
const insert = (text, caret) => MarkdownTextOps.insertInlineMath(text, caret, M, ctx);
const canInsert = (text, caret) => MarkdownTextOps.canInsertInlineMath(text, caret, ctx);
/** The caret right after part (its first occurrence). */
const after = (text, part) => text.indexOf(part) + part.length;

/** Inline math tokens of a text, at any depth. */
function inlineMath(text) {
  const out = [];
  const walk = (tokens) => {
    for (const t of tokens) {
      if (t.type === "inlineKatex") out.push(t.raw);
      if (t.tokens) walk(t.tokens);
      if (t.items) walk(t.items);
      for (const cell of [...(t.header ?? []), ...(t.rows ?? []).flat()]) walk(cell.tokens);
    }
  };
  walk(app.lexer(text));
  return out;
}

/** The edit, checked: the math is one inline math token, the caret right after it. */
function expectInserted(edit, expected) {
  expect(edit).not.toBeNull();
  expect(edit.text).toBe(expected);
  expect(edit.selStart).toBe(edit.selEnd);
  expect(edit.text.slice(edit.selEnd - M.length, edit.selEnd)).toBe(M);
  expect(inlineMath(edit.text)).toContain(M);
}

describe("AT-MATH-01 inline math goes in at the caret, with a space only where it is needed", () => {
  it("(a) after a word, before a space: a space before it only", () => {
    expectInserted(insert("alpha beta", 5), `alpha ${M} beta`);
  });

  it("(b) after a space, before a word: a space after it only", () => {
    expectInserted(insert("alpha beta", 6), `alpha ${M} beta`);
  });

  it("(c) at the start and at the end of a paragraph", () => {
    expectInserted(insert("beta", 0), `${M} beta`);
    expectInserted(insert("alpha", 5), `alpha ${M}`);
  });

  it("(d) before punctuation that may follow math: no space after it", () => {
    expectInserted(insert("alpha.", 5), `alpha ${M}.`);
    expectInserted(insert("alpha, beta", 5), `alpha ${M}, beta`);
  });

  it("(e) in a list item, a heading, a quote and on a paragraph's second line", () => {
    expectInserted(insert("- item\n- two", 6), `- item ${M}\n- two`);
    expectInserted(insert("# Title", 7), `# Title ${M}`);
    expectInserted(insert("> quoted", 8), `> quoted ${M}`);
    // a line start is not the start of the inline text: "\n$...$" is not read as math
    expectInserted(insert("first\nsecond", 6), `first\n ${M} second`);
  });

  it("(f) in a cell of a table's source and between the words of bold", () => {
    const table = "| a | b |\n|---|---|\n| c | d |";
    expectInserted(insert(table, after(table, "| c")), `| a | b |\n|---|---|\n| c ${M} | d |`);
    const bold = "**bold text**";
    expectInserted(insert(bold, 6), `**bold ${M} text**`);
  });

  it("(g) a selection: the math goes in at its end and the selected text stays", () => {
    // BlockEditController passes the selection end (INV-52)
    expectInserted(insert("alpha beta", 10), `alpha beta ${M}`);
  });
});

describe("AT-MATH-02 inline math is refused where a link could not go in (owner ruling F-R1)", () => {
  it.each([
    ["in a code span", "`co de`", 3],
    ["in a link's text", "[li nk](u)", 3],
    ["in a link's destination", "[link](http://a.example)", 10],
    ["in inline math", "$a + b$ c", 3],
    ["in an entity", "a &amp; b", 4],
    ["in an inline HTML tag", 'a <span title="x">b</span>', 8],
    ["in a code block", "```\ncode\n```", 6],
    ["in a math block", "$$\nx\n$$", 4],
    ["on a table's delimiter line", "| a |\n|---|\n| b |", 8],
    ["outside a table row's pipes", "| a |\n|---|\n| b |", 12],
  ])("%s: null, and the button is off", (_, text, caret) => {
    expect(insert(text, caret)).toBeNull();
    expect(canInsert(text, caret)).toBe(false);
  });
});

describe("AT-MATH-03 the result is lexed again; a math that would not read as itself changes nothing", () => {
  it("(a) after an open $: the button is on (only the place is checked), the press changes nothing", () => {
    const text = "costs $5 and";
    expect(canInsert(text, text.length)).toBe(true);
    // "$5 and $e = ...$" would be one math together with the price
    expect(insert(text, text.length)).toBeNull();
  });

  it("(b) a math that the lexer would not read as math alone changes nothing", () => {
    expect(MarkdownTextOps.insertInlineMath("alpha", 5, "$x", ctx)).toBeNull();
    expect(MarkdownTextOps.insertInlineMath("", 0, "$x", ctx)).toBeNull();
  });

  it("(c) the text around keeps how it reads (bold, a link, a code span)", () => {
    const text = "**b** [l](u) `c` tail";
    const edit = insert(text, text.length);
    expectInserted(edit, `${text} ${M}`);
    expect(app.lexer(edit.text)[0].tokens.map((t) => t.type)).toEqual(["strong", "text", "link", "text", "codespan", "text", "inlineKatex"]);
  });
});

describe("AT-MATH-04 on a line with only spaces in no block, the math is a paragraph of its own", () => {
  it("(a) an empty editor (the empty document, a gap's editor)", () => {
    expectInserted(insert("", 0), M);
    expect(canInsert("", 0)).toBe(true);
  });

  it("(b) a blank line between two paragraphs, and right under one", () => {
    expectInserted(insert("para\n\n\n\nnext", 6), `para\n\n${M}\n\nnext`);
    expectInserted(insert("para\n", 5), `para\n\n${M}`);
    // marked reads a line of spaces right under a paragraph as part of it
    expectInserted(insert("para\n   ", 7), `para\n  ${M} `);
  });

  it("(c) a blank line inside a code block is refused", () => {
    expect(insert("```\n\n```", 4)).toBeNull();
    expect(canInsert("```\n\n```", 4)).toBe(false);
  });
});

describe("AT-MATH-06 right inside the markers of emphasis, no space is added on that side (review L1)", () => {
  it("(a) at the end of bold's text: the math ends the bold", () => {
    expectInserted(insert("**Note**: text", 6), `**Note ${M}**: text`);
    expect(app.lexer(`**Note ${M}**: text`)[0].tokens[0].tokens.map((t) => t.type)).toEqual(["text", "inlineKatex"]);
  });

  it("(b) at the start of bold's text and at the edges of italic and strikethrough", () => {
    expectInserted(insert("**bold**", 2), `**${M} bold**`);
    expectInserted(insert("*it* x", 3), `*it ${M}* x`);
    expectInserted(insert("~~gone~~ x", 2), `~~${M} gone~~ x`);
  });

  it("(c) nested emphasis: the inner edge of both", () => {
    expectInserted(insert("***both***", 7), `***both ${M}***`);
  });

  it("(d) outside the markers it is as before: a space where marked needs one", () => {
    expectInserted(insert("**Note**: text", 8), `**Note** ${M}: text`);
  });
});

describe("AT-MATH-05 the templates render with KaTeX without an error", () => {
  const boxes = CONFIG.edit.mathBoxesTemplate;

  it("(a) the inline template is one inline math token, the math boxes six blocks under their names", () => {
    const inline = app.lexer(M)[0].tokens;
    expect(inline.map((t) => t.type)).toEqual(["inlineKatex"]);
    const blocks = lexBlocks(boxes).filter((t) => t.type !== "space");
    expect(blocks.map((t) => t.type)).toEqual(["paragraph", "blockKatex", "paragraph", "blockKatex", "paragraph", "blockKatex"]);
    expect(blocks.filter((t) => t.type === "paragraph").map((t) => t.text)).toEqual([
      "Maxwell's Equations",
      "Einstein Field Equations and Christoffel Symbols",
      "Schroedinger Equation, Wavefunction Normalization, and Pauli Matrices",
    ]);
  });

  it("(b) KaTeX with throwOnError: true renders each of them, in the mode the app draws it in", () => {
    // marked-katex-extension: inline math in inline mode, a math block in display mode
    const inline = inlineMath(M)[0].slice(1, -1);
    expect(() => katex.renderToString(inline, { throwOnError: true, displayMode: false })).not.toThrow();
    const blocks = lexBlocks(boxes).filter((t) => t.type === "blockKatex").map((t) => t.text);
    expect(blocks).toHaveLength(3);
    for (const tex of blocks) expect(() => katex.renderToString(tex, { throwOnError: true, displayMode: true })).not.toThrow();
  });

  it("(c) drawn by MarkdownRenderer: three display formulas and an inline one, no error", () => {
    const preview = document.createElement("div");
    const marked = new Marked();
    marked.use(markedKatex({ throwOnError: false }));
    new MarkdownRenderer(preview, marked, hljs, DOMPurify).render(`${boxes}\n\nNapier: ${M}\n`);
    expect(preview.querySelectorAll(".katex-display")).toHaveLength(3);
    expect(preview.querySelectorAll(".katex")).toHaveLength(4);
    expect(preview.querySelector(".katex-error")).toBeNull();
    expect(preview.textContent).toContain("Maxwell's Equations");
  });
});
