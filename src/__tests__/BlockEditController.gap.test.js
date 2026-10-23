import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return { ...actual, applyTheme: vi.fn(), waitForDOMStability: vi.fn().mockResolvedValue(true) };
});

import { CONFIG } from "../js/config.js";
import { setupEdit, flush } from "./helpers/editStack.js";
import { pointer, tap, keydown } from "./helpers/editDom.js";

// INV-73 (owner ruling B1): a new block from a gap between blocks. The empty
// gap editor and the unit of Undo follow the Esc / Undo agreement (D1, D3,
// D9; coordinator ruling): Esc applies, an empty one changes nothing, and one
// Undo takes the new block away.

const DOC = "# Title\n\nHello world.\n\n```mermaid\nflowchart TD\n  A --> B\n```\n";

let s;
afterEach(() => {
  s?.teardown();
  s = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelectorAll(".grsmd-gap-insert").forEach((el) => el.remove());
});

const idOf = (start) => s.block((b) => b.raw.startsWith(start)).block.id;
const gapAfter = (start) => {
  const blocks = s.orchestrator.getModel().getBlocks();
  const i = start === null ? -1 : blocks.findIndex((b) => b.raw.startsWith(start));
  return { kind: "gap", afterBlockId: i < 0 ? null : blocks[i].id, beforeBlockId: blocks[i + 1]?.id ?? null };
};
const gapEditor = () => s.preview.querySelector(":scope > .md-block-gap");

function type(text) {
  const ta = s.editor();
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return ta;
}

describe("AT-BSM-29 gapInsertRequested: an empty editor in the gap", () => {
  it("after the last block (a diagram): typed text goes in as a new block below it, with a blank line between", async () => {
    s = await setupEdit(DOC);
    s.bec.dispatch("gapInsertRequested", gapAfter("```mermaid"));
    const ta = s.editor();
    expect(ta).not.toBeNull();
    expect(ta.value).toBe("");
    expect(document.activeElement).toBe(ta);
    expect(s.preview.lastElementChild).toBe(gapEditor());
    expect(s.bec.hasUncommittedChange()).toBe(false);
    type("New text.");
    expect(s.bec.hasUncommittedChange()).toBe(true);
    keydown(ta, "Escape"); // D1: applied
    expect(s.editor()).toBeNull();
    expect(gapEditor()).toBeNull();
    expect(s.orchestrator.getBody()).toBe(`${DOC}\nNew text.\n`); // the last newline stays (L1)
    await flush();
    expect(s.preview.lastElementChild.textContent.trim()).toBe("New text.");
  });

  it("before the first block and between two blocks", async () => {
    s = await setupEdit(DOC);
    s.bec.dispatch("gapInsertRequested", gapAfter(null));
    expect(s.preview.firstElementChild).toBe(gapEditor());
    type("Top.");
    pointer(document.body, "pointerdown"); // a press outside commits
    expect(s.orchestrator.getBody()).toBe(`Top.\n\n${DOC}`);
    s.bec.dispatch("gapInsertRequested", gapAfter("# Title"));
    expect(gapEditor().previousElementSibling).toBe(s.markdownRenderer.getBlockElement(idOf("# Title")));
    type("Middle.\n\n");
    keydown(s.editor(), "Escape");
    expect(s.orchestrator.getBody()).toBe(`Top.\n\n# Title\n\nMiddle.\n\nHello world.\n\n${DOC.slice(DOC.indexOf("```"))}`);
  });

  it("left empty (or blank) and closed with Esc or a press outside: nothing changes, no unit, not unsaved (D9)", async () => {
    s = await setupEdit(DOC);
    for (const close of [() => keydown(s.editor(), "Escape"), () => pointer(document.body, "pointerdown")]) {
      for (const text of ["", "  \n\n "]) {
        s.bec.dispatch("gapInsertRequested", gapAfter("Hello"));
        if (text) type(text);
        close();
        expect(s.editor()).toBeNull();
        expect(gapEditor()).toBeNull();
        expect(s.orchestrator.getBody()).toBe(DOC);
        expect(s.orchestrator.canUndo()).toBe(false);
      }
    }
  });

  it("one Undo takes the new block away; Redo brings it back", async () => {
    s = await setupEdit(DOC);
    s.bec.dispatch("gapInsertRequested", gapAfter("Hello"));
    type("Added.");
    keydown(s.editor(), "Escape");
    expect(s.orchestrator.getBody()).toContain("Added.");
    s.bec.dispatch("undoRequested");
    expect(s.orchestrator.getBody()).toBe(DOC);
    expect(s.orchestrator.canUndo()).toBe(false);
    s.bec.dispatch("redoRequested");
    expect(s.orchestrator.getBody()).toContain("Hello world.\n\nAdded.\n\n```mermaid");
  });

  it("Undo with typed text in the gap editor: applied, then undone (D3); nothing before it is undone", async () => {
    s = await setupEdit(DOC);
    s.bec.dispatch("gapInsertRequested", gapAfter("Hello"));
    type("Added.");
    s.bec.dispatch("undoRequested");
    expect(s.editor()).toBeNull();
    expect(s.orchestrator.getBody()).toBe(DOC);
    expect(s.orchestrator.canRedo()).toBe(true);
  });

  it("while a block is open: it is committed first (a unit of its own), then the gap opens where the gap still is", async () => {
    s = await setupEdit(DOC);
    tap(s.block((b) => b.raw.startsWith("Hello")).el.firstElementChild);
    const target = gapAfter("Hello"); // Hello's commit gives it a new id
    type("Hello changed.");
    s.bec.dispatch("gapInsertRequested", target);
    expect(gapEditor()).not.toBeNull();
    type("Between.");
    keydown(s.editor(), "Escape");
    expect(s.orchestrator.getBody()).toContain("Hello changed.\n\nBetween.\n\n```mermaid");
    s.bec.dispatch("undoRequested");
    expect(s.orchestrator.getBody()).toContain("Hello changed.\n\n```mermaid");
    s.bec.dispatch("undoRequested");
    expect(s.orchestrator.getBody()).toBe(DOC);
  });

  it("while a cell is open: the cell is committed and the table session ends first", async () => {
    s = await setupEdit(`${DOC}\n| A | B |\n| --- | --- |\n| x | y |\n`);
    const table = s.block((b) => b.type === "table");
    tap(table.el.querySelector(":scope > table").rows[1].cells[0]);
    expect(s.bec.isEditingCell()).toBe(true);
    s.bec.dispatch("gapInsertRequested", gapAfter("| A"));
    expect(s.bec.isEditingCell()).toBe(false);
    expect(s.preview.lastElementChild).toBe(gapEditor());
  });

  it("with unrendered #editor changes: #editor is rendered instead (INV-45); outside edit mode nothing happens", async () => {
    s = await setupEdit(DOC);
    s.host.editorChanged = true;
    s.bec.dispatch("gapInsertRequested", gapAfter("Hello"));
    expect(s.host.renderFromEditor).toHaveBeenCalledTimes(1);
    expect(s.editor()).toBeNull();
    s.teardown();
    s = await setupEdit(DOC, { editMode: false });
    s.bec.dispatch("gapInsertRequested", gapAfter("Hello"));
    expect(s.editor()).toBeNull();
  });

  it("the gap editor stays in its place through a partial render queued before it opened", async () => {
    s = await setupEdit(DOC);
    tap(s.block((b) => b.raw.startsWith("# Title")).el.firstElementChild);
    type("# Title 2");
    s.bec.dispatch("gapInsertRequested", gapAfter("Hello")); // the commit's render is still queued
    const editor = gapEditor();
    await flush();
    expect(gapEditor()).toBe(editor);
    expect(editor.previousElementSibling).toBe(s.markdownRenderer.getBlockElement(idOf("Hello")));
    expect(s.editor()).not.toBeNull();
  });

  it("Insert table in the gap editor: the table goes in at the gap", async () => {
    s = await setupEdit(DOC);
    s.bec.dispatch("gapInsertRequested", gapAfter("Hello"));
    const ret = s.bec.dispatch("blockInsertRequested", { kind: "insert", raw: CONFIG.edit.tableTemplate, opens: "cell" });
    await ret;
    expect(s.orchestrator.getBody()).toContain(`Hello world.\n\n${CONFIG.edit.tableTemplate}\n\n\`\`\`mermaid`);
  });
});

describe("INV-73 a touch: the first tap on a gap shows the line, a tap on the line inserts", () => {
  /** Give the preview and the block wrappers rectangles, one block per 40px with 20px gaps. */
  function layout() {
    const r = (el, top, bottom) => {
      el.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 600, height: bottom - top, width: 600, x: 0, y: top });
    };
    r(s.preview, 0, 400);
    s.markdownRenderer.getBlockElements().forEach((el, i) => r(el, 20 + i * 60, 60 + i * 60));
  }

  it("tap, line, tap: the editor opens in that gap; the first tap opens no block", async () => {
    s = await setupEdit(DOC);
    layout();
    // y = 70: the gap between block 1 (20..60) and block 2 (80..120)
    pointer(s.preview, "pointerdown", { x: 100, y: 70, pointerType: "touch" });
    pointer(s.preview, "pointerup", { x: 100, y: 70, pointerType: "touch" });
    expect(s.editor()).toBeNull();
    const line = document.querySelector(".grsmd-gap-insert");
    expect(line.hidden).toBe(false);
    pointer(line, "pointerdown", { x: 100, y: 70, pointerType: "touch" });
    pointer(line, "pointerup", { x: 100, y: 70, pointerType: "touch" });
    line.click();
    expect(s.editor()).not.toBeNull();
    expect(gapEditor().previousElementSibling).toBe(s.markdownRenderer.getBlockElement(idOf("# Title")));
  });

  it("a tap elsewhere hides the line; a first tap while editing commits the open block", async () => {
    s = await setupEdit(DOC);
    layout();
    pointer(s.preview, "pointerdown", { x: 100, y: 70, pointerType: "touch" });
    pointer(s.preview, "pointerup", { x: 100, y: 70, pointerType: "touch" });
    const line = document.querySelector(".grsmd-gap-insert");
    pointer(document.body, "pointerdown", { x: 5, y: 500, pointerType: "touch" });
    expect(line.hidden).toBe(true);
    const hello = s.block((b) => b.raw.startsWith("Hello")).el.firstElementChild; // at 80..120
    pointer(hello, "pointerdown", { x: 100, y: 100, pointerType: "touch" });
    pointer(hello, "pointerup", { x: 100, y: 100, pointerType: "touch" });
    type("Hello changed.");
    layout();
    pointer(s.preview, "pointerdown", { x: 100, y: 70, pointerType: "touch" });
    pointer(s.preview, "pointerup", { x: 100, y: 70, pointerType: "touch" });
    expect(s.editor()).toBeNull();
    expect(s.orchestrator.getBody()).toContain("Hello changed.");
    expect(line.hidden).toBe(false);
  });
});

describe("INV-73 review M1 / M3", () => {
  it("M1: a touch on something over the preview (a sticky top bar) at a gap's place shows no line", async () => {
    s = await setupEdit(DOC);
    const r = (el, top, bottom) => {
      el.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 600, height: bottom - top, width: 600, x: 0, y: top });
    };
    r(s.preview, 0, 400);
    s.markdownRenderer.getBlockElements().forEach((el, i) => r(el, 20 + i * 60, 60 + i * 60));
    const bar = document.createElement("div");
    document.body.appendChild(bar);
    try {
      pointer(bar, "pointerdown", { x: 100, y: 70, pointerType: "touch" });
      pointer(bar, "pointerup", { x: 100, y: 70, pointerType: "touch" });
      const line = document.querySelector(".grsmd-gap-insert");
      expect(line === null || line.hidden).toBe(true);
      expect(s.editor()).toBeNull();
    } finally {
      bar.remove();
    }
  });

  it("M3: the renderer keeps the list of block wrappers until the order changes", async () => {
    s = await setupEdit(DOC);
    const first = s.markdownRenderer.getBlockElements();
    expect(Object.isFrozen(first)).toBe(true);
    expect(s.markdownRenderer.getBlockElements()).toBe(first);
    expect(first).toHaveLength(3);
    s.bec.dispatch("gapInsertRequested", gapAfter("Hello"));
    type("Added.");
    keydown(s.editor(), "Escape");
    await flush();
    const after = s.markdownRenderer.getBlockElements();
    expect(after).not.toBe(first);
    expect(after).toHaveLength(4);
    expect(after.every((el) => el.parentNode === s.preview)).toBe(true);
  });
});
