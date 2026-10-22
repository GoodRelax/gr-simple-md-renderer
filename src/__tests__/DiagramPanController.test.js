import { describe, it, expect, afterEach } from "vitest";
import DiagramPanController from "../js/classes/DiagramPanController.js";

// The drag that pans a diagram (or the preview) ends with the button: a
// mouseup that never comes (WebKit sends none when the pressed element left
// the DOM, as when a click on a diagram opens its code) must not leave a
// pan that a plain mouse move goes on with (PRT-U20).

let preview;
afterEach(() => {
  preview?.remove();
  document.body.style.cursor = "";
});

function setup() {
  preview = document.createElement("div");
  const diagram = document.createElement("div");
  diagram.className = "mermaid";
  const svg = document.createElement("span");
  diagram.append(svg);
  preview.append(diagram);
  document.body.append(preview);
  const pan = new DiagramPanController(preview);
  return { pan, diagram, svg };
}

const mouse = (target, type, { x = 0, y = 0, buttons = 1 } = {}) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }));

describe("AT-PAN DiagramPanController", () => {
  it("AT-PAN-01 a drag with the button held pans the preview", () => {
    const { pan, svg } = setup();
    mouse(svg, "mousedown", { x: 10, y: 100 });
    mouse(document, "mousemove", { x: 10, y: 60 });
    expect(pan.panState?.active).toBe(true);
    expect(preview.scrollTop).toBeGreaterThanOrEqual(0); // jsdom: no layout; the state is what is checked
    mouse(document, "mouseup", { x: 10, y: 60, buttons: 0 });
    expect(pan.panState).toBe(null);
    expect(document.body.style.cursor).toBe("");
  });

  it("AT-PAN-02 a move with no button held ends the pan without moving anything (no mouseup came)", () => {
    const { pan, svg, diagram } = setup();
    mouse(svg, "mousedown", { x: 10, y: 100 });
    mouse(document, "mousemove", { x: 10, y: 60 });
    expect(pan.panState?.active).toBe(true);
    svg.remove(); // the pressed element leaves the DOM: WebKit sends no mouseup
    const before = { scrollTop: preview.scrollTop, cursor: diagram.style.cursor };
    expect(before.cursor).toBe("grabbing");
    let scrolled = false;
    Object.defineProperty(preview, "scrollTop", { configurable: true, get: () => 0, set: () => (scrolled = true) });
    mouse(document, "mousemove", { x: 10, y: -80, buttons: 0 });
    expect(scrolled).toBe(false);
    expect(pan.panState).toBe(null);
    expect(diagram.style.cursor).toBe("");
    expect(document.body.style.cursor).toBe("");
  });

  it("AT-PAN-03 a pointerup or pointercancel ends the pan too", () => {
    const { pan, svg } = setup();
    for (const end of ["pointerup", "pointercancel"]) {
      mouse(svg, "mousedown", { x: 10, y: 100 });
      expect(pan.panState).not.toBe(null);
      document.dispatchEvent(new Event(end, { bubbles: true }));
      expect(pan.panState, end).toBe(null);
    }
  });
});
