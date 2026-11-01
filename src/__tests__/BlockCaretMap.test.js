import { describe, it, expect, vi, afterEach } from "vitest";
import BlockCaretMap from "../js/classes/BlockCaretMap.js";
import * as M from "../js/caretMatching.js";

// INV-84: a place in a rendered block, matched to the block's source
// (caretMatching.js, pure), and read from the DOM (BlockCaretMap).

afterEach(() => vi.restoreAllMocks());

/** The source offset for the caret right before the first `at` in rendered. */
function offsetBefore(source, rendered, type, at) {
  const before = rendered.slice(0, rendered.indexOf(at));
  const count = before.replace(/\s/g, "").length;
  const afterSpace = before.length === 0 || /\s$/.test(before);
  return M.sourceOffsetFor(source, rendered, type, count, afterSpace);
}

describe("AT-BCM-01 sourceOffsetFor: the caret lands at the same text in the source", () => {
  it.each([
    ["a paragraph", "Hello brave new world.", "Hello brave new world.", "paragraph", "new", "Hello brave ".length],
    ["after emphasis", "Some **bold** text here.", "Some bold text here.", "paragraph", "text", "Some **bold** ".length],
    ["inside emphasis", "Some **bold** text.", "Some bold text.", "paragraph", "ld", "Some **bo".length],
    ["after a link", "See [docs](https://example.com/a/b/c?x=1) and more.", "See docs and more.", "paragraph", "more", "See [docs](https://example.com/a/b/c?x=1) and ".length],
    ["after a link with a title", 'A [b](u "t") c.', "A b c.", "paragraph", "c.", 'A [b](u "t") '.length],
    ["a heading", "## Section two", "Section two", "heading", "two", "## Section ".length],
    ["a list", "- one\n- two words\n- three", "one\ntwo words\nthree", "list", "words", "- one\n- two ".length],
    ["an ordered list with numbers in it", "1. 10 apples\n2. 20 pears", "10 apples\n20 pears", "list", "20", "1. 10 apples\n2. ".length],
    ["a quote", "> quoted line\n> next one", "quoted line\nnext one", "blockquote", "next", "> quoted line\n> ".length],
    ["a code block", "```js\nconst js = 1;\nlet b = 2;\n```", "const js = 1;\nlet b = 2;\n", "code", "b =", "```js\nconst js = 1;\nlet ".length],
    ["an HTML tag", "a <span class=x>bc</span> d", "a bc d", "html", "d", "a <span class=x>bc</span> ".length],
  ])("%s", (_name, source, rendered, type, at, expected) => {
    expect(offsetBefore(source, rendered, type, at)).toBe(expected);
  });

  it("the start of the text (after the prefix) for a caret before everything", () => {
    expect(M.sourceOffsetFor("## Title", "Title", "heading", 0, true)).toBe(3);
    expect(M.sourceOffsetFor("```\ncode\n```", "code\n", "code", 0, true)).toBe(4);
  });

  it("the end of the text for a caret after everything", () => {
    expect(M.sourceOffsetFor("Hello **you**", "Hello you", "paragraph", 8, false)).toBe("Hello **you".length);
  });

  it("a rendered character with no match (an entity) is passed over", () => {
    const matches = M.align("a &copy; b", "a \u00a9 b", "paragraph");
    expect(matches).toEqual([0, -1, 9]);
    expect(offsetBefore("a &copy; b", "a \u00a9 b", "paragraph", "b")).toBe(9);
  });
});

describe("AT-BCM-02 renderedPlaceFor: the inverse of sourceOffsetFor", () => {
  it.each([
    ["Hello brave new world.", "Hello brave new world.", "paragraph"],
    ["Some **bold** text here.", "Some bold text here.", "paragraph"],
    ["See [docs](https://example.com/a) and more.", "See docs and more.", "paragraph"],
    ["- one\n- two words", "one\ntwo words", "list"],
    ["```\nx = 1\ny = 2\n```", "x = 1\ny = 2\n", "code"],
  ])("%j: every caret in the rendered text comes back to the same place", (source, rendered, type) => {
    let count = 0;
    for (let i = 0; i <= rendered.length; i++) {
      const before = rendered.slice(0, i);
      count = before.replace(/\s/g, "").length;
      const afterSpace = before.length === 0 || /\s$/.test(before);
      const offset = M.sourceOffsetFor(source, rendered, type, count, afterSpace);
      const place = M.renderedPlaceFor(source, rendered, type, offset);
      expect(place.count, `caret at ${i}`).toBe(count);
    }
  });

  it("an offset inside markup counts the text before it", () => {
    // "Some **|bold**": after "Some", before "bold"
    expect(M.renderedPlaceFor("Some **bold**", "Some bold", "paragraph", 6)).toEqual({ count: 4, afterSpace: true });
    expect(M.renderedPlaceFor("Some **bold**", "Some bold", "paragraph", 4)).toEqual({ count: 4, afterSpace: false });
  });
});

describe("AT-BCM-03 lineAnchor falls back to the block's top", () => {
  const element = document.createElement("div");

  it("no line: the anchor as it was", () => {
    const anchor = { offsetTop: 40 };
    expect(BlockCaretMap.lineAnchor(anchor, element, { count: 0, afterSpace: true })).toBe(anchor);
    expect(BlockCaretMap.lineAnchor(null, element, null)).toBe(null);
  });

  it("a caret past the block's source (a commit that split the block), or no layout: the block's top", () => {
    const line = { offset: 30, sourceOffset: 99 };
    expect(BlockCaretMap.placeOfLine(line, element, "short", "paragraph")).toBe(null);
    expect(BlockCaretMap.lineAnchor({ offsetTop: 40, line }, element, null)).toEqual({ offsetTop: 40 });
    element.textContent = "some text";
    const near = { offset: 30, sourceOffset: 4 };
    const place = BlockCaretMap.placeOfLine(near, element, "some text", "paragraph");
    expect(place).toEqual({ count: 4, afterSpace: false });
    expect(BlockCaretMap.lineAnchor({ offsetTop: 40, line: near }, element, place)).toEqual({ offsetTop: 40 });
  });

  it("neither writes to what it is given (the caller keeps what was found)", () => {
    element.textContent = "some text";
    const line = Object.freeze({ offset: 30, sourceOffset: 4 });
    const anchor = Object.freeze({ offsetTop: 40, line });
    const place = BlockCaretMap.placeOfLine(line, element, "some text", "paragraph");
    expect(() => BlockCaretMap.lineAnchor(anchor, element, Object.freeze(place))).not.toThrow();
    expect(Object.keys(line)).toEqual(["offset", "sourceOffset"]);
  });
});

describe("AT-BCM-04 textOf leaves out what is not the block's own text", () => {
  it("KaTeX's MathML copy, a table's tab, buttons and drawings", () => {
    const el = document.createElement("div");
    el.innerHTML =
      '<p>a <span class="katex"><span class="katex-mathml">MATHML</span><span class="katex-html">x</span></span> b</p>' +
      '<div class="grsmd-table-tab">Markdown</div><button>Copy</button><svg><text>T</text></svg>';
    expect(BlockCaretMap.textOf(el)).toBe("a x b");
  });
});

describe("AT-BCM-05 the fast paths give the same answers", () => {
  it("isSpace is /\s/ for every UTF-16 code", () => {
    const wrong = [];
    for (let code = 0; code <= 0xffff; code++) if (M.isSpace(code) !== /\s/.test(String.fromCharCode(code))) wrong.push(code.toString(16));
    expect(wrong).toEqual([]);
  });

  it("a code block's lines keep their leading # and - (no list or heading markers in code)", () => {
    const source = "```sh\n# install\n- step\nrun it\n```";
    const rendered = "# install\n- step\nrun it\n";
    expect(offsetBefore(source, rendered, "code", "install")).toBe(source.indexOf("install"));
    expect(offsetBefore(source, rendered, "code", "step")).toBe(source.indexOf("step"));
    expect(offsetBefore(source, rendered, "code", "- step")).toBe(source.indexOf("- step"));
  });

  it("stopping early (at the caret, or at a source offset) changes nothing before the stop", () => {
    const source = "Some **bold** text and [a link](https://example.com/x) here, then more words.";
    const rendered = "Some bold text and a link here, then more words.";
    const all = M.align(source, rendered, "paragraph");
    expect(M.align(source, rendered, "paragraph", 10)).toEqual(all.slice(0, 10));
    const stop = source.indexOf("here");
    const upTo = M.align(source, rendered, "paragraph", Infinity, stop);
    expect(upTo).toEqual(all.slice(0, upTo.length));
    expect(upTo[upTo.length - 1]).toBe(stop);
  });
});

describe("AT-BCM-06 a code block shows its source as it is: the offset is found at once", () => {
  const source = "```js\nconst a = 1;\n  // two spaces\nlet b = 2;\n```";
  const rendered = "const a = 1;\n  // two spaces\nlet b = 2;\n";

  it("by the caret's index, the same as by matching", () => {
    for (let index = 0; index <= rendered.length; index++) {
      const before = rendered.slice(0, index);
      const count = before.replace(/\s/g, "").length;
      const afterSpace = index === 0 || /\s$/.test(before);
      expect(M.sourceOffsetFor(source, rendered, "code", count, afterSpace, index), `index ${index}`).toBe(6 + index);
    }
  });

  it("back: the place of each source offset in the code", () => {
    expect(M.renderedPlaceFor(source, rendered, "code", 6)).toEqual({ count: 0, afterSpace: true });
    expect(M.renderedPlaceFor(source, rendered, "code", source.indexOf("// two"))).toEqual({ count: 9, afterSpace: true });
    expect(M.renderedPlaceFor(source, rendered, "code", source.indexOf(" = 2"))).toEqual({ count: 24, afterSpace: false });
  });
});

describe("AT-BCM-07 a long wrapping text is not measured (INV-84, CONFIG.edit.caretLineMaxChars)", () => {
  it("more than maxChars before the caret: null (the block's top is kept); fewer: a number", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "word ".repeat(100);
    document.body.append(textarea);
    // jsdom lays nothing out: the text is taken as wrapping, so the copy would be measured
    expect(BlockCaretMap.caretOffsetIn(textarea, 300, 200)).toBe(null);
    expect(typeof BlockCaretMap.caretOffsetIn(textarea, 100, 200)).toBe("number");
    textarea.remove();
  });
});

describe("AT-BCM-08 caretAt: the caret at a point, for blocks and table cells alike", () => {
  it("caretPositionFromPoint first, then WebKit's caretRangeFromPoint, else null", () => {
    const node = document.createTextNode("abc");
    document.caretPositionFromPoint = vi.fn(() => ({ offsetNode: node, offset: 2 }));
    expect(BlockCaretMap.caretAt(5, 6)).toEqual({ node, offset: 2 });
    expect(document.caretPositionFromPoint).toHaveBeenCalledWith(5, 6);
    delete document.caretPositionFromPoint;
    document.caretRangeFromPoint = vi.fn(() => ({ startContainer: node, startOffset: 1 }));
    expect(BlockCaretMap.caretAt(5, 6)).toEqual({ node, offset: 1 });
    document.caretRangeFromPoint = vi.fn(() => null);
    expect(BlockCaretMap.caretAt(5, 6)).toBe(null);
    delete document.caretRangeFromPoint;
    expect(BlockCaretMap.caretAt(5, 6)).toBe(null);
  });
});

describe("AT-BCM-09 the editor measures the caret's line by the same character as the rendered block", () => {
  it("the one before the caret, else the next one, else the last one (whitespace left out)", () => {
    const v = "gamma listword\n\n  next";
    expect(BlockCaretMap._lineCharIn(v, 3)).toBe(2); // inside a word: the one before
    expect(BlockCaretMap._lineCharIn(v, 6)).toBe(6); // after a space (a wrap may be there): the next
    expect(BlockCaretMap._lineCharIn(v, 15)).toBe(18); // a blank line: the next text, as in the rendered block
    expect(BlockCaretMap._lineCharIn("end  ", 5)).toBe(2); // nothing after: the last
    expect(BlockCaretMap._lineCharIn(" \n", 1)).toBe(-1);
  });
});
