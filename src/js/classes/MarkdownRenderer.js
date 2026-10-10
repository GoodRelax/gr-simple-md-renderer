import { escapeHtml } from "../utils.js";

// DOMPurify defaults, plus the MathML wrappers KaTeX emits:
// <semantics><mrow>...</mrow><annotation encoding="application/x-tex">TeX</annotation></semantics>.
// Without them DOMPurify unwraps <annotation> and leaves the raw TeX as stray
// text inside <math>, which screen readers then read aloud. <annotation> holds
// text only; <annotation-xml> (the HTML integration point) stays forbidden.
const PURIFY_CONFIG = {
  ADD_TAGS: ["semantics", "annotation"],
  ADD_ATTR: ["encoding"],
};

export default class MarkdownRenderer {
  /**
   * @param {HTMLElement} preview
   * @param {object} marked
   * @param {object} hljs
   * @param {object} purify - DOMPurify instance (marked has no built-in sanitizer)
   */
  constructor(preview, marked, hljs, purify) {
    this.preview = preview;
    this.marked = marked;
    this.hljs = hljs;
    this.purify = purify;
  }

  /** @param {string} markdownText */
  async render(markdownText) {
    try {
      const html = this.marked.parse(markdownText);
      this.preview.innerHTML = this.purify.sanitize(html, PURIFY_CONFIG);

      try {
        this.preview
          .querySelectorAll(
            "pre code:not(.language-mermaid):not(.language-plantuml):not(.language-puml)",
          )
          .forEach((block) => {
            this.hljs.highlightElement(block);
          });
      } catch (hljsError) {
        console.error("Syntax highlighting error:", hljsError);
      }
    } catch (error) {
      console.error("Markdown parse error:", error);
      this.preview.innerHTML = `<pre style="color:red;">Markdown Parse Error: ${escapeHtml(String(error.message))}</pre>`;
    }
  }
}
