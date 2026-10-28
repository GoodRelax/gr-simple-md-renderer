// ========================================
// JSON fold and unfold, one level at a time (no DOM, no CONFIG)
// ========================================
//
// "Fold" puts a { } or [ ] that spans several lines on one line with its
// members; "unfold" spreads a one-line { } or [ ] over lines again (NE-10,
// NE-21, NE-22). Both rewrite the text; the root pair is never folded.

/**
 * The index of the quote that closes the string opening at i, or the end
 * of the text when the string is not closed. Backslash escapes are skipped.
 * @purity pure
 * @param {string} text
 * @param {number} i - the index of the opening quote
 * @returns {number}
 */
function stringEnd(text, i) {
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === "\\") j++;
    else if (c === '"') return j;
  }
  return text.length;
}

/**
 * The bracket pairs of a JSON text, in the order they close. Strings are
 * skipped. Depth: the root value's pair is 0.
 * @purity pure
 * @param {string} text - LF text
 * @returns {{open: number, close: number, openLine: number, closeLine: number, depth: number}[]}
 */
function bracketPairs(text) {
  const pairs = [];
  const stack = [];
  let line = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') i = stringEnd(text, i);
    else if (c === "\n") line++;
    else if (c === "{" || c === "[") stack.push({ open: i, openLine: line, depth: stack.length });
    else if ((c === "}" || c === "]") && stack.length > 0) {
      const p = stack.pop();
      pairs.push({ open: p.open, close: i, openLine: p.openLine, closeLine: line, depth: p.depth });
    }
  }
  return pairs;
}

/**
 * True when the text is valid JSON.
 * @purity pure
 * @param {string} text
 * @returns {boolean}
 */
function isValidJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fold one level (NE-22): of the pairs whose brackets are on different
 * lines, those of the greatest depth >= 1 (never the root) are each put on
 * one line. The text before the open bracket on its line stays; each
 * following line up to the close bracket's line is trimmed, empty ones are
 * dropped, and the pieces are joined with one space. The text after the
 * close bracket on its line stays.
 * @purity pure
 * @param {string} text - LF text
 * @returns {{text: string, changed: boolean}|{error: "invalid"}}
 */
export function foldJsonOnce(text) {
  if (!isValidJson(text)) return { error: "invalid" };
  const spread = bracketPairs(text).filter((p) => p.depth >= 1 && p.openLine !== p.closeLine);
  if (spread.length === 0) return { text, changed: false };
  let deepest = 0;
  for (const p of spread) if (p.depth > deepest) deepest = p.depth;

  const lines = text.split("\n");
  // joined[k]: the break after line k goes away
  const joined = new Uint8Array(lines.length);
  for (const p of spread) {
    if (p.depth === deepest) joined.fill(1, p.openLine, p.closeLine);
  }
  const out = [];
  let k = 0;
  while (k < lines.length) {
    const pieces = [lines[k].trimEnd()];
    while (joined[k] === 1 && k + 1 < lines.length) {
      k++;
      const piece = lines[k].trim();
      if (piece !== "") pieces.push(piece);
    }
    out.push(pieces.join(" "));
    k++;
  }
  return { text: out.join("\n"), changed: true };
}

/**
 * The top-level members between the brackets of a pair, split at commas
 * outside nested pairs and strings, each trimmed (the pair is not empty).
 * @purity pure
 * @param {string} text
 * @param {number} open - the index of the open bracket
 * @param {number} close - the index of the close bracket
 * @returns {string[]}
 */
function pairMembers(text, open, close) {
  const members = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open + 1; i < close; i++) {
    const c = text[i];
    if (c === '"') i = stringEnd(text, i);
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      members.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  members.push(text.slice(from, close).trim());
  return members;
}

/**
 * True when only white space is between the brackets of a pair.
 * @purity pure
 * @param {string} text
 * @param {number} open
 * @param {number} close
 * @returns {boolean}
 */
function isEmptyPair(text, open, close) {
  let i = open + 1;
  while (i < close && " \t\n\r".includes(text[i])) i++;
  return i === close;
}

/**
 * The spaces and tabs at the start of the line holding offset.
 * @purity pure
 * @param {string} text
 * @param {number} offset
 * @returns {string}
 */
function lineIndentAt(text, offset) {
  const start = offset > 0 ? text.lastIndexOf("\n", offset - 1) + 1 : 0;
  let i = start;
  while (text[i] === " " || text[i] === "\t") i++;
  return text.slice(start, i);
}

/**
 * Unfold one level (NE-22): of the pairs with both brackets on one line and
 * at least one member, those of the smallest depth (the root included) are
 * each spread out. The open bracket stays and ends its line; each member
 * goes on its own line at the line's indent plus unit, with its ","; the
 * close bracket goes on its own line at the line's indent, followed by what
 * followed it. Several pairs (even on one line) go in one call.
 * @purity pure
 * @param {string} text - LF text
 * @param {string} unit - the indent unit, e.g. "  "
 * @returns {{text: string, changed: boolean}|{error: "invalid"}}
 */
export function unfoldJsonOnce(text, unit) {
  if (!isValidJson(text)) return { error: "invalid" };
  const candidates = bracketPairs(text).filter((p) => p.openLine === p.closeLine && !isEmptyPair(text, p.open, p.close));
  let shallowest = Infinity;
  for (const p of candidates) if (p.depth < shallowest) shallowest = p.depth;
  const chosen = candidates.filter((p) => p.depth === shallowest).sort((a, b) => a.open - b.open);
  if (chosen.length === 0) return { text, changed: false };

  const parts = [];
  let from = 0;
  for (const p of chosen) {
    const indent = lineIndentAt(text, p.open);
    const members = pairMembers(text, p.open, p.close);
    parts.push(text.slice(from, p.open + 1), "\n");
    members.forEach((m, i) => parts.push(indent, unit, m, i < members.length - 1 ? ",\n" : "\n"));
    parts.push(indent, text[p.close]);
    from = p.close + 1;
  }
  parts.push(text.slice(from));
  return { text: parts.join(""), changed: true };
}
