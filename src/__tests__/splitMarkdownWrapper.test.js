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
