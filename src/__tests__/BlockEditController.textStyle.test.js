import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return { ...actual, applyTheme: vi.fn(), waitForDOMStability: vi.fn().mockResolvedValue(true) };
});

import BlockCaretMap from "../js/classes/BlockCaretMap.js";
import { setupEdit } from "./helpers/editStack.js";
import { tap } from "./helpers/editDom.js";

// INV-83: a block editor takes its text style from the rendered block.
// INV-84: the caret where the block was pressed. INV-40: fitting the
// height does not move the scroll.

const DOC = "# Title\n\nHello world.\n\n```\ncode here\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
const isType = (type) => (b) => b.type === type;

/** Computed styles as the browser would give them for the rendered elements (jsdom has none). */
const STYLES = {
  P: { fontFamily: "BodySans", fontSize: "16px", fontWeight: "400", fontStyle: "normal", lineHeight: "normal", letterSpacing: "normal", marginTop: "16px", marginBottom: "16px" },
  H1: { fontFamily: "BodySans", fontSize: "32px", fontWeight: "700", fontStyle: "normal", lineHeight: "normal", letterSpacing: "normal", marginTop: "21.44px", marginBottom: "21.44px" },
  CODE: { fontFamily: "CodeMono", fontSize: "13px", fontWeight: "400", fontStyle: "normal", lineHeight: "normal", letterSpacing: "normal" },
  PRE: { marginTop: "16px", marginBottom: "16px", paddingTop: "16px", paddingRight: "16px", paddingBottom: "16px", paddingLeft: "16px" },
  LI: { fontFamily: "BodySans", fontSize: "15px", fontWeight: "400", fontStyle: "normal", lineHeight: "24px", letterSpacing: "normal" },
  UL: { marginTop: "12px", marginBottom: "12px" },
  BLOCKQUOTE: { fontFamily: "BodySans", fontSize: "16px", fontWeight: "400", fontStyle: "normal", lineHeight: "normal", letterSpacing: "normal", marginTop: "8px", marginBottom: "8px" },
  // #preview itself: the body text, for a block that has no rendering yet
  DIV: { fontFamily: "BodySans", fontSize: "16px", fontWeight: "400", fontStyle: "normal", lineHeight: "24px", letterSpacing: "normal" },
};
const LIST_DOC = "- one item\n- two items\n\n> quoted words\n";

let s;
afterEach(() => {
  s?.teardown();
  s = null;
  vi.restoreAllMocks();
});

function fakeComputedStyles() {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el) => (el.closest?.("#preview") && STYLES[el.tagName]) || real(el));
}

function open(pred) {
  const { block, el } = s.block(pred);
  tap(el.querySelector(":scope > .grsmd-table-tab") ?? el.firstElementChild ?? el);
  return { block, el, ta: s.editor() };
}

describe("AT-BEC-TS INV-83 the editor takes the rendered block's text style", () => {
  it("AT-BEC-TS-01 a paragraph: the body text's font, size, weight, line height and margins", async () => {
    s = await setupEdit(DOC);
    fakeComputedStyles();
    const { ta } = open(isType("paragraph"));
    expect(ta.style.fontFamily).toBe("BodySans");
    expect(ta.style.fontSize).toBe("16px");
    expect(ta.style.lineHeight).toBe("normal");
    expect(ta.style.marginTop).toBe("16px");
    expect(ta.style.paddingTop).toBe(""); // style.css: no padding
  });

  it("AT-BEC-TS-02 a heading: its own size and weight", async () => {
    s = await setupEdit(DOC);
    fakeComputedStyles();
    const { ta } = open(isType("heading"));
    expect(ta.style.fontSize).toBe("32px");
    expect(ta.style.fontWeight).toBe("700");
  });

  it("AT-BEC-TS-03 a code block: the code's font and size, and the box's padding", async () => {
    s = await setupEdit(DOC);
    fakeComputedStyles();
    const { ta } = open(isType("code"));
    expect(ta.style.fontFamily).toBe("CodeMono");
    expect(ta.style.fontSize).toBe("13px");
    expect(ta.style.paddingLeft).toBe("16px");
  });

  it("AT-BEC-TS-04 a table's source keeps the monospace of style.css (INV-61)", async () => {
    s = await setupEdit(DOC);
    fakeComputedStyles();
    const { ta } = open(isType("table"));
    expect(ta.value).toMatch(/^\| a/);
    expect(ta.style.fontFamily).toBe("");
    expect(ta.style.fontSize).toBe("");
  });

  it("AT-BEC-TS-10 a list: the item's text style and the list's margins", async () => {
    s = await setupEdit(LIST_DOC);
    fakeComputedStyles();
    const { ta } = open(isType("list"));
    expect(ta.style.fontFamily).toBe("BodySans");
    expect(ta.style.fontSize).toBe("15px");
    expect(ta.style.lineHeight).toBe("24px");
    expect(ta.style.marginTop).toBe("12px");
    expect(ta.style.paddingTop).toBe("");
  });

  it("AT-BEC-TS-11 a quote: its paragraph's text style and the quote's margins", async () => {
    s = await setupEdit(LIST_DOC);
    fakeComputedStyles();
    const { ta } = open(isType("blockquote"));
    expect(ta.value).toMatch(/^> quoted/);
    expect(ta.style.fontFamily).toBe("BodySans");
    expect(ta.style.marginTop).toBe("8px");
  });

  it("AT-BEC-TS-12 a new block from a gap: the body text (ESF-7)", async () => {
    s = await setupEdit(DOC);
    fakeComputedStyles();
    const blocks = s.orchestrator.getModel().getBlocks();
    s.bec.dispatch("gapInsertRequested", { kind: "gap", afterBlockId: blocks[0].id, beforeBlockId: blocks[1].id });
    const ta = s.editor();
    expect(ta.value).toBe("");
    expect(ta.style.fontFamily).toBe("BodySans");
    expect(ta.style.lineHeight).toBe("24px");
  });

  it("AT-BEC-TS-13 the first block of an empty document: the body text (ESF-7)", async () => {
    s = await setupEdit(null, { editMode: false });
    fakeComputedStyles();
    await s.bec.dispatch("emptyDocumentStarted");
    const ta = s.editor();
    expect(ta.value).toBe("");
    expect(ta.style.fontFamily).toBe("BodySans");
    expect(ta.style.fontSize).toBe("16px");
  });
});

describe("AT-BEC-TS INV-84 the caret where the block was pressed", () => {
  it("AT-BEC-TS-05 the press's place in the rendered text becomes the caret in the source", async () => {
    s = await setupEdit(DOC);
    fakeComputedStyles();
    // right after "Hello" (5 characters, no whitespace before the caret)
    const pointAt = vi.spyOn(BlockCaretMap, "pointAt").mockReturnValue({ count: 5, afterSpace: false, lineOffset: 0, index: 5, text: "Hello world." });
    const { ta } = open(isType("paragraph"));
    expect(pointAt).toHaveBeenCalled();
    expect(ta.selectionStart).toBe(5);
    expect(ta.selectionEnd).toBe(5);
  });

  it("AT-BEC-TS-06 a press off the text: the caret stays at the end, as before", async () => {
    s = await setupEdit(DOC);
    fakeComputedStyles();
    vi.spyOn(BlockCaretMap, "pointAt").mockReturnValue(null);
    const { ta } = open(isType("paragraph"));
    expect(ta.selectionStart).toBe(ta.value.length);
  });
});

describe("AT-BEC-TS INV-40 fitting the height keeps the scroll", () => {
  /** The view was last seen at seen (a scroll the browser reported); while the editor is measured it is at now. */
  function scrolled(seen, now) {
    const save = vi.spyOn(s.scrollMemento, "save").mockReturnValue(seen);
    s.preview.dispatchEvent(new Event("scroll"));
    save.mockReturnValue(now);
    return save;
  }

  it("AT-BEC-TS-07 a scroll the browser pulled back to the end while the editor was short is put back", async () => {
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    scrolled(120, 95); // jsdom: the end of the view is 0, so 95 is at the end
    const restore = vi.spyOn(s.scrollMemento, "restore").mockImplementation(() => {});
    ta.value += " more";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    expect(restore).toHaveBeenCalledWith(120);
  });

  it("AT-BEC-TS-08 an unmoved scroll is left alone, and the position is read once per key, after the measure", async () => {
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    const save = scrolled(120, 120);
    save.mockClear();
    const restore = vi.spyOn(s.scrollMemento, "restore").mockImplementation(() => {});
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    expect(restore).not.toHaveBeenCalled();
    // the position before is the one noted at the last scroll (no layout of
    // the document before the measure, INV-40, G10)
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("AT-BEC-TS-09 a scroll of the browser's own is kept: down to show the caret, or up away from the end", async () => {
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    const restore = vi.spyOn(s.scrollMemento, "restore").mockImplementation(() => {});
    scrolled(120, 150);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    Object.defineProperty(s.preview, "scrollHeight", { value: 600, configurable: true });
    Object.defineProperty(s.preview, "clientHeight", { value: 100, configurable: true });
    scrolled(120, 95); // the end is 500: not pulled back
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    expect(restore).not.toHaveBeenCalled();
  });
});
