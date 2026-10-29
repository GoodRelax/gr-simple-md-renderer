// Elements that take the focus by Tab. Those under [hidden] (the help's
// other language) are left out when the list is made.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// The element to give the focus back to when a modal closes (5.11).
const returnFocus = new WeakMap();

// What a modal calls when it closes, however it closes (a button, Esc, a
// click outside): the code file dialogs answer "canceled" then (INV-89).
const hideListeners = new WeakMap();

export default class ModalController {
  /**
   * Close on the close controls and on a click outside the content. While the
   * modal is open, Esc closes it, a key without Ctrl / Cmd / Alt does not
   * reach the app's one-key shortcuts behind it (the listener runs in the
   * capture phase on document, before them), and Tab / Shift+Tab go round
   * the modal's own controls. Other keys keep their default, so Enter and
   * Space still work on the modal's buttons.
   * @param {HTMLElement} modal
   * @param {HTMLElement[]} closeTriggers
   * @param {Function|null} [onHide] - called each time the open modal is hidden
   * @returns {() => void} removes the key listener
   * @purity non-pure
   */
  static setupModal(modal, closeTriggers, onHide = null) {
    if (onHide) hideListeners.set(modal, onHide);
    /** @purity non-pure */
    closeTriggers.forEach((trigger) => {
      trigger.onclick = () => ModalController.hide(modal);
    });
    /** @purity non-pure */
    modal.addEventListener("click", (event) => {
      if (!event.target.closest(".modal-content"))
        ModalController.hide(modal);
    });
    /** @purity non-pure */
    const onKeydown = (event) => {
      if (!ModalController.isOpen(modal)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        ModalController.hide(modal);
      } else if (event.key === "Tab") {
        event.preventDefault();
        ModalController.moveFocus(modal, event.shiftKey ? -1 : 1);
      }
    };
    document.addEventListener("keydown", onKeydown, true);
    return () => document.removeEventListener("keydown", onKeydown, true);
  }

  /**
   * The modal's controls that Tab can reach, in document order.
   * @param {HTMLElement} modal
   * @returns {HTMLElement[]}
   * @purity semi-pure-a
   */
  static focusables(modal) {
    return [...modal.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest("[hidden]"));
  }

  /**
   * Move the focus to the next (+1) or previous (-1) control, going round;
   * from outside the modal, to the first (or the last).
   * @param {HTMLElement} modal
   * @param {1|-1} step
   * @purity non-pure
   */
  static moveFocus(modal, step) {
    const list = ModalController.focusables(modal);
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement);
    const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
    list[next].focus();
  }

  /**
   * @param {HTMLElement} modal
   * @returns {boolean}
   * @purity semi-pure-a
   */
  static isOpen(modal) {
    return modal.style.display === "block";
  }

  /**
   * Show the modal and move the focus in: to the pressed button (the help's
   * language), else to the close button. On hide the focus goes back to
   * opener (default: what had the focus).
   * @param {HTMLElement} modal
   * @param {HTMLElement} [opener]
   * @purity non-pure
   */
  static show(modal, opener = document.activeElement) {
    if (opener && opener !== document.body) returnFocus.set(modal, opener);
    modal.style.display = "block";
    const target =
      modal.querySelector('[aria-pressed="true"]:not([hidden])') ?? modal.querySelector(".close-btn");
    target?.focus();
  }

  /**
   * Hide the modal. If the focus was inside it (or nowhere), give it back to
   * the opener, so it is never left in a hidden modal. A modal that was
   * open calls its onHide (setupModal) last.
   * @param {HTMLElement} modal
   * @purity non-pure
   */
  static hide(modal) {
    const wasOpen = ModalController.isOpen(modal);
    modal.style.display = "none";
    const opener = returnFocus.get(modal);
    returnFocus.delete(modal);
    const active = document.activeElement;
    const focusInside = active === null || active === document.body || modal.contains(active);
    if (focusInside) {
      if (opener && opener.isConnected) opener.focus();
      else if (modal.contains(active)) active.blur();
    }
    if (wasOpen) hideListeners.get(modal)?.();
  }
}
