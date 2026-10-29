// GitHub URLs (SC-28): the file URL the Open GitHub dialog accepts,
// the API paths built from it, and the relative paths of a document opened
// from GitHub. Pure functions; no request is made here.

import GitHubFileRef from "./classes/GitHubFileRef.js";

// A base that never resolves to a real host: only its path is used.
const PATH_BASE_HOST = "repo.invalid";

/**
 * Split the address bar URL of a file page on github.com:
 * https://github.com/<owner>/<repo>/blob/<branch>/<path>. A branch name may
 * contain "/", which the URL cannot tell; the first segment is taken as the
 * branch, and the dialog lets the user correct the branch and the path.
 * @purity pure
 * @param {string} text - what the user pasted
 * @param {{webOrigin: string, rawOrigin: string, extensions: string[]}} options - CONFIG.github
 * @returns {{ok: true, ref: GitHubFileRef}|{ok: false, reason: "notGitHub"|"raw"|"notMarkdown"}}
 */
export function parseGitHubFileUrl(text, options) {
  let url;
  try {
    url = new URL(String(text).trim());
  } catch {
    return { ok: false, reason: "notGitHub" };
  }
  if (url.origin === options.rawOrigin) return { ok: false, reason: "raw" };
  if (url.origin !== options.webOrigin || url.username || url.password) return { ok: false, reason: "notGitHub" };
  const segments = url.pathname.split("/").slice(1).map(decodeSegment);
  const [owner, repo, kind, branch, ...rest] = segments;
  if (!owner || !repo || kind !== "blob" || !branch || rest.length === 0 || rest.some((s) => s === "" || s === null)) {
    return { ok: false, reason: "notGitHub" };
  }
  const path = rest.join("/");
  if (!hasMarkdownExtension(path, options.extensions)) return { ok: false, reason: "notMarkdown" };
  return { ok: true, ref: new GitHubFileRef(owner, repo, branch, path) };
}

/**
 * @purity pure
 * @param {string} path
 * @param {string[]} extensions - lower case, with the dot
 * @returns {boolean}
 */
export function hasMarkdownExtension(path, extensions) {
  const lower = String(path).toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

/**
 * The token the user typed (D12: fine-grained only). Empty is allowed for a
 * read of a public repository.
 * @purity pure
 * @param {string} token - already trimmed
 * @param {string} prefix - CONFIG.github.tokenPrefix
 * @returns {"empty"|"fineGrained"|"other"}
 */
export function classifyToken(token, prefix) {
  if (token === "") return "empty";
  return token.startsWith(prefix) && /^[A-Za-z0-9_]+$/.test(token) ? "fineGrained" : "other";
}

/**
 * A relative URL in a document opened from GitHub, made absolute as GitHub
 * shows it: an image to the raw file host (still behind the external image
 * gate, INV-19), a link to the file page on github.com. "/x" is from the
 * repository root, as on GitHub. Absolute URLs ("https:", "mailto:", "//"),
 * fragments ("#x") and empty values are left alone (null).
 * @purity pure
 * @param {GitHubFileRef} ref - the document's file
 * @param {string} value - the src or href as written
 * @param {"image"|"link"} kind
 * @param {{webOrigin: string, rawOrigin: string}} options - CONFIG.github
 * @returns {string|null} the new URL, or null to keep the value
 */
export function resolveRelativeUrl(ref, value, kind, options) {
  const text = String(value ?? "").trim();
  if (text === "" || text.startsWith("#") || text.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(text)) return null;
  let resolved;
  try {
    const base = new URL(`https://${PATH_BASE_HOST}/${encodePath(ref.path)}`);
    resolved = new URL(text, base);
  } catch {
    return null;
  }
  if (resolved.host !== PATH_BASE_HOST) return null;
  const repoPath = resolved.pathname; // starts with "/", percent-encoded
  const branch = encodePath(ref.branch);
  const repo = `${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  if (kind === "image") return `${options.rawOrigin}/${repo}/${branch}${repoPath}`;
  return `${options.webOrigin}/${repo}/blob/${branch}${repoPath}${resolved.search}${resolved.hash}`;
}

/**
 * A branch, path, owner or repo whose "/"-separated segments include "", "."
 * or ".." would leave the API path it is put in (the URL parser resolves
 * dot segments): it is refused before anything is sent.
 * @purity pure
 * @param {string} text
 * @returns {boolean}
 */
export function hasUnsafeSegment(text) {
  return String(text).split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

/**
 * Each "/"-separated segment percent-encoded (the separators kept).
 * @purity pure
 * @param {string} path
 * @returns {string}
 */
export function encodePath(path) {
  return String(path).split("/").map(encodeURIComponent).join("/");
}

/**
 * @purity pure
 * @param {string} segment
 * @returns {string|null} null when it is not valid percent-encoding
 */
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
