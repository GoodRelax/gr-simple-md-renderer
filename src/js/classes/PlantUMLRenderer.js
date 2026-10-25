import DiagramRenderer from "./DiagramRenderer.js";
import { CONFIG } from "../config.js";
import { replaceCodeBlock, queryAllIn } from "../utils.js";

export default class PlantUMLRenderer extends DiagramRenderer {
  /**
   * @param {HTMLElement} preview
   * @param {object|null} plantumlEncoder - null: loadEncoder gives it when first needed (INV-81)
   * @param {Function|null} [loadEncoder] - () => Promise of the encoder
   * @purity non-pure
   */
  constructor(preview, plantumlEncoder, loadEncoder = null) {
    super();
    this.preview = preview;
    this.encoder = plantumlEncoder;
    this.loadEncoder = loadEncoder;
    // Placeholders created here -> { code, theme }. A user-written
    // .plantuml-pending element is not in this map and never sends (INV-23).
    this._pending = new WeakMap();
    // Boxes waiting for the encoder after the consent (INV-81 (3)) -> { code, theme }
    this._loading = new WeakMap();
    this._encoderWait = null; // the promise of the encoder being awaited
    // The answer of the last full render's dialog (true / false), or null:
    // it asked nothing (INV-81 (3), "repeat")
    this._answer = null;
  }

  /**
   * Render the PlantUML blocks under root (the whole preview by default).
   * mode "consent" (full render): one confirm, then send (INV-02).
   * mode "placeholder" (partial render after an edit): send nothing and show
   * a pending box with a [Render] button instead (INV-23).
   * mode "repeat" (blocks drawn again because KaTeX ran, no one acted): the
   * answer of the last full render's dialog, without asking again; the
   * placeholder when it asked nothing (INV-81 (3)).
   * Before the encoder has run, the blocks sent show "Loading diagram..."
   * and are drawn when it comes; the render does not wait for it (INV-81 (3)).
   * @param {string} theme
   * @param {ParentNode|ParentNode[]} [root]
   * @param {"consent"|"placeholder"|"repeat"} [mode]
   * @purity non-pure
   */
  async render(theme, root = this.preview, mode = "consent") {
    try {
      if (mode === "consent") this._answer = null;
      const blocks = queryAllIn(root, "code.language-plantuml, code.language-puml");
      if (blocks.length === 0) return;

      if (mode === "placeholder" || (mode === "repeat" && this._answer === null)) {
        /** @purity non-pure */
        blocks.forEach((block) => {
          replaceCodeBlock(block, this.createPendingElement(block.textContent, theme));
        });
        return;
      }

      const permitted = mode === "repeat" ? this._answer : this.askConsent();
      this._answer = permitted;

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

      if (!this.encoder && this.loadEncoder) {
        // not awaited: the render queue goes on (edits, Undo, other documents)
        for (const block of blocks) replaceCodeBlock(block, this._loadingBox(block.textContent, theme));
        this._drawWhenEncoded();
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
   * @param {string} name
   * @param {object} library
   * @purity non-pure
   */
  useLibrary(name, library) {
    if (name === "plantuml") this.encoder = library;
  }

  /**
   * The encoder, once it has run; a failure to load is logged, and the
   * encoding then fails as an encoding error. One wait at a time.
   * @returns {Promise<void>}
   * @purity non-pure
   */
  _encoderReady() {
    if (this.encoder || !this.loadEncoder) return Promise.resolve();
    if (!this._encoderWait) {
      /** @purity non-pure */
      this._encoderWait = this.loadEncoder().then(
        /** @purity non-pure */
        (encoder) => {
          this.encoder = encoder;
        },
        /** @purity non-pure */
        (error) => {
          console.error("PlantUML encoder could not be loaded:", error);
        },
      ).finally(
        /** @purity non-pure */
        () => {
          this._encoderWait = null;
        },
      );
    }
    return this._encoderWait;
  }

  /**
   * A box for a block that was allowed to be sent and waits for the
   * encoder: "Loading diagram..." as a Mermaid box says.
   * @param {string} code
   * @param {string} theme
   * @returns {HTMLDivElement}
   * @purity non-pure
   */
  _loadingBox(code, theme) {
    const box = document.createElement("div");
    box.className = "plantuml-loading";
    box.textContent = CONFIG.messages.diagram.loading;
    this._loading.set(box, { code, theme });
    return box;
  }

  /**
   * When the encoder has come, the loading boxes still shown are drawn.
   * @purity non-pure
   */
  _drawWhenEncoded() {
    /** @purity non-pure */
    this._encoderReady().then(() => {
      for (const box of this.preview.querySelectorAll(".plantuml-loading")) {
        if (this._loading.has(box)) this._drawLoading(box);
      }
    });
  }

  /**
   * Send one loading box's diagram (its consent was given).
   * @param {HTMLElement} box
   * @returns {Promise<boolean>}
   * @purity non-pure
   */
  _drawLoading(box) {
    const entry = this._loading.get(box);
    this._loading.delete(box);
    if (!entry || !box.isConnected) return Promise.resolve(false);
    let img;
    try {
      img = this.createImage(this.applyTheme(entry.code, entry.theme));
    } catch (error) {
      console.error("PlantUML encoding error:", error);
      box.replaceWith(this.createErrorElement(CONFIG.messages.plantuml.encodingFailed));
      return Promise.resolve(false);
    }
    box.replaceWith(this.createWrapper(img));
    return this.waitForImageLoad(img, CONFIG.plantuml.imageLoadTimeout);
  }

  /**
   * The PlantUML consent dialog (CON-04, INV-02).
   * @returns {boolean} true when the user allows sending
   * @purity non-pure
   */
  askConsent() {
    return window.confirm(CONFIG.messages.plantuml.consent);
  }

  /**
   * A pending box for a PlantUML block that was not sent (INV-23).
   * @param {string} code
   * @param {string} theme
   * @returns {HTMLDivElement}
   * @purity non-pure
   */
  createPendingElement(code, theme) {
    const box = document.createElement("div");
    box.className = "plantuml-pending";
    const label = document.createElement("span");
    label.textContent = CONFIG.messages.edit.plantumlPending;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = CONFIG.messages.edit.plantumlRenderButton;
    button.addEventListener("click", () => this.renderPending(box, theme));
    box.append(label, " ", button);
    this._pending.set(box, { code, theme });
    return box;
  }

  /**
   * [Render] on a pending box: ask with the usual dialog, and send only on OK
   * (INV-23, INV-02). Cancel keeps the box. The dialog and the image request
   * start synchronously, inside the click (once the encoder has run; it runs
   * when the page is idle, INV-81).
   * @param {HTMLElement} placeholder
   * @param {string} [theme]
   * @returns {Promise<boolean>}
   * @purity non-pure
   */
  renderPending(placeholder, theme) {
    const entry = this._pending.get(placeholder);
    if (!entry || !placeholder.isConnected) return Promise.resolve(false);
    if (!this.askConsent()) return Promise.resolve(false);
    this._pending.delete(placeholder);
    const box = this._loadingBox(entry.code, theme ?? entry.theme);
    placeholder.replaceWith(box);
    if (this.encoder || !this.loadEncoder) return this._drawLoading(box);
    return this._encoderReady().then(() => this._drawLoading(box));
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
    img.alt = CONFIG.messages.plantuml.diagramAlt;
    img.className = "plantuml-diagram";
    img.title = CONFIG.messages.diagram.tooltip;
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
