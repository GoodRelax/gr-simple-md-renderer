import { describe, it, expect } from "vitest";
import { cell, row, choice, selectCell } from "../js/stateTable.js";

// Helpers of the transition tables (spec 11-b): guards are tried in order.

describe("stateTable", () => {
  it("cell and row build frozen values; a missing cell is null", () => {
    const c = cell("b", ["x"], "isReady");
    expect(c).toEqual({ to: "b", actions: ["x"], guard: "isReady" });
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.actions)).toBe(true);
    expect(cell("b", [])).not.toHaveProperty("guard");
    const r = row(["s1", "s2", "s3"], [c]);
    expect(r).toEqual({ s1: c, s2: null, s3: null });
    expect(Object.isFrozen(r)).toBe(true);
  });

  it("choice keeps the order and is frozen", () => {
    const a = cell("x", [], "isA");
    const b = cell("y", []);
    const ch = choice(a, b);
    expect(ch).toEqual([a, b]);
    expect(Object.isFrozen(ch)).toBe(true);
  });

  it("selectCell: null entry -> null; an unguarded cell always matches; a guarded single cell needs its guard", () => {
    const yes = () => true;
    const no = () => false;
    expect(selectCell(null, yes)).toBeNull();
    const plain = cell("x", []);
    expect(selectCell(plain, no)).toBe(plain);
    const guarded = cell("x", [], "isA");
    expect(selectCell(guarded, yes)).toBe(guarded);
    expect(selectCell(guarded, no)).toBeNull();
  });

  it("selectCell: the first true guard wins, in order; else is the last; without else no match is null", () => {
    const a = cell("a", [], "isA");
    const b = cell("b", [], "isB");
    const otherwise = cell("c", []);
    const seen = [];
    const only = (name) => (g) => {
      seen.push(g);
      return g === name;
    };
    expect(selectCell(choice(a, b, otherwise), only("isB"))).toBe(b);
    expect(seen).toEqual(["isA", "isB"]);
    expect(selectCell(choice(a, b, otherwise), () => true)).toBe(a);
    expect(selectCell(choice(a, b, otherwise), () => false)).toBe(otherwise);
    expect(selectCell(choice(a, b), () => false)).toBeNull();
  });
});
