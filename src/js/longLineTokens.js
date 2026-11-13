import { CONFIG } from "./config.js";
import { ZWJ, isLowSurrogate } from "./hiddenChars.js";
import { escapeHtml } from "./utils.js";

// Spec: INV-86 (e).
// Why: the pure core of a long line's colors, apart from the DOM and the ranges of LongLineColors (spec 5.16)

export const CHUNK_CLASS = "code-edit-chunk";
export const TOKENS_ATTRIBUTE = "data-tokens";

// Why: a CSS highlight paints one color, so the classes that share a color share a group
export const COLOR_GROUPS = [
  ["keyword", ["hljs-doctag", "hljs-keyword", "hljs-template-tag", "hljs-template-variable", "hljs-type", "language_"]],
  ["title", ["hljs-title"]],
  ["attr", ["hljs-attr", "hljs-attribute", "hljs-literal", "hljs-meta", "hljs-number", "hljs-operator", "hljs-variable", "hljs-selector-attr", "hljs-selector-class", "hljs-selector-id"]],
  ["string", ["hljs-regexp", "hljs-string"]],
  ["built-in", ["hljs-built_in", "hljs-symbol"]],
  ["comment", ["hljs-comment", "hljs-code", "hljs-formula"]],
  ["name", ["hljs-name", "hljs-quote", "hljs-selector-tag", "hljs-selector-pseudo"]],
  ["subst", ["hljs-subst"]],
  ["section", ["hljs-section"]],
  ["bullet", ["hljs-bullet"]],
  ["emphasis", ["hljs-emphasis"]],
  ["strong", ["hljs-strong"]],
  ["addition", ["hljs-addition"]],
  ["deletion", ["hljs-deletion"]],
];
const GROUP_OF_CLASS = new Map(COLOR_GROUPS.flatMap(([, classes], group) => classes.map((name) => [name, group])));

const MARKUP = /<span class="([^"]*)">|<\/span>|&(amp|lt|gt|quot|#x27|#39);/g;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#x27": "'", "#39": "'" };

// Spec: INV-86 (e).
const CHUNK_CUT_LOOKAHEAD_CHARS = 64;
// Why: two of these in a row are a flag, paired from the first of their run, so a cut reads the whole run
const REGIONAL_INDICATOR_FIRST = 0x1f1e6;
const REGIONAL_INDICATOR_LAST = 0x1f1ff;

// Section: pure

/**
 * @purity pure
 * @param {(number|null)[]} openGroups - the color groups of the spans open, innermost last; null: no color
 * @returns {number|null} null: no color
 */
function innermostGroup(openGroups) {
  return openGroups.findLast((entry) => entry !== null) ?? null;
}

/**
 * Why: the margin keeps a rounding of the sum from stepping over the step
 * @purity pure
 * @param {number} widthPx - a character's width
 * @param {number} stepPx
 * @param {number} marginPx
 * @returns {number} px
 */
export function charSpacingPx(widthPx, stepPx, marginPx) {
  return Math.ceil(widthPx / stepPx) * stepPx - marginPx - widthPx;
}

/**
 * @purity pure
 * @param {string} text
 * @param {number} length
 * @returns {boolean}
 */
export function hasLineOver(text, length) {
  let start = 0;
  for (let end = text.indexOf("\n"); end >= 0; end = text.indexOf("\n", start)) {
    if (end - start > length) return true;
    start = end + 1;
  }
  return text.length - start > length;
}

/**
 * @purity pure
 * @param {number} offset
 * @param {{at: number, removed: number, inserted: number}} change
 * @param {boolean} isTokenEnd - an offset just at the place stays there
 * @returns {number}
 */
function offsetAfterEdit(offset, { at, removed, inserted }, isTokenEnd) {
  if (offset < at || (isTokenEnd && offset === at)) return offset;
  return offset >= at + removed ? offset + inserted - removed : at;
}

/**
 * Why: a character typed in a token takes that token's color
 * @purity pure
 * @param {number[][]} tokens - [group, start, end]
 * @param {number} at - the edit's place
 * @param {number} removed - characters removed there
 * @param {number} inserted - characters inserted there
 * @returns {number[][]}
 */
export function editedTokens(tokens, at, removed, inserted) {
  const change = { at, removed, inserted };
  return tokens.map(([group, start, end]) => [group, offsetAfterEdit(start, change, false), offsetAfterEdit(end, change, true)]).filter(([, start, end]) => start < end);
}

/**
 * Spec: INV-86 (e).
 * @purity pure
 * @param {number[][]} tokens - [group, start, end], in order
 * @param {number[]} starts - each line's offset in the text, in order
 * @param {number[]} ends - each line's end (its line feed's offset, or the text's end)
 * @returns {number[][][]} the tokens of each line
 */
export function tokensByLine(tokens, starts, ends) {
  const lines = starts.map(() => []);
  let lineIndex = 0;
  for (const [group, start, end] of tokens) {
    while (lineIndex < ends.length - 1 && ends[lineIndex] <= start) lineIndex++;
    for (let at = lineIndex; at < starts.length && starts[at] < end; at++) {
      const from = Math.max(start, starts[at]);
      const to = Math.min(end, ends[at]);
      if (from < to) lines[at].push([group, from - starts[at], to - starts[at]]);
    }
  }
  return lines;
}

/**
 * @purity pure
 * @param {string|null} value - a chunk's data-tokens; null: the chunk has no such attribute
 * @returns {number[][]} [group, start, end]; empty for null
 */
export function tokensFromJson(value) {
  return value ? JSON.parse(value) : [];
}

/**
 * @purity pure
 * @param {number[][]} tokens - [group, start, end]
 * @returns {string} a chunk's data-tokens: numbers only, so it needs no escaping
 */
export function tokensJson(tokens) {
  return JSON.stringify(tokens);
}

// Section: semi-pure-immutable

/**
 * Spec: INV-86 (e).
 * @purity semi-pure-immutable
 * @param {string} text
 * @param {number} from - the place
 * @param {number} floor - the chunk's start, a grapheme boundary
 * @returns {number}
 */
function graphemeReadStart(text, from, floor) {
  let at = from;
  if (at > floor && isLowSurrogate(text.charCodeAt(at))) at--;
  while (at - 2 >= floor) {
    const before = text.codePointAt(at - 2);
    if (before < REGIONAL_INDICATOR_FIRST || before > REGIONAL_INDICATOR_LAST) break;
    at -= 2;
  }
  return at;
}

/**
 * Spec: INV-86 (e).
 * Why: a cluster cut in two is drawn as two (an emoji with its skin tone, a flag, a letter with its marks)
 * @purity semi-pure-immutable
 * @param {string} text
 * @param {number} start - the chunk's start
 * @param {number} end - the place
 * @param {Intl.Segmenter} graphemes
 * @returns {number}
 */
function chunkEnd(text, start, end, graphemes) {
  if (end >= text.length) return text.length;
  const from = graphemeReadStart(text, Math.max(start, end - CHUNK_CUT_LOOKAHEAD_CHARS), start);
  for (const { index } of graphemes.segment(text.slice(from, end + CHUNK_CUT_LOOKAHEAD_CHARS))) {
    const at = from + index;
    if (at >= end && text.charCodeAt(at - 1) !== ZWJ) return at;
  }
  return end;
}

/**
 * Why: "language_" goes first: the rule for .hljs-variable.language_ is the keyword's
 * @purity semi-pure-immutable
 * @param {string} classes - the span's class attribute
 * @returns {number|null} null: no color
 */
function colorGroup(classes) {
  const names = classes.split(" ");
  if (names.includes("language_")) return GROUP_OF_CLASS.get("language_");
  const known = names.find((name) => GROUP_OF_CLASS.has(name));
  return known === undefined ? null : GROUP_OF_CLASS.get(known);
}

/**
 * @purity semi-pure-immutable
 * @param {string} html - a line's highlight.js HTML
 * @returns {{part: string, group: number|null}[]} its text in runs, each with the color of its innermost colored span; null: no color
 */
function textRuns(html) {
  const runs = [];
  const openGroups = [];
  let at = 0;
  for (const match of html.matchAll(MARKUP)) {
    if (match.index > at) runs.push({ part: html.slice(at, match.index), group: innermostGroup(openGroups) });
    at = match.index + match[0].length;
    if (match[1] !== undefined) openGroups.push(colorGroup(match[1]));
    else if (match[2] !== undefined) runs.push({ part: ENTITIES[match[2]], group: innermostGroup(openGroups) });
    else openGroups.pop();
  }
  if (at < html.length) runs.push({ part: html.slice(at), group: innermostGroup(openGroups) });
  return runs;
}

/**
 * Spec: INV-86 (e).
 * @purity semi-pure-immutable
 * @param {string} html
 * @returns {{text: string, tokens: number[][]}} tokens: [group, start, end]
 */
export function lineTokens(html) {
  const runs = textRuns(html);
  const tokens = [];
  let length = 0;
  for (const { part, group } of runs) {
    const end = length + part.length;
    const last = tokens.at(-1);
    if (group !== null) {
      if (last && last[0] === group && last[2] === length) last[2] = end;
      else tokens.push([group, length, end]);
    }
    length = end;
  }
  return { text: runs.map(({ part }) => part).join(""), tokens };
}

/**
 * Spec: INV-86 (e).
 * @purity semi-pure-immutable
 * @param {string} text
 * @param {number[][]} tokens - [group, start, end], in order
 * @param {Intl.Segmenter} graphemes
 * @returns {string} HTML
 */
function chunksHtml(text, tokens, graphemes) {
  let html = "";
  let next = 0;
  for (let start = 0; start < text.length; ) {
    const end = chunkEnd(text, start, start + CONFIG.codeEdit.lineChunkChars, graphemes);
    const ownTokens = [];
    while (next < tokens.length && tokens[next][1] < end) {
      const [group, from, to] = tokens[next];
      ownTokens.push([group, Math.max(from, start) - start, Math.min(to, end) - start]);
      if (to > end) break;
      next++;
    }
    html += `<span class="${CHUNK_CLASS}" ${TOKENS_ATTRIBUTE}="${tokensJson(ownTokens)}">${escapeHtml(text.slice(start, end))}</span>`;
    start = end;
  }
  return html;
}

/**
 * Spec: INV-86 (e).
 * @purity semi-pure-immutable
 * @param {string} html - the line's highlight.js HTML
 * @param {Intl.Segmenter} graphemes
 * @returns {string}
 */
export function layerLineHtml(html, graphemes) {
  if (html.length <= CONFIG.codeEdit.longLineChars || !html.includes("<span")) return html;
  const { text, tokens } = lineTokens(html);
  return text.length > CONFIG.codeEdit.longLineChars ? chunksHtml(text, tokens, graphemes) : html;
}

/**
 * @purity semi-pure-immutable
 * @param {string} html
 * @returns {boolean}
 */
export function isChunkedLine(html) {
  return html.startsWith(`<span class="${CHUNK_CLASS}"`);
}

/**
 * Spec: INV-86 (e).
 * Why: a block of 64 chunked lines would make 3,200 ranges on every key
 * @purity semi-pure-immutable
 * @param {string[]} lines - the lines' HTML
 * @param {number} size
 * @returns {number[]}
 */
export function blockCounts(lines, size) {
  const counts = [];
  let run = 0;
  for (const line of lines) {
    if (isChunkedLine(line)) {
      if (run > 0) counts.push(run);
      counts.push(1);
      run = 0;
    } else if (++run === size) {
      counts.push(run);
      run = 0;
    }
  }
  if (run > 0) counts.push(run);
  return counts;
}
