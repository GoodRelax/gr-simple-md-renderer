import { describe, it, expect } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import MarkdownTextOps from "../js/classes/MarkdownTextOps.js";

// INV-66 / 67 (6)(7): Bold / Italic / text color in the block editor. Only
// the tokens the selection touches are written again (InlineRuns); the rest
// of the text is not changed. null: not applicable (the button is disabled).

const app = new Marked();
app.use(markedKatex({ throwOnError: false }));
const RED = "#CF222E";
const BLUE = "#0550AE";

/** Block tokens only, as MarkdownRenderer.lex. */
function lexBlocks(src) {
  const lexer = new app.Lexer(app.defaults);
  lexer.blockTokens(src, lexer.tokens);
  return lexer.tokens;
}

function contextWith(links = {}) {
  return {
    lexBlocks,
    lexInline: (src) => {
      const lexer = new app.Lexer(app.defaults);
      Object.assign(lexer.tokens.links, links);
      return lexer.inlineTokens(src);
    },
    colors: [RED, BLUE, "#1A7F37"],
  };
}
const ctx = contextWith();
const STRONG = { kind: "strong" };
const EM = { kind: "em" };

/** Select the first occurrence of part (or the n-th) and apply op. */
function format(text, part, op, context = ctx, occurrence = 0) {
  let at = -1;
  for (let i = 0; i <= occurrence; i++) at = text.indexOf(part, at + 1);
  if (at < 0) throw new Error(`no ${part}`);
  return MarkdownTextOps.formatRange(text, at, at + part.length, op, context);
}

describe("AT-FR formatRange: a paragraph", () => {
  it("AT-FR-01 Bold wraps the selection; the selection stays on the text inside the markers", () => {
    expect(format("Hello word here.", "word", STRONG)).toEqual({ text: "Hello **word** here.", selStart: 8, selEnd: 12 });
  });

  it("AT-FR-02 a second Italic removes it; selecting the markers too works the same", () => {
    const once = format("Hello word here.", "word", EM);
    expect(once.text).toBe("Hello *word* here.");
    const twice = MarkdownTextOps.formatRange(once.text, once.selStart, once.selEnd, EM, ctx);
    expect(twice).toEqual({ text: "Hello word here.", selStart: 6, selEnd: 10 });
    expect(format("Hello *word* here.", "*word*", EM).text).toBe("Hello word here.");
  });

  it("AT-FR-03 only the tokens the selection touches are written again", () => {
    expect(format("x __y__ a_b 3 < 4 &amp; z", "z", STRONG).text).toBe("x __y__ a_b 3 < 4 &amp; **z**");
    expect(format("a \\* b c", "c", STRONG).text).toBe("a \\* b **c**");
  });

  it("AT-FR-04 a format right next to the selection merges with it", () => {
    expect(format("**bb**cc dd", "cc", STRONG).text).toBe("**bbcc** dd");
  });

  it("AT-FR-05 other paragraphs of the editor are not touched", () => {
    expect(format("_a_\n\nHello word", "word", STRONG).text).toBe("_a_\n\nHello **word**");
  });

  it("AT-FR-06 a paragraph of several lines", () => {
    expect(format("a b\nc d", "b\nc", STRONG).text).toBe("a **b\nc** d");
  });

  it("AT-FR-07 the punctuation example (E1, FS-17)", () => {
    expect(format("\u65e5\u672c\u8a9e\u300c\u592a\u5b57\u300d\u3067\u3059", "\u300c\u592a\u5b57\u300d", STRONG).text).toBe(
      "\u65e5\u672c\u8a9e\u300c**\u592a\u5b57**\u300d\u3067\u3059",
    );
  });

  it("AT-FR-08 a selection of punctuation only changes nothing (null)", () => {
    expect(format("a\u300c\u300db", "\u300c\u300d", STRONG)).toBe(null);
  });

  it("AT-FR-09 a selection of markers only changes nothing (null); an empty selection is null", () => {
    expect(MarkdownTextOps.formatRange("**x**", 0, 2, STRONG, ctx)).toBe(null);
    expect(MarkdownTextOps.formatRange("abc", 1, 1, STRONG, ctx)).toBe(null);
  });

  it("AT-FR-10 the middle of a code span or a link takes the whole of it", () => {
    expect(format("x `code` y", "od", STRONG).text).toBe("x **`code`** y");
    expect(format("x [link](u) y", "in", STRONG).text).toBe("x [**link**](u) y");
  });

  it("AT-FR-11 HTML the user wrote is kept as it is", () => {
    expect(format('<span style="color: red">x</span> z', "z", STRONG).text).toBe('<span style="color: red">x</span> **z**');
  });

  it("AT-FR-12 a shortcut reference keeps its label (definitions of the document)", () => {
    const links = { foo: { href: "u", title: null } };
    expect(format("see [foo] now", "foo", STRONG, contextWith(links)).text).toBe("see [**foo**][foo] now");
  });
});

describe("AT-FR formatRange: text color (INV-66)", () => {
  const span = (c, t) => `<span style="color: ${c}">${t}</span>`;
  it("AT-FR-13 the owner's example in the block editor", () => {
    let t = format("bbbbaaaabbbb", "bbbbaaaabbbb", { kind: "color", value: RED }).text;
    expect(t).toBe(span(RED, "bbbbaaaabbbb"));
    t = format(t, "aaaa", { kind: "color", value: BLUE }).text;
    expect(t).toBe(span(RED, "bbbb") + span(BLUE, "aaaa") + span(RED, "bbbb"));
    t = format(t, "aaaa", { kind: "color", value: RED }).text;
    expect(t).toBe(span(RED, "bbbbaaaabbbb"));
    t = format(t, "bbbbaaaabbbb", { kind: "color", value: null }).text;
    expect(t).toBe("bbbbaaaabbbb");
  });

  it("AT-FR-14 the same color again changes nothing (null)", () => {
    expect(format(span(RED, "ab"), "ab", { kind: "color", value: RED })).toBe(null);
  });
});

describe("AT-FR formatRange: the inline ranges (INV-67 (6), glossary)", () => {
  it("AT-FR-15 headings (ATX and setext)", () => {
    expect(format("# Title", "Title", STRONG).text).toBe("# **Title**");
    expect(format("## Title ##", "Title", STRONG).text).toBe("## **Title** ##");
    expect(format("Title\n===", "Title", STRONG).text).toBe("**Title**\n===");
  });

  it("AT-FR-16 one item of a list, also over its lines; not across two items", () => {
    expect(format("- a b\n- c", "b", STRONG).text).toBe("- a **b**\n- c");
    expect(format("- a b\n  c d", "b\n  c", STRONG).text).toBe("- a **b\n  c** d");
    expect(format("- a\n- b", "a\n- b", STRONG)).toBe(null);
  });

  it("AT-FR-17 a paragraph in a quote, over its lines; a nested quote", () => {
    expect(format("> a b\n> c d", "b\n> c", STRONG).text).toBe("> a **b\n> c** d");
    expect(format("> > x", "x", STRONG).text).toBe("> > **x**");
  });

  it("AT-FR-18 one cell of a table; not the delimiter row; not across cells", () => {
    const table = "| a | b |\n|---|---|\n| c | d \\| e |";
    expect(format(table, "d", STRONG).text).toBe("| a | b |\n|---|---|\n| c | **d** \\| e |");
    expect(format(table, "a", EM).text).toBe("| *a* | b |\n|---|---|\n| c | d \\| e |");
    expect(format(table, "---", STRONG)).toBe(null);
    expect(format(table, "c | d", STRONG)).toBe(null);
  });

  it.each([
    ["a fenced code block", "```\nx\n```", "x"],
    ["an indented code block", "    code", "code"],
    ["an HTML block", "<div>\nx\n</div>", "x"],
    ["a math block", "$$\nx\n$$", "x"],
    ["a link definition", "[x]: http://u", "http"],
    ["a code block in a list item", "- a\n\n  ```\n  x\n  ```", "x"],
    ["a selection across a blank line", "a\n\nb", "a\n\nb"],
  ])("AT-FR-19 not in %s (null)", (_name, text, part) => {
    expect(format(text, part, STRONG)).toBe(null);
  });

  it("AT-FR-20 a selection that starts in the quote marks of a line is moved to its text", () => {
    expect(MarkdownTextOps.formatRange("> a\n> b", 4, 7, STRONG, ctx).text).toBe("> a\n> **b**");
  });
});

describe("AT-FR formatRange: the result is checked against marked (INV-67 (8))", () => {
  it("AT-FR-21 null when marked would read the rewritten text differently", () => {
    let calls = 0;
    const lying = {
      ...ctx,
      lexInline: (src) => {
        calls++;
        return calls === 1 ? ctx.lexInline(src) : ctx.lexInline(src.replace(/\*\*/g, ""));
      },
    };
    expect(format("Hello word", "word", STRONG, lying)).toBe(null);
  });
});

describe("AT-FR canFormatRange (5.15.5)", () => {
  it.each([
    ["Hello word", "word", true],
    ["- a b", "b", true],
    ["| a | b |\n|---|---|", "b", true],
    ["a\n\nb", "a\n\nb", false],
    ["```\nx\n```", "x", false],
    ["Hello", "", false],
  ])("AT-FR-22 %j / %j -> %s", (text, part, expected) => {
    const at = part === "" ? 2 : text.indexOf(part);
    expect(MarkdownTextOps.canFormatRange(text, at, at + part.length, lexBlocks)).toBe(expected);
  });
});

describe("AT-FR formatRange: neighbours, entities, HTML and tabs", () => {
  it.each([
    ["a strikethrough next to it", "~a~b", "b", STRONG, "~a~**b**"],
    ["a strikethrough next to it, a color", "~a~b", "b", { kind: "color", value: BLUE }, `~a~<span style="color: ${BLUE}">b</span>`],
    ["an underscore bold next to it", "__a__.b", ".b", EM, "__a__*.b*"],
    ["an underscore italic next to it", "_a_.b", ".b", STRONG, "_a_**.b**"],
  ])("AT-FR-23 a neighbour without the format keeps its notation (INV-67 (7)): %s", (_name, text, part, op, expected) => {
    expect(format(text, part, op).text).toBe(expected);
  });

  it("AT-FR-24 a neighbour with the same format merges and is written in the normal form", () => {
    expect(format("__bb__.cc", ".cc", STRONG).text).toBe("**bb.cc**");
    expect(format(`<span style="color: ${RED}">aa</span>bb`, "bb", { kind: "color", value: RED }).text).toBe(
      `<span style="color: ${RED}">aabb</span>`,
    );
  });

  it("AT-FR-25 an entity reference is never cut: the selection takes it whole", () => {
    expect(format("a &amp; b", "&a", STRONG).text).toBe("a **&amp;** b");
  });

  it("AT-FR-26 the markers never cut an inline HTML element: the selection takes both of its tags", () => {
    expect(format("a <b>x</b> c", "x</b> c", STRONG).text).toBe("a **<b>x</b> c**");
    expect(format("a <b>x</b> c", "x", STRONG).text).toBe("a <b>**x**</b> c");
    expect(format("a <br> c", "<br> c", STRONG).text).toBe("a **<br> c**");
  });

  it("AT-FR-27 tab-indented lines of a list item are in the item's inline range", () => {
    expect(format("- a\n\tb c", "c", STRONG).text).toBe("- a\n\tb **c**");
    expect(format("- a\n\n\tb c", "c", STRONG).text).toBe("- a\n\n\tb **c**");
  });

  it("AT-FR-28 a range of punctuation only gets a format where the markers work with it (INV-67 (5))", () => {
    expect(format("\u300c\u300d", "\u300c\u300d", STRONG).text).toBe("**\u300c\u300d**");
  });

  it("AT-FR-29 null when marked reads the formats differently, even with the same source (INV-67 (8))", () => {
    let calls = 0;
    const plain = {
      ...ctx,
      lexInline: (src) => {
        calls++;
        const tokens = ctx.lexInline(src);
        return calls === 1 ? tokens : tokens.map((t) => (t.type === "strong" ? { type: "text", raw: t.raw, text: t.raw } : t));
      },
    };
    expect(format("Hello word", "word", STRONG, plain)).toBe(null);
    expect(calls).toBe(2);
  });
});

describe("AT-FR a format taken off does not touch its neighbours", () => {
  it("AT-FR-30 Bold off: a neighbour without the format stays as written", () => {
    expect(format("~~a~~**b**", "b", STRONG).text).toBe("~~a~~b");
  });

  it("AT-FR-32 a neighbour is written again only when it cannot stay as written: __a__b is not bold for marked", () => {
    expect(format("__a__**b**", "b", STRONG).text).toBe("**a**b");
  });

  it("AT-FR-31 a color set next to the same color merges the two spans", () => {
    const span = `<span style="color: ${RED}">`;
    expect(format(`${span}a</span>${span}b</span>`, "b", { kind: "color", value: RED }).text).toBe(`${span}ab</span>`);
  });
});

describe("AT-FR removing a color next to a colored span", () => {
  it("AT-FR-33 Remove text color on text without a color, right after a span: null, no exception", () => {
    expect(format(`<span style="color: ${BLUE}">q</span>z`, "z", { kind: "color", value: null })).toBe(null);
  });

  it("AT-FR-34 Remove text color on the colored text next to it removes only that color", () => {
    expect(format(`<span style="color: ${BLUE}">q</span>z`, "q", { kind: "color", value: null }).text).toBe("qz");
  });
});

describe("AT-FR the selection after a format (5.14.14)", () => {
  /** Apply op twice: the second time on the selection the first one left. */
  function twice(text, part, op) {
    const once = format(text, part, op);
    const again = MarkdownTextOps.formatRange(once.text, once.selStart, once.selEnd, op, ctx);
    return { once, again };
  }

  it.each([
    ["AT-FR-35 brackets left out", "\u65e5\u672c\u8a9e\u300c\u592a\u5b57\u300d\u3067\u3059", "\u300c\u592a\u5b57\u300d", "\u65e5\u672c\u8a9e\u300c**\u592a\u5b57**\u300d\u3067\u3059", "\u592a\u5b57"],
    ["AT-FR-36 a percent sign left out", "100%\u3067\u3059", "100%", "**100**%\u3067\u3059", "100"],
    ["AT-FR-37 spaces left out", "a word b", " word ", "a **word** b", "word"],
  ])("%s: the selection is the formatted text; the same button takes it off again", (_name, text, part, formatted, selected) => {
    const { once, again } = twice(text, part, STRONG);
    expect(once.text).toBe(formatted);
    expect(once.text.slice(once.selStart, once.selEnd)).toBe(selected);
    expect(again.text).toBe(text);
  });
});

// The end spaces of a line are found from the first of their run, in time
// linear in the line (review of the render hang, ReDoS). /[ \t]+$/ read a
// long run of spaces again from every start in it when the run was not at
// the end: 100,000 spaces took several seconds per line. This check runs
// always (as AT-WRAP-20): it now takes a few ms, so the budget leaves a
// wide margin on a loaded machine.
const LONG_RUN_BUDGET_MS = 1000;

describe("AT-FR a long run of spaces inside a line (linear end-space search)", () => {
  const run = " ".repeat(100000);
  const timedCan = (text) => {
    const at = text.lastIndexOf("x");
    const t0 = performance.now();
    const can = MarkdownTextOps.canFormatRange(text, at, at + 1, lexBlocks);
    return { can, ms: performance.now() - t0 };
  };

  it.each([
    ["AT-FR-65", "a paragraph line", `a${run}x`],
    ["AT-FR-66", "an ATX heading", `# a${run}x`],
    ["AT-FR-67", "a table cell", `| a |\n| - |\n| b${run}x |`],
  ])("%s 100,000 spaces before the last word of %s: the word can be formatted, within 1,000 ms", (_id, _name, text) => {
    const { can, ms } = timedCan(text);
    expect(can).toBe(true);
    expect(ms).toBeLessThan(LONG_RUN_BUDGET_MS);
  });
});
