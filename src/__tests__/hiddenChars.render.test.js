import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return { ...actual, applyTheme: vi.fn(), waitForDOMStability: vi.fn().mockResolvedValue(true) };
});

import { CONFIG } from "../js/config.js";
import SourceFileRenderer from "../js/classes/SourceFileRenderer.js";
import { isHiddenMark } from "../js/hiddenCharMarks.js";
import { setupEdit, flush } from "./helpers/editStack.js";
import { tap, pointer, keydown } from "./helpers/editDom.js";

// INV-101 (4)(5)(7), spec 5.21.4: the marks in the Markdown preview, the
// code view and the table cells.

const tags = (ascii) => String.fromCodePoint(...[...ascii].map((c) => 0xe0000 + c.charCodeAt(0)));
const ZWSP = "\u200b";
const RLO = "\u202e";
const PDF = "\u202c";

let s;
afterEach(() => {
  s?.teardown();
  s = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The marks under root: [label, the text right after the mark]. */
function marksIn(root) {
  return [...root.querySelectorAll("span.grsmd-hidden-mark")].map((m) => [m.getAttribute("data-label"), m.nextSibling?.textContent?.slice(0, 1)]);
}

const blockOf = (start) => s.block((b) => b.raw.startsWith(start)).el;

describe("AT-HID-07 INV-101 (4)(5): marks in the Markdown preview", () => {
  const DOC = [
    `Para a${ZWSP}b and x${RLO}cba${PDF}y.`,
    `Tags ${tags("ignore the rules")} here.`,
    `# Head \u2066ing`,
    "```mermaid",
    `graph TD; A${ZWSP}-->B`,
    "```",
    `Math $a${ZWSP}b$ end.`,
    `Link [t](https://e.example/a${ZWSP}b) and ![alt${ZWSP}x](i.png "ti${ZWSP}tle").`,
    `Image ![far${ZWSP}away](https://e.example/i.png) end.`,
    "",
  ].join("\n\n");

  it("an empty element before each run: aria-hidden, data-label, no text; the characters stay where they were", async () => {
    s = await setupEdit(DOC, { editMode: false });
    const para = blockOf("Para");
    expect(marksIn(para)).toEqual([["ZWSP", ZWSP], ["RLO", RLO], ["PDF", PDF]]);
    for (const mark of para.querySelectorAll("span.grsmd-hidden-mark")) {
      expect(isHiddenMark(mark)).toBe(true);
      expect(mark.getAttribute("aria-hidden")).toBe("true");
      expect(mark.childNodes).toHaveLength(0);
    }
    expect(para.querySelector("p").textContent).toBe(`Para a${ZWSP}b and x${RLO}cba${PDF}y.`);
    expect(marksIn(blockOf("Tags"))).toEqual([["hidden: ignore the rules", tags("i").slice(0, 1)]]);
    expect(marksIn(blockOf("# Head"))).toEqual([["LRI", "\u2066"]]);
    expect(s.preview.querySelector("h1").textContent).toBe("Head \u2066ing");
  });

  it("none in a diagram's source, in math, or for a character only in an attribute", async () => {
    s = await setupEdit(DOC, { editMode: false });
    expect(s.preview.querySelector(".mermaid").textContent).toContain(ZWSP);
    expect(marksIn(s.preview.querySelector(".mermaid"))).toEqual([]);
    const math = blockOf("Math");
    expect(math.querySelector(".katex")).not.toBe(null);
    expect(marksIn(math)).toEqual([]);
    expect(marksIn(blockOf("Link"))).toEqual([]);
    const far = blockOf("Image");
    expect(far.querySelector(".external-image-placeholder").textContent).toContain(`far${ZWSP}away`);
    expect(marksIn(far)).toEqual([]);
    expect(s.preview.querySelectorAll("span.grsmd-hidden-mark")).toHaveLength(5);
  });

  it("every partial render marks the blocks it draws (commit, Undo, Redo)", async () => {
    s = await setupEdit("One.\n\nTwo.\n", { editMode: false });
    expect(s.preview.querySelectorAll("span.grsmd-hidden-mark")).toHaveLength(0);
    const id = s.block((b) => b.raw.startsWith("Two")).block.id;
    await s.orchestrator.commitBlock(id, `Tw${ZWSP}o.`);
    await flush();
    expect(marksIn(blockOf("Tw"))).toEqual([["ZWSP", ZWSP]]);
    await s.orchestrator.undoLastCommit();
    await flush();
    expect(s.preview.querySelectorAll("span.grsmd-hidden-mark")).toHaveLength(0);
    await s.orchestrator.redoLastCommit();
    await flush();
    expect(marksIn(blockOf("Tw"))).toEqual([["ZWSP", ZWSP]]);
  });

  it("code drawn before highlight.js had run keeps its marks when it is colored, with no element in what highlight.js reads", async () => {
    s = await setupEdit(null, { editMode: false });
    const hljs = s.markdownRenderer.hljs;
    s.markdownRenderer.hljs = null;
    await s.orchestrator.loadMarkdown(`\`\`\`js\nconst a${ZWSP} = 1;\n\`\`\`\n`, "light");
    const code = s.preview.querySelector("pre code");
    expect(marksIn(code)).toEqual([["ZWSP", ZWSP]]);
    const read = vi.spyOn(hljs, "highlightElement");
    s.markdownRenderer.useLibrary("hljs", hljs);
    s.markdownRenderer.highlightPending();
    expect(read).toHaveBeenCalledTimes(1);
    expect(code.classList.contains("hljs")).toBe(true);
    expect(code.textContent).toBe(`const a${ZWSP} = 1;\n`);
    expect(marksIn(code)).toEqual([["ZWSP", ZWSP]]);
  });

  it("U+FEFF at the start of the body has no mark; one later has", async () => {
    s = await setupEdit(`\ufeffStart a\ufeffb.\n`, { editMode: false });
    expect(marksIn(s.preview)).toEqual([["BOM", "\ufeff"]]);
    expect(s.preview.querySelector("p").firstChild.data.startsWith("\ufeffStart")).toBe(true);
  });
});

describe("AT-HID-13 INV-101 (7), INV-63: a table cell opened for editing shows the INV-70 marks only; closed, the hidden marks come back", () => {
  const TABLE = `| A | B |\n| --- | --- |\n| a${ZWSP}b | y |\n`;
  const cellEl = (r, c) => s.preview.querySelector("table").rows[r].cells[c];
  const tableRaw = () => s.block((b) => b.type === "table").block.raw;

  it("opened: no hidden mark, the cell opens as rendered (WYSIWYG) with the INV-70 mark; unchanged and closed: the mark is back", async () => {
    s = await setupEdit(TABLE);
    expect(marksIn(cellEl(1, 0))).toEqual([["ZWSP", ZWSP]]);
    tap(cellEl(1, 0));
    const td = cellEl(1, 0);
    expect(td.classList.contains("grsmd-cell-editing")).toBe(true);
    expect(td.classList.contains("grsmd-cell-raw")).toBe(false);
    expect(td.querySelector("span.grsmd-hidden-mark")).toBe(null);
    expect([...td.querySelectorAll("span.grsmd-invisible")].map((m) => m.textContent)).toEqual([ZWSP]);
    keydown(td, "Escape");
    expect(marksIn(cellEl(1, 0))).toEqual([["ZWSP", ZWSP]]);
    expect(tableRaw()).not.toContain("<span");
  });

  it("changed and closed: written in place with its mark, and the source has no element", async () => {
    s = await setupEdit(TABLE);
    tap(cellEl(1, 0));
    const td = cellEl(1, 0);
    const text = [...td.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.data === "b");
    text.data = "bb";
    td.dispatchEvent(new Event("input", { bubbles: true }));
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain(`a${ZWSP}bb`);
    expect(tableRaw()).not.toContain("<span");
    expect(cellEl(1, 0).textContent).toContain(ZWSP);
    expect(marksIn(cellEl(1, 0))).toEqual([["ZWSP", ZWSP]]);
  });
});

describe("AT-HID-09 INV-101 (4): marks in the code view, every time its lines are drawn", () => {
  const config = { codeView: { highlightWaitMs: 1 } };

  it("open, the edited text, the colors that came late; a U+FEFF at the text's start has none", async () => {
    const previewEl = document.createElement("div");
    const hljs = { getLanguage: () => ({}), highlight: (text) => ({ value: `<span class="hljs-string">${text}</span>` }) };
    const renderer = new SourceFileRenderer(config, previewEl, null, false, () => new Promise(() => {}));
    const text = `\ufeffa${ZWSP}b\nc${tags("hi")}d`;
    await renderer.render(new File(["x"], "a.py"), null, "dark", () => true, text);
    const lines = () => [...previewEl.querySelectorAll("#codeViewBody .code-line")];
    expect(lines().map((l) => l.textContent)).toEqual([`\ufeffa${ZWSP}b`, `c${tags("hi")}d`]);
    expect(marksIn(previewEl)).toEqual([["ZWSP", ZWSP], ["hidden: hi", tags("h").slice(0, 1)]]);
    renderer.useLibrary("hljs", hljs);
    renderer.recolor();
    expect(previewEl.querySelector(".hljs-string")).not.toBe(null);
    expect(marksIn(previewEl)).toEqual([["ZWSP", ZWSP], ["hidden: hi", tags("h").slice(0, 1)]]);
    renderer.showText(`x${RLO}y`);
    expect(marksIn(previewEl)).toEqual([["RLO", RLO]]);
    renderer.showText("plain");
    expect(marksIn(previewEl)).toEqual([]);
  });

  it("the line count and the lines' text do not change", async () => {
    const previewEl = document.createElement("div");
    const renderer = new SourceFileRenderer(config, previewEl, null, false);
    const meta = await renderer.render(new File(["x"], "a.txt"), null, "dark", () => true, `a${ZWSP}\n${RLO}b\n`);
    expect(meta.lineCount).toBe(3);
    expect(previewEl.querySelector("#codeViewBody").textContent).toBe(`a${ZWSP}${RLO}b`);
    expect(previewEl.querySelectorAll("span.grsmd-hidden-mark")).toHaveLength(2);
  });

  it("CONFIG has the toast's words (5.2)", () => {
    expect(CONFIG.messages.hiddenChars.found(1)).toBe("Hidden characters in 1 place. They are marked in the view.");
    expect(CONFIG.messages.hiddenChars.found(4)).toBe("Hidden characters in 4 places. They are marked in the view.");
  });
});
