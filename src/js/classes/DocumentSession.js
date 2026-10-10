import {
  splitMarkdownWrapper,
  detectLineEnding,
  normalizeLineEndings,
  convertLineEndings,
} from "../textTransforms.js";

const BOM = "\uFEFF";

/**
 * The values of the document being edited (Entity, immutable value).
 * Holds what is needed to tell "unsaved" and to rebuild the file on save:
 * the wrapper removed on load, the line ending, the BOM, and the baseline body.
 * It holds no browser types (the fileHandle lives in DocumentLocation, INV-55).
 */
export default class DocumentSession {
  /**
   * @purity pure
   * @param {object} v
   * @param {number} v.documentId
   * @param {string} v.wrapperPrefix
   * @param {string} v.wrapperSuffix
   * @param {"\n"|"\r\n"} v.lineEnding
   * @param {boolean} v.hasBom
   * @param {string} v.baselineBodyText
   * @param {number|null} v.baselineLastModified
   */
  constructor(v) {
    this.documentId = v.documentId;
    this.wrapperPrefix = v.wrapperPrefix;
    this.wrapperSuffix = v.wrapperSuffix;
    this.lineEnding = v.lineEnding;
    this.hasBom = v.hasBom;
    this.baselineBodyText = v.baselineBodyText;
    this.baselineLastModified = v.baselineLastModified;
    Object.freeze(this);
  }

  /**
   * A document read from a file (.md drop or Reload). Spec 5.14.1:
   * record the line ending, normalize to LF, then split the wrapper.
   * @purity pure
   * @param {string} fileText - decoded text (File.text() has already removed the BOM)
   * @param {boolean} hasBom - judged from the first bytes of the file
   * @param {number} lastModified
   * @param {number} documentId
   * @returns {DocumentSession}
   */
  static fromFileText(fileText, hasBom, lastModified, documentId) {
    const lineEnding = detectLineEnding(fileText);
    const { prefix, body, suffix } = splitMarkdownWrapper(normalizeLineEndings(fileText));
    return new DocumentSession({
      documentId,
      wrapperPrefix: prefix,
      wrapperSuffix: suffix,
      lineEnding,
      hasBom,
      baselineBodyText: body,
      baselineLastModified: lastModified,
    });
  }

  /**
   * A document that did not come from a file (paste, render from the top
   * editor in the initial state, empty document). LF, no BOM, no wrapper.
   * @purity pure
   * @param {string} bodyText - LF body, wrapper already removed
   * @param {number} documentId
   * @returns {DocumentSession}
   */
  static fromPastedText(bodyText, documentId) {
    return new DocumentSession({
      documentId,
      wrapperPrefix: "",
      wrapperSuffix: "",
      lineEnding: "\n",
      hasBom: false,
      baselineBodyText: bodyText,
      baselineLastModified: null,
    });
  }

  /**
   * @purity pure
   * @returns {string} the baseline body (last load or save)
   */
  getBodyText() {
    return this.baselineBodyText;
  }

  /**
   * @purity pure
   * @param {string} bodyText - the current body
   * @returns {boolean} true when it differs from the baseline
   */
  isBodyChanged(bodyText) {
    return bodyText !== this.baselineBodyText;
  }

  /**
   * The same document after a successful write.
   * @purity pure
   * @param {string} bodyText - the body that was written
   * @param {number} lastModified - lastModified of the written file
   * @returns {DocumentSession}
   */
  withSaved(bodyText, lastModified) {
    return new DocumentSession({
      ...this,
      baselineBodyText: bodyText,
      baselineLastModified: lastModified,
    });
  }

  /**
   * Build the file text to save: wrapper, line ending and BOM restored (INV-38, INV-44).
   * @purity pure
   * @param {string} bodyText - LF body
   * @returns {string}
   */
  toFileText(bodyText) {
    const lf = this.wrapperPrefix + bodyText + this.wrapperSuffix;
    return (this.hasBom ? BOM : "") + convertLineEndings(lf, this.lineEnding);
  }
}
