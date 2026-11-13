// Spec: INV-110. The reload mark on external image URLs (owner ruling JGQA W1, W2 = a, 2026-11-13).
import { srcsetCandidates } from "./srcset.js";
import { stripUrlEnds } from "./urlEnds.js";

/** Spec: INV-110 (2). The query parameter name of the mark. */
export const RELOAD_MARK_PARAM = "grsmd";

/**
 * Spec: INV-110 (3). Query parameter names (lower case) that mark a signed URL. The comment above each group names
 * its source: the service whose signed or temporary URLs carry these names.
 * Why: A signature may cover the whole query, so an added parameter can make the host refuse the image
 */
const SIGNED_URL_PARAMS = new Set([
  // Spec: INV-110 (3). Azure Blob Storage shared access signature (SAS).
  "sig",
  "se",
  // Spec: INV-110 (3). Amazon CloudFront signed URL; signature is also used by Amazon S3 (Signature Version 2), Google Cloud Storage (V2) and Alibaba Cloud OSS (V1).
  "signature",
  "key-pair-id",
  "policy",
  // Spec: INV-110 (3). Amazon S3 presigned URL (Signature Version 4).
  "x-amz-signature",
  "x-amz-credential",
  "x-amz-security-token",
  // Spec: INV-110 (3). Google Cloud Storage signed URL (V4).
  "x-goog-signature",
  "x-goog-credential",
  // Spec: INV-110 (3). Alibaba Cloud OSS signed URL (V4).
  "x-oss-signature",
  // Spec: INV-110 (3). Tencent Cloud COS signed URL.
  "q-signature",
  // Spec: INV-110 (3). Akamai token authentication.
  "hdnts",
  "hdnea",
  "__token__",
  // Spec: INV-110 (3). SharePoint and OneDrive download URL.
  "tempauth",
  // Spec: INV-110 (3). GitHub raw file URL of a private repository.
  "token",
]);

const RELOADABLE_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Spec: INV-110 (2). The URL without its fragment, and the fragment with its "#".
 * @purity pure
 * @param {string} url
 * @returns {{head: string, fragment: string}}
 */
function splitFragment(url) {
  const at = url.indexOf("#");
  return at < 0 ? { head: url, fragment: "" } : { head: url.slice(0, at), fragment: url.slice(at) };
}

/**
 * Spec: INV-110 (3).
 * @purity pure
 * @param {string} name - one query parameter name as written
 * @returns {string} the name decoded and in lower case, or as written in lower case when it cannot be decoded
 */
function paramKey(name) {
  try {
    return decodeURIComponent(name.replace(/\+/g, " ")).toLowerCase();
  } catch (_) {
    return name.toLowerCase();
  }
}

/**
 * Spec: INV-110 (3).
 * @purity pure
 * @param {string} url - as written in the document
 * @returns {boolean} true when the query has a parameter of SIGNED_URL_PARAMS
 */
export function isSignedUrl(url) {
  const { head } = splitFragment(stripUrlEnds(url));
  const at = head.indexOf("?");
  if (at < 0) return false;
  return head
    .slice(at + 1)
    .split("&")
    .some((pair) => SIGNED_URL_PARAMS.has(paramKey(pair.split("=")[0])));
}

/**
 * Spec: INV-110 (2)(3).
 * @purity pure
 * @param {string} url - as written in the document
 * @param {string} baseUrl - what a relative URL resolves against (document.baseURI)
 * @returns {boolean} true when the URL resolves to http: or https: and is not signed
 */
export function isReloadable(url, baseUrl) {
  let protocol;
  try {
    protocol = new URL(stripUrlEnds(url), baseUrl).protocol;
  } catch (_) {
    return false;
  }
  return RELOADABLE_PROTOCOLS.has(protocol) && !isSignedUrl(url);
}

/**
 * Spec: INV-110 (2)(3). The rest of the URL stays as written.
 * @purity pure
 * @param {string} url - as written in the document
 * @param {string|null} mark - the reload mark, or null for none
 * @param {string} baseUrl - what a relative URL resolves against (document.baseURI)
 * @returns {string}
 */
export function markUrlForReload(url, mark, baseUrl) {
  if (mark === null || !isReloadable(url, baseUrl)) return url;
  const { head, fragment } = splitFragment(stripUrlEnds(url));
  const pair = `${RELOAD_MARK_PARAM}=${encodeURIComponent(mark)}`;
  if (!head.includes("?")) return `${head}?${pair}${fragment}`;
  const joiner = head.endsWith("?") || head.endsWith("&") ? "" : "&";
  return `${head}${joiner}${pair}${fragment}`;
}

/**
 * Spec: INV-110 (4). Each candidate keeps its descriptors; the candidates are joined with ", ".
 * @purity pure
 * @param {string} srcset
 * @param {string|null} mark - the reload mark, or null for none
 * @param {string} baseUrl - what a relative URL resolves against (document.baseURI)
 * @returns {string}
 */
export function markSrcsetForReload(srcset, mark, baseUrl) {
  if (mark === null) return srcset;
  return srcsetCandidates(srcset)
    .map(
      /** @purity pure */
      ({ url, descriptors }) => {
        const marked = markUrlForReload(url, mark, baseUrl);
        return descriptors ? `${marked} ${descriptors}` : marked;
      },
    )
    .join(", ");
}
