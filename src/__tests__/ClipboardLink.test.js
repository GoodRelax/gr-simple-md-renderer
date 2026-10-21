import { describe, it, expect } from "vitest";
import ClipboardLink from "../js/classes/ClipboardLink.js";

// INV-69 (URL condition), used by INV-72 (a) for a changed autolink text.
const SCHEMES = ["http:", "https:", "mailto:"];

describe("AT-CL-01 ClipboardLink.isLinkableUrl (pure)", () => {
  it.each([
    ["https://example.com/", true],
    ["  http://example.com/a?b=c  ", true],
    ["mailto:a@example.com", true],
    ["javascript:alert(1)", false],
    ["data:text/html,x", false],
    ["ftp://example.com/", false],
    ["example.com", false],
    ["https://a.example/\nb", false],
    ["", false],
  ])("%j -> %s", (text, expected) => {
    expect(ClipboardLink.isLinkableUrl(text, SCHEMES, 2048)).toBe(expected);
  });

  it("a URL longer than the limit is not one", () => {
    const url = `https://example.com/${"a".repeat(40)}`;
    expect(ClipboardLink.isLinkableUrl(url, SCHEMES, url.length)).toBe(true);
    expect(ClipboardLink.isLinkableUrl(url, SCHEMES, url.length - 1)).toBe(false);
    expect(ClipboardLink.isLinkableUrl(null, SCHEMES, 10)).toBe(false);
  });
});
