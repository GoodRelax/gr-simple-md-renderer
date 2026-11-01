/**
 * A file on GitHub (Entity, immutable value): owner, repository, branch and
 * path. The path has no leading "/".
 */
export default class GitHubFileRef {
  /**
   * @purity pure
   * @param {string} owner
   * @param {string} repo
   * @param {string} branch
   * @param {string} path
   */
  constructor(owner, repo, branch, path) {
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.path = String(path).replace(/^\/+/, "");
    Object.freeze(this);
  }

  /**
   * "owner/repo": also the user name the password manager keeps a token under.
   * @purity pure
   * @returns {string}
   */
  repoName() {
    return `${this.owner}/${this.repo}`;
  }

  /**
   * The last path segment: the default name of the first local save.
   * @purity pure
   * @returns {string}
   */
  fileName() {
    return this.path.split("/").pop();
  }

  /**
   * @purity pure
   * @returns {string} e.g. "GoodRelax/repo @main docs/a.md"
   */
  label() {
    return `${this.repoName()} @${this.branch} ${this.path}`;
  }

  /**
   * @purity pure
   * @param {GitHubFileRef|null} other
   * @returns {boolean}
   */
  equals(other) {
    return (
      other instanceof GitHubFileRef &&
      other.owner === this.owner &&
      other.repo === this.repo &&
      other.branch === this.branch &&
      other.path === this.path
    );
  }
}
