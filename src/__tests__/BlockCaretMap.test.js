import { describe, it, expect } from "vitest";
import BlockCaretMap from "../js/classes/BlockCaretMap.js";

// INV-84: a place in a rendered block, matched to the block's source.

/** The source offset for the caret right before the first `at` in rendered. */
function offsetBefore(source, rendered, type, at) {
  const before = rendered.slice(0, rendered.indexOf(at));
  const count = before.replace(/\s/g, "").length;
  const afterSpace = before.length === 0 || /\s$/.test(before);
  return BlockCaretMap.sourceOffsetFor(source, rendered, type, count, afterSpace);
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
    expect(BlockCaretMap.sourceOffsetFor("## Title", "Title", "heading", 0, true)).toBe(3);
    expect(BlockCaretMap.sourceOffsetFor("```\ncode\n```", "code\n", "code", 0, true)).toBe(4);
  });

  it("the end of the text for a caret after everything", () => {
    expect(BlockCaretMap.sourceOffsetFor("Hello **you**", "Hello you", "paragraph", 8, false)).toBe("Hello **you".length);
  });

  it("a rendered character with no match (an entity) is passed over", () => {
    const matches = BlockCaretMap.align("a &copy; b", "a \u00a9 b", "paragraph");
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
      const offset = BlockCaretMap.sourceOffsetFor(source, rendered, type, count, afterSpace);
      const place = BlockCaretMap.renderedPlaceFor(source, rendered, type, offset);
      expect(place.count, `caret at ${i}`).toBe(count);
    }
  });

  it("an offset inside markup counts the text before it", () => {
    // "Some **|bold**": after "Some", before "bold"
    expect(BlockCaretMap.renderedPlaceFor("Some **bold**", "Some bold", "paragraph", 6)).toEqual({ count: 4, afterSpace: true });
    expect(BlockCaretMap.renderedPlaceFor("Some **bold**", "Some bold", "paragraph", 4)).toEqual({ count: 4, afterSpace: false });
  });
});

describe("AT-BCM-03 lineAnchor falls back to the block's top", () => {
  const element = document.createElement("div");

  it("no line: the anchor as it was", () => {
    const anchor = { offsetTop: 40 };
    expect(BlockCaretMap.lineAnchor(anchor, element, "text", "paragraph")).toBe(anchor);
    expect(BlockCaretMap.lineAnchor(null, element, "text", "paragraph")).toBe(null);
  });

  it("a caret past the block's source (a commit that split the block), or no layout: the block's top", () => {
    const line = { offset: 30, sourceOffset: 99 };
    expect(BlockCaretMap.lineAnchor({ offsetTop: 40, line }, element, "short", "paragraph")).toEqual({ offsetTop: 40 });
    element.textContent = "some text";
    expect(BlockCaretMap.lineAnchor({ offsetTop: 40, line: { offset: 30, sourceOffset: 4 } }, element, "some text", "paragraph")).toEqual({ offsetTop: 40 });
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
