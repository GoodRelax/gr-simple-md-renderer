import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import MarkdownRenderer from "../js/classes/MarkdownRenderer.js";
import MarkdownBlockModel from "../js/classes/MarkdownBlockModel.js";
import ScrollMemento from "../js/classes/ScrollMemento.js";
import DocumentIndex from "../js/classes/DocumentIndex.js";
import { CONFIG } from "../js/config.js";

// INV-77: the Index of the Markdown view (owner rulings T1 to T8, 2026-10-25).

const EMPTY = CONFIG.messages.index.empty;
/** Longer than a frame (nextFrame falls back to a 16 ms timer in jsdom). */
const frame = () => new Promise((r) => setTimeout(r, 40));

let preview;
let renderer;
let lexer;
let index;
let memento;
let els;

function setup() {
  const make = (tag, id) => Object.assign(document.createElement(tag), { id });
  els = {
    button: make("button", "indexBtn"),
    column: make("div", "sidePanels"),
    panel: make("nav", "indexPanel"),
    preview,
  };
  els.panel.hidden = true;
  els.column.append(els.panel);
  document.body.prepend(els.button);
  document.body.append(els.column);
  memento = new ScrollMemento(preview);
  index = new DocumentIndex(els, memento, { emptyText: EMPTY });
}

function render(body) {
  renderer.renderBlocks(MarkdownBlockModel.fromBody(body, lexer, 1));
}

/** A block as the renderer makes it, with one heading of the given level. */
function blockWith(level, text) {
  const block = document.createElement("div");
  block.className = "md-block";
  block.innerHTML = `<h${level}>${text}</h${level}>`;
  return block;
}

const entries = () => [...els.panel.querySelectorAll(".index-entry")];
const texts = () => entries().map((e) => e.textContent);

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  preview = Object.assign(document.createElement("div"), { id: "preview" });
  document.body.append(preview);
  const marked = new Marked();
  marked.use(markedKatex({ throwOnError: false }));
  lexer = (src) => marked.lexer(src);
  renderer = new MarkdownRenderer(preview, marked, hljs, DOMPurify);
  setup();
});

afterEach(() => {
  index.hide();
  preview.remove();
  els.button.remove();
  els.column.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DocumentIndex (INV-77)", () => {
  it("AT-IDX-01 (INV-77 (1)) lists h1 to h6 of the top-level blocks in order, with the level as a class", () => {
    render(
      "# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\n" +
        "> ## In a quote\n\n- item\n\n  ## In a list\n\n```\n# not a heading\n```\n\n" +
        '<div class="md-block"><h2>User block</h2></div>\n\nText\n\n## Last\n',
    );
    index.show();
    expect(texts()).toEqual(["One", "Two", "Three", "Four", "Five", "Six", "Last"]);
    expect(entries().map((e) => e.className)).toEqual([
      "index-entry index-h1",
      "index-entry index-h2",
      "index-entry index-h3",
      "index-entry index-h4",
      "index-entry index-h5",
      "index-entry index-h6",
      "index-entry index-h2",
    ]);
    expect(entries().every((e) => e.tagName === "BUTTON" && e.type === "button")).toBe(true);
  });

  it("AT-IDX-02 (INV-77 (1)) an entry reads the heading's text: math as TeX, no markup, spaces joined; an empty heading is left out", () => {
    render("## Heading with math $E = mc^2$ and **bold**\n\n##\n\n## Spaced   `code`  text\n");
    index.show();
    expect(texts()).toEqual(["Heading with math E = mc^2 and bold", "Spaced code text"]);
  });

  it("AT-IDX-03 (INV-77 (1)) a document with no heading shows the empty text, and only while there is none", async () => {
    render("Just a paragraph.\n");
    index.show();
    expect(entries()).toHaveLength(0);
    expect(els.panel.querySelector(".index-empty").textContent).toBe(EMPTY);
    expect(EMPTY).toBe("This document has no headings.");
    preview.append(blockWith(2, "Now one"));
    await frame();
    expect(texts()).toEqual(["Now one"]);
    expect(els.panel.querySelector(".index-empty")).toBeNull();
    preview.lastElementChild.remove();
    await frame();
    expect(els.panel.querySelector(".index-empty").textContent).toBe(EMPTY);
  });

  it("AT-IDX-04 (INV-77 (4) (7)) toggle shows and hides the panel and sets aria-expanded; hiding drops the list", () => {
    render("# A\n");
    index.toggle();
    expect(index.isShown()).toBe(true);
    expect(els.panel.hidden).toBe(false);
    expect(els.button.getAttribute("aria-expanded")).toBe("true");
    index.toggle();
    expect(index.isShown()).toBe(false);
    expect(els.panel.hidden).toBe(true);
    expect(els.button.getAttribute("aria-expanded")).toBe("false");
    expect(els.panel.children).toHaveLength(0);
    els.button.click();
    expect(index.isShown()).toBe(true);
  });

  it("AT-IDX-05 (INV-77 (5)) setAvailable(false) turns the button off and hides the panel; a disabled index does not show", () => {
    render("# A\n");
    index.show();
    index.setAvailable(false);
    expect(els.button.disabled).toBe(true);
    expect(index.isShown()).toBe(false);
    index.show();
    expect(index.isShown()).toBe(false);
    index.setAvailable(true);
    expect(els.button.disabled).toBe(true === false);
    index.show();
    expect(index.isShown()).toBe(true);
  });

  it("AT-IDX-06 (INV-77 (2)) while shown, only the blocks that changed get new entries, once a frame, in order; the others and the panel's scroll are kept; hidden, nothing is built", async () => {
    render("# A\n\n## B\n\n## C\n\n## D\n");
    // a list built again from nothing scrolls back to the top: the kept scroll must be put back
    const replaceChildren = els.panel.replaceChildren.bind(els.panel);
    let scroll = 0;
    Object.defineProperty(els.panel, "scrollTop", { configurable: true, get: () => scroll, set: (v) => (scroll = v) });
    els.panel.replaceChildren = (...nodes) => {
      replaceChildren(...nodes);
      scroll = 0;
    };
    index.show();
    const before = entries();
    els.panel.scrollTop = 5;

    // a commit: the block of "C" replaced by "C2", and a new block after "D"
    const blocks = [...preview.children];
    const entriesOf = vi.spyOn(index, "_entriesOf");
    blocks[2].replaceWith(blockWith(2, "C2"));
    preview.append(blockWith(3, "E"));
    blocks[0].before(blockWith(1, "Top"));
    await frame();
    expect(texts()).toEqual(["Top", "A", "B", "C2", "D", "E"]);
    expect(entriesOf).toHaveBeenCalledTimes(3); // the three new blocks only
    const after = entries();
    expect(after[1]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
    expect(after[4]).toBe(before[3]);
    expect(els.panel.scrollTop).toBe(5);

    // a full render builds all again and keeps the scroll too
    render("# X\n\n## Y\n");
    await frame();
    expect(texts()).toEqual(["X", "Y"]);
    expect(els.panel.scrollTop).toBe(5);

    index.hide();
    entriesOf.mockClear();
    render("# Other\n");
    await frame();
    expect(entriesOf).not.toHaveBeenCalled();
  });

  it("AT-IDX-07 (INV-77 (3)) pressing an entry asks ScrollMemento to put its heading 8 px below the top of what is shown", () => {
    render("# A\n\n## B\n");
    index.show();
    const scrollTargetTo = vi.spyOn(memento, "scrollTargetTo").mockImplementation(() => {});
    entries()[1].click();
    expect(scrollTargetTo).toHaveBeenCalledWith(preview.querySelector("h2"), 8);
  });

  it("AT-IDX-08 (INV-77 (3)) when the pressed entry's heading has left the document (rendered again), the list is built first and the same entry is used", () => {
    render("# A\n\n## B\n");
    index.show();
    const pressed = entries()[1];
    render("# A\n\n## B\n\n## C\n"); // the observer would build in the next frame
    const scrollTargetTo = vi.spyOn(memento, "scrollTargetTo").mockImplementation(() => {});
    pressed.click();
    expect(scrollTargetTo).toHaveBeenCalledWith(preview.querySelectorAll("h2")[0], 8);
    expect(texts()).toEqual(["A", "B", "C"]);
  });

  it("AT-IDX-09 (INV-77 (6)) the column goes under the top of what is shown at its right edge, down to the window's bottom, and again on a resize", () => {
    render("# A\n");
    const top = vi.spyOn(memento, "shownTop").mockReturnValue(50);
    vi.spyOn(memento, "shownRight").mockReturnValue(985);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(750);
    index.show();
    expect(els.column.style.top).toBe("54px");
    expect(els.column.style.right).toBe(`${1000 - 985 + 8}px`);
    expect(els.column.style.maxHeight).toBe(`${750 - 54 - 8}px`);
    top.mockReturnValue(70);
    window.dispatchEvent(new Event("resize"));
    expect(els.column.style.top).toBe("74px");
    index.hide();
    top.mockReturnValue(90);
    window.dispatchEvent(new Event("resize"));
    expect(els.column.style.top).toBe("74px"); // no longer listening
  });
});

describe("DocumentIndex code outline (INV-91)", () => {
  const OUTLINE = [
    { line: 0, level: 1, label: "import (2)" },
    { line: 2, level: 1, label: "class A" },
    { line: 3, level: 2, label: "run" },
  ];

  function viewLines(count) {
    preview.innerHTML = `<div id="codeViewBody">${'<span class="code-line">x</span>'.repeat(count)}</div>`;
  }

  it("AT-IDX-11 a code outline is listed as h1 / h2 entries; none: the code empty text; null: the headings again", () => {
    index = new DocumentIndex(els, memento, { emptyText: EMPTY, emptyCodeText: CONFIG.messages.index.emptyCode });
    const outline = { entries: vi.fn(() => OUTLINE), place: () => null };
    index.setCodeOutline(outline);
    index.show();
    expect(entries().map((e) => [e.className, e.textContent])).toEqual([
      ["index-entry index-h1", "import (2)"],
      ["index-entry index-h1", "class A"],
      ["index-entry index-h2", "run"],
    ]);
    outline.entries.mockReturnValue([]);
    index.refresh();
    expect([entries().length, els.panel.textContent]).toEqual([0, CONFIG.messages.index.emptyCode]);
    render("# Head\n");
    index.setCodeOutline(null);
    expect(texts()).toEqual(["Head"]);
  });

  it("AT-IDX-12 refresh builds a shown code list again (and only then); the preview's changes do not rebuild it", async () => {
    viewLines(3);
    const outline = { entries: vi.fn(() => OUTLINE), place: () => null };
    index.setCodeOutline(outline);
    index.refresh();
    expect(outline.entries).not.toHaveBeenCalled();
    index.show();
    viewLines(5);
    await frame();
    expect(outline.entries).toHaveBeenCalledTimes(1);
    outline.entries.mockReturnValue(OUTLINE.slice(1));
    index.refresh();
    expect(texts()).toEqual(["class A", "run"]);
  });

  it("AT-IDX-13 pressing an entry: in the view its code line goes 8 px below the top; in the editor the outline's place (its offset kept) and picked", () => {
    viewLines(4);
    const textarea = document.createElement("textarea");
    let editing = false;
    const outline = {
      entries: () => OUTLINE,
      place: (line) => (editing ? { element: textarea, offset: 8 + line * 20 } : null),
      picked: vi.fn(),
    };
    index.setCodeOutline(outline);
    index.show();
    const scrollTargetTo = vi.spyOn(memento, "scrollTargetTo").mockImplementation(() => {});
    entries()[1].click();
    expect(scrollTargetTo).toHaveBeenLastCalledWith(preview.querySelectorAll(".code-line")[2], 8);
    editing = true;
    entries()[2].click();
    expect(scrollTargetTo).toHaveBeenLastCalledWith(textarea, 8 - (8 + 3 * 20));
    expect(outline.picked.mock.calls).toEqual([[2], [3]]);
  });

  it("AT-IDX-14 (INV-91, N2) a refresh keeps the entries that did not change (the same nodes) and makes only the others; the kept ones follow their new lines", () => {
    viewLines(12);
    let list = [
      { line: 0, level: 1, label: "import (2)" },
      { line: 2, level: 1, label: "class A" },
      { line: 3, level: 2, label: "run" },
      { line: 5, level: 2, label: "stop" },
      { line: 8, level: 1, label: "function f()" },
    ];
    const outline = { entries: () => list, place: () => null, picked: vi.fn() };
    index.setCodeOutline(outline);
    index.show();
    const before = entries();
    // a line typed before "run" renamed it: the entries around it stay, all lines after it move by one
    list = [list[0], list[1], { line: 3, level: 2, label: "runs" }, { line: 6, level: 2, label: "stop" }, { line: 9, level: 1, label: "function f()" }];
    index.refresh();
    const after = entries();
    expect(after.map((e) => e.textContent)).toEqual(["import (2)", "class A", "runs", "stop", "function f()"]);
    expect(after.map((e, i) => e === before[i])).toEqual([true, true, false, true, true]);
    vi.spyOn(memento, "scrollTargetTo").mockImplementation(() => {});
    after[4].click();
    expect(outline.picked).toHaveBeenLastCalledWith(9);
    // the first entry removed, then one added at the end
    list = list.slice(1);
    index.refresh();
    expect(entries()).toEqual(after.slice(1));
    list = [...list, { line: 11, level: 1, label: "function g()" }];
    index.refresh();
    expect(entries().map((e) => e.textContent)).toEqual(["class A", "runs", "stop", "function f()", "function g()"]);
    expect(entries().slice(0, 4).every((e, i) => e === after[i + 1])).toBe(true);
    // hidden and shown again: all made anew
    index.hide();
    index.show();
    expect(entries()[0]).not.toBe(after[1]);
    expect(entries()).toHaveLength(5);
  });
});
