// Hidden characters (INV-101, spec 5.21): tag characters, zero width
// characters and the characters that change the text direction. A text can
// hide an instruction in them (a prompt for an AI that a reader does not
// see). This module finds their runs and makes the label of each run.
// Pure module: it imports nothing and reads no global state.

const TAG_FIRST = 0xe0000;
const TAG_LAST = 0xe007f;
const TAG_CANCEL = 0xe007f;
const BLACK_FLAG = 0x1f3f4;
const ZWJ = 0x200d;
const BOM = 0xfeff;
const VS16 = 0xfe0f;
const SKIN_FIRST = 0x1f3fb;
const SKIN_LAST = 0x1f3ff;

/** The short name of each character that is not a tag character (spec 5.21.2). */
export const HIDDEN_CHAR_NAMES = Object.freeze({
  0x200b: "ZWSP",
  0x200c: "ZWNJ",
  0x200d: "ZWJ",
  0x2060: "WJ",
  0xfeff: "BOM",
  0x202a: "LRE",
  0x202b: "RLE",
  0x202c: "PDF",
  0x202d: "LRO",
  0x202e: "RLO",
  0x2066: "LRI",
  0x2067: "RLI",
  0x2068: "FSI",
  0x2069: "PDI",
  0x200e: "LRM",
  0x200f: "RLM",
});

/** What a run of tag characters is written after (owner ruling AQ14 a). */
export const HIDDEN_TEXT_PREFIX = "hidden: ";

/**
 * The set of INV-101 (1) but U+200D, as the body of a character class of a
 * regular expression with the u flag: the zero width characters, the
 * characters that change the text direction and the tag characters. These
 * ranges live here only: the marks of a block editor (INV-70,
 * InvisibleCharOverlay) are built from it too. U+200D is apart: it is
 * hidden only outside an emoji (INV-101 (2) (a)), and INV-70 never marks it.
 */
export const HIDDEN_CHAR_CLASS_NO_ZWJ =
  "\\u200b\\u200c\\u2060\\ufeff\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069\\u{E0000}-\\u{E007F}";

// One character of the set
const CANDIDATE = new RegExp(`[\\u200d${HIDDEN_CHAR_CLASS_NO_ZWJ}]`, "u");
const PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u;

// The tag codes of the three RGI flags after U+1F3F4 (INV-101 (2) (b)),
// each ended by U+E007F
const FLAG_TAG_SEQUENCES = Object.freeze(
  ["gbeng", "gbsct", "gbwls"].map((code) => String.fromCodePoint(...[...code].map((c) => TAG_FIRST + c.charCodeAt(0)), TAG_CANCEL)),
);

/**
 * Whether the text may hold a hidden character (a quick test before a
 * closer look).
 * @purity pure
 * @param {string} text
 * @returns {boolean}
 */
export function mayHoldHiddenChars(text) {
  return CANDIDATE.test(text);
}

/**
 * @purity pure
 * @param {number} cp
 * @returns {boolean}
 */
function isTag(cp) {
  return cp >= TAG_FIRST && cp <= TAG_LAST;
}

/**
 * The code point that ends at index end (a surrogate pair read whole), or -1.
 * @purity pure
 * @param {string} text
 * @param {number} end
 * @returns {number}
 */
function codePointBefore(text, end) {
  if (end <= 0) return -1;
  const low = text.charCodeAt(end - 1);
  if (low >= 0xdc00 && low <= 0xdfff && end >= 2) {
    const high = text.charCodeAt(end - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.codePointAt(end - 2);
  }
  return low;
}

/**
 * @purity pure
 * @param {number} cp
 * @returns {boolean}
 */
function isPictographic(cp) {
  return cp >= 0 && PICTOGRAPHIC.test(String.fromCodePoint(cp));
}

/**
 * INV-101 (2) (a): the U+200D at index i stands alone between two emoji:
 * before it an Extended_Pictographic character (then U+FE0F and skin tone
 * modifiers, any number), after it an Extended_Pictographic character.
 * @purity pure
 * @param {string} text
 * @param {number} i
 * @returns {boolean}
 */
function isEmojiJoiner(text, i) {
  if (i + 1 >= text.length || !isPictographic(text.codePointAt(i + 1))) return false;
  let end = i;
  for (;;) {
    const cp = codePointBefore(text, end);
    if (cp === VS16 || (cp >= SKIN_FIRST && cp <= SKIN_LAST)) end -= cp > 0xffff ? 2 : 1;
    else return isPictographic(cp);
  }
}

/**
 * INV-101 (2) (b): the length of the flag tag sequence (gbeng, gbsct or
 * gbwls, then U+E007F) that starts at index i right after U+1F3F4, or 0.
 * @purity pure
 * @param {string} text
 * @param {number} i
 * @returns {number}
 */
export function flagTagLength(text, i) {
  if (codePointBefore(text, i) !== BLACK_FLAG) return 0;
  for (const sequence of FLAG_TAG_SEQUENCES) if (text.startsWith(sequence, i)) return sequence.length;
  return 0;
}

/**
 * The label of a run's characters (spec 5.21.2): each stretch of tag
 * characters is "hidden: " and its text (U+E0020..U+E007E as ASCII, other
 * tag characters as "?"), every other character its short name; the parts
 * are joined with one space.
 * @purity pure
 * @param {number[]} codePoints
 * @returns {string}
 */
export function hiddenRunLabel(codePoints) {
  const parts = [];
  let tagText = null;
  for (const cp of codePoints) {
    if (isTag(cp)) {
      const ascii = cp - TAG_FIRST;
      tagText = (tagText ?? "") + (ascii >= 0x20 && ascii <= 0x7e ? String.fromCharCode(ascii) : "?");
      continue;
    }
    if (tagText !== null) parts.push(HIDDEN_TEXT_PREFIX + tagText);
    tagText = null;
    parts.push(HIDDEN_CHAR_NAMES[cp]);
  }
  if (tagText !== null) parts.push(HIDDEN_TEXT_PREFIX + tagText);
  return parts.join(" ");
}

/**
 * The runs of hidden characters in text, in one pass from the start
 * (INV-101 (1)(2), spec 5.21.1): neighbouring characters of the set are one
 * run; a character of an exception (an emoji's joiner, an RGI flag's tags)
 * is none and cuts a run. textStart: index 0 is the start of the whole text,
 * where U+FEFF is not one.
 * @purity pure
 * @param {string} text
 * @param {{textStart?: boolean}} [options]
 * @returns {{start: number, end: number, label: string}[]}
 */
export function findHiddenRuns(text, { textStart = true } = {}) {
  const runs = [];
  let run = null; // { start, end, codePoints }
  const candidates = new RegExp(CANDIDATE.source, "gu"); // its own lastIndex
  for (let m = candidates.exec(text); m; m = candidates.exec(text)) {
    const i = m.index;
    const cp = text.codePointAt(i);
    if (cp === BOM && i === 0 && textStart) continue;
    if (cp === ZWJ && isEmojiJoiner(text, i)) continue;
    const flag = isTag(cp) ? flagTagLength(text, i) : 0;
    if (flag > 0) {
      candidates.lastIndex = i + flag;
      continue;
    }
    if (run && run.end === i) {
      run.end = i + m[0].length;
      run.codePoints.push(cp);
    } else {
      run = { start: i, end: i + m[0].length, codePoints: [cp] };
      runs.push(run);
    }
  }
  return runs.map((r) => ({ start: r.start, end: r.end, label: hiddenRunLabel(r.codePoints) }));
}

/**
 * The number of runs in the whole text (the toast at open, INV-101 (3)).
 * @purity pure
 * @param {string} text
 * @returns {number}
 */
export function countHiddenRuns(text) {
  return mayHoldHiddenChars(text) ? findHiddenRuns(text).length : 0;
}
