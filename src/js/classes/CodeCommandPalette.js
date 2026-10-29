// The command palette of the code view (INV-92, NE-13): a small box under
// the [Commands] button, opened by the button or `p`, with the commands as
// buttons (for now: fold and unfold one level of a JSON file). It stays
// open after a command, so a fold can be pressed again; Esc or a press
// outside closes it. Touch works the same (NE-14).

/** Room between the button and the box, and between the box and the window's edges. */
const GAP_PX = 4;
const MARGIN_PX = 8;

/**
 * @purity pure
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export default class CodeCommandPalette {
  /**
   * @param {{button: HTMLButtonElement, box: HTMLElement}} elements - box: the
   *   palette, filled here (fixed, under the button)
   * @param {object} host - runCommand(command): "fold" / "unfold"
   * @param {object} labels - CONFIG.messages.codeCommands
   * @param {{isApple?: boolean}} [platform] - isApple: the keys shown are Option, not Ctrl
   * @purity non-pure
   */
  constructor(elements, host, labels, { isApple = false } = {}) {
    this.button = elements.button;
    this.box = elements.box;
    this.host = host;
    this._returnFocus = null; // the element focused before the box opened
    const key = isApple ? labels.modifier.apple : labels.modifier.other;
    this.box.setAttribute("role", "dialog");
    this.box.setAttribute("aria-label", labels.title);
    this.box.hidden = true;
    this.box.replaceChildren();
    for (const [command, label] of [["fold", labels.fold(key)], ["unfold", labels.unfold(key)]]) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "code-command";
      item.dataset.command = command;
      item.textContent = label;
      this.box.append(item);
    }
    this.button.setAttribute("aria-expanded", "false");
    this._onOutsidePress = (e) => this._handleOutsidePress(e);
    this._onResize = () => this._place();
    this.button.addEventListener("click", () => this.toggle());
    this.box.addEventListener("click", (e) => this._handleClick(e));
    this.box.addEventListener("keydown", (e) => this._handleKeyDown(e));
  }

  /** @purity semi-pure-a */
  isShown() {
    return !this.box.hidden;
  }

  /**
   * The palette is for the code view of a JSON file; elsewhere the button
   * is off and the box closes.
   * @param {boolean} isAvailable
   * @purity non-pure
   */
  setAvailable(isAvailable) {
    this.button.disabled = !isAvailable;
    if (!isAvailable) this.hide();
  }

  /**
   * Open it, or close it with the focus back where it was.
   * @purity non-pure
   */
  toggle() {
    if (this.isShown()) this.hide({ restoreFocus: true });
    else this.show();
  }

  /**
   * Open under the button; the focus goes to the first command.
   * @purity non-pure
   */
  show() {
    if (this.button.disabled || this.isShown()) return;
    this._returnFocus = document.activeElement;
    this.box.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this._place();
    document.addEventListener("pointerdown", this._onOutsidePress, true);
    window.addEventListener("resize", this._onResize);
    this.box.querySelector("button")?.focus({ preventScroll: true });
  }

  /**
   * Close. restoreFocus: the focus goes back to where it was when the box
   * opened (Esc, the toggle), not after a press outside (the focus goes
   * where that press put it).
   * @param {{restoreFocus?: boolean}} [options]
   * @purity non-pure
   */
  hide({ restoreFocus = false } = {}) {
    if (!this.isShown()) return;
    this.box.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", this._onOutsidePress, true);
    window.removeEventListener("resize", this._onResize);
    const back = this._returnFocus;
    this._returnFocus = null;
    if (restoreFocus && back?.isConnected && typeof back.focus === "function") back.focus({ preventScroll: true });
  }

  // ---- internals ----

  /**
   * @param {MouseEvent} e
   * @purity non-pure
   */
  _handleClick(e) {
    const item = e.target.closest?.("button.code-command");
    if (item) this.host.runCommand(item.dataset.command);
  }

  /**
   * Esc closes the box and goes no further (not to the document's Esc).
   * Not during IME composition.
   * @param {KeyboardEvent} e
   * @purity non-pure
   */
  _handleKeyDown(e) {
    if (e.key !== "Escape" || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    this.hide({ restoreFocus: true });
  }

  /**
   * A press outside the box and its button closes it (the button toggles
   * it by itself).
   * @param {PointerEvent} e
   * @purity non-pure
   */
  _handleOutsidePress(e) {
    if (this.box.contains(e.target) || this.button.contains(e.target)) return;
    this.hide();
  }

  /**
   * Under the button, its right edge at the button's, inside the window.
   * @purity non-pure
   */
  _place() {
    const anchor = this.button.getBoundingClientRect();
    const width = this.box.offsetWidth;
    this.box.style.left = `${clamp(anchor.right - width, MARGIN_PX, window.innerWidth - width - MARGIN_PX)}px`;
    this.box.style.top = `${anchor.bottom + GAP_PX}px`;
  }
}
