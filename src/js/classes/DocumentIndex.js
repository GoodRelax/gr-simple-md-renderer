// The Index of the Markdown view (INV-77, owner rulings 2026-10-25): the
// document's headings, listed in a panel that floats over the preview.
// Pressing an entry scrolls its heading to the top of the view. The list is
// built when the panel is shown, and again when the preview's blocks change
// while it is shown (a render, a commit, an Undo).

import { placeSidePanels, revealInView } from "../sidePanels.js";
import { nextFrame, cancelFrame } from "../utils.js";

/** The headings listed: only those the renderer's blocks hold (a
 * user-written .md-block is never a direct child of #preview). */
const HEADINGS = ":scope > .md-block > :is(h1, h2, h3, h4, h5, h6)";
/** Room between the top of the view and a heading the index scrolled to. */
const JUMP_MARGIN_PX = 8;

/**
 * The text of a heading for the index: math as its TeX source (KaTeX keeps
 * it in the annotation), everything else as plain text.
 * @purity semi-pure-a
 * @param {HTMLElement} heading
 * @returns {string}
 */
function headingText(heading) {
  const copy = heading.cloneNode(true);
  for (const math of copy.querySelectorAll(".katex")) {
    math.replaceWith(math.querySelector("annotation")?.textContent ?? "");
  }
  return copy.textContent.replace(/\s+/g, " ").trim();
}

export default class DocumentIndex {
  /**
   * @param {{button: HTMLButtonElement, panel: HTMLElement, column: HTMLElement, preview: HTMLElement, topbar: HTMLElement}} elements
   *   panel: in column (#sidePanels), outside #preview, so a press on it is
   *   not an edit gesture
   * @param {{emptyText: string}} options - emptyText: shown when there is no heading
   * @purity non-pure
   */
  constructor(elements, options) {
    this.button = elements.button;
    this.panel = elements.panel;
    this.column = elements.column;
    this.preview = elements.preview;
    this.topbar = elements.topbar;
    this._emptyText = options.emptyText;
    this._headings = [];
    this._buildFrame = 0;
    this._observer = new MutationObserver(() => this._scheduleBuild());
    this._onResize = () => placeSidePanels(this.column, this.preview, this.topbar);

    this.button.addEventListener("click", () => this.toggle());
    this.panel.addEventListener("click", (e) => this._onEntryClick(e));
  }

  /** @purity semi-pure-a */
  isShown() {
    return !this.panel.hidden;
  }

  /**
   * The index is for the Markdown view only; elsewhere the button is off.
   * @param {boolean} isAvailable
   * @purity non-pure
   */
  setAvailable(isAvailable) {
    this.button.disabled = !isAvailable;
    if (!isAvailable) this.hide();
  }

  /** @purity non-pure */
  toggle() {
    if (this.isShown()) this.hide();
    else this.show();
  }

  /** @purity non-pure */
  show() {
    if (this.button.disabled || this.isShown()) return;
    this._build();
    this.panel.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this._onResize();
    this._observer.observe(this.preview, { childList: true });
    window.addEventListener("resize", this._onResize);
  }

  /** @purity non-pure */
  hide() {
    if (!this.isShown()) return;
    this._observer.disconnect();
    window.removeEventListener("resize", this._onResize);
    cancelFrame(this._buildFrame);
    this._buildFrame = 0;
    this.panel.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    this.panel.replaceChildren();
    this._headings = [];
  }

  /**
   * Several block changes in one frame build the list once.
   * @purity non-pure
   */
  _scheduleBuild() {
    if (this._buildFrame) return;
    /** @purity non-pure */
    this._buildFrame = nextFrame(() => {
      this._buildFrame = 0;
      this._build();
    });
  }

  /**
   * One entry per non-empty heading, in document order; the panel keeps its
   * own scroll position.
   * @purity non-pure
   */
  _build() {
    const entries = [];
    this._headings = [];
    for (const heading of this.preview.querySelectorAll(HEADINGS)) {
      const text = headingText(heading);
      if (!text) continue;
      const entry = document.createElement("button");
      entry.type = "button";
      entry.className = `index-entry index-${heading.tagName.toLowerCase()}`;
      entry.dataset.entry = String(this._headings.length);
      entry.textContent = text;
      entries.push(entry);
      this._headings.push(heading);
    }
    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "index-empty";
      empty.textContent = this._emptyText;
      entries.push(empty);
    }
    const scrollTop = this.panel.scrollTop;
    this.panel.replaceChildren(...entries);
    this.panel.scrollTop = scrollTop;
  }

  /**
   * A press outside the block editor commits it first (INV-30), so the
   * heading may have been rendered again: then the list is built now.
   * @param {MouseEvent} e
   * @purity non-pure
   */
  _onEntryClick(e) {
    const entry = e.target.closest?.(".index-entry");
    if (!entry) return;
    const n = Number(entry.dataset.entry);
    if (!this._headings[n]?.isConnected) this._build();
    const heading = this._headings[n];
    if (heading) this._scrollToTop(heading);
  }

  /**
   * @param {HTMLElement} heading
   * @purity non-pure
   */
  _scrollToTop(heading) {
    revealInView(this.preview, this.topbar, heading.getBoundingClientRect().top, 0, JUMP_MARGIN_PX);
  }
}
