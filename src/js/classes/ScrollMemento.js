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
}
