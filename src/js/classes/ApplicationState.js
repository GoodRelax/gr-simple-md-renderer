export default class ApplicationState {
  constructor() {
    this.currentTheme = "light";
    this.markdownText = "";
  }

  /** @param {string} theme */
  setTheme(theme) {
    this.currentTheme = theme;
  }

  /** @param {string} text */
  setMarkdownText(text) {
    this.markdownText = text;
  }
}
