import { describe, it, expect, vi, afterEach } from "vitest";
import BlockGapInsert from "../js/classes/BlockGapInsert.js";
import { CONFIG } from "../js/config.js";

// INV-73 (owner ruling B1): the gaps between the top-level blocks in edit
// mode. jsdom has no layout, so the rectangles are given to each element.

const HIT = CONFIG.edit.gapHitPx;

function rect(el, top, bottom, left = 0, right = 600) {
  el.getBoundingClientRect = () => ({ top, bottom, left, right, height: bottom - top, width: right - left, x: left, y: top });
}

/** A preview (0..600 x 0..400) with blocks at the given [top, bottom] spans; ids 1, 2, ... */
function setup(spans) {
  const preview = document.createElement("div");
  document.body.appendChild(preview);
  rect(preview, 0, 400);
  const ids = new Map();
  const wrappers = spans.map(([top, bottom], i) => {
    const el = document.createElement("div");
    el.className = "md-block";
    rect(el, top, bottom);
    preview.appendChild(el);
    ids.set(el, i + 1);
    return el;
  });
  const tabs = new Set();
  const locator = {
    getBlockElements: () => [...preview.children].filter((el) => ids.has(el)),
    findBlockIdAt: (el) => ids.get(el) ?? null,
    isTableTab: (el) => tabs.has(el),
  };
  const host = { onGapChosen: vi.fn(), isSuppressed: () => false };
  const frames = [];
  const gaps = new BlockGapInsert(preview, locator, host, { requestFrame: (fn) => frames.push(fn) });
  gaps.enable();
  /** Run the frames asked for so far (the mouse is followed once per frame). */
  const frame = () => frames.splice(0).forEach((fn) => fn());
  return { preview, wrappers, gaps, host, tabs, frame };
}

let t;
afterEach(() => {
  t?.gaps.disable();
  t?.preview.remove();
  document.querySelectorAll(".grsmd-gap-insert").forEach((el) => el.remove());
  t = null;
});

const ids = (gap) => (gap ? [gap.afterBlockId, gap.beforeBlockId] : null);

describe("AT-GAP-01 where a gap is (INV-73)", () => {
  it("between two blocks: in the space between them and within the hit distance of its middle", () => {
    t = setup([[20, 60], [80, 120], [140, 180]]);
    expect(ids(t.gaps.gapAt(100, 70))).toEqual([1, 2]);
    expect(t.gaps.gapAt(100, 70).line).toBe(70);
    expect(ids(t.gaps.gapAt(100, 61))).toEqual([1, 2]);
    expect(ids(t.gaps.gapAt(100, 130))).toEqual([2, 3]);
  });

  it("a wide gap is the gap itself; a narrow one reaches the hit distance from its middle, into a block half of it and a quarter of its height at most (L4)", () => {
    t = setup([[20, 60], [80, 120], [122, 160], [162, 170]]);
    // 20px: the gap itself
    expect(ids(t.gaps.gapAt(100, 60))).toEqual([1, 2]);
    expect(ids(t.gaps.gapAt(100, 80))).toEqual([1, 2]);
    expect(t.gaps.gapAt(100, 59)).toBeNull(); // inside block 1: it opens there
    expect(t.gaps.gapAt(100, 81)).toBeNull();
    // 2px (line 121): HIT up and down, but into a block HIT / 2 at most
    expect(ids(t.gaps.gapAt(100, 120 - HIT / 2))).toEqual([2, 3]);
    expect(t.gaps.gapAt(100, 120 - HIT / 2 - 1)).toBeNull();
    expect(ids(t.gaps.gapAt(100, 122 + HIT / 2))).toEqual([2, 3]);
    expect(t.gaps.gapAt(100, 122 + HIT / 2 + 1)).toBeNull();
    // block 4 is 8px tall: only 2px of it is a gap from each side
    expect(ids(t.gaps.gapAt(100, 164))).toEqual([3, 4]);
    expect(t.gaps.gapAt(100, 166)).toBeNull();
  });

  it("stops short of a table's tab in the gap above the table; the tab stays the tab's", () => {
    t = setup([[20, 60], [80, 120]]);
    const tab = document.createElement("span");
    t.wrappers[1].appendChild(tab);
    t.tabs.add(tab);
    rect(tab, 64, 80, 540, 600);
    const gap = t.gaps.gapAt(100, 70);
    expect(ids(gap)).toEqual([1, 2]);
    expect(gap.left + gap.width).toBe(540 - 8);
    expect(t.gaps.gapAt(560, 70)).toBeNull();
    expect(t.gaps.gapAt(535, 70)).toBeNull(); // within the margin before it
  });

  it("not over a link, a button or another control of the preview, nor under something over the preview (M1: the top bar)", () => {
    t = setup([[20, 60], [80, 120]]);
    const link = document.createElement("a");
    t.wrappers[1].appendChild(link);
    const button = document.createElement("button");
    t.wrappers[1].appendChild(button);
    let under = [t.wrappers[0]];
    document.elementsFromPoint = () => under;
    try {
      expect(ids(t.gaps.gapAt(100, 70))).toEqual([1, 2]);
      under = [link, t.wrappers[1], t.preview];
      expect(t.gaps.gapAt(100, 70)).toBeNull();
      t.gaps.show({ top: 60, bottom: 80, line: 70, left: 0, width: 600 });
      under = [document.querySelector(".grsmd-gap-insert"), button, t.preview];
      expect(t.gaps.gapAt(100, 70)).toBeNull(); // the line itself is looked through
      under = [t.preview, document.body];
      expect(ids(t.gaps.gapAt(100, 70))).toEqual([1, 2]);
      const bar = document.createElement("div"); // a sticky top bar over the preview
      document.body.appendChild(bar);
      under = [bar, t.wrappers[0], t.preview];
      expect(t.gaps.gapAt(100, 70)).toBeNull();
      under = [document.querySelector(".grsmd-gap-insert"), bar, t.preview];
      expect(t.gaps.gapAt(100, 70)).toBeNull();
      bar.remove();
    } finally {
      delete document.elementsFromPoint;
    }
  });

  it("before the first block and after the last one", () => {
    t = setup([[30, 60], [80, 120]]);
    expect(ids(t.gaps.gapAt(100, 25))).toEqual([null, 1]);
    expect(ids(t.gaps.gapAt(100, 125))).toEqual([2, null]);
    expect(t.gaps.gapAt(100, 200)).toBeNull(); // far below the last block
  });

  it("nothing outside the preview's content box, without blocks, or while disabled", () => {
    t = setup([[20, 60], [80, 120]]);
    expect(t.gaps.gapAt(700, 70)).toBeNull();
    expect(t.gaps.gapAt(100, 500)).toBeNull();
    t.gaps.disable();
    expect(t.gaps.gapAt(100, 70)).toBeNull();
    t.preview.remove();
    t = setup([]);
    expect(t.gaps.gapAt(100, 10)).toBeNull();
  });

  it("does not reach into an open editor", () => {
    t = setup([[20, 60], [80, 120]]);
    t.wrappers[1].classList.add("md-block-editing");
    expect(ids(t.gaps.gapAt(100, 79))).toEqual([1, 2]);
    expect(t.gaps.gapAt(100, 82)).toBeNull();
  });

  it("an open gap editor: the gaps next to it are not offered, others are", () => {
    t = setup([[20, 60], [140, 180], [200, 240]]);
    const editor = document.createElement("div");
    editor.className = "md-block md-block-gap";
    rect(editor, 70, 130);
    t.preview.insertBefore(editor, t.wrappers[1]);
    expect(t.gaps.gapAt(100, 65)).toBeNull();
    expect(t.gaps.gapAt(100, 135)).toBeNull();
    expect(ids(t.gaps.gapAt(100, 190))).toEqual([2, 3]);
  });
});

describe("AT-GAP-02 the line", () => {
  it("shows on the gap, and a click on it asks for that gap, then hides", () => {
    t = setup([[20, 60], [80, 120]]);
    const gap = t.gaps.gapAt(100, 70);
    t.gaps.show(gap);
    const line = document.querySelector(".grsmd-gap-insert");
    expect(line.hidden).toBe(false);
    expect(line.title).toBe(CONFIG.messages.edit.gapInsert);
    expect(line.querySelector(".grsmd-gap-insert-plus").textContent).toBe("+");
    expect(line.style.top).toBe(`${gap.top}px`);
    expect(t.gaps.isLineNode(line.firstChild)).toBe(true);
    line.click(); // no press on it (the click of the touch tap that showed it): nothing
    expect(t.host.onGapChosen).not.toHaveBeenCalled();
    expect(line.hidden).toBe(false);
    line.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    line.click();
    expect(t.host.onGapChosen).toHaveBeenCalledWith({ kind: "gap", afterBlockId: 1, beforeBlockId: 2 });
    expect(line.hidden).toBe(true);
    expect(t.gaps.shownGap()).toBeNull();
  });

  const move = (target, x, y, init = {}) =>
    target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerType: "mouse", ...init }));

  it("the mouse shows it over a gap and hides it elsewhere; a touch move or a held button changes nothing", () => {
    t = setup([[20, 60], [80, 120]]);
    move(t.wrappers[0], 100, 70);
    t.frame();
    expect(ids(t.gaps.shownGap())).toEqual([1, 2]);
    move(t.wrappers[0], 100, 40, { buttons: 1 }); // a press being held: kept
    t.frame();
    expect(ids(t.gaps.shownGap())).toEqual([1, 2]);
    move(t.wrappers[0], 100, 40);
    t.frame();
    expect(t.gaps.shownGap()).toBeNull();
    move(t.wrappers[0], 100, 70, { pointerType: "touch" });
    t.frame();
    expect(t.gaps.shownGap()).toBeNull();
    move(document.body, 100, 70); // not over the preview (e.g. the palette)
    t.frame();
    expect(t.gaps.shownGap()).toBeNull();
  });

  it("M3: the moves of one frame are worked out once, for the last one", () => {
    t = setup([[20, 60], [80, 120]]);
    const gapAt = vi.spyOn(t.gaps, "gapAt");
    move(t.wrappers[0], 100, 40);
    move(t.wrappers[0], 100, 50);
    move(t.wrappers[0], 100, 70);
    expect(gapAt).not.toHaveBeenCalled();
    t.frame();
    expect(gapAt).toHaveBeenCalledTimes(1);
    expect(gapAt).toHaveBeenCalledWith(100, 70);
    expect(ids(t.gaps.shownGap())).toEqual([1, 2]);
    move(t.wrappers[0], 100, 70);
    t.gaps.disable(); // a frame after edit mode ended does nothing
    t.frame();
    expect(gapAt).toHaveBeenCalledTimes(1);
  });

  it("N2: a press on the line drops the move not followed yet, so its click inserts", () => {
    t = setup([[20, 60], [80, 120]]);
    move(t.wrappers[0], 100, 70);
    t.frame();
    const line = document.querySelector(".grsmd-gap-insert");
    move(t.wrappers[0], 100, 40); // off the gap, its frame not run yet
    line.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    t.frame();
    expect(line.hidden).toBe(false);
    expect(ids(t.gaps.shownGap())).toEqual([1, 2]);
    line.click();
    expect(t.host.onGapChosen).toHaveBeenCalledWith({ kind: "gap", afterBlockId: 1, beforeBlockId: 2 });
  });

  it("N3: after a press on the line that is no click (right button, or moved off and let go), the line follows the mouse again", () => {
    t = setup([[20, 60], [80, 120], [140, 180]]);
    move(t.wrappers[0], 100, 70);
    t.frame();
    const line = document.querySelector(".grsmd-gap-insert");
    line.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 2, buttons: 2 }));
    move(t.wrappers[1], 100, 130);
    t.frame();
    expect(ids(t.gaps.shownGap())).toEqual([2, 3]);
    line.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, buttons: 1 }));
    move(t.wrappers[1], 100, 100, { buttons: 1 }); // dragged off with the button held: kept
    t.frame();
    expect(ids(t.gaps.shownGap())).toEqual([2, 3]);
    t.wrappers[1].dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
    move(t.wrappers[0], 100, 70);
    t.frame();
    expect(ids(t.gaps.shownGap())).toEqual([1, 2]);
  });

  it("N2: hide() drops the move not followed yet, so a scroll is not undone by its frame", () => {
    t = setup([[20, 60], [80, 120]]);
    move(t.wrappers[0], 100, 70);
    t.preview.dispatchEvent(new Event("scroll"));
    t.frame();
    expect(t.gaps.shownGap()).toBeNull();
  });

  it("a scroll hides it; disable() removes the listeners", () => {
    t = setup([[20, 60], [80, 120]]);
    t.gaps.show(t.gaps.gapAt(100, 70));
    t.preview.dispatchEvent(new Event("scroll"));
    expect(t.gaps.shownGap()).toBeNull();
    t.gaps.disable();
    move(t.wrappers[0], 100, 70);
    t.frame();
    expect(t.gaps.shownGap()).toBeNull();
  });
});

describe("AT-RNG-39 no gap while blocks are selected (INV-74 (2))", () => {
  it("gapAt is null while host.isSuppressed() is true, and back after", () => {
    t = setup([[20, 60], [80, 120]]);
    let selected = true;
    t.host.isSuppressed = () => selected;
    expect(t.gaps.gapAt(100, 70)).toBeNull();
    selected = false;
    expect(ids(t.gaps.gapAt(100, 70))).toEqual([1, 2]);
  });
});
