// ========================================
// Indentation of a code text (no DOM, no CONFIG)
// ========================================
//
// The indent unit of a file, Tab / Shift+Tab over the selected lines, and
// the indent that Enter carries to the new line (NE-5).

const INDENT_SIZES = [2, 4, 8];

/**
 * The length of the run of spaces and tabs at offset.
 * @purity pure
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
function blankRunLength(text, offset) {
  let i = offset;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
  return i - offset;
}

/**
 * The indent unit of a text: "\t" when more indented lines start with a tab
 * than with a space; otherwise the most common positive increase of leading
 * spaces from a non-blank line to the next non-blank line, among 2, 4 and 8
 * (a tie: the smaller). fallback when no indented line gives one.
 * @purity pure
 * @param {string} text - LF text
 * @param {string} [fallback]
 * @returns {string}
 */
export function inferIndentUnit(text, fallback = "    ") {
  const lines = text.split("\n");
  let tabLines = 0;
  let spaceLines = 0;
  const increases = new Map(INDENT_SIZES.map((n) => [n, 0]));
  let previous = -1; // leading spaces of the previous non-blank space-indented (or flat) line
  for (const line of lines) {
    const run = blankRunLength(line, 0);
    if (run === line.length) continue; // blank
    if (line[0] === "\t") {
      tabLines++;
      previous = -1;
      continue;
    }
    if (run > 0) spaceLines++;
    const spaces = line[run - 1] === "\t" ? -1 : run; // a mix of spaces then a tab: not counted
    if (previous >= 0 && spaces > previous && increases.has(spaces - previous)) {
      increases.set(spaces - previous, increases.get(spaces - previous) + 1);
    }
    previous = spaces;
  }
  if (tabLines > spaceLines) return "\t";
  let best = 0;
  for (const n of INDENT_SIZES) if (increases.get(n) > (best ? increases.get(best) : 0)) best = n;
  return best ? " ".repeat(best) : fallback;
}

/**
 * The offset where the line holding offset starts.
 * @purity pure
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
function lineStartOf(text, offset) {
  return offset > 0 ? text.lastIndexOf("\n", offset - 1) + 1 : 0;
}

/**
 * The start offsets of the lines touched by [start, end): the line of
 * start through the line of end. A selection that ends at the start of a
 * line (after a line break) does not touch that line; a caret touches its
 * own line.
 * @purity pure
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {number[]}
 */
function touchedLineStarts(text, start, end) {
  const last = end > start && end > 0 && text[end - 1] === "\n" ? end - 1 : end;
  const starts = [lineStartOf(text, start)];
  let i = text.indexOf("\n", starts[0]);
  while (i >= 0 && i < last) {
    starts.push(i + 1);
    i = text.indexOf("\n", i + 1);
  }
  return starts;
}

/**
 * Apply edits at line starts and map the selection through them. Each edit
 * removes `remove` chars at `at` and puts `insert` there. A position in a
 * removed part goes to its start; a position at an insert moves with the
 * text after it. When the selection spans lines, start goes to firstLine.
 * @purity pure
 * @param {string} text
 * @param {{at: number, remove: number, insert: string}[]} edits - in text order
 * @param {number} start
 * @param {number} end
 * @param {number|null} firstLine - the first line's start when the selection spans lines, else null
 * @returns {{text: string, start: number, end: number}}
 */
function applyLineEdits(text, edits, start, end, firstLine) {
  const parts = [];
  let from = 0;
  for (const e of edits) {
    parts.push(text.slice(from, e.at), e.insert);
    from = e.at + e.remove;
  }
  parts.push(text.slice(from));
  /** @purity pure */
  const map = (pos) => {
    let delta = 0;
    for (const e of edits) {
      if (pos < e.at) break;
      if (pos < e.at + e.remove) return e.at + delta;
      delta += e.insert.length - e.remove;
    }
    return pos + delta;
  };
  return {
    text: parts.join(""),
    start: firstLine === null ? map(start) : firstLine,
    end: map(end),
  };
}

/**
 * Indent the lines touched by [start, end) by one unit (Tab, NE-5). When
 * the range spans lines, empty lines stay empty. The selection stays over
 * the same lines: it starts at the first line's start when it spanned
 * lines; a caret moves with its text.
 * @purity pure
 * @param {string} text - LF text
 * @param {number} start
 * @param {number} end
 * @param {string} unit - e.g. "\t" or "    "
 * @returns {{text: string, start: number, end: number}}
 */
export function indentLines(text, start, end, unit) {
  const starts = touchedLineStarts(text, start, end);
  const spansLines = starts.length > 1;
  const edits = starts
    .filter((at) => !spansLines || (at < text.length && text[at] !== "\n"))
    .map((at) => ({ at, remove: 0, insert: unit }));
  return applyLineEdits(text, edits, start, end, spansLines ? starts[0] : null);
}

/**
 * Outdent the lines touched by [start, end) (Shift+Tab, NE-5): each loses
 * one unit, or else one leading tab, or else up to unit.length leading
 * spaces. The selection is kept as indentLines does.
 * @purity pure
 * @param {string} text - LF text
 * @param {number} start
 * @param {number} end
 * @param {string} unit
 * @returns {{text: string, start: number, end: number}}
 */
export function outdentLines(text, start, end, unit) {
  const starts = touchedLineStarts(text, start, end);
  const edits = [];
  for (const at of starts) {
    let remove = 0;
    if (unit.length > 0 && text.startsWith(unit, at)) remove = unit.length;
    else if (text[at] === "\t") remove = 1;
    else while (remove < unit.length && text[at + remove] === " ") remove++;
    if (remove > 0) edits.push({ at, remove, insert: "" });
  }
  return applyLineEdits(text, edits, start, end, starts.length > 1 ? starts[0] : null);
}

/**
 * The leading white space of the line holding offset, up to offset (Enter
 * carries it to the new line, NE-5).
 * @purity pure
 * @param {string} text - LF text
 * @param {number} offset
 * @returns {string}
 */
export function leadingIndentAt(text, offset) {
  const lineStart = lineStartOf(text, offset);
  const run = blankRunLength(text, lineStart);
  return text.slice(lineStart, Math.min(lineStart + run, Math.max(offset, lineStart)));
}
