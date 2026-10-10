import { CONFIG } from "../config.js";
import { cell, row } from "../stateTable.js";

const IDLE = "idle";
const PRESS = "pressingButton";
const DRAG = "draggingPalette";
const END = "[*]";

const POPOVER_GAP_PX = 4;

// Icons of spec 5.15.3, inlined in each button (no <use>, no external
// reference: a user-written id="i-bold" in the preview must not change them).
const ICONS = {
  bold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"><path d="M7 5h5.5a3.5 3.5 0 0 1 0 7H7zM7 12h6.5a3.5 3.5 0 0 1 0 7H7z"/></svg>',
  italic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M11 5h7M6 19h7M15 5l-6 14"/></svg>',
  table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 9.5h17M3.5 14.2h17M9.2 5v14M14.8 5v14"/></svg>',
  row: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3" width="17" height="10" rx="1.5"/><path d="M3.5 8h17M9.2 3v10M14.8 3v10M12 15.5v6M9 18.5h6"/></svg>',
  col: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3.5" width="10" height="17" rx="1.5"/><path d="M8 3.5v17M3 9.2h10M3 14.8h10M15.5 12h6M18.5 9v6"/></svg>',
  mermaid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg>',
  saveas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 20H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10l3 3v3.5"/><path d="M8 4v5h7V4M8 20v-6h4"/><path d="M14 21l.7-2.8 4.8-4.8a1.4 1.4 0 0 1 2 2l-4.8 4.8z"/></svg>',
  grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
  seq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="7" height="4" rx="1"/><rect x="14.5" y="2.5" width="7" height="4" rx="1"/><path d="M6 6.5v15M18 6.5v15" stroke-dasharray="2 2"/><path d="M6 11h11.5M15.5 9l2 2-2 2M18 17H6.5M8.5 15l-2 2 2 2"/></svg>',
  state: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="9" height="6" rx="3"/><rect x="12.5" y="14.5" width="9" height="6" rx="3"/><path d="M11.5 6.5h5a3 3 0 0 1 3 3v3M17.5 10.5l2 2 2-2M12.5 17.5h-5a3 3 0 0 1-3-3v-3M2.5 13.5l2-2 2 2"/></svg>',
  submenu: '<svg class="edit-palette-submenu" viewBox="0 0 6 6" fill="currentColor"><path d="M6 0v6H0z"/></svg>',
  class: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="9" rx="1"/><path d="M7 5.5h10M7 8.5h10"/><rect x="2.5" y="16" width="7" height="5.5" rx="1"/><rect x="14.5" y="16" width="7" height="5.5" rx="1"/><path d="M12 11.5l-1.7 2.6h3.4z"/><path d="M12 14.1v.4M6 16v-1.5h12V16"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
};

// Palette layout (5.15.1). null = separator.
const ROWS = [
  [
    "grip",
    { id: "paletteBold", command: "bold", label: "Bold", icon: "bold" },
    { id: "paletteItalic", command: "italic", label: "Italic", icon: "italic" },
    null,
    { id: "paletteUndo", command: "undo", label: "Undo", icon: "undo" },
    null,
    { id: "paletteSave", command: "save", label: "Save", icon: "save" },
    { id: "paletteSaveAs", command: "saveAs", label: "Save as", icon: "saveas" },
  ],
  [
    { id: "paletteTable", command: "insertTable", label: "Insert table", icon: "table" },
    { id: "paletteRow", command: "insertRow", label: "Insert row", icon: "row" },
    { id: "paletteColumn", command: "insertColumn", label: "Insert column", icon: "col" },
    { id: "paletteMermaid", command: "openMermaidMenu", label: "Insert Mermaid sample", icon: "mermaid" },
  ],
];

// Popover buttons: the arg is the key of CONFIG.edit.mermaidSamples.
const SAMPLES = [
  { arg: "flowchart", label: "Flowchart", icon: "mermaid" },
  { arg: "sequence", label: "Sequence diagram", icon: "seq" },
  { arg: "state", label: "State diagram", icon: "state" },
  { arg: "class", label: "Class diagram", icon: "class" },
];

const STATES = [IDLE, PRESS, DRAG];
const transitions = (...cells) => row(STATES, cells);

/** Spec 11-d: event -> current state -> cell. "[*]" ends the gesture handling (hidden). */
export const paletteGestureStateMachine = Object.freeze({
  enabledButtonPressed: transitions(cell(PRESS, ["capturePointer"]), null, null),
  disabledButtonPressed: transitions(null, null, null),
  gripOrGapPressed: transitions(cell(DRAG, ["capturePointer", "rememberOffset"]), null, null),
  pointerMoved: transitions(null, null, cell(DRAG, ["movePaletteClamped"])),
  pointerLeftPressedButton: transitions(null, cell(DRAG, ["rememberOffset"]), null),
  pointerReleasedInsideButton: transitions(null, cell(IDLE, ["runButtonCommand"]), null),
  pointerReleased: transitions(null, cell(IDLE, []), cell(IDLE, [])),
  pointerCanceled: transitions(null, cell(IDLE, []), cell(IDLE, [])),
  paletteHidden: transitions(
    cell(END, ["releaseListeners"]),
    cell(END, ["releasePointer", "releaseListeners"]),
    cell(END, ["releasePointer", "releaseListeners"]),
  ),
});

/**
 * @purity pure
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
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
  button.tabIndex = -1;
  button.innerHTML = iconHtml; // static markup from ICONS only
  return button;
}

/**
 * The edit palette (spec 5.15, 11-d): a movable toolbar fixed to the
 * viewport, directly under body. Buttons run on press-and-release inside
 * the button (never on click); moving away drags the palette. The elements
 * are known by reference only, never looked up by id.
 *
 * host (EditPaletteHost, implemented by UIController):
 *   runCommand(command, arg) - bold, italic, undo, save, saveAs, insertTable,
 *     insertRow, insertColumn, insertMermaid (arg: CONFIG.edit.mermaidSamples key)
 *   focusEditor() -> boolean - focus the open block editor (false if none)
 *   requestHide() - Esc with no editor open (INV-53, ruling T3)
 */
export default class EditPalette {
  /**
   * @param {object} host - EditPaletteHost
   * @purity non-pure
   */
  constructor(host) {
    this.host = host;
    this._paletteGestureState = IDLE;
    this._shown = false;
    this._gesture = null; // { pointerId, button, el, offset }
    this._buttons = new Map(); // button element -> { command, arg }
    this._paletteButtons = [];
    this._sampleButtons = [];

    this._root = document.createElement("div");
    this._root.id = "editPalette";
    this._root.className = "edit-palette";
    this._root.setAttribute("role", "toolbar");
    this._root.setAttribute("aria-label", "Edit palette");
    this._root.style.position = "fixed";
    this._root.hidden = true;
    for (const items of ROWS) this._root.appendChild(this._buildRow(items));
    this._status = document.createElement("div");
    this._status.id = "paletteStatus";
    this._status.className = "edit-palette-status";
    this._status.setAttribute("aria-live", "polite");
    this._root.appendChild(this._status);
    this._mermaidButton = this._paletteButtons.find((b) => this._buttons.get(b).command === "openMermaidMenu");
    this._mermaidButton.insertAdjacentHTML("beforeend", ICONS.submenu);
    this._mermaidButton.setAttribute("aria-haspopup", "true");
    this._mermaidButton.setAttribute("aria-expanded", "false");

    this._popover = document.createElement("div");
    this._popover.id = "paletteMermaidMenu";
    this._popover.className = "edit-palette-popover";
    this._popover.setAttribute("role", "toolbar"); // INV-14 guard applies here too
    this._popover.setAttribute("aria-label", "Mermaid samples");
    this._popover.style.position = "fixed";
    this._popover.hidden = true;
    for (const sample of SAMPLES) {
      const button = createButton(null, sample.label, ICONS[sample.icon]);
      this._buttons.set(button, { command: "insertMermaid", arg: sample.arg });
      this._sampleButtons.push(button);
      this._popover.appendChild(button);
    }

    this._onPointerDown = (e) => this._handlePointerDown(e);
    this._onPointerMove = (e) => this._handlePointerMove(e);
    this._onPointerUp = (e) => this._handlePointerUp(e);
    this._onPointerCancel = (e) => this._handlePointerCancel(e);
    this._onDocumentPointerDown = (e) => this._handleDocumentPointerDown(e);
    this._onResize = () => this._placeAt(this._position().left, this._position().top);
    this._onPaletteKeyDown = (e) => this._handlePaletteKeyDown(e);
    this._onPopoverKeyDown = (e) => this._handlePopoverKeyDown(e);
    this._root.addEventListener("pointerdown", this._onPointerDown);
    this._popover.addEventListener("pointerdown", this._onPointerDown);
    this._root.addEventListener("keydown", this._onPaletteKeyDown);
    this._popover.addEventListener("keydown", this._onPopoverKeyDown);

    document.body.append(this._root, this._popover);
    this._roving = null;
    this.setButtonStates(false, false, false, false);
  }

  // ---- public API (spec 3.2) ----

  /**
   * Show at the bottom-right corner, every time (INV-32: no remembered place).
   * @purity non-pure
   */
  show() {
    if (this._shown) return;
    this._shown = true;
    this._paletteGestureState = IDLE;
    this._root.hidden = false;
    document.body.classList.add("edit-mode"); // CSS: bands and the empty block (INV-41, INV-49)
    const rect = this._root.getBoundingClientRect();
    const margin = CONFIG.edit.paletteMarginPx;
    this._placeAt(window.innerWidth - rect.width - margin, window.innerHeight - rect.height - margin);
    document.addEventListener("pointermove", this._onPointerMove);
    document.addEventListener("pointerup", this._onPointerUp);
    document.addEventListener("pointercancel", this._onPointerCancel);
    document.addEventListener("pointerdown", this._onDocumentPointerDown, true);
    window.addEventListener("resize", this._onResize);
  }

  /**
   * @purity non-pure
   */
  hide() {
    if (!this._shown) return;
    this.dispatch("paletteHidden");
    this._closePopover();
    this._root.hidden = true;
    this._shown = false;
    document.body.classList.remove("edit-mode");
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean}
   */
  isShown() {
    return this._shown;
  }

  /**
   * Enable or disable the buttons (spec 5.15.5).
   * @purity non-pure
   * @param {boolean} isInBlock - a block editor is open
   * @param {boolean} hasSelection - the editor has a non-empty selection
   * @param {boolean} isInTable - the open block is a table
   * @param {boolean} canUndo - there is a change to undo
   */
  setButtonStates(isInBlock, hasSelection, isInTable, canUndo) {
    const enabled = {
      bold: isInBlock && hasSelection,
      italic: isInBlock && hasSelection,
      undo: !isInBlock && canUndo,
      insertRow: isInBlock && isInTable,
      insertColumn: isInBlock && isInTable,
    };
    for (const b of this._paletteButtons) {
      const { command } = this._buttons.get(b);
      b.disabled = command in enabled ? !enabled[command] : false;
    }
    if (!this._roving || this._roving.disabled) this._setRoving(this._paletteButtons.find((b) => !b.disabled));
  }

  /**
   * @purity non-pure
   * @param {string} text
   */
  setStatusText(text) {
    if (this._status.textContent === text) return;
    const before = this._shown ? this._root.getBoundingClientRect() : null;
    this._status.textContent = text;
    if (!before) return;
    // The text can change the size of the shown palette (an empty document
    // gets its status right after show). Keep the bottom-right corner, so the
    // margin of INV-32 stays (PRT-U16); _placeAt keeps it inside the viewport.
    const after = this._root.getBoundingClientRect();
    if (after.width === before.width && after.height === before.height) return;
    this._placeAt(before.right - after.width, before.bottom - after.height);
  }

  /**
   * Focus the current button (roving tab stop; Tab from the editor, INV-53).
   * @purity non-pure
   */
  focus() {
    this._roving?.focus();
  }

  /**
   * The node is inside the palette or its popover (by reference; INV-36).
   * @purity semi-pure-b
   * @param {Node|null} node
   * @returns {boolean}
   */
  contains(node) {
    return Boolean(node) && (this._root.contains(node) || this._popover.contains(node));
  }

  /**
   * Handle one 11-d event. A "-" cell changes nothing.
   * @purity non-pure
   * @param {string} event
   * @param {{pointerId?: number, x?: number, y?: number, button?: HTMLElement|null, el?: Element}} [input]
   */
  dispatch(event, input = {}) {
    const cells = paletteGestureStateMachine[event];
    if (!cells) throw new Error(`Unknown palette gesture event: ${event}`);
    const next = cells[this._paletteGestureState];
    if (!next) return;
    for (const action of next.actions) this._runAction(action, input);
    this._paletteGestureState = next.to === END ? IDLE : next.to;
    if (this._paletteGestureState === IDLE) this._gesture = null;
  }

  // ---- internals: actions ----

  /**
   * @purity non-pure
   */
  _runAction(action, input) {
    switch (action) {
      case "capturePointer":
        this._gesture = { pointerId: input.pointerId, button: input.button ?? null, el: input.el, offset: null };
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
        window.removeEventListener("resize", this._onResize);
        break;
      default:
        break;
    }
  }

  /**
   * Run what a button does (on release inside it, or Enter / Space).
   * @purity non-pure
   */
  _runButton(button) {
    const info = this._buttons.get(button);
    if (!info || button.disabled) return;
    if (info.command === "openMermaidMenu") {
      if (this._popover.hidden) this._openPopover();
      else this._closePopover();
      return;
    }
    if (info.command === "insertMermaid") {
      this._closePopover();
      this.host.runCommand(info.command, info.arg);
      return;
    }
    this.host.runCommand(info.command);
  }

  // ---- internals: pointer (11-d) ----

  /**
   * @purity non-pure
   */
  _handlePointerDown(e) {
    e.preventDefault(); // INV-36: keep the editor's focus and selection
    if (!this._shown || e.button !== 0) return;
    const button = this._buttonAt(e.target);
    const input = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, button, el: button ?? e.currentTarget };
    if (button) this.dispatch(button.disabled ? "disabledButtonPressed" : "enabledButtonPressed", input);
    else this.dispatch("gripOrGapPressed", input);
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
   * A pointerdown outside the palette and the popover closes the popover.
   * @purity non-pure
   */
  _handleDocumentPointerDown(e) {
    if (!this._popover.hidden && !this.contains(e.target)) this._closePopover();
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
  _position() {
    const rect = this._root.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  }

  /**
   * Move the palette, kept inside the viewport; the open popover follows.
   * @purity non-pure
   */
  _placeAt(left, top) {
    const rect = this._root.getBoundingClientRect();
    this._root.style.left = `${clamp(left, 0, window.innerWidth - rect.width)}px`;
    this._root.style.top = `${clamp(top, 0, window.innerHeight - rect.height)}px`;
    if (!this._popover.hidden) this._placePopover();
  }

  /**
   * Open on the side of the palette that fits (right first), inside the viewport.
   * @purity non-pure
   */
  _placePopover() {
    const paletteRect = this._root.getBoundingClientRect();
    const popoverRect = this._popover.getBoundingClientRect();
    let left = paletteRect.right + POPOVER_GAP_PX;
    if (left + popoverRect.width > window.innerWidth) left = paletteRect.left - POPOVER_GAP_PX - popoverRect.width;
    this._popover.style.left = `${clamp(left, 0, window.innerWidth - popoverRect.width)}px`;
    this._popover.style.top = `${clamp(paletteRect.top, 0, window.innerHeight - popoverRect.height)}px`;
  }

  /**
   * @purity non-pure
   */
  _openPopover() {
    this._popover.hidden = false;
    this._mermaidButton.setAttribute("aria-expanded", "true");
    this._placePopover();
  }

  /**
   * @purity non-pure
   */
  _closePopover() {
    this._popover.hidden = true;
    this._mermaidButton.setAttribute("aria-expanded", "false");
  }

  // ---- internals: keyboard (INV-53) ----

  /**
   * @purity non-pure
   */
  _handlePaletteKeyDown(e) {
    const button = this._buttonAt(e.target);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      this._moveRoving(e.key === "ArrowRight" ? 1 : -1, button ?? this._roving);
    } else if ((e.key === "Enter" || e.key === " ") && button) {
      e.preventDefault(); // also stops the synthetic click
      if (button === this._mermaidButton) {
        this._openPopover();
        this._sampleButtons[0].focus();
      } else {
        this._runButton(button);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      this._closePopover();
      if (!this.host.focusEditor()) this.host.requestHide();
    } else if (e.key === "Tab" && e.shiftKey) {
      if (this.host.focusEditor()) e.preventDefault();
    }
  }

  /**
   * @purity non-pure
   */
  _handlePopoverKeyDown(e) {
    const button = this._buttonAt(e.target);
    const i = this._sampleButtons.indexOf(button);
    if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
      const n = this._sampleButtons.length;
      this._sampleButtons[(Math.max(i, 0) + step + n) % n].focus();
    } else if ((e.key === "Enter" || e.key === " ") && button) {
      e.preventDefault();
      this._mermaidButton.focus();
      this._runButton(button);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this._closePopover();
      this._mermaidButton.focus();
    }
  }

  /**
   * Next enabled button after the focused one, wrapping at the ends (ruling Q12).
   * @purity non-pure
   */
  _moveRoving(step, from) {
    const enabled = this._paletteButtons.filter((b) => !b.disabled);
    if (enabled.length === 0) return;
    const i = enabled.indexOf(from);
    const next = enabled[(i + step + enabled.length) % enabled.length];
    this._setRoving(next);
    next.focus();
  }

  /**
   * Exactly one palette button has tabindex 0.
   * @purity non-pure
   */
  _setRoving(button) {
    if (!button) return;
    for (const b of this._paletteButtons) b.tabIndex = b === button ? 0 : -1;
    this._roving = button;
  }

  /**
   * @purity non-pure
   */
  _buildRow(items) {
    const rowEl = document.createElement("div");
    rowEl.className = "edit-palette-row";
    for (const item of items) {
      if (item === null) {
        const sep = document.createElement("span");
        sep.className = "edit-palette-sep";
        sep.setAttribute("aria-hidden", "true");
        rowEl.appendChild(sep);
      } else if (item === "grip") {
        const grip = document.createElement("div");
        grip.id = "paletteGrip";
        grip.className = "edit-palette-grip";
        grip.title = "Move palette";
        grip.setAttribute("aria-label", "Move palette");
        grip.innerHTML = ICONS.grip;
        rowEl.appendChild(grip);
      } else {
        const button = createButton(item.id, item.label, ICONS[item.icon]);
        this._buttons.set(button, { command: item.command, arg: undefined });
        this._paletteButtons.push(button);
        rowEl.appendChild(button);
      }
    }
    return rowEl;
  }
}
