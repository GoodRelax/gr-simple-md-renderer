import { describe, it, expect } from "vitest";
import { foldJsonOnce, unfoldJsonOnce } from "../js/jsonFold.js";

// NE-10, NE-21, NE-22: JSON fold puts a { } / [ ] spread over lines on one
// line; unfold spreads one level out again.

// Timing (AT-JFO-13) only with GRSMD_PERF=1 (test spec AT.1; review L7): a
// loaded machine must not fail it. The result is checked always.
const PERF = process.env.GRSMD_PERF === "1";

const OWNER_BEFORE = [
  "{",
  '  "x": {',
  '    "aaa":"111",',
  '    "bbb":"222"',
  "  },",
  '  "y": {',
  '    "ccc":"333"',
  "  }",
  "}",
].join("\n");

const OWNER_AFTER = ["{", '  "x": { "aaa":"111", "bbb":"222" },', '  "y": { "ccc":"333" }', "}"].join("\n");

describe("jsonFold (INV-92; NE-10, NE-22)", () => {
  it("AT-JFO-01 the owner's example: one fold puts each depth-1 object on one line", () => {
    expect(foldJsonOnce(OWNER_BEFORE)).toEqual({ text: OWNER_AFTER, changed: true });
  });

  it("AT-JFO-02 unfolding the owner's example gives the text before the fold exactly", () => {
    expect(unfoldJsonOnce(OWNER_AFTER, "  ")).toEqual({ text: OWNER_BEFORE, changed: true });
  });

  it("AT-JFO-03 deeper nesting folds the deepest first, one level per call", () => {
    const text = ["{", '  "a": {', '    "b": [', "      1,", "      2", "    ],", '    "c": 3', "  }", "}"].join("\n");
    const once = foldJsonOnce(text);
    expect(once).toEqual({ text: ["{", '  "a": {', '    "b": [ 1, 2 ],', '    "c": 3', "  }", "}"].join("\n"), changed: true });
    const twice = foldJsonOnce(once.text);
    expect(twice).toEqual({ text: ["{", '  "a": { "b": [ 1, 2 ], "c": 3 }', "}"].join("\n"), changed: true });
  });

  it("AT-JFO-04 the root is never folded: nothing left gives changed false and the same text", () => {
    expect(foldJsonOnce(OWNER_AFTER)).toEqual({ text: OWNER_AFTER, changed: false });
    expect(foldJsonOnce('{\n  "a": 1\n}')).toEqual({ text: '{\n  "a": 1\n}', changed: false });
    expect(foldJsonOnce("42")).toEqual({ text: "42", changed: false });
  });

  it("AT-JFO-05 invalid JSON gives an error for both commands", () => {
    expect(foldJsonOnce('{\n  "a": [\n 1,\n ]\n}')).toEqual({ error: "invalid" });
    expect(unfoldJsonOnce("{a: 1}", "  ")).toEqual({ error: "invalid" });
    expect(foldJsonOnce("")).toEqual({ error: "invalid" });
  });

  it("AT-JFO-06 brackets and commas inside strings are not split or counted", () => {
    const text = ["{", '  "s": [', '    "a,]b",', '    "c\\"{d"', "  ]", "}"].join("\n");
    const folded = foldJsonOnce(text);
    expect(folded).toEqual({ text: ["{", '  "s": [ "a,]b", "c\\"{d" ]', "}"].join("\n"), changed: true });
    expect(unfoldJsonOnce(folded.text, "  ")).toEqual({ text, changed: true });
  });

  it("AT-JFO-07 minified JSON unfolds from the root, one level per call", () => {
    const one = unfoldJsonOnce('{"a":[1,2],"b":{"c":"x"}}', "  ");
    expect(one).toEqual({ text: '{\n  "a":[1,2],\n  "b":{"c":"x"}\n}', changed: true });
    const two = unfoldJsonOnce(one.text, "  ");
    expect(two).toEqual({ text: '{\n  "a":[\n    1,\n    2\n  ],\n  "b":{\n    "c":"x"\n  }\n}', changed: true });
  });

  it("AT-JFO-08 empty {} and [] are never unfolded; nothing to unfold gives changed false", () => {
    expect(unfoldJsonOnce('{\n  "a": {},\n  "b": [ ]\n}', "  ")).toEqual({ text: '{\n  "a": {},\n  "b": [ ]\n}', changed: false });
    expect(unfoldJsonOnce("[]", "\t")).toEqual({ text: "[]", changed: false });
  });

  it("AT-JFO-09 the unfold indent is the pair's line indent plus the unit; what follows the close bracket stays", () => {
    const text = '[\n\t{"a": 1, "b": [2]}, 3\n]';
    expect(unfoldJsonOnce(text, "\t")).toEqual({ text: '[\n\t{\n\t\t"a": 1,\n\t\t"b": [2]\n\t}, 3\n]', changed: true });
  });

  it("AT-JFO-10 two pairs of the same depth on one line are both unfolded in one call", () => {
    const text = '{\n  "p": [1], "q": {"r": 2}\n}';
    expect(unfoldJsonOnce(text, "  ")).toEqual({ text: '{\n  "p": [\n    1\n  ], "q": {\n    "r": 2\n  }\n}', changed: true });
  });

  it("AT-JFO-11 fold drops empty lines and trailing blanks inside a pair; text after the close bracket stays", () => {
    const text = '[\n  {\n\n    "a": 1   \n  }  , 2\n]';
    expect(foldJsonOnce(text)).toEqual({ text: '[\n  { "a": 1 }  , 2\n]', changed: true });
  });

  it("AT-JFO-12 fold joins pairs that share a line (close of one, open of the next)", () => {
    const text = '[\n  {\n    "a": 1\n  }, {\n    "b": 2\n  }\n]';
    expect(foldJsonOnce(text)).toEqual({ text: '[\n  { "a": 1 }, { "b": 2 }\n]', changed: true });
  });

  it("AT-JFO-14 (INV-92, NE-22, G8) fold changes only the folded pairs: blanks at the end of other lines stay", () => {
    const text = '{\n  "a": {\n    "x": 1,\n    "y": 2\n  },   \n  "b": 3   \n}\n';
    expect(foldJsonOnce(text)).toEqual({ text: '{\n  "a": { "x": 1, "y": 2 },   \n  "b": 3   \n}\n', changed: true });
    // blanks after the open bracket are inside the pair; text before it stays
    const open = '{  \n  "k" :  {   \n    "v": 1\n  } \t\n}';
    expect(foldJsonOnce(open)).toEqual({ text: '{  \n  "k" :  { "v": 1 } \t\n}', changed: true });
  });

  it("AT-JFO-15 (INV-92, NE-22) fold joins the members with \", \" wherever the commas were written", () => {
    // commas at the line start, on a line of their own, after blanks
    const commaFirst = '{\n  "a": {\n      "x": 1\n    , "y": 2\n    ,\n    "z" :  3 ,\n    "w": [1,2]\n  }\n}';
    expect(foldJsonOnce(commaFirst)).toEqual({ text: '{\n  "a": { "x": 1, "y": 2, "z" :  3, "w": [1,2] }\n}', changed: true });
    // a member over lines: its lines are trimmed and joined with one space
    expect(foldJsonOnce('[\n  {\n    "k":\n\n      [1, 2]\n  }\n]')).toEqual({ text: '[\n  { "k": [1, 2] }\n]', changed: true });
    // a pair with no member over lines
    expect(foldJsonOnce('{\n  "e": [\n\n  ]\n}')).toEqual({ text: '{\n  "e": [ ]\n}', changed: true });
  });

  it("AT-JFO-13 (INV-92) a 1 MB JSON folds twice and unfolds back to the same text (within 5,000 ms with GRSMD_PERF=1)", () => {
    const item = (i) => `  {\n    "id": ${i},\n    "name": "item ${i}",\n    "tags": [\n      "a",\n      "b"\n    ]\n  }`;
    const items = [];
    for (let i = 0; i < 12000; i++) items.push(item(i));
    const text = "[\n" + items.join(",\n") + "\n]";
    expect(text.length).toBeGreaterThan(1000000);
    const t0 = performance.now();
    const f1 = foldJsonOnce(text);
    const f2 = foldJsonOnce(f1.text);
    const u1 = unfoldJsonOnce(f2.text, "  ");
    const u2 = unfoldJsonOnce(u1.text, "  ");
    if (PERF) expect(performance.now() - t0).toBeLessThan(5000);
    expect(f2.text.split("\n")).toHaveLength(12002);
    expect(u2.text).toBe(text);
  });
});
