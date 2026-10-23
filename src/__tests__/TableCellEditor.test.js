import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return { ...actual, applyTheme: vi.fn(), waitForDOMStability: vi.fn().mockResolvedValue(true) };
});

import { CONFIG } from "../js/config.js";
import MarkdownBlockModel from "../js/classes/MarkdownBlockModel.js";
import MarkdownTable from "../js/classes/MarkdownTable.js";
import TableCellEditor, { fixRawCellText, snapshotNodes } from "../js/classes/TableCellEditor.js";
import InlineRuns from "../js/classes/InlineRuns.js";
import { setupEdit, flush } from "./helpers/editStack.js";
import { pointer, tap, keydown } from "./helpers/editDom.js";

// INV-62 to INV-65, INV-72 (spec 5.14.12). jsdom has no contenteditable
// editing, so typing is a change of the open cell's DOM followed by an
// input event; the DOM copy, the read-back, the state moves and the id kept
// are checked here, the real input in PRT-X01..X05 and the e2e tests.

let s;
afterEach(() => {
  s?.teardown();
  s = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const TABLE = "| Name | Note |\n| --- | --- |\n| Yamada | **bold** |\n| Suzuki | `a\\|b` |";
const DOC = `# T\n\n${TABLE}\n\nAfter.\n`;

const tableBlock = () => s.block((b) => b.type === "table");
const tableEl = () => tableBlock().el.querySelector(":scope > table");
const cellEl = (r, c) => tableEl().rows[r].cells[c];
const tableRaw = () => tableBlock().block.raw;

/** Open cell (r, c) with a tap, as a user does. */
function openCell(r, c) {
  tap(cellEl(r, c));
  return cellEl(r, c);
}

/** Change the open cell's text node at index i (the user typed). */
function typeText(textNode, text) {
  textNode.data = text;
  textNode.parentNode.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Select the text of node from a to b. */
function select(node, a, b) {
  const range = document.createRange();
  range.setStart(node, a);
  range.setEnd(node, b);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("AT-TCE-01 INV-62 (1) the structure check when the table session starts", () => {
  it("counts rows and cells only: a cell whose HTML adds a cell makes the table not editable by cell", async () => {
    s = await setupEdit("| A | B |\n| --- | --- |\n| a</td><td>z | y |\n");
    expect(tableEl().rows[1].cells.length).toBe(3);
    tap(cellEl(0, 0));
    expect(s.bec.isEditingCell()).toBe(false);
    expect(s.editor().value).toContain("| A | B |"); // the table's source instead
    expect(s.host.showToast).toHaveBeenCalledWith(CONFIG.messages.edit.tableNotCellEditable);
  });

  it("does not render every cell: opening one cell of a big table renders that cell only", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => `| r${i} | v${i} |`).join("\n");
    s = await setupEdit(`| A | B |\n| --- | --- |\n${rows}\n`);
    const inline = vi.spyOn(s.markdownRenderer, "inlineHtml");
    openCell(5, 1);
    expect(s.bec.isEditingCell()).toBe(true);
    expect(inline.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("AT-TCE-02 INV-62 (2) a cell opens as rendered (WYSIWYG) or as its text (raw)", () => {
  it("a plain or bold cell opens as rendered, editable plaintext-only, pre-wrap, the caret in it", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 1);
    expect(td.querySelector("strong").textContent).toBe("bold");
    expect(td.classList.contains("grsmd-cell-editing")).toBe(true);
    expect(td.classList.contains("grsmd-cell-raw")).toBe(false);
    expect(td.contentEditable).toBe("plaintext-only");
    expect(td.contains(window.getSelection().anchorNode)).toBe(true);
  });

  it.each([
    ["an image", "![i](https://example.com/a.png)"],
    ["math", "$E=mc^2$"],
    ["inline HTML that is not a format", '<span title="t">x</span>'],
  ])("a cell with %s opens as its text, on the raw background", async (_name, raw) => {
    s = await setupEdit(`| A | B |\n| --- | --- |\n| ${raw} | y |\n`);
    const td = openCell(1, 0);
    expect(td.classList.contains("grsmd-cell-raw")).toBe(true);
    expect(td.textContent).toBe(raw);
  });

  it("an escaped pipe and a pipe in code read back the same: WYSIWYG, and unchanged gives the same source", async () => {
    s = await setupEdit(DOC);
    const td = openCell(2, 1);
    expect(td.classList.contains("grsmd-cell-raw")).toBe(false);
    expect(td.querySelector("code").textContent).toBe("a|b");
    const before = s.orchestrator.getBody();
    pointer(document.body, "pointerdown");
    expect(s.orchestrator.getBody()).toBe(before);
  });
});

describe("AT-TCE-03 closing: unchanged and cancelled cells get their children back; a change is one commit", () => {
  it("typed and deleted back: no change, the very same child nodes come back", async () => {
    s = await setupEdit(DOC);
    const original = cellEl(1, 0).firstChild;
    const td = openCell(1, 0);
    const text = td.firstChild;
    typeText(text, "Yamadaz");
    expect(s.bec.hasUncommittedChange()).toBe(true);
    typeText(text, "Yamada");
    expect(s.bec.hasUncommittedChange()).toBe(false);
    const commit = vi.spyOn(s.orchestrator, "replaceTableBlock");
    pointer(document.body, "pointerdown");
    expect(commit).not.toHaveBeenCalled();
    expect(cellEl(1, 0).firstChild).toBe(original);
  });

  it("Esc applies the cell and ends the table session; the palette stays (W4, owner ruling D1); Undo takes it back", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    typeText(td.firstChild, "changed");
    const e = keydown(td, "Escape");
    expect(e.defaultPrevented).toBe(true);
    expect(s.bec.isEditing()).toBe(false);
    expect(cellEl(1, 0).textContent).toBe("changed");
    expect(tableRaw()).toContain("| changed ");
    expect(s.host.hidePalette).not.toHaveBeenCalled();
    s.bec.dispatch("undoRequested");
    expect(s.orchestrator.getBody()).toBe(DOC);
  });

  it("Undo right after a cell commit, before its render, draws the cell again (the model undone to is the one last rendered)", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    typeText(td.firstChild, "changed");
    s.bec.dispatch("undoRequested"); // applies the cell (written in place), then undoes it
    expect(s.orchestrator.getBody()).toBe(DOC);
    await flush();
    expect(cellEl(1, 0).textContent).toBe("Yamada");
    s.bec.dispatch("redoRequested");
    await flush();
    expect(cellEl(1, 0).textContent).toBe("changed");
  });

  it("Esc on an unchanged cell gives its children back and commits nothing", async () => {
    s = await setupEdit(DOC);
    const original = cellEl(1, 0).firstChild;
    const td = openCell(1, 0);
    keydown(td, "Escape");
    expect(s.bec.isEditing()).toBe(false);
    expect(cellEl(1, 0).firstChild).toBe(original);
    expect(s.orchestrator.canUndo()).toBe(false);
  });

  it("a change: the table aligned with the new cell (INV-61), one undoable unit, the cell drawn in place", async () => {
    s = await setupEdit(DOC);
    const wrapper = tableBlock().el;
    const td = openCell(1, 0);
    typeText(td.firstChild, "Yamada Taro");
    keydown(td, "Tab");
    expect(tableRaw()).toBe("| Name        | Note     |\n| ----------- | -------- |\n| Yamada Taro | **bold** |\n| Suzuki      | `a\\|b`   |");
    expect(cellEl(1, 0).textContent).toBe("Yamada Taro");
    expect(cellEl(1, 0).getAttribute("contenteditable")).toBeNull();
    expect(cellEl(1, 1).classList.contains("grsmd-cell-editing")).toBe(true); // Tab: the next cell
    expect(tableBlock().el).toBe(wrapper);
    expect(s.orchestrator.canUndo()).toBe(true);
  });
});

describe("AT-TCE-04 UIR-01: cells committed one after another keep the table's element and id; Undo per cell (W3)", () => {
  it("two commits: the same wrapper and table element, the next cell opens, Undo takes back the last cell", async () => {
    s = await setupEdit(DOC);
    const wrapper = tableBlock().el;
    const table = tableEl();
    const id = tableBlock().block.id;
    let td = openCell(1, 0);
    typeText(td.firstChild, "A1");
    keydown(td, "Tab");
    td = cellEl(1, 1);
    const strong = td.querySelector("strong");
    typeText(strong.firstChild, "B1");
    keydown(td, "Enter"); // the cell below
    await flush();
    expect(tableBlock().el).toBe(wrapper);
    expect(tableEl()).toBe(table);
    expect(tableBlock().block.id).toBe(id);
    expect(s.bec.isEditingCell()).toBe(true);
    expect(cellEl(2, 1).classList.contains("grsmd-cell-editing")).toBe(true);
    expect(tableRaw()).toContain("| A1     | **B1** |");
    s.bec.dispatch("escapePressed"); // the open cell is unchanged: nothing more
    s.bec.dispatch("undoRequested");
    await flush();
    expect(s.orchestrator.getBody()).toContain("| A1     | **bold** |");
    s.bec.dispatch("undoRequested"); // each cell is a unit of its own (INV-48)
    expect(s.orchestrator.getBody()).toBe(DOC);
    s.bec.dispatch("redoRequested");
    s.bec.dispatch("redoRequested");
    expect(tableRaw()).toContain("| A1     | **B1** |");
  });

  it("a queued partial render does not change the held table's DOM", async () => {
    s = await setupEdit(DOC);
    const table = tableEl();
    const td = openCell(1, 0);
    typeText(td.firstChild, "X");
    keydown(td, "Tab");
    await flush();
    expect(tableEl()).toBe(table);
    expect(s.markdownRenderer.isStale(tableBlock().block.id)).toBe(false);
  });
});

describe("AT-TCE-05 canKeepTableId (11-c): when the table cannot keep its id the session ends with a toast", () => {
  it("the commit is made, the table is not written in place, and editModeIdle follows", async () => {
    s = await setupEdit(DOC);
    const original = MarkdownBlockModel.prototype.planTableReplace;
    vi.spyOn(MarkdownBlockModel.prototype, "planTableReplace").mockImplementation(function (id, raw, lexer, max) {
      const plan = original.call(this, id, raw, lexer, max);
      return { ...plan, keptId: false };
    });
    const write = vi.spyOn(s.orchestrator, "writeHeldInterior");
    const td = openCell(1, 0);
    typeText(td.firstChild, "Changed");
    keydown(td, "Tab");
    expect(s.bec.isEditing()).toBe(false);
    expect(s.orchestrator.getBody()).toContain("Changed");
    expect(write).not.toHaveBeenCalled();
    expect(s.host.showToast).toHaveBeenCalledWith(CONFIG.messages.edit.tableEditEnded);
  });
});

describe("AT-TCE-06 INV-72 the notation of a changed cell", () => {
  it("a reference link keeps its label; a collapsed one whose text changed gets the old text as label", async () => {
    s = await setupEdit("| A |\n| --- |\n| [Suzuki][s] |\n| [Ref][] |\n\n[s]: https://example.com/suzuki\n[ref]: https://example.com/ref\n");
    let td = openCell(1, 0);
    typeText(td.querySelector("a").firstChild, "Suzuki!");
    keydown(td, "Enter");
    td = cellEl(2, 0);
    typeText(td.querySelector("a").firstChild, "Refs");
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("[Suzuki!][s]");
    expect(tableRaw()).toContain("[Refs][Ref]");
  });

  it("an autolink whose text becomes another URL stays an autolink; other text becomes [text](URL)", async () => {
    s = await setupEdit("| A |\n| --- |\n| <https://a.example/> |\n| <https://c.example/> |\n");
    let td = openCell(1, 0);
    typeText(td.querySelector("a").firstChild, "https://b.example/");
    keydown(td, "Enter");
    td = cellEl(2, 0);
    typeText(td.querySelector("a").firstChild, "hello");
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("<https://b.example/>");
    expect(tableRaw()).toContain("[hello](https://c.example/)");
  });

  it("new text is escaped (INV-72 (d)): a pipe, a dollar, an asterisk; an entity becomes its character", async () => {
    s = await setupEdit("| A |\n| --- |\n| x &amp; y |\n");
    const td = openCell(1, 0);
    typeText(td.firstChild, "a|b $5 *c*");
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("a\\|b \\$5 \\*c\\*");
  });

  it("AT-TCE-30 INV-72 (b): a changed cell writes character references as characters (&nbsp; as U+00A0)", async () => {
    s = await setupEdit("| A |\n| --- |\n| x &amp; y&nbsp;z &#169; |\n");
    const td = openCell(1, 0);
    expect(td.classList.contains("grsmd-cell-raw")).toBe(false);
    // change only the first text node: the references around stay as they were opened
    const first = [...td.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
    typeText(first, first.data.replace("x", "w"));
    pointer(document.body, "pointerdown");
    const cell = tableRaw().split("\n")[2];
    expect(cell).toContain("w \\& y\u00a0z \u00a9");
    expect(cell).not.toMatch(/&(amp|nbsp|#169);/);
  });

  it("PRT-X17: an img tag typed as text stays text, written escaped; no img element is made", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    typeText(td.firstChild, "<img src=x onerror=alert(1)>");
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("\\<img src=x onerror=alert(1)>");
    expect(cellEl(1, 0).querySelector("img")).toBeNull();
    expect(cellEl(1, 0).textContent).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("AT-TCE-07 raw cells: INV-63's fixes only (ruling L2)", () => {
  it("fixRawCellText escapes unescaped pipes and turns newlines into <br>, nothing else", () => {
    expect(fixRawCellText("a|b\\|c\\\\|d\ne")).toBe("a\\|b\\|c\\\\\\|d<br>e");
    expect(fixRawCellText("$x$ *y*")).toBe("$x$ *y*");
  });

  it("a raw cell commits its text with the fixes; Shift+Enter is a line break", async () => {
    s = await setupEdit("| A |\n| --- |\n| $x$ |\n");
    const td = openCell(1, 0);
    typeText(td.firstChild, "$y$|z");
    select(td.firstChild, 3, 3);
    const e = keydown(td, "Enter", { shiftKey: true });
    expect(e.defaultPrevented).toBe(true);
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("| $y$<br>\\|z |");
  });
});

describe("AT-TCE-08 INV-63 input, paste and drop", () => {
  it("beforeinput: only the listed input types go through", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    const fire = (inputType) => {
      const e = new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true });
      td.dispatchEvent(e);
      return e.defaultPrevented;
    };
    for (const t of [
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
    ]) {
      expect(fire(t), t).toBe(false);
    }
    for (const t of ["insertParagraph", "insertLineBreak", "insertFromPaste", "insertFromDrop", "insertFromYank", "insertLink", "formatBold", "historyUndo", "historyRedo"]) {
      expect(fire(t), t).toBe(true);
    }
  });

  it("paste: text/plain only, newlines as spaces; the HTML (with an image) is not used", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    select(td.firstChild, 6, 6);
    const e = new Event("paste", { bubbles: true, cancelable: true });
    const getData = vi.fn((type) => (type === "text/plain" ? "a\nb" : '<img src="https://evil.example/x.png">'));
    Object.defineProperty(e, "clipboardData", { value: { getData } });
    td.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(getData).toHaveBeenCalledWith("text/plain");
    expect(getData).not.toHaveBeenCalledWith("text/html");
    expect(td.textContent).toBe("Yamadaa b");
    expect(td.querySelector("img")).toBeNull();
  });

  it("a text drop is stopped; a file drop goes on (INV-17)", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    const drop = (types) => {
      const e = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(e, "dataTransfer", { value: { types } });
      td.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(drop(["text/plain"])).toBe(true);
    expect(drop(["Files"])).toBe(false);
  });
});

describe("AT-TCE-09 INV-64 keys in a cell (all preventDefault()ed)", () => {
  it("Tab, Shift+Tab move right / left across rows; nothing at the first and the last cell", async () => {
    s = await setupEdit(DOC);
    let td = openCell(1, 1);
    expect(keydown(td, "Tab").defaultPrevented).toBe(true);
    expect(cellEl(2, 0).classList.contains("grsmd-cell-editing")).toBe(true);
    td = cellEl(2, 0);
    expect(keydown(td, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(cellEl(1, 1).classList.contains("grsmd-cell-editing")).toBe(true);
    s.bec.dispatch("escapePressed");
    td = openCell(0, 0);
    // the first cell: nothing, and the key is still taken (focus stays in the cell)
    expect(keydown(td, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(cellEl(0, 0).classList.contains("grsmd-cell-editing")).toBe(true);
    s.bec.dispatch("escapePressed");
    td = openCell(2, 1);
    expect(keydown(td, "Tab").defaultPrevented).toBe(true); // the last cell: nothing (no row is added)
    expect(cellEl(2, 1).classList.contains("grsmd-cell-editing")).toBe(true);
    expect(tableEl().rows.length).toBe(3);
  });

  it("Enter moves down; on the last row it ends the table session; Ctrl / Alt / Meta + Enter do nothing", async () => {
    s = await setupEdit(DOC);
    let td = openCell(1, 0);
    for (const mod of ["ctrlKey", "altKey", "metaKey"]) {
      expect(keydown(td, "Enter", { [mod]: true }).defaultPrevented).toBe(true);
      expect(cellEl(1, 0).classList.contains("grsmd-cell-editing")).toBe(true);
    }
    keydown(td, "Enter");
    td = cellEl(2, 0);
    expect(td.classList.contains("grsmd-cell-editing")).toBe(true);
    keydown(td, "Enter");
    expect(s.bec.isEditing()).toBe(false);
  });

  it("AT-TCE-28 ArrowUp / ArrowDown (and Left / Right) are the browser's: not taken, the cell stays open (INV-64)", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      expect(keydown(td, key).defaultPrevented, key).toBe(false);
      expect(cellEl(1, 0).classList.contains("grsmd-cell-editing"), key).toBe(true);
    }
  });

  it("Shift+Enter puts a line break at the caret (with a filler at the end); it is read as one break", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    select(td.firstChild, 6, 6);
    keydown(td, "Enter", { shiftKey: true });
    expect(td.querySelectorAll("br").length).toBe(2); // the break and the filler
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("| Yamada<br> |");
  });

  it("Redo (Ctrl+Shift+Z, Ctrl+Y) is stopped and asks 11-c for redoRequested: a changed cell stays as it is; Ctrl+Z, Ctrl+B are left to the document (INV-59, D7)", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    typeText(td.firstChild, "changed");
    const dispatch = vi.spyOn(s.bec, "dispatch");
    expect(keydown(td, "z", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(keydown(td, "y", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual(["redoRequested", "redoRequested"]);
    expect(s.bec.isEditingCell()).toBe(true); // a changed cell: nothing to redo (R2)
    expect(td.textContent).toBe("changed");
    // a held key acts once
    expect(keydown(td, "y", { ctrlKey: true, repeat: true }).defaultPrevented).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(keydown(td, "z", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(keydown(td, "b", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(s.bec.isEditingCell()).toBe(true);
  });

  it("Redo in an unchanged cell ends the table session and redoes the last undone unit (R2)", async () => {
    s = await setupEdit(DOC);
    let td = openCell(1, 0);
    typeText(td.firstChild, "changed");
    keydown(td, "Escape");
    s.bec.dispatch("undoRequested");
    expect(s.orchestrator.getBody()).toBe(DOC);
    td = openCell(1, 1);
    keydown(td, "y", { ctrlKey: true });
    expect(s.bec.isEditing()).toBe(false);
    expect(tableRaw()).toContain("| changed ");
  });

  it("during IME composition the keys are left alone", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    td.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(keydown(td, "Enter").defaultPrevented).toBe(false);
    expect(keydown(td, "Escape").defaultPrevented).toBe(false);
    s.bec.dispatch("escapePressed"); // isImeIdle false: nothing
    expect(s.bec.isEditingCell()).toBe(true);
    td.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    expect(keydown(td, "Escape").defaultPrevented).toBe(true);
    expect(s.bec.isEditing()).toBe(false);
  });
});

describe("AT-TCE-10 INV-65 row and column operations", () => {
  const op = (kind, value) => s.bec.dispatch("tableOperationRequested", { op: { kind, value } });

  it("Insert row below and open the same column of it; from the header, the first body row", async () => {
    s = await setupEdit(DOC);
    openCell(0, 1);
    op("insertRow");
    expect(tableEl().rows.length).toBe(4);
    expect(cellEl(1, 1).classList.contains("grsmd-cell-editing")).toBe(true);
    expect(MarkdownBlockModel.toEditableText(tableRaw()).split("\n")[2]).toMatch(/^\|\s+\|\s+\|$/);
  });

  it("Delete row opens the cell above; the header row cannot be deleted (D2)", async () => {
    s = await setupEdit(DOC);
    openCell(2, 0);
    op("deleteRow");
    expect(tableEl().rows.length).toBe(2);
    expect(cellEl(1, 0).classList.contains("grsmd-cell-editing")).toBe(true);
    s.bec.dispatch("escapePressed");
    openCell(0, 0);
    const before = tableRaw();
    op("deleteRow");
    expect(tableRaw()).toBe(before);
    expect(cellEl(0, 0).classList.contains("grsmd-cell-editing")).toBe(true);
  });

  it("Insert column right (default alignment) and open it; Delete column opens the one on the left; the only column stays", async () => {
    s = await setupEdit(DOC);
    openCell(1, 0);
    op("insertColumn");
    expect(tableEl().rows[0].cells.length).toBe(3);
    expect(cellEl(1, 1).classList.contains("grsmd-cell-editing")).toBe(true);
    op("deleteColumn");
    expect(tableEl().rows[0].cells.length).toBe(2);
    expect(cellEl(1, 0).classList.contains("grsmd-cell-editing")).toBe(true);
    s.teardown();
    // AT-TCE-29: Delete column on the first column opens the new first column
    s = await setupEdit("| A | B |\n| --- | --- |\n| x | y |\n");
    openCell(1, 0);
    op("deleteColumn");
    expect(tableEl().rows[0].cells.length).toBe(1);
    expect(tableEl().rows[0].cells[0].textContent).toBe("B");
    expect(cellEl(1, 0).classList.contains("grsmd-cell-editing")).toBe(true);
    expect(s.bec.cellState()).toMatchObject({ row: 1, col: 0, columns: 1 });
    s.teardown();
    s = await setupEdit("| A |\n| --- |\n| x |\n");
    openCell(1, 0);
    op("deleteColumn");
    expect(tableEl().rows[0].cells.length).toBe(1);
  });

  it("Alignment sets the delimiter of the column and keeps the cell; each operation is one undoable unit", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 1);
    typeText(td.querySelector("strong").firstChild, "B");
    op("align", "center");
    expect(tableRaw().split("\n")[1]).toMatch(/^\| -+ \| :-+: \|$/);
    expect(tableRaw()).toContain("**B**");
    expect(cellEl(1, 1).classList.contains("grsmd-cell-editing")).toBe(true);
    expect(s.bec.cellState()).toMatchObject({ row: 1, col: 1, alignment: "center", columns: 2 });
    s.bec.dispatch("escapePressed");
    s.bec.dispatch("undoRequested");
    expect(tableRaw().split("\n")[1]).toMatch(/^\| -+ \| -+ \|$/); // the alignment is undone
    expect(tableRaw()).toContain("**B**"); // the cell commit stays (its own unit, overwritten)
  });
});

describe("AT-TCE-11 formats in a cell (INV-66 / 67)", () => {
  it("Bold on a selected word of a WYSIWYG cell shows it bold, and commits **", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    select(td.firstChild, 0, 3);
    expect(s.bec.canFormatSelection()).toBe(true);
    expect(s.bec.formatSelection({ kind: "strong" })).toBe(true);
    expect(td.querySelector("strong").textContent).toBe("Yam");
    expect(s.bec.isEditingCell()).toBe(true);
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("**Yam**ada");
  });

  it("a color on a WYSIWYG cell is a palette span, read back as the color", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    select(td.firstChild, 0, 6);
    s.bec.formatSelection({ kind: "color", value: CONFIG.edit.textColors.blue.light });
    expect(td.querySelector("span[style]").getAttribute("style")).toBe("color: #0550AE");
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain('<span style="color: #0550AE">Yamada</span>');
  });

  it("no selection or a selection outside the cell: formats are off", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    select(td.firstChild, 2, 2);
    expect(s.bec.canFormatSelection()).toBe(false);
    select(document.querySelector("h1").firstChild, 0, 1);
    expect(s.bec.canFormatSelection()).toBe(false);
  });
});

describe("AT-TCE-12 INV-70 marks in a cell", () => {
  it("a no-break space is marked while editing, written as the character, and the mark is gone after", async () => {
    s = await setupEdit("| A |\n| --- |\n| a\u00a0b |\n");
    const td = openCell(1, 0);
    const mark = td.querySelector("span.grsmd-invisible");
    expect(mark.textContent).toBe("\u00a0");
    typeText(td.lastChild, "bc");
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("| a\u00a0bc |");
    expect(cellEl(1, 0).querySelector(".grsmd-invisible")).toBeNull();
  });

  it("snapshotNodes reads a mark as its text, a palette span by its style, an a element by reference only", () => {
    const root = document.createElement("td");
    root.innerHTML = '<span class="grsmd-invisible">x</span><a href="u">l</a><span style="color: #0550AE">c</span><i>e</i>';
    const marks = new WeakSet([root.firstChild]);
    const tree = snapshotNodes(root, { links: new Map(), marks, fillers: new WeakSet() });
    expect(tree.map((n) => n.kind)).toEqual(["mark", "a", "span", "em"]);
    expect(tree[1].link).toBeNull(); // not there when the cell opened: no link
    expect(tree[2].style).toBe("color: #0550AE");
  });
});

describe("AT-TCE-13 the table tab and the margin (INV-29 (b) (c), W6 / M1)", () => {
  it("the tab opens the table's source; a press on the margin while a cell is open ends the session", async () => {
    s = await setupEdit(DOC);
    const tab = tableBlock().el.querySelector(":scope > .grsmd-table-tab");
    expect(s.markdownRenderer.isTableTab(tab)).toBe(true);
    tap(tab);
    expect(s.editor().value).toContain("| Name | Note |");
    keydown(s.editor(), "Escape");
    openCell(1, 0);
    tap(tableBlock().el); // the block's margin: outside
    expect(s.bec.isEditing()).toBe(false);
  });

  it("a span the document writes with the tab's class does nothing", async () => {
    s = await setupEdit('<span class="grsmd-table-tab">Markdown</span>\n\n' + DOC);
    const fake = s.preview.querySelector("p > span.grsmd-table-tab");
    expect(fake).not.toBeNull();
    expect(s.markdownRenderer.isTableTab(fake)).toBe(false);
    const own = tableBlock().el.querySelector(":scope > .grsmd-table-tab");
    expect(s.markdownRenderer.isTableTab(own)).toBe(true);
    tap(fake);
    expect(s.editor().value).toContain('<span class="grsmd-table-tab">'); // its own paragraph opens, not a table
  });

  it("cellAt finds a cell by reference, not a cell of a table nested in it", () => {
    const outer = document.createElement("table");
    outer.innerHTML = "<tbody><tr><td>a</td><td><table><tbody><tr><td>in</td></tr></tbody></table></td></tr></tbody>";
    const inner = outer.querySelector("td table td");
    expect(TableCellEditor.cellAt(outer, inner)).toEqual({ row: 0, col: 1 });
    expect(TableCellEditor.cellAt(outer, outer.rows[0].cells[0].firstChild)).toEqual({ row: 0, col: 0 });
  });
});

describe("AT-TCE-14 unsaved and hasUncommittedChange (INV-21 b')", () => {
  it("an open cell with a change counts as an uncommitted change; editing state follows", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    expect(s.bec.isEditing()).toBe(true);
    expect(s.bec.isEditingCell()).toBe(true);
    expect(s.bec.isCellElement(td.firstChild)).toBe(true);
    expect(s.bec.hasUncommittedChange()).toBe(false);
    typeText(td.firstChild, "x");
    expect(s.bec.hasUncommittedChange()).toBe(true);
    expect(s.host.onEditorInput).toHaveBeenCalled();
  });

  it("documentReplaced drops the cell without a commit", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    typeText(td.firstChild, "x");
    const commit = vi.spyOn(s.orchestrator, "replaceTableBlock");
    s.bec.dispatch("documentReplaced");
    expect(commit).not.toHaveBeenCalled();
    expect(s.bec.isEditing()).toBe(false);
    expect(cellEl(1, 0).textContent).toBe("Yamada");
  });

  it("AT-TCE-24 the end of the table session drops the table's data (5.15.7, review P-6)", async () => {
    s = await setupEdit(DOC);
    const cells = s.bec._cells;
    openCell(1, 0);
    expect(cells._parsed).not.toBe(null);
    s.bec.dispatch("documentReplaced");
    expect(cells._parsed).toBe(null);
    expect(cells._lastPosition).toBe(null);
  });
});

describe("AT-TCE-25..27 the external image gate after a write in place (INV-47, INV-43; review S-2)", () => {
  const IMG = "https://img.example/a.png";
  // no image that loads from outside; the gate's placeholders stand for them
  const loaded = () => [...tableEl().querySelectorAll("img")].filter((img) => /^https?:/.test(img.getAttribute("src") ?? ""));
  const held = () => tableEl().querySelectorAll("img");
  const placeholders = () => tableEl().querySelectorAll(".external-image-placeholder");

  it("AT-TCE-25 a raw cell whose image is changed and committed shows a placeholder, not the image", async () => {
    s = await setupEdit(`| A | B |\n| --- | --- |\n| ![i](${IMG}) | y |\n`);
    expect(placeholders()).toHaveLength(1);
    const td = openCell(1, 0);
    expect(td.classList.contains("grsmd-cell-raw")).toBe(true);
    typeText(td.firstChild, "![j](https://img.example/b.png) and ![k](https://img.example/c.png)");
    keydown(td, "Tab");
    expect(tableRaw()).toContain("b.png");
    expect(loaded()).toEqual([]);
    expect(held()).toHaveLength(0);
    expect(placeholders()).toHaveLength(2);
  });

  it("AT-TCE-26 INV-65 on a table with images: new rows and a table drawn again keep the gate", async () => {
    s = await setupEdit(`| ![h](${IMG}) | B |\n| --- | --- |\n| x | ![i](${IMG}) |\n`);
    expect(placeholders()).toHaveLength(2);
    openCell(1, 0);
    s.bec.dispatch("tableOperationRequested", { op: { kind: "insertRow" } });
    expect(tableEl().rows).toHaveLength(3);
    expect(loaded()).toEqual([]);
    expect(placeholders()).toHaveLength(2);
    s.bec.dispatch("tableOperationRequested", { op: { kind: "align", value: "center" } });
    expect(loaded()).toEqual([]);
    expect(placeholders()).toHaveLength(2);
    // the only body row left goes: marked writes the table again (no tbody)
    s.bec.dispatch("tableOperationRequested", { op: { kind: "deleteRow" } });
    s.bec.dispatch("tableOperationRequested", { op: { kind: "deleteRow" } });
    expect(tableEl().rows).toHaveLength(1);
    expect(tableEl().tBodies).toHaveLength(0);
    expect(loaded()).toEqual([]);
    expect(held()).toHaveLength(0);
    keydown(tableEl().querySelector(".grsmd-cell-editing"), "Escape"); // the header cell opened as its text
    expect(placeholders()).toHaveLength(1);
  });

  it("AT-TCE-27 a WYSIWYG cell written again on commit loads no image (typed image syntax stays text)", async () => {
    s = await setupEdit(`| A | B |\n| --- | --- |\n| **b** | y |\n`);
    const td = openCell(1, 0);
    expect(td.classList.contains("grsmd-cell-raw")).toBe(false);
    typeText(td.querySelector("strong").firstChild, `b ![i](${IMG})`);
    // the written HTML still goes through the gate (defence in depth: here the syntax is escaped)
    const gate = vi.spyOn(s.markdownRenderer, "applyImageGate");
    keydown(td, "Tab");
    expect(gate).toHaveBeenCalledWith(cellEl(1, 0));
    expect(tableRaw()).toContain("!\\[i\\](");
    expect(loaded()).toEqual([]);
    expect(held()).toHaveLength(0);
    expect(cellEl(1, 0).textContent).toContain("![i]");
  });
});

describe("AT-TCE-31..34 how a cell opens: footnotes raw, formats in any nesting as rendered (owner ruling 2026-10-22, PRT-X02)", () => {
  const RED = CONFIG.edit.textColors.red.light;
  const isRaw = (td) => td.classList.contains("grsmd-cell-raw");

  it("AT-TCE-31 a cell with a footnote reference opens as its text and keeps it", async () => {
    s = await setupEdit("| Kind | Cell |\n| --- | --- |\n| note | text[^1] |\n\n[^1]: the note\n");
    const td = openCell(1, 1);
    expect(isRaw(td)).toBe(true);
    expect(td.textContent).toBe("text[^1]");
    typeText(td.firstChild, "text[^1]!");
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("| text[^1]! |");
    // an escaped one is no footnote: as rendered
    s.teardown();
    s = await setupEdit("| A |\n| --- |\n| text\\[^1] |\n");
    expect(isRaw(openCell(1, 0))).toBe(false);
    // an escaped backslash before it: a footnote reference again (review L2)
    s.teardown();
    s = await setupEdit("| A |\n| --- |\n| text\\\\[^1] |\n\n[^1]: the note\n");
    expect(isRaw(openCell(1, 0))).toBe(true);
  });

  it.each([
    ["bold outside a color", `**<span style="color: ${RED}">word</span>**`],
    ["italic outside a link", "*[word](https://example.com/)*"],
    ["bold and italic outside a color, part of the text", `a ***<span style="color: ${RED}">word</span>*** b`],
  ])("AT-TCE-32 %s: opens as rendered; unchanged, the source stays as written", async (_name, cell) => {
    s = await setupEdit(`| A |\n| --- |\n| ${cell} |\n`);
    const before = tableRaw();
    const td = openCell(1, 0);
    expect(isRaw(td)).toBe(false);
    expect(td.textContent).toContain("word");
    keydown(td, "Tab"); // the last cell: stays; then out
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toBe(before);
  });

  it("AT-TCE-33 changed, such a cell is written in the normal form with the same formats", async () => {
    s = await setupEdit(`| A |\n| --- |\n| **<span style="color: ${RED}">word</span>** |\n`);
    const td = openCell(1, 0);
    const text = td.querySelector("span").firstChild;
    typeText(text, "words");
    pointer(document.body, "pointerdown");
    const cell = cellEl(1, 0);
    expect(cell.querySelector("strong")?.textContent).toBe("words");
    expect(cell.querySelector(`span[style="color: ${RED}"]`)?.textContent).toBe("words");
    expect(tableRaw()).not.toContain(`**<span style="color: ${RED}">word</span>**`);
  });

  it.each([
    ["an HTML comment (review CR-2)", "a <!-- secret --> b"],
    ["a comment beside a format", "**x** <!--c-->"],
    ["a format element with another attribute (review CR-3)", '<strong title="t">x</strong>'],
    ["a color span with another attribute", `**<span style="color: ${RED}" class="k">word</span>**`],
    ["a color not in the palette's notation", "**<span style=\"color:#CF222E\">word</span>**"],
    ["another element inside", `**<span style="color: ${RED}">H<sub>2</sub>O</span>**`],
    ["a strikethrough in another nesting", `~~<span style="color: ${RED}">word</span>~~`],
  ])("AT-TCE-34 %s: still opens as its text (nothing would be lost)", async (_name, cell) => {
    s = await setupEdit(`| A |\n| --- |\n| ${cell} |\n`);
    expect(isRaw(openCell(1, 0))).toBe(true);
  });

  it("AT-TCE-36 a raw cell with a comment, changed and committed, keeps the comment (review CR-2)", async () => {
    s = await setupEdit("| A |\n| --- |\n| a <!-- secret --> b |\n");
    const td = openCell(1, 0);
    typeText(td.firstChild, `${td.firstChild.data}!`);
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("a <!-- secret --> b!");
  });
});

describe("AT-TCE-35 no link from a paste during IME composition, as in the block editor (review FX-2)", () => {
  it("the paste goes in as text (INV-63) and nothing becomes a link", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    select(td.firstChild, 0, 6);
    td.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const e = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "clipboardData", { value: { getData: (type) => (type === "text/plain" ? "https://u.example/" : "") } });
    td.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(td.querySelector("a")).toBe(null);
    expect(td.textContent).toBe("https://u.example/");
  });
});

describe("AT-TCE-15 pipes of a link in a cell are written escaped (INV-69, INV-72 (d))", () => {
  it("a link whose destination has \\| keeps it escaped when its text changes; the table is not split", async () => {
    s = await setupEdit("| A |\n| --- |\n| [a](https://x.example/?q=1\\|2) b |\n");
    const td = openCell(1, 0);
    typeText(td.lastChild, " bc");
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("[a](https://x.example/?q=1\\|2) bc");
    expect(tableEl().rows[1].cells.length).toBe(1);
    expect(cellEl(1, 0).querySelector("a").getAttribute("href")).toBe("https://x.example/?q=1%7C2");
  });

  it("a bare URL whose text becomes a URL with a pipe stays one link, written with \\|", async () => {
    s = await setupEdit("| A |\n| --- |\n| https://y.example/ |\n");
    const td = openCell(1, 0);
    typeText(td.querySelector("a").firstChild, "https://y.example/?a|b");
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("https://y.example/?a\\|b");
    expect(cellEl(1, 0).querySelector("a").getAttribute("href")).toBe("https://y.example/?a%7Cb");
  });

  it("InlineRuns.escapeCellPipes escapes only unescaped pipes, and only in a cell", () => {
    expect(InlineRuns.escapeCellPipes("a|b\\|c\\\\|d", { inTableCell: true })).toBe("a\\|b\\|c\\\\\\|d");
    expect(InlineRuns.escapeCellPipes("a|b", {})).toBe("a|b");
  });
});

describe("AT-TCE-16 a format that does not read back keeps the cell and its links as they were (INV-67 (8))", () => {
  it("the check fails: the DOM and the link references come back; a later commit keeps the link", async () => {
    s = await setupEdit("| A |\n| --- |\n| x [a](https://e.example/) |\n");
    const td = openCell(1, 0);
    const before = [...td.childNodes];
    vi.spyOn(InlineRuns, "signature").mockReturnValueOnce(["no"]);
    select(td.firstChild, 0, 1);
    expect(s.bec.formatSelection({ kind: "strong" })).toBe(false);
    expect([...td.childNodes]).toEqual(before);
    typeText(td.querySelector("a").firstChild, "ab");
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("x [ab](https://e.example/)");
  });

  it("a URL the user typed before a link does not take the link's place after a format", async () => {
    s = await setupEdit("| A |\n| --- |\n| x [a](https://e.example/) |\n");
    const td = openCell(1, 0);
    typeText(td.firstChild, "www.typed.example x ");
    select(td.querySelector("a").firstChild, 0, 1);
    expect(s.bec.formatSelection({ kind: "strong" })).toBe(true);
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("[**a**](https://e.example/)");
  });
});

describe("AT-TCE-17 a tapped table that the commit before took away (11-c, INV-46)", () => {
  it("touch: editingBlock -> cellTapped after a commit that swallowed the table: nothing opens, no toast, no error", async () => {
    s = await setupEdit("Para.\n\n| A |\n| --- |\n| x |\n");
    tap(s.block((b) => b.raw.startsWith("Para")).el.firstElementChild);
    s.editor().value = "```\nPara.";
    const td = cellEl(1, 0);
    expect(() => tap(td, { pointerType: "touch" })).not.toThrow();
    expect(s.bec.isEditing()).toBe(false);
    expect(s.host.showToast).not.toHaveBeenCalled();
    await flush();
    tap(s.block(() => true).el.firstElementChild); // the controller still works: editModeIdle
    expect(s.bec.isEditing()).toBe(true);
  });

  it("mouse: the commit at pointerdown took the table away: the tap opens nothing and shows no toast", async () => {
    s = await setupEdit("Para.\n\n| A |\n| --- |\n| x |\n");
    tap(s.block((b) => b.raw.startsWith("Para")).el.firstElementChild);
    s.editor().value = "```\nPara.";
    tap(cellEl(1, 0));
    expect(s.bec.isEditing()).toBe(false);
    expect(s.host.showToast).not.toHaveBeenCalled();
  });

  it("a cell or the tab tapped while a block above is open keeps the table's place (INV-46)", async () => {
    s = await setupEdit("Para.\n\n| A |\n| --- |\n| x |\n");
    tap(s.block((b) => b.raw.startsWith("Para")).el.firstElementChild);
    s.editor().value = "Para.\n\nMore.";
    const restore = vi.spyOn(s.scrollMemento, "restoreAnchor");
    const retarget = vi.spyOn(s.orchestrator, "retargetPendingAnchor");
    const wrapper = tableBlock().el;
    tap(cellEl(1, 0), { pointerType: "touch" });
    expect(s.bec.isEditingCell()).toBe(true);
    expect(restore).toHaveBeenCalledWith(expect.anything(), wrapper);
    expect(retarget).toHaveBeenCalledWith(tableBlock().block.id);
  });
});

describe("AT-TCE-18 small cases", () => {
  it("Shift+Enter without a selection in the cell does nothing and does not throw", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    window.getSelection().removeAllRanges();
    expect(() => keydown(td, "Enter", { shiftKey: true })).not.toThrow();
    expect(td.querySelector("br")).toBeNull();
  });

  it("the alignment the column has already changes nothing and records no unit; the cell stays open", async () => {
    s = await setupEdit("| A |\n|--|\n| x |\n"); // not aligned: a change would reformat it
    openCell(1, 0);
    const before = tableRaw();
    s.bec.dispatch("tableOperationRequested", { op: { kind: "align", value: "none" } });
    expect(tableRaw()).toBe(before);
    expect(s.orchestrator.canUndo()).toBe(false);
    expect(cellEl(1, 0).classList.contains("grsmd-cell-editing")).toBe(true);
  });
});

describe("AT-TCE-19 INV-65 in place: the table element ends as a full render of the new text would draw it", () => {
  /** Rows, cells, alignment and content, without the whitespace between tags. */
  const shape = (table) =>
    [...table.rows].map((r) => [...r.cells].map((c) => `${c.tagName}|${c.getAttribute("align") ?? ""}|${c.innerHTML}`));
  const fresh = () => {
    const template = document.createElement("template");
    template.innerHTML = s.markdownRenderer.blockHtml(tableRaw(), s.orchestrator.getModel().links).html;
    return template.content.querySelector("table");
  };
  const op = (kind, value) => s.bec.dispatch("tableOperationRequested", { op: { kind, value } });

  it.each([
    ["insertRow from the header", 0, 1, ["insertRow"]],
    ["insertRow from a body row", 2, 0, ["insertRow"]],
    ["deleteRow", 2, 1, ["deleteRow"]],
    ["insertColumn", 1, 0, ["insertColumn"]],
    ["deleteColumn", 1, 1, ["deleteColumn"]],
    ["align right then none", 1, 1, ["align:right", "align:none"]],
    ["insertColumn then align center", 1, 0, ["insertColumn", "align:center"]],
  ])("%s", async (_name, r, c, ops) => {
    s = await setupEdit(DOC);
    const table = tableEl();
    openCell(r, c);
    for (const o of ops) {
      const [kind, value] = o.split(":");
      op(kind, value);
    }
    s.bec.dispatch("escapePressed"); // the reopened cell, unchanged
    expect(tableEl()).toBe(table); // written in place: the same element
    expect(shape(tableEl())).toEqual(shape(fresh()));
  });

  it("deleting the last body row draws the whole table again (marked writes no tbody then)", async () => {
    s = await setupEdit("| A | B |\n| --- | --- |\n| x | y |\n");
    openCell(1, 0);
    op("deleteRow");
    s.bec.dispatch("escapePressed");
    expect(tableEl().tBodies.length).toBe(fresh().tBodies.length);
    expect(shape(tableEl())).toEqual(shape(fresh()));
  });
});

describe("AT-TCE-20 a link whose href DOMPurify took off still takes a format (INV-72 (a))", () => {
  it("the a elements are matched by position when there are as many as links", async () => {
    s = await setupEdit("| A |\n| --- |\n| [x](javascript:alert(1)) y |\n");
    const td = openCell(1, 0);
    expect(td.querySelector("a").hasAttribute("href")).toBe(false);
    expect(td.classList.contains("grsmd-cell-raw")).toBe(false);
    select(td.lastChild, 1, 2);
    expect(s.bec.formatSelection({ kind: "strong" })).toBe(true);
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("[x](javascript:alert(1)) **y**");
    expect(cellEl(1, 0).querySelector("a").hasAttribute("href")).toBe(false);
  });
});

describe("AT-TCE-21 spaces typed at the ends of a cell (INV-61, INV-62)", () => {
  const freshCell = (r, c) => {
    const template = document.createElement("template");
    template.innerHTML = s.markdownRenderer.blockHtml(tableRaw(), s.orchestrator.getModel().links).html;
    return template.content.querySelector("table").rows[r].cells[c].innerHTML;
  };

  it.each([
    ["at the end", "Yamada X  "],
    ["at the start", "  Yamada X"],
    ["tabs at both ends", "\tYamada X\t"],
  ])("%s: the cell is drawn as a full render draws it, opens WYSIWYG again, and the table is aligned once", async (_name, typed) => {
    s = await setupEdit(DOC);
    let td = openCell(1, 0);
    typeText(td.firstChild, typed);
    keydown(td, "Tab");
    expect(tableRaw()).toContain("| Yamada X | **bold** |");
    expect(cellEl(1, 0).innerHTML).toBe(freshCell(1, 0));
    s.bec.dispatch("escapePressed");
    // aligned once: formatting it again changes nothing
    expect(MarkdownTable.format(MarkdownTable.parse(tableRaw()))).toBe(tableRaw());
    td = openCell(1, 0);
    expect(td.classList.contains("grsmd-cell-raw")).toBe(false);
  });

  it("a no-break space or an ideographic space at the end is content and stays", async () => {
    s = await setupEdit(DOC);
    const td = openCell(1, 0);
    typeText(td.firstChild, "Yamada\u3000");
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("| Yamada\u3000 |");
  });

  it("only spaces typed after the text: no change, the children come back", async () => {
    s = await setupEdit(DOC);
    const original = cellEl(1, 0).firstChild;
    const td = openCell(1, 0);
    typeText(td.firstChild, "Yamada   ");
    expect(s.bec.hasUncommittedChange()).toBe(false);
    pointer(document.body, "pointerdown");
    expect(cellEl(1, 0).firstChild).toBe(original);
  });
});
