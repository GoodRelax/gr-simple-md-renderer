import { normalizeLineEndings } from "../textTransforms.js";
import { encodeText, lineEndingsOf, applyLineEndings } from "../textEncoding.js";

/**
 * The line ending of a text that has one kind only (no dialog, or a dialog
 * for the encoding alone): CRLF, LF or CR; LF when it has none (INV-89).
 * @purity pure
 * @param {{crlf: number, lf: number, cr: number}} counts - countLineEndings
 * @returns {"\r\n"|"\n"|"\r"}
 */
export function singleLineEnding(counts) {
  if (counts.crlf > 0) return "\r\n";
  if (counts.cr > 0) return "\r";
  return "\n";
}

/**
 * The lines and endings of a decoded text, for line endings kept as they
 * were ("keep", NE-25).
 * @purity pure
 * @param {string} text - decoded text, any line endings
 * @returns {{lines: string[], endings: string[]}}
 */
function originalOf(text) {
  return { lines: normalizeLineEndings(text).split("\n"), endings: lineEndingsOf(text) };
}

/**
 * A non-.md file opened in the code view (Entity, immutable value; SC-27,
 * INV-89, INV-90). Holds the LF text, the text at the last load or save,
 * how the file is written back (encoding, BOM, line endings) and the
 * encoding chosen for Save (NE-24). No browser types: the file handle stays
 * with CodeEditController.
 */
export default class CodeDocument {
  /**
   * @purity pure
   * @param {object} v
   * @param {string} v.fileName
   * @param {number|null} v.lastModified - null: unknown after a write (the next Save asks, INV-39)
   * @param {string} v.encoding - one of TEXT_ENCODINGS
   * @param {boolean} v.bom
   * @param {"\r\n"|"\n"|"\r"|"keep"} v.lineEndingMode
   * @param {{lines: string[], endings: string[]}|null} v.original - for "keep"
   * @param {string} v.text - LF text now
   * @param {string} v.savedText - LF text at the last load or save
   * @param {"original"|"utf-8"|null} v.saveEncoding - Save's remembered choice (NE-24)
   * @param {number} [v.fileBytes] - the file's size in bytes: as read, reloaded or last written (NE-32; 0: not known)
   */
  constructor(v) {
    this.fileName = v.fileName;
    this.lastModified = v.lastModified;
    this.encoding = v.encoding;
    this.bom = v.bom;
    this.lineEndingMode = v.lineEndingMode;
    this.original = v.original;
    this.text = v.text;
    this.savedText = v.savedText;
    this.saveEncoding = v.saveEncoding;
    this.fileBytes = v.fileBytes ?? 0;
    Object.freeze(this);
  }

  /**
   * A document read from a file: the decoded text is kept with LF line
   * endings; for "keep" its lines and endings are recorded (applyLineEndings).
   * @purity pure
   * @param {object} v
   * @param {string} v.fileName
   * @param {number} v.lastModified
   * @param {string} v.text - decoded with the chosen encoding, any line endings
   * @param {string} v.encoding
   * @param {boolean} v.bom
   * @param {"\r\n"|"\n"|"\r"|"keep"} v.lineEndingMode
   * @param {number} [v.fileBytes] - the file's size in bytes
   * @returns {CodeDocument}
   */
  static fromDecoded({ fileName, lastModified, text, encoding, bom, lineEndingMode, fileBytes = 0 }) {
    const lf = normalizeLineEndings(text);
    return new CodeDocument({
      fileName,
      lastModified,
      encoding,
      bom,
      lineEndingMode,
      original: lineEndingMode === "keep" ? originalOf(text) : null,
      text: lf,
      savedText: lf,
      saveEncoding: null,
      fileBytes,
    });
  }

  /**
   * True when the text differs from the text at the last load or save.
   * @purity pure
   * @returns {boolean}
   */
  isDirty() {
    return this.text !== this.savedText;
  }

  /**
   * The same document with another text (the editor, SC-27).
   * @purity pure
   * @param {string} text - LF text
   * @returns {CodeDocument}
   */
  withText(text) {
    return new CodeDocument({ ...this, text });
  }

  /**
   * The same document with Save's encoding choice remembered (NE-24).
   * @purity pure
   * @param {"original"|"utf-8"} choice
   * @returns {CodeDocument}
   */
  withSaveEncoding(choice) {
    return new CodeDocument({ ...this, saveEncoding: choice });
  }

  /**
   * The file read again (Reload): the encoding and the line ending mode
   * stay; the text, the saved text, the time and (for "keep") the original
   * lines come from the file.
   * @purity pure
   * @param {string} text - decoded with this.encoding, any line endings
   * @param {number} lastModified
   * @param {boolean} bom
   * @param {number} [fileBytes] - the file's size in bytes
   * @returns {CodeDocument}
   */
  withReloaded(text, lastModified, bom, fileBytes = 0) {
    const lf = normalizeLineEndings(text);
    return new CodeDocument({
      ...this,
      lastModified,
      bom,
      original: this.lineEndingMode === "keep" ? originalOf(text) : null,
      text: lf,
      savedText: lf,
      fileBytes,
    });
  }

  /**
   * The document after a successful write of savedText. The text typed
   * meanwhile stays (it is unsaved then). Written in another encoding
   * (UTF-8 chosen, NE-24): the document is UTF-8 from now on, without a
   * BOM, and Save no longer asks. For "keep" the original lines become the
   * written ones.
   * @purity pure
   * @param {string} savedText - the LF text written
   * @param {string} fileName - the name written to
   * @param {number|null} lastModified - of the written file; null when unreadable
   * @param {string} encoding - the encoding written
   * @param {number} fileBytes - the number of bytes written (NE-32: the file's size now)
   * @returns {CodeDocument}
   */
  withSaved(savedText, fileName, lastModified, encoding, fileBytes) {
    const changed = encoding !== this.encoding;
    const written = this.lineEndingMode === "keep" ? applyLineEndings(savedText, "keep", this.original) : null;
    return new CodeDocument({
      ...this,
      fileName,
      lastModified,
      encoding,
      bom: changed ? false : this.bom,
      saveEncoding: changed ? null : this.saveEncoding,
      original: written === null ? null : originalOf(written),
      savedText,
      fileBytes,
    });
  }

  /**
   * The bytes to write: the line endings applied (INV-90, NE-25), then the
   * text encoded. The BOM is kept when written in the document's own
   * encoding; UTF-8 chosen for another encoding is written without one.
   * unencodableLines (1-based) not empty: bytes is empty and nothing is saved.
   * @purity semi-pure-a
   * @param {string} text - LF text
   * @param {string} encoding - the encoding to write
   * @returns {{bytes: Uint8Array, unencodableLines: number[]}}
   */
  toBytes(text, encoding) {
    const final = applyLineEndings(text, this.lineEndingMode, this.original);
    return encodeText(final, encoding, encoding === this.encoding ? this.bom : false);
  }
}
