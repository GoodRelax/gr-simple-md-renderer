import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import CodeEditor from "../js/classes/CodeEditor.js";
import CodeEditHistory from "../js/classes/CodeEditHistory.js";
import { CONFIG } from "../js/config.js";
import { escapeHtml } from "../js/utils.js";
import { keydown } from "./helpers/editDom.js";

// AT-CED: the code editor (SC-27, INV-85 to INV-88, INV-92): the textarea
// over the highlighted layer, the gutter, the keys and its own Undo.

const PAUSE = CONFIG.codeEdit.highlightPauseMs;

let preview;
let host;
let history;
let clock;
let editor;

/** A highlighter that marks its whole input, so a colored layer is told from a plain one. */
const colored = (text) => `<span class="hljs-string">${escapeHtml(text)}</span>`;

beforeEach(() => {
  preview = document.createElement("div");
  preview.innerHTML = '<div id="codeViewBody"><span class="code-line">x</span></div>';
  document.body.append(preview);
  host = {
    highlight: vi.fn(colored),
    canFold: vi.fn(() => true),
    onFold: vi.fn(),
    onTextChanged: vi.fn(),
    onTextSettled: vi.fn(),
  };
  clock = 0;
  history = new CodeEditHistory({ limit: CONFIG.edit.undoMaxSteps, pauseMs: CONFIG.codeEdit.undoPauseMs, now: () => clock });
});

afterEach(() => {
  editor?.stop();
  editor = null;
  preview.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function start(text, { isApple = false } = {}) {
  editor = new CodeEditor(preview, host, { isApple });
  history.reset(text, 0, 0);
  editor.start(text, history);
  return editor;
}

const input = () => preview.querySelector("#codeEditBody textarea.code-edit-input");
const layer = () => preview.querySelector("#codeEditBody pre.code-edit-layer > code");
const gutter = () => preview.querySelector("#codeEditBody .code-edit-gutter");

/**
 * Type: beforeinput (the selection still the one before), then the value
 * changes and an input event follows, as the browser does.
 */
function type(value, caret = value.length) {
  const ta = input();
  const grown = value.length - ta.value.length;
  // the text typed before the caret (as InputEvent.data); a deletion has none
  const init = grown > 0 ? { inputType: "insertText", data: value.slice(caret - grown, caret) } : { inputType: "deleteContentBackward" };
  ta.dispatchEvent(new InputEvent("beforeinput", { ...init, bubbles: true, cancelable: true }));
  ta.value = value;
  ta.setSelectionRange(caret, caret);
  ta.dispatchEvent(new InputEvent("input", { ...init, bubbles: true }));
}

const body = () => preview.querySelector("#codeEditBody");
const extraLines = () => input().parentElement.style.getPropertyValue("--code-extra-lines");

describe("CodeEditor: the surface (INV-85, INV-86)", () => {
  it("AT-CED-01 start: the editor takes the view's place; textarea, colored layer and gutter; no spell check, no wrap", () => {
    start("a\nb\n");
    expect(preview.querySelector("#codeViewBody")).toBeNull();
    expect([...preview.children].map((el) => el.id)).toEqual(["codeEditBody"]);
    const ta = input();
    expect([ta.value, ta.spellcheck, ta.getAttribute("wrap"), ta.getAttribute("aria-label")]).toEqual(["a\nb\n", false, "off", CONFIG.messages.codeEdit.editorLabel]);
    expect(layer().innerHTML).toBe('<span class="hljs-string">a\nb\n</span>\n');
    expect(gutter().textContent).toBe("1\n2\n3");
    expect([gutter().getAttribute("aria-hidden"), layer().parentElement.getAttribute("aria-hidden")]).toEqual(["true", "true"]);
    expect(document.activeElement).toBe(ta);
    expect(editor.isActive()).toBe(true);
  });

  it("AT-CED-02 typing (M1): the layer is not written; the textarea's text shows instead; the layer is colored again once typing stops for highlightPauseMs", () => {
    vi.useFakeTimers();
    start("a");
    host.highlight.mockClear();
    const colored = layer().innerHTML;
    type("a<b");
    expect(layer().innerHTML).toBe(colored);
    expect(body().classList.contains("code-edit-typing")).toBe(true);
    expect(editor.rangeOf(0, 1)).toBeNull(); // the layer does not hold the text now
    expect(host.onTextChanged).toHaveBeenLastCalledWith("a<b");
    type("a<bc");
    vi.advanceTimersByTime(PAUSE - 1);
    expect([host.highlight.mock.calls.length, host.onTextSettled.mock.calls.length]).toEqual([0, 0]);
    vi.advanceTimersByTime(1);
    expect(host.highlight.mock.calls).toEqual([["a<bc"]]);
    expect(layer().innerHTML).toBe('<span class="hljs-string">a&lt;bc</span>\n');
    expect(body().classList.contains("code-edit-typing")).toBe(false);
    expect(editor.rangeOf(0, 1).toString()).toBe("a");
    expect(host.onTextSettled).toHaveBeenCalledTimes(1);
  });

  it("AT-CED-03 the gutter is written when typing stops, and only when the number of lines changed; a line typed makes room at once (M1)", () => {
    vi.useFakeTimers();
    start("a\nb");
    const before = gutter().firstChild;
    type("a\nbc");
    vi.advanceTimersByTime(PAUSE);
    expect(gutter().firstChild).toBe(before);
    type("a\nbc\n");
    expect([gutter().firstChild, extraLines()]).toEqual([before, "1"]);
    type("a\nbc\n\n");
    expect(extraLines()).toBe("2");
    vi.advanceTimersByTime(PAUSE);
    expect(gutter().firstChild).not.toBe(before);
    expect([gutter().textContent, extraLines()]).toEqual(["1\n2\n3\n4", ""]);
  });

  it("AT-CED-04 over highlightMaxChars: plain (the textarea's text shows), never colored; the layer is empty but for print; the lines give the height", () => {
    vi.useFakeTimers();
    const big = "x".repeat(CONFIG.codeEdit.highlightMaxChars) + "\n";
    start(big);
    expect(body().classList.contains("code-edit-plain")).toBe(true);
    expect(host.highlight).not.toHaveBeenCalled();
    expect(layer().textContent).toBe("");
    expect(input().parentElement.style.getPropertyValue("--code-lines")).toBe("2");
    type(big + "y");
    vi.advanceTimersByTime(PAUSE);
    expect(layer().textContent).toBe("");
    window.dispatchEvent(new Event("beforeprint"));
    expect(layer().textContent).toBe(big + "y\n");
    window.dispatchEvent(new Event("afterprint"));
    expect(layer().textContent).toBe("");
    expect(host.highlight).not.toHaveBeenCalled();
    expect(editor.rangeOf(0, 1)).toBeNull();
  });

  it("AT-CED-05 a text shrinking under the limit is colored again when typing stops", () => {
    vi.useFakeTimers();
    const big = "x".repeat(CONFIG.codeEdit.highlightMaxChars + 1);
    start(big);
    type("short");
    expect(body().classList.contains("code-edit-plain")).toBe(true);
    vi.advanceTimersByTime(PAUSE);
    expect(body().classList.contains("code-edit-plain")).toBe(false);
    expect(layer().innerHTML).toBe('<span class="hljs-string">short</span>\n');
  });

  it("AT-CED-06 stop: the text edited is returned, the editor leaves the preview, no pause fires after", () => {
    vi.useFakeTimers();
    start("a");
    type("ab");
    expect(editor.stop()).toBe("ab");
    expect(preview.querySelector("#codeEditBody")).toBeNull();
    expect([editor.isActive(), editor.text()]).toEqual([false, ""]);
    vi.advanceTimersByTime(PAUSE * 2);
    expect(host.onTextSettled).not.toHaveBeenCalled();
  });

  it("AT-CED-07 highlight.js not there (null): the layer keeps the plain text", () => {
    vi.useFakeTimers();
    host.highlight.mockReturnValue(null);
    start("a<");
    expect(layer().innerHTML).toBe("a&lt;\n");
    type("a<b");
    vi.advanceTimersByTime(PAUSE);
    expect(layer().innerHTML).toBe("a&lt;b\n");
  });
});

describe("CodeEditor: keys (INV-87, INV-92)", () => {
  it("AT-CED-08 Tab / Shift+Tab indent / outdent the selected lines by the file's unit (2 spaces here), one undo step each", () => {
    start("{\n  a\nb\n}");
    const ta = input();
    ta.setSelectionRange(6, 9); // "b\n}"
    const e = keydown(ta, "Tab");
    expect(e.defaultPrevented).toBe(true);
    expect(ta.value).toBe("{\n  a\n  b\n  }");
    expect(host.onTextChanged).toHaveBeenLastCalledWith("{\n  a\n  b\n  }");
    expect(keydown(ta, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(ta.value).toBe("{\n  a\nb\n}");
    editor.undo();
    expect(ta.value).toBe("{\n  a\n  b\n  }");
    editor.undo();
    expect(ta.value).toBe("{\n  a\nb\n}");
    expect(editor.canUndo()).toBe(false);
  });

  it("AT-CED-09 Enter carries the line's indent to the new line, as typing", () => {
    start("    x");
    const ta = input();
    ta.setSelectionRange(5, 5);
    const e = keydown(ta, "Enter");
    expect(e.defaultPrevented).toBe(true);
    expect([ta.value, ta.selectionStart]).toEqual(["    x\n    ", 10]);
    expect(host.onTextChanged).toHaveBeenLastCalledWith("    x\n    ");
    expect(extraLines()).toBe("1"); // room for the new line at once; the gutter when typing stops
  });

  it("AT-CED-10 Shift+Enter and Enter with a modifier are the browser's", () => {
    start("x");
    expect(keydown(input(), "Enter", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(keydown(input(), "Enter", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(input().value).toBe("x");
  });

  it("AT-CED-11 Esc: the focus leaves the textarea; edit mode stays", () => {
    start("x");
    const e = keydown(input(), "Escape");
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(input());
    expect(editor.isActive()).toBe(true);
  });

  it("AT-CED-12 IME composition: keys are not taken", () => {
    start("x");
    expect(keydown(input(), "Tab", { isComposing: true }).defaultPrevented).toBe(false);
    expect(keydown(input(), "Enter", { keyCode: 229 }).defaultPrevented).toBe(false);
    expect(input().value).toBe("x");
  });

  it("AT-CED-13 fold keys by place: Ctrl+Shift+[ folds, Ctrl+Shift+] unfolds; not taken when the file cannot fold; Ctrl+Left stays the browser's", () => {
    start("{}");
    const ta = input();
    expect(keydown(ta, "{", { code: "BracketLeft", ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(keydown(ta, "}", { code: "BracketRight", ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(host.onFold.mock.calls).toEqual([["fold"], ["unfold"]]);
    expect(keydown(ta, "ArrowLeft", { ctrlKey: true }).defaultPrevented).toBe(false);
    host.canFold.mockReturnValue(false);
    expect(keydown(ta, "{", { code: "BracketLeft", ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(host.onFold).toHaveBeenCalledTimes(2);
  });

  it("AT-CED-14 Mac: Cmd+Option+[ / ] fold and unfold; Ctrl+Shift+[ is not taken", () => {
    start("{}", { isApple: true });
    const ta = input();
    expect(keydown(ta, "[", { code: "BracketLeft", metaKey: true, altKey: true }).defaultPrevented).toBe(true);
    expect(keydown(ta, "]", { code: "BracketRight", metaKey: true, altKey: true }).defaultPrevented).toBe(true);
    expect(keydown(ta, "{", { code: "BracketLeft", ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(host.onFold.mock.calls).toEqual([["fold"], ["unfold"]]);
  });

  it("AT-CED-15 primary+Z / primary+Shift+Z / Ctrl+Y: its own Undo and Redo", () => {
    start("a");
    type("ab");
    const ta = input();
    expect(keydown(ta, "z", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(ta.value).toBe("a");
    expect(keydown(ta, "z", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(ta.value).toBe("ab");
    keydown(ta, "z", { ctrlKey: true });
    expect(keydown(ta, "y", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(ta.value).toBe("ab");
    expect(host.onTextChanged).toHaveBeenLastCalledWith("ab");
  });

  it("AT-CED-16 Mac: Cmd+Z / Cmd+Shift+Z; Ctrl+Z and Cmd+Y are not taken", () => {
    start("a", { isApple: true });
    type("ab");
    const ta = input();
    expect(keydown(ta, "z", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(keydown(ta, "y", { metaKey: true }).defaultPrevented).toBe(false);
    expect(ta.value).toBe("ab");
    keydown(ta, "z", { metaKey: true });
    expect(ta.value).toBe("a");
    keydown(ta, "z", { metaKey: true, shiftKey: true });
    expect(ta.value).toBe("ab");
  });

  it("AT-CED-17 the browser's Undo (beforeinput historyUndo / historyRedo) is replaced by its own", () => {
    start("a");
    type("ab");
    const undo = new InputEvent("beforeinput", { inputType: "historyUndo", cancelable: true, bubbles: true });
    input().dispatchEvent(undo);
    expect([undo.defaultPrevented, input().value]).toEqual([true, "a"]);
    const redo = new InputEvent("beforeinput", { inputType: "historyRedo", cancelable: true, bubbles: true });
    input().dispatchEvent(redo);
    expect([redo.defaultPrevented, input().value]).toEqual([true, "ab"]);
  });
});

describe("CodeEditor: Undo steps (INV-88)", () => {
  it("AT-CED-18 typing is one step until it pauses for undoPauseMs", () => {
    start("");
    type("a");
    clock += CONFIG.codeEdit.undoPauseMs - 1;
    type("ab");
    clock += CONFIG.codeEdit.undoPauseMs;
    type("abc");
    editor.undo();
    expect(input().value).toBe("ab");
    editor.undo();
    expect(input().value).toBe("");
    expect(editor.canUndo()).toBe(false);
  });

  it("AT-CED-19 a caret move (arrow key, press in the textarea, a selection made) ends the typing step", () => {
    start("");
    type("a");
    keydown(input(), "ArrowLeft");
    type("ba", 1);
    input().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    type("bac");
    editor.select(0, 0);
    type("xbac", 1);
    const seen = [];
    while (editor.undo()) seen.push(input().value);
    expect(seen).toEqual(["bac", "ba", "a", ""]);
  });

  it("AT-CED-20 setText is one step; Undo puts the text and the selection of that moment back (M2)", () => {
    start("abc");
    input().setSelectionRange(1, 2);
    editor.setText("aXc", 1, 2);
    expect(input().value).toBe("aXc");
    editor.undo();
    expect([input().value, input().selectionStart, input().selectionEnd]).toEqual(["abc", 1, 2]);
    editor.redo();
    expect([input().value, input().selectionStart, input().selectionEnd]).toEqual(["aXc", 1, 2]);
  });
});

describe("CodeEditor: Undo puts the selection back (INV-88 (3)), held keys (INV-14 (2), INV-87 (4)), the Mac fold key (INV-87 (5)); review M2, L18, L23", () => {
  it("AT-CED-25 typing where the caret was put, then Undo: the caret is where typing began, not at the file's start", () => {
    start("one\ntwo\nthree\n");
    const ta = input();
    ta.setSelectionRange(8, 8); // the caret put on "three" (a press: the browser moves it)
    ta.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    type("one\ntwo\nXthree\n", 9);
    type("one\ntwo\nXYthree\n", 10);
    editor.undo();
    expect([ta.value, ta.selectionStart, ta.selectionEnd]).toEqual(["one\ntwo\nthree\n", 8, 8]);
    editor.redo();
    expect([ta.value, ta.selectionStart]).toEqual(["one\ntwo\nXYthree\n", 10]);
  });

  it("AT-CED-26 a held Undo / Redo key acts once (its repeats are taken but do nothing), as the shortcuts outside the editor", () => {
    start("a");
    type("ab");
    clock += CONFIG.codeEdit.undoPauseMs;
    type("abc");
    const ta = input();
    expect(keydown(ta, "z", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(ta.value).toBe("ab");
    expect(keydown(ta, "z", { ctrlKey: true, repeat: true }).defaultPrevented).toBe(true);
    expect(ta.value).toBe("ab");
    keydown(ta, "z", { ctrlKey: true });
    expect(keydown(ta, "y", { ctrlKey: true, repeat: true }).defaultPrevented).toBe(true);
    expect(ta.value).toBe("a");
  });

  it("AT-CED-27 Mac: Cmd+Option+Shift+[ is not a fold key (Shift is not held for it)", () => {
    start("{}", { isApple: true });
    expect(keydown(input(), "{", { code: "BracketLeft", metaKey: true, altKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(host.onFold).not.toHaveBeenCalled();
  });

  it("AT-CED-28 Undo is off once typing that changed nothing stops (L17)", () => {
    vi.useFakeTimers();
    start("a");
    type("ab");
    type("a", 1);
    expect(editor.canUndo()).toBe(true);
    vi.advanceTimersByTime(PAUSE);
    expect(editor.canUndo()).toBe(false);
  });
});

describe("CodeEditor: behaviour of the spec without a test before (INV-85 (2), INV-87 (5); review L22)", () => {
  it("AT-CED-31 INV-85 (2): editing starts with the caret at the start of the first line shown at the preview's top", () => {
    editor = new CodeEditor(preview, host);
    history.reset("l0\nl1\nl2\nl3\nl4\n", 0, 0);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ paddingTop: "8px", lineHeight: "20px" });
    vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({ top: 0 });
    vi.spyOn(HTMLTextAreaElement.prototype, "getBoundingClientRect").mockReturnValue({ top: -48 }); // 2 lines scrolled up
    editor.start("l0\nl1\nl2\nl3\nl4\n", history);
    expect([input().selectionStart, input().selectionEnd]).toEqual([6, 6]);
    expect(document.activeElement).toBe(input());
  });

  it("AT-CED-32 INV-87 (5): a held fold key in the editor is taken and folds once", () => {
    start("{}");
    keydown(input(), "{", { code: "BracketLeft", ctrlKey: true, shiftKey: true });
    expect(keydown(input(), "{", { code: "BracketLeft", ctrlKey: true, shiftKey: true, repeat: true }).defaultPrevented).toBe(true);
    expect(host.onFold.mock.calls).toEqual([["fold"]]);
  });
});

describe("CodeEditor: the size while typing (INV-85 (1), INV-86; review M1)", () => {
  it("AT-CED-29 the textarea scrolled itself: the stack grows to its text, it is unscrolled, the page scrolls where the caret went past the window", () => {
    start("a\nb");
    const ta = input();
    Object.defineProperty(ta, "scrollHeight", { configurable: true, value: 500 });
    vi.spyOn(ta, "getBoundingClientRect").mockReturnValue({ top: 0, left: 0, right: 100, bottom: window.innerHeight, width: 100, height: window.innerHeight });
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const scrolled = { top: 40, left: 0 };
    Object.defineProperty(ta, "scrollTop", { configurable: true, get: () => scrolled.top, set: (v) => (scrolled.top = v) });
    Object.defineProperty(ta, "scrollLeft", { configurable: true, get: () => scrolled.left, set: (v) => (scrolled.left = v) });
    ta.dispatchEvent(new Event("scroll"));
    expect([ta.scrollTop, ta.scrollLeft]).toEqual([0, 0]);
    expect(ta.parentElement.style.minHeight).toBe("564px");
    expect(scrollBy).toHaveBeenCalledWith(0, 40);
  });

  it("AT-CED-30 start: the view's lines are taken away from the last up (WebKit: linear, not quadratic; M1)", () => {
    preview.innerHTML = '<div id="codeViewBody"><span class="code-line">1</span><span class="code-line">2</span><span class="code-line">3</span></div>';
    const viewBody = preview.firstChild;
    const removed = [];
    const original = Element.prototype.remove;
    vi.spyOn(Element.prototype, "remove").mockImplementation(function () {
      if (this.parentNode === viewBody) removed.push(this.textContent);
      return original.call(this);
    });
    start("x");
    expect(removed).toEqual(["3", "2", "1"]);
    expect(preview.querySelector("#codeViewBody")).toBeNull();
  });
});

describe("CodeEditor: places (INV-80, INV-91)", () => {
  it("AT-CED-21 select and moveCaretToLine move the selection, not the focus", () => {
    start("a\nbc\nd");
    input().blur();
    editor.select(2, 4);
    expect([input().selectionStart, input().selectionEnd, document.activeElement === input()]).toEqual([2, 4, false]);
    editor.moveCaretToLine(2);
    expect([input().selectionStart, input().selectionEnd]).toEqual([5, 5]);
    editor.moveCaretToLine(9);
    expect(input().selectionStart).toBe(6);
  });

  it("AT-CED-22 linePlace / placeOf: the textarea and the line's top below it (top padding + line x line height)", () => {
    start("a\nbc\nd");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ paddingTop: "8px", lineHeight: "20.8px" });
    expect(editor.linePlace(2)).toEqual({ element: input(), offset: 8 + 2 * 20.8 });
    expect(editor.placeOf(3)).toEqual({ element: input(), offset: 8 + 20.8 });
  });

  it("AT-CED-23 rangeOf: a range over the colored layer's text of the same offsets", () => {
    host.highlight.mockImplementation((text) => `<span class="k">${escapeHtml(text.slice(0, 3))}</span>${escapeHtml(text.slice(3))}`);
    start('abc "de" f');
    const range = editor.rangeOf(2, 7);
    expect(range.toString()).toBe('c "de');
    expect(range.startContainer.parentElement.className).toBe("k");
  });
});

describe("CodeEditor: performance (INV-86, G10; review M1; count-based, L7)", () => {
  it("AT-CED-24 a key on a 5 MB text: no write of the layer or the gutter, no read of the layout or (but at a step's start) of the selection, no count of the lines, no comparison", () => {
    vi.useFakeTimers();
    const line = "0123456789".repeat(5) + "\n";
    const text = line.repeat(Math.ceil((5 * 1024 * 1024) / line.length));
    start(text);
    expect(host.highlight).not.toHaveBeenCalled(); // over highlightMaxChars
    const layerNode = layer().firstChild;
    const gutterNode = gutter().firstChild;
    const reads = ["scrollTop", "scrollLeft", "scrollWidth", "scrollHeight", "clientWidth", "clientHeight"].map((name) =>
      vi.spyOn(Element.prototype, name, "get"),
    );
    const rects = vi.spyOn(Element.prototype, "getBoundingClientRect");
    // WebKit: reading the selection costs time growing with the text; only the key that begins a step reads it
    const selectionReads = ["selectionStart", "selectionEnd"].map((name) => vi.spyOn(HTMLTextAreaElement.prototype, name, "get"));
    const styles = vi.spyOn(window, "getComputedStyle");
    // String work on the whole text (longer than any piece typed); jsdom's own short strings are left out
    const wholeTextCalls = [];
    let recording = false;
    for (const name of ["indexOf", "lastIndexOf", "charCodeAt", "split", "slice", "localeCompare"]) {
      const original = String.prototype[name];
      vi.spyOn(String.prototype, name).mockImplementation(function (...args) {
        if (recording && this.length > 1000) wholeTextCalls.push(name);
        return original.apply(this, args);
      });
    }
    for (const ch of "ab\nc") {
      const ta = input();
      const at = ta.value.length;
      recording = true; // the editor's handlers only (the browser's own edit is setRangeText here)
      ta.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: ch, bubbles: true, cancelable: true }));
      recording = false;
      ta.setRangeText(ch, at, at, "end");
      recording = true;
      ta.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: ch, bubbles: true }));
      recording = false;
    }
    expect([layer().firstChild, gutter().firstChild]).toEqual([layerNode, gutterNode]);
    for (const read of reads) expect(read).not.toHaveBeenCalled();
    expect([rects.mock.calls.length, styles.mock.calls.length]).toEqual([0, 0]);
    expect(wholeTextCalls).toEqual([]);
    expect(host.onTextChanged).toHaveBeenCalledTimes(4);
    expect(selectionReads.map((read) => read.mock.calls.length)).toEqual([1, 1]);
    expect(extraLines()).toBe("1");
  });
});
