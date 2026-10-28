import DiagramRenderer from "./DiagramRenderer.js";
import { CONFIG } from "../config.js";
import { replaceCodeBlock, queryAllIn } from "../utils.js";

const PLANTUML_SELECTOR = "code.language-plantuml, code.language-puml";

/**
 * One diagram: its source and theme (keepRender, heldForRender).
 * @purity pure
 * @param {string} code
 * @param {string} theme
 * @returns {string}
 */
function diagramKey(code, theme) {
  return `${theme}\u0000${code}`;
}

export default class PlantUMLRenderer extends DiagramRenderer {
  /**
   * PlantUML is drawn only when the page is settled (spec 11-g, INV-81 (3),
   * owner ruling AQ7): the encoder is then ready or failed, never awaited.
   * Before that, hold() shows "Loading diagram..." and runWaiting() deals
   * with those boxes once, when the page is settled.
   * @param {HTMLElement} preview
   * @param {object|null} plantumlEncoder - null until the encoder has run (useLibrary)
   * @purity non-pure
   */
  constructor(preview, plantumlEncoder) {
    super();
    this.preview = preview;
    this.encoder = plantumlEncoder;
    // Placeholders created here -> { code, theme }. A user-written
    // .plantuml-pending element is not in this map and never sends (INV-23).
    this._pending = new WeakMap();
    // Loading boxes made by hold() -> { code, theme, later: "consent" | "render" }.
    // A user-written .plantuml-loading element is not in this map.
    this._waiting = new WeakMap();
    // runWaiting() runs once, when the page is settled: after it no box waits.
    this._waitingAnswered = false;
  }

  /**
   * Render the PlantUML blocks under root (the whole preview by default);
   * called when the page is settled (11-g runPlantUmlStep).
   * mode "consent" (full render): one confirm, then send (INV-02).
   * mode "placeholder" (partial render after an edit): send nothing and show
   * a pending box with a [Render] button instead (INV-23).
   * keepRender: diagrams (heldForRender keys) that wait for [Render] keep
   * waiting for it in any mode (a KaTeX redraw of a committed block, INV-02).
   * Without the encoder (it could not run) every block shows the encoding
   * error, and no dialog is shown.
   * While held boxes of the same full render still wait for runWaiting()
   * (a KaTeX redraw queued before the page was settled runs before it), a
   * "consent" render holds its blocks too: they join that batch, and the
   * full render gets one dialog (INV-81 (3), G6).
   * @param {string} theme
   * @param {ParentNode|ParentNode[]} [root]
   * @param {"consent"|"placeholder"} [mode]
   * @param {Set<string>|null} [keepRender]
   * @purity non-pure
   */
  async render(theme, root = this.preview, mode = "consent", keepRender = null) {
    try {
      const blocks = queryAllIn(root, PLANTUML_SELECTOR);
      if (blocks.length === 0) return;
      if (mode === "consent" && this._hasWaitingBoxes()) {
        this.hold(theme, root, mode, keepRender);
        return;
      }

      if (!this.encoder) {
        for (const block of blocks) replaceCodeBlock(block, this._encodingFailedElement());
        return;
      }

      const asked = [];
      for (const block of blocks) {
        if (mode === "placeholder" || keepRender?.has(diagramKey(block.textContent, theme))) {
          replaceCodeBlock(block, this.createPendingElement(block.textContent, theme));
        } else {
          asked.push(block);
        }
      }
      if (asked.length === 0) return;

      if (!this.askConsent()) {
        /** @purity non-pure */
        asked.forEach((block) => replaceCodeBlock(block, this._canceledElement()));
        return;
      }
      const promises = [];
      /** @purity non-pure */
      asked.forEach((block) => {
        const promise = this.renderSingleBlock(block, theme);
        if (promise) promises.push(promise);
      });
      await Promise.allSettled(promises);
    } catch (error) {
      console.error("PlantUML rendering error:", error);
    }
  }

  /**
   * Before the page is settled (11-g holdPlantUml): each PlantUML block
   * under root shows "Loading diagram..." (no dialog, nothing sent, not
   * awaited). The box remembers its source, theme and what comes later: the
   * dialog ("consent": a full render, or the redraw after KaTeX ran) or a
   * [Render] box ("placeholder": a partial render, INV-23). A diagram in
   * keepRender stays a [Render] one (INV-02: the redraw after KaTeX never
   * turns a committed diagram into one the dialog sends).
   * @param {string} theme
   * @param {ParentNode|ParentNode[]} [root]
   * @param {"consent"|"placeholder"} [mode]
   * @param {Set<string>|null} [keepRender]
   * @purity non-pure
   */
  hold(theme, root = this.preview, mode = "consent", keepRender = null) {
    for (const block of queryAllIn(root, PLANTUML_SELECTOR)) {
      const code = block.textContent;
      const later = mode === "placeholder" || keepRender?.has(diagramKey(code, theme)) ? "render" : "consent";
      const box = document.createElement("div");
      box.className = "plantuml-loading";
      box.textContent = CONFIG.messages.diagram.loading;
      this._waiting.set(box, { code, theme, later });
      replaceCodeBlock(block, box);
    }
  }

  /**
   * The diagrams (source and theme) the held boxes in the preview keep for
   * [Render]: read before a KaTeX redraw replaces their blocks.
   * @returns {Set<string>}
   * @purity semi-pure-b
   */
  heldForRender() {
    const keys = new Set();
    for (const box of this.preview.querySelectorAll(".plantuml-loading")) {
      const entry = this._waiting.get(box);
      if (entry?.later === "render") keys.add(diagramKey(entry.code, entry.theme));
    }
    for (const box of this.preview.querySelectorAll(".plantuml-pending")) {
      const entry = this._pending.get(box);
      if (entry) keys.add(diagramKey(entry.code, entry.theme));
    }
    return keys;
  }
  /**
   * The page is settled (11-g runWaitingPlantUml): the held boxes still in
   * the preview are dealt with once. The "consent" ones get one dialog: OK
   * sends them, Cancel shows "not sent" (INV-03). The "render" ones become
   * [Render] boxes (INV-23). Without the encoder, every box shows the
   * encoding error and no dialog is shown.
   * @returns {Promise<boolean>} false when no held box was there
   * @purity non-pure
   */
  async runWaiting() {
    this._waitingAnswered = true;
    const boxes = this._waitingBoxes();
    if (boxes.length === 0) return false;
    /** @purity non-pure */
    const entries = boxes.map((box) => {
      const entry = this._waiting.get(box);
      this._waiting.delete(box);
      return { box, ...entry };
    });
    if (!this.encoder) {
      for (const { box } of entries) box.replaceWith(this._encodingFailedElement());
      return true;
    }
    for (const { box, code, theme, later } of entries) {
      if (later === "render") box.replaceWith(this.createPendingElement(code, theme));
    }
    const asked = entries.filter((e) => e.later === "consent");
    if (asked.length === 0) return true;
    if (!this.askConsent()) {
      for (const { box } of asked) box.replaceWith(this._canceledElement());
      return true;
    }
    await Promise.allSettled(asked.map(({ box, code, theme }) => this._send(box, code, theme)));
    return true;
  }

  /**
   * The held boxes in the preview (user-written .plantuml-loading elements
   * are not among them).
   * @returns {HTMLElement[]}
   * @purity semi-pure-b
   */
  _waitingBoxes() {
    return [...this.preview.querySelectorAll(".plantuml-loading")].filter((box) => this._waiting.has(box));
  }

  /**
   * Whether held boxes still wait for runWaiting() (it has not run yet).
   * @returns {boolean}
   * @purity semi-pure-b
   */
  _hasWaitingBoxes() {
    return !this._waitingAnswered && this._waitingBoxes().length > 0;
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
   * Send one diagram whose consent was given, in place of target.
   * @param {Element} target
   * @param {string} code
   * @param {string} theme
   * @returns {Promise<boolean>}
   * @purity non-pure
   */
  _send(target, code, theme) {
    let img;
    try {
      img = this.createImage(this.applyTheme(code, theme));
    } catch (error) {
      console.error("PlantUML encoding error:", error);
      target.replaceWith(this._encodingFailedElement());
      return Promise.resolve(false);
    }
    target.replaceWith(this.createWrapper(img));
    return this.waitForImageLoad(img, CONFIG.plantuml.imageLoadTimeout);
  }

  /**
   * @returns {HTMLDivElement}
   * @purity non-pure
   */
  _canceledElement() {
    return this.createErrorElement(CONFIG.messages.plantuml.canceled);
  }

  /**
   * @returns {HTMLDivElement}
   * @purity non-pure
   */
  _encodingFailedElement() {
    return this.createErrorElement(CONFIG.messages.plantuml.encodingFailed);
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
   * start synchronously, inside the click. Without the encoder (it could not
   * run) the box shows the encoding error, with no dialog.
   * @param {HTMLElement} placeholder
   * @param {string} [theme]
   * @returns {Promise<boolean>}
   * @purity non-pure
   */
  renderPending(placeholder, theme) {
    const entry = this._pending.get(placeholder);
    if (!entry || !placeholder.isConnected) return Promise.resolve(false);
    if (!this.encoder) {
      this._pending.delete(placeholder);
      placeholder.replaceWith(this._encodingFailedElement());
      return Promise.resolve(false);
    }
    if (!this.askConsent()) return Promise.resolve(false);
    this._pending.delete(placeholder);
    return this._send(placeholder, entry.code, theme ?? entry.theme);
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
