export default class MarkdownRenderer {
  /**
   * @param {HTMLElement} preview
   * @param {object} marked
   * @param {object} hljs
   */
  constructor(preview, marked, hljs) {
    this.preview = preview;
    this.marked = marked;
    this.hljs = hljs;
  }

  /** @param {string} markdownText */
  async render(markdownText) {
    try {
      const html = this.marked.parse(markdownText);
      this.preview.innerHTML = html;

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
      this.preview.innerHTML = `<pre style="color:red;">Markdown Parse Error: ${error.message}</pre>`;
    }
  }
}
