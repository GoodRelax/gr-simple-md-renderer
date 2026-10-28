/**
 * The GitHub version a document is linked to (UseCase-layer value,
 * immutable; SC-27): the file, the blob sha a push must replace, the
 * file text of that version (BOM included as U+FEFF), whether the
 * repository is private, and its last commit. DocumentLifecycle holds the
 * current one beside the local save target (DocumentLocation).
 */
export default class GitHubLink {
  /**
   * @purity pure
   * @param {object} v
   * @param {GitHubFileRef} v.ref
   * @param {string} v.blobSha
   * @param {string} v.fileText - the GitHub version as a string (BOM as U+FEFF)
   * @param {boolean|null} v.isPrivate - null when not known
   * @param {{sha: string, message: string, author: string, date: string, url: string}|null} v.lastCommit
   */
  constructor(v) {
    this.ref = v.ref;
    this.blobSha = v.blobSha;
    this.fileText = v.fileText;
    this.isPrivate = v.isPrivate ?? null;
    this.lastCommit = v.lastCommit ?? null;
    Object.freeze(this);
  }

  /**
   * The same file after a push: the new blob sha, text and commit.
   * @purity pure
   * @param {string} blobSha
   * @param {string} fileText
   * @param {object|null} lastCommit
   * @returns {GitHubLink}
   */
  withPushed(blobSha, fileText, lastCommit) {
    return new GitHubLink({ ...this, blobSha, fileText, lastCommit: lastCommit ?? this.lastCommit });
  }

  /**
   * [Push to GitHub] is enabled only when the file to send differs (D8).
   * @purity pure
   * @param {string} fileText - DocumentSession.toFileText(body)
   * @returns {boolean}
   */
  isSameAs(fileText) {
    return fileText === this.fileText;
  }
}
