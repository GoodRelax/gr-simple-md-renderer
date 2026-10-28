import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return {
    ...actual,
    applyTheme: vi.fn(),
    applySystemTheme: vi.fn(),
    showToast: vi.fn(),
    waitForDOMStability: vi.fn().mockResolvedValue(true),
  };
});
vi.mock("../js/config.js", async () => ({
  ...(await vi.importActual("../js/config.js")),
  FILE_SYSTEM_HANDLE_SUPPORTED: true,
}));
vi.mock("../js/classes/ModalController.js", () => ({
  default: { setupModal: vi.fn(), show: vi.fn(), hide: vi.fn() },
}));

import { showToast } from "../js/utils.js";
import { CONFIG } from "../js/config.js";
import { setupApp, dropEvent, settle } from "./helpers/appStack.js";
import { tap, pointer, keydown } from "./helpers/editDom.js";
import { fakeFileAccess, fakeFileHandle } from "./helpers/fakeFs.js";
import MarkdownTextOps from "../js/classes/MarkdownTextOps.js";

// The palette's math (Text format, second row; owner ruling 2026-10-25):
// inline math at the caret of the block editor, and the three math boxes
// in one press, through the path of Insert table / Mermaid (INV-52).

const M = CONFIG.messages.edit;
const TOAST_MS = CONFIG.codeView.toastDurationMs;
const MATH = CONFIG.edit.inlineMathTemplate;
const BOXES = CONFIG.edit.mathBoxesTemplate;
const DOC = "# Title\n\nHello word here.\n\nSecond para.\n\n| A | B |\n|---|---|\n| x | y |\n";
const isPara = (start) => (b) => b.type === "paragraph" && b.raw.startsWith(start);

let app;

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  showToast.mockClear();
});

afterEach(() => {
  app?.teardown();
  app = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function withDocument(doc = DOC) {
  const access = fakeFileAccess();
  app = await setupApp({ fileAccess: access });
  const handle = fakeFileHandle({ name: "doc.md", content: [doc], calls: access.calls });
  document.dispatchEvent(dropEvent(new File([doc], "doc.md", { lastModified: 1000 }), handle));
  await settle();
  keydown(document.body, "e");
  return app;
}

const btn = (id) => app.paletteRoot().querySelector(`#${id}`);
const formatMenu = () => document.getElementById("paletteFormatMenu");
const menuBtn = (id) => formatMenu().querySelector(`#${id}`);
const off = (el) => el.getAttribute("aria-disabled") === "true";

/** Press and release (jsdom layout: every rect is at 0,0). */
function press(el) {
  pointer(el, "pointerdown", { x: 0, y: 0 });
  pointer(el, "pointerup", { x: 0, y: 0 });
}

function open(pred) {
  const el = app.block(pred).el;
  tap(el.querySelector(":scope > .grsmd-table-tab") ?? el.firstElementChild);
  return app.blockEditor();
}

const nextFrame = () =>
  new Promise((resolve) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 16)));

async function selectInEditor(ta, start, end) {
  ta.setSelectionRange(start, end);
  document.dispatchEvent(new Event("selectionchange"));
  await nextFrame();
}

function typeInBlock(ta, text) {
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Open Text format and press one of its buttons. */
function pressInFormat(id) {
  press(btn("paletteFormat"));
  expect(formatMenu().hidden).toBe(false);
  press(menuBtn(id));
}

/** The six blocks of the math boxes, in order, from a model. */
const boxBlocks = () => {
  const blocks = app.orchestrator.getModel().getBlocks();
  const k = blocks.findIndex((b) => b.raw === "Maxwell's Equations");
  return k < 0 ? [] : blocks.slice(k, k + 6);
};

describe("AT-UI-68 Insert inline math (owner ruling 2026-10-25, INV-52)", () => {
  it("(a) the math goes in at the caret of the open editor; nothing is committed; the caret is right after it", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    await selectInEditor(ta, 5, 5); // Hello| word here.
    const commit = vi.spyOn(app.orchestrator, "commitBlock");
    pressInFormat("paletteInlineMath");
    expect(ta.value).toBe(`Hello ${MATH} word here.`);
    expect(ta.selectionStart).toBe(6 + MATH.length);
    expect(ta.selectionEnd).toBe(6 + MATH.length);
    expect(document.activeElement).toBe(ta);
    expect(commit).not.toHaveBeenCalled();
    expect(formatMenu().hidden).toBe(true); // a popover item closes the popover (11-f)
    expect(showToast).not.toHaveBeenCalled();
  });

  it("(b) with a selection: at its end; the selected text stays", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    await selectInEditor(ta, 0, 10); // "Hello word"
    pressInFormat("paletteInlineMath");
    expect(ta.value).toBe(`Hello word ${MATH} here.`);
  });

  it("(c) the button is on only where the math can go; the state is worked out while Text format is open (INV-51)", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    typeInBlock(ta, "Some `code span` here");
    await selectInEditor(ta, 8, 8); // inside the code span
    press(btn("paletteFormat"));
    expect(off(menuBtn("paletteInlineMath"))).toBe(true);
    expect(off(menuBtn("paletteMathBox"))).toBe(false);
    await selectInEditor(ta, 4, 4); // Some| `code
    expect(off(menuBtn("paletteInlineMath"))).toBe(false);
    press(menuBtn("paletteInlineMath"));
    expect(ta.value).toBe(`Some ${MATH} \`code span\` here`);
  });

  it("(d) the place is right but the math would not read as itself: a toast, nothing changes", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    typeInBlock(ta, "costs $5 and");
    await selectInEditor(ta, 12, 12);
    press(btn("paletteFormat"));
    expect(off(menuBtn("paletteInlineMath"))).toBe(false); // only the place is checked
    press(menuBtn("paletteInlineMath"));
    expect(showToast).toHaveBeenCalledWith(M.mathNotInsertable, TOAST_MS);
    expect(ta.value).toBe("costs $5 and");
    expect(app.ui.blockEdit.isEditing()).toBe(true);
  });

  it("(e) off while a cell is open; Insert math boxes too (as Mermaid)", async () => {
    await withDocument();
    const cell = app.preview.querySelector("table tbody td");
    tap(cell);
    await settle();
    expect(app.ui.blockEdit.isEditingCell()).toBe(true);
    press(btn("paletteFormat"));
    expect(formatMenu().hidden).toBe(false);
    expect(off(menuBtn("paletteInlineMath"))).toBe(true);
    expect(off(menuBtn("paletteMathBox"))).toBe(true);
  });

  it("(f) in a table's source (the Markdown tab), inside a cell's text: the math goes in", async () => {
    await withDocument();
    const ta = open((b) => b.type === "table");
    const caret = ta.value.indexOf("| x") + 3;
    await selectInEditor(ta, caret, caret);
    pressInFormat("paletteInlineMath");
    expect(ta.value).toContain(`| x ${MATH} | y |`);
  });

  it("(g) Undo (the palette's) after the math: the editor is committed and that is taken back (INV-48)", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    await selectInEditor(ta, 5, 5);
    pressInFormat("paletteInlineMath");
    press(btn("paletteUndo"));
    await settle();
    expect(app.orchestrator.getBody()).toBe(DOC);
  });

  it("(i) a huge paragraph (over invisibleMarkMaxChars): the button is off and its place is not lexed (INV-71, INV-51)", async () => {
    const huge = `${"word ".repeat(Math.ceil((CONFIG.edit.invisibleMarkMaxChars + 10) / 5))}end\n\nsmall\n`;
    await withDocument(huge);
    const ta = open(isPara("word"));
    expect(ta.value.length).toBeGreaterThan(CONFIG.edit.invisibleMarkMaxChars);
    const place = vi.spyOn(MarkdownTextOps, "canInsertInlineMath");
    await selectInEditor(ta, 5, 5); // between two words: a place where the math could go
    press(btn("paletteFormat"));
    await selectInEditor(ta, 5, 5);
    expect(off(menuBtn("paletteInlineMath"))).toBe(true);
    expect(place).not.toHaveBeenCalled();
    // the command itself does nothing there either (the button is off anyway)
    expect(app.ui.blockEdit.insertInlineMath(MATH)).toBe(false);
    expect(ta.value).toBe(huge.slice(0, huge.indexOf("\n\n")));
  });

  it("(h) an empty document: the math is the empty block's paragraph", async () => {
    app = await setupApp({ fileAccess: fakeFileAccess() });
    keydown(document.body, "e"); // the empty block's editor (INV-31)
    await settle();
    const ta = app.blockEditor();
    pressInFormat("paletteInlineMath");
    expect(ta.value).toBe(MATH);
  });
});

describe("AT-UI-69 Insert math boxes: the three math boxes under their names, in one press (owner ruling 2026-10-25)", () => {
  it("(a) while editing: the editor is committed, the six blocks go in at the caret line, nothing opens", async () => {
    await withDocument();
    const ta = open(isPara("Second"));
    typeInBlock(ta, "Line one\nLine two");
    await selectInEditor(ta, 4, 4);
    pressInFormat("paletteMathBox");
    expect(app.blockEditor()).toBeNull(); // committed (synchronously)
    expect(app.orchestrator.getBody()).toContain(`Line one\n\n${BOXES}\n\nLine two`);
    await settle();
    expect(app.ui.blockEdit.isEditing()).toBe(false); // nothing opens: the boxes are seen drawn
    expect(boxBlocks().map((b) => b.type)).toEqual(["paragraph", "blockKatex", "paragraph", "blockKatex", "paragraph", "blockKatex"]);
    expect(app.preview.querySelectorAll(".katex-display")).toHaveLength(3);
    expect(app.preview.querySelector(".katex-error")).toBeNull();
  });

  it("(b) the least scroll shows the first inserted block (ScrollMemento.reveal)", async () => {
    await withDocument();
    const ta = open(isPara("Second"));
    await selectInEditor(ta, 3, 3);
    const reveal = vi.spyOn(app.ui.blockEdit.scrollMemento, "reveal");
    pressInFormat("paletteMathBox");
    await settle();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal.mock.calls[0][0].textContent.trim()).toBe("Maxwell's Equations");
  });

  it("(c) one Undo takes the six blocks away (the commit stays); Redo brings them back", async () => {
    await withDocument();
    const ta = open(isPara("Second"));
    typeInBlock(ta, "Line one\nLine two");
    await selectInEditor(ta, 4, 4);
    pressInFormat("paletteMathBox");
    await settle();
    const withBoxes = app.orchestrator.getBody();
    press(btn("paletteUndo"));
    await settle();
    expect(app.orchestrator.getBody()).toBe(DOC.replace("Second para.", "Line one\nLine two"));
    expect(boxBlocks()).toHaveLength(0);
    keydown(document.body, "y", { ctrlKey: true }); // Redo (INV-59)
    await settle();
    expect(app.orchestrator.getBody()).toBe(withBoxes);
    expect(boxBlocks()).toHaveLength(6);
    press(btn("paletteUndo"));
    press(btn("paletteUndo"));
    await settle();
    expect(app.orchestrator.getBody()).toBe(DOC);
  });

  it("(d) refused in a code block, a math block and a table's source: a toast, the editor stays open", async () => {
    await withDocument();
    for (const [text, caret] of [["```js\nconst a = 1;\n```", 12], ["$$\nx\n$$", 3]]) {
      const ta = open(isPara("Second")) ?? app.blockEditor();
      typeInBlock(ta, text);
      await selectInEditor(ta, caret, caret);
      showToast.mockClear();
      pressInFormat("paletteMathBox");
      expect(showToast).toHaveBeenCalledWith(M.insertNotPossible, TOAST_MS);
      expect(app.blockEditor()).toBe(ta);
      expect(ta.value).toBe(text);
      typeInBlock(ta, "Second para.");
      keydown(ta, "Escape");
      await settle();
    }
    const tableSource = open((b) => b.type === "table");
    showToast.mockClear();
    pressInFormat("paletteMathBox");
    expect(showToast).toHaveBeenCalledWith(M.insertNotPossible, TOAST_MS);
    expect(app.blockEditor()).toBe(tableSource);
    expect(app.orchestrator.getBody()).toBe(DOC);
  });

  it("(e) the last inserted block becomes the last opened one: a later Mermaid goes after the third box", async () => {
    await withDocument();
    const ta = open(isPara("Hello"));
    await selectInEditor(ta, 3, 3);
    pressInFormat("paletteMathBox");
    await settle();
    expect(app.ui.blockEdit.isEditing()).toBe(false);
    press(btn("paletteMermaid"));
    press(document.querySelector('#paletteMermaidMenu button[aria-label="Flowchart"]'));
    await settle();
    const blocks = app.orchestrator.getModel().getBlocks().map((b) => b.raw);
    const last = blocks.findIndex((r) => r.startsWith("$$\n\\begin{aligned}\ni\\hbar"));
    expect(last).toBeGreaterThan(0);
    expect(blocks[last + 1].startsWith("```mermaid")).toBe(true);
    expect(blocks[last - 1]).toBe("Schroedinger Equation, Wavefunction Normalization, and Pauli Matrices");
  });

  it("(g) an empty gap editor (the + between blocks, INV-73): the boxes go into that gap, nothing opens", async () => {
    await withDocument();
    const blocks = app.orchestrator.getModel().getBlocks();
    const title = blocks.findIndex((b) => b.raw === "# Title");
    app.ui.blockEdit.dispatch("gapInsertRequested", { kind: "gap", afterBlockId: blocks[title].id, beforeBlockId: blocks[title + 1].id });
    expect(app.ui.blockEdit.isEditing()).toBe(true);
    pressInFormat("paletteMathBox");
    await settle();
    expect(app.orchestrator.getBody()).toBe(DOC.replace("# Title\n\n", () => `# Title\n\n${BOXES}\n\n`));
    expect(app.ui.blockEdit.isEditing()).toBe(false);
    expect(boxBlocks()).toHaveLength(6);
  });

  it("(f) an empty document's empty block (INV-31): the boxes take its place", async () => {
    app = await setupApp({ fileAccess: fakeFileAccess() });
    keydown(document.body, "e");
    await settle();
    pressInFormat("paletteMathBox");
    await settle();
    expect(app.orchestrator.getBody()).toBe(BOXES);
    expect(app.ui.blockEdit.isEditing()).toBe(false);
  });
});
