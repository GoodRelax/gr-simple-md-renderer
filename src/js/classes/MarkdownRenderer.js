import { escapeHtml } from "../utils.js";
import ExternalImageGate from "./ExternalImageGate.js";

// DOMPurify defaults, plus the MathML wrappers KaTeX emits:
// <semantics><mrow>...</mrow><annotation encoding="application/x-tex">TeX</annotation></semantics>.
// Without them DOMPurify unwraps <annotation> and leaves the raw TeX as stray
// text inside <math>, which screen readers then read aloud. <annotation> holds
// text only; <annotation-xml> (the HTML integration point) stays forbidden.
// <style> is forbidden: a stylesheet in the document could fetch remote
// resources (@import, url()) and restyle the whole app, including the
// external image placeholders. GitHub drops it too.
const PURIFY_CONFIG = {
  ADD_TAGS: ["semantics", "annotation"],
  ADD_ATTR: ["encoding"],
  FORBID_TAGS: ["style"],
};

export default class MarkdownRenderer {
  /**
   * @param {HTMLElement} preview
   * @param {object} marked
   * @param {object} hljs
   * @param {object} purify - DOMPurify (marked has no built-in sanitizer)
   * @param {ExternalImageGate} [imageGate]
   * @purity non-pure
   */
  constructor(
    preview,
    marked,
    hljs,
    purify,
    imageGate = new ExternalImageGate(preview),
  ) {
    this.preview = preview;
    this.marked = marked;
    this.hljs = hljs;
    // Private DOMPurify instance: mermaid sanitizes its labels with the same
    // bundled DOMPurify, and our hook must not change what mermaid sees.
    this.purify = purify(window);
    this.imageGate = imageGate;
    /** @purity non-pure */
    this.purify.addHook("afterSanitizeAttributes", (node) => {
      this.imageGate.neutralize(node);
    });
  }

  /**
   * Forget external image consent (Clear, or a new document was loaded).
   * @purity non-pure
   */
  resetExternalImageConsent() {
    this.imageGate.revoke();
  }

  /**
   * @param {string} markdownText
   * @purity non-pure
   */
  async render(markdownText) {
    try {
      const html = this.marked.parse(markdownText);
      this.preview.innerHTML = this.purify.sanitize(html, PURIFY_CONFIG);
      this.imageGate.apply();

      try {
        this.preview
          .querySelectorAll(
            "pre code:not(.language-mermaid):not(.language-plantuml):not(.language-puml)",
          )
          /** @purity non-pure */
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
