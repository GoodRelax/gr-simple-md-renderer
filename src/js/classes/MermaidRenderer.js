import DiagramRenderer from "./DiagramRenderer.js";
import { replaceCodeBlock } from "../utils.js";

export default class MermaidRenderer extends DiagramRenderer {
  /**
   * @param {HTMLElement} preview
   * @param {object} mermaid
   */
  constructor(preview, mermaid) {
    super();
    this.preview = preview;
    this.mermaid = mermaid;
  }

  /** @param {string} theme @param {boolean} [_skipRendering=false] */
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

  /** @param {string} theme */
  initializeMermaid(theme) {
    this.mermaid.initialize({
      startOnLoad: false,
      theme: theme === "dark" ? "dark" : "default",
    });
  }

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
