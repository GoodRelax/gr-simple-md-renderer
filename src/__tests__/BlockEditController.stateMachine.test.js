import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return { ...actual, applyTheme: vi.fn(), waitForDOMStability: vi.fn().mockResolvedValue(true) };
});

import { blockEditStateMachine } from "../js/classes/BlockEditController.js";
import { CONFIG } from "../js/config.js";
import { setupEdit, flush } from "./helpers/editStack.js";
import { diagramTransitions, tableTransitions } from "./helpers/specDiagram.js";
import { pointer, tap, keydown } from "./helpers/editDom.js";

// Spec 11-c: every cell of the 33 x 4 table (AT-BSM-01..18, AT-BSM-19..25
// for the table cells, AT-BSM-26..27 for the inserts, AT-BSM-28 Redo,
// AT-BSM-29 the gap insert, AT-BSM-30..32 the block range, AT-BSM-33 the
// replace of Search (INV-80); 15 is the
// definition check). The state is judged
// from outside only:
//   browsingPreview = a tap on a block opens nothing
//   editModeIdle    = not editing, and a tap on a block opens it
//   editingBlock    = a block editor is open
//   editingCell     = a table cell is open (isEditingCell())
// Events that come from UIController (palette toggles, save, reload, clear,
// code view, full render, #editor focus) are dispatched at the controller's
// entry point here; their UI stimuli are tested with UIController (unit f).

const DOC = "# Title\n\nHello world.\n\nSecond para.\n\n| A | B |\n| --- | --- |\n| x | y |\n";
const B = "browsingPreview";
const I = "editModeIdle";
const E = "editingBlock";
const C = "editingCell";
const STATES = [B, I, E, C];

let s;
afterEach(() => {
  s?.teardown();
  s = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const helloEl = () => s.block((b) => b.raw.startsWith("Hello")).el;
const secondEl = () => s.block((b) => b.raw.startsWith("Second")).el;
const tableBlock = () => s.block((b) => b.type === "table");
const tableEl = () => tableBlock().el.querySelector(":scope > table");
const cellEl = (r, c) => tableEl().rows[r].cells[c];
const tabEl = () => tableBlock().el.querySelector(":scope > .grsmd-table-tab");
const cellTarget = (row, col) => ({ kind: "cell", id: tableBlock().block.id, row, col });

/** Type into the open cell (jsdom has no contenteditable editing). */
function typeInCell(el, text) {
  el.textContent = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Set up the stack in the given state; when editing, the open block or cell has a change. */
async function inState(state) {
  s = await setupEdit(DOC, { editMode: state !== B });
  if (state === E) {
    tap(helloEl().firstElementChild);
    s.editor().value = "Hello changed.";
  }
  if (state === C) {
    tap(cellEl(1, 0));
    typeInCell(cellEl(1, 0), "x changed");
  }
  return s;
}

/** Spies on every side effect a cell may have. */
function spyAll() {
  const spies = {
    commitBlock: vi.spyOn(s.orchestrator, "commitBlock"),
    replaceTableBlock: vi.spyOn(s.orchestrator, "replaceTableBlock"),
    insertAfter: vi.spyOn(s.orchestrator, "insertAfter"),
    insertBlock: vi.spyOn(s.orchestrator, "insertBlock"),
    startEmptyDocument: vi.spyOn(s.orchestrator, "startEmptyDocument"),
    replaceBlocks: vi.spyOn(s.markdownRenderer, "replaceBlocks"),
    undoLastCommit: vi.spyOn(s.orchestrator, "undoLastCommit"),
    redoLastCommit: vi.spyOn(s.orchestrator, "redoLastCommit"),
    deleteBlocks: vi.spyOn(s.orchestrator, "deleteBlocks"),
  };
  for (const name of ["showPalette", "hidePalette", "renderFromEditor", "onEditorInput", "showToast", "writeClipboardNow"]) {
    s.host[name].mockClear();
    spies[name] = s.host[name];
  }
  return spies;
}

function calledNames(spies) {
  return Object.entries(spies)
    .filter(([, spy]) => spy.mock.calls.length > 0)
    .map(([name]) => name)
    .sort();
}

/** Observed state; probing a tap may open a block, which is then cancelled. */
function observedState() {
  if (s.bec.isEditingCell()) return C;
  if (s.bec.isEditing()) return E;
  s.host.editorChanged = false;
  tap(secondEl().firstElementChild);
  if (!s.bec.isEditing()) return B;
  keydown(s.editor(), "Escape");
  return I;
}

// DOM stimuli for the events the controller receives itself, in the states
// where the DOM produces that event. Elsewhere the same DOM action is another
// event (a tap while editing is otherBlockTapped; a tap in editModeIdle is
// blockTapped), so those cells are reached through the entry point.
const tapSecond = () => tap(secondEl().firstElementChild);
const flagAndTap = (el) => () => {
  s.host.editorChanged = true;
  tap(el());
};
const touchTapSecond = () => tap(secondEl().firstElementChild, { pointerType: "touch" });
const pressBody = () => pointer(document.body, "pointerdown");
const tapCellY = () => tap(cellEl(1, 1));
const touchTapCellY = () => tap(cellEl(1, 1), { pointerType: "touch" });
const openCellKey = (key, init) => () => keydown(cellEl(1, 0), key, init);
const DOM_STIMULI = {
  blockTapped: { [B]: tapSecond, [I]: tapSecond },
  blockTappedWithUnrenderedEditor: { [B]: flagAndTap(() => secondEl().firstElementChild), [I]: flagAndTap(() => secondEl().firstElementChild) },
  otherBlockTapped: { [B]: touchTapSecond, [E]: touchTapSecond, [C]: touchTapSecond },
  pointerPressedOutside: { [B]: pressBody, [I]: pressBody, [E]: pressBody, [C]: pressBody },
  cellTapped: { [B]: tapCellY, [I]: tapCellY, [E]: touchTapCellY, [C]: tapCellY },
  cellTappedWithUnrenderedEditor: { [B]: flagAndTap(() => cellEl(1, 1)), [I]: flagAndTap(() => cellEl(1, 1)) },
  tableSourceTapped: { [I]: () => tap(tabEl()), [E]: () => tap(tabEl(), { pointerType: "touch" }) },
  tableSourceTappedWithUnrenderedEditor: { [I]: flagAndTap(() => tabEl()) },
  nextCellRequested: { [C]: openCellKey("Tab") },
  previousCellRequested: { [C]: openCellKey("Tab", { shiftKey: true }) },
  cellBelowRequested: { [C]: openCellKey("Enter") },
  escapePressed: { [C]: openCellKey("Escape") },
};

// Targets for the entry point (cells reached without a DOM stimulus).
const TARGETS = {
  cellTapped: () => cellTarget(1, 1),
  cellTappedWithUnrenderedEditor: () => cellTarget(1, 1),
  tableSourceTapped: () => ({ kind: "tableSource", id: tableBlock().block.id }),
  tableSourceTappedWithUnrenderedEditor: () => ({ kind: "tableSource", id: tableBlock().block.id }),
  otherBlockTapped: () => ({ kind: "block", id: s.block((b) => b.raw.startsWith("Second")).block.id }),
  tableOperationRequested: () => ({ op: { kind: "insertRow" } }),
  blockInsertRequested: () => ({ kind: "insert", raw: CONFIG.edit.tableTemplate, opens: "cell" }),
  insertedBlockRendered: () => ({ ...cellTarget(0, 0), selectAll: true }),
  // the gap between Hello and Second (in editingBlock, Hello's commit gives it a new id)
  gapInsertRequested: () => ({
    kind: "gap",
    afterBlockId: s.block((b) => b.raw.startsWith("Hello")).block.id,
    beforeBlockId: s.block((b) => b.raw.startsWith("Second")).block.id,
  }),
  // the title and Hello (INV-74); Second stays for observedState()
  blockRangeDeleteRequested: () => titleToHello(),
  blockRangeCutRequested: () => titleToHello(),
  blockRangeCopyRequested: () => titleToHello(),
};

function titleToHello() {
  const ids = s.orchestrator.getModel().getBlocks().map((b) => b.id);
  return { kind: "blockRange", firstId: ids[0], lastId: ids[1] };
}

// Expected cells: [next state or null for "-", side effects (sorted)].
// editingCell has a change in cell x (row 1, column 0; the last row).
const TABLE = {
  paletteShown: { [B]: [I, []], [I]: null, [E]: null, [C]: null },
  paletteHidden: { [B]: null, [I]: [B, []], [E]: [B, ["commitBlock"]], [C]: [B, ["replaceTableBlock"]] },
  emptyDocumentStarted: {
    [B]: [E, ["showPalette", "startEmptyDocument"]],
    [I]: [E, ["startEmptyDocument"]],
    [E]: null,
    [C]: null,
  },
  blockTapped: { [B]: null, [I]: [E, []], [E]: null, [C]: null },
  blockTappedWithUnrenderedEditor: { [B]: null, [I]: [I, ["renderFromEditor"]], [E]: null, [C]: null },
  otherBlockTapped: { [B]: null, [I]: null, [E]: [E, ["commitBlock"]], [C]: [E, ["replaceTableBlock"]] },
  // [isCellEditableTable] / [isInSessionTable and canKeepTableId]
  cellTapped: { [B]: null, [I]: [C, []], [E]: [C, ["commitBlock"]], [C]: [C, ["replaceTableBlock"]] },
  cellTappedWithUnrenderedEditor: { [B]: null, [I]: [I, ["renderFromEditor"]], [E]: null, [C]: null },
  tableSourceTapped: { [B]: null, [I]: [E, []], [E]: [E, ["commitBlock"]], [C]: [E, ["replaceTableBlock"]] },
  tableSourceTappedWithUnrenderedEditor: { [B]: null, [I]: [I, ["renderFromEditor"]], [E]: null, [C]: null },
  nextCellRequested: { [B]: null, [I]: null, [E]: null, [C]: [C, ["replaceTableBlock"]] },
  previousCellRequested: { [B]: null, [I]: null, [E]: null, [C]: [C, ["replaceTableBlock"]] },
  // the last row: [else] -> editModeIdle / commitCell, endTableSession
  cellBelowRequested: { [B]: null, [I]: null, [E]: null, [C]: [I, ["replaceTableBlock"]] },
  tableOperationRequested: { [B]: null, [I]: null, [E]: null, [C]: [C, ["replaceTableBlock"]] },
  pointerPressedOutside: { [B]: null, [I]: null, [E]: [I, ["commitBlock"]], [C]: [I, ["replaceTableBlock"]] },
  // Esc applies and closes (owner ruling D1)
  escapePressed: { [B]: null, [I]: [B, ["hidePalette"]], [E]: [I, ["commitBlock"]], [C]: [I, ["replaceTableBlock"]] },
  saveRequested: { [B]: null, [I]: null, [E]: [I, ["commitBlock"]], [C]: [I, ["replaceTableBlock"]] },
  saveAsRequested: { [B]: null, [I]: null, [E]: [I, ["commitBlock"]], [C]: [I, ["replaceTableBlock"]] },
  searchReplaceRequested: { [B]: null, [I]: null, [E]: [I, ["commitBlock"]], [C]: [I, ["replaceTableBlock"]] },
  documentReplaced: { [B]: null, [I]: null, [E]: [I, []], [C]: [I, []] },
  documentCleared: { [B]: null, [I]: [B, ["hidePalette"]], [E]: [B, ["hidePalette"]], [C]: [B, ["hidePalette"]] },
  viewSwitchedToCode: { [B]: null, [I]: [B, ["hidePalette"]], [E]: [B, ["hidePalette"]], [C]: [B, ["hidePalette"]] },
  fullRenderRequested: { [B]: [B, []], [I]: [I, []], [E]: [I, ["commitBlock"]], [C]: [I, ["replaceTableBlock"]] },
  editorFocused: { [B]: null, [I]: null, [E]: [I, ["commitBlock"]], [C]: [I, ["replaceTableBlock"]] },
  // E and C have a change: [hasUncommittedChange] applies it and undoes that
  // unit (D3; the else cells are in the details)
  undoRequested: { [B]: null, [I]: [I, ["undoLastCommit"]], [E]: [I, ["commitBlock", "undoLastCommit"]], [C]: [I, ["replaceTableBlock", "undoLastCommit"]] },
  // E and C have a change: nothing to redo, they stay open (R2)
  redoRequested: { [B]: null, [I]: [I, ["redoLastCommit"]], [E]: [E, []], [C]: [C, []] },
  // no target: [else] -> editModeIdle / clearSelection, showPalette
  previewDoubleClicked: { [B]: [I, ["showPalette"]], [I]: null, [E]: null, [C]: null },
  // judged before the render: the insertedBlockRendered after it is AT-BSM-27
  blockInsertRequested: { [B]: null, [I]: [I, ["insertBlock"]], [E]: [I, ["commitBlock", "insertBlock"]], [C]: null },
  // [isCellEditableTable]
  insertedBlockRendered: { [B]: null, [I]: [C, []], [E]: null, [C]: null },
  // [else]: an empty editor opens in the gap (INV-73)
  gapInsertRequested: { [B]: null, [I]: [E, []], [E]: [E, ["commitBlock"]], [C]: [E, ["replaceTableBlock"]] },
  // INV-74: editModeIdle only; [else] (no unrendered #editor change)
  blockRangeDeleteRequested: { [B]: null, [I]: [I, ["deleteBlocks"]], [E]: null, [C]: null },
  blockRangeCutRequested: { [B]: null, [I]: [I, ["deleteBlocks", "writeClipboardNow"]], [E]: null, [C]: null },
  blockRangeCopyRequested: { [B]: null, [I]: [I, ["writeClipboardNow"]], [E]: null, [C]: null },
};

const IDS = {
  paletteShown: "AT-BSM-01",
  paletteHidden: "AT-BSM-02",
  emptyDocumentStarted: "AT-BSM-03",
  blockTapped: "AT-BSM-04",
  blockTappedWithUnrenderedEditor: "AT-BSM-05",
  otherBlockTapped: "AT-BSM-06",
  pointerPressedOutside: "AT-BSM-07",
  escapePressed: "AT-BSM-08",
  saveRequested: "AT-BSM-09",
  saveAsRequested: "AT-BSM-10",
  documentReplaced: "AT-BSM-11",
  documentCleared: "AT-BSM-12",
  viewSwitchedToCode: "AT-BSM-13",
  fullRenderRequested: "AT-BSM-14",
  editorFocused: "AT-BSM-16",
  undoRequested: "AT-BSM-17",
  previewDoubleClicked: "AT-BSM-18",
  cellTapped: "AT-BSM-19",
  cellTappedWithUnrenderedEditor: "AT-BSM-20",
  tableSourceTapped: "AT-BSM-21",
  tableSourceTappedWithUnrenderedEditor: "AT-BSM-22",
  nextCellRequested: "AT-BSM-23",
  previousCellRequested: "AT-BSM-23",
  cellBelowRequested: "AT-BSM-24",
  tableOperationRequested: "AT-BSM-25",
  blockInsertRequested: "AT-BSM-26",
  insertedBlockRendered: "AT-BSM-27",
  redoRequested: "AT-BSM-28",
  gapInsertRequested: "AT-BSM-29",
  blockRangeDeleteRequested: "AT-BSM-30",
  blockRangeCutRequested: "AT-BSM-31",
  blockRangeCopyRequested: "AT-BSM-32",
  searchReplaceRequested: "AT-BSM-33",
};

const CELLS = Object.entries(TABLE).flatMap(([event, row]) =>
  STATES.map((state) => [IDS[event], event, state, row[state]]),
);

describe("AT-BSM 11-c block edit state machine: all 132 cells", () => {
  it("covers 33 events x 4 states", () => {
    expect(CELLS).toHaveLength(132);
  });

  it.each(CELLS)("%s %s in %s", async (_id, event, state, cell) => {
    await inState(state);
    const spies = spyAll();
    const body = s.orchestrator.getBody();
    const stimulus = DOM_STIMULI[event]?.[state];
    const ret = stimulus ? stimulus() : s.bec.dispatch(event, TARGETS[event]?.() ?? null);
    if (event !== "blockInsertRequested") await ret;
    if (event === "emptyDocumentStarted") await flush();

    if (cell === null) {
      // "-": no state change and no side effect at all
      expect(calledNames(spies)).toEqual([]);
      expect(s.orchestrator.getBody()).toBe(body);
      expect(observedState()).toBe(state);
      return;
    }
    const [next, effects] = cell;
    expect(calledNames(spies).filter((n) => !["insertAfter", "replaceBlocks", "onEditorInput"].includes(n))).toEqual(effects);
    expect(observedState()).toBe(next);
    await ret;
  });
});

describe("AT-BSM-15 the blockEditStateMachine definition matches the spec", () => {
  it("11-b: the spec diagram shows exactly the transitions of the table", () => {
    expect(diagramTransitions("11-c")).toEqual(tableTransitions(blockEditStateMachine));
  });

  it("guards are evaluated in the order of the spec", () => {
    const u = blockEditStateMachine.undoRequested[E];
    expect(u.map((c) => [c.to, c.guard ?? "else", c.actions])).toEqual([
      [I, "hasUncommittedChange", ["commitBlock", "undoJustCommitted"]],
      [I, "else", ["commitBlock", "undoLastUnit"]],
    ]);
    const uc = blockEditStateMachine.undoRequested[C];
    expect(uc.map((c) => [c.to, c.guard ?? "else", c.actions])).toEqual([
      [I, "hasUncommittedChange", ["commitCell", "endTableSession", "undoJustCommitted"]],
      [I, "else", ["commitCell", "endTableSession", "undoLastUnit"]],
    ]);
    const r = blockEditStateMachine.redoRequested[E];
    expect(r.map((c) => [c.to, c.guard ?? "else", c.actions])).toEqual([
      [E, "hasUncommittedChange", []],
      [I, "else", ["commitBlock", "redoLastUnit"]],
    ]);
    const rc = blockEditStateMachine.redoRequested[C];
    expect(rc.map((c) => [c.to, c.guard ?? "else", c.actions])).toEqual([
      [C, "hasUncommittedChange", []],
      [I, "else", ["commitCell", "endTableSession", "redoLastUnit"]],
    ]);
    expect(blockEditStateMachine.redoRequested[I]).toMatchObject({ to: I, actions: ["redoLastUnit"] });
    expect(blockEditStateMachine.redoRequested[B]).toBeNull();
    const g = blockEditStateMachine.gapInsertRequested[I];
    expect(g.map((c) => [c.to, c.guard ?? "else", c.actions])).toEqual([
      [I, "hasUnrenderedEditor", ["renderFromEditor", "showToast"]],
      [E, "else", ["resolveBlockById", "openBlockEditor"]],
    ]);
    expect(blockEditStateMachine.gapInsertRequested[E]).toMatchObject({ to: E, actions: ["commitBlock", "resolveBlockById", "openBlockEditor"] });
    expect(blockEditStateMachine.gapInsertRequested[C]).toMatchObject({
      to: E,
      actions: ["commitCell", "endTableSession", "resolveBlockById", "openBlockEditor"],
    });
    const d = blockEditStateMachine.previewDoubleClicked[B];
    expect(d.map((c) => [c.to, c.guard ?? "else", c.actions])).toEqual([
      [I, "hasUnrenderedEditor", ["clearSelection", "showPalette", "renderFromEditor", "showToast"]],
      [C, "isCellTarget&&isCellEditableTable", ["clearSelection", "showPalette", "startTableSession", "openCell"]],
      [E, "isCellTarget", ["clearSelection", "showPalette", "openTableSourceWithToast"]], // owner ruling Q-c
      [E, "isEmptyDocument", ["clearSelection", "showPalette", "openBlockEditor"]],
      [E, "isBlockTarget", ["clearSelection", "showPalette", "openBlockEditor"]],
      [I, "else", ["clearSelection", "showPalette"]],
    ]);
    expect(blockEditStateMachine.undoRequested[I]).toMatchObject({ to: I, actions: ["undoLastUnit"] });
    const t = blockEditStateMachine.cellTapped[C];
    expect(t.map((c) => [c.to, c.guard ?? "else"])).toEqual([
      [C, "isInSessionTable&&canKeepTableId"],
      [I, "isInSessionTable"],
      [C, "isCellEditableTable"],
      [E, "else"],
    ]);
    const below = blockEditStateMachine.cellBelowRequested[C];
    expect(below.map((c) => [c.to, c.guard ?? "else", c.actions])).toEqual([
      [C, "hasCellBelow&&canKeepTableId", ["commitCell", "moveToCell", "openCell"]],
      [I, "hasCellBelow", ["commitCell", "endTableSession", "showTableEditEndedToast"]],
      [I, "else", ["commitCell", "endTableSession"]],
    ]);
    const ins = blockEditStateMachine.blockInsertRequested[E];
    expect(ins.map((c) => [c.to, c.guard ?? "else", c.actions])).toEqual([
      [I, "canInsertBlock", ["commitBlock", "insertBlock"]],
      [E, "else", ["showInsertRefusedToast"]],
    ]);
    const shown = blockEditStateMachine.insertedBlockRendered[I];
    expect(shown.map((c) => [c.to, c.guard ?? "else", c.actions])).toEqual([
      [C, "isCellEditableTable", ["startTableSession", "openCell"]],
      [E, "isCellTarget", ["openTableSourceWithToast"]],
      [E, "else", ["openBlockEditor"]],
    ]);
    const op = blockEditStateMachine.tableOperationRequested[C];
    expect(op.map((c) => [c.to, c.guard, c.actions])).toEqual([
      [C, "canApplyTableOperation&&canKeepTableId", ["commitCell", "applyTableOperation", "openCell"]],
      [I, "canApplyTableOperation", ["commitCell", "applyTableOperation", "endTableSession", "showTableEditEndedToast"]],
    ]);
  });
});

describe("AT-BSM cell details", () => {
  it("AT-BSM-02 paletteHidden while editing commits first (the model has the text before the call returns)", async () => {
    await inState(E);
    s.host.shown = false;
    s.bec.dispatch("paletteHidden");
    expect(s.orchestrator.getBody()).toBe(DOC.replace("Hello world.", "Hello changed."));
    expect(s.editor()).toBeNull();
  });

  it("AT-BSM-03 emptyDocumentStarted opens the editor on the empty first block, focused; typing then committing inserts it", async () => {
    s = await setupEdit(null, { editMode: false });
    await s.bec.dispatch("emptyDocumentStarted");
    expect(s.host.shown).toBe(true);
    const ta = s.editor();
    expect(ta).not.toBeNull();
    expect(ta.value).toBe("");
    expect(document.activeElement).toBe(ta);
    expect(s.orchestrator.getBody()).toBe("");
    ta.value = "# New";
    pointer(document.body, "pointerdown");
    expect(s.orchestrator.getBody()).toContain("# New");
    expect(s.orchestrator.getModel().getBlocks()).toHaveLength(1);
  });

  it("AT-BSM-03 an empty commit on the empty block changes nothing", async () => {
    s = await setupEdit(null, { editMode: false });
    await s.bec.dispatch("emptyDocumentStarted");
    const insert = vi.spyOn(s.orchestrator, "insertAfter");
    pointer(document.body, "pointerdown");
    expect(insert).not.toHaveBeenCalled();
    expect(s.bec.isEditing()).toBe(false);
  });

  it("AT-BSM-04 a tap on the empty block of an empty document opens it (INV-49)", async () => {
    s = await setupEdit("", { editMode: true });
    await flush();
    const empty = s.preview.querySelector(".md-block-empty");
    expect(empty).not.toBeNull();
    tap(empty);
    expect(s.editor()).not.toBeNull();
    expect(s.editor().value).toBe("");
  });

  it("AT-BSM-05 with unrendered #editor changes the tap renders from #editor instead of opening", async () => {
    await inState(I);
    s.host.editorChanged = true;
    tap(secondEl().firstElementChild);
    expect(s.host.renderFromEditor).toHaveBeenCalledTimes(1);
    expect(s.bec.isEditing()).toBe(false);
  });

  it("AT-BSM-08 Esc while editing applies and closes; during IME it does nothing (guard isImeIdle); Undo then takes it back", async () => {
    await inState(E);
    const ta = s.editor();
    ta.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    s.bec.dispatch("escapePressed");
    expect(s.bec.isEditing()).toBe(true);
    ta.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    s.bec.dispatch("escapePressed");
    expect(s.bec.isEditing()).toBe(false);
    expect(s.orchestrator.getBody()).toBe(DOC.replace("Hello world.", "Hello changed."));
    await flush();
    expect(helloEl().firstElementChild.textContent).toBe("Hello changed.");
    s.bec.dispatch("undoRequested");
    expect(s.orchestrator.getBody()).toBe(DOC);
  });

  it("AT-BSM-08 Esc in a changed cell applies it and ends the table session (owner ruling D1)", async () => {
    await inState(C);
    keydown(cellEl(1, 0), "Escape");
    expect(s.bec.isEditing()).toBe(false);
    expect(s.orchestrator.getBody()).toContain("| x changed |");
    s.bec.dispatch("undoRequested");
    expect(s.orchestrator.getBody()).toBe(DOC);
  });

  it("AT-BSM-08 Esc with everything deleted removes the block, as a press outside; Ctrl+Z brings it back (D9)", async () => {
    await inState(E);
    s.editor().value = "";
    s.bec.dispatch("escapePressed");
    expect(s.orchestrator.getBody()).not.toContain("Hello");
    s.bec.dispatch("undoRequested");
    expect(s.orchestrator.getBody()).toBe(DOC);
  });

  it.each(["documentReplaced", "documentCleared", "viewSwitchedToCode"])(
    "AT-BSM-11..13 %s discards the editor without committing",
    async (event) => {
      await inState(E);
      const commit = vi.spyOn(s.orchestrator, "commitBlock");
      s.bec.dispatch(event);
      expect(commit).not.toHaveBeenCalled();
      expect(s.editor()).toBeNull();
      expect(s.orchestrator.getBody()).toBe(DOC);
    },
  );

  it("AT-BSM-14 fullRenderRequested while editing commits before it returns (the caller then enqueues the render)", async () => {
    await inState(E);
    s.bec.dispatch("fullRenderRequested");
    expect(s.orchestrator.getBody()).toBe(DOC.replace("Hello world.", "Hello changed."));
  });

  it("AT-BSM-17 undoRequested in editingBlock without a change: commitBlock (nothing) then undoLastUnit", async () => {
    s = await setupEdit(DOC);
    tap(helloEl().firstElementChild);
    s.editor().value = "Hello changed.";
    pointer(document.body, "pointerdown"); // commit: the undo record
    tap(secondEl().firstElementChild); // open without a change
    expect(s.bec.hasUncommittedChange()).toBe(false);
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    s.bec.dispatch("undoRequested");
    expect(commit).not.toHaveBeenCalled(); // the unchanged raw commits nothing
    expect(s.editor()).toBeNull();
    expect(s.orchestrator.getBody()).toBe(DOC);
    expect(observedState()).toBe(I);
  });

  it("AT-BSM-17 undoRequested in editingBlock with a change applies it and undoes that unit only; Redo brings it back (INV-48 (1), D3)", async () => {
    s = await setupEdit(DOC);
    tap(helloEl().firstElementChild);
    s.editor().value = "Hello changed.";
    pointer(document.body, "pointerdown");
    tap(secondEl().firstElementChild);
    s.editor().value = "Second changed.";
    s.bec.dispatch("undoRequested");
    expect(s.editor()).toBeNull();
    expect(s.orchestrator.getBody()).toBe(DOC.replace("Hello world.", "Hello changed."));
    expect(s.orchestrator.canUndo()).toBe(true);
    expect(s.orchestrator.canRedo()).toBe(true);
    s.bec.dispatch("redoRequested");
    expect(s.orchestrator.getBody()).toBe(DOC.replace("Hello world.", "Hello changed.").replace("Second para.", "Second changed."));
  });

  it("AT-BSM-17 R1: a change the commit drops (only line end spaces) closes the editor and undoes nothing before it", async () => {
    s = await setupEdit(DOC);
    tap(helloEl().firstElementChild);
    s.editor().value = "Hello changed.";
    pointer(document.body, "pointerdown"); // a unit
    tap(secondEl().firstElementChild);
    s.editor().value = "Second para.   "; // INV-71 (6): no line break, the commit keeps the raw
    expect(s.bec.hasUncommittedChange()).toBe(true);
    const undo = vi.spyOn(s.orchestrator, "undoLastCommit");
    s.bec.dispatch("undoRequested");
    expect(s.editor()).toBeNull();
    expect(undo).not.toHaveBeenCalled();
    expect(s.orchestrator.getBody()).toBe(DOC.replace("Hello world.", "Hello changed."));
  });

  it("AT-BSM-17 R1 in a cell: a changed cell whose commit makes no unit closes and undoes nothing before it", async () => {
    s = await setupEdit(DOC);
    tap(helloEl().firstElementChild);
    s.editor().value = "Hello changed.";
    pointer(document.body, "pointerdown"); // a unit
    tap(cellEl(1, 0));
    typeInCell(cellEl(1, 0), "x changed");
    expect(s.bec.hasUncommittedChange()).toBe(true);
    // the cell commit makes no unit (the model stays as it is)
    vi.spyOn(s.orchestrator, "replaceTableBlock").mockReturnValue(Promise.resolve());
    const undo = vi.spyOn(s.orchestrator, "undoLastCommit");
    s.bec.dispatch("undoRequested");
    expect(s.bec.isEditing()).toBe(false);
    expect(undo).not.toHaveBeenCalled();
    expect(s.orchestrator.getBody()).toBe(DOC.replace("Hello world.", "Hello changed."));
  });

  it("AT-BSM-28 redoRequested: unchanged editor or cell closes first; a changed one stays and keeps the redo record (R2); #editor changes render instead (R3)", async () => {
    s = await setupEdit(DOC);
    tap(helloEl().firstElementChild);
    s.editor().value = "Hello changed.";
    pointer(document.body, "pointerdown");
    s.bec.dispatch("undoRequested");
    expect(s.orchestrator.canRedo()).toBe(true);
    // a changed editor: nothing
    tap(secondEl().firstElementChild);
    s.editor().value = "Second changed.";
    s.bec.dispatch("redoRequested");
    expect(s.editor()).not.toBeNull();
    expect(s.orchestrator.canRedo()).toBe(true);
    // unchanged again: it closes, then the redo
    s.editor().value = "Second para.";
    s.bec.dispatch("redoRequested");
    expect(s.editor()).toBeNull();
    expect(s.orchestrator.getBody()).toBe(DOC.replace("Hello world.", "Hello changed."));
    expect(s.orchestrator.canRedo()).toBe(false);
    // a cell without a change: the session ends, then the redo (nothing left here)
    s.bec.dispatch("undoRequested");
    tap(cellEl(1, 0));
    expect(s.bec.isEditingCell()).toBe(true);
    s.bec.dispatch("redoRequested");
    expect(s.bec.isEditing()).toBe(false);
    expect(s.orchestrator.getBody()).toBe(DOC.replace("Hello world.", "Hello changed."));
    // R3
    s.bec.dispatch("undoRequested");
    const redo = vi.spyOn(s.orchestrator, "redoLastCommit");
    s.host.editorChanged = true;
    s.bec.dispatch("redoRequested");
    expect(s.host.renderFromEditor).toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it("AT-BSM-28 a new unit after an undo empties the redo record", async () => {
    s = await setupEdit(DOC);
    tap(helloEl().firstElementChild);
    s.editor().value = "Hello changed.";
    pointer(document.body, "pointerdown");
    s.bec.dispatch("undoRequested");
    expect(s.orchestrator.canRedo()).toBe(true);
    tap(secondEl().firstElementChild);
    s.editor().value = "Second changed.";
    s.bec.dispatch("escapePressed");
    expect(s.orchestrator.canRedo()).toBe(false);
  });

  it("AT-BSM-17 undoLastUnit with unrendered #editor changes renders from #editor instead (INV-45)", async () => {
    await inState(I);
    const undo = vi.spyOn(s.orchestrator, "undoLastCommit");
    s.host.editorChanged = true;
    s.bec.dispatch("undoRequested");
    expect(s.host.renderFromEditor).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  it("AT-BSM-18 previewDoubleClicked guards in order: unrendered editor, empty document, block, else", async () => {
    s = await setupEdit(DOC, { editMode: false });
    const sel = window.getSelection();
    const select = () => {
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(helloEl().firstElementChild);
      sel.addRange(r);
    };
    // [hasUnrenderedEditor] wins over a block target
    select();
    s.host.editorChanged = true;
    s.bec.dispatch("previewDoubleClicked", { kind: "block", id: helloEl().dataset.blockId * 1 });
    expect(s.host.renderFromEditor).toHaveBeenCalledTimes(1);
    expect(s.host.showPalette).toHaveBeenCalledTimes(1);
    expect(s.editor()).toBeNull();
    expect(sel.isCollapsed).toBe(true);
    s.teardown();

    s = await setupEdit(DOC, { editMode: false });
    select();
    const id = s.block((b) => b.raw.startsWith("Hello")).block.id;
    s.bec.dispatch("previewDoubleClicked", { kind: "block", id });
    expect(s.editor()).not.toBeNull();
    expect(s.editor().value).toBe("Hello world.");
    expect(s.host.showPalette).toHaveBeenCalledTimes(1);
    expect(window.getSelection().isCollapsed).toBe(true);
    s.teardown();

    s = await setupEdit("", { editMode: false });
    await flush();
    s.bec.dispatch("previewDoubleClicked", { kind: "empty" });
    expect(s.editor()).not.toBeNull();
    expect(s.editor().value).toBe("");
  });

  it("leaving edit mode removes the document pointer listeners: a tap then opens nothing", async () => {
    await inState(I);
    s.host.shown = false;
    s.bec.dispatch("paletteHidden");
    tap(secondEl().firstElementChild);
    expect(s.bec.isEditing()).toBe(false);
  });
});

describe("AT-BSM-15 the blockEditStateMachine definition matches the table", () => {
  it("has the same 33 events, and the same next state in all 132 cells (the first alternative of a choice)", () => {
    expect(Object.keys(TABLE)).toHaveLength(33);
    expect(Object.keys(blockEditStateMachine).sort()).toEqual(Object.keys(TABLE).sort());
    for (const [event, row] of Object.entries(TABLE)) {
      for (const state of STATES) {
        const def = blockEditStateMachine[event][state];
        if (row[state] === null) expect(def, `${event} x ${state}`).toBeNull();
        else {
          const cells = Array.isArray(def) ? def : [def];
          // the cell the TABLE above expects: the else of a double click without
          // a target, the [else] of Enter on the last row, else the first one
          let expected = cells[0];
          const lastOnes = ["previewDoubleClicked", "cellBelowRequested", "gapInsertRequested", "escapePressed", "blockRangeDeleteRequested", "blockRangeCutRequested"];
          if (lastOnes.includes(event)) expected = cells[cells.length - 1];
          if (event === "cellTapped" && state !== C) expected = cells[0];
          expect(expected.to, `${event} x ${state}`).toBe(row[state][0]);
        }
      }
    }
  });

  it("lists the actions of the spec table for each cell", () => {
    const act = (event, state) => blockEditStateMachine[event][state].actions;
    expect(act("paletteHidden", E)).toEqual(["commitBlock"]);
    expect(act("emptyDocumentStarted", B)).toEqual(["startEmptyDocument", "showPalette", "openBlockEditor"]);
    expect(act("emptyDocumentStarted", I)).toEqual(["startEmptyDocument", "openBlockEditor"]);
    expect(act("blockTapped", I)).toEqual(["openBlockEditor"]);
    expect(act("blockTappedWithUnrenderedEditor", I)).toEqual(["renderFromEditor", "showToast"]);
    expect(act("otherBlockTapped", E)).toEqual(["commitBlock", "resolveBlockById", "openBlockEditor"]);
    // INV-74 (D14): a block range goes first, then the palette
    expect(blockEditStateMachine.escapePressed[I].map((c) => [c.to, c.guard ?? "else", c.actions])).toEqual([
      [I, "hasBlockRange", ["clearBlockRange"]],
      [B, "else", ["hidePalette"]],
    ]);
    for (const [event, actions] of [
      ["blockRangeDeleteRequested", ["deleteBlockRange"]],
      ["blockRangeCutRequested", ["cutBlockRange"]],
    ]) {
      expect(blockEditStateMachine[event][I].map((c) => [c.to, c.guard ?? "else", c.actions])).toEqual([
        [I, "hasUnrenderedEditor", ["renderFromEditor", "showToast"]],
        [I, "else", actions],
      ]);
    }
    expect(act("blockRangeCopyRequested", I)).toEqual(["copyBlockRange"]);
    expect(act("escapePressed", E)).toEqual(["commitBlock"]);
    expect(blockEditStateMachine.escapePressed[E].guard).toBe("isImeIdle");
    expect(act("escapePressed", C)).toEqual(["commitCell", "endTableSession"]);
    expect(blockEditStateMachine.escapePressed[C].guard).toBe("isImeIdle");
    expect(act("documentReplaced", E)).toEqual(["discardBlockEditor"]);
    expect(act("documentCleared", E)).toEqual(["discardBlockEditor", "hidePalette"]);
    expect(act("viewSwitchedToCode", E)).toEqual(["discardBlockEditor", "hidePalette"]);
    expect(act("fullRenderRequested", B)).toEqual(["enqueueFullRender"]);
    expect(act("fullRenderRequested", E)).toEqual(["commitBlock", "enqueueFullRender"]);
    expect(act("editorFocused", E)).toEqual(["commitBlock"]);
    expect(act("pointerPressedOutside", E)).toEqual(["commitBlock"]);
    expect(act("saveRequested", E)).toEqual(["commitBlock"]);
    expect(act("saveAsRequested", E)).toEqual(["commitBlock"]);
    expect(act("searchReplaceRequested", E)).toEqual(["commitBlock"]);
  });
});

describe("AT-BSM-26 / 27 inserts (INV-52)", () => {
  const insertTable = () => ({ kind: "insert", raw: CONFIG.edit.tableTemplate, opens: "cell" });

  it("AT-BSM-26 refused in a code block: the editor stays open with its text, a toast, no change", async () => {
    s = await setupEdit("```js\nconst a = 1;\n```\n", { editMode: true });
    tap(s.block((b) => b.type === "code").el.firstElementChild);
    const ta = s.editor();
    ta.setSelectionRange(8, 8);
    const ret = s.bec.dispatch("blockInsertRequested", insertTable());
    expect(ret).toBeUndefined();
    expect(s.host.showToast).toHaveBeenCalledWith(CONFIG.messages.edit.insertNotPossible);
    expect(s.editor()).toBe(ta);
    expect(s.orchestrator.getBody()).toBe("```js\nconst a = 1;\n```\n");
  });

  it("AT-BSM-26 the commit and the insert are two changes; the table cuts the edited paragraph", async () => {
    s = await setupEdit("Para.\n", { editMode: true });
    tap(s.block((b) => b.raw.startsWith("Para")).el.firstElementChild);
    s.editor().value = "Line one\nLine two";
    s.editor().setSelectionRange(4, 4);
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    const insert = vi.spyOn(s.orchestrator, "insertBlock");
    await s.bec.dispatch("blockInsertRequested", insertTable());
    expect(commit).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(s.orchestrator.getBody()).toBe(`Line one\n\n${CONFIG.edit.tableTemplate}\n\nLine two\n`);
    expect(s.bec.isEditingCell()).toBe(true);
  });

  it("AT-BSM-27 not opened when another tap came before the render (the tapped block stays open)", async () => {
    s = await setupEdit(DOC, { editMode: true });
    const opening = s.bec.dispatch("blockInsertRequested", insertTable());
    tapSecond();
    await opening;
    expect(s.bec.isEditingCell()).toBe(false);
    expect(s.editor().value).toBe("Second para.");
  });

  it("AT-BSM-27 not opened when the model changed before the render (an Undo)", async () => {
    s = await setupEdit(DOC, { editMode: true });
    const opening = s.bec.dispatch("blockInsertRequested", insertTable());
    s.bec.dispatch("undoRequested");
    await opening;
    expect(s.bec.isEditing()).toBe(false);
    expect(s.orchestrator.getBody()).toBe(DOC);
  });

  it("AT-BSM-27 a Mermaid sample opens its source, the caret at the end of the diagram's first line, scrolled into view the least", async () => {
    s = await setupEdit(DOC, { editMode: true });
    const reveal = vi.spyOn(s.scrollMemento, "reveal");
    await s.bec.dispatch("blockInsertRequested", { kind: "insert", raw: CONFIG.edit.mermaidSamples.state, opens: "source" });
    const ta = s.editor();
    expect(ta.value).toBe(CONFIG.edit.mermaidSamples.state);
    const end = "```mermaid\nstateDiagram-v2".length;
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([end, end]);
    expect(reveal).toHaveBeenCalledWith(ta);
  });
});

describe("AT-BSM-26 / 27 inserts after the first review", () => {
  const insertTable = () => ({ kind: "insert", raw: CONFIG.edit.tableTemplate, opens: "cell" });

  it("AT-BSM-26 the inserted block is the last opened one at once (review L5), and an insert is pending until it opens (D5)", async () => {
    s = await setupEdit(DOC, { editMode: true });
    expect(s.bec.isInsertPending()).toBe(false);
    const opening = s.bec.dispatch("blockInsertRequested", insertTable());
    const table = s.orchestrator.getModel().getBlocks().find((b) => b.raw.startsWith("| Col1"));
    expect(s.bec.getLastOpenedBlockId()).toBe(table.id);
    expect(s.bec.isInsertPending()).toBe(true);
    await opening;
    expect(s.bec.isInsertPending()).toBe(false);
    expect(s.bec.isEditingCell()).toBe(true);
  });

  it("AT-BSM-26 a cut drops the line end spaces that no longer make a line break; Undo brings them back (review L4)", async () => {
    s = await setupEdit("Para.\n", { editMode: true });
    tap(s.block((b) => b.raw.startsWith("Para")).el.firstElementChild);
    s.editor().value = "x  \ny";
    s.editor().setSelectionRange(1, 1);
    await s.bec.dispatch("blockInsertRequested", insertTable());
    expect(s.orchestrator.getBody()).toBe(`x\n\n${CONFIG.edit.tableTemplate}\n\ny\n`);
    s.bec.dispatch("escapePressed");
    s.bec.dispatch("undoRequested");
    expect(s.orchestrator.getBody()).toBe("x  \ny\n");
  });

  it("AT-BSM-27 the block to open is not of the inserted kind (a whole-document model): nothing opens (review L2)", async () => {
    s = await setupEdit(DOC, { editMode: true });
    const para = s.block((b) => b.raw.startsWith("Hello")).block;
    vi.spyOn(s.orchestrator, "insertBlock").mockReturnValue({ rendering: Promise.resolve(), blockId: para.id, lastBlockId: para.id });
    const reveal = vi.spyOn(s.scrollMemento, "reveal");
    await s.bec.dispatch("blockInsertRequested", insertTable());
    expect(s.bec.isEditing()).toBe(false);
    expect(s.host.showToast).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(s.bec.isInsertPending()).toBe(false);
  });
});

describe("AT-BSM-26 a huge paragraph (re-check N2)", () => {
  it("over CONFIG.edit.invisibleMarkMaxChars no inline lexing runs, and the paragraph is cut by line", async () => {
    s = await setupEdit("Para.\n", { editMode: true });
    tap(s.block((b) => b.raw.startsWith("Para")).el.firstElementChild);
    const tail = "x".repeat(CONFIG.edit.invisibleMarkMaxChars);
    s.editor().value = `alpha **beta\ngamma** ${tail}`;
    s.editor().setSelectionRange(3, 3);
    const inline = vi.spyOn(s.markdownRenderer, "lexInline");
    s.bec.dispatch("blockInsertRequested", { kind: "insert", raw: CONFIG.edit.tableTemplate, opens: "cell" });
    expect(inline).not.toHaveBeenCalled();
    expect(s.orchestrator.getBody().startsWith(`alpha **beta\n\n${CONFIG.edit.tableTemplate}\n\ngamma** x`)).toBe(true);
  });
});
