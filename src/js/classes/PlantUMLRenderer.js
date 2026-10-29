import DiagramRenderer from "./DiagramRenderer.js";
import { CONFIG } from "../config.js";
import { replaceCodeBlock, queryAllIn } from "../utils.js";

const PLANTUML_SELECTOR = "code.language-plantuml, code.language-puml";

/**
 * Whether a diagram (its source in a theme) is among those that wait for
 * [Render] (keepRender, made by heldForRender()).
 * @purity pure
 * @param {Map<string, Set<string>>|null} keepRender - theme -> sources
 * @param {string} code
 * @param {string} theme
 * @returns {boolean}
 */
function isKeptForRender(keepRender, code, theme) {
  return keepRender?.get(theme)?.has(code) ?? false;
}

export default class PlantUMLRenderer extends DiagramRenderer {
  /**
   * PlantUML is drawn only after the four libraries are settled (spec 11-g
   * answering and settled, INV-81 (3), owner ruling AQ7): the encoder is then
   * ready or failed, never awaited. Before that (loading), hold() shows
   * "Loading diagram..." and runWaiting() deals with those boxes once, in
   * answering (its one dialog comes before the page is settled).
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
  }

  /**
   * Render the PlantUML blocks under root (the whole preview by default);
   * called after the libraries are settled (11-g runPlantUmlStep: in
   * answering for a partial render, in settled for any).
   * mode "consent" (full render): one confirm, then send (INV-02).
   * mode "placeholder" (partial render after an edit): send nothing and show
   * a pending box with a [Render] button instead (INV-23).
   * keepRender: diagrams (heldForRender keys) that wait for [Render] keep
   * waiting for it in any mode (a KaTeX redraw of a committed block, INV-02).
   * Without the encoder (it could not run) every block shows the encoding
   * error, and no dialog is shown.
   * @param {string} theme
   * @param {ParentNode|ParentNode[]} [root]
   * @param {"consent"|"placeholder"} [mode]
   * @param {Map<string, Set<string>>|null} [keepRender]
   * @purity non-pure
   */
  async render(theme, root = this.preview, mode = "consent", keepRender = null) {
    try {
      const blocks = queryAllIn(root, PLANTUML_SELECTOR);
      if (blocks.length === 0) return;

      if (!this.encoder) {
        for (const block of blocks) replaceCodeBlock(block, this._encodingFailedElement());
        return;
      }

      const asked = [];
      for (const block of blocks) {
        if (mode === "placeholder" || isKeptForRender(keepRender, block.textContent, theme)) {
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
      await Promise.allSettled(asked.map((block) => this._send(block, block.textContent, theme)));
    } catch (error) {
      console.error("PlantUML rendering error:", error);
    }
  }

  /**
   * Before the held boxes are dealt with (11-g holdPlantUml: loading, and a
   * "consent" step in answering): each PlantUML block under root shows
   * "Loading diagram..." (no dialog, nothing sent, not awaited). The box
   * remembers its source, theme and what comes later: the
   * dialog ("consent": a full render, or the redraw after KaTeX ran) or a
   * [Render] box ("placeholder": a partial render, INV-23). A diagram in
   * keepRender stays a [Render] one (INV-02: the redraw after KaTeX never
   * turns a committed diagram into one the dialog sends).
   * @param {string} theme
   * @param {ParentNode|ParentNode[]} [root]
   * @param {"consent"|"placeholder"} [mode]
   * @param {Map<string, Set<string>>|null} [keepRender]
   * @purity non-pure
   */
  hold(theme, root = this.preview, mode = "consent", keepRender = null) {
    for (const block of queryAllIn(root, PLANTUML_SELECTOR)) {
      const code = block.textContent;
      const later = mode === "placeholder" || isKeptForRender(keepRender, code, theme) ? "render" : "consent";
      const box = document.createElement("div");
      box.className = "plantuml-loading";
      box.textContent = CONFIG.messages.diagram.loading;
      this._waiting.set(box, { code, theme, later });
      replaceCodeBlock(block, box);
    }
  }

  /**
   * The diagrams the held boxes and the [Render] boxes in the preview keep
   * for [Render]: read before a KaTeX redraw replaces their blocks.
   * @returns {Map<string, Set<string>>} theme -> sources
   * @purity semi-pure-b
   */
  heldForRender() {
    const kept = new Map();
    /** @purity non-pure */
    const keep = ({ code, theme }) => {
      if (!kept.has(theme)) kept.set(theme, new Set());
      kept.get(theme).add(code);
    };
    for (const box of this.preview.querySelectorAll(".plantuml-loading")) {
      const entry = this._waiting.get(box);
      if (entry?.later === "render") keep(entry);
    }
    for (const box of this.preview.querySelectorAll(".plantuml-pending")) {
      const entry = this._pending.get(box);
      if (entry) keep(entry);
    }
    return kept;
  }

  /**
   * The libraries are settled (11-g runWaitingPlantUml, in answering): the
   * held boxes still in the preview are dealt with once. The "consent" ones
   * get one dialog: OK sends them, Cancel shows "not sent" (INV-03). The
   * "render" ones become [Render] boxes (INV-23). Without the encoder, every
   * box shows the encoding error and no dialog is shown. The boxes are taken,
   * the dialog asked and the requests started before the first await.
   * @returns {Promise<boolean>} false when no held box was there
   * @purity non-pure
   */
  async runWaiting() {
    const boxes = this._waitingBoxes();
    if (boxes.length === 0) return false;
    const asked = this._releaseHeld(boxes, "consent");
    if (asked.length === 0) return true;
    if (!this.askConsent()) {
      for (const { box } of asked) box.replaceWith(this._canceledElement());
      return true;
    }
    await Promise.allSettled(asked.map(({ box, code, theme }) => this._send(box, code, theme)));
    return true;
  }

  /**
   * Take held boxes out of the wait (the one place for runWaiting() and
   * turnHeldToRender()). Without the encoder each box shows the encoding
   * error. Otherwise a "render" box becomes a [Render] box (INV-23), and so
   * does a "consent" box when consentBoxes is "render"; when it is
   * "consent", those boxes are left in place and returned, to be asked about.
   * @param {HTMLElement[]} boxes - from _waitingBoxes()
   * @param {"consent"|"render"} consentBoxes - what the "consent" boxes wait for now
   * @returns {{box: HTMLElement, code: string, theme: string}[]} the boxes still to be asked about
   * @purity non-pure
   */
  _releaseHeld(boxes, consentBoxes) {
    const asked = [];
    for (const box of boxes) {
      const { code, theme, later } = this._waiting.get(box);
      this._waiting.delete(box);
      if (!this.encoder) box.replaceWith(this._encodingFailedElement());
      else if (later === "consent" && consentBoxes === "consent") asked.push({ box, code, theme });
      else box.replaceWith(this.createPendingElement(code, theme));
    }
    return asked;
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
   * The page is settled and an editor gave its block back (11-g
   * turnHeldPlantUmlToRender): a held box it had kept aside missed
   * runWaiting(), so it becomes a [Render] box without a dialog (INV-23).
   * Without the encoder it shows the encoding error.
   * @purity non-pure
   */
  turnHeldToRender() {
    this._releaseHeld(this._waitingBoxes(), "render");
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
   * Send one diagram whose consent was given, in place of target (a code
   * block, its <pre> goes too, or a box). The only place that makes the
   * server's image.
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
      replaceCodeBlock(target, this._encodingFailedElement());
      return Promise.resolve(false);
    }
    replaceCodeBlock(target, this.createWrapper(img));
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
