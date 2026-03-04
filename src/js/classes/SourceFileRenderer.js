import hljs from "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/es/highlight.min.js";
import { EXT_TO_HLJS } from "../config.js";
import { escapeHtml, formatDateTime, applyTheme, showToast } from "../utils.js";

/**
 * Renders non-.md files with syntax highlighting and line numbers.
 * Owns: code body only. UI chrome (fileInfo, keyHint) is managed by UIController.
 * Returns CodeViewMeta for UIController to display.
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
  }

  /**
   * Initial render: read file, highlight, build code body, inject into previewEl.
   * @param {File} file
   * @param {FileSystemFileHandle|null} fileHandle
   * @param {'light'|'dark'} theme
   * @returns {Promise<CodeViewMeta>}
   */
  async render(file, fileHandle, theme) {
    this._fileHandle = fileHandle;
    this._fileName = file.name;
    this._lastScrollTop = 0;

    const text = await file.text();
    const { html, lineCount, language } = this._buildCodeBody(text, file);
    this._previewEl.innerHTML = html;
    this._applyCodeTheme(theme);

    return {
      fileName: file.name,
      fileSize: file.size,
      lineCount,
      language,
      updatedAtStr: formatDateTime(file.lastModified),
    };
  }

  /**
   * Reload from fileHandle preserving scroll position.
   * Shows a toast if fileHandle is unavailable.
   * @param {'light'|'dark'} theme
   * @returns {Promise<CodeViewMeta|null>} null if fileHandle is unavailable
   */
  async reload(theme) {
    if (!this._fileHandle) {
      showToast(
        this._cfg.codeView.reloadUnavailableMsg,
        this._cfg.codeView.toastDurationMs,
      );
      return null;
    }
    this._lastScrollTop = window.scrollY;
    const file = await this._fileHandle.getFile();
    const text = await file.text();
    const { html, lineCount, language } = this._buildCodeBody(text, file);
    this._previewEl.innerHTML = html;
    this._applyCodeTheme(theme);
    window.scrollTo(0, this._lastScrollTop);

    return {
      fileName: file.name,
      fileSize: file.size,
      lineCount,
      language,
      updatedAtStr: formatDateTime(file.lastModified),
    };
  }

  /**
   * Clean up: clear previewEl, reset state.
   */
  destroy() {
    this._previewEl.innerHTML = "";
    this._fileHandle = null;
    this._fileName = "";
    this._lastScrollTop = 0;
  }

  // ---- private helpers ----

  /**
   * Build the code body HTML string (no header, status bar, or key hint).
   * @param {string} text
   * @param {File} file
   * @returns {{ html: string, lineCount: number, language: string }}
   */
  _buildCodeBody(text, file) {
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

    const lineCount = text.split("\n").length;

    return {
      html: `<div id="codeViewBody">${lineHtml}</div>`,
      lineCount,
      language: lang || "plaintext",
    };
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
}
