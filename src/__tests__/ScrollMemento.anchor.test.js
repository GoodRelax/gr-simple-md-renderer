import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import ScrollMemento from "../js/classes/ScrollMemento.js";

// jsdom has no layout: a fake container and fake element tops.
function stubMatchMedia(coarse) {
  vi.stubGlobal("matchMedia", (q) => ({ matches: q.includes("coarse") ? coarse : false }));
}

function fakeElement(getTop) {
  return { getBoundingClientRect: () => ({ top: getTop() }), getClientRects: () => [{}] };
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

describe("ScrollMemento reading anchor (5.1, PRT-X08)", () => {
  const NO_BOX = { top: 0, bottom: 0 };

  // the fakes are not elements: their position is a field (static unless set)
  beforeEach(() => {
    vi.stubGlobal("getComputedStyle", (el) => ({ position: el.position ?? "static" }));
  });

  /** A fake element: shown with a box from top() to top() + height, or without a box. */
  function fakeBox(shown, top, height, classes = [], children = []) {
    return {
      children,
      classList: { contains: (c) => classes.includes(c) },
      getClientRects: () => (shown() ? [{}] : []),
      getBoundingClientRect: () => (shown() ? { top: top(), bottom: top() + height } : NO_BOX),
    };
  }

  /**
   * A container whose children are laid out from specs: {h} is shown with
   * height h, {h, none: true} has no box (display: none), {h, cls} carries
   * classes. grow(i) moves child i down (what appeared above it), inner(i)
   * moves its content down inside it (a table block's strip). touch: the
   * document scrolls (window.scrollY) and the container's top is 50 - scrollY.
   */
  function scrolled(specs, scrollTop, grow = () => 0, inner = () => 0, touch = false) {
    stubMatchMedia(touch);
    const container = { scrollTop, getBoundingClientRect: () => ({ top: touch ? 50 - window.scrollY : 50 }), children: [] };
    const scrolledBy = () => (touch ? window.scrollY : container.scrollTop);
    let y = 0;
    specs.forEach((spec, i) => {
      const at = y;
      const shown = () => !spec.none;
      const blockTop = () => 50 + at + grow(i) - scrolledBy();
      const content = fakeBox(shown, () => blockTop() + 5 + inner(i), Math.max(0, spec.h - 5));
      container.children.push(fakeBox(shown, blockTop, spec.h, spec.cls ?? [], [content]));
      if (!spec.none) y += spec.h;
    });
    return container;
  }

  /** The place by looking at every child in turn (what halving must find). */
  function linearPlace(container) {
    const top = container.getBoundingClientRect().top;
    const places = container.children.filter((c) => c.getClientRects().length > 0 && !c.classList.contains("md-block-hidden") && !c.classList.contains("md-block-empty"));
    if (places.length === 0) return null;
    return places.find((c) => c.getBoundingClientRect().bottom > top) ?? places[places.length - 1];
  }

  it("AT-SM-06 finds the first block that reaches below the top of what is shown, and anchors its content", () => {
    const container = scrolled([{ h: 100 }, { h: 100 }, { h: 100 }, { h: 100 }], 250);
    const saved = new ScrollMemento(container).captureReadingAnchor();
    expect(saved.element).toBe(container.children[2].children[0]);
    expect(saved.anchor).toEqual({ offsetTop: 50 + 200 - 250 + 5 });
  });

  it("AT-SM-07 after 20 px appeared above each of the blocks before it, restoreReadingAnchor puts it back", () => {
    let grown = false;
    const container = scrolled([{ h: 100 }, { h: 100 }, { h: 100 }, { h: 100 }], 250, (i) => (grown ? 20 * (i + 1) : 0));
    const memento = new ScrollMemento(container);
    const saved = memento.captureReadingAnchor();
    grown = true;
    saved.element.isConnected = true;
    memento.restoreReadingAnchor(saved);
    expect(saved.element.getBoundingClientRect().top).toBe(saved.anchor.offsetTop);
  });

  it("AT-SM-08 no children or no anchor: nothing", () => {
    stubMatchMedia(false);
    const memento = new ScrollMemento({ scrollTop: 0, getBoundingClientRect: () => ({ top: 0 }), children: [] });
    expect(memento.captureReadingAnchor()).toBeNull();
    expect(() => memento.restoreReadingAnchor(null)).not.toThrow();
  });

  it("AT-SM-09 children without a box (hidden blocks while browsing) are passed over: same place as looking at every child", () => {
    // a block, then a comment without a box, 60 times (the review's document), and runs of them
    const patterns = [
      Array.from({ length: 120 }, (_, i) => (i % 2 === 1 ? { h: 30, none: true } : { h: 80 })),
      Array.from({ length: 50 }, (_, i) => (i % 7 < 4 ? { h: 30, none: true } : { h: 60 })),
      [{ h: 10, none: true }, { h: 10, none: true }, { h: 100 }, { h: 10, none: true }],
    ];
    for (const specs of patterns) {
      const total = specs.filter((s) => !s.none).reduce((sum, s) => sum + s.h, 0);
      for (let scrollTop = 0; scrollTop <= total; scrollTop += 17) {
        const container = scrolled(specs, scrollTop);
        const saved = new ScrollMemento(container).captureReadingAnchor();
        expect(saved.element).toBe(linearPlace(container).children[0]);
      }
    }
  });

  it("AT-SM-10 a band or the empty block that edit mode alone shows is not the place, though it has a box", () => {
    const specs = [{ h: 100 }, { h: 20, cls: ["md-block", "md-block-hidden"] }, { h: 30, cls: ["md-block", "md-block-empty"] }, { h: 100 }];
    const container = scrolled(specs, 110);
    const saved = new ScrollMemento(container).captureReadingAnchor();
    expect(saved.element).toBe(container.children[3].children[0]);
  });

  it("AT-SM-11 a long block whose middle is at the top: that block is the place, anchored by its content above the top", () => {
    const container = scrolled([{ h: 100 }, { h: 5000 }, { h: 100 }], 2600);
    const memento = new ScrollMemento(container);
    const saved = memento.captureReadingAnchor();
    expect(saved.element).toBe(container.children[1].children[0]);
    expect(saved.anchor.offsetTop).toBe(50 + 100 - 2600 + 5);
  });

  it("AT-SM-12 a block of height 0 at the top is passed over; a first child without a box is not the anchor", () => {
    const container = scrolled([{ h: 100 }, { h: 0 }, { h: 100 }], 100);
    const memento = new ScrollMemento(container);
    expect(memento.captureReadingAnchor().element).toBe(container.children[2].children[0]);
    // the block's first child has no box (a table tab while browsing): the next child is the anchor
    const block = container.children[2];
    const hiddenFirst = fakeBox(() => false, () => 0, 0);
    const shownNext = block.children[0];
    block.children = [hiddenFirst, shownNext];
    expect(memento.captureReadingAnchor().element).toBe(shownNext);
  });

  it("AT-SM-13 everything shown is above the top: the last place; nothing shown: null", () => {
    const container = scrolled([{ h: 100 }, { h: 100 }, { h: 10, none: true }], 500);
    expect(new ScrollMemento(container).captureReadingAnchor().element).toBe(container.children[1].children[0]);
    const empty = scrolled([{ h: 10, none: true }, { h: 20, cls: ["md-block-empty"] }], 0);
    expect(new ScrollMemento(empty).captureReadingAnchor()).toBeNull();
  });

  it("AT-SM-14 the anchor no longer shown after the change: the scroll position does not change", () => {
    let shown = true;
    const container = scrolled([{ h: 100 }, { h: 100 }], 120);
    const memento = new ScrollMemento(container);
    const saved = memento.captureReadingAnchor();
    saved.element.isConnected = true;
    saved.element.getClientRects = () => (shown ? [{}] : []);
    shown = false;
    memento.restoreReadingAnchor(saved);
    expect(container.scrollTop).toBe(120);
  });

  it("AT-SM-15 when the document scrolls (touch), the top of what is shown is the bottom of the sticky top bar", () => {
    const bar = document.createElement("div");
    bar.id = "topbar";
    bar.getBoundingClientRect = () => ({ top: 0, bottom: 60 });
    document.body.appendChild(bar);
    try {
      window.scrollY = 120;
      let grown = false;
      const scrollTo = vi.fn((x, y) => {
        window.scrollY = y;
      });
      vi.stubGlobal("scrollTo", scrollTo);
      // blocks at 50..150, 150..250, 250..350 minus 120: the second ends at 130, below the bar's 60
      const container = scrolled([{ h: 100 }, { h: 100 }, { h: 100 }], 0, (i) => (grown ? 20 * i : 0), () => 0, true);
      const memento = new ScrollMemento(container);
      const saved = memento.captureReadingAnchor();
      expect(saved.element).toBe(container.children[1].children[0]);
      grown = true;
      saved.element.isConnected = true;
      memento.restoreReadingAnchor(saved);
      expect(scrollTo).toHaveBeenCalledWith(0, 140);
      expect(saved.element.getBoundingClientRect().top).toBe(saved.anchor.offsetTop);
    } finally {
      bar.remove();
      window.scrollY = 0;
    }
  });

  it("AT-SM-16 the anchor is gone (no longer in the document): the scroll position does not change", () => {
    let grown = false;
    const container = scrolled([{ h: 100 }, { h: 100 }], 120, () => (grown ? 30 : 0));
    const memento = new ScrollMemento(container);
    const saved = memento.captureReadingAnchor();
    saved.element.isConnected = false;
    grown = true;
    memento.restoreReadingAnchor(saved);
    expect(container.scrollTop).toBe(120);
  });

  it("AT-SM-17 the content moves inside its block (the 20 px strip above a table): the content is what is put back", () => {
    let strip = false;
    const container = scrolled([{ h: 100 }, { h: 100 }, { h: 100 }], 150, () => 0, (i) => (strip && i === 1 ? 20 : 0));
    const memento = new ScrollMemento(container);
    const saved = memento.captureReadingAnchor();
    expect(saved.element).toBe(container.children[1].children[0]);
    strip = true;
    saved.element.isConnected = true;
    memento.restoreReadingAnchor(saved);
    expect(container.scrollTop).toBe(170);
  });

  it("AT-SM-18 a long run of children without a box: each child is read at most about twice", () => {
    const count = 30000;
    for (const specs of [
      Array.from({ length: count }, (_, i) => (i === count - 1 ? { h: 50 } : { h: 10, none: true })),
      Array.from({ length: count }, (_, i) => (i === 0 || i === count - 1 ? { h: 50 } : { h: 10, none: true })),
    ]) {
      const container = scrolled(specs, 30);
      const spy = vi.spyOn(ScrollMemento, "_canBePlace");
      const saved = new ScrollMemento(container).captureReadingAnchor();
      expect(saved.element).toBe(linearPlace(container).children[0]);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(2 * count + 64);
      spy.mockRestore();
    }
  });

  it("AT-SM-19 capturePlaceAt gives the place reaching below a given top, and movedBy how far it has moved", () => {
    let grown = false;
    const container = scrolled([{ h: 100 }, { h: 20, none: true }, { h: 100 }, { h: 100 }], 0, (i) => (grown && i >= 2 ? 22 : 0));
    const memento = new ScrollMemento(container);
    // the top of the third block: 50 + 100 = 150
    const place = memento.capturePlaceAt(150);
    expect(place.element).toBe(container.children[2]);
    place.element.isConnected = true;
    expect(memento.movedBy(place)).toBe(0);
    grown = true;
    expect(memento.movedBy(place)).toBe(22);
    expect(memento.movedBy(null)).toBe(0);
  });

  it("AT-SM-20 a top in a gap above a place (a band only edit mode shows) follows the bottom of the place before it", () => {
    let gone = false;
    const specs = [{ h: 100 }, { h: 22, cls: ["md-block-hidden"] }, { h: 100 }];
    // the band (child 1) goes away: the block after it moves up by 22
    const container = scrolled(specs, 0, (i) => (gone && i === 2 ? -22 : 0));
    const memento = new ScrollMemento(container);
    const place = memento.capturePlaceAt(50 + 100 + 5);
    expect(place.element).toBe(container.children[0]);
    expect(place.edge).toBe("bottom");
    expect(place.anchor.offsetTop).toBe(50 + 100);
    place.element.isConnected = true;
    gone = true;
    expect(memento.movedBy(place)).toBe(0);
  });

  it("AT-SM-21 a top inside a place follows the shown child it falls in (the table under its strip), or the place at its own top", () => {
    let strip = true;
    const container = scrolled([{ h: 100 }, { h: 120 }, { h: 100 }], 0, () => 0, (i) => (strip && i === 1 ? 20 : 0));
    const memento = new ScrollMemento(container);
    const block = container.children[1];
    // the block's own top (50 + 100): above its content, so the block itself
    const own = memento.capturePlaceAt(150);
    expect(own.element).toBe(block);
    // inside the table (below the strip): the content
    const inside = memento.capturePlaceAt(200);
    expect(inside.element).toBe(block.children[0]);
    inside.element.isConnected = true;
    own.element.isConnected = true;
    strip = false;
    expect(memento.movedBy(inside)).toBe(-20);
    expect(memento.movedBy(own)).toBe(0);
  });

  it("AT-SM-22 restoreAnchor on an element without a box (a hidden block outside edit mode) changes nothing", () => {
    stubMatchMedia(false);
    const container = { scrollTop: 300 };
    const memento = new ScrollMemento(container);
    const hidden = { getBoundingClientRect: () => ({ top: 0 }), getClientRects: () => [] };
    memento.restoreAnchor({ offsetTop: 400 }, hidden);
    expect(container.scrollTop).toBe(300);
  });

  it("AT-SM-23 touch: without a top bar, or with one scrolled away, the top of what is shown is 0", () => {
    window.scrollY = 120;
    try {
      const container = scrolled([{ h: 100 }, { h: 100 }, { h: 100 }], 0, () => 0, () => 0, true);
      const memento = new ScrollMemento(container);
      // blocks at -70..30, 30..130: the first reaches below 0
      expect(memento.captureReadingAnchor().element).toBe(container.children[0].children[0]);
      const bar = document.createElement("div");
      bar.id = "topbar";
      bar.getBoundingClientRect = () => ({ top: -80, bottom: -20 });
      document.body.appendChild(bar);
      try {
        expect(memento.captureReadingAnchor().element).toBe(container.children[0].children[0]);
      } finally {
        bar.remove();
      }
    } finally {
      window.scrollY = 0;
    }
  });

  it("AT-SM-24 a top inside a table block below its strip follows the table, not the tab placed out of the flow at the block's top", () => {
    let strip = true;
    const container = scrolled([{ h: 100 }, { h: 120 }, { h: 100 }], 0, () => 0, (i) => (strip && i === 1 ? 20 : 0));
    const memento = new ScrollMemento(container);
    const block = container.children[1];
    const table = block.children[0];
    // the tab: last child, absolutely placed at the block's top, shown in edit mode only
    const tab = fakeBox(() => strip, () => block.getBoundingClientRect().top, 18);
    tab.position = "absolute";
    block.children = [table, tab];
    const inside = memento.capturePlaceAt(200);
    expect(inside.element).toBe(table);
    // the table block is the reading place, with the shown tab first: the content is the table
    container.scrollTop = 120;
    block.children = [tab, table];
    expect(memento.captureReadingAnchor().element).toBe(table);
    // while browsing the tab has no box (top 0): it is not followed either
    container.scrollTop = 0;
    strip = false;
    expect(memento.capturePlaceAt(200).element).toBe(table);
  });

  it("AT-SM-25 a child whose top is exactly the given top is the one followed", () => {
    const container = scrolled([{ h: 100 }, { h: 100 }], 0);
    const block = container.children[1];
    const content = block.children[0];
    // the first child starts at the block's top, as a wrapper's first child does
    const first = fakeBox(() => true, () => block.getBoundingClientRect().top, 5);
    block.children = [first, content];
    const memento = new ScrollMemento(container);
    expect(memento.capturePlaceAt(150).element).toBe(first);
    expect(memento.capturePlaceAt(155).element).toBe(content);
  });

  it("AT-SM-26 a gap above the first place, with no place before it: the top of that place is followed", () => {
    const container = scrolled([{ h: 30, cls: ["md-block-hidden"] }, { h: 100 }], 0);
    const memento = new ScrollMemento(container);
    const place = memento.capturePlaceAt(60);
    expect(place.element).toBe(container.children[1]);
    expect(place.edge).toBe("top");
    expect(place.anchor.offsetTop).toBe(80);
  });

  it("AT-SM-27 a whole-document block of 30,000 elements: a top inside it is found by halving", () => {
    const tops = Array.from({ length: 30000 }, (_, i) => 50 + 20 * i);
    const block = fakeBox(() => true, () => 50, 20 * 30000);
    let reads = 0;
    block.children = tops.map((t) => {
      const child = fakeBox(() => true, () => t, 20);
      const rect = child.getBoundingClientRect;
      child.getBoundingClientRect = () => {
        reads++;
        return rect();
      };
      return child;
    });
    stubMatchMedia(false);
    const container = { scrollTop: 0, getBoundingClientRect: () => ({ top: 50 }), children: [block] };
    const found = new ScrollMemento(container).capturePlaceAt(50 + 20 * 12345 + 7);
    expect(found.element).toBe(block.children[12345]);
    expect(reads).toBeLessThan(64);
  });

  /** The step of the document scroll in the tests (CSS px). */
  const STEP = 2.5;
  /**
   * Starting positions on steps 100 to 139 of a document scroll of step px:
   * for the emulation's step of 2.513 px, the part after the point spreads
   * from 0 to 1 (scrollY reads the whole number: the "one more" of the
   * search span); steps of 2.5 and 6 px give only .3 / .8 and .3.
   */
  function startsOn(step) {
    const starts = [];
    for (let n = 100; n < 140; n++) starts.push(0.3 + step * n);
    return starts;
  }
  /**
   * The document scroll of WebKit on a zoomed-out page: positions on steps
   * of step px from 0.3, a request rounded down to a step at or below its
   * whole number, at most max, and scrollY read as a whole number. A step
   * is one screen pixel (the zoom is 1 / step) and devicePixels device
   * pixels; WebKit's devicePixelRatio holds the zoom (measured in the e2e
   * emulation: zoom 0.398, a step of 2.513 px, devicePixelRatio 0.796 with
   * two device pixels and 1.194 with three).
   */
  function steppedDocument(start, step = STEP, max = Infinity, devicePixels = 1) {
    // a scroll position is on a step: the step nearest start
    let pos = 0.3 + step * Math.round((start - 0.3) / step);
    window.scrollY = Math.floor(pos);
    window.devicePixelRatio = devicePixels / step;
    vi.stubGlobal("visualViewport", { scale: 1 / step });
    const scrollTo = vi.fn((x, y) => {
      pos = Math.min(max, 0.3 + step * Math.floor((Math.floor(y) - 0.3) / step));
      window.scrollY = Math.floor(pos);
    });
    vi.stubGlobal("scrollTo", scrollTo);
    return { scrollTo, pos: () => pos };
  }

  function touch(run) {
    stubMatchMedia(true);
    try {
      run();
    } finally {
      window.scrollY = 0;
      window.devicePixelRatio = 1;
    }
  }

  /** A reading place whose top is at - pos, and lower by shift() in edit mode. */
  function readingPlace(doc, at, shift) {
    const top = () => at - doc.pos() + shift();
    const content = { getBoundingClientRect: () => ({ top: top(), bottom: top() + 80 }), getClientRects: () => [{}], isConnected: true };
    const block = { children: [content], classList: { contains: () => false }, getClientRects: () => [{}], getBoundingClientRect: () => ({ top: top(), bottom: top() + 80 }) };
    return { top, memento: new ScrollMemento({ getBoundingClientRect: () => ({ top: 0 }), children: [block] }) };
  }

  it("AT-SM-28 touch: a scroll that lands on steps puts the element as near its aim as a step allows, either way", () => {
    touch(() => {
      // aims on both sides and at every fraction of a step, for steps of 2.5
      // and 6 px of one device pixel, and of 2.513 px of two and three (the
      // emulation)
      // (the worst miss per step is checked once: an expect per try made the
      // test slow enough to time out on a loaded machine)
      for (const [step, devicePixels] of [[STEP, 1], [6, 1], [2.513, 2], [2.513, 3]]) {
        let worst = 0;
        for (const start of startsOn(step)) {
          for (let aim = 60; aim <= 140; aim += 0.37) {
            const doc = steppedDocument(start, step, Infinity, devicePixels);
            const el = { getBoundingClientRect: () => ({ top: start + 125 - doc.pos() }), getClientRects: () => [{}] };
            new ScrollMemento({}).restoreAnchor({ offsetTop: aim }, el);
            worst = Math.max(worst, Math.abs(el.getBoundingClientRect().top - aim));
          }
        }
        expect(worst, `step ${step}`).toBeLessThanOrEqual(step / 2);
      }
    });
  }, 30000);

  it("AT-SM-29 touch: in and out of edit mode again and again, the place stays within half a step of where it was", () => {
    touch(() => {
      // strips of every height from 1 to 40 px, for the same steps, with the
      // place at different fractions of a pixel (the device pixel ratio does
      // not change the search: AT-SM-33; the worst drift per step is
      // checked once, as in AT-SM-28)
      for (const [step, devicePixels] of [[STEP, 1], [6, 1], [2.513, 2]]) {
        let worst = 0;
        for (const at of startsOn(step)) {
          for (let shift = 1; shift <= 40; shift += 0.9) {
            const doc = steppedDocument(at, step, Infinity, devicePixels);
            let edit = false;
            const { top, memento } = readingPlace(doc, at + 37.4 + (shift % 1), () => (edit ? shift : 0));
            const start = top();
            for (let i = 0; i < 10; i++) {
              const saved = memento.captureReadingAnchor();
              edit = !edit;
              memento.restoreReadingAnchor(saved);
              worst = Math.max(worst, Math.abs(top() - start));
            }
          }
        }
        expect(worst, `step ${step}`).toBeLessThanOrEqual(step / 2);
      }
    });
  }, 30000);

  it("AT-SM-30 a browser that lands where asked scrolls once", () => {
    touch(() => {
      let pos = 300;
      const scrollTo = vi.fn((x, y) => {
        pos = y;
        window.scrollY = y;
      });
      vi.stubGlobal("scrollTo", scrollTo);
      window.scrollY = pos;
      const el = { getBoundingClientRect: () => ({ top: 500 - pos }), getClientRects: () => [{}] };
      new ScrollMemento({}).restoreAnchor({ offsetTop: 100 }, el);
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(el.getBoundingClientRect().top).toBe(100);
    });
  });

  it("AT-SM-31 at the end of the document (it cannot scroll that way): the try and one a span further, and nothing moves", () => {
    touch(() => {
      const doc = steppedDocument(375.3, STEP, 375.3);
      const el = { getBoundingClientRect: () => ({ top: 500 - doc.pos() }), getClientRects: () => [{}] };
      new ScrollMemento({}).restoreAnchor({ offsetTop: 100 }, el);
      expect(doc.scrollTo).toHaveBeenCalledTimes(2);
      expect(doc.pos()).toBe(375.3);
    });
  });

  it("AT-SM-32 touch: restore() goes back to where save() read, though a request lands a step below it", () => {
    touch(() => {
      const doc = steppedDocument(375.3);
      const memento = new ScrollMemento({});
      const saved = memento.save();
      window.scrollTo(0, 900);
      memento.restore(saved);
      expect(window.scrollY).toBe(saved);
      expect(doc.pos()).toBe(375.3);
    });
  });

  it("AT-SM-33 the search span is one screen pixel and one more, within its bounds, whatever the device pixel ratio", () => {
    const span = () => ScrollMemento._scrollSearchSpan();
    try {
      // the e2e emulation: zoom 0.398 (a step of 2.513 px), devicePixelRatio
      // 0.796 or 1.194 (two or three device pixels, the zoom held)
      for (const ratio of [0.796, 1.194, 3]) {
        window.devicePixelRatio = ratio;
        vi.stubGlobal("visualViewport", { scale: 0.398 });
        expect(span()).toBe(4);
      }
      // not zoomed (a desktop browser), and no visualViewport
      window.devicePixelRatio = 2;
      vi.stubGlobal("visualViewport", { scale: 1 });
      expect(span()).toBe(2);
      vi.stubGlobal("visualViewport", undefined);
      expect(span()).toBe(2);
      // the bounds
      window.devicePixelRatio = 1;
      vi.stubGlobal("visualViewport", { scale: 0.01 });
      expect(span()).toBe(32);
      vi.stubGlobal("visualViewport", { scale: 4 });
      expect(span()).toBe(2);
    } finally {
      window.devicePixelRatio = 1;
    }
  });

  it("AT-SM-34 a correction under half a pixel in a browser that rounds to the nearest pixel stays where it is", () => {
    touch(() => {
      let pos = 300;
      window.scrollY = pos;
      const scrollTo = vi.fn((x, y) => {
        pos = Math.round(y);
        window.scrollY = pos;
      });
      vi.stubGlobal("scrollTo", scrollTo);
      const el = { getBoundingClientRect: () => ({ top: 500 - pos }), getClientRects: () => [{}] };
      new ScrollMemento({}).restoreAnchor({ offsetTop: 199.7 }, el);
      expect(pos).toBe(300);
      expect(scrollTo).toHaveBeenCalledTimes(1);
    });
  });

  it("AT-SM-35 when nothing moves at first but the far try does, the search ends on the nearest landing", () => {
    touch(() => {
      // steps of 6 px, a request landing on the step nearest it (by the request
      // alone, as scrollTo does): a request within 3 px of where it is stays
      window.devicePixelRatio = 1 / 6;
      vi.stubGlobal("visualViewport", { scale: 1 / 6 });
      for (let aim = 190; aim <= 210; aim += 0.3) {
        let pos = 300;
        window.scrollY = pos;
        vi.stubGlobal("scrollTo", (x, y) => {
          pos = 6 * Math.round(y / 6);
          window.scrollY = pos;
        });
        const el = { getBoundingClientRect: () => ({ top: 500 - pos }), getClientRects: () => [{}] };
        const before = Math.abs(200 - aim);
        new ScrollMemento({}).restoreAnchor({ offsetTop: aim }, el);
        const after = Math.abs(el.getBoundingClientRect().top - aim);
        expect(after).toBeLessThanOrEqual(3);
        expect(after).toBeLessThanOrEqual(before);
      }
    });
  });
});

describe("ScrollMemento.reveal (INV-52: the least scroll to an opened cell or editor)", () => {
  function fakeBox(getTop, height) {
    return {
      getBoundingClientRect: () => ({ top: getTop(), bottom: getTop() + height }),
      getClientRects: () => [{}],
    };
  }
  function container(scrollTop = 1000) {
    return { scrollTop, clientHeight: 500, getBoundingClientRect: () => ({ top: 0 }) };
  }

  it.each([
    ["in view: no scroll", 100, 30, 1000],
    ["below the bottom: its bottom comes to the bottom edge", 600, 30, 1130],
    ["above the top: its top comes to the top edge", -80, 30, 920],
    ["taller than the view and below: its top comes to the top edge", 300, 900, 1300],
  ])("AT-SM-36 the preview scrolls the least (%s)", (_n, top, height, expected) => {
    stubMatchMedia(false);
    const c = container();
    const memento = new ScrollMemento(c);
    const base = top + c.scrollTop;
    memento.reveal(fakeBox(() => base - c.scrollTop, height));
    expect(c.scrollTop).toBe(expected);
  });

  it("AT-SM-37 on touch devices the document scrolls at once (scrollTo, not smooth), below the top bar", () => {
    stubMatchMedia(true);
    vi.stubGlobal("scrollY", 400);
    vi.stubGlobal("innerHeight", 800);
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const memento = new ScrollMemento(container());
    memento.reveal(fakeBox(() => 900, 40));
    expect(scrollTo).toHaveBeenCalledWith(0, 540);
    scrollTo.mockClear();
    memento.reveal(fakeBox(() => 10, 40));
    expect(scrollTo).not.toHaveBeenCalled(); // no top bar here: 10 is in view
    const bar = document.createElement("div");
    bar.id = "topbar";
    bar.getBoundingClientRect = () => ({ top: 0, bottom: 50 });
    document.body.appendChild(bar);
    try {
      memento.reveal(fakeBox(() => 10, 40)); // under the bar: its top goes to the bar's bottom
      expect(scrollTo).toHaveBeenCalledWith(0, 360);
    } finally {
      bar.remove();
    }
  });

  it("AT-SM-38 no element, or one without a box: nothing", () => {
    stubMatchMedia(false);
    const c = container(50);
    const memento = new ScrollMemento(c);
    memento.reveal(null);
    memento.reveal({ getClientRects: () => [], getBoundingClientRect: () => ({ top: 9999, bottom: 10000 }) });
    expect(c.scrollTop).toBe(50);
  });
});
