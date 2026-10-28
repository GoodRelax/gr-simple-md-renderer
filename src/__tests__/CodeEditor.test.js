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

/** Type: the value changes and an input event follows, as the browser does. */
function type(value, caret = value.length) {
  const ta = input();
  ta.value = value;
  ta.setSelectionRange(caret, caret);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

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

  it("AT-CED-02 typing: the plain text goes into the layer at once; the colors come once typing stops for highlightPauseMs", () => {
    vi.useFakeTimers();
    start("a");
    host.highlight.mockClear();
    type("a<b");
    expect(layer().innerHTML).toBe("a&lt;b\n");
    expect(host.onTextChanged).toHaveBeenLastCalledWith("a<b");
    type("a<bc");
    vi.advanceTimersByTime(PAUSE - 1);
    expect([host.highlight.mock.calls.length, host.onTextSettled.mock.calls.length]).toEqual([0, 0]);
    vi.advanceTimersByTime(1);
    expect(host.highlight.mock.calls).toEqual([["a<bc"]]);
    expect(layer().innerHTML).toBe('<span class="hljs-string">a&lt;bc</span>\n');
    expect(host.onTextSettled).toHaveBeenCalledTimes(1);
  });

  it("AT-CED-03 the gutter is written only when the number of lines changes", () => {
    start("a\nb");
    const before = gutter().firstChild;
    type("a\nbc");
    expect(gutter().firstChild).toBe(before);
    type("a\nbc\n");
    expect(gutter().firstChild).not.toBe(before);
    expect(gutter().textContent).toBe("1\n2\n3");
  });

  it("AT-CED-04 over highlightMaxChars: plain (the textarea's text shows); the layer is written when typing stops, never colored", () => {
    vi.useFakeTimers();
    const big = "x".repeat(CONFIG.codeEdit.highlightMaxChars) + "\n";
    start(big);
    expect(preview.querySelector("#codeEditBody").classList.contains("code-edit-plain")).toBe(true);
    expect(host.highlight).not.toHaveBeenCalled();
    expect(layer().textContent).toBe(big + "\n");
    type(big + "y");
    expect(layer().textContent).toBe(big + "\n");
    vi.advanceTimersByTime(PAUSE);
    expect(layer().textContent).toBe(big + "y\n");
    expect(host.highlight).not.toHaveBeenCalled();
    expect(editor.rangeOf(0, 1)).toBeNull();
  });

  it("AT-CED-05 a text shrinking under the limit is colored again", () => {
    vi.useFakeTimers();
    const big = "x".repeat(CONFIG.codeEdit.highlightMaxChars + 1);
    start(big);
    type("short");
    expect(preview.querySelector("#codeEditBody").classList.contains("code-edit-plain")).toBe(false);
    vi.advanceTimersByTime(PAUSE);
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
    expect(gutter().textContent).toBe("1\n2");
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

  it("AT-CED-20 setText is one step; Undo puts the text and the selection back", () => {
    start("abc");
    input().setSelectionRange(1, 2);
    editor.setText("aXc", 1, 2);
    expect(input().value).toBe("aXc");
    editor.undo();
    expect([input().value, input().selectionStart, input().selectionEnd]).toEqual(["abc", 0, 0]);
    editor.redo();
    expect([input().value, input().selectionStart, input().selectionEnd]).toEqual(["aXc", 1, 2]);
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

describe("CodeEditor: performance (G10)", () => {
  it("AT-CED-24 a 1 MB text starts and takes an input event fast: no highlighting, the gutter written once", () => {
    vi.useFakeTimers();
    const line = "0123456789".repeat(5) + "\n";
    const text = line.repeat(Math.ceil((1024 * 1024) / line.length));
    const t0 = performance.now();
    start(text);
    const gutterNode = gutter().firstChild;
    type(text + "x");
    const elapsed = performance.now() - t0;
    expect(gutter().firstChild).toBe(gutterNode);
    expect(host.onTextChanged).toHaveBeenCalledTimes(1);
    expect(host.highlight).not.toHaveBeenCalled();
    expect(elapsed).toBeLessThan(1500);
  });
});
