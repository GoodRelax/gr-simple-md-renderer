import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import MarkdownRenderer from "../js/classes/MarkdownRenderer.js";
import MarkdownBlockModel from "../js/classes/MarkdownBlockModel.js";
import { makeLexer, loadFixtureLf, loadSampleLf, makeOneMegabyteTextDoc } from "./helpers/samples.js";

// The block model needs block boundaries only (INV-41). MarkdownRenderer.lex
// runs marked's block tokenizer without the inline pass, which was about two
// thirds of the lexing time of a commit on a 1 MB document. Each block's HTML
// is still made from a full lexing of that block (blockHtml).

const here = dirname(fileURLToPath(import.meta.url));
const fullLexer = makeLexer();

function renderer() {
  const marked = new Marked();
  marked.use(markedKatex({ throwOnError: false }));
  return new MarkdownRenderer(document.createElement("div"), marked, hljs, DOMPurify);
}

const shape = (m) => ({
  blocks: m.getBlocks().map((b) => [b.type, b.raw, b.separatorAfter]),
  links: JSON.stringify(m.links),
  whole: m.isWholeDocument,
  body: m.toBody(),
});

function sameModel(body) {
  const r = renderer();
  const a = MarkdownBlockModel.fromBody(body, (s) => r.lex(s), 1);
  const b = MarkdownBlockModel.fromBody(body, fullLexer, 1);
  expect(shape(a)).toEqual(shape(b));
  expect(a.toBody()).toBe(body);
}

describe("AT-MR-20 MarkdownRenderer.lex: block tokens only (render speed, INV-41 unchanged)", () => {
  it("does not tokenize inline content", () => {
    const tokens = renderer().lex("Some *em* and **strong** text with `code`.\n");
    const para = tokens.find((t) => t.type === "paragraph");
    expect(para.raw).toBe("Some *em* and **strong** text with `code`.\n");
    expect(para.tokens ?? []).toHaveLength(0);
  });

  it("keeps the reference link definitions (links)", () => {
    const tokens = renderer().lex("[a]: https://example.com/x \"T\"\n\nsee [a]\n");
    expect(tokens.links.a).toEqual({ href: "https://example.com/x", title: "T" });
  });

  const fixtures = readdirSync(resolve(here, "fixtures/inplace-edit")).filter((n) => n.endsWith(".md"));
  it.each(fixtures)("fixture %s: same blocks and links as a full lexing", (name) => {
    sameModel(loadFixtureLf(name));
  });

  it.each(["sample-data.md", "sample-data-2.md"])("%s: same blocks and links", (name) => {
    sameModel(loadSampleLf(name));
  });

  it("a 1 MB-style text document (3 copies): same blocks and links", () => {
    sameModel(makeOneMegabyteTextDoc(3));
  });

  it("600 seeded random documents: same blocks and links", () => {
    let a = 20261011 >>> 0;
    const rnd = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pieces = [
      "# Heading *em*",
      "Para with [a] and **b** and `c` and $x^2$.",
      "[a]: /u",
      "[A]: /v \"t\"",
      "- one\n- two\n  - nested",
      "1. first\n2. second",
      "> quote **x**\n> more",
      "```js\nlet x = 1;\n```",
      "| A | B |\n|---|---|\n| 1 | `|` |",
      "<div>\n\n*inner*\n\n</div>",
      "<!-- c -->",
      "$$\nx^2\n$$",
      "Setext\n===",
      "---",
      "    indented code",
      "<details><summary>s</summary>\n\nbody\n\n</details>",
    ];
    const seps = ["\n", "\n\n", "\n\n\n"];
    for (let i = 0; i < 600; i++) {
      let doc = rnd() < 0.2 ? "\n" : "";
      const n = 1 + Math.floor(rnd() * 10);
      for (let k = 0; k < n; k++) {
        doc += pieces[Math.floor(rnd() * pieces.length)];
        if (k < n - 1 || rnd() < 0.7) doc += seps[Math.floor(rnd() * seps.length)];
      }
      sameModel(doc);
    }
  });
});
