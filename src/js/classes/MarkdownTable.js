import MarkdownTextOps from "./MarkdownTextOps.js";
import { displayWidth } from "../textWidth.js";

// A delimiter cell of a GFM table: dashes with optional colons.
const DELIMITER_CELL = /^:?-+:?$/;
// Spaces and tabs only: a cell's ideographic space or no-break space is content.
const OUTER_BLANKS = /^[ \t]+|[ \t]+$/g;

/**
 * A GFM table as data (spec 5.14.13, INV-61, INV-65). Pure: no DOM, no CONFIG.
 *
 * Table value: { aligns, rows, extras }
 *   aligns - one of "left" / "center" / "right" / "none" per column
 *   rows   - row 0 is the header; every row has exactly aligns.length cells
 *            (cell text as written, without the spaces and tabs around it)
 *   extras - per row, the cells after the header's count, kept as written
 * Cells are split at pipes without a backslash in front, as marked does
 * (a pipe inside a code span is a separator too; MarkdownTextOps.splitTableRow).
 */
export default class MarkdownTable {
  /**
   * Read a table's raw text, or null when it is not a GFM table (a header
   * row and a delimiter row with the same number of cells).
   * @purity pure
   * @param {string} raw
   * @returns {{aligns: string[], rows: string[][], extras: string[][]}|null}
   */
  static parse(raw) {
    const lines = raw.replace(/\n+$/, "").split("\n");
    if (lines.length < 2) return null;
    const header = MarkdownTable._cells(lines[0]);
    const delimiter = MarkdownTable._cells(lines[1]);
    if (header.length === 0 || header.length !== delimiter.length) return null;
    if (!delimiter.every((c) => DELIMITER_CELL.test(c))) return null;
    const columns = header.length;
    const aligns = delimiter.map((c) => MarkdownTable._alignOf(c));
    const rows = [];
    const extras = [];
    for (const line of [lines[0], ...lines.slice(2)]) {
      const cells = MarkdownTable._cells(line);
      const row = cells.slice(0, columns);
      while (row.length < columns) row.push("");
      rows.push(row);
      extras.push(cells.slice(columns));
    }
    return { aligns, rows, extras };
  }

  /**
   * Write a table aligned (INV-61): pipes at both ends, one space around
   * each cell, every column padded on the right to its widest cell by
   * display width (at least 3), the delimiter row made of dashes of that
   * width with the alignment colons. Extra cells follow as they were.
   * @purity pure
   * @param {{aligns: string[], rows: string[][], extras: string[][]}} table
   * @returns {string}
   */
  static format(table) {
    const widths = table.aligns.map((_, c) => Math.max(3, ...table.rows.map((row) => displayWidth(row[c]))));
    const line = (cells, extra) =>
      `| ${cells.map((cell, c) => cell + " ".repeat(widths[c] - displayWidth(cell))).join(" | ")} |` +
      extra.map((cell) => ` ${cell} |`).join("");
    const delimiter = `| ${table.aligns.map((align, c) => MarkdownTable._delimiterCell(align, widths[c])).join(" | ")} |`;
    const out = [line(table.rows[0], table.extras[0] ?? []), delimiter];
    for (let r = 1; r < table.rows.length; r++) out.push(line(table.rows[r], table.extras[r] ?? []));
    return out.join("\n");
  }

  /**
   * Align every table block of a text (INV-61: the edited text of a table
   * block may have become several blocks; only the tables are formatted).
   * The text is returned unchanged when its tokens do not add up to it.
   * @purity pure
   * @param {string} text
   * @param {(src: string) => {type: string, raw: string}[]} lexer - block lexer
   * @returns {string}
   */
  static formatTablesIn(text, lexer) {
    const tokens = lexer(text);
    if (tokens.map((t) => t.raw).join("") !== text) return text;
    return tokens.map((token) => MarkdownTable._formatToken(token)).join("");
  }

  /**
   * An empty row under row r (under the header: the first body row; INV-65).
   * @purity pure
   * @param {object} table
   * @param {number} r
   * @returns {object}
   */
  static insertRow(table, r) {
    const at = Math.min(Math.max(r, 0), table.rows.length - 1) + 1;
    const rows = table.rows.map((row) => [...row]);
    const extras = table.extras.map((e) => [...e]);
    rows.splice(at, 0, table.aligns.map(() => ""));
    extras.splice(at, 0, []);
    return { aligns: [...table.aligns], rows, extras };
  }

  /**
   * Remove row r; the header row cannot be removed (D2) -> null.
   * @purity pure
   * @param {object} table
   * @param {number} r
   * @returns {object|null}
   */
  static deleteRow(table, r) {
    if (r <= 0 || r >= table.rows.length) return null;
    return {
      aligns: [...table.aligns],
      rows: table.rows.filter((_, i) => i !== r).map((row) => [...row]),
      extras: table.extras.filter((_, i) => i !== r).map((e) => [...e]),
    };
  }

  /**
   * An empty column right of column c, with the default alignment (INV-65).
   * @purity pure
   * @param {object} table
   * @param {number} c
   * @returns {object}
   */
  static insertColumn(table, c) {
    const at = Math.min(Math.max(c, 0), table.aligns.length - 1) + 1;
    const aligns = [...table.aligns];
    aligns.splice(at, 0, "none");
    /** @purity pure */
    const rows = table.rows.map((row) => {
      const copy = [...row];
      copy.splice(at, 0, "");
      return copy;
    });
    return { aligns, rows, extras: table.extras.map((e) => [...e]) };
  }

  /**
   * Remove column c; the only column cannot be removed (D2) -> null.
   * @purity pure
   * @param {object} table
   * @param {number} c
   * @returns {object|null}
   */
  static deleteColumn(table, c) {
    if (table.aligns.length <= 1 || c < 0 || c >= table.aligns.length) return null;
    return {
      aligns: table.aligns.filter((_, i) => i !== c),
      rows: table.rows.map((row) => row.filter((_, i) => i !== c)),
      extras: table.extras.map((e) => [...e]),
    };
  }

  /**
   * The alignment of column c: "left" / "center" / "right" / "none" (INV-65).
   * @purity pure
   * @param {object} table
   * @param {number} c
   * @param {string} align
   * @returns {object}
   */
  static setAlignment(table, c, align) {
    const aligns = table.aligns.map((a, i) => (i === c ? align : a));
    return { aligns, rows: table.rows.map((row) => [...row]), extras: table.extras.map((e) => [...e]) };
  }

  /**
   * A cell's text as a table holds it: without the spaces and tabs around
   * it (marked trims a cell the same way). An ideographic space or a
   * no-break space is content and stays.
   * @purity pure
   * @param {string} text
   * @returns {string}
   */
  static trimCell(text) {
    return text.replace(OUTER_BLANKS, "");
  }

  // ---- helpers (pure) ----

  /**
   * A block token's raw, aligned when it is a table (trailing newlines kept).
   * @purity pure
   * @param {{type: string, raw: string}} token
   * @returns {string}
   */
  static _formatToken(token) {
    if (token.type !== "table") return token.raw;
    const table = MarkdownTable.parse(token.raw);
    if (!table) return token.raw;
    return MarkdownTable.format(table) + /\n*$/.exec(token.raw)[0];
  }

  /**
   * The cells of a table line, without the spaces and tabs around each.
   * @purity pure
   * @param {string} line
   * @returns {string[]}
   */
  static _cells(line) {
    const row = MarkdownTextOps.splitTableRow(line);
    return row.segments.slice(row.first, row.last).map((cell) => MarkdownTable.trimCell(cell));
  }

  /**
   * @purity pure
   * @param {string} cell - a delimiter cell
   * @returns {string}
   */
  static _alignOf(cell) {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (left) return "left";
    if (right) return "right";
    return "none";
  }

  /**
   * @purity pure
   * @param {string} align
   * @param {number} width - at least 3
   * @returns {string}
   */
  static _delimiterCell(align, width) {
    if (align === "left") return `:${"-".repeat(width - 1)}`;
    if (align === "right") return `${"-".repeat(width - 1)}:`;
    if (align === "center") return `:${"-".repeat(width - 2)}:`;
    return "-".repeat(width);
  }
}
