import hljs from "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/es/highlight.min.js";
import { EXT_TO_HLJS } from "../config.js";
import { escapeHtml, formatDateTime, formatTime, applyTheme, showToast } from "../utils.js";

/**
 * Renders non-.md files with syntax highlighting and line numbers.
 * Owns: header bar, code body, status bar, keyboard hint overlay.
 */
export default class SourceFileRenderer {
  /**
   * @param {object} config  - global CONFIG object
   * @param {HTMLElement} previewEl - #preview element
   */
  constructor(config, previewEl) {
    this._cfg = config;
    this._previewEl = previewEl;
    this._fileHandle = null;
    this._fileName = "";
    this._lastScrollTop = 0;
    this._keyHintTimer = null;
  }

  /**
   * Initial render: read file, highlight, build DOM, inject into previewEl.
   * @param {File} file
   * @param {FileSystemFileHandle|null} fileHandle
   * @param {'light'|'dark'} theme
   */
  async render(file, fileHandle, theme) {
    this._fileHandle = fileHandle;
    this._fileName = file.name;
    this._lastScrollTop = 0;

    const text = await file.text();
    this._previewEl.innerHTML = this._buildDOM(text, file, new Date());
    this._applyCodeTheme(theme);
    this._scheduleKeyHintFade();
  }

  /**
   * Reload from fileHandle preserving scroll position.
   * Shows a toast if fileHandle is unavailable.
   * @param {'light'|'dark'} theme
   */
  async reload(theme) {
    if (!this._fileHandle) {
      showToast(
        this._cfg.codeView.reloadUnavailableMsg,
        this._cfg.codeView.toastDurationMs,
      );
      return;
    }
    this._lastScrollTop = window.scrollY;
    const file = await this._fileHandle.getFile();
    const text = await file.text();
    this._previewEl.innerHTML = this._buildDOM(text, file, new Date());
    this._applyCodeTheme(theme);
    window.scrollTo(0, this._lastScrollTop);
  }

  /**
   * Clean up: clear previewEl, cancel timers, reset state.
   */
  destroy() {
    clearTimeout(this._keyHintTimer);
    this._keyHintTimer = null;
    this._previewEl.innerHTML = "";
    this._fileHandle = null;
    this._fileName = "";
    this._lastScrollTop = 0;
  }

  // ---- private helpers ----

  /**
   * Build the full code view HTML string.
   * @param {string} text
   * @param {File} file
   * @param {Date} loadedAt
   * @returns {string}
   */
  _buildDOM(text, file, loadedAt) {
    const fileName = file.name;

    // Resolve highlight.js language ID
    const ext = fileName.includes(".")
      ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase()
      : "";
    const lang = EXT_TO_HLJS[ext] ?? EXT_TO_HLJS[fileName] ?? null;

    // Syntax highlight
    let highlighted;
    try {
      highlighted = lang
        ? hljs.highlight(text, { language: lang }).value
        : hljs.highlightAuto(text).value;
    } catch (_) {
      // Language not in hljs common bundle; fall back to auto-detection
      try {
        highlighted = hljs.highlightAuto(text).value;
      } catch (_e) {
        highlighted = escapeHtml(text);
      }
    }

    // Split into lines, properly reopening/closing spans at boundaries
    const lines = this._splitHighlightedLines(highlighted);

    const lineHtml = lines
      .map((line) => `<span class="code-line">${line}</span>`)
      .join("");

    // Format metadata
    const ts = formatDateTime(file.lastModified);
    const sizeStr = file.size.toLocaleString() + " bytes";
    const lineCount = text.split("\n").length;
    const sizeKb = (file.size / 1024).toFixed(2);
    const loadedStr = formatTime(loadedAt);
    const safeFileName = escapeHtml(fileName);

    return (
      `<div id="codeViewHeader">` +
      `[CODE VIEW]  ${safeFileName}  |  ${ts}  |  ${sizeStr}` +
      `</div>` +
      `<div id="codeViewBody">${lineHtml}</div>` +
      `<div id="codeViewKeyHint">` +
      `[up][dn] scroll   [l] light   [d] dark   [c] clear   [n] new tab` +
      `</div>` +
      `<div id="codeViewStatusBar">` +
      `${safeFileName}  |  ${lineCount.toLocaleString()} lines  |  ${sizeKb} KB  |  Loaded: ${loadedStr}` +
      `</div>`
    );
  }

  /**
   * Split highlight.js HTML output by newlines, properly closing and
   * reopening <span> tags at each line boundary so line wrapping is valid.
   * @param {string} html
   * @returns {string[]}
   */
  _splitHighlightedLines(html) {
    const rawLines = html.split("\n");
    const result = [];
    let openSpans = []; // stack of open <span ...> strings

    for (const rawLine of rawLines) {
      // Prepend any spans still open from the previous line
      const prefix = openSpans.join("");

      // Update the open-span stack for this line
      const tagRe = /<span[^>]*>|<\/span>/g;
      let m;
      while ((m = tagRe.exec(rawLine)) !== null) {
        if (m[0].startsWith("</")) {
          openSpans.pop();
        } else {
          openSpans.push(m[0]);
        }
      }

      // Close all currently open spans at end of line
      const suffix = openSpans.map(() => "</span>").join("");

      result.push(prefix + rawLine + suffix);
    }

    return result;
  }

  /**
   * Apply theme to body and code view background.
   * @param {'light'|'dark'} theme
   */
  _applyCodeTheme(theme) {
    applyTheme(theme);
  }

  /**
   * Schedule fade-out and removal of #codeViewKeyHint.
   */
  _scheduleKeyHintFade() {
    const hint = document.getElementById("codeViewKeyHint");
    if (!hint) return;
    this._keyHintTimer = setTimeout(() => {
      hint.style.opacity = "0";
      hint.addEventListener("transitionend", () => hint.remove(), {
        once: true,
      });
    }, this._cfg.codeView.keyHintDurationMs);
  }
}
