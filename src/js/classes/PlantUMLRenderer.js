import DiagramRenderer from "./DiagramRenderer.js";
import { CONFIG } from "../config.js";
import { replaceCodeBlock } from "../utils.js";

export default class PlantUMLRenderer extends DiagramRenderer {
  /**
   * @param {HTMLElement} preview
   * @param {object} plantumlEncoder
   * @purity non-pure
   */
  constructor(preview, plantumlEncoder) {
    super();
    this.preview = preview;
    this.encoder = plantumlEncoder;
  }

  /**
   * @param {string} theme
   * @purity non-pure
   */
  async render(theme) {
    try {
      const blocks = this.preview.querySelectorAll(
        "code.language-plantuml, code.language-puml",
      );
      if (blocks.length === 0) return;

      const permitted = window.confirm(
        `Security & Confidentiality Warning

` +
          `Your data will be sent to an external PlantUML rendering server.

` +
          `[OK]: data -> \u{1F310} official server -> render PlantUML

` +
          `[Cancel]: Render Markdown without PlantUML`,
      );

      if (!permitted) {
        /** @purity non-pure */
        blocks.forEach((block) => {
          const errorDiv = this.createErrorElement(
            CONFIG.messages.plantuml.canceled,
          );
          replaceCodeBlock(block, errorDiv);
        });
        return;
      }

      const promises = [];
      /** @purity non-pure */
      blocks.forEach((block) => {
        const promise = this.renderSingleBlock(block, theme);
        if (promise) promises.push(promise);
      });
      await Promise.allSettled(promises);
    } catch (error) {
      console.error("PlantUML rendering error:", error);
    }
  }

  /**
   * @param {HTMLElement} block
   * @param {string} theme
   * @returns {Promise<boolean>|null}
   * @purity non-pure
   */
  renderSingleBlock(block, theme) {
    try {
      const code = this.applyTheme(block.textContent, theme);
      const img = this.createImage(code);
      const wrapper = this.createWrapper(img);
      replaceCodeBlock(block, wrapper);
      return this.waitForImageLoad(img, CONFIG.plantuml.imageLoadTimeout);
    } catch (error) {
      console.error("PlantUML encoding error:", error);
      const errorDiv = this.createErrorElement(
        CONFIG.messages.plantuml.encodingFailed,
      );
      replaceCodeBlock(block, errorDiv);
      return null;
    }
  }

  /**
   * @param {string} code
   * @param {string} theme
   * @returns {string}
   * @purity semi-pure-a
   */
  applyTheme(code, theme) {
    if (theme === "dark" && !code.includes("!theme")) {
      return code.replace(
        /(@start\w+.*)/i,
        `$1\n!theme ${CONFIG.plantuml.darkTheme}`,
      );
    }
    return code;
  }

  /**
   * @param {string} code
   * @returns {HTMLImageElement}
   * @purity non-pure
   */
  createImage(code) {
    const encoded = this.encoder.encode(code);
    const img = document.createElement("img");
    img.src = `${CONFIG.plantuml.serverUrl}${encoded}`;
    img.alt = "PlantUML Diagram";
    img.className = "plantuml-diagram";
    img.title = "Ctrl+Scroll: zoom | Double-click: reset | Drag: pan";
    img.style.maxWidth = "100%";
    return img;
  }

  /**
   * @param {HTMLImageElement} img
   * @returns {HTMLDivElement}
   * @purity non-pure
   */
  createWrapper(img) {
    const wrapper = document.createElement("div");
    wrapper.className = "plantuml-wrapper";
    wrapper.appendChild(img);
    return wrapper;
  }

  /**
   * @param {HTMLImageElement} img
   * @param {number} timeout ms
   * @returns {Promise<boolean>}
   * @purity non-pure
   */
  async waitForImageLoad(img, timeout) {
    /** @purity non-pure */
    return new Promise((resolve) => {
      /** @purity non-pure */
      const timer = setTimeout(() => {
        const errorDiv = this.createErrorElement(
          CONFIG.messages.plantuml.timeout(timeout / 1000),
        );
        img.replaceWith(errorDiv);
        resolve(false);
      }, timeout);

      /** @purity non-pure */
      img.onload = () => {
        clearTimeout(timer);
        resolve(true);
      };

      /** @purity non-pure */
      img.onerror = () => {
        clearTimeout(timer);
        const errorDiv = this.createErrorElement(
          CONFIG.messages.plantuml.serverError,
        );
        img.replaceWith(errorDiv);
        resolve(false);
      };
    });
  }

  /**
   * @param {string} message
   * @returns {HTMLDivElement}
   * @purity semi-pure-a
   */
  createErrorElement(message) {
    const div = document.createElement("div");
    div.className = "plantuml-error";
    div.textContent = message;
    return div;
  }
}
