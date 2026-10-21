import { describe, it, expect } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import InlineRuns from "../js/classes/InlineRuns.js";

// INV-66 / 67 / 72, spec 5.14.14: the inline format as a list of runs
// (one per character, code span, line break or kept-as-written piece),
// split and merged per format; written back in the normal form.

const app = new Marked();
app.use(markedKatex({ throwOnError: false }));
const RED = "#B84F00";
const BLUE = "#0072B2";
const COLORS = [RED, BLUE, "#007A58"];

/** The app's inline lexer (same marked setup), with reference definitions. */
function lexInline(src, links = {}) {
  const lexer = new app.Lexer(app.defaults);
  Object.assign(lexer.tokens.links, links);
  return lexer.inlineTokens(src);
}

const runsOf = (src, links) => InlineRuns.fromTokens(lexInline(src, links), { colors: COLORS });
const roundTrip = (src, links) => InlineRuns.serialize(runsOf(src, links));
const visible = (runs) => runs.map((r) => r.text).join("");
const render = (src) => app.parseInline(src);

/** apply + serialize; offsets are in the visible text. */
function applied(src, start, end, op, links) {
  const result = InlineRuns.apply(runsOf(src, links), start, end, op);
  return result && InlineRuns.serialize(result.runs);
}

const NONE = Object.freeze({ color: null, link: null, del: false, strong: false, em: false });
/** Runs with no source (as the cell editor makes them, unit E). */
const plain = (s, marks = NONE) => Array.from(s).map((ch) => ({ type: "text", text: ch, src: null, marks: { ...marks } }));

describe("AT-IR fromTokens and serialize keep the source", () => {
  it.each([
    "a **b** c",
    "~~**x**~~",
    `<span style="color: ${BLUE}">**AA**</span>bb`,
    '[**a**](u "t")',
    "`x` and ``a`b``",
    "a\\*b \\| c &amp; d",
    "x <b>t</b> y",
    "x ![i](p.png) y",
    "math $x^2$ here",
    "<http://x.y> and https://z.w and <a@b.c>",
    "abc  \ndef\\\nghi",
    "a\nb",
    "\u65e5\u672c\u8a9e\u300c**\u592a\u5b57**\u300d\u3067\u3059",
    "e\u0301 \ud83d\udc68\u200d\ud83d\udc69 \u00a0x\u200b",
  ])("AT-IR-01 %j", (src) => {
    expect(roundTrip(src)).toBe(src);
  });

  it("AT-IR-02 reference links: full, collapsed and shortcut forms are kept", () => {
    const links = { foo: { href: "u", title: null }, r: { href: "v", title: null } };
    expect(roundTrip("[a][r] [foo][] [foo]", links)).toBe("[a][r] [foo][] [foo]");
  });

  it("AT-IR-03 the normal form (OS-13): __x__ -> **x**, _x_ -> *x*, ~x~ -> ~~x~~", () => {
    expect(roundTrip("__x__ _y_ ~z~")).toBe("**x** *y* ~~z~~");
  });

  it("AT-IR-04 one run per character; an escape keeps its backslash as its source", () => {
    const runs = runsOf("a\\*b");
    expect(runs.map((r) => [r.type, r.text, r.src])).toEqual([
      ["text", "a", "a"],
      ["text", "*", "\\*"],
      ["text", "b", "b"],
    ]);
  });

  it("AT-IR-05 source offsets of each run", () => {
    const runs = runsOf("a **b** `c`");
    expect(runs.map((r) => [r.text, r.srcFrom, r.srcTo])).toEqual([
      ["a", 0, 1],
      [" ", 1, 2],
      ["b", 4, 5],
      [" ", 7, 8],
      ["c", 8, 11],
    ]);
  });

  it("AT-IR-06 a color span with a palette value becomes the color of its runs; other spans are kept as written", () => {
    const runs = runsOf(`<span style="color: ${BLUE}">x</span> <span style="color: #123456">y</span>`);
    expect(runs[0]).toMatchObject({ type: "text", text: "x" });
    expect(runs[0].marks.color).toBe(BLUE);
    expect(runs.slice(1).map((r) => r.type)).toEqual(["text", "atom", "text", "atom"]);
    expect(runs[3].marks.color).toBe(null);
  });

  it("AT-IR-07 a span inside a color span is kept; an unpaired closing tag is kept", () => {
    const src = `<span style="color: ${RED}">a<span class="k">b</span></span></span>`;
    const runs = runsOf(src);
    expect(runs.filter((r) => r.type === "text").every((r) => r.marks.color === RED)).toBe(true);
    expect(InlineRuns.serialize(runs)).toBe(src);
  });
});

describe("AT-IR apply: Bold / Italic (INV-67 (2)(3)(4))", () => {
  it("AT-IR-08 wraps the selection; a second time removes it", () => {
    const runs = runsOf("Hello word here.");
    const once = InlineRuns.apply(runs, 6, 10, { kind: "strong" });
    expect(InlineRuns.serialize(once.runs)).toBe("Hello **word** here.");
    expect([once.start, once.end]).toEqual([6, 10]);
    const twice = InlineRuns.apply(once.runs, 6, 10, { kind: "strong" });
    expect(InlineRuns.serialize(twice.runs)).toBe("Hello word here.");
  });

  it("AT-IR-09 does not change its input (pure)", () => {
    const runs = runsOf("Hello word");
    const before = JSON.stringify(runs);
    InlineRuns.apply(runs, 0, 5, { kind: "em" });
    expect(JSON.stringify(runs)).toBe(before);
  });

  it("AT-IR-10 removes only where all selected characters have it; else adds to the whole range", () => {
    expect(applied("**abc**", 1, 2, { kind: "strong" })).toBe("**a**b**c**");
    expect(applied("a**b**c", 0, 3, { kind: "strong" })).toBe("**abc**");
  });

  it("AT-IR-11 spaces at the ends go outside the markers", () => {
    expect(applied("a word b", 1, 7, { kind: "strong" })).toBe("a **word** b");
    expect(applied("*a b*", 0, 3, { kind: "em" })).toBe("a b");
  });

  it("AT-IR-12 neighbouring runs of the same format merge", () => {
    expect(applied("**bb**cc", 2, 4, { kind: "strong" })).toBe("**bbcc**");
  });

  it("AT-IR-13 a selection of spaces only changes nothing", () => {
    expect(InlineRuns.apply(runsOf("a  b"), 1, 3, { kind: "strong" })).toBe(null);
  });

  it("AT-IR-14 a line break inside the range stays inside", () => {
    expect(applied("a  \nb", 0, 2, { kind: "strong" })).toBe("**a  \nb**");
  });
});

describe("AT-IR apply: the range (INV-67 (6))", () => {
  it("AT-IR-15 a selection end inside a code span takes the whole code span", () => {
    const runs = runsOf("x `code` y");
    const result = InlineRuns.apply(runs, 3, 4, { kind: "strong" });
    expect(InlineRuns.serialize(result.runs)).toBe("x **`code`** y");
    expect([result.start, result.end]).toEqual([2, 6]);
  });

  it("AT-IR-16 a selection end inside a link takes the whole link", () => {
    expect(applied("x [link](u) y", 3, 5, { kind: "strong" })).toBe("x [**link**](u) y");
  });
});

describe("AT-IR apply: punctuation at the ends (INV-67 (5), ruling E1)", () => {
  it("AT-IR-17 drops the brackets that would stop the markers from working", () => {
    expect(applied("\u65e5\u672c\u8a9e\u300c\u592a\u5b57\u300d\u3067\u3059", 3, 7, { kind: "strong" })).toBe(
      "\u65e5\u672c\u8a9e\u300c**\u592a\u5b57**\u300d\u3067\u3059",
    );
  });

  it("AT-IR-18 keeps punctuation where the markers work with it", () => {
    expect(applied("100% \u3067\u3059", 0, 4, { kind: "strong" })).toBe("**100%** \u3067\u3059");
    expect(applied("say \u300c\u592a\u5b57\u300d.", 4, 8, { kind: "em" })).toBe("say *\u300c\u592a\u5b57\u300d*.");
  });

  it("AT-IR-19 a range of punctuation only gets no format", () => {
    expect(applied("a\u300c\u300db", 1, 3, { kind: "strong" })).toBe("a\u300c\u300db");
  });

  it("AT-IR-20 uses the characters around the runs (context) when the runs are a part of a text", () => {
    const runs = runsOf("\u300c\u592a\u5b57\u300d");
    const inWord = InlineRuns.apply(runs, 0, 4, { kind: "strong" }, { before: "\u8a9e", after: "\u3067" });
    expect(InlineRuns.serialize(inWord.runs)).toBe("\u300c**\u592a\u5b57**\u300d");
    const alone = InlineRuns.apply(runs, 0, 4, { kind: "strong" }, { before: " ", after: " " });
    expect(InlineRuns.serialize(alone.runs)).toBe("**\u300c\u592a\u5b57\u300d**");
  });
});

describe("AT-IR apply: text color (INV-66)", () => {
  it("AT-IR-21 the owner's example: red, then blue in the middle (3 spans), red again (1 span), then no color", () => {
    const span = (c, t) => `<span style="color: ${c}">${t}</span>`;
    let runs = runsOf("bbbbaaaabbbb");
    runs = InlineRuns.apply(runs, 0, 12, { kind: "color", value: RED }).runs;
    expect(InlineRuns.serialize(runs)).toBe(span(RED, "bbbbaaaabbbb"));
    runs = InlineRuns.apply(runs, 4, 8, { kind: "color", value: BLUE }).runs;
    expect(InlineRuns.serialize(runs)).toBe(span(RED, "bbbb") + span(BLUE, "aaaa") + span(RED, "bbbb"));
    runs = InlineRuns.apply(runs, 4, 8, { kind: "color", value: RED }).runs;
    expect(InlineRuns.serialize(runs)).toBe(span(RED, "bbbbaaaabbbb"));
    runs = InlineRuns.apply(runs, 0, 12, { kind: "color", value: null }).runs;
    expect(InlineRuns.serialize(runs)).toBe("bbbbaaaabbbb");
  });

  it("AT-IR-22 a color read from the source keeps the case it was written in", () => {
    const src = '<span style="color: #0072b2">x</span>';
    expect(roundTrip(src)).toBe(src);
  });
});

describe("AT-IR the normal form (INV-67 (1), (8)): every example of 5.14.14, rendered by marked", () => {
  const span = (t) => `<span style="color: ${BLUE}">${t}</span>`;
  it.each([
    ["bold in bold-italic text", "**a b c**", 2, 3, { kind: "em" }, "**a *b* c**", "<strong>a <em>b</em> c</strong>"],
    ["bold and italic", "*x*", 0, 1, { kind: "strong" }, "***x***", "<em><strong>x</strong></em>"],
    ["bold in strikethrough", "~~x~~", 0, 1, { kind: "strong" }, "~~**x**~~", "<del><strong>x</strong></del>"],
    ["bold in a color", `${span("AA")}bb`, 0, 2, { kind: "strong" }, `${span("**AA**")}bb`, `${span("<strong>AA</strong>")}bb`],
    [
      "a color across the end of a bold",
      "**bbAA**cc",
      2,
      6,
      { kind: "color", value: BLUE },
      `**bb**${span("**AA**cc")}`,
      `<strong>bb</strong>${span("<strong>AA</strong>cc")}`,
    ],
    ["bold in a link", "[a](u)", 0, 1, { kind: "strong" }, "[**a**](u)", '<a href="u"><strong>a</strong></a>'],
    ["a link in a color", "[a](u)", 0, 1, { kind: "color", value: BLUE }, span("[a](u)"), span('<a href="u">a</a>')],
    [
      "punctuation (E1)",
      "\u65e5\u672c\u8a9e\u300c\u592a\u5b57\u300d\u3067\u3059",
      3,
      7,
      { kind: "strong" },
      "\u65e5\u672c\u8a9e\u300c**\u592a\u5b57**\u300d\u3067\u3059",
      "\u65e5\u672c\u8a9e\u300c<strong>\u592a\u5b57</strong>\u300d\u3067\u3059",
    ],
    ["bold code", "`x`", 0, 1, { kind: "strong" }, "**`x`**", "<strong><code>x</code></strong>"],
  ])("AT-IR-23 %s", (_name, src, start, end, op, markdown, html) => {
    const out = applied(src, start, end, op);
    expect(out).toBe(markdown);
    expect(render(out)).toBe(html);
  });

  it("AT-IR-24 italic followed by bold: the markers meet and still work", () => {
    const out = applied("*x*a", 1, 2, { kind: "strong" });
    expect(out).toBe("*x***a**");
    expect(render(out)).toBe("<em>x</em><strong>a</strong>");
  });
});

describe("AT-IR serialize without source (INV-72 (d), the cell editor)", () => {
  it("AT-IR-25 escapes the characters that would be syntax; _ inside a word stays", () => {
    const text = "*x* _y_ snake_case [z] <w> ~ $ & \\ ` | done";
    const out = InlineRuns.serialize(plain(text));
    expect(out).toBe("\\*x\\* \\_y\\_ snake_case \\[z\\] \\<w> \\~ \\$ \\& \\\\ \\` \\| done");
    expect(visible(runsOf(out))).toBe(text);
    expect(lexInline(out).some((t) => t.type === "inlineKatex")).toBe(false);
  });

  it("AT-IR-26 code spans: a fence longer than the backticks inside, padded when needed", () => {
    const code = (text) => [{ type: "code", text, src: null, marks: { ...NONE } }];
    expect(InlineRuns.serialize(code("x"))).toBe("`x`");
    expect(InlineRuns.serialize(code("a`b"))).toBe("``a`b``");
    expect(InlineRuns.serialize(code("`x"))).toBe("`` `x ``");
    expect(InlineRuns.serialize(code(" a "))).toBe("`  a  `");
  });

  it("AT-IR-27 in a table cell: | is \\| also inside code, and a line break is <br>", () => {
    const runs = [
      ...plain("a|b"),
      { type: "code", text: "c|d", src: null, marks: { ...NONE } },
      { type: "br", text: "", src: null, marks: { ...NONE } },
      ...plain("e"),
    ];
    expect(InlineRuns.serialize(runs, { inTableCell: true })).toBe("a\\|b`c\\|d`<br>e");
  });
});

describe("AT-IR link notation (INV-72 (a))", () => {
  const links = { foo: { href: "u", title: null }, r: { href: "v", title: null } };

  /** Replace the visible text of the first link with text, keeping its marks. */
  function relabel(runs, text) {
    const first = runs.findIndex((r) => r.marks.link);
    let last = first;
    while (last + 1 < runs.length && runs[last + 1].marks.link === runs[first].marks.link) last++;
    const marks = runs[first].marks;
    const replaced = Array.from(text).map((ch) => ({ type: "text", text: ch, src: null, marks: { ...marks } }));
    return [...runs.slice(0, first), ...replaced, ...runs.slice(last + 1)];
  }

  it.each([
    ["shortcut", "[foo]", "[bar][foo]"],
    ["collapsed", "[foo][]", "[bar][foo]"],
    ["full reference", "[foo][r]", "[bar][r]"],
    ["inline with a title", '[foo](u "t")', '[bar](u "t")'],
    ["autolink", "<http://x.y>", "[bar](http://x.y)"],
    ["bare URL", "https://z.w", "[bar](https://z.w)"],
  ])("AT-IR-28 %s: unchanged text keeps the form; changed text -> %s", (_name, src, changed) => {
    expect(roundTrip(src, links)).toBe(src);
    expect(InlineRuns.serialize(relabel(runsOf(src, links), "bar"))).toBe(changed);
  });

  it("AT-IR-29 an autolink or bare URL whose new text is a URL keeps its form (isLinkableUrl)", () => {
    const options = { isLinkableUrl: (t) => t.startsWith("http") };
    expect(InlineRuns.serialize(relabel(runsOf("<http://x.y>"), "http://n.z"), options)).toBe("<http://n.z>");
    expect(InlineRuns.serialize(relabel(runsOf("https://z.w"), "https://n.z"), options)).toBe("https://n.z");
  });

  it("AT-IR-30 a format inside a shortcut reference keeps the label", () => {
    expect(applied("see [foo] now", 4, 7, { kind: "strong" }, links)).toBe("see [**foo**][foo] now");
  });

  it("AT-IR-31 a bold bare URL becomes an inline link with the bold inside", () => {
    const out = applied("see https://z.w now", 4, 15, { kind: "strong" });
    expect(out).toBe("see [**https://z.w**](https://z.w) now");
    expect(render(out)).toBe('see <a href="https://z.w"><strong>https://z.w</strong></a> now');
  });
});

describe("AT-IR signature (used to check a rewrite against marked)", () => {
  it("AT-IR-32 equal for the same format written differently; different when a format differs", () => {
    expect(InlineRuns.signature(runsOf("__a__ b"))).toEqual(InlineRuns.signature(runsOf("**a** b")));
    expect(InlineRuns.signature(runsOf("**a** b"))).not.toEqual(InlineRuns.signature(runsOf("*a* b")));
    expect(InlineRuns.signature(runsOf("[a](u) [b](u)"))).not.toEqual(InlineRuns.signature(runsOf("[a b](u)")));
  });

  it("AT-IR-33 unitRangeOfSource maps a source selection to the runs it touches (indices, end exclusive)", () => {
    const runs = runsOf("a **bc** d");
    expect(InlineRuns.unitRangeOfSource(runs, 2, 8)).toEqual({ from: 2, to: 4 });
    expect(InlineRuns.unitRangeOfSource(runs, 5, 6)).toEqual({ from: 3, to: 4 });
    expect(InlineRuns.unitRangeOfSource(runs, 2, 4)).toEqual(null);
  });

  it("AT-IR-34 applyUnits takes run indices (the source editor's path)", () => {
    const runs = runsOf("a **bc** d");
    const result = InlineRuns.applyUnits(runs, 0, 1, { kind: "strong" });
    expect(InlineRuns.serialize(result.runs)).toBe("**a** **bc** d");
    expect([result.from, result.to]).toEqual([0, 1]);
  });
});

describe("AT-IR entities and HTML elements", () => {
  it("AT-IR-35 an entity reference is one run, written as it was", () => {
    const runs = runsOf("a &amp; &#x41; b");
    expect(runs.map((r) => r.text)).toEqual(["a", " ", "&amp;", " ", "&#x41;", " ", "b"]);
    expect(InlineRuns.serialize(runs)).toBe("a &amp; &#x41; b");
  });

  it("AT-IR-36 expandRange takes a link whole and both tags of an element; void elements stand alone", () => {
    const runs = runsOf("a <b>x</b> [li](u) <br> c");
    const at = (text) => runs.findIndex((r) => r.text === text);
    expect(InlineRuns.expandRange(runs, at("x"), at("</b>") + 2)).toEqual({ from: at("<b>"), to: at("</b>") + 2 });
    expect(InlineRuns.expandRange(runs, at("i"), at("i") + 1)).toEqual({ from: at("l"), to: at("i") + 1 });
    expect(InlineRuns.expandRange(runs, at("<br>"), at("<br>") + 1)).toEqual({ from: at("<br>"), to: at("<br>") + 1 });
  });

  it("AT-IR-37 an unclosed tag inside an element does not stop the pairing", () => {
    const runs = runsOf("<i>a<b>b</i> c");
    const at = (text) => runs.findIndex((r) => r.text === text);
    expect(InlineRuns.expandRange(runs, at("</i>"), at("</i>") + 1)).toEqual({ from: at("<i>"), to: at("</i>") + 1 });
  });
});
