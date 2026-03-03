import { CONFIG } from "../config.js";

export default class DiagramZoomController {
  /** @param {HTMLElement} preview */
  constructor(preview) {
    this.preview = preview;
    this.scales = new WeakMap();
    this.baseWidths = new WeakMap();
    this.origMaxWidths = new WeakMap();
    this.setupListeners();
  }

  setupListeners() {
    this.preview.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) return;
        const diagram = this.findDiagramAt(e.target);
        if (!diagram) return;
        e.preventDefault();
        this.zoom(diagram, e.deltaY < 0 ? 1 : -1);
      },
      { passive: false },
    );

    this.preview.addEventListener("dblclick", (e) => {
      const diagram = this.findDiagramAt(e.target);
      if (!diagram) return;
      this.resetZoom(diagram);
    });
  }

  /**
   * @param {EventTarget} target
   * @returns {SVGSVGElement|HTMLImageElement|HTMLElement|null}
   */
  findDiagramAt(target) {
    const mermaidContainer = target.closest(".mermaid");
    if (mermaidContainer) {
      return mermaidContainer.querySelector("svg") ?? mermaidContainer;
    }
    return target.closest(".plantuml-diagram");
  }

  /**
   * @param {Element} el
   * @param {number} direction +1 = zoom in, -1 = zoom out
   */
  zoom(el, direction) {
    if (!this.baseWidths.has(el)) {
      this.baseWidths.set(el, el.getBoundingClientRect().width);
      this.origMaxWidths.set(el, el.style.maxWidth);
    }

    const current = this.scales.get(el) ?? 1.0;
    const raw = current + direction * CONFIG.zoom.step;
    const next =
      Math.round(
        Math.max(CONFIG.zoom.min, Math.min(CONFIG.zoom.max, raw)) * 100,
      ) / 100;

    this.scales.set(el, next);
    this.applyScale(el, next);
  }

  /** @param {Element} el */
  resetZoom(el) {
    if (!this.baseWidths.has(el)) return;
    this.applyScale(el, 1.0);
    this.scales.delete(el);
    this.baseWidths.delete(el);
    this.origMaxWidths.delete(el);
  }

  /**
   * @param {Element} el
   * @param {number} scale
   */
  applyScale(el, scale) {
    if (scale === 1.0) {
      el.style.width = "";
      el.style.height = "";
      el.style.flexShrink = "";
      el.style.maxWidth =
        this.origMaxWidths.get(el) ??
        (el.tagName === "IMG" ? "100%" : "");
    } else {
      const baseWidth = this.baseWidths.get(el);
      if (baseWidth === undefined) return;
      el.style.maxWidth = "none";
      el.style.height = "auto";
      el.style.width = `${Math.round(baseWidth * scale)}px`;
      el.style.flexShrink = "0";
    }
  }
}
