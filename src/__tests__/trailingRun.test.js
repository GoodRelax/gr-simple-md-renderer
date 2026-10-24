import { describe, it, expect } from "vitest";
import { trailingRunLength, trimTrailingRun, trailingRun } from "../js/textTransforms.js";

// The run of some characters at the end of a text, counted from the end
// (review of the render hang): in place of /[ \t]+$/, /\n*$/ and the like,
// which are quadratic in a long run that is not at the end, and of a
// lookbehind, which Safari before 16.4 cannot parse (P-05).

describe("AT-RUN trailingRunLength / trimTrailingRun / trailingRun", () => {
  it("AT-RUN-01 the run at the end, of any of the given characters", () => {
    expect(trailingRunLength("a \t \t", " \t")).toBe(4);
    expect(trailingRunLength("a  b", " ")).toBe(0);
    expect(trailingRunLength("", " ")).toBe(0);
    expect(trailingRunLength("   ", " ")).toBe(3);
    expect(trailingRunLength("x\\\\\\", "\\")).toBe(3);
    expect(trimTrailingRun("code\n\n\n", "\n")).toBe("code");
    expect(trimTrailingRun("a \n", " ")).toBe("a \n");
    expect(trailingRun("a\n\n", "\n")).toBe("\n\n");
    expect(trailingRun("a", "\n")).toBe("");
  });

  it("AT-RUN-02 a character that is not given ends the run (NBSP is not a space)", () => {
    expect(trailingRunLength("a\u00a0 ", " ")).toBe(1);
    expect(trimTrailingRun("a \u00a0", " \t")).toBe("a \u00a0");
  });

  it("AT-RUN-03 a run of 1,000,000 inside the text and one at the end: linear, within 1,000 ms", () => {
    const text = "a" + " ".repeat(1000000) + "x" + " ".repeat(1000000);
    const t0 = performance.now();
    expect(trailingRunLength(text, " ")).toBe(1000000);
    expect(trimTrailingRun(text, " \t").length).toBe(1000002);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
