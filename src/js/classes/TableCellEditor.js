import { CONFIG } from "../config.js";
import { shortcutLetter } from "../utils.js";
import ClipboardLink from "./ClipboardLink.js";
import InlineRuns from "./InlineRuns.js";
import InvisibleCharOverlay from "./InvisibleCharOverlay.js";
import MarkdownTable from "./MarkdownTable.js";
import MarkdownTextOps from "./MarkdownTextOps.js";

// INV-63: the only input types a cell takes; everything else (paragraphs,
// line breaks, paste, drop, links, formats, history) is stopped. Line breaks
// are INV-64, paste is the paste event.
const ALLOWED_INPUT_TYPES = new Set([
  "insertText",
  "insertCompositionText",
  "insertReplacementText",
  "deleteContentBackward",
  "deleteContentForward",
  "deleteWordBackward",
  "deleteWordForward",
  "deleteSoftLineBackward",
  "deleteSoftLineForward",
  "deleteHardLineBackward",
  "deleteHardLineForward",
  "deleteByCut",
]);

// A footnote reference (GFM): marked does not read it, so it would be text,
// and a WYSIWYG cell would write it escaped (owner ruling 2026-10-22, X02).
const FOOTNOTE_REFERENCE = /(?:^|[^\\])(?:\\\\)*\[\^[^\]\s]+\]/;
// An HTML comment: DOMPurify drops it, so the cell's HTML still matches and
// a WYSIWYG cell would lose it when written (review CR-2).
const HTML_COMMENT = "<!--";
// The attributes a format element may have to open as rendered in another
// nesting (X02): any other (a title on strong, a class) would be lost (CR-3).
const FORMAT_ATTRIBUTES = { a: ["href", "title"], span: ["style"] };
// The nodes a cell may hold to open as rendered when its HTML is not what
// the normal form draws (bold, italic, links, palette colors in any nesting,
// owner ruling 2026-10-22, X02); "mark" and "br" hold no format.
const FORMAT_KINDS = new Set(["text", "br", "mark", "strong", "em", "a", "span"]);

const EDITING_CLASS = "grsmd-cell-editing";
const RAW_CLASS = "grsmd-cell-raw";
const MARK_CLASS = "grsmd-invisible";

/**
 * A copy of a cell's DOM (INV-63, 5.14.12): the kind of each allowed
 * element, the link index of an a element that was there when the cell
 * opened (by reference), a span's style, and the text. Nothing else of the
 * attributes is read. Marks (INV-70) are "mark" nodes; filler line breaks
 * are left out.
 * @purity semi-pure-b
 * @param {Node} root
 * @param {{links: Map<Element, number>, marks: WeakSet<Element>, fillers: WeakSet<Element>}} refs
 * @returns {object[]} InlineRuns.fromNodes() nodes
 */
export function snapshotNodes(root, refs) {
  const out = [];
  for (const node of root.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push({ kind: "text", text: node.data });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || refs.fillers.has(node)) continue;
    const children = snapshotNodes(node, refs);
    if (refs.marks.has(node)) {
      out.push({ kind: "mark", children });
      continue;
    }
    switch (node.tagName.toLowerCase()) {
      case "br":
        out.push({ kind: "br" });
        break;
      case "strong":
      case "b":
        out.push({ kind: "strong", children });
        break;
      case "em":
      case "i":
        out.push({ kind: "em", children });
        break;
      case "del":
      case "s":
        out.push({ kind: "del", children });
        break;
      case "code":
        out.push({ kind: "code", children });
        break;
      case "a":
        out.push({ kind: "a", link: refs.links.has(node) ? refs.links.get(node) : null, children });
        break;
      case "span":
        out.push({ kind: "span", style: node.getAttribute("style"), children });
        break;
      default:
        out.push({ kind: "other", children });
        break;
    }
  }
  return out;
}

/**
 * INV-63 for a raw cell: an unescaped pipe is escaped, a newline is <br>;
 * nothing else changes (ruling L2). Reads CONFIG.edit.tableLineBreak.
 * @purity semi-pure-a
 * @param {string} text
 * @returns {string}
 */
export function fixRawCellText(text) {
  return InlineRuns.escapeCellPipes(text, { inTableCell: true }).replace(/\n/g, CONFIG.edit.tableLineBreak);
}

/**
 * Table cells edited as they are rendered (INV-62 to INV-65, INV-72;
 * spec 5.14.12). One table session at a time: the table block is held
 * (INV-47), one cell is open at a time. The cell is contenteditable
 * ("plaintext-only", or "true" where that is not taken); this is the only
 * file that sets contentEditable (AT-STA-07). The 11-c state machine of
 * BlockEditController decides what happens; this class does the actions.
 *
 * host: dispatch(event) (11-c events from the cell's keys), onCellInput()
 * (the cell's content or selection changed).
 */
export default class TableCellEditor {
  /**
   * @param {RendererOrchestrator} orchestrator
   * @param {MarkdownRenderer} renderer - tables, cell HTML and the image gate
   * @param {{dispatch: (event: string) => void, onCellInput: () => void}} host
   * @param {{isApple?: boolean}} [options] - isApple: the primary modifier is Cmd (INV-14), as UIController has it
   * @purity non-pure
   */
  constructor(orchestrator, renderer, host, options = {}) {
    this.orchestrator = orchestrator;
    this.renderer = renderer;
    this.host = host;
    this.isApple = Boolean(options.isApple);
    this._session = null; // { blockId }
    this._cell = null; // the open cell (see openCell)
    this._plan = null; // { generation, commit, operation, op } from planFor()
    this._lastPosition = null; // the cell closed last: where a table operation acts
    this._parsed = null; // { raw, table }: the session's table as data
    this._composing = false;
    this.editGeneration = 0; // INV-69: opened, closed, changed
    this._marks = new WeakSet();
    this._fillers = new WeakSet();
    this._onKeyDown = (e) => this._handleKeyDown(e);
    this._onBeforeInput = (e) => this._handleBeforeInput(e);
    this._onInput = () => this._changed();
    this._onPaste = (e) => this._handlePaste(e);
    this._onDrop = (e) => this._handleDrop(e);
    /** @purity non-pure */
    this._onCompositionStart = () => {
      this._composing = true;
    };
    /** @purity non-pure */
    this._onCompositionEnd = () => {
      this._composing = false;
    };
  }

  // ---- queries ----

  /**
   * @purity semi-pure-b
   * @returns {number|null} the table block of the session
   */
  sessionBlockId() {
    return this._session ? this._session.blockId : null;
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isOpen() {
    return this._cell !== null;
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isComposing() {
    return this._composing;
  }

  /**
   * The node is inside the open cell (by reference).
   * @purity semi-pure-b
   * @param {Node|null} node
   * @returns {boolean}
   */
  containsNode(node) {
    return this._cell !== null && node instanceof Node && this._cell.element.contains(node);
  }

  /**
   * The node is inside the table element of the session (INV-30).
   * @purity semi-pure-b
   * @param {Node|null} node
   * @returns {boolean}
   */
  isInSessionTable(node) {
    if (!this._session || !(node instanceof Node)) return false;
    const table = this.renderer.getTableElement(this._session.blockId);
    return Boolean(table) && table.contains(node);
  }

  /**
   * INV-62 (1), the guard isCellEditableTable: the rendered table has as
   * many rows, and each row as many cells, as the table's text.
   * @purity semi-pure-b
   * @param {number} blockId
   * @returns {boolean}
   */
  isCellEditableTable(blockId) {
    const block = this._block(blockId);
    const table = this.renderer.getTableElement(blockId);
    if (!block || block.type !== "table" || !table) return false;
    const parsed = MarkdownTable.parse(block.raw);
    if (!parsed || table.rows.length !== parsed.rows.length) return false;
    for (const row of table.rows) if (row.cells.length !== parsed.aligns.length) return false;
    return true;
  }

  /**
   * The open cell's text differs from what it was opened with (INV-62).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  hasUncommittedChange() {
    return this._cell !== null && this._readCell() !== this._cell.openedMarkdown;
  }

  /**
   * Where the open cell is, and its table: for the palette (5.15.5).
   * @purity semi-pure-b
   * @returns {{row: number, col: number, columns: number, alignment: string, kind: string}|null}
   */
  cellState() {
    const table = this._sessionTable();
    if (!this._cell || !table) return null;
    const { row, col, kind } = this._cell;
    return { row, col, columns: table.aligns.length, alignment: table.aligns[col] ?? "none", kind };
  }

  /**
   * The cell an INV-64 move goes to, or null (first and last cell).
   * @purity semi-pure-b
   * @param {"next"|"previous"|"below"} direction
   * @returns {{row: number, col: number}|null}
   */
  neighbour(direction) {
    const table = this._sessionTable();
    if (!this._cell || !table) return null;
    const { row, col } = this._cell;
    const rows = table.rows.length;
    const cols = table.aligns.length;
    if (direction === "below") return row + 1 < rows ? { row: row + 1, col } : null;
    let index = row * cols + col + (direction === "next" ? 1 : -1);
    if (index < 0 || index >= rows * cols) return null;
    return { row: Math.floor(index / cols), col: index % cols };
  }

  /**
   * INV-65 limits (D2): the header row and the only column stay.
   * @purity semi-pure-b
   * @param {{kind: string}} op
   * @returns {boolean}
   */
  canApplyOperation(op) {
    const state = this.cellState();
    if (!state) return false;
    if (op.kind === "deleteRow") return state.row > 0;
    if (op.kind === "deleteColumn") return state.columns > 1;
    return ["insertRow", "insertColumn", "align"].includes(op.kind);
  }

  /**
   * The guard canKeepTableId (11-c): every commit of this crossing (the
   * open cell's, and the table operation's) keeps the table's id. The plan
   * is kept for the commit that follows (the text is lexed once).
   * @purity non-pure
   * @param {{kind: string, value?: string}|null} [op] - tableOperationRequested
   * @returns {boolean}
   */
  planFor(op = null) {
    const commit = this._planCommit();
    let operation = null;
    if (op) {
      const base = commit ? commit.model : this.orchestrator.getModel();
      const block = base?.getBlocks()[base.findIndexById(this._session.blockId)];
      const table = block ? MarkdownTable.parse(block.raw) : null;
      const next = table ? this._operatedTable(table, op) : null;
      if (next) operation = this.orchestrator.planTableReplace(this._session.blockId, MarkdownTable.format(next), base);
    }
    this._plan = { generation: this.editGeneration, commit, operation, op };
    return (!commit || commit.keptId) && (!operation || operation.keptId);
  }

  // ---- session and cell ----

  /**
   * Start a table session: the table block is held (INV-47).
   * @purity non-pure
   * @param {number} blockId
   */
  startSession(blockId) {
    this._session = { blockId };
    this.orchestrator.holdBlock(blockId);
  }

  /**
   * End the session: the hold is released (a stale table is drawn again).
   * @purity non-pure
   */
  endSession() {
    if (!this._session) return;
    if (this._cell) this._closeDom(true);
    this._session = null;
    this._plan = null;
    // nothing of this table is kept for the next one (5.15.7)
    this._parsed = null;
    this._lastPosition = null;
    this.orchestrator.releaseBlock();
  }

  /**
   * Open cell (row, col) of the session's table (INV-62): its children are
   * kept aside, and the cell shows a copy to edit, as rendered (WYSIWYG)
   * when the cell's HTML and the written-back Markdown both match what is
   * shown, or else as its text (a raw cell). caret: where the click was.
   * @purity non-pure
   * @param {number} row
   * @param {number} col
   * @param {{x: number, y: number}|null} [caret]
   * @returns {boolean} true when a cell opened
   */
  openCell(row, col, caret = null) {
    if (!this._session || this._cell) return false;
    const table = this.renderer.getTableElement(this._session.blockId);
    const parsed = this._sessionTable();
    const element = table?.rows[row]?.cells[col];
    if (!element || !parsed) return false;
    const raw = parsed.rows[row][col];
    // the cell moved since it was pressed: the point moves with it
    const point = caret && typeof caret.top === "number" ? { x: caret.x, y: caret.y + element.getBoundingClientRect().top - caret.top } : caret;
    const saved = [...element.childNodes];
    const opened = this._wysiwygCopy(element, raw);
    // literals: URL texts taken off a link here, kept text when written (INV-69)
    const cell = { row, col, element, saved, raw, kind: opened ? "wysiwyg" : "raw", links: new Map(), linkInfo: [], openedMarkdown: raw, literals: [] };
    if (opened) {
      cell.links = opened.links;
      cell.linkInfo = opened.linkInfo;
      element.replaceChildren(...opened.nodes);
    } else {
      element.replaceChildren(document.createTextNode(raw));
      element.classList.add(RAW_CLASS);
    }
    this._cell = cell;
    this._markInvisible(element);
    if (opened) cell.openedMarkdown = this._readCell();
    element.classList.add(EDITING_CLASS);
    this._setEditable(element, true);
    this._listen(element, true);
    this.editGeneration++;
    element.focus({ preventScroll: true });
    this._placeCaret(element, point);
    return true;
  }

  /**
   * Close the open cell (INV-62): a changed cell is committed with
   * replaceTableBlock (the plan of planFor() when it is still current) and,
   * when the table keeps its id, written in place with inlineHtml; an
   * unchanged cell gets its children back.
   * @purity non-pure
   * @returns {boolean} true when the text changed
   */
  commitCell() {
    if (!this._cell) return false;
    const { element } = this._cell;
    const text = this._readCell();
    const plan = text !== this._cell.openedMarkdown ? this._currentPlan().commit : null;
    this._closeDom(plan === null);
    if (!plan) return false;
    this.orchestrator.replaceTableBlock(this._session.blockId, plan);
    if (plan.keptId) {
      const links = this.orchestrator.getModel().links;
      /** @purity non-pure */
      this.orchestrator.writeHeldInterior(this._session.blockId, () => {
        element.innerHTML = this.renderer.inlineHtml(text, links);
        this.renderer.applyImageGate(element);
      });
    }
    return true;
  }

  /**
   * Cancel the open cell (Esc, INV-48 (1)): its children come back.
   * @purity non-pure
   */
  revertCell() {
    if (this._cell) this._closeDom(true);
  }

  /**
   * Drop the open cell without committing (the document is replaced).
   * @purity non-pure
   */
  discardCell() {
    this.revertCell();
  }

  /**
   * INV-65 after the cell commit of the same crossing: one undoable unit;
   * when the table keeps its id its table element is drawn again in place
   * from blockHtml. Returns the cell to open next, or null.
   * @purity non-pure
   * @param {{kind: string, value?: string}} op
   * @returns {{row: number, col: number}|null}
   */
  applyTableOperation(op) {
    if (!this._session) return null;
    // 11-c always plans first (canKeepTableId); the plan is null when the
    // operation changes nothing (the alignment the column has): the same
    // cell opens again, and no unit is recorded.
    const plan = this._plan && this._plan.op === op ? this._plan.operation : null;
    const from = this._lastPosition;
    this._plan = null;
    if (!plan || !plan.isChanged) return from && op.kind === "align" ? from : null;
    const before = this.orchestrator.getModel();
    this.orchestrator.replaceTableBlock(this._session.blockId, plan);
    if (!plan.keptId || this.orchestrator.getModel() === before) return null;
    const blockId = this._session.blockId;
    const links = this.orchestrator.getModel().links;
    const block = this._block(blockId);
    /** @purity non-pure */
    this.orchestrator.writeHeldInterior(blockId, () => {
      const old = this.renderer.getTableElement(blockId);
      if (!old || this._writeRowChange(old, op, from)) return;
      const table = this._parsedTable(this.renderer.cachedBlockHtml(block, links));
      if (!table) return;
      old.replaceWith(table);
      this.renderer.applyImageGate(table);
    });
    return from ? TableCellEditor.cellAfter(op, from) : null;
  }

  /**
   * INV-65 in place (INV-47 exception, INV-51): only the changed rows or
   * cells of the held table element change, so a big table is not drawn
   * again. New elements come from marked + DOMPurify (blockHtml of a small
   * table with the same alignment) and pass the image gate; the contents of
   * the cells that stay are moved as they are. false when the change is
   * not one of these (then the whole table is drawn again).
   * @purity non-pure
   * @param {HTMLTableElement} table
   * @param {{kind: string, value?: string}} op
   * @param {{row: number, col: number}|null} at - where the operation was done
   * @returns {boolean} true when written
   */
  _writeRowChange(table, op, at) {
    const body = table.tBodies[0];
    if (!at || !body) return false;
    const rows = [...table.rows];
    switch (op.kind) {
      case "deleteRow":
        if (body.rows.length < 2) return false; // marked writes no tbody without a body row
        rows[at.row].remove();
        return true;
      case "deleteColumn":
        for (const row of rows) row.cells[at.col]?.remove();
        return true;
      case "insertRow": {
        const fresh = this._sampleCells("none", this._sessionTable()?.aligns);
        if (!fresh) return false;
        if (at.row === 0) body.prepend(fresh.row);
        else rows[at.row].after(fresh.row);
        this.renderer.applyImageGate(fresh.row);
        return true;
      }
      case "insertColumn":
      case "align": {
        const fresh = this._sampleCells(op.kind === "align" ? op.value : "none");
        if (!fresh) return false;
        for (let r = 0; r < rows.length; r++) {
          const cell = (r === 0 ? fresh.head : fresh.cell).cloneNode(false);
          const at0 = rows[r].cells[at.col];
          if (!at0) return false;
          if (op.kind === "insertColumn") {
            at0.after(cell);
          } else {
            cell.append(...at0.childNodes);
            at0.replaceWith(cell);
          }
        }
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * Empty cells as marked + DOMPurify write them: a header cell and a body
   * cell with alignment align, and a body row of empty cells for aligns.
   * @purity non-pure
   * @param {string} align
   * @param {string[]} [aligns] - for the row
   * @returns {{head: Element, cell: Element, row: Element|null}|null}
   */
  _sampleCells(align, aligns = [align]) {
    const empty = aligns.map(() => "");
    const raw = MarkdownTable.format({ aligns, rows: [empty, [...empty]], extras: [[], []] });
    const table = this._parsedTable(this.renderer.blockHtml(raw, {}).html);
    const head = table?.rows[0]?.cells[0];
    const row = table?.tBodies[0]?.rows[0] ?? null;
    return head && row ? { head, cell: row.cells[0], row } : null;
  }

  /**
   * The table element of sanitized HTML, parsed in an inert template.
   * @purity non-pure
   * @param {string} html - marked + DOMPurify output
   * @returns {HTMLTableElement|null}
   */
  _parsedTable(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.querySelector("table");
  }

  /**
   * INV-29 (a): the (row, col) of the cell of table that holds node, by
   * reference to table.rows[r].cells[c] (a cell of a table nested inside
   * is not one; closest("td") is not used), or null.
   * @purity semi-pure-b
   * @param {HTMLTableElement} table
   * @param {Node} node
   * @returns {{row: number, col: number}|null}
   */
  static cellAt(table, node) {
    for (let el = node; el && el !== table; el = el.parentNode) {
      if (el.nodeType !== Node.ELEMENT_NODE || (el.tagName !== "TD" && el.tagName !== "TH")) continue;
      const row = el.parentNode?.rowIndex ?? -1;
      if (row >= 0 && table.rows[row]?.cells[el.cellIndex] === el) return { row, col: el.cellIndex };
    }
    return null;
  }

  /**
   * The cell INV-65 opens after an operation done at (row, col).
   * @purity pure
   * @param {{kind: string}} op
   * @param {{row: number, col: number}} at
   * @returns {{row: number, col: number}}
   */
  static cellAfter(op, at) {
    switch (op.kind) {
      case "insertRow":
        return { row: at.row + 1, col: at.col };
      case "deleteRow":
        return { row: at.row - 1, col: at.col };
      case "insertColumn":
        return { row: at.row, col: at.col + 1 };
      case "deleteColumn":
        return { row: at.row, col: Math.max(at.col - 1, 0) };
      default:
        return { row: at.row, col: at.col };
    }
  }

  // ---- formats (INV-66 / 67) ----

  /**
   * The selection is in the open cell and not empty (5.15.5); in a raw
   * cell it is also in one inline range (INV-67 (6)).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  canFormatSelection() {
    const range = this._selectionOffsets();
    if (!range || range.start === range.end) return false;
    if (this._cell.kind === "wysiwyg") return true;
    const text = this._rawText();
    return MarkdownTextOps.canFormatRange(text, range.start, range.end, this.orchestrator.textLexers().lexBlocks);
  }

  /**
   * Bold / Italic / text color on the cell's selection (INV-66 / 67): a
   * change of the open cell, not a commit. A WYSIWYG cell is drawn again
   * from the written Markdown (marked + DOMPurify, INV-47) and checked
   * against the format runs; a raw cell's text is rewritten (formatRange).
   * @purity non-pure
   * @param {{kind: string, value?: string|null}} op
   * @returns {boolean} true when it changed
   */
  applyFormat(op) {
    const range = this._selectionOffsets();
    if (!range || range.start === range.end) return false;
    return this._cell.kind === "wysiwyg" ? this._formatWysiwyg(op, range) : this._formatRaw(op, range);
  }

  // ---- links (INV-69) ----

  /**
   * What the palette's Paste link acts on: the table, the open cell, the
   * selection in it (null when it is not in the cell) and the edit
   * generation; null when no cell is open.
   * @purity semi-pure-b
   * @returns {object|null}
   */
  linkTarget() {
    if (!this._cell) return null;
    const range = this._selectionOffsets();
    return {
      kind: "cell",
      blockId: this._session.blockId,
      row: this._cell.row,
      col: this._cell.col,
      generation: this.editGeneration,
      start: range ? range.start : null,
      end: range ? range.end : null,
    };
  }

  /**
   * 5.15.5 Paste link: a selection that can take a format, or a caret
   * where a link can go in (owner ruling F-R1: not inside a link, a code
   * span or another piece kept whole).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  canPasteLink() {
    const range = this._selectionOffsets();
    if (!range) return false;
    if (range.start !== range.end) return this.canFormatSelection();
    if (this._cell.kind === "raw") return MarkdownTextOps.canInsertLink(this._rawText(), range.start, this._rawContext());
    const runs = this._runs();
    const index = this._caretRunIndex();
    return InlineRuns.canInsertLinkAt(runs, index) && this._linkStaysAfter(runs, index);
  }

  /**
   * A link written before run index i is read as a link: the word right
   * before it (its text up to a space, a bare URL too) does not swallow it,
   * as marked reads "https://a.example/[L](u)" as one bare URL. The word and
   * a stand-in link are written as insertLinkAt writes them (a "!" before
   * it as \!).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  _linkStaysAfter(runs, i) {
    let a = i;
    while (a > 0 && runs[a - 1].type === "text" && !/\s/.test(runs[a - 1].text)) a--;
    if (a === i) return true;
    const options = this._serializeOptions();
    const probe = InlineRuns.insertLinkAt(runs.slice(a, i), i - a, "x", InlineRuns.inlineLink("u"), options);
    if (!probe) return false;
    const tokens = this.orchestrator.textLexers().lexInline(InlineRuns.serialize(probe.runs, options));
    return tokens.some((t) => t.type === "link" && t.href === "u");
  }

  /**
   * 5.15.5 Remove link: the caret or the selection is on a link of the cell.
   * @purity semi-pure-b
   * @returns {boolean}
   */
  canRemoveLink() {
    const range = this._selectionOffsets();
    if (!range) return false;
    if (this._cell.kind === "wysiwyg") return InlineRuns.hasLinkAt(this._runs(), range.start, range.end);
    return MarkdownTextOps.canRemoveLink(this._rawText(), range.start, range.end, this._rawContext());
  }

  /**
   * The palette's Paste link: the selection becomes a link to url; with a
   * caret a link goes in there, its text label or else url, selected. A
   * change of the open cell (not a commit).
   * @purity non-pure
   * @param {string} url
   * @param {string|null} label
   * @returns {boolean} true when it changed
   */
  pasteLink(url, label) {
    const range = this._selectionOffsets();
    if (!range) return false;
    const op = ClipboardLink.linkOp(url);
    if (range.start !== range.end) return this.applyFormat(op);
    // the clipboard's link text, or the URL when that text cannot go in as written
    const texts = label && label !== op.url ? [label, op.url] : [op.url];
    if (this._cell.kind === "wysiwyg") {
      const runs = this._runs();
      const index = this._caretRunIndex();
      if (!this._linkStaysAfter(runs, index)) return false;
      return texts.some((text) => this._writeWysiwyg(InlineRuns.insertLinkAt(runs, index, text, op.link, this._serializeOptions())));
    }
    const raw = this._rawText();
    return texts.some((text) => this._writeRaw(MarkdownTextOps.insertLink(raw, range.start, text, op.link, this._rawContext())));
  }

  /**
   * The palette's Remove link: the link at the caret, or every link the
   * selection touches, comes off; a URL text taken off stays text (also
   * when the cell is written again from its DOM). A change of the open cell.
   * @purity non-pure
   * @returns {boolean} true when it changed
   */
  removeLink() {
    const range = this._selectionOffsets();
    if (!range) return false;
    if (this._cell.kind === "raw") {
      return this._writeRaw(MarkdownTextOps.removeLink(this._rawText(), range.start, range.end, this._rawContext()));
    }
    const runs = this._runs();
    const result = InlineRuns.apply(runs, range.start, range.end, { kind: "unlink" }, this._serializeOptions());
    if (!result) return false;
    // each link taken off, with the text next to it (an autolink could take
    // both: "[www](u).example"): kept text when the cell is written again
    const kept = new Set(result.runs.map((r) => r.marks.link).filter(Boolean));
    const removed = [];
    for (let k = 0; k < runs.length; ) {
      const link = runs[k].marks.link;
      if (!link || kept.has(link)) {
        k++;
        continue;
      }
      let e = k;
      while (e < runs.length && runs[e].marks.link === link) e++;
      const around = InlineRuns.textAround(result.runs, k, e);
      removed.push(result.runs.slice(around.from, around.to).map((r) => r.text).join(""));
      k = e;
    }
    const literals = this._cell.literals;
    this._cell.literals = [...literals, ...removed];
    if (this._writeWysiwyg(result)) return true;
    this._cell.literals = literals;
    return false;
  }

  // ---- internals: opening ----

  /**
   * INV-62 (2) and the read-back: the nodes to edit, or null for a raw
   * cell. A cell with a footnote reference is raw. The read-back is the
   * HTML of the normal form; a cell of bold, italic, links and palette
   * colors only may differ in how they nest: then its format runs (each
   * character's bold, italic, color and link) must be the same as the
   * normal form's (owner ruling 2026-10-22, X02). The source is written
   * in the normal form only when the cell is changed.
   * @purity non-pure
   * @returns {{nodes: Node[], links: Map<Element, number>, linkInfo: object[]}|null}
   */
  _wysiwygCopy(element, raw) {
    if (FOOTNOTE_REFERENCE.test(raw) || raw.includes(HTML_COMMENT)) return null;
    const links = this.orchestrator.getModel()?.links;
    if (this._normalized(this.renderer.inlineHtml(raw, links)) !== element.innerHTML) return null;
    const linkInfo = InlineRuns.linksOf(this.orchestrator.textLexers().lexInline(raw.replace(/\\\|/g, "|")));
    const nodes = [...element.childNodes].map((n) => n.cloneNode(true));
    const holder = document.createElement("div");
    holder.append(...nodes);
    const anchors = [...holder.querySelectorAll("a")];
    if (anchors.length !== linkInfo.length || linkInfo.some((l) => !l)) return null;
    const map = new Map(anchors.map((a, i) => [a, i]));
    const tree = snapshotNodes(holder, { links: map, marks: this._marks, fillers: this._fillers });
    const runs = InlineRuns.fromNodes(tree, linkInfo, this._colors());
    const html = this.renderer.inlineHtml(InlineRuns.serialize(runs, this._serializeOptions()), links);
    if (this._normalized(html) !== element.innerHTML && !(TableCellEditor._plainFormats(holder) && this._sameFormats(tree, runs, html, linkInfo))) {
      return null;
    }
    return { nodes: [...holder.childNodes], links: map, linkInfo };
  }

  /**
   * The cell holds bold, italic, links and palette colors only, and the
   * normal form's HTML (html) draws the same format runs (X02).
   * @purity non-pure
   * @param {object[]} tree - snapshotNodes of the cell
   * @param {object[]} runs - its format runs
   * @param {string} html - the normal form drawn (marked + DOMPurify)
   * @param {object[]} linkInfo
   * @returns {boolean}
   */
  _sameFormats(tree, runs, html, linkInfo) {
    if (!this._onlyFormats(tree, linkInfo)) return false;
    const template = document.createElement("template");
    template.innerHTML = html;
    const anchors = [...template.content.querySelectorAll("a")];
    if (anchors.length !== linkInfo.length) return false;
    const drawn = snapshotNodes(template.content, { links: new Map(anchors.map((a, i) => [a, i])), marks: new WeakSet(), fillers: new WeakSet() });
    if (!this._onlyFormats(drawn, linkInfo)) return false;
    const again = InlineRuns.fromNodes(drawn, linkInfo, this._colors());
    return JSON.stringify(InlineRuns.signature(again)) === JSON.stringify(InlineRuns.signature(runs));
  }

  /**
   * Every element under root has no attribute but the ones FORMAT_ATTRIBUTES
   * allows for its tag (a link's href and title, a color span's style).
   * @purity semi-pure-b
   * @param {Node} root
   * @returns {boolean}
   */
  static _plainFormats(root) {
    for (const el of root.querySelectorAll("*")) {
      const allowed = FORMAT_ATTRIBUTES[el.tagName.toLowerCase()] ?? [];
      for (const attr of el.attributes) if (!allowed.includes(attr.name)) return false;
    }
    return true;
  }

  /**
   * Every node of a snapshot is text, a line break, a mark, strong, em, a
   * link known by its index, or a span whose style is a palette color.
   * @purity semi-pure-b
   * @param {object[]} tree
   * @param {object[]} linkInfo
   * @returns {boolean}
   */
  _onlyFormats(tree, linkInfo) {
    const colors = this._colors().colors.map((c) => c.toLowerCase());
    for (const node of tree) {
      if (!FORMAT_KINDS.has(node.kind)) return false;
      if (node.kind === "a" && !(Number.isInteger(node.link) && linkInfo[node.link])) return false;
      if (node.kind === "span") {
        const color = /^color: (#[0-9A-Fa-f]{6})$/.exec(node.style ?? "");
        if (!color || !colors.includes(color[1].toLowerCase())) return false;
      }
      if (node.children && !this._onlyFormats(node.children, linkInfo)) return false;
    }
    return true;
  }

  /**
   * HTML as the DOM writes it back, from an inert template (never in the page).
   * @purity semi-pure-b
   */
  _normalized(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.innerHTML;
  }

  /**
   * @purity non-pure
   */
  _setEditable(element, on) {
    if (!on) {
      element.removeAttribute("contenteditable");
      return;
    }
    // 5.14.12: plaintext-only, or true where the browser does not take it
    try {
      element.contentEditable = "plaintext-only";
    } catch {
      element.contentEditable = "true";
    }
    if (element.contentEditable !== "plaintext-only") element.contentEditable = "true";
  }

  /**
   * @purity non-pure
   */
  _listen(element, on) {
    const method = on ? "addEventListener" : "removeEventListener";
    element[method]("keydown", this._onKeyDown);
    element[method]("beforeinput", this._onBeforeInput);
    element[method]("input", this._onInput);
    element[method]("paste", this._onPaste);
    element[method]("drop", this._onDrop);
    element[method]("compositionstart", this._onCompositionStart);
    element[method]("compositionend", this._onCompositionEnd);
  }

  /**
   * The caret at the click (caretPositionFromPoint / caretRangeFromPoint),
   * or at the end of the cell.
   * @purity non-pure
   */
  _placeCaret(element, point) {
    const selection = window.getSelection();
    if (!selection) return;
    let range = null;
    if (point && typeof document.caretPositionFromPoint === "function") {
      const position = document.caretPositionFromPoint(point.x, point.y);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
      }
    } else if (point && typeof document.caretRangeFromPoint === "function") {
      range = document.caretRangeFromPoint(point.x, point.y);
    }
    if (!range || !element.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // ---- internals: reading and closing ----

  /**
   * The open cell as Markdown: a WYSIWYG cell's format runs written in the
   * normal form (INV-67, INV-72), a raw cell's text with INV-63's fixes.
   * @purity semi-pure-b
   * @returns {string}
   */
  _readCell() {
    // trimmed as the table holds a cell: what is compared, planned and drawn
    // is what the table's text will have (INV-61, INV-62)
    if (this._cell.kind === "raw") return MarkdownTable.trimCell(fixRawCellText(this._rawText()));
    return MarkdownTable.trimCell(InlineRuns.serialize(this._runs(), this._serializeOptions()));
  }

  /**
   * The format runs of the open WYSIWYG cell; a newline in a text node is a
   * line break (a cell has no line of its own).
   * @purity semi-pure-b
   */
  _runs() {
    const { element, links, linkInfo } = this._cell;
    const tree = snapshotNodes(element, { links, marks: this._marks, fillers: this._fillers });
    /** @purity pure */
    return InlineRuns.fromNodes(tree, linkInfo, this._colors()).map((r) =>
      r.type === "text" && r.text === "\n" ? { ...r, type: "br", text: "" } : r,
    );
  }

  /**
   * A raw cell's text: line breaks are newlines.
   * @purity semi-pure-b
   * @returns {string}
   */
  _rawText() {
    let text = "";
    /** @purity semi-pure-b */
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) text += child.data;
        else if (child.nodeType !== Node.ELEMENT_NODE || this._fillers.has(child)) continue;
        else if (child.tagName === "BR") text += "\n";
        else walk(child);
      }
    };
    walk(this._cell.element);
    return text;
  }

  /**
   * Leave the cell: editing ends; restore puts the children back as they
   * were when it opened.
   * @purity non-pure
   */
  _closeDom(restore) {
    const cell = this._cell;
    this._cell = null;
    this._composing = false;
    this._lastPosition = { row: cell.row, col: cell.col };
    const { element } = cell;
    this._listen(element, false);
    // The caret leaves first: a focused editable cell made not editable
    // makes the browser lay the table out again at once (INV-51).
    const selection = window.getSelection();
    if (selection?.anchorNode && element.contains(selection.anchorNode)) selection.removeAllRanges();
    if (element.contains(document.activeElement)) element.blur();
    this._setEditable(element, false);
    element.classList.remove(EDITING_CLASS, RAW_CLASS);
    if (element.getAttribute("class") === "") element.removeAttribute("class");
    if (restore) element.replaceChildren(...cell.saved);
    else this._unmark(element);
    this.editGeneration++;
  }

  /**
   * The plan for the open cell's commit: the one planFor() made when the
   * cell did not change since, else a new one.
   * @purity non-pure
   * @returns {{commit: object|null}}
   */
  _currentPlan() {
    const model = this.orchestrator.getModel();
    if (this._plan && this._plan.generation === this.editGeneration && (!this._plan.commit || this._plan.commit.base === model)) {
      const plan = this._plan;
      this._plan = { ...plan, commit: null, generation: -1 };
      return plan;
    }
    return { commit: this._planCommit() };
  }

  /**
   * The change of the open cell's commit, or null when it did not change.
   * @purity semi-pure-b
   */
  _planCommit() {
    if (!this._cell || !this._session) return null;
    const text = this._readCell();
    if (text === this._cell.openedMarkdown) return null;
    const table = this._sessionTable();
    if (!table) return null;
    const rows = table.rows.map((r) => [...r]);
    rows[this._cell.row][this._cell.col] = text;
    return this.orchestrator.planTableReplace(this._session.blockId, MarkdownTable.format({ ...table, rows }));
  }

  /**
   * @purity semi-pure-b
   */
  _operatedTable(table, op) {
    const at = this._cell ?? this._lastPosition;
    if (!at) return null;
    switch (op.kind) {
      case "insertRow":
        return MarkdownTable.insertRow(table, at.row);
      case "deleteRow":
        return MarkdownTable.deleteRow(table, at.row);
      case "insertColumn":
        return MarkdownTable.insertColumn(table, at.col);
      case "deleteColumn":
        return MarkdownTable.deleteColumn(table, at.col);
      case "align":
        return table.aligns[at.col] === op.value ? null : MarkdownTable.setAlignment(table, at.col, op.value);
      default:
        return null;
    }
  }

  // ---- internals: keys and input (INV-63, INV-64) ----

  /**
   * INV-64: every key handled here is preventDefault()ed, so the document
   * shortcuts do not take it (INV-14 (1)).
   * @purity non-pure
   */
  _handleKeyDown(e) {
    if (e.isComposing || e.keyCode === 229 || this._composing) return;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === "Tab" && plain) {
      e.preventDefault();
      this.host.dispatch(e.shiftKey ? "previousCellRequested" : "nextCellRequested");
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!plain) return;
      if (e.shiftKey) this._insertLineBreak();
      else this.host.dispatch("cellBelowRequested");
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (!e.repeat) this.host.dispatch("escapePressed"); // a held Esc acts once (ruling Q-a)
    } else if (this._isRedo(e)) {
      e.preventDefault(); // INV-59: there is no Redo (OS-18)
    }
  }

  /**
   * Primary + Shift + Z, or Ctrl+Y outside Apple platforms.
   * @purity semi-pure-b
   */
  _isRedo(e) {
    const letter = shortcutLetter(e, this.isApple);
    return (letter === "z" && e.shiftKey) || (letter === "y" && !e.shiftKey && !this.isApple);
  }

  /**
   * @purity non-pure
   */
  _handleBeforeInput(e) {
    if (!ALLOWED_INPUT_TYPES.has(e.inputType)) e.preventDefault();
  }

  /**
   * Paste: first INV-69's link (selected text that is not a URL itself,
   * the paste's text/plain a URL, the selection where a link can go, not
   * inside a code span); else text/plain only, newlines as spaces (INV-63).
   * @purity non-pure
   */
  _handlePaste(e) {
    e.preventDefault();
    if (this._pasteAsLink(e)) return;
    const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?|\n/g, " ");
    if (text === "") return;
    try {
      if (typeof document.execCommand === "function" && document.execCommand("insertText", false, text)) return;
    } catch {
      // fall through to the direct insert
    }
    this._insertNodes([document.createTextNode(text)]);
  }

  /**
   * The run index of the caret in the open WYSIWYG cell (a line break
   * counts 1, so a caret at a line start is after its break); -1 inside a
   * code span or another piece kept whole.
   * @purity semi-pure-b
   * @returns {number}
   */
  _caretRunIndex() {
    const caret = this._selectionOffsets(1);
    return caret ? InlineRuns.runIndexAt(this._runs(), caret.start, 1) : -1;
  }

  /**
   * INV-69's Ctrl+V link in the open cell (synchronous, no permission).
   * @purity non-pure
   * @returns {boolean} true when the selection became a link
   */
  _pasteAsLink(e) {
    if (this._composing) return false; // as the block editor: not during IME composition
    const range = this._selectionOffsets();
    if (!range || range.start === range.end) return false;
    const options = ClipboardLink.urlOptions();
    const url = ClipboardLink.urlFromPasteEvent(e, options);
    if (!url) return false;
    const shown = this._cell.kind === "wysiwyg" ? this._runs().map((r) => r.text).join("") : this._rawText();
    if (ClipboardLink.isLinkableUrl(shown.slice(range.start, range.end), options.schemes, options.maxLength)) return false;
    return this.applyFormat(ClipboardLink.linkOp(url, true));
  }

  /**
   * A text drop does not go in; a file drop goes on to the document drop
   * (INV-63, INV-17).
   * @purity non-pure
   */
  _handleDrop(e) {
    const types = [...(e.dataTransfer?.types ?? [])];
    if (!types.includes("Files")) e.preventDefault();
  }

  /**
   * Shift+Enter: a line break at the caret (INV-64). A break at the very
   * end needs a filler break to show the new line; the filler is not read.
   * @purity non-pure
   */
  _insertLineBreak() {
    const br = document.createElement("br");
    if (!this._insertNodes([br])) return;
    const after = document.createRange();
    after.setStartAfter(br);
    after.setEndAfter(this._cell.element.lastChild);
    if (after.toString() === "" && !after.cloneContents().querySelector("br")) {
      const filler = document.createElement("br");
      this._fillers.add(filler);
      br.after(filler);
      // again now that the line exists: WebKit put the caret before a break
      // that ended the cell
      const caret = document.createRange();
      caret.setStartAfter(br);
      caret.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(caret);
    }
  }

  /**
   * Put nodes in place of the selection inside the open cell; the caret
   * goes after them.
   * @purity non-pure
   * @returns {boolean} true when they were put in (a selection in the cell)
   */
  _insertNodes(nodes) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!this.containsNode(range.startContainer) || !this.containsNode(range.endContainer)) return false;
    range.deleteContents();
    for (let i = nodes.length - 1; i >= 0; i--) range.insertNode(nodes[i]);
    range.setStartAfter(nodes[nodes.length - 1]);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    this._changed();
    return true;
  }

  /**
   * The cell changed: the marks follow (the caret kept), and the host hears.
   * @purity non-pure
   */
  _changed() {
    if (!this._cell) return;
    this.editGeneration++;
    if (this._needsRemark(this._cell.element)) {
      const caret = this._selectionOffsets(1);
      this._unmark(this._cell.element);
      this._markInvisible(this._cell.element);
      if (caret) this._selectOffsets(caret.start, caret.end, 1);
    }
    this.host.onCellInput();
  }

  // ---- internals: INV-70 marks ----

  /**
   * Wrap each run of invisible characters in a mark span (made here,
   * known by reference; written as text, INV-63).
   * @purity non-pure
   */
  _markInvisible(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!this._marks.has(n.parentNode)) texts.push(n);
    for (const text of texts) {
      const parts = InvisibleCharOverlay.segments(text.data);
      if (!parts.some((p) => p.mark)) continue;
      /** @purity non-pure */
      const nodes = parts.map((p) => {
        if (!p.mark) return document.createTextNode(p.text);
        const span = document.createElement("span");
        span.className = MARK_CLASS;
        span.textContent = p.text;
        this._marks.add(span);
        return span;
      });
      text.replaceWith(...nodes);
    }
  }

  /**
   * Take the mark spans out, keeping their text.
   * @purity non-pure
   */
  _unmark(root) {
    for (const span of [...root.querySelectorAll(`span.${MARK_CLASS}`)]) {
      if (this._marks.has(span)) span.replaceWith(...span.childNodes);
    }
    root.normalize();
  }

  /**
   * A mark holds other text, or invisible characters stand unmarked.
   * @purity semi-pure-b
   */
  _needsRemark(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parts = InvisibleCharOverlay.segments(n.data);
      const inMark = this._marks.has(n.parentNode);
      if (inMark ? parts.some((p) => !p.mark) : parts.some((p) => p.mark)) return true;
    }
    return false;
  }

  // ---- internals: selection offsets ----

  /**
   * The selection in the open cell as text offsets (a line break counts
   * brWidth: 0 for the format runs, 1 for a raw cell and the caret), or
   * null when it is not inside the cell.
   * @purity semi-pure-b
   * @param {number} [brWidth]
   * @returns {{start: number, end: number}|null}
   */
  _selectionOffsets(brWidth = this._cell?.kind === "raw" ? 1 : 0) {
    if (!this._cell) return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!this.containsNode(range.startContainer) || !this.containsNode(range.endContainer)) return null;
    const start = this._offsetOf(range.startContainer, range.startOffset, brWidth);
    const end = this._offsetOf(range.endContainer, range.endOffset, brWidth);
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }

  /**
   * The text offset of a DOM position in the open cell (filler breaks
   * count 0).
   * @purity semi-pure-b
   */
  _offsetOf(container, offset, brWidth) {
    let n = 0;
    let done = false;
    /** @purity semi-pure-b */
    const walk = (node) => {
      for (let i = 0; i < node.childNodes.length && !done; i++) {
        if (node === container && i === offset) {
          done = true;
          return;
        }
        const child = node.childNodes[i];
        if (child.nodeType === Node.TEXT_NODE) {
          if (child === container) {
            n += offset;
            done = true;
            return;
          }
          n += child.data.length;
        } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName === "BR") {
          if (!this._fillers.has(child)) n += brWidth;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child);
        }
      }
      if (node === container) done = true;
    };
    walk(this._cell.element);
    return n;
  }

  /**
   * Select [start, end) of the open cell's text.
   * @purity non-pure
   */
  _selectOffsets(start, end, brWidth) {
    const selection = window.getSelection();
    if (!selection || !this._cell) return;
    const a = this._pointAt(start, brWidth);
    const b = this._pointAt(end, brWidth);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /**
   * The DOM position of a text offset in the open cell.
   * @purity semi-pure-b
   * @returns {{node: Node, offset: number}}
   */
  _pointAt(target, brWidth) {
    const root = this._cell.element;
    let left = target;
    let found = null;
    /** @purity semi-pure-b */
    const walk = (node) => {
      for (let i = 0; i < node.childNodes.length && !found; i++) {
        const child = node.childNodes[i];
        if (child.nodeType === Node.TEXT_NODE) {
          if (left <= child.data.length) found = { node: child, offset: left };
          else left -= child.data.length;
        } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName === "BR") {
          if (this._fillers.has(child)) continue;
          if (left === 0) found = { node, offset: i };
          else left -= brWidth;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child);
        }
      }
    };
    walk(root);
    return found ?? { node: root, offset: root.childNodes.length };
  }

  // ---- internals: formats ----

  /**
   * @purity non-pure
   */
  _formatWysiwyg(op, range) {
    return this._writeWysiwyg(InlineRuns.apply(this._runs(), range.start, range.end, op, this._serializeOptions()));
  }

  /**
   * Draw the WYSIWYG cell from new format runs (marked + DOMPurify, INV-47)
   * and check it against them (INV-67 (8)); result.start / end are
   * selected. Nothing changes when result is null or the check fails.
   * @purity non-pure
   * @param {{runs: object[], start: number, end: number}|null} result
   * @returns {boolean} true when it changed
   */
  _writeWysiwyg(result) {
    if (!result) return false;
    const markdown = InlineRuns.serialize(result.runs, this._serializeOptions());
    const cell = this._cell;
    const before = [...cell.element.childNodes];
    const defs = this.orchestrator.getModel().links;
    /** @purity non-pure */
    const written = this.orchestrator.writeHeldInterior(this._session.blockId, () => {
      cell.element.innerHTML = this.renderer.inlineHtml(markdown, defs);
      this.renderer.applyImageGate(cell.element);
    });
    if (!written) return false;
    const links = { map: cell.links, info: [...cell.linkInfo] };
    this._relink(cell, result.runs);
    if (JSON.stringify(InlineRuns.signature(this._runs())) !== JSON.stringify(InlineRuns.signature(result.runs))) {
      // INV-67 (8): marked reads it otherwise; the cell is as it was
      cell.element.replaceChildren(...before);
      cell.links = links.map;
      cell.linkInfo = links.info;
      return false;
    }
    this._markInvisible(cell.element);
    this._selectOffsets(result.start, result.end, 0);
    this._changed();
    return true;
  }

  /**
   * After a rewrite, the cell's a elements stand for the links of the runs
   * in order (INV-72 (a)); an a element whose href is not the next link's
   * (a URL the user typed, which marked made a link) is no link of the runs.
   * @purity non-pure
   */
  _relink(cell, runs) {
    const order = [];
    let previous = null;
    for (const r of runs) {
      if (r.marks.link && r.marks.link !== previous) order.push(r.marks.link);
      previous = r.marks.link;
    }
    const map = new Map();
    const anchors = [...cell.element.querySelectorAll("a")];
    // as many a elements as links: by position (an href DOMPurify took off
    // stays a link); more: the extra ones are URLs the user typed
    const byPosition = anchors.length === order.length;
    let next = 0;
    for (const a of anchors) {
      if (next >= order.length) break;
      if (!byPosition && !TableCellEditor._sameHref(a.getAttribute("href"), order[next].href)) continue;
      let index = cell.linkInfo.indexOf(order[next]);
      if (index < 0) index = cell.linkInfo.push(order[next]) - 1;
      map.set(a, index);
      next++;
    }
    cell.links = map;
  }

  /**
   * An a element's href is the link's (marked writes it URI-encoded).
   * @purity pure
   * @param {string|null} attribute
   * @param {string} href
   * @returns {boolean}
   */
  static _sameHref(attribute, href) {
    if (attribute === href) return true;
    try {
      return attribute === encodeURI(href).replace(/%25/g, "%");
    } catch {
      return false;
    }
  }

  /**
   * @purity non-pure
   */
  _formatRaw(op, range) {
    return this._writeRaw(MarkdownTextOps.formatRange(this._rawText(), range.start, range.end, op, this._rawContext()));
  }

  /**
   * Put a raw cell's new text in (newlines as line breaks) and select
   * edit.selStart / selEnd. Nothing changes when edit is null.
   * @purity non-pure
   * @param {{text: string, selStart: number, selEnd: number}|null} edit
   * @returns {boolean} true when it changed
   */
  _writeRaw(edit) {
    if (!edit) return false;
    const nodes = [];
    const lines = edit.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) nodes.push(document.createElement("br"));
      if (lines[i] !== "") nodes.push(document.createTextNode(lines[i]));
    }
    this._cell.element.replaceChildren(...nodes);
    this._markInvisible(this._cell.element);
    this._selectOffsets(edit.selStart, edit.selEnd, 1);
    this._changed();
    return true;
  }

  // ---- internals: data ----

  /**
   * @purity semi-pure-b
   */
  _colors() {
    return { colors: Object.values(CONFIG.edit.textColors).map((c) => c.light) };
  }

  /**
   * The context of MarkdownTextOps on a raw cell's text.
   * @purity semi-pure-b
   */
  _rawContext() {
    const { lexBlocks, lexInline } = this.orchestrator.textLexers();
    return { lexBlocks, lexInline, colors: this._colors().colors };
  }

  /**
   * INV-72 (a), (d): table cell escapes; a changed URL text keeps the form
   * of an autolink or a bare URL only when it reads back as one; the URL
   * texts taken off a link in this cell stay text (INV-69).
   * @purity semi-pure-b
   */
  _serializeOptions() {
    const { lexInline } = this.orchestrator.textLexers();
    return {
      inTableCell: true,
      literalUrls: this._cell?.literals ?? [],
      /** @purity semi-pure-b */
      isLinkableUrl: (text) => {
        // isLinkableUrl takes no white space, control or invisible character
        // inside (INV-69); the text is written as it is, so none around it either
        if (text !== text.trim() || !ClipboardLink.isLinkableUrl(text, CONFIG.edit.linkSchemes, CONFIG.edit.maxPastedUrlLength)) return false;
        const bare = lexInline(text);
        const angle = lexInline(`<${text}>`);
        return bare.length === 1 && bare[0].type === "link" && bare[0].raw === text && angle.length === 1 && angle[0].type === "link";
      },
    };
  }

  /**
   * @purity semi-pure-b
   */
  _block(blockId) {
    const model = this.orchestrator.getModel();
    const index = model ? model.findIndexById(blockId) : -1;
    return index < 0 ? null : model.getBlocks()[index];
  }

  /**
   * The session's table as data (from the current model), or null.
   * @purity semi-pure-b
   */
  _sessionTable() {
    const block = this._session ? this._block(this._session.blockId) : null;
    if (!block) return null;
    // parsed once per raw: the guards and the palette ask several times
    if (this._parsed?.raw !== block.raw) this._parsed = { raw: block.raw, table: MarkdownTable.parse(block.raw) };
    return this._parsed.table;
  }
}
