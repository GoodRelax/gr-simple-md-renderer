/**
 * Links from the clipboard (INV-69) and the URL condition they share with
 * the link notation of a table cell (INV-72 (a)). The clipboard is read
 * inside the browser only; nothing is fetched.
 */
export default class ClipboardLink {
  /**
   * The URL condition of INV-69: without the spaces around it, one line
   * that new URL() reads, with one of the schemes, at most maxLength long.
   * @purity pure
   * @param {string} text
   * @param {string[]} schemes - CONFIG.edit.linkSchemes ("https:", ...)
   * @param {number} maxLength - CONFIG.edit.maxPastedUrlLength
   * @returns {boolean}
   */
  static isLinkableUrl(text, schemes, maxLength) {
    if (typeof text !== "string") return false;
    const s = text.trim();
    if (s === "" || s.length > maxLength || /[\r\n]/.test(s)) return false;
    let url;
    try {
      url = new URL(s);
    } catch {
      return false;
    }
    return schemes.includes(url.protocol);
  }
}
