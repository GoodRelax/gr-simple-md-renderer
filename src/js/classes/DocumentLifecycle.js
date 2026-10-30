import DocumentSession from "./DocumentSession.js";
import DocumentLocation from "./DocumentLocation.js";
import { hasUtf8Bom } from "../textTransforms.js";
import { cell } from "../stateTable.js";

/**
 * Spec 11-e: event -> current state -> cell (null = no change). Only the save
 * or the push in progress is a state; "unsaved" is derived
 * (UIController._isDocumentDirty). A push (SC-28, INV-96 (4)) refuses saves,
 * another push and replaces as a save does (INV-54).
 */
export const saveOperationStateMachine = Object.freeze({
  saveRequested: Object.freeze({
    idle: cell("writingFile", ["startPermissionRequest", "commitOpenBlock", "applyEditorText", "runSaveDocument"]),
    writingFile: null,
    pushing: null,
  }),
  saveAsRequested: Object.freeze({
    idle: cell("writingFile", ["startSavePicker", "commitOpenBlock", "applyEditorText", "runSaveDocumentAs"]),
    writingFile: null,
    pushing: null,
  }),
  fileWritten: Object.freeze({
    idle: null,
    writingFile: cell("idle", ["applyOutcomeIfSameDocument", "refreshDirtyMark", "showSavedToast"]),
    pushing: null,
  }),
  downloadStarted: Object.freeze({ idle: null, writingFile: cell("idle", ["showDownloadStartedToast"]), pushing: null }),
  writeFailed: Object.freeze({ idle: null, writingFile: cell("idle", ["showErrorToast"]), pushing: null }),
  saveCanceled: Object.freeze({ idle: null, writingFile: cell("idle", []), pushing: null }),
  replaceRequested: Object.freeze({
    idle: null,
    writingFile: cell("writingFile", ["rejectReplace", "showSavingToast"]),
    pushing: cell("pushing", ["rejectReplace", "showSavingToast"]),
  }),
  pushRequested: Object.freeze({ idle: cell("pushing", ["runPush"]), writingFile: null, pushing: null }),
  pushFinished: Object.freeze({
    idle: null,
    writingFile: null,
    pushing: cell("idle", ["applyPushIfSameDocument", "refreshDirtyMark", "showPushedToast"]),
  }),
});

// SaveOutcome.status -> 11-e event
const SAVE_EVENT_BY_STATUS = Object.freeze({
  saved: "fileWritten",
  downloadStarted: "downloadStarted",
  failed: "writeFailed",
  canceled: "saveCanceled",
});

/**
 * The document lifecycle (UseCase, spec 5.14.11 and 11-e): the current
 * DocumentSession and DocumentLocation (INV-55: the only place of the file
 * handle), the document id, and the save operation state. It rebuilds the
 * session and the target by the rows of 5.14.11, reads the file for Reload
 * and runs SaveDocument / SaveDocumentAs. It never touches the UI: the UI
 * steps of a save (INV-56 confirm, commit, toasts) are called back through
 * SaveSteps, and the caller asks the questions of INV-21 itself.
 *
 * SaveSteps: { confirmStart() -> boolean, commitEdits(event), getBody() -> string,
 *   confirmer (OverwriteConfirmPort), onFinished(SaveResult) }.
 * SaveResult: { applied, message }: applied when the outcome replaced the
 * current session (refresh the unsaved mark); message is the toast, or null.
 */
export default class DocumentLifecycle {
  /**
   * @purity non-pure
   * @param {MarkdownFileAccess} fileAccess
   * @param {object} deps
   * @param {SaveDocument} deps.saveDocument
   * @param {SaveDocumentAs} deps.saveDocumentAs
   * @param {object} deps.messages - CONFIG.messages.edit
   * @param {string} deps.defaultFileName - CONFIG.edit.defaultFileName
   */
  constructor(fileAccess, { saveDocument, saveDocumentAs, messages, defaultFileName }) {
    this.fileAccess = fileAccess;
    this.saveDocument = saveDocument;
    this.saveDocumentAs = saveDocumentAs;
    this._messages = messages;
    this._defaultFileName = defaultFileName;
    this._session = null; // DocumentSession
    this._location = null; // DocumentLocation
    this._nextDocumentId = 1;
    this._saveOperationState = "idle"; // 11-e
    this._gitHub = null; // GitHubLink: the GitHub version beside the local target (SC-28)
  }

  /**
   * @purity semi-pure-b
   * @returns {DocumentSession|null}
   */
  get session() {
    return this._session;
  }

  /**
   * @purity semi-pure-b
   * @returns {DocumentLocation|null}
   */
  get location() {
    return this._location;
  }

  /**
   * The full path that [Save] puts on the clipboard (INV-105): known only
   * for a file the launcher opened, until it is saved to a file (that makes
   * a new location, with a file handle and no full path). A download keeps
   * the location, so the path stays. Null otherwise.
   * @purity semi-pure-b
   * @returns {string|null}
   */
  get pathToOffer() {
    return this._location?.fullPath ?? null;
  }

  /**
   * Saving is a download (no API to write a chosen file: Firefox), for the
   * Markdown and the code documents alike (INV-26, INV-105 (3)).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  get savesByDownload() {
    return !this.fileAccess.canWriteInPlace();
  }

  /**
   * @purity semi-pure-b
   * @returns {GitHubLink|null}
   */
  get gitHub() {
    return this._gitHub;
  }

  /**
   * @purity semi-pure-b
   * @returns {"idle"|"writingFile"|"pushing"}
   */
  get saveOperationState() {
    return this._saveOperationState;
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean}
   */
  hasSession() {
    return this._session !== null;
  }

  /**
   * The body differs from the baseline (last load or save); false without a session.
   * @purity semi-pure-b
   * @param {string} bodyText
   * @returns {boolean}
   */
  isBodyChanged(bodyText) {
    return this._session !== null && this._session.isBodyChanged(bodyText);
  }

  /**
   * The name the palette status shows.
   * @purity semi-pure-b
   * @returns {string}
   */
  fileName() {
    return this._location?.fileName ?? this._defaultFileName;
  }

  /**
   * INV-54: a document is not rebuilt while a save or a push is running.
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isSaving() {
    return saveOperationStateMachine.replaceRequested[this._saveOperationState] !== null;
  }

  // ---- 5.14.11: the document is rebuilt ----

  /**
   * A dropped .md file: a new session, and the file's name and handle as the
   * target. The next save dialog starts in its folder (INV-79).
   * @purity non-pure
   * @param {string} fileText
   * @param {boolean} hasBom
   * @param {number} lastModified
   * @param {string} fileName
   * @param {object|null} fileHandle
   * @param {boolean} [keepGitHub] - "replace and keep the GitHub link" (SC-28, D6)
   * @param {string|null} [fullPath] - from the launcher (INV-105)
   */
  openFile(fileText, hasBom, lastModified, fileName, fileHandle, keepGitHub = false, fullPath = null) {
    this._session = DocumentSession.fromFileText(fileText, hasBom, lastModified, this._newDocumentId());
    this._location = new DocumentLocation(fileName, fileHandle, fullPath);
    if (!keepGitHub) this._gitHub = null;
    this.fileAccess.noteFile(fileHandle);
  }

  /**
   * A file opened from GitHub (SC-28): a new session; the local
   * target has the file's name and no handle, so the first Save asks where.
   * @purity non-pure
   * @param {string} fileText - without the BOM
   * @param {boolean} hasBom
   * @param {GitHubLink} link
   */
  openGitHub(fileText, hasBom, link) {
    this._session = DocumentSession.fromFileText(fileText, hasBom, null, this._newDocumentId());
    this._location = new DocumentLocation(link.ref.fileName(), null);
    this._gitHub = link;
  }

  /**
   * Reload of a GitHub document: a new session from GitHub; the local target stays.
   * @purity non-pure
   * @param {string} fileText - without the BOM
   * @param {boolean} hasBom
   * @param {GitHubLink} link
   */
  reloadGitHub(fileText, hasBom, link) {
    this._session = DocumentSession.fromFileText(fileText, hasBom, this._session?.baselineLastModified ?? null, this._newDocumentId());
    this._gitHub = link;
  }

  /**
   * The file a push sends: the body with the session's wrapper, line ending and BOM.
   * @purity semi-pure-b
   * @param {string} bodyText
   * @returns {string|null} null without a session
   */
  fileTextOf(bodyText) {
    return this._session ? this._session.toFileText(bodyText) : null;
  }

  /**
   * A push starts (11-e pushRequested; refused while a save or another
   * push runs).
   * @purity non-pure
   * @returns {{documentId: number}|null}
   */
  startPush() {
    const next = saveOperationStateMachine.pushRequested[this._saveOperationState];
    if (!next || !this._session || !this._gitHub) return null;
    this._saveOperationState = next.to;
    return { documentId: this._session.documentId };
  }

  /**
   * A push ended. On success the GitHub link moves to the pushed version and
   * the unsaved mark drops (D8: either Save or push keeps the text); the
   * local file time stays the baseline of the next Save (INV-39).
   * @purity non-pure
   * @param {{documentId: number}} started - from startPush
   * @param {{link: GitHubLink, bodyText: string}|null} pushed - null when it failed
   * @returns {boolean} true when it was applied to the current document
   */
  finishPush(started, pushed) {
    const next = saveOperationStateMachine.pushFinished[this._saveOperationState];
    if (!next) return false;
    this._saveOperationState = next.to;
    if (!pushed || !this._session || this._session.documentId !== started.documentId) return false;
    this._session = this._session.withSaved(pushed.bodyText, this._session.baselineLastModified);
    this._gitHub = pushed.link;
    return true;
  }

  /**
   * What Reload reads (INV-21 Reload order: read first): the save target and
   * the current document id, noted before the read; null when there is no
   * file handle.
   * @purity semi-pure-b
   * @returns {{location: DocumentLocation, documentId: number|undefined}|null}
   */
  reloadTarget() {
    const location = this._location;
    if (!location || !location.fileHandle) return null;
    return { location, documentId: this._session?.documentId };
  }

  /**
   * Read the target's file. The promise of the file access is returned as it
   * is (no await here), so the caller's await settles in the same microtask
   * as the read itself.
   * @purity non-pure
   * @param {{location: DocumentLocation}} target - from reloadTarget()
   * @returns {Promise<{bytesHead: Uint8Array, text: string, lastModified: number}>}
   */
  readFile(target) {
    return this.fileAccess.readFile(target.location.fileHandle);
  }

  /**
   * The document or the save target changed since reloadTarget() (another
   * drop, Reload, paste, Clear or a Save as finished while the file was
   * read). Call it synchronously right after the read settles, in the same
   * step as the replace (INV-21).
   * @purity semi-pure-b
   * @param {{location: DocumentLocation, documentId: number|undefined}} target
   * @returns {boolean}
   */
  isStale(target) {
    return this._location !== target.location || this._session?.documentId !== target.documentId;
  }

  /**
   * Reload: a new session from the file read by readFile (BOM and line
   * ending read again); the target stays.
   * @purity non-pure
   * @param {{bytesHead: Uint8Array, text: string, lastModified: number}} loaded
   */
  reload(loaded) {
    this._session = DocumentSession.fromFileText(
      loaded.text,
      hasUtf8Bom(loaded.bytesHead),
      loaded.lastModified,
      this._newDocumentId(),
    );
  }

  /**
   * Paste, a render from #editor in the initial state, or an empty document
   * (""): a new session, no target.
   * @purity non-pure
   * @param {string} bodyText - LF body, wrapper already removed
   */
  startPasted(bodyText) {
    this._session = DocumentSession.fromPastedText(bodyText, this._newDocumentId());
    this._location = null;
    this._gitHub = null;
  }

  /**
   * Clear, or a non-.md drop (code view): no session, no target.
   * @purity non-pure
   */
  close() {
    this._session = null;
    this._location = null;
    this._gitHub = null;
  }

  // ---- 11-e: save ----

  /**
   * Save ("saveRequested") or Save as ("saveAsRequested"). INV-33 order,
   * synchronous until the use case awaits: (0) steps.confirmStart (the INV-56
   * confirm; false: nothing starts), (1) start the permission request or the
   * save dialog, (2) steps.commitEdits, (3) run the use case (a download
   * starts inside it). A press while writing, or without a session, is ignored.
   * @purity non-pure
   * @param {"saveRequested"|"saveAsRequested"} event
   * @param {object} steps - SaveSteps
   * @returns {Promise<void>} settles when the save has finished (after
   *   steps.onFinished), or at once when it was not started (ignored or
   *   canceled by confirmStart); onFinished is not called then
   */
  async save(event, steps) {
    const next = saveOperationStateMachine[event][this._saveOperationState];
    if (!next || !this._session) return;
    if (!steps.confirmStart()) return;
    const isSaveAs = event === "saveAsRequested";
    const location = this._location ?? new DocumentLocation(this._defaultFileName, null);
    const permissionOrPicker = this._startSaveAccess(isSaveAs, location);
    steps.commitEdits(event);
    this._saveOperationState = next.to;
    const request = {
      session: this._session,
      location,
      bodyText: steps.getBody(),
      permissionOrPicker,
      confirmer: steps.confirmer,
    };
    let outcome;
    try {
      outcome = await (isSaveAs ? this.saveDocumentAs : this.saveDocument).execute(request);
    } catch (error) {
      console.error("Save error:", error);
      outcome = this.saveDocumentAs.outcome(request, "failed", this._messages.saveFailed);
    }
    const result = this.finishSave(outcome);
    if (result) steps.onFinished(result);
  }

  /**
   * Apply a SaveOutcome (11-e). The session and the target change only for
   * the document the save started from (INV-54); a failure leaves it unsaved.
   * @purity non-pure
   * @param {object} outcome - SaveOutcome
   * @returns {{applied: boolean, message: string|null}|null} null when the state has no cell for it
   */
  finishSave(outcome) {
    const event = SAVE_EVENT_BY_STATUS[outcome.status] ?? "writeFailed";
    const next = saveOperationStateMachine[event][this._saveOperationState];
    if (!next) return null;
    this._saveOperationState = next.to;
    let applied = false;
    if (event === "fileWritten" && this._session && outcome.documentId === this._session.documentId) {
      this._session = outcome.session;
      this._location = outcome.location;
      applied = true;
    }
    const message = event !== "saveCanceled" && outcome.message ? outcome.message : null;
    return { applied, message };
  }

  /**
   * The permission request (Save with a target) or the save dialog; null
   * when the browser cannot write files (download).
   * @purity non-pure
   * @param {boolean} isSaveAs
   * @param {DocumentLocation} location
   * @returns {Promise|null}
   */
  _startSaveAccess(isSaveAs, location) {
    if (!this.fileAccess.canWriteInPlace()) return null;
    if (!isSaveAs && location.fileHandle) return this.fileAccess.startPermissionRequest(location.fileHandle);
    return this.fileAccess.startSavePicker(location.fileName);
  }

  /**
   * @purity non-pure
   * @returns {number}
   */
  _newDocumentId() {
    return this._nextDocumentId++;
  }
}
