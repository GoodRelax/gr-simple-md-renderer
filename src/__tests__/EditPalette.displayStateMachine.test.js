import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import EditPalette, { paletteDisplayStateMachine } from "../js/classes/EditPalette.js";
import { CONFIG } from "../js/config.js";
import { pointer, keydown } from "./helpers/editDom.js";
import {
  fakePaletteLayout,
  paletteElements,
  removePaletteElements,
  centerOf,
  positionOf,
  PALETTE_SIZE,
  MINIMIZED_SIZE,
} from "./helpers/paletteLayout.js";
import { diagramTransitions, tableTransitions } from "./helpers/specDiagram.js";

// Spec 11-f: every cell of the 11 x 6 table, reached through the DOM where
// the DOM can produce the event in that state and through dispatchDisplay()
// otherwise. The state is judged from outside: the palette shown or hidden,
// minimized or not, which popover is open (and its opener's aria-expanded);
// runItemCommand is seen on the host.

const HIDDEN = "hidden";
const EXPANDED = "expanded";
const MERMAID = "mermaidMenuOpen";
const FORMAT = "formatMenuOpen";
const TABLE_OPEN = "tableMenuOpen";
const MIN = "minimized";
const STATES = [HIDDEN, EXPANDED, MERMAID, FORMAT, TABLE_OPEN, MIN];
const MENUS = [MERMAID, FORMAT, TABLE_OPEN];

const menuRow = (to, extra = []) => Object.fromEntries(MENUS.map((m) => [m, [to, extra]]));
const TABLE = {
  paletteShown: { [HIDDEN]: [EXPANDED, []] },
  paletteHidden: { [EXPANDED]: [HIDDEN, []], ...menuRow(HIDDEN), [MIN]: [HIDDEN, []] },
  minimizeToggled: { [EXPANDED]: [MIN, []], ...menuRow(MIN), [MIN]: [EXPANDED, []] },
  mermaidButtonRun: { [EXPANDED]: [MERMAID, []], [MERMAID]: [EXPANDED, []], [FORMAT]: [MERMAID, []], [TABLE_OPEN]: [MERMAID, []] },
  formatButtonRun: { [EXPANDED]: [FORMAT, []], [MERMAID]: [FORMAT, []], [FORMAT]: [EXPANDED, []], [TABLE_OPEN]: [FORMAT, []] },
  tableOptionsButtonRun: { [EXPANDED]: [TABLE_OPEN, []], [MERMAID]: [TABLE_OPEN, []], [FORMAT]: [TABLE_OPEN, []], [TABLE_OPEN]: [EXPANDED, []] },
  popoverItemRun: menuRow(EXPANDED, ["runCommand"]),
  popoverEscapePressed: menuRow(EXPANDED),
  pointerPressedOutsidePalette: menuRow(EXPANDED),
  openerDisabled: menuRow(EXPANDED),
  viewportResized: {
    [EXPANDED]: [EXPANDED, []],
    [MERMAID]: [MERMAID, []],
    [FORMAT]: [FORMAT, []],
    [TABLE_OPEN]: [TABLE_OPEN, []],
    [MIN]: [MIN, []],
  },
};

const ALL_ON = { format: true, insertMermaid: true, tableOptions: true, textColor: true, linkPaste: true, linkRemove: true };
const OPENER = { [MERMAID]: "paletteMermaid", [FORMAT]: "paletteFormat", [TABLE_OPEN]: "paletteTableOptions" };
const STATE_KEY = { [MERMAID]: "insertMermaid", [FORMAT]: "format", [TABLE_OPEN]: "tableOptions" };

let palette;
let host;
let layout;
let els;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
  layout = fakePaletteLayout();
  host = { runCommand: vi.fn() };
  palette = new EditPalette(host);
  els = paletteElements();
});

afterEach(() => {
  palette.hide();
  removePaletteElements();
  layout.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const btn = (id) => els.root.querySelector(`#${id}`);
const menuEl = (state) => ({ [MERMAID]: els.popover, [FORMAT]: els.formatMenu, [TABLE_OPEN]: els.tableMenu })[state];

function press(el) {
  const c = centerOf(el);
  pointer(el, "pointerdown", { x: c.x, y: c.y });
  pointer(el, "pointerup", { x: c.x, y: c.y });
}

function longPressGrip() {
  const g = els.root.querySelector(".edit-palette-grip");
  const c = centerOf(g);
  pointer(g, "pointerdown", { x: c.x, y: c.y });
  vi.advanceTimersByTime(CONFIG.edit.paletteLongPressMs);
  pointer(g, "pointerup", { x: c.x, y: c.y });
}

function inState(state) {
  palette.setButtonStates(ALL_ON);
  if (state === HIDDEN) return;
  palette.show();
  palette.setButtonStates(ALL_ON);
  if (OPENER[state]) press(btn(OPENER[state]));
  if (state === MIN) longPressGrip();
  host.runCommand.mockClear();
}

/** The DOM stimulus for an event in a state, or null (then dispatchDisplay() is used). */
function stimulus(event, state) {
  switch (event) {
    case "paletteShown":
      return () => palette.show();
    case "paletteHidden":
      return () => palette.hide();
    case "minimizeToggled":
      return state === HIDDEN ? null : longPressGrip;
    case "mermaidButtonRun":
      return state === HIDDEN || state === MIN ? null : () => press(btn("paletteMermaid"));
    case "formatButtonRun":
      return state === HIDDEN || state === MIN ? null : () => press(btn("paletteFormat"));
    case "tableOptionsButtonRun":
      return state === HIDDEN || state === MIN ? null : () => press(btn("paletteTableOptions"));
    case "popoverItemRun":
      return MENUS.includes(state) ? () => press(menuEl(state).querySelector("button")) : null;
    case "popoverEscapePressed":
      return state === HIDDEN ? null : () => keydown(document.body, "Escape");
    case "pointerPressedOutsidePalette":
      return state === HIDDEN ? null : () => pointer(document.body, "pointerdown");
    case "openerDisabled":
      return MENUS.includes(state) ? () => palette.setButtonStates({ ...ALL_ON, [STATE_KEY[state]]: false }) : null;
    case "viewportResized":
      return state === HIDDEN ? null : () => window.dispatchEvent(new Event("resize"));
    default:
      return null;
  }
}

/** The state as seen from outside. */
function observedState() {
  const open = MENUS.filter((m) => !menuEl(m).hidden);
  for (const m of MENUS) expect(btn(OPENER[m]).getAttribute("aria-expanded"), m).toBe(String(open.includes(m)));
  if (els.root.hidden) {
    expect(open).toEqual([]);
    expect(els.root.classList.contains("edit-palette-minimized")).toBe(false);
    return HIDDEN;
  }
  if (els.root.classList.contains("edit-palette-minimized")) {
    expect(open).toEqual([]);
    return MIN;
  }
  expect(open.length).toBeLessThanOrEqual(1);
  return open[0] ?? EXPANDED;
}

const CELLS = Object.entries(TABLE).flatMap(([event, row]) => STATES.map((state) => [event, state, row[state] ?? null]));

describe("AT-PDS 11-f palette display state machine: 11 events x 6 states", () => {
  it("covers 66 cells", () => {
    expect(CELLS).toHaveLength(66);
  });

  it.each(CELLS)("%s in %s", (event, state, cell) => {
    inState(state);
    expect(observedState()).toBe(state);
    const act = stimulus(event, state);
    if (act) act();
    else palette.dispatchDisplay(event, { command: "probe" });
    const effects = host.runCommand.mock.calls.length ? ["runCommand"] : [];
    if (cell === null) {
      expect(effects).toEqual([]);
      expect(observedState()).toBe(state);
      return;
    }
    const [next, expected] = cell;
    expect(effects).toEqual(expected);
    expect(observedState()).toBe(next);
    expect(palette.isShown()).toBe(next !== HIDDEN);
    expect(palette.isMinimized()).toBe(next === MIN);
  });
});

describe("AT-PDS actions", () => {
  it("placeAtBottomRight on paletteShown, also after a minimized palette was hidden (restoreExpandedLayout)", () => {
    inState(MIN);
    palette.hide();
    palette.show();
    expect(positionOf(els.root)).toEqual({
      left: 1024 - PALETTE_SIZE.width - CONFIG.edit.paletteMarginPx,
      top: 768 - PALETTE_SIZE.height - CONFIG.edit.paletteMarginPx,
    });
  });

  it("keepGripPosition: the grip stays where it was when minimizing and restoring", () => {
    inState(FORMAT);
    const grip = els.root.querySelector(".edit-palette-grip");
    const before = grip.getBoundingClientRect();
    palette.dispatchDisplay("minimizeToggled");
    expect(grip.getBoundingClientRect().left).toBe(before.left);
    expect(grip.getBoundingClientRect().top).toBe(before.top);
    palette.dispatchDisplay("minimizeToggled");
    expect(grip.getBoundingClientRect().left).toBe(before.left);
    expect(grip.getBoundingClientRect().top).toBe(before.top);
  });

  it("viewportResized in minimized keeps it inside (clampIntoViewport)", () => {
    inState(MIN);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 300 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
    window.dispatchEvent(new Event("resize"));
    expect(positionOf(els.root)).toEqual({ left: 300 - MINIMIZED_SIZE.width, top: 200 - MINIMIZED_SIZE.height });
    expect(palette.isMinimized()).toBe(true);
  });

  it("runItemCommand passes the item's command and argument", () => {
    inState(TABLE_OPEN);
    press(els.tableMenu.querySelector("#paletteAlignRight"));
    expect(host.runCommand).toHaveBeenCalledWith("alignColumn", "right");
  });

  it("openerDisabled only for the open popover's opener; other buttons becoming disabled keep it open", () => {
    inState(FORMAT);
    palette.setButtonStates({ ...ALL_ON, insertMermaid: false, tableOptions: false, textColor: false });
    expect(observedState()).toBe(FORMAT);
    palette.setButtonStates({ ...ALL_ON, format: false });
    expect(observedState()).toBe(EXPANDED);
  });

  it("an unknown event throws", () => {
    expect(() => palette.dispatchDisplay("noSuchEvent")).toThrow();
  });
});

describe("AT-PDS-10 the paletteDisplayStateMachine definition matches the spec", () => {
  it("has the same events and the same next state in all cells", () => {
    expect(Object.keys(paletteDisplayStateMachine).sort()).toEqual(Object.keys(TABLE).sort());
    for (const [event, row] of Object.entries(TABLE)) {
      for (const state of STATES) {
        const def = paletteDisplayStateMachine[event][state];
        if (!row[state]) expect(def, `${event} x ${state}`).toBeNull();
        else expect(def.to, `${event} x ${state}`).toBe(row[state][0]);
      }
    }
  });

  it("lists the actions of the spec table", () => {
    const act = (event, state) => paletteDisplayStateMachine[event][state].actions;
    expect(act("paletteShown", HIDDEN)).toEqual(["placeAtBottomRight"]);
    expect(act("paletteHidden", EXPANDED)).toEqual([]);
    for (const m of MENUS) {
      expect(act("paletteHidden", m)).toEqual(["closePopover"]);
      expect(act("minimizeToggled", m)).toEqual(["closePopover", "keepGripPosition"]);
      expect(act("popoverItemRun", m)).toEqual(["closePopover", "runItemCommand"]);
      expect(act("popoverEscapePressed", m)).toEqual(["closePopover"]);
      expect(act("pointerPressedOutsidePalette", m)).toEqual(["closePopover"]);
      expect(act("openerDisabled", m)).toEqual(["closePopover"]);
      expect(act("viewportResized", m)).toEqual(["clampIntoViewport", "placePopover"]);
    }
    expect(act("paletteHidden", MIN)).toEqual(["restoreExpandedLayout"]);
    expect(act("minimizeToggled", EXPANDED)).toEqual(["keepGripPosition"]);
    expect(act("minimizeToggled", MIN)).toEqual(["keepGripPosition", "clampIntoViewport"]);
    const runs = { mermaidButtonRun: MERMAID, formatButtonRun: FORMAT, tableOptionsButtonRun: TABLE_OPEN };
    for (const [event, own] of Object.entries(runs)) {
      expect(act(event, EXPANDED)).toEqual(["openPopover"]);
      for (const m of MENUS) expect(act(event, m)).toEqual(m === own ? ["closePopover"] : ["closePopover", "openPopover"]);
    }
    expect(act("viewportResized", EXPANDED)).toEqual(["clampIntoViewport"]);
    expect(act("viewportResized", MIN)).toEqual(["clampIntoViewport"]);
  });

  it("11-b: the spec diagram shows exactly the transitions of the table", () => {
    expect(diagramTransitions("11-f")).toEqual(tableTransitions(paletteDisplayStateMachine));
  });
});
