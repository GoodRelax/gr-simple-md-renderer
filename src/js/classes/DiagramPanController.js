import { CONFIG } from "../config.js";

export default class DiagramPanController {
  /**
   * @param {HTMLElement} preview
   * @purity non-pure
   */
  constructor(preview) {
    this.preview = preview;
    this.panState = null;
    this.setupListeners();
  }

  /** @purity non-pure */
  setupListeners() {
    /** @purity non-pure */
    this.preview.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const container = this.findScrollContainerAt(e.target);
      if (!container) return;
      e.preventDefault();
      this.panState = {
        container,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        active: false,
      };
    });

    /** @purity non-pure */
    document.addEventListener("mousemove", (e) => {
      const s = this.panState;
      if (!s) return;
      // No button held: the press ended without a mouseup reaching here
      // (WebKit sends none when the pressed element left the DOM, as when a
      // click on a diagram opens its code, PRT-U20). A move does not pan.
      if ((e.buttons & 1) === 0) {
        this.endPan();
        return;
      }
      if (!s.active) {
        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        const t = CONFIG.pan.activationThresholdPx;
        if (dx * dx + dy * dy < t * t) return;
        s.active = true;
        this.setCursor(s.container, true);
      }

      s.container.scrollLeft -= e.clientX - s.lastX;
      const dy = e.clientY - s.lastY;
      if (s.container.scrollHeight > s.container.clientHeight) {
        s.container.scrollTop -= dy;
      } else {
        this.preview.scrollTop -= dy;
      }
      s.lastX = e.clientX;
      s.lastY = e.clientY;
    });

    // The pointer events end it too: they come where a mouseup may not.
    /** @purity non-pure */
    const end = () => this.endPan();
    document.addEventListener("mouseup", end);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  }

  /**
   * End the pan, if there is one, and put the cursor back.
   * @purity non-pure
   */
  endPan() {
    if (!this.panState) return;
    if (this.panState.active) {
      this.setCursor(this.panState.container, false);
    }
    this.panState = null;
  }

  /**
   * @param {HTMLElement} container
   * @param {boolean} active
   * @purity non-pure
   */
  setCursor(container, active) {
    const cursor = active ? "grabbing" : "";
    container.style.cursor = cursor;
    document.body.style.cursor = cursor;
  }

  /**
   * @param {EventTarget} target
   * @returns {HTMLElement|null}
   * @purity semi-pure-b
   */
  findScrollContainerAt(target) {
    return (
      target.closest(".mermaid") ?? target.closest(".plantuml-wrapper")
    );
  }
}
