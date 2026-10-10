import { describe, it, expect, vi, afterEach } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import MarkdownRenderer, { PURIFY_CONFIG } from "../js/classes/MarkdownRenderer.js";
import MarkdownBlockModel from "../js/classes/MarkdownBlockModel.js";

// The private DOMPurify instance gets its config once (setConfig). Passing the
// config on every call made DOMPurify clone and parse it for each of the
// ~15,000 blocks of a 1 MB document, which was most of the full render time.
// The sanitizing rules must stay exactly the same.

function setup() {
  const preview = document.createElement("div");
  document.body.appendChild(preview);
  const marked = new Marked();
  marked.use(markedKatex({ throwOnError: false }));
  const renderer = new MarkdownRenderer(preview, marked, hljs, DOMPurify);
  return { preview, marked, renderer };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const CORPUS = [
  "<p>plain <b>bold</b></p>",
  '<img src="x" onerror="alert(1)">',
  '<a href="javascript:alert(1)">x</a>',
  "<style>body{color:red}</style><p>after style</p>",
  "<script>alert(1)</script><p>after script</p>",
  '<math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x</annotation></semantics></math>',
  "<math><annotation-xml encoding=\"text/html\"><p>x</p></annotation-xml></math>",
  '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>',
  '<details><summary>s</summary><p>body</p></details>',
  '<div data-block-id="1" class="md-block">spoof</div>',
  "<form><input name=x></form>",
  '<img src="https://example.com/a.png" alt="external">',
];

describe("the private DOMPurify instance is configured once (render speed)", () => {
  it("the instance holds PURIFY_CONFIG: a call without a config still forbids <style> and keeps MathML annotation", () => {
    const { renderer } = setup();
    expect(renderer.purify.sanitize("<p>a</p><style>x</style>")).toBe("<p>a</p>");
    expect(renderer.purify.sanitize('<math><semantics><mi>x</mi><annotation encoding="application/x-tex">x</annotation></semantics></math>')).toContain(
      '<annotation encoding="application/x-tex">x</annotation>',
    );
  });

  it("renderBlocks and documentHtml never pass a config per call", () => {
    const { renderer, marked } = setup();
    const sanitize = vi.spyOn(renderer.purify, "sanitize");
    const body = "# A\n\nText with <b>b</b>.\n\n```js\nlet x = 1;\n```\n\n<div>raw</div>\n";
    renderer.renderBlocks(MarkdownBlockModel.fromBody(body, (s) => marked.lexer(s), 1));
    renderer.documentHtml(body);
    expect(sanitize).toHaveBeenCalled();
    for (const call of sanitize.mock.calls) expect(call).toHaveLength(1);
  });

  it.each(CORPUS)("same output as a fresh instance given the config per call (same image gate hook): %s", (html) => {
    const { renderer } = setup();
    const reference = DOMPurify(window);
    reference.addHook("afterSanitizeAttributes", (node) => renderer.imageGate.neutralize(node));
    expect(renderer.purify.sanitize(html)).toBe(reference.sanitize(html, PURIFY_CONFIG));
  });

  it("an external image is still gated (INV-19)", () => {
    const { renderer } = setup();
    expect(renderer.purify.sanitize('<img src="https://example.com/a.png" alt="e">')).not.toMatch(/\ssrc="https:/);
  });

  it("the shared DOMPurify (mermaid's) keeps its own defaults", () => {
    setup();
    expect(DOMPurify.sanitize("<p>a</p><style>x</style>")).toContain("<style>");
  });
});
