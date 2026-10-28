// INV-84: where a place in a block's rendered text is in the block's
// source, and back. The rendered text is matched to the source character by
// character, whitespace left out: what the markup adds (list and quote
// markers, heading marks, a code fence, emphasis marks, link destinations,
// HTML tags) is passed over, and a rendered character with no match nearby
// (an entity, math drawn by KaTeX) is left unmatched. A heuristic: a link
// destination or a tag it does not see as one can take a few characters;
// the caret then lands a few characters off, never outside the block.
// Pure module: it imports nothing and reads no global state. Reading the
// rendered text and measuring it on screen is BlockCaretMap's.

// How far past the last match a rendered character is looked for.
const SEARCH_WINDOW = 64;
// What starts a line of the source and is not rendered as text: indent,
// quote markers, a list marker, a task box, heading marks.
const LINE_PREFIX = /^[ \t>]*(?:[-*+][ \t]+|\d{1,9}[.)][ \t]+)?(?:\[[ xX]\][ \t]+)?(?:#{1,6}(?:[ \t]+|$))?/;
const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})[^\n]*(?:\n|$)/;
// A link's destination (from its "(" to its ")"; one pair of parentheses
// inside it, and a quoted title), and an HTML tag (not an autolink, whose
// text is shown). No nested quantifier (AT-STA-18).
const HIDDEN_PARTS = /\]\([^()\s]*(?:\([^()]*\)[^()\s]*)?(?:\s+(?:"[^"]*"|'[^']*'))?\)|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g;

/**
 * For each character of rendered that is not whitespace, the index of the
 * source character it matches, or -1. It stops after maxCount characters,
 * or at the first match at or past stopAt (included).
 * @purity pure
 * @param {string} source - the block's source (as the editor shows it)
 * @param {string} rendered - the block's rendered text
 * @param {string|null} type - the block's type ("code": its fence line is
 *   passed over, and its lines have no markers)
 * @param {number} [maxCount]
 * @param {number} [stopAt]
 * @returns {number[]}
 */
export function align(source, rendered, type, maxCount = Infinity, stopAt = Infinity) {
  const code = type === "code";
  const hidden = code ? null : hiddenMask(source);
  const out = [];
  let from = code ? afterFence(source) : skipPrefix(source, 0);
  for (let i = 0; i < rendered.length && out.length < maxCount; i++) {
    const ch = rendered.charCodeAt(i);
    if (isSpace(ch)) continue;
    const limit = Math.min(source.length, from + SEARCH_WINDOW);
    let found = -1;
    for (let k = from; k < limit; k++) {
      const at = source.charCodeAt(k);
      if (at === 10 && !code) {
        k = skipPrefix(source, k + 1) - 1;
        continue;
      }
      if (at === ch && !(hidden && hidden[k])) {
        found = k;
        break;
      }
    }
    out.push(found);
    if (found >= 0) {
      from = found + 1;
      if (found >= stopAt) break;
    }
  }
  return out;
}

/**
 * The source offset for a caret in the rendered text: count characters
 * that are not whitespace are before it; afterSpace: whitespace (or the
 * start) is right before it, so it goes before the next character, else
 * right after the one before (outside the markup between them).
 * @purity pure
 * @param {string} source
 * @param {string} rendered
 * @param {string|null} type
 * @param {number} count
 * @param {boolean} afterSpace
 * @param {number} [index] - the caret's index in rendered: a code block
 *   shows its source as it is, so the source offset is found at once when
 *   the text before the caret is the same in both
 * @returns {number}
 */
export function sourceOffsetFor(source, rendered, type, count, afterSpace, index = -1) {
  if (type === "code" && index >= 0) {
    const start = afterFence(source);
    if (source.startsWith(rendered.slice(0, index), start)) return start + index;
  }
  // the characters up to the caret, and a few after it to find the next match
  const matches = align(source, rendered, type, count + SEARCH_WINDOW);
  if (afterSpace || count === 0) {
    for (let i = count; i < matches.length; i++) if (matches[i] >= 0) return matches[i];
  }
  for (let i = Math.min(count, matches.length) - 1; i >= 0; i--) if (matches[i] >= 0) return matches[i] + 1;
  return type === "code" ? afterFence(source) : skipPrefix(source, 0);
}

/**
 * The rendered place for a source offset: how many rendered characters
 * that are not whitespace come before it, and whether it is right after
 * one of them (false) or before the next (true: the offset is not right
 * after a matched character).
 * @purity pure
 * @param {string} source
 * @param {string} rendered
 * @param {string|null} type
 * @param {number} offset
 * @returns {{count: number, afterSpace: boolean}}
 */
export function renderedPlaceFor(source, rendered, type, offset) {
  if (type === "code") {
    const start = afterFence(source);
    const index = offset - start;
    if (index >= 0 && index <= rendered.length && source.startsWith(rendered.slice(0, index), start)) {
      return { count: countText(rendered, index), afterSpace: index === 0 || isSpace(rendered.charCodeAt(index - 1)) };
    }
  }
  const matches = align(source, rendered, type, Infinity, offset);
  let count = 0;
  let last = -1;
  for (let i = 0; i < matches.length; i++) {
    if (matches[i] < 0) continue;
    if (matches[i] >= offset) break;
    count = i + 1;
    last = matches[i];
  }
  return { count, afterSpace: last < 0 || last + 1 !== offset };
}

/**
 * Whitespace as /\s/ sees it (by its code, to keep long texts fast).
 * @purity pure
 * @param {number} code
 * @returns {boolean}
 */
export function isSpace(code) {
  if (code <= 32) return code === 32 || (code >= 9 && code <= 13);
  if (code < 160) return false;
  return code === 160 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

/**
 * @purity pure
 * @param {string} text
 * @param {number} end
 * @returns {number} the characters before end that are not whitespace
 */
export function countText(text, end) {
  let count = 0;
  for (let i = 0; i < end; i++) if (!isSpace(text.charCodeAt(i))) count++;
  return count;
}

/**
 * @purity pure
 * @param {string} text
 * @param {number} end
 * @returns {number} the lines of text before end (1 when there is no line break)
 */
export function countLines(text, end) {
  let lines = 1;
  for (let i = text.indexOf("\n"); i >= 0 && i < end; i = text.indexOf("\n", i + 1)) lines++;
  return lines;
}

/**
 * @purity pure
 * @param {string} source
 * @returns {Uint8Array} 1 where a character is in a link destination or a tag
 */
function hiddenMask(source) {
  const mask = new Uint8Array(source.length);
  for (const m of source.matchAll(HIDDEN_PARTS)) {
    // a link's "]" is shown text's end: only from its "(" on
    const start = m[0][0] === "]" ? m.index + 1 : m.index;
    mask.fill(1, start, m.index + m[0].length);
  }
  return mask;
}

/**
 * @purity pure
 * @param {string} source
 * @param {number} at - the start of a line
 * @returns {number} past the line's prefix
 */
function skipPrefix(source, at) {
  const m = LINE_PREFIX.exec(source.slice(at, at + 64));
  return at + (m ? m[0].length : 0);
}

/**
 * @purity pure
 * @param {string} source
 * @returns {number} past the opening fence line, or 0 (an indented block)
 */
function afterFence(source) {
  const m = FENCE_LINE.exec(source);
  return m ? m[0].length : 0;
}
