import { describe, it, expect } from "vitest";
import BlockDiff from "../js/classes/BlockDiff.js";

// Heavy tests (about 1 s alone, 2 s or more when the machine is busy) get an
// explicit timeout so CPU load cannot fail them; the global 5 s default stays.
const HEAVY_TEST_TIMEOUT_MS = 30000;

const blocks = (list) => list.map((raw, i) => ({ id: i + 1, type: "paragraph", raw, separatorAfter: "\n\n" }));
const diff = (a, b, max = 250000) => BlockDiff.diffBlocks(blocks(a), blocks(b), max);
const pairs = (m) => m.map((x) => [x.oldIndex, x.newIndex]);

// Reference LCS length (test-only, naive DP).
function lcsLength(a, b) {
  const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      t[i][j] = a[i - 1] === b[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1]);
  return t[a.length][b.length];
}

function expectValidMatching(a, b, m) {
  for (const { oldIndex, newIndex } of m) expect(a[oldIndex]).toBe(b[newIndex]);
  for (let k = 1; k < m.length; k++) {
    expect(m[k].oldIndex).toBeGreaterThan(m[k - 1].oldIndex);
    expect(m[k].newIndex).toBeGreaterThan(m[k - 1].newIndex);
  }
}

describe("BlockDiff.diffBlocks (pure)", () => {
  it("AT-DIFF-01 identical lists match index by index", () => {
    expect(pairs(diff(["a", "b", "c"], ["a", "b", "c"]))).toEqual([[0, 0], [1, 1], [2, 2]]);
  });

  it("AT-DIFF-02 one changed block in the middle: everything else matches", () => {
    expect(pairs(diff(["a", "b", "c", "d"], ["a", "b", "X", "d"]))).toEqual([[0, 0], [1, 1], [3, 3]]);
  });

  it.each([
    ["insert", ["a", "b", "c"], ["a", "N", "b", "c"], [[0, 0], [1, 2], [2, 3]]],
    ["delete", ["a", "b", "c"], ["a", "c"], [[0, 0], [2, 1]]],
    ["first changed", ["a", "b", "c"], ["X", "b", "c"], [[1, 1], [2, 2]]],
    ["last changed", ["a", "b", "c"], ["a", "b", "X"], [[0, 0], [1, 1]]],
  ])("AT-DIFF-03 %s", (_n, a, b, expected) => {
    expect(pairs(diff(a, b))).toEqual(expected);
  });

  it("AT-DIFF-04 repeated texts: monotonic matching with the same size as a naive LCS (all lists up to length 6)", () => {
    const alphabet = ["x", "y"];
    const lists = [[]];
    for (let len = 1; len <= 6; len++) {
      const prev = lists.filter((l) => l.length === len - 1);
      for (const p of prev) for (const ch of alphabet) lists.push([...p, ch]);
    }
    for (const a of lists) {
      for (const b of lists) {
        const m = diff(a, b);
        expectValidMatching(a, b, m);
        expect(m.length).toBe(lcsLength(a, b));
      }
    }
  }, HEAVY_TEST_TIMEOUT_MS);

  it("AT-DIFF-05 the middle range uses LCS at exactly maxCells and is skipped at maxCells + 1", () => {
    // Middle range after trimming: old [p, q, r] vs new [r, s] -> 3 x 2 = 6 cells.
    const a = ["a", "p", "q", "r", "z"];
    const b = ["a", "r", "s", "z"];
    expect(pairs(diff(a, b, 6))).toEqual([[0, 0], [3, 1], [4, 3]]);
    expect(pairs(diff(a, b, 5))).toEqual([[0, 0], [4, 3]]);
  });

  it("AT-DIFF-06 maxCells = 0: the middle range never matches", () => {
    expect(pairs(diff(["a", "b", "c", "z"], ["a", "c", "b", "z"], 0))).toEqual([[0, 0], [3, 3]]);
  });

  it("AT-DIFF-07 empty lists", () => {
    expect(diff([], ["a"])).toEqual([]);
    expect(diff(["a"], [])).toEqual([]);
    expect(diff([], [])).toEqual([]);
  });

  it("AT-DIFF-08 a 9,000 x 9,000 full replacement takes the limit branch: no middle matches", () => {
    const a = Array.from({ length: 9000 }, (_, i) => `old ${i}`);
    const b = Array.from({ length: 9000 }, (_, i) => (i % 2 ? `old ${i}` : `new ${i}`));
    b[0] = "head";
    b[8999] = "tail";
    expect(diff(a, b, 250000)).toEqual([]);
  }, HEAVY_TEST_TIMEOUT_MS);

  it("AT-DIFF-09 output indexes are ascending", () => {
    const m = diff(["a", "b", "c", "d", "e"], ["a", "x", "c", "y", "e"]);
    expectValidMatching(["a", "b", "c", "d", "e"], ["a", "x", "c", "y", "e"], m);
  });

  it("AT-DIFF-10 compares raw only: a different separatorAfter still matches (Q10)", () => {
    const a = [{ id: 1, type: "paragraph", raw: "a", separatorAfter: "\n\n" }];
    const b = [{ id: 9, type: "paragraph", raw: "a", separatorAfter: "\n\n\n\n" }];
    expect(pairs(BlockDiff.diffBlocks(a, b, 10))).toEqual([[0, 0]]);
  });
});
