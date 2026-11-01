import { describe, it, expect } from "vitest";
import MarkdownBlockModel from "../js/classes/MarkdownBlockModel.js";
import { makeLexer } from "./helpers/samples.js";

// INV-74: the blocks of a block range go in one change; their source is
// what a cut or a copy puts on the clipboard (AT-RNG-01..08).

const lexer = makeLexer();
const MAX = 250000;
const model = (body) => MarkdownBlockModel.fromBody(body, lexer, 1);
const idOf = (m, text) => m.getBlocks().find((b) => b.raw.startsWith(text)).id;

const DOC = "# Title\n\nFirst para.\n\n- a\n- b\n\n```js\nx\n```\n\nLast para.\n";

describe("MarkdownBlockModel.removeRange / rangeSource (INV-74)", () => {
  it("AT-RNG-01 removes two blocks and the blank lines after them; the others keep their ids", () => {
    const m = model(DOC);
    const change = m.removeRange(idOf(m, "First"), idOf(m, "- a"), lexer, MAX);
    expect(change.isChanged).toBe(true);
    expect(change.model.toBody()).toBe("# Title\n\n```js\nx\n```\n\nLast para.\n");
    expect(change.model.getBlocks().map((b) => b.id)).toEqual([idOf(m, "# Title"), idOf(m, "```js"), idOf(m, "Last")]);
    // the anchor: the block that now starts where the first one gone started
    expect(change.anchorBlockId).toBe(idOf(m, "```js"));
  });

  it("AT-RNG-02 one block is a range too; the last block takes the anchor of nothing after it", () => {
    const m = model(DOC);
    const one = m.removeRange(idOf(m, "First"), idOf(m, "First"), lexer, MAX);
    expect(one.model.toBody()).toBe("# Title\n\n- a\n- b\n\n```js\nx\n```\n\nLast para.\n");
    const last = m.removeRange(idOf(m, "Last"), idOf(m, "Last"), lexer, MAX);
    expect(last.model.toBody()).toBe("# Title\n\nFirst para.\n\n- a\n- b\n\n```js\nx\n```\n\n");
    expect(last.anchorBlockId).toBe(idOf(m, "```js"));
  });

  it("AT-RNG-03 the whole document: no block is left (INV-49), the leading blank lines stay", () => {
    const m = model(`\n\n${DOC}`);
    const blocks = m.getBlocks();
    const change = m.removeRange(blocks[0].id, blocks[blocks.length - 1].id, lexer, MAX);
    expect(change.model.getBlocks()).toEqual([]);
    expect(change.model.toBody()).toBe("\n\n");
    expect(change.anchorBlockId).toBeNull();
  });

  it("AT-RNG-04 neighbours may join, as when one block is emptied (two lists become one)", () => {
    const m = model("- a\n\nMiddle\n\n- b\n");
    const change = m.removeRange(idOf(m, "Middle"), idOf(m, "Middle"), lexer, MAX);
    expect(change.model.toBody()).toBe("- a\n\n- b\n");
    expect(change.model.getBlocks().map((b) => b.type)).toEqual(["list"]);
  });

  it("AT-RNG-05 unknown ids or a reversed range change nothing", () => {
    const m = model(DOC);
    expect(m.removeRange(999, idOf(m, "Last"), lexer, MAX)).toEqual({ model: m, isChanged: false, anchorBlockId: null });
    expect(m.removeRange(idOf(m, "Last"), idOf(m, "First"), lexer, MAX).isChanged).toBe(false);
    expect(m.rangeSource(idOf(m, "Last"), idOf(m, "First"))).toBeNull();
    expect(m.rangeSource(idOf(m, "First"), 999)).toBeNull();
  });

  it("AT-RNG-06 the source: raws in body order with the blank lines between, no trailing newline", () => {
    const m = model(DOC);
    expect(m.rangeSource(idOf(m, "First"), idOf(m, "```js"))).toBe("First para.\n\n- a\n- b\n\n```js\nx\n```");
    expect(m.rangeSource(idOf(m, "Last"), idOf(m, "Last"))).toBe("Last para.");
    const blocks = m.getBlocks();
    expect(m.rangeSource(blocks[0].id, blocks[blocks.length - 1].id)).toBe(DOC.trimEnd());
  });

  it("AT-RNG-07 three blank lines between blocks are copied as they are", () => {
    const m = model("A\n\n\n\nB\n");
    expect(m.rangeSource(idOf(m, "A"), idOf(m, "B"))).toBe("A\n\n\n\nB");
  });

  it("AT-RNG-08 the model before the change is kept as it was (immutable value)", () => {
    const m = model(DOC);
    m.removeRange(idOf(m, "First"), idOf(m, "Last"), lexer, MAX);
    expect(m.toBody()).toBe(DOC);
  });
});
