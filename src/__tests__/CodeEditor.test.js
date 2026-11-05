import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import CodeEditor from "../js/classes/CodeEditor.js";
import CodeEditHistory from "../js/classes/CodeEditHistory.js";
import { SEARCH_HIGHLIGHTS } from "../js/classes/DocumentSearch.js";
import { CONFIG } from "../js/config.js";
import { escapeHtml } from "../js/utils.js";
import { keydown } from "./helpers/editDom.js";
import { watchWholeTextWork } from "./helpers/wholeText.js";

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
  vi.unstubAllGlobals();
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

/** The layer's HTML of these lines: blocks of CONFIG.codeEdit.layerBlockLines lines, each line with its line feed. */
function lineHtml(...lines) {
  const size = CONFIG.codeEdit.layerBlockLines;
  let html = "";
  for (let at = 0; at < lines.length; at += size) html += `<span class="code-edit-block">${lines.slice(at, at + size).join("\n")}\n</span>`;
  return html;
}
/** The colored HTML of the `colored` highlighter, line by line (its span closed and opened again at each line feed). */
const coloredLines = (text) => lineHtml(...text.split("\n").map((line) => `<span class="hljs-string">${escapeHtml(line)}</span>`));
/** The layer's blocks (one a line where a test sets layerBlockLines to 1). */
const lineNodes = () => [...layer().children];

describe("CodeEditor: the surface (INV-85, INV-86)", () => {
  it("AT-CED-01 start: the editor takes the view's place; textarea, colored layer and gutter; no spell check, no wrap", () => {
    start("a\nb\n");
    expect(preview.querySelector("#codeViewBody")).toBeNull();
    expect([...preview.children].map((el) => el.id)).toEqual(["codeEditBody"]);
    const ta = input();
    expect([ta.value, ta.spellcheck, ta.getAttribute("wrap"), ta.getAttribute("aria-label")]).toEqual(["a\nb\n", false, "off", CONFIG.messages.codeEdit.editorLabel]);
    expect(layer().innerHTML).toBe(coloredLines("a\nb\n"));
    expect(layer().textContent).toBe("a\nb\n\n");
    expect(gutter().textContent).toBe("1\n2\n3");
    expect([gutter().getAttribute("aria-hidden"), layer().parentElement.getAttribute("aria-hidden")]).toEqual(["true", "true"]);
    expect(document.activeElement).toBe(ta);
    expect(editor.isActive()).toBe(true);
  });

  it("AT-CED-02 typing (BI-26): the layer stays shown and its line typed is colored at once (that line alone); the whole layer is colored again once typing stops for highlightPauseMs", () => {
    vi.useFakeTimers();
    start("a\nz");
    host.highlight.mockClear();
    type("a<b\nz", 3);
    expect(host.highlight.mock.calls).toEqual([["a<b"]]); // the line typed only
    expect(layer().innerHTML).toBe(coloredLines("a<b\nz"));
    expect(body().classList.contains("code-edit-typing")).toBe(false); // the textarea's text stays transparent
    expect(editor.rangeOf(0, 1)).toBeNull(); // the Search's offsets wait for the pause
    expect(host.onTextChanged).toHaveBeenLastCalledWith("a<b\nz");
    type("a<bc\nz", 4);
    vi.advanceTimersByTime(PAUSE - 1);
    expect([host.highlight.mock.calls.length, host.onTextSettled.mock.calls.length]).toEqual([2, 0]);
    vi.advanceTimersByTime(1);
    expect(host.highlight.mock.calls.at(-1)).toEqual(["a<bc\nz"]); // the whole text, in context
    expect(layer().innerHTML).toBe(coloredLines("a<bc\nz"));
    expect(body().classList.contains("code-edit-typing")).toBe(false);
    expect(editor.rangeOf(0, 1).toString()).toBe("a");
    expect(host.onTextSettled).toHaveBeenCalledTimes(1);
  });

  it("AT-CED-03 the gutter is written when typing stops, and only when the number of lines changed; a line typed shows at once in the layer (no room added, BI-26)", () => {
    vi.useFakeTimers();
    start("a\nb");
    const before = gutter().firstChild;
    type("a\nbc");
    vi.advanceTimersByTime(PAUSE);
    expect(gutter().firstChild).toBe(before);
    type("a\nbc\n");
    expect([gutter().firstChild, extraLines(), layer().textContent]).toEqual([before, "", "a\nbc\n\n"]);
    type("a\nbc\n\n");
    expect([extraLines(), layer().textContent]).toEqual(["", "a\nbc\n\n\n"]);
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

  it("AT-CED-37 (INV-86 (2)) the plain limit is 48 KB (49,152 characters; WebKit's recolor measured back to back stays about 100 ms, spec 5.19.12): one more character is plain", () => {
    expect(CONFIG.codeEdit.highlightMaxChars).toBe(48 * 1024);
    vi.useFakeTimers();
    start("x".repeat(48 * 1024) + "\n");
    expect(body().classList.contains("code-edit-plain")).toBe(true);
    expect(host.highlight).not.toHaveBeenCalled();
  });

  it("AT-CED-05 a text shrinking under the limit is colored again when typing stops", () => {
    vi.useFakeTimers();
    const big = "x".repeat(CONFIG.codeEdit.highlightMaxChars + 1);
    start(big);
    type("short");
    expect(body().classList.contains("code-edit-plain")).toBe(true);
    vi.advanceTimersByTime(PAUSE);
    expect(body().classList.contains("code-edit-plain")).toBe(false);
    expect(layer().innerHTML).toBe(coloredLines("short"));
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
    expect(layer().innerHTML).toBe(lineHtml("a&lt;"));
    type("a<b");
    expect(layer().innerHTML).toBe(lineHtml("a&lt;b")); // at once, escaped
    vi.advanceTimersByTime(PAUSE);
    expect(layer().innerHTML).toBe(lineHtml("a&lt;b"));
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
    expect(layer().textContent).toBe("    x\n    \n"); // the new line in the layer at once; the gutter when typing stops
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

describe("CodeEditor: operations, Undo and Redo write only the changed part (INV-86, INV-87 (1), INV-88; review N1, count-based)", () => {
  // about 5 MB of short lines, over highlightMaxChars (plain)
  const bigText = () => "function f(a) {\n  return a + 1;\n}\n".repeat(150000);

  it("AT-CED-33 (INV-87 (1), INV-88, N1) Tab, Shift+Tab on lines, Undo and Redo on a 5 MB text: no assignment of the whole value, no work on the whole text, setRangeText of the touched lines only", () => {
    vi.useFakeTimers();
    const text = bigText();
    start(text);
    const ta = input();
    const at = text.indexOf("\n", text.length / 2) + 1; // a line's start in the middle
    const end = text.indexOf("\n", at + 40); // three lines touched
    ta.setSelectionRange(at, end);
    const work = watchWholeTextWork(); // first: the spy below is the one it puts on setRangeText
    const writes = vi.spyOn(HTMLTextAreaElement.prototype, "setRangeText");
    work.start();
    keydown(ta, "Tab");
    const indented = input().value;
    keydown(ta, "Tab", { shiftKey: true });
    const outdented = input().value;
    editor.undo();
    const undone = input().value;
    editor.redo();
    work.stop();
    expect(work.calls).toEqual([]);
    expect(work.valueWrites).toBe(0);
    const lines = text.slice(at, end);
    const deeper = "  " + lines.replace(/\n/g, "\n  ");
    expect(writes.mock.calls.map(([inserted, from, to]) => [inserted, from, to])).toEqual([
      [deeper, at, end],
      [lines, at, at + deeper.length],
      [deeper, at, at + lines.length],
      [lines, at, at + deeper.length],
    ]);
    expect([indented.length, outdented === text, undone.length, input().value === text]).toEqual([text.length + deeper.length - lines.length, true, indented.length, true]);
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([at, end]);
    expect(host.onTextChanged).toHaveBeenCalledTimes(4);
    expect(body().classList.contains("code-edit-typing")).toBe(true); // the layer and the gutter follow at the pause
  });

  it("AT-CED-34 (INV-80 (5), INV-88, N1) setText (a replace, a fold) on a 5 MB text writes only the part that changed, found by block comparison; Undo writes it back", () => {
    vi.useFakeTimers();
    const text = bigText();
    start(text);
    const at = text.length - 1000;
    const replaced = text.slice(0, at) + "return b;" + text.slice(at + 9);
    const writes = vi.spyOn(HTMLTextAreaElement.prototype, "setRangeText");
    const reads = vi.spyOn(String.prototype, "charCodeAt");
    const valueWrites = vi.spyOn(HTMLTextAreaElement.prototype, "value", "set");
    editor.setText(replaced, at, at);
    editor.undo();
    expect(valueWrites).not.toHaveBeenCalled();
    expect(reads.mock.calls.length).toBeLessThan(2000); // char by char: about 2 x 5,000,000
    const changed = writes.mock.calls.map(([inserted, from, to]) => [inserted, from, to]);
    expect(changed).toHaveLength(2);
    expect(changed[0][2] - changed[0][1]).toBeLessThan(20);
    expect(input().value === text).toBe(true);
    expect([input().selectionStart, input().selectionEnd]).toEqual([0, 0]); // the selection before the operation
  });

  it("AT-CED-35 (INV-86, N1) room for lines (plain): an operation that adds lines makes room for them at once; its Undo takes that room back", () => {
    const big = "x".repeat(CONFIG.codeEdit.highlightMaxChars) + "\na\nb";
    start(big);
    const ta = input();
    ta.setSelectionRange(0, 0);
    editor.setText(big + "\nx\ny", 4, 4);
    expect(extraLines()).toBe("2");
    editor.undo();
    expect(extraLines()).toBe("0");
    type(big + "\n"); // a line typed: room again
    expect(extraLines()).toBe("1");
  });

  it("AT-CED-36 (INV-88 (1)(3), N1) an operation right after typing: the typing step ends with the selection before the operation (Redo of the typing puts the caret where typing left it)", () => {
    start("x\ny");
    editor.select(1, 1);
    type("xa\ny", 2);
    keydown(input(), "Tab"); // the line one unit (4 spaces) deeper; the caret moves with its text
    expect([input().value, input().selectionStart]).toEqual(["    xa\ny", 6]);
    editor.undo();
    expect([input().value, input().selectionStart]).toEqual(["xa\ny", 2]);
    editor.undo();
    expect([input().value, input().selectionStart]).toEqual(["x\ny", 1]);
    editor.redo();
    expect([input().value, input().selectionStart, input().selectionEnd]).toEqual(["xa\ny", 2, 2]);
  });
});

describe("CodeEditor: the layer follows each edit at once (INV-86, BI-26)", () => {
  // one line a block: a test sees which lines a key writes (AT-CED-48: blocks of 2 lines)
  const blockLines = CONFIG.codeEdit.layerBlockLines;
  beforeEach(() => {
    CONFIG.codeEdit.layerBlockLines = 1;
  });
  afterEach(() => {
    CONFIG.codeEdit.layerBlockLines = blockLines;
  });

  /** A highlighter that colors block comments, so a line inside one is told from a line outside. */
  const comments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => `<span class="hljs-comment">${m}</span>`);

  /** jsdom has no CSS Custom Highlight API: a stub that keeps the ranges. */
  function stubHighlights() {
    vi.stubGlobal(
      "Highlight",
      class {
        constructor(...ranges) {
          this.ranges = ranges;
        }

        [Symbol.iterator]() {
          return this.ranges[Symbol.iterator]();
        }
      },
    );
    vi.stubGlobal("CSS", { highlights: new Map() });
  }

  /** The text under the composition's underline, or null when there is none. */
  const composingText = () => CSS.highlights.get("grsmd-code-composing")?.ranges[0].toString() ?? null;

  /** An input the browser makes without data (a paste): its own change, then the input event. */
  function paste(piece, at) {
    const ta = input();
    ta.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertFromPaste", bubbles: true, cancelable: true }));
    ta.setRangeText(piece, at, at, "end");
    ta.dispatchEvent(new InputEvent("input", { inputType: "insertFromPaste", bubbles: true }));
  }

  /** An IME composition's update: the composition's text replaces the one before it. */
  function compose(data, start, oldLength) {
    const ta = input();
    ta.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertCompositionText", data, bubbles: true, cancelable: true }));
    ta.setRangeText(data, start, start + oldLength, "end");
    ta.dispatchEvent(new InputEvent("input", { inputType: "insertCompositionText", data, bubbles: true }));
  }

  it("AT-CED-38 Enter, Backspace over a line feed and a paste of lines: the layer holds the new lines at once, the lines around them stay the same nodes, and the layer's text is the textarea's", () => {
    start("ab\ncd\nef");
    const [first, , last] = lineNodes();
    type("ab\nc\nd\nef", 5); // Enter in the middle of "cd"
    expect([layer().textContent, lineNodes().length]).toEqual(["ab\nc\nd\nef\n", 4]);
    expect(lineNodes()[0] === first && lineNodes()[3] === last).toBe(true);
    type("ab\ncd\nef", 4); // Backspace at the start of "d": the lines join
    expect([layer().textContent, lineNodes().length]).toEqual(["ab\ncd\nef\n", 3]);
    expect(lineNodes()[0] === first && lineNodes()[2] === last).toBe(true);
    paste("x\ny\n", 0);
    expect(layer().innerHTML).toBe(coloredLines("x\ny\nab\ncd\nef"));
    expect(lineNodes()[4] === last).toBe(true);
    expect(body().classList.contains("code-edit-typing")).toBe(false);
  });

  it("AT-CED-39 a line inside a construct of several lines (a block comment) keeps that construct's colors while typed; a line outside is colored alone; the pause colors them in context", () => {
    vi.useFakeTimers();
    host.highlight.mockImplementation(comments);
    start("/* a\nb */\nc");
    expect(layer().innerHTML).toBe(lineHtml('<span class="hljs-comment">/* a</span>', '<span class="hljs-comment">b */</span>', "c"));
    host.highlight.mockClear();
    type("/* a\nbx */\nc", 7);
    expect(host.highlight).not.toHaveBeenCalled();
    expect(lineNodes()[1].innerHTML).toBe('<span class="hljs-comment">bx */</span>\n');
    type("/* a\nbx */\nc /*d*/", 18);
    expect(host.highlight.mock.calls).toEqual([["c /*d*/"]]);
    expect(lineNodes()[2].innerHTML).toBe('c <span class="hljs-comment">/*d*/</span>\n');
    vi.advanceTimersByTime(PAUSE);
    expect(host.highlight).toHaveBeenLastCalledWith("/* a\nbx */\nc /*d*/");
  });

  it("AT-CED-40 IME composition: its text shows on the layer at once, the line colored whole (one highlight.js call), the composition underlined by a CSS highlight; the underline stays over a pause during the composition and goes at its end; an empty composition has none", () => {
    vi.useFakeTimers();
    stubHighlights();
    host.highlight.mockImplementation((t) => t.split("\n").map(colored).join("\n")); // no span over a line feed
    start("x\nab");
    const ta = input();
    ta.setSelectionRange(3, 3);
    ta.dispatchEvent(new CompositionEvent("compositionstart", { data: "", bubbles: true }));
    expect(composingText()).toBeNull(); // empty: no underline
    host.highlight.mockClear();
    compose("k", 3, 0);
    expect(host.highlight.mock.calls).toEqual([["akb"]]); // the line once, not cut at the composition
    expect(lineNodes()[1].innerHTML).toBe('<span class="hljs-string">akb</span>\n');
    expect(composingText()).toBe("k");
    compose("ka", 3, 1);
    expect([layer().textContent, composingText()]).toEqual(["x\nakab\n", "ka"]);
    expect(body().classList.contains("code-edit-typing")).toBe(false);
    vi.advanceTimersByTime(PAUSE); // the whole layer is written again: the underline again
    expect(composingText()).toBe("ka");
    ta.dispatchEvent(new CompositionEvent("compositionend", { data: "ka", bubbles: true }));
    expect(composingText()).toBeNull();
    expect(layer().innerHTML).toBe(coloredLines("x\nakab"));
  });

  it("AT-CED-41 Tab, Undo, Redo and an operation on a colored text: the layer follows their changed lines at once (no typing look); the other lines stay the same nodes", () => {
    start("a\nb\nc");
    const [first, , last] = lineNodes();
    editor.select(2, 2);
    keydown(input(), "Tab");
    expect(layer().innerHTML).toBe(coloredLines("a\n    b\nc"));
    expect(lineNodes()[0] === first && lineNodes()[2] === last).toBe(true);
    editor.undo();
    expect(layer().innerHTML).toBe(coloredLines("a\nb\nc"));
    editor.redo();
    expect(layer().innerHTML).toBe(coloredLines("a\n    b\nc"));
    editor.setText("a\n    b\nc\nd\ne", 0, 0);
    expect([layer().innerHTML, lineNodes()[0] === first]).toEqual([coloredLines("a\n    b\nc\nd\ne"), true]);
    expect(body().classList.contains("code-edit-typing")).toBe(false);
  });

  it("AT-CED-42 a line over typedColorMaxChars: an edit in it writes its characters into the line's colored text (no highlight.js, the colors kept), the IME underline too; Enter splits the colored text and Backspace at the next line's start joins it, still with no highlight.js; the pause colors it", () => {
    vi.useFakeTimers();
    stubHighlights();
    const long = "y".repeat(CONFIG.codeEdit.typedColorMaxChars + 10);
    start(long);
    host.highlight.mockClear();
    const middle = long.length / 2;
    const typed = long.slice(0, middle) + "ab" + long.slice(middle);
    type(typed, middle + 2);
    expect(host.highlight).not.toHaveBeenCalled();
    expect(layer().innerHTML).toBe(coloredLines(typed)); // the typed characters in the line's colored text
    const backed = long.slice(0, middle) + "a" + long.slice(middle);
    type(backed, middle + 1); // Backspace
    expect(layer().innerHTML).toBe(coloredLines(backed));
    const ta = input();
    ta.setSelectionRange(1, 1);
    ta.dispatchEvent(new CompositionEvent("compositionstart", { data: "", bubbles: true }));
    compose("k", 1, 0);
    expect([host.highlight.mock.calls.length, composingText()]).toEqual([0, "k"]);
    ta.dispatchEvent(new CompositionEvent("compositionend", { data: "k", bubbles: true }));
    const text = ta.value;
    const split = `${text.slice(0, 3)}\n${text.slice(3)}`;
    type(split, 4); // Enter in the long line: two lines in the string's colored text
    expect(host.highlight).not.toHaveBeenCalled();
    expect([layer().textContent, layer().querySelectorAll(".hljs-string").length]).toEqual([`${split}\n`, 1]);
    expect(editor.rangeOf(0, 1)).toBeNull(); // still before the pause
    type(text, 3); // Backspace at the second line's start: one line again
    expect(host.highlight).not.toHaveBeenCalled();
    expect(layer().innerHTML).toBe(coloredLines(text));
    type(split, 4);
    vi.advanceTimersByTime(PAUSE);
    expect(host.highlight).toHaveBeenLastCalledWith(split);
    expect(layer().innerHTML).toBe(lineHtml(`<span class="hljs-string">${text.slice(0, 3)}</span>`, `<span class="hljs-string">${text.slice(3)}</span>`));
  });

  it("AT-CED-43 an edit that takes a colored text over highlightMaxChars: the layer leaves (the typing look: the textarea's text shows) with room for the lines added; plain at the pause", () => {
    vi.useFakeTimers();
    start("a");
    const lines = CONFIG.codeEdit.highlightMaxChars / 2;
    const big = "a" + "x\n".repeat(lines);
    type(big);
    expect([body().classList.contains("code-edit-typing"), extraLines()]).toEqual([true, String(lines)]);
    const shown = layer().innerHTML;
    type(big + "z");
    expect(layer().innerHTML).toBe(shown);
    vi.advanceTimersByTime(PAUSE);
    expect([body().classList.contains("code-edit-plain"), body().classList.contains("code-edit-typing"), extraLines()]).toEqual([true, false, ""]);
  });

  it("AT-CED-44 a key on a colored text at the limit (48 KB): one line of the layer written, highlight.js on that line only, no write of the gutter, no read of the layout or (but at a step's start) of the selection", () => {
    vi.useFakeTimers();
    const line = "const value = 1234567890; // a line of a big file\n";
    const text = line.repeat(Math.floor(CONFIG.codeEdit.highlightMaxChars / line.length));
    host.highlight.mockImplementation((t) => t.split("\n").map(colored).join("\n")); // no span over a line feed
    start(text);
    expect(body().classList.contains("code-edit-plain")).toBe(false);
    const nodes = lineNodes();
    const gutterNode = gutter().firstChild;
    host.highlight.mockClear();
    const reads = ["scrollTop", "scrollLeft", "scrollWidth", "scrollHeight", "clientWidth", "clientHeight"].map((name) =>
      vi.spyOn(Element.prototype, name, "get"),
    );
    const rects = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const styles = vi.spyOn(window, "getComputedStyle");
    const selectionReads = ["selectionStart", "selectionEnd"].map((name) => vi.spyOn(HTMLTextAreaElement.prototype, name, "get"));
    const middle = text.indexOf("\n", text.length / 2) + 1;
    for (const [n, ch] of [..."ab"].entries()) {
      const ta = input();
      ta.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: ch, bubbles: true, cancelable: true }));
      ta.setRangeText(ch, middle + n, middle + n, "end");
      ta.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: ch, bubbles: true }));
    }
    expect(host.highlight.mock.calls).toEqual([["a" + line.slice(0, -1)], ["ab" + line.slice(0, -1)]]);
    const replaced = lineNodes().filter((node, i) => node !== nodes[i]);
    expect([lineNodes().length, replaced.length]).toEqual([nodes.length, 0]); // the same line element, its content written
    expect(lineNodes()[middle / line.length].textContent).toBe("ab" + line);
    expect(layer().textContent).toBe(input().value + "\n");
    expect(gutter().firstChild).toBe(gutterNode);
    for (const read of reads) expect(read).not.toHaveBeenCalled();
    expect([rects.mock.calls.length, styles.mock.calls.length]).toEqual([0, 0]);
    expect(selectionReads.map((read) => read.mock.calls.length)).toEqual([1, 1]);
  });

  it("AT-CED-45 a line inside a span that is not of text (an HTML file's <script> sub-language, parameters over lines): colored by highlight.js (in the sub-language) and wrapped in that span, not left plain", () => {
    // as highlight.js colors xml: the <script> body in a "language-javascript" span over its
    // lines; parameters over two lines in a "hljs-params" span
    const keywords = (text) => text.replace(/\blet\b/g, '<span class="hljs-keyword">let</span>');
    const xml = (text) =>
      keywords(text)
        .replace(/<script>([\s\S]*?)<\/script>/, (m, body) => `&lt;script&gt;<span class="language-javascript">${body}</span>&lt;/script&gt;`)
        .replace(/\(([^)]*\n[^)]*)\)/, (m, params) => `(<span class="hljs-params">${params}</span>)`);
    host.highlight.mockImplementation((text, language) => (language === "javascript" ? keywords(text) : xml(text)));
    start("<script>\nlet a;\n</script>\nf(a,\nb)");
    host.highlight.mockClear();
    type("<script>\nlet ab;\n</script>\nf(a,\nb)", 15);
    expect(host.highlight.mock.calls).toEqual([["let ab;", "javascript"]]);
    expect(lineNodes()[1].innerHTML).toBe('<span class="language-javascript"><span class="hljs-keyword">let</span> ab;</span>\n');
    host.highlight.mockClear();
    type("<script>\nlet ab;\n</script>\nf(a,\nlet b)", 36);
    expect(host.highlight.mock.calls).toEqual([["let b)"]]); // the file's language, in the parameters' span
    expect(lineNodes()[4].innerHTML).toBe('<span class="hljs-params"><span class="hljs-keyword">let</span> b)</span>\n');
  });

  it("AT-CED-46 (INV-86 (d)) the layer cannot follow: a line element missing, or the layer's text not the one an operation changed: the layer hides (the typing look), rangeOf is null until the pause writes it whole", () => {
    vi.useFakeTimers();
    start("a\nb");
    layer().lastElementChild.remove(); // the layer lost a line
    type("a\nbc");
    expect([body().classList.contains("code-edit-typing"), editor.rangeOf(0, 1)]).toEqual([true, null]);
    vi.advanceTimersByTime(PAUSE);
    expect([body().classList.contains("code-edit-typing"), editor.rangeOf(0, 1).toString(), layer().textContent]).toEqual([false, "a", "a\nbc\n"]);
    input().value = "zz\nbc"; // changed without an input event: the layer holds another text
    editor.setText("zz\nbcd", 6, 6);
    expect([body().classList.contains("code-edit-typing"), editor.rangeOf(0, 1)]).toEqual([true, null]);
    vi.advanceTimersByTime(PAUSE);
    expect([body().classList.contains("code-edit-typing"), layer().textContent]).toEqual([false, "zz\nbcd\n"]);
  });

  it("AT-CED-47 a plain text (over highlightMaxChars): an IME composition reads no selection (WebKit: the read takes time growing with the text) and marks nothing", () => {
    stubHighlights();
    const big = "x".repeat(CONFIG.codeEdit.highlightMaxChars) + "\n";
    start(big);
    const reads = ["selectionStart", "selectionEnd"].map((name) => vi.spyOn(HTMLTextAreaElement.prototype, name, "get"));
    input().dispatchEvent(new CompositionEvent("compositionstart", { data: "", bubbles: true }));
    expect(reads.map((read) => read.mock.calls.length)).toEqual([0, 0]);
    compose("k", big.length, 0);
    expect(composingText()).toBeNull();
  });

  it("AT-CED-48 (INV-86 (a)) blocks of layerBlockLines lines: a key writes only its block; a block grown past the size is written as new blocks; an edit over several blocks writes them as one; the IME underline is found inside its block; the pause writes the blocks anew", () => {
    vi.useFakeTimers();
    stubHighlights();
    CONFIG.codeEdit.layerBlockLines = 2;
    host.highlight.mockImplementation((t) => t.split("\n").map(colored).join("\n")); // no span over a line feed
    start("l0\nl1\nl2\nl3\nl4");
    const [b0, b1, b2] = lineNodes();
    expect(lineNodes().map((b) => b.textContent)).toEqual(["l0\nl1\n", "l2\nl3\n", "l4\n"]);
    type("l0\nl1\nl2x\nl3\nl4", 9);
    expect(lineNodes()).toEqual([b0, b1, b2]); // the same blocks; only b1 written
    expect(b1.innerHTML).toBe(`${colored("l2x")}\n${colored("l3")}\n`);
    type("l0\nl1\nl2x\n\nl3\nl4", 10); // Enter: b1 has 3 lines, over the size
    expect(lineNodes().map((b) => b.textContent)).toEqual(["l0\nl1\n", "l2x\n\n", "l3\n", "l4\n"]);
    expect(lineNodes()[0] === b0 && lineNodes()[3] === b2).toBe(true);
    type("l0\nl4", 3); // a selection from l1 to l4's start deleted: four blocks written as one
    expect([lineNodes().length, lineNodes()[0] === b0, layer().textContent]).toEqual([1, false, "l0\nl4\n"]);
    expect(layer().innerHTML).toBe(lineHtml(colored("l0"), colored("l4")));
    input().setSelectionRange(5, 5);
    input().dispatchEvent(new CompositionEvent("compositionstart", { data: "", bubbles: true }));
    compose("ka", 5, 0); // in the block's second line
    expect(composingText()).toBe("ka");
    vi.advanceTimersByTime(PAUSE);
    expect([lineNodes().map((b) => b.textContent), composingText()]).toEqual([["l0\nl4ka\n"], "ka"]);
  });

  it("AT-CED-49 (INV-86 (b)) a block holding a long line written into and a short line: a key in the short line writes the block again from the long line's HTML on the layer (its colors kept, no highlight.js on it)", () => {
    CONFIG.codeEdit.layerBlockLines = 2;
    host.highlight.mockImplementation((t) => t.split("\n").map(colored).join("\n")); // no span over a line feed
    const long = "y".repeat(CONFIG.codeEdit.typedColorMaxChars + 10);
    start(`${long}\nab`);
    type(`x${long}\nab`, 1);
    host.highlight.mockClear();
    type(`x${long}\nabc`, long.length + 5);
    expect(host.highlight.mock.calls).toEqual([["abc"]]);
    expect(layer().innerHTML).toBe(lineHtml(colored(`x${long}`), colored("abc")));
  });

  it("AT-CED-50 (INV-86 (b-1)(b-2), review 2 finding 3) a long line not first in its block: a character typed at its start goes into the line's colored text, not after the line feed before it; Backspace there joins it to the line before, across blocks too, with no highlight.js", () => {
    CONFIG.codeEdit.layerBlockLines = 2;
    host.highlight.mockImplementation((t) => t.split("\n").map(colored).join("\n")); // no span over a line feed
    const long = "y".repeat(CONFIG.codeEdit.typedColorMaxChars + 10);
    start(`ab\n${long}\ncd\n${long}`);
    host.highlight.mockClear();
    type(`ab\nz${long}\ncd\n${long}`, 4);
    expect(lineNodes()[0].innerHTML).toBe(`${colored("ab")}\n${colored(`z${long}`)}\n`); // in the string, not white
    type(`ab\nz${long}cd\n${long}`, long.length + 4); // Backspace at the start of the next block: the blocks join
    expect(host.highlight).not.toHaveBeenCalled();
    expect([lineNodes().length, layer().textContent]).toEqual([1, `ab\nz${long}cd\n${long}\n`]);
    expect(lineNodes()[0].innerHTML).toBe(`${colored("ab")}\n${colored(`z${long}`)}${colored("cd")}\n${colored(long)}\n`);
  });

  it("AT-CED-51 (INV-86 (d), review 2 finding 2) a long line whose block holds no text node there: the layer hides (the typing look), rangeOf is null until the pause writes it whole", () => {
    vi.useFakeTimers();
    const long = "y".repeat(CONFIG.codeEdit.typedColorMaxChars + 10);
    start(long);
    lineNodes()[0].replaceChildren(); // the layer lost the line's text
    type(`x${long}`, 1);
    expect([body().classList.contains("code-edit-typing"), editor.rangeOf(0, 1)]).toEqual([true, null]);
    vi.advanceTimersByTime(PAUSE);
    expect([body().classList.contains("code-edit-typing"), layer().textContent]).toEqual([false, `x${long}\n`]);
  });

  it("AT-CED-52 (review 2 finding 4) an edit written into a long line's text: the Search's marks with an end in the text nodes written are taken away; marks elsewhere stay", () => {
    stubHighlights();
    host.highlight.mockImplementation((t) => t.split("\n").map(colored).join("\n")); // no span over a line feed
    const long = "y".repeat(CONFIG.codeEdit.typedColorMaxChars + 10);
    start(`${long}\nab`);
    const range = (node) => {
      const r = document.createRange();
      r.setStart(node, 0);
      r.setEnd(node, 1);
      return r;
    };
    const longText = lineNodes()[0].querySelector(".hljs-string").firstChild;
    const shortText = lineNodes()[1].querySelector(".hljs-string").firstChild;
    const [all, current] = SEARCH_HIGHLIGHTS;
    CSS.highlights.set(current, new Highlight(range(longText)));
    CSS.highlights.set(all, new Highlight(range(shortText)));
    type(`x${long}\nab`, 1);
    expect([CSS.highlights.has(current), CSS.highlights.has(all)]).toEqual([false, true]);
  });
  it("AT-CED-53 (review 3 finding 1) a long line inside a block comment, written into and then made short: the next key colors it in the comment's color (the context kept when its HTML is taken back from the layer), no highlight.js", () => {
    host.highlight.mockImplementation(comments);
    const long = "y".repeat(CONFIG.codeEdit.typedColorMaxChars + 10);
    start(`/* a\n${long}\nb */`);
    type(`/* a\nx${long}\nb */`, 6); // written into the long line's text
    host.highlight.mockClear();
    type(`/* a\nxyy\nb */`, 8); // most of it cut: short again
    type(`/* a\nxyyz\nb */`, 9);
    expect(host.highlight).not.toHaveBeenCalled();
    expect(lineNodes()[1].innerHTML).toBe('<span class="hljs-comment">xyyz</span>\n');
  });

  it("AT-CED-54 (review 3 finding 2) blocks joined for an edit in long lines: the Search's marks with an end in the blocks moved are taken away; a mark wholly in the block kept stays", () => {
    stubHighlights();
    CONFIG.codeEdit.layerBlockLines = 2;
    host.highlight.mockImplementation((t) => t.split("\n").map(colored).join("\n")); // no span over a line feed
    const long = "y".repeat(CONFIG.codeEdit.typedColorMaxChars + 10);
    start(`ab\n${long}\ncd\nef`);
    const [first, second] = lineNodes();
    const text = (block, n) => block.querySelectorAll(".hljs-string")[n].firstChild;
    const over = document.createRange();
    over.setStart(text(first, 0), 0); // "ab"
    over.setEnd(text(second, 0), 1); // "cd", in the block to move
    const kept = document.createRange();
    kept.setStart(text(first, 0), 0);
    kept.setEnd(text(first, 0), 2);
    const [all, current] = SEARCH_HIGHLIGHTS;
    CSS.highlights.set(current, new Highlight(over));
    CSS.highlights.set(all, new Highlight(kept));
    type(`ab\n${long}cd\nef`, long.length + 4); // Backspace at the second block's start: the blocks join
    expect([lineNodes().length, CSS.highlights.has(current), CSS.highlights.has(all)]).toEqual([1, false, true]);
  });
});
