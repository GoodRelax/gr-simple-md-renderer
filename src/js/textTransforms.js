// ========================================
// Pure text transforms (no DOM, no CONFIG)
// ========================================

// Leading blank lines, an opening fence of 3+ backticks, the "markdown" tag,
// optional whitespace, and a newline (spec 5.13 rule 1).
const WRAPPER_OPEN_RE = /^(?:\s*\n)*(`{3,})markdown\s*\n/i;

/**
 * Split an AI-style ```markdown wrapper off a document (spec 5.13).
 * The input is LF text. The wrapper is removed only when both the opening
 * fence and a closing fence with the same number of backticks are present.
 * Nothing is trimmed: prefix + body + suffix always equals the input.
 * @purity pure
 * @param {string} text - LF-normalized text
 * @returns {{prefix: string, body: string, suffix: string}}
 */
export function splitMarkdownWrapper(text) {
  const unchanged = { prefix: "", body: text, suffix: "" };
  const open = WRAPPER_OPEN_RE.exec(text);
  if (!open) return unchanged;

  const fence = open[1];
  // A newline, exactly the same number of backticks, then only whitespace (rule 2).
  const close = new RegExp("\\n`{" + fence.length + "}\\s*$").exec(text);
  if (!close) return unchanged;

  const prefix = open[0];
  const suffix = close[0];
  // The two fences must not share characters (rule 4, e.g. an empty wrapper).
  if (prefix.length > close.index) return unchanged;

  return {
    prefix,
    body: text.slice(prefix.length, close.index),
    suffix,
  };
}

/**
 * Line ending to save with (INV-44): the majority of CRLF and LF, where the LF
 * of a CRLF is not counted as LF. A tie, no newline, or a file of lone CRs is LF.
 * @purity pure
 * @param {string} text - decoded file text, before normalization
 * @returns {"\n"|"\r\n"}
 */
export function detectLineEnding(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

/**
 * Turn CRLF and lone CR into LF (INV-44).
 * @purity pure
 * @param {string} text
 * @returns {string}
 */
export function normalizeLineEndings(text) {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * Turn the LF of LF-normalized text into the given line ending (save path).
 * @purity pure
 * @param {string} lfText
 * @param {"\n"|"\r\n"} lineEnding
 * @returns {string}
 */
export function convertLineEndings(lfText, lineEnding) {
  return lineEnding === "\r\n" ? lfText.replace(/\n/g, "\r\n") : lfText;
}

/**
 * True when the bytes start with the UTF-8 BOM (EF BB BF).
 * @purity pure
 * @param {Uint8Array} bytes - the head of the file (at least 3 bytes to be true)
 * @returns {boolean}
 */
export function hasUtf8Bom(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}
