import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import MarkdownRenderer from "../js/classes/MarkdownRenderer.js";
import MarkdownBlockModel from "../js/classes/MarkdownBlockModel.js";
import DocumentSearch, { TYPING_PAUSE_MS, REGEX_TYPING_PAUSE_MS } from "../js/classes/DocumentSearch.js";
import { CONFIG } from "../js/config.js";

// INV-80: Search (owner rulings S1 to S14, 2026-10-25) on the real renderer.
// jsdom has no CSS Custom Highlight API and no scrollIntoView: small stubs
// stand in for them.

const M = CONFIG.messages.search;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Longer than a frame (nextFrame falls back to a 16 ms timer in jsdom). */
const frame = () => wait(40);

let preview;
let renderer;
let lexer;
let model;
let search;
let els;
let host;
let replaced;

class FakeHighlight {
  constructor(...ranges) {
    this.ranges = ranges;
  }
}

function render(body) {
  model = MarkdownBlockModel.fromBody(body, lexer, 1);
  renderer.renderBlocks(model);
}

function setup() {
  const make = (tag, id, attrs = {}) => Object.assign(document.createElement(tag), { id }, attrs);
  els = {
    topbar: make("div", "topbar"),
    button: make("button", "searchBtn"),
    column: make("div", "sidePanels"),
    panel: make("div", "searchPanel"),
    preview,
    input: make("input", "searchInput"),
    matchCase: make("button", "searchCase"),
    regex: make("button", "searchRegex"),
    count: make("span", "searchCount"),
    prev: make("button", "searchPrev"),
    next: make("button", "searchNext"),
    close: make("button", "searchClose"),
    replaceRow: make("div", "replaceRow"),
    replaceInput: make("input", "replaceInput"),
    replaceOne: make("button", "replaceOneBtn"),
    replaceAll: make("button", "replaceAllBtn"),
  };
  els.panel.hidden = true;
  els.matchCase.setAttribute("aria-pressed", "false");
  els.regex.setAttribute("aria-pressed", "false");
  els.replaceRow.append(els.replaceInput, els.replaceOne, els.replaceAll);
  els.panel.append(els.input, els.matchCase, els.regex, els.count, els.prev, els.next, els.close, els.replaceRow);
  els.column.append(els.panel);
  els.topbar.append(els.button);
  document.body.prepend(els.topbar);
  document.body.append(els.column);
  replaced = [];
  host = { beforeReplace: vi.fn(() => true), toast: vi.fn() };
  const documents = {
    getModel: () => model,
    blockElement: (id) => renderer.getBlockElement(id),
    replaceBody: vi.fn((body, offset) => {
      replaced.push({ body, offset });
      render(body); // as the orchestrator does; UIController.onModelChanged refreshes
      search.refresh();
      return Promise.resolve();
    }),
  };
  search = new DocumentSearch(els, documents, host, M);
  search.documents = documents;
}

function type(value) {
  els.input.value = value;
  els.input.dispatchEvent(new Event("input", { bubbles: true }));
}

function key(name, target = els.input) {
  const e = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

const marked = () => preview.querySelector(".search-hit");
const current = () => [...(CSS.highlights.get("grsmd-search-current")?.ranges ?? [])].map((r) => r.toString());

beforeEach(() => {
  preview = Object.assign(document.createElement("div"), { id: "preview" });
  preview.scrollBy = vi.fn();
  document.body.append(preview);
  const markedLib = new Marked();
  markedLib.use(markedKatex({ throwOnError: false }));
  lexer = (src) => markedLib.lexer(src);
  renderer = new MarkdownRenderer(preview, markedLib, hljs, DOMPurify);
  vi.stubGlobal("Highlight", FakeHighlight);
  vi.stubGlobal("CSS", { highlights: new Map() });
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  setup();
  search.setMode("markdown");
  search.setReplaceEnabled(true);
});

afterEach(() => {
  search.hide();
  preview.remove();
  els.topbar.remove();
  els.column.remove();
  delete Element.prototype.scrollIntoView;
  delete Range.prototype.getBoundingClientRect;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DOC = "# Alpha\n\nThe cat sat.\n\n## Beta\n\nA cat and a cat.\n\n```js\nconst cat = 1;\n```\n";

describe("DocumentSearch (INV-80)", () => {
  it("AT-SRCH-06 a plain query is searched at each key and the view moves when typing stops; a regular expression is searched only then (S13); an invalid one says so", async () => {
    render(DOC);
    search.open();
    expect(document.activeElement).toBe(els.input);
    type("cat");
    expect(els.count.textContent).toBe("4"); // the code block's source counts too (S3)
    expect(marked()).toBeNull();
    await wait(TYPING_PAUSE_MS + 50);
    expect(els.count.textContent).toBe(M.count(1, "4"));
    expect(marked().textContent).toContain("The cat sat.");

    els.regex.click(); // a toggle searches again at once
    expect(els.count.textContent).toBe(M.count(1, "4"));
    type("^## (\\w+)$");
    expect(els.count.textContent).toBe("");
    await wait(REGEX_TYPING_PAUSE_MS - 100);
    expect(els.count.textContent).toBe("");
    await wait(200);
    expect(els.count.textContent).toBe(M.count(1, "1"));
    expect(marked().textContent.trim()).toBe("Beta");

    type("(");
    await wait(REGEX_TYPING_PAUSE_MS + 50);
    expect(els.count.textContent).toBe(M.invalid);
    expect(marked()).toBeNull();
    type("zzz");
    await wait(REGEX_TYPING_PAUSE_MS + 50);
    expect(els.count.textContent).toBe(M.none);
  });

  it("AT-SRCH-07 Down / Up and the buttons go next / previous round the ends; Up with none chosen goes to the last; held keys move once a frame; Enter does nothing (S7)", async () => {
    render(DOC);
    search.open();
    type("cat");
    key("ArrowUp");
    await frame();
    expect(els.count.textContent).toBe(M.count(4, "4"));
    key("ArrowDown");
    await frame();
    expect(els.count.textContent).toBe(M.count(1, "4"));

    const go = vi.spyOn(search, "_go");
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowDown");
    expect(go).not.toHaveBeenCalled();
    await frame();
    expect(go).toHaveBeenCalledTimes(1);
    expect(els.count.textContent).toBe(M.count(4, "4"));
    els.next.click();
    await frame();
    expect(els.count.textContent).toBe(M.count(1, "4"));
    els.prev.click();
    await frame();
    expect(els.count.textContent).toBe(M.count(4, "4"));

    const enter = key("Enter");
    const enterInReplace = key("Enter", els.replaceInput);
    await frame();
    expect(els.count.textContent).toBe(M.count(4, "4"));
    expect(enter.defaultPrevented).toBe(false);
    expect(enterInReplace.defaultPrevented).toBe(false);
    expect(host.beforeReplace).not.toHaveBeenCalled(); // S12
  });

  it("AT-SRCH-08 the block of the match is marked and the n-th place of the text in it is the current one, also in a big table; a match across cells goes to its row", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => `| r${i} | value ${i % 10} |`).join("\n");
    render(`# T\n\n| No | Value |\n| --- | --- |\n${rows}\n`);
    search.open();
    type("value 7");
    await wait(TYPING_PAUSE_MS + 50);
    for (let i = 0; i < 2; i++) key("ArrowDown");
    await frame();
    expect(els.count.textContent).toBe(M.count(3, "3"));
    expect(marked().querySelector("table")).not.toBeNull();
    const hl = CSS.highlights.get("grsmd-search-current").ranges[0];
    expect(hl.toString()).toBe("value 7");
    expect(hl.startContainer.parentElement.closest("tr").cells[0].textContent).toBe("r27");
    expect(CSS.highlights.get("grsmd-search").ranges).toHaveLength(2); // the other places of the block
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(preview.scrollBy).toHaveBeenCalled();

    // the rendered text does not read "r12 | value" (two cells): its row instead
    const scrolledTo = [];
    vi.spyOn(HTMLTableRowElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      scrolledTo.push(this.cells[0].textContent);
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    });
    type("r12 | value");
    await wait(TYPING_PAUSE_MS + 50);
    expect(current()).toEqual([]);
    expect(scrolledTo).toContain("r12");
  });

  it("AT-SRCH-09 replacing: edit mode only (S4), the open edits first (beforeReplace), Replace moves on past the new text, All counts in a toast; a plain template is literal", async () => {
    render(DOC);
    search.open();
    type("cat");
    await wait(TYPING_PAUSE_MS + 50);
    els.replaceInput.value = "dogs $&";

    search.setReplaceEnabled(false);
    els.replaceOne.click();
    expect(host.beforeReplace).not.toHaveBeenCalled();
    expect(els.replaceInput.disabled && els.replaceOne.disabled && els.replaceAll.disabled).toBe(true);
    search.setReplaceEnabled(true);

    host.beforeReplace.mockReturnValueOnce(false); // INV-56 canceled
    els.replaceOne.click();
    expect(replaced).toEqual([]);

    els.replaceOne.click(); // the 1st of 4: "The cat sat."
    await frame();
    expect(replaced[0].body).toContain("The dogs $& sat.");
    expect(replaced[0].offset).toBe(DOC.indexOf("cat"));
    expect(els.count.textContent).toBe(M.count(1, "3")); // the next one, not the new text
    expect(marked().textContent).toContain("A cat and a cat.");

    const afterOne = replaced[0].body;
    els.replaceAll.click();
    expect(replaced[1].body).toBe(afterOne.replace(/cat/gi, () => "dogs $&"));
    expect(host.toast).toHaveBeenLastCalledWith(M.replaced(3));
    expect(M.replaced(3)).toBe("Replaced 3.");
    expect(els.count.textContent).toBe(M.none);

    // a replacement that matches again: Replace goes on past it, not into it
    render("cat cat\n");
    type("cat");
    await wait(TYPING_PAUSE_MS + 50);
    els.replaceInput.value = "cats";
    els.replaceOne.click();
    await frame();
    expect(replaced[2].body).toBe("cats cat\n");
    expect(els.count.textContent).toBe(M.count(2, "2"));
  });

  it("AT-SRCH-10 setMode: off and closed in the initial state, no replace row in the code view, which searches its lines; Esc in the panel closes it (S11); nothing is stored", async () => {
    const stored = localStorage.length;
    render(DOC);
    search.open();
    type("cat");
    await wait(TYPING_PAUSE_MS + 50);
    expect(marked()).not.toBeNull();
    const esc = key("Escape");
    expect(esc.defaultPrevented).toBe(true);
    expect(search.isShown()).toBe(false);
    expect(marked()).toBeNull();
    expect(CSS.highlights.size).toBe(0);
    expect(els.button.getAttribute("aria-expanded")).toBe("false");

    preview.innerHTML = '<div id="codeViewBody"><span class="code-line">let a = 1;</span><span class="code-line">let cat = 2;</span><span class="code-line">cat++;</span></div>';
    search.setMode("code");
    expect(els.replaceRow.hidden).toBe(true);
    search.open();
    type("cat");
    await wait(TYPING_PAUSE_MS + 50);
    expect(els.count.textContent).toBe(M.count(1, "2"));
    expect(marked().textContent).toBe("let cat = 2;");
    key("ArrowDown");
    await frame();
    expect(marked().textContent).toBe("cat++;");

    search.setMode("initial");
    expect(search.isShown()).toBe(false);
    expect(els.button.disabled).toBe(true);
    search.open();
    expect(search.isShown()).toBe(false);
    expect(localStorage.length).toBe(stored);
  });
});
