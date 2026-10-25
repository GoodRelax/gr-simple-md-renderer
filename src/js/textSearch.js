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
 * A regular expression replacement for one match, as String.replace does
 * it: $$, $&, $1 to $99, $<name>.
 * @purity pure
 * @param {string} template
 * @param {RegExpExecArray} match
 * @returns {string}
 */
export function expandReplacement(template, match) {
  /** @purity pure */
  return template.replace(/\$(\$|&|<([^>]*)>|\d\d?)/g, (all, token, name) => {
    if (token === "$") return "$";
    if (token === "&") return match[0];
    if (name !== undefined) return match.groups?.[name] ?? "";
    const n = Number(token);
    return n > 0 && n < match.length ? (match[n] ?? "") : all;
  });
}

/**
 * The text with one match replaced. A plain search takes the template as
 * it is (no $ forms).
 * @purity pure
 * @param {string} text
 * @param {RegExpExecArray} match
 * @param {string} template
 * @param {boolean} isRegex
 * @returns {string}
 */
export function replaceOne(text, match, template, isRegex) {
  const replacement = isRegex ? expandReplacement(template, match) : template;
  return text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length);
}

/**
 * The text with every match replaced, and how many.
 * @purity pure
 * @param {string} text
 * @param {RegExp} pattern - global
 * @param {string} template
 * @param {boolean} isRegex
 * @returns {{text: string, count: number}}
 */
export function replaceAll(text, pattern, template, isRegex) {
  let count = 0;
  /** @purity non-pure */
  const replaced = text.replace(new RegExp(pattern.source, pattern.flags), (...args) => {
    count++;
    if (!isRegex) return template;
    const groups = typeof args[args.length - 1] === "object" ? args.pop() : undefined;
    const match = args.slice(0, -2);
    match.groups = groups;
    return expandReplacement(template, match);
  });
  return { text: replaced, count };
}
