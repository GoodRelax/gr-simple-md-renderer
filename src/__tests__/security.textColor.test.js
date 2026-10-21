import { describe, it, expect, afterEach } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import MarkdownRenderer from "../js/classes/MarkdownRenderer.js";
import { CONFIG } from "../js/config.js";

// INV-66: the text color is a <span style="color: ..."> in the source. It
// goes through the same marked -> DOMPurify path; DOMPurify, ExternalImageGate
// and the CSP are not changed for it.

function renderer() {
  const preview = document.createElement("div");
  document.body.appendChild(preview);
  const marked = new Marked();
  marked.use(markedKatex({ throwOnError: false }));
  return new MarkdownRenderer(preview, marked, hljs, DOMPurify);
}

afterEach(() => document.body.replaceChildren());

const parse = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content;
};

describe("AT-TC text color spans (INV-66)", () => {
  it.each(Object.entries(CONFIG.edit.textColors))("AT-TC-01 the %s span keeps its color after sanitizing", (_name, { light }) => {
    const { html } = renderer().blockHtml(`a <span style="color: ${light}">b</span> c`, {});
    const span = parse(html).querySelector("span");
    expect(span.getAttribute("style")).toBe(`color: ${light}`);
    expect(span.textContent).toBe("b");
  });

  it("AT-TC-02 a span whose style loads a remote image loses that style (ExternalImageGate)", () => {
    const { html } = renderer().blockHtml('a <span style="background:url(https://example.com/x.png)">b</span>', {});
    const span = parse(html).querySelector("span");
    expect(span.getAttribute("style") ?? "").not.toMatch(/url\(/i);
  });
});
