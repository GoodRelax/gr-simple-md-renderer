import { nextFrame } from "../utils.js";

// INV-70: characters that look like a space or like nothing. ZWJ (U+200D)
// and the variation selectors are not here: an emoji stays one glyph.
const MARKED_RUN = /[\u00a0\u2007\u202f\u200b\u200c\u2060\ufeff\u00ad]+/g;
const LINE_END_SPACES = / {2,}$/;
const OVERLAID_CLASS = "md-block-editor-overlaid";

/**
 * The marks layer behind a block editor (INV-70). A textarea cannot color
 * its characters, so the same text is drawn in a layer right behind it,
 * with the same font, size, padding and wrapping (style.css), and the marked
 * characters get a background there. The layer is built from text nodes
 * and elements only (the user's text is never read as HTML), is inert,
 * hidden from assistive technology, takes no pointer, and its text is
 * transparent. It is drawn again at most once per frame; above maxChars
 * there is no layer (and no marks).
 */
export default class InvisibleCharOverlay {
  /**
   * @param {HTMLTextAreaElement} textarea - in its wrapper, which is positioned
   * @param {object} [options]
   * @param {number} [options.maxChars] - CONFIG.edit.invisibleMarkMaxChars
   * @param {((text: string) => boolean[])|null} [options.lineEndMarks] - per line: mark the
   *   line end spaces (INV-71 blocks); null for none
   * @param {(fn: () => void) => void} [options.requestFrame]
   * @purity non-pure
   */
  constructor(textarea, options = {}) {
    this.textarea = textarea;
    this.maxChars = options.maxChars ?? Infinity;
    this.lineEndMarks = options.lineEndMarks ?? null;
    this.requestFrame = options.requestFrame ?? nextFrame;
    this._layer = null;
    this._observer = null;
    this._attached = false;
    this._framePending = false;
    this._onChange = () => this.refresh();
  }

  /**
   * The parts of text, marked or not; neighbours of the same kind are one
   * part.
   * @purity pure
   * @param {string} text
   * @param {boolean[]} lineEndFlags - per line: mark its end spaces (two or more)
   * @returns {{text: string, mark: boolean}[]}
   */
  static segments(text, lineEndFlags = []) {
    const out = [];
    /** @purity pure */
    const push = (part, mark) => {
      if (part === "") return;
      const last = out[out.length - 1];
      if (last && last.mark === mark) last.text += part;
      else out.push({ text: part, mark });
    };
    const lines = text.split("\n");
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n];
      if (n > 0) push("\n", false);
      let body = line;
      let tail = "";
      const end = lineEndFlags[n] ? LINE_END_SPACES.exec(line) : null;
      if (end) {
        body = line.slice(0, end.index);
        tail = end[0];
      }
      let last = 0;
      for (const m of body.matchAll(MARKED_RUN)) {
        push(body.slice(last, m.index), false);
        push(m[0], true);
        last = m.index + m[0].length;
      }
      push(body.slice(last), false);
      push(tail, true);
    }
    return out;
  }

  /**
   * Draw the layer and follow the editor's input and size (a ResizeObserver
   * on the editor: its width also changes without a window resize; the
   * window's resize event where there is none).
   * @purity non-pure
   */
  attach() {
    if (this._attached) return;
    this._attached = true;
    this.textarea.addEventListener("input", this._onChange);
    if (typeof ResizeObserver === "function") {
      this._observer = new ResizeObserver(this._onChange);
      this._observer.observe(this.textarea);
    } else {
      window.addEventListener("resize", this._onChange);
    }
    this._draw();
  }

  /**
   * Remove the layer and the listeners; a frame already asked for draws nothing.
   * @purity non-pure
   */
  detach() {
    if (!this._attached) return;
    this._attached = false;
    this.textarea.removeEventListener("input", this._onChange);
    if (this._observer) this._observer.disconnect();
    else window.removeEventListener("resize", this._onChange);
    this._observer = null;
    this._removeLayer();
  }

  /**
   * Draw again in the next frame (once, however many changes come before it).
   * @purity non-pure
   */
  refresh() {
    if (!this._attached || this._framePending) return;
    this._framePending = true;
    /** @purity non-pure */
    this.requestFrame(() => {
      this._framePending = false;
      if (this._attached) this._draw();
    });
  }

  // ---- internals ----

  /**
   * @purity non-pure
   */
  _draw() {
    const value = this.textarea.value;
    if (value.length > this.maxChars) {
      this._removeLayer();
      return;
    }
    if (!this._layer) this._createLayer();
    const flags = this.lineEndMarks ? this.lineEndMarks(value) : [];
    /** @purity non-pure */
    const nodes = InvisibleCharOverlay.segments(value, flags).map((part) => {
      if (!part.mark) return document.createTextNode(part.text);
      const span = document.createElement("span");
      span.className = "grsmd-invisible";
      span.textContent = part.text;
      return span;
    });
    this._layer.replaceChildren(...nodes);
    this._place();
  }

  /**
   * @purity non-pure
   */
  _createLayer() {
    const layer = document.createElement("div");
    layer.className = "md-invisible-overlay";
    layer.setAttribute("inert", "");
    layer.setAttribute("aria-hidden", "true");
    this.textarea.before(layer);
    this.textarea.classList.add(OVERLAID_CLASS);
    this._layer = layer;
  }

  /**
   * @purity non-pure
   */
  _removeLayer() {
    this._layer?.remove();
    this._layer = null;
    this.textarea.classList.remove(OVERLAID_CLASS);
  }

  /**
   * The layer covers the editor exactly (the editor's height follows its
   * content, INV-40, so there is no scroll to follow).
   * @purity non-pure
   */
  _place() {
    const { textarea } = this;
    const style = this._layer.style;
    style.top = `${textarea.offsetTop}px`;
    style.left = `${textarea.offsetLeft}px`;
    style.width = `${textarea.offsetWidth}px`;
    style.height = `${textarea.offsetHeight}px`;
  }
}
