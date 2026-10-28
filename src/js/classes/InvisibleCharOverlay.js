import { nextFrame } from "../utils.js";
import MarkdownTextOps from "./MarkdownTextOps.js";
import { EDITOR_PADDING_PROPS, EDITOR_TEXT_PROPS } from "../editorTextStyle.js";

// INV-70: characters that look like a space or like nothing. ZWJ (U+200D)
// and the variation selectors are not here: an emoji stays one glyph.
const MARKED_RUN = /[\u00a0\u2007\u202f\u200b\u200c\u2060\ufeff\u00ad]+/g;
const OVERLAID_CLASS = "md-block-editor-overlaid";
// The text style a block editor can take from its block (INV-83), set on
// the editor itself: the layer takes the same.
const MATCHED_PROPS = [...EDITOR_TEXT_PROPS, ...EDITOR_PADDING_PROPS];

/**
 * The marks layer behind a block editor (INV-70). A textarea cannot color
 * its characters, so the same text is drawn in a layer right behind it,
 * with the same font, size, padding and wrapping (style.css, and the text
 * style the editor takes from its block, INV-83), and the marked
 * characters get a background there. The layer is built from text nodes
 * and elements only (the user's text is never read as HTML), is inert,
 * hidden from assistive technology, takes no pointer, and its text is
 * transparent. It is drawn in the next frame, and again at most once per
 * frame after an input (the first draw too: opening an editor forces no
 * second layout, INV-51); a change of the editor's size only moves the
 * layer. Above maxChars characters, or maxMarks marks, there is no layer
 * (and no marks); with no mark there is none either (it would show only
 * the editor's own background, and its layout costs a frame for a large
 * text such as a long table's source, INV-51).
 */
export default class InvisibleCharOverlay {
  /**
   * @param {HTMLTextAreaElement} textarea - in its wrapper, which is positioned
   * @param {object} [options]
   * @param {number} [options.maxChars] - CONFIG.edit.invisibleMarkMaxChars
   * @param {number} [options.maxMarks] - CONFIG.edit.invisibleMarkMaxMarks
   * @param {((text: string) => boolean[])|null} [options.lineEndMarks] - per line: mark the
   *   line end spaces (INV-71 blocks); null for none
   * @param {(fn: () => void) => void} [options.requestFrame]
   * @purity non-pure
   */
  constructor(textarea, options = {}) {
    this.textarea = textarea;
    this.maxChars = options.maxChars ?? Infinity;
    this.maxMarks = options.maxMarks ?? Infinity;
    this.lineEndMarks = options.lineEndMarks ?? null;
    this.requestFrame = options.requestFrame ?? nextFrame;
    this._layer = null;
    this._observer = null;
    this._attached = false;
    this._pending = null; // what the asked-for frame does: "draw", or "place" (a size change)
    this._onChange = () => this.refresh();
    this._onResize = () => this._schedule("place");
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
      const end = lineEndFlags[n] ? MarkdownTextOps.lineBreakSpaceCount(line) : 0;
      if (end > 0) {
        body = line.slice(0, line.length - end);
        tail = line.slice(line.length - end);
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
   * Draw the layer in the next frame and follow the editor's input and size
   * (a ResizeObserver on the editor: its width also changes without a
   * window resize; the window's resize event where there is none).
   * @purity non-pure
   */
  attach() {
    if (this._attached) return;
    this._attached = true;
    this.textarea.addEventListener("input", this._onChange);
    if (typeof ResizeObserver === "function") {
      this._observer = new ResizeObserver(this._onResize);
      this._observer.observe(this.textarea);
    } else {
      window.addEventListener("resize", this._onResize);
    }
    this.refresh();
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
    else window.removeEventListener("resize", this._onResize);
    this._observer = null;
    this._removeLayer();
  }

  /**
   * Draw again in the next frame (once, however many changes come before it).
   * @purity non-pure
   */
  refresh() {
    this._schedule("draw");
  }

  // ---- internals ----

  /**
   * Ask for one frame: a draw, or only a placing when the text did not
   * change (the size did); a draw also places.
   * @purity non-pure
   * @param {"draw"|"place"} what
   */
  _schedule(what) {
    if (!this._attached) return;
    if (this._pending) {
      if (what === "draw") this._pending = "draw";
      return;
    }
    this._pending = what;
    /** @purity non-pure */
    this.requestFrame(() => {
      const pending = this._pending;
      this._pending = null;
      if (!this._attached) return;
      if (pending === "draw") this._draw();
      else if (this._layer) this._place();
    });
  }

  /**
   * @purity non-pure
   */
  _draw() {
    const value = this.textarea.value;
    if (value.length > this.maxChars) {
      this._removeLayer();
      return;
    }
    const flags = this.lineEndMarks ? this.lineEndMarks(value) : [];
    const parts = InvisibleCharOverlay.segments(value, flags);
    let marks = 0;
    for (const part of parts) if (part.mark) marks++;
    if (marks === 0 || marks > this.maxMarks) {
      // none: the layer would show only the editor's own background, and
      // laying out a copy of a large text costs a frame (INV-51);
      // too many: as many elements as marks, typing would wait for them (INV-70)
      this._removeLayer();
      return;
    }
    if (!this._layer) this._createLayer();
    /** @purity non-pure */
    const nodes = parts.map((part) => {
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
    for (const prop of MATCHED_PROPS) layer.style[prop] = this.textarea.style[prop];
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
