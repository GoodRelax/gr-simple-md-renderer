import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return { ...actual, applyTheme: vi.fn(), waitForDOMStability: vi.fn().mockResolvedValue(true) };
});

import { CONFIG } from "../js/config.js";
import { setupEdit, flush } from "./helpers/editStack.js";
import { pointer, tap } from "./helpers/editDom.js";

// INV-74 (owner rulings D1 to D14, U1 to U5): the block range of edit mode
// on the real renderer stack. jsdom has no layout: the bar's place is not
// checked here (e2e does), only what it shows and does (AT-RNG-14..30).

const DOC = "# Title\n\nHello world.\n\nSecond para.\n\n- a\n- b\n\nLast para.\n";

let s;
afterEach(() => {
  window.getSelection().removeAllRanges();
  s?.teardown();
  s = null;
  document.querySelectorAll(".grsmd-block-range-bar").forEach((el) => el.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const el = (text) => s.block((b) => b.raw.startsWith(text)).el;
const id = (text) => s.block((b) => b.raw.startsWith(text)).block.id;
/** The first text node under a block's wrapper. */
function textIn(wrapper) {
  const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
  return walker.nextNode();
}
/** Select from (startNode, startOffset) to (endNode, endOffset). */
function select(startNode, startOffset, endNode, endOffset) {
  const r = document.createRange();
  r.setStart(startNode, startOffset);
  r.setEnd(endNode, endOffset);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}
const bar = () => document.querySelector(".grsmd-block-range-bar");
const button = (index) => bar().querySelectorAll("button")[index];
const framed = () => [...s.preview.querySelectorAll(":scope > .md-block-range")];
/** Press and release a bar button (the bar's handlers ask where it was released). */
function press(btn, upOn = btn) {
  document.elementFromPoint = () => upOn;
  pointer(btn, "pointerdown");
  pointer(btn, "pointerup");
  delete document.elementFromPoint;
}

describe("AT-RNG which blocks a selection stands for (INV-74 (1), U2, U4, U5)", () => {
  it("AT-RNG-14 a selection over two blocks: both, framed, and the bar shows", async () => {
    s = await setupEdit(DOC);
    select(textIn(el("Hello")), 2, textIn(el("Second")), 3);
    expect(s.bec.readBlockRange()).toEqual({ kind: "blockRange", firstId: id("Hello"), lastId: id("Second") });
    s.frame();
    expect(framed()).toEqual([el("Hello"), el("Second")]);
    expect(bar().hidden).toBe(false);
  });

  it("AT-RNG-41 the frame follows a range that grows, shrinks and moves", async () => {
    s = await setupEdit(DOC);
    select(textIn(el("Hello")), 0, textIn(el("Last")), 1);
    s.frame();
    expect(framed()).toEqual([el("Hello"), el("Second"), el("- a"), el("Last")]);
    select(textIn(el("Hello")), 0, textIn(el("Second")), 1);
    s.frame();
    expect(framed()).toEqual([el("Hello"), el("Second")]);
    select(textIn(el("# Title")), 0, textIn(el("Hello")), 1);
    s.frame();
    expect(framed()).toEqual([el("# Title"), el("Hello")]);
    select(textIn(el("- a")), 0, textIn(el("Last")), 1);
    s.frame();
    expect(framed()).toEqual([el("- a"), el("Last")]);
  });

  it("AT-RNG-15 a selection inside one block is that block (D4); an item of a list is the whole list (D13)", async () => {
    s = await setupEdit(DOC);
    select(textIn(el("Hello")), 0, textIn(el("Hello")), 5);
    expect(s.bec.readBlockRange()).toMatchObject({ firstId: id("Hello"), lastId: id("Hello") });
    const item = el("- a").querySelectorAll("li")[1].firstChild;
    select(item, 0, item, 1);
    expect(s.bec.readBlockRange()).toMatchObject({ firstId: id("- a"), lastId: id("- a") });
  });

  it("AT-RNG-16 ends that touch no text of a block go inward: the start at a block's end, the end at a block's start", async () => {
    s = await setupEdit(DOC);
    const hello = textIn(el("Hello"));
    const second = textIn(el("Second"));
    // as a triple click: the end at the very start of the next block
    select(hello, 0, second, 0);
    expect(s.bec.readBlockRange()).toMatchObject({ firstId: id("Hello"), lastId: id("Hello") });
    select(hello, hello.data.length, textIn(el("Last")), 2);
    expect(s.bec.readBlockRange()).toMatchObject({ firstId: id("Second"), lastId: id("Last") });
    // nothing of any block: no range, no bar, no frame
    select(hello, hello.data.length, second, 0);
    expect(s.bec.readBlockRange()).toBeNull();
    s.frame();
    expect(bar()?.hidden ?? true).toBe(true); // never made, or hidden
    expect(framed()).toEqual([]);
  });

  it("AT-RNG-17 ends between the blocks (the preview itself) go inward to the next block", async () => {
    s = await setupEdit(DOC);
    const children = [...s.preview.childNodes];
    select(s.preview, children.indexOf(el("Hello")), s.preview, children.indexOf(el("- a")));
    expect(s.bec.readBlockRange()).toMatchObject({ firstId: id("Hello"), lastId: id("Second") });
  });

  it("AT-RNG-18 a selection of the whole page (Ctrl+A) is every block (U4)", async () => {
    s = await setupEdit(DOC);
    const r = document.createRange();
    r.selectNodeContents(document.body);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(r);
    const blocks = s.orchestrator.getModel().getBlocks();
    expect(s.bec.readBlockRange()).toMatchObject({ firstId: blocks[0].id, lastId: blocks[blocks.length - 1].id });
    s.frame();
    expect(framed()).toHaveLength(blocks.length);
  });

  it("AT-RNG-19 a selection outside the preview only makes no range", async () => {
    s = await setupEdit(DOC);
    const outside = document.createElement("p");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    select(outside.firstChild, 0, outside.firstChild, 3);
    expect(s.bec.readBlockRange()).toBeNull();
    outside.remove();
  });

  it("AT-RNG-20 no range with the focus in a text entry, or an end in the palette (U5)", async () => {
    s = await setupEdit(DOC);
    const input = document.createElement("textarea");
    document.body.appendChild(input);
    select(textIn(el("Hello")), 0, textIn(el("Second")), 2);
    input.focus();
    expect(s.bec.readBlockRange()).toBeNull();
    input.blur();
    input.remove();
    select(textIn(el("Hello")), 0, textIn(el("Second")), 2); // jsdom moves the selection on focus
    expect(s.bec.readBlockRange()).not.toBeNull();
    s.host.palette.textContent = "palette text";
    select(textIn(el("Hello")), 0, s.host.palette.firstChild, 3);
    expect(s.bec.readBlockRange()).toBeNull();
  });

  it("AT-RNG-21 only in editModeIdle: not outside edit mode, not while a block editor is open (D9)", async () => {
    s = await setupEdit(DOC, { editMode: false });
    select(textIn(el("Hello")), 0, textIn(el("Second")), 2);
    expect(s.bec.readBlockRange()).toBeNull();
    expect(bar()).toBeNull();
    s.bec.dispatch("paletteShown");
    expect(s.bec.readBlockRange()).not.toBeNull();
    s.frame();
    window.getSelection().removeAllRanges();
    tap(el("Last").firstElementChild);
    expect(s.bec.isEditing()).toBe(true);
    select(textIn(el("Hello")), 0, textIn(el("Second")), 2);
    expect(s.bec.readBlockRange()).toBeNull();
    s.frame();
    expect(bar().hidden).toBe(true);
    // edit mode ends: no frame, no bar, the selection is the browser's
    s.bec.dispatch("escapePressed");
    select(textIn(el("Hello")), 0, textIn(el("Second")), 2);
    expect(s.bec.readBlockRange()).not.toBeNull();
    s.frame();
    s.bec.dispatch("paletteHidden");
    expect(framed()).toEqual([]);
    expect(bar().hidden).toBe(true);
    expect(window.getSelection().isCollapsed).toBe(false);
  });
});

describe("AT-RNG the bar and the actions (INV-74 (2) to (5))", () => {
  it("AT-RNG-22 three icon buttons with their tooltips and aria-labels from config.js (U1)", async () => {
    s = await setupEdit(DOC);
    select(textIn(el("Hello")), 0, textIn(el("Hello")), 3);
    s.frame();
    const messages = CONFIG.messages.blockRange;
    const mod = CONFIG.messages.palette.modifier.other;
    expect(bar().getAttribute("role")).toBe("toolbar");
    expect(bar().getAttribute("aria-label")).toBe(messages.bar);
    expect([0, 1, 2].map((i) => button(i).getAttribute("aria-label"))).toEqual([messages.delete, messages.cut(mod), messages.copy(mod)]);
    expect([0, 1, 2].map((i) => button(i).title)).toEqual([messages.delete, messages.cut(mod), messages.copy(mod)]);
    expect([0, 1, 2].map((i) => button(i).tabIndex)).toEqual([-1, -1, -1]);
    expect(bar().parentNode).toBe(document.body);
  });

  it("AT-RNG-23 Delete: the blocks go in one unit, no toast, the selection and the bar go; one Undo brings them back", async () => {
    s = await setupEdit(DOC);
    select(textIn(el("Hello")), 2, textIn(el("- a")), 0);
    s.frame();
    press(button(0));
    expect(s.orchestrator.getBody()).toBe("# Title\n\n- a\n- b\n\nLast para.\n");
    expect(s.host.showToast).not.toHaveBeenCalled();
    expect(window.getSelection().rangeCount).toBe(0);
    expect(bar().hidden).toBe(true);
    await flush();
    s.bec.dispatch("undoRequested");
    expect(s.orchestrator.getBody()).toBe(DOC);
    s.bec.dispatch("redoRequested");
    expect(s.orchestrator.getBody()).toBe("# Title\n\n- a\n- b\n\nLast para.\n");
  });

  it("AT-RNG-24 Cut: the source goes to the clipboard first, then the blocks go", async () => {
    s = await setupEdit(DOC);
    select(textIn(el("Hello")), 0, textIn(el("Second")), 1);
    s.frame();
    press(button(1));
    expect(s.host.writeClipboardNow).toHaveBeenCalledWith("Hello world.\n\nSecond para.");
    expect(s.orchestrator.getBody()).toBe("# Title\n\n- a\n- b\n\nLast para.\n");
  });

  it("AT-RNG-25 a cut whose write failed deletes nothing and says so in one toast; it never waits for a later write", async () => {
    s = await setupEdit(DOC);
    s.host.writeClipboardNow.mockReturnValue(false);
    select(textIn(el("Hello")), 0, textIn(el("Second")), 1);
    s.bec.dispatch("blockRangeCutRequested", s.bec.readBlockRange());
    expect(s.host.writeClipboardNow).toHaveBeenCalledWith("Hello world.\n\nSecond para.");
    expect(s.host.writeClipboardLater).not.toHaveBeenCalled();
    expect(s.orchestrator.getBody()).toBe(DOC);
    expect(s.orchestrator.canUndo()).toBe(false);
    expect(s.host.showToast.mock.calls).toEqual([[CONFIG.messages.blockRange.cutFailed]]);
  });

  it("AT-RNG-42 a copy whose write failed: one toast, no check; nothing changes", async () => {
    s = await setupEdit(DOC);
    s.host.writeClipboardNow.mockReturnValue(false);
    s.host.writeClipboardLater.mockReturnValue(Promise.resolve(false));
    select(textIn(el("Hello")), 0, textIn(el("Second")), 1);
    s.frame();
    press(button(2));
    expect(s.host.writeClipboardNow).toHaveBeenCalledWith("Hello world.\n\nSecond para.");
    await flush();
    expect(s.host.writeClipboardLater).toHaveBeenCalledWith("Hello world.\n\nSecond para.");
    expect(s.host.showToast.mock.calls).toEqual([[CONFIG.messages.blockRange.copyFailed]]);
    expect(button(2).classList.contains("is-copied")).toBe(false);
    expect(s.orchestrator.getBody()).toBe(DOC);
  });

  it("AT-RNG-43 a copy written a little later (navigator.clipboard): the check once written, or the toast when it fails", async () => {
    s = await setupEdit(DOC);
    select(textIn(el("Hello")), 0, textIn(el("Second")), 1);
    s.frame();
    s.host.writeClipboardNow.mockReturnValue(false);
    press(button(2));
    await flush();
    expect(button(2).classList.contains("is-copied")).toBe(true);
    expect(s.host.showToast).not.toHaveBeenCalled();
    s.host.writeClipboardLater.mockReturnValue(Promise.resolve(false));
    s.bec.dispatch("blockRangeCopyRequested", s.bec.readBlockRange());
    await flush();
    expect(s.host.showToast.mock.calls).toEqual([[CONFIG.messages.blockRange.copyFailed]]);
  });

  it("AT-RNG-26 Copy: the source goes to the clipboard, nothing changes, the selection stays, the button shows a check for a moment (D11)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    s = await setupEdit(DOC);
    select(textIn(el("Second")), 0, textIn(el("Last")), 1);
    s.frame();
    const copy = button(2);
    const icon = copy.innerHTML;
    press(copy);
    expect(s.host.writeClipboardNow).toHaveBeenCalledWith("Second para.\n\n- a\n- b\n\nLast para.");
    expect(s.host.writeClipboardLater).not.toHaveBeenCalled();
    expect(s.orchestrator.getBody()).toBe(DOC);
    expect(s.orchestrator.canUndo()).toBe(false);
    expect(window.getSelection().isCollapsed).toBe(false);
    expect(copy.classList.contains("is-copied")).toBe(true);
    expect(copy.innerHTML).not.toBe(icon);
    vi.advanceTimersByTime(CONFIG.ui.copyFeedbackDuration);
    expect(copy.classList.contains("is-copied")).toBe(false);
    expect(copy.innerHTML).toBe(icon);
  });

  it("AT-RNG-27 a press released on another button, or a press with another button, runs nothing (as INV-34)", async () => {
    s = await setupEdit(DOC);
    select(textIn(el("Hello")), 0, textIn(el("Second")), 1);
    s.frame();
    press(button(0), button(1));
    expect(s.orchestrator.getBody()).toBe(DOC);
    pointer(button(0), "pointerdown", { button: 2 });
    pointer(button(0), "pointerup", { button: 2 });
    expect(s.orchestrator.getBody()).toBe(DOC);
    const down = pointer(button(0), "pointerdown");
    expect(down.defaultPrevented).toBe(true); // the selection and the focus stay
  });

  it("AT-RNG-28 Esc takes the range away first and keeps edit mode; the next Esc hides the palette (D14)", async () => {
    s = await setupEdit(DOC);
    select(textIn(el("Hello")), 0, textIn(el("Second")), 1);
    s.bec.dispatch("escapePressed");
    expect(window.getSelection().rangeCount).toBe(0);
    expect(framed()).toEqual([]);
    expect(s.host.hidePalette).not.toHaveBeenCalled();
    s.bec.dispatch("escapePressed");
    expect(s.host.hidePalette).toHaveBeenCalledTimes(1);
  });

  it("AT-RNG-29 with an unrendered #editor change: a delete or a cut does the full render only (INV-45); a copy still copies", async () => {
    s = await setupEdit(DOC);
    s.host.editorChanged = true;
    select(textIn(el("Hello")), 0, textIn(el("Second")), 1);
    const range = s.bec.readBlockRange();
    s.bec.dispatch("blockRangeDeleteRequested", range);
    s.bec.dispatch("blockRangeCutRequested", range);
    expect(s.host.renderFromEditor).toHaveBeenCalledTimes(2);
    expect(s.host.writeClipboardNow).not.toHaveBeenCalled();
    expect(s.orchestrator.getBody()).toBe(DOC);
    s.bec.dispatch("blockRangeCopyRequested", range);
    expect(s.host.writeClipboardNow).toHaveBeenCalledWith("Hello world.\n\nSecond para.");
  });

  it("AT-RNG-40 while the mouse button is held (a drag still selecting) the frame follows, the bar waits for the release", async () => {
    s = await setupEdit(DOC);
    pointer(textIn(el("Hello")).parentNode, "pointerdown");
    select(textIn(el("Hello")), 0, textIn(el("Second")), 1);
    expect(s.bec.readBlockRange()).not.toBeNull();
    s.frame();
    expect(framed()).toHaveLength(2);
    expect(bar()?.hidden ?? true).toBe(true); // not made yet, or hidden
    pointer(textIn(el("Second")).parentNode, "pointerup", { x: 80 });
    s.frame();
    expect(bar().hidden).toBe(false);
    // a release that never arrives (outside the window): a move with no button ends the drag
    pointer(textIn(el("Hello")).parentNode, "pointerdown");
    s.frame();
    expect(bar().hidden).toBe(true);
    textIn(el("Second")).parentNode.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", buttons: 0 }));
    s.frame();
    expect(bar().hidden).toBe(false);
  });

  it("AT-RNG-45 INV-74 (1) (L1): reading the range changes nothing: no frame, no bar, the gaps are not told", async () => {
    s = await setupEdit(DOC);
    const told = vi.spyOn(s.bec._gaps, "hide");
    select(textIn(el("Hello")), 0, textIn(el("Second")), 1);
    expect(s.bec.readBlockRange()).not.toBeNull();
    expect(s.bec.readBlockRange()).not.toBeNull();
    expect(framed()).toEqual([]);
    expect(bar()).toBeNull();
    expect(told).not.toHaveBeenCalled();
    s.frame();
    expect(framed()).toHaveLength(2);
    expect(told).toHaveBeenCalled();
  });

  it("AT-RNG-46 INV-74 (1) (L7): a press on the bar reads the selection again; a range made in the same frame is the one acted on", async () => {
    s = await setupEdit(DOC);
    select(textIn(el("Hello")), 0, textIn(el("Hello")), 3);
    s.frame(); // the bar shows Hello
    select(textIn(el("Hello")), 0, textIn(el("Second")), 3); // no frame yet
    press(button(0));
    expect(s.orchestrator.getBody()).toBe("# Title\n\n- a\n- b\n\nLast para.\n");
  });

  it("AT-RNG-47 INV-74 (2) (M1): only the blocks within a screen of the viewport get the frame; the scroll moves it", async () => {
    s = await setupEdit(DOC);
    const wrappers = s.markdownRenderer.getBlockElements();
    const height = window.innerHeight;
    // boxes far apart: the second block is in view, the others 3 or more screens away
    let shift = 0;
    const tops = [-4 * height, 10, 4 * height, 8 * height, 12 * height];
    wrappers.forEach((w, i) => {
      w.getBoundingClientRect = () => ({ top: tops[i] - shift, bottom: tops[i] - shift + 20, left: 0, right: 100, width: 100, height: 20 });
    });
    const r = document.createRange();
    r.selectNodeContents(s.preview);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(r);
    expect(s.bec.readBlockRange()).toMatchObject({ firstId: id("# Title"), lastId: id("Last") }); // the range is still every block
    s.frame();
    expect(framed()).toEqual([wrappers[1]]);
    shift = 4 * height; // scrolled down by 4 screens: the third block is in view
    s.frame();
    expect(framed()).toEqual([wrappers[2]]);
  });

  it("AT-RNG-30 a range whose blocks are gone (an undo, a newer render) does nothing", async () => {
    s = await setupEdit(DOC);
    select(textIn(el("Hello")), 0, textIn(el("Second")), 1);
    const range = s.bec.readBlockRange();
    s.orchestrator.commitBlock(id("Hello"), "Hello changed.");
    await flush();
    s.bec.dispatch("blockRangeDeleteRequested", range);
    expect(s.orchestrator.getBody()).toBe(DOC.replace("Hello world.", "Hello changed."));
  });
});
