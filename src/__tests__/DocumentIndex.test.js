import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import MarkdownRenderer from "../js/classes/MarkdownRenderer.js";
import MarkdownBlockModel from "../js/classes/MarkdownBlockModel.js";
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
let els;

function setup() {
  const make = (tag, id) => Object.assign(document.createElement(tag), { id });
  els = {
    topbar: make("div", "topbar"),
    button: make("button", "indexBtn"),
    column: make("div", "sidePanels"),
    panel: make("nav", "indexPanel"),
    preview,
  };
  els.panel.hidden = true;
  els.column.append(els.panel);
  els.topbar.append(els.button);
  document.body.prepend(els.topbar);
  document.body.append(els.column);
  index = new DocumentIndex(els, { emptyText: EMPTY });
}

function render(body) {
  renderer.renderBlocks(MarkdownBlockModel.fromBody(body, lexer, 1));
}

const entries = () => [...els.panel.querySelectorAll(".index-entry")];
const texts = () => entries().map((e) => e.textContent);
const rect = (top, bottom = top + 20, left = 0, right = 800) => () => ({ top, bottom, left, right, width: right - left, height: bottom - top });

beforeEach(() => {
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
  els.topbar.remove();
  els.column.remove();
  vi.restoreAllMocks();
});

describe("DocumentIndex (INV-77)", () => {
  it("AT-IDX-01 lists h1 to h6 of the top-level blocks in order, with the level as a class", () => {
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

  it("AT-IDX-02 an entry reads the heading's text: math as TeX, no markup, spaces joined; an empty heading is left out", () => {
    render("## Heading with math $E = mc^2$ and **bold**\n\n##\n\n## Spaced   `code`  text\n");
    index.show();
    expect(texts()).toEqual(["Heading with math E = mc^2 and bold", "Spaced code text"]);
  });

  it("AT-IDX-03 a document with no heading shows the empty text", () => {
    render("Just a paragraph.\n");
    index.show();
    expect(entries()).toHaveLength(0);
    expect(els.panel.querySelector(".index-empty").textContent).toBe(EMPTY);
    expect(EMPTY).toBe("This document has no headings.");
  });

  it("AT-IDX-04 toggle shows and hides the panel and sets aria-expanded; hiding drops the list", () => {
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

  it("AT-IDX-05 setAvailable(false) turns the button off and hides the panel; a disabled index does not show", () => {
    render("# A\n");
    index.show();
    index.setAvailable(false);
    expect(els.button.disabled).toBe(true);
    expect(index.isShown()).toBe(false);
    index.show();
    expect(index.isShown()).toBe(false);
    index.setAvailable(true);
    expect(els.button.disabled).toBe(false);
    index.show();
    expect(index.isShown()).toBe(true);
  });

  it("AT-IDX-06 while shown, a change of the top-level blocks builds the list again once per frame and keeps its scroll; hidden, nothing is built", async () => {
    render("# A\n\n## B\n");
    index.show();
    els.panel.scrollTop = 5;
    const build = vi.spyOn(index, "_build");
    render("# A\n\n## B2\n\n## C\n");
    render("# A\n\n## B3\n\n## C\n");
    await frame();
    expect(build).toHaveBeenCalledTimes(1);
    expect(texts()).toEqual(["A", "B3", "C"]);
    expect(els.panel.scrollTop).toBe(5);
    index.hide();
    build.mockClear();
    render("# Other\n");
    await frame();
    expect(build).not.toHaveBeenCalled();
  });

  it("AT-IDX-07 pressing an entry scrolls its heading 8 px below the top of the view (#preview, or the page under the top bar)", () => {
    render("# A\n\n## B\n");
    index.show();
    const heading = preview.querySelectorAll("h2")[0];
    heading.getBoundingClientRect = rect(500);
    preview.getBoundingClientRect = rect(60);
    preview.scrollBy = vi.fn();
    entries()[1].click();
    expect(preview.scrollBy).toHaveBeenCalledWith(0, 500 - 60 - 8);

    // touch layout (FS-15): the page scrolls, the sticky top bar covers its top
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ overflowY: "visible" });
    els.topbar.getBoundingClientRect = rect(0, 70);
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    entries()[1].click();
    expect(scrollBy).toHaveBeenCalledWith(0, 500 - 70 - 8);
  });

  it("AT-IDX-08 when the pressed entry's heading has left the document (rendered again), the list is built first and the same entry is used", () => {
    render("# A\n\n## B\n");
    index.show();
    const pressed = entries()[1];
    render("# A\n\n## B\n\n## C\n"); // the observer would build in the next frame
    preview.scrollBy = vi.fn();
    preview.getBoundingClientRect = rect(0);
    const fresh = preview.querySelectorAll("h2")[0];
    fresh.getBoundingClientRect = rect(300);
    pressed.click();
    expect(preview.scrollBy).toHaveBeenCalledWith(0, 300 - 0 - 8);
    expect(texts()).toEqual(["A", "B", "C"]);
  });

  it("AT-IDX-09 the column goes under the top bar at the right edge of the view, down to the window's bottom", () => {
    render("# A\n");
    els.topbar.getBoundingClientRect = rect(0, 50);
    preview.getBoundingClientRect = rect(50, 750, 0, 1000);
    Object.defineProperty(preview, "clientWidth", { configurable: true, value: 985 });
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(750);
    index.show();
    expect(els.column.style.top).toBe("54px");
    expect(els.column.style.right).toBe(`${1000 - 985 + 8}px`);
    expect(els.column.style.maxHeight).toBe(`${750 - 54 - 8}px`);
  });
});
