// HelpLanguageSwitch: shows one language of the help modal (SC-16, FS-10).
// The help holds an English and a Japanese body (.help-body[lang]); the
// English | Japanese buttons ([data-help-lang]) choose which one is shown.
// The first language follows the browser's language. The choice is kept in
// this object only (memory): never stored, so a reload starts over (CON-03).

export const HELP_LANGUAGES = ["en", "ja"];

export default class HelpLanguageSwitch {
  /**
   * @param {HTMLElement} root  the help modal (#helpModal)
   * @param {string} browserLanguage  navigator.language, injected by main.js
   * @purity non-pure
   */
  constructor(root, browserLanguage) {
    this._bodies = new Map();
    this._buttons = new Map();
    for (const lang of HELP_LANGUAGES) {
      const bodies = root.querySelectorAll(`.help-body[lang="${lang}"]`);
      const buttons = root.querySelectorAll(`[data-help-lang="${lang}"]`);
      if (bodies.length !== 1 || buttons.length !== 1) {
        throw new Error(`HelpLanguageSwitch: need one body and one button for "${lang}"`);
      }
      this._bodies.set(lang, bodies[0]);
      this._buttons.set(lang, buttons[0]);
      buttons[0].addEventListener("click", () => this.setLanguage(lang));
    }
    this._language = null;
    this.setLanguage(HelpLanguageSwitch.initialLanguage(browserLanguage));
  }

  /**
   * "ja" when the browser's language is Japanese (ja, ja-JP), else "en".
   * @param {string} browserLanguage
   * @returns {"en"|"ja"}
   * @purity pure
   */
  static initialLanguage(browserLanguage) {
    const tag = String(browserLanguage ?? "").toLowerCase();
    return tag === "ja" || tag.startsWith("ja-") ? "ja" : "en";
  }

  /**
   * @returns {"en"|"ja"}
   * @purity semi-pure-a
   */
  get language() {
    return this._language;
  }

  /**
   * Show the body of lang and hide the other one.
   * @param {"en"|"ja"} lang
   * @purity non-pure
   */
  setLanguage(lang) {
    if (!this._bodies.has(lang)) return;
    this._language = lang;
    for (const [each, body] of this._bodies) body.hidden = each !== lang;
    for (const [each, button] of this._buttons) {
      button.setAttribute("aria-pressed", String(each === lang));
    }
  }
}
