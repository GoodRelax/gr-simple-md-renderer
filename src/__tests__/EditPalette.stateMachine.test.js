import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import EditPalette, { paletteGestureStateMachine } from "../js/classes/EditPalette.js";
import { pointer } from "./helpers/editDom.js";
import { fakePaletteLayout, paletteElements, centerOf, positionOf } from "./helpers/paletteLayout.js";

// Spec 11-d: every cell of the 9 x 3 table, once with a palette button and
// once with a popover button (5.15.1: the popover uses the same table).
// The state is judged from outside only:
//   idle            = a move does not move the palette, and a release runs nothing
//   pressingButton  = a release inside the pressed button runs the command
//   draggingPalette = a move moves the palette
//   [*]             = the palette is hidden
// Cells the DOM cannot produce in that state (no pressed button in idle, a
// move while dragging is pointerMoved, ...) are reached through dispatch().

const IDLE = "idle";
const PRESS = "pressingButton";
const DRAG = "draggingPalette";
const END = "[*]";
const STATES = [IDLE, PRESS, DRAG];

const TABLE = {
  enabledButtonPressed: { [IDLE]: [PRESS, ["capture"]], [PRESS]: null, [DRAG]: null },
  disabledButtonPressed: { [IDLE]: null, [PRESS]: null, [DRAG]: null },
  gripOrGapPressed: { [IDLE]: [DRAG, ["capture"]], [PRESS]: null, [DRAG]: null },
  pointerMoved: { [IDLE]: null, [PRESS]: null, [DRAG]: [DRAG, ["moved"]] },
  pointerLeftPressedButton: { [IDLE]: null, [PRESS]: [DRAG, []], [DRAG]: null },
  pointerReleasedInsideButton: { [IDLE]: null, [PRESS]: [IDLE, ["runCommand"]], [DRAG]: null },
  pointerReleased: { [IDLE]: null, [PRESS]: [IDLE, []], [DRAG]: [IDLE, []] },
  pointerCanceled: { [IDLE]: null, [PRESS]: [IDLE, []], [DRAG]: [IDLE, []] },
  paletteHidden: { [IDLE]: [END, []], [PRESS]: [END, ["release"]], [DRAG]: [END, ["release"]] },
};

const IDS = {
  enabledButtonPressed: "AT-PSM-01",
  disabledButtonPressed: "AT-PSM-02",
  gripOrGapPressed: "AT-PSM-03",
  pointerMoved: "AT-PSM-04",
  pointerLeftPressedButton: "AT-PSM-05",
  pointerReleasedInsideButton: "AT-PSM-06",
  pointerReleased: "AT-PSM-07",
  pointerCanceled: "AT-PSM-08",
  paletteHidden: "AT-PSM-09",
};

let palette;
let host;
let layout;
let root;
let popover;

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
  layout = fakePaletteLayout();
  host = { runCommand: vi.fn(), focusEditor: vi.fn(() => false), requestHide: vi.fn() };
  palette = new EditPalette(host);
  ({ root, popover } = paletteElements());
});

afterEach(() => {
  palette.hide();
  root.remove();
  popover.remove();
  layout.restore();
  vi.restoreAllMocks();
});

/** The elements one variant presses. */
function variant(kind) {
  if (kind === "palette") {
    return {
      button: () => root.querySelector("#paletteTable"),
      disabled: () => root.querySelector("#paletteBold"),
      gap: () => {
        const grip = root.querySelector(".edit-palette-grip");
        return { el: grip, ...centerOf(grip) };
      },
    };
  }
  return {
    button: () => popover.querySelector('button[aria-label="Flowchart"]'),
    disabled: () => {
      // Popover buttons are never disabled by the UI: set it directly here.
      const b = popover.querySelector('button[aria-label="Class diagram"]');
      b.disabled = true;
      return b;
    },
    gap: () => ({ el: popover, x: positionOf(popover).left + 150, y: positionOf(popover).top + 140 }),
  };
}

function inState(kind, state) {
  palette.show();
  palette.setButtonStates(false, false, false, false); // Bold disabled; Table, Mermaid enabled
  if (kind === "popover") {
    const m = root.querySelector("#paletteMermaid");
    const c = centerOf(m);
    pointer(m, "pointerdown", { x: c.x, y: c.y });
    pointer(m, "pointerup", { x: c.x, y: c.y });
    expect(popover.hidden).toBe(false);
  }
  const v = variant(kind);
  const b = v.button();
  const c = centerOf(b);
  if (state !== IDLE) pointer(b, "pointerdown", { x: c.x, y: c.y });
  if (state === DRAG) pointer(b, "pointermove", { x: c.x - 40, y: c.y });
  host.runCommand.mockClear();
  layout.capture.mockClear();
  layout.release.mockClear();
  return { v, b, c };
}

/** The DOM stimulus for an event in a state, or null (then dispatch() is used). */
function stimulus(event, state, { v, b, c }) {
  const second = { pointerId: 2 };
  switch (event) {
    case "enabledButtonPressed":
      return () => pointer(b, "pointerdown", { x: c.x, y: c.y, ...second, pointerId: state === IDLE ? 1 : 2 });
    case "disabledButtonPressed": {
      return () => {
        const d = v.disabled();
        const dc = centerOf(d);
        pointer(d, "pointerdown", { x: dc.x, y: dc.y, pointerId: state === IDLE ? 1 : 2 });
      };
    }
    case "gripOrGapPressed":
      return () => {
        const g = v.gap();
        pointer(g.el, "pointerdown", { x: g.x, y: g.y, pointerId: state === IDLE ? 1 : 2 });
      };
    case "pointerMoved":
      if (state === IDLE) return () => pointer(document.body, "pointermove", { x: 100, y: 100 });
      if (state === PRESS) return () => pointer(b, "pointermove", { x: c.x + 5, y: c.y + 5 });
      return () => pointer(b, "pointermove", { x: c.x - 100, y: c.y - 50 });
    case "pointerLeftPressedButton":
      return state === PRESS ? () => pointer(b, "pointermove", { x: c.x - 40, y: c.y }) : null;
    case "pointerReleasedInsideButton":
      return state === PRESS ? () => pointer(b, "pointerup", { x: c.x, y: c.y }) : null;
    case "pointerReleased":
      if (state === PRESS) return () => pointer(b, "pointerup", { x: c.x - 40, y: c.y });
      if (state === DRAG) return () => pointer(b, "pointerup", { x: c.x - 40, y: c.y });
      return null;
    case "pointerCanceled":
      return () => pointer(b, "pointercancel", { x: c.x, y: c.y });
    case "paletteHidden":
      return () => palette.hide();
    default:
      return null;
  }
}

/** Observed state; the probe ends any gesture. */
function observedState(b) {
  if (!palette.isShown()) return END;
  host.runCommand.mockClear();
  const before = positionOf(root);
  const c = centerOf(b);
  pointer(b, "pointermove", { x: c.x, y: c.y });
  const moved = positionOf(root).left !== before.left || positionOf(root).top !== before.top;
  const after = centerOf(b);
  pointer(b, "pointerup", { x: after.x, y: after.y });
  if (moved) return DRAG;
  return host.runCommand.mock.calls.length > 0 ? PRESS : IDLE;
}

const CELLS = ["palette", "popover"].flatMap((kind) =>
  Object.entries(TABLE).flatMap(([event, row]) => STATES.map((state) => [IDS[event], kind, event, state, row[state]])),
);

describe("AT-PSM 11-d palette gesture state machine: 27 cells x 2", () => {
  it("covers 9 events x 3 states x 2 (palette and popover buttons)", () => {
    expect(CELLS).toHaveLength(54);
  });

  it.each(CELLS)("%s %s: %s in %s", (_id, kind, event, state, cell) => {
    const ctx = inState(kind, state);
    const before = positionOf(root);
    const act = stimulus(event, state, ctx);
    if (act) act();
    else palette.dispatch(event);

    const effects = [];
    if (layout.capture.mock.calls.length) effects.push("capture");
    if (host.runCommand.mock.calls.length) effects.push("runCommand");
    if (layout.release.mock.calls.length) effects.push("release");
    const after = positionOf(root);
    if (after.left !== before.left || after.top !== before.top) effects.push("moved");

    if (cell === null) {
      expect(effects).toEqual([]);
      expect(observedState(ctx.b)).toBe(state);
      return;
    }
    const [next, expected] = cell;
    expect(effects.sort()).toEqual([...expected].sort());
    expect(observedState(ctx.b)).toBe(next);
  });
});

describe("AT-PSM details", () => {
  it("AT-PSM-06 only the release inside the pressed button runs the command, with its name", () => {
    const { b, c } = inState("palette", PRESS);
    pointer(b, "pointerup", { x: c.x + 13, y: c.y + 13 }); // still inside the 28 px button
    expect(host.runCommand).toHaveBeenCalledWith("insertTable");
  });

  it("AT-PSM-07 release outside without any move event: no command", () => {
    const { b, c } = inState("popover", PRESS);
    pointer(b, "pointerup", { x: c.x, y: c.y + 30 });
    expect(host.runCommand).not.toHaveBeenCalled();
  });

  it("AT-PSM-09 hiding removes the gesture listeners: later moves do nothing", () => {
    const { b, c } = inState("palette", DRAG);
    palette.hide();
    palette.show();
    const before = positionOf(root);
    pointer(b, "pointermove", { x: c.x - 300, y: c.y - 300 });
    expect(positionOf(root)).toEqual(before);
  });
});

describe("AT-PSM-10 the paletteGestureStateMachine definition matches the table", () => {
  it("has the same 9 events and the same next state in all 27 cells", () => {
    expect(Object.keys(paletteGestureStateMachine).sort()).toEqual(Object.keys(TABLE).sort());
    for (const [event, row] of Object.entries(TABLE)) {
      for (const state of STATES) {
        const def = paletteGestureStateMachine[event][state];
        if (row[state] === null) expect(def, `${event} x ${state}`).toBeNull();
        else expect(def.to, `${event} x ${state}`).toBe(row[state][0]);
      }
    }
  });

  it("lists the actions of the spec table", () => {
    const act = (event, state) => paletteGestureStateMachine[event][state].actions;
    expect(act("enabledButtonPressed", IDLE)).toEqual(["capturePointer"]);
    expect(act("gripOrGapPressed", IDLE)).toEqual(["capturePointer", "rememberOffset"]);
    expect(act("pointerMoved", DRAG)).toEqual(["movePaletteClamped"]);
    expect(act("pointerLeftPressedButton", PRESS)).toEqual(["rememberOffset"]);
    expect(act("pointerReleasedInsideButton", PRESS)).toEqual(["runButtonCommand"]);
    expect(act("pointerReleased", PRESS)).toEqual([]);
    expect(act("pointerReleased", DRAG)).toEqual([]);
    expect(act("pointerCanceled", PRESS)).toEqual([]);
    expect(act("pointerCanceled", DRAG)).toEqual([]);
    expect(act("paletteHidden", IDLE)).toEqual(["releaseListeners"]);
    expect(act("paletteHidden", PRESS)).toEqual(["releasePointer", "releaseListeners"]);
    expect(act("paletteHidden", DRAG)).toEqual(["releasePointer", "releaseListeners"]);
  });
});
