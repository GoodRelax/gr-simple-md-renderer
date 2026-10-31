import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

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

vi.mock("../js/classes/ModalController.js", () => ({
  default: { setupModal: vi.fn(), show: vi.fn(), hide: vi.fn() },
}));

import UIController from "../js/classes/UIController.js";
import { setupEdit } from "./helpers/editStack.js";
import { tap, keydown } from "./helpers/editDom.js";
import { loadFixtureLf } from "./helpers/samples.js";
import { fakeEditServices, withEditMethods } from "./helpers/uiMocks.js";

// INV-14: keys typed into the block editor, a contenteditable element or a
// role="toolbar" (the edit palette, or any element with that role) are not
// document shortcuts. One UIController listens on the document for the file.

let ui;
let scrollEngine;
let s;

beforeAll(() => {
  const modal = () => {
    const m = document.createElement("div");
    m.innerHTML = '<button class="close-btn"></button><button class="prompt-close"></button>';
    return m;
  };
  const elements = {
    editor: document.createElement("textarea"),
    fileInfo: document.createElement("div"),
    keyHint: document.createElement("div"),
    preview: document.createElement("div"),
    renderLightBtn: document.createElement("button"),
    renderDarkBtn: document.createElement("button"),
    reloadBtn: document.createElement("button"),
    newTabBtn: document.createElement("button"),
    editBtn: document.createElement("button"),
    clearBtn: document.createElement("button"),
    helpBtn: document.createElement("button"),
    helpModal: modal(),
    githubHelpModal: modal(),
    guideModal: modal(),
    promptModal: modal(),
    promptText: document.createElement("textarea"),
    copyPromptBtn: document.createElement("button"),
  };
  const orchestrator = {
    isCodeViewActive: vi.fn().mockReturnValue(false),
    isPreRenderState: vi.fn().mockReturnValue(false),
    reRender: vi.fn().mockResolvedValue(undefined),
    reloadCodeView: vi.fn().mockResolvedValue(undefined),
    loadMarkdown: vi.fn().mockResolvedValue(undefined),
    renderCodeView: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
  };
  scrollEngine = { startScroll: vi.fn(), stopScroll: vi.fn(), destroy: vi.fn() };
  ui = new UIController(
    withEditMethods(orchestrator),
    { setTheme: vi.fn(), setMarkdownText: vi.fn() },
    elements,
    scrollEngine,
    fakeEditServices(),
  );
});

afterEach(() => {
  s?.teardown();
  s = null;
  document.activeElement?.blur?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function spyShortcuts() {
  return {
    doClear: vi.spyOn(ui, "doClear").mockImplementation(() => {}),
    handleRender: vi.spyOn(ui, "handleRender").mockResolvedValue(undefined),
    handleReload: vi.spyOn(ui, "handleReload").mockResolvedValue(undefined),
    open: vi.spyOn(window, "open").mockImplementation(() => null),
    startScroll: vi.spyOn(scrollEngine, "startScroll"),
  };
}

const noneCalled = (spies) => Object.values(spies).every((spy) => spy.mock.calls.length === 0);

describe("AT-BEC-29 keys in the block editor are text, not shortcuts (INV-14)", () => {
  it("positive control: the same keys on the body reach the shortcuts", async () => {
    const spies = spyShortcuts();
    keydown(document.body, "c");
    keydown(document.body, "l");
    expect(spies.doClear).toHaveBeenCalledTimes(1);
    expect(spies.handleRender).toHaveBeenCalledWith("light");
  });

  it.each(["c", "l", "r", "e", "d", "n", "ArrowUp"])("'%s' in the editor calls no shortcut and is not prevented", async (key) => {
    s = await setupEdit("Hello world.\n");
    tap(s.preview.querySelector(".md-block p"));
    const ta = s.editor();
    expect(document.activeElement).toBe(ta);
    const spies = spyShortcuts();
    const e = keydown(ta, key);
    expect(noneCalled(spies)).toBe(true);
    expect(e.defaultPrevented).toBe(false);
    expect(s.bec.isEditing()).toBe(true);
  });
});

describe("AT-BEC-28 (5) and INV-14 guards by role and contenteditable", () => {
  it("(5) focus on a link inside a user-written role=toolbar: 'c' does not clear", async () => {
    s = await setupEdit(loadFixtureLf("spoof-block-id.md"));
    const link = s.preview.querySelector('[role="toolbar"] a');
    link.focus();
    expect(document.activeElement).toBe(link);
    const spies = spyShortcuts();
    keydown(link, "c");
    expect(spies.doClear).not.toHaveBeenCalled();
  });

  it("focus on a palette button (role=toolbar): 'c' and 'l' do nothing", async () => {
    s = await setupEdit("Hello world.\n");
    const button = s.host.palette.querySelector("button");
    button.focus();
    const spies = spyShortcuts();
    keydown(button, "c");
    keydown(button, "l");
    expect(noneCalled(spies)).toBe(true);
  });

  it("focus on a contenteditable element: 'c' does not clear", () => {
    const el = document.createElement("div");
    el.tabIndex = 0;
    Object.defineProperty(el, "isContentEditable", { value: true });
    document.body.appendChild(el);
    el.focus();
    const spies = spyShortcuts();
    keydown(el, "c");
    expect(spies.doClear).not.toHaveBeenCalled();
    el.remove();
  });
});
