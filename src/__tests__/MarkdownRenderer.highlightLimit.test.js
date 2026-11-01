import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import MarkdownRenderer from "../js/classes/MarkdownRenderer.js";
import MarkdownBlockModel from "../js/classes/MarkdownBlockModel.js";
import { CONFIG } from "../js/config.js";

// Code blocks of the Markdown view (owner ruling 2026-10-25, review of the
// render hang Q3): highlight.js has language patterns that are quadratic in
// a long block, and its language detection runs every language over the
// whole block. A block without a language is detected from its first
// CONFIG.rendering.highlightDetectChars characters; a block longer than
// CONFIG.rendering.highlightMaxChars is not highlighted (plain text).
// The time checks run always (as AT-WRAP-20): a few ms now, seconds before.
const LONG_BLOCK_BUDGET_MS = 1000;

describe("AT-MR code block highlighting limits (5.8)", () => {
  let preview;
  let renderer;
  let lexer;

  beforeEach(() => {
    preview = document.createElement("div");
    document.body.appendChild(preview);
    const marked = new Marked();
    marked.use(markedKatex({ throwOnError: false }));
    lexer = (src) => marked.lexer(src);
    renderer = new MarkdownRenderer(preview, marked, hljs, DOMPurify);
  });

  afterEach(() => {
    preview.remove();
    vi.restoreAllMocks();
  });

  const show = (markdown) => {
    const t0 = performance.now();
    renderer.renderBlocks(MarkdownBlockModel.fromBody(markdown, lexer, 1));
    return performance.now() - t0;
  };
  const code = () => preview.querySelector("pre code");
  const isHighlighted = () => code().querySelector("[class^='hljs-']") !== null;

  it("AT-MR-15 a code block without a language of 100,000 blank lines renders within 1,000 ms", () => {
    const ms = show("```\n" + "\n".repeat(100000) + "x\n```");
    expect(code().textContent.endsWith("x\n")).toBe(true);
    expect(ms).toBeLessThan(LONG_BLOCK_BUDGET_MS);
  });

  it("AT-MR-16 a JavaScript block of 100,000 blank lines (over the limit) renders within 1,000 ms, as plain text", () => {
    const ms = show("```javascript\n" + "\n".repeat(100000) + "const x = 1;\n```");
    expect(code().textContent.endsWith("const x = 1;\n")).toBe(true);
    expect(isHighlighted()).toBe(false);
    expect(ms).toBeLessThan(LONG_BLOCK_BUDGET_MS);
  });

  // the owner's numbers, not CONFIG's (AT-MR-19 ties them together)
  it.each([
    [20480, true],
    [20481, false],
  ])("AT-MR-17 a JavaScript block of %i characters: highlighted %s", (length, highlighted) => {
    const line = "const x = 1;\n";
    // the code text is the fence's content with its last newline (marked)
    const body = line.repeat(Math.floor((length - 1) / line.length)) + "x".repeat((length - 1) % line.length);
    show("```javascript\n" + body + "\n```");
    expect(code().textContent.length).toBe(length);
    expect(isHighlighted()).toBe(highlighted);
    expect(code().textContent).toBe(body + "\n");
  });

  it("AT-MR-18 a block without a language: the language is detected from its first characters only, and the whole block is highlighted in it", () => {
    const detect = vi.spyOn(hljs, "highlightAuto");
    const body = "def f(x):\n    return x + 1\n".repeat(400); // about 11,000 characters
    show("```\n" + body + "```");
    expect(detect).toHaveBeenCalledTimes(1);
    expect(detect.mock.calls[0][0]).toBe(body.slice(0, 3072));
    const language = detect.mock.results[0].value.language;
    expect(language).toBeTruthy();
    expect(code().classList.contains(`language-${language}`)).toBe(true);
    expect(code().classList.contains("hljs")).toBe(true);
    // the end of the block, past the detected part, is highlighted too
    const last = [...code().querySelectorAll("[class^='hljs-']")].pop();
    expect(code().textContent.length - code().textContent.lastIndexOf(last.textContent)).toBeLessThan(40);
  });

  // marked gives the class "language--" to a fence whose info string is "-";
  // highlight.js does not read it as a language (its pattern ends with \b)
  it("AT-MR-18 a fence whose info string is \"-\" has no language: detected from its first characters only (review M1)", () => {
    const detect = vi.spyOn(hljs, "highlightAuto");
    const body = "def f(x):\n    return x + 1\n".repeat(400);
    show("```-\n" + body + "```");
    expect(code().classList.contains("language--")).toBe(true);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(detect.mock.calls[0][0]).toBe(body.slice(0, 3072));
  });

  it("AT-MR-18 a block without a language that is detected as nothing stays plain text", () => {
    show("```\n" + "\u00b7 \u00b7 \u00b7\n" + "```");
    expect(isHighlighted()).toBe(false);
    expect(code().textContent).toBe("\u00b7 \u00b7 \u00b7\n");
  });

  it("AT-MR-19 the limits are in CONFIG: 3,072 characters for the detection, 20,480 for highlighting", () => {
    expect(CONFIG.rendering.highlightDetectChars).toBe(3072);
    expect(CONFIG.rendering.highlightMaxChars).toBe(20480);
  });
});
