import { describe, it, expect } from "vitest";
import { placementNearLine } from "../js/floatingPlacement.js";

// INV-74 (2), owner ruling D10, ruling U4: the bar of a block range under
// the selection's last line, else above it, always inside the viewport
// (AT-RNG-51). A pure function: no layout is needed.

const VIEW = { width: 800, height: 600 };
const SIZE = { width: 100, height: 36 };
const GAP = 6;
const MARGIN = 8;

describe("AT-RNG-51 placementNearLine (pure)", () => {
  it("under the line when there is room, centred on where the line ends", () => {
    expect(placementNearLine({ x: 300, top: 100, bottom: 120 }, SIZE, VIEW, GAP, MARGIN)).toEqual({ left: 250, top: 126 });
  });

  it("above the line when there is no room under it", () => {
    expect(placementNearLine({ x: 300, top: 560, bottom: 580 }, SIZE, VIEW, GAP, MARGIN)).toEqual({ left: 250, top: 518 });
  });

  it("a line out of view below or above: the bar stays inside the viewport", () => {
    expect(placementNearLine({ x: 300, top: 2000, bottom: 2020 }, SIZE, VIEW, GAP, MARGIN).top).toBe(600 - 36 - MARGIN);
    expect(placementNearLine({ x: 300, top: -500, bottom: -480 }, SIZE, VIEW, GAP, MARGIN).top).toBe(MARGIN);
  });

  it("no room above or below (a short viewport): at the top margin", () => {
    expect(placementNearLine({ x: 300, top: 10, bottom: 30 }, SIZE, { width: 800, height: 40 }, GAP, MARGIN).top).toBe(MARGIN);
  });

  it("near the left and the right edges: inside by the margin", () => {
    expect(placementNearLine({ x: 5, top: 100, bottom: 120 }, SIZE, VIEW, GAP, MARGIN).left).toBe(MARGIN);
    expect(placementNearLine({ x: 795, top: 100, bottom: 120 }, SIZE, VIEW, GAP, MARGIN).left).toBe(800 - 100 - MARGIN);
  });
});
