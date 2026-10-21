import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import EditPalette, { paletteGestureStateMachine } from "../js/classes/EditPalette.js";
import { CONFIG } from "../js/config.js";
import { pointer } from "./helpers/editDom.js";
import { fakePaletteLayout, paletteElements, removePaletteElements, centerOf, positionOf } from "./helpers/paletteLayout.js";
import { diagramTransitions, tableTransitions } from "./helpers/specDiagram.js";

// Spec 11-d: every cell of the 13 x 5 table. Each cell is reached through the
// DOM where the DOM can produce the event in that state, and through
// dispatch() otherwise. The next state is read from paletteGestureState (the
// variable the spec names); the effects are seen from outside:
//   capture / release - pointer capture calls
//   moved             - the palette moved
//   timer             - a long press timer is pending after the cell
//   minimized         - the palette was minimized (11-f minimizeToggled)
//   runCommand        - the host ran a command

const IDLE = "idle";
const PRESS = "pressingButton";
const GRIP = "pressingGrip";
const DRAG = "draggingPalette";
const LONG = "longPressHandled";
const END = "[*]";
const STATES = [IDLE, PRESS, GRIP, DRAG, LONG];
const T = CONFIG.pan.activationThresholdPx;

// [next, observable effects] per cell; null = no change.
const TABLE = {
  enabledButtonPressed: { [IDLE]: [PRESS, ["capture"]] },
  disabledButtonPressed: { [IDLE]: [DRAG, ["capture"]] },
  disabledPopoverButtonPressed: {},
  gripPressed: { [IDLE]: [GRIP, ["capture", "timer"]] },
  gapPressed: { [IDLE]: [DRAG, ["capture"]] },
  popoverGapPressed: {},
  pointerMoved: { [GRIP]: [DRAG, ["moved"]], [DRAG]: [DRAG, ["moved"]] },
  longPressElapsed: { [GRIP]: [LONG, ["minimized"]] },
  pointerLeftPressedButton: { [PRESS]: [DRAG, []] },
  pointerReleasedInsideButton: { [PRESS]: [IDLE, ["runCommand"]] },
  pointerReleased: { [PRESS]: [IDLE, []], [GRIP]: [IDLE, []], [DRAG]: [IDLE, []], [LONG]: [IDLE, []] },
  pointerCanceled: { [PRESS]: [IDLE, []], [GRIP]: [IDLE, []], [DRAG]: [IDLE, []], [LONG]: [IDLE, []] },
  paletteHidden: {
    [IDLE]: [END, []],
    [PRESS]: [END, ["release"]],
    [GRIP]: [END, ["release"]],
    [DRAG]: [END, ["release"]],
    [LONG]: [END, ["release"]],
  },
};

let palette;
let host;
let layout;
let root;
let formatMenu;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
  layout = fakePaletteLayout();
  host = { runCommand: vi.fn() };
  palette = new EditPalette(host);
  ({ root, formatMenu } = paletteElements());
});

afterEach(() => {
  palette.hide();
  removePaletteElements();
  layout.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const el = {
  enabled: () => root.querySelector("#paletteTable"),
  disabled: () => root.querySelector("#paletteBold"),
  grip: () => root.querySelector(".edit-palette-grip"),
  popoverEnabled: () => formatMenu.querySelector("#paletteLinkPaste"),
  popoverDisabled: () => formatMenu.querySelector("#paletteColorRed"),
};
const gapOf = (container, dx, dy) => ({ x: positionOf(container).left + dx, y: positionOf(container).top + dy });

/** Show, open the format popover, and go into the state with a palette button (or a popover button). */
function inState(state, { popoverButton = false } = {}) {
  palette.show();
  // Table, Format and Paste link enabled; Bold and the colors disabled.
  palette.setButtonStates({ insertTable: true, format: true, linkPaste: true });
  const f = root.querySelector("#paletteFormat");
  const fc = centerOf(f);
  pointer(f, "pointerdown", { x: fc.x, y: fc.y });
  pointer(f, "pointerup", { x: fc.x, y: fc.y });
  expect(formatMenu.hidden).toBe(false);
  const b = popoverButton ? el.popoverEnabled() : el.enabled();
  const c = centerOf(b);
  const g = centerOf(el.grip());
  if (state === PRESS) pointer(b, "pointerdown", { x: c.x, y: c.y });
  if (state === GRIP || state === DRAG || state === LONG) pointer(el.grip(), "pointerdown", { x: g.x, y: g.y });
  if (state === DRAG) pointer(el.grip(), "pointermove", { x: g.x - 40, y: g.y });
  if (state === LONG) vi.advanceTimersByTime(CONFIG.edit.paletteLongPressMs);
  host.runCommand.mockClear();
  layout.capture.mockClear();
  layout.release.mockClear();
  return { b, c, g };
}

const downAt = (target, x, y, pointerId) => () => pointer(target, "pointerdown", { x, y, pointerId });

/** The DOM stimulus for an event in a state, or null (then dispatch() is used). */
function stimulus(event, state, { b, c, g }) {
  const id = state === IDLE ? 1 : 2; // a second pointer while a gesture runs
  const at = (fn) => {
    const e = fn();
    const p = centerOf(e);
    return downAt(e, p.x, p.y, id);
  };
  switch (event) {
    case "enabledButtonPressed":
      return at(el.enabled);
    case "disabledButtonPressed":
      return at(el.disabled);
    case "disabledPopoverButtonPressed":
      return at(el.popoverDisabled);
    case "gripPressed":
      return at(el.grip);
    case "gapPressed": {
      const p = gapOf(root, 228, 76);
      return downAt(root, p.x, p.y, id);
    }
    case "popoverGapPressed": {
      const p = gapOf(formatMenu, 190, 140);
      return downAt(formatMenu, p.x, p.y, id);
    }
    case "pointerMoved":
      if (state === IDLE) return () => pointer(document.body, "pointermove", { x: 100, y: 100 });
      if (state === PRESS) return () => pointer(b, "pointermove", { x: c.x + 5, y: c.y + 5 });
      if (state === GRIP) return () => pointer(el.grip(), "pointermove", { x: g.x - T - 10, y: g.y });
      return () => pointer(el.grip(), "pointermove", { x: g.x - 100, y: g.y - 50 });
    case "longPressElapsed":
      return state === GRIP ? () => vi.advanceTimersByTime(CONFIG.edit.paletteLongPressMs) : null;
    case "pointerLeftPressedButton":
      return state === PRESS ? () => pointer(b, "pointermove", { x: c.x - 40, y: c.y }) : null;
    case "pointerReleasedInsideButton":
      return state === PRESS ? () => pointer(b, "pointerup", { x: c.x, y: c.y }) : null;
    case "pointerReleased":
      if (state === IDLE) return null;
      return () => pointer(document.body, "pointerup", { x: c.x - 40, y: c.y });
    case "pointerCanceled":
      return () => pointer(document.body, "pointercancel", { x: c.x, y: c.y });
    case "paletteHidden":
      return () => palette.hide();
    default:
      return null;
  }
}

function effectsOf(before, wasMinimized) {
  const effects = [];
  if (layout.capture.mock.calls.length) effects.push("capture");
  if (layout.release.mock.calls.length) effects.push("release");
  if (host.runCommand.mock.calls.length) effects.push("runCommand");
  if (palette.isShown()) {
    // The grip, not the palette: keepGripPosition (11-f) may shift the
    // palette so that the grip stays where it is.
    const after = el.grip().getBoundingClientRect();
    if (after.left !== before.left || after.top !== before.top) effects.push("moved");
  }
  if (vi.getTimerCount() > 0) effects.push("timer");
  if (palette.isShown() && palette.isMinimized() !== wasMinimized) effects.push("minimized");
  return effects.sort();
}

function observedState() {
  if (!palette.isShown()) return END;
  return palette._paletteGestureState;
}

const CELLS = Object.entries(TABLE).flatMap(([event, row]) => STATES.map((state) => [event, state, row[state] ?? null]));

describe("AT-PSM 11-d palette gesture state machine: 13 events x 5 states", () => {
  it("covers 65 cells", () => {
    expect(CELLS).toHaveLength(65);
  });

  it.each(CELLS)("%s in %s", (event, state, cell) => {
    const ctx = inState(state);
    const before = el.grip().getBoundingClientRect();
    const wasMinimized = palette.isMinimized();
    const timerBefore = vi.getTimerCount();
    const act = stimulus(event, state, ctx);
    if (act) act();
    else palette.dispatch(event, { x: 0, y: 0 });
    const effects = effectsOf(before, wasMinimized).filter((e) => e !== "timer" || vi.getTimerCount() !== timerBefore);
    if (cell === null) {
      expect(effects).toEqual([]);
      expect(observedState()).toBe(state);
      return;
    }
    const [next, expected] = cell;
    expect(effects).toEqual([...expected].sort());
    expect(observedState()).toBe(next);
  });
});

describe("AT-PSM guards and the popover variant", () => {
  it("pressingGrip x pointerMoved [hasMovedBeyondThreshold] false: stays, does not move, the timer keeps running", () => {
    const { g } = inState(GRIP);
    const before = positionOf(root);
    pointer(el.grip(), "pointermove", { x: g.x - T, y: g.y });
    expect(observedState()).toBe(GRIP);
    expect(positionOf(root)).toEqual(before);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("pressingGrip x pointerMoved beyond: the long press timer is canceled (cancelLongPressTimer)", () => {
    const { g } = inState(GRIP);
    pointer(el.grip(), "pointermove", { x: g.x - T - 1, y: g.y });
    expect(observedState()).toBe(DRAG);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pressingButton (popover button) x pointerLeftPressedButton [else]: idle / releasePointer, no move", () => {
    const { b, c } = inState(PRESS, { popoverButton: true });
    const before = positionOf(root);
    pointer(b, "pointermove", { x: c.x - 40, y: c.y });
    expect(observedState()).toBe(IDLE);
    expect(layout.release).toHaveBeenCalledTimes(1);
    pointer(b, "pointermove", { x: c.x - 100, y: c.y - 50 });
    expect(positionOf(root)).toEqual(before);
    pointer(b, "pointerup", { x: c.x, y: c.y });
    expect(host.runCommand).not.toHaveBeenCalled();
  });

  it("pressingButton (popover button) x pointerReleasedInsideButton runs the item (11-f popoverItemRun)", () => {
    const { b, c } = inState(PRESS, { popoverButton: true });
    pointer(b, "pointerup", { x: c.x, y: c.y });
    expect(observedState()).toBe(IDLE);
    expect(host.runCommand).toHaveBeenCalledWith("linkPaste", undefined);
    expect(formatMenu.hidden).toBe(true);
  });

  it("pressingGrip x paletteHidden cancels the long press timer", () => {
    inState(GRIP);
    palette.hide();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("AT-PSM-10 the paletteGestureStateMachine definition matches the spec", () => {
  it("has the same events and the same next state in all cells", () => {
    expect(Object.keys(paletteGestureStateMachine).sort()).toEqual(Object.keys(TABLE).sort());
    for (const [event, row] of Object.entries(TABLE)) {
      for (const state of STATES) {
        const def = paletteGestureStateMachine[event][state];
        if (!row[state]) expect(def, `${event} x ${state}`).toBeNull();
        else {
          const first = Array.isArray(def) ? def[0] : def;
          expect(first.to, `${event} x ${state}`).toBe(row[state][0]);
        }
      }
    }
  });

  it("lists the actions and guards of the spec table", () => {
    const act = (event, state) => paletteGestureStateMachine[event][state];
    expect(act("enabledButtonPressed", IDLE).actions).toEqual(["capturePointer"]);
    expect(act("disabledButtonPressed", IDLE).actions).toEqual(["capturePointer", "rememberOffset"]);
    expect(act("gripPressed", IDLE).actions).toEqual(["capturePointer", "rememberOffset", "startLongPressTimer"]);
    expect(act("gapPressed", IDLE).actions).toEqual(["capturePointer", "rememberOffset"]);
    expect(act("pointerMoved", GRIP)).toMatchObject({ guard: "hasMovedBeyondThreshold", actions: ["cancelLongPressTimer", "movePaletteClamped"] });
    expect(act("pointerMoved", DRAG).actions).toEqual(["movePaletteClamped"]);
    expect(act("longPressElapsed", GRIP).actions).toEqual(["requestMinimizeToggle"]);
    const left = act("pointerLeftPressedButton", PRESS);
    expect(left).toHaveLength(2);
    expect(left[0]).toMatchObject({ to: DRAG, guard: "isPaletteButton", actions: ["rememberOffset"] });
    expect(left[1]).toMatchObject({ to: IDLE, actions: ["releasePointer"] });
    expect(left[1].guard).toBeUndefined();
    expect(act("pointerReleasedInsideButton", PRESS).actions).toEqual(["runButtonCommand"]);
    for (const event of ["pointerReleased", "pointerCanceled"]) {
      expect(act(event, PRESS).actions).toEqual([]);
      expect(act(event, GRIP).actions).toEqual(["cancelLongPressTimer"]);
      expect(act(event, DRAG).actions).toEqual([]);
      expect(act(event, LONG).actions).toEqual([]);
    }
    expect(act("paletteHidden", IDLE).actions).toEqual(["releaseListeners"]);
    expect(act("paletteHidden", PRESS).actions).toEqual(["releasePointer", "releaseListeners"]);
    expect(act("paletteHidden", GRIP).actions).toEqual(["cancelLongPressTimer", "releasePointer", "releaseListeners"]);
    expect(act("paletteHidden", DRAG).actions).toEqual(["releasePointer", "releaseListeners"]);
    expect(act("paletteHidden", LONG).actions).toEqual(["releasePointer", "releaseListeners"]);
  });

  it("11-b: the spec diagram shows exactly the transitions of the table", () => {
    expect(diagramTransitions("11-d")).toEqual(tableTransitions(paletteGestureStateMachine));
  });
});
