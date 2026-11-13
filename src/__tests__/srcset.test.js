import { describe, it, expect } from "vitest";
import { srcsetCandidates } from "../js/srcset.js";

describe("AT-SRCSET srcsetCandidates (INV-19, INV-110 (4))", () => {
  // Spec: INV-110 (4).
  it("AT-SRCSET-01 a comma inside a URL stays in it", () => {
    expect(srcsetCandidates("https://h/a,b.png 1x")).toEqual([{ url: "https://h/a,b.png", descriptors: "1x" }]);
  });

  // Spec: INV-110 (4).
  it("AT-SRCSET-02 candidates end at a comma after the descriptors, or at commas at the end of the URL", () => {
    expect(srcsetCandidates("https://h/a.png 1x,https://h/b.png 2x")).toEqual([
      { url: "https://h/a.png", descriptors: "1x" },
      { url: "https://h/b.png", descriptors: "2x" },
    ]);
    expect(srcsetCandidates("https://h/c.png,, https://h/d.png 3x")).toEqual([
      { url: "https://h/c.png", descriptors: "" },
      { url: "https://h/d.png", descriptors: "3x" },
    ]);
  });

  // Spec: INV-110 (4).
  it("AT-SRCSET-03 a data: URL with commas is one URL; a comma inside parentheses stays in the descriptors", () => {
    expect(srcsetCandidates("data:image/png;base64,AAA= 1x, https://h/b.png 2x")).toEqual([
      { url: "data:image/png;base64,AAA=", descriptors: "1x" },
      { url: "https://h/b.png", descriptors: "2x" },
    ]);
    expect(srcsetCandidates("https://h/a.png future(1, 2), https://h/b.png 2x")).toEqual([
      { url: "https://h/a.png", descriptors: "future(1, 2)" },
      { url: "https://h/b.png", descriptors: "2x" },
    ]);
  });

  // Spec: INV-19, INV-110 (4).
  it("AT-SRCSET-05 the first \")\" closes the parentheses, so a comma after it ends the candidate", () => {
    const evil = { url: "https://evil.example/b.png", descriptors: "1x" };
    expect(srcsetCandidates(", data:image/png;base64,AAAA ((), https://evil.example/b.png 1x")).toEqual([
      { url: "data:image/png;base64,AAAA", descriptors: "(()" },
      evil,
    ]);
    expect(srcsetCandidates(", blob:https://goodrelax.github.io/0f1e ((), https://evil.example/b.png 1x")).toEqual([
      { url: "blob:https://goodrelax.github.io/0f1e", descriptors: "(()" },
      evil,
    ]);
  });

  // Spec: INV-19, INV-110 (4).
  it("AT-SRCSET-06 only ASCII whitespace splits: U+00A0 stays in the URL, and commas at its end end the candidate", () => {
    expect(srcsetCandidates(", data:image/png;base64,AAAA\u00a0(, https://evil.example/b.png 1x")).toEqual([
      { url: "data:image/png;base64,AAAA\u00a0(", descriptors: "" },
      { url: "https://evil.example/b.png", descriptors: "1x" },
    ]);
    expect(srcsetCandidates("https://h/a.png\u3000https://h/b.png 2x")).toEqual([{ url: "https://h/a.png\u3000https://h/b.png", descriptors: "2x" }]);
  });

  // Spec: INV-19.
  it("AT-SRCSET-04 an empty value or one of spaces and commas has no candidates", () => {
    expect(srcsetCandidates("")).toEqual([]);
    expect(srcsetCandidates(" , ,\t")).toEqual([]);
  });
});
