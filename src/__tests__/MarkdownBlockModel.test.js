import { describe, it, expect, vi } from "vitest";
import MarkdownBlockModel from "../js/classes/MarkdownBlockModel.js";
import { loadFixtureLf, makeLexer } from "./helpers/samples.js";

const lexer = makeLexer();
const MAX = 250000;
const model = (body, first = 1) => MarkdownBlockModel.fromBody(body, lexer, first);
const raws = (m) => m.getBlocks().map((b) => b.raw);
const types = (m) => m.getBlocks().map((b) => b.type);
const ids = (m) => m.getBlocks().map((b) => b.id);
const idOf = (m, pred) => m.getBlocks().find(pred).id;

describe("MarkdownBlockModel (Entity, pure; real marked lexer)", () => {
  it("AT-BM-01 builds blocks without space tokens, ids from firstBlockId, and round-trips (INV-41)", () => {
    const body = "# H\n\nPara\n\n```js\nx\n```\n";
    const m = model(body, 1);
    expect(types(m)).toEqual(["heading", "paragraph", "code"]);
    expect(ids(m)).toEqual([1, 2, 3]);
    expect(m.toBody()).toBe(body);
  });

  it("AT-BM-02 puts a space token into the separatorAfter of the previous block", () => {
    const m = model("A\n\n\nB");
    expect(m.getBlocks()[0]).toMatchObject({ raw: "A", separatorAfter: "\n\n\n" });
    expect(m.getBlocks()[1]).toMatchObject({ raw: "B", separatorAfter: "" });
  });

  it("AT-BM-03 keeps leading blank lines out of the blocks but in the round trip", () => {
    const body = loadFixtureLf("edge-leading-blank.md");
    const m = model(body);
    expect(types(m)).toEqual(["heading", "paragraph"]);
    expect(m.toBody()).toBe(body);
    const blank = model(loadFixtureLf("edge-blank-only.md"));
    expect(blank.getBlocks()).toEqual([]);
    expect(blank.toBody()).toBe("\n\n");
  });

  it("AT-BM-04 a three-item list is one block", () => {
    const m = model("- a\n- b\n- c\n");
    expect(types(m)).toEqual(["list"]);
  });

  it("AT-BM-05 <details> ... </details> with blank lines inside is one html block", () => {
    const body = loadFixtureLf("html-details.md");
    const m = model(body);
    expect(types(m)).toEqual(["paragraph", "html", "paragraph"]);
    expect(raws(m)[1]).toBe("<details>\n<summary>S</summary>\n\nBody **b**\n\n</details>");
    expect(m.toBody()).toBe(body);
  });

  it("AT-BM-06 <div align=center> ... </div> is one block", () => {
    const m = model(loadFixtureLf("html-div-center.md"));
    expect(types(m)).toEqual(["html", "paragraph"]);
    expect(raws(m)[0].startsWith('<div align="center">')).toBe(true);
    expect(raws(m)[0].endsWith("</div>")).toBe(true);
  });

  it("AT-BM-07 HTML that closes inside one token is not merged", () => {
    const m = model("<div>x</div>\n\nPara\n");
    expect(types(m)).toEqual(["html", "paragraph"]);
  });

  it("AT-BM-08 a closing tag inside a paragraph does not close: the block runs to the end (accepted)", () => {
    const body = loadFixtureLf("html-unclosed.md");
    const m = model(body);
    expect(m.getBlocks()).toHaveLength(1);
    expect(m.toBody()).toBe(body);
  });

  it("AT-BM-09 an omitted end tag (<p>) runs to the end of the document", () => {
    const m = model(loadFixtureLf("html-p-omitted.md"));
    expect(m.getBlocks()).toHaveLength(1);
  });

  it("AT-BM-10 void elements do not open a nesting level", () => {
    const m = model(loadFixtureLf("html-void.md"));
    expect(types(m)).toEqual(["html", "paragraph", "html", "paragraph", "html", "paragraph"]);
  });

  it("AT-BM-11 a comment-only html token and a def are blocks; links holds the definition", () => {
    const hidden = model(loadFixtureLf("html-hidden.md"));
    expect(types(hidden)).toEqual(["html", "paragraph", "html", "paragraph"]);
    const refs = model(loadFixtureLf("ref-links.md"));
    expect(types(refs)).toEqual(["paragraph", "paragraph", "paragraph", "def"]);
    expect(refs.links.d.href).toBe("https://example.com/x");
  });

  it("AT-BM-12 blockKatex: the editor text drops trailing newlines; committing it unchanged is no change", () => {
    const body = "$$\nx^2\n$$\n\nAfter\n";
    const m = model(body);
    const katex = m.getBlocks()[0];
    expect(katex.type).toBe("blockKatex");
    const editable = MarkdownBlockModel.toEditableText(katex.raw);
    expect(editable).toBe("$$\nx^2\n$$");
    const change = m.replaceBlock(katex.id, editable, lexer, MAX);
    expect(change.isChanged).toBe(false);
    expect(change.model.toBody()).toBe(body);
  });

  it.each([
    ["with final newline", "# H\n\nLast\n"],
    ["without final newline", "# H\n\nLast"],
  ])("AT-BM-13 the last paragraph round-trips through the editor text (%s)", (_n, body) => {
    const m = model(body);
    const last = m.getBlocks()[1];
    const change = m.replaceBlock(last.id, MarkdownBlockModel.toEditableText(last.raw), lexer, MAX);
    expect(change.isChanged).toBe(false);
    expect(change.model.toBody()).toBe(body);
  });

  it("AT-BM-14 an empty body has no blocks", () => {
    const m = model("");
    expect(m.getBlocks()).toEqual([]);
    expect(m.toBody()).toBe("");
  });

  it("AT-BM-15 replacing with the same text is not a change; blocks and ids stay", () => {
    const m = model("A\n\nB\n\nC\n");
    const change = m.replaceBlock(2, "B", lexer, MAX);
    expect(change.isChanged).toBe(false);
    expect(ids(change.model)).toEqual(ids(m));
  });

  it("AT-BM-16 changing one word keeps the other ids; the changed block gets a new, larger id", () => {
    const m = model("A\n\nB word\n\nC\n");
    const change = m.replaceBlock(2, "B other", lexer, MAX);
    expect(change.isChanged).toBe(true);
    const out = change.model;
    expect(raws(out)).toEqual(["A", "B other", "C\n"]);
    expect(ids(out)[0]).toBe(1);
    expect(ids(out)[2]).toBe(3);
    expect(ids(out)[1]).toBeGreaterThan(3);
    expect(change.anchorBlockId).toBe(ids(out)[1]);
  });

  it("AT-BM-17 appending a heading splits the block; the anchor is the first part; C keeps its id", () => {
    const m = model("A\n\nB\n\nC\n");
    const change = m.replaceBlock(2, "B\n\n## New heading", lexer, MAX);
    const out = change.model;
    expect(types(out)).toEqual(["paragraph", "paragraph", "heading", "paragraph"]);
    expect(change.anchorBlockId).toBe(ids(out)[1]);
    expect(idOf(out, (b) => b.raw.startsWith("C"))).toBe(3);
  });

  it("AT-BM-18 emptying a block removes it; the anchor is the next block, or the previous one at the end", () => {
    const m = model("A\n\nB\n\nC\n");
    const mid = m.replaceBlock(2, "", lexer, MAX);
    expect(raws(mid.model)).toEqual(["A", "C\n"]);
    expect(mid.anchorBlockId).toBe(3);
    const last = m.replaceBlock(3, "", lexer, MAX);
    expect(raws(last.model).map((r) => r.trim())).toEqual(["A", "B"]);
    expect(last.anchorBlockId).toBe(2);
  });

  it("AT-BM-19 emptying the only block leaves no blocks and no anchor (INV-49)", () => {
    const m = model("Only\n");
    const change = m.replaceBlock(1, "", lexer, MAX);
    expect(change.isChanged).toBe(true);
    expect(change.model.getBlocks()).toEqual([]);
    expect(change.anchorBlockId).toBe(null);
  });

  it("AT-BM-20 an unclosed <details> swallows the following blocks; their ids disappear", () => {
    const m = model("A\n\nB\n\nC\n\nD\n");
    const change = m.replaceBlock(2, "<details>", lexer, MAX);
    const out = change.model;
    expect(types(out)).toEqual(["paragraph", "html"]);
    expect(ids(out)).not.toContain(3);
    expect(ids(out)).not.toContain(4);
    expect(change.anchorBlockId).toBe(ids(out)[1]);
  });

  it.each([
    ["after a middle block", "A\n\nB\n", 1, "A\n\nT\n\nB\n"],
    ["after the last block: the last newline stays (L1)", "A\n\nB\n", 2, "A\n\nB\n\nT\n"],
    ["at the end when blockId is null", "A\n\nB", null, "A\n\nB\n\nT"],
    ["no blank line yet", "# A\nB\n", 1, "# A\n\nT\n\nB\n"],
  ])("AT-BM-21 insertAfter adds blank lines only where needed (%s)", (_n, body, id, expected) => {
    const m = model(body);
    const change = m.insertAfter(id, "T", lexer, MAX);
    expect(change.model.toBody()).toBe(expected);
    expect(change.model.toBody()).not.toContain("\n\n\n");
    expect(change.isChanged).toBe(true);
    const inserted = change.model.getBlocks().find((b) => b.raw.trim() === "T");
    expect(change.anchorBlockId).toBe(inserted.id);
  });

  it("AT-BM-22 withBody keeps the ids of blocks whose text did not change", () => {
    const m = model("A\n\nB\n\nC\n");
    const change = m.withBody("A\n\nX\n\nB\n\nC\n", lexer, MAX);
    const out = change.model;
    expect(raws(out)).toEqual(["A", "X", "B", "C\n"]);
    expect(ids(out)[0]).toBe(1);
    expect(ids(out)[2]).toBe(2);
    expect(ids(out)[3]).toBe(3);
  });

  it("AT-BM-23 operations never change the original model (R7.5)", () => {
    const m = model("A\n\nB\n\nC\n");
    const before = JSON.stringify(m.getBlocks());
    m.replaceBlock(2, "Z", lexer, MAX);
    m.insertAfter(1, "T", lexer, MAX);
    m.withBody("Q\n", lexer, MAX);
    expect(JSON.stringify(m.getBlocks())).toBe(before);
    expect(m.toBody()).toBe("A\n\nB\n\nC\n");
    expect(Object.isFrozen(m)).toBe(true);
    expect(Object.isFrozen(m.getBlocks()[0])).toBe(true);
  });

  it("AT-BM-24 ids start at firstBlockId and new ids are always larger than any earlier id", () => {
    const m = model("A\n\nB\n", 100);
    expect(ids(m)).toEqual([100, 101]);
    expect(m.getNextBlockId()).toBe(102);
    const c1 = m.replaceBlock(100, "A2", lexer, MAX).model;
    const c2 = c1.insertAfter(101, "T", lexer, MAX).model;
    const c3 = c2.withBody("N1\n\nN2\n", lexer, MAX).model;
    let maxEver = Math.max(...ids(m));
    let prev = new Set(ids(m));
    for (const step of [c1, c2, c3]) {
      for (const id of ids(step)) if (!prev.has(id)) expect(id).toBeGreaterThan(maxEver);
      maxEver = Math.max(maxEver, ...ids(step));
      prev = new Set(ids(step));
      expect(step.getNextBlockId()).toBeGreaterThan(maxEver);
    }
  });

  it("AT-BM-25 findIndexById returns -1 for an unknown id", () => {
    const m = model("A\n\nB\n");
    expect(m.findIndexById(2)).toBe(1);
    expect(m.findIndexById(999)).toBe(-1);
  });

  it("AT-BM-26 changing the URL of a def changes links of the new model", () => {
    const m = model(loadFixtureLf("ref-links.md"));
    const def = m.getBlocks().find((b) => b.type === "def");
    const out = m.replaceBlock(def.id, "[d]: https://example.com/y", lexer, MAX).model;
    expect(out.links.d.href).toBe("https://example.com/y");
    expect(m.links.d.href).toBe("https://example.com/x");
  });

  it("AT-BM-27 toBody() joins the blocks once per model (review P-5, INV-51)", () => {
    const body = "# A\n\npara\n\n- x\n";
    const m = model(body);
    const join = vi.spyOn(Array.prototype, "join");
    try {
      const first = m.toBody();
      const calls = join.mock.calls.length;
      expect(m.toBody()).toBe(first);
      expect(m.toBody()).toBe(body);
      expect(join.mock.calls.length).toBe(calls);
    } finally {
      join.mockRestore();
    }
  });
});

describe("MarkdownBlockModel.insertAt (INV-52, request 1)", () => {
  const T = "| a |\n|---|\n| b |";

  it.each([
    ["inside a paragraph: the paragraph is cut in two", "Line one\nLine two\n\nZ", 9, "Line one\n\n" + T + "\n\nLine two\n\nZ"],
    ["inside a list: two lists", "- a\n- b", 4, "- a\n\n" + T + "\n\n- b"],
    ["at a block start", "A\n\nB", 3, "A\n\n" + T + "\n\nB"],
    ["at the end of a block's text", "A\n\nB", 1, "A\n\n" + T + "\n\nB"],
    ["into an empty body", "", 0, T],
  ])("AT-BM-28 insertAt puts the block at an offset with blank lines only where needed (%s)", (_n, body, offset, expected) => {
    const m = model(body);
    const change = m.insertAt(offset, T, lexer, MAX);
    expect(change.model.toBody()).toBe(expected);
    expect(change.isChanged).toBe(true);
    const table = change.model.getBlocks().find((b) => b.type === "table");
    expect(change.insertedBlockId).toBe(table.id);
    expect(change.anchorBlockId).toBe(table.id);
  });

  it("AT-BM-29 insertAt: the anchor is the block at anchorOffset in the new model", () => {
    const m = model("Line one\nLine two\n\nZ");
    const change = m.insertAt(9, T, lexer, MAX, { anchorOffset: 0 });
    expect(change.anchorBlockId).toBe(change.model.getBlocks()[0].id);
    expect(change.model.getBlocks()[0].raw).toBe("Line one");
  });

  it("AT-BM-30 startOffsetOf: the body offset of a block, -1 when unknown", () => {
    const m = model("\nA\n\nB\n");
    expect(m.startOffsetOf(ids(m)[0])).toBe(1);
    expect(m.startOffsetOf(ids(m)[1])).toBe(4);
    expect(m.startOffsetOf(999)).toBe(-1);
  });

  it("AT-BM-31 insertAfter is insertAt after the block (unchanged results)", () => {
    const m = model("A\n\nB\n");
    expect(m.insertAfter(1, "T", lexer, MAX).model.toBody()).toBe(m.insertAt(3, "T", lexer, MAX).model.toBody());
  });
});

describe("MarkdownBlockModel.insertAt removeBefore (review L4)", () => {
  it("AT-BM-32 removeBefore takes characters away right before the offset in the same change", () => {
    const m = model("x  \ny\n");
    const change = m.insertAt(3, "T", lexer, MAX, { removeBefore: 2 });
    expect(change.model.toBody()).toBe("x\n\nT\n\ny\n");
    expect(change.model.getBlocks().find((b) => b.raw.startsWith("T")).id).toBe(change.insertedBlockId);
  });
});

describe("AT-BM-33 gapOffset (INV-73)", () => {
  it("the start of the first block, the start of the block after one, the end of the body", () => {
    const m = model("\n\n# T\n\nA\n\nB\n");
    const [t, a, b] = m.getBlocks();
    const body = m.toBody();
    expect(m.gapOffset(null)).toBe(body.indexOf("# T"));
    expect(m.gapOffset(t.id)).toBe(body.indexOf("A"));
    expect(m.gapOffset(a.id)).toBe(body.indexOf("B"));
    expect(m.gapOffset(b.id)).toBe(body.length);
    expect(m.gapOffset(9999)).toBe(body.length);
  });
});

describe("AT-BM-34 the undo record shares the blocks (INV-48, 30 units on 1 MB)", () => {
  it("a commit keeps the very block objects that did not change; the changed one is new and equal to its text", () => {
    const m1 = model("# T\n\nA long paragraph that is longer than sixteen characters.\n\nB\n");
    const [t, a, b] = m1.getBlocks();
    const m2 = m1.replaceBlock(a.id, "A changed paragraph that is longer than sixteen characters.", lexer, 250000).model;
    const [t2, a2, b2] = m2.getBlocks();
    expect(t2).toBe(t);
    expect(b2).toBe(b);
    expect(a2).not.toBe(a);
    expect(a2.raw.trimEnd()).toBe("A changed paragraph that is longer than sixteen characters.");
    expect(Object.isFrozen(a2)).toBe(true);
    expect(m2.toBody()).toBe("# T\n\nA changed paragraph that is longer than sixteen characters.\n\nB\n");
  });

  it("withoutJoinedBody is a new value with the same blocks, links and counter", () => {
    const m1 = model("[x]: https://example.com\n\nSee [x].\n", 5);
    const copy = m1.withoutJoinedBody();
    expect(copy).not.toBe(m1);
    expect(copy.getBlocks()).toEqual(m1.getBlocks());
    copy.getBlocks().forEach((b, i) => expect(b).toBe(m1.getBlocks()[i]));
    expect(copy.links).toBe(m1.links);
    expect(copy.getNextBlockId()).toBe(m1.getNextBlockId());
    expect(copy.toBody()).toBe(m1.toBody());
  });
});
