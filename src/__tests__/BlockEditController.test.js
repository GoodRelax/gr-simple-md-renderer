import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return { ...actual, applyTheme: vi.fn(), waitForDOMStability: vi.fn().mockResolvedValue(true) };
});

import BlockEditController from "../js/classes/BlockEditController.js";
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
  tap(el.firstElementChild ?? el);
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
    expect(getComputedStyle(ta).fontFamily).toContain("monospace");
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
    expect(commit).toHaveBeenCalledWith(block.id, "Hello changed.");
    expect(s.editor()).toBeNull();
    target.remove();
  });

  it("AT-BEC-09 mouse pointerdown on another preview element commits at once", async () => {
    s = await setupEdit(DOC);
    const { block, ta } = openBlock(isPara("Hello"));
    ta.value = "Hello changed.";
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    pointer(s.block(isPara("Third")).el.firstElementChild, "pointerdown");
    expect(commit).toHaveBeenCalledWith(block.id, "Hello changed.");
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
    expect(commit).toHaveBeenCalledWith(block.id, "Hello changed.");
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
    expect(commit).toHaveBeenCalledWith(a.block.id, "Hello changed.");
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
    expect(commit).toHaveBeenCalledWith(a.block.id, "Hello changed.");
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
    expect(commit).toHaveBeenCalledWith(block.id, "Hello changed.");
  });

  it("AT-BEC-31 editing A, a failed gesture on B (moved 6 px) commits A at pointerdown and opens nothing", async () => {
    s = await setupEdit(DOC);
    const a = openBlock(isPara("Hello"));
    a.ta.value = "Hello changed.";
    const b = s.block(isPara("Second"));
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    pointer(b.el.firstElementChild, "pointerdown", { x: 10, y: 10 });
    expect(commit).toHaveBeenCalledWith(a.block.id, "Hello changed.");
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
    ["isComposing", (ta, key) => keydown(ta, key, { isComposing: true })],
    ["keyCode 229", (ta, key) => keydown(ta, key, { keyCode: 229 })],
    [
      "between compositionstart and compositionend",
      (ta, key) => {
        ta.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        return keydown(ta, key);
      },
    ],
  ];

  it("AT-BEC-14 Esc after a change closes the editor, brings the original element back and commits nothing", async () => {
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
    expect(el.firstElementChild).toBe(p);
    expect(p.textContent).toBe("Hello world.");
    expect(commit).not.toHaveBeenCalled();
    expect(s.orchestrator.getBody()).toBe(DOC);
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

  it("AT-BEC-16 Enter in a table inserts the line break text at the caret and stops the default; not in a paragraph", async () => {
    s = await setupEdit("| A | B |\n|---|---|\n| x | y |\n\nPlain para.\n");
    const t = openBlock((b) => b.type === "table");
    const caret = t.ta.value.indexOf("x") + 1;
    t.ta.setSelectionRange(caret, caret);
    const e = keydown(t.ta, "Enter");
    expect(e.defaultPrevented).toBe(true);
    expect(CONFIG.edit.tableLineBreak).toBe("<br>");
    expect(t.ta.value).toBe("| A | B |\n|---|---|\n| x<br> | y |");
    expect(t.ta.selectionStart).toBe(caret + 4);
    expect(t.ta.selectionEnd).toBe(caret + 4);
    expect(s.host.onEditorInput).toHaveBeenCalled();

    keydown(t.ta, "Escape");
    const p = openBlock(isPara("Plain"));
    const before = p.ta.value;
    const e2 = keydown(p.ta, "Enter");
    expect(e2.defaultPrevented).toBe(false);
    expect(p.ta.value).toBe(before);
  });

  it.each(IME_WAYS)("AT-BEC-17 Enter in a table during IME (%s) inserts nothing", async (_name, press) => {
    s = await setupEdit("| A | B |\n|---|---|\n| x | y |\n");
    const t = openBlock((b) => b.type === "table");
    const before = t.ta.value;
    const e = press(t.ta, "Enter");
    expect(e.defaultPrevented).toBe(false);
    expect(t.ta.value).toBe(before);
  });

  it("AT-BEC-18 Tab moves the focus to the palette; Shift+Tab and Tab during IME are not taken", async () => {
    s = await setupEdit(DOC);
    const { ta } = openBlock(isPara("Hello"));
    const shift = keydown(ta, "Tab", { shiftKey: true });
    expect(shift.defaultPrevented).toBe(false);
    const ime = keydown(ta, "Tab", { isComposing: true });
    expect(ime.defaultPrevented).toBe(false);
    expect(s.host.focusPalette).not.toHaveBeenCalled();
    const e = keydown(ta, "Tab");
    expect(e.defaultPrevented).toBe(true);
    expect(s.host.focusPalette).toHaveBeenCalledTimes(1);
    expect(s.host.palette.contains(document.activeElement)).toBe(true);
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
    expect(commit).toHaveBeenCalledWith(b.block.id, "Paragraph B changed.");
  });

  it("(3) editing B, a click on a user-written toolbar commits B at pointerdown, then opens that HTML block", async () => {
    s = await setupEdit(SPOOF);
    const b = openBlock(isPara("Paragraph B"));
    b.ta.value = "Paragraph B changed.";
    const commit = vi.spyOn(s.orchestrator, "commitBlock");
    const fakeBlock = s.block(htmlBlock('role="toolbar"'));
    const fakeToolbar = fakeBlock.el.querySelector('[role="toolbar"]');
    pointer(fakeToolbar, "pointerdown");
    expect(commit).toHaveBeenCalledWith(b.block.id, "Paragraph B changed.");
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

describe("BlockEditController.isDoubleTap (INV-31, CONFIG.edit)", () => {
  const first = { time: 1000, x: 100, y: 100 };
  it("uses CONFIG.edit: 300 ms and 24 px", () => {
    expect(CONFIG.edit.doubleTapMaxIntervalMs).toBe(300);
    expect(CONFIG.edit.doubleTapMaxDistancePx).toBe(24);
  });
  it.each([
    [{ time: 1300, x: 100, y: 124 }, true],
    [{ time: 1300, x: 124, y: 100 }, true],
    [{ time: 1301, x: 100, y: 100 }, false],
    [{ time: 1000, x: 100, y: 125 }, false],
    [{ time: 1000, x: 118, y: 118 }, false], // 25.5 px (Euclidean)
  ])("second tap %o -> %s", (second, expected) => {
    expect(BlockEditController.isDoubleTap(first, second)).toBe(expected);
  });
  it("no first tap -> false", () => {
    expect(BlockEditController.isDoubleTap(null, first)).toBe(false);
  });
});
