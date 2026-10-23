import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return {
    ...actual,
    applyTheme: vi.fn(),
    applySystemTheme: vi.fn(),
    showToast: vi.fn(),
    waitForDOMStability: vi.fn().mockResolvedValue(true),
  };
});
vi.mock("../js/config.js", async () => ({
  ...(await vi.importActual("../js/config.js")),
  FILE_SYSTEM_HANDLE_SUPPORTED: true,
}));
vi.mock("../js/classes/ModalController.js", () => ({
  default: { setupModal: vi.fn(), show: vi.fn(), hide: vi.fn() },
}));

import { CONFIG } from "../js/config.js";
import { setupApp, dropEvent, settle } from "./helpers/appStack.js";
import { tap, pointer, keydown } from "./helpers/editDom.js";
import { fakeFileHandle } from "./helpers/fakeFs.js";
import { fakePaletteLayout } from "./helpers/paletteLayout.js";

const DOC = "# Title\n\nHello world.\n\nSecond para.\n";
const isPara = (start) => (b) => b.type === "paragraph" && b.raw.startsWith(start);

let app;
let confirmSpy;

beforeEach(() => {
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  app?.teardown();
  app = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function withDocument(md = DOC) {
  app = await setupApp();
  const handle = fakeFileHandle({ name: "doc.md", content: [md] });
  document.dispatchEvent(dropEvent(new File([md], "doc.md", { lastModified: 1000 }), handle));
  await settle();
  return app;
}

/** Open block A with a change (palette shown). */
function openChanged(start = "Hello", text = "Changed A.") {
  if (!app.ui.palette.isShown()) keydown(document.body, "e");
  tap(app.block(isPara(start)).el.firstElementChild);
  const ta = app.blockEditor();
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return ta;
}

function spyShortcuts() {
  return {
    handleRender: vi.spyOn(app.ui, "handleRender"),
    handleReload: vi.spyOn(app.ui, "handleReload"),
    doClear: vi.spyOn(app.ui, "doClear"),
    toggleEditPalette: vi.spyOn(app.ui, "toggleEditPalette"),
    open: vi.spyOn(window, "open").mockImplementation(() => null),
    startScroll: app.scrollEngine.startScroll,
    dispatch: vi.spyOn(app.ui.blockEdit, "dispatch"),
  };
}

describe("AT-UI-19 key guards (INV-14)", () => {
  const KEYS = ["l", "d", "r", "n", "c", "e", "Escape", "ArrowUp", "ArrowDown"];
  const TARGETS = {
    INPUT: () => {
      const i = document.createElement("input");
      document.body.appendChild(i);
      return i;
    },
    "#editor": () => app.elements.editor,
    "block editor": () => openChanged(),
    contenteditable: () => {
      const d = document.createElement("div");
      d.tabIndex = 0;
      Object.defineProperty(d, "isContentEditable", { value: true });
      document.body.appendChild(d);
      return d;
    },
    "palette (role=toolbar)": () => {
      keydown(document.body, "e");
      return app.paletteRoot().querySelector("#paletteSave");
    },
  };
  const CASES = Object.keys(TARGETS).flatMap((t) => KEYS.map((k) => [t, k]));

  it.each(CASES)("focus on %s, key %s: no document shortcut", async (target, key) => {
    await withDocument();
    const el = TARGETS[target]();
    el.focus();
    expect(document.activeElement).toBe(el);
    app.scrollEngine.startScroll.mockClear();
    const spies = spyShortcuts();
    // Fire on the document so only the document handler can react.
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    for (const [name, spy] of Object.entries(spies)) expect(spy, name).not.toHaveBeenCalled();
    if (el.parentNode === document.body && el !== app.elements.editor) el.remove();
  });

  it("modifier keys still pass through (Ctrl+L)", async () => {
    await withDocument();
    const spies = spyShortcuts();
    keydown(document.body, "l", { ctrlKey: true });
    expect(spies.handleRender).not.toHaveBeenCalled();
  });
});

describe("AT-UI e / [Edit], double click, double tap (INV-31, OS-06)", () => {
  it("AT-UI-20 markdown view: e and [Edit] toggle the palette", async () => {
    await withDocument();
    keydown(document.body, "e");
    expect(app.ui.palette.isShown()).toBe(true);
    app.elements.editBtn.click();
    expect(app.ui.palette.isShown()).toBe(false);
  });

  it("AT-UI-20 initial, empty #editor: [Edit] starts an empty document with the palette and the editor", async () => {
    app = await setupApp();
    app.elements.editBtn.click();
    await settle();
    expect(app.orchestrator.isPreRenderState()).toBe(false);
    expect(app.ui.palette.isShown()).toBe(true);
    expect(app.blockEditor()).not.toBeNull();
    expect(document.activeElement).toBe(app.blockEditor());
  });

  it("AT-UI-20 initial, #editor not empty: e renders it with the system theme, then shows the palette", async () => {
    app = await setupApp();
    app.elements.editor.value = "# From editor";
    keydown(document.body, "e");
    await settle();
    expect(app.preview.querySelector("h1").textContent).toBe("From editor");
    expect(app.ui.palette.isShown()).toBe(true);
    expect(app.blockEditor()).toBeNull();
  });

  it("AT-UI-34 code view: palette hidden, editBtn disabled, e does nothing", async () => {
    await withDocument();
    keydown(document.body, "e");
    document.dispatchEvent(dropEvent(new File(["print(1)"], "a.py"), null));
    await settle();
    expect(app.ui.palette.isShown()).toBe(false);
    expect(app.elements.editBtn.disabled).toBe(true);
    keydown(document.body, "e");
    expect(app.ui.palette.isShown()).toBe(false);
  });

  it.each([
    ["a double click", () => app.preview.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))],
    ["[Edit]", () => app.elements.editBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }))],
  ])("PRT-U16 an empty document started by %s: the palette keeps the 16 px bottom margin after its status arrives (INV-32)", async (_name, start) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
    const layout = fakePaletteLayout({ statusHeight: 11 });
    app = await setupApp();
    start();
    await settle();
    const root = app.paletteRoot();
    expect(root.querySelector("#paletteStatus").textContent).not.toBe("");
    const box = root.getBoundingClientRect();
    expect(768 - box.bottom).toBe(CONFIG.edit.paletteMarginPx);
    expect(1024 - box.right).toBe(CONFIG.edit.paletteMarginPx);
    layout.restore();
  });

  it("AT-UI-21 initial, empty #editor: a click (focus to #editor, FS-16) then dblclick opens the empty block's editor", async () => {
    app = await setupApp();
    app.preview.click();
    expect(document.activeElement).toBe(app.elements.editor);
    app.preview.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();
    expect(app.ui.palette.isShown()).toBe(true);
    expect(document.activeElement).toBe(app.blockEditor());
    expect(app.orchestrator.isPreRenderState()).toBe(false);
  });

  it.each([
    [300, 24, true],
    [301, 0, false],
    [0, 25, false],
  ])("AT-UI-22 double tap: %i ms apart, %i px apart -> starts: %s (monotonic clock)", async (ms, px, starts) => {
    app = await setupApp();
    let now = 10000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    // The wall clock jumps a minute at each read: a tap timed by it would never be double.
    let wall = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (wall += 60000));
    pointer(app.preview, "pointerup", { x: 100, y: 100, pointerType: "touch" });
    now += ms;
    pointer(app.preview, "pointerup", { x: 100, y: 100 + px, pointerType: "touch" });
    vi.mocked(Date.now).mockRestore();
    await settle();
    expect(app.orchestrator.isPreRenderState()).toBe(!starts);
  });

  it("AT-UI-23 #editor not empty: a double click does nothing", async () => {
    app = await setupApp();
    app.elements.editor.value = "text";
    app.preview.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();
    expect(app.orchestrator.isPreRenderState()).toBe(true);
    expect(app.ui.palette.isShown()).toBe(false);
  });
});

describe("the browser's Undo / Redo never reaches #editor from elsewhere (5.7 (6))", () => {
  const historyEvent = (inputType) => new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true });

  it.each(["historyUndo", "historyRedo"])("%s on #editor while the block editor has the focus is cancelled", async (inputType) => {
    await withDocument();
    const ta = openChanged();
    expect(document.activeElement).toBe(ta);
    const e = historyEvent(inputType);
    app.elements.editor.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(app.blockEditor()).toBe(ta);
  });

  it("also while the focus is on the palette or the body", async () => {
    await withDocument();
    keydown(document.body, "e");
    app.paletteRoot().querySelector("#paletteSave").focus(); // only by script: tabindex -1 (INV-53)
    const fromPalette = historyEvent("historyUndo");
    app.elements.editor.dispatchEvent(fromPalette);
    expect(fromPalette.defaultPrevented).toBe(true);
    document.activeElement.blur();
    const fromBody = historyEvent("historyUndo");
    app.elements.editor.dispatchEvent(fromBody);
    expect(fromBody.defaultPrevented).toBe(true);
  });

  it("Undo typed in #editor itself is left to the browser; other input types are never touched", async () => {
    await withDocument();
    openChanged();
    const typing = new InputEvent("beforeinput", { inputType: "insertText", data: "x", bubbles: true, cancelable: true });
    app.elements.editor.dispatchEvent(typing);
    expect(typing.defaultPrevented).toBe(false);
    app.elements.editor.focus(); // commits the block editor (editorFocused)
    app.elements.editor.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "y", bubbles: true }));
    const own = historyEvent("historyUndo");
    app.elements.editor.dispatchEvent(own);
    expect(own.defaultPrevented).toBe(false);
  });
});

describe("#editor's own Undo / Redo waits for the user's own input after a system write (5.7 (6))", () => {
  const historyEvent = (inputType) => new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true });
  const ownUndoPrevented = (inputType = "historyUndo") => {
    app.elements.editor.focus();
    const e = historyEvent(inputType);
    app.elements.editor.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const userInput = (inputType) =>
    app.elements.editor.dispatchEvent(new InputEvent("input", { inputType, data: "z", bubbles: true }));

  it.each(["historyUndo", "historyRedo"])("after a document is loaded (#editor written), %s in #editor is cancelled", async (inputType) => {
    await withDocument();
    expect(ownUndoPrevented(inputType)).toBe(true);
  });

  it("after a block commit (onModelChanged writes #editor), #editor's own Undo is cancelled", async () => {
    await withDocument();
    userInput("insertText"); // lifts the wait left by loading
    await app.ui.handleRender("light"); // takes #editor in without writing it
    await settle();
    expect(ownUndoPrevented()).toBe(false);
    app.elements.editor.blur();
    openChanged("Hello", "Committed B.");
    app.elements.editor.focus(); // commits through editorFocused: a system write
    expect(app.elements.editor.value).toContain("Committed B.");
    expect(ownUndoPrevented()).toBe(true);
  });

  it("the user's own input in #editor lifts it; a history input does not", async () => {
    await withDocument();
    userInput("historyUndo");
    expect(ownUndoPrevented()).toBe(true);
    userInput("insertText");
    expect(ownUndoPrevented()).toBe(false);
    expect(ownUndoPrevented("historyRedo")).toBe(false);
  });

  it("before any system write (initial typing), #editor's own Undo is left to the browser", async () => {
    app = await setupApp();
    userInput("insertText");
    expect(ownUndoPrevented()).toBe(false);
  });

  it("after Clear (#editor emptied by the system), #editor's own Undo is cancelled", async () => {
    await withDocument();
    userInput("insertText");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    app.ui.doClear();
    await settle();
    expect(app.elements.editor.value).toBe("");
    expect(ownUndoPrevented()).toBe(true);
  });
});

describe("PRT-D01 the key hint stays after a button click that renders", () => {
  const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const hintShown = () => app.elements.keyHint.style.display === "block" && app.elements.keyHint.style.opacity === "1";

  it.each([
    ["[Render Light] in the initial state", "renderLightBtn", false],
    ["[Render Dark] in the markdown view", "renderDarkBtn", true],
    ["[Edit] in the initial state with #editor text (U30)", "editBtn", false],
  ])("%s: the hint is shown and the same click does not hide it; a later click does", async (_name, button, withDoc) => {
    if (withDoc) await withDocument();
    else {
      app = await setupApp();
      app.elements.editor.value = "# Test\n";
    }
    click(app.elements[button]);
    await settle();
    expect(hintShown()).toBe(true);
    click(document.body);
    expect(app.elements.keyHint.style.opacity).toBe("0");
  });
});

describe("AT-UI-24 Esc (Ctrl+S: UIController.shortcuts.test.js)", () => {
  it("palette shown, focus on the body: Esc hides it", async () => {
    await withDocument();
    keydown(document.body, "e");
    keydown(document.body, "Escape");
    expect(app.ui.palette.isShown()).toBe(false);
  });

  it("focus on #editor: Esc does not hide the palette", async () => {
    await withDocument();
    keydown(document.body, "e");
    app.elements.editor.focus();
    keydown(app.elements.editor, "Escape");
    expect(app.ui.palette.isShown()).toBe(true);
  });

  it("initial state and code view: Esc does nothing", async () => {
    app = await setupApp();
    const dispatch = vi.spyOn(app.ui.blockEdit, "dispatch");
    keydown(document.body, "Escape");
    document.dispatchEvent(dropEvent(new File(["x"], "a.py"), null));
    await settle();
    dispatch.mockClear();
    keydown(document.body, "Escape");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("Esc in the block editor cancels the edit only: the palette stays (the key does not reach the shortcuts)", async () => {
    await withDocument();
    const ta = openChanged();
    keydown(ta, "Escape");
    expect(app.blockEditor()).toBeNull();
    expect(app.ui.palette.isShown()).toBe(true);
  });
});

describe("AT-UI-42 the editor stays open while the focus is on the body", () => {
  it.each([
    ["l", () => keydown(document.body, "l")],
    ["d", () => keydown(document.body, "d")],
    ["[Render] click()", () => app.elements.renderDarkBtn.click()],
  ])("%s: commits A, then renders, no confirm", async (_name, act) => {
    await withDocument();
    const ta = openChanged();
    ta.blur();
    const rerender = vi.spyOn(app.orchestrator, "reRender");
    act();
    expect(app.orchestrator.getBody()).toContain("Changed A.");
    expect(rerender).toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    await settle();
    expect(app.blockEditor()).toBeNull();
  });

  it("e: commits A, then hides the palette", async () => {
    await withDocument();
    openChanged().blur();
    keydown(document.body, "e");
    expect(app.orchestrator.getBody()).toContain("Changed A.");
    expect(app.ui.palette.isShown()).toBe(false);
  });

  it("Esc: cancels the edit (original raw)", async () => {
    await withDocument();
    openChanged().blur();
    keydown(document.body, "Escape");
    expect(app.blockEditor()).toBeNull();
    expect(app.orchestrator.getBody()).toBe(DOC);
    expect(app.ui.palette.isShown()).toBe(true);
  });

  it.each([
    ["r", async () => app.ui.handleReload()],
    ["c", async () => keydown(document.body, "c")],
    [".md drop", async () => { document.dispatchEvent(dropEvent(new File(["# N\n"], "n.md"), null)); await settle(); }],
  ])("%s: confirm; Cancel keeps the editor and its text, OK discards without commit", async (_name, act) => {
    await withDocument();
    const ta = openChanged();
    ta.blur();
    const commit = vi.spyOn(app.orchestrator, "commitBlock");
    confirmSpy.mockReturnValueOnce(false);
    await act();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(app.blockEditor()).toBe(ta);
    expect(ta.value).toBe("Changed A.");
    await act();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(app.blockEditor()).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("AT-UI-43 focus moving into #editor commits the open editor", () => {
  async function focusEditorAndType() {
    await withDocument();
    openChanged();
    app.elements.editor.focus();
    expect(app.blockEditor()).toBeNull();
    expect(app.elements.editor.value).toContain("Changed A.");
    app.elements.editor.value += "XYZ\n";
    app.elements.editor.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.title.startsWith(CONFIG.edit.titleUnsavedPrefix)).toBe(true);
  }

  it("(a) Render then includes XYZ", async () => {
    await focusEditorAndType();
    await app.ui.handleRender("light");
    expect(app.orchestrator.getBody()).toContain("XYZ");
    expect(app.orchestrator.getBody()).toContain("Changed A.");
  });

  it.each([
    ["Reload", async () => app.ui.handleReload()],
    ["Clear", async () => app.ui.doClear()],
    [".md drop", async () => { document.dispatchEvent(dropEvent(new File(["# N\n"], "n.md"), null)); await settle(); }],
  ])("(c) %s asks first (XYZ is never lost silently)", async (_name, act) => {
    await focusEditorAndType();
    confirmSpy.mockReturnValue(false);
    await act();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(app.elements.editor.value).toContain("XYZ");
  });
});

describe("AT-UI-40 the palette stays directly under body", () => {
  it("after a commit, an undo and a full render", async () => {
    await withDocument();
    openChanged();
    pointer(document.body, "pointerdown");
    await settle();
    expect(app.paletteRoot().parentNode).toBe(document.body);
    app.orchestrator.undoLastCommit();
    await settle();
    expect(app.paletteRoot().parentNode).toBe(document.body);
    await app.ui.handleRender("dark");
    expect(app.paletteRoot().parentNode).toBe(document.body);
    expect(app.preview.contains(app.paletteRoot())).toBe(false);
  });
});

describe("AT-BSM stimuli from the UI (Q-d2)", () => {
  const state = () => {
    if (app.ui.blockEdit.isEditing()) return "editingBlock";
    return app.ui.palette.isShown() ? "editModeIdle" : "browsingPreview";
  };

  it("AT-BSM-01 / 02 e and [Edit]: browsingPreview <-> editModeIdle; while editing, hiding commits first", async () => {
    await withDocument();
    expect(state()).toBe("browsingPreview");
    keydown(document.body, "e");
    expect(state()).toBe("editModeIdle");
    app.elements.editBtn.click();
    expect(state()).toBe("browsingPreview");
    keydown(document.body, "e");
    openChanged();
    pointer(app.elements.editBtn, "pointerdown");
    app.elements.editBtn.click();
    expect(state()).toBe("browsingPreview");
    expect(app.orchestrator.getBody()).toContain("Changed A.");
  });

  it("AT-BSM-03 a double click on the empty initial preview: browsingPreview -> editingBlock", async () => {
    app = await setupApp();
    app.preview.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();
    expect(state()).toBe("editingBlock");
  });

  it("AT-BSM-08 Esc on the body: editModeIdle -> browsingPreview; editingBlock -> editModeIdle (cancel)", async () => {
    await withDocument();
    keydown(document.body, "e");
    openChanged().blur();
    keydown(document.body, "Escape");
    expect(state()).toBe("editModeIdle");
    keydown(document.body, "Escape");
    expect(state()).toBe("browsingPreview");
  });

  it.each([
    ["AT-BSM-11 Reload", async () => app.ui.handleReload(), "editModeIdle"],
    ["AT-BSM-11 .md drop", async () => { document.dispatchEvent(dropEvent(new File(["# N\n\nP.\n"], "n.md"), null)); await settle(); }, "editModeIdle"],
    ["AT-BSM-12 Clear", async () => keydown(document.body, "c"), "browsingPreview"],
    ["AT-BSM-13 a .py drop", async () => { document.dispatchEvent(dropEvent(new File(["x"], "a.py"), null)); await settle(); }, "browsingPreview"],
  ])("%s while editing (OK): editor discarded, state %s", async (_name, act, next) => {
    await withDocument();
    const ta = openChanged();
    ta.blur();
    const commit = vi.spyOn(app.orchestrator, "commitBlock");
    await act();
    await settle();
    expect(commit).not.toHaveBeenCalled();
    expect(state()).toBe(next);
  });

  it("AT-BSM-14 (a) a mouse press on [Render] commits first, then the full render includes it", async () => {
    await withDocument();
    openChanged();
    pointer(app.elements.renderLightBtn, "pointerdown");
    expect(state()).toBe("editModeIdle");
    app.elements.renderLightBtn.click();
    await settle();
    expect(app.preview.textContent).toContain("Changed A.");
  });

  it("AT-BSM-14 (b) focus on the body by blur(), then l: commit and render", async () => {
    await withDocument();
    openChanged().blur();
    keydown(document.body, "l");
    expect(state()).toBe("editModeIdle");
    await settle();
    expect(app.preview.textContent).toContain("Changed A.");
  });

  it("AT-BSM-14 (c) [Render] focused and pressed by keyboard (click() without pointer events)", async () => {
    await withDocument();
    openChanged();
    app.elements.renderDarkBtn.focus();
    app.elements.renderDarkBtn.click();
    expect(state()).toBe("editModeIdle");
    await settle();
    expect(app.preview.textContent).toContain("Changed A.");
  });

  it("AT-BSM-16 #editor.focus() while editing: editingBlock -> editModeIdle with a commit", async () => {
    await withDocument();
    openChanged();
    app.elements.editor.focus();
    expect(state()).toBe("editModeIdle");
    expect(app.orchestrator.getBody()).toContain("Changed A.");
  });
});

describe("AT-CFG-04 / 05 text and key hints", () => {
  it("AT-CFG-04 messages.edit is ASCII only (functions called with 'a.md')", () => {
    for (const [key, value] of Object.entries(CONFIG.messages.edit)) {
      const text = typeof value === "function" ? value("a.md") : value;
      expect(/^[\x20-\x7e\n]*$/.test(text), key).toBe(true); // a confirm may break lines (A08)
    }
  });

  it("AT-CFG-05 keyHints.markdown has '[E] Edit;' exactly once; keyHints.code has none", () => {
    expect(CONFIG.keyHints.markdown.split("[E] Edit;").length - 1).toBe(1);
    expect(CONFIG.keyHints.code).not.toContain("[E] Edit;");
  });
});
