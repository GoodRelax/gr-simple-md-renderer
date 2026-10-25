// ========================================
// Pure text transforms (no DOM, no CONFIG)
// ========================================

// Leading blank lines, an opening fence of 3+ backticks, the "markdown" tag,
// optional whitespace, and a newline (spec 5.13 rule 1). Each blank line is
// white space other than a newline, then the newline: the lines split one
// way only, so the time is linear in their number. With \s (which holds the
// newline) in its place, each line doubled the time on a text without the
// wrapper (ReDoS).
const WRAPPER_OPEN_RE = /^(?:[^\S\n]*\n)*(`{3,})markdown\s*\n/i;

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
 * The length of the run of chars at the end of text, counted from the end:
 * linear in the run. In place of a pattern like /[ \t]+$/ or /\n*$/, which
 * reads a long run that is not at the end again from every start in it
 * (quadratic, ReDoS), and of a lookbehind, which Safari before 16.4 cannot
 * parse (P-05).
 * @purity pure
 * @param {string} text
 * @param {string} chars - the characters of the run, e.g. " \t"
 * @returns {number}
 */
export function trailingRunLength(text, chars) {
  let i = text.length;
  while (i > 0 && chars.includes(text[i - 1])) i--;
  return text.length - i;
}

/**
 * text without the run of chars at its end (trailingRunLength).
 * @purity pure
 * @param {string} text
 * @param {string} chars
 * @returns {string}
 */
export function trimTrailingRun(text, chars) {
  return text.slice(0, text.length - trailingRunLength(text, chars));
}

/**
 * The run of chars at the end of text (trailingRunLength); "" when none.
 * @purity pure
 * @param {string} text
 * @param {string} chars
 * @returns {string}
 */
export function trailingRun(text, chars) {
  return text.slice(text.length - trailingRunLength(text, chars));
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
