import { describe, it, expect, vi } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import MarkdownTextOps from "../js/classes/MarkdownTextOps.js";
import DevelopStrip from "./helpers/developStrip.js";

// INV-71: Enter / Shift+Enter in a paragraph, list or quote block inserts
// a hard line break (two spaces + newline); (6) on commit, the trailing
// spaces that make no line break are removed. null: the browser's newline.

const app = new Marked();
app.use(markedKatex({ throwOnError: false }));

function lexBlocks(src) {
  const lexer = new app.Lexer(app.defaults);
  lexer.blockTokens(src, lexer.tokens);
  return lexer.tokens;
}
const lexFull = (src) => app.lexer(src);
const walkTokens = (tokens, fn) => app.walkTokens(tokens, fn);
const S = "  "; // two spaces (shown as two spaces in the spec)

const lexInline = (src) => new app.Lexer(app.defaults).inlineTokens(src);
const breakAt = (text, at, end = at) => MarkdownTextOps.insertHardBreak(text, at, end, { lexBlocks, lexInline });
const strip = (raw) => MarkdownTextOps.stripMeaninglessHardBreaks(raw, lexFull, walkTokens);

describe("AT-HB insertHardBreak (INV-71 (1)-(5))", () => {
  it("AT-HB-01 a paragraph: two spaces and a newline at the caret", () => {
    expect(breakAt("abc", 3)).toEqual({ text: `abc${S}\n`, selStart: 6, selEnd: 6 });
    expect(breakAt("abcdef", 3)).toEqual({ text: `abc${S}\ndef`, selStart: 6, selEnd: 6 });
  });

  it("AT-HB-02 a list item: the item mark is not added (ruling UIR-47)", () => {
    expect(breakAt("- a", 3).text).toBe(`- a${S}\n`);
  });

  it("AT-HB-03 a quote: the quote marks of the line are added after the newline", () => {
    expect(breakAt("> abc", 5)).toEqual({ text: `> abc${S}\n> `, selStart: 10, selEnd: 10 });
    expect(breakAt("> > abc", 7).text).toBe(`> > abc${S}\n> > `);
  });

  it("AT-HB-04 a selection is replaced", () => {
    expect(breakAt("abXYcd", 2, 4)).toEqual({ text: `ab${S}\ncd`, selStart: 5, selEnd: 5 });
  });

  it("AT-HB-05 an empty line: only a newline, and the line break mark of the line before goes (a paragraph break)", () => {
    expect(breakAt(`abc${S}\n`, 6)).toEqual({ text: "abc\n\n", selStart: 5, selEnd: 5 });
    expect(breakAt(`abc${S}\ndef`, 6)).toEqual({ text: "abc\n\ndef", selStart: 5, selEnd: 5 });
  });

  it("AT-HB-06 an empty quote line: the quote marks are added, the mark of the line before goes", () => {
    expect(breakAt(`> abc${S}\n> `, 10)).toEqual({ text: "> abc\n> \n> ", selStart: 11, selEnd: 11 });
  });

  it.each([
    ["a fenced code block in a list item", "- a\n\n  ```\n  x\n  ```", "  x"],
    ["an indented code block in a list item", "- a\n\n      code", "code"],
    ["an HTML block in a quote", "> <div>\n> x\n> </div>", "x"],
    ["a math block in a quote", "> $$\n> x\n> $$", "> x"],
    ["a heading", "# H", "H"],
  ])("AT-HB-07 a normal newline (null): %s", (_name, text, part) => {
    expect(breakAt(text, text.indexOf(part) + part.length)).toBe(null);
  });

  it("AT-HB-08 an empty editor: a normal newline (null)", () => {
    expect(breakAt("", 0)).toBe(null);
  });
});

describe("AT-HB stripMeaninglessHardBreaks (INV-71 (6))", () => {
  it.each([
    ["a list item before another item", `- a${S}\n- b`, "- a\n- b"],
    ["before a blank line", `abc${S}\n\ndef`, "abc\n\ndef"],
    ["the last line", `abc${S}`, "abc"],
    ["before a heading", `abc${S}\n# H`, "abc\n# H"],
    ["a closed code span on the line", `x \`c\` d${S}\n- e`, "x `c` d\n- e"],
    ["after a code span (a text token of spaces)", `x \`c\`${S}\n- d`, "x `c`\n- d"],
    ["after inline HTML", `x <b>y</b>${S}\n- z`, "x <b>y</b>\n- z"],
    ["after bold", `**a**${S}\n- b`, "**a**\n- b"],
    ["after a link", `see [a](u)${S}\n- b`, "see [a](u)\n- b"],
    ["the last item of a list", `- a\n- b${S}`, "- a\n- b"],
    ["a one-item list", `- b${S}`, "- b"],
    ["the last item of an ordered list", `1. a\n2. b${S}`, "1. a\n2. b"],
  ])("AT-HB-09 removed: %s", (_name, raw, expected) => {
    expect(strip(raw)).toBe(expected);
  });

  it.each([
    ["the next line is a paragraph line (2. does not start a list here)", `abc${S}\n2. x`],
    ["a paragraph", `abc${S}\ndef`],
    ["a quote", `> a${S}\n> b`],
    ["a list item that goes on", `- a${S}\n${S}b`],
    ["a code span over the lines", `x \`a${S}\nb\` y`],
    ["a code span over the lines in a list", `- \`a${S}\nb\``],
    ["an HTML attribute over the lines", `x <span title="a${S}\nb">y</span> z`],
    ["an HTML attribute over the lines in a quote", `> x <abbr title="a${S}\nb">y</abbr>`],
    ["a link title over the lines", `[a](u "t${S}\nx")`],
    ["an image title over the lines", `![a](u "t${S}\nx")`],
    ["a fenced code block", `\`\`\`\nc${S}\n\`\`\``],
    ["an indented code block", `    code${S}\n    more`],
  ])("AT-HB-10 kept: %s", (_name, raw) => {
    expect(strip(raw)).toBe(raw);
  });

  it("AT-HB-11 each candidate on its own: the meaningful ones stay", () => {
    expect(strip(`a${S}\nb${S}\n\nc${S}`)).toBe(`a${S}\nb\n\nc`);
  });

  it("AT-HB-12 a text without candidates is returned as it is", () => {
    expect(strip("plain\ntext")).toBe("plain\ntext");
  });
});

describe("AT-HB hardBreakLines (INV-70: the line ends that get a mark)", () => {
  it("AT-HB-13 paragraph lines that end with two or more spaces; not in code", () => {
    const text = `a${S}\nb\n\n\`\`\`\nc${S}\n\`\`\`\n- d${S}\n> e${S}`;
    expect(MarkdownTextOps.hardBreakLines(text, lexBlocks)).toEqual([true, false, false, false, false, false, true, true]);
  });
});

// The cost on large blocks: always the number of full lexings, which does
// not depend on the machine (one for the block as it was and one for the
// rewrite; STRIP_MAX_LEXES = 8 in all, the first one included, where the
// halving search hits the cap); the time against INV-51's 300 ms only with
// GRSMD_PERF=1 (as AT-PERF-02..09), since a loaded machine (e2e at the same
// time) made it fail with nothing wrong.
const PERF = process.env.GRSMD_PERF === "1";
const STRIP_MAX_LEXES = 8;
const BUDGET_MS = 300;
const timed = (fn) => {
  const t0 = performance.now();
  const out = fn();
  return { out, ms: performance.now() - t0 };
};
/** strip, counting the full lexings. */
const counted = (raw) => {
  let lexes = 0;
  const lex = (src) => {
    lexes++;
    return lexFull(src);
  };
  const { out, ms } = timed(() => MarkdownTextOps.stripMeaninglessHardBreaks(raw, lex, walkTokens));
  return { out, ms, lexes };
};
const inBudget = (ms) => {
  if (PERF) expect(ms).toBeLessThan(BUDGET_MS);
};

describe("AT-HB the cost on large blocks: the lexings (INV-51; 300 ms on commit with GRSMD_PERF=1)", () => {
  const lines = (n, line) => Array.from({ length: n }, (_, i) => line(i)).join("\n");

  it("AT-HB-14 a list of 1,000 items, each line ending with two spaces", () => {
    const raw = lines(1000, (i) => `- item ${i} with some text${S}`);
    const { out, ms, lexes } = counted(raw);
    expect(out).toBe(raw.replace(/ +$/gm, ""));
    expect(lexes).toBe(2);
    inBudget(ms);
  });

  it("AT-HB-15 a paragraph of 1,000 lines, each ending with two spaces (the last one goes)", () => {
    const raw = lines(1000, (i) => `line ${i} with some text${S}`);
    const { out, ms, lexes } = counted(raw);
    expect(out).toBe(raw.replace(/ +$/, ""));
    expect(lexes).toBe(2);
    inBudget(ms);
  });

  it("AT-HB-16 500 short paragraphs of two lines: the line breaks stay, the paragraph ends go", () => {
    const raw = lines(500, (i) => `a${i}${S}\nb${i}${S}\n`);
    const { out, ms, lexes } = counted(raw);
    expect(out).toBe(lines(500, (i) => `a${i}${S}\nb${i}\n`));
    expect(lexes).toBe(2);
    inBudget(ms);
  });

  it("AT-HB-17 hardBreakLines and canFormatRange on a 1,000-line paragraph: one block lexing each", () => {
    const text = lines(1000, (i) => `line ${i} with some text${S}`);
    let lexes = 0;
    const lex = (src) => {
      lexes++;
      return lexBlocks(src);
    };
    const marks = timed(() => MarkdownTextOps.hardBreakLines(text, lex));
    expect(marks.out.every(Boolean)).toBe(true);
    expect(lexes).toBe(1);
    inBudget(marks.ms);
    lexes = 0;
    const can = timed(() => MarkdownTextOps.canFormatRange(text, 5, 9, lex));
    expect(can.out).toBe(true);
    expect(lexes).toBe(1);
    inBudget(can.ms);
  });
});

describe("AT-HB the clean-up never tries code, HTML or math lines", () => {
  const lines = (n, line) => Array.from({ length: n }, (_, i) => line(i)).join("\n");

  it("AT-HB-18 1,000 code lines with end spaces in a list item: kept, lexed twice (300 ms with GRSMD_PERF=1)", () => {
    const raw = `- item${S}\n\n  \`\`\`js\n${lines(1000, (i) => `  const x${i} = ${i};${S}`)}\n  \`\`\`\n- last${S}`;
    const { out, ms, lexes } = counted(raw);
    expect(out).toBe(raw.replace(/^- item {2}$/m, "- item").replace(/^- last {2}$/m, "- last"));
    expect(lexes).toBe(2);
    inBudget(ms);
  });

  it("AT-HB-19 1,000 indented code lines in a quote: kept, lexed twice (300 ms with GRSMD_PERF=1)", () => {
    const raw = `> q${S}\n>\n${lines(1000, (i) => `>     code ${i}${S}`)}`;
    const { out, ms, lexes } = counted(raw);
    expect(out).toBe(raw.replace(/^> q {2}$/m, "> q"));
    expect(lexes).toBe(2);
    inBudget(ms);
  });

  it("AT-HB-20 a backslash before the end spaces is kept (a space break never becomes a backslash break)", () => {
    const raw = `abc\\${S}\ndef \`x${S}\ny\``;
    expect(strip(raw)).toBe(raw);
  });
});

describe("AT-HB no line break mark inside inline syntax (INV-71 (1), owner ruling 2026-10-22)", () => {
  it.each([
    ["AT-HB-21 a code span", "x `ab` y", "`a"],
    ["AT-HB-22 an inline HTML tag", 'x <span title="ab">y</span>', 'title="a'],
    ["AT-HB-23 inline math", "x $ab$ y", "$a"],
    ["AT-HB-24 a link destination", "x [l](http://a.b) y", "http://a"],
  ])("%s: a normal newline (null)", (_name, text, before) => {
    expect(breakAt(text, text.indexOf(before) + before.length)).toBe(null);
  });

  it("AT-HB-25 right before and after the syntax the mark goes in", () => {
    expect(breakAt("x `ab` y", 2).text).toBe(`x ${S}\n\`ab\` y`);
    expect(breakAt("x `ab` y", 6).text).toBe(`x \`ab\`${S}\n y`);
    expect(breakAt("**bold** z", 2)).toBe(null);
    expect(breakAt("**bold** z", 6)).toBe(null);
    expect(breakAt("**bold** z", 4).text).toBe(`**bo${S}\nld** z`);
    expect(breakAt("**bold** z", 8).text).toBe(`**bold**${S}\n z`);
  });
});

describe("AT-HB the worst case of the clean-up (INV-51)", () => {
  const lines = (n, line) => Array.from({ length: n }, (_, i) => line(i)).join("\n");
  it.each([
    ["AT-HB-26 code spans over the lines of a list", lines(500, (i) => `- \`a${i}${S}\n  b${i}\``)],
    ["AT-HB-27 HTML attributes over the lines of a paragraph", lines(500, (i) => `<span title="a${i}${S}\nb${i}">x</span>`)],
    ["AT-HB-28 code spans over the lines, every other item", lines(500, (i) => (i % 2 ? `- \`a${i}${S}\n  b${i}\`` : `- c${i}${S}`))],
  ])("%s: lexed 8 times, the cap (300 ms with GRSMD_PERF=1), and what is shown does not change", (_name, raw) => {
    const { out, ms, lexes } = counted(raw);
    expect(lexes).toBe(STRIP_MAX_LEXES);
    inBudget(ms);
    // spaces before a closing tag are not shown
    const shown = (md) => app.parse(md).replace(/ +</g, "<");
    expect(shown(out)).toBe(shown(raw));
  });
});

describe("AT-HB the places of ruling R5 (INV-71 (1) (iv)-(xi)): a normal newline", () => {
  it.each([
    ["AT-HB-29 inside an entity reference", "x &amp; y", "x &am"],
    ["AT-HB-30 inside an escape", "x \\* y", "x \\"],
    ["AT-HB-31 inside an autolink", "see <http://a.b> now", "<http"],
    ["AT-HB-32 inside a bare URL", "see https://a.b/c now", "https://a"],
    ["AT-HB-33 right inside the emphasis markers (after the opener)", "x **bold** y", "x **"],
    ["AT-HB-34 right inside the emphasis markers (before the closer)", "x *it* y", "x *it"],
    ["AT-HB-35 inside an image", "x ![ab](u.png) y", "![a"],
    ["AT-HB-36 right inside the brackets of a link text (after [)", "x [ab](u) y", "x ["],
    ["AT-HB-37 right inside the brackets of a link text (before ])", "x [ab](u) y", "x [ab"],
    ["AT-HB-38 inside a line break token", `ab${S}\ncd`, "ab "],
  ])("%s", (_name, text, before) => {
    expect(breakAt(text, text.indexOf(before) + before.length)).toBe(null);
  });

  it("AT-HB-39 inside the text of a link or of emphasis the mark goes in", () => {
    expect(breakAt("x [ab](u) y", 4).text).toBe(`x [a${S}\nb](u) y`);
    expect(breakAt("x *it* y", 4).text).toBe(`x *i${S}\nt* y`);
  });
});

describe("AT-HB strikethrough markers and reference labels (INV-71 (1) (vii)(viii))", () => {
  const links = { ref: { href: "u", title: null }, t: { href: "v", title: null } };
  const withLinks = (text, at) =>
    MarkdownTextOps.insertHardBreak(text, at, at, {
      lexBlocks,
      lexInline: (src) => {
        const lexer = new app.Lexer(app.defaults);
        Object.assign(lexer.tokens.links, links);
        return lexer.inlineTokens(src);
      },
    });

  it.each([
    ["AT-HB-40 right after the opening ~~", "x ~~del~~ y", "x ~~"],
    ["AT-HB-41 right before the closing ~~", "x ~~del~~ y", "x ~~del"],
  ])("%s: a normal newline", (_name, text, before) => {
    expect(breakAt(text, text.indexOf(before) + before.length)).toBe(null);
  });

  it.each([
    ["AT-HB-42 inside the label of a full reference", "x [t][ref] y", "x [t][r"],
    ["AT-HB-43 inside the brackets of a collapsed reference", "x [t][] y", "x [t]["],
    ["AT-HB-44 between the text and the destination", "x [t](u) y", "x [t]"],
    ["AT-HB-45 between the text and the label", "x [t][ref] y", "x [t]"],
  ])("%s: a normal newline (the document's definitions)", (_name, text, before) => {
    expect(withLinks(text, text.indexOf(before) + before.length)).toBe(null);
  });

  it("AT-HB-46 right after a reference link the mark goes in", () => {
    expect(withLinks("x [t][ref] y", 10).text).toBe(`x [t][ref]${S}\n y`);
  });
});

describe("AT-HB inside the emphasis markers (INV-71 (1) (viii))", () => {
  it.each([
    ["AT-HB-47 between the two stars of an opener", "x **bold** y", "x *"],
    ["AT-HB-48 between the two stars of a closer", "x **bold** y", "x **bold*"],
    ["AT-HB-49 between the two tildes of an opener", "x ~~del~~ y", "x ~"],
    ["AT-HB-50 between the two tildes of a closer", "x ~~del~~ y", "x ~~del~"],
  ])("%s: a normal newline", (_name, text, before) => {
    expect(breakAt(text, text.indexOf(before) + before.length)).toBe(null);
  });
});

describe("AT-HB inside one character (INV-71 (1) (xi))", () => {
  it("AT-HB-51 between the two code units of a surrogate pair: a normal newline (a textarea never puts the caret there)", () => {
    const text = "x \ud83d\ude00 y";
    expect(breakAt(text, 3)).toBe(null);
    expect(breakAt(text, 4).text).toBe(`x \ud83d\ude00${S}\n y`);
  });
});

describe("AT-HB the start of a line and the selection's end (INV-71 (1))", () => {
  it.each([
    ["AT-HB-52 a code span over the lines", `x \`a${S}\nb\` y`],
    ["AT-HB-53 an HTML attribute over the lines", `<span title="a${S}\nb">x</span>`],
  ])("%s: Enter at the start of the second line is a normal newline (the spaces stay)", (_name, text) => {
    expect(breakAt(text, text.indexOf("\n") + 1)).toBe(null);
  });

  it("AT-HB-54 at the start of a plain paragraph line the paragraph still breaks", () => {
    expect(breakAt(`abc${S}\ndef`, 6).text).toBe("abc\n\ndef");
  });

  it.each([
    ["AT-HB-55 another item of a list", "- aaa\n- x `code` y", "- a", "co"],
    ["AT-HB-56 another paragraph of a quote", "> aaa\n>\n> x `code` y", "> a", "co"],
    ["AT-HB-57 another item, without syntax", "- aaa\n- bbb", "- a", "- b"],
  ])("%s: a selection that ends there is a normal newline", (_name, text, start, end) => {
    expect(breakAt(text, text.indexOf(start) + start.length, text.lastIndexOf(end) + end.length)).toBe(null);
  });

  it("AT-HB-58 in or right after the list marks: a normal newline", () => {
    expect(breakAt("- abc", 1)).toBe(null);
    expect(breakAt("- abc", 2)).toBe(null);
    expect(breakAt("- abc", 3).text).toBe(`- a${S}\nbc`);
  });

  it("AT-HB-59 a selection over lines of the same paragraph is replaced", () => {
    expect(breakAt("ab\ncd", 1, 4).text).toBe(`a${S}\nd`);
  });
});

describe("AT-HB the lexing kept per text (review P-4, INV-51)", () => {
  it("AT-HB-60 with the same block tokens, the per-line table is worked out once (the button states ask every frame)", () => {
    const text = Array.from({ length: 50 }, (_, i) => `- item ${i} with words`).join("\n");
    const tokens = lexBlocks(text);
    const cachedLex = () => tokens;
    const map = vi.spyOn(MarkdownTextOps, "_mapLeaves");
    try {
      const at = text.indexOf("item 20");
      expect(MarkdownTextOps.canFormatRange(text, at, at + 4, cachedLex)).toBe(true);
      const calls = map.mock.calls.length;
      expect(MarkdownTextOps.canFormatRange(text, at + 1, at + 6, cachedLex)).toBe(true);
      expect(MarkdownTextOps.insertHardBreak(text, at + 2, at + 2, { lexBlocks: cachedLex, lexInline }).text).toContain(`it${S}\nem 20`);
      expect(map.mock.calls.length).toBe(calls);
      // the same tokens object given for another text: the kept table is not
      // taken for it (the tokens do not add up to that text: no range)
      expect(MarkdownTextOps.canFormatRange(`${text}x`, at, at + 4, cachedLex)).toBe(false);
      expect(MarkdownTextOps._leafTable(`${text}x`, cachedLex)).toBe(null);
      expect(MarkdownTextOps._leafTable(text, cachedLex)).not.toBe(null);
    } finally {
      map.mockRestore();
    }
  });

  it("AT-HB-61 hardBreakLines does not lex a text without a line end of two spaces", () => {
    const lex = vi.fn(lexBlocks);
    expect(MarkdownTextOps.hardBreakLines("a\nb \nc", lex)).toEqual([false, false, false]);
    expect(lex).not.toHaveBeenCalled();
    expect(MarkdownTextOps.hardBreakLines(`a${S}\nb`, lex)).toEqual([true, false]);
    expect(lex).toHaveBeenCalledTimes(1);
  });
});

// The line break spaces of a line are found from the first of their run, in
// time linear in the line (review of the render hang). / {2,}$/ and / +$/
// read a long run of spaces again from every start in it when the run was
// not at the end. This check runs always (as AT-WRAP-20 and AT-FR-65): it
// now takes a few ms, so the budget leaves a wide margin.
const LONG_RUN_BUDGET_MS = 1000;

describe("AT-HB a long run of spaces inside a line (linear line-end-space search)", () => {
  const run = " ".repeat(100000);

  it("AT-HB-62 hardBreakLines: 100,000 spaces inside a line are no line break, within 1,000 ms", () => {
    const { out, ms } = timed(() => MarkdownTextOps.hardBreakLines(`a${run}x\nb`, lexBlocks));
    expect(out).toEqual([false, false]);
    expect(ms).toBeLessThan(LONG_RUN_BUDGET_MS);
  });

  it("AT-HB-63 stripMeaninglessHardBreaks: the end spaces of a line with 100,000 spaces inside go, within 1,000 ms", () => {
    const raw = `a${run}x${S}`;
    const { out, ms } = timed(() => strip(raw));
    expect(out).toBe(`a${run}x`);
    expect(ms).toBeLessThan(LONG_RUN_BUDGET_MS);
  });
});

describe("AT-HB lineBreakSpaceCount (one rule for the line break mark, INV-71 and INV-70)", () => {
  it("AT-HB-64 the number of end spaces when two or more, else 0; a tab or NBSP ends the run", () => {
    expect(MarkdownTextOps.lineBreakSpaceCount(`a${S}`)).toBe(2);
    expect(MarkdownTextOps.lineBreakSpaceCount("a    ")).toBe(4);
    expect(MarkdownTextOps.lineBreakSpaceCount("a ")).toBe(0);
    expect(MarkdownTextOps.lineBreakSpaceCount("a")).toBe(0);
    expect(MarkdownTextOps.lineBreakSpaceCount(`a${S}\t`)).toBe(0);
    expect(MarkdownTextOps.lineBreakSpaceCount("a\t  ")).toBe(2);
    expect(MarkdownTextOps.lineBreakSpaceCount(S)).toBe(2);
  });
});

// Spec: INV-71 (1).
describe("AT-HB-65 a paragraph that starts with a line of only $ or $$ (a math block being typed): a normal newline", () => {
  it.each([
    ["$$ alone", "$$", 2],
    ["$ alone", "$", 1],
    ["the line after $$", "$$\nx", 4],
    ["$$ with spaces around", " $$ \nx", 6],
    ["$$ in a list item", "- $$\n  x", 8],
    ["$$ in a quote", "> $$\n> x", 8],
    ["the empty line after the math lines", "$$\nx\n", 5],
  ])("%s", (_name, text, at) => {
    expect(breakAt(text, at)).toBeNull();
  });

  it("other paragraphs with $ still take the mark: inline math, a price, $$ on a later line", () => {
    expect(breakAt("$$x$$ y", 7)).toEqual({ text: `$$x$$ y${S}\n`, selStart: 10, selEnd: 10 });
    expect(breakAt("$5", 2)).toEqual({ text: `$5${S}\n`, selStart: 5, selEnd: 5 });
    expect(breakAt("abc\n$$", 6)).toEqual({ text: `abc\n$$${S}\n`, selStart: 9, selEnd: 9 });
  });

  it("the math lines typed with normal newlines lex as a math block", () => {
    expect(lexBlocks("$$\nx\n$$").map((t) => t.type)).toEqual(["blockKatex"]);
  });
});

// Spec: INV-71 (6), INV-51.
describe("AT-HB-66 the clean-up with the block lexer: a text of many blocks is decided block by block (review G10)", () => {
  const lines = (n, line) => Array.from({ length: n }, (_, i) => line(i)).join("\n");
  const stripByBlock = (raw) => MarkdownTextOps.stripMeaninglessHardBreaks(raw, lexFull, walkTokens, lexBlocks);

  it("each kind of block as on its own: code spans, headings, lists, quotes, code, blank lines and the last line", () => {
    const raw = `\`a${S}\nb\`\n\n# h${S}\n${S}\n- x${S}\n- y${S}\n\n> q${S}\n> r${S}\n\n\`\`\`\nc${S}\n\`\`\`\n\nlast${S}`;
    const expected = `\`a${S}\nb\`\n\n# h\n\n- x\n- y\n\n> q${S}\n> r\n\n\`\`\`\nc${S}\n\`\`\`\n\nlast`;
    expect(stripByBlock(raw)).toBe(expected);
    expect(strip(raw)).toBe(expected);
  });

  // Spec: INV-71 (6).
  it.each([
    ["an opening $$ before other blocks (the review's example)", `$$${S}\n\nSee the list:\n\n- a\n- b\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n\n$$\n\nEnd.`],
    ["a closing $$ after other blocks", `$$\n\nSee the list:\n\n- a\n\n$$${S}\n\nEnd.`],
    ["$ alone and $$ after list and quote marks", `$${S}\n\nx\n\n- $$${S}\n\n> $$${S}\n\ny`],
    ["one block of $$ with three spaces (an open paragraph of a document, review L1)", `$$${S} `],
  ])("N1: the spaces of a line of only $ or $$ stay: %s", (_name, raw) => {
    expect(stripByBlock(raw)).toBe(raw);
    expect(strip(raw)).toBe(raw);
    expect(lexBlocks(stripByBlock(raw)).map((t) => t.type)).toEqual(lexBlocks(raw).map((t) => t.type));
  });

  it("N1: when the joined blocks lex otherwise, the whole text decides", () => {
    const raw = `a${S}\n\n# h${S}\n\nb${S}\nc`;
    let joinedSeen = false;
    // Why: no real text changes its blocks after the $ lines are kept, so the block lexer reports a change for the joined text
    const lexChanged = (src) => {
      if (src === raw || !src.includes("\n\n")) return lexBlocks(src);
      joinedSeen = true;
      return [...lexBlocks(src), { type: "paragraph", raw: "" }];
    };
    let wholeLexes = 0;
    const out = MarkdownTextOps.stripMeaninglessHardBreaks(raw, (src) => ((wholeLexes += src === raw ? 1 : 0), lexFull(src)), walkTokens, lexChanged);
    expect(joinedSeen).toBe(true);
    expect(wholeLexes).toBe(1);
    expect(out).toBe(strip(raw));
    expect(out).toBe(`a\n\n# h\n\nb${S}\nc`);
  });

  it("N4: when the joined blocks keep their number but change a type, the whole text decides", () => {
    const raw = `a${S}\n\n# h${S}\n\nb${S}\nc`;
    let joinedSeen = false;
    // Why: as above, the block lexer reports the change: the same number of blocks, the first paragraph now a math block
    const lexRetyped = (src) => {
      const blocks = lexBlocks(src);
      if (src === raw || !src.includes("\n\n")) return blocks;
      joinedSeen = true;
      return [{ ...blocks[0], type: "blockKatex" }, ...blocks.slice(1)];
    };
    let wholeLexes = 0;
    const out = MarkdownTextOps.stripMeaninglessHardBreaks(raw, (src) => ((wholeLexes += src === raw ? 1 : 0), lexFull(src)), walkTokens, lexRetyped);
    expect(joinedSeen).toBe(true);
    expect(wholeLexes).toBe(1);
    expect(out).toBe(strip(raw));
  });

  // Spec: INV-71 (6).
  it.each([
    ["a paragraph", `a\n$$${S}\nb${S}`, `a\n$$${S}\nb`],
    ["a list item", `- a\n  $$${S}\n  b${S}`, `- a\n  $$${S}\n  b`],
    ["a quote", `> a\n> $$${S}\n> b${S}`, `> a\n> $$${S}\n> b`],
  ])("N3: a kept $$ line inside %s still counts as its line break; the other end spaces that make none go, as before", (_name, raw, expected) => {
    const { out, lexes } = counted(raw);
    expect(out).toBe(expected);
    expect(lexes).toBeLessThanOrEqual(3);
    expect(stripByBlock(raw)).toBe(expected);
  });

  // Spec: INV-71 (6), INV-51.
  it("N3: with a kept $$ line, a line break that stays is not tried again (two lexings)", () => {
    const { out, lexes } = counted(`x${S}\n$$${S}\ny${S}`);
    expect(out).toBe(`x${S}\n$$${S}\ny`);
    expect(lexes).toBe(2);
  });

  // Spec: INV-71 (1), INV-71 (6).
  it.each([
    ["a quote in a list", "- > $$"],
    ["a list in a list", "1. - $$"],
  ])("N5: $$ after nested marks (%s): the Enter is a normal newline and the clean-up keeps the spaces", (_name, line) => {
    expect(breakAt(line, line.length)).toBeNull();
    expect(strip(`${line}${S}`)).toBe(`${line}${S}`);
    expect(strip(`x\n\n${line}${S}`)).toBe(`x\n\n${line}${S}`);
  });

  it("one block: the block lexer changes nothing (the whole text, as before)", () => {
    const raw = `a${S}\nb${S}`;
    expect(stripByBlock(raw)).toBe(`a${S}\nb`);
  });

  it("400 blocks where a group cannot go at once: each lexing is one block, under 3 times the text in all (the whole text was lexed over 5 times)", () => {
    const raw = lines(400, (i) => (i % 2 ? `c${i}${S}\n` : `\`a${i}${S}\nb${i}\`\n`));
    let chars = 0;
    let longest = 0;
    const lex = (src) => {
      chars += src.length;
      longest = Math.max(longest, src.length);
      return lexFull(src);
    };
    const out = MarkdownTextOps.stripMeaninglessHardBreaks(raw, lex, walkTokens, lexBlocks);
    expect(out).toBe(lines(400, (i) => (i % 2 ? `c${i}\n` : `\`a${i}${S}\nb${i}\`\n`)));
    expect(chars).toBeLessThan(3 * raw.length);
    expect(longest).toBeLessThan(20);
    let wholeChars = 0;
    MarkdownTextOps.stripMeaninglessHardBreaks(raw, (src) => ((wholeChars += src.length), lexFull(src)), walkTokens);
    expect(wholeChars).toBeGreaterThan(5 * raw.length);
  });
});

// Spec: INV-71 (6).
describe("AT-HB-67 the clean-up gives develop's text letter by letter, but for the $ / $$ lines kept by the ruling (review N6, N7)", () => {
  const stripByBlock = (raw) => MarkdownTextOps.stripMeaninglessHardBreaks(raw, lexFull, walkTokens, lexBlocks);
  // Why: an expectation of its own for the kept lines, not this branch's _isMathFenceLine
  const isFence = (line) => /^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*\${1,2}[ \t]*$/.test(line);
  const kept = (line) => isFence(line) && MarkdownTextOps.lineBreakSpaceCount(line) > 0;
  // Why: develop's output, but each line of only $ or $$ that had end spaces stays as it was (the ruling of review N1); capped: develop used all its 8 lexings
  const developOf = (raw) => {
    let lexes = 0;
    const before = raw.split("\n");
    const text = DevelopStrip.stripMeaninglessHardBreaks(raw, (src) => ((lexes += 1), lexFull(src)), walkTokens)
      .split("\n")
      .map((line, n) => (kept(before[n]) ? before[n] : line))
      .join("\n");
    return { text, capped: lexes >= STRIP_MAX_LEXES };
  };
  const expected = (raw) => developOf(raw).text;
  // Why: develop tries the $ / $$ lines too, and when they fail it may reach its 8 lexings before other lines are decided; then this branch decides more lines, so each line is develop's or the original without its end spaces, and the breaks and tokens stay
  const checkAgainstDevelop = (raw, outs) => {
    const develop = developOf(raw);
    const before = raw.split("\n");
    const wantLines = develop.text.split("\n");
    const shape = (md) => DevelopStrip._tokenShape(lexFull(md), walkTokens);
    for (const out of outs) {
      if (!develop.capped) {
        expect(out, JSON.stringify(raw)).toBe(develop.text);
        continue;
      }
      out.split("\n").forEach((line, n) => {
        const allowed = kept(before[n]) ? [before[n]] : [wantLines[n], before[n].replace(/ +$/, "")];
        expect(allowed, JSON.stringify(raw)).toContain(line);
      });
      expect(shape(out), JSON.stringify(raw)).toEqual(shape(raw));
    }
  };

  it.each([
    ["$$ at a list's end", `- $$${S}\n\nx${S}`],
    ["indented code in a list item, at its end", `- a\n\n      code${S}\n\nx${S}`],
    ["an unclosed fence in a list item", `- a\n  \`\`\`\n  c${S}\n\nx${S}`],
    ["an HTML block in a list item", `- a\n\n  <div>${S}\n\nx${S}`],
    ["indented code in an ordered list item", `1. a\n\n       code${S}\n\nz${S}`],
    ["$ lines in a list item", `- $\n  x${S}\n  $${S}\n\ny${S}`],
    ["the gap paste of the review", `- step\n\n      line one${S}\n\nAfter.`],
    ["a duplicate link definition and a $$ line in a paragraph", `[r]: http://x\n\n[r]: http://x\n\na\n$$${S}\nb${S}`],
    ["a line of only spaces after a math block (a line of its own, not the block's end)", `$$\nx\n$$\n${S}\n\npara${S}`],
    ["a line of only spaces after a fenced code block", `\`\`\`\nc\n\`\`\`\n${S}\n\npara${S}`],
    ["a $$ line in a setext heading", `$$${S} \nend\n$$\nalpha${S} \n===\n\`\`\`js${S} \nconst x = 1;\n\`\`\``],
  ])("the review's forms: %s", (_name, raw) => {
    expect(stripByBlock(raw)).toBe(expected(raw));
    expect(strip(raw)).toBe(expected(raw));
  });

  it("600 random documents (seed 20261113): both ways give the same text as develop", () => {
    let seed = 20261113;
    // Why: mulberry32, a small seeded generator, so a failure comes back the same
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = (items) => items[Math.floor(random() * items.length)];
    const words = () => Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(["alpha", "beta", "*em*", "`code`", "$x$", "[r]", "end."])).join(" ");
    const blocks = [
      () => Array.from({ length: 1 + Math.floor(random() * 3) }, words).join("\n"),
      () => `- ${words()}\n- ${words()}\n  - ${words()}`,
      () => `1. ${words()}\n2. ${words()}`,
      () => `> ${words()}\n> ${words()}`,
      () => "```js\nconst x = 1;\n```",
      () => "```\nopen fence",
      () => "    indented code",
      () => "<div>\nhtml line\n</div>",
      () => `# ${words()}`,
      () => `${words()}\n===`,
      () => "| a | b |\n| --- | --- |\n| x | y |",
      () => pick(["$$", "$", "- $$", "> $$", "1. - $$"]),
      () => `$$\n${words()}\n$$`,
      () => "[r]: http://x",
      () => `- ${words()}\n\n      code in item`,
      () => `\`a\n${words()}\``,
    ];
    const ends = ["", "", S, `${S} `];
    for (let doc = 0; doc < 600; doc++) {
      const parts = Array.from({ length: 2 + Math.floor(random() * 5) }, () => pick(blocks)());
      const raw = parts
        .join(random() < 0.8 ? "\n\n" : "\n")
        .split("\n")
        .map((line) => `${line}${pick(ends)}`)
        .join("\n");
      checkAgainstDevelop(raw, [stripByBlock(raw), strip(raw)]);
    }
  });
});
