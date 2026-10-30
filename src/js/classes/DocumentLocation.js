/**
 * Where the document is saved (UseCase-layer value, immutable). INV-55:
 * DocumentLifecycle holds exactly one current value; nothing else keeps a fileHandle.
 * The fileHandle is an opaque reference here; Entities never use it.
 */
export default class DocumentLocation {
  /**
   * @purity pure
   * @param {string|null} fileName
   * @param {object|null} fileHandle - FileSystemFileHandle, or null
   * @param {string|null} [fullPath] - the file's full path on the PC, known
   *   only for a file the PowerShell launcher opened (INV-105); else null
   */
  constructor(fileName, fileHandle, fullPath = null) {
    this.fileName = fileName ?? null;
    this.fileHandle = fileHandle ?? null;
    this.fullPath = fullPath ?? null;
    Object.freeze(this);
  }
}
