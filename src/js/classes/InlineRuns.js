// The formats of the normal form, from the outside in (INV-67 (1)).
const LEVELS = ["color", "link", "del", "strong", "em"];
const DELIMITERS = Object.freeze({ del: "~~", strong: "**", em: "*" });
const COLOR_OPEN = /^<span style="color: (#[0-9A-Fa-f]{6})">$/;
const SPAN_OPEN = /^<span(?:\s[^>]*)?>$/i;
const SPAN_CLOSE = /^<\/span\s*>$/i;
// CommonMark 0.31.2 delimiter runs, as marked 18 tests them: [\s\p{P}\p{S}]
const WHITESPACE = /\s/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;
// INV-72 (d): escaped in text written without a source
// emphasis delimiters written as plain text (_escapeBeforeLink)
const LITERAL_DELIMITERS = new Set(["*", "_", "~"]);
const ESCAPED_CHARS = new Set(["\\", "`", "*", "_", "[", "]", "<", "|", "~", "$", "&"]);
const NO_MARKS = Object.freeze({ color: null, link: null, del: false, strong: false, em: false });
// An entity or numeric character reference is one run (never split).
const ENTITY = /&(?:#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g;
// An inline HTML tag that opens or closes an element (not a void element,
// not self-closing): markers never cut an element in two (INV-67 (6)).
const HTML_TAG = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/;
const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/**
 * @purity pure
 * @param {object[]|undefined} tokens
 * @returns {string}
 */
function rawOf(tokens) {
  return (tokens ?? []).map((t) => t.raw).join("");
}

/**
 * @purity pure
 * @param {string} s
 * @returns {string} the first code point, or ""
 */
function firstChar(s) {
  return s === "" ? "" : String.fromCodePoint(s.codePointAt(0));
}

/**
 * @purity pure
 * @param {string} s
 * @returns {string} the last code point, or ""
 */
function lastChar(s) {
  const chars = Array.from(s.slice(-2));
  return chars.length === 0 ? "" : chars[chars.length - 1];
}

/**
 * A delimiter run can open: CommonMark left-flanking ("" is a line edge).
 * @purity pure
 */
function isLeftFlanking(before, after) {
  if (after === "" || WHITESPACE.test(after)) return false;
  return !PUNCTUATION.test(after) || before === "" || WHITESPACE.test(before) || PUNCTUATION.test(before);
}

/**
 * A delimiter run can close: CommonMark right-flanking.
 * @purity pure
 */
function isRightFlanking(before, after) {
  if (before === "" || WHITESPACE.test(before)) return false;
  return !PUNCTUATION.test(before) || after === "" || WHITESPACE.test(after) || PUNCTUATION.test(after);
}

/**
 * The inline format as runs (spec 5.14.14, INV-66 / 67 / 72). Pure: no DOM,
 * no CONFIG (the palette colors come in as an argument).
 *
 * A run is one character, one code span, one line break, or one piece kept
 * as written (an "atom": inline HTML, an image, math, ...):
 *   { type: "text" | "code" | "br" | "atom", text, src, marks, srcFrom?, srcTo?, top? }
 *   text  - what it shows (a code span's content; "" for a line break;
 *           the source for an atom)
 *   src   - its source as written, or null for new text (then it is
 *           written with the escapes of INV-72 (d))
 *   marks - { color, link, del, strong, em }; a link is one object shared
 *           by the runs of that link (its notation, INV-72 (a))
 * Runs with the same format next to each other are one span when written
 * (INV-67 (2)); the formats nest in the order of LEVELS (INV-67 (1)).
 */
export default class InlineRuns {
  /**
   * Runs from marked inline tokens. srcFrom / srcTo are the source offsets
   * (from options.offset); top is the index of the top-level token.
   * A color span is a color only for a palette color (options.colors).
   * @purity pure
   * @param {object[]} tokens
   * @param {{colors?: string[], offset?: number}} [options]
   * @returns {object[]}
   */
  static fromTokens(tokens, options = {}) {
    const colors = (options.colors ?? []).map((c) => c.toLowerCase());
    const runs = [];
    InlineRuns._collect(tokens, options.offset ?? 0, NO_MARKS, colors, runs, null);
    return runs;
  }

  /**
   * Runs from a copy of a table cell's DOM (TableCellEditor.snapshotNodes;
   * INV-62, INV-63). Only the allowed elements are formats: strong / em /
   * del, a code span, a line break, a link that was there when the cell
   * opened (node.link: its index in linkInfo, INV-72 (a)), and a span whose
   * style is exactly a palette color (options.colors). A "mark" node (the
   * INV-70 marks) only holds text. Any other element gives its text only.
   * All runs are new text (src null): they are written in the normal form.
   * @purity pure
   * @param {object[]} tree - {kind: "text", text} | {kind: "br"} |
   *   {kind: "strong"|"em"|"del"|"code"|"a"|"span"|"mark"|"other", children, link?, style?}
   * @param {object[]} [linkInfo] - the link notations, by index (InlineRuns link objects)
   * @param {{colors?: string[]}} [options]
   * @returns {object[]}
   */
  static fromNodes(tree, linkInfo = [], options = {}) {
    const colors = (options.colors ?? []).map((c) => c.toLowerCase());
    const runs = [];
    InlineRuns._collectNodes(tree, NO_MARKS, linkInfo, colors, runs, false);
    return runs;
  }

  /**
   * A link token's notation (INV-72 (a)): {kind, href, title, innerFrom,
   * innerSrc, ...}, or null when its text cannot be found in its source.
   * @purity pure
   * @param {object} token
   * @returns {object|null}
   */
  static linkOf(token) {
    return InlineRuns._linkOf(token);
  }

  /**
   * The links of inline tokens in source order (they are the a elements
   * of the rendered HTML in the same order), each with its notation
   * (INV-72 (a)); null for a link whose notation is not known.
   * @purity pure
   * @param {object[]} tokens
   * @returns {Array<object|null>}
   */
  static linksOf(tokens) {
    const out = [];
    for (const token of tokens) {
      if (token.type === "link") out.push(InlineRuns._linkOf(token));
      else if (token.tokens) out.push(...InlineRuns.linksOf(token.tokens));
    }
    return out;
  }

  /**
   * Bold / Italic / text color / a link over [start, end) of the shown text
   * (a line break counts 0). null when the range holds no run, or only
   * spaces for Bold / Italic, or no link to take off. Taking a link off
   * also works at a caret (start === end): the link the caret is on, its
   * edges included (INV-69). op.strictEnds (the Ctrl+V link): null when an
   * end is inside a code span or another piece kept whole.
   * @purity pure
   * @param {object[]} runs
   * @param {number} start
   * @param {number} end
   * @param {{kind: "strong"|"em"|"color"|"link"|"unlink", value?: string|null, link?: object, url?: string, strictEnds?: boolean}} op
   * @param {object} [context] - before / after: the text around the runs
   * @returns {{runs: object[], start: number, end: number}|null} start / end: the range after INV-67 (6)
   */
  static apply(runs, start, end, op, context = {}) {
    const offsets = InlineRuns._offsets(runs);
    if (op.strictEnds && (InlineRuns._cutsRun(offsets, start) || InlineRuns._cutsRun(offsets, end))) return null;
    let from = -1;
    let to = -1;
    if (start === end && op.kind === "unlink") {
      from = InlineRuns._linkRunAt(runs, offsets, start);
      to = from + 1;
    } else {
      for (let k = 0; k < runs.length; k++) {
        if (!InlineRuns._touches(offsets, k, start, end)) continue;
        if (from < 0) from = k;
        to = k + 1;
      }
    }
    if (from < 0) return null;
    const result = InlineRuns.applyUnits(runs, from, to, op, context);
    if (!result) return null;
    const after = InlineRuns._offsets(result.runs);
    return { runs: result.runs, start: after[result.from], end: after[result.to] };
  }

  /**
   * The selection [start, end) touches a link, or the caret (start === end)
   * is on one, its edges included (5.15.5: Remove link).
   * @purity pure
   * @param {object[]} runs
   * @param {number} start
   * @param {number} end
   * @returns {boolean}
   */
  static hasLinkAt(runs, start, end) {
    const offsets = InlineRuns._offsets(runs);
    if (start === end) return InlineRuns._linkRunAt(runs, offsets, start) >= 0;
    for (let k = 0; k < runs.length; k++) if (runs[k].marks.link && InlineRuns._touches(offsets, k, start, end)) return true;
    return false;
  }

  /**
   * An inline link [text](destination) made by INV-69; its href is what
   * marked reads from the destination (without the angle brackets).
   * @purity pure
   * @param {string} destination - ClipboardLink.toDestination
   * @returns {object} a link of the runs (as InlineRuns._linkOf makes them)
   */
  static inlineLink(destination) {
    const angle = destination.startsWith("<") && destination.endsWith(">");
    return { kind: "inline", innerFrom: 1, href: angle ? destination.slice(1, -1) : destination, title: null, innerSrc: "", dest: `(${destination})` };
  }

  /**
   * A new link before run index i (no selection, INV-69 (b), owner ruling
   * F-R1): its text is label; it has the other formats of the run before it
   * (or after it). A "!" right before it is written \! (else it would make
   * an image) and a lone backslash is doubled. null when the label is empty,
   * or i is not a place a link can go (inside a link, or not a run
   * boundary). start / end: the label in the shown text.
   * @purity pure
   * @param {object[]} runs - not changed
   * @param {number} i
   * @param {string} label
   * @param {object} link - inlineLink()
   * @param {object} [context]
   * @returns {{runs: object[], start: number, end: number}|null}
   */
  static insertLinkAt(runs, i, label, link, context = {}) {
    if (!InlineRuns.canInsertLinkAt(runs, i) || !label) return null;
    const marks = { ...((runs[i - 1] ?? runs[i])?.marks ?? NO_MARKS), link };
    /** @purity pure */
    const copy = (r) => ({ ...r, marks: { ...r.marks } });
    /** @purity pure */
    const run = (ch) => ({ type: "text", text: ch, src: null, marks: { ...marks } });
    const added = Array.from(label).map(run);
    const out = [...runs.slice(0, i).map(copy), ...added, ...runs.slice(i).map(copy)];
    const before = out[i - 1];
    if (before?.type === "text" && before.text === "\\" && before.src === "\\") before.src = "\\\\";
    InlineRuns._escapeBeforeLink(out, i);
    InlineRuns._normalize(out, context);
    const after = InlineRuns._offsets(out);
    return { runs: out, start: after[i], end: after[i + added.length] };
  }

  /**
   * A new link can go before run index i (owner ruling F-R1): i is a run
   * boundary, and not inside a link (the runs on both sides of one link).
   * @purity pure
   * @param {object[]} runs
   * @param {number} i
   * @returns {boolean}
   */
  static canInsertLinkAt(runs, i) {
    if (!Number.isInteger(i) || i < 0 || i > runs.length) return false;
    const link = runs[i - 1]?.marks.link;
    return !link || runs[i]?.marks.link !== link;
  }

  /**
   * The run index where the shown offset at falls between two runs, a line
   * break counting brWidth (1: a caret in a cell's DOM, unambiguous at a line
   * start); -1 when at is inside a run (a code span or another piece kept
   * whole).
   * @purity pure
   * @param {object[]} runs
   * @param {number} at
   * @param {number} [brWidth]
   * @returns {number}
   */
  static runIndexAt(runs, at, brWidth = 0) {
    let pos = 0;
    for (let i = 0; i < runs.length; i++) {
      if (pos === at) return i;
      pos += runs[i].type === "br" ? brWidth : runs[i].text.length;
      if (pos > at) return -1;
    }
    return pos === at ? runs.length : -1;
  }

  /**
   * apply() on the runs [from, to) by index (the block editor's path).
   * INV-67: (6) a link is taken whole (code spans and atoms are one run);
   * (3) Bold / Italic come off when every selected character has them, else
   * go on the whole range; (4) spaces at the ends go outside the markers;
   * (5) an end whose markers would not work is dropped from the range.
   * A link (op.link) goes on the whole range, in place of any link there;
   * a bare URL or an autolink in it gives its text up for op.url (INV-69).
   * Taking links off (unlink) keeps their text, written so that marked does
   * not make it an autolink again.
   * @purity pure
   * @param {object[]} runs - not changed
   * @param {number} from
   * @param {number} to - exclusive
   * @param {{kind: string, value?: string|null, link?: object, url?: string}} op
   * @param {object} [context] - before / after / inTableCell
   * @returns {{runs: object[], from: number, to: number}|null}
   */
  static applyUnits(runs, from, to, op, context = {}) {
    if (!(from < to)) return null;
    const { from: i, to: j } = InlineRuns.expandRange(runs, from, to);
    const out = runs.map((r) => ({ ...r, marks: { ...r.marks } }));
    if (op.kind === "link") return InlineRuns._linkUnits(out, i, j, op, context);
    if (op.kind === "unlink") return InlineRuns._unlinkUnits(out, i, j, context);
    if (op.kind === "strong" || op.kind === "em") {
      const shown = out.slice(i, j).filter((r) => !InlineRuns.isBlank(r));
      if (shown.length === 0) return null;
      const on = !shown.every((r) => r.marks[op.kind]);
      for (let k = i; k < j; k++) out[k].marks[op.kind] = on;
    } else if (op.kind === "color") {
      for (let k = i; k < j; k++) out[k].marks.color = op.value ?? null;
    } else {
      throw new Error(`Unknown inline format: ${op.kind}`);
    }
    InlineRuns._normalize(out, context);
    return { runs: out, from: i, to: j };
  }

  /**
   * INV-67 (6): the range [from, to) grown so that it holds a link whole
   * and both tags of an inline HTML element it touches (a code span, an
   * atom and an entity are one run already).
   * @purity pure
   * @param {object[]} runs
   * @param {number} from
   * @param {number} to - exclusive
   * @returns {{from: number, to: number}}
   */
  static expandRange(runs, from, to) {
    const partner = InlineRuns._tagPartners(runs);
    let i = from;
    let j = to;
    for (let changed = true; changed; ) {
      changed = false;
      while (i > 0 && runs[i].marks.link && runs[i - 1].marks.link === runs[i].marks.link) i--;
      while (j < runs.length && runs[j - 1].marks.link && runs[j].marks.link === runs[j - 1].marks.link) j++;
      for (let k = i; k < j; k++) {
        const p = partner[k];
        if (p < 0) continue;
        if (p < i) {
          i = p;
          changed = true;
        } else if (p >= j) {
          j = p + 1;
          changed = true;
        }
      }
    }
    return { from: i, to: j };
  }

  /**
   * The runs in the normal form (INV-67 (1), INV-72).
   * @purity pure
   * @param {object[]} runs
   * @param {object} [options] - inTableCell, isLinkableUrl(text)
   * @returns {string}
   */
  static serialize(runs, options = {}) {
    return InlineRuns.layout(runs, options).text;
  }

  /**
   * serialize() with where each run was written (unitFrom / unitTo) and
   * the emphasis markers ({kind, from, to, open, close, length}).
   * @purity pure
   * @param {object[]} runs
   * @param {object} [options] - also literalUrls: texts taken off a link
   *   that stay text where they stand outside a link (a table cell written
   *   again from its DOM, INV-69)
   * @returns {{text: string, unitFrom: number[], unitTo: number[], delimiters: object[]}}
   */
  static layout(runs, options = {}) {
    const out = InlineRuns._emptyLayout(runs.length);
    const written = options.literalUrls?.length ? InlineRuns._withLiteralUrls(runs, options.literalUrls) : runs;
    InlineRuns._writeLevel(written, 0, written.length, 0, options, out);
    return out;
  }

  /**
   * What marked shows of the runs, without how it is written: used to check
   * a rewrite against marked (INV-67 (8)).
   * @purity pure
   * @param {object[]} runs
   * @returns {Array<Array<string|boolean|null>>}
   */
  static signature(runs) {
    let group = 0;
    let previous = null;
    /** @purity pure */
    return runs.map((r) => {
      const m = r.marks;
      if (m.link !== previous) {
        if (m.link) group++;
        previous = m.link;
      }
      const link = m.link ? `${group}:${m.link.href}:${m.link.title ?? ""}` : null;
      const shown = r.type === "atom" ? (r.src ?? r.text) : r.text;
      return [r.type, shown, m.strong, m.em, m.del, m.color ? m.color.toLowerCase() : null, link];
    });
  }

  /**
   * The runs a source selection [srcFrom, srcTo) touches (fromTokens runs).
   * @purity pure
   * @param {object[]} runs
   * @param {number} srcFrom
   * @param {number} srcTo
   * @returns {{from: number, to: number}|null} indices, to exclusive
   */
  static unitRangeOfSource(runs, srcFrom, srcTo) {
    let from = -1;
    let to = -1;
    for (let k = 0; k < runs.length; k++) {
      if (runs[k].srcTo > srcFrom && runs[k].srcFrom < srcTo) {
        if (from < 0) from = k;
        to = k + 1;
      }
    }
    return from < 0 ? null : { from, to };
  }

  // ---- helpers (pure) ----

  /**
   * Run k is touched by [start, end) (a run of no width when it is inside).
   * @purity pure
   */
  static _touches(offsets, k, start, end) {
    const a = offsets[k];
    const b = offsets[k + 1];
    return b > a ? a < end && b > start : a > start && a < end;
  }

  /**
   * The shown offset x is inside a run (not at its edges).
   * @purity pure
   */
  static _cutsRun(offsets, x) {
    for (let k = 0; k + 1 < offsets.length; k++) if (offsets[k] < x && x < offsets[k + 1]) return true;
    return false;
  }

  /**
   * The run of a link the caret at c is on (inside it, else the run that
   * ends at c, else the one that starts at c), or -1.
   * @purity pure
   */
  static _linkRunAt(runs, offsets, c) {
    let edge = -1;
    for (let k = 0; k < runs.length; k++) {
      if (!runs[k].marks.link || offsets[k + 1] === offsets[k]) continue;
      if (offsets[k] < c && c < offsets[k + 1]) return k;
      if (offsets[k + 1] === c) edge = k;
      else if (offsets[k] === c && edge < 0) edge = k;
    }
    return edge;
  }

  /**
   * INV-69: op.link on out[i, j); the runs of a bare URL or an autolink
   * there become op.url's characters.
   * @purity pure
   * @param {object[]} out - copies owned by the caller
   * @returns {{runs: object[], from: number, to: number}}
   */
  static _linkUnits(out, i, j, op, context) {
    const middle = [];
    let k = i;
    while (k < j) {
      const old = out[k].marks.link;
      if (old && (old.kind === "bare" || old.kind === "autolink") && op.url) {
        let e = k;
        while (e < j && out[e].marks.link === old) e++;
        const marks = { ...out[k].marks, link: op.link };
        for (const ch of Array.from(op.url)) middle.push({ type: "text", text: ch, src: null, marks: { ...marks } });
        k = e;
        continue;
      }
      out[k].marks.link = op.link;
      // a bracket written as it was would close or open the link's text
      if (out[k].type === "text" && (out[k].src === "[" || out[k].src === "]")) out[k].src = null;
      // "(" after such a "]": written \( by _sourceOf
      if (out[k].type === "text" && out[k].src === "(" && middle[middle.length - 1]?.text === "]") out[k].src = null;
      middle.push(out[k]);
      k++;
    }
    const runs = [...out.slice(0, i), ...middle, ...out.slice(j)];
    InlineRuns._escapeBeforeLink(runs, i);
    InlineRuns._normalize(runs, context);
    return { runs, from: i, to: i + middle.length };
  }

  /**
   * The runs written right before a new link at index i (INV-69, INV-72
   * (d)): a "!" there would make it an image, and literal "*" "_" "~"
   * there could close emphasis once a "[" follows them; written as they
   * were, they are escaped (\! \* \_ \~). Runs without source are
   * escaped by _sourceOf.
   * @purity pure
   * @param {object[]} out - copies owned by the caller, changed in place
   * @param {number} i
   */
  static _escapeBeforeLink(out, i) {
    let k = i - 1;
    if (out[k]?.type === "text" && out[k].text === "!" && (out[k].src ?? "!") === "!") out[k--].src = "\\!";
    while (k >= 0 && out[k].type === "text" && LITERAL_DELIMITERS.has(out[k].text) && out[k].src === out[k].text) {
      out[k].src = `\\${out[k].text}`;
      k--;
    }
  }

  /**
   * INV-69: the links of out[i, j) come off; the text of each is written
   * so that it is no autolink. null when there is no link there.
   * @purity pure
   * @param {object[]} out - copies owned by the caller
   * @returns {{runs: object[], from: number, to: number}|null}
   */
  static _unlinkUnits(out, i, j, context) {
    let any = false;
    let k = i;
    while (k < j) {
      const link = out[k].marks.link;
      if (!link) {
        k++;
        continue;
      }
      let e = k;
      while (e < j && out[e].marks.link === link) out[e++].marks.link = null;
      // with the text right next to it: "www" + ".example", "a" + "@b.example"
      const around = InlineRuns.textAround(out, k, e);
      InlineRuns._breakAutolinks(out, around.from, around.to);
      any = true;
      k = e;
    }
    if (!any) return null;
    InlineRuns._normalize(out, context);
    return { runs: out, from: i, to: j };
  }

  /**
   * runs[from, to) grown over the text runs next to it that are in no link
   * and are no white space: the word an autolink of marked could take.
   * @purity pure
   * @param {object[]} runs
   * @param {number} from
   * @param {number} to - exclusive
   * @returns {{from: number, to: number}}
   */
  static textAround(runs, from, to) {
    /** @purity pure */
    const plain = (r) => r && r.type === "text" && !r.marks.link && !WHITESPACE.test(r.text);
    let a = from;
    let b = to;
    while (a > 0 && plain(runs[a - 1])) a--;
    while (b < runs.length && plain(runs[b])) b++;
    return { from: a, to: b };
  }

  /**
   * Escape what would make out[from, to) an autolink of marked (GFM): the
   * colon of a scheme, the dot of every "www.", and "@" (as \:, \. and \@;
   * marked makes "www." an autolink after any character).
   * @purity pure
   * @param {object[]} out - copies owned by the caller, changed in place
   */
  static _breakAutolinks(out, from, to) {
    const at = [];
    let text = "";
    for (let k = from; k < to; k++) {
      at.push(text.length);
      text += out[k].text;
    }
    const targets = new Set();
    for (const m of text.matchAll(/(?:https?|ftp|mailto):/gi)) targets.add(m.index + m[0].length - 1);
    for (const m of text.matchAll(/www\./gi)) targets.add(m.index + 3);
    for (const m of text.matchAll(/@/g)) targets.add(m.index);
    for (let k = from; k < to; k++) {
      const run = out[k];
      if (run.type !== "text" || run.text.length !== 1 || !targets.has(at[k - from])) continue;
      if (typeof run.src === "string" && run.src.startsWith("\\")) continue; // escaped already
      run.src = `\\${run.text}`;
    }
  }

  /**
   * Copies of runs where each literal URL text standing outside a link is
   * written so that it is no autolink (layout's literalUrls).
   * @purity pure
   */
  static _withLiteralUrls(runs, literals) {
    const out = runs.map((r) => ({ ...r }));
    let k = 0;
    while (k < out.length) {
      if (out[k].type !== "text" || out[k].marks.link) {
        k++;
        continue;
      }
      let e = k;
      const starts = [];
      let text = "";
      while (e < out.length && out[e].type === "text" && !out[e].marks.link) {
        starts.push(text.length);
        text += out[e++].text;
      }
      for (const literal of literals) {
        if (!literal) continue;
        for (let p = text.indexOf(literal); p >= 0; p = text.indexOf(literal, p + literal.length)) {
          let a = 0;
          while (a < starts.length && starts[a] < p) a++;
          let b = a;
          while (b < starts.length && starts[b] < p + literal.length) b++;
          InlineRuns._breakAutolinks(out, k + a, k + b);
        }
      }
      k = e;
    }
    return out;
  }

  /**
   * One level of tokens into runs; color spans of this level are paired.
   * @purity pure
   */
  static _collect(tokens, start, marks, colors, runs, top) {
    let pos = start;
    const spans = [];
    for (let k = 0; k < tokens.length; k++) {
      const token = tokens[k];
      const from = pos;
      const to = pos + token.raw.length;
      pos = to;
      const at = top ?? k;
      /** @purity pure */
      const add = (type, text, src, f = from, t = to) => runs.push({ type, text, src, srcFrom: f, srcTo: t, top: at, marks: { ...marks } });
      switch (token.type) {
        case "text": {
          let p = from;
          for (const part of InlineRuns.textParts(token.raw)) {
            add("text", part, part, p, p + part.length);
            p += part.length;
          }
          break;
        }
        case "escape":
          add("text", token.text, token.raw);
          break;
        case "codespan":
          add("code", token.text, token.raw);
          break;
        case "br":
          add("br", "", token.raw);
          break;
        case "strong":
        case "em":
        case "del": {
          const inner = rawOf(token.tokens);
          const d = (token.raw.length - inner.length) / 2;
          if (token.tokens && Number.isInteger(d) && d > 0 && token.raw.slice(d, token.raw.length - d) === inner) {
            InlineRuns._collect(token.tokens, from + d, { ...marks, [token.type]: true }, colors, runs, at);
          } else {
            add("atom", token.raw, token.raw);
          }
          break;
        }
        case "link": {
          const link = InlineRuns._linkOf(token);
          if (link && !link.textMap) {
            InlineRuns._collect(token.tokens, from + link.innerFrom, { ...marks, link }, colors, runs, at);
          } else {
            // marked reads the text with \[ \] as brackets: its tokens are
            // placed on the text without those backslashes, mapped back here
            const inner = [];
            if (link) InlineRuns._collect(token.tokens, 0, { ...marks, link }, colors, inner, at);
            const mapped = link && InlineRuns._mapLinkText(inner, link, from + link.innerFrom);
            if (mapped) runs.push(...mapped);
            else add("atom", token.raw, token.raw);
          }
          break;
        }
        case "html": {
          add("atom", token.raw, token.raw);
          const tag = HTML_TAG.exec(token.raw);
          if (tag && !VOID_ELEMENTS.has(tag[2].toLowerCase()) && !/\/>$/.test(token.raw)) {
            runs[runs.length - 1].tag = { name: tag[2].toLowerCase(), closing: tag[1] === "/" };
          }
          const span = InlineRuns._spanTag(token.raw, colors);
          if (span) spans.push({ index: runs.length - 1, ...span });
          break;
        }
        default:
          add("atom", token.raw, token.raw);
          break;
      }
    }
    InlineRuns._pairColorSpans(runs, spans);
  }

  /**
   * fromNodes() of one level; textOnly: inside an element that is not a
   * format, where only the text counts.
   * @purity pure
   */
  static _collectNodes(nodes, marks, linkInfo, colors, runs, textOnly) {
    for (const node of nodes) {
      if (node.kind === "text") {
        for (const ch of Array.from(node.text)) runs.push({ type: "text", text: ch, src: null, marks: { ...marks } });
        continue;
      }
      if (node.kind === "br") {
        if (!textOnly) runs.push({ type: "br", text: "", src: null, marks: { ...marks } });
        continue;
      }
      if (node.kind === "code" && !textOnly) {
        runs.push({ type: "code", text: InlineRuns._nodeText(node.children ?? []), src: null, marks: { ...marks } });
        continue;
      }
      const inner = textOnly ? null : InlineRuns._nodeMarks(node, marks, linkInfo, colors);
      InlineRuns._collectNodes(node.children ?? [], inner ?? marks, linkInfo, colors, runs, textOnly || inner === null);
    }
  }

  /**
   * The marks inside a format node, or null for a node that only gives its
   * text (INV-63).
   * @purity pure
   */
  static _nodeMarks(node, marks, linkInfo, colors) {
    switch (node.kind) {
      case "strong":
      case "em":
      case "del":
        return { ...marks, [node.kind]: true };
      case "mark":
        return marks;
      case "a": {
        const link = Number.isInteger(node.link) ? linkInfo[node.link] : undefined;
        return link ? { ...marks, link } : null;
      }
      case "span": {
        const m = /^color: (#[0-9A-Fa-f]{6})$/.exec(node.style ?? "");
        return m && colors.includes(m[1].toLowerCase()) ? { ...marks, color: m[1] } : null;
      }
      default:
        return null;
    }
  }

  /**
   * The text of nodes (a code span's content).
   * @purity pure
   */
  static _nodeText(nodes) {
    let text = "";
    for (const node of nodes) {
      if (node.kind === "text") text += node.text;
      else if (node.kind !== "br") text += InlineRuns._nodeText(node.children ?? []);
    }
    return text;
  }

  /**
   * A text token's runs: one per code point, an entity reference whole.
   * @purity pure
   * @param {string} raw
   * @returns {string[]}
   */
  static textParts(raw) {
    const parts = [];
    let last = 0;
    for (const m of raw.matchAll(ENTITY)) {
      parts.push(...Array.from(raw.slice(last, m.index)), m[0]);
      last = m.index + m[0].length;
    }
    parts.push(...Array.from(raw.slice(last)));
    return parts;
  }

  /**
   * For each run, the index of the run with the other tag of its inline
   * HTML element, or -1 (tags are matched by name; an unclosed tag inside
   * a pair is dropped, as an HTML parser does).
   * @purity pure
   * @returns {number[]}
   */
  static _tagPartners(runs) {
    const partner = new Array(runs.length).fill(-1);
    const open = [];
    for (let k = 0; k < runs.length; k++) {
      const tag = runs[k].tag;
      if (!tag) continue;
      if (!tag.closing) {
        open.push(k);
        continue;
      }
      let d = open.length - 1;
      while (d >= 0 && runs[open[d]].tag.name !== tag.name) d--;
      if (d < 0) continue;
      partner[k] = open[d];
      partner[open[d]] = k;
      open.length = d;
    }
    return partner;
  }

  /**
   * A span tag of inline HTML: {kind: "color", value} for a palette color,
   * {kind: "open"}, {kind: "close"}, or null.
   * @purity pure
   */
  static _spanTag(raw, colors) {
    if (SPAN_CLOSE.test(raw)) return { kind: "close" };
    const color = COLOR_OPEN.exec(raw);
    if (color && colors.includes(color[1].toLowerCase())) return { kind: "color", value: color[1] };
    return SPAN_OPEN.test(raw) ? { kind: "open" } : null;
  }

  /**
   * The runs between a palette color span's tags get its color (an inner
   * span wins); the two tags are removed. Other spans stay atoms.
   * @purity pure
   * @param {object[]} runs - changed in place (runs being built)
   */
  static _pairColorSpans(runs, spans) {
    const stack = [];
    const pairs = [];
    for (const span of spans) {
      if (span.kind !== "close") {
        stack.push(span);
        continue;
      }
      const open = stack.pop();
      if (open && open.kind === "color") pairs.push([open.index, span.index, open.value]);
    }
    if (pairs.length === 0) return;
    const removed = new Set();
    for (const [a, b, value] of pairs) {
      for (let i = a + 1; i < b; i++) if (!removed.has(i) && runs[i].marks.color === null) runs[i].marks.color = value;
      removed.add(a);
      removed.add(b);
    }
    let w = 0;
    for (let r = 0; r < runs.length; r++) if (!removed.has(r)) runs[w++] = runs[r];
    runs.length = w;
  }

  /**
   * A link token's notation (INV-72 (a)), or null when its text cannot be
   * found in its source.
   * @purity pure
   * @returns {object|null}
   */
  static _linkOf(token) {
    if (!token.tokens) return null;
    const raw = token.raw;
    const inner = rawOf(token.tokens);
    const base = { href: token.href, title: token.title ?? null, innerSrc: inner };
    if (raw.startsWith("<")) return raw === `<${inner}>` ? { kind: "autolink", innerFrom: 1, ...base } : null;
    if (!raw.startsWith("[")) return raw === inner ? { kind: "bare", innerFrom: 0, ...base } : null;
    if (raw.slice(1, 1 + inner.length) !== inner || raw[1 + inner.length] !== "]") {
      // the text has \[ or \], which marked reads as brackets before lexing it
      const textMap = InlineRuns._escapedTextMap(raw, inner);
      if (!textMap) return null;
      base.innerSrc = raw.slice(1, 1 + textMap[inner.length]);
      base.textMap = textMap;
    }
    const rest = raw.slice(base.innerSrc.length + 2);
    if (rest === "") return { kind: "shortcut", innerFrom: 1, ...base };
    if (rest === "[]") return { kind: "collapsed", innerFrom: 1, ...base };
    if (rest.startsWith("[")) return { kind: "reference", innerFrom: 1, label: rest.slice(1, -1), ...base };
    return { kind: "inline", innerFrom: 1, dest: rest, ...base };
  }

  /**
   * Where each offset of a link's text as marked lexed it (its \[ \] read
   * as brackets) is in the link's source text (raw from index 1): an array
   * of inner.length + 1 offsets, or null when the source does not read so.
   * @purity pure
   * @param {string} raw - the link token's source
   * @param {string} inner - its text as marked lexed it
   * @returns {number[]|null}
   */
  static _escapedTextMap(raw, inner) {
    const map = [0];
    let i = 1;
    for (let u = 0; u < inner.length; u++) {
      if (raw[i] === "\\" && raw[i + 1] === inner[u] && (inner[u] === "[" || inner[u] === "]")) i += 2;
      else if (raw[i] === inner[u]) i++;
      else return null;
      map.push(i - 1);
    }
    return raw[i] === "]" ? map : null;
  }

  /**
   * The runs of a link's text collected at 0 on the text marked lexed, put
   * back on the source (link.textMap): each text run gets its source (a
   * bracket is written \[ or \] again); null when any other run would
   * cover a backslash marked took off (the link is then kept whole).
   * @purity pure
   * @param {object[]} inner - runs owned by the caller, changed in place
   * @param {object} link
   * @param {number} base - where the link's text starts in the source
   * @returns {object[]|null}
   */
  static _mapLinkText(inner, link, base) {
    const map = link.textMap;
    for (const run of inner) {
      const source = link.innerSrc.slice(map[run.srcFrom], map[run.srcTo]);
      if (run.type === "text") run.src = source;
      else if (source !== run.src) return null;
      run.srcFrom = base + map[run.srcFrom];
      run.srcTo = base + map[run.srcTo];
    }
    return inner;
  }

  /**
   * @purity pure
   * @returns {number[]} offsets[k] = shown length before run k (length + 1 entries)
   */
  static _offsets(runs) {
    const offsets = [0];
    for (const r of runs) offsets.push(offsets[offsets.length - 1] + r.text.length);
    return offsets;
  }

  /**
   * A space or a line break (not inside markers, INV-67 (4)).
   * @purity pure
   */
  static isBlank(run) {
    return run.type === "br" || (run.type === "text" && WHITESPACE.test(run.text));
  }

  /**
   * INV-67 (4)(5): take one run off a marker at a time until every marker
   * has no space at its ends and works where it is written.
   * @purity pure
   * @param {object[]} runs - copies owned by the caller, changed in place
   */
  static _normalize(runs, context) {
    for (let guard = 0; guard <= runs.length * 3; guard++) {
      if (!InlineRuns._dropOneEnd(runs, InlineRuns.layout(runs, context), context)) return;
    }
  }

  /**
   * @purity pure
   * @returns {boolean} true when one run was taken off a marker
   */
  static _dropOneEnd(runs, layout, context) {
    for (const d of layout.delimiters) {
      const first = runs[d.from];
      const last = runs[d.to - 1];
      if (InlineRuns.isBlank(first)) first.marks[d.kind] = false;
      else if (InlineRuns.isBlank(last)) last.marks[d.kind] = false;
      else if (d.kind !== "del" && !InlineRuns._works(layout.text, d.open, d.length, context, isLeftFlanking)) first.marks[d.kind] = false;
      else if (d.kind !== "del" && !InlineRuns._works(layout.text, d.close, d.length, context, isRightFlanking)) last.marks[d.kind] = false;
      else continue;
      return true;
    }
    return false;
  }

  /**
   * Whether the run of "*" around text[at, at + length) is flanking on the
   * needed side; the text around the runs comes from context.
   * @purity pure
   */
  static _works(text, at, length, context, flanking) {
    let s = at;
    let e = at + length;
    while (s > 0 && text[s - 1] === "*" && text[s - 2] !== "\\") s--;
    while (e < text.length && text[e] === "*") e++;
    const before = s > 0 ? lastChar(text.slice(0, s)) : lastChar(context.before ?? "");
    const after = e < text.length ? firstChar(text.slice(e)) : firstChar(context.after ?? "");
    return flanking(before, after);
  }

  /**
   * @purity pure
   */
  static _emptyLayout(n) {
    return { text: "", unitFrom: new Array(n).fill(0), unitTo: new Array(n).fill(0), delimiters: [] };
  }

  /**
   * Write runs [from, to) for LEVELS[level] and the levels inside it.
   * @purity pure
   */
  static _writeLevel(runs, from, to, level, options, out) {
    if (level === LEVELS.length) {
      for (let i = from; i < to; i++) {
        out.unitFrom[i] = out.text.length;
        out.text += InlineRuns._sourceOf(runs, i, options);
        out.unitTo[i] = out.text.length;
      }
      return;
    }
    const key = LEVELS[level];
    let i = from;
    while (i < to) {
      let j = i + 1;
      while (j < to && InlineRuns._sameMark(key, runs[j].marks[key], runs[i].marks[key])) j++;
      const value = runs[i].marks[key];
      if (!value) {
        InlineRuns._writeLevel(runs, i, j, level + 1, options, out);
      } else if (key === "color") {
        out.text += `<span style="color: ${value}">`;
        InlineRuns._writeLevel(runs, i, j, level + 1, options, out);
        out.text += "</span>";
      } else if (key === "link") {
        InlineRuns._writeLink(runs, i, j, value, level, options, out);
      } else {
        const d = DELIMITERS[key];
        const open = out.text.length;
        out.text += d;
        InlineRuns._writeLevel(runs, i, j, level + 1, options, out);
        const close = out.text.length;
        out.text += d;
        out.delimiters.push({ kind: key, from: i, to: j, open, close, length: d.length });
      }
      i = j;
    }
  }

  /**
   * A link in its notation (INV-72 (a)): an inline or full reference link
   * keeps its destination or label; a collapsed or shortcut reference, an
   * autolink and a bare URL keep their form while their text is written as
   * before; otherwise the text becomes the label ([text][label]) or the
   * link an inline link ([text](href)). A new URL text keeps the form of an
   * autolink or a bare URL when options.isLinkableUrl(text) is true.
   * @purity pure
   */
  static _writeLink(runs, i, j, link, level, options, out) {
    const inner = InlineRuns._emptyLayout(runs.length);
    InlineRuns._writeLevel(runs, i, j, level + 1, options, inner);
    // In a table cell the notation came from the cell with its \| read as |
    // (as marked reads a cell): every pipe of it is written \| again.
    const pipes = (text) => InlineRuns.escapeCellPipes(text, options);
    const innerSrc = pipes(link.innerSrc);
    const same = inner.text === innerSrc;
    let prefix = "[";
    let suffix = "]";
    switch (link.kind) {
      case "inline":
        suffix = `]${pipes(link.dest)}`;
        break;
      case "reference":
        suffix = `][${pipes(link.label)}]`;
        break;
      case "collapsed":
        suffix = same ? "][]" : `][${innerSrc}]`;
        break;
      case "shortcut":
        suffix = same ? "]" : `][${innerSrc}]`;
        break;
      default: {
        const angle = link.kind === "autolink";
        if (same) {
          [prefix, suffix] = angle ? ["<", ">"] : ["", ""];
          break;
        }
        const shown = runs.slice(i, j);
        const text = shown.map((r) => r.text).join("");
        const plain = shown.every((r) => r.type === "text" && !r.marks.del && !r.marks.strong && !r.marks.em);
        if (plain && options.isLinkableUrl?.(text)) {
          InlineRuns._appendLayout(out, InlineRuns._plainLayout(runs, i, j, options), angle ? "<" : "", angle ? ">" : "", i, j);
          return;
        }
        suffix = `](${pipes(InlineRuns._destination(link.href))})`;
        break;
      }
    }
    InlineRuns._appendLayout(out, inner, prefix, suffix, i, j);
  }

  /**
   * Runs [i, j) written as their shown text (a URL text, no escapes but
   * the pipes of a table cell).
   * @purity pure
   */
  static _plainLayout(runs, i, j, options) {
    const out = InlineRuns._emptyLayout(runs.length);
    for (let k = i; k < j; k++) {
      out.unitFrom[k] = out.text.length;
      out.text += InlineRuns.escapeCellPipes(runs[k].text, options);
      out.unitTo[k] = out.text.length;
    }
    return out;
  }

  /**
   * In a table cell (options.inTableCell), each pipe not escaped by a
   * backslash is written \| (INV-69, INV-72 (d)); elsewhere the text as it is.
   * @purity pure
   * @param {string} text
   * @param {{inTableCell?: boolean}} options
   * @returns {string}
   */
  static escapeCellPipes(text, options) {
    if (!options.inTableCell || !text.includes("|")) return text;
    let out = "";
    let backslashes = 0;
    for (const ch of text) {
      out += ch === "|" && backslashes % 2 === 0 ? "\\|" : ch;
      backslashes = ch === "\\" ? backslashes + 1 : 0;
    }
    return out;
  }

  /**
   * @purity pure
   */
  static _appendLayout(out, part, prefix, suffix, i, j) {
    const shift = out.text.length + prefix.length;
    for (let k = i; k < j; k++) {
      out.unitFrom[k] = part.unitFrom[k] + shift;
      out.unitTo[k] = part.unitTo[k] + shift;
    }
    for (const d of part.delimiters) out.delimiters.push({ ...d, open: d.open + shift, close: d.close + shift });
    out.text += prefix + part.text + suffix;
  }

  /**
   * A link destination; <...> when it has a space, a parenthesis or an
   * angle bracket.
   * @purity pure
   */
  static _destination(href) {
    if (!/[\s()<>]/.test(href)) return href;
    return `<${href.replace(/</g, "%3C").replace(/>/g, "%3E")}>`;
  }

  /**
   * @purity pure
   */
  static _sameMark(key, a, b) {
    if (key === "color") return (a ? a.toLowerCase() : null) === (b ? b.toLowerCase() : null);
    return a === b;
  }

  /**
   * How one run is written: its source, or new text with INV-72 (d).
   * @purity pure
   */
  static _sourceOf(runs, i, options) {
    const run = runs[i];
    if (run.src !== null && run.src !== undefined) return run.src;
    switch (run.type) {
      case "text":
        // "!" right before a link's "[" would make it an image
        if (run.text === "!" && runs[i + 1]?.marks.link && runs[i + 1].marks.link !== run.marks.link) return "\\!";
        // in a link's text marked reads \[ \] as brackets before lexing it:
        // "\[x\](y)" would be a link inside the link, so "(" after "]" is \(
        if (run.text === "(" && run.marks.link && runs[i - 1]?.type === "text" && runs[i - 1].text === "]" && runs[i - 1].marks.link === run.marks.link) return "\\(";
        return InlineRuns._escapeChar(run.text, runs[i - 1], runs[i + 1]);
      case "code":
        return InlineRuns._codeSpan(options.inTableCell ? run.text.replace(/\|/g, "\\|") : run.text);
      case "br":
        return options.inTableCell ? "<br>" : "  \n";
      default:
        return run.text;
    }
  }

  /**
   * INV-72 (d): a backslash before a character that would be syntax; "_"
   * inside a word stays as it is.
   * @purity pure
   */
  static _escapeChar(ch, previous, next) {
    if (ch === "_") {
      const p = previous?.type === "text" ? previous.text : "";
      const n = next?.type === "text" ? next.text : "";
      return WORD_CHAR.test(p) && WORD_CHAR.test(n) ? "_" : "\\_";
    }
    return ESCAPED_CHARS.has(ch) ? `\\${ch}` : ch;
  }

  /**
   * A code span: a fence longer than any backtick run inside, with a space
   * inside each fence when the content starts or ends with a backtick, or
   * with a space at both ends.
   * @purity pure
   */
  static _codeSpan(content) {
    const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((m) => m.length));
    const fence = "`".repeat(longest + 1);
    const pad = /^`|`$/.test(content) || (/^ /.test(content) && / $/.test(content) && content.trim() !== "") ? " " : "";
    return fence + pad + content + pad + fence;
  }
}
