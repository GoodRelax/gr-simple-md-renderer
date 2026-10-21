import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return { ...actual, applyTheme: vi.fn(), waitForDOMStability: vi.fn().mockResolvedValue(true) };
});

import { blockEditStateMachine } from "../js/classes/BlockEditController.js";
import { setupEdit, flush } from "./helpers/editStack.js";
import { diagramTransitions, tableTransitions } from "./helpers/specDiagram.js";
import { pointer, tap, keydown } from "./helpers/editDom.js";

// Spec 11-c: every cell of the 17 x 3 table (AT-BSM-01..18; 15 is the
// definition check). The state is judged from outside only:
//   browsingPreview = a tap on a block opens nothing
//   editModeIdle    = not editing, and a tap on a block opens it
//   editingBlock    = isEditing()
// Events that come from UIController (palette toggles, save, reload, clear,
// code view, full render, #editor focus) are dispatched at the controller's
// entry point here; their UI stimuli are tested with UIController (unit f).

const DOC = "# Title\n\nHello world.\n\nSecond para.\n";
const B = "browsingPreview";
const I = "editModeIdle";
const E = "editingBlock";
const STATES = [B, I, E];

let s;
afterEach(() => {
  s?.teardown();
  s = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const helloEl = () => s.block((b) => b.raw.startsWith("Hello")).el;
const secondEl = () => s.block((b) => b.raw.startsWith("Second")).el;

/** Set up the stack in the given state; when editing, the open block has a change. */
async function inState(state) {
  s = await setupEdit(DOC, { editMode: state !== B });
  if (state === E) {
    tap(helloEl().firstElementChild);
    s.editor().value = "Hello changed.";
  }
  return s;
}

/** Spies on every side effect a cell may have. */
function spyAll() {
  const spies = {
    commitBlock: vi.spyOn(s.orchestrator, "commitBlock"),
    insertAfter: vi.spyOn(s.orchestrator, "insertAfter"),
    startEmptyDocument: vi.spyOn(s.orchestrator, "startEmptyDocument"),
    replaceBlocks: vi.spyOn(s.markdownRenderer, "replaceBlocks"),
    undoLastCommit: vi.spyOn(s.orchestrator, "undoLastCommit"),
  };
  for (const name of ["showPalette", "hidePalette", "renderFromEditor", "onEditorInput"]) {
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
const flagAndTap = () => {
  s.host.editorChanged = true;
  tapSecond();
};
const touchTapSecond = () => tap(secondEl().firstElementChild, { pointerType: "touch" });
const pressBody = () => pointer(document.body, "pointerdown");
const DOM_STIMULI = {
  blockTapped: { [B]: tapSecond, [I]: tapSecond },
  blockTappedWithUnrenderedEditor: { [B]: flagAndTap, [I]: flagAndTap },
  otherBlockTapped: { [B]: touchTapSecond, [E]: touchTapSecond },
  pointerPressedOutside: { [B]: pressBody, [I]: pressBody, [E]: pressBody },
};

// Expected cells: [next state or null for "-", side effects (sorted)].
const TABLE = {
  paletteShown: { [B]: [I, []], [I]: null, [E]: null },
  paletteHidden: { [B]: null, [I]: [B, []], [E]: [B, ["commitBlock"]] },
  emptyDocumentStarted: {
    [B]: [E, ["showPalette", "startEmptyDocument"]],
    [I]: [E, ["startEmptyDocument"]],
    [E]: null,
  },
  blockTapped: { [B]: null, [I]: [E, []], [E]: null },
  blockTappedWithUnrenderedEditor: { [B]: null, [I]: [I, ["renderFromEditor"]], [E]: null },
  otherBlockTapped: { [B]: null, [I]: null, [E]: [E, ["commitBlock"]] },
  pointerPressedOutside: { [B]: null, [I]: null, [E]: [I, ["commitBlock"]] },
  escapePressed: { [B]: null, [I]: [B, ["hidePalette"]], [E]: [I, []] },
  saveRequested: { [B]: null, [I]: null, [E]: [I, ["commitBlock"]] },
  saveAsRequested: { [B]: null, [I]: null, [E]: [I, ["commitBlock"]] },
  documentReplaced: { [B]: null, [I]: null, [E]: [I, []] },
  documentCleared: { [B]: null, [I]: [B, ["hidePalette"]], [E]: [B, ["hidePalette"]] },
  viewSwitchedToCode: { [B]: null, [I]: [B, ["hidePalette"]], [E]: [B, ["hidePalette"]] },
  fullRenderRequested: { [B]: [B, []], [I]: [I, []], [E]: [I, ["commitBlock"]] },
  editorFocused: { [B]: null, [I]: null, [E]: [I, ["commitBlock"]] },
  // E has a change: [hasUncommittedChange] restores (the else cell is in the details)
  undoRequested: { [B]: null, [I]: [I, ["undoLastCommit"]], [E]: [I, []] },
  // no target: [else] -> editModeIdle / clearSelection, showPalette
  previewDoubleClicked: { [B]: [I, ["showPalette"]], [I]: null, [E]: null },
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
};

const CELLS = Object.entries(TABLE).flatMap(([event, row]) =>
  STATES.map((state) => [IDS[event], event, state, row[state]]),
);

describe("AT-BSM 11-c block edit state machine: all 51 cells", () => {
  it("covers 17 events x 3 states", () => {
    expect(CELLS).toHaveLength(51);
  });

  it.each(CELLS)("%s %s in %s", async (_id, event, state, cell) => {
    await inState(state);
    const spies = spyAll();
    const body = s.orchestrator.getBody();
    const stimulus = DOM_STIMULI[event]?.[state];
    const ret = stimulus ? stimulus() : s.bec.dispatch(event);
    await ret;
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
  });
});

describe("AT-BSM-15 the blockEditStateMachine definition matches the spec", () => {
  it("11-b: the spec diagram shows exactly the transitions of the table", () => {
    expect(diagramTransitions("11-c")).toEqual(tableTransitions(blockEditStateMachine));
  });

  it("guards are evaluated in the order of the spec", () => {
    const u = blockEditStateMachine.undoRequested[E];
    expect(u.map((c) => [c.to, c.guard ?? "else", c.actions])).toEqual([
      [I, "hasUncommittedChange", ["restoreOriginalRaw"]],
      [I, "else", ["commitBlock", "undoLastUnit"]],
    ]);
    const d = blockEditStateMachine.previewDoubleClicked[B];
    expect(d.map((c) => [c.to, c.guard ?? "else", c.actions])).toEqual([
      [I, "hasUnrenderedEditor", ["clearSelection", "showPalette", "renderFromEditor", "showToast"]],
      [E, "isEmptyDocument", ["clearSelection", "showPalette", "openBlockEditor"]],
      [E, "isBlockTarget", ["clearSelection", "showPalette", "openBlockEditor"]],
      [I, "else", ["clearSelection", "showPalette"]],
    ]);
    expect(blockEditStateMachine.undoRequested[I]).toMatchObject({ to: I, actions: ["undoLastUnit"] });
  });
});

describe("AT-BSM cell details", () => {
  it("AT-BSM-02 paletteHidden while editing commits first (the model has the text before the call returns)", async () => {
    await inState(E);
    s.host.shown = false;
    s.bec.dispatch("paletteHidden");
    expect(s.orchestrator.getBody()).toBe("# Title\n\nHello changed.\n\nSecond para.\n");
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

  it("AT-BSM-08 Esc while editing restores the original raw; during IME it does nothing (guard isImeIdle)", async () => {
    await inState(E);
    const ta = s.editor();
    ta.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    s.bec.dispatch("escapePressed");
    expect(s.bec.isEditing()).toBe(true);
    ta.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    s.bec.dispatch("escapePressed");
    expect(s.bec.isEditing()).toBe(false);
    expect(helloEl().firstElementChild.textContent).toBe("Hello world.");
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
    expect(s.orchestrator.getBody()).toBe("# Title\n\nHello changed.\n\nSecond para.\n");
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

  it("AT-BSM-17 undoRequested in editingBlock with a change restores the raw and keeps the record (INV-48 (1))", async () => {
    s = await setupEdit(DOC);
    tap(helloEl().firstElementChild);
    s.editor().value = "Hello changed.";
    pointer(document.body, "pointerdown");
    tap(secondEl().firstElementChild);
    s.editor().value = "Second changed.";
    s.bec.dispatch("undoRequested");
    expect(s.editor()).toBeNull();
    expect(s.orchestrator.getBody()).toBe("# Title\n\nHello changed.\n\nSecond para.\n");
    expect(s.orchestrator.canUndo()).toBe(true);
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
  it("has the same 17 events, and the same next state in all 51 cells (the first alternative of a choice)", () => {
    expect(Object.keys(blockEditStateMachine).sort()).toEqual(Object.keys(TABLE).sort());
    for (const [event, row] of Object.entries(TABLE)) {
      for (const state of STATES) {
        const def = blockEditStateMachine[event][state];
        if (row[state] === null) expect(def, `${event} x ${state}`).toBeNull();
        else {
          const cells = Array.isArray(def) ? def : [def];
          const expected = event === "previewDoubleClicked" ? cells[cells.length - 1] : cells[0];
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
    expect(act("escapePressed", I)).toEqual(["hidePalette"]);
    expect(act("escapePressed", E)).toEqual(["restoreOriginalRaw"]);
    expect(blockEditStateMachine.escapePressed[E].guard).toBe("isImeIdle");
    expect(act("documentReplaced", E)).toEqual(["discardBlockEditor"]);
    expect(act("documentCleared", E)).toEqual(["discardBlockEditor", "hidePalette"]);
    expect(act("viewSwitchedToCode", E)).toEqual(["discardBlockEditor", "hidePalette"]);
    expect(act("fullRenderRequested", B)).toEqual(["enqueueFullRender"]);
    expect(act("fullRenderRequested", E)).toEqual(["commitBlock", "enqueueFullRender"]);
    expect(act("editorFocused", E)).toEqual(["commitBlock"]);
    expect(act("pointerPressedOutside", E)).toEqual(["commitBlock"]);
    expect(act("saveRequested", E)).toEqual(["commitBlock"]);
    expect(act("saveAsRequested", E)).toEqual(["commitBlock"]);
  });
});
