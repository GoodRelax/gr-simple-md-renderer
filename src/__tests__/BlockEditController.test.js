import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return { ...actual, applyTheme: vi.fn(), waitForDOMStability: vi.fn().mockResolvedValue(true) };
});

import BlockEditController from "../js/classes/BlockEditController.js";
import { waitForDOMStability } from "../js/utils.js";
import { CONFIG } from "../js/config.js";
import { setupEdit, flush } from "./helpers/editStack.js";
import { pointer, tap, keydown, trackListeners } from "./helpers/editDom.js";
import { loadFixtureLf } from "./helpers/samples.js";

const DOC = "# Title\n\nHello world.\n\nSecond para.\n\nThird para.\n";
const isPara = (start) => (b) => b.type === "paragraph" && b.raw.startsWith(start);

let s;
afterEach(() => {
  s?.teardown();
  s = null;
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Open the block matching pred with a plain click; returns {block, el, ta}. */
function openBlock(pred) {
  const { block, el } = s.block(pred);
  // a table opens its source from its tab (INV-29 (b)); its cells open in place
  tap(el.querySelector(":scope > .grsmd-table-tab") ?? el.firstElementChild ?? el);
  return { block, el, ta: s.editor() };
}

describe("AT-BEC opening the editor (INV-29)", () => {
  it("AT-BEC-01 a click on a paragraph opens a textarea at its place with the raw text, focused, monospace", async () => {
    s = await setupEdit(DOC);
    const { el } = s.block(isPara("Hello"));
    tap(el.firstElementChild);
    const ta = s.editor();
    expect(ta).not.toBeNull();
    expect(ta.tagName).toBe("TEXTAREA");
    expect(ta.classList.contains("md-block-editor")).toBe(true);
    expect(el.contains(ta)).toBe(true);
    expect(ta.value).toBe("Hello world.");
    expect(document.activeElement).toBe(ta);
    expect(ta.classList.contains("md-block-editor")).toBe(true); // the font comes from the CSS rule (staticChecks)
    expect(s.bec.isEditing()).toBe(true);
  });

  it("AT-BEC-02 outside edit mode a click opens nothing; the external image placeholder still asks", async () => {
    s = await setupEdit(loadFixtureLf("external-image.md"), { editMode: false });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const para = s.preview.querySelector(".md-block p");
    tap(para);
    expect(s.editor()).toBeNull();
    expect(s.bec.isEditing()).toBe(false);
    const placeholder = s.preview.querySelector(".external-image-placeholder");
    expect(placeholder).not.toBeNull();
    tap(placeholder);
    placeholder.click();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(s.editor()).toBeNull();
  });

  it.each([
    [0, 5, true],
    [3, 4, true],
    [0, 6, false],
    [4, 4, false],
  ])("AT-BEC-03 a move of (%i, %i) opens: %s (Euclidean, activationThresholdPx = 5)", async (dx, dy, opens) => {
    expect(CONFIG.pan.activationThresholdPx).toBe(5);
    s = await setupEdit(DOC);
    const { el } = s.block(isPara("Hello"));
    tap(el.firstElementChild, { dx, dy });
    expect(s.editor() !== null).toBe(opens);
  });

  it("AT-BEC-04 a secondary button opens nothing", async () => {
    s = await setupEdit(DOC);
    const { el } = s.block(isPara("Hello"));
    tap(el.firstElementChild, { button: 2 });
    expect(s.editor()).toBeNull();
  });

  it("AT-BEC-05 a text selection at pointerup opens nothing", async () => {
    s = await setupEdit(DOC);
    const { el } = s.block(isPara("Hello"));
    const p = el.firstElementChild;
    pointer(p, "pointerdown");
    const range = document.createRange();
    range.setStart(p.firstChild, 0);
    range.setEnd(p.firstChild, 5);
    window.getSelection().addRange(range);
    pointer(p, "pointerup");
    expect(s.editor()).toBeNull();
  });

  it.each([
    ["a link", '<a href="#x"><span>t</span></a>'],
    ["a button", "<button><span>t</span></button>"],
    ["an input", '<input type="text">'],
    ["a summary", "<details><summary><span>t</span></summary></details>"],
    ["[role=button]", '<div role="button"><span>t</span></div>'],
    [".external-image-placeholder", '<div class="external-image-placeholder"><span>t</span></div>'],
    [".plantuml-pending", '<div class="plantuml-pending"><span>t</span></div>'],
    [".diagram-copy-btn", '<div class="diagram-copy-btn"><span>t</span></div>'],
  ])("AT-BEC-06 a click inside %s opens nothing", async (_name, html) => {
    s = await setupEdit(DOC);
    const { el } = s.block(isPara("Hello"));
    const holder = document.createElement("div");
    holder.innerHTML = html;
    el.appendChild(holder);
    const target = holder.querySelector("span") ?? holder.firstElementChild;
    tap(target);
    expect(s.editor()).toBeNull();
  });

  it.each(["palette", "popover"])("AT-BEC-06 a click on the %s opens nothing", async (which) => {
    s = await setupEdit(DOC);
    tap(s.host[which].querySelector("button"));
    expect(s.editor()).toBeNull();
    expect(s.bec.isEditing()).toBe(false);
  });

  it("AT-BEC-06 a click inside the open editor opens nothing new and does not commit", async () => {
    s = await setupEdit(DOC);
    const { ta } = openBlock(isPara("Hello"));
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    tap(ta);
    expect(s.editor()).toBe(ta);
    expect(commit).not.toHaveBeenCalled();
  });

  it("AT-BEC-07 the block id is taken at pointerdown: down on A, up on B opens A", async () => {
    s = await setupEdit(DOC);
    const a = s.block(isPara("Hello"));
    const b = s.block(isPara("Second"));
    tap(a.el.firstElementChild, { upEl: b.el.firstElementChild });
    expect(a.el.contains(s.editor())).toBe(true);
  });

  it("AT-BEC-08 an element whose id is not in the current model does not open", async () => {
    s = await setupEdit(DOC);
    const a = s.block(isPara("Hello"));
    const old = a.el.firstElementChild;
    s.orchestrator.commitBlock(a.block.id, ""); // model updated now; the DOM is still old
    expect(s.orchestrator.getModel().findIndexById(a.block.id)).toBe(-1);
    tap(old);
    expect(s.editor()).toBeNull();
    expect(s.bec.isEditing()).toBe(false);
  });
});

describe("INV-46 opening another block keeps the tapped block where it was (PRT-U07)", () => {
  /**
   * A fake vertical layout of the preview: the blocks stack from the top,
   * shifted by a fake scrollTop. "Hello" is a tall block: 710 px rendered,
   * 2680 px while it holds the editor; after its commit ("Changed") it renders
   * 300 px, as a diagram that changed size. Other blocks: 100 px, 120 px
   * while editing.
   */
  function fakeLayout(preview) {
    let scroll = 0;
    Object.defineProperty(preview, "scrollTop", {
      configurable: true,
      get: () => scroll,
      set: (v) => {
        scroll = v;
      },
    });
    const heightOf = (el) => {
      const ta = el.querySelector("textarea");
      if (ta) return /Hello|Changed/.test(ta.value) ? 2680 : 120;
      if (/Changed/.test(el.textContent)) return 300;
      return /Hello/.test(el.textContent) ? 710 : 100;
    };
    const original = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (!this.classList.contains("md-block")) return original.call(this);
      let top = -scroll;
      for (const el of preview.querySelectorAll(":scope > .md-block")) {
        const height = heightOf(el);
        if (el === this) return { top, bottom: top + height, height, left: 0, right: 800, width: 800, x: 0, y: top };
        top += height;
      }
      return original.call(this);
    });
    // the blocks have boxes (jsdom has no layout: no client rects otherwise)
    const originalRects = Element.prototype.getClientRects;
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function () {
      return this.classList.contains("md-block") ? [this.getBoundingClientRect()] : originalRects.call(this);
    });
    return {
      topOf: (el) => el.getBoundingClientRect().top,
      setScroll: (v) => {
        scroll = v;
      },
    };
  }

  it.each([
    ["mouse, changed (a partial render follows)", "Changed A.", "mouse"],
    ["mouse, unchanged (nothing to render)", "Hello world.", "mouse"],
    ["touch, changed (commit and open in one tap)", "Changed A.", "touch"],
    ["touch, unchanged", "Hello world.", "touch"],
  ])("a tall editor is open; tapping a block below it (%s): the tapped block stays at its place", async (_name, text, pointerType) => {
    s = await setupEdit(DOC);
    const layout = fakeLayout(s.preview);
    const { ta } = openBlock(isPara("Hello"));
    ta.value = text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    const third = s.block(isPara("Third")).el;
    layout.setScroll(100 + 2680 + 100 - 411); // Third's top at 411 px
    expect(layout.topOf(third)).toBe(411);
    tap(third.firstElementChild, { pointerType });
    expect(s.editor().value).toBe("Third para.");
    expect(layout.topOf(third)).toBe(411);
    await flush();
    expect(s.block(isPara("Third")).el).toBe(third);
    expect(layout.topOf(third)).toBe(411);
  });

  it("mouse: the commit's render is already running when the tap opens the block; its last correction keeps the opened block", async () => {
    s = await setupEdit(DOC);
    const layout = fakeLayout(s.preview);
    const { ta } = openBlock(isPara("Hello"));
    ta.value = "Changed A.";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    const third = s.block(isPara("Third")).el;
    layout.setScroll(100 + 2680 + 100 - 411);
    let settleDom;
    waitForDOMStability.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleDom = resolve;
        }),
    );
    pointer(third.firstElementChild, "pointerdown", { x: 10, y: 10, pointerType: "mouse" });
    await flush(); // the commit's partial render runs until it waits for the DOM
    expect(settleDom).toBeTypeOf("function");
    pointer(third.firstElementChild, "pointerup", { x: 10, y: 10, pointerType: "mouse" });
    expect(s.editor().value).toBe("Third para.");
    expect(layout.topOf(third)).toBe(411);
    settleDom(true);
    await flush();
    expect(layout.topOf(third)).toBe(411);
  });
});

describe("INV-46 the commit's anchor is taken before the editor closes (one forced layout less)", () => {
  it("captureAnchor sees the open editor; commitBlock gets that anchor", async () => {
    s = await setupEdit(DOC);
    const { el, ta } = openBlock(isPara("Hello"));
    ta.value = "Hello changed.";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    const anchor = { offsetTop: 77 };
    const capture = vi.spyOn(s.scrollMemento, "captureAnchor").mockImplementation((w) => {
      expect(w).toBe(el);
      expect(w.querySelector("textarea")).not.toBeNull(); // still open
      return anchor;
    });
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    pointer(document.body, "pointerdown");
    expect(capture).toHaveBeenCalledTimes(1);
    // INV-84: with the caret's line (at the end of the text after the value was set)
    expect(commit).toHaveBeenCalledWith(expect.any(Number), "Hello changed.", { ...anchor, line: { offset: expect.any(Number), sourceOffset: "Hello changed.".length } });
    await flush();
  });
});

describe("AT-BEC committing on the outside (INV-30)", () => {
  function outsideTarget(kind) {
    const el = document.createElement("div");
    el.className = kind;
    document.body.appendChild(el);
    return el;
  }

  it.each(["topbar", "toast"])("AT-BEC-09 mouse pointerdown on the %s commits at once", async (kind) => {
    s = await setupEdit(DOC);
    const { block, ta } = openBlock(isPara("Hello"));
    ta.value = "Hello changed.";
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    const target = outsideTarget(kind);
    pointer(target, "pointerdown");
    expect(commit).toHaveBeenCalledWith(block.id, "Hello changed.", expect.anything()); // + the anchor taken before closing
    expect(s.editor()).toBeNull();
    target.remove();
  });

  it("AT-BEC-09 mouse pointerdown on another preview element commits at once", async () => {
    s = await setupEdit(DOC);
    const { block, ta } = openBlock(isPara("Hello"));
    ta.value = "Hello changed.";
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    pointer(s.block(isPara("Third")).el.firstElementChild, "pointerdown");
    expect(commit).toHaveBeenCalledWith(block.id, "Hello changed.", expect.anything()); // + the anchor taken before closing
  });

  it.each(["touch", "pen"])("AT-BEC-10 %s: pointerdown alone does not commit; a release within 5 px does", async (pointerType) => {
    s = await setupEdit(DOC);
    const { block, ta } = openBlock(isPara("Hello"));
    ta.value = "Hello changed.";
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    const target = document.createElement("div");
    document.body.appendChild(target);
    pointer(target, "pointerdown", { x: 10, y: 10, pointerType });
    expect(commit).not.toHaveBeenCalled();
    expect(s.editor()).toBe(ta);
    pointer(target, "pointerup", { x: 13, y: 14, pointerType });
    expect(commit).toHaveBeenCalledWith(block.id, "Hello changed.", expect.anything()); // + the anchor taken before closing
    target.remove();
  });

  it.each(["touch", "pen"])("AT-BEC-10 %s: a move of 6 px (scrolling) does not commit", async (pointerType) => {
    s = await setupEdit(DOC);
    const { ta } = openBlock(isPara("Hello"));
    ta.value = "Hello changed.";
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    const target = document.createElement("div");
    document.body.appendChild(target);
    pointer(target, "pointerdown", { x: 10, y: 10, pointerType });
    pointer(target, "pointerup", { x: 10, y: 16, pointerType });
    expect(commit).not.toHaveBeenCalled();
    expect(s.editor()).toBe(ta);
    target.remove();
  });

  it.each(["editor", "palette", "popover"])("AT-BEC-11 pointerdown on the %s does not commit; focus and selection stay", async (which) => {
    s = await setupEdit(DOC);
    const { ta } = openBlock(isPara("Hello"));
    ta.value = "Hello changed.";
    ta.setSelectionRange(1, 4);
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    const target = which === "editor" ? ta : s.host[which].querySelector("button");
    tap(target, { pointerType: "mouse" });
    tap(target, { pointerType: "touch" });
    expect(commit).not.toHaveBeenCalled();
    expect(s.editor()).toBe(ta);
    expect(document.activeElement).toBe(ta);
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([1, 4]);
  });

  it.each(["mouse", "touch"])("AT-BEC-12 (%s) editing A, a click on B commits A, then opens B by id", async (pointerType) => {
    s = await setupEdit(DOC);
    const a = openBlock(isPara("Hello"));
    a.ta.value = "Hello changed.";
    const b = s.block(isPara("Second"));
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    tap(b.el.firstElementChild, { pointerType });
    expect(commit).toHaveBeenCalledWith(a.block.id, "Hello changed.", expect.anything()); // + the anchor taken before closing
    const ta = s.editor();
    expect(ta).not.toBeNull();
    expect(b.el.contains(ta)).toBe(true);
    expect(ta.value).toBe("Second para.");
  });

  it("AT-BEC-12 a block swallowed by A's commit (unclosed fence) does not open", async () => {
    s = await setupEdit(DOC);
    const a = openBlock(isPara("Hello"));
    a.ta.value = "```js\nx";
    const b = s.block(isPara("Second"));
    tap(b.el.firstElementChild);
    expect(s.orchestrator.getModel().findIndexById(b.block.id)).toBe(-1);
    expect(s.editor()).toBeNull();
    expect(s.bec.isEditing()).toBe(false);
  });

  it("AT-BEC-13 the commit is synchronous: when the handler returns, the model has the text with its trailing newlines back and the editor is closed", async () => {
    s = await setupEdit(DOC);
    const a = openBlock(isPara("Hello"));
    a.ta.value = "Hello changed.";
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    const render = vi.spyOn(s.markdownRenderer, "replaceBlocks");
    pointer(document.body, "pointerdown");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(a.block.id, "Hello changed.", expect.anything()); // + the anchor taken before closing
    expect(s.orchestrator.getBody()).toBe("# Title\n\nHello changed.\n\nSecond para.\n\nThird para.\n");
    expect(s.editor()).toBeNull();
    expect(render).not.toHaveBeenCalled(); // the DOM render runs later from the queue
    await flush();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("AT-BEC-30 pointerdown on the preview scrollbar does not commit; on its content it does", async () => {
    s = await setupEdit(DOC);
    Object.defineProperty(s.preview, "clientWidth", { configurable: true, value: 300 });
    Object.defineProperty(s.preview, "clientHeight", { configurable: true, value: 400 });
    const { block, ta } = openBlock(isPara("Hello"));
    ta.value = "Hello changed.";
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    pointer(s.preview, "pointerdown", { x: 305, y: 50 }); // jsdom: offsetX = clientX
    pointer(s.preview, "pointerup", { x: 305, y: 50 });
    expect(commit).not.toHaveBeenCalled();
    expect(s.editor()).toBe(ta);
    pointer(s.preview, "pointerdown", { x: 250, y: 50 });
    expect(commit).toHaveBeenCalledWith(block.id, "Hello changed.", expect.anything()); // + the anchor taken before closing
  });

  it("AT-BEC-31 editing A, a failed gesture on B (moved 6 px) commits A at pointerdown and opens nothing", async () => {
    s = await setupEdit(DOC);
    const a = openBlock(isPara("Hello"));
    a.ta.value = "Hello changed.";
    const b = s.block(isPara("Second"));
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    pointer(b.el.firstElementChild, "pointerdown", { x: 10, y: 10 });
    expect(commit).toHaveBeenCalledWith(a.block.id, "Hello changed.", expect.anything()); // + the anchor taken before closing
    pointer(b.el.firstElementChild, "pointerup", { x: 16, y: 10 });
    expect(s.editor()).toBeNull();
    expect(s.bec.isEditing()).toBe(false);
  });

  it("AT-BEC-32 moving the focus out of the editor keeps it open and does not commit; Shift+Tab is not taken", async () => {
    s = await setupEdit(DOC);
    const { ta } = openBlock(isPara("Hello"));
    ta.value = "Hello changed.";
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    const e = keydown(ta, "Tab", { shiftKey: true });
    expect(e.defaultPrevented).toBe(false);
    ta.blur();
    expect(document.activeElement).toBe(document.body);
    expect(s.editor()).toBe(ta);
    expect(s.bec.isEditing()).toBe(true);
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("AT-BEC keys in the editor (INV-27, INV-28, INV-53)", () => {
  const IME_WAYS = [
    ["isComposing", (ta, key, init = {}) => keydown(ta, key, { ...init, isComposing: true })],
    ["keyCode 229", (ta, key, init = {}) => keydown(ta, key, { ...init, keyCode: 229 })],
    [
      "between compositionstart and compositionend",
      (ta, key, init = {}) => {
        ta.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        return keydown(ta, key, init);
      },
    ],
  ];

  it("AT-BEC-14 Esc after a change applies it and closes the editor (INV-28, owner ruling D1); an unchanged one commits nothing", async () => {
    s = await setupEdit(DOC);
    const { el } = s.block(isPara("Hello"));
    const p = el.firstElementChild;
    tap(p);
    const ta = s.editor();
    ta.value = "Hello changed.";
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    const e = keydown(ta, "Escape");
    expect(e.defaultPrevented).toBe(true);
    expect(s.editor()).toBeNull();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(s.orchestrator.getBody()).toBe(DOC.replace("Hello world.", "Hello changed."));
    await flush();
    expect(s.block(isPara("Hello")).el.textContent.trim()).toBe("Hello changed.");

    const second = openBlock(isPara("Hello"));
    keydown(second.ta, "Escape");
    expect(s.editor()).toBeNull();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it.each(IME_WAYS)("AT-BEC-15 Esc during IME (%s) does nothing", async (_name, press) => {
    s = await setupEdit(DOC);
    const { ta } = openBlock(isPara("Hello"));
    ta.value = "Hello changed.";
    press(ta, "Escape");
    expect(s.editor()).toBe(ta);
    expect(ta.value).toBe("Hello changed.");
  });

  it("AT-BEC-15 after compositionend, Esc cancels again", async () => {
    s = await setupEdit(DOC);
    const { ta } = openBlock(isPara("Hello"));
    ta.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    ta.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    keydown(ta, "Escape");
    expect(s.editor()).toBeNull();
  });

  it("AT-BEC-16 Enter in a table is the browser's newline (B2); Shift+Enter inserts the line break text at the caret and stops the default; not in a heading (a paragraph: INV-71)", async () => {
    s = await setupEdit("| A | B |\n|---|---|\n| x | y |\n\n# Plain head\n");
    const t = openBlock((b) => b.type === "table");
    const caret = t.ta.value.indexOf("x") + 1;
    t.ta.setSelectionRange(caret, caret);
    const plain = keydown(t.ta, "Enter");
    expect(plain.defaultPrevented).toBe(false);
    expect(t.ta.value).toBe("| A | B |\n|---|---|\n| x | y |");
    const e = keydown(t.ta, "Enter", { shiftKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(CONFIG.edit.tableLineBreak).toBe("<br>");
    expect(t.ta.value).toBe("| A | B |\n|---|---|\n| x<br> | y |");
    expect(t.ta.selectionStart).toBe(caret + 4);
    expect(t.ta.selectionEnd).toBe(caret + 4);
    expect(s.host.onEditorInput).toHaveBeenCalled();

    keydown(t.ta, "Escape");
    const p = openBlock((b) => b.type === "heading");
    const before = p.ta.value;
    const e2 = keydown(p.ta, "Enter");
    expect(e2.defaultPrevented).toBe(false);
    expect(p.ta.value).toBe(before);
  });

  it.each(IME_WAYS)("AT-BEC-17 Shift+Enter in a table during IME (%s) inserts nothing", async (_name, press) => {
    s = await setupEdit("| A | B |\n|---|---|\n| x | y |\n");
    const t = openBlock((b) => b.type === "table");
    const before = t.ta.value;
    const e = press(t.ta, "Enter", { shiftKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(t.ta.value).toBe(before);
  });

  it("AT-BEC-18 Tab is not taken (INV-53): Tab, Shift+Tab and Tab during IME are left to the browser", async () => {
    s = await setupEdit(DOC);
    const { ta } = openBlock(isPara("Hello"));
    for (const init of [{}, { shiftKey: true }, { isComposing: true }]) {
      const e = keydown(ta, "Tab", init);
      expect(e.defaultPrevented, JSON.stringify(init)).toBe(false);
    }
    expect(s.host.palette.contains(document.activeElement)).toBe(false);
    expect(s.bec.isEditing()).toBe(true);
  });
});

describe("AT-BEC editor value and life cycle", () => {
  it("AT-BEC-19 the height follows scrollHeight on open and on every input; no inner scroll bar", async () => {
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.value.split("\n").length * 20;
      },
    });
    try {
      s = await setupEdit(DOC);
      const { ta } = openBlock(isPara("Hello"));
      expect(ta.style.height).toBe("20px");
      ta.value = "a\nb\nc";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      expect(ta.style.height).toBe("60px");
      expect(ta.style.overflowY).toBe("hidden");
      expect(s.host.onEditorInput).toHaveBeenCalledTimes(1);
      // border-box: the borders (offsetHeight - clientHeight) are added
      Object.defineProperty(ta, "offsetHeight", { configurable: true, value: 64 });
      Object.defineProperty(ta, "clientHeight", { configurable: true, value: 62 });
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      expect(ta.style.height).toBe("62px");
    } finally {
      delete HTMLTextAreaElement.prototype.scrollHeight;
    }
  });

  it("AT-BEC-20 hasUncommittedChange: false on open, true after a change, false when changed back", async () => {
    s = await setupEdit(DOC);
    expect(s.bec.hasUncommittedChange()).toBe(false);
    const { ta } = openBlock(isPara("Hello"));
    expect(s.bec.hasUncommittedChange()).toBe(false);
    ta.value = "Hello world!";
    expect(s.bec.hasUncommittedChange()).toBe(true);
    ta.value = "Hello world.";
    expect(s.bec.hasUncommittedChange()).toBe(false);
  });

  it("AT-BEC-21 getSelectionRange returns text and selection only; applyTextEdit sets them, keeps focus, does not commit", async () => {
    s = await setupEdit(DOC);
    expect(s.bec.getSelectionRange()).toBeNull();
    const { ta } = openBlock(isPara("Hello"));
    ta.setSelectionRange(0, 5);
    const range = s.bec.getSelectionRange();
    expect(range).toEqual({ text: "Hello world.", selStart: 0, selEnd: 5 });
    expect(Object.values(range).some((v) => v instanceof Node)).toBe(false);
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    s.bec.applyTextEdit({ text: "**Hello** world.", selStart: 2, selEnd: 7 });
    expect(ta.value).toBe("**Hello** world.");
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([2, 7]);
    expect(document.activeElement).toBe(ta);
    expect(commit).not.toHaveBeenCalled();
    expect(s.bec.isEditing()).toBe(true);
    expect(s.bec.hasUncommittedChange()).toBe(true);
  });

  it("isEditingTable and getLastOpenedBlockId (5.15.5, INV-52)", async () => {
    s = await setupEdit("| A | B |\n|---|---|\n| x | y |\n\nPara.\n");
    expect(s.bec.isEditingTable()).toBe(false);
    expect(s.bec.getLastOpenedBlockId()).toBeNull();
    const t = openBlock((b) => b.type === "table");
    expect(s.bec.isEditingTable()).toBe(true);
    keydown(t.ta, "Escape");
    expect(s.bec.isEditingTable()).toBe(false);
    expect(s.bec.getLastOpenedBlockId()).toBe(t.block.id);
    const p = openBlock(isPara("Para"));
    expect(s.bec.isEditingTable()).toBe(false);
    expect(s.bec.getLastOpenedBlockId()).toBe(p.block.id);
  });

  it("AT-BEC-22 listeners added on open are all removed on close; 10 open/close cycles add none", async () => {
    s = await setupEdit(DOC);
    const tracker = trackListeners();
    const onTextarea = (t) => t instanceof HTMLTextAreaElement;
    const onDocument = (t) => t === document || t === window;
    const before = tracker.active(onDocument);
    for (let i = 0; i < 10; i++) {
      const { ta } = openBlock(isPara(i % 2 ? "Second" : "Hello"));
      expect(tracker.active(onTextarea)).toBeGreaterThan(0);
      if (i % 2) keydown(ta, "Escape");
      else pointer(document.body, "pointerdown");
      expect(tracker.active(onTextarea)).toBe(0);
    }
    expect(tracker.active(onDocument)).toBe(before);
    tracker.restore();
  });

  it("AT-BEC-23 a click on a rendered Mermaid diagram opens the Mermaid code", async () => {
    s = await setupEdit(loadFixtureLf("diagrams.md"));
    const diagram = s.preview.querySelector(".mermaid");
    expect(diagram).not.toBeNull();
    tap(diagram);
    expect(s.editor().value).toBe("```mermaid\nflowchart TD\n    A -->|go| B\n```");
  });

  it("AT-BEC-24 a click on the hidden band of a link definition opens the definition", async () => {
    s = await setupEdit(loadFixtureLf("ref-links.md"));
    const band = s.preview.querySelector('.md-block-hidden[data-hidden-kind="link"]');
    expect(band).not.toBeNull();
    tap(band);
    expect(s.editor().value).toBe("[d]: https://example.com/x");
  });

  it("AT-BEC-25 the second list item opens the whole list; inside details opens the whole HTML block", async () => {
    s = await setupEdit(loadFixtureLf("list-quote.md"));
    tap(s.preview.querySelectorAll("li")[1]);
    expect(s.editor().value).toBe("- item one\n- item two\n- item three");
    s.teardown();

    s = await setupEdit(loadFixtureLf("html-details.md"));
    tap(s.preview.querySelector("details"));
    const value = s.editor().value;
    expect(value.startsWith("<details>")).toBe(true);
    expect(value.endsWith("</details>")).toBe(true);
  });

  it("AT-BEC-26 opening captures the anchor before the swap and restores it after", async () => {
    s = await setupEdit(DOC);
    const seen = [];
    const anchor = { offsetTop: 123 };
    vi.spyOn(s.scrollMemento, "captureAnchor").mockImplementation((el) => {
      seen.push(["capture", el, Boolean(el.querySelector("textarea"))]);
      return anchor;
    });
    vi.spyOn(s.scrollMemento, "restoreAnchor").mockImplementation((a, el) => {
      seen.push(["restore", el, Boolean(el.querySelector("textarea")), a]);
    });
    const { el } = s.block(isPara("Hello"));
    tap(el.firstElementChild);
    expect(seen).toEqual([
      ["capture", el, false],
      ["restore", el, true, anchor],
    ]);
  });

  it("AT-BEC-27 an unchanged commit closes the editor, brings the original element back and renders nothing", async () => {
    s = await setupEdit(DOC);
    const { el } = s.block(isPara("Hello"));
    const p = el.firstElementChild;
    tap(p);
    const model = s.orchestrator.getModel();
    const render = vi.spyOn(s.markdownRenderer, "replaceBlocks");
    pointer(document.body, "pointerdown");
    await flush();
    expect(s.editor()).toBeNull();
    expect(el.firstElementChild).toBe(p);
    expect(s.orchestrator.getModel()).toBe(model);
    expect(render).not.toHaveBeenCalled();
    expect(s.orchestrator.canUndo()).toBe(false);
  });
});

describe("INV-52 edits from the palette and the table Enter are undoable (execCommand insertText)", () => {
  /** A stand-in for the browser's insertText: replaces the selection of the focused textarea. */
  function stubExecCommand(result = true) {
    const calls = [];
    document.execCommand = vi.fn((command, showUi, text) => {
      const ta = document.activeElement;
      calls.push({ command, showUi, text, selection: [ta.selectionStart, ta.selectionEnd] });
      if (result) ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
      return result;
    });
    return calls;
  }

  afterEach(() => {
    delete document.execCommand;
  });

  it("applyTextEdit selects only the changed range and inserts it with insertText; then sets the edit's selection", async () => {
    s = await setupEdit(DOC);
    const { ta } = openBlock(isPara("Hello"));
    const calls = stubExecCommand(true);
    s.bec.applyTextEdit({ text: "Hello **world.**", selStart: 8, selEnd: 14 });
    expect(calls).toEqual([{ command: "insertText", showUi: false, text: "**world.**", selection: [6, 12] }]);
    expect(ta.value).toBe("Hello **world.**");
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([8, 14]);
    expect(document.activeElement).toBe(ta);
  });

  it("when insertText is refused (false), the value is assigned instead", async () => {
    s = await setupEdit(DOC);
    const { ta } = openBlock(isPara("Hello"));
    stubExecCommand(false);
    s.bec.applyTextEdit({ text: "Hello **world.**", selStart: 8, selEnd: 14 });
    expect(ta.value).toBe("Hello **world.**");
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([8, 14]);
  });

  it("without execCommand (jsdom, old browsers) the value is assigned", async () => {
    s = await setupEdit(DOC);
    const { ta } = openBlock(isPara("Hello"));
    expect(document.execCommand).toBeUndefined();
    s.bec.applyTextEdit({ text: "Hi world.", selStart: 2, selEnd: 2 });
    expect(ta.value).toBe("Hi world.");
  });

  it("table Shift+Enter inserts <br> through insertText (undoable)", async () => {
    s = await setupEdit("| A | B |\n|---|---|\n| x | y |\n");
    const t = openBlock((b) => b.type === "table");
    const calls = stubExecCommand(true);
    const caret = t.ta.value.indexOf("x") + 1;
    t.ta.setSelectionRange(caret, caret);
    keydown(t.ta, "Enter", { shiftKey: true });
    expect(calls).toEqual([{ command: "insertText", showUi: false, text: "<br>", selection: [caret, caret] }]);
    expect(t.ta.value).toBe("| A | B |\n|---|---|\n| x<br> | y |");
  });
});

describe("Q-d1 the block being edited keeps its wrapper during partial renders", () => {
  const REF_DOC = "Use [x][d].\n\nOther [y][d].\n\n[d]: https://example.com/old\n";

  it.each(["Escape", "commit"])(
    "editing the definition, then B: B's editor stays through the render; after %s B shows the new definition",
    async (close) => {
      s = await setupEdit(REF_DOC);
      const def = openBlock((b) => b.type === "def");
      def.ta.value = "[d]: https://example.com/new";
      const b = s.block(isPara("Other"));
      tap(b.el.firstElementChild, { pointerType: "touch" }); // commits the definition, opens B
      const ta = s.editor();
      expect(b.el.contains(ta)).toBe(true);
      await flush();
      expect(s.editor()).toBe(ta);
      expect(ta.isConnected).toBe(true);
      expect(s.markdownRenderer.getBlockElement(b.block.id)).toBe(b.el);
      const useLink = s.block(isPara("Use")).el.querySelector("a");
      expect(useLink.getAttribute("href")).toBe("https://example.com/new");

      if (close === "Escape") keydown(ta, "Escape");
      else {
        ta.value = "Other [z][d].";
        pointer(document.body, "pointerdown");
      }
      await flush();
      const bEl = s.markdownRenderer.getBlockElement(s.block(isPara("Other")).block.id);
      expect(bEl.querySelector("a").getAttribute("href")).toBe("https://example.com/new");
      expect(bEl.querySelector("textarea")).toBeNull();
    },
  );
});

describe("AT-BEC-28 spoofed attributes have no effect (Q1, T2)", () => {
  const SPOOF = loadFixtureLf("spoof-block-id.md");
  const htmlBlock = (needle) => (b) => b.type === "html" && b.raw.includes(needle);

  it("(1) a user-written div with data-block-id of paragraph A opens its own HTML block", async () => {
    s = await setupEdit(SPOOF);
    const a = s.block(isPara("Paragraph A"));
    const fake = s.preview.querySelector('.md-block div[data-block-id="1"]');
    expect(a.block.id).toBe(1);
    expect(fake.parentNode).not.toBe(s.preview);
    tap(fake);
    expect(s.editor().value).toBe('<div class="md-block" data-block-id="1">fake</div>');
    expect(a.el.querySelector("textarea")).toBeNull();
  });

  it("(2) editing B, pointerdown on a user-written textarea.md-block-editor is outside: B commits", async () => {
    s = await setupEdit(SPOOF);
    const b = openBlock(isPara("Paragraph B"));
    b.ta.value = "Paragraph B changed.";
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    const fake = s.block(htmlBlock("<textarea")).el.querySelector("textarea");
    pointer(fake, "pointerdown");
    expect(commit).toHaveBeenCalledWith(b.block.id, "Paragraph B changed.", expect.anything()); // + the anchor taken before closing
  });

  it("(3) editing B, a click on a user-written toolbar commits B at pointerdown, then opens that HTML block", async () => {
    s = await setupEdit(SPOOF);
    const b = openBlock(isPara("Paragraph B"));
    b.ta.value = "Paragraph B changed.";
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    const fakeBlock = s.block(htmlBlock('role="toolbar"'));
    const fakeToolbar = fakeBlock.el.querySelector('[role="toolbar"]');
    pointer(fakeToolbar, "pointerdown");
    expect(commit).toHaveBeenCalledWith(b.block.id, "Paragraph B changed.", expect.anything()); // + the anchor taken before closing
    pointer(fakeToolbar, "pointerup");
    expect(fakeBlock.el.contains(s.editor())).toBe(true);
    expect(s.editor().value).toContain('role="toolbar"');
  });

  it("(4) a user-written .plantuml-pending stays excluded: nothing opens", async () => {
    s = await setupEdit(SPOOF);
    tap(s.preview.querySelector(".plantuml-pending"));
    expect(s.editor()).toBeNull();
  });
});
