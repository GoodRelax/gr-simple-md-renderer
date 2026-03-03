export default class ScrollManager {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.useDocumentScroll = window.matchMedia(
      "(any-pointer: coarse)",
    ).matches;
  }

  /** @returns {number} */
  save() {
    return this.useDocumentScroll
      ? window.scrollY
      : this.container.scrollTop;
  }

  /** @param {number} pos */
  restore(pos) {
    if (this.useDocumentScroll) {
      window.scrollTo(0, pos);
    } else {
      this.container.scrollTop = pos;
    }
  }
}
