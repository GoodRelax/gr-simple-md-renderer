import DocumentLocation from "./DocumentLocation.js";

/**
 * Save as (UseCase, spec 5.14.7): write to a file chosen in the save dialog,
 * or download when the browser cannot write files in place (INV-26).
 * It never touches the UI; the caller shows the outcome.
 *
 * SaveRequest: { session, location, bodyText, permissionOrPicker, confirmer }.
 * permissionOrPicker is the save-dialog promise, already started by the
 * caller inside the press handler (INV-33).
 *
 * SaveOutcome: { status, documentId, session, location, message }, where
 * status is "saved" | "downloadStarted" | "canceled" | "failed".
 */
export default class SaveDocumentAs {
  /**
   * @purity non-pure
   * @param {MarkdownFileAccess} fileAccess
   * @param {object} messages - CONFIG.messages.edit
   * @param {string} defaultFileName - CONFIG.edit.defaultFileName
   */
  constructor(fileAccess, messages, defaultFileName) {
    this.fileAccess = fileAccess;
    this.messages = messages;
    this.defaultFileName = defaultFileName;
  }

  /**
   * The download (no write API) starts synchronously, before the first await,
   * so it still runs inside the user activation of the press (INV-33).
   * @purity non-pure
   * @param {object} request - SaveRequest
   * @returns {Promise<object>} SaveOutcome
   */
  async execute(request) {
    const name = request.location.fileName || this.defaultFileName;
    if (!this.fileAccess.canWriteInPlace()) {
      this.fileAccess.startDownload(name, request.session.toFileText(request.bodyText));
      return this.outcome(request, "downloadStarted", this.messages.downloadStarted(name));
    }

    let handle;
    try {
      handle = await request.permissionOrPicker;
    } catch (error) {
      if (error?.name === "AbortError") return this.outcome(request, "canceled", null);
      return this.outcome(request, "failed", this.failureMessage(error));
    }

    let lastModified;
    try {
      lastModified = await this.fileAccess.writeFile(handle, request.session.toFileText(request.bodyText));
    } catch (error) {
      return this.outcome(request, "failed", this.failureMessage(error));
    }
    const location = new DocumentLocation(handle.name, handle);
    return {
      status: "saved",
      documentId: request.session.documentId,
      session: request.session.withSaved(request.bodyText, lastModified),
      location,
      message: this.messages.saved(location.fileName),
    };
  }

  /**
   * An outcome that leaves the session and the location as they were.
   * @purity pure
   * @param {object} request
   * @param {string} status
   * @param {string|null} message
   * @returns {object} SaveOutcome
   */
  outcome(request, status, message) {
    return {
      status,
      documentId: request.session.documentId,
      session: request.session,
      location: request.location,
      message,
    };
  }

  /**
   * Toast text for a failure (INV-25).
   * @purity semi-pure-a
   * @param {Error} error
   * @returns {string}
   */
  failureMessage(error) {
    if (error?.name === "SecurityError") return this.messages.saveActivationLost;
    if (error?.name === "NotFoundError") return this.messages.saveNotFound;
    return this.messages.saveFailed;
  }
}
