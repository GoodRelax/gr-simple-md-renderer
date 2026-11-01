import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return { ...actual, applyTheme: vi.fn(), waitForDOMStability: vi.fn().mockResolvedValue(true) };
});

import { setupEdit } from "./helpers/editStack.js";
import { pointer, tap, keydown } from "./helpers/editDom.js";

// INV-69 in the editors: Ctrl+V / Cmd+V on selected text with a URL makes a
// link (no permission; the paste event's text/plain only); otherwise the
// paste is the browser's (block editor) or text (INV-63, a cell). The
// palette's buttons (pasteLink / removeLink) and the edit generation the
// button's wait is checked against.

let s;
afterEach(() => {
  s?.teardown();
  s = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A paste event like the browser's, with text/plain and text/html. */
function paste(el, plain, html = "") {
  const e = new Event("paste", { bubbles: true, cancelable: true });
  const getData = vi.fn((type) => (type === "text/plain" ? plain : type === "text/html" ? html : ""));
  Object.defineProperty(e, "clipboardData", { value: { getData } });
  el.dispatchEvent(e);
  e.getData = getData;
  return e;
}

/** Open the block whose source starts with start; select part in it. */
function openAndSelect(start, part) {
  tap(s.block((b) => b.raw.startsWith(start)).el.firstElementChild);
  const ta = s.editor();
  const at = ta.value.indexOf(part);
  ta.setSelectionRange(at, at + part.length);
  return ta;
}

const URL_A = "https://example.com/";

describe("AT-BEC-33 the block editor's Ctrl+V link (INV-69 (i)-(iv))", () => {
  it("selected text and a URL: the browser's paste is stopped, the text becomes [text](URL), still selected", async () => {
    s = await setupEdit("See the example here.\n");
    const ta = openAndSelect("See", "example");
    const e = paste(ta, `  ${URL_A}  `, '<a href="https://evil.example/">x</a>');
    expect(e.defaultPrevented).toBe(true);
    expect(ta.value).toBe("See the [example](https://example.com/) here.");
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe("example");
    expect(e.getData).not.toHaveBeenCalledWith("text/html");
    expect(s.host.onEditorInput).toHaveBeenCalled();
  });

  it("the browser's paste stays: no selection, not a URL, a URL selected (ruling Q6), a code block, a code span, a link destination", async () => {
    s = await setupEdit("See the example here.\n\nAlso https://old.example/ and `code` and [t](https://d.example/).\n\n```\nfoo\n```\n");
    let ta = openAndSelect("See", "example");
    ta.setSelectionRange(3, 3);
    expect(paste(ta, URL_A).defaultPrevented).toBe(false);
    ta.setSelectionRange(4, 7);
    expect(paste(ta, "plain words").defaultPrevented).toBe(false);
    expect(paste(ta, "javascript:alert(1)").defaultPrevented).toBe(false);
    // a control character in it: not a URL (INV-69), so nothing is linked
    expect(paste(ta, "https://x.example/\u0007a").defaultPrevented).toBe(false);
    expect(paste(ta, "\u0001https://x.example/").defaultPrevented).toBe(false);
    expect(ta.value).toBe("See the example here.");
    pointer(document.body, "pointerdown");
    ta = openAndSelect("Also", "https://old.example/");
    expect(paste(ta, "https://new.example/").defaultPrevented).toBe(false);
    ta.setSelectionRange(ta.value.indexOf("code"), ta.value.indexOf("code") + 2);
    expect(paste(ta, URL_A).defaultPrevented).toBe(false);
    const dest = ta.value.indexOf("//d.example") + 2;
    ta.setSelectionRange(dest, dest + 1);
    expect(paste(ta, URL_A).defaultPrevented).toBe(false);
    pointer(document.body, "pointerdown");
    ta = openAndSelect("```", "foo");
    expect(paste(ta, URL_A).defaultPrevented).toBe(false);
    expect(ta.value).toBe("```\nfoo\n```");
  });

  it("in a table's source the URL's pipes are \\|", async () => {
    s = await setupEdit("| A |\n| --- |\n| cell |\n");
    tap(s.block((b) => b.type === "table").el.querySelector(":scope > .grsmd-table-tab"));
    const ta = s.editor();
    const at = ta.value.indexOf("cell");
    ta.setSelectionRange(at, at + 4);
    expect(paste(ta, "https://x.example/p|q").defaultPrevented).toBe(true);
    expect(ta.value).toBe("| A |\n| --- |\n| [cell](https://x.example/p\\|q) |");
  });
});

describe("AT-BEC-34 editGeneration and linkTarget (INV-69, the button's wait)", () => {
  it("the generation moves when the editor opens, its text changes and it closes; the target holds the block, selection and generation", async () => {
    s = await setupEdit("One two.\n\nThree.\n");
    expect(s.bec.linkTarget()).toBeNull();
    const g0 = s.bec.editGeneration;
    const ta = openAndSelect("One", "two");
    expect(s.bec.editGeneration).toBeGreaterThan(g0);
    const target = s.bec.linkTarget();
    expect(target).toMatchObject({ kind: "block", start: 4, end: 7 });
    expect(s.bec.linkTarget()).toEqual(target);
    ta.setSelectionRange(0, 3);
    expect(s.bec.linkTarget()).not.toEqual(target);
    ta.setSelectionRange(4, 7);
    expect(s.bec.linkTarget()).toEqual(target);
    ta.value = "One two!";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    expect(s.bec.linkTarget()).not.toEqual(target);
    const g1 = s.bec.editGeneration;
    pointer(document.body, "pointerdown");
    expect(s.bec.editGeneration).toBeGreaterThan(g1);
    expect(s.bec.linkTarget()).toBeNull();
  });
});

describe("AT-BEC-35 pasteLink / removeLink / canPasteLink / canRemoveLink in the block editor (5.15.5)", () => {
  it("a selection becomes the link; a caret gets a new link whose text is selected (the clipboard's link text, else the URL)", async () => {
    s = await setupEdit("One two.\n");
    const ta = openAndSelect("One", "two");
    expect(s.bec.canPasteLink()).toBe(true);
    expect(s.bec.pasteLink(URL_A, "ignored")).toBe(true);
    expect(ta.value).toBe("One [two](https://example.com/).");
    ta.setSelectionRange(0, 0);
    expect(s.bec.pasteLink("https://x.example/", "X site")).toBe(true);
    expect(ta.value).toBe("[X site](https://x.example/)One [two](https://example.com/).");
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe("X site");
    ta.setSelectionRange(ta.value.length, ta.value.length);
    expect(s.bec.pasteLink("https://y.example/", null)).toBe(true);
    expect(ta.value.endsWith("[https://y.example/](https://y.example/)")).toBe(true);
  });

  it("a link text that cannot go in as written (it would make a reference link inside): the URL is the text", async () => {
    s = await setupEdit("One two.\n\n[docs]: https://d.example/\n");
    const ta = openAndSelect("One", "");
    ta.setSelectionRange(0, 0);
    expect(s.bec.pasteLink(URL_A, "[docs]")).toBe(true);
    expect(ta.value).toBe("[https://example.com/](https://example.com/)One two.");
  });

  it("Remove link at the caret or on a selection; off where there is no link; Paste link off across a blank line", async () => {
    s = await setupEdit("a [b](u) c\n");
    const ta = openAndSelect("a", "b");
    ta.setSelectionRange(4, 4);
    expect(s.bec.canRemoveLink()).toBe(true);
    expect(s.bec.removeLink()).toBe(true);
    expect(ta.value).toBe("a b c");
    expect(s.bec.canRemoveLink()).toBe(false);
    expect(s.bec.removeLink()).toBe(false);
    ta.value = "one\n\ntwo";
    ta.setSelectionRange(0, ta.value.length);
    expect(s.bec.canPasteLink()).toBe(false);
    ta.setSelectionRange(1, 1);
    expect(s.bec.canPasteLink()).toBe(true);
  });

  it("owner ruling F-R1: a caret where a link would break the source cannot take a new link", async () => {
    s = await setupEdit("# Head\n\n- item\n\nA `code` and [t](u) and Hello!\n\n```\ncode\n```\n");
    let ta = openAndSelect("# Head", "");
    for (const at of [0, 1]) {
      ta.setSelectionRange(at, at);
      expect(s.bec.canPasteLink(), `heading ${at}`).toBe(false);
      expect(s.bec.pasteLink(URL_A, null)).toBe(false);
    }
    ta.setSelectionRange(4, 4);
    expect(s.bec.canPasteLink()).toBe(true);
    pointer(document.body, "pointerdown");
    ta = openAndSelect("- item", "");
    ta.setSelectionRange(0, 0);
    expect(s.bec.canPasteLink(), "list marks").toBe(false);
    ta.setSelectionRange(2, 2);
    expect(s.bec.canPasteLink(), "item text").toBe(true);
    pointer(document.body, "pointerdown");
    ta = openAndSelect("A `code`", "");
    for (const part of ["ode", "](u)", "u)"]) {
      const at = ta.value.indexOf(part);
      ta.setSelectionRange(at, at);
      expect(s.bec.canPasteLink(), part).toBe(false);
    }
    ta.setSelectionRange(ta.value.length, ta.value.length);
    expect(s.bec.pasteLink(URL_A, "L")).toBe(true);
    expect(ta.value.endsWith("Hello\\![L](https://example.com/)")).toBe(true); // not an image
    pointer(document.body, "pointerdown");
    ta = openAndSelect("```", "");
    ta.setSelectionRange(5, 5);
    expect(s.bec.canPasteLink(), "code block").toBe(false);
  });

  it("INV-51: the state check on an empty line lexes the blocks of the editor and of the rewrite once each, not every time", async () => {
    s = await setupEdit("one\n\ntwo\n");
    const original = s.orchestrator.textLexers.bind(s.orchestrator);
    let blockLexes = 0;
    vi.spyOn(s.orchestrator, "textLexers").mockImplementation(() => {
      const lexers = original();
      return {
        ...lexers,
        lexBlocks: (src) => {
          blockLexes++;
          return lexers.lexBlocks(src);
        },
      };
    });
    tap(s.block((b) => b.raw.startsWith("one")).el.firstElementChild);
    const ta = s.editor();
    ta.value = "one\n\ntwo";
    ta.setSelectionRange(4, 4); // the empty line
    expect(s.bec.canPasteLink()).toBe(true);
    const first = blockLexes; // the editor's text and the rewrite
    for (let i = 0; i < 3; i++) expect(s.bec.canPasteLink()).toBe(true);
    expect(blockLexes).toBe(first);
  });

  it("not editing: nothing can be pasted or removed", async () => {
    s = await setupEdit("a [b](u) c\n");
    expect(s.bec.canPasteLink()).toBe(false);
    expect(s.bec.canRemoveLink()).toBe(false);
    expect(s.bec.pasteLink(URL_A, null)).toBe(false);
    expect(s.bec.removeLink()).toBe(false);
  });
});

// ---- table cells ----

const tableBlock = () => s.block((b) => b.type === "table");
const cellEl = (r, c) => tableBlock().el.querySelector(":scope > table").rows[r].cells[c];
const tableRaw = () => tableBlock().block.raw;

function openCell(r, c) {
  tap(cellEl(r, c));
  return cellEl(r, c);
}

/** Select [a, b) of a text node. */
function select(node, a, b) {
  const range = document.createRange();
  range.setStart(node, a);
  range.setEnd(node, b);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
}

describe("AT-TCE-22 a cell's Ctrl+V link comes before INV-63's paste", () => {
  it("WYSIWYG: selected text and a URL make a link (drawn in the cell), committed as [text](URL); pipes are \\|", async () => {
    s = await setupEdit("| A | B |\n| --- | --- |\n| Yamada | x |\n");
    const td = openCell(1, 0);
    select(td.firstChild, 0, 6);
    const e = paste(td, "https://x.example/p|q");
    expect(e.defaultPrevented).toBe(true);
    expect(td.querySelector("a")?.textContent).toBe("Yamada");
    expect(window.getSelection().toString()).toBe("Yamada");
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("[Yamada](https://x.example/p\\|q)");
    expect(cellEl(1, 1).textContent).toBe("x");
  });

  it("a URL selected, no URL, no selection, or inside a code span: text as INV-63", async () => {
    s = await setupEdit("| A | B |\n| --- | --- |\n| https://old.example/ | `code` |\n");
    let td = openCell(1, 0);
    select(td.querySelector("a").firstChild, 0, 20);
    expect(paste(td, "https://new.example/").defaultPrevented).toBe(true); // INV-63: text/plain as text
    expect(td.textContent).toBe("https://new.example/");
    keydown(td, "Tab");
    // ruling Q6: replaced as text, not written [https://new.example/](https://new.example/)
    expect(tableRaw()).toContain("| https://new.example/ |");
    expect(tableRaw()).not.toContain("](");
    td = cellEl(1, 1);
    select(td.querySelector("code").firstChild, 1, 3);
    paste(td, URL_A);
    expect(td.querySelector("a")).toBeNull();
    expect(td.textContent).toBe(`c${URL_A}e`);
  });

  it("a raw cell (math): the link goes into the cell's text", async () => {
    s = await setupEdit("| A |\n| --- |\n| x $y$ z |\n");
    const td = openCell(1, 0);
    expect(td.classList.contains("grsmd-cell-raw")).toBe(true);
    const text = td.firstChild;
    select(text, 6, 7);
    expect(paste(td, URL_A).defaultPrevented).toBe(true);
    expect(td.textContent).toBe("x $y$ [z](https://example.com/)");
  });
});

describe("AT-TCE-23 a cell's buttons: pasteLink / removeLink, and the cell's target", () => {
  it("a caret: a new link with its text selected; Remove link takes it off again", async () => {
    s = await setupEdit("| A |\n| --- |\n| ab |\n");
    const td = openCell(1, 0);
    select(td.firstChild, 1, 1);
    expect(s.bec.canPasteLink()).toBe(true);
    expect(s.bec.canRemoveLink()).toBe(false);
    expect(s.bec.pasteLink(URL_A, "Ex")).toBe(true);
    expect(td.querySelector("a").textContent).toBe("Ex");
    expect(window.getSelection().toString()).toBe("Ex");
    expect(s.bec.canRemoveLink()).toBe(true);
    expect(s.bec.removeLink()).toBe(true);
    expect(td.querySelector("a")).toBeNull();
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("| aExb |");
  });

  it("a caret at the start of the cell's second line: the link goes after the line break; not in a link or a code span (F-R1)", async () => {
    s = await setupEdit("| A |\n| --- |\n| ab<br>cd [x](u) `code` |\n");
    const td = openCell(1, 0);
    const second = [...td.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.data.startsWith("cd"));
    select(second, 0, 0);
    expect(s.bec.canPasteLink()).toBe(true);
    expect(s.bec.pasteLink(URL_A, "L")).toBe(true);
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("ab<br>[L](https://example.com/)cd");
    const again = openCell(1, 0);
    select(again.querySelector("a[href='u']").firstChild, 0, 0); // the edge of a link: allowed
    expect(s.bec.canPasteLink()).toBe(true);
    const code = again.querySelector("code").firstChild;
    select(code, 2, 2);
    expect(s.bec.canPasteLink(), "in a code span").toBe(false);
    expect(s.bec.pasteLink(URL_A, "L")).toBe(false);
  });

  it("right after a \"!\" in a cell: Paste link on, and it is written \\! (no image), as in the block editor", async () => {
    s = await setupEdit("| A |\n| --- |\n| Hello! |\n");
    const td = openCell(1, 0);
    select(td.firstChild, 6, 6);
    expect(s.bec.canPasteLink()).toBe(true);
    expect(s.bec.pasteLink(URL_A, "L")).toBe(true);
    expect(td.querySelector("a")?.textContent).toBe("L");
    expect(td.querySelector("img")).toBeNull();
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("| Hello\\![L](https://example.com/) |");
  });

  it("right after a URL in a cell (marked would take the link into the bare URL): Paste link off", async () => {
    s = await setupEdit("| A |\n| --- |\n| see https://a.example/ and www.b.example |\n");
    const td = openCell(1, 0);
    for (const a of td.querySelectorAll("a")) {
      const text = a.firstChild;
      select(text, text.data.length, text.data.length); // right after the bare URL
      expect(s.bec.canPasteLink(), text.data).toBe(false);
      expect(s.bec.pasteLink(URL_A, "L")).toBe(false);
    }
    const and = [...td.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.data.includes("and"));
    select(and, 1, 1); // after a space: fine
    expect(s.bec.canPasteLink()).toBe(true);
  });

  it("a link whose text makes an autolink with the text after it, taken off in a cell: stays text after the commit too", async () => {
    s = await setupEdit("| A |\n| --- |\n| x [www](u).example y |\n");
    const td = openCell(1, 0);
    select(td.querySelector("a").firstChild, 1, 1);
    expect(s.bec.canRemoveLink()).toBe(true);
    expect(s.bec.removeLink()).toBe(true);
    expect(td.querySelector("a")).toBeNull();
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("x www\\.example y");
    expect(cellEl(1, 0).querySelector("a")).toBeNull();
  });

  it("a bare URL taken off stays text after the cell is written again from its DOM (\\:)", async () => {
    s = await setupEdit("| A |\n| --- |\n| see https://x.example/ now |\n");
    const td = openCell(1, 0);
    select(td.querySelector("a").firstChild, 3, 3);
    expect(s.bec.removeLink()).toBe(true);
    expect(td.querySelector("a")).toBeNull();
    pointer(document.body, "pointerdown");
    expect(tableRaw()).toContain("see https\\://x.example/ now");
    expect(cellEl(1, 0).querySelector("a")).toBeNull();
  });

  it("the target is the table, the cell and the selection, with the cell's generation", async () => {
    s = await setupEdit("| A | B |\n| --- | --- |\n| one | two |\n");
    const td = openCell(1, 0);
    select(td.firstChild, 0, 3);
    const target = s.bec.linkTarget();
    expect(target).toMatchObject({ kind: "cell", row: 1, col: 0, start: 0, end: 3 });
    expect(s.bec.linkTarget()).toEqual(target);
    td.firstChild.data = "one!";
    td.dispatchEvent(new Event("input", { bubbles: true }));
    expect(s.bec.linkTarget()).not.toEqual(target);
    keydown(td, "Tab");
    expect(s.bec.linkTarget()).toMatchObject({ kind: "cell", row: 1, col: 1 });
  });
});
