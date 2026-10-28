import GitHubLink from "./GitHubLink.js";
import { encodePath } from "../gitHubUrl.js";
import { base64ToText, textToBase64, withoutBom } from "../base64Text.js";

const DETAIL_MAX_CHARS = 200;

/**
 * Talks to the GitHub REST API only (Adapter; SC-27). The origin is
 * the fixed CONFIG value, never one read from a URL or a response. The token
 * is given per call and is not kept (owner ruling D11): it goes into the
 * Authorization header only, never into a URL, a message or the console.
 * The requests of one call run one after another; nothing is retried.
 * Every method resolves (no throw): {status: "ok", ...} or {status: "error", message}.
 */
export default class GitHubContentsClient {
  /**
   * @purity non-pure
   * @param {Function} fetchFn - window.fetch (injected)
   * @param {object} options - CONFIG.github
   */
  constructor(fetchFn, options) {
    this._fetch = fetchFn;
    this._options = options;
  }

  /**
   * Read the file, its last commit and whether the repository is private.
   * Only the file read can fail the call; the other two are shown when known.
   * @purity non-pure
   * @param {GitHubFileRef} ref
   * @param {string} token - "" for a public repository without a token
   * @returns {Promise<{status: "ok", link: GitHubLink, text: string, hasBom: boolean}|{status: "error", message: string}>}
   */
  async openFile(ref, token) {
    const m = this._options.messages;
    const file = await this._request("GET", `${this._repoPath(ref)}/contents/${encodePath(ref.path)}?ref=${encodeURIComponent(ref.branch)}`, token);
    if (file.status !== "ok") return file;
    const body = file.body;
    if (!body || Array.isArray(body) || body.type !== "file") return { status: "error", message: m.notFile };
    if (body.size > this._options.maxBytes || body.encoding !== "base64") return { status: "error", message: m.tooLarge };
    const decoded = base64ToText(body.content);
    if (!decoded.ok) return { status: "error", message: m.notText };
    const [commit, repo] = [await this.lastCommit(ref, token), await this._request("GET", this._repoPath(ref), token)];
    const link = new GitHubLink({
      ref,
      blobSha: String(body.sha),
      fileText: decoded.fileText,
      isPrivate: repo.status === "ok" ? Boolean(repo.body?.private) : null,
      lastCommit: commit,
    });
    return { status: "ok", link, text: withoutBom(decoded.fileText), hasBom: decoded.hasBom };
  }

  /**
   * The last commit that changed the file on its branch, or null.
   * @purity non-pure
   * @param {GitHubFileRef} ref
   * @param {string} token
   * @returns {Promise<{sha: string, message: string, author: string, date: string, url: string}|null>}
   */
  async lastCommit(ref, token) {
    const query = `path=${encodeURIComponent(ref.path)}&sha=${encodeURIComponent(ref.branch)}&per_page=1`;
    const result = await this._request("GET", `${this._repoPath(ref)}/commits?${query}`, token);
    const item = result.status === "ok" && Array.isArray(result.body) ? result.body[0] : null;
    return item ? commitSummary(item.sha, item.commit, item.html_url) : null;
  }

  /**
   * Commit the file to its branch (PUT contents with the blob sha it
   * replaces): one request commits and moves the branch. A changed file on
   * GitHub answers 409 and nothing is written.
   * @purity non-pure
   * @param {GitHubLink} link
   * @param {string} fileText - DocumentSession.toFileText(body), BOM as U+FEFF
   * @param {string} message - the commit message
   * @param {string} token
   * @returns {Promise<{status: "ok", link: GitHubLink, commitSha: string}|{status: "error", message: string}>}
   */
  async pushFile(link, fileText, message, token) {
    const ref = link.ref;
    const payload = { message, content: textToBase64(fileText), sha: link.blobSha, branch: ref.branch };
    const result = await this._request("PUT", `${this._repoPath(ref)}/contents/${encodePath(ref.path)}`, token, payload);
    if (result.status !== "ok") return result;
    const content = result.body?.content;
    const commit = result.body?.commit;
    if (!content?.sha || !commit?.sha) return { status: "error", message: this._options.messages.failed(200) };
    const lastCommit = commitSummary(commit.sha, commit, commit.html_url);
    return { status: "ok", link: link.withPushed(String(content.sha), fileText, lastCommit), commitSha: String(commit.sha) };
  }

  /**
   * @purity semi-pure-a
   * @param {GitHubFileRef} ref
   * @returns {string}
   */
  _repoPath(ref) {
    return `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  }

  /**
   * One request to the API origin, with a time limit.
   * @purity non-pure
   * @param {"GET"|"PUT"} method
   * @param {string} path - from "/repos/..."
   * @param {string} token
   * @param {object} [payload]
   * @returns {Promise<{status: "ok", body: any}|{status: "error", message: string}>}
   */
  async _request(method, path, token, payload) {
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": this._options.apiVersion };
    if (token) headers.Authorization = `${this._options.authScheme} ${token}`;
    if (payload) headers["Content-Type"] = "application/json";
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this._options.timeoutMs);
    let response;
    try {
      response = await this._fetch(`${this._options.apiOrigin}${path}`, {
        method,
        headers,
        body: payload ? JSON.stringify(payload) : undefined,
        cache: "no-store", // the API answers max-age=60: a read right after a push must not be the old one
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: abort.signal,
      });
    } catch {
      clearTimeout(timer);
      return { status: "error", message: this._options.messages.network };
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null; // not JSON: the status decides
    } finally {
      clearTimeout(timer);
    }
    if (response.ok) return { status: "ok", body };
    return { status: "error", message: errorMessage(response, body, this._options.messages, this._options.labels) };
  }
}

/**
 * @purity pure
 * @param {string} sha
 * @param {object} commit - a git commit object (message, author)
 * @param {string} url
 * @returns {{sha: string, message: string, author: string, date: string, url: string}}
 */
function commitSummary(sha, commit, url) {
  return {
    sha: String(sha),
    message: String(commit?.message ?? "").split("\n")[0],
    author: String(commit?.author?.name ?? ""),
    date: String(commit?.author?.date ?? commit?.committer?.date ?? ""),
    url: typeof url === "string" && url.startsWith("https://github.com/") ? url : "",
  };
}

/**
 * The toast for a failed response (5.8 of the study). GitHub's own message
 * is added as data (shown with textContent), cut to a length.
 * @purity semi-pure-a
 * @param {Response} response
 * @param {any} body
 * @param {object} m - CONFIG.github.messages
 * @param {object} labels - CONFIG.github.labels
 * @returns {string}
 */
function errorMessage(response, body, m, labels) {
  const text = typeof body?.message === "string" ? body.message.slice(0, DETAIL_MAX_CHARS) : "";
  const detail = text ? labels.gitHubDetail(text) : "";
  const status = response.status;
  if (status === 401) return m.unauthorized;
  if (status === 403 || status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const retryAfter = response.headers.get("retry-after");
    if (status === 429 || remaining === "0" || retryAfter) {
      const reset = Number(response.headers.get("x-ratelimit-reset"));
      const when = retryAfter
        ? labels.retryIn(retryAfter)
        : Number.isFinite(reset) && reset > 0
          ? labels.retryAfter(new Date(reset * 1000).toLocaleTimeString())
          : labels.retryLater;
      return m.rateLimited(when);
    }
    return m.forbidden(detail);
  }
  if (status === 404) return m.notFound;
  if (status === 409) return m.conflict(detail);
  if (status === 422) return m.invalid(detail);
  return m.failed(status);
}
