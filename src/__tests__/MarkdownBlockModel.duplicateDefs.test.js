import { describe, it, expect } from "vitest";
import MarkdownBlockModel from "../js/classes/MarkdownBlockModel.js";
import { makeLexer, makeDocWithDuplicateDefs } from "./helpers/samples.js";

// marked skips a reference definition whose label is already
// defined (case-insensitive) and adds the following newline to the previous
// token. The model must still hold every definition as its own block, so that
// joining the raws gives the body back (INV-41).

const lexer = makeLexer();
const MAX = 250000;
const model = (body) => MarkdownBlockModel.fromBody(body, lexer, 1);
const types = (m) => m.getBlocks().map((b) => b.type);

const CASES = [
  ["same label, blank line between", "[a]: http://x\n\n[a]: http://y\n\ntext [a]\n", 2],
  ["labels differ only in case", "[Foo]: /a\n\n[foo]: /b\n", 2],
  ["consecutive lines", "[a]: /x\n[a]: /y\n[b]: /z\n", 3],
  ["a paragraph between, title on the second", "[a]: /x\n\npara\n\n[A]: /y \"t\"\n\nend", 2],
  ["second definition over two lines", "[a]: /x\n[a]:\n  /y\n  'title'\nafter\n", 2],
  ["at the end without a final newline", "- item\n\n[a]: /x\n\n[a]: /y", 2],
  ["three of the same", "[a]: /1\n\n[a]: /2\n\n[a]: /3\n\nuse [a]\n", 3],
  ["duplicate inside other blocks", "# H\n\n[x]: /1\n\n> quote\n\n[X]: /2\n\n```\ncode\n```\n\n[x]: /3\n", 3],
];

describe("AT-BM-38 INV-41 duplicate reference definitions keep the round trip (INV-41)", () => {
  it.each(CASES)("%s", (_name, body, defs) => {
    const m = model(body);
    expect(m.toBody()).toBe(body);
    expect(types(m).filter((t) => t === "def")).toHaveLength(defs);
    expect(m.isWholeDocument).toBe(false);
  });

  it("the first definition wins in links, as in a whole-document parse", () => {
    const m = model("[a]: /first\n\n[A]: /second\n\nsee [a]\n");
    expect(m.links.a.href).toBe("/first");
  });

  it("editing a paragraph keeps both definitions in the body", () => {
    const body = "[a]: https://example.com/x\n\n[a]: https://example.com/y\n\nSee [a].\n";
    const m = model(body);
    const para = m.getBlocks().find((b) => b.type === "paragraph");
    const next = m.replaceBlock(para.id, "See [a]. More.", lexer, MAX).model;
    expect(next.toBody()).toBe("[a]: https://example.com/x\n\n[a]: https://example.com/y\n\nSee [a]. More.\n");
  });

  it("each definition can be edited on its own", () => {
    const m = model("[a]: /x\n[a]: /y\n");
    const second = m.getBlocks().filter((b) => b.type === "def")[1];
    expect(MarkdownBlockModel.toEditableText(second.raw)).toBe("[a]: /y");
    const next = m.replaceBlock(second.id, "[a]: /z", lexer, MAX).model;
    expect(next.toBody()).toBe("[a]: /x\n[a]: /z\n");
  });
});

describe("AT-BM-39 duplicate definitions cost about one lexing of the body (R5 Algorithms and Data Structures, INV-51)", () => {
  /** A lexer that counts the characters it is given. */
  function countingLexer() {
    const counter = { chars: 0 };
    const lex = (src) => {
      counter.chars += src.length;
      return lexer(src);
    };
    return { lex, counter };
  }

  it("fromBody: 20 skipped definitions spread over ~380 KB lex the body about once, not once per definition", () => {
    const body = makeDocWithDuplicateDefs(20);
    const { lex, counter } = countingLexer();
    const m = MarkdownBlockModel.fromBody(body, lex, 1);
    expect(m.toBody()).toBe(body);
    expect(m.isWholeDocument).toBe(false);
    expect(types(m).filter((t) => t === "def")).toHaveLength(40);
    expect(counter.chars).toBeLessThan(body.length * 1.1);
  });

  it("replaceBlock (one commit) also lexes the body about once", () => {
    const body = makeDocWithDuplicateDefs(20);
    const m = model(body);
    const para = m.getBlocks().find((b) => b.type === "paragraph" && b.raw.length > 40);
    const { lex, counter } = countingLexer();
    const next = m.replaceBlock(para.id, para.raw.replace(/\w+/, "Changed"), lex, MAX).model;
    expect(next.isWholeDocument).toBe(false);
    expect(types(next).filter((t) => t === "def")).toHaveLength(40);
    expect(counter.chars).toBeLessThan(body.length * 1.1);
  });

  it("consecutive definitions with no blank line after them", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `[${i % 2 ? "a" : "A"}${Math.floor(i / 2)}]: /u${i}`);
    const body = `${lines.join("\n")}\ntail paragraph\n`;
    const m = model(body);
    expect(m.toBody()).toBe(body);
    expect(m.isWholeDocument).toBe(false);
    expect(types(m).filter((t) => t === "def")).toHaveLength(300);
  });

  it("a skipped definition with a very long title still round-trips as its own block", () => {
    const body = `[a]: /x\n\n[a]: /y\n  "${"t".repeat(9000)}"\n\ntext\n`;
    const m = model(body);
    expect(m.toBody()).toBe(body);
    expect(m.isWholeDocument).toBe(false);
    expect(types(m)).toEqual(["def", "def", "paragraph"]);
  });
});

describe("AT-BM-40 links are deeply immutable copies", () => {
  it("each entry is a frozen {href, title}, not the lexer's own object", () => {
    const tokensLinks = {};
    const spyLexer = (src) => {
      const tokens = lexer(src);
      Object.assign(tokensLinks, tokens.links);
      return tokens;
    };
    const m = MarkdownBlockModel.fromBody('[a]: /x "T"\n\nsee [a]\n', spyLexer, 1);
    expect(m.links.a).toEqual({ href: "/x", title: "T" });
    expect(Object.isFrozen(m.links.a)).toBe(true);
    expect(m.links.a).not.toBe(tokensLinks.a);
  });
});

describe("AT-BM-41 INV-41 fallback: a body the blocks cannot reproduce is kept whole", () => {
  // A lexer whose raws do not cover the input (stands in for any future marked behaviour).
  const badLexer = (src) => Object.assign([{ type: "paragraph", raw: "zzz" }], { links: {} });

  it("becomes one block with the whole body; the body is never rewritten", () => {
    const body = "# A\n\nB\n";
    const m = MarkdownBlockModel.fromBody(body, badLexer, 7);
    expect(m.isWholeDocument).toBe(true);
    expect(m.getBlocks()).toHaveLength(1);
    expect(m.getBlocks()[0]).toMatchObject({ id: 7, raw: body, separatorAfter: "" });
    expect(m.toBody()).toBe(body);
    expect(m.getNextBlockId()).toBe(8);
  });

  it("a lexer that throws also gives the whole body as one block", () => {
    const throwing = () => {
      throw new Error("boom");
    };
    const m = MarkdownBlockModel.fromBody("text\n", throwing, 1);
    expect(m.isWholeDocument).toBe(true);
    expect(m.toBody()).toBe("text\n");
  });

  it("an empty body is not a fallback", () => {
    expect(MarkdownBlockModel.fromBody("", badLexer, 1).getBlocks()).toHaveLength(0);
  });
});

/** mulberry32: a small seeded PRNG (test only). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  () => "# Heading",
  () => "Plain paragraph with [a] and [B][b].",
  (r) => `[${["a", "A", "b", "B", "c"][Math.floor(r() * 5)]}]: /url${Math.floor(r() * 9)}`,
  (r) => `[${["a", "b"][Math.floor(r() * 2)]}]: /t "Title"`,
  () => "- one\n- two",
  () => "1. first\n2. second",
  () => "> quote line",
  () => "```js\nlet x = 1;\n```",
  () => "| A | B |\n|---|---|\n| 1 | 2 |",
  () => "<div>\n\nInner\n\n</div>",
  () => "<!-- comment -->",
  () => "$$\nx^2\n$$",
  () => "Setext\n===",
  () => "---",
];
const SEPARATORS = ["\n", "\n\n", "\n\n\n"];

function randomDoc(r) {
  const n = 1 + Math.floor(r() * 10);
  let doc = r() < 0.2 ? "\n" : "";
  for (let i = 0; i < n; i++) {
    doc += PIECES[Math.floor(r() * PIECES.length)](r);
    if (i < n - 1 || r() < 0.7) doc += SEPARATORS[Math.floor(r() * SEPARATORS.length)];
  }
  return doc;
}

describe("AT-BM-42 INV-41 property: join(raw) === source for random documents (seed fixed)", () => {
  const SEED = 20261010;
  const COUNT = 600;

  it(`${COUNT} random documents round-trip; none falls back to one block`, () => {
    const r = rng(SEED);
    const failures = [];
    let fallbacks = 0;
    for (let i = 0; i < COUNT; i++) {
      const doc = randomDoc(r);
      const m = model(doc);
      if (m.toBody() !== doc) failures.push(doc);
      if (m.isWholeDocument) fallbacks++;
    }
    expect(failures).toEqual([]);
    expect(fallbacks).toBe(0);
  });
});
