import { CONFIG } from "../config.js";
import { decodeFileBytes, decodeAs, detectBom, countLineEndings, hasMixedLineEndings, containsNul } from "../textEncoding.js";
import { inferIndentUnit } from "../indentText.js";
import { foldJsonOnce, unfoldJsonOnce } from "../jsonFold.js";
import CodeDocument, { singleLineEnding } from "./CodeDocument.js";
import CodeEditHistory from "./CodeEditHistory.js";
import { languageOfFileName } from "./SourceFileRenderer.js";
import { cell, row, choice, selectCell } from "../stateTable.js";

// An extension the save dialog accepts as a file type (NE-8); others are
// offered as "all files" only.
const PICKER_EXTENSION = /^\.[A-Za-z0-9+]{1,15}$/;

const VIEWING = "viewing";
const EDITING = "editing";
const MODE_STATES = [VIEWING, EDITING];
const mode = (...cells) => row(MODE_STATES, cells);

/**
 * Spec 11-h: the code edit mode (INV-85). Event -> current state -> cell
 * (null = nothing happens). The state is not stored: it is "editing" while
 * the CodeEditor is active (its DOM is in the preview), else "viewing".
 * Guard canEdit: there is a document and an editor factory.
 */
export const codeEditModeStateMachine = Object.freeze({
  // [Edit] / e (toggleEdit)
  editToggled: mode(
    choice(cell(EDITING, ["dropViewFolds", "startEditor", "showCodePalette"], "canEdit")),
    cell(VIEWING, ["stopEditor", "keepEditedText", "drawView", "hideCodePalette"]),
  ),
  // Reload, after its questions (INV-21): the reload draws the view (L5)
  reloadStarted: mode(null, cell(VIEWING, ["stopEditor", "keepEditedText", "hideCodePalette"])),
  // opened, close, the commit of a Reload: a new document (or none)
  documentReplaced: mode(
    cell(VIEWING, ["replaceDocument"]),
    cell(VIEWING, ["stopEditor", "hideCodePalette", "replaceDocument"]),
  ),
});

/**
 * The extension of a file name with its dot (".txt"), or "".
 * @purity pure
 * @param {string} name
 * @returns {string}
 */
function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

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
    this._dirty = null; // unsaved: true / false, or null until compared (isDirty)
    this._openedExtension = ""; // the extension of the file opened, e.g. ".txt" (NE-8)
    this._viewUnit = null; // the indent unit of an unfold in the view, inferred once a document (L24)
    this._fileHandle = null; // the file to write in place, or null
    this._fullPath = null; // the file's full path from the launcher (INV-105), or null
    this._generation = 0; // a new document (open, close, reload) since a save started
    this._saving = false; // a save runs, from its encoding question to its end (INV-54)
    this._editor = null; // the CodeEditor, made at the first edit
    this._displayText = null; // the view's text with JSON folds (INV-92), or null: the document's
    this._toldSlow = false; // NE-32: the large file toast was shown for this document
    this._history = new CodeEditHistory({
      limit: CONFIG.edit.undoMaxSteps,
      pauseMs: CONFIG.codeEdit.undoPauseMs,
      now: editing.now ?? (() => Date.now()),
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
   * The document's text changed (the editor). No comparison of the texts
   * here (a key, G10): another length is unsaved for sure; the same length
   * is compared when asked (isDirty).
   * @purity non-pure
   * @param {string} text - LF text
   */
  updateText(text) {
    if (!this._document) return;
    this._setDocument(this._document.withText(text));
    if (text.length !== this._document.savedText.length) this._dirty = true;
  }

  /**
   * Unsaved: the text differs from the text at the last load or save.
   * Asked for the mark while typing (once a key), a text not compared yet
   * counts as unsaved; it is compared when typing stops or when asked
   * otherwise (INV-21).
   * @purity semi-pure-b
   * @param {boolean} [isTyping] - asked for the mark while typing
   * @returns {boolean}
   */
  isDirty(isTyping = false) {
    if (this._document === null) return false;
    if (this._dirty === null) {
      if (isTyping) return true;
      this._dirty = this._document.isDirty();
    }
    return this._dirty;
  }

  /**
   * The document now; whether it is unsaved is compared when next asked.
   * @purity non-pure
   * @param {CodeDocument|null} codeDocument
   */
  _setDocument(codeDocument) {
    this._document = codeDocument;
    this._dirty = null;
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
    this._dispatch("editToggled");
  }

  /**
   * Edit mode ends without drawing the view (Reload, after its questions:
   * the reload draws the view; L5). Nothing when not editing.
   * @purity non-pure
   * @returns {boolean} true when edit mode ended
   */
  stopEditing() {
    return this._dispatch("reloadStarted");
  }

  /**
   * The view shows the document's text again (a Reload that could not
   * read the file after stopEditing).
   * @purity non-pure
   */
  showDocumentText() {
    if (this._document) this._host.showCodeText(this.shownText(), true);
  }

  /**
   * Run an event of 11-h (codeEditModeStateMachine).
   * @purity non-pure
   * @param {"editToggled"|"reloadStarted"|"documentReplaced"} event
   * @param {{document?: CodeDocument|null}} [input] - documentReplaced: the new document
   * @returns {boolean} true when a cell was taken
   */
  _dispatch(event, input = {}) {
    const state = this.isEditing() ? EDITING : VIEWING;
    const next = selectCell(codeEditModeStateMachine[event][state], (guard) => this._isGuardTrue(guard));
    if (!next) return false;
    const run = { text: "" };
    for (const action of next.actions) this._runAction(action, input, run);
    return true;
  }

  /**
   * @purity semi-pure-b
   * @param {string} guard
   * @returns {boolean}
   */
  _isGuardTrue(guard) {
    if (guard === "canEdit") return this._document !== null && this._createEditor !== null;
    throw new Error("Unknown guard: " + guard);
  }

  /**
   * One action of an 11-h cell.
   * @purity non-pure
   * @param {string} action
   * @param {{document?: CodeDocument|null}} input
   * @param {{text: string}} run - the text the editor stopped with, for the later actions
   */
  _runAction(action, input, run) {
    switch (action) {
      case "dropViewFolds": // INV-92: edit mode starts on the document's text
        this._displayText = null;
        break;
      case "startEditor":
        this._editor ??= this._createEditor(this._editorHost());
        this._editor.start(this._document.text, this._history);
        // NE-32: a file of slowEditBytes or more (its size now, as the file info shows): one toast a document
        if (!this._toldSlow && this._document.fileBytes >= CONFIG.codeEdit.slowEditBytes) {
          this._toldSlow = true;
          this._host.toast(CONFIG.messages.codeEdit.slowEdit);
        }
        break;
      case "showCodePalette":
        this._host.codeEditModeChanged(true);
        break;
      case "stopEditor":
        run.text = this._editor.stop();
        break;
      case "keepEditedText": // the document keeps it; unsaved stays as it is
        this.updateText(run.text);
        break;
      case "drawView":
        this._host.showCodeText(run.text, true);
        break;
      case "hideCodePalette":
        this._host.codeEditModeChanged(false);
        break;
      case "replaceDocument":
        this._generation++;
        this._displayText = null;
        this._viewUnit = null;
        this._toldSlow = false;
        this._history.reset(input.document?.text ?? "", 0, 0);
        this._setDocument(input.document ?? null);
        break;
      default:
        throw new Error("Unknown action: " + action);
    }
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
    const result = direction === "fold" ? foldJsonOnce(source) : unfoldJsonOnce(source, this._indentUnit());
    if (result.error) {
      this._host.toast(m.foldInvalid);
      return;
    }
    if (!result.changed) {
      this._host.toast(direction === "fold" ? m.nothingToFold : m.nothingToUnfold);
      return;
    }
    if (this.isEditing()) {
      // one undo step; Search and the Index follow at the typing pause (INV-86 (4), N1)
      const caret = Math.min(this._editor.input.selectionStart, result.text.length);
      this._editor.setText(result.text, caret, caret);
      return;
    }
    this._displayText = result.text;
    this._host.showCodeText(result.text, false);
  }

  /**
   * The indent unit an unfold uses (L24): the editor's while editing (it
   * inferred it when editing started), else one inferred once from the
   * document's text (not from the folded text shown).
   * @purity non-pure
   * @returns {string}
   */
  _indentUnit() {
    if (this.isEditing()) return this._editor.indentUnit;
    this._viewUnit ??= inferIndentUnit(this._document.text, CONFIG.codeEdit.defaultIndent);
    return this._viewUnit;
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
   * not valid UTF-8 or mixes line endings (NE-15, NE-25). A decoded text
   * that holds U+0000 is refused before the dialog asks anything (INV-18,
   * owner ruling AQ11), and so is the text of an encoding chosen in the
   * dialog. Nothing changes here: the caller opens the result (opened)
   * after its own questions.
   * @purity non-pure
   * @param {File} file
   * @returns {Promise<CodeDocument|null|"binary">} null when the dialog was
   *   canceled; "binary" when the text holds U+0000 (the caller tells it)
   */
  async read(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded = decodeFileBytes(bytes);
    if (containsNul(decoded.text)) return "binary";
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
      if (containsNul(text)) return "binary";
    }
    return CodeDocument.fromDecoded({
      fileName: file.name,
      lastModified: file.lastModified,
      text,
      encoding,
      bom: detectBom(bytes) === encoding,
      lineEndingMode,
      fileBytes: bytes.length,
    });
  }

  /**
   * The code view shows this document now. The next save dialog starts in
   * its folder (INV-79).
   * @purity non-pure
   * @param {CodeDocument} codeDocument
   * @param {object|null} fileHandle
   * @param {string|null} [fullPath] - from the launcher (INV-105)
   */
  opened(codeDocument, fileHandle, fullPath = null) {
    this._dispatch("documentReplaced", { document: codeDocument });
    this._openedExtension = extensionOf(codeDocument.fileName);
    this._fileHandle = fileHandle ?? null;
    this._fullPath = fullPath ?? null;
    this._fileAccess.noteFile(fileHandle ?? null);
  }

  /**
   * The full path that [Save] puts on the clipboard (INV-105): only while a
   * save would ask where (no file handle yet; a download gives none, so the
   * path stays). Null otherwise.
   * @purity semi-pure-b
   * @returns {string|null}
   */
  get pathToOffer() {
    return this._fileHandle ? null : this._fullPath;
  }

  /**
   * The code view is left (Clear, a Markdown document): no code document.
   * @purity non-pure
   */
  close() {
    this._dispatch("documentReplaced", { document: null });
    this._openedExtension = "";
    this._fileHandle = null;
    this._fullPath = null;
  }

  /**
   * Reload in the encoding the file was opened with, keeping its line
   * ending mode; no dialog. readText decodes (for SourceFileRenderer.reload);
   * commit makes the read document the current one, once the view has
   * shown it (nothing changes when the reload went stale). isCurrent: no
   * other document came since (the caller asks its questions only then).
   * @purity non-pure
   * @returns {{readText: (file: File) => Promise<string>, isCurrent: () => boolean, commit: () => void}}
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
        next = current.withReloaded(decodeAs(bytes, current.encoding), file.lastModified, detectBom(bytes) === current.encoding, bytes.length);
        return next.text;
      },
      isCurrent: () => generation === this._generation,
      /** @purity non-pure */
      commit: () => {
        if (!next || generation !== this._generation) return;
        this._dispatch("documentReplaced", { document: next });
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
    if (this._saving) return; // ignored, as a Markdown save in progress (11-e, INV-58)
    this._saving = true;
    const generation = this._generation;
    let reopen = null;
    try {
      let encoding = this._knownEncoding(doc, isSaveAs);
      let remember = null;
      if (encoding === null) {
        const answer = await this._dialog.askSaveEncoding(doc.encoding);
        if (!answer || generation !== this._generation) return;
        encoding = answer === "original" ? doc.encoding : "utf-8";
        if (!isSaveAs) remember = answer;
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
   * cannot write are found before any of them: the save asks whether to
   * write in UTF-8 instead (NE-31; its button press starts them), else
   * nothing is written. A .md name is written in UTF-8 (NE-30), known after
   * the save dialog for Save as.
   * Save's answer to the encoding question is remembered once the file is
   * written in it, or its download started (NE-24, L20): a save stopped or
   * canceled asks again.
   * @purity non-pure
   * @param {object} w
   * @param {boolean} w.isSaveAs
   * @param {string} w.encoding
   * @param {number} w.generation - of the document the save started from
   * @param {"original"|"utf-8"|null} w.remember - Save asked: the answer to remember
   * @returns {Promise<{file: File, fileHandle: object}|null>} a file saved as .md to reopen (NE-19)
   */
  async _write({ isSaveAs, encoding: asked, generation, remember: answer }) {
    const doc = this._document;
    const text = this.currentText();
    const access = this._fileAccess;
    const name = doc.fileName;
    const download = !access.canWriteInPlace();
    const inPlace = !download && !isSaveAs && this._fileHandle !== null;
    // Encoded and checked before the permission request or the save dialog:
    // the dialog may create the file it returns, so a stop after it could
    // leave an empty file. In place or downloaded the name is known (NE-30:
    // a .md name is UTF-8); the dialog's name only after it, then a .md
    // name is encoded again in UTF-8.
    let chosen = asked;
    let remember = answer;
    let encoded = this._encode(doc, text, chosen, inPlace || download ? name : "");
    if (encoded.unencodableLines) {
      if (!(await this._askUtf8(encoded)) || generation !== this._generation) return null;
      chosen = "utf-8"; // NE-31: answered UTF-8 (remembered as such for Save)
      if (remember) remember = "utf-8";
      encoded = this._encode(doc, text, chosen, name);
      if (encoded.unencodableLines) return this._unencodable(encoded);
    }
    if (download) {
      access.startDownload(name, encoded.bytes, CONFIG.codeEdit.downloadMimeType);
      // the base (unsaved) stays (INV-26); the answer is kept for the next Save
      if (remember && generation === this._generation) this._document = this._document.withSaveEncoding(remember);
      this._host.toast(CONFIG.messages.edit.downloadStarted(name));
      this._toastIfMadeUtf8(chosen, encoded.encoding);
      return null;
    }
    let fileHandle = this._fileHandle;
    const offered = this._offeredName(name);
    const started = inPlace ? access.startPermissionRequest(fileHandle) : access.startSavePicker(offered, this._pickerTypes(offered));
    let lastModified;
    try {
      if (inPlace) {
        if (!(await this._mayOverwrite(started, fileHandle, doc.lastModified))) return null;
      } else {
        fileHandle = await started;
        if (isMarkdownName(fileHandle.name) && encoded.encoding !== "utf-8") {
          encoded = this._encode(doc, text, "utf-8", fileHandle.name);
          if (encoded.unencodableLines) return this._unencodable(encoded); // a lone surrogate
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
      const saved = this._document.withSaved(text, savedName, lastModified, encoding, bytes.length);
      // UTF-8 chosen: the document is UTF-8 now, nothing left to remember
      this._setDocument(remember === "original" && encoding === doc.encoding ? saved.withSaveEncoding("original") : saved);
      this._fileHandle = fileHandle;
    }
    this._host.toast(CONFIG.messages.edit.saved(savedName));
    this._toastIfMadeUtf8(chosen, encoding);
    const file = new File([bytes], savedName, lastModified === null ? {} : { lastModified });
    if (isMarkdownName(savedName) && generation === this._generation) return { file, fileHandle };
    const languageChanged = languageOfFileName(doc.fileName) !== languageOfFileName(savedName);
    if (generation !== this._generation) return null;
    if (languageChanged) this.editor?.recolor(); // INV-90 (7): the editor's colors follow the new name
    this._host.codeFileSaved(file, fileHandle, languageChanged);
    return null;
  }

  /**
   * The bytes to write under a name, in the chosen encoding; a name ending
   * in .md is always UTF-8 (NE-30; the BOM as CodeDocument.toBytes keeps
   * it). Characters the encoding cannot hold: their lines instead of bytes.
   * @purity semi-pure-a
   * @param {CodeDocument} doc
   * @param {string} text - LF text
   * @param {string} chosen - the encoding chosen (or known)
   * @param {string} name - the name written to
   * @returns {{bytes: Uint8Array|null, encoding: string, unencodableLines: number[]|null}}
   */
  _encode(doc, text, chosen, name) {
    const encoding = isMarkdownName(name) ? "utf-8" : chosen;
    const { bytes, unencodableLines } = doc.toBytes(text, encoding);
    return unencodableLines.length > 0 ? { bytes: null, encoding, unencodableLines } : { bytes, encoding, unencodableLines: null };
  }

  /**
   * Characters the encoding cannot write (NE-31): ask whether to save in
   * UTF-8 instead; nothing is written in the encoding with them lost
   * (NE-24). A UTF encoding fails only on a lone surrogate, which UTF-8
   * cannot write either: the alert, and no.
   * @purity non-pure
   * @param {{encoding: string, unencodableLines: number[]}} encoded
   * @returns {Promise<boolean>} true: save in UTF-8
   */
  async _askUtf8(encoded) {
    if (encoded.encoding.startsWith("utf-")) return Boolean(this._unencodable(encoded));
    return this._dialog.askSaveUtf8(encoded.encoding, this._listed(encoded.unencodableLines));
  }

  /**
   * The alert of a save stopped by characters the encoding cannot write.
   * @purity non-pure
   * @param {{encoding: string, unencodableLines: number[]}} encoded
   * @returns {null} nothing written
   */
  _unencodable({ encoding, unencodableLines }) {
    const m = CONFIG.messages.codeEdit;
    window.alert(m.unencodable(m.encodingNames[encoding] ?? encoding, this._listed(unencodableLines)));
    return null;
  }

  /**
   * NE-30: a .md file was written in UTF-8 although another encoding was
   * chosen: a toast says so (not when UTF-8 was chosen, L4).
   * @purity non-pure
   * @param {string} chosen
   * @param {string} written
   */
  _toastIfMadeUtf8(chosen, written) {
    if (chosen !== "utf-8" && written === "utf-8") this._host.toast(CONFIG.messages.codeEdit.savedMarkdownUtf8);
  }

  /**
   * The name the save dialog offers (NE-8): the file's name with the
   * extension it was opened with (after a Save as to another extension,
   * the opened one again). A name without one stays as it is.
   * @purity semi-pure-b
   * @param {string} name - the file's name now
   * @returns {string}
   */
  _offeredName(name) {
    const ext = extensionOf(name);
    if (!this._openedExtension || ext === this._openedExtension) return name;
    return name.slice(0, name.length - ext.length) + this._openedExtension;
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
   * The lines of characters an encoding cannot write, listed: at most
   * CONFIG.codeEdit.maxListedLines, then ", ...".
   * @purity semi-pure-a
   * @param {number[]} lines - 1-based
   * @returns {string}
   */
  _listed(lines) {
    const max = CONFIG.codeEdit.maxListedLines;
    return lines.slice(0, max).join(", ") + (lines.length > max ? ", ..." : "");
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
