import { describe, it, expect, vi } from "vitest";
import CodeEditHistory from "../js/classes/CodeEditHistory.js";

// NE-7, NE-18, NE-26: Undo / Redo of the code editor. The clock is injected.

function makeHistory(options = {}) {
  const clock = { t: 0 };
  const history = new CodeEditHistory({ now: () => clock.t, ...options });
  return { history, clock };
}

const state = (text, selStart, selEnd = selStart) => ({ text, selStart, selEnd });

describe("CodeEditHistory (INV-88; NE-7, NE-18, NE-26)", () => {
  it("AT-CEH-01 a fresh or reset history has nothing to undo or redo", () => {
    const { history } = makeHistory();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
    history.reset("abc", 1, 2);
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBeNull();
  });

  it("AT-CEH-02 typing without a pause of 1 s is one step; undo restores the text and selection before it", () => {
    const { history, clock } = makeHistory();
    history.reset("x", 1, 1);
    history.recordTyping("xa", 2, 2);
    clock.t = 600;
    history.recordTyping("xab", 3, 3);
    clock.t = 1500; // 900 ms after the last key
    history.recordTyping("xabc", 4, 4);
    expect(history.canUndo()).toBe(true);
    expect(history.undo()).toEqual(state("x", 1));
    expect(history.canUndo()).toBe(false);
  });

  it("AT-CEH-03 a pause of 1 s (pauseMs) since the last key starts a new step", () => {
    const { history, clock } = makeHistory();
    history.reset("", 0, 0);
    history.recordTyping("a", 1, 1);
    clock.t = 999;
    history.recordTyping("ab", 2, 2);
    clock.t = 1999; // exactly 1000 ms after the last key
    history.recordTyping("abc", 3, 3);
    expect(history.undo()).toEqual(state("ab", 2));
    expect(history.undo()).toEqual(state("", 0));
  });

  it("AT-CEH-04 moving the caret ends the typing step; the next step begins at the selection before its first input (M2)", () => {
    const { history } = makeHistory();
    history.reset("abc", 3, 3);
    history.recordTyping("abcd", 4, 4);
    history.noteCaretMove();
    history.recordTyping("Xabcd", 1, 1, [0, 0]); // the caret was moved to 0
    expect(history.undo()).toEqual(state("abcd", 0));
    expect(history.undo()).toEqual(state("abc", 3));
  });

  it("AT-CEH-05 each operation is its own step, also right after typing", () => {
    const { history } = makeHistory();
    history.reset("a b", 0, 0);
    history.recordTyping("a bc", 4, 4);
    history.recordOperation("A B C", 0, 5); // e.g. replace all
    history.recordOperation("  A B C", 0, 7); // e.g. indent
    expect(history.undo()).toEqual(state("A B C", 0, 5));
    expect(history.undo()).toEqual(state("a bc", 4));
    expect(history.undo()).toEqual(state("a b", 0));
    expect(history.undo()).toBeNull();
  });

  it("AT-CEH-06 redo walks forward again with the selection after each step", () => {
    const { history } = makeHistory();
    history.reset("one", 0, 0);
    history.recordOperation("one two", 7, 7);
    history.recordTyping("one two!", 8, 8);
    history.undo();
    history.undo();
    expect(history.canRedo()).toBe(true);
    expect(history.redo()).toEqual(state("one two", 7));
    expect(history.redo()).toEqual(state("one two!", 8));
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBeNull();
  });

  it("AT-CEH-07 a new record clears redo", () => {
    const { history } = makeHistory();
    history.reset("a", 1, 1);
    history.recordOperation("ab", 2, 2);
    history.undo();
    history.recordTyping("ac", 2, 2);
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBeNull();
    history.undo();
    history.recordOperation("z", 1, 1);
    expect(history.canRedo()).toBe(false);
  });

  it("AT-CEH-08 keeps at most limit steps; the oldest is dropped (typing steps count too)", () => {
    const { history } = makeHistory({ limit: 3 });
    history.reset("0", 1, 1);
    for (const t of ["1", "2", "3"]) history.recordOperation(t, 1, 1);
    history.noteCaretMove();
    history.recordTyping("4", 1, 1);
    const undone = [];
    let r;
    while ((r = history.undo())) undone.push(r.text);
    expect(undone).toEqual(["3", "2", "1"]);
  });

  it("AT-CEH-09 the default limit is 30", () => {
    const { history } = makeHistory();
    history.reset("", 0, 0);
    for (let i = 1; i <= 35; i++) history.recordOperation(String(i), 0, 0);
    let n = 0;
    let last = null;
    for (let r = history.undo(); r; r = history.undo()) {
      n++;
      last = r.text;
    }
    expect(n).toBe(30);
    expect(last).toBe("5");
  });

  it("AT-CEH-10 a record that does not change the text adds no step (known once settled)", () => {
    const { history } = makeHistory();
    history.reset("same", 0, 0);
    history.recordOperation("same", 1, 1);
    expect(history.canUndo()).toBe(false);
    history.recordTyping("same", 2, 2);
    history.settle();
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBeNull();
  });

  it("AT-CEH-13 L17: typed and deleted back to the text before: Undo is off once settled (the pause), and undoes nothing", () => {
    const { history } = makeHistory();
    history.reset("same", 4, 4);
    history.recordTyping("sameX", 5, 5);
    history.recordTyping("same", 4, 4);
    expect(history.canUndo()).toBe(true); // not compared on a key
    history.settle();
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBeNull();
    // a step closed by a caret move that changed nothing is dropped as well
    history.recordTyping("sameY", 5, 5);
    history.recordTyping("same", 4, 4);
    history.noteCaretMove();
    expect(history.canUndo()).toBe(true);
    history.settle();
    expect(history.canUndo()).toBe(false);
  });

  it("AT-CEH-14 M2: Undo of typing puts back the selection just before its first input, also after an operation and a reset", () => {
    const { history } = makeHistory();
    history.reset("hello world", 0, 0);
    history.noteSelection(6, 6); // the caret placed (start), or a selection made
    history.recordTyping("hello Xworld", 7, 7);
    expect(history.undo()).toEqual(state("hello world", 6));
    history.recordTyping("hello Yworld", 7, 7, [6, 11]); // typed over a selection
    history.recordTyping("hello YZworld", 8, 8, [7, 7]); // the same step: its before is not used
    expect(history.undo()).toEqual(state("hello world", 6, 11));
    history.recordOperation("HELLO world", 0, 5, [0, 5]);
    expect(history.undo()).toEqual(state("hello world", 0, 5));
  });

  it("AT-CEH-15 M1: a key costs no work on the whole text: no character is compared until settle() (count-based, G10)", () => {
    const { history, clock } = makeHistory();
    const big = "x".repeat(5 * 1024 * 1024);
    history.reset(big, 0, 0);
    const spy = vi.spyOn(String.prototype, "charCodeAt");
    let text = big;
    for (let i = 0; i < 20; i++) {
      text += "a";
      clock.t += 10;
      history.recordTyping(text, text.length, text.length);
    }
    history.noteCaretMove(); // the step closes, still not compared
    history.recordTyping(text + "b", text.length + 1, text.length + 1);
    expect(history.canUndo()).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    history.settle(); // the pause: now the changed parts
    expect(history._undo[0].change).toEqual({ at: big.length, removed: "", inserted: "a".repeat(20) });
    expect(history.undo().text).toBe(text);
    expect(history.undo().text).toBe(big);
  });

  it("AT-CEH-11 changes in the middle of a long text are undone and redone exactly (stored as changed parts)", () => {
    const { history } = makeHistory();
    const base = "head\n" + "x".repeat(10000) + "\ntail";
    history.reset(base, 0, 0);
    const edited = base.slice(0, 2000) + "INSERTED" + base.slice(2500);
    history.recordOperation(edited, 2000, 2008);
    const again = edited.replace("head", "HEAD") + "!";
    history.recordOperation(again, 0, 4);
    expect(history.undo()).toEqual(state(edited, 2000, 2008));
    expect(history.undo()).toEqual(state(base, 0));
    expect(history.redo().text).toBe(edited);
    expect(history.redo().text).toBe(again);
    const step = history._undo[0].change;
    expect(step).toEqual({ at: 2000, removed: "x".repeat(500), inserted: "INSERTED" });
  });

  it("AT-CEH-12 the default pause is 1000 ms; the clock is given by the caller (L21: no clock of its own)", () => {
    expect(() => new CodeEditHistory()).toThrow(TypeError);
    expect(() => new CodeEditHistory({})).toThrow(TypeError);
    const fixed = makeHistory();
    fixed.history.reset("", 0, 0);
    fixed.history.recordTyping("a", 1, 1);
    fixed.clock.t = 999;
    fixed.history.recordTyping("ab", 2, 2);
    expect(fixed.history.undo()).toEqual(state("", 0));
    const { history: h2, clock } = makeHistory({ pauseMs: 200 });
    h2.reset("", 0, 0);
    h2.recordTyping("a", 1, 1);
    clock.t = 200;
    h2.recordTyping("ab", 2, 2);
    expect(h2.undo()).toEqual(state("a", 1));
  });
});
