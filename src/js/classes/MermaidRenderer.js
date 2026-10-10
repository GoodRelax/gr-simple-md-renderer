import DiagramRenderer from "./DiagramRenderer.js";
import { replaceCodeBlock } from "../utils.js";

export default class MermaidRenderer extends DiagramRenderer {
  /**
   * @param {HTMLElement} preview
   * @param {object} mermaid
   * @purity non-pure
   */
  constructor(preview, mermaid) {
    super();
    this.preview = preview;
    this.mermaid = mermaid;
  }

  /**
   * @param {string} theme @param {boolean} [_skipRendering=false]
   * @purity non-pure
   */
  async render(theme, _skipRendering = false) {
    try {
      const blocks = this.preview.querySelectorAll(
        "code.language-mermaid",
      );
      if (blocks.length === 0) return;

      blocks.forEach((block) => this.convertCodeBlockToContainer(block));
      this.initializeMermaid(theme);
      await this.renderMermaid();
    } catch (error) {
      console.error("Mermaid rendering error:", error);
    }
  }

  /**
   * @param {string} theme
   * @purity non-pure
   */
  initializeMermaid(theme) {
    this.mermaid.initialize({
      startOnLoad: false,
      theme: theme === "dark" ? "dark" : "default",
      // Labels are inserted (even for text measurement) by mermaid itself, out
      // of reach of the external image gate, so <img> in labels is dropped
      // (CON-12, INV-19). "style" is mermaid's own default.
      dompurifyConfig: { FORBID_TAGS: ["style", "img"] },
      // Mermaid's default secure keys, plus dompurifyConfig so that an
      // %%{init}%% directive in the document cannot loosen it.
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "suppressErrorRendering",
        "maxEdges",
        "dompurifyConfig",
      ],
    });
  }

  /** @purity non-pure */
  async renderMermaid() {
    try {
      await this.mermaid.run({
        nodes: this.preview.querySelectorAll(".mermaid"),
      });
    } catch (error) {
      console.error("Mermaid execution error:", error);
    }
  }

  /**
   * @param {HTMLElement} block
   * @returns {HTMLElement}
   * @purity non-pure
   */
  convertCodeBlockToContainer(block) {
    const container = document.createElement("div");
    container.className = "mermaid";
    container.textContent = block.textContent;
    container.title =
      "Ctrl+Scroll: zoom | Double-click: reset | Drag: pan";

    replaceCodeBlock(block, container);
    return container;
  }
}
