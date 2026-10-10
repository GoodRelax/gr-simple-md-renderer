import { describe, it, expect, vi, afterEach } from "vitest";
import ScrollMemento from "../js/classes/ScrollMemento.js";

// jsdom has no layout: a fake container and fake element tops.
function stubMatchMedia(coarse) {
  vi.stubGlobal("matchMedia", (q) => ({ matches: q.includes("coarse") ? coarse : false }));
}

function fakeElement(getTop) {
  return { getBoundingClientRect: () => ({ top: getTop() }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ScrollMemento anchors (INV-46)", () => {
  it("AT-SM-01 captureAnchor returns the element's top in the viewport and changes nothing", () => {
    stubMatchMedia(false);
    const container = { scrollTop: 100 };
    const memento = new ScrollMemento(container);
    const el = fakeElement(() => 300 - container.scrollTop);
    expect(memento.captureAnchor(el)).toEqual({ offsetTop: 200 });
    expect(container.scrollTop).toBe(100);
  });

  it("AT-SM-02 after the content above grows by 120 px, restoreAnchor puts the element back (+-1 px)", () => {
    stubMatchMedia(false);
    const container = { scrollTop: 100 };
    const memento = new ScrollMemento(container);
    let base = 300;
    const el = fakeElement(() => base - container.scrollTop);
    const anchor = memento.captureAnchor(el);
    base += 120;
    memento.restoreAnchor(anchor, el);
    expect(container.scrollTop).toBe(220);
    expect(Math.abs(el.getBoundingClientRect().top - anchor.offsetTop)).toBeLessThanOrEqual(1);
  });

  it("AT-SM-03 no element or no anchor: the scroll position does not change", () => {
    stubMatchMedia(false);
    const container = { scrollTop: 50 };
    const memento = new ScrollMemento(container);
    memento.restoreAnchor({ offsetTop: 10 }, null);
    memento.restoreAnchor(null, fakeElement(() => 0));
    expect(container.scrollTop).toBe(50);
    expect(memento.captureAnchor(null)).toBe(null);
  });

  it("AT-SM-04 on touch devices the document scrolls (window.scrollTo)", () => {
    stubMatchMedia(true);
    vi.stubGlobal("scrollY", 400);
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const memento = new ScrollMemento({ scrollTop: 0 });
    let top = 250;
    const el = fakeElement(() => top);
    const anchor = memento.captureAnchor(el);
    top = 330;
    memento.restoreAnchor(anchor, el);
    expect(scrollTo).toHaveBeenCalledWith(0, 480);
  });

  it("AT-SM-05 save() and restore() behave as before", () => {
    stubMatchMedia(false);
    const container = { scrollTop: 77 };
    const memento = new ScrollMemento(container);
    expect(memento.save()).toBe(77);
    memento.restore(12);
    expect(container.scrollTop).toBe(12);
  });
});
