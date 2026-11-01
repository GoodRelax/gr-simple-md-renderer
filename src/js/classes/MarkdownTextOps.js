import InlineRuns from "./InlineRuns.js";
import { trailingRunLength, trimTrailingRun } from "../textTransforms.js";

// Leaf blocks whose text is inline Markdown (the inline ranges, INV-67 (6)).
const INLINE_LEAVES = new Set(["paragraph", "text", "heading", "table"]);
// Paragraph text (a top-level paragraph, a list item, a paragraph in a quote).
const PARAGRAPH_LEAVES = new Set(["paragraph", "text"]);
// Leaves whose line end spaces may be removed on commit (INV-71 (6)); in
// code, HTML or math the spaces are content and are never tried.
const STRIPPABLE_LEAVES = new Set(["paragraph", "text", "heading", "table"]);
const QUOTE_MARKS = /^[ \t]*(?:>[ \t]*)+/;
// Runs at the end of a text are counted from the end (trailingRunLength):
// a pattern like /[ \t]+$/ is quadratic in a long run that is not at the end.
const BLANKS = " \t";
const COLOR_OPEN = /^<span style="color: (#[0-9A-Fa-f]{6})">$/;
const SPAN_OPEN = /^<span(?:\s[^>]*)?>$/i;
const SPAN_CLOSE = /^<\/span\s*>$/i;
// INV-52: Insert table / Mermaid / math boxes refuse in an editor opened on these
// blocks, or with the caret in such a block of the editor text at any depth
// (top level, a list item, a quote; a table there too: owner ruling D7).
const REFUSING_BLOCKS = new Set(["code", "html", "blockKatex", "table"]);
// Blocks whose line end spaces are content: a cut never takes them away
// (INV-52, as INV-71 (6) never tries them).
const SPACE_CONTENT_BLOCKS = new Set(["code", "html", "blockKatex"]);
// Inline spans an insert never cuts in two (INV-52, strict review M1): a
// cut through one would show its marks as text or lose its look.
const UNCUT_INLINE = new Set(["strong", "em", "del", "link", "image", "codespan", "inlineKatex"]);
// Leaves whose inline spans are checked at a cut (paragraph text).
const CUT_LEAVES = new Set(["paragraph", "text"]);
const INLINE_TAG = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)\b[^>]*?(\/?)>$/;
// The blocks that may be cut in two by an insert (INV-52).
const CUT_BLOCKS = new Set(["paragraph", "list", "blockquote"]);
// INV-71 (6) lexes a block at most this many times (INV-51: about 300 ms
// on a 1,000-line block); the candidates not decided by then stay as they
// are (what is shown does not change).
const STRIP_MAX_LEXES = 8;
// What may follow the closing "$" of inline math (marked-katex-extension's
// inline rule without nonStandard; the palette's inline math, INV-52).
const MATH_CLOSE_FOLLOW = /^[\s?!.,:\uff1f\uff01\u3002\uff0c\uff1a]/;

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
 * A token of type with this raw is in tokens, at any depth.
 * @purity pure
 * @returns {boolean}
 */
function hasToken(tokens, type, raw) {
  return tokens.some((t) => (t.type === type && t.raw === raw) || (Array.isArray(t.tokens) && hasToken(t.tokens, type, raw)));
}

/**
 * An ATX heading's text without its closing sequence: the #s at the end
 * with the spaces and tabs around them, when the #s start the text or
 * follow a space or tab (as /(?:^|[ \t]+)#+[ \t]*$/, counted from the end).
 * The text as it is when there is none.
 * @purity pure
 * @param {string} text
 * @returns {string}
 */
function withoutClosingHashes(text) {
  const body = trimTrailingRun(text, BLANKS);
  const before = trimTrailingRun(body, "#");
  if (before.length === body.length) return text;
  const kept = trimTrailingRun(before, BLANKS);
  return before === "" || kept.length < before.length ? kept : text;
}

// The leaf table of a text (_leafTable), kept by the identity of its block
// tokens: a lexer that keeps its tokens per text (the block editor's, INV-51)
// finds it again when the button states ask every frame. Only read; the
// result is the same as working it out again.
const LEAF_TABLES = new WeakMap();

/**
 * Markdown text edits on the block editor's string (spec 5.14.5, INV-52,
 * INV-67, INV-71). Pure: no DOM, no CONFIG (templates, colors and lexers
 * come in as arguments); the only state is LEAF_TABLES, a cache that does
 * not change any result.
 * Every operation returns a TextEdit { text, selStart, selEnd } (or null
 * when it does not apply); planBlockInsert() returns where an insert goes
 * (INV-52), insertOffset() that place as an offset, and
 * cutLineEndBreak() how many characters of a line break go before it.
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
   * At the end of a text that ends with a newline, the block ends with one
   * too (the file keeps its last newline; UI fixes review L1). The caret
   * ends at the end of the inserted block (Q6 c).
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
    if (after === "") trail = before.endsWith("\n") ? "\n" : "";
    else if (after.startsWith("\n\n")) trail = "";
    else if (after.startsWith("\n")) trail = "\n";
    const end = before.length + lead.length + blockText.length;
    return { text: before + lead + blockText + trail + after, selStart: end, selEnd: end };
  }

  /**
   * Where Insert table / Mermaid / math boxes go in an open block editor (INV-52): the
   * text is cut at a line boundary, after the caret line (before it when
   * the caret is at the start of the line); a side that would be blank is
   * not made ("above" / "below"). Only a paragraph, a list or a quote is
   * cut; a list at the boundary of the top-level item at the caret (after
   * it; before it when the caret is at the start of its first line. Owner
   * ruling D6); another block at the caret is not cut: the block goes above
   * it when the caret is at its start, else below it. "refuse": the editor
   * is a code, math, HTML or table block, or the caret line is in one at
   * any depth. Lines are counted, not offsets: marked strips a list's
   * indent and a quote's marks before it lexes their inside, but keeps the
   * lines. When the tokens do not hold all the lines (marked drops a
   * duplicate definition's title line), the lines cannot be counted: below
   * (owner ruling D8). A cut through an inline span of a paragraph (bold,
   * italic, strikethrough, a link, an image, a code span, inline math, an
   * inline HTML tag closed after the cut, or HTML whose own text runs over
   * the cut, such as a comment) is not made: the block goes below that
   * paragraph (in a quote, below that paragraph of the quote. Strict review
   * M1, re-check N3); the paragraph is lexed inline once. A paragraph of
   * more than maxInlineChars characters is not lexed inline (as the huge
   * blocks of INV-71): it is cut by line (re-check N2).
   * @purity pure
   * @param {string} text - the editor text
   * @param {number} caret - the selection end
   * @param {string|null} blockType - the block the editor was opened on
   * @param {{lexBlocks: (src: string) => object[], lexInline: (src: string) => object[], maxInlineChars?: number}} lexers
   * @returns {{kind: "refuse"}|{kind: "above"|"below"|"split", line: number}}
   */
  static planBlockInsert(text, caret, blockType, { lexBlocks, lexInline, maxInlineChars = Infinity }) {
    if (REFUSING_BLOCKS.has(blockType)) return { kind: "refuse" };
    const lines = text.split("\n");
    if (text.trim() === "") return { kind: "above", line: 0 };
    const o = MarkdownTextOps._clamp(caret, text);
    const caretLine = MarkdownTextOps._lineIndexAt(text, o);
    const atLineStart = o === MarkdownTextOps._lineStart(lines, caretLine);
    const tokens = lexBlocks(text);
    if (countNewlines(rawOf(tokens)) !== countNewlines(text.replace(/\r\n?/g, "\n"))) return { kind: "below", line: lines.length };
    const found = MarkdownTextOps._blockAtLine(tokens, caretLine);
    if (found.refuse) return { kind: "refuse" };
    let line = atLineStart ? caretLine : caretLine + 1;
    const top = found.top;
    if (top && top.token.type === "list") {
      const item = MarkdownTextOps._listItemAtLine(top.token, top.first, caretLine);
      if (item) line = atLineStart && caretLine === item.first ? item.first : item.last + 1;
    } else if (top && !CUT_BLOCKS.has(top.token.type)) {
      line = atLineStart && caretLine === top.first ? top.first : top.last + 1;
    } else if (top) {
      const leaf = MarkdownTextOps._leafAcrossCut([top.token], top.first, line);
      const small = leaf && leaf.token.text.length <= maxInlineChars;
      if (small && MarkdownTextOps._isSpanCut(lexInline(leaf.token.text), line - leaf.first)) line = leaf.last + 1;
    }
    if (lines.slice(0, line).join("\n").trim() === "") return { kind: "above", line: 0 };
    if (lines.slice(line).join("\n").trim() === "") return { kind: "below", line: lines.length };
    return { kind: "split", line };
  }

  /**
   * The offset in a committed block text where a planBlockInsert() plan
   * puts the block. The committed text has the editor's lines (INV-61 and
   * INV-71 (6) change no line count); its trailing newlines are not in the
   * block (replaceBlock), so "below" is the end of its last text. A cut is
   * at the end of the line before it (its line end spaces can go then:
   * cutLineEndBreak).
   * @purity pure
   * @param {string} text - the committed text
   * @param {{kind: string, line: number}} plan
   * @returns {number}
   */
  static insertOffset(text, plan) {
    const editable = trimTrailingRun(text, "\n");
    if (plan.kind === "above") return 0;
    if (plan.kind === "below") return editable.length;
    return Math.min(MarkdownTextOps._lineStart(text.split("\n"), plan.line) - 1, editable.length);
  }

  /**
   * How many characters at the end of the line before a cut stop making a
   * line break once the block is cut there (INV-71 (6), INV-52): two spaces
   * or more, or else a backslash (an odd run of them: an even run is
   * escaped backslashes, text; strict review L1). At the end of the text
   * before the cut neither makes a line break, so it goes, unless that
   * line is in code, HTML or math (at any depth), where it is content. The
   * backslash goes only when it was a line break: the lines on both sides
   * of the cut are in one paragraph (at the end of a block, such as a list
   * item, a paragraph before a blank line or a heading, it is shown as
   * text and stays. Re-check N1). Only that last line is judged (an
   * earlier line may keep meaningless spaces of its own: an editor closed
   * unchanged is not stripped), with one block lexing of the whole text (a
   * block cut short would not read as its kind; no inline lexing, INV-51).
   * 0 when nothing goes.
   * @purity pure
   * @param {string} text - the committed text
   * @param {{kind: string, line: number}} plan
   * @param {(src: string) => object[]} lexBlocks
   * @returns {number}
   */
  static cutLineEndBreak(text, plan, lexBlocks) {
    if (plan.kind !== "split") return 0;
    const upper = text.slice(0, MarkdownTextOps.insertOffset(text, plan));
    let count = MarkdownTextOps.lineBreakSpaceCount(upper);
    let isBackslash = false;
    if (count === 0 && trailingRunLength(upper, "\\") % 2 === 1) [count, isBackslash] = [1, true];
    if (count === 0) return 0;
    const tokens = lexBlocks(text);
    if (MarkdownTextOps._blockAtLine(tokens, countNewlines(upper), SPACE_CONTENT_BLOCKS).refuse) return 0;
    if (isBackslash && !MarkdownTextOps._leafAcrossCut(tokens, 0, plan.line)) return 0;
    return count;
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
   * Bold / Italic / text color / a link on the selection (INV-66, INV-67
   * (6)(7), INV-69). The inline range that holds the selection is lexed;
   * only its top-level tokens the selection touches (and a formatted token
   * right next to them) are written again (InlineRuns); the rest of the
   * text is not changed. The rewrite is lexed again and must show what was
   * meant (INV-67 (8)). null when it does not apply (no inline range,
   * nothing selected, nothing would change; with op.strictEnds, the Ctrl+V
   * link, an end inside a code span, an inline HTML tag or a link
   * destination or label).
   * @purity pure
   * @param {string} text
   * @param {number} selStart
   * @param {number} selEnd
   * @param {{kind: "strong"|"em"|"color"|"link"|"unlink", value?: string|null, link?: object, url?: string, strictEnds?: boolean}} op
   * @param {{lexBlocks: Function, lexInline: Function, colors?: string[]}} context
   * @returns {{text: string, selStart: number, selEnd: number}|null}
   */
  static formatRange(text, selStart, selEnd, op, context) {
    const lexed = MarkdownTextOps._lexedRange(text, selStart, selEnd, context, false);
    if (!lexed) return null;
    const { range, segments, tokens, runs } = lexed;
    const s = MarkdownTextOps._toInline(segments, range.s);
    const e = MarkdownTextOps._toInline(segments, range.e);
    if (op.strictEnds && (MarkdownTextOps._cutsLinkSyntax(tokens, 0, s) || MarkdownTextOps._cutsLinkSyntax(tokens, 0, e))) return null;
    const touched = InlineRuns.unitRangeOfSource(runs, s, e);
    if (!touched) return null;
    return MarkdownTextOps._rewritePicked(text, lexed, InlineRuns.expandRange(runs, touched.from, touched.to), op, context);
  }

  /**
   * INV-69 (b): a new link at the caret, with label as its text (escaped,
   * INV-72 (d); in a table row the destination's pipes are \|); the label
   * is selected. Owner ruling F-R1: only with the caret in the text of one
   * inline range (not on the marks of a line), and not inside a code span,
   * an inline HTML tag, a link, an image, inline math, an entity, an
   * escape or the markers of emphasis. Only the tokens at the caret are
   * written again; the result is lexed again and must read as meant
   * (INV-67 (8)). null when it does not apply.
   * @purity pure
   * @param {string} text
   * @param {number} caret
   * @param {string} label
   * @param {object} link - InlineRuns.inlineLink
   * @param {{lexBlocks: Function, lexInline: Function, colors?: string[]}} context
   * @returns {{text: string, selStart: number, selEnd: number}|null}
   */
  static insertLink(text, caret, label, link, context) {
    const c = MarkdownTextOps._clamp(caret, text);
    const place = MarkdownTextOps._inlineInsertPlace(text, c, context);
    if (!place) return null;
    if (!place.lexed) return MarkdownTextOps._insertLinkOnBlankLine(text, c, label, link, context);
    const { lexed, offset: o } = place;
    const { segments, inline, tokens, runs, colors } = lexed;
    // the top-level tokens at the caret (a palette color span with its content is one group)
    const groupStart = MarkdownTextOps._tokenGroups(tokens, colors);
    let ta = -1;
    let tb = -1;
    let pos = 0;
    for (let k = 0; k < tokens.length; k++) {
      const from = pos;
      pos += tokens[k].raw.length;
      if (from > o || pos < o) continue;
      if (ta < 0) ta = groupStart[k];
      tb = k;
    }
    while (tb >= 0 && tb + 1 < tokens.length && groupStart[tb + 1] === groupStart[tb]) tb++;
    const srcFrom = ta < 0 ? o : rawOf(tokens.slice(0, ta)).length;
    const srcTo = ta < 0 ? o : srcFrom + rawOf(tokens.slice(ta, tb + 1)).length;
    let rf = 0;
    while (rf < runs.length && (ta < 0 ? runs[rf].srcFrom < o : runs[rf].top < ta)) rf++;
    let rt = rf;
    while (ta >= 0 && rt < runs.length && runs[rt].top <= tb) rt++;
    let index = rf;
    while (index < rt && runs[index].srcFrom < o) index++;
    const options = { before: inline.slice(0, srcFrom), after: inline.slice(srcTo), inTableCell: lexed.range.inTableCell };
    const result = InlineRuns.insertLinkAt(runs.slice(rf, rt), index - rf, label, link, options);
    if (!result) return null;
    const layout = InlineRuns.layout(result.runs, options);
    const next = inline.slice(0, srcFrom) + layout.text + inline.slice(srcTo);
    const work = { runs, colors, lexInline: context.lexInline };
    const local = Boolean(context.localCheck);
    if (!MarkdownTextOps._readsAsMeant(local ? layout.text : next, local ? result.runs : null, work, { from: rf, to: rt }, result.runs)) return null;
    const first = index - rf;
    const last = first + Array.from(label).length - 1;
    return MarkdownTextOps._writeInline(text, segments, next, srcFrom + layout.unitFrom[first], srcFrom + layout.unitTo[last]);
  }

  /**
   * Where an inline piece (a link, inline math) can go in at the caret c
   * (owner ruling F-R1): {lexed, offset} with c in the text of one inline
   * range (offset: c in its own text), not on the marks of a line, not
   * outside a table row's pipes, and not inside a code span, an inline HTML
   * tag, a link, an image, inline math, an entity, an escape or the markers
   * of emphasis; {lexed: null} on a line with only spaces that is in no
   * block (an empty editor, or an empty line between blocks), where the
   * piece starts a paragraph (_paragraphOnBlankLine); else null.
   * @purity pure
   * @returns {{lexed: object|null, offset?: number}|null}
   */
  static _inlineInsertPlace(text, c, context) {
    const lexed = MarkdownTextOps._lexedRange(text, c, c, context, true);
    if (!lexed) {
      const lines = text.split("\n");
      const n = MarkdownTextOps._lineIndexAt(text, c);
      if (lines[n].trim() !== "") return null;
      if (text.trim() !== "" && MarkdownTextOps._leafLines(text, context.lexBlocks)?.[n]?.leaf) return null;
      return { lexed: null };
    }
    if (!lexed.segments.some((g) => g.from <= c && c <= g.to)) return null;
    if (lexed.range.inTableCell && MarkdownTextOps._outsideRowPipes(text, c)) return null;
    const offset = MarkdownTextOps._toInline(lexed.segments, c);
    if (MarkdownTextOps._cutsInsertion(lexed.tokens, 0, offset)) return null;
    return { lexed, offset };
  }

  /**
   * paragraph put on the blank line of the caret c (a place of
   * _inlineInsertPlace with no inline range) as a paragraph of its own: the
   * line's spaces go (four would make a code block); a blank line is kept
   * on each side that has a block. {text, at} (at: where paragraph starts),
   * or null when the result does not add just that paragraph.
   * @purity pure
   * @returns {{text: string, at: number}|null}
   */
  static _paragraphOnBlankLine(text, c, paragraph, lexBlocks) {
    const lines = text.split("\n");
    const n = MarkdownTextOps._lineIndexAt(text, c);
    const before = n > 0 && lines[n - 1].trim() !== "" ? "\n" : "";
    const after = n + 1 < lines.length && lines[n + 1].trim() !== "" ? "\n" : "";
    const start = MarkdownTextOps._lineStart(lines, n);
    const next = text.slice(0, start) + before + paragraph + after + text.slice(start + lines[n].length);
    if (!MarkdownTextOps._addsOneParagraph(text, next, paragraph, lexBlocks)) return null;
    return { text: next, at: start + before.length };
  }

  /**
   * insertLink on a blank line in no block: the link starts a paragraph.
   * @purity pure
   * @returns {{text: string, selStart: number, selEnd: number}|null}
   */
  static _insertLinkOnBlankLine(text, c, label, link, context) {
    const result = InlineRuns.insertLinkAt([], 0, label, link);
    if (!result) return null;
    const layout = InlineRuns.layout(result.runs);
    const check = context.lexInline(layout.text);
    if (rawOf(check) !== layout.text) return null;
    if (JSON.stringify(InlineRuns.signature(InlineRuns.fromTokens(check))) !== JSON.stringify(InlineRuns.signature(result.runs))) return null;
    const put = MarkdownTextOps._paragraphOnBlankLine(text, c, layout.text, context.lexBlocks);
    if (!put) return null;
    return { text: put.text, selStart: put.at + layout.unitFrom[0], selEnd: put.at + layout.unitTo[result.runs.length - 1] };
  }

  /**
   * A caret on a table row before its leading pipe or after its trailing
   * one (outside every cell: text there would be a cell too many, or the
   * row's first cell).
   * @purity pure
   * @returns {boolean}
   */
  static _outsideRowPipes(text, c) {
    const lines = text.split("\n");
    const n = MarkdownTextOps._lineIndexAt(text, c);
    const start = MarkdownTextOps._lineStart(lines, n);
    const pipes = MarkdownTextOps._pipePositions(lines[n]);
    if (pipes.length === 0) return false;
    const line = lines[n];
    const lead = line.replace(/^[ \t]*(?:>[ \t]*)*/, "").startsWith("|");
    const trail = line.trimEnd().endsWith("|") && pipes[pipes.length - 1] === line.trimEnd().length - 1;
    return (lead && c <= start + pipes[0]) || (trail && c > start + pipes[pipes.length - 1]);
  }

  /**
   * next has the blocks of text and one more paragraph whose source is
   * paragraph, the others as they were (the blank lines between blocks
   * aside).
   * @purity pure
   * @returns {boolean}
   */
  static _addsOneParagraph(text, next, paragraph, lexBlocks) {
    /** @purity pure */
    const blocks = (src) => lexBlocks(src).filter((t) => t.type !== "space").map((t) => [t.type, t.raw.trimEnd()]);
    const was = blocks(text);
    const now = blocks(next);
    if (now.length !== was.length + 1) return false;
    const k = now.findIndex((b) => b[0] === "paragraph" && b[1] === paragraph);
    if (k < 0) return false;
    return JSON.stringify([...now.slice(0, k), ...now.slice(k + 1)]) === JSON.stringify(was);
  }

  /**
   * 5.15.5 Paste link with no selection: insertLink would put a link at
   * the caret (owner ruling F-R1).
   * @purity pure
   * @param {string} text
   * @param {number} caret
   * @param {{lexBlocks: Function, lexInline: Function, colors?: string[]}} context
   * @returns {boolean}
   */
  static canInsertLink(text, caret, context) {
    return MarkdownTextOps.insertLink(text, caret, "x", InlineRuns.inlineLink("u"), { ...context, localCheck: true }) !== null;
  }

  /**
   * The palette's inline math (INV-52, owner ruling 2026-10-25): math (a
   * "$...$" template) goes in at the caret, where a link could go in (owner
   * ruling F-R1), or as a paragraph of its own on a line with only spaces
   * that is in no block. A space goes before it unless a space or the start
   * of the inline range is there, and after it unless a space, one of
   * ?!.,: (half or full width) or the end is there (marked-katex-extension
   * reads "$...$" as math only so). The inner edges of emphasis count as
   * the start and the end (marked lexes its inside on its own: "**Note
   * $...$**"; review L1). The result is lexed again: the
   * template must be one inline math token and the rest must read as
   * before (INV-67 (8)). The caret ends right after the math. null when it
   * does not apply.
   * @purity pure
   * @param {string} text
   * @param {number} caret
   * @param {string} math
   * @param {{lexBlocks: Function, lexInline: Function, colors?: string[]}} context
   * @returns {{text: string, selStart: number, selEnd: number}|null}
   */
  static insertInlineMath(text, caret, math, context) {
    const c = MarkdownTextOps._clamp(caret, text);
    const place = MarkdownTextOps._inlineInsertPlace(text, c, context);
    if (!place) return null;
    if (!place.lexed) return MarkdownTextOps._insertMathOnBlankLine(text, c, math, context);
    const { segments, inline, tokens, runs, colors } = place.lexed;
    const o = place.offset;
    const before = inline.slice(0, o);
    const after = inline.slice(o);
    const edge = MarkdownTextOps._emphasisEdgeAt(tokens, 0, o);
    const lead = o === 0 || edge.start || before.endsWith(" ") ? "" : " ";
    const trail = after === "" || edge.end || MATH_CLOSE_FOLLOW.test(after[0]) ? "" : " ";
    const at = o + lead.length;
    const next = before + lead + math + trail + after;
    const check = context.lexInline(next);
    if (rawOf(check) !== next || !hasToken(check, "inlineKatex", math)) return null;
    // the inserted runs (spaces and the math atom) aside, the runs read as before
    const added = math.length + lead.length + trail.length;
    const now = InlineRuns.fromTokens(check, { colors });
    const atom = now.filter((r) => r.srcFrom >= o && r.srcFrom < o + added && !(r.type === "text" && r.text === " "));
    if (atom.length !== 1 || atom[0].type !== "atom" || atom[0].src !== math || atom[0].srcFrom !== at) return null;
    const rest = now.filter((r) => r.srcFrom < o || r.srcFrom >= o + added);
    if (JSON.stringify(InlineRuns.signature(rest)) !== JSON.stringify(InlineRuns.signature(runs))) return null;
    return MarkdownTextOps._writeInline(text, segments, next, at + math.length, at + math.length);
  }

  /**
   * The Insert inline math button (5.15.5): the caret is where
   * insertInlineMath could put math. Only the place is checked (one inline
   * lexing, as Paste link: INV-51); the reading of the result is checked
   * when pressed.
   * @purity pure
   * @param {string} text
   * @param {number} caret
   * @param {{lexBlocks: Function, lexInline: Function, colors?: string[]}} context
   * @returns {boolean}
   */
  static canInsertInlineMath(text, caret, context) {
    return MarkdownTextOps._inlineInsertPlace(text, MarkdownTextOps._clamp(caret, text), context) !== null;
  }

  /**
   * insertInlineMath on a blank line in no block: the math is a paragraph
   * of its own. null when it would not read so.
   * @purity pure
   * @returns {{text: string, selStart: number, selEnd: number}|null}
   */
  static _insertMathOnBlankLine(text, c, math, context) {
    const check = context.lexInline(math);
    if (check.length !== 1 || check[0].type !== "inlineKatex" || check[0].raw !== math) return null;
    const put = MarkdownTextOps._paragraphOnBlankLine(text, c, math, context.lexBlocks);
    if (!put) return null;
    const end = put.at + math.length;
    return { text: put.text, selStart: end, selEnd: end };
  }

  /**
   * The offset o (a place of _inlineInsertPlace) is right inside the
   * markers of emphasis (strong, em, del; at any depth): at the start of
   * its inside (start) or at the end (end). marked lexes that inside on its
   * own, so those edges are the start and the end of an inline text there.
   * @purity pure
   * @returns {{start: boolean, end: boolean}}
   */
  static _emphasisEdgeAt(tokens, start, o) {
    let pos = start;
    for (const token of tokens) {
      const from = pos;
      const to = pos + token.raw.length;
      pos = to;
      if (!(from < o && o < to) || !["strong", "em", "del"].includes(token.type)) continue;
      const inner = MarkdownTextOps._innerOf(token);
      if (!inner) continue;
      const deeper = MarkdownTextOps._emphasisEdgeAt(token.tokens, from + inner.from, o);
      return { start: deeper.start || o === from + inner.from, end: deeper.end || o === from + inner.to };
    }
    return { start: false, end: false };
  }

  /**
   * INV-69 Remove link: every link the selection touches, or the link the
   * caret is on (its text, edges included, or anywhere in its source),
   * comes off; its text and other formats stay, written so that marked
   * does not make it an autolink again. null when there is none.
   * @purity pure
   * @param {string} text
   * @param {number} selStart
   * @param {number} selEnd
   * @param {{lexBlocks: Function, lexInline: Function, colors?: string[]}} context
   * @returns {{text: string, selStart: number, selEnd: number}|null}
   */
  static removeLink(text, selStart, selEnd, context) {
    if (selStart !== selEnd) return MarkdownTextOps.formatRange(text, selStart, selEnd, { kind: "unlink" }, context);
    const lexed = MarkdownTextOps._lexedRange(text, selStart, selEnd, context, true);
    const at = lexed && MarkdownTextOps._linkAt(lexed.tokens, 0, MarkdownTextOps._toInline(lexed.segments, lexed.range.s));
    const touched = at && InlineRuns.unitRangeOfSource(lexed.runs, at.from, at.to);
    if (!touched) return null;
    return MarkdownTextOps._rewritePicked(text, lexed, InlineRuns.expandRange(lexed.runs, touched.from, touched.to), { kind: "unlink" }, context);
  }

  /**
   * 5.15.5 Remove link: the selection touches a link, or the caret is on
   * one (as removeLink). Only the inline range is lexed (INV-51).
   * @purity pure
   * @param {string} text
   * @param {number} selStart
   * @param {number} selEnd
   * @param {{lexBlocks: Function, lexInline: Function}} context
   * @returns {boolean}
   */
  static canRemoveLink(text, selStart, selEnd, context) {
    const range = MarkdownTextOps._inlineRangeAt(text, selStart, selEnd, context.lexBlocks, selStart === selEnd);
    if (!range) return false;
    // no link can be written without one of these: no inline lexing then
    if (!range.segments.some((g) => /[[<:@]|www\./i.test(text.slice(g.from, g.to)))) return false;
    return MarkdownTextOps.removeLink(text, selStart, selEnd, { ...context, localCheck: true }) !== null;
  }

  /**
   * INV-67 (8): source lexed again reads as the runs meant. Whole: source is
   * the whole inline range written again, checked against its runs with
   * the rewritten ones (rewritten) in place of [region.from, region.to).
   * Local (only the runs given, for a button state per frame, INV-51):
   * source is the rewritten part alone, checked against those runs.
   * @purity pure
   * @returns {boolean}
   */
  static _readsAsMeant(source, localRuns, work, region, rewritten) {
    const check = work.lexInline(source);
    if (rawOf(check) !== source) return false;
    const expected = localRuns ?? [...work.runs.slice(0, region.from), ...rewritten, ...work.runs.slice(region.to)];
    return JSON.stringify(InlineRuns.signature(InlineRuns.fromTokens(check, { colors: work.colors }))) === JSON.stringify(InlineRuns.signature(expected));
  }

  /**
   * A new link's region also takes the top-level token right before it
   * when that ends with a literal "!", "*", "_" or "~" (they are escaped
   * there; InlineRuns._escapeBeforeLink): written as they are, a "!" would
   * make the link an image and the others could close emphasis.
   * @purity pure
   * @returns {{from: number, to: number, srcFrom: number, srcTo: number}}
   */
  static _widenBeforeLink(tokens, runs, region, colors) {
    const prev = runs[region.from - 1];
    if (!prev || prev.type !== "text" || prev.src !== prev.text || !["!", "*", "_", "~"].includes(prev.text)) return region;
    const ta = MarkdownTextOps._tokenGroups(tokens, colors)[prev.top];
    let from = region.from;
    while (from > 0 && runs[from - 1].top >= ta) from--;
    return { from, to: region.to, srcFrom: rawOf(tokens.slice(0, ta)).length, srcTo: region.srcTo };
  }

  /**
   * Taking a link off: the region also takes the text tokens right before
   * and after it (the text of the link and its neighbours could make an
   * autolink together: "[www](u).example"; InlineRuns escapes them).
   * @purity pure
   * @returns {{from: number, to: number, srcFrom: number, srcTo: number}}
   */
  static _widenAroundUnlink(tokens, runs, region, colors) {
    const groupStart = MarkdownTextOps._tokenGroups(tokens, colors);
    let { from, to, srcFrom, srcTo } = region;
    const before = runs[from - 1];
    if (before?.type === "text" && !before.marks.link) {
      const ta = groupStart[before.top];
      while (from > 0 && runs[from - 1].top >= ta) from--;
      srcFrom = rawOf(tokens.slice(0, ta)).length;
    }
    const after = runs[to];
    if (after?.type === "text" && !after.marks.link) {
      let tb = after.top;
      while (tb + 1 < tokens.length && groupStart[tb + 1] === groupStart[after.top]) tb++;
      while (to < runs.length && runs[to].top <= tb) to++;
      srcTo = rawOf(tokens.slice(0, tb + 1)).length;
    }
    return { from, to, srcFrom, srcTo };
  }

  /**
   * The inline range of a selection (or of a caret, with allowEmpty)
   * lexed: {range, segments, inline, tokens, runs, colors}, or null.
   * @purity pure
   */
  static _lexedRange(text, selStart, selEnd, context, allowEmpty) {
    const range = MarkdownTextOps._inlineRangeAt(text, selStart, selEnd, context.lexBlocks, allowEmpty);
    if (!range) return null;
    const { segments } = range;
    const inline = segments.map((g) => text.slice(g.from, g.to)).join("\n");
    const tokens = context.lexInline(inline);
    if (rawOf(tokens) !== inline) return null;
    const colors = context.colors ?? [];
    return { range, segments, inline, tokens, runs: InlineRuns.fromTokens(tokens, { colors }), colors };
  }

  /**
   * formatRange on the picked runs of a lexed range.
   * @purity pure
   * @returns {{text: string, selStart: number, selEnd: number}|null}
   */
  static _rewritePicked(text, lexed, picked, op, context) {
    const { range, segments, inline, tokens, runs, colors } = lexed;
    const work = { text, segments, inline, runs, picked, op, colors, inTableCell: range.inTableCell, lexInline: context.lexInline, localCheck: Boolean(context.localCheck) };
    // First without a neighbour the format does not merge with (its
    // notation stays, INV-67 (7)); when that cannot be written so that
    // marked reads it as meant, with the neighbours that have the format.
    let strict = MarkdownTextOps._regionOf(tokens, runs, picked, colors, op, false);
    if (op.kind === "link") strict = MarkdownTextOps._widenBeforeLink(tokens, runs, strict, colors);
    if (op.kind === "unlink") strict = MarkdownTextOps._widenAroundUnlink(tokens, runs, strict, colors);
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
    if (!MarkdownTextOps._readsAsMeant(work.localCheck ? layout.text : next, work.localCheck ? result.runs : null, work, region, result.runs)) return null;
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
    const table = MarkdownTextOps._leafTable(text, lexers.lexBlocks);
    if (!table) return null;
    const { info } = table;
    const n = MarkdownTextOps._lineAt(table.starts, s);
    const lineStart = table.starts[n];
    const before = text.slice(lineStart, s);
    /** @purity pure */
    const isParagraph = (k) => k >= 0 && PARAGRAPH_LEAVES.has(info[k]?.leaf?.type);
    // The selection's end must be in the same paragraph as its start.
    const ne = MarkdownTextOps._lineAt(table.starts, e);
    /** @purity pure */
    const inLeaf = (leaf) => ne === n || info[ne]?.leaf === leaf;
    if (!/^[ \t]*(?:>[ \t]*)*$/.test(before)) {
      if (!isParagraph(n)) return null;
      // in or right after the list marks of the line: not paragraph text
      if (s <= lineStart + info[n].prefix || !inLeaf(info[n].leaf)) return null;
      if (MarkdownTextOps._cutsInlineSyntax(text, table, n, [s, e], lexers.lexInline)) return null;
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
    if (isParagraph(n) && MarkdownTextOps._cutsInlineSyntax(text, table, n, [s, e], lexers.lexInline)) return null;
    const inQuote = Boolean(here?.quote || info[n - 1]?.quote);
    let head = text.slice(0, s);
    if (isParagraph(n - 1)) {
      const prevEnd = lineStart - 1;
      const prevStart = text.lastIndexOf("\n", prevEnd - 1) + 1;
      const mark = MarkdownTextOps.lineBreakSpaceCount(text.slice(prevStart, prevEnd));
      if (mark > 0) head = text.slice(0, prevEnd - mark) + text.slice(prevEnd, s);
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
    for (let n = 0; n < lines.length; n++) if (MarkdownTextOps.lineBreakSpaceCount(lines[n]) > 0) candidates.push(n);
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
   * The spaces of a line break mark at the end of text (INV-71, INV-70):
   * their number when there are two or more, else 0. Counted from the end
   * (trailingRunLength), so linear in a long run of spaces.
   * @purity pure
   * @param {string} text - one line
   * @returns {number}
   */
  static lineBreakSpaceCount(text) {
    const n = trailingRunLength(text, " ");
    return n >= 2 ? n : 0;
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
    const lines = text.split("\n");
    const ends = lines.map((line) => MarkdownTextOps.lineBreakSpaceCount(line) > 0);
    if (!ends.includes(true)) return ends; // nothing to mark: no lexing
    const info = MarkdownTextOps._leafLines(text, lexBlocks);
    return ends.map((end, n) => end && PARAGRAPH_LEAVES.has(info?.[n]?.leaf?.type));
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
   * The top-level block token on a line of the lexed text, with its first
   * and last line, and whether the line refuses an insert (INV-52): the
   * token is one of types (REFUSING_BLOCKS by default), or the line is in
   * one of them nested inside it. top is null on a blank line between
   * blocks.
   * @purity pure
   * @param {object[]} tokens - lexBlocks output
   * @param {number} line
   * @param {Set<string>} [types]
   * @returns {{refuse: boolean, top: {token: object, first: number, last: number}|null}}
   */
  static _blockAtLine(tokens, line, types = REFUSING_BLOCKS) {
    let start = 0;
    for (const token of tokens) {
      const last = start + countNewlines(trimTrailingRun(token.raw, "\n"));
      if (token.type !== "space" && line >= start && line <= last) {
        const refuse = types.has(token.type) || MarkdownTextOps._refusesInside(token, start, line, types);
        return { refuse, top: { token, first: start, last } };
      }
      start += countNewlines(token.raw);
    }
    return { refuse: false, top: null };
  }

  /**
   * The paragraph leaf (at the top or in a quote, at any depth) whose lines
   * hold both sides of a cut before line cut, with its first and last
   * line; null when the cut is not inside one (INV-52, strict review M1).
   * @purity pure
   * @param {object[]} tokens
   * @param {number} start - the line the tokens start on
   * @param {number} cut
   * @returns {{token: object, first: number, last: number}|null}
   */
  static _leafAcrossCut(tokens, start, cut) {
    let pos = start;
    for (const token of tokens) {
      const last = pos + countNewlines(trimTrailingRun(token.raw, "\n"));
      if (token.type !== "space" && pos < cut && last >= cut) {
        if (CUT_LEAVES.has(token.type)) return { token, first: pos, last };
        if (token.type === "blockquote") return MarkdownTextOps._leafAcrossCut(token.tokens || [], pos, cut);
        return null;
      }
      pos += countNewlines(token.raw);
    }
    return null;
  }

  /**
   * An inline span of the lexed paragraph text runs across the start of
   * line cut (counted in the text): an UNCUT_INLINE token, an html token
   * whose own text runs across it (a comment, a tag with a line break), or
   * an inline HTML tag opened before it and closed on it or after (INV-52).
   * @purity pure
   * @param {object[]} tokens - inline tokens of the paragraph text
   * @param {number} cut
   * @returns {boolean}
   */
  static _isSpanCut(tokens, cut) {
    let line = 0;
    const open = [];
    for (const token of tokens) {
      const last = line + countNewlines(token.raw);
      if ((UNCUT_INLINE.has(token.type) || token.type === "html") && line < cut && last >= cut) return true;
      const tag = token.type === "html" ? INLINE_TAG.exec(token.raw) : null;
      if (tag && !tag[3]) {
        const name = tag[2].toLowerCase();
        if (!tag[1]) open.push({ name, line });
        else {
          const at = open.map((o) => o.name).lastIndexOf(name);
          if (at >= 0) {
            if (open[at].line < cut && line >= cut) return true;
            open.splice(at);
          }
        }
      }
      line = last;
    }
    return false;
  }

  /**
   * The first and last text line of the item of a list token (starting on
   * line start) whose lines hold line; null on none (INV-52, owner ruling
   * D6). The blank lines after an item's text belong to it.
   * @purity pure
   * @param {object} list
   * @param {number} start
   * @param {number} line
   * @returns {{first: number, last: number}|null}
   */
  static _listItemAtLine(list, start, line) {
    let first = start;
    for (const item of list.items) {
      const next = first + countNewlines(item.raw);
      if (line >= first && (line < next || item === list.items[list.items.length - 1])) {
        return { first, last: first + countNewlines(trimTrailingRun(item.raw, "\n")) };
      }
      first = next;
    }
    return null;
  }

  /**
   * The line is in a block of types (code, math, HTML, a table) inside a
   * list or a quote token that starts on line start (at any depth). A list
   * item's tokens and a quote's tokens are lexed from their text without
   * the indent or the marks, line for line (INV-52).
   * @purity pure
   * @param {object} token
   * @param {number} start
   * @param {number} line
   * @param {Set<string>} types
   * @returns {boolean}
   */
  static _refusesInside(token, start, line, types) {
    let children;
    if (token.type === "list") {
      let itemStart = start;
      for (const item of token.items) {
        const itemLast = itemStart + countNewlines(trimTrailingRun(item.raw, "\n"));
        if (line >= itemStart && line <= itemLast) return MarkdownTextOps._refusesIn(item.tokens || [], itemStart, line, types);
        itemStart += countNewlines(item.raw);
      }
      return false;
    }
    if (token.type === "blockquote") children = token.tokens || [];
    return children ? MarkdownTextOps._refusesIn(children, start, line, types) : false;
  }

  /**
   * _refusesInside for a list of tokens starting on line start.
   * @purity pure
   * @param {object[]} tokens
   * @param {number} start
   * @param {number} line
   * @param {Set<string>} types
   * @returns {boolean}
   */
  static _refusesIn(tokens, start, line, types) {
    let pos = start;
    for (const token of tokens) {
      const last = pos + countNewlines(trimTrailingRun(token.raw, "\n"));
      if (token.type !== "space" && line >= pos && line <= last) {
        return types.has(token.type) || MarkdownTextOps._refusesInside(token, pos, line, types);
      }
      pos += countNewlines(token.raw);
    }
    return false;
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
    return MarkdownTextOps._leafTable(text, lexBlocks)?.info ?? null;
  }

  /**
   * _leafLines with the lines of text and where each starts (starts has one
   * more entry: the end), or null when the tokens do not add up to the
   * text. Kept per block tokens (LEAF_TABLES).
   * @purity pure
   * @param {string} text
   * @param {(src: string) => object[]} lexBlocks
   * @returns {{info: Array<object|null>, lines: string[], starts: number[]}|null}
   */
  static _leafTable(text, lexBlocks) {
    const tokens = lexBlocks(text);
    const kept = LEAF_TABLES.get(tokens);
    if (kept && kept.text === text) return kept.table;
    let table = null;
    if (rawOf(tokens) === text) {
      const lines = text.split("\n");
      const starts = [0];
      for (const line of lines) starts.push(starts[starts.length - 1] + line.length + 1);
      const info = new Array(lines.length).fill(null);
      MarkdownTextOps._mapLeaves(tokens, 0, lines, info, { quote: false, list: false });
      table = { info, lines, starts };
    }
    LEAF_TABLES.set(tokens, { text, table });
    return table;
  }

  /**
   * The index of the line that holds offset, from the line starts of
   * _leafTable (halving).
   * @purity pure
   * @param {number[]} starts
   * @param {number} offset - in [0, text length]
   * @returns {number}
   */
  static _lineAt(starts, offset) {
    let lo = 0;
    let hi = starts.length - 2; // the last line
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
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
        const own = trimTrailingRun(token.raw, "\n").split("\n");
        for (let k = 0; k < own.length && line + k < lines.length; k++) {
          const n = line + k;
          const part = own[k];
          // marked may leave the spaces at a line end to a space token, and
          // turns the tabs that indent a line into spaces
          const original = trimTrailingRun(lines[n], BLANKS);
          const shown = trimTrailingRun(part, BLANKS).replace(/^[ \t]+/, "");
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
  static _cutsInlineSyntax(text, table, n, offsets, lexInline) {
    const { info, lines, starts } = table;
    const at = info[n];
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
   * INV-69 (iii) for the Ctrl+V link: the offset o of an inline range is
   * inside a link's destination or label (after the "]" of its text), or
   * inside a piece kept whole: a code span, an inline HTML tag, an image,
   * inline math, an escape, an entity (owner ruling F-R3), at any depth.
   * Inside a link's text or emphasis, the tokens in it are looked at.
   * @purity pure
   * @returns {boolean}
   */
  static _cutsLinkSyntax(tokens, start, o) {
    let pos = start;
    for (const token of tokens) {
      const from = pos;
      const to = pos + token.raw.length;
      pos = to;
      if (!(from < o && o < to)) continue;
      if (token.type === "text") return MarkdownTextOps._cutsTextPart(token.raw, o - from);
      if (!["link", "strong", "em", "del"].includes(token.type)) return true; // kept whole
      const inner = MarkdownTextOps._innerOf(token);
      if (!inner) {
        if (token.type !== "link") return true;
        // a text with \[ \] (InlineRuns.linkOf maps it): after its "]" is the destination
        if (token.raw.startsWith("[")) {
          const link = InlineRuns.linkOf(token);
          return !link || o > from + 1 + link.innerSrc.length;
        }
        return false; // a bare URL or an autolink: its text is characters (the brackets are at its edges)
      }
      if (token.type === "link" && o > from + inner.to) return true;
      // on the markers of emphasis: formatRange takes the emphasis as it is
      if (o < from + inner.from || o > from + inner.to) return false;
      return MarkdownTextOps._cutsLinkSyntax(token.tokens, from + inner.from, o);
    }
    return false;
  }

  /**
   * Owner ruling F-R1 for a new link at the caret: the offset o is inside
   * any token but plain text and the text between the markers of emphasis
   * (a link, a code span, an HTML tag, an image, math, an escape, an entity,
   * or the markers themselves).
   * @purity pure
   * @returns {boolean}
   */
  static _cutsInsertion(tokens, start, o) {
    let pos = start;
    for (const token of tokens) {
      const from = pos;
      const to = pos + token.raw.length;
      pos = to;
      if (!(from < o && o < to)) continue;
      if (token.type === "text") return MarkdownTextOps._cutsTextPart(token.raw, o - from);
      if (!["strong", "em", "del"].includes(token.type)) return true;
      const inner = MarkdownTextOps._innerOf(token);
      if (!inner || o < from + inner.from || o > from + inner.to) return true;
      return MarkdownTextOps._cutsInsertion(token.tokens, from + inner.from, o);
    }
    return false;
  }

  /**
   * The offset k of a text token's source is inside one of its parts (an
   * entity reference kept whole).
   * @purity pure
   */
  static _cutsTextPart(raw, k) {
    let p = 0;
    for (const part of InlineRuns.textParts(raw)) {
      if (p < k && k < p + part.length) return true;
      p += part.length;
    }
    return false;
  }

  /**
   * The source span {from, to} of the link the caret at o is on: inside its
   * source, or on its text's edges; inside emphasis too. null when none.
   * @purity pure
   * @returns {{from: number, to: number}|null}
   */
  static _linkAt(tokens, start, o) {
    let pos = start;
    for (const token of tokens) {
      const from = pos;
      const to = pos + token.raw.length;
      pos = to;
      if (o < from || o > to) continue;
      if (token.type === "link") {
        const link = InlineRuns.linkOf(token);
        const textFrom = from + (link ? link.innerFrom : 0);
        const textTo = link ? textFrom + link.innerSrc.length : to;
        if ((from < o && o < to) || (link && textFrom <= o && o <= textTo)) return { from, to };
        continue;
      }
      const inner = token.type === "link" ? null : MarkdownTextOps._innerOf(token);
      const found = inner ? MarkdownTextOps._linkAt(token.tokens, from + inner.from, o) : null;
      if (found) return found;
    }
    return null;
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
   * selection is empty (unless allowEmpty: a caret) or not in one
   * paragraph, heading or table cell.
   * @purity pure
   */
  static _inlineRangeAt(text, selStart, selEnd, lexBlocks, allowEmpty = false) {
    let s = MarkdownTextOps._clamp(Math.min(selStart, selEnd), text);
    let e = MarkdownTextOps._clamp(Math.max(selStart, selEnd), text);
    if (e > s && text[e - 1] === "\n") e--;
    if (e > s && text[s] === "\n") s++;
    if (allowEmpty ? s > e : s >= e) return null;
    const table = MarkdownTextOps._leafTable(text, lexBlocks);
    if (!table) return null;
    const { info, lines, starts } = table;
    const ls = MarkdownTextOps._lineAt(starts, s);
    const le = MarkdownTextOps._lineAt(starts, e);
    const a = info[ls];
    if (!a?.leaf || info[le]?.leaf !== a.leaf || !INLINE_LEAVES.has(a.leaf.type)) return null;
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
    if (allowEmpty ? s > e : s >= e) return null;
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
    const body = trimTrailingRun(withoutClosingHashes(rest), BLANKS);
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
    const trail = trailingRunLength(cell, BLANKS);
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
      if (op.kind === "link" || op.kind === "unlink") return false; // a link is not merged with its neighbours
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
    for (const n of group) lines[n] = trimTrailingRun(lines[n], " ");
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
