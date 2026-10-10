/**
 * Markdown text edits on the block editor's string (spec 5.14.5, INV-52).
 * Stateless and pure: no DOM, no CONFIG (templates come in as arguments).
 * Every operation returns a TextEdit { text, selStart, selEnd }.
 */
export default class MarkdownTextOps {
  /**
   * Wrap the selection in marker (** bold, * italic), or unwrap it when the
   * markers are right around it or are the ends of the selection.
   * An empty selection changes nothing.
   * @purity pure
   * @param {string} text
   * @param {number} selStart
   * @param {number} selEnd
   * @param {string} marker
   * @returns {{text: string, selStart: number, selEnd: number}}
   */
  static toggleWrap(text, selStart, selEnd, marker) {
    const s = MarkdownTextOps._clamp(Math.min(selStart, selEnd), text);
    const e = MarkdownTextOps._clamp(Math.max(selStart, selEnd), text);
    if (s === e) return { text, selStart: s, selEnd: e };
    const n = marker.length;
    const selected = text.slice(s, e);

    // Markers selected together with the word: "**word**" -> "word".
    if (
      selected.length >= 2 * n &&
      MarkdownTextOps._isWrappedBy(selected, n, selected.length - n, marker)
    ) {
      const inner = selected.slice(n, selected.length - n);
      return { text: text.slice(0, s) + inner + text.slice(e), selStart: s, selEnd: s + inner.length };
    }
    // Markers right around the selection: "**[word]**" -> "word".
    if (MarkdownTextOps._isWrappedBy(text, s, e, marker)) {
      return {
        text: text.slice(0, s - n) + selected + text.slice(e + n),
        selStart: s - n,
        selEnd: e - n,
      };
    }
    return {
      text: text.slice(0, s) + marker + selected + marker + text.slice(e),
      selStart: s + n,
      selEnd: e + n,
    };
  }

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
    const header = MarkdownTextOps._splitRow(lines[0]);
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
    const caretRow = MarkdownTextOps._splitRow(lines[caretLine]);
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
      const row = MarkdownTextOps._splitRow(line);
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
   * True when marker sits right before s and right after e. For "*" the runs
   * of "*" must be odd, so that a bold "**" is not taken as italic.
   * @purity pure
   */
  static _isWrappedBy(text, s, e, marker) {
    const n = marker.length;
    if (s < n || e + n > text.length) return false;
    if (text.slice(s - n, s) !== marker || text.slice(e, e + n) !== marker) return false;
    if (n !== 1) return true;
    const ch = marker;
    let left = 0;
    while (s - 1 - left >= 0 && text[s - 1 - left] === ch) left++;
    let right = 0;
    while (e + right < text.length && text[e + right] === ch) right++;
    return left % 2 === 1 && right % 2 === 1;
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
   * Split a table line into segments at separating pipes. With outer pipes
   * the first and last segments are the (empty) outside parts.
   * @purity pure
   * @param {string} line
   * @returns {{segments: string[], first: number, last: number}}
   */
  static _splitRow(line) {
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
}
