import InlineRuns from "./InlineRuns.js";

// Leaf blocks whose text is inline Markdown (the inline ranges, INV-67 (6)).
const INLINE_LEAVES = new Set(["paragraph", "text", "heading", "table"]);
// Paragraph text (a top-level paragraph, a list item, a paragraph in a quote).
const PARAGRAPH_LEAVES = new Set(["paragraph", "text"]);
// Leaves whose line end spaces may be removed on commit (INV-71 (6)); in
// code, HTML or math the spaces are content and are never tried.
const STRIPPABLE_LEAVES = new Set(["paragraph", "text", "heading", "table"]);
const QUOTE_MARKS = /^[ \t]*(?:>[ \t]*)+/;
const COLOR_OPEN = /^<span style="color: (#[0-9A-Fa-f]{6})">$/;
const SPAN_OPEN = /^<span(?:\s[^>]*)?>$/i;
const SPAN_CLOSE = /^<\/span\s*>$/i;
const LINE_BREAK_SPACES = / {2,}$/;
// INV-71 (6) lexes a block at most this many times (INV-51: about 300 ms
// on a 1,000-line block); the candidates not decided by then stay as they
// are (what is shown does not change).
const STRIP_MAX_LEXES = 8;

/**
 * @purity pure
 * @returns {number}
 */
function countNewlines(s) {
  let n = 0;
  for (let i = s.indexOf("\n"); i >= 0; i = s.indexOf("\n", i + 1)) n++;
  return n;
}

/**
 * @purity pure
 * @returns {string}
 */
function rawOf(tokens) {
  return tokens.map((t) => t.raw).join("");
}

/**
 * Markdown text edits on the block editor's string (spec 5.14.5, INV-52,
 * INV-67, INV-71). Stateless and pure: no DOM, no CONFIG (templates, colors
 * and lexers come in as arguments).
 * Every operation returns a TextEdit { text, selStart, selEnd } (or null
 * when it does not apply).
 */
export default class MarkdownTextOps {
  /**
   * Insert an empty row under the caret line of a table. On the header or the
   * delimiter line, the row goes right under the delimiter (Q6 b).
   * The caret ends at the end of the new row.
   * @purity pure
   * @param {string} tableRaw
   * @param {number} caretOffset
   * @returns {{text: string, selStart: number, selEnd: number}}
   */
  static insertTableRow(tableRaw, caretOffset) {
    const lines = tableRaw.split("\n");
    const caretLine = MarkdownTextOps._lineIndexAt(tableRaw, caretOffset);
    const after = Math.max(caretLine, 1);
    const header = MarkdownTextOps.splitTableRow(lines[0]);
    const cells = header.segments.slice(header.first, header.last).map(() => "  ");
    const row = MarkdownTextOps._joinRow(header, cells);
    lines.splice(after + 1, 0, row);
    const text = lines.join("\n");
    const end = MarkdownTextOps._lineStart(lines, after + 1) + row.length;
    return { text, selStart: end, selEnd: end };
  }

  /**
   * Insert an empty column right of the caret column, on every table line.
   * Cells are split only at pipes without a backslash in front (a pipe inside
   * a code span is a separator, as in marked). New alignment is the default.
   * The caret ends at the end of the new cell on the caret line.
   * @purity pure
   * @param {string} tableRaw
   * @param {number} caretOffset
   * @returns {{text: string, selStart: number, selEnd: number}}
   */
  static insertTableColumn(tableRaw, caretOffset) {
    const lines = tableRaw.split("\n");
    const offset = MarkdownTextOps._clamp(caretOffset, tableRaw);
    const caretLine = MarkdownTextOps._lineIndexAt(tableRaw, offset);
    const caretCol = offset - MarkdownTextOps._lineStart(lines, caretLine);
    const caretRow = MarkdownTextOps.splitTableRow(lines[caretLine]);
    const pipesBefore = MarkdownTextOps._pipePositions(lines[caretLine]).filter((p) => p < caretCol).length;
    const cellCount = caretRow.last - caretRow.first;
    const column = Math.min(Math.max(pipesBefore - caretRow.first, 0), Math.max(cellCount - 1, 0));

    let caretEnd = offset;
    let pos = 0;
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "") {
        out.push(line);
        pos += line.length + 1;
        continue;
      }
      const row = MarkdownTextOps.splitTableRow(line);
      const cells = row.segments.slice(row.first, row.last);
      const at = Math.min(column + 1, cells.length);
      cells.splice(at, 0, i === 1 ? "---" : "  ");
      const joined = MarkdownTextOps._joinRow(row, cells);
      if (i === caretLine) {
        const head = row.first === 1 ? [row.segments[0]] : [];
        caretEnd = pos + [...head, ...cells.slice(0, at + 1)].join("|").length;
      }
      out.push(joined);
      pos += joined.length + 1;
    }
    const text = out.join("\n");
    return { text, selStart: caretEnd, selEnd: caretEnd };
  }

  /**
   * Insert a block (template) at the caret, adding blank lines before and
   * after only where they are missing (never three newlines in a row).
   * The caret ends at the end of the inserted block (Q6 c).
   * @purity pure
   * @param {string} text
   * @param {number} caretOffset
   * @param {string} blockText
   * @returns {{text: string, selStart: number, selEnd: number}}
   */
  static insertBlockText(text, caretOffset, blockText) {
    const o = MarkdownTextOps._clamp(caretOffset, text);
    const before = text.slice(0, o);
    const after = text.slice(o);
    let lead = "\n\n";
    if (before === "" || before.endsWith("\n\n")) lead = "";
    else if (before.endsWith("\n")) lead = "\n";
    let trail = "\n\n";
    if (after === "" || after.startsWith("\n\n")) trail = "";
    else if (after.startsWith("\n")) trail = "\n";
    const end = before.length + lead.length + blockText.length;
    return { text: before + lead + blockText + trail + after, selStart: end, selEnd: end };
  }

  /**
   * Insert plain text at the caret (used for <br> in tables, INV-27).
   * @purity pure
   * @param {string} text
   * @param {number} caretOffset
   * @param {string} insertText
   * @returns {{text: string, selStart: number, selEnd: number}}
   */
  static insertTextAt(text, caretOffset, insertText) {
    const o = MarkdownTextOps._clamp(caretOffset, text);
    const end = o + insertText.length;
    return { text: text.slice(0, o) + insertText + text.slice(o), selStart: end, selEnd: end };
  }

  /**
   * The one range that differs between two texts: replacing before[start, end)
   * with text gives after (only this range goes through the browser's
   * undoable insertText, INV-52).
   * @purity pure
   * @param {string} before
   * @param {string} after
   * @returns {{start: number, end: number, text: string}}
   */
  static changedRange(before, after) {
    let start = 0;
    const limit = Math.min(before.length, after.length);
    while (start < limit && before[start] === after[start]) start++;
    let endBefore = before.length;
    let endAfter = after.length;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
      endBefore--;
      endAfter--;
    }
    return { start, end: endBefore, text: after.slice(start, endAfter) };
  }

  /**
   * Bold / Italic / text color on the selection (INV-66, INV-67 (6)(7)).
   * The inline range that holds the selection is lexed; only its top-level
   * tokens the selection touches (and a formatted token right next to them)
   * are written again (InlineRuns); the rest of the text is not changed.
   * The rewrite is lexed again and must show what was meant (INV-67 (8)).
   * null when it does not apply (no inline range, nothing selected, nothing
   * would change).
   * @purity pure
   * @param {string} text
   * @param {number} selStart
   * @param {number} selEnd
   * @param {{kind: "strong"|"em"|"color", value?: string|null}} op
   * @param {{lexBlocks: Function, lexInline: Function, colors?: string[]}} context
   * @returns {{text: string, selStart: number, selEnd: number}|null}
   */
  static formatRange(text, selStart, selEnd, op, context) {
    const range = MarkdownTextOps._inlineRangeAt(text, selStart, selEnd, context.lexBlocks);
    if (!range) return null;
    const { segments } = range;
    const inline = segments.map((g) => text.slice(g.from, g.to)).join("\n");
    const tokens = context.lexInline(inline);
    if (rawOf(tokens) !== inline) return null;
    const colors = context.colors ?? [];
    const runs = InlineRuns.fromTokens(tokens, { colors });
    const touched = InlineRuns.unitRangeOfSource(
      runs,
      MarkdownTextOps._toInline(segments, range.s),
      MarkdownTextOps._toInline(segments, range.e),
    );
    if (!touched) return null;
    const picked = InlineRuns.expandRange(runs, touched.from, touched.to);
    const work = { text, segments, inline, runs, picked, op, colors, inTableCell: range.inTableCell, lexInline: context.lexInline };
    // First without a neighbour the format does not merge with (its
    // notation stays, INV-67 (7)); when that cannot be written so that
    // marked reads it as meant, with the neighbours that have the format.
    const strict = MarkdownTextOps._regionOf(tokens, runs, picked, colors, op, false);
    const edit = MarkdownTextOps._rewrite(work, strict);
    if (edit) return edit;
    const loose = MarkdownTextOps._regionOf(tokens, runs, picked, colors, op, true);
    if (loose.from === strict.from && loose.to === strict.to) return null;
    return MarkdownTextOps._rewrite(work, loose);
  }

  /**
   * formatRange on one region: apply, write, check against marked
   * (INV-67 (8)), and put the inline range back into the text.
   * @purity pure
   * @returns {{text: string, selStart: number, selEnd: number}|null}
   */
  static _rewrite(work, region) {
    const { inline, runs, picked, op, colors } = work;
    const options = { before: inline.slice(0, region.srcFrom), after: inline.slice(region.srcTo), inTableCell: work.inTableCell };
    const result = InlineRuns.applyUnits(runs.slice(region.from, region.to), picked.from - region.from, picked.to - region.from, op, options);
    if (!result) return null;
    const layout = InlineRuns.layout(result.runs, options);
    const next = inline.slice(0, region.srcFrom) + layout.text + inline.slice(region.srcTo);
    if (next === inline) return null;
    const check = work.lexInline(next);
    if (rawOf(check) !== next) return null;
    const expected = [...runs.slice(0, region.from), ...result.runs, ...runs.slice(region.to)];
    const shown = JSON.stringify(InlineRuns.signature(InlineRuns.fromTokens(check, { colors })));
    if (shown !== JSON.stringify(InlineRuns.signature(expected))) return null;
    // The selection: the characters that got the format (inside the
    // markers; the punctuation and spaces left out by INV-67 (4)(5) are not
    // selected), so that the same button takes it off again (5.14.14).
    let from = result.from;
    let to = result.to;
    if (op.kind !== "color" && result.runs.slice(from, to).some((r) => r.marks[op.kind])) {
      while (!result.runs[from].marks[op.kind]) from++;
      while (!result.runs[to - 1].marks[op.kind]) to--;
    }
    const selFrom = region.srcFrom + layout.unitFrom[from];
    const selTo = region.srcFrom + layout.unitTo[to - 1];
    return MarkdownTextOps._writeInline(work.text, work.segments, next, selFrom, selTo);
  }

  /**
   * The selection is in one inline range (5.15.5: Bold / Italic / colors).
   * Only the blocks are lexed.
   * @purity pure
   * @param {string} text
   * @param {number} selStart
   * @param {number} selEnd
   * @param {(src: string) => object[]} lexBlocks
   * @returns {boolean}
   */
  static canFormatRange(text, selStart, selEnd, lexBlocks) {
    return MarkdownTextOps._inlineRangeAt(text, selStart, selEnd, lexBlocks) !== null;
  }

  /**
   * Enter / Shift+Enter in a paragraph, list or quote block (INV-71 (1)-(5)):
   * the selection is replaced; on a line of paragraph text with text before
   * the caret, two spaces and a newline (and the line's quote marks) go in;
   * with only spaces or quote marks before the caret, a newline goes in and
   * the line break mark of the line before is removed (a paragraph break).
   * List item marks are not added. null: a normal newline (code, HTML, math,
   * a heading, or a line that is not paragraph text; inside a code span, an
   * inline HTML tag, inline math or other inline syntax, owner ruling
   * 2026-10-22).
   * @purity pure
   * @param {string} text
   * @param {number} selStart
   * @param {number} selEnd
   * @param {{lexBlocks: Function, lexInline: Function}} lexers
   * @returns {{text: string, selStart: number, selEnd: number}|null}
   */
  static insertHardBreak(text, selStart, selEnd, lexers) {
    const s = MarkdownTextOps._clamp(Math.min(selStart, selEnd), text);
    const e = MarkdownTextOps._clamp(Math.max(selStart, selEnd), text);
    const info = MarkdownTextOps._leafLines(text, lexers.lexBlocks);
    if (!info) return null;
    const n = MarkdownTextOps._lineIndexAt(text, s);
    const lineStart = text.lastIndexOf("\n", s - 1) + 1;
    const before = text.slice(lineStart, s);
    /** @purity pure */
    const isParagraph = (k) => k >= 0 && PARAGRAPH_LEAVES.has(info[k]?.leaf?.type);
    // The selection's end must be in the same paragraph as its start.
    const ne = MarkdownTextOps._lineIndexAt(text, e);
    /** @purity pure */
    const inLeaf = (leaf) => ne === n || info[ne]?.leaf === leaf;
    if (!/^[ \t]*(?:>[ \t]*)*$/.test(before)) {
      if (!isParagraph(n)) return null;
      // in or right after the list marks of the line: not paragraph text
      if (s <= lineStart + info[n].prefix || !inLeaf(info[n].leaf)) return null;
      if (MarkdownTextOps._cutsInlineSyntax(text, info, n, [s, e], lexers.lexInline)) return null;
      const lineEnd = text.indexOf("\n", s) < 0 ? text.length : text.indexOf("\n", s);
      const marks = info[n].quote ? (QUOTE_MARKS.exec(text.slice(lineStart, lineEnd))?.[0] ?? "") : "";
      const insert = `  \n${marks}`;
      return { text: text.slice(0, s) + insert + text.slice(e), selStart: s + insert.length, selEnd: s + insert.length };
    }
    const here = info[n];
    if (!(isParagraph(n) || (!here?.leaf && isParagraph(n - 1)))) return null;
    if (!inLeaf(isParagraph(n) ? here.leaf : info[n - 1].leaf)) return null;
    // At the start of a paragraph line: the line break of the line before
    // may be inside a code span or an attribute value (INV-71 (1) (i)-(xi)).
    if (isParagraph(n) && MarkdownTextOps._cutsInlineSyntax(text, info, n, [s, e], lexers.lexInline)) return null;
    const inQuote = Boolean(here?.quote || info[n - 1]?.quote);
    let head = text.slice(0, s);
    if (isParagraph(n - 1)) {
      const prevEnd = lineStart - 1;
      const prevStart = text.lastIndexOf("\n", prevEnd - 1) + 1;
      const mark = LINE_BREAK_SPACES.exec(text.slice(prevStart, prevEnd));
      if (mark) head = text.slice(0, prevStart + mark.index) + text.slice(prevEnd, s);
    }
    const insert = `\n${inQuote && before.includes(">") ? before : ""}`;
    const caret = head.length + insert.length;
    return { text: head + insert + text.slice(e), selStart: caret, selEnd: caret };
  }

  /**
   * INV-71 (6), on commit of a paragraph, list or quote block: each line
   * end of two or more spaces is removed when removing it changes neither
   * the number of line breaks (br) nor what the tokens hold (the type and
   * the plain attributes of every token but text and space, the text of a
   * token with children aside). Only raw is lexed.
   * @purity pure
   * @param {string} raw
   * @param {(src: string) => object[]} lexFull - blocks and inline tokens
   * @param {(tokens: object[], fn: Function) => void} walkTokens - marked.walkTokens
   * @returns {string}
   */
  static stripMeaninglessHardBreaks(raw, lexFull, walkTokens) {
    const candidates = [];
    const lines = raw.split("\n");
    for (let n = 0; n < lines.length; n++) if (LINE_BREAK_SPACES.test(lines[n])) candidates.push(n);
    if (candidates.length === 0) return raw;
    const tokens = lexFull(raw);
    const state = { text: raw, shape: MarkdownTextOps._tokenShape(tokens, walkTokens), lexes: 1 };
    // Every candidate makes a line break: none can go.
    if (state.shape.spaceBreaks === candidates.length) return raw;
    // A line of paragraph text that is not the last line of its paragraph
    // is expected to make a line break; the others are expected not to.
    // Each group is tried at once and halved only when that fails, so a
    // usual block is lexed two or three times (INV-51).
    const info = MarkdownTextOps._leafLines(raw, () => tokens);
    const breaking = [];
    const others = [];
    for (const n of candidates) {
      const at = info?.[n];
      if (at && !(at.leaf && STRIPPABLE_LEAVES.has(at.leaf.type))) continue; // code, HTML, math, unknown
      if (PARAGRAPH_LEAVES.has(at?.leaf?.type) && at.index < at.count - 1) breaking.push(n);
      else others.push(n);
    }
    MarkdownTextOps._stripGroup(state, others, lexFull, walkTokens);
    if (state.shape.spaceBreaks !== breaking.length) MarkdownTextOps._stripGroup(state, breaking, lexFull, walkTokens);
    return state.text;
  }

  /**
   * Per line: whether it ends with a line break mark (two or more spaces)
   * in paragraph text (the marks of INV-70; not in code, HTML, math).
   * @purity pure
   * @param {string} text
   * @param {(src: string) => object[]} lexBlocks
   * @returns {boolean[]}
   */
  static hardBreakLines(text, lexBlocks) {
    const info = MarkdownTextOps._leafLines(text, lexBlocks);
    /** @purity pure */
    return text.split("\n").map((line, n) => LINE_BREAK_SPACES.test(line) && PARAGRAPH_LEAVES.has(info?.[n]?.leaf?.type));
  }

  // ---- helpers (pure) ----

  /**
   * @purity pure
   * @returns {number} offset clamped to [0, text.length] (Q6 d)
   */
  static _clamp(offset, text) {
    const n = Number.isFinite(offset) ? Math.trunc(offset) : 0;
    return Math.min(Math.max(n, 0), text.length);
  }

  /**
   * @purity pure
   * @returns {number} index of the line that holds the offset
   */
  static _lineIndexAt(text, offset) {
    const o = MarkdownTextOps._clamp(offset, text);
    return text.slice(0, o).split("\n").length - 1;
  }

  /**
   * @purity pure
   * @returns {number} offset where line i starts
   */
  static _lineStart(lines, i) {
    let pos = 0;
    for (let k = 0; k < i; k++) pos += lines[k].length + 1;
    return pos;
  }

  /**
   * Positions of the pipes that separate cells (not escaped with a backslash).
   * @purity pure
   * @param {string} line
   * @returns {number[]}
   */
  static _pipePositions(line) {
    const out = [];
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "\\") {
        i++;
        continue;
      }
      if (line[i] === "|") out.push(i);
    }
    return out;
  }

  /**
   * Split a table line into segments at separating pipes (not escaped with a
   * backslash; a pipe inside a code span separates too, as in marked). With
   * outer pipes the first and last segments are the (empty) outside parts.
   * Shared with MarkdownTable (one rule for cells).
   * @purity pure
   * @param {string} line
   * @returns {{segments: string[], first: number, last: number}}
   */
  static splitTableRow(line) {
    const segments = [];
    let from = 0;
    for (const p of MarkdownTextOps._pipePositions(line)) {
      segments.push(line.slice(from, p));
      from = p + 1;
    }
    segments.push(line.slice(from));
    const first = segments.length > 1 && segments[0].trim() === "" ? 1 : 0;
    const last =
      segments.length - 1 > first && segments[segments.length - 1].trim() === ""
        ? segments.length - 1
        : segments.length;
    return { segments, first, last };
  }

  /**
   * Rebuild a table line from cells, keeping the outer parts of the original row.
   * @purity pure
   */
  static _joinRow(row, cells) {
    const head = row.first === 1 ? [row.segments[0]] : [];
    const tail = row.last < row.segments.length ? [row.segments[row.segments.length - 1]] : [];
    return [...head, ...cells, ...tail].join("|");
  }

  /**
   * Per line of text: the leaf block it is in ({leaf, index, count, prefix,
   * quote, list}: index is the line within the leaf, prefix the length of
   * the list / quote marks in front), or null on a blank line or where the
   * leaf's lines cannot be found in the text. null when the tokens do not
   * add up to the text.
   * @purity pure
   * @param {string} text
   * @param {(src: string) => object[]} lexBlocks
   * @returns {Array<object|null>|null}
   */
  static _leafLines(text, lexBlocks) {
    const tokens = lexBlocks(text);
    if (rawOf(tokens) !== text) return null;
    const lines = text.split("\n");
    const info = new Array(lines.length).fill(null);
    MarkdownTextOps._mapLeaves(tokens, 0, lines, info, { quote: false, list: false });
    return info;
  }

  /**
   * @purity pure
   * @param {object[]} info - filled in place (being built)
   */
  static _mapLeaves(tokens, firstLine, lines, info, where) {
    let line = firstLine;
    for (const token of tokens) {
      if (token.type === "list") {
        let at = line;
        for (const item of token.items ?? []) {
          MarkdownTextOps._mapLeaves(item.tokens ?? [], at, lines, info, { ...where, list: true });
          at += countNewlines(item.raw);
        }
      } else if (token.type === "blockquote") {
        MarkdownTextOps._mapLeaves(token.tokens ?? [], line, lines, info, { ...where, quote: true });
      } else if (token.type !== "space") {
        const own = token.raw.replace(/\n+$/, "").split("\n");
        for (let k = 0; k < own.length && line + k < lines.length; k++) {
          const n = line + k;
          const part = own[k];
          // marked may leave the spaces at a line end to a space token, and
          // turns the tabs that indent a line into spaces
          const original = lines[n].replace(/[ \t]+$/, "");
          const shown = part.replace(/[ \t]+$/, "").replace(/^[ \t]+/, "");
          info[n] = original.endsWith(shown)
            ? { leaf: token, index: k, count: own.length, prefix: original.length - shown.length, ...where }
            : { leaf: null, ...where };
        }
      }
      line += countNewlines(token.raw);
    }
  }

  /**
   * Whether one of the offsets cuts inline syntax of the paragraph that
   * holds line n (INV-71 (1)): inside a code span, an HTML tag, math, an
   * entity, an escape, a link destination or an autolink, or at the inner
   * edge of emphasis markers (a break there would undo them). true also when
   * the paragraph cannot be lexed back to itself.
   * @purity pure
   */
  static _cutsInlineSyntax(text, info, n, offsets, lexInline) {
    const at = info[n];
    const lines = text.split("\n");
    const starts = [0];
    for (const line of lines) starts.push(starts[starts.length - 1] + line.length + 1);
    const segments = MarkdownTextOps._leafSegments(lines, starts, info, n - at.index, at.count, at.leaf);
    if (!segments) return true;
    const inline = segments.map((g) => text.slice(g.from, g.to)).join("\n");
    const tokens = lexInline(inline);
    if (rawOf(tokens) !== inline) return true;
    const cut = new Set();
    MarkdownTextOps._syntaxInsides(tokens, 0, cut);
    return offsets.some((o) => cut.has(MarkdownTextOps._toInline(segments, o)));
  }

  /**
   * Add to cut the offsets a line break must not go to: the inside of a
   * token kept whole, and the inside of the markers of emphasis and of the
   * brackets of a link (the text between them is looked at token by token).
   * @purity pure
   * @param {Set<number>} cut - filled in place (the caller's working value)
   */
  static _syntaxInsides(tokens, start, cut) {
    let pos = start;
    for (const token of tokens) {
      const from = pos;
      const to = pos + token.raw.length;
      pos = to;
      if (token.type === "text") {
        let p = from;
        for (const part of InlineRuns.textParts(token.raw)) {
          for (let k = p + 1; k < p + part.length; k++) cut.add(k);
          p += part.length;
        }
        continue;
      }
      const inner = MarkdownTextOps._innerOf(token);
      if (inner) {
        for (let k = from + 1; k <= from + inner.from; k++) cut.add(k);
        for (let k = from + inner.to; k < to; k++) cut.add(k);
        MarkdownTextOps._syntaxInsides(token.tokens, from + inner.from, cut);
        continue;
      }
      for (let k = from + 1; k < to; k++) cut.add(k);
    }
  }

  /**
   * Where the child tokens of emphasis or a bracketed link are in its
   * source ({from, to}, relative), or null for a token kept whole.
   * @purity pure
   */
  static _innerOf(token) {
    if (!token.tokens || !["strong", "em", "del", "link"].includes(token.type)) return null;
    const inner = rawOf(token.tokens);
    if (token.type === "link") {
      if (!token.raw.startsWith("[") || token.raw.slice(1, 1 + inner.length) !== inner) return null;
      return { from: 1, to: 1 + inner.length };
    }
    const d = (token.raw.length - inner.length) / 2;
    if (!Number.isInteger(d) || d <= 0 || token.raw.slice(d, token.raw.length - d) !== inner) return null;
    return { from: d, to: d + inner.length };
  }

  /**
   * The inline range that holds [selStart, selEnd) (glossary, INV-67 (6)):
   * {segments: [{from, to}] (its text, one per line, without the list /
   * quote marks), s, e (the selection moved off the marks), inTableCell}.
   * A newline at either end of the selection is left out. null when the
   * selection is empty or not in one paragraph, heading or table cell.
   * @purity pure
   */
  static _inlineRangeAt(text, selStart, selEnd, lexBlocks) {
    let s = MarkdownTextOps._clamp(Math.min(selStart, selEnd), text);
    let e = MarkdownTextOps._clamp(Math.max(selStart, selEnd), text);
    if (e > s && text[e - 1] === "\n") e--;
    if (e > s && text[s] === "\n") s++;
    if (s >= e) return null;
    const info = MarkdownTextOps._leafLines(text, lexBlocks);
    if (!info) return null;
    const ls = MarkdownTextOps._lineIndexAt(text, s);
    const le = MarkdownTextOps._lineIndexAt(text, e);
    const a = info[ls];
    if (!a?.leaf || info[le]?.leaf !== a.leaf || !INLINE_LEAVES.has(a.leaf.type)) return null;
    const lines = text.split("\n");
    const starts = [0];
    for (const line of lines) starts.push(starts[starts.length - 1] + line.length + 1);
    const first = ls - a.index;
    let segments;
    if (a.leaf.type === "table") {
      if (ls !== le || a.index === 1) return null;
      segments = MarkdownTextOps._cellSegment(lines[ls], starts[ls], a.prefix, s, e);
    } else if (a.leaf.type === "heading") {
      segments = MarkdownTextOps._headingSegments(lines, starts, info, first, a);
    } else {
      segments = MarkdownTextOps._leafSegments(lines, starts, info, first, a.count, a.leaf);
    }
    if (!segments || segments.length === 0) return null;
    // A selection end on the marks of a line moves to the text next to it.
    const into = segments.find((g) => g.to >= s);
    const outOf = [...segments].reverse().find((g) => g.from <= e);
    if (!into || !outOf) return null;
    s = Math.max(s, into.from);
    e = Math.min(e, outOf.to);
    if (s >= e) return null;
    return { segments, s, e, inTableCell: a.leaf.type === "table" };
  }

  /**
   * The lines of a paragraph leaf, without their marks.
   * @purity pure
   */
  static _leafSegments(lines, starts, info, first, count, leaf) {
    const out = [];
    for (let k = 0; k < count; k++) {
      const n = first + k;
      if (info[n]?.leaf !== leaf) return null;
      out.push({ from: starts[n] + info[n].prefix, to: starts[n] + lines[n].length });
    }
    return out;
  }

  /**
   * An ATX heading's text without the # marks; a setext heading's lines
   * without the underline.
   * @purity pure
   */
  static _headingSegments(lines, starts, info, first, at) {
    if (at.count > 1) return MarkdownTextOps._leafSegments(lines, starts, info, first, at.count - 1, at.leaf);
    const line = lines[first].slice(at.prefix);
    const open = /^ {0,3}#{1,6}(?=[ \t]|$)[ \t]*/.exec(line);
    if (!open) return null;
    const rest = line.slice(open[0].length);
    const body = rest.replace(/(?:^|[ \t]+)#+[ \t]*$/, "").replace(/[ \t]+$/, "");
    const from = starts[first] + at.prefix + open[0].length;
    return [{ from, to: from + body.length }];
  }

  /**
   * The cell of a table line that holds [s, e), without the spaces and
   * tabs around its text; null across cells.
   * @purity pure
   */
  static _cellSegment(line, lineStart, prefix, s, e) {
    const content = line.slice(prefix);
    const base = lineStart + prefix;
    const pipes = MarkdownTextOps._pipePositions(content);
    /** @purity pure */
    const cellOf = (offset) => {
      const c = offset - base;
      const left = pipes.filter((p) => p < c).pop();
      const right = pipes.find((p) => p >= c);
      return [left === undefined ? 0 : left + 1, right === undefined ? content.length : right];
    };
    const [from, to] = cellOf(s);
    const [from2, to2] = cellOf(e);
    if (from !== from2 || to !== to2) return null;
    const cell = content.slice(from, to);
    const lead = cell.length - cell.replace(/^[ \t]+/, "").length;
    const trail = cell.length - cell.replace(/[ \t]+$/, "").length;
    return [{ from: base + from + lead, to: base + to - trail }];
  }

  /**
   * An offset of the text in an inline range's own text (segments joined
   * with "\n").
   * @purity pure
   */
  static _toInline(segments, offset) {
    let base = 0;
    for (const g of segments) {
      if (offset <= g.to) return base + Math.max(0, offset - g.from);
      base += g.to - g.from + 1;
    }
    return base - 1;
  }

  /**
   * The runs and the source range written again: the top-level tokens the
   * picked runs come from (a palette color span with its content is one
   * group), and the group right before or after them when the picked runs
   * start or end that group and the run next to them has the format being
   * put on (so that the two merge, INV-67 (2)). Other neighbours keep
   * their notation (INV-67 (7)); with always, a neighbour that has the
   * format is taken also when the format comes off.
   * @purity pure
   * @returns {{from: number, to: number, srcFrom: number, srcTo: number}}
   */
  static _regionOf(tokens, runs, picked, colors, op, always) {
    const groupStart = MarkdownTextOps._tokenGroups(tokens, colors);
    const groupEnd = new Array(tokens.length);
    for (let k = tokens.length - 1; k >= 0; k--) {
      groupEnd[k] = k + 1 < tokens.length && groupStart[k + 1] === groupStart[k] ? groupEnd[k + 1] : k;
    }
    // Bold / Italic merge only when they go on (not every selected
    // character has them already); a color only when it is set.
    const shown = runs.slice(picked.from, picked.to).filter((r) => !InlineRuns.isBlank(r));
    const turnsOn = op.kind === "color" ? Boolean(op.value) : !shown.every((r) => r.marks[op.kind]);
    /** @purity pure */
    const merges = (run) => {
      if (!turnsOn && !always) return false;
      if (op.kind === "color") return Boolean(op.value && run.marks.color && run.marks.color.toLowerCase() === op.value.toLowerCase());
      return Boolean(run.marks[op.kind]);
    };
    let ta = groupStart[runs[picked.from].top];
    let tb = groupEnd[runs[picked.to - 1].top];
    const before = runs[picked.from - 1];
    const after = runs[picked.to];
    if (before && before.top < ta && merges(before)) ta = groupStart[before.top];
    if (after && after.top > tb && merges(after)) tb = groupEnd[after.top];
    let from = 0;
    while (from < runs.length && runs[from].top < ta) from++;
    let to = from;
    while (to < runs.length && runs[to].top <= tb) to++;
    const srcFrom = rawOf(tokens.slice(0, ta)).length;
    const srcTo = srcFrom + rawOf(tokens.slice(ta, tb + 1)).length;
    return { from, to, srcFrom, srcTo };
  }

  /**
   * For each top-level token, the index of the first token of its group:
   * the tokens from a palette color span's opening tag to its closing tag
   * are one group.
   * @purity pure
   * @returns {number[]}
   */
  static _tokenGroups(tokens, colors) {
    const groupStart = tokens.map((_, k) => k);
    const stack = [];
    const palette = colors.map((c) => c.toLowerCase());
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.type !== "html") continue;
      if (SPAN_CLOSE.test(t.raw)) {
        const open = stack.pop();
        if (open?.color) for (let i = open.k; i <= k; i++) groupStart[i] = groupStart[open.k];
      } else if (SPAN_OPEN.test(t.raw)) {
        const color = COLOR_OPEN.exec(t.raw);
        stack.push({ k, color: Boolean(color && palette.includes(color[1].toLowerCase())) });
      }
    }
    return groupStart;
  }

  /**
   * Put an inline range's new text back into its lines (the list / quote
   * marks between them stay) and map the selection to the new text.
   * null when the line count changed.
   * @purity pure
   */
  static _writeInline(text, segments, next, selFrom, selTo) {
    const pieces = next.split("\n");
    if (pieces.length !== segments.length) return null;
    let out = "";
    let last = 0;
    const newStarts = [];
    for (let k = 0; k < segments.length; k++) {
      out += text.slice(last, segments[k].from);
      newStarts.push(out.length);
      out += pieces[k];
      last = segments[k].to;
    }
    out += text.slice(last);
    /** @purity pure */
    const toText = (o) => {
      let base = 0;
      for (let k = 0; k < pieces.length; k++) {
        if (o <= base + pieces[k].length) return newStarts[k] + (o - base);
        base += pieces[k].length + 1;
      }
      return out.length;
    };
    return { text: out, selStart: toText(selFrom), selEnd: toText(selTo) };
  }

  /**
   * Remove the line end spaces of the lines in group when that changes
   * neither the line breaks nor what the tokens hold (INV-71 (6)); when it
   * does, try each half on its own (down to single lines), while the
   * number of lexings is under STRIP_MAX_LEXES.
   * @purity pure
   * @param {{text: string, shape: object}} state - updated in place (the caller's working value)
   */
  static _stripGroup(state, group, lexFull, walkTokens) {
    if (group.length === 0 || state.lexes >= STRIP_MAX_LEXES) return;
    state.lexes++;
    const lines = state.text.split("\n");
    for (const n of group) lines[n] = lines[n].replace(/ +$/, "");
    const next = lines.join("\n");
    const shape = MarkdownTextOps._tokenShape(lexFull(next), walkTokens);
    // the kind of each break counts too: a backslash before the spaces must not become a backslash break
    const same =
      shape.breaks === state.shape.breaks && shape.spaceBreaks === state.shape.spaceBreaks && shape.signature === state.shape.signature;
    if (same) {
      state.text = next;
      state.shape = shape;
      return;
    }
    if (group.length === 1) return;
    const half = Math.ceil(group.length / 2);
    MarkdownTextOps._stripGroup(state, group.slice(0, half), lexFull, walkTokens);
    MarkdownTextOps._stripGroup(state, group.slice(half), lexFull, walkTokens);
  }

  /**
   * The line breaks and what the tokens hold, for INV-71 (6).
   * @purity pure
   * @returns {{breaks: number, spaceBreaks: number, signature: string}}
   */
  static _tokenShape(tokens, walkTokens) {
    let breaks = 0;
    let spaceBreaks = 0;
    const entries = [];
    /** @purity pure */
    walkTokens(tokens, (token) => {
      if (token.type === "br") {
        breaks++;
        if (token.raw.startsWith(" ")) spaceBreaks++;
      }
      if (token.type === "text" || token.type === "space") return;
      const entry = [token.type];
      for (const [key, value] of Object.entries(token)) {
        if (key === "raw" || key === "type" || key === "tokens") continue;
        if (key === "text" && Array.isArray(token.tokens)) continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") entry.push(key, value);
      }
      entries.push(entry);
    });
    return { breaks, spaceBreaks, signature: JSON.stringify(entries) };
  }
}
