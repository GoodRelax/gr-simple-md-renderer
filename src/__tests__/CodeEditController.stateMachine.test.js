import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import CodeEditController, { codeEditModeStateMachine } from "../js/classes/CodeEditController.js";
import CodeEditor from "../js/classes/CodeEditor.js";
import { fakeFileAccess } from "./helpers/fakeFs.js";
import { diagramTransitions, tableTransitions } from "./helpers/specDiagram.js";

// AT-CEM: spec 11-h, the code edit mode (INV-85; review L1). Every cell of
// the 3 x 2 table (and the guard of editToggled) is reached through the
// public API of CodeEditController: toggleEdit (editToggled), stopEditing
// (reloadStarted), opened / close / the commit of a Reload
// (documentReplaced). The state is judged from outside (the editor's DOM,
// the host's calls), and the actions run are the cell's, in its order.

const VIEWING = "viewing";
const EDITING = "editing";
const STATES = [VIEWING, EDITING];
const JSON_TEXT = '{\n  "a": {\n    "b": 1\n  }\n}\n';

const TABLE = {
  editToggled: {
    [VIEWING]: [EDITING, ["dropViewFolds", "startEditor", "showCodePalette"], "canEdit"],
    [EDITING]: [VIEWING, ["stopEditor", "keepEditedText", "drawView", "hideCodePalette"]],
  },
  reloadStarted: {
    [VIEWING]: null,
    [EDITING]: [VIEWING, ["stopEditor", "keepEditedText", "hideCodePalette"]],
  },
  documentReplaced: {
    [VIEWING]: [VIEWING, ["replaceDocument"]],
    [EDITING]: [VIEWING, ["stopEditor", "hideCodePalette", "replaceDocument"]],
  },
};

let preview;
let host;
let ctrl;
let ran;

function makeController({ withFactory = true } = {}) {
  host = {
    toast: vi.fn(),
    confirmOverwrite: vi.fn(async () => true),
    codeFileSaved: vi.fn(),
    reopenAsMarkdown: vi.fn(async () => {}),
    codeEditModeChanged: vi.fn(),
    showCodeText: vi.fn(),
    codeTextChanged: vi.fn(),
    codeTextSettled: vi.fn(),
  };
  const editing = withFactory ? { createEditor: (h) => new CodeEditor(preview, h), highlight: () => null, now: () => 0 } : {};
  ctrl = new CodeEditController(fakeFileAccess(), { askOpen: vi.fn(), askSaveEncoding: vi.fn() }, host, editing);
  ran = [];
  const original = ctrl._runAction.bind(ctrl);
  vi.spyOn(ctrl, "_runAction").mockImplementation((action, input, run) => {
    ran.push(action);
    return original(action, input, run);
  });
}

async function openJson(text = JSON_TEXT, name = "x.json") {
  const doc = await ctrl.read(new File([text], name, { lastModified: 1 }));
  ctrl.opened(doc, null);
}

const textarea = () => preview.querySelector("#codeEditBody textarea.code-edit-input");

/** The state as seen from outside: the editor's DOM in the preview. */
function observedState() {
  expect(ctrl.isEditing()).toBe(textarea() !== null);
  return textarea() ? EDITING : VIEWING;
}

/** Put the controller in a state with a document; editing: "typed" was typed. */
async function inState(state) {
  await openJson();
  ctrl.fold("fold"); // a fold of the view (dropped when editing starts)
  if (state === EDITING) {
    ctrl.toggleEdit();
    const ta = textarea();
    ta.value = JSON_TEXT + "typed";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  for (const fn of Object.values(host)) fn.mockClear();
  ran = [];
}

/** Fire an event through the public API. */
async function fire(event) {
  if (event === "editToggled") ctrl.toggleEdit();
  else if (event === "reloadStarted") ctrl.stopEditing();
  else {
    const reader = ctrl.reloadReader();
    await reader.readText(new File(["[1]\n"], "x.json", { lastModified: 2 }));
    reader.commit();
  }
}

beforeEach(() => {
  preview = document.createElement("div");
  document.body.append(preview);
  makeController();
});

afterEach(() => {
  ctrl.close();
  preview.remove();
  vi.restoreAllMocks();
});

const CELLS = Object.entries(TABLE).flatMap(([event, byState]) => STATES.map((state) => [event, state, byState[state]]));

describe("AT-CEM 11-h code edit mode (INV-85): 3 events x 2 states", () => {
  it("covers 6 cells; the table in the code is the table here", () => {
    expect(CELLS).toHaveLength(6);
    const fromCode = {};
    for (const [event, byState] of Object.entries(codeEditModeStateMachine)) {
      fromCode[event] = {};
      for (const state of STATES) {
        const entry = byState[state];
        const c = Array.isArray(entry) ? entry[0] : entry;
        fromCode[event][state] = c ? [c.to, [...c.actions], ...(c.guard ? [c.guard] : [])] : null;
      }
    }
    expect(fromCode).toEqual(TABLE);
    expect(Object.isFrozen(codeEditModeStateMachine)).toBe(true);
  });

  it.each(CELLS)("%s in %s", async (event, state, cell) => {
    await inState(state);
    expect(observedState()).toBe(state);
    const editedText = state === EDITING ? JSON_TEXT + "typed" : null;
    await fire(event);
    if (cell === null) {
      expect(ran).toEqual([]);
      expect(observedState()).toBe(state);
      expect([host.codeEditModeChanged.mock.calls, host.showCodeText.mock.calls]).toEqual([[], []]);
      return;
    }
    const [next, actions] = cell;
    expect(ran).toEqual(actions);
    expect(observedState()).toBe(next);
    // the actions, seen from outside
    expect(host.codeEditModeChanged.mock.calls).toEqual([
      ...(actions.includes("showCodePalette") ? [[true]] : []),
      ...(actions.includes("hideCodePalette") ? [[false]] : []),
    ]);
    expect(host.showCodeText.mock.calls).toEqual(actions.includes("drawView") ? [[editedText, true]] : []);
    if (actions.includes("startEditor")) expect(textarea().value).toBe(JSON_TEXT); // the view's fold dropped
    if (actions.includes("replaceDocument")) {
      expect([ctrl.currentText(), ctrl.isDirty(), ctrl.canUndo(), ctrl.shownText()]).toEqual(["[1]\n", false, false, "[1]\n"]);
    } else if (actions.includes("keepEditedText")) {
      expect([ctrl.currentText(), ctrl.isDirty()]).toEqual([editedText, true]);
    }
  });
});

describe("AT-CEM guards and other ways in (INV-85 (8))", () => {
  it("editToggled in viewing, canEdit false (no document, or no editor factory): nothing", async () => {
    ctrl.toggleEdit();
    expect([observedState(), ran]).toEqual([VIEWING, []]);
    makeController({ withFactory: false });
    await openJson();
    ran = [];
    ctrl.toggleEdit();
    expect([ctrl.isEditing(), ran, host.codeEditModeChanged.mock.calls]).toEqual([false, [], []]);
  });

  it("documentReplaced also by opened and close: the same cells", async () => {
    await inState(EDITING);
    await openJson("[2]\n", "y.json");
    expect(ran).toEqual(TABLE.documentReplaced[EDITING][1]);
    expect([observedState(), ctrl.currentText(), ctrl.canUndo()]).toEqual([VIEWING, "[2]\n", false]);
    ran = [];
    ctrl.close();
    expect(ran).toEqual(TABLE.documentReplaced[VIEWING][1]);
    expect([ctrl.hasDocument(), ctrl.isDirty()]).toEqual([false, false]);
  });

  it("an unknown guard or action is an error (the table and the code cannot drift apart)", () => {
    expect(() => ctrl._isGuardTrue("isNothing")).toThrow();
    expect(() => ctrl._runAction("doNothing", {}, { text: "" })).toThrow();
  });
});

describe("AT-CEM the codeEditModeStateMachine definition matches the spec (11-h, INV-85)", () => {
  it("11-b: the spec diagram shows exactly the transitions of the table", () => {
    expect(diagramTransitions("11-h")).toEqual(tableTransitions(codeEditModeStateMachine));
  });
});
