import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return { ...actual, applyTheme: vi.fn(), waitForDOMStability: vi.fn().mockResolvedValue(true) };
});

import { setupEdit, flush } from "./helpers/editStack.js";
import { tap, pointer } from "./helpers/editDom.js";

// INV-61: a table block whose source editor is committed with a change is
// aligned (pipes lined up by display width); nothing else is.

const TABLE = "|Name|Age|\n|-|-:|\n|\u5c71\u7530|30|";
const ALIGNED = "| Name | Age |\n| ---- | --: |\n| \u5c71\u7530 | 30  |";
const DOC = `# T\n\n${TABLE}\n\nA para.\n`;

let s;
afterEach(() => {
  s?.teardown();
  s = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openTable() {
  tap(s.block((b) => b.type === "table").el.firstElementChild);
  return s.editor();
}

function commitWith(ta, text) {
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  pointer(document.body, "pointerdown");
}

describe("AT-TF INV-61 table formatting on commit", () => {
  it("AT-TF-01 a changed table is aligned when committed (one commit, one Undo)", async () => {
    s = await setupEdit(DOC);
    const ta = openTable();
    commitWith(ta, TABLE.replace("30", "31"));
    expect(s.orchestrator.getBody()).toBe(`# T\n\n${ALIGNED.replace("30 ", "31 ")}\n\nA para.\n`);
    await flush();
    s.orchestrator.undoLastCommit();
    expect(s.orchestrator.getBody()).toBe(DOC);
  });

  it("AT-TF-02 closing without a change aligns nothing", async () => {
    s = await setupEdit(DOC);
    openTable();
    pointer(document.body, "pointerdown");
    expect(s.orchestrator.getBody()).toBe(DOC);
    expect(s.orchestrator.canUndo()).toBe(false);
  });

  it("AT-TF-03 an edit that splits the block: only the table part is aligned", async () => {
    s = await setupEdit(DOC);
    const ta = openTable();
    commitWith(ta, `${TABLE}\n\nNew  |  para  |  text`);
    expect(s.orchestrator.getBody()).toBe(`# T\n\n${ALIGNED}\n\nNew  |  para  |  text\n\nA para.\n`);
  });

  it("AT-TF-04 only a block of the type table: a paragraph edited into a table is not aligned", async () => {
    s = await setupEdit(DOC);
    tap(s.block((b) => b.raw.startsWith("A para")).el.firstElementChild);
    commitWith(s.editor(), "|x|y|\n|-|-|\n|1|2|");
    expect(s.orchestrator.getBody()).toContain("|x|y|\n|-|-|\n|1|2|");
  });

  it("AT-TF-05 an edited table that is no longer a table is committed as typed", async () => {
    s = await setupEdit(DOC);
    const ta = openTable();
    commitWith(ta, "|Name|Age|\nno delimiter");
    expect(s.orchestrator.getBody()).toBe("# T\n\n|Name|Age|\nno delimiter\n\nA para.\n");
  });

  it("AT-TF-06 a change of the cell spacing only still counts as a change and is aligned", async () => {
    s = await setupEdit(DOC);
    const ta = openTable();
    commitWith(ta, TABLE.replace("|30|", "| 30 |"));
    expect(s.orchestrator.getBody()).toBe(`# T\n\n${ALIGNED}\n\nA para.\n`);
  });
});
