import { describe, it, expect, vi } from "vitest";
import { WHEEL_LINE_PX, wheelScrollDelta, forwardWheel } from "../js/wheelForwarding.js";

// A wheel turn over an element on the body (the gap line, INV-73; the block
// range bar, INV-74 (2)) goes to the preview when it scrolls itself (owner
// ruling AQ8). The gap line and the bar use this one helper (AT-RNG-54).

describe("AT-RNG-54 wheelForwarding (INV-73, INV-74 (2), AQ8)", () => {
  it("wheelScrollDelta (pure): pixels as they are, lines x WHEEL_LINE_PX, pages x the page height, Shift sideways", () => {
    const turn = (init) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, ...init });
    expect(wheelScrollDelta(turn({ deltaY: 120 }), 400)).toEqual({ left: 0, top: 120 });
    expect(wheelScrollDelta(turn({ deltaY: 3, deltaMode: 1 }), 400)).toEqual({ left: 0, top: 3 * WHEEL_LINE_PX });
    expect(wheelScrollDelta(turn({ deltaY: -1, deltaMode: 2 }), 400)).toEqual({ left: 0, top: -400 });
    expect(wheelScrollDelta(turn({ deltaX: 20, deltaY: 5 }), 400)).toEqual({ left: 20, top: 5 });
    expect(wheelScrollDelta(turn({ deltaY: 50, shiftKey: true }), 400)).toEqual({ left: 50, top: 0 });
    // a sideways turn with Shift stays sideways
    expect(wheelScrollDelta(turn({ deltaX: 30, shiftKey: true }), 400)).toEqual({ left: 30, top: 0 });
  });

  it("forwardWheel: only to a scroller that scrolls itself and has more content, never with Ctrl", () => {
    const scroller = document.createElement("div");
    document.body.appendChild(scroller);
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2000 });
    scroller.scrollBy = vi.fn();
    const send = (init) => new WheelEvent("wheel", { cancelable: true, ...init });
    scroller.style.overflowY = "visible";
    let e = send({ deltaY: 100 });
    expect(forwardWheel(e, scroller)).toBe(false);
    expect(e.defaultPrevented).toBe(false);
    scroller.style.overflowY = "scroll";
    e = send({ deltaY: 100, ctrlKey: true });
    expect(forwardWheel(e, scroller)).toBe(false);
    expect(e.defaultPrevented).toBe(false);
    expect(scroller.scrollBy).not.toHaveBeenCalled();
    e = send({ deltaY: 100 });
    expect(forwardWheel(e, scroller)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(scroller.scrollBy).toHaveBeenCalledWith({ left: 0, top: 100 });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 400 }); // nothing more to show
    expect(forwardWheel(send({ deltaY: 100 }), scroller)).toBe(false);
    scroller.remove();
  });
});
