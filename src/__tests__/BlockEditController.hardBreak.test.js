import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return { ...actual, applyTheme: vi.fn(), waitForDOMStability: vi.fn().mockResolvedValue(true) };
});

import { setupEdit, flush } from "./helpers/editStack.js";
import { tap, pointer, keydown } from "./helpers/editDom.js";
import { CONFIG } from "../js/config.js";
import MarkdownTextOps from "../js/classes/MarkdownTextOps.js";

// INV-71: Enter / Shift+Enter in a paragraph, list or quote block editor;
// (6) the trailing spaces that make no line break are removed on commit.
// INV-70: the marks layer behind the block editor.

const S = "  ";
const DOC = "# Head\n\nHello word\n\n- a\n\n> q\n\n```\ncode\n```\n\n| A | B |\n| --- | --- |\n| x | y |\n";

let s;
afterEach(() => {
  s?.teardown();
  s = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function open(pred) {
  const el = s.block(pred).el;
  tap(el.querySelector(":scope > .grsmd-table-tab") ?? el.firstElementChild); // a table: its tab (INV-29 (b))
  return s.editor();
}
const byStart = (start) => (b) => b.raw.startsWith(start);

function caretAtEnd(ta) {
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function typeText(ta, text) {
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

const commit = () => pointer(document.body, "pointerdown");

describe("AT-HBK Enter in the block editor (INV-71)", () => {
  it.each([
    ["a paragraph", "Hello", `Hello word${S}\n`],
    ["a list", "- a", `- a${S}\n`],
    ["a quote", "> q", `> q${S}\n> `],
  ])("AT-HBK-01 Enter in %s inserts the line break mark and is taken", async (_name, start, expected) => {
    s = await setupEdit(DOC);
    const ta = open(byStart(start));
    caretAtEnd(ta);
    const e = keydown(ta, "Enter");
    expect(e.defaultPrevented).toBe(true);
    expect(ta.value).toBe(expected);
    expect(ta.selectionStart).toBe(expected.length);
    expect(s.host.onEditorInput).toHaveBeenCalled();
  });

  it("AT-HBK-02 Shift+Enter does the same", async () => {
    s = await setupEdit(DOC);
    const ta = open(byStart("Hello"));
    caretAtEnd(ta);
    expect(keydown(ta, "Enter", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(ta.value).toBe(`Hello word${S}\n`);
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Alt", { altKey: true }],
    ["Meta", { metaKey: true }],
    ["IME composition", { isComposing: true }],
    ["keyCode 229", { keyCode: 229 }],
  ])("AT-HBK-03 Enter with %s is left to the browser", async (_name, init) => {
    s = await setupEdit(DOC);
    const ta = open(byStart("Hello"));
    caretAtEnd(ta);
    expect(keydown(ta, "Enter", init).defaultPrevented).toBe(false);
    expect(ta.value).toBe("Hello word");
  });

  it.each([
    ["a heading", "# Head"],
    ["a code block", "```"],
  ])("AT-HBK-04 Enter in %s is the browser's newline", async (_name, start) => {
    s = await setupEdit(DOC);
    const ta = open(byStart(start));
    caretAtEnd(ta);
    expect(keydown(ta, "Enter").defaultPrevented).toBe(false);
  });

  it("AT-HBK-05 a table keeps its <br> (INV-27)", async () => {
    s = await setupEdit(DOC);
    const ta = open(byStart("| A"));
    ta.setSelectionRange(ta.value.indexOf("x") + 1, ta.value.indexOf("x") + 1);
    expect(keydown(ta, "Enter").defaultPrevented).toBe(true);
    expect(ta.value).toContain(`x${CONFIG.edit.tableLineBreak}`);
  });

  it.each([["Ctrl", { ctrlKey: true }], ["Alt", { altKey: true }], ["Meta", { metaKey: true }]])(
    "AT-HBK-14 %s+Enter in a table's source is the browser's newline (owner ruling Q-b, INV-27)",
    async (_name, init) => {
      s = await setupEdit(DOC);
      const ta = open(byStart("| A"));
      const before = ta.value;
      ta.setSelectionRange(ta.value.indexOf("x") + 1, ta.value.indexOf("x") + 1);
      expect(keydown(ta, "Enter", init).defaultPrevented).toBe(false);
      expect(ta.value).toBe(before);
    },
  );

  it("AT-HBK-06 Enter where the line is a code block inside the list: the browser's newline (null)", async () => {
    s = await setupEdit("- a\n\n  ```\n  x\n  ```\n");
    const ta = open(byStart("- a"));
    const at = ta.value.indexOf("x") + 1;
    ta.setSelectionRange(at, at);
    expect(keydown(ta, "Enter").defaultPrevented).toBe(false);
  });
});

describe("AT-HBK-16 a block above invisibleMarkMaxChars is not lexed per key (owner ruling 2026-10-23, review P-4)", () => {
  const huge = () => `${"word ".repeat(Math.ceil((CONFIG.edit.invisibleMarkMaxChars + 10) / 5))}end\n\nsmall paragraph\n`;

  it("Enter is the browser's newline; at the limit or below, the line break mark as before", async () => {
    s = await setupEdit(huge());
    const ta = open(byStart("word"));
    expect(ta.value.length).toBeGreaterThan(CONFIG.edit.invisibleMarkMaxChars);
    const before = ta.value;
    caretAtEnd(ta);
    expect(keydown(ta, "Enter").defaultPrevented).toBe(false);
    expect(ta.value).toBe(before);
    commit();
    const small = open(byStart("small"));
    caretAtEnd(small);
    expect(keydown(small, "Enter").defaultPrevented).toBe(true);
  });

  it("the format and link states do not lex it: on for a selection; Bold checks when pressed", async () => {
    s = await setupEdit(huge());
    const ta = open(byStart("word"));
    const can = vi.spyOn(MarkdownTextOps, "canFormatRange");
    ta.setSelectionRange(0, 4);
    expect(s.bec.canFormatSelection()).toBe(true);
    expect(s.bec.canPasteLink()).toBe(true);
    expect(s.bec.canRemoveLink()).toBe(true);
    ta.setSelectionRange(4, 4);
    expect(s.bec.canFormatSelection()).toBe(false);
    expect(s.bec.canPasteLink()).toBe(false);
    expect(s.bec.canRemoveLink()).toBe(false);
    expect(can).not.toHaveBeenCalled();
    ta.setSelectionRange(0, 4);
    expect(s.bec.formatSelection({ kind: "strong" })).toBe(true);
    expect(ta.value.startsWith("**word** word")).toBe(true);
    expect(s.bec.isHugeBlock()).toBe(true);
  });
});

describe("AT-HBK the trailing spaces on commit (INV-71 (6))", () => {
  it("AT-HBK-07 a list: Enter, then a new item typed by hand; the spaces before it go", async () => {
    s = await setupEdit(DOC);
    const ta = open(byStart("- a"));
    caretAtEnd(ta);
    keydown(ta, "Enter");
    typeText(ta, `${ta.value}- b`);
    commit();
    expect(s.orchestrator.getBody()).toContain("- a\n- b\n");
  });

  it("AT-HBK-08 a paragraph line break that makes a <br> stays", async () => {
    s = await setupEdit(DOC);
    const ta = open(byStart("Hello"));
    typeText(ta, `Hello${S}\nword`);
    commit();
    expect(s.orchestrator.getBody()).toContain(`Hello${S}\nword\n`);
  });

  it("AT-HBK-09 a text that is the same as before after the clean-up commits nothing", async () => {
    s = await setupEdit(DOC);
    const ta = open(byStart("Hello"));
    typeText(ta, `Hello word${S}`);
    commit();
    await flush();
    expect(s.orchestrator.getBody()).toBe(DOC);
    expect(s.orchestrator.canUndo()).toBe(false);
  });

  it("AT-HBK-10 other block types are committed as typed", async () => {
    s = await setupEdit(DOC);
    const ta = open(byStart("```"));
    typeText(ta, `\`\`\`\ncode${S}\n\`\`\``);
    commit();
    expect(s.orchestrator.getBody()).toContain(`code${S}\n`);
  });
});

describe("AT-HBK the marks layer (INV-70)", () => {
  const layer = () => s.preview.querySelector(".md-block-editing > .md-invisible-overlay");
  // the layer is drawn in the frame after the editor opens (INV-70)
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

  it("AT-HBK-11 opens with the editor (drawn in the next frame) and goes with it", async () => {
    s = await setupEdit(DOC);
    const ta = open(byStart("Hello"));
    expect(layer()).toBe(null);
    await frame();
    expect(layer()).not.toBe(null);
    expect(layer().nextElementSibling).toBe(ta);
    commit();
    expect(s.preview.querySelector(".md-invisible-overlay")).toBe(null);
  });

  it("AT-HBK-12 line end marks in a paragraph block; none in a code block", async () => {
    s = await setupEdit(`a${S}\nb\n\n\`\`\`\nc${S}\n\`\`\`\n`);
    open(byStart("a"));
    await frame();
    expect([...layer().querySelectorAll(".grsmd-invisible")].map((m) => m.textContent)).toEqual([S]);
    commit();
    open(byStart("```"));
    await frame();
    expect(layer().querySelectorAll(".grsmd-invisible")).toHaveLength(0);
  });

  it("AT-HBK-13 no layer for a block longer than invisibleMarkMaxChars", async () => {
    s = await setupEdit(`${"x".repeat(CONFIG.edit.invisibleMarkMaxChars + 1)}\n`);
    open(byStart("x"));
    await frame();
    expect(layer()).toBe(null);
  });

  it("AT-HBK-15 no layer for a block with more marks than invisibleMarkMaxMarks (P-3)", async () => {
    const many = "a\u00a0".repeat(CONFIG.edit.invisibleMarkMaxMarks + 1);
    s = await setupEdit(`${many}\n\nfew\u00a0marks\n`);
    open(byStart("a"));
    await frame();
    expect(layer()).toBe(null);
    commit();
    open(byStart("few"));
    await frame();
    expect(layer()).not.toBe(null);
  });
});
