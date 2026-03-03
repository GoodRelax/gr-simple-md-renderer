export default class ModalController {
  /**
   * @param {HTMLElement} modal
   * @param {HTMLElement[]} closeTriggers
   */
  static setupModal(modal, closeTriggers) {
    closeTriggers.forEach((trigger) => {
      trigger.onclick = () => ModalController.hide(modal);
    });
    modal.addEventListener("click", (event) => {
      if (!event.target.closest(".modal-content"))
        ModalController.hide(modal);
    });
  }

  /** @param {HTMLElement} modal */
  static show(modal) {
    modal.style.display = "block";
  }

  /** @param {HTMLElement} modal */
  static hide(modal) {
    modal.style.display = "none";
  }
}
