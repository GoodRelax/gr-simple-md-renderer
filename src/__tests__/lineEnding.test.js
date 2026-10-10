import { describe, it, expect } from "vitest";
import {
  detectLineEnding,
  normalizeLineEndings,
  convertLineEndings,
  hasUtf8Bom,
} from "../js/textTransforms.js";
import { withBom } from "./helpers/samples.js";

describe("line endings and BOM (INV-44, spec 5.14.1)", () => {
  it("AT-EOL-01 detects LF, CRLF, and LF when there is no newline", () => {
    expect(detectLineEnding("a\nb\n")).toBe("\n");
    expect(detectLineEnding("a\r\nb\r\n")).toBe("\r\n");
    expect(detectLineEnding("no newline")).toBe("\n");
    expect(detectLineEnding("")).toBe("\n");
  });

  it("AT-EOL-02 picks the majority; CRLF does not count as LF; a tie is LF", () => {
    expect(detectLineEnding("1\r\n2\r\n3\r\n4\n5\n")).toBe("\r\n");
    expect(detectLineEnding("1\r\n2\r\n3\n4\n5\n")).toBe("\n");
    expect(detectLineEnding("1\r\n2\r\n3\n4\n")).toBe("\n");
  });

  it("AT-EOL-03 saves a mostly lone-CR file as LF", () => {
    expect(detectLineEnding("1\r2\r3\r4\r5\r6\n")).toBe("\n");
  });

  it("AT-EOL-04 normalizes CRLF and lone CR to LF", () => {
    expect(normalizeLineEndings("a\r\n\rb\nc\r")).toBe("a\n\nb\nc\n");
  });

  it("AT-EOL-05 converts LF to CRLF without producing \\r\\r\\n, and leaves LF text alone", () => {
    expect(convertLineEndings("a\nb\n\nc", "\r\n")).toBe("a\r\nb\r\n\r\nc");
    expect(convertLineEndings("a\nb\n", "\r\n")).not.toContain("\r\r\n");
    expect(convertLineEndings("a\nb\n", "\n")).toBe("a\nb\n");
  });

  it("AT-EOL-06 detects the UTF-8 BOM only in the first three bytes", () => {
    expect(hasUtf8Bom(withBom("x"))).toBe(true);
    expect(hasUtf8Bom(new Uint8Array([0xef, 0xbb, 0xbf]))).toBe(true);
    expect(hasUtf8Bom(new Uint8Array([0xef, 0xbb]))).toBe(false);
    expect(hasUtf8Bom(new Uint8Array([]))).toBe(false);
    expect(hasUtf8Bom(new Uint8Array([0x41, 0xef, 0xbb, 0xbf]))).toBe(false);
  });

  it("AT-EOL-07 environment: File.text() drops the BOM, so the BOM is judged from the bytes", async () => {
    const file = new File([withBom("# Title\r\n")], "a.md");
    const text = await file.text();
    expect(text).toBe("# Title\r\n");
    const head = new Uint8Array(await file.slice(0, 3).arrayBuffer());
    expect(hasUtf8Bom(head)).toBe(true);
  });
});
