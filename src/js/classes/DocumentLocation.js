/**
 * Where the document is saved (UseCase-layer value, immutable). INV-55:
 * UIController holds exactly one current value; nothing else keeps a fileHandle.
 * The fileHandle is an opaque reference here; Entities never use it.
 */
export default class DocumentLocation {
  /**
   * @purity pure
   * @param {string|null} fileName
   * @param {object|null} fileHandle - FileSystemFileHandle, or null
   */
  constructor(fileName, fileHandle) {
    this.fileName = fileName ?? null;
    this.fileHandle = fileHandle ?? null;
    Object.freeze(this);
  }
}
