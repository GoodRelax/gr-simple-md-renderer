import { CONFIG } from "../config.js";

const DIAGRAM_SELECTOR = ".mermaid, .plantuml-wrapper";
const D = CONFIG.messages.diagram; // button labels and feedback

export default class DiagramCopyController {
  /**
   * @param {HTMLElement} preview
   * @purity non-pure
   */
  constructor(preview) {
    this.preview = preview;
    // Only the added nodes are searched: a scan of the whole preview on every
    // change of a large document (a commit, highlighting) costs ~10 ms.
    this.observer = new MutationObserver((records) => this.attachBarsIn(records));
    this.observer.observe(this.preview, { childList: true, subtree: true });
  }

  /**
   * Attach bars to the diagram containers among and inside the added nodes.
   * @purity non-pure
   * @param {MutationRecord[]} records
   */
  attachBarsIn(records) {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE || !node.isConnected) continue;
        if (node.matches(DIAGRAM_SELECTOR)) this._attachOnce(node);
        node.querySelectorAll(DIAGRAM_SELECTOR).forEach((container) => this._attachOnce(container));
      }
    }
  }

  /**
   * @purity non-pure
   * @param {HTMLElement} container
   */
  _attachOnce(container) {
    const prev = container.previousElementSibling;
    if (prev && prev.classList.contains("diagram-copy-bar")) return;
    this.attachBar(container);
  }

  /** @purity non-pure */
  attachBars() {
    this.preview.querySelectorAll(DIAGRAM_SELECTOR).forEach((container) => this._attachOnce(container));
  }

  /**
   * @param {HTMLElement} container
   * @purity non-pure
   */
  attachBar(container) {
    const bar = document.createElement("div");
    bar.className = "diagram-copy-bar";

    const svgBtn = document.createElement("button");
    svgBtn.className = "diagram-copy-btn";
    svgBtn.textContent = D.copySvg;
    /** @purity non-pure */
    svgBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.copyAsSvg(container, svgBtn);
    });

    const pngBtn = document.createElement("button");
    pngBtn.className = "diagram-copy-btn";
    pngBtn.textContent = D.copyPng;
    /** @purity non-pure */
    pngBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.copyAsPng(container, pngBtn);
    });

    bar.appendChild(svgBtn);
    bar.appendChild(pngBtn);
    container.parentElement.insertBefore(bar, container);
  }

  /**
   * @param {SVGSVGElement} svg
   * @returns {SVGSVGElement}
   * @purity semi-pure-b
   */
  inlineSvgStyles(svg) {
    const clone = svg.cloneNode(true);
    const origEls = [...svg.querySelectorAll("*")];
    const cloneEls = [...clone.querySelectorAll("*")];
    const props = [
      "fill", "fill-opacity", "stroke", "stroke-width",
      "font-family", "font-size", "font-weight", "font-style",
      "text-anchor", "dominant-baseline", "opacity", "visibility",
    ];
    /** @purity non-pure */
    origEls.forEach((orig, i) => {
      const s = getComputedStyle(orig);
      /** @purity non-pure */
      props.forEach((p) => {
        const v = s.getPropertyValue(p);
        if (v) cloneEls[i].setAttribute(p, v);
      });
    });
    return clone;
  }

  /**
   * @param {SVGSVGElement} svgClone
   * @param {SVGSVGElement} svgOrig
   * @purity non-pure
   */
  convertForeignObjects(svgClone, svgOrig) {
    const origFOs = [...svgOrig.querySelectorAll("foreignObject")];
    const cloneFOs = [...svgClone.querySelectorAll("foreignObject")];

    /** @purity non-pure */
    origFOs.forEach((origFO, i) => {
      const cloneFO = cloneFOs[i];
      if (!cloneFO) return;

      const x = parseFloat(origFO.getAttribute("x") || 0);
      const y = parseFloat(origFO.getAttribute("y") || 0);
      const w = parseFloat(origFO.getAttribute("width") || 0);
      const h = parseFloat(origFO.getAttribute("height") || 0);

      const text = (origFO.textContent || "").trim().replace(/\s+/g, " ");
      if (!text) { cloneFO.remove(); return; }

      const innerEl = origFO.querySelector("span, p, div") || origFO;
      const s = getComputedStyle(innerEl);
      const fontSize = s.getPropertyValue("font-size") || "14px";
      const fontFamily = s.getPropertyValue("font-family") || "sans-serif";
      const fill = s.getPropertyValue("color") || "#000000";

      const textEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
      textEl.setAttribute("text-anchor", "middle");
      textEl.setAttribute("dominant-baseline", "middle");
      textEl.setAttribute("font-size", fontSize);
      textEl.setAttribute("font-family", fontFamily);
      textEl.setAttribute("fill", fill);

      const lines = text.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 1) {
        textEl.setAttribute("x", String(x + w / 2));
        textEl.setAttribute("y", String(y + h / 2));
        textEl.textContent = lines[0];
      } else {
        const lineH = parseFloat(fontSize) * 1.2;
        const totalH = (lines.length - 1) * lineH;
        textEl.setAttribute("x", String(x + w / 2));
        textEl.setAttribute("y", String(y + h / 2 - totalH / 2));
        /** @purity non-pure */
        lines.forEach((line, j) => {
          const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
          tspan.setAttribute("x", String(x + w / 2));
          tspan.setAttribute("dy", j === 0 ? "0" : String(lineH));
          tspan.textContent = line;
          textEl.appendChild(tspan);
        });
      }

      cloneFO.parentElement.replaceChild(textEl, cloneFO);
    });
  }

  /**
   * @param {SVGSVGElement} svg
   * @returns {SVGSVGElement}
   * @purity semi-pure-b
   */
  prepareSvg(svg) {
    const clone = this.inlineSvgStyles(svg);
    this.convertForeignObjects(clone, svg);
    if (!clone.getAttribute("xmlns"))
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const bbox = svg.getBoundingClientRect();
    clone.setAttribute("width", String(bbox.width));
    clone.setAttribute("height", String(bbox.height));
    return clone;
  }

  /**
   * @param {HTMLButtonElement} btn @param {string} msg @param {string} reset @param {number} [ms]
   * @purity non-pure
   */
  showFeedback(btn, msg, reset, ms = CONFIG.ui.copyFeedbackDuration) {
    btn.textContent = msg;
    /** @purity non-pure */
    setTimeout(() => { btn.textContent = reset; }, ms);
  }

  /** @purity non-pure */
  async copyAsSvg(container, btn) {
    try {
      let blob;
      if (container.classList.contains("mermaid")) {
        const svg = container.querySelector("svg");
        if (!svg) return;
        const svgText = new XMLSerializer().serializeToString(this.prepareSvg(svg));
        blob = new Blob([svgText], { type: "image/svg+xml" });
      } else {
        const img = container.querySelector("img.plantuml-diagram");
        if (!img) return;
        const svgText = await (await fetch(img.src)).text();
        blob = new Blob([svgText], { type: "image/svg+xml" });
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/svg+xml": blob })]);
      this.showFeedback(btn, D.copied, D.copySvg);
    } catch (err) {
      console.error("SVG copy failed:", err);
      this.showFeedback(btn, D.copyFailed, D.copySvg, CONFIG.ui.copyFeedbackDuration * 4);
    }
  }

  /** @purity non-pure */
  async copyAsPng(container, btn) {
    try {
      let pngBlob;
      if (container.classList.contains("mermaid")) {
        const svg = container.querySelector("svg");
        if (!svg) return;
        const prepared = this.prepareSvg(svg);
        const svgText = new XMLSerializer().serializeToString(prepared);
        const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
        const scale = 2;
        const w = parseFloat(prepared.getAttribute("width")) * scale;
        const h = parseFloat(prepared.getAttribute("height")) * scale;
        const img = new Image();
        /** @purity non-pure */
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        URL.revokeObjectURL(url);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        pngBlob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      } else {
        const img = container.querySelector("img.plantuml-diagram");
        if (!img) return;
        const pngUrl = img.src.replace("/plantuml/svg/", "/plantuml/png/");
        pngBlob = await (await fetch(pngUrl)).blob();
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      this.showFeedback(btn, D.copied, D.copyPng);
    } catch (err) {
      console.error("PNG copy failed:", err);
      this.showFeedback(btn, D.copyFailed, D.copyPng, CONFIG.ui.copyFeedbackDuration * 4);
    }
  }
}
