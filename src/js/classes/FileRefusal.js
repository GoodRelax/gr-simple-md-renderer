/**
 * A file the open checks refuse (INV-18 (1)(4)(5)). A drop and a Reload
 * (the file read from disk again) run the same checks and show the same
 * alert: reason is its key in CONFIG.fileDrop.messages.
 */
export default class FileRefusal extends Error {
  /**
   * @purity pure
   * @param {"tooLarge"|"notAllowed"|"binaryFile"} reason
   */
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
