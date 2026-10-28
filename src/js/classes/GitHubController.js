import GitHubFileRef from "./GitHubFileRef.js";
import { parseGitHubFileUrl, hasMarkdownExtension, classifyToken } from "../gitHubUrl.js";
import { detectLineEnding } from "../textTransforms.js";

const BOM = "\uFEFF";

/**
 * The GitHub UI (Framework layer; SC-27): the [Open GitHub] /
 * [Push to GitHub] button, and the Open, Push, Reload and drop dialogs.
 * Every request to GitHub starts from a dialog the user confirms (CON-12
 * draft). The token is read from the dialog's field when a request is sent
 * and both are emptied when it ends (owner ruling D11). The browser keeps it
 * (D3): after a request that used it succeeds, the browser is asked to save
 * it (Credential Management, Chrome and Edge; the user confirms in the
 * browser's prompt; D25). The saved token comes back through the browser's
 * autofill on the token field (D34; there is no [Saved] button). The eye
 * button shows the token in its field (D28). The dialogs are real <form>s
 * whose submit is stopped (form-action 'none' stays).
 *
 * GitHubHost (UIController): documents (DocumentLifecycle), isCodeView(),
 * body(), hasUnsyncedEdits(), prepareBody() -> boolean (INV-56, commit the
 * open editor), openDocument(result), reloadDocument(result, documentId),
 * refreshDirtyMark(), toast(message).
 */
export default class GitHubController {
  /**
   * @purity non-pure
   * @param {object} elements - button, openDialog, pushDialog, reloadDialog, dropDialog (and their fields, by id)
   * @param {GitHubContentsClient} client
   * @param {object} host - GitHubHost
   * @param {object} options - CONFIG.github, plus enabled (fine pointer, not in a frame; D15, D17)
   *   and passwordStore ({store(id, password)} over navigator.credentials, or null)
   */
  constructor(elements, client, host, options) {
    this.el = elements;
    this.client = client;
    this.host = host;
    this.options = options;
    this.passwordStore = options.passwordStore ?? null;
    this.enabled = Boolean(options.enabled);
    this._isRequesting = false;
    this._openRef = null; // the file the Open dialog will read
    this._dropResolve = null;
    this.el.button.hidden = !this.enabled;
    if (!this.enabled) return;
    this._wire();
    this.refresh();
  }

  // ---- the button ----

  /**
   * The button follows the document: [Push to GitHub] while a GitHub
   * document is shown (disabled when it is the GitHub version, D8), else
   * [Open GitHub].
   * @purity non-pure
   */
  refresh() {
    if (!this.enabled) return;
    const link = this._link();
    const button = this.el.button;
    if (!link) {
      button.classList.remove("gh-push");
      button.innerHTML = this.options.labels.openButton;
      button.title = this.options.labels.openTitle;
      button.disabled = false;
      return;
    }
    button.classList.add("gh-push");
    button.innerHTML = this.options.labels.pushButton;
    button.title = this.options.labels.pushTitle(link.ref.label());
    button.disabled = !this._hasChanges(link);
  }

  /**
   * The o key (D9): open the dialog; nothing while a GitHub document is shown.
   * @purity non-pure
   */
  handleKey() {
    if (this.enabled && !this._link()) this.openDialog();
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isDialogOpen() {
    return [this.el.openDialog, this.el.pushDialog, this.el.reloadDialog, this.el.dropDialog].some((d) => d.open);
  }

  // ---- Open ----

  /**
   * @purity non-pure
   */
  openDialog() {
    if (this._link()) return;
    const f = this.el.open;
    f.form.reset();
    this._hideToken(f);
    this._openRef = null;
    f.fields.hidden = true;
    this._showError(f.error, "");
    f.submit.disabled = true;
    this.el.openDialog.showModal();
    f.token.focus(); // the token first, then copy the URL (one clipboard; D24)
  }

  /**
   * The URL field changed: show the repository, branch and path when it is
   * a file URL on github.com (no request is made).
   * @purity non-pure
   */
  _onUrlInput() {
    const f = this.el.open;
    const text = f.url.value.trim();
    const parsed = text ? parseGitHubFileUrl(text, this.options) : null;
    if (!parsed || !parsed.ok) {
      this._openRef = null;
      f.fields.hidden = true;
      f.submit.disabled = true;
      const reason = parsed?.reason;
      const m = this.options.messages;
      this._showError(f.error, !parsed ? "" : reason === "raw" ? m.rawUrl : reason === "notMarkdown" ? m.notMarkdown : m.notGitHubUrl);
      return;
    }
    this._openRef = parsed.ref;
    f.repo.value = parsed.ref.repoName();
    f.branch.value = parsed.ref.branch;
    f.path.value = parsed.ref.path;
    f.fields.hidden = false;
    f.submit.disabled = false;
    this._showError(f.error, "");
  }

  /**
   * [Open]: read the file (the token, if any, is sent with the request).
   * @purity non-pure
   */
  async _submitOpen() {
    const f = this.el.open;
    const m = this.options.messages;
    if (!this._openRef || this._isRequesting) return;
    const branch = f.branch.value.trim();
    const path = f.path.value.trim().replace(/^\/+/, "");
    if (!branch || !path) return this._showError(f.error, m.notGitHubUrl);
    if (!hasMarkdownExtension(path, this.options.extensions)) return this._showError(f.error, m.notMarkdown);
    const token = f.token.value.trim();
    if (classifyToken(token, this.options.tokenPrefix) === "other") return this._showError(f.error, m.tokenNotFineGrained);
    const ref = new GitHubFileRef(this._openRef.owner, this._openRef.repo, branch, path);
    const result = await this._send(f, () => this.client.openFile(ref, token));
    if (!result) return;
    this._offerToSave(ref.repoName(), token);
    this.el.openDialog.close();
    await this.host.openDocument(result);
  }

  // ---- Push ----

  /**
   * [Push to GitHub]: the open editor is committed first, then the dialog
   * shows where the file goes; nothing is sent until [Push].
   * @purity non-pure
   */
  pushDialog() {
    const link = this._link();
    if (!link) return;
    if (this.host.documents.isSaving()) return this.host.toast(this.options.messages.busy);
    if (!this.host.prepareBody()) return;
    this.host.refreshDirtyMark();
    if (!this._hasChanges(link)) return this.host.toast(this.options.messages.unchanged);
    const f = this.el.push;
    f.form.reset();
    this._hideToken(f);
    f.repo.value = link.ref.repoName();
    f.branch.value = link.ref.branch;
    f.path.value = link.ref.path;
    f.message.value = this.options.labels.defaultMessage(link.ref.path);
    f.visibility.textContent = visibilityText(link.isPrivate, this.options.labels);
    f.visibility.classList.toggle("gh-public", link.isPrivate !== true);
    this._showError(f.error, "");
    this.el.pushDialog.showModal();
    f.message.focus();
    f.message.select();
  }

  /**
   * [Push]: the whole file, the message and the sha go to the branch.
   * @purity non-pure
   */
  async _submitPush() {
    const f = this.el.push;
    const m = this.options.messages;
    const link = this._link();
    if (!link || this._isRequesting) return;
    const message = f.message.value.trim();
    if (!message) return this._showError(f.error, m.messageRequired);
    const token = f.token.value.trim();
    const kind = classifyToken(token, this.options.tokenPrefix);
    if (kind !== "fineGrained") return this._showError(f.error, kind === "empty" ? m.tokenRequired : m.tokenNotFineGrained);
    const started = this.host.documents.startPush();
    if (!started) return this._showError(f.error, m.busy);
    const bodyText = this.host.body();
    const fileText = this.host.documents.fileTextOf(bodyText);
    const result = await this._send(f, () => this.client.pushFile(link, fileText, message, token));
    this.host.documents.finishPush(started, result ? { link: result.link, bodyText } : null);
    this.host.refreshDirtyMark();
    if (!result) return;
    this._offerToSave(link.ref.repoName(), token);
    this.el.pushDialog.close();
    this.host.toast(m.pushed(result.commitSha.slice(0, 7)), this.options.pushedToastMs); // longer (D36)
  }

  // ---- Reload ----

  /**
   * Reload (R) of a GitHub document: asks, then reads GitHub again (D8).
   * @purity non-pure
   */
  reloadDialog() {
    const link = this._link();
    if (!link) return;
    const f = this.el.reload;
    f.form.reset();
    this._hideToken(f);
    f.repo.value = link.ref.repoName();
    f.target.textContent = this.options.labels.reloadTarget(link.ref.branch, link.ref.path);
    this._showError(f.error, "");
    this.el.reloadDialog.showModal();
    f.submit.focus();
  }

  /**
   * @purity non-pure
   */
  async _submitReload() {
    const f = this.el.reload;
    const link = this._link();
    if (!link || this._isRequesting) return;
    const token = f.token.value.trim();
    if (classifyToken(token, this.options.tokenPrefix) === "other") return this._showError(f.error, this.options.messages.tokenNotFineGrained);
    const documentId = this.host.documents.session?.documentId;
    const result = await this._send(f, () => this.client.openFile(link.ref, token));
    if (!result) return;
    this._offerToSave(link.ref.repoName(), token);
    this.el.reloadDialog.close();
    await this.host.reloadDocument(result, documentId);
  }

  // ---- a .md dropped on a GitHub document (D6) ----

  /**
   * Ask what a dropped .md does to the GitHub document. No request is made:
   * the last commit was read when the file was opened.
   * @purity non-pure
   * @param {{fileName: string, text: string, hasBom: boolean}} dropped
   * @returns {Promise<"keep"|"stop"|"cancel">}
   */
  askDropChoice(dropped) {
    const link = this._link();
    if (!link) return Promise.resolve("stop");
    const f = this.el.drop;
    f.editing.textContent = link.ref.label();
    f.lastCommit.textContent = commitText(link.lastCommit, this.options.labels);
    f.dropped.textContent = dropped.fileName;
    const notes = [];
    const m = this.options.messages;
    const gitHubText = link.fileText.startsWith(BOM) ? link.fileText.slice(1) : link.fileText;
    const gitHubEol = lineEndingName(gitHubText);
    const droppedEol = lineEndingName(dropped.text);
    if (gitHubEol !== droppedEol) notes.push(m.lineEndingDiffers(gitHubEol, droppedEol));
    const gitHubBom = link.fileText.startsWith(BOM);
    const yesNo = (value) => (value ? this.options.labels.yes : this.options.labels.no);
    if (gitHubBom !== dropped.hasBom) notes.push(m.bomDiffers(yesNo(gitHubBom), yesNo(dropped.hasBom)));
    f.notes.textContent = notes.join("\n");
    f.notes.hidden = notes.length === 0;
    this.el.dropDialog.showModal();
    f.keep.focus();
    return new Promise(
      /** @purity non-pure */
      (resolve) => {
        this._dropResolve = resolve;
      },
    );
  }

  /**
   * @purity non-pure
   * @param {"keep"|"stop"|"cancel"} choice
   */
  _endDrop(choice) {
    const resolve = this._dropResolve;
    this._dropResolve = null;
    if (this.el.dropDialog.open) this.el.dropDialog.close();
    resolve?.(choice);
  }

  // ---- the browser keeps the token (D25) ----

  /**
   * Ask the browser to save the token that worked, under "owner/repo". The
   * browser shows its own prompt (nothing when the same one is saved); the
   * page keeps nothing (D11).
   * @purity non-pure
   * @param {string} repoName
   * @param {string} token
   */
  _offerToSave(repoName, token) {
    if (!this.passwordStore || !token) return;
    // declined or not supported: nothing to do
    this.passwordStore.store(repoName, token).catch(
      /** @purity pure */
      () => {},
    );
  }

  // ---- the eye button (D28) ----

  /**
   * Show or hide the token in its field. It never leaves the field.
   * @purity non-pure
   * @param {object} f - the dialog's fields
   * @param {boolean} shown
   */
  _setTokenShown(f, shown) {
    const labels = this.options.labels;
    const label = shown ? labels.hideToken : labels.showToken;
    f.token.type = shown ? "text" : "password";
    f.reveal.setAttribute("aria-pressed", String(shown));
    f.reveal.setAttribute("aria-label", label);
    f.reveal.title = label;
  }

  /**
   * @purity non-pure
   * @param {object} f - the dialog's fields
   */
  _hideToken(f) {
    this._setTokenShown(f, false);
  }

  // ---- helpers ----

  /**
   * One request from a dialog: its buttons wait, and the token field is
   * emptied when it ends (D11). The error stays in the dialog.
   * @purity non-pure
   * @param {object} f - the dialog's fields
   * @param {Function} run - () => Promise<result>
   * @returns {Promise<object|null>} the result, or null when it failed
   */
  async _send(f, run) {
    this._isRequesting = true;
    f.submit.disabled = true;
    f.form.classList.add("gh-busy");
    this._showError(f.error, "");
    let result;
    try {
      result = await run();
    } finally {
      f.token.value = "";
      this._hideToken(f);
      this._isRequesting = false;
      f.submit.disabled = false;
      f.form.classList.remove("gh-busy");
    }
    if (result.status !== "ok") {
      this._showError(f.error, result.message);
      return null;
    }
    return result;
  }

  /**
   * @purity semi-pure-b
   * @returns {GitHubLink|null} null in the code view
   */
  _link() {
    return this.host.isCodeView() ? null : this.host.documents.gitHub;
  }

  /**
   * @purity semi-pure-b
   * @param {GitHubLink} link
   * @returns {boolean}
   */
  _hasChanges(link) {
    if (this.host.hasUnsyncedEdits()) return true;
    const fileText = this.host.documents.fileTextOf(this.host.body());
    return fileText !== null && !link.isSameAs(fileText);
  }

  /**
   * @purity non-pure
   * @param {HTMLElement} el
   * @param {string} text
   */
  _showError(el, text) {
    el.textContent = text;
    el.hidden = !text;
  }

  /**
   * @purity non-pure
   */
  _wire() {
    const { button, open, push, reload, drop } = this.el;
    button.addEventListener("click", () => (this._link() ? this.pushDialog() : this.openDialog()));
    open.url.addEventListener("input", () => this._onUrlInput());
    /** @purity non-pure */
    open.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this._submitOpen();
    });
    /** @purity non-pure */
    push.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this._submitPush();
    });
    /** @purity non-pure */
    reload.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this._submitReload();
    });
    for (const f of [open, push, reload]) {
      f.reveal = f.form.querySelector(".gh-reveal");
      this._hideToken(f);
      f.reveal.addEventListener("click", () => this._setTokenShown(f, f.token.type === "password"));
      f.form.closest("dialog").addEventListener("close", () => this._hideToken(f));
      // a token typed, pasted or filled by the browser clears the dialog's error (D37)
      f.token.addEventListener("input", () => this._showError(f.error, ""));
    }
    drop.keep.addEventListener("click", () => this._endDrop("keep"));
    drop.stop.addEventListener("click", () => this._endDrop("stop"));
    drop.cancel.addEventListener("click", () => this._endDrop("cancel"));
    this.el.dropDialog.addEventListener("close", () => this._endDrop("cancel"));
    for (const dialog of [this.el.openDialog, this.el.pushDialog, this.el.reloadDialog, this.el.dropDialog]) {
      // the app's one-key shortcuts do not reach the page under a dialog
      dialog.addEventListener("keydown", (e) => e.stopPropagation());
      // Esc while a request runs: the dialog stays (its result is shown in it)
      /** @purity non-pure */
      dialog.addEventListener("cancel", (e) => {
        if (this._isRequesting) e.preventDefault();
      });
      for (const cancel of dialog.querySelectorAll(".gh-cancel")) {
        /** @purity non-pure */
        cancel.addEventListener("click", () => {
          if (!this._isRequesting) dialog.close();
        });
      }
    }
  }
}

/**
 * @purity pure
 * @param {boolean|null} isPrivate
 * @param {object} labels - CONFIG.github.labels
 * @returns {string}
 */
function visibilityText(isPrivate, labels) {
  if (isPrivate === true) return labels.visibilityPrivate;
  if (isPrivate === false) return labels.visibilityPublic;
  return labels.visibilityUnknown;
}

/**
 * @purity pure
 * @param {{sha: string, message: string, author: string, date: string}|null} commit
 * @param {object} labels - CONFIG.github.labels
 * @returns {string}
 */
function commitText(commit, labels) {
  if (!commit) return labels.commitUnknown;
  const date = commit.date ? commit.date.replace("T", " ").replace(/:\d\dZ$/, "Z") : "";
  return labels.commit(date, commit.author, commit.message, commit.sha.slice(0, 7));
}

/**
 * @purity pure
 * @param {string} text
 * @returns {"LF"|"CRLF"}
 */
function lineEndingName(text) {
  return detectLineEnding(text) === "\r\n" ? "CRLF" : "LF";
}
