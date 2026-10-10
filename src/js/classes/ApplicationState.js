export default class ApplicationState {
  /** @purity non-pure */
  constructor() {
    this.currentTheme = "light";
    this.markdownText = "";
  }

  /**
   * @param {string} theme
   * @purity non-pure
   */
  setTheme(theme) {
    this.currentTheme = theme;
  }

  /**
   * @param {string} text
   * @purity non-pure
   */
  setMarkdownText(text) {
    this.markdownText = text;
  }
}
