export default class ModalController {
  /**
   * @param {HTMLElement} modal
   * @param {HTMLElement[]} closeTriggers
   * @purity non-pure
   */
  static setupModal(modal, closeTriggers) {
    /** @purity non-pure */
    closeTriggers.forEach((trigger) => {
      trigger.onclick = () => ModalController.hide(modal);
    });
    /** @purity non-pure */
    modal.addEventListener("click", (event) => {
      if (!event.target.closest(".modal-content"))
        ModalController.hide(modal);
    });
  }

  /**
   * @param {HTMLElement} modal
   * @purity non-pure
   */
  static show(modal) {
    modal.style.display = "block";
  }

  /**
   * @param {HTMLElement} modal
   * @purity non-pure
   */
  static hide(modal) {
    modal.style.display = "none";
  }
}
