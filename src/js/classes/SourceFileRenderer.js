import { EXT_TO_HLJS, FILE_SYSTEM_HANDLE_SUPPORTED } from "../config.js";
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
   * @param {object|null} hljs - highlight.js (shared with MarkdownRenderer); null: loadHljs gives it
   * @param {boolean} [fileHandleSupported] - a drop gives a file handle (CON-01)
   * @param {Function|null} [loadHljs] - () => Promise of highlight.js; the code view waits for it
   *   (owner ruling 2026-10-25), at most config.codeView.highlightWaitMs (INV-81 (3))
   * @purity non-pure
   */
  constructor(config, previewEl, hljs, fileHandleSupported = FILE_SYSTEM_HANDLE_SUPPORTED, loadHljs = null) {
    this._cfg = config;
    this._fileHandleSupported = fileHandleSupported;
    this._previewEl = previewEl;
    this._hljs = hljs;
    this._loadHljs = loadHljs;
    this._shown = null; // { text, file } of the code shown plain while highlight.js is awaited
    this._missing = false; // shown plain since the last takeMissingLibraries
    this._fileHandle = null;
    this._fileName = "";
    this._lastScrollTop = 0;
  }

  /**
   * Initial render: read file, highlight, build code body, inject into previewEl.
   * @param {File} file
   * @param {FileSystemFileHandle|null} fileHandle
   * @param {'light'|'dark'} theme
   * @param {Function} [isCurrent] - () => false when another document was
   *   opened while the file was read or highlight.js awaited: nothing is shown
   * @returns {Promise<CodeViewMeta|null>} null when it is no longer current
   * @purity non-pure
   */
  async render(file, fileHandle, theme, isCurrent = () => true) {
    const text = await file.text();
    await this._hljsReady();
    if (!isCurrent()) return null;
    this._fileHandle = fileHandle;
    this._fileName = file.name;
    this._lastScrollTop = 0;
    return this._show(text, file, theme);
  }

  /**
   * Reload from fileHandle preserving scroll position.
   * Shows a toast if fileHandle is unavailable: the browser gives none, or
   * this file came without one (as the Markdown view says, release test N5).
   * @param {'light'|'dark'} theme
   * @param {Function} [isCurrent] - as for render
   * @returns {Promise<CodeViewMeta|null>} null if fileHandle is unavailable,
   *   or when it is no longer current
   * @purity non-pure
   */
  async reload(theme, isCurrent = () => true) {
    if (!this._fileHandle) {
      const codeView = this._cfg.codeView;
      showToast(
        this._fileHandleSupported ? codeView.reloadNoFileMsg : codeView.reloadUnavailableMsg,
        codeView.toastDurationMs,
      );
      return null;
    }
    this._lastScrollTop = window.scrollY;
    const file = await this._fileHandle.getFile();
    const text = await file.text();
    await this._hljsReady();
    if (!isCurrent()) return null;
    const metadata = this._show(text, file, theme);
    window.scrollTo(0, this._lastScrollTop);
    return metadata;
  }

  /**
   * The code shown plain (highlight.js came too late) colored now, where
   * the view is; null when there is nothing to color.
   * @returns {CodeViewMeta|null}
   * @purity non-pure
   */
  recolor() {
    if (!this._shown || !this._hljs) return null;
    const { text, file } = this._shown;
    const scrollTop = window.scrollY;
    const metadata = this._show(text, file, null);
    window.scrollTo(0, scrollTop);
    return metadata;
  }

  /**
   * Whether the code was shown plain for want of highlight.js since the
   * last call (INV-81 (3)).
   * @returns {string[]}
   * @purity non-pure
   */
  takeMissingLibraries() {
    const names = this._missing ? ["hljs"] : [];
    this._missing = false;
    return names;
  }

  /**
   * Clean up: clear previewEl, reset state.
   * @purity non-pure
   */
  destroy() {
    this._previewEl.innerHTML = "";
    this._fileHandle = null;
    this._fileName = "";
    this._lastScrollTop = 0;
    this._shown = null;
  }

  /**
   * @param {string} name
   * @param {object} library
   * @purity non-pure
   */
  useLibrary(name, library) {
    if (name === "hljs") this._hljs = library;
  }

  // ---- private helpers ----

  /**
   * Show the code body; the theme is kept when it is null (recolor).
   * @param {string} text
   * @param {File} file
   * @param {'light'|'dark'|null} theme
   * @returns {CodeViewMeta}
   * @purity non-pure
   */
  _show(text, file, theme) {
    const { html, lineCount, language } = this._buildCodeBody(text, file);
    this._previewEl.innerHTML = html;
    if (theme) this._applyCodeTheme(theme);
    const plain = !this._hljs && this._loadHljs !== null;
    this._shown = plain ? { text, file } : null;
    if (plain) this._missing = true;
    return {
      fileName: file.name,
      fileSize: file.size,
      lineCount,
      language,
      updatedAtStr: formatDateTime(file.lastModified),
    };
  }

  /**
   * highlight.js, once it has run, waited for at most
   * config.codeView.highlightWaitMs; past that (or when it cannot load) the
   * code is shown plain and colored when it comes (recolor).
   * @purity non-pure
   */
  async _hljsReady() {
    if (this._hljs || !this._loadHljs) return;
    let timer = 0;
    /** @purity non-pure */
    const limit = new Promise((resolve) => (timer = setTimeout(() => resolve(null), this._cfg.codeView.highlightWaitMs)));
    try {
      const hljs = await Promise.race([this._loadHljs(), limit]);
      if (hljs) this._hljs = hljs;
    } catch (error) {
      console.error("highlight.js could not be loaded:", error);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Build the code body HTML string (no header, status bar, or key hint).
   * @param {string} text
   * @param {File} file
   * @returns {{ html: string, lineCount: number, language: string }}
   * @purity semi-pure-a
   */
  _buildCodeBody(text, file) {
    const fileName = file.name;

    // Resolve highlight.js language ID
    const ext = fileName.includes(".")
      ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase()
      : "";
    const mapped = EXT_TO_HLJS[ext] ?? EXT_TO_HLJS[fileName] ?? null;

    // Highlight only languages present in the bundle. Unknown extensions and
    // languages missing from the bundle are shown as plaintext (no
    // highlightAuto: it is slow on large files and guesses unreliably).
    let lang = mapped && this._hljs?.getLanguage(mapped) ? mapped : null;
    let highlighted;
    try {
      highlighted = lang
        ? this._hljs.highlight(text, { language: lang }).value
        : escapeHtml(text);
    } catch (_) {
      lang = null;
      highlighted = escapeHtml(text);
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
   * @purity pure
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
   * @purity non-pure
   */
  _applyCodeTheme(theme) {
    applyTheme(theme);
  }
}
