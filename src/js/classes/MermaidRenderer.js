import DiagramRenderer from "./DiagramRenderer.js";
import { CONFIG } from "../config.js";
import { replaceCodeBlock, queryAllIn } from "../utils.js";

export default class MermaidRenderer extends DiagramRenderer {
  /**
   * @param {HTMLElement} preview
   * @param {object|null} mermaid - null until mermaid has run (useLibrary, INV-81)
   * @purity non-pure
   */
  constructor(preview, mermaid) {
    super();
    this.preview = preview;
    this.mermaid = mermaid;
    // Loading boxes made here -> their diagram source. A user-written
    // .mermaid-loading element is not in this map and is never drawn.
    this._loading = new WeakMap();
    this._missing = false;
  }

  /**
   * @param {string} name
   * @param {object} library
   * @purity non-pure
   */
  useLibrary(name, library) {
    if (name === "mermaid") this.mermaid = library;
  }

  /**
   * Whether a render since the last call drew loading boxes (INV-81).
   * @returns {string[]}
   * @purity non-pure
   */
  takeMissingLibraries() {
    const names = this._missing ? ["mermaid"] : [];
    this._missing = false;
    return names;
  }

  /**
   * Whether the preview shows a loading box made here (spec 11-g
   * isShownWithout). A user-written .mermaid-loading does not count.
   * @returns {boolean}
   * @purity semi-pure-b
   */
  hasLoadingBoxes() {
    return [...this.preview.querySelectorAll(".mermaid-loading")].some((box) => this._loading.has(box));
  }

  /**
   * Draw the loading boxes now that mermaid has run.
   * @param {string} theme
   * @purity non-pure
   */
  async renderLoading(theme) {
    if (!this.mermaid) return;
    try {
      const containers = [...this.preview.querySelectorAll(".mermaid-loading")].filter((box) => this._loading.has(box));
      if (containers.length === 0) return;
      for (const box of containers) {
        box.textContent = this._loading.get(box);
        box.classList.remove("mermaid-loading");
        this._loading.delete(box);
      }
      this.initializeMermaid(theme);
      await this.renderMermaid(containers);
    } catch (error) {
      console.error("Mermaid rendering error:", error);
    }
  }

  /**
   * mermaid could not run: the loading boxes say so.
   * @purity non-pure
   */
  showLoadFailed() {
    for (const box of this.preview.querySelectorAll(".mermaid-loading")) {
      if (this._loading.has(box)) box.textContent = CONFIG.messages.diagram.loadFailed;
    }
  }

  /**
   * Convert and draw the Mermaid blocks under root (the whole preview by
   * default; a partial render passes the replaced blocks, INV-42).
   * @param {string} theme
   * @param {ParentNode|ParentNode[]} [root]
   * @purity non-pure
   */
  async render(theme, root = this.preview) {
    try {
      const blocks = queryAllIn(root, "code.language-mermaid");
      if (blocks.length === 0) return;

      const containers = blocks.map((block) => this.convertCodeBlockToContainer(block));
      if (!this.mermaid) {
        // drawn when mermaid has run (renderLoading)
        for (const box of containers) this._showLoading(box);
        this._missing = true;
        return;
      }
      this.initializeMermaid(theme);
      await this.renderMermaid(containers);
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

  /**
   * @param {HTMLElement[]} containers - the .mermaid elements to draw
   * @purity non-pure
   */
  async renderMermaid(containers) {
    try {
      await this.mermaid.run({
        nodes: containers,
      });
    } catch (error) {
      console.error("Mermaid execution error:", error);
    }
  }

  /**
   * A diagram box that waits for mermaid: "Loading diagram..." (owner ruling
   * 2026-10-25); the source is kept for the drawing.
   * @param {HTMLElement} box
   * @purity non-pure
   */
  _showLoading(box) {
    this._loading.set(box, box.textContent);
    box.classList.add("mermaid-loading");
    box.textContent = CONFIG.messages.diagram.loading;
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
    container.title = CONFIG.messages.diagram.tooltip;

    replaceCodeBlock(block, container);
    return container;
  }
}
