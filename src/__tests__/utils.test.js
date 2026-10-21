import { describe, it, expect, beforeEach } from "vitest";
import { escapeHtml, formatDateTime, formatTime, applyTheme, systemTheme, applySystemTheme, isApplePlatform } from "../js/utils.js";

describe("escapeHtml", () => {
  it("escapes < and >", () => {
    expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
  });

  it("escapes &", () => {
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("'hello'")).toBe("&#39;hello&#39;");
  });

  it("returns empty string for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("does not escape normal text", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("escapes all special chars together", () => {
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;",
    );
  });
});

describe("formatDateTime", () => {
  it("formats epoch 0 as 1970-01-01 in local time", () => {
    const result = formatDateTime(0);
    // Should match YYYY-MM-DD HH:MM:SS pattern
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("formats a known timestamp correctly", () => {
    // 2024-06-15 12:30:45 UTC
    const ts = new Date(2024, 5, 15, 12, 30, 45).getTime();
    const result = formatDateTime(ts);
    expect(result).toBe("2024-06-15 12:30:45");
  });
});

describe("formatTime", () => {
  it("formats a Date object as HH:MM:SS", () => {
    const date = new Date(2024, 0, 1, 9, 5, 3);
    expect(formatTime(date)).toBe("09:05:03");
  });

  it("formats midnight correctly", () => {
    const date = new Date(2024, 0, 1, 0, 0, 0);
    expect(formatTime(date)).toBe("00:00:00");
  });

  it("formats 23:59:59 correctly", () => {
    const date = new Date(2024, 0, 1, 23, 59, 59);
    expect(formatTime(date)).toBe("23:59:59");
  });
});

describe("applyTheme", () => {
  beforeEach(() => {
    document.body.className = "";
  });

  it("adds 'dark' class for dark theme", () => {
    applyTheme("dark");
    expect(document.body.classList.contains("dark")).toBe(true);
  });

  it("removes 'dark' class for light theme", () => {
    document.body.classList.add("dark");
    applyTheme("light");
    expect(document.body.classList.contains("dark")).toBe(false);
  });

  it("light theme on already-light body is no-op", () => {
    applyTheme("light");
    expect(document.body.classList.contains("dark")).toBe(false);
  });
});

describe("systemTheme", () => {
  it("returns 'light' or 'dark'", () => {
    // jsdom does not implement matchMedia; provide a stub
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    const result = systemTheme();
    expect(["light", "dark"]).toContain(result);
  });
});

describe("isApplePlatform (INV-14: Cmd is the primary modifier)", () => {
  it.each([
    [{ userAgentData: { platform: "macOS" } }, true],
    [{ userAgentData: { platform: "Windows" }, platform: "MacIntel" }, false], // userAgentData wins
    [{ userAgentData: { platform: "" }, platform: "MacIntel" }, true], // empty: fall back to platform
    [{ platform: "MacIntel" }, true],
    [{ platform: "iPhone" }, true],
    [{ platform: "iPad" }, true],
    [{ platform: "Win32" }, false],
    [{ platform: "Linux x86_64" }, false],
    [{}, false],
    [undefined, false],
  ])("%j -> %s", (nav, expected) => {
    expect(isApplePlatform(nav)).toBe(expected);
  });
});
