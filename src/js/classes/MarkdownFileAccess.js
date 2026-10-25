import { CONFIG } from "../config.js";

// How long a download's blob: URL stays valid after the click. There is no
// need to revoke it at once: a minute leaves the browser all the time it
// may take to read the blob (a margin; spec 5.14.7).
const DOWNLOAD_URL_LIFETIME_MS = 60000;

/**
 * Local file read and write for Markdown documents (Adapter, spec 5.14.7).
 * Uses only the File System Access API and blob: downloads: no network
 * (CON-14) and no browser storage (CON-13).
 */
export default class MarkdownFileAccess {
  /**
   * @purity non-pure
   * @param {{showSaveFilePicker?: Function}} [win] - window (injected for tests)
   */
  constructor(win = window) {
    this._win = win;
    this._lastFile = null; // INV-79: the last file dropped or chosen in this tab (memory only), or null: none yet
  }

  /**
   * INV-79: remember where the user's file is, so the next save dialog
   * starts in its folder. Memory only: nothing is stored.
   * @purity non-pure
   * @param {object|null} fileHandle
   */
  noteFile(fileHandle) {
    if (fileHandle) this._lastFile = fileHandle;
  }

  /**
   * True when the browser can write a chosen file in place (Chrome / Edge).
   * @purity semi-pure-a
   * @returns {boolean}
   */
  canWriteInPlace() {
    return typeof this._win.showSaveFilePicker === "function";
  }

  /**
   * Start the write-permission request. Call it synchronously inside the
   * press handler, before any await, so the user activation is still valid (INV-33).
   * @purity non-pure
   * @param {object} fileHandle
   * @returns {Promise<string>} "granted" | "denied" | "prompt"
   */
  startPermissionRequest(fileHandle) {
    try {
      if (typeof fileHandle.requestPermission !== "function") return Promise.resolve("granted");
      return fileHandle.requestPermission({ mode: "readwrite" });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Open the save dialog. Call it synchronously inside the press handler (INV-33).
   * INV-79: it starts in the folder of the last file noted in this tab
   * (startIn); without one, where the browser last saved with this dialog's
   * id (the browser remembers that by itself). The chosen file is noted.
   * @purity non-pure
   * @param {string} suggestedName
   * @returns {Promise<object>} the chosen FileSystemFileHandle
   */
  startSavePicker(suggestedName) {
    try {
      const options = {
        id: CONFIG.edit.savePickerId,
        suggestedName,
        types: [{ description: CONFIG.messages.edit.saveFileType, accept: { "text/markdown": [".md"] } }],
      };
      if (this._lastFile) options.startIn = this._lastFile;
      /** @purity non-pure */
      return Promise.resolve(this._win.showSaveFilePicker(options)).then((handle) => {
        this.noteFile(handle);
        return handle;
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Read a file for Reload: the first bytes (to judge the BOM), the decoded
   * text (File.text() drops the BOM) and lastModified.
   * @purity semi-pure-b
   * @param {object} fileHandle
   * @returns {Promise<{bytesHead: Uint8Array, text: string, lastModified: number}>}
   */
  async readFile(fileHandle) {
    const file = await fileHandle.getFile();
    const bytesHead = new Uint8Array(await file.slice(0, 3).arrayBuffer());
    const text = await file.text();
    return { bytesHead, text, lastModified: file.lastModified };
  }

  /**
   * @purity semi-pure-b
   * @param {object} fileHandle
   * @returns {Promise<number>} lastModified of the file on disk (NotFoundError passes through)
   */
  async readLastModified(fileHandle) {
    const file = await fileHandle.getFile();
    return file.lastModified;
  }

  /**
   * Write the whole file. On a failed write or close the writable is aborted
   * before the error is passed on, so no partial file is left open; an abort
   * that fails too does not hide that error. Once the file is written, a
   * failure to read its new lastModified gives null instead of an error: the
   * save itself succeeded (the baseline becomes unknown, INV-39).
   * @purity non-pure
   * @param {object} fileHandle
   * @param {string} fileText
   * @returns {Promise<number|null>} lastModified after the write, or null
   */
  async writeFile(fileHandle, fileText) {
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(fileText);
      await writable.close();
    } catch (error) {
      try {
        await writable.abort();
      } catch {
        // the write or close error is the one to report
      }
      throw error;
    }
    try {
      return await this.readLastModified(fileHandle);
    } catch {
      return null;
    }
  }

  /**
   * Download fileText as a .md file through a blob: URL. The link is clicked
   * synchronously (inside the press handler, INV-33); the URL is revoked a
   * minute later (DOWNLOAD_URL_LIFETIME_MS), when the browser has read it.
   * @purity non-pure
   * @param {string} suggestedName
   * @param {string} fileText
   */
  startDownload(suggestedName, fileText) {
    const blob = new Blob([fileText], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = suggestedName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
  }
}
