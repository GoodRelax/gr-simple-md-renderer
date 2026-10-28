import { CONFIG } from "../config.js";
import { nextFrame, cancelFrame, isPastActivation } from "../utils.js";
import { cell, row, choice, selectCell } from "../stateTable.js";

// 11-d gesture states
const IDLE = "idle";
const PRESS = "pressingButton";
const GRIP = "pressingGrip";
const DRAG = "draggingPalette";
const LONG = "longPressHandled";
const END = "[*]";

// 11-f display states
const HIDDEN = "hidden";
const EXPANDED = "expanded";
const MERMAID_OPEN = "mermaidMenuOpen";
const FORMAT_OPEN = "formatMenuOpen";
const TABLE_OPEN = "tableMenuOpen";
const MINIMIZED = "minimized";

// Tooltips and aria-labels (config.js, R15)
const L = CONFIG.messages.palette;

const POPOVER_GAP_PX = 4;
const MINIMIZED_CLASS = "edit-palette-minimized";
const UNSAVED_CLASS = "edit-palette-unsaved";

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';

// Icons of spec 5.15.3, inlined in each button (no <use>, no external
// reference: a user-written id="i-bold" in the preview must not change them).
const ICONS = {
  bold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"><path d="M7 5h5.5a3.5 3.5 0 0 1 0 7H7zM7 12h6.5a3.5 3.5 0 0 1 0 7H7z"/></svg>',
  italic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M11 5h7M6 19h7M15 5l-6 14"/></svg>',
  format: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M6.5 16L12 3.5 17.5 16M8.6 11.5h6.8"/><path d="M4 20.5h16" stroke-width="2.6"/></svg>`,
  table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 9.5h17M3.5 14.2h17M9.2 5v14M14.8 5v14"/></svg>',
  row: `<svg viewBox="0 0 24 24" ${STROKE}><rect x="3.5" y="3" width="17" height="10" rx="1.5"/><path d="M3.5 8h17M9.2 3v10M14.8 3v10M12 15.5v6M9 18.5h6"/></svg>`,
  rowDelete: `<svg viewBox="0 0 24 24" ${STROKE}><rect x="3.5" y="3" width="17" height="10" rx="1.5"/><path d="M3.5 8h17M9.2 3v10M14.8 3v10M8.5 18.5h7"/></svg>`,
  col: `<svg viewBox="0 0 24 24" ${STROKE}><rect x="3" y="3.5" width="10" height="17" rx="1.5"/><path d="M8 3.5v17M3 9.2h10M3 14.8h10M15.5 12h6M18.5 9v6"/></svg>`,
  colDelete: `<svg viewBox="0 0 24 24" ${STROKE}><rect x="3" y="3.5" width="10" height="17" rx="1.5"/><path d="M8 3.5v17M3 9.2h10M3 14.8h10M15 12h7"/></svg>`,
  tableOptions: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M4 6h16M7 10h10M4 14h16M7 18h10"/></svg>`,
  mermaid: `<svg viewBox="0 0 24 24" ${STROKE}><rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/></svg>`,
  save: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg>`,
  saveas: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M11.5 20H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10l3 3v3.5"/><path d="M8 4v5h7V4M8 20v-6h4"/><path d="M14 21l.7-2.8 4.8-4.8a1.4 1.4 0 0 1 2 2l-4.8 4.8z"/></svg>`,
  grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
  seq: `<svg viewBox="0 0 24 24" ${STROKE}><rect x="2.5" y="2.5" width="7" height="4" rx="1"/><rect x="14.5" y="2.5" width="7" height="4" rx="1"/><path d="M6 6.5v15M18 6.5v15" stroke-dasharray="2 2"/><path d="M6 11h11.5M15.5 9l2 2-2 2M18 17H6.5M8.5 15l-2 2 2 2"/></svg>`,
  state: `<svg viewBox="0 0 24 24" ${STROKE}><rect x="2.5" y="3.5" width="9" height="6" rx="3"/><rect x="12.5" y="14.5" width="9" height="6" rx="3"/><path d="M11.5 6.5h5a3 3 0 0 1 3 3v3M17.5 10.5l2 2 2-2M12.5 17.5h-5a3 3 0 0 1-3-3v-3M2.5 13.5l2-2 2 2"/></svg>`,
  submenu: '<svg class="edit-palette-submenu" viewBox="0 0 6 6" fill="currentColor"><path d="M6 0v6H0z"/></svg>',
  class: `<svg viewBox="0 0 24 24" ${STROKE}><rect x="7" y="2.5" width="10" height="9" rx="1"/><path d="M7 5.5h10M7 8.5h10"/><rect x="2.5" y="16" width="7" height="5.5" rx="1"/><rect x="14.5" y="16" width="7" height="5.5" rx="1"/><path d="M12 11.5l-1.7 2.6h3.4z"/><path d="M12 14.1v.4M6 16v-1.5h12V16"/></svg>`,
  undo: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>`,
  colorNone: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M6.5 18L12 5.5 17.5 18M8.6 13.5h6.8M4 21L20 3"/></svg>`,
  colorSwatch: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="7"/></svg>',
  linkPaste: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>`,
  linkRemove: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/><path d="M4 4l16 16"/></svg>`,
  alignLeft: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M4 6h16M4 10h10M4 14h16M4 18h10"/></svg>`,
  alignCenter: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M4 6h16M7 10h10M4 14h16M7 18h10"/></svg>`,
  alignRight: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M4 6h16M10 10h10M4 14h16M10 18h10"/></svg>`,
  alignNone: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M3 12h4M10 12h4M17 12h4"/></svg>`,
  mathInline: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M17 5H7l5.5 7L7 19h10"/></svg>`,
  mathBox: `<svg viewBox="0 0 24 24" ${STROKE}><rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M15.5 8h-7l4 4-4 4h7"/></svg>`,
};

// Popovers (5.15.1, 11-f). stateKey: the key of setButtonStates(); null = always enabled.
// A popover of more rows (Text format: the formats, then the math) has rows
// instead of items.
const POPOVERS = {
  mermaid: {
    id: "paletteMermaidMenu",
    label: L.mermaidMenu,
    openState: MERMAID_OPEN,
    runEvent: "mermaidButtonRun",
    items: [
      { command: "insertMermaid", arg: "flowchart", label: L.flowchart, icon: "mermaid", stateKey: null },
      { command: "insertMermaid", arg: "sequence", label: L.sequence, icon: "seq", stateKey: null },
      { command: "insertMermaid", arg: "state", label: L.state, icon: "state", stateKey: null },
      { command: "insertMermaid", arg: "class", label: L.class, icon: "class", stateKey: null },
    ],
  },
  format: {
    id: "paletteFormatMenu",
    label: L.format,
    openState: FORMAT_OPEN,
    runEvent: "formatButtonRun",
    rows: [
      [
        { id: "paletteColorRed", command: "textColor", arg: "red", label: L.colorRed, icon: "colorSwatch", stateKey: "textColor" },
        { id: "paletteColorBlue", command: "textColor", arg: "blue", label: L.colorBlue, icon: "colorSwatch", stateKey: "textColor" },
        { id: "paletteColorGreen", command: "textColor", arg: "green", label: L.colorGreen, icon: "colorSwatch", stateKey: "textColor" },
        { id: "paletteColorNone", command: "textColor", arg: "none", label: L.colorNone, icon: "colorNone", stateKey: "textColor" },
        { id: "paletteLinkPaste", command: "linkPaste", label: L.linkPaste, icon: "linkPaste", stateKey: "linkPaste" },
        { id: "paletteLinkRemove", command: "linkRemove", label: L.linkRemove, icon: "linkRemove", stateKey: "linkRemove" },
      ],
      [
        // owner ruling 2026-10-25: inline math, and the three math boxes in one press
        { id: "paletteInlineMath", command: "insertInlineMath", label: L.inlineMath, icon: "mathInline", stateKey: "insertInlineMath" },
        { id: "paletteMathBox", command: "insertMathBox", label: L.mathBox, icon: "mathBox", stateKey: "insertMathBox" },
      ],
    ],
  },
  table: {
    id: "paletteTableMenu",
    label: L.tableOptions,
    openState: TABLE_OPEN,
    runEvent: "tableOptionsButtonRun",
    items: [
      { id: "paletteAlignLeft", command: "alignColumn", arg: "left", label: L.alignLeft, icon: "alignLeft", stateKey: "tableOptions" },
      { id: "paletteAlignCenter", command: "alignColumn", arg: "center", label: L.alignCenter, icon: "alignCenter", stateKey: "tableOptions" },
      { id: "paletteAlignRight", command: "alignColumn", arg: "right", label: L.alignRight, icon: "alignRight", stateKey: "tableOptions" },
      { id: "paletteAlignNone", command: "alignColumn", arg: "none", label: L.alignNone, icon: "alignNone", stateKey: "tableOptions" },
    ],
  },
};

/**
 * Palette layout (5.15.1): 7 columns x 2 rows, no separators. mod is the
 * primary modifier shown in the tooltips ("Ctrl", or "Cmd" on Apple platforms).
 * The labels come from CONFIG.messages.palette.
 * @purity semi-pure-a
 * @param {string} mod
 * @returns {Array<Array<object|string>>}
 */
function paletteRows(mod) {
  return [
    [
      "grip",
      { id: "paletteBold", command: "bold", label: L.bold(mod), icon: "bold", stateKey: "bold" },
      { id: "paletteItalic", command: "italic", label: L.italic(mod), icon: "italic", stateKey: "italic" },
      { id: "paletteFormat", command: "openPopover", popover: "format", label: L.format, icon: "format", stateKey: "format" },
      { id: "paletteMermaid", command: "openPopover", popover: "mermaid", label: L.mermaid, icon: "mermaid", stateKey: "insertMermaid" },
      { id: "paletteSave", command: "save", label: L.save(mod), icon: "save", stateKey: null },
      { id: "paletteSaveAs", command: "saveAs", label: L.saveAs(mod), icon: "saveas", stateKey: null },
    ],
    [
      { id: "paletteTable", command: "insertTable", label: L.insertTable, icon: "table", stateKey: "insertTable" },
      { id: "paletteRow", command: "insertRow", label: L.insertRow, icon: "row", stateKey: "insertRow" },
      { id: "paletteRowDelete", command: "rowDelete", label: L.rowDelete, icon: "rowDelete", stateKey: "rowDelete" },
      { id: "paletteColumn", command: "insertColumn", label: L.insertColumn, icon: "col", stateKey: "insertColumn" },
      { id: "paletteColumnDelete", command: "columnDelete", label: L.columnDelete, icon: "colDelete", stateKey: "columnDelete" },
      { id: "paletteTableOptions", command: "openPopover", popover: "table", label: L.tableOptions, icon: "tableOptions", stateKey: "tableOptions" },
      { id: "paletteUndo", command: "undo", label: L.undo(mod), icon: "undo", stateKey: "undo" },
    ],
  ];
}

/**
 * A touch or pen press on the grip that comes soon enough after the last
 * grip tap of the same pointer type (PD1, PD2): the time between the two
 * presses is at most CONFIG.edit.paletteDoubleTapMs. A mouse is left to the
 * browser's dblclick (the OS double-click time).
 * @purity semi-pure-a
 * @param {{pointerType: string, time: number}|null} lastTap
 * @param {{pointerType: string, time: number}} press
 * @param {object} [limits] - CONFIG.edit
 * @returns {boolean}
 */
export function isQuickSecondGripTap(lastTap, press, limits = CONFIG.edit) {
  if (!lastTap || press.pointerType === "mouse" || lastTap.pointerType !== press.pointerType) return false;
  const interval = press.time - lastTap.time;
  return interval >= 0 && interval <= limits.paletteDoubleTapMs;
}

const GESTURE_STATES = [IDLE, PRESS, GRIP, DRAG, LONG];
const gesture = (...cells) => row(GESTURE_STATES, cells);

/** Spec 11-d: event -> current state -> cell. "[*]" ends the gesture handling (hidden). */
export const paletteGestureStateMachine = Object.freeze({
  enabledButtonPressed: gesture(cell(PRESS, ["forgetGripTap", "capturePointer"])),
  disabledButtonPressed: gesture(cell(DRAG, ["forgetGripTap", "capturePointer", "rememberOffset"])),
  disabledPopoverButtonPressed: gesture(cell(IDLE, ["forgetGripTap"])),
  gripPressed: gesture(cell(GRIP, ["capturePointer", "rememberOffset", "startLongPressTimer"])),
  gapPressed: gesture(cell(DRAG, ["forgetGripTap", "capturePointer", "rememberOffset"])),
  popoverGapPressed: gesture(cell(IDLE, ["forgetGripTap"])),
  pointerPressedOutsidePalette: gesture(cell(IDLE, ["forgetGripTap"])),
  pointerMoved: gesture(
    null,
    null,
    cell(DRAG, ["cancelLongPressTimer", "forgetGripTap", "movePaletteClamped"], "hasMovedBeyondThreshold"),
    cell(DRAG, ["movePaletteClamped"]),
    null,
  ),
  longPressElapsed: gesture(null, null, cell(LONG, ["forgetGripTap", "requestMinimizeToggle"])),
  gripDoubleClicked: gesture(cell(IDLE, ["forgetGripTap", "requestMinimizeToggle"], "isSecondMouseGripTap")),
  pointerLeftPressedButton: gesture(
    null,
    choice(cell(DRAG, ["rememberOffset"], "isPaletteButton"), cell(IDLE, ["releasePointer"])),
  ),
  pointerReleasedInsideButton: gesture(null, cell(IDLE, ["runButtonCommand"])),
  pointerReleased: gesture(
    null,
    cell(IDLE, []),
    choice(
      cell(IDLE, ["cancelLongPressTimer", "forgetGripTap", "requestMinimizeToggle"], "isQuickSecondGripTap"),
      cell(IDLE, ["cancelLongPressTimer", "rememberGripTap"]),
    ),
    cell(IDLE, []),
    cell(IDLE, []),
  ),
  pointerCanceled: gesture(null, cell(IDLE, []), cell(IDLE, ["cancelLongPressTimer", "forgetGripTap"]), cell(IDLE, []), cell(IDLE, [])),
  paletteHidden: gesture(
    cell(END, ["forgetGripTap", "releaseListeners"]),
    cell(END, ["forgetGripTap", "releasePointer", "releaseListeners"]),
    cell(END, ["cancelLongPressTimer", "forgetGripTap", "releasePointer", "releaseListeners"]),
    cell(END, ["forgetGripTap", "releasePointer", "releaseListeners"]),
    cell(END, ["forgetGripTap", "releasePointer", "releaseListeners"]),
  ),
});

const DISPLAY_STATES = [HIDDEN, EXPANDED, MERMAID_OPEN, FORMAT_OPEN, TABLE_OPEN, MINIMIZED];
const display = (...cells) => row(DISPLAY_STATES, cells);
const toMenu = (state) => cell(state, ["closePopover", "openPopover"]);
const closeMenu = (actions = []) => cell(EXPANDED, ["closePopover", ...actions]);
const minimize = cell(MINIMIZED, ["closePopover", "keepGripPosition"]);
const resized = (state) => cell(state, ["clampIntoViewport", "placePopover"]);

/** Spec 11-f: event -> current state -> cell (display, minimize and popovers). */
export const paletteDisplayStateMachine = Object.freeze({
  paletteShown: display(cell(EXPANDED, ["placeAtBottomRight"])),
  paletteHidden: display(
    null,
    cell(HIDDEN, []),
    cell(HIDDEN, ["closePopover"]),
    cell(HIDDEN, ["closePopover"]),
    cell(HIDDEN, ["closePopover"]),
    cell(HIDDEN, ["restoreExpandedLayout"]),
  ),
  minimizeToggled: display(
    null,
    cell(MINIMIZED, ["keepGripPosition"]),
    minimize,
    minimize,
    minimize,
    cell(EXPANDED, ["keepGripPosition", "clampIntoViewport"]),
  ),
  mermaidButtonRun: display(null, cell(MERMAID_OPEN, ["openPopover"]), closeMenu(), toMenu(MERMAID_OPEN), toMenu(MERMAID_OPEN)),
  formatButtonRun: display(null, cell(FORMAT_OPEN, ["openPopover"]), toMenu(FORMAT_OPEN), closeMenu(), toMenu(FORMAT_OPEN)),
  tableOptionsButtonRun: display(null, cell(TABLE_OPEN, ["openPopover"]), toMenu(TABLE_OPEN), toMenu(TABLE_OPEN), closeMenu()),
  popoverItemRun: display(null, null, closeMenu(["runItemCommand"]), closeMenu(["runItemCommand"]), closeMenu(["runItemCommand"])),
  popoverEscapePressed: display(null, null, closeMenu(), closeMenu(), closeMenu()),
  pointerPressedOutsidePalette: display(null, null, closeMenu(), closeMenu(), closeMenu()),
  openerDisabled: display(null, null, closeMenu(), closeMenu(), closeMenu()),
  viewportResized: display(
    null,
    cell(EXPANDED, ["clampIntoViewport"]),
    resized(MERMAID_OPEN),
    resized(FORMAT_OPEN),
    resized(TABLE_OPEN),
    cell(MINIMIZED, ["clampIntoViewport"]),
  ),
});

/**
 * @purity pure
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * The button is disabled (aria-disabled, not the disabled attribute: a
 * disabled palette button still gets the pointer events that move the
 * palette, INV-35).
 * @purity semi-pure-b
 * @param {HTMLElement} button
 * @returns {boolean}
 */
function isPaletteButtonDisabled(button) {
  return button.getAttribute("aria-disabled") === "true";
}

/**
 * Set an attribute only when its value changes (setButtonStates runs on
 * every selection change).
 * @purity non-pure
 */
function setAttributeIfChanged(el, name, value) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/**
 * @purity non-pure
 */
function createButton(id, label, iconHtml) {
  const button = document.createElement("button");
  button.type = "button";
  if (id) button.id = id;
  button.className = "edit-palette-btn";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.tabIndex = -1; // INV-53: never takes the keyboard focus
  button.innerHTML = iconHtml; // static markup from ICONS only
  return button;
}

/**
 * The edit palette (spec 5.15, 11-d, 11-f): a movable toolbar fixed to the
 * viewport, directly under body, and its three popovers. Buttons run on
 * press-and-release inside the button (never on click); moving away from a
 * palette button drags the palette. A long press or a double click (a
 * double tap on touch and pen) on the grip minimizes it.
 * The palette is pointer only (INV-53). The elements are known by reference
 * only, never looked up by id.
 *
 * host (EditPaletteHost, implemented by UIController):
 *   runCommand(command, arg) - bold, italic, undo, save, saveAs, insertTable,
 *     insertRow, rowDelete, insertColumn, columnDelete, insertMermaid (arg: a
 *     CONFIG.edit.mermaidSamples key), textColor (red / blue / green / none),
 *     linkPaste, linkRemove, alignColumn (left / center / right / none),
 *     insertInlineMath, insertMathBox
 *   onPopoverOpened(key) - optional: a popover (format / mermaid / table)
 *     has just opened (its button states can be set now, 5.15.5)
 */
export default class EditPalette {
  /**
   * @param {object} host - EditPaletteHost
   * @param {{isApple?: boolean}} [platform] - isApple: show Cmd instead of
   *   Ctrl in the tooltips (INV-14 platform test, done by the caller)
   * @purity non-pure
   */
  constructor(host, { isApple = false } = {}) {
    this.host = host;
    this._paletteGestureState = IDLE;
    this._paletteDisplayState = HIDDEN;
    this._gesture = null; // { pointerId, button, el, start, offset, pointerType, time }
    this._longPressTimer = 0;
    this._gripTap = null; // the last grip press released as a tap: { pointerType, time, count }
    this._buttons = new Map(); // button element -> { command, arg, stateKey, popover }
    this._openers = {}; // popover key -> its opener button
    this._popovers = {}; // popover key -> element

    const mod = isApple ? L.modifier.apple : L.modifier.other;
    this._root = document.createElement("div");
    this._root.id = "editPalette";
    this._root.className = "edit-palette";
    this._root.setAttribute("role", "toolbar");
    this._root.setAttribute("aria-label", L.root);
    this._root.style.position = "fixed";
    this._root.hidden = true;
    for (const items of paletteRows(mod)) this._root.appendChild(this._buildRow(items));
    this._status = document.createElement("div");
    this._status.id = "paletteStatus";
    this._status.className = "edit-palette-status";
    this._status.setAttribute("aria-live", "polite");
    this._root.appendChild(this._status);

    for (const [key, def] of Object.entries(POPOVERS)) this._popovers[key] = this._buildPopover(def);

    this._onPointerDown = (e) => this._handlePointerDown(e);
    this._onPointerMove = (e) => this._handlePointerMove(e);
    this._onPointerUp = (e) => this._handlePointerUp(e);
    this._onPointerCancel = (e) => this._handlePointerCancel(e);
    this._onPaletteDoubleClick = () => this.dispatch("gripDoubleClicked");
    this._onDocumentPointerDown = (e) => this._handleDocumentPointerDown(e);
    this._onDocumentKeyDown = (e) => this._handleDocumentKeyDown(e);
    this._onResize = () => this.dispatchDisplay("viewportResized");
    this._onContextMenu = (e) => e.preventDefault(); // INV-68: no menu on a touch long press
    for (const el of this._containers()) {
      el.addEventListener("pointerdown", this._onPointerDown);
      el.addEventListener("contextmenu", this._onContextMenu);
    }
    // On the palette, not the grip: the grip press captures the pointer on
    // the palette, so the browser sends the dblclick there (INV-68).
    this._root.addEventListener("dblclick", this._onPaletteDoubleClick);

    document.body.append(...this._containers());
    this.setButtonStates({});
  }

  // ---- public API (spec 3.2) ----

  /**
   * Show at the bottom-right corner, every time, not minimized (INV-32).
   * @purity non-pure
   */
  show() {
    if (this.isShown()) return;
    document.body.classList.add("edit-mode"); // CSS: bands and the empty block (INV-41, INV-49)
    document.addEventListener("pointermove", this._onPointerMove);
    document.addEventListener("pointerup", this._onPointerUp);
    document.addEventListener("pointercancel", this._onPointerCancel);
    document.addEventListener("pointerdown", this._onDocumentPointerDown, true);
    document.addEventListener("keydown", this._onDocumentKeyDown, true);
    window.addEventListener("resize", this._onResize);
    this.dispatchDisplay("paletteShown");
  }

  /**
   * @purity non-pure
   */
  hide() {
    if (!this.isShown()) return;
    cancelFrame(this._cornerFrame);
    this._cornerFrame = 0;
    this.dispatch("paletteHidden");
    this.dispatchDisplay("paletteHidden");
    document.body.classList.remove("edit-mode");
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isShown() {
    return this._paletteDisplayState !== HIDDEN;
  }

  /**
   * The open popover (format / mermaid / table), or null (11-f).
   * @purity semi-pure-b
   * @returns {string|null}
   */
  openPopoverKey() {
    return this._openPopoverKey();
  }

  /**
   * Enable or disable the buttons (spec 5.15.5). A missing key is false; Save,
   * Save as and the Mermaid samples are always enabled. alignment marks the
   * pressed alignment button (aria-pressed). An open popover whose opener
   * becomes disabled closes (11-f openerDisabled).
   * @purity non-pure
   * @param {{bold?: boolean, italic?: boolean, format?: boolean, textColor?: boolean,
   *   linkPaste?: boolean, linkRemove?: boolean, insertTable?: boolean,
   *   insertMermaid?: boolean, undo?: boolean, insertRow?: boolean,
   *   insertColumn?: boolean, rowDelete?: boolean, columnDelete?: boolean,
   *   tableOptions?: boolean, insertInlineMath?: boolean, insertMathBox?: boolean,
   *   alignment?: "left"|"center"|"right"|"none"|null}} states
   */
  setButtonStates(states) {
    for (const [button, info] of this._buttons) {
      const enabled = info.stateKey === null || Boolean(states[info.stateKey]);
      setAttributeIfChanged(button, "aria-disabled", String(!enabled));
      if (info.command === "alignColumn") setAttributeIfChanged(button, "aria-pressed", String(states.alignment === info.arg));
    }
    const key = this._openPopoverKey();
    if (key && isPaletteButtonDisabled(this._openers[key])) this.dispatchDisplay("openerDisabled");
  }

  /**
   * @purity non-pure
   * @param {string} text
   */
  setStatusText(text) {
    if (this._status.textContent === text) return;
    this._status.textContent = text;
    if (!this.isShown() || this._cornerFrame) return;
    // The text can change the size of the shown palette (an empty document
    // gets its status right after show). Keep the bottom-right corner, so the
    // margin of INV-32 stays (PRT-U16). Checked in the next frame, when the
    // layout is done anyway: reading it here, inside a commit, forced a
    // layout of the whole preview.
    /** @purity non-pure */
    this._cornerFrame = nextFrame(() => {
      this._cornerFrame = 0;
      this._keepCorner();
    });
  }

  /**
   * The unsaved mark of the minimized palette (INV-68: a dot on the grip).
   * @purity non-pure
   * @param {boolean} isUnsaved
   */
  setUnsaved(isUnsaved) {
    this._root.classList.toggle(UNSAVED_CLASS, isUnsaved);
  }

  /**
   * The palette shows the grip only (11-f minimized).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isMinimized() {
    return this._paletteDisplayState === MINIMIZED;
  }

  /**
   * The node is inside the palette or one of its popovers (by reference; INV-36).
   * @purity semi-pure-b
   * @param {Node|null} node
   * @returns {boolean}
   */
  contains(node) {
    return Boolean(node) && this._containers().some((el) => el.contains(node));
  }

  /**
   * Handle one 11-d event. A "-" cell changes nothing.
   * @purity non-pure
   * @param {string} event
   * @param {{pointerId?: number, x?: number, y?: number, button?: HTMLElement|null, el?: Element, pointerType?: string, time?: number}} [input]
   *   A press (the *Pressed events) always carries pointerType and time
   *   (performance.now()); _handlePointerDown fills them in.
   */
  dispatch(event, input = {}) {
    const cells = paletteGestureStateMachine[event];
    if (!cells) throw new Error(`Unknown palette gesture event: ${event}`);
    const next = selectCell(cells[this._paletteGestureState], (guard) => this._isGestureGuardTrue(guard, input));
    if (!next) return;
    for (const action of next.actions) this._runAction(action, input);
    this._paletteGestureState = next.to === END ? IDLE : next.to;
    if (this._paletteGestureState === IDLE) this._gesture = null;
  }

  /**
   * Handle one 11-f event. A "-" cell changes nothing.
   * @purity non-pure
   * @param {string} event
   * @param {{command?: string, arg?: string}} [input] - the popover item (popoverItemRun)
   */
  dispatchDisplay(event, input = {}) {
    const cells = paletteDisplayStateMachine[event];
    if (!cells) throw new Error(`Unknown palette display event: ${event}`);
    const from = this._paletteDisplayState;
    const next = cells[from];
    if (!next) return;
    this._paletteDisplayState = next.to;
    this._root.hidden = next.to === HIDDEN;
    for (const action of next.actions) this._runDisplayAction(action, { from, to: next.to, input });
    // after the move: the host may set the button states (5.15.5) of the popover
    const opened = this._popoverKeyOf(next.to);
    if (opened && opened !== this._popoverKeyOf(from)) this.host.onPopoverOpened?.(opened);
  }

  // ---- internals: 11-d actions and guards ----

  /**
   * @purity semi-pure-b
   */
  _isGestureGuardTrue(guard, input) {
    switch (guard) {
      case "hasMovedBeyondThreshold":
        return isPastActivation(this._gesture.start, input);
      case "isPaletteButton":
        return this._root.contains(this._gesture.button);
      case "isQuickSecondGripTap":
        return isQuickSecondGripTap(this._gripTap, this._gesture);
      case "isSecondMouseGripTap":
        // The browser's dblclick keeps the OS double-click time; it counts
        // only when both presses were mouse taps on the grip (PD2).
        return this._gripTap?.pointerType === "mouse" && this._gripTap.count >= 2;
      default:
        throw new Error(`Unknown palette gesture guard: ${guard}`);
    }
  }

  /**
   * @purity non-pure
   */
  _runAction(action, input) {
    switch (action) {
      case "capturePointer":
        this._gesture = {
          pointerId: input.pointerId,
          button: input.button ?? null,
          el: input.el,
          start: { x: input.x, y: input.y },
          offset: null,
          pointerType: input.pointerType,
          time: input.time,
        };
        try {
          input.el.setPointerCapture?.(input.pointerId);
        } catch {
          // An inactive pointer id (synthetic events) cannot be captured.
        }
        break;
      case "rememberOffset": {
        const position = this._position();
        this._gesture.offset = { x: input.x - position.left, y: input.y - position.top };
        break;
      }
      case "movePaletteClamped":
        this._placeAt(input.x - this._gesture.offset.x, input.y - this._gesture.offset.y);
        break;
      case "startLongPressTimer":
        /** @purity non-pure */
        this._longPressTimer = setTimeout(() => {
          this._longPressTimer = 0;
          this.dispatch("longPressElapsed");
        }, CONFIG.edit.paletteLongPressMs);
        break;
      case "cancelLongPressTimer":
        clearTimeout(this._longPressTimer);
        this._longPressTimer = 0;
        break;
      case "requestMinimizeToggle":
        this.dispatchDisplay("minimizeToggled");
        break;
      case "rememberGripTap": {
        const { pointerType, time } = this._gesture;
        const count = this._gripTap?.pointerType === pointerType ? this._gripTap.count + 1 : 1;
        this._gripTap = { pointerType, time, count };
        break;
      }
      case "forgetGripTap":
        this._gripTap = null;
        break;
      case "runButtonCommand":
        this._runButton(this._gesture.button);
        break;
      case "releasePointer":
        try {
          this._gesture?.el.releasePointerCapture?.(this._gesture.pointerId);
        } catch {
          // Already released.
        }
        break;
      case "releaseListeners":
        document.removeEventListener("pointermove", this._onPointerMove);
        document.removeEventListener("pointerup", this._onPointerUp);
        document.removeEventListener("pointercancel", this._onPointerCancel);
        document.removeEventListener("pointerdown", this._onDocumentPointerDown, true);
        document.removeEventListener("keydown", this._onDocumentKeyDown, true);
        window.removeEventListener("resize", this._onResize);
        break;
      default:
        throw new Error(`Unknown palette gesture action: ${action}`);
    }
  }

  /**
   * Run what a button does on release inside it (INV-34).
   * @purity non-pure
   */
  _runButton(button) {
    const info = this._buttons.get(button);
    if (!info || isPaletteButtonDisabled(button)) return;
    if (info.command === "openPopover") {
      this.dispatchDisplay(POPOVERS[info.popover].runEvent);
    } else if (info.popover) {
      this.dispatchDisplay("popoverItemRun", { command: info.command, arg: info.arg });
    } else {
      this.host.runCommand(info.command);
    }
  }

  // ---- internals: 11-f actions ----

  /**
   * @purity non-pure
   */
  _runDisplayAction(action, { from, to, input }) {
    switch (action) {
      case "placeAtBottomRight": {
        const rect = this._root.getBoundingClientRect();
        const margin = CONFIG.edit.paletteMarginPx;
        this._placeAt(window.innerWidth - rect.width - margin, window.innerHeight - rect.height - margin);
        break;
      }
      case "closePopover":
        this._setPopoverOpen(this._popoverKeyOf(from), false);
        break;
      case "openPopover":
        this._setPopoverOpen(this._popoverKeyOf(to), true);
        break;
      case "placePopover":
        this._placePopover(this._popovers[this._popoverKeyOf(to)]);
        break;
      case "restoreExpandedLayout":
        this._root.classList.remove(MINIMIZED_CLASS);
        break;
      case "keepGripPosition": {
        // Switch between the minimized and the expanded layout of the next
        // state, then move the palette so that the grip stays where it was.
        const gripBefore = this._grip.getBoundingClientRect();
        this._root.classList.toggle(MINIMIZED_CLASS, to === MINIMIZED);
        const after = this._grip.getBoundingClientRect();
        const position = this._position();
        this._placeAt(position.left + gripBefore.left - after.left, position.top + gripBefore.top - after.top);
        break;
      }
      case "clampIntoViewport": {
        const position = this._position();
        this._placeAt(position.left, position.top);
        break;
      }
      case "runItemCommand":
        this.host.runCommand(input.command, input.arg);
        break;
      default:
        throw new Error(`Unknown palette display action: ${action}`);
    }
  }

  /**
   * @purity semi-pure-b
   * @returns {string|null} the popover key of a display state
   */
  _popoverKeyOf(state) {
    return Object.keys(POPOVERS).find((key) => POPOVERS[key].openState === state) ?? null;
  }

  /**
   * @purity semi-pure-b
   */
  _openPopoverKey() {
    return this._popoverKeyOf(this._paletteDisplayState);
  }

  /**
   * @purity non-pure
   */
  _setPopoverOpen(key, open) {
    if (!key) return;
    const el = this._popovers[key];
    el.hidden = !open;
    this._openers[key].setAttribute("aria-expanded", String(open));
    if (open) this._placePopover(el);
  }

  // ---- internals: pointer (11-d) ----

  /**
   * @purity non-pure
   */
  _handlePointerDown(e) {
    e.preventDefault(); // INV-36: keep the editor's focus and selection
    if (!this.isShown() || e.button !== 0) return;
    const inPopover = e.currentTarget !== this._root;
    const button = this._buttonAt(e.target);
    const input = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      button,
      el: button ?? e.currentTarget,
      pointerType: e.pointerType || "mouse",
      time: performance.now(),
    };
    let event;
    if (button && !isPaletteButtonDisabled(button)) event = "enabledButtonPressed";
    else if (button) event = inPopover ? "disabledPopoverButtonPressed" : "disabledButtonPressed";
    else if (inPopover) event = "popoverGapPressed";
    else event = this._grip.contains(e.target) ? "gripPressed" : "gapPressed";
    this.dispatch(event, input);
  }

  /**
   * @purity non-pure
   */
  _handlePointerMove(e) {
    const input = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    if (this._paletteGestureState === IDLE) {
      this.dispatch("pointerMoved", input);
      return;
    }
    if (e.pointerId !== this._gesture.pointerId) return;
    // Outside the pressed button by coordinates, not pointerleave (capture).
    const left = this._paletteGestureState === PRESS && !this._isInside(this._gesture.button, e);
    this.dispatch(left ? "pointerLeftPressedButton" : "pointerMoved", input);
  }

  /**
   * @purity non-pure
   */
  _handlePointerUp(e) {
    if (this._paletteGestureState !== IDLE && e.pointerId !== this._gesture.pointerId) return;
    const inside = this._paletteGestureState === PRESS && this._isInside(this._gesture.button, e);
    this.dispatch(inside ? "pointerReleasedInsideButton" : "pointerReleased");
  }

  /**
   * @purity non-pure
   */
  _handlePointerCancel(e) {
    if (this._paletteGestureState !== IDLE && e.pointerId !== this._gesture.pointerId) return;
    this.dispatch("pointerCanceled");
  }

  /**
   * @purity non-pure
   */
  _handleDocumentPointerDown(e) {
    if (this.contains(e.target)) return;
    // Both machines: a press anywhere but the grip breaks a grip double tap (INV-68).
    this.dispatch("pointerPressedOutsidePalette");
    this.dispatchDisplay("pointerPressedOutsidePalette");
  }

  /**
   * Esc while a popover is open closes the popover only, and goes no further
   * (INV-53): not to the editor, the cell or the document shortcuts. Not
   * during IME composition (there Esc cancels the conversion).
   * @purity non-pure
   */
  _handleDocumentKeyDown(e) {
    if (e.key !== "Escape" || !this._openPopoverKey()) return;
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) this.dispatchDisplay("popoverEscapePressed"); // a held Esc acts once (ruling Q-a)
  }

  /**
   * One of this palette's buttons (by reference) holding the node, or null.
   * @purity semi-pure-b
   */
  _buttonAt(node) {
    const button = node instanceof Element ? node.closest("button") : null;
    return button && this._buttons.has(button) ? button : null;
  }

  /**
   * @purity semi-pure-b
   */
  _isInside(el, e) {
    const rect = el.getBoundingClientRect();
    return e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
  }

  // ---- internals: layout (INV-32, INV-37) ----

  /**
   * @purity semi-pure-b
   */
  _containers() {
    return [this._root, ...Object.values(this._popovers)];
  }

  /**
   * @purity semi-pure-b
   */
  _position() {
    const rect = this._root.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  }

  /**
   * Move the palette so that its bottom-right corner is where the last
   * placement left it, if its size changed since.
   * @purity non-pure
   */
  _keepCorner() {
    const last = this._lastBox;
    if (!this.isShown() || !last) return;
    const rect = this._root.getBoundingClientRect();
    if (rect.width === last.width && rect.height === last.height) return;
    this._placeAt(last.right - rect.width, last.bottom - rect.height);
  }

  /**
   * Move the palette, kept inside the viewport; the open popover follows.
   * @purity non-pure
   */
  _placeAt(left, top) {
    const rect = this._root.getBoundingClientRect();
    const x = clamp(left, 0, window.innerWidth - rect.width);
    const y = clamp(top, 0, window.innerHeight - rect.height);
    this._root.style.left = `${x}px`;
    this._root.style.top = `${y}px`;
    this._lastBox = { width: rect.width, height: rect.height, right: x + rect.width, bottom: y + rect.height };
    const key = this._openPopoverKey();
    if (key) this._placePopover(this._popovers[key]);
  }

  /**
   * Open on the side of the palette that fits (right first), inside the viewport.
   * @purity non-pure
   */
  _placePopover(popover) {
    const paletteRect = this._root.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    let left = paletteRect.right + POPOVER_GAP_PX;
    if (left + popoverRect.width > window.innerWidth) left = paletteRect.left - POPOVER_GAP_PX - popoverRect.width;
    popover.style.left = `${clamp(left, 0, window.innerWidth - popoverRect.width)}px`;
    popover.style.top = `${clamp(paletteRect.top, 0, window.innerHeight - popoverRect.height)}px`;
  }

  // ---- internals: building ----

  /**
   * @purity non-pure
   */
  _buildRow(items) {
    const rowEl = document.createElement("div");
    rowEl.className = "edit-palette-row";
    for (const item of items) {
      if (item === "grip") {
        const grip = document.createElement("div");
        grip.id = "paletteGrip";
        grip.className = "edit-palette-grip";
        grip.title = L.grip;
        grip.setAttribute("aria-label", grip.title);
        grip.innerHTML = ICONS.grip;
        this._grip = grip;
        rowEl.appendChild(grip);
        continue;
      }
      const button = createButton(item.id, item.label, ICONS[item.icon]);
      this._buttons.set(button, { command: item.command, arg: undefined, stateKey: item.stateKey, popover: null });
      if (item.popover) {
        this._buttons.get(button).popover = item.popover;
        this._openers[item.popover] = button;
        button.insertAdjacentHTML("beforeend", ICONS.submenu);
        // aria-expanded only: aria-haspopup="true" means a menu, and the
        // popover is a toolbar.
        button.setAttribute("aria-expanded", "false");
      }
      rowEl.appendChild(button);
    }
    return rowEl;
  }

  /**
   * @purity non-pure
   */
  _buildPopover(def) {
    const popover = document.createElement("div");
    popover.id = def.id;
    popover.className = "edit-palette-popover";
    popover.setAttribute("role", "toolbar"); // INV-14 guard applies here too
    popover.setAttribute("aria-label", def.label);
    popover.style.position = "fixed";
    popover.hidden = true;
    const key = Object.keys(POPOVERS).find((k) => POPOVERS[k] === def);
    if (def.rows) popover.classList.add("edit-palette-popover-rows");
    for (const items of def.rows ?? [def.items]) {
      let parent = popover;
      if (def.rows) {
        parent = document.createElement("div");
        parent.className = "edit-palette-popover-row";
        popover.appendChild(parent);
      }
      for (const item of items) {
        const button = createButton(item.id ?? null, item.label, ICONS[item.icon]);
        if (item.icon === "colorSwatch") button.classList.add("edit-palette-swatch", `edit-palette-swatch-${item.arg}`);
        this._buttons.set(button, { command: item.command, arg: item.arg, stateKey: item.stateKey, popover: key });
        parent.appendChild(button);
      }
    }
    return popover;
  }
}
