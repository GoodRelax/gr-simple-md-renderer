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

describe("AT-BEC-TS INV-40 fitting the height and typing do not move the view", () => {
  /** The heights the editor is given, in order, from now on. */
  function heightsOf(ta) {
    const heights = [];
    const style = ta.style;
    const setProperty = style.setProperty.bind(style);
    Object.defineProperty(style, "height", {
      configurable: true,
      get: () => style.getPropertyValue("height"),
      set: (value) => {
        heights.push(value);
        setProperty("height", value);
      },
    });
    return heights;
  }

  /** From now on, scrollHeight of a textarea is 20 px per line of its value. */
  function linesHigh() {
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.value.split("\n").length * 20;
      },
    });
  }

  /** Type text at the caret as the browser does: the caret ends after it. */
  function typeAtCaret(ta, text) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  afterEach(() => {
    delete HTMLTextAreaElement.prototype.scrollHeight;
  });

  it("AT-BEC-TS-07 an input that only adds text never makes the editor shorter to measure it (the iPad, beta2)", async () => {
    linesHigh();
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    const heights = heightsOf(ta);
    typeAtCaret(ta, "x");
    typeAtCaret(ta, "\nmore");
    ta.setSelectionRange(0, 0);
    typeAtCaret(ta, "first\n"); // at the start too
    expect(heights).toEqual(["20px", "40px", "60px"]);
  });

  it("AT-BEC-TS-08 the view is read once per key, in the layout of the measure; an unmoved view is not put back", async () => {
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    const steps = [];
    Object.defineProperty(ta, "scrollHeight", { configurable: true, get: () => (steps.push("measure"), 20) });
    vi.spyOn(s.scrollMemento, "save").mockImplementation(() => (steps.push("view"), 0));
    const heights = heightsOf(ta);
    const restore = vi.spyOn(s.scrollMemento, "restore");
    const caret = vi.spyOn(BlockCaretMap, "caretOffsetIn");
    typeAtCaret(ta, " more");
    // the view before the input is the one noted at the last scroll (G10)
    expect(steps).toEqual(["measure", "view"]);
    expect(heights).toEqual(["20px"]);
    expect(restore).not.toHaveBeenCalled();
    expect(caret).not.toHaveBeenCalled(); // nothing more is laid out
  });

  it("AT-BEC-TS-09 an input that takes text away is measured short; during an IME composition the editor only grows, and its end fits it in full", async () => {
    linesHigh();
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    typeAtCaret(ta, "\na\nb");
    const heights = heightsOf(ta);
    // a deletion (Backspace) and a replacement of a selection
    ta.setRangeText("", ta.selectionStart - 2, ta.selectionStart, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.setSelectionRange(0, 3);
    typeAtCaret(ta, "Z");
    expect(heights).toEqual(["auto", "40px", "auto", "40px"]);
    heights.length = 0;
    ta.dispatchEvent(new Event("compositionstart"));
    typeAtCaret(ta, "\nka");
    ta.setRangeText("\u304b", ta.selectionStart - 2, ta.selectionStart, "end"); // the composed text replaces what was typed
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    expect(heights).toEqual(["60px", "60px"]);
    ta.dispatchEvent(new Event("compositionend"));
    expect(heights).toEqual(["60px", "60px", "auto", "60px"]);
  });

  it("AT-BEC-TS-09 the same text again (a second fit after an edit put in) is not measured short", async () => {
    linesHigh();
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    const heights = heightsOf(ta);
    typeAtCaret(ta, "x");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    expect(heights).toEqual(["20px", "20px"]);
  });

  /**
   * The view was last seen at seen (a scroll the browser reported); the input
   * leaves it at now. The caret's line is lineTop below the editor's top,
   * which is at editorTop on screen; lines are 20 px; what is shown runs
   * from shown[0] to shown[1].
   */
  function movedByInput(ta, { seen, now, lineTop, editorTop, shown }) {
    const save = vi.spyOn(s.scrollMemento, "save").mockReturnValue(seen);
    s.preview.dispatchEvent(new Event("scroll"));
    save.mockReturnValue(now);
    vi.spyOn(BlockCaretMap, "caretOffsetIn").mockReturnValue(lineTop);
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el) => (el === ta ? { lineHeight: "20px", fontSize: "16px" } : real(el)));
    ta.getBoundingClientRect = () => ({ top: editorTop, bottom: editorTop + 400, left: 0, right: 100, width: 100, height: 400 });
    vi.spyOn(s.scrollMemento, "shownTop").mockReturnValue(shown[0]);
    vi.spyOn(s.scrollMemento, "shownBottom").mockReturnValue(shown[1]);
    const restore = vi.spyOn(s.scrollMemento, "restore").mockImplementation(() => {});
    ta.value += " more";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return restore;
  }

  it("AT-BEC-TS-16 the input moved the view, and the caret's line is in view where it was: it goes back there (WebKit, Chromium's anchoring)", async () => {
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    // moved down 280: with the view back, the caret's line is at 100 + 50 + 280 = 430
    const restore = movedByInput(ta, { seen: 120, now: 400, lineTop: 50, editorTop: 100, shown: [0, 600] });
    expect(BlockCaretMap.caretOffsetIn).toHaveBeenCalledWith(ta, ta.selectionEnd, expect.any(Number));
    expect(restore).toHaveBeenCalledWith(120);
  });

  it("AT-BEC-TS-17 the caret's line would end below what is shown where the view was: back, then the least that shows it", async () => {
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    // the line would end at 100 + 50 + 280 + 20 = 450, 10 below 440
    expect(movedByInput(ta, { seen: 120, now: 400, lineTop: 50, editorTop: 100, shown: [0, 440] })).toHaveBeenCalledWith(130);
  });

  it("AT-BEC-TS-17 the caret's line would be above what is shown where the view was: back, then the least that shows it", async () => {
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    // moved up 280: the line would be at 100 + 50 - 280 = -130, 130 above 0
    expect(movedByInput(ta, { seen: 400, now: 120, lineTop: 50, editorTop: 100, shown: [0, 600] })).toHaveBeenCalledWith(270);
  });

  it("AT-BEC-TS-17 the browser moved the view by just that least (a line at the bottom edge): nothing more", async () => {
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    // moved down 18: the line would end at 370 + 50 + 18 + 20 = 458, 18 below 440
    expect(movedByInput(ta, { seen: 120, now: 138, lineTop: 50, editorTop: 370, shown: [0, 440] })).not.toHaveBeenCalled();
  });

  it("AT-BEC-TS-18 a caret too far into a wrapping text to be measured: the move stays", async () => {
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    expect(movedByInput(ta, { seen: 120, now: 400, lineTop: null, editorTop: 100, shown: [0, 600] })).not.toHaveBeenCalled();
  });

  it("AT-BEC-TS-19 a caret too far to be measured, and the view pulled back to the end while the editor was short: it goes back (ESF-1, ESF-8)", async () => {
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    // jsdom: the view's end is 0, so 95 (above 120) is at the end
    expect(movedByInput(ta, { seen: 120, now: 95, lineTop: null, editorTop: 100, shown: [0, 600] })).toHaveBeenCalledWith(120);
  });

  it("AT-BEC-TS-19 a caret too far to be measured, and the view above where it was but not at the end: the move stays", async () => {
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    Object.defineProperty(s.preview, "scrollHeight", { value: 600, configurable: true });
    Object.defineProperty(s.preview, "clientHeight", { value: 100, configurable: true });
    expect(movedByInput(ta, { seen: 120, now: 95, lineTop: null, editorTop: 100, shown: [0, 600] })).not.toHaveBeenCalled();
  });

  it("AT-BEC-TS-20 the editor got wider (an iPad turned, a window widened): the next added letter measures it short, as fewer lines may wrap", async () => {
    linesHigh();
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    let width = 300;
    Object.defineProperty(ta, "clientWidth", { configurable: true, get: () => width });
    typeAtCaret(ta, "x"); // the width is noted at this fit
    const heights = heightsOf(ta);
    typeAtCaret(ta, "y");
    expect(heights).toEqual(["20px"]);
    width = 500;
    typeAtCaret(ta, "z");
    expect(heights).toEqual(["20px", "auto", "20px"]);
  });
});
