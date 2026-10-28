import { describe, it, expect, beforeEach } from "vitest";
import { escapeHtml, formatDateTime, formatTime, applyTheme, systemTheme, applySystemTheme, isApplePlatform, isTypingTarget, isPastActivation, diagramControllersFor } from "../js/utils.js";
import { CONFIG } from "../js/config.js";

describe("AT-PAN-04 isPastActivation (INV-29, INV-68, INV-74 (2), 3.5 diagram pan: the one rule of a tap versus a drag)", () => {
  it("is past only beyond activationThresholdPx (Euclidean); exactly the threshold is not", () => {
    expect(CONFIG.pan.activationThresholdPx).toBe(5);
    const from = { x: 10, y: 20 };
    expect(isPastActivation(from, { x: 10, y: 20 })).toBe(false);
    expect(isPastActivation(from, { x: 15, y: 20 })).toBe(false); // exactly 5 px
    expect(isPastActivation(from, { x: 13, y: 24 })).toBe(false); // 3-4-5
    expect(isPastActivation(from, { x: 7, y: 16 })).toBe(false); // the other way
    expect(isPastActivation(from, { x: 15.01, y: 20 })).toBe(true);
    expect(isPastActivation(from, { x: 13, y: 25 })).toBe(true);
    expect(isPastActivation(from, { x: 10, y: 14 })).toBe(true);
  });
});

describe("AT-PAN-05 INV-16, INV-16b: which diagram controllers main.js makes for the pointers", () => {
  it.each([
    [{ fine: true, anyCoarse: false }, { zoomAndCopy: true, pan: true }], // a PC: mouse or trackpad only
    [{ fine: true, anyCoarse: true }, { zoomAndCopy: true, pan: false }], // a PC with a touch screen
    [{ fine: false, anyCoarse: true }, { zoomAndCopy: false, pan: false }], // a phone or a tablet
    [{ fine: false, anyCoarse: false }, { zoomAndCopy: false, pan: false }], // no pointer
  ])("%j -> %j", (pointers, expected) => {
    expect(diagramControllersFor(pointers)).toEqual(expected);
  });
});

describe("AT-UTL-01 FS-01, FS-03: escapeHtml", () => {
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

describe("AT-UTL-02 FS-03, spec 5.9: formatDateTime", () => {
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

describe("AT-UTL-03 spec 5.12: formatTime", () => {
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

describe("AT-UTL-04 FS-06: applyTheme", () => {
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

describe("AT-UTL-05 INV-12, FS-06: systemTheme", () => {
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

describe("AT-UTL-06 isApplePlatform (INV-14: Cmd is the primary modifier)", () => {
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

describe("AT-UTL-07 isTypingTarget (INV-14; also INV-74 (1): one check for both, review L5)", () => {
  it("an input, a textarea, a contenteditable element and the inside of a toolbar take the keys; the rest do not", () => {
    const make = (html) => {
      const box = document.createElement("div");
      box.innerHTML = html;
      document.body.appendChild(box);
      return box;
    };
    const box = make('<input><textarea></textarea><div contenteditable="true">x</div><div role="toolbar"><button>b</button></div><button>c</button><select><option>o</option></select>');
    const [input, textarea, editable, toolbar, button, select] = box.children;
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    // jsdom has no isContentEditable: set it as a browser does
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(toolbar.firstChild)).toBe(true);
    expect(isTypingTarget(button)).toBe(false);
    expect(isTypingTarget(select)).toBe(false); // as INV-14 lists them
    expect(isTypingTarget(null)).toBe(false);
    box.remove();
  });
});
