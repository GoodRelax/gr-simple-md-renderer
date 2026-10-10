import SaveDocumentAs from "./SaveDocumentAs.js";
import { LAST_MODIFIED_UNKNOWN } from "./DocumentSession.js";

/**
 * Save (UseCase, spec 5.14.7): overwrite the document's own file.
 * Order: permission -> lastModified check (INV-39) -> write -> new baseline.
 * Without a file handle or a write API it behaves like Save as.
 * The overwrite question goes through request.confirmer (OverwriteConfirmPort);
 * this class never touches the UI.
 *
 * request.permissionOrPicker is the permission promise when there is a
 * handle, or the save-dialog promise when there is none; the caller starts
 * it inside the press handler (INV-33).
 */
export default class SaveDocument {
  /**
   * @purity non-pure
   * @param {MarkdownFileAccess} fileAccess
   * @param {object} messages - CONFIG.messages.edit
   * @param {string} defaultFileName - CONFIG.edit.defaultFileName
   */
  constructor(fileAccess, messages, defaultFileName) {
    this.fileAccess = fileAccess;
    this.messages = messages;
    this.saveAs = new SaveDocumentAs(fileAccess, messages, defaultFileName);
  }

  /**
   * @purity non-pure
   * @param {object} request - SaveRequest
   * @returns {Promise<object>} SaveOutcome
   */
  async execute(request) {
    const handle = request.location.fileHandle;
    if (!handle || !this.fileAccess.canWriteInPlace()) return this.saveAs.execute(request);

    let permission;
    try {
      permission = await request.permissionOrPicker;
    } catch (error) {
      return this.saveAs.outcome(request, "failed", this.saveAs.failureMessage(error));
    }
    if (permission !== "granted") {
      return this.saveAs.outcome(request, "failed", this.messages.saveDenied);
    }

    let onDisk;
    try {
      onDisk = await this.fileAccess.readLastModified(handle);
    } catch (error) {
      return this.saveAs.outcome(request, "failed", this.saveAs.failureMessage(error));
    }
    const baseline = request.session.baselineLastModified;
    if (baseline === LAST_MODIFIED_UNKNOWN || (baseline !== null && onDisk !== baseline)) {
      const overwrite = await request.confirmer.confirmOverwrite();
      if (!overwrite) return this.saveAs.outcome(request, "canceled", null);
    }

    let lastModified;
    try {
      lastModified = await this.fileAccess.writeFile(handle, request.session.toFileText(request.bodyText));
    } catch (error) {
      return this.saveAs.outcome(request, "failed", this.saveAs.failureMessage(error));
    }
    return {
      status: "saved",
      documentId: request.session.documentId,
      session: request.session.withSaved(request.bodyText, lastModified),
      location: request.location,
      message: this.messages.saved(request.location.fileName || handle.name),
    };
  }
}
