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
};

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
  it("AT-BEC-TS-07 a scroll the browser pulled back while the editor was short is put back", async () => {
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    vi.spyOn(s.scrollMemento, "save").mockReturnValueOnce(120).mockReturnValueOnce(95);
    const restore = vi.spyOn(s.scrollMemento, "restore").mockImplementation(() => {});
    ta.value += " more";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    expect(restore).toHaveBeenCalledWith(120);
  });

  it("AT-BEC-TS-08 an unmoved scroll is left alone", async () => {
    s = await setupEdit(DOC);
    const { ta } = open(isType("paragraph"));
    vi.spyOn(s.scrollMemento, "save").mockReturnValue(120);
    const restore = vi.spyOn(s.scrollMemento, "restore").mockImplementation(() => {});
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    expect(restore).not.toHaveBeenCalled();
  });
});
