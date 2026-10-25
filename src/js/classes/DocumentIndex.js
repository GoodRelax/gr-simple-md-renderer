// The Index of the Markdown view (INV-77, owner rulings 2026-10-25): the
// document's headings, listed in a panel that floats over the preview.
// Pressing an entry scrolls its heading to the top of the view. The list is
// built when the panel is shown; while it is shown, the entries of the
// top-level blocks that changed (a render, a commit, an Undo) are built
// again, and the others are kept (INV-77 (2), performance).

import { placeSidePanels } from "../sidePanels.js";
import { nextFrame, cancelFrame } from "../utils.js";

/** A heading's tag (h1 to h6), read on the children of a block the renderer made (a user-written .md-block is never a direct child of #preview). */
const HEADING_TAG = /^H[1-6]$/;
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

/**
 * A top-level block of the preview: the renderer's wrapper.
 * @purity semi-pure-a
 * @param {Node} node
 * @returns {boolean}
 */
function isBlock(node) {
  return node.nodeType === Node.ELEMENT_NODE && node.classList.contains("md-block");
}

/**
 * Order of sort for siblings: the later one first.
 * @purity semi-pure-a
 * @param {Node} a
 * @param {Node} b
 * @returns {number}
 */
function laterFirst(a, b) {
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
}

export default class DocumentIndex {
  /**
   * @param {{button: HTMLButtonElement, panel: HTMLElement, column: HTMLElement, preview: HTMLElement}} elements
   *   panel: in column (#sidePanels), outside #preview, so a press on it is
   *   not an edit gesture
   * @param {ScrollMemento} scrollMemento - where the view is and how it scrolls
   * @param {{emptyText: string}} options - emptyText: shown when there is no heading
   * @purity non-pure
   */
  constructor(elements, scrollMemento, options) {
    this.button = elements.button;
    this.panel = elements.panel;
    this.column = elements.column;
    this.preview = elements.preview;
    this.scrollMemento = scrollMemento;
    this._empty = document.createElement("p"); // shown when there is no heading
    this._empty.className = "index-empty";
    this._empty.textContent = options.emptyText;
    this._entries = new Map(); // block -> its entries (buttons), for the blocks with headings
    this._headingOf = new WeakMap(); // entry -> its heading
    this._records = []; // block changes not yet applied
    this._buildFrame = 0; // the frame that applies them (a nextFrame id), or 0: none asked for
    /** @purity non-pure */
    this._observer = new MutationObserver((records) => {
      this._records.push(...records);
      if (!this._buildFrame) this._buildFrame = nextFrame(() => this._applyChanges());
    });
    this._onResize = () => placeSidePanels(this.column, this.scrollMemento);

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
    this._records = [];
    this.panel.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    this.panel.replaceChildren();
    this._entries.clear();
  }

  /**
   * The whole list, in document order; the panel keeps its own scroll
   * position.
   * @purity non-pure
   */
  _build() {
    this._entries.clear();
    const all = document.createDocumentFragment();
    for (let block = this.preview.firstElementChild; block; block = block.nextElementSibling) {
      if (!isBlock(block)) continue;
      const entries = this._entriesOf(block);
      if (entries.length > 0) {
        this._entries.set(block, entries);
        for (const entry of entries) all.append(entry);
      }
    }
    const scrollTop = this.panel.scrollTop;
    this.panel.replaceChildren(all);
    this._showEmptyIfNone();
    this.panel.scrollTop = scrollTop;
  }

  /**
   * The block changes since the last frame: the entries of the blocks gone
   * are removed, and those of the blocks come are put before the entries of
   * the next block that has some (one commit builds the entries of the
   * blocks it changed, not the whole list; INV-77 (2)). The blocks come are
   * taken from the last up, so the blocks after each already have their
   * entries, and the walk to the next one with entries is short. When every
   * block is new (a full render), the list is built whole.
   * @purity non-pure
   */
  _applyChanges() {
    this._buildFrame = 0;
    const records = this._records;
    this._records = [];
    const added = new Set();
    for (const record of records) {
      for (const node of record.removedNodes) {
        for (const entry of this._entries.get(node) ?? []) entry.remove();
        this._entries.delete(node);
      }
      for (const node of record.addedNodes) if (isBlock(node)) added.add(node);
    }
    if (added.size > 0 && added.size >= this.preview.childElementCount) {
      this._build();
      return;
    }
    const blocks = [...added].filter((block) => block.parentNode === this.preview);
    blocks.sort(laterFirst);
    for (const block of blocks) {
      const entries = this._entriesOf(block);
      if (entries.length === 0) continue;
      this._entries.set(block, entries);
      this.panel.insertBefore(this._fragment(entries), this._firstEntryAfter(block));
    }
    this._showEmptyIfNone();
  }

  /**
   * One entry per non-empty heading of a block.
   * @param {HTMLElement} block
   * @returns {HTMLButtonElement[]}
   * @purity non-pure
   */
  _entriesOf(block) {
    const entries = [];
    for (const heading of block.children) {
      if (!HEADING_TAG.test(heading.tagName)) continue;
      const text = headingText(heading);
      if (!text) continue;
      const entry = document.createElement("button");
      entry.type = "button";
      entry.className = `index-entry index-${heading.tagName.toLowerCase()}`;
      entry.textContent = text;
      this._headingOf.set(entry, heading);
      entries.push(entry);
    }
    return entries;
  }

  /**
   * @param {HTMLElement[]} nodes
   * @returns {DocumentFragment}
   * @purity semi-pure-a
   */
  _fragment(nodes) {
    const fragment = document.createDocumentFragment();
    for (const node of nodes) fragment.append(node);
    return fragment;
  }

  /**
   * The first entry of the blocks after block, or null: none (at the end).
   * @param {HTMLElement} block
   * @returns {HTMLButtonElement|null}
   * @purity semi-pure-a
   */
  _firstEntryAfter(block) {
    for (let next = block.nextElementSibling; next; next = next.nextElementSibling) {
      const entries = this._entries.get(next);
      if (entries) return entries[0];
    }
    return null;
  }

  /**
   * The empty text when the list has no entry, and only then.
   * @purity non-pure
   */
  _showEmptyIfNone() {
    if (this._entries.size > 0) {
      this._empty.remove();
    } else if (this._empty.parentNode !== this.panel) {
      this.panel.append(this._empty);
    }
  }

  /**
   * A press outside the block editor commits it first (INV-30), so the
   * heading may have been rendered again before the list follows: then the
   * list is built now and the entry at the same place is used.
   * @param {MouseEvent} e
   * @purity non-pure
   */
  _onEntryClick(e) {
    const entry = e.target.closest?.(".index-entry");
    if (!entry) return;
    let heading = this._headingOf.get(entry);
    if (!heading?.isConnected) {
      const n = [...this.panel.children].indexOf(entry);
      this._build();
      heading = this._headingOf.get(this.panel.children[n]);
    }
    if (heading) this.scrollMemento.scrollTargetTo(heading, JUMP_MARGIN_PX);
  }
}
