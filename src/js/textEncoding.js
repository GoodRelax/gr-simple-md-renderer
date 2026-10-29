// ========================================
// Text encodings of non-.md files (no DOM, no CONFIG)
// ========================================
//
// Reading: BOM, then strict UTF-8, then a guess among Shift_JIS and EUC-JP
// (NE-6, NE-15). Writing: UTF-8 and UTF-16 by hand; Shift_JIS and EUC-JP
// through a reverse table built from the browser's own TextDecoder, so no
// table is bundled (NE-24). Line endings: counts, the ending of each line,
// and the endings to save with, "keep" included (NE-16, NE-25).

/** The encodings a file can be read and saved in (WHATWG labels). */
export const TEXT_ENCODINGS = ["utf-8", "shift_jis", "euc-jp", "utf-16le", "utf-16be"];

const BOMS = {
  "utf-8": [0xef, 0xbb, 0xbf],
  "utf-16le": [0xff, 0xfe],
  "utf-16be": [0xfe, 0xff],
};

/**
 * The BOM at the start of the bytes.
 * @purity pure
 * @param {Uint8Array} bytes
 * @returns {"utf-8"|"utf-16le"|"utf-16be"|null}
 */
export function detectBom(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return null;
}

/**
 * Decode strictly; null when the bytes are not valid in the encoding.
 * TextDecoder strips a BOM of its own encoding.
 * @purity pure
 * @param {Uint8Array} bytes
 * @param {string} encoding
 * @returns {string|null}
 */
function decodeStrict(bytes, encoding) {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The number of half-width katakana (U+FF61..U+FF9F) in a text. Kana and
 * kanji of EUC-JP read as Shift_JIS turn into runs of them; real text
 * rarely holds many.
 * @purity pure
 * @param {string} text
 * @returns {number}
 */
function halfWidthKanaCount(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xff61 && c <= 0xff9f) n++;
  }
  return n;
}

/**
 * Read file bytes (NE-15).
 * - A BOM: decode with its encoding (BOM stripped), bom: true.
 * - No BOM: strict UTF-8; success is valid UTF-8.
 * - Otherwise a guess: strict Shift_JIS and strict EUC-JP. When both decode,
 *   the one with fewer half-width katakana wins (ties: Shift_JIS). When
 *   neither decodes, Shift_JIS decoded non-strictly (replacement chars).
 * valid is true only for UTF-8 (with or without BOM) that decoded without error.
 * @purity pure
 * @param {Uint8Array} bytes
 * @returns {{text: string, encoding: string, bom: boolean, valid: boolean}}
 */
export function decodeFileBytes(bytes) {
  const bom = detectBom(bytes);
  if (bom) {
    const strict = decodeStrict(bytes, bom);
    const text = strict ?? decodeAs(bytes, bom);
    return { text, encoding: bom, bom: true, valid: bom === "utf-8" && strict !== null };
  }
  const utf8 = decodeStrict(bytes, "utf-8");
  if (utf8 !== null) return { text: utf8, encoding: "utf-8", bom: false, valid: true };

  const sjis = decodeStrict(bytes, "shift_jis");
  const euc = decodeStrict(bytes, "euc-jp");
  if (sjis !== null && (euc === null || halfWidthKanaCount(sjis) <= halfWidthKanaCount(euc))) {
    return { text: sjis, encoding: "shift_jis", bom: false, valid: false };
  }
  if (euc !== null) return { text: euc, encoding: "euc-jp", bom: false, valid: false };
  return { text: decodeAs(bytes, "shift_jis"), encoding: "shift_jis", bom: false, valid: false };
}

/**
 * Decode with a chosen encoding, non-strictly (replacement chars allowed).
 * A BOM of that encoding is stripped.
 * @purity pure
 * @param {Uint8Array} bytes
 * @param {string} encoding - one of TEXT_ENCODINGS
 * @returns {string}
 */
export function decodeAs(bytes, encoding) {
  return new TextDecoder(encoding).decode(bytes);
}

// ---- reverse tables (Shift_JIS, EUC-JP) ----

// Filled once per encoding on the first save in it: code point -> bytes,
// one byte as its value, two bytes as (lead << 8) | trail.
const reverseTables = new Map();

/**
 * The one code point a byte sequence decodes to, or -1 (an error, U+FFFD,
 * or more than one code point).
 * @purity pure
 * @param {TextDecoder} decoder - a non-strict decoder, not streaming
 * @param {number[]} seq - one or two bytes
 * @returns {number}
 */
function decodeOne(decoder, seq) {
  const s = decoder.decode(Uint8Array.from(seq));
  const cp = s.codePointAt(0);
  if (cp === undefined || cp === 0xfffd || String.fromCodePoint(cp).length !== s.length) return -1;
  return cp;
}

/**
 * Build the reverse table of an encoding by decoding every byte sequence in
 * ascending order and keeping the first one per code point, plus the
 * WHATWG encoder's own rules: U+00A5 -> 0x5C, U+203E -> 0x7E, U+2212 as
 * U+FF0D. Shift_JIS skips the leads 0xED-0xEF (NEC-selected IBM extensions,
 * pointers 8272-8835, which the WHATWG encoder does not write); EUC-JP has
 * no 3-byte 0x8F sequences (JIS X 0212, not written either).
 * @purity pure
 * @param {"shift_jis"|"euc-jp"} encoding
 * @returns {Map<number, number>}
 */
export function buildReverseTable(encoding) {
  const decoder = new TextDecoder(encoding);
  const seqs = [];
  for (let b = 0; b <= 0x7f; b++) seqs.push([b]);
  if (encoding === "shift_jis") {
    seqs.push([0x80]);
    for (let b = 0xa1; b <= 0xdf; b++) seqs.push([b]);
    for (let lead = 0x81; lead <= 0xfc; lead++) {
      if (lead >= 0xa0 && lead <= 0xdf) continue;
      if (lead >= 0xed && lead <= 0xef) continue;
      for (let trail = 0x40; trail <= 0xfc; trail++) if (trail !== 0x7f) seqs.push([lead, trail]);
    }
  } else {
    for (let b = 0xa1; b <= 0xdf; b++) seqs.push([0x8e, b]);
    for (let lead = 0xa1; lead <= 0xfe; lead++) {
      for (let trail = 0xa1; trail <= 0xfe; trail++) seqs.push([lead, trail]);
    }
  }
  const table = new Map();
  for (const seq of seqs) {
    const cp = decodeOne(decoder, seq);
    if (cp >= 0 && !table.has(cp)) table.set(cp, seq.length === 1 ? seq[0] : (seq[0] << 8) | seq[1]);
  }
  table.set(0xa5, 0x5c);
  table.set(0x203e, 0x7e);
  if (table.has(0xff0d)) table.set(0x2212, table.get(0xff0d));
  return table;
}

/**
 * The reverse table of an encoding, built on the first call and kept in
 * the module (about 7,000 entries each).
 * @purity non-pure
 * @param {"shift_jis"|"euc-jp"} encoding
 * @returns {Map<number, number>}
 */
function reverseTableFor(encoding) {
  let table = reverseTables.get(encoding);
  if (!table) {
    table = buildReverseTable(encoding);
    reverseTables.set(encoding, table);
  }
  return table;
}

/**
 * True when a line ends at index i of the text: an LF, or a CR not followed
 * by an LF (a CRLF ends its line at the LF).
 * @purity pure
 * @param {string} text
 * @param {number} i
 * @returns {boolean}
 */
function endsLineAt(text, i) {
  const c = text.charCodeAt(i);
  return c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10);
}

/**
 * Encode with a reverse table. Lines (1-based, split on any line ending:
 * CRLF, LF or CR) holding a code point the table lacks are listed; the
 * bytes are then not used.
 * @purity pure
 * @param {string} text
 * @param {Map<number, number>} table
 * @returns {{bytes: Uint8Array, unencodableLines: number[]}}
 */
function encodeWithTable(text, table) {
  const out = new Uint8Array(text.length * 2);
  const unencodableLines = [];
  let n = 0;
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i);
    if (cp > 0xffff) i++;
    else if (endsLineAt(text, i)) line++;
    const code = table.get(cp);
    if (code === undefined) {
      if (unencodableLines[unencodableLines.length - 1] !== line) unencodableLines.push(line);
      continue;
    }
    if (code > 0xff) out[n++] = code >> 8;
    out[n++] = code & 0xff;
  }
  return { bytes: out.slice(0, n), unencodableLines };
}

/**
 * The lines (1-based, split on any line ending: CRLF, LF or CR) holding a
 * lone surrogate, which UTF-8 cannot write (TextEncoder would put U+FFFD
 * in its place).
 * @purity pure
 * @param {string} text
 * @returns {number[]}
 */
function loneSurrogateLines(text) {
  const lines = [];
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (endsLineAt(text, i)) {
      line++;
      continue;
    }
    if (c < 0xd800 || c > 0xdfff) continue;
    const next = text.charCodeAt(i + 1);
    if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      i++;
      continue;
    }
    if (lines[lines.length - 1] !== line) lines.push(line);
  }
  return lines;
}

/**
 * UTF-16 code units as bytes, after an optional BOM.
 * @purity pure
 * @param {string} text
 * @param {boolean} littleEndian
 * @param {boolean} bom
 * @returns {Uint8Array}
 */
function encodeUtf16(text, littleEndian, bom) {
  const head = bom ? 2 : 0;
  const out = new Uint8Array(head + text.length * 2);
  if (bom) out.set(littleEndian ? BOMS["utf-16le"] : BOMS["utf-16be"]);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const at = head + i * 2;
    out[at + (littleEndian ? 0 : 1)] = c & 0xff;
    out[at + (littleEndian ? 1 : 0)] = c >> 8;
  }
  return out;
}

/**
 * Encode text for saving (NE-24). text is final (line endings applied).
 * bom adds the encoding's BOM (utf-8 / utf-16*; ignored for the others).
 * When a line holds a character the encoding cannot write, unencodableLines
 * lists those lines (1-based, split on any line ending: CRLF, LF or CR, so
 * the numbers are those of the LF text the endings were applied to) and
 * bytes is empty: the caller does not save.
 * The reverse table of Shift_JIS / EUC-JP is built once and kept in the
 * module; the result depends on the arguments only.
 * @purity semi-pure-a
 * @param {string} text
 * @param {string} encoding - one of TEXT_ENCODINGS
 * @param {boolean} bom
 * @returns {{bytes: Uint8Array, unencodableLines: number[]}}
 */
export function encodeText(text, encoding, bom) {
  if (encoding === "shift_jis" || encoding === "euc-jp") {
    const result = encodeWithTable(text, reverseTableFor(encoding));
    return result.unencodableLines.length > 0 ? { bytes: new Uint8Array(0), unencodableLines: result.unencodableLines } : result;
  }
  const lone = loneSurrogateLines(text);
  if (lone.length > 0) return { bytes: new Uint8Array(0), unencodableLines: lone };
  if (encoding === "utf-16le" || encoding === "utf-16be") {
    return { bytes: encodeUtf16(text, encoding === "utf-16le", bom), unencodableLines: [] };
  }
  const body = new TextEncoder().encode(text);
  if (!bom) return { bytes: body, unencodableLines: [] };
  const out = new Uint8Array(body.length + 3);
  out.set(BOMS["utf-8"]);
  out.set(body, 3);
  return { bytes: out, unencodableLines: [] };
}

// ---- line endings ----

/**
 * Counts of each line ending of a decoded text. A CRLF counts once, as crlf.
 * @purity pure
 * @param {string} text
 * @returns {{crlf: number, lf: number, cr: number}}
 */
export function countLineEndings(text) {
  const counts = { crlf: 0, lf: 0, cr: 0 };
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        counts.crlf++;
        i++;
      } else counts.cr++;
    } else if (c === 10) counts.lf++;
  }
  return counts;
}

/**
 * True when more than one kind of line ending is present.
 * @purity pure
 * @param {{crlf: number, lf: number, cr: number}} counts
 * @returns {boolean}
 */
export function hasMixedLineEndings(counts) {
  return (counts.crlf > 0 ? 1 : 0) + (counts.lf > 0 ? 1 : 0) + (counts.cr > 0 ? 1 : 0) > 1;
}

/**
 * The line ending after each line of a decoded text, in order; its length
 * is the number of line breaks.
 * @purity pure
 * @param {string} text
 * @returns {string[]} each "\r\n", "\n" or "\r"
 */
export function lineEndingsOf(text) {
  const endings = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        endings.push("\r\n");
        i++;
      } else endings.push("\r");
    } else if (c === 10) endings.push("\n");
  }
  return endings;
}

/**
 * The most common of the endings; a tie prefers "\n", then "\r\n", then "\r".
 * No endings: "\n".
 * @purity pure
 * @param {string[]} endings
 * @returns {string}
 */
function majorityEnding(endings) {
  const order = ["\n", "\r\n", "\r"];
  const counts = [0, 0, 0];
  for (const e of endings) counts[order.indexOf(e)]++;
  let best = 0;
  for (let k = 1; k < order.length; k++) if (counts[k] > counts[best]) best = k;
  return order[best];
}

/**
 * Apply line endings to LF text for saving (NE-16, NE-25).
 * mode "\r\n" | "\n" | "\r": every LF becomes that ending.
 * mode "keep": original is the text at load ({lines: LF-split lines,
 * endings: lineEndingsOf}). Lines equal from the start (common prefix) and
 * from the end (common suffix, not overlapping it) keep the ending they
 * had after them; every other line break gets the majority ending of
 * original.endings. The text ends with a line ending only if lfText ends
 * with "\n".
 * @purity pure
 * @param {string} lfText
 * @param {"\r\n"|"\n"|"\r"|"keep"} mode
 * @param {{lines: string[], endings: string[]}} [original] - for "keep"
 * @returns {string}
 */
export function applyLineEndings(lfText, mode, original) {
  if (mode !== "keep") return mode === "\n" ? lfText : lfText.split("\n").join(mode);
  const lines = lfText.split("\n");
  const old = original.lines;
  const fallback = majorityEnding(original.endings);
  const limit = Math.min(lines.length, old.length);
  let prefix = 0;
  while (prefix < limit && lines[prefix] === old[prefix]) prefix++;
  let suffix = 0;
  while (suffix < limit - prefix && lines[lines.length - 1 - suffix] === old[old.length - 1 - suffix]) suffix++;

  const parts = [];
  const shift = old.length - lines.length; // old index = new index + shift, in the suffix
  for (let i = 0; i < lines.length; i++) {
    parts.push(lines[i]);
    if (i === lines.length - 1) break;
    let ending = fallback;
    if (i < prefix && i < original.endings.length) ending = original.endings[i];
    else if (i >= lines.length - suffix && i + shift < original.endings.length) ending = original.endings[i + shift];
    parts.push(ending);
  }
  return parts.join("");
}
