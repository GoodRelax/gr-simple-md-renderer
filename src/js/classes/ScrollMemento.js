export default class ScrollMemento {
  /**
   * @param {HTMLElement} container
   * @purity non-pure
   */
  constructor(container) {
    this.container = container;
    this.useDocumentScroll = window.matchMedia(
      "(any-pointer: coarse)",
    ).matches;
  }

  /**
   * @returns {number}
   * @purity semi-pure-b
   */
  save() {
    return this.useDocumentScroll
      ? window.scrollY
      : this.container.scrollTop;
  }

  /**
   * @param {number} pos
   * @purity non-pure
   */
  restore(pos) {
    if (this.useDocumentScroll) {
      window.scrollTo(0, pos);
    } else {
      this.container.scrollTop = pos;
    }
  }

  /**
   * Where the element's top is in the viewport now (INV-46).
   * @param {Element|null} element
   * @returns {{offsetTop: number}|null}
   * @purity semi-pure-b
   */
  captureAnchor(element) {
    if (!element) return null;
    return { offsetTop: element.getBoundingClientRect().top };
  }

  /**
   * Scroll so that the element's top is back where captureAnchor saw it.
   * No element or no anchor: nothing changes (spec 5.14.9).
   * @param {{offsetTop: number}|null} anchor
   * @param {Element|null} element - found by the caller from anchorBlockId
   * @purity non-pure
   */
  restoreAnchor(anchor, element) {
    if (!anchor || !element) return;
    const delta = element.getBoundingClientRect().top - anchor.offsetTop;
    if (delta === 0) return;
    if (this.useDocumentScroll) {
      window.scrollTo(0, window.scrollY + delta);
    } else {
      this.container.scrollTop += delta;
    }
  }
}
