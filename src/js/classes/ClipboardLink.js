import { CONFIG } from "../config.js";
import InlineRuns from "./InlineRuns.js";

// INV-69: characters a URL to link must not hold (new URL() would drop or
// encode them, so what is checked would not be what is written): C0 controls
// (the tab too), DEL, C1 controls, any white space (\s: NBSP, the line and
// paragraph separators...), the soft hyphen, the bidirectional controls
// (U+061C, U+200E / 200F, U+202A to 202E, U+2066 to 2069), the deprecated
// format characters (U+206A to 206F), U+180E, the zero width characters
// (U+200B to 200D, U+2060 to 2064) and U+FEFF.
const NOT_IN_URL = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]|\s/;

/**
 * Links from the clipboard (INV-69) and the URL condition they share with
 * the link notation of a table cell (INV-72 (a)). The clipboard is read
 * inside the browser only; nothing is fetched (no page title, ruling V2).
 */
export default class ClipboardLink {
  /**
   * The URL condition of INV-69: without the spaces around it, no control,
   * white space or invisible character (NOT_IN_URL), that new URL() reads,
   * with one of the schemes, at most maxLength long. The checked string is
   * the one written (toDestination).
   * @purity pure
   * @param {string} text
   * @param {string[]} schemes - CONFIG.edit.linkSchemes ("https:", ...)
   * @param {number} maxLength - CONFIG.edit.maxPastedUrlLength
   * @returns {boolean}
   */
  static isLinkableUrl(text, schemes, maxLength) {
    if (typeof text !== "string") return false;
    const s = text.trim();
    if (s === "" || s.length > maxLength || NOT_IN_URL.test(s)) return false;
    let url;
    try {
      url = new URL(s);
    } catch {
      return false;
    }
    return schemes.includes(url.protocol);
  }

  /**
   * The URL condition's settings (CONFIG.edit.linkSchemes / maxPastedUrlLength).
   * @purity semi-pure-a
   * @returns {{schemes: string[], maxLength: number}}
   */
  static urlOptions() {
    return { schemes: CONFIG.edit.linkSchemes, maxLength: CONFIG.edit.maxPastedUrlLength };
  }

  /**
   * The format op that puts a link to url on a selection (InlineRuns /
   * MarkdownTextOps.formatRange): an inline link to toDestination(url);
   * url is also the new text of a bare URL or an autolink there.
   * strictEnds: the Ctrl+V link (not inside a code span, an HTML tag or a
   * link destination; INV-69 (iii)).
   * @purity pure
   * @param {string} url
   * @param {boolean} [strictEnds]
   * @returns {{kind: "link", link: object, url: string, strictEnds: boolean}}
   */
  static linkOp(url, strictEnds = false) {
    const text = String(url).trim();
    return { kind: "link", link: InlineRuns.inlineLink(ClipboardLink.toDestination(text)), url: text, strictEnds };
  }

  /**
   * The paste's URL (INV-69, Ctrl+V / Cmd+V): its text/plain only, read
   * synchronously (no permission); null when that is not a URL.
   * @purity semi-pure-b
   * @param {ClipboardEvent|null} event
   * @param {{schemes: string[], maxLength: number}} options
   * @returns {string|null} the URL without the spaces around it
   */
  static urlFromPasteEvent(event, { schemes, maxLength }) {
    const data = event?.clipboardData;
    if (!data || typeof data.getData !== "function") return null;
    const text = data.getData("text/plain");
    return ClipboardLink.isLinkableUrl(text, schemes, maxLength) ? text.trim() : null;
  }

  /**
   * The button's read (INV-69): the URL from the clipboard's text/plain and,
   * when its text/html has exactly one a element with that href, that
   * element's text. clipboard.read() is used when there is one, else
   * readText(); a refused or failed read is not asked again. The HTML is
   * parsed into an inert document (no script runs, no image loads) and only
   * text is taken from it; it never goes into the page.
   * @purity non-pure
   * @param {Clipboard|null|undefined} clipboard - navigator.clipboard (a fake in tests)
   * @param {{schemes: string[], maxLength: number, parseHtml?: (html: string) => Document}} options
   * @returns {Promise<{url: string, text: string|null}|null>} null: no URL, refused or failed
   */
  static async readUrlAndText(clipboard, { schemes, maxLength, parseHtml = ClipboardLink._parseHtml }) {
    if (!clipboard) return null;
    let plainText = null;
    let html = null;
    try {
      if (typeof clipboard.read === "function") {
        for (const item of (await clipboard.read()) ?? []) {
          const types = [...(item.types ?? [])];
          if (plainText === null && types.includes("text/plain")) plainText = await (await item.getType("text/plain")).text();
          if (html === null && types.includes("text/html")) html = await (await item.getType("text/html")).text();
        }
      } else if (typeof clipboard.readText === "function") {
        plainText = await clipboard.readText();
      } else {
        return null;
      }
    } catch {
      return null; // refused (NotAllowedError) or failed
    }
    if (!ClipboardLink.isLinkableUrl(plainText, schemes, maxLength)) return null;
    const url = plainText.trim();
    return { url, text: html ? ClipboardLink.linkTextOf(html, url, parseHtml) : null };
  }

  /**
   * The text of the one a element of html whose href is url (newlines as
   * spaces, without the spaces around it), or null (none, more than one,
   * or an empty text).
   * @purity semi-pure-b
   * @param {string} html
   * @param {string} url
   * @param {(html: string) => Document} [parseHtml]
   * @returns {string|null}
   */
  static linkTextOf(html, url, parseHtml = ClipboardLink._parseHtml) {
    let doc;
    try {
      doc = parseHtml(html);
    } catch {
      return null;
    }
    /** @purity pure */
    const isUrl = (a) => ClipboardLink._sameUrl(a.getAttribute("href"), url);
    const anchors = [...doc.querySelectorAll("a[href]")].filter(isUrl);
    if (anchors.length !== 1) return null;
    const text = anchors[0].textContent.replace(/\r\n?|\n/g, " ").trim();
    return text === "" ? null : text;
  }

  /**
   * A link destination for the user's URL string (INV-69): not normalized
   * by new URL(); "\" as %5C; with "<", ">" or unbalanced parentheses it is
   * written <...> with "<" ">" as %3C %3E. A URL that passed isLinkableUrl
   * has no white space. In a table cell the pipes are written \| by the
   * writer (InlineRuns).
   * @purity pure
   * @param {string} url
   * @returns {string}
   */
  static toDestination(url) {
    const s = String(url).trim().replace(/\\/g, "%5C");
    if (!/[<>]/.test(s) && ClipboardLink._balanced(s)) return s;
    return `<${s.replace(/</g, "%3C").replace(/>/g, "%3E")}>`;
  }

  /**
   * @purity pure
   */
  static _balanced(s) {
    let depth = 0;
    for (const ch of s) {
      if (ch === "(") depth++;
      else if (ch === ")" && --depth < 0) return false;
    }
    return depth === 0;
  }

  /**
   * An href attribute that is url (as written, or as new URL() reads both).
   * @purity pure
   */
  static _sameUrl(href, url) {
    if (typeof href !== "string") return false;
    const h = href.trim();
    if (h === url) return true;
    try {
      return new URL(h).href === new URL(url).href;
    } catch {
      return false;
    }
  }

  /**
   * An inert document: DOMParser runs no script and loads no image.
   * @purity semi-pure-b
   */
  static _parseHtml(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }
}
