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
