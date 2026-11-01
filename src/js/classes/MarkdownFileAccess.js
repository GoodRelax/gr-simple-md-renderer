import { CONFIG } from "../config.js";
import SaveTrace, { typeOf } from "./SaveTrace.js";

// How long a download's blob: URL stays valid after the click. There is no
// need to revoke it at once: a minute leaves the browser all the time it
// may take to read the blob (a margin; spec 5.14.7).
const DOWNLOAD_URL_LIFETIME_MS = 60000;

/**
 * Local file read and write for Markdown documents and code files (Adapter,
 * spec 5.14.7, INV-90).
 * Uses only the File System Access API and blob: downloads: no network
 * (CON-14) and no browser storage (CON-13).
 * INV-109: each step of a save (the save dialog, the permission request,
 * createWritable, write, close) writes one line to the console (SaveTrace).
 */
export default class MarkdownFileAccess {
  /**
   * @purity non-pure
   * @param {{showSaveFilePicker?: Function}} [win] - window (injected for tests)
   * @param {() => object} [traceEnvironment] - SaveTrace.environment (injected for tests)
   */
  constructor(win = window, traceEnvironment = SaveTrace.environment) {
    this._win = win;
    this._lastFile = null; // INV-79: the last file dropped or chosen in this tab (memory only), or null: none yet
    this._traceEnvironment = traceEnvironment;
    this._traces = new WeakMap(); // INV-109: file handle -> the SaveTrace of the save that will write it
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
    let trace = null;
    try {
      trace = this._startTrace({ id: null, startIn: null, type: typeOf(fileHandle.name ?? ""), names: [fileHandle.name] });
      this._traces.set(fileHandle, trace);
      if (typeof fileHandle.requestPermission !== "function") return Promise.resolve("granted");
      return Promise.resolve(fileHandle.requestPermission({ mode: "readwrite" })).then(
        /** @purity non-pure */
        (state) => {
          trace.permission(state);
          return state;
        },
        /** @purity non-pure */
        (error) => {
          trace.fail("permission", error);
          throw error;
        },
      );
    } catch (error) {
      trace?.fail("permission", error);
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
   * @param {object[]} [types] - the file types offered; default: Markdown.
   *   An empty list offers all files only (a code file without an extension)
   * @param {string[]} [otherNames] - more names to keep out of the log (INV-109 (4))
   * @returns {Promise<object>} the chosen FileSystemFileHandle
   */
  startSavePicker(suggestedName, types = [{ description: CONFIG.messages.edit.saveFileType, accept: { "text/markdown": [".md"] } }], otherNames = []) {
    let trace = null;
    try {
      const options = { id: CONFIG.edit.savePickerId, suggestedName };
      if (types.length > 0) options.types = types;
      if (this._lastFile) options.startIn = this._lastFile;
      trace = this._startTrace({ id: Boolean(options.id), startIn: Boolean(options.startIn), type: typeOf(types), names: [suggestedName, ...otherNames] });
      return Promise.resolve(this._win.showSaveFilePicker(options)).then(
        /** @purity non-pure */
        (handle) => {
          trace.addName(handle?.name);
          trace.ok("picker");
          if (handle && typeof handle === "object") this._traces.set(handle, trace);
          this.noteFile(handle);
          return handle;
        },
        /** @purity non-pure */
        (error) => {
          trace.fail("picker", error);
          throw error;
        },
      );
    } catch (error) {
      trace?.fail("picker", error);
      return Promise.reject(error);
    }
  }

  /**
   * Read a file for Reload: the first bytes (to judge the BOM), the decoded
   * text (File.text() drops the BOM) and lastModified. check(file) runs
   * before anything is read (the open checks by name and size, INV-18 (1)
   * (4)); what it throws rejects the read.
   * @purity semi-pure-b
   * @param {object} fileHandle
   * @param {(file: File) => void} [check]
   * @returns {Promise<{bytesHead: Uint8Array, text: string, lastModified: number}>}
   */
  async readFile(fileHandle, check = () => undefined) {
    const file = await fileHandle.getFile();
    check(file);
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
   * INV-109: createWritable, write and close each log a line, in the trace
   * of the save that started this write (a new one without it).
   * @purity non-pure
   * @param {object} fileHandle
   * @param {string|Uint8Array} data - the text, or the encoded bytes of a code file (INV-90)
   * @returns {Promise<number|null>} lastModified after the write, or null
   */
  async writeFile(fileHandle, data) {
    const trace =
      this._traces.get(fileHandle) ??
      this._startTrace({ id: null, startIn: null, type: typeOf(fileHandle.name ?? ""), names: [fileHandle.name] });
    this._traces.delete(fileHandle);
    let writable;
    try {
      writable = await fileHandle.createWritable();
    } catch (error) {
      trace.fail("createWritable", error);
      throw error;
    }
    trace.ok("createWritable");
    let step = "write";
    try {
      await writable.write(data);
      trace.ok("write");
      step = "close";
      await writable.close();
      trace.ok("close");
    } catch (error) {
      trace.fail(step, error);
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
   * INV-109: a new trace; its clock starts now (at the press). When it
   * cannot be made, a silent one: the log never changes the save (INV-109 (6)).
   * @purity non-pure
   * @param {object} context - see SaveTrace
   * @returns {SaveTrace|object}
   */
  _startTrace(context) {
    try {
      return new SaveTrace(context, this._traceEnvironment());
    } catch {
      return SaveTrace.silent();
    }
  }

  /**
   * Download a file through a blob: URL: a .md text by default, or the
   * bytes of a code file with their own type (INV-90). The link is clicked
   * synchronously (inside the press handler, INV-33); the URL is revoked a
   * minute later (DOWNLOAD_URL_LIFETIME_MS), when the browser has read it.
   * @purity non-pure
   * @param {string} suggestedName
   * @param {string|Uint8Array} data
   * @param {string} [mimeType]
   */
  startDownload(suggestedName, data, mimeType = "text/markdown;charset=utf-8") {
    const blob = new Blob([data], { type: mimeType });
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
