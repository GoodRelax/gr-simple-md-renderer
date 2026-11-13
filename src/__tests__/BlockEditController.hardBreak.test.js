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

  it("AT-HBK-05 a table keeps its <br> on Shift+Enter; Enter is the browser's newline (INV-27, owner ruling B2)", async () => {
    s = await setupEdit(DOC);
    const ta = open(byStart("| A"));
    ta.setSelectionRange(ta.value.indexOf("x") + 1, ta.value.indexOf("x") + 1);
    const before = ta.value;
    expect(keydown(ta, "Enter").defaultPrevented).toBe(false);
    expect(ta.value).toBe(before);
    expect(keydown(ta, "Enter", { shiftKey: true }).defaultPrevented).toBe(true);
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

// Spec: INV-71, INV-73 (5), INV-49.
describe("AT-HBK-17 Enter in an editor with no type: a gap editor and the empty block (owner ruling JGQA E1 = a)", () => {
  // Spec: INV-73 (5), INV-71 (1).
  const PLAIN_NEWLINE_LINES = [
    ["a heading", "# H"],
    ["a fenced code block", "```js\ncode"],
    ["a table", "| a | b |\n| --- | --- |\n| x | y |"],
    ["an HTML block", "<details>"],
    ["a math block being typed ($$)", "$$"],
    ["a math block being typed (its next line)", "$$\nx"],
  ];

  function openGap() {
    const [first, second] = s.orchestrator.getModel().getBlocks();
    s.bec.dispatch("gapInsertRequested", { kind: "gap", afterBlockId: first.id, beforeBlockId: second.id });
    return s.editor();
  }

  async function openEmpty() {
    s = await setupEdit("", { editMode: true });
    await flush();
    tap(s.preview.querySelector(".md-block-empty"));
    return s.editor();
  }

  function enterAtEnd(ta, text) {
    typeText(ta, text);
    caretAtEnd(ta);
    return keydown(ta, "Enter");
  }

  it("(a) a gap editor: Enter after paragraph text inserts the line break mark", async () => {
    s = await setupEdit(DOC);
    const ta = openGap();
    expect(enterAtEnd(ta, "abc").defaultPrevented).toBe(true);
    expect(ta.value).toBe(`abc${S}\n`);
    expect(ta.selectionStart).toBe(ta.value.length);
  });

  it("(b) a gap editor: Enter on the empty line after it is a paragraph break; on a blank editor the browser's newline", async () => {
    s = await setupEdit(DOC);
    const ta = openGap();
    expect(enterAtEnd(ta, `abc${S}\n`).defaultPrevented).toBe(true);
    expect(ta.value).toBe("abc\n\n");
    expect(enterAtEnd(ta, "").defaultPrevented).toBe(false);
    expect(ta.value).toBe("");
  });

  it.each(PLAIN_NEWLINE_LINES)("(c) a gap editor: Enter at the end of %s is the browser's newline", async (_name, text) => {
    s = await setupEdit(DOC);
    const ta = openGap();
    expect(enterAtEnd(ta, text).defaultPrevented).toBe(false);
    expect(ta.value).toBe(text);
  });

  it("(d) a gap editor: the committed text keeps the mark, and the new paragraph shows the line break", async () => {
    s = await setupEdit(DOC);
    const ta = openGap();
    enterAtEnd(ta, "abc");
    typeText(ta, `${ta.value}def`);
    keydown(ta, "Escape");
    expect(s.orchestrator.getBody()).toContain(`# Head\n\nabc${S}\ndef\n\nHello word`);
    await flush();
    expect(s.block(byStart("abc")).el.querySelector("br")).not.toBeNull();
  });

  it.each([
    ["a list item", "- a", `- a${S}\n`],
    ["a quote", "> q", `> q${S}\n> `],
  ])("(d2) a gap editor: Enter after the text of %s inserts the line break mark, as in such a block", async (_name, text, expected) => {
    s = await setupEdit(DOC);
    const ta = openGap();
    expect(enterAtEnd(ta, text).defaultPrevented).toBe(true);
    expect(ta.value).toBe(expected);
  });

  // Spec: INV-71 (1).
  it("(d3) a gap editor and an open paragraph: $$, x and $$ typed with Enter go in as a math block", async () => {
    s = await setupEdit(DOC);
    // Why: Enter is left to the browser on these lines, so the test types the newline itself
    const typeMath = (ta, x) => {
      for (const line of ["$$", x]) {
        typeText(ta, `${ta.value}${line}`);
        caretAtEnd(ta);
        expect(keydown(ta, "Enter").defaultPrevented).toBe(false);
        typeText(ta, `${ta.value}\n`);
      }
      typeText(ta, `${ta.value}$$`);
    };
    const gap = openGap();
    typeMath(gap, "x");
    keydown(gap, "Escape");
    expect(s.orchestrator.getBody()).toContain("# Head\n\n$$\nx\n$$\n\nHello word");
    expect(s.block(byStart("$$\nx")).block.type).toBe("blockKatex");
    const para = open(byStart("Hello"));
    typeText(para, "");
    typeMath(para, "y");
    commit();
    expect(s.block(byStart("$$\ny")).block.type).toBe("blockKatex");
  });

  // Spec: INV-71 (6).
  it("(d4) a gap editor: a paste of $$ with spaces, other blocks and a closing $$ stays as it is, with its blocks (review N1)", async () => {
    s = await setupEdit(DOC);
    const ta = openGap();
    const pasted = `$$${S}\n\nSee the list:\n\n- a\n- b\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n\n$$\n\nEnd.`;
    typeText(ta, pasted);
    keydown(ta, "Escape");
    expect(s.orchestrator.getBody()).toContain(`# Head\n\n${pasted}\n\nHello word`);
    const types = s.orchestrator.getModel().getBlocks().map((b) => b.type);
    expect(types).not.toContain("blockKatex");
    expect(types.slice(0, 7)).toEqual(["heading", "paragraph", "paragraph", "list", "code", "paragraph", "paragraph"]);
  });

  // Spec: INV-71 (6).
  it("(d7) a gap editor: a paste whose list ends in indented code keeps the code's end spaces (review N6)", async () => {
    s = await setupEdit(DOC);
    const ta = openGap();
    typeText(ta, `- step\n\n      line one${S}\n\nAfter.`);
    keydown(ta, "Escape");
    expect(s.orchestrator.getBody()).toContain(`# Head\n\n- step\n\n      line one${S}\n\nAfter.\n\nHello word`);
  });

  it("(d5) after a commit the editor's kept lexing is gone, as when it closed (review N2)", async () => {
    s = await setupEdit(DOC);
    const ta = openGap();
    typeText(ta, `abc${S}\n\ndef${S}\n# H`);
    keydown(ta, "Escape");
    expect(s.orchestrator.getBody()).toContain("abc\n\ndef\n# H");
    expect(s.bec._lexers).toBeNull();
    const para = open(byStart("Hello"));
    typeText(para, `Hello${S}\n# H2`);
    commit();
    expect(s.bec._lexers).toBeNull();
  });

  // Spec: INV-71 (6).
  it.each([
    ["paragraph", "Hello", `a\n$$${S}\nb${S}`, `a\n$$${S}\nb`],
    ["list", "- a", `- a\n  $$${S}\n  b${S}`, `- a\n  $$${S}\n  b`],
    ["quote", "> q", `> a\n> $$${S}\n> b${S}`, `> a\n> $$${S}\n> b`],
  ])("(d6) an open %s block with a $$ line inside: its end spaces that make no line break go on commit, as on develop (review N3)", async (_name, start, typed, committed) => {
    s = await setupEdit(DOC);
    const ta = open(byStart(start));
    typeText(ta, typed);
    commit();
    expect(s.orchestrator.getBody()).toContain(`${committed}\n`);
    expect(s.orchestrator.getBody()).not.toContain(typed);
  });

  it("(e) the empty block of an empty document: Enter after paragraph text inserts the line break mark", async () => {
    const ta = await openEmpty();
    expect(enterAtEnd(ta, "abc").defaultPrevented).toBe(true);
    expect(ta.value).toBe(`abc${S}\n`);
  });

  it.each(PLAIN_NEWLINE_LINES)("(f) the empty block: Enter at the end of %s is the browser's newline", async (_name, text) => {
    const ta = await openEmpty();
    expect(enterAtEnd(ta, text).defaultPrevented).toBe(false);
    expect(ta.value).toBe(text);
  });

  // Spec: INV-71 (6).
  it("(g) a gap editor: Enter, then a heading typed by hand; the spaces before it go on commit", async () => {
    s = await setupEdit(DOC);
    const ta = openGap();
    enterAtEnd(ta, "abc");
    typeText(ta, `${ta.value}# H`);
    keydown(ta, "Escape");
    expect(s.orchestrator.getBody()).toContain("# Head\n\nabc\n# H\n\nHello word");
  });

  // Spec: INV-71 (6).
  it("(h) the empty block: Enter, then a heading typed by hand; the spaces before it go, a mark that makes a line break stays", async () => {
    const ta = await openEmpty();
    enterAtEnd(ta, "abc");
    typeText(ta, `${ta.value}def${S}\n# H`);
    commit();
    expect(s.orchestrator.getBody()).toContain(`abc${S}\ndef\n# H`);
  });

  // Spec: INV-70.
  it("(i) a gap editor and the empty block: line end marks on paragraph lines; none on a code line", async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const marks = () => [...s.preview.querySelectorAll(".md-block-editing > .md-invisible-overlay .grsmd-invisible")].map((m) => m.textContent);
    s = await setupEdit(DOC);
    const gap = openGap();
    enterAtEnd(gap, "abc");
    await frame();
    expect(marks()).toEqual([S]);
    typeText(gap, `\`\`\`\nc${S}`);
    await frame();
    expect(marks()).toEqual([]);
    commit();
    s.teardown();
    const empty = await openEmpty();
    enterAtEnd(empty, "abc");
    await frame();
    expect(marks()).toEqual([S]);
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
    s = await setupEdit(DOC.replace("Hello word", "Hello\u00a0word"));
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
    expect(layer()).toBe(null); // no mark, no layer (AT-ICO-18)
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
