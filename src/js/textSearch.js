// Search and replace in a text (owner ruling 2026-10-25): a plain search or
// a JavaScript regular expression, ^ and $ at each line. Pure module: it
// imports nothing and reads no global state.

/**
 * The pattern for a query; null for an empty query. Throws a SyntaxError
 * for an invalid regular expression.
 * @purity pure
 * @param {string} query
 * @param {{isRegex: boolean, matchCase: boolean}} options
 * @returns {RegExp|null}
 */
export function searchPattern(query, { isRegex, matchCase }) {
  if (query === "") return null;
  const source = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(source, matchCase ? "gm" : "gim");
}

/**
 * The matches of pattern in text, in order, at most limit of them. An
 * empty match counts (e.g. ^ at each line) and the search moves on by one.
 * @purity pure
 * @param {string} text
 * @param {RegExp} pattern - global
 * @param {number} limit
 * @returns {RegExpExecArray[]}
 */
export function findMatches(text, pattern, limit) {
  const re = new RegExp(pattern.source, pattern.flags);
  const matches = [];
  let m;
  while (matches.length < limit && (m = re.exec(text)) !== null) {
    matches.push(m);
    if (m[0] === "") re.lastIndex++;
  }
  return matches;
}

/**
 * Where needle occurs in hay, in order, not overlapping: the one walk of
 * both the count of the n-th place (countOccurrences) and the search of the
 * rendered text (DocumentSearch), so the two agree.
 * @purity pure
 * @param {string} hay
 * @param {string} needle - not empty
 * @returns {Generator<number>}
 */
export function* occurrences(hay, needle) {
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) yield at;
}

/**
 * How many times needle occurs (not overlapping) in hay; 0 for an empty
 * needle.
 * @purity pure
 * @param {string} hay
 * @param {string} needle
 * @returns {number}
 */
export function countOccurrences(hay, needle) {
  if (needle === "") return 0;
  let count = 0;
  for (const _at of occurrences(hay, needle)) count++;
  return count;
}

/**
 * The text with one match replaced. A plain search takes the template as
 * it is (no $ forms); a regular expression's template is expanded by the
 * browser's String.prototype.replace ($$, $&, $`, $', $1 to $99, $<name>,
 * each as it reads them), on the same expression at the match: sticky,
 * from its index, so ^, $ and look-behinds see the text around it.
 * @purity pure
 * @param {string} text
 * @param {RegExpExecArray} match
 * @param {RegExp} pattern - the pattern of the match
 * @param {string} template
 * @param {boolean} isRegex
 * @returns {string}
 */
export function replaceOne(text, match, pattern, template, isRegex) {
  if (!isRegex) return text.slice(0, match.index) + template + text.slice(match.index + match[0].length);
  const at = new RegExp(pattern.source, pattern.flags.replace("g", "") + "y");
  at.lastIndex = match.index;
  return text.replace(at, template);
}

/**
 * The text with every match replaced, and how many (as findMatches counts
 * them, with no limit). A regular expression's template is expanded by
 * String.prototype.replace, a plain one is taken as it is.
 * @purity pure
 * @param {string} text
 * @param {RegExp} pattern - global
 * @param {string} template
 * @param {boolean} isRegex
 * @returns {{text: string, count: number}}
 */
export function replaceAll(text, pattern, template, isRegex) {
  const re = new RegExp(pattern.source, pattern.flags);
  if (isRegex) return { text: text.replace(re, template), count: findMatches(text, pattern, Infinity).length };
  let count = 0;
  /** @purity non-pure */
  const replaced = text.replace(re, () => {
    count++;
    return template;
  });
  return { text: replaced, count };
}
