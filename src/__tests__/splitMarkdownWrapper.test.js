import { describe, it, expect } from "vitest";
import { splitMarkdownWrapper } from "../js/textTransforms.js";
import { loadSampleLf } from "./helpers/samples.js";

// Inputs are LF (spec 5.14.1: line endings are normalized before the split).
// Every case also checks the round trip prefix + body + suffix === text (5.13 rule 4).

function expectRoundTrip(text) {
  const r = splitMarkdownWrapper(text);
  expect(r.prefix + r.body + r.suffix).toBe(text);
  return r;
}

function expectUnchanged(text) {
  const r = expectRoundTrip(text);
  expect(r).toEqual({ prefix: "", body: text, suffix: "" });
}

describe("splitMarkdownWrapper (change 00, spec 5.13)", () => {
  it("AT-WRAP-01 strips a triple-backtick markdown wrapper (INV-38)", () => {
    const r = expectRoundTrip("```markdown\n# Hello\n```");
    expect(r).toEqual({ prefix: "```markdown\n", body: "# Hello", suffix: "\n```" });
  });

  it("AT-WRAP-02 keeps the newline after the closing fence in the suffix", () => {
    const r = expectRoundTrip("```markdown\n# Hello\n```\n");
    expect(r.suffix).toBe("\n```\n");
    expect(r.body).toBe("# Hello");
  });

  it("AT-WRAP-03 does not strip a nested inner code block", () => {
    const text = "````markdown\n# T\n\n```js\nx\n```\n````";
    const r = expectRoundTrip(text);
    expect(r.prefix).toBe("````markdown\n");
    expect(r.suffix).toBe("\n````");
    expect(r.body).toBe("# T\n\n```js\nx\n```");
  });

  it("AT-WRAP-04 strips a six-backtick wrapper", () => {
    const r = expectRoundTrip("``````markdown\n# A\n``````");
    expect(r).toEqual({ prefix: "``````markdown\n", body: "# A", suffix: "\n``````" });
  });

  it("AT-WRAP-05 puts leading blank and whitespace-only lines into the prefix", () => {
    const r = expectRoundTrip("\n  \n```markdown\n# A\n```");
    expect(r.prefix).toBe("\n  \n```markdown\n");
    expect(r.body).toBe("# A");
  });

  it("AT-WRAP-06 allows spaces after the markdown tag", () => {
    const r = expectRoundTrip("```markdown  \n# A\n```");
    expect(r).toEqual({ prefix: "```markdown  \n", body: "# A", suffix: "\n```" });
  });

  it("AT-WRAP-07 puts a blank line right after the opening fence into the prefix (Q5)", () => {
    const r = expectRoundTrip("```markdown\n\n# A\n```");
    expect(r.prefix).toBe("```markdown\n\n");
    expect(r.body).toBe("# A");
  });

  it.each(["MARKDOWN", "Markdown"])("AT-WRAP-08 is case-insensitive for %s", (tag) => {
    const r = expectRoundTrip("```" + tag + "\n# A\n```");
    expect(r.body).toBe("# A");
    expect(r.prefix).toBe("```" + tag + "\n");
  });

  it.each([
    ["3 then 4", "```markdown\n# A\n````"],
    ["4 then 3", "````markdown\n# A\n```"],
  ])("AT-WRAP-09 strips nothing when the backtick counts differ (%s)", (_name, text) => {
    expectUnchanged(text);
  });

  it.each([
    ["without final newline", "# Doc\n\ntext\n\n```js\nx\n```"],
    ["with final newline", "# Doc\n\ntext\n\n```js\nx\n```\n"],
  ])("AT-WRAP-10 keeps the closing fence of a document that ends with a code block (%s)", (_name, text) => {
    expectUnchanged(text);
  });

  it("AT-WRAP-11 keeps a document that starts with a markdown example block and ends with a paragraph", () => {
    expectUnchanged("```markdown\n# ex\n```\n\nSome text.\n");
  });

  it("AT-WRAP-12 strips nothing when the closing fence is missing", () => {
    expectUnchanged("```markdown\n# A\n\nunfinished output");
  });

  it("AT-WRAP-13 accepted limit (#76): example first and code block last is stripped, round trip holds", () => {
    const text = "```markdown\n# ex\n```\n\ntext\n\n```js\nx\n```";
    const r = expectRoundTrip(text);
    expect(r.prefix).toBe("```markdown\n");
    expect(r.suffix).toBe("\n```");
    expect(r.body).toBe("# ex\n```\n\ntext\n\n```js\nx");
  });

  it("AT-WRAP-14 strips nothing for an empty wrapper (Q4)", () => {
    expectUnchanged("```markdown\n```");
  });

  it("AT-WRAP-15 puts spaces and blank lines after the closing fence into the suffix", () => {
    const r = expectRoundTrip("```markdown\n# A\n```  \n\n");
    expect(r.suffix).toBe("\n```  \n\n");
    expect(r.body).toBe("# A");
  });

  describe("AT-WRAP-16 fixed combinations keep the round trip and never trim", () => {
    const leads = ["", "\n", "\n  \n"];
    const fences = ["```", "````", "``````"];
    const tags = ["markdown", "MARKDOWN", "Markdown"];
    const ends = ["", "\n", "  ", "  \n\n"];
    const inner = "  # Title  \n\ntext with trailing spaces  ";
    const cases = [];
    for (const lead of leads)
      for (const fence of fences)
        for (const tag of tags)
          for (const end of ends) cases.push([lead, fence, tag, end]);

    it.each(cases)("wrapped: lead=%j fence=%s tag=%s end=%j", (lead, fence, tag, end) => {
      const text = lead + fence + tag + "\n" + inner + "\n" + fence + end;
      const r = expectRoundTrip(text);
      expect(r.prefix).toBe(lead + fence + tag + "\n");
      expect(r.body).toBe(inner);
      expect(r.suffix).toBe("\n" + fence + end);
    });

    it.each(leads.flatMap((lead) => ends.map((end) => [lead, end])))(
      "not wrapped: lead=%j end=%j",
      (lead, end) => {
        expectUnchanged(lead + inner + end);
      },
    );
  });

  it("AT-WRAP-17 splits sample-data.md so that body + newline equals sample-data.txt (INV-38)", () => {
    const md = loadSampleLf("sample-data.md");
    const txt = loadSampleLf("sample-data.txt");
    const r = expectRoundTrip(md);
    expect(r.prefix).toBe("````markdown\n");
    expect(r.suffix).toBe("\n````\n");
    expect(r.body + "\n").toBe(txt);
  });

  it.each([
    ["one blank line", "```markdown\n\n```"],
    ["two blank lines", "```markdown\n\n\n```"],
  ])("AT-WRAP-19 strips nothing when the wrapper holds only blank lines (%s)", (_name, text) => {
    expectUnchanged(text);
  });
});

// Leading blank lines are read line by line, in time linear in their number
// (5.13 rule 1). The old pattern tried every way to split them into lines,
// doubling the time with each line: 30 lines took about 17 s. This check runs
// always (not only with GRSMD_PERF=1): it now takes well under 1 ms, so the
// budget leaves a margin of over 1,000 times on a loaded machine.
const LEADING_BUDGET_MS = 1000;

describe("splitMarkdownWrapper: many leading blank lines (5.13 rule 1, ReDoS)", () => {
  const timed = (text) => {
    const t0 = performance.now();
    const r = expectRoundTrip(text);
    return { r, ms: performance.now() - t0 };
  };

  it("AT-WRAP-20 30 leading blank lines before a heading: unchanged, within 1,000 ms", () => {
    const text = "\n \n\t\n".repeat(10) + "## Section 0\n\nParagraph 0.\n";
    const { r, ms } = timed(text);
    expect(r).toEqual({ prefix: "", body: text, suffix: "" });
    expect(ms).toBeLessThan(LEADING_BUDGET_MS);
  });

  it("AT-WRAP-21 10,000 leading blank and whitespace-only lines before a wrapper go into the prefix", () => {
    const lead = "\n  \n\t \n".repeat(3333) + "\n";
    const text = lead + "```markdown\n# Hello\n```\n";
    const { r, ms } = timed(text);
    expect(r).toEqual({ prefix: lead + "```markdown\n", body: "# Hello", suffix: "\n```\n" });
    expect(ms).toBeLessThan(LEADING_BUDGET_MS);
  });

  // Fixes the range of rule 1's white space (review L2): any white space but
  // the newline (as \s), not only spaces and tabs. The old pattern passes
  // this too; a fix narrowed to [ \t] fails it.
  it("AT-WRAP-22 blank lines of NBSP, U+3000, form feed and vertical tab go into the prefix; white space before the fence strips nothing", () => {
    const lead = " \n\u3000\n\f\n\v\n\u00a0\t \n";
    const r = expectRoundTrip(lead + "```markdown\n# Hello\n```");
    expect(r).toEqual({ prefix: lead + "```markdown\n", body: "# Hello", suffix: "\n```" });
    expectUnchanged("\n \u3000```markdown\n# Hello\n```");
  });
});
