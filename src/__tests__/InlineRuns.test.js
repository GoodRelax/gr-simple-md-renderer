import { describe, it, expect } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import InlineRuns from "../js/classes/InlineRuns.js";

// INV-66 / 67 / 72, spec 5.14.14: the inline format as a list of runs
// (one per character, code span, line break or kept-as-written piece),
// split and merged per format; written back in the normal form.

const app = new Marked();
app.use(markedKatex({ throwOnError: false }));
const RED = "#CF222E";
const BLUE = "#0550AE";
const COLORS = [RED, BLUE, "#1A7F37"];

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
    const src = '<span style="color: #0550ae">x</span>';
    expect(roundTrip(src)).toBe(src);
  });

  it.each(["#B84F00", "#0072B2", "#007A58"])("AT-IR-23 the former palette color %s is a verbatim piece, not a color (B3)", (old) => {
    const src = `<span style="color: ${old}">x</span>`;
    const runs = runsOf(src);
    expect(runs.some((r) => r.marks.color !== null)).toBe(false);
    expect(roundTrip(src)).toBe(src);
    // the palette's color goes around the piece; the old color stays as written
    const colored = InlineRuns.serialize(InlineRuns.apply(runs, 0, runs.length, { kind: "color", value: RED }).runs);
    expect(colored).toContain(src);
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

describe("AT-IR fromNodes: a cell's DOM copy to runs (INV-63, unit E)", () => {
  const text = (t) => ({ kind: "text", text: t });

  it("the allowed formats nest; a code span is one run; a line break is a run", () => {
    const runs = InlineRuns.fromNodes([
      { kind: "strong", children: [text("a"), { kind: "em", children: [text("b")] }] },
      { kind: "br" },
      { kind: "code", children: [text("x|y")] },
      { kind: "del", children: [text("d")] },
    ]);
    expect(runs.map((r) => r.type)).toEqual(["text", "text", "br", "code", "text"]);
    expect(InlineRuns.serialize(runs, { inTableCell: true })).toBe("**a*b***<br>`x\\|y`~~d~~");
  });

  it("other elements give their text only; a mark node is its text; attributes are not read", () => {
    const runs = InlineRuns.fromNodes([
      { kind: "other", children: [{ kind: "strong", children: [text("in")] }] },
      { kind: "mark", children: [text("\u00a0")] },
      { kind: "span", style: "color: red", children: [text("s")] },
    ], [], { colors: COLORS });
    expect(runs.every((r) => !r.marks.strong && r.marks.color === null)).toBe(true);
    expect(InlineRuns.serialize(runs)).toBe("in\u00a0s");
  });

  it("a span is a color only for a palette value written exactly; a link only by its index", () => {
    const link = { kind: "inline", href: "u", title: null, innerSrc: "l", dest: "(u)" };
    const runs = InlineRuns.fromNodes([
      { kind: "span", style: `color: ${BLUE}`, children: [text("c")] },
      { kind: "a", link: 0, children: [text("l")] },
      { kind: "a", link: null, children: [text("n")] },
    ], [link], { colors: COLORS });
    expect(InlineRuns.serialize(runs)).toBe(`<span style="color: ${BLUE}">c</span>[l](u)n`);
  });

  it("linksOf lists the links of tokens in order, inside formats too", () => {
    const links = InlineRuns.linksOf(lexInline("**[a](x)** and [b][r] <https://c.example/>", { r: { href: "y", title: null } }));
    expect(links.map((l) => l.kind)).toEqual(["inline", "reference", "autolink"]);
  });
});

describe("AT-IR links: put on and taken off (INV-69)", () => {
  const link = (dest) => InlineRuns.inlineLink(dest);
  const LINK = (dest, url = dest) => ({ kind: "link", link: link(dest), url });
  const UNLINK = { kind: "unlink" };
  /** apply + serialize, and marked reads the result as meant (INV-67 (8)). */
  function checked(src, start, end, op, links, options = {}) {
    const result = InlineRuns.apply(runsOf(src, links), start, end, op, options);
    if (!result) return null;
    const text = InlineRuns.serialize(result.runs, options);
    const back = InlineRuns.fromTokens(lexInline(text, links), { colors: COLORS });
    expect(JSON.stringify(InlineRuns.signature(back))).toBe(JSON.stringify(InlineRuns.signature(result.runs)));
    return text;
  }

  it("AT-IR-38 inlineLink: an inline link whose href is what marked reads from the destination", () => {
    expect(link("https://a.example/x")).toMatchObject({ kind: "inline", href: "https://a.example/x", title: null, dest: "(https://a.example/x)" });
    expect(link("<https://a.example/a%20b>")).toMatchObject({ href: "https://a.example/a%20b", dest: "(<https://a.example/a%20b>)" });
  });

  it("AT-IR-39 the selected text becomes a link; other formats stay, the link goes outside emphasis", () => {
    expect(checked("see this page", 4, 8, LINK("https://a.example/"))).toBe("see [this](https://a.example/) page");
    expect(checked("a **bold** b", 2, 6, LINK("https://a.example/"))).toBe("a [**bold**](https://a.example/) b");
    expect(checked(`<span style="color: ${RED}">red</span>`, 0, 3, LINK("u"))).toBe(`<span style="color: ${RED}">[red](u)</span>`);
    expect(checked("x <https://a.example/> y", 2, 5, LINK("<https://b.example/a%20b>", "https://b.example/a b"))).not.toBeNull();
  });

  it("AT-IR-40 in a link: the whole link takes the new URL; a reference link becomes an inline link (its definition stays)", () => {
    expect(checked("a [text](old) b", 3, 4, LINK("new"))).toBe("a [text](new) b");
    const links = { r: { href: "old", title: null } };
    expect(checked("a [text][r] b", 2, 6, LINK("new"), links)).toBe("a [text](new) b");
  });

  it("AT-IR-41 a bare URL or <URL>: its text and URL become the new URL", () => {
    expect(checked("see https://old.example/ now", 6, 10, LINK("https://new.example/"))).toBe("see [https://new.example/](https://new.example/) now");
    expect(checked("see <https://old.example/> now", 4, 8, LINK("https://new.example/"))).toBe("see [https://new.example/](https://new.example/) now");
  });

  it("AT-IR-42 in a table cell the pipes of the URL are written \\| (INV-69)", () => {
    const options = { inTableCell: true };
    const result = InlineRuns.apply(plain("cell"), 0, 4, LINK("https://a.example/p|q"), options);
    expect(InlineRuns.serialize(result.runs, options)).toBe("[cell](https://a.example/p\\|q)");
    const bare = InlineRuns.apply(runsOf("https://old.example/"), 0, 3, LINK("https://a.example/p|q"), options);
    expect(InlineRuns.serialize(bare.runs, options)).toBe("[https://a.example/p\\|q](https://a.example/p\\|q)");
  });

  it("AT-IR-43 strictEnds (Ctrl+V): an end inside a code span is not linked; ends at its edges are", () => {
    const runs = runsOf("a `code` b");
    expect(InlineRuns.apply(runs, 2, 4, { ...LINK("u"), strictEnds: true })).toBeNull();
    expect(InlineRuns.apply(runs, 0, 4, { ...LINK("u"), strictEnds: true })).toBeNull();
    expect(InlineRuns.serialize(InlineRuns.apply(runs, 2, 6, { ...LINK("u"), strictEnds: true }).runs)).toBe("a [`code`](u) b");
    // without strictEnds (the button) a code span is taken whole (INV-67 (6))
    expect(InlineRuns.serialize(InlineRuns.apply(runs, 3, 4, LINK("u")).runs)).toBe("a [`code`](u) b");
  });

  it("AT-IR-44 taking a link off keeps its text and the other formats", () => {
    expect(checked("a [**text**](u) b", 3, 4, UNLINK)).toBe("a **text** b");
    expect(checked("a [x](u) and [y](v) b", 0, 5, UNLINK)).toBe("a x and [y](v) b");
    expect(checked("a [x](u) and [y](v) b", 0, 11, UNLINK)).toBe("a x and y b");
    expect(checked("plain", 1, 3, UNLINK)).toBeNull();
  });

  it("AT-IR-45 a bare URL or <URL> taken off does not become a link again: \\: (www.: \\., an address: \\@)", () => {
    expect(checked("see https://a.example/x now", 6, 8, UNLINK)).toBe("see https\\://a.example/x now");
    expect(checked("see <https://a.example/x> now", 6, 8, UNLINK)).toBe("see https\\://a.example/x now");
    expect(checked("see www.a.example now", 5, 6, UNLINK)).toBe("see www\\.a.example now");
    expect(checked("see a@b.example now", 4, 5, UNLINK)).toBe("see a\\@b.example now");
    expect(checked("<mailto:a@b.example>", 2, 3, UNLINK)).toBe("mailto\\:a\\@b.example");
    // a link whose text looks like a URL is not made an autolink either
    expect(checked("[http://www.a.example](u)", 2, 3, UNLINK)).toBe("http\\://www\\.a.example");
    for (const src of ["see https\\://a.example/x now", "www\\.a.example", "a\\@b.example", "http\\://www\\.a.example"]) {
      expect(render(src), src).not.toContain("<a ");
    }
  });

  it("AT-IR-46 a caret (no selection): the link the caret is on comes off, its edges included", () => {
    expect(checked("a [text](u) b", 4, 4, UNLINK)).toBe("a text b");
    expect(checked("a [text](u) b", 2, 2, UNLINK)).toBe("a text b");
    expect(checked("a [text](u) b", 6, 6, UNLINK)).toBe("a text b");
    expect(checked("a [text](u) b", 1, 1, UNLINK)).toBeNull();
    expect(InlineRuns.hasLinkAt(runsOf("a [text](u) b"), 4, 4)).toBe(true);
    expect(InlineRuns.hasLinkAt(runsOf("a [text](u) b"), 6, 6)).toBe(true);
    expect(InlineRuns.hasLinkAt(runsOf("a [text](u) b"), 7, 7)).toBe(false);
    expect(InlineRuns.hasLinkAt(runsOf("a [text](u) b"), 0, 3)).toBe(true);
    expect(InlineRuns.hasLinkAt(runsOf("a [text](u) b"), 0, 2)).toBe(false);
  });

  it("AT-IR-47 insertLinkAt: no selection, the link goes in at the caret with its text selected (ruling V2)", () => {
    const result = InlineRuns.insertLinkAt(plain("ab"), 1, "Example *x*", link("https://a.example/"));
    expect(InlineRuns.serialize(result.runs)).toBe("a[Example \\*x\\*](https://a.example/)b");
    expect(visible(result.runs).slice(result.start, result.end)).toBe("Example *x*");
    const bold = InlineRuns.insertLinkAt(runsOf("**ab**"), 1, "L", link("u"));
    expect(InlineRuns.serialize(bold.runs)).toBe("**a**[**L**](u)**b**");
    const empty = InlineRuns.insertLinkAt([], 0, "https://a.example/", link("https://a.example/"));
    expect(InlineRuns.serialize(empty.runs)).toBe("[https://a.example/](https://a.example/)");
    expect([empty.start, empty.end]).toEqual([0, 18]);
  });

  it("AT-IR-48 literalUrls: a URL text taken off a link in a cell stays text when written again from the DOM", () => {
    const runs = plain("see https://a.example/x and https://b.example/");
    expect(InlineRuns.serialize(runs, { literalUrls: ["https://a.example/x"] })).toBe("see https\\://a.example/x and https://b.example/");
    expect(InlineRuns.serialize(runs)).toBe("see https://a.example/x and https://b.example/");
    // inside a link the text is the link's own
    const linked = InlineRuns.apply(runs, 0, 3, LINK("u")).runs;
    expect(InlineRuns.serialize(linked, { literalUrls: ["see"] })).toBe("[see](u) https://a.example/x and https://b.example/");
  });

  it("AT-IR-49 runIndexAt / canInsertLinkAt / insertLinkAt (owner ruling F-R1)", () => {
    const br = { type: "br", text: "", src: null, marks: { ...NONE } };
    const runs = [...plain("ab"), br, ...plain("cd")];
    expect(InlineRuns.runIndexAt(runs, 2, 1)).toBe(2); // before the break
    expect(InlineRuns.runIndexAt(runs, 3, 1)).toBe(3); // after it: the second line's start
    expect(InlineRuns.runIndexAt(runs, 2, 0)).toBe(2);
    expect(InlineRuns.runIndexAt(runsOf("a `code` b"), 4)).toBe(-1); // inside a code span
    const linkedRuns = InlineRuns.apply(plain("abcd"), 1, 3, LINK("u")).runs;
    expect(InlineRuns.canInsertLinkAt(linkedRuns, 2)).toBe(false); // inside the link
    expect(InlineRuns.canInsertLinkAt(linkedRuns, 1)).toBe(true); // at its edges
    expect(InlineRuns.canInsertLinkAt(linkedRuns, 3)).toBe(true);
    expect(InlineRuns.canInsertLinkAt(linkedRuns, -1)).toBe(false);
    expect(InlineRuns.insertLinkAt(linkedRuns, 2, "L", link("v"))).toBeNull();
    expect(InlineRuns.insertLinkAt(plain("ab"), 1, "", link("v"))).toBeNull();
    const after = InlineRuns.insertLinkAt(runs, 3, "L", link("v"));
    expect(InlineRuns.serialize(after.runs, { inTableCell: true })).toBe("ab<br>[L](v)cd");
    expect(InlineRuns.serialize(InlineRuns.insertLinkAt(plain("Hi!"), 3, "L", link("v")).runs)).toBe("Hi\\![L](v)");
  });

  it("AT-IR-50 a link whose text has \\[ \\] is read as a link (marked lexes its text with them as brackets)", () => {
    const runs = runsOf("a [x \\[1\\]](u) b");
    expect(runs.some((r) => r.type === "atom")).toBe(false);
    expect(visible(runs)).toBe("a x [1] b");
    expect(InlineRuns.serialize(runs)).toBe("a [x \\[1\\]](u) b");
    const bracket = runs.find((r) => r.text === "[");
    expect([bracket.srcFrom, bracket.srcTo, bracket.src]).toEqual([5, 7, "\\["]); // its source: \[
    // a code span in such a text, holding a backslash marked took off, is kept whole
    expect(runsOf("[`a\\[b`](u)").some((r) => r.type === "atom")).toBe(true);
  });

  it("AT-IR-51 the dot of every www. is escaped when a link comes off (also after a letter)", () => {
    expect(checked("[xwww.a.example](u)", 1, 2, UNLINK)).toBe("xwww\\.a.example");
    expect(render("xwww\\.a.example")).not.toContain("<a ");
  });

  it("AT-IR-52 a raw bracket put inside a new link is escaped", () => {
    expect(checked("a b]c d", 2, 5, LINK("u"))).toBe("a [b\\]c](u) d");
  });

  it("AT-IR-53 runs without source (a cell written from its DOM): a \"!\" right before a link is \\! (no image)", () => {
    const runs = InlineRuns.apply(plain("Hi!ab"), 3, 5, LINK("u")).runs;
    expect(InlineRuns.serialize(runs)).toBe("Hi\\![ab](u)");
    expect(render(InlineRuns.serialize(runs))).not.toContain("<img");
    expect(InlineRuns.serialize(plain("Hi!ab"))).toBe("Hi!ab");
  });
});
