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
   * Bold / Italic / text color over [start, end) of the shown text (a line
   * break counts 0). null when the range holds no run, or only spaces for
   * Bold / Italic.
   * @purity pure
   * @param {object[]} runs
   * @param {number} start
   * @param {number} end
   * @param {{kind: "strong"|"em"|"color", value?: string|null}} op
   * @param {object} [context] - before / after: the text around the runs
   * @returns {{runs: object[], start: number, end: number}|null} start / end: the range after INV-67 (6)
   */
  static apply(runs, start, end, op, context = {}) {
    const offsets = InlineRuns._offsets(runs);
    let from = -1;
    let to = -1;
    for (let k = 0; k < runs.length; k++) {
      const a = offsets[k];
      const b = offsets[k + 1];
      const inside = b > a ? a < end && b > start : a > start && a < end;
      if (!inside) continue;
      if (from < 0) from = k;
      to = k + 1;
    }
    if (from < 0) return null;
    const result = InlineRuns.applyUnits(runs, from, to, op, context);
    if (!result) return null;
    return { runs: result.runs, start: offsets[result.from], end: offsets[result.to] };
  }

  /**
   * apply() on the runs [from, to) by index (the block editor's path).
   * INV-67: (6) a link is taken whole (code spans and atoms are one run);
   * (3) Bold / Italic come off when every selected character has them, else
   * go on the whole range; (4) spaces at the ends go outside the markers;
   * (5) an end whose markers would not work is dropped from the range.
   * @purity pure
   * @param {object[]} runs - not changed
   * @param {number} from
   * @param {number} to - exclusive
   * @param {{kind: string, value?: string|null}} op
   * @param {object} [context] - before / after / inTableCell
   * @returns {{runs: object[], from: number, to: number}|null}
   */
  static applyUnits(runs, from, to, op, context = {}) {
    if (!(from < to)) return null;
    const { from: i, to: j } = InlineRuns.expandRange(runs, from, to);
    const out = runs.map((r) => ({ ...r, marks: { ...r.marks } }));
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
   * @param {object} [options]
   * @returns {{text: string, unitFrom: number[], unitTo: number[], delimiters: object[]}}
   */
  static layout(runs, options = {}) {
    const out = InlineRuns._emptyLayout(runs.length);
    InlineRuns._writeLevel(runs, 0, runs.length, 0, options, out);
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
          if (link) InlineRuns._collect(token.tokens, from + link.innerFrom, { ...marks, link }, colors, runs, at);
          else add("atom", token.raw, token.raw);
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
    if (raw.slice(1, 1 + inner.length) !== inner || raw[1 + inner.length] !== "]") return null;
    const rest = raw.slice(inner.length + 2);
    if (rest === "") return { kind: "shortcut", innerFrom: 1, ...base };
    if (rest === "[]") return { kind: "collapsed", innerFrom: 1, ...base };
    if (rest.startsWith("[")) return { kind: "reference", innerFrom: 1, label: rest.slice(1, -1), ...base };
    return { kind: "inline", innerFrom: 1, dest: rest, ...base };
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
    const same = inner.text === link.innerSrc;
    let prefix = "[";
    let suffix = "]";
    switch (link.kind) {
      case "inline":
        suffix = `]${link.dest}`;
        break;
      case "reference":
        suffix = `][${link.label}]`;
        break;
      case "collapsed":
        suffix = same ? "][]" : `][${link.innerSrc}]`;
        break;
      case "shortcut":
        suffix = same ? "]" : `][${link.innerSrc}]`;
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
          InlineRuns._appendLayout(out, InlineRuns._plainLayout(runs, i, j), angle ? "<" : "", angle ? ">" : "", i, j);
          return;
        }
        suffix = `](${InlineRuns._destination(link.href)})`;
        break;
      }
    }
    InlineRuns._appendLayout(out, inner, prefix, suffix, i, j);
  }

  /**
   * Runs [i, j) written as their shown text (a URL text, no escapes).
   * @purity pure
   */
  static _plainLayout(runs, i, j) {
    const out = InlineRuns._emptyLayout(runs.length);
    for (let k = i; k < j; k++) {
      out.unitFrom[k] = out.text.length;
      out.text += runs[k].text;
      out.unitTo[k] = out.text.length;
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
