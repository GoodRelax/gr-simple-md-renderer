import { CONFIG } from "../config.js";
import { decodeFileBytes, decodeAs, detectBom, countLineEndings, hasMixedLineEndings } from "../textEncoding.js";
import { inferIndentUnit } from "../indentText.js";
import { foldJsonOnce, unfoldJsonOnce } from "../jsonFold.js";
import CodeDocument, { singleLineEnding } from "./CodeDocument.js";
import CodeEditHistory from "./CodeEditHistory.js";
import { languageOfFileName } from "./SourceFileRenderer.js";

// An extension the save dialog accepts as a file type (NE-8); others are
// offered as "all files" only.
const PICKER_EXTENSION = /^\.[A-Za-z0-9+]{1,15}$/;

/**
 * True for a name the Markdown view opens (NE-19).
 * @purity pure
 * @param {string} name
 * @returns {boolean}
 */
function isMarkdownName(name) {
  return name.toLowerCase().endsWith(".md");
}

/**
 * The code document while the code view is shown (UI layer; SC-27): reading
 * a file with the open dialog (INV-89), Reload in its encoding, Save and
 * Save as with the encoding question (INV-90, NE-24), the stop on
 * characters the encoding cannot write, the write through MarkdownFileAccess
 * (permission, overwrite check, save dialog, download; INV-33, INV-39) and
 * the reopen of a file saved as .md in the Markdown view (NE-19).
 *
 * Edit mode (INV-85 to INV-88): [Edit] / e makes the whole file one
 * CodeEditor; its Undo history lives as long as the document (kept across
 * edit modes, new on open and Reload). The document follows the editor's
 * text at every change, so Save writes it and the unsaved mark follows it.
 * JSON fold (INV-92): in the view the shown text only (not unsaved), in
 * the editor the text itself, as one undo step.
 *
 * CodeEditHost (the port it calls back, UIController):
 *   toast(message), confirmOverwrite(reason) -> Promise<boolean> (INV-39),
 *   codeFileSaved(file, fileHandle, languageChanged) (the file info follows
 *   the written file; languageChanged: Save as gave a name of another language),
 *   reopenAsMarkdown(file, fileHandle) -> Promise (NE-19),
 *   codeEditModeChanged(isEditing) (the palette, Search and the Index follow),
 *   showCodeText(text, isEdited) (the view shows this text; isEdited: the
 *   file info's line count follows it), codeTextChanged() (the unsaved
 *   mark), codeTextSettled() (typing stopped or a fold: Search and the
 *   Index follow).
 */
export default class CodeEditController {
  /**
   * @purity non-pure
   * @param {MarkdownFileAccess} fileAccess
   * @param {CodeFileDialog} dialog
   * @param {object} host - CodeEditHost
   * @param {object} [editing] - createEditor(editorHost) -> CodeEditor (without
   *   it there is no edit mode); highlight(text, language) -> string|null
   *   (SourceFileRenderer.highlightText); now: the clock of the Undo steps
   */
  constructor(fileAccess, dialog, host, editing = {}) {
    this._fileAccess = fileAccess;
    this._dialog = dialog;
    this._host = host;
    this._createEditor = editing.createEditor ?? null;
    this._highlight = editing.highlight ?? (() => null);
    this._document = null; // CodeDocument
    this._fileHandle = null; // the file to write in place, or null
    this._generation = 0; // a new document (open, close, reload) since a save started
    this._saving = false; // a save runs, from its encoding question to its end (INV-54)
    this._editor = null; // the CodeEditor, made at the first edit
    this._displayText = null; // the view's text with JSON folds (INV-92), or null: the document's
    this._history = new CodeEditHistory({
      limit: CONFIG.edit.undoMaxSteps,
      pauseMs: CONFIG.codeEdit.undoPauseMs,
      ...(editing.now ? { now: editing.now } : {}),
    });
  }

  /**
   * @purity semi-pure-b
   * @returns {CodeDocument|null}
   */
  get document() {
    return this._document;
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean}
   */
  hasDocument() {
    return this._document !== null;
  }

  /**
   * The name the palette status shows.
   * @purity semi-pure-b
   * @returns {string}
   */
  fileName() {
    return this._document?.fileName ?? "";
  }

  /**
   * The text that Save writes: the document's (the editor's while editing).
   * @purity semi-pure-b
   * @returns {string}
   */
  currentText() {
    return this._document?.text ?? "";
  }

  /**
   * The document's text changed (the editor).
   * @purity non-pure
   * @param {string} text - LF text
   */
  updateText(text) {
    if (this._document) this._document = this._document.withText(text);
  }

  /**
   * Unsaved: the text differs from the text at the last load or save.
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isDirty() {
    return this._document !== null && this._document.isDirty();
  }

  /**
   * INV-54: a save of the code document runs.
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isSaving() {
    return this._saving;
  }

  /**
   * What the file info line shows besides the file (INV-89), or null.
   * @purity semi-pure-b
   * @returns {{encoding: string, bom: boolean, lineEndingMode: string}|null}
   */
  fileInfo() {
    const d = this._document;
    return d ? { encoding: d.encoding, bom: d.bom, lineEndingMode: d.lineEndingMode } : null;
  }

  /**
   * The highlight.js language of the document's file (EXT_TO_HLJS), or
   * "plaintext".
   * @purity semi-pure-b
   * @returns {string}
   */
  language() {
    return (this._document && languageOfFileName(this._document.fileName)) || "plaintext";
  }

  /**
   * The JSON fold applies (INV-92).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isJson() {
    return this.language() === "json";
  }

  /**
   * The code view is in edit mode (INV-85).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isEditing() {
    return this._editor !== null && this._editor.isActive();
  }

  /**
   * The editor while editing, else null (Search edits through it, INV-80).
   * @purity semi-pure-b
   * @returns {CodeEditor|null}
   */
  get editor() {
    return this.isEditing() ? this._editor : null;
  }

  /**
   * The text shown now: the editor's while editing, else the view's (with
   * its folds). The Index lists it (INV-91).
   * @purity semi-pure-b
   * @returns {string}
   */
  shownText() {
    if (this.isEditing()) return this._editor.text();
    return this._displayText ?? this.currentText();
  }

  /**
   * [Edit] / e in the code view (INV-85): into edit mode, or back to the view.
   * @purity non-pure
   */
  toggleEdit() {
    if (this.isEditing()) this.leaveEdit();
    else this._enterEdit();
  }

  /**
   * Edit mode starts on the document's text (the view's folds are dropped,
   * INV-92).
   * @purity non-pure
   */
  _enterEdit() {
    if (!this._document || !this._createEditor) return;
    this._editor ??= this._createEditor(this._editorHost());
    this._displayText = null;
    this._editor.start(this._document.text, this._history);
    this._host.codeEditModeChanged(true);
  }

  /**
   * Back to the view, which shows the edited text; the document keeps it
   * (unsaved stays as it is).
   * @purity non-pure
   */
  leaveEdit() {
    if (!this.isEditing()) return;
    const text = this._editor.stop();
    this.updateText(text);
    this._host.showCodeText(text, true);
    this._host.codeEditModeChanged(false);
  }

  /**
   * Edit mode ends without drawing the view (the code view is left, or
   * drawn anew by the caller).
   * @purity non-pure
   */
  _stopEditing() {
    if (!this.isEditing()) return;
    this.updateText(this._editor.stop());
    this._host.codeEditModeChanged(false);
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean}
   */
  canUndo() {
    return this.isEditing() && this._editor.canUndo();
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean}
   */
  canRedo() {
    return this.isEditing() && this._editor.canRedo();
  }

  /**
   * Undo in the editor (INV-88; the palette's Undo, the keys outside it).
   * @purity non-pure
   * @returns {boolean} true when a step was undone
   */
  undo() {
    return this.isEditing() && this._editor.undo();
  }

  /**
   * @purity non-pure
   * @returns {boolean} true when a step was redone
   */
  redo() {
    return this.isEditing() && this._editor.redo();
  }

  /**
   * Fold or unfold one level of a JSON file (INV-92, NE-21, NE-22): in the
   * editor its text, as one undo step; in the view the text shown only.
   * Not JSON, not readable as JSON, or nothing to do: a toast, nothing
   * changes.
   * @purity non-pure
   * @param {"fold"|"unfold"} direction
   */
  fold(direction) {
    if (!this._document) return;
    const m = CONFIG.messages.codeEdit;
    if (!this.isJson()) {
      this._host.toast(m.foldJsonOnly);
      return;
    }
    const source = this.shownText();
    const result =
      direction === "fold" ? foldJsonOnce(source) : unfoldJsonOnce(source, inferIndentUnit(source, CONFIG.codeEdit.defaultIndent));
    if (result.error) {
      this._host.toast(m.foldInvalid);
      return;
    }
    if (!result.changed) {
      this._host.toast(direction === "fold" ? m.nothingToFold : m.nothingToUnfold);
      return;
    }
    if (this.isEditing()) {
      const caret = Math.min(this._editor.input.selectionStart, result.text.length);
      this._editor.setText(result.text, caret, caret);
      this._host.codeTextSettled();
      return;
    }
    this._displayText = result.text;
    this._host.showCodeText(result.text, false);
  }

  /**
   * CodeEditorHost (the port the editor calls back).
   * @purity non-pure
   * @returns {object}
   */
  _editorHost() {
    return {
      highlight: (text) => this._highlight(text, this.language()),
      canFold: () => this.isJson(),
      onFold: (direction) => this.fold(direction),
      /** @purity non-pure */
      onTextChanged: (text) => {
        this.updateText(text);
        this._host.codeTextChanged();
      },
      onTextSettled: () => this._host.codeTextSettled(),
    };
  }

  // ---- opening (INV-89) ----

  /**
   * Read a dropped file: decode it, and ask with the open dialog when it is
   * not valid UTF-8 or mixes line endings (NE-15, NE-25). Nothing changes
   * here: the caller opens the result (opened) after its own questions.
   * @purity non-pure
   * @param {File} file
   * @returns {Promise<CodeDocument|null>} null when the dialog was canceled
   */
  async read(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded = decodeFileBytes(bytes);
    const counts = countLineEndings(decoded.text);
    const mixed = hasMixedLineEndings(counts);
    let encoding = decoded.encoding;
    let lineEndingMode = singleLineEnding(counts);
    let text = decoded.text;
    if (!decoded.valid || mixed) {
      const choice = await this._dialog.askOpen({ fileName: file.name, bytes, decoded, counts, mixed });
      if (!choice) return null;
      encoding = choice.encoding;
      lineEndingMode = choice.lineEndingMode;
      if (encoding !== decoded.encoding) text = decodeAs(bytes, encoding);
    }
    return CodeDocument.fromDecoded({
      fileName: file.name,
      lastModified: file.lastModified,
      text,
      encoding,
      bom: detectBom(bytes) === encoding,
      lineEndingMode,
    });
  }

  /**
   * The code view shows this document now. The next save dialog starts in
   * its folder (INV-79).
   * @purity non-pure
   * @param {CodeDocument} codeDocument
   * @param {object|null} fileHandle
   */
  opened(codeDocument, fileHandle) {
    this._stopEditing();
    this._generation++;
    this._displayText = null;
    this._history.reset(codeDocument.text, 0, 0);
    this._document = codeDocument;
    this._fileHandle = fileHandle ?? null;
    this._fileAccess.noteFile(fileHandle ?? null);
  }

  /**
   * The code view is left (Clear, a Markdown document): no code document.
   * @purity non-pure
   */
  close() {
    this._stopEditing();
    this._generation++;
    this._displayText = null;
    this._history.reset("", 0, 0);
    this._document = null;
    this._fileHandle = null;
  }

  /**
   * Reload in the encoding the file was opened with, keeping its line
   * ending mode; no dialog. readText decodes (for SourceFileRenderer.reload);
   * commit makes the read document the current one, once the view has
   * shown it (nothing changes when the reload went stale).
   * @purity non-pure
   * @returns {{readText: (file: File) => Promise<string>, commit: () => void}}
   */
  reloadReader() {
    const generation = this._generation;
    let next = null;
    return {
      /** @purity non-pure */
      readText: async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const current = this._document;
        if (!current) return decodeAs(bytes, "utf-8");
        next = current.withReloaded(decodeAs(bytes, current.encoding), file.lastModified, detectBom(bytes) === current.encoding);
        return next.text;
      },
      /** @purity non-pure */
      commit: () => {
        if (!next || generation !== this._generation) return;
        this._stopEditing();
        this._generation++;
        this._displayText = null;
        this._history.reset(next.text, 0, 0);
        this._document = next;
      },
    };
  }

  // ---- saving (INV-90) ----

  /**
   * Save: overwrite the file (as Save as without one). The write access
   * starts inside the key or button press (INV-33), or inside the click of
   * the encoding question.
   * @purity non-pure
   * @returns {Promise<void>} settles when the save has finished
   */
  save() {
    return this._save(false);
  }

  /**
   * Save as: the save dialog, starting with the file's own name and
   * extension (NE-8).
   * @purity non-pure
   * @returns {Promise<void>}
   */
  saveAs() {
    return this._save(true);
  }

  /**
   * @purity non-pure
   * @param {boolean} isSaveAs
   * @returns {Promise<void>}
   */
  async _save(isSaveAs) {
    const doc = this._document;
    if (!doc) return;
    if (this._saving) {
      this._host.toast(CONFIG.messages.edit.savingInProgress);
      return;
    }
    this._saving = true;
    const generation = this._generation;
    let reopen = null;
    try {
      let encoding = this._knownEncoding(doc, isSaveAs);
      let remember = false;
      if (encoding === null) {
        const answer = await this._dialog.askSaveEncoding(doc.encoding);
        if (!answer || generation !== this._generation) return;
        encoding = answer === "original" ? doc.encoding : "utf-8";
        remember = !isSaveAs;
      }
      reopen = await this._write({ isSaveAs, encoding, generation, remember });
    } catch (error) {
      console.error("Save error:", error);
      this._host.toast(CONFIG.messages.edit.saveFailed);
    } finally {
      this._saving = false;
    }
    if (reopen) await this._host.reopenAsMarkdown(reopen.file, reopen.fileHandle);
  }

  /**
   * The encoding to write without asking (NE-24): UTF-8 for a UTF-8 file,
   * Save's remembered choice; null: ask (Save as always asks).
   * @purity pure
   * @param {CodeDocument} doc
   * @param {boolean} isSaveAs
   * @returns {string|null}
   */
  _knownEncoding(doc, isSaveAs) {
    if (doc.encoding === "utf-8") return "utf-8";
    if (isSaveAs || !doc.saveEncoding) return null;
    return doc.saveEncoding === "original" ? doc.encoding : "utf-8";
  }

  /**
   * Encode and write. Synchronous up to the start of the permission request,
   * the save dialog or the download (INV-33). Characters the chosen encoding
   * cannot write stop the save before any of them; a .md name is written in
   * UTF-8 (NE-30), known after the save dialog for Save as.
   * Save's answer to the encoding question is remembered once the file is
   * written in it (NE-24): a save stopped or canceled asks again.
   * @purity non-pure
   * @param {object} w
   * @param {boolean} w.isSaveAs
   * @param {string} w.encoding
   * @param {number} w.generation - of the document the save started from
   * @param {boolean} w.remember - Save asked: remember the answer
   * @returns {Promise<{file: File, fileHandle: object}|null>} a file saved as .md to reopen (NE-19)
   */
  async _write({ isSaveAs, encoding: chosen, generation, remember }) {
    const doc = this._document;
    const text = this.currentText();
    const access = this._fileAccess;
    const name = doc.fileName;
    if (!access.canWriteInPlace()) {
      const encoded = this._encode(doc, text, chosen, name);
      if (!encoded) return null;
      access.startDownload(name, encoded.bytes, CONFIG.codeEdit.downloadMimeType);
      this._host.toast(CONFIG.messages.edit.downloadStarted(name));
      this._toastIfMadeUtf8(chosen, encoded.encoding);
      return null;
    }
    const inPlace = !isSaveAs && this._fileHandle !== null;
    let fileHandle = this._fileHandle;
    // Encoded and checked before the permission request or the save dialog:
    // the dialog may create the file it returns, so a stop after it could
    // leave an empty file. In place the name is known (NE-30: a .md name is
    // UTF-8); the dialog's name only after it, then a .md name is encoded
    // again in UTF-8.
    let encoded = this._encode(doc, text, chosen, inPlace ? name : "");
    if (!encoded) return null;
    const started = inPlace ? access.startPermissionRequest(fileHandle) : access.startSavePicker(name, this._pickerTypes(name));
    let lastModified;
    try {
      if (inPlace) {
        if (!(await this._mayOverwrite(started, fileHandle, doc.lastModified))) return null;
      } else {
        fileHandle = await started;
        if (isMarkdownName(fileHandle.name) && encoded.encoding !== "utf-8") {
          encoded = this._encode(doc, text, "utf-8", fileHandle.name);
          if (!encoded) return null; // a lone surrogate: UTF-8 cannot write it either
        }
      }
      lastModified = await access.writeFile(fileHandle, encoded.bytes);
    } catch (error) {
      if (error?.name !== "AbortError" || inPlace) this._host.toast(this._failureMessage(error));
      return null;
    }
    const { bytes, encoding } = encoded;
    const savedName = inPlace ? name : fileHandle.name;
    if (generation === this._generation) {
      const saved = this._document.withSaved(text, savedName, lastModified, encoding);
      // UTF-8 chosen: the document is UTF-8 now, nothing left to remember
      this._document = remember && encoding === doc.encoding ? saved.withSaveEncoding("original") : saved;
      this._fileHandle = fileHandle;
    }
    this._host.toast(CONFIG.messages.edit.saved(savedName));
    this._toastIfMadeUtf8(chosen, encoding);
    const file = new File([bytes], savedName, lastModified === null ? {} : { lastModified });
    if (isMarkdownName(savedName) && generation === this._generation) return { file, fileHandle };
    const languageChanged = languageOfFileName(doc.fileName) !== languageOfFileName(savedName);
    if (generation === this._generation) this._host.codeFileSaved(file, fileHandle, languageChanged);
    return null;
  }

  /**
   * The bytes to write under a name, in the chosen encoding; a name ending
   * in .md is always UTF-8 (NE-30; the BOM as CodeDocument.toBytes keeps
   * it). Characters the encoding written cannot hold: the alert (with the
   * lines) and null, nothing is written.
   * @purity non-pure
   * @param {CodeDocument} doc
   * @param {string} text - LF text
   * @param {string} chosen - the encoding chosen (or known)
   * @param {string} name - the name written to
   * @returns {{bytes: Uint8Array, encoding: string}|null}
   */
  _encode(doc, text, chosen, name) {
    const encoding = isMarkdownName(name) ? "utf-8" : chosen;
    const { bytes, unencodableLines } = doc.toBytes(text, encoding);
    if (unencodableLines.length > 0) {
      window.alert(this._unencodableMessage(encoding, unencodableLines));
      return null;
    }
    return { bytes, encoding };
  }

  /**
   * NE-30: a .md file was written in UTF-8 although another encoding was
   * chosen: a toast says so.
   * @purity non-pure
   * @param {string} chosen
   * @param {string} written
   */
  _toastIfMadeUtf8(chosen, written) {
    if (chosen !== written) this._host.toast(CONFIG.messages.codeEdit.savedMarkdownUtf8);
  }

  /**
   * Save in place: the permission, then the overwrite question when the file
   * changed since it was read or saved, or that is not known (INV-39).
   * Errors pass through.
   * @purity non-pure
   * @param {Promise<string>} permission - started in the press
   * @param {object} fileHandle
   * @param {number|null} baseline - lastModified at the last load or save; null: unknown
   * @returns {Promise<boolean>} false: not written (a toast was shown, or the answer was no)
   */
  async _mayOverwrite(permission, fileHandle, baseline) {
    if ((await permission) !== "granted") {
      this._host.toast(CONFIG.messages.edit.saveDenied);
      return false;
    }
    const onDisk = await this._fileAccess.readLastModified(fileHandle);
    if (baseline !== null && onDisk === baseline) return true;
    return this._host.confirmOverwrite(baseline === null ? "unknown" : "changed");
  }

  /**
   * The save dialog's file type: the file's own extension, so the name
   * keeps it; "all files" stays offered, so it can be changed (NE-8).
   * @purity semi-pure-a
   * @param {string} name
   * @returns {object[]}
   */
  _pickerTypes(name) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot) : "";
    if (!PICKER_EXTENSION.test(ext)) return [];
    return [{ description: CONFIG.messages.codeEdit.fileType(ext.slice(1).toUpperCase()), accept: { "text/plain": [ext] } }];
  }

  /**
   * The alert of a save stopped by characters the encoding cannot write:
   * the encoding and the lines, at most CONFIG.codeEdit.maxListedLines.
   * @purity semi-pure-a
   * @param {string} encoding
   * @param {number[]} lines - 1-based
   * @returns {string}
   */
  _unencodableMessage(encoding, lines) {
    const max = CONFIG.codeEdit.maxListedLines;
    const listed = lines.slice(0, max).join(", ") + (lines.length > max ? ", ..." : "");
    const m = CONFIG.messages.codeEdit;
    return m.unencodable(m.encodingNames[encoding] ?? encoding, listed);
  }

  /**
   * Toast text for a failure (INV-25), as SaveDocumentAs.
   * @purity semi-pure-a
   * @param {Error} error
   * @returns {string}
   */
  _failureMessage(error) {
    const m = CONFIG.messages.edit;
    if (error?.name === "SecurityError") return m.saveActivationLost;
    if (error?.name === "NotFoundError") return m.saveNotFound;
    return m.saveFailed;
  }
}
