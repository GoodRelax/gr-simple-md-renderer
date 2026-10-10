import { describe, it, expect } from "vitest";
import DocumentSession, { LAST_MODIFIED_UNKNOWN } from "../js/classes/DocumentSession.js";

const WRAPPED_CRLF = "```markdown\r\n# Title\r\n\r\nLine one\r\nLine two\r\n```\r\n";

function changedLines(a, b) {
  const la = a.split("\n");
  const lb = b.split("\n");
  expect(lb.length).toBe(la.length);
  return la.filter((line, i) => line !== lb[i]).length;
}

describe("DocumentSession (Entity, immutable value)", () => {
  it("AT-SES-01 fromFileText records line ending, BOM and wrapper, and keeps an LF body (INV-38, INV-44)", () => {
    const s = DocumentSession.fromFileText(WRAPPED_CRLF, true, 1000, 7);
    expect(s.documentId).toBe(7);
    expect(s.lineEnding).toBe("\r\n");
    expect(s.hasBom).toBe(true);
    expect(s.wrapperPrefix).toBe("```markdown\n");
    expect(s.wrapperSuffix).toBe("\n```\n");
    expect(s.baselineBodyText).toBe("# Title\n\nLine one\nLine two");
    expect(s.baselineLastModified).toBe(1000);
    expect(s.getBodyText()).toBe(s.baselineBodyText);
  });

  it("AT-SES-02 toFileText of the baseline gives back the original file (plus the BOM)", () => {
    const s = DocumentSession.fromFileText(WRAPPED_CRLF, true, 1000, 1);
    const out = s.toFileText(s.getBodyText());
    expect(out).toBe("\uFEFF" + WRAPPED_CRLF);
    expect([...new TextEncoder().encode(out).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("AT-SES-03 changing one character changes exactly one line of the file", () => {
    const s = DocumentSession.fromFileText(WRAPPED_CRLF, false, 1, 1);
    const body = s.getBodyText().replace("Line one", "Line 0ne");
    expect(changedLines(WRAPPED_CRLF, s.toFileText(body))).toBe(1);
  });

  it("AT-SES-04 fromPastedText is LF, without BOM and wrapper; toFileText(body) === body", () => {
    const s = DocumentSession.fromPastedText("# A\n\ntext", 3);
    expect(s.lineEnding).toBe("\n");
    expect(s.hasBom).toBe(false);
    expect(s.wrapperPrefix).toBe("");
    expect(s.wrapperSuffix).toBe("");
    expect(s.toFileText("# A\n\ntext")).toBe("# A\n\ntext");
  });

  it("AT-SES-05 isBodyChanged compares with the baseline body", () => {
    const s = DocumentSession.fromPastedText("abc\n", 1);
    expect(s.isBodyChanged("abc\n")).toBe(false);
    expect(s.isBodyChanged("abd\n")).toBe(true);
    expect(s.isBodyChanged("abc")).toBe(true);
  });

  it("withSaved with an unreadable lastModified (null) records the baseline as unknown, which is neither null nor a number (INV-39)", () => {
    const fromFile = DocumentSession.fromFileText("a\n", false, 1000, 1).withSaved("b\n", null);
    const fromPaste = DocumentSession.fromPastedText("a\n", 2).withSaved("b\n", null);
    expect(fromFile.baselineLastModified).toBe(LAST_MODIFIED_UNKNOWN);
    expect(fromPaste.baselineLastModified).toBe(LAST_MODIFIED_UNKNOWN);
    expect(LAST_MODIFIED_UNKNOWN).not.toBeNull();
    expect(typeof LAST_MODIFIED_UNKNOWN).not.toBe("number");
    expect(fromFile.baselineBodyText).toBe("b\n");
  });

  it("AT-SES-06 withSaved returns a new value with the same document id; the old one is unchanged (R7.5)", () => {
    const s = DocumentSession.fromPastedText("old", 5);
    const t = s.withSaved("new", 42);
    expect(t).not.toBe(s);
    expect(t.documentId).toBe(5);
    expect(t.baselineBodyText).toBe("new");
    expect(t.baselineLastModified).toBe(42);
    expect(s.baselineBodyText).toBe("old");
    expect(s.baselineLastModified).toBe(null);
    expect(Object.isFrozen(s)).toBe(true);
  });

  it("AT-SES-07 a document that ends with a code block keeps its closing fence in the body", () => {
    const text = "# Doc\n\n```js\nx\n```\n";
    const s = DocumentSession.fromFileText(text, false, 1, 1);
    expect(s.wrapperSuffix).toBe("");
    expect(s.getBodyText()).toBe(text);
    expect(s.toFileText(s.getBodyText())).toBe(text);
  });

  it("AT-SES-08 mixed line endings with a tie are saved as LF on every line", () => {
    const s = DocumentSession.fromFileText("a\r\nb\nc\r\nd\n", false, 1, 1);
    expect(s.lineEnding).toBe("\n");
    expect(s.toFileText(s.getBodyText())).toBe("a\nb\nc\nd\n");
  });

  it("AT-SES-09 fromPastedText('') is an empty, unchanged document", () => {
    const s = DocumentSession.fromPastedText("", 1);
    expect(s.getBodyText()).toBe("");
    expect(s.isBodyChanged("")).toBe(false);
  });

  it("AT-SES-10 toFileText converts a 6 MB body (no size limit on save)", () => {
    const s = DocumentSession.fromFileText("x\r\n", false, 1, 1);
    const body = "0123456789\n".repeat(600000);
    const out = s.toFileText(body);
    expect(out.length).toBe(body.length + 600000);
  });

  it("AT-SES-11 holds no fileHandle and takes lastModified only from the argument (INV-55, R7.3)", () => {
    const s = DocumentSession.fromFileText("a", false, 123, 1);
    expect(Object.keys(s).some((k) => /handle/i.test(k))).toBe(false);
    expect(s.baselineLastModified).toBe(123);
  });
});
