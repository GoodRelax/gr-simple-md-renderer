import { EXT_TO_HLJS, FILE_SYSTEM_HANDLE_SUPPORTED } from "../config.js";
import { escapeHtml, formatDateTime, applyTheme, showToast } from "../utils.js";

/**
 * The highlight.js language of a file name (EXT_TO_HLJS: its extension, or
 * the whole name for Dockerfile and the like); null when it has none.
 * @purity semi-pure-a
 * @param {string} fileName
 * @returns {string|null}
 */
export function languageOfFileName(fileName) {
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";
  return EXT_TO_HLJS[ext] ?? EXT_TO_HLJS[fileName] ?? null;
}

/**
 * Take the code view's body out of the preview, its lines from the last
 * up. WebKit takes time growing with the square of the number of lines to
 * remove CSS-counter lines from the first down (a 1 MB file: about 40 s);
 * from the last up it is linear (M1). Nothing else in the preview changes.
 * @purity non-pure
 * @param {HTMLElement} previewEl
 */
export function releaseCodeView(previewEl) {
  const body = previewEl.querySelector("#codeViewBody");
  if (!body) return;
  while (body.lastChild) body.lastChild.remove();
  body.remove();
}

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
    this._file = null; // the File shown (name, size, date), for showText
    this._meta = null; // CodeViewMeta of the last _show
    this._lastScrollTop = 0;
  }

  /**
   * Initial render: read file, highlight, build code body, inject into previewEl.
   * @param {File} file
   * @param {FileSystemFileHandle|null} fileHandle
   * @param {'light'|'dark'} theme
   * @param {Function} [isCurrent] - () => false when another document was
   *   opened while the file was read or highlight.js awaited: nothing is shown
   * @param {string} [text] - the decoded LF text (INV-89); not given: file.text()
   * @returns {Promise<CodeViewMeta|null>} null when it is no longer current
   * @purity non-pure
   */
  async render(file, fileHandle, theme, isCurrent = () => true, text = undefined) {
    const shownText = text ?? (await file.text());
    await this._hljsReady();
    if (!isCurrent()) return null;
    this._fileHandle = fileHandle;
    this._fileName = file.name;
    this._file = file;
    this._lastScrollTop = 0;
    return this._show(shownText, file, theme);
  }

  /**
   * Show another text of the same file (the edited text, SC-27) where the
   * view is: the file name, size and date stay, the line count follows.
   * @param {string} text - LF text
   * @returns {CodeViewMeta|null} null when no file is shown
   * @purity non-pure
   */
  showText(text) {
    if (!this._file) return null;
    const scrollTop = window.scrollY;
    const metadata = this._show(text, this._file, null);
    window.scrollTo(0, scrollTop);
    return metadata;
  }

  /**
   * The file was saved (INV-90): Reload reads the written file, and the file
   * info shows its name, size and date. The view is not drawn again.
   * @param {File} file - name, size and lastModified of the written file
   * @param {FileSystemFileHandle} fileHandle
   * @returns {CodeViewMeta|null} null when no file is shown
   * @purity non-pure
   */
  retarget(file, fileHandle) {
    if (!this._file) return null;
    this._file = file;
    this._fileName = file.name;
    this._fileHandle = fileHandle;
    return { ...this._meta, fileName: file.name, fileSize: file.size, updatedAtStr: formatDateTime(file.lastModified) };
  }

  /**
   * Reload from fileHandle preserving scroll position.
   * Shows a toast if fileHandle is unavailable: the browser gives none, or
   * this file came without one (as the Markdown view says, release test N5).
   * @param {'light'|'dark'} theme
   * @param {Function} [isCurrent] - as for render
   * @param {Function} [readText] - (file) => Promise of the decoded LF text,
   *   in the encoding the file was opened with (INV-89); not given: file.text()
   * @returns {Promise<CodeViewMeta|null>} null if fileHandle is unavailable,
   *   or when it is no longer current
   * @purity non-pure
   */
  async reload(theme, isCurrent = () => true, readText = (file) => file.text()) {
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
    const text = await readText(file);
    await this._hljsReady();
    if (!isCurrent()) return null;
    this._file = file;
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
    // not while the editor takes the view's place (SC-27): the view is drawn
    // again when edit mode ends, colored then
    if (!this._shown || !this._hljs || !this._previewEl.querySelector("#codeViewBody")) return null;
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
   * The text colored by highlight.js for the code editor (INV-86): its HTML,
   * or null when highlight.js is not there (yet) or has no such language.
   * @param {string} text
   * @param {string|null} language - a highlight.js language id
   * @returns {string|null}
   * @purity semi-pure-a
   */
  highlightText(text, language) {
    if (!language || !this._hljs?.getLanguage(language)) return null;
    try {
      return this._hljs.highlight(text, { language }).value;
    } catch (_) {
      return null;
    }
  }

  /**
   * Clean up: clear previewEl, reset state.
   * @purity non-pure
   */
  destroy() {
    releaseCodeView(this._previewEl);
    this._previewEl.innerHTML = "";
    this._fileHandle = null;
    this._fileName = "";
    this._lastScrollTop = 0;
    this._shown = null;
    this._file = null;
    this._meta = null;
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
    releaseCodeView(this._previewEl);
    this._previewEl.innerHTML = html;
    if (theme) this._applyCodeTheme(theme);
    const plain = !this._hljs && this._loadHljs !== null;
    this._shown = plain ? { text, file } : null;
    if (plain) this._missing = true;
    this._meta = {
      fileName: file.name,
      fileSize: file.size,
      lineCount,
      language,
      updatedAtStr: formatDateTime(file.lastModified),
    };
    return this._meta;
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
    // Resolve highlight.js language ID
    const mapped = languageOfFileName(file.name);

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
